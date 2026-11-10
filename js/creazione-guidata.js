/* Role Makers — creazione guidata del personaggio (sei passaggi).
   Si aggancia al wizard esistente di js/app.js (WIZARD_STEPS, renderWizardStep, moveIntoWizard) e lo arricchisce:
   proposte di build senza IA (parole chiave, modelli del Randomixer), tendine dei valori consigliati con motivo e punti
   disponibili, spostamenti di punti scelti dal giocatore, conservazione dei valori scritti a mano, dotazione della
   solitaria letta prima dei consigli, boost ed equipaggiamento nella creazione, riepilogo con anteprime dei numeri.

   Regole esistenti riusate (CLAUDE.md §10): PRIMARY_POOL, PRIMARY_MIN, TERTIARY_POOL, TRAIT_POOL_PER_LIST, BUILDS,
   diceForValue, abilitaCostoForLv, utilizziBaseForQI, equipRange, tecAbSbloccate, BOOST_LEVELS, CAPACITA_TETTI
   (attraverso js/capacita-modelli.js), NPC_ARCHETYPES e NPC_ARCHETYPE_STILE del Randomixer (js/npc-randomizer.js),
   RMSoloLink/RMSoloCatalogo/RMSoloUI per la dotazione della solitaria.
   Formule delle stime: riprodotte da js/app.js (online) e js/solo/solo-rules.js + solo-engine.js (solitaria),
   come in scripts/creazione-guidata/confronti.js (riallineate il 7/11/2026 alle correzioni del combattimento:
   riduzione e critico anche in solitaria, Tecnica + Atk dell'arma, armatura × 0,25); se il motore cambia, vanno
   riallineate.
   I numeri dei consigli (distribuzioni, kit, boost) sono approvati dall'autore il 7/11/2026 come suggerimenti
   (DECISIONI_AUTORE §15 I.1): non cambiano regole e il giocatore può sempre modificarli
   (docs/proposte/CREAZIONE_GUIDATA_*.md). */
(function (global) {
  'use strict';

  /* ================================================================== dati */
  const K = ['hp', 'mp', 'for', 'mira', 'vel', 'fmen', 'dex', 'dif', 'dmen'];
  const NOME = { hp: 'HP', mp: 'MP', for: 'Forza', mira: 'Mira', vel: 'Velocità', fmen: 'Forza Magica', dex: 'Destrezza', dif: 'Difesa', dmen: 'Difesa Magica' };
  const STILI = {
    mischia: { label: 'Mischia', frase: 'Combatti da vicino: colpisci forte e reggi i colpi.', classe: 'guerriero' },
    distanza: { label: 'Distanza', frase: 'Colpisci da lontano prima che ti raggiungano.', classe: 'eclettico' },
    protezione: { label: 'Protezione', frase: 'Resisti a lungo e tieni la linea.', classe: 'guerriero' },
    controllo: { label: 'Controllo', frase: 'Togli opzioni al nemico: rallenti, blocchi, confondi.', classe: 'mago' },
    supporto: { label: 'Supporto', frase: 'Curi e rafforzi te stesso o gli alleati.', classe: 'mago' },
    versatilita: { label: 'Versatilità', frase: 'Un po\' di tutto: ti adatti.', classe: 'eclettico' }
  };
  const ALTERNATIVA = { guerriero: 'eclettico', eclettico: 'guerriero', mago: 'eclettico' };
  /* Terziarie per stile (somma 5, minimo −1): CATALOGO §6, approvate dall'autore il 7/11/2026 come suggerimenti. */
  const TERZIARIE = {
    mischia: { carisma: 1, stile: 1, fortuna: 3 }, distanza: { carisma: 1, stile: 2, fortuna: 2 }, protezione: { carisma: 1, stile: 1, fortuna: 3 },
    controllo: { carisma: 2, stile: 1, fortuna: 2 }, supporto: { carisma: 3, stile: 0, fortuna: 2 }, versatilita: { carisma: 2, stile: 1, fortuna: 2 }
  };
  /* Dizionario delle parole chiave (CATALOGO §9): propone solo nomi di TRAIT_LISTS o dei tratti della storia. */
  const DIZIONARIO = [
    { parole: ['soldat', 'guardia', 'milizia', 'mercenari'], tratti: [['capacitaCombattive', 'Tattica Militare'], ['capacitaCombattive', 'Resistenza']], stili: ['mischia', 'protezione'] },
    { parole: ['medic', 'guarit', 'curar', 'cura ', 'erbe', 'impacc', 'ferit'], tratti: [['capacitaCombattive', 'Guarigione'], ['conoscenze', 'Flora']], stili: ['supporto'] },
    { parole: ['caccia', 'traccia', 'tracce', 'bosco', 'selvaggin'], tratti: [['conoscenze', 'Caccia'], ['conoscenze', 'Seguire Tracce'], ['conoscenze', 'Fauna']], stili: ['distanza'] },
    { parole: ['ladr', 'borseggi', 'vicol', 'strada', 'furt'], tratti: [['capacitaNormali', 'Furtività'], ['capacitaNormali', 'Scassinare'], ['conoscenze', 'Bassifondi']], stili: ['distanza', 'versatilita'] },
    { parole: ['marinai', 'nave', 'mare', 'porto', 'pescator'], tratti: [['conoscenze', 'Navigare'], ['capacitaNormali', 'Nuotare'], ['conoscenze', 'Pesca']], stili: ['versatilita'] },
    { parole: ['nobil', 'corte', 'diplomat', 'mediator'], tratti: [['conoscenze', 'Politica'], ['capacitaNormali', 'Persuasione']], stili: ['supporto'] },
    { parole: ['fabbr', 'meccanic', 'inventor', 'ingegner'], tratti: [['conoscenze', 'Meccanica'], ['capacitaNormali', 'Riparare']], stili: ['versatilita'] },
    { parole: ['studios', 'bibliotec', 'mappe', 'libri'], tratti: [['conoscenze', 'Geografia'], ['conoscenze', 'Architettura']], stili: ['controllo'] },
    { parole: ['esplorator', 'montagn', 'scout'], tratti: [['conoscenze', 'Orientamento'], ['capacitaNormali', 'Scalare'], ['conoscenze', 'Sopravvivenza']], stili: ['distanza'] },
    { parole: ['cavalier', 'cavall', 'giostra'], tratti: [['conoscenze', 'Cavalcare']], stili: ['mischia'] },
    { parole: ['mago', 'maga', 'incantat', 'rituale', 'vision', 'arkè', 'arke'], tratti: [], stili: ['controllo', 'supporto'] },
    { parole: ['hacker', 'rete', 'sistemi', 'computer'], tratti: [['capacitaNormali', 'Hacking']], stili: ['controllo'] },
    { parole: ['duell', 'spada', 'lama'], tratti: [['capacitaCombattive', 'Arte Combattiva']], stili: ['mischia'] },
    { parole: ['scudo', 'difend', 'protegg', 'davanti ai compagni'], tratti: [], stili: ['protezione'] },
    { parole: ['azzardo', 'scommess', 'gioc'], tratti: [['conoscenze', "Gioco d'Azzardo"]], stili: ['versatilita'] },
    { parole: ['minacc', 'temut', 'brutal'], tratti: [['capacitaNormali', 'Intimidire']], stili: ['mischia'] },
    { parole: ['ascolt', 'spia', 'osserv'], tratti: [['capacitaNormali', 'Ascoltare'], ['capacitaNormali', 'Percezione']], stili: ['distanza'] }
  ];
  /* Pesi degli oggetti nello zaino (kg): il regolamento non dà una tabella (CATALOGO §11); approvati dall'autore il 7/11/2026
     come suggerimenti. */
  const PESO = { arma: { corte: 1, medie: 2.5, grandi: 5 }, scudo: { piccoli: 3, medi: 6, grandi: 10 }, armatura: { leggere: 6, medie: 12, pesanti: 20 } };
  /* Avversario di riferimento delle anteprime (CATALOGO §10). */
  const RIF = { el: 1, res: 1, dex: 4, dif: 4, dmen: 4 };

  const clone = o => JSON.parse(JSON.stringify(o));
  const sum = o => K.reduce((s, k) => s + (Number(o[k]) || 0), 0);
  const pool = () => (typeof PRIMARY_POOL === 'number' ? PRIMARY_POOL : 40);
  const minP = () => (typeof PRIMARY_MIN === 'number' ? PRIMARY_MIN : 1);
  const multDi = (build, ecl) => {
    const b = typeof BUILDS !== 'undefined' && BUILDS[build];
    if (!b) return [7, 5];
    if (build === 'eclettico') return ecl === 5 ? [5, 7] : [7, 5];
    return [b.hpMult, b.mpMult];
  };

  /* ================================================================== parole chiave */
  function paroleChiave(testo) {
    const t = ' ' + String(testo || '').toLowerCase() + ' ';
    const out = [];
    DIZIONARIO.forEach((v, i) => {
      const p = v.parole.find(w => t.indexOf(w) !== -1);
      if (p) out.push({ id: 'k' + i, parola: p.trim(), tratti: v.tratti, stili: v.stili });
    });
    return out;
  }
  function stiliDaParole(voci) {
    const n = {};
    voci.forEach(v => v.stili.forEach(s => { n[s] = (n[s] || 0) + 1; }));
    return Object.keys(n).sort((a, b) => n[b] - n[a]);
  }

  /* ================================================================== modelli senza IA (Randomixer) */
  /* I modelli di partenza sono gli archetipi del Randomixer (NPC_ARCHETYPES): classe, stile, tratti preferiti, arma e
     scudo vengono dai loro pesi, presi al valore più probabile (niente estrazione a caso per un giocatore). */
  function argmax(w) { return Object.keys(w || {}).sort((a, b) => w[b] - w[a])[0]; }
  function modelli() {
    if (typeof NPC_ARCHETYPES === 'undefined') return [];
    return NPC_ARCHETYPES.map(a => ({
      id: a.key, label: a.label.replace(/^(Il|La|Lo|L')\s*/i, ''),
      classe: argmax(a.buildWeights),
      stile: (typeof NPC_ARCHETYPE_STILE !== 'undefined' && NPC_ARCHETYPE_STILE[a.key]) || 'versatilita',
      tiro: argmax(a.weaponClassWeights) === 'tiro',
      scudo: (a.shieldChance || 0) >= 50,
      tratti: a.traitBias || {},
      terziaria: a.tertiaryBias || null
    }));
  }

  /* ================================================================== ruoli del pacchetto */
  /* Che cosa fa lavorare il pacchetto (capacità, arma, scudo, boost) nella modalità di gioco. */
  function ruoli(inp) {
    const r = { danno: [], colpo: [], difesa: [], costoMp: false, scala: [], tratti: [], iniziativa: true, armaTiro: false, scudo: !!inp.scudo, arke: false };
    const add = (lista, v) => { if (v && r[lista].indexOf(v) === -1) r[lista].push(v); };
    const arma = inp.arma || null;
    if (arma) {
      r.armaTiro = !!arma.tiro;
      if (inp.solitaria) { add('danno', arma.tiro ? 'mira' : 'for'); add('colpo', 'dex'); }
      else { add('danno', arma.stat || 'for'); if (arma.tiro) add('colpo', 'mira'); }
    }
    (inp.righe || []).forEach(x => {
      const ruoliR = (global.RMCapacitaModelli && RMCapacitaModelli.ruoliRiga(x.riga, x.kind)) || [];
      ruoliR.forEach(s => {
        const [tipo, val] = s.split(':');
        if (tipo === 'danno') add('danno', val);
        else if (tipo === 'costo') r.costoMp = true;
        else if (tipo === 'scala') add('scala', val);
        else if (tipo === 'tratto' || tipo === 'colpo') add('tratti', val);
      });
      if (x.riga && x.riga.arke) r.arke = true;
    });
    (inp.boostBonus || []).forEach(b => { if (b.listKey === 'primaria' && ['for', 'dex', 'mira', 'fmen'].indexOf(b.name) !== -1 && r.danno.indexOf(b.name) === -1) { /* il boost non crea un ruolo: lo rafforza solo se esiste */ } });
    // il Mago attacca con le magie: l'arma della dotazione (es. la spada d'addestramento) resta un ripiego,
    // salvo il Mago tiratore che sceglie «arma prima» (resta Mago: cambia solo l'ordine dei consigli)
    const primo = k => { const i = r.danno.indexOf(k); if (i > 0) { r.danno.splice(i, 1); r.danno.unshift(k); } };
    // Mago tiratore: gli slot del Mago sono magie (costo in MP, danno con la Forza Magica) anche prima di sceglierle
    if (inp.build === 'mago' && inp.priorita) { add('danno', 'fmen'); r.costoMp = true; }
    if (inp.priorita === 'arma' && arma) primo(inp.solitaria ? (arma.tiro ? 'mira' : 'for') : (arma.stat || 'for'));
    else if (inp.build === 'mago' || inp.priorita === 'magia') primo('fmen');
    // dal 6/11/2026 la solitaria applica la stessa regola delle difese dell'online: Difesa e Difesa Magica riducono ogni colpo
    add('difesa', 'dif'); add('difesa', 'dmen');
    if (!inp.solitaria && arma && !arma.tiro) add('colpo', 'dex'); // online: schivata contro i colpi a distanza
    return r;
  }

  const MOTIVO = {
    campagna: {
      hp: m => `Ogni punto vale ${m[0]} HP.`, mp: m => `Ogni punto vale ${m[1]} MP. Una magia di livello 1 costa 6 MP.`,
      for: () => 'Danno con le armi da Forza: Atk + Forza + un dado (d4 fino a 10, d6 da 11 a 20).',
      dex: () => 'Danno con le armi da Destrezza; schivi i colpi a distanza con la Destrezza.',
      mira: () => 'Con un\'arma da tiro colpisci con la Mira.',
      vel: () => 'Iniziativa: d8 + Velocità; muoversi costa meno.',
      fmen: () => 'Danno magico e cure che scalano: base + Forza Magica + un dado.',
      dif: () => 'Ogni colpo fisico è ridotto di Difesa + un suo dado.',
      dmen: () => 'Ogni colpo magico è ridotto di Difesa Magica + un suo dado.'
    },
    solitaria: {
      hp: m => `Ogni punto vale ${m[0]} HP.`, mp: m => `Ogni punto vale ${m[1]} MP. Una magia di livello 1 costa 6 MP.`,
      for: () => 'Danno con le armi non da tiro: Atk + Forza + un dado.',
      dex: () => 'Metà della Destrezza si aggiunge al colpire negli attacchi fisici.',
      mira: () => 'Con un\'arma da tiro il danno è Atk + Mira + un dado.',
      vel: () => 'Iniziativa: d8 + Velocità.',
      fmen: () => 'Danno magico: base + Forza Magica + un dado.',
      dif: () => 'Ogni colpo fisico è ridotto di Difesa + un suo dado.',
      dmen: () => 'Ogni colpo magico è ridotto di Difesa Magica + un suo dado.'
    }
  };

  /* ================================================================== primarie consigliate dal pacchetto */
  /* CATALOGO §6: ogni punto sopra 1 ha un ruolo. Ordine di priorità: MP per le magie, HP, statistica di danno
     principale, colpo, difese, scala delle cure, Velocità, seconde statistiche di danno; i punti avanzati portano la
     statistica principale alla soglia del d6 (11) e poi agli HP. */
  function consigliaPrimarie(inp) {
    const v = {}; K.forEach(k => { v[k] = minP(); });
    const m = multDi(inp.build, inp.ecl);
    const R = inp.ruoli || ruoli(inp);
    const motivi = {}; K.forEach(k => { motivi[k] = []; });
    let resto = pool() - sum(v);
    const porta = (k, target, perche) => {
      if (resto <= 0) return;
      const d = Math.max(0, Math.min(target - v[k], resto));
      if (d > 0) { v[k] += d; resto -= d; }
      if (perche && motivi[k].indexOf(perche) === -1) motivi[k].push(perche);
    };
    const stile = inp.stile || 'versatilita';
    if (R.costoMp) {
      const lanci = stile === 'supporto' ? 6 : 4;
      porta('mp', Math.max(minP(), Math.ceil(lanci * (typeof abilitaCostoForLv === 'function' ? abilitaCostoForLv(1) : 6) / m[1])), `${lanci} magie di livello 1 a scontro`);
    }
    porta('hp', 6 + (stile === 'mischia' || stile === 'protezione' ? 2 : 0) + (inp.build === 'mago' ? 2 : 0), 'resistenza');
    const principale = R.danno[0] || (R.scala[0]) || null;
    if (principale) porta(principale, 10, 'statistica principale del tuo attacco');
    // Mago tiratore «magia prima»: l'arma a distanza è un ripiego, la Mira per colpire resta più bassa
    R.colpo.forEach(k => porta(k, k === 'mira' ? (inp.priorita === 'magia' ? 5 : 8) : 6, k === 'mira' ? 'per colpire con l\'arma da tiro' : (inp.solitaria ? 'metà si aggiunge al colpire' : 'schivata contro i colpi a distanza')));
    const prot = stile === 'protezione';
    R.difesa.forEach(k => porta(k, k === 'dif' ? (prot ? 8 : 5) : (prot ? 5 : 4), k === 'dif' ? 'riduce i colpi fisici' : (inp.solitaria ? 'salvezza contro le magie' : 'riduce i colpi magici')));
    R.scala.forEach(k => porta(k, 8, 'forza delle cure'));
    porta('vel', stile === 'mischia' || stile === 'distanza' ? 5 : 4, 'iniziativa');
    R.danno.slice(1).forEach(k => porta(k, 6, 'seconda statistica di danno'));
    if (principale && resto > 0 && v[principale] === 10) porta(principale, 11, 'soglia del d6');
    while (resto > 0) { porta('hp', v.hp + resto, 'resistenza'); }
    return { valori: v, motivi };
  }

  /* «Applica ai campi consigliati»: i campi manuali restano; solo i punti rimasti vanno sugli altri campi, in
     proporzione al consiglio, almeno 1 ciascuno. Restituisce { valori } oppure { errore }. */
  function applicaConsigliati(attuali, consiglio, manuali) {
    const man = K.filter(k => manuali && manuali[k]);
    const liberi = K.filter(k => man.indexOf(k) === -1);
    const usati = man.reduce((s, k) => s + (Number(attuali[k]) || 0), 0);
    const resto = pool() - usati;
    if (!liberi.length) return { valori: Object.assign({}, attuali) };
    if (resto < liberi.length * minP()) return { errore: `Hai assegnato a mano ${usati} punti: ne restano ${resto} per ${liberi.length} campi. Riduci un valore manuale.` };
    const peso = liberi.reduce((s, k) => s + Math.max(1, consiglio[k]), 0);
    const out = Object.assign({}, attuali);
    let dato = 0;
    liberi.forEach(k => { out[k] = Math.max(minP(), Math.floor(Math.max(1, consiglio[k]) * resto / peso)); dato += out[k]; });
    let diff = resto - dato;
    const ord = liberi.slice().sort((a, b) => consiglio[b] - consiglio[a]);
    for (let i = 0; diff !== 0 && i < 1000; i++) {
      const k = ord[i % ord.length];
      if (diff > 0) { out[k]++; diff--; } else if (out[k] > minP()) { out[k]--; diff++; }
    }
    return { valori: out };
  }

  /* Tendina di un campo: opzioni con valore, etichetta e, se mancano punti, da quali campi prenderli. */
  function opzioniTendina(stat, attuali, consiglio, inp) {
    const liberi = pool() - sum(attuali);
    const cur = Number(attuali[stat]) || minP();
    const m = multDi(inp.build, inp.ecl);
    const vals = [];
    const pushV = (val, etichetta) => { if (val >= minP() && !vals.some(o => o.valore === val)) vals.push({ valore: val, etichetta }); };
    pushV(consiglio.valori[stat], 'consigliato');
    if (['for', 'dex', 'mira', 'fmen', 'dif', 'dmen'].indexOf(stat) !== -1 && cur <= 10) pushV(11, 'il dado passa da d4 a d6');
    pushV(cur + 1, 'un punto in più');
    pushV(cur - 1, 'libera un punto');
    const importanza = k => (consiglio.motivi[k] && consiglio.motivi[k].length ? consiglio.valori[k] : 0);
    return vals.map(o => {
      const serve = Math.max(0, (o.valore - cur) - liberi);
      const fonti = serve > 0 ? K.filter(k => k !== stat && attuali[k] - serve >= minP())
        .sort((a, b) => importanza(a) - importanza(b) || attuali[b] - attuali[a])
        .slice(0, 3).map(k => ({ stat: k, da: attuali[k], a: attuali[k] - serve, conseguenza: conseguenza(k, serve, m) })) : [];
      return Object.assign(o, { serve, fonti });
    });
  }
  function conseguenza(k, n, m) {
    if (k === 'hp') return `−${n * m[0]} HP`;
    if (k === 'mp') return `−${n * m[1]} MP`;
    if (k === 'vel') return `iniziativa −${n}`;
    return `${NOME[k]} −${n}`;
  }

  /* ================================================================== terziarie e tratti */
  function consigliaTerziarie(stile, voci, modello) {
    const t = clone(TERZIARIE[stile] || TERZIARIE.versatilita);
    const sposta = (a, b) => { if (t[b] > -1) { t[b]--; t[a]++; } };
    const nomi = (voci || []).reduce((s, v) => s.concat(v.tratti.map(x => x[1])), []);
    if (nomi.indexOf('Persuasione') !== -1 || nomi.indexOf('Politica') !== -1 || (modello && modello.terziaria === 'carisma')) sposta('carisma', t.fortuna >= t.stile ? 'fortuna' : 'stile');
    else if (modello && modello.terziaria && modello.terziaria !== 'carisma') sposta(modello.terziaria, 'carisma');
    return t;
  }
  /* Tratti consigliati per lista (5 punti ciascuna), solo fra i nomi disponibili. */
  function consigliaTratti(inp, disponibili) {
    const R = inp.ruoli || ruoli(inp);
    const ok = (lista, nome) => !disponibili || (disponibili[lista] || []).indexOf(nome) !== -1;
    const voci = inp.voci || [];
    const dalTesto = lista => voci.reduce((s, v) => s.concat(v.tratti.filter(x => x[0] === lista).map(x => x[1])), []).filter((n, i, a) => a.indexOf(n) === i && ok(lista, n));
    const daModello = lista => ((inp.modello && inp.modello.tratti[lista]) || []).filter(n => ok(lista, n));
    const riempi = (lista, nomi, schema) => {
      const out = {}; let resto = (typeof TRAIT_POOL_PER_LIST === 'number' ? TRAIT_POOL_PER_LIST : 5);
      nomi.filter((n, i, a) => n && a.indexOf(n) === i).slice(0, schema.length).forEach((n, i) => { const v = Math.min(schema[i], resto); if (v > 0) { out[n] = v; resto -= v; } });
      const ks = Object.keys(out);
      if (resto > 0 && ks.length) out[ks[0]] += resto;
      return out;
    };
    // combattive: colpo, difesa attiva (Guardia solo con lo scudo), Resistenza, poi tratti dal racconto
    const colpo = R.arke && ok('capacitaCombattive', 'Arkè') ? 'Arkè' : 'Arte Combattiva';
    const difesa = R.scudo && ok('capacitaCombattive', 'Guardia') ? 'Guardia' : 'Elusione';
    const comb = [colpo, difesa, 'Resistenza'].concat(R.arke && colpo === 'Arkè' ? ['Arte Combattiva'] : [], R.tratti, dalTesto('capacitaCombattive'), daModello('capacitaCombattive'), ['Spirito'])
      .filter(n => ok('capacitaCombattive', n) && !(n === 'Guardia' && !R.scudo));
    const stile = inp.stile || 'versatilita';
    const normDef = { mischia: ['Intimidire', 'Percezione', 'Ascoltare'], distanza: ['Furtività', 'Percezione', 'Ascoltare'], protezione: ['Percezione', 'Intimidire', 'Ascoltare'],
      controllo: ['Percezione', 'Ascoltare', 'Persuasione'], supporto: ['Persuasione', 'Percezione', 'Ascoltare'], versatilita: ['Percezione', 'Persuasione', 'Ascoltare'] }[stile];
    const conDef = ['Sopravvivenza', 'Orientamento', 'Geografia'];
    return {
      capacitaCombattive: riempi('capacitaCombattive', comb, [2, 2, 1]),
      capacitaNormali: riempi('capacitaNormali', dalTesto('capacitaNormali').concat(daModello('capacitaNormali'), normDef).filter(n => ok('capacitaNormali', n)), [2, 2, 1]),
      conoscenze: riempi('conoscenze', dalTesto('conoscenze').concat(daModello('conoscenze'), conDef).filter(n => ok('conoscenze', n)), [2, 2, 1])
    };
  }

  /* ================================================================== proposte di build */
  /* 2-3 proposte: classe dello stile principale, combinazione con il secondario, alternativa; le classi non ammesse
     (restrizioni dei popoli della storia, RMSoloLink.classiBloccate) non compaiono. Il Mago puro in «Crea il tuo» è
     ammesso anche in Eidos (DECISIONI_AUTORE.md §2, 4/11/2026): nessun divieto generale qui. */
  function proposte(inp) {
    const s1 = inp.stile || 'versatilita', s2 = inp.stile2 || null;
    const ammessa = b => !inp.bloccate || !inp.bloccate[b] || inp.bloccate[b].ok;
    const cand = [
      { stile: s1, stile2: s2, classe: STILI[s1].classe },
      { stile: s1, stile2: s2, classe: ALTERNATIVA[STILI[s1].classe] },
      { stile: s2 || s1, stile2: s2 ? s1 : null, classe: s2 ? STILI[s2].classe : (STILI[s1].classe === 'mago' ? 'guerriero' : 'mago') }
    ];
    const out = [];
    cand.forEach(p => {
      if (!ammessa(p.classe)) { const alt = ['guerriero', 'eclettico', 'mago'].find(b => ammessa(b) && !out.some(o => o.classe === b && o.stile === p.stile)); if (!alt) return; p.classe = alt; }
      if (out.some(o => o.classe === p.classe && o.stile === p.stile && o.stile2 === p.stile2)) return;
      out.push(Object.assign(p, { id: p.classe + '-' + p.stile + (p.stile2 ? '-' + p.stile2 : '') }));
    });
    // a distanza: il Mago resta Mago, con due varianti (magia prima o arma prima); mai trasformato in Eclettico
    const distanza = s1 === 'distanza' || s2 === 'distanza';
    const espanse = [];
    out.forEach(p => {
      if (distanza && p.classe === 'mago') ['magia', 'arma'].forEach(pr => espanse.push(Object.assign({}, p, { priorita: pr, id: p.id + '-' + pr })));
      else espanse.push(p);
    });
    return espanse.slice(0, distanza ? 4 : 3);
  }
  /* Nome del tipo di build mostrato sulla proposta (solo per le build a distanza). */
  function nomeBuild(p) {
    if (p.stile !== 'distanza' && p.stile2 !== 'distanza') return '';
    if (p.classe === 'mago') return 'Mago tiratore · ' + (p.priorita === 'arma' ? 'arma prima' : 'magia prima');
    return p.stile === 'distanza' ? 'Tiratore' : '';
  }

  /* ================================================================== anteprime (formule del motore) */
  const dist = s => { const m = new Map(); for (let i = 1; i <= s; i++) m.set(i, 1 / s); return m; };
  const conv = (a, b) => { const m = new Map(); for (const [x, p] of a) for (const [y, q] of b) m.set(x + y, (m.get(x + y) || 0) + p * q); return m; };
  const shift = (a, k) => { const m = new Map(); for (const [x, p] of a) m.set(x + k, p); return m; };
  const dieFor = v => { const d = typeof diceForValue === 'function' ? diceForValue(v) : 'd4'; return d === 'd12+d8' ? conv(dist(12), dist(8)) : dist(+d.slice(1)); };
  const pure = v => shift(dieFor(v), v);
  const d20p = t => shift(dist(20), t);
  const P = (a, f) => { let s = 0; for (const [x, p] of a) if (f(x)) s += p; return s; };
  const mean = a => { let s = 0; for (const [x, p] of a) s += x * p; return s; };
  const range = a => [Math.min(...a.keys()), Math.max(...a.keys())];
  /* inp: { solitaria, base, stat, statVal, magico, tiro, colpoTratto, dex, mira } → intervallo, colpo riuscito, media.
     Stesse difese nelle due modalità (solo-rules.js resolveAttack e combatRollDefense/submit_attack_defense_roll): riduzione
     automatica (dado + Difesa, Difesa Magica contro le magie), schivata riuscita = 0, schivata fallita = controllo critico
     d20 + Resistenza contro il colpo (×2 se lo supera). Per colpire: solitaria d20 + tratto + metà Destrezza sui colpi
     fisici; online d20 + tratto, o Mira pura contro Destrezza pura con l'arma da tiro. */
  function anteprima(inp) {
    const dmg = shift(pure(Math.max(0, inp.statVal)), inp.base);
    const tiroOnline = !inp.solitaria && inp.tiro;
    const hit = inp.solitaria ? d20p((inp.colpoTratto || 0) + (inp.magico ? 0 : Math.floor((inp.dex || 0) / 2)))
      : (tiroOnline ? pure(inp.mira || 0) : d20p(inp.colpoTratto || 0));
    const dodge = tiroOnline ? pure(RIF.dex) : d20p(RIF.el);
    const red = pure(inp.magico ? RIF.dmen : RIF.dif), crit = d20p(RIF.res);
    let after = 0; for (const [x, p] of dmg) for (const [y, q] of red) after += p * q * Math.max(0, x - y);
    let ph = 0, e = 0;
    for (const [h, q] of hit) { const pp = P(dodge, d => d < h); ph += q * pp; e += q * pp * after * (1 + P(crit, c => h > c)); }
    return { intervallo: range(dmg), pColpo: ph, suColpo: ph ? e / ph : 0, perAzione: e };
  }

  /* Costo del Boost al livello 1 (BOOST_LEVELS di js/data.js): il turno di attivazione conta come primo turno di
     mantenimento, nelle due modalità (DECISIONI_AUTORE §15 I.4c): 8 + 5 + 5 = 18 PP per 3 turni. */
  function costoBoostLv1() {
    const a = typeof boostActivationCost === 'function' ? boostActivationCost(null, 1) : 8;
    const m = typeof boostMaintenancePerTurn === 'function' ? boostMaintenancePerTurn(1) : 5;
    return `costa ${a} PP e mezzo turno, poi ${m} PP all'inizio di ciascuno dei 2 turni successivi: ${a + 2 * m} PP per 3 turni`;
  }

  /* ================================================================== kit per le campagne */
  /* Qualità bassa, valori al minimo dell'intervallo di EQUIP_TABLE (come i cataloghi della solitaria): kit approvati
     dall'autore il 7/11/2026 come suggerimenti. */
  function pezzo(kind, size, nome, extra) {
    const r = typeof equipRange === 'function' ? equipRange(kind, size, 'bassa') : null;
    return Object.assign({ kind, size, quality: 'bassa', nome, atk: r ? r.atk[0] : 0, dif: r ? r.dif[0] : 0, dur: r ? r.dur[0] : 0, peso: (PESO[kind] || {})[size] || 0 }, extra || {});
  }
  /* opts.stile2: stile secondario; opts.tiro: { nome, size } dell'arma a distanza scelta per il mondo della campagna
     (le statistiche restano quelle della tabella dell'equipaggiamento: in campagna il nome non cambia i valori). */
  function kits(classe, stile, opts) {
    const o = opts || {};
    const scudoOk = classe === 'guerriero'; // regola delle armi per classe: approvata in solitaria, proposta (E1) in campagna
    const tiro = stile === 'distanza' || o.stile2 === 'distanza';
    const at = o.tiro || { nome: 'Arco', size: 'medie' };
    const principale = tiro ? pezzo('arma', at.size || 'medie', at.nome, { tiro: true, stat: 'dex' }) : pezzo('arma', 'medie', classe === 'mago' ? 'Bastone' : 'Spada', { stat: 'for' });
    const out = [
      { id: 'equilibrato', label: 'Equilibrato', obiettivo: 'Sostiene l\'azione principale con versatilità.', armi: [principale], scudo: null, armatura: pezzo('armatura', classe === 'mago' ? 'leggere' : 'medie', 'Armatura') },
      { id: 'specializzato', label: 'Specializzato', obiettivo: 'Rafforza lo stile principale.',
        armi: [principale], scudo: scudoOk && (stile === 'protezione' || stile === 'mischia') ? pezzo('scudo', 'medi', 'Scudo') : null,
        armatura: pezzo('armatura', stile === 'protezione' && classe !== 'mago' ? 'medie' : 'leggere', 'Armatura') },
      { id: 'alternativo', label: 'Alternativo', obiettivo: 'Stessa idea, altro modo di combattere.',
        armi: tiro ? [pezzo('arma', 'corte', 'Pugnale', { stat: 'dex' })] : (scudoOk ? [pezzo('arma', 'medie', 'Ascia', { stat: 'for' }), pezzo('arma', 'corte', 'Pugnale', { stat: 'dex' })] : [pezzo('arma', 'medie', 'Arco', { tiro: true, stat: 'dex' })]),
        scudo: null, armatura: pezzo('armatura', 'leggere', 'Armatura') }
    ];
    return out;
  }

  /* ================================================================== stato del personaggio */
  function guida(c) {
    if (!c.guida || typeof c.guida !== 'object') c.guida = {};
    const g = c.guida;
    if (!g.manuali) g.manuali = { primary: {}, tertiary: false, traits: {} };
    if (!g.manuali.primary) g.manuali.primary = {};
    if (!g.manuali.traits) g.manuali.traits = {};
    if (!Array.isArray(g.paroleConfermate)) g.paroleConfermate = [];
    return g;
  }
  function solitaria(c) { return !!(c && c.soloCreazione); }
  /* Armi a distanza per il mondo della campagna. Campagna libera: tipi generici, che il giocatore sceglie e concorda con
     il Narratore (nessuna arma da fuoco data per scontata). Icaro, Ich, Eidos: solo le armi a distanza dei cataloghi
     reali della storia (js/solo/content/<storia>-catalogo.json), mai un'arma di un altro mondo. */
  const MONDI = { libera: 'Campagna libera', icaro: 'Icaro', ich: 'Ich', eidos: 'Eidos' };
  const ARMI_LIBERE = [{ nome: 'Arco', size: 'medie' }, { nome: 'Balestra', size: 'medie' }, { nome: 'Pistola', size: 'corte', nota: 'solo se il mondo del Narratore la prevede' }, { nome: 'Fucile', size: 'medie', nota: 'solo se il mondo del Narratore lo prevede' }];
  const cataloghiMondo = {};
  function armiTiroMondo(mondo, poi) {
    if (!mondo || mondo === 'libera') return ARMI_LIBERE;
    if (cataloghiMondo[mondo]) return cataloghiMondo[mondo];
    if (typeof fetch === 'function' && !cataloghiMondo['_' + mondo]) {
      cataloghiMondo['_' + mondo] = true;
      fetch('js/solo/content/' + mondo + '-catalogo.json').then(r => r.json()).then(cat => {
        const gruppi = cat.gruppi || {};
        cataloghiMondo[mondo] = Object.values(cat.oggetti || {}).filter(x => x.tipo === 'arma' && x.classe === 'tiro')
          .map(x => { const gid = x.id.split('.')[0]; return { nome: x.nome, size: x.taglia === 'corte' ? 'corte' : 'medie', gruppo: (gruppi[gid] && gruppi[gid].nome) || gid, id: x.id }; });
        if (poi) poi();
      }).catch(() => { cataloghiMondo['_' + mondo] = false; });
    }
    return null;
  }
  function kitsDi(c) {
    const g = guida(c);
    return kits(c.build, g.stile || 'versatilita', { stile2: g.stile2, tiro: g.armaTiro || null });
  }
  function dotazioneSolo(c) {
    try {
      if (!solitaria(c) || !global.RMSoloUI || !RMSoloUI.datiStoria || !global.RMSoloLink || !global.RMSoloCatalogo) return null;
      const d = RMSoloUI.datiStoria(c.soloCreazione.storia);
      const gr = RMSoloLink.gruppoCorrente(c);
      return d && d.catalogo && gr && c.build ? RMSoloCatalogo.dotazione(d.catalogo, gr, c.build) : null;
    } catch (e) { return null; }
  }
  /* In solitaria: la dotazione del gruppo per una classe ha un'arma a distanza? Se no, il motivo e l'integrazione da
     proporre all'autore (mai una sostituzione silenziosa degli oggetti). */
  function tiroInSolitaria(c, classe) {
    try {
      const d = RMSoloUI.datiStoria(c.soloCreazione.storia), gr = RMSoloLink.gruppoCorrente(c);
      if (!d || !d.catalogo || !gr) return null;
      const dot = RMSoloCatalogo.dotazione(d.catalogo, gr, classe);
      if (!dot) return { ok: false, motivo: 'classe non ammessa nel tuo gruppo' };
      const armi = dot.equip.filter(e => e.tipo === 'arma');
      if (armi.some(e => e.classe === 'tiro')) return { ok: true };
      const delGruppo = Object.values(d.catalogo.oggetti || {}).filter(x => x.tipo === 'arma' && x.classe === 'tiro' && x.id.split('.')[0] === gr).map(x => x.nome);
      const nomeGr = (d.catalogo.gruppi[gr] && d.catalogo.gruppi[gr].nome) || gr;
      const cl0 = BUILDS[classe] ? BUILDS[classe].label : classe;
      const cl = (/^[AEIOU]/i.test(cl0) ? "dell'" : 'del ') + cl0;
      return { ok: false, motivo: `la dotazione ${cl} di ${nomeGr} ha solo ${armi.map(e => e.nome).join(', ') || 'nessuna arma'}`,
        integrazione: delGruppo.length ? `aggiungere ${delGruppo.join(' o ')} alla dotazione ${cl} di ${nomeGr}` : `nel catalogo di ${nomeGr} non c'è nessuna arma a distanza: andrebbe scritta` };
    } catch (e) { return null; }
  }
  /* Ingressi per i consigli, letti dalla scheda (e in solitaria dalla dotazione del catalogo). */
  function ingressi(c) {
    const g = guida(c);
    const solo = solitaria(c);
    let arma = null, scudo = false, boostBonus = [];
    if (solo) {
      const dot = dotazioneSolo(c);
      if (dot) {
        const a = dot.equip.find(e => e.tipo === 'arma');
        if (a) arma = { tiro: a.classe === 'tiro', stat: a.classe === 'tiro' ? 'mira' : 'for', nome: a.nome, atk: a.atk };
        scudo = dot.equip.some(e => e.tipo === 'scudo');
        boostBonus = (dot.boost[0] && dot.boost[0].bonus || []).map(b => ({ listKey: 'primaria', name: b.stat, valore: b.valore }));
      }
    } else {
      const a = (c.weaponSlots || []).find(w => w.kind === 'arma' && (w.statsConfirmed || w.size));
      if (a) arma = { tiro: a.weaponClass === 'tiro', stat: a.usaDex ? 'dex' : (a.usaFmen && !a.usaFor ? 'fmen' : 'for'), nome: a.name, atk: Number(a.atk) || 0 };
      else if (g.stile) {
        // equipaggiamento non ancora scelto (passaggio 5): i consigli usano l'arma del kit previsto, così un tiratore
        // riceve subito Mira e Destrezza invece di una Forza che non userà
        const k = kitsDi(c).find(x => x.id === (g.kitId || 'equilibrato'));
        const w = k && k.armi[0];
        if (w) arma = { tiro: !!w.tiro, stat: w.stat || 'for', nome: w.nome, atk: w.atk, prevista: true };
      }
      scudo = (c.weaponSlots || []).some(w => w.kind === 'scudo' && w.equipaggiato !== false && (w.statsConfirmed || w.size));
      boostBonus = ((c.boostRows || [])[0] || {}).bonusItems || [];
    }
    const righe = [].concat((c.tecniche || []).map(r => ({ riga: r, kind: 'tecnica' })), (c.abilita || []).map(r => ({ riga: r, kind: 'abilita' })));
    const voci = paroleChiave(g.testo).filter(v => g.paroleConfermate.indexOf(v.id) !== -1);
    const modello = g.modelloId ? modelli().find(m => m.id === g.modelloId) : null;
    const inp = { solitaria: solo, build: c.build, ecl: c.eclecticoHpMult, stile: g.stile || (modello && modello.stile) || 'versatilita', stile2: g.stile2 || null, priorita: c.build === 'mago' ? (g.priorita || null) : null, arma, scudo, righe, boostBonus, voci, modello };
    inp.ruoli = ruoli(inp);
    return inp;
  }

  /* ================================================================== interfaccia */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = (x, n) => (Number(x) || 0).toFixed(n == null ? 1 : n).replace('.', ',');
  let osservatore = null, cablato = false;

  function salva(c) { if (typeof touchActive === 'function') touchActive(); if (typeof saveAll === 'function') saveAll(); }
  function ridisegna(c, cosa) {
    try {
      if (cosa.primary) { renderPrimaryStats(c); if (typeof updateDerived === 'function') updateDerived(c); }
      if (cosa.tertiary && typeof renderTertiaryStats === 'function') renderTertiaryStats(c);
      if (cosa.traits && typeof renderTraits === 'function') renderTraits(c);
      if (cosa.tecab) { renderTecniche(c); renderAbilita(c); }
      if (cosa.boost && typeof renderBoostRows === 'function') renderBoostRows(c);
      if (cosa.equip) { if (typeof renderSlots === 'function') renderSlots(c); if (typeof renderWeaponSlots === 'function') renderWeaponSlots(c); }
    } catch (e) { console.error('creazione guidata: ridisegno', e); }
    salva(c);
    if (typeof updateWizardNavButtons === 'function') updateWizardNavButtons();
  }
  function contenitore(stepId, id, prima) {
    const step = document.getElementById(stepId);
    if (!step) return null;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div'); el.id = id; el.className = 'cg-panel';
      if (prima && step.firstChild) step.insertBefore(el, step.firstChild); else step.appendChild(el);
    }
    return el;
  }

  /* ---------------- passaggio 1: idea e proposta di build ---------------- */
  function renderIdea(c) {
    const el = contenitore('wiz-step-build', 'cg-idea', true); if (!el) return;
    const g = guida(c), solo = solitaria(c);
    const voci = paroleChiave(g.testo);
    const stiliTesto = stiliDaParole(voci.filter(v => g.paroleConfermate.indexOf(v.id) !== -1));
    const bloccate = solo && global.RMSoloLink ? RMSoloLink.classiBloccate(c) : null;
    const mod = modelli();
    const stileSel = g.stile || stiliTesto[0] || '';
    const props = stileSel ? proposte({ stile: stileSel, stile2: g.stile2 || null, bloccate }) : [];
    const modo = g.modo || 'descrivi';
    const opzStile = (val, vuoto) => `<option value="">${vuoto}</option>` + Object.keys(STILI).map(k => `<option value="${k}" ${val === k ? 'selected' : ''}>${STILI[k].label}</option>`).join('');
    el.innerHTML = `
      <div class="section-title"><span class="dot neutral"></span>Come vuoi iniziare?</div>
      <div class="cg-modi" role="radiogroup" aria-label="Come vuoi iniziare">
        ${[['descrivi', 'Descrivi il personaggio', 'Ti proponiamo come giocarlo.'], ['modello', 'Scegli un modello', 'Parti da un personaggio di esempio.'], ['manuale', 'Compila da solo', 'Imposti tutto tu; i consigli restano nelle tendine.']]
          .map(([k, t, d]) => `<button type="button" class="cg-modo ${modo === k ? 'active' : ''}" data-cg-modo="${k}" aria-pressed="${modo === k}"><b>${t}</b><span>${d}</span></button>`).join('')}
      </div>
      ${modo === 'descrivi' ? `
        <label class="cg-label" for="cg-testo">Raccontaci chi è: da dove viene, che cosa ha fatto, che cosa sa fare.</label>
        <textarea id="cg-testo" class="cg-testo" rows="3" placeholder="Ex soldata di frontiera, ora scorta le carovane…">${esc(g.testo || '')}</textarea>
        ${voci.length ? `<p class="helper-text">Dal tuo racconto: conferma quello che ti rappresenta.</p>
          <div class="cg-chips">${voci.map(v => `<label class="cg-chip"><input type="checkbox" data-cg-parola="${v.id}" ${g.paroleConfermate.indexOf(v.id) !== -1 ? 'checked' : ''}> «${esc(v.parola)}» → ${esc(v.tratti.map(x => x[1]).concat(v.stili.map(s => STILI[s].label)).join(', ') || '—')}</label>`).join('')}</div>` : ''}` : ''}
      ${modo === 'modello' ? `
        <div class="cg-modelli">${mod.map(m => `<button type="button" class="cg-modello ${g.modelloId === m.id ? 'active' : ''}" data-cg-modello="${m.id}"><b>${esc(m.label)}</b><span>${STILI[m.stile].label} · ${BUILDS[m.classe] ? BUILDS[m.classe].label : m.classe}${m.scudo ? ' · scudo' : ''}${m.tiro ? ' · arma da tiro' : ''}</span></button>`).join('')}</div>` : ''}
      <div class="cg-row">
        <label class="cg-label">Stile principale <select data-cg-stile="1">${opzStile(stileSel, 'Scegli…')}</select></label>
        <label class="cg-label">Secondario <select data-cg-stile="2">${opzStile(g.stile2 || '', 'nessuno')}</select></label>
      </div>
      ${stileSel ? `<p class="helper-text">${esc(STILI[stileSel].frase)}</p>` : ''}
      ${props.length ? `<div class="section-title"><span class="dot neutral"></span>Suggerimenti</div>
        <div class="cg-proposte">${props.map(p => propostaHtml(c, p, g)).join('')}</div>` : ''}
      ${solo && !RMSoloLink.gruppoCorrente(c) ? '<p class="helper-text">Scegli prima popolo e appartenenza nella scheda «Volto e anagrafica»: la dotazione della storia decide quali statistiche contano.</p>' : ''}`;
  }
  function propostaHtml(c, p, g) {
    const b = BUILDS[p.classe];
    const m = multDi(p.classe, 7);
    // consigli calcolati come se la proposta fosse già scelta (classe, stile, priorità, arma prevista o dotazione)
    const prova = Object.assign({}, c, { build: p.classe, guida: Object.assign({}, g, { stile: p.stile, stile2: p.stile2 || null, priorita: p.priorita || null, kitId: null }) });
    const cons = consigliaPrimarie(ingressi(prova)).valori;
    const scelta = g.propostaId === p.id;
    const nome = nomeBuild(p);
    const tiro = nome && solitaria(c) ? tiroInSolitaria(c, p.classe) : null;
    const dettaglio = p.priorita === 'magia' ? "Le magie sono l'attacco principale; l'arma a distanza resta un'alternativa."
      : p.priorita === 'arma' ? "L'arma a distanza è l'attacco principale; le magie aiutano e controllano." : '';
    const stats = 'Consigliati: ' + ['fmen', 'mira', 'dex', 'for'].filter(k => cons[k] > 1).sort((a, z) => cons[z] - cons[a]).map(k => `${NOME[k]} ${cons[k]}`).join(', ');
    return `<div class="cg-proposta ${scelta ? 'active' : ''}" data-cg-nome="${esc(nome)}">
      ${nome ? `<b>${esc(nome)}</b>` : ''}
      <b>${b ? b.label : p.classe} · ${STILI[p.stile].label}${p.stile2 ? ' + ' + STILI[p.stile2].label : ''}</b>
      <span>${cons.hp * m[0]} HP · ${cons.mp * m[1]} MP · ${esc(b ? b.dotazione : '')}</span>
      ${nome && !(tiro && !tiro.ok) ? `<span>${esc(stats)}</span>` : ''}
      ${dettaglio ? `<span>${esc(dettaglio)}</span>` : ''}
      ${tiro && !tiro.ok ? `<span class="cg-manca">Non disponibile in questa storia: ${esc(tiro.motivo)}.${tiro.integrazione ? ` Integrazione da proporre all'autore: ${esc(tiro.integrazione)}.` : ''}</span>`
        : `<button type="button" class="btn btn-sm ${scelta ? 'btn-ghost' : 'btn-primary'}" data-cg-proposta="${p.id}" data-classe="${p.classe}" data-stile="${p.stile}" data-stile2="${p.stile2 || ''}" data-priorita="${p.priorita || ''}">${scelta ? 'Scelta ✔' : 'Usa questo suggerimento'}</button>`}
    </div>`;
  }

  /* Applica una proposta: classe (con il clic sulla carta, la stessa logica del wizard), poi i consigli sui campi non
     manuali. Le righe scritte dal giocatore non si toccano. */
  function applicaProposta(c, classe, stile, stile2, id, priorita) {
    const g = guida(c);
    g.stile = stile; g.stile2 = stile2 || null; g.propostaId = id; g.priorita = priorita || null;
    if (c.build !== classe) {
      // le righe vuote e quelle messe dalla guida (modelloId) senza modifiche si tolgono, così il cambio non chiede conferma;
      // restano solo le righe scritte dal giocatore o assegnate (rowHasContent di app.js conta anche l'id, quindi non basta)
      ['tecniche', 'abilita'].forEach(f => { c[f] = (c[f] || []).filter(r => r.assignmentId || (String(r.nome || '').trim() && !(r.modelloId && !r.guidaModificata))); });
      const card = document.querySelector(`#build-grid [data-buildcard="${classe}"]`);
      if (card) card.click();
    }
    if (c.build !== classe) { renderIdea(c); return; } // classe non applicata (conferma in corso o bloccata)
    if (solitaria(c)) dotazioneSolitaria(c); else riempiCapacitaCampagna(c);
    applicaTutto(c, true);
    renderIdea(c);
  }
  /* «Crea il tuo»: la dotazione del gruppo per la classe scelta si scrive prima dei consigli (riempiTecab è idempotente
     per gruppo|classe, quindi non tocca righe già scelte con «Scegli un esempio»). */
  function dotazioneSolitaria(c) {
    if (typeof RMSoloLink === 'undefined' || !RMSoloLink.riempiTecab) return;
    if (RMSoloLink.riempiTecab(c) && typeof renderTecniche === 'function') { renderTecniche(c); renderAbilita(c); }
  }
  function applicaTutto(c, soloConsigliati) {
    const g = guida(c), inp = ingressi(c);
    const cons = consigliaPrimarie(inp);
    if (!c.primaryConfirmed) {
      const r = applicaConsigliati(c.primary, cons.valori, soloConsigliati ? g.manuali.primary : {});
      if (r.valori) c.primary = r.valori;
      if (!soloConsigliati) g.manuali.primary = {};
    }
    if (!g.manuali.tertiary && !c.primaryConfirmed) c.tertiary = Object.assign({}, c.tertiary, consigliaTerziarie(inp.stile, inp.voci, inp.modello));
    if (!c.traitsConfirmed) applicaTratti(c, inp, soloConsigliati);
    ridisegna(c, { primary: true, tertiary: true, traits: true, tecab: false });
  }
  function disponibiliTratti(c) {
    const out = {};
    Object.keys(TRAIT_LISTS).forEach(l => {
      const base = c.soloCampionario && c.soloCampionario[l] ? c.soloCampionario[l] : TRAIT_LISTS[l];
      out[l] = base.concat((c.customTraits && c.customTraits[l] || []).map(t => t.name));
    });
    return out;
  }
  function applicaTratti(c, inp, soloConsigliati) {
    const g = guida(c);
    const cons = consigliaTratti(inp, disponibiliTratti(c));
    Object.keys(cons).forEach(l => {
      if (soloConsigliati && g.manuali.traits[l]) return;
      Object.keys(c.traits[l] || {}).forEach(n => { c.traits[l][n] = 0; });
      (c.customTraits[l] || []).forEach(t => { if (!t.narratore) t.value = 0; });
      Object.keys(cons[l]).forEach(n => {
        if (TRAIT_LISTS[l].indexOf(n) !== -1) {
          c.traits[l][n] = cons[l][n];
          if (c.shownTraits[l].indexOf(n) === -1) c.shownTraits[l].push(n);
        } else {
          const ct = (c.customTraits[l] = c.customTraits[l] || []);
          const t = ct.find(x => x.name === n);
          if (t) t.value = cons[l][n]; else ct.push({ name: n, value: cons[l][n] });
        }
      });
      g.manuali.traits[l] = false;
    });
  }
  /* Campagne: gli slot vuoti ricevono i modelli condivisi dello stile (mai sovrascritte le righe del giocatore). */
  function riempiCapacitaCampagna(c) {
    const g = guida(c), inp = ingressi(c);
    const un = tecAbSbloccate(c.build, 1, c.tecAbChoices, c.tecAbNarratoreBonus);
    const usati = new Set();
    [['tecniche', 'tecnica', un.tec], ['abilita', 'abilita', un.ab]].forEach(([f, kind, n]) => {
      const righe = (c[f] || []).filter(r => !r.assignmentId);
      let lista = RMCapacitaModelli.perSlot(kind, { stile: g.stile, stile2: g.stile2, scudo: inp.scudo });
      // Mago tiratore «arma prima»: l'attacco è l'arma, quindi prima le magie che controllano o sostengono
      if (inp.priorita === 'arma' && kind === 'abilita') lista = lista.filter(m => !m.danno || m.effetto).concat(lista.filter(m => m.danno && !m.effetto));
      for (let i = 0; i < n; i++) {
        const r = righe[i];
        if (r && String(r.nome || '').trim() && !r.modelloId) continue;
        const m = lista.find(x => !usati.has(x.id)); if (!m) break;
        usati.add(m.id);
        const nuova = RMCapacitaModelli.riga(m, { armaStat: inp.arma && inp.arma.stat === 'dex' ? 'dex' : 'for', qi: c.qi });
        if (r) Object.assign(r, nuova, { id: r.id, assignmentId: r.assignmentId }); else righe.push(nuova);
      }
      c[f] = righe.concat((c[f] || []).filter(r => r.assignmentId));
    });
    if (!(c.boostRows || []).some(r => String(r.nome || '').trim() && !r.modelloId)) {
      const b = RMCapacitaModelli.BOOST.find(x => x.stili.indexOf(g.stile) !== -1);
      if (b) { c.boostRows = [RMCapacitaModelli.rigaBoost(b)]; c.boostRowsShown = 1; }
    }
    ridisegna(c, { tecab: true, boost: true });
  }

  /* ---------------- passaggio 2: caratteristiche, Q.I., terziarie ---------------- */
  function renderPrimarie(c) {
    const el = contenitore('wiz-step-primary', 'cg-primary', true); if (!el) return;
    const g = guida(c), inp = ingressi(c), cons = consigliaPrimarie(inp);
    const liberi = pool() - sum(c.primary);
    const manuali = K.filter(k => g.manuali.primary[k]);
    const qi = Number(c.qi) || 0;
    const tCons = consigliaTerziarie(inp.stile, inp.voci, inp.modello);
    el.innerHTML = `
      <div class="cg-row cg-sticky"><b>Punti liberi: ${liberi} di ${pool()}</b>
        ${c.primaryConfirmed ? '' : (manuali.length
          ? `<button type="button" class="btn btn-sm btn-primary" data-cg-azione="applica-primarie">Applica ai campi consigliati</button>`
          : `<button type="button" class="btn btn-sm btn-primary" data-cg-azione="usa-primarie">Usa la distribuzione consigliata</button>`)}</div>
      <p class="helper-text">Apri la tendina sotto ogni statistica: valore consigliato, intervallo e motivo. ✎ = valore scritto da te, che i consigli non cambiano.</p>
      ${qi ? `<p class="helper-text">Q.I. ${qi}: le tue capacità salgono di livello ogni ${typeof utilizziBaseForQI === 'function' ? utilizziBaseForQI(qi) : '—'} utilizzi. Il Q.I. si tira, non si sceglie.</p>` : '<p class="helper-text">Tira il Q.I. qui sotto: decide ogni quanti utilizzi le tue capacità salgono di livello.</p>'}
      <div class="cg-row cg-terziarie"><span>Terziarie consigliate: Carisma ${tCons.carisma}, Stile ${tCons.stile}, Fortuna ${tCons.fortuna}</span>
        ${c.primaryConfirmed ? '' : '<button type="button" class="btn btn-sm btn-ghost" data-cg-azione="usa-terziarie">Usa</button>'}</div>`;
    decoraPrimarie(c, cons, inp);
  }
  function decoraPrimarie(c, cons, inp) {
    const wrap = document.getElementById('primary-stats'); if (!wrap) return;
    const g = guida(c);
    const modo = inp.solitaria ? 'solitaria' : 'campagna';
    const m = multDi(c.build, c.eclecticoHpMult);
    wrap.querySelectorAll('.cg-tendina').forEach(x => x.remove());
    if (c.primaryConfirmed || Number(c.livello) > 1) return;
    K.forEach(k => {
      const input = wrap.querySelector(`[data-pstat-input="${k}"]`); if (!input) return;
      const row = input.closest('.stat-row') || input.parentElement;
      const opz = opzioniTendina(k, c.primary, cons, inp);
      const liberi = pool() - sum(c.primary);
      const div = document.createElement('div');
      div.className = 'cg-tendina'; div.dataset.cgStat = k;
      const motivo = (MOTIVO[modo][k] || (() => ''))(m);
      const ruolo = cons.motivi[k] && cons.motivi[k].length ? ' Nel tuo pacchetto: ' + cons.motivi[k].join(', ') + '.' : ' Nel tuo pacchetto non ha un ruolo: basta il minimo.';
      div.innerHTML = `<label><span class="cg-man">${g.manuali.primary[k] ? '✎' : ''}</span>
        <select data-cg-tendina="${k}" aria-label="Valori consigliati per ${NOME[k]}">
          <option value="" selected>${NOME[k]} ${c.primary[k]} · consigliato ${cons.valori[k]} ▾</option>
          ${opz.map(o => `<option value="${o.valore}">${o.valore} · ${esc(o.etichetta)}${o.serve ? ` (serve ${o.serve} punt${o.serve === 1 ? 'o' : 'i'})` : ''}</option>`).join('')}
        </select></label>
        <span class="cg-motivo">${esc(motivo + ruolo)} Puoi mettere da ${minP()} a ${c.primary[k] + liberi} senza spostare punti.</span>
        <span class="cg-fonti" data-cg-fonti="${k}"></span>`;
      row.insertAdjacentElement('afterend', div);
    });
  }
  function sceltaTendina(c, k, val) {
    const g = guida(c), inp = ingressi(c), cons = consigliaPrimarie(inp);
    const o = opzioniTendina(k, c.primary, cons, inp).find(x => x.valore === val); if (!o) return;
    if (!o.serve) {
      c.primary[k] = val;
      g.manuali.primary[k] = val !== cons.valori[k];
      ridisegna(c, { primary: true });
      return;
    }
    const box = document.querySelector(`[data-cg-fonti="${k}"]`); if (!box) return;
    box.innerHTML = `${o.serve === 1 ? 'Serve 1 punto: da dove lo prendi?' : `Servono ${o.serve} punti: da dove li prendi?`} ` + o.fonti.map(f =>
      `<button type="button" class="btn btn-sm btn-ghost" data-cg-sposta="${k}" data-da="${f.stat}" data-valore="${val}">${NOME[f.stat]} ${f.da} → ${f.a} (${esc(f.conseguenza)})</button>`).join(' ');
  }
  function sposta(c, k, da, val) {
    const g = guida(c);
    const serve = val - c.primary[k] - (pool() - sum(c.primary));
    if (serve <= 0 || c.primary[da] - serve < minP()) return;
    c.primary[da] -= serve; c.primary[k] = val;
    g.manuali.primary[k] = true; g.manuali.primary[da] = true;
    ridisegna(c, { primary: true });
  }

  /* ---------------- passaggio 3: tratti ---------------- */
  function renderTratti(c) {
    const el = contenitore('wiz-step-traits', 'cg-traits', true); if (!el) return;
    if (c.traitsConfirmed) { el.innerHTML = ''; return; }
    const g = guida(c), inp = ingressi(c);
    const cons = consigliaTratti(inp, disponibiliTratti(c));
    el.innerHTML = `<p class="helper-text">Consigli per lista: dal tuo pacchetto e dal tuo racconto. ✎ = lista modificata da te.</p>` +
      Object.keys(cons).map(l => `<div class="cg-row"><span>${g.manuali.traits[l] ? '✎ ' : ''}<b>${esc(TRAIT_LIST_LABELS[l])}</b>: ${esc(Object.keys(cons[l]).map(n => `${n} ${cons[l][n]}`).join(', ') || '—')}</span>
        <button type="button" class="btn btn-sm btn-ghost" data-cg-tratti="${l}">Usa questi</button></div>`).join('') +
      `<p class="helper-text">«Arte Combattiva» serve a colpire in mischia, con le tecniche e con le magie online; «Guardia» serve solo con uno scudo${inp.ruoli.arke ? '; ogni azione di Arkè si tira con l\'Arkè' : ''}.</p>`;
  }

  /* ---------------- passaggio 4: tecniche, magie e boost ---------------- */
  function renderCapacita(c) {
    const el = contenitore('wiz-step-tecab', 'cg-tecab', true); if (!el) return;
    const g = guida(c), inp = ingressi(c), solo = solitaria(c);
    const anteprime = righeAnteprima(c, inp);
    let html = '';
    if (solo) {
      const dot = dotazioneSolo(c);
      html += '<p class="helper-text">In questa storia tecniche e magie partono dalla dotazione del tuo gruppo; puoi cambiarle con «Scegli un esempio» o modificarle entro i tetti del livello 1.</p>';
      if (dot && dot.boost[0]) {
        const b = dot.boost[0];
        const usati = (b.bonus || []).map(x => x.stat).filter(s => inp.ruoli.danno.indexOf(s) === -1 && inp.ruoli.colpo.indexOf(s) === -1 && ['vel', 'dmen'].indexOf(s) === -1);
        html += `<p class="helper-text"><b>Il potere del tuo gruppo:</b> ${esc(b.nome)} (${esc((b.bonus || []).map(x => `+${x.valore} ${NOME[x.stat] || x.stat}`).join(', '))}). Attivarlo ${costoBoostLv1()}.${usati.length ? ` Nota: ${esc(usati.map(s => NOME[s] || s).join(', '))} non serve${usati.length > 1 ? 'no' : ''} alle tue azioni principali.` : ''}</p>`;
      }
    } else {
      html += `<div class="cg-row"><span>Riempie gli slot vuoti con capacità di partenza adatte al tuo stile (nome e descrizione restano tuoi).</span>
        <button type="button" class="btn btn-sm btn-ghost" data-cg-azione="riempi-capacita">Proponi capacità</button></div>`;
      html += suggerimentiSlot(c, inp);
      const boostOk = (c.boostRows || []).some(r => String(r.nome || '').trim());
      html += `<p class="helper-text"><b>Boost</b> (il tuo potere, livello 1): attivarlo ${costoBoostLv1()}; raggio 5 metri; lo confermi tu, il Narratore può modificarlo. ${boostOk ? '' : 'Non hai ancora un boost: compilalo qui sotto o scegline uno.'}</p>
        <div class="cg-chips">${RMCapacitaModelli.BOOST.filter(b => b.stili.indexOf(g.stile) !== -1 || b.stili.indexOf(g.stile2) !== -1 || !g.stile).map(b => `<button type="button" class="btn btn-sm btn-ghost" data-cg-boost="${b.id}">${esc(b.nome)}: ${esc(b.bonus.map(x => `+${x.valore} ${NOME[x.name] || x.name}`).join(', '))}</button>`).join('')}</div>`;
    }
    if (anteprime.length) html += '<div class="section-title"><span class="dot neutral"></span>Stima contro un avversario tipico</div>' + anteprime.map(a => `<p class="cg-anteprima">${a}</p>`).join('');
    el.innerHTML = html;
  }
  function suggerimentiSlot(c, inp) {
    const g = guida(c);
    const out = [];
    [['tecnica', 'Tecniche'], ['abilita', 'Magie']].forEach(([kind, label]) => {
      const lista = RMCapacitaModelli.perSlot(kind, { stile: g.stile, stile2: g.stile2, scudo: inp.scudo }).slice(0, 5);
      if (!lista.length) return;
      out.push(`<p class="helper-text"><b>${label} adatte</b>: ${lista.map(m => `<button type="button" class="btn btn-sm btn-ghost" data-cg-capacita="${m.id}" title="${esc(m.nota || '')}">${esc(m.nome)}</button>`).join(' ')}</p>`);
    });
    return out.join('');
  }
  function usaCapacita(c, id) {
    const m = RMCapacitaModelli.modello(id); if (!m) return;
    const f = m.kind === 'tecnica' ? 'tecniche' : 'abilita';
    const inp = ingressi(c);
    const righe = (c[f] || []).filter(r => !r.assignmentId);
    const un = tecAbSbloccate(c.build, 1, c.tecAbChoices, c.tecAbNarratoreBonus);
    const n = f === 'tecniche' ? un.tec : un.ab;
    if (!n) { if (typeof toast === 'function') toast(`La tua classe non ha slot per ${f === 'tecniche' ? 'Tecniche' : 'Magie'} al livello 1`); return; }
    let i = righe.findIndex(r => !String(r.nome || '').trim() || r.modelloId);
    if (i === -1 || i >= n) i = Math.min(righe.length, n) - 1;
    const nuova = RMCapacitaModelli.riga(m, { armaStat: inp.arma && inp.arma.stat === 'dex' ? 'dex' : 'for', qi: c.qi });
    if (righe[i]) Object.assign(righe[i], nuova, { id: righe[i].id, assignmentId: righe[i].assignmentId }); else righe.push(nuova);
    c[f] = righe.concat((c[f] || []).filter(r => r.assignmentId));
    ridisegna(c, { tecab: true });
  }
  function righeAnteprima(c, inp) {
    const out = [], solo = inp.solitaria;
    const trattoVal = n => { const t = c.traits && c.traits.capacitaCombattive; return (t && Number(t[n])) || ((c.customTraits && c.customTraits.capacitaCombattive || []).find(x => x.name === n) || {}).value || 0; };
    const riga = (nome, a) => `${esc(nome)}: danno ${a.intervallo[0]}–${a.intervallo[1]} prima delle difese; colpo riuscito ${Math.round(a.pColpo * 100)}%; ${fmt(a.suColpo)} quando colpisce, ${fmt(a.perAzione)} in media per azione.`;
    if (inp.arma) {
      const stat = inp.arma.stat, a = anteprima({ solitaria: solo, base: Number(inp.arma.atk) || 0, statVal: c.primary[stat] || 0, magico: false, tiro: inp.arma.tiro, colpoTratto: trattoVal('Arte Combattiva'), dex: c.primary.dex, mira: c.primary.mira });
      out.push(riga(inp.arma.nome || 'Attacco con l\'arma', a));
    }
    [].concat((c.tecniche || []).map(r => [r, true]), (c.abilita || []).map(r => [r, false])).forEach(([r, tec]) => {
      if (!String(r.nome || '').trim() || (r.tipo !== 'danno' && r.tipo !== 'misto') || !(Number(r.dannoBase) > 0)) return;
      const magico = r.dannoTipo === 'magico';
      const stat = magico ? 'fmen' : (r.dannoStat || 'for');
      const tratto = r.arke && solo ? 'Arkè' : 'Arte Combattiva';
      // Tecnica: il suo danno si somma all'Atk dell'arma impugnata (DECISIONI_AUTORE §15 I.4a)
      const atkArma = tec && inp.arma ? (Number(inp.arma.atk) || 0) : 0;
      out.push(riga(r.nome + (atkArma ? ` (${Number(r.dannoBase)} + Atk ${atkArma} dell'arma)` : ''), anteprima({ solitaria: solo, base: Number(r.dannoBase) + atkArma, statVal: c.primary[stat] || 0, magico, tiro: false, colpoTratto: trattoVal(tratto), dex: c.primary.dex })));
    });
    return out;
  }

  /* ---------------- passaggio 5: equipaggiamento ---------------- */
  function renderEquip(c) {
    const el = contenitore('wiz-step-equip', 'cg-equip', true); if (!el) return;
    const g = guida(c), solo = solitaria(c);
    if (solo) {
      const dot = dotazioneSolo(c);
      const zaino = typeof zainoPesoComponents === 'function' ? zainoPesoComponents(c).max : null;
      el.innerHTML = dot ? `<p class="helper-text">In questa storia l'equipaggiamento te lo assegna il tuo gruppo: lo ricevi quando inizia la partita.</p>
        <ul class="cg-lista">${dot.equip.filter(e => ['arma', 'armatura', 'scudo'].indexOf(e.tipo) !== -1).map(e => `<li><b>${esc(e.nome)}</b> — ${e.tipo === 'arma' ? `Atk ${e.atk}; ${e.classe === 'tiro' ? `danno con la tua Mira (${c.primary.mira}); per colpire d20 + Arte Combattiva + metà Destrezza` : `usa la tua Forza (${c.primary.for}) per il danno`}` : e.tipo === 'armatura' ? `Difesa ${e.dif}: aggiunge +${armorDifContribution(e.dif)} alla tua Difesa quando un colpo ti raggiunge` : `permette di parare con la Guardia`}</li>`).join('')}</ul>
        ${zaino != null && zaino > 0 ? `<p class="helper-text">Nello zaino puoi portare fino a ${zaino} kg.</p>` : ''}` : '<p class="helper-text">Scegli prima popolo, appartenenza e classe: la dotazione dipende da questi.</p>';
      return;
    }
    const ks = kitsDi(c);
    const aDistanza = g.stile === 'distanza' || g.stile2 === 'distanza';
    let sceltaTiro = '';
    if (aDistanza) {
      const mondo = g.mondo || 'libera';
      const armi = armiTiroMondo(mondo, () => renderEquip(c));
      const sel = g.armaTiro ? g.armaTiro.nome : 'Arco';
      const nota = mondo === 'libera' ? "In una campagna libera il tipo d'arma lo concordi con il Narratore." : `Solo le armi a distanza che esistono in ${MONDI[mondo]}.`;
      sceltaTiro = `<div class="cg-row">
        <label class="cg-label">Mondo della campagna <select data-cg-mondo>${Object.keys(MONDI).map(k => `<option value="${k}" ${k === mondo ? 'selected' : ''}>${MONDI[k]}</option>`).join('')}</select></label>
        <label class="cg-label">Arma a distanza <select data-cg-armatiro>${armi ? armi.map((a, i) => `<option value="${i}" ${a.nome === sel ? 'selected' : ''}>${esc(a.nome)}${a.gruppo ? ' (' + esc(a.gruppo) + ')' : ''}${a.nota ? ' — ' + esc(a.nota) : ''}</option>`).join('') : '<option>carico le armi del mondo…</option>'}</select></label></div>
        <p class="helper-text">${esc(nota)} In campagna l'arma a distanza colpisce con la Mira (Mira + un dado) e fa danno con Atk + Destrezza + un dado; attaccare costa mezzo turno. Il nome non cambia i valori: valgono quelli della tabella per la taglia.</p>`;
    }
    el.innerHTML = sceltaTiro + `<p class="helper-text">Tre kit di partenza (qualità bassa, valori minimi della tabella). Puoi sceglierne uno e poi modificare ogni pezzo qui sotto.${c.build !== 'guerriero' ? ' Per la tua classe: una sola arma e nessuno scudo.' : ''}</p>
      <div class="cg-proposte">${ks.map(k => `<div class="cg-proposta ${g.kitId === k.id ? 'active' : ''}"><b>${k.label}</b><span>${esc(k.obiettivo)}</span>
        <span>${esc(k.armi.map(a => `${a.nome} (Atk ${a.atk}, ${a.tiro ? 'colpisci con la Mira, danno con la Destrezza' : (a.stat === 'dex' ? 'danno con la Destrezza' : 'danno con la Forza')})`).join(' + '))}${k.scudo ? ` · ${esc(k.scudo.nome)} (Dif ${k.scudo.dif}: pari con la Guardia)` : ''} · ${esc(k.armatura.nome)} ${k.armatura.size === 'medie' ? 'media' : 'leggera'}</span>
        <button type="button" class="btn btn-sm ${g.kitId === k.id ? 'btn-ghost' : 'btn-primary'}" data-cg-kit="${k.id}">${g.kitId === k.id ? 'Scelto ✔' : 'Usa questo kit'}</button></div>`).join('')}</div>
      <p class="helper-text">Un'armatura pesante può rallentarti, a giudizio del Narratore.</p>
      ${munizioniHtml(c)}`;
  }
  function munizioniHtml(c) {
    const M = global.RMMunizioni; if (!M) return '';
    const armi = (c.weaponSlots || []).filter(w => M.aDistanza(w) && w.equipaggiato !== false);
    if (!armi.length) return '';
    return `<p class="helper-text cg-munizioni">${armi.map(w => M.usa(w)
      ? `${esc(w.name)}: ${esc(M.etichetta(w, c.consumabili))} (${esc(w.munizione)}). Sparare consuma un colpo pronto anche se manca; ricaricare sposta munizioni dalla riserva.`
      : `${esc(w.name)}: nessun profilo di munizioni per questo nome; capacità e Tr si impostano nella scheda.`).join('<br>')}</p>`;
  }
  function usaKit(c, id) {
    const g = guida(c);
    const k = kitsDi(c).find(x => x.id === id); if (!k) return;
    const carta = (base, p) => Object.assign(base, { name: p.nome, size: p.size, quality: p.quality, atk: p.atk, dif: p.dif, dur: p.dur, durCur: p.dur, peso: p.peso, statsConfirmed: true, equipaggiato: true });
    const ws = [];
    const sc = makeWeaponSlot('scudo'); if (k.scudo) carta(sc, k.scudo); else { sc.equipaggiato = false; }
    ws.push(sc);
    k.armi.forEach((a, i) => { const w = makeWeaponSlot('arma'); carta(w, a); w.name = a.nome || 'Arma ' + (i + 1); w.weaponClass = a.tiro ? 'tiro' : 'bianca'; w.usaFor = a.stat !== 'dex'; w.usaDex = a.stat === 'dex'; ws.push(w); });
    c.weaponSlots = ws;
    // Munizioni (js/munizioni.js). PROPOSTA DA APPROVARE: profilo per tipo d'arma, arma carica e una
    // riserva di partenza (3 caricatori, almeno 10). Un nome senza profilo resta senza munizioni.
    const riserve = (c.consumabili || []).filter(r => !r.daGuida);
    ws.filter(w => w.weaponClass === 'tiro').forEach(w => {
      if (global.RMMunizioni && RMMunizioni.applicaProfilo(w, RMMunizioni.profiloPer(w.name))) {
        riserve.push({ nome: w.munizione, effetto: RMMunizioni.EFFETTO, munizione: w.munizione, quantita: Math.max(10, w.capacita * 3), valore: 0, target: '', targetListKey: '', durationQuarters: 12, daGuida: true });
      }
    });
    c.consumabili = riserve;
    const slots = defaultSlots(); carta(slots[1], k.armatura); c.slots = slots; // armatura sul Busto, come la solitaria (solo-link.js equipDaPartita)
    g.kitId = id;
    ridisegna(c, { equip: true });
    renderEquip(c);
  }

  /* ---------------- passaggio 6: riepilogo ---------------- */
  function renderRiepilogo(c) {
    const body = document.getElementById('wiz-summary-body'); if (!body) return;
    let el = document.getElementById('cg-summary');
    if (!el) { el = document.createElement('div'); el.id = 'cg-summary'; el.className = 'cg-panel'; }
    body.appendChild(el);
    const inp = ingressi(c), m = multDi(c.build, c.eclecticoHpMult);
    const hp = c.primary.hp * m[0], mp = c.primary.mp * m[1];
    const forze = [], limiti = [];
    forze.push(`${hp} HP`);
    if (inp.ruoli.costoMp) { const n = Math.floor(mp / 6); (n >= 4 ? forze : limiti).push(`${n} magie di livello 1 con gli MP pieni (${mp} MP)`); } else if (mp < 6) limiti.push('nessuna magia');
    if (hp < 30) limiti.push(`fragile: ${hp} HP`);
    const senzaRuolo = K.filter(k => k !== 'hp' && c.primary[k] > 1 && !consigliaPrimarie(inp).motivi[k].length);
    const avvisi = senzaRuolo.map(k => `Hai ${c.primary[k]} punti in ${NOME[k]}: nel tuo pacchetto non ${inp.solitaria && k === 'dif' ? 'entra nei tiri' : 'ha un ruolo'}.`);
    const az = righeAnteprima(c, inp);
    el.innerHTML = `<div class="section-title"><span class="dot neutral"></span>Forze e limiti</div>
      <p>${esc(forze.join(' · '))}${limiti.length ? ' — ' + esc(limiti.join(' · ')) : ''}</p>
      ${az.length ? '<div class="section-title"><span class="dot neutral"></span>Azioni caratteristiche</div>' + az.map(a => `<p class="cg-anteprima">${a}</p>`).join('') : ''}
      ${avvisi.length ? `<p class="helper-text">${esc(avvisi.join(' '))}</p>` : ''}`;
  }

  /* ================================================================== cablaggio */
  function cabla() {
    if (cablato || typeof document === 'undefined') return;
    cablato = true;
    const root = document.getElementById('view-create') || document.body;
    root.addEventListener('click', e => {
      const c = typeof getActive === 'function' ? getActive() : null; if (!c || !global.wizardActiveRef()) return;
      const t = e.target.closest('[data-cg-modo],[data-cg-modello],[data-cg-proposta],[data-cg-azione],[data-cg-sposta],[data-cg-tratti],[data-cg-capacita],[data-cg-boost],[data-cg-kit]');
      if (!t) return;
      const g = guida(c);
      if (t.dataset.cgModo) { g.modo = t.dataset.cgModo; salva(c); renderIdea(c); return; }
      if (t.dataset.cgModello) {
        const m = modelli().find(x => x.id === t.dataset.cgModello); if (!m) return;
        g.modelloId = m.id; g.stile = m.stile; salva(c); renderIdea(c); return;
      }
      if (t.dataset.cgProposta) { applicaProposta(c, t.dataset.classe, t.dataset.stile, t.dataset.stile2, t.dataset.cgProposta, t.dataset.priorita); return; }
      if (t.dataset.cgSposta) { sposta(c, t.dataset.cgSposta, t.dataset.da, Number(t.dataset.valore)); return; }
      if (t.dataset.cgTratti) { const inp = ingressi(c); const l = t.dataset.cgTratti; const cons = consigliaTratti(inp, disponibiliTratti(c)); const keep = {}; Object.keys(cons).forEach(x => { if (x !== l) keep[x] = true; });
        const salvati = Object.assign({}, g.manuali.traits); g.manuali.traits = Object.assign({}, keep); applicaTratti(c, inp, true); g.manuali.traits = Object.assign(salvati, { [l]: false }); ridisegna(c, { traits: true }); renderTratti(c); return; }
      if (t.dataset.cgCapacita) { usaCapacita(c, t.dataset.cgCapacita); renderCapacita(c); return; }
      if (t.dataset.cgBoost) { const b = RMCapacitaModelli.boostModello(t.dataset.cgBoost); if (b) { c.boostRows = [RMCapacitaModelli.rigaBoost(b)]; c.boostRowsShown = 1; ridisegna(c, { boost: true }); renderCapacita(c); } return; }
      if (t.dataset.cgKit) { usaKit(c, t.dataset.cgKit); return; }
      const az = t.dataset.cgAzione;
      if (az === 'usa-primarie') { const cons = consigliaPrimarie(ingressi(c)); c.primary = Object.assign({}, c.primary, cons.valori); g.manuali.primary = {}; ridisegna(c, { primary: true }); }
      if (az === 'applica-primarie') {
        const r = applicaConsigliati(c.primary, consigliaPrimarie(ingressi(c)).valori, g.manuali.primary);
        if (r.errore) { if (typeof toast === 'function') toast(r.errore); return; }
        c.primary = r.valori; ridisegna(c, { primary: true });
      }
      if (az === 'usa-terziarie') { const inp = ingressi(c); c.tertiary = Object.assign({}, c.tertiary, consigliaTerziarie(inp.stile, inp.voci, inp.modello)); g.manuali.tertiary = false; ridisegna(c, { tertiary: true }); }
      if (az === 'riempi-capacita') riempiCapacitaCampagna(c);
      renderPasso(c);
    });
    root.addEventListener('change', e => {
      const c = typeof getActive === 'function' ? getActive() : null; if (!c || !global.wizardActiveRef()) return;
      const g = guida(c), t = e.target;
      if (t.matches('[data-cg-parola]')) {
        const id = t.dataset.cgParola, i = g.paroleConfermate.indexOf(id);
        if (t.checked && i === -1) g.paroleConfermate.push(id); else if (!t.checked && i !== -1) g.paroleConfermate.splice(i, 1);
        if (!g.stile) { const s = stiliDaParole(paroleChiave(g.testo).filter(v => g.paroleConfermate.indexOf(v.id) !== -1)); if (s[0]) g.stile = s[0]; }
        salva(c); renderIdea(c); return;
      }
      if (t.matches('[data-cg-stile]')) { if (t.dataset.cgStile === '1') g.stile = t.value || null; else g.stile2 = t.value || null; g.propostaId = null; salva(c); renderIdea(c); return; }
      if (t.matches('[data-cg-mondo]')) { g.mondo = t.value; g.armaTiro = null; salva(c); if (g.kitId) usaKit(c, g.kitId); else renderEquip(c); return; }
      if (t.matches('[data-cg-armatiro]')) {
        const a = (armiTiroMondo(g.mondo || 'libera') || [])[Number(t.value)];
        if (a) { g.armaTiro = { nome: a.nome, size: a.size }; salva(c); if (g.kitId) usaKit(c, g.kitId); else renderEquip(c); }
        return;
      }
      if (t.matches('[data-cg-tendina]')) { if (t.value !== '') sceltaTendina(c, t.dataset.cgTendina, Number(t.value)); return; }
    });
    root.addEventListener('input', e => {
      const c = typeof getActive === 'function' ? getActive() : null; if (!c || !global.wizardActiveRef()) return;
      const g = guida(c), t = e.target;
      if (t.id === 'cg-testo') { g.testo = t.value; salva(c); return; }
      // valori scritti a mano: restano finché il giocatore non sceglie di applicare nuovi consigli
      const p = t.closest && t.closest('[data-pstat-input]'); if (p) { g.manuali.primary[p.dataset.pstatInput] = true; aggiornaPrimarieDopo(); return; }
      if (t.closest && t.closest('#tertiary-stats')) { g.manuali.tertiary = true; return; }
      const tl = t.closest && t.closest('#trait-lists [data-list]'); if (tl) { g.manuali.traits[tl.dataset.list] = true; return; }
      const tc = t.closest && t.closest('#tecniche-table, #abilita-table'); if (tc) { (c.tecniche || []).concat(c.abilita || []).forEach(r => { if (r.modelloId) r.guidaModificata = true; }); }
    }, true);
    root.addEventListener('click', e => {
      const c = typeof getActive === 'function' ? getActive() : null; if (!c || !global.wizardActiveRef()) return;
      const g = guida(c);
      const b = e.target.closest && e.target.closest('#primary-stats [data-pstat]'); if (b) { g.manuali.primary[b.dataset.pstat] = true; aggiornaPrimarieDopo(); }
      const tb = e.target.closest && e.target.closest('#tertiary-stats button[data-dir]'); if (tb) g.manuali.tertiary = true;
      const trb = e.target.closest && e.target.closest('#trait-lists [data-list] button[data-dir]'); if (trb) g.manuali.traits[trb.closest('[data-list]').dataset.list] = true;
    }, true);
    // il blocco delle primarie si ridisegna spesso (stepper, conferme): le tendine si rimettono dopo ogni ridisegno
    const wrap = document.getElementById('primary-stats');
    if (wrap && typeof MutationObserver !== 'undefined') {
      osservatore = new MutationObserver(() => {
        const c = typeof getActive === 'function' ? getActive() : null;
        if (!c || !global.wizardActiveRef() || wrap.querySelector('.cg-tendina') || !wrap.querySelector('[data-pstat-input]')) return;
        const inp = ingressi(c); decoraPrimarie(c, consigliaPrimarie(inp), inp);
        const top = document.getElementById('cg-primary'); if (top && top.isConnected) renderPrimarieTesta(c);
      });
      osservatore.observe(wrap, { childList: true });
    }
  }
  // dopo una modifica a mano: punti liberi, pulsante «Applica ai campi consigliati» e tendine si aggiornano (dopo il gestore di app.js)
  function aggiornaPrimarieDopo() {
    setTimeout(() => {
      const c = typeof getActive === 'function' ? getActive() : null;
      if (c && global.wizardActiveRef() && document.getElementById('cg-primary')) renderPrimarieTesta(c);
    }, 0);
  }
  function renderPrimarieTesta(c) { const sc = window.scrollY; renderPrimarie(c); window.scrollTo(0, sc); }

  /* Punto d'ingresso chiamato da renderWizardStep (js/app.js) a ogni cambio di passo. */
  function renderPasso(c, stepKey) {
    if (!c) return;
    cabla();
    const k = stepKey || (typeof WIZARD_STEPS !== 'undefined' && typeof wizardStepIndex !== 'undefined' ? WIZARD_STEPS[wizardStepIndex].key : null);
    try {
      if (solitaria(c)) dotazioneSolitaria(c); // anche dopo un cambio di classe fatto cliccando direttamente la scheda
      if (k === 'build') renderIdea(c);
      if (k === 'primary') renderPrimarie(c);
      if (k === 'traits') renderTratti(c);
      if (k === 'tecab') renderCapacita(c);
      if (k === 'equip') renderEquip(c);
      if (k === 'summary') renderRiepilogo(c);
    } catch (e) { console.error('creazione guidata', e); }
  }
  function chiudi() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('#primary-stats .cg-tendina').forEach(x => x.remove());
  }
  global.wizardActiveRef = global.wizardActiveRef || (() => (typeof wizardActive !== 'undefined' ? wizardActive : false));

  const api = { K, STILI, DIZIONARIO, TERZIARIE, paroleChiave, stiliDaParole, modelli, ruoli, consigliaPrimarie, applicaConsigliati, opzioniTendina,
    consigliaTerziarie, consigliaTratti, proposte, nomeBuild, anteprima, kits, renderPasso, chiudi, ingressi, MONDI, ARMI_LIBERE };
  global.RMCreazioneGuidata = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
