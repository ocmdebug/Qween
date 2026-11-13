/* =============================================================================
 * agreement.js — confidence measured instead of asked for.
 *
 * WHY THIS EXISTS
 * Models cannot introspect their own certainty. Asked directly, Qwen3-VL
 * returns 0.95 for every field on a page, including fields it got wrong, and
 * the number changes between identical runs. Token logprobs would be the
 * honest source but OpenRouter's providers do not return usable ones.
 *
 * What a model CANNOT fake is its behaviour: when a reading is genuinely
 * ambiguous, two models disagree about it. Measured on the sample set, two
 * independent reads of the same page matched on 23 of 24 fields and diverged
 * on exactly the one that was hard — the long handwritten passage.
 *
 * So confidence here = how closely a second model's reading agrees with the
 * first. It is an uncertainty estimate, not a probability, and the UI says so.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  /* ---------------------------------------------------------------- scores */

  var SCORE = {
    bothEmpty: 1,      // both models say the line is blank — strong agreement
    identical: 1,
    caseOrPunct: 0.88, // same text, different capitalisation/punctuation
    oneEmpty: 0.3,     // one read something, the other saw nothing
    floor: 0.12        // completely different readings
  };

  function normalise(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isEmptyValue(value) {
    var s = normalise(value);
    return !s || s === App.Config.EMPTY_VALUE;
  }

  /** Lower-case, strip punctuation, fold Polish diacritics to their base letter. */
  function loose(value) {
    var map = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };
    return normalise(value).toLowerCase()
      .replace(/[ąćęłńóśźż]/g, function (c) { return map[c]; })
      .replace(/[.,;:/\\"'„”()\-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Levenshtein distance, iterative, two rows. */
  function distance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    var prev = new Array(b.length + 1);
    var curr = new Array(b.length + 1);
    var i, j;

    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (j = 1; j <= b.length; j++) {
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      for (j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  /**
   * How much two readings of one field agree, 0..1.
   * Long free-text fields are judged more leniently: a 300-character passage
   * differing by a word is not the same kind of doubt as a PESEL differing by
   * a digit.
   */
  function similarity(a, b, def) {
    var emptyA = isEmptyValue(a);
    var emptyB = isEmptyValue(b);

    if (emptyA && emptyB) return SCORE.bothEmpty;
    if (emptyA !== emptyB) return SCORE.oneEmpty;

    var na = normalise(a);
    var nb = normalise(b);
    if (na === nb) return SCORE.identical;
    if (loose(na) === loose(nb)) return SCORE.caseOrPunct;

    var dist = distance(na, nb);
    var longest = Math.max(na.length, nb.length);
    var ratio = 1 - (dist / longest);

    // A single wrong character in a short identifier is serious; the same
    // absolute difference inside a long passage is not.
    if (def && def.type === 'textarea' && longest > 60) {
      ratio = Math.min(0.9, 0.35 + ratio * 0.6);
    } else {
      ratio = ratio * 0.8;        // never let a near-match read as certainty
    }

    return Math.max(SCORE.floor, Math.min(0.9, ratio));
  }

  function booleanSimilarity(a, b) {
    return (!!a === !!b) ? SCORE.identical : 0.3;
  }

  /* --------------------------------------------------------------- applying */

  /**
   * Replaces each field's self-reported confidence with the measured one, and
   * records what the second model read so the operator can see and apply it.
   *
   * @param {object} state        built from the primary extraction
   * @param {object} otherRecord  the verification model's `record`
   * @param {string} otherModelId
   */
  function apply(state, otherRecord, otherModelId) {
    if (!otherRecord) return state;

    App.Config.FIELD_DEFS.forEach(function (def) {
      var entry = state.fields[def.key];
      if (!entry) return;

      var mine = entry.aiValue;
      var theirs = Object.prototype.hasOwnProperty.call(otherRecord, def.key)
        ? otherRecord[def.key]
        : undefined;

      if (theirs === undefined) {
        entry.altValue = null;
        entry.altAgrees = null;
        return;                       // leave the self-reported number alone
      }

      var score = def.type === 'boolean'
        ? booleanSimilarity(mine, theirs)
        : similarity(mine, theirs, def);

      entry.confidence = score;
      entry.altValue = def.type === 'boolean' ? !!theirs : normalise(theirs);
      entry.altAgrees = score >= SCORE.caseOrPunct;
    });

    state.confidenceSource = 'agreement';
    state.verifyModelId = otherModelId;
    state.confidenceSpread = App.State.confidenceSpread(state.fields);
    return state;
  }

  App.Agreement = {
    apply: apply,
    similarity: similarity,
    distance: distance,
    normalise: normalise,
    isEmptyValue: isEmptyValue,
    SCORE: SCORE
  };
})(window.App);
