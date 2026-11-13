# CLAUDE.md — Document OCR / transcription web app

> Oscar's original brief is preserved verbatim at `docs/ORIGINAL_BRIEF.md`.

## What this project is

A single-page browser app that takes a photo or scan of a Polish occupational-medicine referral
(`SKIEROWANIE NA BADANIA LEKARSKIE`), sends it to a Qwen3-VL vision model through OpenRouter, and
returns a structured 24-field JSON record. An operator reviews and corrects the values in a form
next to the document preview. It is the front half of the larger backend OCR system described in
`main project documentation`; that backend does not exist yet and is not part of this work.

## Current state (2026-11-13)

**Iteration 1 is built and tested.** Working: drag & drop upload (multi-file and multi-page PDF
as one document), thumbnails with remove/replace, image downscale + JPEG re-encode with payload
size shown, optional pre-processing, model dropdown, strict structured-output extraction, the
split review screen (zoom/pan/fit/page-switch preview + config-driven form), the extras panel,
the raw-response panel, re-run, copy, download, and the settings dialog for the API key.

Tested live against all five samples on all three models: **235B 143/143, 8B 136/143,
30B 134/143** — see `docs/EXTRACTION_TESTS.md`.

**Iteration 2 is built**: per-field confidence from the model, deterministic validation
(PESEL/NIP/REGON checksums, formats, cross-checks), the triage review screen (tiers, status chips,
confidence bars, repair suggestions, quick values, per-field decisions), progress/tabs/counts, the
Enter·N·Esc keyboard flow, and a separate review export. **Never run in a browser** — see below.

Not built: any backend.

**Known, and not a bug:** the sample documents contain invented PESEL and NIP numbers, so the
validator flags almost every identifier. Verified by hand: all three sample PESELs and three of the
four NIPs genuinely fail their checksums.

**The JS has never been executed in a browser** (no Node on this machine). Statically verified:
all 54 DOM ids in `app.js` resolve in `index.html`. The prompt and schema path is fully exercised
against the live API. First task next session: have Oscar open it and report what breaks.

## Stack and constraints

- Vanilla JS, no framework, no bundler, **no build step**.
- Works by double-clicking `index.html` (`file://`) and behind a static server.
  → this rules out ES modules and runtime `fetch()` of local files (D1/D2). Scripts are classic
  `<script src>` tags in dependency order, each an IIFE hanging one object off a global `App`.
- Only CDN dependency: **pdf.js 3.11.174**. Anything else needs Oscar's approval.
- **Language split (manager, 2026-11-13): the whole interface is POLISH; field names in code and
  in the JSON stay ENGLISH.** Also English: code, comments, docs, the extraction prompt and
  `schemaDesc` (those are instructions to the model, not interface). Polish lives in exactly three
  places — `index.html` (static markup), `FIELD_DEFS.label` / `.group` in `js/config.js`, and
  `js/i18n.js` (`App.T`, everything built at runtime). Polish plurals need three forms; use
  `App.T.plural(n, one, few, many)`, never `n === 1 ? …`.
- **Polish diacritics ą ć ę ł ń ó ś ź ż are never stripped or normalised** — verified end to end.
- OpenRouter `POST /api/v1/chat/completions`, temperature 0, `response_format: json_schema` strict.

## File map

| Path | What lives there |
|---|---|
| `index.html` | Markup for both screens, loading overlay, settings dialog; script load order at the bottom |
| `css/style.css` | All styling; greyscale tokens under `:root` |
| `js/config.js` | `MODELS`, `FIELD_DEFS`, `EXTRA_DEFS`, `EXPORT_ORDER`, `EMPTY_VALUE`, `LIMITS`; **generates the JSON schema**. English `key`, Polish `label`/`group` |
| `js/i18n.js` | `App.T` — every Polish string built at runtime, plus the Polish plural helper |
| `js/validate.js` | PESEL/NIP/REGON checksums, format checks, cross-checks, repair candidates |
| `js/prompt.js` | `EXTRACTION_PROMPT_TEMPLATE` and nothing else |
| `js/image.js` | File → page images: decode, downscale, pre-process, JPEG, pdf.js rasterisation |
| `js/openrouter.js` | The only networking file: key storage, request, error mapping, defensive parse, one retry |
| `js/state.js` | State object, normalisers, export flattening, the empty `validateRecord` hook |
| `js/form.js` | Renders the form from the field config |
| `js/viewer.js` | Preview pane: zoom, pan, fit, pages |
| `js/app.js` | Screen flow and wiring; owns no business rules |
| `prompts/extraction.md` | Generated mirror of the prompt — **do not hand-edit** |
| `README.md` | How to run it, formats, models, known limits |
| `docs/ARCHITECTURE.md` | File map, data flow, where to change what, proxy migration |
| `docs/PROMPTING.md` | The prompt, why each rule exists, how to tune it |
| `docs/EXTRACTION_TESTS.md` | Per-sample per-model results, prompt changes and their effect |
| `docs/DECISIONS.md` | D0–D19: every assumption and trade-off |
| `docs/WORKLOG.md` | Session log, newest first |
| `docs/PLAN.md` | Iteration-1 plan and the sample analysis |
| `docs/ORIGINAL_BRIEF.md` | Oscar's original brief, verbatim |
| `main project documentation` | Spec of the future backend REST API — context, not scope |
| `sample docuemnts/` | 5 referrals: 1 blank, 2 typed, 2 handwritten |
| `txt` | **Plaintext OpenRouter key — gitignored, should be rotated.** Never read it into code. |

## How to run and test

Double-click `index.html`, or **`python serve.py`** and open `http://localhost:8000`.
**Never use `python -m http.server`** — it sends no cache headers, the browser then runs stale
`js/*.js`, and the symptom is a runtime error naming a function that is visibly present on disk.
`serve.py` is the same server with caching off.
First run asks for the OpenRouter key (stored in localStorage). Test against
`sample docuemnts/`. Quickest prompt loop: edit `js/prompt.js`, hard-refresh,
press **Re-run extraction** on screen 2 — no re-upload needed.

## Conventions

- Output contract: exactly 24 keys in `EXPORT_ORDER`, **English keys, never translated**. All
  strings except `noPesel` / `noNip`.
- Any new user-facing string goes in `js/i18n.js`, never inline in app logic.
- **A missing field is the string `"not found"`** (`EMPTY_VALUE` in `js/config.js`), never `null`,
  never an invented value. This is Oscar's override of the brief's `""` rule (D11).
- Never translate document content. Transcribe as written.
- `birthdate` → `YYYY-MM-DD`, `zip_code` → `NN-NNN`, `phone` → `+48NNNNNNNNN`; if a value cannot
  be normalised confidently, keep it verbatim.
- The form renders from `FIELD_DEFS`. Never hand-write per-field markup.
- Field state is `{ key: { value } }` so `confidence` / `status` / `source_bbox` can be added
  without changing the renderer's contract.
- `def.schemaDesc` goes into the structured-output schema and **outweighs prompt prose** — when
  tuning, change both.
- Style: black / grey / white, one error tone, subtle glass, no low-contrast grey text.

## Do NOT

- Do not add a framework, bundler, or any CDN dependency other than pdf.js.
- Do not hardcode the API key, and do not commit `txt`, `.env`, or any real key.
- Do not put confidence, decisions or validation into the 24-key export — that stays byte-identical
  to iteration 1. The audit trail is a separate "Kopiuj przegląd" export (D24).
- Do not treat model confidence as trustworthy. It is self-reported and compressed; validation is
  the real error detector (D21/D22). Never widen or rescale the number to make it look better.
- Do not use ES modules or `fetch()` a local file; both break the `file://` requirement.
- **Do not name forbidden values in the prompt** — it teaches them to the model (D19).
- Do not hand-edit `prompts/extraction.md`; regenerate it from `js/prompt.js`.

## Open questions waiting on Oscar

1. **Flat 24-key contract, or the nested `{status, message, content}` shape from
   `main project documentation`?** The only question from `PLAN.md` §10 he did not answer.
   Built flat (D17); needs confirmation.
2. ~~Make the 235B the default?~~ **Decided 2026-11-13: yes (D28).** It is the only model whose
   confidence varies, so the review screen is inert on the others.
3. **When does the key move behind a backend proxy?** This is going on a server, and a
   browser-held key cannot be scoped or revoked per operator (D12). Should not ship as-is.
4. **A multi-page PDF sample** — the code path exists but has never been run against a real file.
