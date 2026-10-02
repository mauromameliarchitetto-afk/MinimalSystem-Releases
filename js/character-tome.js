/* ==========================================================================
   Role Makers — Tomo dei Personaggi (character_tome_v1)
   Selettore visuale a carosello per "I tuoi personaggi", checkpoint T1.1
   (revisione grafica del checkpoint T1). Nuova vista (#view-tome), attiva
   SOLO dietro il feature flag character_tome_v1 (vedi js/feature-flags.js
   e goToMenuTarget in app.js): a flag spento il target 'charlist' continua
   a portare a #view-list esattamente come oggi, questo file non cambia
   nulla in produzione.

   Riusa solo dati e funzioni reali già esistenti (characters,
   visibleCharacters, BUILDS, PRIMARY_STATS, TERTIARY_STATS, openCharacter,
   openCreationWizard, escapeHtml, axisClass, portraitPosCss,
   createCharacterFlow, showView, $/$$ — tutte dichiarate a livello di
   script in app.js/data.js, quindi visibili qui perché questo file è
   caricato DOPO, come script classico non-module). Non tocca mai
   #view-sheet, renderSheet(), né lo storage dei personaggi: è un
   visualizzatore, mai una seconda fonte di verità dei dati. L'apertura di
   una card passa da tomeOpenCharacter(id) — stesso instradamento del
   vecchio elenco: bozza (creationCompleted=false) riprende il wizard,
   altrimenti apre la scheda via openCharacter(id), mai una copia.
   ========================================================================== */

/* Icone equipaggiamento (T1.1): inline, stessa tecnica del resto dell'app
   (viewBox 24x24, stroke:currentColor via CSS). Le 10 icone statistica
   sono invece quelle del pacchetto consegnato per il checkpoint T1.2 (vedi
   sotto, sprite in index.html + TOME_STAT_ICON_MAP) — queste 3 restano
   perché l'equipaggiamento non era nel pacchetto/nella mappatura ricevuta. */
var TOME_ICONS = {
  arma: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6"/><path d="M14 4l2 2M4 14l2 2"/><circle cx="6" cy="18" r="1.4" class="tome-icon-pip"/></svg>',
  scudo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>',
  armatura: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4l4 2 4-2 2 3-2 2v9a2 2 0 01-2 2h-4a2 2 0 01-2-2v-9L6 7l2-3z"/></svg>'
};

/* Icone statistica (checkpoint T1.2): sprite <symbol> consegnato in
   index.html (assets/masters/rolemakers-tome-icons-v1/, sorgente e
   licenza lì) + famiglia cromatica (classi .tome-stat--* in
   css/stat-icon-tokens.css). Mappatura 1:1 sulle chiavi REALI di
   PRIMARY_STATS/TERTIARY_STATS (js/data.js) — non sui nomi del pacchetto
   dove differivano: il pacchetto etichetta gli slot di 'fmen'/'dmen' come
   "Forza Mentale"/"Difesa Mentale", ma nel codice reale sono "Forza
   Magica"/"Difesa Magica" (F.MEN/D.MEN, vedi PRIMARY_STATS). Riuso la
   forma/colore dell'icona per quello slot, ma il nome mostrato resta
   quello vero del gioco — mai una sigla o un termine non verificato nel
   codice (vedi anche T1.1: TERTIARY_STATS non ha sigle proprie, restano
   per esteso "Stile"/"Fortuna"/"Carisma"). */
var TOME_STAT_ICON_MAP = {
  for: { symbol: 'rm-stat-forza', family: 'offense' },
  dex: { symbol: 'rm-stat-destrezza', family: 'offense' },
  dif: { symbol: 'rm-stat-difesa', family: 'defense' },
  dmen: { symbol: 'rm-stat-difesa-mentale', family: 'defense' },
  mira: { symbol: 'rm-stat-mira', family: 'action' },
  vel: { symbol: 'rm-stat-velocita', family: 'action' },
  fmen: { symbol: 'rm-stat-forza-mentale', family: 'mental' },
  fortuna: { symbol: 'rm-stat-fortuna', family: 'identity' },
  stile: { symbol: 'rm-stat-stile', family: 'identity' },
  carisma: { symbol: 'rm-stat-carisma', family: 'identity' }
};

/* Statistiche mostrate nella griglia del pannello: le 7 primarie reali
   (PRIMARY_STATS meno HP/MP, già mostrate come risorse sopra) più le 3
   terziarie reali (TERTIARY_STATS: Stile, Fortuna, Carisma). Verificate nel
   codice — js/data.js — nessuna sigla inventata: PRIMARY_STATS usa 'FRZ'
   come etichetta della Forza (chiave 'for', per non confondersi con
   Fortuna, statistica terziaria a sé), TERTIARY_STATS non ha sigle proprie
   nel codice (viene mostrata con l'etichetta per esteso "Stile"/"Fortuna"/
   "Carisma" anche nella scheda reale, vedi renderTertiaryStats in app.js) —
   qui restano quindi per esteso, non abbreviate a 3 lettere di fantasia. */
function tomeStatDefs() {
  var primary = PRIMARY_STATS.filter(function (s) { return s.key !== 'hp' && s.key !== 'mp'; })
    .map(function (s) { return { key: s.key, label: s.label, full: s.full, source: 'primary', icon: TOME_STAT_ICON_MAP[s.key] }; });
  var tertiary = TERTIARY_STATS.map(function (s) { return { key: s.key, label: s.label, full: s.label, source: 'tertiary', icon: TOME_STAT_ICON_MAP[s.key] }; });
  return primary.concat(tertiary);
}

function tomeStatValue(c, def) {
  if (def.source === 'tertiary') return (c.tertiary && c.tertiary[def.key] != null) ? c.tertiary[def.key] : 0;
  return (c.primary && c.primary[def.key] != null) ? c.primary[def.key] : 0;
}

/* Calcolo risorse in sola lettura: MAI una scrittura su c.hpMaxTracked ecc.
   (quello resta un side-effect esclusivo di updateDerived/renderSheet). Se
   il personaggio non ha ancora aperto la scheda una volta (hpMaxTracked
   ancora null, es. bozza appena creata dal wizard), si ricava lo stesso
   valore che la scheda mostrerebbe al primo render, senza persisterlo. */
function tomeComputeResources(c) {
  var build = BUILDS[c.build] || BUILDS.guerriero;
  var hpMult = (typeof currentHpMult === 'function') ? currentHpMult(c) : (build.hpMult || build.hpMultOptions[0] || 1);
  var mpMult = (typeof currentMpMult === 'function') ? currentMpMult(c) : (build.mpMult || build.mpMultOptions[0] || 1);
  var hpBase = Number((c.primary && c.primary.hp) || 0);
  var mpBase = Number((c.primary && c.primary.mp) || 0);
  var hpMax = (c.hpMaxTracked != null) ? c.hpMaxTracked : hpBase * hpMult;
  var mpMax = (c.mpMaxTracked != null) ? c.mpMaxTracked : mpBase * mpMult;
  var prMax = (c.prMaxTracked != null) ? c.prMaxTracked : (build.prIniziali || 0);
  var ppMax = hpMax / 2 + mpMax / 2;
  var hpCur = (c.hpCur != null) ? c.hpCur : hpMax;
  var mpCur = (c.mpCur != null) ? c.mpCur : mpMax;
  var prCur = (c.prCur != null) ? c.prCur : prMax;
  var ppCur = (c.ppCur != null) ? c.ppCur : ppMax;
  return {
    hp: { cur: Math.round(hpCur), max: Math.round(hpMax) },
    mp: { cur: Math.round(mpCur), max: Math.round(mpMax) },
    pp: { cur: Math.round(ppCur), max: Math.round(ppMax) },
    pr: { cur: Math.round(prCur), max: Math.round(prMax) }
  };
}

/* "Stato del personaggio" reale (checkpoint G0: l'unico stato scritto dal
   codice per un personaggio giocante è creationCompleted → Bozza/Attiva;
   'ritirata' esiste nello schema server ma non risulta mai impostato da
   nessun flusso — non lo si inventa qui). */
function tomeStatusInfo(c) {
  if (!c.creationCompleted) return { label: 'Bozza', cls: 'tome-status-draft' };
  return { label: 'Attiva', cls: 'tome-status-active' };
}

/* Fallback ritratto mancante (T1.1, punto 9): mai un rettangolo piatto con
   la sola iniziale. Gradiente contenuto nei due toni reali dell'asse del
   build (stessi usati per fisico/magico/bicolore in tutta l'app, vedi
   .avatar.physical/.magic/.bicolor in css/style.css) + un pattern a righe
   diagonali molto leggero (motivo geometrico astratto, non un'immagine
   generata, coerente con l'assenza di decorazioni fantasy) + monogramma su
   un piccolo cerchio di contrasto invece del testo nudo sopra il colore. */
var TOME_AXIS_GRADIENTS = {
  physical: ['#3a2013', '#5a2c14'],
  magic: ['#0f2e33', '#123f47'],
  bicolor: ['#2c1f14', '#123138']
};
function tomePortraitFallbackHtml(axis, initial) {
  var colors = TOME_AXIS_GRADIENTS[axis] || TOME_AXIS_GRADIENTS.physical;
  var style = 'background:linear-gradient(160deg,' + colors[0] + ',' + colors[1] + ');';
  return '<div class="tome-portrait tome-portrait-fallback-wrap ' + axis + '" style="' + style + '">' +
    '<svg class="tome-portrait-pattern" aria-hidden="true" viewBox="0 0 80 80" preserveAspectRatio="none">' +
      '<path d="M-10 10L10 -10M-10 30L30 -10M-10 50L50 -10M-10 70L70 -10M10 90L90 10M30 90L90 30M50 90L90 50M70 90L90 70"/>' +
    '</svg>' +
    '<span class="tome-portrait-monogram">' + escapeHtml(initial) + '</span>' +
  '</div>';
}
/* Ritratto reale (T1.2 punto 2): cornice quadrata/leggermente verticale
   (vedi aspect-ratio:4/5 in css/style.css) a due livelli, mai un singolo
   "cover" che taglierebbe un ritratto verticale — sfondo sfocato/oscurato
   a piena resa (cover) dietro l'immagine intera (contain), come da
   pacchetto consegnato. portraitPosCss riusa la stessa preferenza di
   inquadratura già salvata dalla scheda reale (c.portraitPos), mai una
   nuova. */
function tomePortraitHtml(c) {
  var axis = (typeof axisClass === 'function') ? axisClass(c.build) : 'physical';
  var initial = (c.nome || '?').trim().charAt(0).toUpperCase() || '?';
  if (c.portrait) {
    var pos = portraitPosCss(c.portraitPos);
    var url = 'background-image:url(' + escapeHtml(c.portrait) + ');';
    return '<div class="tome-portrait has-portrait ' + axis + '">' +
      '<div class="tome-portrait-bg" style="' + url + pos + '"></div>' +
      '<div class="tome-portrait-fg" style="' + url + '"></div>' +
    '</div>';
  }
  return tomePortraitFallbackHtml(axis, initial);
}

/* Correzioni mirate (pacchetto v1, punto 6): icona reale (sprite
   rm-res-hp/mp/pp/pr, index.html) accanto alla sigla — mai la sola sigla
   nuda come nel checkpoint T1.2. */
var TOME_RES_ICON = { HP: 'rm-res-hp', MP: 'rm-res-mp', PP: 'rm-res-pp', 'P.R.': 'rm-res-pr' };
function tomeResRow(label, res) {
  var iconId = TOME_RES_ICON[label];
  return '<div class="tome-res"><div class="tome-res-headrow">' +
    (iconId ? '<svg class="tome-res-icon" aria-hidden="true"><use href="#' + iconId + '"></use></svg>' : '') +
    '<span class="tome-res-label">' + escapeHtml(label) + '</span></div>' +
    '<span class="tome-res-val">' + res.cur + '<span class="tome-res-max">/' + res.max + '</span></span></div>';
}

/* T1.2 punti 3/4: icona sprite + sigla nel colore di famiglia (mai
   l'unica informazione: la sigla resta sempre visibile testualmente
   accanto), valore a contrasto neutro. Un solo aria-label per tessera con
   nome completo + valore (le singole parti interne sono aria-hidden per
   non duplicare l'annuncio allo screen reader), title come tooltip
   desktop. */
function tomeStatsGridHtml(c) {
  return tomeStatDefs().map(function (def) {
    var val = tomeStatValue(c, def);
    var icon = def.icon || { symbol: '', family: 'offense' };
    return '<div class="tome-stat" title="' + escapeHtml(def.full) + '" aria-label="' + escapeHtml(def.full) + ': ' + escapeHtml(String(val)) + '">' +
      '<span class="tome-stat-head tome-stat--' + icon.family + '">' +
        '<svg class="tome-stat-icon" aria-hidden="true"><use href="#' + icon.symbol + '"></use></svg>' +
        '<span class="tome-stat-label" aria-hidden="true">' + escapeHtml(def.label) + '</span>' +
      '</span>' +
      '<span class="tome-stat-val" aria-hidden="true">' + escapeHtml(String(val)) + '</span></div>';
  }).join('');
}

/* Sintesi equipaggiamento (T1.1, punto 8): al massimo 3 icone significative
   (arma/scudo/armatura), nessuna emoji, nessuna altezza fissa quando vuoto
   — solo conteggi/presenza da campi realmente esistenti (kind/equipaggiato/
   size/quality su slots/weaponSlots), nessuna statistica derivata
   inventata (niente "peso totale", niente "classe armatura"). */
function tomeEquipSummaryHtml(c) {
  var weapons = (c.weaponSlots || []).filter(function (s) { return s.kind === 'arma' && s.equipaggiato && s.size && s.quality; });
  var shield = (c.weaponSlots || []).find(function (s) { return s.kind === 'scudo' && s.equipaggiato && s.size && s.quality; });
  var armorPieces = (c.slots || []).filter(function (s) { return s.equipaggiato && s.size && s.quality; });
  var parts = [];
  if (weapons.length) parts.push('<span class="tome-equip-chip">' + TOME_ICONS.arma + '<span>' + (weapons.length === 1 ? '1 arma' : weapons.length + ' armi') + '</span></span>');
  if (shield) parts.push('<span class="tome-equip-chip">' + TOME_ICONS.scudo + '<span>Scudo</span></span>');
  if (armorPieces.length) parts.push('<span class="tome-equip-chip">' + TOME_ICONS.armatura + '<span>' + armorPieces.length + '/' + ((c.slots || []).length || 6) + '</span></span>');
  if (!parts.length) return '<span class="tome-equip-empty">— Nessun equipaggiamento</span>';
  return parts.slice(0, 3).join('');
}

function tomeCardHtml(c) {
  var build = BUILDS[c.build] || BUILDS.guerriero;
  var res = tomeComputeResources(c);
  var status = tomeStatusInfo(c);
  return '<article class="tome-card" data-id="' + c.id + '" role="listitem" tabindex="0" aria-label="' + escapeHtml(c.nome || 'Personaggio senza nome') + '">' +
    tomePortraitHtml(c) +
    '<div class="tome-body">' +
      '<div class="tome-name-row">' +
        '<h2 class="tome-name">' + escapeHtml(c.nome || 'Senza nome') + '</h2>' +
        '<span class="tome-status-badge ' + status.cls + '">' + status.label + '</span>' +
      '</div>' +
      '<div class="tome-meta">' + escapeHtml(build.label) + ' · Lv ' + (c.livello || 1) + '</div>' +
      '<div class="tome-resources">' +
        tomeResRow('HP', res.hp) + tomeResRow('MP', res.mp) + tomeResRow('PP', res.pp) + tomeResRow('P.R.', res.pr) +
      '</div>' +
      '<div class="tome-stats-grid">' + tomeStatsGridHtml(c) + '</div>' +
      '<div class="tome-equip">' + tomeEquipSummaryHtml(c) + '</div>' +
    '</div>' +
    '<div class="tome-actions">' +
      '<button type="button" class="btn tome-open-btn" data-open="' + c.id + '">Apri scheda</button>' +
    '</div>' +
  '</article>';
}

var TOME_DOTS_MAX = 8;
var TOME_STATE = { ids: [] };

function renderTomeDots(count) {
  var dotsWrap = $('#tome-dots');
  if (!dotsWrap) return;
  if (count > TOME_DOTS_MAX) {
    dotsWrap.innerHTML = '<span class="tome-counter" id="tome-counter">1 / ' + count + '</span>';
    return;
  }
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<button type="button" class="tome-dot" data-index="' + i + '" aria-label="Vai al personaggio ' + (i + 1) + '"></button>';
  }
  dotsWrap.innerHTML = html;
  $$('.tome-dot', dotsWrap).forEach(function (dot) {
    dot.onclick = function () { scrollTomeToIndex(Number(dot.dataset.index), true); };
  });
}

function updateTomeIndicator(index, count) {
  var dotsWrap = $('#tome-dots');
  if (!dotsWrap) return;
  var counter = $('#tome-counter', dotsWrap);
  if (counter) { counter.textContent = (index + 1) + ' / ' + count; return; }
  $$('.tome-dot', dotsWrap).forEach(function (dot, i) { dot.classList.toggle('active', i === index); });
}

function currentTomeIndex() {
  var track = $('#tome-track');
  if (!track) return 0;
  var cards = $$('.tome-card', track);
  var center = track.scrollLeft + track.clientWidth / 2;
  var best = 0, bestDist = Infinity;
  cards.forEach(function (card, i) {
    var cardCenter = card.offsetLeft + card.offsetWidth / 2;
    var dist = Math.abs(cardCenter - center);
    if (dist < bestDist) { bestDist = dist; best = i; }
  });
  return best;
}

function scrollTomeToIndex(index, smooth) {
  var track = $('#tome-track');
  if (!track) return;
  var cards = $$('.tome-card', track);
  var clamped = Math.max(0, Math.min(index, cards.length - 1));
  var target = cards[clamped];
  if (!target) return;
  track.scrollTo({ left: target.offsetLeft - (track.clientWidth - target.clientWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
}

/* Frecce (T1.1, punto 5): nascoste del tutto (non solo attenuate) quando
   non esiste alcuno spostamento possibile in quella direzione, con un solo
   personaggio, o negli stati vuoto/errore — mai semplicemente disabilitate
   in modo poco chiaro. */
function updateTomeArrowsVisibility(idx, count) {
  var prevBtn = $('#tome-arrow-prev'), nextBtn = $('#tome-arrow-next');
  if (!prevBtn || !nextBtn) return;
  var canMove = count > 1;
  prevBtn.classList.toggle('tome-arrow-hidden', !canMove || idx <= 0);
  nextBtn.classList.toggle('tome-arrow-hidden', !canMove || idx >= count - 1);
}

var tomeScrollRaf = null;
function onTomeTrackScroll() {
  if (tomeScrollRaf) return;
  tomeScrollRaf = requestAnimationFrame(function () {
    tomeScrollRaf = null;
    var track = $('#tome-track');
    if (!track) return;
    var cards = $$('.tome-card', track);
    if (!cards.length) return;
    var idx = currentTomeIndex();
    cards.forEach(function (card, i) { card.classList.toggle('tome-card-active', i === idx); });
    updateTomeIndicator(idx, cards.length);
    updateTomeArrowsVisibility(idx, cards.length);
  });
}

// Stesso instradamento già in uso per il vecchio elenco (#char-list,
// js/app.js): una bozza (creationCompleted=false) riprende il wizard
// invece di aprire la scheda a metà compilata — il Tomo lo aveva perso
// (bug reale trovato in verifica, correzioni mirate): apriva sempre
// openCharacter(id), mai openCreationWizard(id, true) per le bozze.
function tomeOpenCharacter(id) {
  var c = characters.find(function (x) { return x.id === id; });
  if (c && !c.creationCompleted) openCreationWizard(c.id, true);
  else openCharacter(id);
}

function wireTomeCards() {
  var track = $('#tome-track');
  if (!track) return;
  $$('.tome-open-btn', track).forEach(function (btn) {
    btn.onclick = function (ev) { ev.stopPropagation(); tomeOpenCharacter(btn.dataset.open); };
  });
  $$('.tome-card', track).forEach(function (card) {
    card.onclick = function () { tomeOpenCharacter(card.dataset.id); };
    card.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tomeOpenCharacter(card.dataset.id); } };
  });
}

/* Punto d'ingresso, chiamato da goToMenuTarget('charlist') quando
   character_tome_v1 è attivo, e da refreshViewOnReturn('tome') al ritorno
   (es. dopo aver chiuso la scheda). Stati gestiti: caricamento (characters
   non ancora popolato da loadAll), vuoto, errore, un personaggio, molti
   personaggi, ritratto mancante (via tomePortraitHtml). */
function renderTome() {
  var wrap = $('#tome-wrap');
  var track = $('#tome-track');
  if (!wrap || !track) return;
  wrap.classList.remove('tome-wrap-empty', 'tome-wrap-error');
  try {
    if (typeof characters === 'undefined') {
      track.innerHTML = '<div class="tome-loading">Caricamento personaggi…</div>';
      var dotsLoading = $('#tome-dots'); if (dotsLoading) dotsLoading.innerHTML = '';
      updateTomeArrowsVisibility(0, 0);
      TOME_STATE.ids = [];
      return;
    }
    var visible = visibleCharacters().slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    if (!visible.length) {
      wrap.classList.add('tome-wrap-empty');
      track.innerHTML = '<div class="tome-empty">' +
        '<div class="tome-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5c2.5-2 6.5-2 9 0v14c-2.5-2-6.5-2-9 0V5z"/><path d="M21 5c-2.5-2-6.5-2-9 0v14c2.5-2 6.5-2 9 0V5z"/></svg></div>' +
        '<p>Nessun personaggio ancora.</p>' +
        '<button type="button" class="btn btn-primary" id="tome-empty-create">Crea personaggio</button>' +
      '</div>';
      var dotsEmpty = $('#tome-dots'); if (dotsEmpty) dotsEmpty.innerHTML = '';
      updateTomeArrowsVisibility(0, 0);
      TOME_STATE.ids = [];
      var emptyBtn = $('#tome-empty-create');
      if (emptyBtn) emptyBtn.onclick = function () { createCharacterFlow(); };
      return;
    }
    TOME_STATE.ids = visible.map(function (c) { return c.id; });
    track.innerHTML = visible.map(tomeCardHtml).join('');
    // Bug T1.2: con una sola carta lo scrollLeft "centrante" può risultare
    // negativo (clampato a 0 dal browser) e la carta resta spostata a
    // sinistra — con un solo personaggio non serve scorrere, la si centra
    // via flexbox invece che via scrollTo (vedi .tome-track-single in
    // css/style.css).
    track.classList.toggle('tome-track-single', TOME_STATE.ids.length === 1);
    renderTomeDots(TOME_STATE.ids.length);
    wireTomeCards();
    var startIndex = 0;
    if (typeof activeId !== 'undefined' && activeId) {
      var idx = TOME_STATE.ids.indexOf(activeId);
      if (idx >= 0) startIndex = idx;
    }
    scrollTomeToIndex(startIndex, false);
    requestAnimationFrame(function () { onTomeTrackScroll(); });
  } catch (err) {
    console.error('Tomo dei Personaggi: errore di rendering', err);
    wrap.classList.add('tome-wrap-error');
    track.innerHTML = '<div class="tome-error">' +
      '<p>Non è stato possibile aprire il Tomo dei Personaggi.</p>' +
      '<button type="button" class="btn btn-ghost" id="tome-error-retry">Riprova</button>' +
      '<button type="button" class="btn btn-ghost" id="tome-error-list">Vai all’elenco</button>' +
    '</div>';
    var dotsErr = $('#tome-dots'); if (dotsErr) dotsErr.innerHTML = '';
    updateTomeArrowsVisibility(0, 0);
    var retryBtn = $('#tome-error-retry');
    if (retryBtn) retryBtn.onclick = function () { renderTome(); };
    var listBtn = $('#tome-error-list');
    if (listBtn) listBtn.onclick = function () { renderCharList(); showView('list'); };
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var track = $('#tome-track');
  var prevBtn = $('#tome-arrow-prev');
  var nextBtn = $('#tome-arrow-next');
  var newBtn = $('#btn-tome-new-char');
  var switchList = $('#tome-switch-list');
  if (track) {
    track.addEventListener('scroll', onTomeTrackScroll, { passive: true });
    track.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); scrollTomeToIndex(currentTomeIndex() - 1, true); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); scrollTomeToIndex(currentTomeIndex() + 1, true); }
    });
  }
  if (prevBtn) prevBtn.onclick = function () { scrollTomeToIndex(currentTomeIndex() - 1, true); };
  if (nextBtn) nextBtn.onclick = function () { scrollTomeToIndex(currentTomeIndex() + 1, true); };
  if (newBtn) newBtn.onclick = function () { createCharacterFlow(); };
  // Selettore Tomo/Elenco in intestazione (T1.1, punto 7): sostituisce il
  // vecchio bottone "Vedi elenco" sotto il carosello. "Tomo" è sempre lo
  // stato corrente di questa vista (nessuna azione: ci si è già), "Elenco"
  // porta alla vecchia vista invariata #view-list.
  if (switchList) switchList.onclick = function () { renderCharList(); showView('list'); };
});
