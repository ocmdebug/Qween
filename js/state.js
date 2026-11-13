/* =============================================================================
 * state.js — the extraction state object and the field normalisers.
 *
 * State shape (deliberately one wrapper object per field):
 *
 *   {
 *     fields: { f_name: { value: "Jan" }, ... },
 *     extra:  { issue_date: { value: "2024-10-15" }, ... },
 *     meta:   { modelId, elapsedMs, usage, attempts, pageCount, bytes },
 *     raw:    "<the model's verbatim reply>"
 *   }
 *
 * Iteration 2 adds `confidence`, `status` and `source_bbox` to those wrappers.
 * form.js reads `.value` and writes `.value`, so its contract does not change.
 * Validation (PESEL/NIP/REGON checksums, cross-field checks) hooks in at
 * `validateRecord` below — see docs/DECISIONS.md.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  var PLACEHOLDERS = ['n/a', 'na', 'null', 'none', 'brak danych', '-', '--', 'not found', 'nie znaleziono'];

  function isBlank(value) {
    if (value === null || value === undefined) return true;
    var s = String(value).trim();
    if (!s) return true;
    return PLACEHOLDERS.indexOf(s.toLowerCase()) !== -1;
  }

  function empty() {
    return App.Config.EMPTY_VALUE;
  }

  /* ---------------------------------------------------------- normalisers */

  var MONTHS_PL = {
    'stycznia': 1, 'styczeń': 1, 'luty': 2, 'lutego': 2, 'marca': 3, 'marzec': 3,
    'kwietnia': 4, 'kwiecień': 4, 'maja': 5, 'maj': 5, 'czerwca': 6, 'czerwiec': 6,
    'lipca': 7, 'lipiec': 7, 'sierpnia': 8, 'sierpień': 8, 'września': 9, 'wrzesień': 9,
    'października': 10, 'październik': 10, 'listopada': 11, 'listopad': 11,
    'grudnia': 12, 'grudzień': 12
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function plausibleDate(y, m, d) {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  var normalisers = {
    /** Collapses whitespace. Everything gets at least this. */
    trim: function (value) {
      return String(value).replace(/\s+/g, ' ').trim();
    },

    /** Digits only — PESEL, NIP, REGON. Keeps the original if it holds letters. */
    digits: function (value) {
      var s = String(value).trim();
      var stripped = s.replace(/[\s\-.]/g, '');
      return /^\d+$/.test(stripped) ? stripped : s;
    },

    /** -> YYYY-MM-DD. Returns the input verbatim when it cannot be read confidently. */
    date: function (value) {
      var s = String(value).trim().replace(/\s*r\.?\s*$/i, '').trim();
      var m, out;

      m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);          // 2024-10-15
      if (m) { out = plausibleDate(+m[1], +m[2], +m[3]); if (out) return out; }

      m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);          // 15.10.2024
      if (m) { out = plausibleDate(+m[3], +m[2], +m[1]); if (out) return out; }

      m = s.match(/^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})$/);             // 15 października 2024
      if (m) {
        var month = MONTHS_PL[m[2].toLowerCase()];
        if (month) { out = plausibleDate(+m[3], month, +m[1]); if (out) return out; }
      }
      return s;                                                       // keep verbatim
    },

    /** -> NN-NNN. Returns the input verbatim when it is not five digits. */
    zip: function (value) {
      var s = String(value).trim();
      var digitsOnly = s.replace(/[\s-]/g, '');
      if (/^\d{5}$/.test(digitsOnly)) return digitsOnly.slice(0, 2) + '-' + digitsOnly.slice(2);
      return s;
    },

    /** -> +48NNNNNNNNN. Returns the input verbatim when it is not a Polish number. */
    phone: function (value) {
      var s = String(value).trim();
      var compact = s.replace(/[\s\-().]/g, '');
      if (/^\+48\d{9}$/.test(compact)) return compact;
      if (/^0?048\d{9}$/.test(compact)) return '+48' + compact.slice(-9);
      if (/^\d{9}$/.test(compact)) return '+48' + compact;
      return s;
    }
  };

  function normaliseValue(def, rawValue) {
    if (def.type === 'boolean') {
      if (typeof rawValue === 'boolean') return rawValue;
      var s = String(rawValue).trim().toLowerCase();
      if (s === 'true' || s === 'tak' || s === '1') return true;
      if (s === 'false' || s === 'nie' || s === '0') return false;
      return false;
    }
    if (isBlank(rawValue)) return empty();
    var fn = def.normaliser && normalisers[def.normaliser];
    var value = fn ? fn(rawValue) : normalisers.trim(rawValue);
    return isBlank(value) ? empty() : value;
  }

  /* --------------------------------------------------------- construction */

  function buildSection(defs, source, confidence) {
    var out = {};
    defs.forEach(function (def) {
      var incoming = source && Object.prototype.hasOwnProperty.call(source, def.key)
        ? source[def.key]
        : undefined;
      var value = normaliseValue(def, incoming);
      var conf = confidence && typeof confidence[def.key] === 'number'
        ? Math.max(0, Math.min(1, confidence[def.key]))
        : null;
      out[def.key] = {
        value: value,
        aiValue: value,          // what the model said, kept for "zgadza się" vs "poprawione"
        confidence: conf,
        decision: null,          // null | confirmed | edited | absent | override
        source: null,            // operator | suggestion
        edited: false,
        missingFromResponse: incoming === undefined
      };
    });
    return out;
  }

  /**
   * Model confidence is only worth showing if it varies. The 30B returns the
   * same number for all 24 fields, which is noise dressed as information.
   * Measured in docs/EXTRACTION_TESTS.md.
   */
  function confidenceSpread(fields) {
    var values = Object.keys(fields)
      .map(function (k) { return fields[k].confidence; })
      .filter(function (c) { return typeof c === 'number'; });
    if (values.length < 2) return { usable: false, spread: 0, count: values.length };
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var spread = max - min;
    return {
      usable: spread >= App.Config.THRESHOLDS.flatSpreadEpsilon,
      spread: spread,
      min: min,
      max: max,
      count: values.length
    };
  }

  /**
   * Builds the state from a model result. Keys the model omitted become the
   * empty value; keys the model invented are reported but never merged in.
   */
  function fromResult(result, meta) {
    var cfg = App.Config;
    var known = {};
    cfg.FIELD_DEFS.forEach(function (d) { known[d.key] = true; });

    var unexpected = Object.keys(result.record || {}).filter(function (k) { return !known[k]; });
    var fields = buildSection(cfg.FIELD_DEFS, result.record, result.confidence);
    var spread = confidenceSpread(fields);

    return {
      fields: fields,
      extra: buildSection(cfg.EXTRA_DEFS, result.extra, null),
      confidenceSpread: spread,
      approved: false,
      meta: Object.assign({
        confidenceUsable: spread.usable,
        confidenceSpread: spread.spread,
        modelId: result.modelId,
        usage: result.usage || null,
        attempts: result.attempts || 1,
        finishReason: result.finishReason || null,
        unexpectedKeys: unexpected,
        missingKeys: cfg.EXPORT_ORDER.filter(function (k) {
          return !result.record || !Object.prototype.hasOwnProperty.call(result.record, k);
        })
      }, meta || {}),
      raw: result.raw || ''
    };
  }

  function emptyState() {
    return {
      fields: buildSection(App.Config.FIELD_DEFS, {}, null),
      extra: buildSection(App.Config.EXTRA_DEFS, {}, null),
      confidenceSpread: { usable: false, spread: 0, count: 0 },
      approved: false,
      meta: {},
      raw: ''
    };
  }

  /* ---------------------------------------------------------------- tiers
   * Which bucket a field falls in. This drives the whole review screen.
   *
   *   error        validation says the value cannot be right
   *   missing      no value, and we are not confident it is genuinely absent
   *   low          confidence below the "niepewne" threshold
   *   check        worth a glance: mid confidence, a warning, or an unconfirmed edit
   *   auto         accepted without operator action
   *   absent-auto  empty, optional, and the model is sure the line is blank
   *
   * Plus the four decided states: confirmed | edited | absent | override.
   * -------------------------------------------------------------------- */
  var PENDING = ['error', 'missing', 'low', 'check'];

  function textOf(entry) {
    var v = entry && entry.value;
    if (v === true || v === false) return String(v);
    var s = String(v === undefined || v === null ? '' : v).trim();
    return s === empty() ? '' : s;
  }

  function rawTier(def, state) {
    var entry = state.fields[def.key] || state.extra[def.key];
    if (!entry) return 'auto';

    var T = App.Config.THRESHOLDS;
    var usable = state.confidenceSpread && state.confidenceSpread.usable;
    var conf = entry.confidence;
    var text = textOf(entry);

    // Booleans carry no transcription risk of their own; cross-checks flag them.
    if (def.type === 'boolean') {
      var cross = (state.crossIssues || []).filter(function (c) { return c.key === def.key; })[0];
      if (cross) return 'check';
      return 'auto';
    }

    if (!text) {
      if (def.optional && usable && typeof conf === 'number' && conf >= T.high) return 'absent-auto';
      if (def.optional && !usable) return 'absent-auto';
      return 'missing';
    }

    var validation = App.Validate.field(def.key, text, state);
    if (validation && validation.level === 'error') return 'error';
    if (entry.edited) return 'check';            // operator typed, not yet confirmed

    // Without a usable confidence signal, validation and emptiness are all we have.
    if (!usable || typeof conf !== 'number') {
      return (validation && validation.level === 'warn') ? 'check' : 'auto';
    }

    var need = def.critical ? Math.max(T.high, T.critical) : T.high;
    var tier = conf >= need ? 'auto' : (conf >= T.low ? 'check' : 'low');
    if (validation && validation.level === 'warn' && tier === 'auto') tier = 'check';
    return tier;
  }

  function tierOf(def, state) {
    var entry = state.fields[def.key] || state.extra[def.key];
    return (entry && entry.decision) || rawTier(def, state);
  }

  function isPending(tier) { return PENDING.indexOf(tier) !== -1; }

  /** True when the current value could be accepted as-is. */
  function canConfirm(def, state) {
    var entry = state.fields[def.key] || state.extra[def.key];
    if (def.type === 'boolean') return true;
    var text = textOf(entry);
    if (!text) return false;
    var validation = App.Validate.field(def.key, text, state);
    return !(validation && validation.level === 'error');
  }

  /** Refreshes cross-field issues; call after any value change. */
  function refreshCross(state) {
    state.crossIssues = App.Validate.crossChecks(state);
    return state;
  }

  /** Marks which fields were flagged on arrival, so the "todo" list is stable. */
  function markFlagged(state) {
    refreshCross(state);
    App.Config.FIELD_DEFS.concat(App.Config.EXTRA_DEFS).forEach(function (def) {
      var entry = state.fields[def.key] || state.extra[def.key];
      if (entry) entry.flagged = isPending(rawTier(def, state));
    });
    return state;
  }

  function decide(state, key, decision, source) {
    var entry = state.fields[key] || state.extra[key];
    if (!entry) return state;
    entry.decision = decision;
    entry.source = source || 'operator';
    entry.edited = false;
    refreshCross(state);
    return state;
  }

  function undecide(state, key) {
    var entry = state.fields[key] || state.extra[key];
    if (!entry) return state;
    entry.decision = null;
    entry.source = null;
    refreshCross(state);
    return state;
  }

  /** Tier counts for the summary row. */
  function counts(state) {
    var out = { error: 0, missing: 0, low: 0, check: 0, auto: 0, pending: 0, flagged: 0, total: 0 };
    App.Config.FIELD_DEFS.forEach(function (def) {
      var tier = tierOf(def, state);
      var entry = state.fields[def.key];
      out.total++;
      if (tier === 'auto' || tier === 'absent-auto') out.auto++;
      else if (out[tier] !== undefined) out[tier]++;
      if (isPending(tier)) out.pending++;
      if (entry && entry.flagged) out.flagged++;
    });
    return out;
  }

  /* ---------------------------------------------------------- read/ write */

  function setValue(state, key, value, section) {
    var bag = (section === 'extra') ? state.extra : state.fields;
    if (!bag[key]) bag[key] = {};
    var entry = bag[key];
    entry.value = value;
    // Typing clears any decision: the operator is mid-edit again.
    entry.edited = String(value).trim() !== String(entry.aiValue).trim();
    entry.decision = null;
    entry.source = null;
    refreshCross(state);
    return state;
  }

  function normaliseField(state, key, section) {
    var defs = (section === 'extra') ? App.Config.EXTRA_DEFS : App.Config.FIELD_DEFS;
    var def = defs.filter(function (d) { return d.key === key; })[0];
    if (!def) return state;
    var bag = (section === 'extra') ? state.extra : state.fields;
    bag[key].value = normaliseValue(def, bag[key].value);
    return state;
  }

  /* ------------------------------------------------------------- exporting */

  /** The contract: exactly 24 keys, in EXPORT_ORDER, booleans as booleans. */
  function toExport(state) {
    var out = {};
    App.Config.EXPORT_ORDER.forEach(function (key) {
      var def = App.Config.FIELD_DEFS.filter(function (d) { return d.key === key; })[0];
      var entry = state.fields[key];
      var value = entry ? entry.value : undefined;
      out[key] = def && def.type === 'boolean' ? !!value
        : (isBlank(value) ? empty() : String(value));
    });
    return out;
  }

  /** The additional data, exported separately so the contract stays untouched. */
  function toExtraExport(state) {
    var out = {};
    App.Config.EXTRA_DEFS.forEach(function (def) {
      var entry = state.extra[def.key];
      out[def.key] = entry && !isBlank(entry.value) ? String(entry.value) : empty();
    });
    return out;
  }

  /* ------------------------------------------------------------ validation
   * Iteration 2 hook. Intentionally a no-op: the task says do not implement
   * confidence or validation yet. When it lands, it fills `status` and `notes`
   * on each field wrapper and the renderer picks them up without changes.
   * - pesel      -> PESEL checksum
   * - nip        -> mod 11, weights 6 5 7 2 3 4 5 6 7
   * - regon      -> 9 and 14 digit mod 11 variants
   * - birthdate  -> real-calendar check, and agreement with the PESEL digits
   * - noPesel / noNip -> must agree with whether the matching field is empty
   * ---------------------------------------------------------------------- */
  function validateRecord(state) {
    return state;
  }

  /**
   * The review export: the 24-key record PLUS the audit trail.
   * `record` inside it is byte-identical to toExport(), so the contract is
   * never altered — this is a superset, offered as a separate download.
   */
  function toReviewExport(state, meta) {
    var T = App.T;
    var c = counts(state);
    var out = {
      document: (meta && meta.documentName) || null,
      model: state.meta.modelId || null,
      extracted_at: new Date().toISOString(),
      review: {
        status: state.approved ? T.reviewStatusApproved
              : (c.pending ? T.reviewStatusInProgress : T.reviewStatusReady),
        pending_fields: c.pending,
        confidence_usable: !!(state.confidenceSpread && state.confidenceSpread.usable),
        thresholds: {
          auto: App.Config.THRESHOLDS.high,
          critical_auto: App.Config.THRESHOLDS.critical,
          low: App.Config.THRESHOLDS.low
        }
      },
      record: toExport(state),
      extra: toExtraExport(state),
      fields: {}
    };

    App.Config.FIELD_DEFS.forEach(function (def) {
      var entry = state.fields[def.key];
      var text = textOf(entry);
      var validation = def.type === 'boolean' ? null : App.Validate.field(def.key, text, state);
      var tier = tierOf(def, state);
      out.fields[def.key] = {
        value: def.type === 'boolean' ? !!entry.value : (text || null),
        ai_value: def.type === 'boolean' ? !!entry.aiValue : (entry.aiValue === empty() ? null : entry.aiValue),
        confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
        critical: !!def.critical,
        review: entry.decision ||
                (tier === 'auto' ? 'auto_accepted'
                 : tier === 'absent-auto' ? 'auto_absent' : 'pending'),
        source: entry.source || null,
        validation: validation ? validation.level : null,
        validation_message: validation && validation.level !== 'ok' ? validation.msg : null
      };
    });

    out.cross_checks = (state.crossIssues || []).map(function (c2) {
      return { key: c2.key, level: c2.level, message: c2.msg };
    });

    return out;
  }

  App.State = {
    normalisers: normalisers,
    textOf: textOf,
    rawTier: rawTier,
    tierOf: tierOf,
    isPending: isPending,
    canConfirm: canConfirm,
    decide: decide,
    undecide: undecide,
    counts: counts,
    markFlagged: markFlagged,
    refreshCross: refreshCross,
    confidenceSpread: confidenceSpread,
    toReviewExport: toReviewExport,
    PENDING: PENDING,
    normaliseValue: normaliseValue,
    normaliseField: normaliseField,
    isBlank: isBlank,
    empty: empty,
    fromResult: fromResult,
    emptyState: emptyState,
    setValue: setValue,
    toExport: toExport,
    toExtraExport: toExtraExport,
    validateRecord: validateRecord
  };
})(window.App);
