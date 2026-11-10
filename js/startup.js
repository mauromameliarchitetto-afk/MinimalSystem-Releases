/* Avvio: controllo aggiornamenti -> scelta download -> preparazione video.
   Il pannello esiste nel markup, prima di qualsiasi caricamento del video.
   Nessun timer decide quando il video diventa visibile: lo decide intro.js
   dopo un fotogramma decodificato. La rete ha invece un limite in app.js. */
(function () {
  'use strict';
  var panel = document.getElementById('startup-panel');
  var label = document.getElementById('startup-status');
  var button = document.getElementById('startup-download');
  if (!panel || !label || !button) return;
  var native = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  var seen = false;
  try { seen = sessionStorage.getItem('rm_intro_shown_session') === '1' || sessionStorage.getItem('rm_intro_started_session') === '1'; } catch (e) {}
  var ios = native && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() === 'ios';
  // iPhone: la vista web ingrandisce la pagina su ogni campo sotto i 16px e non torna indietro (accesso e iscrizione si spostavano, 8/11/2026)
  if (ios) { var vp = document.querySelector('meta[name="viewport"]'); if (vp && !/maximum-scale/.test(vp.content)) vp.content += ', maximum-scale=1'; }
  var pending = native && !seen;
  var timings = {};
  function mark(name) { if (timings[name] === undefined) timings[name] = Math.round(performance.now()); }
  var release;
  var ready = new Promise(function (resolve) { release = resolve; });
  var api = window.RMStartup = {
    ready: ready,
    mark: mark,
    record: function (kind, fields) {
      try {
        var key = 'rm_startup_diagnostics_v1';
        var entries = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(entries)) entries = [];
        entries.push({ at: new Date().toISOString(), kind: kind, data: fields });
        localStorage.setItem(key, JSON.stringify(entries.slice(-40)));
      } catch (e) { /* Diagnostica mai bloccante, anche senza storage. */ }
    },
    diagnostics: function () {
      try { var entries = JSON.parse(localStorage.getItem('rm_startup_diagnostics_v1') || '[]'); return Array.isArray(entries) ? entries : []; } catch (e) { return []; }
    },
    timings: function () { return Object.assign({}, timings); },
    pageReady: function () {
      mark('pageReady');
      if (!ios) return;
      api.hide();
      if (seen) mark('homeVisible');
      var splash = window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen;
      if (splash && splash.hide) Promise.resolve(splash.hide({ fadeOutDuration: 0 })).then(function () { mark('splashHidden'); }).catch(function () {});
    },
    handlesInitialUpdate: pending,
    isChecking: function () { return pending; },
    status: function (text) { label.textContent = text; },
    progress: function (fraction) {
      if (!Number.isFinite(fraction)) return;
      var percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
      label.textContent = 'Download in corso… ' + percent + '%';
    },
    action: function (text) {
      button.textContent = text;
      button.disabled = false;
      button.classList.remove('hidden');
      button.focus();
      return new Promise(function (resolve) {
        button.onclick = function () {
          button.onclick = null;
          button.disabled = true;
          button.classList.add('hidden');
          resolve();
        };
      });
    },
    hide: function () { panel.classList.add('hidden'); },
    show: function (text) { panel.classList.remove('hidden'); if (text) api.status(text); }
  };
  if (!pending) { api.hide(); release(); return; }
  // Le funzioni di app.js e i plugin sono disponibili dopo il parsing.
  // Il listener è indipendente da init(): un'attesa di rete non blocca
  // notifyAppReady() né l'inizializzazione dell'app sotto il pannello.
  document.addEventListener('DOMContentLoaded', async function () {
    try {
      if (!ios && typeof window.prepareStartupUpdate === 'function') await window.prepareStartupUpdate(api);
    } catch (e) {
      console.error('[startup] controllo aggiornamenti non disponibile', e);
    }
    pending = false;
    api.status('Preparazione introduzione…');
    release();
  }, { once: true });
})();
