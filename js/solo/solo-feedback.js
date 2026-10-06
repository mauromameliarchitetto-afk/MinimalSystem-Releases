/* ==========================================================================
   Role Makers — Gioca in solitaria: resoconto di ogni azione risolta.

   Il motore decide, il narratore racconta. Per ogni comando applicato il
   motore produce un resoconto completo (rm-solo-resoconto/1):

     { azioneDichiarata, esito, narrazione, effettiTecnici,
       cambiamentiDiStato, transizione, azioniSuccessive }

   - effettiTecnici: righe numeriche già applicate ("Tèras: −8 HP",
     "MP consumati: 6", "Nessun danno"), mostrate in un blocco separato;
   - cambiamentiDiStato: stati applicati o rimossi (bersaglio, nome,
     durata, effetto meccanico, fonte), gemme, relazioni, scoperte…;
   - transizione: ogni cambio di scena ha partenza, arrivo, modalità,
     durata narrativa, condizioni all'arrivo e un breve testo di raccordo;
   - riserva: testo locale usato se il modello non è pronto o sbaglia,
     scelto a rotazione per categoria, mai uguale due volte di seguito.

   Il narratore riceve SOLO questi dati (payload) e la sua risposta passa
   da check(): numeri, morti, stati, luoghi e oggetti non restituiti dal
   motore la fanno scartare a favore della riserva.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------ testi di riserva

     Frasi brevi, concrete, senza numeri (i valori stanno nel riepilogo
     tecnico). Segnaposto: {pg} {nemico} {capacita} {obiettivo} {stato}
     {gemma} {oggetto} {partenza} {arrivo} {luogo}. */
  const RISERVA = {
    successo: [
      'Ti muovi con decisione e {obiettivo} va come volevi.',
      'Il gesto è pulito: {obiettivo}, e nessuno riesce a fermarti.',
      'Trovi il punto giusto al primo tentativo: {obiettivo}.'
    ],
    critico: [
      'Tutto si incastra alla perfezione: {obiettivo}, meglio di quanto sperassi.',
      'Per un istante il mondo sembra muoversi al tuo ritmo: {obiettivo}, senza sbavature.'
    ],
    parziale: [
      'Ci riesci, ma non del tutto: {obiettivo}, e qualcosa ti sfugge dalle mani.',
      'Ottieni quello che cercavi a metà: {obiettivo}, pagando un prezzo.',
      'Il risultato arriva, incompleto: {obiettivo}, con un margine che non ti piace.'
    ],
    fallimento: [
      'Il tentativo si inceppa: {obiettivo} resta fuori dalla tua portata, per ora.',
      'Qualcosa va storto nel momento sbagliato, e {obiettivo} non riesce.',
      'Sbagli i tempi: {obiettivo} ti scivola via.'
    ],
    colpo_riuscito: [
      '{Con} colpisci {nemico} nel punto scoperto.',
      '{Con} trovi il varco e raggiungi {nemico}.',
      'Il colpo parte netto: {con} ferisci {nemico}.'
    ],
    colpo_mancato: [
      '{Nemico} evita {colpo} all\'ultimo istante.',
      '{Nemico} para {colpo} senza fatica.',
      '{Con} arrivi un istante in ritardo: {nemico} non è più lì.'
    ],
    danno_subito: [
      '{Nemico} risponde con {attacco} e ti ferisce.',
      'Non fai in tempo a scansarti: {nemico} ti raggiunge con {attacco}.',
      '{Nemico} ti prende in pieno con {attacco}.'
    ],
    nessun_danno_subito: [
      '{Nemico} risponde con {attacco}, ma non ti raggiunge.',
      'Ti sposti appena in tempo: {nemico} colpisce il vuoto.',
      '{Nemico} tenta {attacco} e trova solo il vuoto.'
    ],
    cura: [
      'Il respiro torna regolare e le ferite pesano meno.',
      'Ti concedi un momento: il corpo recupera un po\' di forze.',
      'Il dolore si attenua; riesci di nuovo a muoverti con sicurezza.'
    ],
    stato_applicato: [
      'Attivi {stato} e cambi assetto.',
      'Con {stato} ti prepari al colpo successivo.',
      'Richiami {stato}: il corpo reagisce in modo diverso.'
    ],
    stato_rimosso: [
      'L\'effetto di {stato} svanisce.',
      '{Stato} si esaurisce e torni al tuo assetto normale.',
      'Senti {stato} scivolare via.'
    ],
    consumo_mp: [
      'Lo sforzo ti svuota un poco: l\'energia richiesta è stata pagata.',
      'Senti l\'energia defluire mentre la capacità prende forma.'
    ],
    equip_danneggiato: [
      '{oggetto} scricchiola sotto il colpo e perde parte della sua solidità.',
      'Una crepa corre lungo {oggetto}: non reggerà a lungo così.'
    ],
    ingresso_combattimento: [
      'Non c\'è più spazio per parlare: lo scontro comincia.',
      'Il pericolo ti è addosso, e devi difenderti.',
      'Lo scontro comincia prima che tu possa decidere altro.'
    ],
    fine_vittoria: [
      '{Nemico} crolla e smette di muoversi.',
      '{Nemico} cede all\'ultimo colpo: lo scontro è finito.'
    ],
    fine_fuga: [
      'Ti sganci e metti distanza tra te e {nemico}.',
      'Approfitti di un varco: {nemico} resta indietro.'
    ],
    fine_nemico_fuggito: [
      '{Nemico} arretra, poi si volta e sparisce: lo scontro finisce senza un vincitore.',
      '{Nemico} rompe il contatto e fugge. Potrebbe tornare.'
    ],
    fine_resa: [
      '{Nemico} abbassa l\'arma: si arrende.',
      '{Nemico} smette di combattere e alza le mani.'
    ],
    fine_sconfitta: [
      '{Nemico} ti atterra: le gambe cedono.',
      '{Nemico} ha la meglio, e il mondo si stringe a un punto buio.'
    ],
    spostamento: [
      'Ti muovi con cautela, un passo dopo l\'altro.',
      'Il tragitto scorre in silenzio, scandito solo dal tuo respiro.',
      'Procedi senza fermarti, attento a ciò che ti circonda.'
    ],
    nuovo_luogo: [
      'Qui l\'aria è diversa, e anche i suoni.',
      'Il luogo ti accoglie con una luce che non avevi ancora visto.',
      'Ogni cosa, qui, ha un odore e un peso nuovi.'
    ],
    passaggio_fase: [
      'Qualcosa nella scena si sposta: adesso sai dove guardare.',
      'Le tessere cominciano a combaciare; la scena entra nel vivo.',
      'Il momento di osservare sta finendo: presto dovrai scegliere.'
    ],
    raccolta: [
      'Prendi {oggetto} e lo sistemi con cura tra le tue cose.',
      'Raccogli {oggetto}: pesa poco, ma potrebbe servire.',
      'Ti chini e prendi {oggetto}, senza perdere d\'occhio ciò che ti circonda.'
    ],
    uso: [
      'Usi {oggetto} senza esitare.',
      'Ricorri a {oggetto}: fa quello che deve.'
    ],
    passaggio_scena: [
      'Ti lasci alle spalle ciò che è appena accaduto.',
      'La scena si chiude; ciò che hai fatto viene con te.'
    ],
    // aftermath: decompressione dopo un picco (climax, sconfitta grave,
    // morte, rivelazione). Testi strutturali senza fatti nuovi: i dettagli
    // arrivano dal bundle (perdite, relazioni, condizione, tensioni)
    aftermath: [
      'Il rumore di prima si è spento; resta il tempo di contare ciò che è cambiato.',
      'Nessuno parla subito. Ciò che è accaduto pesa ancora nell\'aria.',
      'Il momento peggiore è passato, ma non se n\'è andato del tutto.'
    ],
    // stallo strutturato: una direzione, mai la soluzione
    stallo_png: [
      '{Png} ti osserva come se aspettasse una domanda precisa.',
      'Forse {png} sa più di quanto abbia detto finora.'
    ],
    stallo_luogo: [
      'Un dettaglio non ti torna: forse vale la pena di {luogo}.',
      'C\'è ancora qualcosa da capire qui. Potresti {luogo}.'
    ]
  };
  /* Organizzazione dei testi di riserva: per ogni categoria si cerca prima
     la variante per ambientazione e fase (cat@storia@fase), poi per
     ambientazione (cat@storia), poi per fascia d'intensità
     (cat@alta / cat@bassa), infine la categoria generica. Le varianti
     sono proposte narrative da approvare (docs/single-player/
     ARCHITETTURA_NARRATIVA.md): l'elenco parte vuoto, la struttura è
     pronta. Ogni testo usato lascia una firma nello stato narrativo, così
     la stessa frase non ritorna finché la rotazione non l'ha esaurita. */
  const RISERVA_VARIANTI = {};
  function variantKey(state, cat) {
    const n = state && state.narrativa, storia = state && state.storia;
    const fase = n && n.currentDramaticPhase, lv = n && n.intensityState ? n.intensityState.currentLevel : 1;
    const keys = [cat + '@' + storia + '@' + fase, cat + '@' + storia, cat + '@' + (lv >= 4 ? 'alta' : 'bassa')];
    return keys.find(k => RISERVA_VARIANTI[k] && RISERVA_VARIANTI[k].length) || null;
  }
  /* Testi di riserva propri di una campagna (frasi di viaggio, gemme di
     Eidos, scene all'esterno di Icaro): stanno nel pacchetto di contesto
     della campagna attiva (<storia>-contesto.json → riserva), mai qui.
     Senza pacchetto si usa la categoria neutra. */
  function riservaDi(content, cat) {
    const r = content && content.contesto && content.contesto.riserva && content.contesto.riserva[cat];
    return r && Array.isArray(r.v) && r.v.length ? r.v : null;
  }
  // neutri: usati solo se il pacchetto non ha la categoria
  const NEUTRI = {
    gemma_scaricata: ['{Capacita} si esaurisce: l\'energia torna a te, ma la capacità non risponde più fino al reintegro.'],
    gemma_reintegrata: ['{Capacita} è di nuovo disponibile.']
  };

  function fill(t, v) {
    return String(t).replace(/\{(\w+)\}/g, (m, k) => {
      const low = k.charAt(0).toLowerCase() + k.slice(1), cap = k !== low;
      const x = v && v[low] != null && v[low] !== '' ? String(v[low]) : (low === 'obiettivo' ? 'l\'azione' : '');
      return cap ? x.charAt(0).toUpperCase() + x.slice(1) : x;
    });
  }
  function sentenceCase(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* Rotazione per categoria: l'indice avanza a ogni uso, così lo stesso
     testo non compare due volte di seguito (lo stato ricorda l'ultimo). */
  function pick(state, cat, vars, pool) {
    const vk = pool ? null : variantKey(state, cat);
    const list = pool || (vk ? RISERVA_VARIANTI[vk] : RISERVA[cat]);
    if (!list || !list.length) return '';
    const key = vk || cat;
    state.riservaUso = state.riservaUso || {};
    const u = state.riservaUso[key] || { n: 0, ultimo: null };
    const n = state.narrativa;
    const firme = n && n.recentNarrativeSignatures ? n.recentNarrativeSignatures : [];
    let i = u.n % list.length;
    // salta i testi con una firma recente (se la rotazione lo consente)
    for (let k = 0; k < list.length - 1 && firme.indexOf(key + '#' + i) !== -1; k++) i = (i + 1) % list.length;
    let t = sentenceCase(fill(list[i], vars));
    if (t === u.ultimo && list.length > 1) { i = (i + 1) % list.length; t = sentenceCase(fill(list[i], vars)); }
    state.riservaUso[key] = { n: i + 1, ultimo: t };
    if (n && n.recentNarrativeSignatures) { firme.push(key + '#' + i); n.recentNarrativeSignatures = firme.slice(-12); }
    return t;
  }

  /* ------------------------------------------ stati e riepilogo tecnico */

  const STAT = { hp: 'HP', mp: 'MP', for: 'Forza', mira: 'Mira', vel: 'Velocità', fmen: 'Forza Magica', dex: 'Destrezza', dif: 'Difesa', dmen: 'Difesa Magica' };
  // effetto meccanico nel combattimento della modalità solitaria
  function bonusText(bonus) {
    const EFF = { dif: 'salvezza contro ogni colpo', dmen: 'salvezza contro attacchi magici o tecnologici', for: 'danno degli attacchi fisici', mira: 'danno degli attacchi a distanza',
      fmen: 'danno delle abilità', dex: 'precisione degli attacchi fisici (metà del valore)', vel: 'chi colpisce per primo e fuga' };
    return Object.entries(bonus || {}).map(([k, v]) => (v >= 0 ? '+' : '−') + Math.abs(v) + ' ' + (STAT[k] || k) + (EFF[k] ? ' (' + EFF[k] + ')' : '')).join(', ') || '—';
  }
  function turni(n) { return n === 1 ? '1 turno' : n + ' turni'; }
  function supportKey(s) { return s.nome + '@' + s.round; }

  /* Resoconto di un comando: before = stato prima, state = stato dopo. */
  function build(before, state, content, ev, cmd, E) {
    const pg = state.personaggio, pgNome = pg.nome;
    const inc = state.incontro || before.incontro;
    const nemico = inc && inc.nemico ? inc.nemico.nome : '';
    const tec = [], cam = [];
    const T = (tipo, testo, extra) => tec.push(Object.assign({ tipo, testo }, extra || {}));
    const C = (tipo, testo, extra) => cam.push(Object.assign({ tipo, testo }, extra || {}));
    const capByName = n => [].concat(pg.tecniche || [], pg.abilita || []).find(a => a.nome === n);

    // combattimento: colpi e danni
    const azioni = (ev.combattimento && ev.combattimento.azioni) || [];
    azioni.forEach(a => {
      if (a.tipo === 'attacco') {
        const target = a.chi === 'pg' ? nemico : pgNome;
        // HP realmente persi (mai oltre quelli rimasti)
        const perso = a.perso != null ? a.perso : a.esito.finalDamage;
        if (perso > 0) T('danno', target + ': −' + perso + ' HP', { bersaglio: target, valore: -perso });
        else T('nessun_danno', 'Nessun danno (' + target + ')', { bersaglio: target });
      }
    });
    (ev.effetti || []).forEach(a => {
      if (a.tipo === 'costo' && a.risorsa === 'MP' && a.delta) T('mp', 'MP consumati: ' + (-a.delta), { valore: a.delta });
      if (a.tipo === 'costo' && a.risorsa === 'HP' && a.delta) T('danno', pgNome + ': −' + (-a.delta) + ' HP', { bersaglio: pgNome, valore: a.delta });
      if (a.tipo === 'hp' && a.delta) T(a.delta > 0 ? 'cura' : 'danno', pgNome + ': ' + (a.delta > 0 ? '+' : '−') + Math.abs(a.delta) + ' HP', { bersaglio: pgNome, valore: a.delta });
      if (a.tipo === 'riposo') {
        if (a.hp) T('cura', pgNome + ': +' + a.hp + ' HP', { bersaglio: pgNome, valore: a.hp });
        if (a.mp) T('mp', 'MP recuperati: ' + a.mp, { valore: a.mp });
        if (!a.hp && !a.mp) T('nessun_effetto', 'Nessun recupero: HP e MP erano già al massimo');
      }
      if (a.tipo === 'gemma_scarica') { T('mp', 'MP recuperati: ' + a.mp, { valore: a.mp }); C('gemma', a.nome + ': scarica — ' + a.capacita + ' non disponibile fino al reintegro', { gemma: a.gemma, stato: 'scarica' }); }
      if (a.tipo === 'gemma_reintegrata') C('gemma', a.nome + ': attiva — ' + a.capacita + ' di nuovo disponibile', { gemma: a.gemma, stato: 'attiva' });
      if (a.tipo === 'forzatura') T('danno', pgNome + ': −' + (-a.hp) + ' HP (forzatura dell\'armatura)', { bersaglio: pgNome, valore: a.hp });
      if (a.tipo === 'incoscienza') C('stato', 'Stato applicato: Incosciente', { bersaglio: pgNome, nome: 'Incosciente', azione: 'applicato', durata: 'fino alla fine dello scontro', effetto: 'non puoi agire', fonte: 'armatura' });
      if (a.tipo === 'relazione') C('relazione', ((content.png[a.png] || {}).nome || a.png) + (a.delta > 0 ? ': si fida di più' : ': si fida di meno'));
      if (a.tipo === 'scoperta') C('scoperta', 'Scoperta: ' + a.testo);
      if (a.tipo === 'nota') C('nota', ({ indizio: 'Indizio: ', cambiamento: 'Cambiamento: ' }[a.categoria] || 'Diario: ') + a.testo, { categoria: a.categoria });
      if (a.tipo === 'ricompensa') C('oggetto', 'Ottieni: ' + a.nome);
      if (a.tipo === 'loot_scoperto') C('oggetto', 'Trovato: ' + a.nome);
      if (a.tipo === 'consumato') C('oggetto', 'Consumato: ' + a.nome);
      if (a.tipo === 'oggetto_perso') C('oggetto', 'Perso: ' + a.nome);
      if (a.tipo === 'avanzamento') C('livello', 'Livello ' + a.livello + ' raggiunto');
      if (a.tipo === 'capacita_lv') C('livello', a.capacita + ' sale al Lv ' + a.lv);
      if (a.tipo === 'fase') C('fase', 'Fase della scena: ' + ({ exploration: 'Esplora', development: 'Approfondisci', resolution: 'Decidi' }[a.fase] || a.fase), { fase: a.fase });
      if (a.tipo === 'incontro_inizia') C('combattimento', 'Inizia lo scontro: ' + a.nemico);
      if (a.tipo === 'incontro') C('combattimento', 'Fine dello scontro: ' + ({ vittoria: 'vittoria', fuga: 'fuga', sconfitta: 'sconfitta' }[a.esito] || a.esito));
      if (a.tipo === 'sconfitta') C('stato', 'Stato applicato: Ferito', { bersaglio: pgNome, nome: 'Ferito', azione: 'applicato', durata: 'fino al prossimo riposo', effetto: 'HP ridotti a 1; la storia ne tiene conto', fonte: nemico || 'scontro' });
      if (a.tipo === 'morte') C('morte', 'Il personaggio è morto');
      if (a.tipo === 'magia_senza_gemme') C('magia', 'Magia senza gemme davanti a testimoni');
      if (a.tipo === 'orologio') C('orologio', (((content.orologi || {})[a.orologio] || {}).nome || a.orologio) + ': ' + a.valore + '/' + a.max);
      if (a.tipo === 'pressione') C('pressione', a.nome + ': ' + a.valore + '/' + a.max);
      if (a.tipo === 'filo') C('filo', (a.stato === 'aperto' ? 'Nuovo filo: ' : 'Filo chiuso: ') + a.titolo);
      if (a.tipo === 'memoria' && a.genere === 'conseguenza' && a.classe !== 'effimero') C('conseguenza', 'Conseguenza: ' + a.testo);
    });
    // stati temporanei (supporti): applicati e rimossi in questo comando
    const prima = (before.supporti || []), dopo = (state.supporti || []);
    const kPrima = prima.map(supportKey), kDopo = dopo.map(supportKey);
    dopo.filter(s => kPrima.indexOf(supportKey(s)) === -1).forEach(s => {
      const ab = capByName(s.nome);
      const d = Number.isFinite(s.durataTurni) ? s.durataTurni : ab && Number.isFinite(ab.durataTurni) ? ab.durataTurni : (ab && ab.proposte && Number.isFinite(ab.proposte.durataTurni) ? ab.proposte.durataTurni : 1);
      C('stato', 'Stato applicato: ' + s.nome + ', ' + turni(d), { bersaglio: pgNome, nome: s.nome, azione: 'applicato', durata: turni(d), effetto: bonusText(s.bonus), fonte: s.fonte || pgNome });
      T('stato', 'Stato applicato: ' + s.nome + ', ' + turni(d), { bersaglio: pgNome });
    });
    prima.filter(s => kDopo.indexOf(supportKey(s)) === -1).forEach(s => {
      C('stato', 'Stato rimosso: ' + s.nome, { bersaglio: pgNome, nome: s.nome, azione: 'rimosso', durata: 'terminata', effetto: bonusText(s.bonus), fonte: s.fonte || pgNome, motivo: state.incontro ? 'durata esaurita' : 'fine dello scontro' });
      T('stato', 'Stato rimosso: ' + s.nome, { bersaglio: pgNome });
    });
    // condizione persistente rimossa dal riposo
    if (before.condizione === 'recupero' && state.condizione !== 'recupero') {
      C('stato', 'Stato rimosso: Ferito', { bersaglio: pgNome, nome: 'Ferito', azione: 'rimosso', durata: '—', effetto: '—', fonte: 'riposo' });
      T('stato', 'Stato rimosso: Ferito', { bersaglio: pgNome });
    }
    if (azioni.some(a => a.tipo === 'attacco') && !tec.some(t => t.tipo === 'danno' || t.tipo === 'nessun_danno')) T('nessun_danno', 'Nessun danno');
    // ogni turno di combattimento ha il suo riepilogo, anche se lo scontro finisce prima di un colpo
    if (ev.tipo === 'combattimento' && !tec.some(t => t.tipo === 'danno' || t.tipo === 'nessun_danno')) T('nessun_danno', 'Nessun danno');

    const transizione = transition(before, state, content, ev);
    return {
      formato: 'rm-solo-resoconto/1',
      azioneDichiarata: declared(before, state, content, ev, cmd),
      esito: outcome(ev),
      narrazione: null,
      effettiTecnici: tec,
      cambiamentiDiStato: cam,
      transizione,
      azioniSuccessive: E.nextActions(state, content)
    };
  }

  function declared(before, state, content, ev, cmd) {
    const pg = state.personaggio;
    if (ev.sceltaTesto) return ev.sceltaTesto;
    if (cmd.tipo === 'combattimento') {
      if (cmd.azione === 'arma') return 'Attacco con l\'arma';
      if (cmd.azione === 'fuga') return 'Tenti la fuga';
      if (cmd.azione === 'scarica_gemma') { const g = (pg.gemme || []).find(x => x.id === cmd.gemmaId); return 'Scarichi ' + (g ? g.nome : 'la gemma'); }
      const ab = [].concat(pg.tecniche, pg.abilita).find(a => a.id === cmd.abilitaId);
      return (ab ? ab.nome : 'Capacità') + (cmd.forza ? ' (forzando l\'armatura)' : '');
    }
    if (cmd.tipo === 'scarica_gemma' || cmd.tipo === 'reintegra_gemma' || cmd.tipo === 'ricarica_gemma') {
      const g = (pg.gemme || []).find(x => x.id === cmd.gemmaId);
      return (cmd.tipo === 'scarica_gemma' ? 'Scarichi ' : 'Reintegri ') + (g ? g.nome : 'una gemma');
    }
    if (cmd.tipo === 'riposo') return 'Riposi';
    if (cmd.tipo === 'usa') { const d = global.RMSoloEngine.itemInfo(before, content, cmd.oggetto); return 'Usi ' + (d ? d.nome : 'un oggetto'); }
    if (cmd.tipo === 'raccogli') { const i = ((before.borsa || {}).istanze || {})[cmd.istanza]; return 'Raccogli ' + (i ? i.nome : 'un oggetto'); }
    if (ev.tipo === 'dialogo_fine') return 'Ti congedi da ' + ev.pngNome;
    return ev.testo || ev.puntoTesto || ev.obiettivoTesto || 'Agisci';
  }

  function outcome(ev) {
    if (ev.check) {
      const e = ev.esito || ev.check.esito;
      return e === 'critico' ? 'critico' : e === 'parziale' ? 'parziale' : /fallimento/.test(e) ? 'fallimento' : 'successo';
    }
    if (ev.tipo === 'combattimento') {
      const a = ((ev.combattimento && ev.combattimento.azioni) || []).find(x => x.chi === 'pg');
      if (ev.incontroEsito === 'fuga') return 'successo';
      if (!a) return 'successo';
      if (a.tipo === 'fuga_fallita') return 'fallimento';
      if (a.tipo === 'attacco') return a.esito.hitRoll === 20 && a.esito.finalDamage > 0 ? 'critico' : a.esito.finalDamage > 0 ? 'successo' : 'fallimento';
      return 'successo';
    }
    if (ev.tipo === 'rifiutata' || ev.tipo === 'chiarimento' || ev.tipo === 'bloccata' || ev.tipo === 'sanzione' || ev.tipo === 'crudelta') return 'fallimento';
    return 'successo';
  }

  /* Transizione: solo se la scena è cambiata. Niente prove o incontri
     aggiunti: l'evento intermedio è solo ciò che il motore ha registrato. */
  function transition(before, state, content, ev) {
    if (before.scena === state.scena) return null;
    const E = global.RMSoloEngine;
    const da = E.sceneOf(content, before.scena), a = E.sceneOf(content, state.scena);
    if (!da || !a) return null;
    const pg = state.personaggio, cond = [];
    if (pg.hpCur <= pg.hpMaxTracked / 2) cond.push('ferito');
    if (pg.mpCur < pg.mpMaxTracked / 4) cond.push('energie basse');
    if (state.condizione === 'recupero') cond.push('in recupero');
    if (state.ricercato) cond.push('ricercato');
    const scariche = (pg.gemme || []).filter(g => g.stato === 'scarica').length;
    if (scariche) cond.push('gemme scariche: ' + scariche);
    // luogo esterno (Icaro, fuori dalle cupole): mai senza protezione
    if (a.esterno) cond.push('protezione: ' + a.esterno.protezione);
    const stessoLuogo = da.luogo === a.luogo;
    const arr = a.arrivo || {};
    const t = {
      luogoPartenza: da.luogo, luogoArrivo: a.luogo,
      modalita: arr.modalita || (stessoLuogo ? 'restando sul posto' : 'a piedi'),
      durataNarrativa: arr.durata || (stessoLuogo ? 'pochi istanti' : 'un tratto di strada'),
      eventoIntermedio: (ev.effetti || []).some(x => x.tipo === 'incontro_inizia') ? 'scontro' : null,
      condizioniArrivo: cond
    };
    const storia = content.storia || 'eidos';
    const COND = { 'ferito': 'le ferite ancora aperte', 'energie basse': 'le energie quasi esaurite', 'in recupero': 'il corpo ancora provato dalla caduta', 'ricercato': 'la certezza che qualcuno ti sta cercando' };
    const con = cond.filter(c => !/^protezione/.test(c)).map(c => COND[c] || (/^gemme/.test(c) ? (scariche === 1 ? 'una gemma spenta' : scariche + ' gemme spente') + ' nell\'armatura' : c));
    const frasi = [
      stessoLuogo ? 'Non ti allontani da ' + da.luogo + ', ma qualcosa è cambiato.' : 'Lasci ' + da.luogo + (a.esterno && !da.esterno ? '; prima di uscire controlli la ' + a.esterno.protezione.replace(/^tuta termica, casco sigillato e /, 'tuta termica, il casco sigillato e la ') + '.' : '.'),
      stessoLuogo ? pick(state, 'passaggio_scena', {}) : pick(state, 'spostamento_' + storia, {}, riservaDi(content, 'spostamento') || RISERVA.spostamento),
      stessoLuogo ? '' : 'Arrivi: ' + a.luogo + '.',
      con.length ? 'Porti con te ' + con.join(', ').replace(/, ([^,]*)$/, ' e $1') + '.' : pick(state, 'nuovo_luogo', {})
    ].filter(Boolean);
    t.testo = frasi.join(' ');
    return t;
  }

  /* Testo di riserva della conseguenza (senza numeri). I testi scritti
     nei contenuti per quell'azione (ev.riserva) hanno la precedenza. */
  function fallback(state, content, ev, res) {
    // mai lo stesso testo dell'evento precedente: si riprova con la
    // rotazione successiva (le categorie avanzano a ogni uso)
    const last = state.eventi[state.eventi.length - 1];
    const prev = last && ((last.narrazione && last.narrazione.testo) || (last.resoconto && last.resoconto.riserva));
    let t = compose(state, content, ev, res);
    for (let i = 0; i < 3 && prev && t === prev; i++) t = compose(state, content, ev, res, i + 1);
    // la decompressione segue l'arrivo: sta nel blocco della transizione
    const rg = regiaText(state, content, ev);
    if (rg.aftermath && res.transizione) res.transizione.decompressione = rg.aftermath;
    return [t, rg.aftermath && !res.transizione ? rg.aftermath : null, rg.stallo].filter(Boolean).join('\n\n');
  }
  /* Paragrafi del regista, dallo stesso bundle: decompressione dopo un
     picco (solo ciò che il motore ha registrato) e suggerimento di stallo
     (una direzione, mai la soluzione). */
  function regiaText(state, content, ev) {
    const out = { aftermath: null, stallo: null };
    const af = ev.aftermath;
    if (af) {
      const righe = [pick(state, 'aftermath', {})];
      if (af.perdite.length) righe.push('Hai perso ' + elenco(af.perdite.map(lower)) + '.');
      if (af.relazioni.length) righe.push('Qualcosa è cambiato nei rapporti: ' + elenco(af.relazioni) + '.');
      if (af.condizioneQuotidiana.length) righe.push('Adesso devi fare i conti con ' + elenco(af.condizioneQuotidiana) + '.');
      out.aftermath = righe.join(' ');
    }
    const st = ev.suggerimentoStallo;
    if (st && st.png) out.stallo = pick(state, 'stallo_png', { png: st.png });
    else if (st && st.luogo) out.stallo = pick(state, 'stallo_luogo', { luogo: lower(st.luogo) });
    return out;
  }
  function elenco(l) { return l.length > 1 ? l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1] : l[0]; }
  function compose(state, content, ev, res, retry) {
    const E = global.RMSoloEngine;
    const inc = ev.combattimento;
    const nemico = ev.nemicoNome || '';
    const parti = [];
    if (ev.tipo === 'combattimento' && inc) {
      // ogni variazione del riepilogo ha la sua causa nel testo: azione del
      // protagonista, risposta del nemico, stati che scadono, esito finale
      const pg = state.personaggio;
      const nemicoArt = ev.nemicoArt || nemico;
      const pgA = inc.azioni.find(a => a.chi === 'pg'), foeA = inc.azioni.find(a => a.chi === 'nemico' && a.tipo === 'attacco');
      // tattica dell'avversario (schede in anteprima): il segnale leggibile
      const tat = inc.tattica && inc.tattica.tipo !== 'attacco' && inc.tattica.segnale ? nemicoArt.charAt(0).toUpperCase() + nemicoArt.slice(1) + ' ' + inc.tattica.segnale + '.' : null;
      if (pgA && pgA.tipo === 'attacco') {
        const cap = [].concat(pg.tecniche || [], pg.abilita || []).some(x => x.nome === pgA.capacita);
        const v = { nemico: nemicoArt, con: cap ? 'con ' + pgA.capacita : 'con la tua arma', colpo: cap ? 'il colpo di ' + pgA.capacita : 'il colpo della tua arma' };
        parti.push(pick(state, (pgA.perso != null ? pgA.perso : pgA.esito.finalDamage) > 0 ? 'colpo_riuscito' : 'colpo_mancato', v));
      }
      if (pgA && pgA.tipo === 'supporto') parti.push(pick(state, 'stato_applicato', { stato: pgA.capacita }));
      if (pgA && pgA.tipo === 'scarica_gemma') { const g = (ev.effetti || []).find(x => x.tipo === 'gemma_scarica'); if (g) parti.push(pick(state, 'gemma_scaricata', { gemma: 'la ' + lower(g.nome), capacita: g.capacita }, riservaDi(content, 'gemma_scaricata') || NEUTRI.gemma_scaricata)); }
      if (pgA && pgA.tipo === 'fuga_fallita') parti.push('Cerchi un varco per fuggire, ma ' + nemicoArt + ' te lo chiude.');
      if ((ev.effetti || []).some(a => a.tipo === 'forzatura')) parti.push('Senza energia, forzi l\'armatura: la paghi con la tua linfa vitale.');
      if (ev.incontroEsito === 'sconfitta' || ev.incontroEsito === 'morte') {
        // caduta: chi ti colpisce, poi il testo della scena (salvataggio,
        // ferita, tempo perso) se è una sconfitta con recupero
        if (foeA) parti.push(pick(state, 'fine_sconfitta', { nemico: nemicoArt }));
        if (ev.incontroEsito === 'sconfitta' && ev.testoSconfitta) parti.push(ev.testoSconfitta);
        return parti.filter(Boolean).join(' ');
      }
      if (tat) parti.push(tat);
      // scontro con più avversari: segnali leggibili delle loro mosse e chi esce
      if (inc.gruppo) {
        const maiu = t => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);
        inc.azioni.filter(a => a.chi === 'nemico' && a.tipo !== 'attacco' && a.segnale && ['fuga', 'resa', 'sconfitto'].indexOf(a.tipo) === -1).slice(0, 3).forEach(a => parti.push(maiu(a.nome) + ' ' + a.segnale + '.'));
        inc.azioni.filter(a => a.tipo === 'cura' && a.curati).slice(0, 1).forEach(a => parti.push(a.oggetto && a.bersaglio === a.uid ? maiu(a.nome) + ' si medica: ' + String(a.capacita || '').toLowerCase() + '.' : maiu(a.nome) + ' rimette in piedi ' + a.bersaglioNome + '.'));
        inc.azioni.filter(a => a.chi === 'nemico' && ['fuga', 'resa', 'sconfitto'].indexOf(a.tipo) !== -1).forEach(a => parti.push(maiu(a.nome) + (a.tipo === 'fuga' ? ' fugge.' : a.tipo === 'resa' ? ' si arrende.' : ' cade.')));
      }
      if (ev.incontroEsito) parti.push(pick(state, 'fine_' + ev.incontroEsito, { nemico: nemicoArt }));
      else if (foeA) {
        const colpito = (foeA.perso != null ? foeA.perso : foeA.esito.finalDamage) > 0;
        // più rapido, il nemico ha colpito per primo
        if (inc.iniziativa === 'nemico') parti.unshift('Più rapido di te, ' + nemicoArt + ' attacca per primo con ' + lower(foeA.capacita) + (colpito ? ' e ti ferisce.' : ', ma non ti raggiunge.'));
        else parti.push(pick(state, colpito ? 'danno_subito' : 'nessun_danno_subito', { nemico: nemicoArt, attacco: lower(foeA.capacita) }));
      }
      if (foeA && foeA.stato) parti.push(foeA.stato.resistito ? 'Resisti: ' + foeA.stato.nome.toLowerCase() + ' non ti prende.' : nemicoArt.charAt(0).toUpperCase() + nemicoArt.slice(1) + ' ti lascia ' + foeA.stato.nome.toLowerCase() + '.');
      // stati che scadono o si dissolvono con la fine dello scontro
      (res.cambiamentiDiStato || []).filter(c => c.tipo === 'stato' && c.azione === 'rimosso').forEach(c => parti.push(ev.incontroEsito ? 'Con la fine dello scontro, ' + c.nome + ' si dissolve.' : pick(state, 'stato_rimosso', { stato: c.nome })));
      return parti.filter(Boolean).join(' ');
    }
    if (ev.tipo === 'scarica_gemma') { const g = (ev.effetti || []).find(x => x.tipo === 'gemma_scarica'); return g ? pick(state, 'gemma_scaricata', { gemma: 'la ' + lower(g.nome), capacita: g.capacita }, riservaDi(content, 'gemma_scaricata') || NEUTRI.gemma_scaricata) : ''; }
    if (ev.tipo === 'reintegra_gemma' || ev.tipo === 'ricarica_gemma') { const g = (ev.effetti || []).find(x => x.tipo === 'gemma_reintegrata'); return g ? pick(state, 'gemma_reintegrata', { gemma: 'la ' + lower(g.nome), capacita: g.capacita }, riservaDi(content, 'gemma_reintegrata') || NEUTRI.gemma_reintegrata) : ''; }
    if (ev.tipo === 'riposo' || (ev.tipo === 'usa' && res.effettiTecnici.some(t => t.tipo === 'cura'))) {
      const base = ev.tipo === 'usa' && ev.riserva ? ev.riserva + ' ' : '';
      return base + pick(state, 'cura', {});
    }
    if (ev.tipo === 'raccogli') { const r = (ev.effetti || []).find(x => x.tipo === 'ricompensa'); return pick(state, 'raccolta', { oggetto: r ? lower(r.nome) : 'l\'oggetto' }); }
    if (ev.tipo === 'usa' && !ev.riserva) { const c = (ev.effetti || []).find(x => x.tipo === 'consumato'); return pick(state, 'uso', { oggetto: c ? lower(c.nome) : 'l\'oggetto' }); }
    // minaccia della scena che arriva prima del tentativo
    if (ev.tipo === 'minaccia') return pick(state, 'ingresso_combattimento', {});
    let t = E.fallbackText(state, content, ev);
    if (ev.check && !ev.riserva) t = pick(state, ev.esito === 'critico' ? 'critico' : ev.esito === 'parziale' ? 'parziale' : /fallimento/.test(ev.esito) ? 'fallimento' : 'successo', { obiettivo: lower(ev.obiettivoTesto) });
    // cambio di fase senza un testo dei contenuti
    if ((ev.effetti || []).some(a => a.tipo === 'fase' && a.fase !== 'exploration') && !ev.sviluppo && !ev.svoltaTesto) t += (t ? '\n\n' : '') + pick(state, 'passaggio_fase', {});
    if ((ev.effetti || []).some(a => a.tipo === 'incontro_inizia')) t += (t ? '\n\n' : '') + pick(state, 'ingresso_combattimento', { nemico: ((ev.effetti || []).find(a => a.tipo === 'incontro_inizia') || {}).nemico });
    return t;
  }
  function lower(s) { s = String(s || ''); return s ? s.charAt(0).toLowerCase() + s.slice(1) : ''; }

  /* ------------------------------------------ cause narrate

     Ogni variazione del riepilogo deve avere nel testo la sua causa: chi
     colpisce, con che cosa, quale stato si applica o svanisce, da dove
     vengono cure e MP, come finisce lo scontro. causes() elenca le cause
     con le parole che le rendono riconoscibili; uncovered() dice quali
     mancano in un testo. */
  function stem(w) { return norm(w).split(' ').filter(x => x.length > 3).map(x => x.slice(0, 5)); }
  function first(w) { const l = stem(w); return l.length ? [l[0]] : []; }
  function causes(ev) {
    const r = ev.resoconto || {}, out = [];
    const az = (ev.combattimento && ev.combattimento.azioni) || [];
    const pgA = az.find(a => a.chi === 'pg'), foeA = az.find(a => a.chi === 'nemico' && a.tipo === 'attacco');
    const nem = first(ev.nemicoNome || '');
    if (pgA && pgA.tipo === 'attacco') out.push({ causa: 'attacco del protagonista', parole: first(pgA.capacita).concat(['arma']) });
    if (pgA && pgA.tipo === 'supporto') out.push({ causa: 'capacità di supporto', parole: first(pgA.capacita) });
    if (pgA && pgA.tipo === 'scarica_gemma') out.push({ causa: 'gemma scaricata', parole: ['gemma'] });
    if (pgA && pgA.tipo === 'fuga_fallita') out.push({ causa: 'fuga fallita', parole: ['fuggi', 'varco'] });
    if (foeA && !(ev.incontroEsito === 'sconfitta' || ev.incontroEsito === 'morte')) out.push({ causa: 'risposta del nemico', parole: nem });
    if (foeA && foeA.stato) out.push({ causa: 'stato del nemico', parole: first(foeA.stato.nome) });
    // segnale della tattica dell'avversario: è una frase del racconto (compose), quindi una causa
    const tat = ev.combattimento && ev.combattimento.tattica;
    if (tat && tat.tipo !== 'attacco' && tat.segnale) out.push({ causa: 'tattica del nemico', parole: first(tat.segnale).concat(nem) });
    // scontro di gruppo: le stesse frasi che compose aggiunge (segnali delle mosse, cure, uscite)
    if (ev.combattimento && ev.combattimento.gruppo && ev.incontroEsito !== 'sconfitta' && ev.incontroEsito !== 'morte') {
      az.filter(a => a.chi === 'nemico' && a.tipo !== 'attacco' && a.segnale && ['fuga', 'resa', 'sconfitto'].indexOf(a.tipo) === -1).slice(0, 3).forEach(a => out.push({ causa: 'mossa di ' + a.nome, parole: first(a.segnale).concat(first(a.nome)) }));
      az.filter(a => a.tipo === 'cura' && a.curati).slice(0, 1).forEach(a => out.push({ causa: 'cura di ' + a.nome, parole: first(a.nome) }));
      az.filter(a => a.chi === 'nemico' && ['fuga', 'resa', 'sconfitto'].indexOf(a.tipo) !== -1).forEach(a => out.push({ causa: a.tipo + ' di ' + a.nome, parole: first(a.nome) }));
    }
    if (ev.incontroEsito === 'vittoria') out.push({ causa: 'vittoria', parole: nem.concat(['crolla', 'scont']) });
    if (ev.incontroEsito === 'fuga') out.push({ causa: 'fuga', parole: ['sganc', 'allon', 'fugg'] });
    if (ev.incontroEsito === 'nemico_fuggito') out.push({ causa: 'nemico fuggito', parole: nem.concat(['arret', 'fugg', 'spari']) });
    if (ev.incontroEsito === 'resa') out.push({ causa: 'resa', parole: nem.concat(['arren', 'abbas', 'mani']) });
    if (ev.incontroEsito === 'sconfitta' || ev.incontroEsito === 'morte') out.push({ causa: 'sconfitta', parole: nem.concat(['cadi', 'cedon', 'atter']) });
    (ev.effetti || []).forEach(a => {
      if (a.tipo === 'forzatura') out.push({ causa: 'forzatura dell\'armatura', parole: ['armat', 'linfa'] });
      if (a.tipo === 'riposo' && (a.hp || a.mp)) out.push({ causa: 'riposo', parole: ['respi', 'ferit', 'forze', 'ripos', 'recup'] });
      if (a.tipo === 'hp' && a.delta > 0 && ev.tipo === 'usa') out.push({ causa: 'cura dall\'oggetto', parole: ['respi', 'ferit', 'forze', 'dolor'] });
    });
    (r.cambiamentiDiStato || []).filter(c => c.tipo === 'stato').forEach(c => out.push({ causa: 'stato ' + c.azione + ': ' + c.nome, parole: first(c.nome) }));
    return out.filter(c => c.parole.length);
  }
  function uncovered(ev, text) {
    const t = ' ' + norm(text) + ' ';
    return causes(ev).filter(c => !c.parole.some(p => t.indexOf(p) !== -1)).map(c => c.causa);
  }

  /* ------------------------------------------ narratore: dati e controllo */

  // Frasi massime per tipo di evento (ritmo dei testi)
  function maxSentences(ev) {
    const r = ev.resoconto || {};
    if (ev.sceltaId || (ev.effetti || []).some(a => a.tipo === 'finale')) return 7;
    // combattimento: 1–2 frasi, una in più per ogni causa ulteriore; la
    // sconfitta con recupero aggiunge il racconto del salvataggio
    if (ev.tipo === 'combattimento') return Math.max(2, causes(ev).length) + (ev.incontroEsito === 'sconfitta' ? 3 : 0);
    if (r.transizione) return 4;
    return 3;
  }
  function trimSentences(text, max) {
    const parts = String(text || '').match(/[^.!?…»]+(?:[.!?…]+»?|»|$)/g) || [];
    if (parts.length <= max) return String(text || '').trim();
    return parts.slice(0, max).join('').trim();
  }

  /* NarrativeContext in sola lettura: ciò che serve a un testo ricco e
     coerente, mai ciò che il giocatore non sa. Identità e voce della
     storia, descrizione canonica della scena e fase, fatti già scoperti,
     PNG presenti con motivazione e atteggiamento, memoria pertinente dei
     dialoghi, relazioni note, promesse, minacce e voci, poi azione, esito
     e variazioni già calcolate e l'eventuale transizione. Congelato: il
     narratore non può cambiare nulla dello stato. */
  function deepFreeze(o) { Object.values(o).forEach(v => { if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); }); return Object.freeze(o); }
  function narrativeContext(state, content, ev, voce) {
    const E = global.RMSoloEngine;
    const sc = E.sceneOf(content, ev.scena) || {};
    const it = state.interazione && state.interazione.scena === ev.scena ? state.interazione : null;
    const mem = state.memoriaPng || {};
    const g = content.interazioni && content.interazioni.scene && content.interazioni.scene[ev.scena];
    const presenti = (sc.png_presenti || []).map(id => {
      const d = content.png[id] || {}, st = (state.png || {})[id] || {};
      const m = it && it.dialoghi && it.dialoghi[id];
      const def = g && (g.dialoghi || []).find(x => x.png === id);
      const detti = def && m ? (m.argomenti || []).map(a => (def.argomenti.find(x => x.id === a) || {}).testo).filter(Boolean) : [];
      return { nome: d.nome, ruolo: d.ruolo, motivazione: d.motivazione, atteggiamento: relazioneTesto(Number(st.atteggiamento) || 0),
        memoria: { argomentiAffrontati: detti, giaIncontrato: ((mem[id] || {}).argomenti || []).length > 0, promesse: ((m && m.promesse) || []).map(x => x.testo) } };
    });
    const relazioni = Object.entries(state.png || {}).filter(([, v]) => v.incontrato).map(([k, v]) => ({ nome: (content.png[k] || {}).nome, relazione: relazioneTesto(Number(v.atteggiamento) || 0) }));
    const promesse = ((state.sociale && state.sociale.promesse) || []).map(p => p.testo);
    const minacce = (state.eventi || []).filter(e => e.tono === 'minaccia').slice(-2).map(e => e.pngNome + ': «' + e.testo + '»');
    const voci = ((state.sociale && state.sociale.voci) || []).slice(-2).map(v => v.testo);
    const p = payload(state, content, ev);
    return deepFreeze({
      storia: { titolo: content.titolo || '', ambientazione: content.ambientazione || content.storia || '', voce: voce && voce.narrative_voice ? voce.narrative_voice.id : null },
      scena: { titolo: sc.titolo || '', luogo: sc.luogo || '', descrizione: sc.descrizione || '', fase: it ? it.fase : null },
      fattiScoperti: (state.fattiScoperti || []).map(f => (content.fatti[f] || {}).testo).filter(Boolean),
      pngPresenti: presenti,
      relazioniNote: relazioni,
      promesse, minacce, voci,
      azione: p.azioneDichiarata, esito: p.esito, effettiTecnici: p.effettiTecnici, cambiamentiDiStato: p.cambiamentiDiStato,
      transizione: (ev.resoconto && ev.resoconto.transizione) ? { da: ev.resoconto.transizione.luogoPartenza, a: ev.resoconto.transizione.luogoArrivo, modalita: ev.resoconto.transizione.modalita } : null,
      contenutoStabilito: p.contenutoStabilito, frasiMassime: p.frasiMassime, personaggiCoinvolti: p.personaggi,
      dialogo: p.dialogo, rispostaPng: p.rispostaPng
    });
  }
  function contextText(c) {
    const L = [];
    L.push('STORIA: ' + c.storia.titolo + (c.storia.ambientazione ? ' (' + c.storia.ambientazione + ')' : ''));
    L.push('SCENA: ' + c.scena.titolo + ' — ' + c.scena.luogo + '. ' + c.scena.descrizione + (c.scena.fase ? ' Fase: ' + c.scena.fase + '.' : ''));
    L.push('FATTI GIÀ SCOPERTI DAL PROTAGONISTA:\n' + (c.fattiScoperti.map(f => '- ' + f).join('\n') || '- nessuno'));
    L.push('PNG PRESENTI:\n' + (c.pngPresenti.map(x => '- ' + x.nome + ' (' + x.ruolo + '; motivazione: ' + x.motivazione + '; verso il protagonista: ' + x.atteggiamento + ')' +
      (x.memoria.argomentiAffrontati.length ? ' Ha già parlato di: ' + x.memoria.argomentiAffrontati.join('; ') + '. Non ripeterlo.' : '') +
      (x.memoria.promesse.length ? ' Promesse ricevute: ' + x.memoria.promesse.join('; ') + '.' : '')).join('\n') || '- nessuno'));
    if (c.relazioniNote.length) L.push('RELAZIONI NOTE: ' + c.relazioniNote.map(r => r.nome + ' (' + r.relazione + ')').join(', '));
    if (c.promesse.length || c.minacce.length || c.voci.length) L.push('PROMESSE, MINACCE E VOCI: ' + c.promesse.concat(c.minacce, c.voci.map(v => 'voce non verificata: ' + v)).join('; '));
    L.push('AZIONE DEL GIOCATORE: ' + (c.azione || '—'));
    if (c.rispostaPng) L.push(c.rispostaPng);
    if (!c.dialogo) L.push('ESITO (già calcolato, non cambiarlo): ' + c.esito);
    L.push('VARIAZIONI GIÀ APPLICATE (raccontane la causa, non scrivere i numeri): ' + (c.effettiTecnici.join('; ') || 'nessuna'));
    L.push('CAMBIAMENTI: ' + (c.cambiamentiDiStato.join('; ') || 'nessuno'));
    if (c.transizione) L.push('SPOSTAMENTO GIÀ DECISO: da ' + c.transizione.da + ' a ' + c.transizione.a + ' (' + c.transizione.modalita + ')');
    if (c.contenutoStabilito) L.push('CONTENUTO STABILITO (riformulalo senza aggiungere fatti): «' + c.contenutoStabilito + '»');
    L.push('LUNGHEZZA: al massimo ' + c.frasiMassime + ' frasi.');
    return L.join('\n');
  }

  /* Dialoghi: un esito di dado non ha senso per una battuta (resta solo
     se la battuta ha richiesto una prova). Per una battuta libera il
     motore decide come si comporta il PNG; il Narratore lo recita. */
  const COMPORTAMENTI = {
    coopera: 'collabora: risponde con ciò che sa davvero, senza aggiungere fatti',
    rivela: 'si fida: dice ciò che sa su quanto gli viene chiesto',
    conferma: 'conferma ciò che il protagonista sa già',
    devia: 'cambia discorso senza mentire apertamente',
    mente: 'mente per proteggere una scelta propria',
    tace: 'non risponde: un gesto o un silenzio al posto delle parole',
    chiede_in_cambio: 'non si fida ancora: chiede qualcosa in cambio prima di parlare',
    sfida: 'contesta la posizione del protagonista',
    minaccia: 'reagisce con durezza e avverte'
  };
  function dialogico(ev) { return !!ev && ['battuta', 'dialogo', 'dialogo_fine'].indexOf(ev.tipo) !== -1 && !ev.check; }
  function rispostaPng(ev) {
    if (!ev || ev.tipo !== 'battuta' || ev.argomento || !ev.comportamentoPng || !ev.pngNome) return null;
    return 'BATTUTA LIBERA A ' + ev.pngNome + ': fai rispondere ' + ev.pngNome + ' a ciò che il giocatore ha detto. Comportamento deciso dal motore: ' +
      (COMPORTAMENTI[ev.comportamentoPng] || ev.comportamentoPng) + '. ' + ev.pngNome + ' non conosce persone, luoghi o fatti che non compaiono in questo contesto: se non sa, lo dice a modo suo.';
  }

  /* Il narratore riceve solo ciò che il motore ha già deciso. */
  function payload(state, content, ev) {
    const r = ev.resoconto || {};
    const E = global.RMSoloEngine;
    const sc = E.sceneOf(content, ev.scena) || {};
    const it = state.interazione && state.interazione.scena === ev.scena ? state.interazione : null;
    const png = [];
    if (ev.pngNome) png.push(ev.pngNome);
    if (ev.nemicoNome) png.push(ev.nemicoNome);
    (sc.png_presenti || []).forEach(id => { const n = (content.png[id] || {}).nome; if (n && png.indexOf(n) === -1) png.push(n); });
    return {
      azioneDichiarata: r.azioneDichiarata,
      esito: r.esito,
      effettiTecnici: (r.effettiTecnici || []).map(t => t.testo),
      cambiamentiDiStato: (r.cambiamentiDiStato || []).map(c => c.testo),
      personaggi: [state.personaggio.nome].concat(png),
      luogo: sc.luogo || '',
      fase: it ? it.fase : null,
      destinazione: r.transizione ? r.transizione.luogoArrivo : null,
      contenutoStabilito: ev.riservaMotore ? null : (ev.riserva || null),
      frasiMassime: maxSentences(ev),
      dialogo: dialogico(ev),
      rispostaPng: rispostaPng(ev)
    };
  }
  function payloadText(p) {
    return 'AZIONE DICHIARATA: ' + (p.azioneDichiarata || '—') +
      (p.rispostaPng ? '\n' + p.rispostaPng : '') +
      (p.dialogo ? '' : '\nESITO (già calcolato, non cambiarlo): ' + p.esito) +
      '\nEFFETTI GIÀ APPLICATI (non ripetere i numeri nel testo): ' + (p.effettiTecnici.join('; ') || 'nessuno') +
      '\nCAMBIAMENTI: ' + (p.cambiamentiDiStato.join('; ') || 'nessuno') +
      '\nPERSONAGGI COINVOLTI: ' + p.personaggi.join(', ') +
      '\nLUOGO: ' + p.luogo + (p.fase ? '\nFASE DELLA SCENA: ' + p.fase : '') +
      (p.destinazione ? '\nDESTINAZIONE: ' + p.destinazione : '') +
      (p.contenutoStabilito ? '\nCONTENUTO STABILITO (riformulalo senza aggiungere fatti): «' + p.contenutoStabilito + '»' : '') +
      '\nLUNGHEZZA: al massimo ' + p.frasiMassime + ' frasi.';
  }

  /* Controllo della narrazione contro il resoconto: il testo non può
     aggiungere effetti che il motore non ha restituito. */
  function check(state, content, ev, text) {
    const t = String(text || '');
    const r = ev.resoconto || {};
    const problems = [];
    const eff = ev.effetti || [];
    if (/\d+\s*(HP|PS|MP|punti (ferita|vita|magia)|danni|danno)\b/i.test(t)) problems.push('numeri_nel_testo');
    const morte = eff.some(a => a.tipo === 'morte');
    if (!morte && /\b(sei mort[oa]|muori|stai morendo|il tuo cuore si ferma)\b/i.test(t)) problems.push('morte_non_avvenuta');
    const uccisi = eff.some(a => a.tipo === 'incontro' && a.esito === 'vittoria');
    if (!uccisi && /\b(uccidi|ucciso|uccisa|muore|è mort[oa]|cade morto|cade morta|senza vita)\b/i.test(t)) problems.push('uccisione_non_avvenuta');
    const statiOk = (r.cambiamentiDiStato || []).filter(c => c.tipo === 'stato').map(c => (c.nome || '').toLowerCase());
    [['avvelenat', 'avvelenato'], ['paralizzat', 'paralizzato'], ['stordit', 'stordito'], ['sbilanciat', 'sbilanciato'], ['accecat', 'accecato'], ['incoscien', 'incosciente'], ['svenut', 'svenuto']].forEach(([re, nome]) => {
      if (new RegExp('\\b(sei|resti|rimani|diventi|ti ritrovi|è|resta)\\s+' + re, 'i').test(t) && !statiOk.some(s => s.indexOf(nome.slice(0, 6)) !== -1)) problems.push('stato_inventato:' + nome);
    });
    const cura = (r.effettiTecnici || []).some(x => x.tipo === 'cura');
    if (!cura && /\b(guarisci|le ferite si (chiudono|rimarginano)|ti senti guarit[oa]|recuperi le forze)\b/i.test(t)) problems.push('cura_non_avvenuta');
    const oggetti = eff.some(a => a.tipo === 'ricompensa' || a.tipo === 'loot_scoperto');
    if (!oggetti && /\b(ottieni|ricevi|intaschi|metti nello zaino|aggiungi al tuo equipaggiamento)\b/i.test(t)) problems.push('oggetto_non_assegnato');
    // cambio di luogo non avvenuto
    const E = global.RMSoloEngine;
    const qui = (E.sceneOf(content, ev.scena) || {}).luogo, dest = r.transizione ? r.transizione.luogoArrivo : null;
    const altri = Array.from(new Set(content.scene.map(s => s.luogo))).filter(l => l && l !== qui && l !== dest);
    altri.forEach(l => {
      const w = l.split(/\s+/).filter(x => x.length > 4)[0];
      if (w && new RegExp('\\b(arrivi|raggiungi|entri|ti ritrovi|giungi)\\b[^.]{0,40}' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t)) problems.push('luogo_non_raggiunto:' + l);
    });
    if (r.esito === 'fallimento' && /\b(con successo|ce la fai|riesci perfettamente)\b/i.test(t)) problems.push('esito_alterato');
    if ((r.effettiTecnici || []).some(x => x.tipo === 'mp') && /\b(senza (alcuno )?sforzo|non ti costa nulla|senza consumare)\b/i.test(t)) problems.push('costo_annullato');
    uncovered(ev, t).forEach(c => problems.push('causa_non_narrata:' + c));
    return { ok: problems.length === 0, problems };
  }

  /* ---------------------------------- NarrativeConsequenceBundle

     Un solo pacchetto per evento, costruito dal resoconto del motore: da
     qui nascono il riepilogo tecnico (technicalSummary), il testo di
     riserva e il contesto del narratore (authorizedNarrativeEffects,
     allowedClaims). Nessuna delle tre viste può dire qualcosa che il
     pacchetto non contiene. */
  function bundle(state, content, ev) {
    const r = ev.resoconto || {};
    const E = global.RMSoloEngine;
    const eff = ev.effetti || [];
    const sc = E.sceneOf(content, ev.scena) || {};
    const claims = [];
    const add = (tipo, ref) => { if (ref && !claims.some(c => c.tipo === tipo && c.ref === ref)) claims.push({ tipo, ref }); };
    add('luogo', sc.luogo);
    if (r.transizione) add('luogo', r.transizione.luogoArrivo);
    (sc.png_presenti || []).forEach(id => add('png', (content.png[id] || {}).nome));
    if (ev.nemicoNome) add('png', ev.nemicoNome);
    add('png', state.personaggio.nome);
    eff.forEach(a => {
      if (['ricompensa', 'loot_scoperto', 'consumato', 'oggetto_perso'].indexOf(a.tipo) !== -1) add('oggetto', a.nome);
      if (a.tipo === 'relazione') add('relazione', (content.png[a.png] || {}).nome);
      if (a.tipo === 'verita') add('verita', a.verita || a.id);
      if (a.tipo === 'morte') add('morte', state.personaggio.nome);
      if (a.tipo === 'incontro' && a.esito === 'vittoria') add('sconfitta_nemico', ev.nemicoNome);
    });
    (r.cambiamentiDiStato || []).filter(c => c.tipo === 'stato' && c.azione === 'applicato').forEach(c => add('stato', c.nome));
    if ((r.effettiTecnici || []).some(t => t.tipo === 'cura')) add('cura', state.personaggio.nome);
    if ((r.effettiTecnici || []).some(t => t.tipo === 'danno')) add('danno', 'scontro');
    (state.inventario || []).forEach(i => { const d = E.itemInfo(state, content, i.id); if (d) add('oggetto', d.nome); });
    const cause = causes(ev);
    return {
      formato: 'rm-solo-bundle/1',
      evento: ev.n,
      esito: r.esito,
      canonicalChanges: eff.map(a => a.tipo),
      technicalSummary: (r.effettiTecnici || []).map(t => t.testo),
      stateChanges: (r.cambiamentiDiStato || []).map(c => c.testo),
      requiredCauses: cause.map(c => c.causa),
      authorizedNarrativeEffects: cause.map(c => c.causa).concat((r.cambiamentiDiStato || []).filter(c => c.tipo !== 'fase').map(c => String(c.testo).replace(/\s*\d+\s*\/\s*\d+/g, ''))),
      allowedClaims: claims,
      transition: r.transizione ? { da: r.transizione.luogoPartenza, a: r.transizione.luogoArrivo, modalita: r.transizione.modalita, durata: r.transizione.durataNarrativa } : null
    };
  }

  /* -------------------------- contratto di uscita del narratore

     Il narratore risponde con un oggetto JSON; solo `narration` è
     obbligatorio. Nessun campo è canonico: claims, memoria e Diario sono
     candidati che il validatore accetta o scarta. */
  const NARRATOR_OUTPUT = {
    type: 'object',
    properties: {
      narration: { type: 'string' },
      dialogueLines: { type: 'array', items: { type: 'object', properties: { speaker: { type: 'string' }, function: { type: 'string' }, text: { type: 'string' } }, required: ['speaker', 'text'] } },
      sensoryChanges: { type: 'array', items: { type: 'string' } },
      environmentalChanges: { type: 'array', items: { type: 'string' } },
      npcReactions: { type: 'array', items: { type: 'object', properties: { npc: { type: 'string' }, reaction: { type: 'string' } } } },
      transitionText: { type: 'string' },
      narrativeClaims: { type: 'array', items: { type: 'object', properties: { tipo: { type: 'string' }, ref: { type: 'string' } }, required: ['tipo', 'ref'] } },
      memoryCandidate: { type: 'string' },
      journalCandidate: { type: 'string' },
      toneTags: { type: 'array', items: { type: 'string' } },
      intensityLevel: { type: 'integer' }
    },
    required: ['narration']
  };
  const FUNZIONI_BATTUTA = ['answer', 'evade', 'challenge', 'test', 'request', 'reveal', 'misdirect', 'negotiate', 'threaten', 'concede', 'close'];
  function parseOutput(raw) {
    let p = raw;
    if (typeof raw === 'string') {
      const s = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      const a = s.indexOf('{'), b = s.lastIndexOf('}');
      try { p = a !== -1 && b !== -1 ? JSON.parse(s.slice(a, b + 1)) : null; } catch (e) { p = null; }
    }
    if (!p || typeof p !== 'object') return null;
    // compatibilità con il contratto precedente {narrazione, battute}
    const narration = typeof p.narration === 'string' ? p.narration : typeof p.narrazione === 'string' ? p.narrazione : null;
    if (!narration || !narration.trim()) return null;
    const arr = (x, f) => Array.isArray(x) ? x.slice(0, 6).map(f).filter(Boolean) : [];
    const str = x => typeof x === 'string' && x.trim() ? x.slice(0, 400) : null;
    const lines = Array.isArray(p.dialogueLines) ? p.dialogueLines : Array.isArray(p.battute) ? p.battute.map(b => ({ speaker: b && b.png, text: b && b.testo })) : [];
    return {
      narration: narration.slice(0, 2600),
      dialogueLines: arr(lines, d => d && typeof d.text === 'string' ? { speaker: String(d.speaker || '').slice(0, 60), function: FUNZIONI_BATTUTA.indexOf(d.function) !== -1 ? d.function : null, text: d.text.slice(0, 400) } : null),
      sensoryChanges: arr(p.sensoryChanges, str), environmentalChanges: arr(p.environmentalChanges, str),
      npcReactions: arr(p.npcReactions, x => x && x.npc ? { npc: String(x.npc).slice(0, 60), reaction: String(x.reaction || '').slice(0, 200) } : null),
      transitionText: str(p.transitionText),
      narrativeClaims: arr(p.narrativeClaims, x => x && x.tipo && x.ref ? { tipo: String(x.tipo), ref: String(x.ref) } : null),
      memoryCandidate: str(p.memoryCandidate), journalCandidate: str(p.journalCandidate),
      toneTags: arr(p.toneTags, str), intensityLevel: Number.isInteger(p.intensityLevel) ? Math.max(1, Math.min(5, p.intensityLevel)) : null
    };
  }

  /* Validatore esteso del contratto: oltre a check() (numeri, morti,
     stati, cure, oggetti, luoghi, esito, costi, cause narrate) controlla
     affermazioni non autorizzate, PNG assenti, contraddizioni temporali,
     pensieri o emozioni attribuiti al protagonista, ripetizioni del testo
     precedente, lessico non ancora sbloccato, budget di lunghezza e
     d'intensità, funzione delle battute e candidati per memoria e Diario. */
  const MENTALE = /\b(pensi che|ti rendi conto che|capisci che|decidi di|ti convinci|provi (rabbia|paura|odio|vergogna|gioia|tristezza)|sei (terrorizzat|furios|felic|disperat)\w*|hai paura|ti senti (in colpa|tradit|sollevat))/i;
  const TEMPO = /\b(il giorno dopo|l'indomani|giorni dopo|settimane (dopo|più tardi)|mesi (dopo|più tardi)|anni (dopo|più tardi)|all'alba seguente)\b/i;
  function sentenceCount(t) { return (String(t || '').match(/[^.!?…»]+(?:[.!?…]+»?|»|$)/g) || []).filter(x => x.trim()).length; }
  function checkContract(state, content, ev, out) {
    const problems = [];
    const b = (ev.resoconto && ev.resoconto.bundle) || bundle(state, content, ev);
    const all = [out.narration].concat(out.dialogueLines.map(d => d.text), out.sensoryChanges, out.environmentalChanges, out.transitionText || []).join(' ');
    check(state, content, ev, all).problems.forEach(p => problems.push(p));
    // affermazioni: ogni claim dichiarato deve stare nel bundle
    out.narrativeClaims.forEach(c => {
      if (!b.allowedClaims.some(a => a.tipo === c.tipo && norm(a.ref) === norm(c.ref))) problems.push('affermazione_non_autorizzata:' + c.tipo);
    });
    // PNG: parlano o reagiscono solo i presenti
    const presenti = b.allowedClaims.filter(a => a.tipo === 'png').map(a => norm(a.ref));
    const presente = n => { const x = norm(n); return !!x && presenti.some(p => p === x || p.split(' ').some(w => w.length > 3 && x.indexOf(w) !== -1)); };
    out.dialogueLines.forEach(d => { if (!presente(d.speaker)) problems.push('png_assente:' + d.speaker); });
    out.npcReactions.forEach(r => { if (!presente(r.npc)) problems.push('png_assente:' + r.npc); });
    // tempo: salti temporali solo se la transizione autorizzata li prevede
    const durata = b.transition ? norm(b.transition.durata) : '';
    if (TEMPO.test(all) && !/giorn|nott|settiman|mes/.test(durata)) problems.push('contraddizione_temporale');
    // il protagonista è del giocatore: niente pensieri o emozioni imposti
    if (MENTALE.test(out.narration)) problems.push('attribuzione_mentale');
    // ripetizione del testo dell'evento precedente
    const prev = (state.eventi || []).filter(e => e.n < ev.n && e.narrazione && e.narrazione.testo).slice(-1)[0];
    if (prev && simile(prev.narrazione.testo, out.narration) && norm(prev.narrazione.testo).length > 40) problems.push('ripetizione');
    // lessico non ancora sbloccato (spoiler)
    const C = global.RMSoloCampaign;
    if (C && C.lockedLexicon && C.lexiconHits) { const hits = C.lexiconHits(all + ' ' + (out.journalCandidate || '') + ' ' + (out.memoryCandidate || ''), C.lockedLexicon(state, content)); if (hits && hits.length) problems.push('spoiler'); }
    // budget del regista
    const bud = ev.regia && ev.regia.budget;
    if (bud && sentenceCount(out.narration) > bud.maxSentences + 2) problems.push('fuori_budget');
    if (bud && out.intensityLevel && out.intensityLevel > bud.emotionalIntensity + 1) problems.push('intensita_eccessiva');
    // candidati: il Diario accoglie solo ciò che il bundle autorizza
    if (out.journalCandidate && MENTALE.test(out.journalCandidate)) problems.push('diario_non_valido');
    return { ok: problems.length === 0, problems, bundle: b };
  }

  /* ------------------------------------------------------ Diario

     Sezioni richiudibili costruite dallo stato (funzione pura): obiettivi,
     indizi, decisioni e conseguenze, persone, luoghi, ferite e stati, voci,
     promesse, reputazione. Aperti all'inizio solo l'obiettivo corrente, gli
     ultimi indizi e l'ultima conseguenza; lo storico resta consultabile.
     Indizi uguali o quasi uguali compaiono una volta sola. Una voce senza
     un'etichetta leggibile non entra nel Diario: finisce in `errori`
     (mostrati solo in modalità sviluppatore). */
  const ESITI_TESTO = { successo: 'riuscito', critico: 'riuscito in pieno', parziale: 'riuscito a metà', fallimento: 'non riuscito', fallimento_critico: 'fallito del tutto' };
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function simile(a, b) {
    const A = new Set(norm(a).split(' ').filter(w => w.length > 3)), B = new Set(norm(b).split(' ').filter(w => w.length > 3));
    if (!A.size || !B.size) return norm(a) === norm(b);
    let n = 0; A.forEach(w => { if (B.has(w)) n++; });
    return n / Math.min(A.size, B.size) >= 0.8;
  }
  function dedup(list) {
    const out = [];
    list.forEach(t => { if (t && !out.some(x => simile(x, t))) out.push(t); });
    return out;
  }
  function leggibile(t) { return typeof t === 'string' && t.trim() !== '' && !/\b(undefined|null|NaN)\b|\[object Object\]/.test(t); }
  function relazioneTesto(v) { return v >= 3 ? 'fiducia piena' : v >= 1 ? 'fiducia' : v <= -3 ? 'ostilità' : v <= -1 ? 'diffidenza' : 'nessun legame particolare'; }
  function diary(state, content) {
    const E = global.RMSoloEngine;
    const errori = [];
    const add = (arr, t, dove) => { if (leggibile(t)) arr.push(t); else errori.push('Voce senza etichetta leggibile in «' + dove + '»: ' + String(t)); };
    const evs = state.eventi || [];
    const pg = state.personaggio;
    // obiettivi
    const sc = E.currentScene(state, content) || {};
    const obiettivi = [];
    add(obiettivi, 'Obiettivo personale: ' + pg.obiettivo, 'obiettivi');
    (sc.obiettivi || []).forEach(o => { const st = state.obiettivi[o.id]; add(obiettivi, (st && st.completato ? '✔ ' : '○ ') + o.testo, 'obiettivi'); });
    // indizi: note indizio + fatti scoperti, deduplicati, dal più recente
    const note = state.note || [];
    const fatti = (state.fattiScoperti || []).map(f => (content.fatti[f] || {}).testo);
    const indiziRaw = [];
    note.filter(x => x.categoria === 'indizio').forEach(x => add(indiziRaw, x.testo, 'indizi'));
    fatti.forEach(t => add(indiziRaw, t, 'fatti'));
    let indizi = dedup(indiziRaw.slice().reverse());
    const appunti = [];
    note.filter(x => (x.categoria || 'appunto') === 'appunto').forEach(x => add(appunti, x.testo, 'appunti'));
    // decisioni e conseguenze
    const decisioni = [];
    evs.forEach(e => {
      if (e.sceltaId) add(decisioni, 'Hai scelto: ' + e.sceltaTesto, 'decisione ' + e.sceltaId);
      else if (e.check && e.obiettivo) add(decisioni, e.obiettivoTesto + ': ' + (ESITI_TESTO[e.esito] || e.esito), 'obiettivo ' + e.obiettivo);
      if (e.incontroEsito) add(decisioni, 'Scontro con ' + e.nemicoNome + ': ' + ({ vittoria: 'vinto', fuga: 'sei fuggito', sconfitta: 'sconfitta', morte: 'morte', nemico_fuggito: 'il nemico è fuggito', resa: 'il nemico si è arreso' }[e.incontroEsito] || e.incontroEsito), 'scontro');
    });
    note.filter(x => x.categoria === 'cambiamento').forEach(x => add(decisioni, x.testo, 'cambiamenti'));
    ((state.memoria && state.memoria.riassunti) || []).forEach(r => add(decisioni, r.titolo + ': ' + r.testo, 'riassunti'));
    // persone: solo chi è stato incontrato, con la relazione nota
    const persone = [];
    Object.entries(state.png || {}).filter(([, v]) => v.incontrato).forEach(([k, v]) => {
      const d = content.png[k] || {};
      add(persone, d.nome + ' — ' + d.ruolo + ' (' + relazioneTesto(Number(v.atteggiamento) || 0) + ')', 'persone');
    });
    // luoghi attraversati
    const luoghi = [];
    evs.forEach(e => { const t = e.resoconto && e.resoconto.transizione; if (t) add(luoghi, t.luogoPartenza + ' → ' + t.luogoArrivo, 'luoghi'); });
    // ferite e stati persistenti
    const ferite = [];
    if (state.condizione === 'recupero') add(ferite, 'Ferito: fino al prossimo riposo', 'stati');
    if (state.ricercato) add(ferite, 'Ricercato', 'stati');
    (pg.gemme || []).filter(g => g.stato === 'scarica').forEach(g => add(ferite, g.nome + ' scarica: fino al reintegro a un avamposto', 'stati'));
    evs.forEach(e => (e.effetti || []).forEach(a => {
      if (a.tipo === 'sconfitta') add(ferite, 'Sconfitta contro ' + e.nemicoNome + ': ferito', 'ferite');
      if (a.tipo === 'forzatura') add(ferite, 'Armatura forzata: la linfa vitale si consuma', 'ferite');
      if (a.tipo === 'incoscienza') add(ferite, 'Hai perso conoscenza', 'ferite');
    }));
    // voci, promesse e minacce, reputazione
    const voci = [];
    ((state.sociale && state.sociale.voci) || []).forEach(v => add(voci, v.testo, 'voci'));
    const promesse = [];
    ((state.sociale && state.sociale.promesse) || []).forEach(p => add(promesse, p.testo + (p.stato ? ' (' + p.stato + ')' : ''), 'promesse'));
    evs.filter(e => e.tono === 'promessa' || e.tono === 'minaccia').forEach(e => add(promesse, (e.tono === 'promessa' ? 'Promessa a ' : 'Minaccia a ') + e.pngNome + ': «' + e.testo + '»', 'promesse'));
    const reputazione = [];
    Object.entries((state.sociale && state.sociale.reputazione) || {}).forEach(([k, n]) => {
      // la fazione è un nome leggibile (es. "Epizi") o una voce del catalogo
      const nome = ((content.fazioni || {})[k] || {}).nome || (/^[A-ZÀ-Ú][A-Za-zÀ-ÿ' ]+$/.test(k) ? k : null);
      if (nome) add(reputazione, nome + ': ' + (n > 0 ? 'ti stimano' : n < 0 ? 'diffidano di te' : 'neutrale'), 'reputazione');
      else errori.push('Fazione senza nome leggibile: ' + k);
    });
    // memoria improvvisata convalidata: lo stato epistemico resta visibile
    // (una testimonianza non diventa un fatto; gli effimeri non entrano)
    const mem = state.memoriaNarrativa;
    if (mem) {
      const chi = id => (content.png[id] || {}).nome || id;
      const EPI = { osservato: '', testimoniato: null, dedotto: 'Deduzione: ', ipotizzato: 'Ipotesi: ', voce: 'Si dice: ', menzogna_conosciuta: null, contraddetto: 'Smentito: ', confermato: 'Confermato: ' };
      mem.voci.filter(v => v.statoCanonico !== 'effimero' && v.visibilita !== 'nascosta').forEach(v => {
        if (v.tipo === 'testimonianza' || (v.tipo === 'rivelazione' && v.statoEpistemico === 'testimoniato')) {
          add(indiziRaw, (v.statoEpistemico === 'menzogna_conosciuta' ? chi(v.bersaglio) + ' ha detto, e sai che non è vero: «' : 'Secondo ' + chi(v.bersaglio) + ': «') + v.testo + '»', 'testimonianze');
        } else if (v.tipo === 'rivelazione' || v.tipo === 'dettaglio' || v.tipo === 'oggetto_ambiente') add(indiziRaw, (EPI[v.statoEpistemico] || '') + v.testo, 'dettagli');
        else if (v.tipo === 'conseguenza' || v.tipo === 'complicazione' || v.tipo === 'tensione') add(decisioni, v.testo + (v.causa ? ' — ' + v.causa : ''), 'conseguenze improvvisate');
        else if (v.tipo === 'relazione') add(persone, v.testo + (v.causa ? ' (' + v.causa + ')' : ''), 'relazioni');
      });
      mem.fili.filter(f => f.stato === 'aperto').forEach(f => add(obiettivi, 'Filo aperto: ' + f.titolo, 'fili'));
      mem.pngMinori.filter(x => x.persistente).forEach(x => add(persone, (x.nome ? x.nome + ' — ' : '') + x.ruolo + ' (incontro di passaggio)', 'persone di passaggio'));
      mem.luoghiInterni.filter(l => l.statoCanonico !== 'effimero').forEach(l => add(luoghi, l.luogo, 'luoghi interni'));
      indizi = dedup(indiziRaw.slice().reverse());
    }
    const dec = decisioni.slice().reverse();
    const sezioni = [
      { id: 'obiettivi', titolo: 'Obiettivi', voci: obiettivi, aperta: true, inVista: obiettivi.length },
      { id: 'indizi', titolo: 'Indizi', voci: indizi.concat(dedup(appunti.slice().reverse()).filter(a => !indizi.some(x => simile(x, a)))), aperta: true, inVista: 3 },
      { id: 'decisioni', titolo: 'Decisioni e conseguenze', voci: dec, aperta: true, inVista: 1 },
      { id: 'persone', titolo: 'Persone', voci: persone, aperta: false },
      { id: 'luoghi', titolo: 'Luoghi', voci: luoghi.slice().reverse(), aperta: false },
      { id: 'ferite', titolo: 'Ferite e stati', voci: dedup(ferite), aperta: false },
      { id: 'voci', titolo: 'Voci', voci, aperta: false },
      { id: 'promesse', titolo: 'Promesse', voci: promesse, aperta: false },
      { id: 'reputazione', titolo: 'Reputazione', voci: reputazione, aperta: false }
    ];
    return { sezioni, errori };
  }

  /* Voci tipizzate del Diario: ogni voce ha id, tipo, fonte, scena, atto,
     stato canonico (canonico | voce | narrativo), visibilità, livello di
     spoiler, date (numero d'evento), chiave di deduplicazione ed entità
     collegate. Le sezioni di diary() restano la vista a elenco; journal()
     è la stessa informazione strutturata, pura e deduplicata. I candidati
     del narratore entrano solo come "narrativo" e mai come fatti. */
  function journal(state, content) {
    const out = [];
    const nar = content.narrativa;
    const actOf = sc => { const d = nar && nar.scene && nar.scene[sc]; return d ? d.actId : null; };
    const put = (type, testo, o) => {
      if (!leggibile(testo)) return;
      const key = type + ':' + (o.chiave || norm(testo).slice(0, 80));
      const ex = out.find(x => x.deduplicationKey === key || (x.type === type && simile(x.testo, testo)));
      if (ex) { ex.updatedAt = o.evento != null ? o.evento : ex.updatedAt; return; }
      out.push({ id: 'j' + (out.length + 1), type, testo, source: o.fonte || 'motore', sceneId: o.scena || null, actId: o.scena ? actOf(o.scena) : null,
        canonicalStatus: o.stato || 'canonico', epistemicStatus: o.epistemico || 'confermato', visibility: o.visibilita || 'giocatore', spoilerLevel: o.spoiler || 'nessuno',
        createdAt: o.evento != null ? o.evento : null, updatedAt: o.evento != null ? o.evento : null, deduplicationKey: key, relatedEntityIds: o.entita || [] });
    };
    const evs = state.eventi || [];
    (state.veritaScoperte || []).forEach(v => {
      const d = nar && nar.scene && nar.scene[v.scena];
      const t = d && d.requiredTruths.find(x => x.id === v.id);
      if (!t || (t.journalPolicy && t.journalPolicy.visibilita !== 'giocatore')) return;
      put((t.journalPolicy && t.journalPolicy.tipo) || 'indizio', t.canonicalContent, { chiave: v.id, scena: v.scena, evento: v.evento, fonte: v.metodo, stato: 'proposta', epistemico: /^png:/.test(t.allowedSources[0] || '') ? 'testimoniato' : v.metodo === 'deduzione' ? 'dedotto' : 'osservato', spoiler: t.spoilerLevel, entita: t.allowedSources.filter(x => /^png:/.test(x)).map(x => x.slice(4)) });
    });
    (state.fattiScoperti || []).forEach(f => put('fatto', (content.fatti[f] || {}).testo, { chiave: f }));
    evs.forEach(e => {
      if (e.sceltaId) put('decisione', 'Hai scelto: ' + e.sceltaTesto, { chiave: e.sceltaId, scena: e.scena, evento: e.n });
      if (e.incontroEsito) put('conseguenza', 'Scontro con ' + e.nemicoNome + ': ' + ({ vittoria: 'vinto', fuga: 'sei fuggito', sconfitta: 'sconfitta', morte: 'morte', nemico_fuggito: 'il nemico è fuggito', resa: 'il nemico si è arreso' }[e.incontroEsito] || e.incontroEsito), { scena: e.scena, evento: e.n });
      if (e.tono === 'promessa' || e.tono === 'minaccia') put(e.tono, (e.tono === 'promessa' ? 'Promessa a ' : 'Minaccia a ') + e.pngNome + ': «' + e.testo + '»', { scena: e.scena, evento: e.n, entita: e.png ? [e.png] : [] });
      const t = e.resoconto && e.resoconto.transizione;
      if (t) put('luogo', t.luogoArrivo, { scena: e.scena, evento: e.n });
      (e.effetti || []).forEach(a => { if (a.tipo === 'sconfitta') put('ferita', 'Sconfitta contro ' + e.nemicoNome, { scena: e.scena, evento: e.n }); });
      const c = e.narrazione && e.narrazione.candidati;
      if (c && c.diario) put('annotazione', c.diario, { scena: e.scena, evento: e.n, stato: 'narrativo', fonte: 'narratore' });
    });
    ((state.sociale && state.sociale.voci) || []).forEach(v => put('voce', v.testo, { stato: 'voce', epistemico: 'voce' }));
    // memoria improvvisata: stato canonico e stato epistemico separati
    const mem = state.memoriaNarrativa;
    if (mem) mem.voci.filter(v => v.statoCanonico !== 'effimero').forEach(v => put(v.tipo, v.testo, { chiave: 'mem:' + v.id, scena: v.scena, evento: v.evento, fonte: v.fonte, stato: v.statoCanonico, epistemico: v.statoEpistemico, visibilita: v.visibilita, entita: v.bersaglio ? [v.bersaglio] : [] }));
    Object.entries(state.png || {}).filter(([, v]) => v.incontrato).forEach(([k, v]) => { const d = content.png[k] || {}; put('persona', d.nome + ' — ' + d.ruolo, { chiave: k, entita: [k] }); });
    return out;
  }

  global.RMSoloFeedback = { journal, bundle, NARRATOR_OUTPUT, FUNZIONI_BATTUTA, parseOutput, checkContract, sentenceCount, RISERVA_VARIANTI, regiaText, narrativeContext, contextText, causes, uncovered, diary, leggibile, dedup, simile, RISERVA, riservaDi, build, fallback, pick, payload, payloadText, check, maxSentences, dialogico, rispostaPng, COMPORTAMENTI, trimSentences, bonusText };
})(typeof window !== 'undefined' ? window : globalThis);
