// app/(site)/_components/pillar-hero.tsx — shared top segment for
// /arbeidsmarked, /media, /oppstart. Sits inside snap-segment 1 of each
// pillar dashboard. The cinematic snap-scroll between segments serves
// as the page's TOC; no in-hero list is needed.

import Link from "next/link";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type PillarHeroStat = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
};

type Props = {
  breadcrumb: string;
  title: string;
  description: string;
  big: {
    value: React.ReactNode;
    caption: React.ReactNode;
  };
  stats: PillarHeroStat[];
  footer?: React.ReactNode;
};

export function PillarHero({
  breadcrumb,
  title,
  description,
  big,
  stats,
  footer,
}: Props) {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center gap-8 px-4 py-10 sm:gap-10 sm:px-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Hjem</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{breadcrumb}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="max-w-3xl text-4xl font-medium leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        <p className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
          {description}
        </p>
      </div>

      <div>
        <div className="text-6xl font-medium leading-none tabular-nums tracking-tight sm:text-7xl">
          {big.value}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{big.caption}</p>
      </div>

      {stats.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
          {stats.map((s, i) => (
            <PillarStat key={i} {...s} />
          ))}
        </div>
      ) : null}

      {footer ? (
        <div className="text-sm text-muted-foreground">{footer}</div>
      ) : null}
    </div>
  );
}

function PillarStat({ label, value, hint }: PillarHeroStat) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-medium leading-tight tabular-nums sm:text-3xl">
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function PillarHeroEmpty({
  breadcrumb,
  message,
}: {
  breadcrumb: string;
  message: string;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center gap-8 px-4 py-10 sm:px-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Hjem</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{breadcrumb}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <p className="text-base text-muted-foreground">{message}</p>
    </div>
  );
}
