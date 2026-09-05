/* ==========================================================================
   Configurazione centrale del marchio (checkpoint "Migrazione sicura del
   marchio e copertina"). Punto unico da cui leggere nome prodotto, nome
   sistema, payoff, colori PWA e percorsi degli asset — sia a runtime (nel
   browser, via window.BRAND) sia in Node (script di build/verifica, via
   module.exports: stesso oggetto, nessun valore duplicato a mano).

   Checkpoint "Nome nativo Role Makers System": il nome VISIBILE
   dell'app (icona, titolo, appName nativo/PWA) è ora il nome completo
   "Role Makers System" — productName. "Role Makers" resta solo per i
   campi progettati espressamente come abbreviazione (PWA short_name,
   apple-mobile-web-app-title) — shortName, mai usato altrove per il nome
   dell'app. systemName resta disponibile per un'eventuale prosa che debba
   nominare esplicitamente il regolamento come concetto distinto dall'app
   (oggi identico testualmente a productName, ma tenuto separato per non
   dover riunire i due significati se un giorno tornassero a divergere).

   Deliberatamente NON copre tutto: index.html (<title>, meta description,
   apple-mobile-web-app-title), manifest.json, capacitor.config.json e
   package.json restano testo statico modificato a mano — questo progetto
   non ha un bundler/step di build (vedi CLAUDE.md) che possa iniettarci
   questo valore prima che il browser li legga. scripts/check-brand-
   consistency.js (richiamato da build:www) verifica che restino allineati
   a QUESTO file, così una divergenza futura fa fallire la build invece di
   passare inosservata.

   Identificativi TECNICI (non marchio, mai da toccare qui né altrove senza
   una migrazione dedicata e approvata): appId com.minimalsystem.companion,
   package "minimal-system-companion", chiavi localStorage ms_*, prefisso
   cache "minimal-system-v*", schema minimalsystem://, i repository GitHub
   MinimalSystem-Releases e MinimalSystem-ManualediGioco. Whitelist completa
   nel report del checkpoint. */
(function () {
  var BRAND = {
    productName: 'Role Makers System',
    systemName: 'Role Makers System',
    shortName: 'Role Makers',
    payoff: 'da una semplice idea a infinite possibilità',
    description: 'Role Makers — scheda personaggio interattiva per il GDR Role Makers System.',
    themeColor: '#14161A',
    backgroundColor: '#14161A',
    assets: {
      coverTop: 'img/role-makers-cover-top.png',
      coverPayoff: 'img/role-makers-cover-payoff.png',
      introVideo: 'media/intro-role-makers.mp4',
      introPoster: 'media/intro-role-makers-poster.webp',
      combatMapFallback: 'img/logo.png',
      icon192: 'icons/icon-192.png',
      icon512: 'icons/icon-512.png',
      iconMaskable512: 'icons/icon-maskable-512.png',
      favicon16: 'icons/favicon-16.png',
      favicon32: 'icons/favicon-32.png',
      appleTouchIcon: 'icons/apple-touch-icon.png'
    }
  };
  if (typeof window !== 'undefined') {
    window.BRAND = BRAND;
    // Retrocompatibilità: window.BRAND_NAME era già letto da js/app.js
    // (toast) e js/pdfviewer.js (filigrana) prima di questa estensione —
    // resta valido invece di dover toccare ogni chiamante.
    window.BRAND_NAME = BRAND.productName;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BRAND;
  }
})();
