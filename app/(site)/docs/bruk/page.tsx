// app/(site)/docs/bruk/page.tsx — hidden while the /bruk pillar is offline.
// Restore by reverting this file. See scripts/fetcher-crontab for the
// matching paused refresh cron, and components/site-nav.tsx for the nav
// entry that's also removed.

import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DocsBrukPage() {
  notFound();
}
