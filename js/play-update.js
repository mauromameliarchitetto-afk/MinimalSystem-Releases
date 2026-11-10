/* Avviso di aggiornamento in-app per le build Google Play
   (BUILD_CHANNEL === 'play', js/build-channel.js).

   Nel canale Play il vecchio controllo (OTA da GitHub, otaPlugin() e
   checkForUpdate() in js/app.js) è spento dalle policy dello store: qui si
   chiede direttamente a Google Play, con il plugin
   @capawesome/capacitor-app-update (In-App Updates di Play Core), se esiste
   una versione più nuova. Nessuna chiamata a GitHub né a Supabase.

   - All'avvio e a ogni ritorno in primo piano, al massimo una volta al
     minuto (checkPlayStoreUpdate, chiamata da init() e dal listener
     visibilitychange in js/app.js).
   - Aggiornamento disponibile: banner #update-banner (lo stesso degli
     aggiornamenti APK) con "Nuovo aggiornamento disponibile" e "Aggiorna".
     "Aggiorna" avvia l'aggiornamento flessibile (download in background
     gestito da Play); a download finito il pulsante diventa "Riavvia per
     aggiornare". Se Play non permette l'aggiornamento flessibile, apre la
     pagina dell'app su Google Play.
   - Qualunque errore (plugin assente, Play Store non installato o non
     ufficiale, app non installata da Play, offline, nessun aggiornamento):
     nessun messaggio e nessun blocco, si riprova al controllo successivo.
   Sideload, web e App Store non passano mai di qui (playUpdatePlugin()
   restituisce null). */

const PLAY_UPDATE_MIN_INTERVAL_MS = 60000;
// Valori degli enum del plugin (dist/esm/definitions.d.ts, versione 8.1)
const PLAY_UPDATE_AVAILABLE = 2;          // AppUpdateAvailability.UPDATE_AVAILABLE
const PLAY_INSTALL_DOWNLOADED = 11;       // FlexibleUpdateInstallStatus.DOWNLOADED
const PLAY_INSTALL_FAILED = 5;            // FlexibleUpdateInstallStatus.FAILED
const PLAY_INSTALL_CANCELED = 6;          // FlexibleUpdateInstallStatus.CANCELED
const PLAY_RESULT_OK = 0;                 // AppUpdateResultCode.OK

const PLAY_UPDATE_STATE = {
  lastCheckAt: 0,
  checking: false,
  phase: 'none',          // none | available | downloading | downloaded
  flexibleAllowed: false,
  listener: null
};

function playUpdatePlugin() {
  if (typeof BUILD_CHANNEL === 'undefined' || BUILD_CHANNEL !== 'play') return null;
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'android') return null;
  return (cap.Plugins && cap.Plugins.AppUpdate) || null;
}

function playUpdateBanner(text, buttonText, buttonDisabled) {
  const textEl = $('#update-banner-text');
  const btn = $('#update-banner-btn');
  if (!textEl || !btn) return;
  textEl.textContent = text;
  btn.textContent = buttonText;
  btn.disabled = !!buttonDisabled;
  const help = $('#update-banner-chrome-help');
  if (help) help.classList.add('hidden');
  if (typeof showNativeUpdateBanner === 'function') showNativeUpdateBanner();
}

function hidePlayUpdateBanner() {
  const banner = $('#update-banner');
  if (banner) { banner.classList.add('hidden'); banner.classList.remove('update-banner-takeover'); }
  const status = $('#home-status-box');
  if (status) status.classList.remove('hidden');
}

function showPlayUpdateAvailable() {
  PLAY_UPDATE_STATE.phase = 'available';
  playUpdateBanner('Nuovo aggiornamento disponibile', 'Aggiorna', false);
}

function showPlayUpdateDownloaded() {
  PLAY_UPDATE_STATE.phase = 'downloaded';
  playUpdateBanner('Aggiornamento scaricato', 'Riavvia per aggiornare', false);
}

async function checkPlayStoreUpdate() {
  const plugin = playUpdatePlugin();
  if (!plugin || PLAY_UPDATE_STATE.checking) return;
  const now = Date.now();
  if (now - PLAY_UPDATE_STATE.lastCheckAt < PLAY_UPDATE_MIN_INTERVAL_MS) return;
  PLAY_UPDATE_STATE.lastCheckAt = now;
  // durante il download (o con un aggiornamento già scaricato) il banner
  // resta com'è: nessuna nuova richiesta a Play che lo riporterebbe indietro
  if (PLAY_UPDATE_STATE.phase === 'downloading' || PLAY_UPDATE_STATE.phase === 'downloaded') return;
  PLAY_UPDATE_STATE.checking = true;
  try {
    const info = await plugin.getAppUpdateInfo();
    if (info && info.installStatus === PLAY_INSTALL_DOWNLOADED) { showPlayUpdateDownloaded(); return; }
    if (!info || info.updateAvailability !== PLAY_UPDATE_AVAILABLE) {
      if (PLAY_UPDATE_STATE.phase === 'available') { PLAY_UPDATE_STATE.phase = 'none'; hidePlayUpdateBanner(); }
      return;
    }
    PLAY_UPDATE_STATE.flexibleAllowed = info.flexibleUpdateAllowed === true;
    showPlayUpdateAvailable();
  } catch (e) {
    // silenzioso: Play Store assente, app non installata da Play, offline...
  } finally {
    PLAY_UPDATE_STATE.checking = false;
  }
}

async function startPlayFlexibleUpdate(plugin) {
  PLAY_UPDATE_STATE.phase = 'downloading';
  playUpdateBanner('Download dell\'aggiornamento in corso…', 'Aggiorna', true);
  try {
    if (!PLAY_UPDATE_STATE.listener && typeof plugin.addListener === 'function') {
      PLAY_UPDATE_STATE.listener = await Promise.resolve(plugin.addListener('onFlexibleUpdateStateChange', state => {
        const status = state && state.installStatus;
        if (status === PLAY_INSTALL_DOWNLOADED) showPlayUpdateDownloaded();
        else if ((status === PLAY_INSTALL_FAILED || status === PLAY_INSTALL_CANCELED) && PLAY_UPDATE_STATE.phase === 'downloading') showPlayUpdateAvailable();
      }));
    }
    const result = await plugin.startFlexibleUpdate();
    // annullato dall'utente nella finestra di Play, o non riuscito: si torna
    // a "Aggiorna", senza messaggi
    if (!result || result.code !== PLAY_RESULT_OK) {
      if (PLAY_UPDATE_STATE.phase === 'downloading') showPlayUpdateAvailable();
    }
  } catch (e) {
    if (PLAY_UPDATE_STATE.phase === 'downloading') showPlayUpdateAvailable();
  }
}

/* Chiamata dal gestore di #update-banner-btn (js/app.js) prima del
   percorso APK: true se il tocco è stato gestito qui. */
function handlePlayUpdateBannerClick() {
  const plugin = playUpdatePlugin();
  if (!plugin || PLAY_UPDATE_STATE.phase === 'none') return false;
  if (PLAY_UPDATE_STATE.phase === 'downloaded') {
    Promise.resolve().then(() => plugin.completeFlexibleUpdate()).catch(() => {});
    return true;
  }
  if (PLAY_UPDATE_STATE.phase !== 'available') return true;
  if (PLAY_UPDATE_STATE.flexibleAllowed) startPlayFlexibleUpdate(plugin);
  else Promise.resolve().then(() => plugin.openAppStore()).catch(() => {});
  return true;
}
