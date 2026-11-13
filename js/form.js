/* =============================================================================
 * form.js — the review screen: renders every field from the declarative config
 * and decorates it with its tier, confidence and validation state.
 *
 * It never hardcodes a field. Add an entry to App.Config.FIELD_DEFS (or
 * EXTRA_DEFS) and it appears here, validated and triaged, automatically.
 *
 * Contract with state.js: read `entry.value`, write through the handlers.
 * Tier, confidence and validation all come from state.js / validate.js — this
 * file only draws them.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  var CHIP = {
    auto:          ['c-auto',    'tierAuto'],
    'absent-auto': ['c-auto',    'tierAbsentAuto'],
    check:         ['c-check',   'tierCheck'],
    low:           ['c-low',     'tierLow'],
    error:         ['c-error',   'tierError'],
    missing:       ['c-missing', 'tierMissing'],
    confirmed:     ['c-done',    'tierConfirmed'],
    edited:        ['c-done',    'tierEdited'],
    absent:        ['c-done',    'tierAbsent'],
    override:      ['c-done',    'tierOverride']
  };

  var DONE = ['confirmed', 'edited', 'absent', 'override'];

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
  }

  function allDefs() {
    return App.Config.FIELD_DEFS.concat(App.Config.EXTRA_DEFS);
  }

  function sectionOf(def) {
    return App.Config.EXTRA_DEFS.indexOf(def) !== -1 ? 'extra' : 'record';
  }

  function entryOf(state, def) {
    return state.fields[def.key] || state.extra[def.key];
  }

  /* ------------------------------------------------------------- building */

  function controlHTML(def, entry) {
    var id = 'fld-' + def.key;

    if (def.choice) {
      return '<div class="seg" role="group" aria-label="' + esc(def.label) + '">' +
        def.choice.map(function (opt) {
          return '<button type="button" data-act="opt" data-val="' + esc(opt) + '">' +
                 esc(opt) + '</button>';
        }).join('') + '</div>';
    }
    if (def.type === 'boolean') {
      return '<input type="checkbox" class="field-check" id="' + id + '"' +
             (entry.value ? ' checked' : '') + '>';
    }
    if (def.type === 'textarea') {
      return '<textarea id="' + id + '" rows="3" class="field-input field-input--area" ' +
             'spellcheck="false" placeholder="' + esc(App.T.noReadout) + '">' +
             esc(entry.value) + '</textarea>';
    }
    return '<input id="' + id + '" class="field-input' + (def.mono ? ' mono' : '') +
           '" value="' + esc(entry.value) + '" autocomplete="off" spellcheck="false" ' +
           'placeholder="' + esc(App.T.noReadout) + '">';
  }

  function build(host, state) {
    var html = '';
    var section = null;

    allDefs().forEach(function (def) {
      if (def.group !== section) {
        section = def.group;
        html += '<div class="sec" data-sec="' + esc(section) + '">' + esc(section) + '</div>';
      }
      var entry = entryOf(state, def);
      var labelFor = (def.choice || def.type === 'boolean') ? '' : ' for="fld-' + def.key + '"';

      // Only the field name is shown. `def.polishLabel` (the wording printed on
      // the referral) stays in the config and is attached as a tooltip, so the
      // information is still reachable on hover without cluttering the column.
      html +=
        '<div class="field" id="row-' + def.key + '" data-key="' + def.key +
          '" data-section="' + sectionOf(def) + '" data-sec="' + esc(def.group) + '">' +
          '<div class="f-grid">' +
            '<label class="f-label"' + labelFor +
              (def.polishLabel ? ' title="' + esc(def.polishLabel) + '"' : '') + '>' +
              '<span class="f-label__text">' + esc(def.label) + '</span>' +
              (def.critical
                ? '<span class="crit" title="' + esc(App.T.criticalTitle) + '">' +
                  esc(App.T.critical) + '</span>'
                : '') +
            '</label>' +
            '<div class="f-ctl">' + controlHTML(def, entry) + '</div>' +
            '<div class="f-status"></div>' +
          '</div>' +
          '<div class="detail"></div>' +
        '</div>';
    });

    host.innerHTML = html;
  }

  /* ------------------------------------------------------------ decorating */

  /**
   * The confidence meter. ALWAYS rendered when the model gave a number — the
   * operator asked to see it, so hiding it is not ours to decide. When the
   * model returned the same value for every field the bar is marked unreliable
   * (hatched, with a tooltip) rather than removed.
   */
  function confidenceHTML(def, entry, usable, measured) {
    if (def.type === 'boolean') return '';
    if (typeof entry.confidence !== 'number') {
      return '<span class="conf conf--none" title="' + esc(App.T.confNoneTitle) + '">' +
             esc(App.T.confNone) + '</span>';
    }
    var pct = Math.round(entry.confidence * 100);
    var TH = App.Config.THRESHOLDS;          // not App.T — that is the Polish strings
    var band = entry.confidence >= (def.critical ? TH.critical : TH.high) ? 'hi'
             : (entry.confidence >= TH.low ? 'mid' : 'lo');

    var title = measured ? App.T.confAgreementTitle
              : (usable ? App.T.confTitle : App.T.confFlatTitle);
    return '<span class="conf conf--' + band + (usable ? '' : ' conf--flat') +
             (measured ? ' conf--measured' : '') +
             '" title="' + esc(title) + '">' +
             '<i><b style="width:' + pct + '%"></b></i>' +
             '<span class="conf__pct">' + pct + '%</span>' +
           '</span>';
  }

  function suggestionsHTML(def, state, validation) {
    var out = [];
    var T = App.T;

    // Repair candidates are offered ONLY as "if this was a misread" — never as a
    // recommendation. We rank them with OCR-confusion heuristics, which is not
    // evidence, and a correct reading of an invalid number is common on these
    // documents. Pushing the operator to "fix" a good reading corrupts data.
    if (validation && validation.candidates && validation.candidates.length) {
      var items = validation.candidates.slice(0, 2).map(function (cand) {
        var shown = esc(cand.value.slice(0, cand.index)) +
                    '<em>' + esc(cand.value[cand.index]) + '</em>' +
                    esc(cand.value.slice(cand.index + 1));
        var meta = T.sugSwap(cand.from, cand.to) +
                   (cand.birthdate ? ' · ' + T.sugBirth(cand.birthdate) : '');
        return '<button class="sug" data-act="apply" data-val="' + esc(cand.value) + '">' +
          '<span class="val mono">' + shown + '</span>' +
          '<span class="meta">' + esc(meta) + '</span></button>';
      });
      out.push('<details class="sug-group"><summary>' + esc(T.sugIfMisread) + '</summary>' +
               items.join('') + '</details>');
    }

    if (validation && validation.fix) {
      out.push('<button class="sug" data-act="apply" data-val="' + esc(validation.fix) + '">' +
        '<span class="val mono">' + esc(validation.fix) + '</span>' +
        '<span class="meta">' + esc(T.sugLetterFix) + '</span></button>');
    }

    // What the verification model read, when it disagrees. This is the most
    // actionable hint on the screen: two independent readings, side by side.
    var entry = entryOf(state, def);
    if (entry && entry.altValue !== null && entry.altValue !== undefined &&
        entry.altAgrees === false && def.type !== 'boolean') {
      var alt = String(entry.altValue);
      var shownAlt = alt === '' || alt === App.Config.EMPTY_VALUE
        ? '<span class="val val--empty">' + esc(T.altRead_empty) + '</span>'
        : '<span class="val' + (def.mono ? ' mono' : '') + '">' + esc(alt) + '</span>';
      out.push('<button class="sug sug--alt" data-act="apply" data-val="' + esc(alt) + '">' +
        shownAlt +
        '<span class="meta">' + esc(T.altRead(state.verifyModelId)) + '</span></button>');
    }

    // Birthdate can be offered from a valid PESEL — as a suggestion the operator
    // accepts, never silently derived (the prompt forbids the model doing it).
    if (def.key === 'birthdate' && !App.State.textOf(state.fields.birthdate)) {
      var pesel = App.Validate.digitsOnly(App.State.textOf(state.fields.pesel));
      if (App.Validate.peselOk(pesel)) {
        var dob = App.Validate.peselDate(pesel);
        out.push('<button class="sug" data-act="apply" data-val="' + esc(dob) + '">' +
          '<span class="val mono">' + esc(dob) + '</span>' +
          '<span class="meta">' + esc(T.sugFromPesel) + '</span></button>');
      }
    }

    return out.length ? '<div class="sugs">' + out.join('') + '</div>' : '';
  }

  function detailHTML(def, state, tier, selected) {
    var T = App.T;
    var entry = entryOf(state, def);
    var text = App.State.textOf(entry);
    var parts = [];

    if (DONE.indexOf(tier) !== -1) {
      return selected
        ? '<div class="acts"><button class="btn-link" data-act="undo">' + esc(T.actUndo) + '</button></div>'
        : '';
    }
    if (tier === 'auto' || tier === 'absent-auto') return '';

    var validation = def.type === 'boolean' ? null : App.Validate.field(def.key, text, state);
    if (validation && validation.level !== 'ok') {
      parts.push('<div class="msg ' + (validation.level === 'error' ? 'err' : 'warn') + '">' +
                 esc(validation.msg) +
                 // A failed checksum does NOT mean the transcription is wrong: the
                 // number on the paper may itself be invalid. Say so, so the
                 // operator is not pushed into "correcting" a correct reading.
                 (validation.level === 'error' && validation.candidates !== undefined
                   ? '<span class="msg__hint">' + esc(T.errorHint) + '</span>'
                   : '') +
                 '</div>');
    }

    (state.crossIssues || []).forEach(function (issue) {
      if (issue.key === def.key) {
        parts.push('<div class="msg warn">' + esc(issue.msg) + '</div>');
      }
    });

    parts.push(suggestionsHTML(def, state, validation));

    if (def.quick && !text && !def.choice) {
      parts.push('<div class="quick">' + esc(T.quickCommon) + ' ' +
        def.quick.map(function (q) {
          return '<button data-act="apply" data-val="' + esc(q) + '">' + esc(q) + '</button>';
        }).join('') + '</div>');
    }

    var acts = [];
    if (tier === 'check' || tier === 'low') {
      var same = text === String(entry.aiValue).trim();
      acts.push('<button class="btn btn--primary btn--small" data-act="confirm">' +
        esc(same ? T.actAgree : T.actApprove) + ' <kbd>Enter</kbd></button>');
    }
    if (tier === 'missing') {
      acts.push('<button class="btn btn--small" data-act="absent">' + esc(T.actAbsent) + '</button>');
    }
    if (tier === 'error') {
      // The primary action, because on these documents a correct reading of an
      // invalid number is the common case. Corrections sit behind a disclosure.
      acts.push('<button class="btn btn--primary btn--small" data-act="override">' +
                esc(T.actKeepAsIs) + ' <kbd>Enter</kbd></button>');
    }
    if (acts.length) parts.push('<div class="acts">' + acts.join('') + '</div>');

    return parts.join('');
  }

  function updateRow(host, def, state, ui) {
    var row = host.querySelector('#row-' + CSS.escape(def.key));
    if (!row) return;

    var entry = entryOf(state, def);
    var tier = App.State.tierOf(def, state);
    var selected = ui.selected === def.key;
    var usable = !!(state.confidenceSpread && state.confidenceSpread.usable);

    row.className = 'field t-' + tier + (selected ? ' sel' : '') + (def.critical ? ' is-critical' : '');
    row.hidden = ui.filter === 'todo' && !entry.flagged && !selected;

    var chip = CHIP[tier] || CHIP.auto;
    row.querySelector('.f-status').innerHTML =
      '<span class="chip ' + chip[0] + '">' + esc(App.T[chip[1]]) + '</span>' +
      confidenceHTML(def, entry, usable, state.confidenceSource === 'agreement');

    row.querySelector('.detail').innerHTML =
      (App.State.isPending(tier) || selected) ? detailHTML(def, state, tier, selected) : '';

    if (def.choice) {
      row.querySelectorAll('.seg button').forEach(function (b) {
        var isAi = b.dataset.val === String(entry.aiValue).trim();
        b.classList.toggle('ai', isAi && !entry.decision);
        b.classList.toggle('on', b.dataset.val === String(entry.value).trim());
        b.title = isAi ? App.T.aiProposal : '';
      });
    } else {
      var control = row.querySelector('#fld-' + CSS.escape(def.key));
      if (control) {
        if (def.type === 'boolean') {
          control.checked = !!entry.value;
        } else if (document.activeElement !== control && control.value !== String(entry.value)) {
          control.value = String(entry.value);
        }
      }
    }
  }

  function updateAll(host, state, ui) {
    allDefs().forEach(function (def) { updateRow(host, def, state, ui); });

    // Hide a section heading when every field under it is hidden.
    host.querySelectorAll('.sec').forEach(function (heading) {
      var rows = host.querySelectorAll('.field[data-sec="' + CSS.escape(heading.dataset.sec) + '"]');
      heading.hidden = !Array.prototype.some.call(rows, function (r) { return !r.hidden; });
    });
  }

  /* ----------------------------------------------------------------- wire */

  function attach(host, handlers) {
    host.addEventListener('click', function (e) {
      var row = e.target.closest('.field');
      if (!row) return;
      var key = row.dataset.key;
      var section = row.dataset.section;
      var button = e.target.closest('[data-act]');

      if (!button) { handlers.onSelect(key); return; }

      var act = button.dataset.act;
      if (act === 'opt' || act === 'apply') {
        handlers.onApply(key, button.dataset.val, section);
      } else {
        handlers.onAction(key, act, section);
      }
    });

    host.addEventListener('input', function (e) {
      var row = e.target.closest('.field');
      if (!row) return;
      var tag = e.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
      var value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      handlers.onChange(row.dataset.key, value, row.dataset.section);
    });

    host.addEventListener('focusin', function (e) {
      var row = e.target.closest('.field');
      if (row && !e.target.closest('[data-act]')) handlers.onSelect(row.dataset.key, true);
    });
  }

  App.Form = {
    build: build,
    updateAll: updateAll,
    updateRow: updateRow,
    attach: attach,
    allDefs: allDefs,
    sectionOf: sectionOf
  };
})(window.App);
