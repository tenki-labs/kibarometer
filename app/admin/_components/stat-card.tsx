import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
};

// Stat card pattern from the design: eyebrow label, big number, hint
// underneath. Sits in a 1/2/3-column grid above the page's main content.
export function StatCard({ label, value, hint, className }: StatCardProps) {
  return (
    <Card className={cn("gap-3 p-6", className)}>
      <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="text-4xl font-semibold leading-none tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}
