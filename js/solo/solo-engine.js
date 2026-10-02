/* ==========================================================================
   Role Makers — Gioca in solitaria: motore autorevole della partita.

   Tutto locale, tutto puro: applyCommand(stato, comando, ambiente)
   restituisce un NUOVO stato e l'evento prodotto, senza toccare l'input,
   senza DOM, senza rete. È il solo punto che decide tiri, costi, danni,
   ricompense, avanzamenti, morte e sanzioni; l'IA propone (interpretazione)
   e racconta (narrazione), ma non scrive mai nello stato:
   - le proposte dell'interprete vengono convalidate qui (obiettivo della
     scena corrente, tratto realmente in scheda, oggetto realmente in
     inventario e pertinente);
   - la narrazione si aggancia a un evento già risolto (attachNarration) e
     viene respinta se contraddice lo stato (validateNarration).

   Idempotenza: ogni comando ha un id. Lo stesso id riapplicato restituisce
   l'evento già registrato (stessi dadi, nessun secondo premio); un comando
   con una versione attesa diversa da quella dello stato è rifiutato
   (doppio tap, due schede aperte, ripresa dopo un crash).

   Formato della partita: 'rm-solo-partita/1'. I contenuti (capitolo,
   borsa, PNG) arrivano da js/solo/content/*.json e sono referenziati per
   id + versione, mai copiati nello stato oltre il necessario.
   ========================================================================== */
(function (global) {
  'use strict';

  const R = () => global.RMSoloRules;
  const M = () => global.RMSoloModeration;
  const C = () => global.RMSoloCampaign;
  const L = () => global.RMSoloLoot;

  // Dadi ed evento del comando in corso: gli effetti annidati (loot nelle
  // conseguenze differite, snodi raggiunti) li usano senza doverli passare
  // attraverso ogni funzione. Validi solo dentro applyCommand/newGame.
  let curDice = null, curEvent = null;

  const SCHEMA = 'rm-solo-partita/1';
  const STATI_FINALI = ['morto', 'concluso', 'terminato'];

  const RAVEN_TESTO = "Il Corvo Raven ha osservato le tue azioni, potrà sembrarti divertente sperimentare queste atrocità su personaggi fittizi, ma se fossero reali tu avresti causato enormi sofferenze e questo è inaccettabile. Raven ora si allontana, disgustata dall'aver sporcato la sua lama con '{NOME}', prosegue i suoi passi con la speranza di non fare mai più ritorno da te";

  const TESTO_BLOCCO_SV = 'Azione bloccata. Il tentativo di violenza sessuale non viene rappresentato. Per le regole della piattaforma il personaggio muore e la partita si conclude definitivamente, in qualunque difficoltà.';
  const TESTO_CRUDELTA = 'Il gesto è compiuto, lontano da occhi pietosi. Ma chi ne viene a sapere non lo dimenticherà: da questo momento sei ricercato, e qualcosa ha cominciato a seguirti.';

  class SoloError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  const F = () => global.RMSoloFeedback;
  const Dir = () => global.RMSoloDirector;
  const IM = () => global.RMSoloImprov;
  // campagna lunga (rm-solo-struttura/1): macro-capitoli, contratto, PNG, avversari
  const ST = () => global.RMSoloStruttura;
  const PN = () => global.RMSoloPng;
  const AV = () => global.RMSoloAvversari;
  const MP = () => global.RMSoloMappa;
  function strutturaMode(content) { return !!(ST() && ST().attivo(content)); }
  // scene-seme (rm-solo-semi/1): le interazioni scritte sono materiale di
  // riferimento, non cancelli; senza semi vale il comportamento classico
  function semiMode(content) { return !!(IM() && IM().modoSemi(content)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function ravenText(nome) {
    // testo fisso: solo il segnaposto viene sostituito, come testo semplice
    return RAVEN_TESTO.replace('{NOME}', String(nome || '').replace(/[\u0000-\u001f]/g, ''));
  }

  /* --------------------------------------------------------- creazione */

  function rollQI(dice) {
    // Q.I. = (1d4 + 1d6 + 1d10) x 10 (js/rules.js, "Q.I.")
    return (dice.roll(4, 'Q.I. (d4)') + dice.roll(6, 'Q.I. (d6)') + dice.roll(10, 'Q.I. (d10)')) * 10;
  }

  /* Scheda di Lv 1 dall'archetipo, nel formato delle schede dell'app
     (sottoinsieme): HP/MP con i moltiplicatori di BUILDS, PR iniziali,
     PP = metà HP + metà MP. Nessun AP, nessun oggetto oltre la dotazione. */
  function sheetFromArchetype(arch, dice) {
    const build = BUILDS[arch.build];
    if (!build) throw new SoloError('archetipo_non_valido', 'Classe non valida');
    const hpMult = build.hpMult || (arch.eclecticoHpMult === 5 ? 5 : 7);
    const mpMult = build.mpMult || (hpMult === 7 ? 5 : 7);
    const hpMax = arch.primary.hp * hpMult, mpMax = arch.primary.mp * mpMult;
    const abilita = (arch.abilita || []).map(a => Object.assign({ utilizzi: 0 }, clone(a)));
    const tecniche = (arch.tecniche || []).map(a => Object.assign({ utilizzi: 0 }, clone(a)));
    const qi = rollQI(dice);
    return {
      id: 'solo-pg-' + arch.id,
      archetipo: arch.id, archetipoVersione: arch.versione,
      nome: arch.nome, build: arch.build, popolazione: arch.popolazione, citta: arch.citta || null, mansione: arch.mansione,
      peopleId: (arch.ontologia || {}).peopleId || null, provenienza: arch.citta || '',
      appartenenzaPolitica: (arch.ontologia || {}).factionId === 'antarsi' ? 'Antarsi' : '',
      background: arch.background, obiettivo: arch.obiettivo,
      livello: 1, apDisponibili: 0, qi,
      primary: clone(arch.primary), tertiary: clone(arch.tertiary), traits: clone(arch.traits),
      hpMaxTracked: hpMax, mpMaxTracked: mpMax, prMaxTracked: build.prIniziali,
      hpCur: hpMax, mpCur: mpMax, prCur: build.prIniziali, ppCur: hpMax / 2 + mpMax / 2,
      tecniche, abilita, equip: clone(arch.equip || []),
      // gemme dei Chorisfos: ciascuna attiva o scarica (mai cariche)
      gemme: Array.isArray(arch.gemme) ? arch.gemme.map(gemmaDa) : [],
      capacitaSpeciali: clone(arch.capacitaSpeciali || []),
      // slot di classe dichiarati vuoti nei dati (nessuna capacità inventata)
      slotVacanti: clone(arch.slotVacanti || []),
      // capacità che la classe non ospita (proposta separata, fuori dagli slot)
      capacitaIncompatibili: (arch.capacitaIncompatibili || []).map(x => Object.assign({ utilizzi: 0 }, clone(x.capacita))),
      migrazioni: [],
      ritratto: null
    };
  }

  function gemmaDa(g) {
    const out = { id: g.id, tipo: g.tipo, nome: g.nome, capacitaAssociata: g.capacitaAssociata, effettoAttivo: g.effettoAttivo, stato: 'attiva', reintegrabile: g.reintegrabile !== false };
    if (g.capacitaSospesa) out.capacitaSospesa = true;
    return out;
  }

  /* Vincolo del livello 1 (specifica §6): Tecniche/Abilità create per il
     Lv 1 non superano 10 di danno base per colpo, contando insieme le
     componenti dello stesso colpo. Slot per classe da tecAbSbloccate. */
  function validateArchetype(arch, content) {
    const errors = [];
    const sum = Object.values(arch.primary || {}).reduce((a, b) => a + Number(b || 0), 0);
    if (sum !== PRIMARY_POOL) errors.push('Statistiche primarie: ' + sum + ' punti invece di ' + PRIMARY_POOL);
    Object.entries(arch.primary || {}).forEach(([k, v]) => { if (Number(v) < PRIMARY_MIN) errors.push('Statistica ' + k + ' sotto il minimo'); });
    Object.entries(arch.traits || {}).forEach(([list, obj]) => {
      const tot = Object.values(obj).reduce((a, b) => a + Number(b || 0), 0);
      if (tot > TRAIT_POOL_PER_LIST) errors.push('Tratti ' + list + ': ' + tot + ' punti oltre ' + TRAIT_POOL_PER_LIST);
    });
    const tert = Object.values(arch.tertiary || {}).reduce((a, b) => a + Number(b || 0), 0);
    if (tert !== TERTIARY_POOL) errors.push('Terziarie: ' + tert + ' punti invece di ' + TERTIARY_POOL);
    const slots = tecAbSbloccate(arch.build, 1, {});
    // uno slot può restare vuoto solo se dichiarato (slotVacanti) in attesa dell'autore
    const vac = t => (arch.slotVacanti || []).filter(v => v.tipo === t && v.livello === 1).length;
    if ((arch.tecniche || []).length + vac('tecnica') !== slots.tec) errors.push('Tecniche: ' + (arch.tecniche || []).length + ' invece di ' + slots.tec);
    if ((arch.abilita || []).length + vac('abilita') !== slots.ab) errors.push('Abilità: ' + (arch.abilita || []).length + ' invece di ' + slots.ab);
    (arch.capacitaIncompatibili || []).forEach(x => { if ([].concat(arch.tecniche || [], arch.abilita || []).some(t => t.id === x.capacita.id)) errors.push(x.capacita.nome + ': incompatibile con la classe ma ancora in scheda'); });
    // ontologia dell'ambientazione (campi strutturati, appartenenze, classi ammesse)
    if (global.RMSoloOntologia && content && content.storia && content.content_status != null) global.RMSoloOntologia.validaPreset(arch, content.storia).forEach(x => errors.push('ontologia: ' + x));
    [].concat(arch.tecniche || [], arch.abilita || []).forEach(t => {
      const base = (Number(t.dannoBase) || 0) + (Number(t.dannoBase2) || 0);
      if (base > 10) errors.push(t.nome + ': danno base ' + base + ' oltre 10 al Lv 1');
    });
    if (arch.popolazione === 'Epizi' && arch.build === 'mago') errors.push('Epizi: Mago non ammesso alla creazione');
    // un tratto non può chiamarsi come una statistica primaria (es. "Mira")
    const PRIMARIE = ['HP', 'MP', 'Forza', 'Mira', 'Velocità', 'Forza Magica', 'Destrezza', 'Difesa', 'Difesa Magica'];
    Object.values(arch.traits || {}).forEach(obj => Object.keys(obj).forEach(k => { if (PRIMARIE.indexOf(k) !== -1) errors.push('Tratto "' + k + '": stesso nome di una statistica primaria'); }));
    // Definizione dell'archetipo (pacchetto avventure §5)
    ['id', 'versione', 'stato_editoriale', 'nome', 'popolazione', 'mansione', 'build', 'background', 'obiettivo'].forEach(k => { if (!arch[k] && !(k === 'popolazione' && content && content.storia === 'eidos' && arch.ontologia && arch.ontologia.peopleId === null && /autore/i.test((arch.ontologia.fonti || {}).peopleId || ''))) errors.push('Campo mancante: ' + k); });
    if (['bozza', 'approvato'].indexOf(arch.stato_editoriale) === -1) errors.push('stato_editoriale non valido');
    if (!Array.isArray(arch.legami_iniziali)) errors.push('legami_iniziali mancanti');
    if (!Array.isArray(arch.conoscenze)) errors.push('conoscenze iniziali mancanti');
    if (!Array.isArray(arch.occasioni_sviluppo) || [1, 2, 3].some(n => !arch.occasioni_sviluppo.some(o => o.atto === n))) errors.push('occasioni di sviluppo: una per ciascuno dei tre atti');
    (arch.equip || []).forEach(e => {
      // Ich/Icaro: dotazione solo descrittiva finché il catalogo non esiste
      // (nessuna statistica, nessun uso in combattimento)
      if (e.tipo === 'descrittivo') { if (e.atk != null || e.dif != null) errors.push(e.nome + ': dotazione descrittiva con statistiche'); return; }
      if (!e.base) errors.push(e.nome + ': equipaggiamento senza voce di catalogo');
      if (['arma', 'scudo', 'armatura'].indexOf(e.tipo) !== -1 && global.RMSoloLoot) {
        global.RMSoloLoot.checkEquipStats(e.tipo, e.taglia, e.qualita, { atk: e.atk, dif: e.dif, durabilita: e.durabilita }).forEach(x => errors.push(e.nome + ': ' + x));
      }
    });
    if (content) {
      if (arch.capitolo !== content.id) errors.push('archetipo di un\'altra campagna (' + arch.capitolo + ')');
      // campi mostrati in selezione: niente lessico riservato né segreti
      const rules = C().lockedLexicon(null, content);
      publicArchetypeTexts(arch).forEach(t => C().lexiconHits(t, rules).forEach(h => errors.push('testo pubblico con lessico riservato (' + h + ')')));
      if (content.content_status != null) C().META.forEach(k => { if (!(k in arch)) errors.push('metadato ' + k + ' mancante'); });
      (arch.conoscenze || []).forEach(f => { if (!content.fatti[f]) errors.push('conoscenza inesistente ' + f); else if (content.fatti[f].segreto) errors.push('conoscenza iniziale ' + f + ' è una verità riservata'); });
      (arch.legami_iniziali || []).forEach(l => { if (!content.png[l.png]) errors.push('legame con PNG inesistente ' + l.png); });
      // zaino iniziale: solo oggetti del catalogo della campagna
      (arch.inventarioIniziale || []).forEach(x => {
        const o = content.borsa && content.borsa.oggetti[x.id];
        if (!o) errors.push('zaino iniziale: oggetto inesistente ' + x.id);
        else if (!(Number(x.qty) > 0)) errors.push('zaino iniziale: quantità non valida per ' + x.id);
        else if (o.tipo === 'oggetto_chiave' || o.tipo === 'indizio') errors.push('zaino iniziale: ' + x.id + ' è un oggetto di trama');
      });
      const bases = content.loot && content.loot.componenti.basi || {};
      (arch.equip || []).filter(e => e.tipo !== 'descrittivo').forEach(e => {
        const b = bases[e.base];
        if (!b) errors.push(e.nome + ': base di catalogo inesistente ' + e.base);
        else if (b.qualita !== e.qualita || (global.RMSoloLoot.TAGLIA[b.taglia] || b.taglia) !== (global.RMSoloLoot.TAGLIA[e.taglia] || e.taglia)) errors.push(e.nome + ': taglia/qualità diverse dalla voce di catalogo');
      });
    }
    return errors;
  }

  /* Testi dell'archetipo visibili in selezione, scheda, diario ed export. */
  function publicArchetypeTexts(arch) {
    return [arch.nome, arch.popolazione, arch.citta, arch.mansione, arch.background, arch.obiettivo, arch.missione_iniziale, arch.avviso_creazione, arch.ritratto_alt]
      .concat((arch.occasioni_sviluppo || []).map(o => o.possibilita))
      .concat([].concat(arch.tecniche || [], arch.abilita || []).map(t => t.nome + ' ' + (t.descrizione || '')))
      .concat((arch.equip || []).map(e => e.nome + ' ' + (e.descrizione || '')))
      .filter(Boolean);
  }

  function newGame(opts) {
    const { content, archetipo, difficolta, dice, now, id } = opts;
    if (R().DIFFICOLTA.indexOf(difficolta) === -1) throw new SoloError('difficolta_non_valida', 'Difficoltà non valida');
    if (!archetipo || archetipo.capitolo !== content.id) throw new SoloError('archetipo_non_valido', 'Archetipo non compatibile con il capitolo');
    const errs = validateArchetype(archetipo, content);
    if (errs.length) throw new SoloError('archetipo_non_valido', errs.join('; '));
    const cerr = C().validateCampaign(content);
    if (cerr.length) throw new SoloError('campagna_non_valida', cerr.join('; '));
    // in produzione solo personaggi con tutti i campi meccanici approvati;
    // l'anteprima (solo sviluppo) usa le proposte, marcate come tali
    if (!opts.anteprima && !archetypeReady(archetipo, false)) throw new SoloError('archetipo_incompleto', 'Personaggio non ancora disponibile: mancano valori meccanici approvati.');
    const pg = sheetFromArchetype(archetipo, dice);
    const png = {};
    Object.entries(content.png).forEach(([k, v]) => { png[k] = { atteggiamento: v.atteggiamento || 0, sa: (v.sa || []).slice() }; });
    const orologi = {};
    Object.entries(content.orologi || {}).forEach(([k, v]) => { orologi[k] = { valore: 0, max: v.max, attivo: false }; });
    const t = now || Date.now();
    const state = {
      schema: SCHEMA, id: id || ('solo-' + t.toString(36)), storia: content.storia,
      capitolo: content.id, contenutoVersione: content.versione, difficolta,
      stato: 'attivo', condizione: 'normale', motivoFine: null, finale: null,
      version: 0, createdAt: t, updatedAt: t,
      personaggio: pg, qiTiro: dice.log.slice(),
      scena: null, scenaPassi: 0, obiettivi: {}, scelte: {},
      flags: {}, fattiScoperti: [], png, inventario: [], ricompense: {},
      orologi, incontro: null, supporti: [],
      raven: { pending: false, apparizioni: [], esito: null }, ricercato: false,
      moderazione: [], comandi: {}, eventi: [],
      memoria: { riassunti: [] }
    };
    C().initState(state, content);
    L().ensureBag(state);
    // zaino iniziale dell'archetipo (consumabili e strumenti del catalogo)
    (archetipo.inventarioIniziale || []).forEach(x => { if (content.borsa.oggetti[x.id]) state.inventario.push({ id: x.id, qty: Number(x.qty) || 1 }); });
    // conoscenze iniziali del protagonista (dall'archetipo): fatti già noti
    (archetipo.conoscenze || []).forEach(f => { if (content.fatti[f] && state.fattiScoperti.indexOf(f) === -1) state.fattiScoperti.push(f); });
    if (content.progressione) state.progresso = { tacche: 0, totale: 0, premiati: {}, sblocchi: [] };
    if (opts.anteprima) state.anteprima = true;
    state.effettiIniziali = [];
    curDice = dice;
    try { enterScene(state, content, content.scene[0].id, dice, state.effettiIniziali); } finally { curDice = null; }
    if (Dir()) { Dir().migrate(state, content); state.narrativa.sceneEntrySnapshot = { scena: state.scena, evento: 0, hp: state.personaggio.hpCur, mp: state.personaggio.mpCur, verita: 0 }; }
    // stato personale della mappa (posizione, luoghi noti, rotte, viaggi)
    if (MP() && MP().M(content)) MP().inizia(state, content);
    return state;
  }

  /* ------------------------------------------------------------- utilità */

  function sceneOf(content, id) { return content.scene.find(s => s.id === id) || null; }
  function currentScene(state, content) { return sceneOf(content, state.scena); }
  function itemDef(content, id) { return content.borsa.oggetti[id] || null; }
  /* Nome e descrizione percepibili di una voce d'inventario: oggetto del
     catalogo della borsa oppure istanza generata. */
  function itemInfo(state, content, id) {
    const d = content.borsa.oggetti[id];
    if (d) return { id, nome: d.nome, descrizione: d.descrizione, tipo: d.tipo, proprieta: d.proprieta || [], effetto: d.effetto || null };
    const inst = state.borsa && state.borsa.istanze[id];
    if (inst) { const v = L().perceivable(inst); return { id, nome: v.nome, descrizione: v.descrizione, tipo: inst.categoria, proprieta: (inst.proprieta || []).concat(inst.tag || []), statistiche: v.statistiche, effetto: inst.effetto || null }; }
    return null;
  }
  function hasItem(state, id) { const it = state.inventario.find(i => i.id === id); return !!(it && it.qty > 0); }
  function isOver(state) { return STATI_FINALI.indexOf(state.stato) !== -1; }

  function addItem(state, content, id, sourceKey, applied) {
    const def = itemDef(content, id);
    if (!def) throw new SoloError('oggetto_sconosciuto', 'Oggetto non in catalogo: ' + id);
    // una ricompensa per fonte: rigiocare lo stesso esito non la duplica
    if (state.ricompense[sourceKey]) return;
    if (def.unico && hasItem(state, id)) { state.ricompense[sourceKey] = true; return; }
    const qty = Number(def.quantita) || 1;
    const it = state.inventario.find(i => i.id === id);
    if (it) it.qty += qty; else state.inventario.push({ id, qty });
    state.ricompense[sourceKey] = true;
    applied.push({ tipo: 'ricompensa', oggetto: id, nome: def.nome, qty });
  }

  function discover(state, content, factId, applied) {
    if (!content.fatti[factId] || state.fattiScoperti.indexOf(factId) !== -1) return;
    state.fattiScoperti.push(factId);
    applied.push({ tipo: 'scoperta', fatto: factId, testo: content.fatti[factId].testo });
  }

  /* Effetti del capitolo: insieme chiuso, ciascuno controllato. */
  function applyEffects(state, content, effects, sourceKey, applied, dice) {
    (effects || []).forEach((eff, i) => {
      if (C().applyEffect(state, content, eff, sourceKey + '#' + i, applied, curEvent)) return;
      if (eff.loot) {
        const d = dice || curDice;
        if (!d) throw new SoloError('interno', 'Loot senza dadi');
        // campagna lunga: il loot viene dagli avversari presenti e usciti dallo
        // scontro (sconfitti o arresi), secondo il loro profilo
        const inc = state.incontro;
        if (inc && inc.gruppo) {
          const fonti = inc.nemici.filter(n => n.esito === 'sconfitto' || n.esito === 'arreso' || n.esito === 'incapacitato');
          const pool = content.loot.pool[eff.loot.pool] || {};
          const qta = (pool.quantita && pool.quantita[state.difficolta]) != null ? pool.quantita[state.difficolta] : 1;
          for (let q = 0; q < qta && fonti.length; q++) {
            const u = fonti[q % fonti.length];
            L().generateReward(state, content.loot, { pool: eff.loot.pool, quantita: 1, unita: u.uid, contesto: Object.assign({ contesto: eff.loot.contesto, luogo: currentScene(state, content).luogo, escludi: AV().lootEsclusi(content, u.id, eff.loot.pool) }, eff.loot.filtri || {}), chiave: sourceKey + '#' + i + '#' + u.uid + '#' + q, visibile: eff.loot.visibile !== false, aPortata: !!eff.loot.a_portata, evento: curEvent ? curEvent.n : null }, d, applied);
          }
          return;
        }
        L().generateReward(state, content.loot, { pool: eff.loot.pool, contesto: Object.assign({ contesto: eff.loot.contesto, luogo: currentScene(state, content).luogo }, eff.loot.filtri || {}), chiave: sourceKey + '#' + i, visibile: eff.loot.visibile !== false, aPortata: !!eff.loot.a_portata, evento: curEvent ? curEvent.n : null }, d, applied);
      } else if (eff.ricompensa) addItem(state, content, eff.ricompensa, sourceKey + '#' + i, applied);
      else if (eff.scopri) discover(state, content, eff.scopri, applied);
      else if (eff.flag) Object.entries(eff.flag).forEach(([k, v]) => {
        const prev = state.flags[k];
        state.flags[k] = (typeof v === 'number') ? (Number(prev) || 0) + v : v;
        applied.push({ tipo: 'flag', flag: k, valore: state.flags[k] });
      });
      else if (eff.relazione) {
        const p = state.png[eff.relazione.png];
        if (p) { p.atteggiamento += eff.relazione.delta; applied.push({ tipo: 'relazione', png: eff.relazione.png, delta: eff.relazione.delta, valore: p.atteggiamento }); }
      } else if (eff.png_sa) {
        const p = state.png[eff.png_sa.png];
        if (p && p.sa.indexOf(eff.png_sa.fatto) === -1) { p.sa.push(eff.png_sa.fatto); applied.push({ tipo: 'png_sa', png: eff.png_sa.png, fatto: eff.png_sa.fatto }); }
      } else if (eff.orologio) {
        const o = state.orologi[eff.orologio.id];
        if (o && o.attivo) { o.valore = Math.max(0, Math.min(o.max, o.valore + eff.orologio.delta)); applied.push({ tipo: 'orologio', orologio: eff.orologio.id, valore: o.valore, max: o.max }); }
      } else if (eff.hp) {
        const pg = state.personaggio;
        const prima = pg.hpCur;
        pg.hpCur = Math.max(1, Math.min(pg.hpMaxTracked, pg.hpCur + eff.hp));
        // variazione reale (mai oltre il massimo né sotto 1)
        applied.push({ tipo: 'hp', delta: pg.hpCur - prima, valore: pg.hpCur });
      } else if (eff.se) {
        // effetto condizionato (archetipo, difficoltà, prove raccolte…)
        const ok = conditionMet(state, eff.se.condizione);
        applyEffects(state, content, ok ? eff.se.effetti : eff.se.altrimenti, sourceKey + '#' + i + (ok ? 's' : 'n'), applied, dice);
      } else if (eff.rischio_oggetto) riskItem(state, content, eff.rischio_oggetto, applied);
      else if (eff.recupera_oggetto) recoverItem(state, content, eff.recupera_oggetto, applied);
      else if (eff.progresso) awardProgress(state, content, 'effetto:' + sourceKey + '#' + i, eff.progresso, applied);
    });
  }

  /* Oggetti chiave e difficoltà (profilo "oggetti_chiave"):
     - protetti: un fallimento ordinario non li toglie (Esplorativa Eidos);
     - custode: passano a un PNG e si possono riavere (recupera_oggetto);
     - perdita: perduti; resta la via alternativa più costosa.
     La storia non si blocca mai: ogni oggetto chiave ha una via alternativa
     dichiarata nei contenuti e verificata dal validatore. */
  function riskItem(state, content, r, applied) {
    const it = state.inventario.find(i => i.id === r.oggetto && i.qty > 0);
    if (!it) return;
    const regola = C().profileValue(state, content, 'oggetti_chiave', 'custode');
    const nome = (itemDef(content, r.oggetto) || {}).nome || r.oggetto;
    if (regola === 'protetti') { applied.push({ tipo: 'oggetto_salvo', oggetto: r.oggetto, nome }); return; }
    state.inventario.splice(state.inventario.indexOf(it), 1);
    if (regola === 'perdita' || !r.png) {
      state.oggettiPersi[r.oggetto] = true;
      applied.push({ tipo: 'oggetto_perso', oggetto: r.oggetto, nome });
    } else {
      state.custodi[r.oggetto] = r.png;
      applied.push({ tipo: 'custode', oggetto: r.oggetto, nome, png: r.png });
    }
  }
  function recoverItem(state, content, r, applied) {
    if (!state.custodi[r.oggetto]) return;
    delete state.custodi[r.oggetto];
    state.inventario.push({ id: r.oggetto, qty: 1 });
    applied.push({ tipo: 'ricompensa', oggetto: r.oggetto, nome: (itemDef(content, r.oggetto) || {}).nome || r.oggetto, qty: 1, recupero: true });
  }

  /* ----------------------------------------------------- progressione */

  /* PROPOSTA DA APPROVARE (V4 §12): la tabella AP resta autoritativa. Le
     azioni registrate danno "tacche" (mai per attesa o ripetizione: ogni
     fonte ha una chiave e paga una volta sola, fino al valore massimo del
     suo esito). Salire dal livello L a L+1 costa ceil(AP del livello L+1
     / 10) tacche, quindi il ritmo segue le proporzioni di LEVEL_TABLE; al
     passaggio si ricevono esattamente gli AP e i bonus ai tratti della
     tabella. Mai più di un livello per comando (niente salti di potere) e
     mai oltre il massimo della fascia dell'atto corrente (1–8 / 9–20 /
     21–30): le tacche in eccesso restano in riserva. */
  /* Costo in tacche del livello `lv`: AP della tabella diviso per
     progressione.divisore_costo (10 se assente). */
  function tickCost(lv, content) {
    const r = LEVEL_TABLE.find(x => x.lv === lv);
    const div = (content && content.progressione && content.progressione.divisore_costo) || 10;
    return r ? Math.ceil(r.ap / div) : Infinity;
  }
  function bandFor(content, atto) { const f = content.progressione && content.progressione.fasce; return (f && f[String(atto)]) || [1, 30]; }

  function awardProgress(state, content, key, amount, applied) {
    const P = state.progresso;
    if (!P || !(amount > 0)) return;
    const gia = P.premiati[key] || 0;
    const add = Math.max(0, amount - gia);
    if (!add) return;
    P.premiati[key] = gia + add;
    P.tacche += add; P.totale += add;
    applied.push({ tipo: 'progresso', fonte: key.split(':')[0], tacche: add });
  }

  function levelUpIfDue(state, content, applied) {
    const P = state.progresso; if (!P) return;
    const pg = state.personaggio;
    const max = bandFor(content, state.atto)[1];
    const next = pg.livello + 1;
    if (next > 30 || next > max || P.tacche < tickCost(next, content)) return;
    P.tacche -= tickCost(next, content);
    const prima = tecAbSbloccate(pg.build, pg.livello, {});
    pg.livello = next;
    const row = LEVEL_TABLE.find(r => r.lv === next);
    pg.apDisponibili += row.ap;
    const perk = perkGainForLevel(next);
    pg.puntiTratto = pg.puntiTratto || { conoscenze: 0, capacitaNormali: 0, capacitaCombattive: 0 };
    Object.keys(perk).forEach(k => { pg.puntiTratto[k] += perk[k]; });
    const dopo = tecAbSbloccate(pg.build, next, {});
    if (dopo.tec > prima.tec || dopo.ab > prima.ab) P.sblocchi.push({ livello: next, tecniche: dopo.tec - prima.tec, abilita: dopo.ab - prima.ab });
    applied.push({ tipo: 'avanzamento', livello: next, ap: pg.apDisponibili, apGuadagnati: row.ap, nota: row.note || '' });
  }

  function progressRule(content, k, esito) {
    const p = content.progressione && content.progressione.premi;
    if (!p) return 0;
    const v = p[k];
    return typeof v === 'object' ? (v[esito] || 0) : (v || 0);
  }

  function conditionMet(state, cond) { return C().conditionMet(state, cond); }

  /* Riassunto verificato della scena lasciata: costruito dagli eventi
     salvati (mai dal testo dell'IA), con i riferimenti agli eventi. */
  function summarizeScene(state, content, sceneId) {
    const sc = sceneOf(content, sceneId);
    const evs = state.eventi.filter(e => e.scena === sceneId);
    const parts = [];
    evs.forEach(e => {
      if (e.check && e.obiettivo) parts.push(e.obiettivoTesto + ': ' + e.esito);
      (e.effetti || []).forEach(a => {
        if (a.tipo === 'ricompensa') parts.push('ottenuto ' + a.nome);
        if (a.tipo === 'scoperta') parts.push('scoperto: ' + a.testo);
      });
      if (e.tipo === 'scelta') parts.push('scelta: ' + e.sceltaTesto);
      if (e.tipo === 'combattimento' && e.incontroEsito) parts.push('scontro: ' + e.incontroEsito);
    });
    state.memoria.riassunti.push({ scena: sceneId, titolo: sc ? sc.titolo : sceneId, testo: parts.join('; ') || 'nessun evento rilevante', eventi: evs.map(e => e.n), fonte: 'motore' });
  }

  function enterScene(state, content, sceneId, dice, applied) {
    applied = applied || [];
    // Tre atti: si passa all'atto successivo solo con tutti gli snodi
    // dell'atto corrente raggiunti; altrimenti l'uscita resta chiusa.
    const toAct = C().actOfScene(content, sceneId);
    if (state.scena && toAct > state.atto) {
      if (!C().actComplete(state, content, state.atto)) {
        applied.push({ tipo: 'uscita_bloccata', scena: sceneId, mancano: C().missingNodes(state, content, state.atto).map(n => n.id) });
        return false;
      }
    }
    if (state.scena) summarizeScene(state, content, state.scena);
    const scenaPrecedente = state.scena;
    state.scena = sceneId;
    state.scenaPassi = 0;
    state.usiScena = {};
    const sc = sceneOf(content, sceneId);
    if (toAct > state.atto) { state.atto = toAct; applied.push({ tipo: 'atto', numero: toAct, titolo: (C().actDef(content, toAct) || {}).titolo }); }
    C().markMet(state, content, sceneId);
    applied.push({ tipo: 'scena', scena: sceneId, titolo: sc.titolo });
    Object.entries(content.orologi || {}).forEach(([k, def]) => {
      if (def.inizio === sceneId) state.orologi[k].attivo = true;
      // tempo che avanza con le scene principali (es. Linea Muta)
      else if (def.per_scena && state.orologi[k].attivo) applyEffects(state, content, [{ orologio: { id: k, delta: def.per_scena } }], 'scena:' + sceneId + ':' + k, applied, dice);
    });
    awardProgress(state, content, 'scena:' + sceneId, progressRule(content, 'scena_nuova'), applied);
    const idef = sceneInteractions(content, sceneId);
    state.interazione = idef ? newSceneState(sceneId, content) : null;
    if (IM()) IM().potaEffimeri(state);
    // scontro finale: il villain si sceglie all'ingresso (il più ostile ancora vivo)
    const nemicoScena = sc.incontro ? (sc.incontro.villain && AV() ? AV().villainFinale(state, content, sc.incontro) : sc.incontro.nemico) : null;
    if (sc.incontro && nemicoScena) {
      const opts = { letale: !!sc.incontro.letale, fonte: 'scena', introduttivo: !!sc.incontro.introduttivo, finale: !!sc.incontro.finale };
      // con le interazioni lo scontro è lo "svolgimento": arriva dopo
      if (idef) state.interazione.incontroInAttesa = { nemico: nemicoScena, opts };
      else startEncounter(state, content, nemicoScena, opts);
    }
    if (strutturaMode(content)) ST().entraMacro(state, content, scenaPrecedente, sceneId, curEvent ? curEvent.n : null, applied);
    // campagna lunga: l'epilogo è un capitolo a sé, dopo il confronto
    // conclusivo; l'esito si calcola ora, la partita si chiude con "prosegui"
    if (sc.finale && strutturaMode(content)) ST().apriEpilogo(state, content, applied, curEvent ? curEvent.n : null);
    else if (sc.finale) concludeChapter(state, content, applied);
    return true;
  }

  /* Chiusura: lo stato è congelato qui (stato 'concluso': nessun comando
     successivo è accettato) e la variante viene calcolata una volta sola
     dal risolutore deterministico. La narrazione arriva dopo e non può
     cambiarla; rigenerarla riusa lo stesso record. */
  function concludeChapter(state, content, applied, forced) {
    if (state.finale) return;
    const ep = state.campagna && state.campagna.epilogo;
    const rec = ep && !forced ? ep.record : C().resolveEnding(state, content, applied, forced, curEvent ? curEvent.n : null);
    state.finale = rec.variante;
    state.esitoFinale = rec;
    state.stato = 'concluso';
    state.motivoFine = 'finale';
    applied.push({ tipo: 'finale', finale: rec.variante, titolo: rec.titolo, modificatori: rec.modificatori });
    if (curEvent) curEvent.riserva = C().endingText(content, rec);
    // Avanzamento provvisorio: una volta sola, con gli AP ufficiali.
    const av = content.avanzamento && content.avanzamento.finale_concluso;
    if (av && !state.ricompense['avanzamento:' + content.id]) {
      const pg = state.personaggio;
      for (let lv = pg.livello + 1; lv <= av.livello; lv++) {
        const row = LEVEL_TABLE.find(r => r.lv === lv);
        pg.apDisponibili += row ? row.ap : 0;
      }
      pg.livello = Math.max(pg.livello, av.livello);
      state.ricompense['avanzamento:' + content.id] = true;
      applied.push({ tipo: 'avanzamento', livello: pg.livello, ap: pg.apDisponibili });
    }
  }

  function checkTransitions(state, content, dice, applied) {
    if (isOver(state) || state.incontro) return;
    // l'antidoto esaurito chiude il capitolo prima di ogni altra uscita
    const clockEnd = Object.entries(content.orologi || {}).find(([k, def]) => state.orologi[k].valore >= def.max && def.al_massimo);
    if (clockEnd) { concludeChapter(state, content, applied, clockEnd[1].al_massimo); return; }
    // orologio pieno senza finale forzato: conseguenze una volta sola
    Object.entries(content.orologi || {}).forEach(([k, def]) => {
      if (def.effetti_al_massimo && state.orologi[k].valore >= def.max && !state.ricompense['orologio_pieno:' + k]) {
        state.ricompense['orologio_pieno:' + k] = true;
        applied.push({ tipo: 'orologio_pieno', orologio: k, nome: def.nome });
        applyEffects(state, content, def.effetti_al_massimo, 'orologio_pieno:' + k, applied, dice);
      }
    });
    C().evaluateConsequences(state, content, applyEffects, applied, curEvent);
    if (isOver(state)) return;
    const sc = currentScene(state, content);
    if (!interactionGateOpen(state, content)) return;
    // scene-seme: con una minaccia della scena ancora in sospeso non si esce
    const itx = state.interazione;
    if (itx && itx.modo === 'semi' && itx.scena === state.scena && (itx.incontroInAttesa || itx.sceltaIncontro)) return;
    // campagna lunga: nessuna uscita automatica; il contratto del
    // macro-capitolo dice quando si può proseguire (comando "prosegui")
    if (strutturaMode(content)) { ST().valutaUscita(state, content, applied, curEvent ? curEvent.n : null); return; }
    const exit = (sc.uscite || []).find(u => conditionMet(state, u.quando));
    if (exit) {
      // gli effetti dell'uscita (es. lo snodo che chiude l'atto) valgono
      // prima del controllo del passaggio d'atto
      applyEffects(state, content, exit.effetti, 'uscita:' + sc.id + '>' + exit.verso, applied, dice);
      if (enterScene(state, content, exit.verso, dice, applied)) C().evaluateConsequences(state, content, applyEffects, applied, curEvent);
    }
  }

  /* ----------------------------------------------------- combattimento */

  /* ------------------------------------------------- fasi della scena

     Scene ampliate (file <storia>-interazioni.json, content.interazioni,
     formato rm-solo-scene/2). Ogni scena ha quattro fasi persistenti:
       arrival      ingresso e orientamento (punti con fase "arrival");
       exploration  punti della scena, persone, domande, dialoghi;
       development  conseguenza o variazione della situazione (testo
                    "sviluppo" e nuovi punti), quando sono soddisfatti i
                    beat di sblocco.sviluppo;
       resolution   azioni risolutive (prova, scelta, scontro, uscita),
                    quando sono soddisfatti i beat di sblocco.risoluzione.
     Il passaggio avviene SOLO per condizioni narrative: nessun contatore
     globale. I beat richiesti di ogni scena sono scelti perché il percorso
     minimo rispetti la sua fascia (compact 6, standard 10, decisive 16
     interazioni), e i test lo verificano.
     Le interazioni hanno effetti reali ma controllati (relazione, voce,
     nota di diario, vantaggio o svantaggio nella risoluzione, pressione,
     spostamenti) e ciascuno si applica una volta sola. Pressione e stallo
     fanno evolvere la scena senza risolverla. Alla pressione massima si
     applica una conseguenza e i beat mancanti sono sostituiti da un solo
     passaggio (pressione.sostituto) che comunica in modo compresso ciò che
     la scena doveva dire; poi la risoluzione, in svantaggio. */
  const FASI = ['arrival', 'exploration', 'development', 'resolution'];
  const STALLO_PER_BANDA = { compact: 2, standard: 3, decisive: 4 };
  function sceneInteractions(content, sceneId) {
    const I = content.interazioni;
    const sc = sceneOf(content, sceneId);
    if (!I || !I.scene || !sc || sc.finale) return null;
    return I.scene[sceneId] || null;
  }
  function pngName(content, id) { return ((content.png || {})[id] || {}).nome || id; }
  function faseIndex(f) { return FASI.indexOf(f); }
  function newSceneState(sceneId, content) {
    return { modo: semiMode(content) ? 'semi' : 'classico', scena: sceneId, fase: 'arrival', conteggio: 0, beats: [], fatte: [], dialoghi: {}, dialogo: null, stasi: 0, svolte: 0, pressione: 0, mod: 0, effetti: [], libere: [], incontroInAttesa: null, sostituto: null, persi: [] };
  }
  function interactionGateOpen(state, content) {
    const it = state.interazione;
    if (!it || it.scena !== state.scena || !sceneInteractions(content, state.scena)) return true;
    // scene-seme: nessuna lista da completare; obiettivi, scelte e uscite
    // sono disponibili subito (sono loro le trasformazioni della scena)
    if (it.modo === 'semi') return true;
    return it.fase === 'resolution';
  }
  function requiredBeats(def, it) {
    if (it && it.sostituto) return [it.sostituto];
    const s = def.sblocco || {};
    return (s.sviluppo || []).concat(s.risoluzione || []);
  }
  // tutti i punti esplorabili della scena, compresi quelli dello sviluppo e,
  // a pressione scaduta, il passaggio sostitutivo
  function allPoints(def, it) {
    const pts = (def.esplora || []).map(p => Object.assign({ fase: 'exploration' }, p))
      .concat(((def.sviluppo || {}).esplora || []).map(p => Object.assign({}, p, { fase: 'development' })));
    if (it && it.sostituto && def.pressione && def.pressione.sostituto) pts.unshift(Object.assign({ fase: 'arrival' }, def.pressione.sostituto));
    return pts;
  }
  function pointAvailable(it, p) {
    if (it.modo === 'semi') return it.fatte.indexOf(p.id) === -1;
    return it.fatte.indexOf(p.id) === -1 && faseIndex(it.fase) >= faseIndex(p.fase === 'arrival' ? 'arrival' : p.fase);
  }
  function dialogsAvailable(it) { return it.modo === 'semi' || faseIndex(it.fase) >= faseIndex('exploration'); }

  /* Effetti consentiti alle interazioni, applicati una volta per chiave. */
  function applyInteractionEffects(state, content, effects, key, applied) {
    const it = state.interazione;
    (effects || []).forEach((eff, i) => {
      const k = key + '#' + i;
      if (it.effetti.indexOf(k) !== -1) return;
      it.effetti.push(k);
      if (eff.vantaggio) {
        const prima = it.mod;
        it.mod = Math.max(-2, Math.min(2, it.mod + eff.vantaggio));
        if (it.mod !== prima) applied.push({ tipo: eff.vantaggio > 0 ? 'vantaggio' : 'svantaggio', valore: it.mod, motivo: eff.motivo || null });
      } else if (eff.nota) {
        // diario: indizi (beat richiesti), cambiamenti della scena, appunti
        state.note = state.note || [];
        state.note.push({ scena: state.scena, testo: eff.nota, categoria: eff.categoria || 'appunto', evento: curEvent ? curEvent.n : null });
        applied.push({ tipo: 'nota', testo: eff.nota, categoria: eff.categoria || 'appunto' });
      } else if (eff.pressione) {
        addPressure(state, content, eff.pressione, applied);
      } else if (eff.sposta) {
        state.posizioni = state.posizioni || {};
        state.posizioni[eff.sposta.chi] = eff.sposta.dove;
        applied.push({ tipo: 'sposta', chi: eff.sposta.nome || pngName(content, eff.sposta.chi), dove: eff.sposta.dove });
      } else if (eff.relazione || eff.voce) {
        applyEffects(state, content, [eff], k, applied);
      }
    });
  }
  function addPressure(state, content, delta, applied) {
    const def = sceneInteractions(content, state.scena);
    const it = state.interazione;
    if (!def || !def.pressione || it.fase === 'resolution') return;
    it.pressione = Math.max(0, Math.min(def.pressione.max, it.pressione + delta));
    applied.push({ tipo: 'pressione', nome: def.pressione.nome, valore: it.pressione, max: def.pressione.max });
  }

  function markBeat(state, id, applied, metodo, content) {
    const it = state.interazione;
    if (it.beats.indexOf(id) !== -1) return false;
    it.beats.push(id);
    applied.push({ tipo: 'beat', id });
    if (content) discoverByEvidence(state, content, id, metodo || 'osservazione', applied);
    return true;
  }

  /* ------------------------------------------------ verità narrative

     Le scene non richiedono pulsanti precisi ma VERITÀ (dati narrativi,
     rm-solo-narrativa/1): ciascuna si scopre con uno dei metodi dichiarati
     (osservazione, dialogo, deduzione, oggetto, azione libera pertinente,
     fallimento, conseguenza ambientale, intervento di un PNG, pressione)
     attraverso una delle sue evidenze. Il motore registra la scoperta
     (conoscenza canonica del protagonista) una volta sola. Senza dati
     narrativi (contenuti precedenti) valgono i momenti richiesti. */
  function sceneDesign(content, sceneId) { return content.narrativa && content.narrativa.scene ? content.narrativa.scene[sceneId] || null : null; }
  function sceneTruths(content, sceneId) { const d = sceneDesign(content, sceneId); return d ? d.requiredTruths : []; }
  function truthKnown(state, id) { return (state.veritaScoperte || []).some(v => v.id === id); }
  function discoverTruth(state, content, t, metodo, applied, fonte) {
    if (truthKnown(state, t.id)) return false;
    if (metodo !== 'pressione' && (t.acquisitionMethods || []).indexOf(metodo) === -1) return false;
    if ((t.knowledgePrerequisites || []).some(k => !truthKnown(state, k))) return false;
    state.veritaScoperte = state.veritaScoperte || [];
    state.veritaScoperte.push({ id: t.id, scena: state.scena, metodo, fonte: fonte || null, evento: curEvent ? curEvent.n : null, stato: metodo === 'pressione' ? 'recuperata' : 'scoperta' });
    applied.push({ tipo: 'verita', id: t.id, metodo, stato: metodo === 'pressione' ? 'recuperata' : 'scoperta' });
    return true;
  }
  function discoverByEvidence(state, content, evidenza, metodo, applied) {
    sceneTruths(content, state.scena).forEach(t => { if ((t.evidenceIds || []).indexOf(evidenza) !== -1) discoverTruth(state, content, t, metodo, applied, evidenza); });
  }
  // cancello di fase: tutte le verità del cancello scoperte (o recuperate);
  // senza dati narrativi, i momenti richiesti della scena
  function gateDone(state, content, fase) {
    const d = sceneDesign(content, state.scena);
    if (d && d.truthGates) return (d.truthGates[fase] || []).every(id => truthKnown(state, id));
    const it = state.interazione, s = (sceneInteractions(content, state.scena) || {}).sblocco || {};
    return (s[fase === 'development' ? 'sviluppo' : 'risoluzione'] || []).every(id => it.beats.indexOf(id) !== -1);
  }
  // deduzione: il testo del giocatore coglie il contenuto di una verità
  // ancora nascosta (almeno due radici significative in comune)
  function deduceTruth(state, content, text, applied) {
    const stems = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 5));
    const mine = new Set(stems(text));
    for (const t of sceneTruths(content, state.scena)) {
      if (truthKnown(state, t.id) || (t.acquisitionMethods || []).indexOf('deduzione') === -1) continue;
      // mai prima della fase in cui la verità diventa percepibile
      const vis = (t.visibilityPrerequisites || {}).fase;
      if (vis && state.interazione && faseIndex(state.interazione.fase) < faseIndex(vis)) continue;
      const hit = Array.from(new Set(stems(t.canonicalContent))).filter(w => mine.has(w)).length;
      if (hit >= 2 && discoverTruth(state, content, t, 'deduzione', applied, 'testo')) return t;
    }
    return null;
  }

  function setPhase(state, content, fase, applied, ev) {
    const it = state.interazione;
    const def = sceneInteractions(content, state.scena);
    while (faseIndex(it.fase) < faseIndex(fase)) {
      it.fase = FASI[faseIndex(it.fase) + 1];
      applied.push({ tipo: 'fase', fase: it.fase });
      if (it.fase === 'development' && def.sviluppo) {
        ev.sviluppo = def.sviluppo.testo;
        applyInteractionEffects(state, content, def.sviluppo.effetti, 'sviluppo:' + state.scena, applied);
      }
      if (it.fase === 'resolution') {
        applied.push({ tipo: 'svolgimento', scena: state.scena });
        // scontro annunciato con un'alternativa (dati della scena): il
        // giocatore sceglie se affrontarlo o tentare l'altra via
        const scI = currentScene(state, content).incontro;
        if (it.incontroInAttesa && scI && scI.alternativa) {
          it.sceltaIncontro = true;
          applied.push({ tipo: 'incontro_imminente', nemico: content.nemici[it.incontroInAttesa.nemico].nome });
        } else if (it.incontroInAttesa) {
          const w = it.incontroInAttesa; it.incontroInAttesa = null;
          startEncounter(state, content, w.nemico, w.opts);
          applied.push({ tipo: 'incontro_inizia', nemico: state.incontro.nemico.nome });
        }
      }
    }
  }

  /* Rivaluta le condizioni di passaggio (idempotente: le fasi avanzano e
     basta, ogni passaggio registra i suoi effetti una volta). */
  function evaluatePhase(state, content, applied, ev) {
    const it = state.interazione;
    const def = sceneInteractions(content, state.scena);
    if (!def || it.fase === 'resolution') return;
    if (it.modo === 'semi') {
      // niente cancelli: la fase resta un orientamento interno. La pressione
      // al massimo è una conseguenza (svantaggio, nota) e, se c'è, porta la
      // minaccia della scena; non fa avanzare la scena da sola
      if (it.fase === 'arrival' && it.conteggio > 0) { it.fase = 'exploration'; }
      if (def.pressione && it.pressione >= def.pressione.max && !it.pressioneMassima) {
        it.pressioneMassima = true;
        applied.push({ tipo: 'pressione_massima', nome: def.pressione.nome, testo: def.pressione.testo_max, sostituiti: 0 });
        ev.pressioneTesto = def.pressione.testo_max;
        applyInteractionEffects(state, content, [{ vantaggio: -1, motivo: def.pressione.nome }, { nota: def.pressione.conseguenza || def.pressione.testo_max, categoria: 'cambiamento' }], 'pressione_massima:' + state.scena, applied);
        if (it.incontroInAttesa) setPhase(state, content, 'resolution', applied, ev);
      }
      return;
    }
    const s = def.sblocco || {};
    const has = ids => (ids || []).every(id => it.beats.indexOf(id) !== -1);
    // pressione al massimo: conseguenza, beat mancanti sostituiti da un solo
    // passaggio che ne dice l'essenziale, risoluzione in svantaggio
    if (def.pressione && it.pressione >= def.pressione.max && !it.sostituto) {
      const mancanti = requiredBeats(def).filter(id => it.beats.indexOf(id) === -1);
      it.persi = mancanti;
      it.sostituto = def.pressione.sostituto ? def.pressione.sostituto.id : null;
      applied.push({ tipo: 'pressione_massima', nome: def.pressione.nome, testo: def.pressione.testo_max, sostituiti: mancanti.length });
      ev.pressioneTesto = def.pressione.testo_max;
      applyInteractionEffects(state, content, [{ vantaggio: -1, motivo: def.pressione.nome }, { nota: def.pressione.conseguenza || def.pressione.testo_max, categoria: 'cambiamento' }], 'pressione_massima:' + state.scena, applied);
      if (faseIndex(it.fase) < faseIndex('development')) setPhase(state, content, 'development', applied, ev);
      if (!it.sostituto) setPhase(state, content, 'resolution', applied, ev);
    }
    if (it.sostituto) {
      if (has([it.sostituto])) {
        // fail-forward: le verità mancanti sono recuperate dal passaggio sostitutivo
        sceneTruths(content, state.scena).forEach(t => { if (!truthKnown(state, t.id)) discoverTruth(state, content, t, 'pressione', applied, it.sostituto); });
        setPhase(state, content, 'resolution', applied, ev);
      }
      return;
    }
    if (it.fase === 'arrival' && it.conteggio > 0) setPhase(state, content, 'exploration', applied, ev);
    if (it.fase === 'exploration' && gateDone(state, content, 'development')) setPhase(state, content, 'development', applied, ev);
    if (it.fase === 'development' && gateDone(state, content, 'resolution')) setPhase(state, content, 'resolution', applied, ev);
  }

  /* Dopo ogni interazione: tempo che passa (pressione) e stallo. Uno
     stallo introduce un cambiamento coerente senza risolvere la scena:
     indica un elemento richiesto ancora percepibile o fa salire la
     pressione. */
  function afterInteraction(state, content, applied, ev, nuovo, significativa) {
    const it = state.interazione;
    const def = sceneInteractions(content, state.scena);
    if (significativa) it.conteggio += 1;
    if (significativa && def.pressione && it.fase !== 'resolution') addPressure(state, content, def.pressione.per_interazione || 1, applied);
    if (nuovo) it.stasi = 0; else if (significativa) it.stasi += 1;
    const max = def.max_stagnant_turns || STALLO_PER_BANDA[def.pacing_band] || 3;
    if (it.stasi >= max && it.fase !== 'resolution') {
      // stallo: la scena si trasforma (conseguenza registrata nel diario) e
      // indica ciò che aspetta ancora, senza risolversi
      it.stasi = 0; it.svolte += 1;
      const pending = it.modo === 'semi' ? null : nextRequired(state, content);
      const testi = (def.stallo || []).concat(((content.interazioni || {}).regole || {}).stallo || []);
      const testo = testi.length ? testi[(it.svolte - 1) % testi.length] : 'Il tempo passa, e la scena non aspetta.';
      applied.push({ tipo: 'svolta', testo, indizio: pending ? pending.testo : null });
      ev.svoltaTesto = [testo, pending ? 'Qualcosa ti richiama: ' + pending.testo.charAt(0).toLowerCase() + pending.testo.slice(1) + '.' : null].filter(Boolean).join(' ');
      applyInteractionEffects(state, content, [{ nota: testo, categoria: 'cambiamento' }], 'stallo:' + state.scena + ':' + it.svolte, applied);
      if (def.pressione) addPressure(state, content, 1, applied);
      // lo stallo può far emergere una verità, se la scena lo dichiara:
      // una conseguenza dell'ambiente o l'intervento di un PNG presente
      const presenti = currentScene(state, content).png_presenti || [];
      for (const t of sceneTruths(content, state.scena)) {
        if (truthKnown(state, t.id)) continue;
        const amb = (t.evidenceIds || []).indexOf('stallo') !== -1 && discoverTruth(state, content, t, 'conseguenza_ambientale', applied, 'stallo');
        const png = !amb && (t.evidenceIds || []).find(e => /^png:/.test(e) && presenti.indexOf(e.slice(4)) !== -1);
        if (amb || (png && discoverTruth(state, content, t, 'intervento_png', applied, png))) { ev.rivelazioneStallo = t.id; ev.svoltaTesto = [ev.svoltaTesto, t.canonicalContent].filter(Boolean).join(' '); break; }
      }
    }
    evaluatePhase(state, content, applied, ev);
  }

  // primo elemento richiesto ancora da fare e già percepibile
  function nextRequired(state, content) {
    const it = state.interazione;
    const def = sceneInteractions(content, state.scena);
    const req = requiredBeats(def, it).filter(id => it.beats.indexOf(id) === -1);
    for (const id of req) {
      const p = allPoints(def, it).find(x => x.id === id && pointAvailable(it, x));
      if (p) return { id, testo: p.testo };
      for (const d of def.dialoghi || []) {
        const a = (d.argomenti || []).find(x => x.id === id);
        if (a && dialogsAvailable(it)) return { id, testo: 'Parlare con ' + pngName(content, d.png) + ': ' + a.testo.charAt(0).toLowerCase() + a.testo.slice(1) };
      }
    }
    return null;
  }

  // parole significative in comune fra l'azione scritta e un punto (radici
  // di 5 lettere, parole di almeno 5)
  function matchPoint(def, it, text) {
    const roots = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 5));
    const want = roots(text);
    if (!want.length) return null;
    let best = null, score = 0;
    allPoints(def, it).filter(p => pointAvailable(it, p)).forEach(p => {
      const have = roots(p.testo);
      const n = want.filter(w => have.indexOf(w) !== -1).length;
      if (n > score) { score = n; best = p; }
    });
    return best;
  }

  function dialogMemory(it, png) {
    it.dialoghi[png] = it.dialoghi[png] || { aperture: 0, argomenti: [], libere: 0, atteggiamento: 0, info: [], promesse: [], minacce: 0, menzogne: 0, congedi: 0 };
    return it.dialoghi[png];
  }
  // tono di una battuta libera (fallback senza modello)
  function lineTone(text) {
    const t = String(text || '').toLowerCase();
    if (/\b(prometto|te lo giuro|hai la mia parola|ti do la mia parola)\b/.test(t)) return 'promessa';
    if (/\b(ti ammazzo|ti uccido|te ne pentirai|altrimenti|ti conviene|minaccio|o ti)\b/.test(t)) return 'minaccia';
    if (/\b(mento|mentendo|fingo|faccio finta|non è vero ma)\b/.test(t)) return 'menzogna';
    return null;
  }

  function interact(state, content, cmd, dice, applied, ev) {
    const def = sceneInteractions(content, state.scena);
    const it = state.interazione;
    if (!def || !it || it.scena !== state.scena) throw new SoloError('azione_non_valida', 'Qui non c\'è altro da esplorare.');
    if (cmd.tipo === 'esplora') {
      ev.tipo = 'esplorazione';
      ev.fase = it.fase;
      let punto = cmd.punto;
      if (cmd.libera) {
        ev.libera = true;
        // un'azione scritta che corrisponde a un punto percepibile della
        // scena lo esegue (anche se richiesto); altrimenti testi liberi a
        // rotazione, poi un punto secondario non ancora visto: mai lo
        // stesso testo due volte
        const match = matchPoint(def, it, cmd.testo);
        const dedotta = !match && deduceTruth(state, content, cmd.testo, applied);
        if (match) punto = match.id;
        else if (dedotta) {
          // deduzione: il giocatore coglie una verità della scena da sé
          ev.deduzione = dedotta.id;
          ev.riserva = dedotta.canonicalContent;
          applyInteractionEffects(state, content, [{ nota: dedotta.canonicalContent, categoria: 'indizio' }], 'deduzione:' + dedotta.id, applied);
          afterInteraction(state, content, applied, ev, true, true);
          return;
        } else {
          // ipotesi del giocatore non confermata: resta sua, mai un fatto
          ev.ipotesi = String(cmd.testo || '').slice(0, 200);
          const pool = (def.riserve_libere || []).concat([def.riserva_libera], (content.interazioni.regole || {}).riserve_libere || [(content.interazioni.regole || {}).riserva_libera]).filter(Boolean);
          const fresh = pool.find(t => it.libere.indexOf(t) === -1);
          const req = requiredBeats(def, it);
          const extra = !fresh && allPoints(def, it).find(x => pointAvailable(it, x) && req.indexOf(x.id) === -1);
          if (extra) punto = extra.id;
          else {
            ev.riserva = fresh || null;
            if (fresh) it.libere.push(fresh);
            afterInteraction(state, content, applied, ev, false, true);
            return;
          }
        }
      }
      const p = allPoints(def, it).find(x => x.id === punto);
      if (!p) throw new SoloError('azione_non_valida', 'Punto non disponibile in questa scena.');
      if (it.fatte.indexOf(p.id) !== -1) throw new SoloError('azione_non_valida', 'Lo hai già fatto: prova qualcos\'altro.');
      if (!pointAvailable(it, p)) throw new SoloError('azione_non_valida', 'Non ancora.');
      it.fatte.push(p.id);
      ev.punto = p.id; ev.puntoTesto = p.testo; ev.testo = ev.testo || p.testo; ev.riserva = p.riserva;
      const before = applied.length;
      const nuovoBeat = markBeat(state, p.id, applied, ev.libera ? 'azione_libera' : 'osservazione', content);
      applyInteractionEffects(state, content, p.effetti, 'punto:' + p.id, applied);
      afterInteraction(state, content, applied, ev, nuovoBeat || applied.length > before, true);
      return;
    }
    if (cmd.tipo === 'dialogo_inizia') {
      if (!dialogsAvailable(it)) throw new SoloError('azione_non_valida', 'Prima guardati intorno.');
      const d = (def.dialoghi || []).find(x => x.png === cmd.png);
      if (!d) throw new SoloError('azione_non_valida', 'Qui non puoi parlare con ' + pngName(content, cmd.png) + '.');
      const m = dialogMemory(it, d.png);
      it.dialogo = d.png;
      m.aperture += 1;
      it.conteggio += 1; // apertura e congedo sono interazioni della scena
      ev.tipo = 'dialogo'; ev.png = d.png; ev.pngNome = pngName(content, d.png);
      ev.riserva = m.aperture === 1 ? d.apertura : (d.ritorno || ev.pngNome + ' ti guarda tornare. «Ancora tu. Che cosa c\'è?»');
      ev.testo = ev.testo || 'Parli con ' + ev.pngNome;
      applied.push({ tipo: 'dialogo_inizia', png: d.png });
      return;
    }
    const png = it.dialogo;
    if (!png) throw new SoloError('azione_non_valida', 'Non stai parlando con nessuno.');
    const d = (def.dialoghi || []).find(x => x.png === png);
    const m = dialogMemory(it, png);
    ev.png = png; ev.pngNome = pngName(content, png);
    if (cmd.tipo === 'battuta') {
      ev.tipo = 'battuta';
      if (cmd.argomento) {
        const a = (d.argomenti || []).find(x => x.id === cmd.argomento);
        if (!a || m.argomenti.indexOf(a.id) !== -1) throw new SoloError('azione_non_valida', 'Ne avete già parlato.');
        m.argomenti.push(a.id);
        ev.argomento = a.id; ev.testo = ev.testo || a.testo; ev.riserva = a.riserva;
        const before = applied.length;
        const nuovoBeat = markBeat(state, a.id, applied, 'dialogo', content);
        if (nuovoBeat) m.info.push(a.id);
        if (a.atteggiamento) { m.atteggiamento += a.atteggiamento; applied.push({ tipo: 'atteggiamento', png, delta: a.atteggiamento, valore: m.atteggiamento }); }
        const primaAtt = m.atteggiamento - (a.atteggiamento || 0);
        applyInteractionEffects(state, content, a.effetti, 'argomento:' + a.id, applied);
        afterInteraction(state, content, applied, ev, nuovoBeat || applied.length > before, true);
        const svolta = dialogueTurn(state, content, d, png, m, primaAtt, applied, nuovoBeat);
        if (svolta) turnDialogue(state, content, d, png, applied, ev, svolta);
        return;
      }
      if (!String(cmd.testo || '').trim()) throw new SoloError('azione_non_valida', 'Scrivi che cosa dici.');
      const primaAtt = m.atteggiamento;
      m.libere += 1;
      const tono = cmd.tono || lineTone(cmd.testo);
      ev.tono = tono;
      if (tono === 'promessa') { m.promesse.push({ testo: String(cmd.testo).slice(0, 200), evento: ev.n }); m.atteggiamento += 1; applied.push({ tipo: 'promessa_dialogo', png }); }
      if (tono === 'minaccia') { m.minacce += 1; m.atteggiamento -= 1; applied.push({ tipo: 'atteggiamento', png, delta: -1, valore: m.atteggiamento }); }
      if (tono === 'menzogna') m.menzogne += 1;
      ev.riserva = d.riserva_libera || (ev.pngNome + ' ti ascolta, ci pensa, e risponde solo con quello che sa davvero.');
      afterInteraction(state, content, applied, ev, !!tono, true);
      const svolta = dialogueTurn(state, content, d, png, m, primaAtt, applied, false);
      if (svolta) turnDialogue(state, content, d, png, applied, ev, svolta);
      return;
    }
    // congedo del giocatore
    ev.tipo = 'dialogo_fine';
    ev.testo = ev.testo || 'Concludi il dialogo con ' + ev.pngNome;
    closeDialogue(state, content, d, png, applied, ev, 'congedo');
  }

  /* Chiusura di un dialogo: per congedo del giocatore oppure per una
     svolta (relazione cambiata, verità emersa senza altro da chiedere,
     promessa, minaccia, pressione che interrompe). Applica quanto ottenuto,
     conserva la memoria del PNG e rivaluta la scena. */
  function closeDialogue(state, content, d, png, applied, ev, motivo) {
    const it = state.interazione, m = dialogMemory(it, png);
    ev.riserva = motivo === 'congedo' ? d.chiusura : [ev.riserva, d.chiusura].filter(Boolean).join('\n\n');
    if (motivo !== 'congedo') ev.dialogoConcluso = motivo;
    it.dialogo = null;
    m.congedi += 1;
    it.conteggio += 1;
    applied.push({ tipo: 'dialogo_fine', png, argomenti: m.argomenti.length, libere: m.libere, atteggiamento: m.atteggiamento, motivo });
    if (m.atteggiamento >= 2) applyInteractionEffects(state, content, [{ relazione: { png, delta: 1 } }], 'congedo_buono:' + state.scena + ':' + png, applied);
    if (m.atteggiamento <= -2) applyInteractionEffects(state, content, [{ relazione: { png, delta: -1 } }], 'congedo_ostile:' + state.scena + ':' + png, applied);
    // memoria del PNG oltre la scena
    state.memoriaPng = state.memoriaPng || {};
    const g = state.memoriaPng[png] = state.memoriaPng[png] || { argomenti: [], promesse: [], atteggiamento: 0 };
    m.argomenti.forEach(x => { if (g.argomenti.indexOf(x) === -1) g.argomenti.push(x); });
    m.promesse.forEach(x => { if (!g.promesse.some(y => y.evento === x.evento)) g.promesse.push(x); });
    g.atteggiamento = m.atteggiamento;
    evaluatePhase(state, content, applied, ev);
  }
  // svolta del dialogo dopo una battuta (null se la conversazione continua)
  /* Una svolta aggiorna lo stato ma non chiude il dialogo. Si chiude solo
     se la scena lo dichiara (dialoghi[].chiudeSu) o se un evento esterno
     lo rende impossibile (la minaccia della scena è arrivata). */
  function turnDialogue(state, content, d, png, applied, ev, svolta) {
    const it = state.interazione;
    ev.svoltaDialogo = svolta;
    applied.push({ tipo: 'svolta_dialogo', png, motivo: svolta });
    const esterno = svolta === 'pressione' && (it.sceltaIncontro || state.incontro);
    if (it.dialogo === png && (esterno || (d.chiudeSu || []).indexOf(svolta) !== -1)) closeDialogue(state, content, d, png, applied, ev, svolta);
  }

  function dialogueTurn(state, content, d, png, m, primaAtt, applied, nuovaVerita) {
    const it = state.interazione;
    if (applied.some(a => a.tipo === 'pressione_massima')) return 'pressione';
    if (applied.some(a => a.tipo === 'promessa_dialogo')) return 'promessa';
    if (applied.some(a => a.tipo === 'atteggiamento' && a.png === png && a.delta < 0) && /minaccia/.test(String(curEvent && curEvent.tono))) return 'minaccia';
    if ((primaAtt < 2 && m.atteggiamento >= 2) || (primaAtt > -2 && m.atteggiamento <= -2)) return 'relazione';
    if (nuovaVerita) {
      const req = [].concat((d.argomenti || []).filter(a => a.richiesto || requiredBeats(sceneInteractions(content, state.scena), it).indexOf(a.id) !== -1).map(a => a.id));
      if (req.every(id => m.argomenti.indexOf(id) !== -1)) return 'verita';
    }
    return null;
  }

  /* Che cosa si può fare ora nella scena (per l'interfaccia e il pilota
     dei test). Gli elementi non ancora percepibili non compaiono. */
  function interactionOptions(state, content) {
    const def = sceneInteractions(content, state.scena);
    const it = state.interazione;
    if (!def || !it || it.scena !== state.scena) return null;
    const png = it.dialogo;
    const d = png && (def.dialoghi || []).find(x => x.png === png);
    const m = png && it.dialoghi[png];
    const req = requiredBeats(def, it);
    const tag = id => ({ richiesto: req.indexOf(id) !== -1 });
    return {
      fase: it.fase, conteggio: it.conteggio, aperta: interactionGateOpen(state, content), modo: it.modo || 'classico',
      possibili: IM() ? (() => { const ps = IM().possibilita(state, content); return { obiettivi: Object.keys(ps.obiettivi).filter(k => ps.obiettivi[k].ok), scelte: Object.keys(ps.scelte).filter(k => ps.scelte[k].ok) }; })() : null,
      intenzione: IM() && IM().intenzioneAperta(state) ? IM().intenzioneAperta(state).testo : null, banda: def.pacing_band || 'standard',
      pressione: def.pressione ? { nome: def.pressione.nome, valore: it.pressione, max: def.pressione.max } : null,
      vantaggio: it.mod,
      esplora: allPoints(def, it).filter(p => pointAvailable(it, p)).map(p => Object.assign({ id: p.id, testo: p.testo, effetti: p.effetti || [] }, tag(p.id))),
      dialoghi: dialogsAvailable(it) ? (def.dialoghi || []).map(x => {
        const restanti = (x.argomenti || []).filter(a => !(it.dialoghi[x.png] && it.dialoghi[x.png].argomenti.indexOf(a.id) !== -1));
        return { png: x.png, nome: pngName(content, x.png), argomentiRestanti: restanti.length, richiesti: restanti.filter(a => req.indexOf(a.id) !== -1).length };
      }) : [],
      dialogo: png ? { png, nome: pngName(content, png), atteggiamento: m.atteggiamento, battute: m.argomenti.length + m.libere,
        argomenti: (d.argomenti || []).filter(a => m.argomenti.indexOf(a.id) === -1).map(a => Object.assign({ id: a.id, testo: a.testo, effetti: a.effetti || [], atteggiamento: a.atteggiamento || 0 }, tag(a.id))) } : null,
      incontroInAttesa: !!it.incontroInAttesa, sostituto: it.sostituto, persi: it.persi.slice(),
      sceltaIncontro: it.sceltaIncontro && it.incontroInAttesa ? { nemico: content.nemici[it.incontroInAttesa.nemico].nome, alternativa: currentScene(state, content).incontro.alternativa.testo } : null,
      mancanti: req.filter(id => it.beats.indexOf(id) === -1).length
    };
  }

  /* Scelta prima di uno scontro annunciato: affrontarlo oppure tentare
     l'alternativa della scena (una prova). Riuscita: lo scontro è evitato,
     con i suoi effetti; altrimenti comincia e il nemico colpisce per primo. */
  function encounterChoice(state, content, cmd, dice, applied, ev) {
    const it = state.interazione, sc = currentScene(state, content);
    if (!it || !it.sceltaIncontro || !it.incontroInAttesa) throw new SoloError('azione_non_valida', 'Nessuno scontro da decidere adesso.');
    const w = it.incontroInAttesa, alt = sc.incontro.alternativa;
    it.sceltaIncontro = false; it.incontroInAttesa = null;
    ev.tipo = 'scelta_incontro';
    if (cmd.scelta === 'alternativa') {
      ev.testo = alt.testo;
      const check = R().resolveCheck({ dice, sheet: state.personaggio, trait: alt.tratto, nc: alt.nc, difficolta: state.difficolta, mod: it.mod || 0 });
      ev.check = check; ev.esito = check.esito; ev.obiettivoTesto = alt.testo;
      if (R().isSuccess(check.esito) || check.esito === 'parziale') {
        state.flags['incontro_' + sc.id + '_concluso'] = 'evitato';
        applyEffects(state, content, alt.successo || [], 'alternativa:' + sc.id, applied, dice);
        applied.push({ tipo: 'incontro_evitato', nemico: content.nemici[w.nemico].nome });
        ev.riserva = alt.riserva_successo || null;
        return;
      }
      ev.riserva = alt.riserva_fallimento || null;
      startEncounter(state, content, w.nemico, w.opts);
      state.incontro.sorpresa = true;
    } else {
      ev.testo = 'Affronti ' + (content.nemici[w.nemico].articolo ? (/'$/.test(content.nemici[w.nemico].articolo) ? content.nemici[w.nemico].articolo : content.nemici[w.nemico].articolo + ' ') : '') + content.nemici[w.nemico].nome;
      startEncounter(state, content, w.nemico, w.opts);
    }
    applied.push({ tipo: 'incontro_inizia', nemico: state.incontro.nemico.nome });
  }

  function startEncounter(state, content, enemyId, opts) {
    const R_ = R();
    const tpl = content.nemici[enemyId];
    let nemico;
    // campagna lunga: i partecipanti reali della scena, con le loro schede
    // introduttivo e scontro finale: al livello del protagonista in ogni difficoltà
    const lvG = Math.max(1, state.personaggio.livello + (opts.introduttivo || opts.finale ? 0 : (R_.SOLO_TUNING.livelloNemici[state.difficolta] || 0)));
    if (enemyId !== 'raven' && AV() && AV().attivo(state, content, enemyId)) { state.incontro = AV().creaIncontro(state, content, enemyId, opts, lvG); return; }
    if (enemyId === 'raven') nemico = R_.ravenConfig(state.personaggio.livello, tpl);
    else {
      // primo scontro introduttivo (dati della scena): nemico al livello del
      // protagonista in ogni difficoltà; la difficoltà pesa solo sugli HP
      const lv = lvG;
      // scontro finale senza struttura: stesso specchio del protagonista
      const scala = opts.finale ? ((currentScene(state, content).incontro || {}).villain || {}).scala : null;
      nemico = R_.scaledCombatant(tpl, scala ? 1 : lv);
      if (scala && AV()) {
        AV().specchia(nemico, tpl, state.personaggio);
        nemico.livello = lv;
        nemico.hpMax = nemico.hp = Math.max(1, Math.round((Number(state.personaggio.hpMaxTracked) || nemico.hpMax) * ((scala.hpRispettoAlPg || {})[state.difficolta] || 1)));
        const molt = AV().dannoSpecchio({ tecniche: [] }, tpl, state.personaggio, scala);
        nemico.attacco = Object.assign({}, nemico.attacco || tpl.attacco, { dannoBase: Math.round((Number((tpl.attacco || {}).dannoBase) || 0) * molt) });
      } else if (tpl.hpMax) {
        const mult = { esplorativa: 0.75, bilanciata: 1, permadeath: 1.25 }[state.difficolta] || 1;
        nemico.hpMax = Math.round(tpl.hpMax * mult * (1 + (lv - 1) * 0.25)); nemico.hp = nemico.hpMax;
      }
    }
    state.incontro = { nemicoId: enemyId, nemico, round: 1, letale: !!opts.letale, fonte: opts.fonte, finale: !!opts.finale, log: [] };
  }

  /* Stati attivi (supporti): Forza, Mira e Forza Magica entrano nel
     danno; la Difesa nella salvezza (supportSaveBonus). */
  function pgCombatant(state) {
    const R_ = R();
    const c = R_.toCombatant(Object.assign({}, state.personaggio));
    const round = state.incontro ? state.incontro.round : 0;
    state.supporti.filter(s => s.round >= round).forEach(s => Object.entries(s.bonus || {}).forEach(([k, v]) => {
      if (k === 'for' || k === 'mira' || k === 'fmen') c.primary[k] = Math.max(1, (Number(c.primary[k]) || 0) + v);
    }));
    return c;
  }

  function autoDefense(c) {
    if ((c.traits['Elusione'] || 0) > 0) return 'dodge';
    if ((c.traits['Guardia'] || 0) > 0) return 'block';
    return 'none';
  }
  /* Equipaggiamento difensivo del protagonista (SOLO_TUNING.equipDifensivo):
     - armatura indossata: la sua DIF entra nella salvezza, scalata;
     - scudo (in dotazione o comparso da una gemma): rende possibile il
       Blocco; senza scudo il Blocco non si tenta (manuale). */
  function equipIntegro(e) { return e && !(Number.isFinite(e.durabilitaCorrente) && e.durabilitaCorrente <= 0); }
  function armorSaveBonus(state) {
    const T = R().SOLO_TUNING.equipDifensivo;
    if (!T) return 0;
    const dif = (state.personaggio.equip || []).filter(e => e.tipo === 'armatura' && Number.isFinite(e.dif) && equipIntegro(e)).reduce((a, e) => a + e.dif, 0);
    return Math.min(T.massimo, Math.round(dif * T.fattoreDifArmatura));
  }
  function hasShield(state) {
    const round = state.incontro ? state.incontro.round : 0;
    return (state.personaggio.equip || []).some(e => e.tipo === 'scudo' && equipIntegro(e)) || state.supporti.some(s => s.scudo && s.round >= round);
  }
  function pgDefense(state, c) {
    if ((c.traits['Elusione'] || 0) > 0) return 'dodge';
    return hasShield(state) ? 'block' : 'none';
  }

  /* Statistiche usate davvero nello scontro (con gli stati attivi):
     - Destrezza: precisione degli attacchi fisici (metà, per difetto);
     - Difesa Magica: salvezza contro attacchi magici o tecnologici;
     - Velocità: chi colpisce per primo all'inizio dello scontro e
       modificatore della fuga (differenza, da −3 a +3);
     - Difesa: salvezza contro ogni colpo (supportSaveBonus). */
  function activeBonus(state, key) {
    const round = state.incontro ? state.incontro.round : 0;
    return state.supporti.filter(s => s.round >= round).reduce((a, s) => a + ((s.bonus || {})[key] || 0), 0);
  }
  function pgStat(state, key) { return (Number(state.personaggio.primary[key]) || 0) + activeBonus(state, key); }
  function foeStat(foe, key) { return Number((foe.primary || {})[key]) || 0; }
  function attackMods(atkDex, action, targetDmen) {
    const magico = action.stat === 'fmen';
    return Object.assign({}, action, { bonusColpire: magico ? 0 : Math.floor(Math.max(0, atkDex) / 2), bonusSalvezza: magico ? Math.max(0, targetDmen) : 0 });
  }
  function supportSaveBonus(state) {
    return state.supporti.filter(s => s.round >= (state.incontro ? state.incontro.round : 0)).reduce((a, s) => a + (s.bonus.dif || 0), 0);
  }

  /* Un consumabile come azione del turno: stesso effetto dichiarato del
     catalogo (useItem), il turno del protagonista è l'uso. */
  function combatItem(state, content, cmd, applied, ev) {
    const info = itemInfo(state, content, cmd.oggetto);
    useItem(state, content, cmd.oggetto, applied, ev, cmd);
    delete ev.riserva; // il racconto resta quello dello scontro
    ev.combattimento.azioni.push({ chi: 'pg', tipo: 'oggetto', capacita: info ? info.nome : cmd.oggetto, oggetto: cmd.oggetto });
  }
  /* Capacità speciali fuori slot (gemme dei Chorisfos): la gemma associata
     deve essere attiva e si scarica usandola (premessa: «una volta che la
     gemma avrà perso il proprio potere lo scudo si romperà»); il reintegro
     resta quello degli avamposti. Effetti solo dai campi della capacità:
     cura in percentuale degli HP, scudo (Blocco possibile), stati di
     supporto (bonusStat). */
  function specialCapacity(state, content, cmd, applied, ev) {
    const pg = state.personaggio, inc = state.incontro;
    // le capacità fuori slot della gemma (es. Reticolo) passano dall'azione «gemma»
    const ab = (pg.capacitaSpeciali || []).find(a => a.id === cmd.abilitaId && !a.fuoriSlot);
    if (!ab) throw new SoloError('azione_non_valida', 'Capacità non in scheda');
    const st = capacityStatus(state, content, 'speciale', ab);
    if (!st.ok) throw new SoloError('risorse_insufficienti', st.motivo);
    const g = gemForCapacity(pg, ab);
    if (g) { g.stato = 'scarica'; applied.push({ tipo: 'gemma_scarica', gemma: g.id, nome: g.nome, mp: 0, valore: pg.mpCur, capacita: ab.nome }); }
    const durata = inc.round + (Number.isFinite(ab.durataTurni) && ab.durataTurni > 0 ? ab.durataTurni : 1);
    if (Number.isFinite(ab.curaPercentuale) && ab.curaPercentuale > 0) {
      const g2 = Math.min(Math.max(1, Math.round(pg.hpMaxTracked * ab.curaPercentuale / 100)), pg.hpMaxTracked - pg.hpCur);
      pg.hpCur += g2;
      applied.push({ tipo: 'hp', delta: g2, valore: pg.hpCur });
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'cura', capacita: ab.nome, curati: g2 });
      return;
    }
    state.supporti.push(Object.assign({ nome: ab.nome, bonus: Object.assign({}, bonusOf(ab)), round: durata }, ab.scudo ? { scudo: true } : {}));
    ev.combattimento.azioni.push({ chi: 'pg', tipo: 'supporto', capacita: ab.nome, bonus: bonusOf(ab), scudo: !!ab.scudo });
  }

  /* Un turno: azione del protagonista, poi risposta del nemico. */
  function combatRound(state, content, cmd, dice, applied, ev) {
    if (state.incontro.gruppo) return groupRound(state, content, cmd, dice, applied, ev);
    const inc = state.incontro;
    const pg = state.personaggio;
    const me = pgCombatant(state);
    const foe = inc.nemico;
    ev.combattimento = { round: inc.round, azioni: [] };
    // stati con effetto per turno (catalogo degli stati)
    if (AV() && AV().tickStati(state, applied) > 0 && pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    const bersaglio = () => foe;
    // Velocità: nel primo scambio il più rapido colpisce per primo
    const primoNemico = inc.round === 1 && !inc.iniziativa && (inc.sorpresa || foeStat(foe, 'vel') > pgStat(state, 'vel')) && cmd.azione !== 'fuga';
    if (inc.round === 1 && !inc.iniziativa) inc.iniziativa = primoNemico ? 'nemico' : 'pg';
    if (primoNemico) {
      ev.combattimento.iniziativa = 'nemico';
      enemyTurn(state, content, dice, ev, applied);
      if (!state.incontro) return ev.incontroEsito;
      if (pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    }

    if (cmd.azione === 'fuga') {
      if (inc.nemicoId === 'raven' && foe.inevitabile) throw new SoloError('azione_non_valida', 'Non c\'è via di fuga');
      const sc = currentScene(state, content);
      const fuga = (sc.incontro && sc.incontro.fuga) || { tratto: 'Sopravvivenza', nc: 13, costo: [] };
      const velMod = Math.max(-3, Math.min(3, pgStat(state, 'vel') - foeStat(foe, 'vel')));
      const check = R().resolveCheck({ dice, sheet: pg, trait: fuga.tratto, nc: fuga.nc + (AV() ? AV().modFuga(state, content, inc.nemicoId) : 0), difficolta: state.difficolta, mod: velMod });
      check.velocita = velMod;
      ev.check = check;
      if (R().isSuccess(check.esito) || check.esito === 'parziale') {
        applyEffects(state, content, fuga.costo, 'fuga:' + state.scena + ':' + ev.n, applied, dice);
        return endEncounter(state, content, 'fuga', applied, ev);
      }
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'fuga_fallita' });
    } else if (cmd.azione === 'abilita' || cmd.azione === 'tecnica' || cmd.azione === 'gemma') {
      const list = capacityList(pg, cmd.azione);
      const ab = list.find(a => a.id === cmd.abilitaId);
      if (!ab) throw new SoloError('azione_non_valida', 'Capacità non in scheda');
      // disponibilità verificata PRIMA di pagare: un uso impossibile non costa
      const st = capacityStatus(state, content, cmd.azione, ab);
      const abE = effectiveCap(ab, !!state.anteprima);
      if (!st.ok && !(cmd.forza && st.forzabile)) throw new SoloError('risorse_insufficienti', st.motivo);
      payCapability(state, content, abE, st, !st.ok, applied, ev);
      if (isOver(state) || pg.hpCur <= 0) return pg.hpCur <= 0 && !isOver(state) ? pgDown(state, content, applied, ev) : null;
      if (cmd.azione === 'abilita') channelMagic(state, content, st, applied);
      trackUse(pg, ab, applied);
      if (ab.tipo === 'danno') {
        const r = R().resolveAttack(dice, me, bersaglio(), attackMods(pgStat(state, 'dex'), { dannoBase: ab.dannoBase, stat: ab.stat }, foeStat(foe, 'dmen')), autoDefense(foe));
        const prima = foe.hp; foe.hp = Math.max(0, foe.hp - r.finalDamage);
        ev.combattimento.azioni.push({ chi: 'pg', tipo: 'attacco', capacita: ab.nome, esito: r, hpNemico: foe.hp, perso: prima - foe.hp });
      } else {
        state.supporti.push({ nome: ab.nome, bonus: bonusOf(ab), round: inc.round + (Number.isFinite(abE.durataTurni) && abE.durataTurni > 0 ? abE.durataTurni : 1) });
        ev.combattimento.azioni.push({ chi: 'pg', tipo: 'supporto', capacita: ab.nome, bonus: bonusOf(ab) });
      }
    } else if (cmd.azione === 'scarica_gemma') {
      // azione completa: il turno del protagonista è la scarica
      dischargeGem(state, content, cmd.gemmaId, applied, ev);
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'scarica_gemma', gemma: cmd.gemmaId });
    } else if (cmd.azione === 'arma') {
      const w = (pg.equip || []).find(e => e.tipo === 'arma' && e.atk != null);
      if (!w) throw new SoloError('azione_non_valida', 'Nessuna arma');
      const r = R().resolveAttack(dice, me, bersaglio(), attackMods(pgStat(state, 'dex'), { dannoBase: w.atk, stat: w.classe === 'tiro' ? 'mira' : 'for' }, foeStat(foe, 'dmen')), autoDefense(foe));
      const prima = foe.hp; foe.hp = Math.max(0, foe.hp - r.finalDamage);
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'attacco', capacita: w.nome, esito: r, hpNemico: foe.hp, perso: prima - foe.hp });
    } else if (cmd.azione === 'oggetto') {
      combatItem(state, content, cmd, applied, ev);
    } else if (cmd.azione === 'speciale') {
      specialCapacity(state, content, cmd, applied, ev);
    } else {
      throw new SoloError('azione_non_valida', 'Azione di combattimento sconosciuta');
    }

    if (foe.hp <= 0) return endEncounter(state, content, 'vittoria', applied, ev);

    // risposta del nemico (salvo che abbia già colpito per primo)
    if (!primoNemico) {
      enemyTurn(state, content, dice, ev, applied);
      if (!state.incontro) return ev.incontroEsito;
      if (pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    }
    inc.round += 1;
    state.supporti = state.supporti.filter(s => s.round >= inc.round);
    return null;
  }

  /* Attacco del nemico: salvezza con Difesa (stati), contro colpi magici o
     tecnologici anche Difesa Magica; se il colpo va a segno e l'attacco
     porta uno stato, prova di resistenza del protagonista. */
  function enemyTurn(state, content, dice, ev, applied) { return enemyAttack(state, content, dice, ev); }

  /* ---------------------------------------- scontri con più partecipanti

     Campagna lunga (RMSoloAvversari): ogni avversario è un'unità con id,
     HP, MP, PR, stati, posizione (mischia/distanza), fase e morale propri.
     Ordine d'iniziativa per Velocità; il protagonista sceglie il bersaglio.
     Le unità si curano, si proteggono, coordinano attacchi combinati,
     controllano, attivano Boost, cambiano fase, fuggono o si arrendono una
     per una o tutte insieme. Lo scontro finisce quando non resta nessun
     oppositore attivo. Le proposte meccaniche sono marcate nella struttura. */
  function unitCombatant(u) {
    const c = { id: u.uid, nome: u.nome, livello: u.livello, primary: Object.assign({}, u.primary), traits: Object.assign({}, u.traits || {}), hp: u.hp, hpMax: u.hpMax, mp: u.mp };
    // armatura dell'unità nella salvezza, come per il protagonista
    const T = R().SOLO_TUNING.equipDifensivo;
    const dif = (u.equip || []).filter(e => e.tipo === 'armatura' && Number.isFinite(e.dif)).reduce((a, e) => a + e.dif, 0);
    if (T && dif) c.traits.Resistenza = (c.traits.Resistenza || 0) + Math.min(T.massimo, Math.round(dif * T.fattoreDifArmatura));
    return c;
  }
  // difesa di un'unità: Elusione, oppure Blocco con Guardia e uno scudo (in dotazione o evocato)
  function unitDefense(u, c, round) {
    if ((c.traits.Elusione || 0) > 0) return 'dodge';
    if ((c.traits.Guardia || 0) > 0 && (u.equip === undefined || AV().haScudo(u, round))) return 'block';
    return 'none';
  }
  function groupEnd(state, content, applied, ev) {
    const inc = state.incontro;
    if (!inc || AV().attive(inc).length) return null;
    return endEncounter(state, content, AV().esitoComplessivo(inc), applied, ev);
  }
  function unitExit(state, content, inc, u, esito, ev, applied) {
    u.attivo = false; u.esito = esito;
    ev.combattimento.azioni.push({ chi: 'nemico', uid: u.uid, nome: u.nome, tipo: esito === 'fuggito' ? 'fuga' : esito === 'arreso' ? 'resa' : 'sconfitto' });
    applied.push({ tipo: 'unita_esito', uid: u.uid, nome: u.nome, esito });
    // chi lo proteggeva o era protetto non lo è più
    inc.nemici.forEach(n => { if (n.protegge === u.uid) n.protegge = null; if (n.protettoDa === u.uid) n.protettoDa = null; });
    // reazioni degli alleati alla sua uscita
    AV().attive(inc).forEach(n => AV().reazioni(content, n, 'alleato_sconfitto').forEach(r => { if (r.effetto && r.effetto.tattica === 'difesa') { n.guardia = inc.round + 1; ev.combattimento.azioni.push({ chi: 'nemico', uid: n.uid, nome: n.nome, tipo: 'reazione', reazione: r.id, segnale: r.segnale }); } }));
    AV().attive(inc).forEach(n => AV().reazioni(content, n, 'custode_sconfitto').forEach(r => { if (r.effetto && r.effetto.fase) { const f = (AV().scheda(content, n.id).fasi || []).find(x => x.id === r.effetto.fase); if (f && n.fase !== f.id) { AV().entraInFase(n, f); ev.combattimento.azioni.push({ chi: 'nemico', uid: n.uid, nome: n.nome, tipo: 'fase', fase: f.id, segnale: r.segnale || f.segnale }); applied.push({ tipo: 'fase_avversario', nemico: n.nome, fase: f.id }); } } }));
    if (u.uid === inc.leader) AV().moraleCollettivo(state, content, inc, esito === 'fuggito' ? 'capo_fuggito' : esito === 'arreso' ? 'capo_arreso' : 'capo_sconfitto').forEach(x => { const n = AV().unita(inc, x.uid); ev.combattimento.azioni.push({ chi: 'nemico', uid: n.uid, nome: n.nome, tipo: x.esito === 'fuggito' ? 'fuga' : 'resa', collettiva: true }); applied.push({ tipo: 'unita_esito', uid: n.uid, nome: n.nome, esito: x.esito, collettiva: true }); });
  }
  function pgHitsUnit(state, content, inc, target, action, dice, ev, applied, etichetta) {
    const me = pgCombatant(state);
    let colpito = target;
    // protezione reciproca: chi fa da scudo intercetta il colpo
    const scudo = target.protettoDa && AV().unita(inc, target.protettoDa);
    if (scudo && scudo.attivo && AV().reazioni(content, scudo, 'alleato_protetto_attaccato').length) { colpito = scudo; ev.combattimento.azioni.push({ chi: 'nemico', uid: scudo.uid, nome: scudo.nome, tipo: 'reazione', reazione: 'interposizione', protetto: target.uid, segnale: 'si getta in mezzo' }); scudo.protegge = null; target.protettoDa = null; }
    const def = unitCombatant(colpito);
    if (colpito.guardia >= inc.round) def.traits.Resistenza = (def.traits.Resistenza || 0) + 2;
    const mods = attackMods(pgStat(state, 'dex'), action, foeStat(colpito, 'dmen'));
    // vulnerabilità leggibile: esposto dopo il suo colpo pesante
    const esposto = colpito.esposto >= inc.round;
    if (esposto) mods.bonusColpire += 2;
    // distanza: un colpo da mischia contro chi sta a distanza (proposta)
    if (action.stat !== 'mira' && action.stat !== 'fmen' && colpito.posizione === 'distanza') mods.bonusColpire -= 2;
    // ambiente: chi sta a distanza dietro un riparo
    const amb = inc.ambiente && inc.ambiente.effetto && inc.ambiente.effetto.distanza;
    if (amb && colpito.posizione === 'distanza') def.traits.Resistenza = (def.traits.Resistenza || 0) + (amb.dif || 0);
    const r = R().resolveAttack(dice, me, def, mods, esposto ? 'none' : unitDefense(colpito, def, inc.round));
    // resistenze della scheda
    const sh = AV().scheda(content, colpito.id);
    const res = ((sh && sh.resistenze) || []).find(x => (x.tipo === 'magico' && action.stat === 'fmen') || (x.tipo === 'fisico' && action.stat !== 'fmen'));
    if (res && r.finalDamage > 0) { r.resistenza = res.tipo; r.finalDamage = Math.max(0, r.finalDamage - res.valore); }
    const prima = colpito.hp;
    colpito.hp = Math.max(0, colpito.hp - r.finalDamage);
    ev.combattimento.azioni.push({ chi: 'pg', tipo: 'attacco', capacita: etichetta, bersaglio: colpito.uid, bersaglioNome: colpito.nome, esito: r, hpNemico: colpito.hp, perso: prima - colpito.hp, esposto });
    if (colpito.hp <= 0) unitExit(state, content, inc, colpito, 'sconfitto', ev, applied);
    // reazione: contrattacco se il colpo in mischia va a vuoto
    else if (r.finalDamage === 0 && action.stat !== 'mira' && action.stat !== 'fmen') AV().reazioni(content, colpito, 'attacco_mancato_in_mischia').forEach(rx => {
      const cap = [].concat(sh.tecniche || []).find(c => c.id === (rx.effetto || {}).attacco);
      if (cap && state.personaggio.hpCur > 0) { ev.combattimento.azioni.push({ chi: 'nemico', uid: colpito.uid, nome: colpito.nome, tipo: 'reazione', reazione: rx.id, segnale: rx.segnale }); enemyAttack(state, content, dice, ev, unitAction(content, cap), (rx.effetto.bonusColpire || 0), colpito); }
    });
    return r;
  }
  function unitAction(content, c) {
    const st = c && c.stato ? AV().statoMotore(content, c.stato) : null;
    return { nome: c.nome, dannoBase: c.dannoBase || 0, stat: c.stat || 'for', stato: st };
  }
  function unitTurn(state, content, inc, u, dice, ev, applied, profondita) {
    const A = AV(), dif = A.difficolta(state, content), pg = state.personaggio;
    if (!u.attivo) return null;
    const d = A.decidi(state, content, inc, u);
    inc.log.push({ round: inc.round, uid: u.uid, tipo: d.tipo, motivo: d.motivo });
    const push = (o) => ev.combattimento.azioni.push(Object.assign({ chi: 'nemico', uid: u.uid, nome: u.nome, segnale: d.segnale || null, motivo: d.motivo }, o));
    if (d.tipo === 'fase') {
      A.entraInFase(u, d.fase);
      push({ tipo: 'fase', fase: d.fase.id });
      applied.push({ tipo: 'fase_avversario', nemico: u.nome, fase: d.fase.id });
      return profondita ? null : unitTurn(state, content, inc, u, dice, ev, applied, 1);
    }
    if (d.tipo === 'fuga' || d.tipo === 'resa') { unitExit(state, content, inc, u, d.tipo === 'fuga' ? 'fuggito' : 'arreso', ev, applied); return null; }
    if (d.tipo === 'boost') {
      u.pr -= 8; u.boost = { bonus: Object.assign({}, d.boost.effetto.bonus), fino: inc.round + 3 };
      Object.entries(u.boost.bonus).forEach(([k, v]) => { u.primary[k] = (Number(u.primary[k]) || 0) + v; });
      push({ tipo: 'boost', boost: d.boost.nome });
      return null;
    }
    if (d.tipo === 'cura') {
      const a = A.unita(inc, d.bersaglio);
      u.mp -= A.costoMP(d.capacita, u);
      const prima = a.hp; a.hp = Math.min(a.hpMax, a.hp + (d.capacita.cura || 0));
      push({ tipo: 'cura', capacita: d.capacita.nome, bersaglio: a.uid, bersaglioNome: a.nome, curati: a.hp - prima });
      return null;
    }
    if (d.tipo === 'oggetto') {
      const o = (u.oggetti || []).find(x => x.id === d.oggetto);
      o.rimasti -= 1;
      const prima = u.hp; u.hp = Math.min(u.hpMax, u.hp + A.curaOggetto(content, u, o));
      push({ tipo: 'cura', capacita: A.nomeOggetto(content, o), oggetto: o.id, bersaglio: u.uid, bersaglioNome: u.nome, curati: u.hp - prima });
      return null;
    }
    if (d.tipo === 'scudo') {
      u.mp -= A.costoMP(d.capacita, u);
      u.scudoFino = inc.round + 2;
      push({ tipo: 'difesa', capacita: d.capacita.nome, scudo: true });
      return null;
    }
    if (d.tipo === 'proteggi') { const a = A.unita(inc, d.bersaglio); u.protegge = a.uid; a.protettoDa = u.uid; push({ tipo: 'protezione', capacita: d.capacita.nome, bersaglio: a.uid, bersaglioNome: a.nome }); return null; }
    if (d.tipo === 'coordina') { inc.segnato = inc.round; push({ tipo: 'coordinamento', capacita: d.capacita.nome }); return null; }
    if (d.tipo === 'difesa') { u.guardia = inc.round + 1; push({ tipo: 'difesa' }); return null; }
    if (d.tipo === 'avvicina') { u.posizione = 'mischia'; push({ tipo: 'movimento', verso: 'mischia' }); return null; }
    // attacco (tecnica, magia, controllo, colpo di fase)
    const c = d.capacita;
    u.mp -= A.costoMP(c, u);
    let bonus = 0;
    const coord = inc.segnato === inc.round && dif.coordinamento;
    if (coord) bonus += 2;
    const combinato = dif.attacchiCombinati && inc.attacchiRound.length > 0;
    if (combinato) bonus += 1;
    A.reazioni(content, u, 'altro_lupo_attacca').forEach(rx => { if (inc.attacchiRound.length) bonus += (rx.effetto.bonusColpire || 0); });
    const azU = unitAction(content, c);
    if (u.dannoMolt && u.dannoMolt !== 1) azU.dannoBase = Math.round(azU.dannoBase * u.dannoMolt);
    enemyAttack(state, content, dice, ev, azU, bonus, u);
    const az = ev.combattimento.azioni[ev.combattimento.azioni.length - 1];
    Object.assign(az, { uid: u.uid, nome: u.nome, coordinato: !!coord, combinato: !!combinato, segnale: d.segnale || null, motivo: d.motivo });
    inc.attacchiRound.push(u.uid);
    u.danniInflitti += az.perso || 0;
    if (c.dopo && c.dopo.stato === 'esposto') { u.esposto = inc.round + 1; push({ tipo: 'vulnerabilita', stato: 'esposto', segnale: ((AV().scheda(content, u.id).vulnerabilita || []).find(v => v.tipo === 'esposto') || {}).segnale || 'resta scoperto' }); }
    return null;
  }
  function groupRound(state, content, cmd, dice, applied, ev) {
    const inc = state.incontro, pg = state.personaggio, A = AV();
    ev.combattimento = { round: inc.round, azioni: [], gruppo: true, ordine: inc.ordine.slice() };
    inc.attacchiRound = [];
    if (A.tickStati(state, applied) > 0 && pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    // Boost scaduti
    inc.nemici.forEach(u => { if (u.boost && inc.round > u.boost.fino) { Object.entries(u.boost.bonus).forEach(([k, v]) => { u.primary[k] = (Number(u.primary[k]) || 0) - v; }); u.boost = null; } });
    // ambiente di fase (es. il margine che si chiude a ogni turno)
    A.attive(inc).forEach(u => { const f = ((A.scheda(content, u.id) || {}).fasi || []).find(x => x.id === u.fase); if (f && f.ambiente && f.ambiente.orologio && f.ambiente.orologio.ogniTurno) applyEffects(state, content, [{ orologio: { id: f.ambiente.orologio.id, delta: f.ambiente.orologio.delta } }], 'ambiente:' + state.scena + ':' + inc.round + ':' + u.uid, applied, dice); });
    let target = A.unita(inc, cmd.bersaglio || inc.bersaglio);
    if (cmd.bersaglio && (!target || !target.attivo)) throw new SoloError('azione_non_valida', 'Quel bersaglio non è più in grado di combattere.');
    if (!target || !target.attivo) target = A.attive(inc)[0];
    inc.bersaglio = target.uid;
    const pgIdx = inc.ordine.indexOf('pg');
    const fase = (uids) => {
      for (const uid of uids) {
        const u = A.unita(inc, uid);
        if (!u || !u.attivo) continue;
        unitTurn(state, content, inc, u, dice, ev, applied, 0);
        if (pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev) || 'giu'; }
        const fine = groupEnd(state, content, applied, ev);
        if (fine) return fine;
      }
      return null;
    };
    const r0 = fase(inc.ordine.slice(0, pgIdx));
    if (r0) return r0;
    // azione del protagonista
    const osserva = o => A.osserva(inc, o);
    if (cmd.azione === 'fuga') {
      const sc = currentScene(state, content);
      const fuga = (sc.incontro && sc.incontro.fuga) || { tratto: 'Sopravvivenza', nc: 13, costo: [] };
      const piuVeloce = Math.max.apply(null, A.attive(inc).map(u => Number(u.primary.vel) || 0));
      const velMod = Math.max(-3, Math.min(3, pgStat(state, 'vel') - piuVeloce));
      const check = R().resolveCheck({ dice, sheet: pg, trait: fuga.tratto, nc: fuga.nc + A.modFuga(state, content, inc.nemicoId), difficolta: state.difficolta, mod: velMod });
      check.velocita = velMod; ev.check = check;
      osserva({ tipo: 'fuga' });
      if (R().isSuccess(check.esito) || check.esito === 'parziale') { applyEffects(state, content, fuga.costo, 'fuga:' + state.scena + ':' + ev.n, applied, dice); return endEncounter(state, content, 'fuga', applied, ev); }
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'fuga_fallita' });
    } else if (cmd.azione === 'negozia') {
      // risoluzione alternativa: solo con la preparazione giusta (fatti dei dati)
      if (!inc.negoziabile) throw new SoloError('azione_non_valida', 'Non hai nulla su cui trattare, qui.');
      const check = R().resolveCheck({ dice, sheet: pg, trait: 'Persuasione', nc: undefined, difficolta: state.difficolta });
      ev.check = check;
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'negozia', esito: check.esito });
      if (R().isSuccess(check.esito)) {
        const capo = A.unita(inc, inc.leader) || A.attive(inc)[0];
        if (capo && capo.attivo) unitExit(state, content, inc, capo, 'arreso', ev, applied);
        A.attive(inc).filter(u => (A.scheda(content, u.id).morale || {}).resa).forEach(u => unitExit(state, content, inc, u, 'arreso', ev, applied));
        const fine = groupEnd(state, content, applied, ev);
        if (fine) return fine;
      }
    } else if (cmd.azione === 'abilita' || cmd.azione === 'tecnica' || cmd.azione === 'gemma') {
      const list = capacityList(pg, cmd.azione);
      const ab = list.find(a => a.id === cmd.abilitaId);
      if (!ab) throw new SoloError('azione_non_valida', 'Capacità non in scheda');
      const st = capacityStatus(state, content, cmd.azione, ab);
      const abE = effectiveCap(ab, !!state.anteprima);
      if (!st.ok && !(cmd.forza && st.forzabile)) throw new SoloError('risorse_insufficienti', st.motivo);
      payCapability(state, content, abE, st, !st.ok, applied, ev);
      if (isOver(state) || pg.hpCur <= 0) return pg.hpCur <= 0 && !isOver(state) ? pgDown(state, content, applied, ev) : null;
      if (cmd.azione === 'abilita') channelMagic(state, content, st, applied);
      trackUse(pg, ab, applied);
      osserva({ tipo: ab.tipo === 'danno' ? 'attacco' : 'supporto', magica: cmd.azione === 'abilita', capacita: ab.nome });
      if (ab.tipo === 'danno') pgHitsUnit(state, content, inc, target, { dannoBase: ab.dannoBase, stat: ab.stat }, dice, ev, applied, ab.nome);
      else {
        state.supporti.push({ nome: ab.nome, bonus: bonusOf(ab), round: inc.round + (Number.isFinite(abE.durataTurni) && abE.durataTurni > 0 ? abE.durataTurni : 1) });
        ev.combattimento.azioni.push({ chi: 'pg', tipo: 'supporto', capacita: ab.nome, bonus: bonusOf(ab) });
      }
    } else if (cmd.azione === 'scarica_gemma') {
      dischargeGem(state, content, cmd.gemmaId, applied, ev);
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'scarica_gemma', gemma: cmd.gemmaId });
    } else if (cmd.azione === 'arma') {
      const w = (pg.equip || []).find(e => e.tipo === 'arma' && e.atk != null);
      if (!w) throw new SoloError('azione_non_valida', 'Nessuna arma');
      osserva({ tipo: 'attacco', capacita: w.nome });
      pgHitsUnit(state, content, inc, target, { dannoBase: w.atk, stat: w.classe === 'tiro' ? 'mira' : 'for' }, dice, ev, applied, w.nome);
    } else if (cmd.azione === 'oggetto') {
      combatItem(state, content, cmd, applied, ev);
      osserva({ tipo: 'supporto', capacita: (ev.combattimento.azioni[ev.combattimento.azioni.length - 1] || {}).capacita });
    } else if (cmd.azione === 'speciale') {
      specialCapacity(state, content, cmd, applied, ev);
      osserva({ tipo: 'supporto', magica: true, capacita: (ev.combattimento.azioni[ev.combattimento.azioni.length - 1] || {}).capacita });
    } else throw new SoloError('azione_non_valida', 'Azione di combattimento sconosciuta');
    if (pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    const fine = groupEnd(state, content, applied, ev);
    if (fine) return fine;
    const r1 = fase(inc.ordine.slice(pgIdx + 1));
    if (r1) return r1;
    inc.round += 1;
    state.supporti = state.supporti.filter(s => s.round >= inc.round);
    // il bersaglio corrente, per il resoconto e l'interfaccia
    const cur = A.unita(inc, inc.bersaglio);
    inc.bersaglio = cur && cur.attivo ? cur.uid : (A.attive(inc)[0] || {}).uid || null;
    inc.nemico = clone(A.unita(inc, inc.bersaglio) || inc.nemici[0]);
    return null;
  }

  function enemyAttack(state, content, dice, ev, azione, bonusColpire, attaccante) {
    const pg = state.personaggio, inc = state.incontro, foe = attaccante || state.incontro.nemico;
    const att = azione || foe.attacco;
    const meNow = pgCombatant(state);
    const bonus = supportSaveBonus(state) + armorSaveBonus(state);
    if (bonus) meNow.traits['Resistenza'] = (meNow.traits['Resistenza'] || 0) + bonus;
    const mods = attackMods(foeStat(foe, 'dex'), att, pgStat(state, 'dmen'));
    if (bonusColpire) mods.bonusColpire += bonusColpire;
    const r2 = R().resolveAttack(dice, attaccante ? unitCombatant(attaccante) : foe, meNow, mods, pgDefense(state, meNow));
    // taratura uno contro uno (SOLO_TUNING.dannoNemico), mai per Raven
    const T = R().SOLO_TUNING.dannoNemico;
    if (T && r2.finalDamage > 0 && inc.nemicoId !== 'raven') {
      const f = Math.max(T.fattoreMinimo, Math.min(1, (pg.hpMaxTracked || 0) / T.hpRiferimento));
      if (f < 1) { r2.dannoPrimaDellaTaratura = r2.finalDamage; r2.finalDamage = Math.max(1, Math.ceil(r2.finalDamage * f)); r2.taratura = f; }
    }
    const hpPrima = pg.hpCur;
    pg.hpCur = Math.max(0, pg.hpCur - r2.finalDamage);
    const az = { chi: 'nemico', tipo: 'attacco', capacita: att.nome, esito: r2, hpPg: pg.hpCur, perso: hpPrima - pg.hpCur };
    const S_ = att.stato;
    if (S_ && r2.finalDamage > 0 && pg.hpCur > 0) {
      const res = S_.resistenza ? R().resolveCheck({ dice, sheet: pg, trait: S_.resistenza.tratto, nc: S_.resistenza.nc, difficolta: state.difficolta }) : null;
      const resistito = !!(res && R().isSuccess(res.esito));
      az.stato = { nome: S_.nome, resistito, check: res };
      if (!resistito) state.supporti.push(Object.assign({ nome: S_.nome, bonus: Object.assign({}, S_.bonus || {}), round: inc.round + (S_.durataTurni || 1), fonte: foe.nome, durataTurni: S_.durataTurni || 1 }, S_.stato ? { stato: S_.stato, perTurno: S_.perTurno || null, rimozione: S_.rimozione || null } : {}));
    }
    ev.combattimento.azioni.push(az);
  }

  /* ------------------------------------------ capacità e risorse

     Ogni capacità dichiara le proprie risorse (rm-solo-capacita/1):
     - costo in MP: Abilità magiche secondo abilitaCostoForLv (6 al Lv 1),
       Tecniche nessun costo in MP (regolamento dell'app);
     - risorsaSpeciale: 'gemma' (la gemma associata deve essere attiva; non
       si consuma usando la capacità), 'energia_armatura' (Epizi: energia
       pagata in MP, costoRisorsaSpeciale), 'vitalita' (HP),
       'per_scena' / 'per_combattimento' (utilizziMassimi), null.
     Un valore non ancora approvato (null) non viene mai inventato: un costo
     non definito non si applica, una forzatura non definita non è
     consentita. */
  /* Campi meccanici bloccanti: senza un valore approvato la capacità non
     si usa (nessun valore inventato). Metadati (nomi proposti, note,
     provenienza) non bloccano. In anteprima (solo sviluppo) valgono le
     proposte dei dati. */
  const BLOCCANTI = ['costoMP', 'effetto', 'durataTurni', 'bersaglio', 'condizioniUso', 'utilizziMassimi', 'slotRichiesti', 'risorsaSpeciale', 'costoRisorsaSpeciale', 'forzatura'];
  function capGaps(ab, anteprima) {
    const out = [];
    (ab.daApprovare || []).forEach(x => { const k = String(x).split(' ')[0]; if (BLOCCANTI.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k); });
    Object.entries(ab.fonti || {}).forEach(([k, f]) => { if (f === 'P' && BLOCCANTI.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k); });
    return anteprima ? out.filter(k => !Object.prototype.hasOwnProperty.call(ab.proposte || {}, k)) : out;
  }
  function effectiveCap(ab, anteprima) {
    if (!anteprima || !ab.proposte) return ab;
    const e = Object.assign({}, ab);
    capGaps(ab, false).forEach(k => { if (Object.prototype.hasOwnProperty.call(ab.proposte, k)) e[k] = ab.proposte[k]; });
    return e;
  }
  function archetypeReady(arch, anteprima) {
    return [].concat(arch.tecniche || [], arch.abilita || []).every(ab => !capGaps(ab, anteprima).length);
  }
  function bonusOf(ab) { return ab.bonusStat || (ab.bonus && !Array.isArray(ab.bonus) ? ab.bonus : {}); }
  function magicRules(content) {
    return content.regole_magia || { gemme: { popolazioni: ['Chorisfos'] }, manifestazione_senza_gemme: { automatica: true, fatto_testimoni: 'F_magia_senza_gemme_daren' } };
  }
  function gemOf(pg, id) { return (pg.gemme || []).find(g => g.id === id) || null; }
  function gemForCapacity(pg, ab) {
    if (ab.risorsaSpeciale === 'gemma') return gemOf(pg, ab.gemma) || (pg.gemme || []).find(g => g.capacitaAssociata === ab.id) || null;
    return null;
  }
  function capName(pg, id) {
    const ab = [].concat(pg.tecniche || [], pg.abilita || [], pg.capacitaSpeciali || [], pg.capacitaIncompatibili || []).find(x => x.id === id);
    return ab ? ab.nome : id;
  }
  function capacityList(pg, kind) {
    return kind === 'gemma' ? (pg.capacitaSpeciali || []).filter(a => a.fuoriSlot === true && a.risorsaSpeciale === 'gemma') : kind === 'abilita' ? (pg.abilita || []) : kind === 'tecnica' ? (pg.tecniche || []) : [];
  }
  function mpCostOf(kind, ab) {
    const base = (kind === 'abilita' || (kind === 'gemma' && ab.categoria === 'magia')) ? abilitaCostoForLv(ab.lv) : kind === 'speciale' ? 0 : (Number(ab.costoMP) || 0);
    const energia = ab.risorsaSpeciale === 'energia_armatura' && Number.isFinite(ab.costoRisorsaSpeciale) ? ab.costoRisorsaSpeciale : 0;
    return base + energia;
  }
  function manifestRule(state, content) {
    const ms = magicRules(content).manifestazione_senza_gemme;
    return ms && (ms.automatica || state.flags[ms.flag_abilitante]) ? ms : null;
  }
  function capacityStatus(state, content, kind, abIn) {
    const pg = state.personaggio, M_ = magicRules(content);
    const gaps = capGaps(abIn, !!state.anteprima);
    const ab = effectiveCap(abIn, !!state.anteprima);
    const out = { ok: true, motivo: '', costoMP: mpCostOf(kind, ab), forzabile: false, manifestazione: false, costoHP: 0, mancanti: gaps };
    if (gaps.length) return Object.assign(out, { ok: false, motivo: ab.nome + ' non è ancora utilizzabile.' });
    // magia degli Epizi: solo quando l'arco del personaggio la prevede
    const me = M_.magia_epizi;
    if (kind === 'abilita' && me && me.popolazioni.indexOf(pg.popolazione) !== -1 && !state.flags[me.flag_abilitante]) {
      return Object.assign(out, { ok: false, motivo: 'Per un Epizio la magia non è una capacità ordinaria: può manifestarsi solo quando la storia lo prevede.' });
    }
    if (ab.risorsaSpeciale === 'gemma') {
      const g = gemForCapacity(pg, ab);
      if (!g || g.stato !== 'attiva') {
        if (kind === 'abilita' && manifestRule(state, content)) out.manifestazione = true;
        else return Object.assign(out, { ok: false, motivo: (g ? g.nome + ' è scarica' : 'Nessuna gemma associata') + ': ' + ab.nome + ' non è disponibile fino al reintegro.' });
      }
    }
    if (ab.risorsaSpeciale === 'vitalita' && Number.isFinite(ab.costoRisorsaSpeciale)) {
      out.costoHP = ab.costoRisorsaSpeciale;
      if (pg.hpCur <= out.costoHP) return Object.assign(out, { ok: false, motivo: 'Non hai abbastanza vitalità per ' + ab.nome + '.' });
    }
    if ((ab.risorsaSpeciale === 'per_scena' || ab.risorsaSpeciale === 'per_combattimento') && Number.isFinite(ab.utilizziMassimi)) {
      const usati = ab.risorsaSpeciale === 'per_scena' ? ((state.usiScena || {})[ab.id] || 0) : (((state.incontro || {}).usi || {})[ab.id] || 0);
      if (usati >= ab.utilizziMassimi) return Object.assign(out, { ok: false, motivo: ab.nome + ': utilizzi esauriti ' + (ab.risorsaSpeciale === 'per_scena' ? 'per questa scena' : 'per questo combattimento') + '.' });
    }
    if (pg.mpCur < out.costoMP) {
      const fz = ab.forzatura;
      const regole = content.regole_armatura;
      if (ab.risorsaSpeciale === 'energia_armatura' && fz && fz.consentita === true && Number.isFinite(fz.costoVitalita) && regole && regole.popolazioni.indexOf(pg.popolazione) !== -1) {
        out.forzabile = true; out.costoHP = fz.costoVitalita;
      }
      return Object.assign(out, { ok: false, motivo: 'MP insufficienti (' + pg.mpCur + '/' + out.costoMP + ')' + (out.forzabile ? ': puoi forzare l\'armatura pagando ' + fz.costoVitalita + ' HP.' : '.') });
    }
    return out;
  }
  function payCapability(state, content, ab, st, forzata, applied, ev) {
    const pg = state.personaggio;
    if (forzata) {
      // forzatura dell'armatura: l'energia manca, paga la vitalità
      pg.hpCur = Math.max(0, pg.hpCur - st.costoHP);
      state.flags.abusi_armatura = (Number(state.flags.abusi_armatura) || 0) + 1;
      applied.push({ tipo: 'forzatura', capacita: ab.nome, hp: -st.costoHP, valore: pg.hpCur, abusi: state.flags.abusi_armatura });
      armorAbuse(state, content, applied, ev);
    } else {
      if (st.costoMP) { pg.mpCur -= st.costoMP; applied.push({ tipo: 'costo', risorsa: 'MP', delta: -st.costoMP, valore: pg.mpCur }); }
      if (st.costoHP) { pg.hpCur = Math.max(0, pg.hpCur - st.costoHP); applied.push({ tipo: 'costo', risorsa: 'HP', delta: -st.costoHP, valore: pg.hpCur }); }
    }
    if (ab.risorsaSpeciale === 'per_scena') { state.usiScena = state.usiScena || {}; state.usiScena[ab.id] = (state.usiScena[ab.id] || 0) + 1; }
    if (ab.risorsaSpeciale === 'per_combattimento' && state.incontro) { state.incontro.usi = state.incontro.usi || {}; state.incontro.usi[ab.id] = (state.incontro.usi[ab.id] || 0) + 1; }
  }
  function addNote(state, testo, categoria, applied) {
    state.note = state.note || [];
    state.note.push({ scena: state.scena, testo, categoria, evento: curEvent ? curEvent.n : null });
    applied.push({ tipo: 'nota', testo, categoria });
  }
  /* Abuso dell'armatura (Epizi): conseguenze fisiche e narrative; soglie
     di perdita di coscienza e di morte dai contenuti (regole_armatura),
     mai inventate: senza soglie approvate restano solo le conseguenze
     narrative. */
  function armorAbuse(state, content, applied, ev) {
    const R_ = content.regole_armatura || {};
    const n = state.flags.abusi_armatura;
    addNote(state, (R_.conseguenza_testo || 'L\'armatura, senza energia, si nutre della tua linfa vitale.') + ' (forzature: ' + n + ')', 'cambiamento', applied);
    if (Number.isFinite(R_.soglia_morte) && n >= R_.soglia_morte) {
      state.incontro = null; state.stato = 'morto'; state.motivoFine = 'armatura';
      state.ritorno = state.difficolta === 'permadeath' ? 'escluso' : 'non_definito';
      applied.push({ tipo: 'morte', definitiva: true, causa: 'armatura', ritorno: state.ritorno });
      ev.incontroEsito = 'morte';
    } else if (Number.isFinite(R_.soglia_incoscienza) && n >= R_.soglia_incoscienza) {
      state.personaggio.hpCur = 0;
      applied.push({ tipo: 'incoscienza', causa: 'armatura' });
    }
  }
  function witnesses(state, content, fatto, applied) {
    if (!fatto) return;
    (currentScene(state, content).png_presenti || []).forEach(p => {
      const s = state.png[p];
      if (s && s.sa.indexOf(fatto) === -1) { s.sa.push(fatto); applied.push({ tipo: 'png_sa', png: p, fatto }); }
    });
  }
  /* Magia anomala: la manifestazione senza gemme di un Chorisfos (solo se
     l'arco la rende possibile) e la magia vista di un Epizio producono
     conseguenze sociali, registrate nel diario e note ai presenti. */
  function channelMagic(state, content, st, applied) {
    const pg = state.personaggio, M_ = magicRules(content);
    const tm = M_.testimoni_magia || M_.magia_epizi;
    if (tm && tm.popolazioni.indexOf(pg.popolazione) !== -1) {
      state.flags.magia_vista = (Number(state.flags.magia_vista) || 0) + ((currentScene(state, content).png_presenti || []).length ? 1 : 0);
      witnesses(state, content, tm.fatto_testimoni, applied);
      if (tm.conseguenze) addNote(state, tm.conseguenze, 'cambiamento', applied);
    }
    if (!st.manifestazione) return;
    const ms = M_.manifestazione_senza_gemme;
    state.flags.magia_senza_gemme = (Number(state.flags.magia_senza_gemme) || 0) + 1;
    applied.push({ tipo: 'magia_senza_gemme' });
    witnesses(state, content, ms.fatto_testimoni, applied);
    if (ms.conseguenze) addNote(state, ms.conseguenze, 'cambiamento', applied);
  }

  /* ---------------------------------------------------------- gemme

     Una gemma attiva permette la capacità associata (che costa MP). Il
     giocatore può scaricarla con un'azione completa per recuperare MP
     (SOLO_TUNING.gemme, arrotondato per difetto, mai oltre il massimo):
     resta scarica, e la capacità non è disponibile, fino al reintegro di
     un avamposto (una gemma a scelta per avamposto, nessun MP). */
  function gemRecovery(pg) {
    const T = R().SOLO_TUNING.gemme;
    return Math.floor((pg.mpMaxTracked || 0) * T.recuperoMpPercentuale / 100);
  }
  function inventoryBlocked(state) {
    if (isOver(state)) return 'La partita è conclusa.';
    if (state.personaggio.hpCur <= 0) return 'Non sei in condizione di agire.';
    if (state.interazione && state.interazione.dialogo) return 'Durante un dialogo non puoi usare l\'equipaggiamento.';
    return '';
  }
  function gemDischargeBlock(state, gemId) {
    const pg = state.personaggio, g = gemOf(pg, gemId);
    if (!g) return 'Non possiedi questa gemma.';
    if (g.stato !== 'attiva') return g.nome + ' è già scarica.';
    if (pg.mpCur >= pg.mpMaxTracked) return 'Hai già gli MP al massimo.';
    return inventoryBlocked(state);
  }
  function gemInfo(state, content, gemId) {
    const pg = state.personaggio, g = gemOf(pg, gemId);
    if (!g) return null;
    const rec = Math.min(gemRecovery(pg), Math.max(0, pg.mpMaxTracked - pg.mpCur));
    return { id: g.id, nome: g.nome, tipo: g.tipo, stato: g.stato, capacita: capName(pg, g.capacitaAssociata), capacitaSospesa: !!g.capacitaSospesa, effettoAttivo: g.effettoAttivo,
      recuperoMP: gemRecovery(pg), recuperoEffettivo: rec, scaricabile: !gemDischargeBlock(state, gemId), motivo: gemDischargeBlock(state, gemId) };
  }
  function dischargeGem(state, content, gemId, applied, ev) {
    const why = gemDischargeBlock(state, gemId);
    if (why) throw new SoloError('azione_non_valida', why);
    const pg = state.personaggio, g = gemOf(pg, gemId);
    const rec = Math.min(gemRecovery(pg), pg.mpMaxTracked - pg.mpCur);
    g.stato = 'scarica';
    pg.mpCur += rec;
    applied.push({ tipo: 'gemma_scarica', gemma: g.id, nome: g.nome, mp: rec, valore: pg.mpCur, capacita: capName(pg, g.capacitaAssociata) });
  }
  function reintegrateGem(state, content, gemId, applied, ev) {
    const sc = currentScene(state, content), pg = state.personaggio;
    if (!sc.avamposto) throw new SoloError('azione_non_valida', 'Qui non c\'è un avamposto dove reintegrare una gemma.');
    if (!(pg.gemme || []).length) throw new SoloError('azione_non_valida', 'Non porti gemme da reintegrare.');
    if (state.flags['reintegro_' + sc.id]) throw new SoloError('azione_non_valida', 'A questo avamposto hai già reintegrato una gemma.');
    const g = gemOf(pg, gemId);
    if (!g) throw new SoloError('azione_non_valida', 'Scegli quale gemma reintegrare.');
    if (g.stato === 'attiva') throw new SoloError('azione_non_valida', g.nome + ' è già attiva.');
    if (g.reintegrabile === false) throw new SoloError('azione_non_valida', g.nome + ' non si può reintegrare.');
    state.flags['reintegro_' + sc.id] = g.id;
    g.stato = 'attiva';
    applied.push({ tipo: 'gemma_reintegrata', gemma: g.id, nome: g.nome, capacita: capName(pg, g.capacitaAssociata) });
  }

  /* Cambi di classe decisi dall'autore sui preset (salvataggi precedenti).
     Riconosce il personaggio dall'id stabile dell'archetipo, cambia la
     classe e ricalcola SOLO i valori che dipendono dalla classe (HP/MP/PR
     massimi e correnti in proporzione, PP, slot, sblocchi di livello);
     conserva livello, progressione, eventi, relazioni, inventario e gemme.
     Idempotente: segnata in pg.migrazioni, mai applicata due volte. */
  const MIGRAZIONI_CLASSE = { daren: { id: 'daren_mago_eclettico_1', da: 'mago', a: 'eclettico' } };
  function migraClasse(state, archetipo) {
    const pg = state.personaggio;
    const m = MIGRAZIONI_CLASSE[pg.archetipo];
    if (!m || archetipo.id !== pg.archetipo || archetipo.build !== m.a) return false;
    pg.migrazioni = Array.isArray(pg.migrazioni) ? pg.migrazioni : [];
    if (pg.build === m.a) { if (pg.migrazioni.indexOf(m.id) === -1 && (archetipo.capacitaIncompatibili || []).length && !pg.slotVacanti) pg.slotVacanti = clone(archetipo.slotVacanti || []); return false; }
    if (pg.migrazioni.indexOf(m.id) !== -1 || pg.build !== m.da) return false;
    const vecchia = BUILDS[m.da], nuova = BUILDS[m.a];
    const hpMult = nuova.hpMult || (archetipo.eclecticoHpMult === 5 ? 5 : 7);
    const mpMult = nuova.mpMult || (hpMult === 7 ? 5 : 7);
    const hpMax = Math.round(pg.hpMaxTracked * hpMult / vecchia.hpMult);
    const mpMax = Math.round(pg.mpMaxTracked * mpMult / vecchia.mpMult);
    const prMax = Math.max(0, pg.prMaxTracked - vecchia.prIniziali + nuova.prIniziali);
    const scala = (cur, da, a) => da > 0 ? Math.max(0, Math.min(a, Math.round(cur / da * a))) : a;
    const ppDa = pg.hpMaxTracked / 2 + pg.mpMaxTracked / 2, ppA = hpMax / 2 + mpMax / 2;
    pg.hpCur = scala(pg.hpCur, pg.hpMaxTracked, hpMax);
    pg.mpCur = scala(pg.mpCur, pg.mpMaxTracked, mpMax);
    pg.prCur = scala(pg.prCur, pg.prMaxTracked, prMax);
    if (Number.isFinite(pg.ppCur)) pg.ppCur = ppDa > 0 ? Math.round(pg.ppCur / ppDa * ppA * 2) / 2 : ppA;
    pg.hpMaxTracked = hpMax; pg.mpMaxTracked = mpMax; pg.prMaxTracked = prMax;
    // capacità che la nuova classe non ospita: fuori dagli slot, con livello e utilizzi conservati
    const incomp = (archetipo.capacitaIncompatibili || []).map(x => x.capacita.id);
    pg.capacitaIncompatibili = Array.isArray(pg.capacitaIncompatibili) ? pg.capacitaIncompatibili : [];
    pg.abilita = (pg.abilita || []).filter(ab => {
      if (incomp.indexOf(ab.id) === -1) return true;
      if (!pg.capacitaIncompatibili.some(x => x.id === ab.id)) pg.capacitaIncompatibili.push(ab);
      return false;
    });
    pg.slotVacanti = clone(archetipo.slotVacanti || []);
    const sosp = (archetipo.gemme || []).filter(g => g.capacitaSospesa).map(g => g.id);
    (pg.gemme || []).forEach(g => { if (sosp.indexOf(g.id) !== -1) g.capacitaSospesa = true; });
    pg.build = m.a;
    // sblocchi già maturati: ricontati con la tabella della nuova classe
    if (state.progresso && Array.isArray(state.progresso.sblocchi)) {
      state.progresso.sblocchi = state.progresso.sblocchi.map(x => {
        const prima = tecAbSbloccate(m.a, x.livello - 1, {}), dopo = tecAbSbloccate(m.a, x.livello, {});
        return Object.assign({}, x, { tecniche: dopo.tec - prima.tec, abilita: dopo.ab - prima.ab });
      }).filter(x => x.tecniche || x.abilita);
    }
    pg.migrazioni.push(m.id);
    return true;
  }

  /* Salvataggi precedenti (cariche di gemma, capacità senza struttura
     esplicita): allineati ai dati attuali dell'archetipo, senza toccare
     livello, utilizzi e risorse correnti. */
  function migrate(state, archetipo, content) {
    // stato narrativo versionato (regista): idempotente, non tocca esiti
    if (state && content && Dir()) Dir().migrate(state, content);
    // scene-seme: memoria narrativa e modo della scena corrente (idempotente)
    if (state && content && IM()) {
      IM().memoria(state);
      if (state.interazione && !state.interazione.modo) state.interazione.modo = semiMode(content) ? 'semi' : 'classico';
    }
    if (state && content && strutturaMode(content)) ST().migra(state, content);
    if (state && content && MP() && MP().M(content)) MP().migra(state, content);
    const pg = state && state.personaggio;
    if (!pg || !archetipo) return state;
    if (!Array.isArray(pg.gemme)) {
      pg.gemme = (Array.isArray(archetipo.gemme) ? archetipo.gemme : []).map(gemmaDa);
      pg.capacitaSpeciali = clone(archetipo.capacitaSpeciali || []);
    }
    delete pg.gemmeCariche; delete pg.gemmeMax;
    if (content && content.storia === 'eidos' && ['sava', 'ilyan'].includes(pg.archetipo) && pg.archetipo === archetipo.id && /autore/i.test((archetipo.ontologia.fonti || {}).peopleId || '')) {
      pg.popolazione = archetipo.popolazione; pg.peopleId = archetipo.ontologia.peopleId;
      pg.provenienza = archetipo.citta || ''; pg.appartenenzaPolitica = archetipo.ontologia.factionId === 'antarsi' ? 'Antarsi' : '';
    }
    migraClasse(state, archetipo);
    // Decisione canonica: Reticolo appartiene alla gemma difensiva, fuori slot.
    const reticolo = (archetipo.capacitaSpeciali || []).find(a => a.id === 'reticolo' && a.fuoriSlot === true);
    // già migrato (fuori slot, nessun valore in attesa, nessun residuo): niente da toccare
    const giaFuori = reticolo && (pg.capacitaSpeciali || []).find(a => a.id === reticolo.id && a.fuoriSlot === true);
    const migrato = giaFuori && !capGaps(giaFuori, false).length && !(pg.abilita || []).some(a => a.id === reticolo.id)
      && !(pg.capacitaIncompatibili || []).some(a => a.id === reticolo.id) && !(gemOf(pg, reticolo.gemma) || {}).capacitaSospesa;
    if (pg.archetipo === 'daren' && reticolo && !migrato) {
      pg.capacitaSpeciali = pg.capacitaSpeciali || [];
      const precedente = (pg.abilita || []).find(a => a.id === reticolo.id)
        || (pg.capacitaIncompatibili || []).find(a => a.id === reticolo.id)
        || pg.capacitaSpeciali.find(a => a.id === reticolo.id);
      const trasferita = Object.assign(clone(reticolo), precedente || {}, {
        categoria: reticolo.categoria, slotRichiesti: 0, fuoriSlot: true,
        fonti: Object.assign({}, reticolo.fonti, (precedente || {}).fonti, { slotRichiesti: 'A' }),
        approvazioneFuoriSlot: clone(reticolo.approvazioneFuoriSlot)
      });
      const pendenti = capGaps(trasferita, false);
      Object.keys((reticolo.approvazione || {}).valori || {}).filter(k => pendenti.includes(k)).forEach(k => {
        trasferita[k] = clone(reticolo[k]);
        trasferita.fonti[k] = 'A';
        trasferita.daApprovare = (trasferita.daApprovare || []).filter(x => String(x).split(' ')[0] !== k);
        if (trasferita.proposte) delete trasferita.proposte[k];
      });
      trasferita.daApprovare = (trasferita.daApprovare || []).filter(x => String(x).split(' ')[0] !== 'slotRichiesti');
      pg.capacitaSpeciali = pg.capacitaSpeciali.filter(a => a.id !== reticolo.id).concat([trasferita]);
      pg.abilita = (pg.abilita || []).filter(a => a.id !== reticolo.id);
      pg.capacitaIncompatibili = (pg.capacitaIncompatibili || []).filter(a => a.id !== reticolo.id);
      const g = gemOf(pg, reticolo.gemma);
      if (g) { delete g.capacitaSospesa; g.effettoAttivo = (archetipo.gemme || []).find(x => x.id === g.id).effettoAttivo; }
    }
    ['tecniche', 'abilita'].forEach(k => {
      pg[k] = (pg[k] || []).map(ab => {
        const def = (archetipo[k] || []).find(x => x.id === ab.id);
        if (def && !ab.categoria) return Object.assign(clone(def), { lv: ab.lv, utilizzi: ab.utilizzi || 0 });
        // Applica soltanto i campi pendenti ora approvati dall'autore.
        // Livello, utilizzi, risorse e modifiche già consolidate restano intatti.
        if (def && def.approvazione) {
          const pending = capGaps(ab, false);
          Object.keys(def.approvazione.valori || {}).filter(k => pending.indexOf(k) !== -1).forEach(k => {
            ab[k] = clone(def[k]);
            ab.fonti = Object.assign({}, ab.fonti, { [k]: 'A' });
            ab.daApprovare = (ab.daApprovare || []).filter(x => String(x).split(' ')[0] !== k);
            if (ab.proposte) delete ab.proposte[k];
          });
          ab.approvazione = clone(def.approvazione);
        }
        return ab;
      });
    });
    return state;
  }

  /* Contatore "utilizzi" (js/data.js utilizziLimitFor): raggiunto il
     limite si azzera e la capacità sale di un livello. */
  function trackUse(pg, ab, applied) {
    ab.utilizzi = (ab.utilizzi || 0) + 1;
    const lim = utilizziLimitFor(pg.qi, ab.lv);
    if (ab.utilizzi >= lim) {
      ab.utilizzi = 0; ab.lv += 1;
      applied.push({ tipo: 'capacita_lv', capacita: ab.nome, lv: ab.lv });
    }
  }

  function endEncounter(state, content, esito, applied, ev) {
    const inc = state.incontro;
    ev.incontroEsito = esito;
    ev.nemicoId = inc.nemicoId;
    applied.push({ tipo: 'incontro', esito, nemico: inc.nemico.nome });
    if (inc.nemicoId === 'raven') {
      state.raven.pending = false;
      state.raven.esito = esito;
    } else {
      const sc = currentScene(state, content);
      // resa: l'avversario cede, la posta dello scontro è ottenuta
      if ((esito === 'vittoria' || esito === 'resa') && sc.incontro) applyEffects(state, content, sc.incontro.vittoria, 'vittoria:' + sc.id, applied);
      state.flags['incontro_' + state.scena + '_concluso'] = esito;
      // campagna lunga: destino di ogni partecipante e conseguenze persistenti
      if (inc.gruppo) {
        state.flags['incontro_' + state.scena + '_unita'] = inc.nemici.reduce((o, n) => { o[n.uid] = n.esito || 'attivo'; return o; }, {});
        // bottino: gli oggetti di catalogo che sconfitti e arresi non hanno usato
        if (esito === 'vittoria' || esito === 'resa') inc.nemici.filter(n => n.esito === 'sconfitto' || n.esito === 'arreso').forEach(n => (n.oggetti || []).forEach(o => {
          if (!o.bottino || !o.catalogo || !itemDef(content, o.catalogo)) return;
          for (let i = 0; i < o.rimasti; i++) addItem(state, content, o.catalogo, 'bottino:' + sc.id + ':' + n.uid + ':' + o.id + ':' + i, applied);
        }));
        applyEffects(state, content, (inc.conseguenze || {})[esito] || [], 'conseguenze_incontro:' + sc.id + ':' + esito, applied);
      }
    }
    state.incontro = null;
    state.supporti = [];
    return esito;
  }

  function pgDown(state, content, applied, ev) {
    const inc = state.incontro;
    const pg = state.personaggio;
    if (inc.nemicoId === 'raven') {
      state.incontro = null;
      return killByRaven(state, applied, ev);
    }
    const letale = inc.letale;
    const diff = state.difficolta;
    // Stati formalizzati: sconfitto -> recupero oppure morto.
    // Permadeath: ogni caduta è definitiva. Campagne V4 (Esplorativa e
    // Bilanciata): "recupero coerente" anche negli scontri letali, con un
    // costo più alto. Contenuti precedenti (fixture): morte negli incontri
    // letali, ritorno non definito.
    const v4 = !!content.ending_contract || !!(content.contratto && content.contratto.ending_contract);
    const muore = diff === 'permadeath' || (letale && !v4);
    if (muore) {
      state.incontro = null;
      state.stato = 'morto';
      state.motivoFine = 'morte_in_combattimento';
      state.ritorno = diff === 'permadeath' ? 'escluso' : 'non_definito';
      applied.push({ tipo: 'morte', definitiva: diff === 'permadeath', ritorno: state.ritorno });
      ev.incontroEsito = 'morte';
      return 'morte';
    }
    pg.hpCur = 1;
    state.condizione = 'recupero';
    applied.push({ tipo: 'sconfitta', condizione: 'recupero' });
    // sconfitta con recupero dichiarata nella scena (fail-forward):
    // salvataggio, ferita, tempo perso e conseguenze raccontati
    const ff = inc.fonte === 'scena' && (currentScene(state, content).incontro || {}).sconfitta;
    ev.testoSconfitta = (ff && ff.testo) || (content.testi && content.testi.sconfitta) || null;
    if (ff) ev.failForward = true;
    const sc = currentScene(state, content);
    const costo = [{ flag: { ferito: true } }];
    // scontro finale: la sconfitta resta nel racconto (flag), non sposta gli
    // orologi; il finale lo decidono le scelte (contratto del finale)
    if (inc.finale) {
      applyEffects(state, content, costo.concat([{ flag: { villain_prevalso: true } }]), 'sconfitta:' + sc.id + ':' + ev.n, applied);
      return endEncounter(state, content, 'sconfitta', applied, ev);
    }
    // campagna lunga: la difficoltà cambia la gravità delle conseguenze (proposta)
    const moltSconfitta = inc.gruppo && AV() ? ((AV().difficolta(state, content).sconfitta || {}).orologioMolt != null ? AV().difficolta(state, content).sconfitta.orologioMolt : 1) : 1;
    Object.entries(content.orologi || {}).forEach(([k, def]) => { if (def.sconfitta) { const d = Math.floor(def.sconfitta * (letale ? 2 : 1) * moltSconfitta); if (d > 0) costo.push({ orologio: { id: k, delta: d } }); } });
    applyEffects(state, content, costo.concat((content.testi && content.testi.sconfitta_effetti) || []), 'sconfitta:' + sc.id + ':' + ev.n, applied);
    return endEncounter(state, content, 'sconfitta', applied, ev);
  }

  function killByRaven(state, applied, ev) {
    const pg = state.personaggio;
    pg.hpCur = 0;
    state.stato = 'terminato';
    state.motivoFine = 'raven';
    state.ritorno = 'escluso';
    state.raven.pending = false;
    state.raven.esito = 'uccisione';
    ev.testoFisso = ravenText(pg.nome);
    applied.push({ tipo: 'raven_uccisione', definitiva: true });
    return 'raven';
  }

  /* Raven arriva in un momento di calma, fuori dalla trama principale:
     entrando in una scena "calma" o chiedendo un riposo. Un'apparizione
     per innesco (id dell'evento che l'ha causata): niente doppioni. */
  function maybeRaven(state, content, trigger, applied, ev) {
    if (!state.raven.pending || isOver(state) || state.incontro) return false;
    const sc = currentScene(state, content);
    if (!(sc.calma || trigger === 'riposo')) return false;
    const key = state.raven.innesco;
    if (state.raven.apparizioni.indexOf(key) !== -1) return false;
    state.raven.apparizioni.push(key);
    const pg = state.personaggio;
    applied.push({ tipo: 'raven_appare', livelloPg: pg.livello });
    if (pg.livello >= R().SOLO_TUNING.ravenLivelloSpeciale) {
      // precedenza assoluta: nessun tiro, nessuna iniziativa
      killByRaven(state, applied, ev);
      return true;
    }
    startEncounter(state, content, 'raven', { letale: true, fonte: 'raven' });
    return true;
  }

  /* -------------------------------------------------------- moderazione */

  function moderate(state, content, cmd, ev, applied) {
    if (cmd.sorgente !== 'testo' || !cmd.testo) return null;
    const v = M().classifyPlayerText(cmd.testo, { charName: state.personaggio.nome });
    ev.moderazione = { categoria: v.categoria, attore: v.attore, contesto: v.contesto, confidenza: v.confidenza, policy: v.policy };
    if (v.categoria === 'nessuna') return null;
    state.moderazione.push({ evento: ev.n, categoria: v.categoria, confidenza: v.confidenza, policy: v.policy });
    if (v.categoria === 'ambiguo' || v.confidenza !== 'alta') {
      ev.tipo = 'bloccata';
      ev.testoFisso = 'Azione sospesa: il messaggio può descrivere un atto vietato o crudele. Riformula in modo chiaro cosa fa il tuo personaggio.';
      return 'blocca';
    }
    if (v.categoria === 'violenza_sessuale') {
      state.stato = 'terminato';
      state.motivoFine = 'violenza_sessuale';
      state.ritorno = 'escluso';
      state.personaggio.hpCur = 0;
      ev.tipo = 'sanzione';
      ev.testoFisso = TESTO_BLOCCO_SV;
      applied.push({ tipo: 'sanzione', categoria: 'violenza_sessuale', definitiva: true });
      return 'termina';
    }
    if (v.categoria === 'crudelta_gratuita') {
      // Esenzione solo per un ordine GIÀ registrato nel capitolo (flag
      // ordine_registrato); le parole del giocatore non creano ordini.
      const ordine = state.flags.ordine_registrato;
      ev.tipo = 'crudelta';
      if (ordine) {
        applyEffects(state, content, [{ flag: { atto_su_ordine: 1 } }], 'ordine:' + ev.n, applied);
        ev.testoFisso = 'Esegui l\'ordine ricevuto. Non c\'è gloria in ciò che hai fatto, e chi ti conosce lo ricorderà.';
        return 'ordine';
      }
      state.ricercato = true;
      state.raven.pending = true;
      state.raven.innesco = 'evento:' + ev.n;
      state.flags.crudelta = (Number(state.flags.crudelta) || 0) + 1;
      const sc = currentScene(state, content);
      (sc.png_presenti || []).forEach(p => {
        const s = state.png[p]; if (!s) return;
        s.atteggiamento -= 2;
        applied.push({ tipo: 'relazione', png: p, delta: -2, valore: s.atteggiamento });
      });
      applied.push({ tipo: 'ricercato' });
      ev.testoFisso = TESTO_CRUDELTA;
      return 'crudelta';
    }
    return null;
  }

  /* -------------------------------------------------- comando: azione */

  /* Convalida della proposta dell'interprete (o di un pulsante). Tutto
     ciò che conta — NC, bonus, costi, esiti — lo decide questa funzione;
     dalla proposta si prendono solo scelte fra elementi già esistenti. */
  function validateProposal(state, content, p) {
    const sc = currentScene(state, content);
    if (!p || typeof p !== 'object') return { ok: false, motivo: 'Proposta assente' };
    if (p.tipo === 'chiarimento' || p.tipo === 'rifiuto') return { ok: false, tipo: p.tipo, motivo: p.motivo || '' };
    const ob = (sc.obiettivi || []).find(o => o.id === p.obiettivo);
    if (!ob) return { ok: false, tipo: 'chiarimento', motivo: 'Questa azione non porta a nessuno degli obiettivi della scena.' };
    const st = state.obiettivi[ob.id];
    if (st && st.completato) return { ok: false, tipo: 'rifiuto', motivo: 'Obiettivo già raggiunto.' };
    // scene-seme: si tenta solo ciò che il personaggio può concepire ora
    if (IM()) { const pos = IM().possibilita(state, content).obiettivi[ob.id]; if (pos && !pos.ok) return { ok: false, tipo: 'rifiuto', motivo: pos.motivo }; }
    if (ob.richiede && ob.richiede.fatto && state.fattiScoperti.indexOf(ob.richiede.fatto) === -1) {
      return { ok: false, tipo: 'rifiuto', motivo: 'Ti manca ancora un elemento per tentarlo.' };
    }
    if (ob.richiede && ob.richiede.condizione && !conditionMet(state, ob.richiede.condizione)) {
      return { ok: false, tipo: 'rifiuto', motivo: ob.richiede.motivo || 'Ti manca ancora un elemento per tentarlo.' };
    }
    // Proposta narrativa: operazione tra quelle che il motore sa risolvere
    // ed entità citate. Un PNG citato deve essere presente in scena; uno mai
    // incontrato non può essere "usato" dal giocatore.
    if (p.operazione && OPERAZIONI.indexOf(p.operazione) === -1) return { ok: false, tipo: 'chiarimento', motivo: 'Questo tipo di azione non è previsto: descrivila come dialogo, trattativa, indagine, uso di un oggetto o prova.' };
    for (const ent of (p.entita || [])) {
      const pid = resolvePng(content, ent);
      if (!pid) continue; // elemento di scena o nome generico
      if ((sc.png_presenti || []).indexOf(pid) === -1) {
        return { ok: false, tipo: 'rifiuto', motivo: state.png[pid] && state.png[pid].incontrato ? content.png[pid].nome + ' non è qui.' : 'Non conosci nessuno con quel nome qui.' };
      }
    }
    if (p.operazione === 'combinare') {
      const items = (p.oggetti || []).map(o => resolveItemId(content, o, state));
      if (items.length < 2 || items.some(id => !id || !hasItem(state, id))) return { ok: false, tipo: 'rifiuto', motivo: 'Per combinarli devi avere entrambi gli oggetti.' };
    }
    let mod = 0, oggetto = null;
    if (p.oggetto && p.oggetto !== 'nessuno') {
      const id = resolveItemId(content, p.oggetto, state);
      // Un oggetto del catalogo non posseduto è una pretesa: rifiuto. Un nome
      // che non è nel catalogo (es. "registro", "bancone") è un elemento
      // della scena, non un oggetto dell'inventario: nessun bonus, azione
      // comunque valutata.
      if (id && !hasItem(state, id)) return { ok: false, tipo: 'rifiuto', motivo: 'Non possiedi questo oggetto.' };
    }
    if (p.oggetto && p.oggetto !== 'nessuno' && resolveItemId(content, p.oggetto, state)) {
      const id = resolveItemId(content, p.oggetto, state);
      const def = itemInfo(state, content, id);
      const pertinente = (def.proprieta || []).some(t => (ob.tag || []).indexOf(t) !== -1);
      if (pertinente) mod += R().SOLO_TUNING.bonusOggetto;
      oggetto = { id, pertinente };
    }
    const q = R().SOLO_TUNING.qualitaApproccio[p.qualita] || 0;
    mod += q;
    const trait = (p.tratto && p.tratto !== 'nessuno') ? p.tratto : null;
    return { ok: true, obiettivo: ob, trait, mod, oggetto };
  }

  const OPERAZIONI = ['interagire', 'negoziare', 'investigare', 'usare_oggetto', 'combinare', 'prova', 'muoversi'];

  function resolveItemId(content, ref, state) {
    if (content.borsa.oggetti[ref]) return ref;
    const r = String(ref).toLowerCase().trim();
    const hit = Object.entries(content.borsa.oggetti).find(([, d]) => d.nome.toLowerCase() === r);
    if (hit) return hit[0];
    // istanze generate già raccolte (nome come le vede il personaggio)
    const inv = state && state.inventario.find(i => i.istanza && state.borsa.istanze[i.id] && state.borsa.istanze[i.id].nome.toLowerCase() === r);
    return inv ? inv.id : null;
  }

  function resolvePng(content, ref) {
    const r = String(ref || '').toLowerCase().replace(/_/g, ' ').trim();
    if (!r) return null;
    if (content.png[r]) return r;
    const hit = Object.entries(content.png).find(([, d]) => { const n = d.nome.toLowerCase(); return n === r || n.split(' ').some(w => w.length > 3 && w === r) || r.indexOf(n) !== -1; });
    return hit ? hit[0] : null;
  }

  function resolveAction(state, content, cmd, dice, applied, ev) {
    // (cmd serve anche per la qualità dell'approccio nella progressione)
    const v = validateProposal(state, content, cmd.proposta);
    ev.proposta = cmd.proposta || null;
    if (!v.ok) {
      ev.tipo = v.tipo === 'rifiuto' ? 'rifiutata' : 'chiarimento';
      ev.motivo = v.motivo;
      return;
    }
    const sc = currentScene(state, content);
    const ob = v.obiettivo;
    // vantaggio o svantaggio guadagnato nelle fasi precedenti della scena
    const it = state.interazione;
    const modScena = it && it.scena === state.scena ? it.mod : 0;
    if (modScena) ev.modScena = modScena;
    const check = R().resolveCheck({ dice, sheet: state.personaggio, trait: v.trait, nc: ob.nc, difficolta: state.difficolta, mod: v.mod + modScena });
    const esito = R().isSuccess(check.esito) ? 'successo' : (check.esito === 'parziale' ? 'parziale' : 'fallimento');
    ev.check = check;
    ev.esito = esito;
    ev.obiettivo = ob.id;
    ev.obiettivoTesto = ob.testo;
    ev.oggettoUsato = v.oggetto;
    const st = state.obiettivi[ob.id] || (state.obiettivi[ob.id] = { tentativi: 0, esito: null, completato: false });
    st.tentativi += 1;
    st.esito = esito;
    if (esito !== 'fallimento') st.completato = true;
    // l'id dell'obiettivo (non del comando) rende la ricompensa una tantum
    applyEffects(state, content, ob.esiti[esito], 'obiettivo:' + ob.id + ':' + esito, applied, dice);
    // un fallimento può rivelare una verità, se la scena lo prevede
    if (/fallimento/.test(esito)) discoverByEvidence(state, content, 'fallimento:' + ob.id, 'fallimento', applied);
    ev.decisione = true;
    // tempo che scorre a ogni tentativo fuori dal rifugio (fixture: antidoto)
    Object.entries(content.orologi || {}).forEach(([k, def]) => { if (def.passo === 'fuori_citta' && sc.fuori_citta) applyEffects(state, content, [{ orologio: { id: k, delta: 1 } }], 'passo:' + ev.n + ':' + k, applied, dice); });
    awardProgress(state, content, 'obiettivo:' + ob.id, progressRule(content, 'obiettivo', esito), applied);
    if (esito === 'successo' && cmd.proposta && cmd.proposta.qualita === 'forte') awardProgress(state, content, 'creativa:' + ob.id, progressRule(content, 'soluzione_creativa'), applied);
    ev.riserva = ob.riserva && ob.riserva[esito];
  }

  /* ------------------------------------------------------ API principale */

  function makeEvent(state, cmd) {
    return { n: state.eventi.length + 1, commandId: cmd.id, tipo: cmd.tipo, scena: state.scena, sorgente: cmd.sorgente || null, testo: cmd.testo || null, ts: null, effetti: [], narrazione: null };
  }

  function threatFirst(state, content, cmd) {
    const it = state.interazione;
    if (!it || it.modo !== 'semi' || it.scena !== state.scena || !it.incontroInAttesa || it.sceltaIncontro) return false;
    if (cmd.tipo === 'scelta') { const pos = IM() && IM().possibilita(state, content).scelte[cmd.sceltaId]; return !pos || pos.ok; }
    if (cmd.tipo === 'azione') { const ob = cmd.proposta && cmd.proposta.obiettivo; const pos = IM() && ob && IM().possibilita(state, content).obiettivi[ob]; return !!ob && (!pos || pos.ok); }
    return false;
  }

  /* improvvisa: proposta del Regista (IA o riserva deterministica) →
     validatore → motore. Il motore rivaluta sempre la proposta: nulla di
     ciò che il modello scrive entra nello stato senza passare di qui.
     Una sola risoluzione meccanica per comando (prova su un obiettivo,
     prova libera, scontro della scena, uso di un consumabile); tutto il
     resto è memoria narrativa tipizzata con provenienza. */
  function improvise(state, content, cmd, dice, applied, ev) {
    const M = IM();
    if (!M) throw new SoloError('comando_non_valido', 'Improvvisazione non disponibile');
    const fonte = cmd.fonte === 'ia' ? 'ia' : 'deterministico';
    const proposta = cmd.regia || M.proponi(cmd.testo || '', state, content);
    const v = M.valida(state, content, proposta, { testo: cmd.testo || '' });
    ev.testo = cmd.testo || null;
    ev.libera = true;
    ev.regia_ia = { fonte, respinte: v.respinte, corrette: v.corrette, sostanziale: v.sostanziale, meccanica: M.meccanica(v) };
    if (v.rifiuto) { ev.tipo = 'rifiutata'; ev.motivo = v.rifiuto; return; }
    if (v.chiarimento) { ev.tipo = 'chiarimento'; ev.motivo = v.chiarimento; return; }
    const acc = v.accettata;
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    // riserva senza modello e senza richiesta meccanica: comportamento
    // classico dell'esplorazione libera (materiali scritti come fallback)
    if (fonte === 'deterministico' && !acc.mechanicalResolutionRequests.length && it && sceneInteractions(content, state.scena) && !it.dialogo) {
      // comando composto: solo il primo passaggio, il resto resta intenzione
      interact(state, content, { tipo: 'esplora', libera: true, testo: (acc.intentSteps && acc.intentSteps[0]) || cmd.testo, sorgente: 'testo' }, dice, applied, ev);
      ev.improvvisata = true;
      if (acc.intenzione) M.registra(state, content, Object.assign({}, acc, { worldChangeProposals: [], relationshipDeltas: [], tensionDeltas: [], npcReactions: [], newThreadProposals: [], resolvedThreadProposals: [], transitionProposal: { tipo: 'nessuna' } }), ev.n, fonte, applied);
      return;
    }
    ev.tipo = 'improvvisazione';
    const req = acc.mechanicalResolutionRequests[0];
    if (req && req.tipo === 'prova_obiettivo') {
      if (it && it.modo === 'semi' && it.incontroInAttesa && !it.sceltaIncontro) { ev.tipo = 'minaccia'; setPhase(state, content, 'resolution', applied, ev); return; }
      resolveAction(state, content, { proposta: { tipo: 'azione', obiettivo: req.obiettivo, tratto: req.tratto, oggetto: req.oggetto || 'nessuno', qualita: 'normale', operazione: 'prova' }, testo: cmd.testo }, dice, applied, ev);
      ev.tipo = ev.tipo === 'chiarimento' || ev.tipo === 'rifiutata' ? ev.tipo : 'improvvisazione';
    } else if (req && req.tipo === 'prova_libera') {
      // prova senza obiettivo di scena: NC base del regolamento, nessuna
      // ricompensa; l'esito resta un fatto della partita
      const check = R().resolveCheck({ dice, sheet: state.personaggio, trait: req.tratto === 'nessuno' ? null : req.tratto, nc: undefined, difficolta: state.difficolta, mod: it ? it.mod || 0 : 0 });
      ev.check = check; ev.esito = check.esito; ev.obiettivoTesto = acc.requestedOutcome || req.motivo || cmd.testo;
      M.memoria(state).voci.push({ id: 'm' + (M.memoria(state).voci.length + 1), tipo: 'esito', testo: ev.obiettivoTesto, esito: check.esito, causa: req.motivo || null, fonte: 'motore', bersaglio: null, intensita: 'lieve', durata: 'scena', visibilita: 'giocatore', revisionabile: false, evento: ev.n, scena: state.scena, statoCanonico: 'dettaglio_locale_validato', statoEpistemico: 'osservato' });
    } else if (req && req.tipo === 'scontro') {
      setPhase(state, content, 'resolution', applied, ev);
    } else if (req && req.tipo === 'usa_oggetto') {
      useItem(state, content, req.oggetto, applied, ev, cmd);
      ev.tipo = 'improvvisazione';
    }
    // rivelazioni convalidate: materiale della scena, con il loro stato epistemico
    acc.revealCandidates.forEach(r => {
      const t = sceneTruths(content, state.scena).find(x => x.id === r.id);
      if (!t) return;
      if (discoverTruth(state, content, t, r.statoEpistemico === 'testimoniato' ? 'dialogo' : 'azione_libera', applied, 'improvvisazione')) {
        M.memoria(state).voci.push({ id: 'm' + (M.memoria(state).voci.length + 1), tipo: 'rivelazione', testo: t.canonicalContent, verita: t.id, causa: acc.intent || null, fonte, bersaglio: r.fonte === 'luogo' ? null : r.fonte, intensita: 'lieve', durata: 'partita', visibilita: 'giocatore', revisionabile: true, evento: ev.n, scena: state.scena, statoCanonico: 'proposta', statoEpistemico: r.statoEpistemico });
        if (!ev.riserva && !ev.check) ev.riserva = t.canonicalContent;
      }
    });
    M.registra(state, content, acc, ev.n, fonte, applied);
    // morte di un PNG proposta dal Regista: solo se il motore la convalida
    (acc.npcDeathProposals || []).forEach(d => {
      const r = PN() ? PN().applicaMorte(state, content, d.png, { tipo: d.causa, descrizione: d.descrizione }, ev.n, applied) : { ok: false, motivo: 'PNG dinamici non disponibili' };
      if (!r.ok) ev.regia_ia.respinte.push({ campo: 'npcDeathProposals', voce: d.png, motivo: r.motivo });
    });
    // il PNG può interrompere la conversazione, con un motivo
    const stop = acc.npcReactions.find(n => n.reazione === 'interrompe');
    if (stop && it && it.dialogo === stop.png) {
      const def = sceneInteractions(content, state.scena);
      const d = def && (def.dialoghi || []).find(x => x.png === stop.png);
      if (d) closeDialogue(state, content, d, stop.png, applied, ev, 'png');
    }
    if (acc.narrationPlan && acc.narrationPlan.testo && !v.sostanziale && !M.meccanica(v)) ev.pianoNarrativo = { testo: acc.narrationPlan.testo, battute: acc.narrationPlan.battute };
    // riserva coerente se il modello non racconta: materiale libero della scena
    if (!ev.riserva && !ev.check && it) {
      const def = sceneInteractions(content, state.scena);
      const pool = def ? (def.riserve_libere || []).concat([def.riserva_libera], ((content.interazioni || {}).regole || {}).riserve_libere || []).filter(Boolean) : [];
      const fresh = pool.find(t => it.libere.indexOf(t) === -1);
      if (fresh) { ev.riserva = fresh; it.libere.push(fresh); }
    }
    if (it && sceneInteractions(content, state.scena) && !state.incontro) afterInteraction(state, content, applied, ev, applied.some(a => a.tipo === 'memoria' || a.tipo === 'verita' || a.tipo === 'filo'), true);
  }

  /* prosegui (campagna lunga): il protagonista lascia il macro-capitolo
     quando il suo contratto è soddisfatto; nell'epilogo chiude la partita. */
  function proceed(state, content, cmd, dice, applied, ev) {
    if (!strutturaMode(content)) throw new SoloError('comando_non_valido', 'Comando non disponibile');
    const r = ST().prosegui(state, content);
    if (!r.ok) throw new SoloError('azione_non_valida', r.motivo);
    ev.tipo = 'prosegui';
    ev.decisione = false;
    if (r.concludi) { concludeChapter(state, content, applied); return; }
    const sc = currentScene(state, content);
    applyEffects(state, content, r.uscita.effetti, 'uscita:' + sc.id + '>' + r.uscita.verso, applied, dice);
    if (enterScene(state, content, r.uscita.verso, dice, applied)) C().evaluateConsequences(state, content, applyEffects, applied, curEvent);
  }

  /* applyCommand: il solo modo di far avanzare la partita. */
  function applyCommand(stateIn, cmd, env) {
    if (!cmd || !cmd.id) throw new SoloError('comando_non_valido', 'Comando senza id');
    if (stateIn.comandi[cmd.id] != null) {
      return { state: stateIn, event: stateIn.eventi[stateIn.comandi[cmd.id] - 1], duplicate: true };
    }
    if (cmd.expectedVersion !== stateIn.version) throw new SoloError('versione', 'La partita è cambiata: ricarica prima di agire.');
    if (isOver(stateIn)) throw new SoloError('partita_conclusa', 'La partita è conclusa.');
    const { content, dice } = env;
    const state = clone(stateIn);
    const ev = makeEvent(state, cmd);
    ev.ts = env.now || Date.now();
    const applied = ev.effetti;
    curDice = dice; curEvent = ev;
    const scenaPrima = state.scena;
    let ext = null;
    try {
    // Raven al Lv 29/30 ha precedenza su qualunque azione tentata
    if (state.raven.pending && state.personaggio.livello >= R().SOLO_TUNING.ravenLivelloSpeciale && (currentScene(state, content).calma || cmd.tipo === 'riposo')) {
      ev.tipo = 'raven';
      maybeRaven(state, content, cmd.tipo === 'riposo' ? 'riposo' : 'calma', applied, ev);
    } else {
      const mod = moderate(state, content, cmd, ev, applied);
      if (!mod) {
        if (state.incontro) {
          if (cmd.tipo !== 'combattimento') {
            if (cmd.tipo === 'azione' && cmd.proposta && cmd.proposta.combattimento) cmd = Object.assign({}, cmd, cmd.proposta.combattimento);
            else throw new SoloError('azione_non_valida', 'Sei in combattimento: scegli un\'azione di combattimento.');
          }
          ev.tipo = 'combattimento';
          combatRound(state, content, cmd, dice, applied, ev);
        } else if (state.interazione && state.interazione.dialogo && ['battuta', 'dialogo_chiudi', 'usa', 'improvvisa'].indexOf(cmd.tipo) === -1) {
          throw new SoloError('azione_non_valida', 'Stai parlando con ' + pngName(content, state.interazione.dialogo) + ': concludi il dialogo prima di fare altro.');
        } else if (state.interazione && state.interazione.sceltaIncontro && ['incontro', 'usa', 'battuta', 'dialogo_chiudi', 'improvvisa'].indexOf(cmd.tipo) === -1) {
          throw new SoloError('azione_non_valida', 'Prima decidi se affrontare ' + content.nemici[state.interazione.incontroInAttesa.nemico].nome + ' o tentare un\'altra via.');
        } else if (state.mappa && state.mappa.viaggio && state.mappa.viaggio.stato === 'in_corso' && ['viaggio_prosegui', 'usa', 'riposo'].indexOf(cmd.tipo) === -1) {
          throw new SoloError('azione_non_valida', 'Sei in viaggio: prosegui il viaggio prima di fare altro.');
        } else if (cmd.tipo === 'viaggio' || cmd.tipo === 'viaggio_prosegui') {
          // la destinazione è una RICHIESTA: il motore calcola percorso, durata e requisiti
          if (!MP() || !state.mappa) throw new SoloError('azione_non_valida', 'Nessuna mappa per questa storia.');
          if (state.interazione && (state.interazione.incontroInAttesa || state.interazione.sceltaIncontro)) throw new SoloError('azione_non_valida', 'Il pericolo ti sbarra ancora la strada.');
          const r = cmd.tipo === 'viaggio' ? MP().avvia(state, content, cmd, applied, ev) : MP().prosegui(state, content, applied, ev);
          if (r.rifiuto) { ev.tipo = r.tipo === 'preparazione' ? 'chiarimento' : 'rifiutata'; ev.motivo = r.rifiuto; if (r.tipo === 'preparazione') ev.preparazione = { mancanti: (r.piano || {}).requisitiMancanti || [] }; }
          else { ev.tipo = 'viaggio'; ev.viaggio = r.piano ? { da: r.piano.partenza, a: r.piano.destinazione, tratte: r.piano.tratte.length, durata: r.piano.durata } : null; }
        } else if (cmd.tipo === 'improvvisa' && cmd.testo && MP() && state.mappa && MP().intenzioneDiViaggio(cmd.testo) && MP().risolviDestinazione(state, content, MP().intenzioneDiViaggio(cmd.testo))) {
          // testo libero con una destinazione conosciuta: proposta di itinerario, nessuno spostamento
          const piano = MP().pianifica(state, content, MP().intenzioneDiViaggio(cmd.testo));
          ev.tipo = 'viaggio_proposto'; ev.pianoViaggio = piano;
        } else if (['improvvisa', 'azione', 'esplora'].indexOf(cmd.tipo) !== -1 && cmd.testo && global.RMSoloOntologia && (ext = global.RMSoloOntologia.azioneEsterna(state, content, cmd.testo))) {
          // Icaro: fuori dalle cupole mai senza protezione sigillata; da
          // dentro, uscire senza dotazione diventa una richiesta di preparazione
          ev.tipo = ext.tipo === 'rifiuto' ? 'rifiutata' : 'chiarimento';
          ev.motivo = ext.motivo;
          if (ext.tipo === 'preparazione') ev.preparazione = { mancanti: ext.mancanti };
        } else if (threatFirst(state, content, cmd)) {
          // scene-seme: la minaccia della scena arriva prima che il tentativo
          // si compia (come prima dello svolgimento, senza fasi obbligatorie)
          ev.tipo = 'minaccia';
          const scT = currentScene(state, content);
          ev.testo = cmd.testo || (cmd.proposta && ((scT.obiettivi || []).find(o => o.id === cmd.proposta.obiettivo) || {}).testo) || (((scT.scelte || []).find(c => c.id === cmd.sceltaId)) || {}).testo || null;
          setPhase(state, content, 'resolution', applied, ev);
        } else if (cmd.tipo === 'prosegui' || (cmd.tipo === 'improvvisa' && strutturaMode(content) && ST().intenzioneDiUscire(cmd.testo) && ST().pronta(state) && !(IM() && IM().passiComposti(cmd.testo || '').length > 1))) {
          proceed(state, content, cmd, dice, applied, ev);
        } else if (cmd.tipo === 'improvvisa') {
          improvise(state, content, cmd, dice, applied, ev);
        } else if (cmd.tipo === 'esplora' || cmd.tipo === 'dialogo_inizia' || cmd.tipo === 'battuta' || cmd.tipo === 'dialogo_chiudi') {
          interact(state, content, cmd, dice, applied, ev);
        } else if (cmd.tipo === 'azione' && !interactionGateOpen(state, content)) {
          // prima dello svolgimento un'azione scritta è un'esplorazione
          // libera: la racconta il narratore, niente prova e niente esito
          interact(state, content, Object.assign({}, cmd, { tipo: 'esplora', libera: true }), dice, applied, ev);
        } else if (cmd.tipo === 'azione') {
          resolveAction(state, content, cmd, dice, applied, ev);
        } else if (cmd.tipo === 'scelta') {
          if (!interactionGateOpen(state, content)) throw new SoloError('azione_non_valida', 'La scena non è ancora arrivata al punto di decidere: esplora e parla con i presenti.');
          const sc = currentScene(state, content);
          const ch = (sc.scelte || []).find(c => c.id === cmd.sceltaId);
          if (!ch || state.scelte[sc.id]) throw new SoloError('azione_non_valida', 'Scelta non disponibile');
          if (ch.richiede && !conditionMet(state, ch.richiede)) throw new SoloError('azione_non_valida', ch.motivo_non_disponibile || 'Ti manca ancora ciò che serve per questa scelta.');
          if (IM()) { const pos = IM().possibilita(state, content).scelte[ch.id]; if (pos && !pos.ok) throw new SoloError('azione_non_valida', pos.motivo); }
          state.scelte[sc.id] = ch.id;
          ev.sceltaTesto = ch.testo;
          ev.sceltaId = ch.id;
          ev.riserva = ch.riserva || null;
          ev.decisione = true;
          applyEffects(state, content, ch.effetti, 'scelta:' + sc.id, applied, dice);
        } else if (cmd.tipo === 'raccogli') {
          // scoperta != raccolta: solo un'istanza scoperta qui, una volta
          try { L().pickUp(state, cmd.istanza, applied); } catch (e) { throw new SoloError('azione_non_valida', e.message); }
        } else if (cmd.tipo === 'usa') {
          useItem(state, content, cmd.oggetto, applied, ev, cmd);
        } else if (cmd.tipo === 'riposo') {
          rest(state, content, applied, ev);
        } else if (cmd.tipo === 'incontro') {
          encounterChoice(state, content, cmd, dice, applied, ev);
        } else if (cmd.tipo === 'scarica_gemma') {
          dischargeGem(state, content, cmd.gemmaId, applied, ev);
        } else if (cmd.tipo === 'reintegra_gemma' || cmd.tipo === 'ricarica_gemma') {
          reintegrateGem(state, content, cmd.gemmaId, applied, ev);
        } else {
          throw new SoloError('comando_non_valido', 'Tipo di comando sconosciuto');
        }
      }
      if (!isOver(state)) {
        const before = state.scena;
        checkTransitions(state, content, dice, applied);
        if (!isOver(state) && state.scena !== before) maybeRaven(state, content, 'calma', applied, ev);
      }
    }
    // gerarchia, scene interne, contratto, PNG, tema, arco, secondari
    if (strutturaMode(content)) ST().dopoComando(state, content, ev, cmd, applied);
    // mappa: spostamenti lungo le rotte del copione, luoghi visitati o trasformati
    if (MP() && state.mappa) MP().dopoComando(stateIn, state, content, ev, applied);
    // fallimenti terminali (morte definitiva, Raven, sanzione): registrati
    // con lo stesso risolutore, mai come un falso epilogo di vittoria
    if (isOver(state) && !state.esitoFinale) state.esitoFinale = C().resolveEnding(state, content, applied, null, ev.n);
    if (ev.decisione) C().recordDecision(state, content, ev, cmd);
    if (state.progresso && !isOver(state)) {
      progressFromEffects(state, content, applied);
      // con livello_a_fine_scena il livello si guadagna solo chiudendo una
      // scena, mai per una singola risposta
      const soloFineScena = content.progressione && content.progressione.livello_a_fine_scena;
      // campagna lunga: il livello deriva solo dagli AP e dalle soglie; sale
      // al primo comando fuori da dialoghi e scontri (mai durante una
      // risposta), uno per comando, entro la fascia dell'atto
      const pausa = strutturaMode(content) && !state.incontro && !(state.interazione && state.interazione.dialogo);
      if (strutturaMode(content) ? pausa : (!soloFineScena || state.scena !== scenaPrima)) levelUpIfDue(state, content, applied);
      if (strutturaMode(content)) ST().registraLivelli(state, applied);
    }
    } finally { curDice = null; curEvent = null; }
    ev.dadi = dice.log.slice();
    // resoconto completo: esito, riepilogo tecnico, stati, transizione,
    // azioni successive e testo di riserva (js/solo/solo-feedback.js)
    const inc = state.incontro || stateIn.incontro;
    if (inc && inc.nemico) {
      ev.nemicoNome = inc.nemico.nome;
      const art = ((content.nemici || {})[inc.nemicoId] || {}).articolo;
      ev.nemicoArt = art ? (/'$/.test(art) ? art : art + ' ') + inc.nemico.nome : inc.nemico.nome;
    }
    if (F()) {
      ev.resoconto = F().build(stateIn, state, content, ev, cmd, api);
    }
    // regia drammaturgica (js/solo/solo-director.js): scrive solo lo stato
    // narrativo e ev.regia, mai esiti, risorse o condizioni dei finali
    if (F()) ev.resoconto.bundle = F().bundle(state, content, ev);
    if (Dir()) ev.regia = Dir().afterCommand(stateIn, state, content, ev, cmd);
    if (F()) ev.resoconto.riserva = ev.testoFisso || F().fallback(state, content, ev, ev.resoconto);
    // testi fissi (sanzioni, Raven, crudeltà): mai generati dall'IA
    ev.narrazione = ev.testoFisso ? { stato: 'pronta', testo: ev.testoFisso, fonte: 'fissa', battute: [] }
      : { stato: 'da_generare', testo: null, fonte: null };
    if (ev.resoconto && ev.testoFisso) ev.resoconto.narrazione = ev.testoFisso;
    state.eventi.push(ev);
    state.comandi[cmd.id] = ev.n;
    state.version += 1;
    state.updatedAt = ev.ts;
    // improvvisazione puramente narrativa: una sola chiamata al modello. Il
    // testo proposto passa dai controlli della narrazione; se la proposta è
    // stata corretta in modo sostanziale vale la riserva, senza seconda chiamata
    if (cmd.tipo === 'improvvisa' && cmd.fonte === 'ia' && ev.tipo === 'improvvisazione' && !ev.check && !state.incontro) {
      const nar = ev.pianoNarrativo
        ? { testo: ev.pianoNarrativo.testo, battute: (ev.pianoNarrativo.battute || []).map(b => ({ png: b.png, testo: b.testo })), fonte: 'ia', contratto: F() ? F().parseOutput({ narration: ev.pianoNarrativo.testo, dialogueLines: (ev.pianoNarrativo.battute || []).map(b => ({ speaker: b.png, function: b.funzione, text: b.testo })) }) : null, modello: cmd.modello || null }
        : { testo: fallbackText(state, content, ev), fonte: 'riserva', scarto: ev.regia_ia && ev.regia_ia.sostanziale ? ['proposta_corretta'] : null };
      const out = attachNarration(state, content, ev.n, nar, env.voce || null);
      return { state: out, event: out.eventi[ev.n - 1], duplicate: false };
    }
    return { state, event: ev, duplicate: false };
  }

  /* Tacche derivate dagli effetti registrati del comando: snodi raggiunti,
     verità riservate scoperte, primo miglioramento di un legame. */
  function progressFromEffects(state, content, applied) {
    const verita = (content.contratto && content.contratto.verita_riservate) || [];
    applied.slice().forEach(a => {
      if (a.tipo === 'snodo') awardProgress(state, content, 'snodo:' + a.snodo, progressRule(content, 'snodo'), applied);
      if (a.tipo === 'scoperta' && verita.indexOf(a.fatto) !== -1) awardProgress(state, content, 'verita:' + a.fatto, progressRule(content, 'verita'), applied);
      if (a.tipo === 'relazione' && a.delta > 0) awardProgress(state, content, 'legame:' + a.png, progressRule(content, 'legame'), applied);
      // campagna lunga: eventi segnalati dalla struttura con chiave unica;
      // quantità approvate, oppure zero (le proposte valgono solo in anteprima)
      if (a.tipo === 'premio_ap' && ST()) {
        const q = ST().quantitaPremio(state, content, a.fonte);
        if (q.valore > 0) awardProgress(state, content, a.chiave, q.valore, applied);
        else if (!q.approvato && !state.progresso.premiati[a.chiave]) { state.progresso.nonApprovati = state.progresso.nonApprovati || {}; state.progresso.nonApprovati[a.fonte] = (state.progresso.nonApprovati[a.fonte] || 0) + 1; }
      }
    });
  }

  /* Uso di un consumabile (catalogo o istanza generata): effetto
     dichiarato nei contenuti, mai inventato; l'oggetto esce dall'inventario. */
  function useItem(state, content, id, applied, ev, cmd) {
    const info = itemInfo(state, content, id);
    const inv = state.inventario.find(i => i.id === id && i.qty > 0);
    if (!info || !inv) throw new SoloError('azione_non_valida', 'Non possiedi questo oggetto.');
    if (info.tipo !== 'consumabile' || !info.effetto) throw new SoloError('azione_non_valida', 'Questo oggetto non si consuma così.');
    // "Carica per gemma" non è approvata: non è un secondo reintegro
    if (info.effetto.cariche_gemma) throw new SoloError('azione_non_valida', 'Questo oggetto non si può ancora usare.');
    if (inv.istanza) L().consume(state, id, applied);
    else { inv.qty -= 1; if (inv.qty <= 0) state.inventario.splice(state.inventario.indexOf(inv), 1); applied.push({ tipo: 'consumato', oggetto: id, nome: info.nome }); }
    const pg = state.personaggio;
    if (info.effetto.hp) { const g = Math.min(info.effetto.hp, pg.hpMaxTracked - pg.hpCur); pg.hpCur += g; applied.push({ tipo: 'hp', delta: g, valore: pg.hpCur }); }
    discoverByEvidence(state, content, 'oggetto:' + (inv.base || id), 'oggetto', applied);
    if (info.effetto.effetti) applyEffects(state, content, info.effetto.effetti, 'uso:' + id + ':' + ev.n, applied);
    ev.riserva = 'Usi ' + info.nome + '.';
  }

  /* Riposo: solo in una scena di calma, una volta per scena. Recupera fino
     ai P.R. del personaggio in HP e poi in MP (js/rules.js, "P.R."). */
  function rest(state, content, applied, ev) {
    const sc = currentScene(state, content);
    if (!sc.calma) throw new SoloError('azione_non_valida', 'Non è il momento di riposare.');
    if (state.flags['riposo_' + sc.id]) throw new SoloError('azione_non_valida', 'Hai già riposato qui.');
    state.flags['riposo_' + sc.id] = true;
    const pg = state.personaggio;
    let pool = pg.prCur;
    const hpGain = Math.min(pool, pg.hpMaxTracked - pg.hpCur); pg.hpCur += hpGain; pool -= hpGain;
    const mpGain = Math.min(pool, pg.mpMaxTracked - pg.mpCur); pg.mpCur += mpGain;
    state.condizione = 'normale';
    applied.push({ tipo: 'riposo', hp: hpGain, mp: mpGain });
    ev.riserva = 'Ti concedi qualche momento di quiete. Il respiro torna regolare.';
    maybeRaven(state, content, 'riposo', applied, ev);
  }

  /* --------------------------------------------------- narrazione IA */

  /* Controllo di coerenza della narrazione rispetto allo stato: vincoli
     dichiarati dalla scena (es. porta chiusa) e oggetti del catalogo
     "ricevuti" nel testo senza una ricompensa registrata nell'evento. */
  function validateNarration(state, content, ev, text) {
    const t = String(text || '');
    const problems = [];
    if (!t.trim()) problems.push('vuota');
    if (t.length > 1500) problems.push('troppo_lunga');
    const sc = sceneOf(content, ev.scena);
    (sc && sc.vincoli_narrazione || []).forEach(v => {
      if (v.se_non_flag && !state.flags[v.se_non_flag]) {
        v.vietato.forEach(re => { if (new RegExp(re, 'i').test(t)) problems.push('contraddice:' + v.se_non_flag); });
      }
    });
    const premiati = (ev.effetti || []).filter(a => a.tipo === 'ricompensa').map(a => a.oggetto);
    Object.entries(content.borsa.oggetti).forEach(([id, d]) => {
      if (premiati.indexOf(id) !== -1 || hasItem(state, id)) return;
      const re = new RegExp('(trovi|ottieni|ricevi|raccogli|ti (consegna|porge|d[aà]))[^.]{0,60}' + d.nome.split(' ')[0], 'i');
      if (re.test(t)) problems.push('oggetto_non_assegnato:' + id);
    });
    // segreti non ancora scoperti: parole distintive del testo del fatto
    Object.entries(content.fatti).forEach(([id, f]) => {
      if (!f.segreto || state.fattiScoperti.indexOf(id) !== -1 || !f.parole) return;
      if (f.parole.some(w => new RegExp(w, 'i').test(t))) problems.push('segreto:' + id);
    });
    C().lexiconHits(t, C().lockedLexicon(state, content)).forEach(h => problems.push('lessico:' + h));
    return { ok: problems.length === 0, problems };
  }

  /* Aggancia il testo a un evento già risolto. Non cambia version: la
     narrazione è un'illustrazione dell'esito, non un nuovo esito. */
  function attachNarration(stateIn, content, eventN, nar, voce) {
    const state = clone(stateIn);
    const ev = state.eventi[eventN - 1];
    if (!ev) throw new SoloError('evento', 'Evento inesistente');
    let fonte = nar.fonte, testo = nar.testo, scarto = null;
    if (fonte === 'ia') {
      const chk = validateNarration(state, content, ev, testo + ' ' + (nar.battute || []).map(b => b.testo).join(' '));
      if (!chk.ok) { scarto = chk.problems; fonte = 'riserva'; testo = fallbackText(state, content, ev); }
    }
    // Le battute valgono solo se attribuite a un PNG presente nella scena:
    // il modello a volte fa "parlare" oggetti o il protagonista.
    let battute = [], battuteScartate = 0, voceInfo = null;
    if (fonte === 'ia') {
      const sc = sceneOf(content, ev.scena);
      const presenti = (sc && sc.png_presenti || []).map(id => ({ id, nome: content.png[id].nome.toLowerCase() }));
      (nar.battute || []).forEach(b => {
        const who = String(b.png || '').toLowerCase().replace(/_/g, ' ');
        const p = presenti.find(x => who === x.id || who.indexOf(x.nome) !== -1 || x.nome.split(' ').some(w => w.length > 3 && who.indexOf(w) !== -1));
        if (p) battute.push({ png: content.png[p.id].nome, pngId: p.id, testo: b.testo }); else battuteScartate++;
      });
      // Voce narrante (V5): controlli bloccanti (pensieri del protagonista,
      // PNG che dicono ciò che non sanno) e avvisi registrati.
      if (voce && global.RMSoloVoice) {
        const vc = global.RMSoloVoice.checkNarration(voce, state, content, ev, testo, battute);
        voceInfo = { id: voce.narrative_voice.id, avvisi: vc.avvisi, parole: global.RMSoloVoice.words(testo) };
        if (vc.problemi.length) { scarto = vc.problemi; fonte = 'riserva'; testo = fallbackText(state, content, ev); battute = []; }
      }
    }
    let candidati = null;
    if (fonte === 'ia' && F()) {
      // il narratore non può introdurre effetti che il motore non ha
      // restituito (contratto di uscita e validatore esteso); oltre la
      // lunghezza prevista il testo si accorcia
      const out = nar.contratto || F().parseOutput({ narration: testo, dialogueLines: battute.map(b => ({ speaker: b.png, text: b.testo })) });
      out.narration = testo;
      out.dialogueLines = battute.map(b => ({ speaker: b.png, function: ((nar.contratto && nar.contratto.dialogueLines) || []).filter(d => d.text === b.testo).map(d => d.function)[0] || null, text: b.testo }));
      const fk = F().checkContract(state, content, ev, out);
      if (!fk.ok) { scarto = (scarto || []).concat(fk.problems); fonte = 'riserva'; testo = fallbackText(state, content, ev); battute = []; }
      else {
        testo = F().trimSentences(testo, ev.regia && ev.regia.budget ? Math.max(F().maxSentences(ev), ev.regia.budget.maxSentences) : F().maxSentences(ev));
        // candidati (mai canonici): memoria e Diario, marcati come narrativi
        if (out.memoryCandidate || out.journalCandidate) candidati = { memoria: out.memoryCandidate, diario: out.journalCandidate, statoCanonico: 'narrativo' };
      }
    }
    ev.narrazione = { stato: 'pronta', testo, fonte, battute: battute.map(b => ({ png: b.png, testo: b.testo })), battuteScartate, modello: nar.modello || null, scarto, ms: nar.ms || null, voce: voceInfo, candidati };
    if (ev.resoconto) ev.resoconto.narrazione = testo;
    return state;
  }

  function fallbackText(state, content, ev) {
    if (ev.testoFisso) return ev.testoFisso;
    if (ev.resoconto && ev.resoconto.riserva) return ev.resoconto.riserva;
    // interazioni: testo del punto o della battuta, poi ciò che cambia nella
    // scena (stallo, sviluppo, pressione) come paragrafi separati
    if (ev.svoltaTesto || ev.sviluppo || ev.pressioneTesto) {
      return [ev.riserva, ev.svoltaTesto, ev.sviluppo, ev.pressioneTesto].filter(Boolean).join('\n\n');
    }
    if (ev.riserva) return ev.riserva;
    if (ev.tipo === 'esplorazione') {
      // niente di nuovo da vedere: frasi diverse a rotazione e l'indizio di
      // ciò che la scena aspetta ancora
      const it = state.interazione;
      const giri = ['Ti guardi intorno ancora una volta, ma qui non c\'è niente che tu non abbia già visto.', 'Aspetti. Il luogo resta quello che è; sono le persone, adesso, ad avere qualcosa da dirti.', 'Fai qualche passo, torni indietro. Il tempo passa anche se tu resti fermo.', 'Niente di nuovo intorno a te: la scena aspetta una tua mossa.', 'Resti in ascolto. Nessuno fa il primo passo al posto tuo.'];
      const k = it ? it.conteggio : ev.n;
      const hint = it && it.scena === state.scena && it.modo !== 'semi' ? nextRequired(state, content) : null;
      return giri[k % giri.length] + (hint ? ' Qualcosa ti richiama: ' + hint.testo.charAt(0).toLowerCase() + hint.testo.slice(1) + '.' : '');
    }
    if (ev.tipo === 'chiarimento' && ev.preparazione) return ev.motivo;
    if (ev.tipo === 'viaggio_proposto') return ev.pianoViaggio && ev.pianoViaggio.ok ? 'Puoi metterti in viaggio: controlla l\'itinerario sulla mappa e conferma la partenza.' : ((ev.pianoViaggio && ev.pianoViaggio.motivo) || 'Non conosci una strada per arrivarci.');
    if (ev.tipo === 'viaggio') return (MP() && MP().raccontoRiserva(ev)) || (ev.scenaViaggio ? 'Il viaggio prosegue.' : 'Parti. La strada ti porta a destinazione.');
    if (ev.tipo === 'chiarimento') return 'Non è chiaro cosa vuoi fare. ' + (ev.motivo || 'Descrivi l\'azione e a quale scopo.');
    if (ev.tipo === 'rifiutata') return 'Non puoi farlo. ' + (ev.motivo || '');
    if (ev.tipo === 'combattimento') return describeCombat(ev);
    return sceneOpeningText(state, content, state.scena);
  }

  /* Apertura della scena: variante per l'archetipo del protagonista (V4:
     ingresso diverso per ogni archetipo), altrimenti quella comune. */
  function sceneOpeningText(state, content, sceneId) {
    const sc = sceneOf(content, sceneId);
    if (!sc) return '';
    const per = sc.apertura_per_archetipo && state && state.personaggio && sc.apertura_per_archetipo[state.personaggio.archetipo];
    return per || sc.apertura_riserva || '';
  }
  function choiceAvailable(state, ch) { return !ch.richiede || conditionMet(state, ch.richiede); }

  function describeCombat(ev) {
    const parts = [];
    ((ev.combattimento && ev.combattimento.azioni) || []).forEach(a => {
      if (a.tipo === 'attacco') parts.push((a.chi === 'pg' ? 'Colpisci con ' : 'Il nemico attacca con ') + a.capacita + ': ' + a.esito.finalDamage + ' danni.');
      if (a.tipo === 'supporto') parts.push('Attivi ' + a.capacita + '.');
      if (a.tipo === 'oggetto') parts.push('Usi ' + a.capacita + '.');
      if (a.tipo === 'cura' && a.chi === 'pg') parts.push(a.capacita + ': recuperi ' + a.curati + ' HP.');
      if (a.tipo === 'fuga_fallita') parts.push('Non riesci a sganciarti.');
    });
    if (ev.incontroEsito === 'vittoria') parts.push('Il nemico crolla.');
    if (ev.incontroEsito === 'fuga') parts.push('Riesci a sganciarti e a fuggire.');
    if (ev.incontroEsito === 'sconfitta') parts.push(ev.testoSconfitta || 'Cadi a terra e riesci a stento a metterti in salvo.');
    return parts.join(' ');
  }

  /* Azioni disponibili dopo un comando (etichette, nell'ordine dei
     pulsanti): parte del resoconto, mostrate dopo conseguenza e riepilogo. */
  function nextActions(state, content) {
    if (isOver(state)) return [];
    const pg = state.personaggio;
    if (state.incontro) {
      return pg.abilita.concat(pg.tecniche, capacityList(pg, 'gemma')).map(a => a.nome).concat((pg.capacitaSpeciali || []).filter(a => !a.fuoriSlot && capacityStatus(state, content, 'speciale', a).ok).map(a => a.nome), ['Attacco con l\'arma'], state.incontro.nemico.inevitabile ? [] : ['Fuga']);
    }
    const io = interactionOptions(state, content);
    if (io && io.dialogo) return io.dialogo.argomenti.map(a => a.testo).concat(['Congedati']);
    if (io && io.sceltaIncontro) return ['Affronta ' + io.sceltaIncontro.nemico, io.sceltaIncontro.alternativa];
    const sc = currentScene(state, content);
    const out = [];
    if (!io || io.aperta) {
      (sc.suggerimenti || []).filter(x => !(state.obiettivi[x.obiettivo] && state.obiettivi[x.obiettivo].completato)).forEach(x => out.push(x.testo));
      if (!state.scelte[sc.id]) (sc.scelte || []).filter(c => choiceAvailable(state, c)).forEach(c => out.push(c.testo));
    }
    if (io) { io.dialoghi.forEach(d => out.push('Parla con ' + d.nome)); io.esplora.forEach(p => out.push(p.testo)); }
    return out;
  }
  const api = { nextActions, sceneOf, itemInfo };

  global.RMSoloEngine = {
    SCHEMA, SoloError, RAVEN_TESTO, newGame, applyCommand, attachNarration, validateNarration,
    validateArchetype, sheetFromArchetype, validateProposal, fallbackText, currentScene, sceneOf,
    itemDef, itemInfo, hasItem, isOver, ravenText, conditionMet, resolvePng, OPERAZIONI,
    publicArchetypeTexts, tickCost, bandFor, sceneOpeningText, choiceAvailable,
    interactionOptions, interactionGateOpen, sceneInteractions,
    capacityStatus, capacityList, gemInfo, gemRecovery, inventoryBlocked, migrate, nextActions,
    capGaps, effectiveCap, archetypeReady, BLOCCANTI
  };
})(typeof window !== 'undefined' ? window : globalThis);
