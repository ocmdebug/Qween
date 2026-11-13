/* =============================================================================
 * image.js — file -> page images ready to send.
 *
 * Input:  File objects (png / jpg / jpeg / webp / pdf)
 * Output: an ordered array of page objects:
 *           { id, sourceName, pageNumber, dataUrl, width, height, bytes }
 *
 * Images are downscaled so the longest side is <= LIMITS.maxImageSide and
 * re-encoded to JPEG at LIMITS.jpegQuality, unless the original is already
 * small enough — then the original bytes are sent untouched.
 *
 * PDFs are rendered page by page with pdf.js.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  var PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var pdfWorkerReady = false;
  var uid = 0;

  /* ----------------------------------------------------------------- utils */

  function bytesOfDataUrl(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var b64 = dataUrl.slice(comma + 1);
    var padding = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0);
    return Math.floor(b64.length * 3 / 4) - padding;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error(App.T.imgCannotRead(file.name))); };
      fr.readAsDataURL(file);
    });
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error(App.T.imgCannotRead(file.name))); };
      fr.readAsArrayBuffer(file);
    });
  }

  /** Decodes a File into something drawable, honouring EXIF orientation. */
  function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return createImageBitmap(file, { imageOrientation: 'from-image' })
          .catch(function () { return decodeViaImgElement(file); });
      } catch (e) {
        return decodeViaImgElement(file);
      }
    }
    return decodeViaImgElement(file);
  }

  function decodeViaImgElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error(App.T.imgCannotDecode(file.name)));
      };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------ preprocess */

  /**
   * Optional readability pass: luminance + percentile contrast stretch.
   * Off by default (LIMITS.preprocessByDefault); the UI exposes a toggle so
   * the two modes can be compared in docs/EXTRACTION_TESTS.md.
   */
  function preprocessCanvas(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var img;
    try {
      img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      return canvas; // tainted canvas; skip silently
    }
    var d = img.data;
    var hist = new Uint32Array(256);
    var i, lum;

    for (i = 0; i < d.length; i += 4) {
      lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      d[i] = d[i + 1] = d[i + 2] = lum;
      hist[lum]++;
    }

    var total = d.length / 4;
    var cut = Math.floor(total * 0.005); // clip the darkest/lightest 0.5%
    var acc = 0, lo = 0, hi = 255;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc > cut) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc > cut) { hi = i; break; } }
    if (hi - lo < 16) return canvas; // nothing useful to stretch

    var scale = 255 / (hi - lo);
    var lut = new Uint8Array(256);
    for (i = 0; i < 256; i++) {
      lut[i] = Math.max(0, Math.min(255, Math.round((i - lo) * scale)));
    }
    for (i = 0; i < d.length; i += 4) {
      d[i] = d[i + 1] = d[i + 2] = lut[d[i]];
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /* --------------------------------------------------------------- scaling */

  /**
   * Scale factor for a page image.
   *
   * Driven by HEIGHT (the manager's spec: ~1100-1200 px), because these are
   * portrait A4 referrals and height is what determines whether a line of
   * handwriting is still legible. `maxSide` stays as a guard so an unusually
   * wide or landscape scan cannot produce a huge payload.
   * Never upscales: a small original is sent as-is.
   */
  function scaleFactor(srcWidth, srcHeight, targetHeight, maxSide) {
    var byHeight = targetHeight / srcHeight;
    var byLongEdge = maxSide / Math.max(srcWidth, srcHeight);
    return Math.min(1, byHeight, byLongEdge);
  }

  function drawScaled(source, srcWidth, srcHeight, targetHeight, maxSide) {
    var scale = scaleFactor(srcWidth, srcHeight, targetHeight, maxSide);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(srcWidth * scale));
    canvas.height = Math.max(1, Math.round(srcHeight * scale));
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* ------------------------------------------------------------------ pdf */

  function ensurePdfWorker() {
    if (pdfWorkerReady) return;
    if (typeof window.pdfjsLib === 'undefined') {
      throw new Error(App.T.imgNoPdfLib);
    }
    // A Worker cannot be constructed straight from a cross-origin URL, so wrap
    // the CDN script in a same-origin blob that importScripts() it. If even
    // that fails, pdf.js falls back to its main-thread "fake worker".
    try {
      var blob = new Blob(['importScripts(' + JSON.stringify(PDF_WORKER_URL) + ');'],
        { type: 'application/javascript' });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (e) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    }
    pdfWorkerReady = true;
  }

  function renderPdf(file, options) {
    ensurePdfWorker();
    return readAsArrayBuffer(file).then(function (buffer) {
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    }).then(function (pdf) {
      var limit = Math.min(pdf.numPages, options.maxPages);
      var chain = Promise.resolve();
      var pages = [];
      var n;

      for (n = 1; n <= limit; n++) {
        (function (pageNumber) {
          chain = chain.then(function () {
            return pdf.getPage(pageNumber).then(function (page) {
              var base = page.getViewport({ scale: 1 });
              // A PDF has no inherent pixel size, so render straight to the
              // target height (capped, so a wide page cannot run away).
              var scale = Math.min(
                4,
                options.targetHeight / base.height,
                options.maxSide / Math.max(base.width, base.height)
              );
              var viewport = page.getViewport({ scale: scale });
              var canvas = document.createElement('canvas');
              canvas.width = Math.round(viewport.width);
              canvas.height = Math.round(viewport.height);
              var ctx = canvas.getContext('2d', { willReadFrequently: true });
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              return page.render({ canvasContext: ctx, viewport: viewport }).promise
                .then(function () {
                  if (options.preprocess) preprocessCanvas(canvas);
                  pages.push(canvasToPage(canvas, file.name, pageNumber, options));
                });
            });
          });
        })(n);
      }

      return chain.then(function () {
        return { pages: pages, totalPages: pdf.numPages, truncated: pdf.numPages > limit };
      });
    });
  }

  function canvasToPage(canvas, sourceName, pageNumber, options) {
    var dataUrl = canvas.toDataURL('image/jpeg', options.quality);
    return {
      id: 'p' + (++uid),
      sourceName: sourceName,
      pageNumber: pageNumber,
      dataUrl: dataUrl,
      width: canvas.width,
      height: canvas.height,
      bytes: bytesOfDataUrl(dataUrl)
    };
  }

  /* --------------------------------------------------------------- public */

  /**
   * Turns a list of Files into an ordered list of page objects.
   * Several files are treated as pages of ONE document, in the order given.
   */
  function load(files, opts) {
    var cfg = App.Config.LIMITS;
    var options = {
      targetHeight: (opts && opts.targetHeight) || cfg.targetHeight,
      maxSide: (opts && opts.maxSide) || cfg.maxImageSide,
      quality: (opts && opts.quality) || cfg.jpegQuality,
      maxPages: (opts && opts.maxPages) || cfg.maxPages,
      preprocess: !!(opts && opts.preprocess)
    };

    var pages = [];
    var warnings = [];
    var chain = Promise.resolve();

    Array.prototype.forEach.call(files, function (file) {
      chain = chain.then(function () {
        if (pages.length >= options.maxPages) {
          warnings.push(App.T.imgSkippedLimit(file.name, options.maxPages));
          return null;
        }

        var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        if (isPdf) {
          return renderPdf(file, {
            targetHeight: options.targetHeight,
            maxSide: options.maxSide,
            quality: options.quality,
            preprocess: options.preprocess,
            maxPages: options.maxPages - pages.length
          }).then(function (result) {
            result.pages.forEach(function (p) { pages.push(p); });
            if (result.truncated) {
              warnings.push(App.T.imgPdfTruncated(file.name, result.totalPages, result.pages.length));
            }
          });
        }

        return decodeImage(file).then(function (bitmap) {
          var w = bitmap.width || bitmap.naturalWidth;
          var h = bitmap.height || bitmap.naturalHeight;
          // "Already small enough" now means it is at or under the target
          // height, not under the old long-edge cap.
          var fitsAlready = scaleFactor(w, h, options.targetHeight, options.maxSide) >= 1;
          var alreadyJpeg = file.type === 'image/jpeg';

          // Small JPEG and no preprocessing requested -> send the original bytes.
          if (fitsAlready && alreadyJpeg && !options.preprocess && file.size <= 1536 * 1024) {
            return readAsDataUrl(file).then(function (dataUrl) {
              pages.push({
                id: 'p' + (++uid),
                sourceName: file.name,
                pageNumber: 1,
                dataUrl: dataUrl,
                width: w,
                height: h,
                bytes: bytesOfDataUrl(dataUrl)
              });
            });
          }

          var canvas = drawScaled(bitmap, w, h, options.targetHeight, options.maxSide);
          if (options.preprocess) preprocessCanvas(canvas);
          pages.push(canvasToPage(canvas, file.name, 1, options));
          if (bitmap.close) bitmap.close();
        });
      });
    });

    return chain.then(function () {
      if (!pages.length) throw new Error(App.T.imgNoPages);
      return { pages: pages, warnings: warnings, totalBytes: totalBytes(pages) };
    });
  }

  function totalBytes(pages) {
    return pages.reduce(function (sum, p) { return sum + p.bytes; }, 0);
  }

  function isAccepted(file) {
    var cfg = App.Config.LIMITS;
    if (cfg.acceptedTypes.indexOf(file.type) !== -1) return true;
    var name = file.name.toLowerCase();
    return cfg.acceptedExtensions.some(function (ext) { return name.endsWith(ext); });
  }

  App.Images = {
    load: load,
    isAccepted: isAccepted,
    formatBytes: formatBytes,
    totalBytes: totalBytes
  };
})(window.App);
