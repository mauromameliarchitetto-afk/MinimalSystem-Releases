/* ==========================================================================
   Role Makers — Gioca in solitaria: modello IA locale.

   Due responsabilità separate:

   1) RMSoloModels — installazione del modello SUL DISPOSITIVO, solo quando
      serve (primo ingresso in "Gioca in solitaria", mai all'avvio dell'app):
      scrittura in un file temporaneo dell'Origin Private File System,
      verifica di dimensione e SHA-256 contro il manifest
      (js/solo/models.json), attivazione solo dopo la verifica. Un file
      presente ma non verificato non è un modello installato. Nel prototipo
      il modello si importa da un file locale scelto dall'utente: il canale
      di distribuzione definitivo (URL, hosting, costi) non è deciso e il
      manifest non inventa un indirizzo.

   2) RMSoloLLM — inferenza: llama.cpp compilato in WebAssembly (wllama,
      MIT, js/vendor/wllama) dentro la WebView/il browser. Nessuna chiamata
      a provider IA: il modello e il runtime sono file locali, e la CSP
      dell'app blocca comunque ogni origine non dichiarata. Un plugin
      nativo Capacitor (llama.cpp via JNI) può sostituire il backend con la
      stessa interfaccia (load/generate/abort/unload): vedi
      docs/single-player/FATTIBILITA_IA_LOCALE.md. Se il modello non c'è o
      fallisce, NON si passa al cloud: il chiamante usa i testi di riserva.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------ SHA-256 incrementale */
  // Implementazione compatta (FIPS 180-4): crypto.subtle.digest non è
  // incrementale e vorrebbe l'intero file (1–2 GB) in memoria.
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function Sha256() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64); this.bufLen = 0; this.len = 0; this.w = new Uint32Array(64);
  }
  Sha256.prototype._block = function (p, o) {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++) w[i] = (p[o + 4 * i] << 24) | (p[o + 4 * i + 1] << 16) | (p[o + 4 * i + 2] << 8) | p[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], H = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7));
      const t1 = (H + S1 + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0;
      const S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10));
      const t2 = (S0 + ((A & B) ^ (A & C) ^ (B & C))) | 0;
      H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    h[0] += A; h[1] += B; h[2] += C; h[3] += D; h[4] += E; h[5] += F; h[6] += G; h[7] += H;
  };
  Sha256.prototype.update = function (data) {
    let i = 0; this.len += data.length;
    if (this.bufLen) {
      while (this.bufLen < 64 && i < data.length) this.buf[this.bufLen++] = data[i++];
      if (this.bufLen === 64) { this._block(this.buf, 0); this.bufLen = 0; }
    }
    for (; i + 64 <= data.length; i += 64) this._block(data, i);
    while (i < data.length) this.buf[this.bufLen++] = data[i++];
    return this;
  };
  Sha256.prototype.hex = function () {
    const bits = this.len * 8;
    const pad = new Uint8Array(((this.bufLen < 56) ? 56 : 120) - this.bufLen + 8);
    pad[0] = 0x80;
    const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    const n = pad.length;
    pad[n - 8] = hi >>> 24; pad[n - 7] = hi >>> 16; pad[n - 6] = hi >>> 8; pad[n - 5] = hi;
    pad[n - 4] = lo >>> 24; pad[n - 3] = lo >>> 16; pad[n - 2] = lo >>> 8; pad[n - 1] = lo;
    this.update(pad);
    return Array.from(this.h, x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  };

  async function sha256OfBlob(blob, onProgress, signal) {
    const h = new Sha256();
    const CH = 8 * 1024 * 1024;
    for (let off = 0; off < blob.size; off += CH) {
      if (signal && signal.aborted) throw new DOMException('Annullato', 'AbortError');
      const part = new Uint8Array(await blob.slice(off, off + CH).arrayBuffer());
      h.update(part);
      if (onProgress) onProgress(Math.min(blob.size, off + CH), blob.size);
    }
    return h.hex();
  }

  /* ------------------------------------------------------ modelli */

  const MODELS_DIR = 'rm-solo-modelli';
  let manifestCache = null;

  async function manifest() {
    if (manifestCache) return manifestCache;
    const r = await fetch('js/solo/models.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('Manifest dei modelli non disponibile');
    manifestCache = await r.json();
    return manifestCache;
  }

  async function modelsDir() {
    if (!navigator.storage || !navigator.storage.getDirectory) throw new Error('Questo dispositivo non offre uno spazio file privato (OPFS) per il modello.');
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(MODELS_DIR, { create: true });
  }

  async function readInstalled() {
    try {
      const dir = await modelsDir();
      const fh = await dir.getFileHandle('installato.json');
      return JSON.parse(await (await fh.getFile()).text());
    } catch (e) { return null; }
  }

  async function writeJson(dir, name, obj) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(obj));
    await w.close();
  }

  async function spaceInfo() {
    try { const e = await navigator.storage.estimate(); return { quota: e.quota || 0, usage: e.usage || 0, libero: (e.quota || 0) - (e.usage || 0) }; }
    catch (e) { return null; }
  }

  /* Importa uno o più file (modello intero o parti gguf-split) scelti
     dall'utente. Ogni parte: copia in *.tmp -> verifica dimensione e
     SHA-256 -> rinomina. Il registro "installato.json" si scrive solo
     alla fine: un'interruzione lascia al massimo file temporanei, che il
     prossimo tentativo sovrascrive. Il modello precedente resta finché il
     nuovo non è verificato. */
  async function importFromFiles(modelId, files, onProgress, signal) {
    const man = await manifest();
    const def = man.modelli.find(m => m.id === modelId);
    if (!def) throw new Error('Modello non presente nel manifest');
    const parti = def.parti;
    const byName = {};
    Array.from(files).forEach(f => { byName[f.name] = f; });
    const missing = parti.filter(p => !byName[p.file]).map(p => p.file);
    if (missing.length) throw new Error('File mancanti: ' + missing.join(', '));
    const need = parti.reduce((a, p) => a + p.dimensione, 0);
    // chiede che lo spazio non venga liberato dal browser sotto pressione
    // (best effort: il permesso dipende dalla piattaforma)
    try { if (navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* non disponibile */ }
    const sp = await spaceInfo();
    if (sp && sp.quota && sp.libero < need * 1.05) throw new Error('Spazio insufficiente: servono ' + Math.ceil(need / 1e6) + ' MB, liberi ' + Math.floor(sp.libero / 1e6) + ' MB.');
    const dir = await modelsDir();
    let done = 0;
    for (const p of parti) {
      const f = byName[p.file];
      if (f.size !== p.dimensione) throw new Error(p.file + ': dimensione ' + f.size + ' diversa dal manifest (' + p.dimensione + ')');
      const tmp = await dir.getFileHandle(p.file + '.tmp', { create: true });
      const w = await tmp.createWritable();
      const h = new Sha256();
      const CH = 8 * 1024 * 1024;
      try {
        for (let off = 0; off < f.size; off += CH) {
          if (signal && signal.aborted) throw new DOMException('Annullato', 'AbortError');
          const chunk = new Uint8Array(await f.slice(off, off + CH).arrayBuffer());
          h.update(chunk);
          await w.write(chunk);
          if (onProgress) onProgress({ fase: 'copia', file: p.file, fatto: done + Math.min(f.size, off + CH), totale: need });
        }
        await w.close();
      } catch (e) {
        try { await w.abort(); } catch (e2) { /* già chiuso */ }
        await dir.removeEntry(p.file + '.tmp').catch(() => {});
        throw e;
      }
      const hex = h.hex();
      if (hex !== p.sha256) {
        await dir.removeEntry(p.file + '.tmp').catch(() => {});
        throw new Error(p.file + ': impronta SHA-256 non corrispondente, file scartato.');
      }
      done += f.size;
    }
    // tutte le parti verificate: attivazione
    for (const p of parti) {
      const tmp = await dir.getFileHandle(p.file + '.tmp');
      if (tmp.move) await tmp.move(p.file);
      else {
        const src = await tmp.getFile();
        const dst = await dir.getFileHandle(p.file, { create: true });
        const w = await dst.createWritable(); await w.write(src); await w.close();
        await dir.removeEntry(p.file + '.tmp');
      }
    }
    const prev = await readInstalled();
    await writeJson(dir, 'installato.json', { id: def.id, versione: def.versione, formato: def.formato, runtime: def.runtime, parti: parti.map(p => p.file), sha256: parti.map(p => p.sha256), verificatoIl: Date.now() });
    if (prev && prev.id !== def.id) for (const f of prev.parti) await dir.removeEntry(f).catch(() => {});
    return def;
  }

  async function installedFiles() {
    const inst = await readInstalled();
    if (!inst) return null;
    const dir = await modelsDir();
    const blobs = [];
    for (const name of inst.parti) blobs.push(await (await dir.getFileHandle(name)).getFile());
    return { info: inst, blobs };
  }

  async function removeInstalled() {
    const inst = await readInstalled();
    const dir = await modelsDir();
    if (inst) for (const f of inst.parti) await dir.removeEntry(f).catch(() => {});
    await dir.removeEntry('installato.json').catch(() => {});
  }

  /* ------------------------------------------------ backend nativo (APK) */

  // Plugin Capacitor "RMLocalLLM" (plugins/rm-local-llm): llama.cpp nativo
  // compilato dal sorgente. Disponibile solo nell'app Android; nel browser
  // resta il backend WebAssembly. Stessa interfaccia verso il gioco.
  function nativePlugin() {
    const Cap = global.Capacitor;
    return (Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.RMLocalLLM) || null;
  }

  const wasmModels = { readInstalled, importFromFiles, removeInstalled };

  async function readInstalledAny() {
    const n = nativePlugin();
    if (!n) return wasmModels.readInstalled();
    const st = await n.status();
    return st && st.installato ? st.installato : null;
  }

  /* Nativo: `files` è ignorato — il file si sceglie col selettore di
     sistema e la copia+verifica SHA-256 avviene in Java, fuori dalla WebView
     (niente 2 GB che passano dal bridge). */
  async function importAny(modelId, files, onProgress, signal) {
    const n = nativePlugin();
    if (!n) return wasmModels.importFromFiles(modelId, files, onProgress, signal);
    const man = await manifest();
    const def = man.modelli.find(m => m.id === modelId);
    if (!def) throw new Error('Modello non presente nel manifest');
    const sub = onProgress ? await n.addListener('importProgress', onProgress) : null;
    const onAbort = () => n.cancelImport();
    if (signal) signal.addEventListener('abort', onAbort);
    try {
      // nel nativo nessun limite di 2 GB: se il manifest lo prevede si
      // importa il file originale intero invece delle parti gguf-split
      await n.importModel({ modello: Object.assign({}, def, { parti: def.parti_native || def.parti }) });
      return def;
    } catch (e) {
      if (e && e.code === 'ANNULLATO') { const a = new Error(e.message); a.name = 'AbortError'; throw a; }
      if (e && e.code === 'SELEZIONE_VUOTA') { const a = new Error(e.message); a.name = 'SelezioneVuota'; throw a; }
      throw e;
    } finally {
      if (sub) sub.remove();
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  async function removeAny() {
    const n = nativePlugin();
    if (!n) return wasmModels.removeInstalled();
    await n.remove();
  }

  global.RMSoloModels = { manifest, readInstalled: readInstalledAny, importFromFiles: importAny, installedFiles, removeInstalled: removeAny, spaceInfo, sha256OfBlob, Sha256, native: () => !!nativePlugin() };

  /* --------------------------------- preparazione automatica (APK) */

  /* Il giocatore non sceglie né importa nulla: nell'APK il Narratore si
     prepara da solo. Scelta del modello per RAM del telefono (e spazio),
     scaricamento una volta sola dall'URL fisso del manifest, ripresa dopo
     un'interruzione, verifica SHA-256 in Java. Su rete a consumo si chiede
     una volta sola il permesso (il file pesa 1–2,5 GB); senza rete si
     aspetta. Un solo processo per volta, qualunque schermata lo richieda.
     Nel browser non si scarica nulla: il gioco usa i testi di riserva. */
  const GiB = 1024 * 1024 * 1024;
  const setup = { stato: 'sconosciuto', modello: null, dimensione: 0, fatto: 0, totale: 0, errore: null, reteAConsumo: false };
  const watchers = new Set();
  let running = null;
  function emit(patch) { Object.assign(setup, patch); watchers.forEach(fn => { try { fn(Object.assign({}, setup)); } catch (e) { /* osservatore */ } }); }

  function nativeParts(def) { return def.parti_native || def.parti; }
  function partsSize(def) { return nativeParts(def).reduce((a, p) => a + p.dimensione, 0); }

  /* Modello per questo telefono: il 4B da ram_minima_per_4b_gib in su e se
     c'è spazio, altrimenti il 1.7B. Solo modelli con URL nel manifest. */
  function chooseModel(man, info) {
    const soglia = ((man.selezione_automatica || {}).ram_minima_per_4b_gib || 7) * GiB;
    const ok = man.modelli.filter(m => nativeParts(m).every(p => p.url));
    const big = ok.find(m => /4b/i.test(m.id)), small = ok.find(m => /1\.7b/i.test(m.id)) || ok[ok.length - 1];
    const spazio = Number(info && info.spazioLibero) || Infinity;
    if (big && Number(info && info.ramTotale) >= soglia && spazio > partsSize(big) + 300 * 1024 * 1024) return big;
    return small || big || null;
  }

  async function ensureNarrator(opts) {
    const n = nativePlugin();
    if (!n) { emit({ stato: 'non_supportato' }); return setup; }
    if (running) return running;
    running = (async () => {
      try {
        const st = await n.status();
        if (st && st.installato) { emit({ stato: 'pronto', modello: st.installato.id, errore: null }); return setup; }
        const man = await manifest();
        const info = await n.deviceInfo();
        const def = chooseModel(man, info);
        if (!def) { emit({ stato: 'errore', errore: 'Nessun modello scaricabile nel manifest.' }); return setup; }
        emit({ modello: def.id, dimensione: partsSize(def), reteAConsumo: !!info.reteAConsumo });
        if (info.connesso === false) { emit({ stato: 'attesa_rete' }); return setup; }
        if (info.reteAConsumo && !(opts && opts.consentiDatiMobili)) { emit({ stato: 'attesa_consenso' }); return setup; }
        emit({ stato: 'scaricamento', fatto: 0, totale: partsSize(def), errore: null });
        const sub = await n.addListener('importProgress', ev => emit({ fatto: ev.fatto, totale: ev.totale || setup.totale }));
        try {
          await n.downloadModel({ modello: Object.assign({}, def, { parti: nativeParts(def) }) });
        } finally { if (sub) sub.remove(); }
        emit({ stato: 'pronto', fatto: setup.totale, errore: null });
        return setup;
      } catch (e) {
        emit({ stato: e && e.code === 'ANNULLATO' ? 'sospeso' : 'errore', errore: String(e && e.message || e) });
        return setup;
      } finally { running = null; }
    })();
    return running;
  }

  global.RMSoloNarratorSetup = {
    ensure: ensureNarrator, chooseModel,
    state: () => Object.assign({}, setup),
    watch(fn) { watchers.add(fn); return () => watchers.delete(fn); },
    pause() { const n = nativePlugin(); if (n) n.cancelImport(); }
  };

  /* ------------------------------------------------------ inferenza */

  let wllama = null, loadedId = null, loading = null, busy = Promise.resolve();
  const status = { stato: 'assente', modello: null, errore: null, backend: 'wasm', thread: null };

  async function loadInstalled(onProgress) {
    if (loadedId) return status;
    if (loading) return loading;
    loading = (async () => {
      status.stato = 'caricamento'; status.errore = null;
      const n = nativePlugin();
      if (n) {
        status.backend = 'nativo';
        try {
          const st = await n.status();
          if (!st.installato) { status.stato = 'assente'; return status; }
          const r = await n.load({ nCtx: 4096 });
          loadedId = r.modello; status.stato = 'pronto'; status.modello = r.modello;
          status.caricamentoMs = r.caricamentoMs; status.thread = r.info && r.info.thread;
        } catch (e) {
          status.stato = e && e.code === 'ASSENTE' ? 'assente' : 'errore'; status.errore = String(e && e.message || e);
        } finally { loading = null; }
        return status;
      }
      try {
        const files = await installedFiles();
        if (!files) { status.stato = 'assente'; return status; }
        const mod = await import('../vendor/wllama/index.js');
        wllama = new mod.Wllama({ default: 'js/vendor/wllama/wllama.wasm' }, { logger: mod.LoggerWithoutDebug, suppressNativeLog: true });
        const t0 = performance.now();
        await wllama.loadModel(files.blobs, { n_ctx: 4096, n_gpu_layers: 0, progressCallback: onProgress });
        status.caricamentoMs = Math.round(performance.now() - t0);
        loadedId = files.info.id;
        status.stato = 'pronto'; status.modello = files.info.id;
        status.thread = global.crossOriginIsolated ? 'multi' : 'singolo';
      } catch (e) {
        status.stato = 'errore'; status.errore = String(e && e.message || e);
        wllama = null; loadedId = null;
      } finally { loading = null; }
      return status;
    })();
    return loading;
  }

  /* Una generazione alla volta (coda). `signal` interrompe senza
     toccare lo stato della partita: la narrazione resta "da generare". */
  function generate(req) {
    const run = async () => {
      const n = nativePlugin();
      if (n) {
        if (!loadedId) throw new Error('Modello non caricato');
        const onAbort = () => n.abort();
        if (req.signal) { if (req.signal.aborted) throw new Error('interrotto'); req.signal.addEventListener('abort', onAbort); }
        try {
          const r = await n.generate({ system: req.system, user: req.user, schema: req.schema || null, maxTokens: req.maxTokens || 300, temperature: 0.4 });
          if (!r.ok) throw new Error(r.error || 'generazione non riuscita');
          return { text: r.text, ms: Math.round((r.msPrompt || 0) + (r.msGen || 0)), modello: r.modello, usage: { prompt_tokens: r.promptTokens, cached_tokens: r.cachedTokens, completion_tokens: r.genTokens } };
        } finally { if (req.signal) req.signal.removeEventListener('abort', onAbort); }
      }
      if (!wllama || !loadedId) throw new Error('Modello non caricato');
      const t0 = performance.now();
      const res = await wllama.createChatCompletion({
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
        max_tokens: req.maxTokens || 300,
        temperature: 0.4,
        response_format: req.schema ? { type: 'json_schema', json_schema: { name: 'risposta', schema: req.schema } } : undefined,
        chat_template_kwargs: { enable_thinking: false },
        abortSignal: req.signal
      });
      const text = res && res.choices && res.choices[0] && res.choices[0].message ? res.choices[0].message.content : '';
      return { text, ms: Math.round(performance.now() - t0), modello: loadedId, usage: res && res.usage };
    };
    const p = busy.then(run, run);
    busy = p.catch(() => {});
    return p;
  }

  async function unload() {
    const n = nativePlugin();
    if (n) { try { await n.unload(); } catch (e) { /* già scaricato */ } }
    if (wllama) { try { await wllama.exit(); } catch (e) { /* già chiuso */ } }
    wllama = null; loadedId = null; status.stato = 'assente'; status.modello = null;
  }

  global.RMSoloLLM = {
    status: () => Object.assign({}, status),
    ready: () => status.stato === 'pronto',
    load: loadInstalled,
    generate,
    unload
  };
})(typeof window !== 'undefined' ? window : globalThis);
