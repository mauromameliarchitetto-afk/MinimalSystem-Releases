/* Single player — avversari della campagna lunga: schede, scontri con più
   partecipanti, tattica per categoria e difficoltà, fasi di boss e
   miniboss, morale (fuga e resa individuali e collettive), stati, loot dagli
   avversari davvero presenti.

   Attivo in PRODUZIONE quando la campagna lunga è caricata. Le schede
   vengono da <storia>-struttura.json: i valori meccanici non presenti nei
   dati sono PROPOSTE marcate ed elencate fra quelle da approvare. Un
   avversario senza scheda non viene sostituito da un blocco generico: si usa
   il nemico dei dati come prima, e la mancanza è segnalata.

   Niente onniscienza: ogni unità decide su ciò che percepisce durante lo
   scontro (azioni del protagonista viste, ferite visibili in modo
   grossolano, stati evidenti, alleati caduti), mai su statistiche,
   capacità non ancora mostrate, dadi o HP esatti del protagonista.
   Raven resta separata e non passa mai da qui. */
(function (global) {
  'use strict';
  const R = () => global.RMSoloRules;

  const CATEGORIE = ['bestia', 'inesperto', 'soldato', 'specialista', 'elite', 'comandante', 'miniboss', 'boss'];
  const DANNO_BASE_MAX_LV1 = 10;
  const ESITI = ['vittoria', 'fuga', 'nemico_fuggito', 'resa', 'sconfitta', 'morte'];
  const ESITI_UNITA = ['sconfitto', 'incapacitato', 'fuggito', 'arreso'];
  const FUNZIONI_INCONTRO = ['minaccia', 'prezzo', 'rivelazione', 'pressione', 'prova'];
  const MOLT_HP_DIFFICOLTA = { esplorativa: 0.75, bilanciata: 1, permadeath: 1.25 }; // già in uso nel motore

  function S(content) { return content && content.struttura ? content.struttura : null; }
  function scheda(content, id) { const s = S(content); return s && s.avversari ? s.avversari[id] || null : null; }
  function difficolta(state, content) { const s = S(content); return (s && s.difficolta && s.difficolta[state.difficolta]) || {}; }
  function tattica(content, cat) { const s = S(content); return (s && s.tattiche && s.tattiche[cat]) || {}; }
  function incontroDef(state, content) { const s = S(content); return s && s.incontri ? s.incontri[state.scena] || null : null; }
  // unità della scena per quel nemico dei dati (o unità con quella base)
  function composizione(state, content, nemicoId) {
    if (nemicoId === 'raven' || !S(content)) return null;
    const def = incontroDef(state, content);
    if (def && def.unita.every(u => (scheda(content, u) || {}).base === nemicoId)) return { unita: def.unita.slice(), def };
    const sh = Object.values(S(content).avversari || {}).find(a => a.base === nemicoId && !a.separataDalBilanciamento);
    if (!sh) return null;
    return { unita: Array.from({ length: sh.gruppoDefault || 1 }, () => sh.id), def: null };
  }
  function attivo(state, content, nemicoId) { return !!composizione(state, content, nemicoId); }
  /* Villain dello scontro finale (incontro.villain della scena): il
     candidato vivo più ostile al protagonista; a parità, l'ordine dei dati.
     Nessun candidato vivo: nessuno scontro. */
  function villainFinale(state, content, incontro) {
    const v = incontro && incontro.villain;
    if (!v) return incontro ? incontro.nemico : null;
    const rel = (state.campagna && state.campagna.png) || {};
    const vivi = (v.candidati || []).filter(id => {
      const t = (content.nemici || {})[id];
      const png = t && t.pngId;
      return t && !(png && rel[png] && rel[png].stato === 'morto');
    });
    if (!vivi.length) return null;
    const att = id => { const png = content.nemici[id].pngId; return png && state.png && state.png[png] ? Number(state.png[png].atteggiamento) || 0 : 0; };
    return vivi.map((id, i) => ({ id, i, a: att(id) })).sort((x, y) => x.a - y.a || x.i - y.i)[0].id;
  }

  /* ------------------------------------------------------- coerenza
     Solo identificativi strutturati (factionId, corporationId, peopleId,
     classId o statProfileId, enemyFamilyId, equipmentProfileId), mai il
     nome visualizzato. Le creature non hanno classe da personaggio: il
     loro profilo di crescita è statProfileId (correzione dell'autore). */
  function validaScheda(content, sh) {
    const e = [];
    if (!sh) return ['scheda assente'];
    if (sh.separataDalBilanciamento) return [];
    if (CATEGORIE.indexOf(sh.categoria) === -1) e.push('categoria non prevista: ' + sh.categoria);
    ['storyId', 'enemyFamilyId', 'specializationId', 'equipmentProfileId'].forEach(k => { if (!sh[k]) e.push(k + ' mancante'); });
    if (!sh.classId && !sh.statProfileId) e.push('classId o statProfileId mancante');
    if (global.RMSoloOntologia) global.RMSoloOntologia.validaAvversario(sh, sh.storyId).forEach(x => e.push('ontologia: ' + x));
    if (!('factionId' in sh) || !('peopleId' in sh)) e.push('factionId/peopleId assenti dalla scheda');
    const caps = [].concat(sh.tecniche || [], sh.magie || []);
    if (!caps.length) e.push('nessuna tecnica né magia');
    caps.forEach(c => {
      if (!c.tipo || !c.bersaglio) e.push(c.id + ': tipo o bersaglio mancanti');
      if (c.dannoBase != null && c.dannoBase > DANNO_BASE_MAX_LV1) e.push(c.id + ': danno base ' + c.dannoBase + ' oltre il limite del Lv 1 (' + DANNO_BASE_MAX_LV1 + ')');
      if (c.stato && S(content) && !S(content).stati[c.stato]) e.push(c.id + ': stato inesistente ' + c.stato);
    });
    const co = (S(content) || {}).coerenza || {};
    const popolo = sh.peopleId ? Object.keys(co).find(k => k.toLowerCase() === String(sh.peopleId).toLowerCase()) : null;
    if (popolo && co[popolo].classiIniziali && co[popolo].classiIniziali.indexOf(sh.classId) === -1) e.push(popolo + ': classe ' + sh.classId + ' non ammessa (' + co[popolo].classiIniziali.join('/') + ')');
    // una creatura lascia resti grezzi, mai armi lavorate in osso (le lavorano le persone)
    const armiOsso = JSON.stringify(sh.tecniche || []).indexOf('osso_teras') !== -1 || sh.materiale === 'osso_teras';
    if (armiOsso && sh.equipmentProfileId === 'naturale') e.push('una creatura con armi lavorate in osso di Tèras');
    const prof = ((S(content) || {}).profiliEquipaggiamento || {})[sh.equipmentProfileId];
    if (!prof) e.push('profilo di equipaggiamento sconosciuto: ' + sh.equipmentProfileId);
    if (sh.equipmentProfileId === 'naturale' && sh.factionId) e.push('una creatura con una fazione: da verificare');
    if ((sh.categoria === 'boss' || sh.categoria === 'miniboss') && (sh.fasi || []).length < 2) e.push('boss o miniboss senza almeno due fasi');
    (sh.fasi || []).forEach(f => { if (!f.condizione || !f.segnale) e.push('fase ' + f.id + ' senza condizione o segnale'); });
    if (!sh.morale || sh.morale.fugaSotto == null) e.push('morale mancante');
    return e;
  }

  /* -------------------------------------------------------- stati */
  function statoMotore(content, id) {
    const st = S(content) && S(content).stati[id];
    if (!st) return null;
    return { nome: id.replace(/_/g, ' '), stato: id, bonus: Object.assign({}, (st.effetto || {}).bonus || {}), perTurno: (st.effetto || {}).perTurno || null, colpirlo: (st.effetto || {}).colpirlo || 0, durataTurni: st.durata || 1, resistenza: st.resistenza || null, rimozione: st.rimozione || ['durata'], segnale: st.segnale || null };
  }
  function tickStati(state, applied) {
    const inc = state.incontro;
    const round = inc ? inc.round : 0;
    let perso = 0;
    (state.supporti || []).filter(s => s.perTurno && s.round >= round).forEach(s => {
      const d = Number(s.perTurno.hp) || 0;
      if (d < 0) {
        const prima = state.personaggio.hpCur;
        state.personaggio.hpCur = Math.max(0, prima + d);
        perso += prima - state.personaggio.hpCur;
        applied.push({ tipo: 'stato_effetto', stato: s.stato || s.nome, hp: state.personaggio.hpCur - prima });
      }
    });
    return perso;
  }
  function rimuoviStati(state, via, applied) {
    const prima = (state.supporti || []).length;
    const tolti = [];
    state.supporti = (state.supporti || []).filter(s => { const ok = !(s.rimozione && s.rimozione.indexOf(via) !== -1); if (!ok) tolti.push(s.stato || s.nome); return ok; });
    if (tolti.length && applied) applied.push({ tipo: 'stati_rimossi', via, stati: tolti });
    return prima - state.supporti.length;
  }

  /* ------------------------------------------------------- incontro */
  function vel(u) { return Number((u.primary || {}).vel) || 0; }
  function creaUnita(state, content, unitId, idx, livello) {
    const sh = scheda(content, unitId);
    // i villain hanno un modello proprio nella scheda (fuori da campagna.nemici)
    const tpl = content.nemici[sh.base] || sh.modello;
    const fin = sh.scalaFinale && state.personaggio ? sh.scalaFinale : null;
    // villain dello scontro finale: si parte dal Lv 1 e si rispecchia il protagonista (sotto)
    const c = R().scaledCombatant(tpl, fin ? 1 : livello);
    if (fin) specchia(c, tpl, state.personaggio);
    const mod = sh.modificatori || {};
    Object.entries(mod.primary || {}).forEach(([k, v]) => { c.primary[k] = Math.max(0, (Number(c.primary[k]) || 0) + v); });
    const hpBase = tpl.hpMax ? Math.round(tpl.hpMax * (1 + (livello - 1) * 0.25)) : c.hpMax;
    // villain dello scontro finale: HP sul protagonista (sfida paragonabile, decisione dell'autore)
    const pgHp = state.personaggio && Number(state.personaggio.hpMaxTracked);
    const kFin = sh.scalaFinale && pgHp ? (sh.scalaFinale.hpRispettoAlPg || {})[state.difficolta] || 1 : null;
    const hpMax = kFin ? Math.max(1, Math.round(pgHp * kFin)) : Math.max(1, Math.round(hpBase * (MOLT_HP_DIFFICOLTA[state.difficolta] || 1) * (mod.hpMult || 1)));
    const build = (typeof BUILDS !== 'undefined' && BUILDS[sh.classId || sh.statProfileId]) || null;
    const mpBase = Math.max(0, Math.round(((c.primary.mp || tpl.primary.mp || 0)) * ((build && build.mpMult) || 2)));
    const mpMax = kFin ? Math.max(mpBase, Math.round((Number(state.personaggio.mpMaxTracked) || 0) * kFin), 2 * costoMP({ costoMP: 'regola' })) : mpBase;
    const fase0 = (sh.fasi || []).find(f => f.condizione && f.condizione.inizio) || null;
    return {
      uid: unitId + '#' + idx, id: unitId, base: sh.base, nome: sh.nome + (idx > 1 || (sh.gruppoDefault || 1) > 1 ? ' ' + idx : ''), livello,
      categoria: sh.categoria, tattica: (fase0 && fase0.tattica) || sh.tattica, fase: fase0 ? fase0.id : null,
      primary: c.primary, traits: c.traits, hp: hpMax, hpMax, mp: mpMax, mpMax, pr: build ? build.prIniziali : 0,
      posizione: (fase0 && fase0.posizione) || sh.posizione || 'mischia', stati: [], attivo: true, esito: null,
      protegge: null, guardia: 0, esposto: 0, boost: null, sbloccate: [], ultimaAzione: null, danniInflitti: 0,
      attacco: Object.assign({}, tpl.attacco),
      // dotazione: l'armatura entra nella salvezza, lo scudo rende possibile il Blocco
      equip: (sh.equipaggiamento || []).filter(e => e.tipo !== 'descrittivo').map(e => ({ id: e.id, nome: e.nome, tipo: e.tipo, dif: e.dif })),
      oggetti: (sh.oggetti || []).map(o => ({ id: o.id, nome: o.nome || null, catalogo: o.catalogo || null, rimasti: Number(o.qty) || 1, cura: o.cura || null, curaPercentuale: o.curaPercentuale || null, bottino: o.bottino !== false })),
      scudoFino: 0, bloccoSenzaScudo: !!sh.bloccoSenzaScudo,
      dannoMolt: fin ? dannoSpecchio(sh, tpl, state.personaggio, fin) : undefined
    };
  }
  /* Scontro finale (decisione dell'autore, 2026-10-02: sfida paragonabile
     al giocatore). Il villain ha la stessa somma di statistiche di
     combattimento del protagonista, distribuita secondo la propria build, e
     i suoi stessi tratti di combattimento: la sfida segue la forza reale
     del personaggio, non il livello nominale. */
  const STAT_SPECCHIO = ['for', 'mira', 'vel', 'fmen', 'dex', 'dif', 'dmen'];
  function specchia(c, tpl, pg) {
    const somma = o => STAT_SPECCHIO.reduce((a, k) => a + (Number((o || {})[k]) || 0), 0);
    const r = somma(pg.primary) / Math.max(1, somma(tpl.primary));
    STAT_SPECCHIO.forEach(k => { c.primary[k] = Math.max(1, Math.round((Number(tpl.primary[k]) || 0) * r)); });
    // tratti di combattimento: quelli del protagonista con gli stessi valori,
    // più i tratti propri del villain che il protagonista non ha (Lv 1)
    const pgTr = (pg.traits && pg.traits.capacitaCombattive) || {};
    c.traits = Object.assign({}, tpl.traits || {});
    Object.entries(pgTr).forEach(([k, v]) => { c.traits[k] = Number(v) || 0; });
    return c;
  }
  // il colpo base del villain (senza costo) rapportato al colpo migliore del protagonista
  function dannoSpecchio(sh, tpl, pg, fin) {
    const danni = [].concat((pg.equip || []).filter(e => e.tipo === 'arma' && Number.isFinite(e.atk)).map(e => e.atk),
      [].concat(pg.abilita || [], pg.tecniche || []).filter(a => a.tipo === 'danno' && Number.isFinite(a.dannoBase)).map(a => a.dannoBase));
    const migliore = danni.length ? Math.max.apply(null, danni) : 0;
    const proprio = Math.max.apply(null, [Number((tpl.attacco || {}).dannoBase) || 0].concat([].concat(sh.tecniche || [], sh.magie || []).filter(c => c.tipo === 'attacco' && !c.condizione && (c.costoMP === 0 || c.costoMP == null)).map(c => Number(c.dannoBase) || 0)));
    if (!migliore || !proprio) return 1;
    return Math.max(1, Math.min(fin.dannoMassimoMolt || 3, Math.round((migliore * (fin.dannoRispettoAlPg || 1) / proprio) * 100) / 100));
  }
  /* Cura di un oggetto dell'unità: dal catalogo della campagna (effetto.hp)
     o dalla scheda (cura fissa o percentuale degli HP massimi). */
  function curaOggetto(content, u, o) {
    const def = o.catalogo ? ((content.borsa || {}).oggetti || {})[o.catalogo] : null;
    if (def) return Number((def.effetto || {}).hp) || 0;
    if (o.curaPercentuale) return Math.max(1, Math.round(u.hpMax * o.curaPercentuale));
    return Number(o.cura) || 0;
  }
  function nomeOggetto(content, o) {
    const def = o.catalogo ? ((content.borsa || {}).oggetti || {})[o.catalogo] : null;
    return (def && def.nome) || o.nome || o.id;
  }
  function haScudo(u, round) { return !!u.bloccoSenzaScudo || (u.equip || []).some(e => e.tipo === 'scudo') || (u.scudoFino || 0) >= round; }
  /* Scontro con i partecipanti reali della scena: iniziativa, ambiente,
     preparazione del giocatore (fatti, oggetti, flag dei dati). */
  function creaIncontro(state, content, nemicoId, opts, livello) {
    const comp = composizione(state, content, nemicoId);
    if (!comp) return null;
    const conta = {};
    const nemici = comp.unita.map(u => { conta[u] = (conta[u] || 0) + 1; return creaUnita(state, content, u, conta[u], livello); });
    const def = comp.def || {};
    const leader = def.leader ? nemici.find(n => n.id === def.leader) : null;
    // più partecipanti: ognuno più debole di un avversario singolo (proposta)
    const bg = S(content).bilanciamentoGruppo;
    if (nemici.length > 1 && bg) nemici.forEach(n => {
      const capo = leader ? n === leader : false;
      n.hpMax = Math.max(1, Math.round(n.hpMax * (capo ? bg.hpMolt.capo : bg.hpMolt.altri))); n.hp = n.hpMax;
      n.dannoMolt = capo ? bg.dannoMolt.capo : bg.dannoMolt.altri;
    });
    const inc = {
      nemicoId, gruppo: true, nemici, leader: leader ? leader.uid : null, bersaglio: (leader || nemici[0]).uid,
      round: 1, letale: !!opts.letale, fonte: opts.fonte, finale: !!opts.finale, log: [], funzione: def.funzione || 'minaccia',
      ambiente: def.ambiente || null, preparazione: [], negoziabile: false, conseguenze: def.conseguenze || {},
      osservati: {}, ultimaAzionePg: null, segnato: 0, attacchiRound: []
    };
    // preparazione: condizioni dei dati soddisfatte dal protagonista
    (def.preparazione || []).forEach(p => {
      const cond = p.condizione || {};
      let ok = false;
      if (cond.fatto_scoperto) ok = (state.fattiScoperti || []).indexOf(cond.fatto_scoperto) !== -1;
      else if (cond.flag) ok = !!(state.flags || {})[cond.flag];
      else if (cond.possiedeTag) ok = Object.values((state.borsa || {}).istanze || {}).some(i => i.stato === 'raccolto' && (i.tag || []).indexOf(cond.possiedeTag) !== -1) || (state.inventario || []).some(i => (i.tag || []).indexOf(cond.possiedeTag) !== -1);
      if (!ok) return;
      inc.preparazione.push(p.nota || 'preparazione');
      if (p.effetto === 'negoziato') inc.negoziabile = true;
      else if (p.effetto && p.effetto.svantaggioNemico) nemici.forEach(n => Object.entries(p.effetto.svantaggioNemico).forEach(([k, v]) => { n.primary[k] = Math.max(0, (Number(n.primary[k]) || 0) + v); }));
    });
    inc.ordine = ordineIniziativa(state, inc);
    // ambiente che pesa sul protagonista dall'inizio (es. il ghiaccio)
    const amb = def.ambiente && def.ambiente.effetto;
    if (amb && amb.stato && amb.bersaglio === 'pg') {
      const st = statoMotore(content, amb.stato);
      if (st) { state.supporti = state.supporti || []; state.supporti.push(Object.assign({}, st, { round: 1 + (st.durataTurni || 1), fonte: def.ambiente.id, ambiente: true })); inc.ambienteApplicato = amb.stato; }
    }
    inc.nemico = JSON.parse(JSON.stringify((leader || nemici[0])));
    return inc;
  }
  function ordineIniziativa(state, inc) {
    const pgVel = Number(state.personaggio.primary.vel) || 0;
    return [{ uid: 'pg', vel: pgVel }].concat(inc.nemici.map(n => ({ uid: n.uid, vel: vel(n) }))).sort((a, b) => b.vel - a.vel || (a.uid === 'pg' ? -1 : b.uid === 'pg' ? 1 : 0)).map(x => x.uid);
  }
  function attive(inc) { return inc.nemici.filter(n => n.attivo); }
  function unita(inc, uid) { return inc.nemici.find(n => n.uid === uid) || null; }

  /* ------------------------------------------------ percezione */
  function osserva(inc, azione) {
    if (!inc) return;
    const k = azione.magica ? 'magia' : azione.tipo;
    inc.osservati = inc.osservati || {};
    inc.osservati[k] = (inc.osservati[k] || 0) + 1;
    if (azione.capacita) inc.osservati['cap:' + azione.capacita] = (inc.osservati['cap:' + azione.capacita] || 0) + 1;
    inc.ultimaAzionePg = k;
  }
  function percezione(state, inc) {
    const pg = state.personaggio;
    const quota = pg.hpCur / Math.max(1, pg.hpMaxTracked || pg.hpCur);
    const ab = Object.entries(inc.osservati || {}).filter(([k]) => k.indexOf('cap:') !== 0).sort((a, b) => b[1] - a[1])[0] || null;
    return { ferito: quota < 0.5, statiEvidenti: (state.supporti || []).filter(s => s.stato && s.round >= inc.round).map(s => s.stato), abitudine: ab, capacitaViste: Object.keys(inc.osservati || {}).filter(k => k.indexOf('cap:') === 0).map(k => k.slice(4)) };
  }

  /* ------------------------------------------------------- fasi */
  function condizioneFase(inc, u, cond) {
    if (!cond) return false;
    if (cond.qualunque) return cond.qualunque.some(c => condizioneFase(inc, u, c));
    if (cond.tutti) return cond.tutti.every(c => condizioneFase(inc, u, c));
    if (cond.hpSotto != null) return u.hp / Math.max(1, u.hpMax) <= cond.hpSotto;
    if (cond.alleatiAttiviAlPiu != null) return attive(inc).filter(n => n.uid !== u.uid).length <= cond.alleatiAttiviAlPiu;
    if (cond.roundAlmeno != null) return inc.round >= cond.roundAlmeno;
    return false;
  }
  function prossimaFase(content, inc, u) {
    const sh = scheda(content, u.id);
    const fasi = (sh && sh.fasi) || [];
    const i = fasi.findIndex(f => f.id === u.fase);
    const next = fasi[i + 1];
    return next && condizioneFase(inc, u, next.condizione) ? next : null;
  }
  function entraInFase(u, f) {
    u.fase = f.id;
    if (f.tattica) u.tattica = f.tattica;
    if (f.posizione) u.posizione = f.posizione;
    if (f.sblocca && u.sbloccate.indexOf(f.sblocca) === -1) u.sbloccate.push(f.sblocca);
  }

  /* ------------------------------------------------------- decisione
     Tattica per categoria e difficoltà. Restituisce l'azione con motivo e
     segnale leggibile. */
  function capacitaDi(content, u) {
    const sh = scheda(content, u.id);
    return [].concat(sh.tecniche || [], sh.magie || []).filter(c => !c.condizione || !c.condizione.fase || u.sbloccate.indexOf(c.id) !== -1 || u.fase === c.condizione.fase);
  }
  function costoMP(c, u) { return c.costoMP === 'regola' ? (typeof abilitaCostoForLv === 'function' ? abilitaCostoForLv(1) : 6) : (Number(c.costoMP) || 0); }
  function sceltaAlleato(dif, inc, u, filtro) {
    const cand = attive(inc).filter(n => n.uid !== u.uid && filtro(n));
    if (!cand.length) return null;
    const sel = dif.selezioneBersagli || 'piu_ferito';
    if (sel === 'primo_disponibile') return cand[0];
    const ferito = cand.slice().sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax)[0];
    if (sel === 'capo_poi_piu_ferito') { const capo = cand.find(n => n.uid === inc.leader); return capo || ferito; }
    return ferito;
  }
  // passive della scheda che cambiano il comportamento del gruppo
  function passivaAttiva(content, inc, id) { return attive(inc).some(n => ((scheda(content, n.id) || {}).passive || []).some(p => p.id === id)); }
  function decidi(state, content, inc, u) {
    const sh = scheda(content, u.id);
    const dif = difficolta(state, content);
    const tat = tattica(content, u.tattica);
    const caps = capacitaDi(content, u);
    const per = percezione(state, inc);
    const quota = u.hp / Math.max(1, u.hpMax);
    const di = t => caps.filter(c => c.tipo === t && (u.mp >= costoMP(c, u)));
    // fase del boss o del miniboss: condizione definita nella scheda
    const f = prossimaFase(content, inc, u);
    if (f) return { tipo: 'fase', fase: f, motivo: 'condizione di fase raggiunta', segnale: f.segnale };
    // morale: fuga o resa individuale (la difficoltà sposta le soglie)
    const m = sh.morale || {};
    // catena di comando: finché il capo è in piedi i suoi resistono di più
    const catena = u.uid !== inc.leader && passivaAttiva(content, inc, 'catena_di_comando') ? 0.5 : 1;
    const soglia = (m.fugaSotto || 0) * (dif.fugaMolt || 1) * catena;
    if (soglia > 0 && quota <= soglia && u.categoria !== 'boss') {
      if (m.resa && !per.ferito) return { tipo: 'resa', motivo: 'ferito, davanti a un avversario ancora in forze', segnale: 'abbassa l\'arma' };
      return { tipo: 'fuga', motivo: 'ferito oltre la sua tenuta', segnale: 'arretra cercando una via' };
    }
    // risorse: Boost secondo l'uso delle risorse della difficoltà
    if (sh.boost && !u.boost && u.pr >= 8 && (dif.usoRisorse === 'pieno' || (dif.usoRisorse === 'normale' && inc.round >= 2) || (dif.usoRisorse === 'conserva' && quota < 0.5))) return { tipo: 'boost', boost: sh.boost, motivo: 'attiva il Boost', segnale: sh.boost.segnale };
    // oggetto: sotto il 40% degli HP usa una cura che porta con sé (non le bestie)
    const curaPropria = u.categoria !== 'bestia' && quota < 0.4 ? (u.oggetti || []).find(o => o.rimasti > 0 && curaOggetto(content, u, o) > 0) : null;
    if (curaPropria) return { tipo: 'oggetto', oggetto: curaPropria.id, motivo: 'si cura con ' + nomeOggetto(content, curaPropria), segnale: 'fruga nella dotazione' };
    // difesa evocata (scudo della gemma): una volta finché dura
    const evoca = di('difesa')[0];
    if (evoca && (u.scudoFino || 0) < inc.round && quota < 0.75) return { tipo: 'scudo', capacita: evoca, motivo: 'evoca uno scudo', segnale: evoca.segnale };
    // supporto: cura un alleato ferito
    // la guida dei custodi: senza di lei i custodi non si ricuciono a vicenda
    const cure = di('cura').filter(c => !(c.id === 'ricucire' && !passivaAttiva(content, inc, 'guida')));
    if (cure.length) {
      const soglia2 = dif.usoRisorse === 'conserva' ? 0.35 : 0.6;
      const a = sceltaAlleato(dif, inc, u, n => n.hp / n.hpMax < soglia2);
      if (a) return { tipo: 'cura', capacita: cure[0], bersaglio: a.uid, motivo: 'cura ' + a.nome, segnale: cure[0].segnale };
    }
    // protezione: fa da scudo al capo o al più ferito
    const prot = di('protezione');
    if (prot.length && !u.protegge) {
      const a = sceltaAlleato(dif, inc, u, n => n.posizione === 'distanza' || n.hp / n.hpMax < 0.5);
      if (a && (a.uid === inc.leader || quota > 0.5)) return { tipo: 'proteggi', capacita: prot[0], bersaglio: a.uid, motivo: 'protegge ' + a.nome, segnale: prot[0].segnale };
    }
    // coordinamento: segna il protagonista per gli altri a turni alterni (solo se la difficoltà lo prevede)
    const coord = di('coordinamento');
    if (coord.length && dif.coordinamento && attive(inc).length > 1 && inc.segnato < inc.round - 1) return { tipo: 'coordina', capacita: coord[0], motivo: 'coordina l\'attacco', segnale: coord[0].segnale };
    // il colpo sbloccato dalla fase ha la precedenza: la fase cambia la tattica
    const sbloccoFase = caps.find(c => u.sbloccate.indexOf(c.id) !== -1 && u.mp >= costoMP(c, u) && !(c.dopo && u.esposto >= inc.round));
    if (sbloccoFase && !(u.ultimaAzione === sbloccoFase.id)) { u.ultimaAzione = sbloccoFase.id; return { tipo: 'attacco', capacita: sbloccoFase, motivo: 'usa il colpo della sua fase', segnale: sbloccoFase.segnale }; }
    u.ultimaAzione = null;
    // aggressività: sotto la soglia di difesa si copre (se può)
    if (quota < (dif.sogliaDifesa || 0.5) && tat.difesaSottoMeta && !u.guardia) return { tipo: 'difesa', motivo: 'ferito: si copre', segnale: 'si mette al riparo' };
    // adattamento: abitudini osservate (solo percepite)
    const ctrl = di('controllo').concat(di('canalizza'));
    if (dif.adattamento && per.abitudine && per.abitudine[1] >= dif.adattamento && tat.adattamento) {
      if (per.abitudine[0] === 'magia' && ctrl.length && per.statiEvidenti.indexOf(ctrl[0].stato) === -1) return { tipo: 'attacco', capacita: ctrl[0], motivo: 'ha visto la tua magia: prova a interromperla', segnale: ctrl[0].segnale };
      if (per.abitudine[0] === 'attacco' && tat.difesaSottoMeta && !u.guardia) return { tipo: 'difesa', motivo: 'ha letto i tuoi colpi', segnale: 'si copre aspettando il tuo colpo' };
    }
    // capacità speciali: controllo per specialisti e boss, colpo sbloccato dalla fase
    const sblocco = caps.find(c => u.sbloccate.indexOf(c.id) !== -1 && u.mp >= costoMP(c, u));
    if (sblocco) return { tipo: 'attacco', capacita: sblocco, motivo: 'usa il colpo della sua fase', segnale: sblocco.segnale };
    if (ctrl.length && tat.controllo && per.statiEvidenti.indexOf(ctrl[0].stato) === -1 && (dif.usoRisorse !== 'conserva' || costoMP(ctrl[0], u) === 0)) return { tipo: 'attacco', capacita: ctrl[0], motivo: 'la sua specialità', segnale: ctrl[0].segnale };
    const att = di('attacco');
    // bestia: il colpo che fa sanguinare se il bersaglio non sanguina già
    const lacera = att.find(c => c.stato && per.statiEvidenti.indexOf(c.stato) === -1);
    if (lacera && (u.categoria === 'bestia' || dif.aggressivita !== 'bassa')) return { tipo: 'attacco', capacita: lacera, motivo: 'istinto', segnale: lacera.segnale };
    // magia d'attacco se le risorse lo consentono
    const magia = att.find(c => costoMP(c, u) > 0);
    if (magia && dif.usoRisorse !== 'conserva') return { tipo: 'attacco', capacita: magia, motivo: 'usa le sue risorse', segnale: magia.segnale };
    // senza un attacco pagabile resta l'attacco base del modello (mai un turno senza azione)
    const base = att.find(c => costoMP(c, u) === 0) || att[0] || (u.attacco && u.attacco.nome ? Object.assign({ id: 'attacco_base', tipo: 'attacco', bersaglio: 'pg', costoMP: 0 }, u.attacco) : null);
    if (!base) return { tipo: 'difesa', motivo: 'nessun attacco disponibile', segnale: 'si mette al riparo' };
    // posizione: a distanza con un'arma da mischia si avvicina
    if (base && base.stat === 'for' && u.posizione === 'distanza') return { tipo: 'avvicina', capacita: base, motivo: 'si avvicina', segnale: 'avanza verso di te' };
    return { tipo: 'attacco', capacita: base, motivo: 'attacca', segnale: null };
  }

  /* Reazioni dichiarate nella scheda che scattano su un evento dello scontro. */
  function reazioni(content, u, evento) {
    const sh = scheda(content, u.id);
    return ((sh && sh.reazioni) || []).filter(r => r.quando === evento);
  }

  /* Dopo l'uscita del capo (o di un'unità) il resto decide: resa o fuga
     collettiva secondo il morale e la difficoltà. */
  function moraleCollettivo(state, content, inc, causa) {
    const dif = difficolta(state, content);
    const out = [];
    attive(inc).forEach(n => {
      const sh = scheda(content, n.id);
      const m = sh.morale || {};
      if (n.categoria === 'boss' || n.categoria === 'miniboss') return;
      const quota = n.hp / n.hpMax;
      const cede = causa === 'capo_arreso' || causa === 'capo_fuggito' || (causa === 'capo_sconfitto' && quota < 0.6 * (dif.resaMolt || 1));
      if (!cede) return;
      if (causa === 'capo_fuggito' || !m.resa) { n.attivo = false; n.esito = 'fuggito'; out.push({ uid: n.uid, esito: 'fuggito' }); }
      else { n.attivo = false; n.esito = 'arreso'; out.push({ uid: n.uid, esito: 'arreso' }); }
    });
    return out;
  }
  // esito complessivo quando non restano oppositori attivi
  function esitoComplessivo(inc) {
    const e = inc.nemici.map(n => n.esito);
    if (e.every(x => x === 'fuggito')) return 'nemico_fuggito';
    if (e.some(x => x === 'arreso') && !e.some(x => x === 'sconfitto' || x === 'incapacitato')) return 'resa';
    return 'vittoria';
  }

  // fuga del protagonista: NC secondo la difficoltà (proposta)
  function modFuga(state, content, id) {
    if (!attivo(state, content, id)) return 0;
    const m = difficolta(state, content).fugaMolt || 1;
    return m > 1 ? -2 : m < 1 ? 2 : 0;
  }

  /* ------------------------------------------ incontri con funzione */
  function generaIncontro(state, content, funzione) {
    if (FUNZIONI_INCONTRO.indexOf(funzione) === -1) return { ok: false, motivo: 'funzione non prevista' };
    const def = incontroDef(state, content);
    const unitaDisp = Object.values((S(content) || {}).avversari || {}).filter(a => !a.separataDalBilanciamento);
    const u = def ? def.unita : unitaDisp.slice(0, 1).map(a => a.id);
    if (!u.length) return { ok: false, motivo: 'nessun avversario disponibile' };
    return { ok: true, unita: u, funzione, posta: funzione === 'prezzo' ? 'una risorsa o un tempo da pagare' : funzione === 'rivelazione' ? 'ciò che l\'avversario porta con sé' : funzione === 'pressione' ? 'il tempo che scorre' : funzione === 'prova' ? 'chi sei davanti a chi ti sbarra la strada' : 'la sicurezza del luogo', esitiPossibili: ESITI.slice(), fonte: def ? 'dati+proposta' : 'proposta' };
  }

  /* --------------------------------------------------- loot coerente
     Dagli avversari DAVVERO presenti e usciti dallo scontro (sconfitti o
     arresi), secondo il loro profilo di equipaggiamento e il loro popolo.
     Una creatura lascia solo resti grezzi; gli oggetti lavorati (anche in
     osso di Tèras) vengono da chi li porta, senza esclusive di popolo. */
  const CORPOREO = /t[eè]ras|resti|tendin|osso|pelle|zanna|artigl/i;
  function lootEsclusi(content, unitId, poolId) {
    const sh = scheda(content, unitId);
    const L = content.loot;
    if (!sh || !L || !L.pool || !L.pool[poolId]) return [];
    const prof = ((S(content) || {}).profiliEquipaggiamento || {})[sh.equipmentProfileId] || { categorie: [] };
    return L.pool[poolId].modelli.filter(mid => {
      const t = L.modelli[mid]; if (!t) return true;
      const basi = (t.basi || []).map(b => L.componenti.basi[b] || {});
      const testo = (t.descrizione || '') + ' ' + basi.map(b => b.nome).join(' ');
      const corporeo = basi.every(b => b.categoria === 'materiale') && CORPOREO.test(testo);
      if (prof.resti) return !(corporeo && (sh.enemyFamilyId === 'teras' || !/t[eè]ras/i.test(testo)));
      if (corporeo) return true;
      if (!basi.every(b => prof.categorie.indexOf(b.categoria) !== -1)) return true;
      const ff = (t.filtri || {}).fazione;
      if (ff && ff.length && !ff.some(f => f.toLowerCase() === String(sh.peopleId || '').toLowerCase())) return true;
      return false;
    });
  }

  global.RMSoloAvversari = {
    CATEGORIE, DANNO_BASE_MAX_LV1, ESITI, ESITI_UNITA, FUNZIONI_INCONTRO,
    scheda, attivo, composizione, difficolta, validaScheda, statoMotore, tickStati, rimuoviStati,
    creaIncontro, creaUnita, villainFinale, specchia, dannoSpecchio, curaOggetto, nomeOggetto, haScudo, ordineIniziativa, attive, unita, osserva, percezione,
    prossimaFase, entraInFase, condizioneFase, decidi, reazioni, moraleCollettivo, esitoComplessivo,
    costoMP, modFuga, generaIncontro, lootEsclusi
  };
})(typeof window !== 'undefined' ? window : globalThis);
