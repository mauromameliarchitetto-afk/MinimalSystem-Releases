/* Chat di campagna (FC6, FASE FINALE — completamento funzionale
   competitivo). VINCOLO CRITICO dato dall'utente: non tocca né riusa
   threads/messages/thread_participants/thread_summaries/summarize-thread
   — strutture Role Makers isolate, tutte con prefisso "rm_chat_" (vedi
   supabase/migrations/20260930020000_campaign_chat.sql).

   Un'unica implementazione responsive (modale #campaign-chat-modal,
   index.html), aperta sia dalla scheda storia sia dal Combattimento — mai
   due markup diversi da mantenere allineati. Tre canali fissi (generale/
   fuorigioco/annunci), scrittura in "annunci" riservata al Narratore (qui
   solo lato UI: il vincolo vero è la RLS della migrazione). Sola gestione
   cloud + rendering di questo modulo; niente coda di revisione delle
   segnalazioni (di competenza FC11, non ancora costruita). */

const CHAT_CHANNELS = ['generale', 'fuorigioco', 'annunci'];
const CHAT_CHANNEL_LABEL = { generale: 'Generale', fuorigioco: 'Fuori gioco', annunci: 'Annunci' };
const CHAT_PAGE_SIZE = 30;

/* ---------------------------------------------------- livello dati cloud */

async function listChatMessages(campaignId, channel, beforeCreatedAt) {
  let q = sb.from('rm_chat_messages')
    .select('id, campaign_id, channel, author_user_id, body, reply_to_id, edited_at, removed_reason, created_at')
    .eq('campaign_id', campaignId).eq('channel', channel)
    .order('created_at', { ascending: false }).limit(CHAT_PAGE_SIZE);
  if (beforeCreatedAt) q = q.lt('created_at', beforeCreatedAt);
  const { data, error } = await withTimeout(q, 'Chat di campagna');
  if (error) throw error;
  return (data || []).reverse(); // ordine cronologico (più vecchio in cima), come una chat normale
}

async function sendChatMessage(campaignId, channel, body, replyToId) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { error } = await withTimeout(
    sb.from('rm_chat_messages').insert({
      campaign_id: campaignId, channel, author_user_id: session.user.id,
      body, reply_to_id: replyToId || null
    }),
    'Invio messaggio'
  );
  if (error) throw error;
}

async function editChatMessage(messageId, body) {
  const { error } = await withTimeout(
    sb.from('rm_chat_messages').update({ body, edited_at: new Date().toISOString() }).eq('id', messageId),
    'Modifica messaggio'
  );
  if (error) throw error;
}

// Eliminazione soft via RPC (autore: "self"; Narratore su un messaggio
// altrui: "moderation" — la scelta fra i due è decisa server-side, non
// qui, vedi rm_chat_delete_message nella migrazione).
async function deleteChatMessage(messageId) {
  const { error } = await withTimeout(sb.rpc('rm_chat_delete_message', { p_message_id: messageId }), 'Eliminazione messaggio');
  if (error) throw error;
}

async function reportChatMessage(messageId, campaignId, reason) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { error } = await withTimeout(
    sb.from('rm_chat_reports').insert({ message_id: messageId, campaign_id: campaignId, reporter_user_id: session.user.id, reason: reason || '' }),
    'Segnalazione'
  );
  if (error) throw error;
}

async function blockChatUser(campaignId, blockedUserId) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { error } = await withTimeout(
    sb.from('rm_chat_blocks').insert({ campaign_id: campaignId, blocker_user_id: session.user.id, blocked_user_id: blockedUserId }),
    'Blocco utente'
  );
  if (error) throw error;
}
async function unblockChatUser(campaignId, blockedUserId) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { error } = await withTimeout(
    sb.from('rm_chat_blocks').delete().eq('campaign_id', campaignId).eq('blocker_user_id', session.user.id).eq('blocked_user_id', blockedUserId),
    'Sblocco utente'
  );
  if (error) throw error;
}
async function listChatBlockedUserIds(campaignId) {
  const session = await currentCloudSession();
  if (!session) return [];
  const { data, error } = await withTimeout(
    sb.from('rm_chat_blocks').select('blocked_user_id').eq('campaign_id', campaignId).eq('blocker_user_id', session.user.id),
    'Blocchi'
  );
  if (error) throw error;
  return (data || []).map(r => r.blocked_user_id);
}

async function markChatChannelRead(campaignId, channel) {
  const session = await currentCloudSession();
  if (!session) return;
  const { error } = await withTimeout(
    sb.from('rm_chat_read_state').upsert(
      { campaign_id: campaignId, channel, user_id: session.user.id, last_read_at: new Date().toISOString() },
      { onConflict: 'campaign_id,channel,user_id' }
    ),
    'Stato letto chat'
  );
  if (error) throw error;
}

// Determina se il chiamante può scrivere in "annunci" (solo lato UI: il
// vincolo vero è la RLS). campaign_members è già leggibile da ogni membro
// (stessa grant usata da is_campaign_member).
async function getMyCampaignRole(campaignId) {
  const session = await currentCloudSession();
  if (!session) return null;
  const { data, error } = await withTimeout(
    sb.from('campaign_members').select('role').eq('campaign_id', campaignId).eq('user_id', session.user.id).maybeSingle(),
    'Ruolo in campagna'
  );
  if (error) throw error;
  return data ? data.role : null;
}

// Badge "non letti" (S19 non c'entra: badge autonomo della chat, mai
// scritto nella tabella notifications). Per ciascuno dei 3 canali fissi:
// non letto se l'ultimo messaggio (non mio) è più recente dell'ultima
// lettura registrata. Solo 4 query fisse (1 stato letto + 3 "ultimo
// messaggio per canale"), nessuna crescita con la storia della chat.
async function getChatUnreadSummary(campaignId) {
  const session = await currentCloudSession();
  if (!session) return { generale: false, fuorigioco: false, annunci: false, any: false };
  const [readsRes, ...latestRes] = await Promise.all([
    sb.from('rm_chat_read_state').select('channel, last_read_at').eq('campaign_id', campaignId).eq('user_id', session.user.id),
    ...CHAT_CHANNELS.map(ch =>
      sb.from('rm_chat_messages').select('created_at, author_user_id').eq('campaign_id', campaignId).eq('channel', ch)
        .order('created_at', { ascending: false }).limit(1).maybeSingle())
  ]);
  if (readsRes.error) throw readsRes.error;
  const readMap = {};
  (readsRes.data || []).forEach(r => { readMap[r.channel] = r.last_read_at; });
  const summary = {};
  CHAT_CHANNELS.forEach((ch, i) => {
    const res = latestRes[i];
    if (res.error) throw res.error;
    const latest = res.data;
    if (!latest || latest.author_user_id === session.user.id) { summary[ch] = false; return; }
    const lastRead = readMap[ch];
    summary[ch] = !lastRead || new Date(latest.created_at) > new Date(lastRead);
  });
  summary.any = CHAT_CHANNELS.some(ch => summary[ch]);
  return summary;
}

/* Aggiorna i due badge dei punti d'ingresso (scheda storia + combattimento)
   senza aprire il modale: richiamata all'apertura di quelle viste, mai un
   canale realtime persistente app-wide (quello resta un gap non bloccante
   in backlog, vedi nota più sotto — qui il badge è accurato ogni volta che
   si entra in quel contesto, non "in tempo reale ovunque nell'app"). */
async function refreshCampaignChatEntryBadges(campaignId) {
  if (!campaignId) return;
  try {
    const summary = await getChatUnreadSummary(campaignId);
    updateChatEntryBadges(summary.any);
  } catch (e) { /* silenzioso: un badge mancato non deve rompere la vista che lo ospita */ }
}
function updateChatEntryBadges(hasUnread) {
  ['campaign-chat-badge-sheet', 'campaign-chat-badge-combat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !hasUnread);
  });
}

/* ---------------------------------------------------- stato del modale */

let chatModalCampaignId = null;
let chatActiveChannel = 'generale';
let chatIsMaster = false;
let chatMyUserId = null;
let chatMessages = []; // canale attivo, ordine cronologico
let chatHasMoreOlder = false;
let chatReplyToId = null;
let chatEditingMessageId = null;
let chatBlockedUserIds = [];
let chatAuthorNamesCache = {};
let chatRealtimeChannel = null;
let chatRealtimeCampaignId = null;

async function hydrateChatAuthorNames(messages) {
  const missing = [...new Set(messages.map(m => m.author_user_id).filter(id => id && !chatAuthorNamesCache[id]))];
  if (!missing.length) return;
  try { Object.assign(chatAuthorNamesCache, await fetchDisplayNames(missing)); } catch (e) { /* nomi mancanti ricadono su un'etichetta generica */ }
}

function chatMessageRowHtml(m, ctx) {
  if (m.author_user_id && ctx.blockedUserIds.includes(m.author_user_id)) {
    return `<div class="box" data-chatmsgrow="${m.id}" style="margin-bottom:6px;"><div class="box-bar"></div><div class="box-pad">
      <p class="helper-text" style="margin:0;">Messaggio nascosto (hai bloccato questo utente). <button type="button" class="btn btn-ghost btn-sm" data-chatunblock="${m.author_user_id}">Sblocca</button></p>
    </div></div>`;
  }
  const isMine = !!m.author_user_id && m.author_user_id === ctx.myId;
  const isRemoved = !!m.removed_reason;
  const authorLabel = m.author_user_id ? (isMine ? 'Tu' : (ctx.authorNames[m.author_user_id] || 'Un membro della campagna')) : 'Utente eliminato';
  const removedLabel = m.removed_reason === 'author_deleted' ? 'Messaggio rimosso da un utente eliminato'
    : m.removed_reason === 'moderation' ? 'Messaggio rimosso dal Narratore'
    : 'Messaggio rimosso';
  const bodyHtml = isRemoved
    ? `<p class="helper-text" style="margin:0;font-style:italic;">${escapeHtml(removedLabel)}</p>`
    : `<p style="margin:0;white-space:pre-wrap;">${escapeHtml(m.body)}</p>`;
  const replyMsg = m.reply_to_id ? ctx.byId[m.reply_to_id] : null;
  const replyHtml = m.reply_to_id
    ? `<p class="helper-text" style="margin:0 0 2px;border-left:2px solid var(--bordo-scuro);padding-left:6px;">↩ ${escapeHtml(replyMsg ? (replyMsg.removed_reason ? '(messaggio rimosso)' : (replyMsg.body || '').slice(0, 80)) : '(fuori da questa pagina)')}</p>`
    : '';
  const actions = [];
  if (!isRemoved) actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-chatreply="${m.id}">Rispondi</button>`);
  if (isMine && !isRemoved) actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-chatedit="${m.id}">Modifica</button>`);
  if (isMine && !isRemoved) actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-chatdelete="${m.id}">Elimina</button>`);
  if (!isMine && ctx.isMaster && !isRemoved) actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-chatdelete="${m.id}">Rimuovi</button>`);
  if (!isMine && !isRemoved) actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-chatreport="${m.id}">Segnala</button>`);
  if (!isMine && m.author_user_id) actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-chatblock="${m.author_user_id}">Blocca</button>`);
  return `<div class="box" data-chatmsgrow="${m.id}" style="margin-bottom:6px;"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:2px;">
    <p class="helper-text" style="margin:0;">${escapeHtml(authorLabel)} · ${notificationRelativeTime(m.created_at)}${m.edited_at ? ' · modificato' : ''}</p>
    ${replyHtml}
    ${bodyHtml}
    ${actions.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;">${actions.join('')}</div>` : ''}
  </div></div>`;
}

function renderChatMessageListDom() {
  const list = $('#chat-message-list');
  if (!list) return;
  const byId = {};
  chatMessages.forEach(m => { byId[m.id] = m; });
  const ctx = { myId: chatMyUserId, authorNames: chatAuthorNamesCache, isMaster: chatIsMaster, blockedUserIds: chatBlockedUserIds, byId };
  list.innerHTML = chatMessages.length
    ? chatMessages.map(m => chatMessageRowHtml(m, ctx)).join('')
    : '<p class="helper-text" style="margin:0;">Nessun messaggio ancora in questo canale: scrivi il primo.</p>';
  list.scrollTop = list.scrollHeight;
}

async function loadChatMessagesPage(older) {
  const campaignId = chatModalCampaignId;
  const channel = chatActiveChannel;
  const before = older && chatMessages.length ? chatMessages[0].created_at : null;
  const scrollAnchor = older ? $('#chat-message-list').scrollHeight : 0;
  let page;
  try { page = await listChatMessages(campaignId, channel, before); }
  catch (e) { $('#chat-message-list').innerHTML = `<p class="helper-text" style="margin:0;">Errore: ${escapeHtml(describeError(e))}</p>`; return; }
  if (campaignId !== chatModalCampaignId || channel !== chatActiveChannel) return; // canale/modale cambiato nel frattempo
  chatHasMoreOlder = page.length === CHAT_PAGE_SIZE;
  chatMessages = older ? page.concat(chatMessages) : page;
  await hydrateChatAuthorNames(chatMessages);
  renderChatMessageListDom();
  const loadMoreBtn = $('#chat-load-more');
  if (loadMoreBtn) loadMoreBtn.classList.toggle('hidden', !chatHasMoreOlder);
  if (older) {
    // Mantiene la posizione di lettura: senza questo, caricare messaggi più
    // vecchi in cima farebbe saltare la vista in fondo (comportamento
    // atteso solo per un nuovo messaggio in arrivo, non per la cronologia).
    const list = $('#chat-message-list');
    list.scrollTop = list.scrollHeight - scrollAnchor;
  }
}

function updateChatComposeCounter() {
  const ta = $('#chat-compose-body');
  const counter = $('#chat-compose-counter');
  if (ta && counter) counter.textContent = `${ta.value.length}/2000`;
}

async function refreshChatBadgesInModal() {
  if (!chatModalCampaignId) return;
  try {
    const summary = await getChatUnreadSummary(chatModalCampaignId);
    CHAT_CHANNELS.forEach(ch => {
      const badge = document.getElementById('chat-badge-' + ch);
      if (badge) badge.classList.toggle('hidden', !summary[ch] || ch === chatActiveChannel);
    });
    updateChatEntryBadges(summary.any);
  } catch (e) { /* silenzioso */ }
}

async function selectChatChannel(channel) {
  chatActiveChannel = channel;
  chatReplyToId = null;
  chatEditingMessageId = null;
  $('#chat-reply-preview').classList.add('hidden');
  $('#chat-compose-body').value = '';
  updateChatComposeCounter();
  $$('#chat-channel-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.chatchannel === channel));
  const isAnnunciReadonly = channel === 'annunci' && !chatIsMaster;
  $('#chat-compose-area').classList.toggle('hidden', isAnnunciReadonly);
  $('#chat-annunci-readonly-note').classList.toggle('hidden', !isAnnunciReadonly);
  $('#chat-message-list').innerHTML = '<p class="helper-text" style="margin:0;">Verifica in corso…</p>';
  chatMessages = [];
  chatHasMoreOlder = false;
  await loadChatMessagesPage(false);
  markChatChannelRead(chatModalCampaignId, channel).catch(() => {});
  refreshChatBadgesInModal();
}

async function sendChatComposeFlow() {
  const body = ($('#chat-compose-body').value || '').trim();
  const errEl = $('#chat-compose-error');
  errEl.classList.add('hidden');
  if (!body) return;
  if (body.length > 2000) { errEl.textContent = 'Massimo 2000 caratteri.'; errEl.classList.remove('hidden'); return; }
  const sendBtn = $('#chat-send-btn');
  sendBtn.disabled = true;
  try {
    if (chatEditingMessageId) {
      await editChatMessage(chatEditingMessageId, body);
      chatEditingMessageId = null;
    } else {
      await sendChatMessage(chatModalCampaignId, chatActiveChannel, body, chatReplyToId);
      chatReplyToId = null;
      $('#chat-reply-preview').classList.add('hidden');
    }
    $('#chat-compose-body').value = '';
    updateChatComposeCounter();
    await loadChatMessagesPage(false);
    markChatChannelRead(chatModalCampaignId, chatActiveChannel).catch(() => {});
  } catch (e) {
    // Il rate limit server-side (rm_chat_rate_ok) è l'unica policy RLS che
    // questa UI può davvero far scattare (autore/canale/appartenenza sono
    // già garantiti a monte): un messaggio dedicato invece del generico
    // "row-level security" tecnico.
    errEl.textContent = /row-level security/i.test(String((e && e.message) || ''))
      ? 'Aspetta qualche secondo prima di scrivere un altro messaggio.'
      : describeError(e);
    errEl.classList.remove('hidden');
  } finally {
    sendBtn.disabled = false;
  }
}

/* ---------------------------------------------------- realtime */

// Per-campagna, aperto solo mentre il modale è visibile (come
// startCombatRealtimeWatch in cloud-combat.js, ma qui su tutti e tre i
// canali insieme: servono per tenere aggiornati i badge delle altre tab
// mentre si guarda quella attiva). Lacuna nota (non bloccante, in
// backlog): nessun canale realtime persistente app-wide — il badge dei
// punti d'ingresso si aggiorna quando si entra in quel contesto (scheda
// storia/combattimento), non "ovunque nell'app in tempo reale": il vero
// avviso indipendente dalla vista aperta è compito della FC7 (push
// nativa), qui c'è solo il popup in-app mentre il modale è già aperto.
let chatRealtimeDebounceTimer = null;

function subscribeChatRealtime(campaignId) {
  unsubscribeChatRealtime();
  chatRealtimeCampaignId = campaignId;
  chatRealtimeChannel = sb.channel('campaign-chat-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rm_chat_messages', filter: 'campaign_id=eq.' + campaignId }, payload => {
      clearTimeout(chatRealtimeDebounceTimer);
      chatRealtimeDebounceTimer = setTimeout(() => onChatRealtimeChange(payload), 150);
    })
    .subscribe();
}
function unsubscribeChatRealtime() {
  clearTimeout(chatRealtimeDebounceTimer);
  if (!chatRealtimeChannel) return;
  sb.removeChannel(chatRealtimeChannel);
  chatRealtimeChannel = null;
  chatRealtimeCampaignId = null;
}
function onChatRealtimeChange(payload) {
  if (!chatModalCampaignId || chatModalCampaignId !== chatRealtimeCampaignId) return;
  const row = payload.new || payload.old;
  if (!row) return;
  if (row.channel === chatActiveChannel) {
    loadChatMessagesPage(false);
    markChatChannelRead(chatModalCampaignId, chatActiveChannel).catch(() => {});
  } else if (payload.eventType === 'INSERT' && row.author_user_id !== chatMyUserId) {
    toast('Nuovo messaggio in #' + (CHAT_CHANNEL_LABEL[row.channel] || row.channel));
  }
  refreshChatBadgesInModal();
}

/* ---------------------------------------------------- apertura/chiusura */

async function openCampaignChatModal(campaignId) {
  if (!campaignId) return;
  chatModalCampaignId = campaignId;
  chatReplyToId = null;
  chatEditingMessageId = null;
  $('#campaign-chat-modal').classList.remove('hidden');
  $('#chat-reply-preview').classList.add('hidden');
  const session = await currentCloudSession();
  chatMyUserId = session ? session.user.id : null;
  try {
    const [role, blocked] = await Promise.all([
      getMyCampaignRole(campaignId).catch(() => null),
      listChatBlockedUserIds(campaignId).catch(() => [])
    ]);
    chatIsMaster = role === 'owner' || role === 'narratore' || role === 'co_narratore';
    chatBlockedUserIds = blocked;
  } catch (e) { chatIsMaster = false; chatBlockedUserIds = []; }
  if (campaignId !== chatModalCampaignId) return; // il modale è stato chiuso mentre si aspettava
  await selectChatChannel('generale');
  subscribeChatRealtime(campaignId);
}

function closeCampaignChatModal() {
  $('#campaign-chat-modal').classList.add('hidden');
  unsubscribeChatRealtime();
  // Il badge dei punti d'ingresso potrebbe essere sceso a zero durante la
  // sessione appena chiusa (mark-as-read su ogni canale visitato): un
  // ultimo refresh, prima di azzerare l'id, evita che resti acceso per
  // errore.
  const closedCampaignId = chatModalCampaignId;
  chatModalCampaignId = null;
  refreshCampaignChatEntryBadges(closedCampaignId);
}

function wireCampaignChatModal() {
  const sheetBtn = $('#btn-open-campaign-chat-sheet');
  if (sheetBtn) sheetBtn.addEventListener('click', () => openCampaignChatModal(activeCampaignSheetId));
  const combatBtn = $('#btn-open-campaign-chat-combat');
  if (combatBtn) combatBtn.addEventListener('click', () => openCampaignChatModal(combatViewCampaignId));
  $('#chat-close').addEventListener('click', () => closeCampaignChatModal());
  $$('#chat-channel-tabs .tab-btn').forEach(b => b.addEventListener('click', () => selectChatChannel(b.dataset.chatchannel)));
  $('#chat-compose-body').addEventListener('input', updateChatComposeCounter);
  $('#chat-send-btn').addEventListener('click', sendChatComposeFlow);
  $('#chat-reply-cancel').addEventListener('click', () => { chatReplyToId = null; $('#chat-reply-preview').classList.add('hidden'); });
  $('#chat-load-more').addEventListener('click', () => loadChatMessagesPage(true));

  $('#chat-message-list').addEventListener('click', async e => {
    const replyBtn = e.target.closest('[data-chatreply]');
    if (replyBtn) {
      chatReplyToId = replyBtn.dataset.chatreply;
      const m = chatMessages.find(x => x.id === chatReplyToId);
      $('#chat-reply-preview-text').textContent = 'Rispondi a: ' + ((m && m.body) || '').slice(0, 60);
      $('#chat-reply-preview').classList.remove('hidden');
      $('#chat-compose-body').focus();
      return;
    }
    const editBtn = e.target.closest('[data-chatedit]');
    if (editBtn) {
      const m = chatMessages.find(x => x.id === editBtn.dataset.chatedit);
      if (!m) return;
      chatEditingMessageId = m.id;
      chatReplyToId = null;
      $('#chat-reply-preview').classList.add('hidden');
      $('#chat-compose-body').value = m.body || '';
      updateChatComposeCounter();
      $('#chat-compose-body').focus();
      return;
    }
    const delBtn = e.target.closest('[data-chatdelete]');
    if (delBtn) {
      if (!confirm('Eliminare questo messaggio? Il testo sparirà, la riga resta per non rompere le risposte.')) return;
      try { await deleteChatMessage(delBtn.dataset.chatdelete); await loadChatMessagesPage(false); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    const reportBtn = e.target.closest('[data-chatreport]');
    if (reportBtn) {
      const reason = prompt('Perché segnali questo messaggio?');
      if (reason === null) return;
      try { await reportChatMessage(reportBtn.dataset.chatreport, chatModalCampaignId, reason); toast('Segnalazione inviata'); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    const blockBtn = e.target.closest('[data-chatblock]');
    if (blockBtn) {
      if (!confirm('Bloccare questo utente in questa storia? Non vedrai più i suoi messaggi qui.')) return;
      try { await blockChatUser(chatModalCampaignId, blockBtn.dataset.chatblock); chatBlockedUserIds.push(blockBtn.dataset.chatblock); renderChatMessageListDom(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    const unblockBtn = e.target.closest('[data-chatunblock]');
    if (unblockBtn) {
      try {
        await unblockChatUser(chatModalCampaignId, unblockBtn.dataset.chatunblock);
        chatBlockedUserIds = chatBlockedUserIds.filter(id => id !== unblockBtn.dataset.chatunblock);
        renderChatMessageListDom();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });
}
