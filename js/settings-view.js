/* Pagina "Impostazioni" (integrazione FASE FINALE, richiesta esplicita
   dell'utente): riunisce le preferenze già esistenti sparse nell'app in
   sei sezioni, più le nuove preferenze reali introdotte da FC7 (notifiche
   push, silenziamento chat per storia). Principio guida dato dall'utente:
   "ogni comando deve agire su una funzione effettiva" — nessun interruttore
   qui controlla qualcosa che non esiste davvero nel prodotto.

   Cosa NON è incluso, e perché (nessuna delle sei sezioni proposte è
   costruita per intero se il resto non esiste ancora):
   - Tema chiaro/scuro/di sistema, dimensione del testo: non esistono
     (l'app è sempre a tema scuro tranne #view-combat, fisso; il foglio di
     stile usa px non rem — stesso motivo già documentato per
     accessibilityPrefsHtml in js/cloud-account.js). Costruirli davvero
     richiederebbe un sistema di temi e una conversione tipografica
     completa: fuori scope per questa sotto-fase, non finto qui.
   - Audio e animazioni (volume effetti, audio/riproduzione automatica
     dell'introduzione): nessun sistema audio/SFX esiste nel prodotto,
     l'introduzione usa sessionStorage solo per "già vista in questa
     sessione", non una preferenza utente disattivabile. "Effetti animati
     delle pedine" è già coperto dalla stessa preferenza "Riduci le
     animazioni" qui sotto (css/style.css, .a11y-reduce-motion), non un
     interruttore separato.
   - Chi può scrivermi privatamente / messaggi diretti: non esistono
     (l'unica chat del prodotto è quella di campagna, FC6 — nessun
     messaggio privato 1:1).
   - Mostra nomi pedine / visibilità griglia / centra mappa sul turno:
     nessuna di queste preferenze esiste nel tabellone di combattimento.
   - Avviso del proprio turno (notifica push separata dai messaggi): FC7
     copre solo le notifiche della chat di campagna; un sistema di push
     per il turno di combattimento è una funzione a sé, non ancora
     costruita — nessun interruttore finto qui.
   - "Apri le impostazioni di sistema" per le notifiche: nessuna API reale
     lo permette da Capacitor senza un plugin nativo dedicato (verificato:
     @capacitor/app 7.x non la espone) — mostrate solo istruzioni testuali,
     mai un bottone che non fa nulla. */

/* ---------------------------------------------------- Aspetto e accessibilità
   Riusa integralmente getReduceMotionPref/setReduceMotionPref/
   applyAccessibilityPreferences (js/app.js, S20) — stessa chiave
   localStorage, stesso effetto reale già in uso in Account: qui è un
   secondo punto d'accesso alla STESSA preferenza, non una copia. */
function settingsAppearanceHtml() {
  const reduceMotion = (typeof getReduceMotionPref === 'function') ? getReduceMotionPref() : false;
  return `
    <label class="row-between" style="cursor:pointer;">
      <span class="helper-text" style="margin:0;">Riduci le animazioni</span>
      <input type="checkbox" id="settings-reduce-motion" ${reduceMotion ? 'checked' : ''}>
    </label>
    <p class="helper-text" style="margin:8px 0 0;">Vale su questo dispositivo, in aggiunta all'impostazione del tuo sistema operativo (sempre rispettata). Controlla anche il glow e la pulsazione delle pedine in combattimento (turno, Boost), non solo le transizioni dell'interfaccia.</p>
    <p class="helper-text" style="margin:8px 0 0;">Il tema chiaro/scuro e la dimensione del testo non sono ancora personalizzabili in questa versione.</p>
  `;
}

/* --------------------------------------------------------------- Notifiche
   push_enabled/show_preview: rm_push_prefs (FC7, nuova). Lo stato del
   permesso di SISTEMA è letto per davvero (checkPushSystemPermission,
   js/push-notifications.js) — l'interruttore in app non può sostituirlo,
   solo rifletterlo e proporre di attivarlo. Il link "Notifiche e
   attività" riusa la vista già costruita in S19 (elenco/silenziamento
   per tipo), mai un secondo elenco duplicato qui. */
async function settingsNotificationsHtml() {
  let prefs = { push_enabled: true, show_preview: false };
  try { prefs = await getPushPrefs(); } catch (e) { /* onesto: sezione con stato non verificato, mai finto */ }
  const isNative = (typeof isNativeAndroidPlatform === 'function') && isNativeAndroidPlatform();
  let systemPerm = 'unsupported';
  if (isNative) { try { systemPerm = await checkPushSystemPermission(); } catch (e) { /* resta 'unsupported' */ } }
  // Bug reale trovato in test su dispositivo (2026-09-12): la preferenza
  // rm_push_prefs.push_enabled è true di default, quindi la spunta sopra
  // arriva già segnata per un utente che non l'ha mai toccata — nessun
  // evento "change" scatta mai, quindi enablePushNotifications() (che
  // chiede il permesso di sistema e registra il token) non veniva mai
  // invocata: la spunta appariva attiva ma nessun token risultava mai in
  // rm_push_tokens. Il testo precedente ("il sistema chiederà il permesso
  // quando attivi le notifiche qui sotto") non aveva quindi alcuna azione
  // reale da compiere. Ora un pulsante esplicito, indipendente dallo stato
  // della spunta, richiama sempre enablePushNotifications() per davvero.
  const systemLine = !isNative
    ? '<p class="helper-text" style="margin:8px 0 0;">Le notifiche push sono disponibili solo nell\'app Android: su questo dispositivo restano visibili solo nell\'app.</p>'
    : systemPerm === 'granted'
      ? '<p class="helper-text" style="margin:8px 0 0;">🟢 Notifiche consentite dal sistema Android.</p>'
      : systemPerm === 'denied'
        ? '<p class="helper-text" style="margin:8px 0 0;color:var(--fisico-forte);">🔴 Notifiche bloccate dal sistema Android. Per riceverle: Impostazioni del telefono → App → Role Makers System → Notifiche → Consenti.</p>'
        : `<p class="helper-text" style="margin:8px 0 0;">Il sistema non ha ancora concesso il permesso di notifica.</p>
           <button type="button" id="settings-push-request-permission" class="btn" style="margin-top:6px;">Attiva ora</button>`;
  return `
    <label class="row-between" style="cursor:pointer;">
      <span class="helper-text" style="margin:0;">Notifiche push (nuovi messaggi in chat)</span>
      <input type="checkbox" id="settings-push-enabled" ${prefs.push_enabled ? 'checked' : ''} ${isNative ? '' : 'disabled'}>
    </label>
    <label class="row-between" style="cursor:pointer;margin-top:8px;">
      <span class="helper-text" style="margin:0;">Anteprima del messaggio nella notifica</span>
      <input type="checkbox" id="settings-push-preview" ${prefs.show_preview ? 'checked' : ''} ${isNative ? '' : 'disabled'}>
    </label>
    <p class="helper-text" style="margin:8px 0 0;">Se disattivata, la notifica mostra solo "Nuovo messaggio", mai il testo — utile su un dispositivo condiviso.</p>
    ${systemLine}
    <div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>Notifiche e attività</div>
    <button type="button" class="row-between" id="settings-open-notifications" style="cursor:pointer;background:transparent;border:none;width:100%;padding:0;text-align:left;">
      <span class="helper-text" style="margin:0;">Richieste ed eventi delle tue storie, e i tipi da silenziare</span>
      <span aria-hidden="true">›</span>
    </button>
  `;
}

/* -------------------------------------------------------------------- Chat
   Silenziamento per storia (rm_chat_notify_prefs, FC7) + elenco utenti
   bloccati per storia (rm_chat_blocks, FC6 — qui solo aggregato in
   un'unica vista, mai una seconda tabella: gli stessi dati già scritti
   dai bottoni "Blocca"/"Sblocca" dentro il modale chat). */
async function listMyMemberCampaigns() {
  const session = await currentCloudSession();
  if (!session || isGuestUser(session)) return [];
  const { data: memberships, error: memErr } = await withTimeout(
    sb.from('campaign_members').select('campaign_id').eq('user_id', session.user.id), 'Le tue storie'
  );
  if (memErr) throw memErr;
  const ids = [...new Set((memberships || []).map(m => m.campaign_id))];
  if (!ids.length) return [];
  const { data: campaigns, error: campErr } = await withTimeout(
    sb.from('campaigns').select('id, name').in('id', ids).is('deleted_at', null), 'Le tue storie'
  );
  if (campErr) throw campErr;
  return campaigns || [];
}

async function listMyChatBlocks() {
  const session = await currentCloudSession();
  if (!session || isGuestUser(session)) return [];
  const { data, error } = await withTimeout(
    sb.from('rm_chat_blocks').select('campaign_id, blocked_user_id').eq('blocker_user_id', session.user.id),
    'Utenti bloccati'
  );
  if (error) throw error;
  return data || [];
}

function chatNotifyModeOptionsHtml(campaignId, currentMode) {
  const options = [['all', 'Tutti i messaggi'], ['mentions', 'Solo menzioni'], ['muted', 'Silenziata']];
  return `<select data-settingschatmode="${campaignId}">
    ${options.map(([v, label]) => `<option value="${v}" ${currentMode === v ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
  </select>`;
}

async function settingsChatHtml() {
  let campaigns = [];
  let notifyPrefs = {};
  let blocks = [];
  try {
    [campaigns, notifyPrefs] = await Promise.all([listMyMemberCampaigns(), getChatNotifyPrefs()]);
  } catch (e) {
    return `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">Errore nel caricare le preferenze chat: ${escapeHtml(describeError(e))}</p>`;
  }
  try {
    blocks = await listMyChatBlocks();
  } catch (e) { /* la lista blocchi non è essenziale per il resto della sezione */ }

  const campaignsHtml = campaigns.length
    ? campaigns.map(c => `<div class="row-between" style="margin-bottom:6px;">
        <span class="helper-text" style="margin:0;">${escapeHtml(c.name || 'Storia')}</span>
        ${chatNotifyModeOptionsHtml(c.id, notifyPrefs[c.id] || 'all')}
      </div>`).join('')
    : '<p class="helper-text" style="margin:0;">Non fai ancora parte di nessuna storia con una chat attiva.</p>';

  let blockedNames = {};
  let campaignNames = {};
  if (blocks.length) {
    try { blockedNames = await fetchDisplayNames(blocks.map(b => b.blocked_user_id)); } catch (e) { /* nomi mancanti ricadono su un'etichetta generica */ }
    campaigns.forEach(c => { campaignNames[c.id] = c.name; });
  }
  const blockedHtml = blocks.length
    ? blocks.map(b => `<div class="row-between" style="margin-bottom:6px;">
        <span class="helper-text" style="margin:0;">${escapeHtml(blockedNames[b.blocked_user_id] || 'Utente')} — ${escapeHtml(campaignNames[b.campaign_id] || 'una storia')}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-settingsunblock="${b.campaign_id}|${b.blocked_user_id}">Sblocca</button>
      </div>`).join('')
    : '<p class="helper-text" style="margin:0;">Nessun utente bloccato.</p>';

  return `
    <p class="helper-text" style="margin:0 0 8px;">Per ogni storia a cui partecipi, scegli quali messaggi della sua chat ti avvisano.</p>
    ${campaignsHtml}
    <div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>Utenti bloccati</div>
    <p class="helper-text" style="margin:0 0 8px;">Il blocco vale per storia (lo stesso utente può scriverti in una storia diversa). Si blocca da un messaggio nella chat stessa.</p>
    ${blockedHtml}
  `;
}

/* ------------------------------------------------------- Mappa e combattimento
   Riusa integralmente combatWakeLockPreferred/combatWakeLockSetPreferred/
   combatWakeLockSupported (js/app.js) — stessa chiave localStorage già
   usata dal controllo dentro il tabellone: secondo punto d'accesso alla
   stessa preferenza, non una copia. */
function settingsMapCombatHtml() {
  const supported = (typeof combatWakeLockSupported === 'function') && combatWakeLockSupported();
  const preferred = (typeof combatWakeLockPreferred === 'function') && combatWakeLockPreferred();
  return `
    <label class="row-between" style="cursor:pointer;">
      <span class="helper-text" style="margin:0;">Mantieni lo schermo acceso durante il combattimento</span>
      <input type="checkbox" id="settings-combat-wakelock" ${preferred ? 'checked' : ''} ${supported ? '' : 'disabled'}>
    </label>
    <p class="helper-text" style="margin:8px 0 0;">${supported ? 'Vale su questo dispositivo, solo mentre il tabellone di combattimento è aperto.' : 'Il tuo browser non supporta questa funzione (Wake Lock API non disponibile).'}</p>
    <p class="helper-text" style="margin:8px 0 0;">Nomi delle pedine, visibilità della griglia e centratura automatica sul turno non sono ancora personalizzabili in questa versione.</p>
  `;
}

/* ------------------------------------------------------ Account, dati e assistenza
   Solo collegamenti a sezioni già esistenti in Account (S20/S18/export/
   cancellazione), mai un secondo modulo che duplica quei controlli. */
function settingsAccountLinksHtml() {
  const items = [
    ['plans', 'Piani e abbonamento'],
    ['account', 'Profilo, esportazione dati, assistenza, privacy e termini'],
  ];
  return items.map(([target, label]) => `
    <button type="button" class="row-between" data-settingsgoto="${target}" style="cursor:pointer;background:transparent;border:none;width:100%;padding:8px 0;text-align:left;border-bottom:1px solid var(--bordo-scuro);">
      <span class="helper-text" style="margin:0;">${escapeHtml(label)}</span>
      <span aria-hidden="true">›</span>
    </button>`).join('');
}

/* ----------------------------------------------------------------- rendering */

function settingsSectionHtml(title, bodyHtml) {
  return `<div class="section-title" style="margin-top:16px;"><span class="dot neutral"></span>${escapeHtml(title)}</div>
    <div class="box"><div class="box-bar"></div><div class="box-pad">${bodyHtml}</div></div>`;
}

async function renderSettingsView() {
  const root = $('#settings-body');
  if (!root) return;
  root.innerHTML = '<p class="helper-text" style="margin:0;">Verifica in corso…</p>';
  const [appearance, notifications, chat] = await Promise.all([
    Promise.resolve(settingsAppearanceHtml()),
    settingsNotificationsHtml().catch(e => `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">Errore: ${escapeHtml(describeError(e))}</p>`),
    settingsChatHtml(),
  ]);
  root.innerHTML = [
    settingsSectionHtml('Aspetto e accessibilità', appearance),
    settingsSectionHtml('Notifiche', notifications),
    settingsSectionHtml('Chat', chat),
    settingsSectionHtml('Mappa e combattimento', settingsMapCombatHtml()),
    settingsSectionHtml('Account, dati e assistenza', settingsAccountLinksHtml()),
  ].join('');
}

function wireSettingsEvents() {
  const root = $('#settings-body');
  if (!root) return;

  root.addEventListener('change', async e => {
    if (e.target.id === 'settings-reduce-motion') {
      setReduceMotionPref(e.target.checked);
      return;
    }
    if (e.target.id === 'settings-combat-wakelock') {
      combatWakeLockSetPreferred(e.target.checked);
      return;
    }
    if (e.target.id === 'settings-push-enabled') {
      const checked = e.target.checked;
      try {
        if (checked) await enablePushNotifications();
        else await disablePushNotifications();
      } catch (err) {
        e.target.checked = !checked;
        toast('Errore: ' + describeError(err));
      }
      return;
    }
    if (e.target.id === 'settings-push-preview') {
      const checked = e.target.checked;
      try {
        const prefs = await getPushPrefs();
        await setPushPrefs(prefs.push_enabled, checked);
      } catch (err) {
        e.target.checked = !checked;
        toast('Errore: ' + describeError(err));
      }
      return;
    }
    const modeSelect = e.target.closest('[data-settingschatmode]');
    if (modeSelect) {
      try { await setChatNotifyPref(modeSelect.dataset.settingschatmode, modeSelect.value); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });

  root.addEventListener('click', async e => {
    const gotoBtn = e.target.closest('[data-settingsgoto]');
    if (gotoBtn) { goToMenuTarget(gotoBtn.dataset.settingsgoto); return; }
    if (e.target.closest('#settings-open-notifications')) { goToMenuTarget('notifications'); return; }
    if (e.target.closest('#settings-push-request-permission')) {
      try { await enablePushNotifications(); await renderSettingsView(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    const unblockBtn = e.target.closest('[data-settingsunblock]');
    if (unblockBtn) {
      const [campaignId, blockedUserId] = unblockBtn.dataset.settingsunblock.split('|');
      try { await unblockChatUser(campaignId, blockedUserId); await renderSettingsView(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });
}
