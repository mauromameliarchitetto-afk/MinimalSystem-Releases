/* ==========================================================================
   Randomizer NPC — genera una scheda personaggio completa e coerente con le
   regole ufficiali (fronte scheda, retro scheda/equip, tecniche e abilità)
   per un PNG del Narratore, a partire da un archetipo + parametri scelti in
   "Gestisci campagna > PNG > Randomize NPC" (vedi wiring in cloud-account.js).

   Riusa per intero l'economia già definita in data.js/app.js (pool primarie/
   terziarie/tratti, tabella AP per livello, range Atk/Dif/Dur equip, sblocco
   Tecniche/Abilità per build+livello): nessuna regola nuova, solo scelte
   casuali pesate dentro i limiti ufficiali. Funzioni pure, nessun accesso al
   DOM — l'oggetto restituito è pronto per newCharacter-shape (ensureShape) e
   per essere salvato via narratore_create_npc.
   ========================================================================== */

/* Archetipi: ogni voce suggerisce pesi (non vincoli rigidi) per classe,
   pesantezza equip, qualità equip, classe d'arma, presenza scudo e quali
   tratti pescare per primi — "coerenti con il tipo di NPC" come richiesto,
   senza inventare contenuto meccanico nuovo (solo nomi di tratti/tecniche
   generici, sempre rinominabili a mano dal Narratore). */
const NPC_ARCHETYPES = [
  { key: 'guardia', label: 'La Guardia',
    buildWeights: { guerriero: 70, eclettico: 25, mago: 5 },
    weightClassWeights: { leggero: 10, medio: 45, pesante: 45 },
    qualityWeights: { bassa: 45, media: 40, alta: 15 },
    weaponClassWeights: { bianca: 85, tiro: 15 }, shieldChance: 70,
    statBias: ['for', 'dif'], tertiaryBias: null,
    traitBias: { capacitaCombattive: ['Guardia', 'Tattica Militare', 'Resistenza'], capacitaNormali: ['Percezione', 'Intimidire'], conoscenze: ['Politica'] } },
  { key: 'ladro', label: 'Il Ladro',
    buildWeights: { guerriero: 30, eclettico: 60, mago: 10 },
    weightClassWeights: { leggero: 75, medio: 22, pesante: 3 },
    qualityWeights: { bassa: 40, media: 45, alta: 15 },
    weaponClassWeights: { bianca: 70, tiro: 30 }, shieldChance: 5,
    statBias: ['dex', 'vel'], tertiaryBias: 'fortuna',
    traitBias: { capacitaNormali: ['Scassinare', 'Furtività', 'Intuito Olfattivo'], conoscenze: ['Bassifondi'], capacitaCombattive: ['Elusione'] } },
  { key: 'hacker', label: "L'Hacker",
    buildWeights: { guerriero: 5, eclettico: 40, mago: 55 },
    weightClassWeights: { leggero: 80, medio: 18, pesante: 2 },
    qualityWeights: { bassa: 25, media: 45, alta: 30 },
    weaponClassWeights: { bianca: 30, tiro: 70 }, shieldChance: 5,
    statBias: ['fmen', 'dex'], tertiaryBias: null,
    traitBias: { capacitaNormali: ['Scassinare', 'Percezione'], conoscenze: ['Meccanica'], capacitaCombattive: ['Spirito'] } },
  { key: 'arciere', label: 'Il Cecchino',
    buildWeights: { guerriero: 75, eclettico: 22, mago: 3 },
    weightClassWeights: { leggero: 55, medio: 40, pesante: 5 },
    qualityWeights: { bassa: 35, media: 45, alta: 20 },
    weaponClassWeights: { bianca: 5, tiro: 95 }, shieldChance: 5,
    statBias: ['mira', 'dex'], tertiaryBias: null,
    traitBias: { capacitaCombattive: ['Arco', 'Elusione'], capacitaNormali: ['Percezione'], conoscenze: ['Caccia'] } },
  { key: 'mercenario', label: 'Il Mercenario',
    buildWeights: { guerriero: 60, eclettico: 35, mago: 5 },
    weightClassWeights: { leggero: 15, medio: 55, pesante: 30 },
    qualityWeights: { bassa: 40, media: 40, alta: 20 },
    weaponClassWeights: { bianca: 80, tiro: 20 }, shieldChance: 40,
    statBias: ['for', 'vel'], tertiaryBias: 'stile',
    traitBias: { capacitaCombattive: ['Tattica Militare', 'Spada', 'Ascia'], capacitaNormali: ['Intimidire'], conoscenze: ["Gioco d'Azzardo"] } },
  { key: 'cultista', label: 'Il Cultista',
    buildWeights: { guerriero: 5, eclettico: 30, mago: 65 },
    weightClassWeights: { leggero: 70, medio: 25, pesante: 5 },
    qualityWeights: { bassa: 30, media: 40, alta: 30 },
    weaponClassWeights: { bianca: 40, tiro: 60 }, shieldChance: 10,
    statBias: ['fmen', 'dmen'], tertiaryBias: null,
    traitBias: { capacitaCombattive: ['Spirito'], conoscenze: ['Politica', 'Sopravvivenza'], capacitaNormali: ['Persuasione'] } },
  { key: 'guaritore', label: 'Il Guaritore',
    buildWeights: { guerriero: 5, eclettico: 45, mago: 50 },
    weightClassWeights: { leggero: 60, medio: 35, pesante: 5 },
    qualityWeights: { bassa: 25, media: 45, alta: 30 },
    weaponClassWeights: { bianca: 50, tiro: 50 }, shieldChance: 20,
    statBias: ['fmen', 'dmen'], tertiaryBias: 'carisma',
    traitBias: { capacitaCombattive: ['Guarigione', 'Spirito'], capacitaNormali: ['Percezione'], conoscenze: ['Flora'] } },
  { key: 'nobile', label: 'Il Nobile',
    buildWeights: { guerriero: 20, eclettico: 55, mago: 25 },
    weightClassWeights: { leggero: 55, medio: 35, pesante: 10 },
    qualityWeights: { bassa: 10, media: 35, alta: 55 },
    weaponClassWeights: { bianca: 70, tiro: 30 }, shieldChance: 15,
    statBias: ['dmen'], tertiaryBias: 'carisma',
    traitBias: { capacitaNormali: ['Persuasione', 'Contrattazione'], conoscenze: ['Politica'], capacitaCombattive: ['Spirito'] } },
  { key: 'contrabbandiere', label: 'Il Contrabbandiere',
    buildWeights: { guerriero: 30, eclettico: 55, mago: 15 },
    weightClassWeights: { leggero: 45, medio: 45, pesante: 10 },
    qualityWeights: { bassa: 35, media: 45, alta: 20 },
    weaponClassWeights: { bianca: 55, tiro: 45 }, shieldChance: 15,
    statBias: ['dex', 'mira'], tertiaryBias: 'fortuna',
    traitBias: { conoscenze: ['Navigare', 'Guidare'], capacitaNormali: ['Contrattazione', 'Furtività'], capacitaCombattive: [] } },
  { key: 'bandito', label: 'Il Bandito',
    buildWeights: { guerriero: 65, eclettico: 30, mago: 5 },
    weightClassWeights: { leggero: 40, medio: 45, pesante: 15 },
    qualityWeights: { bassa: 60, media: 32, alta: 8 },
    weaponClassWeights: { bianca: 75, tiro: 25 }, shieldChance: 25,
    statBias: ['for', 'vel'], tertiaryBias: null,
    traitBias: { capacitaCombattive: ['Ascia', 'Spada'], capacitaNormali: ['Intimidire'], conoscenze: ['Bassifondi'] } },
  { key: 'esploratore', label: "L'Esploratore",
    buildWeights: { guerriero: 55, eclettico: 40, mago: 5 },
    weightClassWeights: { leggero: 55, medio: 40, pesante: 5 },
    qualityWeights: { bassa: 45, media: 40, alta: 15 },
    weaponClassWeights: { bianca: 55, tiro: 45 }, shieldChance: 15,
    statBias: ['vel', 'dex'], tertiaryBias: null,
    traitBias: { conoscenze: ['Orientamento', 'Sopravvivenza', 'Seguire Tracce'], capacitaNormali: ['Scalare', 'Nuotare'], capacitaCombattive: [] } },
  { key: 'cacciatore_taglie', label: 'Il Cacciatore di Taglie',
    buildWeights: { guerriero: 55, eclettico: 40, mago: 5 },
    weightClassWeights: { leggero: 30, medio: 50, pesante: 20 },
    qualityWeights: { bassa: 30, media: 45, alta: 25 },
    weaponClassWeights: { bianca: 55, tiro: 45 }, shieldChance: 20,
    statBias: ['dex', 'mira'], tertiaryBias: null,
    traitBias: { capacitaNormali: ['Percezione', 'Intimidire'], capacitaCombattive: ['Elusione'], conoscenze: ['Seguire Tracce'] } }
];

function npcArchetypeByKey(key) {
  return NPC_ARCHETYPES.find(a => a.key === key) || NPC_ARCHETYPES[0];
}

/* ---------------------------------------------------------- utility dado */

function npcRandInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function npcPick(arr) {
  return arr[npcRandInt(0, arr.length - 1)];
}
function npcWeightedPick(weights) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!total) return Object.keys(weights)[0];
  let r = Math.random() * total;
  for (const [k, w] of entries) { if (r < w) return k; r -= w; }
  return entries[entries.length - 1][0];
}

/* Randomizza classe/qualità/pesantezza/conteggio Tecniche+Abilità coerenti
   con l'archetipo scelto — usata sia per il "🎲 tira tutti" iniziale sia dai
   dadini per-campo della schermata Randomize NPC. */
function rollNpcSuggestedParams(archetypeKey, level) {
  const a = npcArchetypeByKey(archetypeKey);
  const build = npcWeightedPick(a.buildWeights);
  const equipQuality = npcWeightedPick(a.qualityWeights);
  const pesantezza = npcWeightedPick(a.weightClassWeights);
  const unlocked = tecAbSbloccate(build, level || 1, {});
  const maxTecAb = unlocked.tec + unlocked.ab;
  const tecabCount = maxTecAb > 0 ? npcRandInt(Math.max(1, Math.ceil(maxTecAb / 2)), maxTecAb) : 0;
  return { build, equipQuality, pesantezza, tecabCount, maxTecAb };
}

/* -------------------------------------------------------- pool statistiche */

/* Un unico peso per statistica (primarie + P.R. + terziarie) usato sia per
   il pool di creazione (Lv1) sia per la spesa AP dei livelli successivi:
   coerenza garantita perché è la STESSA distribuzione a guidare entrambe le
   fasi — un "Hacker" pesca più F.MEN/DEX in entrambe, mai solo alla nascita.

   Coppie di caratteristiche tipiche per classe (indicate dall'utente): un
   Guerriero pesca su FOR e/o DEX+DIF; un Mago su F.MEN+D.MEN; un Eclettico è
   ibrido — una fra tre varianti tipiche (guerriero-mago FOR+F.MEN, ladro
   DEX+VEL, mago leggero F.MEN+D.MEN). MIRA non è mai centrale di suo: dipende
   dal tipo di arma che questo PNG userà davvero (bianca o da tiro, vedi
   weaponClass), coerente con l'equip che gli viene poi assegnato. */
function npcStatWeights(buildKey, archetype, weaponClass) {
  const weights = {};
  PRIMARY_STATS.forEach(s => { weights[s.key] = 1; });
  weights.hp = 2.2; weights.mp = 2.2; // sempre rilevanti, nessuna specializzazione di classe le esclude

  // Gli HP crescono a "costo AP" molto più basso delle primarie (vedi
  // hpApCostForPoint/primaryApCostForPoint in data.js: 1 AP a punto fino a
  // 100 HP, contro 10-15+ AP a punto oltre la trentina per una primaria) —
  // con pesi comparabili a for/dex/dif il numero di "estrazioni" totali che
  // npcSpendApGrowth può permettersi resta comunque piccolo, e un peso solo
  // leggermente più alto lasciava gli HP indietro rispetto a una Forza che
  // invece consuma AP a bracciate: un Guerriero finiva fortissimo ma di
  // vetro (es. Lv14 con FOR 41 e appena 61 HP). Un peso HP nettamente più
  // alto per chi incassa i colpi in prima linea risolve alla radice, non
  // solo attenua.
  if (buildKey === 'guerriero') {
    weights.for = 3;
    weights.dex = 2; weights.dif = 2;
    weights.hp = 5.5; // guerriero: tanky, non solo forte
  } else if (buildKey === 'mago') {
    weights.fmen = 3; weights.dmen = 3;
    weights.mp = 3.2;
  } else {
    const flavor = npcPick(['guerriero_mago', 'ladro', 'mago_leggero']);
    if (flavor === 'guerriero_mago') { weights.for = 2.5; weights.fmen = 2.5; weights.dif = 1.6; weights.dmen = 1.6; weights.hp = 4.2; }
    else if (flavor === 'ladro') { weights.dex = 2.5; weights.vel = 2.5; weights.fmen = 1.6; }
    else { weights.fmen = 2.2; weights.dmen = 1.8; weights.dex = 1.6; weights.mp = 2.8; }
  }

  weights.mira = weaponClass === 'tiro' ? 3 : 0.9;

  if (archetype.statBias) archetype.statBias.forEach(k => { if (weights[k] !== undefined) weights[k] *= 1.6; });
  weights.pr = 1.2;
  TERTIARY_STATS.forEach(s => { weights['t_' + s.key] = (archetype.tertiaryBias === s.key) ? 2.5 : 0.8; });
  return weights;
}

/* Pool dei 40 punti primari (Lv1, PRIMARY_MIN=1 ciascuna): distribuzione
   pesata invece che uniforme, così l'asse della classe (e l'eventuale bias
   d'archetipo) restano riconoscibili anche al livello più basso. */
function rollPrimaryPool(weights) {
  const primary = {};
  PRIMARY_STATS.forEach(s => { primary[s.key] = PRIMARY_MIN; });
  let remaining = PRIMARY_POOL - PRIMARY_STATS.length * PRIMARY_MIN;
  const w = {}; PRIMARY_STATS.forEach(s => { w[s.key] = weights[s.key]; });
  while (remaining > 0) { primary[npcWeightedPick(w)]++; remaining--; }
  return primary;
}

/* Pool terziario: la SOMMA di Stile+Fortuna+Carisma deve fare esattamente
   TERTIARY_POOL (5) — si parte da 0 per tutte e tre (vedi defaultTertiary)
   e si assegna un punto alla volta, mai sotto zero per restare in una
   scheda "pronta" senza bisogno di aggiustamenti manuali. */
function rollTertiaryPool(weights) {
  const tertiary = {};
  TERTIARY_STATS.forEach(s => { tertiary[s.key] = 0; });
  const w = {}; TERTIARY_STATS.forEach(s => { w[s.key] = weights['t_' + s.key]; });
  for (let i = 0; i < TERTIARY_POOL; i++) tertiary[npcWeightedPick(w)]++;
  return tertiary;
}

/* Un tratto per lista (Conoscenze/Capacità Normali/Capacità Combattive): pool
   di TRAIT_POOL_PER_LIST + bonus di livello per quella lista. Meglio poche
   voci ma alte che tante voci a 1: invece di spargere il pool su tutti i
   nomi disponibili, si sceglie prima un piccolo sottoinsieme di voci
   "attive" (pickActiveTraitNames, preferendo quelle indicate dall'archetipo)
   e SOLO quelle ricevono punti — le altre voci ufficiali della lista restano
   a 0 per questo PNG, non escluse per sempre (il Narratore può comunque
   editarle a mano dalla scheda completa). */
function rollTraitList(listKey, level, preferredNames) {
  const pool = TRAIT_POOL_PER_LIST + (traitBonusAtLevel(level || 1)[listKey] || 0);
  const names = TRAIT_LISTS[listKey];
  let candidateNames = names;
  if (listKey === 'capacitaCombattive') {
    const allowedWeapons = new Set(pickWeaponSpecializations(preferredNames));
    candidateNames = names.filter(n => !WEAPON_TRAIT_ALL.includes(n) || allowedWeapons.has(n));
  }
  const activeNames = pickActiveTraitNames(candidateNames, preferredNames, pool);
  const weights = {};
  activeNames.forEach(n => { weights[n] = (preferredNames || []).includes(n) ? 3 : 1; });
  const values = {}; names.forEach(n => { values[n] = 0; });
  for (let i = 0; i < pool; i++) values[npcWeightedPick(weights)]++;
  return values;
}

/* Quante voci diverse ricevono punti in una lista di tratti, dato il pool
   disponibile: mai più di 3, e mai così tante da lasciare in media meno di
   ~2 punti a voce (altrimenti si torna al vecchio spargimento a 1). */
function activeTraitNameCount(pool) {
  if (pool <= 3) return 1;
  return Math.min(3, Math.floor(pool / 2));
}
function pickActiveTraitNames(candidateNames, preferredNames, pool) {
  const count = Math.min(activeTraitNameCount(pool), candidateNames.length);
  const preferred = npcShuffle(candidateNames.filter(n => (preferredNames || []).includes(n)));
  const rest = npcShuffle(candidateNames.filter(n => !preferred.includes(n)));
  return preferred.concat(rest).slice(0, count);
}

/* Specializzazioni d'arma dentro Capacità Combattive: un PNG non deve mai
   risultare specializzato in "tutte le armi" — al massimo 3 specializzazioni
   totali, di cui al massimo 1 da tiro (Arco) e al massimo 2 bianche (Ascia/
   Spada/Lancia/Spadone). Le altre voci della lista (Tattica Militare,
   Guardia, Guarigione, Elusione, Resistenza, Arte Combattiva, Spirito) non
   sono armi e restano sempre pescabili, senza questo tetto. */
const WEAPON_TRAIT_RANGED = ['Arco'];
const WEAPON_TRAIT_MELEE = ['Ascia', 'Spada', 'Lancia', 'Spadone'];
const WEAPON_TRAIT_ALL = WEAPON_TRAIT_RANGED.concat(WEAPON_TRAIT_MELEE);
const WEAPON_SPECS_MAX_RANGED = 1;
const WEAPON_SPECS_MAX_MELEE = 2;

function npcShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = npcRandInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickWeaponSpecializations(preferredNames) {
  function pickN(pool, max) {
    const preferred = npcShuffle(pool.filter(n => (preferredNames || []).includes(n)));
    const rest = npcShuffle(pool.filter(n => !preferred.includes(n)));
    return preferred.concat(rest).slice(0, max);
  }
  return pickN(WEAPON_TRAIT_RANGED, WEAPON_SPECS_MAX_RANGED)
    .concat(pickN(WEAPON_TRAIT_MELEE, WEAPON_SPECS_MAX_MELEE));
}

/* -------------------------------------------------------------- crescita AP */

function npcTotalApBudget(level) {
  let total = 0;
  for (let l = 2; l <= level; l++) {
    const r = LEVEL_TABLE.find(x => x.lv === l);
    if (r) total += r.ap;
  }
  return total;
}

/* Spende l'intero budget AP dei livelli 2..livello su HP/MP/P.R./primarie/
   terziarie con le stesse funzioni di costo del gioco vero (hpApCostForPoint
   ecc.): a ogni iterazione sceglie fra i bersagli ancora acquistabili con
   l'AP residuo, pesati come il pool di Lv1 (npcStatWeights) così la crescita
   resta coerente con l'archetipo anche ai livelli alti. */
function npcSpendApGrowth(c, apBudget, weights) {
  const targets = [
    { id: 'hp', get: () => c.hpMaxTracked, set: v => { c.hpMaxTracked = v; }, cost: hpApCostForPoint, cap: Infinity, w: weights.hp, concentrationExempt: true },
    { id: 'mp', get: () => c.mpMaxTracked, set: v => { c.mpMaxTracked = v; }, cost: mpApCostForPoint, cap: Infinity, w: weights.mp, concentrationExempt: true },
    { id: 'pr', get: () => c.prMaxTracked, set: v => { c.prMaxTracked = v; }, cost: primaryApCostForPoint, cap: PR_MAX, w: weights.pr }
  ];
  ['for', 'mira', 'vel', 'fmen', 'dex', 'dif', 'dmen'].forEach(key => {
    targets.push({ id: key, get: () => c.primary[key], set: v => { c.primary[key] = v; }, cost: primaryApCostForPoint, cap: Infinity, w: weights[key] });
  });
  TERTIARY_STATS.forEach(s => {
    targets.push({ id: 't_' + s.key, get: () => c.tertiary[s.key], set: v => { c.tertiary[s.key] = v; }, cost: tertiaryApCostForPoint, cap: TERTIARY_MAX, w: weights['t_' + s.key] });
  });

  // Nessuna singola statistica "di prodezza" (primarie non HP/MP, P.R.,
  // terziarie) può assorbire più di questa quota dell'intero budget AP di
  // una carriera: senza un tetto, la scelta pesata ripetuta può per puro
  // caso incanalarci la maggior parte dei punti (es. Forza a 41 con 213
  // dei 590 AP totali di un Lv14, o una sola fra Carisma/Stile/Fortuna al
  // tetto mentre le altre due restano a 0 — implausibile: un personaggio
  // che sale 13 livelli investe su più assi, non quasi tutto in uno). HP/MP
  // restano esenti: sono le uniche due dove una forte concentrazione (es.
  // un guerriero "tank") resta coerente con la crescita, vedi npcStatWeights.
  const CONCENTRATION_CAP_SHARE = 0.3;
  const spent = {};
  targets.forEach(t => { spent[t.id] = 0; });

  let budget = apBudget;
  let safety = 20000; // limite anti-loop-infinito, mai raggiunto in pratica
  while (budget > 0 && safety-- > 0) {
    const capped = targets.filter(t => {
      if (t.get() + 1 > t.cap) return false;
      const cost = t.cost(t.get() + 1);
      if (cost > budget) return false;
      return t.concentrationExempt || spent[t.id] + cost <= apBudget * CONCENTRATION_CAP_SHARE;
    });
    // Valvola di sicurezza: se il tetto di concentrazione esclude tutto
    // (AP residuo spendibile solo su bersagli già alla loro quota), meglio
    // sforarlo che sprecare AP fino alla fine del budget.
    const affordable = capped.length ? capped : targets.filter(t => t.get() + 1 <= t.cap && t.cost(t.get() + 1) <= budget);
    if (!affordable.length) break;
    const w = {}; affordable.forEach(t => { w[t.id] = t.w; });
    const chosenId = npcWeightedPick(w);
    const t = affordable.find(x => x.id === chosenId);
    const nextVal = t.get() + 1;
    const cost = t.cost(nextVal);
    budget -= cost;
    spent[t.id] += cost;
    t.set(nextVal);
  }
}

/* --------------------------------------------------------------- equip */

const NPC_EQUIP_SIZE_BY_WEIGHTCLASS = {
  leggero: { arma: 'corte', scudo: 'piccoli', armatura: 'leggere' },
  medio: { arma: 'medie', scudo: 'medi', armatura: 'medie' },
  pesante: { arma: 'grandi', scudo: 'grandi', armatura: 'pesanti' }
};
const NPC_EQUIP_PESO_BY_TYPE = {
  arma: { corte: 1.5, medie: 3.5, grandi: 6 },
  scudo: { piccoli: 2, medi: 4, grandi: 7 },
  armatura: { leggere: 4, medie: 8, pesanti: 14 }
};

function npcRollEquipPiece(kind, size, quality) {
  const range = equipRange(kind, size, quality);
  const typeDef = EQUIP_TYPES.find(t => t.key === kind);
  const sizeDef = typeDef.sizes.find(s => s.key === size);
  return {
    kind, size, quality,
    label: `${typeDef.label} ${sizeDef.label}`,
    atk: npcRandInt(range.atk[0], range.atk[1]),
    dif: npcRandInt(range.dif[0], range.dif[1]),
    dur: npcRandInt(range.dur[0], range.dur[1]),
    peso: NPC_EQUIP_PESO_BY_TYPE[kind][size]
  };
}

/* Arma+scudo (fronte scheda): riempie i due weaponSlots già presenti su un
   personaggio nuovo (defaultWeaponSlots). Lo scudo resta creato ma
   equipaggiato:false se l'archetipo non ne prevede uno (shieldChance) — così
   il Narratore lo trova pronto se preferisce comunque assegnarlo. */
function npcFillWeaponSlots(c, pesantezza, quality, archetype, weaponClass) {
  const sizes = NPC_EQUIP_SIZE_BY_WEIGHTCLASS[pesantezza];
  const arma = c.weaponSlots.find(s => s.kind === 'arma');
  const piece = npcRollEquipPiece('arma', sizes.arma, quality);
  Object.assign(arma, { name: piece.label, size: piece.size, quality: piece.quality, atk: piece.atk, dif: piece.dif, dur: piece.dur, durCur: piece.dur, peso: piece.peso, statsConfirmed: true, equipaggiato: true, weaponClass, usaFor: weaponClass === 'bianca', usaDex: weaponClass === 'tiro', usaFmen: false });

  const scudo = c.weaponSlots.find(s => s.kind === 'scudo');
  const hasShield = npcRandInt(1, 100) <= archetype.shieldChance;
  if (hasShield) {
    const sp = npcRollEquipPiece('scudo', sizes.scudo, quality);
    Object.assign(scudo, { name: sp.label, size: sp.size, quality: sp.quality, atk: sp.atk, dif: sp.dif, dur: sp.dur, durCur: sp.dur, peso: sp.peso, statsConfirmed: true, equipaggiato: true });
  } else {
    scudo.equipaggiato = false;
  }
}

/* Armatura (retro scheda): un solo pezzo rappresentativo sul Busto — le
   altre 5 locazioni (Capo/Braccia/Gambe) restano vuote, pronte per essere
   completate a mano dal Narratore se vuole infittire l'equip di questo PNG. */
function npcFillArmorSlots(c, pesantezza, quality) {
  const sizes = NPC_EQUIP_SIZE_BY_WEIGHTCLASS[pesantezza];
  const piece = npcRollEquipPiece('armatura', sizes.armatura, quality);
  const busto = c.slots.find(s => s.name === 'Busto');
  Object.assign(busto, { size: piece.size, quality: piece.quality, atk: piece.atk, dif: piece.dif, dur: piece.dur, durCur: piece.dur, peso: piece.peso, statsConfirmed: true, equipaggiato: true });
}

/* ---------------------------------------------------------- tecniche/abilità */

function npcRollTecAbSplit(buildKey, level, wantedTotal) {
  const unlocked = tecAbSbloccate(buildKey, level, {});
  const maxTotal = unlocked.tec + unlocked.ab;
  const total = Math.max(0, Math.min(wantedTotal, maxTotal));
  let tecCount = maxTotal > 0 ? Math.round(total * (unlocked.tec / maxTotal)) : 0;
  tecCount = Math.min(tecCount, unlocked.tec);
  let abCount = Math.min(total - tecCount, unlocked.ab);
  let leftover = total - tecCount - abCount;
  if (leftover > 0 && tecCount < unlocked.tec) { const add = Math.min(leftover, unlocked.tec - tecCount); tecCount += add; leftover -= add; }
  if (leftover > 0 && abCount < unlocked.ab) { const add = Math.min(leftover, unlocked.ab - abCount); abCount += add; leftover -= add; }
  return { tecCount, abCount };
}

/* Lv interno della riga (utilizzi/costo derivano da questo, non dal livello
   del personaggio — vedi recomputeTecnicaRow/recomputeAbilitaRow): sempre 1
   alla generazione, come qualunque Tecnica/Abilità appena imparata — sale
   solo con gli utilizzi accumulati in gioco (regola da manuale), mai in
   base a QUANDO è stata sbloccata. Una scala legata al livello di sblocco
   era stata provata in passato (bug corretto allora: un PNG Lv14 con 4
   Tecniche le mostrava tutte "Lv 7" identico) ma sostituita con una scala
   altrettanto priva di fondamento nelle regole (Lv sblocco / 2) — entrambe
   errate, corretto qui alla radice. */
/* Un Tipo "Supporto" senza bonusItems è una riga vuota — nessun effetto in
   gioco, anche se compare come Tecnica/Abilità apparentemente valida (vedi
   tecAbRowIsComplete, che infatti la richiede per considerarla completa):
   prima di questo fix il ramo 'supporto' lasciava r.bonusItems al default
   [] di makeTecnicaRow/makeAbilitaRow, quindi circa 1 Tecnica/Abilità su 3
   generata da un PNG (npcPick(['supporto','danno','danno'])) risultava
   inerte in combattimento senza alcun avviso. Un bonus fisso su una
   statistica primaria coerente con l'archetipo (statBias, se presente)
   resta sempre valido da assegnare: PRIMARY_STATS è un elenco chiuso, mai
   dipendente dai tratti che questo specifico personaggio possiede già
   (a differenza di un bonus su un tratto di lista, che richiederebbe quel
   tratto già presente in c.shownTraits per essere selezionabile in scheda). */
function npcRollSupportoBonusItems(statBias, level) {
  const pool = (statBias && statBias.length) ? statBias : PRIMARY_STATS.filter(s => s.key !== 'hp' && s.key !== 'mp').map(s => s.key);
  const statKey = npcPick(pool);
  return [{ listKey: 'primaria', name: statKey, valore: npcRandInt(2, 4) + Math.floor((level || 1) / 4) }];
}
function npcRollTecnicaRow(archetypeLabel, idx, buildAxis, level, qi, statBias) {
  const r = makeTecnicaRow();
  r.nome = `${archetypeLabel} — Tecnica ${idx}`;
  r.tempoAzione = npcPick(['quarto', 'mezzo', 'turno']);
  r.durata = npcPick(['gratuita', 'quarto', 'mezzo']);
  r.lv = '1';
  r.attiva = true;
  r.tipo = npcPick(['supporto', 'danno', 'danno']);
  if (r.tipo === 'supporto') r.bonusItems = npcRollSupportoBonusItems(statBias, level);
  r.dannoTipo = buildAxis === 'magic' ? 'magico' : (buildAxis === 'physical' ? 'fisico' : npcPick(['fisico', 'magico']));
  r.dannoStat = npcPick(['for', 'dex']);
  r.dannoBase = r.tipo === 'danno' ? npcRandInt(5, 15) + Math.floor((level || 1) / 2) : 0;
  recomputeTecnicaRow(r, qi);
  return r;
}
function npcRollAbilitaRow(archetypeLabel, idx, buildAxis, level, qi, statBias) {
  const r = makeAbilitaRow();
  r.nome = `${archetypeLabel} — Abilità ${idx}`;
  r.tempoAzione = npcPick(['quarto', 'mezzo', 'turno']);
  r.durata = npcPick(['gratuita', 'quarto', 'mezzo']);
  r.lv = '1';
  r.attiva = true;
  r.tipo = npcPick(['supporto', 'danno', 'danno']);
  if (r.tipo === 'supporto') r.bonusItems = npcRollSupportoBonusItems(statBias, level);
  r.dannoTipo = buildAxis === 'magic' ? 'magico' : (buildAxis === 'physical' ? 'fisico' : npcPick(['fisico', 'magico']));
  r.dannoStat = npcPick(['for', 'dex']);
  r.dannoBase = r.tipo === 'danno' ? npcRandInt(5, 15) + Math.floor((level || 1) / 2) : 0;
  recomputeAbilitaRow(r, qi);
  return r;
}

/* ------------------------------------------------------------- entry point */

/* Genera l'intera scheda (data pronta per narratore_create_npc) a partire da
   { archetypeKey, build, level, equipQuality, pesantezza, tecabCount, name }.
   Non tocca mai il DOM: chi la chiama (cloud-account.js) si occupa solo di
   presentare i parametri e salvare il risultato. */
function generateNpcCharacterData(opts) {
  const archetype = npcArchetypeByKey(opts.archetypeKey);
  const buildKey = opts.build && BUILDS[opts.build] ? opts.build : npcWeightedPick(archetype.buildWeights);
  const level = clamp(parseInt(opts.level, 10) || 1, 1, 20);
  const equipQuality = opts.equipQuality && EQUIP_QUALITIES.some(q => q.key === opts.equipQuality) ? opts.equipQuality : npcWeightedPick(archetype.qualityWeights);
  const pesantezza = opts.pesantezza && NPC_EQUIP_SIZE_BY_WEIGHTCLASS[opts.pesantezza] ? opts.pesantezza : npcWeightedPick(archetype.weightClassWeights);

  const c = newCharacter(opts.name || archetype.label);
  c.build = buildKey;
  c.buildConfirmed = true;
  c.creationCompleted = true;
  c.livello = level;
  c.livelloAP = level;
  c.eclecticoHpMult = (pesantezza === 'pesante') ? 7 : (pesantezza === 'leggero' ? 5 : npcPick([7, 5]));
  c.qi = npcRandInt(70, 140);

  // Scelta dell'arma PRIMA delle statistiche: Mira dipende da quale arma
  // questo PNG userà davvero (da tiro o bianca, vedi npcStatWeights),
  // altrimenti la statistica e l'equip risulterebbero scollegati.
  const weaponClass = npcWeightedPick(archetype.weaponClassWeights);
  const weights = npcStatWeights(buildKey, archetype, weaponClass);

  // ---- fronte scheda: primarie, PR, terziarie, tratti (Lv1) ----
  c.primary = rollPrimaryPool(weights);
  c.tertiary = rollTertiaryPool(weights);
  c.primaryConfirmed = true;
  c.traitsConfirmed = true;
  Object.keys(TRAIT_LISTS).forEach(listKey => {
    c.traits[listKey] = rollTraitList(listKey, level, (archetype.traitBias && archetype.traitBias[listKey]) || []);
    c.shownTraits[listKey] = TRAIT_LISTS[listKey].filter(n => (c.traits[listKey][n] || 0) > 0);
  });
  // i valori tirati sopra sono già "confermati" (traitsConfirmed impostato
  // prima): il pavimento va comunque registrato ORA che i tratti esistono
  // davvero, altrimenti un successivo level-up del PNG partirebbe senza
  // alcuna protezione (stesso motivo di snapshotTraitsFloor in js/app.js).
  snapshotTraitsFloor(c);

  // ---- crescita Lv2..N via AP (HP/MP/P.R./primarie/terziarie) ----
  const hpMult = currentHpMult(c), mpMult = currentMpMult(c);
  c.hpMaxTracked = Number(c.primary.hp) * hpMult;
  c.mpMaxTracked = Number(c.primary.mp) * mpMult;
  c.prMaxTracked = BUILDS[buildKey].prIniziali;
  if (level > 1) npcSpendApGrowth(c, npcTotalApBudget(level), weights);
  c.hpCur = c.hpMaxTracked; c.mpCur = c.mpMaxTracked; c.prCur = c.prMaxTracked;
  c.ppCur = c.hpMaxTracked / 2 + c.mpMaxTracked / 2;
  c.apDisponibili = 0;

  // ---- retro scheda / equip ----
  npcFillWeaponSlots(c, pesantezza, equipQuality, archetype, weaponClass);
  npcFillArmorSlots(c, pesantezza, equipQuality);

  // ---- tecniche e abilità ----
  const unlocked = tecAbSbloccate(buildKey, level, {});
  const maxTecAb = unlocked.tec + unlocked.ab;
  const wantedTotal = opts.tecabCount != null ? clamp(parseInt(opts.tecabCount, 10) || 0, 0, maxTecAb) : maxTecAb;
  const split = npcRollTecAbSplit(buildKey, level, wantedTotal);
  c.tecniche = [];
  for (let i = 1; i <= split.tecCount; i++) c.tecniche.push(npcRollTecnicaRow(archetype.label, i, BUILDS[buildKey].axis, level, c.qi, archetype.statBias));
  c.abilita = [];
  for (let i = 1; i <= split.abCount; i++) c.abilita.push(npcRollAbilitaRow(archetype.label, i, BUILDS[buildKey].axis, level, c.qi, archetype.statBias));

  ensureShape(c);
  return c;
}
