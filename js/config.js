/* =============================================================================
 * config.js — the ONE place to change models, fields, limits and the schema.
 *
 * LANGUAGE RULE (Oscar's manager, 2026-11-13):
 *   - `key`        -> ENGLISH. It is the exported JSON key. Never translate it.
 *   - `label`      -> POLISH. It is what the operator reads.
 *   - `group`      -> POLISH. Section heading in the form.
 *   - `schemaDesc` -> ENGLISH. It is an instruction to the model, not UI.
 *   - code, comments, docs -> ENGLISH.
 *
 * Edit here to:
 *   - add / remove an AI model          -> MODELS
 *   - add / remove / relabel a field    -> FIELD_DEFS  (and EXPORT_ORDER)
 *   - change what counts as "empty"     -> EMPTY_VALUE
 *   - change image limits / timeouts    -> LIMITS
 *
 * The JSON schema sent to the model is GENERATED from FIELD_DEFS + EXTRA_DEFS
 * at the bottom of this file, so the schema can never drift from the form.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  /* ---------------------------------------------------------------------- *
   * 1. MODELS
   * Slugs verified against GET https://openrouter.ai/api/v1/models.
   * `structured` = model advertises strict structured outputs (json_schema).
   * Models without it fall back to a plain-JSON instruction + defensive parse.
   * ---------------------------------------------------------------------- */
  /* ---------------------------------------------------------------------- *
   * MODELS
   *
   * Manager, 2026-11-13: 30B is the CEILING. The 235B is not available, so it
   * is not listed here — re-adding it is a deliberate act, not an accident.
   *
   * `id`      slug on OpenRouter (testing)
   * `localId` model name on the local inference server (production) — these
   *           differ, so both are kept and API.mode picks one
   * `structured` model/server supports strict json_schema. Local servers vary;
   *           set false and the app falls back to plain JSON + defensive parse.
   * ---------------------------------------------------------------------- */
  var MODELS = [
    {
      id: 'qwen/qwen3-vl-8b-instruct',
      localId: 'Qwen/Qwen3-VL-8B-Instruct',
      label: 'Qwen3 VL 8B Instruct',
      note: 'Najszybszy, ale najmniej dokładny — potrafi zmyślić NIP, gdy go nie ma. Ma też tylko jednego dostawcę, więc bywa blokowany (błąd 429).',
      structured: true
    },
    {
      id: 'qwen/qwen3-vl-30b-a3b-instruct',
      localId: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      label: 'Qwen3 VL 30B A3B Instruct',
      note: 'Domyślny. Dobra dokładność, stabilna dostępność.',
      structured: true
    },
    {
      id: 'qwen/qwen3-vl-235b-a22b-instruct',
      localId: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
      label: 'Qwen3 VL 235B A22B Instruct',
      note: 'Najdokładniejszy (bezbłędny na próbkach), ale najwolniejszy.',
      structured: true
    }
  ];

  /* Oscar, 2026-11-13: the 30B is the default. All three stay in the dropdown.
   *
   * Two reasons it is not the 8B: the 8B fabricated a NIP on a sample document
   * that has none (a plausible invented identifier is the worst failure mode
   * here, because nothing downstream can tell it from a real reading), and on
   * OpenRouter it is served by a single provider, so a throttle there returns
   * 429 with nothing to reroute to. The 30B has three providers. */
  var DEFAULT_MODEL_ID = 'qwen/qwen3-vl-30b-a3b-instruct';

  /* ---------------------------------------------------------------------- *
   * API ENDPOINT
   *
   * OpenRouter was only ever the test harness. Production is a local
   * inference server on the same network. Both speak the OpenAI chat
   * completions shape, so only these three values change.
   *
   * To switch to the local server, set mode to 'local' and point `local.url`
   * at it. Nothing else in the app needs touching — see
   * docs/ARCHITECTURE.md, "Running against a local model server".
   * ---------------------------------------------------------------------- */
  var API = {
    mode: 'openrouter',          // 'openrouter' | 'local'

    openrouter: {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      requiresKey: true
    },

    local: {
      // vLLM:       http://<host>:8000/v1/chat/completions
      // Ollama:     http://<host>:11434/v1/chat/completions
      // LM Studio:  http://<host>:1234/v1/chat/completions
      url: 'http://localhost:8000/v1/chat/completions',
      requiresKey: false
    }
  };

  function endpoint() { return API[API.mode]; }

  /**
   * Which model gives the second opinion for a given primary.
   *
   * Confidence is measured by agreement, which is meaningless if both reads
   * come from the same model. Returns null when the list holds only one model,
   * and the caller then skips verification and says so.
   */
  function verifyModelFor(primaryId) {
    if (VERIFY.preferredId && VERIFY.preferredId !== primaryId) return VERIFY.preferredId;
    var other = MODELS.filter(function (m) { return m.id !== primaryId; })[0];
    return other ? other.id : null;
  }

  /** The model name to send, which differs between OpenRouter and a local server. */
  function modelNameFor(modelId) {
    var model = MODELS.filter(function (m) { return m.id === modelId; })[0];
    if (!model) return modelId;
    return API.mode === 'local' ? (model.localId || model.id) : model.id;
  }

  /* ---------------------------------------------------------------------- *
   * 2. EMPTY VALUE
   * Oscar, 2026-11-13: a field with nothing on the document reads "not found".
   * The original brief said "" (empty string). Change this one constant to
   * switch the whole app back. Booleans are unaffected.
   *
   * NOTE: this value also goes into the exported JSON, so it stays ENGLISH
   * even though the interface is Polish. It is data, not interface.
   * ---------------------------------------------------------------------- */
  var EMPTY_VALUE = 'not found';

  /* ---------------------------------------------------------------------- *
   * 3. LIMITS
   * ---------------------------------------------------------------------- */
  var LIMITS = {
    /* Manager, 2026-11-13: scale to roughly 1100-1200 px of HEIGHT before
     * sending. These referrals are portrait A4, so height is the page's long
     * edge — 1150 px is about 100 dpi, which still resolves handwriting while
     * cutting the payload by around two thirds versus the old 2000 px.
     * `maxImageSide` remains as a guard for landscape or odd-shaped scans, so
     * a very wide image cannot blow up the request. */
    targetHeight: 1150,
    maxImageSide: 2000,          // px, safety cap on the long edge
    jpegQuality: 0.85,
    maxPages: 8,                 // pages sent in one request
    // The 235B with the record+confidence+extra schema has been measured at
    // 134 s on a dense handwritten page, so 90 s was cutting real work off.
    requestTimeoutMs: 240000,
    // record (24) + confidence (24) + extra (6) is roughly 1.5x the old payload.
    maxTokens: 6000,
    temperature: 0,
    acceptedTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
    acceptedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.pdf'],
    preprocessByDefault: false   // greyscale + contrast stretch toggle
  };

  /* ---------------------------------------------------------------------- *
   * 3b. VERIFICATION PASS
   *
   * Confidence is MEASURED, not asked for: a second, cheaper model reads the
   * same pages and each field's confidence is how closely the two readings
   * agree. See js/agreement.js for why self-reported confidence is unusable.
   *
   * Adds roughly $0.0009 and 10-20 s per document. Turn it off and the app
   * falls back to the model's own (flat, meaningless) numbers.
   * ---------------------------------------------------------------------- */
  var VERIFY = {
    /* Oscar, 2026-11-13: one scan with the selected model by default.
     *
     * The cost is specific and worth knowing: with a single read, confidence
     * falls back to what the model reports about itself, and every model here
     * returns a near-flat 0.95 for all 24 fields. The bars become decoration.
     * The review screen still works — validation (checksums, formats,
     * cross-checks) is unaffected and is what catches real errors.
     *
     * The operator can switch the second read back on per document with the
     * toggle on the upload screen. Flip this to true to make that the default
     * again. */
    enabledByDefault: false,
    // Preferred second reader. Agreement needs two DIFFERENT models, so when
    // the operator picks this one as the primary, `verifyModelFor` falls back
    // to another from the list rather than silently disabling confidence.
    preferredId: 'qwen/qwen3-vl-30b-a3b-instruct',
    // Verification must never hold up a result: if it fails or times out the
    // primary extraction still stands, with a note in the UI.
    timeoutMs: 120000
  };

  var STORAGE_KEYS = {
    apiKey: 'dococr.apiKey',
    // Bumped to .v2 when the default moved to the 235B: a remembered choice
    // overrides the default, so without this everyone would silently stay on
    // the 30B. Bump again if the default ever changes for a reason operators
    // should be re-exposed to. The API key is deliberately NOT versioned.
    // Bumped whenever the default model changes: a remembered choice overrides
    // the default, so without this nobody would ever see the new one.
    model: 'dococr.model.v4',
    preprocess: 'dococr.preprocess',
    // Bumped with the default flip to off, for the same reason as the model
    // key: a remembered "on" would override it and nobody would see the change.
    verify: 'dococr.verify.v2'
  };


  /* ---------------------------------------------------------------------- *
   * 4. FIELD_DEFS — the contract fields, in display order, grouped.
   *
   *   key         exported JSON key          ENGLISH, never translated
   *   label       form label                 POLISH
   *   type        'text' | 'textarea' | 'boolean'
   *   group       form section               POLISH
   *   normaliser  name resolved in state.js (App.State.normalisers)
   *   polishLabel the wording printed on the document, shown as a hint
   *   schemaDesc  one line handed to the model inside the JSON schema  ENGLISH
   * ---------------------------------------------------------------------- */
  var FIELD_DEFS = [
    /* --- Pacjent -------------------------------------------------------- */
    { key: 'f_name', label: 'Imię', type: 'text', group: 'Pacjent',
      normaliser: 'trim', polishLabel: 'Pana/Panią… (imię)',
      schemaDesc: 'Given name(s) of the person being referred.' },
    { key: 'l_name', label: 'Nazwisko', type: 'text', group: 'Pacjent',
      normaliser: 'trim', polishLabel: 'Pana/Panią… (nazwisko)',
      schemaDesc: 'Family name of the person being referred.' },
    { key: 'nationality', label: 'Obywatelstwo', type: 'text', group: 'Pacjent',
      normaliser: 'trim', polishLabel: 'obywatelstwo / narodowość',
      schemaDesc: 'Nationality, only if explicitly written on the document. Never inferred.' },
    { key: 'pesel', label: 'PESEL', type: 'text', group: 'Pacjent',
      normaliser: 'digits', polishLabel: 'nr PESEL**)',
      schemaDesc: 'Polish national identification number, 11 digits.' },
    { key: 'noPesel', label: 'Brak numeru PESEL na dokumencie', type: 'boolean', group: 'Pacjent',
      normaliser: null, polishLabel: '',
      schemaDesc: 'true when no PESEL number is present on the document, otherwise false.' },
    { key: 'birthdate', label: 'Data urodzenia', type: 'text', group: 'Pacjent',
      normaliser: 'date', polishLabel: 'data urodzenia',
      schemaDesc: 'Date of birth as YYYY-MM-DD, only if written on the document. Never derived from the PESEL.' },

    /* --- Adres pacjenta ------------------------------------------------- */
    { key: 'patient_street_name', label: 'Ulica', type: 'text', group: 'Adres pacjenta',
      normaliser: 'trim', polishLabel: 'zamieszkałego… (ulica)',
      schemaDesc: 'Street name only, without the "ul." prefix and without the house number.' },
    { key: 'patient_house_number', label: 'Nr domu', type: 'text', group: 'Adres pacjenta',
      normaliser: 'trim', polishLabel: 'zamieszkałego… (nr domu)',
      schemaDesc: 'House/building number only.' },
    { key: 'patient_unit_id', label: 'Nr lokalu', type: 'text', group: 'Adres pacjenta',
      normaliser: 'trim', polishLabel: 'zamieszkałego… (nr lokalu)',
      schemaDesc: 'Apartment/unit number, the part after "m." or "/". Empty when the address has none.' },
    { key: 'zip_code', label: 'Kod pocztowy', type: 'text', group: 'Adres pacjenta',
      normaliser: 'zip', polishLabel: 'kod pocztowy',
      schemaDesc: 'Patient postal code in NN-NNN format.' },
    { key: 'city', label: 'Miejscowość', type: 'text', group: 'Adres pacjenta',
      normaliser: 'trim', polishLabel: 'zamieszkałego… (miejscowość)',
      schemaDesc: 'Patient city/town of residence.' },

    /* --- Kontakt -------------------------------------------------------- */
    { key: 'email', label: 'E-mail', type: 'text', group: 'Kontakt',
      normaliser: 'trim', polishLabel: 'e-mail',
      schemaDesc: 'Patient e-mail address. Rare on this document type.' },
    { key: 'phone', label: 'Telefon', type: 'text', group: 'Kontakt',
      normaliser: 'phone', polishLabel: 'telefon',
      schemaDesc: 'Patient phone number as +48NNNNNNNNN. Rare on this document type.' },

    /* --- Pracodawca ----------------------------------------------------- */
    { key: 'name_company', label: 'Nazwa firmy', type: 'text', group: 'Pracodawca',
      normaliser: 'trim', polishLabel: '(oznaczenie pracodawcy)',
      schemaDesc: 'Employer name including legal form, e.g. P.P.H.U. "TRANS-BUD" Sp. z o.o.' },
    { key: 'nip', label: 'NIP', type: 'text', group: 'Pracodawca',
      normaliser: 'digits', polishLabel: 'NIP',
      schemaDesc: 'Employer tax identification number, 10 digits, read from the employer block only. Many referrals have no NIP at all; then this is empty and noNip is true. Never emit a placeholder, and never reuse the digits of the patient PESEL.' },
    { key: 'noNip', label: 'Brak numeru NIP na dokumencie', type: 'boolean', group: 'Pracodawca',
      normaliser: null, polishLabel: '',
      schemaDesc: 'true when no NIP number is printed anywhere on the document, otherwise false. Check the employer block before answering: a referral without a NIP line is normal.' },
    { key: 'regon', label: 'REGON', type: 'text', group: 'Pracodawca',
      normaliser: 'digits', polishLabel: 'REGON',
      schemaDesc: 'Employer statistical number, 9 or 14 digits. Rare on this document type.' },
    { key: 'country_company', label: 'Kraj firmy', type: 'text', group: 'Pracodawca',
      normaliser: 'trim', polishLabel: 'kraj',
      schemaDesc: 'Employer country, only if written on the document. Never inferred from a Polish address.' },
    { key: 'address_company', label: 'Adres firmy', type: 'text', group: 'Pracodawca',
      normaliser: 'trim', polishLabel: 'ulica i nr (pracodawca)',
      schemaDesc: 'Employer street and number, e.g. Robotnicza 14. Without "ul.", without postal code or city.' },
    { key: 'zip_code_company', label: 'Kod pocztowy firmy', type: 'text', group: 'Pracodawca',
      normaliser: 'zip', polishLabel: 'kod pocztowy (pracodawca)',
      schemaDesc: 'Employer postal code in NN-NNN format.' },
    { key: 'city_company', label: 'Miejscowość firmy', type: 'text', group: 'Pracodawca',
      normaliser: 'trim', polishLabel: 'miejscowość (pracodawca)',
      schemaDesc: 'Employer city/town.' },

    /* --- Stanowisko ----------------------------------------------------- */
    { key: 'name_position', label: 'Stanowisko', type: 'text', group: 'Stanowisko',
      normaliser: 'trim', polishLabel: '…pracę na stanowisku lub stanowiskach pracy',
      schemaDesc: 'Job position the person is employed in or applying for.' },
    { key: 'description_position', label: 'Określenie stanowiska', type: 'textarea', group: 'Stanowisko',
      normaliser: 'trim', polishLabel: 'określenie stanowiska/stanowisk*) pracy***)',
      schemaDesc: 'The separate "określenie stanowiska" line. Often blank even when the position above is filled.' },
    { key: 'harmful_factors', label: 'Czynniki szkodliwe', type: 'textarea', group: 'Stanowisko',
      normaliser: 'trim', polishLabel: 'I–V Czynniki fizyczne / Pyły / chemiczne / biologiczne / Inne',
      schemaDesc: 'All five factor sections I-V merged into one string, each prefixed with its Polish label and separated by "; ".' }
  ];

  /* ---------------------------------------------------------------------- *
   * 5. EXPORT_ORDER — the exact key order of the exported JSON.
   * This is the manager's contract. Do not reorder without his sign-off.
   * ---------------------------------------------------------------------- */
  var EXPORT_ORDER = [
    'f_name', 'l_name', 'nationality', 'pesel', 'noPesel', 'birthdate',
    'patient_street_name', 'patient_house_number', 'patient_unit_id',
    'zip_code', 'city', 'email', 'phone',
    'name_company', 'nip', 'regon', 'country_company', 'address_company',
    'zip_code_company', 'city_company', 'noNip',
    'name_position', 'description_position', 'harmful_factors'
  ];

  /* ---------------------------------------------------------------------- *
   * 6. EXTRA_DEFS — data the document carries that the 24-key contract drops.
   * Oscar, 2026-11-13: capture it, show it, but never alter the exported
   * contract. These are displayed in their own panel with their own copy
   * button and are NOT part of the downloaded record.
   * ---------------------------------------------------------------------- */
  var EXTRA_DEFS = [
    { key: 'issue_place', label: 'Miejscowość wystawienia', type: 'text', group: 'Dane dodatkowe',
      normaliser: 'trim', polishLabel: '(miejscowość)',
      schemaDesc: 'Town written in the top-right "miejscowość, data" line.' },
    { key: 'issue_date', label: 'Data wystawienia', type: 'text', group: 'Dane dodatkowe',
      normaliser: 'date', polishLabel: '(data)',
      schemaDesc: 'Date in the top-right "miejscowość, data" line, as YYYY-MM-DD.' },
    { key: 'exam_type', label: 'Rodzaj badania', type: 'text', group: 'Dane dodatkowe',
      normaliser: 'trim', polishLabel: '(wstępne/okresowe/kontrolne)',
      schemaDesc: 'Which of wstępne / okresowe / kontrolne has a handmade mark on it (circled, underlined in pen, or the other two struck out). The printed phrase itself marks nothing: if no ink was added, this field is empty. Do not pick the first option by default.' },
    { key: 'factors_count', label: 'Łączna liczba czynników', type: 'text', group: 'Dane dodatkowe',
      normaliser: 'trim', polishLabel: 'Łączna liczba czynników…',
      schemaDesc: 'The number written in the box at the bottom right.' },
    { key: 'signatory_name', label: 'Podpisujący', type: 'text', group: 'Dane dodatkowe',
      normaliser: 'trim', polishLabel: '(podpis pracodawcy)',
      schemaDesc: 'Printed name next to the employer signature, e.g. Jan Nowak. Not the handwritten squiggle.' },
    { key: 'signatory_role', label: 'Stanowisko podpisującego', type: 'text', group: 'Dane dodatkowe',
      normaliser: 'trim', polishLabel: 'stanowisko podpisującego',
      schemaDesc: 'Printed role next to the signature, e.g. Dyrektor ds. HR, Kierownik BHiP.' }
  ];

  /* ---------------------------------------------------------------------- *
   * 6b. FIELD FLAGS — review behaviour, kept out of FIELD_DEFS so the field
   * table above stays readable. Merged onto the defs at load.
   *
   *   critical  needs a higher confidence before it is auto-accepted, and is
   *             badged "krytyczne" in the form
   *   optional  routinely absent on this document type, so an empty value the
   *             model is confident about is auto-accepted instead of flagged
   *   quick     one-click values offered when the field is empty
   *   mono      render in a monospace font (identifiers, codes, dates)
   * ---------------------------------------------------------------------- */
  var FIELD_FLAGS = {
    critical: ['f_name', 'l_name', 'pesel', 'noPesel', 'birthdate', 'nip', 'noNip'],
    optional: ['nationality', 'birthdate', 'email', 'phone', 'regon',
               'country_company', 'description_position'],
    mono: ['pesel', 'nip', 'regon', 'zip_code', 'zip_code_company', 'phone',
           'birthdate', 'patient_house_number', 'patient_unit_id', 'issue_date',
           'factors_count'],
    quick: {
      nationality: ['polskie', 'ukraińskie', 'białoruskie'],
      country_company: ['Polska'],
      exam_type: ['wstępne', 'okresowe', 'kontrolne']
    },
    /* Fields rendered as a pick-one control rather than a text box. */
    choice: {
      exam_type: ['wstępne', 'okresowe', 'kontrolne']
    }
  };

  function applyFlags(defs) {
    defs.forEach(function (def) {
      def.critical = FIELD_FLAGS.critical.indexOf(def.key) !== -1;
      def.optional = FIELD_FLAGS.optional.indexOf(def.key) !== -1;
      def.mono = FIELD_FLAGS.mono.indexOf(def.key) !== -1;
      def.quick = FIELD_FLAGS.quick[def.key] || null;
      def.choice = FIELD_FLAGS.choice[def.key] || null;
    });
    return defs;
  }
  applyFlags(FIELD_DEFS);
  applyFlags(EXTRA_DEFS);

  /* ---------------------------------------------------------------------- *
   * 6c. REVIEW THRESHOLDS
   *
   * Tuned to what these models actually emit, which is NOT a 0-1 spread.
   * Measured on the sample set: the 235B uses 0.95-1.00; the 30B returns a
   * flat 0.95 for every field. See docs/EXTRACTION_TESTS.md.
   *
   *   >= critical  a `critical` field is auto-accepted
   *   >= high      an ordinary field is auto-accepted
   *   >= low       "sprawdź" — shown for a glance
   *   <  low       "niepewne" — shown with the value highlighted
   *
   * `flatSpreadEpsilon`: when every field comes back with the same number the
   * signal carries no information. Below this spread the app ignores
   * confidence entirely and triages on validation and emptiness alone, which
   * is honest rather than theatrical.
   * ---------------------------------------------------------------------- */
  /* Calibrated for AGREEMENT scores (js/agreement.js), which have real meaning:
   *   1.00  both models read it identically
   *   0.88  same text, different capitalisation or punctuation
   *   0.30  one model read something, the other saw a blank line
   *   0.12  the two readings have nothing in common
   * A critical field must match exactly; everything else tolerates a cosmetic
   * difference before it asks for a human. */
  var THRESHOLDS = {
    critical: 0.99,
    high: 0.95,
    low: 0.70,
    flatSpreadEpsilon: 0.005
  };

  /* ---------------------------------------------------------------------- *
   * 7. JSON schema, generated. Do not hand-edit.
   * Shape: { record: {24 keys}, confidence: {24 numbers}, extra: {6 keys} }
   * Only `record` is ever exported as the contract.
   * ---------------------------------------------------------------------- */
  function propsFromDefs(defs) {
    var props = {};
    var required = [];
    defs.forEach(function (def) {
      props[def.key] = def.type === 'boolean'
        ? { type: 'boolean', description: def.schemaDesc }
        : { type: 'string', description: def.schemaDesc };
      required.push(def.key);
    });
    return { type: 'object', properties: props, required: required, additionalProperties: false };
  }

  function confPropsFromDefs(defs) {
    var props = {};
    var required = [];
    defs.forEach(function (def) {
      props[def.key] = {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'How clearly you could read the source text for "' + def.key +
                     '", 0 to 1. Legibility, not plausibility.'
      };
      required.push(def.key);
    });
    return { type: 'object', properties: props, required: required, additionalProperties: false };
  }

  /**
   * The verification pass only ever contributes `record` — its confidence and
   * extra blocks are discarded. Asking for them costs output tokens, and output
   * tokens are the slow part. This schema asks for nothing else.
   */
  function buildLeanSchema() {
    var ordered = EXPORT_ORDER.map(function (key) {
      return FIELD_DEFS.filter(function (d) { return d.key === key; })[0];
    });
    return {
      type: 'object',
      properties: { record: propsFromDefs(ordered) },
      required: ['record'],
      additionalProperties: false
    };
  }

  function buildSchema() {
    // record properties follow EXPORT_ORDER so the model emits them in contract order
    var ordered = EXPORT_ORDER.map(function (key) {
      return FIELD_DEFS.filter(function (d) { return d.key === key; })[0];
    });
    return {
      type: 'object',
      properties: {
        record: propsFromDefs(ordered),
        confidence: confPropsFromDefs(ordered),
        extra: propsFromDefs(EXTRA_DEFS)
      },
      required: ['record', 'confidence', 'extra'],
      additionalProperties: false
    };
  }

  App.Config = {
    MODELS: MODELS,
    DEFAULT_MODEL_ID: DEFAULT_MODEL_ID,
    EMPTY_VALUE: EMPTY_VALUE,
    LIMITS: LIMITS,
    STORAGE_KEYS: STORAGE_KEYS,
    API: API,
    endpoint: endpoint,
    modelNameFor: modelNameFor,
    verifyModelFor: verifyModelFor,
    FIELD_DEFS: FIELD_DEFS,
    EXTRA_DEFS: EXTRA_DEFS,
    EXPORT_ORDER: EXPORT_ORDER,
    FIELD_FLAGS: FIELD_FLAGS,
    THRESHOLDS: THRESHOLDS,
    VERIFY: VERIFY,
    SCHEMA: buildSchema(),
    LEAN_SCHEMA: buildLeanSchema(),
    defByKey: function (key) {
      return FIELD_DEFS.filter(function (d) { return d.key === key; })[0] ||
             EXTRA_DEFS.filter(function (d) { return d.key === key; })[0] || null;
    },
    modelById: function (id) {
      return MODELS.filter(function (m) { return m.id === id; })[0] || null;
    }
  };
})(window.App);
