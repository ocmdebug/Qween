# WORKLOG

Append-only. Newest entry at the top.

## 2026-11-13 — 235B back in the list, 8B as default

**Done:**
- All three models in the dropdown again, ordered 8B / 30B / 235B; `DEFAULT_MODEL_ID` is the 8B
  (D34). Storage key bumped to `.v3` so a remembered choice does not hide the new default.
- Replaced the fixed `VERIFY.modelId` with `verifyModelFor(primaryId)` (D35). Pairs are 8B→30B,
  30B→8B, 235B→30B.
- The review banner and the dropdown note both warn when the 8B is the primary reader.

**Why:**
- The previous verifier was the 8B. Making the 8B the default primary would have put both readings
  on the same model: agreement would be meaningless, verification would have switched itself off
  by the existing guard, and the confidence bars would simply have vanished with no error. Deriving
  the pairing from the primary removes that failure mode permanently.

**Problems:**
- The 8B is the model that fabricated a NIP on the sample without one. That is the worst failure
  mode for this tool and it is now the default. Flagged in the UI, the dropdown and the README,
  but flagging is mitigation, not a fix. Worth revisiting with the manager if invented identifiers
  show up in real work.

**Next:** unchanged — the local server's URL and which models it will serve.

## 2026-11-13 — Manager's constraints: 30B ceiling, local server, 1150 px

**Done:**
- Removed the 235B. `MODELS` is now the 30B (default) and the 8B (D31).
- Moved the verification model to the 8B, since the 30B is now the primary.
- Added `App.Config.API` with both the OpenRouter and local-server endpoints, plus
  `MODELS[].localId` because the two name models differently. No key, `X-Title` or `HTTP-Referer`
  is sent when the endpoint declares `requiresKey: false`, and the Settings button hides (D32).
- Image scaling now driven by `LIMITS.targetHeight = 1150` instead of a 2000 px long edge;
  `maxImageSide` kept as a guard for landscape scans. PDF rendering uses the same target (D33).
- Documented the local-server migration in `docs/ARCHITECTURE.md` with the three server-side
  gotchas: CORS, structured-output support, and needing both models loaded.

**Why:**
- These reverse earlier decisions (D28 made the 235B the default), so each one is recorded against
  the decision it supersedes rather than quietly edited over.

**Problems:**
- The 235B was the only model whose self-reported confidence varied. Under the 30B ceiling,
  **measured confidence by agreement is no longer an improvement — it is the only way to get a
  confidence number at all.** If the local server ends up serving only one model, the second
  opinion cannot run and the review screen loses its confidence signal entirely.
- Accuracy drops from 143/143 to 134/143 with the 30B as primary. That is the cost of the ceiling.

**Verified:**
- Downscaling to 1150 px costs nothing. Re-ran the handwritten KOP-BUD referral through the 30B at
  858×1150: 10 of 12 key fields correct, and the two misses are the same two it already got wrong
  at full resolution. Payload 795 KB → 369 KB.

**Next:** point `API.mode` at the real server once its address and loaded models are known.

**Blocked on:** the local server's URL, which models it will serve, and whether it supports strict
`json_schema`.

## 2026-11-13 — Iteration 2: per-field confidence, validation and the review screen

**Done:**
- Measured three possible confidence sources before building anything (D21). Logprobs are
  unusable; 30B self-report is a flat 0.95; 235B self-report ranks correctly but compresses.
  Added "USE THE WHOLE RANGE" to the prompt, which widened the 235B spread from 0.05 to 0.15.
- Response schema is now `{ record, confidence, extra }`; `confidence` has one 0-1 number per
  contract key, generated from `FIELD_DEFS` so it cannot drift.
- New `js/validate.js`: PESEL, NIP and REGON checksums, postal/date/email/phone/house formats,
  birthdate-vs-PESEL agreement, `noPesel`/`noNip` cross-checks, and single-digit repair candidates
  ranked by OCR confusion pairs.
- `js/state.js` grew tiers (error / missing / low / check / auto / absent-auto plus four decided
  states), decisions, counts and `toReviewExport()`.
- `js/form.js` rewritten as the review screen: status chip, confidence bar, critical badge,
  validation message, repair suggestions, quick values, and per-tier actions.
- Review header (progress, todo/all tabs, counts), footer hints, finish button, toasts, and the
  Enter / N / Esc keyboard flow.
- `FIELD_FLAGS` block for `critical` / `optional` / `mono` / `quick` / `choice` (D25).
- Raised timeout 90 s → 240 s and max_tokens 4096 → 6000 after measuring a 134 s run (D27).

**Why:**
- Validation, not confidence, is the primary error detector (D22). Confidence is weak on the best
  model and worthless on the default one; checksums are arithmetic and always right. This is also
  what makes the mockup's PESEL repair suggestions possible.
- When confidence has no spread the app says so and ignores it (D23), rather than drawing 24
  identical bars and pretending.
- "Pobierz JSON" stays byte-identical to iteration 1; the audit trail is a separate export (D24).

**Problems:**
- Prompting the model not to emit specific filler values had taught it those values in iteration 1;
  the same lesson applied here, so the confidence instruction describes the behaviour wanted rather
  than naming numbers to avoid.
- One 235B run aborted at 134 s against the old 90 s timeout. Fixed, and it is why the timeout is
  now measured rather than guessed.
- **All three sample PESELs and three of four sample NIPs fail their checksums** — they are
  invented test data. The validator is correct; the sample documents are not real. Oscar will see
  errors on nearly every identifier until real documents are used.

**Next:** Oscar opens the review screen and says whether the thresholds flag too much or too
little. They are three constants in `js/config.js`.

**Blocked on:** unchanged, plus — does "Rodzaj badania" belong in the 24-key contract? The
manager's mockup marks it KRYTYCZNE, but our contract has no slot for it, so it currently sits in
the non-exported extras.

## 2026-11-13 — Interface translated to Polish, field names kept English

**Done:**
- Manager's instruction: whole interface in Polish, field names in code and in the JSON stay
  English. Implemented as D20.
- Translated `index.html` (headings, buttons, drop zone, viewer toolbar, panels, loading overlay,
  settings dialog), and `label` / `group` on all 24 `FIELD_DEFS` and all 6 `EXTRA_DEFS`.
- Added `js/i18n.js` holding `App.T`: every string built at runtime — file counts, payload line,
  API error messages, key status, review notes, page caption, download filename prefix.
  Routed `app.js`, `openrouter.js`, `image.js` and `viewer.js` through it.
- Added `App.T.plural(n, one, few, many)` for Polish three-form plurals and used it everywhere a
  count appears.
- `<html lang>` changed to `pl`; page title now "Document OCR — transkrypcja skierowań".
- Verified: 54/54 DOM ids still resolve, no English UI strings left in the JS, and a live
  extraction still returns 24 English keys in contract order starting with `f_name`.

**Why:**
- The field config already separated `key` (contract) from `label` (display), so the manager's
  split was the one the architecture already had — only values changed, no structure.
- Runtime strings went into one object rather than inline, so "change this wording" is one file
  and a second language stays possible.
- Polish needs three plural forms. `n === 1 ? 'plik' : 'pliki'` yields "2 plików", so the helper
  exists to make the wrong pattern unavailable.

**Problems:** none. The schema generator and the test harness both still parse `config.js`
unchanged, since only Polish `label`/`group` values moved and `schemaDesc` stayed English.

**Next:** Oscar still has the 3-page PDF to run through the browser.

**Blocked on:** unchanged — flat vs nested contract, 235B as default, the proxy, and whether the
3-page PDF is one referral or three.

## 2026-11-13 — Iteration 1 built and tested against all five samples

**Done:**
- Got answers to the 11 open questions and recorded them as decisions D10–D19.
- Built the whole app: `index.html`, `css/style.css`, and eight JS files
  (`config`, `prompt`, `image`, `openrouter`, `state`, `form`, `viewer`, `app`).
  Screen 1 (drag & drop, thumbnails, remove/replace, payload size, pre-process toggle) and
  screen 2 (zoom/pan/fit/page-switch preview on the left, config-driven form on the right,
  extras panel, raw-response panel, re-run, copy, download, Esc to go back).
- Multi-page and multi-file support: several files or PDF pages go in one request as one record.
- Ran 30+ live extractions against the OpenRouter API. Final matrix, 5 samples × 3 models:
  **235B 143/143, 8B 136/143, 30B 134/143.** Full detail in `docs/EXTRACTION_TESTS.md`.
- Fixed three real prompt bugs found by testing: `birthdate` derived from the PESEL,
  the `ul.` prefix left in `address_company`, and a fabricated NIP on a document that has none.
- Wrote `README.md`, `docs/ARCHITECTURE.md`, `docs/PROMPTING.md`, `docs/EXTRACTION_TESTS.md`,
  `prompts/extraction.md` (generated from source), and updated `CLAUDE.md` and `DECISIONS.md`.

**Why:**
- The test harness parses the prompt and the field definitions out of `js/prompt.js` and
  `js/config.js` rather than duplicating them, so a passing test cannot drift from the app.
- Extras go in a `{ record, extra }` response wrapper and only `record` is exported. That honours
  "don't discard the extra data" and "don't alter the manager's contract" at the same time.
- The default model stays the 30B as the brief specifies, even though the 235B tested perfect.
  Changing a specified default on test evidence alone is Oscar's call, so it is a recommendation
  in `README.md` instead.

**Problems:**
- Naming forbidden filler values in the prompt (`0000000000`, `1234567890`) taught them to the
  model — the 30B promptly emitted `1234567890`. Rewriting the rule positively fixed it. Recorded
  as D19 and as a tuning rule in `PROMPTING.md`.
- `exam_type` reads `wstępne` on the 8B and 30B even though nothing is marked on any sample. Three
  prompt approaches failed; the 235B gets it right. Confirmed the ground truth by cropping the
  title line before chasing it. Declared a model limit — it is an extra field, not contract data.
- The 8B fabricates a NIP (`0000000000`) on the one sample without one. Not fixable by prompting.
  Documented as a reason not to use the 8B in production.
- An apparent diacritics failure turned out to be PowerShell rendering UTF-8 as ANSI in the
  console. Diacritics are correct end to end on every model.
- No Node on this machine, so the JS has not been executed. Verified what I could statically:
  all 54 DOM ids in `app.js` resolve in `index.html`, both directions.

**Next:** Oscar opens `index.html` and runs a real document through it. Then: the pre-processing
A/B on the handwritten samples, and a multi-page PDF test once a sample exists.

**Blocked on:** Oscar — (1) confirm the flat 24-key contract rather than the nested shape in
`main project documentation` (D17, the one question that went unanswered); (2) decide on the
235B as default (D18); (3) decide when the key moves behind a backend proxy, given this is going
on a server (D12); (4) supply a multi-page PDF sample.

## 2026-11-13 — Research, sample analysis, plan written

**Done:**
- Read `main project documentation` in full and listed the 11 requirements in it that iteration 1 does
  not cover (`docs/PLAN.md` section 1).
- Inspected all 5 files in `sample docuemnts/`: one blank template, two filled in computer font
  (photographed), two filled by hand in blue pen. All are the same document type,
  `SKIEROWANIE NA BADANIA LEKARSKIE`, Polish, A4, single page.
- Built the page-zone → target-field map and identified which fields are frequently missing
  (`docs/PLAN.md` section 2).
- Fetched `GET https://openrouter.ai/api/v1/models` live and confirmed the three exact slugs:
  `qwen/qwen3-vl-8b-instruct`, `qwen/qwen3-vl-30b-a3b-instruct`, `qwen/qwen3-vl-235b-a22b-instruct`.
  All three support `structured_outputs`. Also checked the GLM vision models for open question 1:
  `z-ai/glm-4.6v` and `z-ai/glm-5v-turbo` take images but have **no** strict structured-output support.
- Verified OpenRouter's CORS preflight returns `Access-Control-Allow-Origin: *`, so a browser-side
  call works, including from a `file://` page.
- Preserved the original brief as `docs/ORIGINAL_BRIEF.md` and rewrote `CLAUDE.md` to the
  resume-cold format.
- Wrote `docs/PLAN.md`, `docs/DECISIONS.md`, `.gitignore`, `.env.example`.

**Why:**
- Preserving the brief first: on Windows `claude.md` and `CLAUDE.md` are one file, so writing the new
  one would have destroyed the original. Copied before writing.
- Checked the models endpoint rather than trusting the slugs from memory, as the task required; the
  GLM check was to make open question 1 answerable with facts rather than a guess.
- Checked CORS now because the whole "no backend, double-click to open" design depends on it. It holds.

**Problems:**
- Two requirements in the task conflict: "ES modules" and "must open with a double click". Chrome and
  Edge refuse `<script type="module">` from `file://` (origin `null`). Resolved as decision D1 —
  split files loaded as plain classic scripts under one `App` namespace, which satisfies both the
  no-build-step rule and the double-click rule. Same reasoning forced D2 (prompt as a JS constant with
  a markdown mirror, because `fetch()` of a local `.md` is also blocked on `file://`).
- Found a live OpenRouter API key in plaintext in the file `txt`. Not sent anywhere, not copied into
  any source file. Added `.gitignore` and `.env.example`; recommended rotating it.

**Next:** nothing until the plan is approved. Then build order is `docs/PLAN.md` section 11,
starting with the screen-1 shell.

**Blocked on:** Oscar — approval of `docs/PLAN.md` and answers to the 11 open questions in its
section 10, in particular local-only vs hosted (decides whether the key may live in the browser),
flat vs nested output contract, and permission to spend credits on test calls.
