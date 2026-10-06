/* Single player — campagna lunga (rm-solo-struttura/1).

   Gerarchia: campagna → atto → macro-capitolo → arco locale → scena →
   sottoscena → turno. Le scene attuali della campagna sono MACRO-CAPITOLI
   (stesso id: macroChapterId = id precedente); dentro ciascuno il motore
   genera scene interne con una funzione e una trasformazione possibile.

   Regole:
   - un obiettivo, una scelta, uno scontro o una trasformazione locale non
     chiudono MAI il macro-capitolo: si esce quando le condizioni NARRATIVE
     di quel capitolo sono soddisfatte (funzione, snodo, tema, arco se
     previsto, conseguenze indispensabili, posizione, minacce) e il
     giocatore decide di proseguire. Nessun contatore, nessun elenco di
     interazioni da consumare, nessun obbligo di parlare con tutti;
   - budget e pianificatore sono strumenti di regia: orientano, registrano,
     non forzano e non bloccano nulla;
   - il livello deriva solo dagli AP (tacche) e dalle soglie approvate: la
     struttura segnala gli eventi che meritano AP (chiavi uniche, mai per
     azioni ripetute), il motore li assegna con le quantità approvate;
   - ogni cambiamento (legami, tradimenti, morti, fili, contenuti secondari,
     archi personali, dialettica tematica) è derivato dallo stato, con cause
     leggibili; niente tiri casuali;
   - memoria a lungo termine e contesto compatto costruiti dagli eventi del
     motore, mai dal testo dell'IA; nessuna chiamata al modello in più.
   Attivo solo quando i contenuti caricano <storia>-struttura.json. */
(function (global) {
  'use strict';
  const VERSIONE = 2;
  const E = () => global.RMSoloEngine;
  const C = () => global.RMSoloCampaign;
  const IM = () => global.RMSoloImprov;
  const P = () => global.RMSoloPng;

  const CATEGORIE = ['principali', 'relazionali', 'esplorative', 'indagini', 'ostacoli', 'incontri', 'combattimenti', 'secondari', 'conseguenze', 'decompressione', 'trasformazioni', 'trasformazioneConclusiva', 'richiami', 'preparazioni'];
  // etichette del pianificatore (richiesta dell'autore) → categorie interne
  const PIANO = { principali: 'principali', archiSecondari: 'secondari', relazionali: 'relazionali', esplorazione: 'esplorative', indagini: 'indagini', conflitti: 'incontri', combattimenti: 'combattimenti', conseguenze: 'conseguenze', preparazione: 'preparazioni', decompressione: 'decompressione', richiami: 'richiami', trasformazioni: 'trasformazioni', ostacoli: 'ostacoli', trasformazioneConclusiva: 'trasformazioneConclusiva' };
  /* Funzioni narrative dichiarate da ogni scena interna (elenco
     dell'autore): almeno una, derivata dalla categoria e dalla fonte. */
  const FUNZIONI_NARRATIVE = ['avanzamento_conflitto', 'relazione', 'esplorazione', 'scoperta', 'scelta', 'conseguenza', 'preparazione', 'sviluppo_personale', 'sviluppo_tematico', 'decompressione', 'trasformazione_posizione'];
  const FUNZIONI_DI = {
    principali: ['avanzamento_conflitto', 'scelta'], relazionali: ['relazione'], esplorative: ['esplorazione', 'scoperta'], indagini: ['scoperta'],
    ostacoli: ['avanzamento_conflitto'], incontri: ['avanzamento_conflitto', 'relazione'], combattimenti: ['avanzamento_conflitto'], secondari: ['conseguenza', 'relazione'],
    conseguenze: ['conseguenza'], decompressione: ['decompressione'], trasformazioni: ['sviluppo_personale', 'sviluppo_tematico'],
    trasformazioneConclusiva: ['trasformazione_posizione', 'sviluppo_tematico'], richiami: ['relazione', 'conseguenza'], preparazioni: ['preparazione']
  };
  // collegamento tematico registrato nello stato di regia (mai mostrato)
  const TEMI_DI = {
    principali: 'conflitto_atto', relazionali: 'relazione', esplorative: 'obiettivo', indagini: 'obiettivo', ostacoli: 'obiettivo', incontri: 'conflitto_atto',
    combattimenti: 'conflitto_atto', secondari: 'conseguenza', conseguenze: 'conseguenza', decompressione: 'relazione', trasformazioni: 'arco_personale',
    trasformazioneConclusiva: 'tema_campagna', richiami: 'relazione', preparazioni: 'obiettivo'
  };
  const FUNZIONI = {
    principali: 'far avanzare la questione del capitolo', relazionali: 'mettere alla prova o cambiare un rapporto',
    esplorative: 'scoprire il luogo e ciò che nasconde', indagini: 'seguire una traccia aperta fino a capirla', incontri: 'un conflitto che mette alla prova', combattimenti: 'uno scontro con una posta',
    secondari: 'una faccenda secondaria con conseguenze', conseguenze: 'affrontare ciò che le azioni hanno prodotto',
    decompressione: 'assorbire ciò che è appena accaduto', trasformazioni: 'mettere alla prova chi è il protagonista',
    richiami: 'far tornare un filo o una persona del passato', preparazioni: 'prepararsi a ciò che viene',
    ostacoli: 'superare ciò che si mette di traverso all\'obiettivo', trasformazioneConclusiva: 'il cambiamento che chiude la questione del capitolo'
  };
  const TRASFORMAZIONI_CAT = {
    principali: ['obiettivo', 'scelta', 'snodo'], relazionali: ['relazione', 'dialogo_svolta', 'promessa', 'legame'],
    esplorative: ['verita', 'scoperta'], indagini: ['scoperta', 'verita', 'secondario'], incontri: ['incontro', 'relazione', 'dialogo_svolta'], combattimenti: ['incontro'],
    secondari: ['secondario'], conseguenze: ['conseguenza', 'cura'], decompressione: ['riposo', 'cura', 'relazione'],
    trasformazioni: ['arco'], richiami: ['richiamo', 'relazione'], preparazioni: ['oggetto', 'riposo'],
    ostacoli: ['obiettivo', 'scoperta', 'conseguenza'], trasformazioneConclusiva: ['snodo', 'scelta', 'arco']
  };
  const PESO = { obiettivo: 2, scelta: 3, snodo: 3, verita: 1, scoperta: 2, relazione: 2, dialogo_svolta: 2, promessa: 2, legame: 3, incontro: 3, conseguenza: 2, cura: 2, riposo: 2, oggetto: 1, secondario: 2, arco: 3, richiamo: 2 };
  const CAT_DI = { obiettivo: 'principali', scelta: 'principali', snodo: 'principali', verita: 'esplorative', scoperta: 'esplorative', relazione: 'relazionali', dialogo_svolta: 'relazionali', promessa: 'relazionali', legame: 'relazionali', incontro: 'combattimenti', conseguenza: 'conseguenze', cura: 'conseguenze', riposo: 'decompressione', oggetto: 'preparazioni', secondario: 'secondari', arco: 'trasformazioni', richiamo: 'richiami' };
  const SECONDARI = ['favore', 'debito', 'ricerca', 'consegna', 'soccorso', 'indagine', 'rivalita', 'commercio', 'rito', 'rovina', 'diceria', 'oggetto_smarrito', 'ritorno_nemico', 'ferita', 'promessa', 'testimone', 'rifugio', 'mappa', 'prova_personale'];
  const CLAUSOLE = ['funzione', 'snodo', 'tema', 'arco', 'conseguenze', 'minacce', 'posizione', 'decisione'];
  const MOTIVI_CLAUSOLA = {
    funzione: 'la questione di questo luogo non ha ancora trovato una via d\'uscita',
    snodo: 'il passaggio che porta oltre non è ancora maturo',
    tema: 'non hai ancora preso posizione su ciò che qui è in gioco',
    arco: 'qualcosa in te è ancora in sospeso, qui',
    conseguenze: 'c\'è ancora una decisione che qui aspetta te',
    minacce: 'il pericolo ti sbarra ancora la strada',
    posizione: 'prima devi uscire da ciò che stai facendo'
  };

  function S(content) { return content && content.struttura ? content.struttura : null; }
  function attivo(content) { return !!(S(content) && S(content).macroCapitoli); }
  function macroDef(content, id) { return S(content).macroCapitoli[id] || null; }
  function stimaToken(t) { return Math.ceil(String(t || '').length / 3.5); }

  /* ----------------------------------------------------- stato e migrazione */
  function vuoto() {
    return {
      versione: VERSIONE, macro: null, atto: 1, arcoLocale: null, arcoN: 0, scene: [], scena: null, sottoscena: null, sottoscenaN: 0, focus: null, turno: 0,
      storico: [], prove: {}, budget: {}, conoscenze: [], dialettica: [], arco: [], png: {}, secondari: [], latenti: [], memoria: { capitoli: [], atti: [] },
      uscitaPronta: null, epilogo: null, livelli: []
    };
  }
  function stato(state) { return state.campagna; }

  /* Salvataggi precedenti: la scena corrente diventa il macro-capitolo
     corrente, quelle lasciate (riassunti del motore) diventano capitoli
     chiusi con contratto "migrato"; conoscenze dai fatti e dalle verità. */
  function migra(state, content) {
    if (!attivo(content) || !state || !state.scena) return state;
    let c = state.campagna;
    if (c && c.versione === VERSIONE && c.macro) return state;
    // versione 1 → 2: contenuti secondari a fasi, latenti, contratto narrativo
    if (c && c.versione === 1 && c.macro) {
      c.versione = VERSIONE;
      c.latenti = c.latenti || [];
      (c.secondari || []).forEach(x => { x.fase = x.fase || 'aggancio'; x.ultimaScena = x.ultimaScena || null; x.tipoCausa = x.tipoCausa || null; });
      c.uscitaPronta = null;
      return state;
    }
    const png = c && c.png ? c.png : {};
    c = state.campagna = Object.assign(vuoto(), { png });
    (state.memoria && state.memoria.riassunti || []).forEach(r => {
      const m = macroDef(content, r.scena) || {};
      c.storico.push({ macro: r.scena, atto: m.atto || null, entrato: r.eventi[0] || null, chiuso: r.eventi.slice(-1)[0] || null, contratto: 'migrato' });
      c.memoria.capitoli.push({ id: 'cap-' + r.scena, livello: 'macro', macro: r.scena, atto: m.atto || null, titolo: r.titolo, riassunto: r.testo, decisioni: [], conseguenze: [], png: {}, filiAperti: [], filiChiusi: [], trasformazioni: [], tema: [], arco: [], secondari: [], eventi: r.eventi, fonte: 'migrazione' });
    });
    (state.fattiScoperti || []).forEach(f => aggiungiConoscenza(state, content, { id: 'k:' + f, contenuto: (content.fatti[f] || {}).testo || f, fonte: 'motore', metodo: 'migrazione', entita: [f].concat(Object.keys(content.png || {}).filter(p => (content.png[p].sa || []).indexOf(f) !== -1)), affidabilita: 'certa', statoEpistemico: 'confermato', macro: null, evento: null }));
    (state.veritaScoperte || []).forEach(v => aggiungiConoscenza(state, content, conoscenzaVerita(content, v.scena, v.id, v.metodo, null)));
    apriMacro(state, content, state.scena, null, [], 'migrazione');
    return state;
  }

  /* ----------------------------------------------------- conoscenze */
  function verita(content, scena, id) { const d = content.narrativa && content.narrativa.scene && content.narrativa.scene[scena]; return d ? (d.requiredTruths || []).find(t => t.id === id) || null : null; }
  function conoscenzaVerita(content, scena, id, metodo, evN) {
    const t = verita(content, scena, id);
    const fonti = t ? (t.allowedSources || []).filter(x => /^png:/.test(x)).map(x => x.slice(4)) : [];
    const cls = content.semi && content.semi.verita && content.semi.verita[id];
    return {
      id: 'k:' + id, contenuto: t ? t.canonicalContent : id, fonte: fonti[0] || 'luogo', metodo: metodo || 'osservazione',
      entita: [id].concat(t ? t.evidenceIds || [] : [], fonti), affidabilita: metodo === 'dialogo' ? 'testimonianza' : 'diretta',
      statoEpistemico: cls ? cls.statoEpistemico : (metodo === 'dialogo' ? 'testimoniato' : 'osservato'), visibilita: 'giocatore', scena: null, macro: scena, evento: evN
    };
  }
  function aggiungiConoscenza(state, content, k) {
    const c = state.campagna;
    if (!k || c.conoscenze.some(x => x.id === k.id)) return false;
    c.conoscenze.push(Object.assign({ visibilita: 'giocatore', scena: c.scena }, k));
    return true;
  }
  // conoscenze di macro-capitoli precedenti con entità in comune con i riferimenti
  function conoscenzePrecedenti(state, rif) {
    const c = state.campagna; if (!c) return [];
    const r = new Set(rif || []);
    return c.conoscenze.filter(k => k.macro !== state.scena && k.entita.some(x => r.has(x)));
  }
  function riferimenti(content, macro, tipo, id) { const m = attivo(content) && macroDef(content, macro); return m && m.riferimenti ? (m.riferimenti[tipo] || {})[id] || null : null; }

  /* ------------------------------------------------ pianificatore adattivo
     Distribuisce lungo i tre atti principali, archi secondari, relazioni,
     esplorazione, indagini, conflitti, combattimenti, conseguenze,
     preparazione, decompressione, richiami e trasformazioni. Misura densità
     e varietà di ciò che è ancora disponibile e propone il prossimo sviluppo
     SOLO se deriva da un elemento persistente della partita. Non impone
     turni minimi, non prolunga le scene, non blocca l'uscita. */
  const ARCHI_SECONDARI_PER_ATTO = { 1: 3, 2: 5, 3: 5 }; // proposta di regia
  function fontiPersistenti(state, content) {
    const c = state.campagna;
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const pres = ((E().sceneOf(content, state.scena) || {}).png_presenti || []).filter(id => !(c.png[id] && c.png[id].stato !== 'vivo'));
    const visti = new Set(c.storico.slice(0, -1).map(h => h.macro));
    const passati = pres.filter(id => Array.from(visti).some(m => ((E().sceneOf(content, m) || {}).png_presenti || []).indexOf(id) !== -1));
    const mem = IM() ? IM().memoria(state) : { fili: [] };
    const io = E().interactionOptions ? E().interactionOptions(state, content) : null;
    const m = macroDef(content, state.scena) || {};
    const idx = (content.scene || []).findIndex(s => s.id === state.scena);
    const prossima = (content.scene || [])[idx + 1] || null;
    const ultime = c.scene.filter(x => x.macro === c.macro).slice(-2).map(x => x.categoria);
    return {
      secondari: c.secondari.filter(x => x.stato === 'aperto' || x.stato === 'tornato').map(x => ({ id: x.id, categoria: x.categoria, fase: x.fase, riferimento: x.riferimento })),
      png: pres,
      pngDelPassato: passati,
      antitesi: pres.filter(id => P() && ['antitesi', 'specchio'].indexOf(P().funzioneDialettica(state, content, id)) !== -1),
      fili: mem.fili.filter(f => f.stato === 'aperto').map(f => f.id),
      dicerie: ((state.sociale || {}).voci || []).map(v => v.id),
      conseguenze: (state.conseguenze || []).filter(x => x.stato === 'pendente').map(x => x.id),
      punti: io && io.esplora ? io.esplora.map(p => p.id) : [],
      minaccia: !!(state.incontro || (it && (it.incontroInAttesa || it.sceltaIncontro))),
      ritorni: c.secondari.filter(x => x.categoria === 'ritorno_nemico' && x.stato === 'tornato').map(x => x.id),
      decompressione: !!(state.narrativa && state.narrativa.pendingAftermath),
      preparazione: !!(prossima && (prossima.incontro || (macroDef(content, prossima.id) || {}).importanza !== 'normale')) || (state.inventario || []).length > 0,
      // un passo dell'arco manca nell'atto, oppure il capitolo lo prevede e non c'è ancora
      arcoDaFare: !!arcoDi(state, content) && (!c.arco.some(e => e.atto === (state.atto || 1)) || (((m.contratto || {}).clausole || []).some(k => k.id === 'arco' && k.richiesta) && !prove(state, state.scena).arco.length)),
      questioneAperta: !!(m.contratto && valutaContratto(state, content, state.scena).mancanti.some(k => ['funzione', 'snodo', 'conseguenze'].indexOf(k) !== -1)),
      // ostacoli: obiettivi della scena con una prova ancora da superare, orologi in corsa
      ostacoli: ((E().sceneOf(content, state.scena) || {}).obiettivi || []).filter(o => o.nc && !(state.obiettivi[o.id] && state.obiettivi[o.id].completato)).map(o => 'obiettivo:' + o.id)
        .concat(Object.entries(state.orologi || {}).filter(([, o]) => o.attivo && o.valore < o.max).map(([k]) => 'orologio:' + k)),
      // la questione è matura: restano solo snodo, tema, arco o conseguenze (niente minacce né uscita dei dati)
      conclusioneMatura: (() => { if (!m.contratto) return false; const mc = valutaContratto(state, content, state.scena).mancanti.filter(k => k !== 'posizione' && k !== 'decisione'); return mc.length > 0 && mc.every(k => ['snodo', 'tema', 'arco', 'conseguenze'].indexOf(k) !== -1); })(),
      ultime
    };
  }
  const SORGENTE = {
    principali: f => f.questioneAperta ? 'capitolo' : null,
    archiSecondari: f => f.secondari[0] ? 'secondario:' + f.secondari[0].id : null,
    relazionali: f => f.png[0] ? 'png:' + f.png[0] : null,
    esplorazione: f => f.punti[0] ? 'punto:' + f.punti[0] : null,
    indagini: f => f.fili[0] ? 'filo:' + f.fili[0] : f.dicerie[0] ? 'voce:' + f.dicerie[0] : (f.secondari.find(x => x.categoria === 'indagine') || {}).id ? 'secondario:' + f.secondari.find(x => x.categoria === 'indagine').id : null,
    conflitti: f => f.antitesi[0] ? 'png:' + f.antitesi[0] : (f.secondari.find(x => x.categoria === 'rivalita') || {}).id ? 'secondario:' + f.secondari.find(x => x.categoria === 'rivalita').id : null,
    combattimenti: f => f.minaccia ? 'minaccia' : f.ritorni[0] ? 'secondario:' + f.ritorni[0] : null,
    conseguenze: f => f.conseguenze[0] ? 'conseguenza:' + f.conseguenze[0] : (f.secondari.find(x => x.categoria === 'ferita' || x.categoria === 'rovina') || {}).id ? 'secondario:' + f.secondari.find(x => x.categoria === 'ferita' || x.categoria === 'rovina').id : null,
    preparazione: f => f.preparazione ? 'prossimo_capitolo' : null,
    decompressione: f => f.decompressione ? 'aftermath' : null,
    richiami: f => f.pngDelPassato[0] ? 'png:' + f.pngDelPassato[0] : null,
    trasformazioni: f => f.arcoDaFare ? 'arco' : null,
    ostacoli: f => f.ostacoli[0] || null,
    trasformazioneConclusiva: f => f.conclusioneMatura ? 'capitolo:conclusione' : null
  };
  function pianifica(state, content) {
    const c = state.campagna;
    const atto = state.atto || 1;
    const macroAtto = Object.values(S(content).macroCapitoli).filter(m => m.atto === atto);
    const target = {}, fatto = {};
    Object.keys(PIANO).forEach(k => { target[k] = 0; fatto[k] = 0; });
    macroAtto.forEach(m => { const b = (c.budget[m.macroChapterId] || {}).previsto || m.budget || {}; Object.entries(PIANO).forEach(([k, cat]) => { target[k] += b[cat] || 0; }); });
    target.indagini = Math.max(target.indagini, Math.round(target.esplorazione / 2));
    target.archiSecondari = ARCHI_SECONDARI_PER_ATTO[atto] || 3;
    const inAtto = new Set(macroAtto.map(m => m.macroChapterId));
    c.scene.filter(x => inAtto.has(x.macro) && x.stato === 'chiusa').forEach(x => { const k = Object.keys(PIANO).find(p => PIANO[p] === x.categoria); if (k) fatto[k] += 1; });
    fatto.archiSecondari = c.secondari.filter(x => x.atto === atto && x.fase !== 'aggancio').length;
    const f = fontiPersistenti(state, content);
    // varietà: non la stessa categoria delle ultime due scene; densità: deficit relativo
    const candidati = Object.keys(PIANO).map(k => ({ k, deficit: (target[k] - fatto[k]) / Math.max(1, target[k]), fonte: SORGENTE[k](f) }))
      .filter(x => x.fonte && x.deficit > 0 && f.ultime.indexOf(PIANO[x.k]) === -1)
      .sort((a, b) => b.deficit - a.deficit);
    return { atto, target, fatto, fonti: f, prossimo: candidati[0] ? { categoria: PIANO[candidati[0].k], voce: candidati[0].k, fonte: candidati[0].fonte } : null, candidati: candidati.map(x => x.k) };
  }

  /* --------------------------------------------------- scene interne */
  /* Budget di regia del capitolo: base dai dati (importanza, funzione
     nell'atto, PNG, conflitti) più i fattori della PARTITA all'ingresso
     (tensioni attive, fili aperti, conseguenze pregresse, secondari
     disponibili, arco personale). Orienta il pianificatore: non è un
     contatore, un cancello né un minimo, e il giocatore non lo vede. */
  function fattoriPartita(state, content, macro) {
    const c = state.campagna;
    const mem = IM() ? IM().memoria(state) : { fili: [] };
    const m = macroDef(content, macro) || {};
    const n = state.narrativa || {};
    const passati = new Set(c.storico.map(h => h.macro).filter(x => x !== macro));
    return {
      tensioniAttive: (n.activeTensionIds || []).length + Object.values(state.orologi || {}).filter(o => o.attivo).length,
      filiAperti: mem.fili.filter(f => f.stato === 'aperto').length,
      conseguenzePregresse: (state.conseguenze || []).filter(x => x.stato === 'pendente').length,
      secondariDisponibili: c.secondari.filter(x => x.stato === 'aperto' || x.stato === 'tornato').length + c.latenti.length,
      arcoDaFare: !!arcoDi(state, content) && !c.arco.some(e => e.atto === (state.atto || 1)),
      pngGiaIncontrati: (m.png || []).filter(id => Array.from(passati).some(x => ((E().sceneOf(content, x) || {}).png_presenti || []).indexOf(id) !== -1)).length
    };
  }
  function budgetMacro(state, content, macro) {
    const m = macroDef(content, macro) || {};
    const c = state.campagna;
    if (!c.budget[macro]) {
      const f = fattoriPartita(state, content, macro);
      const p = Object.assign({}, m.budget || {});
      const piu = (k, v) => { if (k in p || v) p[k] = (p[k] || 0) + v; };
      piu('ostacoli', Math.min(2, Math.floor(f.tensioniAttive / 2)));
      piu('indagini', Math.min(2, Math.floor(f.filiAperti / 2)));
      piu('conseguenze', Math.min(2, f.conseguenzePregresse));
      piu('secondari', Math.min(2, Math.floor(f.secondariDisponibili / 2)));
      piu('trasformazioni', f.arcoDaFare ? 1 : 0);
      piu('richiami', Math.min(2, f.pngGiaIncontrati));
      c.budget[macro] = { previsto: p, base: Object.assign({}, m.budget || {}), fattori: Object.assign({}, m.budgetFattori || {}, { partita: f }), usato: {}, realizzate: {}, oltre: [] };
    }
    return c.budget[macro];
  }
  function motivoCorrente(state, content) {
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    if (state.incontro) return 'minaccia';
    if (it && (it.incontroInAttesa || it.sceltaIncontro)) return 'minaccia';
    if (it && it.dialogo) return 'dialogo:' + it.dialogo;
    const n = state.narrativa;
    if (n && n.pendingAftermath) return 'aftermath';
    const sec = (state.campagna.secondari || []).find(s => s.stato === 'aperto' && s.macro === state.scena && !s.scenaDedicata);
    if (sec) return 'secondario:' + sec.id;
    return null;
  }
  /* Generatore: la categoria viene dalla situazione (minaccia, dialogo,
     decompressione, contenuto secondario, richiamo); altrimenti dal
     pianificatore, che propone solo sviluppi con una fonte persistente.
     Senza fonti disponibili: la questione principale del capitolo. */
  function generaScena(state, content, motivo) {
    const c = state.campagna;
    const b = budgetMacro(state, content, c.macro);
    const m = macroDef(content, c.macro) || {};
    let categoria = null, focus = null, fonte = null;
    const mo = motivo || '';
    if (mo === 'minaccia') { categoria = state.incontro ? 'combattimenti' : 'incontri'; fonte = 'minaccia'; }
    else if (/^dialogo:/.test(mo)) { categoria = 'relazionali'; focus = mo.slice(8); fonte = 'png:' + focus; }
    else if (mo === 'aftermath') { categoria = 'decompressione'; fonte = 'aftermath'; }
    else if (/^secondario:/.test(mo)) { categoria = 'secondari'; focus = mo.slice(11); fonte = mo; }
    else if (mo === 'ingresso') {
      const passati = new Set(c.storico.slice(0, -1).map(h => h.macro));
      const richiamo = (m.png || []).find(p => passati.size && Array.from(passati).some(x => ((E().sceneOf(content, x) || {}).png_presenti || []).indexOf(p) !== -1));
      categoria = richiamo ? 'richiami' : 'esplorative';
      if (richiamo) { focus = richiamo; fonte = 'png:' + richiamo; } else fonte = 'luogo';
    }
    if (!categoria) {
      const pn = pianifica(state, content);
      if (pn.prossimo) { categoria = pn.prossimo.categoria; fonte = pn.prossimo.fonte; focus = /:/.test(fonte) ? fonte.split(':').slice(1).join(':') : null; }
      else { categoria = 'principali'; fonte = 'capitolo'; }
    }
    const A = arcoDi(state, content);
    const atto = state.atto || 1;
    const occ = A ? (atto === 1 ? A.fratturaAttoI : atto === 2 ? A.confrontoAttoII : A.esitoAttoIII).valore : null;
    const funzione = categoria === 'trasformazioni' && occ ? FUNZIONI[categoria] + ': ' + occ : FUNZIONI[categoria];
    return { categoria, funzione, funzioniNarrative: FUNZIONI_DI[categoria].slice(), temaCollegato: { tipo: TEMI_DI[categoria], rif: focus || fonte }, trasformazioni: TRASFORMAZIONI_CAT[categoria].slice(), focus, fonte, motivo: mo || 'pianificatore', budgetResiduo: (b.previsto[categoria] || 0) - (b.usato[categoria] || 0) };
  }
  /* Una scena interna è valida se ha una funzione narrativa dell'elenco,
     una trasformazione possibile, una fonte REALE nello stato della partita
     (capitolo, PNG presente o già incontrato, secondario, filo, voce,
     conseguenza, punto da esplorare, obiettivo, orologio, minaccia, arco,
     aftermath, luogo) e non duplica una scena già aperta sulla stessa fonte. */
  function fonteReale(state, content, fonte) {
    if (!fonte) return false;
    const [tipo, ...r] = String(fonte).split(':'); const id = r.join(':');
    const c = state.campagna;
    const mem = IM() ? IM().memoria(state) : { fili: [] };
    const sc = E().sceneOf(content, state.scena) || {};
    switch (tipo) {
      case 'capitolo': case 'luogo': case 'aftermath': case 'prossimo_capitolo': return true;
      case 'minaccia': return !!(state.incontro || (state.interazione && (state.interazione.incontroInAttesa || state.interazione.sceltaIncontro)) || sc.incontro);
      case 'arco': return !!arcoDi(state, content);
      case 'png': return !!(content.png || {})[id] && !(c.png[id] && c.png[id].stato && c.png[id].stato !== 'vivo');
      case 'secondario': return c.secondari.some(x => x.id === id) || c.latenti.some(x => x.id === id);
      case 'filo': return mem.fili.some(f => f.id === id);
      case 'voce': return ((state.sociale || {}).voci || []).some(v => v.id === id);
      case 'conseguenza': return (state.conseguenze || []).some(x => x.id === id);
      case 'punto': return true;
      case 'obiettivo': return (sc.obiettivi || []).some(o => o.id === id);
      case 'orologio': return !!(state.orologi || {})[id];
      default: return false;
    }
  }
  function validaScena(sc, state, content) {
    const e = [];
    if (!sc || CATEGORIE.indexOf(sc.categoria) === -1) e.push('categoria non valida');
    if (!sc || !sc.funzione) e.push('scena senza funzione');
    if (!sc || !Array.isArray(sc.funzioniNarrative) || !sc.funzioniNarrative.length || sc.funzioniNarrative.some(f => FUNZIONI_NARRATIVE.indexOf(f) === -1)) e.push('scena senza funzione narrativa dell\'elenco');
    if (!sc || !Array.isArray(sc.trasformazioni) || !sc.trasformazioni.length) e.push('scena senza trasformazione possibile');
    if (sc && state && content && state.campagna) {
      if (!fonteReale(state, content, sc.fonte)) e.push('contenuto scollegato dallo stato della partita (fonte: ' + sc.fonte + ')');
      const c = state.campagna;
      if (c.scene.some(x => x.macro === c.macro && x.stato === 'aperta' && x.categoria === sc.categoria && x.fonte === sc.fonte && (x.focus || null) === (sc.focus || null))) e.push('scena duplicata');
    }
    return e;
  }
  function apriScena(state, content, proposta, evN, applied) {
    const err = validaScena(proposta, state, content);
    if (err.length) { if (applied) applied.push({ tipo: 'scena_interna_respinta', motivi: err }); return null; }
    const c = state.campagna;
    const n = c.scene.filter(s => s.macro === c.macro).length + 1;
    const b = budgetMacro(state, content, c.macro);
    b.usato[proposta.categoria] = (b.usato[proposta.categoria] || 0) + 1;
    if (b.usato[proposta.categoria] > (b.previsto[proposta.categoria] || 0)) b.oltre.push(proposta.categoria);
    const sc = Object.assign({ id: c.macro + '.s' + n, macro: c.macro, arcoLocale: c.arcoLocale, stato: 'aperta', aperta: evN, chiusa: null, segni: [], peso: 0, sottoscene: [], realizzata: null, turni: 0 }, proposta);
    c.scene.push(sc);
    c.scena = sc.id;
    c.sottoscenaN = 0;
    nuovaSottoscena(state, sc.focus || null);
    if (applied) applied.push({ tipo: 'scena_interna', scena: sc.id, categoria: sc.categoria });
    return sc;
  }
  function nuovaSottoscena(state, focus) {
    const c = state.campagna;
    c.sottoscenaN += 1;
    c.sottoscena = c.scena + '.' + c.sottoscenaN;
    c.focus = focus;
    const sc = c.scene.find(s => s.id === c.scena);
    if (sc) sc.sottoscene.push({ id: c.sottoscena, focus });
  }
  function scenaCorrente(state) { const c = state.campagna; return c ? c.scene.find(s => s.id === c.scena) || null : null; }
  function chiudiScena(state, content, sc, evN, esito) {
    const c = state.campagna;
    sc.stato = esito ? 'chiusa' : 'interrotta';
    sc.chiusa = evN;
    if (esito) {
      sc.realizzata = esito;
      const cat = CAT_DI[esito.tipo] || sc.categoria;
      const b = budgetMacro(state, content, sc.macro);
      b.realizzate[cat] = (b.realizzate[cat] || 0) + 1;
      prove(state, sc.macro).trasformazioni.push({ scena: sc.id, tipo: esito.tipo, categoria: cat, evento: evN });
    }
    c.scena = null;
  }

  /* ----------------------------------------------------- segnali */
  function segnali(ev, cmd) {
    const a = ev.effetti || [];
    const has = t => a.some(x => x.tipo === t);
    const out = [];
    if (ev.check && ev.obiettivo) out.push('obiettivo');
    if (ev.sceltaId) out.push('scelta');
    if (has('snodo')) out.push('snodo');
    if (has('scoperta')) out.push('scoperta');
    if (has('verita')) out.push('verita');
    if (has('relazione') || has('atteggiamento') || a.some(x => x.tipo === 'memoria' && x.genere === 'relazione')) out.push('relazione');
    if (has('svolta') || has('svolta_dialogo')) out.push('dialogo_svolta');
    if (has('promessa') || has('promessa_esito') || has('promessa_dialogo')) out.push('promessa');
    if (has('png_legame') || has('png_morte')) out.push('legame');
    if (ev.incontroEsito) out.push('incontro');
    if (has('conseguenza_applicata') || a.some(x => x.tipo === 'memoria' && x.genere === 'conseguenza')) out.push('conseguenza');
    if (has('stati_rimossi') || (cmd && cmd.tipo === 'usa' && has('hp'))) out.push('cura');
    if (ev.tipo === 'riposo' || has('riposo')) out.push('riposo');
    if (has('ricompensa') || has('loot_scoperto')) out.push('oggetto');
    if (has('secondario_esito')) out.push('secondario');
    if (has('arco')) out.push('arco');
    if (has('richiamo')) out.push('richiamo');
    return out;
  }
  const PERSISTENTI = ['flag', 'ricompensa', 'snodo', 'loot_scoperto', 'conseguenza_registrata', 'conseguenza_applicata', 'reputazione', 'asse', 'promessa', 'promessa_esito', 'orologio', 'relazione', 'atteggiamento', 'png_legame', 'png_morte', 'risorsa', 'oggetto_perso'];

  function prove(state, macro) {
    const c = state.campagna;
    c.prove[macro] = c.prove[macro] || { tema: [], arco: [], conseguenze: [], trasformazioni: [] };
    return c.prove[macro];
  }

  /* ------------------------------------------------ tema e dialettica
     Tesi: gli assi spostati dalle scelte del protagonista. Antitesi: i PNG
     con una posizione opposta. Ogni scelta che sposta gli assi è un evento
     dialettico verso ciascun PNG con una posizione nota: accoglie o
     respinge la sua posizione. La sintesi non è prestabilita: emerge. */
  function eventiDialettici(state, content, ev, applied) {
    const c = state.campagna;
    const assi = (ev.effetti || []).filter(a => a.tipo === 'asse');
    const out = [];
    if (assi.length) {
      // presa di posizione: la tesi del protagonista si muove
      out.push({ tipo: 'tesi', png: null, assi: assi.reduce((o, a) => { o[a.asse] = (o[a.asse] || 0) + a.delta; return o; }, {}), macro: c.macro, evento: ev.n, fonte: ev.sceltaId ? 'scelta' : 'esito' });
      const delta = {}; assi.forEach(a => { delta[a.asse] = (delta[a.asse] || 0) + a.delta; });
      Object.keys(content.png || {}).forEach(id => {
        const v = P() && P().scheda(content, id) && P().scheda(content, id).funzione.posizioneTematica;
        if (!v) return;
        let dot = 0; Object.keys(delta).forEach(k => { dot += delta[k] * (v.assi[k] || 0); });
        if (!dot) return;
        out.push({ tipo: dot > 0 ? 'accoglie' : 'respinge', png: id, assi: delta, macro: c.macro, evento: ev.n, fonte: 'scelta' });
      });
    }
    // confronto: una svolta in dialogo con un PNG in funzione di antitesi o specchio
    const sv = (ev.effetti || []).find(a => a.tipo === 'svolta' || a.tipo === 'svolta_dialogo');
    const it = state.interazione;
    const chi = sv && (sv.png || (it && it.dialogo));
    if (chi && P()) {
      const f = P().funzioneDialettica(state, content, chi);
      if (f === 'antitesi' || f === 'specchio') out.push({ tipo: 'confronto', png: chi, funzione: f, macro: c.macro, evento: ev.n, fonte: 'dialogo' });
    }
    // dialogo con un PNG che difende una posizione: confronto sui suoi valori
    // (uno per PNG e per capitolo)
    const parla = it && it.dialogo ? it.dialogo : null;
    if (parla && parla !== chi && P() && P().scheda(content, parla) && P().scheda(content, parla).funzione.posizioneTematica && !c.dialettica.some(e => e.tipo === 'confronto' && e.png === parla && e.macro === c.macro) && ev.tipo === 'battuta') {
      out.push({ tipo: 'confronto', png: parla, funzione: P().funzioneDialettica(state, content, parla), macro: c.macro, evento: ev.n, fonte: 'dialogo' });
    }
    out.forEach(e => { c.dialettica.push(e); prove(state, c.macro).tema.push(ev.n); if (applied) applied.push({ tipo: 'dialettica', genere: e.tipo, png: e.png }); });
    return out;
  }
  function sintesi(state, content) {
    const c = state.campagna || vuoto();
    const per = {};
    c.dialettica.filter(e => e.png && e.tipo !== 'confronto').forEach(e => { per[e.png] = per[e.png] || { accoglie: 0, respinge: 0, confronto: 0 }; per[e.png][e.tipo] += 1; });
    const accolte = Object.keys(per).filter(k => per[k].accoglie > per[k].respinge);
    const respinte = Object.keys(per).filter(k => per[k].respinge > per[k].accoglie);
    const forma = accolte.length && respinte.length ? 'integrazione' : accolte.length ? 'conversione' : respinte.length ? 'affermazione' : 'sospesa';
    return { domanda: (S(content).tema || {}).domanda || null, tesi: Object.assign({}, state.assi || {}), accolte, respinte, confronti: c.dialettica.filter(e => e.tipo === 'confronto').length, forma, fonte: 'emergente: eventi dialettici e assi della partita' };
  }

  /* ------------------------------------------------ arco personale
     Ogni archetipo ha il suo arco (dai materiali): frattura dell'Atto I,
     confronto dell'Atto II, integrazione o rifiuto dell'Atto III. Un passo
     avviene con una scelta morale (sposta gli assi) o con un'azione
     significativa in una scena di trasformazione. All'Atto III la forma
     dipende dalla partita: integrazione se il protagonista ha accolto almeno
     un'antitesi, rifiuto se le ha respinte. */
  const PASSI = { 1: 'frattura', 2: 'confronto', 3: 'esito' };
  function arcoDi(state, content) { const a = state.personaggio && state.personaggio.archetipo; return (S(content).archi || {})[a] || null; }
  function eventoArco(state, content, ev, segni, applied) {
    const c = state.campagna;
    const A = arcoDi(state, content);
    if (!A) return null;
    const atto = state.atto || 1;
    const sc = scenaCorrente(state);
    const assi = (ev.effetti || []).filter(a => a.tipo === 'asse');
    // scelta morale: sposta gli assi, oppure è la decisione di un capitolo
    // in cui l'arco è previsto (climax e confronto)
    const previsto = ((macroDef(content, c.macro) || {}).contratto || { clausole: [] }).clausole.some(k => k.id === 'arco' && k.richiesta);
    const scelta = ev.sceltaId && (assi.length || previsto);
    const prova = sc && sc.categoria === 'trasformazioni' && segni.length > 0;
    if (!scelta && !prova) return null;
    const occ = atto === 1 ? A.fratturaAttoI.valore : atto === 2 ? A.confrontoAttoII.valore : A.esitoAttoIII.valore;
    let forma = PASSI[atto];
    if (atto === 3) { const si = sintesi(state, content); forma = si.accolte.length ? 'integrazione' : 'rifiuto'; }
    // rispetto alla tesi iniziale: la scelta va nella direzione del suo orientamento o contro
    const orient = (A.rapportoConIlTema || {}).valore || {};
    let verso = 0; assi.forEach(a => { verso += a.delta * (orient[a.asse] || 0); });
    const e = { atto, macro: c.macro, archetipo: A.archetipo, tipo: scelta ? 'prova_morale' : 'prova_personale', passo: forma, occasione: occ, rispettoAllaTesi: verso > 0 ? 'conferma' : verso < 0 ? 'mette_in_discussione' : 'neutro', evento: ev.n };
    c.arco.push(e);
    prove(state, c.macro).arco.push(ev.n);
    if (applied) {
      applied.push({ tipo: 'arco', genere: e.tipo, atto, passo: forma });
      applied.push({ tipo: 'premio_ap', fonte: 'arco', chiave: 'arco:' + atto + ':' + PASSI[atto] });
    }
    return e;
  }
  function statoArco(state, content) {
    const A = arcoDi(state, content);
    const c = state.campagna;
    if (!A || !c) return null;
    const antitesi = Array.from(new Set(c.dialettica.filter(e => e.png && (e.tipo === 'respinge' || (e.tipo === 'confronto' && e.funzione === 'antitesi'))).map(e => e.png)));
    return { archetipo: A.archetipo, tesiIniziale: A.tesiIniziale.valore, passi: c.arco.map(e => e.atto + ':' + e.passo), antitesiIncontrate: antitesi, sintesi: sintesi(state, content) };
  }

  /* ------------------------------------------------ contenuti secondari
     Il MOTORE decide se una causa esiste nello stato e registra il filo; il
     Regista decide forma e momento della scena (li riceve nel contesto).
     Cause strutturate (15): relazione modificata, promessa, debito, oggetto,
     fazione, professione, provenienza, classe, ferita, sconfitta, luogo
     scoperto, filo ignorato, conseguenza differita, scelta morale,
     trasformazione personale (più dicerie e fughe). Ogni contenuto si
     sviluppa per fasi (aggancio → sviluppo → svolta → esito), una fase per
     scena interna diversa, anche su più capitoli: niente ripetizioni. */
  const FASI_SEC = ['aggancio', 'sviluppo', 'svolta', 'esito'];
  const MAX_APERTI_PER_ATTO = 4; // densità: proposta di regia, non un cancello
  const CAUSE = ['relazione', 'promessa', 'debito', 'oggetto', 'fazione', 'professione', 'provenienza', 'classe', 'ferita', 'sconfitta', 'luogo', 'filo_ignorato', 'conseguenza', 'scelta_morale', 'trasformazione', 'diceria', 'fuga'];
  function apriSecondario(state, content, s, evN, applied) {
    const c = state.campagna;
    if (SECONDARI.indexOf(s.categoria) === -1) return { ok: false, motivo: 'categoria non prevista' };
    if (!s.causa) return { ok: false, motivo: 'senza causa' };
    const firma = s.categoria + '|' + (s.riferimento || s.causa);
    if (c.secondari.some(x => x.firma === firma) || (c.latenti || []).some(x => x.firma === firma)) return { ok: false, motivo: 'già presente: niente ripetizioni' };
    const x = Object.assign({ id: 'sec' + (c.secondari.length + (c.latenti || []).length + 1), firma, macro: c.macro, scena: c.scena, atto: state.atto || 1, stato: 'aperto', fase: 'aggancio', ultimaScena: c.scena, persistente: true, conseguenze: [], puoFallire: false, ignorabile: true, puoTornare: false, scadenza: null, aperto: evN, storia: [], tipoCausa: s.tipoCausa || null }, s);
    // densità: oltre il tetto dell'atto la causa resta registrata come latente
    const apertiAtto = c.secondari.filter(y => y.atto === (state.atto || 1) && (y.stato === 'aperto' || y.stato === 'tornato')).length;
    if (apertiAtto >= MAX_APERTI_PER_ATTO && !s.urgente) {
      c.latenti = c.latenti || [];
      x.stato = 'latente';
      c.latenti.push(x);
      return { ok: true, latente: true, secondario: x };
    }
    c.secondari.push(x);
    if (applied) applied.push({ tipo: 'secondario', id: x.id, categoria: x.categoria, stato: 'aperto', causa: x.tipoCausa });
    return { ok: true, secondario: x };
  }
  function esitoSecondario(state, x, esito, evN, causa, applied) {
    x.storia.push({ da: x.stato, a: esito, evento: evN, causa });
    x.stato = esito;
    if (esito === 'riuscito' || esito === 'fallito') { x.fase = 'esito'; x.chiuso = evN; if (applied) applied.push({ tipo: 'premio_ap', fonte: 'secondario_esito', chiave: 'secondario_esito:' + x.id }); }
    if (esito === 'tornato') { x.fase = 'aggancio'; x.tornatoA = evN; }
    if (applied) applied.push({ tipo: 'secondario_esito', id: x.id, categoria: x.categoria, esito });
  }
  // l'evento tocca l'entità a cui il contenuto è legato?
  function tocca(state, content, x, ev, segni) {
    const [tipo, rif] = String(x.riferimento || '').split(':');
    const a = ev.effetti || [];
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const pngToccati = new Set(a.map(y => y.png).filter(Boolean).concat(it && it.dialogo ? [it.dialogo] : []));
    switch (tipo) {
      case 'png': return pngToccati.has(rif);
      case 'fazione': case 'provenienza': return a.some(y => y.tipo === 'reputazione' && y.fazione === rif) || Array.from(pngToccati).some(p => ((P() && P().scheda(content, p)) || { identita: {} }).identita.fazione === rif);
      case 'oggetto': return a.some(y => (y.oggetto === rif || y.istanza === rif) && ['consumato', 'raccolto', 'ricompensa', 'loot_scoperto'].indexOf(y.tipo) !== -1) || (ev.tipo === 'usa' && ev.testo && ev.testo.indexOf(rif) !== -1);
      case 'nemico': return !!ev.incontroEsito || a.some(y => y.tipo === 'incontro_inizia');
      case 'filo': return a.some(y => y.tipo === 'filo' && y.filo === rif);
      case 'conseguenza': return a.some(y => (y.tipo === 'conseguenza_applicata' || y.tipo === 'conseguenza_registrata') && y.id === rif);
      case 'promessa': return a.some(y => (y.tipo === 'promessa_esito' || y.tipo === 'promessa_dialogo') && (y.id === rif || !y.id));
      case 'voce': return state.scena !== x.macro && (segni.indexOf('verita') !== -1 || segni.indexOf('scoperta') !== -1);
      case 'scelta': return state.scena !== rif && pngToccati.size > 0 && Array.from(pngToccati).some(p => ((E().sceneOf(content, rif) || {}).png_presenti || []).indexOf(p) !== -1);
      case 'arco': return segni.indexOf('arco') !== -1 || (scenaCorrente(state) || {}).categoria === 'trasformazioni' && segni.length > 0;
      case 'ferita': return ev.tipo === 'riposo' || a.some(y => y.tipo === 'riposo' || y.tipo === 'stati_rimossi' || (y.tipo === 'hp' && y.delta > 0));
      case 'luogo': return state.scena !== rif && (ev.tipo === 'riposo' || segni.indexOf('verita') !== -1 || segni.indexOf('scoperta') !== -1);
      case 'tratto': return !!(ev.check && ev.check.tratto === rif && ev.obiettivo);
      case 'classe': return a.some(y => y.tipo === 'capacita_lv' || y.tipo === 'magia_senza_gemme' || y.tipo === 'gemma_scarica' || y.tipo === 'costo');
      default: return false;
    }
  }
  // risoluzioni specifiche (quando l'entità arriva a un esito)
  function risoluzione(state, x, ev) {
    const [tipo, rif] = String(x.riferimento || '').split(':');
    const a = ev.effetti || [];
    if (tipo === 'promessa') { const e = a.find(y => y.tipo === 'promessa_esito' && y.id === rif); if (e) return e.stato === 'mantenuta' ? 'riuscito' : 'fallito'; }
    if (tipo === 'ferita' && (ev.tipo === 'riposo' || a.some(y => y.tipo === 'riposo'))) { x.riposi = (x.riposi || 0) + 1; if (x.riposi >= (x.riposiNecessari || 1)) return 'riuscito'; }
    if (tipo === 'nemico' && (ev.incontroEsito === 'vittoria' || ev.incontroEsito === 'resa')) return 'riuscito';
    if (tipo === 'filo' && a.some(y => y.tipo === 'filo' && y.filo === rif && y.stato === 'chiuso')) return 'riuscito';
    if (tipo === 'conseguenza' && a.some(y => y.tipo === 'conseguenza_applicata' && y.id === rif)) return 'riuscito';
    return null;
  }
  function causeDalloStato(state, content, ev, cmd, applied) {
    const a = ev.effetti || [];
    const c = state.campagna;
    const pg = state.personaggio;
    const apri = (s) => apriSecondario(state, content, s, ev.n, applied);
    const nomeP = id => (((content.png || {})[id] || {}).nome || id).split(' (')[0];
    // relazione modificata
    a.filter(y => (y.tipo === 'relazione' || y.tipo === 'atteggiamento') && y.png && y.delta).forEach(y => apri(y.delta > 0
      ? { categoria: 'favore', tipoCausa: 'relazione', causa: nomeP(y.png) + ' si è avvicinato: potrebbe chiedere qualcosa', riferimento: 'png:' + y.png, puoTornare: true, conseguenze: ['rapporto con ' + nomeP(y.png)] }
      : { categoria: 'rivalita', tipoCausa: 'relazione', causa: 'il rapporto con ' + nomeP(y.png) + ' si è incrinato', riferimento: 'png:' + y.png, puoTornare: true, puoFallire: true, conseguenze: ['ostilità di ' + nomeP(y.png)] }));
    // promessa
    a.filter(y => y.tipo === 'promessa' || y.tipo === 'promessa_dialogo').forEach(y => apri({ categoria: 'promessa', tipoCausa: 'promessa', causa: y.testo || 'una promessa fatta', riferimento: 'promessa:' + (y.id || ev.n), puoFallire: true, ignorabile: false, conseguenze: ['fiducia di chi l\'ha ricevuta'] }));
    // debito: un aiuto ricevuto da un PNG (oggetto o informazione in dialogo)
    if (cmd && cmd.tipo === 'battuta' && state.interazione && state.interazione.dialogo && a.some(y => y.tipo === 'ricompensa')) apri({ categoria: 'debito', tipoCausa: 'debito', causa: 'hai ricevuto un aiuto da ' + nomeP(state.interazione.dialogo), riferimento: 'png:' + state.interazione.dialogo + ':debito', puoTornare: true, conseguenze: ['ciò che ti verrà chiesto in cambio'] });
    // oggetto: preso o perso
    a.filter(y => y.tipo === 'loot_scoperto').slice(0, 1).forEach(y => apri({ categoria: 'commercio', tipoCausa: 'oggetto', causa: 'hai trovato ' + (y.nome || 'qualcosa di valore'), riferimento: 'oggetto:' + y.istanza, conseguenze: ['scambio o uso'] }));
    a.filter(y => y.tipo === 'oggetto_perso').forEach(y => apri({ categoria: 'oggetto_smarrito', tipoCausa: 'oggetto', causa: 'hai perso ' + (y.nome || 'qualcosa'), riferimento: 'oggetto:' + (y.oggetto || y.id), puoTornare: true, conseguenze: ['recupero o sostituzione'] }));
    // fazione e provenienza (reputazione)
    a.filter(y => y.tipo === 'reputazione').forEach(y => {
      const mia = pg.popolazione === y.fazione;
      if (mia) apri({ categoria: 'consegna', tipoCausa: 'provenienza', causa: 'la tua gente (' + y.fazione + ') ti affida qualcosa', riferimento: 'provenienza:' + y.fazione, puoFallire: true, conseguenze: ['fiducia della tua gente'] });
      else apri(y.delta > 0 ? { categoria: 'favore', tipoCausa: 'fazione', causa: y.fazione + ' ti guarda con favore', riferimento: 'fazione:' + y.fazione, puoTornare: true } : { categoria: 'rivalita', tipoCausa: 'fazione', causa: y.fazione + ' ti considera un problema', riferimento: 'fazione:' + y.fazione, puoTornare: true, puoFallire: true });
    });
    // professione: un obiettivo riuscito con il tratto più alto del mestiere
    if (ev.check && ev.obiettivo && ev.esito === 'successo' && ev.check.tratto) {
      const cn = (pg.traits && pg.traits.capacitaNormali) || {};
      const top = Object.keys(cn).sort((p1, p2) => cn[p2] - cn[p1])[0];
      if (top && ev.check.tratto === top) apri({ categoria: 'ricerca', tipoCausa: 'professione', causa: 'la tua competenza (' + top + ') si è fatta notare', riferimento: 'tratto:' + top, conseguenze: ['richieste di chi ha bisogno del tuo mestiere'] });
    }
    // classe: la tua arte (capacità che cresce, gemme, magia senza gemme)
    if (a.some(y => y.tipo === 'capacita_lv' || y.tipo === 'magia_senza_gemme')) apri({ categoria: 'rito', tipoCausa: 'classe', causa: 'la tua arte (' + pg.build + ') ha lasciato un segno', riferimento: 'classe:' + pg.build, puoTornare: true, conseguenze: a.some(y => y.tipo === 'magia_senza_gemme') ? ['testimoni della magia senza gemme'] : ['chi ha visto la tua arte'] });
    // ferita e sconfitta
    const ferito = ev.incontroEsito && ev.incontroEsito !== 'sconfitta' && pg.hpCur < (pg.hpMaxTracked || 1) / 2;
    if (a.some(y => y.tipo === 'sconfitta') || ferito) {
      const dif = (S(content).difficolta || {})[state.difficolta] || {};
      apri({ categoria: 'ferita', tipoCausa: a.some(y => y.tipo === 'sconfitta') ? 'sconfitta' : 'ferita', causa: 'ferita subita in ' + state.scena, riferimento: 'ferita:' + ev.n, ignorabile: false, gravita: dif.gravitaFerite || 'normale', riposiNecessari: dif.riposiPerGuarire || 1, conseguenze: ['svantaggio finché non è curata'], urgente: true });
    }
    if (a.some(y => y.tipo === 'sconfitta')) apri({ categoria: 'soccorso', tipoCausa: 'sconfitta', causa: 'qualcuno ti ha raccolto dopo la caduta in ' + state.scena, riferimento: 'luogo:' + state.scena + ':soccorso', conseguenze: ['un debito verso chi ti ha salvato'] });
    // fuga dallo scontro o nemico fuggito
    if (ev.incontroEsito === 'nemico_fuggito' || ev.incontroEsito === 'fuga') apri({ categoria: 'ritorno_nemico', tipoCausa: 'fuga', causa: 'scontro interrotto con ' + (ev.nemicoNome || 'un avversario'), riferimento: 'nemico:' + (ev.nemicoId || 'x'), ignorabile: false, puoTornare: true, conseguenze: ['può ricomparire in un momento peggiore'] });
    // luogo scoperto: un luogo interno convalidato o un capitolo di calma
    a.filter(y => y.tipo === 'memoria' && y.genere === 'spostamento_interno').slice(0, 1).forEach(y => apri({ categoria: 'mappa', tipoCausa: 'luogo', causa: 'hai scoperto ' + y.testo, riferimento: 'luogo:' + state.scena + ':' + y.voce, conseguenze: ['una via da ricordare'] }));
    if (ev.tipo === 'riposo') apri({ categoria: 'rifugio', tipoCausa: 'luogo', causa: 'un luogo dove fermarsi: ' + ((E().currentScene(state, content) || {}).luogo || state.scena), riferimento: 'luogo:' + state.scena, conseguenze: ['un rifugio da difendere o perdere'] });
    // conseguenza differita
    a.filter(y => y.tipo === 'conseguenza_registrata').forEach(y => apri({ categoria: 'rovina', tipoCausa: 'conseguenza', causa: 'una conseguenza è in cammino', riferimento: 'conseguenza:' + y.id, ignorabile: false, conseguenze: ['ciò che accadrà se non la affronti'] }));
    // dicerie
    a.filter(y => y.tipo === 'voce').forEach(y => apri({ categoria: 'diceria', tipoCausa: 'diceria', causa: y.testo, riferimento: 'voce:' + y.id, puoTornare: true }));
    // scelta morale: qualcuno ha visto
    if (ev.sceltaId && a.some(y => y.tipo === 'asse')) apri({ categoria: 'testimone', tipoCausa: 'scelta_morale', causa: 'qualcuno ricorderà la tua scelta in ' + state.scena, riferimento: 'scelta:' + state.scena, puoTornare: true, conseguenze: ['come ne parleranno'] });
    // trasformazione personale
    a.filter(y => y.tipo === 'arco').forEach(y => apri({ categoria: 'prova_personale', tipoCausa: 'trasformazione', causa: 'il tuo arco personale chiede una prova (' + y.passo + ')', riferimento: 'arco:' + y.atto, conseguenze: ['chi diventi'] }));
    // filo nato qui con un collegamento: indagine, rivalità o favore
    a.filter(y => y.tipo === 'filo' && y.stato === 'aperto').forEach(f => {
      const m = IM() && IM().memoria(state).fili.find(z => z.id === f.filo);
      const cat = m && m.collegamento === 'conflitto' ? 'rivalita' : m && m.collegamento === 'relazione' ? 'favore' : 'indagine';
      apri({ categoria: cat, tipoCausa: 'filo_ignorato', causa: f.titolo, riferimento: 'filo:' + f.filo, puoTornare: true });
    });
  }
  function aggiornaSecondari(state, content, ev, cmd, segni, applied) {
    const c = state.campagna;
    causeDalloStato(state, content, ev, cmd, applied);
    c.secondari.filter(x => x.stato === 'aperto' || x.stato === 'tornato').forEach(x => {
      if (x.aperto === ev.n) return; // appena nato
      const r = risoluzione(state, x, ev);
      if (r) { esitoSecondario(state, x, r, ev.n, 'esito dallo stato', applied); return; }
      if (!tocca(state, content, x, ev, segni)) return;
      x.toccato = true;
      // una fase per scena interna diversa: niente avanzamento ripetuto nella stessa
      if (x.ultimaScena === c.scena) return;
      const i = FASI_SEC.indexOf(x.fase);
      if (x.fase === 'svolta') { if (segni.some(s => PESO[s] >= 2)) esitoSecondario(state, x, 'riuscito', ev.n, 'svolta compiuta', applied); return; }
      x.fase = FASI_SEC[Math.min(i + 1, 2)];
      x.ultimaScena = c.scena;
      x.storia.push({ fase: x.fase, evento: ev.n, scena: c.scena, macro: c.macro });
      applied.push({ tipo: 'secondario_fase', id: x.id, categoria: x.categoria, fase: x.fase });
      applied.push({ tipo: 'premio_ap', fonte: 'secondario_fase', chiave: 'secondario_fase:' + x.id + ':' + x.fase + (x.tornatoA ? ':' + x.tornatoA : '') });
    });
  }
  // alla chiusura di un capitolo: fili ignorati, scadenze, ignorati, ritorni, latenti
  function secondariAFineMacro(state, content, macro, evN, applied) {
    const c = state.campagna;
    const passati = c.storico.length;
    // filo ignorato: un filo nato qui resta aperto quando si lascia il capitolo
    if (IM()) IM().memoria(state).fili.filter(f => f.stato === 'aperto' && f.scena === macro).forEach(f => apriSecondario(state, content, { categoria: 'indagine', tipoCausa: 'filo_ignorato', causa: 'un filo lasciato in ' + macro + ': ' + f.titolo, riferimento: 'filo:' + f.id, puoTornare: true }, evN, applied));
    c.secondari.forEach(x => {
      if (x.stato === 'aperto' && x.scadenza != null && passati >= x.scadenza && x.puoFallire) esitoSecondario(state, x, 'fallito', evN, 'tempo scaduto', applied);
      else if (x.stato === 'aperto' && x.macro === macro && x.ignorabile && !x.toccato) { esitoSecondario(state, x, 'ignorato', evN, 'lasciato alle spalle', applied); x.ignoratoA = passati; }
      else if (x.stato === 'ignorato' && x.puoTornare && passati - (x.ignoratoA || 0) >= 2) esitoSecondario(state, x, 'tornato', evN, 'torna con le sue conseguenze', applied);
    });
    // i latenti si aprono quando la densità dell'atto lo consente
    (c.latenti || []).slice().forEach(x => {
      const aperti = c.secondari.filter(y => y.atto === (state.atto || 1) && (y.stato === 'aperto' || y.stato === 'tornato')).length;
      if (aperti < MAX_APERTI_PER_ATTO) { c.latenti.splice(c.latenti.indexOf(x), 1); x.stato = 'aperto'; x.atto = state.atto || 1; x.macro = macro; c.secondari.push(x); applied.push({ tipo: 'secondario', id: x.id, categoria: x.categoria, stato: 'aperto', causa: x.tipoCausa }); }
    });
  }

  /* --------------------------------------------------- contratto
     Solo condizioni narrative pertinenti a QUESTO capitolo (dai dati):
     - funzione: la questione del capitolo ha trovato una via (uscita dei dati);
     - snodo: raggiunto, o portato dall'uscita/scelta in modo compatibile;
     - tema: presa di posizione o confronto (se il capitolo lo prevede);
     - arco: un passo dell'arco personale (se previsto);
     - conseguenze indispensabili: la scelta del capitolo fatta, lo scontro
       concluso o evitato (se il capitolo li ha);
     - minacce: nessuno scontro in corso o annunciato che sbarri la strada;
     - posizione: non in un dialogo né in uno scontro;
     - decisione: il comando del giocatore (verificata da prosegui).
     Niente numeri minimi, niente "parla con tutti", niente budget. */
  function valutaContratto(state, content, macroId) {
    const m = macroDef(content, macroId || state.scena);
    const id = m.macroChapterId;
    const pr = prove(state, id);
    const sc = E().sceneOf(content, id) || {};
    const it = state.interazione && state.interazione.scena === id ? state.interazione : null;
    const uscita = (sc.uscite || []).find(u => E().conditionMet(state, u.quando)) || null;
    const def = {};
    (m.contratto.clausole || []).forEach(k => { def[k.id] = k; });
    const conc = def.conseguenze || {};
    const scontroChiuso = !!(state.flags || {})['incontro_' + id + '_concluso'];
    const ok = {
      funzione: m.epilogo ? true : !!uscita,
      snodo: m.epilogo ? true : !!uscita && (!m.snodi.length || m.snodi.every(s => (state.snodi || {})[s] || JSON.stringify(uscita.effetti || []).indexOf('"' + s + '"') !== -1 || JSON.stringify(sc.scelte || []).indexOf('"' + s + '"') !== -1)),
      tema: pr.tema.length > 0,
      arco: pr.arco.length > 0,
      conseguenze: (!conc.scelta || !!(state.scelte || {})[id]) && (!conc.incontro || scontroChiuso),
      minacce: !state.incontro && !(it && it.sceltaIncontro),
      posizione: !state.incontro && !(it && it.dialogo),
      decisione: true
    };
    const clausole = {};
    Object.keys(def).forEach(k => { clausole[k] = { richiesta: def[k].richiesta, ok: !def[k].richiesta || ok[k], cosa: def[k].cosa || null, prove: k === 'tema' ? pr.tema : k === 'arco' ? pr.arco : [] }; });
    // le condizioni di posizione e di minaccia valgono sempre
    ['minacce', 'posizione'].forEach(k => { if (clausole[k]) clausole[k].ok = ok[k]; });
    const mancanti = Object.keys(clausole).filter(k => !clausole[k].ok);
    return { macro: id, clausole, completo: mancanti.length === 0, mancanti, uscita: uscita ? { verso: uscita.verso } : null, epilogo: !!m.epilogo };
  }
  function valutaUscita(state, content, applied, evN) {
    const c = state.campagna;
    if (!c || c.macro !== state.scena) return;
    const v = valutaContratto(state, content, state.scena);
    const prima = c.uscitaPronta;
    c.uscitaPronta = v.completo ? { verso: v.uscita ? v.uscita.verso : null, concludi: v.epilogo, dal: prima ? prima.dal : (evN || null) } : null;
    if (!prima && c.uscitaPronta) applied.push({ tipo: 'contratto_macro', macro: state.scena, completo: true });
  }
  function pronta(state) { return !!(state.campagna && state.campagna.uscitaPronta); }
  function motivoNonPronta(state, content) {
    const v = valutaContratto(state, content, state.scena);
    if (v.completo) return null;
    return 'Non è ancora il momento di lasciare questo luogo: ' + MOTIVI_CLAUSOLA[v.mancanti[0]] + '.';
  }
  const USCITA_RE = /\b(prosegu|vado avanti|andiamo avanti|lascio (il|la|questo|questa|quest)|me ne vado|riparto|mi rimetto in (cammino|viaggio)|mi incammino verso|chiudo questo capitolo)/;
  function intenzioneDiUscire(testo) { return USCITA_RE.test(String(testo || '').toLowerCase()); }

  /* prosegui: il protagonista lascia il macro-capitolo. */
  function prosegui(state, content) {
    const c = state.campagna;
    if (!c) return { ok: false, motivo: 'Struttura non attiva.' };
    const v = valutaContratto(state, content, state.scena);
    if (!v.completo) return { ok: false, motivo: motivoNonPronta(state, content), mancanti: v.mancanti };
    if (v.epilogo) return { ok: true, concludi: true };
    const sc = E().sceneOf(content, state.scena);
    const u = (sc.uscite || []).find(x => E().conditionMet(state, x.quando));
    return u ? { ok: true, uscita: u } : { ok: false, motivo: 'Non c\'è ancora una strada per proseguire.' };
  }

  /* ------------------------------------------------ macro-capitoli */
  function apriMacro(state, content, macro, evN, applied, motivo) {
    const c = state.campagna;
    const m = macroDef(content, macro);
    c.macro = macro;
    c.atto = m ? m.atto || c.atto : c.atto;
    c.turno = 0;
    c.arcoN = 1;
    c.arcoLocale = macro + '.a1';
    c.uscitaPronta = null;
    if (!c.storico.length || c.storico[c.storico.length - 1].macro !== macro) c.storico.push({ macro, atto: c.atto, entrato: evN, chiuso: null, contratto: null });
    budgetMacro(state, content, macro);
    prove(state, macro);
    apriScena(state, content, generaScena(state, content, motivo || 'ingresso'), evN, applied);
  }
  function chiudiMacro(state, content, macro, evN, applied) {
    const c = state.campagna;
    const sc = scenaCorrente(state);
    if (sc && sc.macro === macro) chiudiScena(state, content, sc, evN, null);
    const h = c.storico.find(x => x.macro === macro && x.chiuso == null);
    const v = valutaContratto(state, content, macro);
    if (h) { h.chiuso = evN; h.contratto = { completo: v.completo, clausole: Object.keys(v.clausole).filter(k => v.clausole[k].richiesta) }; }
    secondariAFineMacro(state, content, macro, evN, applied);
    c.memoria.capitoli.push(sintesiCapitolo(state, content, macro, evN));
  }
  function sintesiCapitolo(state, content, macro, evN) {
    const c = state.campagna;
    const evs = (state.eventi || []).filter(e => e.scena === macro);
    const r = (state.memoria && state.memoria.riassunti || []).filter(x => x.scena === macro).slice(-1)[0];
    const mem = IM() ? IM().memoria(state) : { fili: [] };
    const m = macroDef(content, macro) || {};
    return {
      id: 'cap-' + macro, livello: 'macro', macro, atto: m.atto || null, titolo: m.titolo || macro,
      riassunto: r ? r.testo : null,
      decisioni: evs.filter(e => e.sceltaTesto || (e.check && e.obiettivoTesto)).map(e => e.sceltaTesto || (e.obiettivoTesto + ': ' + e.esito)),
      conseguenze: evs.flatMap(e => (e.effetti || []).filter(a => PERSISTENTI.indexOf(a.tipo) !== -1).map(a => a.tipo + (a.png ? ':' + a.png : a.asse ? ':' + a.asse : a.id ? ':' + a.id : ''))).slice(0, 12),
      png: (m.png || []).reduce((o, id) => { const d = c.png[id]; o[id] = d ? d.stato + '/' + d.legame : 'vivo/neutro'; return o; }, {}),
      filiAperti: mem.fili.filter(f => f.stato === 'aperto').map(f => f.id),
      filiChiusi: mem.fili.filter(f => f.stato === 'chiuso' && f.scena === macro).map(f => f.id),
      trasformazioni: prove(state, macro).trasformazioni.map(t => t.tipo),
      tema: c.dialettica.filter(e => e.macro === macro).map(e => e.tipo + ':' + e.png),
      arco: c.arco.filter(e => e.macro === macro).map(e => e.tipo),
      secondari: c.secondari.filter(x => x.macro === macro).map(x => x.categoria + ':' + x.stato),
      eventi: evs.map(e => e.n).concat(evN != null ? [evN] : []),
      fonte: 'motore'
    };
  }
  function sintesiAtto(state, content, atto) {
    const c = state.campagna;
    const cap = c.memoria.capitoli.filter(x => x.atto === atto);
    return { id: 'atto-' + atto, livello: 'atto', atto, capitoli: cap.map(x => x.macro), decisioni: cap.flatMap(x => x.decisioni).slice(-6), tema: cap.flatMap(x => x.tema).slice(-6), arco: c.arco.filter(e => e.atto === atto).map(e => e.tipo), legami: Object.keys(c.png).filter(k => c.png[k].legame !== 'neutro' || c.png[k].stato !== 'vivo').map(k => k + ':' + c.png[k].stato + '/' + c.png[k].legame), fonte: 'motore' };
  }

  /* Ingresso in un macro-capitolo (dal motore, dopo il cambio di scena). */
  function entraMacro(state, content, da, verso, evN, applied) {
    if (!state.campagna) { state.campagna = vuoto(); apriMacro(state, content, verso, evN, applied, 'ingresso'); return; }
    const c = state.campagna;
    const attoPrima = c.atto;
    if (da && da !== verso) chiudiMacro(state, content, da, evN, applied);
    apriMacro(state, content, verso, evN, applied, 'ingresso');
    if (c.atto !== attoPrima) c.memoria.atti.push(sintesiAtto(state, content, attoPrima));
  }

  /* Epilogo: separato dal confronto conclusivo. L'esito è calcolato una
     volta sola all'ingresso (stesso risolutore deterministico); il
     protagonista può ancora muoversi fra le conseguenze, poi conclude. */
  function apriEpilogo(state, content, applied, evN) {
    const c = state.campagna;
    if (c.epilogo) return c.epilogo;
    const rec = C().resolveEnding(state, content, applied, null, evN);
    c.epilogo = { record: rec, aperto: evN, macro: state.scena };
    applied.push({ tipo: 'epilogo', variante: rec.variante, titolo: rec.titolo });
    return c.epilogo;
  }
  function epilogo(state, content) {
    const c = state.campagna;
    if (!c || !c.epilogo) return null;
    const rec = c.epilogo.record;
    const mem = IM() ? IM().memoria(state) : { fili: [] };
    return {
      esito: rec.variante, titolo: rec.titolo, modificatori: rec.modificatori, assi: rec.assi,
      legami: Object.keys(content.png || {}).map(id => P() ? P().vista(state, content, id) : { id }),
      arco: c.arco.slice(), sintesi: sintesi(state, content),
      filiChiusi: mem.fili.filter(f => f.stato === 'chiuso').map(f => f.titolo), filiAperti: mem.fili.filter(f => f.stato === 'aperto').map(f => f.titolo),
      secondari: c.secondari.map(x => ({ categoria: x.categoria, stato: x.stato })),
      // promesse, fazioni, luoghi modificati, conseguenze morali, oggetti chiave
      promesse: ((state.sociale || {}).promesse || []).map(p => ({ testo: p.testo, stato: p.stato || p.esito || 'aperta' })),
      fazioni: Object.assign({}, (state.sociale || {}).reputazione || {}),
      luoghiModificati: ((state.narrativa || {}).environmentChanges || []).map(x => ({ scena: x.scena, testo: x.testo }))
        .concat(state.mappa ? Object.entries(state.mappa.luoghi || {}).filter(([, l]) => (l.trasformazioni || []).length).map(([id, l]) => ({ luogo: id, trasformazioni: l.trasformazioni.slice() })) : []),
      conseguenzeMorali: { assi: Object.assign({}, state.assi || {}), decisioni: (state.decisioni || []).slice(-8) },
      oggettiChiave: (state.inventario || []).filter(i => { const d = E().itemInfo(state, content, i.id); return d && d.tipo === 'oggetto_chiave'; }).map(i => E().itemInfo(state, content, i.id).nome)
        .concat(Object.keys(state.oggettiPersi || {}).map(k => 'perso: ' + k)).concat(Object.keys(state.custodi || {}).map(k => 'affidato: ' + k)),
      capitoli: c.memoria.capitoli.length, fonte: 'motore'
    };
  }

  /* Ritmo e densità registrati (misure, nessuna stima di lettura): per
     scena interna, macro-capitolo, atto e campagna. Il tempo è quello REALE
     fra i timestamp degli eventi; la fascia 25-35 ore per atto è solo
     un'indicazione diagnostica, mai un vincolo. */
  const FASCIA_ORE_ATTO = [25, 35];
  function diagnosticaRitmo(state, content) {
    const c = state.campagna;
    if (!c) return null;
    const evs = state.eventi || [];
    const tempo = arr => { const t = arr.map(e => e.ts).filter(Number.isFinite); return t.length > 1 ? Math.max(0, t[t.length - 1] - t[0]) : 0; };
    const scene = c.scene.map(s => ({ id: s.id, macro: s.macro, categoria: s.categoria, funzioni: s.funzioniNarrative || [], tema: s.temaCollegato || null, stato: s.stato, turni: s.turni || 0, sottoscene: (s.sottoscene || []).length, realizzata: s.realizzata ? s.realizzata.tipo : null }));
    const macro = {};
    c.storico.forEach(h => {
      const ev = evs.filter(e => e.scena === h.macro);
      const b = c.budget[h.macro] || { previsto: {}, usato: {}, realizzate: {} };
      macro[h.macro] = { atto: (macroDef(content, h.macro) || {}).atto, eventi: ev.length, sceneInterne: c.scene.filter(s => s.macro === h.macro).length,
        categorie: Object.assign({}, b.usato), realizzate: Object.assign({}, b.realizzate), previsto: Object.assign({}, b.previsto), tempoRealeMs: tempo(ev) };
    });
    const atti = {};
    Object.entries(macro).forEach(([id, m]) => { const a = atti[m.atto] = atti[m.atto] || { macro: 0, eventi: 0, sceneInterne: 0, tempoRealeMs: 0 }; a.macro += 1; a.eventi += m.eventi; a.sceneInterne += m.sceneInterne; a.tempoRealeMs += m.tempoRealeMs; });
    Object.values(atti).forEach(a => { a.fasciaOreIndicativa = FASCIA_ORE_ATTO.slice(); a.oreReali = Math.round(a.tempoRealeMs / 36e5 * 100) / 100; });
    return { scene, macro, atti, campagna: { eventi: evs.length, sceneInterne: c.scene.length, macro: c.storico.length, secondari: c.secondari.length, tempoRealeMs: tempo(evs) } };
  }

  /* Capacità strutturale (statica, dai dati): per atto macro-capitoli, archi
     locali, scene interne orientate dal budget, secondari espandibili e
     snodi. Serve a verificare che l'architettura possa reggere una
     campagna lunga senza simularla. */
  function dimensionamento(content) {
    const Sx = S(content);
    const atti = {};
    Object.values(Sx.macroCapitoli).forEach(m => {
      const a = atti[m.atto || 0] = atti[m.atto || 0] || { macro: 0, sceneOrientate: 0, snodi: 0, png: new Set(), scelte: 0 };
      a.macro += 1; a.sceneOrientate += Object.values(m.budget || {}).reduce((x, y) => x + y, 0); a.snodi += (m.snodi || []).length; (m.png || []).forEach(p => a.png.add(p)); a.scelte += (m.scelte || []).length;
    });
    Object.values(atti).forEach(a => { a.png = a.png.size; });
    return { atti, archiPersonali: Object.keys(Sx.archi || {}).length, tipiSecondari: SECONDARI.length, causeSecondari: CAUSE.length, snodiContratti: Object.keys(Sx.snodi || {}).length, faseSecondari: FASI_SEC.slice() };
  }
  /* Un contratto di snodo è completo quando dichiara tutti i campi (valore
     o null esplicito con fonte) e fissa le invarianti. */
  const CAMPI_SNODO = ['funzioneTrama', 'domandaTematica', 'conflitto', 'cambiamentoNecessario', 'fattiMinimi', 'rapportoArco', 'conseguenzeAmmesse', 'deviazioniCompatibili', 'condizioni', 'effettiTrasferiti'];
  function validaSnodo(k) {
    const e = [];
    CAMPI_SNODO.forEach(f => { if (!k || !k[f] || !('valore' in k[f]) || !k[f].fonte) e.push('campo ' + f + ' assente o senza fonte'); });
    if (!k || !Array.isArray(k.invarianti) || ['funzioneTrama', 'domandaTematica', 'fattiMinimi'].some(x => k.invarianti.indexOf(x) === -1)) e.push('invarianti mancanti');
    return e;
  }
  function voceBudget(content, macro) {
    const m = macroDef(content, macro) || {};
    const V = S(content).budgetVoci || {};
    return Object.keys(V).reduce((o, k) => { o[k] = (m.budget || {})[V[k]] || 0; return o; }, {});
  }

  /* ---------------------------------------------------- dopo il comando */
  function dopoComando(state, content, ev, cmd, applied) {
    const c = state.campagna;
    if (!c) return;
    if (c.macro !== state.scena) return;
    // comando che ha cambiato capitolo (prosegui): i suoi effetti (snodo
    // dell'uscita) appartengono al capitolo lasciato, già chiuso
    if (ev.scena !== state.scena) {
      ev.gerarchia = { campagna: content.id, atto: state.atto || 1, macroChapterId: c.macro, arcoLocale: c.arcoLocale, sceneId: c.scena, subsceneId: c.sottoscena, turnId: c.macro + '.t0', scenaChiusa: null, capitoloLasciato: ev.scena };
      return;
    }
    c.turno += 1;
    const segni = segnali(ev, cmd);
    const over = E().isOver(state);
    // conoscenze strutturate
    (ev.effetti || []).forEach(a => {
      if (a.tipo === 'scoperta') aggiungiConoscenza(state, content, { id: 'k:' + a.fatto, contenuto: a.testo, fonte: 'motore', metodo: ev.tipo === 'dialogo' || cmd.tipo === 'battuta' ? 'dialogo' : 'azione', entita: [a.fatto].concat(Object.keys(content.png || {}).filter(p => (content.png[p].sa || []).indexOf(a.fatto) !== -1)), affidabilita: 'certa', statoEpistemico: 'confermato', macro: c.macro, evento: ev.n });
      if (a.tipo === 'verita') aggiungiConoscenza(state, content, conoscenzaVerita(content, state.scena, a.id, a.metodo, ev.n));
      if (a.tipo === 'memoria' && (a.genere === 'testimonianza' || a.genere === 'dettaglio' || a.genere === 'rivelazione')) {
        const v = IM() && IM().memoria(state).voci.find(x => x.id === a.voce);
        if (v && v.statoCanonico !== 'effimero') aggiungiConoscenza(state, content, { id: 'k:' + v.id, contenuto: v.testo, fonte: v.bersaglio || 'luogo', metodo: v.tipo === 'testimonianza' ? 'dialogo' : 'improvvisazione', entita: [v.bersaglio, v.verita].filter(Boolean), affidabilita: v.statoEpistemico === 'menzogna_conosciuta' ? 'falsa' : v.statoEpistemico === 'testimoniato' ? 'testimonianza' : 'diretta', statoEpistemico: v.statoEpistemico, macro: c.macro, evento: ev.n });
      }
    });
    // PNG: interazioni, evoluzione derivata
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    if (P()) {
      const toccati = new Set();
      if (it && it.dialogo) toccati.add(it.dialogo);
      (ev.effetti || []).forEach(a => { if (a.png && content.png[a.png]) toccati.add(a.png); });
      toccati.forEach(id => P().registraInterazione(state, id, c.macro, ev.n));
      P().evolvi(state, content, c.macro, ev.n, applied);
    }
    // conseguenze persistenti di questo macro-capitolo
    if ((ev.effetti || []).some(a => PERSISTENTI.indexOf(a.tipo) !== -1) || segni.indexOf('conseguenza') !== -1) prove(state, c.macro).conseguenze.push(ev.n);
    const dial = eventiDialettici(state, content, ev, applied);
    if (eventoArco(state, content, ev, segni, applied)) segni.push('arco');
    aggiornaSecondari(state, content, ev, cmd, segni, applied);
    if ((ev.effetti || []).some(a => a.tipo === 'secondario_esito' || a.tipo === 'secondario_fase') && segni.indexOf('secondario') === -1) segni.push('secondario');
    richiestePremi(state, content, ev, dial, applied);
    // gerarchia: scena interna, sottoscena, arco locale
    let sc = scenaCorrente(state);
    if (!sc && !over) sc = apriScena(state, content, generaScena(state, content, motivoCorrente(state, content)), ev.n, applied);
    const focus = it && it.dialogo ? 'png:' + it.dialogo : ev.punto ? 'punto:' + ev.punto : state.incontro ? 'scontro' : c.focus;
    if (sc && focus !== c.focus) nuovaSottoscena(state, focus);
    let chiusa = null;
    if (sc) {
      sc.turni += 1;
      segni.forEach(s => { sc.segni.push({ tipo: s, evento: ev.n }); sc.peso += PESO[s] || 0; });
      const forte = segni.filter(s => PESO[s] >= 3).sort((a, b) => PESO[b] - PESO[a])[0];
      const suo = segni.filter(s => sc.trasformazioni.indexOf(s) !== -1).sort((a, b) => PESO[b] - PESO[a])[0];
      // la trasformazione prevista, una trasformazione forte, oppure un
      // accumulo significativo di cambiamenti di altro tipo
      const piuPesante = sc.segni.slice().sort((a, b) => (PESO[b.tipo] || 0) - (PESO[a.tipo] || 0))[0];
      const realizzata = forte || (suo && sc.peso >= 3 ? suo : null) || (sc.peso >= 6 && segni.length && piuPesante ? piuPesante.tipo : null);
      if (realizzata) {
        chiusa = sc.id;
        chiudiScena(state, content, sc, ev.n, { tipo: realizzata, evento: ev.n });
        if (['scelta', 'snodo', 'incontro'].indexOf(realizzata) !== -1) { c.arcoN += 1; c.arcoLocale = c.macro + '.a' + c.arcoN; }
        if (!over && c.macro === state.scena) apriScena(state, content, generaScena(state, content, motivoCorrente(state, content)), ev.n, applied);
      } else {
        // la situazione impone un'altra categoria (minaccia, dialogo): scena interrotta
        const mo = motivoCorrente(state, content);
        const impone = mo === 'minaccia' ? (sc.categoria !== 'combattimenti' && sc.categoria !== 'incontri') : false;
        if (impone && !over) { chiudiScena(state, content, sc, ev.n, null); apriScena(state, content, generaScena(state, content, mo), ev.n, applied); }
      }
    }
    ev.gerarchia = { campagna: content.id, atto: state.atto || 1, macroChapterId: c.macro, arcoLocale: c.arcoLocale, sceneId: chiusa || c.scena, subsceneId: c.sottoscena, turnId: c.macro + '.t' + c.turno, scenaChiusa: chiusa };
    if (!over) valutaUscita(state, content, applied, ev.n);
  }
  /* Eventi che meritano AP (chiavi uniche: mai per azioni ripetute o
     irrilevanti). Il motore assegna le quantità APPROVATE; le fonti ancora
     senza quantità approvata valgono zero in produzione (tabella delle
     proposte in PREMI_AP_DA_APPROVARE.md). */
  function richiestePremi(state, content, ev, dial, applied) {
    const c = state.campagna;
    const riservate = ((content.contratto || {}).verita_riservate) || [];
    const chiedi = (fonte, chiave) => applied.push({ tipo: 'premio_ap', fonte, chiave });
    (ev.effetti || []).slice().forEach(a => {
      if (a.tipo === 'scoperta' && riservate.indexOf(a.fatto) === -1) chiedi('scoperta_significativa', 'scoperta:' + a.fatto);
      if (a.tipo === 'png_legame') chiedi('relazione_trasformata', 'relazione:' + a.png + ':' + a.a);
      if (a.tipo === 'conseguenza_applicata') chiedi('conseguenza_affrontata', 'conseguenza:' + a.id);
    });
    (dial || []).filter(e => e.png && (e.tipo === 'respinge' || (e.tipo === 'confronto' && (e.funzione === 'antitesi' || e.funzione === 'specchio')))).forEach(e => chiedi('conflitto', 'conflitto:' + e.png + ':' + c.macro));
    // uno scontro con una posta: non la fuga al primo scambio
    if (ev.incontroEsito && !(ev.incontroEsito === 'fuga' && ev.combattimento && ev.combattimento.round <= 1)) chiedi('combattimento', 'combattimento:' + c.macro);
  }
  function registraLivelli(state, applied) {
    const c = state.campagna;
    if (!c) return;
    applied.filter(a => a.tipo === 'avanzamento').forEach(a => c.livelli.push({ livello: a.livello, atto: state.atto || 1, macro: state.scena }));
  }

  /* ---------------------------------------------- progressione (AP)
     Il livello deriva SOLO dalle tacche (AP) e dalle soglie approvate. Qui:
     - il modello degli eventi attesi per capitolo (dai dati e dal piano);
     - la pianificazione diagnostica: con i premi approvati e con quelli
       proposti, a che livello si arriva capitolo per capitolo e se il Lv 30
       arriva alcuni capitoli prima del confronto conclusivo;
     - i moltiplicatori d'atto proposti che servirebbero (tabella da
       approvare). Nessuna soglia, formula o quantità approvata cambia. */
  const cacheMolt = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function valorePremio(premi, k) { const v = premi[k]; return typeof v === 'object' && v ? Math.max.apply(null, Object.values(v)) : (Number(v) || 0); }
  function eventiAttesi(content, m) {
    const sc = E().sceneOf(content, m.macroChapterId) || {};
    const riservate = ((content.contratto || {}).verita_riservate) || [];
    const atto = m.atto || 1;
    const nAtto = Object.values(S(content).macroCapitoli).filter(x => x.atto === atto && !x.epilogo).length || 1;
    const archi = ARCHI_SECONDARI_PER_ATTO[atto] || 3;
    let conseguenze = 0;
    (function walk(e) { if (!e) return; if (Array.isArray(e)) return e.forEach(walk); if (typeof e === 'object') { if (e.conseguenza) conseguenze++; Object.values(e).forEach(walk); } })([sc.scelte, sc.obiettivi, sc.uscite]);
    return {
      approvati: { scena_nuova: 1, obiettivo: (sc.obiettivi || []).length, snodo: m.snodi.length, verita: m.fatti.filter(f => riservate.indexOf(f) !== -1).length, legame: Math.ceil((m.png || []).length / 2) },
      proposti: {
        secondario_fase: archi * 2 / nAtto, secondario_esito: archi / nAtto, arco: 1 / nAtto,
        scoperta_significativa: m.fatti.filter(f => riservate.indexOf(f) === -1).length,
        conflitto: Math.ceil((m.png || []).length / 2), relazione_trasformata: (m.png || []).length / 3,
        combattimento: sc.incontro ? 1 : 0, conseguenza_affrontata: conseguenze
      }
    };
  }
  function costiAtto(content, atto) {
    const f = ((content.progressione || {}).fasce || {})[String(atto)] || [1, 30];
    let t = 0;
    for (let lv = Math.max(2, f[0]); lv <= f[1]; lv++) t += E().tickCost(lv, content);
    return t;
  }
  function capitoliUtili(content, atto) {
    const K = Object.values(S(content).macroCapitoli).sort((a, b) => a.ordine - b.ordine);
    const conf = K.find(m => m.confrontoConclusivo);
    const margine = 1; // il Lv 30 va raggiunto entro il capitolo precedente al confronto
    return K.filter(m => m.atto === atto && !m.epilogo && (atto < 3 || !conf || m.ordine <= conf.ordine - margine));
  }
  function moltiplicatoriProposti(content) {
    if (cacheMolt && cacheMolt.has(content)) return cacheMolt.get(content);
    const premi = (content.progressione || {}).premi || {};
    const prop = S(content).premiProposti || {};
    const out = {};
    [1, 2, 3].forEach(atto => {
      const caps = capitoliUtili(content, atto);
      let A = 0, B = 0;
      caps.forEach(m => { const e = eventiAttesi(content, m); Object.entries(e.approvati).forEach(([k, n]) => { A += n * valorePremio(premi, k); }); Object.entries(e.proposti).forEach(([k, n]) => { B += n * ((prop[k] || {}).valore || 0); }); });
      const need = costiAtto(content, atto);
      out[atto] = { tacchePerAtto: need, attesiApprovati: Math.round(A), attesiPropostiBase: Math.round(B), moltiplicatore: B > 0 ? Math.max(1, Math.ceil(Math.max(0, need - A) / B)) : null, capitoli: caps.map(m => m.macroChapterId) };
    });
    if (cacheMolt) cacheMolt.set(content, out);
    return out;
  }
  // quantità del premio per una fonte: approvata, altrimenti (solo in anteprima) proposta
  function quantitaPremio(state, content, fonte) {
    const premi = (content.progressione || {}).premi || {};
    if (premi[fonte] != null) return { valore: valorePremio(premi, fonte), approvato: true };
    const p = (S(content).premiProposti || {})[fonte];
    if (!p) return { valore: 0, approvato: false };
    const molt = (moltiplicatoriProposti(content)[state.atto || 1] || {}).moltiplicatore || 1;
    return { valore: state.anteprima ? p.valore * molt : 0, approvato: false, proposto: p.valore * molt };
  }
  function proiezione(content, conProposte, statoIniziale) {
    const premi = (content.progressione || {}).premi || {};
    const prop = S(content).premiProposti || {};
    const molt = moltiplicatoriProposti(content);
    const fasce = (content.progressione || {}).fasce || {};
    let lv = statoIniziale ? statoIniziale.livello : 1, tacche = statoIniziale ? statoIniziale.tacche : 0;
    const visti = statoIniziale ? statoIniziale.visti : new Set();
    const righe = [];
    Object.values(S(content).macroCapitoli).sort((a, b) => a.ordine - b.ordine).filter(m => !visti.has(m.macroChapterId)).forEach(m => {
      const e = eventiAttesi(content, m);
      let t = 0;
      Object.entries(e.approvati).forEach(([k, n]) => { t += n * valorePremio(premi, k); });
      if (conProposte) Object.entries(e.proposti).forEach(([k, n]) => { t += n * ((prop[k] || {}).valore || 0) * ((molt[m.atto] || {}).moltiplicatore || 1); });
      tacche += t;
      const max = (fasce[String(m.atto)] || [1, 30])[1];
      while (lv < 30 && lv < max && tacche >= E().tickCost(lv + 1, content)) { tacche -= E().tickCost(lv + 1, content); lv++; }
      righe.push({ capitolo: m.macroChapterId, atto: m.atto, confronto: m.confrontoConclusivo, tacche: Math.round(t), livello: lv });
    });
    const conf = righe.findIndex(r => r.confronto);
    const primo30 = righe.findIndex(r => r.livello >= 30);
    return { righe, livelloAlConfronto: conf !== -1 ? (righe[conf - 1] || righe[conf]).livello : lv, trentaPrimaDelConfronto: primo30 !== -1 && (conf === -1 || primo30 < conf), capitoliDiAnticipo: primo30 !== -1 && conf !== -1 ? conf - primo30 : 0 };
  }
  function diagnosticaProgressione(state, content) {
    const P_ = state.progresso || { premiati: {}, tacche: 0 };
    const perFonte = {};
    Object.entries(P_.premiati || {}).forEach(([k, v]) => { const f = k.split(':')[0]; perFonte[f] = (perFonte[f] || 0) + v; });
    const pg = state.personaggio;
    let servono = -(P_.tacche || 0);
    for (let lv = pg.livello + 1; lv <= 30; lv++) servono += E().tickCost(lv, content);
    const visti = new Set(((state.campagna || {}).storico || []).map(h => h.macro));
    const base = { livello: pg.livello, tacche: P_.tacche || 0, visti };
    const approvati = proiezione(content, false, base), conProposte = proiezione(content, true, base);
    const perAtto = {};
    ((state.campagna || {}).livelli || []).forEach(l => { perAtto[l.atto] = Math.max(perAtto[l.atto] || 0, l.livello); });
    return {
      livello: pg.livello, tacche: P_.tacche || 0, tacchePerFonte: perFonte, livelloMassimoPerAtto: perAtto, fasce: (content.progressione || {}).fasce || {},
      tacchePerL30: Math.max(0, servono), nonAssegnatePerFonte: Object.assign({}, P_.nonApprovati || {}),
      conPremiApprovati: { livelloAlConfronto: approvati.livelloAlConfronto, trentaPrimaDelConfronto: approvati.trentaPrimaDelConfronto },
      conPremiProposti: { livelloAlConfronto: conProposte.livelloAlConfronto, trentaPrimaDelConfronto: conProposte.trentaPrimaDelConfronto, capitoliDiAnticipo: conProposte.capitoliDiAnticipo },
      rischioL30: approvati.trentaPrimaDelConfronto ? 'basso' : conProposte.trentaPrimaDelConfronto ? 'dipende_da_approvazione' : 'alto',
      moltiplicatori: moltiplicatoriProposti(content),
      livelloQuando: (S(content).progressione || {}).livelloQuando || 'soglia_ap',
      nota: 'Le formule non cambiano. Senza i premi da approvare il livello al confronto resta quello indicato con i soli premi approvati.'
    };
  }
  // tabella dei premi mancanti da sottoporre ad approvazione
  function tabellaPremiMancanti(content) {
    const premi = (content.progressione || {}).premi || {};
    const prop = S(content).premiProposti || {};
    const molt = moltiplicatoriProposti(content);
    return Object.keys(prop).filter(k => premi[k] == null).map(k => ({ fonte: k, valoreBase: prop[k].valore, atto1: prop[k].valore * (molt[1].moltiplicatore || 1), atto2: prop[k].valore * (molt[2].moltiplicatore || 1), atto3: prop[k].valore * (molt[3].moltiplicatore || 1), antiAccumulo: prop[k].antiAccumulo, stato: 'da_approvare' }));
  }

  /* ----------------------------------------------- contesto compatto
     Sezioni con tetto e stima dei token (≈ 3,5 caratteri per token in
     italiano): entra nel prompt del Regista già esistente, nessuna
     chiamata in più. Le sezioni meno urgenti si tagliano per prime. */
  function contestoCompatto(state, content, opts) {
    const c = state.campagna;
    if (!c) return null;
    const cfg = Object.assign({ budget: ((S(content).contesto || {}).budgetCampagna) || 520 }, opts || {});
    const m = macroDef(content, c.macro) || {};
    const sc = scenaCorrente(state);
    const A = arcoDi(state, content);
    const atto = state.atto || 1;
    const occ = A ? (atto === 1 ? A.fratturaAttoI : atto === 2 ? A.confrontoAttoII : A.esitoAttoIII).valore : null;
    const pn = pianifica(state, content);
    const pres = (E().sceneOf(content, c.macro) || {}).png_presenti || [];
    const sint = sintesi(state, content);
    const sezioni = [
      ['capitolo', 'ATTO ' + (state.atto || 1) + ' · CAPITOLO: ' + (m.titolo || c.macro) + (m.funzione ? ' — ' + m.funzione : '') + (m.importanza !== 'normale' ? ' (' + m.importanza + ')' : '')],
      ['scena', sc ? 'SCENA INTERNA: ' + sc.funzione + (sc.focus ? ' · fuoco: ' + sc.focus : '') : ''],
      ['tema', (S(content).tema || {}).domanda ? 'TEMA: ' + S(content).tema.domanda + (sint.accolte.length || sint.respinte.length ? ' · posizioni accolte: ' + (sint.accolte.join(', ') || '—') + '; respinte: ' + (sint.respinte.join(', ') || '—') : '') : ''],
      ['arco', occ ? 'ARCO PERSONALE (atto ' + (state.atto || 1) + '): ' + String(occ).slice(0, 220) : ''],
      ['png', pres.length && P() ? 'PNG (legame/funzione/voce): ' + pres.map(id => { const v = P().vista(state, content, id); return v.nome.split(' (')[0] + ' ' + v.legame + '/' + v.funzione + (v.voce ? '/' + v.voce.formalita + ',' + v.voce.lunghezza + 'p' : ''); }).join('; ') : ''],
      ['sviluppo', pn.prossimo ? 'SVILUPPO POSSIBILE (se la scena lo permette, mai forzato): ' + pn.prossimo.voce + ' da ' + pn.prossimo.fonte : ''],
      ['secondari', c.secondari.filter(x => x.stato === 'aperto' || x.stato === 'tornato').slice(-3).map(x => x.categoria + ' (' + x.fase + '): ' + String(x.causa).slice(0, 80)).join('; ')],
      ['memoria', c.memoria.capitoli.slice(-2).map(x => x.titolo + ': ' + String(x.riassunto || '').slice(0, 160)).concat(c.memoria.atti.slice(-1).map(a => 'Atto ' + a.atto + ': ' + a.decisioni.slice(-2).join('; '))).join(' | ')]
    ].filter(s => s[1]);
    const ordineTaglio = ['memoria', 'sviluppo', 'secondari', 'arco', 'tema', 'png'];
    const tok = () => sezioni.reduce((a, s) => a + stimaToken(s[1]), 0);
    const tagliate = [];
    while (tok() > cfg.budget && ordineTaglio.length) {
      const k = ordineTaglio.shift();
      const i = sezioni.findIndex(s => s[0] === k);
      if (i !== -1) { sezioni[i][1] = sezioni[i][1].slice(0, Math.floor(sezioni[i][1].length / 3)); tagliate.push(k); }
    }
    const testo = sezioni.map(s => s[1]).join('\n');
    return { testo, token: { sezioni: sezioni.reduce((o, s) => { o[s[0]] = stimaToken(s[1]); return o; }, {}), totale: stimaToken(testo), budget: cfg.budget }, tagliate };
  }
  function diagnosticaContesto(state, content, testo) {
    const cfg = S(content).contesto || { nCtx: 4096, riservaUscita: 900 };
    const pr = IM() ? IM().promptRegia(state, content, testo || '', null) : { system: '', user: '' };
    const prompt = stimaToken(pr.system) + stimaToken(pr.user);
    return { nCtx: cfg.nCtx, riservaUscita: cfg.riservaUscita, prompt, campagna: (contestoCompatto(state, content) || { token: { totale: 0 } }).token.totale, entro: prompt + cfg.riservaUscita <= cfg.nCtx };
  }
  // conoscenze per il contesto: pertinenti ai PNG presenti e al capitolo, poi le più recenti
  function conoscenzePertinenti(state, content, n) {
    const c = state.campagna; if (!c) return [];
    const pres = new Set((E().sceneOf(content, state.scena) || {}).png_presenti || []);
    const rif = new Set(Object.values((macroDef(content, state.scena) || {}).riferimenti || {}).flatMap(o => Object.values(o).flat()));
    const peso = k => (k.macro === state.scena ? 3 : 0) + (k.entita.some(x => pres.has(x)) ? 2 : 0) + (k.entita.some(x => rif.has(x)) ? 2 : 0);
    return c.conoscenze.map((k, i) => [k, peso(k) * 1000 + i]).sort((a, b) => b[1] - a[1]).slice(0, n || 8).map(x => x[0].contenuto);
  }

  function vista(state, content) {
    const c = state.campagna;
    if (!c) return null;
    const sc = scenaCorrente(state);
    return { atto: state.atto || 1, capitolo: (macroDef(content, c.macro) || {}).titolo, focus: sc ? sc.funzione : null, prontoAProseguire: !!c.uscitaPronta, epilogo: !!c.epilogo };
  }

  global.RMSoloStruttura = {
    VERSIONE, CATEGORIE, SECONDARI, CLAUSOLE, FUNZIONI, FUNZIONI_NARRATIVE, FUNZIONI_DI, TEMI_DI, CAMPI_SNODO,
    diagnosticaRitmo, dimensionamento, validaSnodo, voceBudget, fattoriPartita, budgetMacro, fonteReale,
    attivo, macroDef, migra, entraMacro, apriEpilogo, epilogo, dopoComando, registraLivelli,
    valutaContratto, valutaUscita, pronta, prosegui, motivoNonPronta, intenzioneDiUscire,
    generaScena, validaScena, apriScena, scenaCorrente, segnali,
    apriSecondario, sintesi, riferimenti, conoscenzePrecedenti, conoscenzePertinenti,
    diagnosticaProgressione, contestoCompatto, diagnosticaContesto, stimaToken, vista,
    pianifica, fontiPersistenti, statoArco, quantitaPremio, moltiplicatoriProposti, proiezione, tabellaPremiMancanti, CAUSE, FASI_SEC, PIANO
  };
})(typeof window !== 'undefined' ? window : globalThis);
