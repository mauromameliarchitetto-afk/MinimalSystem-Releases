/* Role Makers — Gioca in solitaria: scheda del personaggio in sola lettura,
   con la stessa grafica delle schede di "I miei personaggi" (diagramma del
   fronte, barre HP/MP/PP, riquadri e titoli di sezione di css/style.css).
   Serve in due punti: nella scelta del personaggio, per decidere anche in
   base alle caratteristiche, e nella scheda "Scheda" durante la partita.

   Nessun dato riservato: riceve la scheda pubblica (sheetFromArchetype o
   state.personaggio) e, in partita, l'inventario già visibile al giocatore.
   Il ritratto è quello scelto dal giocatore oppure quello predefinito
   dell'archetipo (ritrattoPredefinito). */
(function (global) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Diagramma del fronte: stesso SVG e stesse posizioni della scheda
     dell'app (DIAGRAM_SPEC in js/app.js), valori in sola lettura. */
  const SPEC_FALLBACK = [
    { key: 'lv', x: 37, y: 27, w: 13, label: 'Livello' }, { key: 'qi', x: 283, y: 27, w: 13, label: 'Quoziente Intellettivo' },
    { key: 'p:mira', x: 160, y: 55, w: 11, label: 'Mira' }, { key: 'p:dex', x: 120, y: 95, w: 11, label: 'Destrezza' },
    { key: 'p:dif', x: 200, y: 95, w: 11, label: 'Difesa' }, { key: 'p:for', x: 160, y: 135, w: 11, label: 'Forza' },
    { key: 'p:vel', x: 120, y: 175, w: 11, label: 'Velocità' }, { key: 'p:dmen', x: 200, y: 175, w: 11, label: 'Difesa Mentale' },
    { key: 'p:fmen', x: 160, y: 215, w: 11, label: 'Forza Mentale' }, { key: 't:carisma', x: 120, y: 255, w: 11, label: 'Carisma' },
    { key: 't:stile', x: 200, y: 255, w: 11, label: 'Stile' }, { key: 't:fortuna', x: 160, y: 295, w: 11, label: 'Fortuna' },
    { key: 'hprim', x: 90, y: 345, w: 13, label: 'HP correnti' }, { key: 'mprim', x: 230, y: 345, w: 13, label: 'MP correnti' },
    { key: 'prcur', x: 160, y: 385, w: 11, label: 'P.R. correnti' }
  ];
  function spec() { return typeof DIAGRAM_SPEC !== 'undefined' ? DIAGRAM_SPEC : SPEC_FALLBACK; }
  function diagramSvg() {
    const svg = global.document && document.querySelector('#stat-diagram svg');
    return svg ? svg.outerHTML : '';
  }
  function value(pg, key) {
    if (key.startsWith('p:')) return (pg.primary || {})[key.slice(2)];
    if (key.startsWith('t:')) return (pg.tertiary || {})[key.slice(2)];
    // K.O. = 10% del massimo, USO = punti già spesi (come nella scheda dell'app)
    const ko = m => Math.ceil((m || 0) * (typeof KO_THRESHOLD_PCT !== 'undefined' ? KO_THRESHOLD_PCT : 0.1));
    return { lv: pg.livello, qi: pg.qi, hprim: pg.hpCur, mprim: pg.mpCur, prcur: pg.prCur,
      hpko: ko(pg.hpMaxTracked), mpko: ko(pg.mpMaxTracked),
      hpuso: Math.max(0, (pg.hpMaxTracked || 0) - (pg.hpCur || 0)), mpuso: Math.max(0, (pg.mpMaxTracked || 0) - (pg.mpCur || 0)) }[key];
  }

  function box(title, dot, inner) {
    return '<div class="section-title"><span class="dot ' + (dot || 'neutral') + '"></span>' + title + '</div>' +
      '<div class="box"><div class="box-bar' + (dot === 'physical' ? ' physical' : dot === 'magic' ? ' magic' : '') + '"></div><div class="box-pad">' + inner + '</div></div>';
  }
  function bar(name, color, cls, cur, max) {
    const pct = max ? Math.max(0, Math.min(100, Math.round(cur / max * 100))) : 0;
    return '<div class="bar-row"><div class="bar-top"><span class="bar-name" style="color:' + color + '">' + name + '</span><span class="bar-val">' + esc(cur) + ' / ' + esc(max) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div></div>';
  }
  function table(rows) { return rows ? '<div class="table-scroll"><table class="data-table"><tbody>' + rows + '</tbody></table></div>' : '<p class="helper-text">—</p>'; }

  function portraitUrl(pg, opts) { return pg.ritratto || (opts && opts.ritrattoPredefinito) || ''; }

  function fronte(pg) {
    const svg = diagramSvg();
    const diagram = svg ? '<div class="diagram-wrap solo-diagram">' + svg + '<div class="dg-inputs">' + spec().map(f =>
      '<input type="text" class="dg-input solo-dg" readonly tabindex="-1" aria-label="' + esc(f.label) + '" value="' + esc(value(pg, f.key) == null ? '' : value(pg, f.key)) + '" style="left:' + (f.x / 320 * 100).toFixed(2) + '%;top:' + (f.y / 430 * 100).toFixed(2) + '%;width:' + f.w + '%;">').join('') + '</div></div>' : '';
    const primarie = (typeof PRIMARY_STATS !== 'undefined' ? PRIMARY_STATS : []).map(st => '<tr><td class="field">' + esc(st.label) + '</td><td class="num">' + esc((pg.primary || {})[st.key]) + '</td></tr>').join('');
    const pp = Math.round((pg.hpMaxTracked || 0) / 2 + (pg.mpMaxTracked || 0) / 2);
    return box('Diagramma della scheda', '', diagram || table(primarie)) +
      box('Risorse', 'physical',
        bar('HP', 'var(--fisico-forte)', 'physical', pg.hpCur, pg.hpMaxTracked) +
        bar('MP', 'var(--magico-forte)', 'magic', pg.mpCur, pg.mpMaxTracked) +
        bar('PP · Boost', 'var(--testo-secondario-dark-2)', 'neutral', pg.ppCur != null ? pg.ppCur : pp, pp) +
        ((pg.gemme || []).length ? bar('Gemme attive', 'var(--magico-forte)', 'magic', pg.gemme.filter(g => g.stato === 'attiva').length, pg.gemme.length) : '') +
        '<p class="helper-text">P.R. ' + esc(pg.prCur) + ' / ' + esc(pg.prMaxTracked) + '</p>');
  }

  function tratti(pg) {
    const labels = typeof TRAIT_LIST_LABELS !== 'undefined' ? TRAIT_LIST_LABELS : { conoscenze: 'Conoscenze', capacitaNormali: 'Capacità Normali', capacitaCombattive: 'Capacità Combattive' };
    return Object.keys(labels).map(k => {
      const own = Object.entries((pg.traits || {})[k] || {}).filter(([, v]) => Number(v) > 0).sort((a, b) => b[1] - a[1]);
      return box(labels[k], k === 'capacitaCombattive' ? 'physical' : k === 'conoscenze' ? 'magic' : 'neutral',
        table(own.map(([n, v]) => '<tr><td>' + esc(n) + '</td><td class="num">' + esc(v) + '</td><td class="num">+' + esc(v) + '</td></tr>').join('')));
    }).join('');
  }

  /* ------------------------------------------ tecniche, magie, slot

     Ogni capacità ha una struttura esplicita (rm-solo-capacita/1): i
     valori vengono dai dati, mai da regole generiche. Un valore non
     ancora definito si mostra come «—» ed è marcato «da approvare»; un
     valore proposto (fonte P) è evidenziato. Il costo in MP delle Abilità
     magiche segue il livello (abilitaCostoForLv); la crescita per uso
     (utilizziLimitFor, dal Q.I.) è una regola di progressione, non un
     limite di utilizzo. */
  const STAT_NOMI = { hp: 'HP', mp: 'MP', for: 'Forza', mira: 'Mira', vel: 'Velocità', fmen: 'Forza Magica', dex: 'Destrezza', dif: 'Difesa', dmen: 'Difesa Magica' };
  const RISORSE = { gemma: 'Gemma equipaggiata', energia_armatura: 'Energia dell\'armatura (MP)', vitalita: 'Consumo di vitalità (HP)', per_scena: 'Utilizzo per scena', per_combattimento: 'Utilizzo per combattimento' };
  const CATEGORIE = { tecnica: 'Tecnica', magia: 'Magia', 'abilità': 'Abilità' };
  const AZIONI = { attacco: 'Attacco', difesa: 'Difesa', supporto: 'Supporto', controllo: 'Controllo', 'utilità': 'Utilità' };
  function crescita(lv, qi) {
    if (typeof utilizziLimitFor !== 'function') return '';
    if (qi != null) return 'sale di livello dopo ' + utilizziLimitFor(qi, lv) + ' usi';
    // Q.I. = (1d4 + 1d6 + 1d10) × 10: da 30 a 200
    const a = utilizziLimitFor(200, lv), b = utilizziLimitFor(30, lv);
    return 'sale di livello dopo ' + (a === b ? a : 'da ' + a + ' a ' + b) + ' usi, secondo il Q.I.';
  }
  function kv(rows) { return '<dl class="solo-kv">' + rows.filter(r => r[1] !== '' && r[1] != null).map(r => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>'; }
  const DA_APPROVARE = '<span class="solo-tbd" title="Valore non ancora definito">— <small>da approvare</small></span>';
  // etichette editoriali (da approvare, proposta) solo in sviluppo
  let DEV = false;
  function val(t, campo, testo) {
    if (!DEV) return esc(testo == null || testo === '' ? '—' : testo);
    const tbd = (t.daApprovare || []).some(x => x.indexOf(campo) === 0);
    if (tbd && (testo === null || testo === undefined || testo === '')) return DA_APPROVARE;
    const out = esc(testo == null || testo === '' ? '—' : testo);
    if ((t.fonti || {})[campo] === 'P') return '<mark class="solo-proposta" title="Proposta da approvare">' + out + '</mark>';
    return out + (tbd ? ' <small class="solo-tbd">(da approvare)</small>' : '');
  }
  function listaBM(l) { return (l || []).map(x => x.testo).join(', '); }
  function capCard(tIn, pg, opts) {
    const E = typeof RMSoloEngine !== 'undefined' ? RMSoloEngine : null;
    // in anteprima le proposte valgono come valori (senza etichette fuori dallo sviluppo)
    const t = E && opts && opts.anteprima ? E.effectiveCap(tIn, true) : tIn;
    const kind = t.fuoriSlot ? 'gemma' : t.categoria === 'magia' ? 'abilita' : 'tecnica';
    const costo = t.costoMP == null ? null : ((kind === 'abilita' || (kind === 'gemma' && t.categoria === 'magia')) && typeof abilitaCostoForLv === 'function' ? abilitaCostoForLv(t.lv || 1) : t.costoMP) + ' MP';
    const ris = t.risorsaSpeciale ? RISORSE[t.risorsaSpeciale] + (t.risorsaSpeciale === 'gemma' && t.gemma ? ': ' + gemName(pg, t.gemma) : '') : ((t.daApprovare || []).indexOf('risorsaSpeciale') !== -1 ? null : 'nessuna');
    const costoRis = t.risorsaSpeciale === 'gemma' ? 'la gemma non si consuma' : t.costoRisorsaSpeciale == null ? null : String(t.costoRisorsaSpeciale);
    const durata = t.durataTurni == null ? null : t.durataTurni === 0 ? 'istantanea' : t.durataTurni + (t.durataTurni === 1 ? ' turno' : ' turni');
    const stato = opts && opts.statoCapacita ? opts.statoCapacita(kind, t) : null;
    return '<div class="solo-cap' + (stato && !stato.ok ? ' solo-cap-off' : '') + '"><div class="solo-cap-head"><b>' + esc(t.nome) + '</b><span class="chip">' + esc(CATEGORIE[t.categoria] || t.categoria || '') + ' · Lv ' + esc(t.lv || 1) + '</span></div>' +
      (stato && !stato.ok ? '<p class="solo-warn">' + esc(stato.motivo) + '</p>' : '') +
      kv([['Tipo di azione', val(t, 'tipoAzione', AZIONI[t.tipoAzione] || t.tipoAzione)],
        ['Bersaglio', val(t, 'bersaglio', t.bersaglio)],
        ['Danno base', val(t, 'dannoBase', t.dannoBase ? String(t.dannoBase) : '0')],
        ['Effetto', val(t, 'effetto', t.effetto)],
        ['Costo in MP', val(t, 'costoMP', costo)],
        ['Risorsa speciale', val(t, 'risorsaSpeciale', ris)],
        ['Costo della risorsa', val(t, 'costoRisorsaSpeciale', costoRis)],
        ['Limite di utilizzo', val(t, 'utilizziMassimi', t.utilizziMassimi == null ? null : t.utilizziMassimi === 'illimitato' ? 'nessuno oltre al costo' : String(t.utilizziMassimi))],
        ['Durata', val(t, 'durataTurni', durata)],
        ['Condizioni', val(t, 'condizioniUso', (t.condizioniUso || []).join('; ') || 'nessuna')],
        ['Bonus', val(t, 'bonus', listaBM(t.bonus) || 'nessuno')],
        ['Malus', val(t, 'malus', listaBM(t.malus) || 'nessuno')],
        ['Livello richiesto', val(t, 'livelloRichiesto', String(t.livelloRichiesto || 1))],
        ['Slot occupati', val(t, 'slotRichiesti', t.slotRichiesti == null ? null : String(t.slotRichiesti))],
        t.forzatura ? ['Forzatura dell\'armatura', t.forzatura.consentita === true ? 'consentita: ' + esc(t.forzatura.costoVitalita) + ' HP' : t.forzatura.consentita === false ? 'non consentita' : (DEV ? DA_APPROVARE : '—')] : ['', ''],
        ['Crescita', t.categoria === 'abilità' ? '' : esc(crescita(t.lv || 1, pg.qi))]]) + '</div>';
  }
  // chi canalizza attraverso le gemme: "capacità delle gemme" invece di "magie"
  function usaGemme(pg) { return (pg.gemme || []).length > 0 && (pg.abilita || []).some(a => a.risorsaSpeciale === 'gemma' || (a.proposte || {}).risorsaSpeciale === 'gemma'); }
  function gemName(pg, id) { const g = (pg.gemme || []).find(x => x.id === id); return g ? g.nome : id; }
  const TIPI_GEMMA = { cura: 'Cura', attacco: 'Attacco', difesa: 'Difesa', caratteristiche: 'Caratteristiche' };
  /* Gemme dei Chorisfos: stato, capacità associata e MP recuperabili. Il
     pulsante di scarica compare solo se l'azione è possibile ora. */
  function gemme(pg, opts) {
    if (!(pg.gemme || []).length) return '';
    const info = g => (opts && opts.gemInfo) ? opts.gemInfo(g.id) : null;
    const rec = typeof RMSoloEngine !== 'undefined' ? RMSoloEngine.gemRecovery(pg) : null;
    const cards = pg.gemme.map(g => {
      const i = info(g);
      const capN = g.capacitaSospesa ? ((pg.capacitaIncompatibili || []).find(x => x.id === g.capacitaAssociata) || {}).nome + (DEV ? ' (sospesa: non compatibile con la classe, in attesa di approvazione)' : ' (non disponibile per la classe attuale)')
        : ([].concat(pg.tecniche || [], pg.abilita || [], pg.capacitaSpeciali || []).find(x => x.id === g.capacitaAssociata) || {}).nome || g.capacitaAssociata;
      return '<div class="solo-cap solo-gem' + (g.stato === 'scarica' ? ' scarica' : '') + '"><div class="solo-cap-head"><b>' + esc(g.nome) + '</b><span class="chip solo-gem-state">' + (g.stato === 'attiva' ? 'Attiva' : 'Scarica') + '</span></div>' +
        kv([['Tipo', esc(TIPI_GEMMA[g.tipo] || g.tipo)], ['Capacità associata', esc(capN)], ['Effetto attivo', esc(g.effettoAttivo)],
          ['MP recuperabili', g.stato === 'attiva' ? esc(i ? i.recuperoEffettivo + (i.recuperoEffettivo < i.recuperoMP ? ' (su ' + i.recuperoMP + ': non oltre il massimo)' : '') : rec) : '—']]) +
        (i && i.scaricabile ? '<button type="button" class="btn btn-ghost btn-sm solo-act" data-scarica="' + esc(g.id) + '">Scarica per recuperare MP</button>' : '') + '</div>';
    }).join('');
    return box('Gemme <span class="chip" style="margin-left:auto;">' + pg.gemme.filter(g => g.stato === 'attiva').length + '/' + pg.gemme.length + ' attive</span>', 'magic',
      cards + '<p class="helper-text">Una gemma attiva permette la sua capacità, che costa MP. Scaricarla richiede un\'azione completa e restituisce il ' +
      (typeof RMSoloRules !== 'undefined' ? RMSoloRules.SOLO_TUNING.gemme.recuperoMpPercentuale : 20) + '% degli MP massimi; resta spenta fino al reintegro a un avamposto (una gemma per avamposto).</p>');
  }
  /* Slot della classe al livello attuale e prossimi sblocchi (regola
     tecAbSbloccate dell'app), fino al Lv 30. */
  function slotInfo(pg) {
    if (typeof tecAbSbloccate !== 'function') return null;
    const now = tecAbSbloccate(pg.build, pg.livello, {});
    const future = [];
    let prev = now;
    for (let lv = pg.livello + 1; lv <= 30; lv++) {
      const n = tecAbSbloccate(pg.build, lv, {});
      for (let i = prev.tec; i < n.tec; i++) future.push({ tipo: 'Tecnica', lv });
      for (let i = prev.ab; i < n.ab; i++) future.push({ tipo: usaGemme(pg) ? 'Capacità della gemma' : 'Magia', lv });
      prev = n;
    }
    return { tec: now.tec, ab: now.ab, future };
  }
  function slots(pg) {
    const s = slotInfo(pg);
    if (!s) return '';
    const cell = (label, pieno, extra) => '<li class="solo-slot-cell' + (pieno ? ' pieno' : ' vuoto') + '"' + (pieno ? '' : ' aria-disabled="true"') + '>' + label + (extra ? '<small>' + extra + '</small>' : '') + '</li>';
    const occ = [];
    const vacTec = (pg.slotVacanti || []).some(v => v.tipo === 'tecnica');
    for (let i = 0; i < s.tec; i++) occ.push(cell('Tecnica', !!pg.tecniche[i], pg.tecniche[i] ? esc(pg.tecniche[i].nome) : (vacTec && DEV ? 'da assegnare (in attesa dell\'autore)' : 'libero')));
    for (let i = 0; i < s.ab; i++) occ.push(cell(usaGemme(pg) ? 'Capacità della gemma' : 'Magia', !!pg.abilita[i], pg.abilita[i] ? esc(pg.abilita[i].nome) : 'libero'));
    const next = s.future.slice(0, 6).map(f => cell(f.tipo, false, 'Richiede un livello superiore (Lv ' + f.lv + ')'));
    return box('Slot della classe <span class="chip" style="margin-left:auto;">' + (pg.tecniche.length + pg.abilita.length) + '/' + (s.tec + s.ab) + ' occupati</span>', '',
      '<ul class="solo-slots">' + occ.join('') + next.join('') + '</ul>' +
      '<p class="helper-text">Gli slot successivi si sbloccano salendo di livello proseguendo nella storia.</p>');
  }
  function capacita(pg, opts) {
    const spec = (pg.capacitaSpeciali || []).filter(t => DEV || (t.fuoriSlot && typeof RMSoloEngine !== 'undefined' && !RMSoloEngine.capGaps(t, false).length));
    // per chi canalizza attraverso le gemme le Abilità sono capacità delle gemme
    const conGemme = usaGemme(pg);
    return box('Tecniche <span class="chip" style="margin-left:auto;">' + pg.tecniche.length + '</span>', 'physical',
        pg.tecniche.map(t => capCard(t, pg, opts)).join('') || '<p class="helper-text">Nessuna tecnica al livello attuale.</p>') +
      box((conGemme ? 'Capacità delle gemme (Abilità)' : 'Magie (Abilità)') + ' <span class="chip" style="margin-left:auto;">' + pg.abilita.length + '</span>', 'magic',
        pg.abilita.map(t => capCard(t, pg, opts)).join('') || '<p class="helper-text">Nessuna abilità al livello attuale.</p>') +
      gemme(pg, opts) +
      (spec.length ? box('Capacità delle gemme fuori slot', 'magic', spec.map(t => capCard(t, pg, opts)).join('') +
        '<p class="helper-text">Non occupano gli slot della classe; richiedono la gemma associata attiva. Le capacità con valori mancanti restano indisponibili.</p>') : '') +
      slots(pg);
  }

  /* Statistiche: stessa terminologia e stesso ordine della scheda dell'app
     (PRIMARY_STATS, P.R., terziarie), valori effettivi del regolamento. */
  function statistiche(pg) {
    const P = typeof PRIMARY_STATS !== 'undefined' ? PRIMARY_STATS : [];
    const hpMult = pg.primary.hp ? Math.round(pg.hpMaxTracked / pg.primary.hp) : 0;
    const mpMult = pg.primary.mp ? Math.round(pg.mpMaxTracked / pg.primary.mp) : 0;
    const prim = P.map(st => {
      const v = pg.primary[st.key];
      const eff = st.key === 'hp' ? pg.hpMaxTracked + ' (' + v + ' × ' + hpMult + ')' : st.key === 'mp' ? pg.mpMaxTracked + ' (' + v + ' × ' + mpMult + ')' : v;
      return '<tr><td class="field">' + esc(st.full || st.label) + '</td><td class="num">' + esc(eff) + '</td></tr>';
    }).join('');
    const pp = Math.round((pg.hpMaxTracked || 0) / 2 + (pg.mpMaxTracked || 0) / 2);
    const sec = '<tr><td class="field">P.R. (Punti Recupero)</td><td class="num">' + esc(pg.prMaxTracked) + '</td></tr><tr><td class="field">PP (Boost)</td><td class="num">' + esc(pp) + '</td></tr>' +
      '<tr><td class="field">Q.I.</td><td class="num">' + esc(pg.qi == null ? 'tirato a inizio partita' : pg.qi) + '</td></tr>';
    const ter = (typeof TERTIARY_STATS !== 'undefined' ? TERTIARY_STATS : []).map(st => '<tr><td class="field">' + esc(st.label) + '</td><td class="num">' + esc(pg.tertiary[st.key]) + '</td></tr>').join('');
    return box('Caratteristiche primarie · 40 punti', '', table(prim)) + box('Statistiche secondarie', '', table(sec)) + box('Statistiche terziarie · 5 punti', '', table(ter)) + tratti(pg);
  }

  const TIPI_EQ = { arma: 'Arma', armatura: 'Armatura o protezione', scudo: 'Scudo', descrittivo: 'Dotazione' };
  // cosa fa davvero il pezzo nello scontro in solitaria (regole del motore)
  const USO_EQ = { arma: 'Danno base dell\'«Attacco con l\'arma»', armatura: 'La Difesa entra nella salvezza', scudo: 'Rende possibile il Blocco' };
  function equip(pg, inventario, zainoIniziale) {
    const eq = (pg.equip || []).map(e => {
      const stat = e.atk == null ? '' : 'Atk ' + e.atk + ' · Dif ' + e.dif + ' · Durabilità ' + e.durabilita + (e.resistenza ? ' · Resistenza ' + e.resistenza : '');
      return '<div class="solo-cap"><div class="solo-cap-head"><b>' + esc(e.nome) + '</b><span class="chip">' + esc(TIPI_EQ[e.tipo] || e.tipo) + (e.classe === 'tiro' ? ' a distanza' : '') + '</span></div>' +
        (e.descrizione ? '<p class="helper-text">' + esc(e.descrizione) + '</p>' : '') +
        kv([['Qualità', e.qualita ? esc(e.qualita) : '—'], ['Taglia', e.taglia ? esc(e.taglia) : ''], ['Valori', esc(stat)], ['In combattimento', esc(e.atk == null ? 'nessun effetto' : USO_EQ[e.tipo] || '')]].concat(e.nota ? [['Nota', esc(e.nota)]] : [])) + '</div>';
    }).join('');
    const riga = i => '<tr><td class="field">' + esc(i.nome) + '</td><td class="num">' + (i.qty > 1 ? '×' + esc(i.qty) : '') + '</td></tr>';
    const inv = (inventario || []).map(riga).join('');
    const iniziale = (zainoIniziale || []).map(riga).join('');
    return box('Equipaggiamento', 'physical', eq || '<p class="helper-text">Nessuno.</p>') +
      box(inventario ? 'Zaino' : 'Zaino iniziale', '', inventario ? table(inv) : iniziale ? table(iniziale) : '<p class="helper-text">Nessun oggetto oltre all\'equipaggiamento: il resto si trova giocando.</p>');
  }

  // provenienza pubblica: Ich separa società e figura trasversale (ontologia), mai la natura riservata
  function provenienza(a, fallback) {
    const O = typeof RMSoloOntologia !== 'undefined' ? RMSoloOntologia : null;
    const storia = a && String(a.campaign_id || a.capitolo || '').split('-')[0];
    return (O && a ? O.etichetta(a, storia) : null) || fallback;
  }
  function identita(pg, opts) {
    const url = portraitUrl(pg, opts);
    const B = typeof BUILDS !== 'undefined' ? BUILDS : {};
    const prov = [provenienza(opts && opts.archetipo, pg.popolazione), opts && opts.archetipo && opts.archetipo.citta].filter(Boolean).join(' · ');
    const rows = [['Nome', pg.nome], ['Provenienza', prov], ['Appartenenza politica', pg.appartenenzaPolitica || ''], ['Ruolo', pg.mansione], ['Classe', (B[pg.build] || {}).label || pg.build], ['Livello', pg.livello], ['Q.I.', pg.qi == null ? 'tirato a inizio partita' : pg.qi], ['AP disponibili', pg.apDisponibili]]
      .map(r => '<tr><td class="field" style="white-space:nowrap;color:var(--testo-secondario-dark);">' + r[0] + '</td><td>' + esc(r[1]) + '</td></tr>').join('');
    return box('Volto del personaggio', '', '<div class="solo-portrait-row"><div class="solo-portrait"' + (url ? ' style="background-image:url(\'' + esc(url) + '\')"' : '') + ' role="img" aria-label="Ritratto di ' + esc(pg.nome) + '">' + (url ? '' : esc((pg.nome || '?').charAt(0))) + '</div>' +
      (opts && opts.editabile ? '<div class="solo-portrait-actions"><label class="btn btn-ghost btn-sm solo-file">Cambia volto<input type="file" accept="image/*" id="solo-portrait-file" hidden></label>' +
        (pg.ritratto ? '<button class="btn btn-ghost btn-sm" id="solo-portrait-reset">' + (opts.ritrattoPredefinito ? 'Torna al volto predefinito' : 'Rimuovi') + '</button>' : '') + '</div>' : '') + '</div>') +
      box('Anagrafica', '', table(rows)) +
      box('Premessa personale', '', '<p class="solo-bg">' + esc(pg.background) + '</p>' + (pg.obiettivo ? '<p class="solo-bg"><b>Obiettivo iniziale:</b> ' + esc(pg.obiettivo) + '</p>' : '')) +
      (opts && opts.archetipo ? legami(opts.archetipo, opts.pngNomi) : '');
  }
  // legami e conoscenze pubbliche (mai segreti del narratore)
  function legami(a, nomi) {
    const pul = t => String(t || '').replace(/\s*\(proposta\)\s*$/i, '');
    const l = (a.legami_iniziali || []).map(x => '<li><b>' + esc((nomi && nomi[x.png]) || x.png) + '</b> — ' + esc(pul(x.natura)) + '</li>').join('');
    const c = (a.conoscenze || []).map(x => '<li>' + esc(typeof x === 'string' ? x : (x.testo || x.nome || '')) + '</li>').join('');
    return box('Legami e conoscenze', '', (l ? '<ul class="solo-list">' + l + '</ul>' : '') + (c ? '<ul class="solo-list">' + c + '</ul>' : '') + (!l && !c ? '<p class="helper-text">Nessuno all\'inizio.</p>' : ''));
  }

  const TABS = [['fronte', 'Fronte Scheda'], ['identita', 'Identità'], ['statistiche', 'Statistiche'], ['capacita', 'Tecniche e magie'], ['equip', 'Equipaggiamento']];

  /* opts: { tab, editabile, inventario, ritrattoPredefinito, id } */
  function render(pg, opts) {
    opts = opts || {};
    DEV = !!opts.dev;
    const tab = opts.tab || 'fronte';
    const url = portraitUrl(pg, opts);
    const B = typeof BUILDS !== 'undefined' ? BUILDS : {};
    const body = tab === 'identita' ? identita(pg, opts) : tab === 'statistiche' ? statistiche(pg) : tab === 'tratti' ? tratti(pg)
      : tab === 'capacita' ? capacita(pg, opts)
        : tab === 'equip' ? equip(pg, opts.inventario, opts.zainoIniziale) : fronte(pg);
    return '<div class="solo-sheet" data-sheet="' + esc(opts.id || 'pg') + '">' +
      '<div class="solo-sheet-head"><div class="header-avatar solo-avatar"' + (url ? ' style="background-image:url(\'' + esc(url) + '\')"' : '') + '></div>' +
      '<div class="who"><div class="solo-sheet-name">' + esc(pg.nome) + '</div><div class="sub">' + esc([(B[pg.build] || {}).label, pg.popolazione, 'Lv ' + pg.livello].filter(Boolean).join(' · ')) + '</div></div></div>' +
      '<nav class="tabs solo-sheet-tabs">' + TABS.map(([k, l]) => '<button type="button" class="tab-btn' + (k === tab ? ' active' : '') + '" data-sheet-tab="' + k + '">' + l + '</button>').join('') + '</nav>' +
      '<div class="tab-panel active solo-sheet-body">' + body + '</div></div>';
  }

  /* Collega le schede della scheda: onTab(nuovaTab) ridisegna. */
  function wire(rootEl, onTab) {
    rootEl.querySelectorAll('[data-sheet-tab]').forEach(b => b.addEventListener('click', () => onTab(b.dataset.sheetTab)));
    // la scheda attiva resta visibile anche quando la barra scorre
    const bar = rootEl.querySelector('.solo-sheet-tabs'), act = bar && bar.querySelector('.tab-btn.active');
    if (bar && act) bar.scrollLeft = Math.max(0, act.offsetLeft - (bar.clientWidth - act.clientWidth) / 2);
  }

  /* --------------------------------------------- scelta e confronto */

  // carta compatta per la scelta iniziale: la scheda, non il volto, al centro
  function card(a, pg, opts) {
    const B = typeof BUILDS !== 'undefined' ? BUILDS : {};
    const desc = String(a.background || '').split(/(?<=[.!?])\s/)[0];
    return '<article class="solo-pgcard" data-v="' + esc(a.id) + '">' +
      '<div class="solo-pgcard-head">' + (a.ritratto ? '<img class="solo-pgcard-img" src="' + esc(a.ritratto) + '" alt="' + esc(a.ritratto_alt || a.nome) + '" loading="lazy" width="44" height="44">' : '') +
      '<div><h3>' + esc(a.nome) + '</h3><p class="solo-pgcard-sub">' + esc([provenienza(a, a.popolazione), a.citta].filter(Boolean).join(' · ')) + '</p></div>' +
      '<span class="chip">' + esc((B[a.build] || {}).label || a.build) + ' · Lv 1</span></div>' +
      '<p class="solo-pgcard-role">' + esc(a.mansione) + '</p>' +
      '<p class="solo-pgcard-desc">' + esc(desc) + '</p>' +
      '<p class="solo-pgcard-goal"><b>Obiettivo:</b> ' + esc(a.obiettivo) + '</p>' +
      '<ul class="solo-pgcard-stats"><li><b>' + pg.hpMaxTracked + '</b> HP</li><li><b>' + pg.mpMaxTracked + '</b> MP</li><li><b>' + pg.tecniche.length + '</b> tecniche</li><li><b>' + pg.abilita.length + '</b> ' + (usaGemme(pg) ? 'cap. gemme' : 'magie') + '</li></ul>' +
      (opts && opts.nota ? '<p class="solo-warn">' + esc(opts.nota) + '</p>' : '') +
      '<div class="solo-pgcard-actions"><button type="button" class="btn btn-primary btn-sm solo-act" data-apri="' + esc(a.id) + '">Apri la scheda</button>' +
      '<label class="solo-compare-check"><input type="checkbox" data-confronta="' + esc(a.id) + '"' + (opts && opts.confronto ? ' checked' : '') + '> Confronta</label></div></article>';
  }

  // stile di gioco: dalla classe e dalle caratteristiche più alte (nessuna
  // regola nuova, solo una lettura dei valori)
  function stile(pg) {
    const B = typeof BUILDS !== 'undefined' ? BUILDS : {};
    const top = Object.entries(pg.primary).filter(([k]) => k !== 'hp' && k !== 'mp').sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => STAT_NOMI[k] + ' ' + v);
    const via = pg.abilita.length > pg.tecniche.length ? 'soprattutto con la magia' : pg.tecniche.length > pg.abilita.length ? 'soprattutto con le tecniche' : 'alternando tecniche e magia';
    return ((B[pg.build] || {}).label || pg.build) + ': combatte ' + via + '; punti di forza ' + top.join(' e ') + '.';
  }
  function eqQualita(pg) {
    const q = (pg.equip || []).map(e => e.qualita).filter(Boolean);
    return q.length ? Array.from(new Set(q)).join(', ') : 'dotazione descrittiva';
  }
  function compare(a, pa, b, pb) {
    const B = typeof BUILDS !== 'undefined' ? BUILDS : {};
    const P = typeof PRIMARY_STATS !== 'undefined' ? PRIMARY_STATS : [];
    const col = (x, p, f) => '<div class="solo-cmp-cell"><span class="solo-cmp-who">' + esc(x.nome) + '</span>' + f(x, p) + '</div>';
    const row = (title, f) => '<section class="solo-cmp-row"><h4>' + title + '</h4><div class="solo-cmp-pair">' + col(a, pa, f) + col(b, pb, f) + '</div></section>';
    const list = arr => arr.length ? '<ul class="solo-list">' + arr.map(t => '<li>' + esc(t.nome) + (t.dannoBase ? ' — ' + t.dannoBase + ' danni' : '') + '</li>').join('') + '</ul>' : '<p class="helper-text">—</p>';
    return '<div class="solo-cmp">' +
      row('Classe', (x, p) => '<p>' + esc((B[p.build] || {}).label) + ' · Lv 1</p>') +
      row('HP e MP', (x, p) => '<p>' + p.hpMaxTracked + ' HP · ' + p.mpMaxTracked + ' MP</p>') +
      row('Caratteristiche', (x, p) => '<dl class="solo-kv">' + P.filter(s => s.key !== 'hp' && s.key !== 'mp').map(s => '<dt>' + esc(s.full) + '</dt><dd>' + p.primary[s.key] + '</dd>').join('') + '</dl>') +
      row('Tecniche', (x, p) => list(p.tecniche)) +
      row('Magie o capacità delle gemme', (x, p) => list(p.abilita)) +
      row('Equipaggiamento', (x, p) => '<p>Qualità: ' + esc(eqQualita(p)) + '</p>') +
      row('Stile di gioco', (x, p) => '<p>' + esc(stile(p)) + '</p>') + '</div>';
  }

  global.RMSoloSheet = { render, wire, TABS, card, compare, stile, slotInfo };
})(typeof window !== 'undefined' ? window : globalThis);
