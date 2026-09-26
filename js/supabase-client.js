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
   link usano lo schema personalizzato rolemakers://auth-callback,
   intercettato dall'app stessa (intent-filter aggiunto in CI, vedi
   .github/scripts/patch_android_manifest.py) e completato a mano qui
   sotto. Rinominato da minimalsystem:// (Piano Unificato di Completamento,
   U0 — allineamento identita' nativa al dominio rolemakers.it): la vecchia
   redirect URI va tolta e la nuova aggiunta nella console OAuth
   (Google/Apple) e nelle impostazioni Auth di Supabase. */
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
/* Browser di sistema (Chrome Custom Tabs su Android, SFSafariViewController
   su iOS quando esisterà quel progetto): usato SOLO per il login Google
   (vedi signInWithProvider, js/cloud-account.js) — Google blocca l'OAuth
   dentro una WebView embedded rilevandola dallo user-agent (policy
   ufficiale, vedi fonti nel piano di pubblicazione store), quindi il flusso
   non può più far navigare la WebView dell'app come faceva prima. */
function browserPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) || null;
}

/* ---------------------------------------------------------------------------
   Callback di autenticazione (audit Play Store, punti 5 e 8).

   Due forme di ritorno nell'app nativa, gestite dallo stesso codice:
   - schema personalizzato rolemakers://auth-callback (attuale, compatibile
     con le build e le email già in circolazione);
   - Android App Link HTTPS verificato https://rolemakers.it/auth/callback
     (intent-filter android:autoVerify="true" aggiunto da
     .github/scripts/patch_android_manifest.py, /.well-known/assetlinks.json
     pubblicato con il sito). A differenza dello schema personalizzato,
     Android lo consegna SOLO al pacchetto firmato con il certificato
     dichiarato: nessun'altra app può intercettarlo.

   AUTH_REDIRECT_MODE decide quale indirizzo l'app CHIEDE a Supabase come
   ritorno. Resta 'custom_scheme' finché i passaggi esterni non sono fatti
   (redirect allowlist di Supabase, dominio verificato sul dispositivo):
   passare a 'app_link' prima farebbe ricadere Supabase sul Site URL (il
   sito web) invece di tornare nell'app. Procedura:
   docs/play-readiness/AUTH_DEEP_LINKS.md. Lo schema personalizzato potrà
   essere tolto dal Manifest solo quando nessuna build installata lo chiede
   più come redirect e i link email già inviati con quello schema sono
   scaduti. */
const AUTH_REDIRECT_MODE = 'custom_scheme';
const AUTH_CUSTOM_SCHEME_CALLBACK = 'rolemakers://auth-callback';
const AUTH_APP_LINK_CALLBACK = 'https://rolemakers.it/auth/callback';

/* undefined sul web: le funzioni di accesso lasciano allora il comportamento
   di default di Supabase (Site URL, gia' impostato sull'URL reale dell'app). */
const AUTH_REDIRECT_URL = isCapacitorNative()
  ? (AUTH_REDIRECT_MODE === 'app_link' ? AUTH_APP_LINK_CALLBACK : AUTH_CUSTOM_SCHEME_CALLBACK)
  : undefined;

/* Sul web il link di conferma registrazione porta "type=signup" nel
   frammento dell'URL con cui la pagina si ricarica: va letto SUBITO, prima
   che supabase-js (detectSessionInUrl) lo elabori e lo ripulisca dalla
   barra indirizzi. Usato da cloud-account.js per distinguere "sono appena
   arrivato da un'email di conferma" da un normale accesso, cosi' da poter
   reindirizzare alla Home solo nel primo caso (vedi onAuthStateChange). */
let pendingSignupConfirmation = /[#&]type=signup\b/.test(window.location.hash);

/* Client dedicato SOLO all'OAuth (Google), con flusso PKCE: il ritorno
   porta un codice monouso (?code=...), inutile senza il code_verifier che
   resta nello storage di questo dispositivo — anche se un'altra app
   intercettasse il redirect non otterrebbe la sessione. Il client
   principale `sb` resta sul flusso implicito per i link email (conferma
   registrazione), il cui formato quindi non cambia. Dopo lo scambio del
   codice la sessione passa a `sb` con setSession e lo storage di questo
   client viene ripulito. */
const OAUTH_PKCE_STORAGE_KEY = 'rm-oauth-pkce';
let oauthPkceClient = null;
function getOAuthPkceClient() {
  if (!oauthPkceClient) {
    oauthPkceClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: 'pkce',
        storageKey: OAUTH_PKCE_STORAGE_KEY,
        persistSession: true,      // il code_verifier deve sopravvivere a un avvio a freddo
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return oauthPkceClient;
}
function clearOAuthPkceStorage() {
  try {
    Object.keys(localStorage).filter(k => k.indexOf(OAUTH_PKCE_STORAGE_KEY) === 0).forEach(k => localStorage.removeItem(k));
  } catch (e) { /* storage non disponibile: nulla da ripulire */ }
}
function hasOAuthPkceVerifier() {
  try { return !!localStorage.getItem(OAUTH_PKCE_STORAGE_KEY + '-code-verifier'); } catch (e) { return false; }
}

/* Riconosce SOLO i due indirizzi di ritorno ammessi; tutto il resto
   (altri schemi, altri host, percorsi diversi, URL malformati) viene
   ignorato senza alcuna azione. Restituisce { kind, ... }:
     'tokens' → access_token + refresh_token nel frammento (link email,
                flusso implicito)
     'code'   → ?code= del flusso PKCE (OAuth)
     'error'  → error / error_description (login annullato o rifiutato,
                redirect non consentito)
     'ignored'→ nessuna azione (reason spiega perché) */
function parseAuthCallbackUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { return { kind: 'ignored', reason: 'malformed' }; }
  const isCustom = u.protocol === 'rolemakers:' && (u.host === 'auth-callback' || u.pathname.replace(/^\/+/, '') === 'auth-callback');
  const isAppLink = u.protocol === 'https:' && u.host === 'rolemakers.it' && /^\/auth\/callback\/?$/.test(u.pathname);
  if (!isCustom && !isAppLink) return { kind: 'ignored', reason: 'not_allowed' };
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const query = u.searchParams;
  const pick = k => query.get(k) || hash.get(k) || null;
  const error = pick('error');
  if (error || pick('error_code') || pick('error_description')) {
    const description = String(pick('error_description') || error || pick('error_code') || '').slice(0, 200);
    return { kind: 'error', error: String(error || pick('error_code') || ''), description };
  }
  const code = query.get('code');
  if (code) {
    if (!/^[A-Za-z0-9._~-]{8,512}$/.test(code)) return { kind: 'ignored', reason: 'bad_code' };
    return { kind: 'code', code };
  }
  const access_token = hash.get('access_token');
  const refresh_token = hash.get('refresh_token');
  if (access_token && refresh_token) return { kind: 'tokens', access_token, refresh_token, type: hash.get('type') };
  return { kind: 'ignored', reason: 'missing_params' };
}

/* Callback già elaborati in questa installazione (avvio a freddo: lo stesso
   URL può arrivare sia da getLaunchUrl() sia da appUrlOpen; doppio tocco
   sul link): un codice PKCE è monouso e un secondo scambio fallirebbe con
   un errore fuorviante. Si conserva solo un'impronta breve, mai il segreto. */
const AUTH_CALLBACK_SEEN_KEY = 'rm_auth_callbacks_seen_v1';
function authCallbackFingerprint(parsed) {
  const raw = parsed.kind === 'code' ? 'c:' + parsed.code : parsed.kind === 'tokens' ? 't:' + parsed.refresh_token : '';
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
  return parsed.kind + ':' + raw.length + ':' + (h >>> 0).toString(36);
}
function authCallbackAlreadySeen(fp) {
  try {
    const seen = JSON.parse(sessionStorage.getItem(AUTH_CALLBACK_SEEN_KEY) || '[]');
    if (seen.indexOf(fp) !== -1) return true;
    seen.push(fp);
    sessionStorage.setItem(AUTH_CALLBACK_SEEN_KEY, JSON.stringify(seen.slice(-20)));
  } catch (e) { /* senza storage: nessuna deduplica persistente */ }
  return false;
}

let oauthInFlight = false;
function authNotice(text) { if (typeof toast === 'function') toast(text); }

/* Connessione assente: il browser di sistema non va nemmeno aperto (Google
   mostrerebbe solo la pagina di errore di rete) e lo scambio del codice
   fallito per rete non va spacciato per "codice scaduto". */
const OAUTH_OFFLINE_MESSAGE = 'Nessuna connessione: l\'accesso con Google richiede internet. Riprova quando sei online.';
function isDeviceOffline() {
  try { return typeof navigator !== 'undefined' && navigator.onLine === false; } catch (e) { return false; }
}
function isNetworkAuthError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  const msg = String(err.message || '');
  return name === 'AuthRetryableFetchError' || err.status === 0 || /Failed to fetch|NetworkError|Load failed|network/i.test(msg);
}
function oauthOfflineError() {
  const e = new Error(OAUTH_OFFLINE_MESSAGE);
  e.code = 'OAUTH_OFFLINE';
  return e;
}

/* Collegamento di Google a un account ESISTENTE (migrazione graduale dagli
   account email/password, vedi docs/play-readiness/AUTH_DEEP_LINKS.md):
   il ritorno arriva allo stesso callback, con i token della sessione
   dell'account già in uso. Il flag serve solo a scegliere il messaggio. */
const OAUTH_LINK_PENDING_KEY = 'rm_oauth_link_pending_v1';
function setOAuthLinkPending(on) {
  try { if (on) localStorage.setItem(OAUTH_LINK_PENDING_KEY, String(Date.now())); else localStorage.removeItem(OAUTH_LINK_PENDING_KEY); } catch (e) { /* storage non disponibile */ }
}
function takeOAuthLinkPending() {
  let at = 0;
  try { at = Number(localStorage.getItem(OAUTH_LINK_PENDING_KEY)) || 0; localStorage.removeItem(OAUTH_LINK_PENDING_KEY); } catch (e) { /* storage non disponibile */ }
  return at > 0 && Date.now() - at < 15 * 60 * 1000;
}

/* Account appena CREATO da un accesso Google (nessuna identità email,
   creato ora): se la persona aveva già un account con un'altra e-mail,
   Supabase non può saperlo e ne ha aperto uno nuovo. Lo si dice subito,
   con la strada per rimediare, invece di lasciarle scoprire più tardi
   personaggi e storie "spariti". */
function isFreshGoogleOnlyUser(user) {
  if (!user) return false;
  const ids = Array.isArray(user.identities) ? user.identities.map(i => i && i.provider) : [];
  if (!ids.length || ids.some(p => p !== 'google')) return false;
  const created = Date.parse(user.created_at || '');
  return Number.isFinite(created) && Date.now() - created < 10 * 60 * 1000;
}
const GOOGLE_NEW_ACCOUNT_NOTICE = 'Nuovo account creato con Google. Se avevi già un account Role Makers con un\'altra e-mail, esci, accedi con e-mail e password e collega Google dalla pagina Account.';

async function applySessionFromCallback(access_token, refresh_token, type) {
  const { error } = await sb.auth.setSession({ access_token, refresh_token });
  if (error) { console.warn('Accesso da link non riuscito:', error.message); authNotice('Accesso non riuscito: il link è scaduto o già usato.'); return false; }
  // Link di "password dimenticata": qui setSession non genera da solo
  // l'evento PASSWORD_RECOVERY (a differenza del web con
  // detectSessionInUrl), va segnalato a mano.
  if (type === 'recovery' && typeof notifyPasswordRecovery === 'function') { notifyPasswordRecovery(); return true; }
  // Conferma registrazione da app nativa: qui setSession non genera da
  // solo un evento dedicato (a differenza del web con
  // detectSessionInUrl + il flag pendingSignupConfirmation), va gestito
  // subito qui in base al "type" del link appena letto.
  if (type === 'signup') {
    authNotice('Email confermata! Il tuo account è attivo.');
    if (typeof renderCharList === 'function') renderCharList();
    if (typeof showView === 'function') showView('list');
    return true;
  }
  if (takeOAuthLinkPending()) authNotice('Account Google collegato: da ora puoi accedere anche con Google.');
  else authNotice('Accesso effettuato');
  const accountView = document.getElementById('view-account');
  if (typeof renderAccountArea === 'function' && accountView && !accountView.classList.contains('hidden')) renderAccountArea();
  return true;
}

/* Scambio del codice PKCE: possibile solo sul dispositivo che ha avviato
   il login (il code_verifier non lascia mai lo storage locale). */
async function exchangeOAuthCode(code) {
  if (!hasOAuthPkceVerifier()) {
    authNotice('Accesso non completato: riavvia l\'accesso con Google da questa app.');
    return false;
  }
  if (isDeviceOffline()) { authNotice(OAUTH_OFFLINE_MESSAGE); clearOAuthPkceStorage(); return false; }
  try {
    let data, error;
    try {
      ({ data, error } = await getOAuthPkceClient().auth.exchangeCodeForSession(code));
    } catch (e) { error = e; }
    if (error && isNetworkAuthError(error)) { authNotice(OAUTH_OFFLINE_MESSAGE); return false; }
    if (error || !data || !data.session) {
      authNotice('Accesso con Google non riuscito: il codice è scaduto o già usato. Riprova.');
      return false;
    }
    const ok = await applySessionFromCallback(data.session.access_token, data.session.refresh_token, null);
    if (ok && isFreshGoogleOnlyUser(data.session.user || data.user)) authNotice(GOOGLE_NEW_ACCOUNT_NOTICE);
    return ok;
  } finally {
    clearOAuthPkceStorage();
  }
}

/* Punto d'ingresso unico per ogni URL di ritorno (appUrlOpen, avvio a
   freddo, test). Restituisce l'esito del parse, per diagnosi e test. */
async function handleAuthCallbackUrl(url) {
  const parsed = parseAuthCallbackUrl(url);
  if (parsed.kind === 'ignored') return parsed;
  // Il browser di sistema aperto per il login va richiuso appena si torna
  // nell'app: innocuo se non è aperto (Browser.close() non fa nulla).
  const browser = browserPlugin();
  if (browser && typeof browser.close === 'function') browser.close().catch(() => {});
  oauthInFlight = false;
  if (parsed.kind === 'error') {
    clearOAuthPkceStorage();
    const wasLink = takeOAuthLinkPending();
    if (wasLink && /identity_already_exists|already.*linked/i.test(parsed.error + ' ' + parsed.description)) {
      authNotice('Questo account Google è già collegato a un altro account Role Makers: non è stato collegato.');
      return parsed;
    }
    const cancelled = /access_denied|cancel/i.test(parsed.error + ' ' + parsed.description);
    authNotice(cancelled ? 'Accesso annullato.' : 'Accesso non completato: ' + (parsed.description || 'errore del provider') + '.');
    return parsed;
  }
  if (authCallbackAlreadySeen(authCallbackFingerprint(parsed))) return { kind: 'ignored', reason: 'duplicate' };
  try {
    if (parsed.kind === 'code') await exchangeOAuthCode(parsed.code);
    else await applySessionFromCallback(parsed.access_token, parsed.refresh_token, parsed.type);
  } catch (e) { console.warn('Errore nel completare l\'accesso dal link:', e); authNotice('Accesso non completato: riprova.'); }
  return parsed;
}

/* Compatibilità: nome storico usato altrove e nei test. */
function completeSessionFromDeepLink(url) { return handleAuthCallbackUrl(url); }

/* Avvio del login OAuth con PKCE. Sull'app nativa: solo l'URL
   (skipBrowserRedirect) aperto nel browser di sistema, mai la WebView. Sul
   web: redirect normale della pagina, ritorno gestito da
   completeWebOAuthCallbackIfAny() al caricamento. */
async function startOAuthSignIn(provider) {
  clearOAuthPkceStorage();
  setOAuthLinkPending(false);
  if (isDeviceOffline()) throw oauthOfflineError();
  const client = getOAuthPkceClient();
  const options = {};
  if (AUTH_REDIRECT_URL) options.redirectTo = AUTH_REDIRECT_URL;
  if (isCapacitorNative()) {
    options.skipBrowserRedirect = true;
    const { data, error } = await client.auth.signInWithOAuth({ provider, options });
    if (error) throw error;
    const browser = browserPlugin();
    if (!browser || !data || !data.url) throw new Error('Browser di sistema non disponibile per il login');
    oauthInFlight = true;
    await browser.open({ url: data.url });
    return;
  }
  const { error } = await client.auth.signInWithOAuth({ provider, options });
  if (error) throw error;
}

/* Collegamento di Google all'account con cui si è GIÀ entrati (email e
   password): usa il client principale `sb`, che ha la sessione. Richiede
   "Manual linking" attivo su Supabase; se non lo è l'errore
   (manual_linking_disabled) arriva subito, prima di aprire il browser.
   L'accesso con e-mail e password resta valido anche dopo. */
async function startOAuthLink(provider) {
  if (isDeviceOffline()) throw oauthOfflineError();
  const options = { skipBrowserRedirect: true };
  if (AUTH_REDIRECT_URL) options.redirectTo = AUTH_REDIRECT_URL;
  const { data, error } = await sb.auth.linkIdentity({ provider, options });
  if (error) {
    if (/manual_linking_disabled|manual linking/i.test(String(error.code || '') + ' ' + String(error.message || ''))) {
      const e = new Error('Il collegamento di un account Google non è ancora disponibile.');
      e.code = 'OAUTH_LINK_DISABLED';
      throw e;
    }
    if (isNetworkAuthError(error)) throw oauthOfflineError();
    throw error;
  }
  if (!data || !data.url) throw new Error('Collegamento con Google non disponibile.');
  setOAuthLinkPending(true);
  if (isCapacitorNative()) {
    const browser = browserPlugin();
    if (!browser) { setOAuthLinkPending(false); throw new Error('Browser di sistema non disponibile per il collegamento'); }
    oauthInFlight = true;
    await browser.open({ url: data.url });
    return;
  }
  window.location.assign(data.url);
}

/* Web: ritorno da Google con ?code= sulla pagina dell'app. Scambio solo se
   il code_verifier è in questo browser; l'URL viene ripulito in ogni caso,
   così il codice non resta nella cronologia né in un link condiviso. */
async function completeWebOAuthCallbackIfAny() {
  if (isCapacitorNative()) return null;
  // Ritorno da un collegamento (linkIdentity, flusso implicito del client
  // principale): token o errore nel frammento, che supabase-js elabora da
  // solo; qui si sceglie soltanto il messaggio giusto.
  const hash = String(window.location.hash || '');
  if (/[#&](access_token|error)=/.test(hash) && takeOAuthLinkPending()) {
    if (/identity_already_exists|already(%20|\+|\s)*linked/i.test(hash)) authNotice('Questo account Google è già collegato a un altro account Role Makers: non è stato collegato.');
    else if (/[#&]error=/.test(hash)) authNotice('Collegamento con Google non completato.');
    else authNotice('Account Google collegato: da ora puoi accedere anche con Google.');
    return 'link';
  }
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return null; }
  const code = params.get('code');
  const error = params.get('error') || params.get('error_description');
  if (!code && !error) return null;
  try {
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState(null, '', clean);
  } catch (e) { /* history non disponibile: nulla da ripulire */ }
  if (error) { clearOAuthPkceStorage(); authNotice('Accesso non completato.'); return 'error'; }
  if (!/^[A-Za-z0-9._~-]{8,512}$/.test(code)) return 'ignored';
  await exchangeOAuthCode(code);
  return 'code';
}

if (isCapacitorNative()) {
  const app = nativeAppPlugin();
  if (app) {
    app.addListener('appUrlOpen', data => { handleAuthCallbackUrl(data && data.url); });
    // Avvio a freddo: se l'app è stata aperta DAL link (era chiusa),
    // appUrlOpen potrebbe essere già passato prima di questo listener.
    if (typeof app.getLaunchUrl === 'function') {
      app.getLaunchUrl().then(res => { if (res && res.url) handleAuthCallbackUrl(res.url); }).catch(() => {});
    }
  }
  // Custom Tab chiusa dall'utente senza completare il login: nessun
  // callback arriverà mai, lo si dice invece di lasciare l'interfaccia in
  // attesa. Il piccolo ritardo lascia passare un eventuale appUrlOpen.
  const browser = browserPlugin();
  if (browser && typeof browser.addListener === 'function') {
    browser.addListener('browserFinished', () => {
      if (!oauthInFlight) return;
      setTimeout(() => {
        if (!oauthInFlight) return;
        oauthInFlight = false;
        setOAuthLinkPending(false);
        authNotice('Accesso con Google annullato.');
      }, 800);
    });
  }
} else {
  completeWebOAuthCallbackIfAny();
}
