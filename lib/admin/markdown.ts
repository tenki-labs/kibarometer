// lib/admin/markdown.ts — minimal markdown → React renderer for the
// `site_content` table. Deliberately tiny (no react-markdown / remark)
// because the only inputs are operator-edited copy on /om and /metode —
// not user-submitted text — and we want zero new npm deps for this PR.
//
// Supported syntax:
//   # / ## / ### headings
//   - bullet list items (single level)
//   blank-line separated paragraphs
//   inline: **bold**, *italic*, `code`, [text](https://url)
//
// Output is React nodes (not raw HTML), so XSS via the inline renderer is
// not possible — text becomes text children, only [link](url) emits an
// anchor and the URL is whitelisted to http(s)/mailto/relative.

import type { ReactNode } from "react";
import * as React from "react";

const SAFE_URL = /^(https?:\/\/|mailto:|\/|#)/i;

// Norwegian-aware slug — used as the `id` on heading nodes so in-page
// links like /om#kontakt scroll to the right section.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Tokenise inline syntax left-to-right. We do this in passes via a single
  // regex with alternation: code first (so its content isn't touched by
  // bold/italic), then links, then bold, then italic. Anything not matched
  // is plain text.
  const out: ReactNode[] = [];
  let i = 0;
  let cursor = 0;
  const re =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) {
      out.push(text.slice(cursor, m.index));
    }
    const tok = m[0];
    const k = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(
        React.createElement(
          "code",
          { key: k, className: "font-mono text-[0.85em]" },
          tok.slice(1, -1),
        ),
      );
    } else if (tok.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (linkMatch) {
        const label = linkMatch[1];
        const href = linkMatch[2];
        if (SAFE_URL.test(href)) {
          out.push(
            React.createElement(
              "a",
              { key: k, href },
              ...renderInline(label, `${k}-l`),
            ),
          );
        } else {
          out.push(label);
        }
      } else {
        out.push(tok);
      }
    } else if (tok.startsWith("**")) {
      out.push(
        React.createElement(
          "strong",
          { key: k },
          ...renderInline(tok.slice(2, -2), `${k}-b`),
        ),
      );
    } else if (tok.startsWith("*")) {
      out.push(
        React.createElement(
          "em",
          { key: k },
          ...renderInline(tok.slice(1, -1), `${k}-i`),
        ),
      );
    }
    cursor = m.index + tok.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function renderMarkdown(source: string): ReactNode {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const nodes: ReactNode[] = [];

  blocks.forEach((raw, blockIdx) => {
    const block = raw.trim();
    if (!block) return;
    const key = `b${blockIdx}`;

    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(block);
    if (h) {
      const level = h[1].length;
      const Tag = (`h${level}` as unknown) as
        | "h1"
        | "h2"
        | "h3";
      const text = h[2].trim();
      const id = slugify(text);
      nodes.push(
        React.createElement(
          Tag,
          { key, id: id || undefined },
          ...renderInline(text, `${key}-h`),
        ),
      );
      return;
    }

    // List (every line starts with "- ")
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      nodes.push(
        React.createElement(
          "ul",
          { key },
          ...lines.map((l, i) =>
            React.createElement(
              "li",
              { key: `${key}-${i}` },
              ...renderInline(
                l.replace(/^\s*-\s+/, "").trim(),
                `${key}-${i}-l`,
              ),
            ),
          ),
        ),
      );
      return;
    }

    // Default — paragraph. Internal newlines become spaces.
    nodes.push(
      React.createElement(
        "p",
        { key },
        ...renderInline(block.replace(/\n+/g, " "), `${key}-p`),
      ),
    );
  });

  return React.createElement(React.Fragment, null, ...nodes);
}
