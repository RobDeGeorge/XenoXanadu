/* ============================================================================
 *  XenoXanadu — Bring Your Own Model (BYOM) pipeline
 *  ----------------------------------------------------------------------------
 *  A tiny, dependency-free client-side bridge to a model the *user* runs on
 *  their own machine. The site ships this pipeline; the visitor supplies the
 *  model. Nothing here talks to a XenoXanadu server — there isn't one.
 *
 *  Supports two endpoint flavours so it's genuinely "any local model", not just
 *  Ollama:
 *    • Ollama native      — /api/tags        + /api/chat   (NDJSON stream)
 *    • OpenAI-compatible   — /v1/models       + /v1/chat/completions (SSE)
 *      (LM Studio, llama.cpp `server`, Jan, vLLM, KoboldCpp, Ollama's own /v1…)
 *
 *  One config (endpoint + provider + model) is saved in localStorage and shared
 *  across every game, so the user connects once.
 *
 *  Exposes a single global: window.XenoBYOM
 * ========================================================================== */
(function (global) {
  'use strict';

  var STORE_KEY = 'xeno.byom.v1';
  var DEFAULT_ENDPOINT = 'http://localhost:11434';

  // ---- shared, persisted config -------------------------------------------
  function defaults() {
    return { endpoint: DEFAULT_ENDPOINT, provider: 'auto', model: '', apiKey: '' };
  }

  function loadConfig() {
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      var c = JSON.parse(raw);
      return Object.assign(defaults(), c);
    } catch (e) {
      return defaults();
    }
  }

  function saveConfig(patch) {
    var c = Object.assign(loadConfig(), patch || {});
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch (e) {}
    return c;
  }

  function base(endpoint) {
    return String(endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  }

  // ---- error model ---------------------------------------------------------
  // fetch() rejects with an opaque TypeError for *every* network-layer failure
  // (server down, CORS rejected, mixed-content blocked, Private Network Access
  // preflight blocked). The browser deliberately hides which one it is. So we
  // classify by *context* and hand back every plausible remedy.
  function ConnError(kind, message, remedies) {
    var e = new Error(message);
    e.kind = kind;           // 'network' | 'cors' | 'http' | 'no-models' | 'parse'
    e.remedies = remedies || [];
    return e;
  }

  // Is the page loaded over https while pointing at an http://localhost model?
  // That combination is what trips PNA / mixed-content on the hosted site.
  function isCrossSchemeLocal(endpoint) {
    try {
      var u = new global.URL(base(endpoint));
      var pageHttps = global.location.protocol === 'https:';
      var local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname);
      return pageHttps && u.protocol === 'http:' && local;
    } catch (e) { return false; }
  }

  // Is the page itself being served locally? AI play is only offered when it is —
  // a public HTTPS page can't reach a visitor's localhost model (PNA/CORS), so the
  // hosted site is arcade-only and the local copy gets the BYO-model features.
  function isLocal() {
    try {
      var h = global.location.hostname;
      return global.location.protocol === 'file:' ||
        /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i.test(h) ||
        /\.local$/i.test(h);
    } catch (e) { return false; }
  }

  function originHint() {
    // The exact origin the user must allow in OLLAMA_ORIGINS.
    try { return global.location.origin; } catch (e) { return '*'; }
  }

  // Turn a thrown fetch failure into an actionable ConnError.
  function classify(err, endpoint, phase) {
    if (err && err.kind) return err;            // already classified
    var ep = base(endpoint);
    var remedies = [];
    var crossLocal = isCrossSchemeLocal(endpoint);

    remedies.push('Make sure your model server is running and reachable at ' + ep + '.');
    remedies.push(
      'Allow this site as an origin. For Ollama, restart it with:\n' +
      '    OLLAMA_ORIGINS="' + originHint() + '" ollama serve\n' +
      '  (or OLLAMA_ORIGINS="*" while testing).'
    );
    if (crossLocal) {
      remedies.push(
        'This page is served over HTTPS but your model is on http://localhost. ' +
        'Chrome/Edge may block that via Private Network Access. If the test keeps ' +
        'failing, try Firefox, or run the games locally (see the setup page).'
      );
    }
    return ConnError('network',
      'Could not reach the model at ' + ep + (phase ? ' (' + phase + ')' : '') + '.',
      remedies);
  }

  // ---- provider detection --------------------------------------------------
  // Returns { provider, models }.  Tries the user's chosen provider; 'auto'
  // probes Ollama first, then OpenAI-compatible.
  function detect(cfg, signal) {
    var ep = base(cfg.endpoint);
    var want = cfg.provider || 'auto';

    function tryOllama() {
      return fetch(ep + '/api/tags', { signal: signal, headers: authHeaders(cfg, true) })
        .then(function (r) {
          if (!r.ok) throw ConnError('http', 'Ollama responded HTTP ' + r.status + '.',
            r.status === 403 ? ['Ollama is up but rejected this origin (CORS). Restart it with ' +
              'OLLAMA_ORIGINS="' + originHint() + '".'] : []);
          return r.json();
        })
        .then(function (j) {
          var models = (j.models || []).map(function (m) { return m.name; }).sort();
          return { provider: 'ollama', models: models };
        });
    }

    function tryOpenAI() {
      return fetch(ep + '/v1/models', { signal: signal, headers: authHeaders(cfg, false) })
        .then(function (r) {
          if (!r.ok) throw ConnError('http', 'OpenAI-compatible server responded HTTP ' + r.status + '.', []);
          return r.json();
        })
        .then(function (j) {
          var models = ((j.data || j.models || [])).map(function (m) {
            return m.id || m.name;
          }).filter(Boolean).sort();
          return { provider: 'openai', models: models };
        });
    }

    if (want === 'ollama') return tryOllama().catch(function (e) { throw classify(e, cfg.endpoint, 'listing models'); });
    if (want === 'openai') return tryOpenAI().catch(function (e) { throw classify(e, cfg.endpoint, 'listing models'); });

    // auto: Ollama first; if its endpoint itself is unreachable/404, fall back.
    return tryOllama().catch(function (e1) {
      return tryOpenAI().catch(function () { throw classify(e1, cfg.endpoint, 'listing models'); });
    });
  }

  function authHeaders(cfg, isOllama) {
    var h = {};
    if (cfg.apiKey && !isOllama) h['Authorization'] = 'Bearer ' + cfg.apiKey;
    return h;
  }

  // ---- public: list models -------------------------------------------------
  function listModels(cfg, signal) {
    cfg = Object.assign(loadConfig(), cfg || {});
    return detect(cfg, signal);
  }

  // ---- public: streaming chat ---------------------------------------------
  // opts: { messages, model?, provider?, temperature?, maxTokens?, onToken?,
  //         onThinking?, signal? }
  // onToken(text)    — visible answer deltas
  // onThinking(text) — reasoning deltas (deepseek-r1, qwq, …); falls back to onToken
  // Resolves to the full visible text.
  function chat(opts) {
    var cfg = Object.assign(loadConfig(), {
      endpoint: opts.endpoint, provider: opts.provider, model: opts.model, apiKey: opts.apiKey
    });
    // strip undefined so saved config wins
    Object.keys(cfg).forEach(function (k) { if (cfg[k] === undefined) cfg[k] = loadConfig()[k]; });

    var provider = opts.provider || cfg.provider;
    var model = opts.model || cfg.model;
    var think = opts.onThinking || opts.onToken || function () {};
    var token = opts.onToken || function () {};

    if (!model) {
      return Promise.reject(ConnError('no-models',
        'No model selected. Pull/load one (e.g. `ollama pull llama3.2:3b`) and pick it.', []));
    }

    // auto-resolve provider by URL shape if still 'auto'
    function resolveProvider() {
      if (provider === 'ollama' || provider === 'openai') return Promise.resolve(provider);
      return detect(cfg, opts.signal).then(function (d) { return d.provider; });
    }

    return resolveProvider().then(function (prov) {
      return prov === 'openai'
        ? streamOpenAI(cfg, model, opts, token, think)
        : streamOllama(cfg, model, opts, token, think);
    });
  }

  // Ollama /api/chat — newline-delimited JSON
  function streamOllama(cfg, model, opts, token, think) {
    var ep = base(cfg.endpoint);
    return fetch(ep + '/api/chat', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(cfg, true)),
      body: JSON.stringify({
        model: model,
        stream: true,
        options: {
          temperature: opts.temperature != null ? opts.temperature : 0.7,
          num_predict: opts.maxTokens != null ? opts.maxTokens : 512
        },
        messages: opts.messages
      }),
      signal: opts.signal
    }).then(function (res) {
      if (!res.ok) throw ConnError('http', 'Ollama HTTP ' + res.status + ' on /api/chat.',
        res.status === 403 ? ['CORS: restart Ollama with OLLAMA_ORIGINS="' + originHint() + '".'] : []);
      return pump(res, function (line, push) {
        var j; try { j = JSON.parse(line); } catch (e) { return; }
        var m = j.message || {};
        if (m.thinking) { think(m.thinking); }
        if (m.content) { token(m.content); push(m.content); }
      });
    }).catch(function (e) { throw classify(e, cfg.endpoint, 'streaming'); });
  }

  // OpenAI-compatible /v1/chat/completions — SSE "data: {…}" lines
  function streamOpenAI(cfg, model, opts, token, think) {
    var ep = base(cfg.endpoint);
    return fetch(ep + '/v1/chat/completions', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(cfg, false)),
      body: JSON.stringify({
        model: model,
        stream: true,
        temperature: opts.temperature != null ? opts.temperature : 0.7,
        max_tokens: opts.maxTokens != null ? opts.maxTokens : 512,
        messages: opts.messages
      }),
      signal: opts.signal
    }).then(function (res) {
      if (!res.ok) throw ConnError('http', 'Server HTTP ' + res.status + ' on /v1/chat/completions.', []);
      return pump(res, function (line, push) {
        if (line.indexOf('data:') !== 0) return;
        var data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        var j; try { j = JSON.parse(data); } catch (e) { return; }
        var d = (j.choices && j.choices[0] && j.choices[0].delta) || {};
        if (d.reasoning_content) think(d.reasoning_content);
        if (d.content) { token(d.content); push(d.content); }
      });
    }).catch(function (e) { throw classify(e, cfg.endpoint, 'streaming'); });
  }

  // Read a streamed body line-by-line; `onLine(line, push)` appends visible
  // text via push(); returns the accumulated visible text.
  function pump(res, onLine) {
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = '', full = '';
    function push(t) { full += t; }
    return (function loop() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (buf.trim()) onLine(buf.trim(), push);
          return full;
        }
        buf += dec.decode(chunk.value, { stream: true });
        var nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (line.trim()) onLine(line.trim(), push);
        }
        return loop();
      });
    })();
  }

  // ---- public: one-shot connection test for the setup hub ------------------
  // Resolves { ok:true, provider, models } or { ok:false, error } (never rejects).
  function test(cfg, signal) {
    return listModels(cfg, signal).then(function (d) {
      if (!d.models.length) {
        return { ok: false, error: ConnError('no-models',
          'Connected, but no models are installed. Pull one, e.g. `ollama pull llama3.2:3b`.', []) ,
          provider: d.provider };
      }
      return { ok: true, provider: d.provider, models: d.models };
    }).catch(function (e) {
      return { ok: false, error: e };
    });
  }

  global.XenoBYOM = {
    DEFAULT_ENDPOINT: DEFAULT_ENDPOINT,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    listModels: listModels,
    chat: chat,
    test: test,
    originHint: originHint,
    isLocal: isLocal,
    isCrossSchemeLocal: isCrossSchemeLocal
  };
})(window);
