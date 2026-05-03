import type { Metadata } from "next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/app/admin/_components/submit-button";
import { parseFlash } from "@/lib/admin/flash";
import { loginAction } from "./actions";

export const metadata: Metadata = {
  title: "Logg inn",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const flash = parseFlash(params);

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-16">
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
        kibarometer
      </p>
      <h1 className="mb-6 text-2xl font-medium tracking-tight">Logg inn</h1>

      {flash?.error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{flash.error}</AlertDescription>
        </Alert>
      ) : null}

      <form action={loginAction} className="flex flex-col gap-4" aria-label="Logg inn">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">E-post</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Passord</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        <SubmitButton className="mt-2" pendingLabel="Logger inn…">
          Logg inn
        </SubmitButton>
      </form>
    </main>
  );
}
