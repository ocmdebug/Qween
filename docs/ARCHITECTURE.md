# ARCHITECTURE

## Shape of the thing

A static page. No server, no build, no framework, no npm. Eight small JavaScript files are
loaded as **classic scripts** in dependency order and each hangs one object off a single global
`App` namespace. The only external dependency is pdf.js from a CDN, used solely to rasterise PDF
pages.

Classic scripts rather than ES modules is deliberate: browsers refuse `<script type="module">`
from `file://`, and "opens with a double click" is a hard requirement. See `DECISIONS.md` D1.

## File map

```
index.html              Markup for both screens, the loading overlay and the settings dialog.
                        Script tags at the bottom define the load order.
css/style.css           All styling. Greyscale tokens at the top under :root.

js/config.js            MODELS, FIELD_DEFS, EXTRA_DEFS, EXPORT_ORDER, EMPTY_VALUE, LIMITS.
                        Generates the JSON schema from the field definitions.
js/i18n.js              App.T — every Polish string produced at runtime, plus plural().
js/prompt.js            EXTRACTION_PROMPT_TEMPLATE and nothing else.
js/image.js             File -> page images. Decode, downscale, optional pre-process,
                        JPEG re-encode, PDF rasterisation. Knows nothing about the model.
js/openrouter.js        The only file that touches the network. Key storage, request building,
                        HTTP error mapping, defensive JSON parsing, one structural retry.
js/state.js             The extraction state object, the field normalisers, export flattening,
                        and the (empty) validation hook.
js/form.js              Renders the review form from the field config. Knows nothing about
                        OpenRouter or images.
js/viewer.js            The preview pane: zoom, pan, fit, page switching.
js/app.js               Screen flow and wiring. Owns no business rules.

prompts/extraction.md   Generated mirror of the prompt, for reading. Not loaded at runtime.
.env.example            Key placeholder, for a future proxy.
```

Load order matters and is fixed in `index.html`: `config → i18n → prompt → image → openrouter →
state → form → viewer → app`.

## Language

The interface is **Polish**. Field names in code and in the exported JSON are **English** and are
never translated — they are the contract with whatever consumes the output.

| Stays English | Is Polish |
|---|---|
| JSON keys (`f_name`, `noPesel`, …) | Form labels and group headings |
| `EXPORT_ORDER`, all code identifiers | Buttons, headings, dialog copy |
| Code comments and all of `docs/` | Errors, status lines, counts |
| The extraction prompt and every `schemaDesc` | Field hints (`polishLabel`) |
| `EMPTY_VALUE` (`"not found"` — it is data, not interface) | |

Polish text lives in exactly three places:

1. **`index.html`** — static markup: headings, buttons, the dialog, the panel copy.
2. **`js/config.js`** — `FIELD_DEFS[].label` and `.group` (and the same in `EXTRA_DEFS`).
3. **`js/i18n.js`** — `App.T`, everything assembled at runtime: counts, warnings, API errors,
   key status, the download filename prefix.

Nothing user-facing is written inline in app logic. If you add a message, it goes in `i18n.js`.

**Polish plurals take three forms**, so any string with a number goes through
`App.T.plural(n, one, few, many)` — `1 plik`, `2 pliki`, `5 plików`. Writing
`n === 1 ? 'plik' : 'pliki'` is wrong in Polish; the helper exists so that mistake is not available.

Adding another language later means a second `T` object and a language switch; `index.html` would
need its static strings pulled into `T` as well. Not built, not needed yet.

## Data flow, upload to form

```
  Screen 1
  ────────
  drag/drop or file picker
        │  File[]  (several files = pages of ONE document)
        ▼
  app.js  renderFileList()           thumbnails, remove/replace, accepted-type filter
        │
        │  press Extract
        ▼
  image.js  load(files, {preprocess})
        │     ├─ image  → decode (EXIF-aware) → downscale longest side ≤ 2000px
        │     │            → optional greyscale + contrast stretch
        │     │            → JPEG q0.85 data URL
        │     │            (already-small JPEGs are passed through untouched)
        │     └─ pdf    → pdf.js render each page to canvas at ≈2000px → same JPEG path
        │
        │  pages[] = [{ id, sourceName, pageNumber, dataUrl, width, height, bytes }]
        ▼
  openrouter.js  extract(modelId, pages)
        │     system  = App.Prompt.build()            ← {{EMPTY}} resolved here
        │     user    = [ text instruction, image_url × N ]
        │     temperature 0, max_tokens 4096
        │     response_format = json_schema (strict) when the model supports it,
        │                       else json_object + the JSON-only suffix
        │
        │     ├─ HTTP error     → mapped to a human sentence (401/402/429/timeout/…)
        │     ├─ unparseable    → strip fences → outermost {…} → ONE retry with a
        │     │                   correction note → else surface the raw text
        │     └─ ok             → { record, extra, raw, usage, finishReason }
        ▼
  state.js  fromResult()
        │     per-field normalisation (date / zip / phone / digits / trim)
        │     missing keys filled with EMPTY_VALUE, unexpected keys reported not merged
        │
        │  state = { fields: { key: { value } }, extra: {…}, meta: {…}, raw: "…" }
        ▼
  Screen 2
  ────────
  viewer.js  setPages(pages)      left pane
  form.js    renderRecord(state)  right pane, built from FIELD_DEFS
        │
        │  operator edits → state.fields[key].value, re-normalised on blur
        ▼
  state.js  toExport(state)  →  exactly 24 keys in EXPORT_ORDER  →  Copy / Download
```

## Where to change things

| I want to… | Edit |
|---|---|
| Add or remove an AI model | `MODELS` in `js/config.js`. Set `structured: false` if it has no strict json_schema support; the fallback path handles it. |
| Change the default model | `DEFAULT_MODEL_ID` in `js/config.js`. |
| Change the extraction prompt | `EXTRACTION_PROMPT_TEMPLATE` in `js/prompt.js`. Nothing else. Then regenerate `prompts/extraction.md` (snippet in `PROMPTING.md`). |
| Add, remove or relabel a field | `FIELD_DEFS` in `js/config.js`, plus `EXPORT_ORDER` if it belongs in the contract. The form, the JSON schema and the export all follow automatically. Change `label` (Polish) — **never** `key` (English, it is the contract). |
| Change a button, heading or dialog wording | `index.html`. |
| Change a runtime message, error or counter | `App.T` in `js/i18n.js`. |
| Capture more non-contract data | `EXTRA_DEFS` in `js/config.js`. It appears in its own panel and stays out of the export. |
| Change what "absent" looks like | `EMPTY_VALUE` in `js/config.js` (currently `"not found"`; `""` restores the original brief). |
| Change image size, quality, page cap, timeout | `LIMITS` in `js/config.js`. |
| Change a normalisation rule | `normalisers` in `js/state.js`, referenced by name from `FIELD_DEFS`. |
| Restyle | the `:root` tokens at the top of `css/style.css`. |

## The field config is the single source of truth

`FIELD_DEFS` drives three things at once, so they cannot drift apart:

1. **The form** — `form.js` groups by `def.group`, labels by `def.label`, picks the control from
   `def.type`, and shows `def.polishLabel` as the hint under the label.
2. **The JSON schema** sent to the model — `buildSchema()` turns each def into a schema property
   using `def.schemaDesc` as its description, ordered by `EXPORT_ORDER`.
3. **The export** — `toExport()` walks `EXPORT_ORDER`.

`def.schemaDesc` matters more than it looks: it is injected into the structured-output schema and
the model weighs it heavily, sometimes above the prompt prose. If the prompt and a `schemaDesc`
disagree, the `schemaDesc` tends to win. Keep them aligned.

## Built for the next iteration

Every extracted field is stored as a wrapper object, not a bare string:

```js
state.fields.pesel = { value: "78041203456" }
```

Iteration 2 grows that into `{ value, confidence, source_bbox, status, notes }` without changing
`form.js`'s contract — it reads and writes `.value` and calls one `decorate(row, def, entry)`
function for the visual state. Confidence badges and error flags go in `decorate()` alone.

### Where validation hooks in

`App.State.validateRecord(state)` is called by `app.js` immediately after `fromResult()` and is
currently a no-op, by instruction. When it lands it should fill `status` and `notes` on each
field wrapper:

- **PESEL checksum** — on `state.fields.pesel`.
- **NIP** — mod 11, weights 6 5 7 2 3 4 5 6 7.
- **REGON** — 9-digit and 14-digit mod 11 variants.
- **birthdate** — real-calendar check, and agreement with the PESEL's first six digits
  (a *check*, not a derivation — the prompt still forbids deriving it).
- **Cross-field** — `noPesel` must agree with `pesel` being empty; same for `noNip` / `nip`;
  `zip_code` against `city`.
- **Whole-document compliance score** — belongs in the model response (a `documentProbability`
  sibling to `record`), not in the form layer.

## Running against a local model server

This is the production target; OpenRouter was the test harness. Local servers (vLLM, Ollama,
LM Studio, llama.cpp) expose the same OpenAI chat-completions shape, so the switch is config only.

In `js/config.js`:

```js
var API = {
  mode: 'local',                                        // was 'openrouter'
  local: {
    url: 'http://<server>:8000/v1/chat/completions',
    requiresKey: false
  }
};
```

What that changes by itself:

- requests go to the local URL
- no `Authorization`, `X-Title` or `HTTP-Referer` header is sent
- the Settings button hides, and the app stops asking for a key
- the model name sent is `MODELS[].localId` (e.g. `Qwen/Qwen3-VL-30B-A3B-Instruct`) rather than
  the OpenRouter slug, because the two name models differently

Three things to check on the server side:

1. **CORS.** The page runs in a browser, so the server must allow its origin. vLLM:
   `--allowed-origins '["http://localhost:8000"]'`. Without this every request fails before it
   is sent, and the browser console says so while the network tab shows nothing useful.
2. **Structured output.** The app asks for `response_format: json_schema` with `strict: true`.
   vLLM and recent Ollama support it. If yours does not, set `structured: false` on the model in
   `MODELS` — the app then sends a plain-JSON instruction and parses defensively.
3. **Both models must be served.** Confidence is measured by agreement between the primary model
   and `VERIFY.modelId`, so the verifier has to be loaded too. If only one model is available,
   turn the second opinion off in the UI and accept that confidence becomes meaningless — the 30B
   reports a flat 0.95 for every field.

On a local server there is no API key in anyone's browser, which removes the reason the proxy
below was mandatory.

## Moving the key behind a proxy

Required before this is hosted for more than one or two trusted machines. The change is confined
to `js/openrouter.js`:

1. Stand up a minimal server endpoint, e.g. `POST /api/ocr`, holding the OpenRouter key
   server-side and forwarding to `https://openrouter.ai/api/v1/chat/completions`.
2. In `openrouter.js`, point `send()` at that endpoint and drop the `Authorization` header and
   the whole `Key` object.
3. Delete the settings dialog wiring in `app.js` (`initSettings`) and the dialog markup.

Nothing in `image.js`, `state.js`, `form.js`, `viewer.js` or the field config changes. The larger
backend described in `main project documentation` — document types from markdown files, a parser,
image preparation, validation with per-field probabilities — would sit behind that same endpoint.

## Browser requirements

`fetch`, `Promise.finally`, `AbortController`, `<dialog>`, `backdrop-filter`, pointer events,
`createImageBitmap`. Current Chrome, Edge and Firefox are fine. No IE, no legacy Safari.
