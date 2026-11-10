/* ==========================================================================
   Role Makers — Gioca in solitaria: memoria a tre livelli e schede a innesco (motore V2, modulo 6).

   Il narratore non riceve l'intera storia: riceve ciò che serve a questo turno.

   1. RECENTE — gli ultimi turni, una riga ciascuno (azione, esito, effetto sul mondo);
   2. SCENA   — che cosa è successo finora in questa scena; alla fine della scena
                si comprime in poche righe e passa nello storico;
   3. LUNGA   — fili aperti, debiti e sospetti, fili chiusi di recente, fatti di
                partita e note: scelti per priorità nel budget.

   Le SCHEDE A INNESCO sono quelle del mondo (RMSoloSchede: PNG, luoghi,
   fazioni), più tre innesci del motore V2: un filo aperto che riguarda un PNG
   presente, un fronte con pressione alta, un oggetto dello zaino nominato nel
   testo. Una scheda entra nel prompt solo se il suo innesco scatta e solo nel
   budget; ciò che non entra finisce in `dropped`.

   Tutto deterministico e senza spoiler: nessun segreto non scoperto, nessun
   lessico bloccato (stessi controlli del mondo). Scrive solo state.mondo.memoria.
   ========================================================================== */
(function (global) {
  'use strict';

  const RECENTE_MAX = 4;            // righe dei turni recenti conservate
  const SCENA_MAX = 6;              // righe della scena in corso
  const SCENE_STORICO = 12;         // scene compresse conservate
  // PROPOSTA DA APPROVARE: budget di token per la memoria e per le schede nel prompt del narratore
  const BUDGET = { recente: 100, scena: 60, lunga: 110, schede: 120 };
  const approx = s => Math.ceil(String(s || '').length / 3.2);

  const E = () => global.RMSoloEngine;
  const M = () => global.RMSoloMondo;
  const S_ = () => global.RMSoloSchede;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const corto = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
  const ETICHETTE = { successo: 'riuscita', parziale: 'riuscita a metà', fallimento: 'fallita' };

  function mem(state) {
    const m = state.mondo;
    if (!m.memoria) m.memoria = { recente: [], scene: {}, lunga: [] };
    if (!m.memoria.scene) m.memoria.scene = {};
    if (!m.memoria.recente) m.memoria.recente = [];
    if (!m.memoria.lunga) m.memoria.lunga = [];
    return m.memoria;
  }
  const titoloScena = (content, id) => { const s = E().sceneOf(content, id); return s ? s.titolo : id; };

  /* Riga di un turno: fatti già decisi dal motore e dal regista, nessun testo del narratore. */
  function rigaDelTurno(ev) {
    const azione = ev.resoconto && ev.resoconto.azioneDichiarata ? corto(ev.resoconto.azioneDichiarata, 70) : corto(ev.tipo, 30);
    const p = ev.piano;
    const esito = p && p.esito ? ETICHETTE[p.esito] : null;
    const parti = [azione + (esito ? ' → ' + esito : '')];
    if (p && p.costo) parti.push('costo: ' + p.costo.tipo);
    if (p && p.iniziativa) parti.push('iniziativa: ' + p.iniziativa.png + ' (' + p.iniziativa.mossa + ')');
    if (ev.imprevisto) parti.push('imprevisto');
    return parti.join('; ');
  }

  /* Registra il turno. Alla fine di una scena la comprime nello storico. Chiamato dal motore dopo il piano. */
  function registra(state, content, ev) {
    M().ensure(state, content);
    const m = mem(state);
    const riga = rigaDelTurno(ev);
    m.recente.push('#' + ev.n + ' ' + riga);
    while (m.recente.length > RECENTE_MAX) m.recente.shift();
    const sm = m.scene[ev.scena] || (m.scene[ev.scena] = { righe: [], chiusa: false, riassunto: null });
    if (!sm.chiusa && ev.tipo !== 'combattimento') { sm.righe.push(riga); if (sm.righe.length > SCENA_MAX) sm.righe.shift(); }
    // cambio di scena: la scena lasciata si comprime
    if (state.scena !== ev.scena && !sm.chiusa) chiudiScena(state, content, ev.scena);
  }

  function chiudiScena(state, content, sceneId) {
    const m = mem(state);
    const sm = m.scene[sceneId];
    if (!sm || sm.chiusa) return;
    const importanti = sm.righe.filter(r => /→ (riuscita|fallita)|costo:|iniziativa:|imprevisto/.test(r)).slice(-3);
    const lista = importanti.length ? importanti : sm.righe.slice(-2);
    sm.riassunto = 'In «' + titoloScena(content, sceneId) + '»: ' + lista.map(r => corto(r, 90)).join(' | ');
    sm.chiusa = true; sm.righe = [];
    // conserva solo le scene più recenti, le altre restano nella memoria lunga come una nota
    const chiuse = Object.keys(m.scene).filter(k => m.scene[k].chiusa);
    while (chiuse.length > SCENE_STORICO) { const k = chiuse.shift(); delete m.scene[k]; }
  }

  /* ----------------------------------------------------------- memoria lunga */
  function lunga(state, content) {
    const m = state.mondo, out = [];
    M().filiAperti(state).slice(0, 4).forEach(f => out.push({ p: 90, t: 'Filo aperto: ' + f.titolo + '.' }));
    Object.values(m.png || {}).forEach(n => {
      const nome = content.png[n.id] ? String(content.png[n.id].nome).replace(/\s*\([^)]*\)/g, '') : n.id;
      if (n.sospetto >= 2) out.push({ p: 85, t: nome + ' diffida del protagonista.' });
      if (n.debito >= 1) out.push({ p: 80, t: 'Il protagonista ha un debito con ' + nome + '.' });
    });
    m.fili.filter(f => f.stato === 'chiuso' && f.chiusura).slice(-2).forEach(f => out.push({ p: 60, t: 'Chiuso: ' + corto(f.chiusura, 100) }));
    m.fatti.filter(f => f.fonte !== 'canone' && f.visibile !== false).slice(-3).forEach(f => out.push({ p: 50, t: corto(f.testo, 110) }));
    (m.memoria.lunga || []).slice(-2).forEach(t => out.push({ p: 40, t: corto(t, 110) }));
    return out.sort((a, b) => b.p - a.p).map(x => x.t);
  }

  function nelBudget(righe, budget) {
    const out = [], tolte = [];
    let usato = 0;
    righe.forEach(r => { const t = approx(r) + 1; if (usato + t <= budget) { out.push(r); usato += t; } else tolte.push(r); });
    return { righe: out, tokens: usato, tolte };
  }

  /* ----------------------------------------------------------- schede a innesco */
  function schedeAInnesco(state, content, ev, testo, budget) {
    const S = S_();
    const base = S ? S.schede(state, content, { testo, budget: budget != null ? budget : BUDGET.schede }) : { carte: [], dropped: [], tokens: 0, budget: budget != null ? budget : BUDGET.schede };
    const carte = base.carte.slice(), dropped = base.dropped.slice();
    let usato = base.tokens;
    const extra = [];
    const m = state.mondo, scenaCont = E().currentScene(state, content);
    const presenti = (scenaCont && scenaCont.png_presenti) || [];
    const t = norm(testo);
    // innesco: filo che riguarda un PNG presente
    M().filiAperti(state).forEach(f => {
      const id = /^png:/.test(f.legatoA || '') ? f.legatoA.slice(4) : null;
      if (id && presenti.indexOf(id) !== -1) extra.push({ tipo: 'filo', id: f.id, priorita: 75, testo: 'Filo aperto con ' + String(content.png[id].nome).replace(/\s*\([^)]*\)/g, '') + ': ' + f.titolo + '.' });
    });
    // innesco: fronte con pressione alta
    (m.fronti || []).forEach(f => { if (f.polarita === 'minaccia' && f.pressione >= 2 && ((state.orologi || {})[f.orologio] || {}).attivo) extra.push({ tipo: 'fronte', id: f.id, priorita: 65, testo: '«' + f.nome + '» incombe sulla storia: la pressione è alta.' }); });
    // innesco: oggetto dello zaino nominato nel testo
    (state.inventario || []).forEach(i => {
      const d = E().itemInfo(state, content, i.id);
      if (!d) return;
      const nome = norm(String(d.nome).replace(/\s*\([^)]*\)/g, ''));
      if (nome.length >= 4 && (' ' + t + ' ').indexOf(' ' + nome + ' ') !== -1) extra.push({ tipo: 'oggetto', id: i.id, priorita: 55, testo: d.nome + ': ' + corto(d.descrizione, 110) });
    });
    const C = global.RMSoloCampaign, rules = C ? C.lockedLexicon(state, content) : [];
    extra.filter(c => !(C && rules.length && C.lexiconHits(c.testo, rules).length)).sort((a, b) => b.priorita - a.priorita).forEach(c => {
      const tk = approx(c.testo) + 1;
      if (usato + tk <= (budget != null ? budget : BUDGET.schede)) { carte.push(c); usato += tk; } else dropped.push(c.tipo + ':' + c.id);
    });
    return { carte, dropped, tokens: usato, budget: budget != null ? budget : BUDGET.schede };
  }

  /* Il contesto di memoria per il narratore: righe già pronte e quanto è stato escluso. */
  function contesto(state, content, ev, opz) {
    const o = opz || {};
    M().ensure(state, content);
    const m = mem(state);
    const piano = ev.piano;
    const testo = [ev.testo, ev.resoconto && ev.resoconto.azioneDichiarata].concat(piano ? piano.battute.map(b => b.guida) : []).filter(Boolean).join(' ');
    const prima = ev.n - 1;
    const rec = nelBudget(m.recente.filter(r => Number(/^#(\d+)/.exec(r)[1]) <= prima).slice().reverse(), BUDGET.recente);
    const sm = m.scene[ev.scena];
    const scena = sm ? (sm.chiusa ? [sm.riassunto] : sm.righe.filter(r => !m.recente.some(x => x.indexOf(r) !== -1)).slice(-3).reverse()) : [];
    const sce = nelBudget(scena.filter(Boolean), BUDGET.scena);
    const lun = nelBudget(lunga(state, content), BUDGET.lunga);
    const schede = schedeAInnesco(state, content, ev, testo, o.budgetSchede);
    return {
      recente: rec.righe.reverse(), scena: sce.righe, lunga: lun.righe, schede,
      dropped: rec.tolte.concat(sce.tolte, lun.tolte).length + schede.dropped.length,
      tokens: rec.tokens + sce.tokens + lun.tokens + schede.tokens
    };
  }
  function testoContesto(c) {
    const L = [];
    if (c.recente.length) L.push('RICORDI RECENTI:\n' + c.recente.map(r => '- ' + r).join('\n'));
    if (c.scena.length) L.push('IN QUESTA SCENA FINORA:\n' + c.scena.map(r => '- ' + r).join('\n'));
    if (c.lunga.length) L.push('DA RICORDARE DELLA STORIA:\n' + c.lunga.map(r => '- ' + r).join('\n'));
    if (c.schede.carte.length) L.push('SCHEDE (solo ciò che serve ora):\n' + c.schede.carte.map(x => '- ' + x.testo).join('\n'));
    return L.join('\n');
  }


  /* ----------------------------------------------------------- dettagli descrittivi della scena
     Contratto docs/single-player/CONTRATTO_MEMORIA_NARRATORE.md §4 (Fase 3, 6/11/2026). Continuità descrittiva, mai canone:
     - solo frammenti del testo MOSTRATO con fonte «ia», tolte le frasi d'autore del piano;
     - una proposizione si tiene solo se nomina un'entità della scena (luogo, oggetto, PNG presente, oggetto di un obiettivo) e un
       attributo descrittivo (colore, materia, forma, luce, suono, odore, posizione); nel dubbio, niente;
     - mai stati, acquisizioni, successi o cambiamenti (raccolto, reciso, in mano…), mai il protagonista («tu», i suoi gesti, ciò che
       sente), mai battute, numeri, negazioni o incertezze;
     - compatibile con il canone: se i testi d'autore danno un colore all'entità, un colore di un'altra famiglia non si ricorda;
     - una descrizione già ricordata non si sovrascrive: una nuova compatibile si aggiunge se c'è spazio, una incompatibile si scarta;
     - al massimo 3 righe di 120 caratteri, solo per la scena corrente (si svuota al cambio di scena).
     shortcut: estrazione lessicale con elenchi chiusi, perde dettagli buoni (falsi negativi voluti); da ampliare se le misure lo mostrano. */
  const DETTAGLI_MAX = 3, DETTAGLIO_LEN = 120;
  const FAMIGLIE = [
    ['azzurro', /^(azzurr|celest|blu$|blù$|turchin|cian[oaie]?$|zaffir|indac)/], ['nero', /^(ner[oaie]$|nerastr|corvin|pece$)/],
    ['bianco', /^(bianc|candid|lattigin)/], ['rosso', /^(ross[oaie]$|rossastr|scarlatt|cremisi|porpor|vermigl|sanguign)/],
    ['verde', /^(verd[ei]$|verdastr|verdognol|smerald)/], ['giallo', /^(giall|dorat|ocra$)/], ['grigio', /^(grigi|grig[ie]$|cinere|plumbe)/],
    ['viola', /^(viola$|violett|lilla$|malva$)/], ['marrone', /^(marron|brun[oaie]$|castan)/]
  ];
  // «color cielo», «colore del sangue»…: il colore detto con un paragone fisso
  const PARAGONI = [['azzurro', /colou?r[ei]?\s+(?:del\s+)?cielo/], ['rosso', /colou?r[ei]?\s+(?:del\s+)?sangue/], ['nero', /colou?r[ei]?\s+(?:della\s+)?(?:notte|pece|carbone)/], ['giallo', /colou?r[ei]?\s+(?:dell'?\s*)?oro/], ['bianco', /colou?r[ei]?\s+(?:della\s+)?neve/]];
  const ATTRIBUTI = /^(lumin|brill|splend|scintill|opac|bagliore|ombr[ae]$|riflessi|legno|pietr|ferro|metall|cuoio|lana$|seta$|vetro|cristall|osso$|ossa$|tela$|corda|argill|spiral|rotond|sottil|spess|lung[oaih]|curv|aguzz|spinos|ruvid|lisci|morbid|umid|bagnat|tiepid|fredd|cald[oaie]$|silenz|sussurr|fruscio|ronz|scricchiol|cigol|rimbomb|odor|profum|puzz|aroma|resin|fumo|polver|fang|musch|accanto|sopra|sotto|dietro|davanti|vicino|lontan|pallid|scur[oaie]$|chiar[oaie]$|vivid|spent[oaie]$)/;
  // stati, acquisizioni e cambiamenti: un dettaglio non li attesta mai (il fiore «ormai reciso», «nella tua mano»)
  const STATO = /(^|[^a-z])(raccol\w*|raccogli\w*|recis\w*|rott[oaie]|romp\w*|spezz\w*|aper[ts]\w*|apr[eio]\w*|chius[oaie]|chiud\w*|pres[oaie]|prend\w*|pers[oaie]|perd\w*|mort[oaie]|muor\w*|uccis\w*|ferit\w*|sanguin\w*|cadut\w*|cad[eo]\w*|spost\w*|consegn\w*|regal\w*|otten\w*|ottien\w*|trovat\w*|trov[ao]\w*|scopr\w*|riusc\w*|fall\w*|accord\w*|promess\w*|strapp\w*|colt[oaie]|cogli\w*|spegn\w*|accend\w*|spar[iy]\w*|scompar\w*|distrutt\w*|bruci\w*|mano|mani|zaino|borsa|tasca|ormai|ora|adesso|ancora|diventa\w*|divent\w*|trasform\w*|cambi\w*)([^a-z]|$)/;
  const PROTAGONISTA = /(^|[^a-z])(tu|ti|te|tuo|tua|tuoi|tue|voi|vi|vostr\w*|vedi|senti|guardi|noti|osservi|scorgi|prendi|raccogli|stringi|tocchi|afferri|tieni|hai|sei|puoi|devi|vuoi|sai|fai|vai|ricordi|pensi|capisci|chini|avvicini|allunghi|sfiori|riconosci|immagini)([^a-z]|$)/;
  const DUBBIO = /(^|[^a-z])(non|mai|nessun\w*|niente|nulla|forse|sembr\w*|pare|parev\w*|quasi|come se|chissa|strano|strana|diverso|diversa|tutto|tutta|qualcosa|qualcuno)([^a-z]|$)/;
  const NUMERI = /\d|(^|[^a-z])(due|tre|quattro|cinque|sette|otto|nove|dieci|cento|mille)([^a-z]|$)/;
  const PAROLE_VUOTE = new Set('della delle degli dello dalla dalle dagli nella nelle negli nello sulla sulle sugli sullo come anche ogni sono sopra sotto dove quando mentre perche questo questa quello quella loro altro altra altri altre fino verso dentro fuori ancora sempre molto poco tanto tutto tutta tutti tutte essere avere fare dire stato stata cosa cose fra tra' .split(' '));
  const famiglieDi = t => {
    const n = norm(t), out = new Set();
    PARAGONI.forEach(([f, re]) => { if (re.test(n)) out.add(f); });
    n.split(/[^a-z]+/).forEach(w => FAMIGLIE.forEach(([f, re]) => { if (re.test(w)) out.add(f); }));
    return out;
  };
  /* Colore detto direttamente dell'entità («il fiore rosso», «il fiore è nero», «un fiore color cielo»): le famiglie, o un insieme vuoto. */
  function coloreDiretto(t, radice) {
    const toks = norm(t).replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
    const out = new Set();
    toks.forEach((w, i) => {
      if (w.slice(0, 5) !== radice) return;
      const dopo = toks.slice(i + 1, i + 6).join(' ');
      PARAGONI.forEach(([f, re]) => { if (new RegExp('^(?:(?:e|era|di|un|una|del|dal|tutto|tutta)\\s+){0,2}' + re.source).test(dopo)) out.add(f); });
      for (let j = i + 1, salti = 0; j < Math.min(toks.length, i + 5); j++) {
        const fam = FAMIGLIE.find(([f, re]) => re.test(toks[j]));
        if (fam) { out.add(fam[0]); continue; }
        if (/^(e|era|un|una|di|del|colore|color|tutto|tutta|intenso|intensa|acceso|accesa)$/.test(toks[j]) && salti++ < 2) continue;
        break;
      }
    });
    return out;
  }
  /* Testi d'autore della scena (canone): descrizione, apertura, obiettivi, interazioni, fatti registrati nella scena. */
  function testiCanoniciScena(state, content, sceneId) {
    const sc = E().sceneOf(content, sceneId) || {};
    const out = [sc.titolo, sc.luogo, sc.apertura, sc.apertura_riserva, E().descrizioneScena ? E().descrizioneScena(state, sc) : ''].concat((sc.obiettivi || []).map(o => o.testo));
    const raccogli = (x, d) => { if (d > 6 || x == null) return; if (typeof x === 'string') out.push(x); else if (Array.isArray(x)) x.forEach(y => raccogli(y, d + 1)); else if (typeof x === 'object') Object.keys(x).forEach(k => { if (k !== 'id' && k !== 'png') raccogli(x[k], d + 1); }); };
    raccogli(E().sceneInteractions ? E().sceneInteractions(content, sceneId) : null, 0);
    (state.eventi || []).filter(e => e.scena === sceneId).forEach(e => (e.effetti || []).forEach(a => { if (a.tipo === 'scoperta' && a.testo) out.push(a.testo); }));
    return out.filter(x => typeof x === 'string' && x.trim());
  }
  /* Entità della scena: parole piene dei testi d'autore (nomi di oggetti, luoghi) e primi nomi dei PNG presenti. Ritorna Map radice → parola. */
  function entitaScena(state, content, sceneId) {
    const m = new Map();
    testiCanoniciScena(state, content, sceneId).forEach(t => norm(t).split(/[^a-z]+/).forEach(w => {
      if (w.length < 4 || PAROLE_VUOTE.has(w) || ATTRIBUTI.test(w) || FAMIGLIE.some(([f, re]) => re.test(w)) || /(are|ere|ire|ano|ono|ava|eva|iva|ando|endo|mente)$/.test(w)) return;
      if (!m.has(w.slice(0, 5))) m.set(w.slice(0, 5), w);
    }));
    E().presentiEffettivi(state, content, sceneId).forEach(id => { const n = norm(String(content.png[id].nome).replace(/\s*\([^)]*\)/g, '')).split(/[^a-z]+/)[0]; if (n && n.length >= 3) m.set(n.slice(0, 5), n); });
    return m;
  }
  /* Colori canonici di un'entità nella scena (famiglie), dai soli testi d'autore che glieli danno direttamente. */
  function coloriCanonici(state, content, sceneId, radice) {
    const out = new Set();
    testiCanoniciScena(state, content, sceneId).forEach(t => coloreDiretto(t, radice).forEach(f => out.add(f)));
    return out;
  }
  /* Contraddizione CERTA con un colore canonico: la frase dà direttamente all'entità un colore di un'altra famiglia, senza attenuazioni
     (ombra, riflesso, «sembra»…). Una parte dell'entità («petali neri» di un fiore «color cielo») o un paragone non bastano: non è certo.
     Ritorna { entita, canone: [...], detto: [...] } o null. Serve al post-processo, che toglie la frase prima di mostrarla. */
  function contraddiceCanone(state, content, sceneId, frase) {
    if (!state || !content || !sceneId || !frase) return null;
    const n = norm(frase);
    if (/(^|[^a-z])(ombra|ombre|riflesso|riflessi|sembr\w*|pare|quasi|buio|notte|alla luce|controluce|come)([^a-z]|$)/.test(n)) return null;
    let trovata = null;
    entitaScena(state, content, sceneId).forEach((parola, radice) => {
      if (trovata) return;
      const detto = coloreDiretto(frase, radice);
      if (!detto.size) return;
      const canone = coloriCanonici(state, content, sceneId, radice);
      if (canone.size && !Array.from(detto).some(f => canone.has(f))) trovata = { entita: parola, canone: Array.from(canone), detto: Array.from(detto) };
    });
    return trovata;
  }
  // la similitudine «…, come se…» è una proposizione a sé: resta un'incertezza (DUBBIO), la parte affermata prima si valuta da sola
  const proposizioni = t => String(t || '').split(/[.;:!?…\n]+/).map(x => x.trim()).filter(Boolean)
    .flatMap(p => p.split(/,?\s+(?=come se\b)/i).map(x => x.trim()).filter(Boolean))
    .flatMap(p => p.length <= DETTAGLIO_LEN ? [p] : p.split(/,\s+/).map(x => x.trim()).filter(Boolean));
  const giaAutore = (p, autore) => { const k = norm(p).replace(/[^a-z0-9]+/g, ' ').trim(); return !!k && autore.some(a => a.indexOf(k) !== -1); };
  /* I dettagli di un testo mostrato: [{ chiave, entita, testo, colori }], nessuno se l'estrazione non è certa. */
  function estraiDettagli(state, content, ev, testo) {
    const ents = entitaScena(state, content, ev.scena);
    const autore = ((ev.piano && ev.piano.battute) || []).map(b => norm(b.prosa || '').replace(/[^a-z0-9]+/g, ' ')).concat(testiCanoniciScena(state, content, ev.scena).map(x => norm(x).replace(/[^a-z0-9]+/g, ' ')));
    const pg = norm((state.personaggio || {}).nome).split(/[^a-z]+/).filter(w => w.length >= 3);
    const zaino = (state.inventario || []).map(i => { const d = E().itemInfo(state, content, i.id); return d ? norm(String(d.nome).replace(/\s*\([^)]*\)/g, '')).split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 5)) : []; }).flat();
    const out = [];
    proposizioni(testo).forEach(p => {
      if (p.length > DETTAGLIO_LEN || /[«»"“”]/.test(p) || giaAutore(p, autore)) return;
      const n = norm(p);
      if (STATO.test(n) || PROTAGONISTA.test(n) || DUBBIO.test(n) || NUMERI.test(n)) return;
      const parole = n.split(/[^a-z]+/).filter(Boolean);
      if (pg.some(w => parole.indexOf(w) !== -1) || parole.some(w => zaino.indexOf(w.slice(0, 5)) !== -1)) return;
      const ent = parole.find(w => w.length >= 4 && ents.has(w.slice(0, 5)));
      const attr = parole.some(w => ATTRIBUTI.test(w) || FAMIGLIE.some(([f, re]) => re.test(w))) || PARAGONI.some(([f, re]) => re.test(n));
      if (!ent || !attr) return;
      const radice = ent.slice(0, 5), colori = famiglieDi(p), canone = coloriCanonici(state, content, ev.scena, radice);
      if (colori.size && canone.size && Array.from(colori).some(f => !canone.has(f))) return;   // compatibilità non certa: non si ricorda
      out.push({ chiave: radice, entita: ents.get(radice), testo: p.replace(/\s+/g, ' '), colori: Array.from(colori) });
    });
    return out;
  }
  function dettagliMem(state) {
    if (!state.dettagliScena || state.dettagliScena.scena !== state.scena) state.dettagliScena = { scena: state.scena, voci: [] };
    return state.dettagliScena;
  }
  /* Dopo l'aggancio di un testo del Narratore accettato: aggiorna la memoria della scena. Un «Riprova» accettato toglie prima ciò che
     veniva dal testo che sostituisce. Scrive solo state.dettagliScena. */
  function ricordaDettagli(state, content, ev) {
    const d = dettagliMem(state);
    d.voci.forEach(v => { v.parti = v.parti.filter(x => x.evento !== ev.n); });
    d.voci = d.voci.filter(v => v.parti.length);
    if (!ev.narrazione || ev.narrazione.fonte !== 'ia' || ev.scena !== state.scena) return d;
    const n = ev.n;
    estraiDettagli(state, content, ev, ev.narrazione.testo).forEach(x => {
      const v = d.voci.find(y => y.chiave === x.chiave);
      if (!v) { d.voci.push({ chiave: x.chiave, entita: x.entita, parti: [{ evento: n, testo: x.testo, colori: x.colori }] }); return; }
      const coloriVecchi = new Set(v.parti.flatMap(p => p.colori));
      if (x.colori.length && coloriVecchi.size && x.colori.some(f => !coloriVecchi.has(f))) return;   // incompatibile con la descrizione già data
      if (v.parti.some(p => norm(p.testo) === norm(x.testo))) return;
      if (rigaDettaglio(Object.assign({}, v, { parti: v.parti.concat([{ evento: n, testo: x.testo }]) })).length <= DETTAGLIO_LEN) v.parti.push({ evento: n, testo: x.testo, colori: x.colori });
    });
    while (d.voci.length > DETTAGLI_MAX) d.voci.shift();
    return d;
  }
  const rigaDettaglio = v => v.entita + ' (' + v.parti.map(p => 'E' + p.evento).join(', ') + '): ' + v.parti.map(p => p.testo).join('; ');
  /* Righe per il prompt della scena dell'evento: al massimo 3, mai di un'altra scena. */
  function righeDettagli(state, ev) {
    const d = state.dettagliScena;
    if (!d || d.scena !== ev.scena || d.scena !== state.scena) return [];
    return d.voci.filter(v => v.parti.every(p => p.evento < ev.n)).slice(-DETTAGLI_MAX).map(rigaDettaglio);
  }
  const TITOLO_DETTAGLI = 'DETTAGLI GIÀ DESCRITTI IN QUESTA SCENA (non accertati, non vincolanti; puoi restarvi coerente, non usarli come fatti):';

  /* Battute dei PNG (principio approvato dall'autore il 7/11/2026, DECISIONI §14; prova della Cavaliera B03): ciò che un PNG ha detto in un
     testo del Narratore accettato, attribuito a lui, le ultime BATTUTE_PER_PNG. Restano affermazioni (anche false): non entrano nei fatti,
     non sbloccano nulla e il motore non le legge per decidere. Si prendono solo le frasi fra «» del testo accettato che non sono testo
     d'autore del piano né parole del giocatore, quando nel piano c'è un solo PNG che risponde senza testo d'autore (attribuzione certa);
     più le battute di dialogo con il nome del PNG. Un «Riprova» accettato toglie prima quelle dell'evento che sostituisce. */
  const BATTUTE_PER_PNG = 3, BATTUTA_LEN = 120;
  function battuteDelTesto(state, content, ev) {
    const nar = ev.narrazione || {}, piano = ev.piano || {};
    const autore = (piano.battute || []).map(b => norm(b.prosa || '')).join(' | ');
    const giocatore = norm(ev.testoGiocatore || ev.testo || '');
    const nuova = t => { const k = norm(t); return k.split(' ').length >= 3 && autore.indexOf(k) === -1 && giocatore.indexOf(k) === -1; };
    const out = [];
    const perNome = n => Object.keys(content.png || {}).find(id => content.png[id].nome === n);
    (nar.battute || []).forEach(b => { const id = b.pngId || perNome(b.png); if (id && nuova(b.testo)) out.push({ png: id, testo: corto(b.testo, BATTUTA_LEN) }); });
    // la battuta in cui il PNG risponde da personaggio senza testo d'autore (guida di RMSoloPiano.guidaRispostaComune; la sua prosa è solo la riserva)
    const liberi = (piano.battute || []).filter(b => b.png && /^Nessun testo d'autore/.test(b.guida || '')).map(b => b.png).filter((x, i, a) => a.indexOf(x) === i);
    if (liberi.length === 1) (String(nar.testo || '').match(/«[^»]{6,}»/g) || []).map(q => q.slice(1, -1)).filter(nuova)
      .forEach(t => out.push({ png: liberi[0], testo: corto(t, BATTUTA_LEN) }));
    return out;
  }
  function ricordaBattute(state, content, ev) {
    const m = state.battutePng = state.battutePng || {};
    Object.keys(m).forEach(id => { m[id] = m[id].filter(b => b.evento !== ev.n); if (!m[id].length) delete m[id]; });
    if (!ev.narrazione || ev.narrazione.fonte !== 'ia') return m;
    const n = ev.n, scena = ev.scena;
    battuteDelTesto(state, content, ev).forEach(x => {
      const l = m[x.png] = m[x.png] || [];
      if (!l.some(b => norm(b.testo) === norm(x.testo))) l.push({ evento: n, scena, testo: x.testo, certezza: 'affermato' });
      m[x.png] = l.slice(-BATTUTE_PER_PNG);
    });
    return m;
  }
  /* Righe per il prompt: solo i PNG presenti nella scena dell'evento, battute di eventi precedenti. */
  function righeBattute(state, content, ev, presenti) {
    const m = state.battutePng || {};
    return (presenti || Object.keys(m)).filter(id => m[id] && content.png[id]).map(id => {
      const l = m[id].filter(b => b.evento < ev.n);
      return l.length ? content.png[id].nome + ' ha detto: ' + l.map(b => '«' + b.testo + '» (E' + b.evento + ')').join('; ') : '';
    }).filter(Boolean);
  }
  const TITOLO_BATTUTE = 'DETTO DAI PERSONAGGI (non accertato: sono loro affermazioni, anche false; non sono fatti del mondo):';

  global.RMSoloMemoria = { RECENTE_MAX, SCENA_MAX, SCENE_STORICO, BUDGET, registra, chiudiScena, lunga, schedeAInnesco, contesto, testoContesto, rigaDelTurno,
    DETTAGLI_MAX, DETTAGLIO_LEN, TITOLO_DETTAGLI, estraiDettagli, ricordaDettagli, righeDettagli, contraddiceCanone, coloriCanonici, coloreDiretto, entitaScena,
    BATTUTE_PER_PNG, BATTUTA_LEN, TITOLO_BATTUTE, battuteDelTesto, ricordaBattute, righeBattute };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloMemoria;
})(typeof window !== 'undefined' ? window : globalThis);
