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
  const { error } = await withTimeout(
    sb.rpc('set_push_prefs', { p_push_enabled: pushEnabled, p_show_preview: showPreview }),
    'Preferenze notifiche'
  );
  if (error) throw error;
}

async function setChatNotifyPref(campaignId, mode) {
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
  if (!isNativeAndroidPlatform()) throw new Error('Le notifiche push sono disponibili solo nell\'app Android.');
  const plugin = pushNotificationsPlugin();
  if (!plugin) throw new Error('Plugin notifiche non disponibile in questa build.');
  wirePushListeners();
  await ensurePushChannel();
  const perm = await plugin.checkPermissions();
  let receive = perm.receive;
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    const req = await plugin.requestPermissions();
    receive = req.receive;
  }
  if (receive !== 'granted') {
    throw new Error('Permesso di sistema negato: attivalo dalle impostazioni Android per ricevere le notifiche.');
  }
  await plugin.register();
  await setPushPrefs(true, (await getPushPrefs()).show_preview);
}

async function disablePushNotifications() {
  const prefs = await getPushPrefs();
  await setPushPrefs(false, prefs.show_preview);
  if (pushCurrentToken) {
    try { await withTimeout(sb.rpc('unregister_push_token', { p_token: pushCurrentToken }), 'Disattivazione notifiche'); }
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
    pushCurrentToken = token.value;
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
      handleForegroundChatPush({
        type: 'chat_message',
        campaign_id: row.campaign_id,
        channel: row.channel,
        message_id: row.id,
        preview: (row.body || '').slice(0, 120),
      });
    })
    .subscribe();
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
  if (pushCurrentToken) {
    try { await withTimeout(sb.rpc('unregister_push_token', { p_token: pushCurrentToken }), 'Revoca notifiche'); }
    catch (e) { /* best-effort: non deve bloccare login/logout */ }
  }
  if (!newSession || isGuestUser(newSession)) return;
  startGlobalChatRealtimeWatch(newSession.user.id);
  if (!isNativeAndroidPlatform()) return;
  try {
    const prefs = await getPushPrefs();
    if (prefs.push_enabled) {
      wirePushListeners();
      await ensurePushChannel();
      const perm = await checkPushSystemPermission();
      if (perm === 'granted') {
        const plugin = pushNotificationsPlugin();
        if (plugin) await plugin.register();
      }
    }
  } catch (e) { /* la sessione resta valida anche se la registrazione push fallisce */ }
}
