/* Role Makers — Gioca in solitaria: profondità (Fase 5): oracolo, imprevisti di scena, trama guidata dall'obiettivo.

   ORACOLO. Il giocatore fa una domanda sì/no al mondo; il motore risponde «sì», «sì, ma», «no» o «no, e» con una
   probabilità pesata sulla TENSIONE della scena (0-10, RMSoloDirector.tension):
     sì = 60 − 3·T %, sì ma = 10 + 2·T %, no e = 5 + 2·T %, no = il resto  (tabella PROPOSTA, attiva).
   Coerenza: una domanda già posta riceve la stessa risposta (nessun nuovo tiro); una domanda su ciò che il
   protagonista ha già scoperto riceve «sì»; una domanda che tocca un segreto non ancora scoperto, o il lessico
   ancora bloccato, riceve solo «sì, ma» non rivelatore (mai «no», che sarebbe una bugia) e nessun tiro.
   La risposta si salva in state.oracolo e vale come fatto di partita (specifico_partita): il narratore la riceve.

   IMPREVISTI DI SCENA. Evento occasionale deciso dal motore, legato a un filo aperto (una scadenza in corso, un
   PNG presente, una promessa attiva, un dettaglio del luogo) che avanza, si complica o (dopo due avanzamenti) si
   chiude. Mai in combattimento, dialogo, viaggio, scene chiave (finale, scontro, ultima scena di un atto), al
   massimo uno ogni 4 eventi e uno per scena; opzione per disattivarli (state.opzioni.imprevisti). Il tiro non usa i
   dadi della partita (non sposta la loro sequenza): è un generatore deterministico legato a partita ed evento. È la
   prima eccezione al «niente tiri casuali» della struttura lunga e va dichiarata (PIANO_SOLITARIA.md).
   Attivi solo se il contenuto ha <storia>-imprevisti.json.

   TRAMA GUIDATA DALL'OBIETTIVO. Nella scena di ciascuno dei tre traguardi (js/solo/solo-percorso.js) compare, fra le
   scelte, «Il tuo filo»: una prova (tratto migliore fra quelli indicati, NC del beat con la difficoltà) con tre esiti
   scritti; il punteggio dei tre traguardi (pieno 2, parziale 1, mancato 0) decide la chiusura nell'epilogo:
   5-6 raggiunto, 3-4 parziale, 0-2 mancato. Solo per i personaggi con un tipo di obiettivo.
   Logica pura (nessun DOM), testabile in Node. */
(function (global) {
  'use strict';

  const R = () => global.RMSoloRules;
  const C = () => global.RMSoloCampaign;
  const E = () => global.RMSoloEngine;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  /* ------------------------------------------------------------ oracolo */
  const ESITI = ['si', 'si_ma', 'no', 'no_e'];
  const ETICHETTE = { si: 'Sì', si_ma: 'Sì, ma', no: 'No', no_e: 'No, e' };
  const TESTI = {
    si: 'Sì: è così.',
    si_ma: 'Sì, ma non senza una complicazione.',
    no: 'No: non è così.',
    no_e: 'No, e la situazione si fa peggiore.'
  };
  const COMPLICAZIONI = {
    si_ma: ['Ma ti costa tempo.', 'Ma qualcuno potrebbe accorgersene.', 'Ma non è chiaro fino a che punto.'],
    no_e: ['E qualcuno ha sentito la domanda.', 'E la risposta lascia un\'ombra più lunga di prima.', 'E il tempo sembra stringere.']
  };
  const PROTETTA = 'Qualcosa di vero c\'è, ma non puoi ancora capirlo: quello che sai non basta.';
  const WH = /^(chi|che|cosa|come|dove|quando|perche|quale|quali|quanto|quanti|quante|quanta|per quale)\b/;

  function bande(t) {
    const T = Math.max(0, Math.min(10, Math.round(Number(t) || 0)));
    const si = 60 - 3 * T, siMa = 10 + 2 * T, noE = 5 + 2 * T;
    return { si, si_ma: siMa, no_e: noE, no: 100 - si - siMa - noE, tensione: T };
  }
  function esitoDa(tiro, t) {
    const b = bande(t);
    return tiro <= b.si ? 'si' : tiro <= b.si + b.si_ma ? 'si_ma' : tiro <= b.si + b.si_ma + b.no ? 'no' : 'no_e';
  }
  /* È una domanda sì/no al mondo? Termina con «?», non comincia con una parola interrogativa aperta e non è
     rivolta a un presente per nome (quella è una battuta di dialogo). */
  function eDomanda(testo, state, content) {
    const t = String(testo || '').trim();
    if (t.length < 8 || !/\?\s*$/.test(t)) return false;
    const n = norm(t);
    if (WH.test(n)) return false;
    if (state && content && E()) {
      const sc = E().currentScene(state, content);
      const nomi = (sc && sc.png_presenti || []).map(id => content.png[id]).filter(Boolean).map(p => norm(p.nome).split(' ')[0]);
      if (nomi.some(x => x && n.split(' ').slice(0, 3).indexOf(x) !== -1)) return false;
    }
    return true;
  }
  const parole = t => Array.from(new Set(norm(t).split(' ').filter(w => w.length > 3))).sort();
  const chiave = t => parole(t).join(' ');

  function tensione(state, content) { return global.RMSoloDirector && global.RMSoloDirector.tension ? global.RMSoloDirector.tension(state, content) : 0; }
  function sceltaTesto(lista, k) { return lista[k % lista.length]; }

  /* Risposta (senza modificare lo stato). dado: funzione () => d100 (la fornisce il motore). */
  function rispondi(state, content, domanda, dado) {
    const key = chiave(domanda);
    const prec = (state.oracolo || []).find(x => x.chiave === key);
    if (prec) return { esito: prec.esito, tiro: prec.tiro, tensione: prec.tensione, chiave: key, ripetuta: true, protetta: !!prec.protetta, testo: prec.testo };
    const T = tensione(state, content);
    const locked = C() ? C().lockedLexicon(state, content) : [];
    const segreto = global.RMSoloImprov && global.RMSoloImprov.segretoToccato ? global.RMSoloImprov.segretoToccato(state, content, domanda) : null;
    if (segreto || (C() && locked.length && C().lexiconHits(domanda, locked).length)) {
      return { esito: 'si_ma', tiro: null, tensione: T, chiave: key, ripetuta: false, protetta: true, testo: ETICHETTE.si_ma + '. ' + PROTETTA };
    }
    // già scoperto: la risposta coerente è «sì»
    const w = parole(domanda);
    const noto = (global.RMSoloComunicati ? global.RMSoloComunicati.testiNoti(state, content) : (state.fattiScoperti || []).map(f => (content.fatti[f] || {}).testo)).some(t => {
      const fw = parole(t);
      return fw.length >= 3 && w.filter(x => fw.indexOf(x) !== -1).length >= 3;
    });
    if (noto) return { esito: 'si', tiro: null, tensione: T, chiave: key, ripetuta: false, protetta: false, coerente: true, testo: ETICHETTE.si + '. ' + 'È ciò che già sai.' };
    const tiro = dado();
    const esito = esitoDa(tiro, T);
    const n = (state.oracolo || []).length;
    const extra = COMPLICAZIONI[esito] ? ' ' + sceltaTesto(COMPLICAZIONI[esito], n) : '';
    return { esito, tiro, tensione: T, chiave: key, ripetuta: false, protetta: false, testo: TESTI[esito] + extra };
  }
  function registraOracolo(state, ev, domanda, r) {
    if (r.ripetuta) return;
    state.oracolo = (state.oracolo || []).concat([{ n: ev.n, scena: state.scena, domanda: String(domanda).trim().slice(0, 140), chiave: r.chiave, esito: r.esito, tiro: r.tiro, tensione: r.tensione, protetta: !!r.protetta, testo: r.testo }]);
  }
  /* Fatti dell'oracolo per il narratore: stabiliti, da non contraddire. */
  function fattiOracolo(state) {
    return (state.oracolo || []).slice(-5).map(x => 'Domanda «' + x.domanda + '» → ' + ETICHETTE[x.esito] + (x.protetta ? ' (non rivelatore)' : ''));
  }

  /* ------------------------------------------------------------ imprevisti */
  const IMP = content => (content && content.imprevisti && content.imprevisti.formato === 'rm-solo-imprevisti/1' ? content.imprevisti.imprevisti : null);
  const ogni = 4;
  function scenaChiave(state, content) {
    const sc = E().currentScene(state, content);
    if (!sc) return true;
    if (sc.finale || sc.incontro) return true;
    return (content.atti || []).some(a => (a.scene || [])[(a.scene || []).length - 1] === sc.id);
  }
  function opzione(state, nome) { return !(state.opzioni && state.opzioni[nome] === false); }
  /* Generatore deterministico legato a partita ed evento: stesso stato = stesso risultato, senza toccare i dadi. */
  function tiroDet(state, sale, max) {
    let h = 2166136261;
    const s = String(state.id) + ':' + sale + ':' + (state.eventi || []).length + ':' + state.scena;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % max) + 1;
  }
  function filoAperto(state, content, filo) {
    const sc = E().currentScene(state, content);
    const im = state.imprevisti || {};
    if ((im.chiusi || {})[filo]) return false;
    if (filo === 'generico') return true;
    if (filo === 'promessa') return !!(state.sociale && (state.sociale.promesse || []).length);
    const [tipo, id] = filo.split(':');
    if (tipo === 'orologio') { const o = (state.orologi || {})[id]; return !!(o && o.attivo && o.valore < o.max); }
    if (tipo === 'png') return (sc.png_presenti || []).indexOf(id) !== -1;
    return false;
  }
  function candidati(state, content) {
    const lista = IMP(content);
    if (!lista) return [];
    const atto = state.atto || 1, im = state.imprevisti || {};
    return lista.filter(x => (x.atti || []).indexOf(atto) !== -1 && filoAperto(state, content, x.filo) && (x.effetto !== 'chiude' || ((im.progresso || {})[x.filo] || 0) >= 2));
  }
  /* Condizioni per ogni evento: ritorna l'imprevisto scelto o null. Non modifica lo stato. */
  function scegli(state, content, cmd, scenaPrima) {
    if (!IMP(content) || !opzione(state, 'imprevisti')) return null;
    if (!cmd || ['esplora', 'azione', 'improvvisa', 'scelta', 'oracolo'].indexOf(cmd.tipo) === -1) return null;
    if (state.incontro || (state.interazione && state.interazione.dialogo) || (state.mappa && state.mappa.viaggio && state.mappa.viaggio.stato === 'in_corso')) return null;
    if (state.stato !== 'attivo' || state.scena !== scenaPrima || scenaChiave(state, content)) return null;
    const im = state.imprevisti || { ultimo: -99, perScena: {} };
    if ((state.eventi || []).length - (im.ultimo == null ? -99 : im.ultimo) < ogni) return null;
    if ((im.perScena || {})[state.scena]) return null;
    const c = candidati(state, content);
    if (!c.length) return null;
    // 2-5 su 20 secondo la tensione (10-25%)
    if (tiroDet(state, 'p', 20) > 2 + Math.floor(tensione(state, content) / 3)) return null;
    return c[tiroDet(state, 's', c.length) - 1];
  }
  function registraImprevisto(state, x, evN) {
    const im = state.imprevisti = state.imprevisti || { ultimo: -99, perScena: {}, progresso: {}, chiusi: {}, storia: [] };
    im.ultimo = (state.eventi || []).length + 1; // l'evento in corso non è ancora in elenco
    im.perScena[state.scena] = (im.perScena[state.scena] || 0) + 1;
    if (x.effetto === 'avanza') im.progresso[x.filo] = (im.progresso[x.filo] || 0) + 1;
    if (x.effetto === 'chiude') im.chiusi[x.filo] = true;
    im.storia.push({ id: x.id, n: evN, scena: state.scena, filo: x.filo, effetto: x.effetto });
  }

  /* ------------------------------------------------------------ obiettivo personale */
  const P_ = () => global.RMSoloPercorso;
  function percorsoDi(state, content) {
    const ob = state.personaggio && state.personaggio.obiettivoPersonale;
    const pc = content && content.percorsi && content.percorsi.formato === 'rm-solo-percorsi/1' ? content.percorsi : null;
    if (!ob || !pc || !P_()) return null;
    const id = P_().idObiettivo(ob.tipo);
    return pc.obiettivi[id] ? { id, def: pc.obiettivi[id], ob } : null;
  }
  function traguardoAttivo(state, content) {
    const p = percorsoDi(state, content);
    if (!p || state.incontro || (state.interazione && state.interazione.dialogo)) return null;
    const t = p.def.traguardi.find(x => x.scena === state.scena && x.beat);
    if (!t || ((p.ob.beats || {})[state.scena])) return null;
    return t;
  }
  function trattoMigliore(pg, tratti) {
    let best = null, v = 0;
    (tratti || []).forEach(t => { const tv = R().traitValue(pg, t); if (tv && tv.value > v) { v = tv.value; best = t; } });
    return best || (tratti || [])[0] || null;
  }
  const PUNTI = { pieno: 2, parziale: 1, mancato: 0 };
  function esitoBeat(esitoProva) { return R().isSuccess(esitoProva) ? 'pieno' : esitoProva === 'parziale' ? 'parziale' : 'mancato'; }
  function epilogo(state, content) {
    const p = percorsoDi(state, content);
    if (!p) return null;
    const beats = p.ob.beats || {};
    const punti = p.def.traguardi.reduce((a, t) => a + ((beats[t.scena] || {}).punti || 0), 0);
    const esito = punti >= 5 ? 'raggiunto' : punti >= 3 ? 'parziale' : 'mancato';
    return { id: p.id, nome: p.def.nome, punti, esito, testo: p.def.epilogo[esito],
      traguardi: p.def.traguardi.map(t => ({ scena: t.scena, titolo: t.titolo, esito: (beats[t.scena] || {}).esito || null })) };
  }

  global.RMSoloTrama = { ESITI, ETICHETTE, bande, esitoDa, eDomanda, chiave, rispondi, registraOracolo, fattiOracolo,
    candidati, scegli, registraImprevisto, scenaChiave, tiroDet, opzione, traguardoAttivo, trattoMigliore, esitoBeat, epilogo, PUNTI, percorsoDi };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloTrama;
})(typeof window !== 'undefined' ? window : globalThis);
