/* =============================================================================
 * app.js — screen flow and wiring. Owns no business rules.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var dom = {};
  var viewer = null;

  var session = {
    files: [],          // File[] — several files are pages of ONE document
    previews: [],       // { name, size, url, kind }
    pages: [],          // page objects from App.Images.load
    state: null,        // App.State object
    controller: null,   // AbortController for the in-flight request
    timer: null,
    startedAt: 0,
    lastError: null
  };

  /* --------------------------------------------------------------- helpers */

  function show(screen) {
    dom.screenUpload.hidden = screen !== 'upload';
    dom.screenReview.hidden = screen !== 'review';
    document.body.setAttribute('data-screen', screen);
  }

  function setBusy(busy) {
    dom.loading.hidden = !busy;
    dom.extractBtn.disabled = busy || session.files.length === 0;
    dom.rerunBtn.disabled = busy;
  }

  function showError(err) {
    session.lastError = err;
    dom.errorTitle.textContent = err.message || String(err);
    dom.errorDetail.textContent = err.detail || '';
    dom.errorDetail.hidden = !err.detail;
    dom.errorKeyBtn.hidden = !(err.code === 'no_key' || err.code === 'unauthorized');
    dom.errorBanner.hidden = false;
    if (err.raw) {
      dom.rawContent.textContent = err.raw;
      dom.rawPanel.hidden = false;
    }
  }

  function clearError() {
    dom.errorBanner.hidden = true;
    session.lastError = null;
  }

  function note(message) {
    dom.uploadNote.textContent = message || '';
    dom.uploadNote.hidden = !message;
  }

  function readStore(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  /* ----------------------------------------------------------- model menu */

  function initModels() {
    App.Config.MODELS.forEach(function (model) {
      var opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = model.label;
      opt.title = model.note;
      dom.modelSelect.appendChild(opt);
    });

    var saved = readStore(App.Config.STORAGE_KEYS.model, App.Config.DEFAULT_MODEL_ID);
    dom.modelSelect.value = App.Config.modelById(saved) ? saved : App.Config.DEFAULT_MODEL_ID;
    updateModelNote();

    dom.modelSelect.addEventListener('change', function () {
      writeStore(App.Config.STORAGE_KEYS.model, dom.modelSelect.value);
      updateModelNote();
    });
  }

  function updateModelNote() {
    var model = App.Config.modelById(dom.modelSelect.value);
    dom.modelNote.textContent = model ? model.note : '';
  }

  /* -------------------------------------------------------------- settings */

  function openSettings() {
    dom.apiKeyInput.value = App.OpenRouter.Key.get();
    updateKeyStatus();
    if (typeof dom.settingsDialog.showModal === 'function') dom.settingsDialog.showModal();
    else dom.settingsDialog.setAttribute('open', '');
    dom.apiKeyInput.focus();
  }

  function closeSettings() {
    if (typeof dom.settingsDialog.close === 'function') dom.settingsDialog.close();
    else dom.settingsDialog.removeAttribute('open');
  }

  function updateKeyStatus() {
    var key = App.OpenRouter.Key.get();
    if (!key) {
      dom.keyStatus.textContent = App.T.keyNone;
    } else {
      dom.keyStatus.textContent = App.T.keyStored(key.slice(0, 10) + '…' + key.slice(-4));
    }
  }

  function initSettings() {
    dom.settingsBtn.addEventListener('click', openSettings);
    dom.errorKeyBtn.addEventListener('click', function () { clearError(); openSettings(); });
    dom.closeSettings.addEventListener('click', closeSettings);

    dom.saveKey.addEventListener('click', function () {
      var value = dom.apiKeyInput.value.trim();
      if (!value) { dom.keyStatus.textContent = App.T.keyEnterFirst; return; }
      if (!App.OpenRouter.Key.looksValid(value)) {
        dom.keyStatus.textContent = App.T.keyLooksWrong;
      }
      App.OpenRouter.Key.set(value);
      updateKeyStatus();
      clearError();
      closeSettings();
    });

    dom.clearKey.addEventListener('click', function () {
      App.OpenRouter.Key.clear();
      dom.apiKeyInput.value = '';
      updateKeyStatus();
    });

    // A local inference server needs no key, so do not greet the operator with
    // a dialog asking for one.
    if (!App.Config.endpoint().requiresKey) {
      dom.settingsBtn.hidden = true;
    } else if (!App.OpenRouter.Key.get()) {
      openSettings();
    }
  }

  /* ------------------------------------------------------------ file input */

  function addFiles(fileList) {
    clearError();
    var rejected = [];
    Array.prototype.forEach.call(fileList, function (file) {
      if (!App.Images.isAccepted(file)) { rejected.push(file.name); return; }
      session.files.push(file);
    });

    if (rejected.length) {
      note(App.T.ignoredFormats(rejected));
    } else {
      note('');
    }
    renderFileList();
  }

  function removeFile(index) {
    var preview = session.previews[index];
    if (preview && preview.url) URL.revokeObjectURL(preview.url);
    session.files.splice(index, 1);
    renderFileList();
  }

  function clearFiles() {
    session.previews.forEach(function (p) { if (p.url) URL.revokeObjectURL(p.url); });
    session.files = [];
    session.previews = [];
    session.pages = [];
    renderFileList();
    note('');
  }

  function renderFileList() {
    dom.fileList.innerHTML = '';
    session.previews.forEach(function (p) { if (p.url) URL.revokeObjectURL(p.url); });
    session.previews = [];

    session.files.forEach(function (file, i) {
      var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      var card = document.createElement('li');
      card.className = 'file-card';

      var thumb = document.createElement('div');
      thumb.className = 'file-card__thumb';

      if (isPdf) {
        thumb.classList.add('file-card__thumb--pdf');
        thumb.textContent = 'PDF';
        // render page 1 as a real thumbnail in the background
        App.Images.load([file], { maxSide: 400, quality: 0.7, maxPages: 1 })
          .then(function (result) {
            if (!result.pages.length) return;
            thumb.textContent = '';
            thumb.classList.remove('file-card__thumb--pdf');
            var img = document.createElement('img');
            img.src = result.pages[0].dataUrl;
            img.alt = '';
            thumb.appendChild(img);
          })
          .catch(function () { /* keep the PDF placeholder */ });
      } else {
        var url = URL.createObjectURL(file);
        session.previews[i] = { url: url };
        var img = document.createElement('img');
        img.src = url;
        img.alt = '';
        thumb.appendChild(img);
      }

      var meta = document.createElement('div');
      meta.className = 'file-card__meta';
      var name = document.createElement('span');
      name.className = 'file-card__name';
      name.textContent = file.name;
      name.title = file.name;
      var size = document.createElement('span');
      size.className = 'file-card__size';
      size.textContent = App.Images.formatBytes(file.size);
      meta.appendChild(name);
      meta.appendChild(size);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn--ghost file-card__remove';
      remove.textContent = App.T.remove;
      remove.addEventListener('click', function () { removeFile(i); });

      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(remove);
      dom.fileList.appendChild(card);
    });

    var count = session.files.length;
    dom.fileSummary.textContent = count === 0
      ? App.T.noFile
      : App.T.filesSummary(count);
    dom.clearFilesBtn.hidden = count === 0;
    dom.extractBtn.disabled = count === 0;
    dom.payloadLine.hidden = true;
  }

  function initDropzone() {
    ['dragenter', 'dragover'].forEach(function (type) {
      dom.dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        dom.dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      dom.dropzone.addEventListener(type, function (e) {
        e.preventDefault();
        if (type === 'dragleave' && dom.dropzone.contains(e.relatedTarget)) return;
        dom.dropzone.classList.remove('is-over');
      });
    });
    dom.dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        addFiles(e.dataTransfer.files);
      }
    });
    dom.dropzone.addEventListener('click', function (e) {
      if (e.target === dom.browseBtn) return;
      dom.fileInput.click();
    });
    dom.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dom.fileInput.click(); }
    });
    dom.browseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dom.fileInput.click();
    });
    dom.fileInput.addEventListener('change', function () {
      if (dom.fileInput.files.length) addFiles(dom.fileInput.files);
      dom.fileInput.value = '';
    });
    dom.clearFilesBtn.addEventListener('click', clearFiles);
  }

  /* --------------------------------------------------------------- timing */

  function startTimer() {
    session.startedAt = Date.now();
    dom.elapsed.textContent = '0.0 s';
    session.timer = setInterval(function () {
      dom.elapsed.textContent = ((Date.now() - session.startedAt) / 1000).toFixed(1) + ' s';
    }, 100);
  }

  function stopTimer() {
    if (session.timer) clearInterval(session.timer);
    session.timer = null;
    return Date.now() - session.startedAt;
  }

  /* ------------------------------------------------------------ extraction */

  function preparePages() {
    var preprocess = dom.preprocessToggle.checked;
    writeStore(App.Config.STORAGE_KEYS.preprocess, preprocess ? '1' : '0');
    return App.Images.load(session.files, { preprocess: preprocess }).then(function (result) {
      session.pages = result.pages;
      var total = App.Images.formatBytes(result.totalBytes);
      dom.payloadLine.hidden = false;
      dom.payloadLine.textContent = App.T.pagesPrepared(result.pages.length, total);
      if (result.warnings.length) note(result.warnings.join(' '));
      return result;
    });
  }

  function runExtraction(reusePages) {
    clearError();
    var modelId = dom.modelSelect.value;
    var model = App.Config.modelById(modelId);
    dom.loadingModel.textContent = model ? model.label : modelId;
    setBusy(true);
    startTimer();

    session.controller = new AbortController();

    var prepare = reusePages && session.pages.length
      ? Promise.resolve({ pages: session.pages, totalBytes: App.Images.totalBytes(session.pages) })
      : preparePages();

    prepare.then(function (prepared) {
      dom.loadingPages.textContent = App.T.loadingPages(
        prepared.pages.length, App.Images.formatBytes(prepared.totalBytes));
      var doVerify = verifyWanted();
      dom.loadingPhase.textContent = doVerify ? App.T.phaseBoth : App.T.phaseReading(1, 1);

      // The two reads are independent, so they go out together. Sequentially
      // the operator waits for the sum; in parallel only for the slower one,
      // and the verifier is the fast model.
      var primary = App.OpenRouter.extract(modelId, prepared.pages, {
        signal: session.controller.signal,
        onRetry: function (attempt, seconds) {
          dom.loadingPhase.textContent = App.T.retryingRateLimit(attempt, seconds);
        }
      });

      if (!doVerify) {
        return primary.then(function (result) {
          return { primary: result, verify: null, verifyError: null, verifierId: null };
        });
      }

      // Verification contributes only `record`, so it asks for nothing else.
      // A failure here must never cost us the primary result.
      var verifierId = verifyModelId();
      var second = App.OpenRouter.extract(verifierId, prepared.pages, {
        signal: session.controller.signal,
        timeoutMs: App.Config.VERIFY.timeoutMs,
        lean: true
      }).then(function (r) {
        return { ok: r, err: null };
      }).catch(function (err) {
        return { ok: null, err: err };
      });

      return Promise.all([primary, second]).then(function (pair) {
        if (pair[1].err && pair[1].err.code === 'cancelled') throw pair[1].err;
        return {
          primary: pair[0],
          verify: pair[1].ok,
          verifyError: pair[1].err,
          verifierId: verifierId
        };
      });
    }).then(function (both) {
      var elapsed = stopTimer();
      setBusy(false);
      session.state = App.State.validateRecord(App.State.fromResult(both.primary, {
        elapsedMs: elapsed,
        pageCount: session.pages.length,
        bytes: App.Images.totalBytes(session.pages),
        preprocessed: dom.preprocessToggle.checked,
        verifyError: both.verifyError ? both.verifyError.message : null
      }));
      if (both.verify) {
        App.Agreement.apply(session.state, both.verify.record, both.verifierId);
      }
      renderReview();
      show('review');
    }).catch(function (err) {
      stopTimer();
      setBusy(false);
      if (err.code === 'cancelled') { note(App.T.cancelled); return; }
      showError(err);
      if (session.state) show('review');
    });
  }

  function cancelExtraction() {
    if (session.controller) session.controller.abort();
  }

  /** The second reader for the currently selected model, or null if there is none. */
  function verifyModelId() {
    return App.Config.verifyModelFor(dom.modelSelect.value);
  }

  /** Verification is on unless the operator turned it off, and needs a 2nd model. */
  function verifyWanted() {
    return dom.verifyToggle.checked && !!verifyModelId();
  }

  /* --------------------------------------------------------------- review */

  /* ------------------------------------------------------- review screen */

  var ui = { selected: null, filter: 'todo', built: false };

  var handlers = {
    onChange: function (key, value, section) {
      App.State.setValue(session.state, key, value, section);
      ui.selected = key;
      refreshReview();
    },
    onApply: function (key, value, section) {
      var def = App.Config.defByKey(key);
      App.State.setValue(session.state, key, value, section);
      App.State.normaliseField(session.state, key, section);
      var entry = session.state.fields[key] || session.state.extra[key];
      App.State.decide(session.state, key,
        String(entry.value).trim() === String(entry.aiValue).trim() ? 'confirmed' : 'edited',
        'suggestion');
      ui.selected = key;
      refreshReview();
      goNext();
    },
    onAction: function (key, act, section) {
      var state = session.state;
      if (act === 'confirm') {
        if (!confirmField(key)) return;
      } else if (act === 'absent') {
        App.State.setValue(state, key, App.Config.EMPTY_VALUE, section);
        App.State.decide(state, key, 'absent');
      } else if (act === 'override') {
        App.State.decide(state, key, 'override');
      } else if (act === 'undo') {
        App.State.undecide(state, key);
        ui.selected = key;
        refreshReview();
        return;
      }
      refreshReview();
      goNext();
    },
    onSelect: function (key) {
      if (ui.selected === key) return;
      ui.selected = key;
      refreshReview();
    }
  };

  function confirmField(key) {
    var def = App.Config.defByKey(key);
    var state = session.state;
    if (!App.State.canConfirm(def, state)) {
      var entry = state.fields[key] || state.extra[key];
      toast(App.State.textOf(entry) ? App.T.toastFixFirst : App.T.toastValueFirst);
      return false;
    }
    App.State.normaliseField(state, key, App.Form.sectionOf(def));
    var e2 = state.fields[key] || state.extra[key];
    App.State.decide(state, key,
      String(e2.value).trim() === String(e2.aiValue).trim() ? 'confirmed' : 'edited');
    return true;
  }

  /** Moves to the next field still needing a decision. */
  function goNext() {
    var defs = App.Form.allDefs();
    var start = ui.selected ? defs.map(function (d) { return d.key; }).indexOf(ui.selected) : -1;
    for (var k = 1; k <= defs.length; k++) {
      var def = defs[(start + k) % defs.length];
      if (App.State.isPending(App.State.tierOf(def, session.state))) {
        ui.selected = def.key;
        refreshReview();
        focusSelected();
        return;
      }
    }
    ui.selected = null;
    refreshReview();
    toast(App.T.toastAllResolved);
    dom.finishBtn.focus();
  }

  function focusSelected() {
    if (!ui.selected) return;
    var row = dom.recordForm.querySelector('#row-' + CSS.escape(ui.selected));
    if (!row) return;
    var control = row.querySelector('.field-input, .field-check, .seg button');
    if (control) control.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function refreshReview() {
    var state = session.state;
    App.Form.updateAll(dom.recordForm, state, ui);

    var c = App.State.counts(state);
    var T = App.T;

    dom.progLabel.textContent = c.pending
      ? T.progressPending(c.pending, c.flagged)
      : T.progressAllDone;
    dom.progBar.style.width = c.flagged
      ? Math.round((c.flagged - c.pending) / c.flagged * 100) + '%'
      : '100%';

    dom.counts.innerHTML =
      '<span><b>' + c.error + '</b> ' + T.countErrors + '</span>' +
      '<span><b>' + c.missing + '</b> ' + T.countMissing + '</span>' +
      '<span><b>' + c.low + '</b> ' + T.countLow + '</span>' +
      '<span><b>' + c.check + '</b> ' + T.countCheck + '</span>' +
      '<span><b>' + c.auto + '</b> ' + T.countAuto + '</span>';

    dom.tabTodo.textContent = T.tabTodo(c.flagged);
    dom.tabAll.textContent = T.tabAll(App.Form.allDefs().length);
    dom.tabTodo.setAttribute('aria-pressed', ui.filter === 'todo');
    dom.tabAll.setAttribute('aria-pressed', ui.filter === 'all');

    dom.finishBtn.disabled = c.pending > 0 || state.approved;
    dom.finishBtn.textContent = state.approved ? T.finishDone
      : (c.pending ? T.finishRemaining(c.pending) : T.finishApprove);
    if (c.pending > 0) state.approved = false;
  }

  function renderReview() {
    var state = session.state;
    viewer.setPages(session.pages);

    App.State.markFlagged(state);
    ui.selected = null;
    // "Wymagające uwagi" is only a useful default when something is actually
    // flagged. With a flat confidence signal almost nothing is, and the
    // operator would be staring at an empty panel.
    ui.filter = App.State.counts(state).flagged > 0 ? 'todo' : 'all';

    App.Form.build(dom.recordForm, state);
    if (!ui.built) { App.Form.attach(dom.recordForm, handlers); ui.built = true; }

    // Say plainly where the confidence numbers came from. A measured score and
    // a self-reported one look identical on screen and mean entirely different
    // things, so the operator is told which they are looking at.
    var spread = state.confidenceSpread || { usable: false };
    var measured = state.confidenceSource === 'agreement';
    dom.confNote.hidden = false;
    dom.confNote.classList.toggle('review-note--warn', !measured);

    if (state.meta.verifyError) {
      dom.confNote.textContent = App.T.verifyFailed(state.meta.verifyError);
    } else if (measured) {
      var text = App.T.confSourceAgreement(state.verifyModelId);
      // The weakest model as the primary reader is worth saying out loud: it is
      // the one that invented a NIP on a document that had none.
      if (state.meta.modelId && state.meta.modelId.indexOf('8b') !== -1) {
        text += ' ' + App.T.weakPrimaryWarning;
      }
      dom.confNote.textContent = text;
    } else {
      // No second read, so no measured number and no bars. One message covers
      // it: the old "pick the 235B instead" advice is obsolete — that model
      // reports a flat value too.
      dom.confNote.textContent = App.T.confSourceSelfReported;
    }

    refreshReview();

    dom.rawContent.textContent = state.raw || App.T.rawEmpty;
    dom.rawPanel.hidden = false;

    var meta = state.meta;
    var bits = [];
    bits.push(meta.modelId || dom.modelSelect.value);
    if (meta.elapsedMs) bits.push((meta.elapsedMs / 1000).toFixed(1) + ' s');
    if (meta.usage && meta.usage.total_tokens) bits.push(App.T.metaTokens(meta.usage.total_tokens));
    if (meta.pageCount) bits.push(App.T.metaPages(meta.pageCount));
    if (meta.bytes) bits.push(App.Images.formatBytes(meta.bytes));
    if (meta.attempts > 1) bits.push(App.T.metaAttempts(meta.attempts));
    if (meta.preprocessed) bits.push(App.T.metaPreprocessed);
    dom.metaLine.textContent = bits.join(' · ');

    var problems = [];
    if (meta.missingKeys && meta.missingKeys.length) {
      problems.push(App.T.noteMissingKeys(
        meta.missingKeys.length, meta.missingKeys, App.Config.EMPTY_VALUE));
    }
    if (meta.unexpectedKeys && meta.unexpectedKeys.length) {
      problems.push(App.T.noteUnexpectedKeys(meta.unexpectedKeys));
    }
    if (meta.finishReason && meta.finishReason !== 'stop') {
      problems.push(App.T.noteFinishReason(meta.finishReason));
    }
    dom.reviewNote.textContent = problems.join(' ');
    dom.reviewNote.hidden = problems.length === 0;
  }

  function exportRecord() {
    return App.State.toExport(session.state);
  }

  function copyText(text, button) {
    var done = function () {
      var original = button.textContent;
      button.textContent = App.T.copied;
      setTimeout(function () { button.textContent = original; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function downloadJson(obj, prefix) {
    var text = JSON.stringify(obj, null, 2);
    var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = prefix + '-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ------------------------------------------------------------------ init */

  function cacheDom() {
    [
      'screenUpload', 'screenReview', 'dropzone', 'fileInput', 'browseBtn', 'fileList',
      'fileSummary', 'clearFilesBtn', 'extractBtn', 'payloadLine', 'uploadNote',
      'preprocessToggle', 'verifyToggle', 'modelSelect', 'modelNote', 'settingsBtn',
      'loading', 'loadingModel', 'loadingPages', 'loadingPhase', 'elapsed', 'cancelBtn',
      'errorBanner', 'errorTitle', 'errorDetail', 'errorDismiss', 'errorKeyBtn',
      'settingsDialog', 'apiKeyInput', 'saveKey', 'clearKey', 'closeSettings', 'keyStatus',
      'recordForm', 'extraForm', 'rawPanel', 'rawContent', 'metaLine', 'reviewNote',
      'backBtn', 'rerunBtn', 'copyBtn', 'downloadBtn', 'copyExtraBtn',
      'progLabel', 'progBar', 'counts', 'tabTodo', 'tabAll', 'confNote', 'finishBtn',
      'viewerStage', 'viewerImage', 'zoomIn', 'zoomOut', 'fitWidth', 'fitPage',
      'zoomLabel', 'pagePrev', 'pageNext', 'pageLabel', 'pager', 'viewerCaption', 'toast'
    ].forEach(function (name) {
      var id = name.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
      dom[name] = $(id);
    });
  }

  function initReviewActions() {
    dom.backBtn.addEventListener('click', function () { show('upload'); });
    dom.rerunBtn.addEventListener('click', function () { runExtraction(true); });
    dom.copyBtn.addEventListener('click', function () {
      copyText(JSON.stringify(exportRecord(), null, 2), dom.copyBtn);
    });
    dom.copyExtraBtn.addEventListener('click', function () {
      var review = App.State.toReviewExport(session.state, {
        documentName: session.files.length ? session.files[0].name : null
      });
      copyText(JSON.stringify(review, null, 2), dom.copyExtraBtn);
    });
    dom.tabTodo.addEventListener('click', function () { ui.filter = 'todo'; refreshReview(); });
    dom.tabAll.addEventListener('click', function () { ui.filter = 'all'; refreshReview(); });
    dom.finishBtn.addEventListener('click', function () {
      session.state.approved = true;
      refreshReview();
      toast(App.T.toastApproved);
    });
    dom.downloadBtn.addEventListener('click', function () {
      downloadJson(exportRecord(), App.T.downloadPrefix);
    });
    dom.extractBtn.addEventListener('click', function () { runExtraction(false); });
    dom.cancelBtn.addEventListener('click', cancelExtraction);
    dom.errorDismiss.addEventListener('click', clearError);
  }

  var toastTimer = null;
  function toast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.classList.remove('on'); }, 2600);
  }

  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (dom.settingsDialog.open) return;          // <dialog> handles its own keys

      var inField = e.target.closest && e.target.closest('#record-form .field');

      if (e.key === 'Enter' && inField && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        e.preventDefault();
        var key = inField.dataset.key;
        var tier = App.State.tierOf(App.Config.defByKey(key), session.state);
        if (tier === 'error') {
          // Enter means "yes, the document really says this". Offering only
          // "fix it" would be wrong: the reading is often correct and the
          // number on the paper is the thing that is invalid.
          App.State.decide(session.state, key, 'override');
          refreshReview();
          goNext();
        } else if (App.State.isPending(tier)) {
          if (confirmField(key)) { refreshReview(); goNext(); }
        } else {
          goNext();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (!dom.loading.hidden) { cancelExtraction(); return; }
        if (inField) { e.target.blur(); return; }
        if (!dom.screenReview.hidden) { show('upload'); }
        return;
      }

      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey &&
          ['INPUT', 'TEXTAREA'].indexOf(e.target.tagName) === -1 &&
          !dom.screenReview.hidden) {
        e.preventDefault();
        goNext();
      }
    });
  }

  /**
   * Every module hangs off the global `App`, loaded by plain <script> tags. If
   * one fails to parse, or the browser serves a stale copy of one file and a
   * fresh copy of another, the symptom is a useless "Cannot read properties of
   * undefined" from somewhere deep in a click handler.
   *
   * This checks the whole set up front and names what is missing, so the next
   * time it happens nobody has to guess which file.
   */
  function selfCheck() {
    var required = {
      Config: ['MODELS', 'FIELD_DEFS', 'SCHEMA', 'THRESHOLDS'],
      T: ['noFile', 'phaseBoth', 'tierError'],
      Prompt: ['build'],
      Images: ['load'],
      OpenRouter: ['extract'],
      Validate: ['field'],
      State: ['fromResult', 'tierOf'],
      Agreement: ['apply'],
      Form: ['build', 'updateAll', 'attach'],
      Viewer: ['create']
    };

    var problems = [];
    Object.keys(required).forEach(function (name) {
      var mod = App[name];
      if (!mod) { problems.push('App.' + name + ' (js/' + name.toLowerCase() + '.js nie wczytany)'); return; }
      required[name].forEach(function (member) {
        if (mod[member] === undefined) problems.push('App.' + name + '.' + member);
      });
    });

    if (problems.length) {
      var message = 'Nie wczytano części aplikacji: ' + problems.join(', ') +
        '. Najczęstsza przyczyna to stara wersja pliku w pamięci podręcznej przeglądarki — ' +
        'odśwież przez Ctrl+Shift+R albo uruchom serwer przez „python serve.py".';
      // Shown even if the normal error banner is not wired up yet.
      if (dom.errorBanner && dom.errorTitle) {
        dom.errorTitle.textContent = message;
        dom.errorDetail.hidden = true;
        dom.errorKeyBtn.hidden = true;
        dom.errorBanner.hidden = false;
      } else {
        alert(message);
      }
      if (window.console) console.error('[Document OCR] self-check failed:', problems);
      return false;
    }
    return true;
  }

  function init() {
    cacheDom();
    if (!selfCheck()) return;
    initModels();
    initSettings();
    initDropzone();
    initReviewActions();
    initKeyboard();

    dom.preprocessToggle.checked =
      readStore(App.Config.STORAGE_KEYS.preprocess,
        App.Config.LIMITS.preprocessByDefault ? '1' : '0') === '1';

    dom.verifyToggle.checked =
      readStore(App.Config.STORAGE_KEYS.verify,
        App.Config.VERIFY.enabledByDefault ? '1' : '0') === '1';
    dom.verifyToggle.addEventListener('change', function () {
      writeStore(App.Config.STORAGE_KEYS.verify, dom.verifyToggle.checked ? '1' : '0');
    });

    viewer = App.Viewer.create({
      stage: dom.viewerStage,
      image: dom.viewerImage,
      zoomIn: dom.zoomIn,
      zoomOut: dom.zoomOut,
      fit: dom.fitWidth,
      fitPage: dom.fitPage,
      zoomLabel: dom.zoomLabel,
      prev: dom.pagePrev,
      next: dom.pageNext,
      pageLabel: dom.pageLabel,
      pager: dom.pager,
      caption: dom.viewerCaption
    });

    renderFileList();
    show('upload');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  App.exportRecord = exportRecord;   // single export seam for a future POST
})(window.App);
