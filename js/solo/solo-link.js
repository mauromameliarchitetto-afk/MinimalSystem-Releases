/* Role Makers — Gioca in solitaria: il personaggio della partita come
   personaggio VERO di "I miei personaggi".

   Chi comanda su cosa:
   - la PARTITA (state.personaggio) comanda su livello, AP, statistiche,
     tratti, HP/MP/PP/P.R. correnti, equipaggiamento e durabilità: a ogni
     apertura della scheda questi campi vengono riscritti dalla partita;
   - la LISTA comanda su nome, ritratto e background: la partita non li
     riscrive mai dopo la creazione.
   Il legame è c.soloId (= state.id della partita), mai il nome.

   Il motore della solitaria fa da "Narratore": come per un personaggio in
   una storia, il livello è bloccato (isLevelLocked in js/app.js) e ogni
   spesa passa da RMSoloEngine.applyCommand (RMSoloUI.comandiDaScheda). La
   scheda normale è una bozza: "Conferma statistiche" e "Conferma tratti"
   la trasformano in comandi del motore, poi la riallineano alla partita.

   Cloud: mai (il personaggio non sta in «I miei personaggi»), impedito sia in
   scheduleCloudAutoPush sia in pushCharacterToCloud.

   Se il personaggio viene cancellato dalla lista durante la partita, la
   partita non si rompe: alla riapertura della scheda viene ricreato dalla
   partita, con un avviso. */
(function (global) {
  'use strict';

  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LINKS_KEY = 'rm_solo_links_v1';

  function collegati() { try { return JSON.parse(localStorage.getItem(LINKS_KEY) || '[]'); } catch (e) { return []; } }
  function ricorda(id) { try { const l = collegati(); if (l.indexOf(id) === -1) { l.push(id); localStorage.setItem(LINKS_KEY, JSON.stringify(l)); } } catch (e) { /* solo l'avviso va perso */ } }

  function trovato(soloId) { return characters.find(c => c.soloId === soloId) || null; }
  function statoCorrente(c) {
    const S = global.RMSoloUI && RMSoloUI._state();
    return S && S.state && S.state.id === c.soloId ? S.state : null;
  }
  const puntiTrattoTot = pg => Object.keys(TRAIT_LISTS).reduce((a, l) => a + ((pg.puntiTratto && pg.puntiTratto[l]) || 0), 0);

  /* Equipaggiamento deciso dal gioco → carte di "Equipaggiamento" (sola lettura).
     La partita ha un'armatura sola, non per locazione: sta sul Busto. */
  function equipDaPartita(c, pg) {
    const dur = e => (global.RMSoloEngine ? RMSoloEngine.durabilitaCorrente(e) : e.durabilita);
    const carta = (base, e, nome) => Object.assign(base, {
      name: nome || e.nome, kind: e.tipo, size: e.taglia || '', quality: e.qualita || '',
      atk: Number(e.atk) || 0, dif: Number(e.dif) || 0, dur: Number(e.durabilita) || 0, durCur: Number(dur(e)) || 0,
      statsConfirmed: true, hasBeenConfirmed: true, equipaggiato: true, soloEquipId: e.id
    });
    const pezzi = (pg.equip || []).filter(e => ['arma', 'armatura', 'scudo'].indexOf(e.tipo) !== -1 && Number.isFinite(e.durabilita) && e.durabilita > 0);
    const slots = defaultSlots();
    const arm = pezzi.find(e => e.tipo === 'armatura');
    if (arm) carta(slots[1], arm);
    const weapon = [];
    const scudo = pezzi.find(e => e.tipo === 'scudo');
    weapon.push(scudo ? carta(makeWeaponSlot('scudo'), scudo) : makeWeaponSlot('scudo'));
    const armi = pezzi.filter(e => e.tipo === 'arma');
    (armi.length ? armi : [null]).forEach((e, i) => {
      const w = makeWeaponSlot('arma'); w.name = 'Arma ' + (i + 1);
      if (e) { carta(w, e); w.weaponClass = e.classe === 'tiro' ? 'tiro' : 'bianca'; }
      weapon.push(w);
    });
    c.slots = slots; c.weaponSlots = weapon;
  }

  /* Tecniche, Abilità, capacità speciali e gemme della partita → righe del
     Retro Scheda, nello stesso formato della scheda normale (makeTecnicaRow /
     makeAbilitaRow). Sola lettura: livello e utilizzi li fa crescere la
     partita, qui si riscrivono a ogni apertura. Le righe sono "confermate"
     (tipoConfirmed) come quelle di un personaggio già in gioco. */
  const DURATA_TURNI = { 0.25: 'quarto', 0.5: 'mezzo', 1: 'turno', 1.5: 'turno_mezzo', 2: 'due', 3: 'tre' };
  function voceBonus(lista, segno) {
    return (lista || []).map(b => ({ id: uid(), kind: 'primary', listKey: 'primaria', name: b.stat, valore: segno * Math.abs(Number(b.valore) || 0) }));
  }
  function testoEffetto(t, gemma) {
    const parti = [t.effetto];
    if (Number(t.costoMP) > 0 && !t.categoria) parti.push('Costo: ' + t.costoMP + ' MP');
    if (t.curaPercentuale) parti.push('Cura: ' + t.curaPercentuale + '% HP max');
    if (gemma) parti.push('Gemma ' + gemma.nome + ': ' + (gemma.stato === 'attiva' ? 'attiva' : 'scarica'));
    return parti.filter(Boolean).join(' · ');
  }
  function rigaRetro(t, comeTecnica, gemme, speciale) {
    const r = comeTecnica ? makeTecnicaRow() : makeAbilitaRow();
    const danno = t.tipo === 'danno';
    r.id = 'solo-' + t.id; r.soloCapId = t.id;
    r.nome = t.nome || '';
    r.tipo = danno ? 'danno' : 'supporto'; r.tipoConfirmed = true;
    if (danno) {
      r.dannoBase = Number(t.dannoBase) || 0;
      r.dannoStat = DANNO_STAT_KEYS.indexOf(t.stat) !== -1 ? t.stat : 'for';
      r.dannoTipo = !comeTecnica && t.categoria === 'magia' ? 'magico' : 'fisico';
    }
    // bonus/malus espliciti, altrimenti quelli di bonusStat ({ dif: 2, vel: -1 })
    const daStat = Object.keys(t.bonusStat || {}).map(k => ({ stat: k, valore: t.bonusStat[k] }));
    const esplicito = (t.bonus || []).length || (t.malus || []).length;
    const bonus = voceBonus(esplicito ? t.bonus : daStat.filter(b => b.valore > 0), 1);
    const malus = voceBonus(esplicito ? t.malus : daStat.filter(b => b.valore < 0), -1);
    if (comeTecnica) { r.bonusItems = bonus; r.malusItems = malus; }
    else r.bonusItems = bonus.concat(malus); // le Abilità non hanno la colonna Malus
    r.tempoAzione = '';
    r.durata = DURATA_TURNI[t.durataTurni] || '';
    r.lv = String(Math.max(1, parseInt(t.lv, 10) || 1));
    r.utilizziCount = Number(t.utilizzi) || 0;
    if (!comeTecnica) r.costoOverride = String(Number(t.costoMP) || 0);
    r.soloEffetto = testoEffetto(t, t.gemma ? (gemme || []).find(g => g.id === t.gemma) : null);
    r.soloSpeciale = !!speciale;
    return r;
  }
  function retroDaPartita(c, pg) {
    c.tecniche = (pg.tecniche || []).map(t => rigaRetro(t, true, pg.gemme, false));
    c.abilita = (pg.abilita || []).map(t => rigaRetro(t, false, pg.gemme, false))
      .concat((pg.capacitaSpeciali || []).map(t => rigaRetro(t, false, pg.gemme, true)));
    // Boost: si attivano dal pannello del combattimento della partita; qui livello, progresso e Lv Top in sola lettura
    c.boostRows = (pg.boost || []).map(b => Object.assign(makeBoostRow(), {
      id: 'solo-' + (b.id || b.nome), nome: b.nome || '', lv: String(b.lv || 1), boostConfirmed: true,
      progresso: Number(b.progresso) || 0, lvTop: !!b.lvTop,
      bonusItems: voceBonus(b.bonus, 1)
    }));
  }

  /* La partita riscrive i campi che comanda; mai nome, ritratto, background. */
  const RITRATTO_PREDEFINITO = 'img/solo/ritratti/predefinito.svg';
  const descrizioneDi = pg => pg.descrizione || [pg.mansione, [pg.popolazione, pg.citta].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  /* La scheda è sempre completa: volto, background e descrizione. Si riempie solo ciò che manca, mai ciò che il giocatore ha scritto. */
  function completaIdentita(c, pg, stato) {
    // volto: quello scelto dal giocatore, altrimenti quello del personaggio pronto, altrimenti il ritratto predefinito
    if (!c.portrait) c.portrait = pg.ritratto || (stato && global.RMSoloUI && RMSoloUI.ritrattoDi ? RMSoloUI.ritrattoDi(stato.storia, pg.archetipo) : '') || RITRATTO_PREDEFINITO;
    c.bg = c.bg || {};
    if (!c.bg.origini && pg.background) c.bg.origini = pg.background;
    if (!c.bg.frase) c.bg.frase = descrizioneDi(pg);
    if (!c.bg.obiettivoBreve && pg.obiettivo) c.bg.obiettivoBreve = pg.obiettivo;
    if (!c.ruolo && pg.mansione) c.ruolo = pg.mansione;
  }
  function sync(c, pg, stato) {
    c.build = pg.build; c.buildConfirmed = true; c.creationCompleted = true;
    c.livello = pg.livello; c.livelloAP = pg.livello;
    c.apDisponibili = Number(pg.apDisponibili) || 0;
    c.qi = pg.qi == null ? c.qi : pg.qi;
    c.primary = Object.assign({}, c.primary, clone(pg.primary));
    c.tertiary = Object.assign({}, c.tertiary, clone(pg.tertiary));
    ['hpMaxTracked', 'mpMaxTracked', 'prMaxTracked', 'hpCur', 'mpCur', 'ppCur', 'prCur'].forEach(k => { if (pg[k] != null) c[k] = pg[k]; });
    // tratti: quelli del catalogo nelle liste della scheda, gli altri come personalizzati
    const t = defaultTraits(), custom = defaultCustomTraits(), shown = defaultShownTraits();
    Object.keys(TRAIT_LISTS).forEach(lista => {
      Object.keys((pg.traits || {})[lista] || {}).forEach(nome => {
        const v = Number(pg.traits[lista][nome]) || 0;
        if (TRAIT_LISTS[lista].indexOf(nome) !== -1) { t[lista][nome] = v; if (v > 0) shown[lista].push(nome); }
        else if (nome) custom[lista].push({ name: nome, value: v });
      });
    });
    c.traits = t; c.customTraits = custom; c.shownTraits = shown;
    // i tratti che la storia offre (campionario): la scheda collegata mostra solo quelli; «I miei personaggi» non li conosce
    if (pg.campionario) c.soloCampionario = clone(pg.campionario); else delete c.soloCampionario;
    // Blocchi come in una storia: statistiche e tratti si sbloccano con un
    // level up e si richiudono quando il giocatore li conferma (o li ha già
    // spesi tutti: nessun punto tratto rimasto).
    const attesa = pg.levelUpInAttesa || null;
    c.soloLevelUp = attesa;
    c.primaryConfirmed = !attesa || c.soloStatOk === attesa;
    c.traitsConfirmed = !attesa || c.soloTrattiOk === attesa || puntiTrattoTot(pg) === 0;
    // pavimenti: ciò che la partita ha già registrato non si può abbassare
    c.primaryFloor = {}; c.traitsFloor = {}; c.tertiaryFloor = {};
    Object.keys(c.primary).forEach(k => { c.primaryFloor[k] = Number(c.primary[k]) || 0; });
    ['hp', 'mp', 'pr'].forEach(k => { const v = Number(pg[k + 'MaxTracked']); if (v > 0 && (k === 'pr' || pg.livello > 1)) c.primaryFloor[k] = v; });
    c.primaryFloorVersion = 1;
    normalizePrimaryFloor(c);
    Object.keys(c.tertiary).forEach(k => { c.tertiaryFloor[k] = Number(c.tertiary[k]) || 0; });
    Object.keys(TRAIT_LISTS).forEach(l => {
      c.traitsFloor[l] = {};
      TRAIT_LISTS[l].forEach(n => { if (t[l][n] > 0) c.traitsFloor[l][n] = t[l][n]; });
      custom[l].forEach(x => { if (x.value > 0) c.traitsFloor[l][x.name] = x.value; });
    });
    equipDaPartita(c, pg);
    retroDaPartita(c, pg);
    c.cloudCharacterId = null; // mai nel cloud
    completaIdentita(c, pg, stato);
    // partita conclusa: il personaggio resta consultabile, in sola lettura
    const conclusa = !!(stato && global.RMSoloEngine && RMSoloEngine.isOver(stato));
    c.soloConclusa = conclusa;
    if (conclusa) { c.bgLocked = defaultBgLocked(); c.primaryConfirmed = true; c.traitsConfirmed = true; }
  }

  /* Crea (o ritrova) il personaggio vero collegato alla partita. */
  function collega(state, titolo) {
    let c = trovato(state.id);
    // «Crea il tuo»: la partita nasce da un personaggio già creato nella lista: lo si adotta, non se ne crea un altro
    if (!c && state.personaggio.creatoDa) {
      const creato = characters.find(x => x.id === state.personaggio.creatoDa && !x.soloId);
      if (creato) { c = creato; c.soloId = state.id; c.soloStoria = state.storia; delete c.soloCreazione; }
    }
    if (!c) {
      const eraCollegato = collegati().indexOf(state.id) !== -1;
      c = newCharacter(state.personaggio.nome);
      c.soloId = state.id; c.soloStoria = state.storia;
      if (state.personaggio.ritratto) c.portrait = state.personaggio.ritratto;
      characters.push(c);
      if (eraCollegato && typeof toast === 'function') toast('Il personaggio era stato eliminato dalla lista: l\'ho ricreato dalla partita.');
    }
    ricorda(state.id);
    c.soloTitolo = titolo || c.soloTitolo || '';
    sync(c, state.personaggio, state);
    return c;
  }

  /* I personaggi della solitaria già copiati in «I miei personaggi» non si cancellano: spariscono dalla lista e restano dentro la
     loro storia, con tutti i dati. Un avviso, una volta sola, dice quanti erano. */
  const SPOSTATI_KEY = 'rm_solo_spostati_v1';
  function avvisoSpostati() {
    try {
      if (localStorage.getItem(SPOSTATI_KEY)) return 0;
      const n = characters.filter(c => c.soloId || c.soloCreazione).length;
      localStorage.setItem(SPOSTATI_KEY, String(n));
      if (n && typeof toast === 'function') toast(n === 1 ? 'Il personaggio della solitaria ora vive solo dentro «Gioca in solitaria».' : n + ' personaggi della solitaria ora vivono solo dentro «Gioca in solitaria».');
      return n;
    } catch (e) { return 0; }
  }

  /* Apre la scheda normale del personaggio della partita. */
  function apri(state, titolo, tab) {
    const c = collega(state, titolo);
    saveAll();
    openCharacter(c.id);
    if (typeof showTab === 'function') showTab(tab || 'tratti');
    return c;
  }
  /* Tab giusta per un level up: i tratti se ci sono punti tratto, altrimenti le statistiche. */
  function tabLevelUp(pg) { return puntiTrattoTot(pg) > 0 ? 'tratti' : 'statistiche'; }

  /* Riallinea una scheda collegata alla partita (apertura dalla lista compresa). */
  async function riallinea(c) {
    let st = statoCorrente(c);
    if (!st && global.RMSoloStore) {
      try { const slot = await RMSoloStore.get(c.soloStoria); st = slot && slot.partita && slot.partita.id === c.soloId ? slot.partita : null; } catch (e) { st = null; }
    }
    if (!st) return false;
    sync(c, st.personaggio, st);
    saveAll();
    if (getActive() === c) renderSheet();
    return true;
  }

  /* +1 per ogni punto che la scheda ha aggiunto rispetto alla partita. Solo
     aumenti: la partita non rimborsa (come improvementQuote). */
  function speseTratti(c, pg) {
    const spese = [];
    const offerti = pg.campionario || TRAIT_LISTS;
    for (const lista of Object.keys(TRAIT_LISTS)) {
      const proprio = (c.customTraits && c.customTraits[lista]) || [];
      const nomi = Array.from(new Set(TRAIT_LISTS[lista].concat(Object.keys(((pg.traits || {})[lista]) || {}), offerti[lista] || [], proprio.map(x => x.name).filter(Boolean))));
      for (const nome of nomi) {
        const standard = TRAIT_LISTS[lista].indexOf(nome) !== -1;
        const da = Number(((pg.traits || {})[lista] || {})[nome]) || 0;
        const a = standard ? Number((c.traits[lista] || {})[nome]) || 0 : Number((proprio.find(x => x.name === nome) || {}).value) || 0;
        if (a < da) return { errore: nome + ': non si può scendere sotto il valore già registrato.' };
        if (a > da && (offerti[lista] || []).indexOf(nome) === -1) return { errore: nome + ': non è fra i tratti che questa storia offre.' };
        for (let i = da; i < a; i++) spese.push({ categoria: 'tratto', lista, chiave: nome });
      }
    }
    return { spese };
  }
  /* Statistiche primarie, P.R. e terziarie: stesso criterio. HP e MP dal Lv 2
     sono "cresciuti" (valori tracciati), come in changePrimary. */
  function speseStatistiche(c, pg) {
    const spese = [];
    const chiavi = PRIMARY_STATS.map(s => s.key).concat(['pr']);
    for (const k of chiavi) {
      const cresciuto = k === 'pr' || ((k === 'hp' || k === 'mp') && Number(pg.livello) > 1);
      const tr = k + 'MaxTracked';
      const da = Number(cresciuto ? pg[tr] : (pg.primary || {})[k]) || 0, a = Number(cresciuto ? c[tr] : (c.primary || {})[k]) || 0;
      if (a < da) return { errore: k.toUpperCase() + ': non si può scendere sotto il valore già registrato.' };
      for (let i = da; i < a; i++) spese.push({ categoria: 'primaria', chiave: k });
    }
    for (const st of TERTIARY_STATS) {
      const da = Number((pg.tertiary || {})[st.key]) || 0, a = Number((c.tertiary || {})[st.key]) || 0;
      if (a < da) return { errore: st.label + ': non si può scendere sotto il valore già registrato.' };
      for (let i = da; i < a; i++) spese.push({ categoria: 'terziaria', chiave: st.key });
    }
    return { spese };
  }

  /* Esegue le spese nella partita, poi riallinea la scheda alla partita (anche
     in caso di rifiuto: la bozza viene annullata). */
  async function conferma(c, calcola, okTesto, segna) {
    const st = statoCorrente(c);
    if (!st) { toast('Apri la partita dalla solitaria per confermare.'); await riallinea(c); return { ok: false }; }
    if (c.soloConclusa) { toast('La partita è conclusa: il personaggio è in sola lettura.'); return { ok: false }; }
    const q = calcola(c, st.personaggio);
    const attesa = st.personaggio.levelUpInAttesa || null;
    const r = q.errore ? { ok: false, errore: q.errore } : await RMSoloUI.comandiDaScheda(c.soloId, q.spese.map(spesa => ({ tipo: 'miglioramento', sorgente: 'scheda', spesa })));
    if (r.ok && attesa) segna(c, attesa);
    const nuovo = RMSoloUI._state().state;
    sync(c, nuovo.personaggio, nuovo);
    saveAll();
    renderSheet();
    toast(r.ok ? okTesto : (r.errore || 'Spesa non riuscita'));
    return r;
  }
  const confermaTratti = c => conferma(c, speseTratti, 'Tratti confermati e registrati nella partita', (x, lv) => { x.soloTrattiOk = lv; });
  const confermaStatistiche = c => conferma(c, speseStatistiche, 'Statistiche confermate e registrate nella partita', (x, lv) => { x.soloStatOk = lv; });

  /* Conclude il level up (AP non spesi restano da parte; i punti tratto sono obbligatori). */
  async function concludiLevelUp(c) {
    const r = await RMSoloUI.comandiDaScheda(c.soloId, [{ tipo: 'level_up_fine', sorgente: 'scheda' }]);
    const st = statoCorrente(c);
    if (st) sync(c, st.personaggio, st);
    saveAll();
    renderSheet();
    toast(r.ok ? 'Level up concluso. La storia riprende.' : (r.errore || 'Level up non concluso'));
    return r;
  }

  function tornaAllaPartita(c) {
    showView('solo');
    return RMSoloUI.openGame(c.soloStoria);
  }

  /* Strumenti di tiro e combattimento: i tiri li fa il motore della partita. */
  const STRUMENTI_NASCOSTI = ['Subisci un colpo', 'Tira danno', 'Combattimento', 'Riposo', 'Soglia K.O.', 'Consumo oggetti', 'Incrementi attivi', 'Bloccare', 'Attacca', 'Tiro tratto', 'Tiro statistica'];
  function mostraStrumenti(on) {
    const pannello = document.querySelector('#view-sheet [data-panel="gioco"]');
    if (!pannello) return;
    pannello.querySelectorAll('.section-title').forEach(t => {
      const nome = t.textContent.trim();
      if (!STRUMENTI_NASCOSTI.some(n => nome.indexOf(n) === 0)) return;
      let el = t;
      do { el.toggleAttribute('data-solo-nascosto', !on); el = el.nextElementSibling; } while (el && !el.classList.contains('section-title') && !el.classList.contains('hud-grid'));
    });
    // righe di danno/uso/attivazione sotto le barre: HP, MP, PP correnti sono della partita
    ['#hp-dmg-input', '#mp-cost-select', '#boost-activate-select'].forEach(sel => {
      const el = document.querySelector(sel), riga = el && el.closest('.bar-controls');
      if (riga) riga.toggleAttribute('data-solo-nascosto', !on);
    });
    ['#hp-max', '#mp-max', '#hud-pr-max'].forEach(sel => { const el = document.querySelector(sel); if (el) el.disabled = !on; });
    ['qi', 'hprim', 'hpuso', 'mprim', 'mpuso', 'prcur'].forEach(k => {
      const dg = document.querySelector('#stat-diagram [data-dg="' + k + '"]');
      if (dg) { dg.classList.toggle('dg-ro', !on); if (!on) dg.setAttribute('readonly', ''); }
    });
    const hudPr = document.getElementById('hud-pr'); if (hudPr && 'disabled' in hudPr) hudPr.disabled = !on;
    ['btn-request-combat'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = !on; });
  }

  /* Equipaggiamento in sola lettura: lo decide il gioco. */
  function equipSolaLettura(on) {
    const p = document.querySelector('#view-sheet [data-panel="equip"]');
    if (!p) return;
    p.inert = !on;
    let nota = document.getElementById('solo-equip-nota');
    if (!on) {
      if (!nota) {
        nota = document.createElement('p'); nota.id = 'solo-equip-nota'; nota.className = 'helper-text';
        nota.textContent = 'Armi, scudi e armature li decide il gioco: qui si consultano, con la durabilità della partita.';
        p.insertBefore(nota, p.firstChild);
      }
      nota.hidden = false;
    } else if (nota) nota.hidden = true;
  }

  /* Retro Scheda in sola lettura: tecniche, abilità e gemme le decide la
     partita. Le voci dei livelli successivi le sceglie il giocatore al level up
     dalla partita (esempi del gruppo o capacità propria: comando assegna_slot). */
  function retroSolaLettura(on) {
    const p = document.querySelector('#view-sheet [data-panel="retro"]');
    if (!p) return;
    p.inert = !on;
    let nota = document.getElementById('solo-retro-nota');
    if (!on) {
      if (!nota) {
        nota = document.createElement('p'); nota.id = 'solo-retro-nota'; nota.className = 'helper-text';
        nota.textContent = 'Tecniche, abilità e gemme le decide il gioco: qui si consultano. Livello e utilizzi crescono con l\'uso nella partita.';
        p.insertBefore(nota, p.firstChild);
      }
      nota.hidden = false;
    } else if (nota) nota.hidden = true;
  }

  /* ------------------------------------------------ «Crea il tuo» */
  /* Il personaggio è già nella lista (bozza del wizard normale) con
     c.soloCreazione = { storia, titolo, scelte }; il cloud resta spento (vedi
     scheduleCloudAutoPush). Alla creazione completata passa a RMSoloUI, che
     chiede obiettivo e difficoltà e avvia la partita: collega() lo adotta. */
  const P = () => global.RMSoloProprio;
  function datiCreazione(c) {
    const U = global.RMSoloUI;
    return c && c.soloCreazione && U && U.datiStoria ? U.datiStoria(c.soloCreazione.storia) : null;
  }
  function scelteDi(c) {
    const d = datiCreazione(c);
    return d ? P().normalizza(c.soloCreazione.storia, d.archetipi, c.soloCreazione.scelte, d.catalogo) : Object.assign({}, c.soloCreazione.scelte);
  }
  function bozzaInCorso(storia) {
    return characters.filter(x => x.soloCreazione && x.soloCreazione.storia === storia && !x.soloId).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0] || null;
  }
  function classiBloccate(c) {
    const d = datiCreazione(c);
    return d ? P().classi(c.soloCreazione.storia, d.archetipi, scelteDi(c), d.pronto, Object.keys(BUILDS), d.catalogo) : null;
  }
  /* Tecniche e abilità di Lv 1: partono dalla dotazione del catalogo per gruppo e classe
     (righe modificabili come nella scheda normale, entro il tetto del Lv 1) e si cambiano
     con «Scegli un esempio». Si riscrivono solo se cambia il gruppo o la classe. */
  function rigaCreazione(t, comeTecnica) {
    const r = rigaRetro(Object.assign({ utilizzi: 0 }, t), comeTecnica, [], false);
    r.tipoConfirmed = false; r.soloEffetto = '';
    return r;
  }
  function gruppoCorrente(c) {
    const d = datiCreazione(c);
    return d && d.catalogo ? P().gruppoDi(d.catalogo, scelteDi(c)) : null;
  }
  function riempiTecab(c, forza) {
    const d = datiCreazione(c);
    if (!d || !d.catalogo || !c.soloCreazione) return null;
    const g = gruppoCorrente(c), cl = classiBloccate(c);
    const ok = !!(g && cl && cl[c.build] && cl[c.build].ok);
    const chiave = ok ? g + '|' + c.build : '';
    if (!forza && c.soloCreazione.tecabChiave === chiave) return null;
    const dot = ok ? RMSoloCatalogo.dotazione(d.catalogo, g, c.build) : null;
    c.tecniche = dot ? dot.tecniche.map(t => rigaCreazione(t, true)) : [];
    c.abilita = dot ? dot.abilita.map(t => rigaCreazione(t, false)) : [];
    c.soloCreazione.tecabChiave = chiave;
    return dot;
  }
  /* «Scegli un esempio»: sostituisce la voce dello slot con un esempio del gruppo e della classe. */
  function applicaEsempio(c, kind, i, capId) {
    const d = datiCreazione(c), g = gruppoCorrente(c);
    if (!d || !g) return false;
    const cap = RMSoloCatalogo.esempi(d.catalogo, g, c.build, kind, []).find(x => x.id === capId);
    if (!cap) return false;
    const righe = c[kind] || [];
    if (righe.some((r, j) => j !== i && r.soloCapId === capId)) { if (typeof toast === 'function') toast('Hai già scelto questa voce in un altro slot.'); return false; }
    righe[i] = rigaCreazione(cap, kind === 'tecniche');
    c[kind] = righe;
    if (typeof touchActive === 'function') touchActive();
    return true;
  }
  function scelteComplete(c) {
    const d = datiCreazione(c);
    return !d || !mancantiCreazione(c).length;
  }
  function mancantiCreazione(c) {
    const d = datiCreazione(c);
    if (!d) return [];
    const m = P().mancanti(c.soloCreazione.storia, d.archetipi, scelteDi(c), d.catalogo);
    const cl = classiBloccate(c);
    // la classe scelta deve avere una dotazione coerente con la popolazione
    if (!m.length && cl && cl[c.build] && !cl[c.build].ok) m.push('una classe ammessa (' + cl[c.build].motivo + ')');
    return m;
  }

  function disegnaIdentita(c) {
    const host = document.getElementById('wiz-card-identity');
    if (!host) return;
    let box = document.getElementById('solo-ident');
    const razza = document.getElementById('f-razza'), ruolo = document.getElementById('f-ruolo');
    const campoRazza = razza && razza.closest('.field'), campoRuolo = ruolo && ruolo.closest('.field');
    const attivo = !!(c && c.soloCreazione);
    if (campoRazza) campoRazza.toggleAttribute('data-solo-nascosto', attivo);
    if (campoRuolo) campoRuolo.toggleAttribute('data-solo-nascosto', attivo);
    if (!attivo) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'solo-ident';
      const dopo = document.getElementById('creation-anagrafica-block');
      if (dopo) dopo.insertAdjacentElement('beforebegin', box); else host.appendChild(box);
      box.addEventListener('change', e => {
        const sel = e.target.closest('[data-solo-campo]');
        const x = typeof getActive === 'function' ? getActive() : null;
        if (!sel || !x || !x.soloCreazione) return;
        x.soloCreazione.scelte = Object.assign({}, x.soloCreazione.scelte, { [sel.dataset.soloCampo]: sel.value });
        aggiornaDopoScelte(x);
      });
    }
    const d = datiCreazione(c);
    if (!d) { box.innerHTML = '<p class="helper-text">Carico i dati della storia…</p>'; return; }
    const storia = c.soloCreazione.storia, sc = scelteDi(c);
    const campiS = P().campi(storia, d.archetipi, d.catalogo).filter(x => !x.nascosto);
    box.innerHTML = '<div class="section-title"><span class="dot neutral"></span>Nella storia · ' + esc(c.soloCreazione.titolo || storia) + '</div>' +
      '<div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:12px;">' +
      '<p class="helper-text" style="margin:0;">Scegli fra le voci di questo mondo. Armi, protezioni, zaino, tecniche e abilità di partenza vengono dal catalogo del tuo gruppo e della tua classe; le tecniche e le abilità le puoi cambiare con «Scegli un esempio».</p>' +
      campiS.map(cm => {
        const ok = P().opzioniValide(cm, sc);
        return '<div class="field"><label>' + esc(cm.label) + '</label><select data-solo-campo="' + cm.key + '"' + (ok.length === 1 ? ' disabled' : '') + '>' +
          (ok.length === 1 ? '' : '<option value="">— scegli —</option>') +
          ok.map(o => '<option value="' + esc(o.id) + '"' + (sc[cm.key] === o.id ? ' selected' : '') + '>' + esc(o.nome) + '</option>').join('') + '</select></div>';
      }).join('') + gruppoHtml(d, sc) + '</div></div>';
  }
  /* Scheda breve del gruppo scelto: aspetto e limiti, dal catalogo. */
  function gruppoHtml(d, sc) {
    const g = d.catalogo && P().gruppoDi(d.catalogo, sc), gr = g && d.catalogo.gruppi[g];
    if (!gr) return '';
    return '<div class="helper-text" id="solo-gruppo" style="margin:0;"><b>' + esc(gr.nome) + '</b> — ' + esc(gr.aspetto) + '<br><i>' + esc(gr.limiti) + '</i></div>';
  }
  /* Dopo ogni scelta: razza e ruolo della scheda seguono, la classe cade se non più ammessa, tecniche e abilità si riallineano. */
  function aggiornaDopoScelte(c) {
    const d = datiCreazione(c);
    if (!d) return;
    const storia = c.soloCreazione.storia, sc = scelteDi(c), cs = P().campi(storia, d.archetipi, d.catalogo);
    c.soloCreazione.scelte = sc;
    c.razza = P().nomeScelta(cs, sc, 'popolazione') || P().nomeScelta(cs, sc, 'appartenenza');
    c.ruolo = P().nomeScelta(cs, sc, 'ruolo');
    const cl = classiBloccate(c);
    if (cl && cl[c.build] && !cl[c.build].ok) {
      const nuova = Object.keys(cl).find(k => cl[k].ok);
      if (nuova) { c.build = nuova; if (typeof refreshAfterBuildChange === 'function') refreshAfterBuildChange(c); }
    }
    riempiTecab(c);
    if (typeof touchActive === 'function') touchActive();
    preparaWizard(c);
  }

  /* «Scegli un esempio» per ogni slot di Lv 1: un menu con le voci del gruppo e della classe. Le righe
     restano modificabili come nella scheda normale (nome, danno entro il tetto del Lv 1, bonus). */
  function disegnaEsempi(c) {
    const blocco = document.getElementById('creation-tecab-block');
    if (!blocco) return;
    let box = document.getElementById('solo-esempi');
    const attivo = !!(c && c.soloCreazione);
    if (!attivo) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'solo-esempi';
      blocco.insertBefore(box, blocco.firstChild);
      box.addEventListener('change', e => {
        const sel = e.target.closest('[data-solo-esempio]');
        const x = typeof getActive === 'function' ? getActive() : null;
        if (!sel || !x || !x.soloCreazione || !sel.value) return;
        const [kind, i] = sel.dataset.soloEsempio.split('::');
        if (applicaEsempio(x, kind, Number(i), sel.value)) { if (typeof renderTecniche === 'function') { renderTecniche(x); renderAbilita(x); } }
        disegnaEsempi(x);
      });
    }
    const d = datiCreazione(c), g = gruppoCorrente(c), cl = classiBloccate(c);
    if (!d || !g || !cl || !cl[c.build] || !cl[c.build].ok) { box.innerHTML = '<p class="helper-text">Scegli prima le voci di identità e una classe ammessa: poi potrai scegliere gli esempi di tecniche e abilità.</p>'; return; }
    const gr = d.catalogo.gruppi[g];
    const slot = (kind, etichetta) => (c[kind] || []).map((r, i) => {
      const usate = (c[kind] || []).map(x => x.soloCapId).filter(Boolean);
      const opz = RMSoloCatalogo.esempi(d.catalogo, g, c.build, kind, usate.filter(id => id !== r.soloCapId));
      return '<div class="field"><label>' + etichetta + ' ' + (i + 1) + ' · Scegli un esempio</label><select data-solo-esempio="' + kind + '::' + i + '">' +
        '<option value="">' + (r.nome ? 'Ora: ' + esc(r.nome) + ' — cambia…' : '— scegli —') + '</option>' +
        opz.map(o => '<option value="' + esc(o.id) + '">' + esc(o.nome) + ' — ' + esc(o.effetto) + '</option>').join('') + '</select></div>';
    }).join('');
    box.innerHTML = '<div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:12px;">' +
      '<p class="helper-text" style="margin:0;"><b>' + esc(gr.nome) + '</b> · ' + esc((BUILDS[c.build] || {}).label || c.build) + ': gli esempi sono voci del tuo gruppo e della tua classe, al livello 1 (danno massimo ' + (typeof capacitaTetto === 'function' ? capacitaTetto('danno', 1) : 10) + '). Dopo averne scelto uno puoi modificarlo qui sotto come in una scheda normale; crescono con l\'uso.</p>' +
      slot('tecniche', 'Tecnica') + slot('abilita', 'Abilità') + '</div></div>';
  }

  /* Chiamata a ogni apertura/passo del wizard (anche per i personaggi normali: ripristina). */
  function preparaWizard(c) {
    const attivo = !!(c && c.soloCreazione);
    const blocco = document.getElementById('creation-tecab-block');
    if (blocco) {
      // niente più sola lettura: tecniche e abilità si scelgono dal catalogo e si modificano
      blocco.inert = false;
      blocco.classList.remove('solo-ro');
      const nota = document.getElementById('solo-tecab-nota');
      if (nota) nota.hidden = true;
    }
    disegnaIdentita(c);
    if (attivo && datiCreazione(c)) {
      riempiTecab(c);
      if (typeof renderBuildGrid === 'function') renderBuildGrid(c);
      if (typeof renderTecniche === 'function') { renderTecniche(c); renderAbilita(c); }
      disegnaEsempi(c);
    } else if (attivo && global.RMSoloUI && RMSoloUI.caricaStoria) {
      // bozza ripresa dopo un riavvio: i dati della storia si caricano e il wizard si ridisegna
      RMSoloUI.caricaStoria(c.soloCreazione.storia).then(() => { if (typeof getActive === 'function' && getActive() === c && typeof wizardActive !== 'undefined' && wizardActive) preparaWizard(c); }).catch(() => {});
    } else disegnaEsempi(c);
  }

  /* Nota sotto HP/MP/PP (decisione dell'autore del 6/11, DECISIONI §13): con una partita in solitaria la nota sull'accettazione del
     Narratore multiplayer (#entry-lock-note, js/app.js) la nasconde il CSS (css/solo.css, #view-sheet.solo-linked) e al suo posto
     compare questa; nelle campagne multiplayer resta quella dell'app. app.js e index.html non cambiano. */
  function notaSolitaria(collegato) {
    const app = document.getElementById('entry-lock-note');
    let n = document.getElementById('solo-entry-note');
    if (!n && app && collegato) {
      n = document.createElement('p');
      n.id = 'solo-entry-note'; n.className = 'helper-text'; n.style.margin = '2px 0 0';
      n.textContent = 'In solitaria, HP, MP e PP vengono aggiornati automaticamente dalla partita.';
      app.insertAdjacentElement('afterend', n);
    }
    if (n) n.classList.toggle('hidden', !collegato);
  }

  /* Banner, blocchi e pulsanti della scheda normale per un personaggio collegato. */
  function aggiornaUi(c) {
    const vista = document.getElementById('view-sheet');
    let b = document.getElementById('solo-link-banner');
    const collegato = !!(c && c.soloId);
    if (vista) vista.classList.toggle('solo-linked', collegato);
    notaSolitaria(collegato);
    mostraStrumenti(!collegato);
    equipSolaLettura(!collegato);
    retroSolaLettura(!collegato);
    if (!collegato) { if (b) b.classList.add('hidden'); return; }
    if (!b) {
      const head = document.querySelector('#view-sheet .sheet-header');
      if (!head) return;
      b = document.createElement('div');
      b.id = 'solo-link-banner'; b.className = 'helper-text';
      b.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:8px 12px;margin:0;';
      head.insertAdjacentElement('afterend', b);
    }
    b.classList.remove('hidden');
    const st = statoCorrente(c), pg = st && st.personaggio, attesa = pg && pg.levelUpInAttesa;
    const manca = attesa && global.RMSoloEngine ? RMSoloEngine.levelUpMancante(pg) : null;
    const ob = pg && pg.obiettivoPersonale;
    b.innerHTML = '<span>🎲 Solitaria · ' + esc(c.soloTitolo || 'partita') + ' — livello, AP, statistiche, tratti ed equipaggiamento li comanda la partita.' + (c.soloConclusa ? ' <b>Partita conclusa: scheda in sola lettura.</b>' : '') +
      (ob ? ' <span data-solo-obiettivo><b>Obiettivo:</b> ' + esc(ob.nome) + (ob.dettaglio ? ' — ' + esc(ob.dettaglio) : '') + '</span>' : '') +
      (attesa ? ' <b>Level up da completare:</b> conferma statistiche e tratti, poi concludi.' : '') +
      (manca && manca.bloccato ? ' <span data-solo-manca>' + esc(manca.testo) + '</span>' : '') + '</span>' +
      '<span style="display:flex;gap:8px;flex-wrap:wrap;">' +
      (manca && manca.slotDaAssegnare && (manca.slotDaAssegnare.tecniche + manca.slotDaAssegnare.abilita) ? '<button type="button" class="btn btn-primary btn-sm" id="solo-link-capacita">Assegna le nuove capacità</button>' : '') +
      (attesa ? '<button type="button" class="btn btn-primary btn-sm" id="solo-link-fine"' + (manca && manca.bloccato ? ' disabled aria-disabled="true"' : '') + '>Concludi il level up</button>' : '') +
      '<button type="button" class="btn btn-ghost btn-sm" id="solo-link-back">Torna alla partita</button></span>';
    b.querySelector('#solo-link-back').addEventListener('click', () => tornaAllaPartita(c));
    const capacita = b.querySelector('#solo-link-capacita');
    if (capacita) capacita.addEventListener('click', () => tornaAllaPartita(c));
    const fine = b.querySelector('#solo-link-fine');
    if (fine) fine.addEventListener('click', () => concludiLevelUp(c));
  }

  global.RMSoloLink = { avvisoSpostati, bozzaInCorso, classiBloccate, riempiTecab, applicaEsempio, gruppoCorrente, disegnaEsempi, scelteComplete, mancantiCreazione, preparaWizard, aggiornaDopoScelte, scelteDi, collega, apri, tabLevelUp, riallinea, sync, speseTratti, speseStatistiche, confermaTratti, confermaStatistiche, concludiLevelUp, tornaAllaPartita, aggiornaUi, trovato };
})(typeof window !== 'undefined' ? window : globalThis);
