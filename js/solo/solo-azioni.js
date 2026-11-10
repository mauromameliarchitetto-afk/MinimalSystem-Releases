/* Azioni aperte del giocatore: analisi del messaggio (parte detta / parte agita), intento, bersaglio, mezzo, condizioni.
   Nessuna storia qui dentro: i passi di scena che un'azione può aprire stanno nei contenuti (interazioni.scene.<id>.passi, vedi
   docs/single-player/TRAMA_NEL_GIOCO.md §8). Il tiro e gli effetti li decide il motore (RMSoloEngine, azioneAperta) con le regole esistenti.
   analizza() ritorna null se il messaggio non contiene un'azione riconoscibile (resta il percorso di sempre). */
(function (global) {
  'use strict';
  const E = () => global.RMSoloEngine;

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* Tipi di atto: radici dei verbi (testo normalizzato) e tratti delle regole (TRAIT_LISTS di js/data.js) adatti, in ordine di preferenza. */
  const ATTI = {
    esaminare: { re: /\b(esamin|osserv|guard(?:o|are|arl\w*|ando|iamo)\b|scrut|controll|ispezion|valut|studi|analizz|compren|capire|informazion|natura d|diagnos|ausculta|tasto|palpo)/, tratti: ['Percezione', 'Intuito Olfattivo', 'Guarigione'] },
    curare: { re: /\b(curo\b|curar|prend\w* cura d|(?<!\b(?:il|un|del|al|dal|nel|col|lo|un) )medic(?:o|hiamo)\b|cural[oaie]|guar[ir]|fasci|bend|medicar|steril|disinfett|soccors|stabilizz|immobilizz|ricompong|rimett\w* a posto|sistem\w*( \w+)? (la|il|le|lo|gli|l) ?\w*(spall|brac|gamb|ferit|oss|polso|cavigli|ginocch|schien|costol|dit|mano|piede|testa|ginocchio)|riduc\w* (la|il)\s*(lussazion|frattur))/, tratti: ['Medicina', 'Guarigione'] },  // cura: solo tratti di cura, mai Percezione
    riparare: { re: /\b(ripar|aggiust|salda\b|rattoppa|risistem|sistem|rimett\w* in sesto)/, tratti: ['Riparare', 'Meccanica'] },
    convincere: { re: /\b(convin|persuad|rassicur|tranquillizz|calmo|calmar|ragion|negozi|tratto con)/, tratti: ['Persuasione', 'Contrattazione'] },
    // «intimo di…», «afferro X per il bavero»; «spavento / provoco» in prima persona (non «spaventata», «provocato»: descrivono, non agiscono)
    intimidire: { re: /\b(minacc|intimid|intim[oa] (?=a |di |al |alla |che )|costring|spavent(?:o|arl\w*|are)\b|provoc(?:o|arl\w*|are)\b|(?:afferr|agguant|stratton|prend)\w*\s+(?:\S+\s+){0,3}per (?:il bavero|il colletto|la collottola|il collo|la gola))/, tratti: ['Intimidire', 'Provocare'] },
    // PROPOSTA DA APPROVARE (atti nuovi, 4/11/2026): salire, arrampicarsi, scavalcare; accendere un fuoco o allestire un riparo.
    // Cercato in js/data.js (TRAIT_LISTS: Scalare, Free Running, Sopravvivenza) e fra gli atti esistenti: non c'erano. Tratti esistenti, nessuna regola nuova.
    // un tratto per atto, scelto dall'azione e non il più alto (5/11/2026): arrampicarsi, salire su ciò che va scalato, calarsi → Scalare;
    // saltare, prendere lo slancio → Free Running. Salire le scale, in macchina o su un carro: nessuna prova.
    // PROPOSTA DA APPROVARE (5/11/2026): scavalcare segue il movimento dichiarato. Di slancio, con un salto o un ostacolo basso (muretto,
    // staccionata, ringhiera…) → Free Running; altrimenti (muro, cancello, recinzione, o nulla di detto) si sale per passare → Scalare.
    scalare: { re: /\b(arrampic|mi arrampic|scal[oa] (?!le scale)|scalare|risalgo|mi iss|issarmi|mi calo|calarmi|scavalc|(?:salgo|salire|scendo|scendere) (?:sul|sulla|sui|sugli|sullo|dal|dalla|dai|dagli|in cima (?:al|alla|a)|fin sopra (?:il|la|al|alla)|lungo (?:il|la))\s+(?:\S+\s+){0,2}(?:tetto|tetti|muro|mura|parete|albero|alberi|ramo|rami|torre|recinzion|cornicion|roccia|rocce|scoglier|impalcatur|palo|tralicc|trave|bastion|campanil|grondaia|facciata|rupe|falesia))/, tratti: ['Scalare'] },
    saltare: { re: /\b(salto (?:giu|oltre|sul|sulla|sui|dal|dalla|dentro|fuori|da un|da una|verso|il|la)|saltare|con un salto|prendo (?:la )?rincorsa|prendo lo slancio|mi lancio (?:giu|oltre|verso)|scavalc\w*\s+(?:\S+\s+){0,4}?(?:con un salto|con un balzo|di slancio|al volo|in corsa|volteggi)|scavalc\w*\s+(?:il |la |lo |l'|i |gli |le |un |una |quel |quella )?(?:muretto|staccionat|ringhier|transenn|bancone|tavol|steccat|sbarr|cassa|casse))/, tratti: ['Free Running'] },
    sopravvivere: { re: /\b(accend\w*\s+(?:un |il |del |un piccolo )?(?:fuoco|falo)|bivacc|preparo (?:un )?riparo|costruisco (?:un )?riparo|monto il campo)/, tratti: ['Sopravvivenza'] },
    // nascondersi è il personaggio che si nasconde («mi nascondo», «nascondiamoci»): nascondere un oggetto («nascondo la zanna») non ha un
    // tratto proprio nel manuale e non diventa Furtività da solo (4/11/2026)
    nascondersi: { re: /\b(al riparo|al coperto|mi riparo|ripararmi|ripariamoci|(mi|ci|ti|vi) nascond|nasconder(mi|ci|ti|vi)\b|nascondiamoci|nasconditi|mimetizz|cerco riparo|mi apposto|mi acquatt|resto immobil|sgattaiol|mi muovo senza)/, tratti: ['Furtività'] },
    // spostarsi: senza un passo o un obiettivo della scena non chiede un tiro (RMSoloEngine.azioneAperta)
    muoversi: { re: /\b(esco\b|uscire\b|scappo\b|scappare\b|fuggo\b|fuggire\b|me ne vado\b|mi allontano\b|mi sposto\b|(?:vi |ti |li |lo |la |le )seguo\b(?! con)|seguo (?!il |lo |la |le |gli |i |l'|con |un |una )\w+|raggiungo\b|torno (?:indietro|a |al |alla |da )|vado (?:via|verso|a |al |alla |da ))/, tratti: [] },
    cercare: { re: /\b(cerc[oa]\b|cercar|frug|perquisi|rovist|setacci|passo in rassegna|segui\w* le tracce|seguo le tracce)/, tratti: ['Percezione', 'Seguire Tracce'] },
    forzare: { re: /\b(forz[oa]\b|forzar|scass|sfond|abbatt|apro (la|il|lo)|spacc)/, tratti: ['Scassinare', 'Arte Combattiva'] },
    manipolare: { re: /\b(leg[oa]\b|legar|tend[oi]\b|spost[oi]\b|sollev|giro\b|ruoto|spingo|attivo|accendo|smonto|monto|premo|chiudo|apro\b|aggancio|sgancio|infilo|incastro|svito|avvito)/, tratti: ['Riparare', 'Meccanica', 'Scalare'] },
    hackerare: { re: /\b(hack|viol[oa]\b|decifr|manomett|aggir|bypass|accedo al)/, tratti: ['Hacking'] }
  };
  // atti che riguardano sempre una persona: senza un nome nella frase, il bersaglio è il PNG nominato altrove nel messaggio
  // (esaminare no: «intanto leggo le spie» riguarda le spie, non chi ti sta parlando)
  const PERSONA = ['curare', 'convincere', 'intimidire'];
  const ORDINE = { esaminare: 0, cercare: 0 };
  const ARTICOLI = /^(un|una|uno|il|lo|la|le|gli|i|di|del|della|dello|dei|delle|degli|d|l|alcun\w*|qualche|nessun\w*)$/;

  const tratti = atto => (ATTI[atto] || { tratti: [] }).tratti.slice();
  /* Tratto della scheda (chiave esatta) che corrisponde al nome scritto dal giocatore; altrimenti il nome scritto, con l'iniziale maiuscola. */
  function chiaveScheda(sheet, nome) {
    const n = norm(nome).trim();
    if (!n) return null;
    const liste = (sheet && sheet.traits) || {};
    for (const l of ['conoscenze', 'capacitaNormali', 'capacitaCombattive']) {
      const k = Object.keys(liste[l] || {}).find(x => norm(x) === n);
      if (k) return k;
    }
    return cap(String(nome).trim());
  }
  /* Tratto per la prova: quello nominato dal giocatore, altrimenti il migliore della scheda fra i candidati (senza competenza, il primo). */
  function scegliTratto(sheet, nominato, candidati) {
    if (nominato) return chiaveScheda(sheet, nominato);
    const R = global.RMSoloRules;
    let best = null, bv = 0;
    (candidati || []).forEach(c => { const tv = R && R.traitValue(sheet, c); if (tv && tv.value > bv) { bv = tv.value; best = c; } });
    return best || (candidati || [])[0] || null;
  }

  /* Il nome del tratto in «tiro di X…»: il prefisso più lungo che è un tratto della scheda o delle liste delle regole, altrimenti la prima parola. */
  function nomeTratto(state, frase) {
    const parole = String(frase).trim().split(/\s+/).slice(0, 3);
    const noti = ((typeof TRAIT_LISTS !== 'undefined' && TRAIT_LISTS) ? Object.values(TRAIT_LISTS).reduce((a, l) => a.concat(l), []) : []).concat(
      ['conoscenze', 'capacitaNormali', 'capacitaCombattive'].reduce((a, l) => a.concat(Object.keys((((state.personaggio || {}).traits || {})[l]) || {})), [])).map(norm);
    for (let n = parole.length; n >= 1; n--) { const c = parole.slice(0, n).join(' '); if (noti.indexOf(norm(c)) !== -1) return c; }
    return parole[0];
  }
  // l'atto che compare per primo; a parità di posizione il più specifico («accendo un fuoco» prima di «accendo»)
  function primo(t) {
    let migliore = null;
    Object.keys(ATTI).forEach(k => { const m = ATTI[k].re.exec(t); if (m && (!migliore || m.index < migliore.i || (m.index === migliore.i && m[0].length > migliore.n))) migliore = { k, i: m.index, n: m[0].length }; });
    return migliore;
  }
  const INTENTO = /\b(?:provo|tento|cerco|voglio|mi metto|inizio|comincio)\s+(?:a|ad|di)\s+/;
  const AUSILIARE = /\b(?:ho|hai|ha|abbiamo|avevo|avevamo)\s+(?:(?:gia|sempre|spesso|mai|anche|piu volte)\s+)*$/;
  /* Atto di una frase e se racconta il passato. L'intenzione dichiarata («provo a ripararle», «cerco di convincerlo») vale più del primo
     verbo della frase («controllo le maglie… e provo a ripararle»); «ho già riparato macchine come questa» è un fatto passato, non un'azione. */
  function attoDi(clausola) {
    // ciò che il giocatore rifiuta («senza raccoglierlo», «non lo attacco») non è un atto (RMSoloEngine.senzaNegati)
    const t = norm(E() && E().senzaNegati ? E().senzaNegati(clausola) : clausola);
    const im = INTENTO.exec(t);
    const dopo = im ? primo(t.slice(im.index + im[0].length)) : null;
    // «cerco di non finire in mare»: «cerco» è solo l'intenzione, non l'atto di cercare; si guarda il resto della frase
    const m = dopo ? { k: dopo.k, i: im.index + im[0].length + dopo.i } : primo(im ? t.slice(0, im.index) + ' '.repeat(im[0].length) + t.slice(im.index + im[0].length) : t);
    // «la uso» da solo è un atto generico; se la frase dice a che scopo (curare, riparare…) vale quello
    if (!m) return /\b(uso|usa|utilizz|impieg|adoper)/.test(t) ? { k: 'usare', passato: false } : null;
    return { k: m.k, passato: AUSILIARE.test(t.slice(0, m.i)) };
  }
  function atto(clausola) { const a = attoDi(clausola); return a ? a.k : null; }

  /* Che cosa possiede il personaggio che somigli a «X» (tutte le parole significative devono comparire nel nome). */
  function possiede(state, content, x) {
    const parole = norm(x).split(/[^a-z]+/).filter(w => w.length > 1 && !ARTICOLI.test(w));
    if (!parole.length) return null;
    const pg = state.personaggio || {};
    const nomi = [];
    (state.inventario || []).forEach(i => { const info = E().itemInfo(state, content, i.id); if (info && i.qty > 0) nomi.push({ nome: info.nome, id: i.id, info }); });
    (pg.gemme || []).forEach(g => nomi.push({ nome: g.nome + ' ' + (g.capacitaAssociata || ''), vero: g.nome, gemma: g }));
    (pg.equip || []).forEach(e => nomi.push({ nome: e.nome, vero: e.nome }));
    const rad = w => w.slice(0, 5);
    return nomi.find(n => { const h = norm(n.nome).split(/[^a-z]+/).map(rad); return parole.every(p => h.indexOf(rad(p)) !== -1); }) || null;
  }

  /* PNG a cui è rivolta un'azione: per nome (presenti nella scena o con cui si può parlare), o col pronome durante un dialogo. */
  // atti che di solito riguardano una cosa: «ripararle», «forzarla» non indicano chi ti sta parlando, salvo che la frase parli del corpo
  const SU_OGGETTI = ['riparare', 'forzare', 'manipolare', 'cercare', 'hackerare', 'scalare', 'saltare', 'sopravvivere'];
  const CORPO = /\b(ferit|spall|gamb|brac|polso|cavigli|ginocch|schien|costol|testa|male\b|dolor|sangu)/;
  const NON_NOME = /^(il|lo|la|i|gli|le|l|un|uno|una|tuo|tua|tuoi|tue|mio|mia|suo|sua)$/;
  const DI_PERSONA = /^(cura|occup\w*|fid\w*|bisogno|approfitt\w*|vendic\w*|preoccup\w*)$/;
  function pngDi(state, content, io, clausola, attoClausola) {
    const t = norm(clausola);
    const sc = (E().currentScene && E().currentScene(state, content)) || {};
    const ids = (sc.png_presenti || []).concat((io && io.dialoghi || []).map(d => d.png)).filter((x, i, a) => a.indexOf(x) === i);
    // la parola con cui lo si chiama, non l'articolo o il possessivo («Lo spettro» → spettro, «Tuo padre» → padre)
    const nome = id => norm(((content.png || {})[id] || {}).nome || '').split(/[\s']+/).find(w => w && !NON_NOME.test(w)) || '';
    // «la zanna di Ivor»: Ivor possiede la cosa, non è il bersaglio; lo è con il corpo o una ferita («la spalla di Sidd») o con «cura di», «mi fido di»…
    const possessore = n => { const m = new RegExp('(\\S+)\\s+(?:di|del|della|dello|dei|degli|delle)\\s+' + n + '\\b').exec(t); return !!m && !CORPO.test(m[1]) && !DI_PERSONA.test(m[1]); };
    // il bersaglio è chi l'atto riguarda, non il primo nome della frase (5/11/2026, registro della prova: «Mi congedo da Argus e osservo
    // lo stormo» non è esaminare Argus). Si cerca il verbo dell'atto: vale il primo PNG nominato dopo il verbo; uno nominato prima vale solo
    // se il verbo lo riprende con un pronome («Astrid, ti afferro…», «Dimitri, cerco di convincerlo»). Anche i nomi di due lettere («Er»).
    const v = attoClausola && ATTI[attoClausola] ? ATTI[attoClausola].re.exec(t) : null;
    const vi = v ? v.index : 0;
    const parolaVerbo = t.slice(vi).split(/\s+/)[0] || '';
    const primaDelVerbo = t.slice(0, vi).trim().split(/\s+/).slice(-2).join(' ');
    // pronome legato al verbo: subito prima («ti afferro», «lo scuoto») o attaccato («convincerlo», «afferrandola»), non l'articolo di «lo stormo»
    const pronome = /(^|\s)(ti|lo|la|li|le|gli|vi|glielo|gliela)$/.test(primaDelVerbo) || /.{3}(rlo|rla|rli|rle|rgli|rti|ndolo|ndola|ndogli|ndoti)$/.test(parolaVerbo);
    // anche per descrizione («l'ombra» per lo spettro, aliasPng), non con un possessivo davanti («la mia ombra»)
    const trova = (id, n, alias) => { const m = n.length >= 2 ? new RegExp((alias ? '(?<!\\b(?:mia|mio|tua|tuo|sua|suo) )' : '') + '\\b' + n + '\\b').exec(t) : null; return m && !possessore(n) ? { id, i: m.index } : null; };
    const candidati = ids.map(id => [trova(id, nome(id))].concat(aliasPng(state, content, id).map(a => trova(id, a, true))).filter(Boolean).sort((a, b) => a.i - b.i)[0])
      .filter(Boolean).sort((a, b) => a.i - b.i);
    const dopo = candidati.find(c => c.i >= vi);
    if (dopo) return dopo.id;
    const prima = candidati.filter(c => c.i < vi).pop();
    if (prima && (pronome || !v)) return prima.id;
    const dlg = state.interazione && state.interazione.dialogo;
    const suOggetto = SU_OGGETTI.indexOf(attoClausola) !== -1 && !CORPO.test(t);
    // a dialogo aperto, senza nomi: l'interlocutore è il bersaglio se il verbo lo riprende o se la frase parla di lui (suo, lui, lei)
    if (dlg && !suOggetto && !prima && (pronome || /\b(suo|sua|suoi|sue|lui|lei)\b/.test(t))) return dlg;
    return null;
  }

  /* Come la scena chiama un PNG oltre al nome: `alias` nei dati del PNG, se c'è, e il soggetto con cui il testo d'autore del suo dialogo
     in questa scena lo nomina (apertura, chiusura, risposta libera: «L'ombra nera è ancora alla finestra…» → ombra). Nessun nome inventato. */
  function aliasPng(state, content, id) {
    const p = ((content || {}).png || {})[id] || {};
    const art = s => norm(s).trim().replace(/^(?:il|lo|la|i|gli|le)\s+|^l'/, '');
    const out = [].concat(p.alias || []).map(art).filter(a => a.length >= 3);
    const def = state && E() && E().sceneInteractions ? E().sceneInteractions(content, state.scena) : null;
    const d = def && (def.dialoghi || []).find(x => x.png === id);
    if (d) {
      const sogg = [d.apertura, d.chiusura, d.riserva_libera].map(x => /^(?:(?:il|lo|la|i|gli|le)\s+|l')([a-z]{3,})\b/.exec(norm(x).trim())).filter(Boolean).map(m => m[1]);
      sogg.forEach(w => { if (sogg.filter(x => x === w).length >= 2 && out.indexOf(w) === -1) out.push(w); });
    }
    const n = norm(p.nome).split(/[\s']+/).find(w => w && !NON_NOME.test(w)) || '';
    return out.filter(a => a !== n);
  }

  /* Un pensiero del personaggio o una disposizione per il futuro non è un atto di adesso né una battuta: resta stato d'animo
     (lo legge il Narratore nel messaggio intero, testoGiocatore). «Pensiero del mio personaggio: …» vale fino a fine riga. */
  const PENSIERO = /(?:^|\n)[ \t]*\(?[ \t]*(?:pensiero|pensieri|penso tra me|penso fra me|pensa tra s[eé]|pensa fra s[eé]|tra me e me|fra me e me|dentro di me)\b[^\n]*/gi;
  const DISPOSIZIONE = /\b(?:da ora in poi|d'ora in poi|da ora in avanti|d'ora in avanti|da adesso in poi|da questo momento in poi)\b/i;

  /* Divide il messaggio: parti fra virgolette (dette), frasi di parola (domande, «dico…», «chiedo…»), frasi d'azione e pensieri.
     Ogni riga è una frase a sé, anche senza punto (testo su più righe: domanda, pagamento, azione). */
  function clausole(testo) {
    const dette = [], pensieri = [];
    const resto = String(testo || '').replace(PENSIERO, m => { pensieri.push(m.trim()); return '\n'; })
      .replace(/[«"“]([^»"”]+)[»"”]/g, (m, d) => { dette.push(d.trim()); return ' '; });
    const parti = [];
    resto.split(/(?<=[.!;?])\s+|\s*\n\s*/).forEach(frase => {
      if (DISPOSIZIONE.test(frase)) { pensieri.push(frase.trim()); return; }
      let alt = false;
      frase.split(/\s*,?\s*(?=\b(?:oppure|altrimenti|poi|e poi|e se|se non|e intanto|intanto|nel frattempo|mentre)\b)|,\s+/i).forEach(c => {
        const pulita = c.replace(/^\s*(e|ma|poi)\s+/i, '').trim();
        if (!pulita) return;
        const isAlt = /^(oppure|altrimenti|se non)\b/i.test(c.trim()) || /^(oppure|altrimenti)\b/i.test(pulita);
        parti.push({ testo: pulita.replace(/^(oppure|altrimenti)\s+/i, ''), alt: alt || isAlt, domanda: /\?\s*$/.test(c) });
        if (isAlt) alt = true;
      });
    });
    return { dette, parti, pensieri };
  }
  const PAROLA = /^\s*(dico|dici|chiedo|domando|rispondo|rispondi|gli dico|le dico|gli chiedo|le chiedo|dimmi|ascolta|parlo|ti dico|vi dico|saluto)\b/;

  // proposte e desideri: si dicono a qualcuno, nessuno ha ancora fatto niente («Propongo di uscire», «Vorrei uscire di qui»)
  const PROPOSTA = /\b(vorrei|dovrei|potrei|propongo|suggerisco|che ne dici|che ne pensi|ti va|vi va|possiamo|dovremmo|potremmo)\b/;

  function analizza(state, content, testo, io) {
    const { dette, parti, pensieri } = clausole(testo);
    const passi = [];
    const detto = dette.slice();
    // frasi senza un atto né parole («Gli do le tre monete», «prego raccontatemi la storia»): gesti verso chi ascolta, vanno con la battuta
    const gesti = [];
    let condOk = false;
    parti.forEach(p => {
      // «Dico a X:» davanti a una frase fra virgolette è solo l'introduzione: la battuta è la frase
      if (p.domanda || PAROLA.test(norm(p.testo)) || PROPOSTA.test(norm(p.testo))) { if (!dette.length || p.domanda || PROPOSTA.test(norm(p.testo))) detto.push(p.testo); return; }
      const ai = attoDi(p.testo);
      // un'azione raccontata al passato («ho già riparato macchine come questa») è una cosa detta, non un tentativo di adesso
      if (ai && ai.passato) { detto.push(p.testo); return; }
      let a = ai && ai.k;
      // «cerco mio fratello…» è una frase detta a qualcuno, non una ricerca nel luogo
      if (!a || (a === 'cercare' && /\b(cerc\w*)\s+(il |la |lo |mio |mia |un |una )?(ragazz|uomo|donna|compagn|fratell|sorell|persona|qualcuno|figli|padre|madre|amic)/.test(norm(p.testo)))) { gesti.push(p.testo); return; }
      const t = norm(p.testo);
      const dopo = /\b(se (e|risulta|si tratta|fosse|sia|trovo|scopro|capisco|non e)|una volta|quando|dopo (aver|che))\b/.test(t) && !/\bse (ho|possiedo|dispongo)\b/.test(t);
      const cm = /\bse (?:ho|hai|possiedo|dispongo di|ho ancora|c'e|ci sono)\s+(.+?)(?=\s+(?:la|lo|li|le|l')\s*(?:uso|utilizz|impieg|adoper)|\s+(?:ma|oppure|altrimenti|e poi|per)\b|,|$)/.exec(t);
      let cond = null;
      const usa = /\b(uso|usa|utilizz|impieg|adoper)/.test(t);
      if (cm && (usa || !/\bse (?:c'e|ci sono)\b/.test(cm[0]))) { const x = possiede(state, content, cm[1]); cond = { testo: cm[1].trim(), ok: !!x, oggetto: x }; }
      const tr = /\btiro (?:di|con|in|su)\s+([a-z' ]+?)(?=\s+(?:a|per|e|che|se|su|di)\b|[,.;]|$)/.exec(t);
      const png = pngDi(state, content, io, p.testo, a) || (PERSONA.indexOf(a) !== -1 ? pngDi(state, content, io, testo, a) : null);
      // «sistemargli ciò che gli fa male»: su una persona, riparare è curare
      if (a === 'riparare' && png && /\b(gli|le|lo|la|lui|lei)\b|(rgli|rle|rlo|rla)\b/.test(t)) a = 'curare';
      passi.push({ atto: a, testo: p.testo, png, tratto: tr ? nomeTratto(state, tr[1]) : null, cond, alt: p.alt, dopo });
    });
    // solo pensieri e parole: nessuna azione, ma il pensiero non va detto a nessuno
    if (!passi.length) return pensieri.length ? { detto: detto.join(' ').trim(), gesti, pensieri, da: null, mancanti: [], restanti: [], passi: [] } : null;
    // alternative («oppure…») scartate se un ramo con condizione soddisfatta è già stato scelto
    const validi = passi.filter(p => {
      if (p.cond && p.cond.ok) condOk = true;
      return !(p.alt && condOk && !(p.cond && p.cond.ok));
    });
    const mancanti = validi.filter(p => p.cond && !p.cond.ok);
    const eleggibili = validi.filter(p => !(p.cond && !p.cond.ok));
    // prima capire, poi agire; ciò che dipende dall'esito viene dopo
    const rango = p => (p.dopo ? 2 : (ORDINE[p.atto] != null ? ORDINE[p.atto] : 1));
    const ordinati = eleggibili.map((p, i) => ({ p, i })).sort((a, b) => rango(a.p) - rango(b.p) || a.i - b.i).map(x => x.p);
    if (!ordinati.length) return { detto: detto.join(' '), gesti, pensieri, da: null, mancanti: mancanti.map(m => m.cond.testo), restanti: [], passi: validi };
    return { detto: detto.join(' ').trim(), gesti, pensieri, da: ordinati[0], mancanti: mancanti.map(m => m.cond.testo), restanti: ordinati.slice(1).map(p => p.testo), detto_prima: !!detto.length && (dette.length ? String(testo).search(/[«"“]/) : 0) < String(testo).indexOf(ordinati[0].testo) };
  }

  global.RMSoloAzioni = { analizza, atto, attoDi, tratti, scegliTratto, chiaveScheda, possiede, aliasPng, ATTI };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloAzioni;
})(typeof window !== 'undefined' ? window : globalThis);
