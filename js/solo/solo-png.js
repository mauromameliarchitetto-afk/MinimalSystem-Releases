/* Single player — PNG: schede, voce, funzione tematica, comportamento nel
   dialogo, evoluzione e morte convalidata (campagna lunga).

   Tutto è DERIVATO dallo stato: nessun tiro casuale decide alleanze,
   rotture, tradimenti o morti. Le schede vengono da <storia>-struttura.json
   (solo dati esistenti; i campi non approvati restano null e non vengono
   inventati). La scala del rapporto è l'atteggiamento del motore con le
   soglie già usate dal Diario (RMSoloImprov.disposizione). */
(function (global) {
  'use strict';
  const IM = () => global.RMSoloImprov;
  const E = () => global.RMSoloEngine;

  const LEGAMI = ['neutro', 'alleato', 'rotto', 'traditore', 'antagonista', 'abbandonato'];
  const COMPORTAMENTI = ['rivela', 'coopera', 'conferma', 'devia', 'mente', 'tace', 'chiede_in_cambio', 'sfida', 'minaccia'];
  const CAUSE_MORTE = ['scontro', 'sacrificio', 'conseguenza', 'esecuzione', 'incidente'];

  function scheda(content, id) { return (content.struttura && content.struttura.png && content.struttura.png[id]) || null; }
  function voce(content, id) { const s = scheda(content, id); return s ? s.voce : null; }

  function registro(state) {
    const c = state.campagna || (state.campagna = {});
    c.png = c.png || {};
    return c.png;
  }
  function dinamico(state, id) {
    const r = registro(state);
    if (!r[id]) r[id] = { stato: 'vivo', legame: 'neutro', eventi: [], ultimaInterazione: null, macroInterazioni: [] };
    return r[id];
  }

  /* Posizione tematica: vettore degli assi che il PNG difende (dalle scelte
     che lo coinvolgono) confrontato con la tesi del protagonista (gli assi
     spostati dalle sue scelte). Prodotto scalare: >0 affine, <0 opposta. */
  function vettorePng(content, id) { const s = scheda(content, id); return (s && s.funzione.posizioneTematica && s.funzione.posizioneTematica.assi) || null; }
  function allineamento(state, content, id) {
    const v = vettorePng(content, id);
    if (!v) return { tipo: 'ignota', valore: 0 };
    const tesi = state.assiGrezzi || state.assi || {};
    let dot = 0;
    Object.keys(v).forEach(k => { dot += (Number(tesi[k]) || 0) * v[k]; });
    return { tipo: dot > 0 ? 'affine' : dot < 0 ? 'opposta' : 'neutra', valore: dot };
  }
  /* Funzione dialettica corrente: antitesi (posizione opposta alla tesi del
     protagonista), alleato tematico (affine), specchio (affine ma con un
     rapporto conflittuale: mostra il costo della stessa idea), neutra. */
  function funzioneDialettica(state, content, id) {
    const a = allineamento(state, content, id);
    const disp = IM() ? IM().disposizione(state, content, id) : 'neutro';
    if (a.tipo === 'opposta') return 'antitesi';
    if (a.tipo === 'affine') return disp === 'ostilita' || disp === 'diffidenza' ? 'specchio' : 'alleato_tematico';
    return 'neutra';
  }

  /* Scelta del comportamento nel dialogo: dipende da ciò che il PNG sa, da
     ciò che il protagonista sa già, dal rapporto, dal legame, dalla
     posizione tematica e dal metodo usato. Mai casuale; mai un segreto
     proibito rivelato. */
  function sceltaDialogo(state, content, id, ctx) {
    ctx = ctx || {};
    const d = dinamico(state, id);
    if (d.stato !== 'vivo') return { comportamento: null, motivo: 'non disponibile: ' + d.stato };
    const s = scheda(content, id);
    const disp = IM() ? IM().disposizione(state, content, id) : 'neutro';
    const noti = new Set(state.fattiScoperti || []);
    const fatto = ctx.fatto || null;
    const metodo = String(ctx.metodo || '').toLowerCase();
    const pressione = /minacc|intimid|costring|forz/.test(metodo);
    const scambio = /promess|scamb|offr|pag|favore/.test(metodo);
    const proibiti = s ? s.conoscenze.segretiProibiti : [];
    const conosce = s ? s.conoscenze.fattiConosciuti.concat(proibiti) : ((content.png[id] || {}).sa || []);
    const allin = allineamento(state, content, id).tipo;
    const motivi = [];
    let c;
    if (d.legame === 'traditore') { c = 'mente'; motivi.push('ha tradito: protegge la propria scelta'); }
    else if (fatto && proibiti.indexOf(fatto) !== -1 && !noti.has(fatto)) {
      c = disp === 'ostilita' || disp === 'diffidenza' ? 'mente' : 'devia'; motivi.push('segreto che non può rivelare');
    } else if (fatto && noti.has(fatto) && conosce.indexOf(fatto) !== -1) {
      c = disp === 'ostilita' ? 'sfida' : 'conferma'; motivi.push('il protagonista lo sa già');
    } else if (fatto && conosce.indexOf(fatto) === -1) {
      c = disp === 'ostilita' ? 'tace' : 'devia'; motivi.push('non lo sa');
    } else if (pressione) {
      c = disp === 'ostilita' || d.legame === 'antagonista' ? 'minaccia' : disp === 'fiducia_piena' ? 'coopera' : 'chiede_in_cambio'; motivi.push('reagisce alla pressione');
    } else if (allin === 'opposta' && disp !== 'fiducia_piena') {
      c = 'sfida'; motivi.push('difende una posizione opposta');
    } else if (disp === 'fiducia_piena' || disp === 'fiducia' || d.legame === 'alleato') {
      c = fatto ? 'rivela' : 'coopera'; motivi.push('fiducia');
    } else if (disp === 'ostilita' || d.legame === 'rotto') {
      c = 'tace'; motivi.push('ostilità');
    } else {
      c = scambio ? 'coopera' : 'chiede_in_cambio'; motivi.push('rapporto neutro');
    }
    return { comportamento: c, motivo: motivi.join('; '), disposizione: disp, legame: d.legame, allineamento: allin, voce: s ? s.voce : null };
  }

  function registraInterazione(state, id, macro, evN) {
    const d = dinamico(state, id);
    d.ultimaInterazione = evN;
    if (d.macroInterazioni.indexOf(macro) === -1) d.macroInterazioni.push(macro);
  }

  /* Evoluzione derivata (dopo ogni comando). Ogni cambio di legame ha le
     sue cause, tutte leggibili nello stato:
     - alleanza: rapporto almeno "fiducia" (atteggiamento ≥ 2) e posizione
       non opposta;
     - rottura: rapporto "diffidenza" o peggio dopo un'alleanza, oppure
       "ostilità";
     - tradimento: era alleato, la tesi del protagonista si è mossa contro i
       suoi valori (allineamento ≤ −2) E c'è un torto registrato (promessa
       infranta o rapporto calato dopo l'alleanza);
     - antagonista: rottura + posizione opposta;
     - abbandono: alleato ignorato per due macro-capitoli in cui era presente. */
  function evolvi(state, content, macro, evN, applied) {
    const out = [];
    const macroVisti = ((state.campagna || {}).storico || []).map(h => h.macro);
    Object.keys(content.png || {}).forEach(id => {
      const d = dinamico(state, id);
      if (d.stato !== 'vivo') return;
      const att = Number(((state.png || {})[id] || {}).atteggiamento) || 0;
      const al = allineamento(state, content, id);
      const promesseInfrante = ((state.sociale || {}).promesse || []).filter(p => p.png === id && ['infranta', 'tradita', 'mancata'].indexOf(p.stato) !== -1);
      const prima = d.legame;
      const cause = [];
      let nuovo = prima;
      if (prima === 'neutro' && att >= 2 && al.tipo !== 'opposta') { nuovo = 'alleato'; cause.push('rapporto di fiducia', 'posizione ' + al.tipo); d.attAlleanza = att; }
      else if (prima === 'alleato') {
        const calo = d.attAlleanza != null && att < d.attAlleanza;
        if (al.valore <= -2 && (promesseInfrante.length || calo)) { nuovo = 'traditore'; cause.push('tesi del protagonista contro i suoi valori (' + al.valore + ')', promesseInfrante.length ? 'promessa infranta' : 'rapporto incrinato'); }
        else if (att <= -1) { nuovo = 'rotto'; cause.push('rapporto deteriorato dopo l\'alleanza'); }
        else {
          const presenti = macroVisti.slice(-3, -1).filter(m => ((E().sceneOf(content, m) || {}).png_presenti || []).indexOf(id) !== -1);
          if (presenti.length >= 2 && presenti.every(m => d.macroInterazioni.indexOf(m) === -1)) { nuovo = 'abbandonato'; cause.push('ignorato per due capitoli in cui era presente'); }
        }
      } else if ((prima === 'neutro' || prima === 'abbandonato') && att <= -3) { nuovo = 'rotto'; cause.push('ostilità'); }
      if (nuovo === 'rotto' && al.tipo === 'opposta') { nuovo = 'antagonista'; cause.push('posizione opposta'); }
      if (nuovo !== prima) {
        d.legame = nuovo;
        const e = { tipo: 'legame', da: prima, a: nuovo, cause, macro, evento: evN };
        d.eventi.push(e);
        out.push(Object.assign({ png: id }, e));
        if (applied) applied.push({ tipo: 'png_legame', png: id, da: prima, a: nuovo, cause });
      }
    });
    return out;
  }

  /* Morte di un PNG: solo con una causa diegetica presente nello stato e
     mai se il PNG è indispensabile a ciò che resta della trama (presente in
     macro-capitoli futuri o nominato dalle condizioni dei finali). */
  function indispensabile(state, content, id) {
    const visti = new Set(((state.campagna || {}).storico || []).map(h => h.macro).concat([state.scena]));
    const futuri = (content.scene || []).filter(s => !visti.has(s.id) && (s.png_presenti || []).indexOf(id) !== -1).map(s => s.id);
    const k = (content.contratto && content.contratto.ending_contract) || content.ending_contract || {};
    const inFinali = JSON.stringify(k.variants || []).indexOf('"png":"' + id + '"') !== -1;
    return { si: futuri.length > 0 || inFinali, futuri, inFinali };
  }
  function validaMorte(state, content, id, causa) {
    if (!content.png || !content.png[id]) return { ok: false, motivo: 'PNG inesistente' };
    const d = dinamico(state, id);
    if (d.stato !== 'vivo') return { ok: false, motivo: 'già ' + d.stato };
    if (!causa || CAUSE_MORTE.indexOf(causa.tipo) === -1) return { ok: false, motivo: 'causa diegetica mancante o non prevista' };
    const sc = E().currentScene(state, content) || {};
    if ((sc.png_presenti || []).indexOf(id) === -1) return { ok: false, motivo: 'non è presente' };
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const pericolo = !!(state.incontro || (it && (it.incontroInAttesa || it.sceltaIncontro || it.pressioneMassima)) || (state.conseguenze || []).some(c => c.stato === 'applicata' && c.eventoApplicazione != null));
    if ((causa.tipo === 'scontro' || causa.tipo === 'incidente') && !pericolo) return { ok: false, motivo: 'nessun pericolo in atto che possa causarla' };
    if (!causa.descrizione) return { ok: false, motivo: 'causa senza descrizione' };
    const ind = indispensabile(state, content, id);
    if (ind.si) return { ok: false, motivo: 'indispensabile alla trama: ' + (ind.futuri.length ? 'compare in ' + ind.futuri.join(', ') : 'condizioni dei finali') };
    return { ok: true };
  }
  function applicaMorte(state, content, id, causa, evN, applied) {
    const v = validaMorte(state, content, id, causa);
    if (!v.ok) return v;
    const d = dinamico(state, id);
    d.stato = 'morto';
    d.eventi.push({ tipo: 'morte', causa: causa.tipo, descrizione: causa.descrizione, macro: state.scena, evento: evN });
    if (applied) applied.push({ tipo: 'png_morte', png: id, causa: causa.tipo });
    return v;
  }

  function vista(state, content, id) {
    const s = scheda(content, id);
    const d = dinamico(state, id);
    return { id, nome: (content.png[id] || {}).nome, stato: d.stato, legame: d.legame, funzione: funzioneDialettica(state, content, id), allineamento: allineamento(state, content, id).tipo, valore: s ? s.funzione.valoreDifeso : null, voce: s && s.voce ? { lunghezza: s.voce.lunghezzaMediaBattuta, formalita: s.voce.formalita, parole: s.voce.paroleRicorrenti.slice(0, 4), esempio: s.voce.esempi[0] || null } : null };
  }

  /* Tre livelli distinti: struttura formalmente valida, scheda utilizzabile
     in gioco (dialogo, dialettica, evoluzione), scheda incompleta da
     approvare (campi senza evidenza nei materiali). */
  const CAMPI = ['identita.descrizione', 'psicologia.obiettivo', 'psicologia.convinzione', 'psicologia.bisogno', 'psicologia.paura', 'psicologia.contraddizione', 'psicologia.segreto', 'funzione.posizioneTematica', 'voce'];
  const leggi = (o, p) => p.split('.').reduce((x, k) => x == null ? null : x[k], o);
  function valutaScheda(sh) {
    const valida = !!(sh && sh.identita && sh.psicologia && sh.conoscenze && sh.funzione && 'voce' in sh);
    const mancano = valida ? CAMPI.filter(f => leggi(sh, f) == null) : CAMPI.slice();
    const utilizzabile = valida && !!leggi(sh, 'psicologia.obiettivo') && !!leggi(sh, 'funzione.posizioneTematica') && !!sh.voce && !!leggi(sh, 'identita.descrizione') && ['convinzione', 'bisogno', 'paura'].some(f => leggi(sh, 'psicologia.' + f));
    return { valida, utilizzabile, incompleta: mancano.length > 0, campiMancanti: mancano };
  }
  function classifica(content, id) {
    const s = scheda(content, id);
    if (!s) return { valida: false, utilizzabile: false, incompleta: true, campiMancanti: ['scheda'] };
    return valutaScheda(s);
  }

  global.RMSoloPng = {
    LEGAMI, COMPORTAMENTI, CAUSE_MORTE,
    scheda, voce, dinamico, allineamento, funzioneDialettica, sceltaDialogo, registraInterazione,
    evolvi, indispensabile, validaMorte, applicaMorte, vista, classifica, valutaScheda
  };
})(typeof window !== 'undefined' ? window : globalThis);
