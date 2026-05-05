// lib/admin/legacy/media-robots.js
// Minimal robots.txt parser + per-host cache. Hand-rolled to keep the admin
// dep-free and because we only need a small subset of RFC 9309: User-agent
// grouping, Allow/Disallow path matching, and longest-match precedence.
//
// We never fetch a page without a positive `isAllowed` check from this module.
// Cached per-host with a 6h TTL — tightening to per-deploy would force a
// fresh GET on every cron tick, which is rude; loosening past a day risks
// missing a host's takedown signal.
//
// Two callable surfaces:
//   parseRobots(text) → rules object (pure, used by tests)
//   getRobots({ host, fetch, ua }) → cached rules; returns ALLOW_ALL on
//     network failure or 4xx/5xx (RFC 9309 §2.3.1.4: "If a parser is unable
//     to fetch the robots.txt file, it MAY assume that the robots.txt file
//     does not exist."). 404 specifically means open access.

const UA_TOKEN = "kibarometerbot";
const TTL_MS = 6 * 60 * 60 * 1000;

const ALLOW_ALL = { groups: [{ agents: ["*"], rules: [] }], crawlDelayMs: null };

const cache = new Map(); // host → { rules, fetchedAt }

// Parse robots.txt body into structured rules. Groups share the same
// User-agent line(s); each group has an ordered list of {type, path}.
// We preserve order so longest-match precedence works correctly.
export function parseRobots(text) {
  if (!text || typeof text !== "string") return ALLOW_ALL;
  const groups = [];
  let current = null;
  let crawlDelayMs = null;
  // RFC 9309 says repeated User-agent lines without a separator share the
  // same group. We track this with `expectingAgents` — once we see a non-UA
  // directive, the next UA line opens a fresh group.
  let expectingAgents = true;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      if (!value) continue;
      if (!expectingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) {
      // Directive before any User-agent: ignore (most parsers do).
      continue;
    }
    // Any non-UA directive closes the agent-list block, even if its value
    // is empty (`Disallow:` with no value is RFC 9309's way of saying
    // "nothing disallowed for this group" — significant, not blank).
    expectingAgents = false;
    if (field === "disallow") {
      // Push even when value is empty so the group exists distinctly; the
      // empty-pattern matcher will simply never match anything, giving the
      // intended "nothing disallowed" semantics.
      current.rules.push({ type: "disallow", path: value });
    } else if (field === "allow") {
      if (value) current.rules.push({ type: "allow", path: value });
    } else if (field === "crawl-delay") {
      const sec = Number(value);
      if (Number.isFinite(sec) && sec > 0) {
        // Crawl-delay isn't in RFC 9309 but most outlets honor it. Use the
        // largest declared value across applicable groups.
        const ms = Math.round(sec * 1000);
        if (crawlDelayMs === null || ms > crawlDelayMs) crawlDelayMs = ms;
      }
    }
    // Sitemap, Host, etc. — ignored on purpose.
  }

  return { groups: groups.length ? groups : [{ agents: ["*"], rules: [] }], crawlDelayMs };
}

// Find the group(s) that apply to our UA. RFC 9309 §2.2.1: case-insensitive
// substring match on the product token. Most-specific (longest) match wins;
// fall back to '*' if no specific match.
function rulesForAgent(parsed, ua) {
  const uaLower = ua.toLowerCase();
  let best = null;
  let star = null;
  for (const group of parsed.groups) {
    for (const agent of group.agents) {
      if (agent === "*") {
        star = group;
      } else if (uaLower.includes(agent)) {
        if (!best || agent.length > best.agentLen) {
          best = { rules: group.rules, agentLen: agent.length };
        }
      }
    }
  }
  return (best?.rules) ?? (star?.rules) ?? [];
}

// Match a path against a robots pattern. Supports * (any chars) and $ (EOL).
// Empty path = always matches (Disallow: with no value = "do not block",
// per RFC 9309 §2.2.2 — it "indicates that no URLs are disallowed").
function matchPattern(path, pattern) {
  if (pattern === "") return { matches: false, length: 0 };
  // Build regex once per call — patterns are short so this is cheap.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*");
  const anchored = withWildcards.endsWith("\\$")
    ? `^${withWildcards.slice(0, -2)}$`
    : `^${withWildcards}`;
  const re = new RegExp(anchored);
  return { matches: re.test(path), length: pattern.length };
}

// Decide whether a path is allowed. Longest-match precedence between Allow
// and Disallow: if both match, the longer pattern wins (RFC 9309 §2.2.2).
// If lengths tie, Allow wins.
export function isPathAllowed(parsed, ua, pathWithQuery) {
  const rules = rulesForAgent(parsed, ua);
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const rule of rules) {
    const m = matchPattern(pathWithQuery, rule.path);
    if (!m.matches) continue;
    if (rule.type === "allow" && m.length > bestAllow) bestAllow = m.length;
    if (rule.type === "disallow" && m.length > bestDisallow) bestDisallow = m.length;
  }
  if (bestDisallow < 0) return true;
  if (bestAllow < 0) return false;
  return bestAllow >= bestDisallow;
}

export function isAllowed(parsed, ua, url) {
  try {
    const u = new URL(url);
    return isPathAllowed(parsed, ua, u.pathname + u.search);
  } catch {
    return false;
  }
}

// Fetch + cache robots.txt for a host. `fetcher` is injected so tests can
// stub it; production passes the global `fetch`. Always returns a parsed
// rules object — never throws.
export async function getRobots({ host, fetcher = fetch, ua = UA_TOKEN, now = Date.now }) {
  const cached = cache.get(host);
  if (cached && now() - cached.fetchedAt < TTL_MS) return cached.rules;

  let rules = ALLOW_ALL;
  try {
    const res = await fetcher(`https://${host}/robots.txt`, {
      headers: { "User-Agent": ua, Accept: "text/plain,*/*;q=0.1" },
      redirect: "follow",
    });
    if (res.status === 404) {
      rules = ALLOW_ALL;
    } else if (res.ok) {
      const text = await res.text();
      rules = parseRobots(text);
    }
    // 4xx/5xx other than 404 → treat as allow-all per RFC 9309 §2.3.1.4.
  } catch {
    rules = ALLOW_ALL;
  }
  cache.set(host, { rules, fetchedAt: now() });
  return rules;
}

export function _resetCache() {
  cache.clear();
}

export const DEFAULT_UA_TOKEN = UA_TOKEN;
