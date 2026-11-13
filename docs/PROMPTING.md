# PROMPTING

The live prompt is the `EXTRACTION_PROMPT_TEMPLATE` constant in `js/prompt.js`. Nothing else is
in that file. `prompts/extraction.md` is a generated mirror for reading; regenerate it after
every edit (snippet at the bottom of this page).

`{{EMPTY}}` is substituted with `App.Config.EMPTY_VALUE` (currently `"not found"`) at send time,
so the prompt and the app can never disagree about what "absent" looks like.

---

## Structure, and why each part is there

### 1. Role and document identity

> *"You are a precise document transcription engine… The document is a Polish SKIEROWANIE NA
> BADANIA LEKARSKIE, issued under art. 229 § 4a…"*

Naming the exact statutory form matters more than it sounds. These models have seen this template.
Once named, the model knows which text is pre-printed boilerplate and which is filled-in data —
which is the single hardest judgement on this document, because in two of the five samples the
filled-in text uses the same font as the template.

### 2. The layout walkthrough (11 numbered zones)

Positional grounding. The address line is labelled `(miejscowość, ulica, nr domu, nr lokalu)` on
the page itself; telling the model where each label sits lets it anchor on the Polish label rather
than on guessing from content. Also carries the warning that handwriting overflows its dotted line
and must be assigned by the label it *starts* next to, not the row it visually overlaps — samples D
and E both do this heavily.

### 3. The field tables

One row per key: what it is, where it is, and the gotcha. Two tables, `record` (the 24-key
contract) and `extra` (data the document carries that the contract drops).

### 4. The rules (1–13)

| # | Rule | Why it exists |
|---|---|---|
| 1 | Absent means `"not found"` | The contract's core guarantee. An operator correcting a blank is cheap; an operator failing to notice an invented value is expensive. |
| 2 | Transcribe, don't translate; keep every diacritic | ą ć ę ł ń ó ś ź ż survive end to end. Verified against all five samples. |
| 3 | **Do not derive** | The 30B computed `birthdate: "1978-04-12"` from PESEL `780412…`. Fixed by naming the exact failure in the rule. |
| 4 | Types: strings except two booleans | |
| 5 | Normalise only dates, postal codes, phones | Everything else verbatim. "Keep it verbatim rather than guess" is explicit. |
| 6 | Split the address line; strip `ul.` / `al.` / `os.` | One free-text line becomes five fields. Two worked examples from the samples. |
| 7 | Merge factor sections I–V with their labels | Lossless and splits cleanly later. `brak` / `nie dotyczy` is content, not absence. |
| 8 | Keep employer and patient addresses apart | Two addresses on one page; the obvious confusion. |
| 9 | A signature squiggle is not a name | |
| 10 | Several images are ONE document | Multi-page / multi-file merging. |
| 11 | An identifier is read, never reconstructed | The 8B emitted `0000000000` for a missing NIP. |
| 12 | Never pick the first option by default | The slash-separated template alternatives. Partially effective — see below. |
| 13 | Illegible is not absent | Better a best-effort reading than a false blank. |

---

## How to tune it when a field comes out badly

**Work in this order. Stop at the first step that fixes it.**

1. **Check the ground truth first.** Crop the region and look at it before you change anything.
   I nearly "fixed" `exam_type` before confirming that nothing on the page is actually marked.

2. **Fix the `schemaDesc`, not just the prompt.** Each field's `schemaDesc` in `js/config.js` is
   injected into the structured-output JSON schema, and the model weighs it heavily — sometimes
   above the prompt prose. A prompt rule that contradicts a `schemaDesc` tends to lose. Change both.

3. **Name the exact failure, with the wrong value, as a negative example.** This is what fixed the
   `birthdate`-from-PESEL derivation:

   > *"Returning '1978-04-12' because the PESEL begins 780412 is WRONG."*

4. **But never name a fabricated value you don't want.** The opposite of step 3, and a trap I fell
   into. Rule 11 originally read *"never emit a filler such as 0000000000 or 1234567890"*. The 30B
   then emitted `1234567890` — a value it had not produced before. **Naming a forbidden string
   teaches it.** Rewriting the rule positively ("each digit you emit must be one you can see")
   fixed the 30B immediately. Describe the *behaviour* you want, not the token you fear.

5. **Add a worked example from a real sample.** The address splitter works because it shows
   `"Warszawa, ul. Kwiatowa 5 m. 12, 01-234 Warszawa"` broken into its five parts.

6. **Re-run the whole matrix, not just the failing case.** A rule that fixes one field can break
   another (step 4 also cost `description_position` on one run).

7. **If it still fails on the 8B/30B but passes on the 235B, it is a capability limit, not a
   prompt bug.** Record it in `EXTRACTION_TESTS.md` and stop tuning. Two of the known issues are
   exactly this.

### What did not work

- Repeating an instruction more forcefully. `exam_type` was told three different ways and the 8B
  and 30B still answer `wstępne`. Only the 235B gets it right.
- Tightening `schemaDesc` alone for `exam_type`. No measurable change on the smaller models.

---

## Testing a prompt change

Record every run in `docs/EXTRACTION_TESTS.md`: file, model, fields that came out wrong, what
changed in the prompt as a result. That table is the evidence for whether the 8B is good enough or
whether the 235B is needed.

The quickest loop is the browser itself: edit `js/prompt.js`, hard-refresh, press
**Re-run extraction** on screen 2 — same file, no re-upload. Switch models in the header to
compare. The **Raw response** panel shows exactly what came back, before parsing.

## Regenerating the mirror

After editing `js/prompt.js`, from the project root in PowerShell:

```powershell
$lines = Get-Content "js\prompt.js" -Encoding UTF8
$start = ($lines | Select-String -SimpleMatch 'var EXTRACTION_PROMPT_TEMPLATE = [' | Select-Object -First 1).LineNumber
$out = New-Object System.Collections.Generic.List[string]
for ($i = $start; $i -lt $lines.Count; $i++) {
    $raw = $lines[$i]
    if ($raw -match "^\s*\]\.join\(") { break }
    $t = $raw.Trim()
    if ($t.EndsWith(',')) { $t = $t.Substring(0, $t.Length - 1) }
    if ($t.StartsWith("'") -and $t.EndsWith("'")) { $t = $t.Substring(1, $t.Length - 2) }
    $out.Add($t.Replace("\'", "'"))
}
$header = "<!-- GENERATED MIRROR - do not edit by hand. Source: js/prompt.js -->`n`n# Extraction prompt (mirror of js/prompt.js)`n"
$body = $header + "`n``````text`n" + ($out -join "`n") + "`n``````;`n"
[System.IO.File]::WriteAllText("prompts\extraction.md", $body, (New-Object System.Text.UTF8Encoding($false)))
```
