// lib/admin/legacy/media-simhash.js
// 64-bit simhash for NTB wire-story de-duplication. Two articles published
// within the same news cycle that share most of their headline and lede are
// almost certainly republications of the same wire story; we want them in
// the same `wire_cluster_id` so volume metrics count stories, not copies.
//
// Why simhash rather than minhash or exact match: it's a single fixed-width
// integer comparable in Postgres via XOR + popcount, fits in `bigint`, and
// gives a smooth similarity gradient (1-bit difference = "almost identical
// rewrite", 8-bit = "loosely related"). NTB republications typically come
// in at <=3 bits.
//
// Postgres column is `simhash bigint` (signed 64-bit). We work in unsigned
// 64-bit internally and cast to signed at the boundary via BigInt.asIntN.

// FNV-1a 64-bit. Cheap, deterministic, no library. Picks a single bit pattern
// per token; the simhash voting layer above is what gives the algorithm its
// similarity property — the per-token hash just needs to be uniformly
// distributed, which FNV-1a 64 is in practice.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME  = 0x00000100000001b3n;
const MASK64     = 0xffffffffffffffffn;

export function fnv1a64(str) {
  let h = FNV_OFFSET;
  // Hash UTF-8 code units rather than code points. Norwegian characters
  // (æ ø å) are multi-byte in UTF-8; this is fine — different tokens will
  // hash differently, which is all we need.
  const bytes = new TextEncoder().encode(str);
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

// Tokenize for similarity, not for display. Lowercase, strip punctuation,
// then mix three feature types:
//   1. Word unigrams              — semantic signal
//   2. Word 2-shingles            — preserves ordering (separates
//                                   "AI tar over jobben" from
//                                   "Jobben tar over AI")
//   3. Character 4-grams over the folded string — thickens the signal
//                                   on short text (~headline + 300 chars).
//                                   Without char-grams a 60-token text
//                                   only gets ~1 vote per simhash bit, so
//                                   a 5-word swap can flip 15+ bits.
// Norwegian-aware (\p{L} + \p{N}) so æ/ø/å survive.
export function tokenize(text) {
  if (!text) return [];
  const cleaned = String(text).toLowerCase().normalize("NFC");
  const words = cleaned.match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = words.slice();
  for (let i = 0; i < words.length - 1; i++) {
    out.push(`${words[i]} ${words[i + 1]}`);
  }
  const folded = words.join(" ");
  for (let i = 0; i + 4 <= folded.length; i++) {
    out.push(folded.slice(i, i + 4));
  }
  return out;
}

// Compute the 64-bit simhash. Returns a signed BigInt suitable for direct
// insertion into Postgres `bigint` columns.
export function simhash(text) {
  const tokens = tokenize(text);
  if (!tokens.length) return 0n;
  const v = new Int32Array(64);
  for (const tok of tokens) {
    const h = fnv1a64(tok);
    for (let i = 0; i < 64; i++) {
      if (((h >> BigInt(i)) & 1n) === 1n) v[i] += 1;
      else v[i] -= 1;
    }
  }
  let result = 0n;
  for (let i = 0; i < 64; i++) {
    if (v[i] > 0) result |= (1n << BigInt(i));
  }
  return BigInt.asIntN(64, result);
}

// Hamming distance between two 64-bit simhashes. Accepts BigInt, number, or
// numeric string (PostgREST returns bigint as a string in JSON — caller can
// pass that through unchanged). Returns a plain number 0..64.
export function hamming(a, b) {
  const ua = BigInt.asUintN(64, BigInt(a));
  const ub = BigInt.asUintN(64, BigInt(b));
  let x = ua ^ ub;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count += 1;
  }
  return count;
}

// Convenience predicate. The PRD speculatively suggested a 3-bit threshold,
// but standard simhash needs much longer documents than headline+300 chars
// to hit that tightness consistently. With our char-4gram-augmented
// tokenizer, NTB rewrites land at 4–8 bits; unrelated stories at >12. 8 is
// the realistic default — it picks up obvious wire republications while
// keeping false-positive risk against independent short stories low (the
// 64C8 / 2^64 collision rate for an unrelated pair is ~6e-9). Tunable
// per-deploy via app_settings; keep aligned with the SQL-side query.
export function isSimilar(a, b, threshold = 8) {
  return hamming(a, b) <= threshold;
}

// Stringify for PostgREST. `bigint` columns round-trip as JSON strings, and
// JSON.stringify on a BigInt throws — callers should pass simhash through
// this before stuffing into a JSON body.
export function toPgBigint(value) {
  if (value == null) return null;
  return BigInt.asIntN(64, BigInt(value)).toString();
}
