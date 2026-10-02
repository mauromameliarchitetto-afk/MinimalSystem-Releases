/* ==========================================================================
   Role Makers — Gioca in solitaria: voce del narratore (pacchetto V5,
   "Voci del narratore — analisi delle giocate").

   Livello INDIPENDENTE da regole, stato della campagna, memoria, contenuti
   e moderazione: la voce sceglie forma e tono della narrazione, non concede
   capacità al modello e non modifica lo stato. Formato 'rm-solo-voce/1'
   (js/solo/content/<storia>-voce.json): un oggetto `narrative_voice` (il
   contratto dati della scheda §7) più una `guida` in italiano con tono,
   distanza, immagini, dialoghi, funzione di ogni atto, regole operative e
   cose da evitare.

   Dal riallineamento sulle fonti originali (FONTI_E_RIALLINEAMENTO.md) la
   voce ha due livelli: la VOCE AUTORIALE condivisa (voce-autore.json,
   'rm-solo-voce-autore/1': come raccontare, uguale per le tre campagne,
   ogni regola attestata negli originali di almeno due campagne) e il
   TIMBRO della campagna (<storia>-voce.json). `componi` unisce i due
   livelli; il prompt riceve solo le regole autoriali pertinenti al tipo
   di evento (`quando`), per restare nel budget del telefono.

   Qui:
   - validateAuthorVoice / componi: voce condivisa e unione col timbro;
   - validateVoice: il contratto è completo e coerente con la campagna;
   - promptBlock: le istruzioni di voce per l'atto corrente (per Ich il
     lessico tecnico entra solo dopo la rivelazione);
   - wordTarget / maxTokens: lunghezza per tipo di evento (ordinario,
     passaggio decisivo, combattimento);
   - checkNarration: controlli sul testo generato. BLOCCANTI (la narrazione
     viene sostituita dal testo di riserva): pensieri o decisioni attribuiti
     al protagonista, un PNG che dice un fatto che non conosce. AVVISI
     (registrati, il testo resta): lunghezza, chiusura che non lascia la
     mossa al giocatore, lezione esplicita, eroi storici, tecnologia senza
     costo (Icaro). Il lessico riservato e i segreti non scoperti restano
     controllati dal motore (validateNarration).
   ========================================================================== */
(function (global) {
  'use strict';

  const FORMATO = 'rm-solo-voce/1';
  const POV = { second_perceptive: 'Racconta in seconda persona ("tu"), solo attraverso ciò che il protagonista percepisce.',
    third_limited: 'Racconta in terza persona limitata sul protagonista: solo ciò che percepisce.' };
  const FORBIDDEN_BASE = ['omniscient_spoiler', 'npc_unknown_fact', 'protagonist_thoughts', 'theme_lecture', 'historical_hero_solution'];

  /* ------------------------------------------- voce autoriale condivisa */
  const FORMATO_AUTORE = 'rm-solo-voce-autore/1';
  const CAMPI_AUTORE = ['focalizzazione', 'distanza', 'ritmo', 'immagini', 'corpo_ambiente_azione_conseguenza', 'dialoghi_sottotesto', 'silenzio', 'presagi', 'rivelazioni', 'combattimento', 'passaggi_di_scena', 'aftermath', 'chiusure'];
  const MOMENTI = ['sempre', 'ordinario', 'decisivo', 'combattimento', 'rivelazione', 'aftermath', 'transizione', 'improvvisazione', 'finale'];
  const CAMPAGNA_DA_ID = { EID: 'eidos', ICH: 'ich', ICA: 'icaro' };
  function campagnaFonte(id) { return CAMPAGNA_DA_ID[String(id || '').split('-')[0]] || null; }
  const normLex = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ǫ/g, 'o').toLowerCase();

  /* `lessico` (facoltativo): fonti-narrative.json → lessico. Nessun termine
     esclusivo o condiviso di una campagna può comparire nelle istruzioni. */
  function validateAuthorVoice(a, lessico) {
    const E = [];
    if (!a || a.formato !== FORMATO_AUTORE) return ['formato: atteso ' + FORMATO_AUTORE];
    const regole = a.regole || [];
    const ids = new Set();
    regole.forEach(r => {
      if (!r.id || ids.has(r.id)) E.push('regola senza id o duplicata: ' + r.id); ids.add(r.id);
      if (CAMPI_AUTORE.indexOf(r.campo) === -1) E.push(r.id + ': campo non previsto ' + r.campo);
      if (!r.istruzione || !r.breve) E.push(r.id + ': istruzione o forma breve mancante');
      if (r.breve && r.breve.split(/\s+/).length > 24) E.push(r.id + ': forma breve oltre 24 parole');
      if (!(r.quando || []).length || r.quando.some(q => MOMENTI.indexOf(q) === -1)) E.push(r.id + ': quando non valido');
      const camp = new Set((r.fonte || []).map(f => campagnaFonte(f.id)).filter(Boolean));
      if (camp.size < 2) E.push(r.id + ': non trasversale (fonti di ' + camp.size + ' campagna)');
      if ((r.fonte || []).some(f => !f.cita)) E.push(r.id + ': fonte senza passo citato');
      if (['canonico_pubblico', 'deducibile'].indexOf(r.classe) === -1) E.push(r.id + ': classe ' + r.classe);
    });
    CAMPI_AUTORE.forEach(c => { if (!regole.some(r => r.campo === c)) E.push('campo senza regole: ' + c); });
    const t = a.lunghezza && a.lunghezza.target_words;
    if (!(t && t.ordinary_min > 0 && t.ordinary_min < t.ordinary_max && t.ordinary_max <= t.climax_max && t.combat_min > 0 && t.combat_min < t.combat_max)) E.push('lunghezza incoerente');
    if (!a.sistema || !(a.sistema.regole || []).length) E.push('regole di sistema mancanti');
    if (lessico) {
      const testo = normLex(regole.map(r => r.istruzione + ' ' + r.breve).concat(a.forma ? a.forma.passi : [], a.sistema ? a.sistema.regole : [], a.evitare ? a.evitare.voci : []).join(' '));
      const termini = [].concat(...Object.values(lessico.esclusivi || {}), lessico.condivisi || []);
      termini.forEach(x => { if (new RegExp('\\b' + normLex(x.radice)).test(testo)) E.push('termine di campagna nella voce condivisa: ' + x.termine); });
    }
    return E;
  }

  /* Unisce voce autoriale e timbro della campagna in una vista sola
     (gli originali restano intatti). Il limite di lunghezza è della voce
     condivisa; un timbro può ancora dichiararne uno proprio. */
  function componi(autore, voce, contesto) {
    if (!voce) return null;
    const v = JSON.parse(JSON.stringify(voce));
    v.narrative_voice = v.narrative_voice || {};
    v.guida = v.guida || {};
    // timbro e funzione degli atti dal pacchetto di contesto (dati con fonte):
    // nel prompt entrano solo regole canoniche o deducibili, mai proposte
    if (contesto && contesto.timbro && contesto.storia === v.storia) {
      const t = contesto.timbro, g = v.guida;
      if (t.nome) g.nome = t.nome;
      ['tono', 'distanza', 'immagini', 'dialoghi'].forEach(k => { if (t[k] && t[k].v) g[k] = t[k].v; });
      if (t.regole) g.regole = t.regole.filter(d => d.v && d.classe !== 'proposta' && d.classe !== 'incompleto').map(d => d.v);
      if (t.evitare) g.evitare = t.evitare.filter(d => d.v).map(d => d.v);
      if (contesto.atti) { g.atti = g.atti || {}; ['1', '2', '3'].forEach(n => { const a = contesto.atti[n]; if (a && a.funzione && a.funzione.v) g.atti[n] = a.funzione.v; }); }
      v.timbro_da = contesto.storia + '-contesto.json';
    }
    if (!autore) return v;
    v.autore = autore;
    if (!v.narrative_voice.target_words && autore.lunghezza) v.narrative_voice.target_words = Object.assign({}, autore.lunghezza.target_words);
    return v;
  }

  /* Momenti narrativi di un evento: scelgono le regole autoriali da
     mettere nel prompt. */
  function momenti(ev) {
    const out = ['sempre', eventKind(ev)];
    if (!ev) return out;
    const eff = (ev.effetti || []).map(e => e.tipo);
    const fase = ev.regia && ev.regia.fase;
    if (ev.aftermath || fase === 'aftermath') out.push('aftermath');
    if (fase === 'transition' || eff.indexOf('scena') !== -1 || eff.indexOf('sposta') !== -1) out.push('transizione');
    if (eff.some(t => t === 'scoperta' || t === 'verita' || t === 'rivelazione')) out.push('rivelazione');
    if (ev.tipo === 'improvvisazione') out.push('improvvisazione');
    if (eff.indexOf('finale') !== -1) out.push('finale');
    return out;
  }
  function regoleAutore(autore, ev) {
    if (!autore) return [];
    const m = momenti(ev);
    return (autore.regole || []).filter(r => r.quando.some(q => m.indexOf(q) !== -1));
  }

  function validateVoice(v, content) {
    const E = [];
    if (!v || v.formato !== FORMATO) return ['formato: atteso ' + FORMATO];
    const nv = v.narrative_voice || {};
    ['id', 'pov', 'tone', 'lexicon', 'scene_pattern', 'dialogue_mode', 'act_modifiers', 'forbidden'].forEach(k => { if (nv[k] == null) E.push('narrative_voice.' + k + ' mancante'); });
    if (nv.target_words == null) E.push('narrative_voice.target_words mancante (voce autoriale non composta)');
    if (nv.pov && !POV[nv.pov]) E.push('pov non valido: ' + nv.pov);
    ['1', '2', '3'].forEach(n => {
      if (!nv.act_modifiers || !nv.act_modifiers[n]) E.push('act_modifiers: atto ' + n + ' mancante');
      if (!v.guida || !v.guida.atti || !v.guida.atti[n]) E.push('guida: atto ' + n + ' mancante');
    });
    const t = nv.target_words || {};
    if (!(t.ordinary_min > 0 && t.ordinary_min < t.ordinary_max && t.ordinary_max <= t.climax_max)) E.push('target_words incoerenti');
    if (!(t.combat_min > 0 && t.combat_min < t.combat_max)) E.push('target_words: combattimento incoerente');
    FORBIDDEN_BASE.forEach(f => { if ((nv.forbidden || []).indexOf(f) === -1) E.push('forbidden: manca ' + f); });
    ['tono', 'distanza', 'immagini', 'dialoghi'].forEach(k => { if (!v.guida || !v.guida[k]) E.push('guida.' + k + ' mancante'); });
    if (!v.guida || !(v.guida.regole || []).length) E.push('guida.regole mancanti');
    if (content) {
      if (v.campaign_id !== content.id) E.push('voce di un\'altra campagna (' + v.campaign_id + ')');
      if (v.storia !== content.storia) E.push('voce di un\'altra storia');
      const lt = nv.lexicon_tecnico;
      if (lt && !(content.fatti[lt.dal_fatto] && content.fatti[lt.dal_fatto].segreto)) E.push('lexicon_tecnico: sblocco su fatto non segreto ' + lt.dal_fatto);
      // il lessico della voce è pubblico: niente parole riservate
      if (global.RMSoloCampaign) {
        const rules = global.RMSoloCampaign.lockedLexicon(null, content);
        const pub = [].concat(nv.lexicon || [], v.guida.tono, v.guida.distanza, v.guida.immagini, v.guida.dialoghi, Object.values(v.guida.atti || {}), v.guida.regole || [], v.guida.evitare || []).join(' ');
        global.RMSoloCampaign.lexiconHits(pub, rules).forEach(h => E.push('guida con lessico riservato (' + h + ')'));
      }
    }
    return E;
  }

  function technicalUnlocked(v, state) {
    const lt = v.narrative_voice.lexicon_tecnico;
    return !!(lt && state && state.fattiScoperti.indexOf(lt.dal_fatto) !== -1);
  }

  /* Tipo di evento per la lunghezza: combattimento, passaggio decisivo
     (finale, cambio d'atto, snodo, scelta) o ordinario. */
  function eventKind(ev) {
    if (!ev) return 'ordinario';
    if (ev.tipo === 'combattimento') return 'combattimento';
    const eff = ev.effetti || [];
    if (ev.tipo === 'scelta' || eff.some(a => a.tipo === 'finale' || a.tipo === 'atto' || a.tipo === 'snodo')) return 'decisivo';
    return 'ordinario';
  }
  function wordTarget(v, ev) {
    const t = v.narrative_voice.target_words;
    const k = eventKind(ev);
    if (k === 'combattimento') return { tipo: k, min: t.combat_min, max: t.combat_max };
    if (k === 'decisivo') return { tipo: k, min: t.ordinary_max, max: t.climax_max };
    return { tipo: k, min: t.ordinary_min, max: t.ordinary_max };
  }
  // circa 1,6 token per parola italiana, più il contorno JSON e le battute
  function maxTokens(v, ev) { return Math.ceil(wordTarget(v, ev).max * 1.6) + 60; }

  /* Istruzioni di voce per il prompt del narratore. */
  function promptBlock(v, state, content, ev) {
    const nv = v.narrative_voice, g = v.guida;
    const atto = String((state && state.atto) || 1);
    const w = wordTarget(v, ev);
    const L = [];
    if (v.autore) {
      // 2. voce autoriale condivisa: solo le regole pertinenti a questo evento
      L.push('VOCE AUTORIALE (comune alle tre campagne):');
      regoleAutore(v.autore, ev).forEach(r => L.push('- ' + r.breve));
      if (v.autore.forma) L.push('Ogni risposta: ' + v.autore.forma.passi.join('; ') + '.');
      (v.autore.sistema ? v.autore.sistema.regole : []).forEach(d => L.push(d));
    }
    L.push(
      'TIMBRO DELLA CAMPAGNA — ' + (g.nome || nv.id) + '.',
      POV[nv.pov] || POV.second_perceptive,
      'Tono: ' + g.tono + ' ' + g.distanza,
      'Immagini: ' + g.immagini,
      'Dialoghi: ' + g.dialoghi,
      'In questo atto: ' + g.atti[atto],
      'Lessico caratteristico (usane una o due parole, con naturalezza): ' + nv.lexicon.join(', ') + '.'
    );
    if (nv.lexicon_tecnico && technicalUnlocked(v, state)) L.push('Ora il protagonista può capire anche parole come: ' + nv.lexicon_tecnico.parole.join(', ') + '. Continua comunque a usare nomi e simboli del mondo.');
    L.push('Regole: ' + (g.regole || []).join(' '));
    if (nv.conflitto_di_valori) L.push('Se in scena ci sono più PNG, fai emergere almeno due motivazioni comprensibili fra le loro.');
    L.push('Evita: ' + (g.evitare || []).join('; ') + '.');
    if (!v.autore) {
      const C = g.comuni || {};
      if (C.forma) L.push('Ogni risposta: ' + C.forma.join('; ') + '.');
      (C.divieti || []).forEach(d => L.push(d));
      (C.funzione || []).slice(-1).forEach(d => L.push(d));
    }
    L.push('Lunghezza: ' + w.min + '–' + w.max + ' parole.');
    return L.join('\n');
  }

  /* ------------------------------------------------------ controlli */

  function words(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }
  const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // pensieri, sentimenti o decisioni attribuiti al protagonista
  function thoughtPatterns(pgName) {
    const second = /\b(decidi|scegli|hai deciso|avevi deciso) di\b|\bti convinci\b|\bpensi che\b|\bsei convint[oa]\b|\bprovi (rabbia|paura|pietà|vergogna|sollievo|odio|amore|tristezza|disgusto)\b|\bti senti (in colpa|sollevat[oa]|tradit[oa]|felice|triste|sol[oa])\b|\bin cuor tuo\b|\bdentro di te sai\b/i;
    const first = String(pgName || '').split(/\s+/)[0];
    const third = first && first.length > 2 ? new RegExp('\\b' + esc(first) + '\\b[^.!?]{0,60}\\b(decide|sceglie|pensa che|si convince|prova (rabbia|paura|vergogna|sollievo)|si sente)\\b', 'i') : null;
    return [second, third].filter(Boolean);
  }
  const LECTURE = /\b(la lezione|il vero valore|questo dimostra che|in fondo,? la vita|la morale|capirai che la vita)\b/i;
  const CLOSED_END = /\b(fine\.?$|è finita|tutto è risolto|la storia si conclude|non resta (più )?nulla da fare|vissero)\b/i;

  function lastSentence(t) {
    const s = String(t || '').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
    return s[s.length - 1] || '';
  }

  /* Controlli del testo. `battute` sono già attribuite ai PNG presenti
     ({ pngId, testo }). Restituisce { problemi (bloccanti), avvisi }. */
  function checkNarration(v, state, content, ev, text, battute) {
    const nv = v.narrative_voice, problemi = [], avvisi = [];
    const t = String(text || '');
    thoughtPatterns(state && state.personaggio && state.personaggio.nome).forEach(re => { if (re.test(t)) problemi.push('pensiero_protagonista'); });
    // un PNG non dice ciò che non sa (fatti con parole distintive)
    (battute || []).forEach(b => {
      const known = (state.png[b.pngId] && state.png[b.pngId].sa) || [];
      Object.entries(content.fatti || {}).forEach(([fid, f]) => {
        if (!f.parole || known.indexOf(fid) !== -1) return;
        if (f.parole.some(w => new RegExp(w, 'i').test(b.testo))) problemi.push('png_non_sa:' + b.pngId + ':' + fid);
      });
    });
    const w = wordTarget(v, ev), n = words(t);
    if (n < Math.floor(w.min * 0.6) || n > Math.ceil(w.max * 1.25)) avvisi.push('lunghezza:' + n + '/' + w.min + '-' + w.max);
    if (CLOSED_END.test(lastSentence(t))) avvisi.push('chiusura_senza_apertura');
    if (LECTURE.test(t)) avvisi.push('lezione_esplicita');
    (nv.eroi_storici || []).forEach(h => { if (new RegExp('\\b' + esc(h) + '\\b').test(t + ' ' + (battute || []).map(b => b.testo).join(' '))) avvisi.push('eroe_storico:' + h); });
    const tc = nv.tecnologia_con_costo;
    if (tc) {
      const low = t.toLowerCase();
      const tech = tc.tecnologia.filter(x => low.indexOf(x) !== -1);
      if (tech.length && !tc.costo.some(x => low.indexOf(x) !== -1)) avvisi.push('tecnologia_senza_costo:' + tech[0]);
    }
    return { problemi: Array.from(new Set(problemi)), avvisi };
  }

  global.RMSoloVoice = { FORMATO, FORMATO_AUTORE, CAMPI_AUTORE, validateAuthorVoice, componi, momenti, regoleAutore, campagnaFonte, validateVoice, promptBlock, wordTarget, maxTokens, eventKind, checkNarration, technicalUnlocked, words };
})(typeof window !== 'undefined' ? window : globalThis);
