/* Domande libere ai PNG: scheda di conoscenze (docs/single-player/PNG_CONOSCENZE.md, approvata dall'autore).
   Nessun modello nel mezzo: il motore sceglie la voce pertinente, tira con le regole esistenti (RMSoloRules.resolveCheck)
   e scrive la risposta con i testi d'autore del livello raggiunto. Il Narratore le dà solo voce.
   Dati: js/solo/content/<storia>-conoscenze.json → { png: { <id>: { schede: [voce] } } }
   Voce: { id, scene?, argomenti[], livelli:{minimo,pieno,critico: [{testo, fonte}]}, difficolta:{tratto,nc}, devia:{testo,fonte},
           sensibile?, sblocco?:{flag|fatto}, semplice?, nonSa?:{testo,fonte}, fatto?: 'dettaglio_locale' | id di fatto,
           beat?: id dell'argomento o del passo da cui nasce (segnato come fatto quando la voce risponde) }
           tipi?: ['cosa','chi','perche','dove','come'] (a che tipo di domanda risponde la voce; assente = tutti),
           approcci?: [{tratto, nc}] (altri modi di chiedere: es. Intimidire)
   Tiro fallito: non si ritenta con lo stesso approccio (stesso tratto). Si riprova con un approccio diverso o quando la fiducia del PNG
   è salita dopo il fallimento (decisione dell'autore). Una domanda di un tipo che la voce non copre non dà un'altra informazione:
   il PNG risponde da personaggio (nonSa, altrimenti la deviazione). */
(function (global) {
  'use strict';
  const E = () => global.RMSoloEngine;
  const R = () => global.RMSoloRules;
  const TRATTI = ['Persuasione', 'Intimidire', 'Percezione'];
  const SOGLIA = 2; // punti di pertinenza: una frase d'argomento vale quante radici ha; una parola sola da sola non basta
  const LIVELLI = ['minimo', 'pieno', 'critico'];

  /* Tipo della domanda: la prima parola interrogativa del testo (cosa, chi, perche, dove, come). Senza parola interrogativa: null. */
  const TIPI = [['perche', /\b(perch[eé]|per quale motivo|come mai)(?![a-zà-ù])/], ['chi', /\b(chi|quale persona)\b/], ['dove', /\b(dove|in che luogo)\b/],
    ['come', /\b(come|in che modo|in che maniera)\b/], ['cosa', /\b(che cosa|cosa|cos'|che|quale|quali|quanto|quanti|quando)\b/]];
  function tipoDomanda(testo) {
    const t = String(testo || '').toLowerCase();
    let best = null;
    TIPI.forEach(([k, re]) => { const m = re.exec(t); if (m && (!best || m.index < best.i || (m.index === best.i && k === 'perche'))) best = { k, i: m.index }; });
    return best ? best.k : null;
  }

  // con lo stato, solo le voci dentro la loro finestra (legge 2 della regia, RMSoloEngine.finestra)
  const schede = (content, png, scena, state) => (((content.conoscenze || {}).png || {})[png] || {}).schede
    ? content.conoscenze.png[png].schede.filter(v => (!v.scene || !scena || v.scene.indexOf(scena) !== -1) && (!state || E().inFinestra(state, v))) : [];

  /* Punteggio di una voce per la frase del giocatore: somma delle radici delle frasi d'argomento presenti per intero. */
  function punteggio(voce, want) {
    return (voce.argomenti || []).reduce((s, a) => {
      const r = E().radici(a);
      return r.length && r.every(x => want.indexOf(x) !== -1) ? s + r.length : s;
    }, 0);
  }
  /* Voce scelta per la frase; `proposta` (id dal Regista IA) vale solo se esiste fra le voci del PNG presente. */
  function seleziona(content, png, testo, opz) {
    const lista = schede(content, png, opz && opz.scena, opz && opz.state);
    if (opz && opz.proposta) { const v = lista.find(x => x.id === opz.proposta); if (v) return { voce: v, punti: SOGLIA, proposta: true }; }
    // più domande in un messaggio: si risponde alla prima pertinente, le altre restano aperte
    const frasi = String(testo || '').split(/(?<=[?!.])\s+/).filter(f => f.trim());
    for (const frase of frasi.length ? frasi : [String(testo || '')]) {
      const want = E().radici(frase), tipo = tipoDomanda(frase);
      const copre = v => !tipo || !v.tipi || v.tipi.indexOf(tipo) !== -1;
      const c = lista.map(v => ({ voce: v, punti: punteggio(v, want) })).filter(x => x.punti >= SOGLIA)
        .sort((a, b) => (copre(b.voce) - copre(a.voce)) || b.punti - a.punti || (a.voce.argomenti || []).length - (b.voce.argomenti || []).length);
      // la voce è quella dell'argomento; se nessuna copre il tipo della domanda lo si segnala (il PNG risponderà da personaggio)
      if (c[0]) return Object.assign(c[0], { tipo, tipoDiverso: !copre(c[0].voce), frase });
    }
    return null;
  }

  const pezzi = l => (l || []).map(p => p.testo).join(' ');
  /* Testo d'autore del livello (cumulativo: il pieno comprende il minimo, il critico il pieno). */
  function testoLivello(voce, livello) {
    const fino = Math.min(livello, LIVELLI.length) - 1;
    return LIVELLI.slice(0, fino + 1).map(k => pezzi((voce.livelli || {})[k])).filter(Boolean).join(' ');
  }
  /* Approccio scelto per la frase: tratto indicato dall'interprete o dal tono, se la voce lo prevede; altrimenti quello base. */
  function approccio(v, tratto, tono) {
    const voluto = TRATTI.indexOf(tratto) !== -1 ? tratto : tono === 'minaccia' ? 'Intimidire' : null;
    const alt = (v.approcci || []).find(a => a.tratto === voluto);
    return alt || v.difficolta;
  }
  const fiducia = (state, png) => Number(((state.png || {})[png] || {}).atteggiamento) || 0;
  const sbloccata = (state, voce) => !voce.sblocco || (voce.sblocco.flag ? !!state.flags[voce.sblocco.flag] : (global.RMSoloComunicati ? global.RMSoloComunicati.noto(state, null, voce.sblocco.fatto) : (state.fattiScoperti || []).indexOf(voce.sblocco.fatto) !== -1));

  /* Risposta alla frase libera, o null se nessuna voce è pertinente (resta il comportamento di sempre).
     ctx: { state, content, png, m (memoria del dialogo), testo, dice, scena, proposta } */
  function rispondi(ctx) {
    const { state, content, png, m } = ctx;
    const sel = seleziona(content, png, ctx.testo, { scena: ctx.scena, proposta: ctx.proposta, state });
    if (!sel) return null;
    const v = sel.voce;
    m.conoscenze = m.conoscenze || {};
    const prima = m.conoscenze[v.id];
    // beat: id dell'argomento o del passo da cui nasce la voce; il motore lo segna quando la voce risponde (legge 3 della regia)
    const base = { voce: v.id, beat: v.beat || null, effetti: [], check: null, esito: null };
    if (v.nonSa && !v.livelli) return Object.assign(base, { testo: v.nonSa.testo, comportamento: 'devia', livello: 0 });
    // domanda di un tipo che la voce non copre (es. «chi» su una voce che spiega «cosa»): niente altra informazione, risponde da personaggio
    if (sel.tipoDiverso) return Object.assign(base, { testo: (v.nonSa || v.devia).testo, comportamento: 'devia', livello: 0, tipoDiverso: true });
    // approccio: il tratto con cui si chiede (Intimidire se la frase minaccia, altrimenti Persuasione; l'interprete può indicarlo)
    const tratto = approccio(v, ctx.tratto, ctx.tono);
    const fid = fiducia(state, png);
    // già detto: lo stesso livello, senza nuovo tiro
    if (prima && prima.livello) return Object.assign(base, { testo: String(((content.png || {})[png] || {}).nome || 'Il personaggio').split(' ')[0] + ' ti ha già detto quello che sa su questo.', comportamento: 'rivela', livello: prima.livello, gia: true });
    // già fallito: stesso approccio e fiducia non salita = la stessa deviazione, senza nuovo tiro
    if (prima && prima.tratto === tratto.tratto && fid <= prima.fiducia) return Object.assign(base, { testo: v.devia.testo, comportamento: 'devia', livello: 0, chiusa: true });
    let livello, check = null;
    if (!v.sensibile && v.semplice && fiducia(state, png) >= 1) livello = 1;
    else {
      // domanda del giocatore: prova volontaria (conferma e tiro visibile, 4/11/2026)
      const optsProva = { dice: ctx.dice, sheet: E().schedaConBonus ? E().schedaConBonus(state) : state.personaggio, trait: tratto.tratto, nc: tratto.nc, difficolta: state.difficolta };
      check = E().provaVolontaria ? E().provaVolontaria(optsProva, 'domanda a ' + ((content.png[png] || {}).nome || png)) : R().resolveCheck(optsProva);
      livello = { successo_critico: 3, successo_pieno: 2, successo: 1 }[check.esito] || 0;
      // un segreto non si rivela sotto il successo pieno e mai senza lo sblocco già previsto dai contenuti
      if (v.sensibile && (livello < 2 || !sbloccata(state, v))) livello = 0;
    }
    if (livello > 1 && !(v.livelli.critico || []).length) livello = Math.min(livello, 2);
    const effetti = [];
    if (check && check.esito === 'successo_critico') effetti.push({ relazione: { png, delta: 1 } });
    if (check && check.esito === 'fallimento_critico') effetti.push({ relazione: { png, delta: -1 } });
    const testo = livello ? testoLivello(v, livello) : v.devia.testo;
    if (livello && v.fatto) effetti.push({ nota: testo, categoria: 'indizio' });
    m.conoscenze[v.id] = { livello, esito: check ? check.esito : 'senza_tiro', tratto: tratto.tratto, fiducia: fid };
    return Object.assign(base, { testo, comportamento: livello ? 'rivela' : 'devia', livello, check, esito: check ? check.esito : null, effetti });
  }

  /* Controllo del contenuto: ogni testo d'autore esiste alla fonte indicata (nessun fatto nuovo) e le regole di compilazione sono rispettate. */
  function valida(conoscenze, fonti, content) {
    const err = [];
    const dentro = (path, testo) => {
      let o = fonti;
      for (const k of String(path).split('.')) { if (o == null) break; o = Array.isArray(o) ? o.find(x => x && (x.id === k || x.png === k)) : o[k]; }
      const senza = x => String(x).replace(/[«»]/g, '');
      return typeof o === 'string' && senza(o).indexOf(senza(testo)) !== -1;
    };
    const ids = {};
    Object.keys((conoscenze || {}).png || {}).forEach(png => {
      if (content && content.png && !content.png[png]) err.push(png + ': personaggio inesistente');
      ((conoscenze.png[png].schede) || []).forEach(v => {
        const q = png + '/' + v.id;
        if (!v.id || ids[v.id]) err.push(q + ': id mancante o duplicato');
        ids[v.id] = 1;
        if (!Array.isArray(v.argomenti) || !v.argomenti.length) err.push(q + ': argomenti mancanti');
        const testi = [].concat(v.devia ? [v.devia] : [], v.nonSa ? [v.nonSa] : [], LIVELLI.reduce((a, k) => a.concat((v.livelli || {})[k] || []), []));
        if (!v.devia && !v.nonSa) err.push(q + ': manca la deviazione');
        if (v.livelli && !(v.livelli.minimo || []).length) err.push(q + ': manca il livello minimo');
        (v.tipi || []).forEach(t => { if (['cosa', 'chi', 'perche', 'dove', 'come'].indexOf(t) === -1) err.push(q + ': tipo di domanda sconosciuto ' + t); });
        (v.approcci || []).forEach(a => { if (TRATTI.indexOf(a.tratto) === -1 || !Number.isFinite(a.nc)) err.push(q + ': approccio non valido'); });
        if (v.livelli && !v.tipi) err.push(q + ': indicare a quali tipi di domanda risponde (cosa, chi, perche, dove, come)');
        if (v.livelli && !(v.difficolta && TRATTI.indexOf(v.difficolta.tratto) !== -1 && Number.isFinite(v.difficolta.nc))) err.push(q + ': difficoltà non valida');
        testi.forEach(p => { if (!p.testo || !p.fonte) err.push(q + ': testo senza fonte'); else if (fonti && !dentro(p.fonte, p.testo)) err.push(q + ': il testo non è alla fonte ' + p.fonte + ': ' + p.testo.slice(0, 40)); });
        if (v.sensibile && !v.sblocco) err.push(q + ': un segreto richiede lo sblocco');
        if (v.fatto && v.fatto !== 'dettaglio_locale' && content && content.fatti && !content.fatti[v.fatto]) err.push(q + ': fatto inesistente ' + v.fatto);
        // un fatto proibito non compare in una voce non sensibile
        if (v.fatto && v.fatto !== 'dettaglio_locale' && content && content.fatti && content.fatti[v.fatto] && content.fatti[v.fatto].segreto && !v.sensibile) err.push(q + ': un fatto riservato richiede sensibile:true');
      });
    });
    return err;
  }

  global.RMSoloConoscenze = { tipoDomanda, approccio, schede, seleziona, rispondi, testoLivello, valida, SOGLIA, TRATTI };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloConoscenze;
})(typeof window !== 'undefined' ? window : globalThis);
