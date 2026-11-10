/* ==========================================================================
   Role Makers — Gioca in solitaria: stato del mondo e fatti (motore V2, modulo 1).

   Tiene lo STATO NARRATIVO della partita (state.mondo): PNG con obiettivo e
   stato, fili, fronti collegati agli orologi, fatti di partita e memoria.
   Non è regolamento: non contiene HP, MP, danni, oggetti, esiti né flag di
   gioco, e nessuna sua funzione li scrive. Il motore delle regole resta
   l'unica autorità; qui si registra ciò che il motore ha già deciso (e ciò
   che il racconto introduce di innocuo, tramite operazioni validate).

   Interruttori (state.opzioni.motore2): mondo, regia, narratore, post,
   interprete, memoria. Tutti spenti = comportamento identico al motore
   attuale. Il modulo non dipende dal DOM.

   Riusa: il generatore deterministico legato a partita ed evento
   (RMSoloTrama.tiroDet), il lessico bloccato (RMSoloCampaign) e i segreti
   dei fatti del contenuto. Nessuna costante di regolamento.
   ========================================================================== */
(function (global) {
  'use strict';

  const VERSIONE = 1;
  const NOMI = ['mondo', 'regia', 'narratore', 'post', 'interprete', 'memoria'];
  const OP_MAX = 8;                 // aggiornamenti accettati per turno
  const TETTO = { fatti: 60, fili: 40, filiAperti: 6, memoriaLunga: 24, testoFatto: 140, titoloFilo: 80, chiusura: 120, nota: 120 };
  const UMORI = ['sereno', 'teso', 'diffidente', 'curioso', 'irritato', 'spaventato', 'grato'];
  const TIPI_FILO = ['png', 'fronte', 'promessa', 'costo', 'mistero', 'personale'];
  const OPERAZIONI = ['fatto_locale', 'png_umore', 'filo_apri', 'filo_chiudi', 'memoria_nota'];
  // chiavi che un'operazione non può mai portare: sono campi del regolamento o dello stato di gioco
  const CAMPI_VIETATI = /^(hp|mp|pp|danno|danni|oggetto|oggetti|inventario|borsa|stato|stati|esito|flag|flags|orologio|orologi|livello|ap|xp|risorsa|risorse|ricompensa|ricompense|equip|abilita|tecnica|tratto|morte|scena|incontro|finale)$/i;

  const C = () => global.RMSoloCampaign;
  const E = () => global.RMSoloEngine;
  const T = () => global.RMSoloTrama;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------------------------------------------------------- interruttori */
  function opzioni(state) { return (state && state.opzioni && state.opzioni.motore2) || {}; }
  function attivo(state, nome) { return !!opzioni(state)[nome]; }
  /* Imposta gli interruttori su un clone (la scelta del giocatore o dell'harness). */
  function impostaOpzioni(stateIn, valori) {
    const state = JSON.parse(JSON.stringify(stateIn));
    const m2 = Object.assign({}, opzioni(state));
    NOMI.forEach(n => { if (valori && n in valori) m2[n] = !!valori[n]; });
    state.opzioni = Object.assign({}, state.opzioni, { motore2: m2 });
    return state;
  }
  /* In modalità sviluppatore e anteprima il V2 parte acceso, ma solo se il giocatore non ha mai scelto (motore2 assente):
     una scelta esplicita, anche «spento», resta com'è. Il vecchio percorso resta la riserva (la casella lo riaccende). */
  function accendiSePredefinito(state, anteprimaAttiva, narratorePronto) {
    if (!state) return state;
    const precedente = state.opzioni && state.opzioni.narratoreAddestratoV2;
    if (narratorePronto) {
      const richieste = { mondo: true, regia: true, narratore: true, post: true, memoria: true, interprete: false };
      if (precedente && Object.keys(richieste).every(k => opzioni(state)[k] === richieste[k])) return state;
      const copia = impostaOpzioni(state, richieste);
      copia.opzioni.narratoreAddestratoV2 = precedente || { precedenti: state.opzioni && state.opzioni.motore2 ? JSON.parse(JSON.stringify(state.opzioni.motore2)) : null };
      return copia;
    }
    if (precedente) {
      state = JSON.parse(JSON.stringify(state));
      if (precedente.precedenti === null) delete state.opzioni.motore2;
      else state.opzioni.motore2 = precedente.precedenti;
      delete state.opzioni.narratoreAddestratoV2;
    }
    if (!anteprimaAttiva || (state.opzioni && state.opzioni.motore2)) return state;
    const v = {}; NOMI.forEach(n => { v[n] = true; });
    return impostaOpzioni(state, v);
  }

  /* ---------------------------------------------------------- creazione */
  function vuoto() {
    return { v: VERSIONE, turno: 0, ultimaIniziativa: 0, png: {}, fili: [], fronti: [], fatti: [], memoria: { recente: [], scene: {}, lunga: [] }, contatori: { fili: 0, fatti: 0 } };
  }
  function pressioneDi(o) { return o && o.max ? Math.max(0, Math.min(3, Math.floor(4 * o.valore / o.max))) : 0; }

  /* Crea o completa il mondo dalla partita e dal contenuto. Idempotente. */
  function ensure(state, content) {
    if (!state.mondo || state.mondo.v !== VERSIONE) state.mondo = vuoto();
    const m = state.mondo;
    Object.keys(content.png || {}).forEach(id => {
      if (!m.png[id]) m.png[id] = { id, obiettivo: { testo: String(content.png[id].motivazione || ''), urgenza: 1 }, umore: null, sospetto: 0, debito: 0, ultimoTurnoAttivo: 0, mossaRecente: null };
    });
    Object.keys(content.orologi || {}).forEach(id => {
      const d = content.orologi[id];
      if (d.visibile === false || m.fronti.some(f => f.orologio === id)) return;
      // un orologio con «sconfitta» è una scadenza che incombe; gli altri (es. riparazioni) sono lavori che avanzano
      m.fronti.push({ id: 'fr_' + id, nome: d.nome, orologio: id, polarita: d.sconfitta ? 'minaccia' : 'avanzamento', pressione: 0, ultimaSoglia: 0, minaccia: d.nome });
    });
    return m;
  }

  /* ---------------------------------------------------------- fatti */
  function aggiungiFatto(state, testo, fonte, o) {
    const m = state.mondo;
    const t = String(testo || '').trim().slice(0, TETTO.testoFatto);
    if (!t) return null;
    if (m.fatti.some(f => f.testo === t)) return null;
    const f = { id: 'f' + (++m.contatori.fatti), testo: t, fonte, segreto: !!(o && o.segreto), visibile: !(o && o.visibile === false), n: (o && o.n) || m.turno, scena: (o && o.scena) || state.scena };
    m.fatti.push(f);
    if (m.fatti.length > TETTO.fatti) m.fatti = m.fatti.filter((x, i) => x.fonte === 'canone' || i >= m.fatti.length - TETTO.fatti);
    return f;
  }

  /* ---------------------------------------------------------- fili */
  function apriFilo(state, o) {
    const m = state.mondo;
    const titolo = String(o.titolo || '').trim().slice(0, TETTO.titoloFilo);
    if (!titolo) return null;
    const esiste = m.fili.find(f => f.stato === 'aperto' && (f.titolo === titolo || (o.legatoA && f.legatoA === o.legatoA && f.tipo === o.tipo)));
    if (esiste) return esiste;
    const f = { id: 't' + (++m.contatori.fili), titolo, tipo: TIPI_FILO.indexOf(o.tipo) !== -1 ? o.tipo : 'mistero', legatoA: o.legatoA || null, stato: 'aperto', aperto: m.turno, chiuso: null, passi: 0, chiusura: null };
    m.fili.push(f);
    if (m.fili.length > TETTO.fili) { const i = m.fili.findIndex(x => x.stato === 'chiuso'); if (i !== -1) m.fili.splice(i, 1); }
    return f;
  }
  function chiudiFilo(state, id, chiusura) {
    const f = state.mondo.fili.find(x => x.id === id && x.stato === 'aperto');
    if (!f) return null;
    f.stato = 'chiuso'; f.chiuso = state.mondo.turno; f.chiusura = String(chiusura || '').trim().slice(0, TETTO.chiusura) || null;
    return f;
  }
  const filiAperti = state => (state.mondo ? state.mondo.fili.filter(f => f.stato === 'aperto') : []);

  /* ---------------------------------------------------------- sicurezza dei testi */
  /* Un testo introdotto dal racconto non può contenere segreti non scoperti, lessico ancora bloccato né
     asserzioni su ricompense, numeri di risorse o esiti. */
  function testoSicuro(state, content, testo) {
    const t = String(testo || '');
    const motivi = [];
    Object.entries(content.fatti || {}).forEach(([id, f]) => {
      if (!f.segreto || (global.RMSoloComunicati ? global.RMSoloComunicati.noto(state, content, id) : (state.fattiScoperti || []).indexOf(id) !== -1) || !f.parole) return;
      if (f.parole.some(w => new RegExp(w, 'i').test(t))) motivi.push('segreto:' + id);
    });
    if (C() && C().lockedLexicon) C().lexiconHits(t, C().lockedLexicon(state, content)).forEach(h => motivi.push('lessico:' + h));
    if (/\b\d+\s*(hp|mp|pp|ap|punti|danni|monete)\b/i.test(t)) motivi.push('numeri_di_gioco');
    if (/\b(ricevi|ottieni|trovi|guadagni|perdi|muori|sei morto|guarisci)\b/i.test(t)) motivi.push('esito_o_oggetto');
    return { ok: !motivi.length, motivi };
  }

  /* ---------------------------------------------------------- operazioni validate */
  /* Applica una lista di aggiornamenti proposti (dal racconto o dal regista) a state.mondo.
     Operazione sconosciuta o con campi del regolamento: scartata. Oltre OP_MAX: scartate. Mai altro che state.mondo. */
  function applica(state, content, ops, opt) {
    const m = ensure(state, content);
    const risultato = { applicate: [], scartate: [] };
    const no = (op, motivo) => risultato.scartate.push({ op: op && op.op ? String(op.op).slice(0, 30) : '?', motivo });
    const lista = Array.isArray(ops) ? ops : [];
    const presenti = new Set(E().presentiEffettivi(state, content));
    lista.forEach((op, i) => {
      if (i >= OP_MAX) return no(op, 'oltre_il_massimo');
      if (!op || typeof op !== 'object' || Array.isArray(op)) return no(op, 'forma_non_valida');
      if (OPERAZIONI.indexOf(op.op) === -1) return no(op, 'operazione_sconosciuta');
      const vietato = Object.keys(op).find(k => CAMPI_VIETATI.test(k));
      if (vietato) return no(op, 'campo_vietato:' + vietato);
      if (op.op === 'fatto_locale') {
        const t = String(op.testo || '').trim();
        if (t.length < 4) return no(op, 'testo_vuoto');
        const s = testoSicuro(state, content, t);
        if (!s.ok) return no(op, s.motivi[0]);
        const f = aggiungiFatto(state, t, 'narratore', { visibile: op.visibile !== false });
        return f ? risultato.applicate.push({ op: 'fatto_locale', id: f.id }) : no(op, 'duplicato');
      }
      if (op.op === 'png_umore') {
        if (!m.png[op.png]) return no(op, 'png_inesistente');
        if (!presenti.has(op.png)) return no(op, 'png_non_presente');
        if (UMORI.indexOf(op.umore) === -1) return no(op, 'umore_non_ammesso');
        m.png[op.png].umore = op.umore;
        m.png[op.png].umoreScena = state.scena;   // vale fino alla fine di questa scena (lo azzera il Regista al turno dopo)
        return risultato.applicate.push({ op: 'png_umore', png: op.png });
      }
      if (op.op === 'filo_apri') {
        const t = String(op.titolo || '').trim();
        if (t.length < 4) return no(op, 'titolo_vuoto');
        const s = testoSicuro(state, content, t);
        if (!s.ok) return no(op, s.motivi[0]);
        if (filiAperti(state).length >= TETTO.filiAperti) return no(op, 'troppi_fili_aperti');
        const f = apriFilo(state, { titolo: t, tipo: op.tipo, legatoA: op.legatoA });
        return f ? risultato.applicate.push({ op: 'filo_apri', id: f.id }) : no(op, 'filo_non_aperto');
      }
      if (op.op === 'filo_chiudi') {
        const f = chiudiFilo(state, op.id, op.chiusura);
        return f ? risultato.applicate.push({ op: 'filo_chiudi', id: f.id }) : no(op, 'filo_inesistente_o_chiuso');
      }
      if (op.op === 'memoria_nota') {
        const t = String(op.testo || '').trim().slice(0, TETTO.nota);
        if (t.length < 4) return no(op, 'testo_vuoto');
        const s = testoSicuro(state, content, t);
        if (!s.ok) return no(op, s.motivi[0]);
        m.memoria.lunga.push(t);
        if (m.memoria.lunga.length > TETTO.memoriaLunga) m.memoria.lunga.shift();
        return risultato.applicate.push({ op: 'memoria_nota' });
      }
    });
    return risultato;
  }

  /* ---------------------------------------------------------- dopo ogni comando */
  const ESITI_TESTO = { successo: 'riuscita', parziale: 'riuscita a metà', fallimento: 'fallita' };

  /* Registra ciò che il motore ha già deciso. Chiamato dal motore dopo il resoconto, solo con l'interruttore «mondo». */
  function dopoComando(state, content, ev, cmd) {
    const m = ensure(state, content);
    m.turno = ev.n;
    // fronti: la pressione segue gli orologi del motore (che il motore aggiorna, non qui)
    m.fronti.forEach(f => { f.pressione = pressioneDi((state.orologi || {})[f.orologio]); });
    (ev.effetti || []).forEach(a => {
      if (a.tipo === 'scoperta' && a.testo) aggiungiFatto(state, a.testo, 'canone', { n: ev.n, scena: ev.scena });
      if (a.tipo === 'oracolo' && a.testo) aggiungiFatto(state, 'Il mondo ha risposto: ' + a.testo, 'motore', { n: ev.n, scena: ev.scena });
      if (a.tipo === 'promessa_dialogo') apriFilo(state, { titolo: 'Promessa: ' + String(a.testo || a.png || '').slice(0, 60), tipo: 'promessa', legatoA: a.png ? 'png:' + a.png : null });
      if (a.tipo === 'filo' && a.titolo) {
        // fili della memoria narrativa dell'improvvisazione: si specchiano nel mondo
        if (a.stato === 'aperto') apriFilo(state, { titolo: a.titolo, tipo: 'mistero' });
        else { const f = m.fili.find(x => x.stato === 'aperto' && x.titolo === a.titolo); if (f) chiudiFilo(state, f.id, 'Chiuso nel racconto'); }
      }
    });
    if (ev.esito && ev.tipo !== 'combattimento') {
      const o = ev.obiettivoTesto ? String(ev.obiettivoTesto).replace(/[.!?]+$/, '') : 'Prova';
      aggiungiFatto(state, o + ': ' + (ESITI_TESTO[ev.esito] || ev.esito) + '.', 'motore', { n: ev.n, scena: ev.scena });
    }
    const imp = ev.imprevisto;
    if (imp) {
      const tipo = /^orologio:/.test(imp.filo) ? 'fronte' : /^png:/.test(imp.filo) ? 'png' : imp.filo === 'promessa' ? 'promessa' : 'mistero';
      const f = apriFilo(state, { titolo: String(imp.testo || '').slice(0, TETTO.titoloFilo), tipo, legatoA: imp.filo === 'generico' ? null : imp.filo });
      if (f) { f.passi += imp.effetto === 'avanza' || imp.effetto === 'complica' ? 1 : 0; if (imp.effetto === 'chiude') chiudiFilo(state, f.id, imp.testo); }
    }
  }

  global.RMSoloMondo = {
    VERSIONE, NOMI, OP_MAX, TETTO, UMORI, TIPI_FILO, OPERAZIONI, CAMPI_VIETATI,
    opzioni, attivo, impostaOpzioni, accendiSePredefinito, ensure, vuoto, aggiungiFatto, apriFilo, chiudiFilo, filiAperti, testoSicuro, applica, dopoComando, pressioneDi
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloMondo;
})(typeof window !== 'undefined' ? window : globalThis);
