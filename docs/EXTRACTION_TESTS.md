# EXTRACTION TESTS

Live runs against the OpenRouter API, using the real `js/prompt.js` and the real schema generated
from `js/config.js` (a harness parses both out of the source files, so a test cannot drift from
the app).

---

## Run 2026-11-13 — final prompt, all 5 samples × 3 models

Settings: temperature 0, strict `json_schema`, original JPEG bytes (every sample is already
under the 2000 px limit, so the app sends them untouched), no pre-processing.

Scoring: every contract field plus the 6 extra fields compared against ground truth read off the
document by eye. `harmful_factors` scores as one item, passing only if all expected key phrases
are present.

| Sample | Type | 8B | 30B | 235B |
|---|---|---|---|---|
| A — `09.04.03` | blank template | **30/30** | **30/30** | **30/30** |
| B — `09.34.31` | typed, photographed | 29/30 | 29/30 | **30/30** |
| C — `209.34.30` | typed, no NIP on page | 27/30 | 27/30 | **30/30** |
| D — `039.34.31` | handwritten (STAL-MET) | 24/26 | 24/26 | **26/26** |
| E — `09.34.431` | handwritten (KOP-BUD) | 26/27 | 24/27 | **27/27** |
| **Total** | | **136/143 (95.1 %)** | **134/143 (93.7 %)** | **143/143 (100 %)** |

Latency (single page): 8B 7–11 s · 30B 5–14 s · 235B 13–35 s.
Prompt size ≈ 4 100 tokens, response ≈ 500 tokens. Cost per document ≈ $0.0009 (30B) /
$0.0018 (235B).

### What came out wrong, and whose fault it is

| Sample / model | Field | Got | Wanted | Verdict |
|---|---|---|---|---|
| B, C, D, E / 8B + 30B | `extra.exam_type` | `wstępne` | `not found` | **Model limit.** Nothing is circled on any sample — verified by cropping and inspecting the title line. The smaller models always answer with the first printed option. The 235B answers correctly on all five. |
| C / 8B | `nip`, `noNip` | `0000000000`, `false` | `not found`, `true` | **Model limit.** Sample C's employer block genuinely has no NIP. The 8B invents a placeholder. Not fixable by prompting — three attempts failed. |
| C / 30B | `address_company` | `ul. Robotnicza 14` | `Robotnicza 14` | Cosmetic, intermittent. The same model strips the prefix correctly on sample B. |
| C / 30B | `description_position` | `""` | `Kierowca samochodu…` | Intermittent miss on an identical field it reads on sample B. |
| D / 30B | `address_company` | `ul. Hutnicza 24` | `Hutnicza 24` | Same cosmetic prefix issue. |
| D / 8B | `harmful_factors` | missing `krzemionkę` | — | Handwriting. Dropped one phrase from section II. |
| E / 30B | `patient_street_name` | `Górnica` | `Górnicza` | Handwriting misread, one character. |
| E / 30B | `address_company` | `ul. Szyby Rycerskie 12` | `Szyby Rycerskie 12` | Same cosmetic prefix issue. |

**Diacritics: perfect on every run, every model.** ą ć ę ł ń ó ś ź ż survive the full round trip
(an early "failure" was PowerShell's console rendering UTF-8 as ANSI, not the model).

**Blank template handling: perfect on every model.** Sample A returns all 24 fields as
`"not found"` with both booleans `true`, and nothing hallucinated. This was the case most at risk
and it needed no tuning.

---

## Prompt changes made during this run, and their effect

### 1. `birthdate` derived from the PESEL — FIXED

30B returned `birthdate: "1978-04-12"` from PESEL `78041203456`, violating the "never derive" rule.

*Change:* expanded rule 3 from one line into a five-line block that names the exact failure:
> *"the PESEL encodes the date of birth in its first six digits. You must STILL return 'not found'…
> Returning '1978-04-12' because the PESEL begins 780412 is WRONG."*

*Result:* fixed immediately, and held across all later runs on all three models.

### 2. `ul.` prefix left in `address_company` — PARTIALLY FIXED

*Change:* added an explicit instruction under rule 6 covering the employer block as well as the
patient line, with two worked examples.

*Result:* fixed on sample B, still fails intermittently on C, D and E with the 30B. The 235B is
correct everywhere. Cosmetic, and the operator sees it on screen.

### 3. `exam_type` always `wstępne` — NOT FIXED on 8B/30B

*Changes tried, in order:*
1. Rewrote the `extra` table row to require a "HANDMADE mark". No change.
2. Added rule 12, *"never pick the first option by default"*, naming all four slash-separated
   template alternatives. No change.
3. Tightened the `schemaDesc` in `config.js` to match. No change on 8B/30B.

*Result:* the 235B now gets it right on all five samples; the 8B and 30B do not. Declared a model
limit and documented as such. It is an `extra` field, outside the 24-key contract.

### 4. Fabricated NIP — FIXED on 30B, NOT on 8B, and a lesson

*First attempt:* rule 11 listed the forbidden values explicitly —
*"never emit a filler such as 0000000000 or 1234567890"*.

*Result: it got worse.* The 30B, which had been emitting PESEL digits, started emitting
`1234567890` — the exact string the rule had just taught it. It also dropped
`description_position` on the same run. **Naming a forbidden token makes it available.**

*Second attempt:* rewrote the rule positively, describing the behaviour instead of the token:
> *"An identifier is read, never reconstructed… Each digit you emit must be one you can see…
> an employer block holding only a name, a street and a city is complete and normal, not an
> omission for you to repair."*

*Result:* 30B fixed (`nip: "not found"`, `noNip: true`). The 8B still emits `0000000000`.

---

## Conclusion on model choice

- **235B — use it.** 143/143, including the two fully handwritten referrals and the two cases the
  smaller models get wrong. Slower (13–35 s) and about twice the cost, which is $0.0018 a document.
- **30B — acceptable with review.** Cosmetic slips and one handwriting misread. Never fabricated
  an identifier after the rule-11 fix.
- **8B — not recommended.** Its score looks competitive, but one of its misses is a **fabricated
  NIP that passes as real data**. For a tool whose purpose is trustworthy transcription, a
  plausible invented identifier is the worst possible failure mode. Keep it for smoke-testing only.

The default in `js/config.js` is the 30B, as specified in the brief. Changing
`DEFAULT_MODEL_ID` to `qwen/qwen3-vl-235b-a22b-instruct` is the recommended one-line change.

---

## Not yet tested

- Multi-page PDFs end to end (the pdf.js path is implemented but no multi-page sample exists —
  **please add one**).
- Several separate image files merged into one record.
- The pre-processing toggle (greyscale + contrast). Worth A/B-ing on samples D and E, the
  handwritten ones, where it should help most.
- The plain-JSON fallback path (all three Qwen models support strict structured output, so it
  never fired). It would be exercised by adding a GLM vision model.
- `nationality`, `birthdate`, `email`, `phone`, `regon`, `country_company` and a `true` `noNip`
  with real content — no sample document contains any of them.
