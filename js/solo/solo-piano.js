/* ==========================================================================
   Role Makers — Gioca in solitaria: il regista del turno (motore V2, modulo 2).

   Dopo che il motore delle regole ha deciso l'esito, il regista costruisce il
   PIANO del turno: una lista di battute da raccontare, nell'ordine, che
   finisce su una situazione aperta. Il narratore scrive SOLO le battute del
   piano; il post-processo controlla che ci siano e che non decidano per il
   protagonista.

   Il regista è deterministico (stesso stato = stesso piano; nessun dado della
   partita, il generatore è quello legato a partita ed evento di RMSoloTrama)
   e scrive solo state.mondo, ev.piano e state.repertorio (le frasi generiche già usate): mai esiti, risorse, oggetti o flag.

   Che cosa decide:
   - INIZIATIVA DEI PNG: ogni 3 turni (CADENZA) un PNG presente agisce senza
     essere stato interpellato, in base al suo obiettivo e al suo stato;
   - FRONTI: le scadenze del motore (orologi) diventano pressione raccontata;
   - COSTO CONCRETO DEL SUCCESSO PARZIALE: sguardo, debito, tempo o traccia,
     registrato nel mondo come filo e stato del PNG, e che TORNA dopo;
   - CHIUSURA DEI FILI: i fili che il regista stesso apre (costi) e i fili di
     contorno si chiudono con una battuta, i fili del giocatore mai;
   - CHIUSURA DEL TURNO: sempre su una situazione, mai su un'azione del
     protagonista.

   Tabelle di mosse, costi e frasi: scritte da zero per questo progetto,
   PROPOSTE DA APPROVARE (docs/single-player/DECISIONI_DA_RIVEDERE.md). Nessuna
   costante di regolamento. Le frasi non usano pronomi per i PNG (il loro
   genere non è dato) e non citano mai segreti o lessico ancora bloccato.
   ========================================================================== */
(function (global) {
  'use strict';

  const VERSIONE = 1;
  // PROPOSTA DA APPROVARE: cadenza dell'iniziativa dei PNG (ogni 3 turni) e anzianità dei fili
  const CADENZA = 3;
  const ETA_FILO = 6;
  const ETA_COSTO = { tempo: 3, traccia: 4 };
  const TETTO_BATTUTE = 6;
  const TIPI_PIANIFICABILI = ['azione', 'improvvisazione', 'esplorazione', 'battuta', 'dialogo', 'dialogo_fine', 'scelta', 'oracolo', 'riposo', 'raccogli', 'obiettivo_personale'];
  const MOSSE = ['chiede', 'avverte', 'riscuote', 'confronta', 'offre', 'ostacola'];
  const COSTI = ['sguardo', 'debito', 'tempo', 'traccia'];
  const VINCOLI = [
    'Non decidere, pensare, sentire o dire nulla al posto del protagonista: puoi solo descrivere ciò che accade intorno.',
    'Non aggiungere esiti, oggetti, danni, numeri o cambiamenti di luogo che il piano non contiene.',
    'Fai agire e parlare solo i personaggi presenti.',
    'Non rivelare ciò che il protagonista non sa.'
  ];

  const E = () => global.RMSoloEngine;
  const M = () => global.RMSoloMondo;
  const T = () => global.RMSoloTrama;

  /* ------------------------------------------------------------ utilità */
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nomePng = (content, id) => String(((content.png || {})[id] || {}).nome || id).replace(/\s*\([^)]*\)/g, '').trim();
  const minus = t => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1);
  const punto = t => { const s = String(t || '').trim(); return /[.!?…»]$/.test(s) ? s : s + '.'; };
  const sceneOf = (state, content) => E().currentScene(state, content);
  const hash = (state, sale, max) => T().tiroDet(state, 'pv2:' + sale, max) - 1;   // 0..max-1
  const scegliVariante = (state, sale, lista) => lista[hash(state, sale, lista.length)];
  const riempi = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : ''));

  /* Scopo di un PNG per il racconto: la prima parte della motivazione, solo se è sicura
     (nessun segreto, nessun lessico ancora bloccato). Altrimenti null: le frasi senza scopo. */
  function scopoDi(state, content, id) {
    const mot = String(E().motivazionePng(state, (content.png || {})[id]) || '').trim();
    if (!mot) return null;
    const primo = mot.split(/,|\s+finché\s+|\s+senza\s+|\s+sapendo\s+/)[0].trim();
    if (primo.length < 8) return null;
    const t = minus(primo);
    return M().testoSicuro(state, content, t).ok ? t : null;
  }

  /* ------------------------------------------------------------ tabelle (PROPOSTE) */
  /* Mosse dei PNG: ogni variante ha una frase con e una senza lo scopo. {N}=nome, {S}=scopo, {F}=fronte. */
  const MOSSE_TESTI = {
    // Le iniziative dei PNG si raccontano come azioni e battute, in seconda persona: niente appunti di regia ("scopo", "protagonista").
    chiede: {
      guida: 'si ferma davanti a te senza essere stato interpellato e vuole sapere da che parte stai',
      senza: ['{N} ti taglia la strada con calma. «Da che parte stai?» chiede, senza giri di parole.',
        '{N} si pianta davanti a te e ti guarda negli occhi. «Dimmi con chi sei, adesso.»']
    },
    avverte: {
      guida: 'abbassa la voce e ti avverte che il tempo stringe',
      con: ['{N} si avvicina e abbassa la voce. «{F} non aspetta nessuno» dice. «Non te lo ripeto.»',
        '{N} ti prende da parte. «{F} si fa sentire» mormora. «Chi sta fermo paga.» Poi tace, in attesa.'],
      senza: ['{N} si avvicina e abbassa la voce. «Il tempo stringe» dice. «Non vale la pena far finta di niente.»',
        '{N} ti prende da parte. «Chi sta fermo, qui, paga» mormora. Poi tace, in attesa.']
    },
    riscuote: {
      guida: 'ti ricorda un aiuto concesso e chiede qualcosa in cambio',
      senza: ['{N} ti ferma. «Ti ho dato una mano» dice. «Adesso tocca a te.»',
        '{N} ti ricorda, a bassa voce, quello che ti ha concesso. «I conti si chiudono» aggiunge.']
    },
    confronta: {
      guida: 'ha osservato quello che hai fatto e ti chiede conto',
      senza: ['{N} ti guarda a lungo prima di parlare. «Ho visto quello che hai fatto» dice. «Voglio sentirlo da te, non una scusa.»',
        '{N} si pianta davanti a te. «Ho messo insieme i pezzi» dice. «Adesso dimmi come stanno le cose.»']
    },
    offre: {
      guida: 'si fa avanti con un\'informazione o un aiuto, in cambio di fiducia',
      senza: ['{N} ti raggiunge e abbassa la voce. «Se ti serve una mano, io ci sono» dice. «La fiducia si costruisce a piccoli passi.»',
        '{N} si fa avanti di sua iniziativa. «Ho qualcosa che può servirti» dice, e aspetta che tu glielo chieda.']
    },
    ostacola: {
      guida: 'si mette di traverso e ti fa capire che così non va',
      senza: ['{N} blocca il passaggio senza alzare la voce. «Così non va» dice. «Per ora si ferma tutto.»',
        '{N} si mette di traverso. «Non è il momento» dice. «Non andare avanti.»']
    }
  };

  /* Costi del successo parziale: come cambia il mondo, non le risorse del regolamento. */
  const COSTI_TESTI = {
    sguardo: {
      guida: 'ce l\'hai fatta, ma {N} ha visto più di quanto avresti voluto',
      prosa: ['Ce l\'hai fatta, ma non senza essere visto: {N} ha notato come hai agito.', 'Il risultato c\'è, ma {N} ti ha guardato mentre lo ottenevi, e non lo dimenticherà.'],
      filo: '{N} ha notato come hai agito'
    },
    debito: {
      guida: 'ce l\'hai fatta accettando l\'aiuto di {N}: ora c\'è un conto aperto',
      prosa: ['Ce l\'hai fatta solo perché {N} ha messo una parola buona o una mano: adesso c\'è un conto aperto.', 'Il risultato c\'è, ma ti è costato un favore: {N} non lo ha dimenticato e tu nemmeno.'],
      filo: 'Debito con {N}'
    },
    tempo: {
      guida: 'ce l\'hai fatta, ma ti è costato più tempo del previsto mentre «{F}» incombe',
      prosa: ['Ce l\'hai fatta, ma ti ha portato via più tempo del previsto, e «{F}» non aspetta.', 'Il risultato c\'è, ma il tempo speso lo senti addosso: «{F}» non si è fermata per te.'],
      filo: 'Il tempo perso pesa su «{F}»'
    },
    traccia: {
      guida: 'ce l\'hai fatta, ma hai lasciato tracce di ciò che hai fatto in questo posto',
      prosa: ['Ce l\'hai fatta, ma hai lasciato dietro di te tracce che qualcuno potrebbe seguire.', 'Il risultato c\'è, ma non è stato pulito: restano segni del tuo passaggio, e non puoi cancellarli tutti.'],
      filo: 'Tracce lasciate in {L}'
    }
  };

  /* Quando un costo torna a presentare il conto. */
  const SCADENZE_TESTI = {
    tempo: { guida: 'il tempo speso si fa sentire sul fronte', prosa: ['Il tempo che hai speso si fa sentire: «{F}» è un po\' più vicina al limite di quanto fosse, e ogni scelta, adesso, pesa di più.'] },
    traccia: { guida: 'qualcuno ha seguito le tracce lasciate', prosa: ['Qualcuno è passato dove avevi lasciato le tue tracce. Non ti ha trovato, ma ora c\'è chi sa che qui c\'è stato qualcuno.'] }
  };
  const CHIUSURA_FILO = {
    png: 'Quanto era rimasto in sospeso con {N} si è assestato: nessuno ne parla più, per ora.',
    fronte: 'Il segnale di prima è passato senza altre conseguenze immediate.',
    costo: 'Il conto lasciato aperto non è stato riscosso: per ora, nessuno ne parla più.'
  };
  const FRONTE_TESTI = {
    minaccia: {
      1: 'Qualcosa, in lontananza, ricorda che «{F}» è in corso: per ora è solo un segno.',
      2: '«{F}» si fa sentire: ormai non è più un\'ipotesi.',
      3: 'Con «{F}» si è vicini al limite: ogni scelta, adesso, pesa sul tempo che resta.'
    },
    avanzamento: {
      1: 'Il lavoro di «{F}» è cominciato: se ne vedono i primi segni.',
      2: 'Il lavoro di «{F}» va avanti e comincia a dare risultati.',
      3: 'Il lavoro di «{F}» è quasi al termine: ancora poco.'
    }
  };

  /* ------------------------------------------------------------ selezione */
  const eventoPianificabile = (state, ev) => TIPI_PIANIFICABILI.indexOf(ev.tipo) !== -1 && !state.incontro && ev.scena === state.scena && state.stato === 'attivo';

  function presenti(state, content) { return E().presentiEffettivi(state, content); }
  const atteggiamento = (state, id) => Number(((state.png || {})[id] || {}).atteggiamento) || 0;
  const frontiAttivi = (state, polarita) => (state.mondo.fronti || []).filter(f => ((state.orologi || {})[f.orologio] || {}).attivo && (!polarita || f.polarita === polarita));

  function scegliPng(state, content, ev, escludi) {
    const m = state.mondo;
    const cand = presenti(state, content).filter(id => escludi.indexOf(id) === -1);
    if (!cand.length) return null;
    const punteggio = id => {
      const n = m.png[id];
      return 1 + 2 * n.sospetto + 2 * n.debito + n.obiettivo.urgenza + Math.min(6, ev.n - n.ultimoTurnoAttivo) / 2;
    };
    const ord = cand.map(id => ({ id, p: punteggio(id) })).sort((a, b) => b.p - a.p);
    const top = ord.filter(x => x.p === ord[0].p);
    return top[hash(state, 'png' + ev.n, top.length)].id;
  }
  function scegliMossa(state, content, id) {
    const n = state.mondo.png[id];
    const att = atteggiamento(state, id);
    let mossa;
    if (n.sospetto >= 2) mossa = 'confronta';
    else if (n.debito >= 1) mossa = 'riscuote';
    else if (frontiAttivi(state, 'minaccia').some(f => f.pressione >= 2) && att >= 0) mossa = 'avverte';
    else if (att >= 1) mossa = 'offre';
    else if (att <= -1) mossa = 'ostacola';
    else mossa = 'chiede';
    if (mossa === n.mossaRecente) {
      const alt = ['chiede', att >= 0 ? 'offre' : 'ostacola', 'avverte'].filter(x => x !== mossa);
      mossa = alt[hash(state, 'alt' + id, alt.length)];
    }
    return mossa;
  }

  function beat(piano, tipo, o) {
    const b = Object.assign({ id: 'b' + (piano.battute.length + 1), tipo, guida: '', prosa: '', fonte: 'regista', obbligatoria: true, maxFrasi: 2 }, o);
    piano.battute.push(b);
    return b;
  }

  /* Testo canonico dell'esito, senza l'imprevisto (che ha un suo beat). */
  function testoEsito(state, content, ev) {
    let t = String(E().fallbackText(state, content, ev, { v1: true }) || '').trim();
    if (ev.imprevisto && ev.imprevisto.testo) t = t.replace(ev.imprevisto.testo, '').trim();
    // l'iniziativa di un PNG per i giri a vuoto ha la sua battuta nel piano: non va ripetuta nell'esito
    if (ev.spinta && ev.spinta.testo) t = t.replace(ev.spinta.testo, '').trim();
    return t;
  }

  /* Comportamento del PNG deciso dal motore (RMSoloPng.sceltaDialogo, tono della battuta), detto come dato al Narratore. */
  const COMPORTAMENTI = {
    chiede_in_cambio: 'vuole qualcosa in cambio prima di rispondere', devia: 'evita la domanda e cambia discorso', tace: 'non risponde',
    coopera: 'risponde volentieri con ciò che pensa e con ciò che vuole, ma senza informazioni che il gioco non gli dà', rivela: 'risponde volentieri con ciò che pensa e con ciò che ricorda, ma senza informazioni che il gioco non gli dà', conferma: 'risponde volentieri con ciò che pensa e con ciò che ricorda, ma senza informazioni che il gioco non gli dà',
    minaccia: 'si irrigidisce, ostile', sfida: 'si irrigidisce, ostile', mente: 'non dice la verità per proteggersi',
    esita: 'esita: risponde poco e con cautela, senza sbilanciarsi',
    valuta: 'soppesa l\'offerta: è più disponibile, ma non promette e non concede nulla adesso',
    interessato: 'ne parla volentieri perché gli sta a cuore, ma dice solo ciò che pensa e può tenere per sé ciò che non deve dire'
  };
  const TONI = { promessa: 'prende nota della promessa, senza impegnarsi', minaccia: 'non si lascia intimidire', menzogna: 'ascolta, e per ora sembra crederci' };
  function guidaRispostaComune(content, ev) {
    const r = ev.rispostaComune, nome = nomePng(content, ev.png);
    const come = (r.tono && TONI[r.tono]) || COMPORTAMENTI[r.comportamento] || 'reagisce con prudenza';
    // il motivo è quello del motore (RMSoloPng.sceltaDialogo): perché il PNG si comporta così, detto come dato
    // tre livelli del Narratore (DECISIONI §13): il PNG può dire cose sue (livello 2: opinioni, ricordi, dettagli, proposte, anche economiche)
    // come affermazioni sue; ciò che cambia lo stato (denaro e oggetti passati di mano, danni, spostamenti) e i segreti restano al motore
    const sc = (content.scene || []).find(x => x.id === ev.scena) || {};
    const situazione = String(sc.apertura_riserva || sc.descrizione || '').slice(0, 240);
    return 'Nessun testo d\'autore per questa battuta: ' + nome + ' risponde da personaggio, in modo pertinente, a ciò che il giocatore ha scritto (' + come + (r.motivo && !r.tono ? '; perché: ' + r.motivo : '') + '), coerente con ciò che vuole. ' +
      'Può dire opinioni, ricordi suoi, dettagli e proposte coerenti con il mondo, come affermazioni sue; non passa di mano denaro o oggetti, non ferisce, non sposta nessuno, non rivela segreti. ' +
      'Non ripete le parole del giocatore. Se non vuole rispondere lo dice chiaramente, con un motivo.' + (r.voce ? ' Modo di parlare (esempio, non da ripetere): ' + r.voce : '') + (situazione ? ' Situazione: ' + situazione : '') + misteriAperti(content, ev);
  }
  /* Misteri del canone (content.misteri, livello 1): fino alla scena indicata nessun personaggio li spiega né li lega ad altro (B04/A11). */
  function misteriAperti(content, ev) {
    const ordine = (content.scene || []).map(s => s.id), qui = ordine.indexOf(ev.scena);
    const aperti = (content.misteri || []).filter(m => m && m.testo && (qui === -1 || ordine.indexOf(m.fino_a) === -1 || qui < ordine.indexOf(m.fino_a)));
    return aperti.length ? ' Restano senza spiegazione, e nessuno li spiega né li collega ad altro: ' + aperti.map(m => m.testo).join('; ') + '.' : '';
  }

  /* Dati di un round con soli attacchi, a scontro aperto (con vittoria, fuga o sconfitta vale il testo d'autore della scena). Solo ciò che il
     motore ha deciso: chi colpisce per primo, con che cosa, quale difesa è stata tentata e se è riuscita, se il colpo va a segno. */
  const DIFESA = { block: 'parare', dodge: 'schivare' };
  function guidaCombattimento(state, content, ev) {
    const inc = ev.combattimento, az = (inc && inc.azioni) || [];
    if (!inc || inc.gruppo || ev.incontroEsito || !state.incontro || !az.length || az.some(a => a.tipo !== 'attacco')) return null;
    const nem = ev.nemicoArt || ev.nemicoNome || 'l\'avversario', Nem = nem.charAt(0).toUpperCase() + nem.slice(1);
    const va = a => (a.perso != null ? a.perso : (a.esito || {}).finalDamage) > 0;
    const difesa = (a, chi) => { const d = (a.esito || {}).defense; if (!d || !DIFESA[d.type]) return ''; return chi ? chi + ' prova a ' + DIFESA[d.type] + (d.success ? ' e ci riesce' : ' ma non ci riesce') : 'provi a ' + DIFESA[d.type] + (d.success ? ' e ci riesci' : ' ma non ci riesci'); };
    const pieno = a => va(a) && (a.esito || {}).crit && a.esito.crit.critico ? 'in pieno, colpo critico' : '';
    const frasi = az.map(a => a.chi === 'nemico'
      ? Nem + (inc.iniziativa === 'nemico' && a === az[0] ? ' è più veloce e attacca prima di te' : ' attacca') + ' con ' + String(a.capacita || 'un attacco').toLowerCase() + ': ' + [difesa(a, null), va(a) ? 'ti ferisce' : 'non ti raggiunge', pieno(a)].filter(Boolean).join(', ')
      : 'Attacchi ' + nem + ' con ' + a.capacita + ': ' + [difesa(a, nem), va(a) ? 'il colpo va a segno' : 'il colpo non va a segno', pieno(a)].filter(Boolean).join(', '));
    const def = (content.nemici || {})[state.incontro.nemicoId] || {};
    const scheda = def.pngId && content.png[def.pngId] && content.png[def.pngId].ruolo;
    // scontro non letale (decisione dell'autore del 6/11): nessuna etichetta tecnica, ma l'avversario lo mostra col comportamento;
    // a HP critici si racconta il pericolo che il motore rende davvero possibile (finire a terra, essere sopraffatta), non la morte
    const pg = state.personaggio || {}, critico = (Number(pg.hpCur) || 0) <= Math.max(1, (Number(pg.hpMaxTracked) || 0) * 0.25);
    const intenzioni = state.incontro.letale ? '' : ' Intenzione dell\'avversario: non cerca il colpo mortale (vuole liberarsi, fuggire o difendersi); mostralo con i gesti, senza dirlo come una regola.';
    const pericolo = critico ? ' Il protagonista è allo stremo: racconta il pericolo concreto di ' + (state.incontro.letale ? 'morire' : 'finire a terra, sopraffatto') + ', senza inventare altro.' : '';
    return 'Scontro, dati del motore (non cambiarli): ' + frasi.join('. ') + '. Lo scontro continua.' + (scheda ? ' Chi è: ' + scheda + '.' : '') + intenzioni + pericolo +
      ' Racconta questi colpi in quest\'ordine, con l\'arma e l\'attacco nominati; nessuna ferita, mossa o effetto in più, e chi altro è presente non agisce.';
  }

  /* ------------------------------------------------------------ piano */
  /* Continuità del movimento: solo asserzioni del motore nella scena e nelle riserve
     degli eventi già risolti. Mai messaggi del giocatore, opinioni, dialoghi o prosa IA.
     Riconoscimento conservativo: soggetto con articolo e predicato esplicito; non è
     una verifica semantica generale. Un evento successivo del motore prevale. */
  function continuitaEvento(state, content, ev) {
    const sc = E().sceneOf(content, ev.scena) || {};
    const testi = [E().descrizioneScena(state, sc)].concat((state.eventi || [])
      .filter(e => e.scena === ev.scena && e.n <= ev.n).map(e => e.riserva || ''));
    const dati = new Map();
    // si confronta il testo normalizzato; al Narratore va la frase com'è scritta («Errir», non «errir»): stessa lunghezza, stessi indici
    testi.forEach(t => { const o = String(t || '').normalize('NFC').replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' '), orig = o.split(/[.;!?\n]/); norm(o).split(/[.;!?\n]/).forEach((f, i) => {
      const fo = orig[i] && orig[i].length === f.length && norm(orig[i]) === f ? orig[i] : f;
      if (/\b(forse|sembra|potrebbe|pensa|crede|dice|per lui|per lei)\b/.test(f)) return;
      const re = /(?:^\s*|[,;:]\s*|\s+e\s+)(?:il|lo|la|i|gli|le|uno|una|un)\s+([a-z]{4,})\b([^.;!?]{0,55}?)\s+(arriva|arrivano|avanza|avanzano|vola|volano|corre|corrono|cammina|camminano|si muove|si muovono|si divide|si dividono|si separa|si separano|e immobile|sono immobili|resta immobile|restano immobili|si ferma|si fermano)\b/g;
      let m;
      while ((m = re.exec(f))) {
        if (/\b(non|mai|nessun|senza)\b/.test(m[2])) continue;
        const fermo = /immobil|ferm/.test(m[3]);
        dati.set(m[1], { soggetto: m[1], movimento: !fermo, divisione: !fermo && /si (divide|dividono|separa|separano)\b/.test(m[3] + f.slice(re.lastIndex)), testo: fo.slice(m.index, re.lastIndex).replace(/^[,;:]\s*|^\s+e\s+/i, '').trim() + fo.slice(re.lastIndex).trimEnd() });
      }
    }); });
    return Array.from(dati.values()).filter(x => x.movimento);
  }

  function pianifica(state, content, ev, cmd) {
    const m = M().ensure(state, content);
    // l'umore proposto dal Narratore vale fino alla fine della scena in cui è nato
    Object.values(m.png || {}).forEach(p => { if (p.umore && p.umoreScena !== state.scena) { p.umore = null; delete p.umoreScena; } });
    const piano = { v: VERSIONE, turno: ev.n, esito: null, battute: [], chiusura: null, vincoli: VINCOLI.slice(), costo: null, iniziativa: null };
    piano.continuita = continuitaEvento(state, content, ev);
    const esito = ev.esito && ev.tipo !== 'combattimento' ? (/^successo/.test(ev.esito) || (global.RMSoloRules && global.RMSoloRules.isSuccess(ev.esito)) ? 'successo' : ev.esito === 'parziale' ? 'parziale' : 'fallimento') : null;
    piano.esito = esito;
    piano.esitoCritico = /_critico$/.test(ev.esito || '') && ev.tipo !== 'combattimento' ? ev.esito : null;
    const dichiarata = ev.resoconto && ev.resoconto.azioneDichiarata;

    // 1. ciò che il giocatore ha tentato e ciò che il motore ha deciso
    if (dichiarata && ['combattimento', 'prosegui', 'scelta_incontro'].indexOf(ev.tipo) === -1) beat(piano, 'azione', { guida: String(dichiarata), prosa: '', fonte: 'motore', maxFrasi: 1 });
    const esitoTesto = testoEsito(state, content, ev);
    // il testo d'autore non si accorcia: il massimo di frasi segue la sua lunghezza
    const frasiEsito = esitoTesto.split(/(?<=[.!?…])\s+(?=[«"A-ZÀ-Ú0-9])/).filter(x => x.trim()).length;
    const bEsito = beat(piano, ev.tipo === 'oracolo' ? 'oracolo' : ev.tipo === 'prosegui' ? 'ambiente' : 'esito', { guida: esitoTesto || 'Racconta ciò che è accaduto, senza aggiungere altro.', prosa: esitoTesto, fonte: 'motore', maxFrasi: Math.max(3, frasiEsito) });
    if (esito) bEsito.esito = esito;
    // battuta senza testo d'autore (frase comune del motore): al Narratore il dato (chi, comportamento deciso dal motore, limiti),
    // non la frase da ricopiare; la frase comune resta la prosa di riserva
    // scambio di colpi senza testo d'autore: al Narratore i dati del motore (arma, attacco, difese tentate, chi è l'avversario), non la
    // frase comune del riepilogo, che resta la prosa di riserva (decisione dell'autore del 5/11/2026 su E09-E10: niente fasce di punti vita)
    const datiScontro = ev.tipo === 'combattimento' && guidaCombattimento(state, content, ev);
    if (datiScontro) { bEsito.guida = datiScontro; bEsito.maxFrasi = 3; }
    if (ev.rispostaComune && ev.png && content.png[ev.png] && bEsito.tipo === 'esito') {
      bEsito.guida = guidaRispostaComune(content, ev);
      bEsito.daDati = true;
      bEsito.png = ev.png;
      bEsito.maxFrasi = 2;
    }

    aggiornaRitmo(state, content, ev, esito);
    // il racconto continua solo se la scena non è cambiata e non c'è uno scontro
    const libero = eventoPianificabile(state, ev);

    // 2. costo concreto del successo parziale
    // anche se la scena cambia nello stesso turno: il costo vale per ogni parziale fuori dagli scontri
    if (esito === 'parziale' && !state.incontro && state.stato === 'attivo') applicaCosto(state, content, ev, piano);

    // 3. imprevisto già deciso dal motore
    if (ev.imprevisto) beat(piano, 'imprevisto', { guida: ev.imprevisto.testo, prosa: punto(ev.imprevisto.testo), fonte: 'motore', maxFrasi: 1 });

    // 4. fronti, scadenze dei costi e iniziativa dei PNG (al massimo due extra per turno)
    let extra = 0;
    if (libero) {
      if (extra < 2 && fronteBeat(state, content, ev, piano)) extra++;
      if (extra < 2 && iniziativaBeat(state, content, ev, piano)) extra++;
      if (extra < 2 && scadenzaBeat(state, content, ev, piano)) extra++;
      if (extra < 2 && chiudiFiloVecchioBeat(state, content, ev, piano)) extra++;
      if (extra < 2 && ritmoBeat(state, content, ev, piano)) extra++;
    } else if (!state.incontro) fronteSilenzioso(state);

    // 3b. un fatto registrato che il racconto non ha ancora comunicato: lo riporta il PNG che lo ha detto, o la chiusura della scena
    consegnaBeat(state, content, ev, piano);

    // 4b. il giocatore gira a vuoto: un PNG prende l'iniziativa e indica la direzione (testo d'autore della scena)
    if (ev.spinta && ev.spinta.testo) beat(piano, 'iniziativa_png', { png: ev.spinta.png || undefined, guida: ev.spinta.testo, prosa: ev.spinta.testo, fonte: 'regista', maxFrasi: 3 });

    // 4c. come un Narratore: chi è presente reagisce all'esito, e il luogo si fa sentire con un dettaglio (dai dati della scena)
    if (libero && esito && !piano.iniziativa) reazioneBeat(state, content, ev, piano, esitoTesto);
    if (libero) dettaglioBeat(state, content, ev, piano);

    // 5. si chiude su una situazione, mai su un'azione del protagonista
    if (!state.incontro && ev.tipo !== 'combattimento' && state.stato === 'attivo') {
      const c = chiusura(state, content, ev, piano);
      // la stessa chiusura al massimo una volta per scena
      const usate = m.chiusure = m.chiusure || {}, k = state.scena + '|' + (c && c.testo);
      if (c && !usate[k]) { usate[k] = 1; piano.chiusura = c; beat(piano, 'chiusura', { guida: c.testo, prosa: c.testo, fonte: 'regista', maxFrasi: 1, png: c.png || undefined }); }
    }
    // al più TETTO_BATTUTE battute: si scartano le ultime opzionali
    ['dettaglio', 'reazione', 'ambiente', 'fronte', 'azione'].forEach(tipo => {
      const i = piano.battute.map(b => b.tipo).lastIndexOf(tipo);
      if (piano.battute.length > TETTO_BATTUTE && i !== -1) piano.battute.splice(i, 1);
    });
    contieniFrasi(piano);
    piano.battute.forEach((b, i) => { b.id = 'b' + (i + 1); });
    autorizza(state, content, ev, cmd, piano);
    return piano;
  }

  /* Autorizzazioni preventive: che cosa il Narratore può registrare in questo turno. I PNG coinvolti (bersaglio dell'azione,
     interlocutore del dialogo, PNG delle battute del piano, solo se presenti) e, per ciascuno, l'umore fino alla fine della
     scena. Nient'altro: fatti, fili e conseguenze persistenti li registrano il motore e il Regista. */
  function autorizza(state, content, ev, cmd, piano) {
    const pres = presenti(state, content);
    const dialogo = state.interazione && state.interazione.scena === state.scena ? state.interazione.dialogo : null;
    piano.coinvolti = [ev.png, cmd && cmd.png, dialogo].concat(piano.battute.map(b => b.png))
      .filter((id, i, a) => id && a.indexOf(id) === i && pres.indexOf(id) !== -1);
    piano.permessi = piano.coinvolti.map(id => ({ op: 'png_umore', soggetto: id, valori: M().UMORI.slice(), durata: 'scena', da: (piano.battute.find(b => b.png === id) || { id: 'azione' }).id }));
  }

  /* Un turno si racconta in 2–4 frasi in tutto (velocità e ritmo): si accorciano prima le battute più lunghe, poi si tolgono le facoltative in coda.
     L'azione dichiarata non conta (al narratore addestrato non si manda); l'esito d'autore non si accorcia mai. */
  const TETTO_FRASI = 4;
  function contieniFrasi(piano) {
    const scritte = () => piano.battute.filter(b => b.tipo !== 'azione');
    const totale = () => scritte().reduce((n, b) => n + b.maxFrasi, 0);
    while (totale() > TETTO_FRASI) {
      const lunga = scritte().filter(b => b.maxFrasi > 1 && b.tipo !== 'esito' && b.tipo !== 'oracolo' && b.tipo !== 'notizia').sort((a, b) => b.maxFrasi - a.maxFrasi)[0];
      if (lunga) { lunga.maxFrasi--; continue; }
      const facoltative = scritte().filter(b => b.obbligatoria === false);
      if (!facoltative.length) break;
      piano.battute.splice(piano.battute.indexOf(facoltative[facoltative.length - 1]), 1);
    }
  }

  /* ------------------------------------------------------------ fatti da comunicare (contratto §3.5, D3 approvata il 6/11/2026)
     Un fatto registrato dal motore ma non arrivato al giocatore torna con il suo testo canonico (solo le unità mancanti):
     1. quando il giocatore si rivolge di nuovo al PNG che lo ha detto (evento di dialogo con lui);
     2. se la scena si chiude prima, nella chiusura (ultima rete).
     È una battuta del racconto: il punto, il tiro e la ricompensa dell'evento originale non si ripetono. Un fatto per turno. */
  function consegnaBeat(state, content, ev, piano) {
    const CM = global.RMSoloComunicati;
    if (!CM || !state.fattiComunicati) return null;
    const nuovi = (ev.effetti || []).filter(a => a.tipo === 'scoperta').map(a => a.fatto);
    const pendenti = CM.daComunicare(state, content).filter(x => x.unita.length && x.evento && x.evento < ev.n && nuovi.indexOf(x.id) === -1);
    if (!pendenti.length) return null;
    // chi ha il fatto: il PNG del dialogo che lo ha registrato; altrimenti il PNG nominato nelle unità mancanti, poi nel fatto; poi chi lo sa (png.sa)
    const nomeDi = id => String(content.png[id].nome).replace(/\s*\([^)]*\)/g, '').trim().split(/[ -]/)[0];
    const nominato = (testo, id) => nomeDi(id).length >= 3 && new RegExp('(^|[^A-Za-zÀ-ú])' + nomeDi(id) + '([^A-Za-zÀ-ú]|$)').test(testo);
    const custode = x => x.png || Object.keys(content.png || {}).find(id => nominato(x.unita.map(u => u.testo).join(' '), id))
      || Object.keys(content.png || {}).find(id => nominato(((content.fatti || {})[x.id] || {}).testo || '', id))
      || Object.keys(content.png || {}).find(id => (content.png[id].sa || []).indexOf(x.id) !== -1) || null;
    const presenti = E().presentiEffettivi(state, content, ev.scena);
    let scelto = null, png = null;
    if (ev.png && (ev.tipo === 'dialogo' || ev.tipo === 'battuta') && presenti.indexOf(ev.png) !== -1) {
      scelto = pendenti.find(x => custode(x) === ev.png);
      if (scelto) png = ev.png;
    }
    // alla chiusura: solo un fatto che non fa agire nella scena d'arrivo un PNG che lì non c'è (resta al PNG che lo ha detto)
    const arrivo = E().presentiEffettivi(state, content, state.scena);
    const nominaAssente = x => Object.keys(content.png || {}).some(id => arrivo.indexOf(id) === -1 && nominato(x.unita.map(u => u.testo).join(' '), id));
    if (!scelto && state.scena !== ev.scena) scelto = pendenti.find(x => x.scena === ev.scena && !nominaAssente(x));
    if (!scelto) return null;
    const prosa = scelto.unita.map(u => u.testo.replace(/[.;]\s*$/, '')).join('; ') + '.';
    const frasi = prosa.split(/(?<=[.!?…])\s+(?=[«"A-ZÀ-Ú0-9])/).filter(x => x.trim()).length;
    const b = beat(piano, 'notizia', { guida: prosa, prosa, fonte: 'motore', maxFrasi: Math.max(1, frasi), png: png || undefined, fatti: [scelto.id] });
    // alla chiusura della scena il fatto della scena lasciata viene prima del racconto della scena nuova
    if (!png) { piano.battute.splice(piano.battute.indexOf(b), 1); const i = piano.battute.findIndex(x => x.tipo !== 'azione'); piano.battute.splice(i === -1 ? piano.battute.length : i, 0, b); }
    ev.consegna = [scelto.id];
    return b;
  }

  /* ------------------------------------------------------------ costo del parziale */
  function applicaCosto(state, content, ev, piano) {
    const m = state.mondo;
    const pres = presenti(state, content);
    const sc = sceneOf(state, content);
    const minacce = frontiAttivi(state, 'minaccia');
    const disp = [];
    if (pres.length) disp.push('sguardo');
    if (pres.some(id => atteggiamento(state, id) >= 0)) disp.push('debito');
    if (minacce.length) disp.push('tempo');
    disp.push('traccia');
    const tipo = disp[hash(state, 'costo' + ev.n, disp.length)];
    const v = { L: String(sc.luogo || 'questo luogo'), N: '', F: '' };
    let legatoA = 'scena:' + state.scena, png = null;
    if (tipo === 'sguardo') {
      const sospettosi = pres.filter(id => atteggiamento(state, id) <= 0);
      const lista = sospettosi.length ? sospettosi : pres;
      png = lista[hash(state, 'sg' + ev.n, lista.length)];
      m.png[png].sospetto = Math.min(3, m.png[png].sospetto + 1);
      legatoA = 'png:' + png;
    } else if (tipo === 'debito') {
      const lista = pres.filter(id => atteggiamento(state, id) >= 0);
      png = lista[hash(state, 'db' + ev.n, lista.length)];
      m.png[png].debito = Math.min(3, m.png[png].debito + 1);
      legatoA = 'png:' + png;
    } else if (tipo === 'tempo') {
      const f = minacce[hash(state, 'tm' + ev.n, minacce.length)];
      v.F = f.nome; legatoA = 'orologio:' + f.orologio;
    }
    if (png) v.N = nomePng(content, png);
    const def = COSTI_TESTI[tipo];
    const filo = M().apriFilo(state, { titolo: riempi(def.filo, v), tipo: 'costo', legatoA });
    if (filo) filo.costo = tipo;
    const prosa = riempi(scegliVariante(state, 'cp' + ev.n, def.prosa), v);
    const b = beat(piano, 'costo', { guida: riempi(def.guida, v), prosa, fonte: 'regista', maxFrasi: 1, png: png || undefined });
    b.costo = tipo;
    piano.costo = { tipo, png, filo: filo ? filo.id : null };
  }

  /* ------------------------------------------------------------ fronti */
  function fronteBeat(state, content, ev, piano) {
    const m = state.mondo;
    let fatto = false;
    frontiAttivi(state).forEach(f => {
      if (f.pressione > f.ultimaSoglia && !fatto) {
        fatto = true;
        const testo = riempi(FRONTE_TESTI[f.polarita][Math.min(3, Math.max(1, f.pressione))], { F: f.nome });
        beat(piano, 'fronte', { guida: testo, prosa: testo, fonte: 'regista', maxFrasi: 1 });
        f.ultimaSoglia = f.pressione;
      } else if (f.pressione !== f.ultimaSoglia && f.pressione < f.ultimaSoglia) f.ultimaSoglia = f.pressione;
    });
    return fatto;
  }
  function fronteSilenzioso(state) { (state.mondo.fronti || []).forEach(f => { if (f.pressione < f.ultimaSoglia) f.ultimaSoglia = f.pressione; }); }

  /* ------------------------------------------------------------ ritmo (dalle giocate dell'autore) */
  /* PROPOSTA DA APPROVARE. Il ritmo viene da <storia>-imprevisti.json › regia.ritmo (aggregati calcolati da
     training/scripts/distilla_regia.py sulle giocate e sugli script dell'autore): le serie di tensione sono brevi
     (media ~1,5 segmenti) e quasi sempre seguite da un momento di respiro o di dialogo. Dopo più turni di tensione di
     fila del normale (media arrotondata per eccesso + 1) il regista aggiunge una battuta di respiro, una volta per serie.
     Tensione = scena non calma, esito non pieno, oppure un fronte di minaccia alto; al più un respiro ogni 6 turni. Scrive solo state.mondo.ritmo. Senza dati: nulla. */
  const RESPIRI = [
    'Per un momento tutto tace e il ritmo rallenta.',
    'Il rumore si allontana e lascia un silenzio teso, ma fermo.',
    'Passa un istante in cui nulla accade.',
    'La tensione cala di un poco, come dopo un colpo parato.',
    'Un silenzio lungo attraversa il luogo, poi di nuovo l\'attesa.'
  ];
  const regiaRitmo = content => (content && content.imprevisti && content.imprevisti.regia && content.imprevisti.regia.ritmo) || null;
  function sogliaTensione(content) {
    const r = regiaRitmo(content);
    return r && r.serieTensione && r.serieTensione.media > 0 ? Math.ceil(r.serieTensione.media) + 1 : 0;
  }
  function aggiornaRitmo(state, content, ev, esito) {
    const m = state.mondo;
    const r = m.ritmo = m.ritmo || { serie: 0, ultimoRespiro: 0 };
    if (!sogliaTensione(content) || state.incontro) return;
    const fr = frontiAttivi(state, 'minaccia').sort((a, b) => b.pressione - a.pressione)[0];
    const tesa = sceneOf(state, content).calma === false || (esito && esito !== 'successo') || (fr && fr.pressione >= 2);
    if (tesa) r.serie++; else r.serie = 0;
  }
  function ritmoBeat(state, content, ev, piano) {
    const soglia = sogliaTensione(content), r = state.mondo.ritmo;
    if (!soglia || !r || r.serie < soglia || ev.n - r.ultimoRespiro < 6) return false;
    r.serie = 0; r.ultimoRespiro = ev.n;
    const prosa = scegliVariante(state, 'rt' + ev.n, RESPIRI);
    beat(piano, 'ambiente', { guida: 'Respiro del ritmo (la tensione dura da troppi turni): ' + prosa, prosa, fonte: 'regista', maxFrasi: 1, obbligatoria: false });
    return true;
  }

  /* ------------------------------------------------------------ iniziativa dei PNG */
  function iniziativaBeat(state, content, ev, piano) {
    const m = state.mondo;
    const since = ev.n - m.ultimaIniziativa;
    const pres = presenti(state, content);
    if (!pres.length) return false;
    if (since < CADENZA) return false;
    // chi ha già risposto in questo turno non prende anche l'iniziativa
    const escludi = ev.tipo === 'battuta' && state.interazione && state.interazione.dialogo ? [state.interazione.dialogo] : [];
    const id = scegliPng(state, content, ev, escludi);
    if (!id) return false;
    const mossa = scegliMossa(state, content, id);
    const n = m.png[id];
    const scopo = scopoDi(state, content, id);
    const fr = frontiAttivi(state, 'minaccia').sort((a, b) => b.pressione - a.pressione)[0];
    const def = MOSSE_TESTI[mossa];
    const v = { N: nomePng(content, id), S: scopo || '', F: fr ? fr.nome : '' };
    // «avverte» cita il fronte: senza fronte usa la variante senza
    // voce d'autore del PNG (contenuto della trama: png.<id>.iniziative.<mossa>), altrimenti le frasi comuni
    const d = ((content.png || {})[id] || {}).iniziative;
    const voci = d && d[mossa] ? E().testiInFinestra(state, d[mossa]) : [];
    const propria = voci.length ? voci : null;
    // l'iniziativa viene dal contenuto (voce del PNG) o dal fronte della trama; senza materiale pertinente nessuna iniziativa
    const lista = propria || (mossa === 'avverte' && fr ? def.con : null);
    if (!lista) return false;
    const prosa = riempi(scegliVariante(state, 'mv' + ev.n, lista), v);
    const b = beat(piano, 'iniziativa_png', { png: id, guida: v.N + ' ' + def.guida + '.', prosa, fonte: 'regista', maxFrasi: 2 });
    b.mossa = mossa;
    piano.iniziativa = { png: id, mossa };
    n.ultimoTurnoAttivo = ev.n; n.mossaRecente = mossa; m.ultimaIniziativa = ev.n;
    // la mossa salda il conto che l'ha provocata
    if (mossa === 'confronta') { n.sospetto = Math.max(0, n.sospetto - 2); chiudiFiliCosto(state, 'png:' + id, 'sguardo', v.N + ' ha chiesto conto'); }
    if (mossa === 'riscuote') { n.debito = Math.max(0, n.debito - 1); chiudiFiliCosto(state, 'png:' + id, 'debito', v.N + ' ha riscosso'); }
    return true;
  }
  function chiudiFiliCosto(state, legatoA, costo, chiusura) {
    state.mondo.fili.filter(f => f.stato === 'aperto' && f.tipo === 'costo' && f.legatoA === legatoA && f.costo === costo).forEach(f => M().chiudiFilo(state, f.id, chiusura));
  }

  /* ------------------------------------------------------------ scadenze e fili vecchi */
  function scadenzaBeat(state, content, ev, piano) {
    const m = state.mondo;
    const f = m.fili.find(x => x.stato === 'aperto' && x.tipo === 'costo' && ETA_COSTO[x.costo] && ev.n - x.aperto >= ETA_COSTO[x.costo]);
    if (!f) return false;
    const def = SCADENZE_TESTI[f.costo];
    const fr = f.costo === 'tempo' ? (m.fronti.find(z => 'orologio:' + z.orologio === f.legatoA) || { nome: 'la scadenza' }) : null;
    const prosa = riempi(def.prosa[0], { F: fr ? fr.nome : '' });
    beat(piano, f.costo === 'tempo' ? 'fronte' : 'ambiente', { guida: def.guida, prosa, fonte: 'regista', maxFrasi: 1 });
    M().chiudiFilo(state, f.id, def.guida);
    return true;
  }
  /* Un filo di contorno (imprevisti) o un costo inevaso, vecchio di ETA_FILO turni, si chiude con una battuta. */
  function chiudiFiloVecchioBeat(state, content, ev, piano) {
    const m = state.mondo;
    const f = m.fili.find(x => x.stato === 'aperto' && ['png', 'fronte', 'costo'].indexOf(x.tipo) !== -1 && ev.n - x.aperto >= ETA_FILO);
    if (!f) return false;
    const idPng = /^png:/.test(f.legatoA || '') ? f.legatoA.slice(4) : null;
    const nome = idPng && content.png[idPng] ? nomePng(content, idPng) : 'qualcuno';
    // un costo di sguardo o debito inevaso: il PNG smette di pesarlo
    if (f.tipo === 'costo' && idPng && m.png[idPng]) { if (f.costo === 'sguardo') m.png[idPng].sospetto = Math.max(0, m.png[idPng].sospetto - 1); if (f.costo === 'debito') m.png[idPng].debito = Math.max(0, m.png[idPng].debito - 1); }
    const prosa = riempi(CHIUSURA_FILO[f.tipo] || CHIUSURA_FILO.fronte, { N: nome });
    beat(piano, 'ambiente', { guida: 'Chiusura del filo «' + f.titolo + '»: ' + prosa, prosa, fonte: 'regista', maxFrasi: 1, obbligatoria: false });
    M().chiudiFilo(state, f.id, prosa);
    return true;
  }

  /* ------------------------------------------------------------ chiusura del turno */
  /* Si chiude su una situazione concreta, mai su una formula («resta in attesa», «resta da risolvere»: l'obiettivo sta nel Diario).
     Dopo l'iniziativa di un PNG o dentro un dialogo l'ultima parola è già sua: niente chiusura. Altrimenti un fronte che incombe, o un
     presente con quello che sta facendo (dati di ingresso della scena), mai già letto. Senza materiale, nessuna chiusura. */
  function chiusura(state, content, ev, piano) {
    // dopo un cambio di scena parla l'apertura della scena nuova
    if (piano.iniziativa || (state.interazione && state.interazione.dialogo) || ev.scena !== state.scena) return null;
    const fr = frontiAttivi(state, 'minaccia').sort((a, b) => b.pressione - a.pressione)[0];
    if (fr && fr.pressione >= 2) return { tipo: 'situazione', testo: '«' + fr.nome + '» incombe su tutto il resto.' };
    const pres = presenti(state, content);
    const letto = lettoConPiano(state, content, piano);
    const k = pres.length ? hash(state, 'cl' + ev.n, pres.length) : 0;
    for (let i = 0; i < pres.length; i++) {
      const id = pres[(k + i) % pres.length];
      if (id === ev.png) continue;
      const t = E().situazionePng && E().situazionePng(state, content, id, { letto });
      if (t) return { tipo: 'situazione', testo: t, png: id };
    }
    return null;
  }

  /* Testi già letti dal giocatore più la prosa del piano in costruzione (normalizzati come in RMSoloEngine.giaLetto). */
  const normT = t => norm(t).replace(/[^a-z0-9]+/g, ' ').trim();
  function lettoConPiano(state, content, piano) {
    return (E().giaLetto ? E().giaLetto(state, content) : ' ') + piano.battute.map(b => normT(b.prosa)).join(' ') + ' ';
  }

  /* PROPOSTA DA APPROVARE. Reazione di un presente all'esito di un'azione: gesto e sguardo, senza pronomi (il genere dei PNG non è dato)
     e senza decidere nulla per il protagonista. Voce d'autore se il contenuto la dà (png.<id>.reazioni.successo|fallimento). */
  const REAZIONI = {
    successo: ['{N} segue i tuoi gesti in silenzio, poi annuisce appena.', '{N} solleva lo sguardo e ti osserva con un\'attenzione nuova.', '{N} si lascia sfuggire un mezzo sorriso.',
      '{N} rilascia il fiato che stava trattenendo.', 'Le spalle di {N} si sciolgono un poco.', '{N} fa un cenno breve, di approvazione.', '{N} smette di fare quello che stava facendo e ti guarda.',
      'Sul viso di {N} passa qualcosa di simile al sollievo.', '{N} si avvicina di un passo.', '{N} ti rivolge un\'occhiata che prima non c\'era.', 'Per un momento, {N} sembra meno teso.', '{N} si passa una mano sul viso, più tranquillo.'],
    fallimento: ['{N} si irrigidisce e distoglie lo sguardo.', 'Alle tue spalle, {N} sospira piano.', '{N} stringe le labbra e resta dov\'è.', '{N} fa un mezzo passo indietro.',
      '{N} aggrotta la fronte.', 'Le mani di {N} si chiudono a pugno, poi si riaprono.', '{N} scambia un\'occhiata con il pavimento.', '{N} trattiene il fiato.',
      'Il sorriso di {N}, se c\'era, si spegne.', '{N} incrocia le braccia.', '{N} si volta di tre quarti, come per non guardare.', 'Sul viso di {N} passa un\'ombra.']
  };
  // atti che si vedono e si sentono: chi ha un legame col protagonista può reagire anche se non ne è il bersaglio
  const ATTI_VISIBILI = ['curare', 'forzare', 'intimidire', 'convincere', 'riparare', 'manipolare'];
  const DI_NASCOSTO = /\b(di nascosto|senza farmi (notare|vedere|sentire)|senza che (nessuno|lui|lei|loro) (se ne accorga|mi veda|mi senta)|di soppiatto|furtiv|con la coda dell.occhio|non vist)/i;
  /* Reazione motivata: reagisce solo chi è coinvolto (il bersaglio, se l'esito non lo nomina già) o, per un atto che si vede, chi ha un
     legame col protagonista (atteggiamento diverso da zero, sospetto o debito nel mondo). Un'azione fatta di nascosto non la vede nessuno.
     Prima la voce d'autore del PNG (png.<id>.reazioni.successo|fallimento), poi le frasi generiche; nessuna torna nella stessa partita
     finché il repertorio non è esaurito. */
  function reazioneBeat(state, content, ev, piano, esitoTesto) {
    const pres = presenti(state, content);
    if (!pres.length || !ev.check || ev.atto === 'nascondersi' || DI_NASCOSTO.test(String(ev.testo || ''))) return false;
    const cita = id => norm(esitoTesto).indexOf(norm(nomePng(content, id)).split(' ')[0]) !== -1;
    const legato = id => atteggiamento(state, id) !== 0 || ((state.mondo.png || {})[id] && (state.mondo.png[id].sospetto > 0 || state.mondo.png[id].debito > 0));
    const cand = ev.png && pres.indexOf(ev.png) !== -1 ? [ev.png]
      : ATTI_VISIBILI.indexOf(ev.atto) !== -1 ? pres.filter(id => legato(id)) : [];
    const id = cand.filter(x => !cita(x))[0];
    if (!id) return false;
    const chiave = /^successo/.test(piano.esito) ? 'successo' : 'fallimento';
    // la riga d'autore si sceglie in base ai fatti (legge 3: voci { testo, richiede, prima_di } dentro la loro finestra)
    const propria = !ev.primaDelMomento && E().testiInFinestra(state, (((content.png || {})[id] || {}).reazioni || {})[chiave]);
    const lista = propria && propria.length ? propria : REAZIONI[chiave];
    const letto = lettoConPiano(state, content, piano);
    let prosa = null;
    for (let k = 0; k < lista.length && !prosa; k++) {
      const x = riempi(E().generica(state, propria && propria.length ? 'reazione:' + id + ':' + chiave : 'reazione:' + chiave, lista, ev.n + k), { N: nomePng(content, id) });
      if (letto.indexOf(normT(x)) === -1) prosa = x;
    }
    if (!prosa) return false;
    beat(piano, 'reazione', { png: id, guida: prosa, prosa, fonte: 'regista', maxFrasi: 1, obbligatoria: false });
    return true;
  }
  /* Un dettaglio sensoriale del luogo (dettagli percepibili notati, frasi d'ambiente della scena), mai già letto e al più uno per turno. */
  function dettaglioBeat(state, content, ev, piano) {
    if (!E().dettaglioLuogo || piano.battute.some(b => b.tipo === 'ambiente')) return false;
    const prosa = E().dettaglioLuogo(state, content, { letto: lettoConPiano(state, content, piano), contesto: piano.battute.map(b => b.prosa).filter(Boolean).join(' ') });
    if (!prosa) return false;
    beat(piano, 'dettaglio', { guida: prosa, prosa, fonte: 'regista', maxFrasi: 1, obbligatoria: false });
    return true;
  }

  /* ------------------------------------------------------------ riserva: prosa dal piano */
  /* Il testo di riserva (senza modello): le battute nell'ordine, esito e costo nello stesso paragrafo.
     testi (facoltativo): { idBattuta: testo } sostituisce la prosa di riserva delle battute scritte dal narratore. */
  function proseDaPiano(piano, testi) {
    const par = [];
    let corrente = [], ultimo = null;
    const vuota = () => { if (corrente.length) { par.push(corrente.join(' ')); corrente = []; } };
    const viste = new Set();
    piano.battute.forEach(b => {
      const t = testi && testi[b.id] ? testi[b.id] : b.prosa;
      // la stessa frase due volte nel piano (es. una reazione registrata due volte in uno scontro di gruppo) si legge una volta sola
      if (!t || viste.has(t)) return;
      viste.add(t);
      if (b.tipo === 'azione' || b.tipo === 'esito' || b.tipo === 'oracolo' || b.tipo === 'costo' || b.tipo === 'reazione') corrente.push(t);
      else if (b.tipo === 'chiusura' && ultimo === 'dettaglio') par[par.length - 1] += ' ' + t;
      else { vuota(); par.push(t); }
      ultimo = b.tipo;
    });
    vuota();
    return par.join('\n\n');
  }

  global.RMSoloPiano = {
    VERSIONE, CADENZA, ETA_FILO, ETA_COSTO, MOSSE, COSTI, VINCOLI, MOSSE_TESTI, COSTI_TESTI, TETTO_BATTUTE, TETTO_FRASI,
    pianifica, continuitaEvento, contieniFrasi, proseDaPiano, scopoDi, sogliaTensione, RESPIRI, REAZIONI, ATTI_VISIBILI, DI_NASCOSTO, misteriAperti
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloPiano;
})(typeof window !== 'undefined' ? window : globalThis);
