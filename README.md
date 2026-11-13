# Document OCR — referral transcription

A single-page browser app that reads a photo or scan of a Polish
**skierowanie na badania lekarskie** (employer referral for occupational medical
examinations), sends it to a vision model through OpenRouter, and returns a structured
24-field JSON record that an operator reviews and corrects side by side with the document.

No build step. No framework. No backend.

**The interface is in Polish. Field names in the code and in the exported JSON are English** and
are never translated — they are the contract with whatever consumes the output. See
`docs/ARCHITECTURE.md`, "Language", for the three places Polish text lives.

---

## Running it

**Option A — double-click.** Open `index.html`. It works from `file://`.

**Option B — static server** (recommended; needed if your browser restricts `file://`):

```powershell
cd "C:\Users\oscar\Desktop\Image Optimization"
python serve.py
```

then open <http://localhost:8000>.

> **Use `serve.py`, not `python -m http.server`.** The stdlib server sends no cache headers, so
> after you edit a file the browser keeps running the old one. That shows up as a runtime error
> naming a function that is plainly there on disk (`App.T.phaseReading is not a function`), and it
> will cost you an hour. `serve.py` is the same thing with caching disabled.
> `python serve.py 8080` picks another port.

## Publishing it on GitHub Pages

The app is static with no build step, so Pages serves it as-is. Asset paths are all relative, so it
works from `https://<user>.github.io/<repo>/` without changes.

**Upload exactly these, and nothing else:**

```
index.html   .nojekyll   README.md
css/   js/   prompts/   docs/
```

**Never upload `txt`, `.env`, `sample docuemnts/`, or `main project documentation`.**
`.gitignore` already excludes them — but **`.gitignore` only works through git.** If you drag a
folder into GitHub's web uploader it is ignored entirely and everything goes up, including the key
file and the referral forms. With the web uploader, pick the files by hand.

Then: repo **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**. The URL appears
in a minute or two.

### What each person needs

Everyone who opens the link enters **their own** OpenRouter key once, stored in their own browser.
Nothing is shared and no key ever reaches GitHub. If they have no key, the page cannot call the
model and nothing will happen.

### Before real operators use it

A public Pages site with a browser-held key is fine for showing someone the app. It is not fine as
the way a team works every day: a key in a browser cannot be scoped per person or revoked
individually. Move the key behind a proxy first — see `docs/ARCHITECTURE.md`, "Moving the key
behind a proxy". GitHub Pages cannot host that (it serves static files only); Cloudflare Pages,
Netlify and Vercel can, and are equally free.

## Setting the API key

On first load the app asks for an OpenRouter API key and stores it in that browser's
`localStorage`. It is never written into the project files.

- Change or remove it any time via **Settings** in the header (**Clear key** removes it).
- Get a key at <https://openrouter.ai/keys>.
- `.env.example` documents the variable name for a future backend proxy. `.env` and the
  `txt` key file are gitignored.

> **Security.** A key in the browser is readable by anyone who can open that browser's
> devtools or profile, cannot be scoped per operator, and cannot be revoked individually.
> That is acceptable for a handful of trusted machines. **Before this is hosted for several
> operators, the key must move behind a small backend proxy** — see
> `docs/ARCHITECTURE.md`, "Moving the key behind a proxy".

## Using it

1. **Upload.** Drop files onto the zone or pick them. Several files are treated as pages of
   **one** document, in the order you add them. Remove or replace any of them before continuing.
2. Optionally tick **Pre-process image** (greyscale + contrast stretch). Off by default.
3. Press **Extract**. The overlay shows the model, the payload size and elapsed time, and can
   be cancelled.
4. **Review.** The document is on the left (scroll to zoom, drag to pan, fit width / fit page,
   page arrows for multi-page). The form is on the right. Edit anything; fields reformat on blur.
5. **Copy JSON** or **Download JSON**. Esc goes back to the upload screen.

### Supported formats

PNG, JPG/JPEG, WEBP, PDF. Up to 8 pages per document (`LIMITS.maxPages` in `js/config.js`).

### Models

Picked in the header, remembered between sessions.

| Model | Slug | Notes |
|---|---|---|
| Qwen3 VL 235B A22B Instruct | `qwen/qwen3-vl-235b-a22b-instruct` | **Default.** 143/143 on the sample set, and the only model whose per-field confidence varies — the review screen does not function without that. ~$0.0018/document, slower. |
| Qwen3 VL 30B A3B Instruct | `qwen/qwen3-vl-30b-a3b-instruct` | Cheaper and faster, but returns a flat `0.95` for every field, so confidence thresholds never fire. |
| Qwen3 VL 8B Instruct | `qwen/qwen3-vl-8b-instruct` | Testing only. **Fabricates a NIP when the document has none**, and also returns flat confidence. |

## Output

Exactly 24 keys, always in this order, strings except `noPesel` / `noNip`:

```json
{
  "f_name": "Janusz",
  "l_name": "Kowalski",
  "nationality": "not found",
  "pesel": "78041203456",
  "noPesel": false,
  "birthdate": "not found",
  "patient_street_name": "Kwiatowa",
  "patient_house_number": "5",
  "patient_unit_id": "12",
  "zip_code": "01-234",
  "city": "Warszawa",
  "email": "not found",
  "phone": "not found",
  "name_company": "P.P.H.U. \"TRANS-BUD\" Sp. z o.o.",
  "nip": "5213456789",
  "regon": "not found",
  "country_company": "not found",
  "address_company": "Robotnicza 14",
  "zip_code_company": "00-001",
  "city_company": "Warszawa",
  "noNip": false,
  "name_position": "Kierowca samochodu ciężarowego powyżej 3,5t",
  "description_position": "Kierowca samochodu ciężarowego powyżej 3,5t",
  "harmful_factors": "I. Czynniki fizyczne: hałas…; II. Pyły: brak; …"
}
```

- A field not present on the document is the string **`"not found"`**, never `null`, never a
  guessed value. Change `EMPTY_VALUE` in `js/config.js` to switch this back to `""`.
- `birthdate` is `YYYY-MM-DD`, postal codes `NN-NNN`, phone `+48NNNNNNNNN`. A value that cannot
  be normalised confidently is kept verbatim rather than guessed at.
- Polish diacritics (ą ć ę ł ń ó ś ź ż) are preserved exactly, end to end. Verified.

**Additional data** the document carries but the contract has no room for — issue place and
date, examination type, declared factor count, signatory name and role — is captured and shown
in its own collapsible panel with its own copy button. It is deliberately **excluded** from
"Download JSON" so the agreed contract stays exactly 24 keys.

## Known limits

- **Iteration 1 does not validate anything.** No confidence scores, no PESEL/NIP/REGON checksums,
  no cross-field checks. The operator is the validation. Hook points are documented in
  `docs/DECISIONS.md`.
- **`exam_type` (wstępne / okresowe / kontrolne) is unreliable** on the 8B and 30B: they report
  the first option even when nothing is marked. The 235B gets it right. It is extra data, not
  part of the contract — treat it as a suggestion the operator confirms.
- **The 8B invents a NIP** when the employer block has none. Do not use the 8B for production work.
- **The 30B occasionally keeps the `ul.` prefix** in `address_company`, and misread one handwritten
  street name (`Górnica` for `Górnicza`).
- PDFs need an internet connection for the pdf.js CDN script. Images do not.
- Seven contract fields (`nationality`, `birthdate`, `email`, `phone`, `regon`, `country_company`,
  and a true `noNip`) do not appear on this document type at all. They are verified to come back
  as `"not found"`, but their extraction path is untested.

## A note on confidence

Each field comes back with a confidence from 0 to 1, shown as a bar next to the value. Treat it as
a rough sort order, not a probability:

- It is **self-reported by the model.** Real token probabilities would be better, but OpenRouter's
  `logprobs` are unusable for these models — one provider drops them, another returns a token
  stream that does not match the text it emitted.
- On the 235B it **ranks** sensibly (long handwritten passages and ambiguous characters score
  lowest) but sits in a narrow 0.85–1.00 band. That is why the thresholds in `js/config.js` are
  0.95 / 0.98 / 0.99 and not the 0.75 / 0.90 you might expect.
- On the 30B and 8B it is a **flat 0.95 for every field** and carries no information at all. The app
  detects this, hatches the bars and says so rather than pretending.

**The errors you can actually trust come from validation, not confidence**: PESEL, NIP and REGON
checksums, date and format checks, and the birthdate/PESEL cross-check. Those are arithmetic.

## Documentation

| File | What it covers |
|---|---|
| `CLAUDE.md` | Resume-cold summary: state, constraints, conventions, open questions |
| `docs/ARCHITECTURE.md` | File map, data flow, where to change the model list / prompt / field config |
| `docs/PROMPTING.md` | The extraction prompt, why each instruction exists, how to tune it |
| `docs/DECISIONS.md` | Every assumption and trade-off |
| `docs/EXTRACTION_TESTS.md` | Per-sample, per-model results and what changed in the prompt |
| `docs/WORKLOG.md` | Session log |
| `docs/PLAN.md` | The iteration-1 plan and the sample analysis it came from |
