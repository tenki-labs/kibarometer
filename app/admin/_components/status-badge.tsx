import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  running: "Kjører",
  success: "OK",
  failed: "Feilet",
};

const STATUS_DOT: Record<string, string> = {
  success: "bg-emerald-500",
  failed: "bg-rose-500",
  running: "bg-amber-500",
};

type StatusBadgeProps = { status: string };

// Tonal pill: outline badge with a small colored dot. Subtler than fully
// filled variants and reads at small sizes without screaming.
export function StatusBadge({ status }: StatusBadgeProps) {
  const label = STATUS_LABEL[status] ?? status;
  const dot = STATUS_DOT[status] ?? "bg-muted-foreground";
  return (
    <Badge
      variant="outline"
      className="gap-1.5 font-normal"
      aria-label={`Status: ${label}`}
    >
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      <span>{label}</span>
    </Badge>
  );
}
