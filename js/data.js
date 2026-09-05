/* ==========================================================================
   Role Makers — Companion App
   Dati di gioco ufficiali (da "Role Makers System — Manuale di Gioco" e
   estratto_contenuti_per_app.md). Nessun contenuto inventato: dove il
   manuale lascia un campo aperto, l'app lo espone come inserimento libero
   invece di indovinare un valore.
   ========================================================================== */

const BUILDS = {
  guerriero: {
    key: 'guerriero',
    label: 'Guerriero',
    axis: 'physical',
    hpMult: 10,
    mpMult: 2,
    dotazione: '2 Tecniche',
    prIniziali: 10,
    swappable: false
  },
  eclettico: {
    key: 'eclettico',
    label: 'Eclettico',
    axis: 'bicolor',
    hpMultOptions: [7, 5],
    mpMultOptions: [5, 7],
    dotazione: '1 Tecnica + 1 Abilità magica',
    prIniziali: 8,
    swappable: true
  },
  mago: {
    key: 'mago',
    label: 'Mago',
    axis: 'magic',
    hpMult: 3,
    mpMult: 9,
    dotazione: '2 Abilità magiche',
    prIniziali: 10,
    swappable: false
  }
};

// Boost compilabili del retro scheda: si parte con 1, massimo 2
const BOOST_ROWS_MAX = 2;
const MAX_LEVEL = 30;

// Sblocco di Tecniche e Abilità per build e livello (tabella limiti di livello):
// Lv 1 dotazione iniziale · Lv 4/12/20/28 acquisizione di classe
// (Guerriero 2 Tec · Eclettico 1+1 · Mago 2 Ab) · Lv 8/16/24 tutte le classi 1 Tec + 1 Ab.
// Ai Lv 8/16/24 l'Eclettico può scegliere 2 Tec, 2 Ab o 1+1. Gli apprendimenti
// supremi nascono direttamente al Lv 2 (soglia personaggio 24) e al Lv 3
// (soglia personaggio 28); usarli su una voce esistente conserva il +1 Lv
// previsto dal sistema precedente.
const TECAB_CLASS_LEVELS = [4, 12, 20, 28];
const TECAB_ALL_LEVELS = [8, 16, 24];
// Solo l'Eclettico sceglie, ai Lv 8/16/24, tra 2 Tecniche / 2 Abilità / 1+1.
// choices e' un oggetto indicizzato per livello, non impostato = '1+1'.
function tecAbSbloccate(buildKey, lv, choices, bonus) {
  let tec = 0, ab = 0;
  if (buildKey === 'guerriero') tec += 2;
  else if (buildKey === 'mago') ab += 2;
  else { tec += 1; ab += 1; }
  const classi = TECAB_CLASS_LEVELS.filter(l => lv >= l).length;
  if (buildKey === 'guerriero') tec += 2 * classi;
  else if (buildKey === 'mago') ab += 2 * classi;
  else { tec += classi; ab += classi; }
  TECAB_ALL_LEVELS.filter(l => lv >= l).forEach(l => {
    if (buildKey === 'eclettico') {
      const scelta = (choices && choices[l]) || '1+1';
      if (scelta === '2tec') tec += 2;
      else if (scelta === '2ab') ab += 2;
      else { tec += 1; ab += 1; }
    } else {
      tec += 1; ab += 1;
    }
  });
  // apprendimenti extra concessi dal Narratore fuori budget (addestramento/
  // studio in giocata, mai una scelta del giocatore) — vedi tecAbNarratoreBonus.
  if (bonus) { tec += Number(bonus.tec) || 0; ab += Number(bonus.ab) || 0; }
  return { tec, ab };
}
function prossimoSblocco(lv) {
  return TECAB_CLASS_LEVELS.concat(TECAB_ALL_LEVELS).sort((a, b) => a - b).find(l => l > lv) || null;
}
// Livello iniziale delle assegnazioni maturate a ogni soglia. Serve al
// registro persistente per distinguere gli slot supremi Lv 24/28 da quelli
// ordinari, anche quando un personaggio attraversa più livelli in una volta.
function tecabGrantLevels(buildKey, lv, choices, key) {
  const out = { tec: [], ab: [] };
  const milestones = TECAB_CLASS_LEVELS.map(level => ({ level, kind: 'class' }))
    .concat(TECAB_ALL_LEVELS.map(level => ({ level, kind: 'all' })))
    .sort((a, b) => a.level - b.level);
  milestones.filter(m => lv >= m.level).forEach(m => {
    const initialLv = m.level === 24 ? 2 : m.level === 28 ? 3 : 1;
    let tec = 0, ab = 0;
    if (m.kind === 'class') {
      if (buildKey === 'guerriero') tec = 2;
      else if (buildKey === 'mago') ab = 2;
      else { tec = 1; ab = 1; }
    } else if (buildKey === 'eclettico') {
      const scelta = (choices && choices[m.level]) || '1+1';
      if (scelta === '2tec') tec = 2;
      else if (scelta === '2ab') ab = 2;
      else { tec = 1; ab = 1; }
    } else { tec = 1; ab = 1; }
    for (let i = 0; i < tec; i++) out.tec.push(initialLv);
    for (let i = 0; i < ab; i++) out.ab.push(initialLv);
  });
  return out[key] || [];
}

// 9 caratteristiche primarie — pool 40 punti, minimo 1 ciascuna (il manuale
// è esplicito: "sono 9". Il P.R. NON è tra queste: è l'unica statistica
// secondaria — vedi SECONDARY_STATS — fissa da classe alla creazione e mai
// parte del pool dei 40 punti). "FRZ" invece di "FOR" per non confondersi
// con Fortuna (statistica terziaria, tutt'altra cosa).
const PRIMARY_STATS = [
  { key: 'hp',   label: 'HP',    full: 'Punti Vita',       axis: 'neutral' },
  { key: 'mp',   label: 'MP',    full: 'Punti Magia',      axis: 'neutral' },
  { key: 'for',  label: 'FRZ',   full: 'Forza',            axis: 'physical' },
  { key: 'mira', label: 'MIRA',  full: 'Mira',             axis: 'physical' },
  { key: 'vel',  label: 'VEL',   full: 'Velocità',         axis: 'physical' },
  { key: 'fmen', label: 'F.MEN', full: 'Forza Magica',     axis: 'magic' },
  { key: 'dex',  label: 'DEX',   full: 'Destrezza',        axis: 'physical' },
  { key: 'dif',  label: 'DIF',   full: 'Difesa',           axis: 'physical' },
  { key: 'dmen', label: 'D.MEN', full: 'Difesa Magica',    axis: 'magic' }
];
const PRIMARY_POOL = 40;
const PRIMARY_MIN = 1;
// L'unica statistica secondaria (manuale, "Distribuzione delle statistiche
// secondarie: Q.I. e P.R."): fissa da classe (BUILDS[...].prIniziali) alla
// creazione, dal Lv2 cresce con gli AP secondo le stesse regole delle
// primarie (primaryApCostForPoint) — ma non è una di esse e non entra nel
// pool dei 40 punti.
const SECONDARY_STATS = [
  { key: 'pr', label: 'P.R.', full: 'Punti Recupero', axis: 'neutral' }
];

// Bersagli validi per un bonus di "rigenerazione" dell'equipaggiamento
// (funzione opzionale, non di manuale): solo le tre risorse che si
// consumano davvero in gioco, mai una statistica — quelle restano ai bonus
// statici (kind 'primary'/'trait').
const EQUIP_REGEN_TARGETS = [
  { key: 'hp', label: 'HP' },
  { key: 'mp', label: 'MP' },
  { key: 'pp', label: 'PP' }
];

// Statistiche terziarie — pool 5 punti, minimo -1 ciascuna
const TERTIARY_STATS = [
  { key: 'stile',   label: 'Stile' },
  { key: 'fortuna', label: 'Fortuna' },
  { key: 'carisma', label: 'Carisma' }
];
const TERTIARY_POOL = 5;
const TERTIARY_MIN = -1;
const TERTIARY_MAX = 20;

const TERTIARY_ROLL_TABLE = [
  { range: '1–5',   carisma: 'Interpretazione perfetta richiesta', altro: 'Poco spettacolare / molto sfortunata' },
  { range: '6–11',  carisma: 'Interpretazione ottima',              altro: 'Media spettacolarità / un po\' sfortunata' },
  { range: '12–17', carisma: 'Interpretazione normale',             altro: 'Grande spettacolarità / fortunata' },
  { range: '18–20', carisma: 'Interpretazione sotto la norma',      altro: 'Incredibile / molto fortunata' }
];

// Costo in AP per raggiungere ciascun valore di statistica terziaria: regola
// ufficiale, "valore del livello da raggiungere x 4" (es. Carisma 3 -> 4
// costa 4 x 4 = 16 AP). Sotto la soglia gratuita (0 e il minimo -1, mai un
// obiettivo comprato con AP: si parte già lì con la point-buy libera) il
// costo resta 0.
const TERTIARY_AP_TABLE = {};
for (let n = -1; n <= 20; n++) TERTIARY_AP_TABLE[String(n)] = n > 0 ? n * 4 : 0;

// Catalogo dei 12 stati negativi che una Tecnica/Abilità a Danno può
// infliggere (distinti da Rompere/Tramortire, che restano sul loro
// meccanismo a tiro Resistenza/Resistenza/Spirito): il tiro d'ingresso è
// sempre un dado contrapposto percentuale (vedi submit_attack_defense_roll
// nella migrazione status_effects_bruciare_avvelenare), mai lo stesso tiro
// "sempre dovuto" di Rompere/Tramortire. Solo Bruciare e Avvelenare hanno
// oggi una conseguenza meccanica collegata (danno nel tempo sul motore
// combat_active_effects già esistente); gli altri 10 sono già nel catalogo
// (nome, icona, durata in turni) per l'editor/i badge, in attesa del
// meccanismo specifico di ciascuno in un prossimo passaggio.
const STATUS_EFFECTS = [
  { key: 'bruciare', label: 'Bruciare', icon: '🔥', turns: 3 },
  { key: 'elettrificare', label: 'Elettrificare', icon: '⚡', turns: 1 },
  { key: 'congelare', label: 'Congelare', icon: '❄️', turns: 5 },
  { key: 'avvelenare', label: 'Avvelenare', icon: '☠️', turns: 5 },
  { key: 'sanguinare', label: 'Sanguinare', icon: '🩸', turns: 3 },
  { key: 'accecare', label: 'Accecare', icon: '👁️', turns: 2 },
  { key: 'rallentare', label: 'Rallentare', icon: '🐌', turns: 3 },
  { key: 'immobilizzare', label: 'Immobilizzare', icon: '⛓️', turns: 2 },
  { key: 'stordire', label: 'Stordire', icon: '💫', turns: 1 },
  { key: 'confondere', label: 'Confondere', icon: '❓', turns: 2 },
  { key: 'silenziare', label: 'Silenziare', icon: '🔇', turns: 2 },
  { key: 'corrodere', label: 'Corrodere', icon: '🧪', turns: 3 }
];
function statusEffectByName(name) {
  const key = String(name || '').trim().toLowerCase();
  return STATUS_EFFECTS.find(s => s.key === key) || null;
}
// Tramortire non è nel catalogo dei 12 (resta un nome storico, insieme a
// Rompere) ma dalla revisione del suo meccanismo usa lo STESSO tiro
// contrapposto percentuale d'ingresso degli altri stati — a differenza di
// Rompere, che resta sul vecchio tiro Resistenza/Resistenza/Spirito. Questo
// helper copre entrambe le fonti (catalogo + Tramortire) ovunque serva
// decidere "questo effetto usa il dado percentuale?", senza far finta che
// Tramortire faccia parte del catalogo scelto dal Narratore nell'editor.
function percentContestStatusInfo(name) {
  const key = String(name || '').trim().toLowerCase();
  if (key === 'tramortire') return { key: 'tramortire', label: 'Tramortire', icon: '💫', turns: null };
  return statusEffectByName(key);
}

// Tratti: Conoscenze, Capacità Normali, Capacità Combattive — liste APERTE (il manuale
// include "Etc...": non esaustive per esplicita scelta della fonte)
const TRAIT_LISTS = {
  conoscenze: ['Architettura', 'Bassifondi', 'Caccia', 'Cavalcare', 'Fauna', 'Flora',
    'Free Running', 'Geografia', "Gioco d'Azzardo", 'Guidare', 'Meccanica', 'Navigare',
    'Orientamento', 'Pesca', 'Politica', 'Seguire Tracce', 'Sopravvivenza'],
  capacitaNormali: ['Riparare', 'Scassinare', 'Lanciare', 'Furtività', 'Contrattazione',
    'Percezione', 'Ascoltare', 'Intuito Olfattivo', 'Persuasione', 'Provocare',
    'Intimidire', 'Nuotare', 'Scalare', 'Hacking'],
  capacitaCombattive: ['Tattica Militare', 'Ascia', 'Spada', 'Lancia', 'Arco', 'Spadone',
    // "Resistenza" unifica il vecchio "Robustezza" (vedi migrateLegacyResistanceTrait
    // e la migrazione SQL 20260912000000_rename_legacy_trait_to_resistenza) — una
    // sola voce, mai due: il duplicato introdotto da quella migrazione è un bug,
    // corretto qui (vedi anche il test generico anti-duplicati sulle TRAIT_LISTS).
    'Guardia', 'Guarigione', 'Elusione', 'Resistenza', 'Arte Combattiva', 'Spirito', 'Difesa Mentale',
    // Consente di equipaggiare un secondo scudo (una mano ciascuno) — senza
    // questo tratto resta un solo scudo equipaggiabile alla volta, vedi
    // il controllo su data-slotequip in wireEquipGrid.
    'Guardia a Torre']
};
// Alla creazione (Lv 1): 15 punti in totale, divisi in tre pool separati e
// NON fungibili tra loro (5 a testa) — Conoscenze, Capacità Normali e
// Capacità Combattive sono tre "tipologie di punti" indipendenti: i punti
// di una non si possono spendere sulle altre due. Dal Lv 2 in poi la
// tabella limiti di livello aggiunge, per ciascuna categoria, solo il
// bonus di quella categoria (vedi perkGainForLevel/traitBonusAtLevel).
const TRAIT_POOL = 15;
const TRAIT_POOL_PER_LIST = TRAIT_POOL / 3;

const TRAIT_LIST_LABELS = {
  conoscenze: 'Conoscenze',
  capacitaNormali: 'Capacità Normali',
  capacitaCombattive: 'Capacità Combattive'
};

// Punti spendibili in una singola categoria (conoscenze/capacitaNormali/
// capacitaCombattive) al livello dato: quota di creazione + solo il bonus
// di QUELLA categoria dai level-up attraversati.
function traitsPoolForList(listKey, livello) {
  const bonus = traitBonusAtLevel(livello || 1);
  return TRAIT_POOL_PER_LIST + (bonus[listKey] || 0);
}

// Equipaggiamento (retro scheda): range di Atk/Dif/Durabilità per tipo,
// taglia e qualità, come da tabella ufficiale del manuale
const EQUIP_TYPES = [
  { key: 'arma',     label: 'Arma',     sizes: [{ key: 'corte',   label: 'Corta'   }, { key: 'medie',   label: 'Media'   }, { key: 'grandi',  label: 'Grande'  }] },
  { key: 'scudo',    label: 'Scudo',    sizes: [{ key: 'piccoli', label: 'Piccolo' }, { key: 'medi',    label: 'Medio'   }, { key: 'grandi',  label: 'Grande'  }] },
  { key: 'armatura', label: 'Armatura', sizes: [{ key: 'leggere', label: 'Leggera' }, { key: 'medie',   label: 'Media'   }, { key: 'pesanti', label: 'Pesante' }] }
];
const EQUIP_QUALITIES = [
  { key: 'bassa', label: 'Bassa' },
  { key: 'media', label: 'Media' },
  { key: 'alta',  label: 'Alta'  }
];
const EQUIP_TABLE = {
  arma: {
    corte:  { bassa: { atk: [8, 18],  dif: [4, 15],  dur: [80, 200] },  media: { atk: [12, 24], dif: [14, 21], dur: [120, 220] }, alta: { atk: [34, 50], dif: [22, 28], dur: [240, 380] } },
    medie:  { bassa: { atk: [10, 25], dif: [8, 20],  dur: [100, 250] }, media: { atk: [18, 35], dif: [25, 30], dur: [140, 300] }, alta: { atk: [55, 70], dif: [32, 38], dur: [320, 440] } },
    grandi: { bassa: { atk: [15, 35], dif: [12, 25], dur: [120, 300] }, media: { atk: [30, 55], dif: [35, 41], dur: [160, 350] }, alta: { atk: [75, 90], dif: [42, 48], dur: [370, 500] } }
  },
  scudo: {
    piccoli: { bassa: { atk: [4, 10],  dif: [8, 18],  dur: [80, 200] },  media: { atk: [8, 15],  dif: [12, 24], dur: [120, 220] }, alta: { atk: [12, 20], dif: [25, 35], dur: [240, 380] } },
    medi:    { bassa: { atk: [10, 18], dif: [10, 20], dur: [100, 250] }, media: { atk: [15, 24], dif: [25, 30], dur: [140, 300] }, alta: { atk: [20, 28], dif: [32, 38], dur: [320, 440] } },
    grandi:  { bassa: { atk: [12, 25], dif: [15, 30], dur: [120, 300] }, media: { atk: [20, 35], dif: [32, 60], dur: [160, 350] }, alta: { atk: [35, 50], dif: [70, 90], dur: [370, 500] } }
  },
  armatura: {
    leggere: { bassa: { atk: [0, 2],   dif: [1, 10],  dur: [50, 120] },  media: { atk: [2, 5],   dif: [10, 20], dur: [140, 210] }, alta: { atk: [8, 12],  dif: [20, 30], dur: [230, 300] } },
    medie:   { bassa: { atk: [5, 10],  dif: [5, 15],  dur: [80, 140] },  media: { atk: [8, 15],  dif: [15, 25], dur: [180, 240] }, alta: { atk: [15, 20], dif: [25, 35], dur: [260, 340] } },
    pesanti: { bassa: { atk: [10, 15], dif: [25, 35], dur: [180, 230] }, media: { atk: [15, 20], dif: [25, 35], dur: [260, 350] }, alta: { atk: [25, 30], dif: [40, 60], dur: [360, 500] } }
  }
};
function equipRange(type, size, quality) {
  const t = EQUIP_TABLE[type];
  const s = t && t[size];
  const q = s && s[quality];
  return q || null;
}

/* ---------------------------------------------------- Durabilità (Ipotesi 2)
   Regola concordata per la perdita di Durabilità di armature/scudi/armi, sia
   fuori combattimento ("Subisci un colpo") sia nel combattimento cloud, sia
   quando un'arma attacca sia quando uno scudo blocca. Non è invenzione: ogni
   costante qui sotto è stata calibrata per riprodurre — in uno scontro "a
   specchio" (bersaglio colpito da un attaccante di pari Resistenza) — i
   target di rottura concordati a parole con l'utente (colpi medi a rottura).

   Resistenza (R): un punteggio per cella qualità×taglia, condiviso fra tutte
   le categorie, usato per calcolare il "rapporto di scontro" fra il pezzo
   colpito e ciò che lo ha colpito (arma reale, o R_GENERICO se il danno non
   ha un pezzo attaccante fisico: mani nude, magia, danno ambientale/
   periodico — R_GENERICO = R(Media,Pesante) = 18, identico in entrambe le
   tabelle).

   P: il coefficiente di perdita base per cella, calibrato (ricerca binaria
   diretta sulla simulazione, non decomposizione approssimata) perché, con
   rapporto di scontro 1:1, il numero medio di colpi a rottura coincida col
   target R della stessa cella.
   Armature: bassa 7/8/9, media 12/15/18, alta 15/20/25 (leggera/media/pesante).
   Armi e scudi: bassa 9/10/11, media 12/15/18, alta 16/20/25 (idem). */
const DURABILITY_R = {
  armatura: {
    bassa: { leggera: 7, media: 8, pesante: 9 },
    media: { leggera: 12, media: 15, pesante: 18 },
    alta: { leggera: 15, media: 20, pesante: 25 }
  },
  arma_scudo: {
    bassa: { leggera: 9, media: 10, pesante: 11 },
    media: { leggera: 12, media: 15, pesante: 18 },
    alta: { leggera: 16, media: 20, pesante: 25 }
  }
};
const DURABILITY_P = {
  armatura: {
    bassa: { leggera: 16.1290, media: 13.4228, pesante: 11.4943 },
    media: { leggera: 7.5472, media: 5.2219, pesante: 3.6232 },
    alta: { leggera: 5.2219, media: 2.7855, pesante: 1.0976 }
  },
  arma_scudo: {
    bassa: { leggera: 11.4943, media: 9.9010, pesante: 8.6207 },
    media: { leggera: 7.5472, media: 5.2219, pesante: 3.6232 },
    alta: { leggera: 4.6296, media: 2.7855, pesante: 1.0976 }
  }
};
// Valore neutro per colpi senza un pezzo attaccante fisico (mani nude, magia,
// danno ambientale/periodico) — R(Media,Pesante), identico in entrambe le tabelle.
const DURABILITY_R_GENERICO = 18;
const DURABILITY_DANNO_RIFERIMENTO = 18;
// Trasformazione asimmetrica del rapporto di scontro grezzo R(attaccante)/R(bersaglio):
// compressa (penalità attenuata) quando >=1, espansa (bonus amplificato) quando <1 —
// calibrata sugli scenari concordati (es. arma Alta/Pesante contro armatura Bassa/Leggera).
const DURABILITY_K_HIGH = 0.3398;
const DURABILITY_K_LOW = 2.062;

// Normalizza le chiavi taglia di arma ('corte'/'medie'/'grandi'), scudo
// ('piccoli'/'medi'/'grandi') e armatura ('leggere'/'medie'/'pesanti') sulle
// tre fasce leggera/media/pesante condivise dalla tabella di Resistenza.
const DURABILITY_SIZE_MAP = {
  corte: 'leggera', piccoli: 'leggera', leggere: 'leggera',
  medie: 'media', medi: 'media',
  grandi: 'pesante', pesanti: 'pesante'
};
function durabilityCategoria(kind) {
  return kind === 'armatura' ? 'armatura' : 'arma_scudo';
}
function durabilityTaglia(size) {
  return DURABILITY_SIZE_MAP[size] || 'media';
}
function durabilityResistenza(pezzo) {
  if (!pezzo) return DURABILITY_R_GENERICO;
  const cat = durabilityCategoria(pezzo.kind);
  const t = durabilityTaglia(pezzo.size);
  const q = DURABILITY_R[cat] && DURABILITY_R[cat][pezzo.quality];
  return (q && q[t]) || DURABILITY_R_GENERICO;
}
function durabilityCoefficienteP(pezzo) {
  const cat = durabilityCategoria(pezzo.kind);
  const t = durabilityTaglia(pezzo.size);
  const q = DURABILITY_P[cat] && DURABILITY_P[cat][pezzo.quality];
  return (q && q[t]) || DURABILITY_P.arma_scudo.media.media;
}
function durabilityRapportoEffettivo(rapportoGrezzo) {
  if (!(rapportoGrezzo > 0)) return 1;
  return rapportoGrezzo >= 1
    ? Math.pow(rapportoGrezzo, DURABILITY_K_HIGH)
    : Math.pow(rapportoGrezzo, DURABILITY_K_LOW);
}

/* Calcola la perdita di Durabilità di `bersaglio` (pezzo colpito) quando
   colpito da `attaccante` (pezzo che ha colpito, o null per un colpo senza
   pezzo fisico: mani nude, magia, danno ambientale/periodico).
   bersaglio/attaccante: { kind: 'arma'|'scudo'|'armatura', quality, size, dur }
   dannoReale: danno finale già calcolato (dopo riduzione da difesa/critico,
     PRIMA che Sovracura/hpBuffer o scudo energetico lo intercettino — Sovracura
     non deve mai influire su questo calcolo, né in più né in meno).
   trattoResistenza: valore del tratto Resistenza (ex Robustezza, unificato in
     main "Unifica Robustezza nel tratto Resistenza") di chi porta/impugna il bersaglio.
   rng: generatore [0,1) sostituibile per i test (default Math.random).
   Non applica nulla: ritorna solo { perdita, ramo, dettagli } — il chiamante
   scala su durCur e clampa a 0. */
function durabilityCalcolaPerdita({ bersaglio, attaccante, dannoReale, trattoResistenza, rng }) {
  const rand = rng || Math.random;
  const roll = (n) => 1 + Math.floor(rand() * n);
  const dur = Number(bersaglio && bersaglio.dur) || 0;
  const danno = Number(dannoReale) || 0;
  const d20crit = roll(20);
  if (d20crit === 1) {
    const pct1 = roll(100);
    const pct2 = roll(100);
    const loss1 = Math.round(dur * pct1 / 100);
    const loss2 = Math.round(dur * pct2 / 100);
    return {
      perdita: Math.max(0, loss1 + loss2),
      ramo: 'critico',
      dettagli: { pct1, pct2, loss1, loss2 }
    };
  }
  const P = durabilityCoefficienteP(bersaglio);
  const rBersaglio = durabilityResistenza(bersaglio);
  const rAttaccante = attaccante ? durabilityResistenza(attaccante) : DURABILITY_R_GENERICO;
  const rapportoGrezzo = rAttaccante / rBersaglio;
  const rapporto = durabilityRapportoEffettivo(rapportoGrezzo);
  const d20atk = roll(20);
  const d20res = roll(20);
  const tiroAtk = d20atk + Math.floor(danno / 10);
  const tiroRes = d20res + (Number(trattoResistenza) || 0);
  const margine = tiroAtk - tiroRes;
  const moltiplicatoreTiro = Math.max(0.5, Math.min(2.0, 1 + margine * 0.05));
  const scalaDanno = danno / DURABILITY_DANNO_RIFERIMENTO;
  const perditaPct = P * scalaDanno * moltiplicatoreTiro * rapporto;
  const perdita = Math.round(dur * perditaPct / 100);
  return {
    perdita: Math.max(0, perdita),
    ramo: 'continuo',
    dettagli: { rBersaglio, rAttaccante, rapportoGrezzo, rapporto, moltiplicatoreTiro, scalaDanno, tiroAtk, tiroRes }
  };
}

// Regola del Peso (manuale, sezione Equipaggiamento): il peso trasportabile
// (Kg) è (FOR pura + peso corporeo) / 2 — es. FOR 8 + peso 50 Kg = 29 Kg.
// Non riguarda l'equipaggiamento indossato/impugnato, solo ciò che sta nello
// Zaino (oggetti normali + armi/scudi non equipaggiati).
function pesoTrasportabile(forPura, pesoCorporeo) {
  return Math.floor(((Number(forPura) || 0) + (Number(pesoCorporeo) || 0)) / 2);
}

// Armi: tre tipologie (manuale, sezione Equipaggiamento). 'tiro' (chiave
// invariata per compatibilità con armi già salvate, etichetta aggiornata)
// è un'arma SEMPRE a distanza (arco/balestra/pistola/fucile/fionda): per
// colpire usa Mira, non Arte Combattiva, e la difesa del bersaglio cambia
// (Destrezza per schivare, Difesa/Difesa Mentale per bloccare — vedi
// combatRollAttackAndDamage/combatRollDefense). 'lancio' (coltelli/kunai/
// shuriken) può colpire corpo a corpo O a distanza — scelta dell'attaccante
// ad ogni attacco — ma la difesa resta SEMPRE quella di un'arma bianca
// (Elusione/Difesa): solo il tratto "per colpire" cambia (Arte Combattiva
// vs Lanciare), vedi openCombatWeaponPicker.
const WEAPON_CLASSES = [
  { key: 'bianca', label: 'Arma bianca' },
  { key: 'tiro',   label: 'Arma a distanza' },
  { key: 'lancio', label: 'Arma da lancio' }
];
// Elenchi chiusi dei tratti su cui uno scudo o un'arma possono dare bonus
// (oltre a un tratto nuovo, scelta "personalizzato" sempre disponibile).
const SHIELD_TRAIT_OPTIONS = ['Bloccare', 'Deflettere', 'Spirito', 'Resistenza'];
const WEAPON_TRAIT_OPTIONS = ['Bloccare', 'Deflettere', 'Perforare', 'Rompere', 'Tagliare'];
// Statistiche primarie su cui uno scudo o un'arma possono dare bonus: solo
// queste, non l'intera lista PRIMARY_STATS (FOR/DEX/F.MEN per le armi,
// DIF/D.MEN per gli scudi — le uniche indicate per l'equipaggiamento).
const SHIELD_PRIMARY_BONUS_KEYS = ['dif', 'dmen'];
const WEAPON_PRIMARY_BONUS_KEYS = ['for', 'dex', 'fmen'];

// Q.I. — fasce di apprendimento
function qiLimite(qi) {
  if (qi < 100) return 11;
  if (qi <= 120) return 10;
  if (qi <= 150) return 9;
  return 8;
}

// Tiro manuale (Narratore): quando un attacco viene risolto con dadi tirati
// realmente al tavolo invece che dall'app, questi due stati (mai attivi
// insieme) sostituiscono Math.random() dentro rollDie — vedi
// combatComputeAttackRoll/combatAttackDiceNeeded in js/app.js.
// combatDiceRecorder: se un array, rollDie non tira nulla (ritorna un
// valore fittizio, scartato) e si limita a registrare {label, sides} —
// usato per enumerare in anticipo quali dadi servono per un attacco, senza
// alcun effetto collaterale (nessuna scrittura, nessuna casualità consumata).
let combatDiceRecorder = null;
// combatManualDiceQueue: se un array, rollDie consuma i valori inseriti a
// mano dal Narratore nello stesso ordine in cui li chiederebbe in modalità
// automatica (stesso ordine di combatDiceRecorder per lo stesso attacco).
let combatManualDiceQueue = null;
function rollDie(sides, label) {
  if (combatDiceRecorder) { combatDiceRecorder.push({ label: label || `d${sides}`, sides }); return 1; }
  if (combatManualDiceQueue && combatManualDiceQueue.length) {
    const v = Math.round(Number(combatManualDiceQueue.shift()));
    return (Number.isFinite(v) && v >= 1 && v <= sides) ? v : 1;
  }
  return 1 + Math.floor(Math.random() * sides);
}

// Dado per il tiro di una statistica primaria, in base al suo valore
function diceForValue(v) {
  if (v <= 10) return 'd4';
  if (v <= 20) return 'd6';
  if (v <= 30) return 'd8';
  if (v <= 40) return 'd12';
  return 'd12+d8';
}

// HP e MP — solo in creazione il punteggio base interagisce col
// moltiplicatore di classe. Dal Lv2 in poi l'incremento è diretto sul
// totale (nessun moltiplicatore) e segue questa tabella, che raddoppia
// il costo ogni 100 punti oltre il 400.
function hpApCostForPoint(n) {
  if (n <= 100) return 1;
  if (n <= 250) return 2;
  if (n <= 400) return 4;
  const bracket = Math.floor((n - 401) / 100);
  return 4 * Math.pow(2, bracket + 1);
}
function mpApCostForPoint(n) {
  if (n <= 100) return 1.5;
  if (n <= 250) return 3;
  if (n <= 400) return 6;
  const bracket = Math.floor((n - 401) / 100);
  return 6 * Math.pow(2, bracket + 1);
}
// Attributi primari (FOR/F.MEN/DIF/D.MEN/Mira/DEX/VEL) e P.R.
function primaryApCostForPoint(n) {
  if (n <= 10) return 2;
  if (n <= 20) return 3;
  if (n <= 30) return 5;
  if (n <= 40) return 10;
  if (n <= 50) return 15;
  const decade = Math.floor((n - 51) / 10);
  return 15 + 5 * (decade + 1);
}
// Statistiche terziarie (Stile/Carisma/Fortuna): costo diretto da tabella,
// una voce per ciascun valore di arrivo (da -2 a 20)
function tertiaryApCostForPoint(n) {
  return TERTIARY_AP_TABLE[String(n)] || 0;
}
function totalGrowthCost(current, target, costFn) {
  current = Math.floor(current);
  target = Math.floor(target);
  if (target <= current) return 0;
  let total = 0;
  for (let n = current + 1; n <= target; n++) total += costFn(n);
  return total;
}
const PR_MAX = 50;

// Tabella Limiti di Livello (Lv 2 → Lv 30)
const LEVEL_TABLE = [
  { lv: 2,  ap: 30, perk: '+2/+1/+1', note: '' },
  { lv: 3,  ap: 30, perk: '+1/+1/+1', note: '' },
  { lv: 4,  ap: 35, perk: '+1/+1/+1', note: 'Guerriero 2 Tec · Eclettico 1 Tec+1 Ab · Mago 2 Ab' },
  { lv: 5,  ap: 35, perk: '+2/+2/+2', note: '' },
  { lv: 6,  ap: 40, perk: '+1/+1/+1', note: '' },
  { lv: 7,  ap: 40, perk: '+1/+2/+2', note: '' },
  { lv: 8,  ap: 45, perk: '+2/+2/+3', note: 'Tutte le classi: 1 Tecnica + 1 Abilità' },
  { lv: 9,  ap: 45, perk: '+1/+1/+1', note: '' },
  { lv: 10, ap: 50, perk: '+3/+3/+2', note: '' },
  { lv: 11, ap: 55, perk: '+2/+2/+2', note: '' },
  { lv: 12, ap: 55, perk: '+1/+1/+1', note: 'Guerriero 2 Tec · Eclettico 1 Tec+1 Ab · Mago 2 Ab' },
  { lv: 13, ap: 60, perk: '+1/+1/+1', note: '' },
  { lv: 14, ap: 70, perk: '+1/+1/+1', note: '' },
  { lv: 15, ap: 70, perk: '+3/+3/+3', note: '' },
  { lv: 16, ap: 80, perk: '+1/+1/+1', note: 'Tutte le classi: 1 Tecnica + 1 Abilità' },
  { lv: 17, ap: 80, perk: '+1/+1/+1', note: '' },
  { lv: 18, ap: 90, perk: '+2/+2/+2', note: '' },
  { lv: 19, ap: 95, perk: '+2/+2/+2', note: '' },
  { lv: 20, ap: 100, perk: '+3/+3/+3', note: 'Guerriero 2 Tec · Eclettico 1 Tec+1 Ab · Mago 2 Ab' },
  { lv: 21, ap: 110, perk: '+2/+2/+2', note: 'Inizio level-up supremi' },
  { lv: 22, ap: 110, perk: '+0/+0/+0', note: '' },
  { lv: 23, ap: 120, perk: '+0/+0/+0', note: '' },
  { lv: 24, ap: 120, perk: '+3/+3/+3', note: 'Tutte le classi: 1 Tecnica Lv 2 + 1 Abilità Lv 2' },
  { lv: 25, ap: 130, perk: '+0/+0/+0', note: '+1 livello diretto a un Boost' },
  { lv: 26, ap: 130, perk: '+0/+0/+0', note: '' },
  { lv: 27, ap: 140, perk: '+3/+3/+3', note: '' },
  { lv: 28, ap: 140, perk: '+0/+0/+0', note: 'Guerriero 2 Tec Lv 3 · Eclettico 1 Tec Lv 3+1 Ab Lv 3 · Mago 2 Ab Lv 3' },
  { lv: 29, ap: 150, perk: '+0/+0/+0', note: '' },
  { lv: 30, ap: 175, perk: '+3/+3/+3', note: '+1 livello diretto a un Boost · livello massimo' }
];

// Bonus di livello ai tratti (Capacità Normali / Capacità Combattive / Conoscenze):
// dal Lv 2 ogni riga della tabella limiti di livello aggiunge punti spendibili
// in ciascuna delle tre liste, in aggiunta ai 15 punti condivisi della creazione.
function perkGainForLevel(lv) {
  const r = LEVEL_TABLE.find(x => x.lv === lv);
  if (!r) return { capacitaNormali: 0, capacitaCombattive: 0, conoscenze: 0 };
  const parts = r.perk.split('/').map(s => parseInt(s, 10) || 0);
  return { capacitaNormali: parts[0] || 0, capacitaCombattive: parts[1] || 0, conoscenze: parts[2] || 0 };
}
function traitBonusAtLevel(livello) {
  const out = { capacitaNormali: 0, capacitaCombattive: 0, conoscenze: 0 };
  LEVEL_TABLE.forEach(r => {
    if (r.lv <= livello) {
      const g = perkGainForLevel(r.lv);
      out.capacitaNormali += g.capacitaNormali;
      out.capacitaCombattive += g.capacitaCombattive;
      out.conoscenze += g.conoscenze;
    }
  });
  return out;
}

// Fasce Q.I. -> limite base per il contatore "utilizzi" di Tecniche/Abilità:
// il limite vero e proprio è (base della fascia) × (Lv della tecnica/abilità
// stessa). Raggiunto, il contatore si azzera e quel Lv sale di 1 — un Q.I.
// più alto abbassa la base, cioè bastano meno utilizzi per salire di livello.
function utilizziBaseForQI(qi) {
  const q = Number(qi) || 0;
  if (q > 150) return 8;
  if (q > 120) return 9;
  if (q >= 100) return 10;
  return 11;
}
function utilizziLimitFor(qi, lv) {
  const l = Math.max(1, parseInt(lv, 10) || 1);
  return utilizziBaseForQI(qi) * l;
}

// Costo Mp delle Abilità, in base al loro Lv: +6 Mp a livello fino al Lv 4
// incluso (6/12/18/24), poi +8 Mp a livello oltre il 4.
function abilitaCostoForLv(lv) {
  const l = Math.max(1, parseInt(lv, 10) || 1);
  return l <= 4 ? 6 * l : 24 + 8 * (l - 4);
}

// Durate/tempi fissi per Tecniche/Abilità/Boost: prima erano campi di testo
// libero, ora un set chiuso derivato dal Round di combattimento del
// manuale (5 secondi, sezione Combattimento — stessa unità già usata lì
// per i tempi d'azione delle armi/incantesimo, qui espressa in frazioni di
// turno come "mezzo turno" per l'attivazione del Boost).
// "quarti" è l'unità operativa (interi, 1/4 di turno ciascuno) usata dal
// countdown lato server (combat_active_effects.duration_quarters): un
// "avanza turno" del Narratore scala sempre di 4 quarti (1 turno intero,
// coerente col Round/Turno del manuale). "secondi" resta solo di
// riferimento per confrontarsi con la tabella d'arma del manuale.
// Due usi distinti riusano questo stesso set (vedi durataCellHtml/
// tempoAzioneCellHtml in app.js): il Tempo d'azione è quanto consuma il
// personaggio che agisce nel proprio turno (statico, come i tempi d'arma);
// la Durata è quanto persiste l'effetto sul personaggio COLPITO — quando
// applicata in un combattimento dal vivo diventa un'istanza in
// combat_active_effects con un countdown reale (vedi advance_combat_round).
const AZIONE_DURATE = [
  { key: 'gratuita', label: 'Gratuita', quarti: 0, secondi: 0 },
  { key: 'quarto', label: '1/4 di turno', quarti: 1, secondi: 1.25 },
  { key: 'mezzo', label: '1/2 turno', quarti: 2, secondi: 2.5 },
  { key: 'turno', label: '1 turno', quarti: 4, secondi: 5 },
  { key: 'turno_mezzo', label: '1 turno e mezzo', quarti: 6, secondi: 7.5 },
  { key: 'due', label: '2 turni', quarti: 8, secondi: 10 },
  { key: 'tre', label: '3 turni', quarti: 12, secondi: 15 }
];

// Movimento in combattimento: costo in quarti di turno (stessa unità di
// AZIONE_DURATE) di UNA casella esagonale, in funzione della Velocità
// effettiva (statistica primaria + eventuali buff attivi, 1-99 — stessa
// formula già usata per l'iniziativa, vedi combatRollAndSendInitiative in
// app.js). Non è una regola scritta nel manuale (che non definisce tempi di
// spostamento): casa-regola confermata con l'utente, DIMEZZATA rispetto
// alla versione originale — a parità di Velocità la stessa distanza
// raggiungibile di prima ora costa la metà (nessun cambiamento a "quante
// caselle" si possono percorrere spendendoci un budget fisso, solo a
// quanto costa). Il vero tetto allo spostamento massimo per turno non è
// più "quanto budget condiviso c'è", ma COMBAT_MOVEMENT_MAX_QUARTI_PER_TURN
// (indipendente, vedi combatMovementBudget in app.js e move_combat_token
// lato server): a Velocità 1 (minima) una casella costa un quarto di
// turno; il costo scende linearmente fino a 1/8 di quarto a Velocità 99.
// Mirror lato server in combat_movement_cost_per_hex (vedi migrazione
// combat_reveal_and_movement_cap).
function combatMovementCostPerHex(vel) {
  const v = Math.min(99, Math.max(1, Number(vel) || 1));
  return (2 - (1.75 * (v - 1)) / 98) / 2;
}
// Tetto indipendente di quarti spendibili in spostamento per turno (mezzo
// turno): non si allarga mai anche se il budget condiviso residuo è più
// alto (es. inizio turno, nessuna azione ancora fatta) — cumulato fra più
// spostamenti nello stesso turno, mai resettato finché non cambia il round.
const COMBAT_MOVEMENT_MAX_QUARTI_PER_TURN = 2;
// Quante caselle sono ancora percorribili col budget di quarti rimasto nel
// turno (per difetto: non si può spendere una frazione di casella).
function combatMovementHexesForBudget(vel, budgetQuarti) {
  const cost = combatMovementCostPerHex(vel);
  return Math.max(0, Math.floor((Number(budgetQuarti) || 0) / cost + 1e-9));
}

// Boost — meccanica ufficiale a 5 livelli fissi. durataQuarti: valore fisso
// in quarti di turno (stessa unità di AZIONE_DURATE), 12 = 3 Turni come da
// manuale — prima era testo libero ("3 Turni"/"3 Turni o più"), ora un
// numero riusabile anche per registrare il Boost fra gli effetti attivi di
// un combattimento dal vivo (vedi boost-activate-btn in app.js).
// estendibile: dal Lv2 in su il manuale ammette "o più" pagando il
// mantenimento PP/turno oltre la base — informativo, non ricalcolato qui.
const BOOST_LEVELS = [
  { lv: 1, costo: 8,  mantenimento: '5 PP/turno',  durataQuarti: 12, estendibile: false, range: '5 metri',  limite: '0/100' },
  { lv: 2, costo: 16, mantenimento: '10 PP/turno', durataQuarti: 12, estendibile: true,  range: '10 metri', limite: '0/200' },
  { lv: 3, costo: 24, mantenimento: '15 PP/turno', durataQuarti: 12, estendibile: true,  range: '15 metri', limite: '0/300' },
  { lv: 4, costo: 32, mantenimento: '20 PP/turno', durataQuarti: 12, estendibile: true,  range: '30 metri', limite: '0/400' },
  { lv: 5, costo: 40, mantenimento: '25 PP/turno', durataQuarti: 12, estendibile: true,  range: '50 metri', limite: '0/500' }
];

// Oggetti consumabili (Fronte Scheda): effetti ammessi. "incremento" richiede
// anche un bersaglio scelto tra le caratteristiche primarie (HP e MP inclusi,
// per un "+x Hp" che alza il massimo invece di curare i punti correnti).
const CONSUMABLE_EFFECTS = [
  { key: 'recuperoHp', label: 'Recupero HP' },
  { key: 'recuperoMp', label: 'Recupero MP' },
  { key: 'recuperoPp', label: 'Recupero PP' },
  { key: 'incremento', label: 'Incremento statistica' },
  { key: 'recuperoMpPct', label: 'Recupero MP (% del massimo)' },
  { key: 'rimuoviStato', label: 'Rimuove uno stato specifico' },
  { key: 'rimuoviTuttiStati', label: 'Rimuove tutti gli stati attivi' },
  { key: 'rimuoviStatoScelta', label: 'Rimuove uno stato a scelta di chi lo usa' },
  { key: 'curaTramortitoESanguina', label: 'Cura Tramortito, applica 1 turno di Sanguinare' },
  { key: 'regenNTurni', label: 'Regen 3 turni (10% HP e MP a turno)' },
  { key: 'applicaBuffMalus', label: 'Potenziamento a tempo, poi crollo (droga)' }
];

// Soglia di K.O.: 10% degli HP massimi. Sotto quella soglia l'unica azione
// possibile è un tiro percentuale (successo oltre il 70%) oppure consumare
// una risorsa di recupero HP.
const KO_THRESHOLD_PCT = 0.10;
const KO_ROLL_SUCCESS = 70;

function uid() {
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
