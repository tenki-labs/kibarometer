// lib/admin/anthropic.ts — server-side Anthropic Messages client for the
// manual "Drain backlog via Claude" flow on /admin/llm.
//
// Mirrors mlx.ts in spirit: a single chat() entry point, structured errors,
// no module-level state. Differences:
//   - Forces structured output via tool_use (schema-of-record below) so we
//     never have to parse free-text JSON.
//   - Marks the system prompt with cache_control:{type:"ephemeral"} so a
//     long-running drain pays the cache write once and reads it back on
//     every subsequent row in the batch (~10× cheaper input tokens).
//   - SDK default retries (2x with exponential backoff) handle transient
//     429/5xx; this wrapper just classifies the final error.
//
// The classification orchestrators (lib/admin/llm-classify-claude.ts,
// llm-brreg-tier2-claude.ts) call this in parallel via p-limit. The SDK
// is concurrency-safe — each messages.create() is an independent HTTP call.

import "server-only";

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 600;

export type AnthropicConfig = {
  apiKey: string;
  model: string;
};

export function anthropicConfigured(): AnthropicConfig | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  };
}

export type AnthropicErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "server"
  | "unreachable"
  | "parse";

export class AnthropicError extends Error {
  kind: AnthropicErrorKind;
  status?: number;
  body?: string;
  constructor(
    kind: AnthropicErrorKind,
    message: string,
    status?: number,
    body?: string,
  ) {
    super(message);
    this.name = "AnthropicError";
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

export type AnthropicChatUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type AnthropicChatResponse = {
  parsed: unknown;
  usage: AnthropicChatUsage;
  model: string;
};

// JSON Schema accepted by Anthropic's tool input_schema. We type it loose
// because the SDK's InputSchema type is a thin Record<string, unknown>.
export type ToolInputSchema = Record<string, unknown>;

export type AnthropicChatArgs = {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  toolInputSchema: ToolInputSchema;
  maxTokens?: number;
  model?: string;
};

// Single tool-forced classification call. Throws AnthropicError on every
// failure path; the orchestrator's per-row try/catch reads `kind` to decide
// whether to bump retry_count (recoverable: parse/rate_limit/server/
// unreachable) vs abort the batch (auth).
export async function anthropicChat(
  args: AnthropicChatArgs,
): Promise<AnthropicChatResponse> {
  const cfg = anthropicConfigured();
  if (!cfg) {
    throw new AnthropicError("config", "ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey: cfg.apiKey });
  const model = args.model || cfg.model;
  const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // System as array-of-blocks: required to attach cache_control.
      // The string form silently ignores any cache directive.
      system: [
        {
          type: "text",
          text: args.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: args.toolName,
          description: args.toolDescription,
          input_schema: args.toolInputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: args.toolName },
      messages: [{ role: "user", content: args.user }],
    });
  } catch (err) {
    throw classifyError(err);
  }

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolBlock) {
    throw new AnthropicError(
      "parse",
      `no tool_use block in response (stop_reason=${response.stop_reason})`,
    );
  }
  if (toolBlock.name !== args.toolName) {
    throw new AnthropicError(
      "parse",
      `unexpected tool_use name: ${toolBlock.name}`,
    );
  }

  return {
    parsed: toolBlock.input,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
    model: response.model,
  };
}

function classifyError(err: unknown): AnthropicError {
  if (err instanceof AnthropicError) return err;

  if (err instanceof Anthropic.AuthenticationError) {
    return new AnthropicError(
      "auth",
      `auth ${err.status}: ${err.message}`,
      err.status,
    );
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AnthropicError(
      "auth",
      `permission ${err.status}: ${err.message}`,
      err.status,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AnthropicError(
      "rate_limit",
      `rate limit ${err.status}: ${err.message}`,
      err.status,
    );
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AnthropicError(
      "server",
      `server ${err.status}: ${err.message}`,
      err.status,
    );
  }
  if (err instanceof Anthropic.APIError) {
    // Catch-all for any other API status (e.g. 400 on bad input). Treat as
    // parse so the orchestrator bumps retry_count rather than aborting.
    return new AnthropicError(
      "parse",
      `api ${err.status}: ${err.message}`,
      err.status,
    );
  }

  // Network-level error (DNS, TLS, fetch abort, etc.).
  const m = err instanceof Error ? err.message : String(err);
  return new AnthropicError("unreachable", `network: ${m}`);
}

// Pricing constants for the configured model. Used by orchestrators to
// surface a per-drain cost summary in the flash message. Update if we
// switch model. Source: https://platform.claude.com/docs/en/pricing
const HAIKU_4_5_INPUT_USD_PER_MTOK = 1.0;
const HAIKU_4_5_OUTPUT_USD_PER_MTOK = 5.0;
const HAIKU_4_5_CACHE_WRITE_USD_PER_MTOK = 1.25;
const HAIKU_4_5_CACHE_READ_USD_PER_MTOK = 0.1;

// usage.input_tokens reports ONLY the uncached remainder per Anthropic docs:
//   total prompt = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
// so the three categories are non-overlapping and we just sum them.
export function estimateCostUsd(usage: AnthropicChatUsage): number {
  return (
    (usage.input_tokens * HAIKU_4_5_INPUT_USD_PER_MTOK) / 1_000_000 +
    (usage.cache_creation_input_tokens * HAIKU_4_5_CACHE_WRITE_USD_PER_MTOK) /
      1_000_000 +
    (usage.cache_read_input_tokens * HAIKU_4_5_CACHE_READ_USD_PER_MTOK) /
      1_000_000 +
    (usage.output_tokens * HAIKU_4_5_OUTPUT_USD_PER_MTOK) / 1_000_000
  );
}
