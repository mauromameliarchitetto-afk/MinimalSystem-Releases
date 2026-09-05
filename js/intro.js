/* ================================================================
   Introduzione animata — checkpoint isolato "Introduzione e copertina
   Role Makers". Nessuna dipendenza da app.js/cloud-*.js: gira PRIMA di
   loro (vedi index.html, script in cima) e non blocca in alcun modo la
   loro inizializzazione, che prosegue "dietro" questo livello.

   Una sola volta per vera sessione di avvio: sessionStorage (mai
   localStorage, che sopravviverebbe alla chiusura reale dell'app) —
   sopravvive a un location.reload() dopo un aggiornamento del service
   worker (stessa sessione), ma si azzera quando l'app viene davvero
   chiusa e riaperta (nuova sessione). Deliberatamente MAI agganciata a
   visibilitychange/resume/orientationchange: nessuno di questi eventi
   ricarica la pagina, quindi questo script non li vede proprio — è
   così che l'intro non riparte su schermo spento/riacceso, ritorno dal
   background, cambio orientamento, o navigazione interna alla
   copertina (che passa da showView(), mai da un reload).

   Sequenza alla fine del video (revisione checkpoint "8 punti", punto 1
   della seconda revisione): "video → copertina", senza alcun passaggio
   nero intermedio. All'evento 'ended' l'ultimo fotogramma è già stato
   mostrato per intero (è l'evento stesso a garantirlo): nello stesso
   istante — nessuna dissolvenza, nessun setTimeout — il layer viene
   rimosso e #app/copertina/menu diventano interattivi e focalizzabili.
   Prima di 'ended' (o di errore/watchdog) il layer resta nero, opaco e
   bloccante e #app resta invisibile/inert/aria-hidden per l'intera
   riproduzione. */
(function () {
  'use strict';
  var SESSION_KEY = 'rm_intro_shown_session';
  // Hotfix "intro che si blocca e riparte", protezione 3: chiave DISTINTA
  // da SESSION_KEY, scritta appena la riproduzione è realmente iniziata
  // (mai solo "tentata") — copre l'unico buco che permetteva la
  // ripartenza: un reload imprevisto (OTA/service worker) a metà video,
  // PRIMA che 'ended' avesse potuto scrivere SESSION_KEY. Se la pagina
  // ricarica in questa finestra, la vediamo qui e saltiamo dritti alla
  // copertina invece di rimostrare l'intro da capo.
  var STARTED_KEY = 'rm_intro_started_session';

  var layer = document.getElementById('intro-layer');
  var video = document.getElementById('intro-video');
  var gateBtn = document.getElementById('intro-gate-btn');
  var appEl = document.getElementById('app');
  if (!layer || !video || !gateBtn || !appEl) return; // markup assente: mai bloccare l'app per questo

  var alreadyShown = false;
  var startedNotFinished = false;
  try {
    alreadyShown = sessionStorage.getItem(SESSION_KEY) === '1';
    if (!alreadyShown) startedNotFinished = sessionStorage.getItem(STARTED_KEY) === '1';
  } catch (e) { /* storage non disponibile (privacy mode ecc.): trattata come prima volta */ }

  if (alreadyShown) {
    hardRemoveLayerAndActivateApp();
    return;
  }
  if (startedNotFinished) {
    // Reload imprevisto nella stessa sessione dopo che il video aveva già
    // iniziato la riproduzione ma prima di 'ended': mai una seconda
    // riproduzione dello stesso intro — passa direttamente alla copertina,
    // come se fosse già stata mostrata (markShown scrive anche SESSION_KEY,
    // così un ulteriore reload nella stessa sessione resta comunque coperto
    // dal ramo "alreadyShown" qui sopra).
    markShown();
    hardRemoveLayerAndActivateApp();
    return;
  }

  // #app già inert/aria-hidden e #intro-layer già esposto fin dal markup
  // (index.html, revisione checkpoint "8 punti", terza revisione, punto 6):
  // corretti nel DOM prima ancora che questo script possa eseguire, non più
  // solo dopo — qui non resta nulla da impostare per il percorso normale.

  var isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  var watchdogTimer = null;
  var errorRetryCount = 0;
  var finished = false;
  // Hotfix "intro che si blocca e riparte", protezione 2: vero solo dopo
  // che il video ha REALMENTE mostrato fotogrammi, mai solo "tentato" — un
  // errore da qui in poi non deve mai più innescare un retry (vedi
  // onError). Registrato da DUE segnali indipendenti (onPlaying/
  // onTimeUpdate, appena sotto): 'playing' è il segnale primario, ma se per
  // qualunque motivo non dovesse arrivare, un reale avanzamento di
  // currentTime è comunque una prova sufficiente — l'uno o l'altro basta,
  // mai serve attendere entrambi (fail-safe verso "mai più un retry", non
  // il contrario).
  var playbackStarted = false;

  function markShown() {
    try { sessionStorage.setItem(SESSION_KEY, '1'); }
    catch (e) { /* non bloccante: nel caso peggiore l'intro potrebbe ripetersi in quella sessione */ }
  }

  function markPlaybackStarted() {
    if (playbackStarted) return;
    playbackStarted = true;
    try { sessionStorage.setItem(STARTED_KEY, '1'); }
    catch (e) { /* non bloccante: nel caso peggiore un reload imprevisto a metà video potrebbe far ripartire l'intro */ }
  }
  function onPlaying() { markPlaybackStarted(); }
  function onTimeUpdate() { if (video.currentTime > 0) markPlaybackStarted(); }

  function clearWatchdog() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  /* Protezione SOLO dagli errori (video che non parte né fallisce mai in
     modo esplicito): 15s coprono ampiamente i 7,92s reali del video più
     margine di avvio. Una riproduzione regolare arriva sempre a 'ended'
     ben prima e disarma questo timer da sola. */
  function armWatchdog() {
    clearWatchdog();
    watchdogTimer = setTimeout(function () {
      console.error('[intro] watchdog: nessun evento ended/error entro il tempo massimo');
      finishIntro();
    }, 15000);
  }

  function cleanupVideo() {
    clearWatchdog();
    video.removeEventListener('ended', onEnded);
    video.removeEventListener('error', onError);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('timeupdate', onTimeUpdate);
    try { video.pause(); } catch (e) { /* video già rimosso/non riproducibile: nulla da fermare */ }
    video.removeAttribute('src');
    while (video.firstChild) video.removeChild(video.firstChild);
    video.load(); // rilascia davvero il decoder: mai lasciare il video "nascosto ma operativo" — SOLO qui, mai in un cleanup parziale
  }

  /* Rimozione "dura": layer già invisibile/non bloccante (dissolvenza già
     conclusa, o mai iniziata — errore/watchdog/sessione già vista) — via
     immediata dal DOM, #app reso interattivo e focalizzato SOLO qui, mai
     prima. Unico punto che tocca inert/aria-hidden/focus in tutto il file:
     ogni percorso (fine regolare, errore, watchdog, sessione già vista)
     passa sempre da qui, mai da una propria copia della stessa logica.
     Dispara anche l'evento 'rm-intro-finished' (revisione checkpoint
     "8 punti", terza revisione, punto 3): js/app.js lo ascolta per
     rimandare un eventuale reload di aggiornamento del service worker a
     DOPO la fine reale dell'introduzione, mai un polling/timer arbitrario.
     In ogni percorso che arriva qui, markShown() (o la sessione già vista
     letta all'avvio) ha già scritto il flag di sessione PRIMA di questo
     punto — chi ascolta l'evento lo trova quindi sempre già presente. */
  function hardRemoveLayerAndActivateApp() {
    if (layer.parentNode) layer.parentNode.removeChild(layer);
    if ('inert' in appEl) appEl.inert = false;
    appEl.removeAttribute('aria-hidden');
    var focusTarget = document.getElementById('btn-cover-menu');
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    window.dispatchEvent(new Event('rm-intro-finished'));
  }

  // Unico punto di chiusura, per QUALUNQUE causa (fine regolare, errore
  // persistente, watchdog): via diretta e sincrona, senza dissolvenza né
  // ritardo — il layer è rimasto nero/opaco/bloccante fino a questo
  // istante esatto, poi rimozione del layer e attivazione di #app
  // avvengono nello stesso passaggio (hardRemoveLayerAndActivateApp).
  function finishIntro() {
    if (finished) return;
    finished = true;
    markShown();
    gateBtn.removeEventListener('click', onGateClick);
    cleanupVideo();
    hardRemoveLayerAndActivateApp();
  }

  function onEnded() {
    finishIntro();
  }

  function onError() {
    if (finished) return; // il watchdog (o 'ended') può già aver chiuso l'intro: un error tardivo non deve riaprire nulla
    clearWatchdog();
    // Hotfix "intro che si blocca e riparte", protezione 2: un errore dopo
    // che il video ha GIÀ mostrato fotogrammi non deve mai più ritentare —
    // niente play(), niente currentTime riportato a zero, niente nuova
    // sorgente: chiude subito l'intro e passa alla copertina, esattamente
    // come un errore persistente. 'waiting'/'stalled' non arrivano qui (non
    // sono mai ascoltati da questo file): non possono provocare un retry.
    if (playbackStarted) {
      console.error('[intro] errore dopo l\'inizio visibile della riproduzione, nessun retry:', video.error);
      finishIntro();
      return;
    }
    errorRetryCount++;
    if (errorRetryCount === 1) {
      // un solo tentativo automatico di ripristino, mai un pulsante "Salta"
      // — solo perché il video non aveva ancora mostrato nulla.
      console.error('[intro] errore prima dell\'inizio visibile, ritento una volta:', video.error);
      attemptPlay(false);
    } else {
      console.error('[intro] errore di riproduzione persistente, passo alla copertina:', video.error);
      finishIntro();
    }
  }

  function showGate() {
    clearWatchdog();
    gateBtn.classList.remove('hidden');
    gateBtn.addEventListener('click', onGateClick);
    gateBtn.focus();
  }

  function onGateClick() {
    gateBtn.classList.add('hidden');
    gateBtn.removeEventListener('click', onGateClick);
    attemptPlay(true);
  }

  function attemptPlay(viaGesture) {
    if (finished) return; // difesa aggiuntiva: mai riarmare nulla dopo che l'intro è già stata chiusa
    armWatchdog();
    video.muted = false;
    video.volume = 1;
    var p;
    try { p = video.play(); } catch (e) { onError(); return; }
    if (p && typeof p.then === 'function') {
      p.catch(function (err) {
        if (!viaGesture && err && err.name === 'NotAllowedError') {
          // rifiuto dell'autoplay (politica della piattaforma): gate, mai un errore tecnico
          showGate();
        } else {
          onError();
        }
      });
    }
  }

  video.addEventListener('ended', onEnded);
  video.addEventListener('error', onError);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('timeupdate', onTimeUpdate);

  if (isNative) {
    // Android/iOS nativo: tenta subito la riproduzione automatica CON audio;
    // se il WebView la rifiuta, ricade sullo stesso gate del web (mai video
    // muto: vedi onGateClick/attemptPlay, l'audio resta sempre attivato).
    attemptPlay(false);
  } else {
    // Browser/PWA: nessun tentativo di autoplay (quasi certamente bloccato,
    // e comunque mai silenzioso) — il gate è lo stato iniziale, non un
    // ripiego dopo un fallimento.
    showGate();
  }
})();
