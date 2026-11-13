# PLAN — Iteration 1: Document OCR / transcription web app

Status: **approved and implemented, 2026-11-13.** Oscar answered the open questions in §10; the
answers are recorded as decisions D10–D19 in `DECISIONS.md`. This file is kept as the record of
the sample analysis and the reasoning behind the build. For current state see `CLAUDE.md`, for
results see `EXTRACTION_TESTS.md`.
Date: 2026-11-13

---

## 1. What I found in the repo

| File | What it is |
|---|---|
| `claude.md` → copied to `docs/ORIGINAL_BRIEF.md` | Original brief (GLM, Qwen3-VL, formal style, JSON format) |
| `main project documentation` | Spec of a **backend OCR REST API** — a much larger system than iteration 1 |
| `txt` | **Live OpenRouter API key in plaintext** — see Risk R1 |
| `sample docuemnts/*.jpeg` | 5 photos/scans of the same Polish form |

### Requirements in `main project documentation` NOT covered by the iteration-1 prompt

These are listed so we agree explicitly what is out of scope now and what the
architecture must not block later.

1. **REST backend** with `POST /ocr`, `GET /documentTypes`, `GET /fileTypes`, `GET /models`.
   Iteration 1 is a browser-only client calling OpenRouter directly — no backend at all.
2. **Response envelope** `{ "status": 200, "message": "", "content": {...} }` wrapping every response.
   The iteration-1 contract is a bare flat object with 24 keys. These two shapes conflict (see Q6).
3. **Nested, grouped output** (`personalData.firstName.value`, `contact.email.probability…`) vs. the
   flat `f_name` / `l_name` / `email` contract in the prompt. Also conflicting (Q6).
4. **Per-field probability 0–100 % + `description[]` list of remarks** — explicitly deferred to a later
   iteration by the prompt, but the state model must be able to grow into it (section 7 of the prompt).
5. **`documentProbability`** — a whole-document "is this even the right form type?" score. Also deferred.
6. **Document types defined in markdown files + a parser** that builds the prompt from the md file.
   Iteration 1 has exactly one hardcoded document type. Worth imitating the shape (see section 5).
7. **Image preparation stage** (saturation, sharpness, deskew, contrast) before reading. The prompt only
   asks for downscale + JPEG re-encode. Light preprocessing is cheap in canvas; see Q9.
8. **Multi-file = one document** (several photos, one page each, sent as one request) plus a
   consistency check that the pages belong to the same document. Related to Q4.
9. **Multi-stage reading** (batching pages across several requests) and **structural-validation retry**
   (re-ask the model when the JSON shape is wrong). Iteration 1 does one request; a single retry on
   malformed JSON is cheap and I would include it.
10. **Programmatic content validation** (PESEL checksum, NIP/REGON checksum, date sanity, email format,
    cross-field consistency). Deferred; I will mark the hook points in the docs.
11. **Config file** (section 6 of the doc, empty) — iteration 1 uses `js/config.js` instead.

---

## 2. The sample documents

**All five are the same document type**: `SKIEROWANIE NA BADANIA LEKARSKIE`
("Referral for medical examinations"), the statutory Polish occupational-medicine referral issued by an
employer under art. 229 § 4a of the Labour Code. Language: **Polish only**, full diacritics
(ą ć ę ł ń ó ś ź ż). A4 portrait, one page, pre-printed template with dotted fill-in lines.

| # | File | Type | Notes |
|---|---|---|---|
| 1 | `WhatsApp Image 2026-11-13 at 09.04.03.jpeg` | Blank template, clean digital render | Nothing filled in. The "everything must be `""`" test case. |
| 2 | `...09.34.31.jpeg` | Filled, computer font, photographed print | TRANS-BUD / Janusz Kowalski. Slight perspective skew, shadow. |
| 3 | `...209.34.30.jpeg` | Same content, photographed on a desk | Filled text and template text are the *same* font — the model must tell them apart by position, not by style. |
| 4 | `...039.34.31.jpeg` | **Handwritten** (blue pen) | STAL-MET / Janusz Kowalczyk. Handwriting overflows the dotted lines and spills across rows. Hardest case. |
| 5 | `...09.34.431.jpeg` | **Handwritten** (blue pen) | KOP-BUD / Andrzej Kowalczyk. 11 factors, heavy overflow, `określenie stanowiska` left blank. |

### Layout → target field map

Reading top to bottom:

| Zone on the page | Polish label that precedes it | Target field(s) | Presence in samples |
|---|---|---|---|
| Top left block | *(oznaczenie pracodawcy)* | `name_company`, `address_company`, `zip_code_company`, `city_company`, `nip` | 4/5 (blank in the template) |
| Top right | *(miejscowość, data)* | **no field in the contract** — place + date of issue | 4/5 |
| Title line | `(wstępne/okresowe/kontrolne*)` | **no field** — exam type, usually circled/underlined | present, never marked in these samples |
| Body line 1 | `Pana/Panią*) … (imię i nazwisko)` | `f_name`, `l_name` | 4/5 |
| Body line 2 | `nr PESEL**)` | `pesel`, `noPesel` | 4/5 |
| Body line 3 | `zamieszkałego/zamieszkałą*) … (miejscowość, ulica, nr domu, nr lokalu)` | `patient_street_name`, `patient_house_number`, `patient_unit_id`, `zip_code`, `city` — **one free-text line that must be split** | 4/5 |
| Body line 4 | `…pracę na stanowisku lub stanowiskach pracy` | `name_position` | 4/5 |
| Body line 5 | `określenie stanowiska/stanowisk*) pracy***):` | `description_position` | 3/5 (blank in #5) |
| Sections I–V | `Czynniki fizyczne / Pyły / Czynniki chemiczne / Czynniki biologiczne / Inne czynniki` | `harmful_factors` (one string, all five merged — see Q8) | 4/5 |
| Box bottom right | `Łączna liczba czynników…` | **no field** — count of factors (6, 9, 11) | 4/5 |
| Bottom | `(podpis pracodawcy)` + printed role/name | **no field** | 4/5 |

### Fields that appear in NO sample

`nationality`, `birthdate`, `email`, `phone`, `regon`, `country_company`, `noNip` (NIP is always present
when the form is filled). Under the "" rule these are all empty strings on every real document — which
means **7 of 24 fields can never be tested against these samples**. This is the main reason for Q7 and Q10.

---

## 3. Proposed architecture

### Files

```
index.html              markup + screen 1 / screen 2 shells
css/style.css           all styling (black / grey / white, subtle glass)
js/config.js            MODELS array, FIELD_DEFS array, JSON_SCHEMA, app constants
js/prompt.js            EXTRACTION_PROMPT — one clearly marked constant, nothing else
js/image.js             file → canvas → downscale → JPEG q0.85 data URL; pdf.js page render
js/openrouter.js        request building, structured output, error mapping, raw response capture
js/state.js             the extraction state object + normalisers
js/form.js              renders the form from FIELD_DEFS, reads/writes state
js/viewer.js            preview pane: zoom, pan, fit-to-width, page switcher
js/app.js               screen flow, wiring, loading/elapsed timer, keyboard
prompts/extraction.md   human-readable copy of the prompt + rationale (NOT loaded at runtime, see D2)
.env.example            key placeholder
.gitignore              txt, .env, *.key, sample docs if you want them out
```

### Data flow

```
drop/pick file
  → File object  (screen 1, thumbnail, remove/replace)
  → image.js: decode (PDF → pdf.js canvas, page 1) → downscale longest side ≤ 2000px
             → JPEG q0.85 → data URL + byte size shown in UI
  → openrouter.js: POST /chat/completions
       model   = dropdown value (default qwen/qwen3-vl-30b-a3b-instruct)
       messages= [ system: EXTRACTION_PROMPT, user: [image_url, short instruction] ]
       temperature 0, response_format json_schema strict (fallback: plain JSON + defensive parse)
  → raw text kept verbatim for the "Raw response" panel
  → parse → state.js: { f_name: { value: "Jan" }, ... }  ← one wrapper object per field
  → form.js renders FIELD_DEFS against that state  (screen 2, right)
  → viewer.js shows the rendered page image        (screen 2, left)
  → operator edits → state updated → Copy JSON / Download JSON flatten state back to the contract
```

The per-field wrapper `{ value }` is the whole point: iteration 2 adds `confidence`, `status`,
`source_bbox` to the same object and `form.js` does not change its contract.

### Style

Greyscale only: `#0f0f10` ink, `#f5f5f4` page, four greys between. One state colour for errors
(a desaturated dark red, used only for text + 1px border, never as a fill). System sans stack.
Glass on the toolbar, the drop zone and buttons: `backdrop-filter: blur(10px)`, `rgba(255,255,255,.55)`
fill, `1px solid rgba(0,0,0,.08)`, soft low-opacity shadow. Body text never lighter than #4a4a4a on white.

---

## 4. Models

Confirmed against a live `GET https://openrouter.ai/api/v1/models` call today — exact slugs:

| Slug | Name | Context | $/M in | $/M out | `structured_outputs` |
|---|---|---|---|---|---|
| `qwen/qwen3-vl-8b-instruct` | Qwen3 VL 8B Instruct | 262 144 | 0.25 | 0.75 | yes |
| `qwen/qwen3-vl-30b-a3b-instruct` | Qwen3 VL 30B A3B Instruct **(default)** | 262 144 | 0.15 | 0.60 | yes |
| `qwen/qwen3-vl-235b-a22b-instruct` | Qwen3 VL 235B A22B Instruct | 262 144 | 0.21 | 1.90 | yes |

All three accept image input and all three advertise strict structured outputs, so the json_schema path
works for the whole default list and the plain-JSON fallback is only insurance.

GLM candidates, if you answer "yes" to Q1: `z-ai/glm-4.6v` and `z-ai/glm-5v-turbo` are the vision ones.
Both support `response_format` but **not** `structured_outputs` — they would always take the fallback path.
`z-ai/glm-4.6` / `glm-5.x` are text-only and cannot be used here at all.

---

## 5. Prompt strategy

One system prompt, in English, instructing the model about a Polish document. It will contain:

1. **Role + document identity** — "this is a Polish `SKIEROWANIE NA BADANIA LEKARSKIE`, a statutory
   employer referral under art. 229 § 4a", so the model knows the template text by heart and can
   distinguish pre-printed template text from what was filled in.
2. **A field-by-field table**: key → what it is → the Polish label that precedes it on the page → where
   on the page → typical format. Built from the map in section 2.
3. **The hard rules**: `""` never null/N/A, never invent, never translate, keep diacritics exactly,
   booleans only for `noPesel`/`noNip`, same keys in the same order.
4. **The three normalisers** (date → YYYY-MM-DD, zip → NN-NNN, phone → +48NNNNNNNNN) with the
   "keep verbatim rather than guess" escape hatch.
5. **The address-splitting instruction** — the single biggest extraction risk, with a worked example from
   the samples: `Warszawa, ul. Kwiatowa 5 m. 12, 01-234 Warszawa` → street `Kwiatowa`, house `5`,
   unit `12`, zip `01-234`, city `Warszawa`.
6. **An explicit "blank template" instruction** — if the dotted lines are empty, every field is `""`
   and both booleans are `true`. (Sample #1 is exactly this, and it is the case a model is most likely
   to hallucinate its way through.)

This mirrors what the main documentation calls a "document type md file". I will keep the same section
shape so that turning it into a parsed md-per-document-type system later is mechanical.

---

## 6. Error handling

| Case | Shown as |
|---|---|
| 401 | "API key rejected — open Settings and re-enter the key." + Settings button |
| 402 | "OpenRouter account has no credits for this model." |
| 429 | "Rate limited. Wait a moment and press Re-run." |
| 408 / abort | hard timeout (90 s default, configurable) with a Cancel button during the wait |
| 5xx / provider error | status + OpenRouter's `error.message` verbatim |
| Malformed JSON | parse defensively (strip ``` fences, take the outermost `{...}`); on failure show the raw text and offer one automatic re-ask |
| Missing / extra keys | fill missing with `""`, list extras in the Raw panel, never silently drop |

The raw response body is always kept and always reachable in the collapsible panel, including on error.

---

## 7. What I will NOT build in iteration 1

Confidence scores, validation flags, checksum verification, backend, multi-page PDF beyond page 1
(pending Q4), document-type selection, submission to any API, the response envelope from the main doc.

---

## 8. Risks

- **R1 — the API key in `txt` is live and in plaintext.** I have not sent it anywhere. I am adding
  `.gitignore` + `.env.example` now. **Recommendation: rotate that key on openrouter.ai before this
  folder is shared or pushed anywhere**, and keep the working key only in localStorage via the Settings
  dialog. The repo is not a git repo yet, so nothing has been committed.
- **R2 — `file://` + ES modules do not work together.** Chrome and Edge refuse `<script type="module">`
  from `file://` (CORS, origin `null`). "Double-click to open" and "ES modules" are mutually exclusive
  without a server. See D1 for how I propose to resolve it.
- **R3 — pdf.js worker over `file://`.** A cross-origin CDN worker cannot be instantiated directly;
  I will use the standard blob-wrapper workaround and fall back to pdf.js's workerless mode.
- **R4 — handwriting overflow.** In samples #4 and #5 the handwritten factor text crosses row
  boundaries, so the model may attach text to the wrong section. This is what `EXTRACTION_TESTS.md`
  is for; the 8B may well fail here where the 235B does not.
- **R5 — 7 of 24 fields never appear on this document type** (see section 2). We can verify "returns
  `""` correctly" but not "extracts correctly" for those.
- OpenRouter CORS is **not** a risk: I verified a preflight today, it returns
  `Access-Control-Allow-Origin: *`, so browser-side calls work, including from `file://`.

---

## 9. Decisions I am proposing (D-numbers carried into DECISIONS.md)

- **D1** — Drop ES modules, keep the split files. `index.html` + `css/` + `js/` loaded as plain
  `<script src>` in dependency order, each file wrapped in an IIFE that hangs one object off a single
  `App` namespace. No build step, works by double-click *and* behind a static server, still one concern
  per file. The alternative (one self-contained HTML file) also works on `file://` but makes a
  ~2000-line file; the alternative (true ES modules) forces `python -m http.server` every time.
- **D2** — The extraction prompt lives in `js/prompt.js` as one clearly marked constant, with a
  human-readable mirror in `prompts/extraction.md`. Reason: `fetch()` of a local `.md` is blocked on
  `file://`, so a runtime-loaded md file would break the double-click requirement. The prompt is still
  editable without touching app logic.
- **D3** — Default model = `qwen/qwen3-vl-30b-a3b-instruct`, remembered in localStorage.
- **D4** — Timeout 90 s, max image side 2000 px, JPEG q0.85, payload size shown next to the thumbnail.

---

## 10. Open questions — I need these answered before coding

**Yours, from the task file:**

1. **GLM or Qwen only?** The brief says GLM, the model list says Qwen3-VL. My recommendation: ship the
   three Qwen3-VL models, and add `z-ai/glm-4.6v` as a fourth *optional* entry only if you want a
   cross-family comparison — note it has no strict structured-output support, so it is a weaker baseline
   for a strict 24-key contract.
2. **Where will this run?** My recommendation: **local machines only for iteration 1**, key in
   localStorage. Trade-off spelled out: a browser-held key is readable by anyone with access to that
   machine's browser profile or devtools, and cannot be scoped per operator or revoked individually —
   you would rotate one shared key for everybody. The moment this is hosted for several operators, the
   key must move behind a small backend proxy (the one from `main project documentation`), because a
   key served to a browser from a web server is effectively public. If you already know it will be
   hosted, say so now and I will design screen 1/2 against a `POST /ocr` shape instead of OpenRouter
   directly — the UI does not change, only `js/openrouter.js`.
3. **Always this one document type**, or several form types later? If several, I will put the prompt +
   field map behind a `DOCUMENT_TYPES` array now (cheap) rather than retrofitting it.
4. **Multi-page PDFs — one record per document or per page?** Multi-page is cheap to add: pdf.js already
   gives me every page, and OpenRouter accepts several `image_url` parts in one message, so "all pages,
   one record" is maybe 30 extra lines. The main documentation explicitly wants that behaviour
   (several files = one document). My recommendation: render all pages, send up to N (3?) images in one
   request, one record out. Confirm and I will build it in iteration 1.
5. **Does screen 2 submit anywhere?** My recommendation: Copy + Download JSON only for iteration 1, but
   I will put the export behind one `exportRecord()` function so a `POST` is a one-line change.

**Mine, from reading the docs and samples:**

6. **Flat contract or the nested one from `main project documentation`?** The two output shapes conflict
   (`f_name` vs `personalData.firstName.value`, bare object vs `{status,message,content}`). I will build
   exactly the flat 24-key contract as specified — confirm that the main doc's shape is a *later*
   backend concern and not something iteration 1 must match.
7. **Derivation rules.** May the model:
   (a) derive `birthdate` from the PESEL (the first six digits encode it — fully deterministic)?
   (b) default `nationality` to `"Polska"` when the document does not state it?
   (c) default `country_company` to `"Polska"` when the address is clearly Polish?
   My default if you do not answer: **no to all three — `""`**, because "never an invented value" is an
   explicit rule and inference is not transcription. But (a) in particular is lossless and might be what
   you actually want, so I am asking.
8. **`harmful_factors`** — the document has five labelled sections (I Czynniki fizyczne, II Pyły,
   III Czynniki chemiczne, IV Czynniki biologiczne, V Inne czynniki). One string with all five merged,
   keeping the Polish labels as prefixes (`"I. Czynniki fizyczne: hałas, drgania…; II. Pyły: brak; …"`)?
   That is my recommendation — it is lossless and splits cleanly later.
9. **Image pre-processing** — the main doc wants deskew/contrast/sharpening before reading. Should
   iteration 1 include a light greyscale + contrast-stretch pass (cheap in canvas, usually helps
   handwriting), or send the plain downscaled photo? Recommendation: ship it as an **off-by-default
   toggle** so we can A/B it in `EXTRACTION_TESTS.md`.
10. **Data the form carries but the contract drops**: issue place + date, exam type
    (wstępne/okresowe/kontrolne), the factor count box, and the signatory's name and role. Do you want
    these captured now in an `extra` section of the state (visible on screen 2, excluded from the
    exported JSON), or genuinely discarded?
11. **Can I spend your OpenRouter credits to test?** Running all 5 samples × 3 models is roughly
    15 requests, well under $0.10 in total. I would rather ask than silently bill you. If yes, say
    whether to use the key in `txt` or a different one.

---

## 11. On approval, the build order

1. `index.html` + `css/style.css` shell, screen 1 only, drag & drop + thumbnail + remove/replace.
2. `js/image.js` — downscale + JPEG + payload size; pdf.js page render.
3. `js/config.js` + `js/prompt.js` — models, field defs, schema, prompt.
4. `js/openrouter.js` — request, structured output, error map, raw capture.
5. `js/state.js` + `js/form.js` + `js/viewer.js` — screen 2.
6. `js/app.js` — flow, timer, re-run, copy/download, keyboard, settings dialog.
7. Test pass over all 5 samples × 3 models → `docs/EXTRACTION_TESTS.md`, tune the prompt.
8. `README.md`, `docs/ARCHITECTURE.md`, `docs/PROMPTING.md`; keep `DECISIONS.md` + `WORKLOG.md` current.
