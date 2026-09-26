/* ==========================================================================
   Role Makers — Contatti e conversazioni private (chat_revision_v1,
   checkpoint C2 "conversazioni"). Dati REALI via Supabase
   (rm_contacts/rm_direct_conversations/rm_direct_messages/
   rm_direct_read_state, supabase/migrations/20260930100000_contacts_and_direct_chat.sql
   — mai applicata al database live senza approvazione esplicita, testata
   solo su Postgres locale, vedi tests/server/run-contacts-direct-chat-tests.js).

   Riusa funzioni cloud già esistenti (sb, withTimeout,
   currentCloudSession, fetchDisplayNames, describeError — js/cloud-account.js)
   e lo stile visivo approvato al checkpoint C1 (classi .chatp-*,
   css/style.css). Non tocca js/cloud-chat.js (chat generale di campagna,
   invariata) né rm_chat_messages.

   Tre contesti distinti, cronologie separate (mai unificate):
     - 'campaign' — chat generale di campagna (delega a openCampaignChatModal,
       già esistente, non duplicata qui);
     - 'campaign_private' — 1:1 fra compagni di una stessa campagna
       (giocatore-giocatore o Narratore-giocatore, stessa tabella, la
       distinzione visiva dipende dal ruolo dell'altro in quella campagna);
     - 'contacts_general' — 1:1 fra contatti reciprocamente accettati,
       fuori da qualunque campagna.

   Correzioni mirate (pacchetto v1, punto 12): identità reale anche qui
   (nickname vero al posto di "Tu", ritratto del personaggio per le
   conversazioni 'campaign_private' via hydrateDirectChatIdentity(), i
   contatti generali restano a solo nickname), elenco Conversazioni con
   anteprima reale ultimo messaggio/orario (non solo il badge non-letti,
   vedi list_my_direct_conversations_summary esteso in
   supabase/migrations/20260930160000_direct_conversations_last_message.sql)
   e riga contatto senza più un <button> annidato in un altro <button>. */

/* ---------------------------------------------------------- livello dati */

async function listMyCampaignMemberships() {
  const session = await currentCloudSession();
  if (!session) return [];
  const { data, error } = await withTimeout(
    sb.from('campaign_members').select('campaign_id, role, campaigns(id, name, icon, session_active)').eq('user_id', session.user.id),
    'Le tue storie'
  );
  if (error) throw error;
  return (data || []).filter(r => r.campaigns).map(r => ({ campaignId: r.campaign_id, role: r.role, name: r.campaigns.name, icon: r.campaigns.icon, sessionActive: r.campaigns.session_active }));
}

async function listCampaignCoMembers(campaignId) {
  const session = await currentCloudSession();
  if (!session) return [];
  const { data, error } = await withTimeout(
    sb.from('campaign_members').select('user_id, role').eq('campaign_id', campaignId),
    'Compagni di storia'
  );
  if (error) throw error;
  const others = (data || []).filter(r => r.user_id !== session.user.id);
  const names = await fetchDisplayNames(others.map(r => r.user_id));
  return others.map(r => ({ userId: r.user_id, role: r.role, isNarrator: ['owner', 'narratore', 'co_narratore'].includes(r.role), nickname: names[r.user_id] || 'Membro della storia' }));
}

async function listMyContacts() {
  const session = await currentCloudSession();
  if (!session) return { accepted: [], incoming: [], outgoing: [] };
  const { data, error } = await withTimeout(
    sb.from('rm_contacts').select('requester_id, addressee_id, status, created_at, responded_at')
      .or(`requester_id.eq.${session.user.id},addressee_id.eq.${session.user.id}`),
    'Contatti'
  );
  if (error) throw error;
  const rows = data || [];
  const otherIdOf = r => r.requester_id === session.user.id ? r.addressee_id : r.requester_id;
  const names = await fetchDisplayNames(rows.map(otherIdOf));
  const accepted = [], incoming = [], outgoing = [];
  rows.forEach(r => {
    const otherId = otherIdOf(r);
    const entry = { otherId, nickname: names[otherId] || 'Utente', createdAt: r.created_at };
    if (r.status === 'accepted') accepted.push(entry);
    else if (r.requester_id === session.user.id) outgoing.push(entry);
    else incoming.push(entry);
  });
  return { accepted, incoming, outgoing };
}

async function sendContactRequestByNickname(nickname) {
  const trimmed = (nickname || '').trim();
  if (trimmed.length < 2) throw new Error('Inserisci almeno 2 caratteri del nickname esatto');
  const { data: found, error: findErr } = await withTimeout(
    sb.rpc('find_profile_by_exact_nickname', { p_nickname: trimmed }),
    'Ricerca nickname'
  );
  if (findErr) throw findErr;
  if (!found || !found.length) throw new Error('Nessun utente trovato con questo nickname esatto');
  await withUgcTermsGate(async () => {
    const { error } = await withTimeout(sb.rpc('request_contact', { p_addressee_id: found[0].id }), 'Richiesta di contatto');
    if (error) throw error;
  });
  return found[0];
}
async function acceptContactRequest(requesterId) {
  const { error } = await withTimeout(sb.rpc('accept_contact', { p_requester_id: requesterId }), 'Accetta contatto');
  if (error) throw error;
}
async function rejectContactRequest(requesterId) {
  const { error } = await withTimeout(sb.rpc('reject_contact', { p_requester_id: requesterId }), 'Rifiuta contatto');
  if (error) throw error;
}
async function cancelContactRequest(addresseeId) {
  const { error } = await withTimeout(sb.rpc('cancel_contact_request', { p_addressee_id: addresseeId }), 'Ritira richiesta');
  if (error) throw error;
}
async function removeContact(otherId) {
  const { error } = await withTimeout(sb.rpc('remove_contact', { p_other_user_id: otherId }), 'Rimuovi contatto');
  if (error) throw error;
}

async function openOrCreateDirectConversation(kind, campaignId, otherUserId) {
  const { data, error } = await withTimeout(
    sb.rpc('get_or_create_direct_conversation', { p_kind: kind, p_campaign_id: campaignId || null, p_other_user_id: otherUserId }),
    'Apertura conversazione'
  );
  if (error) throw error;
  return data;
}

const DIRECT_PAGE_SIZE = 30;
async function listDirectMessages(conversationId, beforeCreatedAt) {
  let q = sb.from('rm_direct_messages')
    .select('id, conversation_id, author_user_id, body, reply_to_id, edited_at, removed_reason, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(DIRECT_PAGE_SIZE);
  if (beforeCreatedAt) q = q.lt('created_at', beforeCreatedAt);
  const { data, error } = await withTimeout(q, 'Messaggi');
  if (error) throw error;
  return (data || []).reverse();
}
async function sendDirectMessage(conversationId, body, replyToId) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  await withUgcTermsGate(async () => {
    const { error } = await withTimeout(
      sb.from('rm_direct_messages').insert({ conversation_id: conversationId, author_user_id: session.user.id, body, reply_to_id: replyToId || null }),
      'Invio messaggio'
    );
    if (error) throw error;
  });
}
async function deleteDirectMessage(messageId) {
  const { error } = await withTimeout(sb.rpc('rm_direct_delete_message', { p_message_id: messageId }), 'Eliminazione messaggio');
  if (error) throw error;
}
async function markDirectConversationRead(conversationId) {
  const session = await currentCloudSession();
  if (!session) return;
  const { error } = await withTimeout(
    sb.from('rm_direct_read_state').upsert({ conversation_id: conversationId, user_id: session.user.id, last_read_at: new Date().toISOString() }),
    'Stato letto'
  );
  if (error) throw error;
}

/* Un solo messaggio + conteggio non letti per conversazione (checkpoint
   C3): una RPC lato server invece di N query, vedi
   list_my_direct_conversations_summary in
   supabase/migrations/20260930110000_contacts_chat_realtime_and_notifications.sql. */
async function listMyDirectConversationsSummary() {
  const session = await currentCloudSession();
  if (!session) return [];
  const { data, error } = await withTimeout(sb.rpc('list_my_direct_conversations_summary'), 'Riepilogo conversazioni');
  if (error) throw error;
  return data || [];
}

/* -------------------------------------------------------------- realtime
   Checkpoint C3: stesso identico pattern già in uso per la chat di
   campagna (subscribeChatRealtime, js/cloud-chat.js) — canale aperto solo
   mentre la vista/il modale interessati sono davvero a schermo, mai un
   canale persistente app-wide (stessa lacuna nota e accettata già
   documentata lì). Nessuna seconda infrastruttura: stesso
   sb.channel()/postgres_changes/supabase_realtime di sempre. */
let directChatRealtimeChannel = null;
let directChatRealtimeDebounce = null;
function subscribeDirectChatRealtime(conversationId) {
  unsubscribeDirectChatRealtime();
  directChatRealtimeChannel = sb.channel('direct-chat-' + conversationId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rm_direct_messages', filter: 'conversation_id=eq.' + conversationId }, function () {
      clearTimeout(directChatRealtimeDebounce);
      directChatRealtimeDebounce = setTimeout(async function () {
        if (DIRECT_CHAT_STATE.conversationId !== conversationId) return;
        DIRECT_CHAT_STATE.messages = await listDirectMessages(conversationId);
        await renderDirectChatMessages();
        markDirectConversationRead(conversationId).catch(function () {});
      }, 150);
    })
    .subscribe();
}
function unsubscribeDirectChatRealtime() {
  clearTimeout(directChatRealtimeDebounce);
  if (!directChatRealtimeChannel) return;
  sb.removeChannel(directChatRealtimeChannel);
  directChatRealtimeChannel = null;
}

// Vista Conversazioni: un canale che segue contatti + messaggi privati
// dell'utente corrente, aperto solo mentre #view-conversations è a
// schermo — aggiorna badge non letti e liste contatti senza dover
// ricaricare manualmente la vista.
let conversationsRealtimeChannel = null;
let conversationsRealtimeDebounce = null;
async function subscribeConversationsRealtime() {
  unsubscribeConversationsRealtime();
  const session = await currentCloudSession();
  if (!session) return;
  conversationsRealtimeChannel = sb.channel('conversations-' + session.user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rm_contacts' }, scheduleConversationsRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rm_direct_messages' }, scheduleConversationsRefresh)
    .subscribe();
}
function unsubscribeConversationsRealtime() {
  clearTimeout(conversationsRealtimeDebounce);
  if (!conversationsRealtimeChannel) return;
  sb.removeChannel(conversationsRealtimeChannel);
  conversationsRealtimeChannel = null;
}
function scheduleConversationsRefresh() {
  clearTimeout(conversationsRealtimeDebounce);
  conversationsRealtimeDebounce = setTimeout(function () {
    var view = $('#view-conversations');
    if (view && !view.classList.contains('hidden')) renderConversationsView();
  }, 200);
}

/* -------------------------------------------------------------- presenza
   Checkpoint C3: presenza online reale via Supabase Realtime Presence
   (stessa libreria realtime-js già vendorizzata, mai un secondo sistema).
   Nessuna tabella: i canali Presence sono effimeri lato servizio Realtime,
   nulla da persistere né da testare in locale su Postgres — verificabile
   solo con due sessioni browser reali contro il servizio Realtime live
   (indipendente dalla migrazione, non richiede alcuna tabella applicata).
   online = scheda visibile in primo piano; away = app in background;
   nessuna voce nella mappa = "offline" (nessun tracking inviato). */
let rmPresenceChannel = null;
let rmPresenceState = {};
async function startPresence() {
  if (rmPresenceChannel) return;
  const session = await currentCloudSession();
  if (!session) return;
  rmPresenceChannel = sb.channel('rm-presence', { config: { presence: { key: session.user.id } } });
  rmPresenceChannel.on('presence', { event: 'sync' }, function () {
    var state = rmPresenceChannel.presenceState();
    var next = {};
    Object.keys(state).forEach(function (uid) {
      var entries = state[uid];
      var latest = entries && entries[entries.length - 1];
      next[uid] = (latest && latest.status) || 'online';
    });
    rmPresenceState = next;
    document.dispatchEvent(new CustomEvent('rm-presence-updated'));
  });
  rmPresenceChannel.subscribe(async function (status) {
    if (status !== 'SUBSCRIBED') return;
    await rmPresenceChannel.track({ status: document.visibilityState === 'visible' ? 'online' : 'away' });
  });
  document.addEventListener('visibilitychange', rmPresenceVisibilityHandler);
}
function rmPresenceVisibilityHandler() {
  if (!rmPresenceChannel) return;
  rmPresenceChannel.track({ status: document.visibilityState === 'visible' ? 'online' : 'away' }).catch(function () {});
}
function stopPresence() {
  document.removeEventListener('visibilitychange', rmPresenceVisibilityHandler);
  if (!rmPresenceChannel) return;
  sb.removeChannel(rmPresenceChannel);
  rmPresenceChannel = null;
  rmPresenceState = {};
}
function rmPresenceStatusFor(userId) { return rmPresenceState[userId] || 'offline'; }
function rmPresenceDotHtml(userId) {
  return '<span class="chatp-presence chatp-presence-' + rmPresenceStatusFor(userId) + '" style="position:static;display:inline-block;margin-left:6px;" aria-hidden="true"></span>';
}
document.addEventListener('rm-presence-updated', function () {
  var view = $('#view-conversations');
  if (view && !view.classList.contains('hidden')) renderConversationsView();
});

/* ------------------------------------------------------------- rendering
   Riusa le classi .chatp-* introdotte per il mockup C1 (css/style.css) —
   stessa identità visiva già approvata, ora su dati reali. Colore per
   avatar: nessun campo "colore personaggio" esiste ancora nello schema
   (arriverà con la mappa narrativa, fase M) — qui un colore STABILE
   derivato dall'id utente (hash minimo), mai preteso come dato di gioco. */
function chatDeterministicColor(id) {
  var hash = 0;
  for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  var hue = hash % 360;
  return 'hsl(' + hue + ', 62%, 58%)';
}

var DIRECT_CHAT_STATE = { conversationId: null, kind: null, campaignId: null, otherUserId: null, otherLabel: '', otherIsNarrator: false, otherColor: '', otherPortrait: null, campaignName: '', campaignIcon: null, myLabel: '', myPortrait: null, messages: [] };

// Ritratto reale del personaggio (correzioni mirate punto 12): solo per le
// conversazioni 'campaign_private' (compagni della stessa storia) ha senso
// — riusa list_campaign_member_characters, già creata ed esposta per la
// chat generale (js/cloud-chat.js). Le conversazioni 'contacts_general'
// restano a solo nickname (nessun personaggio in comune da mostrare).
async function hydrateDirectChatIdentity(kind, campaignId, otherUserId) {
  const session = await currentCloudSession();
  const myId = session && session.user.id;
  const names = await fetchDisplayNames(myId ? [myId] : []);
  DIRECT_CHAT_STATE.myLabel = (myId && names[myId]) || 'Tu';
  DIRECT_CHAT_STATE.myPortrait = null;
  DIRECT_CHAT_STATE.otherPortrait = null;
  DIRECT_CHAT_STATE.campaignIcon = null;
  if (kind !== 'campaign_private' || !campaignId) return;
  try {
    const [charsRes, campaignRes] = await Promise.all([
      withTimeout(sb.rpc('list_campaign_member_characters', { p_campaign_id: campaignId }), 'Personaggi della storia'),
      withTimeout(sb.from('campaigns').select('icon').eq('id', campaignId).maybeSingle(), 'Storia')
    ]);
    if (!charsRes.error) {
      (charsRes.data || []).forEach(function (r) {
        if (r.user_id === myId) DIRECT_CHAT_STATE.myPortrait = r.portrait_url;
        if (r.user_id === otherUserId) DIRECT_CHAT_STATE.otherPortrait = r.portrait_url;
      });
    }
    if (!campaignRes.error) DIRECT_CHAT_STATE.campaignIcon = (campaignRes.data && campaignRes.data.icon) || null;
  } catch (e) { /* identità non essenziale all'apertura della chat: la conversazione resta usabile senza ritratti */ }
}

function directChatMessageHtml(m, myId) {
  const isMine = m.author_user_id === myId;
  const isRemoved = !!m.removed_reason;
  const bodyText = isRemoved ? (m.removed_reason === 'author_deleted' ? 'Messaggio di un utente eliminato' : 'Messaggio rimosso') : (m.body || '');
  const time = new Date(m.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (DIRECT_CHAT_STATE.otherIsNarrator && !isMine) {
    const emblemHtml = DIRECT_CHAT_STATE.campaignIcon
      ? '<img src="' + escapeHtml(DIRECT_CHAT_STATE.campaignIcon) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'
      : '<span>' + escapeHtml((DIRECT_CHAT_STATE.campaignName || '?').trim().charAt(0).toUpperCase()) + '</span>';
    return '<div class="chatp-row chatp-row-narrator">' +
      '<div class="chatp-avatar chatp-avatar-narrator">' + emblemHtml + '</div>' +
      '<div class="chatp-bubble chatp-bubble-narrator">' +
        '<div class="chatp-head"><span class="chatp-badge-narrator">Narratore</span><span class="chatp-time">' + escapeHtml(time) + '</span></div>' +
        '<p class="chatp-body">' + escapeHtml(bodyText) + '</p>' +
      '</div>' +
    '</div>';
  }
  const mineClass = isMine ? ' chatp-row-mine' : '';
  const bubbleClass = isMine ? 'chatp-bubble chatp-bubble-mine' : 'chatp-bubble';
  const color = isMine ? 'var(--magico-forte)' : DIRECT_CHAT_STATE.otherColor;
  const label = isMine ? DIRECT_CHAT_STATE.myLabel : DIRECT_CHAT_STATE.otherLabel;
  const portrait = isMine ? DIRECT_CHAT_STATE.myPortrait : DIRECT_CHAT_STATE.otherPortrait;
  const avatarHtml = '<div class="chatp-avatar" style="border-color:' + color + ';">' + (portrait ? '<img src="' + escapeHtml(portrait) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' : '<span>' + escapeHtml((label || '?').trim().charAt(0).toUpperCase()) + '</span>') + '</div>';
  return '<div class="chatp-row' + mineClass + '">' +
    (isMine ? '' : avatarHtml) +
    '<div class="' + bubbleClass + '" style="' + (isMine ? '' : 'border-left-color:' + color + ';') + '">' +
      '<div class="chatp-head"><span class="chatp-nickname" style="color:' + color + ';">' + escapeHtml(label) + '</span><span class="chatp-time">' + escapeHtml(time) + '</span></div>' +
      '<p class="chatp-body">' + escapeHtml(bodyText) + '</p>' +
    '</div>' +
    (isMine ? avatarHtml : '') +
  '</div>';
}

async function renderDirectChatMessages() {
  const list = $('#direct-chat-message-list');
  if (!list) return;
  const session = await currentCloudSession();
  const myId = session && session.user.id;
  list.innerHTML = DIRECT_CHAT_STATE.messages.length
    ? DIRECT_CHAT_STATE.messages.map(m => directChatMessageHtml(m, myId)).join('')
    : '<p class="helper-text" style="margin:0;">Nessun messaggio ancora: scrivi il primo.</p>';
  list.scrollTop = list.scrollHeight;
}

async function openDirectChatModal(kind, campaignId, otherUserId, otherLabel, otherIsNarrator, campaignName) {
  const modal = $('#direct-chat-modal');
  const title = $('#direct-chat-title');
  if (!modal) return;
  try {
    const conv = await openOrCreateDirectConversation(kind, campaignId, otherUserId);
    DIRECT_CHAT_STATE.conversationId = conv.id;
    DIRECT_CHAT_STATE.kind = kind;
    DIRECT_CHAT_STATE.campaignId = campaignId;
    DIRECT_CHAT_STATE.otherUserId = otherUserId;
    DIRECT_CHAT_STATE.otherLabel = otherLabel;
    DIRECT_CHAT_STATE.otherIsNarrator = !!otherIsNarrator;
    DIRECT_CHAT_STATE.otherColor = chatDeterministicColor(otherUserId);
    DIRECT_CHAT_STATE.campaignName = campaignName || '';
    if (title) title.innerHTML = escapeHtml(otherIsNarrator ? ('Narratore — ' + (campaignName || '')) : otherLabel) + (otherIsNarrator ? '' : rmPresenceDotHtml(otherUserId));
    modal.classList.remove('hidden');
    await hydrateDirectChatIdentity(kind, campaignId, otherUserId).catch(() => {});
    DIRECT_CHAT_STATE.messages = await listDirectMessages(conv.id);
    await renderDirectChatMessages();
    markDirectConversationRead(conv.id).catch(() => {});
    subscribeDirectChatRealtime(conv.id);
    startPresence();
  } catch (e) {
    toast('Impossibile aprire la conversazione: ' + describeError(e));
  }
}
function closeDirectChatModal() {
  const modal = $('#direct-chat-modal');
  if (modal) modal.classList.add('hidden');
  DIRECT_CHAT_STATE.conversationId = null;
  DIRECT_CHAT_STATE.messages = [];
  unsubscribeDirectChatRealtime();
}
async function sendDirectChatFromComposer() {
  const input = $('#direct-chat-compose-body');
  if (!input || !DIRECT_CHAT_STATE.conversationId) return;
  const body = input.value.trim();
  if (!body) return;
  try {
    await sendDirectMessage(DIRECT_CHAT_STATE.conversationId, body);
    input.value = '';
    DIRECT_CHAT_STATE.messages = await listDirectMessages(DIRECT_CHAT_STATE.conversationId);
    await renderDirectChatMessages();
  } catch (e) {
    toast('Invio non riuscito: ' + describeError(e));
  }
}

/* ------------------------------------------------------------- vista elenco */

/* Chiave univoca per accoppiare una riga (storia+altro utente, oppure
   contatti generali+altro utente) al riepilogo non-letti/ultimo-messaggio
   restituito da list_my_direct_conversations_summary — stesso criterio
   della UNIQUE INDEX del database (kind, campagna, coppia utenti). */
function conversationsSummaryKey(kind, campaignId, otherUserId) {
  return kind + '|' + (campaignId || '') + '|' + otherUserId;
}

function conversationsUnreadBadgeHtml(entry) {
  if (!entry || !entry.unread_count) return '';
  return '<span class="notif-badge">' + escapeHtml(String(entry.unread_count)) + '</span>';
}

// Anteprima reale ("chi ha scritto cosa, quando" — correzioni mirate punto
// 12) invece del solo badge non-letti: riusa list_my_direct_conversations_summary
// (last_message_body/mine/removed/at, migrazione 20260930160000), mai un
// dato inventato — righe senza alcun messaggio restano senza anteprima.
function conversationsTimeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}
function conversationsPreviewHtml(entry, myLabel) {
  if (!entry || !entry.last_message_at) return '';
  const text = entry.last_message_removed ? 'Messaggio rimosso' : ((entry.last_message_mine ? myLabel + ': ' : '') + (entry.last_message_body || ''));
  return '<div class="row-between" style="margin-top:2px;gap:8px;">' +
    '<span class="helper-text" style="margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(text.slice(0, 70)) + '</span>' +
    '<span class="helper-text" style="margin:0;flex:none;">' + escapeHtml(conversationsTimeLabel(entry.last_message_at)) + '</span>' +
  '</div>';
}

async function renderConversationsView() {
  const campaignsList = $('#conv-campaigns-list');
  const privateList = $('#conv-private-list');
  const contactsAccepted = $('#conv-contacts-accepted');
  const contactsIncoming = $('#conv-contacts-incoming');
  const contactsOutgoing = $('#conv-contacts-outgoing');
  if (!campaignsList) return;
  campaignsList.innerHTML = '<p class="helper-text" style="margin:0;">Caricamento…</p>';
  privateList.innerHTML = '';
  try {
    startPresence();
    subscribeConversationsRealtime();

    const session = await currentCloudSession();
    const myId = session && session.user.id;
    const myNames = await fetchDisplayNames(myId ? [myId] : []);
    const myLabel = (myId && myNames[myId]) || 'Tu';

    let summaryByKey = {};
    try {
      const summary = await listMyDirectConversationsSummary();
      summary.forEach(function (row) {
        summaryByKey[conversationsSummaryKey(row.kind, row.campaign_id, row.other_user_id)] = row;
      });
    } catch (eSummary) {
      // Riepilogo non essenziale: se fallisce (es. sessione assente), le
      // righe restano comunque utilizzabili senza badge non-letti/anteprima.
    }

    const memberships = await listMyCampaignMemberships();
    campaignsList.innerHTML = memberships.length
      ? memberships.map(m => '<button type="button" class="box conv-row" data-openccampaign="' + m.campaignId + '"><div class="box-bar"></div><div class="box-pad">' + escapeHtml(m.name) + (m.sessionActive ? ' <span class="chip">Sessione attiva</span>' : '') + '</div></button>').join('')
      : '<p class="helper-text" style="margin:0;">Non fai ancora parte di nessuna storia.</p>';

    let privateHtml = '';
    for (const m of memberships) {
      const coMembers = await listCampaignCoMembers(m.campaignId);
      if (!coMembers.length) continue;
      privateHtml += '<div class="chatp-section-title" style="font-size:13px;margin-top:10px;">' + escapeHtml(m.name) + '</div>';
      privateHtml += coMembers.map(cm => {
        const entry = summaryByKey[conversationsSummaryKey('campaign_private', m.campaignId, cm.userId)];
        return '<button type="button" class="box conv-row" data-opendirect="campaign_private" data-dcampaign="' + m.campaignId + '" data-douser="' + cm.userId + '" data-dlabel="' + escapeHtml(cm.nickname) + '" data-dnarrator="' + (cm.isNarrator ? '1' : '0') + '" data-dcname="' + escapeHtml(m.name) + '"><div class="box-bar"></div><div class="box-pad">' +
          '<div class="row-between">' + (cm.isNarrator ? '🎭 Narratore' : escapeHtml(cm.nickname)) + (cm.isNarrator ? '' : rmPresenceDotHtml(cm.userId)) + conversationsUnreadBadgeHtml(entry) + '</div>' +
          conversationsPreviewHtml(entry, myLabel) +
        '</div></button>';
      }).join('');
    }
    privateList.innerHTML = privateHtml || '<p class="helper-text" style="margin:0;">Nessun compagno di storia disponibile per una chat privata.</p>';

    const contacts = await listMyContacts();
    // Riga = apertura conversazione (bottone) + "Rimuovi" (bottone) fianco a
    // fianco, MAI un <button> annidato in un altro <button> (bug di
    // nesting corretto, correzioni mirate punto 12): un bottone dentro un
    // bottone è HTML non valido — il browser chiude il primo prima del
    // previsto, il click su "Rimuovi" finiva anche per aprire la chat.
    contactsAccepted.innerHTML = contacts.accepted.length
      ? contacts.accepted.map(c => {
          const entry = summaryByKey[conversationsSummaryKey('contacts_general', null, c.otherId)];
          return '<div style="display:flex;align-items:stretch;gap:6px;margin-bottom:8px;">' +
            '<button type="button" class="box conv-row" style="flex:1;margin-bottom:0;" data-opendirect="contacts_general" data-douser="' + c.otherId + '" data-dlabel="' + escapeHtml(c.nickname) + '"><div class="box-bar"></div><div class="box-pad">' +
              '<div class="row-between">' + escapeHtml(c.nickname) + rmPresenceDotHtml(c.otherId) + conversationsUnreadBadgeHtml(entry) + '</div>' +
              conversationsPreviewHtml(entry, myLabel) +
            '</div></button>' +
            '<button type="button" class="btn btn-ghost btn-sm" style="flex:none;align-self:center;" data-removecontact="' + c.otherId + '">Rimuovi</button>' +
          '</div>';
        }).join('')
      : '<p class="helper-text" style="margin:0;">Nessun contatto ancora.</p>';
    contactsIncoming.innerHTML = contacts.incoming.map(c => '<div class="box"><div class="box-bar"></div><div class="box-pad row-between">' + escapeHtml(c.nickname) + '<span><button type="button" class="btn btn-primary btn-sm" data-acceptcontact="' + c.otherId + '">Accetta</button> <button type="button" class="btn btn-ghost btn-sm" data-rejectcontact="' + c.otherId + '">Rifiuta</button></span></div></div>').join('');
    contactsOutgoing.innerHTML = contacts.outgoing.map(c => '<div class="box"><div class="box-bar"></div><div class="box-pad row-between">' + escapeHtml(c.nickname) + ' (in attesa) <button type="button" class="btn btn-ghost btn-sm" data-cancelcontact="' + c.otherId + '">Ritira</button></div></div>').join('');
  } catch (e) {
    campaignsList.innerHTML = '<p class="helper-text" style="margin:0;">Errore: ' + escapeHtml(describeError(e)) + '</p>';
  }
}

document.addEventListener('DOMContentLoaded', function () {
  const closeBtn = $('#direct-chat-close');
  if (closeBtn) closeBtn.onclick = closeDirectChatModal;
  const sendBtn = $('#direct-chat-send-btn');
  if (sendBtn) sendBtn.onclick = sendDirectChatFromComposer;

  const view = $('#view-conversations');
  if (view) {
    view.addEventListener('click', function (ev) {
      const campBtn = ev.target.closest('[data-openccampaign]');
      if (campBtn && typeof openCampaignChatModal === 'function') { openCampaignChatModal(campBtn.dataset.openccampaign); return; }
      const dBtn = ev.target.closest('[data-opendirect]');
      if (dBtn) {
        openDirectChatModal(dBtn.dataset.opendirect, dBtn.dataset.dcampaign || null, dBtn.dataset.douser, dBtn.dataset.dlabel, dBtn.dataset.dnarrator === '1', dBtn.dataset.dcname);
        return;
      }
      const acceptBtn = ev.target.closest('[data-acceptcontact]');
      if (acceptBtn) { acceptContactRequest(acceptBtn.dataset.acceptcontact).then(renderConversationsView).catch(e => toast(describeError(e))); return; }
      const rejectBtn = ev.target.closest('[data-rejectcontact]');
      if (rejectBtn) { rejectContactRequest(rejectBtn.dataset.rejectcontact).then(renderConversationsView).catch(e => toast(describeError(e))); return; }
      const cancelBtn = ev.target.closest('[data-cancelcontact]');
      if (cancelBtn) { cancelContactRequest(cancelBtn.dataset.cancelcontact).then(renderConversationsView).catch(e => toast(describeError(e))); return; }
      const removeBtn = ev.target.closest('[data-removecontact]');
      if (removeBtn) { removeContact(removeBtn.dataset.removecontact).then(renderConversationsView).catch(e => toast(describeError(e))); return; }
    });
  }
  const addContactBtn = $('#conv-add-contact-btn');
  if (addContactBtn) addContactBtn.onclick = function () {
    const input = $('#conv-add-contact-nickname');
    if (!input || !input.value.trim()) return;
    sendContactRequestByNickname(input.value).then(function () { input.value = ''; return renderConversationsView(); }).catch(function (e) { toast(describeError(e)); });
  };

  // Voce di menu condizionale (T1.1 stesso principio): "💬 Conversazioni"
  // e data-menu-nav="conversations" sono già l'etichetta/destinazione di
  // default nell'HTML (correzioni mirate: nessuna etichetta "revisione"
  // né icona di laboratorio nella UI finale, mai più il mockup C1) — qui
  // resta solo il toggle di visibilità in base al flag.
  var menuItem = $('#cm-item-chatpreview');
  // Fail-closed (audit Play Store, punto 6): la voce compare solo dopo che
  // il database ha confermato le dipendenze della chat privata. Ricontrollata
  // a ogni cambio di sessione (un utente non ancora collegato non può
  // verificare le tabelle protette da RLS/grant authenticated).
  function refreshConversationsMenuItem() {
    if (!menuItem || typeof rmFeatureEnabled !== 'function' || !rmFeatureEnabled('chat_revision_v1')) return;
    if (typeof rmFeatureBackendReady !== 'function') return;
    rmFeatureBackendReady('chat_revision_v1').then(function (ok) { menuItem.classList.toggle('hidden', !ok); });
  }
  refreshConversationsMenuItem();
  if (typeof sb !== 'undefined' && sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
    sb.auth.onAuthStateChange(function () { setTimeout(refreshConversationsMenuItem, 0); });
  }
});
