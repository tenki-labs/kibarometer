import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

// Eyebrow + h1 + subtitle + optional right-aligned action — the lockup
// every admin page uses just under the top header.
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 pb-8",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-2 text-4xl font-semibold leading-[1.1] tracking-tight">
          {title}
        </h1>
        {description ? (
          <div className="mt-2 flex max-w-2xl flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
