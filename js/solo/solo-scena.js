/* Role Makers — Gioca in solitaria: ingresso in scena, scelte contestuali e percezione passiva (Fase 4).

   - INGRESSO IN SCENA: prima delle scelte il giocatore (e il narratore) sa dove si trova, chi c'è e che cosa
     sta facendo ciascuno: luogo, presenti, posizione e attività (dati: js/solo/content/<storia>-scena.json,
     generati da scripts/data/solo-scena.js).
   - SCELTE CONTESTUALI: al massimo tre alla volta, scelte per priorità (le decisioni della scena, i passaggi
     richiesti per proseguire, i suggerimenti legati agli obiettivi aperti, il resto); la scrittura libera c'è
     sempre. Le altre possibilità riappaiono man mano che le prime si esauriscono.
   - PERCEZIONE PASSIVA: all'ingresso in scena il motore confronta, in silenzio e senza dadi, il tratto del
     protagonista con i dettagli nascosti della scena: passivo = 10 + valore del tratto (nessuna competenza = 10)
     contro la NC della scena (con la difficoltà della partita). Il risultato si salva una volta sola in
     state.percezioni[scena]; al narratore passano solo i dettagli notati. Un dettaglio notato è colore
     narrativo: non diventa un fatto scoperto e non entra nel diario (decisione presa al posto dell'autore).

   Logica pura (nessun DOM), testabile in Node. Mai verità riservate né lessico ancora bloccato. */
(function (global) {
  'use strict';

  const FORMATO = 'rm-solo-scena/1';
  const MAX_SCELTE = 3;
  const BASE_PASSIVA = 10;
  const R = () => global.RMSoloRules;
  const C = () => global.RMSoloCampaign;
  const E = () => global.RMSoloEngine;

  const dati = content => (content && content.scena && content.scena.formato === FORMATO ? content.scena : null);
  const datiScena = (content, id) => { const d = dati(content); return d && d.scene[id] ? d.scene[id] : null; };
  function pulitore(state, content) {
    const rules = C() && state ? C().lockedLexicon(state, content) : [];
    return t => typeof t === 'string' && t.trim() && !(C() && rules.length && C().lexiconHits(t, rules).length);
  }

  /* ------------------------------------------------------ ingresso in scena */
  function ingresso(state, content, sceneId) {
    const id = sceneId || state.scena;
    const sc = E().sceneOf(content, id), d = datiScena(content, id);
    if (!sc || !d) return null;
    const pulito = pulitore(state, content);
    const presenti = (sc.png_presenti || []).map(pid => {
      const p = content.png[pid], x = d.png && d.png[pid];
      if (!p || !x || (state && !E().inFinestra(state, x))) return null;
      return { id: pid, nome: p.nome, ruolo: p.ruolo, posizione: pulito(x.posizione) ? x.posizione : null, attivita: pulito(x.attivita) ? x.attivita : null };
    }).filter(Boolean);
    return {
      scena: id, titolo: sc.titolo, luogo: sc.luogo,
      protagonista: { posizione: pulito(d.protagonista.posizione) ? d.protagonista.posizione : null, attivita: pulito(d.protagonista.attivita) ? d.protagonista.attivita : null },
      presenti
    };
  }
  /* Testo semplice dell'ingresso (anche per il narratore): luogo, poi il protagonista, poi i presenti. */
  function testoIngresso(ing) {
    if (!ing) return '';
    const L = ['Luogo: ' + ing.luogo + '.'];
    if (ing.protagonista.posizione) L.push(ing.protagonista.posizione + (ing.protagonista.attivita ? ': ' + ing.protagonista.attivita : '') + '.');
    L.push(ing.presenti.length ? 'Presenti: ' + ing.presenti.map(p => p.nome + (p.posizione ? ', ' + p.posizione : '') + (p.attivita ? ', ' + p.attivita : '')).join('; ') + '.' : 'Nessun altro è presente.');
    return L.join(' ');
  }

  /* ------------------------------------------------------ percezione passiva */
  function passivo(pg, tratto) {
    const tv = R().traitValue(pg, tratto);
    return BASE_PASSIVA + (tv ? tv.value : 0);
  }
  /* Registra (una sola volta per scena) i dettagli notati. Idempotente, senza dadi: non sposta mai la
     sequenza dei tiri della partita. */
  function percepisci(state, content, sceneId) {
    const id = sceneId || state.scena;
    const d = datiScena(content, id);
    if (!d || !(d.percepibili || []).length) return null;
    state.percezioni = state.percezioni || {};
    if (state.percezioni[id]) return state.percezioni[id];
    const rec = { notati: [], passivi: {} };
    d.percepibili.forEach(p => {
      const nc = R().ncFor(p.nc, state.difficolta);
      const v = passivo(state.personaggio, p.tratto);
      const ok = v >= nc;
      rec.passivi[p.id] = { tratto: p.tratto, valore: v, nc, notato: ok };
      if (ok) rec.notati.push(p.id);
    });
    state.percezioni[id] = rec;
    return rec;
  }
  /* Testi dei dettagli notati nella scena (mai quelli non notati). */
  function notati(state, content, sceneId) {
    const id = sceneId || state.scena;
    const d = datiScena(content, id);
    if (!d) return [];
    const rec = (state.percezioni && state.percezioni[id]) || percepisci(JSON.parse(JSON.stringify(state)), content, id);
    if (!rec) return [];
    const pulito = pulitore(state, content);
    return (d.percepibili || []).filter(p => rec.notati.indexOf(p.id) !== -1 && pulito(p.testo) && E().inFinestra(state, p)).map(p => p.testo);
  }

  /* ------------------------------------------------------ scelte contestuali */
  /* ------------------------------------------------------ forma dei pulsanti */
  /* Tutti i pulsanti all'infinito, come i punti della scena («Esaminare le casse», «Parlare con Jax»): i testi in prima persona dei
     contenuti («Esamino…», «Lo uso…», «Mi metto…», «Restiamo…») si volgono all'infinito; una scelta che non comincia con un verbo
     («Gli otto minuti vanno…») diventa «Decidere che…». Verbi in -ere e -ire e irregolari in un elenco; il resto è in -are. */
  const VERBI_ERE = 'proteggo distruggo trasmetto prendo metto vendo chiedo scrivo riscrivo interrompo leggo convinco vivo scendo rispondo credo vedo corro rompo spingo difendo divido batto accendo chiudo perdo nascondo spendo stendo muovo cedo concedo decido risolvo raggiungo stringo dipingo piango ripeto mordo cado esisto insisto resisto assisto prometto permetto rimetto smetto ammetto sommetto combatto discuto riconosco conosco cresco nasco mescolo'.split(' ');
  const VERBI_IRE = 'seguo inseguo offro apro sento copro scopro parto riparto fuggo dormo servo soffro investo vesto avverto converto consento acconsento'.split(' ');
  const IRREGOLARI = { vado: 'andare', faccio: 'fare', dico: 'dire', do: 'dare', sto: 'stare', bevo: 'bere', esco: 'uscire', tengo: 'tenere', sostengo: 'sostenere', mantengo: 'mantenere', ottengo: 'ottenere', trattengo: 'trattenere', vengo: 'venire', pongo: 'porre', propongo: 'proporre', traggo: 'trarre', conduco: 'condurre', produco: 'produrre', rimango: 'rimanere', scelgo: 'scegliere', sciolgo: 'sciogliere', raccolgo: 'raccogliere', tolgo: 'togliere', salgo: 'salire', posso: 'potere', devo: 'dovere', voglio: 'volere', so: 'sapere', siedo: 'sedere', muoio: 'morire', appaio: 'apparire' };
  const NON_VERBI = /^(sono|tanto|quanto|troppo|quattro|mezzo|nero|vecchio|nuovo|piccolo|altro|stesso|vero|certo|pieno|giusto|largo|lungo|freddo|caldo|buio|chiaro|otto|nessuno|uno|ognuno|qualcuno|tutto|molto|poco|questo|quello|primo|secondo|ultimo|solo|lo|il|io|dio|giorno|mondo|tempo|corpo|nodo|piano|ritorno|accordo|foglio|filo)$/;
  const CLITICI = { mi: 'si', ci: 'ci', ti: 'ti', gli: 'gli', le: 'le', lo: 'lo', la: 'la', li: 'li', ne: 'ne', vi: 'vi', si: 'si' };
  function infinitoDi(w) {
    const v = String(w || '').toLowerCase();
    if (IRREGOLARI[v]) return IRREGOLARI[v];
    if (/iamo$/.test(v)) { const r = v.slice(0, -4); const io = r + 'o'; return IRREGOLARI[io] || (VERBI_ERE.indexOf(io) !== -1 ? r + 'ere' : VERBI_IRE.indexOf(io) !== -1 ? r + 'ire' : r + 'are'); }
    if (!/o$/.test(v) || v.length < 3 || NON_VERBI.test(v)) return null;
    if (/isco$/.test(v)) return v.slice(0, -4) + 'ire';
    if (VERBI_ERE.indexOf(v) !== -1) return v.slice(0, -1) + 'ere';
    if (VERBI_IRE.indexOf(v) !== -1) return v.slice(0, -1) + 'ire';
    // -co/-go mantengono il suono duro all'infinito (cerco → cercare, prego → pregare), -cio/-gio perdono la i (lascio → lasciare)
    return v.slice(0, -1) + 'are';
  }
  const conClitico = (inf, cl) => (/rre$/.test(inf) ? inf.slice(0, -1) : inf.slice(0, -1)) + cl;
  /* «Esamino il sigillo e lo osservo» → «Esaminare il sigillo e osservarlo». */
  function infinito(testo) {
    const t = String(testo || '').trim();
    if (!t) return t;
    const parole = t.split(/\s+/);
    const prima = parole[0].replace(/[,:;.]$/, '').toLowerCase();
    // già all'infinito (anche con un pronome attaccato: «Mettersi», «Chiedergli»)
    // con il pronome serve una radice di almeno tre lettere: «osservarlo», «chiederle» sì, «parlo» (= par + lo) no
    if (/(are|ere|ire|rre)$|^\S{3,}(ar|er|ir)(si|gli|le|lo|la|li|ne|ci|mi|ti|glielo|gliela)$/.test(prima)) return t;
    const volgi = (i) => {
      const w = parole[i].replace(/[,:;.]$/, '').toLowerCase(), coda = parole[i].slice(w.length);
      const cl = CLITICI[w];
      if (cl && parole[i + 1] && infinitoDi(parole[i + 1].replace(/[,:;.]$/, '').toLowerCase())) {
        const v = parole[i + 1].replace(/[,:;.]$/, '');
        parole.splice(i, 2, conClitico(infinitoDi(v.toLowerCase()), cl) + parole[i + 1].slice(v.length));
        return true;
      }
      const inf = !cl && infinitoDi(w);
      if (inf) { parole[i] = inf + coda; return true; }
      return false;
    };
    if (!volgi(0)) return 'Decidere che ' + t.charAt(0).toLowerCase() + t.slice(1);
    // i verbi coordinati: «… e lo osservo», «… e cerco …»
    for (let i = 1; i < parole.length - 1; i++) if (/^(e|poi)$/i.test(parole[i])) volgi(i + 1);
    const out = parole.join(' ');
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
  /* PROPOSTA DA APPROVARE. Il pulsante per andare da un presente dice la situazione: «Rispondere a X» se X ti ha appena rivolto la parola
     o è appena stato coinvolto, «Avvicinarsi a X» se in questa scena non ci hai ancora parlato, altrimenti «Parlare con X». */
  // nome proprio: il primo nome; nome comune con l'articolo («L'amministratore di…»): intero, con la preposizione articolata
  function conNome(tpl, nome) {
    const n = String(nome || '').replace(/\s*\([^)]*\)/g, '').trim();
    const art = /^(l'|il |lo |la |i |gli |le )/i.exec(n);
    if (!art) return tpl.replace('{N}', n.split(' ')[0]).replace(/\ba (?=[AÀ])/, 'ad ');
    const resto = n.charAt(0).toLowerCase() + n.slice(1);
    const a = art[1].toLowerCase().trim();
    const conA = { "l'": "all'", il: 'al ', lo: 'allo ', la: 'alla ', i: 'ai ', gli: 'agli ', le: 'alle ' }[a] + n.slice(art[0].length);
    return tpl.replace(/\ba \{N\}/, conA).replace('{N}', resto);
  }
  function etichettaDialogo(state, id, nome) {
    const ev = ultimoEvento(state), it = state.interazione;
    const tocca = ev && ev.scena === state.scena && (ev.png === id || (ev.spinta && ev.spinta.png === id) || (ev.piano && ev.piano.iniziativa && ev.piano.iniziativa.png === id));
    const parlato = it && it.dialoghi && it.dialoghi[id] && it.dialoghi[id].aperture > 0;
    return conNome(tocca ? 'Rispondere a {N}' : parlato ? 'Parlare con {N}' : 'Avvicinarsi a {N}', nome);
  }
  const ultimoEvento = state => (state.eventi || [])[state.eventi.length - 1] || null;
  // «se è una frattura provo a sistemarla» → «Provo a sistemarla»: la parte dell'intenzione rimasta, nelle parole del giocatore
  const etichettaIntenzione = t => { const x = String(t || '').trim().replace(/^(e|poi|e poi)\s+/i, '').replace(/^(se|quando|dopo che|una volta che)\b[^,]*?,\s*/i, '').replace(/^se\s+(è|e|si tratta di|fosse|sia)\s+[^ ]+(\s+[^ ]+)?\s+(?=(provo|cerco|voglio|lo|la|gli|le)\b)/i, ''); return x.charAt(0).toUpperCase() + x.slice(1); };
  /* Azioni legate al momento: i passi della scena con un'etichetta d'autore (il primo non concluso per bersaglio) e ciò che il giocatore
     aveva in mente di fare dopo (ev.restanti). Vengono prima se riguardano chi è appena stato coinvolto. */
  function legateAlMomento(state, content, io, out) {
    const it = state.interazione, sc = E().currentScene(state, content);
    const ev = ultimoEvento(state);
    const coinvolto = ev && (ev.png || (it && it.dialogo)) || null;
    // il resto dell'intenzione, se è un atto diverso da quello appena risolto (non si ripropone ciò che è appena successo)
    const AZ = global.RMSoloAzioni;
    if (ev && ev.scena === state.scena && (ev.restanti || []).length) ev.restanti.filter(t => !AZ || AZ.atto(t) !== ev.atto).slice(0, 1).forEach((t, i) => out.push({ tipo: 'intenzione', id: 'r' + i, testo: etichettaIntenzione(t), invio: t, disponibile: true, priorita: 14, ordine: i }));
    const def = E().sceneInteractions(content, state.scena);
    if (!def || !it || it.scena !== state.scena) return;
    // durante un dialogo: solo i passi che riguardano chi sta parlando con te
    const dlg = io && io.dialogo ? io.dialogo.png : null;
    const visti = {};
    (def.passi || []).forEach((p, i) => {
      const b = p.bersaglio || {};
      const chi = b.png || ('punto:' + (b.punto || p.id));
      if (!p.etichetta || visti[chi] || ((it.passi || {})[p.id] || {}).fatto) return;
      // un passo superato da uno successivo sullo stesso bersaglio (curato prima di visitarlo) non si propone più
      if (def.passi.slice(i + 1).some(q => (q.bersaglio || {}).png === b.png && (q.bersaglio || {}).punto === b.punto && ((it.passi || {})[q.id] || {}).fatto)) return;
      if (!E().inFinestra(state, p)) return;
      if (b.png && (sc.png_presenti || []).indexOf(b.png) === -1) return;
      if (dlg && b.png !== dlg) return;
      visti[chi] = true;
      out.push({ tipo: 'passo', id: p.id, testo: p.etichetta, atto: p.atto, png: b.png || null, disponibile: true, priorita: b.png && (b.png === coinvolto || b.png === dlg) ? 15 : 30, ordine: i });
    });
    // un passo con un'etichetta d'autore vale più della stessa intenzione nelle parole del giocatore
    const atti = out.filter(c => c.tipo === 'passo').map(c => c.atto);
    for (let i = out.length - 1; i >= 0; i--) if (out[i].tipo === 'intenzione' && AZ && atti.indexOf(AZ.atto(out[i].invio)) !== -1) out.splice(i, 1);
  }
  /* Candidati nell'ordine di priorità; ritorna al massimo MAX_SCELTE voci. Ogni voce:
     { tipo: 'scelta'|'esplora'|'dialogo'|'argomento'|'suggerimento', id, testo, disponibile, motivo, priorita, indice? } */
  function candidati(state, content, io) {
    const sc = E().currentScene(state, content);
    const out = [];
    if (!sc) return out;
    const P = io && io.modo === 'semi' && io.possibili;
    // Fase 5.3: il passo dell'obiettivo personale è sempre fra le scelte visibili
    const tg = global.RMSoloTrama && global.RMSoloTrama.traguardoAttivo(state, content);
    if (tg) out.push({ tipo: 'obiettivo', id: sc.id, testo: 'Seguire il tuo filo: ' + tg.beat, disponibile: true, priorita: 1, ordine: 0 });
    if (io && io.dialogo) {
      legateAlMomento(state, content, io, out);
      io.dialogo.argomenti.forEach((a, i) => out.push({ tipo: 'argomento', id: a.id, testo: a.testo, disponibile: true, priorita: a.richiesto ? 20 : 40, ordine: i }));
      return out;
    }
    legateAlMomento(state, content, io, out);
    // B08 (prova della Cavaliera): l'uscita pronta della scena è sempre fra le scelte, perché il giocatore può sempre andarsene
    // (DECISIONI_AUTORE §12, condizione 2); il pulsante manda la sua etichetta all'instradamento, che la riconosce (RMSoloEngine.avanzamento)
    if (io && io.uscita) out.push({ tipo: 'intenzione', id: 'uscita', testo: io.uscita.etichetta, invio: io.uscita.etichetta, disponibile: true, priorita: 11, ordine: 0 });
    // un suggerimento che il motore rifiuterebbe (completato, fuori finestra, richiede.fatto/condizione, possibilità della scena-seme) non compare
    // (diagnosi in TESTI_DA_APPROVARE_2026-11-05 §6: C29B dopo C29A); l'indice è quello originale in sc.suggerimenti, letto così dalla UI
    const sugg = (sc.suggerimenti || []).map((s, k) => Object.assign({}, s, { k })).filter(s => !(state.obiettivi[s.obiettivo] && state.obiettivi[s.obiettivo].completato) && E().inFinestra(state, (sc.obiettivi || []).find(o => o.id === s.obiettivo)) &&
      !(s.obiettivo && E().validateProposal && E().validateProposal(state, content, { obiettivo: s.obiettivo }).tipo === 'rifiuto'));
    // decisioni della scena: solo quando la scena è pronta per decidere (o non ha fasi)
    // una scelta di una parte già lasciata resta se l'uscita della scena chiede una scelta fatta: nasconderla bloccherebbe la scena
    const sceltaPerUscire = (sc.uscite || []).some(u => JSON.stringify(u.quando || {}).indexOf('scelta_fatta') !== -1);
    if (!io || io.aperta) {
      (state.scelte[sc.id] ? [] : (sc.scelte || [])).filter(c => (!P || P.scelte.indexOf(c.id) !== -1) && !(E().fuoriParte && E().fuoriParte(state, content, c) && !sceltaPerUscire)).forEach((c, i) => {
        const ok = E().choiceAvailable(state, c);
        out.push({ tipo: 'scelta', id: c.id, testo: c.testo, disponibile: ok, motivo: ok ? '' : (c.motivo_non_disponibile || 'non disponibile'), priorita: ok ? 10 : 90, ordine: i });
      });
    }
    // i suggerimenti legati agli obiettivi compaiono, come le decisioni, solo quando la scena è pronta
    if (!io || io.aperta) sugg.forEach((s, i) => {
      if (P && s.obiettivo && P.obiettivi.indexOf(s.obiettivo) === -1) return;
      // coerenti con la scheda: un suggerimento che usa un tratto che il personaggio ha viene prima di uno che lo costringerebbe a una prova senza competenza
      const suo = !s.tratto || s.tratto === 'nessuno' || (global.RMSoloRules && global.RMSoloRules.traitValue(state.personaggio, s.tratto));
      out.push({ tipo: 'suggerimento', id: String(s.k), indice: s.k, testo: s.testo, tratto: s.tratto || null, competente: !!suo, disponibile: true, priorita: suo ? 12 : 16, ordine: i });
    });
    if (io) {
      // un dialogo senza più argomenti non occupa un posto
      (io.dialoghi || []).filter(d => d.argomentiRestanti > 0).forEach((d, i) => out.push({ tipo: 'dialogo', id: d.png, testo: etichettaDialogo(state, d.png, d.nome), disponibile: true, priorita: d.richiesti && !(io && io.aperta) ? 20 : 45, ordine: i }));
      (io.esplora || []).forEach((p, i) => out.push({ tipo: 'esplora', id: p.id, testo: p.testo, disponibile: true, priorita: p.richiesto && !(io && io.aperta) ? 20 : 50, ordine: i }));
    }
    return out;
  }
  function scelte(state, content, io) {
    // tutti i pulsanti nella stessa forma, all'infinito
    const tutti0 = candidati(state, content, io).map((c, k) => Object.assign({ k }, c, { testo: c.tipo === 'obiettivo' ? c.testo : infinito(c.testo) }));
    // due pulsanti con la stessa scritta («Rispondere al burattinaio» come suggerimento e come dialogo, prova della Cavaliera): resta il più importante
    const tutti = tutti0.filter(c => !tutti0.some(d => d !== c && d.testo === c.testo && (d.priorita < c.priorita || (d.priorita === c.priorita && d.k < c.k))));
    // a parità di priorità l'ordine ruota col turno: se ci sono più possibilità che posti, non si ripropongono sempre le stesse
    const giro = (state.eventi || []).length, n = tutti.length || 1;
    const ordinati = tutti.slice().sort((a, b) => a.priorita - b.priorita || ((a.k + giro) % n) - ((b.k + giro) % n));
    // i più importanti restano; l'ultimo posto ruota fra le altre possibilità, così i pulsanti non restano identici turno dopo turno
    const resto = ordinati.slice(MAX_SCELTE - 1);
    const prime = ordinati.length > MAX_SCELTE ? ordinati.slice(0, MAX_SCELTE - 1).concat([resto[giro % resto.length]]) : ordinati.slice(0, MAX_SCELTE);
    // l'ordine mostrato è quello originale della scena, non quello di priorità
    prime.sort((a, b) => a.k - b.k);
    return { scelte: prime, nascoste: Math.max(0, tutti.length - prime.length), totale: tutti.length, libera: true };
  }

  /* ------------------------------------------------------ validazione dei dati */
  function valida(d, content, tratti) {
    const e = [];
    if (!d || d.formato !== FORMATO) return ['formato dei dati di scena non valido'];
    const ids = (content.scene || []).map(s => s.id);
    Object.keys(content.png || {}).forEach(pid => { if (!String((((d.schede || {}).png || {})[pid] || {}).aspetto || '').trim()) e.push(pid + ': scheda del mondo senza aspetto'); });
    ids.forEach(id => { if (!d.scene[id]) e.push(id + ': scena senza dati di ingresso'); });
    Object.keys(d.scene).forEach(id => {
      const sc = (content.scene || []).find(s => s.id === id), x = d.scene[id];
      if (!sc) { e.push(id + ': scena inesistente'); return; }
      ['posizione', 'attivita'].forEach(k => { if (!String((x.protagonista || {})[k] || '').trim()) e.push(id + ': protagonista senza ' + k); });
      (sc.png_presenti || []).forEach(pid => {
        const p = (x.png || {})[pid];
        if (!p) { e.push(id + ': ' + pid + ' presente senza posizione e attività'); return; }
        ['posizione', 'attivita'].forEach(k => { if (!String(p[k] || '').trim()) e.push(id + ': ' + pid + ' senza ' + k); });
      });
      Object.keys(x.png || {}).forEach(pid => { if ((sc.png_presenti || []).indexOf(pid) === -1) e.push(id + ': ' + pid + ' non è presente nella scena'); });
      const pv = x.percepibili || [];
      if (!pv.length) e.push(id + ': nessun dettaglio percepibile');
      pv.forEach(p => {
        if (!p.id || !String(p.testo || '').trim()) e.push(id + ': dettaglio senza id o testo');
        if ((tratti || []).indexOf(p.tratto) === -1) e.push(id + ': tratto sconosciuto ' + p.tratto);
        if (!(p.nc >= 10 && p.nc <= 16)) e.push(id + ': NC ' + p.nc + ' fuori da 10-16');
        if (/\bMANCA\b/.test(p.testo)) e.push(id + ': dettaglio non completato');
      });
      if (new Set(pv.map(p => p.id)).size !== pv.length) e.push(id + ': id dei dettagli ripetuti');
    });
    return e;
  }

  global.RMSoloScena = { FORMATO, MAX_SCELTE, BASE_PASSIVA, infinito, etichettaDialogo, dati, datiScena, ingresso, testoIngresso, percepisci, notati, passivo, candidati, scelte, valida, etichettaIntenzione };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloScena;
})(typeof window !== 'undefined' ? window : globalThis);
