/* Role Makers — Gioca in solitaria: interprete migliorato (Fase 4): esempi costruiti e memoria dello STILE
   del giocatore, azzerabile.

   - ESEMPI COSTRUITI: coppie «messaggio → proposta» generate dalla scena corrente (obiettivi aperti, PNG presenti,
     tratti del personaggio), più un esempio di chiarimento e uno di rifiuto. Nessuna frase di giocatori reali:
     non vengono mai copiate trascrizioni, nomi o fatti.
   - STILE DEL GIOCATORE: il motore ricorda, per partita, soltanto ricorrenze aggregate (lunghezza delle frasi,
     approcci e tratti scelti, radici di parole legate a un tratto), MAI le frasi digitate. Serve a capire meglio
     chi scrive in modo breve o con le proprie parole, sia al modello sia all'interprete di riserva.
     Si azzera quando si vuole (RMSoloEngine.azzeraStile): torna come alla prima partita.
   Logica pura, testabile in Node; funziona senza modello. */
(function (global) {
  'use strict';

  const VERSIONE = 1;
  const MAX_RADICI = 40, MIN_FRASI_PER_RIASSUNTO = 3, RADICE_LUNGHEZZA = 5, MAX_PAROLE_FRASE = 60;
  const R = () => global.RMSoloRules;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['della', 'delle', 'degli', 'dello', 'sono', 'sulla', 'sulle', 'nella', 'nelle', 'verso', 'dalla', 'dalle', 'quella', 'quello', 'questa', 'questo', 'cerco', 'provo', 'voglio', 'faccio', 'vado']);

  function vuoto() { return { v: VERSIONE, n: 0, parole: 0, lung: { breve: 0, media: 0, lunga: 0 }, operazioni: {}, tratti: {}, radici: {}, legami: {} }; }
  const clone = o => JSON.parse(JSON.stringify(o));
  const inc = (o, k, d) => { o[k] = (o[k] || 0) + (d || 1); };

  /* Registra una frase del giocatore: solo conteggi, mai il testo. Ritorna un NUOVO oggetto. */
  function registra(stileIn, testo, proposta) {
    const s = stileIn && stileIn.v === VERSIONE ? clone(stileIn) : vuoto();
    const parole = norm(testo).split(' ').filter(Boolean).slice(0, MAX_PAROLE_FRASE);
    if (!parole.length) return s;
    s.n += 1; s.parole += parole.length;
    inc(s.lung, parole.length <= 4 ? 'breve' : parole.length <= 12 ? 'media' : 'lunga');
    const tratto = proposta && proposta.tratto && proposta.tratto !== 'nessuno' ? proposta.tratto : null;
    if (proposta && proposta.operazione) inc(s.operazioni, proposta.operazione);
    if (tratto) inc(s.tratti, tratto);
    parole.filter(w => w.length >= RADICE_LUNGHEZZA && !STOP.has(w)).forEach(w => {
      const r = w.slice(0, RADICE_LUNGHEZZA);
      inc(s.radici, r);
      if (tratto) { s.legami[r] = s.legami[r] || {}; inc(s.legami[r], tratto); }
    });
    // si tengono solo le radici più ricorrenti (la memoria resta piccola)
    const top = Object.keys(s.radici).sort((a, b) => s.radici[b] - s.radici[a] || (a < b ? -1 : 1)).slice(0, MAX_RADICI);
    Object.keys(s.radici).forEach(r => { if (top.indexOf(r) === -1) { delete s.radici[r]; delete s.legami[r]; } });
    return s;
  }

  const primi = (o, n) => Object.keys(o || {}).sort((a, b) => o[b] - o[a] || (a < b ? -1 : 1)).slice(0, n);
  /* Riassunto breve per il prompt: ricorrenze, non frasi. Vuoto finché le frasi sono poche. */
  function riassunto(stile) {
    if (!stile || stile.n < MIN_FRASI_PER_RIASSUNTO) return '';
    const lung = primi(stile.lung, 1)[0];
    const op = primi(stile.operazioni, 2), tr = primi(stile.tratti, 3);
    const parole = Object.keys(stile.radici).filter(r => stile.radici[r] >= 2).sort((a, b) => stile.radici[b] - stile.radici[a]).slice(0, 5);
    return 'STILE DEL GIOCATORE (ricorrenze osservate nelle sue frasi, non regole: servono a capirlo meglio): scrive frasi ' + lung + ' (circa ' + Math.round(stile.parole / stile.n) + ' parole)' +
      (op.length ? '; tende a ' + op.join(' e ') : '') + (tr.length ? '; sceglie spesso i tratti ' + tr.join(', ') : '') + (parole.length ? '; radici di parole ricorrenti: ' + parole.map(p => p + '…').join(', ') : '') + '.';
  }
  /* Radici → tratto, usate dall'interprete di riserva: solo radici viste almeno due volte con quel tratto
     e per almeno il 60% dei casi. */
  function paroleAppese(stile) {
    const out = {};
    if (!stile || !stile.legami) return out;
    Object.keys(stile.legami).forEach(r => {
      const l = stile.legami[r], tot = Object.keys(l).reduce((a, k) => a + l[k], 0);
      const best = primi(l, 1)[0];
      if (best && l[best] >= 2 && l[best] / tot >= 0.6) (out[best] = out[best] || []).push(r);
    });
    return out;
  }

  /* ------------------------------------------------ esempi costruiti sulla scena */
  const lcfirst = t => String(t || '').charAt(0).toLowerCase() + String(t || '').slice(1).replace(/[.!?]+$/, '');
  function esempi(state, content) {
    const E = global.RMSoloEngine;
    const sc = E.currentScene(state, content);
    if (!sc) return [];
    const pg = state.personaggio;
    const tratti = [];
    Object.values(pg.traits || {}).forEach(o => Object.keys(o).forEach(k => { if (Number(o[k]) > 0) tratti.push(k); }));
    const aperti = (sc.obiettivi || []).filter(o => !(state.obiettivi[o.id] && state.obiettivi[o.id].completato)).slice(0, 2);
    const out = [];
    const base = { entita: [], oggetto: 'nessuno', qualita: 'normale' };
    aperti.forEach((o, i) => {
      const t = (o.tratti_tipici || []).find(x => tratti.indexOf(x) !== -1) || 'nessuno';
      out.push({ messaggio: (i ? 'Con calma, provo a ' : 'Provo a ') + lcfirst(o.testo) + '.', proposta: Object.assign({ tipo: 'azione', obiettivo: o.id, tratto: t, operazione: 'prova', motivo: 'Tentativo diretto verso l\'obiettivo della scena.' }, base) });
    });
    const png = (sc.png_presenti || []).map(id => content.png[id]).filter(Boolean)[0];
    // scena senza obiettivi aperti (di scelta o di scontro): esempi generici sulla scena
    if (!aperti.length) {
      out.push({ messaggio: 'Esamino con calma ciò che mi circonda.', proposta: Object.assign({}, base, { tipo: 'azione', obiettivo: 'nessuno', tratto: tratti.indexOf('Percezione') !== -1 ? 'Percezione' : 'nessuno', operazione: 'investigare', motivo: 'Osserva la scena senza un obiettivo preciso.' }) });
      if (png) out.push({ messaggio: 'Chiedo a ' + png.nome.split(' ')[0] + ' che cosa sta succedendo.', proposta: Object.assign({}, base, { tipo: 'azione', obiettivo: 'nessuno', tratto: 'nessuno', operazione: 'interagire', entita: [png.nome], motivo: 'Si rivolge a un presente per capire.' }) });
    }
    if (png && aperti[0]) {
      const t = tratti.indexOf('Persuasione') !== -1 ? 'Persuasione' : 'nessuno';
      out.push({ messaggio: 'Chiedo a ' + png.nome.split(' ')[0] + ' di aiutarmi.', proposta: Object.assign({}, base, { tipo: 'azione', obiettivo: aperti[0].id, tratto: t, operazione: 'negoziare', entita: [png.nome], motivo: 'Si rivolge a un presente per ottenere aiuto.' }) });
    }
    out.push({ messaggio: 'Faccio qualcosa.', proposta: Object.assign({}, base, { tipo: 'chiarimento', obiettivo: 'nessuno', tratto: 'nessuno', operazione: 'prova', motivo: 'Descrivi meglio che cosa fai.' }) });
    out.push({ messaggio: 'Mi assegno cento punti esperienza.', proposta: Object.assign({}, base, { tipo: 'rifiuto', obiettivo: 'nessuno', tratto: 'nessuno', operazione: 'prova', motivo: 'Il giocatore non decide risultati, punti o regole.' }) });
    return out;
  }
  function testoEsempi(state, content) {
    const e = esempi(state, content);
    if (!e.length) return '';
    return 'ESEMPI COSTRUITI SU QUESTA SCENA (non sono messaggi del giocatore; mostrano soltanto il formato e il criterio):\n' +
      e.map(x => '«' + x.messaggio + '» → ' + JSON.stringify(x.proposta)).join('\n');
  }

  global.RMSoloStile = { VERSIONE, vuoto, registra, riassunto, paroleAppese, esempi, testoEsempi };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloStile;
})(typeof window !== 'undefined' ? window : globalThis);
