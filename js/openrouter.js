/* =============================================================================
 * openrouter.js — everything that talks to the network.
 *
 * This is the ONLY file that knows about OpenRouter. To move the key behind a
 * backend proxy later, change `buildRequest` + `send` here; nothing else in the
 * app needs to change. See docs/DECISIONS.md D6.
 * ========================================================================== */

window.App = window.App || {};

(function (App) {
  'use strict';

  var KEY_PATTERN = /^sk-or-/;

  /* Backoff for HTTP 429, in ms. Two retries is enough to ride out a burst
   * without leaving the operator staring at a spinner for a minute. */
  var RATE_LIMIT_RETRIES = [3000, 8000];

  /* ------------------------------------------------------------- key store */

  var Key = {
    get: function () {
      try { return localStorage.getItem(App.Config.STORAGE_KEYS.apiKey) || ''; }
      catch (e) { return ''; }
    },
    set: function (value) {
      try { localStorage.setItem(App.Config.STORAGE_KEYS.apiKey, value.trim()); return true; }
      catch (e) { return false; }
    },
    clear: function () {
      try { localStorage.removeItem(App.Config.STORAGE_KEYS.apiKey); } catch (e) { /* ignore */ }
    },
    looksValid: function (value) {
      return KEY_PATTERN.test((value || '').trim());
    }
  };

  /* ---------------------------------------------------------------- errors */

  function ApiError(code, message, detail) {
    var err = new Error(message);
    err.name = 'ApiError';
    err.code = code;
    err.detail = detail || '';
    return err;
  }

  function describeStatus(status, body) {
    var providerMessage = '';
    try {
      var parsed = typeof body === 'string' ? JSON.parse(body) : body;
      providerMessage = (parsed && parsed.error && parsed.error.message) || '';
    } catch (e) { /* body was not JSON */ }

    var T = App.T;
    switch (status) {
      case 400: return ApiError('bad_request', T.errBadRequest, providerMessage);
      case 401: return ApiError('unauthorized', T.errUnauthorized, providerMessage);
      case 402: return ApiError('no_credits', T.errNoCredits, providerMessage);
      case 403: return ApiError('forbidden', T.errForbidden, providerMessage);
      case 404: return ApiError('not_found', T.errNotFound, providerMessage);
      case 413: return ApiError('too_large', T.errTooLarge, providerMessage);
      case 429: return ApiError('rate_limited', T.errRateLimited, providerMessage);
      default:
        if (status >= 500) {
          return ApiError('provider_error', T.errProvider(status), providerMessage);
        }
        return ApiError('http_error', T.errHttp(status), providerMessage);
    }
  }

  /* ----------------------------------------------------------- parse logic */

  /** Strips markdown fences and surrounding prose, then parses. */
  function parseLoose(text) {
    if (typeof text !== 'string' || !text.trim()) {
      throw ApiError('empty_response', App.T.errEmptyResponse, '');
    }
    var cleaned = text.trim();

    // ```json ... ```  or  ``` ... ```
    var fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();

    try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }

    // Take the outermost {...} and retry.
    var first = cleaned.indexOf('{');
    var last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      var slice = cleaned.slice(first, last + 1);
      try { return JSON.parse(slice); } catch (e2) { /* fall through */ }
    }

    throw ApiError('malformed_json', App.T.errMalformedJson, text.slice(0, 400));
  }

  /**
   * Accepts either { record, extra } or a bare flat record, so a model that
   * ignores the wrapper still produces a usable result.
   */
  function shapeResult(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw ApiError('malformed_json', App.T.errNotObject, '');
    }
    if (parsed.record && typeof parsed.record === 'object') {
      return {
        record: parsed.record,
        confidence: (parsed.confidence && typeof parsed.confidence === 'object')
          ? parsed.confidence : {},
        extra: (parsed.extra && typeof parsed.extra === 'object') ? parsed.extra : {}
      };
    }
    return { record: parsed, confidence: {}, extra: {} };
  }

  /* --------------------------------------------------------------- request */

  function buildRequest(modelId, pages, options) {
    var cfg = App.Config;
    var model = cfg.modelById(modelId);
    var useStructured = !!(model && model.structured) && !(options && options.forcePlainJson);

    var lean = !!(options && options.lean);
    var systemPrompt = App.Prompt.build(lean);
    if (!useStructured) systemPrompt += App.Prompt.JSON_ONLY_SUFFIX;
    if (options && options.repairNote) systemPrompt += '\n\n## Correction\n' + options.repairNote;

    var userContent = [{ type: 'text', text: App.Prompt.userInstruction(pages.length) }];
    pages.forEach(function (page) {
      userContent.push({ type: 'image_url', image_url: { url: page.dataUrl } });
    });

    var body = {
      // OpenRouter and the local server name the same model differently.
      model: cfg.modelNameFor(modelId),
      temperature: cfg.LIMITS.temperature,
      max_tokens: cfg.LIMITS.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    };

    if (useStructured) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'referral_extraction',
          strict: true,
          schema: lean ? cfg.LEAN_SCHEMA : cfg.SCHEMA
        }
      };
    } else {
      body.response_format = { type: 'json_object' };
    }

    return body;
  }

  function headers(apiKey) {
    var h = { 'Content-Type': 'application/json' };

    // A local inference server needs no key and no OpenRouter metadata.
    if (!App.Config.endpoint().requiresKey) return h;

    h['Authorization'] = 'Bearer ' + apiKey;
    h['X-Title'] = 'Document OCR';
    // Only send a referer for a real http(s) origin — never leak a local path.
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      h['HTTP-Referer'] = location.origin;
    }
    return h;
  }

  function send(body, apiKey, externalSignal, timeoutMs) {
    var controller = new AbortController();
    var timedOut = false;
    var limit = timeoutMs || App.Config.LIMITS.requestTimeoutMs;
    var timer = setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, limit);

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', function () { controller.abort(); });
    }

    return fetch(App.Config.endpoint().url, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(function (response) {
      return response.text().then(function (text) {
        return {
          ok: response.ok,
          status: response.status,
          text: text,
          // Providers often say how long to wait; honour it rather than guess.
          retryAfter: parseFloat(response.headers.get('retry-after')) || null
        };
      });
    }).catch(function (err) {
      if (err.name === 'AbortError') {
        throw timedOut
          ? ApiError('timeout', App.T.errTimeout(limit / 1000), '')
          : ApiError('cancelled', App.T.cancelled, '');
      }
      throw ApiError('network', App.T.errNetwork, err.message);
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  /* ----------------------------------------------------------------- main */

  /**
   * Runs one extraction.
   * @returns {Promise<{record, extra, raw, rawRequestSummary, usage, modelId, attempts}>}
   */
  function extract(modelId, pages, opts) {
    var options = opts || {};
    var apiKey = options.apiKey || Key.get();

    if (!apiKey && App.Config.endpoint().requiresKey) {
      return Promise.reject(ApiError('no_key', App.T.errNoKey, ''));
    }
    if (!pages || !pages.length) {
      return Promise.reject(ApiError('no_pages', App.T.errNoPages, ''));
    }

    var attempts = 0;
    var rateLimitWaits = 0;
    var lastRaw = '';

    /** Sleep that still honours Cancel. */
    function delay(ms, signal) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(resolve, ms);
        if (signal) {
          signal.addEventListener('abort', function () {
            clearTimeout(timer);
            reject(ApiError('cancelled', App.T.cancelled, ''));
          });
        }
      });
    }

    function attempt(requestOptions) {
      attempts++;
      var body = buildRequest(modelId, pages, requestOptions);

      return send(body, apiKey, options.signal, options.timeoutMs).then(function (res) {
        lastRaw = res.text;

        // 429 is the one status worth retrying by itself: it means "later",
        // not "wrong". Making the operator click Re-run for it is a chore we
        // can do for them. Bounded, so a throttled provider cannot hang the UI.
        if (res.status === 429 && rateLimitWaits < RATE_LIMIT_RETRIES.length) {
          var waitMs = res.retryAfter
            ? Math.min(res.retryAfter * 1000, 30000)
            : RATE_LIMIT_RETRIES[rateLimitWaits];
          rateLimitWaits++;
          if (options.onRetry) options.onRetry(rateLimitWaits, Math.round(waitMs / 1000));
          return delay(waitMs, options.signal).then(function () {
            return attempt(requestOptions);
          });
        }

        if (!res.ok) throw describeStatus(res.status, res.text);

        var envelope;
        try {
          envelope = JSON.parse(res.text);
        } catch (e) {
          throw ApiError('malformed_json', App.T.errMalformedEnvelope, res.text.slice(0, 400));
        }

        if (envelope.error) {
          throw ApiError('provider_error',
            envelope.error.message || App.T.errProviderPlain,
            JSON.stringify(envelope.error));
        }

        var choice = envelope.choices && envelope.choices[0];
        var content = choice && choice.message && choice.message.content;
        if (Array.isArray(content)) {
          content = content.map(function (part) { return part.text || ''; }).join('');
        }
        lastRaw = typeof content === 'string' ? content : res.text;

        var shaped = shapeResult(parseLoose(lastRaw));
        return {
          record: shaped.record,
          confidence: shaped.confidence,
          extra: shaped.extra,
          raw: lastRaw,
          rawEnvelope: res.text,
          usage: envelope.usage || null,
          modelId: envelope.model || modelId,
          finishReason: choice && choice.finish_reason,
          attempts: attempts
        };
      });
    }

    return attempt({}).catch(function (err) {
      // One structural retry, as described in main project documentation §7.2.
      var retryable = err.code === 'malformed_json' || err.code === 'empty_response';
      if (!retryable || attempts > 1) throw err;

      return attempt({
        forcePlainJson: true,
        repairNote: 'Your previous reply could not be parsed as JSON. Reply this time with the ' +
                    'JSON object alone — no fences, no commentary, starting with { and ending with }.'
      }).catch(function (second) {
        second.raw = lastRaw;
        throw second;
      });
    }).catch(function (err) {
      if (!err.raw) err.raw = lastRaw;
      throw err;
    });
  }

  App.OpenRouter = {
    Key: Key,
    extract: extract,
    buildRequest: buildRequest,
    parseLoose: parseLoose,
    ApiError: ApiError
  };
})(window.App);
