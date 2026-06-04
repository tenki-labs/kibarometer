// lib/admin/mlx-error.ts — MlxError + kind taxonomy, split out of mlx.ts.
//
// Lives in its own module (with no `server-only` import) so failure-
// classification helpers — and their unit tests — can import the error type
// without pulling in mlx.ts's server-only guard, which throws under vitest.
// mlx.ts re-exports these, so existing `import { MlxError } from "./mlx"`
// call sites are unaffected.

export type MlxErrorKind = "auth" | "unreachable" | "parse" | "http" | "config";

export class MlxError extends Error {
  kind: MlxErrorKind;
  status?: number;
  body?: string;
  constructor(
    kind: MlxErrorKind,
    message: string,
    status?: number,
    body?: string,
  ) {
    super(message);
    this.name = "MlxError";
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}
