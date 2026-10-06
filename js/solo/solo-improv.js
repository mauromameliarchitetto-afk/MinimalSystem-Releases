/* ==========================================================================
   Role Makers — Gioca in solitaria: improvvisazione del Narratore.

   L'IA interpreta e propone, il validatore controlla, il motore determina,
   l'IA racconta, la memoria registra. Questo modulo contiene:

   - REGIA_SCHEMA: contratto JSON chiuso del Regista IA (una proposta, mai
     una modifica dello stato);
   - contesto(): contesto compatto per il modello locale (scena-seme,
     stato necessario, PNG presenti, conoscenze, fili, conseguenze, ultimi
     scambi, voce dell'ambientazione presa dal profilo esterno);
   - valida(): accetta, corregge o respinge ogni voce della proposta contro
     canone, scena-seme, segreti, cataloghi e stato del motore;
   - proponi(): proposta deterministica di riserva (senza modello);
   - statoPng()/disposizione(): stato dinamico dei PNG derivato dai dati
     esistenti (nessuna scala nuova: si usa l'atteggiamento del motore);
   - registra(): memoria narrativa tipizzata con provenienza.

   Nessuna costante di bilanciamento nuova: dove non esiste una scala
   approvata (relazioni, tensioni) si registra un evento narrativo
   tipizzato senza convertirlo in un numero.
   ========================================================================== */
(function (global) {
  'use strict';

  const VERSIONE_MEMORIA = 1;
  const E = () => global.RMSoloEngine;
  const F = () => global.RMSoloFeedback;

  const STATI_CANONICI = ['canonico_esplicito', 'canonico_rivelabile', 'proposta', 'dettaglio_locale_validato', 'effimero'];
  const STATI_EPISTEMICI = ['osservato', 'testimoniato', 'dedotto', 'ipotizzato', 'voce', 'menzogna_conosciuta', 'contraddetto', 'confermato'];
  const CLASSI = ['effimero', 'fatto_locale', 'conseguenza', 'filo', 'proposta'];
  const MONDO = ['dettaglio', 'sottoscena', 'png_minore', 'complicazione', 'oggetto_ambiente', 'conseguenza', 'spostamento_interno'];
  const MONDO_VIETATO = ['legge_del_mondo', 'modifica_canone', 'nuovo_fatto_canonico'];
  const MECCANICHE = ['prova_obiettivo', 'prova_libera', 'scontro', 'usa_oggetto', 'loot'];
  const REAZIONI = ['collabora', 'evita', 'mente', 'fraintende', 'cambia_atteggiamento', 'controproposta', 'chiede', 'ricorda', 'interrompe', 'agisce'];
  const INTENSITA = ['lieve', 'marcata', 'forte'];
  const DURATE = ['istante', 'scena', 'atto', 'partita'];
  const VISIBILITA = ['giocatore', 'nascosta'];
  const COLLEGAMENTI = ['obiettivo', 'relazione', 'conflitto', 'scoperta', 'trasformazione', 'conseguenza', 'esplorazione'];
  const PLAUSIBILITA = ['plausibile', 'rischiosa', 'improbabile', 'impossibile'];
  const FUNZIONI = ['answer', 'evade', 'challenge', 'test', 'request', 'reveal', 'misdirect', 'negotiate', 'threaten', 'concede', 'close'];

  const str = { type: 'string' };
  const arr = items => ({ type: 'array', items });
  const obj = (properties, required) => ({ type: 'object', properties, required: required || Object.keys(properties) });
  const causaCampi = { causa: str, intensita: { type: 'string', enum: INTENSITA }, durata: { type: 'string', enum: DURATE }, visibilita: { type: 'string', enum: VISIBILITA } };

  /* Contratto chiuso del Regista IA. Nessun campo applica modifiche: sono
     tutte proposte che valida() accetta, corregge o respinge. */
  const REGIA_SCHEMA = obj({
    intent: str,
    method: str,
    targetEntities: arr(obj({ tipo: { type: 'string', enum: ['png', 'oggetto', 'luogo', 'elemento', 'png_minore'] }, ref: str })),
    requestedOutcome: str,
    plausibility: { type: 'string', enum: PLAUSIBILITA },
    clarificationRequired: obj({ necessario: { type: 'boolean' }, domanda: str }),
    canonReferences: arr(str),
    constraintChecks: arr(str),
    proposedSceneBeat: str,
    npcReactions: arr(obj({ png: str, reazione: { type: 'string', enum: REAZIONI }, testo: str, motivo: str })),
    worldChangeProposals: arr(obj(Object.assign({ tipo: { type: 'string', enum: MONDO.concat(MONDO_VIETATO) }, descrizione: str, classe: { type: 'string', enum: CLASSI }, bersaglio: str }, causaCampi))),
    mechanicalResolutionRequests: arr(obj({ tipo: { type: 'string', enum: MECCANICHE }, obiettivo: str, tratto: str, oggetto: str, motivo: str, passo: { type: 'integer' } }, ['tipo', 'motivo'])),
    revealCandidates: arr(obj({ id: str, fonte: str }, ['id'])),
    relationshipDeltas: arr(obj(Object.assign({ png: str, direzione: { type: 'string', enum: ['migliora', 'peggiora'] } }, causaCampi))),
    tensionDeltas: arr(obj(Object.assign({ tensione: str, direzione: { type: 'string', enum: ['cresce', 'cala', 'si_risolve'] } }, causaCampi))),
    newThreadProposals: arr(obj({ titolo: str, causa: str, collegamento: { type: 'string', enum: COLLEGAMENTI } })),
    resolvedThreadProposals: arr(obj({ id: str, causa: str })),
    transitionProposal: obj({ tipo: { type: 'string', enum: ['nessuna', 'interna', 'scena'] }, luogo: str, verso: str, motivo: str }, ['tipo']),
    narrationPlan: obj({ testo: str, battute: arr(obj({ png: str, funzione: { type: 'string', enum: FUNZIONI }, testo: str })), tono: str }, ['testo']),
    suggestedAffordances: arr(str),
    // comando composto: i passaggi riconosciuti; si esegue solo il primo
    intentSteps: arr(str),
    // campagna lunga: morte di un PNG, convalidata dal motore (causa
    // diegetica, PNG non indispensabile alla trama che resta)
    npcDeathProposals: arr(obj({ png: str, causa: { type: 'string', enum: ['scontro', 'sacrificio', 'conseguenza', 'esecuzione', 'incidente'] }, descrizione: str }))
  });

  /* ---------------------------------------------------------- basi */

  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stems = t => norm(t).split(' ').filter(w => w.length >= 5).map(w => w.slice(0, 5));
  function modoSemi(content) { return !!(content && content.semi && content.semi.scene); }
  function seme(content, sceneId) { return modoSemi(content) ? content.semi.scene[sceneId] || null : null; }
  function pngNome(content, id) { return ((content.png || {})[id] || {}).nome || id; }
  function presenti(state, content) { return (E().currentScene(state, content) || {}).png_presenti || []; }
  function risolviPng(state, content, ref) {
    const r = norm(ref);
    if (!r) return null;
    if (content.png[ref]) return ref;
    const pres = presenti(state, content);
    return pres.find(id => { const n = norm(pngNome(content, id).replace(/\([^)]*\)/g, ' ')); return n === r || n.split(' ').some(w => w.length >= 3 && r.split(' ').indexOf(w) !== -1); }) || null;
  }

  /* ------------------------------------------------ memoria narrativa */

  function memoria(state) {
    if (!state.memoriaNarrativa) state.memoriaNarrativa = { versione: VERSIONE_MEMORIA, voci: [], fili: [], pngMinori: [], luoghiInterni: [] };
    return state.memoriaNarrativa;
  }
  // gli effimeri valgono solo nella scena in cui nascono
  function potaEffimeri(state) {
    const m = memoria(state);
    m.voci = m.voci.filter(v => v.statoCanonico !== 'effimero' || v.scena === state.scena);
  }

  /* --------------------------------------------------- PNG dinamici

     Lo stato dinamico è una vista sui dati esistenti: nessuna scala nuova.
     Il rapporto usa l'atteggiamento del motore con le soglie già usate dal
     Diario; fiducia, sospetto, debiti, conflitti e pressioni sono eventi
     narrativi tipizzati registrati in memoria. I campi psicologici non
     ancora approvati restano null. */
  function disposizione(state, content, id) {
    const v = Number(((state.png || {})[id] || {}).atteggiamento) || 0;
    return v >= 3 ? 'fiducia_piena' : v >= 1 ? 'fiducia' : v <= -3 ? 'ostilita' : v <= -1 ? 'diffidenza' : 'neutro';
  }
  function statoPng(state, content, id) {
    const d = content.png[id] || {};
    const dram = (content.narrativa && content.narrativa.png && content.narrativa.png[id]) || {};
    const m = memoria(state);
    const suoi = m.voci.filter(v => v.bersaglio === id);
    const soc = state.sociale || {};
    const noti = new Set(state.fattiScoperti || []);
    return {
      id, nome: d.nome, ruolo: d.ruolo,
      obiettivoCorrente: d.motivazione || null,
      bisogno: dram.need || null, timore: dram.fear || null, convinzioni: null,
      informazioniConosciute: (d.sa || []).filter(f => noti.has(f)),
      segretiCustoditi: (d.sa || []).filter(f => !noti.has(f)).length,
      informazioniIgnorate: null, credenzeFalse: null,
      rapporto: disposizione(state, content, id),
      fiducia: suoi.filter(v => v.tipo === 'relazione' && v.direzione === 'migliora').map(v => v.causa),
      sospetto: suoi.filter(v => v.tipo === 'relazione' && v.direzione === 'peggiora').map(v => v.causa),
      debito: suoi.filter(v => v.tipo === 'debito').map(v => v.testo),
      promessa: (soc.promesse || []).filter(p => p.png === id).map(p => p.testo),
      conflitto: suoi.filter(v => v.tipo === 'conflitto').map(v => v.testo),
      limiteMorale: dram.boundaries || null,
      comportamentoPubblico: d.ruolo || null,
      intenzioneNascosta: null,
      pressioneSubita: suoi.filter(v => v.tipo === 'pressione').map(v => v.testo),
      voce: dram.speechRegister || null,
      memoriaIncontri: ((state.memoriaPng || {})[id] || {}).argomenti ? ((state.memoriaPng || {})[id].argomenti.length) : 0
    };
  }
  // reazione deterministica di riserva: dal rapporto e dal metodo usato
  function reazioneDi(state, content, id, metodo) {
    const d = disposizione(state, content, id);
    const pressione = /minacc|intimid|promess|scamb|offr|pag/.test(norm(metodo));
    if (d === 'fiducia_piena' || d === 'fiducia') return 'collabora';
    if (d === 'neutro') return pressione ? 'collabora' : 'chiede';
    return pressione ? 'controproposta' : 'evita';
  }

  /* -------------------------------------------------- testo vietato */

  function lessicoBloccato(state, content, testo) {
    const C = global.RMSoloCampaign;
    if (!C || !C.lockedLexicon) return [];
    return C.lexiconHits(testo, C.lockedLexicon(state, content)) || [];
  }
  // un testo che riprende un segreto non ancora scoperto
  function segretoToccato(state, content, testo) {
    const noti = new Set(state.fattiScoperti || []);
    const mine = new Set(stems(testo));
    const segreti = ((content.contratto || {}).verita_riservate || []).concat(Object.keys(content.fatti || {}).filter(f => content.fatti[f].segreto));
    return segreti.filter(f => !noti.has(f) && content.fatti[f]).find(f => {
      const s = Array.from(new Set(stems(content.fatti[f].testo)));
      return s.length >= 4 && s.filter(w => mine.has(w)).length / s.length >= 0.6;
    }) || null;
  }
  const VIETATI = [
    [/\d+\s*(HP|PS|MP|AP|punti (ferita|vita|magia)|danni|danno)\b/i, 'numeri_meccanici'],
    [/\b(sei mort[oa]|muori|il tuo cuore si ferma)\b/i, 'morte_non_decisa'],
    [/\b(ottieni|ricevi|intaschi|trovi e prendi|aggiungi al tuo equipaggiamento)\b/i, 'oggetto_non_assegnato'],
    [/\b(guarisci|le ferite si (chiudono|rimarginano)|recuperi tutte le forze)\b/i, 'cura_non_decisa'],
    [/\b(sali di livello|guadagni (esperienza|punti))\b/i, 'progressione_non_decisa']
  ];
  function problemiTesto(state, content, testo) {
    const p = [];
    const t = String(testo || '');
    if (!t.trim()) return p;
    VIETATI.forEach(([re, k]) => { if (re.test(t)) p.push(k); });
    if (lessicoBloccato(state, content, t).length) p.push('spoiler_lessico');
    if (segretoToccato(state, content, t)) p.push('spoiler_segreto');
    return p;
  }

  /* ----------------------------------------------------- parsing */

  function parseRegia(raw) {
    let p = raw;
    if (typeof raw === 'string') {
      const s = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      try { p = a !== -1 && b !== -1 ? JSON.parse(s.slice(a, b + 1)) : null; } catch (e) { p = null; }
    }
    if (!p || typeof p !== 'object') return null;
    const A = x => Array.isArray(x) ? x.filter(v => v && typeof v === 'object') : [];
    const S = x => typeof x === 'string' ? x.slice(0, 600) : '';
    return {
      intent: S(p.intent), method: S(p.method),
      targetEntities: A(p.targetEntities).map(x => ({ tipo: S(x.tipo), ref: S(x.ref) })),
      requestedOutcome: S(p.requestedOutcome),
      plausibility: PLAUSIBILITA.indexOf(p.plausibility) !== -1 ? p.plausibility : 'plausibile',
      clarificationRequired: p.clarificationRequired && typeof p.clarificationRequired === 'object' ? { necessario: !!p.clarificationRequired.necessario, domanda: S(p.clarificationRequired.domanda) } : { necessario: false, domanda: '' },
      canonReferences: Array.isArray(p.canonReferences) ? p.canonReferences.map(S).filter(Boolean) : [],
      constraintChecks: Array.isArray(p.constraintChecks) ? p.constraintChecks.map(S).filter(Boolean) : [],
      proposedSceneBeat: S(p.proposedSceneBeat),
      npcReactions: A(p.npcReactions).map(x => ({ png: S(x.png), reazione: S(x.reazione), testo: S(x.testo), motivo: S(x.motivo) })),
      worldChangeProposals: A(p.worldChangeProposals).map(x => ({ tipo: S(x.tipo), descrizione: S(x.descrizione), classe: S(x.classe), bersaglio: S(x.bersaglio), causa: S(x.causa), intensita: S(x.intensita), durata: S(x.durata), visibilita: S(x.visibilita), nome: S(x.nome), ruolo: S(x.ruolo), fazione: S(x.fazione) })),
      mechanicalResolutionRequests: A(p.mechanicalResolutionRequests).map(x => ({ tipo: S(x.tipo), obiettivo: S(x.obiettivo), tratto: S(x.tratto), oggetto: S(x.oggetto), motivo: S(x.motivo), passo: Number.isInteger(x.passo) ? x.passo : null, esito: x.esito != null ? S(x.esito) : undefined })),
      revealCandidates: A(p.revealCandidates).map(x => ({ id: S(x.id), fonte: S(x.fonte) })),
      relationshipDeltas: A(p.relationshipDeltas).map(x => ({ png: S(x.png), direzione: S(x.direzione), causa: S(x.causa), intensita: S(x.intensita), durata: S(x.durata), visibilita: S(x.visibilita), valore: x.valore })),
      tensionDeltas: A(p.tensionDeltas).map(x => ({ tensione: S(x.tensione), direzione: S(x.direzione), causa: S(x.causa), intensita: S(x.intensita), durata: S(x.durata), visibilita: S(x.visibilita) })),
      newThreadProposals: A(p.newThreadProposals).map(x => ({ titolo: S(x.titolo), causa: S(x.causa), collegamento: S(x.collegamento) })),
      resolvedThreadProposals: A(p.resolvedThreadProposals).map(x => ({ id: S(x.id), causa: S(x.causa) })),
      transitionProposal: p.transitionProposal && typeof p.transitionProposal === 'object' ? { tipo: S(p.transitionProposal.tipo) || 'nessuna', luogo: S(p.transitionProposal.luogo), verso: S(p.transitionProposal.verso), motivo: S(p.transitionProposal.motivo) } : { tipo: 'nessuna' },
      narrationPlan: p.narrationPlan && typeof p.narrationPlan === 'object' ? { testo: S(p.narrationPlan.testo).slice(0, 2600), battute: A(p.narrationPlan.battute).map(b => ({ png: S(b.png), funzione: FUNZIONI.indexOf(b.funzione) !== -1 ? b.funzione : null, testo: S(b.testo) })), tono: S(p.narrationPlan.tono) } : { testo: '', battute: [], tono: '' },
      suggestedAffordances: Array.isArray(p.suggestedAffordances) ? p.suggestedAffordances.map(S).filter(Boolean) : [],
      intentSteps: Array.isArray(p.intentSteps) ? p.intentSteps.map(S).filter(Boolean).slice(0, 8) : [],
      npcDeathProposals: A(p.npcDeathProposals).map(x => ({ png: S(x.png), causa: S(x.causa), descrizione: S(x.descrizione) }))
    };
  }
  function vuota() { return parseRegia({}); }

  /* --------------------------------------- disponibilità diegetica

     Obiettivi e scelte si possono concepire e tentare solo quando lo stato
     lo rende concretamente possibile. Nessuna lista di pulsanti, nessuna
     verità specifica, nessun contatore: vale qualunque conoscenza
     PERTINENTE della scena, comunque ottenuta (osservazione, dialogo,
     deduzione, improvvisazione convalidata, tentativo, minaccia).
     - pertinente a un obiettivo: viene da un PNG presente, oppure parla
       di ciò che l'obiettivo riguarda (radici in comune con testo e temi);
     - una scelta che nomina PNG presenti richiede anche che quei PNG si
       siano espressi, o che la loro proposta sia nota per altra via;
     - restano le precondizioni già scritte nei dati (richiede: fatti,
       condizioni, oggetti). */
  function conoscenzeScena(state, content) {
    const out = [];
    const sid = state.scena;
    const it = state.interazione && state.interazione.scena === sid ? state.interazione : null;
    const def = content.interazioni && content.interazioni.scene ? content.interazioni.scene[sid] : null;
    const N = content.narrativa && content.narrativa.scene ? content.narrativa.scene[sid] : null;
    const pres = presenti(state, content);
    // entita: riferimenti strutturati (punto, argomento, verità, evidenze,
    // fonti); il testo resta per il confronto lessicale di aiuto
    const k = (testo, fonte, via, entita) => { if (testo) out.push({ testo: String(testo), fonte: fonte || 'luogo', via, entita: (entita || []).filter(Boolean) }); };
    if (it && def) {
      const punti = (def.esplora || []).concat((def.sviluppo || {}).esplora || []);
      it.fatte.forEach(id => { const p = punti.find(x => x.id === id); if (p) k(p.testo + ' ' + (p.riserva || ''), 'luogo', 'osservazione', [p.id]); });
      Object.entries(it.dialoghi || {}).forEach(([png, m]) => {
        const g = (def.dialoghi || []).find(x => x.png === png);
        (m.argomenti || []).forEach(a => { const x = g && g.argomenti.find(y => y.id === a); k(x ? x.testo + ' ' + (x.riserva || '') : '', png, 'dialogo', [a, png]); });
        if (m.libere) k(pngNome(content, png), png, 'dialogo', [png]);
      });
      if (it.sceltaIncontro || it.pressioneMassima) k('minaccia', 'luogo', 'minaccia', ['minaccia']);
    }
    (state.veritaScoperte || []).filter(v => v.scena === sid).forEach(v => {
      const t = N && N.requiredTruths.find(x => x.id === v.id);
      const f = t && (t.allowedSources || []).find(x => /^png:/.test(x));
      k(t ? t.canonicalContent : '', f ? f.slice(4) : 'luogo', v.metodo, t ? [t.id].concat(t.evidenceIds || [], f ? [f.slice(4)] : []) : []);
    });
    (state.note || []).filter(x => x.scena === sid).forEach(x => k(x.testo, 'luogo', 'nota'));
    memoria(state).voci.filter(v => v.scena === sid && v.statoCanonico !== 'effimero' && v.tipo !== 'intenzione').forEach(v => k(v.testo, v.bersaglio && pres.indexOf(v.bersaglio) !== -1 ? v.bersaglio : 'luogo', 'improvvisazione', [v.bersaglio, v.verita]));
    (state.eventi || []).filter(e => e.scena === sid && (e.check || e.incontroEsito)).forEach(e => k(e.obiettivoTesto || e.nemicoNome || 'tentativo', 'luogo', 'tentativo', ['tentativo']));
    return out;
  }
  function pertinente(state, content, c, rif, refs) {
    if (c.fonte !== 'luogo' && presenti(state, content).indexOf(c.fonte) !== -1) return true;
    if (c.via === 'minaccia' || c.via === 'tentativo') return true;
    // campagna lunga: prima i riferimenti strutturati; il lessico aiuta solo
    // per ciò che non ha entità (testo libero improvvisato)
    if (refs && c.entita && c.entita.length) return c.entita.some(x => refs.indexOf(x) !== -1);
    const r = new Set(stems(rif));
    return stems(c.testo).some(w => r.has(w));
  }
  function nominati(state, content, testo) {
    const t = ' ' + norm(testo) + ' ';
    return presenti(state, content).filter(id => norm(pngNome(content, id).replace(/\([^)]*\)/g, ' ')).split(' ').some(w => w.length >= 3 && t.indexOf(' ' + w + ' ') !== -1));
  }
  function possibilita(state, content) {
    const sc = E().currentScene(state, content) || {};
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const res = { attiva: !!(it && it.modo === 'semi'), obiettivi: {}, scelte: {} };
    const cs = res.attiva ? conoscenzeScena(state, content) : [];
    const ST = global.RMSoloStruttura && global.RMSoloStruttura.attivo(content) ? global.RMSoloStruttura : null;
    (sc.obiettivi || []).forEach(o => {
      if (!res.attiva) { res.obiettivi[o.id] = { ok: true }; return; }
      const rif = o.testo + ' ' + (o.tag || []).join(' ');
      const refs = ST ? ST.riferimenti(content, state.scena, 'obiettivi', o.id) : null;
      // conoscenza pertinente di questa scena, oppure (con i riferimenti
      // strutturati) portata da un capitolo precedente
      const ok = cs.some(c => pertinente(state, content, c, rif, refs)) || !!(refs && ST.conoscenzePrecedenti(state, refs).length);
      res.obiettivi[o.id] = ok ? { ok: true } : { ok: false, motivo: 'Non sai ancora abbastanza di questa situazione per tentarlo.' };
    });
    (sc.scelte || []).forEach(c => {
      if (!res.attiva) { res.scelte[c.id] = { ok: true }; return; }
      const rif = c.testo + ' ' + (sc.obiettivi || []).map(o => o.testo).join(' ');
      const refs = ST ? ST.riferimenti(content, state.scena, 'scelte', c.id) : null;
      const problema = cs.some(k => pertinente(state, content, k, rif, refs)) || !!(refs && ST.conoscenzePrecedenti(state, refs).length);
      // il PNG si è espresso qui, oppure la sua posizione è nota per altra
      // via: citato in ciò che si è scoperto, o conosciuto in una scena precedente
      const giaIncontrati = new Set((state.eventi || []).filter(e => e.scena !== state.scena).flatMap(e => (E().sceneOf(content, e.scena) || {}).png_presenti || []));
      const mancano = nominati(state, content, c.testo).filter(id => !cs.some(k => k.fonte === id) && !cs.some(k => norm(k.testo).indexOf(norm(pngNome(content, id)).split(' ')[0]) !== -1) && !giaIncontrati.has(id));
      res.scelte[c.id] = problema && !mancano.length ? { ok: true } : { ok: false, motivo: !problema ? 'Non conosci ancora questa possibilità.' : 'Non sai ancora che cosa propone ' + pngNome(content, mancano[0]) + '.' };
    });
    return res;
  }

  /* Comando composto: più azioni in sequenza nello stesso messaggio. Si
     riconosce l'obiettivo complessivo, si esegue il primo passaggio
     significativo e il resto resta un'intenzione per i turni successivi. */
  function passiComposti(testo) {
    const t = String(testo || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const parti = t.split(/\s*(?:;|\.\s+|,?\s+(?:e\s+)?(?:poi|quindi|dopodich[eé]|dopo di che|infine|successivamente|alla fine)\b|,\s+(?=(?:mi |ti |ci |gli |le |lo |la |ne )?[a-zàèéìòù]{3,}(?:o|isco)\b))\s*/i).map(x => x.trim().replace(/^(?:e\s+)?(?:poi|quindi|dopodich[eé]|dopo di che|infine|successivamente|alla fine)\s+/i, '')).filter(x => x.split(' ').length >= 2);
    return parti.length > 1 ? parti : [t];
  }

  /* ------------------------------------------------------ validatore

     Ogni voce è accettata, corretta o respinta con un motivo. "Sostanziale"
     quando cade il nucleo della proposta (azione impossibile, richiesta
     meccanica respinta, testo narrativo con effetti o segreti non
     ammessi, più della metà delle voci respinte): in quel caso la
     narrazione del modello non si usa e vale la riserva coerente. */
  function valida(state, content, proposta, opts) {
    const p = proposta ? parseRegia(proposta) : vuota();
    const testo = opts && opts.testo ? opts.testo : '';
    const rilevati = passiComposti(testo);
    const passi = p.intentSteps.length > 1 ? p.intentSteps : rilevati;
    const composto = passi.length > 1;
    const poss = possibilita(state, content);
    const acc = vuota();
    const respinte = [], corrette = [];
    let voci = 0;
    const no = (campo, voce, motivo) => { respinte.push({ campo, voce, motivo }); };
    const sc = E().currentScene(state, content) || {};
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const pres = presenti(state, content);
    const mem = memoria(state);
    const minori = mem.pngMinori.filter(x => x.scena === state.scena || x.persistente).map(x => norm(x.ruolo + ' ' + (x.nome || '')));
    const sem = seme(content, state.scena);

    acc.intent = p.intent; acc.method = p.method; acc.requestedOutcome = p.requestedOutcome;
    acc.plausibility = p.plausibility; acc.constraintChecks = p.constraintChecks; acc.suggestedAffordances = p.suggestedAffordances.slice(0, 6);
    acc.intentSteps = passi;
    // intenzione residua di un comando composto: resta per i turni dopo
    acc.intenzione = composto ? passi.slice(1).join(' → ') : null;
    if (composto) corrette.push({ campo: 'intentSteps', voce: passi[0], motivo: 'comando composto: si esegue solo il primo passaggio' });
    if (p.plausibility === 'impossibile') return { ok: false, rifiuto: 'Non è qualcosa che il tuo personaggio può fare qui.', accettata: acc, respinte: [{ campo: 'plausibility', motivo: 'impossibile' }], corrette, sostanziale: true };
    if (p.clarificationRequired.necessario) {
      return { ok: false, chiarimento: p.clarificationRequired.domanda || 'Che risultato stai cercando?', accettata: acc, respinte, corrette, sostanziale: false };
    }
    // entità: PNG presenti, oggetti posseduti, elementi di scena, PNG minori già convalidati
    p.targetEntities.forEach(t => {
      voci++;
      if (t.tipo === 'png') { const id = risolviPng(state, content, t.ref); if (id && pres.indexOf(id) !== -1) acc.targetEntities.push({ tipo: 'png', ref: id }); else if (id) no('targetEntities', t.ref, pngNome(content, id) + ' non è qui'); else no('targetEntities', t.ref, 'nessun personaggio con questo nome'); return; }
      if (t.tipo === 'png_minore') { if (minori.some(m => norm(t.ref) && m.indexOf(norm(t.ref)) !== -1)) acc.targetEntities.push(t); else no('targetEntities', t.ref, 'PNG minore non ancora convalidato'); return; }
      if (t.tipo === 'oggetto') { const has = (state.inventario || []).some(i => { const d = E().itemInfo(state, content, i.id); return d && norm(d.nome).indexOf(norm(t.ref)) !== -1; }); if (has) acc.targetEntities.push(t); else no('targetEntities', t.ref, 'oggetto non posseduto'); return; }
      acc.targetEntities.push(t); // luogo o elemento: vale come dettaglio della scena
    });
    // riferimenti al canone: solo fatti già noti o pubblici
    p.canonReferences.forEach(r => {
      voci++;
      const f = (content.fatti || {})[r];
      if (!f) { no('canonReferences', r, 'riferimento inesistente'); return; }
      const riservato = ((content.contratto || {}).verita_riservate || []).indexOf(r) !== -1 || f.segreto;
      if (riservato && (state.fattiScoperti || []).indexOf(r) === -1) { no('canonReferences', r, 'segreto non ancora rivelabile'); return; }
      acc.canonReferences.push(r);
    });
    // richieste meccaniche: il motore determina sempre l'esito
    let meccanicaRespinta = false;
    p.mechanicalResolutionRequests.forEach(m => {
      voci++;
      if (m.esito !== undefined) corrette.push({ campo: 'mechanicalResolutionRequests', voce: m.tipo, motivo: 'esito proposto ignorato: lo decide il motore' });
      const tratto = m.tratto && m.tratto !== 'nessuno' ? (global.RMSoloRules.traitValue(state.personaggio, m.tratto) ? m.tratto : null) : 'nessuno';
      if (m.tratto && m.tratto !== 'nessuno' && !tratto) corrette.push({ campo: 'mechanicalResolutionRequests', voce: m.tratto, motivo: 'tratto non in scheda: prova senza competenza' });
      // comando composto: la risoluzione vale solo se è il primo passaggio
      if (composto && m.passo !== 1) { meccanicaRespinta = true; no('mechanicalResolutionRequests', m.tipo, 'fa parte di un passaggio successivo del comando'); return; }
      if (m.tipo === 'prova_obiettivo') {
        const ob = (sc.obiettivi || []).find(o => o.id === m.obiettivo);
        if (!ob) { meccanicaRespinta = true; no('mechanicalResolutionRequests', m.obiettivo, 'obiettivo inesistente in questa scena'); return; }
        const pos = poss.obiettivi[ob.id];
        if (pos && !pos.ok) { meccanicaRespinta = true; no('mechanicalResolutionRequests', m.obiettivo, 'posizione narrativa insufficiente: ' + pos.motivo); return; }
        if (state.obiettivi[ob.id] && state.obiettivi[ob.id].completato) { meccanicaRespinta = true; no('mechanicalResolutionRequests', m.obiettivo, 'obiettivo già raggiunto'); return; }
        acc.mechanicalResolutionRequests.push({ tipo: m.tipo, obiettivo: ob.id, tratto: tratto || 'nessuno', oggetto: m.oggetto || 'nessuno', motivo: m.motivo });
      } else if (m.tipo === 'prova_libera') {
        acc.mechanicalResolutionRequests.push({ tipo: m.tipo, tratto: tratto || 'nessuno', motivo: m.motivo });
      } else if (m.tipo === 'scontro') {
        if (it && it.incontroInAttesa) acc.mechanicalResolutionRequests.push({ tipo: m.tipo, motivo: m.motivo });
        else { meccanicaRespinta = true; no('mechanicalResolutionRequests', 'scontro', 'nessuno scontro previsto qui'); }
      } else if (m.tipo === 'usa_oggetto') {
        const inv = (state.inventario || []).find(i => { const d = E().itemInfo(state, content, i.id); return d && (i.id === m.oggetto || norm(d.nome).indexOf(norm(m.oggetto)) !== -1); });
        const d = inv && E().itemInfo(state, content, inv.id);
        if (d && d.tipo === 'consumabile' && d.effetto) acc.mechanicalResolutionRequests.push({ tipo: m.tipo, oggetto: inv.id, motivo: m.motivo });
        else { meccanicaRespinta = true; no('mechanicalResolutionRequests', m.oggetto, 'oggetto non posseduto o non consumabile'); }
      } else if (m.tipo === 'loot') {
        meccanicaRespinta = true; no('mechanicalResolutionRequests', 'loot', 'gli oggetti arrivano solo dagli effetti del motore');
      } else { meccanicaRespinta = true; no('mechanicalResolutionRequests', m.tipo, 'richiesta non prevista'); }
    });
    // una richiesta alla volta: le altre restano proposte per il turno dopo
    if (acc.mechanicalResolutionRequests.length > 1) {
      acc.mechanicalResolutionRequests.slice(1).forEach(m => corrette.push({ campo: 'mechanicalResolutionRequests', voce: m.tipo, motivo: 'una risoluzione per comando: rimandata' }));
      acc.mechanicalResolutionRequests = acc.mechanicalResolutionRequests.slice(0, 1);
    }
    // rivelazioni: solo materiale della scena, mai segreti o fatti canonici
    // non ancora ottenuti dal motore; testimonianze solo se il PNG le direbbe
    p.revealCandidates.forEach(r => {
      voci++;
      const cls = content.semi && content.semi.verita && content.semi.verita[r.id];
      const inScena = sem && sem.veritaRivelabili.materialeDiScena.indexOf(r.id) !== -1;
      if ((content.fatti || {})[r.id]) { no('revealCandidates', r.id, 'i fatti canonici si ottengono solo tramite il motore'); return; }
      if (!cls || !inScena) { no('revealCandidates', r.id, 'non rivelabile in questa scena'); return; }
      if (cls.statoCanonico === 'canonico_rivelabile') { no('revealCandidates', r.id, 'segreto non ancora rivelabile'); return; }
      if (cls.statoEpistemico === 'testimoniato') {
        const reaz = reazioneDi(state, content, cls.fonte, p.method);
        if (pres.indexOf(cls.fonte) === -1) { no('revealCandidates', r.id, pngNome(content, cls.fonte) + ' non è qui'); return; }
        if (reaz === 'evita') { no('revealCandidates', r.id, pngNome(content, cls.fonte) + ' non lo direbbe ora'); return; }
      }
      acc.revealCandidates.push({ id: r.id, fonte: cls.fonte, statoEpistemico: cls.statoEpistemico });
    });
    // reazioni dei PNG: solo presenti, testo senza effetti non ammessi
    p.npcReactions.forEach(n => {
      voci++;
      const id = risolviPng(state, content, n.png);
      if (!id || pres.indexOf(id) === -1) { no('npcReactions', n.png, 'PNG non presente'); return; }
      if (REAZIONI.indexOf(n.reazione) === -1) { no('npcReactions', n.reazione, 'reazione non prevista'); return; }
      if (n.reazione === 'interrompe' && !n.motivo) { no('npcReactions', n.png, 'interruzione senza motivo'); return; }
      const pb = problemiTesto(state, content, n.testo);
      if (pb.length) { no('npcReactions', n.png, pb.join(',')); return; }
      acc.npcReactions.push({ png: id, reazione: n.reazione, testo: n.testo, motivo: n.motivo });
    });
    // cambiamenti del mondo: mai leggi o canone; persistenti solo con causa
    p.worldChangeProposals.forEach(w => {
      voci++;
      if (MONDO_VIETATO.indexOf(w.tipo) !== -1) { no('worldChangeProposals', w.tipo, 'il Narratore non modifica il canone né le leggi del mondo'); return; }
      if (MONDO.indexOf(w.tipo) === -1 || CLASSI.indexOf(w.classe) === -1) { no('worldChangeProposals', w.tipo, 'tipo o classe non previsti'); return; }
      const pb = problemiTesto(state, content, w.descrizione + ' ' + (w.nome || '') + ' ' + (w.ruolo || ''));
      if (pb.length) { no('worldChangeProposals', w.descrizione, pb.join(',')); return; }
      if (w.classe !== 'effimero' && !w.causa) { corrette.push({ campo: 'worldChangeProposals', voce: w.descrizione, motivo: 'senza causa: resta effimero' }); w = Object.assign({}, w, { classe: 'effimero' }); }
      if (w.tipo === 'png_minore') {
        const fz = w.fazione ? norm(w.fazione) : '';
        const note = Object.keys((state.sociale && state.sociale.reputazione) || {}).concat(Object.keys(content.fazioni || {})).map(norm);
        if (fz && note.length && note.indexOf(fz) === -1 && !JSON.stringify(content.vincoli_narrativi || []).toLowerCase().includes(fz)) { no('worldChangeProposals', w.fazione, 'fazione estranea all\'ambientazione'); return; }
        if (!w.ruolo) { no('worldChangeProposals', w.descrizione, 'PNG minore senza ruolo'); return; }
      }
      acc.worldChangeProposals.push(Object.assign({}, w, {
        intensita: INTENSITA.indexOf(w.intensita) !== -1 ? w.intensita : 'lieve',
        durata: DURATE.indexOf(w.durata) !== -1 ? w.durata : (w.classe === 'effimero' ? 'scena' : 'partita'),
        visibilita: VISIBILITA.indexOf(w.visibilita) !== -1 ? w.visibilita : 'giocatore'
      }));
    });
    // relazioni e tensioni: eventi narrativi tipizzati, mai numeri
    p.relationshipDeltas.forEach(r => {
      voci++;
      if (r.valore !== undefined) corrette.push({ campo: 'relationshipDeltas', voce: r.png, motivo: 'valore numerico ignorato: nessuna scala approvata' });
      const id = risolviPng(state, content, r.png);
      if (!id || pres.indexOf(id) === -1) { no('relationshipDeltas', r.png, 'PNG non presente'); return; }
      if (['migliora', 'peggiora'].indexOf(r.direzione) === -1 || !r.causa) { no('relationshipDeltas', r.png, 'direzione o causa mancanti'); return; }
      acc.relationshipDeltas.push({ png: id, direzione: r.direzione, causa: r.causa, intensita: INTENSITA.indexOf(r.intensita) !== -1 ? r.intensita : 'lieve', durata: DURATE.indexOf(r.durata) !== -1 ? r.durata : 'partita', visibilita: VISIBILITA.indexOf(r.visibilita) !== -1 ? r.visibilita : 'giocatore' });
    });
    p.tensionDeltas.forEach(t => {
      voci++;
      if (!t.causa || ['cresce', 'cala', 'si_risolve'].indexOf(t.direzione) === -1) { no('tensionDeltas', t.tensione, 'direzione o causa mancanti'); return; }
      acc.tensionDeltas.push(Object.assign({}, t, { intensita: INTENSITA.indexOf(t.intensita) !== -1 ? t.intensita : 'lieve', durata: DURATE.indexOf(t.durata) !== -1 ? t.durata : 'scena', visibilita: VISIBILITA.indexOf(t.visibilita) !== -1 ? t.visibilita : 'giocatore' }));
    });
    // fili: ogni sviluppo contribuisce ad almeno un elemento della trama
    p.newThreadProposals.forEach(f => {
      voci++;
      if (!f.titolo || !f.causa || COLLEGAMENTI.indexOf(f.collegamento) === -1) { no('newThreadProposals', f.titolo, 'titolo, causa o collegamento mancanti'); return; }
      const pb = problemiTesto(state, content, f.titolo);
      if (pb.length) { no('newThreadProposals', f.titolo, pb.join(',')); return; }
      acc.newThreadProposals.push(f);
    });
    p.resolvedThreadProposals.forEach(f => {
      voci++;
      if (!mem.fili.some(x => x.id === f.id && x.stato === 'aperto')) { no('resolvedThreadProposals', f.id, 'filo inesistente o già chiuso'); return; }
      acc.resolvedThreadProposals.push(f);
    });
    // morte di un PNG: il validatore controlla la forma, il motore la convalida
    p.npcDeathProposals.forEach(d => {
      voci++;
      const id = risolviPng(state, content, d.png);
      if (!id || pres.indexOf(id) === -1) { no('npcDeathProposals', d.png, 'PNG non presente'); return; }
      if (composto) { no('npcDeathProposals', d.png, 'comando composto: fa parte di un passaggio successivo'); return; }
      const PN = global.RMSoloPng;
      const v = PN ? PN.validaMorte(state, content, id, { tipo: d.causa, descrizione: d.descrizione }) : { ok: false, motivo: 'non gestita' };
      if (!v.ok) { no('npcDeathProposals', d.png, v.motivo); return; }
      acc.npcDeathProposals.push({ png: id, causa: d.causa, descrizione: d.descrizione });
    });
    // spostamenti: interni liberi; cambio di scena solo con un'uscita aperta
    const tp = p.transitionProposal;
    if (tp.tipo === 'interna') { voci++; const pb = problemiTesto(state, content, tp.luogo); if (pb.length || !tp.luogo) no('transitionProposal', tp.luogo, pb.join(',') || 'luogo mancante'); else acc.transitionProposal = tp; }
    else if (tp.tipo === 'scena') {
      voci++;
      const u = (sc.uscite || []).find(x => x.verso === tp.verso);
      if (composto) no('transitionProposal', tp.verso, 'comando composto: lo spostamento resta un\'intenzione');
      else if (global.RMSoloStruttura && global.RMSoloStruttura.attivo(content) && !global.RMSoloStruttura.pronta(state)) no('transitionProposal', tp.verso, 'il capitolo non è ancora concluso: il contratto non è soddisfatto');
      else if (u && E().conditionMet(state, u.quando)) acc.transitionProposal = tp;
      else no('transitionProposal', tp.verso, 'la scena cambia solo quando lo stato lo consente');
    }
    // narrazione proposta: niente effetti non decisi, niente spoiler
    let narrRespinta = false;
    const pbN = problemiTesto(state, content, [p.narrationPlan.testo, p.proposedSceneBeat].concat(p.narrationPlan.battute.map(b => b.testo)).join(' '));
    if (pbN.length) { narrRespinta = true; no('narrationPlan', 'testo', pbN.join(',')); }
    else {
      acc.proposedSceneBeat = p.proposedSceneBeat;
      acc.narrationPlan = { testo: p.narrationPlan.testo, battute: p.narrationPlan.battute.filter(b => { const id = risolviPng(state, content, b.png); if (id && pres.indexOf(id) !== -1) { b.png = pngNome(content, id); return true; } no('narrationPlan', b.png, 'battuta di un PNG assente'); return false; }), tono: p.narrationPlan.tono };
    }
    // un comando composto che il modello non ha scomposto: il suo testo
    // potrebbe raccontare passaggi non ancora avvenuti
    const nonScomposto = composto && p.intentSteps.length < 2;
    const sostanziale = narrRespinta || meccanicaRespinta || nonScomposto || (voci > 0 && respinte.length * 2 > voci);
    return { ok: true, accettata: acc, respinte, corrette, sostanziale };
  }

  /* ------------------------------------- proposta deterministica (riserva)

     Senza modello: intento dal riconoscitore del regista, obiettivo di
     scena secondo l'interprete di riserva classico, reazione dei PNG dal
     rapporto. Il resto della risposta passa alla riserva classica. */
  function proponi(testo, state, content) {
    const p = vuota();
    const passi = passiComposti(testo);
    if (passi.length > 1) { p.intentSteps = passi; testo = passi[0]; }
    const D = global.RMSoloDirector;
    const i = D ? D.interpret(testo, state, content) : null;
    p.intent = i ? i.intentType : 'altro';
    p.method = i ? i.method : 'azione_libera';
    p.plausibility = 'plausibile';
    if (i && i.targetType === 'png') { p.targetEntities.push({ tipo: 'png', ref: i.targetId }); p.npcReactions.push({ png: i.targetId, reazione: reazioneDi(state, content, i.targetId, testo), testo: '', motivo: 'rapporto attuale' }); }
    const N = global.RMSoloNarrator;
    const f = N ? N.fallbackInterpret(testo, state, content) : null;
    const sc = E().currentScene(state, content) || {};
    if (f && f.tipo === 'rifiuto') { p.plausibility = 'impossibile'; return p; }
    // riserva classica: l'interprete di riserva esistente decide se il
    // testo punta all'obiettivo della scena (stesso criterio di prima)
    const ps = possibilita(state, content);
    if (f && f.tipo === 'azione' && f.obiettivo !== 'nessuno' && (sc.obiettivi || []).some(o => o.id === f.obiettivo) && (!ps.obiettivi[f.obiettivo] || ps.obiettivi[f.obiettivo].ok)) {
      p.mechanicalResolutionRequests.push({ tipo: 'prova_obiettivo', obiettivo: f.obiettivo, tratto: f.tratto, oggetto: f.oggetto, motivo: 'azione rivolta all\'obiettivo della scena', passo: 1 });
    }
    p.riserva = true;
    return p;
  }

  /* ------------------------------------------------------ registrazione

     Scrive in memoria solo ciò che il validatore ha accettato, con causa,
     fonte, bersaglio, intensità, durata, visibilità, revisionabilità ed
     evento d'origine. Ritorna gli effetti per il resoconto. */
  function registra(state, content, acc, evento, fonte, applied) {
    const m = memoria(state);
    // una nuova azione sostituisce l'intenzione residua precedente della scena
    m.voci.filter(v => v.tipo === 'intenzione' && v.scena === state.scena && v.stato === 'in_sospeso').forEach(v => { v.stato = 'superata'; v.superataDa = evento; });
    if (acc.intenzione) {
      const v = { id: 'm' + (m.voci.length + 1), tipo: 'intenzione', testo: acc.intenzione, passoEseguito: acc.intentSteps[0] || null, stato: 'in_sospeso', causa: 'comando composto', fonte, bersaglio: null, intensita: 'lieve', durata: 'scena', visibilita: 'giocatore', revisionabile: true, evento, scena: state.scena, statoCanonico: 'effimero', statoEpistemico: 'ipotizzato' };
      m.voci.push(v);
      applied.push({ tipo: 'intenzione', voce: v.id, testo: v.testo });
    }
    const base = (o) => Object.assign({ id: 'm' + (m.voci.length + 1), scena: state.scena, evento, fonte, revisionabile: true, visibilita: 'giocatore' }, o);
    const push = v => { m.voci.push(v); applied.push({ tipo: 'memoria', voce: v.id, classe: v.statoCanonico, genere: v.tipo, testo: v.testo }); };
    acc.worldChangeProposals.forEach(w => {
      const cls = w.classe === 'effimero' ? 'effimero' : w.classe === 'proposta' ? 'proposta' : 'dettaglio_locale_validato';
      if (w.tipo === 'png_minore') {
        const pm = { id: 'pm' + (m.pngMinori.length + 1), nome: w.nome || null, ruolo: w.ruolo, fazione: w.fazione || null, luogo: (E().currentScene(state, content) || {}).luogo, scena: state.scena, evento, persistente: cls === 'dettaglio_locale_validato', statoCanonico: cls, fonte };
        m.pngMinori.push(pm);
      }
      if (w.tipo === 'sottoscena' || w.tipo === 'spostamento_interno') m.luoghiInterni.push({ luogo: w.descrizione, scena: state.scena, evento, statoCanonico: cls });
      push(base({ tipo: w.tipo === 'conseguenza' ? 'conseguenza' : w.tipo, testo: w.descrizione, causa: w.causa || null, bersaglio: w.bersaglio || null, intensita: w.intensita, durata: w.durata, visibilita: w.visibilita, statoCanonico: cls, statoEpistemico: 'osservato' }));
    });
    acc.relationshipDeltas.forEach(r => push(base({ tipo: 'relazione', testo: pngNome(content, r.png) + (r.direzione === 'migliora' ? ': più vicino' : ': più distante'), direzione: r.direzione, causa: r.causa, bersaglio: r.png, intensita: r.intensita, durata: r.durata, visibilita: r.visibilita, statoCanonico: 'dettaglio_locale_validato', statoEpistemico: 'osservato' })));
    acc.tensionDeltas.forEach(t => push(base({ tipo: 'tensione', testo: t.tensione, direzione: t.direzione, causa: t.causa, bersaglio: null, intensita: t.intensita, durata: t.durata, visibilita: t.visibilita, statoCanonico: 'dettaglio_locale_validato', statoEpistemico: 'osservato' })));
    acc.npcReactions.filter(n => n.testo).forEach(n => push(base({ tipo: 'testimonianza', testo: n.testo, reazione: n.reazione, causa: n.motivo || null, bersaglio: n.png, intensita: 'lieve', durata: 'partita', statoCanonico: 'dettaglio_locale_validato', statoEpistemico: n.reazione === 'mente' ? 'menzogna_conosciuta' : 'testimoniato' })));
    acc.newThreadProposals.forEach(f => {
      const id = 'f' + (m.fili.length + 1);
      m.fili.push({ id, titolo: f.titolo, stato: 'aperto', causa: f.causa, collegamento: f.collegamento, evento, scena: state.scena, fonte });
      applied.push({ tipo: 'filo', filo: id, stato: 'aperto', titolo: f.titolo });
    });
    acc.resolvedThreadProposals.forEach(f => {
      const x = m.fili.find(y => y.id === f.id);
      x.stato = 'chiuso'; x.chiusoDa = evento; x.causaChiusura = f.causa;
      applied.push({ tipo: 'filo', filo: x.id, stato: 'chiuso', titolo: x.titolo });
    });
    if (acc.transitionProposal && acc.transitionProposal.tipo === 'interna') {
      m.luoghiInterni.push({ luogo: acc.transitionProposal.luogo, scena: state.scena, evento, statoCanonico: 'dettaglio_locale_validato' });
      push(base({ tipo: 'spostamento_interno', testo: acc.transitionProposal.luogo, causa: acc.transitionProposal.motivo || null, bersaglio: null, intensita: 'lieve', durata: 'scena', statoCanonico: 'effimero', statoEpistemico: 'osservato' }));
    }
  }

  /* ------------------------------------------------ contesto compatto

     Solo ciò che serve a questo turno (n_ctx 4096 sul dispositivo): regole
     essenziali, scena-seme corrente, stato meccanico necessario, PNG
     presenti, conoscenze e relazioni pertinenti, fili, conseguenze attive,
     ultimi scambi, voce dell'ambientazione (profilo esterno sostituibile:
     nessuna parte dello stile è nel codice né nella partita). */
  const REGOLE = [
    'Interpreti l\'azione del giocatore e PROPONI lo sviluppo: non applichi nulla, il motore decide.',
    'Ogni azione plausibile, anche non prevista, è una soluzione autentica: non ricondurla a una lista.',
    'Chiedi chiarimento solo se manca un\'informazione indispensabile.',
    'Prove, costi, danni, cure, stati, oggetti e scontri si chiedono in mechanicalResolutionRequests: mai decisi nel testo.',
    'Non rivelare segreti, non cambiare il canone, non inventare leggi del mondo, non imporre scelte, non chiudere dialoghi da solo.',
    'I PNG reagiscono secondo obiettivo, rapporto e ciò che sanno; possono evitare, mentire, chiedere, controproporre.',
    'Ogni elemento inventato va classificato (effimero, fatto_locale, conseguenza, filo, proposta) con la sua causa.',
    'Racconta in seconda persona, dalla percezione del protagonista; niente pensieri o emozioni attribuiti al protagonista.',
    'Se il giocatore descrive più azioni in sequenza, elencale in intentSteps, esegui e racconta solo la prima (passo 1) e fermati.',
    'Un obiettivo si tenta solo quando il protagonista ne conosce la possibilità: altrimenti fai emergere ciò che serve a capirla.'
  ];
  function contesto(state, content, testo, voce) {
    const sc = E().currentScene(state, content) || {};
    const sem = seme(content, state.scena) || {};
    const pg = state.personaggio;
    const m = memoria(state);
    const tratti = [];
    Object.values(pg.traits || {}).forEach(o => Object.keys(o).forEach(k => tratti.push(k)));
    const it = state.interazione && state.interazione.scena === state.scena ? state.interazione : null;
    const N = content.narrativa && content.narrativa.scene ? content.narrativa.scene[state.scena] : null;
    const veritaScena = (state.veritaScoperte || []).filter(v => v.scena === state.scena).map(v => ((N && N.requiredTruths) || []).find(t => t.id === v.id)).filter(Boolean).map(t => t.canonicalContent);
    const ultimi = (state.eventi || []).slice(-3).map(e => ({ azione: e.resoconto ? e.resoconto.azioneDichiarata : e.testo, esito: e.resoconto ? e.resoconto.esito : null, racconto: e.narrazione && e.narrazione.testo ? String(e.narrazione.testo).slice(0, 220) : null }));
    const materiali = (sem.veritaRivelabili ? sem.veritaRivelabili.materialeDiScena : []).filter(id => !(state.veritaScoperte || []).some(v => v.id === id)).slice(0, 8).map(id => {
      const c = content.semi.verita[id];
      return { id, fonte: c.fonte === 'luogo' ? 'luogo' : pngNome(content, c.fonte), tipo: c.statoEpistemico };
    });
    const ctx = {
      regole: REGOLE,
      ontologia: global.RMSoloOntologia ? global.RMSoloOntologia.contesto(content.storia) : '',
      scena: { id: sc.id, luogo: sc.luogo, situazione: sc.descrizione, funzione: sem.funzioneDrammatica || null, minacce: (sem.minacce || []).map(x => x.tipo === 'nemico' ? 'nemico: ' + ((content.nemici[x.nemico] || {}).nome || '') : x.tipo === 'pressione' ? 'pressione: ' + x.nome : 'orologio: ' + (((content.orologi || {})[x.id] || {}).nome || x.id)), scontroInAttesa: !!(it && it.incontroInAttesa) },
      obiettivi: (sc.obiettivi || []).filter(o => !(state.obiettivi[o.id] && state.obiettivi[o.id].completato)).map(o => ({ id: o.id, testo: o.testo })),
      protagonista: { nome: pg.nome, ruolo: pg.mansione, classe: (typeof BUILDS !== 'undefined' && BUILDS[pg.build] || {}).label || pg.build, tratti, condizione: [].concat(pg.hpCur < pg.hpMaxTracked / 2 ? ['ferito'] : [], state.condizione === 'recupero' ? ['in recupero'] : []), oggetti: (state.inventario || []).map(i => (E().itemInfo(state, content, i.id) || {}).nome).filter(Boolean) },
      png: presenti(state, content).map(id => { const s = statoPng(state, content, id); return { id, nome: s.nome, ruolo: s.ruolo, obiettivo: s.obiettivoCorrente, rapporto: s.rapporto, promesse: s.promessa, segretiCustoditi: s.segretiCustoditi, reazioneProbabile: reazioneDi(state, content, id, testo) }; }),
      pngMinori: m.pngMinori.filter(x => x.scena === state.scena || x.persistente).slice(-6).map(x => ({ ruolo: x.ruolo, nome: x.nome, fazione: x.fazione })),
      conoscenze: global.RMSoloStruttura && global.RMSoloStruttura.attivo(content) && state.campagna
        ? global.RMSoloStruttura.conoscenzePertinenti(state, content, 8)
        : (state.fattiScoperti || []).map(f => (content.fatti[f] || {}).testo).filter(Boolean).concat(veritaScena),
      campagna: global.RMSoloStruttura && global.RMSoloStruttura.attivo(content) && state.campagna ? global.RMSoloStruttura.contestoCompatto(state, content) : null,
      materialeDiScena: materiali,
      dettagliConvalidati: m.voci.filter(v => v.statoCanonico === 'dettaglio_locale_validato' && (v.scena === state.scena || v.durata === 'partita')).slice(-8).map(v => ({ tipo: v.tipo, testo: v.testo, epistemico: v.statoEpistemico })),
      fili: m.fili.filter(f => f.stato === 'aperto').slice(-8).map(f => ({ id: f.id, titolo: f.titolo })),
      conseguenzeAttive: m.voci.filter(v => v.tipo === 'conseguenza' && v.durata !== 'istante').slice(-5).map(v => v.testo),
      intenzioneInSospeso: (intenzioneAperta(state) || {}).testo || null,
      possibiliOra: (() => { const ps = possibilita(state, content); return (sc.obiettivi || []).filter(o => ps.obiettivi[o.id] && ps.obiettivi[o.id].ok).map(o => o.id); })(),
      ultimiScambi: ultimi,
      voce: voce && global.RMSoloVoice ? global.RMSoloVoice.promptBlock(voce, state, content, { tipo: 'improvvisazione', effetti: [] }) : null,
      // pacchetto della campagna attiva (solo questa): atto, arco, voci dei PNG, divieti
      pacchetto: global.RMSoloContesto ? global.RMSoloContesto.perTurno(state, content, { presenti: presenti(state, content) }) : null,
      azione: String(testo || '').slice(0, 600)
    };
    return ctx;
  }
  function contestoTesto(c) {
    const L = [];
    L.push('REGOLE:\n- ' + c.regole.join('\n- '));
    const CX = global.RMSoloContesto;
    const pk = k => (c.pacchetto && CX ? CX.testoTurno(c.pacchetto, [k]) : '');
    if (pk('campagna')) L.push(pk('campagna'));
    if (c.ontologia) L.push(c.ontologia);
    if (pk('atto')) L.push(pk('atto'));
    if (c.campagna && c.campagna.testo) L.push(c.campagna.testo);
    if (pk('arco')) L.push(pk('arco'));
    L.push('SCENA: ' + c.scena.luogo + '. ' + c.scena.situazione + (c.scena.funzione ? '\nFUNZIONE: ' + c.scena.funzione : '') + (c.scena.minacce.length ? '\nMINACCE: ' + c.scena.minacce.join('; ') : '') + (c.scena.scontroInAttesa ? '\nUno scontro incombe: si può chiedere con mechanicalResolutionRequests tipo "scontro".' : ''));
    if (c.obiettivi.length) L.push('OBIETTIVI DELLA SCENA (id: testo; tentabili ora solo: ' + (c.possibiliOra.join(', ') || 'nessuno') + '):\n' + c.obiettivi.map(o => '- ' + o.id + ': ' + o.testo).join('\n'));
    if (c.intenzioneInSospeso) L.push('INTENZIONE IN SOSPESO DEL GIOCATORE (passaggi non ancora eseguiti): ' + c.intenzioneInSospeso);
    L.push('PROTAGONISTA: ' + c.protagonista.nome + ', ' + c.protagonista.ruolo + (c.protagonista.classe ? ' (' + c.protagonista.classe + ')' : '') + '. Tratti: ' + c.protagonista.tratti.join(', ') + '. Oggetti: ' + (c.protagonista.oggetti.join(', ') || 'nessuno') + (c.protagonista.condizione.length ? '. Condizione: ' + c.protagonista.condizione.join(', ') : '') + '.');
    L.push('PNG PRESENTI:\n' + (c.png.map(p => '- ' + p.nome + ' (' + p.ruolo + '): vuole ' + p.obiettivo + '; rapporto ' + p.rapporto + '; reazione probabile ' + p.reazioneProbabile + (p.promesse.length ? '; promesse: ' + p.promesse.join('; ') : '') + (p.segretiCustoditi ? '; custodisce cose che il protagonista non sa' : '')).join('\n') || '- nessuno'));
    if (pk('png')) L.push(pk('png'));
    if (c.pngMinori.length) L.push('PERSONE DI PASSAGGIO GIÀ INCONTRATE: ' + c.pngMinori.map(x => x.ruolo + (x.nome ? ' ' + x.nome : '')).join('; '));
    L.push('IL PROTAGONISTA SA:\n' + (c.conoscenze.map(t => '- ' + t).join('\n') || '- niente di particolare'));
    if (c.materialeDiScena.length) L.push('MATERIALE DI SCENA RIVELABILE (id → fonte): ' + c.materialeDiScena.map(x => x.id + ' → ' + x.fonte).join('; '));
    if (c.dettagliConvalidati.length) L.push('GIÀ STABILITO IN PARTITA: ' + c.dettagliConvalidati.map(x => x.testo).join('; '));
    if (c.fili.length) L.push('FILI APERTI: ' + c.fili.map(f => f.id + ' ' + f.titolo).join('; '));
    if (c.conseguenzeAttive.length) L.push('CONSEGUENZE IN MOVIMENTO: ' + c.conseguenzeAttive.join('; '));
    if (c.ultimiScambi.length) L.push('ULTIMI SCAMBI:\n' + c.ultimiScambi.map(u => '- ' + (u.azione || '—') + (u.racconto ? ' → ' + u.racconto : '')).join('\n'));
    if (pk('limiti')) L.push(pk('limiti'));
    if (c.voce) L.push(c.voce);
    L.push('AZIONE DEL GIOCATORE: «' + c.azione + '»');
    L.push('Rispondi SOLO con il JSON dello schema.');
    return L.join('\n');
  }
  function promptRegia(state, content, testo, voce) {
    const c = contesto(state, content, testo, voce);
    return { system: 'Sei il REGISTA di una partita di ruolo single player. Scrivi solo in italiano.', user: contestoTesto(c), schema: REGIA_SCHEMA, contesto: c };
  }
  function intenzioneAperta(state) {
    const m = memoria(state);
    return m.voci.filter(v => v.tipo === 'intenzione' && v.scena === state.scena && v.stato === 'in_sospeso').slice(-1)[0] || null;
  }
  // la proposta chiede una risoluzione meccanica? (percorso a due chiamate)
  function meccanica(v) { return !!(v && v.accettata && v.accettata.mechanicalResolutionRequests.length); }

  global.RMSoloImprov = {
    REGIA_SCHEMA, STATI_CANONICI, STATI_EPISTEMICI, CLASSI, REAZIONI, MECCANICHE,
    modoSemi, seme, memoria, potaEffimeri, disposizione, statoPng, reazioneDi,
    parseRegia, valida, proponi, registra, contesto, contestoTesto, promptRegia, meccanica, problemiTesto,
    possibilita, conoscenzeScena, pertinente, passiComposti, intenzioneAperta
  };
})(typeof window !== 'undefined' ? window : globalThis);
