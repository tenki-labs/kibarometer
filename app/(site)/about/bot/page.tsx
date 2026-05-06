// app/(site)/about/bot/page.tsx — kibarometerbot disclosure.
//
// The User-Agent we send (lib/admin/legacy/media-client.js) embeds this
// URL: "kibarometerbot/1.0 (+https://kibarometer.no/about/bot)". When a
// webmaster pastes that into a browser, this is what they see. Goal:
// answer "what is this and how do I opt out" in under 30 seconds.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About kibarometerbot",
  description:
    "Identification + opt-out for kibarometerbot, the crawler that powers /mediedekning.",
  alternates: { canonical: "/about/bot" },
};

export const revalidate = 86400;

export default function BotPage() {
  return (
    <main className="metode">
      <span className="eyebrow">· kibarometerbot</span>
      <h1 className="title">About kibarometerbot</h1>

      <p>
        <strong>kibarometerbot</strong> is the crawler operated by{" "}
        <a href="https://tenki.no">Tenki Labs</a> for the public AI media
        dashboard at <a href="/mediedekning">kibarometer.no/mediedekning</a>.
        It fetches Norwegian news articles to extract metadata and run
        AI-relevance classification — we never store article body text.
      </p>

      <h2>Identification</h2>
      <ul>
        <li>
          User-Agent:{" "}
          <code>
            kibarometerbot/1.0 (+https://kibarometer.no/about/bot)
          </code>
        </li>
        <li>Source IP: rotates within Tenki&apos;s server pool.</li>
        <li>
          Politeness: ≥1 s between requests per host (configurable per source);
          robots.txt strictly honoured.
        </li>
      </ul>

      <h2>What we store</h2>
      <p>
        We persist <strong>only metadata + derived analysis</strong>: URL,
        headline, publish date, byline, language, OpenGraph image, and our
        own classification output (AI-relevance, category, stance, intensity).
        We never persist the article body, paragraphs, quotes, or excerpts.
      </p>

      <h2>How to opt out</h2>
      <p>
        Add a <code>User-agent: kibarometerbot</code> rule to your{" "}
        <code>/robots.txt</code>. Examples:
      </p>
      <pre>
        <code>{`# Block kibarometerbot from your entire site
User-agent: kibarometerbot
Disallow: /

# Or restrict to a specific path
User-agent: kibarometerbot
Disallow: /private/`}</code>
      </pre>
      <p>
        We re-fetch and respect updated robots.txt within 24 hours. If you
        need an immediate opt-out, email us at{" "}
        <a href="mailto:hello@tenki.no">hello@tenki.no</a> and we&apos;ll add
        the domain to a manual deny-list while your robots.txt change
        propagates.
      </p>

      <h2>Takedowns</h2>
      <p>
        If a specific URL has been removed from your site or you&apos;d like
        a row deleted from our public dashboard, email{" "}
        <a href="mailto:hello@tenki.no">hello@tenki.no</a> with the URL.
        We&apos;ll mark the row deleted within one business day.
      </p>

      <h2>Contact</h2>
      <p>
        Tenki Labs · <a href="mailto:hello@tenki.no">hello@tenki.no</a>
      </p>
    </main>
  );
}
