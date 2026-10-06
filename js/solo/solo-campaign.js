/* ==========================================================================
   Role Makers — Gioca in solitaria: contratto della campagna in tre atti,
   conseguenze differite, stato personale/sociale, registro delle decisioni
   e pianificatore di scena. Funzioni pure (pacchetto avventure §3–4, §7–8).

   Formato 'rm-solo-campagna/1'. Ogni campagna dichiara un contratto
   narrativo (premessa pubblica, verità riservate, scopo, fatti immutabili,
   snodi obbligatori, libertà, conseguenze variabili) e ESATTAMENTE tre
   atti. Il finale non è più un evento canonico immutabile (pacchetto V4):
   è un contratto (ending_contract) con domanda di chiusura, assi di esito
   e un insieme finito di varianti scelte dal motore con regole
   deterministiche; l'IA le racconta soltanto. I vecchi `finali` della
   fixture restano leggibili come contratto a più varianti.

   Contenuti V4: ogni scena, PNG, fatto, oggetto, modello di loot, variante
   e archetipo porta i metadati campaign_id, content_status, act,
   level_band, difficulty_tags, visibility_rule e source_note; il
   validatore controlla riferimenti, grafo terminabile, vie alternative
   degli oggetti chiave e lessico riservato nei testi pubblici.

   Tre stati separati nella partita:
   - meccanico: scheda, risorse, inventario (solo-engine / solo-loot);
   - narrativo: atto, snodi, obiettivi, fatti scoperti, conseguenze;
   - personale e sociale: legami (atteggiamento PNG), reputazione per
     fazione, promesse, voci, decisioni significative con i loro eventi.
   Nessuna identità morale dedotta da una singola azione: si registrano le
   azioni e le loro conseguenze, non un punteggio buono/cattivo.
   ========================================================================== */
(function (global) {
  'use strict';

  const FORMATO = 'rm-solo-campagna/1';
  const STATI_EDITORIALI = ['bozza', 'approvato', 'fixture_tecnica'];

  /* ------------------------------------------------------- condizioni */

  // Condizioni ammesse (insieme chiuso). `scenaCorrente` serve alle
  // condizioni legate alla scena (incontro concluso, scelta fatta).
  function conditionMet(state, cond) {
    if (!cond) return false;
    if (cond.tutti) return cond.tutti.every(c => conditionMet(state, c));
    if (cond.qualunque) return cond.qualunque.some(c => conditionMet(state, c));
    if (cond.non) return !conditionMet(state, cond.non);
    if (cond.obiettivo_tentato) return !!(state.obiettivi[cond.obiettivo_tentato] && state.obiettivi[cond.obiettivo_tentato].tentativi > 0);
    if (cond.obiettivo_raggiunto) return !!(state.obiettivi[cond.obiettivo_raggiunto] && state.obiettivi[cond.obiettivo_raggiunto].completato);
    if (cond.flag) return !!state.flags[cond.flag];
    if (cond.flag_almeno) return (Number(state.flags[cond.flag_almeno.flag]) || 0) >= cond.flag_almeno.valore;
    if (cond.incontro_concluso) return !!state.flags['incontro_' + state.scena + '_concluso'];
    if (cond.scelta_fatta) return !!state.scelte[state.scena];
    if (cond.scelta) return state.scelte[cond.scelta.scena] === cond.scelta.id;
    if (cond.orologio_pieno) { const o = state.orologi[cond.orologio_pieno]; return !!(o && o.valore >= o.max); }
    if (cond.atto) return (state.atto || 1) >= cond.atto;
    if (cond.scena) return state.scena === cond.scena;
    if (cond.snodo) return !!(state.snodi && state.snodi[cond.snodo]);
    if (cond.fatto_scoperto) return state.fattiScoperti.indexOf(cond.fatto_scoperto) !== -1;
    if (cond.relazione_almeno) { const p = state.png[cond.relazione_almeno.png]; return !!p && p.atteggiamento >= cond.relazione_almeno.valore; }
    if (cond.relazione_al_piu) { const p = state.png[cond.relazione_al_piu.png]; return !!p && p.atteggiamento <= cond.relazione_al_piu.valore; }
    // V4: archetipo, difficoltà, possesso, assi di esito, verità, risorse,
    // livello e destino degli oggetti chiave
    if (cond.archetipo) return [].concat(cond.archetipo).indexOf(state.personaggio && state.personaggio.archetipo) !== -1;
    if (cond.difficolta) return [].concat(cond.difficolta).indexOf(state.difficolta) !== -1;
    if (cond.possiede) return (state.inventario || []).some(i => i.id === cond.possiede && i.qty > 0);
    if (cond.asse_almeno) return axisValue(state, cond.asse_almeno.asse) >= cond.asse_almeno.valore;
    if (cond.asse_al_piu) return axisValue(state, cond.asse_al_piu.asse) <= cond.asse_al_piu.valore;
    if (cond.verita_almeno) return (cond.verita_almeno.tra || []).filter(f => state.fattiScoperti.indexOf(f) !== -1).length >= cond.verita_almeno.valore;
    if (cond.risorsa_almeno) return ((state.risorse || {})[cond.risorsa_almeno.id] || 0) >= cond.risorsa_almeno.valore;
    if (cond.risorsa_al_piu) return ((state.risorse || {})[cond.risorsa_al_piu.id] || 0) <= cond.risorsa_al_piu.valore;
    if (cond.livello_almeno) return (state.personaggio && state.personaggio.livello || 1) >= cond.livello_almeno;
    if (cond.custodito) return !!(state.custodi && state.custodi[cond.custodito]);
    if (cond.perso) return !!(state.oggettiPersi && state.oggettiPersi[cond.perso]);
    if (cond.sempre) return true;
    return false;
  }

  const CONDIZIONI = ['tutti', 'qualunque', 'non', 'obiettivo_tentato', 'obiettivo_raggiunto', 'flag', 'flag_almeno', 'incontro_concluso', 'scelta_fatta', 'scelta',
    'orologio_pieno', 'atto', 'scena', 'snodo', 'fatto_scoperto', 'relazione_almeno', 'relazione_al_piu', 'archetipo', 'difficolta', 'possiede',
    'asse_almeno', 'asse_al_piu', 'verita_almeno', 'risorsa_almeno', 'risorsa_al_piu', 'livello_almeno', 'custodito', 'perso', 'sempre'];

  /* --------------------------------------------------- assi di esito */

  const ASSE_MIN = -3, ASSE_MAX = 3;
  function axisValue(state, id) { return Number(state.assi && state.assi[id]) || 0; }
  function clampAxis(v) { return Math.max(ASSE_MIN, Math.min(ASSE_MAX, v)); }

  /* Assi ricalcolati SOLO dal registro degli eventi (più gli effetti del
     comando in corso, non ancora registrato): mai da un riassunto dell'IA
     né da un contatore modificabile a parte. La somma viene limitata a
     −3/+3 alla fine, come intervallo dichiarato dalle schede. */
  function axesFromEvents(state, pending) {
    const out = {};
    const add = a => { if (a.tipo === 'asse') out[a.asse] = (out[a.asse] || 0) + a.delta; };
    (state.eventi || []).forEach(ev => (ev.effetti || []).forEach(add));
    (state.effettiIniziali || []).forEach(add);
    (pending || []).forEach(add);
    Object.keys(out).forEach(k => { out[k] = clampAxis(out[k]); });
    return out;
  }

  /* --------------------------------------------------------- atti */

  function actOfScene(content, sceneId) {
    const a = (content.atti || []).find(x => (x.scene || []).indexOf(sceneId) !== -1);
    return a ? a.numero : null;
  }
  function actDef(content, n) { return (content.atti || []).find(a => a.numero === n) || null; }

  function actComplete(state, content, n) {
    const a = actDef(content, n);
    if (!a) return false;
    return (a.snodi || []).every(s => state.snodi && state.snodi[s.id]);
  }

  function missingNodes(state, content, n) {
    const a = actDef(content, n);
    return a ? (a.snodi || []).filter(s => !(state.snodi && state.snodi[s.id])) : [];
  }

  /* ----------------------------------------------- validazione contenuti */

  function collectEffects(content) {
    const out = [];
    const push = (where, list) => (list || []).forEach(e => out.push({ where, e }));
    (content.scene || []).forEach(sc => {
      (sc.obiettivi || []).forEach(o => Object.entries(o.esiti || {}).forEach(([k, l]) => push(sc.id + '/' + o.id + '/' + k, l)));
      (sc.scelte || []).forEach(c => push(sc.id + '/scelta ' + c.id, c.effetti));
      (sc.uscite || []).forEach(u => push(sc.id + '/uscita>' + u.verso, u.effetti));
      if (sc.incontro) { push(sc.id + '/vittoria', sc.incontro.vittoria); push(sc.id + '/fuga', sc.incontro.fuga && sc.incontro.fuga.costo); }
    });
    Object.entries(content.orologi || {}).forEach(([k, o]) => push('orologio ' + k + '/al massimo', o.effetti_al_massimo));
    Object.entries(content.borsa && content.borsa.oggetti || {}).forEach(([k, o]) => push('oggetto ' + k + '/uso', o.effetto && o.effetto.effetti));
    // effetti annidati: conseguenze differite ed effetti condizionati (se)
    const all = [];
    const walk = x => {
      all.push(x);
      if (x.e.conseguenza) (x.e.conseguenza.effetti || []).forEach(e => walk({ where: x.where + '/conseguenza ' + x.e.conseguenza.id, e }));
      if (x.e.se) ((x.e.se.effetti || []).concat(x.e.se.altrimenti || [])).forEach(e => walk({ where: x.where + '/se', e }));
    };
    out.forEach(walk);
    return all;
  }

  // tutte le condizioni della campagna, con il luogo in cui compaiono
  function collectConditions(content) {
    const out = [];
    (content.scene || []).forEach(sc => {
      (sc.uscite || []).forEach(u => out.push({ where: sc.id + '/uscita>' + u.verso, c: u.quando }));
      (sc.obiettivi || []).forEach(o => { if (o.richiede && o.richiede.condizione) out.push({ where: sc.id + '/' + o.id + '/richiede', c: o.richiede.condizione }); });
      (sc.scelte || []).forEach(c => { if (c.richiede) out.push({ where: sc.id + '/scelta ' + c.id + '/richiede', c: c.richiede }); });
    });
    collectEffects(content).forEach(x => {
      if (x.e.conseguenza) out.push({ where: x.where, c: x.e.conseguenza.quando });
      if (x.e.se) out.push({ where: x.where + '/se', c: x.e.se.condizione });
    });
    (endingContract(content).variants || []).forEach(v => { if (v.condizione) out.push({ where: 'finale ' + v.id, c: v.condizione }); });
    return out;
  }

  /* Testi che il giocatore può vedere senza aver scoperto nulla: premessa,
     scene (titoli, luoghi, descrizioni, aperture, obiettivi, suggerimenti,
     scelte, testi di riserva), nomi e ruoli dei PNG, oggetti e loot. I
     fatti segreti restano fuori: si vedono solo dopo la scoperta. */
  function publicTexts(content) {
    const out = [];
    const add = (where, t) => { if (t) out.push({ where, t: String(t) }); };
    const c = content.contratto || {};
    add('premessa', c.premessa_pubblica); add('scopo', c.scopo); add('titolo', content.titolo);
    (c.fatti_immutabili || []).forEach((f, i) => add('fatto immutabile ' + i, f));
    (content.atti || []).forEach(a => { add('atto ' + a.numero, a.titolo); add('atto ' + a.numero, a.funzione); (a.snodi || []).forEach(n => add('snodo ' + n.id, n.testo)); });
    (content.scene || []).forEach(sc => {
      ['titolo', 'luogo', 'descrizione', 'apertura_riserva'].forEach(k => add(sc.id + '.' + k, sc[k]));
      Object.values(sc.apertura_per_archetipo || {}).forEach(t => add(sc.id + '.apertura', t));
      (sc.obiettivi || []).forEach(o => { add(sc.id + '/' + o.id, o.testo); Object.values(o.riserva || {}).forEach(t => add(sc.id + '/' + o.id + ' riserva', t)); });
      (sc.suggerimenti || []).forEach(x => add(sc.id + ' suggerimento', x.testo));
      (sc.scelte || []).forEach(x => { add(sc.id + ' scelta', x.testo); add(sc.id + ' scelta riserva', x.riserva); });
    });
    Object.entries(content.png || {}).forEach(([k, p]) => { add('png ' + k, p.nome); add('png ' + k, p.ruolo); });
    Object.entries(content.fatti || {}).forEach(([k, f]) => { if (!f.segreto) add('fatto ' + k, f.testo); });
    Object.entries(content.borsa && content.borsa.oggetti || {}).forEach(([k, o]) => { add('oggetto ' + k, o.nome); add('oggetto ' + k, o.descrizione); if (o.indizio) add('oggetto ' + k, o.indizio.visibile); });
    const L = content.loot && content.loot.componenti || {};
    Object.entries(L.basi || {}).forEach(([k, b]) => { add('loot ' + k, b.nome); add('loot ' + k, b.descrizione); });
    Object.entries(content.loot && content.loot.modelli || {}).forEach(([k, m]) => { add('modello ' + k, m.descrizione); });
    Object.entries(content.risorse || {}).forEach(([k, r]) => add('risorsa ' + k, r.nome));
    Object.entries(content.orologi || {}).forEach(([k, o]) => add('orologio ' + k, o.nome));
    // scene ampliate: esplorazione e dialoghi prima dello svolgimento
    const I = content.interazioni || {};
    add('interazioni', (I.regole || {}).riserva_libera);
    Object.entries(I.scene || {}).forEach(([sid, d]) => {
      add(sid + ' esplora libera', d.riserva_libera);
      (d.esplora || []).forEach(p => { add(sid + '/' + p.id, p.testo); add(sid + '/' + p.id + ' riserva', p.riserva); });
      (d.dialoghi || []).forEach(g => {
        const w = sid + ' dialogo ' + g.png;
        add(w, g.apertura); add(w, g.chiusura); add(w, g.riserva_libera);
        (g.argomenti || []).forEach(a => { add(w + '/' + a.id, a.testo); add(w + '/' + a.id + ' riserva', a.riserva); });
      });
    });
    return out;
  }

  // grafo delle scene: raggiungibili dalla prima seguendo le uscite
  function reachableScenes(content) {
    const seen = {}, q = [content.scene[0].id];
    while (q.length) {
      const id = q.shift(); if (seen[id]) continue; seen[id] = true;
      const sc = content.scene.find(s => s.id === id);
      (sc && sc.uscite || []).forEach(u => q.push(u.verso));
    }
    return seen;
  }

  function validateCampaign(content) {
    const E = [];
    if (content.formato !== FORMATO) E.push('formato: atteso ' + FORMATO);
    if (STATI_EDITORIALI.indexOf(content.stato_editoriale) === -1) E.push('stato_editoriale non valido');
    const c = content.contratto;
    if (!c) E.push('contratto narrativo mancante');
    else {
      ['premessa_pubblica', 'scopo'].forEach(k => { if (!c[k]) E.push('contratto: ' + k + ' mancante'); });
      if (!c.ending_contract && !('finale_canonico' in c)) E.push('contratto: manca il contratto del finale (ending_contract)');
      if (content.canonico && (content.stato_editoriale !== 'approvato' || content.content_status && content.content_status !== 'approved')) E.push('una campagna canonica richiede lo stato approvato dall\'autore');
      validateEndingContract(content).forEach(x => E.push(x));
      (c.verita_riservate || []).forEach(f => { if (!content.fatti[f] || !content.fatti[f].segreto) E.push('contratto: verità riservata ' + f + ' non è un fatto segreto'); });
    }
    const atti = content.atti || [];
    if (atti.length !== 3) E.push('servono esattamente tre atti (trovati ' + atti.length + ')');
    [1, 2, 3].forEach(n => { if (atti.filter(a => a.numero === n).length !== 1) E.push('atto ' + n + ' mancante o duplicato'); });
    const sceneIds = (content.scene || []).map(s => s.id);
    const seen = {};
    atti.forEach(a => {
      if (!(a.scene || []).length) E.push('atto ' + a.numero + ': nessuna scena');
      (a.scene || []).forEach(s => {
        if (sceneIds.indexOf(s) === -1) E.push('atto ' + a.numero + ': scena inesistente ' + s);
        if (seen[s]) E.push('scena ' + s + ' in più atti'); seen[s] = true;
      });
      if (a.numero < 3 && !(a.snodi || []).length) E.push('atto ' + a.numero + ': servono snodi di uscita');
      (a.pool || []).forEach(p => { if (!content.loot || !content.loot.pool[p]) E.push('atto ' + a.numero + ': pool inesistente ' + p); });
    });
    sceneIds.forEach(s => { if (!seen[s]) E.push('scena ' + s + ' fuori da ogni atto'); });
    if (sceneIds.length && actOfScene(content, sceneIds[0]) !== 1) E.push('la prima scena deve appartenere all\'atto I');
    (content.scene || []).filter(s => s.finale).forEach(s => { if (actOfScene(content, s.id) !== 3) E.push('scena finale ' + s.id + ' fuori dall\'atto III'); });
    const snodi = {};
    atti.forEach(a => (a.snodi || []).forEach(s => { if (snodi[s.id]) E.push('snodo duplicato ' + s.id); snodi[s.id] = a.numero; }));
    if (c) (c.snodi_obbligatori || []).forEach(s => { if (!snodi[s]) E.push('contratto: snodo obbligatorio inesistente ' + s); });

    // uscite: niente atti saltati, nessuna destinazione inesistente
    (content.scene || []).forEach(sc => {
      const from = actOfScene(content, sc.id);
      (sc.uscite || []).forEach(u => {
        if (sceneIds.indexOf(u.verso) === -1) { E.push(sc.id + ': uscita verso scena inesistente ' + u.verso); return; }
        const to = actOfScene(content, u.verso);
        if (to < from) E.push(sc.id + ': uscita che torna a un atto precedente');
        if (to > from + 1) E.push(sc.id + ': uscita che salta un atto');
      });
      if (sc.incontro && !(content.nemici || {})[sc.incontro.nemico]) E.push(sc.id + ': nemico inesistente');
      (sc.png_presenti || []).forEach(p => { if (!content.png[p]) E.push(sc.id + ': PNG inesistente ' + p); });
      (sc.suggerimenti || []).forEach(s => { if (!(sc.obiettivi || []).some(o => o.id === s.obiettivo)) E.push(sc.id + ': suggerimento verso obiettivo inesistente ' + s.obiettivo); });
    });

    // riferimenti degli effetti
    collectEffects(content).forEach(({ where, e }) => {
      if (e.ricompensa && !content.borsa.oggetti[e.ricompensa]) E.push(where + ': oggetto inesistente ' + e.ricompensa);
      if (e.scopri && !content.fatti[e.scopri]) E.push(where + ': fatto inesistente ' + e.scopri);
      if (e.relazione && !content.png[e.relazione.png]) E.push(where + ': PNG inesistente ' + e.relazione.png);
      if (e.png_sa && !content.png[e.png_sa.png]) E.push(where + ': PNG inesistente ' + e.png_sa.png);
      if (e.orologio && !(content.orologi || {})[e.orologio.id]) E.push(where + ': orologio inesistente ' + e.orologio.id);
      if (e.snodo && !snodi[e.snodo]) E.push(where + ': snodo inesistente ' + e.snodo);
      if (e.loot && (!content.loot || !content.loot.pool[e.loot.pool])) E.push(where + ': pool di loot inesistente');
      if (e.conseguenza && (!e.conseguenza.id || !e.conseguenza.quando || !Array.isArray(e.conseguenza.effetti))) E.push(where + ': conseguenza incompleta');
      if (e.promessa && !e.promessa.id) E.push(where + ': promessa senza id');
    });
    // conoscenze iniziali dei PNG e verità riservate
    Object.entries(content.png || {}).forEach(([id, p]) => (p.sa || []).forEach(f => { if (!content.fatti[f]) E.push('PNG ' + id + ': conosce un fatto inesistente ' + f); }));
    if (global.RMSoloLoot && content.loot) global.RMSoloLoot.validateCatalog(content.loot).forEach(x => E.push('loot: ' + x));
    // V4: contenuti con metadati, riferimenti delle condizioni, lessico
    // riservato, vie alternative per gli oggetti chiave, grafo terminabile
    if (content.content_status != null) {
      const cid = content.id;
      if (content.campaign_id !== cid) E.push('campaign_id della radice diverso da id');
      if (CONTENT_STATUS.indexOf(content.content_status) === -1) E.push('content_status non valido');
      if (!content.source_note) E.push('source_note mancante');
      (content.scene || []).forEach(sc => validateMeta('scena ' + sc.id, sc, cid).forEach(x => E.push(x)));
      Object.entries(content.png || {}).forEach(([k, o]) => validateMeta('PNG ' + k, o, cid).forEach(x => E.push(x)));
      Object.entries(content.fatti || {}).forEach(([k, o]) => {
        validateMeta('fatto ' + k, o, cid).forEach(x => E.push(x));
        if (o.segreto && o.visibility_rule === 'pubblica') E.push('fatto ' + k + ': segreto con visibilità pubblica');
      });
      Object.entries(content.borsa.oggetti || {}).forEach(([k, o]) => validateMeta('oggetto ' + k, o, cid).forEach(x => E.push(x)));
      Object.entries(content.loot && content.loot.modelli || {}).forEach(([k, o]) => validateMeta('modello ' + k, o, cid).forEach(x => E.push(x)));
      (endingContract(content).variants || []).forEach(v => validateMeta('finale ' + v.id, v, cid).forEach(x => E.push(x)));
      // atto dichiarato = atto reale della scena
      (content.scene || []).forEach(sc => { if (sc.act !== actOfScene(content, sc.id)) E.push('scena ' + sc.id + ': act diverso dall\'atto che la contiene'); });
      const rules = content.lessico_riservato || [];
      rules.forEach(r => { if (!content.fatti[r.fino_a] || !content.fatti[r.fino_a].segreto) E.push('lessico riservato: sblocco su fatto non segreto ' + r.fino_a); });
      publicTexts(content).forEach(x => lexiconHits(x.t, rules).forEach(h => E.push(x.where + ': lessico riservato prima dello sblocco (' + h + ')')));
      const flagsSet = {};
      collectEffects(content).forEach(x => { if (x.e.flag) Object.keys(x.e.flag).forEach(f => { flagsSet[f] = true; }); });
      Object.entries(content.borsa.oggetti).forEach(([id, o]) => {
        if (o.tipo !== 'oggetto_chiave' && o.tipo !== 'indizio') return;
        if (!o.via_alternativa || !o.via_alternativa.testo) E.push('oggetto ' + id + ': via alternativa mancante');
        else if (o.via_alternativa.flag && !flagsSet[o.via_alternativa.flag]) E.push('oggetto ' + id + ': la via alternativa usa un flag mai impostato ' + o.via_alternativa.flag);
      });
      const reach = reachableScenes(content);
      (content.scene || []).forEach(sc => { if (!reach[sc.id]) E.push('scena ' + sc.id + ' irraggiungibile'); });
      if (!(content.scene || []).some(sc => sc.finale && reach[sc.id])) E.push('nessuna scena finale raggiungibile');
      (content.scene || []).forEach(sc => { if (!sc.finale && !(sc.uscite || []).length) E.push('scena ' + sc.id + ': vicolo cieco (nessuna uscita)'); });
    }
    collectConditions(content).forEach(({ where, c }) => condRefs(c).forEach(r => {
      if (r.ignota) E.push(where + ': condizione sconosciuta ' + r.ignota);
      if (r.fatto && !content.fatti[r.fatto]) E.push(where + ': fatto inesistente ' + r.fatto);
      if (r.snodo && !snodi[r.snodo]) E.push(where + ': snodo inesistente ' + r.snodo);
      if (r.oggetto && !content.borsa.oggetti[r.oggetto]) E.push(where + ': oggetto inesistente ' + r.oggetto);
      if (r.png && !content.png[r.png]) E.push(where + ': PNG inesistente ' + r.png);
      if (r.risorsa && !(content.risorse || {})[r.risorsa]) E.push(where + ': risorsa inesistente ' + r.risorsa);
      if (r.orologio && !(content.orologi || {})[r.orologio]) E.push(where + ': orologio inesistente ' + r.orologio);
    }));
    collectEffects(content).forEach(({ where, e }) => {
      if (e.risorsa && !(content.risorse || {})[e.risorsa.id]) E.push(where + ': risorsa inesistente ' + e.risorsa.id);
      if (e.asse && (endingContract(content).outcome_axes || []).indexOf(e.asse.id) === -1) E.push(where + ': asse non dichiarato ' + e.asse.id);
      if ((e.rischio_oggetto || e.recupera_oggetto) && !content.borsa.oggetti[(e.rischio_oggetto || e.recupera_oggetto).oggetto]) E.push(where + ': oggetto inesistente');
      if (e.rischio_oggetto && e.rischio_oggetto.png && !content.png[e.rischio_oggetto.png]) E.push(where + ': custode inesistente');
    });
    // oggetti indispensabili: mai solo da estrazioni casuali
    Object.entries(content.borsa.oggetti).forEach(([id, o]) => {
      if (o.indispensabile && !collectEffects(content).some(x => x.e.ricompensa === id)) E.push('oggetto indispensabile ' + id + ' senza un percorso di acquisizione previsto');
    });
    return E;
  }

  /* ------------------------------------------------ contratto del finale */

  /* V4 §2: niente "finale canonico immutabile". Ogni campagna ha una
     domanda di chiusura, assi di esito calcolati dallo stato, un insieme
     finito di varianti con priorità esplicite e fallimenti terminali.

     ending_contract = {
       closing_question, resolution_scope, required_resolution[],
       entry_conditions[] (snodi o flag), outcome_axes[],
       variants[] { id, titolo, tipo: 'esito'|'modificatore', priorita,
                    condizione (null = sempre), ripiego, combinabile_con[],
                    riserva, conseguenza_personale },
       terminal_failures[]
     }

     Compatibilità: un vecchio elenco `finali` (fixture) o un vecchio
     `finale_canonico` diventano un contratto con le stesse varianti,
     nello stesso ordine; l'ultima è il ripiego. */
  const TERMINALI_MOTORE = { raven: 'raven_execution', morte: 'player_permadeath', violenza_sessuale: 'sanzione_moderazione' };

  function endingContract(content) {
    const c = content.contratto || {};
    if (c.ending_contract) return c.ending_contract;
    const legacy = content.finali || (c.finale_canonico ? [Object.assign({ id: 'finale_canonico' }, typeof c.finale_canonico === 'object' ? c.finale_canonico : { titolo: String(c.finale_canonico) })] : []);
    return {
      closing_question: null, resolution_scope: null, required_resolution: [], entry_conditions: [], outcome_axes: [],
      variants: legacy.map((f, i) => ({ id: f.id, titolo: f.titolo, tipo: 'esito', priorita: i, condizione: f.condizione || null, ripiego: i === legacy.length - 1, riserva: f.riserva || '' })),
      terminal_failures: ['player_permadeath', 'raven_execution'],
      legacy: true
    };
  }

  function validateEndingContract(content) {
    const E = [];
    const k = endingContract(content);
    const vs = k.variants || [];
    if (!k.legacy) {
      ['closing_question', 'resolution_scope'].forEach(x => { if (!k[x]) E.push('finale: ' + x + ' mancante'); });
      if (!(k.outcome_axes || []).length) E.push('finale: nessun asse di esito');
      ['player_permadeath', 'raven_execution'].forEach(t => { if ((k.terminal_failures || []).indexOf(t) === -1) E.push('finale: fallimento terminale ' + t + ' mancante'); });
    }
    if (!vs.some(v => v.tipo === 'esito')) E.push('finale: nessuna variante di esito');
    if (vs.filter(v => v.tipo === 'esito' && v.ripiego).length !== 1) E.push('finale: serve esattamente una variante di ripiego');
    const ids = {};
    vs.forEach(v => {
      if (ids[v.id]) E.push('finale: variante duplicata ' + v.id); ids[v.id] = true;
      if (['esito', 'modificatore'].indexOf(v.tipo) === -1) E.push('finale ' + v.id + ': tipo non valido');
      if (!Number.isFinite(v.priorita)) E.push('finale ' + v.id + ': priorità mancante');
      if (!v.riserva) E.push('finale ' + v.id + ': testo di riserva mancante');
      if (!k.legacy && !v.conseguenza_personale) E.push('finale ' + v.id + ': conseguenza personale mancante');
      condRefs(v.condizione).forEach(r => {
        if (r.asse && (k.outcome_axes || []).indexOf(r.asse) === -1) E.push('finale ' + v.id + ': asse non dichiarato ' + r.asse);
      });
    });
    vs.forEach(v => (v.combinabile_con || []).forEach(x => { if (!ids[x]) E.push('finale ' + v.id + ': combinabile con variante inesistente ' + x); }));
    const prio = vs.filter(v => v.tipo === 'esito').map(v => v.priorita);
    if (new Set(prio).size !== prio.length) E.push('finale: priorità delle varianti di esito non univoche');
    return E;
  }

  // riferimenti contenuti in una condizione (per il validatore)
  function condRefs(cond, out) {
    out = out || [];
    if (!cond || typeof cond !== 'object') return out;
    Object.keys(cond).forEach(key => { if (CONDIZIONI.indexOf(key) === -1) out.push({ ignota: key }); });
    ['tutti', 'qualunque'].forEach(k => (cond[k] || []).forEach(c => condRefs(c, out)));
    if (cond.non) condRefs(cond.non, out);
    if (cond.asse_almeno) out.push({ asse: cond.asse_almeno.asse });
    if (cond.asse_al_piu) out.push({ asse: cond.asse_al_piu.asse });
    if (cond.snodo) out.push({ snodo: cond.snodo });
    if (cond.fatto_scoperto) out.push({ fatto: cond.fatto_scoperto });
    if (cond.verita_almeno) (cond.verita_almeno.tra || []).forEach(f => out.push({ fatto: f }));
    if (cond.possiede) out.push({ oggetto: cond.possiede });
    if (cond.custodito) out.push({ oggetto: cond.custodito });
    if (cond.perso) out.push({ oggetto: cond.perso });
    if (cond.relazione_almeno) out.push({ png: cond.relazione_almeno.png });
    if (cond.relazione_al_piu) out.push({ png: cond.relazione_al_piu.png });
    if (cond.risorsa_almeno) out.push({ risorsa: cond.risorsa_almeno.id });
    if (cond.risorsa_al_piu) out.push({ risorsa: cond.risorsa_al_piu.id });
    if (cond.orologio_pieno) out.push({ orologio: cond.orologio_pieno });
    return out;
  }

  /* Risolutore deterministico (V4 §2.3). Lo stato è già congelato dal
     comando conclusivo; si valutano prima i fallimenti terminali, poi gli
     assi ricalcolati dal registro, poi le varianti per priorità; i
     modificatori (es. archivio aperto) si aggiungono senza cancellare la
     variante principale. `forced` è un esito imposto da un orologio. */
  function resolveEnding(state, content, pending, forced, evN) {
    const k = endingContract(content);
    const base = { contratto: content.id + '@' + content.versione, evento: evN || null };
    if (state.stato === 'morto' || state.stato === 'terminato') {
      const t = TERMINALI_MOTORE[state.motivoFine === 'raven' ? 'raven' : state.motivoFine === 'violenza_sessuale' ? 'violenza_sessuale' : 'morte'];
      return Object.assign(base, { tipo: 'fallimento_terminale', variante: t, modificatori: [], assi: axesFromEvents(state, pending), condizioni: {} });
    }
    const assi = axesFromEvents(state, pending);
    const view = Object.assign({}, state, { assi });
    const condizioni = {};
    (k.variants || []).forEach(v => { condizioni[v.id] = v.condizione ? conditionMet(view, v.condizione) : true; });
    const esiti = (k.variants || []).filter(v => v.tipo === 'esito');
    let main = forced ? esiti.find(v => v.id === forced) : null;
    if (!main) main = esiti.filter(v => !v.ripiego && condizioni[v.id]).sort((a, b) => a.priorita - b.priorita)[0] || esiti.find(v => v.ripiego);
    const mods = (k.variants || []).filter(v => v.tipo === 'modificatore' && condizioni[v.id] && (!v.combinabile_con || v.combinabile_con.indexOf(main.id) !== -1))
      .sort((a, b) => a.priorita - b.priorita).map(v => v.id);
    const ingresso = (k.entry_conditions || []).every(e => (state.snodi && state.snodi[e]) || state.flags[e]);
    return Object.assign(base, {
      tipo: 'esito', variante: main.id, titolo: main.titolo, modificatori: mods, assi, condizioni,
      forzato: !!forced, ingressoCompleto: ingresso,
      fatti: state.fattiScoperti.slice(), snodi: Object.keys(state.snodi || {})
    });
  }

  function variantDef(content, id) { return (endingContract(content).variants || []).find(v => v.id === id) || null; }

  /* Testo di riserva dell'epilogo: variante + modificatori + conseguenza
     personale. Stessa variante => stesso testo, qualunque rigenerazione. */
  function endingText(content, rec) {
    if (!rec || rec.tipo !== 'esito') return '';
    const main = variantDef(content, rec.variante) || {};
    const parts = [main.riserva];
    (rec.modificatori || []).forEach(m => { const d = variantDef(content, m); if (d) parts.push(d.riserva); });
    if (main.conseguenza_personale) parts.push(main.conseguenza_personale);
    return parts.filter(Boolean).join(' ');
  }

  /* ------------------------------------------------- metadati V4 */

  const META = ['campaign_id', 'content_status', 'act', 'level_band', 'difficulty_tags', 'visibility_rule', 'source_note'];
  const CONTENT_STATUS = ['draft', 'proposed', 'approved'];
  const VISIBILITA = ['pubblica', 'alla_scoperta', 'solo_motore'];
  const DIFF = ['esplorativa', 'bilanciata', 'permadeath'];

  function validateMeta(where, o, campaignId) {
    const E = [];
    META.forEach(k => { if (!(k in o)) E.push(where + ': metadato ' + k + ' mancante'); });
    if (o.campaign_id != null && o.campaign_id !== campaignId) E.push(where + ': campaign_id diverso dalla campagna');
    if ('content_status' in o && CONTENT_STATUS.indexOf(o.content_status) === -1) E.push(where + ': content_status non valido');
    if ('visibility_rule' in o && VISIBILITA.indexOf(o.visibility_rule) === -1) E.push(where + ': visibility_rule non valida');
    if (o.act != null && [].concat(o.act).some(a => [1, 2, 3].indexOf(a) === -1)) E.push(where + ': atto non valido');
    if (o.level_band != null && (!Array.isArray(o.level_band) || o.level_band[0] < 1 || o.level_band[1] > 30 || o.level_band[0] > o.level_band[1])) E.push(where + ': level_band non valida');
    if (o.difficulty_tags != null && (!Array.isArray(o.difficulty_tags) || o.difficulty_tags.some(d => DIFF.indexOf(d) === -1))) E.push(where + ': difficulty_tags non validi');
    return E;
  }

  /* Lessico riservato (es. Ich: "programma", "bot"…): vietato in ogni
     testo pubblico e nella narrazione finché la verità che lo sblocca non
     è scoperta. Restituisce le regole ancora bloccate per questo stato. */
  /* Lessico ancora vietato: quello della campagna più le verità riservate
     dell'ontologia dell'ambientazione (Ich), finché il fatto che le
     rivela non è stato scoperto. */
  function lockedLexicon(state, content) {
    const O = global.RMSoloOntologia;
    const onto = O && content ? O.paroleRiservate(content.storia) : [];
    return (content.lessico_riservato || []).concat(onto).filter(r => !state || state.fattiScoperti.indexOf(r.fino_a) === -1);
  }
  function lexiconHits(text, rules) {
    const hits = [];
    rules.forEach(r => (r.parole || []).forEach(w => { if (new RegExp('\\b' + w, 'i').test(String(text || ''))) hits.push(r.fino_a + ':' + w); }));
    return hits;
  }

  /* ---------------------------------------------- stato sociale/narrativo */

  function initState(state, content) {
    state.atto = 1;
    state.snodi = {};
    state.conseguenze = [];
    state.decisioni = [];
    state.sociale = { reputazione: {}, promesse: [], voci: [] };
    state.assi = {};
    state.assiGrezzi = {};
    state.custodi = {};
    state.oggettiPersi = {};
    state.risorse = {};
    Object.entries(content.risorse || {}).forEach(([k, r]) => {
      const ini = r.iniziale;
      state.risorse[k] = typeof ini === 'object' && ini ? (Number(ini[state.difficolta]) || 0) : (Number(ini) || 0);
    });
    Object.keys(state.png).forEach(k => { state.png[k].incontrato = false; });
  }

  /* Profili delle difficoltà (disponibilità e conseguenze, mai potenza
     degli oggetti): valore del profilo della partita o predefinito. */
  function profileValue(state, content, key, def) {
    const p = content.profili_difficolta && content.profili_difficolta[state.difficolta];
    return p && p[key] != null ? p[key] : def;
  }

  /* Effetti sociali e narrativi (estensione dell'insieme chiuso del
     motore). Restituisce true se l'effetto è stato gestito qui. */
  function applyEffect(state, content, eff, sourceKey, applied, ev) {
    if (eff.asse) {
      // assi di esito: mai mostrati come punteggio; valgono solo per il
      // risolutore del finale (registrati nell'evento come ogni effetto)
      state.assiGrezzi = state.assiGrezzi || {};
      state.assi = state.assi || {};
      const id = eff.asse.id;
      state.assiGrezzi[id] = (state.assiGrezzi[id] || 0) + eff.asse.delta;
      state.assi[id] = clampAxis(state.assiGrezzi[id]);
      applied.push({ tipo: 'asse', asse: id, delta: eff.asse.delta });
      return true;
    }
    if (eff.risorsa) {
      // risorse di campagna (materiali, riserva termica, risorse rituali…):
      // un premio "a budget di scena" segue il profilo della difficoltà
      state.risorse = state.risorse || {};
      const r = eff.risorsa;
      let delta = Number(r.delta) || 0;
      if (r.budget && delta > 0) delta = Math.max(0, delta + profileValue(state, content, 'risorse_budget_delta', 0));
      const prev = state.risorse[r.id] || 0;
      state.risorse[r.id] = Math.max(0, prev + delta);
      applied.push({ tipo: 'risorsa', risorsa: r.id, nome: (content.risorse && content.risorse[r.id] || {}).nome || r.id, delta: state.risorse[r.id] - prev, valore: state.risorse[r.id] });
      return true;
    }
    if (eff.snodo) {
      if (!state.snodi[eff.snodo]) { state.snodi[eff.snodo] = ev ? ev.n : 'avvio'; applied.push({ tipo: 'snodo', snodo: eff.snodo }); }
      return true;
    }
    if (eff.conseguenza) {
      const c = eff.conseguenza;
      if (!state.conseguenze.some(x => x.id === c.id)) {
        state.conseguenze.push({ id: c.id, descrizione: c.descrizione || '', quando: c.quando, effetti: c.effetti, stato: 'pendente', origine: sourceKey, evento: ev ? ev.n : null });
        applied.push({ tipo: 'conseguenza_registrata', id: c.id });
      }
      return true;
    }
    if (eff.reputazione) {
      const r = state.sociale.reputazione;
      r[eff.reputazione.fazione] = (r[eff.reputazione.fazione] || 0) + eff.reputazione.delta;
      applied.push({ tipo: 'reputazione', fazione: eff.reputazione.fazione, delta: eff.reputazione.delta, valore: r[eff.reputazione.fazione] });
      return true;
    }
    if (eff.promessa) {
      if (!state.sociale.promesse.some(p => p.id === eff.promessa.id)) {
        state.sociale.promesse.push({ id: eff.promessa.id, testo: eff.promessa.testo, png: eff.promessa.png || null, stato: 'aperta', evento: ev ? ev.n : null });
        applied.push({ tipo: 'promessa', id: eff.promessa.id, testo: eff.promessa.testo });
      }
      return true;
    }
    if (eff.promessa_esito) {
      const p = state.sociale.promesse.find(x => x.id === eff.promessa_esito.id);
      if (p && p.stato === 'aperta') { p.stato = eff.promessa_esito.stato; p.eventoEsito = ev ? ev.n : null; applied.push({ tipo: 'promessa_esito', id: p.id, stato: p.stato }); }
      return true;
    }
    if (eff.voce) {
      if (!state.sociale.voci.some(v => v.id === eff.voce.id)) {
        state.sociale.voci.push({ id: eff.voce.id, testo: eff.voce.testo, fonte: eff.voce.fonte || null, evento: ev ? ev.n : null });
        applied.push({ tipo: 'voce', id: eff.voce.id, testo: eff.voce.testo });
      }
      return true;
    }
    return false;
  }

  /* Conseguenze differite: ciascuna si applica una sola volta, quando la
     sua condizione diventa vera; resta registrata con l'evento. */
  function evaluateConsequences(state, content, applyEffects, applied, ev) {
    let any = false;
    state.conseguenze.forEach(c => {
      if (c.stato !== 'pendente' || !conditionMet(state, c.quando)) return;
      c.stato = 'applicata';
      c.eventoApplicazione = ev ? ev.n : null;
      applied.push({ tipo: 'conseguenza_applicata', id: c.id, descrizione: c.descrizione });
      applyEffects(state, content, c.effetti, 'conseguenza:' + c.id, applied);
      any = true;
    });
    return any;
  }

  function markMet(state, content, sceneId) {
    const sc = (content.scene || []).find(s => s.id === sceneId);
    (sc && sc.png_presenti || []).forEach(p => { if (state.png[p]) state.png[p].incontrato = true; });
  }

  /* Registro delle decisioni significative (tentativi verso obiettivi e
     scelte): intenzione, azione, contesto, persone, esito, fatti prodotti,
     effetti immediati e conseguenze differite registrate. */
  function recordDecision(state, content, ev, cmd) {
    const sc = (content.scene || []).find(s => s.id === ev.scena) || {};
    const eff = ev.effetti || [];
    state.decisioni.push({
      id: 'D' + ev.n, evento: ev.n, comando: cmd.id,
      intenzione: cmd.testo || (cmd.proposta && cmd.proposta.motivo) || ev.sceltaTesto || null,
      azione: ev.tipo === 'scelta' ? { scelta: ev.sceltaId } : { obiettivo: ev.obiettivo, operazione: cmd.proposta && cmd.proposta.operazione || null, tratto: ev.check && ev.check.trait || null },
      contesto: { atto: state.atto, scena: ev.scena },
      persone: (sc.png_presenti || []).slice(),
      esito: ev.esito || (ev.tipo === 'scelta' ? 'scelta' : ev.tipo),
      fatti: eff.filter(a => a.tipo === 'scoperta').map(a => a.fatto),
      effetti: eff.filter(a => ['relazione', 'reputazione', 'ricompensa', 'loot_scoperto', 'promessa', 'flag'].indexOf(a.tipo) !== -1).map(a => a.tipo + ':' + (a.png || a.fazione || a.oggetto || a.istanza || a.flag || a.id || '')),
      differite: eff.filter(a => a.tipo === 'conseguenza_registrata').map(a => a.id)
    });
  }

  /* ------------------------------------------------------- planner */

  /* Vincoli per la scena da raccontare: ogni scena deve servire ad almeno
     un obiettivo, legame, conseguenza o opportunità. Al narratore vanno
     solo elementi visibili: le conseguenze in sospeso compaiono come
     numero, mai con le loro condizioni o i loro effetti. */
  function planScene(state, content) {
    const sc = (content.scene || []).find(s => s.id === state.scena) || {};
    const a = actDef(content, state.atto) || {};
    const bag = state.borsa && state.borsa.istanze || {};
    return {
      atto: { numero: state.atto, titolo: a.titolo || '', funzione: a.funzione || '' },
      obiettivi_aperti: (sc.obiettivi || []).filter(o => !(state.obiettivi[o.id] && state.obiettivi[o.id].completato)).map(o => o.testo),
      snodi_mancanti: missingNodes(state, content, state.atto).map(s => s.testo),
      legami: (sc.png_presenti || []).map(p => content.png[p].nome + ' (' + state.png[p].atteggiamento + ')'),
      promesse_aperte: state.sociale.promesse.filter(p => p.stato === 'aperta').map(p => p.testo),
      opportunita: Object.values(bag).filter(i => i.stato === 'scoperto' && (!i.scena || i.scena === state.scena)).map(i => i.nome),
      conseguenze_in_sospeso: state.conseguenze.filter(c => c.stato === 'pendente').length
    };
  }

  function planText(plan) {
    const L = ['Atto ' + ['', 'I', 'II', 'III'][plan.atto.numero] + (plan.atto.titolo ? ' — ' + plan.atto.titolo : '') + (plan.atto.funzione ? ': ' + plan.atto.funzione : '')];
    if (plan.obiettivi_aperti.length) L.push('Obiettivi aperti: ' + plan.obiettivi_aperti.join('; '));
    if (plan.snodi_mancanti.length) L.push('Da raggiungere per chiudere l\'atto: ' + plan.snodi_mancanti.join('; '));
    if (plan.legami.length) L.push('Legami in scena: ' + plan.legami.join(', '));
    if (plan.promesse_aperte.length) L.push('Promesse aperte: ' + plan.promesse_aperte.join('; '));
    if (plan.opportunita.length) L.push('Da raccogliere qui: ' + plan.opportunita.join(', '));
    L.push('La descrizione deve servire ad almeno uno di questi elementi; non chiudere obiettivi o atti che il motore non ha chiuso.');
    return L.join('\n');
  }

  /* ---------------------------------------- ciò che il personaggio sa */

  /* Diario ed esportazione: solo informazioni legittimamente note al
     personaggio. PNG mai incontrati, verità riservate e conseguenze
     pendenti non compaiono. */
  function playerView(state, content) {
    return {
      fatti: state.fattiScoperti.map(f => content.fatti[f].testo),
      voci: state.sociale.voci.map(v => v.testo),
      png: Object.entries(state.png).filter(([, v]) => v.incontrato).map(([k, v]) => ({ id: k, nome: content.png[k].nome, ruolo: content.png[k].ruolo, atteggiamento: v.atteggiamento })),
      reputazione: Object.assign({}, state.sociale.reputazione),
      promesse: state.sociale.promesse.map(p => ({ testo: p.testo, stato: p.stato })),
      atto: state.atto
    };
  }


  /* ---------------------------------------- origine: sede della campagna
     Decisione dell'autore (2026-10-02): la campagna si svolge nella città di
     partenza del popolo del personaggio (content.origini.perPopolazione).
     Nei dati la sede compare con un segnaposto (content.origini.sede); prima
     di mostrare qualsiasi testo il motore lo sostituisce con il nome della
     sede nella città («la stazione di Epimno») e collega il luogo della sede
     a quella città sulla mappa. Senza `origini` il contenuto resta com'è. */
  const TIPI_CITTA = ['citta', 'citta_cupola', 'insediamento'];
  const PREP_ART = { a: 'alla', di: 'della', da: 'dalla', in: 'nella', su: 'sulla' };
  function cittaDiOrigine(content, pg) {
    const o = content && content.origini;
    if (!o || !pg) return null;
    const L = (content.mappa && content.mappa.luoghi) || {};
    const chiave = n => String(n || '').toLowerCase();
    const dichiarata = pg.citta ? (L[chiave(pg.citta)] ? chiave(pg.citta) : Object.keys(L).find(id => chiave(L[id].nome) === chiave(pg.citta)) || null) : null;
    // regola del popolo; se il popolo non è documentato, quella dell'appartenenza
    // (es. Antarsi come appartenenza politica); altrimenti la città dichiarata, se è sulla mappa
    const regole = o.perPopolazione || {};
    const perChiave = k => { const x = Object.keys(regole).find(r => k && chiave(r) === chiave(k)); return x ? regole[x] : null; };
    const regola = perChiave(pg.popolazione) || perChiave(pg.appartenenzaPolitica) || perChiave((pg.ontologia || {}).factionId)
      || (dichiarata && L[dichiarata] && TIPI_CITTA.indexOf(L[dichiarata].tipo) !== -1 ? { citta: [dichiarata] } : null);
    if (!regola) return null;
    let id = null;
    if (Array.isArray(regola.citta) && regola.citta.length) id = regola.citta.indexOf(dichiarata) !== -1 ? dichiarata : regola.citta[0];
    else if (regola.qualsiasi) {
      const valida = x => x && (regola.escluse || []).indexOf(x) === -1 && (!L[x] || TIPI_CITTA.indexOf(L[x].tipo) !== -1);
      id = valida(dichiarata) ? dichiarata : regola.predefinita || null;
    }
    if (!id) return null;
    const nome = (L[id] && L[id].nome) || (dichiarata === id && pg.citta) || id.charAt(0).toUpperCase() + id.slice(1);
    return { id, nome };
  }
  function sostituisciSede(testo, seg, forma, citta, riscritture) {
    if (typeof testo !== 'string' || testo.indexOf(seg) === -1) return testo;
    let t = testo;
    (riscritture || []).forEach(r => { if (t.indexOf(r[0]) !== -1) t = t.split(r[0]).join(r[1].replace(/\{citta\}/g, citta)); });
    const corpo = forma.replace(/\{citta\}/g, citta).replace(/^la\s+/i, '');
    const re = new RegExp('(?:\\b(a|A|di|Di|da|Da|in|In|su|Su)\\s+)?' + seg + '\\b', 'g');
    return t.replace(re, (m, prep, off, str) => {
      if (prep) { const art = PREP_ART[prep.toLowerCase()]; return (prep[0] === prep[0].toUpperCase() ? art.charAt(0).toUpperCase() + art.slice(1) : art) + ' ' + corpo; }
      const prima = str.slice(0, off);
      return (/(^|[.!?…]\s+|[«"“(\n]\s*)$/.test(prima) ? 'La ' : 'la ') + corpo;
    });
  }
  function mappaStringhe(x, f) {
    if (typeof x === 'string') return f(x);
    if (Array.isArray(x)) return x.map(v => mappaStringhe(v, f));
    if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach(k => { o[k] = mappaStringhe(x[k], f); }); return o; }
    return x;
  }
  const MEMO_ORIGINI = typeof WeakMap === 'function' ? new WeakMap() : null;
  function localizza(content, pg) {
    const o = content && content.origini;
    if (!o || content.origine) return content;
    const c = cittaDiOrigine(content, pg);
    if (!c) return content;
    const memo = MEMO_ORIGINI && MEMO_ORIGINI.get(content);
    if (memo && memo[c.id]) return memo[c.id];
    const sedeDef = o.sede || {};
    const seg = sedeDef.segnaposto || 'Soglia', forma = sedeDef.forma || 'la stazione di {citta}';
    const out = mappaStringhe(content, t => sostituisciSede(t, seg, forma, c.nome, o.riscritture));
    out.origine = { citta: c.id, nome: c.nome, sede: sedeDef.luogo || null, nomeSede: forma.replace(/\{citta\}/g, c.nome), fonte: o.fonte };
    const L = out.mappa && out.mappa.luoghi;
    const sede = sedeDef.luogo;
    if (L && sede && L[sede] && L[c.id]) {
      // la sede è un luogo della città: ne eredita il punto sulla mappa
      L[sede].regione = c.id;
      if (o.descrizioneSede) L[sede].descrizionePubblica = o.descrizioneSede.replace(/\{citta\}/g, c.nome);
      delete L[sede].coordinateMancanti;
      const kid = sede + '__' + c.id;
      if (!out.mappa.collegamenti.some(k => k.id === kid)) {
        out.mappa.collegamenti.push({
          id: kid, origine: sede, destinazione: c.id, direzione: 'entrambe', tipo: 'interno_insediamento', distanza: null,
          durata: { valore: 1, unita: 'ore', fonte: 'proposta da approvare: la stazione è ai margini della città', proposta: true },
          modalita: ['a piedi'], requisiti: [], ambiente: null, costo: null, rischio: null, stagionalita: null, intermedi: [], alternative: [],
          conoscenzaIniziale: 'sentito_dire', accessibilita: 'aperto', paesaggio: [], fonte: 'decisione dell\'autore (2026-10-02): la sede della campagna è nella città di partenza'
        });
        L[sede].collegamenti = L[sede].collegamenti.concat([kid]); L[sede].uscite = L[sede].uscite.concat([c.id]);
        L[c.id].collegamenti = L[c.id].collegamenti.concat([kid]); L[c.id].uscite = L[c.id].uscite.concat([sede]);
      }
    }
    if (MEMO_ORIGINI) { const m = memo || {}; m[c.id] = out; if (!memo) MEMO_ORIGINI.set(content, m); }
    return out;
  }

  global.RMSoloCampaign = {
    FORMATO, CONDIZIONI, META, conditionMet, actOfScene, actDef, actComplete, missingNodes, validateCampaign,
    initState, applyEffect, evaluateConsequences, markMet, recordDecision, planScene, planText, playerView,
    endingContract, validateEndingContract, resolveEnding, endingText, variantDef, axesFromEvents, profileValue,
    lockedLexicon, lexiconHits, publicTexts, reachableScenes, collectEffects, condRefs,
    cittaDiOrigine, localizza
  };
})(typeof window !== 'undefined' ? window : globalThis);
