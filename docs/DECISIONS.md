# DECISIONS

Append as decisions come up. Each entry: the decision, alternatives considered, why this one, and what
would make us revisit it.

---

### D0 — Preserve the original brief before rewriting `CLAUDE.md`
Copied `claude.md` to `docs/ORIGINAL_BRIEF.md` first.
*Alternatives:* write `CLAUDE.md` directly (would have silently destroyed the brief, since Windows
treats the two names as one file); prepend the brief inside the new `CLAUDE.md` (makes the
resume-cold file long and mixes two purposes).
*Revisit if:* never.

### D1 — No ES modules; split files loaded as classic scripts under one `App` namespace
*Alternatives:* (a) true ES modules — breaks the `file://` double-click requirement, Chrome blocks
module scripts from origin `null`; (b) one self-contained `index.html` — works on `file://` but
produces a single ~2000-line file that is painful to edit and review.
*Why:* this is the only option that satisfies "no build step", "opens by double click" and
"one concern per file" at once. Each file is an IIFE hanging one object off a global `App`.
*Revisit if:* you decide the app will always be served (even `python -m http.server`), in which case
real ES modules become free and we should switch.

### D2 — The extraction prompt is a JS constant in `js/prompt.js`, mirrored in `prompts/extraction.md`
*Alternatives:* load `prompts/extraction.md` at runtime with `fetch()` — blocked by CORS on `file://`,
so it would break the double-click requirement; inline the prompt in `openrouter.js` — mixes prompt
and logic, which the task explicitly forbids.
*Why:* the prompt stays editable in one obvious place without touching app logic, and the markdown
mirror stays readable for non-programmers.
*Revisit if:* we move to a served-only deployment, or when document types move into md files parsed at
runtime the way `main project documentation` describes.

### D3 — Default model `qwen/qwen3-vl-30b-a3b-instruct`, last choice remembered in localStorage
*Alternatives:* default to the 235B (best quality, ~3× the output cost) or the 8B (cheapest, but the
8B is the one most likely to fail on the handwritten samples).
*Why:* the task asks for the 30B as default, and it is also the cheapest of the three per input token.
*Revisit if:* `docs/EXTRACTION_TESTS.md` shows the 30B failing on handwriting where the 235B succeeds.

### D4 — Image pipeline: longest side ≤ 2000 px, JPEG q0.85, payload size displayed; 90 s timeout
*Alternatives:* send the original file untouched (large payloads, slower, more expensive); downscale
harder (risks losing handwriting detail).
*Why:* the task specifies it, and 2000 px is roughly 150 dpi on A4, enough for handwriting.
*Revisit if:* extraction tests show detail loss on small handwritten digits such as the PESEL.

### D5 — The three Qwen3-VL models go in the dropdown; GLM is pending open question 1
*Why:* all three Qwen3-VL slugs were confirmed live today and all three support strict structured
outputs, which the 24-key contract depends on. The GLM vision models (`z-ai/glm-4.6v`,
`z-ai/glm-5v-turbo`) accept images but support only loose `response_format`, so they would always take
the defensive-parse fallback path.
*Revisit if:* Oscar wants a cross-family baseline anyway.

### D6 — API key in localStorage, entered through a settings dialog, with a "clear key" button
*Alternatives:* a backend proxy holding the key (correct for a hosted multi-operator deployment,
but out of scope for iteration 1 and needs a server); a key typed per session (annoying).
*Why:* iteration 1 is assumed local-only. The trade-off, stated plainly: a key in the browser is
readable by anyone with access to that machine's browser profile or devtools, cannot be scoped per
operator, and cannot be revoked individually — one shared key gets rotated for everyone.
*Revisit if:* the answer to open question 2 is "hosted for several operators". Then the key must move
behind a proxy before anything ships, and only `js/openrouter.js` changes.

### D7 — The live key found in `txt` is gitignored and should be rotated
*Why:* it sits in plaintext in the project folder. It was not sent anywhere and not copied into any
source file, but it is now in the folder's history on disk and in any backup of the Desktop.
*Revisit if:* never — rotate it.

### D8 — Per-field state wrapper `{ value }` from day one
*Alternatives:* a flat `{ key: "value" }` state, flattened only at export.
*Why:* iteration 2 adds `confidence`, `status`, `source_bbox`. Wrapping now means the form renderer's
contract never changes. Export flattens the wrappers back to the 24-key contract.
*Revisit if:* confidence scoring is cancelled.

### D9 — One retry on structurally invalid JSON
*Why:* `main project documentation` section 7.2 asks for exactly this (re-ask the model, emphasising
the structure error). It is a few lines and it converts a hard failure into a usually-successful
second attempt. Not a validation feature, so it does not break the "no validation yet" rule.
*Revisit if:* retries turn out to mask a prompt problem we should be fixing instead.

---

## Decisions from Oscar's answers, 2026-11-13

### D10 — Qwen only; no GLM in the dropdown
Oscar: *"Quewn as said."* The three Qwen3-VL slugs ship; GLM is not added.
*Revisit if:* a cross-family baseline is wanted. `z-ai/glm-4.6v` would need `structured: false`,
which exercises the plain-JSON fallback path that is currently never used.

### D11 — `EMPTY_VALUE = "not found"` instead of `""`
Oscar: *"if they dont find anything just put, not found."* One constant in `js/config.js` controls
every string field.
*Alternatives:* `""` as the original brief specified; `null` (explicitly ruled out by the brief).
*Why:* it is what Oscar asked for, and it distinguishes "the model looked and found nothing" from
"the operator cleared the box". **Flagged:** it contradicts the brief's own rule 4
(*never "N/A"*), and `"not found"` is functionally an `"N/A"`. Any consumer of this JSON must now
treat the literal string `"not found"` as a null sentinel — including when a document legitimately
contains that text. One-line revert.
*Revisit if:* downstream code has to special-case the sentinel, or the manager's contract wins.

### D12 — Hosted deployment acknowledged; key still browser-side for iteration 1
Oscar: *"this will be uploaded into a server to be used."*
*Why:* the task forbids hardcoding the key, so each operator enters their own in the settings
dialog and it stays in their own browser's localStorage. Nothing secret is served by the host.
**But:** a browser-held key cannot be scoped per operator or revoked individually, and anyone with
devtools access can read it. **Recommendation on record: move the key behind a backend proxy
before more than one or two trusted operators use this.** The change is confined to
`js/openrouter.js` — see `ARCHITECTURE.md`, "Moving the key behind a proxy".
*Revisit if:* before go-live. This one should not stay as it is.

### D13 — Multi-page and multi-file: several inputs, one record
Oscar: *"i guess multipage that is cheper."* All pages are sent as separate `image_url` parts in a
single request; the model is instructed (rule 10) to merge them into one record. Several separate
image files are treated the same way, as pages of one document — this is also what
`main project documentation` requires. Capped at `LIMITS.maxPages` (8).
*Revisit if:* documents routinely exceed 8 pages, or if per-page records are ever wanted.

### D14 — Export stays exactly 24 keys; extra data lives beside it
Oscar: *"no dont discrad them… lets not alter what they want."* The model returns
`{ record, extra }`; only `record` is exported, in `EXPORT_ORDER`. The six extra fields render in
their own collapsible panel with their own copy button.
*Alternatives:* merge extras into the export (breaks the manager's contract); discard them
(Oscar said no).
*Why:* satisfies both instructions without compromising either.
*Revisit if:* the manager widens the contract.

### D15 — `exportRecord()` is the single export seam
Oscar: *"didnt quiete understadn but yeah sure."* Copy and Download both call one function, also
exposed as `App.exportRecord`. Adding a `POST` to a database later is a one-line change there.

### D16 — Pre-processing ships as an off-by-default toggle
Oscar: *"yeah sure."* Greyscale + 0.5 %-clipped contrast stretch in `js/image.js`, remembered in
localStorage. Off by default so the A/B comparison in `EXTRACTION_TESTS.md` stays meaningful.
*Revisit if:* testing shows it reliably helps handwriting — then flip the default.

### D17 — Flat 24-key contract, not the nested shape in `main project documentation`
Oscar did not answer this one (his numbering skipped it). Built flat, as recommended in
`PLAN.md` §10 Q6, on the assumption that the nested `{status, message, content}` +
`personalData.firstName.value` shape is a later backend concern. **Still needs confirmation.**
*Revisit if:* Oscar says the backend shape governs iteration 1 — it would change `state.js`
export only.

### D28 — Default model is now the 235B (supersedes D18)
Oscar, 2026-11-13, once he saw every confidence bar come back identical.
*Why:* two independent reasons, not one. Accuracy: 143/143 against the 30B's 134/143. And
**confidence only varies on the 235B** — the 30B emits a flat 0.95 for all 24 fields, which makes
the entire review screen inert: nothing is ever flagged by confidence, the bars are all the same
length, and the thresholds never fire. The feature the manager asked for does not function on the
30B at all.
*Cost:* about $0.0018 per document instead of $0.0009, and noticeably slower (measured up to 134 s
on a dense handwritten page, which is why the timeout is 240 s).
*Also:* `STORAGE_KEYS.model` was bumped to `dococr.model.v2`. A remembered choice overrides the
default, so without the bump every existing operator would have silently stayed on the 30B and
concluded the confidence feature was broken.
*Revisit if:* throughput or cost becomes the binding constraint, or a cheaper model starts
returning a real confidence spread.

### D18 — (superseded by D28) Default model stays the 30B, against the test evidence
The 235B scored 143/143 on the samples; the 30B 134/143. The brief specifies the 30B as default,
so the default is the 30B and the recommendation is documented in `README.md` and
`EXTRACTION_TESTS.md` instead of applied unilaterally.
*Revisit if:* Oscar approves the one-line change to `DEFAULT_MODEL_ID`.

### D19 — Do not name forbidden values in the prompt
Discovered the hard way. Listing `"0000000000"` and `"1234567890"` as values never to emit caused
the 30B to emit `1234567890`. Prompt rules describe the behaviour wanted, never the token feared.
*Revisit if:* never. Recorded in `PROMPTING.md` as a tuning rule.

### D20 — Polish interface, English field names; runtime strings centralised in `js/i18n.js`
Manager via Oscar, 2026-11-13: *"whole interface should be in polish, while field names (in code) —
not labels — and json persist in english."*
*What changed:* `index.html` markup, `FIELD_DEFS`/`EXTRA_DEFS` `label` and `group`, and every
runtime string (counts, warnings, API errors, key status) now Polish. `key`, `EXPORT_ORDER`, code,
comments, docs, the extraction prompt and every `schemaDesc` stay English. `EMPTY_VALUE` stays the
English `"not found"` because it is exported data, not interface.
*Alternatives:* scatter the Polish strings inline where they are used (quick, but then "change this
wording" means grepping eight files, and a second language is impossible); full data-i18n attribute
system over the HTML (heavier than one language justifies).
*Why this one:* the field config already separated `key` from `label`, so the split the manager
asked for was the one the code already had. Runtime strings move into one `App.T` object, so there
are exactly three places Polish can live and each has an obvious owner.
*Also:* Polish plurals need three forms, so `App.T.plural(n, one, few, many)` exists and the
`n === 1 ? a : b` pattern is banned — it produces "2 plików" style errors.
*Revisit if:* a second language is wanted. Then `index.html`'s static strings move into `T` too and
`T` becomes one entry in a language map.

---

## Iteration 2 — confidence and review, 2026-11-13

### D21 — Confidence is self-reported by the model, because nothing better exists
Manager: each field should return a confidence 0-1. Three sources were measured before choosing:
*Alternatives:* (a) **token logprobs** — the honest source. OpenRouter advertises `logprobs` for
these models, but DeepInfra silently drops them and Novita returns 193 entries for 535 completion
tokens with a garbled reconstruction (`"Robotnic"`, `"powyże 3,"`). Unusable, and not something we
can fix from the client. (b) **self-reported, 30B** — returns a flat `0.95` for all 24 fields,
including a field it got wrong. Zero information. (c) **self-reported, 235B** — ranks correctly
(lowest scores landed on `harmful_factors`, `patient_street_name`, `name_position`) but compresses
into 0.85-1.00 with about three distinct values.
*Why:* (c) is the only one carrying signal. The prompt now explicitly says "USE THE WHOLE RANGE",
which widened the spread from 0.05 to 0.15.
*Revisit if:* a provider returns trustworthy logprobs. Then confidence becomes real and the
thresholds get recalibrated against actual probabilities.

### D22 — Deterministic validation, not confidence, is the primary error detector
*Why:* confidence is weak; checksums are not. PESEL and NIP checksums, REGON, date sanity,
birthdate-vs-PESEL agreement, postal and phone formats, and the `noPesel`/`noNip` cross-checks are
arithmetic and are right every time. The errors in the manager's mockup — "Błędna suma kontrolna
PESEL" and the repair suggestions — all come from validation, not from the confidence number.
*Consequence:* the review screen is useful even on the 30B, where confidence is worthless.

### D23 — A degenerate confidence spread disables confidence-based triage
When every field returns the same number (spread < `THRESHOLDS.flatSpreadEpsilon`), the app stops
using confidence entirely, triages on validation and emptiness alone, and shows the operator a
banner saying so.
*Alternatives:* show the flat number as if it meant something (dishonest, and it would paint 24
fields the same colour); always flag everything (useless).
*Why:* a progress bar built on a constant is theatre. Better to say the signal is missing and
point at the model that does provide one.

### D24 — The 24-key contract is unchanged; the audit trail is a separate export
The reference prototype's JSON puts `{value, ai_value, confidence, review, validation}` on every
field, which would break the agreed contract. Instead: **"Pobierz JSON" is byte-identical to
iteration 1** — 24 English keys, same order. "Kopiuj przegląd" produces a superset containing
`record` (that same object), plus per-field confidence, the operator's decision, validation level
and the cross-checks.
*Why:* the manager asked for review features, not for a different contract. Same reasoning as D14.
*Revisit if:* the manager confirms the downstream consumer wants the review envelope.

### D25 — Field metadata lives in `FIELD_FLAGS`, not scattered through `FIELD_DEFS`
`critical`, `optional`, `mono`, `quick` and `choice` are declared as one block keyed by field name
and merged onto the defs at load.
*Why:* `FIELD_DEFS` stays a readable table of what each field *is*; review behaviour is a separate
concern listed in one place. Adding "this field is critical" is a one-word edit.

### D26 — Thresholds: critical 0.99, high 0.98, low 0.95
*Why:* these are calibrated to what the models actually emit (0.85-1.00), not to the 0-1 scale the
mockup implies. On the sample set this flags the long handwritten `harmful_factors` and leaves
crisp printed fields alone.
*Revisit if:* operators report too much or too little gets flagged — it is one constant in
`js/config.js`, and these have only been tuned against five documents.

### D27 — Timeout raised 90 s → 240 s, max_tokens 4096 → 6000
*Why:* measured. The 235B took 134 s on the densest handwritten page with the three-part schema,
and the response is now roughly 1.5x longer. The old limits were cutting off real work.

### D29 — Confidence is measured by two-model agreement, not self-reported
Oscar, 2026-11-13, after seeing every bar read 95% on the 235B too.
*Problem:* self-reported confidence is flat on every model, unstable between identical runs, and
assigns 0.95 to fields the model got wrong. Token logprobs are unusable (D21).
*Decision:* the primary model reads the page, a second cheaper model reads it independently, and
each field's confidence is how closely the two readings agree (`js/agreement.js`).
*Evidence:* on the handwritten sample this scored `patient_street_name` 0.70 — the one field the
30B actually misread (`Górnica` vs `Górnicza`) — `harmful_factors` 0.90, and the other 22 at 1.00.
In the browser it then caught `Hutnica 24` vs `ul. Hutnicza 24` at 0.59, a real 235B error.
*Why it works:* a model cannot introspect its certainty, but it cannot fake its behaviour either.
Genuinely ambiguous glyphs get read differently by different models.
*Also:* when the two disagree the second reading is offered as a one-click suggestion, which is the
most actionable hint on the screen.
*Revisit if:* trustworthy logprobs appear, or a single model starts producing a real spread.

### D30 — The two passes run in parallel, and verification asks for `record` only
*Why:* the reads are independent, so running them sequentially made the operator wait for the sum.
Measured: the full three-part schema costs the 30B 46.5 s, the record-only schema 16.8 s — the
confidence and extra blocks were most of its output. Since the verification pass contributes only
`record`, asking for the rest was latency bought for nothing.
*Result:* verification now finishes well before the 235B does, so it adds no wall-clock time at
all. Total went from ~82 s (65 + 17 sequential) to ~65 s, the primary model alone.
*Consequence worth knowing:* confidence no longer depends on the primary model's self-report, so
**the original reason for defaulting to the 235B is partly obsolete** — a 30B primary with an 8B
verifier would run in roughly 20 s and still produce measured confidence, at a cost in accuracy
(134/143 vs 143/143). Oscar's call.

---

### Where later validation hooks in (now implemented — see js/validate.js)
- **PESEL checksum** → `js/state.js`, in the `pesel` field's normaliser slot; result would set
  `status` + a remark on that field's state object.
- **NIP (mod 11, weights 6 5 7 2 3 4 5 6 7) and REGON (9/14-digit mod 11)** → same place, on
  `nip` / `regon`.
- **Date sanity, zip format, email format, phone format** → the per-field `normaliser` in `FIELD_DEFS`
  already returns a normalised value; it would return `{ value, status, note }` instead.
- **Cross-field checks** (birthdate vs PESEL digits, `zip_code` vs `city`, `noPesel` vs a non-empty
  `pesel`) → a single `validateRecord(state)` pass after extraction, before the form renders.
- **Whole-document compliance score** → from the model's own response once the schema grows a
  `documentProbability` sibling, not from the form layer.
