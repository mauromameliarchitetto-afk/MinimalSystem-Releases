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
   istante #app/copertina/menu diventano interattivi e focalizzabili.

   Raccordo (asset sostituito il 2026-09-18, misurato sul file reale):
   logo+wordmark si fermano a 5,55s, il motto "Da una semplice idea a
   infinite possibilità" appare di scatto a 6,75s e resta a schermo fino
   a 'ended' (7,57s). Fra i due — l'unica finestra davvero morta del
   video — il fotogramma viene scalato/spostato lentamente (1100ms,
   geometria reale misurata su '.cover-top-image', vedi SCALE_START_S e
   computeMatchTransform() sotto): la trasformazione FINISCE prima che il
   motto appaia, così non lo si vede mai scalare a metà. Il video resta
   SEMPRE opaco — nessuna dissolvenza — cosi' il motto si legge per intero
   fino alla fine reale del file. #app resta comunque inert/aria-hidden
   fino a 'ended': il raccordo è solo visivo, mai una finestra di
   interazione anticipata.

   La copertina attuale dispone il motto subito sotto il marchio. Il
   raccordo usa il rettangolo realmente disegnato da object-fit:contain
   e mantiene visibili marchio e motto negli schermi più bassi. */
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
  var visualTransitionStarted = false;
  var firstFrameRevealed = false;
  // Nella registrazione Android i primi ~0,3 s del quadrato video sono
  // grigio scuro, mentre il resto del viewport è nero. La maschera nera
  // copre soltanto questa apertura, fino al primo frame utile del filmato.
  var FIRST_VISIBLE_FRAME_S = 0.32;
  function revealFirstFrame() {
    if (firstFrameRevealed || finished) return;
    firstFrameRevealed = true;
    layer.classList.add('intro-frame-ready');
  }
  function watchDecodedFrames() {
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    video.requestVideoFrameCallback(function (_now, metadata) {
      if (finished || firstFrameRevealed) return;
      if (metadata.mediaTime >= FIRST_VISIBLE_FRAME_S) revealFirstFrame();
      else watchDecodedFrames();
    });
  }

  /* Finestra del raccordo, misurata sull'asset reale (vedi commento in
     cima al file): il video deve durare quanto ci si aspetta, altrimenti
     scalare a un istante assoluto scalerebbe il fotogramma sbagliato (a
     metà animazione, o già sul motto). Se la durata reale si scosta di
     più di DURATION_TOLERANCE_S da quella attesa, il raccordo si
     disattiva da solo e l'intro torna semplicemente ad attendere 'ended'
     senza alcuna trasformazione — stessa filosofia difensiva già in uso
     per il vecchio taglio della coda statica. */
  var EXPECTED_DURATION_S = 7.567;
  var DURATION_TOLERANCE_S = 0.5;
  var SCALE_START_S = 5.60; // il motto appare a 6,75s: la transizione CSS (1100ms) finisce a 6,70s, prima

  /* La chiusura funzionale avviene esclusivamente su 'ended': video e audio
     restano integrali. Da SCALE_START_S in poi si prepara soltanto il
     raccordo VISIVO — mai una dissolvenza: il video resta opaco, cambia
     solo scala/posizione, e la trasformazione (1100ms, vedi CSS) finisce
     prima che il motto appaia.

     Storia di questo calcolo (per non ripetere gli stessi due errori):
     1) prima versione: misurava '.cover-top-image' con getBoundingClientRect()
        UNA SOLA VOLTA, impostando visualTransitionStarted=true PRIMA ancora
        di sapere se la misura fosse valida — se uscivano tutti zeri (elemento
        non ancora pronto su quel device) restava così per il resto del video:
        nessuna transizione visibile, poi un salto secco su 'ended'.
     2) fix di quel giorno: eliminata la misura, sostituita con una scala
        fissa (0.92) centrata — non poteva più fallire in silenzio, ma non
        combaciava MAI con la copertina reale (un valore fisso non può
        adattarsi a dimensioni schermo diverse), e usava l'intero fotogramma
        1:1 come riferimento anche se il blocco marchio+logo occupa solo una
        sotto-regione del fotogramma: risultato, "scala senza scritta/righe,
        dimensioni comunque diverse".
     Questa versione: ripristina la misura geometrica reale (unico modo per
     seguire davvero le dimensioni dello schermo), ma la CORREGGE su entrambi
     i punti: CONTENT_BBOX sotto restringe il riferimento al solo blocco
     marchio+logo (non l'intero fotogramma, che include margini e il motto
     più in basso — misurato una volta sui pixel reali dell'asset), e
     startVisualTransition() ritenta a OGNI 'timeupdate' nella finestra finché
     la misura non è valida, invece di arrendersi al primo tentativo. */
  var CONTENT_BBOX = { left: 87 / 1080, top: 41 / 1080, right: 863 / 1080, bottom: 887 / 1080 };
  /* Nessun overscan da compensare qui: '.intro-video' non ha più alcun
     transform a riposo (vedi css/style.css, storia del bug della riga di
     compositing al bordo) — getBoundingClientRect() sotto riflette quindi
     sempre la geometria nativa del video, senza correzioni. */
  var matchTransform = null; // calcolato una sola volta, alla PRIMA misura valida (prima di qualunque transform sul video)
  function computeMatchTransform() {
    var target = document.querySelector('#view-cover .cover-top-image');
    var videoRect = video.getBoundingClientRect();
    var targetRect = target && target.getBoundingClientRect();
    if (!targetRect || targetRect.width <= 0 || !videoRect || videoRect.width <= 0 || videoRect.height <= 0) return null;
    // getBoundingClientRect() misura il box del <video>, NON il fotogramma
    // quadrato disegnato al centro da object-fit:contain. Su un telefono
    // alto usare l'altezza del box spostava il logo sotto la barra di stato.
    var ratio = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 1;
    var frameW = Math.min(videoRect.width, videoRect.height * ratio);
    var frameH = frameW / ratio;
    var frameLeft = videoRect.left + (videoRect.width - frameW) / 2;
    var frameTop = videoRect.top + (videoRect.height - frameH) / 2;
    var videoCx = videoRect.left + videoRect.width / 2;
    var videoCy = videoRect.top + videoRect.height / 2;
    var contentX = frameLeft + CONTENT_BBOX.left * frameW;
    var contentY = frameTop + CONTENT_BBOX.top * frameH;
    var contentW = (CONTENT_BBOX.right - CONTENT_BBOX.left) * frameW;
    var contentH = (CONTENT_BBOX.bottom - CONTENT_BBOX.top) * frameH;
    if (contentW <= 0 || contentH <= 0) return null;
    var scale = targetRect.width / contentW;
    if (!isFinite(scale) || scale <= 0.2 || scale >= 4) return null; // guardia contro misure assurde, mai un raccordo grottesco
    var contentCx = contentX + contentW / 2;
    var contentCy = contentY + contentH / 2;
    var targetCx = targetRect.left + targetRect.width / 2;
    var targetCy = targetRect.top + targetRect.height / 2;
    // Su schermi bassi la copertina può scorrere: mantieni visibile tutto
    // il blocco finale (logo e motto), anche quando il target teorico si
    // trova in parte oltre il viewport. Il margine non dipende dai pixel
    // fisici o dalla densità del dispositivo.
    var layerRect = layer.getBoundingClientRect();
    var layerStyle = getComputedStyle(layer);
    var margin = 8;
    var visibleLeft = layerRect.left + parseFloat(layerStyle.paddingLeft || 0) + margin;
    var visibleRight = layerRect.right - parseFloat(layerStyle.paddingRight || 0) - margin;
    var visibleTop = layerRect.top + parseFloat(layerStyle.paddingTop || 0) + margin;
    var visibleBottom = layerRect.bottom - parseFloat(layerStyle.paddingBottom || 0) - margin;
    // Il motto è nella fascia inferiore del fotogramma; l'intervallo
    // completo va da y=41 a y=1080 nel video quadrato.
    var fullTop = frameTop + CONTENT_BBOX.top * frameH;
    var fullBottom = frameTop + frameH;
    var fullLeft = contentX;
    var fullRight = contentX + contentW;
    scale = Math.min(scale,
      (visibleRight - visibleLeft) / (fullRight - fullLeft),
      (visibleBottom - visibleTop) / (fullBottom - fullTop));
    if (!isFinite(scale) || scale <= 0) return null;
    var offsetLeft = fullLeft - contentCx;
    var offsetRight = fullRight - contentCx;
    var offsetTop = fullTop - contentCy;
    var offsetBottom = fullBottom - contentCy;
    targetCx = Math.max(visibleLeft - scale * offsetLeft,
      Math.min(targetCx, visibleRight - scale * offsetRight));
    targetCy = Math.max(visibleTop - scale * offsetTop,
      Math.min(targetCy, visibleBottom - scale * offsetBottom));
    return {
      scale: scale,
      tx: targetCx - videoCx - scale * (contentCx - videoCx),
      ty: targetCy - videoCy - scale * (contentCy - videoCy)
    };
  }
  function startVisualTransition() {
    if (visualTransitionStarted || finished) return;
    if (!matchTransform) {
      matchTransform = computeMatchTransform();
      if (!matchTransform) return; // ritenta al prossimo timeupdate, mai un abbandono al primo tentativo
    }
    visualTransitionStarted = true;
    layer.style.setProperty('--intro-end-scale', matchTransform.scale.toFixed(6));
    layer.style.setProperty('--intro-end-x', matchTransform.tx.toFixed(2) + 'px');
    layer.style.setProperty('--intro-end-y', matchTransform.ty.toFixed(2) + 'px');
    // Forza il calcolo dello stato iniziale prima di applicare la classe:
    // evita che il browser accorpi i due paint e salti l'animazione.
    void video.offsetWidth;
    layer.classList.add('intro-finishing');
  }

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
  function onTimeUpdate() {
    if (video.currentTime > 0) markPlaybackStarted();
    // Ripiego per WebView privi di requestVideoFrameCallback.
    if (video.currentTime >= FIRST_VISIBLE_FRAME_S && video.readyState >= 2) revealFirstFrame();
    var d = video.duration;
    if (isFinite(d) && Math.abs(d - EXPECTED_DURATION_S) <= DURATION_TOLERANCE_S && video.currentTime >= SCALE_START_S) {
      startVisualTransition();
    }
  }

  function clearWatchdog() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  /* Protezione SOLO dagli errori (video che non parte né fallisce mai in
     modo esplicito): 15s coprono ampiamente i 7,57s reali del video più
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

  /* Rimozione "dura": il layer resta nero/opaco e bloccante fino a questo
     istante esatto (il raccordo cambia solo scala/posizione del video, mai
     la sua opacità) — via immediata dal DOM, #app reso interattivo e
     focalizzato SOLO qui, mai prima. Unico punto che tocca
     inert/aria-hidden/focus in tutto il file:
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
    // Se timeupdate è stato diradato dalla piattaforma, applica comunque lo
    // stato visivo finale prima della rimozione; normalmente la transizione
    // è già completa da quasi un secondo (finisce a 6,70s, 'ended' arriva a
    // 7,57s).
    startVisualTransition();
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
  watchDecodedFrames();

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
