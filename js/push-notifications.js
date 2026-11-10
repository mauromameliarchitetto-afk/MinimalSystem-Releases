/* Notifiche push reali della chat di campagna (FC7, FASE FINALE —
   completamento funzionale competitivo). Architettura: Supabase Realtime
   per l'app aperta (qui: banner interno + sottoscrizione app-wide), FCM
   HTTP v1 come trasporto Android in background/chiuso (Edge Function
   supabase/functions/send-chat-push, invocata da un trigger DB — vedi
   supabase/migrations/20260930030000_chat_push_notifications.sql). Il
   client non decide MAI chi riceve una push: registra solo il proprio
   token, legge le proprie preferenze, e — alla ricezione o al tocco —
   verifica di nuovo l'accesso caricando i dati dal backend (il payload
   push non concede da solo alcuna autorizzazione).

   Disponibile solo sull'app Android nativa (@capacitor/push-notifications
   espone window.Capacitor.Plugins.PushNotifications solo lì): sul web
   tutte le funzioni qui restano no-op sicuri, mai un errore per chi usa
   il sito/PWA. */

let pushCurrentToken = null;
let pushListenersWired = false;
let pushGlobalRealtimeChannel = null;

function pushNotificationsPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || null;
}

/* Build con configurazione Firebase reale? (js/push-config.js, fail-closed) */
function pushBuildReady() {
  return typeof PUSH_BUILD_READY !== 'undefined' && PUSH_BUILD_READY === true;
}

/* Token FCM di questo dispositivo, conservato anche fra un avvio e l'altro:
   serve a revocarlo al logout anche se l'evento 'registration' non è
   ancora arrivato in questa sessione dell'app. */
const PUSH_TOKEN_STORAGE_KEY = 'rm_push_token_v1';
function rememberPushToken(value) {
  pushCurrentToken = value || null;
  try {
    if (value) localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, value);
    else localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch (e) { /* storage non disponibile: resta il valore in memoria */ }
}
function knownPushToken() {
  if (pushCurrentToken) return pushCurrentToken;
  try { return localStorage.getItem(PUSH_TOKEN_STORAGE_KEY); } catch (e) { return null; }
}

/* Revoca del token di QUESTO dispositivo per l'account ancora collegato.
   Va chiamata PRIMA di sb.auth.signOut() (vedi signOutCloud,
   js/cloud-account.js): dopo, la chiamata partirebbe senza JWT e verrebbe
   respinta, lasciando il token associato all'account appena uscito — il
   telefono continuerebbe a riceverne le notifiche. Anche se questa revoca
   non riesce (offline), il server non consegna più a un token la cui
   sessione di accesso è stata chiusa (rm_push_recipients,
   20261001030000_push_token_session_binding.sql). */
async function revokePushTokenBeforeSignOut() {
  const token = knownPushToken();
  if (!token) return;
  try {
    await withTimeout(sb.rpc('unregister_push_token', { p_token: token }), 'Revoca notifiche');
  } catch (e) { /* best-effort: il logout non si blocca mai per questo */ }
}

function isNativeAndroidPlatform() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
}

/* ------------------------------------------------- preferenze (server) */

const PUSH_PREFS_DEFAULT = { push_enabled: true, show_preview: false };

async function getPushPrefs() {
  const session = await currentCloudSession();
  if (!session || isGuestUser(session)) return { ...PUSH_PREFS_DEFAULT };
  const { data, error } = await withTimeout(
    sb.from('rm_push_prefs').select('push_enabled, show_preview').eq('user_id', session.user.id).maybeSingle(),
    'Preferenze notifiche'
  );
  if (error) throw error;
  return data || { ...PUSH_PREFS_DEFAULT };
}

async function setPushPrefs(pushEnabled, showPreview) {
  invalidateForegroundNoticeCache();
  const { error } = await withTimeout(
    sb.rpc('set_push_prefs', { p_push_enabled: pushEnabled, p_show_preview: showPreview }),
    'Preferenze notifiche'
  );
  if (error) throw error;
}

async function setChatNotifyPref(campaignId, mode) {
  invalidateForegroundNoticeCache();
  const { error } = await withTimeout(
    sb.rpc('set_chat_notify_pref', { p_campaign_id: campaignId, p_mode: mode }),
    'Preferenze chat'
  );
  if (error) throw error;
}

async function getChatNotifyPrefs() {
  const session = await currentCloudSession();
  if (!session || isGuestUser(session)) return {};
  const { data, error } = await withTimeout(
    sb.from('rm_chat_notify_prefs').select('campaign_id, mode').eq('user_id', session.user.id),
    'Preferenze chat'
  );
  if (error) throw error;
  const byId = {};
  (data || []).forEach(r => { byId[r.campaign_id] = r.mode; });
  return byId;
}

/* --------------------------------------- permesso di SISTEMA (Android) */

// Riflette lo stato reale del permesso Android — un interruttore in app
// non può sostituirlo, solo mostrarlo e proporre di aprirlo (spec
// Impostazioni: "Notifiche consentite/bloccate dal dispositivo").
async function checkPushSystemPermission() {
  const plugin = pushNotificationsPlugin();
  if (!plugin) return 'unsupported';
  if (!pushBuildReady()) return 'not_configured';
  try {
    const res = await plugin.checkPermissions();
    return res.receive; // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
  } catch (e) { return 'unsupported'; }
}

/* --------------------------------------------------- registrazione token */

// Chiamata quando l'utente attiva le notifiche (Impostazioni) o, se già
// attive da preferenza, a ogni avvio dell'app su piattaforma nativa: mai
// automatica al primo avvio assoluto (il permesso di sistema va chiesto
// solo quando l'utente lo decide, non appena apre l'app).
async function enablePushNotifications() {
  if (!isNativeAndroidPlatform()) throw userMessage('Le notifiche push sono disponibili solo nell\'app Android.');
  if (!pushBuildReady()) throw userMessage('Questa versione dell\'app è stata costruita senza la configurazione delle notifiche push: non possono essere attivate.');
  const plugin = pushNotificationsPlugin();
  // Mai "riprova": un APK costruito prima di @capacitor/push-notifications
  // non acquisisce il modulo con un aggiornamento OTA (solo file web) —
  // l'unica via d'uscita è installare un APK più recente.
  if (!plugin) throw userMessage('Questa versione installata dell\'app non contiene il modulo delle notifiche push: installa l\'APK più recente per riceverle.');
  wirePushListeners();
  await ensurePushChannel();
  const perm = await plugin.checkPermissions();
  let receive = perm.receive;
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    const req = await plugin.requestPermissions();
    receive = req.receive;
  }
  if (receive !== 'granted') {
    throw userMessage('Permesso di sistema negato: attivalo dalle impostazioni Android per ricevere le notifiche.');
  }
  await plugin.register();
  await setPushPrefs(true, (await getPushPrefs()).show_preview);
}

async function disablePushNotifications() {
  const prefs = await getPushPrefs();
  await setPushPrefs(false, prefs.show_preview);
  const token = knownPushToken();
  if (token) {
    try { await withTimeout(sb.rpc('unregister_push_token', { p_token: token }), 'Disattivazione notifiche'); }
    catch (e) { /* la preferenza è comunque salvata: un fallimento qui non deve bloccare l'utente */ }
  }
}

async function ensurePushChannel() {
  const plugin = pushNotificationsPlugin();
  if (!plugin || typeof plugin.createChannel !== 'function') return;
  try {
    await plugin.createChannel({
      id: 'chat',
      name: 'Chat di campagna',
      description: 'Nuovi messaggi nelle chat delle tue storie',
      importance: 4, // IMPORTANCE_HIGH: pop-up heads-up, coerente con "avviso immediato" (spec)
      visibility: 1,
    });
  } catch (e) { /* piattaforma senza supporto ai canali (Android < 8): innocuo */ }
}

function wirePushListeners() {
  const plugin = pushNotificationsPlugin();
  if (!plugin || pushListenersWired) return;
  pushListenersWired = true;

  plugin.addListener('registration', token => {
    rememberPushToken(token.value);
    (async () => {
      try {
        const session = await currentCloudSession();
        if (!session || isGuestUser(session)) return; // un ospite non ha un account da associare al token
        await withTimeout(sb.rpc('register_push_token', { p_token: token.value, p_platform: 'android' }), 'Registrazione notifiche');
      } catch (e) { /* un fallimento di registrazione non deve mai bloccare l'app */ }
    })();
  });

  plugin.addListener('registrationError', err => {
    console.warn('Registrazione notifiche push fallita:', err && err.error);
  });

  // App in primo piano quando arriva la push: FCM non mostra da solo un
  // pop-up di sistema per un messaggio "data" mentre l'app è attiva —
  // qui si sostituisce con il banner interno (stesso comportamento
  // richiesto per "sta giocando o navigando in un'altra schermata").
  plugin.addListener('pushNotificationReceived', notification => {
    handleForegroundChatPush(notification.data || notification.notification?.data || {});
  });

  // Tocco sulla notifica di sistema (app in background/chiusa): apre la
  // conversazione giusta. Il payload dà solo gli id — la vista aperta
  // ricarica comunque tutto dal backend con le RLS reali, il payload da
  // solo non concede alcuna autorizzazione.
  plugin.addListener('pushNotificationActionPerformed', action => {
    const data = (action.notification && (action.notification.data || action.notification.notification?.data)) || {};
    openChatFromPushData(data);
  });
}

function openChatFromPushData(data) {
  if (!data || data.type !== 'chat_message' || !data.campaign_id) return;
  hideChatPushBanner();
  if (typeof openCampaignChatModal === 'function') openCampaignChatModal(data.campaign_id);
}

/* --------------------------------------------------------- banner in-app */

let chatPushBannerData = null;

function handleForegroundChatPush(data) {
  if (!data || data.type !== 'chat_message' || !data.campaign_id) return;
  // La conversazione/il canale esatti sono già aperti: onChatRealtimeChange
  // (js/cloud-chat.js, già sottoscritto al modale) aggiorna da solo la
  // lista — un banner qui sarebbe un avviso duplicato per la stessa cosa.
  if (typeof chatModalCampaignId !== 'undefined' && chatModalCampaignId === data.campaign_id
      && typeof chatActiveChannel !== 'undefined' && chatActiveChannel === data.channel) {
    return;
  }
  showChatPushBanner(data);
}

async function showChatPushBanner(data) {
  chatPushBannerData = data;
  const titleEl = $('#chat-push-banner-title');
  const bodyEl = $('#chat-push-banner-body');
  if (!titleEl || !bodyEl) return;
  let campaignName = 'una storia';
  try {
    const { data: campaign } = await sb.from('campaigns').select('name').eq('id', data.campaign_id).maybeSingle();
    if (campaign && campaign.name) campaignName = campaign.name;
  } catch (e) { /* nome non essenziale per aprire la conversazione */ }
  if (chatPushBannerData !== data) return; // un banner più recente ha già sostituito questo
  titleEl.textContent = 'Nuovo messaggio · ' + campaignName;
  bodyEl.textContent = data.preview || 'Tocca per aprire la conversazione';
  $('#chat-push-banner').classList.remove('hidden');
  requestAnimationFrame(() => $('#chat-push-banner').classList.add('show'));
}

function hideChatPushBanner() {
  chatPushBannerData = null;
  const el = $('#chat-push-banner');
  if (!el) return;
  el.classList.remove('show');
  setTimeout(() => el.classList.add('hidden'), 260);
}

function wireChatPushBanner() {
  const openBtn = $('#chat-push-banner-open');
  const dismissBtn = $('#chat-push-banner-dismiss');
  if (openBtn) openBtn.addEventListener('click', () => {
    const data = chatPushBannerData;
    hideChatPushBanner();
    if (data && typeof openCampaignChatModal === 'function') openCampaignChatModal(data.campaign_id);
  });
  if (dismissBtn) dismissBtn.addEventListener('click', () => hideChatPushBanner());
}

/* ------------------------- permesso di sistema mancante: avviso reale */

/* Il fallimento è altrimenti COMPLETAMENTE silenzioso, verificato su un
   dispositivo reale: con il permesso Android negato plugin.register()
   riesce lo stesso e restituisce un token valido, l'Edge Function lo trova
   in rm_push_tokens, FCM accetta l'invio e risponde 200 (la consegna
   risulta "sent" nel log), e il sistema operativo scarta la notifica senza
   mostrarla. Nessun errore emerge in nessun punto della catena, mentre la
   preferenza in app continua a dire "notifiche attive": l'unico modo per
   accorgersene era guardare lo schermo e non vedere nulla. Le Impostazioni
   mostravano già lo stato vero del permesso, ma solo per chi apriva quella
   sezione — qui l'avviso arriva da sé, dove l'utente si trova. */

let pushPermissionBannerWired = false;

function pushPermissionNoticeText(perm) {
  return perm === 'denied'
    ? 'Il telefono sta scartando le notifiche di questa app: Impostazioni del telefono → App → Role Makers System → Notifiche → Consenti.'
    : 'Il permesso di notifica non è ancora stato concesso: tocca qui per attivarlo.';
}

// Un avviso puramente visivo non passa da afterIntroFinished: quella coda è
// a esclusione (reload/OTA, una sola azione vincente), e infilarci un
// banner significherebbe cancellare un aggiornamento già in attesa.
function whenIntroFinished(fn) {
  if (!document.getElementById('intro-layer')) { fn(); return; }
  window.addEventListener('rm-intro-finished', fn, { once: true });
}

function showPushPermissionWarning(perm) {
  const el = $('#push-permission-banner');
  const body = $('#push-permission-banner-body');
  if (!el || !body) return;
  body.textContent = pushPermissionNoticeText(perm);
  el.classList.remove('hidden');
  requestAnimationFrame(() => el.classList.add('show'));
}

function hidePushPermissionWarning() {
  const el = $('#push-permission-banner');
  if (!el) return;
  el.classList.remove('show');
  setTimeout(() => el.classList.add('hidden'), 260);
}

async function handlePushPermissionBannerAction() {
  try {
    await enablePushNotifications();
    hidePushPermissionWarning();
    if (typeof toast === 'function') toast('Notifiche attivate.');
  } catch (e) {
    // Permesso già negato in modo permanente: Android non ripropone più il
    // prompt di sistema, l'unica via resta il percorso manuale — che il
    // messaggio d'errore (userMessage, mai mascherato) indica per esteso.
    if (typeof toast === 'function') toast(typeof describeError === 'function' ? describeError(e) : 'Attivazione non riuscita');
  }
}

function wirePushPermissionBanner() {
  if (pushPermissionBannerWired) return;
  pushPermissionBannerWired = true;
  const action = $('#push-permission-banner-action');
  const dismiss = $('#push-permission-banner-dismiss');
  if (action) action.addEventListener('click', () => handlePushPermissionBannerAction());
  if (dismiss) dismiss.addEventListener('click', () => hidePushPermissionWarning());
}

/* ---------------------------------- sottoscrizione realtime app-wide */

// A differenza di subscribeChatRealtime (js/cloud-chat.js, aperta solo
// mentre il modale di UNA campagna è visibile), questa resta attiva per
// tutta la sessione collegata: nessun filtro campaign_id, la visibilità
// reale delle righe resta comunque quella della RLS di rm_chat_messages
// (solo i membri della campagna vedono i suoi messaggi) — qui si copre il
// gap esplicitamente lasciato aperto in FC6 ("nessun canale realtime
// persistente app-wide"), mostrando il banner anche quando l'utente è su
// un'altra vista qualsiasi dell'app, non solo su un altro canale della
// stessa chat già aperta.
function startGlobalChatRealtimeWatch(myUserId) {
  stopGlobalChatRealtimeWatch();
  pushGlobalRealtimeChannel = sb.channel('chat-push-watch-' + myUserId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rm_chat_messages' }, payload => {
      const row = payload.new;
      if (!row || row.author_user_id === myUserId || row.removed_reason) return;
      foregroundChatNoticeAllowed(row, myUserId).then(res => {
        if (!res.show) return;
        handleForegroundChatPush({
          type: 'chat_message',
          campaign_id: row.campaign_id,
          channel: row.channel,
          message_id: row.id,
          preview: res.preview ? (row.body || '').slice(0, 120) : '',
        });
      });
    })
    .subscribe();
}
/* Stesse regole della push (rm_push_recipients lato server) anche per il
   banner in-app: nessun avviso da un utente bloccato, nessuno per una
   storia silenziata, "solo menzioni" rispettato, testo solo con l'anteprima
   attiva. Preferenze e blocchi letti dal backend e tenuti per 60 secondi.
   Nel dubbio (errore di rete) si mostra l'avviso SENZA testo: meglio un
   "Nuovo messaggio" generico che un contenuto contro le preferenze. */
let foregroundNoticeCache = null;
async function loadForegroundNoticeContext(myUserId) {
  if (foregroundNoticeCache && foregroundNoticeCache.userId === myUserId && Date.now() - foregroundNoticeCache.at < 60000) {
    return foregroundNoticeCache;
  }
  const [prefs, chatPrefs, blocks, names] = await Promise.all([
    getPushPrefs(),
    getChatNotifyPrefs(),
    typeof listMyBlocks === 'function' ? listMyBlocks() : Promise.resolve([]),
    typeof fetchDisplayNames === 'function' ? fetchDisplayNames([myUserId]).catch(() => ({})) : Promise.resolve({}),
  ]);
  foregroundNoticeCache = {
    userId: myUserId, at: Date.now(), prefs, chatPrefs,
    blocked: new Set((blocks || []).map(b => b.id)),
    myName: ((names || {})[myUserId] || '').trim(),
  };
  return foregroundNoticeCache;
}
function invalidateForegroundNoticeCache() { foregroundNoticeCache = null; }
async function foregroundChatNoticeAllowed(row, myUserId) {
  let ctx;
  try { ctx = await loadForegroundNoticeContext(myUserId); }
  catch (e) { return { show: true, preview: false }; }
  if (ctx.blocked.has(row.author_user_id)) return { show: false };
  const mode = ctx.chatPrefs[row.campaign_id] || 'all';
  if (mode === 'muted') return { show: false };
  if (mode === 'mentions') {
    if (!ctx.myName || !(row.body || '').toLowerCase().includes('@' + ctx.myName.toLowerCase())) return { show: false };
  }
  return { show: true, preview: ctx.prefs.show_preview === true };
}

function stopGlobalChatRealtimeWatch() {
  if (!pushGlobalRealtimeChannel) return;
  sb.removeChannel(pushGlobalRealtimeChannel);
  pushGlobalRealtimeChannel = null;
}

/* ------------------------------------------------------- ciclo di vita */

// Login (o ripristino sessione a un utente reale, non ospite): riattiva
// il banner app-wide e, se la preferenza è già attiva, ri-registra il
// token per questo dispositivo (un token non sopravvive da solo a un
// cambio di account sullo stesso device). Logout/cambio utente: ferma
// tutto e revoca il token per l'identità che sta per lasciare la sessione
// — un device condiviso non deve continuare a ricevere push per un
// account non più collegato lì.
async function handlePushSessionChange(newSession) {
  stopGlobalChatRealtimeWatch();
  invalidateForegroundNoticeCache();
  // La revoca per l'account USCENTE avviene in signOutCloud, prima del
  // logout (qui la sessione è già quella nuova, o nessuna). Per un cambio
  // account la nuova registrazione sotto riassegna comunque il token.
  if (!newSession || isGuestUser(newSession)) return;
  startGlobalChatRealtimeWatch(newSession.user.id);
  if (!isNativeAndroidPlatform() || !pushBuildReady()) return;
  try {
    const prefs = await getPushPrefs();
    if (prefs.push_enabled) {
      wirePushListeners();
      await ensurePushChannel();
      const perm = await checkPushSystemPermission();
      if (perm === 'granted') {
        const plugin = pushNotificationsPlugin();
        if (plugin) await plugin.register();
        hidePushPermissionWarning(); // permesso ridato dopo un avviso precedente
      } else if (perm !== 'unsupported') {
        // La preferenza dice "attive" ma il sistema le sta scartando: mai
        // restare in silenzio. 'unsupported' è escluso di proposito — lì
        // manca il modulo nativo (APK più vecchio del plugin), non c'è
        // nulla che l'utente possa fare da questa vista, e il banner
        // "Nuova versione disponibile" copre già quel caso.
        whenIntroFinished(() => showPushPermissionWarning(perm));
      }
    }
  } catch (e) { /* la sessione resta valida anche se la registrazione push fallisce */ }
}
