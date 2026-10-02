/* ==========================================================================
   Role Makers — Gioca in solitaria: pacchetti di contesto delle campagne.

   Un motore, una voce autoriale condivisa (voce-autore.json), tre pacchetti
   isolati: js/solo/content/<storia>-contesto.json, formato
   'rm-solo-contesto/1'. Il pacchetto dice CHE COSA si può raccontare in una
   campagna (timbro, tema, atti, metodo dell'autore per quella campagna,
   canone pubblico e riservato, PNG e loro voci, archi per archetipo,
   scala delle rivelazioni, limiti agli spoiler, testi di riserva, parole
   dell'interprete, limiti dell'improvvisazione).

   Ogni dato è un oggetto { v, fonte: [{ id, cita? }], classe, limite }:
   - `fonte` cita gli ID del manifesto (fonti-narrative.json); tipo di
     fonte, autorità e copertura si ricavano da lì (`traccia`), così non
     possono divergere;
   - `classe` è una delle classi epistemiche del manifesto;
   - un dato «incompleto» ha v = null: ciò che le fonti non dicono non si
     inventa.
   Una proposta non diventa mai canone: `promuovi` la rifiuta senza una
   decisione dell'autore registrata.

   Qui solo validazione e tracciabilità; la composizione del contesto per
   turno è più sotto (`perTurno`) e non carica mai i pacchetti delle altre
   campagne.
   ========================================================================== */
(function (global) {
  'use strict';

  const FORMATO = 'rm-solo-contesto/1';
  const CLASSI = ['canonico_pubblico', 'canonico_riservato', 'conoscibile', 'deducibile', 'specifico_partita', 'proposta', 'incompleto'];
  const CANONICHE = ['canonico_pubblico', 'canonico_riservato', 'conoscibile', 'deducibile'];
  const ASPETTI = ['costruzioneAtti', 'aperturaCapitoli', 'chiusuraCapitoli', 'ritmo', 'alternanza', 'scene', 'spostamenti', 'introduzionePng', 'rapporti', 'sottotesto', 'presagi', 'informazioni', 'rivelazioni', 'conflitti', 'combattimenti', 'aftermath', 'trasformazioni', 'archi', 'temi', 'secondari', 'deviazioni', 'ricongiungimenti', 'decisioniConseguenze', 'vocePng', 'variazioni'];
  const SEZIONI = ['copertura', 'timbro', 'tema', 'atti', 'metodo', 'canone', 'profiliPng', 'antagonisti', 'archiArchetipo', 'rivelazioni', 'limitiSpoiler', 'fili', 'riserva', 'interpreteParole', 'improvvisazione', 'strutturaLunga', 'collegamentiRiservati', 'incompleti'];
  const PREFISSI = { eidos: ['EID-', 'IMP-EIDOS-'], ich: ['ICH-', 'IMP-ICH-'], icaro: ['ICA-', 'IMP-ICARO-'] };
  const TRASVERSALI = /^(AUT-\d+|PRM-\d+|IMP-(?:MOTORE|ONTOLOGIA|FEEDBACK|NARRATORE)|VA-\d+)$/;

  const isDato = x => !!(x && typeof x === 'object' && !Array.isArray(x) && 'v' in x && 'classe' in x && Array.isArray(x.fonte));

  // tutti i dati del pacchetto con il loro percorso
  function dati(pkg) {
    const out = [];
    (function walk(o, p) {
      if (isDato(o)) { out.push([p, o]); return; }
      if (Array.isArray(o)) o.forEach((x, i) => walk(x, p + '[' + i + ']'));
      else if (o && typeof o === 'object') Object.keys(o).forEach(k => walk(o[k], p ? p + '.' + k : k));
    })(pkg, '');
    return out;
  }
  function stringhe(v) {
    const out = [];
    (function walk(o) { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') Object.keys(o).forEach(k => walk(o[k])); })(v);
    return out;
  }
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ǫ/g, 'o').toLowerCase();

  function fonteDellaCampagna(storia, id) { return (PREFISSI[storia] || []).some(p => String(id).indexOf(p) === 0); }

  /* Tracciabilità completa di un dato: fonte, campagna, tipo di fonte,
     autorità, copertura, classificazione, limite. */
  function traccia(pkg, d, manifesto) {
    const idx = indice(manifesto);
    const f = (d.fonte || []).map(x => idx[x.id] || { id: x.id, tipo: /^VA-/.test(x.id) ? 'voce_autoriale' : 'sconosciuto' });
    return {
      fonte: (d.fonte || []).map(x => x.id + (x.cita ? ' «' + x.cita + '»' : '')),
      campagna: pkg.storia,
      tipoFonte: Array.from(new Set(f.map(x => x.tipo))),
      autorita: f.length ? Math.min.apply(null, f.map(x => x.autorita || 99)) : null,
      copertura: Array.from(new Set(f.map(x => x.copertura).filter(Boolean))),
      classe: d.classe,
      limite: d.limite == null ? null : d.limite
    };
  }
  const _idx = new WeakMap();
  function indice(manifesto) {
    if (!manifesto) return {};
    if (_idx.has(manifesto)) return _idx.get(manifesto);
    const m = {};
    [].concat(manifesto.fonti || [], manifesto.decisioni || [], manifesto.implementazione || []).forEach(f => { m[f.id] = f; });
    _idx.set(manifesto, m);
    return m;
  }

  /* Validazione. opts: { manifesto, content (campagna di gioco),
     archetipi, struttura, altri: { storia: [termini esclusivi] } } */
  function valida(pkg, opts) {
    const E = [];
    const o = opts || {};
    if (!pkg || pkg.formato !== FORMATO) return ['formato: atteso ' + FORMATO];
    if (!PREFISSI[pkg.storia]) E.push('storia sconosciuta: ' + pkg.storia);
    SEZIONI.forEach(s => { if (pkg[s] == null) E.push('sezione mancante: ' + s); });
    ASPETTI.forEach(a => { if (!isDato((pkg.metodo || {})[a])) E.push('metodo: aspetto mancante ' + a); });
    const idx = indice(o.manifesto);
    dati(pkg).forEach(([p, d]) => {
      if (CLASSI.indexOf(d.classe) === -1) E.push(p + ': classe ' + d.classe);
      if (d.classe === 'incompleto' && d.v != null) E.push(p + ': un dato incompleto non ha valore');
      if (d.classe !== 'incompleto' && d.v == null) E.push(p + ': valore nullo senza classe incompleto');
      if (d.classe !== 'incompleto' && !d.fonte.length) E.push(p + ': nessuna fonte');
      d.fonte.forEach(f => {
        if (!f || !f.id) { E.push(p + ': fonte senza id'); return; }
        if (!fonteDellaCampagna(pkg.storia, f.id) && !TRASVERSALI.test(f.id)) E.push(p + ': fonte di un\'altra campagna ' + f.id);
        if (o.manifesto && !/^VA-/.test(f.id) && !idx[f.id]) E.push(p + ': fonte non nel manifesto ' + f.id);
      });
      if (CANONICHE.indexOf(d.classe) !== -1) {
        // il canone poggia su un originale della campagna (autorità 1-5), mai solo su un derivato
        const orig = d.fonte.filter(f => /^(EID|ICH|ICA)-/.test(f.id) && fonteDellaCampagna(pkg.storia, f.id));
        if (!orig.length && !d.fonte.some(f => /^AUT-/.test(f.id))) E.push(p + ': ' + d.classe + ' senza fonte originale della campagna');
        if (o.manifesto) orig.forEach(f => { const s = idx[f.id]; if (s && (s.autorita == null || s.autorita > 5)) E.push(p + ': ' + f.id + ' non è una fonte originale utilizzabile'); });
      }
    });
    // isolamento: nessun termine esclusivo di un'altra campagna
    Object.entries(o.altri || {}).forEach(([storia, termini]) => {
      if (storia === pkg.storia) return;
      const tutto = norm(stringhe(pkg).join(' \n '));
      termini.forEach(t => { if (new RegExp('\\b' + norm(t.radice) + (/(eporian|reionizzat|bunny-hopper)$/.test(t.radice) ? '' : '\\b')).test(tutto)) E.push('termine di ' + storia + ' nel pacchetto: ' + t.termine); });
    });
    // copertura dei dati della campagna di gioco
    if (o.content) {
      Object.keys(o.content.png || {}).forEach(id => { if (!(pkg.profiliPng || {})[id]) E.push('profiliPng: manca ' + id); });
      const segreti = Object.keys(o.content.fatti || {}).filter(k => o.content.fatti[k].segreto && !/magia/.test(k));
      const scala = ((pkg.rivelazioni || {}).scala || {}).v || [];
      segreti.forEach(k => { if (!scala.some(r => r.fatto === k)) E.push('rivelazioni: segreto fuori dalla scala ' + k); });
      scala.forEach(r => { if (!o.content.fatti[r.fatto]) E.push('rivelazioni: fatto inesistente ' + r.fatto); (r.dopo || []).forEach(x => { if (!scala.some(y => y.fatto === x)) E.push('rivelazioni: prerequisito fuori scala ' + x); }); });
    }
    (o.archetipi || []).forEach(a => { if (!(pkg.archiArchetipo || {})[a.id]) E.push('archiArchetipo: manca ' + a.id); });
    ['spostamento'].forEach(c => { const r = (pkg.riserva || {})[c]; if (!isDato(r) || !(r.v || []).length) E.push('riserva: manca ' + c); });
    if (!isDato(pkg.interpreteParole)) E.push('interpreteParole mancante');
    ['ammesso', 'vietato'].forEach(k => { if (!((pkg.improvvisazione || {})[k] || []).length) E.push('improvvisazione.' + k + ' vuoto'); });
    return E;
  }

  /* Una proposta diventa canone solo con una decisione dell'autore
     registrata nel manifesto (livello 1). */
  function promuovi(d, decisioneId, manifesto) {
    const dec = (manifesto && manifesto.decisioni || []).find(x => x.id === decisioneId);
    if (!d || d.classe !== 'proposta') throw new Error('solo una proposta può essere promossa');
    if (!dec) throw new Error('promozione a canone senza decisione dell\'autore');
    return Object.assign({}, d, { classe: 'canonico_pubblico', fonte: d.fonte.concat([{ id: decisioneId }]) });
  }


  /* ------------------------------------------------ contesto per turno

     Solo il pacchetto della campagna attiva (content.contesto, caricato
     per quella storia e nessun'altra) e solo ciò che serve al turno:
     timbro/tema e leggi pubbliche, atto, arco del protagonista, voci dei
     PNG presenti, limiti agli spoiler e divieti dell'improvvisazione.
     Mai il canone riservato, i collegamenti fra campagne, le menzogne dei
     PNG o la scala delle rivelazioni; mai lessico ancora bloccato. */
  const ORDINE_TURNO = ['regole invarianti', 'voce autoriale condivisa', 'contesto della campagna attiva', 'atto, macro-capitolo e funzione della scena', 'arco personale', 'luogo', 'PNG e avversari presenti', 'memoria pertinente', 'conseguenze attive', 'conoscenze disponibili', 'segreti ammessi', 'limiti agli spoiler', 'esito del motore'];
  function attivo(content) {
    const c = content && content.contesto;
    return c && c.formato === FORMATO && c.storia === content.storia ? c : null;
  }
  function perTurno(state, content, opts) {
    const pkg = attivo(content);
    if (!pkg) return null;
    const C = global.RMSoloCampaign;
    const locked = C ? C.lockedLexicon(state, content) : [];
    const ok = d => d && d.v != null && d.classe !== 'incompleto' && d.classe !== 'canonico_riservato' && d.classe !== 'specifico_partita';
    const pulito = t => typeof t === 'string' && !(C && locked.length && C.lexiconHits(t, locked).length);
    const val = d => ok(d) && pulito(d.v) ? d.v : null;
    const lista = (arr, max) => (arr || []).map(val).filter(Boolean).slice(0, max || 99);
    const atto = String((state && state.atto) || 1);
    const A = (pkg.atti || {})[atto] || {};
    const arch = state && state.personaggio ? (pkg.archiArchetipo || {})[state.personaggio.archetipo] : null;
    const arco = arch ? Object.keys(arch).filter(k => k !== 'modello').map(k => {
      const d = arch[k]; if (!ok(d)) return null;
      const v = Array.isArray(d.v) ? d.v.map(x => x.difetto ? x.difetto + ' (' + x.traiettoria + ')' : x).join('; ') : d.v;
      return pulito(v) ? k + ': ' + v : null;
    }).filter(Boolean) : [];
    const presenti = (opts && opts.presenti) || [];
    const png = presenti.map(id => {
      const p = (pkg.profiliPng || {})[id]; if (!p) return null;
      const f = [val(p.voce.registro), val(p.voce.tic) && 'tic: ' + p.voce.tic.v, val(p.voce.sottoPressione) && 'sotto pressione: ' + p.voce.sottoPressione.v, val(p.conoscenze.reticenze) && 'evita: ' + p.conoscenze.reticenze.v].filter(Boolean);
      return f.length ? { id, nome: p.nome, voce: f.join('; ') } : null;
    }).filter(Boolean);
    return {
      storia: pkg.storia,
      campagna: { timbro: pkg.timbro && pkg.timbro.nome, tesi: val(pkg.tema && pkg.tema.tesi), antitesi: val(pkg.tema && pkg.tema.antitesi), leggi: lista(pkg.canone && pkg.canone.leggi, 4) },
      atto: { numero: Number(atto), funzione: val(A.funzione), domanda: val(A.domanda) },
      arco: arco,
      modelloArco: arch ? val(arch.modello) : null,
      png: png,
      limitiSpoiler: lista(pkg.limitiSpoiler),
      vietato: lista(pkg.improvvisazione && pkg.improvvisazione.vietato),
      ammesso: lista(pkg.improvvisazione && pkg.improvvisazione.ammesso, 3)
    };
  }
  function testoTurno(t, parti) {
    if (!t) return '';
    const vuole = k => !parti || parti.indexOf(k) !== -1;
    const L = [];
    if (vuole('campagna')) {
      L.push('CONTESTO DELLA CAMPAGNA (' + t.storia + (t.campagna.timbro ? ' — ' + t.campagna.timbro : '') + '):');
      if (t.campagna.tesi) L.push('- tesi: ' + t.campagna.tesi);
      if (t.campagna.antitesi) L.push('- antitesi: ' + t.campagna.antitesi);
      t.campagna.leggi.forEach(x => L.push('- ' + x));
    }
    if (vuole('atto') && (t.atto.funzione || t.atto.domanda)) L.push('ATTO ' + t.atto.numero + ': ' + [t.atto.funzione, t.atto.domanda && 'domanda: ' + t.atto.domanda].filter(Boolean).join(' — '));
    if (vuole('arco') && t.arco.length) L.push('ARCO DEL PROTAGONISTA' + (t.modelloArco ? ' (' + t.modelloArco + ')' : '') + ': ' + t.arco.join(' | '));
    if (vuole('png') && t.png.length) L.push('VOCI DEI PNG PRESENTI:\n' + t.png.map(p => '- ' + p.nome + ': ' + p.voce).join('\n'));
    if (vuole('limiti')) {
      if (t.limitiSpoiler.length) L.push('LIMITI AGLI SPOILER: ' + t.limitiSpoiler.join(' '));
      if (t.vietato.length) L.push('NON INVENTARE: ' + t.vietato.join(' '));
    }
    return L.join('\n');
  }

  global.RMSoloContesto = { ORDINE_TURNO, attivo, perTurno, testoTurno, FORMATO, CLASSI, CANONICHE, ASPETTI, SEZIONI, isDato, dati, traccia, valida, promuovi, fonteDellaCampagna };
})(typeof window !== 'undefined' ? window : globalThis);
