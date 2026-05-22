// lib/email/disposable-domains.ts — minimal blocklist of throwaway/temporary
// email domains. Not exhaustive (Spamhaus replicas are out of scope); the
// magic-link confirmation already filters most disposable traffic because
// most temp-mail inboxes don't render the link.
//
// Update sparingly. If a domain genuinely belongs to real users, take it off.

const DISPOSABLE_DOMAINS = new Set<string>([
  // Mailinator family
  "mailinator.com",
  "mailinator.net",
  "mailinator.org",
  // Guerrilla
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamail.biz",
  "guerrillamail.de",
  "grr.la",
  "sharklasers.com",
  // 10minutemail family
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "30minutemail.com",
  // Temp-mail family
  "temp-mail.org",
  "temp-mail.io",
  "tempmail.com",
  "tempmail.net",
  "tempmail.dev",
  "tempmailo.com",
  "tempr.email",
  // Throwaway
  "yopmail.com",
  "yopmail.net",
  "yopmail.fr",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.io",
  "getairmail.com",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "mintemail.com",
  "fakeinbox.com",
  // Misc
  "mohmal.com",
  "maildrop.cc",
  "moakt.com",
  "emailondeck.com",
  "spambox.us",
  "spamgourmet.com",
  "harakirimail.com",
  "tempinbox.com",
  "burnermail.io",
  "anonbox.net",
  "instantemailaddress.com",
  "fakemailgenerator.com",
  "tempsky.com",
  "mailcatch.com",
  "33mail.com",
]);

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Also block obvious sub-domains of blocked roots (e.g., x.mailinator.com).
  for (const blocked of DISPOSABLE_DOMAINS) {
    if (domain.endsWith("." + blocked)) return true;
  }
  return false;
}
