/* =============================================================================
 * viewer.js — document preview: zoom, pan, fit to width, page switching.
 * Pure DOM, no dependencies. Works on the already-rendered page data URLs.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  var MIN_SCALE = 0.1;
  var MAX_SCALE = 8;

  function create(dom) {
    var pages = [];
    var index = 0;
    var scale = 1;
    var tx = 0;
    var ty = 0;
    var natural = { w: 1, h: 1 };
    var dragging = false;
    var dragStart = null;

    function apply() {
      dom.image.style.transform =
        'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      if (dom.zoomLabel) dom.zoomLabel.textContent = Math.round(scale * 100) + '%';
    }

    function clampScale(next) {
      return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    }

    function fitWidth() {
      var box = dom.stage.getBoundingClientRect();
      if (!natural.w || !box.width) return;
      scale = clampScale((box.width - 32) / natural.w);
      tx = 0;
      ty = 0;
      apply();
    }

    function fitPage() {
      var box = dom.stage.getBoundingClientRect();
      if (!natural.w || !box.width) return;
      scale = clampScale(Math.min((box.width - 32) / natural.w, (box.height - 32) / natural.h));
      tx = 0;
      ty = 0;
      apply();
    }

    function zoomBy(factor, originX, originY) {
      var before = scale;
      var next = clampScale(scale * factor);
      if (next === before) return;
      if (originX !== undefined) {
        // keep the point under the cursor stationary
        var box = dom.stage.getBoundingClientRect();
        var cx = originX - box.left - box.width / 2;
        var cy = originY - box.top - box.height / 2;
        tx = cx - (cx - tx) * (next / before);
        ty = cy - (cy - ty) * (next / before);
      }
      scale = next;
      apply();
    }

    function showPage(i) {
      if (!pages.length) return;
      index = Math.min(pages.length - 1, Math.max(0, i));
      var page = pages[index];
      dom.image.src = page.dataUrl;
      natural = { w: page.width, h: page.height };
      if (dom.pageLabel) {
        dom.pageLabel.textContent = (index + 1) + ' / ' + pages.length;
      }
      if (dom.prev) dom.prev.disabled = index === 0;
      if (dom.next) dom.next.disabled = index === pages.length - 1;
      if (dom.pager) dom.pager.hidden = pages.length < 2;
      if (dom.caption) {
        dom.caption.textContent = App.T.pageCaption(
          page.sourceName, page.pageNumber, page.width, page.height,
          App.Images.formatBytes(page.bytes));
      }
      requestAnimationFrame(fitWidth);
    }

    function setPages(list) {
      pages = list || [];
      index = 0;
      if (pages.length) showPage(0);
    }

    /* ------------------------------------------------------------ events */

    dom.stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
    }, { passive: false });

    dom.stage.addEventListener('pointerdown', function (e) {
      dragging = true;
      dragStart = { x: e.clientX - tx, y: e.clientY - ty };
      dom.stage.setPointerCapture(e.pointerId);
      dom.stage.classList.add('is-panning');
    });

    dom.stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      tx = e.clientX - dragStart.x;
      ty = e.clientY - dragStart.y;
      apply();
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      dom.stage.classList.remove('is-panning');
      try { dom.stage.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    dom.stage.addEventListener('pointerup', endDrag);
    dom.stage.addEventListener('pointercancel', endDrag);
    dom.stage.addEventListener('dblclick', function () { fitWidth(); });

    if (dom.zoomIn) dom.zoomIn.addEventListener('click', function () { zoomBy(1.25); });
    if (dom.zoomOut) dom.zoomOut.addEventListener('click', function () { zoomBy(1 / 1.25); });
    if (dom.fit) dom.fit.addEventListener('click', fitWidth);
    if (dom.fitPage) dom.fitPage.addEventListener('click', fitPage);
    if (dom.prev) dom.prev.addEventListener('click', function () { showPage(index - 1); });
    if (dom.next) dom.next.addEventListener('click', function () { showPage(index + 1); });

    window.addEventListener('resize', function () {
      if (pages.length) fitWidth();
    });

    return {
      setPages: setPages,
      showPage: showPage,
      fitWidth: fitWidth,
      fitPage: fitPage,
      zoomBy: zoomBy,
      get pageCount() { return pages.length; }
    };
  }

  App.Viewer = { create: create };
})(window.App);
