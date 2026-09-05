/* Client Supabase (account/campagne/cloud). Nessun bundler in questo
   progetto (PWA statica + Capacitor): la libreria e' vendorizzata in
   js/vendor/supabase.js come le altre dipendenze (pdf.js), non via npm.
   L'URL e la chiave "publishable" sono pubblici per progetto (equivalenti
   alla vecchia "anon key"): sono pensati per stare nel client, le regole
   di accesso vere sono lato server nelle policy RLS di supabase/migrations. */
const SUPABASE_URL = 'https://gaoaipykiavweeeziwnd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0rjznlvnGlerTGCV3QepJQ_t3--sUcv';

/* L'accesso quotidiano usa email+password (niente email inviate a ogni
   accesso). La registrazione invece richiede sempre la conferma via email
   (SMTP dedicato configurato in Supabase, vedi supabase/migrations e le
   note in cloud-account.js): senza email confermata l'account non risulta
   attivo. Anche "password dimenticata" e l'upgrade ospite->permanente
   mandano un link via email, per lo stesso motivo (dimostrare il possesso
   della casella). Sul web il link riporta alla pagina dell'app:
   detectSessionInUrl fa si' che supabase-js completi da solo l'accesso
   leggendo il token dall'URL al ritorno. Nell'app nativa un link https
   aprirebbe pero' il browser di sistema invece di tornare nell'app: li' i
   link usano lo schema personalizzato minimalsystem://auth-callback,
   intercettato dall'app stessa (intent-filter aggiunto in CI, vedi
   .github/scripts/patch_android_manifest.py) e completato a mano qui
   sotto. */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

function isCapacitorNative() {
  return typeof window.Capacitor !== 'undefined';
}
function nativeAppPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null;
}
/* undefined sul web: le funzioni di accesso lasciano allora il comportamento
   di default di Supabase (Site URL, gia' impostato sull'URL reale dell'app). */
const AUTH_REDIRECT_URL = isCapacitorNative() ? 'minimalsystem://auth-callback' : undefined;

/* Sul web il link di conferma registrazione porta "type=signup" nel
   frammento dell'URL con cui la pagina si ricarica: va letto SUBITO, prima
   che supabase-js (detectSessionInUrl) lo elabori e lo ripulisca dalla
   barra indirizzi. Usato da cloud-account.js per distinguere "sono appena
   arrivato da un'email di conferma" da un normale accesso, cosi' da poter
   reindirizzare alla Home solo nel primo caso (vedi onAuthStateChange). */
let pendingSignupConfirmation = /[#&]type=signup\b/.test(window.location.hash);

/* Legge access_token/refresh_token dal frammento (#...) del link di accesso
   e completa la sessione: nell'app nativa il link non fa navigare la
   WebView (che resta sempre sul bundle locale), arriva solo come evento
   appUrlOpen con l'URL intero, quindi il completamento automatico di
   supabase-js legato a window.location (detectSessionInUrl) qui non basta. */
function completeSessionFromDeepLink(url) {
  try {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return;
    const params = new URLSearchParams(url.slice(hashIndex + 1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const type = params.get('type');
    if (!access_token || !refresh_token) return;
    sb.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) { console.warn('Accesso da link non riuscito:', error.message); return; }
      // Link di "password dimenticata": qui setSession non genera da solo
      // l'evento PASSWORD_RECOVERY (a differenza del web con
      // detectSessionInUrl), va segnalato a mano.
      if (type === 'recovery' && typeof notifyPasswordRecovery === 'function') {
        notifyPasswordRecovery();
        return;
      }
      // Conferma registrazione da app nativa: qui setSession non genera da
      // solo un evento dedicato (a differenza del web con
      // detectSessionInUrl + il flag pendingSignupConfirmation), va gestito
      // subito qui in base al "type" del link appena letto.
      if (type === 'signup') {
        if (typeof toast === 'function') toast('Email confermata! Il tuo account è attivo.');
        if (typeof renderCharList === 'function') renderCharList();
        if (typeof showView === 'function') showView('list');
        return;
      }
      if (typeof toast === 'function') toast('Accesso effettuato');
      const accountView = document.getElementById('view-account');
      if (typeof renderAccountArea === 'function' && accountView && !accountView.classList.contains('hidden')) renderAccountArea();
    });
  } catch (e) { console.warn("Errore nel completare l'accesso dal link:", e); }
}

if (isCapacitorNative()) {
  const app = nativeAppPlugin();
  if (app) app.addListener('appUrlOpen', data => completeSessionFromDeepLink(data.url));
}
