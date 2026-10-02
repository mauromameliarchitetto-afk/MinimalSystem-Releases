/* ==========================================================================
   Role Makers — Gioca in solitaria: moderazione locale (regole di prodotto,
   specifica V3 §7). Funzioni pure, nessuna rete.

   Separazione dei passaggi (§7.4): questo modulo INTERPRETA e CLASSIFICA
   il testo del giocatore e restituisce un verdetto strutturato
   (categoria, attore, intenzione, contesto, confidenza, riferimento). Non
   applica mai conseguenze: le decide il motore (solo-engine.js), che
   verifica le condizioni (ordini registrati, stato della partita) e usa
   solo verdetti di confidenza "alta" per le sanzioni definitive.

   È un classificatore a regole, non un giudice infallibile: riconosce
   formulazioni esplicite in italiano e sbaglia su perifrasi, ironia,
   ortografia creativa. Nel dubbio non sanziona: chiede un chiarimento e
   blocca l'azione (§7.4). I limiti noti sono elencati in
   docs/single-player/MODERAZIONE.md e coperti da test positivi e negativi.

   L'output dell'IA narratrice, il testo degli oggetti e le battute dei
   PNG non passano mai da qui come prova contro il giocatore: il motore
   chiama classifyPlayerText solo sul messaggio scritto dal giocatore.
   ========================================================================== */
(function (global) {
  'use strict';

  const POLICY_VERSION = 'mod-0.1-bozza';

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Porzioni tra virgolette: una citazione o la battuta di qualcun altro
     non è un'intenzione del giocatore. */
  function stripQuoted(t) {
    return t.replace(/"[^"]*"|«[^»]*»|“[^”]*”/g, ' [citazione] ');
  }
  function hasQuoted(t) { return /"[^"]*"|«[^»]*»|“[^”]*”/.test(t); }

  function sentences(t) { return t.split(/[.!?;\n]+/).map(s => s.trim()).filter(Boolean); }

  // --- violenza sessuale: forme esplicite (non "violento" aggettivo)
  const SV = [
    /\bstupr(are|arla|arlo|arli|arle|o|a|i|ano|ando|ata|ato)\b/,
    /\bviolentar(e|la|lo|li|le)\b/,
    /\b(la|lo|li|le) violent(o|a|iamo|ano)\b/,
    /\b(abus\w*|molest\w*|aggred\w*|violent\w*) sessualmente\b/,
    /\bviolenza sessuale\b/,
    /\bcostring\w* [^.]{0,40}\b(sesso|rapporti? sessual\w*|atti sessual\w*)\b/,
    /\b(approfitt\w*) (sessualmente )?di (lei|lui|loro) (mentre|che) (dorme|e' svenut\w*|e' incoscient\w*)\b/
  ];

  // --- crudeltà: gesti efferati + vittima non minacciosa o gratuità
  const HARM = [
    /\btortur\w*/, /\bmutil\w*/, /\bsgozz\w*/, /\bscortic\w*/, /\bsevizi\w*/,
    /\bcav\w* (gli|l') occh\w*/, /\bbrucia\w* viv[oaie]\b/,
    /\btagli\w* (le dita|la lingua|le orecchie|il naso|la gola|le mani|i piedi)\b/,
    /\bgli taglio\b/, /\ble taglio\b/,
    /\b(uccid|ammazz|giustizi|massacr|trucid)\w*/,
    /\bpicchi\w* a morte\b/, /\bprend\w* a calci\b/
  ];
  // vittime chiaramente non minacciose (bastano con un'uccisione)...
  const DEFENSELESS_STRONG = /\b(arres[oaie]|legat[oaie]|prigionier\w*|inerm\w*|bambin\w*|neonat\w*|in ginocchio|supplic\w*|implor\w*|svenut[oaie]|addormentat[oaie]|incoscient\w*)/;
  // ...e indizi più deboli (servono una tortura o un segno di gratuità)
  const DEFENSELESS = /\b(arres[oaie]|legat[oaie]|prigionier\w*|inerm\w*|disarmat\w*|bambin\w*|neonat\w*|civil[ie]\b|in ginocchio|supplic\w*|implor\w*|ferit[oaie] a terra|svenut[oaie]|addormentat[oaie]|incoscient\w*)/;
  const SEVERE = /tortur|mutil|scortic|sevizi|sgozz|cav\w* (gli|l') occh|brucia\w* viv|tagli/;
  const GRATUITOUS = /\b(per divertimento|per gioco|per piacere|per noia|solo per|per sfizio|anche se (ha gia'|si e' arres|non (e'|era|rappresenta))|senza motivo|gratuitamente)\b/;

  // --- attore: il giocatore parla del proprio personaggio in prima
  // persona o lo nomina; un soggetto diverso resta di un PNG.
  const FIRST_PERSON = /\b(io|provo|tento|cerco|voglio|inizio|comincio|decido|vado|mi avvicino|il mio personaggio|il mio pg|lo faccio|la faccio|gli|le)\b|\b\w+(o|isco)\b(?= (a|di|la|lo|li|le|gli|il|i|un|una)\b)/;
  const THIRD_PERSON_SUBJECT = /\b(un|il|lo|la|quel|quella|questo|questa|uno) (soldato|sergente|tenente|capitano|uomo|donna|mercenario|bandito|guardia|png|nemico|tipo|caporale|medico)\b[^.]{0,40}\b(sta|stava|tenta|cerca|prova|vuole|inizia)\b/;
  const NEGATION = /\b(non|mai|nessun\w*|senza|evito|rifiuto|mi rifiuto)\b/;
  const PROTECTIVE = /\b(impedi\w*|ferm\w*|salv\w*|protegg\w*|difend\w*|denunci\w*|indag\w*|accus\w*|arrest\w*|soccorr\w*|aiut\w*|rapporto|testimon\w*|scopr\w*|ricord\w*|racconta\w*|leggo|legge|chiedo|domando|interrog\w*)/;

  function sentenceFor(textNorm, re) {
    for (const s of sentences(textNorm)) { const m = s.match(re); if (m) return { s, m }; }
    return null;
  }

  function precededByNegation(s, idx) {
    const before = s.slice(Math.max(0, idx - 45), idx);
    return NEGATION.test(before);
  }

  function actorFor(s, idx, charName) {
    const before = s.slice(0, idx);
    const nameRe = charName ? new RegExp('\\b' + norm(charName).replace(/[^a-z0-9 ]/g, '') + '\\b') : null;
    if (THIRD_PERSON_SUBJECT.test(before)) return 'png';
    if (nameRe && nameRe.test(before)) return 'giocatore';
    if (FIRST_PERSON.test(before) || FIRST_PERSON.test(s.slice(idx, idx + 30))) return 'giocatore';
    return 'incerto';
  }

  /* Verdetto strutturato sul messaggio del giocatore.
     { categoria: 'nessuna'|'violenza_sessuale'|'crudelta_gratuita'|'ambiguo',
       attore, intenzione, contesto, confidenza: 'alta'|'bassa', bersaglio,
       riferimento (porzione di testo, mai riprodotta nel racconto),
       policy } */
  function classifyPlayerText(text, ctx) {
    const charName = ctx && ctx.charName;
    const raw = norm(text);
    const quotedOnly = stripQuoted(raw);
    const base = { policy: POLICY_VERSION, categoria: 'nessuna', attore: 'nessuno', intenzione: null, contesto: null, confidenza: 'alta', bersaglio: null, riferimento: null };
    if (!raw) return base;

    // 1) violenza sessuale
    for (const re of SV) {
      const hit = sentenceFor(quotedOnly, re);
      if (!hit) {
        if (hasQuoted(raw) && re.test(raw)) return Object.assign(base, { attore: 'citazione', contesto: 'citazione' });
        continue;
      }
      const { s, m } = hit;
      const idx = s.indexOf(m[0]);
      // "chi ha stuprato…", "è stata violentata": il gesto è di qualcun
      // altro (domanda, indagine, racconto), non del giocatore.
      const participio = /(at[oaie]|ata)$/.test(m[0]) && !/\b(ho|abbiamo) $/.test(s.slice(Math.max(0, idx - 12), idx));
      const attore = participio ? 'altro' : actorFor(s, idx, charName);
      const protettivo = PROTECTIVE.test(s.replace(m[0], ''));
      if (participio) return Object.assign(base, { attore, contesto: 'riferimento_ad_altri' });
      if (precededByNegation(s, idx)) return Object.assign(base, { attore, contesto: 'negazione' });
      if (attore === 'png') return Object.assign(base, { attore: 'png', contesto: protettivo ? 'protezione' : 'azione_png' });
      if (protettivo && attore !== 'giocatore') return Object.assign(base, { attore, contesto: 'protezione' });
      if (attore === 'giocatore' && !protettivo) {
        return Object.assign(base, { categoria: 'violenza_sessuale', attore, intenzione: 'tentativo_esplicito', contesto: 'azione', confidenza: 'alta', riferimento: m[0] });
      }
      return Object.assign(base, { categoria: 'ambiguo', attore, intenzione: 'violenza_sessuale_possibile', contesto: protettivo ? 'protezione_incerta' : 'incerto', confidenza: 'bassa', riferimento: m[0] });
    }

    // 2) crudeltà gratuita
    for (const re of HARM) {
      const hit = sentenceFor(quotedOnly, re);
      if (!hit) continue;
      const { s, m } = hit;
      const idx = s.indexOf(m[0]);
      const attore = actorFor(s, idx, charName);
      if (precededByNegation(s, idx)) return Object.assign(base, { attore, contesto: 'negazione' });
      const whole = quotedOnly;
      const inerme = DEFENSELESS.test(whole);
      const gratuita = GRATUITOUS.test(whole);
      const protettivo = /\b(denunci\w*|rapporto|indag\w*|accus\w*|testimon\w*)\b/.test(whole);
      if (protettivo) return Object.assign(base, { attore, contesto: 'denuncia' });
      if (attore === 'png') continue;
      if (!inerme && !gratuita) continue; // combattimento o autodifesa: non è crudeltà gratuita
      const bersaglio = (whole.match(DEFENSELESS) || [null])[0];
      const forte = DEFENSELESS_STRONG.test(whole);
      if (attore === 'giocatore' && (gratuita || (inerme && SEVERE.test(m[0])) || forte)) {
        return Object.assign(base, { categoria: 'crudelta_gratuita', attore, intenzione: 'atrocita', contesto: 'azione', confidenza: 'alta', bersaglio, riferimento: m[0] });
      }
      return Object.assign(base, { categoria: 'ambiguo', attore, intenzione: 'crudelta_possibile', contesto: 'incerto', confidenza: 'bassa', bersaglio, riferimento: m[0] });
    }
    return base;
  }

  /* ------------------------------------------------ nomi e simbologia */

  /* Elenco operativo di BOZZA (§7.3): solo figure e simboli storici del
     nazismo e del fascismo largamente riconoscibili, scritti per intero.
     Le "dittature attuali" richiedono una lista editoriale aggiornata e
     firmata da Mauro: non viene inventata qui. Un nome comune (es. solo
     "Benito" o "Adolf") non basta a bloccare. */
  const CREATION_BLOCKLIST = Object.freeze({
    versione: 'simboli-0.1-bozza',
    figure: ['adolf hitler', 'benito mussolini', 'heinrich himmler', 'joseph goebbels', 'hermann goring', 'hermann goering',
      'reinhard heydrich', 'adolf eichmann', 'josef mengele', 'rudolf hess', 'ante pavelic', 'francisco franco'],
    simboli: ['svastica', 'swastika', 'hakenkreuz', '卐', 'sieg heil', 'heil hitler', 'fascio littorio', 'totenkopf ss', 'sig rune', 'ᛋᛋ'],
    note: 'Bozza da revisionare: liste di dittature attuali e casi ambigui in attesa di decisione editoriale.'
  });

  function checkCreationField(value) {
    const t = norm(value);
    if (!t) return { ok: true };
    for (const f of CREATION_BLOCKLIST.figure) if (t.includes(f)) return { ok: false, motivo: 'figura', match: f, versione: CREATION_BLOCKLIST.versione };
    for (const sym of CREATION_BLOCKLIST.simboli) if (t.includes(norm(sym))) return { ok: false, motivo: 'simbolo', match: sym, versione: CREATION_BLOCKLIST.versione };
    return { ok: true };
  }

  /* Ritratti: il prototipo NON ha una capacità locale di analisi delle
     immagini (un modello solo testuale non vede i pixel). Il verdetto è
     quindi sempre "non verificato", mai una sanzione. */
  function checkPortrait() {
    return { ok: true, verificato: false, motivo: 'analisi_immagini_non_disponibile' };
  }

  global.RMSoloModeration = { POLICY_VERSION, classifyPlayerText, checkCreationField, checkPortrait, CREATION_BLOCKLIST, _norm: norm };
})(typeof window !== 'undefined' ? window : globalThis);
