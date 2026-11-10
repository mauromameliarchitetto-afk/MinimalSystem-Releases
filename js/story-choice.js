/* Scelta di dove giocare (segnalazione dei tester, 14/10/2026): un
   giocatore è entrato nella campagna chiamata come un'avventura invece che
   in quella del suo Narratore, perché l'unico elenco ("Storie pubblicate"
   nella scheda) mostrava solo i nomi. Qui i percorsi sono separati:

   - "Partecipa a una campagna": campagne libere (senza ambientazione),
     ognuna con la sua premessa; "Chiedi di partecipare" in fondo.
   - "Partecipa a un'avventura": le tre avventure del Compendio. La pagina
     dell'avventura (js/library-settings.js) mostra, subito dopo la
     Premessa, le storie scritte dai Narratori per quell'avventura
     (titolo, codice storia, Narratore); ognuna si apre con la sua
     premessa e "Partecipa a questa avventura" in fondo.
   - "Scrivi una storia per un'avventura" (solo Narratori): stesse pagine,
     con "Inizia a narrare" in fondo alla Premessa.

   Il giocatore sceglie poi con quale personaggio partecipare; la
   richiesta è la stessa di sempre (requestJoinCampaign) e resta da
   approvare dal Narratore. */

let storiesBrowserMode = 'avventura';
let storyDetailCurrent = null;

function storySettingTitle(key) {
  return (typeof LIBRARY_SETTINGS !== 'undefined' && LIBRARY_SETTINGS[key] && LIBRARY_SETTINGS[key].title) || key;
}

async function storyChoiceSession() {
  try {
    const session = await currentCloudSession();
    return session && !isGuestUser(session) ? session : null;
  } catch (e) { return null; }
}

/* Il pulsante per i Narratori nella scelta "Come vuoi giocare?" */
async function updatePlayChoiceRole() {
  const btn = $('#onb-play-write');
  if (!btn) return;
  const role = typeof currentAccountRole === 'function' ? await currentAccountRole() : 'player';
  // nascosto anche se il database non ha ancora i campi delle storie
  // (hasStorySchema, js/cloud-account.js): non si potrebbero salvare
  const narrator = role === 'narrator' || role === 'admin';
  btn.classList.toggle('hidden', !(narrator && await hasStorySchema()));
}

function openPlayChoice() {
  updatePlayChoiceRole();
  showView('play-choice');
}

/* ------------------------------------------------- elenco (#view-stories) */

function storySettingCardHtml(key) {
  const s = LIBRARY_SETTINGS[key];
  const solo = window.RMSoloUI && RMSoloUI.storieInfo && RMSoloUI.storieInfo[key];
  const cover = s.cover ? `<img src="${escapeHtml(s.cover)}" alt="" loading="lazy" decoding="async" style="width:100%;max-height:140px;object-fit:cover;border-radius:var(--radius-sm);">` : '';
  return `<div class="story-choice-item" style="display:flex;flex-direction:column;gap:6px;"><button type="button" class="box story-choice-card" data-storysetting="${escapeHtml(key)}" style="text-align:left;width:100%;cursor:pointer;color:inherit;font:inherit;padding:0;">
    <div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:6px;">
      ${cover}
      <strong>${escapeHtml(s.title)}</strong>
      ${solo && solo.avventura ? `<span class="helper-text" style="margin:0;">${escapeHtml(solo.avventura)}</span>` : ''}
      ${s.summary ? `<span class="helper-text" style="margin:0;font-style:italic;">“${escapeHtml(s.summary)}”</span>` : ''}
    </div></button><div class="story-choice-solo" data-soloactions="${escapeHtml(key)}" style="display:flex;gap:8px;flex-wrap:wrap;"></div></div>`;
}

function storyCardHtml(story) {
  const excerpt = story.premise_text ? story.premise_text.slice(0, 160) + (story.premise_text.length > 160 ? '…' : '') : '';
  return `<button type="button" class="box story-choice-card" data-storyid="${escapeHtml(story.id)}" style="text-align:left;width:100%;cursor:pointer;color:inherit;font:inherit;padding:0;">
    <div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:4px;">
      <strong>${escapeHtml(story.name)}</strong>
      ${story.story_code ? `<span class="chip" style="align-self:flex-start;">${escapeHtml(story.story_code)}</span>` : ''}
      ${story.narrator_name ? `<span class="helper-text" style="margin:0;">Narratore: ${escapeHtml(story.narrator_name)}</span>` : ''}
      ${excerpt ? `<span class="helper-text" style="margin:0;">${escapeHtml(excerpt)}</span>` : ''}
    </div></button>`;
}

let storiesLastList = [];

/* Sulla carta di ogni storia: «Continua» (solo con una partita in corso) e «Nuova partita» (con la conferma di sostituzione),
   senza entrare nella pagina dell'avventura. Una partita conclusa resta consultabile. */
async function fillSoloCardActions(body) {
  if (!window.RMSoloUI || !RMSoloUI.slotInfo) return;
  for (const box of body.querySelectorAll('[data-soloactions]')) {
    const key = box.dataset.soloactions;
    let info = null;
    try { info = await RMSoloUI.slotInfo(key); } catch (e) { info = null; }
    if (!info || !info.disponibile || !box.isConnected) continue;
    const b = [];
    if (info.stato === 'attiva') b.push('<button type="button" class="btn btn-primary btn-sm" data-soloact="continua">Continua</button>');
    if (info.stato === 'conclusa') b.push('<button type="button" class="btn btn-ghost btn-sm" data-soloact="consulta">Consulta la partita</button>');
    if (info.nuova !== false) b.push('<button type="button" class="btn btn-ghost btn-sm" data-soloact="nuova">Nuova partita</button>');
    box.innerHTML = b.join('');
  }
}

async function openStoriesBrowser(mode) {
  storiesBrowserMode = mode;
  const title = $('#stories-title');
  const body = $('#stories-body');
  if (!body) return;
  if (mode === 'campagna') {
    if (title) title.textContent = 'Partecipa a una campagna';
    body.innerHTML = '<p class="helper-text">Caricamento…</p>';
    showView('stories');
    await renderFreeCampaignList(body);
    return;
  }
  if (title) title.textContent = mode === 'narra' ? 'Scrivi una storia' : 'Partecipa a un\'avventura';
  const intro = mode === 'narra'
    ? 'Scegli l\'avventura per cui scrivere la tua storia: leggi la premessa, poi in fondo trovi "Inizia a narrare".'
    : 'Scegli un\'avventura e leggi la premessa: in fondo trovi le storie dei Narratori a cui puoi partecipare.';
  body.innerHTML = `<p class="helper-text">${intro}</p><div style="display:flex;flex-direction:column;gap:10px;">${Object.keys(LIBRARY_SETTINGS).map(storySettingCardHtml).join('')}</div>`;
  showView('stories');
  if (mode === 'avventura') fillSoloCardActions(body);
}

async function renderFreeCampaignList(body) {
  const createBtn = '<button type="button" class="btn btn-ghost btn-sm" id="stories-create-char" style="align-self:flex-start;">Crea un personaggio</button>';
  const session = await storyChoiceSession();
  if (!session) {
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">
      <p class="helper-text" style="margin:0;">Per vedere le campagne dei Narratori serve un account: accedi dalla Home o da Account.</p>
      ${createBtn}</div>`;
    return;
  }
  let list = [];
  try { list = await listPublishedStories(); }
  catch (e) { body.innerHTML = `<p class="helper-text">Errore: ${escapeHtml(describeError(e))}</p>${createBtn}`; return; }
  storiesLastList = list;
  const free = list.filter(s => !s.setting_key);
  body.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;">
    <p class="helper-text" style="margin:0;">Le campagne che i Narratori hanno reso visibili. Aprine una per leggere la premessa e chiedere di partecipare con un tuo personaggio.</p>
    ${free.length ? free.map(storyCardHtml).join('') : '<p class="empty-state">Nessuna campagna visibile al momento.</p>'}
    ${createBtn}</div>`;
}

/* ------------------------- storie dei Narratori nella pagina dell'avventura */

/* Chiamata da openLibrarySettingPage: il blocco segue la sezione
   "Premessa", così le scelte arrivano "in fondo alla premessa". */
let settingStoriesRun = 0;
async function renderSettingStoriesBlock(key) {
  const run = ++settingStoriesRun;
  const box = $('#library-setting-stories');
  if (!box) return;
  const role = typeof currentAccountRole === 'function' ? await currentAccountRole() : 'player';
  const session = await storyChoiceSession();
  let stories = [];
  let error = '';
  if (session) {
    try { stories = (await listPublishedStories()).filter(s => s.setting_key === key); }
    catch (e) { error = describeError(e); }
  }
  const canNarrate = (role === 'narrator' || role === 'admin') && await hasStorySchema();
  if (run !== settingStoriesRun || !$('#library-setting-stories') || box.dataset.setting !== key) return;
  storiesLastList = stories;
  const title = storySettingTitle(key);
  let list;
  if (!session) list = '<p class="helper-text" style="margin:0;">Accedi con un account per vedere le storie dei Narratori e partecipare.</p>';
  else if (error) list = `<p class="helper-text" style="margin:0;">Errore: ${escapeHtml(error)}</p>`;
  else if (!stories.length) list = `<p class="helper-text" style="margin:0;">Nessun Narratore ha ancora aperto una storia per ${escapeHtml(title)}.</p>`;
  else list = stories.map(storyCardHtml).join('');
  box.innerHTML = `<div class="box" style="margin-top:14px;"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:8px;">
    <strong>Gioca con un gruppo</strong>
    <p class="helper-text" style="margin:0;">Le storie scritte dai Narratori per ${escapeHtml(title)}. Aprine una per leggere la sua premessa e partecipare.</p>
    ${list}
    ${canNarrate ? '<button type="button" class="btn btn-primary btn-sm" data-settingnarrate style="align-self:flex-start;">Inizia a narrare</button>' : ''}
  </div></div>`;
}

/* ------------------------------------------------ dettaglio (#view-storydetail) */

function storyDetailHtml(story) {
  const isAdventure = !!story.setting_key;
  const premise = story.premise_text
    ? `<p style="margin:6px 0 0;white-space:pre-wrap;">${escapeHtml(story.premise_text)}</p>`
    : '<p class="helper-text" style="margin:6px 0 0;">Il Narratore non ha ancora scritto una premessa.</p>';
  return `
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${isAdventure ? `<span class="helper-text" style="margin:0;">Avventura: <strong>${escapeHtml(storySettingTitle(story.setting_key))}</strong></span>` : '<span class="helper-text" style="margin:0;">Campagna</span>'}
      ${story.story_code ? `<span class="helper-text" style="margin:0;">Codice storia: <strong>${escapeHtml(story.story_code)}</strong></span>` : ''}
      ${story.narrator_name ? `<span class="helper-text" style="margin:0;">Narratore: <strong>${escapeHtml(story.narrator_name)}</strong></span>` : ''}
    </div>
    <section class="setting-section"><div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>Premessa</div>${premise}</section>
    <div id="story-join-box" style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">
      <button type="button" class="btn btn-primary" id="story-join-btn">${isAdventure ? 'Partecipa a questa avventura' : 'Chiedi di partecipare'}</button>
    </div>`;
}

function openStoryDetail(story) {
  storyDetailCurrent = story;
  const title = $('#story-title');
  if (title) title.textContent = story.name;
  const body = $('#story-body');
  if (body) body.innerHTML = storyDetailHtml(story);
  showView('storydetail');
}

/* Personaggi con cui si può chiedere di entrare: propri, completati, non
   già in una storia né con una richiesta in attesa. */
function storyEligibleCharacters(myUid) {
  return (characters || []).filter(c => c.creationCompleted && !c.cloudCampaignId && !c.cloudJoinRequestId
    && !c.narratorEditGuest && (!c.ownerAccountId || !myUid || c.ownerAccountId === myUid));
}

async function renderStoryJoinPicker() {
  const box = $('#story-join-box');
  if (!box || !storyDetailCurrent) return;
  const session = await storyChoiceSession();
  if (!session) { box.innerHTML = '<p class="helper-text" style="margin:0;">Per partecipare serve un account: accedi dalla Home o da Account.</p>'; return; }
  const eligible = storyEligibleCharacters(session.user.id);
  box.innerHTML = `
    <strong>Con quale personaggio?</strong>
    ${eligible.length
      ? eligible.map(c => `<button type="button" class="btn btn-ghost btn-sm" data-storyjoinchar="${escapeHtml(c.id)}" style="align-self:flex-start;">${escapeHtml(c.nome || 'Senza nome')} (Lv ${escapeHtml(String(c.livello || 1))})</button>`).join('')
      : '<p class="helper-text" style="margin:0;">Non hai personaggi liberi: creane uno, poi torna qui (o chiedi di entrare dalla sua scheda, riquadro "Storia in cloud").</p>'}
    <button type="button" class="btn btn-ghost btn-sm" id="story-join-newchar" style="align-self:flex-start;">Crea un nuovo personaggio</button>`;
}

async function joinStoryWithCharacter(charId) {
  const story = storyDetailCurrent;
  const c = (characters || []).find(x => x.id === charId);
  if (!story || !c) return;
  if (!(await ensureUgcTermsAccepted())) return;
  try {
    if (!c.cloudCharacterId) await pushCharacterToCloud(c);
    const label = story.story_code ? `${story.name} — ${story.story_code}` : story.name;
    await requestJoinCampaign(c, story.id, label);
    saveAll();
    toast('Richiesta inviata: in attesa di conferma del Narratore');
    openCharacter(c.id);
  } catch (err) { toast('Errore: ' + describeError(err)); }
}

document.addEventListener('click', async e => {
  const soloBtn = e.target.closest('#stories-body [data-soloact]');
  if (soloBtn) {
    const key = soloBtn.closest('[data-soloactions]').dataset.soloactions, act = soloBtn.dataset.soloact;
    if (!window.RMSoloUI) return;
    if (act === 'nuova') await RMSoloUI.nuovaPartita(key, { origine: key });
    else await RMSoloUI.playStory(key, { origine: key, azione: act === 'consulta' ? 'consulta' : null });
    return;
  }
  const settingCard = e.target.closest('#stories-body [data-storysetting]');
  if (settingCard) { openLibrarySettingPage(settingCard.dataset.storysetting); return; }
  const storyCard = e.target.closest('#stories-body [data-storyid], #library-setting-stories [data-storyid]');
  if (storyCard) {
    const story = storiesLastList.find(s => s.id === storyCard.dataset.storyid);
    if (story) openStoryDetail(story);
    return;
  }
  if (e.target.closest('#library-setting-stories [data-settingnarrate]')) {
    const key = $('#library-setting-stories').dataset.setting;
    if (typeof openCreateCampaignForSetting === 'function') openCreateCampaignForSetting(key);
    return;
  }
  if (e.target.closest('#stories-create-char') || e.target.closest('#story-join-newchar')) { createCharacterFlow(); return; }
  if (e.target.closest('#story-join-btn')) { renderStoryJoinPicker(); return; }
  const pick = e.target.closest('[data-storyjoinchar]');
  if (pick) { joinStoryWithCharacter(pick.dataset.storyjoinchar); return; }
});
