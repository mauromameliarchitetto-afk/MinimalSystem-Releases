/* ==========================================================================
   Role Makers — Gioca in solitaria: regista drammaturgico.

   Tre livelli (vedi docs/single-player/ARCHITETTURA_NARRATIVA.md):
   1. MOTORE CANONICO (solo-engine.js): unica autorità sullo stato della
      partita (scene, luoghi, fatti, verità scoperte, flag, assi, relazioni,
      inventario, risorse, stati, scontri, prove, esiti, finali).
   2. REGISTA (questo modulo): legge lo stato canonico e il resoconto di
      ogni comando e mantiene SOLO lo stato narrativo (`state.narrativa`):
      funzione e domanda della scena, fase drammatica, tensione, intensità,
      valutazione delle azioni, continuità emotiva, stallo, aftermath,
      profilo narrativo del giocatore, firme narrative recenti. Prepara il
      contesto e il budget del narratore. Non cambia mai un esito.
   3. NARRATORE (solo-narrator.js): trasforma il resoconto in prosa.

   Tutto è deterministico e serializzabile: il regista gira dentro
   applyCommand, quindi un comando ripetuto (stesso id) non lo riesegue.
   ========================================================================== */
(function (global) {
  'use strict';

  const VERSIONE = 1;
  const FASI = ['arrival', 'exploration', 'development', 'decision', 'resolution', 'transition', 'aftermath'];
  const E = () => global.RMSoloEngine;
  const clone = o => JSON.parse(JSON.stringify(o));
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stems = t => norm(t).split(' ').filter(w => w.length >= 5).map(w => w.slice(0, 5));

  function design(content, sceneId) { return (content.narrativa && content.narrativa.scene && content.narrativa.scene[sceneId]) || null; }
  function actOf(content, sceneId) { const d = design(content, sceneId); return d && d.actId && content.narrativa.atti ? content.narrativa.atti[d.actId] || null : null; }
  function voiceProfile(content) { return (content.narrativa && content.narrativa.storyVoiceProfile) || null; }

  /* ----------------------------------------------------- stato narrativo */

  function fresh() {
    return {
      narrativeStateVersion: VERSIONE,
      currentDramaticPhase: 'arrival',
      sceneTension: 0, sceneIntensity: 1, dramaticProgress: 0,
      discoveredTruthIds: [], activatedThreadIds: [], resolvedThreadIds: [],
      activeTensionIds: [], resolvedTensionIds: [],
      environmentChanges: [], sceneTransformations: [],
      interactionHistory: [],
      dialogueMemory: {}, npcNarrativeMemory: {},
      emotionalContinuity: { tono: 'quieto', ultimoPicco: null, perditeRecenti: [] },
      recentNarrativeFunctions: [], recentNarrativeSignatures: [],
      pendingTransition: null, pendingAftermath: null,
      playerNarrativeProfile: freshProfile(),
      sceneEntrySnapshot: null, lastMeaningfulChange: null,
      stallState: { stallCounter: 0, repeatedIntentIds: [], repeatedTargetIds: [], unresolvedTruthIds: [], availableHints: [], environmentEscalations: [], npcInterventions: [], pressureResponses: [], lastHintId: null },
      intensityState: { currentLevel: 1, previousLevel: 1, peakLevel: 1, consecutiveHighIntensityEvents: 0, requiresDecompression: false, contentCategory: 'ordinaria', playerIntensityPreference: null, cooldownState: 0 }
    };
  }
  function freshProfile() {
    return { preferredApproaches: {}, riskPattern: { rischi: 0, prudenze: 0 }, dialoguePattern: { aperture: 0, battuteLibere: 0, argomenti: 0 }, explorationPattern: { punti: 0, azioniLibere: 0, deduzioni: 0 },
      controlPattern: { scelteControllo: 0 }, sacrificePattern: { costiAccettati: 0 }, trustPattern: { promesse: 0 }, conflictPattern: { scontri: 0, fughe: 0, alternative: 0 },
      recurringThemes: [], maintainedPromises: [], brokenPromises: [], meaningfulFailures: [], relationshipPriorities: [], acceptedConsequences: [], avoidedContent: [],
      preferredIntensity: null, profileConfidence: 0, lastUpdatedAt: null };
  }
  /* Migrazione versionata e idempotente: inizializza lo stato narrativo,
     converte i momenti richiesti già registrati in verità scoperte (senza
     duplicare, senza riaprire scene concluse, senza toccare esiti). */
  function migrate(state, content) {
    if (!state) return state;
    const n = state.narrativa;
    if (!n || !n.narrativeStateVersion) state.narrativa = Object.assign(fresh(), n && typeof n === 'object' ? n : {}, { narrativeStateVersion: VERSIONE });
    else if (n.narrativeStateVersion < VERSIONE) n.narrativeStateVersion = VERSIONE;
    const it = state.interazione;
    state.veritaScoperte = state.veritaScoperte || [];
    const d = content && it ? design(content, it.scena) : null;
    if (d && it.beats) d.requiredTruths.forEach(t => {
      if (t.evidenceIds.some(e => it.beats.indexOf(e) !== -1) && !state.veritaScoperte.some(v => v.id === t.id)) state.veritaScoperte.push({ id: t.id, scena: it.scena, metodo: 'osservazione', fonte: 'migrazione', evento: null, stato: 'scoperta' });
    });
    state.narrativa.discoveredTruthIds = state.veritaScoperte.map(v => v.id);
    return state;
  }

  /* ------------------------------------------------ interprete strutturato

     Oggetto d'intento validato contro gli elementi presenti o autorizzati
     dalla scena. Riconosce anche azioni pertinenti non elencate (verità
     della scena, PNG presenti, oggetti posseduti) senza ridurle ai pulsanti. */
  const INTENT_WORDS = {
    osservare: ['guard', 'osserv', 'esamin', 'studi', 'contr', 'cerc', 'ispez', 'legg'],
    ascoltare: ['ascol', 'sent', 'origl'],
    parlare: ['chied', 'parl', 'dico', 'domand', 'spieg', 'convin', 'rassic'],
    muoversi: ['vado', 'mi spost', 'raggiun', 'torno', 'entro', 'esco', 'salgo', 'scend', 'mi avvic', 'mi allont'],
    usare: ['uso', 'accend', 'apro', 'chiudo', 'spost', 'prend', 'mostr', 'lanci'],
    attaccare: ['attac', 'colpis', 'ferisc', 'uccid'],
    nascondersi: ['nascon', 'aspett', 'resto fermo', 'immobil', 'attend'],
    dedurre: ['penso che', 'forse', 'deve essere', 'quindi', 'significa', 'secondo me', 'ipotiz']
  };
  function interpret(text, state, content) {
    const t = ' ' + norm(text) + ' ';
    const sc = E().currentScene(state, content) || {};
    const d = design(content, state.scena);
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const moderation = global.RMSoloModeration && global.RMSoloModeration.check ? safeMod(text, state, content) : { ok: true };
    let intentType = 'altro', best = 0;
    Object.entries(INTENT_WORDS).forEach(([k, ws]) => { const h = ws.filter(w => t.indexOf(' ' + w) !== -1 || t.indexOf(w) !== -1).length; if (h > best) { best = h; intentType = k; } });
    // bersaglio: PNG presenti, punti della scena, oggetti posseduti
    const presenti = (sc.png_presenti || []).map(id => ({ id, nome: (content.png[id] || {}).nome || id }));
    const png = presenti.find(p => nameWords(p.nome).some(w => t.indexOf(' ' + w + ' ') !== -1));
    const points = d ? d.interactables : [];
    const my = new Set(stems(text));
    let point = null, pbest = 0;
    points.forEach(p => { const h = stems(p.etichetta).filter(w => my.has(w)).length; if (h > pbest) { pbest = h; point = p; } });
    const items = (state.inventario || []).map(i => { const info = E().itemInfo(state, content, i.id); return info ? { id: i.id, nome: info.nome } : null; }).filter(Boolean);
    const item = items.find(x => stems(x.nome).some(w => my.has(w)));
    const truths = d ? d.requiredTruths.filter(tr => stems(tr.canonicalContent).filter(w => my.has(w)).length >= 2) : [];
    const threads = d ? d.optionalThreads.filter(o => stems(o.etichetta).filter(w => my.has(w)).length >= 1) : [];
    const n = state.narrativa || fresh();
    const hist = n.interactionHistory || [];
    const sig = Array.from(my).sort().join(' ');
    const repetition = hist.filter(h => h.firma && simil(h.firma, sig) >= 0.8).length;
    const tokens = norm(text).split(' ').filter(Boolean);
    const relevance = (png ? 0.4 : 0) + (pbest ? Math.min(0.4, pbest * 0.2) : 0) + (truths.length ? 0.4 : 0) + (item ? 0.2 : 0) + (threads.length ? 0.2 : 0);
    const requiresClarification = tokens.length < 3 && !png && !point;
    return {
      intentType,
      targetType: png ? 'png' : item ? 'oggetto' : point ? 'luogo' : truths.length ? 'verita' : 'nessuno',
      targetId: png ? png.id : item ? item.id : point ? point.id : truths.length ? truths[0].id : null,
      method: intentType === 'dedurre' ? 'deduzione' : png ? 'dialogo' : item ? 'oggetto' : point ? 'osservazione' : 'azione_libera',
      declaredTone: E().lineTone ? E().lineTone(text) : null,
      declaredGoal: String(text || '').slice(0, 160),
      riskAcceptance: /\b(rischio|a ogni costo|anche se|di corsa|senza pensarci)\b/.test(t) ? 'alta' : /\b(con cautela|piano|attento|lentamente|senza farmi vedere)\b/.test(t) ? 'bassa' : 'normale',
      referencedEntities: [].concat(png ? [png.id] : [], item ? [item.id] : [], point ? [point.id] : []),
      relevantTruthIds: truths.map(x => x.id),
      relevantThreadIds: threads.map(x => x.id),
      expectedNarrativeFunction: truths.length ? 'scoperta' : png ? 'relazione' : intentType === 'muoversi' ? 'posizione' : 'percezione',
      noveltyScore: Math.max(0, 1 - repetition * 0.5),
      repetitionScore: Math.min(1, repetition * 0.5),
      contextRelevance: Math.min(1, Math.round(relevance * 100) / 100),
      requiresClarification,
      clarificationText: requiresClarification ? 'Descrivi meglio che cosa fai e verso che cosa.' : null,
      outOfScope: relevance === 0 && !requiresClarification && intentType === 'altro',
      moderationResult: moderation,
      firma: sig
    };
  }
  // parole che identificano un PNG: niente epiteti fra parentesi e niente
  // parole funzionali ("Mira (la voce che ricorda il mare)" → "mira")
  const FUNZIONALI = ['che', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'con', 'per', 'una', 'uno', 'gli', 'dal', 'dalla', 'nel', 'nella', 'sul', 'sulla'];
  function nameWords(nome) { return norm(String(nome || '').replace(/\([^)]*\)/g, ' ')).split(' ').filter(w => w.length >= 3 && FUNZIONALI.indexOf(w) === -1); }
  function safeMod(text, state, content) { try { const r = global.RMSoloModeration.check(text, state, content); return { ok: !r || r.ok !== false, esito: r && r.esito || null }; } catch (e) { return { ok: true }; } }
  function simil(a, b) {
    const A = new Set(String(a).split(' ').filter(Boolean)), B = new Set(String(b).split(' ').filter(Boolean));
    if (!A.size || !B.size) return a === b ? 1 : 0;
    let k = 0; A.forEach(x => { if (B.has(x)) k++; });
    return k / Math.max(A.size, B.size);
  }

  /* ------------------------------------------- valutazione dell'azione */

  function evaluate(before, state, content, ev, cmd) {
    const eff = ev.effetti || [];
    const has = t => eff.some(a => a.tipo === t);
    const intent = cmd && cmd.intento ? cmd.intento : null;
    const cambi = [];
    if (has('verita') || has('scoperta') || eff.some(a => a.tipo === 'nota' && a.categoria === 'indizio')) cambi.push('conoscenza');
    if (has('relazione') || has('atteggiamento') || has('promessa_dialogo')) cambi.push('relazione');
    if (before.scena !== state.scena || has('sposta')) cambi.push('posizione');
    if (has('fase') || has('incontro_imminente') || has('svolgimento')) cambi.push('opportunita');
    if (has('pressione') || has('pressione_massima')) cambi.push('pressione');
    if (has('svolta') || eff.some(a => a.tipo === 'nota' && a.categoria === 'cambiamento')) cambi.push('ambiente');
    if (ev.combattimento || has('incontro_inizia') || has('incontro')) cambi.push('conflitto');
    if (ev.sceltaId) cambi.push('stato_canonico');
    // trasformazioni improvvisate convalidate (memoria narrativa tipizzata)
    eff.filter(a => a.tipo === 'memoria' && a.classe !== 'effimero').forEach(a => cambi.push({ relazione: 'relazione', tensione: 'pressione', testimonianza: 'conoscenza', rivelazione: 'conoscenza' }[a.genere] || 'ambiente'));
    if (has('filo')) cambi.push('opportunita');
    if (has('svolta_dialogo')) cambi.push('relazione');
    if (eff.some(a => ['hp', 'costo', 'gemma_scarica', 'gemma_reintegrata', 'ricompensa', 'consumato', 'riposo', 'avanzamento'].indexOf(a.tipo) !== -1)) cambi.push('stato_canonico');
    // nessun effetto meccanico: l'azione valida riceve comunque un effetto
    // narrativo (percezione del problema o continuità emotiva), mai progressione
    const ripetuta = !!(ev.libera && !has('beat') && !has('verita') && !ev.deduzione);
    const narrativo = cambi.length ? null : (ev.tipo === 'esplorazione' || ev.tipo === 'battuta' || ev.tipo === 'dialogo') ? 'percezione' : 'continuita_emotiva';
    const d = design(content, state.scena);
    const truths = d ? d.requiredTruths : [];
    const noti = new Set((state.veritaScoperte || []).map(v => v.id));
    return {
      pertinenza: intent ? intent.contextRelevance : (ev.tipo === 'esplorazione' && ev.libera ? (has('beat') || ev.deduzione ? 0.8 : 0.2) : 1),
      novita: intent ? intent.noveltyScore : (ripetuta ? 0.2 : 1),
      rischio: ev.combattimento || ev.check ? (ev.check && ev.check.nc ? Math.min(1, ev.check.nc / 20) : 0.6) : 0,
      costoNarrativo: eff.filter(a => a.tipo === 'costo' || a.tipo === 'consumato' || a.tipo === 'oggetto_perso' || (a.tipo === 'hp' && a.delta < 0)).length,
      effetti: {
        conflitto: cambi.indexOf('conflitto') !== -1, relazione: cambi.indexOf('relazione') !== -1, conoscenza: cambi.indexOf('conoscenza') !== -1,
        ambiente: cambi.indexOf('ambiente') !== -1, pressione: cambi.indexOf('pressione') !== -1, identita: !!(ev.sceltaId || has('avanzamento') || has('magia_senza_gemme'))
      },
      apre: has('fase') || has('incontro_imminente') || has('loot_scoperto'),
      chiudeTrasforma: !!(ev.sceltaId || ev.incontroEsito || before.scena !== state.scena || has('pressione_massima')),
      cambiamenti: cambi.length ? Array.from(new Set(cambi)) : [narrativo],
      significativa: cambi.length > 0,
      progressione: cambi.indexOf('conoscenza') !== -1 || cambi.indexOf('stato_canonico') !== -1 || cambi.indexOf('conflitto') !== -1,
      veritaAperte: truths.filter(t => !noti.has(t.id)).map(t => t.id)
    };
  }

  /* --------------------------------------------- fase, tensione, intensità */

  function intensityOf(before, state, content, ev) {
    const eff = ev.effetti || [];
    if (eff.some(a => a.tipo === 'morte')) return { livello: 5, categoria: 'morte' };
    if (eff.some(a => a.tipo === 'finale')) return { livello: 5, categoria: 'finale' };
    if (ev.incontroEsito === 'sconfitta') return { livello: 4, categoria: 'sconfitta' };
    const d = design(content, before.scena);
    const verita = (content.contratto && content.contratto.verita_riservate) || [];
    if (eff.some(a => a.tipo === 'scoperta' && verita.indexOf(a.fatto) !== -1)) return { livello: 4, categoria: 'rivelazione' };
    if (ev.sceltaId && d && (d.intensityProfile || {}).banda === 'decisive') return { livello: 5, categoria: 'climax' };
    if (ev.sceltaId) return { livello: 3, categoria: 'decisione' };
    if (ev.combattimento) return { livello: 3, categoria: 'combattimento' };
    if (before.scena !== state.scena) return { livello: 2, categoria: 'transizione' };
    if (ev.tipo === 'battuta' || ev.tipo === 'dialogo' || ev.tipo === 'dialogo_fine') return { livello: 2, categoria: 'dialogo' };
    if (eff.some(a => a.tipo === 'pressione_massima')) return { livello: 3, categoria: 'pressione' };
    return { livello: 1, categoria: 'ordinaria' };
  }
  function dramaticPhase(before, state, content, ev, n, aftermathAttivo) {
    if (before.scena !== state.scena) return aftermathAttivo ? 'aftermath' : 'transition';
    if (aftermathAttivo) return 'aftermath';
    if (ev.sceltaId || ev.incontroEsito || (ev.check && ev.obiettivo)) return 'resolution';
    const it = state.interazione;
    if (state.incontro) return 'resolution';
    if (!it) return 'decision';
    if (it.sceltaIncontro) return 'decision';
    if (it.fase === 'resolution') return 'decision';
    // una nuova possibilità dopo la decisione riporta allo sviluppo
    if (it.fase === 'development') return 'development';
    if (it.fase === 'exploration') return 'exploration';
    return 'arrival';
  }
  function tension(state, content) {
    const it = state.interazione;
    const d = sceneOrNull(content, state.scena);
    let t = 0;
    if (it && d && d.pressione) t += Math.round(it.pressione / d.pressione.max * 5);
    if (state.incontro) t += 3;
    if (it && it.sceltaIncontro) t += 2;
    const dd = design(content, state.scena);
    if (dd && dd.requiredTruths.length) { const noti = (state.veritaScoperte || []).filter(v => v.scena === state.scena).length; t += Math.round((1 - noti / dd.requiredTruths.length) * 2); }
    return Math.max(0, Math.min(10, t));
  }
  function sceneOrNull(content, id) { return content.interazioni && content.interazioni.scene ? content.interazioni.scene[id] || null : null; }

  /* ------------------------------------------------------------- budget */

  const BUDGET = {
    ordinaria: { minSentences: 1, targetSentences: 2, maxSentences: 3, dialogueTurnBudget: 0, sensoryDetailBudget: 1, canonDetailBudget: 1, emotionalIntensity: 1, allowsInterlude: false, allowsExtendedDescription: false },
    esplorazione: { minSentences: 1, targetSentences: 2, maxSentences: 3, dialogueTurnBudget: 0, sensoryDetailBudget: 2, canonDetailBudget: 1, emotionalIntensity: 1, allowsInterlude: false, allowsExtendedDescription: false },
    dialogo: { minSentences: 1, targetSentences: 2, maxSentences: 3, dialogueTurnBudget: 2, sensoryDetailBudget: 1, canonDetailBudget: 1, emotionalIntensity: 2, allowsInterlude: false, allowsExtendedDescription: false },
    scoperta: { minSentences: 1, targetSentences: 2, maxSentences: 3, dialogueTurnBudget: 1, sensoryDetailBudget: 1, canonDetailBudget: 2, emotionalIntensity: 2, allowsInterlude: false, allowsExtendedDescription: false },
    transizione: { minSentences: 2, targetSentences: 3, maxSentences: 4, dialogueTurnBudget: 0, sensoryDetailBudget: 2, canonDetailBudget: 1, emotionalIntensity: 2, allowsInterlude: false, allowsExtendedDescription: false },
    combattimento: { minSentences: 1, targetSentences: 2, maxSentences: 2, dialogueTurnBudget: 0, sensoryDetailBudget: 1, canonDetailBudget: 0, emotionalIntensity: 3, allowsInterlude: false, allowsExtendedDescription: false },
    rivelazione: { minSentences: 2, targetSentences: 4, maxSentences: 5, dialogueTurnBudget: 1, sensoryDetailBudget: 2, canonDetailBudget: 2, emotionalIntensity: 4, allowsInterlude: true, allowsExtendedDescription: true },
    climax: { minSentences: 3, targetSentences: 5, maxSentences: 7, dialogueTurnBudget: 2, sensoryDetailBudget: 3, canonDetailBudget: 2, emotionalIntensity: 5, allowsInterlude: true, allowsExtendedDescription: true },
    sconfitta: { minSentences: 2, targetSentences: 4, maxSentences: 5, dialogueTurnBudget: 0, sensoryDetailBudget: 2, canonDetailBudget: 1, emotionalIntensity: 4, allowsInterlude: false, allowsExtendedDescription: false },
    aftermath: { minSentences: 2, targetSentences: 4, maxSentences: 6, dialogueTurnBudget: 1, sensoryDetailBudget: 2, canonDetailBudget: 2, emotionalIntensity: 2, allowsInterlude: true, allowsExtendedDescription: true },
    finale: { minSentences: 3, targetSentences: 6, maxSentences: 7, dialogueTurnBudget: 2, sensoryDetailBudget: 3, canonDetailBudget: 3, emotionalIntensity: 5, allowsInterlude: true, allowsExtendedDescription: true }
  };
  function budgetFor(ev, categoria, fase) {
    const k = categoria === 'finale' || categoria === 'morte' ? 'finale' : categoria === 'climax' ? 'climax' : categoria === 'rivelazione' ? 'rivelazione'
      : categoria === 'sconfitta' ? 'sconfitta' : ev.tipo === 'combattimento' ? 'combattimento' : categoria === 'transizione' ? 'transizione'
        : (ev.aftermath || fase === 'aftermath') ? 'aftermath' : (ev.tipo === 'battuta' || ev.tipo === 'dialogo' || ev.tipo === 'dialogo_fine') ? 'dialogo'
          : (ev.effetti || []).some(a => a.tipo === 'verita') ? 'scoperta' : ev.tipo === 'esplorazione' ? 'esplorazione' : 'ordinaria';
    return Object.assign({ eventType: k }, BUDGET[k]);
  }

  /* ------------------------------------------------------------- stallo */

  function stall(before, state, content, ev, valut, intent) {
    const n = state.narrativa, s = n.stallState;
    const d = design(content, state.scena);
    const noti = new Set((state.veritaScoperte || []).map(v => v.id));
    s.unresolvedTruthIds = d ? d.requiredTruths.filter(t => !noti.has(t.id)).map(t => t.id) : [];
    if (before.scena !== state.scena) { Object.assign(s, { stallCounter: 0, repeatedIntentIds: [], repeatedTargetIds: [], environmentEscalations: [], npcInterventions: [], pressureResponses: [], lastHintId: null }); }
    if (valut.significativa) s.stallCounter = 0; else s.stallCounter += 1;
    if (intent && intent.repetitionScore > 0) s.repeatedIntentIds = Array.from(new Set(s.repeatedIntentIds.concat([intent.intentType]))).slice(-6);
    if (intent && intent.targetId && intent.repetitionScore > 0) s.repeatedTargetIds = Array.from(new Set(s.repeatedTargetIds.concat([intent.targetId]))).slice(-6);
    // suggerimenti: direzioni verso verità ancora aperte, senza la soluzione
    s.availableHints = s.unresolvedTruthIds.map(id => {
      const t = d.requiredTruths.find(x => x.id === id);
      const src = t.allowedSources[0] || 'luogo';
      const pt = d.interactables.find(p => p.id === t.evidenceIds[0]);
      return { id: 'hint_' + id, verita: id, direzione: /^png:/.test(src) ? { tipo: 'png', png: src.slice(4) } : { tipo: 'luogo', etichetta: pt ? pt.etichetta : null } };
    });
    const svolta = (ev.effetti || []).find(a => a.tipo === 'svolta');
    if (svolta) {
      s.environmentEscalations.push({ evento: ev.n, testo: svolta.testo });
      // mai la stessa direzione che la svolta del motore ha già indicato
      // ("Qualcosa ti richiama: …") né quella del suggerimento precedente
      const detto = norm(ev.svoltaTesto || '');
      const nuovo = h => !(h.direzione.etichetta && detto.indexOf(norm(h.direzione.etichetta)) !== -1) &&
        !(h.direzione.png && detto.indexOf(norm(((content.png[h.direzione.png] || {}).nome || '').split(' ')[0])) !== -1);
      const liberi = s.availableHints.filter(nuovo);
      const next = liberi.find(h => h.id !== s.lastHintId) || liberi[0];
      if (next) {
        s.lastHintId = next.id;
        if (next.direzione.tipo === 'png') s.npcInterventions.push({ evento: ev.n, png: next.direzione.png });
        ev.suggerimentoStallo = next.direzione.tipo === 'png' ? { png: (content.png[next.direzione.png] || {}).nome } : { luogo: next.direzione.etichetta };
      }
      if ((ev.effetti || []).some(a => a.tipo === 'pressione')) s.pressureResponses.push({ evento: ev.n });
    }
    return s;
  }

  /* ---------------------------------------------------------- aftermath

     Dopo un climax, una sconfitta grave, una morte o una rivelazione
     maggiore: la scena successiva si apre con la decompressione, che
     registra conseguenze materiali, assenze, reazioni dei PNG, relazioni,
     nuova condizione quotidiana, guadagni, perdite, tensioni rimaste e il
     primo segnale dell'atto successivo. Tutto dai dati canonici. */
  function aftermathPayload(before, state, content, trigger) {
    const pg = state.personaggio;
    const evs = (state.eventi || []).filter(e => e.scena === before.scena);
    const eff = evs.flatMap(e => e.effetti || []);
    const nomi = id => (content.png[id] || {}).nome || id;
    const prevAct = actOf(content, before.scena), next = actOf(content, state.scena);
    const d = design(content, state.scena);
    return {
      motivo: trigger,
      conseguenzeMateriali: eff.filter(a => ['oggetto_perso', 'consumato', 'ricompensa'].indexOf(a.tipo) !== -1).map(a => (a.tipo === 'ricompensa' ? 'ottenuto: ' : 'perso: ') + a.nome),
      assenze: (E().sceneOf(content, before.scena).png_presenti || []).filter(id => (E().sceneOf(content, state.scena).png_presenti || []).indexOf(id) === -1).map(nomi),
      reazioniPng: (E().sceneOf(content, state.scena).png_presenti || []).map(nomi),
      relazioni: eff.filter(a => a.tipo === 'relazione').map(a => nomi(a.png) + (a.delta > 0 ? ': più fiducia' : ': meno fiducia')),
      condizioneQuotidiana: [].concat(pg.hpCur < pg.hpMaxTracked / 2 ? ['ferite da curare'] : [], state.condizione === 'recupero' ? ['in recupero'] : [], (pg.gemme || []).some(g => g.stato === 'scarica') ? ['gemme spente'] : []),
      guadagni: eff.filter(a => a.tipo === 'avanzamento' || a.tipo === 'scoperta').map(a => a.tipo === 'avanzamento' ? 'livello ' + a.livello : a.testo),
      perdite: eff.filter(a => a.tipo === 'oggetto_perso' || a.tipo === 'sconfitta').map(a => a.tipo === 'sconfitta' ? 'una sconfitta' : a.nome),
      // tensioni della scena appena chiusa che la chiusura non ha risolto
      tensioniRimaste: ((design(content, before.scena) || {}).activeTensions || []).filter(t =>
        !(t.tipo === 'decisione' && state.scelte && state.scelte[before.scena]) && !(t.tipo === 'scontro' && evs.some(e => e.incontroEsito))).map(t =>
        t.tipo === 'pressione' ? t.etichetta : t.tipo === 'scontro' ? 'scontro con ' + ((content.nemici[t.nemico] || {}).nome || '') : 'decisione rimasta aperta'),
      segnaleAtto: next && prevAct && next.actId !== prevAct.actId ? next.actDramaticQuestion : null,
      // la conseguenza principale da affrontare (dai dati registrati)
      principale: pg.hpCur < pg.hpMaxTracked / 2 || state.condizione === 'recupero' ? { tipo: 'ferite' }
        : eff.some(a => a.tipo === 'relazione') ? { tipo: 'relazione', png: eff.filter(a => a.tipo === 'relazione').map(a => a.png) }
          : (pg.gemme || []).some(g => g.stato === 'scarica') ? { tipo: 'gemme' }
            : eff.some(a => a.tipo === 'oggetto_perso' || a.tipo === 'sconfitta') ? { tipo: 'perdita' } : null,
      iniziato: null, dialoghi: [],
      assolto: false
    };
  }
  /* Componenti dell'aftermath (distinto dal confronto e dall'epilogo): cosa
     il Regista può far vivere prima di chiudere la decompressione. Nessun
     numero di turni: finisce solo con una condizione di fineAftermath. */
  function componentiAftermath(af, state, content) {
    if (!af) return null;
    const sc = E().sceneOf(content, state.scena) || {};
    return {
      conseguenzeImmediate: [].concat(af.conseguenzeMateriali || [], af.perdite || [], af.tensioniRimaste || []),
      reazioniPng: (af.reazioniPng || []).slice(),
      ferite: (af.condizioneQuotidiana || []).slice(),
      relazioniTrasformate: (af.relazioni || []).slice(),
      decisioneSeguito: !af.assolto,
      decompressione: true,
      cambioLuogo: (sc.uscite || []).length > 0
    };
  }

  /* Fine della decompressione: basta UNA condizione esplicita, nessun
     numero di turni. Il personaggio lascia il luogo; affronta la
     conseguenza principale; conclude il dialogo nato nella decompressione;
     decide il seguito; una nuova minaccia la interrompe; oppure vale una
     condizione dichiarata dalla scena-seme (semi.scene[id].fineAftermath:
     elenco di tipi di effetto). */
  function fineAftermath(before, state, content, ev, af) {
    const eff = ev.effetti || [];
    const has = t => eff.some(a => a.tipo === t);
    if (before.scena !== state.scena) return 'lascia_luogo';
    if (eff.some(a => a.tipo === 'memoria' && a.genere === 'spostamento_interno')) return 'lascia_luogo';
    if (has('incontro_inizia') || has('incontro_imminente') || has('pressione_massima')) return 'nuova_minaccia';
    if (ev.sceltaId || (ev.check && ev.obiettivo) || ev.tipo === 'scelta_incontro') return 'decisione';
    if (has('dialogo_fine') && eff.some(a => a.tipo === 'dialogo_fine' && af.dialoghi.indexOf(a.png) !== -1)) return 'dialogo_concluso';
    const p = af.principale;
    if (p && p.tipo === 'ferite' && (has('riposo') || eff.some(a => a.tipo === 'hp' && a.delta > 0))) return 'conseguenza_affrontata';
    if (p && p.tipo === 'gemme' && has('gemma_reintegrata')) return 'conseguenza_affrontata';
    if (p && p.tipo === 'relazione' && eff.some(a => (a.tipo === 'memoria' && a.genere === 'relazione') || (a.tipo === 'relazione' && p.png.indexOf(a.png) !== -1))) return 'conseguenza_affrontata';
    if (eff.some(a => a.tipo === 'memoria' && a.genere === 'tensione') && ((state.memoriaNarrativa || {}).voci || []).some(v => v.evento === ev.n && v.tipo === 'tensione' && v.direzione === 'si_risolve')) return 'conseguenza_affrontata';
    const sem = content.semi && content.semi.scene ? content.semi.scene[state.scena] : null;
    if (sem && Array.isArray(sem.fineAftermath) && sem.fineAftermath.some(t => has(t))) return 'condizione_di_scena';
    return null;
  }

  /* ------------------------------------------------ profilo del giocatore */

  function updateProfile(state, ev, cmd, now) {
    const p = state.narrativa.playerNarrativeProfile;
    const k = ev.tipo === 'esplorazione' ? (ev.libera ? 'azione_libera' : 'esplorazione') : ev.tipo;
    p.preferredApproaches[k] = (p.preferredApproaches[k] || 0) + 1;
    if (ev.tipo === 'dialogo') p.dialoguePattern.aperture += 1;
    if (ev.tipo === 'battuta') { if (ev.argomento) p.dialoguePattern.argomenti += 1; else p.dialoguePattern.battuteLibere += 1; }
    if (ev.tipo === 'esplorazione') { if (ev.libera) p.explorationPattern.azioniLibere += 1; else p.explorationPattern.punti += 1; if (ev.deduzione) p.explorationPattern.deduzioni += 1; }
    if (ev.tono === 'promessa') { p.trustPattern.promesse += 1; p.maintainedPromises.push({ evento: ev.n, png: ev.pngNome }); }
    if (ev.combattimento && ev.n && (ev.combattimento.round === 1)) p.conflictPattern.scontri += 1;
    if (ev.incontroEsito === 'fuga') p.conflictPattern.fughe += 1;
    if (ev.tipo === 'scelta_incontro' && cmd && cmd.scelta === 'alternativa') { p.conflictPattern.alternative += 1; p.riskPattern.prudenze += 1; }
    if (ev.tipo === 'scelta_incontro' && cmd && cmd.scelta === 'affronta') p.riskPattern.rischi += 1;
    if (cmd && cmd.intento && cmd.intento.riskAcceptance === 'alta') p.riskPattern.rischi += 1;
    if (ev.check && /fallimento/.test(ev.esito || '')) p.meaningfulFailures.push({ evento: ev.n, obiettivo: ev.obiettivoTesto });
    if ((ev.effetti || []).some(a => a.tipo === 'costo' || a.tipo === 'gemma_scarica')) p.sacrificePattern.costiAccettati += 1;
    (ev.effetti || []).filter(a => a.tipo === 'relazione' && a.delta > 0).forEach(a => { if (p.relationshipPriorities.indexOf(a.png) === -1) p.relationshipPriorities.push(a.png); });
    const tot = Object.values(p.preferredApproaches).reduce((a, b) => a + b, 0);
    p.profileConfidence = Math.min(1, Math.round(tot / 40 * 100) / 100);
    p.lastUpdatedAt = now || null;
    ['maintainedPromises', 'meaningfulFailures'].forEach(k2 => { p[k2] = p[k2].slice(-10); });
  }

  /* --------------------------------------------- dopo ogni comando (regia) */

  function afterCommand(before, state, content, ev, cmd) {
    migrate(state, content);
    const n = state.narrativa;
    const intent = cmd && cmd.intento ? cmd.intento : null;
    const valut = evaluate(before, state, content, ev, cmd);
    const ints = intensityOf(before, state, content, ev);
    const I = n.intensityState;
    I.previousLevel = I.currentLevel; I.currentLevel = ints.livello; I.peakLevel = Math.max(I.peakLevel, ints.livello); I.contentCategory = ints.categoria;
    I.consecutiveHighIntensityEvents = ints.livello >= 4 ? I.consecutiveHighIntensityEvents + 1 : 0;
    // decompressione: dopo un climax, una sconfitta, una morte; dopo una
    // rivelazione solo se è maggiore (scena decisiva o fine d'atto)
    const dScena = design(content, before.scena) || {};
    const maggiore = (dScena.intensityProfile || {}).banda === 'decisive' || !!(dScena.aftermathPolicy && dScena.aftermathPolicy.richiesto);
    if (['climax', 'sconfitta', 'morte'].indexOf(ints.categoria) !== -1 || (ints.categoria === 'rivelazione' && maggiore)) { I.requiresDecompression = true; I.decompressionReason = ints.categoria; }
    // aftermath: aperto entrando nella scena dopo il picco; dura finché non
    // si verifica una condizione esplicita (fineAftermath), senza turni fissi
    let aftermathAttivo = false;
    const nuovo = before.scena !== state.scena && (I.requiresDecompression || (design(content, before.scena) || {}).aftermathPolicy && design(content, before.scena).aftermathPolicy.richiesto);
    if (n.pendingAftermath && !nuovo) {
      const af = n.pendingAftermath;
      if (ev.tipo === 'dialogo' && ev.png && af.dialoghi.indexOf(ev.png) === -1) af.dialoghi.push(ev.png);
      const fine = fineAftermath(before, state, content, ev, af);
      // l'azione che chiude la decompressione ne fa ancora parte
      aftermathAttivo = true;
      if (fine) { af.assolto = true; af.chiusura = { motivo: fine, evento: ev.n }; ev.aftermathChiuso = fine; n.ultimoAftermath = af; n.pendingAftermath = null; I.cooldownState = 0; if (before.scena !== state.scena) aftermathAttivo = false; }
    }
    if (nuovo) {
      n.pendingAftermath = aftermathPayload(before, state, content, I.requiresDecompression ? I.decompressionReason : 'fine atto');
      n.pendingAftermath.iniziato = ev.n;
      ev.aftermath = clone(n.pendingAftermath);
      I.requiresDecompression = false; I.decompressionReason = null; I.cooldownState = 1;
      aftermathAttivo = true;
    }
    // fase drammatica: derivata da cambiamenti registrati, mai da contatori
    n.currentDramaticPhase = dramaticPhase(before, state, content, ev, n, aftermathAttivo);
    n.sceneTension = tension(state, content);
    n.sceneIntensity = ints.livello;
    n.discoveredTruthIds = (state.veritaScoperte || []).map(v => v.id);
    const d = design(content, state.scena);
    if (d) {
      n.activeTensionIds = d.activeTensions.map(t => t.id).filter(id => n.resolvedTensionIds.indexOf(id) === -1);
      const noti = n.discoveredTruthIds;
      n.dramaticProgress = d.requiredTruths.length ? Math.round(d.requiredTruths.filter(t => noti.indexOf(t.id) !== -1).length / d.requiredTruths.length * 100) / 100 : 1;
    }
    if (ev.incontroEsito && d) n.resolvedTensionIds = Array.from(new Set(n.resolvedTensionIds.concat(d.activeTensions.filter(t => t.tipo === 'scontro').map(t => t.id))));
    if (ev.sceltaId && d) n.resolvedTensionIds = Array.from(new Set(n.resolvedTensionIds.concat(d.activeTensions.filter(t => t.tipo === 'decisione').map(t => t.id))));
    (ev.effetti || []).filter(a => a.tipo === 'svolta' || (a.tipo === 'nota' && a.categoria === 'cambiamento')).forEach(a => n.environmentChanges.push({ scena: state.scena, evento: ev.n, testo: a.testo }));
    n.environmentChanges = n.environmentChanges.slice(-20);
    if (valut.chiudeTrasforma) n.sceneTransformations.push({ scena: before.scena, evento: ev.n, tipo: ev.sceltaId ? 'scelta' : ev.incontroEsito ? 'scontro' : before.scena !== state.scena ? 'uscita' : 'pressione' });
    n.sceneTransformations = n.sceneTransformations.slice(-20);
    if (ev.png) {
      const mem = n.npcNarrativeMemory[ev.png] = n.npcNarrativeMemory[ev.png] || { incontri: 0, funzioni: [], svolte: [] };
      if (ev.tipo === 'dialogo') mem.incontri += 1;
      if (ev.dialogoConcluso) mem.svolte.push({ evento: ev.n, motivo: ev.dialogoConcluso });
    }
    // funzione narrativa della battuta (answer, evade, challenge, test, request, reveal, misdirect, negotiate, threaten, concede, close)
    const funzione = dialogueFunction(ev);
    if (funzione && ev.png) { n.npcNarrativeMemory[ev.png].funzioni.push(funzione); n.npcNarrativeMemory[ev.png].funzioni = n.npcNarrativeMemory[ev.png].funzioni.slice(-12); }
    n.dialogueMemory = clone(state.memoriaPng || {});
    if (valut.significativa) n.lastMeaningfulChange = { evento: ev.n, scena: state.scena, tipi: valut.cambiamenti };
    n.interactionHistory.push({ evento: ev.n, tipo: ev.tipo, firma: intent ? intent.firma : null, significativa: valut.significativa });
    n.interactionHistory = n.interactionHistory.slice(-30);
    n.recentNarrativeFunctions.push(valut.cambiamenti[0]); n.recentNarrativeFunctions = n.recentNarrativeFunctions.slice(-8);
    n.emotionalContinuity = { tono: ints.livello >= 4 ? 'teso' : ints.livello >= 3 ? 'allerta' : aftermathAttivo ? 'sospeso' : 'quieto', ultimoPicco: ints.livello >= 4 ? { evento: ev.n, categoria: ints.categoria } : n.emotionalContinuity.ultimoPicco,
      perditeRecenti: ((n.emotionalContinuity.perditeRecenti || []).concat((ev.effetti || []).filter(a => a.tipo === 'oggetto_perso' || a.tipo === 'sconfitta').map(a => a.nome || 'sconfitta'))).slice(-5) };
    n.pendingTransition = null;
    if (before.scena !== state.scena) {
      n.sceneEntrySnapshot = { scena: state.scena, evento: ev.n, hp: state.personaggio.hpCur, mp: state.personaggio.mpCur, verita: n.discoveredTruthIds.length };
      // id di tensioni e fili unici per scena: restano registrati
    }
    if (ev.punto && d && d.optionalThreads.some(o => o.id === ev.punto)) n.activatedThreadIds = Array.from(new Set(n.activatedThreadIds.concat([ev.punto])));
    if (ev.argomento && d && d.optionalThreads.some(o => o.id === ev.argomento)) n.resolvedThreadIds = Array.from(new Set(n.resolvedThreadIds.concat([ev.argomento])));
    const st = stall(before, state, content, ev, valut, intent);
    updateProfile(state, ev, cmd, ev.ts);
    const regia = {
      valutazione: valut, fase: n.currentDramaticPhase, tensione: n.sceneTension, intensita: ints,
      budget: budgetFor(ev, ints.categoria, n.currentDramaticPhase), funzioneBattuta: funzione, stallo: ev.suggerimentoStallo || null,
      exitReady: exitReady(state, content), pov: povMode(content, state.scena)
    };
    if (ev.combattimento) regia.combattimento = combatNarrative(ev);
    return regia;
  }

  // funzione narrativa di un evento di dialogo
  function dialogueFunction(ev) {
    if (ev.tipo === 'dialogo_fine' || ev.dialogoConcluso) return 'close';
    if (ev.tipo === 'dialogo') return 'test';
    if (ev.tipo !== 'battuta') return null;
    if ((ev.effetti || []).some(a => a.tipo === 'verita')) return 'reveal';
    if (ev.tono === 'promessa') return 'concede';
    if (ev.tono === 'minaccia') return 'challenge';
    if (ev.tono === 'menzogna') return 'misdirect';
    if (ev.argomento) return 'answer';
    return 'evade';
  }

  /* exitReady: la scena può chiudersi quando la domanda drammatica è
     risolta o resa irreversibile (verità del cancello scoperte o recuperate
     con il fail-forward), c'è stato almeno un cambiamento significativo,
     il giocatore ha ciò che gli serve per decidere e nessun dialogo o
     evento canonico è in corso. Il giocatore può continuare a interagire. */
  function exitReady(state, content) {
    const it = state.interazione;
    if (state.incontro) return false;
    if (it && it.dialogo) return false;
    if (it && it.sceltaIncontro) return false;
    if (!E().interactionGateOpen(state, content)) return false;
    const d = design(content, state.scena);
    if (d && d.requiredTruths.length && !(state.veritaScoperte || []).some(v => v.scena === state.scena)) return false;
    return true;
  }
  function povMode(content, sceneId) { const d = design(content, sceneId); return d ? d.povPolicy.mode : 'interactiveSecondPerson'; }

  /* ---------------------------------------------- combattimento narrativo */

  function combatNarrative(ev) {
    const az = (ev.combattimento && ev.combattimento.azioni) || [];
    // l'avversario con una tattica può anche coprirsi, coordinare o cambiare fase
    const pgA = az.find(a => a.chi === 'pg'), foeA = az.find(a => a.chi === 'nemico' && a.tipo === 'attacco') || az.find(a => a.chi === 'nemico');
    const persoFoe = pgA && pgA.tipo === 'attacco' ? (pgA.perso != null ? pgA.perso : pgA.esito.finalDamage) : 0;
    const persoPg = foeA ? (foeA.perso != null ? foeA.perso : foeA.esito ? foeA.esito.finalDamage : 0) : 0;
    return {
      combatIntent: pgA ? (pgA.tipo === 'attacco' ? 'colpire' : pgA.tipo === 'supporto' ? 'proteggersi' : pgA.tipo === 'scarica_gemma' ? 'recuperare energia' : pgA.tipo === 'fuga_fallita' ? 'fuggire' : pgA.tipo) : (ev.incontroEsito === 'fuga' ? 'fuggire' : null),
      actionMotion: pgA ? pgA.capacita || pgA.tipo : null,
      impactState: pgA && pgA.tipo === 'attacco' ? (persoFoe > 0 ? 'a segno' : 'mancato') : null,
      defensiveResponse: pgA && pgA.esito && pgA.esito.defense ? (pgA.esito.defense.success ? 'difesa riuscita' : 'difesa superata') : null,
      counterAction: foeA ? { attacco: foeA.capacita || foeA.tipo, esito: foeA.tipo !== 'attacco' ? foeA.tipo : persoPg > 0 ? 'a segno' : 'a vuoto', primo: ev.combattimento.iniziativa === 'nemico' } : null,
      positionChange: null, terrainChange: null,
      resourceNarration: (ev.effetti || []).filter(a => a.tipo === 'costo' || a.tipo === 'gemma_scarica').map(a => a.tipo === 'gemma_scarica' ? 'gemma spenta' : a.risorsa + ' spesi'),
      statusNarration: foeA && foeA.stato ? { nome: foeA.stato.nome, resistito: foeA.stato.resistito } : null,
      defeatNarration: ev.incontroEsito === 'sconfitta' || ev.incontroEsito === 'morte' ? (ev.failForward ? 'fail-forward' : ev.incontroEsito) : null,
      escapeNarration: ev.incontroEsito === 'fuga' ? 'riuscita' : pgA && pgA.tipo === 'fuga_fallita' ? 'fallita' : null,
      combatContinuity: ev.incontroEsito ? 'fine dello scontro' : 'lo scontro continua'
    };
  }

  /* ------------------------------------------------- NarratorContext

     Solo ciò che serve al testo e che il protagonista sa: nessun segreto
     non scoperto, nessun finale non raggiunto, nessuna motivazione che il
     testo potrebbe rivelare impropriamente (solo quelle dei PNG presenti,
     che sono profili pubblici), nessun dato tecnico superfluo. */
  function narratorContext(state, content, ev, voce) {
    const F = global.RMSoloFeedback;
    const sc = E().sceneOf(content, ev.scena) || {};
    const d = design(content, ev.scena) || {};
    const it = state.interazione && state.interazione.scena === ev.scena ? state.interazione : null;
    const n = state.narrativa || fresh();
    const pg = state.personaggio;
    const png = (sc.png_presenti || []).map(id => ({ id, d: content.png[id] || {}, st: (state.png || {})[id] || {} }));
    const mem = state.memoriaPng || {};
    const rel = v => v >= 3 ? 'fiducia piena' : v >= 1 ? 'fiducia' : v <= -3 ? 'ostilità' : v <= -1 ? 'diffidenza' : 'nessun legame particolare';
    const g = content.interazioni && content.interazioni.scene && content.interazioni.scene[ev.scena];
    const dialogMem = png.map(p => {
      const m = it && it.dialoghi && it.dialoghi[p.id];
      const def = g && (g.dialoghi || []).find(x => x.png === p.id);
      const detti = def && m ? (m.argomenti || []).map(a => (def.argomenti.find(x => x.id === a) || {}).testo).filter(Boolean) : [];
      return { png: p.d.nome, argomentiAffrontati: detti, giaIncontrato: ((mem[p.id] || {}).argomenti || []).length > 0, promesse: ((m && m.promesse) || []).map(x => x.testo) };
    }).filter(x => x.argomentiAffrontati.length || x.giaIncontrato || x.promesse.length);
    const res = ev.resoconto || {};
    const bundle = res.bundle || (F && F.bundle ? F.bundle(state, content, ev) : null);
    const truthsText = (state.veritaScoperte || []).filter(v => v.scena === ev.scena).map(v => ((d.requiredTruths || []).find(t => t.id === v.id) || {}).canonicalContent).filter(Boolean);
    const locked = global.RMSoloCampaign ? global.RMSoloCampaign.lockedLexicon(state, content) : [];
    const budget = (ev.regia && ev.regia.budget) || budgetFor(ev, 'ordinaria');
    const ctx = {
      storyId: content.storia, storyVoiceProfile: voiceSummary(content, voce),
      actId: d.actId || null,
      sceneId: ev.scena, scenePurpose: d.scenePurpose || null, dramaticPhase: (ev.regia && ev.regia.fase) || n.currentDramaticPhase, dramaticQuestion: d.dramaticQuestion || null,
      location: sc.luogo || '', sceneTitle: sc.titolo || '', sceneDescription: sc.descrizione || '', timeState: sc.calma ? 'pausa' : 'in corso', environmentState: n.environmentChanges.filter(x => x.scena === ev.scena).map(x => x.testo).slice(-2),
      presentNpcIds: png.map(p => p.id), npcPublicProfiles: png.map(p => ({ nome: p.d.nome, ruolo: p.d.ruolo })),
      npcCurrentAttitudes: png.map(p => ({ nome: p.d.nome, atteggiamento: rel(Number(p.st.atteggiamento) || 0) })),
      npcRelevantMotivations: png.map(p => ({ nome: p.d.nome, motivazione: p.d.motivazione })),
      knownFacts: (state.fattiScoperti || []).map(f => (content.fatti[f] || {}).testo).filter(Boolean),
      discoveredTruths: truthsText,
      relevantDialogueMemory: dialogMem,
      relevantRelationshipState: Object.entries(state.png || {}).filter(([, v]) => v.incontrato).map(([k, v]) => ({ nome: (content.png[k] || {}).nome, relazione: rel(Number(v.atteggiamento) || 0) })),
      activePromises: ((state.sociale && state.sociale.promesse) || []).map(p => p.testo),
      activeThreats: (state.eventi || []).filter(e => e.tono === 'minaccia').slice(-2).map(e => e.pngNome + ': «' + e.testo + '»'),
      activeRumors: ((state.sociale && state.sociale.voci) || []).slice(-2).map(v => v.testo),
      activeTensions: (d.activeTensions || []).filter(t => (n.resolvedTensionIds || []).indexOf(t.id) === -1).map(t => t.tipo === 'pressione' ? t.etichetta : t.tipo === 'scontro' ? 'scontro con ' + ((content.nemici[t.nemico] || {}).nome || '') : 'decisione da prendere'),
      characterPublicIdentity: { nome: pg.nome, popolazione: pg.popolazione, classe: (typeof BUILDS !== 'undefined' && BUILDS[pg.build] || {}).label || pg.build, ruolo: pg.mansione },
      settingOntology: global.RMSoloOntologia ? global.RMSoloOntologia.contesto(content.storia) : '',
      characterBackgroundHooks: [pg.obiettivo].filter(Boolean),
      characterKnowledge: (state.fattiScoperti || []).length,
      characterCondition: [].concat(pg.hpCur < pg.hpMaxTracked / 2 ? ['ferito'] : [], state.condizione === 'recupero' ? ['in recupero'] : [], (state.supporti || []).map(s => s.nome)),
      recentEvents: (state.eventi || []).filter(e => e.scena === ev.scena && e.n < ev.n && e.resoconto).slice(-3).map(e => e.resoconto.azioneDichiarata),
      emotionalContinuity: n.emotionalContinuity,
      playerAction: res.azioneDichiarata || null,
      resolvedOutcome: res.esito || null,
      authorizedConsequences: bundle ? bundle.authorizedNarrativeEffects : [],
      authorizedTransition: res.transizione ? { da: res.transizione.luogoPartenza, a: res.transizione.luogoArrivo, modalita: res.transizione.modalita, durata: res.transizione.durataNarrativa } : null,
      allowedNarrativeClaims: bundle ? bundle.allowedClaims : [],
      forbiddenNarrativeClaims: ['numeri di HP, MP o danni', 'oggetti non assegnati', 'luoghi non autorizzati', 'personaggi non presenti', 'stati non applicati', 'morti non avvenute', 'guarigioni non avvenute', 'relazioni cambiate', 'conoscenze non possedute', 'pensieri, emozioni o intenzioni del protagonista'],
      contenutoStabilito: ev.riserva || null,
      lengthBudget: { min: budget.minSentences, target: budget.targetSentences, max: budget.maxSentences },
      intensityBudget: budget.emotionalIntensity,
      spoilerBoundary: { lessicoBloccato: locked.length > 0 },
      povPolicy: povMode(content, ev.scena),
      // pacchetto della campagna attiva: atto, arco, voci dei PNG presenti, limiti
      campaignContext: global.RMSoloContesto ? global.RMSoloContesto.perTurno(state, content, { presenti: png.map(p => p.id) }) : null
    };
    return deepFreeze(ctx);
  }
  function voiceSummary(content, voce) {
    const v = voiceProfile(content);
    // temi dal pacchetto di contesto (con fonte) quando c'è; altrimenti il profilo precedente
    const cx = global.RMSoloContesto && global.RMSoloContesto.attivo(content);
    const temi = cx && cx.tema && cx.tema.tesi && cx.tema.tesi.classe !== 'canonico_riservato' ? [cx.tema.tesi.v] : (v ? v.primaryThemes : []);
    return { voce: voce && voce.narrative_voice ? voce.narrative_voice.id : (v ? v.voce : null), temi, canali: v ? v.preferredSensoryChannels : [], interiorita: v ? v.interiorityLimit : null };
  }
  function deepFreeze(o) { Object.values(o).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); }); return Object.freeze(o); }
  /* Ordine del contesto per turno (FONTI_E_RIALLINEAMENTO.md §10): le
     regole invarianti e la voce autoriale stanno nel prompt di sistema;
     qui seguono contesto della campagna, atto e funzione della scena,
     arco, luogo, PNG, memoria, conseguenze, conoscenze, segreti ammessi,
     limiti agli spoiler ed esito del motore. */
  function contextText(c) {
    const L = [];
    const CX = global.RMSoloContesto, cc = c.campaignContext;
    const parte = k => (cc && CX ? CX.testoTurno(cc, [k]) : '');
    // 3. contesto della campagna attiva
    L.push('STORIA: ' + c.storyId + (c.storyVoiceProfile.temi.length ? ' — temi: ' + c.storyVoiceProfile.temi.join(', ') : ''));
    if (parte('campagna')) L.push(parte('campagna'));
    if (c.settingOntology) L.push(c.settingOntology);
    // 4. atto, macro-capitolo e funzione della scena
    if (parte('atto')) L.push(parte('atto'));
    L.push('REGIA: ' + [c.scenePurpose ? 'funzione: ' + c.scenePurpose : null, c.dramaticQuestion ? 'domanda: ' + c.dramaticQuestion : null, 'fase: ' + c.dramaticPhase].filter(Boolean).join(' — ') + '.');
    // 5. arco personale
    if (parte('arco')) L.push(parte('arco'));
    // 6. luogo
    L.push('SCENA: ' + c.sceneTitle + ' — ' + c.location + '. ' + c.sceneDescription);
    if (c.environmentState.length) L.push('AMBIENTE CAMBIATO: ' + c.environmentState.join(' '));
    // 7. PNG e avversari presenti
    L.push('PNG PRESENTI:\n' + (c.npcPublicProfiles.map((p, i) => '- ' + p.nome + ' (' + p.ruolo + '; motivazione: ' + c.npcRelevantMotivations[i].motivazione + '; verso il protagonista: ' + c.npcCurrentAttitudes[i].atteggiamento + ')').join('\n') || '- nessuno'));
    if (parte('png')) L.push(parte('png'));
    if (c.activeTensions.length) L.push('TENSIONI APERTE: ' + c.activeTensions.join('; '));
    // 8. memoria pertinente
    c.relevantDialogueMemory.forEach(m => { if (m.argomentiAffrontati.length) L.push(m.png + ' — Ha già parlato di: ' + m.argomentiAffrontati.join('; ') + '. Non ripeterlo.'); if (m.promesse.length) L.push('Promesse ricevute da ' + m.png + ': ' + m.promesse.join('; ') + '.'); });
    if (c.relevantRelationshipState.length) L.push('RELAZIONI NOTE: ' + c.relevantRelationshipState.map(r => r.nome + ' (' + r.relazione + ')').join(', '));
    // 9. conseguenze attive
    if (c.activePromises.length || c.activeThreats.length || c.activeRumors.length) L.push('PROMESSE, MINACCE E VOCI: ' + c.activePromises.concat(c.activeThreats, c.activeRumors.map(v => 'voce non verificata: ' + v)).join('; '));
    // 10. conoscenze disponibili
    L.push('FATTI GIÀ SCOPERTI DAL PROTAGONISTA:\n' + (c.knownFacts.map(f => '- ' + f).join('\n') || '- nessuno'));
    // 11. segreti ammessi (solo verità già rivelate dal motore)
    if (c.discoveredTruths.length) L.push('VERITÀ GIÀ RIVELATE IN QUESTA SCENA:\n' + c.discoveredTruths.map(f => '- ' + f).join('\n'));
    // 12. limiti agli spoiler
    if (parte('limiti')) L.push(parte('limiti'));
    // 13. esito del motore
    L.push('PROTAGONISTA: ' + c.characterPublicIdentity.nome + ', ' + c.characterPublicIdentity.ruolo + (c.characterPublicIdentity.classe ? ' (' + c.characterPublicIdentity.classe + ')' : '') + (c.characterCondition.length ? ' (' + c.characterCondition.join(', ') + ')' : ''));
    L.push('AZIONE DEL GIOCATORE: ' + (c.playerAction || '—'));
    L.push('ESITO (già calcolato, non cambiarlo): ' + c.resolvedOutcome);
    L.push('CONSEGUENZE DA RACCONTARE (tutte, con la loro causa, senza numeri): ' + (c.authorizedConsequences.join('; ') || 'nessuna'));
    if (c.authorizedTransition) L.push('SPOSTAMENTO GIÀ DECISO: da ' + c.authorizedTransition.da + ' a ' + c.authorizedTransition.a + ' (' + c.authorizedTransition.modalita + ', ' + c.authorizedTransition.durata + ')');
    if (c.contenutoStabilito) L.push('CONTENUTO STABILITO (riformulalo senza aggiungere fatti): «' + c.contenutoStabilito + '»');
    L.push('LUNGHEZZA: da ' + c.lengthBudget.min + ' a ' + c.lengthBudget.max + ' frasi (ideale ' + c.lengthBudget.target + '). POV: ' + c.povPolicy + '.');
    return L.join('\n');
  }

  /* ------------------------------------------ metriche del ritmo

     Solo misure diagnostiche, nessuna soglia: servono a bilanciare dopo la
     prova sul telefono. Per scena: turni, dialoghi, azioni libere,
     sottoscene, fili aperti e chiusi, trasformazioni significative, tempo
     misurato fra un turno e il successivo (dai timestamp reali degli
     eventi) e parole di narrazione per turno (dato grezzo: la velocità di
     lettura non è fissata qui); scene concluse senza alcuna interazione
     significativa prima di quella che le chiude. */
  function metriche(state) {
    const evs = state.eventi || [];
    const mem = state.memoriaNarrativa || { voci: [] };
    const parole = t => String(t || '').split(/\s+/).filter(Boolean).length;
    const ordine = [];
    evs.forEach(e => { if (ordine.indexOf(e.scena) === -1) ordine.push(e.scena); });
    const scene = ordine.map(sid => {
      const es = evs.filter(e => e.scena === sid);
      const uscita = es.find(e => (e.effetti || []).some(a => a.tipo === 'scena'));
      const prima = uscita ? es.filter(e => e.n < uscita.n) : es;
      const eff = es.flatMap(e => e.effetti || []);
      const dt = es.slice(1).map((e, i) => (e.ts || 0) - (es[i].ts || 0)).filter(x => x >= 0);
      return {
        scena: sid,
        turni: es.length,
        dialoghi: es.filter(e => e.tipo === 'dialogo').length,
        azioniLibere: es.filter(e => e.libera || e.tipo === 'improvvisazione').length,
        sottoscene: mem.voci.filter(v => v.scena === sid && (v.tipo === 'sottoscena' || v.tipo === 'spostamento_interno')).length,
        filiAperti: eff.filter(a => a.tipo === 'filo' && a.stato === 'aperto').length,
        filiChiusi: eff.filter(a => a.tipo === 'filo' && a.stato === 'chiuso').length,
        trasformazioni: es.filter(e => e.regia && e.regia.valutazione && e.regia.valutazione.significativa).length,
        msMedioFraTurni: dt.length ? Math.round(dt.reduce((a, b) => a + b, 0) / dt.length) : null,
        paroleNarrazionePerTurno: es.length ? Math.round(es.reduce((a, e) => a + parole(e.narrazione && e.narrazione.testo), 0) / es.length) : 0,
        conclusa: !!uscita,
        senzaInterazioneSignificativa: !!uscita && !prima.some(e => e.regia && e.regia.valutazione && e.regia.valutazione.significativa)
      };
    });
    const somma = k => scene.reduce((a, x) => a + (x[k] || 0), 0);
    return {
      scene,
      totale: {
        scene: scene.length, turni: evs.length, dialoghi: somma('dialoghi'), azioniLibere: somma('azioniLibere'), sottoscene: somma('sottoscene'),
        filiAperti: somma('filiAperti'), filiChiusi: somma('filiChiusi'), trasformazioni: somma('trasformazioni'),
        turniPerScena: scene.length ? Math.round(evs.length / scene.length * 10) / 10 : 0,
        sceneSenzaInterazioneSignificativa: scene.filter(x => x.senzaInterazioneSignificativa).length
      }
    };
  }

  global.RMSoloDirector = { componentiAftermath, VERSIONE, FASI, BUDGET, fresh, migrate, interpret, evaluate, afterCommand, exitReady, narratorContext, contextText, budgetFor, dialogueFunction, combatNarrative, design, metriche };
})(typeof window !== 'undefined' ? window : globalThis);
