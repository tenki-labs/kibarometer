"use client";

// app/(site)/bruk/_components/survey-form.tsx — the survey itself.
//
// Native <form action={...}> with the server action; useState for the two
// conditional-reveal states (Q3/Q4 shown when Q2 ≠ aldri; Q5 shown when Q1 ≠
// privatperson). We deliberately don't use react-hook-form — server-action
// validation is the source of truth, and rhf would add complexity for no win
// on a form this simple.
//
// Honeypot + form-load timestamp are hidden inputs; the server action rejects
// any submit where the honeypot has content or the timestamp is too fresh.

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { submitBrukAction } from "../actions";

export type TaxonomyOption = { slug: string; title: string };

type Props = {
  taxonomyOptions: TaxonomyOption[];
};

const Q2_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "daglig", label: "Hver dag" },
  { value: "ukentlig", label: "Flere ganger i uken" },
  { value: "av-og-til", label: "Av og til (et par ganger i måneden)" },
  {
    value: "proevd-ikke-regelmessig",
    label: "Jeg har prøvd, men bruker det ikke regelmessig",
  },
  { value: "aldri", label: "Aldri" },
];

const Q3_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "chatgpt", label: "ChatGPT (OpenAI)" },
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "copilot", label: "Copilot (Microsoft)" },
  { value: "perplexity", label: "Perplexity" },
  { value: "lokal", label: "Lokal modell (Ollama, LM Studio, e.l.)" },
  { value: "andre", label: "Andre" },
  { value: "vil-ikke-svare", label: "Vil ikke svare" },
];

const Q4_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "skriving", label: "Skriving og tekstredigering" },
  { value: "soek", label: "Søk og research" },
  { value: "oppsummering", label: "Oppsummering" },
  { value: "koding", label: "Programmering / koding" },
  { value: "oversettelse", label: "Oversettelse" },
  { value: "laering", label: "Læring og forklaring" },
  { value: "idemyldring", label: "Idémyldring" },
  { value: "bildegen", label: "Bildegenerering" },
  { value: "dataanalyse", label: "Dataanalyse" },
  { value: "underholdning", label: "Underholdning" },
  { value: "annet", label: "Annet" },
];

const Q5_OPTIONS: Array<{ value: string; label: string }> = [
  {
    value: "sanksjonert",
    label: "Tillatt og sanksjonert (formell policy eller åpen aksept)",
  },
  { value: "tolerert", label: "Uoffisielt tolerert" },
  { value: "uklart", label: "Uklart / ingen policy" },
  { value: "fraraadet", label: "Frarådet eller forbudt" },
  { value: "vet-ikke", label: "Vet ikke / ikke aktuelt" },
];

export function SurveyForm({ taxonomyOptions }: Props) {
  // Track Q1 and Q2 client-side to drive conditional reveal. The server
  // action re-validates these — client state is a UX nicety, not a
  // security boundary.
  //
  // Q1 is two-stage: q1Mode picks 'privatperson' vs 'bransje' (the radio
  // choice); when 'bransje', q1BransjeSlug holds the dropdown's selected
  // taxonomy slug. The actual submitted q1_bransje value (a hidden input
  // below) is derived from both. Earlier design tried to share a single
  // 'q1' state across RadioGroup + select, which broke FormData because
  // Radix RadioGroup only emits a value when one of its Items is checked —
  // picking a bransje from the dropdown left nothing checked and silently
  // dropped q1_bransje from submission.
  type Q1Mode = "" | "privatperson" | "bransje";
  const [q1Mode, setQ1Mode] = React.useState<Q1Mode>("");
  const [q1BransjeSlug, setQ1BransjeSlug] = React.useState<string>("");
  const [q2, setQ2] = React.useState<string>("");
  // Timestamp captured at first render; submit < 2s after this rejects. Use
  // the lazy useState initializer so Date.now() is called once at mount
  // (not on every render — refs can't be read during render in React 19).
  const [formLoadedAt] = React.useState(() => Date.now());

  const usesAi = q2 !== "" && q2 !== "aldri";
  const isProfessional = q1Mode === "bransje";
  // Derived value posted in the q1_bransje hidden input. Server zod
  // validation rejects empty string.
  const q1Submission =
    q1Mode === "privatperson"
      ? "privatperson"
      : q1Mode === "bransje"
        ? q1BransjeSlug
        : "";

  return (
    <form
      action={submitBrukAction}
      className="flex flex-col gap-8 rounded-lg border border-border bg-card p-6 sm:p-8"
    >
      {/* honeypot — bots fill all fields */}
      <input
        type="text"
        name="favoritfarge"
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px" }}
        aria-hidden="true"
      />
      <input
        type="hidden"
        name="formLoadedAt"
        value={formLoadedAt}
      />
      {/* Hidden input is the single source of truth for q1_bransje on submit.
          Derived from q1Mode + q1BransjeSlug above. */}
      <input type="hidden" name="q1_bransje" value={q1Submission} />

      {/* Q1 — bransje */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-medium">
          Hva representerer du?
        </legend>
        <RadioGroup
          value={q1Mode}
          onValueChange={(v) => {
            setQ1Mode(v as Q1Mode);
            if (v === "privatperson") {
              // Clear any stray bransje slug when user switches back.
              setQ1BransjeSlug("");
            }
          }}
          required
        >
          <Label className="flex items-center gap-3 font-normal">
            <RadioGroupItem value="privatperson" />
            <span>Privatperson — ikke jobb-relatert</span>
          </Label>
          <Label className="flex items-center gap-3 font-normal">
            <RadioGroupItem value="bransje" />
            <span>Jeg representerer min bransje</span>
          </Label>
        </RadioGroup>

        {q1Mode === "bransje" ? (
          <div className="ml-7 mt-1 flex flex-col gap-1">
            <Label htmlFor="bruk-q1-bransje-select" className="sr-only">
              Velg bransje
            </Label>
            <select
              id="bruk-q1-bransje-select"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={q1BransjeSlug}
              onChange={(e) => setQ1BransjeSlug(e.target.value)}
              required
            >
              <option value="" disabled>
                Velg bransje…
              </option>
              {taxonomyOptions.map((opt) => (
                <option key={opt.slug} value={opt.slug}>
                  {opt.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </fieldset>

      {/* Q2 — frequency */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-medium">
          Hvor ofte bruker du AI-verktøy?
        </legend>
        <RadioGroup
          name="q2_frequency"
          value={q2}
          onValueChange={setQ2}
          required
        >
          {Q2_OPTIONS.map((opt) => (
            <Label
              key={opt.value}
              className="flex items-center gap-3 font-normal"
            >
              <RadioGroupItem value={opt.value} />
              <span>{opt.label}</span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      {/* Q3 — tools (conditional) */}
      {usesAi ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-medium">
            Hvilke AI-verktøy bruker du?
          </legend>
          <p className="text-xs text-muted-foreground">
            Velg alle som passer.
          </p>
          <div className="grid gap-2">
            {Q3_OPTIONS.map((opt) => (
              <Label
                key={opt.value}
                className="flex items-center gap-3 font-normal"
              >
                <Checkbox name="q3_tools" value={opt.value} />
                <span>{opt.label}</span>
              </Label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {/* Q4 — use cases (conditional) */}
      {usesAi ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-medium">
            Hva bruker du AI til?
          </legend>
          <p className="text-xs text-muted-foreground">
            Velg alle som passer.
          </p>
          <div className="grid gap-2">
            {Q4_OPTIONS.map((opt) => (
              <Label
                key={opt.value}
                className="flex items-center gap-3 font-normal"
              >
                <Checkbox name="q4_use_cases" value={opt.value} />
                <span>{opt.label}</span>
              </Label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {/* Q5 — workplace policy (conditional) */}
      {isProfessional ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-medium">
            Hvordan stiller arbeidsplassen din seg til AI-bruk?
          </legend>
          <RadioGroup name="q5_workplace_policy" required>
            {Q5_OPTIONS.map((opt) => (
              <Label
                key={opt.value}
                className="flex items-center gap-3 font-normal"
              >
                <RadioGroupItem value={opt.value} />
                <span>{opt.label}</span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}

      {/* Email */}
      <fieldset className="flex flex-col gap-3">
        <Label htmlFor="bruk-email" className="text-base font-medium">
          E-postadresse
        </Label>
        <p className="text-xs text-muted-foreground">
          Vi sender deg en bekreftelseslenke. E-postadressen lagres for å
          bekrefte registreringen og for å gi deg en lenke for å slette
          svarene dine senere, men vises aldri offentlig.
        </p>
        <Input
          id="bruk-email"
          type="email"
          name="email"
          placeholder="din@e-post.no"
          required
          autoComplete="email"
        />
      </fieldset>

      <Button type="submit" size="lg" className="self-start">
        Send inn og bekreft via e-post
      </Button>
    </form>
  );
}
