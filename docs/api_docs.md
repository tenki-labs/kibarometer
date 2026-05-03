# API-dokumentasjon
OpenAI-kompatibelt LLM-endepunkt drevet av en self-hostet mlx_lm.server på en Mac mini. Caddy validerer bearer-tokens mot Supabase, og en sidecar logger brukstall per token.

## Lastet modell
mlx-community/gemma-3-4b-it-4bit
/Users/einarholt/models/gemma-3-4b-it-4bit
Bruk en av disse strengene som model i request-bodyen.

## Hva som funker
✓ /v1/chat/completions (streaming + ikke-streaming)
✓ /v1/completions
✓ /v1/models
— /v1/embeddings (ikke implementert — Gemma er generativ)
— Funksjonskall / tools (ustabilt på 4B-modeller)

## Autentisering
Hver request krever en bearer-token i Authorization-headeren. Tokens genereres på /admin/api-tokens/new og kan revokes når som helst.

### Header
Authorization: Bearer tnk_<dine 40 tegn>
Tokens lagres aldri i klartekst — kun sha256(token). Hvis du mister tokenen må du generere en ny.

## Eksempler
curl — chat completion
chat-completion.sh
curl https://mlx.tenki.no/v1/chat/completions \
  -H "Authorization: Bearer $TENKI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mlx-community/gemma-3-4b-it-4bit",
    "messages": [
      {"role": "system", "content": "Du er en konsis assistent."},
      {"role": "user", "content": "Hei!"}
    ],
    "max_tokens": 200,
    "temperature": 0.3
  }'
curl — streaming (SSE)
stream.sh
curl -N https://mlx.tenki.no/v1/chat/completions \
  -H "Authorization: Bearer $TENKI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mlx-community/gemma-3-4b-it-4bit",
    "messages": [{"role": "user", "content": "Tell til 10."}],
    "stream": true
  }'
Streamen avsluttes med data: [DONE]. Sidecaren leser den siste chunken med usage-blokken for å attribuere tokens til tokenen din.

Python — OpenAI SDK
example.py
from openai import OpenAI

client = OpenAI(
    base_url="https://mlx.tenki.no/v1",
    api_key="<din tnk_…-token>",
)

resp = client.chat.completions.create(
    model="mlx-community/gemma-3-4b-it-4bit",
    messages=[{"role": "user", "content": "Hei!"}],
    max_tokens=200,
)
print(resp.choices[0].message.content)
TypeScript — Vercel AI SDK
example.ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

const tenki = createOpenAICompatible({
  name: "tenki",
  baseURL: "https://mlx.tenki.no/v1",
  apiKey: process.env.TENKI_API_KEY!,
});

const { text } = await generateText({
  model: tenki.chatModel("mlx-community/gemma-3-4b-it-4bit"),
  prompt: "Hei!",
});
List modeller
list-models.sh
curl https://mlx.tenki.no/v1/models \
  -H "Authorization: Bearer $TENKI_API_KEY"

## Begrensninger og gotchas

Konkurransekapasitet: Mac mini M4 (16 GB) håndterer 1-2 samtidige requests komfortabelt. Tunge agentic-løkker med flere parallel kall vil køes.
Latency: Første token ~1-3 sek (DNS + Cloudflare + tunnel + warmup). Throughput ~30-60 tok/sek på Apple GPU. Et 500-token-svar tar typisk 10-15 sek inkl. nettverk.
Kvalitet: Liten modell — den hallusinerer på smale fakta og er svakere på kode/lang flertrinns-resonnering enn frontier-modeller. Bruk den til oppsummering, klassifisering, ekstraksjon, utkast — ikke kritisk beslutning-støtte uten verifikasjon.
Avhengighet: Macen og Cloudflare-tunnelen må være oppe. 530/520-feil = Macen er offline. Ingen failover.
Privatliv: Alle prompter går gjennom Cloudflare (TLS-terminert), så Mac-en, og logges som tokens-tellere (ikke innhold) i Supabase. Ingen tredjepart har innholdet.


## Feilkoder

Status	Betydning	Hva å gjøre
401	Manglende, ugyldig eller revoked token	Sjekk Authorization-headeren. Gener en ny token hvis nødvendig.
404	Endepunkt finnes ikke	Sjekk path. Kun /v1/* eksponert.
502	mlx_lm.server svarer ikke	Macen kan være under restart. Vent 30 sek og prøv igjen.
520-525	Cloudflare når ikke origin	Tunnelen er nede. Sjekk cloudflared-status på Macen.