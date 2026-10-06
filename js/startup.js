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
  var pending = native && !seen;
  var release;
  var ready = new Promise(function (resolve) { release = resolve; });
  var api = window.RMStartup = {
    ready: ready,
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
      if (typeof window.prepareStartupUpdate === 'function') await window.prepareStartupUpdate(api);
    } catch (e) {
      console.error('[startup] controllo aggiornamenti non disponibile', e);
    }
    pending = false;
    api.status('Preparazione introduzione…');
    release();
  }, { once: true });
})();
