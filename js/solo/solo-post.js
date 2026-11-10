/* ==========================================================================
   Role Makers — Gioca in solitaria: post-processo del turno (motore V2, modulo 4).

   Dopo che il narratore ha scritto le battute del piano, il post-processo:
   1. controlla ogni battuta contro il piano: togli le frasi che decidono,
      pensano, sentono o fanno dire qualcosa al protagonista; le frasi con
      numeri di gioco, segreti o lessico ancora bloccato; i PNG assenti che
      agiscono; accorcia al massimo di frasi del piano;
   2. verifica che le battute obbligatorie ci siano ancora e che restino fedeli
      al piano (un PNG di un'iniziativa deve comparire per nome, l'esito deve
      conservare le parole del contenuto): altrimenti usa la prosa di riserva
      di quella battuta;
   3. valida gli aggiornamenti proposti (lista bianca, tipi, massimo 8 per
      turno, mai punti ferita, oggetti, esiti o stati) e applica solo quelli
      validi a state.mondo.

   Non cambia mai lo stato di gioco: scrive solo state.mondo. Il testo
   d'autore (battute di fonte «motore») non viene riscritto: la riserva di
   una battuta del motore è il testo d'autore stesso.
   ========================================================================== */
(function (global) {
  'use strict';

  const M = () => global.RMSoloMondo;
  const E = () => global.RMSoloEngine;
  const F = () => global.RMSoloFeedback;
  const PI = () => global.RMSoloPiano;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* Verbi alla seconda persona (il «tu» è il protagonista) che equivalgono a decidere, pensare, parlare o agire
     al suo posto. Elenco scritto per questo progetto. Le percezioni (vedi, senti un rumore, noti) restano ammesse. */
  const VERBI = [
    // volontà e pensiero
    'decidi', 'scegli', 'pensi', 'ricordi', 'speri', 'temi', 'dubiti', 'credi', 'capisci', 'realizzi', 'vuoi', 'desideri',
    'ti fidi', 'ti convinci', 'ti rendi conto', 'ti rassegni', 'ti arrendi', 'cedi', 'accetti', 'rifiuti', 'esiti',
    // emozioni imposte
    'ti senti', 'provi', 'hai paura', 'hai voglia', 'sei furioso', 'sei furiosa', 'sei sollevato', 'sei sollevata', 'ti commuovi', 'ti vergogni',
    // parole
    'dici', 'rispondi', 'chiedi', 'sussurri', 'urli', 'gridi', 'ordini', 'prometti', 'giuri', 'ammetti', 'confessi', 'mormori', 'spieghi',
    // gesti e azioni nuove
    'ti alzi', 'ti siedi', 'ti volti', 'ti giri', 'ti allontani', 'ti avvicini', 'ti nascondi', 'ti inginocchi', 'corri', 'scappi', 'afferri', 'impugni', 'estrai', 'sguaini',
    'apri', 'chiudi', 'prendi', 'raccogli', 'lasci', 'consegni', 'colpisci', 'spingi', 'entri', 'esci', 'vai', 'cammini', 'annuisci', 'sorridi', 'ridi', 'piangi', 'sospiri', 'stringi', 'abbracci', 'baci'
  ];
  const PARTICIPI = /\b(hai (deciso|scelto|pensato|capito|detto|risposto|chiesto|promesso|accettato|rifiutato)|ti sei (alzat[oa]|sedut[oa]|voltat[oa]|girat[oa]|allontanat[oa]|avvicinat[oa]|nascost[oa]|convint[oa]|reso conto|fidat[oa]))\b/;
  /* Un gesto del protagonista detto con il suo corpo come soggetto: «la tua mano si chiude intorno al fiore», «le tue dita afferrano…»
     (registro del 5/11/2026, turno 5: il giocatore non aveva toccato il fiore). Vale come azione al suo posto, salvo che il verbo sia
     quello che il giocatore ha dichiarato. Sguardo e occhi no: sono percezioni. */
  const CORPO = /\b(?:la tua|le tue|il tuo|i tuoi)\s+(?:mano|mani|dita|dito|braccio|braccia|piede|piedi|gamba|gambe|pugno|pugni|corpo)\s+(?:(?:ti|si|le|lo|la|gli|ne)\s+)?(?!(?:sono|erano|sembrano|sembra|appaiono|restano|rimangono|hanno|tremano|fanno male)\b)([a-z]{4,})/;

  /* Quattro casi distinti nei controlli del testo (contratto, Fase 4 del 6/11/2026):
     - decisione volontaria del protagonista (VERBI, PARTICIPI): vietata, salvo che il giocatore l'abbia dichiarata;
     - gesto di presa sul mondo (CORPO, prendi/afferri/raccogli/stringi): vietato, salvo l'effetto autorizzato (l'oggetto che il motore
       ha appena dato in questo evento);
     - reazione involontaria del corpo (REAZIONI_INVOLONTARIE: ti trema la mano, rabbrividisci, il cuore ti batte): ammessa, non decide e non
       cambia il mondo; non è un dettaglio da ricordare (RMSoloMemoria);
     - modifica del mondo: la decide solo il motore (coerenza, filtraAggiornamenti). */
  const GESTI_DI_PRESA = /^(?:la tua|le tue|il tuo|i tuoi)\s|^(prendi|afferri|raccogli|stringi|impugni|estrai|sguaini)$/;
  const REAZIONI_INVOLONTARIE = /\b(ti trema|ti tremano|trem[ia] |rabbrividisci|sussulti|trasalisci|arrossisci|impallidisci|il cuore ti (batte|martella|accelera|sale)|ti manca il fiato|ti si (gela|stringe|chiude|mozza)|ti gira la testa|un brivido ti)\b/;
  const radiciPiene = t => Array.from(new Set(norm(t).split(/[^a-z]+/).filter(w => w.length >= 4).map(w => w.slice(0, 5))));
  const sentenze = t =>String(t || '').split(/(?<=[.!?…])\s+(?=[«"A-ZÀ-Ú0-9])/).map(x => x.trim()).filter(Boolean);
  const senzaCitazioni = t => String(t || '').replace(/«[^»]*»/g, ' ').replace(/"[^"]*"/g, ' ');

  /* Verbi che decidono per il protagonista in una frase; i verbi che ripetono ciò che il giocatore ha dichiarato non contano. */
  /* Il verbo (in qualunque persona) è quello che il giocatore ha dichiarato? Si confronta il tema: tolta la desinenza, il messaggio deve
     contenere una parola che comincia così. Vale anche per l'alternanza gl/lg dei verbi in -gliere («raccogli» / «raccolgo», «scegli» /
     «scelgo», «togli» / «tolgo»): registro del 5/11/2026, «Raccogli il fiore» scartato anche se il giocatore aveva scritto «raccolgo». */
  function verboDichiarato(forma, gia) {
    if (!gia) return false;
    const tema = String(forma).replace(/(ono|ano|iamo|ete|ite|ate|e|a|i|o)$/, '');
    if (tema.length < 3) return false;
    return [tema, tema.replace(/gl$/, 'lg'), tema.replace(/lg$/, 'gl')].some(x => new RegExp('(^|[^a-z])' + x).test(gia));
  }
  function decisioniAlPosto(frase, dichiarata) {
    const t = ' ' + norm(senzaCitazioni(frase)) + ' ';
    const gia = norm(dichiarata || '');
    const hit = [];
    VERBI.forEach(v => {
      const k = norm(v);
      // il verbo non è dentro una relativa («ciò che dici») né dopo «ti» di un altro verbo («ti prendi il tempo»)
      const ultima = k.split(' ').slice(-1)[0];
      const eco = !!gia && ultima.length >= 4 && (gia.indexOf(ultima.slice(0, Math.max(3, ultima.length - 2))) !== -1 || verboDichiarato(ultima, gia));
      if (new RegExp('[^a-z](?<!che\\s)(?<!ti\\s)' + k.replace(/ /g, '\\s+') + '(?![a-z])').test(t) && !eco) hit.push(v);
    });
    const p = PARTICIPI.exec(t);
    if (p) hit.push(p[1]);
    const c = CORPO.exec(t);
    if (c && !verboDichiarato(c[1], gia)) hit.push(c[0]);
    return hit;
  }

  /* PNG non presenti nella scena che compiono un'azione o parlano. */
  function pngAssentiAttivi(frase, content, presenti) {
    const t = norm(senzaCitazioni(frase));
    const out = [];
    const prima = id => norm(((content.png || {})[id] || {}).nome).replace(/\([^)]*\)/g, '').trim().split(/[ -]/)[0];
    // chi condivide il primo nome con un presente (Mira-47 e le sue due copie) non è assente: «Mira ti guarda» è il presente
    const nomiPresenti = new Set(presenti.map(prima));
    Object.entries(content.png || {}).forEach(([id, p]) => {
      if (presenti.indexOf(id) !== -1) return;
      const nome = norm(p.nome).replace(/\([^)]*\)/g, '').trim().split(' ')[0];
      if (nome.length < 4 || nomiPresenti.has(prima(id))) return;
      if (new RegExp('\\b' + nome + '\\b\\s+(ti|ha|dice|risponde|sorride|annuisce|entra|apre|si volta|arriva|esce|ride|grida|ti guarda)').test(t)) out.push(id);
    });
    return out;
  }

  /* Quanto della frase f è già nel testo d'autore g: 1 se la frase vi compare per intero; altrimenti la quota delle sue parole che vi compaiono,
     ma solo per frasi di almeno 5 parole (una frase breve inventata che riusa parole d'autore non è una copia). */
  function jaccard(f, g) {
    const nf = norm(f).replace(/[^a-z0-9]+/g, ' ').trim(), ng = norm(g).replace(/[^a-z0-9]+/g, ' ');
    if (!nf) return 0;
    if ((' ' + ng + ' ').indexOf(' ' + nf + ' ') !== -1) return 1;
    const A = nf.split(' ').filter(w => w.length > 2), B = new Set(ng.split(' ').filter(w => w.length > 2));
    if (A.length < 5) return 0;
    let n = 0; A.forEach(w => { if (B.has(w)) n++; });
    return n / A.length;
  }
  const parolePiene = t => Array.from(new Set(norm(t).split(/[^a-z]+/).filter(w => w.length >= 5)));
  const fedele = (testo, guida) => {
    const a = parolePiene(testo), b = parolePiene(guida);
    return !b.length || b.some(w => a.some(x => x.slice(0, 5) === w.slice(0, 5)));
  };

  /* Una frase che ripete ciò che il giocatore ha scritto (registro del 5/11/2026, turni 1 e 5: il 4B ricopia la domanda prima di rispondere,
     o al posto della risposta). È un'eco se la frase, di almeno tre parole, compare per intero nel messaggio del giocatore, oppure se ha
     almeno quattro parole e quasi tutte (80%) sono parole del messaggio (le forme del verbo cambiano: «le prendo» → «le prendi»). */
  const parole4 = t => norm(senzaVirgolette(t)).split(/[^a-z0-9]+/).filter(w => w.length >= 3).map(w => w.slice(0, 4));
  const senzaVirgolette = t => String(t || '').replace(/[«»"“”]/g, ' ');
  function eco(frase, dichiarata) {
    if (!dichiarata) return false;
    const f = norm(senzaVirgolette(frase)).replace(/[^a-z0-9]+/g, ' ').trim(), d = ' ' + norm(senzaVirgolette(dichiarata)).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    if (f.split(' ').length >= 3 && d.indexOf(' ' + f + ' ') !== -1) return true;
    const a = parole4(frase), b = new Set(parole4(dichiarata));
    return a.length >= 4 && a.filter(w => b.has(w)).length / a.length >= 0.8;
  }
  /* Quanto del testo d'autore obbligatorio resta in una battuta: la quota delle sue parole piene (radici di 5 lettere) presenti, escluse
     quelle che sono già nel messaggio del giocatore e i nomi dei PNG (ripetere la domanda o il nome non porta l'informazione). */
  function copertura(testo, prosa, dichiarata, content) {
    const r = t => Array.from(new Set(norm(t).split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 5))));
    const esclusi = new Set(r(dichiarata).concat(r(Object.values((content && content.png) || {}).map(p => p.nome).join(' '))));
    const voluti = r(prosa).filter(w => !esclusi.has(w)), presenti = new Set(r(testo));
    return voluti.length < 3 ? 1 : voluti.filter(w => presenti.has(w)).length / voluti.length;
  }
  /* I fatti indispensabili di un testo d'autore: le parole dei fatti che il motore ha appena registrato come scoperti (effetti «scoperta»)
     che compaiono anche nel testo d'autore, tolte quelle già nel messaggio del giocatore. Una risposta che copre metà del testo con
     parole generiche ma perde il fatto (chi convoca chi, chi è morto) non basta: deve conservarne almeno il 60%. Ritorna la quota (1 se
     l'evento non scopre niente di pertinente). */
  function fattiConservati(testo, prosa, ev, dichiarata) {
    const r = t => Array.from(new Set(norm(t).split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 5))));
    const nellaProsa = new Set(r(prosa)), detti = new Set(r(dichiarata)), presenti = new Set(r(testo));
    const chiave = r(((ev && ev.effetti) || []).filter(e => e.tipo === 'scoperta' && e.testo).map(e => e.testo).join(' ')).filter(w => nellaProsa.has(w) && !detti.has(w));
    return chiave.length < 2 ? 1 : chiave.filter(w => presenti.has(w)).length / chiave.length;
  }
  /* Le unità dei fatti di questo evento (registrati ora, o da consegnare in questa battuta) che il testo d'autore della battuta porta e che la
     riscrittura perde, nega o rende incerte (RMSoloComunicati.contiene): il 60% delle parole da solo non certifica la stessa informazione. */
  function unitaPerse(testo, b, ev, content, dichiarata) {
    const CM = global.RMSoloComunicati;
    if (!CM || !content || !content.fatti) return [];
    const ids = ((ev && ev.effetti) || []).filter(e => e.tipo === 'scoperta' && e.fatto).map(e => e.fatto).concat(b.fatti || []).filter((x, i, a) => a.indexOf(x) === i && content.fatti[x]);
    const out = [];
    ids.forEach(id => CM.unitaDi(content, id).forEach((u, i) => { if (CM.contiene(u, b.prosa, '') && !CM.contiene(u, testo, dichiarata)) out.push(id + '#' + i); }));
    // l'evento registra fatti: il suo testo d'autore ne è la comunicazione (RMSoloComunicati.marca), quindi ogni frase piena della prosa deve
    // arrivare con la stessa informazione, senza negazioni o incertezze cambiate
    if (ids.length && b.fonte === 'motore') CM.unita(b.prosa).forEach((u, i) => { if (CM.radici(u).length >= 3 && !CM.contiene(u, testo, dichiarata)) out.push('prosa#' + i); });
    return out;
  }
  /* Ripulisce il testo di una battuta. Ritorna { testo, motivi }. */
  /* Pezzi della struttura JSON finiti nel testo (prova con il 4B: «"Nome e matricola?"}],»). Solo sequenze che in italiano non
     compaiono: virgolette seguite da } o ], {" e [", chiavi della risposta, \". Le virgolette dei dialoghi («», "…") restano libere. */
  const FRAMMENTO_JSON = /"\s*[}\]]|[{[]\s*"|\\"|\}\s*\]|"(?:id|testo|battute|dialoghi|aggiornamenti|op|png|umore)"\s*:/;
  function ripulisci(state, content, ev, b, testo, presenti) {
    const motivi = [];
    // una battuta con pezzi di JSON è rotta per intero: torna alla sua riserva (non si corregge a pezzi)
    if (FRAMMENTO_JSON.test(String(testo || ''))) return { testo: '', motivi: ['frammento_json'] };
    // il messaggio intero del giocatore (contratto §5.2): ciò che ha scritto, anche fuori dalla parte agita di questo evento, non è racconto
    const dichiarata = ev.testoGiocatore || (ev.resoconto && ev.resoconto.azioneDichiarata) || ev.testo || '';
    // anche dopo una citazione chiusa («…stagione?» Argus alza gli occhi): l'eco del giocatore e il racconto restano frasi distinte
    let frasi = sentenze(testo).flatMap(f => f.split(/(?<=[.!?…]»)\s+(?=[A-ZÀ-Ú«])/));
    // battute già mostrate nella scena: un PNG non le ripete come nuove (registro del 5/11/2026, turno 3)
    const dette = E() && E().battuteGiaDette ? E().battuteGiaDette(state, content, ev.scena) : [];
    const giaDetta = f => dette.length && (String(f).match(/«[^»]*»?|[^«]*»/g) || []).some(q => E().citazioneGiaDetta(q.replace(/[«»]/g, ''), dette));
    const copiaDelContenuto = f => b.fonte === 'motore' && jaccard(f, b.guida) >= 0.85;
    const ME = global.RMSoloMemoria, scenaEv = ev.scena;
    const dati = ((ev && ev.effetti) || []).filter(a => (a.tipo === 'ricompensa' || a.tipo === 'loot_scoperto') && a.nome).map(a => radiciPiene(String(a.nome).replace(/\s*\([^)]*\)/g, '')));
    const oggettoDato = f => { const r = new Set(radiciPiene(f)); return dati.some(n => n.length && n.every(w => r.has(w))); };
    const contraddice = f => !!(ME && ME.contraddiceCanone && ME.contraddiceCanone(state, content, scenaEv, f));   // il testo d'autore non si riscrive
    frasi = frasi.filter(f => {
      const copia = copiaDelContenuto(f);   // una frase del contenuto d'autore resta com'è: i controlli di sicurezza (segreti, lessico) valgono sempre
      const continuita = contraddiceContinuita(f, (ev.piano && ev.piano.continuita) || []);
      if (!copia && continuita) { motivi.push('continuita_evento:' + continuita); return false; }
      // la battuta «azione» riformula il giocatore; nelle altre la sua frase ripetuta non è racconto né risposta
      if (b.tipo !== 'azione' && !copia && eco(f, dichiarata)) { motivi.push('eco_del_giocatore'); return false; }
      if (!copia && giaDetta(f)) { motivi.push('battuta_gia_detta'); return false; }
      // contraddizione certa con un colore che i testi d'autore danno all'entità: la frase non si mostra (contratto §4.3, D6)
      if (!copia && contraddice(f)) { motivi.push('contraddice_canone'); return false; }
      let d = copia ? [] : decisioniAlPosto(f, dichiarata);
      // battuta «azione»: «Chiedi a Erebo di…» riformula ciò che il giocatore ha detto (anche in discorso diretto), non decide per lui
      if (b.tipo === 'azione' && d.length && paroleInComune(f, dichiarata) >= 2) d = d.filter(v => VERBI_DI_PAROLA.indexOf(v) === -1);
      // effetto autorizzato: il motore ha appena dato al protagonista l'oggetto che la frase gli mette in mano (ricompensa, bottino);
      // resta vietato il gesto su un oggetto che il motore non ha dato (registro del 5/11/2026: «la tua mano si chiude intorno al fiore»)
      if (d.length && oggettoDato(f)) d = d.filter(v => !GESTI_DI_PRESA.test(v));
      if (d.length) { motivi.push('decide_per_il_protagonista:' + d[0]); return false; }
      if (!copia && /\b\d+\s*(hp|mp|pp|ap|danni|punti)\b/i.test(f)) { motivi.push('numeri_di_gioco'); return false; }
      const assenti = copia ? [] : pngAssentiAttivi(f, content, presenti);
      if (assenti.length) { motivi.push('png_assente:' + assenti[0]); return false; }
      const s = M().testoSicuro(state, content, f);
      if (!s.ok && s.motivi.some(m => /^(segreto|lessico):/.test(m))) { motivi.push(s.motivi.find(m => /^(segreto|lessico):/.test(m))); return false; }
      return true;
    });
    let out = frasi.join(' ');
    // (le virgolette basse dei nomi, come «Scadenza di Linea Muta», non chiudono una frase: si conta con lo stesso separatore del resto del modulo)
    if (b.maxFrasi) {
      const fr = sentenze(out);
      if (fr.length > b.maxFrasi) {
        motivi.push('troppo_lunga');
        // non si taglia dentro una citazione: si arriva alla frase che la chiude
        let n = b.maxFrasi;
        const aperte = k => { const x = fr.slice(0, k).join(' '); return (x.match(/«/g) || []).length > (x.match(/»/g) || []).length; };
        while (n < fr.length && aperte(n)) n++;
        out = fr.slice(0, n).join(' ');
      }
    }
    return { testo: out.trim(), motivi };
  }

  /* Aggiornamenti che il Narratore può proporre, per ora: l'umore di un PNG coinvolto nel turno, fino alla fine della scena
     (permessi del piano: tipo, soggetto, valori, durata). Fatti, fili e memorie restano del motore e del Regista: quelli emersi
     dall'improvvisazione potranno passare da una valutazione del Regista (non ancora prevista); oggi si respingono e restano
     nella diagnostica del turno. */
  const OPERAZIONI_NARRATORE = ['png_umore'];
  function filtraAggiornamenti(content, piano, ops) {
    const ammessi = [], respinti = [];
    // il modello indica il PNG per id o per nome: si riporta all'id solo fra i soggetti dei permessi
    const soggetto = x => (piano.permessi || []).map(p => p.soggetto).find(id => id === x || (content.png[id] && norm(x).trim() && norm(content.png[id].nome).replace(/\([^)]*\)/g, '').trim().split(' ')[0] === norm(x).trim().split(' ')[0]));
    (Array.isArray(ops) ? ops : []).forEach(op => {
      if (!op || typeof op !== 'object') return respinti.push({ op: '?', motivo: 'riservata_al_motore' });
      // {png, umore} senza «op» (il modello lo omette spesso): vale come png_umore, ma solo dopo i controlli qui sotto
      const tipo = op.op || (op.png != null && op.umore != null && Object.keys(op).every(k => k === 'png' || k === 'umore') ? 'png_umore' : null);
      if (OPERAZIONI_NARRATORE.indexOf(tipo) === -1) return respinti.push({ op: op.op ? String(op.op).slice(0, 30) : '?', motivo: 'riservata_al_motore' });
      const id = soggetto(String(op.png || ''));
      const ok = id && (piano.permessi || []).some(p => p.op === tipo && p.soggetto === id && p.valori.indexOf(op.umore) !== -1);
      if (ok) ammessi.push({ op: tipo, png: id, umore: op.umore }); else respinti.push({ op: tipo, motivo: 'non_autorizzata' });
    });
    return { ammessi, respinti };
  }

  const VERBI_DI_PAROLA = ['dici', 'rispondi', 'chiedi', 'sussurri', 'urli', 'gridi', 'ordini', 'mormori', 'spieghi'];
  const paroleInComune = (f, g) => {
    const a = norm(senzaCitazioni(f)).split(/[^a-z]+/).filter(w => w.length >= 4), b = norm(g).split(/[^a-z]+/).filter(w => w.length >= 4);
    return Array.from(new Set(a.filter(w => b.some(x => x.slice(0, 5) === w.slice(0, 5))))).length;
  };

  /* Cambiamenti durevoli affermati come accaduti nel racconto (non nei dialoghi, non nelle ipotesi, non nel testo d'autore).
     Rete di sicurezza, non garanzia: un'invenzione detta con altre parole può sfuggire. Per questo il mondo non accetta dal
     Narratore nessuna conseguenza persistente, qualunque cosa dica il testo. */
  const DUREVOLE = /(?<!\p{L})(per sempre|da oggi|d'ora in (poi|avanti)|non torner[aà] (pi[uù]|mai)|carta bianca|ai tuoi ordini|al tuo comando|(affida|consegna|cede|d[aà]) (a te )?(il )?comando|ti (nomina|proclama)|condannat[oaie]|giustiziat[oaie]|esiliat[oaie]|sotto sorveglianza|sorvegliat[oa] giorno e notte)(?!\p{L})/iu;
  const IPOTESI = /(?<!\p{L})(potrebbe|potrebbero|potresti|forse|magari|un giorno|chiss[aà]|sarebbe|vorrebbe|dovrebbe|se mai)(?!\p{L})|\?/iu;
  function contraddiceContinuita(testo, vincoli) {
    const t = norm(String(testo || '').replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' '));
    if (IPOTESI.test(t)) return null;
    for (const v of vincoli) {
      // Il medesimo soggetto deve precedere direttamente la negazione o l'immobilità:
      // «il vento non si muove accanto allo stormo» non parla del movimento dello stormo.
      const soggetto = '(?:^|[.!?;]\\s*)\\s*(?:(?:il|lo|la|i|gli|le|uno|una|un)\\s+)?' + v.soggetto + '\\b(?:\\s+(?!(?:non|si|e|resta|rimane|sono|restano|rimangono)\\b)[a-z]+){0,5}\\s+';
      // Una direzione negata («non arriva da nord») o una divisione specifica negata
      // («non si divide in due») possono essere compatibili: qui solo negazioni assolute.
      const fine = '(?=\\s*(?:[.!?;,]|$))';
      const fermo = '(?:non\\s+(?:si\\s+)?(?:muove|muovono|avanza|avanzano|vola|volano|arriva|arrivano)' + fine + '|(?:e|sono|resta|restano|rimane|rimangono)\\s+immobil[ei]\\b)';
      const indiviso = 'non\\s+si\\s+(?:divide|dividono|separa|separano)' + fine;
      if (new RegExp(soggetto + fermo).test(t) || (v.divisione && new RegExp(soggetto + indiviso).test(t))) return v.soggetto;
    }
    return null;
  }
  function coerenza(content, piano, testi) {
    const problemi = [];
    (piano.battute || []).forEach(b => {
      const t = testi[b.id];
      if (!t) return;
      sentenze(senzaCitazioni(t)).forEach(f => {
        if (IPOTESI.test(f) || !DUREVOLE.test(f)) return;
        if ((b.guida && jaccard(f, b.guida) >= 0.85) || (b.prosa && jaccard(f, b.prosa) >= 0.85)) return;   // testo d'autore
        problemi.push('cambiamento_durevole_non_autorizzato:' + b.id);
      });
    });
    return problemi.filter((x, i, a) => a.indexOf(x) === i);
  }

  /* Il post-processo del turno. nar: { testo, battute, aggiornamenti, scritte, fonte:'ia', piano:true } come da narraPiano. */
  function elabora(state, content, ev, nar) {
    const piano = ev.piano;
    // dopo un cambio di scena il racconto parla della scena nuova; altrimenti i presenti sono quelli della scena dell'evento e di quella in cui si è arrivati
    const presentiDi = id => E().presentiEffettivi(state, content, id);
    const presenti = (ev.tipo === 'prosegui' ? presentiDi(state.scena) : presentiDi(ev.scena).concat(presentiDi(state.scena))).filter((x, i, a) => a.indexOf(x) === i);
    const info = { scarti: [], battuteRiservate: [], operazioni: { applicate: 0, scartate: [] } };
    // il testo di ogni battuta come l'ha scritto il narratore: si rilegge dai testi dei paragrafi per id
    const scritti = nar.testiPerId || null;
    const testi = {};
    if (scritti) {
      piano.battute.forEach(b => {
        const t = scritti[b.id];
        if (!t) return;
        const r = ripulisci(state, content, ev, b, t, presenti);
        r.motivi.forEach(m => info.scarti.push({ battuta: b.id, motivo: m }));
        // fedeltà al piano
        let ok = !!r.testo;
        if (ok && b.tipo === 'iniziativa_png' && b.png && content.png[b.png]) {
          const nome = norm(content.png[b.png].nome).replace(/\([^)]*\)/g, '').trim().split(' ')[0];
          if (nome.length >= 3 && norm(r.testo).indexOf(nome) === -1) { ok = false; info.scarti.push({ battuta: b.id, motivo: 'iniziativa_senza_il_png' }); }
        }
        if (ok && !b.daDati && (b.tipo === 'esito' || b.tipo === 'oracolo' || b.tipo === 'costo') && b.guida && !fedele(r.testo, b.guida)) { ok = false; info.scarti.push({ battuta: b.id, motivo: 'infedele_al_piano' }); }
        // testo d'autore obbligatorio (la guida è il testo stesso): almeno metà delle sue parole piene deve arrivare al giocatore, altrimenti
        // si mostra il testo d'autore (registro del 5/11/2026, turno 5: la notizia di Astrid sostituita dall'eco della domanda)
        const dich = ev.testoGiocatore || (ev.resoconto && ev.resoconto.azioneDichiarata) || ev.testo || '';
        if (ok && b.obbligatoria && b.fonte === 'motore' && b.prosa && b.guida && b.guida.indexOf(b.prosa.slice(0, 40)) !== -1 && (copertura(r.testo, b.prosa, dich, content) < 0.5 || fattiConservati(r.testo, b.prosa, ev, dich) < 0.6 || unitaPerse(r.testo, b, ev, content, dich).length)) { ok = false; info.scarti.push({ battuta: b.id, motivo: 'informazioni_omesse' }); }
        if (ok) testi[b.id] = r.testo;
      });
    }
    // battute obbligatorie con prosa che sono rimaste senza testo: riserva di quella battuta
    piano.battute.forEach(b => { if (b.obbligatoria && b.prosa && !testi[b.id]) info.battuteRiservate.push(b.id); });
    const testo = PI().proseDaPiano(piano, testi);
    // dialoghi: solo PNG presenti e senza decisioni per il protagonista né segreti
    const battute = (nar.battute || []).filter(d => {
      const nomeD = norm(d.png);
      const p = presenti.find(id => content.png[id] && (nomeD === id || norm(content.png[id].nome).split(' ').some(w => w.length > 3 && nomeD.indexOf(w) !== -1)));
      if (!p) { info.scarti.push({ battuta: 'dialogo', motivo: 'png_assente:' + d.png }); return false; }
      if (FRAMMENTO_JSON.test(d.testo)) { info.scarti.push({ battuta: 'dialogo', motivo: 'frammento_json' }); return false; }
      const s = M().testoSicuro(state, content, d.testo);
      if (!s.ok && s.motivi.some(m => /^(segreto|lessico):/.test(m))) { info.scarti.push({ battuta: 'dialogo', motivo: s.motivi[0] }); return false; }
      return true;
    });
    // aggiornamenti proposti: solo quelli autorizzati dal piano, poi valutati su una copia (lista bianca, massimo 8 per turno).
    // Li applica attachNarration, e solo se il testo viene accettato: una risposta scartata non lascia conseguenze nel mondo
    const filtro = filtraAggiornamenti(content, piano, nar.aggiornamenti);
    const aggiornamenti = filtro.ammessi;
    if (aggiornamenti.length || filtro.respinti.length) {
      const r = aggiornamenti.length ? M().applica(JSON.parse(JSON.stringify(state)), content, aggiornamenti) : { applicate: [], scartate: [] };
      info.operazioni = { applicate: r.applicate.length, scartate: filtro.respinti.concat(r.scartate) };
    }
    // coerenza: cambiamenti durevoli raccontati o dichiarati senza autorizzazione del piano (il testo intero si scarta, non si corregge)
    info.coerenza = coerenza(content, piano, testi);
    return { testo, battute, aggiornamenti, info, riservate: info.battuteRiservate };
  }

  global.RMSoloPost = { VERBI, REAZIONI_INVOLONTARIE, GESTI_DI_PRESA, eco, copertura, fattiConservati, unitaPerse, verboDichiarato, decisioniAlPosto, pngAssentiAttivi, ripulisci, elabora, sentenze, coerenza, contraddiceContinuita, filtraAggiornamenti, OPERAZIONI_NARRATORE, FRAMMENTO_JSON };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloPost;
})(typeof window !== 'undefined' ? window : globalThis);
