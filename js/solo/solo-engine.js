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
  const GN = () => global.RMSoloGenere;
  /* Testi del codice con segnaposto di genere ({maschile|femminile|neutro}): si scelgono col genere della scheda. */
  const gx = (state, testo) => (GN() ? GN().applica(testo, state && state.personaggio && state.personaggio.genere, state && state.personaggio && state.personaggio.nome) : testo);
  const M = () => global.RMSoloModeration;
  const C = () => global.RMSoloCampaign;
  const L = () => global.RMSoloLoot;

  // Dadi ed evento del comando in corso: gli effetti annidati (loot nelle
  // conseguenze differite, snodi raggiunti) li usano senza doverli passare
  // attraverso ogni funzione. Validi solo dentro applyCommand/newGame.
  let curDice = null, curEvent = null;

  const SCHEMA = 'rm-solo-partita/1';
  const STATI_FINALI = ['morto', 'concluso', 'terminato', 'atto_concluso'];

  const RAVEN_TESTO = "Il Corvo Raven ha osservato le tue azioni, potrà sembrarti divertente sperimentare queste atrocità su personaggi fittizi, ma se fossero reali tu avresti causato enormi sofferenze e questo è inaccettabile. Raven ora si allontana, disgustata dall'aver sporcato la sua lama con '{NOME}', prosegue i suoi passi con la speranza di non fare mai più ritorno da te";

  const TESTO_BLOCCO_SV = 'Azione bloccata. Il tentativo di violenza sessuale non viene rappresentato. Per le regole della piattaforma il personaggio muore e la partita si conclude definitivamente, in qualunque difficoltà.';
  const TESTO_CRUDELTA = 'Il gesto è compiuto, lontano da occhi pietosi. Ma chi ne viene a sapere non lo dimenticherà: da questo momento {sei ricercato|sei ricercata|ti cercano}, e qualcosa ha cominciato a seguirti.';

  class SoloError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  const F = () => global.RMSoloFeedback;
  const Dir = () => global.RMSoloDirector;
  const IM = () => global.RMSoloImprov;
  const CN = () => global.RMSoloConoscenze;
  const AP = () => global.RMSoloApertura;
  // campagna lunga (rm-solo-struttura/1): macro-capitoli, contratto, PNG, avversari
  const ST = () => global.RMSoloStruttura;
  const PN = () => global.RMSoloPng;
  const AV = () => global.RMSoloAvversari;
  const MUN = () => global.RMMunizioni;
  const MP = () => global.RMSoloMappa;
  // griglia dello scontro (js/solo/solo-griglia.js): accesa solo con le funzioni degli esagoni di app.js
  const GR = () => (global.RMSoloGriglia && global.RMSoloGriglia.attiva) || null;
  // catalogo d'autore per gruppo e classe (Fase 2b): dotazione di Lv 1 e voci dei livelli successivi
  const CT = () => global.RMSoloCatalogo;
  // ingresso in scena, scelte contestuali e percezione passiva (Fase 4)
  const SCN = () => global.RMSoloScena;
  // memoria dello stile del giocatore (Fase 4): solo ricorrenze, mai le frasi
  const STL = () => global.RMSoloStile;
  // oracolo, imprevisti di scena e trama guidata dall'obiettivo (Fase 5)
  const TRM = () => global.RMSoloTrama;
  // motore narrativo V2 (docs/single-player/MOTORE_V2.md): stato del mondo, regista, post-processo. Mai regole.
  const MD = () => global.RMSoloMondo;
  const PI = () => global.RMSoloPiano;
  const PO = () => global.RMSoloPost;
  const ME = () => global.RMSoloMemoria;
  const CM = () => global.RMSoloComunicati;
  // ciò che il protagonista sa (fatto comunicato o in arrivo nel racconto); senza il modulo dei comunicati, come prima: registrato = noto
  const fattoNoto = (state, content, id) => CM() ? CM().noto(state, content, id) : (state.fattiScoperti || []).indexOf(id) !== -1;
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
      nome: arch.nome, genere: GN() ? GN().normalizza(arch.genere) : 'neutro', build: arch.build, popolazione: arch.popolazione, citta: arch.citta || null, mansione: arch.mansione,
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
      // Boost del gruppo (catalogo d'autore): si attivano dal pannello del combattimento (activateBoost)
      boost: (arch.boost || []).map(b => Object.assign({ progresso: 0, lvTop: false }, clone(b))),
      catalogoGruppo: arch.catalogoGruppo || null,
      // slot di classe dichiarati vuoti nei dati (nessuna capacità inventata)
      slotVacanti: clone(arch.slotVacanti || []),
      // capacità che la classe non ospita (proposta separata, fuori dagli slot)
      capacitaIncompatibili: (arch.capacitaIncompatibili || []).map(x => Object.assign({ utilizzi: 0 }, clone(x.capacita))),
      migrazioni: [],
      ritratto: null
    };
  }

  /* Il Boost è il «potere di razza» (regolamento): lo ha ogni personaggio del gruppo, preset compresi, dal catalogo.
     Mai sostituito né duplicato se la scheda ne ha già uno. */
  function giveGroupBoost(pg, content) {
    if (!CT() || !content || !content.catalogo || !pg.catalogoGruppo || (pg.boost || []).length) return;
    const g = content.catalogo.gruppi[pg.catalogoGruppo];
    const b = g && g.boost && content.catalogo.boost[g.boost];
    if (b) pg.boost = [Object.assign({ progresso: 0, lvTop: false }, clone(b))];
  }

  /* Campionario dei tratti della storia (decisione dell'autore, 2026-10-17): il level up della solitaria offre solo i
     tratti che una scena richiede (content.campionario_tratti), più quelli condizionati a chi ne ha titolo (Arkè di Eidos:
     maghi ed eclettici di un gruppo con Arkè). Copiato nella scheda; senza campionario valgono le liste ufficiali
     (js/data.js), che «I miei personaggi» continua a usare invariate. */
  function giveCampionario(pg, content) {
    const c = content && content.campionario_tratti;
    if (!c) return;
    const out = {};
    Object.keys(TRAIT_LISTS).forEach(l => { out[l] = (c.liste[l] || []).slice(); });
    const gruppo = pg.catalogoGruppo && content.catalogo && content.catalogo.gruppi[pg.catalogoGruppo];
    Object.keys(c.condizionati || {}).forEach(nome => {
      const d = c.condizionati[nome];
      const titolo = d.requisito === 'arke' ? !!(gruppo && (gruppo.arke || []).length && pg.build !== 'guerriero') : false;
      if (titolo && out[d.lista] && out[d.lista].indexOf(nome) === -1) out[d.lista].push(nome);
    });
    if (JSON.stringify(pg.campionario || null) !== JSON.stringify(out)) pg.campionario = out;
  }
  function trattiOfferti(pg) {
    return pg && pg.campionario ? pg.campionario : TRAIT_LISTS;
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
    // personaggio creato dal giocatore: le terziarie seguono la regola della scheda normale
    // (il pool si assegna nella scheda, la creazione guidata non lo impone), mai oltre il pool
    if (arch.creato ? tert > TERTIARY_POOL : tert !== TERTIARY_POOL) errors.push('Terziarie: ' + tert + ' punti' + (arch.creato ? ' oltre ' : ' invece di ') + TERTIARY_POOL);
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
    ['id', 'versione', 'stato_editoriale', 'nome', 'popolazione', 'mansione', 'build', 'background', 'obiettivo'].forEach(k => { if (!arch[k] && !(k === 'popolazione' && arch.ontologia && arch.ontologia.peopleId === null && /autore/i.test((arch.ontologia.fonti || {}).peopleId || ''))) errors.push('Campo mancante: ' + k); });
    if (['bozza', 'approvato'].indexOf(arch.stato_editoriale) === -1) errors.push('stato_editoriale non valido');
    if (!Array.isArray(arch.legami_iniziali)) errors.push('legami_iniziali mancanti');
    if (!Array.isArray(arch.conoscenze)) errors.push('conoscenze iniziali mancanti');
    // il personaggio creato dal giocatore non ha una trama personale scritta dall'autore (Fase 5)
    if (!arch.creato && (!Array.isArray(arch.occasioni_sviluppo) || Array.from({ length: content && content.pilota ? Number(content.pilota.atti) || 3 : 3 }, (_, i) => i + 1).some(n => !arch.occasioni_sviluppo.some(o => o.atto === n)))) errors.push('occasioni di sviluppo: ' + (content && content.pilota ? 'una per ciascun atto inserito' : 'una per ciascuno dei tre atti'));
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
      (arch.equip || []).filter(e => e.tipo !== 'descrittivo' && !e.catalogo).forEach(e => {
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
    // personaggio creato dal giocatore: legame con la scheda di "I miei personaggi" e obiettivo scelto
    if (archetipo.creato) { pg.creatoDa = archetipo.creatoDa; pg.obiettivoPersonale = clone(archetipo.obiettivoPersonale); }
    // gruppo del catalogo: dichiarato (personaggio creato) o ricavato dall'ontologia del preset
    if (!pg.catalogoGruppo && CT() && content.catalogo) pg.catalogoGruppo = CT().gruppoDaOntologia(content.catalogo, archetipo.ontologia);
    giveGroupBoost(pg, content);
    giveCampionario(pg, content);
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
    // regola d'inizio partita delle trame d'autore: premessa e legame con il primo PNG, scelti dal motore (RMSoloApertura)
    if (content.apertura && AP()) state.apertura = AP().scegli(content, pg);
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
    // fatti già noti alla partenza (conoscenze dell'archetipo, apertura): comunicati dalla premessa
    if (CM()) CM().iniziali(state, content);
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

  /* Canone riservato con condizioni di rivelazione (pacchetto di contesto, canone.riservato[].v con
     `fatto` e `condizioni`). PROPOSTA DA APPROVARE (condizioni scelte dall'assistente per AUT-009):
     il fatto si scopre da solo, una volta, quando c'è l'atto richiesto, tutte le verità
     precedenti sono scoperte e il PNG che le conosce è presente nella scena con
     un atteggiamento (fiducia) pari o superiore alla soglia. Finché non scatta, il testo non
     entra in nessun prompt (il fatto è segreto e non è fra i fatti scoperti); dopo diventa un
     fatto scoperto come gli altri, e quindi anche una voce del diario. */
  function sbloccaCanoneRiservato(state, content, applied) {
    const lista = ((content.contesto || {}).canone || {}).riservato || [];
    const presenti = (currentScene(state, content) || {}).png_presenti || [];
    lista.forEach(r => {
      const v = r && r.v, c = v && typeof v === 'object' ? v.condizioni : null;
      if (!c || !v.fatto || !content.fatti[v.fatto] || state.fattiScoperti.indexOf(v.fatto) !== -1) return;
      if (c.atto && state.atto < c.atto) return;
      if ((c.dopo || []).some(f => state.fattiScoperti.indexOf(f) === -1)) return;
      const tramite = (c.chiSa || []).filter(id => presenti.indexOf(id) !== -1 && state.png[id] && state.png[id].atteggiamento >= (Number(c.atteggiamentoMinimo) || 0));
      if ((c.chiSa || []).length && !tramite.length) return;
      discover(state, content, v.fatto, applied);
      applied.push({ tipo: 'canone_sbloccato', fatto: v.fatto, tramite: tramite[0] || null });
    });
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

  /* Slot di tecniche e abilità sbloccati dal livello e ancora vuoti (slotVacanti dichiarati dai dati
     esclusi: sono vuoti per scelta dell'autore). Con un gruppo del catalogo l'assegnazione è
     OBBLIGATORIA per concludere il level up (slotObbligatori); senza gruppo resta solo segnalata. */
  function slotLiberi(pg) {
    const sb = typeof tecAbSbloccate === 'function' ? tecAbSbloccate(pg.build, pg.livello, {}) : { tec: 0, ab: 0 };
    const vac = t => (pg.slotVacanti || []).filter(v => v.tipo === t).length;
    return { tecniche: Math.max(0, sb.tec - (pg.tecniche || []).length - vac('tecnica')), abilita: Math.max(0, sb.ab - (pg.abilita || []).length - vac('abilita')) };
  }
  function slotObbligatori(pg) { return pg.catalogoGruppo ? slotLiberi(pg) : { tecniche: 0, abilita: 0 }; }
  const slotDaAssegnare = pg => { const s = slotObbligatori(pg); return s.tecniche + s.abilita; };
  const NOME_KIND = { tecniche: 'tecnica', abilita: 'abilità' };

  /* PROPOSTA DA APPROVARE (Fase 2b, rivista): quando un livello sblocca nuovi slot, NON si riempiono da
     soli. Per ogni slot il giocatore sceglie fra 2-3 voci del catalogo del proprio gruppo e della propria
     classe (le prime del pool non ancora in scheda, nello stesso ordine ogni volta) oppure ne scrive una
     propria entro il tetto di danno del Lv 1 della capacità (CAPACITA_TETTI: il tetto segue il livello della
     capacità, non quello del personaggio, e una voce nuova parte dal Lv 1). Vale anche per i preset. */
  const OFFERTE_MAX = 3;
  function slotOffers(state, content) {
    const pg = state.personaggio, lib = slotObbligatori(pg);
    const usate = [].concat(pg.tecniche || [], pg.abilita || [], pg.capacitaSpeciali || []).map(x => x.id);
    const out = { tetto: typeof capacitaTetto === 'function' ? capacitaTetto('danno', 1) : 10, liberi: lib, totale: lib.tecniche + lib.abilita };
    ['tecniche', 'abilita'].forEach(kind => {
      out[kind] = lib[kind] && CT() && content.catalogo && pg.catalogoGruppo ? CT().prossime(content.catalogo, pg.catalogoGruppo, pg.build, kind, usate, OFFERTE_MAX) : [];
    });
    return out;
  }
  /* Capacità scritta dal giocatore: passa dalla stessa conversione di «Crea il tuo» (RMSoloProprio.capacitaDaRiga),
     con il tetto di danno del Lv 1 che qui RIFIUTA invece di tagliare in silenzio. */
  function ownCapacity(content, pg, kind, p) {
    const PR_ = global.RMSoloProprio;
    if (!PR_ || !PR_.capacitaDaRiga) throw new SoloError('interno', 'Creazione di capacità non disponibile');
    const nome = String((p || {}).nome || '').trim().slice(0, 40);
    const tetto = typeof capacitaTetto === 'function' ? capacitaTetto('danno', 1) : 10;
    if (!nome) throw new SoloError('azione_non_valida', 'Dai un nome alla capacità.');
    if (p.tipo === 'danno' && (Math.floor(Number(p.dannoBase)) || 0) > tetto) throw new SoloError('azione_non_valida', nome + ': il danno base non può superare ' + tetto + ' (tetto delle capacità di livello 1).');
    const voci = l => (Array.isArray(l) ? l : []).map(b => ({ stat: b.stat, valore: b.valore }));
    const riga = { id: nome, nome, tipo: p.tipo, dannoBase: p.dannoBase, dannoStat: p.stat, dannoTipo: p.dannoTipo, bonusItems: voci(p.bonus), malusItems: voci(p.malus), durata: p.durata };
    const r = PR_.capacitaDaRiga(content.catalogo, riga, kind);
    if (r.errore) throw new SoloError('azione_non_valida', r.errore.charAt(0).toUpperCase() + r.errore.slice(1) + '.');
    r.cap.fonteCanone = 'scritta dal giocatore al level up';
    return r.cap;
  }
  function assignSlot(state, content, cmd, applied, ev) {
    const pg = state.personaggio;
    if (!pg.levelUpInAttesa) throw new SoloError('azione_non_valida', 'Non c\'è nessuno slot da assegnare adesso.');
    const kind = cmd.kind === 'tecniche' || cmd.kind === 'abilita' ? cmd.kind : null;
    if (!kind) throw new SoloError('comando_non_valido', 'Indica se è uno slot di tecnica o di abilità.');
    if (!slotObbligatori(pg)[kind]) throw new SoloError('azione_non_valida', 'Nessuno slot di ' + NOME_KIND[kind] + ' da assegnare.');
    const usate = [].concat(pg.tecniche || [], pg.abilita || [], pg.capacitaSpeciali || []);
    let cap;
    if (cmd.esempio) {
      cap = slotOffers(state, content)[kind].find(x => x.id === cmd.esempio);
      if (!cap) throw new SoloError('azione_non_valida', 'Questa voce non è fra gli esempi offerti per il tuo gruppo e la tua classe.');
    } else if (cmd.propria) {
      cap = ownCapacity(content, pg, kind, cmd.propria);
      if (usate.some(x => x.id === cap.id || String(x.nome).toLowerCase() === String(cap.nome).toLowerCase())) throw new SoloError('azione_non_valida', 'Hai già una capacità con questo nome.');
    } else throw new SoloError('comando_non_valido', 'Scegli un esempio oppure scrivine una tua.');
    const nuova = Object.assign({ utilizzi: 0 }, clone(cap));
    pg[kind] = (pg[kind] || []).concat([nuova]);
    applied.push({ tipo: 'nuova_capacita', capacita: nuova.id, nome: nuova.nome, categoria: kind === 'tecniche' ? 'tecnica' : 'abilita', livello: pg.livello, scelta: cmd.esempio ? 'esempio' : 'propria' });
    ev.riserva = ev.testoFisso = 'Impari ' + nuova.nome + ' (' + NOME_KIND[kind] + ', livello 1).';
    autoFinishLevelUp(pg, applied);
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
    // PROPOSTA DA APPROVARE (Fase 1): la storia resta ferma finché il level
    // up non è completato; se non c'è nulla da spendere né slot da assegnare non blocca.
    // Gli slot nuovi di tecniche e abilità vanno assegnati dal giocatore (assegna_slot), mai riempiti da soli.
    if (improvementOptions(pg).spendibile || slotDaAssegnare(pg) > 0) pg.levelUpInAttesa = next;
    else pg.levelUpFatto = next;
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
    // percezione passiva (Fase 4.3): all'ingresso si confrontano in silenzio i tratti con i dettagli nascosti
    // della scena, senza dadi; il risultato si salva una volta sola in state.percezioni
    if (SCN()) SCN().percepisci(state, content, sceneId);
    // scontro finale: il villain si sceglie all'ingresso (il più ostile ancora vivo)
    const nemicoScena = sc.incontro ? (sc.incontro.villain && AV() ? AV().villainFinale(state, content, sc.incontro) : sc.incontro.nemico) : null;
    if (sc.incontro && nemicoScena) {
      const opts = { letale: !!sc.incontro.letale, fonte: 'scena', introduttivo: !!sc.incontro.introduttivo, finale: !!sc.incontro.finale, boss: !!sc.incontro.boss };
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

  /* Storia giocabile fino a un atto (`content.fino_atto`; DECISIONI §15 G.5): l'uscita verso una scena di un atto successivo chiude
     la partita con «Fine del <n> atto» (la chiusura d'autore della scena, `chiusura_atto`, testo fisso) e il salvataggio resta com'è.
     Quando la storia avrà gli atti successivi (`fino_atto` più alto o assente), la stessa partita riprende da quella scena
     (riprendiAtto, chiamata da migrate al caricamento). Nessun contratto del finale serve finché la storia si ferma prima (solo-campaign.js). */
  const ORDINALI_ATTO = ['', 'primo', 'secondo', 'terzo', 'quarto', 'quinto'];
  function attoDi(content, sceneId) { const a = (content.atti || []).find(x => (x.scene || []).indexOf(sceneId) !== -1); return a ? a.numero : null; }
  function oltreAtto(content, verso) { const max = Number(content.fino_atto), n = attoDi(content, verso); return max >= 1 && n != null && n > max; }
  function chiudiAtto(state, content, verso, applied) {
    const sc = currentScene(state, content), n = attoDi(content, sc.id) || Number(content.fino_atto);
    state.stato = 'atto_concluso';
    state.motivoFine = 'fine_atto';
    state.fineAtto = { atto: n, verso };
    applied.push({ tipo: 'fine_atto', atto: n });
    const testo = (sc.chiusura_atto ? sc.chiusura_atto + '\n\n' : '') + 'Fine del ' + (ORDINALI_ATTO[n] || n + '°') + ' atto.';
    if (curEvent) curEvent.riserva = curEvent.testoFisso = testo; // chiusura d'autore: il Narratore non la riscrive
  }
  function riprendiAtto(state, content) {
    if (!state || state.stato !== 'atto_concluso' || !state.fineAtto || !content) return false;
    const verso = state.fineAtto.verso;
    if (oltreAtto(content, verso) || !(content.scene || []).some(x => x.id === verso)) return false;
    state.stato = 'attivo';
    state.motivoFine = null;
    delete state.fineAtto;
    enterScene(state, content, verso, R().makeDice(), []);
    return true;
  }

  function checkTransitions(state, content, dice, applied, voluta) {
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
    // DECISIONI_AUTORE §12, condizione 2 (prova della Cavaliera, B11): in una scena con interazioni l'uscita non scatta da sola, nemmeno
    // sopra un invito in sospeso di un PNG; resta pronta (uscitaPronta, pulsante fra le azioni proposte) finché il giocatore non dice
    // di andarsene (comando «prosegui», dal pulsante o da una frase di movimento). Le scene senza interazioni restano automatiche.
    if (exit && itx && itx.scena === state.scena && !voluta) return;
    if (exit) {
      // gli effetti dell'uscita (es. lo snodo che chiude l'atto) valgono
      // prima del controllo del passaggio d'atto
      applyEffects(state, content, exit.effetti, 'uscita:' + sc.id + '>' + exit.verso, applied, dice);
      if (oltreAtto(content, exit.verso) && C().actComplete(state, content, state.atto)) { chiudiAtto(state, content, exit.verso, applied); return; }
      if (enterScene(state, content, exit.verso, dice, applied)) C().evaluateConsequences(state, content, applyEffects, applied, curEvent);
    }
  }

  /* Uscita della scena con le condizioni soddisfatte che aspetta l'intenzione del giocatore (B08, B11): le stesse verifiche di
     checkTransitions. null se non c'è (scena senza interazioni, campagna lunga, scontro, dialogo con una minaccia in sospeso). */
  function uscitaPronta(state, content) {
    const it = state.interazione;
    if (isOver(state) || state.incontro || strutturaMode(content) || !it || it.scena !== state.scena || !interactionGateOpen(state, content)) return null;
    // uno scontro annunciato da decidere viene prima (applyCommand non accetta altro)
    if ((it.modo === 'semi' && (it.incontroInAttesa || it.sceltaIncontro)) || (it.sceltaIncontro && it.incontroInAttesa)) return null;
    return (currentScene(state, content).uscite || []).find(u => conditionMet(state, u.quando)) || null;
  }
  // etichetta del pulsante: quella dell'uscita nei dati (uscite[].etichetta, PROPOSTA DA APPROVARE: campo nuovo, oggi assente in tutte le
  // storie), altrimenti una frase che non anticipa la scena di destinazione (titolo e luogo possono svelarla)
  const ETICHETTA_USCITA = 'Lasciare questo luogo e proseguire';
  function etichettaUscita(u) { return (u && typeof u.etichetta === 'string' && u.etichetta.trim()) || ETICHETTA_USCITA; }

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
    // fase_iniziale della scena (di norma «arrival»): una scena che comincia già con le persone presenti parte da «exploration»
    const def0 = content.interazioni && content.interazioni.scene && content.interazioni.scene[sceneId];
    const faseIniziale = def0 && FASI.indexOf(def0.fase_iniziale) !== -1 && def0.fase_iniziale !== 'resolution' ? def0.fase_iniziale : 'arrival';
    return { modo: semiMode(content) ? 'semi' : 'classico', scena: sceneId, fase: faseIniziale, conteggio: 0, beats: [], fatte: [], dialoghi: {}, dialogo: null, stasi: 0, svolte: 0, pressione: 0, mod: 0, effetti: [], libere: [], incontroInAttesa: null, sostituto: null, persi: [] };
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
  /* Legge 2 della regia, «nessun fatto prima del suo momento» (docs/single-player/LEGGI_DELLA_REGIA.md §1): una sola regola per ogni
     voce di scena (punti, argomenti, passi, voci di conoscenza, spinte, dettagli, iniziative, obiettivi, descrizione, motivazioni).
     «Da»: `fase` (fase minima della scena; nelle scene-seme non conta) e `richiede` (beat già fatti, solo se è un elenco).
     «Fino a»: `prima_di` (fatto uno di quei beat, la voce non è più disponibile). Senza questi campi la voce è sempre aperta.
     Ritorna 'presto', 'tardi' o 'aperta'. Un beat conta come fatto se è della scena corrente o di una scena già giocata. */
  function beatFatto(state, id) {
    const it = state.interazione;
    return !!(it && it.beats.indexOf(id) !== -1) || (state.beatsFatti || []).indexOf(id) !== -1 || (state.beatsSaltati || []).indexOf(id) !== -1;
  }
  /* Legge 3 della regia, «un passo libero anticipato conta come fatto» (LEGGI_DELLA_REGIA.md §1 punto 2): una voce della scena (punto,
     argomento, passo) la cui finestra si è chiusa con `prima_di` prima che il giocatore la facesse conta come fatta. Non si ripete
     (la finestra resta chiusa) e le righe dei PNG che la richiedono (`richiede`) valgono. Resta in `state.beatsSaltati`, non fra i beat
     della scena: non apre fasi né cancelli. */
  function segnaSaltati(state, content) {
    const def = sceneInteractions(content, state.scena), it = state.interazione;
    if (!def || !it) return;
    const voci = allPoints(def, it).concat(...(def.dialoghi || []).map(d => d.argomenti || []), def.passi || []);
    for (let nuovo = true; nuovo;) {
      nuovo = false;
      voci.forEach(v => {
        if (!v.id || beatFatto(state, v.id) || !v.prima_di || ![].concat(v.prima_di).some(b => beatFatto(state, b))) return;
        (state.beatsSaltati = state.beatsSaltati || []).push(v.id);
        nuovo = true;
      });
    }
  }
  function finestra(state, v) {
    if (!v || typeof v !== 'object') return 'aperta';
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    if (Array.isArray(v.richiede) && v.richiede.some(b => !beatFatto(state, b))) return 'presto';
    if (v.fase && it && it.modo !== 'semi' && faseIndex(it.fase) < faseIndex(v.fase)) return 'presto';
    if ([].concat(v.prima_di || []).some(b => beatFatto(state, b))) return 'tardi';
    return 'aperta';
  }
  const inFinestra = (state, v) => finestra(state, v) === 'aperta';
  // elenco di testi d'autore: le voci stringa valgono sempre, le voci { testo, …finestra } solo dentro la loro finestra
  const testiInFinestra = (state, lista) => (lista || []).filter(x => typeof x === 'string' || (x && x.testo && inFinestra(state, x))).map(x => typeof x === 'string' ? x : x.testo);
  // testi che il narratore riceve: la descrizione della scena (finestra in `finestra_descrizione`) e la motivazione di un PNG (`finestra_motivazione`)
  const descrizioneScena = (state, sc) => sc && inFinestra(state, sc.finestra_descrizione) ? sc.descrizione || '' : '';
  const motivazionePng = (state, d) => d && inFinestra(state, d.finestra_motivazione) ? d.motivazione || '' : '';
  function pointAvailable(state, p) {
    return state.interazione.fatte.indexOf(p.id) === -1 && inFinestra(state, p);
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
      } else if (eff.relazione || eff.voce || eff.scopri) {
        // un passo o un dialogo può scoprire un fatto della trama (come obiettivi, scelte e uscite)
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
    // memoria dei beat oltre la scena: serve alle finestre (prima_di, richiede) delle voci che valgono in più scene
    state.beatsFatti = state.beatsFatti || [];
    if (state.beatsFatti.indexOf(id) === -1) state.beatsFatti.push(id);
    applied.push({ tipo: 'beat', id });
    if (content) { discoverByEvidence(state, content, id, metodo || 'osservazione', applied); segnaSaltati(state, content); }
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
      // senza testi d'autore per lo stallo: un dettaglio del luogo o di un presente, dai dati della scena
      const testo = testi.length ? testi[(it.svolte - 1) % testi.length] : (dettaglioLuogo(state, content) || (currentScene(state, content).png_presenti || []).map(id => situazionePng(state, content, id)).find(Boolean) || generica(state, 'stallo', STALLO_SENZA_DATI, it.svolte));
      applied.push({ tipo: 'svolta', testo, indizio: pending ? pending.testo : null });
      // ciò che aspetta ancora non si dice nel racconto: va nel Diario (indizio dello stallo) e fra le azioni proposte
      ev.svoltaTesto = testo;
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
      const p = allPoints(def, it).find(x => x.id === id && pointAvailable(state, x));
      if (p) return { id, testo: p.testo };
      for (const d of def.dialoghi || []) {
        const a = (d.argomenti || []).find(x => x.id === id);
        if (a && dialogsAvailable(it) && inFinestra(state, a)) return { id, testo: 'Parlare con ' + pngName(content, d.png) + ': ' + a.testo.charAt(0).toLowerCase() + a.testo.slice(1) };
      }
    }
    return null;
  }

  // parole significative in comune fra l'azione scritta e un punto (radici
  // di 5 lettere, parole di almeno 5)
  const roots = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 5));
  /* Ci\u00f2 che il giocatore rifiuta non \u00e8 ci\u00f2 che fa: \u00abesamino il fiore senza toccarlo n\u00e9 raccoglierlo\u00bb \u2192 \u00abesamino il fiore\u00bb,
     \u00abattendo senza lasciarmi andare alla premonizione\u00bb \u2192 \u00abattendo\u00bb. Si toglie la parte negata fino al confine della frase o a \u00abma/per\u00f2/poi/invece\u00bb;
     le battute fra virgolette restano (sono parole dette, non azioni). Usata per riconoscere passi, punti, movimenti e atti (5/11/2026, registro della prova). */
  // «senza» nega un'azione solo davanti a un infinito («senza toccarlo», «senza lasciarmi andare»); davanti a un nome o a un articolo dice
  // come si fa («senza fretta», «senza il mantello»): è una modalità e la frase resta intera. «non», «né»… negano sempre.
  // shortcut: l'infinito si riconosce dalla desinenza (-are/-ere/-ire/-rre, o tronco + pronome); un nome in -ere («senza piacere») passa per infinito.
  const NEGATO = /(^|[^a-z\u00e0-\u00fa'])(senza(?=\s+[a-z\u00e0-\u00fa]*(?:are|ere|ire|rre|(?:ar|er|ir|r)(?:mi|ti|si|ci|vi|lo|la|li|le|gli|ne|melo|mela|telo|tela|glielo|gliela))(?![a-z\u00e0-\u00fa]))|non|n\u00e9|ne'|nemmeno|neanche|neppure|evitando di)(?![a-z\u00e0-\u00fa])[^.,;:!?\u00ab\u00bb"]*?(?=\s+(?:ma|per\u00f2|pero|bens\u00ec|poi|e poi|invece)(?![a-z\u00e0-\u00fa])|[.,;:!?\u00ab\u00bb"]|$)/gi;
  const senzaNegati = t => String(t || '').split(/(«[^»]*»|“[^”]*”|"[^"]*")/).map((p, i) => i % 2 ? p : p.replace(NEGATO, '$1 ')).join('');
  /* Quanto una frase parla di un passo (stesso criterio di matchPoint): parole in comune, esclusi i nomi dei PNG, che dicono a chi ci si
     rivolge e non che cosa si fa. 0 se non basta (una sola parola in comune su pi\u00f9). */
  /* Radici dei nomi dei PNG nominati nella frase, che dicono a chi ci si rivolge e non che cosa si fa. Un nome proprio (parola con
     l'iniziale maiuscola, tolto l'articolo o il possessivo iniziale) vale da solo; un nome descrittivo («La donna fiore», «Tuo padre»)
     vale solo se nella frase ci sono tutte le sue parole: «raccolgo il fiore» parla del fiore, non della donna fiore (registro del 5/11/2026,
     turno 7); «Padre, posso partire?» si rivolge a tuo padre. */
  const ARTICOLO_DI_NOME = /^(il|lo|la|l'|i|gli|le|un|una|uno|tuo|tua|tuoi|tue|mio|mia|suo|sua)$/i;
  function radiciNomi(content, testo) {
    const nella = roots(testo);
    const out = [];
    Object.keys(content.png || {}).forEach(id => {
      const parole = String(pngName(content, id)).replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean);
      const proprie = roots(parole.filter((w, i) => /^[A-ZÀ-Ú]/.test(w) && !(i === 0 && ARTICOLO_DI_NOME.test(w.replace(/['’].*$/, "'")))).join(' '));
      const tutte = roots(parole.join(' '));
      out.push(...proprie);
      if (tutte.length && tutte.every(r => nella.indexOf(r) !== -1)) out.push(...tutte);
    });
    return out;
  }
  function parlaDi(content, testo, passo) {
    const nomi = radiciNomi(content, testo);
    const want = roots(senzaNegati(testo)).filter(w => nomi.indexOf(w) === -1);
    const have = roots(passo);
    const n = want.filter(w => have.indexOf(w) !== -1).length;
    return n >= 2 || (want.length === 1 && n === 1) ? n : 0;
  }
  // il punto da esplorare di cui parla la frase, nella scena corrente (per l'instradamento: un'azione che è un punto si esplora, senza tiro)
  function puntoDiTesto(state, content, testo) {
    const def = sceneInteractions(content, state.scena), it = state.interazione;
    return def && it && it.scena === state.scena && !state.incontro ? matchPoint(state, def, it, testo) : null;
  }
  function matchPoint(state, def, it, text) {
    const want = roots(senzaNegati(text));
    if (!want.length) return null;
    let best = null, score = 0;
    allPoints(def, it).filter(p => pointAvailable(state, p)).forEach(p => {
      const have = roots(p.testo);
      const n = want.filter(w => have.indexOf(w) !== -1).length;
      if (n > score) { score = n; best = p; }
    });
    // una sola parola in comune (di solito il verbo) non basta: non si racconta come fatta un'azione che il giocatore non ha dichiarato
    return score >= 2 || want.length === 1 ? best : null;
  }

  // legge 3: una risposta da una voce di conoscenza segna il beat da cui la voce nasce (campo `beat`: id di un argomento o di un passo)
  function beatDaConoscenza(state, content, d, m, cn, applied) {
    if (!cn || !cn.beat || !(cn.livello > 0) || cn.gia) return false;
    if (d && (d.argomenti || []).some(a => a.id === cn.beat) && m.argomenti.indexOf(cn.beat) === -1) m.argomenti.push(cn.beat);
    return markBeat(state, cn.beat, applied, 'dialogo', content);
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

  // risposta a una battuta libera senza modello: tiene conto di che cosa
  // dice il giocatore. Una battuta che tocca un argomento ancora aperto vale
  // come quell'argomento; una domanda su una persona riceve una risposta
  // coerente con il rapporto (sceltaDialogo) e può indicare un altro PNG
  // presente; il resto riceve risposte per tono che non si ripetono.
  const FRASI_VUOTE = ['chied', 'parla', 'offri', 'propr', 'quest', 'quell', 'sapere', 'dimmi', 'vorre', 'sono', 'della', 'delle', 'degli', 'dello', 'nella', 'sulla', 'cosa', 'come'];
  function radici(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/)
      .filter(w => w.length >= 4).map(w => w.slice(0, 5)).filter(w => FRASI_VUOTE.indexOf(w) === -1);
  }
  const INTENTO_PERSONA = /\b(cerc\w*|hai vist\w*|avete vist\w*|conosc\w*|incrociat\w*|matricol\w*|compagn\w*|ragazz\w*|uomo|donna|chi [eè]|sai dove (sia|si trova|è finit\w*))\b/;
  // il primo nome senza restare col solo articolo («Il burattinaio» → «Il burattinaio», non «Il»: prova della Cavaliera)
  function primoNome(content, id) { const p = pngName(content, id).split(' '); return /^(il|lo|la|l'|i|gli|le|un|uno|una|tuo|tua)$/i.test(p[0]) && p[1] ? p[0] + ' ' + p[1] : p[0]; }
  function rispostaLibera(state, content, def, d, png, m, testo, tono) {
    const t = String(testo || '').toLowerCase();
    const persona = INTENTO_PERSONA.test(t);
    // il nome del PNG a cui ci si rivolge («Fobos, perché sei qui?») non è l'argomento della domanda
    const proprio = radici(pngName(content, png));
    const want = radici(testo).filter(w => proprio.indexOf(w) === -1);
    let arg = null, score = 0;
    (d.argomenti || []).filter(a => m.argomenti.indexOf(a.id) === -1 && inFinestra(state, a)).forEach(a => {
      const have = radici(a.testo);
      const n = want.filter(w => have.indexOf(w) !== -1).length;
      if (n > score) { score = n; arg = a; }
    });
    if (arg && !tono && (score >= 2 || (score >= 1 && !persona))) return { argomento: arg };
    const nome = primoNome(content, png);
    const giro = m.libere; // la battuta corrente viene contata dopo aver scelto la risposta
    const pick = list => list[giro % list.length];
    const scelta = PN() && PN().sceltaDialogo ? PN().sceltaDialogo(state, content, png, { metodo: tono || '', testo, pericolo: !!(def && def.pressione && state.interazione && state.interazione.pressione >= def.pressione.max / 2) }) : { comportamento: 'chiede_in_cambio' };
    const c = scelta.comportamento || 'tace';
    const out = r => Object.assign(r, { comportamento: c, motivo: scelta.motivo || null });
    // frase comune del motore (non scritta dall'autore per questo PNG): la riserva senza modello; al Narratore arriva come dato
    const comune = r => Object.assign(out(r), { comune: true });
    // voce d'autore del PNG (contenuto: png.<id>.risposte.<comportamento>), al posto delle frasi comuni
    // legge 3: la riga si sceglie in base ai fatti (voci { testo, richiede, prima_di } dentro la loro finestra; le stringhe valgono sempre)
    // «esita», «valuta», «interessato» sono nuovi (4/11/2026): se l'autore non li ha scritti vale la sua riga più vicina
    const risposteAutore = ((content.png || {})[png] || {}).risposte || {};
    const vicina = { esita: ['devia', 'tace'], valuta: ['chiede_in_cambio', 'devia'], interessato: ['coopera', 'devia'] }[c] || [];
    const altriNomi = Object.keys(content.png || {}).filter(id => id !== png).map(id => primoNome(content, id));
    const propria = (testiInFinestra(state, risposteAutore[c] || vicina.map(k => risposteAutore[k]).find(Boolean)) || []).filter(x => !altriNomi.some(n => n.length >= 3 && String(x.testo || x).indexOf(n) !== -1));
    const sua = propria.length ? out({ testo: pick(propria), voceAutore: true }) : null;
    if (persona) {
      const altri = (def.dialoghi || []).map(x => x.png).filter(x => x !== png && (!PN() || !PN().sceltaDialogo || PN().sceltaDialogo(state, content, x, {}).comportamento));
      const ruoli = /magazzin|registr|conti|archiv|guida|sentier|tecnic|clinic|esplora|intermedi/i;
      const altro = altri.find(x => ruoli.test(((content.png || {})[x] || {}).ruolo || '')) || altri[0];
      const rinvio = altro ? 'prova a chiedere a ' + primoNome(content, altro) + ', che vede passare più gente di me' : '';
      if (c === 'coopera' || c === 'rivela' || c === 'conferma') return comune({ testo: nome + ' ci pensa davvero, poi scuote la testa. «Qualcuno così me lo ricorderei, e non è passato da me. Ma non arrenderti' + (rinvio ? ': ' + rinvio : '') + '.»' });
      if (c === 'chiede_in_cambio') return comune({ testo: nome + ' ti studia prima di rispondere. «Non l\'ho visto. E se anche fosse, perché dovrei parlarne con chi è appena arrivato? Dimostrami che posso fidarmi.»' + (rinvio ? ' Poi, a voce più bassa: «Se proprio vuoi, ' + rinvio + '.»' : '') });
      // PROPOSTA DA APPROVARE (5/11/2026): esita, valuta e interessato non attribuiscono al PNG ciò che sa o non sa di quella persona
      if (c === 'esita' || c === 'valuta' || c === 'interessato') return comune({ testo: nome + ' ci pensa un momento, ma non dice niente di preciso su quella persona.' });
      if (c === 'devia') return comune({ testo: nome + ' sposta lo sguardo. «Qui la gente va e viene. Non tengo il conto dei volti.»' });
      if (c === 'minaccia' || c === 'sfida') return comune({ testo: nome + ' si irrigidisce. «Chi cerchi sono affari tuoi. Non farli diventare miei.»' });
      return comune({ testo: nome + ' non risponde. Il silenzio dice che di quella persona, con te, non vuole parlare.' });
    }
    if (/\?\s*$/.test(t) || /^(perch[eé]|come|dove|quando|quanto|quale|che cosa|cosa|chi)\b/.test(t)) {
      if (sua) return sua;
      const aperto = (d.argomenti || []).find(a => m.argomenti.indexOf(a.id) === -1 && inFinestra(state, a) && /^chiedere\s/i.test(a.testo));
      const spunto = aperto ? ' Forse conviene domandare ' + aperto.testo.replace(/^chiedere\s+/i, '') + '.' : '';
      if (c === 'coopera' || c === 'rivela' || c === 'conferma') return comune({ testo: pick([nome + ' ci pensa un momento. «Dimmi meglio che cosa vuoi sapere, e ti dirò quello che so.»' + spunto, nome + ' allarga le mani. «Su questo non so più di te.»' + spunto]) });
      if (c === 'chiede_in_cambio') return comune({ testo: pick([nome + ' inclina la testa. «Domande, domande. E tu che cosa offri in cambio?»', nome + ' sorride appena. «Le risposte qui si guadagnano.»']) });
      if (c === 'devia') return comune({ testo: nome + ' cambia discorso con mestiere, come se la domanda non fosse mai stata fatta.' });
      // PROPOSTA DA APPROVARE (5/11/2026, riscritte): riserve di «esita», «valuta» e «interessato» (rapporto neutro). Descrivono solo il
      // gesto: niente segreti, intenzioni, atteggiamenti commerciali, rifiuti o conoscenze attribuiti al PNG.
      if (c === 'valuta') return comune({ testo: pick([nome + ' considera ciò che offri.', nome + ' ascolta l\'offerta e ci pensa su.']) });
      if (c === 'interessato') return comune({ testo: pick([nome + ' si fa più attento.', nome + ' ascolta con interesse.']) });
      if (c === 'esita') return comune({ testo: pick([nome + ' esita prima di rispondere.', nome + ' ci pensa un momento, cauto.', nome + ' risponde a mezza voce, senza sbilanciarsi.']) });
      return comune({ testo: pick([nome + ' ti guarda e tace.', nome + ' scrolla le spalle: per te non ha risposte.']) });
    }
    if (d.riserva_libera && m.libere === 1) return out({ testo: d.riserva_libera });
    if (sua && !tono) return sua;
    if (tono === 'promessa') return comune({ testo: pick([nome + ' ti guarda a lungo. «Una promessa qui pesa. Me la ricorderò.»', nome + ' annuisce piano. «Vedremo se la mantieni.»']) });
    if (tono === 'minaccia') return comune({ testo: pick([nome + ' non arretra. «Le minacce non ti apriranno nessuna porta.»', nome + ' stringe le labbra. Qualcosa, fra voi, si è incrinato.']) });
    if (tono === 'menzogna') return comune({ testo: nome + ' ti ascolta, e per un attimo sembra crederci.' });
    return comune({ testo: pick([nome + ' ascolta e annuisce. «Capisco.»', nome + ' prende atto di ciò che dici, senza aggiungere altro.', nome + ' ti lascia finire, poi inarca un sopracciglio. «E quindi?»']) });
  }

  /* Il PNG a cui si riferisce un obiettivo della scena: `obiettivi[].png` se i dati lo dicono, altrimenti il presente nominato nel testo
     dell'obiettivo o dei suoi suggerimenti («Rispondere al burattinaio» → il burattinaio). Nome proprio: basta il primo nome; nome
     descrittivo («Il ragazzo di Umea»): servono tutte le sue parole. */
  const paroleDi = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/).filter(Boolean);
  function nominato(content, id, testo) {
    const nome = String(pngName(content, id)).replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean)
      .map((w, i) => i === 0 ? w.replace(/^[lL]['’]/, '') : w).filter((w, i) => w && !(i === 0 && ARTICOLO_DI_NOME.test(w)));
    if (!nome.length) return false;
    const t = paroleDi(testo);
    // parole di almeno 5 lettere per radice (burattinaio / burattinai), le più corte intere
    const c = w => { const p = paroleDi(w)[0]; return !p || t.some(y => p.length >= 5 ? y.slice(0, 5) === p.slice(0, 5) && y.length >= 5 : y === p); };
    return /^[A-ZÀ-Ú]/.test(nome[0]) ? c(nome[0]) : nome.filter(w => paroleDi(w)[0] && paroleDi(w)[0].length >= 4).every(c);
  }
  function pngDiObiettivo(content, sc, ob) {
    if (!sc || !ob) return null;
    if (ob.png) return ob.png;
    const testi = [ob.testo].concat((sc.suggerimenti || []).filter(s => s.obiettivo === ob.id).map(s => s.testo));
    return (sc.png_presenti || []).find(id => content.png[id] && testi.some(t => nominato(content, id, t))) || null;
  }
  /* B09 (prova della Cavaliera, 6/11/2026): parlare con il PNG a cui si riferisce un obiettivo aperto della scena vale come tentativo
     dell'obiettivo (state.obiettivi[id].tentativi, la condizione `obiettivo_tentato` delle uscite), senza tiro e senza esito: nessun
     effetto dell'obiettivo, che resta tentabile con la sua prova. Solo a scena pronta per decidere e dentro la finestra dell'obiettivo
     (come il tentativo con la prova). */
  function dialogoTentaObiettivo(state, content, png, applied) {
    if (!png || !interactionGateOpen(state, content)) return;
    const sc = currentScene(state, content);
    (sc.obiettivi || []).forEach(ob => {
      const st = state.obiettivi[ob.id];
      if ((st && st.tentativi > 0) || !inFinestra(state, ob) || pngDiObiettivo(content, sc, ob) !== png) return;
      // gli stessi requisiti del tentativo con la prova (validateProposal)
      const r = ob.richiede && !Array.isArray(ob.richiede) ? ob.richiede : null;
      if (r && ((r.fatto && state.fattiScoperti.indexOf(r.fatto) === -1) || (r.condizione && !conditionMet(state, r.condizione)))) return;
      if (IM()) { const pos = IM().possibilita(state, content).obiettivi[ob.id]; if (pos && !pos.ok) return; }
      state.obiettivi[ob.id] = Object.assign(st || { esito: null, completato: false }, { tentativi: 1, via: 'dialogo' });
      applied.push({ tipo: 'obiettivo_tentato', obiettivo: ob.id, via: 'dialogo', png });
    });
  }

  function interact(state, content, cmd, dice, applied, ev) {
    const def = sceneInteractions(content, state.scena);
    const it = state.interazione;
    if (!def || !it || it.scena !== state.scena) throw new SoloError('azione_non_valida', 'Qui non c\'è altro da esplorare.');
    if (cmd.tipo === 'esplora') {
      ev.tipo = 'esplorazione';
      ev.fase = it.fase;
      let punto = cmd.punto;
      if (cmd.libera && cmd.descrittiva) {
        // domanda su ciò che si vede («che aspetto ha?»): descrizione di ciò che è visibile dai testi della scena che parlano di quel
        // PNG, senza tiro e senza toccare l'obiettivo della scena; ciò che i dati non dicono non si inventa (prova della Cavaliera, B07/A17)
        ev.libera = true; ev.descrittiva = true;
        const frasi = frasiSuPng(state, content, def, cmd.png);
        const sit = cmd.png ? situazionePng(state, content, cmd.png) : null;
        ev.riserva = [frasi[frasi.length - 1] || sit || dettaglioLuogo(state, content, { tutti: true }), 'Più di così non riesci a distinguere.'].filter(Boolean).join(' ');
        afterInteraction(state, content, applied, ev, false, false);
        return;
      }
      if (cmd.libera) {
        ev.libera = true;
        // un'azione scritta che corrisponde a un punto percepibile della
        // scena lo esegue (anche se richiesto); altrimenti testi liberi a
        // rotazione, poi un punto secondario non ancora visto: mai lo
        // stesso testo due volte
        const match = matchPoint(state, def, it, cmd.testo);
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
          const extra = !fresh && allPoints(def, it).find(x => pointAvailable(state, x) && req.indexOf(x.id) === -1);
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
      if (!pointAvailable(state, p)) throw new SoloError('azione_non_valida', 'Non ancora.');
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
      const d = dialogoQui(state, content, (def.dialoghi || []).find(x => x.png === cmd.png));
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
    const d = dialogoQui(state, content, (def.dialoghi || []).find(x => x.png === png));
    const m = dialogMemory(it, png);
    ev.png = png; ev.pngNome = pngName(content, png);
    if (cmd.tipo === 'battuta') {
      ev.tipo = 'battuta';
      dialogoTentaObiettivo(state, content, png, applied);
      if (cmd.argomento) {
        const a = (d.argomenti || []).find(x => x.id === cmd.argomento);
        if (!a || m.argomenti.indexOf(a.id) !== -1 || finestra(state, a) === 'tardi') throw new SoloError('azione_non_valida', 'Ne avete già parlato.');
        if (finestra(state, a) === 'presto') throw new SoloError('azione_non_valida', 'Non ancora.');
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
      const tonoLibero = cmd.tono || lineTone(cmd.testo);
      const risposta = rispostaLibera(state, content, def, d, png, m, cmd.testo, tonoLibero);
      if (risposta.argomento) {
        // la battuta tocca un argomento che il PNG conosce: vale come quello
        ev.libera = true;
        return interact(state, content, { tipo: 'battuta', argomento: risposta.argomento.id }, dice, applied, Object.assign(ev, { testo: ev.testo || String(cmd.testo).slice(0, 200) }));
      }
      const primaAtt = m.atteggiamento;
      m.libere += 1;
      const tono = tonoLibero;
      ev.tono = tono;
      if (tono === 'promessa') { m.promesse.push({ testo: String(cmd.testo).slice(0, 200), evento: ev.n }); m.atteggiamento += 1; applied.push({ tipo: 'promessa_dialogo', png }); }
      if (tono === 'minaccia') { m.minacce += 1; m.atteggiamento -= 1; applied.push({ tipo: 'atteggiamento', png, delta: -1, valore: m.atteggiamento }); }
      if (tono === 'menzogna') m.menzogne += 1;
      ev.riserva = risposta.testo;
      // scheda di conoscenze del PNG (RMSoloConoscenze): se una voce è pertinente risponde lei, con il livello deciso dal tiro
      const cn = CN() && !risposta.argomento ? CN().rispondi({ state, content, png, m, testo: cmd.testo, dice, scena: state.scena, proposta: cmd.voce, tratto: cmd.tratto, tono }) : null;
      if (cn) {
        ev.riserva = cn.testo; ev.riservaMotore = true;
        ev.conoscenza = { voce: cn.voce, livello: cn.livello, gia: !!cn.gia, check: cn.check };
        if (cn.esito) ev.esito = cn.esito;
        applyInteractionEffects(state, content, cn.effetti, 'conoscenza:' + cn.voce + ':' + ev.n, applied);
        risposta.comportamento = cn.comportamento;
      }
      const daVoce = beatDaConoscenza(state, content, d, m, cn, applied);
      // risposta generata dal motore, non scritta dall'autore: è solo la
      // rete d'emergenza e non vincola il Narratore IA
      if (risposta.testo !== d.riserva_libera) ev.riservaMotore = true;
      // comportamento deciso dal motore: il Narratore IA lo recita, non lo sceglie
      ev.comportamentoPng = risposta.comportamento || null;
      // nessun testo d'autore per questa battuta (né argomento, né voce del PNG, né scheda di conoscenza): il piano passa il dato
      if ((risposta.comune || risposta.voceAutore) && !cn) ev.rispostaComune = { comportamento: risposta.comportamento || null, tono: tono || null, motivo: risposta.motivo || null, voce: risposta.voceAutore ? risposta.testo : null };
      afterInteraction(state, content, applied, ev, !!tono || daVoce, true);
      const svolta = dialogueTurn(state, content, d, png, m, primaAtt, applied, daVoce);
      if (svolta) turnDialogue(state, content, d, png, applied, ev, svolta);
      return;
    }
    // congedo del giocatore
    ev.tipo = 'dialogo_fine';
    ev.testo = ev.testo || 'Concludi il dialogo con ' + ev.pngNome;
    closeDialogue(state, content, d, png, applied, ev, 'congedo');
    // chiuso perché il giocatore ha fatto altro: niente turno in più e nessuna chiamata al modello
    if (cmd.implicita) { state.interazione.conteggio -= 1; ev.dialogoImplicito = true; ev.testoFisso = ' '; }
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

  /* B06/A14 (prova della Cavaliera, 6/11/2026): un luogo di scena scritto in più parti («Umea: la tua casa, poi la piazza del mercato»)
     dice dove si comincia e dove si arriva, ma il motore non ha un luogo interno. Il minimo che si ricava dai dati, senza inventare: la
     parte in cui si è dopo l'ultimo passo di movimento fatto (un punto della scena che comincia con un verbo di movimento e nomina una
     parte: «Andare allo spettacolo di marionette in piazza» → «la piazza del mercato»); senza un passo così, la prima parte. Solo
     lettura: interactionOptions.luogo. Quale parte appartengano scelte e PNG non è nei dati (resta all'autore). */
  const VERBI_MOVIMENTO = /^(andare|avvicinar[st]i|entrare|uscire|tornare|raggiungere|salire|scendere|dirigersi|recarsi|seguire|attraversare|arrivare)\b/i;
  // parte del luogo a cui appartiene un elemento della scena (campo facoltativo `parte` dei dati: il nome di una delle parti), -1 se non è detta
  function indiceParte(parti, x) {
    const q = x && x.parte ? String(x.parte).trim().toLowerCase() : '';
    if (!q || !parti) return -1;
    const k = parti.findIndex(t => t.toLowerCase() === q);
    if (k !== -1) return k;
    const r = roots(q);
    return parti.findIndex(t => roots(t).some(w => r.indexOf(w) !== -1));
  }
  // testi di un dialogo nella parte del luogo in cui si è (`parti` dei dati: apertura, chiusura, riserva_libera): l'ombra «alla finestra» non è in piazza (B06)
  function dialogoQui(state, content, d) {
    const l = d && d.parti ? luogoCorrente(state, content) : null;
    return l && d.parti[l.qui] ? Object.assign({}, d, d.parti[l.qui]) : d;
  }
  function luogoCorrente(state, content) {
    const sc = currentScene(state, content), it = state.interazione, def = sceneInteractions(content, state.scena);
    const parti = String((sc && sc.luogo) || '').replace(/^[^:]*:\s*/, '').split(/,?\s+poi\s+/i).map(s => s.trim()).filter(Boolean);
    if (!parti.length) return null;
    let indice = 0;
    if (def && it && it.scena === state.scena) {
      // in ordine di gioco: i passi fatti e la scelta della scena. Con `parte` nei dati vale quella; senza, un passo di movimento che nomina una parte.
      // I dialoghi no: parlare con chi ti segue (lo spettro) non ti riporta a casa.
      const punti = allPoints(def, it);
      (state.eventi || []).filter(e => e.scena === state.scena).forEach(e => {
        const el = (e.effetti || []).filter(a => a.tipo === 'beat').map(a => punti.find(x => x.id === a.id))
          .concat(e.sceltaId ? [((sc && sc.scelte) || []).find(c => c.id === e.sceltaId)] : []);
        el.filter(Boolean).forEach(x => {
          const k = indiceParte(parti, x);
          if (k !== -1) { indice = k; return; }
          if (!VERBI_MOVIMENTO.test(String(x.testo || '').trim())) return;
          const r = roots(x.testo), m = parti.findIndex(t => roots(t).some(w => r.indexOf(w) !== -1));
          if (m !== -1) indice = m;
        });
      });
    }
    // dati: la scena dice a quale parte appartengono i suoi elementi (senza, la parte è solo una stima dai passi di movimento)
    const dati = !!def && allPoints(def, it || { beats: [], fatte: [] }).concat(def.dialoghi || [], (sc && sc.scelte) || []).some(x => x && x.parte);
    return { parti, indice, qui: parti[indice], dati };
  }
  // un elemento di una parte già lasciata (la finestra di casa quando si è in piazza) non si propone più; uno di un'altra parte non è un dono
  function fuoriParte(state, content, x) {
    const l = luogoCorrente(state, content), k = l ? indiceParte(l.parti, x) : -1;
    return k !== -1 && k < l.indice;
  }
  function altraParte(state, content, x) {
    const l = luogoCorrente(state, content), k = l ? indiceParte(l.parti, x) : -1;
    return k !== -1 && k !== l.indice;
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
      fase: it.fase, conteggio: it.conteggio, aperta: interactionGateOpen(state, content), modo: it.modo || 'classico', luogo: luogoCorrente(state, content),
      uscita: (u => u ? { verso: u.verso, etichetta: etichettaUscita(u) } : null)(uscitaPronta(state, content)),
      possibili: IM() ? (() => { const ps = IM().possibilita(state, content); return { obiettivi: Object.keys(ps.obiettivi).filter(k => ps.obiettivi[k].ok), scelte: Object.keys(ps.scelte).filter(k => ps.scelte[k].ok) }; })() : null,
      intenzione: IM() && IM().intenzioneAperta(state) ? IM().intenzioneAperta(state).testo : null, banda: def.pacing_band || 'standard',
      pressione: def.pressione ? { nome: def.pressione.nome, valore: it.pressione, max: def.pressione.max } : null,
      vantaggio: it.mod,
      esplora: allPoints(def, it).filter(p => pointAvailable(state, p) && (req.indexOf(p.id) !== -1 || !fuoriParte(state, content, p))).map(p => Object.assign({ id: p.id, testo: p.testo, effetti: p.effetti || [] }, tag(p.id))),
      dialoghi: dialogsAvailable(it) ? (def.dialoghi || []).filter(x => x.png === png || !fuoriParte(state, content, x)).map(x => {
        const restanti = (x.argomenti || []).filter(a => !(it.dialoghi[x.png] && it.dialoghi[x.png].argomenti.indexOf(a.id) !== -1) && inFinestra(state, a));
        return { png: x.png, nome: pngName(content, x.png), argomentiRestanti: restanti.length, richiesti: restanti.filter(a => req.indexOf(a.id) !== -1).length };
      }) : [],
      dialogo: png ? { png, nome: pngName(content, png), atteggiamento: m.atteggiamento, battute: m.argomenti.length + m.libere,
        argomenti: (d.argomenti || []).filter(a => m.argomenti.indexOf(a.id) === -1 && inFinestra(state, a)).map(a => Object.assign({ id: a.id, testo: a.testo, effetti: a.effetti || [], atteggiamento: a.atteggiamento || 0 }, tag(a.id))) } : null,
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
      const check = provaVolontaria({ dice, sheet: schedaConBonus(state), trait: alt.tratto, nc: alt.nc, difficolta: state.difficolta, mod: it.mod || 0 }, 'scelta', [{ nome: 'vantaggio di scena', valore: it.mod || 0 }]);
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
    // il primo scontro introduttivo resta al livello del protagonista in ogni difficoltà; gli incontri
    // ordinari stanno sopra (livelloNemici), boss e sfide principali (finale o «boss») ancora di più (livelloBoss)
    // «boss» della scena: lo scontro finale di una storia è una sfida principale anche se il nemico altrove è ordinario (DECISIONI §2)
    const boss = !!(opts.finale || opts.boss || (tpl && tpl.boss));
    const salto = opts.introduttivo ? 0 : ((boss ? R_.SOLO_TUNING.livelloBoss : R_.SOLO_TUNING.livelloNemici)[state.difficolta] || 0);
    const lvG = Math.max(1, state.personaggio.livello + salto);
    if (enemyId !== 'raven' && AV() && AV().attivo(state, content, enemyId)) {
      state.incontro = AV().creaIncontro(state, content, enemyId, opts, lvG);
      riprendiIncontro(state, content, chiaveIncontro(state, content, enemyId));
      riprendiStati(state);
      nuovaGriglia(state);
      return;
    }
    if (enemyId === 'raven') nemico = R_.ravenConfig(state.personaggio.livello, tpl);
    else {
      // primo scontro introduttivo (dati della scena): nemico al livello del
      // protagonista in ogni difficoltà; la difficoltà pesa solo sugli HP
      const lv = lvG;
      // scontro finale senza struttura: stesso specchio del protagonista
      // (il villain di uno scontro «boss» si rispecchia con la scala scritta nella scena: «sfida paragonabile», DECISIONI §2)
      const incScena = currentScene(state, content).incontro || {};
      const scala = opts.finale ? (incScena.villain || {}).scala : (opts.boss && tpl.villain && incScena.scala) || null;
      nemico = R_.scaledCombatant(tpl, scala ? 1 : lv);
      // armi, armatura e scudo del modello (DECISIONI §15 E.2): scaledCombatant (sigillato) non li copia
      if (Array.isArray(tpl.equip) && tpl.equip.length) nemico.equip = clone(tpl.equip);
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
    if (enemyId !== 'raven') riprendiIncontro(state, content, chiaveIncontro(state, content, enemyId));
    riprendiStati(state);
    nuovaGriglia(state);
  }

  /* Griglia dello scontro (js/solo/solo-griglia.js, pezzi 2.6-2.8, DECISIONI §13). Senza il modulo o senza `incontro.griglia`
     (scontri iniziati prima della griglia) lo scontro resta quello di prima: nessuna posizione e il −2 in mischia contro chi sta
     a distanza. Nessun tiro e nessun danno cambiano: la griglia decide solo chi può colpire chi e dove si sta. */
  function grigliaDi(state) { return state.incontro && state.incontro.griglia && GR() ? state.incontro.griglia : null; }
  function uidAttivi(inc) { return inc.gruppo ? inc.nemici.filter(n => n.attivo).map(n => n.uid) : ['nemico']; }
  function nuovaGriglia(state) {
    const inc = state.incontro;
    if (!GR() || !inc) return;
    const unita = inc.gruppo ? inc.nemici.map(n => ({ uid: n.uid, posizione: n.posizione })) : [{ uid: 'nemico', posizione: GR().aDistanza(inc.nemico.attacco) ? 'distanza' : 'mischia' }];
    inc.griglia = GR().iniziale(unita);
    allineaPosizioni(inc);
  }
  // «in mischia / a distanza» delle unità (tattiche, ripari, pannello) segue la griglia: in mischia chi è a una casella
  function allineaPosizioni(inc) {
    if (!inc.griglia || !GR() || !inc.gruppo) return;
    inc.nemici.forEach(n => { const d = GR().distanza(inc.griglia, 'pg', n.uid); if (d != null) n.posizione = d <= 1 ? 'mischia' : 'distanza'; });
  }
  // statistica dell'attacco del protagonista, o null se l'azione non è un attacco (l'arma da tiro colpisce con la Mira)
  function attaccoPg(state, cmd) {
    const pg = state.personaggio;
    if (cmd.azione === 'arma') { const w = armaPartita(pg); return w ? { stat: w.classe === 'tiro' ? 'mira' : 'for' } : null; }
    if (cmd.azione === 'abilita' || cmd.azione === 'tecnica' || cmd.azione === 'gemma') { const ab = capacityList(pg, cmd.azione).find(a => a.id === cmd.abilitaId); return ab && ab.tipo === 'danno' ? { stat: ab.stat } : null; }
    if (cmd.azione === 'manovra') return cmd.manovra && cmd.manovra !== 'libera' ? { stat: 'for' } : null; // sgambetto, spinta, presa, disarmo: corpo a corpo; un'azione libera non ha portata
    return null;
  }
  /* Manovre e azioni libere in combattimento (decisioni dell'autore del 6/11 e del 7/11, DECISIONI §13-§15): l'azione si valuta nel suo
     contesto, in tre tempi. Tentativo: ciò che il giocatore ha scritto (lo sgambetto mira a far perdere l'equilibrio, la spinta a
     spostare, la presa a trattenere, il disarmo a togliere l'arma; qualunque altra azione libera resta quella scritta). Verifica: d20 +
     Arte Combattiva; con la sola arma un tiro percentuale; se fallisce l'azione non avviene. PROPOSTA DA APPROVARE (cercato in
     js/rules.js, js/data.js, js/app.js, js/cloud-combat.js: le manovre non ci sono): il tiro opposto (d20 + Elusione del bersaglio;
     d100 contro d100, come l'applicazione di uno stato). Conseguenza: solo quella che il regolamento descrive. La presa trattiene =
     Immobilizzare (2 turni, «non può spostarsi in alcun modo»). Decisioni dell'autore del 7/11 (DECISIONI §15 G.4): lo sgambetto
     riuscito fa cadere il bersaglio, e rialzarsi gli costa mezzo turno (la stessa unità degli oggetti, §13: nel suo turno non si
     sposta, ma se è vicino colpisce); la spinta lo fa arretrare di 1 casella sulla griglia; il disarmo gli toglie l'arma: colpisce a
     mani nude (danno base 0 + dado + statistica) finché non la raccoglie, e raccoglierla gli costa mezzo turno (nel suo turno non si
     sposta; il colpo di quel turno è ancora a mani nude). Le altre azioni libere non hanno una conseguenza meccanica. Mai un danno. */
  const MANOVRE_NOMI = { sgambetto: 'lo sgambetto', spinta: 'la spinta', presa: 'la presa', disarmo: 'il disarmo', libera: 'l\'azione' };
  const CONSEGUENZE_MANOVRA = { presa: [{ stato: 'immobilizzare', turni: 2 }] };
  function eseguiManovra(state, cmd, bersaglio, dice, ev) {
    const tipo = MANOVRE_NOMI[cmd.manovra] ? cmd.manovra : 'libera';
    const ac = pgCombatant(state).traits['Arte Combattiva'] || 0, el = ((bersaglio.traits || {}).Elusione) || 0;
    let tiro;
    if (ac > 0) { const a = dice.roll(20, 'Manovra (d20 + Arte Combattiva)'), d = dice.roll(20, 'Contro la manovra (d20 + Elusione)'); tiro = { dado: 'd20', att: a + ac, dif: d + el, dadoAtt: a, dadoDif: d, ac, el }; }
    else { const a = dice.roll(100, 'Manovra (d100)'), d = dice.roll(100, 'Contro la manovra (d100)'); tiro = { dado: 'd100', att: a, dif: d, dadoAtt: a, dadoDif: d }; }
    const ok = tiro.att > tiro.dif;
    const az = { chi: 'pg', tipo: 'manovra', manovra: tipo, capacita: MANOVRE_NOMI[tipo], riuscita: ok, tiro, bersaglio: bersaglio.uid || null, bersaglioNome: bersaglio.nome };
    if (tipo === 'libera' && cmd.testo) az.testo = String(cmd.testo).slice(0, 200);
    ev.combattimento.azioni.push(az);
    if (ok && CONSEGUENZE_MANOVRA[tipo]) applicaStati(bersaglio, CONSEGUENZE_MANOVRA[tipo], ev);
    if (ok && tipo === 'sgambetto') bersaglio.aTerra = true;
    if (ok && tipo === 'disarmo' && (bersaglio.equip || []).some(e => e.tipo === 'arma')) bersaglio.disarmato = true;
    if (ok && tipo === 'spinta') {
      const g = grigliaDi(state), inc = state.incontro;
      az.caselle = g && GR().allontana ? GR().allontana(g, bersaglio.uid || 'nemico', 'pg', uidAttivi(inc)) : 0;
      if (g) allineaPosizioni(inc);
    }
  }
  // Immobilizzare (js/rules.js): «il bersaglio non può spostarsi in alcun modo»
  // attivo finché restano turni (tickStatiBersaglio scala `turni` a ogni round e toglie lo stato a 0)
  const immobilizzato = u => (u && u.stati || []).some(s => s.stato === 'immobilizzare' && (s.turni || 0) > 0);
  // Stordire (js/rules.js): fino al turno successivo il bersaglio non può schivare né bloccare
  const stordito = u => (u && u.stati || []).some(s => s.stato === 'stordire' && (s.turni || 0) > (s.passati || 0));
  // punto 5: il corpo a corpo vuole il bersaglio a una casella; controllato prima di tirare o pagare qualunque cosa
  function controllaPortata(state, cmd, bersaglio) {
    const g = grigliaDi(state), att = g && attaccoPg(state, cmd);
    const no = att && GR().portata(g, 'pg', bersaglio, att);
    if (no) throw new SoloError('azione_non_valida', no);
  }
  /* Punti 2, 3 e 5: prima di un colpo in mischia chi non è a una casella si avvicina fino a N caselle (il suo movimento per
     turno); se arriva vicino colpisce nello stesso round, altrimenti il suo turno è stato il movimento. True se può colpire. */
  function avvicinaPerColpire(state, ev, uid, azione) {
    const g = grigliaDi(state), inc = state.incontro;
    const u0 = inc.gruppo ? AV().unita(inc, uid) : inc.nemico;
    // rialzarsi costa mezzo turno: si rialza qui (sulla griglia senza muoversi, vedi sotto); se è vicino colpisce lo stesso
    if (u0 && u0.aTerra) {
      ev.combattimento.azioni.push(Object.assign({ chi: 'nemico', nome: u0.nome, tipo: 'rialzarsi', segnale: 'si rialza' }, inc.gruppo ? { uid } : {}));
      if (g && GR().portata(g, uid, 'pg', azione)) { delete u0.aTerra; return false; }
      delete u0.aTerra;
    }
    if (!g || !GR().portata(g, uid, 'pg', azione)) return true;
    const u = inc.gruppo ? AV().unita(inc, uid) : inc.nemico;
    // a terra o disarmato: il mezzo turno se ne va per rialzarsi o raccogliere l'arma, e non resta movimento (§15 G.4)
    const passi = immobilizzato(u) || u.aTerra || u.disarmato ? 0 : GR().avvicina(g, uid, 'pg', foeStat(u, 'vel'), uidAttivi(inc));
    allineaPosizioni(inc);
    if (passi) ev.combattimento.azioni.push(Object.assign({ chi: 'nemico', nome: u.nome, tipo: 'movimento', verso: 'pg', caselle: passi, griglia: true }, inc.gruppo ? { uid } : {}));
    return !GR().portata(g, uid, 'pg', azione);
  }
  /* Punto 3: lo spostamento del protagonista non consuma l'azione del round (come il Boost: il round non avanza e nessuno
     risponde); vale solo il tetto dei quarti di movimento per turno (js/data.js). */
  function muoviPg(state, cmd, ev) {
    const g = grigliaDi(state), inc = state.incontro;
    if (!g) throw new SoloError('azione_non_valida', 'In questo scontro non ci sono caselle su cui spostarsi.');
    const v = cmd.verso || {};
    const r = GR().muovi(g, { col: Number(v.col), row: Number(v.row) }, pgStat(state, 'vel'), inc.round, uidAttivi(inc));
    if (r.errore) throw new SoloError('azione_non_valida', r.errore);
    allineaPosizioni(inc);
    ev.combattimento = { round: inc.round, azioni: [{ chi: 'pg', tipo: 'movimento', da: r.da, a: r.a, caselle: r.caselle }], mezzoTurno: true };
  }
  // per il pannello: caselle ancora percorribili in questo round e distanza di ogni avversario in campo (null senza griglia)
  function grigliaInfo(state) {
    const g = grigliaDi(state), inc = state.incontro;
    if (!g) return null;
    const attivi = uidAttivi(inc), distanze = {};
    attivi.forEach(uid => { distanze[uid] = GR().distanza(g, 'pg', uid); });
    return { griglia: g, caselle: GR().caselleDisponibili(g, pgStat(state, 'vel'), inc.round), distanze, attivi };
  }

  /* Stati attivi (supporti): Forza, Mira e Forza Magica entrano nel
     danno; la Difesa nella riduzione automatica del danno (supportSaveBonus). */
  function pgCombatant(state) {
    const R_ = R();
    const c = R_.toCombatant(Object.assign({}, state.personaggio));
    const round = state.incontro ? state.incontro.round : 0;
    state.supporti.filter(s => s.round >= round).forEach(s => Object.entries(s.bonus || {}).forEach(([k, v]) => {
      if (k === 'for' || k === 'mira' || k === 'fmen') c.primary[k] = Math.max(1, (Number(c.primary[k]) || 0) + v);
    }));
    Object.keys(c.traits).forEach(k => { c.traits[k] += bonusTratto(state, k); });
    return c;
  }
  /* K21, bonus a un tratto (decisione dell'autore del 29/10, DECISIONI_AUTORE §9 punto 4): un'abilità di supporto con
     `bonusTratto: [{ tratto, valore }]` alza quel tratto finché l'effetto dura (lo stesso `round` dei bonus alle statistiche).
     Stessa regola dell'app, che qui non si può chiamare (lavora sugli effetti del combattimento online): in js/app.js le voci bonus di
     un'Abilità di Supporto su un tratto diventano trait_mods (r.7342-7366) e combatTraitModTotal (r.5363) le somma al valore del tratto,
     come equipBonusTotal fa per l'equipaggiamento (r.9745-9754) dentro getTraitValue (r.15889). */
  function bonusTratto(state, nome) {
    const round = state.incontro ? state.incontro.round : 0;
    return (state.supporti || []).filter(s => s.round >= round && Array.isArray(s.bonusTratto))
      .reduce((a, s) => a + s.bonusTratto.filter(b => b && b.tratto === nome).reduce((x, b) => x + (Number(b.valore) || 0), 0), 0);
  }
  /* Scheda per le prove sui tratti: con i bonus a un tratto attivi sommati al valore. Solo sui tratti che il personaggio ha: la prova
     senza competenza resta quella del manuale, senza bonus (js/solo/solo-rules.js r.133). Senza bonus attivi è la scheda stessa. */
  function schedaConBonus(state) {
    const pg = state.personaggio;
    if (!(state.supporti || []).some(s => Array.isArray(s.bonusTratto))) return pg;
    const traits = {};
    Object.keys(pg.traits || {}).forEach(l => {
      traits[l] = Object.assign({}, pg.traits[l]);
      Object.keys(traits[l]).forEach(k => { if (Number(traits[l][k]) > 0) traits[l][k] = Number(traits[l][k]) + bonusTratto(state, k); });
    });
    return Object.assign({}, pg, { traits });
  }
  // voce di stato attivo per un'abilità di supporto: bonus alle statistiche e, se l'abilità lo dichiara, bonus a un tratto (K21)
  const supportoDi = (ab, round, extra) => Object.assign({ nome: ab.nome, bonus: Object.assign({}, bonusOf(ab)), round }, Array.isArray(ab.bonusTratto) && ab.bonusTratto.length ? { bonusTratto: ab.bonusTratto.map(b => ({ tratto: b.tratto, valore: Number(b.valore) || 0 })) } : {}, extra || {});

  function autoDefense(c) {
    if (stordito(c)) return 'none';
    if ((c.traits['Elusione'] || 0) > 0) return 'dodge';
    if ((c.traits['Guardia'] || 0) > 0) return 'block';
    return 'none';
  }
  /* Equipaggiamento difensivo del protagonista (regola delle difese, 6/11/2026):
     - armatura indossata: la sua DIF si somma alla Difesa nella riduzione
       automatica del danno (manuale; combatAutoReductionRoll in js/app.js),
       sulla scala di armorDifContribution (js/data.js, 7/11/2026: × 0,25, al massimo +6);
     - scudo (in dotazione o comparso da una gemma): rende possibile il
       Blocco e ne somma la DIF al tiro (combatRollDefense in js/app.js). */
  function equipIntegro(e) { return e && !(Number.isFinite(e.durabilitaCorrente) && e.durabilitaCorrente <= 0); }
  // shortcut: la solitaria non ha parti del corpo, quindi conta la DIF di tutte le armature integre (l'app usa solo il pezzo colpito)
  const difDi = (equip, tipo) => (equip || []).filter(e => e.tipo === tipo && Number.isFinite(e.dif) && equipIntegro(e)).reduce((a, e) => a + e.dif, 0);
  // armatura: la sua DIF sulla scala di js/data.js (armorDifContribution: × 0,25, al massimo +6), la stessa del gioco online
  // (decisione dell'autore del 7/11/2026, DECISIONI_AUTORE §15 I.4f); vale per il protagonista e per i nemici
  const difArmatura = equip => armorDifContribution(difDi(equip, 'armatura'));
  function armorSaveBonus(state) { return difArmatura(state.personaggio.equip); }
  /* Tecnica e arma (decisione dell'autore del 7/11/2026, DECISIONI_AUTORE §15 I.4a): il danno della Tecnica è un effetto
     supplementare e si somma all'Atk dell'arma in mano (integra); Magie, gemme e capacità speciali non usano l'arma. */
  function dannoCapacita(pg, azione, ab) {
    const w = azione === 'tecnica' ? armaPartita(pg) : null;
    return (Number(ab.dannoBase) || 0) + (w ? Number(w.atk) || 0 : 0);
  }
  function hasShield(state) {
    const round = state.incontro ? state.incontro.round : 0;
    return (state.personaggio.equip || []).some(e => e.tipo === 'scudo' && equipIntegro(e)) || state.supporti.some(s => s.scudo && s.round >= round);
  }
  // difesa del protagonista: la sceglie il giocatore (js/rules.js: «il bersaglio può scegliere Schivata, Blocco o nessuna difesa»);
  // senza una scelta valida resta quella di prima (Schivata con Elusione, altrimenti Blocco con lo scudo)
  function pgDefense(state, c) {
    const scelta = state.incontro && state.incontro.difesaScelta;
    if (scelta === 'none' || scelta === 'dodge') return scelta;
    if (scelta === 'block' && hasShield(state)) return 'block';
    if ((c.traits['Elusione'] || 0) > 0) return 'dodge';
    return hasShield(state) ? 'block' : 'none';
  }
  // per l'interfaccia: la difesa in vigore (scelta o predefinita) e se il Blocco è possibile
  function difeseProtagonista(state) { return { scelta: state.incontro ? pgDefense(state, pgCombatant(state)) : null, scudo: hasShield(state) }; }

  /* Statistiche usate davvero nello scontro (con gli stati attivi):
     - Destrezza: precisione degli attacchi fisici (metà, per difetto);
     - Difesa Magica: riduzione automatica contro attacchi magici o tecnologici;
     - Velocità: chi colpisce per primo all'inizio dello scontro e
       modificatore della fuga (differenza, da −3 a +3);
     - Difesa: riduzione automatica di ogni colpo (supportSaveBonus). */
  function activeBonus(state, key) {
    const round = state.incontro ? state.incontro.round : 0;
    return state.supporti.filter(s => s.round >= round).reduce((a, s) => a + ((s.bonus || {})[key] || 0), 0);
  }
  function pgStat(state, key) { return (Number(state.personaggio.primary[key]) || 0) + activeBonus(state, key); }
  function foeStat(foe, key) { return Number((foe.primary || {})[key]) || 0; }
  /* Dati del colpo da mostrare (5/11/2026): tratto e bonus usati da resolveAttack per «colpire», letti come li legge lui. Solo per mostrarli. */
  function datiColpo(attaccante, mods) {
    const tratto = mods.tratto || 'Arte Combattiva';
    return { tratto, valore: (attaccante && attaccante.traits && attaccante.traits[tratto]) || 0, bonus: Number(mods.bonusColpire) || 0 };
  }
  function attackMods(atkDex, action, targetDmen) {
    const magico = action.stat === 'fmen';
    return Object.assign({}, action, { bonusColpire: magico ? 0 : Math.floor(Math.max(0, atkDex) / 2), bonusSalvezza: magico ? Math.max(0, targetDmen) : 0 });
  }
  function supportSaveBonus(state) {
    return state.supporti.filter(s => s.round >= (state.incontro ? state.incontro.round : 0)).reduce((a, s) => a + (s.bonus.dif || 0), 0);
  }

  /* Un consumabile come azione del turno: stesso effetto dichiarato del
     catalogo (useItem), il turno del protagonista è l'uso. */
  /* Munizioni (js/munizioni.js; decisioni dell'autore del 4/11/2026, stesse regole online):
     colpi pronti sull'arma della partita, riserva = oggetti dell'inventario il cui catalogo
     indica «munizione» (stesso tipo). Armi senza capacità: nessuna munizione, come prima. */
  // l'arma in mano: la prima con un Atk e integra (equipIntegro: a durabilità 0 non si usa finché non viene riparata,
  // js/rules.js Glossario; correzione del 7/11/2026, DECISIONI_AUTORE §15 I.3)
  function armaPartita(pg) { return (pg.equip || []).find(e => e.tipo === 'arma' && e.atk != null && equipIntegro(e)) || null; }
  // nessuna arma utilizzabile: il motivo (rotta o assente) per il giocatore
  function senzaArma(pg) {
    const rotta = (pg.equip || []).find(e => e.tipo === 'arma' && e.atk != null);
    return new SoloError('azione_non_valida', rotta ? rotta.nome + ' è rotta: va riparata (al riposo, in una scena calma) prima di usarla di nuovo.' : 'Nessuna arma');
  }
  function righeRiserva(state, content) {
    return (state.inventario || []).filter(i => !i.istanza).map(i => {
      const d = content.borsa && content.borsa.oggetti[i.id];
      return d && d.munizione ? { effetto: 'munizione', munizione: d.munizione, quantita: i.qty, inv: i } : null;
    }).filter(Boolean);
  }
  function scriviRiserva(state, righe) {
    righe.forEach(r => { r.inv.qty = r.quantita; });
    state.inventario = state.inventario.filter(i => !(i.qty <= 0 && righe.some(r => r.inv === i)));
  }
  function sparaSolo(state, content, w, colpi, applied) {
    const M = MUN();
    if (!M || !w || !M.usa(w) || !colpi) return;
    const righe = righeRiserva(state, content);
    const r = M.spara(w, righe, colpi);
    if (!r.ok) throw new SoloError('munizioni', r.motivo);
    scriviRiserva(state, righe);
    applied.push({ tipo: 'munizioni', arma: w.nome, consumate: r.consumate, caricate: r.caricate, riserva: r.riserva });
  }
  /* PROPOSTA DA APPROVARE: in solitaria non ci sono quarti di turno; la ricarica di un'arma con
     Tr > 0 occupa lo scambio (il nemico risponde). Con Tr = 0 la ricarica è automatica al colpo. */
  function ricaricaSolo(state, content, applied, ev) {
    const M = MUN(), w = armaPartita(state.personaggio);
    if (!M || !w || !M.usa(w)) throw new SoloError('azione_non_valida', 'Quest\'arma non usa munizioni.');
    const righe = righeRiserva(state, content);
    const r = M.ricarica(w, righe);
    if (!r.ok) throw new SoloError('munizioni', r.motivo);
    scriviRiserva(state, righe);
    applied.push({ tipo: 'ricarica', arma: w.nome, trasferite: r.trasferite, caricate: r.caricate, riserva: r.riserva });
    ev.combattimento.azioni.push({ chi: 'pg', tipo: 'ricarica', capacita: w.nome });
  }
  function munizioniArma(state, content) {
    const M = MUN(), w = state && state.personaggio && armaPartita(state.personaggio);
    if (!M || !w || !M.usa(w)) return null;
    const righe = righeRiserva(state, content);
    return { arma: w.nome, caricate: M.caricate(w), capacita: Number(w.capacita), riserva: M.riservaTot(w, righe), etichetta: M.etichetta(w, righe),
      ricaricabile: M.quartiRicarica(w) > 0 && M.caricate(w) < Number(w.capacita) && M.riservaTot(w, righe) > 0 };
  }
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
    const durata = inc.round + roundsDi(ab.durataTurni);
    if (Number.isFinite(ab.curaPercentuale) && ab.curaPercentuale > 0) {
      const g2 = Math.min(Math.max(1, Math.round(pg.hpMaxTracked * ab.curaPercentuale / 100)), pg.hpMaxTracked - pg.hpCur);
      pg.hpCur += g2;
      applied.push({ tipo: 'hp', delta: g2, valore: pg.hpCur });
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'cura', capacita: ab.nome, curati: g2 });
      return;
    }
    state.supporti.push(supportoDi(ab, durata, ab.scudo ? { scudo: true } : null));
    ev.combattimento.azioni.push({ chi: 'pg', tipo: 'supporto', capacita: ab.nome, bonus: bonusOf(ab), scudo: !!ab.scudo });
  }

  /* ------------------------------------------------------------ Boost in partita

     Regole esistenti riusate (CLAUDE.md §10), nessuna formula nuova: BOOST_LEVELS (livelli 1-5, costo di
     attivazione fisso per livello, durata base di 3 round), boostActivationCost (sconto del 10% con il
     Lv Top), boostMaintenancePerTurn, boostAdvancementThreshold e, per i PP, metà HP + metà MP come nella
     scheda; i PP tornano con il riposo, che li paga con i P.R. come in «I miei personaggi». Come nell'app:
     un solo Boost attivo alla volta; si sceglie il livello da attivare fra quelli raggiunti; i PP spesi
     (attivazione e mantenimento) fanno crescere il Boost: a fine scontro sale di un livello, e dopo il 5
     arriva il Lv Top.
     Regole decise dall'autore (7/11/2026, DECISIONI_AUTORE §15 I.3 e I.4c), le stesse online:
     1. «mezzo turno» (manuale): l'attivazione non consuma il round (il nemico non risponde e il round non avanza);
        poi si agisce nello stesso round; un solo mezzo turno per round, condiviso con l'uso di un oggetto;
     2. il turno di attivazione conta come primo turno di mantenimento: il mantenimento si paga all'inizio di ogni
        round DOPO quello di attivazione (Lv 1: 8 + 5 + 5 = 18 PP per 3 turni); senza PP sufficienti il Boost finisce.
     PROPOSTE DA APPROVARE (cercate in js/data.js, js/rules.js, js/app.js, js/cloud-combat.js: non definite):
     3. potenziamento al livello L = bonus del Boost di catalogo × L (il catalogo definisce solo il Lv 1);
     4. estensione (dal Lv 2, BOOST_LEVELS[].estendibile): +1 round, senza costo immediato (si paga il
        mantenimento dei round in più). */
  const ppMaxOf = pg => (Number(pg.hpMaxTracked) || 0) / 2 + (Number(pg.mpMaxTracked) || 0) / 2;
  const ppNow = pg => Number.isFinite(pg.ppCur) ? pg.ppCur : ppMaxOf(pg);
  const boostLvOf = b => clamp(parseInt(b && b.lv, 10) || 1, 1, 5);
  function boostBonusAt(b, lv) {
    const o = {};
    (b.bonus || []).forEach(x => { const v = Math.round((Number(x.valore) || 0) * lv); if (x.stat && v) o[x.stat] = (o[x.stat] || 0) + v; });
    return o;
  }
  /* Il Boost attivo conta finché non finisce il suo ultimo round (tra un comando e l'altro il round può essere già scaduto). */
  function boostAttivoOra(state) {
    const a = state.boostAttivo;
    return a && state.incontro && state.incontro.round <= a.fino ? a : null;
  }
  /* Perché il Boost `b` non si può attivare adesso al livello `lv` ('' se si può). */
  function boostBlock(state, b, lv) {
    const pg = state.personaggio, a = boostAttivoOra(state);
    if (!state.incontro) return 'I Boost si attivano durante uno scontro.';
    if (pg.hpCur <= 0) return 'Non sei in condizione di agire.';
    if (a) return a.id === b.id ? b.nome + ' è già attivo.' : 'Hai già ' + a.nome + ' attivo: un solo Boost alla volta.';
    if (state.incontro.mezzoTurnoRound === state.incontro.round) return 'In questo round hai già usato il mezzo turno (un oggetto): ora agisci.';
    if (lv > boostLvOf(b)) return b.nome + ' è appreso fino al Lv ' + boostLvOf(b) + '.';
    const costo = boostActivationCost(b, lv);
    if (costo > ppNow(pg)) return 'PP insufficienti: servono ' + costo + ' PP, ne hai ' + ppNow(pg) + '.';
    return '';
  }
  /* Scheda dei Boost per il pannello del combattimento (solo lettura, calcolata dal motore). */
  function boostInfo(state) {
    const pg = state.personaggio, a = boostAttivoOra(state), round = state.incontro ? state.incontro.round : 0;
    return {
      pp: ppNow(pg), ppMax: ppMaxOf(pg),
      boost: (pg.boost || []).map(b => {
        const lvMax = boostLvOf(b), soglia = boostAdvancementThreshold(lvMax);
        const att = a && a.id === b.id ? a : null;
        const ref = BOOST_LEVELS.find(l => l.lv === (att ? att.lv : lvMax));
        return {
          id: b.id, nome: b.nome, descrizione: b.descrizione, lv: lvMax, lvTop: !!b.lvTop, progresso: Number(b.progresso) || 0, soglia,
          attivo: !!att, finoAlRound: att ? att.fino : null, roundRestanti: att ? att.fino - round + 1 : 0, estendibile: !!(att && ref && ref.estendibile),
          livelli: BOOST_LEVELS.filter(l => l.lv <= lvMax).map(l => ({ lv: l.lv, costo: boostActivationCost(b, l.lv), mantenimento: boostMaintenancePerTurn(l.lv), bonus: boostBonusAt(b, l.lv), motivo: boostBlock(state, b, l.lv) }))
        };
      })
    };
  }
  function activateBoost(state, content, cmd, applied, ev) {
    const pg = state.personaggio, inc = state.incontro;
    const b = (pg.boost || []).find(x => x.id === cmd.boostId);
    if (!b) throw new SoloError('azione_non_valida', 'Boost non in scheda');
    const lv = cmd.livello == null ? boostLvOf(b) : Number(cmd.livello);
    if (!Number.isInteger(lv) || lv < 1 || lv > 5) throw new SoloError('azione_non_valida', 'Livello del Boost non valido.');
    const motivo = boostBlock(state, b, lv);
    if (motivo) throw new SoloError(/^PP/.test(motivo) ? 'risorse_insufficienti' : 'azione_non_valida', motivo);
    const costo = boostActivationCost(b, lv), bonus = boostBonusAt(b, lv);
    pg.ppCur = Math.max(0, ppNow(pg) - costo);
    b.progresso = (Number(b.progresso) || 0) + costo;
    state.boostAttivo = { id: b.id, nome: b.nome, lv, dal: inc.round, fino: inc.round + 2, bonus };
    inc.mezzoTurnoRound = inc.round; // l'attivazione è il mezzo turno del round (js/rules.js), come un oggetto (§13)
    // durata dichiarata nello stato (3 round: questo e i due successivi, js/rules.js), così il dettaglio non ricade su «1 turno» (B25)
    state.supporti.push({ nome: b.nome, bonus: Object.assign({}, bonus), round: inc.round + 2, boost: true, durataTurni: 3 });
    applied.push({ tipo: 'costo', risorsa: 'PP', delta: -costo, valore: pg.ppCur });
    applied.push({ tipo: 'boost_attivato', boost: b.id, nome: b.nome, livello: lv, costo, bonus });
    ev.combattimento = { round: inc.round, azioni: [{ chi: 'pg', tipo: 'boost', capacita: b.nome, livello: lv, costo, bonus }] };
  }
  function extendBoost(state, applied, ev) {
    const a = boostAttivoOra(state), inc = state.incontro;
    if (!a) throw new SoloError('azione_non_valida', 'Nessun Boost attivo da estendere.');
    const ref = BOOST_LEVELS.find(l => l.lv === a.lv);
    if (!ref || !ref.estendibile) throw new SoloError('azione_non_valida', a.nome + ' è estendibile solo dal Lv 2 in su.');
    a.fino += 1;
    state.supporti.forEach(s => { if (s.boost) s.round = a.fino; });
    applied.push({ tipo: 'boost_esteso', boost: a.id, nome: a.nome, fino: a.fino });
    ev.combattimento = { round: inc.round, azioni: [{ chi: 'pg', tipo: 'boost_estendi', capacita: a.nome, fino: a.fino }] };
  }
  function endBoost(state, a, motivo, applied, ev) {
    state.boostAttivo = null;
    state.supporti = state.supporti.filter(s => !s.boost);
    if (ev && ev.combattimento) ev.combattimento.azioni.push({ chi: 'sistema', tipo: 'boost_fine', capacita: a.nome, motivo });
    applied.push({ tipo: 'boost_fine', boost: a.id, nome: a.nome, motivo });
  }
  /* All'inizio di ogni round dopo quello di attivazione: scadenza o mantenimento in PP. */
  function boostTick(state, applied, ev) {
    const a = state.boostAttivo, inc = state.incontro, pg = state.personaggio;
    if (!a || !inc || inc.round <= a.dal) return;
    // scaduto: se lo stato del Boost è già stato tolto (e annunciato) a fine round, si chiude senza annunciarlo due volte (B29)
    if (inc.round > a.fino) return endBoost(state, a, 'scaduto', applied, ev);
    const m = boostMaintenancePerTurn(a.lv);
    if (ppNow(pg) < m) return endBoost(state, a, 'senza_pp', applied, ev);
    pg.ppCur = ppNow(pg) - m;
    const b = (pg.boost || []).find(x => x.id === a.id);
    if (b) b.progresso = (Number(b.progresso) || 0) + m;
    applied.push({ tipo: 'costo', risorsa: 'PP', delta: -m, valore: pg.ppCur, boost: a.nome });
  }
  /* Fine dello scontro: il Boost si spegne e i PP spesi fanno maturare il livello (+1, poi Lv Top dopo il 5). */
  function boostFineScontro(state, applied) {
    state.boostAttivo = null;
    (state.personaggio.boost || []).forEach(b => {
      const lv = boostLvOf(b);
      if (lv >= 5 && b.lvTop) return;
      const soglia = boostAdvancementThreshold(lv);
      if (!soglia || (Number(b.progresso) || 0) < soglia) return;
      if (lv >= 5) b.lvTop = true; else b.lv = lv + 1;
      b.progresso = 0;
      applied.push({ tipo: 'boost_livello', boost: b.id, nome: b.nome, livello: boostLvOf(b), top: !!b.lvTop });
    });
  }

  /* Un turno: azione del protagonista, poi risposta del nemico. */
  function combatRound(state, content, cmd, dice, applied, ev) {
    if (state.incontro.gruppo) return groupRound(state, content, cmd, dice, applied, ev);
    const inc = state.incontro;
    const pg = state.personaggio;
    const me = pgCombatant(state);
    const foe = inc.nemico;
    controllaPortata(state, cmd, 'nemico');
    ev.combattimento = { round: inc.round, azioni: [] };
    boostTick(state, applied, ev);
    // stati con effetto per turno (catalogo degli stati)
    if (AV() && AV().tickStati(state, applied) > 0 && pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    // stati inflitti dalle capacità del protagonista (pregio): il nemico li subisce a ogni round
    tickStatiBersaglio(foe, ev);
    if (foe.hp <= 0) return endEncounter(state, content, 'vittoria', applied, ev);
    // armatura e scudo del nemico, come per le unità di gruppo (unitCombatant) e per il protagonista
    const bersaglio = () => Object.assign({}, foe, { bonusRiduzione: { dif: difArmatura(foe.equip) }, bonusBlocco: difDi(foe.equip, 'scudo') });
    // iniziativa: 1d8 + Velocità per entrambi (js/rules.js; combatRollAndSendInitiative in js/app.js); vale anche contro chi tenta la fuga.
    // PROPOSTA DA APPROVARE: a parità di totale agisce prima il protagonista (l'app non definisce lo spareggio)
    let primoNemico = false;
    if (inc.round === 1 && !inc.iniziativa) {
      if (inc.sorpresa) primoNemico = true;
      else {
        const dPg = dice.roll(8, 'Iniziativa (d8 + Velocità)'), dNem = dice.roll(8, 'Iniziativa del nemico (d8 + Velocità)');
        const tiri = { pg: { d8: dPg, vel: pgStat(state, 'vel'), totale: dPg + pgStat(state, 'vel') }, nemico: { d8: dNem, vel: foeStat(foe, 'vel'), totale: dNem + foeStat(foe, 'vel') } };
        primoNemico = tiri.nemico.totale > tiri.pg.totale;
        ev.combattimento.iniziativaTiri = tiri;
      }
      inc.iniziativa = primoNemico ? 'nemico' : 'pg';
    }
    if (primoNemico) {
      ev.combattimento.iniziativa = 'nemico';
      enemyTurn(state, content, dice, ev, applied);
      if (!state.incontro) return ev.incontroEsito;
      if (pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    }

    if (cmd.azione === 'fuga') {
      const impedita = fugaImpedita(state, content);
      if (impedita) throw new SoloError('azione_non_valida', impedita);
      const sc = currentScene(state, content);
      const fuga = (sc.incontro && sc.incontro.fuga) || { tratto: 'Sopravvivenza', nc: 13, costo: [] };
      const velMod = Math.max(-3, Math.min(3, pgStat(state, 'vel') - foeStat(foe, 'vel')));
      const check = R().resolveCheck({ dice, sheet: schedaConBonus(state), trait: fuga.tratto, nc: fuga.nc + (AV() ? AV().modFuga(state, content, inc.nemicoId) : 0), difficolta: state.difficolta, mod: velMod });
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
        if (ab.sparaColpi) sparaSolo(state, content, MUN() && MUN().armaPerCapacita(pg.equip), MUN() ? MUN().colpiCapacita(ab, 1) : 0, applied);
        const mAb = attackMods(pgStat(state, 'dex'), { dannoBase: dannoCapacita(pg, cmd.azione, ab), stat: ab.stat, tratto: ab.arke ? 'Arkè' : undefined }, foeStat(foe, 'dmen'));
        const r = R().resolveAttack(dice, me, bersaglio(), mAb, autoDefense(foe));
        const prima = foe.hp; foe.hp = Math.max(0, foe.hp - r.finalDamage);
        ev.combattimento.azioni.push({ chi: 'pg', tipo: 'attacco', capacita: ab.nome, esito: r, colpo: datiColpo(me, mAb), hpNemico: foe.hp, perso: prima - foe.hp });
        if (r.finalDamage > 0 && foe.hp > 0) applicaStati(foe, ab.effettiStato, ev);
      } else {
        state.supporti.push(supportoDi(ab, inc.round + roundsDi(abE.durataTurni)));
        ev.combattimento.azioni.push({ chi: 'pg', tipo: 'supporto', capacita: ab.nome, bonus: bonusOf(ab) });
      }
    } else if (cmd.azione === 'scarica_gemma') {
      // azione completa: il turno del protagonista è la scarica
      dischargeGem(state, content, cmd.gemmaId, applied, ev);
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'scarica_gemma', gemma: cmd.gemmaId });
    } else if (cmd.azione === 'manovra') {
      eseguiManovra(state, cmd, foe, dice, ev);
    } else if (cmd.azione === 'arma') {
      const w = armaPartita(pg);
      if (!w) throw senzaArma(pg);
      sparaSolo(state, content, w, 1, applied);
      const mArma = attackMods(pgStat(state, 'dex'), { dannoBase: w.atk, stat: w.classe === 'tiro' ? 'mira' : 'for' }, foeStat(foe, 'dmen'));
      const r = R().resolveAttack(dice, me, bersaglio(), mArma, autoDefense(foe));
      const prima = foe.hp; foe.hp = Math.max(0, foe.hp - r.finalDamage);
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'attacco', capacita: w.nome, esito: r, colpo: datiColpo(me, mArma), hpNemico: foe.hp, perso: prima - foe.hp });
      wearForHit(state, applied, { r, arma: w, attaccante: pg, difensore: foe, salt: 'pg-arma' });
    } else if (cmd.azione === 'ricarica') {
      ricaricaSolo(state, content, applied, ev);
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
  function enemyTurn(state, content, dice, ev, applied) {
    const foe = state.incontro.nemico;
    const maniNude = foe.disarmato || armaRotta(foe, foe.attacco);
    if (!avvicinaPerColpire(state, ev, 'nemico', maniNude ? MANI_NUDE : foe.attacco)) return raccogliArma(foe, ev, false);
    const r = enemyAttack(state, content, dice, ev, maniNude ? Object.assign({}, MANI_NUDE) : undefined);
    raccogliArma(foe, ev, false);
    return r;
  }
  // disarmo (§15 G.4): il colpo del turno è a mani nude (la regola di Ingen), poi l'arma è di nuovo in mano
  const MANI_NUDE = { nome: 'A mani nude', dannoBase: 0, stat: 'for', maniNude: true };
  /* Arma rotta di un nemico (correzione del 7/11/2026, DECISIONI_AUTORE §15 I.3, come per il protagonista): l'attacco che usa
     un'arma della dotazione (stesso nome, scripts/lib/solo-equipaggiamento-nemici.js) e nessuna copia integra di quell'arma →
     colpisce a mani nude finché non viene riparata. */
  function armaRotta(u, att) {
    const stessa = ((u && u.equip) || []).filter(e => e.tipo === 'arma' && att && e.nome === att.nome);
    return stessa.length > 0 && !stessa.some(equipIntegro);
  }
  function raccogliArma(u, ev, gruppo) {
    if (!u || !u.disarmato) return null;
    delete u.disarmato;
    ev.combattimento.azioni.push(Object.assign({ chi: 'nemico', nome: u.nome, tipo: 'raccoglie_arma', segnale: "raccoglie l'arma" }, gruppo ? { uid: u.uid } : {}));
    return null;
  }

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
    // armatura e scudo dell'unità, come per il protagonista
    c.bonusRiduzione = { dif: difArmatura(u.equip) };
    c.bonusBlocco = difDi(u.equip, 'scudo');
    return c;
  }
  // difesa di un'unità: Elusione, oppure Blocco con Guardia e uno scudo (in dotazione o evocato)
  function unitDefense(u, c, round) {
    if (stordito(u)) return 'none';
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
    if (colpito.guardia >= inc.round) def.bonusRiduzione.dif += 2;
    const mods = attackMods(pgStat(state, 'dex'), action, foeStat(colpito, 'dmen'));
    // vulnerabilità leggibile: esposto dopo il suo colpo pesante
    const esposto = colpito.esposto >= inc.round;
    if (esposto) mods.bonusColpire += 2;
    // distanza: un colpo da mischia contro chi sta a distanza (proposta); con la griglia lo sostituisce la regola della casella
    // vicina (controllaPortata, DECISIONI §13 punto 5), e resta solo per gli scontri iniziati senza griglia
    if (!grigliaDi(state) && action.stat !== 'mira' && action.stat !== 'fmen' && colpito.posizione === 'distanza') mods.bonusColpire -= 2;
    // ambiente: chi sta a distanza dietro un riparo
    const amb = inc.ambiente && inc.ambiente.effetto && inc.ambiente.effetto.distanza;
    if (amb && colpito.posizione === 'distanza') def.bonusRiduzione.dif += (amb.dif || 0);
    const r = R().resolveAttack(dice, me, def, mods, esposto ? 'none' : unitDefense(colpito, def, inc.round));
    if (action.arma) wearForHit(state, applied, { r, arma: action.arma, attaccante: state.personaggio, difensore: colpito, salt: 'pg-arma:' + colpito.uid });
    // resistenze della scheda
    const sh = AV().scheda(content, colpito.id);
    const res = ((sh && sh.resistenze) || []).find(x => (x.tipo === 'magico' && action.stat === 'fmen') || (x.tipo === 'fisico' && action.stat !== 'fmen'));
    if (res && r.finalDamage > 0) { r.resistenza = res.tipo; r.finalDamage = Math.max(0, r.finalDamage - res.valore); }
    const prima = colpito.hp;
    colpito.hp = Math.max(0, colpito.hp - r.finalDamage);
    ev.combattimento.azioni.push({ chi: 'pg', tipo: 'attacco', capacita: etichetta, bersaglio: colpito.uid, bersaglioNome: colpito.nome, esito: r, colpo: datiColpo(me, mods), hpNemico: colpito.hp, perso: prima - colpito.hp, esposto });
    if (colpito.hp <= 0) unitExit(state, content, inc, colpito, 'sconfitto', ev, applied);
    else if (r.finalDamage > 0 && action.stati && action.stati.length) applicaStati(colpito, action.stati, ev);
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
    if (d.tipo === 'avvicina' && !grigliaDi(state)) { u.posizione = 'mischia'; push({ tipo: 'movimento', verso: 'mischia' }); return null; }
    // attacco (tecnica, magia, controllo, colpo di fase); sulla griglia prima si avvicina, se serve e se può (anche «avvicina»)
    const c = d.capacita;
    if (!avvicinaPerColpire(state, ev, u.uid, c)) return null;
    u.mp -= A.costoMP(c, u);
    let bonus = 0;
    const coord = inc.segnato === inc.round && dif.coordinamento;
    if (coord) bonus += 2;
    const combinato = dif.attacchiCombinati && inc.attacchiRound.length > 0;
    if (combinato) bonus += 1;
    A.reazioni(content, u, 'altro_lupo_attacca').forEach(rx => { if (inc.attacchiRound.length) bonus += (rx.effetto.bonusColpire || 0); });
    let azU = unitAction(content, c);
    if (u.dannoMolt && u.dannoMolt !== 1) azU.dannoBase = Math.round(azU.dannoBase * u.dannoMolt);
    if ((u.disarmato || armaRotta(u, azU)) && azU.stat !== 'fmen') azU = Object.assign({}, MANI_NUDE);
    enemyAttack(state, content, dice, ev, azU, bonus, u);
    raccogliArma(u, ev, true);
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
    boostTick(state, applied, ev);
    if (A.tickStati(state, applied) > 0 && pg.hpCur <= 0) { inc.round += 1; return pgDown(state, content, applied, ev); }
    A.attive(inc).forEach(u => { tickStatiBersaglio(u, ev); if (u.hp <= 0) unitExit(state, content, inc, u, 'sconfitto', ev, applied); });
    const fineStati = groupEnd(state, content, applied, ev);
    if (fineStati) return fineStati;
    // iniziativa al primo round: 1d8 + Velocità per ciascuno (js/rules.js); a parità prima il protagonista (PROPOSTA DA APPROVARE)
    if (inc.round === 1 && !inc.iniziativaTirata && !inc.sorpresa) {
      const tiri = inc.ordine.map(uid => { const u = uid === 'pg' ? null : A.unita(inc, uid); const v = uid === 'pg' ? pgStat(state, 'vel') : (Number(((u || {}).primary || {}).vel) || 0); const d = dice.roll(8, 'Iniziativa (d8 + Velocità)'); return { uid, d8: d, vel: v, totale: d + v }; });
      tiri.sort((a, b) => b.totale - a.totale || (a.uid === 'pg' ? -1 : b.uid === 'pg' ? 1 : 0));
      inc.ordine = tiri.map(t => t.uid); inc.iniziativaTirata = true;
      ev.combattimento.iniziativaTiri = tiri; ev.combattimento.ordine = inc.ordine.slice();
    }
    // Boost scaduti
    inc.nemici.forEach(u => { if (u.boost && inc.round > u.boost.fino) { Object.entries(u.boost.bonus).forEach(([k, v]) => { u.primary[k] = (Number(u.primary[k]) || 0) - v; }); u.boost = null; } });
    // ambiente di fase (es. il margine che si chiude a ogni turno)
    A.attive(inc).forEach(u => { const f = ((A.scheda(content, u.id) || {}).fasi || []).find(x => x.id === u.fase); if (f && f.ambiente && f.ambiente.orologio && f.ambiente.orologio.ogniTurno) applyEffects(state, content, [{ orologio: { id: f.ambiente.orologio.id, delta: f.ambiente.orologio.delta } }], 'ambiente:' + state.scena + ':' + inc.round + ':' + u.uid, applied, dice); });
    let target = A.unita(inc, cmd.bersaglio || inc.bersaglio);
    if (cmd.bersaglio && (!target || !target.attivo)) throw new SoloError('azione_non_valida', 'Quel bersaglio non è più in grado di combattere.');
    if (!target || !target.attivo) target = A.attive(inc)[0];
    inc.bersaglio = target.uid;
    controllaPortata(state, cmd, target.uid);
    // una fase può aver spostato «mischia/distanza»: con la griglia vale la casella
    allineaPosizioni(inc);
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
      const impedita = fugaImpedita(state, content);
      if (impedita) throw new SoloError('azione_non_valida', impedita);
      const sc = currentScene(state, content);
      const fuga = (sc.incontro && sc.incontro.fuga) || { tratto: 'Sopravvivenza', nc: 13, costo: [] };
      const piuVeloce = Math.max.apply(null, A.attive(inc).map(u => Number(u.primary.vel) || 0));
      const velMod = Math.max(-3, Math.min(3, pgStat(state, 'vel') - piuVeloce));
      const check = R().resolveCheck({ dice, sheet: schedaConBonus(state), trait: fuga.tratto, nc: fuga.nc + A.modFuga(state, content, inc.nemicoId), difficolta: state.difficolta, mod: velMod });
      check.velocita = velMod; ev.check = check;
      osserva({ tipo: 'fuga' });
      if (R().isSuccess(check.esito) || check.esito === 'parziale') { applyEffects(state, content, fuga.costo, 'fuga:' + state.scena + ':' + ev.n, applied, dice); return endEncounter(state, content, 'fuga', applied, ev); }
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'fuga_fallita' });
    } else if (cmd.azione === 'negozia') {
      // risoluzione alternativa: solo con la preparazione giusta (fatti dei dati)
      if (!inc.negoziabile) throw new SoloError('azione_non_valida', 'Non hai nulla su cui trattare, qui.');
      const check = R().resolveCheck({ dice, sheet: schedaConBonus(state), trait: 'Persuasione', nc: undefined, difficolta: state.difficolta });
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
      if (ab.tipo === 'danno' && ab.sparaColpi) sparaSolo(state, content, MUN() && MUN().armaPerCapacita(pg.equip), MUN() ? MUN().colpiCapacita(ab, 1) : 0, applied);
      if (ab.tipo === 'danno') pgHitsUnit(state, content, inc, target, { dannoBase: dannoCapacita(pg, cmd.azione, ab), stat: ab.stat, tratto: ab.arke ? 'Arkè' : undefined, stati: ab.effettiStato }, dice, ev, applied, ab.nome);
      else {
        state.supporti.push(supportoDi(ab, inc.round + roundsDi(abE.durataTurni)));
        ev.combattimento.azioni.push({ chi: 'pg', tipo: 'supporto', capacita: ab.nome, bonus: bonusOf(ab) });
      }
    } else if (cmd.azione === 'scarica_gemma') {
      dischargeGem(state, content, cmd.gemmaId, applied, ev);
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'scarica_gemma', gemma: cmd.gemmaId });
    } else if (cmd.azione === 'manovra') {
      osserva({ tipo: 'attacco', capacita: 'manovra' });
      eseguiManovra(state, cmd, target, dice, ev);
    } else if (cmd.azione === 'arma') {
      const w = armaPartita(pg);
      if (!w) throw senzaArma(pg);
      sparaSolo(state, content, w, 1, applied);
      osserva({ tipo: 'attacco', capacita: w.nome });
      pgHitsUnit(state, content, inc, target, { dannoBase: w.atk, stat: w.classe === 'tiro' ? 'mira' : 'for', arma: w }, dice, ev, applied, w.nome);
    } else if (cmd.azione === 'ricarica') {
      ricaricaSolo(state, content, applied, ev);
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
    meNow.bonusRiduzione = { dif: supportSaveBonus(state) + armorSaveBonus(state), dmen: activeBonus(state, 'dmen') };
    meNow.bonusBlocco = difDi(pg.equip, 'scudo');
    const mods = attackMods(foeStat(foe, 'dex'), att, pgStat(state, 'dmen'));
    if (bonusColpire) mods.bonusColpire += bonusColpire;
    const chiAttacca = attaccante ? unitCombatant(attaccante) : foe;
    const r2 = R().resolveAttack(dice, chiAttacca, meNow, mods, pgDefense(state, meNow));
    // taratura uno contro uno (SOLO_TUNING.dannoNemico), mai per Raven
    const T = R().SOLO_TUNING.dannoNemico;
    if (T && r2.finalDamage > 0 && inc.nemicoId !== 'raven') {
      const f = Math.max(T.fattoreMinimo, Math.min(1, (pg.hpMaxTracked || 0) / T.hpRiferimento));
      if (f < 1) { r2.dannoPrimaDellaTaratura = r2.finalDamage; r2.finalDamage = Math.max(1, Math.ceil(r2.finalDamage * f)); r2.taratura = f; }
    }
    const armaNemico = att.stat !== 'fmen' && !att.maniNude ? ((foe.equip || []).find(e => e.tipo === 'arma' && durabilitaUsabile(e)) || null) : null;
    wearForHit(state, ev.effetti, { r: r2, arma: armaNemico, attaccante: foe, difensore: pg, salt: 'nemico:' + (foe.uid || foe.nome) });
    const hpPrima = pg.hpCur;
    pg.hpCur = Math.max(0, pg.hpCur - r2.finalDamage);
    const az = { chi: 'nemico', tipo: 'attacco', capacita: att.nome, esito: r2, colpo: datiColpo(chiAttacca, mods), hpPg: pg.hpCur, perso: hpPrima - pg.hpCur };
    const S_ = att.stato;
    if (S_ && r2.finalDamage > 0 && pg.hpCur > 0) {
      const res = S_.resistenza ? R().resolveCheck({ dice, sheet: schedaConBonus(state), trait: S_.resistenza.tratto, nc: S_.resistenza.nc, difficolta: state.difficolta }) : null;
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
    if (kind === 'abilita' && ab.categoria === 'magia' && me && me.popolazioni.indexOf(pg.popolazione) !== -1 && !state.flags[me.flag_abilitante]) {
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
    // partita ferma alla fine di un atto: riprende se ora la storia ha l'atto successivo
    if (state && content) riprendiAtto(state, content);
    if (state && content && strutturaMode(content)) ST().migra(state, content);
    // fatti comunicati: le partite precedenti conservano ciò che il giocatore poteva già leggere (D4)
    if (state && content && CM()) CM().migra(state, content);
    if (state && content && MP() && MP().M(content)) MP().migra(state, content);
    const pg = state && state.personaggio;
    // partite salvate prima del level up obbligatorio: livello salito con punti
    // non spesi e nessuna traccia di un level up già concluso (levelUpFatto)
    if (pg && pg.livello > 1 && pg.levelUpFatto == null && !pg.levelUpInAttesa && !isOver(state)) {
      if (improvementOptions(pg).spendibile || slotDaAssegnare(pg) > 0) pg.levelUpInAttesa = pg.livello;
      else pg.levelUpFatto = pg.livello;
    }
    if (pg && content) {
      if (!pg.catalogoGruppo && archetipo && CT() && content.catalogo) pg.catalogoGruppo = CT().gruppoDaOntologia(content.catalogo, archetipo.ontologia);
      giveGroupBoost(pg, content);
      giveCampionario(pg, content);
      if (!Number.isFinite(pg.ppCur)) pg.ppCur = ppMaxOf(pg);
    }
    if (!pg || !archetipo) return state;
    if (!Array.isArray(pg.gemme)) {
      pg.gemme = (Array.isArray(archetipo.gemme) ? archetipo.gemme : []).map(gemmaDa);
      pg.capacitaSpeciali = clone(archetipo.capacitaSpeciali || []);
    }
    delete pg.gemmeCariche; delete pg.gemmeMax;
    if (pg.archetipo === archetipo.id && archetipo.ontologia && /autore/i.test((archetipo.ontologia.fonti || {}).peopleId || '')) {
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

  /* Crescita di Tecniche e Abilità dal Lv 1 al Lv 10 (regola dell'autore, 2026-10-20: il «pregio» del manuale).
     A ogni livello: se la capacità fa danno, il danno sale sempre; in più il giocatore sceglie UN pregio fra
       - durata più lunga (il passo successivo di AZIONE_DURATE),
       - incremento di statistica più alto,
       - effetto di stato maggiorato,
       - un effetto di stato in più (solo fra gli STATUS_EFFECTS già esistenti nel gioco).
     La scelta è del giocatore (comando «pregio» dalla schermata di level up della capacità) e la applica il motore:
     il Narratore (l'IA) non sceglie e non applica nulla.
     IPOTESI (l'unica): il manuale (js/rules.js, «Tecniche») non dà alcun valore numerico per livello, quindi +1 per
     livello: +1 al danno base, +1 a ogni incremento positivo di statistica, +1 turno alla durata di uno stato. */
  const PASSO_CRESCITA = 1;
  const LV_MAX_CAPACITA = 10;
  const NOMI_STAT = { for: 'Forza', dex: 'Destrezza', mira: 'Mira', fmen: 'Forza Magica', vel: 'Velocità', dif: 'Difesa', dmen: 'Difesa Magica' };
  const passiDurata = () => AZIONE_DURATE.filter(d => d.quarti > 0);
  const durataTurniDi = d => d.quarti / 4;
  const durataSuccessiva = turni => passiDurata().find(d => durataTurniDi(d) > turni) || null;
  const etichettaDurata = turni => { const d = AZIONE_DURATE.find(x => x.quarti === Math.round(turni * 4)); return d ? d.label.toLowerCase() : turni + ' turni'; };
  const statoDelGioco = key => STATUS_EFFECTS.find(s => s.key === key) || null;
  /* Turni interi di una durata (la durata frazionaria di un pregio vale per eccesso: i round sono interi). */
  const roundsDi = turni => (Number.isFinite(turni) && turni > 0 ? Math.ceil(turni) : 1);

  /* I pregi che la capacità può ricevere adesso. */
  function pregiOpzioni(ab) {
    const o = [];
    if (Number(ab.durataTurni) > 0) {
      const n = durataSuccessiva(Number(ab.durataTurni));
      if (n) o.push({ pregio: 'durata', etichetta: 'Durata più lunga: da ' + etichettaDurata(ab.durataTurni) + ' a ' + n.label.toLowerCase() });
    }
    const incrementi = Object.keys(ab.bonusStat || {}).filter(k => ab.bonusStat[k] > 0);
    if (incrementi.length) o.push({ pregio: 'incremento', etichetta: 'Incremento più alto: ' + incrementi.map(k => (NOMI_STAT[k] || k) + ' da +' + ab.bonusStat[k] + ' a +' + (ab.bonusStat[k] + PASSO_CRESCITA)).join(', ') });
    (ab.effettiStato || []).forEach(e => o.push({ pregio: 'stato_maggiorato', stato: e.stato, etichetta: (statoDelGioco(e.stato) || { label: e.stato }).label + ' maggiorato: da ' + e.turni + ' a ' + (e.turni + PASSO_CRESCITA) + ' turni' }));
    if (ab.tipo === 'danno') {
      STATUS_EFFECTS.filter(s => !(ab.effettiStato || []).some(e => e.stato === s.key))
        .forEach(s => o.push({ pregio: 'stato_nuovo', stato: s.key, etichetta: 'Effetto di stato in più: ' + s.label + ' (' + s.turns + ' turni)' }));
    }
    return o;
  }
  /* Riscrive il testo dell'effetto dai numeri correnti (il testo originale resta in effettoBase). */
  function riscriviEffetto(ab) {
    if (ab.effettoBase == null) ab.effettoBase = ab.effetto;
    let txt = String(ab.effettoBase || '');
    const pregi = ab.pregi || [];
    if (ab.tipo === 'danno' && Number.isFinite(ab.dannoBase)) txt = txt.replace(/danno base \d+/, 'danno base ' + ab.dannoBase);
    const extra = pregi.filter(x => x.pregio === 'incremento').length * PASSO_CRESCITA;
    if (extra) txt = txt.replace(/\+(\d+)/g, (m, n) => '+' + (Number(n) + extra));
    if (Number(ab.durataTurni) > 0) txt = txt.replace(/per \d+ turn[oi]/, 'per ' + etichettaDurata(ab.durataTurni));
    if ((ab.effettiStato || []).length) txt += ' · ' + ab.effettiStato.map(e => (statoDelGioco(e.stato) || { label: e.stato }).label + ' (' + e.turni + ' turni)').join(', ');
    ab.effetto = txt;
  }
  function applicaPregio(ab, scelta, lv) {
    if (scelta.pregio === 'durata') ab.durataTurni = durataTurniDi(durataSuccessiva(Number(ab.durataTurni)));
    else if (scelta.pregio === 'incremento') Object.keys(ab.bonusStat).forEach(k => { if (ab.bonusStat[k] > 0) ab.bonusStat[k] += PASSO_CRESCITA; });
    else if (scelta.pregio === 'stato_maggiorato') ab.effettiStato.find(e => e.stato === scelta.stato).turni += PASSO_CRESCITA;
    else if (scelta.pregio === 'stato_nuovo') ab.effettiStato = (ab.effettiStato || []).concat([{ stato: scelta.stato, turni: statoDelGioco(scelta.stato).turns }]);
    ab.pregi = (ab.pregi || []).concat([{ lv, pregio: scelta.pregio, stato: scelta.stato || null }]);
    riscriviEffetto(ab);
  }
  /* Comando «pregio» (neutro, come la spesa degli AP): sceglie il giocatore, applica il motore. */
  function scegliPregio(state, cmd, applied, ev) {
    const pg = state.personaggio;
    const i = (pg.pregiDaScegliere || []).findIndex(x => x.id === cmd.abilitaId);
    if (i < 0) throw new SoloError('azione_non_valida', 'Nessun pregio da scegliere per questa capacità.');
    const ab = [].concat(pg.tecniche || [], pg.abilita || [], pg.capacitaSpeciali || []).find(a => a.id === cmd.abilitaId);
    const scelta = ab && pregiOpzioni(ab).find(o => o.pregio === cmd.pregio && (o.stato || null) === (cmd.stato || null));
    if (!scelta) throw new SoloError('azione_non_valida', 'Questo pregio non è disponibile per la capacità.');
    const lv = pg.pregiDaScegliere[i].lv;
    applicaPregio(ab, scelta, lv);
    pg.pregiDaScegliere.splice(i, 1);
    applied.push({ tipo: 'pregio', capacita: ab.nome, lv, pregio: scelta.pregio, stato: scelta.stato || null, etichetta: scelta.etichetta });
    ev.riserva = ev.testoFisso = ab.nome + ' (Lv ' + lv + '): ' + scelta.etichetta + '.';
  }
  /* Opzioni offerte dalla schermata di level up (una voce per ogni pregio in attesa). */
  function pregiInAttesa(state) {
    const pg = state.personaggio;
    return (pg.pregiDaScegliere || []).map(x => {
      const ab = [].concat(pg.tecniche || [], pg.abilita || [], pg.capacitaSpeciali || []).find(a => a.id === x.id);
      return ab ? { id: x.id, nome: ab.nome, lv: x.lv, dannoBase: ab.tipo === 'danno' ? ab.dannoBase : null, opzioni: pregiOpzioni(ab) } : null;
    }).filter(Boolean);
  }
  /* Limite di utilizzi per salire di livello: la regola dell'app (utilizziLimitFor, base 8-11 secondo il Q.I. × Lv). */
  const utilizziPerLivello = (pg, ab) => utilizziLimitFor(pg.qi, ab.lv);

  /* Contatore "utilizzi" (js/data.js utilizziLimitFor): raggiunto il
     limite si azzera e la capacità sale di un livello (massimo Lv 10): il danno sale, poi il pregio. */
  function trackUse(pg, ab, applied) {
    ab.utilizzi = (ab.utilizzi || 0) + 1;
    const lim = utilizziPerLivello(pg, ab);
    if (ab.utilizzi >= lim && (ab.lv || 1) < LV_MAX_CAPACITA) {
      ab.utilizzi = 0; ab.lv += 1;
      const voce = { tipo: 'capacita_lv', capacita: ab.nome, lv: ab.lv };
      if (ab.tipo === 'danno' && Number.isFinite(ab.dannoBase)) { ab.dannoBase += PASSO_CRESCITA; voce.dannoBase = ab.dannoBase; riscriviEffetto(ab); }
      if (pregiOpzioni(ab).length) { pg.pregiDaScegliere = (pg.pregiDaScegliere || []).concat([{ id: ab.id, lv: ab.lv }]); voce.pregio = 'da_scegliere'; }
      applied.push(voce);
    }
  }

  /* Effetti di stato inflitti dalle capacità (pregio): il bersaglio colpito li porta per un numero di turni; Bruciare e Avvelenare
     tolgono HP a ogni round (percentuali del manuale, js/rules.js «effetti di stato»); gli altri restano segnati sul bersaglio. */
  function applicaStati(bersaglio, stati, ev, chi) {
    (stati || []).forEach(e => {
      bersaglio.stati = bersaglio.stati || [];
      const ora = bersaglio.stati.find(s => s.stato === e.stato);
      if (ora) ora.turni = Math.max(ora.turni, e.turni); else bersaglio.stati.push({ stato: e.stato, turni: e.turni, passati: 0 });
      ev.combattimento.azioni.push({ chi: 'pg', tipo: 'stato', stato: (statoDelGioco(e.stato) || { label: e.stato }).label, bersaglio: bersaglio.uid || null, bersaglioNome: bersaglio.nome, turni: e.turni });
    });
  }
  const PERCENTUALE_VELENO = [5, 5, 10, 15, 25];
  function tickStatiBersaglio(b, ev) {
    const azioni = ev.combattimento.azioni;
    (b.stati || []).forEach(s => {
      let perdita = 0;
      if (s.stato === 'bruciare') perdita = Math.max(1, Math.round(b.hpMax * 0.15));
      else if (s.stato === 'avvelenare') perdita = Math.max(1, Math.round(b.hpMax * PERCENTUALE_VELENO[Math.min(s.passati, PERCENTUALE_VELENO.length - 1)] / 100));
      s.passati += 1; s.turni -= 1;
      if (perdita) b.hp = Math.max(0, b.hp - perdita);
      azioni.push({ chi: 'nemico', uid: b.uid || null, nome: b.nome, tipo: 'stato_effetto', stato: (statoDelGioco(s.stato) || { label: s.stato }).label, perso: perdita, hpNemico: b.hp, turniRimasti: Math.max(0, s.turni) });
    });
    b.stati = (b.stati || []).filter(s => s.turni > 0);
  }

  /* Fuga impedita: dai dati (`fuga.classe: 'impedita'` della scena o del nemico) oppure da un nemico `inevitabile`
     (Raven al livello speciale, js/solo/solo-rules.js). Ritorna il motivo da mostrare al giocatore, o null. */
  function fugaImpedita(state, content) {
    const inc = state.incontro;
    const sc = currentScene(state, content) || {};
    const fs = (inc.fonte === 'scena' && sc.incontro && sc.incontro.fuga) || {};
    const fn = ((content.nemici || {})[inc.nemicoId] || {}).fuga || {};
    if (fs.classe === 'impedita') return fs.motivo || fn.motivo || 'Non c\'è via di fuga.';
    if (fn.classe === 'impedita' || (inc.nemico && inc.nemico.inevitabile)) return fn.motivo || 'Non c\'è via di fuga.';
    return null;
  }

  /* Identità di uno scontro per il rientro: un nemico legato a un PNG (pngId) è la stessa persona in ogni scena,
     uno generico («soldato») lo è solo nella sua scena. Senza «:», perché entra nel riferimento dei fili. */
  function chiaveIncontro(state, content, nemicoId) {
    const png = ((content.nemici || {})[nemicoId] || {}).pngId;
    return png ? 'png/' + png : state.scena + '/' + nemicoId;
  }
  /* Scontro lasciato a metà (fuga del protagonista o dei nemici): si conservano HP, MP, PR e stati di ogni
     avversario e l'esito di chi è già uscito; nessun recupero nel frattempo (un recupero è PROPOSTA DA APPROVARE,
     docs/proposte/FUGA_DAGLI_SCONTRI.md S4). Al rientro nello stesso scontro si riparte da qui. */
  function conservaIncontro(state, chiave, inc) {
    const vivo = n => ({ hp: n.hp, mp: n.mp, pr: n.pr, stati: clone(n.stati || []), esito: n.esito || null });
    state.incontriSospesi = state.incontriSospesi || {};
    state.incontriSospesi[chiave] = inc.gruppo
      ? { unita: inc.nemici.reduce((o, n) => { o[n.uid] = vivo(n); return o; }, {}) }
      : { nemico: vivo(inc.nemico) };
  }
  function riprendiIncontro(state, content, chiave) {
    const s = (state.incontriSospesi || {})[chiave], inc = state.incontro;
    inc.chiave = chiave;
    if (!s) return;
    const rimetti = (n, v) => {
      n.hp = Math.max(1, Math.min(n.hpMax || v.hp, v.hp));
      if (Number.isFinite(v.mp)) n.mp = v.mp;
      if (Number.isFinite(v.pr)) n.pr = v.pr;
      n.stati = clone(v.stati || []);
    };
    if (inc.gruppo) {
      inc.nemici.forEach(n => {
        const v = s.unita[n.uid];
        if (!v) return;
        // chi era a terra o si era arreso non torna; chi era fuggito torna con le ferite che aveva
        if (['sconfitto', 'incapacitato', 'arreso'].indexOf(v.esito) !== -1) { n.attivo = false; n.esito = v.esito; } else rimetti(n, v);
      });
      const cur = AV().unita(inc, inc.bersaglio);
      inc.bersaglio = cur && cur.attivo ? cur.uid : (AV().attive(inc)[0] || {}).uid || null;
      inc.nemico = clone(AV().unita(inc, inc.bersaglio) || inc.nemici[0]);
    } else rimetti(inc.nemico, s.nemico);
    inc.ripreso = true;
  }
  /* Stati inflitti dai nemici (veleno, sanguinamento…): non sono legati allo scontro come i supporti propri, il
     Boost o l'ambiente del luogo. Dopo una fuga restano in sospeso con i turni rimasti (fuori dallo scontro non
     passano turni) e riprendono al prossimo scontro; il riposo toglie quelli che il catalogo fa togliere al riposo. */
  function sospendiStati(state, inc) {
    const restano = (state.supporti || []).filter(s => s.stato && !s.ambiente && s.round > inc.round);
    if (restano.length) state.statiInSospeso = (state.statiInSospeso || []).concat(restano.map(s => Object.assign({}, s, { restanti: s.round - inc.round })));
  }
  function riprendiStati(state) {
    (state.statiInSospeso || []).forEach(s => { const x = Object.assign({}, s, { round: s.restanti }); delete x.restanti; state.supporti.push(x); });
    delete state.statiInSospeso;
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
      if ((esito === 'vittoria' || esito === 'resa') && sc.incontro) {
        applyEffects(state, content, sc.incontro.vittoria, 'vittoria:' + sc.id, applied);
        // testo della vittoria dichiarato nella scena, come quello della sconfitta
        if (inc.fonte === 'scena') ev.testoVittoria = sc.incontro.vittoria_testo || null;
      }
      // testo della fuga dichiarato nella scena (`incontro.fuga.testo`): porta i fatti che la scena racconta anche a chi fugge
      if (esito === 'fuga' && inc.fonte === 'scena' && sc.incontro && sc.incontro.fuga) ev.testoFuga = sc.incontro.fuga.testo || null;
      state.flags['incontro_' + state.scena + '_concluso'] = esito;
      // rientro: lo scontro lasciato a metà si conserva, ogni altro esito lo chiude
      const chiave = inc.chiave || chiaveIncontro(state, content, inc.nemicoId);
      ev.chiaveIncontro = chiave;
      if (esito === 'fuga' || esito === 'nemico_fuggito') conservaIncontro(state, chiave, inc);
      else if (state.incontriSospesi) delete state.incontriSospesi[chiave];
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
    if (esito === 'fuga') sospendiStati(state, inc);
    state.incontro = null;
    state.supporti = [];
    boostFineScontro(state, applied);
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
      ev.testoFisso = gx(state, TESTO_CRUDELTA);
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
    if (!inFinestra(state, ob)) return { ok: false, tipo: 'rifiuto', motivo: 'Ti manca ancora un elemento per tentarlo.' };
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
    const check = provaVolontaria({ dice, sheet: schedaConBonus(state), trait: v.trait, nc: ob.nc, difficolta: state.difficolta, mod: v.mod + modScena }, 'obiettivo', [{ nome: 'approccio e oggetto', valore: v.mod }, { nome: 'vantaggio di scena', valore: modScena }]);
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
    // Approvata dall'autore il 5/11/2026 (registro della prova, turno 7; resta un fallimento, cambia solo il testo): il testo di fallimento di un obiettivo racconta di solito che la cosa
    // non si trova («c'è soltanto il prato»). Se in questa scena il personaggio l'ha già vista con un esame riuscito (almeno due parole
    // della cosa, o l'unica che c'è), quel testo contraddirebbe ciò che è accaduto: si usa un fallimento neutro (i testi neutri degli atti,
    // già proposti per «scalare»). Cercato prima in resolveAction, azioneAperta e TESTI_AZIONE: non c'era nessuna regola per questo caso.
    const visto = it && it.scena === state.scena ? it.percepito || [] : [];
    const cosa = roots(ob.testo).slice(1);
    if (/fallimento/.test(esito) && ev.riserva && visto.length && cosa.length && cosa.filter(r => visto.indexOf(r) !== -1).length >= Math.min(2, cosa.length)) {
      ev.riserva = generica(state, 'obiettivo:gia_visto', TESTI_AZIONE.scalare.contro, ev.n); ev.giaVisto = true;
    }
  }

  /* ------------------------------------------------------ API principale */

  function makeEvent(state, cmd) {
    const ev = { n: state.eventi.length + 1, commandId: cmd.id, tipo: cmd.tipo, scena: state.scena, sorgente: cmd.sorgente || null, testo: cmd.testo || null, ts: null, effetti: [], narrazione: null };
    // il messaggio intero del giocatore, mai modificato (contratto §5.2): cmd.testo resta la parte agita o il testo instradato
    if (cmd.testoGiocatore) ev.testoGiocatore = String(cmd.testoGiocatore);
    return ev;
  }

  function threatFirst(state, content, cmd) {
    const it = state.interazione;
    if (!it || it.modo !== 'semi' || it.scena !== state.scena || !it.incontroInAttesa || it.sceltaIncontro) return false;
    if (cmd.tipo === 'scelta') { const pos = IM() && IM().possibilita(state, content).scelte[cmd.sceltaId]; return !pos || pos.ok; }
    if (cmd.tipo === 'azione') { const ob = cmd.proposta && cmd.proposta.obiettivo; const pos = IM() && ob && IM().possibilita(state, content).obiettivi[ob]; return !!ob && (!pos || pos.ok); }
    return false;
  }

  /* ------------------------------------------------ azioni aperte

     Un'azione scritta dal giocatore (RMSoloAzioni: atto, bersaglio, tratto nominato, condizioni già verificate sull'inventario) si
     risolve con una prova delle regole esistenti. Se la scena descrive un passo (interazioni.scene.<id>.passi: bersaglio, atto, tratti,
     nc, esiti per livello, apre) l'esito è il suo; altrimenti una conseguenza generica coerente con l'atto. Mai effetti inventati:
     cure e riparazioni non cambiano lo stato oltre ciò che gli oggetti e i contenuti prevedono. */
  const LIVELLI_ESITO = { successo_critico: ['critico', 'pieno', 'successo'], successo_pieno: ['pieno', 'successo'], successo: ['successo'], fallimento_critico: ['fallimento_critico', 'fallimento'], fallimento: ['fallimento'] };
  /* PROPOSTA DA APPROVARE. Repertorio delle frasi generiche del motore per le azioni senza passo di scena (tutte le storie). Ogni lista è
     usata senza ripetizioni nella stessa partita finché non è esaurita (generica, state.repertorio). {N} = nome del PNG bersaglio.
     Nessun genere per il protagonista, nessun pronome per i PNG. Le frasi «ponte» introducono un dato concreto della scena: il successo
     racconta che cosa hai notato, mai una frase vaga. */
  const TESTI_AZIONE = {
    muoversi: ['Fai qualche passo, ma per ora la situazione ti tiene qui.', 'Ti sposti di poco: da qui non si va ancora da nessuna parte.', 'Provi ad allontanarti, ma qualcosa ti trattiene ancora.', 'Cambi posizione, e intorno a te non cambia niente.'],
    ponte: {
      luogo: ['Guardi meglio, un dettaglio alla volta, e lo noti:', 'Ti prendi il tempo che serve, e qualcosa salta all\'occhio:', 'Non ti fermi alla prima impressione, e fai bene:',
        'A guardare con calma, emerge un particolare:', 'Ti avvicini quanto basta per vederlo:', 'Il dettaglio era lì, bastava cercarlo:',
        'Passi lo sguardo da un punto all\'altro, finché non lo trovi:', 'Con un po\' di pazienza, il posto ti racconta qualcosa:',
        'C\'è un particolare che a un\'occhiata distratta sfuggirebbe:', 'Ti basta un attimo di attenzione in più:', 'Lo sguardo si ferma su una cosa sola:', 'Da vicino, le cose cambiano:'],
      png: ['Osservi {N} con attenzione, e noti questo:', 'Guardi {N} un momento più a lungo del solito:', 'Tieni d\'occhio {N} senza dare nell\'occhio:',
        'Ti bastano pochi istanti a osservare {N}:', 'Segui i gesti di {N} con attenzione:', 'Studi {N} da vicino, senza fretta:', 'Uno sguardo attento a {N} basta:',
        'Non perdi di vista {N}:', 'Guardi {N} con l\'occhio di chi sa cosa cercare:', 'Ti soffermi su {N}, sulle mani, sul modo di stare:']
    },
    esaminare: { pro: ['Guardi con calma, e ogni cosa trova il suo posto.', 'Quello che prima era confuso ora ha una forma.', 'Metti in fila quello che vedi, un pezzo alla volta.'],
      contro: ['Più guardi, più i dettagli si confondono.', 'La luce è sbagliata, o forse la fretta: perdi il filo.', 'Ti sembra di vedere qualcosa, poi l\'impressione svanisce.',
        'Gli occhi ti tradiscono: tutto sembra uguale a tutto.', 'Il particolare che cercavi resta nascosto.', 'Qualcosa ti sfugge, e lo sai.'],
      controN: ['{N} se ne accorge e si chiude.', 'Lo sguardo di {N} ti sfugge.', '{N} si volta proprio quando stai per capirci qualcosa.', '{N} non lascia trasparire niente.',
        'Da qui, {N} è impossibile da leggere.', '{N} intercetta il tuo sguardo prima che tu possa distoglierlo.'] },
    cercare: { pro: ['Frughi palmo a palmo, senza lasciare angoli scoperti.', 'Rovisti con metodo.', 'Sposti, sollevi, rimetti a posto.'],
      contro: ['Cerchi in fretta e metti tutto sottosopra.', 'Le mani corrono troppo: sposti, rovesci, e quello che cerchi finisce sotto il resto.', 'Frughi ovunque tranne che nel punto giusto.',
        'Fai più rumore del necessario, e non trovi niente.', 'Ogni angolo sembra uguale all\'altro.'] },
    curare: { pro: ['Ti medichi in fretta, ma bene.', 'Stringi la fasciatura, e il dolore si fa sopportabile.', 'Fai quello che serve, e il peggio passa.'],
      proN: ['Le tue mani sanno che cosa fare: il respiro di {N} si fa più regolare.', 'Lavori con mani ferme, e {N} smette di trattenere il fiato.', 'Pulisci, stringi, fissi: il peggio è passato, e {N} se ne accorge.',
        'Il dolore di {N} allenta la presa, poco alla volta.', 'Quando hai finito, {N} riesce a muoversi senza una smorfia.', 'Una medicazione stretta, fatta bene: {N} respira meglio.'],
      contro: ['Le dita non trovano il punto giusto, e il dolore resta dov\'era.', 'La fasciatura non tiene.', 'Il dolore non passa.'],
      controN: ['Le dita non trovano il punto giusto: {N} trattiene un gemito, e il dolore resta.', 'La fasciatura scivola, e {N} stringe i denti.', '{N} si ritrae al primo tocco: così non va.',
        'Il gesto è troppo brusco, e {N} impallidisce.', 'Non riesci a fermare il dolore di {N}: serve altro.'],
      niente: ['{N} non ha ferite né segni di malessere: non c\'è niente da curare.', 'Ti avvicini per medicare {N}, ma non c\'è niente da curare.',
        'A un primo sguardo da medico, {N} sta bene: nessuna ferita, nessun malessere.', '{N} non ha bisogno di cure: nessuna ferita da trattare.'],
      nienteSe: ['Non hai ferite da curare: stai bene.', 'Ti controlli in fretta: nessuna ferita, niente da curare.', 'Non c\'è niente da medicare: nessun graffio.'] },
    riparare: { pro: ['Il pezzo torna al suo posto con uno scatto, e regge.', 'Stringi, aggiusti, provi di nuovo: alla fine tiene.', 'Trovi il punto che non andava e lo sistemi.',
        'Una vite, una fascetta, un colpo secco: funziona di nuovo.', 'Ci vuole più del previsto, ma alla fine il meccanismo riparte.', 'Rimetti in sesto quello che si era allentato.'],
      contro: ['Qualcosa si incastra storto e stride.', 'Il pezzo non vuole saperne, e nel tentativo qualcosa si allenta.', 'Una vite gira a vuoto.',
        'Peggio di prima: adesso perde anche da un\'altra parte.', 'Ti manca la mano giusta, o il pezzo giusto.'] },
    convincere: { pro: ['Le tue parole arrivano dove dovevano: chi ti ascolta adesso è più disposto a seguirti.', 'Il brusio si spegne: ora ti ascoltano.', 'Qualcuno annuisce, poi un altro.', 'Le obiezioni si fanno più deboli.'],
      proN: ['{N} ti ascolta fino in fondo, senza interromperti.', '{N} annuisce piano: le tue ragioni hanno fatto presa.', 'Qualcosa nello sguardo di {N} si ammorbidisce.',
        '{N} ci pensa su, poi accetta con un cenno.', 'La diffidenza di {N} cede il passo a qualcosa di simile alla fiducia.', '{N} smette di cercare una via d\'uscita e ti guarda dritto.',
        '{N} lascia cadere le braccia lungo i fianchi: almeno su questo, ti dà ragione.', '{N} sospira, poi fa un passo verso di te.'],
      contro: ['Le parole cadono nel vuoto, e il silenzio che segue pesa.', 'Insisti, e ottieni solo diffidenza.', 'Nessuno ti segue.', 'Qualcuno sorride, ma non per te.'],
      controN: ['{N} incrocia le braccia: per ora non c\'è verso.', '{N} ti guarda come si guarda chi vuole qualcosa, e si chiude.', '{N} ascolta, ma non cambia idea.',
        '{N} sbuffa e guarda altrove.', 'Ogni tua ragione rimbalza su {N}.', '{N} lascia cadere il discorso come se non l\'avessi mai cominciato.'] },
    intimidire: { pro: ['Nessuno ribatte.', 'Il silenzio che segue è tutto tuo.', 'Più di uno sguardo si abbassa.', 'Chi stava per parlare ci ripensa.'],
      proN: ['{N} abbassa lo sguardo per primo.', '{N} deglutisce e fa un mezzo passo indietro.', 'La voce di {N} si fa più bassa.', '{N} non ribatte.',
        '{N} si irrigidisce e smette di discutere.', 'Le mani di {N} si fermano a mezz\'aria.'],
      contro: ['Il tuo tono non spaventa nessuno.', 'Alzi la voce, ma il gesto resta a metà.', 'Qualcuno ride, a mezza voce.'],
      controN: ['{N} regge il tuo sguardo e non arretra di un passo.', '{N} sorride appena, senza allegria.', '{N} ti fissa a sua volta, più a lungo di te.',
        'La minaccia scivola addosso a {N}.', '{N} fa un passo avanti invece che indietro.'] },
    nascondersi: { pro: ['L\'ombra ti copre bene: da qui vedi tutto senza che nessuno ti noti.', 'Trovi il punto giusto, fra luce e buio.', 'Ti rannicchi dietro il riparo, e il respiro rallenta.',
        'Nessuno guarda dalla tua parte.', 'Resti fuori dalla luce, immobile.', 'Il rumore intorno copre i tuoi passi.'],
      contro: ['Un passo di troppo, un rumore: qualcuno si volta dalla tua parte.', 'Il riparo è peggio di come sembrava.', 'La luce ti raggiunge proprio mentre ti muovi.',
        'Qualcosa cade, e il rumore rimbalza ovunque.', 'Non c\'è un angolo davvero buio.'] },
    forzare: { pro: ['Cede con uno schiocco secco.', 'Spingi con tutto il peso, e alla fine si arrende.', 'Un ultimo strattone, e si apre.', 'Fa resistenza, poi cede di colpo.',
        'Il metallo geme, poi si piega.', 'Ci metti la spalla, e alla fine passa.'],
      contro: ['Resiste, e lo sforzo ti lascia il fiato corto.', 'Non si muove di un dito, e il rumore si è sentito.', 'Ti fa male la spalla, ma non cede.', 'Scricchiola, e basta.',
        'Più spingi, più sembra piantato nel terreno.'] },
    manipolare: { pro: ['Si muove come volevi, con un cigolio lento.', 'Ci vuole pazienza, ma alla fine risponde ai tuoi gesti.', 'Scatta al primo tentativo.', 'Lo sposti quanto basta.',
        'Trovi il verso giusto, e gira.', 'Fa quello che deve, senza sorprese.'],
      contro: ['Si blocca a metà, con un rumore che non ti piace.', 'Non risponde come volevi.', 'Gira a vuoto.', 'Ti scivola di mano.', 'Si inceppa.'] },
    hackerare: { pro: ['Il sistema cede un varco, per qualche istante.', 'Una protezione dopo l\'altra si spegne, in silenzio.', 'Trovi la porta lasciata socchiusa da qualcuno prima di te.',
        'Il codice si piega al tuo.', 'Lo schermo cambia colore: sei dentro.', 'Nessun allarme: il sistema non si accorge di te.'],
      contro: ['Il sistema ti respinge, e da qualche parte qualcosa registra il tentativo.', 'Il varco si richiude prima che tu possa passare.', 'Una schermata rossa, poi niente.',
        'Il codice non regge.', 'L\'accesso ti viene negato.'] },
    usare: { pro: ['Funziona come speravi.', 'Fa il suo lavoro, senza sorprese.', 'Risponde subito.', 'Va come doveva andare.'],
      contro: ['Non funziona come speravi.', 'Qualcosa va storto a metà.', 'Niente da fare.'] },
    // PROPOSTA DA APPROVARE (5/11/2026, riscritti): testi degli atti «scalare», «saltare» e «sopravvivere» (RMSoloAzioni). Dicono solo se
    // riesce: nessuna causa inventata (appigli che cedono, materiale umido, vento), nessuna perizia sottintesa (la prova può riuscire
    // anche senza competenza) e, nel fallimento, nessuna decisione del protagonista, movimento già fatto o conseguenza non data dal motore.
    scalare: { pro: ['Ci arrivi.', 'Ce la fai.', 'Raggiungi il punto che volevi.'],
      contro: ['Non ci riesci.', 'Il tentativo non riesce.', 'Non trovi il modo di farlo.'] },
    saltare: { pro: ['Il salto riesce.', 'Con un balzo ci arrivi.', 'Arrivi dove volevi.'],
      contro: ['Il salto non riesce.', 'Non ci riesci.', 'Non trovi il modo di farlo.'] },
    sopravvivere: { pro: ['Ci vuole un po\', ma alla fine funziona.', 'Ce la fai: ora regge.', 'Funziona.'],
      contro: ['Non funziona.', 'Ci provi, ma non regge.', 'Per ora non ci riesci.'] },
    giaProvato: ['Ci hai già provato in questo modo, e non ha funzionato: serve un\'altra strada.', 'Lo stesso tentativo di prima darebbe lo stesso risultato.',
      'Così non ha funzionato una volta, e non funzionerà adesso.']
  };
  // nome di un PNG senza parentesi
  const nomeBreve = (content, id) => String(pngName(content, id)).replace(/\s*\([^)]*\)/g, '').trim();
  /* Una frase di una lista generica che non è ancora uscita in questa partita (state.repertorio); a lista esaurita si ricomincia.
     La scelta dipende dall'evento (sale): stessa partita, stesso testo. */
  function generica(state, chiave, lista, sale) {
    if (!lista || !lista.length) return '';
    state.repertorio = state.repertorio || {};
    let usate = state.repertorio[chiave] = (state.repertorio[chiave] || []).filter(i => i < lista.length);
    if (usate.length >= lista.length) usate = state.repertorio[chiave] = [];
    const libere = lista.map((x, i) => i).filter(i => usate.indexOf(i) === -1);
    const i = libere[Math.abs(sale || 0) % libere.length];
    usate.push(i);
    return lista[i];
  }
  function testoAzione(state, atto, ok, nome, n, tipo) {
    const t = TESTI_AZIONE[atto] || TESTI_AZIONE.esaminare;
    const k = tipo || ((ok ? 'pro' : 'contro') + (nome && t[(ok ? 'pro' : 'contro') + 'N'] ? 'N' : ''));
    return generica(state, 'azione:' + (TESTI_AZIONE[atto] ? atto : 'esaminare') + ':' + k, t[k], n).replace(/\{N\}/g, nome || '');
  }
  // passo di scena adatto all'atto e al bersaglio (png, punto o parole), non ancora concluso
  function trovaPasso(state, content, def, it, cmd, quando) {
    const stems = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(w => w.length >= 5 && !/^(della|delle|degli|dello|dalla|dalle|nella|nelle|negli|nello|sulla|sulle|sugli|sullo|alla|alle|agli|allo|quel|quella|quello|questo|questa|verso|dentro|fuori|sopra|sotto|molto|ancora|prima|dopo)$/.test(w)).map(w => w.slice(0, 5));
    const mine = stems(cmd.testo);
    return (def.passi || []).find(p => {
      if (p.atto !== cmd.atto || ((it.passi || {})[p.id] || {}).fatto || (state.beatsFatti || []).indexOf(p.id) !== -1) return false;
      if (finestra(state, p) !== (quando || 'aperta')) return false;
      const b = p.bersaglio || {};
      if (b.png) return b.png === cmd.png;
      const parole = b.parole ? [].concat(b.parole).reduce((a, x) => a.concat(stems(x)), []) : stems(String(((allPoints(def, it).find(x => x.id === b.punto) || {}).testo) || '').replace(/^\s*\S+\s*/, ''));
      return parole.some(w => mine.indexOf(w) !== -1);
    }) || null;
  }

  // PROPOSTA DA APPROVARE: l'appiglio quando il giocatore gira a vuoto e la scena non ha né iniziative d'autore né dati nuovi (nessun fatto:
  // un gesto verso ciò che resta da fare, che compare fra le azioni proposte)
  const SPINTA_SENZA_DATI = {
    png: ['{N} ti cerca con lo sguardo, come se avesse qualcosa da dirti.', '{N} si schiarisce la voce e fa un passo verso di te.', '{N} ti si avvicina, poi esita a metà strada.',
      '{N} apre la bocca per parlare, poi aspetta che tu te ne accorga.', '{N} ti fa segno di avvicinarti.', '{N} tossisce piano, per attirare la tua attenzione.'],
    gesto: ['{N} ti fa un cenno, come a dire che qui non avete ancora finito.', '{N} incrocia il tuo sguardo, poi si guarda intorno: c\'è ancora qualcosa da vedere.',
      '{N} indica con il mento un punto alle tue spalle.', '{N} si sposta di lato, come per lasciarti vedere meglio.', '{N} batte le dita su un bordo, impaziente.', '{N} guarda nella stessa direzione per la seconda volta.'],
    luogo: ['Un rumore ti fa voltare: qui non hai ancora visto tutto.', 'Qualcosa, ai margini dello sguardo, attira la tua attenzione.', 'Un movimento, appena percettibile, in un angolo.',
      'Uno scricchiolio rompe il silenzio, poco lontano.', 'L\'aria cambia, come se qualcosa si fosse spostato.', 'Un riflesso, per un istante, dove prima non c\'era.']
  };
  // PROPOSTA DA APPROVARE: lo stallo di una scena senza testi né dati di scena (nessun fatto, solo il tempo che passa)
  const STALLO_SENZA_DATI = ['Passa qualche minuto, e nessuno rompe il silenzio.', 'Per un po\' non succede niente, e il silenzio comincia a pesare.',
    'I minuti si allungano.', 'Qualcuno si muove, poi torna fermo.', 'Il silenzio si fa più denso.', 'Il tempo passa, e nessuno sembra notarlo.', 'Una pausa lunga, senza parole.'];
  /* Testi già letti dal giocatore (racconti degli eventi e aperture delle scene visitate), normalizzati in un'unica stringa: una frase
     dei dati che vi compare non si riusa come informazione nuova. */
  function giaLetto(state, content) {
    const parti = [];
    (state.eventi || []).forEach(e => { if (e.narrazione && e.narrazione.testo) parti.push(normPar(e.narrazione.testo)); });
    parti.push(normPar(sceneOpeningText(state, content, state.scena)));
    return ' ' + parti.join(' ') + ' ';
  }
  const fraseNuova = (letto, t) => { const k = normPar(t); return !!k && letto.indexOf(' ' + k + ' ') === -1 && letto.indexOf(k) === -1; };
  // una frase dei dati è adatta al giocatore se non svela segreti né lessico ancora bloccato e non è una formula di servizio
  function fraseSicura(state, content, t) {
    if (!t || FRASI_DI_SERVIZIO.some(re => re.test(t)) || testoInterno(t)) return false;
    const v = validateNarration(state, content, { scena: state.scena, effetti: [] }, t);
    return v.problems.every(p => !/^(segreto|lessico|contraddice):/.test(p));
  }
  /* Dettaglio del luogo per il racconto, solo dai contenuti della scena: i dettagli percepibili (prima quelli notati all'ingresso; con
     tutti=true anche gli altri, come premio di un esame riuscito), poi le frasi d'ambiente dei testi liberi della scena (senza le frasi che
     dicono che cosa fa il protagonista). Mai una frase già letta. */
  // radici per dire se un dettaglio riguarda ciò su cui si è agito: senza le parole che compaiono ovunque («tutti», «ancora», «qualcosa»…)
  const PAROLE_COMUNI = ['tutti', 'tutto', 'tutte', 'sempr', 'ancor', 'molto', 'prima', 'dopo', 'qualc', 'quand', 'mentr', 'verso', 'dentr', 'fuori',
    'sopra', 'sotto', 'nient', 'nulla', 'altro', 'altri', 'ognun', 'ogni', 'poco', 'tanto', 'meglio', 'megli', 'davan', 'dietr', 'accan', 'intor'];
  const radiciPertinenza = t => radici(t).filter(w => PAROLE_COMUNI.indexOf(w) === -1);
  function dettaglioLuogo(state, content, opz) {
    const o = opz || {};
    const letto = o.letto || giaLetto(state, content);
    const usati = o.esclusi || [];
    const cand = [];
    const d = SCN() && SCN().datiScena(content, state.scena);
    if (d) {
      const notati = SCN().notati(state, content);
      const perc = (d.percepibili || []).filter(p => inFinestra(state, p));
      perc.forEach(p => { if (notati.indexOf(p.testo) !== -1) cand.push(p.testo); });
      if (o.tutti) perc.forEach(p => { if (cand.indexOf(p.testo) === -1) cand.push(p.testo); });
    }
    const def = sceneInteractions(content, state.scena);
    if (def) [].concat(testiInFinestra(state, def.dettagli), def.riserve_libere || [], def.riserva_libera || []).forEach(t => String(t || '').split(/(?<=[.!?…])\s+(?=[A-ZÀ-Ú«])/).forEach(f => {
      // «Resti…», «Ti prendi il tempo…»: azioni del protagonista, non dettagli del luogo
      // «In piazza nessuno ti risponde: …» è la risposta di ripiego a una domanda, non un dettaglio del luogo (prova della Cavaliera, B12)
      if (/nessuno ti rispond/i.test(String(f || ''))) return;
      if (f && !/^(resti|rimani|ti |torni|guardi|ascolti|cerchi|aspetti|osservi|passi|segui|stai)\b/i.test(f.trim()) && /[.!?…»]$/.test(f.trim())) cand.push(f.trim());
    }));
    // o.contesto: il testo della risposta in costruzione; un dettaglio quasi uguale a ciò che dice già non si aggiunge
    const ripete = t => !!o.contesto && frasiQuasiUguali(o.contesto + ' ' + t).some(c => c.a === t || c.b === t);
    // o.pertinenteA: il testo dell'azione; il dettaglio vale solo se riguarda ciò su cui si è agito (radici in comune)
    const azione = o.pertinenteA ? radiciPertinenza(o.pertinenteA) : null;
    const pertinente = t => !azione || radiciPertinenza(t).some(w => azione.indexOf(w) !== -1);
    return cand.find(t => usati.indexOf(t) === -1 && fraseNuova(letto, t) && !ripete(t) && pertinente(t) && fraseSicura(state, content, t)) || null;
  }
  /* Le frasi dei testi della scena che parlano di un PNG (nome, alias): ciò che di lui si vede, solo dai dati (prova della Cavaliera,
     B07/A17 per le domande descrittive, A08 per l'osservazione riuscita). */
  function frasiSuPng(state, content, def, id) {
    const p = id && content.png[id];
    if (!p) return [];
    const chiavi = [p.nome].concat(global.RMSoloAzioni && global.RMSoloAzioni.aliasPng ? global.RMSoloAzioni.aliasPng(state, content, id) : [], p.alias || [])
      .map(x => String(x || '').toLowerCase().replace(/^(il|lo|la|l'|i|gli|le)\s*/, '').trim()).filter(x => x.length >= 4);
    const sc = currentScene(state, content), d = def || {};
    const testi = [sc && sc.apertura_riserva].concat(testiInFinestra(state, d.dettagli) || [], ...['esplora', 'punti', 'percepibili'].map(k => (d[k] || []).map(x => x.riserva || x.testo)));
    const frasi = [];
    testi.filter(Boolean).forEach(t => String(t).split(/(?<=[.!?…])\s+/).forEach(f => { const l = f.toLowerCase(); if (chiavi.some(k => l.indexOf(k) !== -1) && frasi.indexOf(f) === -1) frasi.push(f); }));
    return frasi;
  }
  /* Dove si trova e che cosa fa un PNG presente, dai dati di ingresso della scena: «Nome, posizione, attività.» */
  function situazionePng(state, content, id, opz) {
    const o = opz || {};
    const d = SCN() && SCN().datiScena(content, state.scena);
    const x = d && d.png && d.png[id];
    if (!x || !x.attivita || !content.png[id] || !inFinestra(state, x)) return null;
    const t = nomeBreve(content, id) + (x.posizione ? ', ' + String(x.posizione).replace(/[.]+$/, '') : '') + ', ' + String(x.attivita).replace(/[.]+$/, '') + '.';
    return fraseNuova(o.letto || giaLetto(state, content), t) && fraseSicura(state, content, t) ? t : null;
  }

  /* Successo senza passo di scena: qualcosa di concreto, dai soli dati esistenti. Esame e ricerca: il punto della scena cercato, altrimenti
     il dettaglio notato (percepibili del luogo, posizione e attività del PNG) introdotto da una frase ponte. Parole: la reazione del bersaglio
     (prima la sua voce d'autore, png.<id>.reazioni.successo, scelta fra le righe dentro la loro finestra). Gesti con le mani: l'effetto
     dell'atto, ciò che si vede da lì o il passo più vicino. Nessun ±1 sulla prova dopo (decisione dell'autore del 29/10, DECISIONI_AUTORE §2:
     ogni tiro dipende solo da dado e scheda); senza dettaglio né passo il dono è l'esito raccontato ('esito'). Ritorna { testo, progresso }. */
  function donoSuccesso(state, content, def, it, cmd, nome, ev, apriPunto, applied) {
    const letto = giaLetto(state, content);
    const g = tipo => testoAzione(state, cmd.atto, true, nome, ev.n, tipo);
    const punto = () => {
      if (!it || !def) return null;
      const req = requiredBeats(def, it), cand = allPoints(def, it).filter(x => pointAvailable(state, x) && !altraParte(state, content, x)); // B01: mai lo spettacolo in piazza da casa
      const p = cand.find(x => req.indexOf(x.id) !== -1) || cand[0];
      if (!p) return null;
      ev.dono = 'passo';
      return apriPunto(p) || p.testo;
    };
    const datoLuogo = () => dettaglioLuogo(state, content, { tutti: true, letto });
    // osservare un PNG racconta lui, non il luogo (A08: il successo descriveva solo la folla)
    // in mancanza d'altro, il ruolo dei dati («Il burattinaio della compagnia Marcel, allegro e allusivo»): ciò che di lui si capisce guardandolo
    const ruoloPng = () => { const r = cmd.png && content.png[cmd.png] && String(content.png[cmd.png].ruolo || '').replace(/[.]+$/, ''); const t = r ? r + '.' : null; return t && fraseNuova(letto, t) && fraseSicura(state, content, t) ? t : null; };
    const datoPng = () => cmd.png ? situazionePng(state, content, cmd.png, { letto }) || frasiSuPng(state, content, def, cmd.png).filter(f => fraseNuova(letto, f) && fraseSicura(state, content, f)).pop() || ruoloPng() : null;
    // dopo i due punti la minuscola solo per una parola comune (articolo, preposizione…), mai per un nome proprio
    const minuscola = d => /^(Il|Lo|La|L'|I|Gli|Le|Un|Uno|Una|Un'|Nessun\w*|Sul\w*|Sui|Nel\w*|Nei|Dal\w*|Dai|Al\w*|Ai|Ogni|Qualcuno|Qualcosa|Tutto|Tutti|Tutte|Da|Di|In|Su|Per|Con|Fra|Tra|Dove|Quando|Sotto|Sopra|Accanto|Dietro|Davanti|Poco|Molti|Alcuni|Due|Tre|Quattro|C'è|Ci)\b/.test(d) ? d.charAt(0).toLowerCase() + d.slice(1) : d;
    // «Il burattinaio» dentro la frase: articolo minuscolo e preposizione articolata («a Il burattinaio» → «al burattinaio»)
    const PA = { a: { il: 'al ', lo: 'allo ', la: 'alla ', "l'": "all'", i: 'ai ', gli: 'agli ', le: 'alle ' }, di: { il: 'del ', lo: 'dello ', la: 'della ', "l'": "dell'", i: 'dei ', gli: 'degli ', le: 'delle ' } };
    const nomeIn = String(nome || '').replace(/^(Il|Lo|La|L'|I|Gli|Le)\b/, m => m.toLowerCase());
    const ponte = (chi, d) => generica(state, 'ponte:' + chi, TESTI_AZIONE.ponte[chi], ev.n).replace(/\{N\}/g, nomeIn).replace(/\b(a|di) (il |lo |la |i |gli |le |l')/g, (m, p, a) => PA[p][a.trim()]) + ' ' + minuscola(d);
    if (cmd.atto === 'esaminare' || cmd.atto === 'cercare') {
      if (!cmd.png) { const p = punto(); if (p) return { testo: p, progresso: true }; }
      const dp = datoPng(), d = dp || (cmd.png ? null : datoLuogo());
      if (d) { ev.dono = 'informazione'; return { testo: ponte(dp ? 'png' : 'luogo', d), progresso: true }; }
      const p = cmd.png ? null : punto(); if (p) return { testo: p, progresso: true };
      ev.dono = 'esito';
      return { testo: g(), progresso: false };
    }
    if (cmd.atto === 'convincere' || cmd.atto === 'intimidire') {
      // PROPOSTA DA APPROVARE (5/11/2026): una prova sociale riuscita fa dire al PNG ciò che l'autore gli ha già dato (un suo argomento
      // aperto, pertinente a ciò che si chiede), invece di un solo gesto. Nessuna informazione nuova: senza argomento pertinente vale la reazione.
      const dl = cmd.png && it && def && (def.dialoghi || []).find(x => x.png === cmd.png);
      const mem = dl && dialogMemory(it, cmd.png);
      const proprio = cmd.png ? radici(pngName(content, cmd.png)) : [];
      const chiede = radiciPertinenza(cmd.testo).filter(w => proprio.indexOf(w) === -1);
      const arg = dl && (dl.argomenti || []).find(a => mem.argomenti.indexOf(a.id) === -1 && inFinestra(state, a) && a.riserva &&
        radiciPertinenza(a.testo).some(w => chiede.indexOf(w) !== -1));
      if (arg) {
        mem.argomenti.push(arg.id);
        if (markBeat(state, arg.id, applied, 'dialogo', content)) mem.info.push(arg.id);
        applyInteractionEffects(state, content, arg.effetti, 'argomento:' + arg.id, applied);
        ev.dono = 'informazione'; ev.argomento = arg.id;
        return { testo: arg.riserva, progresso: true };
      }
      ev.dono = 'esito';
      const propria = cmd.png && testiInFinestra(state, (((content.png || {})[cmd.png] || {}).reazioni || {}).successo);
      return { testo: propria && propria.length ? generica(state, 'reazione:' + cmd.png + ':successo', propria, ev.n) : g(), progresso: false };
    }
    // curare, riparare, forzare, manipolare, nascondersi, hackerare, usare, sopravvivere: il dono è l'effetto dell'atto. Un dettaglio del
    // luogo o un passo di scena si aggiungono solo se riguardano ciò su cui si è agito (decisione dell'autore del 4/11/2026: riparare un
    // filtro non dice nulla delle impronte dei carri). Salire serve a vedere: da lassù il luogo è pertinente (scendere o calarsi no).
    const eff = g();
    const pertinenteA = cmd.atto === 'scalare' && !/\b(scend|mi calo|calarmi)/.test(cmd.testo) ? null : cmd.testo;
    const d = cmd.atto === 'curare' ? null : dettaglioLuogo(state, content, { tutti: true, letto, pertinenteA });
    if (d) { ev.dono = 'informazione'; return { testo: eff + ' ' + d, progresso: true }; }
    if (cmd.atto !== 'curare') {
      const azione = radiciPertinenza(cmd.testo);
      const p = it && def ? allPoints(def, it).filter(x => pointAvailable(state, x)).find(x => radiciPertinenza(x.testo).some(w => azione.indexOf(w) !== -1)) : null;
      // salire o saltare cambiano solo da dove si guarda: del passo si racconta ciò che da lì si vede e che riguarda l'azione (5/11/2026,
      // decisione dell'autore su E04). Le frasi in cui qualcuno ti parla, ti porta o ti incrocia presuppongono che tu sia altrove: restano al
      // passo, che non si consuma e arriva intero al suo momento.
      if (p && (cmd.atto === 'scalare' || cmd.atto === 'saltare')) {
        const visto = String(p.riserva || '').split(/(?<=[.!?…])\s+(?=[A-ZÀ-Ú«])/)
          .filter(f => !/«|\b(ti|te|tu|tuo|tua|tuoi|tue|vi|voi|vostr\w*|con te)\b/i.test(f) && radiciPertinenza(f).some(w => azione.indexOf(w) !== -1));
        if (visto.length) { ev.dono = 'informazione'; return { testo: eff + ' ' + visto.join(' '), progresso: true }; }
      } else if (p) { ev.dono = 'passo'; return { testo: eff + ' ' + (apriPunto(p) || p.testo), progresso: true }; }
    }
    ev.dono = 'esito';
    return { testo: eff, progresso: false };
  }
  /* Fallimento senza passo di scena: mai il nulla, la conseguenza resta nel racconto (un'informazione negativa). Nessun ±1 sulla prova
     dopo né pressione aggiunta (decisione dell'autore del 29/10, DECISIONI_AUTORE §2: le conseguenze di un tiro le racconta il regista). */
  function costoFallimento(state, content, def, it, cmd, nome, ev, applied) {
    ev.costo = 'informazione';
    const propria = cmd.png && ['convincere', 'intimidire'].indexOf(cmd.atto) !== -1 && testiInFinestra(state, (((content.png || {})[cmd.png] || {}).reazioni || {}).fallimento);
    return propria && propria.length ? generica(state, 'reazione:' + cmd.png + ':fallimento', propria, ev.n) : testoAzione(state, cmd.atto, false, nome, ev.n);
  }
  /* C'è qualcosa da curare? Solo se i dati lo dicono: un passo della scena sul PNG (curare o esaminare), oppure una ferita o un malessere
     nei testi della scena che lo riguardano (apertura e risposte del suo dialogo, posizione e attività nei dati di ingresso, appunti del Diario
     della scena). Altrimenti niente tiro. */
  const FERITE_RE = /\b(ferit|ferisc|sangu|sanguin|dolor|male\b|lussat|frattur|rott[oa] |bruciatur|ustion|zoppic|febbr|ammalat|malat|gemit|livid|ansim|pallid|tremant|svenut|sviene|tossisc)/i;
  function haDaCurare(state, content, def, id) {
    if ((def && def.passi || []).some(p => (p.bersaglio || {}).png === id && (p.atto === 'curare' || p.atto === 'esaminare'))) return true;
    const testi = [];
    const nome = normPar(primoNome(content, id));
    ((def && def.dialoghi) || []).filter(d => d.png === id).forEach(d => { testi.push(d.apertura, d.riserva_libera); (d.argomenti || []).forEach(a => testi.push(a.riserva)); });
    const ds = SCN() && SCN().datiScena(content, state.scena);
    const x = ds && ds.png && ds.png[id];
    if (x) testi.push(x.posizione, x.attivita);
    (state.note || []).filter(n => n.scena === state.scena && normPar(n.testo).indexOf(nome) !== -1).forEach(n => testi.push(n.testo));
    return testi.some(t => t && FERITE_RE.test(normPar(t)));
  }
  // atti a cui un oggetto può dare il bonus (bonusOggetto delle regole): proprietà degli oggetti del catalogo, parole generiche
  const PROPRIETA_ATTO = { curare: ['cura', 'medicazione', 'clinica', 'erbe'], riparare: ['riparazione', 'filtri'], manipolare: ['riparazione'] };
  /* Oggetto posseduto e adatto all'azione: quello della condizione («se ho X lo uso») o uno nominato nel testo. */
  function oggettoAdatto(state, content, cmd) {
    const adatto = id => { const d = id && itemInfo(state, content, id); return d && (d.proprieta || []).some(p => (PROPRIETA_ATTO[cmd.atto] || []).indexOf(p) !== -1) ? d : null; };
    if (cmd.oggetto && hasItem(state, cmd.oggetto) && adatto(cmd.oggetto)) return { id: cmd.oggetto, info: adatto(cmd.oggetto) };
    const rad = w => w.slice(0, 5);
    const testo = String(cmd.testo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(w => w.length > 2).map(rad);
    const it = (state.inventario || []).find(i => {
      if (!(i.qty > 0) || !adatto(i.id)) return false;
      const testa = String(adatto(i.id).nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/).filter(w => w.length > 2)[0];
      return testa && testo.indexOf(rad(testa)) !== -1;
    });
    return it ? { id: it.id, info: adatto(it.id) } : null;
  }
  // «una gemma di cura» → «Cerchi una gemma di cura, ma non ce n'è.»
  const frasiMancanti = (state, content, cmd) => (cmd.mancanti || []).map(x => 'Cerchi ' + String(x).trim().replace(/[.,;:]+$/, '') + ', ma non ce n\'è.');

  /* Legge 3, il pilastro anticipato (LEGGI_DELLA_REGIA.md §1 punto 3): un passo che è un pilastro (il suo id o il punto che apre stanno
     in `sblocco`) chiesto quando non è ancora il suo turno fa arrivare prima i beat che mancano (`richiede`, in ordine) come reazione dei
     PNG presenti: ognuno è un argomento di un PNG presente, dentro la sua finestra una volta arrivati quelli prima, e alla fine il passo è
     dentro la sua. Ritorna gli argomenti arrivati; se non si può, null (resta il tiro generico senza il fatto del pilastro, legge 2). */
  function anticipaPilastro(state, content, def, it, passo, applied) {
    const req = requiredBeats(def, it);
    if (req.indexOf(passo.id) === -1 && (!passo.apre || req.indexOf(passo.apre) === -1)) return null;
    const presenti = currentScene(state, content).png_presenti || [];
    const mancanti = [].concat(passo.richiede || []).filter(b => !beatFatto(state, b));
    const conFatti = n => Object.assign({}, state, { beatsFatti: (state.beatsFatti || []).concat(mancanti.slice(0, n)) });
    const voci = mancanti.map((id, i) => {
      const d = (def.dialoghi || []).find(x => presenti.indexOf(x.png) !== -1 && (x.argomenti || []).some(a => a.id === id));
      const a = d && d.argomenti.find(x => x.id === id);
      return a && finestra(conFatti(i), a) === 'aperta' ? { d, a } : null;
    });
    if (!mancanti.length || voci.some(v => !v) || finestra(conFatti(mancanti.length), passo) !== 'aperta') return null;
    return voci.map(({ d, a }) => {
      const m = dialogMemory(it, d.png);
      if (m.argomenti.indexOf(a.id) === -1) m.argomenti.push(a.id);
      if (markBeat(state, a.id, applied, 'dialogo', content)) m.info.push(a.id);
      if (a.atteggiamento) { m.atteggiamento += a.atteggiamento; applied.push({ tipo: 'atteggiamento', png: d.png, delta: a.atteggiamento, valore: m.atteggiamento }); }
      applyInteractionEffects(state, content, a.effetti, 'argomento:' + a.id, applied);
      return a;
    });
  }
  function azioneAperta(state, content, cmd, dice, applied, ev) {
    const def = sceneInteractions(content, state.scena);
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const A = global.RMSoloAzioni;
    if (!A || !cmd.atto) throw new SoloError('comando_non_valido', 'Azione non riconosciuta');
    ev.tipo = 'improvvisazione'; ev.libera = true; ev.testo = cmd.testo || null; ev.atto = cmd.atto;
    // il resto dell'intenzione del giocatore non si racconta: diventa una proposta fra le azioni (RMSoloScena)
    if ((cmd.restanti || []).length) ev.restanti = cmd.restanti.slice(0, 3);
    const righe = frasiMancanti(state, content, cmd);
    const nome = cmd.png ? primoNome(content, cmd.png) : null;
    const chiudi = (testo, progresso) => {
      ev.riserva = righe.concat(testo).filter(Boolean).join(' ');
      if (it) afterInteraction(state, content, applied, ev, !!progresso, true);
    };
    // oggetto adatto che il personaggio possiede: bonus dell'oggetto (regole: bonusOggetto) sulla prova; un consumabile usato su di sé si consuma
    const ogg = oggettoAdatto(state, content, cmd);
    let modOggetto = 0;
    if (ogg) {
      modOggetto = R().SOLO_TUNING.bonusOggetto;
      ev.oggettoUsato = { id: ogg.id, pertinente: true };
      righe.push('Ti aiuti con quello che hai: ' + String(ogg.info.nome).toLowerCase() + '.');
    } else if (cmd.oggetto) {
      const info = itemInfo(state, content, cmd.oggetto);
      if (info && info.tipo === 'consumabile' && info.effetto && !info.effetto.cariche_gemma && !cmd.png) { useItem(state, content, cmd.oggetto, applied, ev, cmd); righe.push(ev.riserva); }
    } else if ((cmd.mancanti || []).length && PROPRIETA_ATTO[cmd.atto]) {
      // chiesto un oggetto che non c'è: se nello zaino c'è qualcosa di adatto, il narratore lo fa notare (non lo usa al posto del giocatore)
      const alt = (state.inventario || []).map(i => i.qty > 0 && itemInfo(state, content, i.id)).find(d => d && (d.proprieta || []).some(p => PROPRIETA_ATTO[cmd.atto].indexOf(p) !== -1));
      if (alt) righe.push('Nello zaino, però, c\'è qualcosa che può servire: ' + String(alt.nome).toLowerCase() + '.');
    }
    if (it) it.passi = it.passi || {};
    let passo = it && def ? trovaPasso(state, content, def, it, cmd) : null;
    // legge 3: un pilastro chiesto prima del suo turno fa arrivare i beat che mancano (reazione dei PNG), poi si risolve
    const anticipato = !passo && it && def ? trovaPasso(state, content, def, it, cmd, 'presto') : null;
    const arrivati = anticipato ? anticipaPilastro(state, content, def, it, anticipato, applied) : null;
    if (arrivati) { passo = anticipato; ev.anticipati = arrivati.map(a => a.id); righe.unshift(...arrivati.map(a => a.riserva).filter(Boolean)); }
    // punto della scena corrispondente al testo (senza passo dichiarato): lo esegue la risposta di sempre dell'esplorazione
    if (!passo && it && def && !cmd.png && matchPoint(state, def, it, cmd.testo)) {
      interact(state, content, { tipo: 'esplora', libera: true, testo: cmd.testo, sorgente: 'testo' }, dice, applied, ev);
      if (righe.length) ev.riserva = righe.join(' ') + ' ' + (ev.riserva || '');
      ev.atto = cmd.atto;
      return;
    }
    // curare chi non ha niente da curare (secondo i dati della scena; per sé stessi, gli HP al massimo): niente tiro, il narratore lo dice
    // (l'oggetto non si usa e la ricerca di bende o kit non serve: le righe su oggetti e mancanze si tolgono)
    if (cmd.atto === 'curare' && !cmd.png && !passo && state.personaggio.hpCur >= state.personaggio.hpMaxTracked) {
      ev.nienteDaCurare = true; ev.riservaMotore = true; delete ev.oggettoUsato; righe.length = 0;
      chiudi(testoAzione(state, 'curare', true, null, ev.n, 'nienteSe'), false);
      return;
    }
    if (cmd.atto === 'curare' && cmd.png && !passo && !haDaCurare(state, content, def, cmd.png)) {
      ev.png = cmd.png; ev.pngNome = pngName(content, cmd.png); ev.nienteDaCurare = true; ev.riservaMotore = true; delete ev.oggettoUsato; righe.length = 0;
      chiudi([testoAzione(state, 'curare', true, nome, ev.n, 'niente'), situazionePng(state, content, cmd.png)].filter(Boolean).join(' '), false);
      return;
    }
    // spostarsi senza un passo o un obiettivo della scena: nessuna prova, la scena resta dov'è e il Narratore lo racconta
    if (cmd.atto === 'muoversi' && !passo) { ev.riservaMotore = true; chiudi(generica(state, 'azione:muoversi', TESTI_AZIONE.muoversi, ev.n), false); return; }
    const tratto = A.scegliTratto(state.personaggio, cmd.tratto, passo && passo.tratti ? passo.tratti : A.tratti(cmd.atto));
    const prec = passo && it.passi[passo.id];
    if (prec && (prec.falliti || []).indexOf(tratto) !== -1) { chiudi(generica(state, 'azione:giaProvato', TESTI_AZIONE.giaProvato, ev.n), false); return; }
    // domanda a un PNG con una voce di conoscenza pertinente: risponde la scheda (livello deciso dal tiro)
    if (!passo && cmd.png && it && CN() && ['esaminare', 'convincere', 'intimidire'].indexOf(cmd.atto) !== -1 && CN().seleziona(content, cmd.png, cmd.testo, { scena: state.scena, state })) {
      const m = dialogMemory(it, cmd.png);
      const cn = CN().rispondi({ state, content, png: cmd.png, m, testo: cmd.testo, dice, scena: state.scena, tratto: A.tratti(cmd.atto).indexOf(tratto) !== -1 ? tratto : null, tono: cmd.atto === 'intimidire' ? 'minaccia' : null });
      if (cn) {
        ev.png = cmd.png; ev.pngNome = pngName(content, cmd.png);
        ev.conoscenza = { voce: cn.voce, livello: cn.livello, gia: !!cn.gia, check: cn.check };
        if (cn.esito) ev.esito = cn.esito;
        if (cn.check) ev.check = cn.check;
        applyInteractionEffects(state, content, cn.effetti, 'conoscenza:' + cn.voce + ':' + ev.n, applied);
        ev.riservaMotore = true;
        beatDaConoscenza(state, content, (def.dialoghi || []).find(x => x.png === cmd.png), m, cn, applied);
        chiudi(cn.testo, cn.livello > 0 && !cn.gia);
        return;
      }
    }
    const check = provaVolontaria({ dice, sheet: schedaConBonus(state), trait: tratto, nc: passo ? passo.nc : undefined, difficolta: state.difficolta, mod: (it ? it.mod || 0 : 0) + modOggetto }, 'azione', [{ nome: 'vantaggio di scena', valore: it ? it.mod || 0 : 0 }, { nome: 'oggetto adatto', valore: modOggetto }]);
    const ok = R().isSuccess(check.esito);
    ev.check = check; ev.esito = ok ? 'successo' : 'fallimento'; ev.obiettivoTesto = cmd.testo;
    // ciò che il personaggio ha visto bene in questa scena (esaminare o cercare riusciti): l'intero messaggio, tolto ciò che rifiuta
    if (ok && it && (cmd.atto === 'esaminare' || cmd.atto === 'cercare')) it.percepito = Array.from(new Set((it.percepito || []).concat(roots(senzaNegati(cmd.contesto || cmd.testo)))));
    if (cmd.png) { ev.png = cmd.png; ev.pngNome = pngName(content, cmd.png); }
    // apre un punto della scena come se fosse stato eseguito (beat, effetti, testo d'autore)
    const apriPunto = p => {
      it.fatte.push(p.id);
      markBeat(state, p.id, applied, 'azione_libera', content);
      applyInteractionEffects(state, content, p.effetti, 'punto:' + p.id, applied);
      ev.punto = p.id; ev.puntoTesto = p.testo;
      return p.riserva;
    };
    if (!passo) {
      ev.riservaMotore = true;
      // legge 2: un passo sullo stesso bersaglio che non è ancora il suo momento (richiede, fase) non si racconta con il tiro generico.
      // L'esito resta concreto ma è quello di chi osserva il bersaglio (dettaglio, vantaggio), mai l'effetto dell'atto; arrivato il momento vale il passo
      const inAttesa = it && def ? trovaPasso(state, content, def, it, cmd, 'presto') : null;
      if (inAttesa) ev.primaDelMomento = inAttesa.id;
      const cmdEsito = inAttesa ? Object.assign({}, cmd, { atto: 'esaminare' }) : cmd;
      if (ok) { const d = donoSuccesso(state, content, def, it, cmdEsito, nome, ev, apriPunto, applied); chiudi(d.testo, d.progresso); }
      else chiudi(costoFallimento(state, content, def, it, cmdEsito, nome, ev, applied), false);
      return;
    }
    const st = it.passi[passo.id] = prec || { tentativi: 0, falliti: [], fatto: false };
    st.tentativi += 1;
    const livelli = LIVELLI_ESITO[check.esito] || ['fallimento'];
    const e = livelli.map(l => (passo.esiti || {})[l]).find(Boolean) || (passo.esiti || {})[ok ? 'successo' : 'fallimento'] || {};
    ev.passo = passo.id;
    let testo = e.testo != null ? e.testo : testoAzione(state, cmd.atto, ok, nome, ev.n);
    let progresso = false;
    if (ok) {
      st.fatto = true; progresso = true;
      markBeat(state, passo.id, applied, 'azione_libera', content);
      const p = passo.apre && allPoints(def, it).find(x => x.id === passo.apre);
      if (p && it.fatte.indexOf(p.id) === -1) testo = [testo, apriPunto(p)].filter(Boolean).join(' ');
    } else if (st.falliti.indexOf(tratto) === -1) st.falliti.push(tratto);
    applyInteractionEffects(state, content, e.effetti, 'passo:' + passo.id + ':' + livelli[0], applied);
    chiudi(testo, progresso);
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
      const check = provaVolontaria({ dice, sheet: schedaConBonus(state), trait: req.tratto === 'nessuno' ? null : req.tratto, nc: undefined, difficolta: state.difficolta, mod: it ? it.mod || 0 : 0 }, 'improvvisazione', [{ nome: 'vantaggio di scena', valore: it ? it.mod || 0 : 0 }]);
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
    if (!strutturaMode(content)) {
      // scena con interazioni: il giocatore lascia la scena dall'uscita pronta (checkTransitions con voluta = true)
      if (!uscitaPronta(state, content)) throw new SoloError('azione_non_valida', 'Non puoi ancora lasciare questo luogo: qui c\'è altro da fare.');
      ev.tipo = 'prosegui';
      ev.decisione = false;
      return checkTransitions(state, content, dice, applied, true);
    }
    const r = ST().prosegui(state, content);
    if (!r.ok) throw new SoloError('azione_non_valida', r.motivo);
    ev.tipo = 'prosegui';
    ev.decisione = false;
    if (r.concludi) { concludeChapter(state, content, applied); return; }
    const sc = currentScene(state, content);
    applyEffects(state, content, r.uscita.effetti, 'uscita:' + sc.id + '>' + r.uscita.verso, applied, dice);
    if (oltreAtto(content, r.uscita.verso) && C().actComplete(state, content, state.atto)) { chiudiAtto(state, content, r.uscita.verso, applied); return; }
    if (enterScene(state, content, r.uscita.verso, dice, applied)) C().evaluateConsequences(state, content, applyEffects, applied, curEvent);
  }

  /* applyCommand: il solo modo di far avanzare la partita. */
  function applyCommand(stateIn, cmd, env) {
    if (!cmd || !cmd.id) throw new SoloError('comando_non_valido', 'Comando senza id');
    if (stateIn.comandi[cmd.id] != null) {
      return { state: stateIn, event: stateIn.eventi[stateIn.comandi[cmd.id] - 1], duplicate: true };
    }
    if (cmd.expectedVersion !== stateIn.version) throw new SoloError('versione', 'La partita è cambiata: ricarica prima di agire.');
    if (stateIn.provaInAttesa && cmd.id !== stateIn.provaInAttesa.comando.id) throw new SoloError('prova_in_attesa', 'C\'è una prova da tirare o da annullare.');
    if (isOver(stateIn)) throw new SoloError('partita_conclusa', 'La partita è conclusa.');
    const { content, dice } = env;
    const state = clone(stateIn);
    if (state.boostAttivo && !state.incontro) state.boostAttivo = null; // lo scontro è finito per altra via (caduta, Raven): il Boost è spento
    if (state.personaggio.levelUpInAttesa && cmd.tipo !== 'miglioramento' && cmd.tipo !== 'level_up_fine' && cmd.tipo !== 'assegna_slot' && cmd.tipo !== 'pregio') {
      throw new SoloError('level_up_in_attesa', 'Completa prima il level up: la storia riprende dopo.');
    }
    const ev = makeEvent(state, cmd);
    ev.ts = env.now || Date.now();
    // la prova confermata: quella mostrata prima del tiro resta nell'evento, accanto al tiro vero
    if (state.provaInAttesa && cmd.id === state.provaInAttesa.comando.id) { ev.provaConfermata = state.provaInAttesa.prova; delete state.provaInAttesa; }
    const applied = ev.effetti;
    curDice = dice; curEvent = ev;
    const scenaPrima = state.scena;
    // spendere AP non è un'azione di gioco: non fa passare il tempo, non
    // cambia scena e non assegna livelli né progressi
    const neutro = cmd.tipo === 'miglioramento' || cmd.tipo === 'level_up_fine' || cmd.tipo === 'assegna_slot' || cmd.tipo === 'pregio';
    let ext = null;
    try {
    // Raven al Lv 29/30 ha precedenza su qualunque azione tentata
    if (!neutro && state.raven.pending && state.personaggio.livello >= R().SOLO_TUNING.ravenLivelloSpeciale && (currentScene(state, content).calma || cmd.tipo === 'riposo')) {
      ev.tipo = 'raven';
      maybeRaven(state, content, cmd.tipo === 'riposo' ? 'riposo' : 'calma', applied, ev);
    } else {
      const mod = moderate(state, content, cmd, ev, applied);
      if (!mod) {
        if (neutro) {
          // spesa e conclusione del level up: non toccano scontro, dialogo né viaggio, che
          // restano com'erano (stesso round, stessi HP) e riprendono dopo il level up.
          // Fuori da un level up aperto, spendere a metà scontro o dialogo non è ammesso.
          const inCorso = state.incontro || (state.interazione && state.interazione.dialogo) || (state.mappa && state.mappa.viaggio && state.mappa.viaggio.stato === 'in_corso');
          if (cmd.tipo === 'miglioramento') {
            if (inCorso && !state.personaggio.levelUpInAttesa) throw new SoloError('azione_non_valida', 'Non adesso: finisci prima lo scontro, il dialogo o il viaggio.');
            spendImprovement(state, cmd, applied, ev);
          } else if (cmd.tipo === 'assegna_slot') assignSlot(state, content, cmd, applied, ev);
          else if (cmd.tipo === 'pregio') scegliPregio(state, cmd, applied, ev);
          else finishLevelUp(state, applied, ev);
        } else if (state.incontro) {
          if (cmd.tipo !== 'combattimento') {
            if (cmd.tipo === 'azione' && cmd.proposta && cmd.proposta.combattimento) cmd = Object.assign({}, cmd, cmd.proposta.combattimento);
            else throw new SoloError('azione_non_valida', 'Sei in combattimento: scegli un\'azione di combattimento.');
          }
          ev.tipo = 'combattimento';
          if (['dodge', 'block', 'none'].indexOf(cmd.difesa) !== -1) state.incontro.difesaScelta = cmd.difesa;
          // Boost: l'attivazione è il mezzo turno del round (js/rules.js: «l'attivazione del boost richiederà mezzo turno»), come
          // online (2 quarti su 4): non avanza il round e il nemico non risponde, poi resta l'altra metà per agire; un solo mezzo
          // turno per round fra Boost e oggetto (7/11/2026, DECISIONI_AUTORE §15 I.3). L'estensione non costa tempo, come online.
          if (cmd.azione === 'boost') activateBoost(state, content, cmd, applied, ev);
          else if (cmd.azione === 'oggetto') {
            // oggetto a mezzo turno (decisione dell'autore del 6/11, DECISIONI §13): come il Boost, non avanza il round e il nemico non
            // risponde; PROPOSTA DA APPROVARE: al più un oggetto per round, per non concatenare le cure
            if (state.incontro.oggettoRound === state.incontro.round) throw new SoloError('azione_non_valida', 'Hai già usato un oggetto in questo round: ora agisci.');
            if (state.incontro.mezzoTurnoRound === state.incontro.round) throw new SoloError('azione_non_valida', 'In questo round hai già usato il mezzo turno per attivare il Boost: ora agisci.');
            ev.combattimento = { round: state.incontro.round, azioni: [], mezzoTurno: true };
            combatItem(state, content, cmd, applied, ev);
            if (state.incontro) state.incontro.oggettoRound = state.incontro.mezzoTurnoRound = state.incontro.round;
          }
          else if (cmd.azione === 'boost_estendi') extendBoost(state, applied, ev);
          else if (cmd.azione === 'muovi') muoviPg(state, cmd, ev);
          else combatRound(state, content, cmd, dice, applied, ev);
        } else if (state.interazione && state.interazione.dialogo && ['battuta', 'dialogo_chiudi', 'usa', 'improvvisa', 'azione_aperta'].indexOf(cmd.tipo) === -1) {
          throw new SoloError('azione_non_valida', 'Stai parlando con ' + pngName(content, state.interazione.dialogo) + ': concludi il dialogo prima di fare altro.');
        } else if (state.interazione && state.interazione.sceltaIncontro && ['incontro', 'usa', 'battuta', 'dialogo_chiudi', 'improvvisa', 'azione_aperta'].indexOf(cmd.tipo) === -1) {
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
        } else if (['improvvisa', 'azione', 'esplora', 'azione_aperta'].indexOf(cmd.tipo) !== -1 && cmd.testo && global.RMSoloOntologia && (ext = global.RMSoloOntologia.azioneEsterna(state, content, cmd.testo))) {
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
        } else if (cmd.tipo === 'azione_aperta') {
          azioneAperta(state, content, cmd, dice, applied, ev);
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
        } else if (cmd.tipo === 'oracolo') {
          askOracle(state, content, cmd, dice, applied, ev);
        } else if (cmd.tipo === 'obiettivo_personale') {
          playPersonalBeat(state, content, cmd, dice, applied, ev);
        } else {
          throw new SoloError('comando_non_valido', 'Tipo di comando sconosciuto');
        }
      }
      if (!isOver(state) && !neutro) {
        const before = state.scena;
        checkTransitions(state, content, dice, applied);
        if (!isOver(state) && state.scena !== before) maybeRaven(state, content, 'calma', applied, ev);
      }
    }
    // gerarchia, scene interne, contratto, PNG, tema, arco, secondari
    if (strutturaMode(content) && !neutro) ST().dopoComando(state, content, ev, cmd, applied);
    // mappa: spostamenti lungo le rotte del copione, luoghi visitati o trasformati
    if (MP() && state.mappa && !neutro) MP().dopoComando(stateIn, state, content, ev, applied);
    // fallimenti terminali (morte definitiva, Raven, sanzione): registrati
    // con lo stesso risolutore, mai come un falso epilogo di vittoria
    if (isOver(state) && state.stato !== 'atto_concluso' && !state.esitoFinale) state.esitoFinale = C().resolveEnding(state, content, applied, null, ev.n);
    if (ev.decisione) C().recordDecision(state, content, ev, cmd);
    if (!neutro && !isOver(state)) sbloccaCanoneRiservato(state, content, applied);
    if (state.progresso && !isOver(state) && !neutro) {
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
    // imprevisto di scena (Fase 5.2): occasionale, legato a un filo aperto, deciso dal motore senza usare i dadi
    if (!neutro && TRM() && !isOver(state)) applyImprevisto(state, content, cmd, scenaPrima, applied, ev, dice);
    } finally { curDice = null; curEvent = null; }
    ev.dadi = dice.log.slice();
    // giri a vuoto: dopo poche azioni di testo libero senza avanzamento, un PNG prende l'iniziativa (testo d'autore della scena)
    if (!neutro && !isOver(state)) aggiornaVuoti(stateIn, state, content, ev, cmd);
    // resoconto completo: esito, riepilogo tecnico, stati, transizione,
    // azioni successive e testo di riserva (js/solo/solo-feedback.js)
    const inc = state.incontro || stateIn.incontro;
    if (inc && inc.nemico) {
      ev.nemicoNome = inc.nemico.nome;
      const art = ((content.nemici || {})[inc.nemicoId] || {}).articolo;
      // l'articolo dei dati può già finire con lo spazio («la »): mai «la  Bikkja»
      ev.nemicoArt = art ? (/'$/.test(art.trim()) ? art.trim() : art.trim() + ' ') + inc.nemico.nome : inc.nemico.nome;
    }
    // un PNG non ripete come nuova una battuta già mostrata in questa scena (apertura o racconti precedenti): registro del 5/11/2026, turno 3
    if (ev.riserva && !ev.testoFisso) ev.riserva = senzaBattuteGiaDette(stateIn, content, ev.riserva, ev.scena);
    if (F()) {
      ev.resoconto = F().build(stateIn, state, content, ev, cmd, api);
    }
    // regia drammaturgica (js/solo/solo-director.js): scrive solo lo stato
    // narrativo e ev.regia, mai esiti, risorse o condizioni dei finali
    if (F()) ev.resoconto.bundle = F().bundle(state, content, ev);
    if (Dir()) ev.regia = Dir().afterCommand(stateIn, state, content, ev, cmd);
    // V2: registra nel mondo ciò che il motore ha già deciso (solo con l'interruttore «mondo»; scrive solo state.mondo)
    if (MD() && MD().attivo(state, 'mondo') && !neutro) MD().dopoComando(state, content, ev, cmd);
    if (F()) ev.resoconto.riserva = ev.testoFisso || F().fallback(state, content, ev, ev.resoconto);
    // V2: il regista costruisce il piano del turno (scrive solo state.mondo ed ev.piano; mai esiti o risorse)
    if (PI() && MD() && MD().attivo(state, 'regia') && !neutro && !ev.testoFisso) ev.piano = PI().pianifica(state, content, ev, cmd);
    // V2: memoria a tre livelli (recente, scena, lunga); scrive solo state.mondo.memoria
    if (ME() && MD() && MD().attivo(state, 'memoria') && !neutro && !ev.testoFisso) ME().registra(state, content, ev);
    // testi fissi (sanzioni, Raven, crudeltà): mai generati dall'IA
    ev.narrazione = ev.testoFisso ? { stato: 'pronta', testo: ev.testoFisso, fonte: 'fissa', battute: [] }
      : { stato: 'da_generare', testo: null, fonte: null };
    if (ev.resoconto && ev.testoFisso) ev.resoconto.narrazione = ev.testoFisso;
    // memoria dello stile del giocatore: solo per i testi scritti a mano e accettati (mai sanzioni o testi fissi),
    // solo conteggi aggregati; si azzera con azzeraStile
    if (!neutro && cmd.sorgente === 'testo' && cmd.testo && STL() && !ev.testoFisso) state.stile = STL().registra(state.stile, cmd.testo, cmd.proposta || null);
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

  /* Oracolo (Fase 5.1): risposta sì / sì, ma / no / no, e pesata sulla tensione; diventa un fatto di partita. */
  function askOracle(state, content, cmd, dice, applied, ev) {
    const domanda = String(cmd.domanda || cmd.testo || '').trim();
    if (!TRM() || domanda.length < 4) throw new SoloError('azione_non_valida', 'Fai una domanda a cui si possa rispondere sì o no.');
    if (state.incontro) throw new SoloError('azione_non_valida', 'Non durante uno scontro.');
    const r = TRM().rispondi(state, content, domanda, () => dice.roll(100, 'Oracolo (d100)'));
    TRM().registraOracolo(state, ev, domanda, r);
    ev.tipo = 'oracolo';
    ev.testo = domanda;
    ev.oracolo = { esito: r.esito, tiro: r.tiro, tensione: r.tensione, ripetuta: !!r.ripetuta, protetta: !!r.protetta };
    ev.riserva = r.testo;
    applied.push({ tipo: 'oracolo', esito: r.esito, testo: r.testo });
  }
  /* «Il tuo filo» (Fase 5.3): prova del beat del traguardo dell'obiettivo personale, una volta per scena. */
  function playPersonalBeat(state, content, cmd, dice, applied, ev) {
    const t = TRM() && TRM().traguardoAttivo(state, content);
    if (!t) throw new SoloError('azione_non_valida', 'Qui non c\'è un passo del tuo filo da affrontare.');
    const pg = state.personaggio;
    const tratto = TRM().trattoMigliore(pg, t.tratti);
    const check = provaVolontaria({ dice, sheet: schedaConBonus(state), trait: tratto, nc: t.nc, difficolta: state.difficolta }, 'obiettivo personale');
    const esito = TRM().esitoBeat(check.esito);
    pg.obiettivoPersonale.beats = pg.obiettivoPersonale.beats || {};
    pg.obiettivoPersonale.beats[state.scena] = { esito, punti: TRM().PUNTI[esito], titolo: t.titolo };
    ev.tipo = 'obiettivo_personale';
    ev.testo = t.titolo;
    ev.check = check; ev.esito = check.esito; ev.obiettivoTesto = t.beat;
    ev.riserva = t.esiti[esito];
    applied.push({ tipo: 'obiettivo_personale', scena: state.scena, titolo: t.titolo, esito, testo: t.esiti[esito] });
    awardProgress(state, content, 'obiettivo_personale:' + state.scena, progressRule(content, 'obiettivo', esito === 'pieno' ? 'successo' : esito === 'parziale' ? 'parziale' : 'fallimento'), applied);
  }
  /* Imprevisto di scena: lo sceglie il motore (generatore deterministico, non i dadi); il narratore lo racconta. */
  function applyImprevisto(state, content, cmd, scenaPrima, applied, ev, dice) {
    const x = TRM().scegli(state, content, cmd, scenaPrima);
    if (!x) return;
    TRM().registraImprevisto(state, x, ev.n);
    applied.push({ tipo: 'imprevisto', id: x.id, filo: x.filo, effetto: x.effetto, testo: x.testo });
    ev.imprevisto = { id: x.id, filo: x.filo, effetto: x.effetto, testo: x.testo };
    ev.riserva = [ev.riserva, x.testo].filter(Boolean).join('\n\n');
    if (x.effetto === 'complica' && x.orologio && x.filo.indexOf('orologio:') === 0) applyEffects(state, content, [{ orologio: { id: x.filo.split(':')[1], delta: x.orologio } }], 'imprevisto:' + x.id + ':' + ev.n, applied, dice);
  }
  /* Opzioni di partita (senza eventi né cambio di versione). */
  function impostaOpzione(stateIn, nome, valore) {
    const state = clone(stateIn);
    state.opzioni = Object.assign({}, state.opzioni, { [nome]: !!valore });
    return state;
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

  /* ------------------------------------------- durabilità dell'equipaggiamento */

  /* Armi, armature e scudi con una Durabilità numerica. Il valore massimo è
     `durabilita`; `durabilitaCorrente` compare solo dopo la prima perdita
     (assente = integro). */
  function equipConDurabilita(pg) {
    return (pg.equip || []).filter(e => ['arma', 'armatura', 'scudo'].indexOf(e.tipo) !== -1 && Number.isFinite(e.durabilita) && e.durabilita > 0);
  }
  function durabilitaCorrente(e) { return Number.isFinite(e.durabilitaCorrente) ? e.durabilitaCorrente : e.durabilita; }

  /* Perdita di Durabilità di un pezzo (mai sotto 0). A 0 il pezzo è rotto:
     avviso nel registro e nessun contributo finché non viene riparato
     (equipIntegro, come isEquipmentUsable nel gioco normale). */
  function wearPiece(e, quantita, applied, chi) {
    if (!e || !Number.isFinite(e.durabilita) || !(quantita > 0)) return;
    const prima = durabilitaCorrente(e);
    e.durabilitaCorrente = Math.max(0, prima - quantita);
    applied.push({ tipo: 'usura', oggetto: e.id || null, nome: e.nome, chi: chi || null, da: prima, a: e.durabilitaCorrente, max: e.durabilita });
    if (prima > 0 && e.durabilitaCorrente <= 0) applied.push({ tipo: 'oggetto_rotto', oggetto: e.id || null, nome: e.nome, chi: chi || null });
  }
  function wearEquip(state, indice, quantita, applied) { wearPiece((state.personaggio.equip || [])[indice], quantita, applied, state.personaggio.nome); }

  /* Usura da un colpo: la regola ESISTENTE «Durabilità (Ipotesi 2)» di
     js/data.js (durabilityCalcolaPerdita), applicata come in
     computeEquipDurabilityLosses di js/cloud-combat.js — nessuna costante
     nuova:
     - colpo bloccato con successo: lo scudo incassa il colpo com'era prima
       del blocco (damageRoll); altrimenti l'armatura indossata incassa il
       danno finale (la solitaria non ha locazioni: è l'armatura in
       dotazione); schivata riuscita o danno 0: nessuna usura;
     - l'arma di chi attacca (solo un'arma vera, non tecniche né magie) si
       usura contro lo stesso pezzo che ha incassato, o contro R generico se
       non ce n'è;
     - tratto Resistenza di ciascun proprietario; pezzo già rotto: né subisce
       né causa usura.
     I d20 del calcolo non escono dai dadi del comando (non spostano le prove
     già scritte): vengono da un generatore deterministico legato alla
     partita e all'evento, quindi ripetibile. */
  function seededRng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    let t = h >>> 0;
    return function () { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ t >>> 15, 1 | t); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  }
  const pezzoDurabilita = e => ({ kind: e.tipo, quality: e.qualita, size: e.taglia, dur: e.durabilita });
  const durabilitaUsabile = e => !!(e && Number.isFinite(e.durabilita) && e.durabilita > 0 && durabilitaCorrente(e) > 0);
  const resistenzaDi = c => Number((c && c.traits && (c.traits.Resistenza != null ? c.traits.Resistenza : (c.traits.capacitaCombattive || {}).Resistenza))) || 0;
  function wearForHit(state, applied, o) {
    if (typeof durabilityCalcolaPerdita !== 'function') return;
    const r = o.r;
    const bloccato = !!(r.defense && r.defense.type === 'block' && r.defense.success);
    const dannoReale = bloccato ? r.damageRoll : r.finalDamage;
    if (!(dannoReale > 0)) return;
    const eqD = o.difensore.equip || [];
    const pezziD = bloccato ? eqD.filter(e => e.tipo === 'scudo' && durabilitaUsabile(e)) : eqD.filter(e => e.tipo === 'armatura' && durabilitaUsabile(e)).slice(0, 1);
    const arma = o.arma && o.arma.tipo === 'arma' && durabilitaUsabile(o.arma) ? o.arma : null;
    const rng = seededRng((state.id || '') + ':' + (curEvent ? curEvent.n : 0) + ':' + (o.salt || ''));
    const perdite = [];
    pezziD.forEach(e => {
      const { perdita } = durabilityCalcolaPerdita({ bersaglio: pezzoDurabilita(e), attaccante: arma ? pezzoDurabilita(arma) : null, dannoReale, trattoResistenza: resistenzaDi(o.difensore), rng });
      if (perdita > 0) perdite.push([e, perdita, o.difensore.nome]);
    });
    if (arma) {
      const { perdita } = durabilityCalcolaPerdita({ bersaglio: pezzoDurabilita(arma), attaccante: pezziD.length ? pezzoDurabilita(pezziD[0]) : null, dannoReale, trattoResistenza: resistenzaDi(o.attaccante), rng });
      if (perdita > 0) perdite.push([arma, perdita, o.attaccante && o.attaccante.nome]);
    }
    perdite.forEach(([e, q, chi]) => wearPiece(e, q, applied, chi));
  }

  /* Regola approvata dall'autore il 2026-10-16 (Fase 1, piano solitaria).
     Nel gioco normale non esiste una regola di riparazione, ma esiste il tratto «Riparare»: al
     riposo (scena calma) il protagonista fa UNA prova su Riparare (stesso
     sistema delle prove, NC di norma 12; senza il tratto, prova senza
     competenza) e l'esito decide quanta durabilità persa recupera ogni pezzo
     danneggiato (rotti compresi): successo pieno tutta, successo la metà,
     parziale un quarto (sempre per eccesso), fallimento nulla. Un pezzo a 0
     si ripara solo in scena calma. */
  const FRAZIONE_RIPARAZIONE = { successo_critico: 1, successo_pieno: 1, successo: 1 / 2 };
  function repairAtRest(state, scena, applied) {
    const pezzi = equipConDurabilita(state.personaggio).filter(e => durabilitaCorrente(e) < e.durabilita && (durabilitaCorrente(e) > 0 || scena.calma));
    if (!pezzi.length || !curDice) return;
    const check = R().resolveCheck({ dice: curDice, sheet: schedaConBonus(state), trait: 'Riparare', nc: R().SOLO_TUNING.ncBase, difficolta: state.difficolta });
    const frazione = FRAZIONE_RIPARAZIONE[check.esito] || 0;
    applied.push({ tipo: 'riparazione_prova', esito: check.esito, tratto: check.tipo === 'tratto' ? check.traitValue : 0, tiro: check.d20 != null ? check.d20 : check.d100, totale: check.total, nc: check.nc != null ? check.nc : check.soglia });
    if (!frazione) return;
    pezzi.forEach(e => {
      const cur = durabilitaCorrente(e);
      const nuova = Math.min(e.durabilita, cur + Math.ceil((e.durabilita - cur) * frazione));
      e.durabilitaCorrente = nuova;
      applied.push({ tipo: 'riparazione', oggetto: e.id || null, nome: e.nome, da: cur, a: nuova, max: e.durabilita, ripristinato: cur <= 0 });
    });
  }

  /* Strumenti di prova (SOLO modalità sviluppatore, li espone solo solo-ui.js
     dietro devMode()): non sono comandi di gioco e non passano da applyCommand.
     - simulaLevelUp: dà le tacche per il prossimo livello e fa scattare lo
       stesso levelUpIfDue della partita vera (blocco della storia compreso);
     - danneggiaEquip: arma, armatura e scudo a metà durabilità, uno a 0. */
  function devSimulaLevelUp(state, content) {
    const s = JSON.parse(JSON.stringify(state));
    if (!s.progresso) s.progresso = { tacche: 0, totale: 0, premiati: {}, sblocchi: [] };
    if (s.personaggio.levelUpInAttesa) throw new SoloError('azione_non_valida', 'Un level up è già da completare.');
    const next = s.personaggio.livello + 1;
    if (next > 30 || next > bandFor(content, s.atto)[1]) throw new SoloError('azione_non_valida', 'Livello massimo raggiunto per questo atto.');
    s.progresso.tacche = Math.max(s.progresso.tacche, tickCost(next, content));
    const applied = [];
    levelUpIfDue(s, content, applied);
    return { state: s, effetti: applied };
  }
  function devDanneggiaEquip(state) {
    const s = JSON.parse(JSON.stringify(state));
    const pezzi = equipConDurabilita(s.personaggio);
    if (!pezzi.length) throw new SoloError('azione_non_valida', 'Nessun pezzo con durabilità da danneggiare.');
    pezzi.forEach(e => { e.durabilitaCorrente = Math.floor(e.durabilita / 2); });
    (pezzi.find(e => e.tipo === 'armatura') || pezzi[0]).durabilitaCorrente = 0;
    return { state: s, effetti: [] };
  }

  /* ------------------------------------- avanzamento: spesa di AP e punti */

  /* Stesse regole di "I miei personaggi" (changePrimary / changeTertiary di
     js/app.js, costi di js/data.js): ogni comando alza di 1 una sola voce,
     mai oltre gli AP o i punti tratto disponibili. Armi e armatura non si
     scelgono: le decide il gioco. Sono solo aumenti (nessun rimborso). */
  const TRATTO_MAX = 50; // tetto del valore di un tratto nella scheda dell'app
  const TRACKED = { hp: 'hpMaxTracked', mp: 'mpMaxTracked', pr: 'prMaxTracked' };

  /* Quanto costa alzare di 1 la voce `s` e se si può: { nome, da, costo, errore }.
     `costo` è in AP (statistiche) oppure 1 punto tratto (tratti). */
  function improvementQuote(pg, s) {
    s = s || {};
    const q = { nome: '', da: 0, costo: 0, punti: false, errore: null };
    if (!(pg.livello > 1)) { q.errore = 'Il primo livello non ha punti da spendere.'; return q; }
    if (s.categoria === 'tratto') {
      const nome = String(s.chiave || '');
      q.nome = nome; q.punti = true; q.costo = 1;
      const offerti = trattiOfferti(pg);
      if (!offerti[s.lista] || offerti[s.lista].indexOf(nome) === -1) q.errore = TRAIT_LISTS[s.lista] && TRAIT_LISTS[s.lista].indexOf(nome) !== -1 ? 'Questo tratto non serve a nessuna scena di questa storia: non è nel suo campionario.' : 'Tratto non valido.';
      else {
        q.da = (pg.traits[s.lista] && pg.traits[s.lista][nome]) || 0;
        if (((pg.puntiTratto && pg.puntiTratto[s.lista]) || 0) < 1) q.errore = 'Non hai punti tratto da spendere in questa lista.';
        else if (q.da >= TRATTO_MAX) q.errore = 'Valore massimo raggiunto (' + TRATTO_MAX + ').';
      }
      return q;
    }
    let max = Infinity;
    if (s.categoria === 'terziaria') {
      const st = TERTIARY_STATS.find(x => x.key === s.chiave);
      if (!st) { q.errore = 'Statistica non valida.'; return q; }
      q.nome = st.label; q.da = Number(pg.tertiary[st.key]) || 0; max = TERTIARY_MAX;
      q.costo = tertiaryApCostForPoint(q.da + 1);
    } else if (s.categoria === 'primaria') {
      const st = PRIMARY_STATS.find(x => x.key === s.chiave) || SECONDARY_STATS.find(x => x.key === s.chiave);
      if (!st) { q.errore = 'Caratteristica non valida.'; return q; }
      q.nome = st.full || st.label;
      q.da = Number(TRACKED[st.key] ? pg[TRACKED[st.key]] : pg.primary[st.key]) || 0;
      if (st.key === 'pr') max = PR_MAX;
      q.costo = (st.key === 'hp' ? hpApCostForPoint : st.key === 'mp' ? mpApCostForPoint : primaryApCostForPoint)(q.da + 1);
    } else { q.errore = 'Tipo di spesa non valido.'; return q; }
    const ap = Number(pg.apDisponibili) || 0;
    if (q.da >= max) q.errore = 'Valore massimo raggiunto (' + max + ').';
    else if (q.costo > ap) q.errore = 'AP insufficienti: servono ' + q.costo + ' AP (disponibili ' + ap + ').';
    return q;
  }

  /* Elenco delle voci migliorabili per la Scheda, con costo e motivo se bloccate. */
  function improvementOptions(pg) {
    const mk = (s, extra) => Object.assign({ spesa: s }, improvementQuote(pg, s), extra || {});
    const prim = PRIMARY_STATS.map(st => st.key).concat(['pr']).map(k => mk({ categoria: 'primaria', chiave: k }));
    const ter = TERTIARY_STATS.map(st => mk({ categoria: 'terziaria', chiave: st.key }));
    const offerti = trattiOfferti(pg);
    const tratti = Object.keys(TRAIT_LISTS).map(lista => ({ lista, punti: (pg.puntiTratto && pg.puntiTratto[lista]) || 0,
      voci: (offerti[lista] || []).map(n => mk({ categoria: 'tratto', lista, chiave: n })) }));
    const puntiTratto = tratti.reduce((a, t) => a + t.punti, 0);
    // c'è ancora qualcosa da spendere: una caratteristica alla portata degli AP o un punto tratto
    const spendibile = prim.concat(ter).some(o => !o.errore) || tratti.some(t => t.punti > 0 && t.voci.some(o => !o.errore));
    return { ap: Number(pg.apDisponibili) || 0, primarie: prim, terziarie: ter, tratti, puntiTratto, spendibile, mancante: levelUpMancante(pg) };
  }

  function spendImprovement(state, cmd, applied, ev) {
    const pg = state.personaggio, s = cmd.spesa || {};
    const q = improvementQuote(pg, s);
    if (q.errore) throw new SoloError('azione_non_valida', q.errore);
    if (s.categoria === 'tratto') {
      pg.traits[s.lista] = pg.traits[s.lista] || {};
      pg.traits[s.lista][q.nome] = q.da + 1;
      pg.puntiTratto[s.lista] -= 1;
      applied.push({ tipo: 'spesa_tratto', lista: s.lista, chiave: q.nome, nome: q.nome, da: q.da, a: q.da + 1, puntiRimasti: pg.puntiTratto[s.lista] });
      ev.riserva = ev.testoFisso = q.nome + ' sale a ' + (q.da + 1) + '.'; // testo fisso: nessuna narrazione dell'IA
      autoFinishLevelUp(pg, applied);
      return;
    }
    pg.apDisponibili = Math.round(((Number(pg.apDisponibili) || 0) - q.costo) * 100) / 100;
    if (s.categoria === 'terziaria') pg.tertiary[s.chiave] = q.da + 1;
    else if (TRACKED[s.chiave]) {
      pg[TRACKED[s.chiave]] = q.da + 1;
      pg.crescita = pg.crescita || {}; pg.crescita[s.chiave] = (pg.crescita[s.chiave] || 0) + 1;
    } else pg.primary[s.chiave] = q.da + 1;
    applied.push({ tipo: 'spesa_ap', categoria: s.categoria, chiave: s.chiave, nome: q.nome, da: q.da, a: q.da + 1, costo: q.costo, apRimasti: pg.apDisponibili });
    ev.riserva = ev.testoFisso = q.nome + ' sale a ' + (q.da + 1) + ' (−' + q.costo + ' AP).';
    autoFinishLevelUp(pg, applied);
  }

  /* Il level up è completo quando non resta nulla da spendere, oppure
     quando il giocatore lo conclude (può tenere AP da parte). */
  function autoFinishLevelUp(pg, applied) {
    if (pg.levelUpInAttesa && !improvementOptions(pg).spendibile && !slotDaAssegnare(pg)) {
      applied.push({ tipo: 'level_up_completo', livello: pg.levelUpInAttesa, automatico: true });
      pg.levelUpFatto = pg.levelUpInAttesa;
      delete pg.levelUpInAttesa;
    }
  }

  /* Cosa manca per concludere il level up. I punti tratto sono obbligatori
     (come "Conferma tratti" in "I miei personaggi", disattivato finché ogni
     lista non è a zero); gli AP possono restare da parte (la conferma delle
     statistiche dal Lv 2 non li richiede). Anche gli slot di tecniche/abilità
     sbloccati sono obbligatori, se il personaggio ha un gruppo del catalogo
     (assegna_slot: esempio del gruppo o capacità propria); senza gruppo restano
     solo segnalati e non si inventano capacità. */
  const ETICHETTE_TRATTI = { conoscenze: 'Conoscenze', capacitaNormali: 'Capacità normali', capacitaCombattive: 'Capacità combattive' };
  function levelUpMancante(pg) {
    const tratti = Object.keys(ETICHETTE_TRATTI).map(l => ({ lista: l, nome: ETICHETTE_TRATTI[l], punti: (pg.puntiTratto && pg.puntiTratto[l]) || 0 })).filter(x => x.punti > 0);
    const liberi = slotLiberi(pg), obbligatori = slotObbligatori(pg);
    const nSlot = obbligatori.tecniche + obbligatori.abilita;
    const parti = [];
    if (tratti.length) parti.push('Mancano punti tratto: ' + tratti.map(x => x.nome + ' ' + x.punti).join(', ') + '.');
    if (nSlot) parti.push('Da assegnare: ' + [obbligatori.tecniche ? obbligatori.tecniche + (obbligatori.tecniche === 1 ? ' tecnica' : ' tecniche') : '', obbligatori.abilita ? obbligatori.abilita + (obbligatori.abilita === 1 ? ' abilità' : ' abilità') : ''].filter(Boolean).join(' e ') + '.');
    return { tratti, slotLiberi: liberi, slotDaAssegnare: obbligatori, assegnabili: 0, bloccato: tratti.length > 0 || nSlot > 0, testo: parti.join(' ') };
  }
  function finishLevelUp(state, applied, ev) {
    const pg = state.personaggio;
    if (!pg.levelUpInAttesa) throw new SoloError('azione_non_valida', 'Non c\'è nessun level up da concludere.');
    const manca = levelUpMancante(pg);
    if (manca.bloccato) throw new SoloError('azione_non_valida', manca.testo + ' Completali per concludere.');
    applied.push({ tipo: 'level_up_completo', livello: pg.levelUpInAttesa, automatico: false, apAvanzati: pg.apDisponibili });
    pg.levelUpFatto = pg.levelUpInAttesa;
    delete pg.levelUpInAttesa;
    ev.riserva = ev.testoFisso = 'Level up completato. La storia riprende.';
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
    const mpGain = Math.min(pool, pg.mpMaxTracked - pg.mpCur); pg.mpCur += mpGain; pool -= mpGain;
    // i PP dei Boost si recuperano col riposo, con lo stesso budget di P.R. (HP, MP, PP: «I miei personaggi»)
    const ppGain = Math.max(0, Math.min(pool, ppMaxOf(pg) - ppNow(pg))); if (ppGain) pg.ppCur = ppNow(pg) + ppGain;
    state.condizione = 'normale';
    applied.push({ tipo: 'riposo', hp: hpGain, mp: mpGain, pp: ppGain });
    // stati rimasti dopo una fuga: il riposo toglie quelli che il catalogo degli stati fa togliere al riposo
    const tolti = (state.statiInSospeso || []).filter(s => (s.rimozione || []).indexOf('riposo') !== -1);
    if (tolti.length) {
      state.statiInSospeso = state.statiInSospeso.filter(s => tolti.indexOf(s) === -1);
      applied.push({ tipo: 'stati_rimossi', via: 'riposo', stati: tolti.map(s => s.stato || s.nome) });
    }
    repairAtRest(state, sc, applied);
    ev.riserva = 'Ti concedi qualche momento di quiete. Il respiro torna regolare.';
    maybeRaven(state, content, 'riposo', applied, ev);
  }

  /* --------------------------------------------------- narrazione IA */

  /* Controllo di coerenza della narrazione rispetto allo stato: vincoli
     dichiarati dalla scena (es. porta chiusa) e oggetti del catalogo
     "ricevuti" nel testo senza una ricompensa registrata nell'evento. */
  /* Oggetti che il testo dice passare di mano al protagonista («trovi il X»,
     «ti consegna il X»). Parole intere, nella stessa frase e senza virgole di
     mezzo, e non se la frase è negata («Non trovi l'ordine», «Non ti dà la rotta»). */
  function oggettiConsegnati(content, testo) {
    const t = String(testo || ''), ids = [];
    Object.entries((content.borsa && content.borsa.oggetti) || {}).forEach(([id, d]) => {
      const nome = String(d.nome || '').split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!nome) return;
      const re = new RegExp('(?<![\\p{L}])(?<!non )(trovi|ottieni|ricevi|raccogli|ti (consegna|porge|d[aà]))(?![\\p{L}])[^.,;:]{0,40}(?<![\\p{L}])' + nome + '(?![\\p{L}])', 'iu');
      if (re.test(t)) ids.push(id);
    });
    return ids;
  }

  function validateNarration(state, content, ev, text) {
    const t = String(text || '');
    const problems = [];
    if (!t.trim()) problems.push('vuota');
    if (t.length > 1500) problems.push('troppo_lunga');
    // appunti di regia («il protagonista», «scopo di…»): mai al giocatore
    if (testoInterno(t)) problems.push('testo_interno');
    // rete di sicurezza (anche senza post-processo): pezzi della struttura JSON nel testo finale
    if (PO() && PO().FRAMMENTO_JSON && PO().FRAMMENTO_JSON.test(t)) problems.push('frammento_json');
    // formule di servizio e frasi ripetute nella stessa risposta: si racconta, non si ricorda al giocatore che tocca a lui
    if (fraseDiServizio(t)) problems.push('frase_di_servizio');
    if (frasiRipetute(t).length) problems.push('ripetizione');
    const sc = sceneOf(content, ev.scena);
    (sc && sc.vincoli_narrazione || []).forEach(v => {
      if (v.se_non_flag && !state.flags[v.se_non_flag]) {
        v.vietato.forEach(re => { if (new RegExp(re, 'i').test(t)) problems.push('contraddice:' + v.se_non_flag); });
      }
    });
    const premiati = (ev.effetti || []).filter(a => a.tipo === 'ricompensa').map(a => a.oggetto);
    oggettiConsegnati(content, t).forEach(id => {
      if (premiati.indexOf(id) === -1 && !hasItem(state, id)) problems.push('oggetto_non_assegnato:' + id);
    });
    // segreti non ancora scoperti: parole distintive del testo del fatto
    Object.entries(content.fatti).forEach(([id, f]) => {
      if (!f.segreto || fattoNoto(state, content, id) || !f.parole) return;
      if (f.parole.some(w => new RegExp(w, 'i').test(t))) problems.push('segreto:' + id);
    });
    C().lexiconHits(t, C().lockedLexicon(state, content)).forEach(h => problems.push('lessico:' + h));
    return { ok: problems.length === 0, problems };
  }

  /* ------------------------------------------------------------ prova confermata dal giocatore (4/11/2026)
     docs/single-player/PROVA_CONFERMATA_PROPOSTA.md. Le prove nate da un'azione del giocatore passano da qui; le verifiche del
     motore (resistenza, riparazione a riposo) e il combattimento chiamano resolveCheck come prima. In sonda non si tira:
     si restituiscono i dati della prova calcolati con le funzioni delle regole (traitValue, ncFor), senza toccarle. */
  let sondaAttiva = false;
  function descriviProva(opts, fonte, parti) {
    const tv = R().traitValue(opts.sheet, opts.trait);
    if (!tv) return { tipo: 'inesperto', tratto: opts.trait || null, dado: 'd100', formula: 'd100 − 20', soglia: 50, modificatori: [], fonte };
    const mod = Math.max(-4, Math.min(4, Number(opts.mod) || 0));   // stesso limite di resolveCheck
    return { tipo: 'tratto', tratto: opts.trait, valore: tv.value, dado: 'd20', formula: 'd20 + ' + tv.value + (mod ? (mod > 0 ? ' + ' : ' − ') + Math.abs(mod) : ''),
      nc: R().ncFor(opts.nc, opts.difficolta), modificatore: mod, modificatori: (parti || []).filter(x => x.valore), fonte };
  }
  function provaVolontaria(opts, fonte, parti) {
    if (sondaAttiva) throw { provaRichiesta: descriviProva(opts, fonte, parti) };
    return R().resolveCheck(opts);
  }
  /* Sonda: il comando richiede una prova volontaria? Lo esegue su una copia senza tirare; ritorna i dati della prova o null. */
  function sondaProva(state, cmd, env) {
    // dado fittizio e fisso: nessun valore casuale si consuma prima della conferma (la copia della sonda si butta)
    const finti = R().makeDice(() => 0.5);
    sondaAttiva = true;
    try { applyCommand(state, cmd, Object.assign({}, env, { dice: finti })); return null; }
    catch (e) { if (e && e.provaRichiesta) return e.provaRichiesta; return null; }
    finally { sondaAttiva = false; }
  }
  /* La proposta resta nello stato (salvataggio e caricamento non tirano): comando, prova e ciò che segue nello stesso messaggio. */
  function proponiProva(stateIn, cmd, prova, dopo) {
    const state = clone(stateIn);
    state.provaInAttesa = { comando: clone(cmd), prova: clone(prova), dopo: clone(dopo || []), versione: state.version + 1 };
    state.version += 1;
    return state;
  }
  function annullaProva(stateIn) {
    const state = clone(stateIn);
    if (state.provaInAttesa) { delete state.provaInAttesa; state.version += 1; }
    return state;
  }
  /* Il comando da tirare, con la versione attuale (lo esegue la UI con i dadi veri). */
  function comandoDaTirare(state) {
    return state.provaInAttesa ? Object.assign({}, state.provaInAttesa.comando, { expectedVersion: state.version }) : null;
  }

  /* PNG effettivamente presenti in una scena: la lista d'autore della scena, corretta dagli spostamenti d'autore
     (effetto «sposta»: state.posizioni[id] = id della scena dove ora si trova). Il Narratore non sposta nessuno. */
  function presentiEffettivi(state, content, scena) {
    const id = scena || state.scena, pos = (state && state.posizioni) || {};
    const out = (((sceneOf(content, id) || {}).png_presenti) || []).filter(p => !(p in pos) || pos[p] === id);
    Object.keys(pos).forEach(p => { if (pos[p] === id && out.indexOf(p) === -1) out.push(p); });
    return out.filter(p => content.png && content.png[p]);
  }

  /* Verifica pura di una risposta del Narratore (nessuno stato cambia): la UI la usa per chiedere una sola
     rigenerazione prima di agganciare il testo; l'aggancio rifà comunque tutti i controlli. */
  function verificaNarrazione(state, content, eventN, nar, voce) {
    const z = attachNarration(state, content, eventN, nar, voce).eventi[eventN - 1].narrazione;
    return { ok: nar.fonte !== 'ia' || z.fonte === 'ia', problemi: z.scarto || [] };
  }

  /* Aggancia il testo a un evento già risolto. Non cambia version: la
     narrazione è un'illustrazione dell'esito, non un nuovo esito. */
  function attachNarration(stateIn, content, eventN, nar, voce, opzioni) {
    const state = clone(stateIn);
    const ev = state.eventi[eventN - 1];
    if (!ev) throw new SoloError('evento', 'Evento inesistente');
    const opz = opzioni || {};
    const precedente = opz.riprova && ev.narrazione && ev.narrazione.stato === 'pronta' ? clone(ev.narrazione) : null;
    // B27: se il testo del modello l'ha già scartato il Narratore («istruzione_o_copia», JSON non valido…), il motivo resta nel registro
    const rifiutoModello = nar.fonte === 'riserva' && nar.errore && !/^(modello_non_caricato|piano_v2_assente|piano_vuoto|interprete_deterministico)$/.test(nar.errore);
    let fonte = nar.fonte, testo = nar.testo, scarto = rifiutoModello ? [String(nar.errore)] : null, postInfo = null, aggiornamenti = [];
    // V2 · post-processo: toglie ciò che decide per il protagonista, controlla le battute contro il piano e valuta gli aggiornamenti
    // (non li applica: entrano nel mondo in fondo, solo se il testo è accettato)
    if (fonte === 'ia' && nar.piano && ev.piano && PO() && MD() && MD().attivo(state, 'post')) {
      const pr = PO().elabora(state, content, ev, nar);
      testo = pr.testo; nar = Object.assign({}, nar, { battute: pr.battute }); postInfo = pr.info; aggiornamenti = pr.aggiornamenti || [];
      // un cambiamento durevole raccontato senza autorizzazione del piano: il testo non si mostra (né si corregge a pezzi)
      if (pr.info.coerenza && pr.info.coerenza.length) { scarto = pr.info.coerenza; fonte = 'riserva'; testo = fallbackText(state, content, ev); }
    }
    if (fonte === 'ia') {
      const chk = validateNarration(state, content, ev, testo + ' ' + (nar.battute || []).map(b => b.testo).join(' '));
      if (!chk.ok) { scarto = chk.problems; fonte = 'riserva'; testo = fallbackText(state, content, ev); }
    }
    // Le battute valgono solo se attribuite a un PNG presente nella scena:
    // il modello a volte fa "parlare" oggetti o il protagonista.
    let battute = [], battuteScartate = 0, voceInfo = null;
    if (fonte === 'ia') {
      const presenti = presentiEffettivi(state, content, ev.scena).map(id => ({ id, nome: content.png[id].nome.toLowerCase() }));
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
        // con il piano V2 i limiti sono per battuta e li ha già applicati il post-processo (RMSoloPost, maxFrasi del piano): il tetto
        // globale del V1 (3 frasi, e «…» contato come frase) qui tagliava testo già accettato (E01, E02, E07 del campione, 5/11/2026)
        if (!postInfo) testo = F().trimSentences(testo, ev.regia && ev.regia.budget ? Math.max(F().maxSentences(ev), ev.regia.budget.maxSentences) : F().maxSentences(ev));
        // candidati (mai canonici): memoria e Diario, marcati come narrativi
        if (out.memoryCandidate || out.journalCandidate) candidati = { memoria: out.memoryCandidate, diario: out.journalCandidate, statoCanonico: 'narrativo' };
      }
    }
    ev.narrazione = { stato: 'pronta', testo, fonte, battute: battute.map(b => ({ png: b.png, testo: b.testo })), battuteScartate, modello: nar.modello || null, scarto, ms: nar.ms || null, voce: voceInfo, candidati, post: postInfo };
    if (ev.resoconto) ev.resoconto.narrazione = testo;
    // «Riprova» (Fase 4.4): il nuovo testo sostituisce il precedente solo se è valido; una riserva non
    // peggiora un testo del modello già valido. Esiti, dadi, inventario e versione non si toccano mai.
    if (opz.riprova) {
      ev.riprove = (ev.riprove || 0) + 1;
      if (precedente && precedente.fonte === 'ia' && ev.narrazione.fonte !== 'ia') {
        ev.narrazione = precedente;
        if (ev.resoconto) ev.resoconto.narrazione = precedente.testo;
        ev.riprovaEsito = 'conservata';
      } else ev.riprovaEsito = 'nuova';
    }
    // Conseguenze del Narratore come transazione: solo quelle di un testo accettato entrano nel mondo. Gli effetti di regole, dadi e
    // Regista sono già nello stato e non passano di qui. Un «Riprova» accettato annulla prima le conseguenze della narrazione
    // precedente (istantanea del mondo presa prima di applicarle); se resta la precedente, restano solo le sue.
    if (ev.narrazione !== precedente && ev.narrazione.fonte === 'ia' && MD()) {
      if (precedente && precedente.mondoPrima && ev.n === state.eventi.length) state.mondo = clone(precedente.mondoPrima);
      if (aggiornamenti.length) {
        ev.narrazione.mondoPrima = clone(state.mondo);
        const r = MD().applica(state, content, aggiornamenti);
        ev.narrazione.operazioni = { applicate: r.applicate, scartate: r.scartate };
      }
    }
    // fatti comunicati (contratto §3.2): le unità che il testo finale contiene, mai tolte da un «Riprova» (monotonia)
    // il testo d'autore dell'evento è arrivato: riserva o testo fisso, oppure riscrittura passata dai controlli di conservazione del post-processo
    const autoreArrivato = ['riserva', 'fissa'].indexOf(ev.narrazione.fonte) !== -1 || (ev.narrazione.fonte === 'ia' && !!ev.narrazione.post);
    if (CM()) CM().marca(state, content, ev, [ev.narrazione.testo].concat((ev.narrazione.battute || []).map(b => b.testo)).join('\n'), ev.narrazione.fonte, { autore: autoreArrivato });
    // dettagli descrittivi della scena (contratto §4): solo dal testo del Narratore accettato, mai canone
    if (ME() && ME().ricordaDettagli) ME().ricordaDettagli(state, content, ev);
    // battute dei PNG (affermazioni, mai fatti): DECISIONI §14
    if (ME() && ME().ricordaBattute) ME().ricordaBattute(state, content, ev);
    // l'istantanea serve solo al «Riprova» dell'ultimo evento: le più vecchie si eliminano
    state.eventi.forEach(e => { if (e.n < ev.n && e.narrazione && e.narrazione.mondoPrima) delete e.narrazione.mondoPrima; });
    return state;
  }

  /* «Riprova»: quando è disponibile. Solo l'ultimo evento, con la descrizione pronta, mai per testi fissi
     (sanzioni, Raven, crudeltà), al massimo RIPROVE_MAX volte per evento; senza modello il testo di riserva
     sarebbe identico, quindi non si offre. */
  const RIPROVE_MAX = 3;
  function riprovaStato(state, content, opzioni) {
    const o = opzioni || {};
    const no = motivo => ({ disponibile: false, motivo, restanti: 0 });
    const ev = state && state.eventi && state.eventi[state.eventi.length - 1];
    if (!ev) return no('Non c\'è ancora nessuna descrizione da riscrivere.');
    if (ev.testoFisso || (ev.narrazione && ev.narrazione.fonte === 'fissa')) return no('Questo testo è fisso: non si riscrive.');
    if (!ev.narrazione || ev.narrazione.stato !== 'pronta') return no('La descrizione non è ancora pronta.');
    const usate = ev.riprove || 0;
    if (usate >= RIPROVE_MAX) return no('Hai già riprovato ' + RIPROVE_MAX + ' volte con questa descrizione.');
    if (o.occupato) return no('Aspetta la fine dell\'azione in corso.');
    if (o.modello === false) return no('Senza il modello locale la descrizione resta sempre la stessa.');
    return { disponibile: true, motivo: '', restanti: RIPROVE_MAX - usate };
  }
  /* Azzera la memoria dello stile del giocatore (la partita non cambia: nessun evento, stessa versione). */
  function azzeraStile(stateIn) {
    const state = clone(stateIn);
    delete state.stile;
    return state;
  }

  /* Un testo già mostrato non si riusa come risposta: ogni paragrafo identico a uno già letto (racconti degli eventi precedenti,
     apertura delle scene visitate) si toglie; se non resta nulla, una risposta neutra che non decide nulla per il giocatore. */
  const normPar = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const TIPI_NON_RIPETIBILI = ['azione', 'esplorazione', 'battuta', 'improvvisazione', 'oracolo', 'dialogo', 'dialogo_fine'];
  function testiMostrati(state, content, ev) {
    const set = {};
    const add = t => String(t || '').split(/\n\s*\n/).forEach(p => { const k = normPar(p); if (k) set[k] = true; });
    (state.eventi || []).forEach(e => { if (e.n < ev.n && e.narrazione && e.narrazione.testo) add(e.narrazione.testo); });
    const scene = {}; scene[content.scene[0].id] = true; scene[state.scena] = true;
    (state.eventi || []).forEach(e => (e.effetti || []).forEach(a => { if (a.tipo === 'scena') scene[a.scena] = true; }));
    Object.keys(scene).forEach(id => add(sceneOpeningText(state, content, id)));
    return set;
  }
  // le parole che indicano un appunto di regia: non devono mai arrivare al giocatore
  const TESTO_INTERNO_RE = /\b(?:il|la|del|al|dal|nel) protagonista\b|\bscopo di\b|\bscopo:|\blo scopo\b|\bil suo scopo\b|\bobiettivo del turno\b|\bpiano del turno\b|\bbattuta del piano\b|\bnota di regia\b/i;
  const testoInterno = t => TESTO_INTERNO_RE.test(String(t || ''));
  /* Formule di servizio: dicono al giocatore che tocca a lui o gli ripetono l'obiettivo, invece di raccontare. Mai nel racconto
     (l'obiettivo della scena sta nel Diario). Vietate al narratore e assenti dai testi di riserva. */
  const FRASI_DI_SERVIZIO = [
    /\bresta da risolvere\b/i, /\bin attesa del prossimo ordine\b/i, /\bresti (a|al|allo|alla|ai|agli|alle|nel|nella|in)\b[^.]*\bin attesa\b/i,
    /\bresta in attesa di (ci[oò]|quello) che dirai\b/i, /\baspetta una (tua )?(mossa|risposta)\b/i, /\btu non hai ancora risposto\b/i,
    /\bil resto lo farai dopo\b/i, /\bun passo per volta\b/i, /\bnon emerge (niente|nulla|altro)\b/i, /(?:^|\s)[eè] l[iì], in attesa\b/i,
    /\bla prossima mossa spetta a te\b/i, /\bqualcosa ti richiama\b/i, /\bil momento di agire [eè] arrivato\b/i, /\baspettano di capire che cosa farai\b/i,
    /\bche (cosa )?fai\s*\?/i, /\bcosa vuoi fare\s*\?/i
  ];
  const fraseDiServizio = t => FRASI_DI_SERVIZIO.find(re => re.test(String(t || ''))) || null;
  /* Ripetizioni dentro una stessa risposta: una frase uguale a un'altra, o contenuta per intero in un'altra più lunga
     («Gli rimetti a posto la spalla. Mentre gli rimetti a posto la spalla…»). Ritorna le frasi di troppo. */
  const frasiDi = t => String(t || '').split(/\n\s*\n/).map(p => p.split(/(?<=[.!?…»])\s+(?=[«"A-ZÀ-Ú0-9])/).map(x => x.trim()).filter(Boolean));
  function frasiRipetute(t, perTogliere) {
    // un titolo fra virgolette rimasto da solo (frase accorciata) non è una frase: non conta
    const tutte = [].concat.apply([], frasiDi(t)).filter(f => !/^«[^»]*»[.!?]?$/.test(f)).map((f, i) => ({ f, i, k: normPar(f) }));
    const uguali = tutte.filter(a => a.k.split(' ').length >= 3 && tutte.some(b => b.i !== a.i && (b.k === a.k ? b.i < a.i : (' ' + b.k + ' ').indexOf(' ' + a.k + ' ') !== -1))).map(a => a.f);
    // da togliere=true (testo di riserva): una frase quasi uguale si toglie solo se è breve, per non perdere un testo d'autore lungo
    const quasi = frasiQuasiUguali(t).map(c => c.corta).filter(f => uguali.indexOf(f) === -1 && (!perTogliere || f.split(/\s+/).length <= 15));
    return uguali.concat(quasi.filter((f, i) => quasi.indexOf(f) === i));
  }
  /* Frasi quasi uguali nella stessa risposta («la spalla di Fobos torna al suo posto» / «mentre gli rimetti a posto la spalla»): due incisi di
     frasi diverse con almeno 2 parole piene in comune, che coprono il 60 % dell'inciso più corto. Radici di 5 lettere; non contano le parole
     vuote, i nomi propri (iniziale maiuscola) e le battute fra virgolette. Ritorna le coppie, con la frase più corta da togliere. */
  const PAROLE_VUOTE = /^(della|dello|delle|degli|dalla|dalle|dagli|nella|nelle|negli|sulla|sulle|sugli|alla|alle|agli|allo|come|anche|ancora|mentre|quando|perche|sono|essere|questo|questa|questi|queste|quello|quella|quelli|quelle|molto|poco|dopo|prima|sempre|niente|nulla|tutto|tutta|tutti|tutte|ogni|altro|altra|altri|altre|cosa|dove|fino|verso|sopra|sotto|dentro|fuori|senza|pero|solo|loro|suoi|tuoi|nostro|qualcosa|qualcuno|nessuno|fare|fatto|stato|stata|hanno|aveva|avere|ancora|intanto|adesso|quasi|tanto|tanta|qui|cosi)$/;
  // nome proprio = maiuscola a metà frase (la prima parola della frase o dell'inciso conta come le altre)
  const radiciPiene = s => String(s || '').replace(/«[^»]*»|"[^"]*"/g, ' ').trim().split(/\s+/).filter((w, i) => w && !(i > 0 && /^[A-ZÀ-Ú]/.test(w.replace(/^[^A-Za-zÀ-ÿ]+/, ''))))
    .map(w => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')).filter(w => w.length >= 4 && !PAROLE_VUOTE.test(w)).map(w => w.slice(0, 5));
  // gli incisi e, in più, la frase intera (una frase spezzata da molte virgole si confronta comunque per intero)
  const incisi = f => String(f).split(/[,;:]\s*|\s+(?=(?:mentre|e|ma|poi|intanto)\s)/i).concat([f]).map(radiciPiene).filter(r => r.length >= 2);
  function frasiQuasiUguali(t) {
    const tutte = [].concat.apply([], frasiDi(t));
    const out = [];
    for (let i = 0; i < tutte.length; i++) for (let j = i + 1; j < tutte.length; j++) {
      const simile = incisi(tutte[i]).some(a => incisi(tutte[j]).some(b => {
        const comuni = a.filter((w, k) => b.indexOf(w) !== -1 && a.indexOf(w) === k).length;
        // l'inciso più corto ha almeno 3 parole piene: «la grata è ancora aperta» dopo «hanno lasciato aperta la grata» è un richiamo, non una ripetizione
        const corto = Math.min(new Set(a).size, new Set(b).size);
        return comuni >= 2 && corto >= 3 && comuni / corto >= 0.6;
      }));
      if (simile) out.push({ a: tutte[i], b: tutte[j], corta: tutte[i].split(/\s+/).length <= tutte[j].split(/\s+/).length ? tutte[i] : tutte[j] });
    }
    return out;
  }
  function senzaDoppioni(t) {
    const via = frasiRipetute(t, true);
    if (!via.length) return t;
    const tolte = {};
    return frasiDi(t).map(p => p.filter(f => { if (via.indexOf(f) !== -1 && !tolte[f + '#' + p.indexOf(f)]) { tolte[f + '#' + p.indexOf(f)] = 1; return false; } return true; }).join(' ')).filter(Boolean).join('\n\n');
  }
  function rispostaNeutra(state, content, ev, mostrati) {
    const it = state.interazione;
    const nome = ev.pngNome;
    // frasi che non decidono nulla per il giocatore, combinate in modo che a lungo non si ripetano
    const a = ev.tipo === 'battuta' && nome
      ? [nome + ' non ha altro da aggiungere su questo.', nome + ' ti ascolta senza interromperti.', nome + ' resta zitto un momento.', 'Fra te e ' + nome + ' cala un silenzio breve.', nome + ' non risponde subito.']
      : ['Nessuno risponde subito.', 'Per un momento nessuno si muove.', 'Il tempo passa.', 'Il silenzio dura qualche istante.', 'Intorno a te non cambia niente.'];
    const b = ['Nessuno si scompone.', 'Il momento si allunga.', 'Il silenzio non si scioglie.', 'Qualcuno si schiarisce la voce.', 'Nessuno ha fretta di rompere il silenzio.'];
    const k = (it ? it.conteggio : 0) + ev.n;
    const combos = [];
    for (let x = 0; x < a.length; x++) for (let y = 0; y < b.length; y++) combos.push(a[(k + x) % a.length] + ' ' + b[(k + y + x) % b.length]);
    // prima una coppia in cui nessuna delle due frasi è già stata letta, poi una coppia nuova, infine la prima
    const chiavi = mostrati ? Object.keys(mostrati) : [];
    const letta = fr => chiavi.some(c => c.indexOf(normPar(fr)) !== -1);
    return combos.find(t => !mostrati || (!mostrati[normPar(t)] && !t.split(/(?<=\.)\s+/).some(letta))) || combos.find(t => !mostrati || !mostrati[normPar(t)]) || combos[0];
  }
  function senzaRipetere(state, content, ev, t) {
    if (!t || ev.testoFisso || ev.tipo === 'combattimento' || state.incontro || TIPI_NON_RIPETIBILI.indexOf(ev.tipo) === -1) return t;
    const mostrati = testiMostrati(state, content, ev);
    const pars = String(t).split(/\n\s*\n/);
    const nuovi = pars.filter(p => !mostrati[normPar(p)]);
    if (nuovi.length === pars.length) return t;
    return nuovi.length ? nuovi.join('\n\n') : rispostaNeutra(state, content, ev, mostrati);
  }
  function fallbackText(state, content, ev, opz) {
    let t = senzaDoppioni(senzaRipetere(state, content, ev, fallbackTextBase(state, content, ev, opz)));
    // un PNG prende l'iniziativa se il giocatore gira a vuoto (testo d'autore della scena); con il piano V2 è una battuta del piano
    if (ev.spinta && ev.spinta.testo && !ev.piano && !(opz && opz.v1) && t.indexOf(ev.spinta.testo) === -1) t += '\n\n' + ev.spinta.testo;
    return gx(state, t);
  }
  function fallbackTextBase(state, content, ev, opz) {
    if (ev.testoFisso) return ev.testoFisso;
    // V2: con il narratore su piano la riserva è la prosa del piano del turno (opz.v1 = testo del motore precedente)
    if (!(opz && opz.v1) && ev.piano && PI() && MD() && MD().attivo(state, 'narratore')) { const tp = PI().proseDaPiano(ev.piano); if (tp) return tp; }
    if (ev.resoconto && ev.resoconto.riserva) return ev.resoconto.riserva;
    // interazioni: testo del punto o della battuta, poi ciò che cambia nella
    // scena (stallo, sviluppo, pressione) come paragrafi separati
    if (ev.svoltaTesto || ev.sviluppo || ev.pressioneTesto) {
      return [ev.riserva, ev.svoltaTesto, ev.sviluppo, ev.pressioneTesto].filter(Boolean).join('\n\n');
    }
    if (ev.riserva) return ev.riserva;
    if (ev.tipo === 'esplorazione') return rispostaNeutra(state, content, ev, null);
    if (ev.tipo === 'chiarimento' && ev.preparazione) return ev.motivo;
    if (ev.tipo === 'viaggio_proposto') return ev.pianoViaggio && ev.pianoViaggio.ok ? 'Puoi metterti in viaggio: controlla l\'itinerario sulla mappa e conferma la partenza.' : ((ev.pianoViaggio && ev.pianoViaggio.motivo) || 'Non conosci una strada per arrivarci.');
    if (ev.tipo === 'viaggio') return (MP() && MP().raccontoRiserva(ev)) || (ev.scenaViaggio ? 'Il viaggio prosegue.' : 'Parti. La strada ti porta a destinazione.');
    if (ev.tipo === 'chiarimento') return 'Non è chiaro cosa vuoi fare. ' + (ev.motivo || 'Descrivi l\'azione e a quale scopo.');
    if (ev.tipo === 'rifiutata') return 'Non puoi farlo. ' + (ev.motivo || '');
    if (ev.tipo === 'combattimento') return describeCombat(ev);
    // mai l'apertura della scena: è già stata mostrata
    return rispostaNeutra(state, content, ev, null);
  }

  /* Apertura della scena: variante per l'archetipo del protagonista (V4:
     ingresso diverso per ogni archetipo), altrimenti quella comune. */
  const SPINTA_CFG = { vuoti: 2 }; // giri a vuoto (testo libero senza novità) prima che la spinta compaia; modificabile solo dalle misure
  /* Fili aperti dei PNG (DECISIONI_AUTORE §12–§13, approvate il 6/11/2026; prova della Cavaliera B08–B11). Un PNG ha un filo aperto con
     il protagonista solo se lo dicono i dati o la partita, mai il modello (§12, condizione 1):
       - un'iniziativa d'autore della scena (`spinta[]` con `png`, dentro la sua finestra): la spinta di sempre;
       - un obiettivo aperto della scena che si riferisce a lui (pngDiObiettivo);
       - un filo registrato dalla partita e legato a lui (state.mondo.fili, legatoA «png:<id>»): vale in ogni scena in cui è fra i presenti
         (png_presenti), dove interviene ogni tanto come compagno (§12, compagno nelle scene successive).
     La spinta resta saltuaria (dopo SPINTA_CFG.vuoti giri a vuoto), non cambia l'interlocutore del dialogo e non decide nulla (§12,
     condizione 3). Escalation leggibile (condizione 4): indizio (SPINTA_SENZA_DATI.png), poi insistenza (SPINTA_SENZA_DATI.gesto); una
     spinta di un PNG a cui il comando successivo non risponde (né lui, né il suo obiettivo) è un filo lasciato cadere. Alla terza
     (FILO_CFG.cadute; per storia interazioni.regole.cadute_filo, per PNG png.<id>.cadute_filo) il PNG esce di scena come dicono i dati
     (png.<id>.uscita_filo: { tipo, testo }, in ev.filoUscita); senza dati si allontana soltanto: non spinge più in questa scena, resta
     raggiungibile e non sparisce (condizione 5: un pilastro non sparisce senza un'alternativa d'autore).
     PROPOSTA DA APPROVARE: il campo uscita_filo (oggi assente in tutte le storie) e l'uscita predefinita «si allontana per la scena».
     Cercato prima in aggiornaVuoti, solo-png.js (legami, morte convalidata), solo-mondo.js (fili), solo-improv.js: nessuna regola per il
     filo lasciato cadere. */
  const FILO_CFG = { cadute: 3 };
  const filoDi = (state, id) => ((state.filiPng = state.filiPng || {})[id] = state.filiPng[id] || { cadute: 0, allontanato: null });
  const allontanato = (state, id) => !!(state.filiPng && state.filiPng[id] && state.filiPng[id].allontanato === state.scena);
  // il PNG con un filo aperto in questa scena (il primo: obiettivo della scena, poi filo registrato dalla partita), o null
  function pngConFilo(state, content, sc) {
    // chi sta già parlando con te non ha bisogno di cercarti
    const pres = ((sc && sc.png_presenti) || []).filter(id => content.png[id] && !allontanato(state, id) && !(state.interazione && state.interazione.dialogo === id));
    if (interactionGateOpen(state, content)) {
      for (const ob of (sc.obiettivi || [])) {
        const id = !(state.obiettivi[ob.id] && state.obiettivi[ob.id].completato) && inFinestra(state, ob) ? pngDiObiettivo(content, sc, ob) : null;
        if (id && pres.indexOf(id) !== -1) return id;
      }
    }
    const f = (MD() ? MD().filiAperti(state) : []).find(x => /^png:/.test(x.legatoA || '') && pres.indexOf(x.legatoA.slice(4)) !== -1);
    return f ? f.legatoA.slice(4) : null;
  }
  // il comando appena giocato coinvolge il PNG (dialogo, azione su di lui, il suo obiettivo)?
  function coinvolge(state, content, id, ev, cmd) {
    const sc = sceneOf(content, state.scena), it = state.interazione;
    const ob = ev.obiettivo && (sc.obiettivi || []).find(o => o.id === ev.obiettivo);
    return ev.png === id || (cmd && cmd.png === id) || (it && it.dialogo === id) || !!(ob && pngDiObiettivo(content, sc, ob) === id) || (ev.effetti || []).some(a => a.png === id);
  }
  // l'invito del PNG nel comando precedente è stato lasciato cadere (chi lo raccoglie, anche più tardi, azzera il conto: aggiornaVuoti)
  function rispostaAlFilo(state, content, id, ev, cmd) {
    if (coinvolge(state, content, id, ev, cmd)) return;
    const f = filoDi(state, id);
    f.cadute += 1;
    const p = content.png[id] || {};
    if (f.cadute < (Number(p.cadute_filo) || Number(((content.interazioni || {}).regole || {}).cadute_filo) || FILO_CFG.cadute)) return;
    const u = p.uscita_filo || {};
    f.cadute = 0; f.allontanato = state.scena;
    ev.filoUscita = { png: id, tipo: u.tipo || 'si_allontana', testo: u.testo || null };
  }
  function aggiornaVuoti(stateIn, state, content, ev, cmd) {
    const it = state.interazione, prima = stateIn.interazione;
    if (!it || it.scena !== state.scena) return;
    // l'ultima spinta di un PNG nella stessa scena: questo comando le risponde o la lascia cadere
    const prec = (stateIn.eventi || [])[stateIn.eventi.length - 1];
    Object.keys(state.filiPng || {}).forEach(id => { if (state.filiPng[id].cadute && coinvolge(state, content, id, ev, cmd)) state.filiPng[id].cadute = 0; });
    if (prec && prec.scena === state.scena && stateIn.scena === state.scena && prec.spinta && prec.spinta.png) rispostaAlFilo(state, content, prec.spinta.png, ev, cmd);
    const libero = cmd && cmd.sorgente === 'testo' && ['azione', 'esplorazione', 'battuta', 'oracolo', 'improvvisazione'].indexOf(ev.tipo) !== -1;
    const progresso = !prima || prima.scena !== it.scena || it.beats.length > prima.beats.length || !!ev.obiettivo || !!ev.sceltaId || (!!ev.passo && ev.esito === 'successo') || (ev.effetti || []).some(a => a.tipo === 'scena' || a.tipo === 'obiettivo_tentato') || !!(ev.conoscenza && ev.conoscenza.livello > 0 && !ev.conoscenza.gia);
    if (progresso) { it.vuoti = 0; return; }
    if (!libero) return;
    it.vuoti = (it.vuoti || 0) + 1;
    const sc = sceneOf(content, state.scena);
    const lista = ((sc && sc.spinta) || []).filter(x => inFinestra(state, x) && !(x.png && allontanato(state, x.png)));
    if (it.vuoti >= SPINTA_CFG.vuoti) {
      let sp = lista.length ? lista[(it.spinte || 0) % lista.length] : null;
      if (!sp) {
        const hint = it.modo !== 'semi' ? nextRequired(state, content) : null;
        const ob = (sc && sc.obiettivi || []).find(o => !(state.obiettivi[o.id] && state.obiettivi[o.id].completato));
        // senza un'iniziativa scritta dall'autore: un presente o il luogo offrono un appiglio (dai dati della scena); il passo che manca
        // compare fra le azioni proposte, non nel racconto
        const pres = ((sc && sc.png_presenti) || []).filter(id => content.png[id]);
        const def = sceneInteractions(content, state.scena);
        // il passo che manca è un argomento di un presente: è lui a cercarti
        const chi = hint && def && (def.dialoghi || []).find(d => (d.argomenti || []).some(a => a.id === hint.id) && pres.indexOf(d.png) !== -1);
        // fili aperti (§12): spinge il PNG che ha un filo con il protagonista; nessun altro presente fa capire «qui non avete ancora finito»
        // senza che i dati lo dicano (prova della Cavaliera, B11: lo spettro lo «diceva» per l'obiettivo del burattinaio)
        const filo = !chi && pngConFilo(state, content, sc);
        const dati = (hint || ob) && (pres.map(id => situazionePng(state, content, id)).find(Boolean) || dettaglioLuogo(state, content));
        const k = (it.spinte || 0) + ev.n;
        const insiste = filo && filoDi(state, filo).cadute > 0;
        const t = chi ? generica(state, 'spinta:png', SPINTA_SENZA_DATI.png, k).replace('{N}', primoNome(content, chi.png))
          : filo ? generica(state, insiste ? 'spinta:gesto' : 'spinta:png', insiste ? SPINTA_SENZA_DATI.gesto : SPINTA_SENZA_DATI.png, k).replace('{N}', primoNome(content, filo))
          : !(hint || ob) ? '' : dati || generica(state, 'spinta:luogo', SPINTA_SENZA_DATI.luogo, k);
        const chiSpinge = chi ? chi.png : filo || null;
        if (t) sp = { png: chiSpinge, testo: t };
      }
      if (sp) { it.spinte = (it.spinte || 0) + 1; it.vuoti = 0; ev.spinta = { png: sp.png || null, testo: sp.testo }; }
    }
  }

  /* Intenzione di avanzare (docs/single-player/TRAMA_NEL_GIOCO.md): una frase che corrisponde al passo successivo della scena
     lo apre. A cancello chiuso è il prossimo punto richiesto; a cancello aperto è il tentativo dell'obiettivo. Ritorna i comandi o null. */
  /* Una frase porta avanti la scena solo verso il passo di cui parla (parlaDi), non verso il primo passo aperto: «Afferro Astrid e le
     intimo di parlare» non è «Raccogliere il fiore». Una richiesta di muoversi del gruppo («andiamo», «proseguiamo»; non una domanda)
     vale per il passo successivo. Rivolgersi per nome a un PNG (opz.png) porta avanti solo il dialogo con lui; altrimenti si torna null
     e la frase resta del giocatore (azione aperta, dialogo, esplorazione libera). */
  const MUOVERSI = /\b(muover(ci|e|si|mi)\b|muoviam\w*|muoviti|mi muovo|andiam\w*|vado avanti|avanziam\w*|avanzo|procediam\w*|procedo|proseguiam\w*|proseguo|seguiam\w*|usciam\w*|partiam\w*|corriam\w*|continuiam\w*|continuo|entriam\w*|avviciniam\w*|in marcia|esco\b|uscire\b|uscirne\b|scappo\b|scappare\b|fuggo\b|fuggire\b|me ne vado\b|andarmene\b|vado via\b|mi allontano\b|allontanarmi\b|mi sposto\b|spostarmi\b|(?:vi |ti |li |lo |la |le )seguo\b(?! con)|seguo (?!il |lo |la |le |gli |i |l'|con |un |una )\w+|seguirti\b|seguirvi\b|seguirlo\b|seguirla\b|raggiungo\b|raggiungere\b|proseguire\b|avanzare\b)/gi;
  // una proposta o un desiderio detti a qualcuno non sono uno spostamento: il PNG reagisce, nessuno si è mosso
  const PROPOSTA_DETTA = /\b(che ne dici|che ne pensi|ti va|vi va|vogliamo|possiamo|potremmo|dovremmo|propongo|suggerisco|vorrei|dovrei|potrei)\b/i;
  // parole che non cambiano una richiesta di muoversi («andiamo avanti, ragazzi», «forza, proseguiamo»)
  const SOLO_MOVIMENTO = /^(avanti|oltre|insieme|subito|adesso|allora|pure|forza|presto|ragazzi|tutti|bene|ancora|quindi|piano|svelti|veloci|provo|tento|cerco|fuori|voglio)$/;
  /* Una richiesta di muoversi «e basta»: niente destinazione, bersaglio o altra azione («seguiamo quella persona», «muoviamoci verso
     il fiume», «continuo a frugare» non lo sono). Non una domanda. I nomi dei PNG a cui ci si rivolge non contano. */
  function soloMovimento(content, t) {
    t = senzaNegati(t);   // «non andiamo avanti» non è una richiesta di muoversi
    if (/\?/.test(t) || !new RegExp(MUOVERSI.source, 'i').test(t)) return false;
    const nomi = radiciNomi(content, t);
    return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(MUOVERSI, ' ').split(/[^a-z]+/)
      .filter(w => w.length >= 4 && !SOLO_MOVIMENTO.test(w) && nomi.indexOf(w.slice(0, 5)) === -1).length === 0;
  }
  const PAROLE_DEL_DIALOGO = /^(ascol|parla|parli|chied|domand|dimmi|racco|rispo|sentir|sapere|vogli|voler|dirmi|spieg)/;
  function avanzamento(state, content, testo, opz) {
    // B08/B11: con l'uscita pronta, il suo pulsante o una frase di partenza (la stessa della campagna lunga: «proseguo», «me ne vado»,
    // «lascio questo luogo»; oppure una richiesta di muoversi e basta), non una domanda né un rifiuto, lasciano la scena
    const u = uscitaPronta(state, content), tu = senzaNegati(testo);
    if (u && !/\?/.test(tu) && (String(testo || '').trim() === etichettaUscita(u) || soloMovimento(content, testo) || (ST() && ST().intenzioneDiUscire(tu)))) return [{ tipo: 'prosegui', sorgente: 'testo', testo }];
    const sc = sceneOf(content, state.scena);
    const av = sc && sc.avanzamento;
    const it = state.interazione;
    if (!av || !(av.intenti || []).length || !it || it.scena !== state.scena || state.incontro || isOver(state)) return null;
    let re;
    try { re = new RegExp('(?:' + av.intenti.join('|') + ')', 'i'); } catch (e) { return null; }
    const t = String(testo || '');
    // verbo di movimento con una meta che la scena conosce («Esco dalle rovine»: l'obiettivo è «Uscire dalle rovine…»)
    const meta = !/\?/.test(t) && !PROPOSTA_DETTA.test(t) && new RegExp(MUOVERSI.source, 'i').test(senzaNegati(t))
      && [].concat((sc.obiettivi || []).map(o => o.testo), (sc.suggerimenti || []).map(x => x.testo)).some(x => x && parlaDi(content, t, x) > 0);
    const muove = soloMovimento(content, t) && !PROPOSTA_DETTA.test(t) || meta;
    // una richiesta di muoversi vale in ogni scena che ha un avanzamento, anche se le sue parole d'intento non la elencano («proseguo»)
    if (!muove && !re.test(senzaNegati(t))) return null;   // una parola d'intento dentro un rifiuto non apre il passo
    const verso = (opz && opz.png) || null;
    const pertinente = passo => !verso && parlaDi(content, t, passo) > 0;
    // rivolgendosi a un PNG si apre anche il punto richiesto che lo riguarda, se la frase ne nomina il contenuto: «Astrid, qual è la
    // notizia…?» → «Ascoltare la notizia di Astrid» (registro del 5/11/2026). Disponibilità e finestra restano quelle del punto; i verbi
    // del parlare non bastano («Astrid, ti ascolto» resta un dialogo libero), né basta il nome.
    const nomeVerso = verso ? roots(pngName(content, verso)) : [];
    // Anche una domanda che chiede che cosa sa o che cosa è successo («Astrid, che cosa è successo al villaggio?») apre il punto di quel PNG
    // che consiste nell'ascoltarlo («Ascoltare la notizia di Astrid»): il punto comincia con un verbo del dialogo e la domanda lo chiede
    // (registro del 5/11/2026, turno 4). «Astrid, come stai?» no: non chiede informazioni.
    const domanda = /\?/.test(senzaNegati(t)) && /(^|[^a-zà-ú])(?:(?:che|cosa|perch[eé]|come mai|qual\w*|chi|dove|quando|novit[aà])(?:[^a-zà-ú]|$)|cos['’])/i.test(senzaNegati(t));
    const delPng = passo => {
      if (!verso || !nomeVerso.length || !roots(passo).some(r => nomeVerso.indexOf(r) !== -1)) return false;
      const nomi = radiciNomi(content, t);
      const have = roots(passo);
      if (domanda && PAROLE_DEL_DIALOGO.test(have[0] || '')) return true;
      return roots(senzaNegati(t)).some(w => nomi.indexOf(w) === -1 && !PAROLE_DEL_DIALOGO.test(w) && have.indexOf(w) !== -1);
    };
    const AZ = global.RMSoloAzioni;
    const osserva = AZ && AZ.atto(t) === 'esaminare';
    // osservare non tenta l'obiettivo di un altro atto, a meno che la frase non ne contenga anche il verbo («guardo il fiore e lo raccolgo»)
    const radT = roots(senzaNegati(t));
    const chiedeAltro = (testo, atto) => osserva && atto !== 'esaminare' && radT.indexOf(roots(testo)[0]) === -1;
    if (interactionGateOpen(state, content)) {
      const aperti = (sc.suggerimenti || []).filter(x => !(state.obiettivi[x.obiettivo] && state.obiettivi[x.obiettivo].completato));
      let sug = null, meglio = 0;
      // osservare non è tentare l'obiettivo di un altro atto: «Esamino il fiore senza raccoglierlo» non è «Raccogliere il fiore»
      // (registro del 5/11/2026); le parole della cosa coincidono, l'atto no. Un obiettivo che è osservare resta raggiungibile.
      // Conta l'atto dell'obiettivo, non solo quello del suggerimento: «Guardo bene fra l'erba» porta a «Raccogliere il fiore» solo dal
      // suo pulsante (che passa la proposta diretta), non da un'osservazione scritta (5/11/2026, richiesta dell'autore).
      if (!verso) aperti.forEach(x => {
        const ob = (sc.obiettivi || []).find(o => o.id === x.obiettivo) || {};
        if (chiedeAltro(x.testo, AZ.atto(x.testo)) || (ob.testo && chiedeAltro(ob.testo, AZ.atto(ob.testo)))) return;
        // conta prima il suggerimento (il suo tratto è quello dell'azione scritta: «Raccolgo il fiore» → Spirito), poi l'obiettivo
        const n = parlaDi(content, t, x.testo) * 100 + parlaDi(content, t, ob.testo);
        if (n > meglio) { meglio = n; sug = x; }
      });
      if (!sug && muove) sug = aperti[0];
      if (!sug) return null;
      return [{ tipo: 'azione', sorgente: 'testo', testo, proposta: { tipo: 'azione', obiettivo: sug.obiettivo, tratto: sug.tratto, oggetto: 'nessuno', qualita: 'normale' } }];
    }
    const def = sceneInteractions(content, state.scena);
    const req = requiredBeats(def, it).filter(id => it.beats.indexOf(id) === -1);
    for (const id of req) {
      const p = allPoints(def, it).find(x => x.id === id && pointAvailable(state, x));
      if (p) {
        // anche fuori dai suggerimenti osservare non apre un punto che chiede un altro atto («Raccogliere…»)
        const attoPunto = osserva && AZ.atto(p.testo);
        if (attoPunto && chiedeAltro(p.testo, attoPunto)) continue;
        if (muove || pertinente(p.testo) || delPng(p.testo)) return [{ tipo: 'esplora', punto: id, sorgente: 'testo', testo }];
        continue;
      }
      for (const d of def.dialoghi || []) {
        const a = (d.argomenti || []).find(x => x.id === id && inFinestra(state, x));
        if (!a || !dialogsAvailable(it)) continue;
        if (verso ? verso !== d.png : !(muove || pertinente(a.testo))) continue;
        return (it.dialogo === d.png ? [] : [{ tipo: 'dialogo_inizia', png: d.png, sorgente: 'testo', testo }]).concat([{ tipo: 'battuta', argomento: id, sorgente: 'testo', testo }]);
      }
    }
    return null;
  }

  /* Le frasi di un testo che contengono una battuta fra virgolette già mostrata al giocatore nella scena: si tolgono (il resto resta).
     Le battute già dette sono quelle dell'apertura della scena e dei racconti precedenti; vale anche se allora erano spezzate in più
     citazioni («Messaggeri degli Asi» dice Argus… «Pensi che…»). Se non resta niente, il testo resta com'era. */
  const CITAZIONE = /«([^»]+)»/g;
  const normCit = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const citazioni = t => { const out = []; let m; const re = new RegExp(CITAZIONE.source, 'g'); while ((m = re.exec(String(t || '')))) out.push(normCit(m[1])); return out; };
  // per ogni testo già mostrato nella scena, le parole delle sue battute (unite: una battuta spezzata in due citazioni resta una)
  function battuteGiaDette(state, content, sceneId) {
    const mostrati = [sceneOpeningText(state, content, sceneId)].concat((state.eventi || []).filter(e => e.scena === sceneId && e.narrazione && e.narrazione.testo).map(e => e.narrazione.testo));
    return mostrati.map(t => new Set(citazioni(t).join(' ').split(' ').filter(w => w.length >= 3))).filter(x => x.size);
  }
  // una citazione di almeno quattro parole piene, quasi tutte (85%) già in una battuta mostrata: anche con un refuso («bruto»)
  function citazioneGiaDetta(q, dette) {
    const w = normCit(q).split(' ').filter(x => x.length >= 3);
    return w.length >= 4 && dette.some(d => w.filter(x => d.has(x)).length / w.length >= 0.85);
  }
  function senzaBattuteGiaDette(state, content, testo, sceneId) {
    const dette = battuteGiaDette(state, content, sceneId);
    if (!dette.length) return testo;
    const out = String(testo).split(/\n\n/).map(par => par.split(/(?<=[.!?…»])\s+(?=[«A-ZÀ-Ú])/).filter(f => !citazioni(f).some(q => citazioneGiaDetta(q, dette))).join(' ')).filter(p => p.trim()).join('\n\n');
    return out.trim() ? out : testo;
  }
  function sceneOpeningText(state, content, sceneId) {
    const sc = sceneOf(content, sceneId);
    if (!sc) return '';
    const per = sc.apertura_per_archetipo && state && state.personaggio && sc.apertura_per_archetipo[state.personaggio.archetipo];
    const testoScena = per || sc.apertura_riserva || '';
    return state && state.apertura && AP() && content.scene[0] && content.scene[0].id === sceneId ? AP().testo(state, content, testoScena) : testoScena;
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
      // spostamenti sulla griglia dello scontro
      if (a.tipo === 'movimento' && a.chi === 'pg') parts.push('Ti sposti di ' + a.caselle + (a.caselle === 1 ? ' casella.' : ' caselle.'));
      if (a.tipo === 'movimento' && a.chi === 'nemico' && a.griglia) parts.push(a.nome + ' si avvicina.');
    });
    if (ev.incontroEsito === 'vittoria') parts.push(ev.testoVittoria || 'Il nemico crolla.');
    if (ev.incontroEsito === 'fuga') parts.push(ev.testoFuga || 'Riesci a sganciarti e a fuggire.');
    if (ev.incontroEsito === 'sconfitta') parts.push(ev.testoSconfitta || 'Cadi a terra e riesci a stento a metterti in salvo.');
    return parts.join(' ');
  }

  /* Azioni disponibili dopo un comando (etichette, nell'ordine dei
     pulsanti): parte del resoconto, mostrate dopo conseguenza e riepilogo. */
  function nextActions(state, content) {
    if (isOver(state)) return [];
    const pg = state.personaggio;
    if (state.incontro) {
      return pg.abilita.concat(pg.tecniche, capacityList(pg, 'gemma')).map(a => a.nome).concat((pg.capacitaSpeciali || []).filter(a => !a.fuoriSlot && capacityStatus(state, content, 'speciale', a).ok).map(a => a.nome), ['Attacco con l\'arma'], fugaImpedita(state, content) ? [] : ['Fuga']);
    }
    const io = interactionOptions(state, content);
    if (io && io.dialogo) return io.dialogo.argomenti.map(a => a.testo).concat(['Congedati']);
    if (io && io.sceltaIncontro) return ['Affronta ' + io.sceltaIncontro.nemico, io.sceltaIncontro.alternativa];
    const sc = currentScene(state, content);
    const out = [];
    if (!io || io.aperta) {
      (sc.suggerimenti || []).filter(x => !(state.obiettivi[x.obiettivo] && state.obiettivi[x.obiettivo].completato) && inFinestra(state, (sc.obiettivi || []).find(o => o.id === x.obiettivo))).forEach(x => out.push(x.testo));
      if (!state.scelte[sc.id]) (sc.scelte || []).filter(c => choiceAvailable(state, c)).forEach(c => out.push(c.testo));
    }
    if (io) { io.dialoghi.forEach(d => out.push('Parla con ' + d.nome)); io.esplora.forEach(p => out.push(p.testo)); }
    // B08: l'uscita pronta è un'azione proposta (il giocatore può sempre andarsene)
    const u = uscitaPronta(state, content);
    if (u) out.push(etichettaUscita(u));
    return out;
  }
  const api = { nextActions, sceneOf, itemInfo };

  global.RMSoloEngine = {
    SPINTA_CFG, FILO_CFG, uscitaPronta, etichettaUscita, ETICHETTA_USCITA, pngDiObiettivo, luogoCorrente, fuoriParte,
    SCHEMA, SoloError, RAVEN_TESTO, battuteGiaDette, citazioneGiaDetta, newGame, applyCommand, attachNarration, verificaNarrazione, presentiEffettivi, provaVolontaria, sondaProva, proponiProva, annullaProva, comandoDaTirare, validateNarration, oggettiConsegnati,
    validateArchetype, sheetFromArchetype, validateProposal, fallbackText, currentScene, sceneOf,
    itemDef, itemInfo, hasItem, isOver, ravenText, conditionMet, resolvePng, OPERAZIONI,
    publicArchetypeTexts, tickCost, bandFor, sceneOpeningText, choiceAvailable, trattiOfferti,
    interactionOptions, interactionGateOpen, trovaPasso, puntoDiTesto, senzaNegati, finestra, inFinestra, testiInFinestra, bonusTratto, schedaConBonus, descrizioneScena, motivazionePng, sceneInteractions, radici, avanzamento, testoInterno, TESTO_INTERNO_RE, FRASI_DI_SERVIZIO, fraseDiServizio, frasiRipetute, frasiQuasiUguali, senzaDoppioni, dettaglioLuogo, generica, haDaCurare, SPINTA_SENZA_DATI, STALLO_SENZA_DATI, situazionePng, giaLetto, TESTI_AZIONE,
    capacityStatus, capacityList, gemInfo, gemRecovery, inventoryBlocked, migrate, nextActions, fugaImpedita, difeseProtagonista,
    capGaps, effectiveCap, archetypeReady, BLOCCANTI,
    improvementOptions, improvementQuote, wearEquip, durabilitaCorrente, levelUpMancante, devSimulaLevelUp, devDanneggiaEquip,
    riprovaStato, azzeraStile, RIPROVE_MAX, impostaOpzione,
    slotOffers, slotLiberi, boostInfo, boostAttivoOra, grigliaInfo,
    pregiOpzioni, pregiInAttesa, PASSO_CRESCITA, LV_MAX_CAPACITA, utilizziPerLivello, munizioniArma
  };

  /* Genere: i dati della storia hanno i segnaposto {m|f|n}; ogni funzione pubblica riceve la copia già risolta
     per il genere della scheda (una volta sola per contenuto e genere, vedi js/solo/solo-genere.js). Una scheda
     senza genere vale «neutro». */
  (function () {
    const E = global.RMSoloEngine;
    const eContent = x => x && typeof x === 'object' && Array.isArray(x.scene) && x.png && x.fatti;
    const eState = x => x && typeof x === 'object' && x.personaggio && x.storia;
    Object.keys(E).forEach(k => {
      const f = E[k];
      if (typeof f !== 'function' || f === SoloError) return;
      E[k] = function () {
        const args = Array.prototype.slice.call(arguments);
        if (GN()) {
          const st = args.find(eState);
          const g0 = st ? st.personaggio.genere : null, n0 = st ? st.personaggio.nome : null;
          args.forEach((a, i) => {
            if (eContent(a)) args[i] = GN().contenuto(a, g0, n0);
            // opzioni { content, ... } (applyCommand, newGame…): genere e nome vengono dalla partita o dall'archetipo
            else if (a && typeof a === 'object' && eContent(a.content)) args[i] = Object.assign({}, a, { content: GN().contenuto(a.content, st ? g0 : (a.archetipo ? a.archetipo.genere : null), st ? n0 : (a.archetipo ? a.archetipo.nome : null)) });
          });
        }
        return f.apply(this, args);
      };
    });
  })();
})(typeof window !== 'undefined' ? window : globalThis);
