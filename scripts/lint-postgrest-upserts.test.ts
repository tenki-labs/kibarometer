// scripts/lint-postgrest-upserts.test.ts
// Smoke tests for scripts/lint-postgrest-upserts.mjs.
// Spawns the linter against synthetic source-trees on disk and asserts
// exit code + stderr content. Kept as a vitest spec so it runs under
// `pnpm test` alongside the rest of the suite.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("./lint-postgrest-upserts.mjs", import.meta.url),
);

function makeFixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "lint-postgrest-"));
  mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

function runLint(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
}

describe("lint-postgrest-upserts", () => {
  it("fails when a retag-shape upsert omits a NOT-NULL-no-default column", () => {
    const dir = makeFixture({
      "supabase/migrations/0001_things.sql": `
        create table if not exists public.things (
          id bigint primary key,
          tittel text not null,
          flag boolean not null default false
        );
      `,
      "lib/retag.js": `
        export async function retag(sb) {
          const rows = await sb("/things?select=id,tittel&limit=100", { service: true });
          const patch = rows.map((r) => ({
            id: r.id,
            flag: true,
          }));
          await sb("/things?on_conflict=id", {
            service: true,
            method: "POST",
            body: patch,
            prefer: "return=minimal,resolution=merge-duplicates",
          });
        }
      `,
    });
    try {
      const r = runLint(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing NOT-NULL-no-default column\(s\): tittel/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when the body includes every NOT-NULL-no-default column", () => {
    const dir = makeFixture({
      "supabase/migrations/0001_things.sql": `
        create table if not exists public.things (
          id bigint primary key,
          tittel text not null,
          flag boolean not null default false
        );
      `,
      "lib/retag.js": `
        export async function retag(sb) {
          const rows = await sb("/things?select=id,tittel&limit=100", { service: true });
          const patch = rows.map((r) => ({
            id: r.id,
            tittel: r.tittel,
            flag: true,
          }));
          await sb("/things?on_conflict=id", {
            service: true,
            method: "POST",
            body: patch,
            prefer: "return=minimal,resolution=merge-duplicates",
          });
        }
      `,
    });
    try {
      const r = runLint(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/ok: 1 POST upsert call site/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats generated columns as 'has default' (skips them)", () => {
    const dir = makeFixture({
      "supabase/migrations/0001_things.sql": `
        create table if not exists public.things (
          id bigint primary key,
          a boolean not null default false,
          b boolean not null default false,
          ab boolean generated always as (a or b) stored
        );
      `,
      "lib/up.js": `
        export async function up(sb) {
          await sb("/things?on_conflict=id", {
            service: true,
            method: "POST",
            body: [{ id: 1 }],
            prefer: "return=minimal,resolution=merge-duplicates",
          });
        }
      `,
    });
    try {
      const r = runLint(dir);
      expect(r.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores POST upserts that use ignore-duplicates", () => {
    // ignore-duplicates is a true insert-or-skip path. A body missing a
    // NOT NULL column there is a different (and more obvious) bug class,
    // not the retag-shape defect this lint guards against.
    const dir = makeFixture({
      "supabase/migrations/0001_q.sql": `
        create table if not exists public.q (
          id bigint primary key,
          tittel text not null
        );
      `,
      "lib/enq.js": `
        export async function enq(sb) {
          await sb("/q?on_conflict=id", {
            service: true,
            method: "POST",
            body: [{ id: 1 }],
            prefer: "return=minimal,resolution=ignore-duplicates",
          });
        }
      `,
    });
    try {
      const r = runLint(dir);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/ok: 0 POST upsert call site/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles block-body arrow with return literal", () => {
    const dir = makeFixture({
      "supabase/migrations/0001_things.sql": `
        create table if not exists public.things (
          id bigint primary key,
          tittel text not null
        );
      `,
      "lib/retag.js": `
        export async function retag(sb, rows) {
          // PostgREST's edge case: apostrophes in comments must not poison the scanner.
          const patch = rows.map((r) => {
            if (!r) return null;
            return {
              id: r.id,
            };
          }).filter(Boolean);
          await sb("/things?on_conflict=id", {
            service: true,
            method: "POST",
            body: patch,
            prefer: "return=minimal,resolution=merge-duplicates",
          });
        }
      `,
    });
    try {
      const r = runLint(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing NOT-NULL-no-default column\(s\): tittel/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects ALTER TABLE … SET NOT NULL / DROP NOT NULL / SET DEFAULT", () => {
    const dir = makeFixture({
      "supabase/migrations/0001_things.sql": `
        create table if not exists public.things (
          id bigint primary key,
          tittel text
        );
      `,
      "supabase/migrations/0002_alter.sql": `
        alter table public.things alter column tittel set not null;
      `,
      "lib/up.js": `
        export async function up(sb) {
          await sb("/things?on_conflict=id", {
            service: true,
            method: "POST",
            body: [{ id: 1 }],
            prefer: "return=minimal,resolution=merge-duplicates",
          });
        }
      `,
    });
    try {
      const r = runLint(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/missing NOT-NULL-no-default column\(s\): tittel/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
