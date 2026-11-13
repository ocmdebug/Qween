/* =============================================================================
 * validate.js — deterministic content validation.
 *
 * This is the reliable half of the review screen. Model confidence is weakly
 * calibrated (see docs/EXTRACTION_TESTS.md); checksums are not. Everything in
 * here is arithmetic and format rules, so it is right every time.
 *
 * Every validator returns one of:
 *   null                                   nothing to say (empty value)
 *   { level: 'ok',    msg, ...extras }
 *   { level: 'warn',  msg }
 *   { level: 'error', msg, fix? }          `fix` = a suggested corrected value
 *
 * Messages are Polish (operator-facing) and live in js/i18n.js.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  /* --------------------------------------------------------------- helpers */

  function digitsOnly(v) { return String(v).replace(/[\s\-.]/g, ''); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** PESEL encodes the birth date in digits 1-6, with the century in the month. */
  function peselDate(d) {
    var y = +d.slice(0, 2), m = +d.slice(2, 4), day = +d.slice(4, 6), c = 1900;
    if (m > 80) { c = 1800; m -= 80; }
    else if (m > 60) { c = 2200; m -= 60; }
    else if (m > 40) { c = 2100; m -= 40; }
    else if (m > 20) { c = 2000; m -= 20; }
    if (m < 1 || m > 12 || day < 1 || day > 31) return null;
    var full = c + y;
    var dt = new Date(Date.UTC(full, m - 1, day));
    if (dt.getUTCFullYear() !== full || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
    return full + '-' + pad2(m) + '-' + pad2(day);
  }

  var PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  function peselChecksumOk(d) {
    if (!/^\d{11}$/.test(d)) return false;
    var s = 0;
    for (var i = 0; i < 10; i++) s += PESEL_WEIGHTS[i] * +d[i];
    return (10 - s % 10) % 10 === +d[10];
  }
  function peselOk(d) { return peselChecksumOk(d) && !!peselDate(d); }

  var NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  function nipOk(d) {
    if (!/^\d{10}$/.test(d)) return false;
    var s = 0;
    for (var i = 0; i < 9; i++) s += NIP_WEIGHTS[i] * +d[i];
    return s % 11 === +d[9];
  }

  var REGON9 = [8, 9, 2, 3, 4, 5, 6, 7];
  var REGON14 = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  function regonOk(d) {
    var w, i, s = 0;
    if (/^\d{9}$/.test(d)) { w = REGON9; }
    else if (/^\d{14}$/.test(d)) { w = REGON14; }
    else return false;
    for (i = 0; i < w.length; i++) s += w[i] * +d[i];
    return (s % 11) % 10 === +d[w.length];
  }

  /** Characters an OCR pass confuses for one another. Used to rank repairs. */
  var CONFUSE = {
    '0': '6895OoD', '1': '7lI', '2': '7Z', '3': '859', '4': '9',
    '5': '6S3', '6': '0858', '7': '12', '8': '0369B', '9': '08'
  };
  var LETTER_FIX = { 'O': '0', 'o': '0', 'D': '0', 'I': '1', 'l': '1', 'i': '1', 'S': '5', 'B': '8', 'Z': '2' };

  function fixLetters(s) {
    return s.replace(/[OoDIliSBZ]/g, function (c) { return LETTER_FIX[c] || c; });
  }

  /* -------------------------------------------------------- repair finder */

  /**
   * Single-digit substitutions that make the checksum valid.
   * Ranked by how plausible the swap is as an OCR mistake.
   * Returns [{ value, index, from, to, score, birthdate? }]
   */
  function repairCandidates(value, isValid, extra) {
    var v = digitsOnly(value);
    if (!/^\d+$/.test(v)) return [];
    var out = [];
    for (var i = 0; i < v.length; i++) {
      for (var d = 0; d <= 9; d++) {
        if (+v[i] === d) continue;
        var cand = v.slice(0, i) + d + v.slice(i + 1);
        if (!isValid(cand)) continue;
        var confusable = (CONFUSE[v[i]] || '').indexOf(String(d)) !== -1;
        out.push({
          value: cand,
          index: i,
          from: v[i],
          to: String(d),
          score: (confusable ? 1 : 0) + (i === v.length - 1 ? 0.5 : 0),
          birthdate: extra === 'pesel' ? peselDate(cand) : null
        });
      }
    }
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
  }

  /* ----------------------------------------------------------- validators */

  function checkPesel(value, state) {
    var T = App.T, d = digitsOnly(value);
    if (/[^\d]/.test(d)) return { level: 'error', msg: T.vPeselDigitsOnly, fix: fixLetters(d) };
    if (d.length !== 11) return { level: 'error', msg: T.vPeselLength(d.length) };
    var dob = peselDate(d);
    if (!dob) return { level: 'error', msg: T.vPeselBadDate };
    if (!peselChecksumOk(d)) {
      return { level: 'error', msg: T.vPeselChecksum, candidates: repairCandidates(d, peselOk, 'pesel') };
    }
    var sex = (+d[9]) % 2 ? T.vMale : T.vFemale;
    return { level: 'ok', msg: T.vPeselOk(dob, sex), birthdate: dob };
  }

  function checkNip(value) {
    var T = App.T, raw = String(value).replace(/[\s-]/g, '');
    var letter = raw.match(/[A-Za-z]/);
    if (letter) {
      var fixed = fixLetters(raw);
      return {
        level: 'error',
        msg: T.vNipLetter(letter[0]),
        fix: nipOk(fixed) ? fixed : null
      };
    }
    if (!/^\d{10}$/.test(raw)) return { level: 'error', msg: T.vNipLength(raw.replace(/\D/g, '').length) };
    if (!nipOk(raw)) {
      return { level: 'error', msg: T.vNipChecksum, candidates: repairCandidates(raw, nipOk) };
    }
    return { level: 'ok', msg: T.vNipOk };
  }

  function checkRegon(value) {
    var T = App.T, d = digitsOnly(value);
    if (!/^\d+$/.test(d)) return { level: 'error', msg: T.vRegonDigits };
    if (d.length !== 9 && d.length !== 14) return { level: 'error', msg: T.vRegonLength(d.length) };
    if (!regonOk(d)) return { level: 'error', msg: T.vRegonChecksum, candidates: repairCandidates(d, regonOk) };
    return { level: 'ok', msg: T.vRegonOk };
  }

  function checkZip(value) {
    var T = App.T;
    if (!/^\d{2}-\d{3}$/.test(String(value).trim())) return { level: 'error', msg: T.vZipFormat };
    return { level: 'ok', msg: T.vZipOk };
  }

  function parseIsoDate(v) {
    var m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (dt.getUTCFullYear() !== +m[1] || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) return null;
    return dt;
  }

  function checkDate(value) {
    var T = App.T, dt = parseIsoDate(value);
    if (!dt) return { level: 'error', msg: T.vDateFormat };
    if (dt.getTime() > Date.now() + 86400000) return { level: 'warn', msg: T.vDateFuture };
    return { level: 'ok', msg: T.vDateOk };
  }

  function checkBirthdate(value, state) {
    var T = App.T, dt = parseIsoDate(value);
    if (!dt) return { level: 'error', msg: T.vDateFormat };
    var peselValue = state && state.fields.pesel ? digitsOnly(state.fields.pesel.value) : '';
    if (peselOk(peselValue)) {
      var fromPesel = peselDate(peselValue);
      if (fromPesel !== String(value).trim()) {
        return { level: 'error', msg: T.vDobVsPesel(fromPesel), fix: fromPesel };
      }
      return { level: 'ok', msg: T.vDobMatchesPesel };
    }
    if (dt.getTime() > Date.now()) return { level: 'error', msg: T.vDobFuture };
    return { level: 'ok', msg: T.vDateOk };
  }

  function checkEmail(value) {
    var T = App.T;
    return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(value).trim())
      ? { level: 'ok', msg: T.vEmailOk }
      : { level: 'error', msg: T.vEmailFormat };
  }

  function checkPhone(value) {
    var T = App.T;
    return /^\+48\d{9}$/.test(String(value).trim())
      ? { level: 'ok', msg: T.vPhoneOk }
      : { level: 'warn', msg: T.vPhoneFormat };
  }

  function checkHouseNumber(value) {
    var T = App.T;
    return /^\d+[A-Za-z]?(\/\d+[A-Za-z]?)?$/.test(String(value).trim())
      ? { level: 'ok', msg: T.vHouseOk }
      : { level: 'warn', msg: T.vHouseFormat };
  }

  function checkInteger(value) {
    var T = App.T;
    return /^\d+$/.test(String(value).trim())
      ? { level: 'ok', msg: T.vIntOk }
      : { level: 'error', msg: T.vIntFormat };
  }

  /* ---------------------------------------------------------------- table
   * Which validator runs for which field key. Add a key here to validate it.
   * -------------------------------------------------------------------- */
  var BY_KEY = {
    pesel: checkPesel,
    nip: checkNip,
    regon: checkRegon,
    zip_code: checkZip,
    zip_code_company: checkZip,
    birthdate: checkBirthdate,
    email: checkEmail,
    phone: checkPhone,
    patient_house_number: checkHouseNumber,
    issue_date: checkDate,
    factors_count: checkInteger
  };

  /**
   * Validates one field's current value.
   * @param {string} key
   * @param {string} value  the operator's current value
   * @param {object} state  full state, for cross-field checks
   */
  function validateField(key, value, state) {
    var v = String(value === undefined || value === null ? '' : value).trim();
    if (!v || v === App.Config.EMPTY_VALUE) return null;   // absence is handled by tiers
    var fn = BY_KEY[key];
    return fn ? fn(v, state) : null;
  }

  /**
   * Cross-field checks that are not about one value in isolation.
   * Returns an array of { key, level, msg }.
   */
  function crossChecks(state) {
    var T = App.T, out = [];
    var empty = App.Config.EMPTY_VALUE;
    function val(k) {
      var e = state.fields[k];
      var s = e ? String(e.value).trim() : '';
      return (s === empty) ? '' : s;
    }
    function flag(k) { return !!(state.fields[k] && state.fields[k].value === true); }

    if (flag('noPesel') && val('pesel')) out.push({ key: 'noPesel', level: 'warn', msg: T.vNoPeselConflict });
    if (!flag('noPesel') && !val('pesel')) out.push({ key: 'noPesel', level: 'warn', msg: T.vPeselMissingFlag });
    if (flag('noNip') && val('nip')) out.push({ key: 'noNip', level: 'warn', msg: T.vNoNipConflict });
    if (!flag('noNip') && !val('nip')) out.push({ key: 'noNip', level: 'warn', msg: T.vNipMissingFlag });

    return out;
  }

  App.Validate = {
    field: validateField,
    crossChecks: crossChecks,
    peselDate: peselDate,
    peselOk: peselOk,
    nipOk: nipOk,
    regonOk: regonOk,
    repairCandidates: repairCandidates,
    digitsOnly: digitsOnly
  };
})(window.App);
