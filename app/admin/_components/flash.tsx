import { Alert, AlertDescription } from "@/components/ui/alert";
import { parseFlash } from "@/lib/admin/flash";

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

// Renders ?flash_ok=… / ?flash_error=… as a shadcn Alert. Pages opt in by
// awaiting `searchParams` themselves and forwarding it here — Next 16
// `searchParams` is a Promise per page, so layouts can't read it directly.
export function Flash({ searchParams }: Props) {
  const flash = parseFlash(searchParams);
  if (!flash) return null;
  if (flash.ok) {
    return (
      <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <AlertDescription>{flash.ok}</AlertDescription>
      </Alert>
    );
  }
  if (flash.error) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertDescription>{flash.error}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
