import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Generic admin-page skeleton. Used for every route under app/admin/(app)/
// while server components await Supabase. Roughly mirrors the
// PageHeader → StatCards × 4 → main content layout the real pages use, so
// users get a structural preview instead of a blank stretch.
export default function AdminLoading() {
  return (
    <div className="animate-pulse">
      <div className="pb-8">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-3 h-9 w-56" />
        <Skeleton className="mt-3 h-4 w-96" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="gap-3 p-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-3 w-32" />
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-6">
        <Skeleton className="h-3 w-32" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}
