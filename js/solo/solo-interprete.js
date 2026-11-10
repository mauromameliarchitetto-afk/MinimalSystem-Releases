/* ==========================================================================
   Role Makers — Gioca in solitaria: l'interprete con richiesta di chiarimento (motore V2, modulo 5).

   L'interprete trasforma ciò che il giocatore scrive in un'intenzione. Quando
   l'intenzione è AMBIGUA non indovina: chiede, con due o tre scelte concrete,
   e la domanda non costa tempo di gioco né dadi (nessun comando, nessun
   evento). Il giocatore può sempre rispondere «Fai come ho scritto».

   Ambiguo vuol dire (segnali deterministici, nessun modello):
   - BERSAGLIO: un pronome ("lo guardo", "gli parlo") con due o più personaggi
     presenti e nessun nome nel testo;
   - VAGO: nessun elemento riconosciuto (obiettivo, tratto, personaggio, punto
     della scena, oggetto, spostamento) in una frase molto breve;
   - OBIETTIVI A PARI: due obiettivi aperti con lo stesso peso nel testo;
   - OBIETTIVO MANCANTE: nelle scene a obiettivi (non a semi), una frase
     lunga che non porta a nessun obiettivo.

   Scrive niente: ritorna un'analisi e, se serve, la domanda. Riusa il
   riconoscimento del regista drammaturgico (RMSoloDirector.interpret), le
   parole dei tratti del narratore e le scelte contestuali della scena
   (RMSoloScena). Con il modello, la proposta dell'IA resta quella del
   narratore (una sola chiamata): qui si controlla solo l'ambiguità.
   ========================================================================== */
(function (global) {
  'use strict';

  const E = () => global.RMSoloEngine;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  // un riferimento a una persona senza nome: pronome davanti al verbo («lo guardo»), «con lui/lei/loro» o un dimostrativo («quel tipo»)
  const VERBI_INTERAZIONE = '(parl|chied|domand|guard|osserv|segu|ferm|aiut|ascolt|avvicin|minacc|convinc|salut|affront|interrog|incalz|rassicur|ringrazi)';
  const PRONOMI = new RegExp('(^| )(lo|la|li|le|gli|loro) ' + VERBI_INTERAZIONE + '|' + VERBI_INTERAZIONE + '\\w* (con |a |per )?(lui|lei|loro)( |$)|(^| )(quel tipo|quella persona|quel tizio|quella tizia|qualcuno|costui|costei)( |$)');
  const A_PARI = 0.34;           // due obiettivi sono «a pari» se la differenza dei punteggi è minore di così
  const MAX_ALTERNATIVE = 3;

  // parole che non dicono nulla di una scena («faccio una cosa», «provo qualcosa»): non contano come riconoscimento
  const GENERICHE = ['cosa', 'cose', 'qualcosa', 'quella', 'quello', 'quelle', 'quelli', 'faccio', 'fare', 'fatto', 'provo', 'provare', 'tento', 'occupo', 'occupare', 'vedo', 'vediamo', 'allora', 'adesso', 'ancora', 'niente', 'tutto', 'tutti', 'ecco', 'bene', 'poco', 'molto', 'solo', 'anche', 'dopo', 'prima', 'questo', 'questa', 'queste', 'questi'];
  const radici = t => Array.from(new Set(norm(t).split(' ').filter(w => w.length >= 4 && GENERICHE.indexOf(w) === -1).map(w => w.slice(0, 5))));
  const nomeBreve = p => String((p && p.nome) || '').replace(/\s*\([^)]*\)/g, '').trim();

  /* Il tratto che il testo richiama con le sue parole; se non ne richiama nessuno e c'è un obiettivo, un tratto tipico
     che il personaggio possiede (suggerimento, non riconoscimento). */
  function trattoDa(state, content, testo, obiettivo) {
    const N = global.RMSoloNarrator, R = global.RMSoloRules;
    const t = norm(testo);
    let best = 'nessuno', n = 0;
    if (N && N.traitWords) Object.entries(N.traitWords(content, state)).forEach(([tr, ws]) => {
      const h = ws.filter(w => t.indexOf(w) !== -1).length;
      if (h > n && R.traitValue(state.personaggio, tr)) { n = h; best = tr; }
    });
    if (best === 'nessuno' && obiettivo) best = (obiettivo.tratti_tipici || []).find(x => R.traitValue(state.personaggio, x)) || 'nessuno';
    return best;
  }

  /* Comando equivalente a una scelta contestuale (lo stesso dei pulsanti della UI). */
  function comandoDaScelta(state, content, c, sc) {
    if (c.tipo === 'scelta') return { tipo: 'scelta', sceltaId: c.id };
    if (c.tipo === 'esplora') return { tipo: 'esplora', punto: c.id, sorgente: 'pulsante' };
    if (c.tipo === 'dialogo') return { tipo: 'dialogo_inizia', png: c.id, sorgente: 'pulsante' };
    if (c.tipo === 'argomento') return { tipo: 'battuta', argomento: c.id, sorgente: 'pulsante' };
    if (c.tipo === 'obiettivo') return { tipo: 'obiettivo_personale', sorgente: 'pulsante' };
    if (c.tipo === 'suggerimento') {
      const s = (sc.suggerimenti || [])[c.indice]; // indice originale (solo-scena.js, candidati)
      if (!s) return null;
      return { tipo: 'azione', sorgente: 'pulsante', testo: s.testo, proposta: { tipo: 'azione', obiettivo: s.obiettivo, tratto: s.tratto, oggetto: 'nessuno', qualita: 'normale' } };
    }
    return null;
  }

  /* Analisi di un testo libero. Ritorna { riconosciuto, obiettivi:[{id,punti,tratto}], png:[ids], chiarimento:null|{...} }. */
  function analizza(state, content, testo, opz) {
    const o = opz || {};
    const sc = E().currentScene(state, content);
    const io = E().interactionOptions && E().interactionOptions(state, content);
    const Dir = global.RMSoloDirector, IM = global.RMSoloImprov, ST = global.RMSoloStruttura, MP = global.RMSoloMappa;
    const t = norm(testo);
    const parole = t.split(' ').filter(Boolean);
    const int = Dir ? Dir.interpret(testo, state, content) : { targetType: 'nessuno', referencedEntities: [] };
    const presenti = (sc.png_presenti || []).filter(id => content.png[id]);
    // anche come la scena chiama il PNG («l'ombra» per lo spettro: RMSoloAzioni.aliasPng)
    const alias = id => (global.RMSoloAzioni && global.RMSoloAzioni.aliasPng ? global.RMSoloAzioni.aliasPng(state, content, id) : []).map(norm);
    const nominati = presenti.filter(id => (int.referencedEntities || []).indexOf(id) !== -1 || norm(nomeBreve(content.png[id])).split(' ').concat(alias(id)).some(w => w.length >= 3 && (' ' + t + ' ').indexOf(' ' + w + ' ') !== -1));
    const aperti = (sc.obiettivi || []).filter(x => !(state.obiettivi[x.id] && state.obiettivi[x.id].completato));
    const rad = new Set(radici(testo));
    const trattoTesto = trattoDa(state, content, testo, null);
    const obiettivi = aperti.map(ob => {
      const base = radici(ob.testo + ' ' + (ob.tag || []).join(' '));
      const tratto = trattoDa(state, content, testo, ob);
      // il tratto vale un punto solo se è richiamato dalle parole del testo, non se è solo il suggerimento per l'obiettivo
      const punti = base.filter(w => rad.has(w)).length + ((ob.tratti_tipici || []).indexOf(trattoTesto) !== -1 && trattoTesto !== 'nessuno' ? 1 : 0);
      return { id: ob.id, testo: ob.testo, punti, tratto };
    }).sort((a, b) => b.punti - a.punti);
    const tratto = trattoTesto;
    const esci = !!((ST && ST.intenzioneDiUscire && ST.intenzioneDiUscire(testo)) || (MP && MP.intenzioneDiViaggio && MP.intenzioneDiViaggio(testo)));
    const riconosciuto = parole.some(w => /\d/.test(w)) || nominati.length > 0 || int.targetType !== 'nessuno' || obiettivi.some(x => x.punti > 0) || tratto !== 'nessuno' || esci;
    const semi = !!(IM && IM.modoSemi(content));
    const res = { riconosciuto, obiettivi, png: nominati, tratto, chiarimento: null };
    if (o.forza || esci) return res;

    // 1. bersaglio: un pronome con più personaggi presenti e nessun nome
    if (presenti.length >= 2 && !nominati.length && PRONOMI.test(t)) {
      res.chiarimento = {
        motivo: 'bersaglio', domanda: 'A chi ti riferisci?',
        alternative: presenti.slice(0, MAX_ALTERNATIVE).map(id => ({ etichetta: nomeBreve(content.png[id]), fields: { tipo: 'improvvisa', sorgente: 'testo', testo: testo.replace(/[.!?]+$/, '') + ' (' + nomeBreve(content.png[id]) + ')' } }))
      };
      return res;
    }
    // 2. vago: niente di riconosciuto in una frase breve
    if (!riconosciuto && parole.length <= 5) {
      const alt = global.RMSoloScena ? global.RMSoloScena.scelte(state, content, io).scelte.filter(c => c.disponibile !== false).map(c => ({ etichetta: c.testo, fields: comandoDaScelta(state, content, c, sc) })).filter(a => a.fields) : [];
      res.chiarimento = { motivo: 'vago', domanda: 'Non è chiaro che cosa vuoi fare. Che cosa preferisci?', alternative: alt.slice(0, MAX_ALTERNATIVE) };
      if (!res.chiarimento.alternative.length) res.chiarimento.domanda = 'Non è chiaro che cosa vuoi fare: descrivilo meglio, e verso che cosa.';
      return res;
    }
    // 3. obiettivi a pari merito
    if (obiettivi.length >= 2 && obiettivi[0].punti >= 2 && obiettivi[0].punti - obiettivi[1].punti < A_PARI && !nominati.length) {
      const pari = obiettivi.filter(x => x.punti >= obiettivi[0].punti - 0.01).slice(0, MAX_ALTERNATIVE);
      if (pari.length >= 2) {
        res.chiarimento = {
          motivo: 'obiettivi_a_pari', domanda: 'Intendi puntare a una di queste cose?',
          alternative: pari.map(x => ({ etichetta: x.testo, fields: { tipo: 'azione', sorgente: 'testo', testo, proposta: { tipo: 'azione', obiettivo: x.id, tratto: x.tratto, oggetto: 'nessuno', qualita: 'normale' } } }))
        };
        return res;
      }
    }
    // 4. scene a obiettivi: una frase lunga che non porta a nessun obiettivo
    if (!semi && io && io.aperta && aperti.length && !obiettivi[0].punti && !nominati.length && int.targetType === 'nessuno' && parole.length >= 5) {
      // il testo non riguarda l'obiettivo: prima i presenti con cui si può parlare (dirlo a loro), poi gli obiettivi aperti
      const parlabili = (io.dialoghi || []).map(d => d.png).filter(id => presenti.indexOf(id) !== -1).slice(0, MAX_ALTERNATIVE - 1);
      // «a» + articolo del nome («Lo spettro» → allo spettro, «Il burattinaio» → al burattinaio, «Argus» → ad Argus)
      const PREP = { il: 'al ', lo: 'allo ', la: 'alla ', 'l\'': 'all\'', i: 'ai ', gli: 'agli ', le: 'alle ' };
      const a = id => { const n = nomeBreve(content.png[id]); const m = /^(il|lo|la|i|gli|le)\s+|^(l')/i.exec(n); return m ? PREP[(m[1] || m[2]).toLowerCase()] + n.slice(m[0].length) : (/^[aeiou]/i.test(n) ? 'ad ' : 'a ') + n; };
      res.chiarimento = {
        motivo: 'obiettivo_mancante', domanda: 'A quale scopo punta questa azione?',
        alternative: parlabili.map(id => ({ etichetta: 'Lo dico ' + a(id), png: id, cmds: [{ tipo: 'dialogo_inizia', png: id, sorgente: 'testo' }, { tipo: 'battuta', sorgente: 'testo', testo, testoGiocatore: testo }] }))
          .concat(obiettivi.slice(0, MAX_ALTERNATIVE - parlabili.length).map(x => ({ etichetta: x.testo, fields: { tipo: 'azione', sorgente: 'testo', testo, proposta: { tipo: 'azione', obiettivo: x.id, tratto: x.tratto, oggetto: 'nessuno', qualita: 'normale' } } })))
      };
    }
    return res;
  }

  global.RMSoloInterprete = { A_PARI, MAX_ALTERNATIVE, analizza, comandoDaScelta, trattoDa };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloInterprete;
})(typeof window !== 'undefined' ? window : globalThis);
