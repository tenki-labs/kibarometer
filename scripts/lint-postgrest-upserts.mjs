#!/usr/bin/env node
// scripts/lint-postgrest-upserts.mjs — guard against the
// retag-shaped-upsert defect (issue surfaced by PRs #171/#172).
//
// PostgreSQL's INSERT … ON CONFLICT DO UPDATE validates NOT NULL on
// the proposed INSERT row BEFORE routing to DO UPDATE — ON CONFLICT
// only catches unique/exclusion violations. So a POST upsert with
// `Prefer: resolution=merge-duplicates` whose body omits a NOT NULL
// column without a default will fail even when every row already
// exists. That's how reprocess_storting_keywords blew up on a missing
// `tittel` field after the row had been in the table for months.
//
// This script:
//   1. Parses supabase/migrations/*.sql to map table → NOT-NULL-no-default cols.
//   2. Scans lib/ and app/ for sb() / sbFetch() calls that POST to
//      /<table>?on_conflict=… with Prefer: resolution=merge-duplicates.
//   3. Extracts column keys from the body — supports {…}, [{…}], and
//      .map((..) => ({…})). Anything indirect (bare variable reference
//      that can't be statically traced) is reported as a soft warning
//      so a human can audit it.
//   4. Fails (exit 1) if any inline body is missing a required column.
//
// Run: `node scripts/lint-postgrest-upserts.mjs` or `pnpm lint:postgrest`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CWD = process.cwd();
const MIGRATIONS_DIR = join(CWD, "supabase/migrations");
const SOURCE_ROOTS = ["lib", "app"].map((r) => join(CWD, r));
const SOURCE_EXTS = /\.(?:ts|tsx|js|mjs|cjs)$/;
const SKIP_FILES = /\.(?:test|spec)\.[tj]sx?$|\.d\.ts$/;
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo"]);

// ---------- Migration parser ----------

// Returns { tableName: { colName: { nullable: bool, hasDefault: bool } } }.
// Processes migrations in filename order so later ALTER … ADD COLUMN /
// SET DEFAULT / SET NOT NULL statements layer correctly.
function loadTableSchemas(dir) {
  const tables = {};
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    applyCreateTable(sql, tables);
    applyAlterTable(sql, tables);
  }
  return tables;
}

function applyCreateTable(sql, tables) {
  const reCreate =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(([\s\S]*?)\n[ \t]*\)\s*;/gi;
  let m;
  while ((m = reCreate.exec(sql))) {
    const name = m[1];
    const body = m[2];
    if (!tables[name]) tables[name] = {};
    for (const line of splitColumnLines(body)) {
      const parsed = parseColumnLine(line);
      if (parsed) tables[name][parsed.name] = parsed;
    }
  }
}

function applyAlterTable(sql, tables) {
  // ADD COLUMN … (with NOT NULL / DEFAULT)
  const reAdd =
    /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]*?);/gi;
  let m;
  while ((m = reAdd.exec(sql))) {
    const name = m[1];
    if (!tables[name]) tables[name] = {};
    const parsed = parseColumnLine(m[2].replace(/\s+/g, " ").trim());
    if (parsed) tables[name][parsed.name] = parsed;
  }
  // ALTER COLUMN … SET NOT NULL
  const reSetNotNull =
    /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+alter\s+column\s+(\w+)\s+set\s+not\s+null/gi;
  while ((m = reSetNotNull.exec(sql))) {
    const t = tables[m[1]];
    if (t?.[m[2]]) t[m[2]].nullable = false;
  }
  // ALTER COLUMN … DROP NOT NULL
  const reDropNotNull =
    /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+alter\s+column\s+(\w+)\s+drop\s+not\s+null/gi;
  while ((m = reDropNotNull.exec(sql))) {
    const t = tables[m[1]];
    if (t?.[m[2]]) t[m[2]].nullable = true;
  }
  // ALTER COLUMN … SET DEFAULT …
  const reSetDefault =
    /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+alter\s+column\s+(\w+)\s+set\s+default\b/gi;
  while ((m = reSetDefault.exec(sql))) {
    const t = tables[m[1]];
    if (t?.[m[2]]) t[m[2]].hasDefault = true;
  }
  // ALTER COLUMN … DROP DEFAULT
  const reDropDefault =
    /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+alter\s+column\s+(\w+)\s+drop\s+default/gi;
  while ((m = reDropDefault.exec(sql))) {
    const t = tables[m[1]];
    if (t?.[m[2]]) t[m[2]].hasDefault = false;
  }
  // DROP COLUMN
  const reDropCol =
    /alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi;
  while ((m = reDropCol.exec(sql))) {
    const t = tables[m[1]];
    if (t) delete t[m[2]];
  }
}

// Split a `create table (...)` body into per-column lines, respecting
// parens (a column with `numeric(6,2)` shouldn't split on its comma)
// and stripping `-- …` line comments.
function splitColumnLines(body) {
  const out = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "-" && body[i + 1] === "-") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parseColumnLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Skip table-level constraints.
  if (
    /^(primary\s+key|foreign\s+key|check|unique|constraint|like|exclude)\b/i.test(
      trimmed,
    )
  )
    return null;
  const nameMatch = trimmed.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
  if (!nameMatch) return null;
  const name = nameMatch[1].toLowerCase();
  // A generated/identity column never needs to be supplied — treat it
  // as "has default" so the linter doesn't demand it in upsert bodies.
  const isGenerated = /\bgenerated\b/i.test(trimmed);
  // A PRIMARY KEY column is implicitly NOT NULL.
  const isPrimaryKey = /\bprimary\s+key\b/i.test(trimmed);
  const isNotNull = isPrimaryKey || /\bnot\s+null\b/i.test(trimmed);
  // `default …` or a `serial` / `bigserial` / `smallserial` shorthand.
  const hasDefault =
    isGenerated ||
    /\bdefault\b/i.test(trimmed) ||
    /\b(?:big|small)?serial\b/i.test(trimmed);
  return { name, nullable: !isNotNull, hasDefault };
}

// ---------- Source scanner ----------

function listSourceFiles(roots) {
  const out = [];
  for (const root of roots) {
    try {
      walk(root, out);
    } catch {
      // Missing root — fine.
    }
  }
  return out;
}

function walk(path, acc) {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(join(path, entry), acc);
    }
  } else if (
    st.isFile() &&
    SOURCE_EXTS.test(path) &&
    !SKIP_FILES.test(path)
  ) {
    acc.push(path);
  }
}

// Returns array of { file, line, table, bodyKeys (Set | null), note }.
// bodyKeys === null means we couldn't statically resolve the body.
function findUpsertCalls(src, file) {
  const hits = [];
  // Look for /<table>?…on_conflict=… occurring inside a string literal.
  const pathRe = /(['"`])\/(\w+)\?[^'"`]*on_conflict=[^'"`]*\1/g;
  let m;
  while ((m = pathRe.exec(src))) {
    const table = m[2];
    // Walk backwards to find the surrounding sb(/sbFetch( call. Match
    // an identifier ending in `sb` or `sbFetch` then `(`.
    const sbStart = findEnclosingSbCall(src, m.index);
    if (sbStart < 0) continue;
    const callEnd = findMatchingParen(src, sbStart);
    if (callEnd < 0) continue;
    const callText = src.slice(sbStart, callEnd + 1);
    if (!/method:\s*['"]POST['"]/.test(callText)) continue;
    // Only flag merge-duplicates upserts. ignore-duplicates is a true
    // "insert new" flow; missing NOT NULL columns there is a different
    // (more obvious) class of bug.
    if (!/resolution=merge-duplicates/.test(callText)) continue;

    const bodyExpr = extractBodyExpr(callText);
    const { keys, note } = bodyExpr
      ? resolveBodyKeys(bodyExpr, src, sbStart)
      : { keys: null, note: "no body field" };

    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ file, line, table, bodyKeys: keys, note });
  }
  return hits;
}

function findEnclosingSbCall(src, idx) {
  // Walk backward from idx looking for `<ident>(` where ident ends in
  // "sb" or "sbFetch" (covers `sb`, `sbFetch`, `await sb`, etc.).
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    const ch = src[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) {
        // Found an opening paren that contains idx. Look back at the
        // identifier preceding it.
        let j = i - 1;
        while (j >= 0 && /\s/.test(src[j])) j--;
        let end = j + 1;
        while (j >= 0 && /[\w$]/.test(src[j])) j--;
        const ident = src.slice(j + 1, end);
        if (ident === "sb" || ident === "sbFetch") return j + 1;
        // Not an sb call — give up; we don't want to misattribute.
        return -1;
      }
      depth--;
    }
  }
  return -1;
}

function findMatchingParen(src, startIdent) {
  // Find the `(` after the identifier, then the matching `)`.
  let i = startIdent;
  while (i < src.length && src[i] !== "(") i++;
  if (i >= src.length) return -1;
  let depth = 0;
  let inStr = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractBodyExpr(callText) {
  // Locate the options-object literal (the second argument's `{ … }`).
  // It's the first `{` after the path string at sb-call depth 1.
  const optsOpen = findOptionsObjectStart(callText);
  if (optsOpen < 0) return null;
  const optsClose = findMatchingBrace(callText, optsOpen);
  if (optsClose < 0) return null;
  const inner = callText.slice(optsOpen + 1, optsClose);
  // Split into top-level entries and find the one whose key is `body`.
  for (const part of splitTopLevel(inner, ",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Shorthand `body` (no colon) — value === identifier "body".
    if (/^body\s*$/.test(trimmed)) return "body";
    // Long form `body: <expr>`.
    const m = trimmed.match(/^body\s*:\s*([\s\S]+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function findOptionsObjectStart(callText) {
  // sb( PATH , { … } ) — find the first `{` at depth 1 inside the call.
  // The opening `(` of sb is at index 0 (the call we pass starts at sb).
  let depth = 0;
  let inStr = null;
  let sawOpen = false;
  for (let i = 0; i < callText.length; i++) {
    const ch = callText[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      sawOpen = true;
      continue;
    }
    if (ch === ")") {
      depth--;
      continue;
    }
    if (ch === "{" && sawOpen && depth === 1) return i;
  }
  return -1;
}

function findMatchingBrace(text, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function resolveBodyKeys(expr, srcContext, callOffset, depth = 0) {
  if (depth > 4) {
    return { keys: null, note: "trace depth exceeded" };
  }
  const stripped = expr.replace(/\s+/g, " ").trim();
  // 1. Object literal: { ... }
  if (stripped.startsWith("{")) {
    return { keys: extractObjectLiteralKeys(stripped), note: "inline object" };
  }
  // 2. Array of object literal: [{...}, ...]
  const arrMatch = stripped.match(/^\[\s*(\{[\s\S]*\})\s*[,\]]/);
  if (arrMatch) {
    return {
      keys: extractObjectLiteralKeys(arrMatch[1]),
      note: "array of inline object",
    };
  }
  // 3. .map(arrow) anywhere in the expression — handles both concise
  //    `(r) => ({...})` and block-body `(r) => { … return {...}; }`.
  const mapKeys = findMapArrowKeys(stripped);
  if (mapKeys) {
    return {
      keys: mapKeys,
      note: ".map arrow returning object literal",
    };
  }
  // 4. Strip a trailing `.method(...)` (e.g. `.slice(i, i + CHUNK)`,
  //    `.filter(Boolean)`) and try the base.
  const trailing = stripped.match(/^([\s\S]+?)\.(?:slice|filter|map|flat|concat|reverse|sort)\([\s\S]*\)\s*$/);
  if (trailing) {
    return resolveBodyKeys(trailing[1], srcContext, callOffset, depth + 1);
  }
  // 5. Bare identifier — look BACKWARDS from the call site for the
  //    most recent `const|let|var <id> = …;` declaration. Falls back
  //    to a forward scan of the same file if nothing is found before
  //    the call (e.g. module-level helper used by an earlier call).
  const idMatch = stripped.match(/^([A-Za-z_$][\w$]*)$/);
  if (idMatch) {
    const id = idMatch[1];
    const decl = findLatestDeclarationBefore(srcContext, id, callOffset);
    if (decl) {
      const recur = resolveBodyKeys(decl, srcContext, callOffset, depth + 1);
      if (recur.keys) return { keys: recur.keys, note: `via ${id}` };
      return { keys: null, note: `${id} traced but body indirected (${recur.note})` };
    }
    return { keys: null, note: `bare identifier ${id} (likely a parameter)` };
  }
  return { keys: null, note: "could not statically determine body shape" };
}

// Walks `.map(arrow-body)` and returns the keys of the literal it
// returns. Handles both shapes: concise return `(r) => ({...})` and
// block-body `(r) => { …; return {...}; }`. Walks ALL return statements
// in a block body and unions their keys — if any return path produces
// a literal that's missing a column, we want to know about it.
function findMapArrowKeys(expr) {
  const mapIdx = expr.indexOf(".map(");
  if (mapIdx < 0) return null;
  // findMatchingParen scans forward for `(` from the given index.
  const argsEnd = findMatchingParen(expr, mapIdx);
  if (argsEnd < 0) return null;
  const argsStart = expr.indexOf("(", mapIdx) + 1;
  const args = expr.slice(argsStart, argsEnd);
  const arrowIdx = args.indexOf("=>");
  if (arrowIdx < 0) return null;
  let body = args.slice(arrowIdx + 2).replace(/^\s+/, "");
  if (body.startsWith("(")) {
    // Concise return: `(...)` wrapping an object literal.
    const closeP = findMatchingParen(body, 0);
    if (closeP < 0) return null;
    const inner = body.slice(1, closeP).trim();
    if (inner.startsWith("{")) return extractObjectLiteralKeys(inner);
    return null;
  }
  if (body.startsWith("{")) {
    // Block body: walk every `return { … }`.
    const closeB = findMatchingBrace(body, 0);
    if (closeB < 0) return null;
    const block = body.slice(1, closeB);
    const all = new Set();
    const returnRe = /\breturn\s*(?=\{)/g;
    let m;
    while ((m = returnRe.exec(block))) {
      const openBrace = block.indexOf("{", m.index);
      const close = findMatchingBrace(block, openBrace);
      if (close < 0) continue;
      const literal = block.slice(openBrace, close + 1);
      for (const k of extractObjectLiteralKeys(literal)) all.add(k);
    }
    return all.size > 0 ? all : null;
  }
  return null;
}

function findLatestDeclarationBefore(src, id, before) {
  // Find every `const|let|var <id> = ` that appears before `before`,
  // then balance-parse the RHS up to the first top-level `;` so we
  // capture multi-line declarations (e.g. `.map((r) => { … return {…}; })`).
  // The naive non-greedy `…;` regex stops at the first semicolon inside
  // an arrow body, which is exactly the shape we need to inspect.
  const startRe = new RegExp(
    `\\b(?:const|let|var)\\s+${id}\\s*=\\s*`,
    "g",
  );
  let m;
  let best = null;
  while ((m = startRe.exec(src))) {
    if (m.index >= before) break;
    const rhsStart = m.index + m[0].length;
    const end = scanToTopLevelSemicolon(src, rhsStart);
    best = src.slice(rhsStart, end).trim();
  }
  return best;
}

function scanToTopLevelSemicolon(src, from) {
  let depth = 0;
  let inStr = null;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === ";" && depth === 0) return i;
  }
  return src.length;
}

// Replace every `//` line comment and `/* … */` block comment with
// spaces of the same length so offsets/line numbers stay aligned. We
// only need to fool the scanners — not produce a syntactically clean
// file. Doesn't try to handle comments inside string or template
// literals (rare in our source and not worth the complexity).
function stripCommentsPreservingOffsets(src) {
  const out = src.split("");
  let inStr = null;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "/" && out[i + 1] === "/") {
      while (i < out.length && out[i] !== "\n") {
        out[i++] = " ";
      }
    } else if (ch === "/" && out[i + 1] === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < out.length && !(out[i] === "*" && out[i + 1] === "/")) {
        if (out[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < out.length) {
        out[i++] = " ";
        out[i] = " ";
      }
    }
  }
  return out.join("");
}

function extractObjectLiteralKeys(text) {
  // text is `{ key: val, key2, ...spread, "key3": val }`
  // Strip outer braces.
  const inner = text.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
  const parts = splitTopLevel(inner, ",");
  const keys = new Set();
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith("...")) continue; // spread — gives up precision
    const km = p.match(/^['"`]?([A-Za-z_$][\w$]*)['"`]?\s*(?::|,|$)/);
    if (km) keys.add(km[1]);
  }
  return keys;
}

function splitTopLevel(text, sep) {
  const out = [];
  let depth = 0;
  let inStr = null;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === sep && depth === 0) {
      out.push(text.slice(last, i));
      last = i + 1;
    }
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------- Main ----------

const tables = loadTableSchemas(MIGRATIONS_DIR);
const srcFiles = listSourceFiles(SOURCE_ROOTS);

const errors = [];
const warnings = [];
let checked = 0;
let unknownBody = 0;

for (const file of srcFiles) {
  const raw = readFileSync(file, "utf8");
  // Blank out `//` and `/* … */` comments (preserving offsets and
  // newlines) so apostrophes / braces inside comments don't poison
  // string- and depth-tracking in our scanners.
  const src = stripCommentsPreservingOffsets(raw);
  const hits = findUpsertCalls(src, file);
  for (const hit of hits) {
    checked++;
    const cols = tables[hit.table];
    if (!cols) {
      warnings.push(
        `${relative(CWD, hit.file)}:${hit.line} unknown table public.${hit.table} (no create-table found in migrations)`,
      );
      continue;
    }
    const required = Object.entries(cols)
      .filter(([, v]) => !v.nullable && !v.hasDefault)
      .map(([k]) => k);
    if (hit.bodyKeys === null) {
      unknownBody++;
      warnings.push(
        `${relative(CWD, hit.file)}:${hit.line} POST /${hit.table} (${hit.note}); manual audit required. NOT-NULL-no-default cols: ${required.join(", ") || "(none)"}`,
      );
      continue;
    }
    const missing = required.filter((c) => !hit.bodyKeys.has(c));
    if (missing.length) {
      errors.push(
        `${relative(CWD, hit.file)}:${hit.line} POST /${hit.table}?on_conflict=… (Prefer: resolution=merge-duplicates) body is missing NOT-NULL-no-default column(s): ${missing.join(", ")}`,
      );
    }
  }
}

if (warnings.length) {
  process.stderr.write("warnings:\n");
  for (const w of warnings) process.stderr.write(`  - ${w}\n`);
}

if (errors.length) {
  process.stderr.write("\nerrors:\n");
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.stderr.write(
    `\n${errors.length} POST upsert(s) likely to hit "null value in column \\"…\\" violates not-null constraint" on the INSERT pre-check.\n` +
      `Fix by including the listed NOT NULL no-default column(s) in the body (PostgreSQL validates NOT NULL before ON CONFLICT routes to DO UPDATE).\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `ok: ${checked} POST upsert call site(s) checked, ${unknownBody} skipped (indirect body), 0 missing required NOT-NULL-no-default columns.\n`,
);
