/* ==========================================================================
   Configurazione centrale del marchio (checkpoint "Migrazione sicura del
   marchio e copertina"). Punto unico da cui leggere nome prodotto, nome
   sistema, payoff, colori PWA e percorsi degli asset — sia a runtime (nel
   browser, via window.BRAND) sia in Node (script di build/verifica, via
   module.exports: stesso oggetto, nessun valore duplicato a mano).

   Rebrand "Role Makers" (app) vs "Role Makers System" (regolamento):
   il nome VISIBILE dell'app (icona, titolo, appName nativo/PWA) è
   "Role Makers" — productName, ora identico a shortName (che resta un
   campo distinto solo perché alcuni campi, tipo apple-mobile-web-app-title,
   sono pensati per un'abbreviazione: oggi coincidono, ma non è detto lo
   facciano per sempre). systemName resta "Role Makers System": il nome
   del regolamento GDR citato nei testi (es. "il GDR Role Makers System",
   js/rules.js, il Manuale di Gioco) — un concetto distinto dal nome
   dell'app, come "D&D Beyond" (app) rispetto a "Dungeons & Dragons"
   (regolamento). Non toccare i riferimenti al regolamento quando si
   aggiorna productName: sono intenzionalmente rimasti "Role Makers
   System".

   Deliberatamente NON copre tutto: index.html (<title>, meta description,
   apple-mobile-web-app-title), manifest.json, capacitor.config.json e
   package.json restano testo statico modificato a mano — questo progetto
   non ha un bundler/step di build (vedi CLAUDE.md) che possa iniettarci
   questo valore prima che il browser li legga. scripts/check-brand-
   consistency.js (richiamato da build:www) verifica che restino allineati
   a QUESTO file, così una divergenza futura fa fallire la build invece di
   passare inosservata.

   Identificativi TECNICI (non marchio, mai da toccare qui né altrove senza
   una migrazione dedicata e approvata): package "minimal-system-companion",
   chiavi localStorage ms_*, prefisso cache "minimal-system-v*", i
   repository GitHub MinimalSystem-Releases e MinimalSystem-ManualediGioco.
   Whitelist completa nel report del checkpoint.

   Migrazione approvata (Piano Unificato di Completamento, U0 — audit 8
   settembre 2026): appId e schema di redirect OAuth sono stati allineati
   al dominio live rolemakers.it — appId ora it.rolemakers.app (era
   com.minimalsystem.companion), schema ora rolemakers:// (era
   minimalsystem://). L'elenco dei redirect consentiti in Supabase Auth
   e' stato aggiornato di conseguenza il 15/09/2026 (rolemakers://*
   aggiunto; minimalsystem://* lasciato perche' il vecchio appId e' un
   pacchetto Android DIVERSO, quindi un'installazione precedente non si
   aggiorna e resterebbe senza login). Era rimasto indietro: il codice
   rediriggeva gia' a rolemakers://auth-callback mentre Supabase
   consentiva ancora solo minimalsystem://*, quindi Supabase scartava il
   redirect e ripiegava su SITE_URL — chi confermava l'email finiva sul
   sito invece che nell'app, e la sessione non tornava mai indietro.
   Resta invece da fare lato console OAuth Google/Apple, se e quando quei
   provider verranno attivati: oggi external_google_enabled e' false. localStorage/cache/repository NON
   sono toccati da questa migrazione: restano gli identificativi legacy. */
(function () {
  var BRAND = {
    productName: 'Role Makers',
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
