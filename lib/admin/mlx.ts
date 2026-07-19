// lib/admin/mlx.ts — server-side LLM client for mlx.tenki.no.
//
// OpenAI-wire-compatible endpoint backed by mlx_lm.server running
// Gemma 3 4B-IT (4-bit) on a Mac mini behind Cloudflare Tunnel + Caddy +
// Supabase-backed bearer auth. See docs/api_docs.md for endpoint details.
//
// Function calling is unstable on 4B per the upstream docs — we use
// JSON-in-text with parse-and-retry from the orchestrators (PR 2 / PR 3)
// rather than the OpenAI tools API.
//
// Health state is persisted to public.mlx_health (single row) on every
// call so /admin/llm renders a fleet-wide tunnel state. Module-scoped
// state would not survive across Next.js worker processes.

import "server-only";

import { sbFetch } from "@/lib/admin/sb";
import {
  AnthropicError,
  anthropicConfigured,
  anthropicTextChat,
} from "@/lib/admin/anthropic";
import { MlxError } from "./mlx-error";
import type { MlxErrorKind } from "./mlx-error";

// Re-exported so existing `import { MlxError } from "@/lib/admin/mlx"` call
// sites keep working after the class moved to its own server-only-free module.
export { MlxError } from "./mlx-error";
export type { MlxErrorKind } from "./mlx-error";

const DEFAULT_BASE_URL = "https://mlx.tenki.no/v1";
const DEFAULT_MODEL = "mlx-community/gemma-3-4b-it-4bit";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";

// Which backend serves the shared Tier 1/Tier 2 pipeline. "mlx" (default)
// talks to the OpenAI-compatible endpoint at MLX_BASE_URL; "anthropic"
// routes every mlxChat() through lib/admin/anthropic.ts (Claude Haiku via
// the Messages API). Introduced 2026-07 when the MLX Mac mini was
// decommissioned. Orchestrators are provider-agnostic: they gate on
// mlxConfigured() and parse JSON out of the returned text either way.
export type LlmProvider = "mlx" | "anthropic";

export function llmProvider(): LlmProvider {
  return process.env.LLM_PROVIDER === "anthropic" ? "anthropic" : "mlx";
}

export type MlxConfig = {
  baseUrl: string;
  apiKey: string;
};

export function mlxConfigured(): MlxConfig | null {
  if (llmProvider() === "anthropic") {
    // The Tier pipeline is "configured" when the active provider is usable.
    // baseUrl is informational here — the anthropic SDK owns its own URL.
    const cfg = anthropicConfigured();
    if (!cfg) return null;
    return { baseUrl: "https://api.anthropic.com/v1", apiKey: cfg.apiKey };
  }
  const apiKey = process.env.MLX_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: process.env.MLX_BASE_URL || DEFAULT_BASE_URL,
    apiKey,
  };
}


type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type MlxChatResponse = {
  content: string;
  usage?: ChatUsage;
  model: string;
};

export type MlxChatArgs = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
};

// Single-call chat completion. Throws MlxError on any failure. Persists
// success/failure to mlx_health so the /admin/llm page can render state.
// Single retry on 5xx (1s backoff). No retry on 401/403 — token revoked
// or invalid; surfacing fast lets the orchestrator stop firing.
export async function mlxChat(args: MlxChatArgs): Promise<MlxChatResponse> {
  if (llmProvider() === "anthropic") {
    return anthropicBackedChat(args);
  }
  const cfg = mlxConfigured();
  if (!cfg) {
    throw new MlxError("config", "MLX_API_KEY is not set");
  }
  const messages: ChatMessage[] = [
    { role: "system", content: args.system },
    { role: "user", content: args.user },
  ];
  const requestBody = {
    model: args.model || DEFAULT_MODEL,
    messages,
    max_tokens: args.maxTokens ?? 400,
    temperature: args.temperature ?? 0.2,
  };

  const callOnce = async (): Promise<Response> => {
    return fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });
  };

  let res: Response;
  try {
    res = await callOnce();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await recordFailure("network", m);
    throw new MlxError("unreachable", `network: ${m}`);
  }

  // 5xx retry with 1 s backoff. Cloudflare-tunnel hiccups (520-525)
  // resolve on a second try fairly often per the upstream notes.
  if (res.status >= 500 && res.status < 600) {
    await sleep(1000);
    try {
      res = await callOnce();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      await recordFailure("network", m);
      throw new MlxError("unreachable", `network (retry): ${m}`);
    }
  }

  if (res.status === 401 || res.status === 403) {
    const body = await readBodyShort(res);
    await recordFailure(`http ${res.status}`, body);
    throw new MlxError(
      "auth",
      `auth ${res.status}: ${body || "no body"}`,
      res.status,
      body,
    );
  }

  if (!res.ok) {
    const body = await readBodyShort(res);
    await recordFailure(`http ${res.status}`, body);
    throw new MlxError(
      "http",
      `http ${res.status}: ${body || "no body"}`,
      res.status,
      body,
    );
  }

  let json: {
    choices?: { message?: { content?: string } }[];
    usage?: ChatUsage;
    model?: string;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await recordFailure("parse", m);
    throw new MlxError("parse", `response not JSON: ${m}`);
  }

  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    await recordFailure("parse", "missing choices[0].message.content");
    throw new MlxError("parse", "missing choices[0].message.content");
  }

  const result: MlxChatResponse = {
    content,
    usage: json.usage,
    model: json.model || requestBody.model,
  };
  await recordSuccess(result.model);
  return result;
}

// Anthropic-backed variant of mlxChat. Same MlxChatResponse contract:
// orchestrators keep parsing JSON out of `content` and reading token usage.
// AnthropicError kinds map onto MlxError kinds so the per-row retry logic
// in the orchestrators (recoverable vs abort) behaves identically.
async function anthropicBackedChat(args: MlxChatArgs): Promise<MlxChatResponse> {
  let resp;
  try {
    resp = await anthropicTextChat({
      system: args.system,
      user: args.user,
      maxTokens: args.maxTokens,
      temperature: args.temperature,
      model: args.model,
    });
  } catch (err) {
    if (err instanceof AnthropicError) {
      const kind: MlxErrorKind =
        err.kind === "config"
          ? "config"
          : err.kind === "auth"
            ? "auth"
            : err.kind === "unreachable"
              ? "unreachable"
              : err.kind === "parse"
                ? "parse"
                : "http"; // rate_limit + server → retryable http
      if (kind !== "config") {
        await recordFailure(kind, err.message);
      }
      throw new MlxError(kind, err.message, err.status, err.body);
    }
    const m = err instanceof Error ? err.message : String(err);
    await recordFailure("network", m);
    throw new MlxError("unreachable", `network: ${m}`);
  }

  const totalPrompt =
    resp.usage.input_tokens +
    resp.usage.cache_creation_input_tokens +
    resp.usage.cache_read_input_tokens;
  const result: MlxChatResponse = {
    content: resp.content,
    usage: {
      prompt_tokens: totalPrompt,
      completion_tokens: resp.usage.output_tokens,
      total_tokens: totalPrompt + resp.usage.output_tokens,
    },
    model: resp.model,
  };
  await recordSuccess(result.model);
  return result;
}

// /v1/models lookup. Cached 5 min so repeated /admin/llm renders don't
// hammer the tunnel. Returns null on any failure (the page falls back to
// the value cached in mlx_health.model_id).
let cachedModel: { id: string; expiresAt: number } | null = null;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

export async function mlxModelId(): Promise<string | null> {
  if (llmProvider() === "anthropic") {
    return anthropicConfigured()?.model ?? null;
  }
  const cfg = mlxConfigured();
  if (!cfg) return null;
  if (cachedModel && cachedModel.expiresAt > Date.now()) {
    return cachedModel.id;
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { id?: string }[] };
    const id = json.data?.[0]?.id ?? null;
    if (id) {
      cachedModel = { id, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
    }
    return id;
  } catch {
    return null;
  }
}

// Active health-check used by the "Test ping" button on /admin/llm.
// Hits /v1/models, surfaces a structured result (no exceptions) so the
// server action can flash the outcome cleanly.
export type MlxPingResult = {
  ok: boolean;
  modelId: string | null;
  error: string | null;
};

export async function mlxPing(): Promise<MlxPingResult> {
  if (llmProvider() === "anthropic") {
    return anthropicPing();
  }
  const cfg = mlxConfigured();
  if (!cfg) {
    return { ok: false, modelId: null, error: "MLX_API_KEY er ikke satt" };
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      const body = await readBodyShort(res);
      await recordFailure(`http ${res.status}`, body || "auth failed");
      return {
        ok: false,
        modelId: null,
        error: `Auth-feil ${res.status}: token mangler eller er trukket tilbake`,
      };
    }
    if (!res.ok) {
      const body = await readBodyShort(res);
      await recordFailure(`http ${res.status}`, body);
      return {
        ok: false,
        modelId: null,
        error: `HTTP ${res.status}${body ? `: ${body}` : ""}`,
      };
    }
    const json = (await res.json()) as { data?: { id?: string }[] };
    const id = json.data?.[0]?.id ?? null;
    if (id) {
      cachedModel = { id, expiresAt: Date.now() + MODEL_CACHE_TTL_MS };
      await recordSuccess(id);
    }
    return { ok: true, modelId: id, error: null };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await recordFailure("network", m);
    return { ok: false, modelId: null, error: m };
  }
}

// Heartbeat for LLM_PROVIDER=anthropic: cheap GET /v1/models validates the
// key without inference, mirroring the MLX heartbeat semantics — the
// mlx-heartbeat cron keeps the /admin/llm badge honest between Tier ticks.
async function anthropicPing(): Promise<MlxPingResult> {
  const cfg = anthropicConfigured();
  if (!cfg) {
    return { ok: false, modelId: null, error: "ANTHROPIC_API_KEY er ikke satt" };
  }
  try {
    const res = await fetch(ANTHROPIC_MODELS_URL, {
      headers: {
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      const body = await readBodyShort(res);
      await recordFailure(`http ${res.status}`, body || "auth failed");
      return {
        ok: false,
        modelId: null,
        error: `Auth-feil ${res.status}: Anthropic-nøkkelen mangler eller er ugyldig`,
      };
    }
    if (!res.ok) {
      const body = await readBodyShort(res);
      await recordFailure(`http ${res.status}`, body);
      return {
        ok: false,
        modelId: null,
        error: `HTTP ${res.status}${body ? `: ${body}` : ""}`,
      };
    }
    await recordSuccess(cfg.model);
    return { ok: true, modelId: cfg.model, error: null };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await recordFailure("network", m);
    return { ok: false, modelId: null, error: m };
  }
}

export type MlxHealth = {
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  model_id: string | null;
  updated_at: string;
};

export async function readMlxHealth(): Promise<MlxHealth | null> {
  try {
    const rows = await sbFetch<MlxHealth[]>(
      "/mlx_health?id=eq.1&select=last_success_at,last_failure_at,last_error,model_id,updated_at",
      { service: true },
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function recordSuccess(modelId: string): Promise<void> {
  await safePatch({
    last_success_at: new Date().toISOString(),
    model_id: modelId,
    updated_at: new Date().toISOString(),
  });
}

async function recordFailure(kind: string, message: string): Promise<void> {
  await safePatch({
    last_failure_at: new Date().toISOString(),
    last_error: `${kind}: ${truncate(message, 500)}`,
    updated_at: new Date().toISOString(),
  });
}

// Health writes must never throw — failing to record health should not
// break the call site. Migration 0020 creates the singleton row; if the
// migration hasn't been applied yet the PATCH 404s and we silently skip.
async function safePatch(patch: Record<string, unknown>): Promise<void> {
  try {
    await sbFetch("/mlx_health?id=eq.1", {
      service: true,
      method: "PATCH",
      body: patch,
      prefer: "return=minimal",
    });
  } catch {
    // intentional swallow
  }
}

async function readBodyShort(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return truncate(t, 500);
  } catch {
    return "";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
