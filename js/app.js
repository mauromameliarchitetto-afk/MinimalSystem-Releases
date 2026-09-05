/* ==========================================================================
   Role Makers — Companion App — Logica applicativa
   ========================================================================== */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORAGE_KEY = 'ms_characters_v1';
const ACTIVE_KEY  = 'ms_active_id_v1';
const STORIES_KEY = 'ms_stories_v1';
/* Backup di recupero per un JSON.parse(STORAGE_KEY) fallito (checkpoint
   architettura/affidabilità): riproducibile inserendo a mano un valore non
   valido in ms_characters_v1. PRIMA di questa correzione loadAll() si
   limitava ad azzerare characters in memoria — il primo saveAll()
   successivo (anche solo aprendo/chiudendo l'app) sovrascriveva per sempre
   ms_characters_v1 con "[]", rendendo il contenuto originale irrecuperabile.
   Ora, se il parse fallisce, il valore grezzo corrotto viene copiato UNA
   SOLA VOLTA sotto questa chiave (mai sovrascritta se già presente — non è
   "l'ultimo tentativo corrotto" che conta, è la prima prova del problema)
   prima di procedere comunque con un array vuoto: l'app resta utilizzabile,
   nessun backup si accumula ad ogni riavvio, nessun contenuto di
   personaggi finisce mai in console. Il ripristino (se richiesto) resta
   un'operazione manuale del proprietario/supporto, mai automatica. */
const STORAGE_CORRUPT_BACKUP_KEY = 'ms_characters_v1_corrupt_backup_v1';

/* Blocco 3 (predisposizione piani): limite gratuito di base, usato SOLO
   come valore di ripiego offline/senza sessione o prima che i diritti
   reali siano arrivati dal server (vedi effectiveCharacterLimit in
   cloud-account.js) — deve restare uguale a plans.free.max_characters
   in supabase/migrations/20260903000000_premium_plans_scaffolding.sql,
   l'unica fonte di verità per un account collegato. Nessun pagamento
   reale collegato a questo numero. */
const FREE_CHARACTER_LIMIT = 3;

/* Elenco pubblico delle premesse pubblicate in passato (storie scoperte in
   automatico dai giocatori): il repository GitHub del progetto fa da
   "server leggero" in sola lettura, tramite la Contents API su un ramo
   dedicato che non tocca main e non fa scattare build — nessun token,
   perché il repository è pubblico. La pubblicazione (scrittura, che
   richiedeva un token GitHub incollato dal Narratore) è stata rimossa nel
   Blocco 2: un prodotto commerciale non deve chiederlo. Resta solo questa
   lettura, per non lasciare irraggiungibili le premesse già pubblicate. */
const GH_OWNER = 'mauromameliarchitetto-afk';
const GH_REPO = 'MinimalSystem-ManualediGioco';
const GH_BRANCH = 'stories-data';
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`;
const STORIES_CACHE_KEY = 'ms_stories_index_cache_v1';
const STORIES_CACHE_TTL = 5 * 60 * 1000;
const PREMESSA_MAX_BYTES = 30 * 1024 * 1024;

/* I PDF delle premesse (fino a 30 MB) vivono in IndexedDB, non in
   localStorage: localStorage ha un limite reale di pochi MB per origine e
   un PDF anche modesto lo satura subito, facendo fallire OGNI salvataggio
   successivo (compreso l'aggiornamento della spunta "Pubblica"). In
   `stories`/localStorage restano solo i metadati (titolo, nome file,
   dimensione), sempre piccoli. Chiave: l'id della storia lato Narratore,
   oppure "import:<nome storia>" per il fallback via invito lato giocatore. */
const PDF_DB_NAME = 'ms_premesse_pdf_db';
const PDF_DB_STORE = 'pdfs';
let pdfDbPromise = null;
function pdfDb() {
  if (pdfDbPromise) return pdfDbPromise;
  pdfDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(PDF_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(PDF_DB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return pdfDbPromise;
}
async function savePdfBlob(key, blob) {
  const db = await pdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_DB_STORE, 'readwrite');
    tx.objectStore(PDF_DB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadPdfBlob(key) {
  const db = await pdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_DB_STORE, 'readonly');
    const req = tx.objectStore(PDF_DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function deletePdfBlob(key) {
  const db = await pdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_DB_STORE, 'readwrite');
    tx.objectStore(PDF_DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let characters = [];
let activeId = null;
// Account cloud collegato in questo momento su questo dispositivo:
// undefined = non ancora verificato (all'avvio), null = nessun account,
// stringa = id utente. Aggiornato da renderListAccountBadge (cloud-account.js)
// e usato per filtrare "I tuoi personaggi" su un dispositivo condiviso da
// più account, cosi' non si vedono i personaggi creati da un altro account.
let currentSessionUserId;
let stories = [];
let activeStoryId = null;
let viewingCharId = null;
// 'story' (elenco locale del Narratore, storico) oppure 'cloud-narratore'
// (scheda di un personaggio in una campagna cloud, aperta dal suo Account):
// stabilisce cosa fanno i bottoni Indietro/Rimuovi nella scheda in sola
// lettura, che è condivisa tra i due contesti.
let charViewMode = 'story';
let charViewCampaignId = null;

/* ---------------------------------------------------------------- storage */

function loadAll() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    characters = (raw ? JSON.parse(raw) : []).map(ensureShape);
  } catch (e) {
    // MAI il contenuto (raw può contenere nomi/dati di personaggi) in un
    // log: solo il fatto che sia successo.
    console.error('Errore lettura storage: JSON non valido in ' + STORAGE_KEY + ' — avvio con un array vuoto controllato.');
    try {
      // Una sola copia, mai sovrascritta: se un backup esiste già da una
      // corruzione precedente (magari mai notata), resta quella la prova
      // da recuperare — un nuovo evento non deve cancellarla.
      if (raw && localStorage.getItem(STORAGE_CORRUPT_BACKUP_KEY) === null) {
        localStorage.setItem(STORAGE_CORRUPT_BACKUP_KEY, raw);
      }
    } catch (backupErr) { /* storage pieno/non disponibile: nessun backup possibile, si procede comunque */ }
    characters = [];
  }
  try {
    const rawS = localStorage.getItem(STORIES_KEY);
    stories = rawS ? JSON.parse(rawS) : [];
    // migrazione: le premesse a testo con spunte sono state sostituite da
    // un'unica premessa in PDF per storia
    let migratedPdf = false;
    stories.forEach(s => {
      if (s.premesse !== undefined) delete s.premesse;
      if (s.premessa === undefined) s.premessa = null;
      // migrazione: i PDF finivano dentro localStorage (dataUrl) e lo
      // saturavano subito, facendo fallire ogni salvataggio successivo —
      // ora vivono in IndexedDB; qui si recupera l'eventuale copia rimasta
      if (s.premessa && s.premessa.dataUrl) {
        const dataUrl = s.premessa.dataUrl;
        delete s.premessa.dataUrl;
        migratedPdf = true;
        fetch(dataUrl).then(r => r.blob()).then(blob => savePdfBlob(s.id, blob)).catch(() => {});
      }
    });
    if (migratedPdf) saveStories(); // libera subito lo spazio in localStorage
  } catch (e) {
    console.error('Errore lettura storie', e);
    stories = [];
  }
  activeId = localStorage.getItem(ACTIVE_KEY) || null;
  // stessa migrazione lato giocatore: eventuali premesse importate via
  // invito con il PDF ancora dentro localStorage vengono spostate in
  // IndexedDB, altrimenti restano lì a saturare lo spazio per sempre
  try {
    const map = loadPremesse();
    let migratedPremesse = false;
    Object.keys(map).forEach(storia => {
      const p = map[storia];
      if (p && p.dataUrl) {
        const dataUrl = p.dataUrl;
        delete p.dataUrl;
        migratedPremesse = true;
        fetch(dataUrl).then(r => r.blob()).then(blob => savePdfBlob('import:' + storia, blob)).catch(() => {});
      }
    });
    if (migratedPremesse) savePremesse(map);
  } catch (e) { /* niente da migrare */ }
}
function saveStories() {
  try {
    localStorage.setItem(STORIES_KEY, JSON.stringify(stories));
  } catch (e) {
    console.error('Errore scrittura storie', e);
    toast('Salvataggio non riuscito');
  }
}
function getActiveStory() {
  return stories.find(s => s.id === activeStoryId) || null;
}
function saveAll() {
  try {
    // Gli ospiti temporanei aperti dal Narratore non sono personaggi locali:
    // non devono sopravvivere a un reload né diventare una fonte concorrente.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(characters.filter(c => !c.narratorEditGuest)));
    const active = getActive();
    if (activeId && active && !active.narratorEditGuest) localStorage.setItem(ACTIVE_KEY, activeId);
    return true;
  } catch (e) {
    console.error('Errore scrittura storage', e);
    toast('Salvataggio non riuscito');
    return false;
  }
}
function getActive() {
  return characters.find(c => c.id === activeId) || null;
}
/* Finché il personaggio non è mai stato salvato nel cloud (nessun
   cloudCharacterId), "Salva nel cloud" resta un'azione una tantum del
   giocatore. Una volta salvato, però, ogni modifica successiva (nome,
   statistiche, tratti...) deve arrivare al Narratore senza dover ripetere
   a mano quel salvataggio: qui si riversa in cloud da sola, con un piccolo
   ritardo per non spedire una richiesta a ogni singolo tasto premuto. */
/* Salvataggio Narratore-ospite con lo stesso controllo di versione
   ottimistico del proprietario (vedi resolveVersionConflict/pushCharacterToCloud
   in js/cloud-character.js): la RPC rifiuta con 'CONFLITTO_VERSIONE:' se
   qualcuno ha scritto nel frattempo (narratore_update_character_data,
   p_expected_version). Se il personaggio in editing è ancora quello a
   schermo si chiede subito quale versione tenere; altrimenti (scheda già
   chiusa) non c'è nulla da fare qui — narratorEditCharacterCloudId è già
   stato azzerato, e la prossima openCharacterForNarratorEdit ripartirà da
   una row.data fresca comunque. */
async function narratorPushWithVersionCheck(c, cloudId) {
  try {
    const row = await narratoreUpdateCharacterDataCloud(cloudId, characterCloudPayload(c), c.cloudVersion);
    c.cloudVersion = row.current_version;
    c.cloudDirty = false;
  } catch (err) {
    if (!(err && String(err.message || '').startsWith('CONFLITTO_VERSIONE'))) throw err;
    if (!(narratorEditMode && narratorEditCharacterCloudId === cloudId && getActive() === c)) return;
    const { data: fresh, error: freshErr } = await withTimeout(
      sb.from('characters').select('level, campaign_id, data, current_version').eq('id', cloudId).single(),
      'Verifica conflitto'
    );
    if (freshErr) throw err;
    await resolveVersionConflict(c, fresh, cc => narratorPushWithVersionCheck(cc, cloudId));
  }
}
let cloudAutoPushTimer = null;
let cloudAutoPushPending = null;
/* Prima di questa correzione un push fallito (es. rete assente proprio nel
   momento in cui scattava il debounce) veniva abbandonato in silenzio:
   cloudAutoPushPending veniva azzerato PRIMA di eseguire push(), quindi al
   fallimento non restava nulla da ritentare finché l'utente non modificava
   di nuovo lo stesso personaggio (bug verificato: c.cloudDirty restava
   true a tempo indeterminato, mai risincronizzato da solo). Ora pending
   resta valorizzato finché il push non va a buon fine, e un fallimento
   pianifica un nuovo tentativo — che l'evento 'online' già esistente
   (flushCloudAutoPush) può anche anticipare non appena torna la rete. */
function runCloudAutoPush() {
  cloudAutoPushTimer = null;
  const pending = cloudAutoPushPending;
  if (!pending) return;
  const push = pending.isNarratorGuest
    ? () => narratorPushWithVersionCheck(pending.c, pending.cloudId)
    : () => pushCharacterToCloud(pending.c);
  push().then(() => {
    if (cloudAutoPushPending === pending) cloudAutoPushPending = null;
  }).catch(() => {
    // non blocchiamo l'utente per un errore di rete, ma niente più
    // abbandono silenzioso: ritenta più tardi, a meno che nel frattempo
    // una nuova modifica non abbia già rimpiazzato pending (in quel caso
    // scheduleCloudAutoPush ha già pianificato il proprio invio).
    if (cloudAutoPushPending === pending) {
      clearTimeout(cloudAutoPushTimer);
      cloudAutoPushTimer = setTimeout(runCloudAutoPush, 15000);
    }
  });
}
function scheduleCloudAutoPush(c) {
  if (!c) return;
  // In modalità "modifica Narratore" (openCharacterForNarratorEdit) il
  // personaggio non è nostro: c.cloudCharacterId (identità del PROPRIO
  // personaggio salvato nel cloud) resta sempre vuoto per un ospite, quindi
  // va controllato/usato invece narratorEditCharacterCloudId — senza questo
  // distinguo nessuna modifica del Narratore veniva mai schedulata per il
  // salvataggio (bug segnalato: un PNG modificato e "sincronizzato" tornava
  // com'era prima dopo aver chiuso e riaperto l'app, perché non era mai
  // arrivato nulla al cloud). pushCharacterToCloud fallirebbe comunque per
  // un ospite (RLS "personaggi: modifica solo proprietario"), va invece la
  // RPC narratore_update_character_data.
  const isNarratorGuest = !!(c.narratorEditGuest && narratorEditMode);
  const cloudId = isNarratorGuest ? narratorEditCharacterCloudId : c.cloudCharacterId;
  if (!cloudId) return;
  if (isNarratorGuest && typeof narratoreUpdateCharacterDataCloud !== 'function') return;
  if (!isNarratorGuest && typeof pushCharacterToCloud !== 'function') return;
  cloudAutoPushPending = { c, isNarratorGuest, cloudId };
  clearTimeout(cloudAutoPushTimer);
  cloudAutoPushTimer = setTimeout(runCloudAutoPush, 2500);
}
/* Invia subito un'eventuale modifica ancora in attesa del debounce di
   scheduleCloudAutoPush: senza, uscire dalla scheda (o chiudere davvero
   l'app) entro i 2.5s dall'ultima modifica la perde in silenzio, mai
   arrivata al cloud — stesso bug segnalato per i PNG, ma può capitare a
   chiunque chiuda l'app subito dopo una modifica. */
function flushCloudAutoPush() {
  if (!cloudAutoPushTimer) return;
  clearTimeout(cloudAutoPushTimer);
  cloudAutoPushTimer = null;
  runCloudAutoPush();
}
function touchActive() {
  const c = getActive();
  if (c) { c.updatedAt = Date.now(); c.cloudDirty = true; }
  // Una modifica del Narratore resta una bozza locale in memoria: nessun
  // debounce, cambio campo o render può scriverla nel cloud. La sola porta
  // di salvataggio è confirmNarratorEdit().
  if (narratorEditMode && c && c.narratorEditGuest) {
    narratorEditDirty = true;
    applyNarratorEditUiState();
    return;
  }
  saveAll();
  scheduleCloudAutoPush(c);
}

/* ------------------------------------------------------------- factories */

/* Retro scheda: solo locazioni di armatura (le armi sono sul fronte).
   Come armi/scudi, ogni pezzo è flaggabile equipaggiato/inventario: se
   disequipaggiato compare nello Zaino (vedi zainoGridItems) e i suoi bonus
   meccanici si sospendono (vedi equipBonusTotal). */
function defaultSlots() {
  return ['Capo', 'Busto', 'Braccio Sx', 'Braccio Dx', 'Gamba Sx', 'Gamba Dx']
    .map(name => ({ name, kind: 'armatura', size: '', quality: '', atk: 0, dif: 0, bonus: '', dur: 0, durCur: 0, statsConfirmed: false, hasBeenConfirmed: false, peso: 0, bonuses: [], equipaggiato: true }));
}
/* Fronte scheda: scudi e armi, ciascuno flaggabile come equipaggiato o no —
   se non equipaggiato, non entra nel calcolo di Bloccare/Attacca né nei
   bonus meccanici e passa a fare da "inventario" (resta comunque in scheda,
   riequipaggiabile in qualsiasi momento). Le armi hanno anche una classe
   (bianca/da tiro, mutuamente esclusive nello stesso attacco) e i flag delle
   caratteristiche con cui agiscono (FOR/DEX/F.MEN). */
function makeWeaponSlot(kind) {
  // peso (Kg): conta nello Zaino solo quando il pezzo non è equipaggiato
  // (vedi zainoPesoUsato) — indossato/impugnato non pesa sulla regola del peso
  const s = { name: kind === 'scudo' ? 'Scudo' : 'Arma', kind, size: '', quality: '', atk: 0, dif: 0, bonus: '', dur: 0, durCur: 0, statsConfirmed: false, hasBeenConfirmed: false, peso: 0, bonuses: [], equipaggiato: true };
  if (kind === 'arma') { s.weaponClass = 'bianca'; s.usaFor = true; s.usaDex = false; s.usaFmen = false; s.effettoNome = ''; s.effettoTratto = ''; s.attackTraitName = ''; }
  return s;
}
function defaultWeaponSlots() {
  const scudo = makeWeaponSlot('scudo');
  const arma = makeWeaponSlot('arma'); arma.name = 'Arma 1';
  return [scudo, arma];
}
/* Una riga di "bonus meccanico" su un pezzo di equipaggiamento (arma, scudo
   o armatura): a differenza del vecchio campo Bonus (testo libero, mai letto
   dal codice), questa aumenta davvero una statistica o un tratto in scheda.
   kind: 'primary' (key = chiave PRIMARY_STATS) | 'tertiary' (key = chiave
   TERTIARY_STATS) | 'trait' (listKey + name: se il tratto non è ancora in
   scheda viene aggiunto in automatico, partendo da base 0 — il bonus da solo
   ne determina il valore). */
/* Default sensato in base al pezzo: scudo parte da DIF, arma da FOR,
   armatura (o pezzo sconosciuto) resta su FOR come già in uso prima. */
function makeEquipBonusRow(itemKind) {
  const key = itemKind === 'scudo' ? 'dif' : 'for';
  return { id: uid(), kind: 'primary', key, listKey: '', name: '', valore: 1 };
}
/* Se taglia/qualità sono entrambe scelte, riporta atk/dif/dur nel range
   ufficiale corrispondente (usato quando cambia una delle due scelte) */
function clampSlotToRange(slot) {
  const r = equipRange(slot.kind, slot.size, slot.quality);
  if (!r) return;
  ['atk', 'dif', 'dur'].forEach(f => {
    const [min, max] = r[f];
    slot[f] = clamp(Number(slot[f]) || min, min, max);
  });
}
/* Applica "Conferma scheda" a un pezzo di equipaggiamento (armatura/arma/
   scudo): ricalcola atk/dif/dur nel range di taglia+qualità e decide la
   Durabilità corrente risultante. Identità "già confermato in passato" =
   slot.hasBeenConfirmed, MAI dedotta da dur>0 — un pezzo può avere già
   dur>0 PRIMA della sua primissima conferma (taglia/qualità scelte ma
   "Conferma scheda" mai ancora premuto: clampSlotToRange gira anche sui
   pulsanti taglia/qualità, vedi wireEquipGrid), quindi dur>0 da solo non
   distingue "pezzo nuovo" da "pezzo esistente riconfermato". Solo la
   primissima conferma in assoluto riparte a Durabilità piena; ogni
   riconferma successiva (es. "Modifica scheda" -> "Conferma scheda" dopo
   un cambio di taglia/qualità) preserva il minimo fra il valore corrente e
   il nuovo massimo — mai una riparazione gratuita. Muta slot in place
   (stesso pattern di clampSlotToRange) e lo ritorna. */
function applySlotConfirm(slot) {
  const eraGiaConfermatoInPrecedenza = slot.hasBeenConfirmed === true;
  const durCurPrecedente = Number(slot.durCur) || 0;
  clampSlotToRange(slot);
  slot.statsConfirmed = true;
  slot.durCur = eraGiaConfermatoInPrecedenza
    ? Math.min(durCurPrecedente, Number(slot.dur) || 0)
    : (Number(slot.dur) || 0);
  slot.hasBeenConfirmed = true;
  return slot;
}
/* Righe delle tabelle del retro scheda (colonne come da schede ufficiali).
   utilizzi/costo/range/pp/limite non si scrivono più a mano: si ricalcolano
   da lv (e da Q.I. per gli utilizzi) a ogni render — vedi recomputeTecnicaRow/
   recomputeAbilitaRow/recomputeBoostRow. utilizziCount è il contatore vero e
   proprio, incrementato dal bottone nella cella Utilizzi. */
// directLvSpent: campo storico (checkpoint precedente al registro
// tecabAssignments), non più scritto — resta solo per il backfill una
// tantum di ensureShape sui personaggi salvati prima di quel checkpoint.
// id: identificativo stabile della riga (mai l'indice nell'array, che
// cambia a ogni compattazione/riordino) — usato da tecabPendingAdvancements
// per ritrovare la riga giusta anche a distanza di render/ricariche.
// assignmentId: se valorizzato, questa riga esiste perché una specifica
// assegnazione di Level Up/Narratore è stata spesa per "nuova voce" (vedi
// consumeTecabAssignmentForNew) — resta collegata finché non è confermata
// (tipoConfirmed), dopodiché il collegamento è solo storico/di sola
// lettura (serve ancora per "Annulla e riassegna", mai per calcoli).
function makeTecnicaRow() { return { id: uid(), nome: '', bonus: '', malus: '', bonusItems: [], malusItems: [], tempoAzione: '', durata: '', utilizziCount: 0, utilizzi: '', lv: '', directLvSpent: 0, attiva: false, dannoBase: 0, dannoTipo: 'fisico', dannoStat: 'for', tipo: 'supporto', tipoConfirmed: false, effettoNome: '', effettoTratto: '', multiTarget: false, doppioTiroStat: '', contrattacco: false, assignmentId: null }; }
function makeAbilitaRow() { return { id: uid(), nome: '', bonus: '', bonusItems: [], costo: '', costoOverride: '', tempoAzione: '', durata: '', utilizziCount: 0, utilizzi: '', lv: '', directLvSpent: 0, attiva: false, dannoBase: 0, dannoBase2: 0, dannoTipo: 'fisico', dannoStat: 'for', tipo: 'supporto', tipoConfirmed: false, effettoNome: '', effettoTratto: '', effettoBonusPct: 0, raggioHex: 0, multiTarget: false, doppioTiroStat: '', bonusMode: 'fisso', scalaStat: '', assignmentId: null }; }
/* Checkpoint "Boost e pedina di combattimento": id stabile (come le righe
   Tecnica/Abilità), "progresso" = PP realmente spesi in attivazione/
   mantenimento cumulati verso la soglia del livello corrente (vedi
   boostAdvancementThreshold), "lvTop" = stato esplicito raggiunto solo dopo
   il completamento reale del Lv 5 (mai dedotto dalle sole spunte legacy
   c.boost). Righe salvate prima di questo checkpoint non hanno questi campi:
   backfill additivo in ensureShape, mai un valore che retrocede quanto già
   presente. */
function makeBoostRow()   { return { id: uid(), nome: '', bonus: '', bonusItems: [], range: '', pp: '', costo: '', limite: '', lv: '', boostConfirmed: false, progresso: 0, lvTop: false }; }

/* Categorie di tratto valide per i bonus/malus di Tecniche/Abilità/Boost:
   Capacità Combattive e Normali (Conoscenze escluse, come per i bonus di
   scudo/arma — un incremento di nozioni teoriche non è un vero bonus
   d'azione). */
const TECH_BONUS_TRAIT_LISTS = ['capacitaCombattive', 'capacitaNormali'];

/* Categorie di tratto pescabili per il bersaglio di un oggetto consumabile
   ('incremento'/'applicaBuffMalus'): a differenza di TECH_BONUS_TRAIT_LISTS
   include anche le Conoscenze — decisione esplicita dell'utente per gli
   oggetti specificamente (un tomo/elisir può ampliare anche nozioni
   teoriche, diversamente da un bonus d'azione di Tecnica/Abilità/Boost/
   equip), isolata qui e non un'estensione silenziosa della regola generale. */
const ITEM_BONUS_TRAIT_LISTS = ['capacitaCombattive', 'capacitaNormali', 'conoscenze'];

/* Migra il vecchio testo libero (es. "+2 elusione", una riga per bonus) in
   voci strutturate che pescano da un tratto vero — mai perdendo dati:
   converte solo se OGNI riga non vuota del testo rispetta il formato
   "numero nome", altrimenti lascia il testo intatto (prosa libera non
   parsabile, es. "sente odore di zolfo") perché il giocatore la sistemi a
   mano. Richiamata a ogni render (idempotente: se il testo è già vuoto
   non fa nulla), stesso pattern di recomputeTecnicaRow. */
function migrateTextBonusToItems(row, field, itemsField, c) {
  if (!Array.isArray(row[itemsField])) row[itemsField] = [];
  const text = String(row[field] || '').trim();
  if (!text) return;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const parsed = lines.map(l => {
    const m = l.match(/^([+-]?\d+)\s+(.+)$/);
    return m ? { valore: Math.abs(parseInt(m[1], 10)) || 0, name: m[2].trim() } : null;
  });
  if (!lines.length || parsed.some(p => !p)) return; // almeno una riga non parsabile: non tocca nulla
  parsed.forEach(p => {
    // il testo libero era scritto a mano (spesso minuscolo, es. "elusione"):
    // il confronto con i tratti veri del personaggio ignora maiuscole/
    // minuscole, ma il nome salvato è sempre quello ufficiale del tratto
    // trovato (mai il testo digitato), altrimenti il picker lo tratterebbe
    // da capo come "nuovo tratto personalizzato" invece di riconoscerlo.
    let listKey = 'capacitaCombattive';
    let name = p.name;
    const lower = p.name.toLowerCase();
    for (const lk of TECH_BONUS_TRAIT_LISTS) {
      const shownMatch = (c.shownTraits && c.shownTraits[lk] || []).find(n => n.toLowerCase() === lower);
      const customMatch = (c.customTraits && c.customTraits[lk] || []).find(t => t.name.toLowerCase() === lower);
      if (shownMatch) { listKey = lk; name = shownMatch; break; }
      if (customMatch) { listKey = lk; name = customMatch.name; break; }
    }
    row[itemsField].push({ listKey, name, valore: p.valore });
  });
  row[field] = '';
}

/* Statistiche selezionabili per una riga Danno di tipo Fisico: Forza e
   Destrezza (mischia/lancio) più Mira e Forza Mentale (es. danno fisico di
   precisione o "spinta" mentale) — indipendenti dal Tipo di danno, che
   decide solo la difesa del bersaglio (Difesa vs Difesa Mentale, invariato).
   Il tipo Magico resta implicitamente su Forza Mentale, senza selettore. */
const DANNO_STAT_KEYS = ['for', 'dex', 'mira', 'fmen'];
const DANNO_STAT_LABELS = { for: 'FRZ', dex: 'DEX', mira: 'MIRA', fmen: 'F.MEN' };
/* Statistica effettiva usata dal danno di una riga: esplosivo non ne somma
   nessuna, magico è sempre Forza Mentale, fisico usa la scelta della riga
   (con fallback a Forza se non valida) — unica fonte di verità, riusata da
   "Tira danno", dal motore di combattimento e dall'etichetta del select. */
function dannoStatFor(dannoTipo, dannoStat) {
  if (dannoTipo === 'esplosivo') return null;
  if (dannoTipo === 'magico') return 'fmen';
  return DANNO_STAT_KEYS.includes(dannoStat) ? dannoStat : 'for';
}
/* Ricalcola i campi derivati di una riga Tecnica/Abilità/Boost dal suo Lv
   (e, per gli utilizzi, dal Q.I. del personaggio): lv resta comunque
   impostabile a mano, qui si limita solo a un intero >= 1. */
/* Danno base/tipo/statistica e interruttore "Attiva" sono stati introdotti
   dopo: le righe salvate prima restano prive di questi campi finché non
   vengono normalizzate qui (richiamata a ogni render, come il resto). */
function ensureDannoAttivaFields(r, isTecnica) {
  if (typeof r.attiva !== 'boolean') r.attiva = false;
  if (typeof r.dannoBase !== 'number' || isNaN(r.dannoBase)) r.dannoBase = 0;
  if (r.dannoTipo !== 'fisico' && r.dannoTipo !== 'magico' && r.dannoTipo !== 'esplosivo') r.dannoTipo = 'fisico';
  // Il Danno Magico è una prerogativa delle Abilità: eventuali Tecniche
  // salvate con dannoTipo 'magico' (dati vecchi/errati) tornano a 'fisico'.
  if (isTecnica && r.dannoTipo === 'magico') r.dannoTipo = 'fisico';
  if (!DANNO_STAT_KEYS.includes(r.dannoStat)) r.dannoStat = 'for';
  if (typeof r.doppioTiroStat !== 'string') r.doppioTiroStat = '';
  // Dato vecchio: la checkbox "X2 Forza/Destrezza" (raddoppiava solo il
  // danno, statistica scelta ad ogni attacco) è stata unificata dentro
  // "Tiro doppio" (stesso concetto: raddoppiare il tiro di una statistica —
  // vedi effettoCellHtml). Le righe salvate con la vecchia checkbox attiva
  // ereditano come "Tiro doppio" la statistica di Danno già impostata sulla
  // riga, senza perdere l'effetto.
  if (!r.doppioTiroStat && r.doppioTiroForDex) r.doppioTiroStat = r.dannoStat;
  delete r.doppioTiroForDex;
  // Tipo Supporto/Debuff/Danno/Misto: le righe salvate prima di questi campi
  // avevano già Attiva/Bonus popolati, quindi "supporto" è la lettura
  // corretta di default (nessuna perdita di dati, solo il campo Danno resta
  // nascosto finché non si passa esplicitamente a "Danno"/"Misto"). "Misto"
  // combina entrambe le funzioni sulla stessa riga (es. Campo limite di
  // Scilla: potenziamento su chi la usa + attacco/effetto sul bersaglio).
  // "Debuff" è meccanicamente IDENTICO a "Supporto" in ogni punto del codice
  // (stesso Attiva/bonus-malus/target-picker/multi-bersaglio, vedi Infezione)
  // — esiste solo per chiarezza semantica in scheda: un effetto negativo
  // (di solito su un nemico, valori negativi in bonusItems/malusItems) si
  // chiama con un nome diverso da un potenziamento su di sé, niente altro.
  // "Danno fisso": solo Abilità (mai le Tecniche, poteri magici puri) — un
  // attacco istantaneo a valore fisso che ignora le difese del bersaglio,
  // vedi tipoCellHtml/dannoFissoConfigHtml/apply_danno_fisso.
  // "Cura"/"Cura max"/"Extra": solo Abilità, 3 valori di Tipo a sé (mai una
  // sotto-opzione di Supporto) per Guarigione rapida/maggiore/Sovracura —
  // vedi effettoCellHtml/tipoCellHtml.
  const validTipi = isTecnica
    ? ['supporto', 'debuff', 'danno', 'misto']
    : ['supporto', 'debuff', 'danno', 'misto', 'dannofisso', 'cura', 'curamax', 'extra'];
  if (!validTipi.includes(r.tipo)) r.tipo = 'supporto';
  if (typeof r.tipoConfirmed !== 'boolean') r.tipoConfirmed = false;
  if (typeof r.effettoNome !== 'string') r.effettoNome = '';
  if (typeof r.effettoTratto !== 'string') r.effettoTratto = '';
  // Bonus % al tiro di stato: solo le Abilità lo possono avere (vedi
  // dannoConfigHtml) — una Tecnica salvata con un valore (dati vecchi/
  // concessi a mano) lo perde qui, stesso trattamento del Danno Magico sopra.
  if (isTecnica || typeof r.effettoBonusPct !== 'number' || isNaN(r.effettoBonusPct)) r.effettoBonusPct = 0;
  // Raggio d'area (celle esagonali): stesso trattamento Abilità-only di
  // effettoBonusPct — un "potere magico" può avere area, un'arma/Tecnica no.
  if (isTecnica || typeof r.raggioHex !== 'number' || isNaN(r.raggioHex)) r.raggioHex = 0;
  r.raggioHex = Math.max(0, Math.min(6, Math.round(r.raggioHex) || 0));
  // Danno secondario Magico (danno misto Fisico+Magico nella stessa
  // azione): stesso trattamento Abilità-only — mai per Tecniche, e privo
  // di senso quando dannoTipo è già 'magico' (sarebbe magico+magico).
  if (isTecnica || r.dannoTipo === 'magico' || typeof r.dannoBase2 !== 'number' || isNaN(r.dannoBase2)) r.dannoBase2 = 0;
  // Modalità del bonus: derivata SEMPRE da r.tipo (mai un campo scelto a
  // parte, vedi effettoCellHtml/tipoCellHtml) — 'curamax'->scalante,
  // 'extra'->sovracura, qualunque altro Tipo->fisso. Letta da
  // combatEffectRowsFor/combatResolvePendingTarget, invariati.
  r.bonusMode = (!isTecnica && r.tipo === 'curamax') ? 'scalante'
    : (!isTecnica && r.tipo === 'extra') ? 'sovracura' : 'fisso';
  // Caratteristica scelta per "Cura max"/"Extra" (vedi effettoCellHtml):
  // solo Abilità, solo Forza Mentale o Difesa Mentale — mai Forza (fisica),
  // mai un'altra statistica. Default Forza Mentale.
  if (isTecnica || !['fmen', 'dmen'].includes(r.scalaStat)) r.scalaStat = 'fmen';
}
/* Una riga senza nome non è un'abilità/tecnica "usata": mostrare comunque
   Lv 1/utilizzi calcolati la fa sembrare una voce reale — restano vuoti
   finché non viene nominata (il nome è anche il momento in cui si consuma
   un'assegnazione per la scelta "nuova voce", vedi wireEditTable). */
function recomputeTecnicaRow(r, qi) {
  ensureDannoAttivaFields(r, true);
  if (!r.nome || !String(r.nome).trim()) { r.lv = ''; r.utilizzi = ''; return; }
  const lv = Math.max(1, parseInt(r.lv, 10) || 1);
  r.lv = String(lv);
  r.utilizzi = `${Number(r.utilizziCount) || 0}/${utilizziLimitFor(qi, lv)}`;
}
function recomputeAbilitaRow(r, qi) {
  ensureDannoAttivaFields(r);
  if (!r.nome || !String(r.nome).trim()) { r.lv = ''; r.utilizzi = ''; r.costo = ''; return; }
  const lv = Math.max(1, parseInt(r.lv, 10) || 1);
  r.lv = String(lv);
  r.utilizzi = `${Number(r.utilizziCount) || 0}/${utilizziLimitFor(qi, lv)}`;
  // Costo personalizzato (es. Abilità a "Tier" fissi — Tier 1/2/3, catalogazione
  // solo interna, mai mostrata in scheda — costo 8/16/20+ MP disponibile già
  // dal Lv1, indipendente dalla formula di scala per livello): se impostato,
  // sostituisce interamente abilitaCostoForLv; vuoto = automatico come sempre.
  const overrideNum = r.costoOverride !== '' && r.costoOverride != null ? Number(r.costoOverride) : NaN;
  r.costo = `${Number.isFinite(overrideNum) ? overrideNum : abilitaCostoForLv(lv)} MP`;
}
function recomputeBoostRow(r) {
  const lv = clamp(parseInt(r.lv, 10) || 1, 1, 5);
  const ref = BOOST_LEVELS.find(b => b.lv === lv) || BOOST_LEVELS[0];
  r.lv = String(lv);
  r.range = ref.range;
  r.pp = ref.mantenimento;
  r.costo = `${ref.costo} PP`;
  r.limite = ref.limite;
  if (typeof r.boostConfirmed !== 'boolean') r.boostConfirmed = false;
}

/* ============================================================
   Checkpoint "Boost e pedina di combattimento": la riga Boost NOMINATA
   (boostRows) diventa l'unica entità realmente attivabile — non più il
   vecchio c.boost[livello].appreso, mantenuto solo come dato storico/
   migrazione (mai più letto per decidere cosa si può attivare). Le funzioni
   sotto sono l'unica fonte di verità per costo/mantenimento/soglia di
   avanzamento/livelli selezionabili, riusate identiche da scheda e
   combattimento — nessuna formula duplicata altrove. */

/* Soglia di avanzamento del livello CORRENTE di una riga: derivata da
   BOOST_LEVELS.limite (es. "0/300" → 300) invece di un secondo elenco di
   soglie hardcoded altrove — un'unica fonte anche per questo numero. */
function boostAdvancementThreshold(lv) {
  const ref = BOOST_LEVELS.find(b => b.lv === clamp(parseInt(lv, 10) || 1, 1, 5));
  if (!ref) return 0;
  const m = String(ref.limite).match(/\/(\d+)/);
  return m ? Number(m[1]) : 0;
}
/* Mantenimento per turno (PP), SENZA lo sconto Lv Top: il regolamento
   applica lo sconto del 10% solo ai "costi di attivazione", non al
   mantenimento (js/rules.js, sezione Boost) — tenuti volutamente distinti. */
function boostMaintenancePerTurn(lv) {
  const ref = BOOST_LEVELS.find(b => b.lv === clamp(parseInt(lv, 10) || 1, 1, 5));
  if (!ref) return 0;
  const m = String(ref.mantenimento).match(/\d+/);
  return m ? Number(m[0]) : 0;
}
/* Costo di attivazione a un dato livello: fisso per livello, scontato del
   10% se la riga ha raggiunto lo stato esplicito Lv Top (row.lvTop),
   applicato — come da regolamento — a TUTTI e 5 i livelli, non solo al Lv 5
   già raggiunto. Arrotondamento: decisione definitiva dell'utente, sempre
   per difetto (Math.floor) — Lv 1-5 con Lv Top: 7/14/21/28/36 PP. */
function boostActivationCost(row, lv) {
  const ref = BOOST_LEVELS.find(b => b.lv === clamp(parseInt(lv, 10) || 1, 1, 5));
  if (!ref) return null;
  return (row && row.lvTop) ? Math.floor(ref.costo * 0.9) : ref.costo;
}
/* Livelli attivabili per una riga: da 1 al livello raggiunto dalla riga
   (row.lv, il "livello corrente" del Boost nominato), MAI oltre — "un Boost
   di livello 3 può essere attivato a livello 1, 2 o 3" (checkpoint, punto
   2). Una riga non confermata non è ancora un Boost reale: nessun livello
   selezionabile finché non viene confermata. */
function boostSelectableLevels(row) {
  if (!row || !row.boostConfirmed) return [];
  const cap = clamp(parseInt(row.lv, 10) || 1, 1, 5);
  return BOOST_LEVELS.filter(b => b.lv <= cap);
}
/* Bonus (bonusItems, sia 'primaria' che tratto) del Boost REALMENTE attivo,
   filtrati su una chiave precisa — UNICO helper riusato sia da buffTotal
   (statistiche primarie) sia da getTraitValue (tratti), qui sotto: niente
   logica duplicata fra scheda e combattimento (checkpoint, punto 4).
   In un combattimento cloud attivo i bonus del Boost vivono già dentro
   combat_active_effects.trait_mods (stesso campo generico già letto da
   combatTraitModTotal per QUALUNQUE effetto attivo su quel personaggio,
   Boost incluso — vedi activateBoostRow, che ci passa row.bonusItems così
   com'è, 'primaria' inclusa): questa funzione si limita quindi al caso
   FUORI da un combattimento cloud attivo, dove combatTraitModTotal
   restituisce sempre 0 (guardia già in combatEffectsForChar) e serve
   invece leggere lo stato locale (c.boostLocalActivation) — se un
   combattimento cloud è nel frattempo diventato attivo, quello stato resta
   "congelato" in memoria ma non conta più (lo stato autorevole è l'altro,
   già incluso), altrimenti il bonus finirebbe contato due volte. */
function boostLocalBuffTotal(c, listKey, name) {
  if (!c || !c.boostLocalActivation || !c.boostLocalActivation.rowId) return 0;
  if (c.cloudCharacterId && combatViewEncounterId && combatState && combatState.encounter
    && combatState.encounter.status === 'active') return 0;
  const row = (c.boostRows || []).find(r => r.id === c.boostLocalActivation.rowId);
  if (!row) return 0;
  return (row.bonusItems || []).filter(it => it.listKey === listKey && it.name === name)
    .reduce((s, it) => s + (Number(it.valore) || 0), 0);
}
/* Vero se un'attivazione di "rowId" è bloccata da un Boost già attivo.
   Ritorna null (nessun blocco), 'stessa' (è lo stesso Boost, già attivo:
   sempre bloccato) o 'sconosciuta' (un Boost DIVERSO risulta già attivo, ma
   non si può escludere che sia lo stesso — vedi sotto — bloccato per
   prudenza). Il regolamento non specifica se due Boost NOMINATI diversi
   possano restare attivi insieme sullo stesso personaggio (parla sempre di
   "il boost", al singolare, ma è un testo scritto prima che esistessero
   righe multiple nominate) — dubbio segnalato nel report, non deciso qui:
   finché resta aperto, la scelta più prudente è bloccare comunque, mai
   permettere per errore una doppia attivazione che le regole potrebbero
   vietare. In combattimento cloud, la migrazione preparata (non applicata,
   vedi supabase/migrations) che aggiunge combat_active_effects.source_row_id
   permetterebbe in futuro di distinguere "stesso Boost" da "Boost diverso"
   con certezza — finché non è applicata, ogni Boost attivo blocca comunque
   una nuova attivazione. */
/* Boost realmente attivo per il TARGET_CHARACTER_ID cloud indicato, se
   esiste — legge direttamente combatState.activeEffects (fonte unica,
   riusata sia da boostActiveInfo sotto sia da openCombatBoostPicker, mai
   due filtri separati sugli stessi dati). rowId è null quando l'effetto
   attivo non è ancora collegato a una riga (server non ancora aggiornato
   con la colonna additiva source_row_id): il Boost resta comunque
   bloccante secondo la regola "un solo Boost per personaggio", solo non
   identificabile per nome finché la migrazione non è applicata. */
function boostActiveInfoByCharacterId(targetCharacterId) {
  if (!targetCharacterId || !combatState) return null;
  const active = (combatState.activeEffects || []).find(e =>
    e.source_kind === 'boost' && e.target_character_id === targetCharacterId && e.remaining_quarters > 0);
  if (!active) return null;
  const rowId = (active.source_row_id !== undefined && active.source_row_id !== null) ? active.source_row_id : null;
  return { rowId, label: active.source_label || null };
}
/* Boost realmente attivo per il personaggio c in questo momento (decisione
   definitiva dell'utente, checkpoint "Boost e pedina", punto 2: un solo
   Boost alla volta, mai sommato/sostituito silenziosamente) — fonte unica
   sia per il blocco dell'attivazione (boostActivationBlockedBy) sia per
   mostrare chiaramente in scheda/menù QUALE Boost è già attivo, mai due
   logiche separate che potrebbero disallinearsi. */
/* Vero se il personaggio c è in questo momento partecipante di un vero
   combattimento cloud attivo — condizione condivisa da activateBoostRow,
   extendBoostRow e dalla UI (boostCardHtml), mai tre copie della stessa
   espressione che potrebbero disallinearsi. Fuori da un combattimento cloud
   non esiste un vero turno da contare (punto 5/estensione): mantenimento e
   estensione restano concetti solo di scena. */
function boostInCloudCombat(c) {
  return !!(c && c.cloudCharacterId && combatViewEncounterId && combatState
    && combatState.encounter && combatState.encounter.status === 'active'
    && (combatState.participants || []).some(p => p.characterId === c.cloudCharacterId));
}
function boostActiveInfo(c) {
  if (!c) return null;
  if (c.cloudCharacterId && combatViewEncounterId && combatState && combatState.encounter
    && combatState.encounter.status === 'active') {
    return boostActiveInfoByCharacterId(c.cloudCharacterId);
  }
  if (c.boostLocalActivation && c.boostLocalActivation.rowId) {
    const row = (c.boostRows || []).find(r => r.id === c.boostLocalActivation.rowId);
    return { rowId: c.boostLocalActivation.rowId, label: row ? `${row.nome || 'Boost'} — Lv ${c.boostLocalActivation.lv}` : null };
  }
  return null;
}
/* 'stessa' se rowId è proprio la riga già attiva (già attiva, non
   riattivabile) — 'altro' per QUALUNQUE altro caso in cui un Boost
   risulti già attivo (riga diversa, o riga non identificabile: la regola
   "un solo Boost per personaggio" blocca comunque, mai un'eccezione per
   ambiguità) — null se nessun Boost è attivo. */
function boostActivationBlockedBy(c, rowId) {
  const info = boostActiveInfo(c);
  if (!info) return null;
  return info.rowId === rowId ? 'stessa' : 'altro';
}
/* Avanzamento di un Boost: quando "progresso" (PP realmente spesi in
   attivazione + mantenimento, mai altro) raggiunge la soglia del livello
   corrente, matura UN avanzamento pendente — applicato solo alla fine del
   combattimento (checkBoostPendingAdvancementsAtEndOfCombat sotto), mai sul
   colpo: un salto di livello a metà scena cambierebbe range/costo/
   mantenimento dell'effetto già attivo. Fuori da un combattimento matura
   comunque, ma resta "pendente" finché il giocatore non lo conferma
   esplicitamente (stessa vetrina di Tecniche/Abilità, mai automatico). */
function checkBoostPendingAdvancement(c, row) {
  if (!row || !row.id) return;
  const lv = clamp(parseInt(row.lv, 10) || 1, 1, 5);
  if (lv >= 5 && row.lvTop) return; // Lv Top già raggiunto: nessun altro traguardo da maturare
  const threshold = boostAdvancementThreshold(lv);
  if (!threshold || (Number(row.progresso) || 0) < threshold) return;
  if (!Array.isArray(c.boostPendingAdvancements)) c.boostPendingAdvancements = [];
  const already = c.boostPendingAdvancements.find(a => a.rowId === row.id && a.prevLv === lv && !a.applied);
  if (already) return; // già in coda: non duplicare (stesso principio di findUnappliedTecabAdvancement)
  c.boostPendingAdvancements.push({ rowId: row.id, prevLv: lv, applied: false, resolved: false, createdAt: Date.now() });
}
/* Applica gli avanzamenti Boost pendenti (chiamata a fine combattimento,
   stesso principio di checkTecabPendingAdvancements): Lv 1-4 → Lv+1,
   progresso azzerato (l'eccedenza oltre la soglia resta persa, come già per
   Tecniche/Abilità — mai un riporto); Lv 5 → row.lvTop=true, progresso
   azzerato, il Lv resta 5 (non esiste un Lv 6). Segna "applied" ma NON
   "resolved": la conferma visiva (quale eventuale miglioramento associare)
   resta un passo separato, mai automatico. */
function applyBoostAdvancement(c, entry) {
  const row = (c.boostRows || []).find(r => r.id === entry.rowId);
  if (row) {
    const lv = clamp(parseInt(row.lv, 10) || 1, 1, 5);
    if (lv >= 5) row.lvTop = true;
    else row.lv = String(lv + 1);
    row.progresso = 0;
    recomputeBoostRow(row);
  }
  entry.applied = true;
}
/* Vero se QUESTA riga è quella realmente attiva in questo momento (per il
   badge "Attivo" in scheda e per il glow sulla pedina, vedi renderCombatMap)
   — riusa boostActivationBlockedBy con lo stesso identico criterio invece
   di una seconda logica separata: 'stessa' significa già che rowId
   corrisponde esattamente al Boost attivo trovato. */
function boostRowIsActive(c, rowId) {
  return boostActivationBlockedBy(c, rowId) === 'stessa';
}
function checkBoostPendingAdvancementsAtEndOfCombat(c) {
  if (!c || !Array.isArray(c.boostPendingAdvancements)) return;
  let changed = false;
  c.boostPendingAdvancements.forEach(entry => {
    if (!entry.applied) { applyBoostAdvancement(c, entry); changed = true; }
  });
  if (changed) touchActive();
}
/* Registra un utilizzo di una Tecnica/Abilità: il contatore sale di 1.
   Raggiunto il limite (fascia Q.I. del personaggio × Lv della riga) NON
   alza più il Lv sul colpo: matura un avanzamento in coda
   (c.tecabPendingAdvancements), applicato solo a fine combattimento (vedi
   checkTecabPendingAdvancements) — mai durante l'azione stessa, mai due
   volte per lo stesso traguardo (guardia "applied"). Se non c'è un
   combattimento realmente aperto su questo dispositivo (combatViewEncounterId
   nullo — es. "Attiva" dal Fronte Scheda fuori da un incontro, solo sessione
   attiva) non c'è nessun "fine combattimento" a cui differire: il Lv sale
   subito, come prima di questo checkpoint.
   Versione parametrizzata sul personaggio: non usa getActive()/touchActive()
   perché va chiamata anche per un personaggio diverso da quello aperto sulla
   scheda (es. dal picker di combattimento, dove il "lanciatore" può non
   essere il personaggio attivo su questo dispositivo) — persiste con lo
   stesso pattern di scheduleCloudAutoPush usato per gli ospiti-Narratore,
   altrimenti la modifica resterebbe solo in memoria e non arriverebbe mai
   al cloud. */
/* Identità stabile di un avanzamento pendente: personaggio (chiamante) +
   field + rowId (mai il nome: due righe possono chiamarsi uguale, l'id no)
   + livello di partenza. NON include l'encounter: la stessa voce allo
   stesso livello deve restare unica anche se matura di nuovo in un
   incontro diverso prima che il primo avanzamento sia stato applicato —
   altrimenti la schermata "Incremento" (che aggiunge bonus/effetto)
   potrebbe presentarsi più volte per un singolo, reale salto di livello. */
function findUnappliedTecabAdvancement(c, field, rowId, prevLv) {
  return (c.tecabPendingAdvancements || []).find(a =>
    a.field === field && a.rowId === rowId && a.prevLv === prevLv && !a.applied);
}
/* Collassa eventuali duplicati già presenti (creati prima di questo fix, da
   una corsa non ancora coperta, o — punto 1 del checkpoint "8 punti",
   confermato in revisione — già "applied" prima che questa funzione
   esistesse: senza gestirli, la schermata "Incremento" può ripresentarsi
   più volte per lo stesso, reale salto di livello, lasciando aggiungere
   bonus/effetto/caratteristica una seconda volta a costo zero).
   Due gruppi distinti, stessa identità (field/rowId/prevLv):
   - NON applicati: resta solo il più vecchio, gli altri rimossi prima di
     essere applicati — mai dopo, per non rischiare un doppio giro della
     schermata Incremento.
   - Applicati ma non ancora "resolved" (l'utente non ha ancora confermato
     la schermata Incremento per NESSUNO dei duplicati): resta solo il più
     vecchio, gli altri rimossi — sono lo stesso salto di livello presentato
     più volte, non progressi distinti. Un duplicato già "resolved" (bonus
     realmente aggiunto e confermato) non viene MAI rimosso: è progresso
     vero, si scartano invece gli altri duplicati ancora da confermare per
     evitare un secondo giro sullo stesso salto.
   rowId mancante o falsy (dato molto vecchio, da prima che questo campo
   esistesse): mai usato per raggruppare — una chiave `undefined` comune
   accorperebbe righe realmente diverse. Il proprio id (sempre univoco)
   sostituisce rowId in quel caso, così l'entry resta sempre da sola nel suo
   gruppo — "mai cancellare dati non equivalenti" prevale su una
   deduplicazione più aggressiva ma rischiosa.
   Idempotente: richiamabile ad ogni punto di controllo senza effetti se non
   ci sono duplicati. Mai tocca coppie con field/rowId/prevLv diversi. */
function dedupeTecabPendingAdvancements(c) {
  if (!c || !Array.isArray(c.tecabPendingAdvancements)) return false;
  const groupKey = a => `${a.field}::${a.rowId || ('id:' + a.id)}::${a.prevLv}`;
  const list = c.tecabPendingAdvancements;
  const groups = new Map();
  list.forEach(a => {
    const key = groupKey(a);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  });
  const keep = [];
  let changed = false;
  groups.forEach(group => {
    if (group.length === 1) { keep.push(group[0]); return; }
    const resolved = group.filter(a => a.resolved);
    const appliedUnresolved = group.filter(a => a.applied && !a.resolved);
    const unapplied = group.filter(a => !a.applied);
    // resolved: SEMPRE tutti mantenuti (storico reale, mai equivalenti fra
    // loro anche se stessa identità — es. due salti di livello risolti in
    // momenti diversi non dovrebbero mai condividere id/rowId/prevLv, ma se
    // capitasse per un dato incoerente non si cancella comunque nulla di
    // già confermato).
    resolved.forEach(a => keep.push(a));
    if (resolved.length) {
      // Un duplicato già confermato copre già questo salto di livello: gli
      // "applied" ancora da confermare sono lo stesso salto riproposto,
      // scartati per non offrire un secondo bonus sullo stesso incremento.
      if (appliedUnresolved.length) changed = true;
      if (unapplied.length) changed = true;
    } else if (appliedUnresolved.length) {
      keep.push(appliedUnresolved[0]);
      if (appliedUnresolved.length > 1 || unapplied.length) changed = true;
      // eventuali "non applicati" con la stessa identità di un "applied" già
      // in coda per la conferma sono lo stesso salto: scartati.
    } else {
      keep.push(unapplied[0]);
      if (unapplied.length > 1) changed = true;
    }
  });
  if (changed) c.tecabPendingAdvancements = keep;
  return changed;
}
function logTecnicaAbilitaUsageFor(c, field, idx) {
  if (!c) return;
  const rows = c[field];
  const r = rows && rows[idx]; if (!r) return;
  if (!r.id) r.id = uid();
  const lv = Math.max(1, parseInt(r.lv, 10) || 1);
  const limit = utilizziLimitFor(c.qi, lv);
  const count = (Number(r.utilizziCount) || 0) + 1;
  const label = r.nome || (field === 'tecniche' ? 'Tecnica' : 'Abilità');
  if (count >= limit) {
    r.utilizziCount = 0;
    if (typeof combatViewEncounterId !== 'undefined' && combatViewEncounterId) {
      if (!Array.isArray(c.tecabPendingAdvancements)) c.tecabPendingAdvancements = [];
      // stessa voce, stesso livello di partenza, non ancora applicato: mai
      // un secondo pending per lo stesso reale salto di livello (es. la
      // stessa Tecnica usata più volte nello stesso combattimento dopo aver
      // già maturato l'avanzamento, prima che il combattimento chiuda).
      if (!findUnappliedTecabAdvancement(c, field, r.id, lv)) {
        c.tecabPendingAdvancements.push({
          id: uid(), field, rowId: r.id, nome: r.nome, prevLv: lv, newLv: lv + 1,
          source: 'utilizzi', encounterId: combatViewEncounterId, maturedAt: Date.now(),
          applied: false, beforeSnapshot: null, resolved: false, appliedDelta: null, resolvedAt: null
        });
        toast(`${label} ha maturato un avanzamento di livello — si applicherà a fine combattimento`);
      }
    } else {
      r.lv = String(lv + 1);
      toast(`${label} sale di livello (Lv ${lv} → ${lv + 1})`);
    }
  } else {
    r.utilizziCount = count;
  }
  c.updatedAt = Date.now();
  c.cloudDirty = true;
  saveAll();
  scheduleCloudAutoPush(c);
  if (getActive() === c) { if (field === 'tecniche') renderTecniche(c); else renderAbilita(c); }
}
/* Quante Tecniche/Abilità la SOLA dotazione di creazione della classe
   concede, indipendentemente dal livello attuale: tecAbSbloccate(lv=0)
   ritorna esattamente questo (nessuna soglia di TECAB_CLASS_LEVELS/
   TECAB_ALL_LEVELS è mai <= 0), senza toccare la funzione stessa. Queste
   righe NON passano mai dal registro tecabAssignments: nascono già
   compilabili, restano Lv1 finché non salgono per utilizzi reali, e non
   sono mai spendibili per aumentare un'altra voce (vedi buildTecabRows). */
function tecabCreationCount(c, field) {
  const key = field === 'tecniche' ? 'tec' : 'ab';
  return tecAbSbloccate(c.build, 0, c.tecAbChoices, null)[key];
}
/* Registro delle assegnazioni Tecnica/Abilità (checkpoint "sistema
   apprendimenti"): un'assegnazione esiste SOLO per un vero Level Up di
   classe (oltre la dotazione di creazione, vedi tecabCreationCount) o per
   una concessione del Narratore — mai per la dotazione iniziale. Si
   consuma UNA sola volta, con una scelta esplicita e deliberata (mai una
   freccia sempre presente nell'editor): "Crea nuova Tecnica/Abilità"
   (consumeTecabAssignmentForNew, riga in bozza fino alla conferma del
   Tipo) oppure "+1 Lv su una voce esistente dello stesso tipo"
   (consumeTecabAssignmentForLevelUp). Nessuna conversione incrociata
   Tecnica↔Abilità, nessuna regola "2 apprendimenti per +1 Lv" (mai stata
   nel codice, solo nel manuale — vedi js/rules.js). */
function makeTecabAssignment(tipo, origine, livelloIniziale) {
  return {
    id: uid(), tipo, origine, stato: 'disponibile',
    livelloIniziale: clamp(parseInt(livelloIniziale, 10) || 1, 1, 3),
    concessoIl: Date.now(), usatoIl: null,
    narratoreId: null, motivazione: '', operazione: null
  };
}
/* Materializza le assegnazioni "levelup" mancanti fino al totale sbloccato
   dalla SOLA classe OLTRE la dotazione di creazione (tecAbSbloccate senza
   il bonus del Narratore, meno tecabCreationCount) — il bonus del
   Narratore ha una propria origine 'narratore' creata solo dalla RPC
   dedicata (narratore_grant_tecab_assignment). Idempotente: chiamata a
   ogni render di Tecniche/Abilità, non duplica mai le assegnazioni già
   presenti. */
function syncTecabAssignments(c) {
  if (!Array.isArray(c.tecabAssignments)) c.tecabAssignments = [];
  ['tecniche', 'abilita'].forEach(field => {
    const key = field === 'tecniche' ? 'tec' : 'ab';
    const grantLevels = tecabGrantLevels(c.build, c.livello, c.tecAbChoices, key);
    const totalLevelupOnly = grantLevels.length;
    const levelupAssignments = c.tecabAssignments.filter(a => a.tipo === field && a.origine === 'levelup');
    const usedCount = levelupAssignments.filter(a => a.stato === 'usato').length;
    // il budget "disponibile" da classe è sempre e solo il totale sbloccato
    // meno quanto già speso: non un contatore che cresce e basta. Un cambio
    // di build/scelta Eclettico durante il wizard (il default alla
    // creazione è 'guerriero' anche prima che il giocatore scelga davvero)
    // può farlo SCENDERE — le assegnazioni 'disponibile' in eccesso vanno
    // rimosse (non sono mai state spese, non c'è nulla da preservare),
    // quelle 'usato' invece restano SEMPRE: sono progresso reale già
    // ottenuto, mai cancellato da un cambio di classe successivo (vedi
    // test usedAssignmentsSurviveBuildChange).
    const targetAvailable = Math.max(0, totalLevelupOnly - usedCount);
    const currentAvailable = c.tecabAssignments.filter(a => a.tipo === field && a.origine === 'levelup' && a.stato === 'disponibile');
    if (currentAvailable.length < targetAvailable) {
      const alreadyGranted = levelupAssignments.length;
      const missing = targetAvailable - currentAvailable.length;
      for (let i = 0; i < missing; i++) {
        c.tecabAssignments.push(makeTecabAssignment(field, 'levelup', grantLevels[alreadyGranted + i] || 1));
      }
    } else if (currentAvailable.length > targetAvailable) {
      const idsToRemove = new Set(currentAvailable.slice(0, currentAvailable.length - targetAvailable).map(a => a.id));
      c.tecabAssignments = c.tecabAssignments.filter(a => !idsToRemove.has(a.id));
    }
  });
}
function tecabAssignmentsFor(c, field, stato) {
  return (c.tecabAssignments || []).filter(a => a.tipo === field && (!stato || a.stato === stato));
}
function tecabAvailableCount(c, field) {
  return tecabAssignmentsFor(c, field, 'disponibile').length;
}
/* Quante assegnazioni sono state spese per la scelta "+1 Lv su una voce
   esistente" (mai per "nuova voce", che non riduce lo spazio per una
   nuova riga — vedi buildTecabRows, che conta le righe con assignmentId
   direttamente, non attraverso questo numero): usata solo per il testo
   informativo del contatore in renderTecniche/renderAbilita. */
function tecabUsedLevelupSlots(c, field) {
  return (c.tecabAssignments || []).filter(a => a.tipo === field && a.stato === 'usato'
    && a.operazione && a.operazione.tipo === 'levelup').length;
}
/* Consuma un'assegnazione disponibile per la scelta "Crea nuova
   Tecnica/Abilità": crea SUBITO la riga in bozza (assignmentId valorizzato,
   tipoConfirmed false) e la aggiunge in coda a c[field] — la rende visibile
   il prossimo render (vedi buildTecabRows, che conta le righe con
   assignmentId invece di un totale implicito). Ritorna la riga creata, o
   null se l'assegnazione non era disponibile. */
function consumeTecabAssignmentForNew(c, field, assignmentId) {
  const a = (c.tecabAssignments || []).find(x => x.id === assignmentId && x.tipo === field);
  if (!a || a.stato !== 'disponibile') return null;
  const row = field === 'tecniche' ? makeTecnicaRow() : makeAbilitaRow();
  row.assignmentId = a.id;
  row.lv = String(clamp(parseInt(a.livelloIniziale, 10) || 1, 1, 3));
  c[field] = c[field] || [];
  c[field].push(row);
  a.stato = 'usato'; a.usatoIl = Date.now(); a.operazione = { tipo: 'nuova', targetIdx: c[field].length - 1 };
  return row;
}
/* Annulla una riga in bozza (nominata o meno, ma MAI ancora confermata col
   Tipo — vedi tipoConfirmed) nata da consumeTecabAssignmentForNew:
   restituisce l'assegnazione a 'disponibile' (subito riusabile per
   "nuova" o "aumenta") e rimuove la riga stessa dall'array. Una riga già
   confermata (tipoConfirmed true) non è mai annullabile da qui — nessuna
   voce già confermata viene mai eliminata per recuperare un'assegnazione
   (vedi tecabAnnullaRiassegnaHtml, che non mostra il bottone in quel caso). */
function cancelTecabDraftRow(c, field, idx) {
  const rows = c[field] || [];
  const row = rows[idx];
  if (!row || !row.assignmentId || row.tipoConfirmed) return false;
  const a = (c.tecabAssignments || []).find(x => x.id === row.assignmentId && x.tipo === field);
  if (a) { a.stato = 'disponibile'; a.usatoIl = null; a.operazione = null; }
  rows.splice(idx, 1);
  return true;
}
/* Consuma un'assegnazione disponibile per la scelta "+1 Lv su una voce
   esistente" (mai across-tipo: field vincola sia l'assegnazione sia la
   riga bersaglio allo stesso tipo; solo righe già confermate, vedi
   tecabPendingAssignmentsHtml). */
function consumeTecabAssignmentForLevelUp(c, field, assignmentId, idx) {
  const a = (c.tecabAssignments || []).find(x => x.id === assignmentId && x.tipo === field);
  if (!a || a.stato !== 'disponibile') return false;
  const rows = c[field];
  const row = rows && rows[idx];
  if (!row || !row.nome || !String(row.nome).trim()) return false;
  const lv = Math.max(1, parseInt(row.lv, 10) || 1);
  row.lv = String(lv + 1);
  a.stato = 'usato'; a.usatoIl = Date.now(); a.operazione = { tipo: 'levelup', targetIdx: idx, nome: row.nome };
  return true;
}
/* Migrazione una tantum (ensureShape, personaggi salvati prima del
   registro): ricostruisce le assegnazioni "levelup" già spese dai dati già
   presenti. Le prime tecabCreationCount righe già nominate (nell'ordine in
   cui compaiono) sono trattate come dotazione di creazione — MAI
   un'assegnazione, esattamente come una riga di creazione nuova — ogni
   riga nominata OLTRE quel numero è invece la prova che nel vecchio
   sistema un'assegnazione era stata spesa per "nuova voce" (l'unico modo
   di superare la dotazione era il budget sbloccato per livello). A questo
   si aggiungono le assegnazioni "levelup" per ogni livello già comprato
   col vecchio level-up diretto (directLvSpent per riga). Senza questo, un
   personaggio esistente regalerebbe assegnazioni mai davvero guadagnate
   (rischio di duplicazione punti) o, viceversa, perderebbe quelle già
   spese nel vecchio sistema. */
function backfillTecabAssignments(c) {
  ['tecniche', 'abilita'].forEach(field => {
    const creationCount = tecabCreationCount(c, field);
    let namedSeen = 0;
    (c[field] || []).forEach((row, idx) => {
      if (!row.id) row.id = uid();
      if (row.nome && String(row.nome).trim()) {
        namedSeen += 1;
        if (namedSeen > creationCount) {
          const a = makeTecabAssignment(field, 'levelup');
          a.stato = 'usato'; a.operazione = { tipo: 'nuova', targetIdx: idx };
          c.tecabAssignments.push(a);
          row.assignmentId = a.id;
        }
      }
      let spent = Number(row.directLvSpent) || 0;
      while (spent > 0) {
        const a = makeTecabAssignment(field, 'levelup');
        a.stato = 'usato'; a.operazione = { tipo: 'levelup', targetIdx: idx, nome: row.nome };
        c.tecabAssignments.push(a);
        spent -= 1;
      }
    });
    // eventuale residuo del vecchio contatore complessivo non coperto dalle
    // righe (dato incoerente, non dovrebbe accadere): marcato comunque
    // "usato" per non regalare budget mai speso nel vecchio sistema.
    const oldUsed = field === 'tecniche' ? (c.tecDirectLvUsed || 0) : (c.abDirectLvUsed || 0);
    const alreadyLevelup = c.tecabAssignments.filter(a => a.tipo === field && a.operazione && a.operazione.tipo === 'levelup').length;
    for (let i = alreadyLevelup; i < oldUsed; i++) {
      const a = makeTecabAssignment(field, 'levelup');
      a.stato = 'usato'; a.operazione = { tipo: 'levelup', targetIdx: null, nome: null };
      c.tecabAssignments.push(a);
    }
  });
  syncTecabAssignments(c);
}
/* Testo aggiuntivo sulle concessioni del Narratore ancora disponibili
   (con l'eventuale motivazione), da appendere sia alla panoramica del
   wizard (tecAbProgressText) sia al contatore della scheda normale: mai
   nascosto, il giocatore deve sempre vedere perché ha uno slot in più. */
function tecabNarratoreGrantsSuffix(c, field) {
  const grants = tecabAssignmentsFor(c, field, 'disponibile').filter(a => a.origine === 'narratore');
  if (!grants.length) return '';
  return ` — concession${grants.length === 1 ? 'e' : 'i'} del Narratore disponibil${grants.length === 1 ? 'e' : 'i'}: `
    + grants.map(a => a.motivazione ? `"${a.motivazione}"` : 'senza motivazione').join(', ');
}
/* Blocco "Assegnazioni disponibili": UNICO punto in cui un'assegnazione
   Level Up/Narratore si consuma — mai una freccia nell'editor. Per ognuna,
   due scelte esplicite: creare una nuova voce (riga in bozza, va poi
   confermata come sempre col Tipo) o aumentare di 1 Lv una voce già
   confermata dello stesso tipo (select dei bersagli eleggibili + conferma).
   Mostrato sia nella panoramica del wizard sia nella scheda normale (vedi
   renderTecAbOverview/editTecAbCardRows): stessa funzione, stesso
   comportamento, nessuna duplicazione. */
function tecabPendingAssignmentsHtml(c, field) {
  const pending = tecabAssignmentsFor(c, field, 'disponibile');
  if (!pending.length) return '';
  const dataAttr = field === 'tecniche' ? 'tecnica' : 'abilita';
  const noun = field === 'tecniche' ? 'Tecnica' : 'Abilità';
  const eligible = (c[field] || [])
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.tipoConfirmed && r.nome && String(r.nome).trim());
  return `<div class="tecab-pending-block">
    ${pending.map(a => `
      <div class="tecab-pending-item" data-tecabpending="${dataAttr}" data-tecabassignid="${a.id}">
        <div class="tecab-pending-label">${noun} disponibile${a.origine === 'narratore' ? ` — concessa dal Narratore${a.motivazione ? ` ("${escapeHtml(a.motivazione)}")` : ''}` : ` — da Level Up${(Number(a.livelloIniziale) || 1) > 1 ? ` · nuova voce al Lv ${a.livelloIniziale}` : ''}`}</div>
        <div class="tecab-pending-actions">
          <button type="button" class="btn btn-sm btn-primary" data-tecabchoosenuova>Crea nuova ${noun}</button>
          ${eligible.length ? `
          <span class="tecab-pending-increase">
            <select data-tecabincreasesel>
              <option value="">Aumenta una esistente…</option>
              ${eligible.map(({ r, i }) => `<option value="${i}">${escapeHtml(r.nome)} (Lv ${r.lv || 1})</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sm btn-ghost" data-tecabchooseincrease>Conferma</button>
          </span>` : ''}
        </div>
      </div>`).join('')}
  </div>`;
}
/* Bottone "Annulla e riassegna": compare SOLO su una riga nata da
   consumeTecabAssignmentForNew (assignmentId valorizzato) e non ancora
   confermata (tipoConfirmed false) — mai su una riga di creazione (nessuna
   assegnazione da restituire) né su una già confermata (mai eliminata
   automaticamente). */
function tecabAnnullaRiassegnaHtml(dataAttr, r, i) {
  if (!r.assignmentId || r.tipoConfirmed) return '';
  return `<button type="button" class="btn btn-ghost btn-sm tecab-cancel-draft-btn" data-tecabcancelassign="${dataAttr}" data-idx="${i}">Annulla e riassegna</button>`;
}

/* ================================================== INCREMENTO A FINE COMBATTIMENTO
   Un avanzamento maturato per utilizzi reali (vedi logTecnicaAbilitaUsageFor)
   NON alza il Lv sul colpo: entra in c.tecabPendingAdvancements e aspetta
   che il combattimento in cui è maturato risulti davvero concluso — MAI
   fidandosi del solo evento realtime (che è soltanto una notifica "controlla
   di nuovo"): ogni punto di controllo rilegge lo stato vero da
   combat_encounters (fetchCombatEncounterStatuses, js/cloud-combat.js).
   Punti di controllo: avvio app, login/riconnessione, sincronizzazione in
   background, apertura scheda, notifica realtime durante la vista
   Combattimento — vedi wireStaticEvents/init, onAuthStateChange,
   syncActiveCharacterInBackground, openCharacter, refreshCombatBoard. */

/* Applica il Lv maturato (numero) — sempre idempotente via "applied": una
   volta true non viene mai più ritoccato, anche richiamando questa funzione
   di nuovo per errore (nessun doppio incremento). Cattura anche lo
   snapshot "prima" della riga (bonus/malus/effetto/caratteristica/costo),
   mai più modificato dopo, per mostrare chiaramente cosa si aggiunge nella
   schermata di incremento senza mai poter alterare i valori precedenti. */
function applyTecabAdvancement(c, entry) {
  if (entry.applied) return true;
  const row = (c[entry.field] || []).find(r => r.id === entry.rowId);
  if (!row) {
    // riga non trovata (es. rowId orfano, dato legacy incoerente): NON
    // marcare applied — resta pendente per un tentativo successivo, mai
    // perso in silenzio. Dettaglio tecnico solo in console.
    console.error('[tecab] avanzamento non applicato: riga non trovata', { field: entry.field, rowId: entry.rowId, nome: entry.nome });
    return false;
  }
  entry.beforeSnapshot = {
    bonusItems: JSON.parse(JSON.stringify(row.bonusItems || [])),
    malusItems: JSON.parse(JSON.stringify(row.malusItems || [])),
    effettoNome: row.effettoNome || '', effettoTratto: row.effettoTratto || '',
    scalaStat: row.scalaStat || '', costo: row.costo || ''
  };
  row.lv = String(entry.newLv);
  entry.applied = true;
  return true;
}
/* Controlla gli avanzamenti maturati ma non ancora applicati per QUESTO
   personaggio: interroga lo stato reale (mai il payload realtime) di ogni
   incontro coinvolto, applica il Lv di quelli ormai 'ended', poi apre in
   coda la schermata di configurazione (mai più di una alla volta). Sicura
   da richiamare spesso/da più punti: chi è già applied/resolved viene
   ignorato, nessun doppio incremento, nessun avanzamento perso se la rete
   non risponde (si riprova al prossimo punto di controllo). */
async function checkTecabPendingAdvancements(c) {
  if (!c || !Array.isArray(c.tecabPendingAdvancements) || typeof fetchCombatEncounterStatuses !== 'function') return;
  // La deduplicazione va persistita SUBITO, indipendentemente da eventuali
  // avanzamenti applicati più sotto: senza questo, un duplicato rimosso solo
  // in memoria (nessun'altra scrittura in questa stessa chiamata) torna a
  // esistere al prossimo avvio, letto di nuovo da localStorage/cloud.
  if (dedupeTecabPendingAdvancements(c)) {
    c.updatedAt = Date.now(); c.cloudDirty = true;
    if (saveAll()) scheduleCloudAutoPush(c);
  }
  const unapplied = c.tecabPendingAdvancements.filter(a => !a.applied && a.encounterId);
  if (unapplied.length) {
    const encounterIds = Array.from(new Set(unapplied.map(a => a.encounterId)));
    try {
      const statuses = await fetchCombatEncounterStatuses(encounterIds);
      const justApplied = [];
      unapplied.forEach(a => {
        if (statuses[a.encounterId] !== 'ended') return;
        if (applyTecabAdvancement(c, a)) justApplied.push(a);
        else toast(`Impossibile applicare l'avanzamento di ${a.nome || (a.field === 'tecniche' ? 'una Tecnica' : "un'Abilità")}: riprova più tardi.`);
      });
      if (justApplied.length) {
        // Snapshot di updatedAt/cloudDirty PRIMA di toccarli: se saveAll()
        // fallisce, il rollback deve riportare anche questi due metadati
        // com'erano, non solo row.lv/entry.applied — altrimenti resterebbe
        // un falso updatedAt "adesso" e un cloudDirty forzato a true anche
        // quando la riga precedente era invece già sincronizzata (cloudDirty
        // poteva legittimamente essere false), un segnale di stato scorretto
        // per la sincronizzazione successiva pur non avendo scritto nulla.
        const prevUpdatedAt = c.updatedAt;
        const prevCloudDirty = c.cloudDirty;
        c.updatedAt = Date.now(); c.cloudDirty = true;
        if (saveAll()) {
          scheduleCloudAutoPush(c);
          if (getActive() === c) { renderTecniche(c); renderAbilita(c); }
        } else {
          // salvataggio fallito: nessun avanzamento resta "applicato" senza
          // essere stato davvero persistito, si riprova al prossimo controllo
          // — rollback completo, metadati inclusi, mai uno stato a metà.
          justApplied.forEach(a => {
            const row = (c[a.field] || []).find(r => r.id === a.rowId);
            if (row) row.lv = String(a.prevLv);
            a.applied = false; a.beforeSnapshot = null;
          });
          c.updatedAt = prevUpdatedAt; c.cloudDirty = prevCloudDirty;
        }
      }
    } catch (e) { /* offline o errore di rete: si riprova al prossimo punto di controllo */ }
  }
  showNextTecabAdvancement(c);
}
/* Controlla gli avanzamenti pendenti di TUTTI i personaggi salvati su
   questo dispositivo (avvio app, login/riconnessione): un avanzamento può
   essere maturato con un personaggio diverso da quello attivo in quel
   momento (es. il Narratore che pilotava un ospite in combattimento). */
function checkTecabPendingAdvancementsForAll() {
  (characters || []).forEach(c => { if (c && Array.isArray(c.tecabPendingAdvancements) && c.tecabPendingAdvancements.some(a => !a.applied || !a.resolved)) checkTecabPendingAdvancements(c); });
}
/* Mostra la prossima schermata "Incremento Tecnica/Abilità" in coda — una
   alla volta, mai perse (restano nell'array finché non risolte), mai
   riproposte una seconda volta una volta confermate (resolved). Stesso
   pattern di showNextPendingLoot per c.pendingLoot. Si apre solo se il
   personaggio è quello davvero attivo su schermo in questo momento. */
let tecabAdvancementModalState = null; // { c, entry, stagedBonus, stagedMalus, stagedEffettoNome, stagedEffettoTratto, stagedEffettoBonusPct, stagedRaggioHex, stagedScalaStat }
function showNextTecabAdvancement(c) {
  if (!c || getActive() !== c) return;
  const modal = $('#tecab-advancement-modal');
  if (!modal) return;
  const next = (c.tecabPendingAdvancements || []).find(a => a.applied && !a.resolved);
  if (!next) { modal.classList.add('hidden'); tecabAdvancementModalState = null; return; }
  tecabAdvancementModalState = { c, entry: next, stagedBonus: [], stagedMalus: [], stagedEffettoNome: '', stagedEffettoTratto: '', stagedEffettoBonusPct: 0, stagedRaggioHex: 0, stagedScalaStat: '' };
  renderTecabAdvancementModal();
  modal.classList.remove('hidden');
}
/* Opzioni del select "aggiungi bonus/malus" della schermata di incremento:
   SOLO tratti/statistiche già esistenti nel sistema (TRAIT_LISTS/
   PRIMARY_STATS, le stesse liste ufficiali usate ovunque altro in scheda),
   nessun tratto personalizzato nuovo — coerente con "usa esclusivamente
   bonus, malus, caratteristiche ed effetti già presenti". */
function tecabAdvStatOptionsHtml(placeholder) {
  const trait = (listKey) => TRAIT_LISTS[listKey].map(n => `<option value="trait::${listKey}::${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  const prim = PRIMARY_STATS.map(s => `<option value="primaria::${s.key}">${escapeHtml(s.full)}</option>`).join('');
  // Una Tecnica ha Bonus E Malus insieme, ciascuno col proprio select: un
  // segnaposto generico "Scegli…" identico su entrambi appare come
  // duplicato allo sguardo (confermato in revisione) — un'etichetta
  // specifica per select toglie l'ambiguità senza cambiare nulla nella
  // scelta stessa.
  return `<option value="">${escapeHtml(placeholder || 'Scegli…')}</option>
    <optgroup label="${TRAIT_LIST_LABELS.capacitaCombattive}">${trait('capacitaCombattive')}</optgroup>
    <optgroup label="${TRAIT_LIST_LABELS.capacitaNormali}">${trait('capacitaNormali')}</optgroup>
    <optgroup label="Statistiche primarie">${prim}</optgroup>`;
}
function tecabAdvItemLabel(it) {
  const label = it.listKey === 'primaria' ? ((PRIMARY_STATS.find(s => s.key === it.name) || {}).full || it.name) : it.name;
  const v = Number(it.valore) || 0;
  return `${label} ${v > 0 ? '+' : ''}${v}`;
}
/* Corpo della schermata di incremento: SOLO aggiunte, mai una modifica o
   rimozione di ciò che la riga aveva già (before = beforeSnapshot,
   catturato una volta sola da applyTecabAdvancement e mai più toccato) —
   i valori precedenti sono mostrati in sola lettura, le nuove aggiunte
   restano "in bozza" (tecabAdvancementModalState) finché non si conferma,
   momento in cui — e solo allora — vengono fuse nella riga vera. Il costo
   MP delle Abilità non ha un controllo qui: è già stato ricalcolato in
   automatico dal nuovo Lv (abilitaCostoForLv, vedi recomputeAbilitaRow),
   mostrato solo come informazione. */
function renderTecabAdvancementModal() {
  const st = tecabAdvancementModalState; if (!st) return;
  const { c, entry } = st;
  const row = (c[entry.field] || []).find(r => r.id === entry.rowId);
  const before = entry.beforeSnapshot || {};
  const isTecnica = entry.field === 'tecniche';
  const title = isTecnica ? 'Incremento Tecnica' : 'Incremento Abilità';
  const sourceLabel = entry.source === 'utilizzi' ? 'Utilizzi in combattimento (soglia Q.I. raggiunta)'
    : entry.source === 'narratore' ? 'Concessione del Narratore' : 'Level Up';
  // Stessa matrice reale dell'editor per-riga (mai qui reinventata): Bonus
  // esiste solo per Supporto/Debuff/Misto (tecAbBonusCellHtml) — Danno,
  // Danno fisso, Cura, Cura max ed Extra non hanno mai avuto un concetto di
  // bonusItems generico, mostrarlo lì sarebbe un campo senza alcun effetto
  // meccanico reale.
  const rowTipo = row ? row.tipo : null;
  const canShowBonus = !['danno', 'dannofisso', 'cura', 'curamax', 'extra'].includes(rowTipo);
  // Effetto di stato: reale solo per Danno/Misto (dannoConfigHtml) e Danno
  // fisso (dannoFissoConfigHtml, Abilità) — mai per Supporto/Debuff/Cura/
  // Cura max/Extra, che in scheda non hanno mai questa sezione.
  const canShowEffetto = ['danno', 'misto', 'dannofisso'].includes(rowTipo);
  const canAddEffetto = canShowEffetto && !before.effettoNome && !st.stagedEffettoNome;
  const canAddScalaStat = !isTecnica && row && ['curamax', 'extra'].includes(row.tipo) && !before.scalaStat && !st.stagedScalaStat;
  // dannoStat: solo contesto in sola lettura (mai modificabile qui, è una
  // scelta fissata alla creazione della riga) — reale solo per Danno/Misto
  // di tipo Fisico (dannoConfigHtml mostra il select dannoStat solo quando
  // dannoTipo non è magico/esplosivo).
  const dannoStatLabels = { for: 'Forza', dex: 'Destrezza', mira: 'Mira', fmen: 'Forza Mentale' };
  const showDannoStat = ['danno', 'misto'].includes(rowTipo) && (!row.dannoTipo || row.dannoTipo === 'fisico') && dannoStatLabels[row.dannoStat];
  const stagedList = (items, kind) => items.map((it, i) => `<li>${escapeHtml(tecabAdvItemLabel(it))} <button type="button" class="btn btn-icon btn-sm btn-ghost" data-advremovestaged="${kind}::${i}" title="Rimuovi (solo aggiunte non ancora confermate)">✕</button></li>`).join('');
  $('#tecab-advancement-body').innerHTML = `
    <h3 style="margin:0 0 4px;">${title}</h3>
    <p class="helper-text" style="margin:0 0 12px;">${escapeHtml(entry.nome || '')} — LV ${entry.prevLv} → LV ${entry.newLv}<br>Progressione: ${sourceLabel}</p>
    ${showDannoStat ? `<p class="helper-text" style="margin:0 0 12px;">Danno scalato su: <strong>${dannoStatLabels[row.dannoStat]}</strong> (fissato alla creazione, non modificabile qui).</p>` : ''}

    ${canShowBonus ? `
    <div class="tecab-adv-section">
      <div class="tecab-adv-section-title">Bonus già presenti</div>
      <p class="helper-text" style="margin:0 0 6px;">${escapeHtml(tecAbItemsSummary(before.bonusItems) || 'Nessuno')}</p>
      ${stagedList(st.stagedBonus, 'bonus') ? `<div class="tecab-adv-newlabel">Nuovo in questo incremento:</div><ul class="tecab-adv-staged-list">${stagedList(st.stagedBonus, 'bonus')}</ul>` : ''}
      <div class="tecab-adv-add-row">
        <select data-advstatsel="bonus">${tecabAdvStatOptionsHtml('Scegli un bonus…')}</select>
        <input type="number" min="1" max="50" value="1" data-advvalinput="bonus" style="width:60px;">
        <button type="button" class="btn btn-sm btn-ghost" data-advaddstat="bonus">+ Aggiungi bonus</button>
      </div>
    </div>` : ''}

    ${isTecnica ? `
    <div class="tecab-adv-section">
      <div class="tecab-adv-section-title">Malus già presenti</div>
      <p class="helper-text" style="margin:0 0 6px;">${escapeHtml(tecAbItemsSummary(before.malusItems) || 'Nessuno')}</p>
      ${stagedList(st.stagedMalus, 'malus') ? `<div class="tecab-adv-newlabel">Nuovo in questo incremento:</div><ul class="tecab-adv-staged-list">${stagedList(st.stagedMalus, 'malus')}</ul>` : ''}
      <div class="tecab-adv-add-row">
        <select data-advstatsel="malus">${tecabAdvStatOptionsHtml('Scegli un malus…')}</select>
        <input type="number" min="1" max="50" value="1" data-advvalinput="malus" style="width:60px;">
        <button type="button" class="btn btn-sm btn-ghost" data-advaddstat="malus">+ Aggiungi malus</button>
      </div>
    </div>` : ''}

    ${(canShowEffetto || before.effettoNome) ? `
    <div class="tecab-adv-section">
      <div class="tecab-adv-section-title">Effetto di stato</div>
      ${before.effettoNome ? `<p class="helper-text" style="margin:0;">Già presente: ${escapeHtml(before.effettoNome)}${before.effettoTratto ? ` (salvezza: ${escapeHtml(before.effettoTratto)})` : ''} — non modificabile qui.</p>`
        : st.stagedEffettoNome ? `<div class="tecab-adv-newlabel">Nuovo in questo incremento:</div><p style="margin:0;">${escapeHtml(st.stagedEffettoNome)}${st.stagedEffettoTratto ? ` (salvezza: ${escapeHtml(st.stagedEffettoTratto)})` : ''}${!isTecnica && st.stagedEffettoBonusPct ? ` · Bonus % al tiro: ${st.stagedEffettoBonusPct}` : ''}${!isTecnica && st.stagedRaggioHex ? ` · Raggio: ${st.stagedRaggioHex} celle` : ''} <button type="button" class="btn btn-icon btn-sm btn-ghost" data-advremovestaged="effetto::0" title="Rimuovi (solo aggiunte non ancora confermate)">✕</button></p>`
        : canAddEffetto ? `<div class="tecab-adv-add-row">
            <select data-adveffettonomesel style="flex:1;min-width:120px;">
              <option value="">Scegli un effetto…</option>
              <option value="Rompere">Rompere</option>
              <option value="Tramortire">Tramortire</option>
              ${STATUS_EFFECTS.map(s => `<option value="${escapeHtml(s.label)}">${escapeHtml(s.label)}</option>`).join('')}
            </select>
            <select data-adveffettotratto>
              <option value="">Nessuna salvezza</option>
              ${TRAIT_LISTS.capacitaCombattive.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-sm btn-ghost" data-advaddeffetto>+ Aggiungi effetto</button>
          </div>
          ${!isTecnica ? `<p class="helper-text" style="margin:6px 0 0;">Solo per un nome del catalogo stati (dado contrapposto percentuale) — ignorati per "Rompere"/"Tramortire"/eventuali effetti personalizzati legacy:</p>
          <div class="tecab-adv-bonusraggio-grid">
            <label style="white-space:nowrap;">Bonus % al tiro</label>
            <input type="number" min="-100" max="100" value="0" data-adveffettobonuspct style="width:56px;">
            <label style="white-space:nowrap;">Raggio (celle)</label>
            <input type="number" min="0" max="6" value="0" data-advraggiohex style="width:56px;">
          </div>` : ''}` : ''}
    </div>` : ''}

    ${!isTecnica && (before.scalaStat || st.stagedScalaStat || canAddScalaStat) ? `
    <div class="tecab-adv-section">
      <div class="tecab-adv-section-title">Caratteristica associata alla scalabilità</div>
      ${before.scalaStat ? `<p class="helper-text" style="margin:0;">Già presente: ${before.scalaStat === 'fmen' ? 'Forza Mentale' : 'Difesa Mentale'} — non modificabile qui.</p>`
        : st.stagedScalaStat ? `<div class="tecab-adv-newlabel">Nuovo in questo incremento:</div><p style="margin:0;">${st.stagedScalaStat === 'fmen' ? 'Forza Mentale' : 'Difesa Mentale'} <button type="button" class="btn btn-icon btn-sm btn-ghost" data-advremovestaged="scalastat::0" title="Rimuovi (solo aggiunte non ancora confermate)">✕</button></p>`
        : `<div class="tecab-adv-add-row">
            <select data-advscalastatsel>
              <option value="">Scegli…</option>
              <option value="fmen">Forza Mentale</option>
              <option value="dmen">Difesa Mentale</option>
            </select>
            <button type="button" class="btn btn-sm btn-ghost" data-advaddscalastat>+ Imposta</button>
          </div>`}
    </div>` : ''}

    ${!isTecnica && row && row.costo ? `<p class="helper-text" style="margin:0 0 12px;">Costo MP ricalcolato automaticamente per il nuovo livello: ${escapeHtml(String(row.costo))}.</p>` : ''}

    <div class="row-between" style="gap:8px;margin-top:8px;">
      <button type="button" class="btn btn-ghost" data-advclose>Chiudi per ora</button>
      <button type="button" class="btn btn-primary" data-advconfirm>Conferma incremento</button>
    </div>
  `;
}
/* Applica UNA SOLA VOLTA le aggiunte in bozza alla riga vera (mai prima:
   finché non si conferma, chiudere la schermata non scrive nulla — vedi
   requisito "se la schermata viene chiusa, l'avanzamento rimane pendente")
   e segna l'avanzamento risolto — non viene mai rimosso dall'elenco (resta
   come storico con beforeSnapshot/appliedDelta), solo escluso dalla coda
   ancora da mostrare (vedi showNextTecabAdvancement). */
function confirmTecabAdvancement() {
  const st = tecabAdvancementModalState; if (!st) return;
  const { c, entry } = st;
  if (entry.resolved) return; // già confermato: mai due volte
  const row = (c[entry.field] || []).find(r => r.id === entry.rowId);
  if (!row) {
    // riga non trovata: NON marcare resolved, le aggiunte in bozza restano
    // solo in tecabAdvancementModalState (mai perse, l'utente può
    // riprovare) — mai una scrittura parziale su altri dati.
    console.error('[tecab] conferma incremento non applicata: riga non trovata', { field: entry.field, rowId: entry.rowId, nome: entry.nome });
    toast('Impossibile completare la conferma: riprova aprendo di nuovo la scheda.');
    return;
  }
  const prevRowState = JSON.parse(JSON.stringify(row));
  row.bonusItems = (row.bonusItems || []).concat(st.stagedBonus);
  if (entry.field === 'tecniche') row.malusItems = (row.malusItems || []).concat(st.stagedMalus);
  if (st.stagedEffettoNome && !row.effettoNome) {
    row.effettoNome = st.stagedEffettoNome; row.effettoTratto = st.stagedEffettoTratto;
    // effettoBonusPct/raggioHex esistono solo sulle righe Abilità
    // (makeAbilitaRow) — mai scritti su una Tecnica, che non ha questi campi.
    if (entry.field === 'abilita') { row.effettoBonusPct = st.stagedEffettoBonusPct || 0; row.raggioHex = st.stagedRaggioHex || 0; }
  }
  if (st.stagedScalaStat && !row.scalaStat) row.scalaStat = st.stagedScalaStat;
  entry.resolved = true;
  entry.resolvedAt = Date.now();
  entry.appliedDelta = {
    bonusAdded: st.stagedBonus, malusAdded: st.stagedMalus,
    effetto: st.stagedEffettoNome ? { nome: st.stagedEffettoNome, tratto: st.stagedEffettoTratto, bonusPct: st.stagedEffettoBonusPct || 0, raggioHex: st.stagedRaggioHex || 0 } : null,
    scalaStat: st.stagedScalaStat || null
  };
  // Snapshot PRIMA di toccarli: stesso principio già applicato al rollback
  // di checkTecabPendingAdvancements (revisione checkpoint "8 punti",
  // seconda revisione, punto 4) — se saveAll() fallisce, anche questi due
  // metadati vanno ripristinati esattamente com'erano, non solo riga/entry
  // (revisione checkpoint "8 punti", terza revisione, punto 5).
  const prevUpdatedAt = c.updatedAt;
  const prevCloudDirty = c.cloudDirty;
  c.updatedAt = Date.now();
  c.cloudDirty = true;
  if (!saveAll()) {
    // salvataggio fallito: ripristina la riga e l'avanzamento com'erano,
    // resta pendente per un tentativo successivo invece di dichiararsi
    // confermato senza esserlo davvero — rollback completo, metadati
    // inclusi, mai uno stato a metà.
    Object.assign(row, prevRowState);
    entry.resolved = false; entry.resolvedAt = null; entry.appliedDelta = null;
    c.updatedAt = prevUpdatedAt; c.cloudDirty = prevCloudDirty;
    return;
  }
  scheduleCloudAutoPush(c);
  if (entry.field === 'tecniche') renderTecniche(c); else renderAbilita(c);
  toast(`${entry.nome || ''} — incremento confermato (LV ${entry.prevLv} → ${entry.newLv})`);
  showNextTecabAdvancement(c);
}
/* Delegato unico sul modale di incremento: "Chiudi per ora" non scrive
   nulla (le aggiunte in bozza restano solo in tecabAdvancementModalState,
   scartate — l'avanzamento resta "applied" ma non "resolved", ripresentato
   al prossimo controllo, vedi requisito "se la schermata viene chiusa,
   l'avanzamento rimane pendente"), "Conferma" fonde le aggiunte nella riga
   una sola volta (confirmTecabAdvancement). Le voci aggiunte in QUESTA
   sessione (mai quelle già presenti prima, sola lettura) restano
   rimovibili finché non si conferma. */
function wireTecabAdvancementModal() {
  const modal = $('#tecab-advancement-modal');
  if (!modal) return;
  modal.addEventListener('click', e => {
    const st = tecabAdvancementModalState; if (!st) return;
    const addBtn = e.target.closest('[data-advaddstat]');
    if (addBtn) {
      const kind = addBtn.dataset.advaddstat;
      const sel = modal.querySelector(`[data-advstatsel="${kind}"]`);
      const valInput = modal.querySelector(`[data-advvalinput="${kind}"]`);
      const raw = sel ? sel.value : '';
      if (!raw) { toast('Scegli una caratteristica'); return; }
      const parts = raw.split('::');
      const listKey = parts[0] === 'primaria' ? 'primaria' : parts[1];
      const name = parts[0] === 'primaria' ? parts[1] : parts[2];
      const magnitude = Math.max(1, Math.min(50, Math.floor(Number(valInput.value)) || 1));
      const item = { listKey, name, valore: kind === 'malus' ? -magnitude : magnitude };
      (kind === 'bonus' ? st.stagedBonus : st.stagedMalus).push(item);
      renderTecabAdvancementModal();
      return;
    }
    const removeBtn = e.target.closest('[data-advremovestaged]');
    if (removeBtn) {
      const [kind, idxStr] = removeBtn.dataset.advremovestaged.split('::');
      const idx = Number(idxStr);
      if (kind === 'bonus') st.stagedBonus.splice(idx, 1);
      else if (kind === 'malus') st.stagedMalus.splice(idx, 1);
      else if (kind === 'effetto') { st.stagedEffettoNome = ''; st.stagedEffettoTratto = ''; st.stagedEffettoBonusPct = 0; st.stagedRaggioHex = 0; }
      else if (kind === 'scalastat') st.stagedScalaStat = '';
      renderTecabAdvancementModal();
      return;
    }
    const addEffetto = e.target.closest('[data-advaddeffetto]');
    if (addEffetto) {
      const nomeSel = modal.querySelector('[data-adveffettonomesel]');
      const trattoSel = modal.querySelector('[data-adveffettotratto]');
      // Scelta vincolata al catalogo reale (Rompere/Tramortire/STATUS_EFFECTS):
      // nessun testo libero, nessuna via di uscita "Personalizzato…" — un
      // effetto personalizzato può nascere solo nell'editor per-riga reale,
      // mai da questa schermata (revisione checkpoint "8 punti", seconda
      // revisione, punto 5). Un effetto personalizzato legacy già presente
      // sulla riga resta comunque intatto e in sola lettura sopra (vedi
      // before.effettoNome): questo ramo si attiva solo quando la riga non
      // ne ha ancora uno.
      const nome = (nomeSel ? nomeSel.value : '').trim();
      if (!nome) { toast('Scegli un effetto'); return; }
      st.stagedEffettoNome = nome;
      st.stagedEffettoTratto = trattoSel ? trattoSel.value : '';
      // Bonus %/raggio hanno senso solo per un nome del catalogo stati
      // (dado contrapposto percentuale, vedi effettoBlockHtml) e mai per le
      // Tecniche — esattamente lo stesso controllo dell'editor per-riga
      // reale, non un'invenzione di questo modale.
      const isAbilita = st.entry.field === 'abilita';
      const statusMatch = isAbilita && typeof statusEffectByName === 'function' ? statusEffectByName(nome) : null;
      if (statusMatch) {
        const bonusPctInput = modal.querySelector('[data-adveffettobonuspct]');
        const raggioInput = modal.querySelector('[data-advraggiohex]');
        st.stagedEffettoBonusPct = bonusPctInput ? Math.max(-100, Math.min(100, Math.floor(Number(bonusPctInput.value)) || 0)) : 0;
        st.stagedRaggioHex = raggioInput ? Math.max(0, Math.min(6, Math.floor(Number(raggioInput.value)) || 0)) : 0;
      } else {
        st.stagedEffettoBonusPct = 0;
        st.stagedRaggioHex = 0;
      }
      renderTecabAdvancementModal();
      return;
    }
    const addScala = e.target.closest('[data-advaddscalastat]');
    if (addScala) {
      const sel = modal.querySelector('[data-advscalastatsel]');
      if (!sel || !sel.value) { toast('Scegli una caratteristica'); return; }
      st.stagedScalaStat = sel.value;
      renderTecabAdvancementModal();
      return;
    }
    if (e.target.closest('[data-advclose]')) {
      modal.classList.add('hidden');
      tecabAdvancementModalState = null;
      return;
    }
    if (e.target.closest('[data-advconfirm]')) { confirmTecabAdvancement(); return; }
  });
}

/* ================================================== ACCESSIBILITÀ: MODALI
   Checkpoint "Accessibilità residua e comportamento mobile": nessuno dei
   30+ overlay dell'app (.confirm-modal + i 4 popup custom + il menu
   copertina) spostava il focus alla propria apertura, lo restituiva
   all'elemento che l'aveva aperto alla chiusura, marcava il resto della
   pagina inert/aria-hidden, o rispondeva a Esc (tranne il menu copertina
   e il lightbox del ritratto, che avevano già una loro gestione). Un solo
   MutationObserver per radice nota (mai sull'intero documento: nessun
   impatto di prestazioni misurabile, sono ~30 nodi) individua ogni
   apertura/chiusura dal cambio della classe "hidden", che il resto del
   codice continua a scrivere esattamente come prima — nessuna funzione di
   apertura/chiusura esistente è stata toccata. */
const A11Y_MODAL_SELECTOR = '.confirm-modal, #cover-menu, #prem-popup, #portrait-lightbox, #rules-popup, #campaign-assets-popup, #pdf-viewer';
// Radici già dotate di una propria gestione Esc (vedi wireStaticEvents/
// closeCoverMenu, riga ~9509, e wirePortraitLightbox): la gestione
// generica qui sotto si limita a focus/inert per loro, mai a un secondo
// listener Esc che duplicherebbe/correrebbe con quello già presente.
const A11Y_MODAL_HAS_OWN_ESCAPE = new Set(['cover-menu', 'portrait-lightbox']);
const a11yOpenModals = new Set();
// Trigger PER MODALE (mai una singola variabile globale, vedi revisione
// checkpoint "8 punti" punto 4): con overlay sovrapposti — un modale ne
// apre un altro senza che il primo si chiuda — un'unica variabile veniva
// sovrascritta dal secondo, e chiudendo il primo il focus non tornava più
// al SUO vero trigger originale (perso, sostituito da quello del secondo).
// Una Map modale->trigger tiene ciascuna apertura separata dalle altre.
const a11yModalTriggers = new Map();
/* Ogni applicazione della maschera modifica nodi anche molto annidati
   dentro #app. Conserviamo lo stato ESATTO di ciascun nodo toccato
   (aria-hidden e attributo booleano inert), così la chiusura dell'ultimo
   modale — o il passaggio da due modali sovrapposti a uno — ripristina
   ricorsivamente tutto ciò che era presente prima della maschera.
   Prima di questo hotfix il ramo "nessun modale aperto" ripuliva soltanto
   app.children: i fratelli annidati del trigger restavano inert per sempre.
   Il caso reale era "Background > Conferma e blocca": menu contenitore,
   tab e pulsante Indietro restavano visibili ma non ricevevano più tocchi. */
const a11yInertMaskPreviousState = new Map();
function a11yRememberMaskState(node) {
  if (a11yInertMaskPreviousState.has(node)) return;
  a11yInertMaskPreviousState.set(node, {
    ariaHidden: node.getAttribute('aria-hidden'),
    hadInert: node.hasAttribute('inert')
  });
}
function a11ySetMaskState(node, masked) {
  a11yRememberMaskState(node);
  if (masked) {
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('inert', '');
  } else {
    node.removeAttribute('aria-hidden');
    node.removeAttribute('inert');
  }
}
function a11yRestoreInertMask() {
  a11yInertMaskPreviousState.forEach((state, node) => {
    if (!node || !node.setAttribute) return;
    if (state.ariaHidden === null) node.removeAttribute('aria-hidden');
    else node.setAttribute('aria-hidden', state.ariaHidden);
    if (state.hadInert) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
  });
  a11yInertMaskPreviousState.clear();
}
function a11yFocusableIn(root) {
  return Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]'))
    .filter(el => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null);
}
/* Isola DAVVERO il solo modale aperto (e il suo trigger, sempre
   raggiungibile per poterlo richiudere), mai l'intero contenitore che lo
   ospita: #cover-menu vive dentro #view-cover insieme a #btn-cover-menu
   (fratelli) e a tutto il resto della copertina (header/contenuto/azioni).
   Marcare "interattivo" l'intero #view-cover (come faceva la versione
   precedente, corretta solo per il bug "menu del tutto irraggiungibile")
   lasciava con lui raggiungibile anche il resto della copertina sotto il
   menu aperto — mai un vero isolamento da tastiera/tecnologia assistiva.
   Qui si scende ricorsivamente livello per livello: un ramo resta
   interattivo SOLO se è il modale stesso, il suo trigger, o un contenitore
   che porta a uno dei due — e in quel caso si scende ancora, per isolare
   correttamente anche i suoi altri fratelli più in profondità. */
function a11yApplyInertMask() {
  const app = $('#app');
  if (!app) return;
  // Ogni ricalcolo parte dallo stato reale precedente alla maschera, mai
  // dagli inert residui del ricalcolo precedente. È essenziale quando un
  // secondo modale si sovrappone al primo o viene chiuso prima del primo.
  a11yRestoreInertMask();
  const openModals = Array.from(a11yOpenModals);
  if (!openModals.length) return;

  const keepAnchors = openModals.slice();
  openModals.forEach(m => {
    const trigger = a11yModalTriggers.get(m);
    if (trigger && document.contains(trigger)) keepAnchors.push(trigger);
  });
  const leadsToAnchor = node => keepAnchors.some(a => node === a || node.contains(a));
  function mask(node) {
    Array.from(node.children).forEach(child => {
      if (openModals.includes(child) || keepAnchors.includes(child)) {
        // Il modale stesso, o il trigger che lo ha aperto: sempre
        // interattivo, foglia — mai scendere oltre.
        a11ySetMaskState(child, false);
        return;
      }
      if (leadsToAnchor(child)) {
        // Contenitore che porta al modale o al trigger più in profondità:
        // resta interattivo fin qui, poi si scende per isolare i fratelli.
        a11ySetMaskState(child, false);
        mask(child);
      } else {
        a11ySetMaskState(child, true);
      }
    });
  }
  mask(app);
}
function a11yOnModalOpen(modal) {
  a11yModalTriggers.set(modal, document.activeElement);
  a11yOpenModals.add(modal);
  a11yApplyInertMask();
  const focusables = a11yFocusableIn(modal);
  if (focusables.length) focusables[0].focus();
  else { if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1'); modal.focus(); }
}
function a11yOnModalClose(modal) {
  a11yOpenModals.delete(modal);
  a11yApplyInertMask();
  const trigger = a11yModalTriggers.get(modal);
  a11yModalTriggers.delete(modal);
  // Il trigger REGISTRATO PER QUESTO modale, mai una variabile globale
  // condivisa: corretto anche con overlay sovrapposti, ognuno riporta il
  // focus a chi l'ha aperto DAVVERO, non a quello dell'ultimo aperto.
  if (trigger && typeof trigger.focus === 'function' && document.contains(trigger)) {
    trigger.focus();
  }
}
// Bottone di chiusura "sicuro" dentro il modale aperto: stessa convenzione
// di naming già in uso in tutto l'HTML (Annulla/Chiudi/No/Rifiuta/Ignora/
// "Non ora"), mai un id inventato qui — riusa il click handler REALE già
// scritto per quel bottone (compreso ogni reset di stato che fa), non si
// limita a nascondere il modale. Un modale come #sync-conflict-modal (una
// scelta obbligata fra due versioni, nessun "annulla" possibile) non ha
// nessun bottone così: Esc lì non fa nulla, di proposito.
const A11Y_DISMISS_SELECTOR = '[id$="-no"], [id$="-cancel"], [id$="-close"], [id$="-reject"], [id$="-decline"], [id$="-dismiss"], [data-advclose]';
function wireAccessibleModals() {
  $$(A11Y_MODAL_SELECTOR).forEach(modal => {
    const observer = new MutationObserver(() => {
      const isHidden = modal.classList.contains('hidden');
      if (!isHidden && !a11yOpenModals.has(modal)) a11yOnModalOpen(modal);
      else if (isHidden && a11yOpenModals.has(modal)) a11yOnModalClose(modal);
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
  document.addEventListener('keydown', e => {
    if (!a11yOpenModals.size) return;
    // il più recente aperto, mai tutti insieme: sia Tab/Shift+Tab che Esc
    // riguardano SOLO l'overlay in cima allo stack, mai quelli sottostanti.
    const last = Array.from(a11yOpenModals).pop();
    if (e.key === 'Tab') {
      // Trappola del focus (revisione checkpoint "8 punti", seconda
      // revisione, punto 6): l'"inert" da solo tiene fuori dal tab-order
      // tutto il resto della pagina, ma NON impedisce che, superato l'ultimo
      // elemento del modale, il focus scappi al <body> (nessun prossimo
      // elemento tabbable nel documento) e poi al trigger — che resta
      // volutamente non-inert per poterlo rifocalizzare alla chiusura, ma
      // non deve mai far parte del ciclo di Tab mentre il modale è aperto.
      // Qui si intercetta esplicitamente e si ricicla fra primo e ultimo
      // elemento SOLO del modale in cima, mai oltre.
      const focusables = a11yFocusableIn(last);
      if (!focusables.length) return;
      const first = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement;
      const activeIdx = focusables.indexOf(active);
      if (e.shiftKey) {
        if (activeIdx <= 0) { e.preventDefault(); lastEl.focus(); }
      } else {
        if (activeIdx === -1 || activeIdx === focusables.length - 1) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    if (e.key !== 'Escape') return;
    if (A11Y_MODAL_HAS_OWN_ESCAPE.has(last.id)) return;
    const dismissBtn = last.querySelector(A11Y_DISMISS_SELECTOR);
    if (dismissBtn) dismissBtn.click();
  });
}
/* ================================================== ACCESSIBILITÀ: CAMPI
   Lo schema standard dei campi in tutta l'app è
   `<div class="field"><label>Testo</label><input .../></div>`: label e
   controllo sono fratelli non collegati da for/id (verificato via grep,
   90+ istanze), quindi per una tecnologia assistiva l'etichetta non
   risulta associata al campo. Nessuna struttura HTML viene toccata: la
   funzione collega label e controllo solo quando trova, dentro un
   .field, esattamente una label diretta priva di for ed esattamente un
   controllo (input/select/textarea, non hidden) — se lo schema è diverso
   dal caso semplice previsto (più controlli, nessun controllo) il campo
   viene lasciato invariato, per non rischiare un'associazione sbagliata.
   Molti .field (es. i campi email/password del box account, generati da
   accountStatusHtml() in cloud-account.js) non esistono ancora nel DOM
   al primo giro e vengono ricreati ad ogni re-render: invece di toccare
   ognuna delle decine di funzioni di rendering sparse nel codice, un
   solo MutationObserver su document.body (childList/subtree, quindi
   nessun costo sulle modifiche di valore degli input mentre si scrive)
   richiama la stessa funzione — al più una volta per frame — dopo ogni
   cambiamento reale della struttura del DOM. */
let a11yFieldIdSeq = 0;
function a11yWireFieldLabels(root) {
  (root || document).querySelectorAll('.field').forEach(field => {
    const label = field.querySelector(':scope > label');
    if (!label || label.hasAttribute('for')) return;
    const controls = field.querySelectorAll('input, select, textarea');
    if (controls.length !== 1 || controls[0].type === 'hidden') return;
    const control = controls[0];
    if (!control.id) control.id = 'a11y-fld-' + (++a11yFieldIdSeq);
    label.setAttribute('for', control.id);
  });
}
function wireFieldLabelObserver() {
  a11yWireFieldLabels(document);
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; a11yWireFieldLabels(document); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
/* Cella di sola lettura per un valore già calcolato (costo/range/pp/limite) */
function readonlyCell(value) {
  return `<td class="col-narrow" style="color:var(--testo-secondario-dark-2);">${escapeHtml(String(value == null ? '' : value))}</td>`;
}
/* Costo MP di un'Abilità: normalmente calcolato in automatico dal Lv della
   riga (abilitaCostoForLv, vedi recomputeAbilitaRow), ma alcune Abilità
   appartengono a "Tier" di costo fisso indipendenti dal livello (Tier 1
   8 MP, Tier 2 16 MP, Tier 3 20+ MP, già disponibili dal Lv1) — pura
   catalogazione interna del Narratore per costruire le Abilità, mai
   mostrata in scheda: qui c'è solo il numero da poter forzare. Campo
   vuoto = automatico come sempre (r.costoOverride, distinto da r.costo
   che resta il testo finale "N MP" già formattato). */
function abilitaCostoCellHtml(r, i, locked) {
  const dis = locked ? 'disabled' : '';
  return `<td class="col-narrow">
    <input type="number" min="0" step="1" value="${escapeHtml(r.costoOverride || '')}" placeholder="${escapeHtml(String(r.costo || '').replace(/\s*MP$/, ''))}" data-abilita="costoOverride" data-idx="${i}" style="width:64px;" ${dis} title="Vuoto = calcolato in automatico dal livello. Un numero forza un costo fisso (es. Tier 1/2/3), indipendente dal livello.">
  </td>`;
}
/* Cella di testo libero (nome/durata di Tecniche/Abilità/Boost) che può
   restare bloccata insieme al resto della riga una volta confermata (Tipo
   per Tecniche/Abilità, boostConfirmed per Boost) — a differenza di
   readonlyCell resta un input modificabile finché non è confermata. */
const CELL_FIELD_ARIA_LABELS = { nome: 'Nome', lv: 'Livello richiesto' };
function lockableTextCellHtml(dataAttr, field, r, i, locked, wide) {
  const label = CELL_FIELD_ARIA_LABELS[field] || field;
  return `<td class="${wide ? 'col-wide' : 'col-narrow'}"><input type="text" value="${escapeHtml(r[field] || '')}" data-${dataAttr}="${field}" data-idx="${i}" aria-label="${escapeHtml(label)} — riga ${i + 1}" ${locked ? 'disabled' : ''}></td>`;
}
/* Cella "Durata" di Tecniche/Abilità: select a scelta fissa (vedi
   AZIONE_DURATE) al posto del vecchio testo libero — riusa lo stesso
   wiring generico di lockableTextCellHtml (wireEditTable ascolta 'input'
   su [data-tecnica]/[data-abilita], evento che i <select> emettono anche
   loro). Un valore salvato in precedenza come testo libero che non
   corrisponde a nessuna chiave nota resta intatto nei dati ma non
   selezionabile: si vede sotto come nota, si sostituisce toccando il
   select, mai riscritto in automatico. */
function azioneDurataCellHtml(dataAttr, field, r, i, locked) {
  const dis = locked ? 'disabled' : '';
  const current = r[field] || '';
  const known = AZIONE_DURATE.some(d => d.key === current);
  return `<td class="col-narrow">
    <select data-${dataAttr}="${field}" data-idx="${i}" ${dis}>
      <option value="" ${!current ? 'selected' : ''}>—</option>
      ${AZIONE_DURATE.map(d => `<option value="${d.key}" ${current === d.key ? 'selected' : ''}>${d.label}</option>`).join('')}
    </select>
    ${current && !known ? `<p class="helper-text" style="margin:4px 0 0;">Valore precedente: "${escapeHtml(current)}"</p>` : ''}
  </td>`;
}
/* Tempo d'azione: quanto turno consuma chi ESEGUE la Tecnica/Abilità (come
   i tempi d'arma del manuale) — statico sulla riga, si spende e basta ad
   ogni uso, nessun countdown. */
function tempoAzioneCellHtml(dataAttr, r, i, locked) { return azioneDurataCellHtml(dataAttr, 'tempoAzione', r, i, locked); }
/* Durata: quanto persiste l'EFFETTO sul personaggio colpito, una volta
   applicato — quando la Tecnica/Abilità viene davvero usata in un
   combattimento dal vivo, questo valore diventa un'istanza con countdown
   reale in combat_active_effects (vedi renderCombatMap/applyCombatEffect),
   non solo un'etichetta sulla scheda. */
function durataCellHtml(dataAttr, r, i, locked) { return azioneDurataCellHtml(dataAttr, 'durata', r, i, locked); }
/* Cella "Utilizzi": SOLO il conteggio calcolato, mai un comando manuale per
   aumentarlo — sale esclusivamente quando la riga viene davvero usata
   (vedi logTecnicaAbilitaUsageFor, agganciata a "Attiva"/Contrattacco/
   effetti reali del Fronte Scheda E, per le righe di Danno/Misto/
   DannoFisso, alla dichiarazione riuscita di un attacco vero in
   combattimento — vedi combatResolvePendingTarget/Multi). */
function utilizziCellHtml(dataAttr, r, i, locked) {
  return `<td class="col-narrow">
    <span style="white-space:nowrap;">${escapeHtml(r.utilizzi || '')}</span>
  </td>`;
}
/* Intestazione di ogni scheda/sezione di Tecnica o Abilità: titolo a
   sinistra, "LV n" di sola lettura a destra — SOLO informativo, mai un
   comando. Il livello non si tocca più da qui in nessun modo: né digitando
   (rimosso da tempo), né con una freccia (rimossa in questo checkpoint) —
   sale solo per utilizzi reali (differito a fine combattimento, vedi
   logTecnicaAbilitaUsageFor) o per una scelta esplicita "Aumenta una
   esistente" nel blocco Assegnazioni disponibili (vedi
   tecabPendingAssignmentsHtml). Non è una cella della griglia dei campi
   (era "Livello", una riga intera a sé come Nome/Tipo): questa è l'unica
   sede del livello in QUALUNQUE editor di Tecniche/Abilità (scheda normale
   e wizard, vedi editTecAbCardRows/tecabEditorSectionedHtml). */
function tecabSectionHeaderHtml(title, dataAttr, r) {
  const lv = r.lv || 1;
  return `<div class="tecab-section-header">
    <span class="tecab-section-title">${escapeHtml(title)}</span>
    <span class="tecab-lv-badge">
      <span class="tecab-lv-badge-value">LV ${escapeHtml(String(lv))}</span>
    </span>
  </div>`;
}
/* Bonus/malus: uno o più per riga, ognuno un pallino "acceso" — il
   Narratore stabilisce quale tratto/statistica si può richiamare, o quale
   malus si applica se quel tratto non è in scheda (es. "-1 a Elusione" se
   presente, "-15% con tiro di non competenza" se assente). */
function bulletListHtml(text, malus) {
  const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return '';
  return `<ul class="bm-list">${lines.map(l => `<li class="bm-item${malus ? ' malus' : ''}"><span class="bm-dot"></span>${escapeHtml(l)}</li>`).join('')}</ul>`;
}
/* Righe testuali "+{valore} {nome}"/"-{valore} {nome}" da una lista di voci
   strutturate {listKey, name, valore} — usato per unirle al testo legacy
   non ancora convertito nella vista di sola lettura del Narratore. */
function bonusItemsToLines(items, malus) {
  return (items || []).filter(it => it && it.name)
    .map(it => {
      // il malus è sempre mostrato in negativo, indipendentemente dal segno
      // salvato (dati legacy pre-esistenti erano salvati come magnitudine
      // positiva): mai una doppia interpretazione tra editor e riepilogo.
      const v = malus ? -Math.abs(Number(it.valore) || 0) : (Number(it.valore) || 0);
      return `${v >= 0 ? '+' : ''}${v} ${it.name}`;
    });
}
/* Select compatto per scegliere il nome di un bonus/malus di Tecniche/
   Abilità/Boost: pesca prima tra i tratti già posseduti dal personaggio
   (Capacità Combattive/Normali), poi tra quelli già noti nella campagna
   (cachedCampaignKnownTraits, stessa fonte usata da equipBonusRowHtml),
   infine permette "Nuovo tratto personalizzato" — una voce per categoria,
   dato che qui non c'è un select di categoria separato. */
function traitBonusItemSelectHtml(c, keyPrefix, it, locked) {
  const dis = locked ? 'disabled' : '';
  const ownByList = {};
  TECH_BONUS_TRAIT_LISTS.forEach(lk => {
    ownByList[lk] = [...new Set([...(c.shownTraits[lk] || []), ...((c.customTraits[lk] || []).map(t => t.name))])].filter(Boolean);
  });
  const knownExtra = {};
  TECH_BONUS_TRAIT_LISTS.forEach(lk => {
    const known = (c.cloudCampaignId ? (cachedCampaignKnownTraits(c.cloudCampaignId)[lk] || []) : []);
    knownExtra[lk] = known.filter(n => n && !ownByList[lk].includes(n));
  });
  // Le statistiche primarie sono un insieme chiuso (PRIMARY_STATS): mai
  // "nuovo tratto personalizzato" per questa categoria, a differenza dei
  // tratti liberi delle due categorie sopra.
  if (it.listKey === 'primaria') {
    const isPrimaryListed = PRIMARY_STATS.some(s => s.key === it.name);
    const opts = PRIMARY_STATS.map(s => `<option value="primaria::${s.key}" ${isPrimaryListed && it.name === s.key ? 'selected' : ''}>${escapeHtml(s.full)} (${s.label})</option>`).join('');
    return `<select data-bonusitemsel="${keyPrefix}" aria-label="Tratto del bonus" ${dis}><optgroup label="Statistiche primarie">${opts}</optgroup></select>`;
  }
  // il fallback "capacitaCombattive" copre sia listKey mancante/non valido
  // sia il caso di una voce appena aggiunta (nome ancora vuoto): senza
  // nome non c'è nulla da far combaciare nelle liste, quindi la voce parte
  // sempre come "nuovo tratto personalizzato" di quella categoria — stessa
  // convenzione già in uso per i bonus di scudo/arma (equipBonusRowHtml).
  const listKey = TECH_BONUS_TRAIT_LISTS.includes(it.listKey) ? it.listKey : 'capacitaCombattive';
  const isListed = !!it.name && (ownByList[listKey].includes(it.name) || knownExtra[listKey].includes(it.name));
  const isCustom = !isListed;
  const optGroup = (label, lk, names) => names.length
    ? `<optgroup label="${escapeHtml(label)}">${names.map(n => `<option value="${lk}::${escapeHtml(n)}" ${!isCustom && listKey === lk && it.name === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</optgroup>`
    : '';
  const knownAll = TECH_BONUS_TRAIT_LISTS.flatMap(lk => knownExtra[lk].map(n => ({ lk, n })));
  const primaryOptGroup = `<optgroup label="Statistiche primarie">${PRIMARY_STATS.map(s => `<option value="primaria::${s.key}">${escapeHtml(s.full)} (${s.label})</option>`).join('')}</optgroup>`;
  return `
    <select data-bonusitemsel="${keyPrefix}" aria-label="Tratto del bonus" ${dis}>
      ${optGroup(TRAIT_LIST_LABELS.capacitaCombattive, 'capacitaCombattive', ownByList.capacitaCombattive)}
      ${optGroup(TRAIT_LIST_LABELS.capacitaNormali, 'capacitaNormali', ownByList.capacitaNormali)}
      ${knownAll.length ? `<optgroup label="Già usati in questa storia">${knownAll.map(({ lk, n }) => `<option value="${lk}::${escapeHtml(n)}" ${!isCustom && listKey === lk && it.name === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</optgroup>` : ''}
      ${primaryOptGroup}
      <option value="__custom__::capacitaCombattive" ${isCustom && listKey === 'capacitaCombattive' ? 'selected' : ''}>Nuovo (Combattive)…</option>
      <option value="__custom__::capacitaNormali" ${isCustom && listKey === 'capacitaNormali' ? 'selected' : ''}>Nuovo (Normali)…</option>
    </select>
    <input type="text" data-bonusitemcustom="${keyPrefix}" value="${escapeHtml(isCustom ? it.name : '')}" placeholder="Nome tratto" maxlength="40" aria-label="Nome tratto personalizzato del bonus" class="${isCustom ? '' : 'hidden'}" ${dis}>`;
}
/* Cella Bonus/Malus di Tecniche/Abilità/Boost: una riga per ogni voce
   strutturata in r[itemsField] (select tratto + valore + rimuovi) più,
   se presente, il vecchio testo libero non ancora migrato (vedi
   migrateTextBonusToItems) — mai nascosto, resta modificabile finché non
   viene sostituito a mano. */
/* Contenuto (senza <td> proprio) della cella Bonus/Malus: riusato sia dalla
   cella dedicata di Boost (traitBonusCellHtml, invariata) sia dalla cella
   "Effetto" unificata di Tecniche/Abilità (effettoCellHtml, vedi sotto). */
function traitBonusItemsHtml(dataAttr, itemsField, r, i, negativeValues, c, locked, displayKind = null) {
  // Il segno meccanico e il nome del campo UI sono concetti distinti:
  // una riga Debuff conserva le voci in bonusItems ma le applica negative.
  // Perciò la colonna resta sempre «Bonus» / «Aggiungi bonus»; soltanto i
  // valori sono negativi. La vera colonna malusItems resta «Malus».
  const field = itemsField === 'malusItems' ? 'malus' : 'bonus';
  const displayLabel = displayKind || field;
  const dis = locked ? 'disabled' : '';
  const legacyText = String(r[field] || '');
  const legacyBlock = legacyText
    ? `<p class="helper-text" style="margin:0 0 4px;">Testo non convertito automaticamente:</p>
       <textarea data-${dataAttr}="${field}" data-idx="${i}" rows="2" placeholder="Un bonus/malus per riga..." ${dis}>${escapeHtml(legacyText)}</textarea>
       ${bulletListHtml(legacyText, negativeValues)}`
    : '';
  const items = r[itemsField] || [];
  // il malus si esprime sempre come valore negativo (mai una magnitudine
  // positiva sottratta implicitamente): input e default coerenti col segno,
  // bonusItemsToLines/tecAbBuffTotal restano comunque robusti anche sui
  // dati salvati prima di questo cambio (vedi Math.abs lì).
  const valMin = negativeValues ? -50 : 1;
  const valMax = negativeValues ? -1 : 50;
  const itemsHtml = items.map((it, ii) => {
    const keyPrefix = `${dataAttr}::${itemsField}::${i}::${ii}`;
    const rawVal = Number(it.valore) || 0;
    const shownVal = negativeValues ? (rawVal ? -Math.abs(rawVal) : -1) : (rawVal || 1);
    return `<div class="equip-bonus-row" data-bonusitemrow="${keyPrefix}">
      <span class="equip-bonus-trait">${traitBonusItemSelectHtml(c, keyPrefix, it, locked)}</span>
      <input type="number" min="${valMin}" max="${valMax}" value="${shownVal}" data-bonusitemvalore="${keyPrefix}" aria-label="Valore ${displayLabel}" style="width:56px;" ${dis}>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-delbonusitem="${keyPrefix}" title="Rimuovi" ${dis}>✕</button>
    </div>`;
  }).join('');
  return `${legacyBlock}
    ${itemsHtml}
    <button type="button" class="btn btn-ghost btn-sm" data-addbonusitem="${dataAttr}::${itemsField}::${i}" style="margin-top:4px;" ${dis}>+ Aggiungi ${displayLabel}</button>`;
}
function traitBonusCellHtml(dataAttr, itemsField, r, i, malus, c, locked) {
  return `<td class="col-bonusmalus">${traitBonusItemsHtml(dataAttr, itemsField, r, i, malus, c, locked)}</td>`;
}
/* Cella "Danno" di Tecniche/Abilità: tipo (Fisico/Magico), se Fisico quale
   statistica richiamare (Forza o Destrezza — il Magico usa sempre Forza
   Magica), e il danno base "n". Il tiro vero e proprio si fa dal pannello
   "Tira danno" nel tab gioco (renderDmgTecAbSelect/#dmg-tecab-resolve-btn),
   non qui: questa cella è solo la configurazione salvata sulla riga. */
/* Contenuto (senza <td> proprio) della configurazione Danno: riusato dalla
   cella "Effetto" unificata quando la riga è di tipo "danno" (vedi
   effettoCellHtml). */
/* Select del tratto di salvezza per l'effetto (solo capacitaCombattive, mai
   capacitaNormali/primarie: l'effetto "riguarda soltanto capacità
   combattive" come richiesto) — nessun valore numerico, è solo la scelta di
   QUALE tratto il bersaglio tirerà contro questo specifico effetto, fissata
   una volta dal Narratore quando crea la riga (mai a runtime). */
function effettoTrattoSelectHtml(keyPrefix, r, dis) {
  const isOfficial = TRAIT_LISTS.capacitaCombattive.includes(r.effettoTratto);
  const isCustom = !!r.effettoTratto && !isOfficial;
  const opts = TRAIT_LISTS.capacitaCombattive.map(n =>
    `<option value="${escapeHtml(n)}" ${r.effettoTratto === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
  return `<select data-effettotrattosel="${keyPrefix}" aria-label="Tratto di salvezza" ${dis}>
      <option value="" ${!r.effettoTratto ? 'selected' : ''}>Tratto di salvezza…</option>
      ${opts}
      <option value="__custom__" ${isCustom ? 'selected' : ''}>Personalizzato…</option>
    </select>
    <input type="text" data-effettotrattocustom="${keyPrefix}" value="${escapeHtml(isCustom ? r.effettoTratto : '')}" placeholder="Nome tratto" maxlength="40" aria-label="Nome tratto di salvezza personalizzato" class="${isCustom ? '' : 'hidden'}" ${dis}>`;
}
/* Blocco "+ Effetto (Rompere, Tramortire, Bruciare...)" + tratto di
   salvezza/bonus%/raggio: condiviso fra dannoConfigHtml (Tipo Danno/Misto)
   e dannoFissoConfigHtml (Tipo Danno fisso) — stesso identico
   comportamento in entrambi i casi, mai una riga a parte da tenere
   sincronizzata a mano. */
function effettoBlockHtml(keyPrefix, r, dis, isTecnica) {
  // Effetto (Rompere/Tramortire/personalizzato) + tratto di salvezza: un
  // <details> collassato di default, aperto solo se già valorizzato — "non
  // sempre visibile, più una cosa in background" come richiesto, senza mai
  // nascondere un effetto già configurato.
  // Un nome fra i 12 del catalogo stati (STATUS_EFFECTS, js/data.js) usa un
  // meccanismo diverso da Rompere/Tramortire: tiro d'ingresso a dado
  // contrapposto percentuale invece del tiro Resistenza/Resistenza/Spirito
  // "sempre dovuto" — stesso campo effettoTratto, riusato però come tratto
  // di RESISTENZA del bersaglio invece che di salvezza. Solo Bruciare e
  // Avvelenare hanno oggi una conseguenza meccanica collegata: gli altri 10
  // sono già scegliibili (per non dover ritoccare l'editor a ogni aggiunta)
  // ma restano solo un'etichetta finché non vengono cablati.
  const statusMatch = statusEffectByName(r.effettoNome);
  const effectCatalogNames = ['Rompere', 'Tramortire', ...STATUS_EFFECTS.map(s => s.label)];
  const effectIsCustom = !!r.effettoNome && !effectCatalogNames.some(n => n.toLowerCase() === String(r.effettoNome).trim().toLowerCase());
  const effectPresetOptions = [
    '<option value="">Nessun effetto</option>',
    ...effectCatalogNames.map(n => `<option value="${escapeHtml(n)}" ${!effectIsCustom && String(r.effettoNome).toLowerCase() === n.toLowerCase() ? 'selected' : ''}>${escapeHtml(n)}</option>`),
    `<option value="__custom__" ${effectIsCustom ? 'selected' : ''}>Personalizzato…</option>`
  ].join('');
  const wiredStatuses = new Set(['bruciare', 'avvelenare', 'elettrificare', 'stordire', 'immobilizzare', 'rallentare', 'confondere', 'corrodere', 'silenziare', 'congelare']);
  const statusHint = statusMatch
    ? (wiredStatuses.has(statusMatch.key)
        ? `<p class="helper-text" style="margin:4px 0 0;">${statusMatch.icon} Stato del catalogo — dado contrapposto percentuale, dura ${statusMatch.turns} turni.</p>`
        : `<p class="helper-text" style="margin:4px 0 0;color:var(--fisico-forte);">${statusMatch.icon} Stato del catalogo, ma la meccanica non è ancora attiva: per ora resta solo un'etichetta.</p>`)
    : '';
  return `<details class="tec-effetto-details" ${r.effettoNome ? 'open' : ''}>
      <summary class="tec-effetto-summary">+ Effetto (Rompere, Tramortire, Bruciare...)</summary>
      <div class="equip-bonus-row" style="margin-top:6px;">
        <select data-effettopreset="${keyPrefix}" aria-label="Effetto di stato" ${dis}>${effectPresetOptions}</select>
        <input type="text" value="${escapeHtml(effectIsCustom ? r.effettoNome : '')}" placeholder="Nome effetto personalizzato" maxlength="30" data-effettonome="${keyPrefix}" class="${effectIsCustom ? '' : 'hidden'}" ${dis}>
      </div>
      ${r.effettoNome ? `<div class="equip-bonus-row" style="margin-top:4px;">${effettoTrattoSelectHtml(keyPrefix, r, dis)}</div>` : ''}
      ${(!isTecnica && statusMatch) ? `<div class="equip-bonus-row" style="margin-top:4px;">
        <label style="white-space:nowrap;">Bonus % al tiro</label>
        <input type="number" min="-100" max="100" value="${Number(r.effettoBonusPct) || 0}" data-effettobonuspct="${keyPrefix}" style="width:56px;" ${dis}>
      </div>
      <div class="equip-bonus-row" style="margin-top:4px;">
        <label style="white-space:nowrap;">Raggio (celle)</label>
        <input type="number" min="0" max="6" value="${Number(r.raggioHex) || 0}" data-raggiohex="${keyPrefix}" style="width:56px;" ${dis} title="0 = solo il bersaglio scelto. Oltre 0 = colpisce anche tutti gli altri partecipanti entro N celle dal bersaglio scelto, sulla stessa mappa.">
      </div>` : ''}
      ${statusHint}
    </details>`;
}
/* Cella "Danno fisso" (solo Abilità, mai le Tecniche): un valore di danno
   FISSO che oltrepassa interamente le difese del bersaglio (nessuna
   riduzione Difesa/Difesa Mentale, nessuna schivata/blocco/critico —
   percorso completamente separato dal vero attacco, vedi
   combatTecAbSourcesFor/resolveDannoFisso/apply_danno_fisso) e può
   opzionalmente applicare uno stato del catalogo, stesso blocco effetto
   già usato da Danno/Misto. */
function dannoFissoConfigHtml(dataAttr, r, i, locked) {
  const keyPrefix = `${dataAttr}::${i}`;
  const dis = locked ? 'disabled' : '';
  return `<div class="equip-bonus-row">
      <label style="white-space:nowrap;">Danno fisso</label>
      <input type="number" min="1" max="999" value="${Number(r.dannoBase) || 0}" data-dannobase="${keyPrefix}" style="width:56px;" ${dis}>
      <span class="helper-text" style="margin:0;">Ignora le difese del bersaglio: nessuna riduzione, schivata, blocco o critico.</span>
    </div>
    ${effettoBlockHtml(keyPrefix, r, dis, false)}`;
}
function dannoConfigHtml(dataAttr, r, i, c, locked) {
  const keyPrefix = `${dataAttr}::${i}`;
  const dis = locked ? 'disabled' : '';
  const fisico = r.dannoTipo !== 'magico' && r.dannoTipo !== 'esplosivo';
  // Il Danno Magico è una prerogativa delle Abilità: le Tecniche restano
  // solo Fisico/Esplosivo (vedi ensureDannoAttivaFields per la
  // normalizzazione dei dati già salvati con questa combinazione).
  const isTecnica = dataAttr === 'tecnica';
  const effettoBlock = effettoBlockHtml(keyPrefix, r, dis, isTecnica);
  return `<div class="equip-bonus-row">
      <select data-dannotipo="${keyPrefix}" ${dis}>
        <option value="fisico" ${fisico ? 'selected' : ''}>Fisico</option>
        ${isTecnica ? '' : `<option value="magico" ${r.dannoTipo === 'magico' ? 'selected' : ''}>Magico</option>`}
        <option value="esplosivo" ${r.dannoTipo === 'esplosivo' ? 'selected' : ''}>Esplosivo</option>
      </select>
      ${fisico ? `<select data-dannostat="${keyPrefix}" ${dis}>
        <option value="for" ${r.dannoStat === 'for' ? 'selected' : ''}>Forza</option>
        <option value="dex" ${r.dannoStat === 'dex' ? 'selected' : ''}>Destrezza</option>
        <option value="mira" ${r.dannoStat === 'mira' ? 'selected' : ''}>Mira</option>
        <option value="fmen" ${r.dannoStat === 'fmen' ? 'selected' : ''}>Forza Mentale</option>
      </select>` : ''}
      ${r.dannoTipo === 'esplosivo' ? '<span class="helper-text" style="margin:0;">Danno puro (nessuna statistica sommata) — applica sempre Bruciare se il colpo va a segno.</span>' : ''}
    </div>
    <div class="equip-bonus-row tecab-atk-row" style="margin-top:4px;">
      <label style="white-space:nowrap;" for="tecab-atk-${keyPrefix.replace(/[^a-zA-Z0-9_-]/g, '-')}">ATK</label>
      <input id="tecab-atk-${keyPrefix.replace(/[^a-zA-Z0-9_-]/g, '-')}" type="number" min="0" max="999" value="${Number(r.dannoBase) || 0}" data-dannobase="${keyPrefix}" aria-label="ATK — danno base" style="width:64px;" ${dis}>
    </div>
    ${(!isTecnica && fisico) ? `<div class="equip-bonus-row" style="margin-top:4px;">
      <label style="white-space:nowrap;">Danno secondario (Magico)</label>
      <input type="number" min="0" max="999" value="${Number(r.dannoBase2) || 0}" data-dannobase2="${keyPrefix}" style="width:56px;" ${dis} title="Opzionale: aggiunge una componente Magica (scalata su Forza Mentale) alla stessa azione, indipendente dalla Fisica sopra — 0 = nessun danno misto.">
    </div>` : ''}
    ${effettoBlock}`;
}
/* Cella "Tipo": Supporto (incrementa tratti/statistiche mentre "Attiva") o
   Danno (regole di Tira danno) — esclusivi, mai entrambi sulla stessa riga.
   Una volta confermato il tipo resta bloccato fino al prossimo level-up
   (vedi creditLevelAP), stessa filosofia di Tratti/Statistiche primarie:
   nessun bottone "Modifica", l'unico sblocco è salire di livello. */
/* Unica fonte di verità per "questa riga Tecnica/Abilità è compilabile a
   sufficienza per essere confermata": usata sia dal vecchio bottone
   "Conferma" per-riga (post-creazione/level-up) sia dalla validazione dello
   step Tecniche/Abilità del wizard di creazione. */
function tecAbRowIsComplete(row, field) {
  if (!row) return false;
  if (row.tipo === 'danno' || row.tipo === 'misto' || row.tipo === 'dannofisso') return true;
  const hasBonus = (row.bonusItems || []).some(it => it.name);
  const hasMalus = field !== 'tecniche' || (row.malusItems || []).some(it => it.name);
  return hasBonus && hasMalus;
}
function narratorTecabRowIsEditing(dataAttr, i) {
  return !!(narratorEditMode && narratorTecabEdit &&
    narratorTecabEdit.dataAttr === dataAttr && narratorTecabEdit.index === Number(i));
}
function tecAbRowLocked(dataAttr, row, i) {
  return !!row.tipoConfirmed && !narratorTecabRowIsEditing(dataAttr, i);
}
function tecAbFieldRowLocked(field, row, i) {
  return tecAbRowLocked(field === 'tecniche' ? 'tecnica' : 'abilita', row, i);
}
function tipoCellHtml(dataAttr, r, i) {
  const keyPrefix = `${dataAttr}::${i}`;
  // narratorEditMode: stesso bypass già in uso per primaryConfirmed/
  // traitsConfirmed — il Narratore deve poter correggere anche righe già
  // confermate dal giocatore, il vero sblocco (livello) resta invariato.
  const confirmed = tecAbRowLocked(dataAttr, r, i);
  const narratorConfirmed = narratorEditMode && !!r.tipoConfirmed;
  const narratorEditing = narratorTecabRowIsEditing(dataAttr, i);
  // nel wizard di creazione niente bottone "Conferma" per-riga: tutte le
  // righe restano modificabili fino alla conferma finale del wizard
  const nonSupportoTipi = ['danno', 'misto', 'debuff', 'dannofisso', 'cura', 'curamax', 'extra'];
  const isSupporto = !nonSupportoTipi.includes(r.tipo);
  return `<td class="col-narrow">
    <select data-tectipo="${keyPrefix}" ${confirmed ? 'disabled' : ''}>
      <option value="supporto" ${isSupporto ? 'selected' : ''}>Supporto</option>
      <option value="debuff" ${r.tipo === 'debuff' ? 'selected' : ''}>Debuff</option>
      <option value="danno" ${r.tipo === 'danno' ? 'selected' : ''}>Danno</option>
      <option value="misto" ${r.tipo === 'misto' ? 'selected' : ''}>Misto (Danno+Supporto)</option>
      ${dataAttr === 'abilita' ? `<option value="dannofisso" ${r.tipo === 'dannofisso' ? 'selected' : ''}>Danno fisso</option>
      <option value="cura" ${r.tipo === 'cura' ? 'selected' : ''}>Cura</option>
      <option value="curamax" ${r.tipo === 'curamax' ? 'selected' : ''}>Cura max</option>
      <option value="extra" ${r.tipo === 'extra' ? 'selected' : ''}>Extra</option>` : ''}
    </select>
    ${narratorConfirmed && !narratorEditing
      ? `<button type="button" class="btn btn-sm" data-tecabedit="${keyPrefix}" style="margin-top:4px;">✎ Modifica</button>`
      : narratorEditing
        ? `<div class="row" style="gap:6px;margin-top:4px;flex-wrap:wrap;"><button type="button" class="btn btn-sm btn-primary" data-tipoconfirm="${keyPrefix}">✔ Conferma</button><button type="button" class="btn btn-sm btn-ghost" data-tecabcancel="${keyPrefix}">Annulla</button></div>`
        : confirmed
          ? '<span class="chip" title="Si sblocca solo con un level-up" style="margin-top:4px;display:inline-block;">🔒 Confermato</span>'
          : (wizardActive ? '' : `<button type="button" class="btn btn-sm btn-primary" data-tipoconfirm="${keyPrefix}" style="margin-top:4px;">✔ Conferma</button>`)}
  </td>`;
}
/* Cella "Conferma" del Boost: stessa filosofia del Tipo di Tecniche/Abilità
   (tipoCellHtml) ma senza selezione — qui blocca l'intera riga (nome,
   bonus, Lv) una volta che nome e almeno un bonus sono compilati; si
   sblocca solo con un level-up (vedi creditLevelAP). */
function boostConfirmCellHtml(r, i) {
  const confirmed = !!r.boostConfirmed && !narratorEditMode;
  return `<td class="col-narrow">
    ${confirmed
      ? '<span class="chip" title="Si sblocca solo con un level-up" style="display:inline-block;">🔒 Confermato</span>'
      : `<button type="button" class="btn btn-sm btn-primary" data-boostconfirm="${i}">✔ Conferma</button>`}
  </td>`;
}
/* Spiegazione collassata di un checkbox (stesso <details>/<summary> già
   usato per l'Effetto opzionale di una riga a Danno, vedi dannoConfigHtml)
   — il checkbox+etichetta restano sempre visibili, solo la descrizione
   estesa si apre a richiesta, per non occupare altezza su schermi stretti
   quando il significato è già chiaro dall'etichetta. */
function chkHelpDetails(text) {
  return `<details class="tec-effetto-details"><summary class="tec-effetto-summary" aria-label="Cos'è?">Cos'è?</summary><p class="helper-text" style="margin:2px 0 0;">${text}</p></details>`;
}
/* Cella "Effetto" (solo i controlli, mai i valori bonus/malus — quelli
   vivono in due colonne a parte, vedi tecAbBonusCellHtml/tecAbMalusCellHtml
   sotto): checkbox/select che dipendono dal Tipo della riga, l'altro
   blocco non compare affatto invece di restare vuoto/inutile accanto. Le
   tre colonne separate sviluppano la riga in ORIZZONTALE invece che
   accatastare tutto in una sola cella altissima. */
function effettoCellHtml(dataAttr, r, i, c) {
  // Una volta confermato il Tipo, l'intero effetto (bonus/malus,
  // configurazione Danno) resta bloccato insieme al select — si sblocca
  // solo con un level-up (vedi creditLevelAP), mai con un bottone "Modifica"
  // — salvo il Narratore in modalità correzione (narratorEditMode), stesso
  // bypass già in uso per primaryConfirmed/traitsConfirmed.
  const locked = tecAbRowLocked(dataAttr, r, i);
  // Colonna "Effetto": le Abilità non hanno mai Contrattacco (solo
  // Tecniche, tratto fisico) quindi il chk-row porta al massimo UN solo
  // controllo (Multi-bersaglio) — può restare più stretta della stessa
  // colonna nelle Tecniche, dove serve spazio per due affiancati.
  const effettoTdClass = dataAttr === 'abilita' ? 'col-effetto-ab' : 'col-bonus';
  // "Multi-bersaglio": in combattimento permette di selezionare più
  // partecipanti invece di uno solo, sia per un attacco/effetto istantaneo
  // (Tipo Danno/Misto) sia per un effetto a durata su Supporto — un'unica
  // azione, un solo costo dedotto, indipendentemente da quanti bersagli
  // vengono scelti (vedi declare_combat_attack_multi/apply_combat_effect_multi,
  // combatResolvePendingTarget). Valido su ogni Tipo, quindi disegnato prima
  // del ramo che dipende da r.tipo, non dentro dannoConfigHtml.
  const multiTargetHtml = `<div class="chk-item">
    <label class="chk-inline">
      <input type="checkbox" data-multitarget="${dataAttr}::${i}" ${r.multiTarget ? 'checked' : ''} ${locked ? 'disabled' : ''}>
      Multi-bersaglio
    </label>${chkHelpDetails('Seleziona più personaggi in combattimento.')}</div>`;
  // "Tiro doppio": si sceglie QUALE statistica primaria (mai HP/MP, non sono
  // mai "tirate" da sole) raddoppiare. Un unico meccanismo per due effetti,
  // a seconda del Tipo della riga: su un Danno/Misto la cui statistica di
  // Danno (vedi dannoConfigHtml) combacia con quella scelta qui, raddoppia
  // anche il tiro di danno di QUESTO attacco (dado+statistica tirati due
  // volte, vedi combatTecAbSourcesFor/combatRollAttackAndDamage) — sostituiva
  // prima una checkbox "X2 Forza/Destrezza" separata, ora unificata qui
  // (stessa identica idea: raddoppiare il tiro di una statistica). Su una
  // riga Supporto/Debuff/Misto mentre è "Attiva" raddoppia invece ogni tiro
  // PURO di quella statistica ovunque venga usato altrove (Bloccare/Difesa,
  // schivata a distanza/Destrezza, attacco a distanza/Mira, Difesa Mentale —
  // vedi rollPureStatTotal/combatHasDoppioTiro): un Danno puro non ha mai
  // "Attiva" (non è tra i Tipi attivabili in populateMpCostSelect), quindi
  // per quelle righe l'unico effetto possibile è il raddoppio del danno.
  // Nessun interruttore separato: la scelta stessa della statistica accende
  // il meccanismo, si spegne solo scegliendo di nuovo "Nessuna".
  // Sul Tipo "Danno" (mai attivabile, vedi populateMpCostSelect) l'unico
  // effetto possibile è il raddoppio del danno di QUESTO attacco, quindi ha
  // senso offrire solo le statistiche che dannoStatFor può davvero produrre
  // come Danno (DANNO_STAT_KEYS) — offrire l'intera lista includerebbe
  // opzioni (VEL/DIF/D.MEN) che su questo Tipo non potrebbero mai combaciare
  // e quindi non farebbero mai nulla, un'apparente scelta senza effetto.
  // "Misto" invece può restare Attiva (è tra i Tipi attivabili), quindi lì
  // la lista resta completa: anche una statistica che non combacia col
  // Danno ha comunque l'effetto "raddoppia ogni tiro puro altrove".
  const doppioTiroStatOptions = PRIMARY_STATS.filter(s => s.key !== 'hp' && s.key !== 'mp'
    && (r.tipo !== 'danno' || DANNO_STAT_KEYS.includes(s.key)));
  const doppioTiroStatHtml = `<div class="equip-bonus-row" style="margin-top:4px;">
      <label class="helper-text" style="margin:0;white-space:nowrap;" title="Se combacia con la statistica del Danno, raddoppia anche il danno di questo attacco. Mentre la riga è Attiva, raddoppia inoltre ogni tiro puro di quella statistica altrove.">Tiro doppio</label>
      <select data-doppiotirostat="${dataAttr}::${i}" ${locked ? 'disabled' : ''}>
        <option value="">Nessuna</option>
        ${doppioTiroStatOptions.map(s => `<option value="${s.key}" ${r.doppioTiroStat === s.key ? 'selected' : ''}>${escapeHtml(s.full)} (${escapeHtml(s.label)})</option>`).join('')}
      </select>
    </div>`;
  if (r.tipo === 'danno') return `<td class="${effettoTdClass}"><div class="chk-row">${multiTargetHtml}</div>${doppioTiroStatHtml}${dannoConfigHtml(dataAttr, r, i, c, locked)}</td>`;
  // "Danno fisso": cella dedicata, minimale — niente Multi-bersaglio (un
  // solo bersaglio per volta, nessun percorso AoE/multi-target costruito
  // per questo Tipo, vedi combatTecAbSourcesFor/resolveDannoFisso) né gli
  // altri controlli di Supporto/Misto (Bonus fisso, Contrattacco, Tiro
  // doppio: nessuno di questi si applica a un attacco istantaneo).
  if (r.tipo === 'dannofisso') return `<td class="${effettoTdClass}">${dannoFissoConfigHtml(dataAttr, r, i, locked)}</td>`;
  // "Cura"/"Cura max"/"Extra" (solo Abilità, vedi tipoCellHtml): 3 valori
  // di Tipo a sé, non una sotto-opzione di Supporto — cella dedicata,
  // ridotta al minimo, niente Multi-bersaglio/Tiro doppio/testo esplicativo
  // di troppo. Il valore fisso scritto a mano legge/scrive direttamente la
  // voce bonusItems su HP (nessun campo duplicato, la stessa lettura già
  // usata da combatEffectRowsFor per Guarigione rapida/maggiore/Sovracura):
  //  - "cura": solo il valore — cura fissa istantanea (Guarigione rapida).
  //  - "curamax": valore + Caratteristica (Forza/Difesa Mentale) + Multi-
  //    bersaglio — cura che scala (dado + caratteristica) applicata súbito,
  //    MAI uno scudo (Guarigione maggiore).
  //  - "extra": stessi campi di "curamax" — ma non cura subito, crea un
  //    cuscinetto HP persistente attivabile solo a HP pieni (Sovracura, vedi
  //    activateSovracuraTarget/applyDamageDrainingBuffer).
  // bonusMode (letto da combatEffectRowsFor/combatResolvePendingTarget) è
  // sincronizzato da r.tipo in ensureDannoAttivaFields, mai impostato qui.
  if (r.tipo === 'cura' || r.tipo === 'curamax' || r.tipo === 'extra') {
    const hpBonusItem = (r.bonusItems || []).find(it => it.listKey === 'primaria' && it.name === 'hp');
    const hpCureValueHtml = `<div class="equip-bonus-row">
        <label style="white-space:nowrap;">Cura (HP)</label>
        <input type="number" min="0" max="999" value="${hpBonusItem ? Math.abs(Number(hpBonusItem.valore) || 0) : 0}" data-hpcurevalue="${dataAttr}::${i}" style="width:64px;" ${locked ? 'disabled' : ''}>
      </div>`;
    if (r.tipo === 'cura') return `<td class="${effettoTdClass}">${hpCureValueHtml}</td>`;
    const multiTargetHtmlPlain = `<div class="chk-item">
      <label class="chk-inline">
        <input type="checkbox" data-multitarget="${dataAttr}::${i}" ${r.multiTarget ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        Multi-bersaglio
      </label></div>`;
    const scalaStatSelectHtml = `<div class="equip-bonus-row" style="margin-top:4px;">
        <label style="white-space:nowrap;">Caratteristica</label>
        <select data-scalastat="${dataAttr}::${i}" ${locked ? 'disabled' : ''}>
          <option value="fmen" ${r.scalaStat !== 'dmen' ? 'selected' : ''}>Forza Mentale</option>
          <option value="dmen" ${r.scalaStat === 'dmen' ? 'selected' : ''}>Difesa Mentale</option>
        </select>
      </div>`;
    return `<td class="${effettoTdClass}">${multiTargetHtmlPlain}${hpCureValueHtml}${scalaStatSelectHtml}</td>`;
  }
  // Niente più checkbox "Attiva" in questa cella: l'attivazione vera passa
  // dal fronte scheda (populateMpCostSelect/#mp-cost-apply, fuori
  // combattimento) e dal pannello Tecniche/Abilità in combattimento
  // (combatEffectRowsFor, che non guarda mai r.attiva) — il campo r.attiva
  // resta nel dato, solo la checkbox ridondante qui è stata tolta per
  // recuperare altezza.
  // Contrattacco (solo Tecniche, tratto fisico Arte Combattiva — mai le
  // Abilità, poteri magici senza contatto fisico): se attivo, in
  // combattimento questa riga compare come opzione di DIFESA sul turno
  // dell'AVVERSARIO (alternativa a Schiva/Blocca/Nessuna, vedi
  // renderCombatAttackPanel/combatRollDefense) — tiro contrapposto di Arte
  // Combattiva (d20 puro se una delle due parti non ha il tratto);
  // l'attaccante vince -> nessun contrattacco, danno pieno automaticamente
  // critico come "Non mi difendo"; il subente vince -> nessun danno subito
  // e metà del danno che avrebbe subito torna all'attaccante senza calcolo
  // di difese. Mai contro armi a distanza/da fuoco (Mira), vedi
  // combat_attacks.attack_trait — consente comunque armi da lancio/bianche.
  const contrattaccoHtml = dataAttr === 'tecnica' ? `<div class="chk-item">
    <label class="chk-inline">
      <input type="checkbox" data-contrattacco="${dataAttr}::${i}" ${r.contrattacco ? 'checked' : ''} ${locked ? 'disabled' : ''}>
      Contrattacco
    </label>${chkHelpDetails('Tecnica di Contrattacco: usabile come difesa reattiva sul turno dell\'avversario, tiro contrapposto di Arte Combattiva, mai contro armi da fuoco/a distanza.')}</div>` : '';
  // Misto: un'unica Abilità con entrambe le funzioni — bonus/malus
  // (potenziamento su chi la usa, colonne a parte) e la configurazione
  // Danno (attacco/effetto sul bersaglio) qui in Effetto, invece di due
  // righe separate.
  if (r.tipo === 'misto') {
    return `<td class="${effettoTdClass}"><div class="chk-row">${multiTargetHtml}${contrattaccoHtml}</div>${doppioTiroStatHtml}<hr style="margin:8px 0;border-color:var(--bordo-scuro);">${dannoConfigHtml(dataAttr, r, i, c, locked)}</td>`;
  }
  return `<td class="${effettoTdClass}"><div class="chk-row">${multiTargetHtml}${contrattaccoHtml}</div>${doppioTiroStatHtml}${dataAttr === 'abilita' ? effettoBlockHtml(`${dataAttr}::${i}`, r, locked ? 'disabled' : '', false) : ''}</td>`;
}
/* Colonna "Bonus": solo Supporto/Debuff/Misto hanno un bonus da mostrare
   (il "potenziamento su chi la usa") — Danno/Danno fisso restano vuoti,
   non hanno mai avuto un concetto di bonusItems. Tipo "Debuff": stesso
   campo di un Supporto, ma mostrato/editato già negativo (vedi
   combatEffectRowsFor per l'applicazione reale come malus al bersaglio). */
function tecAbBonusCellHtml(dataAttr, itemsField, r, i, c) {
  // "Cura"/"Cura max"/"Extra": il valore HP si edita già nella cella
  // Effetto (data-hpcurevalue, stessa voce bonusItems) — niente colonna
  // Bonus generica in più, sarebbe un doppione confuso sullo stesso dato.
  if (r.tipo === 'danno' || r.tipo === 'dannofisso' || r.tipo === 'cura' || r.tipo === 'curamax' || r.tipo === 'extra') return `<td class="col-bonusmalus"></td>`;
  const locked = tecAbRowLocked(dataAttr, r, i);
  const isDebuffRow = r.tipo === 'debuff';
  return `<td class="col-bonusmalus">${traitBonusItemsHtml(dataAttr, itemsField, r, i, isDebuffRow, c, locked)}</td>`;
}
/* Colonna "Malus": solo le Tecniche (malusItemsField), su qualunque Tipo
   che lo preveda — mai le Abilità (nessun campo malusItems, colonna non
   nemmeno presente in tabella, vedi index.html). "Danno fisso" non ha mai
   un malus (è un'Abilità comunque, quindi malusItemsField è già null lì). */
function tecAbMalusCellHtml(dataAttr, malusItemsField, r, i, c) {
  if (!malusItemsField) return `<td class="col-bonusmalus"></td>`;
  const locked = tecAbRowLocked(dataAttr, r, i);
  return `<td class="col-bonusmalus">${traitBonusItemsHtml(dataAttr, malusItemsField, r, i, true, c, locked)}</td>`;
}
function makeConsumabileRow() { return { nome: '', effetto: 'recuperoHp', target: '', targetListKey: '', durationQuarters: 12, valore: 0, quantita: 0 }; }
function makeRelazioneRow() { return { nome: '', relazione: '', descrizione: '' }; }
function defaultBoost() {
  const o = {};
  BOOST_LEVELS.forEach(b => { o[b.lv] = { appreso: false }; });
  return o;
}
function defaultTertiaryPM() {
  const o = {};
  TERTIARY_STATS.forEach(s => { o[s.key] = { plus: 0, minus: 0 }; });
  return o;
}
function defaultPrimary() {
  const o = {};
  PRIMARY_STATS.forEach(s => { o[s.key] = PRIMARY_MIN; });
  return o;
}
/* Il pool di 5 punti (TERTIARY_POOL) e' la SOMMA finale di Stile+Fortuna+
   Carisma, non punti da spendere a partire dal minimo di ciascuna: si
   parte da 0 per tutte e tre (sum=0, quindi "punti rimanenti" mostra
   subito 5), non da TERTIARY_MIN (-1) per tutte, che farebbe partire il
   contatore da 8 invece che da 5 — vedi manuale, "Le regole".
   TERTIARY_MIN resta comunque il minimo raggiungibile per ciascuna. */
function defaultTertiary() {
  const o = {};
  TERTIARY_STATS.forEach(s => { o[s.key] = 0; });
  return o;
}
function defaultTraits() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => {
    o[k] = {};
    TRAIT_LISTS[k].forEach(name => { o[k][name] = 0; });
  });
  return o;
}
function defaultCustomTraits() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => { o[k] = []; });
  return o;
}
function defaultShownTraits() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => { o[k] = []; });
  return o;
}
/* Punti extra concessi dal Narratore per motivi di trama (addestramento,
   studio, salti temporali), separati per categoria: si sommano al pool
   normale di quella categoria, non sono fungibili con le altre due. */
function defaultTraitNarratoreBonus() {
  const o = {};
  Object.keys(TRAIT_LISTS).forEach(k => { o[k] = 0; });
  return o;
}

function newCharacter(nome) {
  return {
    id: uid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nome: nome || '',
    razza: '',
    eta: '',
    ruolo: '',
    storia: '',
    storiaId: null,
    build: 'guerriero',
    // gate unico della creazione guidata: false finché il wizard non arriva
    // alla conferma finale (vedi openCreationWizard/wizardFinalConfirm) —
    // da quel momento in poi il personaggio apre sempre la scheda normale,
    // mai più il wizard (ensureShape lo retroattiva a true per le schede
    // salvate prima dell'introduzione di questo flag)
    creationCompleted: false,
    buildConfirmed: false,
    primaryConfirmed: false,
    primaryFloor: {},
    traitsConfirmed: false,
    eclecticoHpMult: 7,
    primary: defaultPrimary(),
    tertiary: defaultTertiary(),
    tertiaryPM: defaultTertiaryPM(),
    tertiaryFloor: {},
    bellezzaManuale: null,
    bellezzaTirata: null,
    qi: null,
    qiProgresso: 0,
    livello: 1,
    livelloAP: 1,
    apDisponibili: 0,
    ledger: [],
    cloudCharacterId: null,
    cloudCampaignId: null,
    cloudCampaignName: null,
    cloudJoinRequestId: null,
    cloudJoinCampaignId: null,
    cloudJoinCampaignName: null,
    cloudCampaignTrashedAt: null,
    cloudCampaignPurgeAt: null,
    // account cloud collegato in questo dispositivo al momento della
    // creazione: serve solo a filtrare l'elenco "I tuoi personaggi" per non
    // mostrare personaggi creati da un altro account sullo stesso telefono/
    // browser condiviso — null = "non rivendicato" (creato senza nessun
    // account collegato), sempre visibile a chiunque
    ownerAccountId: null,
    traits: defaultTraits(),
    customTraits: defaultCustomTraits(),
    shownTraits: defaultShownTraits(),
    traitNarratoreBonus: defaultTraitNarratoreBonus(),
    hpMaxTracked: null, mpMaxTracked: null, prMaxTracked: null,
    hpCur: null, mpCur: null, ppCur: null, prCur: null,
    // Cuscinetto HP di Sovracura: persistente (mai una durata a turni),
    // assorbe danno prima degli HP veri, si azzera solo consumandolo o al
    // prossimo riposo — vedi applyDamageDrainingBuffer/activateSovracuraTarget.
    hpBuffer: 0,
    slots: defaultSlots(),
    weaponSlots: defaultWeaponSlots(),
    tecniche: [],
    abilita: [],
    tecAbChoices: {},
    // apprendimenti extra concessi dal Narratore fuori dal normale budget di
    // build/livello (es. addestramento/studio in giocata): sommati al
    // budget calcolato da tecAbSbloccate, mai sottratti — stesso principio
    // già in uso per traitNarratoreBonus sui tratti.
    tecAbNarratoreBonus: { tec: 0, ab: 0 },
    tecDirectLvUsed: 0,
    abDirectLvUsed: 0,
    // Registro delle assegnazioni Tecnica/Abilità (level-up di classe +
    // concessioni narrative): sostituisce la vecchia regola "2 apprendimenti
    // dello stesso tipo per +1 Lv" (mai stata nel codice, solo nel manuale,
    // vedi js/rules.js) — ogni assegnazione si consuma DA SOLA, per una
    // nuova voce o per +1 Lv su una già posseduta. Vedi makeTecabAssignment/
    // syncTecabAssignments più sotto.
    tecabAssignments: [],
    // Crediti supremi Lv 25/30, spendibili su un Boost scelto.
    boostSupremeCredits: 0,
    boostSupremeAwards: [],
    // Coda di avanzamenti di livello maturati per utilizzi reali in
    // combattimento (vedi logTecnicaAbilitaUsageFor) ma non ancora
    // applicati/configurati: applied=true quando il Lv è già stato alzato
    // (a fine combattimento, vedi checkTecabPendingAdvancements),
    // resolved=true solo dopo che il giocatore ha confermato la schermata
    // "Incremento Tecnica/Abilità" (showNextTecabAdvancement) — le voci
    // risolte restano in elenco come storico (beforeSnapshot/appliedDelta),
    // mai rimosse, mai riapplicate due volte.
    tecabPendingAdvancements: [],
    boostRows: [],
    boostRowsShown: 1,
    boost: defaultBoost(),
    // Checkpoint "Boost e pedina di combattimento": coda di avanzamenti
    // pendenti (stesso principio di tecabPendingAdvancements, applicati solo
    // a fine combattimento) e stato di attivazione locale per un personaggio
    // NON in un combattimento cloud attivo (mai un finto combattimento: solo
    // PP spesi + bonus "primaria"/tratto attivi, nessun conto alla rovescia
    // a turni perché fuori da un incontro non esiste un vero turno da
    // contare — vedi activateBoostRow/boostIsActiveLocally).
    boostPendingAdvancements: [],
    boostLocalActivation: null,
    inventario: [],
    consumabili: [],
    statBuffs: [],
    pendingLoot: [],
    // Sync completa col cloud (vedi syncCharacterFromCloud/pushCharacterToCloud
    // in cloud-character.js): cloudVersion e' l'ultima characters.current_version
    // che questo dispositivo ha davvero incorporato, cloudDirty segna se ci sono
    // modifiche locali non ancora confermate nel cloud dall'ultimo push/pull.
    cloudVersion: null,
    cloudDirty: false,
    portrait: null,
    portraitPos: null,
    relazioni: [],
    bg: defaultBg(),
    bgLocked: defaultBgLocked(),
    note: { aspetto: '', morale: '', background: '', libere: '' }
  };
}

/* Campi del background (da Campi_scheda: dati generali, aspetto, vita,
   atteggiamento, passato, relazioni — esclusi i ridondanti già presenti
   altrove: nome, occupazione). "eta" qui è un campo narrativo a sé
   (testo libero, può differire in tono da come la si racconta) rispetto
   al valore numerico di Anagrafica (c.eta, #f-eta) — stesso nome del
   campo, namespace diverso (c.bg.eta vs c.eta), nessuna sincronizzazione
   fra i due, voluta: uno è un dato di scheda, l'altro un dettaglio del
   dossier narrativo. */
function defaultBg() {
  const keys = ['nascitaData', 'nascitaLuogo', 'eta', 'origini', 'frase',
    'altezza', 'peso', 'pelle', 'acconciatura', 'occhi', 'segni', 'corporatura', 'postura', 'vestiario', 'oggetto',
    'abilita', 'incompetenze', 'debolezze', 'hobby', 'abitudini',
    'personalita', 'morale', 'autocontrollo', 'motivazione', 'scoraggiamento', 'sicurezza', 'filosofia', 'paura', 'obiettivoBreve', 'obiettivoLungo',
    'infanzia', 'eventoImportante', 'segreto', 'peggiorMomento', 'migliorMomento'];
  const o = {};
  keys.forEach(k => { o[k] = ''; });
  return o;
}
/* I 5 contenitori del Background (Dati generali+Aspetto accorpati, Vita,
   Atteggiamento, Passato, Relazioni): un solo menu a tendina (#bg-nav-select)
   decide quale contenitore è visibile alla volta, invece di impilarli tutti
   in un'unica pagina a scorrimento chilometrico. Ciascuno resta comunque un
   blocco sola-lettura/modifica indipendente dagli altri. */
const BG_SECTIONS = ['datiAspetto', 'vita', 'atteggiamento', 'passato', 'relazioni'];
/* Sola lettura di default: il testo va sempre modificato "su richiesta"
   (bottone Modifica), poi confermato per tornare bloccato — anche per i
   personaggi già esistenti, che partono tutti bloccati alla migrazione. */
function defaultBgLocked() {
  const o = {};
  BG_SECTIONS.forEach(k => { o[k] = true; });
  return o;
}
/* Altezza del campo adattata al contenuto: nessun testo del Background va
   letto scorrendo dentro una textarea piccola, deve comparire per intero. */
function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* Colma eventuali campi mancanti se il personaggio arriva da una versione precedente dell'app */
/* Migrazione compatibile: il vecchio tratto confluisce nel tratto ufficiale
   Resistenza. I valori standard, personalizzati e i relativi pavimenti si
   sommano (massimo 50), mentre riferimenti e bonus vengono rinominati
   ricorsivamente. L'operazione è idempotente. */
function migrateLegacyResistanceTrait(c) {
  if (!c || typeof c !== 'object') return c;
  const legacyName = ['Robuste', 'zza'].join('');
  const officialName = 'Resistenza';
  const combatKey = 'capacitaCombattive';
  const sameTrait = name => [legacyName, officialName].some(
    candidate => String(name || '').localeCompare(candidate, 'it', { sensitivity: 'base' }) === 0
  );
  const cappedSum = values => Math.min(50, values.reduce(
    (sum, value) => sum + (Number(value) || 0), 0
  ));

  const combat = c.traits && c.traits[combatKey];
  const custom = c.customTraits && Array.isArray(c.customTraits[combatKey])
    ? c.customTraits[combatKey] : [];
  if (combat && typeof combat === 'object') {
    const customValues = custom.filter(row => sameTrait(row && row.name)).map(row => row.value);
    const mergedValue = cappedSum([combat[officialName], combat[legacyName], ...customValues]);
    combat[officialName] = mergedValue;
    delete combat[legacyName];
    if (customValues.length) {
      c.customTraits[combatKey] = custom.filter(row => !sameTrait(row && row.name));
    }
  }

  const floor = c.traitsFloor && c.traitsFloor[combatKey];
  if (floor && typeof floor === 'object') {
    floor[officialName] = cappedSum([floor[officialName], floor[legacyName]]);
    delete floor[legacyName];
  }

  const shown = c.shownTraits && c.shownTraits[combatKey];
  if (Array.isArray(shown)) {
    const renamed = shown.map(name => sameTrait(name) ? officialName : name);
    c.shownTraits[combatKey] = [...new Set(renamed)];
  }

  // Rinomina solo i campi che sono ESATTAMENTE il nome del tratto (es.
  // effettoTratto:'Robustezza', attackTraitName:'Robustezza', il nome di un
  // bonus {kind:'trait', name:'Robustezza'}) — MAI una sostituzione di
  // sottostringa: un testo narrativo/nota/descrizione libera che contenga la
  // parola "Robustezza" dentro una frase (es. "il personaggio è noto per la
  // sua Robustezza") deve restare intatto, non è un riferimento a un tratto.
  const visit = value => {
    if (typeof value === 'string') {
      return sameTrait(value) ? officialName : value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(key => { value[key] = visit(value[key]); });
    }
    return value;
  };
  return visit(c);
}

function ensureShape(c) {
  migrateLegacyResistanceTrait(c);
  if (!c.tecabLegacyBackupV1) {
    c.tecabLegacyBackupV1 = {
      schemaVersion: 1, capturedAt: new Date().toISOString(),
      tecniche: JSON.parse(JSON.stringify(Array.isArray(c.tecniche) ? c.tecniche : [])),
      abilita: JSON.parse(JSON.stringify(Array.isArray(c.abilita) ? c.abilita : []))
    };
  }
  const d = newCharacter();
  const hadShown = c.shownTraits !== undefined;
  // i personaggi creati prima dell'introduzione della conferma di classe
  // mantengono la loro classe come già confermata (regola: non modificabile)
  const hadBuildConfirmed = c.buildConfirmed !== undefined;
  // i personaggi creati prima del wizard di creazione separato sono già
  // "creati" a tutti gli effetti: non vanno mai rispediti nel wizard
  const hadCreationCompleted = c.creationCompleted !== undefined;
  const hadLivelloAP = c.livelloAP !== undefined;
  const hadPrimaryFloor = c.primaryFloor !== undefined;
  const hadTraitsFloor = c.traitsFloor !== undefined;
  // personaggi salvati prima del registro tecabAssignments (checkpoint
  // "sistema apprendimenti"): il backfill più sotto ricostruisce le
  // assegnazioni già spese dai dati esistenti, non va mai rifatto su un
  // personaggio che il registro ce l'ha già.
  const hadTecabAssignments = c.tecabAssignments !== undefined;
  // i personaggi creati prima dell'introduzione del blocco statistiche
  // restano sbloccati (comportamento libero già in uso): il blocco vale solo
  // da quando il giocatore lo conferma esplicitamente per la prima volta,
  // Object.keys(d) sotto imposta già primaryConfirmed:false di default
  Object.keys(d).forEach(k => { if (c[k] === undefined) c[k] = d[k]; });
  // il P.R. non è (mai stato, di fatto) una statistica primaria: il vero
  // valore vive solo in prMaxTracked/prCur, quindi il residuo c.primary.pr
  // dei personaggi salvati prima di questa correzione viene ripulito (non
  // veniva più letto da nessun calcolo, restava solo a intaccare per errore
  // il pool dei 40 punti delle primarie vere e proprie)
  if (c.primary) delete c.primary.pr;
  if (!hadBuildConfirmed) c.buildConfirmed = true;
  if (!hadCreationCompleted) c.creationCompleted = true;
  // personaggi con statistiche gia' confermate prima dell'introduzione del
  // "pavimento" per livello: i valori attuali sono gia' quelli confermati
  // (bloccati, quindi invariati dall'ultima conferma), diventano la base
  // da cui non si potra' scendere al prossimo sblocco
  if (!hadPrimaryFloor && c.primaryConfirmed) snapshotPrimaryFloor(c);
  // i personaggi esistenti non ricevono AP retroattivi: il conteggio
  // automatico parte dal livello attuale
  if (!hadLivelloAP) c.livelloAP = c.livello || 1;
  // migrazione: i tratti già valorizzati diventano automaticamente "posseduti"
  Object.keys(TRAIT_LISTS).forEach(k => {
    if (!c.traits[k]) c.traits[k] = {};
    if (!Array.isArray(c.customTraits[k])) c.customTraits[k] = [];
    if (!hadShown || !Array.isArray(c.shownTraits[k])) {
      c.shownTraits[k] = TRAIT_LISTS[k].filter(n => (Number(c.traits[k][n]) || 0) > 0);
    }
  });
  // personaggi con tratti già confermati prima dell'introduzione del
  // "pavimento" per livello (stesso principio di hadPrimaryFloor sopra): i
  // valori attuali sono già quelli confermati, diventano la base da cui non
  // si potrà scendere al prossimo sblocco per level-up.
  if (!hadTraitsFloor && c.traitsConfirmed) snapshotTraitsFloor(c);
  // migrazione retro scheda: le vecchie righe {nome, effetto} passano alle
  // colonne ufficiali (l'effetto libero finisce nella prima colonna utile)
  c.tecniche = (c.tecniche || []).map(r => r.effetto === undefined ? r
    : { ...makeTecnicaRow(), nome: r.nome || '', bonus: r.effetto || '' });
  c.abilita = (c.abilita || []).map(r => r.effetto === undefined ? r
    : { ...makeAbilitaRow(), nome: r.nome || '', costo: r.effetto || '' });
  // bonus/malus di Tecniche/Abilità/Boost: da testo libero a voci
  // strutturate che pescano da un tratto vero (vedi migrateTextBonusToItems)
  c.tecniche.forEach(r => { migrateTextBonusToItems(r, 'bonus', 'bonusItems', c); migrateTextBonusToItems(r, 'malus', 'malusItems', c); });
  c.abilita.forEach(r => migrateTextBonusToItems(r, 'bonus', 'bonusItems', c));
  (c.boostRows || []).forEach(r => migrateTextBonusToItems(r, 'bonus', 'bonusItems', c));
  // Checkpoint "Boost e pedina": backfill ADDITIVO, mai distruttivo — un id
  // mancante ne riceve uno nuovo (mai toccato se già presente, così un
  // rowId già usato da un'attivazione/avanzamento pendente resta valido);
  // progresso/lvTop mancanti partono da 0/false senza mai abbassare un
  // valore già scritto; un "lv" già valido (1-5) resta letteralmente
  // invariato (recomputeBoostRow più sotto lo clampa solo se assente/non
  // numerico, mai lo riduce).
  (c.boostRows || []).forEach(r => {
    if (!r.id) r.id = uid();
    if (typeof r.progresso !== 'number' || isNaN(r.progresso)) r.progresso = 0;
    if (typeof r.lvTop !== 'boolean') r.lvTop = false;
  });
  // boostPendingAdvancements/boostLocalActivation: già seminati a []/null dal
  // backfill generico Object.keys(d) più sopra per i personaggi che non li
  // avevano — solo una guardia di resistenza contro un array diventato non
  // valido per qualunque motivo (mai perso, mai sostituito se già presente).
  if (!Array.isArray(c.boostPendingAdvancements)) c.boostPendingAdvancements = [];
  if (!Array.isArray(c.boostSupremeAwards)) c.boostSupremeAwards = [];
  c.boostSupremeCredits = Math.max(0, Number(c.boostSupremeCredits) || 0);
  // migrazione: ricostruisce il registro tecabAssignments dai dati del
  // vecchio sistema (nomi già assegnati, directLvSpent per riga,
  // tecDirectLvUsed/abDirectLvUsed) — vedi backfillTecabAssignments. Deve
  // girare DOPO la migrazione delle righe qui sopra, che è quella che
  // garantisce la forma corretta di c.tecniche/c.abilita.
  if (!hadTecabAssignments) backfillTecabAssignments(c);
  // boost: quante righe sono attive (1 o 2), dedotto dal contenuto se assente
  if (typeof c.boostRowsShown !== 'number') {
    const piene = (c.boostRows || []).filter(rowHasContent).length;
    c.boostRowsShown = clamp(Math.max(1, piene), 1, BOOST_ROWS_MAX);
  }
  // background: assicura tutte le chiavi e recupera i vecchi campi di Note
  const dbg = defaultBg();
  if (!c.bg) c.bg = {};
  Object.keys(dbg).forEach(k => { if (c.bg[k] === undefined) c.bg[k] = ''; });
  // relazioni: da campo unico di testo libero a elenco di N schede (Nome,
  // Relazione, Descrizione); il vecchio testo confluisce nella prima scheda
  if (!Array.isArray(c.relazioni)) c.relazioni = [];
  if (c.bg.relazioni) {
    c.relazioni.push({ nome: '', relazione: '', descrizione: c.bg.relazioni });
    delete c.bg.relazioni;
  }
  if (c.note.morale && !c.bg.morale) { c.bg.morale = c.note.morale; c.note.morale = ''; }
  if (c.note.background && !c.bg.infanzia) { c.bg.infanzia = c.note.background; c.note.background = ''; }
  if (c.note.aspetto) {
    c.note.libere = (c.note.libere ? c.note.libere + '\n\n' : '') + 'Aspetto: ' + c.note.aspetto;
    c.note.aspetto = '';
  }
  // rinomina i vecchi nomi predefiniti delle locazioni in quelli ufficiali
  const slotRenames = { 'Testa': 'Capo', 'Torso': 'Busto', 'Braccio Destro': 'Braccio Dx',
    'Braccio Sinistro': 'Braccio Sx', 'Gamba Destra': 'Gamba Dx', 'Gamba Sinistra': 'Gamba Sx' };
  // il retro scheda ora ospita solo armature (le armi sono sul fronte): le
  // vecchie locazioni con Arma/Scudo perdono taglia/qualità non più valide
  const armorSizes = (EQUIP_TYPES.find(t => t.key === 'armatura') || { sizes: [] }).sizes.map(sz => sz.key);
  (c.slots || []).forEach(s => {
    if (slotRenames[s.name]) s.name = slotRenames[s.name];
    delete s.item;
    delete s.type;
    s.kind = 'armatura';
    if (s.size && !armorSizes.includes(s.size)) { s.size = ''; s.quality = ''; s.atk = 0; s.dif = 0; s.dur = 0; }
    if (s.quality === undefined) s.quality = '';
    if (!Array.isArray(s.bonuses)) s.bonuses = [];
    // blocco/conferma scheda equip: i personaggi già esistenti partono
    // sbloccati (comportamento libero già in uso prima di questa modifica),
    // durCur si allinea difensivamente a dur finché non viene confermata
    if (typeof s.statsConfirmed !== 'boolean') s.statsConfirmed = false;
    if (typeof s.durCur !== 'number' || isNaN(s.durCur)) s.durCur = Number(s.dur) || 0;
    // identità reale "pezzo già confermato almeno una volta in passato":
    // i personaggi salvati prima di questo campo non ce l'hanno, ma se
    // statsConfirmed è già true sappiamo per certo che una conferma è già
    // avvenuta (sotto la logica precedente) — mai dedotto da dur>0, che un
    // pezzo può avere anche PRIMA della sua primissima conferma (taglia/
    // qualità scelte ma "Conferma scheda" mai ancora premuto).
    if (typeof s.hasBeenConfirmed !== 'boolean') s.hasBeenConfirmed = s.statsConfirmed === true;
    (s.bonuses || []).forEach(b => {
      // il P.R. (statistica secondaria) non è mai un bersaglio valido per
      // l'equipaggiamento, armatura inclusa: solo i consumabili possono
      // incrementarlo — un eventuale bonus salvato su 'pr' viene riallineato
      if (b.kind === 'primary' && b.key === 'pr') b.key = PRIMARY_STATS[0].key;
      // le statistiche terziarie (Stile/Fortuna/Carisma) non sono mai un
      // bersaglio valido per l'equipaggiamento (come già per scudo/arma): un
      // bonus salvato prima di questa correzione si riallinea su una
      // primaria valida invece di sparire senza spiegazione
      if (b.kind === 'tertiary') { b.kind = 'primary'; b.key = PRIMARY_STATS[0].key; }
      // le Conoscenze sono nozioni teoriche: un pezzo di equipaggiamento non
      // le aumenta davvero, solo Capacità Normali/Combattive restano
      // bersagli validi per un bonus di armatura
      if (b.kind === 'trait' && b.listKey === 'conoscenze') b.listKey = 'capacitaNormali';
    });
  });
  (c.weaponSlots || []).forEach(s => {
    if (s.quality === undefined) s.quality = '';
    if (!Array.isArray(s.bonuses)) s.bonuses = [];
    if (typeof s.peso !== 'number') s.peso = 0;
    if (typeof s.statsConfirmed !== 'boolean') s.statsConfirmed = false;
    if (typeof s.durCur !== 'number' || isNaN(s.durCur)) s.durCur = Number(s.dur) || 0;
    // vedi il backfill gemello su c.slots poco sopra: stessa identità reale,
    // mai dedotta da dur>0.
    if (typeof s.hasBeenConfirmed !== 'boolean') s.hasBeenConfirmed = s.statsConfirmed === true;
    // personaggi creati prima del flag equipaggiato/inventario: erano già
    // sempre "attivi" prima di questa funzione, quindi restano equipaggiati
    if (s.equipaggiato === undefined) s.equipaggiato = true;
    if (s.kind === 'arma') {
      if (s.weaponClass !== 'bianca' && s.weaponClass !== 'tiro' && s.weaponClass !== 'lancio') s.weaponClass = 'bianca';
      if (typeof s.usaFor !== 'boolean' && typeof s.usaDex !== 'boolean' && typeof s.usaFmen !== 'boolean') s.usaFor = true;
      if (typeof s.usaFor !== 'boolean') s.usaFor = false;
      if (typeof s.usaDex !== 'boolean') s.usaDex = false;
      if (typeof s.usaFmen !== 'boolean') s.usaFmen = false;
    }
    // scudi e armi incidono solo su DIF/D.MEN (scudo) o FOR/DEX/F.MEN (arma)
    // e sui tratti dei rispettivi elenchi chiusi: eventuali bonus salvati
    // fuori da queste regole (es. da prima di questa correzione) vengono
    // riallineati al primo bersaglio valido, senza perdere il valore assegnato
    if (s.kind === 'scudo' || s.kind === 'arma') {
      const allowedPrimary = primaryBonusKeysFor(s.kind);
      (s.bonuses || []).forEach(b => {
        if (b.kind === 'tertiary') { b.kind = 'primary'; b.key = allowedPrimary[0]; }
        else if (b.kind === 'primary' && !allowedPrimary.includes(b.key)) { b.key = allowedPrimary[0]; }
        // un tratto già salvato con un nome fuori dall'elenco suggerito resta
        // com'è: è la scelta "nuovo tratto personalizzato", sempre valida
      });
    }
  });
  // oggetti dello Zaino salvati prima dell'introduzione del peso
  (c.inventario || []).forEach(r => { if (typeof r.peso !== 'number') r.peso = 0; });
  // il vincolo "solo Scudo e Arma 1" è superato: ora si possono aggiungere ed
  // equipaggiare più armi (vedi equipaggiato/weaponClass sopra), quindi le
  // vecchie locazioni "Arma 2"/"Arma 3" filtrate in passato non vanno più
  // rimosse a ogni caricamento
  return c;
}

/* ------------------------------------------------------------------ toast */

/* Hotfix "toast persistente e safe area di sistema": il testo resta nel DOM
   solo mentre il toast è davvero visibile o in transizione — pulito da
   questo listener, registrato UNA SOLA VOLTA qui fuori da toast()/
   hideToast() (mai dentro, per non accumulare listener duplicati a ogni
   chiamata), che interviene solo a transizione di opacity conclusa e solo
   se .show è già stata rimossa (mai a scatto, mai durante l'apertura). */
(function initToastCleanup() {
  const el = $('#toast');
  if (!el) return;
  el.addEventListener('transitionend', (e) => {
    if (e.target !== el || e.propertyName !== 'opacity') return;
    if (!el.classList.contains('show')) el.textContent = '';
  });
})();

/* Spazio reale (misurato, mai un valore fisso indovinato) occupato da un
   eventuale elemento persistente sul fondo della vista attiva — payoff in
   copertina, barra di navigazione del wizard, pannello comandi in
   combattimento (vedi [data-toast-clear] in index.html e --toast-reserved
   in css/style.css): il toast deve comparire sempre sopra, mai sovrapposto.
   0 quando la vista corrente non ne ha uno.
   Doppio conteggio della safe-area (hotfix): questi elementi includono già
   var(--safe-bottom) nel proprio padding inferiore (vedi le rispettive
   regole in css/style.css), e il bottom del toast lo aggiunge di nuovo per
   conto proprio — sommare qui anche l'altezza intera del padding
   spingerebbe il toast di due volte lo stesso inset. Si esclude quindi il
   padding-bottom REALE dell'elemento (il suo valore calcolato attuale, non
   una sua ricostruzione) dall'altezza misurata: ciò che resta è
   l'ingombro "sopra" quella fascia, indipendente da --safe-bottom, quindi
   un cambiamento di --safe-bottom sposta il toast esattamente della stessa
   quantità, mai il doppio.
   Si misura inoltre solo la porzione REALMENTE dentro il viewport
   corrente (mai l'altezza intera dell'elemento): un payoff sotto la piega
   (es. su viewport desktop corti, dove #toast passa a position:absolute)
   non deve riservare spazio per un contenuto che comunque non si vede. */
function updateToastReservedSpace() {
  const activeView = $$('.view').find(v => !v.classList.contains('hidden'));
  const reserved = activeView ? activeView.querySelector('[data-toast-clear]') : null;
  if (!reserved) { document.documentElement.style.setProperty('--toast-reserved', '0px'); return; }
  const rect = reserved.getBoundingClientRect();
  const paddingBottom = parseFloat(getComputedStyle(reserved).paddingBottom) || 0;
  const contentBottom = rect.bottom - paddingBottom;
  const visibleTop = Math.max(rect.top, 0);
  const visibleContentBottom = Math.min(contentBottom, window.innerHeight);
  const extra = Math.max(0, visibleContentBottom - visibleTop);
  document.documentElement.style.setProperty('--toast-reserved', extra + 'px');
}

let toastTimer = null;
const TOAST_DURATION_MS = 1800;
function toast(msg) {
  // Rifiuta valori nulli/undefined/vuoti (anche solo spazi): mai un toast
  // bianco senza testo, che sulla vista scura sarebbe una macchia bianca
  // senza alcun significato per chi la vede.
  if (msg === null || msg === undefined) return;
  const text = String(msg).trim();
  if (!text) return;
  const el = $('#toast');
  updateToastReservedSpace();
  el.textContent = text;
  el.classList.add('show');
  // Annulla sempre il timer precedente: un vecchio timer non deve mai
  // chiudere il toast appena aperto al posto del proprio.
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastTimer = null; hideToast(); }, TOAST_DURATION_MS);
}
// Un avviso apparso appena prima di cambiare sezione restava visibile fino
// allo scadere del timer anche sulla vista nuova, sembrando "appeso" lì
// invece che riferito all'azione appena compiuta: ogni cambio vista lo
// chiude subito (vedi showViewDom). Chiude anche quando l'app va in
// background (vedi visibilitychange più sotto): un avviso legato al
// momento in cui è comparso non deve restare sospeso lì e "ripresentarsi"
// al rientro in primo piano, magari riferito a un'azione ormai lontana.
function hideToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  $('#toast').classList.remove('show');
}
// Rotazione, comparsa/scomparsa della tastiera, passaggio fra gesture e tre
// pulsanti: qualunque evento che può cambiare l'altezza dell'elemento
// riservato sul fondo mentre il toast è già visibile. Registrato una sola
// volta qui fuori da toast(), non ad ogni chiamata.
window.addEventListener('resize', () => { if ($('#toast').classList.contains('show')) updateToastReservedSpace(); });
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => { if ($('#toast').classList.contains('show')) updateToastReservedSpace(); });
}

/* ---------------------------------------------------- errori non gestiti */

/* Prima di questo punto un errore JS non previsto (un bug, una chiamata
   cloud che rifiuta la sua Promise senza un .catch a monte...) non aveva
   ALCUN gestore globale: spariva in console, senza che l'utente sapesse
   perché un'azione non ha avuto effetto, e senza alcun modo di accorgersene
   senza aprire gli strumenti di sviluppo. Non cambia il comportamento del
   percorso già gestito (i tanti try/catch/.catch già presenti continuano a
   mostrare il loro messaggio specifico, come sempre): questo è solo la
   rete di sicurezza per ciò che sfugge a quelli. Un solo avviso generico,
   mai un dettaglio tecnico (stack trace, nome del file) mostrato
   all'utente — quello resta in console, per chi deve poi indagare.
   Throttle: una raffica di errori collegati allo stesso bug (es. un
   intervallo che fallisce ogni pochi secondi) mostra un solo avviso invece
   di spam ripetuto. */
let lastUnhandledErrorToastAt = 0;
function reportUnhandledError(err, source) {
  console.error(`[${source}]`, err);
  const now = Date.now();
  if (now - lastUnhandledErrorToastAt < 8000) return;
  lastUnhandledErrorToastAt = now;
  toast("Si è verificato un errore imprevisto. Se un'azione non ha avuto effetto, riprova.");
}
window.addEventListener('error', e => reportUnhandledError(e.error || e.message, 'errore'));
window.addEventListener('unhandledrejection', e => reportUnhandledError(e.reason, 'promise'));

/* --------------------------------------------------------------- routing */

/* Pila delle view visitate, sincronizzata con la history del browser:
   ogni showView() con una vista nuova fa pushState, e il tasto "indietro"
   (fisico su Android, del browser/PC, o le frecce ← dell'app) risale la
   pila una vista alla volta fino alla Home, tramite popstate. */
let viewStack = ['cover'];

/* Il meta theme-color colora la barra di stato e, su alcuni Android, anche
   l'area del gesto/nav bar sotto la pagina — è statico in index.html
   (#14161A, il tema scuro di tutta l'app) e non segue mai le variabili CSS
   di pagina, quindi l'unica vista chiara (#view-combat, tema pergamena)
   restava con quella zona ancora scura: sembrava un buco nero sotto/sopra
   il contenuto reale invece di un unico sfondo continuo. */
function updateThemeColorForView(name) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', name === 'combat' ? '#FFFFFF' : '#14161A');
  // #view-combat si ritema in chiaro riscrivendo --antracite-1 solo al suo
  // interno (vedi css/style.css): <body>, fuori da quel sotto-albero, resta
  // sempre scuro. Su alcuni dispositivi #app/.view non combaciano con la
  // finestra reale per una manciata di pixel (arrotondamenti, safe-area,
  // barre di sistema che cambiano dimensione): qualunque scarto residuo
  // lascia intravedere lo sfondo di <body> proprio in quel bordo. Anziché
  // inseguire ancora la misura esatta (mai garantita su ogni dispositivo),
  // si allinea direttamente lo sfondo di <body>/<html> al tema della vista
  // attiva: uno scarto minimo resta invisibile perché è dello stesso colore
  // invece di apparire come una banda nera.
  const bg = name === 'combat' ? '#FFFFFF' : '';
  document.body.style.background = bg;
  document.documentElement.style.background = bg;
}
function showViewDom(name) {
  hideToast();
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  updateThemeColorForView(name);
  window.scrollTo(0, 0);
  // rigenerazione dell'equip: il conto alla rovescia avanza solo mentre la
  // scheda del personaggio resta la vista in primo piano (vedi tickEquipRegen)
  if (name === 'sheet') startEquipRegenTimer(); else stopEquipRegenTimer();
  // il canale realtime del tabellone di combattimento è per-encounter (non
  // uno "start una volta sola" come narratore-join-requests): resta aperto
  // solo mentre view-combat è davvero in primo piano, si chiude su ogni
  // altra vista — evita canali orfani accumulati quando si esce.
  if (name === 'combat' && combatViewEncounterId) {
    startCombatRealtimeWatch(combatViewEncounterId, onCombatRealtimeChange);
  } else {
    stopCombatRealtimeWatch();
  }
  // scheda aperta da "📋 Apri scheda" nel tabellone: Background e Livelli
  // restano fuori (mix richiesto — il resto della scheda normale, Fronte/
  // Retro Scheda comprese, resta invece raggiungibile). Il flag si resetta
  // lasciando 'sheet' per qualunque altra vista, non solo tornando al
  // combattimento, così una scheda aperta normalmente in seguito (es. dalla
  // lista) riparte sempre con tutte le tab visibili.
  // Scheda di un PNG in modifica Narratore (narratorEditIsNpc): un PNG non
  // ha mai bisogno di Background/Identità narrativa (nessuno gliel'ha mai
  // chiesta) — resta solo la possibilità di caricare un volto, vedi
  // applyNpcIdentityRestriction. La tab "note" (Background) sparisce del
  // tutto, come già per combatSheetRestricted.
  if (name === 'sheet' && (combatSheetRestricted || narratorEditIsNpc)) {
    $$('#tabs .tab-btn').forEach(b => b.classList.toggle('hidden',
      b.dataset.tab === 'note' || (combatSheetRestricted && b.dataset.tab === 'livelli')));
  } else {
    if (combatSheetRestricted) combatSheetRestricted = false;
    $$('#tabs .tab-btn').forEach(b => b.classList.remove('hidden'));
  }
  applyNpcIdentityRestriction(name === 'sheet' && narratorEditIsNpc);
  if (name !== 'sheet') narratorEditIsNpc = false;
  // Uscita dalla modalità "modifica Narratore" (vedi openCharacterForNarratorEdit):
  // qualunque vista diversa da 'sheet' chiude la sessione di editing.
  if (name !== 'sheet' && narratorEditMode) exitNarratorEditMode();
}

function showView(name) {
  showViewDom(name);
  if (viewStack[viewStack.length - 1] !== name) {
    viewStack.push(name);
    try { history.pushState({ msView: name }, ''); } catch (e) {}
  }
}

/* id degli overlay a schermo intero che il tasto "indietro" deve chiudere
   prima (senza toccare la vista sottostante); ordine = priorita' di
   controllo. Il menu copertina e le finestre di conferma (.confirm-modal)
   sono gestiti a parte perche' possono comparire sopra qualunque vista. */
const NAV_OVERLAY_IDS = ['rules-popup', 'pdf-viewer', 'portrait-lightbox', 'prem-popup'];

function closeTopOverlay() {
  const coverMenu = $('#cover-menu');
  if (coverMenu && !coverMenu.classList.contains('hidden')) {
    coverMenu.classList.add('hidden');
    $('#btn-cover-menu').setAttribute('aria-expanded', 'false');
    return true;
  }
  const openConfirm = $$('.confirm-modal').find(m => !m.classList.contains('hidden'));
  if (openConfirm) {
    openConfirm.classList.add('hidden');
    return true;
  }
  for (const id of NAV_OVERLAY_IDS) {
    const el = document.getElementById(id);
    if (el && !el.classList.contains('hidden')) {
      if (id === 'pdf-viewer' && window.MSPdfViewer) window.MSPdfViewer.close();
      else if (id === 'rules-popup' && typeof closeRulesChapter === 'function') closeRulesChapter();
      else el.classList.add('hidden');
      return true;
    }
  }
  return false;
}

function refreshViewOnReturn(name) {
  if (name === 'list') renderCharList();
  else if (name === 'campaigns') { if (typeof renderMyCampaignsBox === 'function') renderMyCampaignsBox(); }
  else if (name === 'campaignsheet') { if (typeof renderCampaignSheet === 'function') renderCampaignSheet(); }
  else if (name === 'master') renderMasterArea();
  else if (name === 'rules') renderRules();
  else if (name === 'premises') renderPremisesArea();
  else if (name === 'story') renderStory();
  else if (name === 'account') renderAccountArea();
  else if (name === 'combat') renderCombatBoard();
}

function goBackStep() {
  if (closeTopOverlay()) {
    // il pop del browser ha chiuso solo un overlay: la vista non cambia,
    // quindi si ripristina subito la profondita' della history perche' il
    // prossimo "indietro" torni a risalire le view invece di saltarne una.
    try { history.pushState({ msView: viewStack[viewStack.length - 1] }, ''); } catch (e) {}
    return;
  }
  // si esce dal wizard di creazione: i blocchi di markup spostati dentro
  // view-create tornano al loro tab-panel d'origine in view-sheet prima di
  // lasciare la vista, altrimenti la scheda normale li troverebbe vuoti
  if (viewStack[viewStack.length - 1] === 'create') wizardTeardown();
  if (viewStack.length > 1) {
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1];
    showViewDom(prev);
    refreshViewOnReturn(prev);
  } else {
    showViewDom('cover');
  }
  // Anteprima aperta da un confronto di sincronizzazione (vedi
  // openSyncConflictPreview): il popup di conflitto va riaperto solo QUI,
  // dopo che il cambio di vista è già avvenuto — riaprirlo prima (es. nel
  // click su "Indietro") verrebbe subito richiuso da closeTopOverlay() al
  // successivo popstate, che lo scambierebbe per un overlay già aperto da
  // chiudere invece che per la vista di destinazione di QUESTO indietro.
  if (syncConflictPreviewPending) {
    syncConflictPreviewPending = false;
    $('#btn-del-charview').classList.remove('hidden');
    $('#sync-conflict-modal').classList.remove('hidden');
  }
}

window.addEventListener('popstate', goBackStep);
// alcuni browser/webview non sospendono del tutto un setInterval in
// background, si limitano a rallentarlo: si ferma esplicitamente qui,
// altrimenti la rigenerazione dell'equip "avanzerebbe" un po' anche ad
// app in background, contro il comportamento richiesto (il tempo si ferma).
let lastUpdateCheckAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopEquipRegenTimer(); flushCloudAutoPush(); hideToast(); return; }
  if (viewStack[viewStack.length - 1] === 'sheet') startEquipRegenTimer();
  // checkForUpdate() finora partiva solo da init() (avvio "freddo"): su
  // Android, "chiudere dalle app recenti" spesso non termina davvero il
  // processo, si limita a mandarlo in background — l'app torna in primo
  // piano senza che init() sia mai stato richiamato di nuovo, quindi un
  // aggiornamento pubblicato nel frattempo non veniva mai rilevato finché
  // non capitava un riavvio vero (kill di sistema per memoria, riavvio del
  // telefono...), anche restando aperta per giorni. Ripetuto qui ad ogni
  // ritorno in primo piano, con un throttle minimo solo per evitare
  // raffiche ravvicinate: checkForUpdate() è comunque economica (un solo
  // fetch) e non fa nulla se non c'è una versione più recente.
  const now = Date.now();
  if (now - lastUpdateCheckAt > 60000) { lastUpdateCheckAt = now; checkForUpdate(); }
});

/* Stato online/offline: prima di questo punto l'app non reagiva mai a
   navigator.onLine/'online'/'offline' — nulla di rotto (il salvataggio
   locale è sempre stato immediato, vedi saveAll/touchActive), ma l'utente
   non aveva alcun segnale chiaro del perché una sincronizzazione cloud non
   sta avvenendo. Un toast alla transizione (non un indicatore fisso: uno
   nuovo, persistente, rischierebbe di coprire i pulsanti delle intestazioni
   di viste diverse, tutte con la propria disposizione) più un cambio di
   stato del tutto passivo va bene: nessuna funzione locale dipende da
   questo, serve solo a dare un segnale e a far ripartire prima la
   sincronizzazione in sospeso appena torna la rete invece di aspettare la
   prossima modifica dell'utente. */
let wasOnline = navigator.onLine;
window.addEventListener('offline', () => {
  wasOnline = false;
  toast('Sei offline: i personaggi restano modificabili, la sincronizzazione riprenderà da sola');
});
window.addEventListener('online', () => {
  if (!wasOnline) toast('Connessione ripristinata, sincronizzo…');
  wasOnline = true;
  if (typeof flushCloudAutoPush === 'function') flushCloudAutoPush();
  if (typeof syncMyCharactersInBackground === 'function') syncMyCharactersInBackground();
});

function showTab(tab) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
  $('.sheet-body').scrollTop = 0;
  // Il tab-panel "note" era display:none finché non diventa quello attivo:
  // renderNote() aveva già scritto i valori e calcolato l'auto-altezza dei
  // campi mentre erano ancora invisibili, quindi scrollHeight non era
  // misurabile e restava troppo basso (testo tagliato a metà riga). Va
  // ricalcolato ora che il contenitore aperto è davvero visibile.
  if (tab === 'note') {
    document.querySelectorAll('[data-bgsection]:not(.hidden) textarea').forEach(autoResizeTextarea);
  }
}

/* Sincronizza in background col cloud all'apertura di una scheda gia'
   esistente: senza, un livello assegnato dal Narratore (o un'altra novita')
   restava invisibile finche' non si passava a mano dalla tab Identita' e si
   premeva "Sincronizza". Nessun effetto sui personaggi mai salvati nel
   cloud (syncCharacterFromCloud esce subito se manca cloudCharacterId);
   gli AP e le altre novita' si aggiornano da soli, creditLevelAP rinfresca
   gia' da se' la UI interessata. */
function syncActiveCharacterInBackground() {
  const c = getActive();
  if (!c) return;
  // Controllo avanzamenti pendenti (vedi checkTecabPendingAdvancements):
  // punto di controllo "sincronizzazione" + "apertura scheda" (chiamata
  // anche da openCharacter) — indipendente dal cloud, gira anche per un
  // personaggio senza cloudCharacterId (l'incontro può comunque esistere).
  checkTecabPendingAdvancements(c);
  if (!c.cloudCharacterId || typeof syncCharacterFromCloud !== 'function') return;
  syncCharacterFromCloud(c).then(changed => {
    if (changed && typeof renderCloudStoryBox === 'function') renderCloudStoryBox(c);
    if (changed) { updateStoriaLegacyVisibility(c); updateLevelLockUI(c); updateSessionLockUI(c); updateEntryLockUI(c); renderPortrait(c); renderHeader(c); }
    if (changed && c.pendingLoot && c.pendingLoot.length) showNextPendingLoot(c);
  }).catch(() => {});
}

function openCharacter(id) {
  activeId = id;
  saveAll();
  renderSheet();
  showView('sheet');
  showTab('gioco');
  syncActiveCharacterInBackground();
}

/* ============================================================= WIZARD DI
   CREAZIONE PERSONAGGIO (view-create), separato dalla scheda normale.
   I blocchi di markup elencati in WIZARD_PORTAL_MOVES vivono normalmente
   dentro le tab-panel di view-sheet: moveIntoWizard() li sposta (appendChild,
   MAI clonati) dentro i contenitori del wizard mentre è aperto, così le
   stesse funzioni di rendering/i listener già esistenti restano validi senza
   duplicazione; wizardTeardown() li riporta al loro genitore originale
   (posizione esatta inclusa, tramite nextSibling) in uscita. Vedi il piano:
   nessun blocco per-sezione durante il wizard, tutto si conferma insieme al
   passo finale "Sei sicuro?" (vedi #wiz-final-confirm-yes in init()). */

const BG_NARRATIVE_ORDER = ['datiAspetto', 'vita', 'atteggiamento', 'passato', 'relazioni'];
// 6 schede narrative: volto+nome+anagrafica insieme sulla prima, poi le 5
// sezioni di Background (Relazioni compresa, che fa parte di BG_SECTIONS)
// Etichette delle 6 schede narrative (stesse di #bg-nav-select nella scheda
// normale, così il nome mostrato in cima al wizard è coerente col resto
// dell'app), per il titolo leggibile del passaggio corrente (renderWizardProgress).
const WIZ_NARRATIVE_LABELS = ['Volto e anagrafica', 'Dati generali e Aspetto', 'Vita', 'Atteggiamento', 'Passato', 'Relazioni'];

/* Creazione rapida vs approfondita (checkpoint dedicato): l'UNICA
   differenza fra le due modalità è quante delle 6 schede narrative sono
   raggiungibili scorrendo — in "rapida" solo la prima (Volto e
   anagrafica: identità minima). Le 5 sezioni di Background restano
   comunque spostate nel wizard da moveIntoWizard (mai una seconda
   implementazione): semplicemente non ci si scorre sopra finché non si
   passa ad approfondita, o si escono e si compilano dalla scheda normale,
   dove sono già sempre raggiungibili (nessun campo eliminato). Gli step
   meccanici (Classe/Statistiche/Tratti/Tecniche e Abilità/Riepilogo,
   WIZARD_STEPS sotto) sono già identici e già obbligatori in entrambe le
   modalità: nessuna configurazione separata serve per loro. Cambiare
   modalità è solo un cambio di NAVIGAZIONE, non tocca mai c.*: non può
   quindi mai far perdere dati già inseriti, in nessun verso. */
let wizardMode = 'approfondita';
function wizNarrativeCount() { return wizardMode === 'rapida' ? 1 : WIZ_NARRATIVE_LABELS.length; }
function renderWizardModeToggle() {
  $$('#wiz-mode-toggle [data-wizmode]').forEach(btn => btn.classList.toggle('active', btn.dataset.wizmode === wizardMode));
}
/* Cambio modalità: SOLO navigazione (quante schede narrative si possono
   raggiungere scorrendo), non tocca mai c.* — passare da rapida ad
   approfondita e viceversa non fa quindi mai perdere dati già inseriti in
   nessuna scheda, comprese quelle di Background non ancora raggiunte.
   Se si passa a "rapida" mentre si è già su una scheda narrativa oltre la
   prima, la si riporta alla prima (l'unica raggiungibile in quella
   modalità) — mai un indice fuori range. */
function setWizardMode(mode) {
  if (mode === wizardMode) return;
  wizardMode = mode;
  renderWizardModeToggle();
  const step = WIZARD_STEPS[wizardStepIndex];
  if (step.key === 'narrative' && wizardNarrativeIndex > wizNarrativeCount() - 1) {
    wizardNarrativeIndex = wizNarrativeCount() - 1;
  }
  renderWizardStep();
}

const WIZARD_STEPS = [
  { key: 'narrative', label: 'Identità e Background', validate: () => true },
  { key: 'build', label: 'Classe', validate: () => true },
  { key: 'primary', label: 'Statistiche primarie', validate: c => primaryRemaining(c) === 0 },
  { key: 'traits', label: 'Tratti', validate: c => allTraitsAtZero(c) },
  { key: 'tecab', label: 'Tecniche e Abilità', validate: c => wizardTecAbValid(c) },
  { key: 'summary', label: 'Riepilogo', validate: c => wizardAllValid(c) }
];

/* Righe VISIBILI di Tecniche/Abilità per la build attuale (stessa
   selezione che usano renderTecniche/renderAbilita): c.tecniche/c.abilita
   possono contenere righe vuote "residue" di una build precedente (mai
   sfoltite dall'array, solo nascoste dal rendering — vedi buildRows) che
   andrebbero ignorate qui, altrimenti bloccherebbero la validazione dello
   step con righe che l'utente non vede nemmeno. */
/* Righe "visibili" secondo lo stesso criterio di renderTecniche/
   renderAbilita (vedi buildTecabRows) — usata SOLO per verificare se il
   passo "tecab" del wizard è completo (wizardTecAbValid, chiamata a ogni
   updateWizardNavButtons: molto più spesso di un render completo).
   IMPORTANTE: buildTecabRows non modifica c[field] di per sé (restituisce
   un array nuovo, le righe di creazione mancanti vengono generate ma non
   scritte da nessuna parte finché il chiamante non riassegna c[field] —
   cosa che qui NON si fa apposta): un controllo di validità non deve mai
   materializzare righe sul personaggio come effetto collaterale. Prima di
   questo fix riusava la vecchia formula (un.tec - tecDirectLvUsed, un
   campo non più scritto da questo checkpoint) passando c[field] stesso a
   buildRows, che lo mutava in place — un personaggio saliva di livello e
   si ritrovava righe extra "spuntate da sole" nell'array, mai scelte da
   nessuno. */
function wizardVisibleTecAbRows(c, field) {
  return buildTecabRows(c, field, field === 'tecniche' ? makeTecnicaRow : makeAbilitaRow);
}
function wizardTecAbValid(c) {
  return wizardVisibleTecAbRows(c, 'tecniche').every(r => tecAbRowIsComplete(r, 'tecniche'))
      && wizardVisibleTecAbRows(c, 'abilita').every(r => tecAbRowIsComplete(r, 'abilita'));
}
function wizardAllValid(c) {
  return primaryRemaining(c) === 0 && allTraitsAtZero(c) && wizardTecAbValid(c);
}
/* Spiega perché "Avanti"/"Sei sicuro?" è disabilitato: un bottone muto non
   dice cosa manca, l'utente deve indovinare tornando indietro nello step.
   Restituisce null se non c'è nulla da segnalare (step valido). Punti
   statistiche/tratti restano SENZA numero qui: il numero esatto è già
   sempre visibile nel contatore ancorato in cima allo step
   (.pointbuy-header-sticky) — ripeterlo qui sarebbe la stessa duplicazione
   già segnalata, solo spostata in un altro punto della schermata. */
function wizardBlockMessage(c, stepKey) {
  const parts = [];
  if (stepKey === 'primary' || stepKey === 'summary') {
    if (primaryRemaining(c) !== 0) parts.push('assegna tutti i punti statistica');
  }
  if (stepKey === 'traits' || stepKey === 'summary') {
    const off = Object.keys(TRAIT_LISTS).filter(k => traitsRemainingForList(c, k) !== 0).map(k => TRAIT_LIST_LABELS[k]);
    if (off.length) parts.push(`assegna tutti i punti in ${off.join(', ')}`);
  }
  if (stepKey === 'tecab' || stepKey === 'summary') {
    if (!wizardTecAbValid(c)) parts.push('completa nome e livello di tutte le righe di Tecniche e Abilità');
  }
  if (!parts.length) return null;
  return `Per continuare: ${parts.join('; ')}.`;
}

let wizardStepIndex = 0;
let wizardNarrativeIndex = 0;
let wizardPortalHomes = null; // Map<node, {parent, next}>, riempita da moveIntoWizard
// Passo "Tecniche e Abilità" del wizard: null = panoramica (elenco compatto
// degli slot), {field:'tecniche'|'abilita', idx} = editor di una sola riga
// aperto. Mai salvata sul personaggio (pura navigazione, come wizardMode) —
// resettata ogni volta che si lascia il passo tecab (vedi renderWizardStep).
let wizardTecabEditing = null;

function moveIntoWizard() {
  wizardPortalHomes = new Map();
  const move = (node, destId) => {
    if (!node) return;
    wizardPortalHomes.set(node, { parent: node.parentNode, next: node.nextSibling });
    document.getElementById(destId).appendChild(node);
  };
  move(document.getElementById('creation-portrait-block'), 'wiz-card-identity');
  move(document.getElementById('creation-anagrafica-block'), 'wiz-card-identity');
  BG_NARRATIVE_ORDER.forEach(key => {
    const section = document.querySelector(`.bg-section[data-bgsection="${key}"]`);
    // nella scheda normale solo una .bg-section alla volta è senza "hidden"
    // (scelta da #bg-nav-select) — nel carosello del wizard la visibilità
    // è tutta a carico del transform sulla card, quindi va tolto qui,
    // altrimenti il contenuto è nel DOM ma invisibile (pagina vuota)
    if (section) section.classList.remove('hidden');
    move(section, `wiz-card-${key}`);
  });
  move(document.getElementById('creation-build-block'), 'wiz-step-build');
  move(document.getElementById('creation-primary-block'), 'wiz-step-primary');
  move(document.getElementById('creation-traits-block'), 'wiz-step-traits');
  move(document.getElementById('creation-tecab-block'), 'wiz-step-tecab');
}

function wizardTeardown() {
  if (wizardPortalHomes) {
    wizardPortalHomes.forEach((home, node) => { home.parent.insertBefore(node, home.next); });
    wizardPortalHomes = null;
  }
  wizardActive = false;
  // le sezioni Background tornano al comportamento normale della scheda:
  // un solo contenitore visibile alla volta, scelto da #bg-nav-select
  document.querySelectorAll('[data-bgsection]').forEach(section => {
    section.classList.toggle('hidden', section.dataset.bgsection !== 'datiAspetto');
  });
  const nav = $('#bg-nav-select');
  if (nav) nav.value = 'datiAspetto';
}

function openCreationWizard(id) {
  activeId = id;
  saveAll();
  wizardActive = true; // prima di renderSheet(): Background/conferme si mostrano già in modalità wizard
  renderSheet();
  moveIntoWizard();
  wizardStepIndex = 0;
  wizardNarrativeIndex = 0;
  wizardTecabEditing = null;
  wizardMode = 'approfondita'; // sempre il default a ogni apertura, mai ricordato da una sessione precedente
  renderWizardModeToggle();
  renderWizardStep();
  showView('create');
  // le textarea delle sezioni Background sono state auto-ridimensionate da
  // renderSheet() (sopra) mentre erano ancora dentro view-sheet, mai
  // mostrata in questo flusso (display:none): scrollHeight lì restituisce 0,
  // quindi restano bloccate all'altezza minima e il testo/placeholder
  // appare tagliato — stesso identico bug già risolto per showTab('note')
  // nella scheda normale, qui va ricalcolato ora che view-create (e quindi
  // ogni scheda del carosello narrativo, mai display:none anche quando
  // fuori schermo via transform) è davvero visibile.
  $$('#wiz-narrative-track textarea').forEach(autoResizeTextarea);
  syncWizardNarrativeHeight();
}

/* Posizioni totali del wizard "spianate" in un'unica sequenza: le schede
   narrative (6 in approfondita, 1 sola in rapida — vedi wizNarrativeCount)
   contano singolarmente, poi i 5 step meccanici restanti (Build/
   Statistiche/Tratti/Tecniche&Abilità/Riepilogo) — un solo indicatore in
   cima che avanza per ogni scheda davvero vista, non solo ai cambi di step
   "macro". Calcolata a ogni chiamata (mai una costante): dipende dalla
   modalità corrente, che può cambiare mentre il wizard è aperto. */
function wizardTotalPositions() { return (WIZARD_STEPS.length - 1) + wizNarrativeCount(); }

function wizardCurrentPosition() {
  if (WIZARD_STEPS[wizardStepIndex].key === 'narrative') return wizardNarrativeIndex;
  return wizNarrativeCount() + (wizardStepIndex - 1);
}

function renderWizardProgress() {
  const el = $('#wiz-progress');
  if (!el) return;
  const current = wizardCurrentPosition();
  el.innerHTML = Array.from({ length: wizardTotalPositions() }).map((_, i) =>
    `<span class="wiz-dot ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}"></span>`
  ).join('');
  const titleEl = $('#wiz-step-title');
  const countEl = $('#wiz-step-count');
  if (titleEl && countEl) {
    const step = WIZARD_STEPS[wizardStepIndex];
    const label = step.key === 'narrative' ? WIZ_NARRATIVE_LABELS[wizardNarrativeIndex] : step.label;
    titleEl.textContent = label;
    countEl.textContent = `Passo ${current + 1} di ${wizardTotalPositions()}`;
  }
}

function renderWizardNarrative() {
  const track = $('#wiz-narrative-track');
  if (track) track.style.transform = `translateX(-${wizardNarrativeIndex * 100}%)`;
  syncWizardNarrativeHeight();
}
/* Le 6 schede narrative sono tutte presenti nel DOM come figlie fianco a
   fianco di .wiz-narrative-track (serve lo scorrimento orizzontale via
   transform): per il normale calcolo automatico dell'altezza di una riga
   flex, l'altezza del contenitore è quella della scheda PIÙ ALTA fra le
   sei, non quella visibile — una scheda breve come "Volto e anagrafica"
   restava alta quanto "Vita", con un grande spazio vuoto sotto e il piè
   di pagina lontano dal contenuto reale. Fissa qui l'altezza del
   contenitore su quella della sola scheda attiva. */
function syncWizardNarrativeHeight() {
  const track = $('#wiz-narrative-track');
  const cards = $$('.wiz-narrative-card');
  const active = cards[wizardNarrativeIndex];
  if (track && active) track.style.height = active.scrollHeight + 'px';
}

function renderWizardSummary(c) {
  const el = $('#wiz-summary-body');
  if (!el) return;
  const b = BUILDS[c.build];
  const primaryRows = PRIMARY_STATS.map(s => `<div class="row-between"><span>${s.full}</span><span>${c.primary[s.key]}</span></div>`).join('');
  const traitRows = Object.keys(TRAIT_LISTS).map(k => {
    const shown = (c.shownTraits[k] || []).filter(n => (Number(c.traits[k][n]) || 0) > 0);
    if (!shown.length) return '';
    return `<div class="field"><label>${TRAIT_LIST_LABELS[k]}</label><p class="helper-text" style="margin:0;">${shown.map(n => `${escapeHtml(n)} (${c.traits[k][n]})`).join(' · ')}</p></div>`;
  }).join('');
  const tecRows = (c.tecniche || []).map(r => `<li>${escapeHtml(r.nome || 'Senza nome')}</li>`).join('');
  const abRows = (c.abilita || []).map(r => `<li>${escapeHtml(r.nome || 'Senza nome')}</li>`).join('');
  el.innerHTML = `
    <div class="box"><div class="box-bar"></div><div class="box-pad">
      <div class="row-between"><span>Nome</span><span>${escapeHtml(c.nome || 'Senza nome')}</span></div>
      <div class="row-between"><span>Classe</span><span>${b.label}</span></div>
    </div></div>
    <div class="section-title"><span class="dot neutral"></span>Statistiche primarie</div>
    <div class="box"><div class="box-bar"></div><div class="box-pad">${primaryRows}</div></div>
    <div class="section-title"><span class="dot neutral"></span>Tratti</div>
    ${traitRows || '<p class="helper-text">Nessun tratto assegnato.</p>'}
    <div class="section-title"><span class="dot physical"></span>Tecniche</div>
    <ul>${tecRows || '<li>Nessuna</li>'}</ul>
    <div class="section-title"><span class="dot magic"></span>Abilità</div>
    <ul>${abRows || '<li>Nessuna</li>'}</ul>`;
}

/* Riabilita/disabilita Avanti (o Sei sicuro? sull'ultimo step) in base allo
   stato ATTUALE del personaggio: va richiamata non solo ai cambi di step
   (renderWizardStep) ma a ogni modifica fatta DENTRO lo step corrente (es.
   spendere l'ultimo punto statistica) — altrimenti il bottone resta
   congelato allo stato calcolato all'ingresso nello step, anche dopo che
   la condizione per procedere è nel frattempo soddisfatta. */
function updateWizardNavButtons() {
  if (!wizardActive) return;
  const c = getActive();
  if (!c) return;
  const step = WIZARD_STEPS[wizardStepIndex];
  const isLast = wizardStepIndex === WIZARD_STEPS.length - 1;
  const blocked = isLast ? !wizardAllValid(c) : (step.key !== 'narrative' && !step.validate(c));
  if (isLast) $('#wiz-finish').disabled = blocked;
  else $('#wiz-next').disabled = blocked;
  const hint = $('#wiz-next-hint');
  if (hint) {
    const msg = blocked ? wizardBlockMessage(c, step.key) : null;
    hint.textContent = msg || '';
    hint.classList.toggle('hidden', !msg);
  }
}

function renderWizardStep() {
  const c = getActive();
  if (!c) return;
  const step = WIZARD_STEPS[wizardStepIndex];
  // La modifica di una singola Tecnica/Abilità è uno stato solo del passo
  // "tecab": lasciarlo (avanti/indietro verso un altro passo) deve sempre
  // tornare alla panoramica, mai lasciare l'editor aperto "in background".
  if (step.key !== 'tecab') wizardTecabEditing = null;
  $$('#view-create .wiz-step').forEach(s => s.classList.toggle('active', s.dataset.wizstep === step.key));
  // #view-create non ha altezza fissa (.view usa min-height, non height): a
  // scorrere è la pagina intera, non un contenitore interno. Senza questo
  // reset, cambiare passo (o scheda narrativa) mantiene lo scroll dov'era
  // sull'ultimo passo, lasciando intestazione e inizio del nuovo contenuto
  // fuori dallo schermo finché l'utente non risale manualmente.
  window.scrollTo(0, 0);
  renderWizardProgress();
  if (step.key === 'narrative') renderWizardNarrative();
  if (step.key === 'summary') renderWizardSummary(c);
  const isLast = wizardStepIndex === WIZARD_STEPS.length - 1;
  $('#wiz-next').classList.toggle('hidden', isLast);
  $('#wiz-finish').classList.toggle('hidden', !isLast);
  updateWizardNavButtons();
}

function wizNext() {
  const c = getActive(); if (!c) return;
  const step = WIZARD_STEPS[wizardStepIndex];
  if (step.key === 'narrative' && wizardNarrativeIndex < wizNarrativeCount() - 1) {
    wizardNarrativeIndex++;
    renderWizardStep();
    return;
  }
  if (wizardStepIndex === WIZARD_STEPS.length - 1) return; // sull'ultimo passo si usa "Sei sicuro?"
  if (!step.validate(c)) return; // difensivo: il bottone è già disabled
  wizardStepIndex++;
  if (WIZARD_STEPS[wizardStepIndex].key === 'narrative') wizardNarrativeIndex = 0;
  renderWizardStep();
}

function wizPrev() {
  const c = getActive(); if (!c) return;
  const step = WIZARD_STEPS[wizardStepIndex];
  if (step.key === 'narrative' && wizardNarrativeIndex > 0) {
    wizardNarrativeIndex--;
    renderWizardStep();
    return;
  }
  if (wizardStepIndex > 0) {
    wizardStepIndex--;
    if (WIZARD_STEPS[wizardStepIndex].key === 'narrative') wizardNarrativeIndex = wizNarrativeCount() - 1;
    renderWizardStep();
    return;
  }
  history.back(); // prima scheda del wizard: esce (la bozza resta salvata)
}

/* ============================================================= TABELLONE
   DI COMBATTIMENTO (view-combat). Le chiamate cloud vivono in
   cloud-combat.js (fetchCombatBoard/declareCombatAttack/ecc.); qui solo
   stato, rendering ed event wiring, stessa separazione già in uso fra
   cloud-account.js e le funzioni renderAccountArea/ecc. in questo file.

   combatState è SEMPRE la risposta più recente di get_combat_board: la
   redazione fog-of-war è già stata applicata lato server (vedi
   supabase/migrations/20260803121000_combat_board_redaction.sql), quindi
   ogni render qui sotto si limita a mostrare 'data' (personaggio per
   intero) o 'revealed' (proiezione parziale) così come arrivano — nessuna
   logica di "nascondere" un campo lato client. */

let combatState = null;
let combatViewCampaignId = null;
let combatViewEncounterId = null;
// Chi ha aperto il tabellone è il Narratore di questa campagna? Nota subito
// dal chiamante (campaignDetailHtml è raggiungibile solo dal Narratore,
// renderPlayerStoriesBox solo dal Giocatore) — combatState.callerIsMaster
// esiste solo DOPO che get_combat_board ha già un encounter da leggere, e
// senza un fallback qui il Narratore che apre una campagna senza scontri
// attivi si ritrova un tabellone completamente vuoto: nessun bottone
// "Gestisci scena", quindi nessun modo di avviarne uno (vedi renderCombatBoard/
// renderCombatStagingPanel/renderCombatRoster, che usano questo flag finché
// combatState resta null).
let combatViewIsMaster = false;
let combatPendingAttack = null;  // { attackerCharacterId, source } mentre si sceglie il bersaglio (mai su se stessi)
let combatPendingEffect = null;  // { casterCharacterId, payload, includeSelf } mentre si sceglie il bersaglio di un effetto (condivide col bersaglio-attacco lo stesso meccanismo di click sui token)
let combatManualRollPendingAtk = null;  // attacco in attesa dei valori del "Tiro dal tavolo" (vedi openCombatManualRollModal)
// Bersagli già scelti in una selezione multi-bersaglio in corso (vedi
// source.multiTarget/payload.multiTarget) — un click su un token candidato
// aggiunge/rimuove invece di risolvere subito, la conferma esplicita
// (bottone "Conferma bersagli") chiama combatResolvePendingMultiTargets.
// Svuotato ad ogni apertura/chiusura/risoluzione del target-picker.
let combatSelectedMultiTargets = new Set();

/* ---------------------------------------------------------- macchina a stati (audit combattimento multilivello, Fase A)
   Sette stati richiesti dal checkpoint, con dove vivono realmente:
   - actorLevelId    → combatOwnLevelId() (sotto, "livelli multipli") — piano
                        reale del personaggio, mai scritto da qui.
   - viewLevelId     → combatCurrentViewLevelId (sotto) — piano mostrato.
   - pendingAction   → combatPendingAttack / combatPendingEffect sopra.
   - pendingSelection→ combatSelectedMultiTargets sopra (per il bersaglio
                        singolo il tap risolve/conferma nello stesso gesto:
                        non esiste una fase intermedia da annullare).
   - targetLevelId   → deliberatamente NON duplicato in una variabile a
                        parte: si ricava sempre dal vivo (combatState.
                        participants[...].levelId) per il personaggio già
                        in combatSelectedMultiTargets/combatPendingAttack,
                        per non introdurre una seconda fonte di verità che
                        potrebbe disallinearsi da un aggiornamento realtime.
   - confirmedAction → l'azione ESCE da pendingAction (combatPendingAttack/
                        combatPendingEffect torna null) nello stesso istante
                        in cui la richiesta parte verso il server, prima di
                        attendere la risposta — mai dopo.
   - resolutionState → combatActionResolving sotto. */
let combatActionResolving = false;

/* setViewedCombatLevel(levelId): SOLA funzione che deve cambiare
   combatCurrentViewLevelId. Non tocca mai il piano reale del personaggio,
   non sposta la pedina, non consuma movimento/azioni, non annulla
   pendingAction, non invia alcuna richiesta al server — ricalcola solo la
   vista (renderCombatBoard) e azzera pendingSelection (vedi
   clearPendingSelection): la selezione provvisoria è sempre relativa a
   "cosa sto guardando ora", va ricominciata pulita ad ogni cambio di
   vista per non rischiare di confermare più tardi un bersaglio scelto
   mentre si guardava un piano diverso. */
function setViewedCombatLevel(levelId) {
  if (combatCurrentViewLevelId === levelId) return;
  combatApplyViewedCombatLevel(levelId);
  renderCombatBoard();
}
/* Variante senza ri-render, per i punti in cui il cambio di vista avviene
   già dentro un ciclo di render (es. l'auto-follow del proprio
   personaggio in combatResolveCurrentLevel) o è seguito a mano da un
   render mirato — evita ricorsioni/render doppi mantenendo comunque
   un'unica funzione che tocca combatCurrentViewLevelId più
   clearPendingSelection insieme. */
function combatApplyViewedCombatLevel(levelId) {
  if (combatCurrentViewLevelId === levelId) return;
  combatCurrentViewLevelId = levelId;
  clearPendingSelection();
}

/* clearPendingSelection(): azzera SOLO la selezione provvisoria
   (combatSelectedMultiTargets) — pendingAction (combatPendingAttack/
   combatPendingEffect) resta attiva: l'azione scelta non cambia, si
   sceglie di nuovo solo il bersaglio. */
function clearPendingSelection() {
  if (combatSelectedMultiTargets.size) combatSelectedMultiTargets = new Set();
}

/* cancelPendingCombatAction(): annullamento COMPLETO dell'azione pendente
   — unica funzione da richiamare per ciascuno dei trigger previsti
   (bottone Annulla, Escape, scelta di un'altra azione, passaggio/perdita
   del turno, K.O./rimozione del personaggio, fine del combattimento,
   rifiuto autorevole del server), invece di azzerare a mano le singole
   variabili in punti diversi (rischio storico: un nuovo pulsante Annulla
   che dimentica una delle variabili da svuotare). */
function cancelPendingCombatAction() {
  combatPendingAttack = null;
  combatPendingEffect = null;
  combatPendingLevelTransition = false;
  combatManualRollPendingAtk = null;
  combatActionResolving = false;
  clearPendingSelection();
}

/* resolveConfirmedCombatAction(taskFn): avvolge il passaggio pendingAction
   → confirmedAction → richiesta al server → resolutionState. Impedisce una
   seconda conferma (doppio tap sul bersaglio, doppio click su "Conferma
   bersagli") finché la richiesta precedente non è tornata dal server —
   il chiamante deve aver già azzerato pendingAction PRIMA di richiamare
   questa funzione (mai dopo l'attesa di rete): un tap che arriva durante
   l'attesa deve trovare nulla su cui agire, non innescare un secondo
   invio. Una risposta tardiva non riapre mai pendingAction: taskFn lavora
   solo su variabili locali già catturate, non la riassegna. */
async function resolveConfirmedCombatAction(taskFn) {
  if (combatActionResolving) return;
  combatActionResolving = true;
  try { await taskFn(); }
  finally { combatActionResolving = false; }
}

/* Stato pendente comune ad attacco/effetto: un solo punto da cui
   renderCombatMap (classe combat-token-targetable) e il click sulla mappa
   leggono chi può essere scelto come bersaglio, invece di duplicare due
   volte la stessa logica. Ritorna null quando non c'è nulla in scelta. */
function combatPendingTargetInfo() {
  if (combatPendingEffect) return { attackerCharacterId: combatPendingEffect.casterCharacterId, includeSelf: !!combatPendingEffect.includeSelf, isAttack: false, multiTarget: !!(combatPendingEffect.payload && combatPendingEffect.payload.multiTarget) };
  if (combatPendingAttack && combatPendingAttack.source) return { attackerCharacterId: combatPendingAttack.attackerCharacterId, includeSelf: false, isAttack: true, multiTarget: !!combatPendingAttack.source.multiTarget };
  return null;
}
function combatIsPendingTargetCandidate(characterId) {
  const info = combatPendingTargetInfo();
  if (!info) return false;
  return info.includeSelf || characterId !== info.attackerCharacterId;
}
function combatIsMultiTargetSelected(characterId) {
  return combatSelectedMultiTargets.has(characterId);
}
let combatPendingLevelTransition = false; // true mentre si sceglie come superare un passaggio (tratto o Tecnica/Abilità) nello stesso picker condiviso
let combatRevealTargetId = null; // characterId mentre il picker di reveal è aperto

// Sottoinsieme di campi rivelabili offerto nel picker del Narratore: le
// tre risorse, le 7 statistiche primarie meccaniche e i tre tratti di
// Capacità Combattive più rilevanti in scontro, più il nome. Altri campi
// (terziarie, singole Tecniche/Abilità, equip) restano rivelabili solo
// programmaticamente — non serviva affollare la UI con l'intero elenco.
const COMBAT_REVEALABLE_FIELDS = [
  { key: 'identity.name', label: 'Nome' },
  { key: 'resource.hp', label: 'HP' },
  { key: 'resource.mp', label: 'MP' },
  { key: 'resource.pr', label: 'P.R.' },
  { key: 'primary.for', label: 'Forza' },
  { key: 'primary.mira', label: 'Mira' },
  { key: 'primary.vel', label: 'Velocità' },
  { key: 'primary.fmen', label: 'Forza Magica' },
  { key: 'primary.dex', label: 'Destrezza' },
  { key: 'primary.dif', label: 'Difesa' },
  { key: 'primary.dmen', label: 'Difesa Magica' },
  { key: 'trait.capacitaCombattive.Resistenza', label: 'Resistenza' },
  { key: 'trait.capacitaCombattive.Elusione', label: 'Elusione' },
  { key: 'trait.capacitaCombattive.Arte Combattiva', label: 'Arte Combattiva' }
];

/* ---------------------------------------------------------- ingresso */

async function openCombatView(campaignId, isMaster) {
  combatViewCampaignId = campaignId;
  combatViewIsMaster = !!isMaster;
  combatViewEncounterId = null;
  combatState = null;
  combatCurrentViewLevelId = null;
  combatLastOwnLevelId = undefined;
  combatNarratorToolbarCollapsed = false;
  resetCombatMapManagerState();
  showView('combat');
  renderCombatBoard();
  await loadCombatEncounterForCampaign(campaignId);
}

async function loadCombatEncounterForCampaign(campaignId) {
  // Nessuna RPC dedicata: una select diretta basta, la RLS di
  // combat_encounters ("lettura membri campagna") già limita il risultato
  // a chi partecipa davvero a questa campagna.
  try {
    const { data, error } = await withTimeout(
      sb.from('combat_encounters').select('*').eq('campaign_id', campaignId).neq('status', 'ended')
        .order('created_at', { ascending: false }).limit(1),
      'Combattimento in corso'
    );
    if (error) throw error;
    const enc = (data || [])[0];
    combatViewEncounterId = enc ? enc.id : null;
    if (combatViewEncounterId) {
      // showViewDom ha già tentato di aprire il canale quando la view è
      // diventata visibile, ma a quel punto l'encounter non era ancora
      // noto: lo si riapre esplicitamente ora che lo si conosce.
      startCombatRealtimeWatch(combatViewEncounterId, onCombatRealtimeChange);
      await refreshCombatBoard();
    } else {
      renderCombatBoard();
    }
  } catch (e) {
    toast(describeErrorWithContext('Errore nel caricamento del combattimento', e));
  }
}

function onCombatRealtimeChange() {
  refreshCombatBoard();
}

async function refreshCombatBoard() {
  if (!combatViewEncounterId) return;
  try {
    combatState = await fetchCombatBoard(combatViewEncounterId);
    renderCombatBoard();
    // Notifica (via realtime o un refresh qualunque) che qualcosa in questo
    // incontro è cambiato: MAI la fonte di verità in sé, solo il segnale
    // "ricontrolla" — checkTecabPendingAdvancements rilegge comunque lo
    // stato reale da combat_encounters prima di applicare un avanzamento.
    (characters || []).forEach(c => {
      if (c && Array.isArray(c.tecabPendingAdvancements)
        && c.tecabPendingAdvancements.some(a => (!a.applied || !a.resolved) && a.encounterId === combatViewEncounterId)) {
        checkTecabPendingAdvancements(c);
      }
    });
  } catch (e) {
    toast(describeErrorWithContext('Errore nel tabellone di combattimento', e));
  }
}

/* ---------------------------------------------------------- lettura stato */

function combatParticipantName(p) {
  if (!p.redacted) return (p.data && p.data.nome) || 'Senza nome';
  return (p.revealed && p.revealed.identity && p.revealed.identity.name) || '???';
}

/* Dati REALI (mai redatti) di un personaggio del tabellone: disponibili
   solo quando p.redacted è false, cioè quando chi guarda è il Narratore o
   il proprietario di quel personaggio — esattamente le uniche persone
   autorizzate dalle RPC a inviare un tiro per quel personaggio (vedi
   character_owned_by_caller nella migrazione degli attacchi). Se questa
   funzione ritorna null per il personaggio che si sta cercando di far
   tirare, è già un segnale che l'azione non è comunque permessa. */
function combatFindParticipantChar(characterId) {
  const p = (combatState.participants || []).find(pp => pp.characterId === characterId);
  return p && !p.redacted ? p.data : null;
}

function combatMyCharacterIds() {
  if (!combatState) return [];
  return (combatState.participants || []).filter(p => p.ownerUserId === currentSessionUserId).map(p => p.characterId);
}

function activeCombatAttack() {
  const attacks = (combatState && combatState.attacks) || [];
  return attacks.find(a => a.status !== 'resolved' && a.status !== 'cancelled') || null;
}

function combatFieldIsRevealed(revealed, fieldKey) {
  if (!revealed) return false;
  const parts = fieldKey.split('.');
  if (parts[0] === 'resource') return !!(revealed.resource && revealed.resource[parts[1]]);
  if (parts[0] === 'primary') return !!(revealed.primary && revealed.primary[parts[1]] !== undefined);
  if (parts[0] === 'tertiary') return !!(revealed.tertiary && revealed.tertiary[parts[1]] !== undefined);
  if (parts[0] === 'trait') return !!(revealed.traits && revealed.traits[parts[1]] && revealed.traits[parts[1]][parts[2]] !== undefined);
  if (fieldKey === 'identity.name') return !!(revealed.identity && revealed.identity.name !== undefined);
  return false;
}

/* ---------------------------------------------------------- rendering */

/* Annullamento automatico dell'azione pendente quando il proprietario non
   è più il personaggio di turno (turno passato o perso), deve un tiro
   K.O. prima di poter agire, o il combattimento non è più attivo — tre
   dei trigger di annullamento completo previsti dal checkpoint (punto
   2). Va eseguita PRIMA di ogni altro render della board (renderCombatMap
   compreso): altrimenti la mappa disegnerebbe per un frame lo stato
   pendente ormai scaduto (bersagli/candidati di un'azione che non esiste
   più). */
function combatCancelPendingActionIfStale() {
  const pendingOwnerId = combatPendingAttack ? combatPendingAttack.attackerCharacterId
    : combatPendingEffect ? combatPendingEffect.casterCharacterId : null;
  if (!pendingOwnerId) return;
  const enc = combatState && combatState.encounter;
  if (!enc || enc.status !== 'active') { cancelPendingCombatAction(); return; }
  const activeId = enc.current_turn_participant_id;
  const activeP = activeId && (combatState.participants || []).find(pp => pp.participantId === activeId);
  if (!activeP || activeP.characterId !== pendingOwnerId || combatKoCheckDue(activeP)) {
    cancelPendingCombatAction();
  }
}

function renderCombatBoard() {
  combatCancelPendingActionIfStale();
  const titleEl = $('#combat-title');
  if (titleEl) titleEl.textContent = (combatState && combatState.encounter && combatState.encounter.label) || 'Combattimento';
  const canManage = !!(combatState && combatState.callerIsMaster && combatViewEncounterId);
  const sceneBtn = $('#btn-combat-scene');
  if (sceneBtn) sceneBtn.classList.toggle('hidden', !(combatViewIsMaster || (combatState && combatState.callerIsMaster)));
  const toolbar = $('#combat-narrator-toolbar');
  if (toolbar) toolbar.classList.toggle('hidden', !canManage);
  renderCombatNarratorToolbarCollapse();
  const roundChip = $('#combat-round-chip');
  const advanceBtn = $('#btn-advance-round');
  const roundNum = combatState && combatState.encounter && combatState.encounter.round_number;
  if (roundChip) { roundChip.classList.toggle('hidden', !roundNum); roundChip.textContent = roundNum ? `Round ${roundNum}` : ''; }
  if (advanceBtn) advanceBtn.classList.toggle('hidden', !canManage || !(combatState.encounter && combatState.encounter.status === 'active'));
  renderCombatStagingPanel();
  renderCombatTurnBanner();
  updateCombatPlacementBanner();
  renderCombatMap();
  renderCombatRoster();
  renderCombatCommandPanel();
  renderCombatAttackPanel();
  if (!$('#combat-scene-modal').classList.contains('hidden')) renderCombatMapManager();
}

/* Banner "di chi è il turno": chiunque guardi la board vede lo stesso
   personaggio attivo (la sequenza è condivisa fra tutti), ma solo il suo
   proprietario (o il Narratore) vede anche il bottone per passare. */
function renderCombatTurnBanner() {
  const el = $('#combat-turn-banner');
  if (!el) return;
  const enc = combatState && combatState.encounter;
  const activeId = enc && enc.status === 'active' && enc.current_turn_participant_id;
  const p = activeId && (combatState.participants || []).find(pp => pp.participantId === activeId);
  if (!p) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const canPass = combatState.callerIsMaster || combatIsMine(p);
  const moveInfo = combatMovementBudget(p);
  const budgetHtml = moveInfo ? `<span class="ctb-budget">${moveInfo.quarti.toFixed(2)}/4 quarti residui</span>` : '';
  el.innerHTML = `
    <span class="ctb-label">⏱ Turno di <span class="ctb-name">${escapeHtml(combatParticipantName(p))}</span></span>
    ${budgetHtml}
    ${canPass ? `<button type="button" class="btn btn-primary btn-sm" id="combat-turn-banner-pass">⏭ Passa turno</button>` : ''}
  `;
}

async function renderCombatStagingPanel() {
  const panel = $('#combat-staging-panel');
  if (!panel) return;
  if (!combatViewIsMaster && !(combatState && combatState.callerIsMaster)) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
  panel.classList.remove('hidden');

  if (!combatViewEncounterId) {
    panel.innerHTML = `<div class="box"><div class="box-bar"></div><div class="box-pad">
      <p class="helper-text" style="margin:0 0 10px;">Nessun combattimento attivo per questa campagna.</p>
      <button type="button" class="btn btn-primary btn-sm" id="btn-start-combat">⚔ Avvia combattimento</button>
    </div></div>`;
    return;
  }

  const stagedIds = new Set((combatState.participants || []).map(p => p.characterId));
  let chars = [];
  try { chars = await listCampaignCharacters(combatViewCampaignId); } catch (e) { /* pannello resta con la lista vuota, non bloccante */ }
  // Riusa questo stesso fetch (già fatto per la lista "Metti in scena") per
  // tenere aggiornato l'insieme dei PNG della campagna, letto da
  // openCombatOwnActionsMenu per mostrare "☠ Segna come morto" solo sui PNG
  // — nessuna chiamata di rete in più, solo un side-effect su un fetch che
  // avviene comunque ad ogni refresh del tabellone.
  if (chars.length) combatNpcCharIds = new Set(chars.filter(c => c.is_npc).map(c => c.id));
  // L'iniziativa (e con lei l'inizio dei turni) resta bloccata finché non è
  // stato posizionato sulla mappa OGNI personaggio già messo in scena:
  // altrimenti il combattimento poteva partire con qualcuno ancora senza
  // pedina, invisibile sulla board — sequenza voluta: scena pronta, TUTTI
  // posizionati, solo allora iniziativa e turni.
  const participants = combatState.participants || [];
  const unpositioned = participants.filter(p => p.hexCol == null || p.hexRow == null).length;
  const canRevealInitiative = participants.length > 0 && unpositioned === 0;
  let initiativeSectionHtml = '';
  if (!combatState.encounter.initiative_revealed) {
    initiativeSectionHtml = `<button type="button" class="btn btn-primary btn-sm" id="btn-roll-initiative" style="margin-top:10px;"${canRevealInitiative ? '' : ' disabled'}>🎲 Rivela iniziativa</button>`;
    if (!participants.length) {
      initiativeSectionHtml += `<p class="helper-text" style="margin:6px 0 0;">Metti in scena almeno un personaggio prima di rivelare l'iniziativa.</p>`;
    } else if (unpositioned > 0) {
      initiativeSectionHtml += `<p class="helper-text" style="margin:6px 0 0;">${unpositioned} personagg${unpositioned === 1 ? 'io' : 'i'} ancora da posizionare sulla mappa prima di poter rivelare l'iniziativa.</p>`;
    }
  }
  panel.innerHTML = `
    <div class="section-title"><span class="dot neutral"></span>Metti in scena</div>
    <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:8px;">
      ${chars.length ? chars.map(c => `<label class="chk-inline"><input type="checkbox" data-stagechar="${c.id}" ${stagedIds.has(c.id) ? 'checked' : ''}> ${escapeHtml(c.name || 'Senza nome')} <span class="chip">Lv ${c.level}</span></label>`).join('')
        : '<p class="helper-text" style="margin:0;">Nessun personaggio in questa campagna.</p>'}
    </div></div>
    ${initiativeSectionHtml}`;
}

/* ---------------------------------------------------------- board esagonale */

let combatSelectedTokenCharId = null; // pedina selezionata in attesa di una cella di destinazione
let combatMapAssetCache = null;       // { path, url } dell'ultima immagine mappa risolta

function combatIsMine(p) {
  return !!p && p.ownerUserId === currentSessionUserId;
}
/* Vero se il partecipante ha un Boost realmente attivo (checkpoint "Boost e
   pedina di combattimento", punto 8 — glow): legge SOLO lo stato
   autorevole sincronizzato dal server, mai un booleano locale. Sparisce da
   solo quando il server smette di restituire l'effetto (scadenza —
   get_combat_board filtra già remaining_quarters>0 — o rimozione), senza
   bisogno di alcuna logica dedicata qui: la stessa lettura che già governa
   i bonus (buffTotal/getTraitValue) governa anche il glow, un solo stato
   per entrambi. */
function combatParticipantHasActiveBoost(characterId) {
  return ((combatState && combatState.activeEffects) || []).some(e =>
    e.source_kind === 'boost' && e.target_character_id === characterId && e.remaining_quarters > 0);
}

/* Sequenza a turni: solo il personaggio "di turno" (in ordine di iniziativa)
   può muoversi/agire, tranne il Narratore che resta sempre esente (stessa
   libertà già in vigore su ogni altra regola del tabellone). */
function combatIsCurrentTurn(p) {
  return !!p && !!combatState && !!combatState.encounter && combatState.encounter.current_turn_participant_id === p.participantId;
}

/* Velocità effettiva (statistica primaria + buff attivi) e budget di
   movimento residuo nel turno (in caselle, derivato dal più stretto fra il
   budget condiviso con le azioni e il tetto di spostamento indipendente
   COMBAT_MOVEMENT_MAX_QUARTI_PER_TURN — vedi combatMovementCostPerHex/
   combatMovementHexesForBudget in data.js). Per un PNG del Narratore
   redatto, la Velocità è visibile solo se rivelata (a mano, o da sola al
   primo danno subito da un giocatore — vedi apply_combat_attack_damage):
   in quel caso niente equipaggiamento/buff calcolabili sui dati redatti,
   solo il valore grezzo rivelato. Ritorna null se non c'è alcuna Velocità
   disponibile: niente bagliore da disegnare in quel caso, il budget resta
   comunque applicato lato server a prescindere da cosa vede il client. */
function combatMovementBudget(p) {
  if (!p) return null;
  const vel = p.redacted
    ? (p.revealed && p.revealed.primary && p.revealed.primary.vel != null ? Number(p.revealed.primary.vel) : null)
    : (p.data ? (Number(p.data.primary && p.data.primary.vel) || 0) + buffTotal(p.data, 'vel') : null);
  if (vel == null) return null;
  const sharedQuarti = p.turnBudgetQuarti != null ? Number(p.turnBudgetQuarti) : 4;
  const movementCapRemaining = Math.max(0, COMBAT_MOVEMENT_MAX_QUARTI_PER_TURN - (Number(p.movedQuartiThisTurn) || 0));
  const quarti = Math.min(sharedQuarti, movementCapRemaining);
  return { vel, quarti, hexes: combatMovementHexesForBudget(vel, quarti) };
}

/* Coordinate del "flat-top" esagono (col,row) nel sistema a offset
   standard: righe pari a sinistra, dispari spostate di mezza cella —
   spaziatura orizzontale 0.75×larghezza (i lati piatti si toccano),
   verticale piena tranne l'offset di mezza cella sulle colonne dispari. */
function hexCellPosition(col, row, cellW, cellH) {
  const left = col * cellW * 0.75;
  const top = row * cellH + (col % 2 ? cellH * 0.5 : 0);
  return { left, top };
}
/* Centro grafico ESATTO (float, nessun arrotondamento) di una casella:
   UNICA fonte di verità per il centro, condivisa dal poligono SVG della
   cella e dal posizionamento della pedina (checkpoint "Boost e pedina di
   combattimento", punto 9.2/9.3) — prima ciascuno dei due calcolava il
   proprio centro per conto proprio (il poligono SVG con precisione al
   decimale, la pedina con una catena di 3-4 Math.round() indipendenti su
   tokenW/tokenH/tokenLeft/tokenTop), potendo divergere di una frazione di
   pixel. Un'unica funzione, un solo arrotondamento (fatto una volta sola da
   chi la chiama, mai qui dentro), elimina la possibilità stessa di quella
   divergenza invece di limitarsi a ridurla. */
function hexCellCenter(col, row, cellW, cellH) {
  const pos = hexCellPosition(col, row, cellW, cellH);
  return { cx: pos.left + cellW / 2, cy: pos.top + cellH / 2 };
}

/* Distanza fra due caselle esagonali (per il bagliore radiale attorno alla
   pedina selezionata): le coordinate a offset (col,row) usate sopra sono
   uno schema "odd-q" (colonne dispari spinte giù di mezza cella, righe
   pari a sinistra) — vanno convertite in coordinate cubiche per calcolare
   una vera distanza esagonale, non quella euclidea in pixel. */
function hexOddQToCube(col, row) {
  const x = col;
  const z = row - (col - (col & 1)) / 2;
  const y = -x - z;
  return { x, y, z };
}
function hexCubeDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

/* Geometria dell'ultimo render (cols/rows/cellW/cellH), per tradurre un
   punto di rilascio del drag in una cella — vedi combatNearestHexCell. */
let combatMapGeometry = null;

/* Cella più vicina a un punto (in pixel, relativo all'origine della
   mappa): usata dal trascinamento diretto delle pedine invece di un hit
   test sul DOM, perché col nuovo disegno "solo contorno" ci sono vuoti
   reali fra le celle (vedi HEX_GAP_SCALE) dove un elementFromPoint esatto
   fallirebbe — un rilascio anche leggermente fuori da un esagono deve
   comunque agganciarsi alla cella più vicina, non tornare al mittente. */
function combatNearestHexCell(x, y) {
  const g = combatMapGeometry;
  if (!g) return null;
  let best = null, bestDist = Infinity;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const { cx, cy } = hexCellCenter(c, r, g.cellW, g.cellH);
      const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
      if (d < bestDist) { bestDist = d; best = { col: c, row: r }; }
    }
  }
  return best;
}

/* ---------------------------------------------------------- livelli multipli */

/* Quale livello sta guardando l'utente in questo momento (id di una riga
   combatState.levels) — scelto a mano con le frecce ▲/▼, oppure impostato
   automaticamente da combatResolveCurrentLevel quando il PROPRIO
   personaggio cambia livello (vedi combatLastOwnLevelId sotto): la mappa
   segue solo il proprio personaggio, mai quello di qualcun altro solo
   perché è il suo turno — se il gruppo si divide su più piani, la mia
   vista non deve saltare a un livello dove non ho nessuno. */
let combatCurrentViewLevelId = null;

/* Ultimo levelId osservato per il proprio personaggio: confrontato a ogni
   render, un cambiamento (vero spostamento del MIO personaggio, non un
   giro qualunque di turno) è l'unico evento che forza la vista a seguirlo,
   scavalcando anche una scelta manuale fatta poco prima con le frecce. */
let combatLastOwnLevelId;

/* Livelli visibili al chiamante: il Narratore li vede tutti, un giocatore
   solo quelli "noti" (dove un personaggio di un giocatore si è già
   trovato, vedi known_to_players lato SQL) — ordinati per order_index
   (order_index crescente = dal più basso al più alto). */
function combatVisibleLevels() {
  const levels = (combatState && combatState.levels) || [];
  if (!levels.length) return [];
  const isMaster = combatState.callerIsMaster;
  return levels
    .filter(l => isMaster || l.known_to_players)
    .slice()
    .sort((a, b) => a.order_index - b.order_index);
}

/* Livello del proprio personaggio in questo incontro — solo per i
   giocatori: il Narratore possiede tipicamente più PNG sparsi su più
   livelli insieme, un "seguimi" automatico legato alla proprietà sarebbe
   caotico per lui (naviga sempre a mano con le frecce). */
function combatOwnLevelId() {
  if (!combatState || combatState.callerIsMaster) return null;
  const mine = (combatState.participants || []).find(pp => combatIsMine(pp) && pp.levelId);
  return mine ? mine.levelId : null;
}

/* Livello effettivamente mostrato: segue il proprio personaggio quando (e
   solo quando) il SUO livello è appena cambiato, altrimenti resta
   sull'ultima scelta (manuale o auto) ancora valida, altrimenti il primo
   livello visibile — null se l'incontro non ha mai livelli espliciti
   (mappa singola sull'encounter stesso, comportamento identico a prima di
   questa funzione). */
function combatResolveCurrentLevel() {
  const visible = combatVisibleLevels();
  if (!visible.length) return null;

  const ownLevelId = combatOwnLevelId();
  if (ownLevelId !== combatLastOwnLevelId) {
    combatLastOwnLevelId = ownLevelId;
    if (ownLevelId) combatApplyViewedCombatLevel(ownLevelId);
  }

  if (combatCurrentViewLevelId) {
    const pinned = visible.find(l => l.id === combatCurrentViewLevelId);
    if (pinned) return pinned;
  }
  return visible[0];
}

function combatShiftViewLevel(direction) {
  const visible = combatVisibleLevels();
  if (visible.length < 2) return;
  const current = combatResolveCurrentLevel();
  const idx = visible.findIndex(l => l.id === (current && current.id));
  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= visible.length) return;
  setViewedCombatLevel(visible[nextIdx].id);
}

/* Due frecce nell'angolo in alto della mappa (spazio vuoto sopra la
   griglia): assenti/nascoste con 0 o 1 solo livello visibile, disabilitate
   ai due estremi dell'elenco (nessun giro circolare). */
function renderCombatLevelArrows() {
  const el = $('#combat-level-arrows');
  if (!el) return;
  const visible = combatVisibleLevels();
  if (visible.length < 2 || combatLevelPlacementMode) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const current = combatResolveCurrentLevel();
  const idx = visible.findIndex(l => l.id === (current && current.id));
  el.classList.remove('hidden');
  el.innerHTML = `
    <button type="button" class="btn btn-icon btn-ghost" id="combat-level-up" title="Livello sopra" ${idx >= visible.length - 1 ? 'disabled' : ''}>▲</button>
    <span class="combat-level-arrows-label">${escapeHtml((current && current.label) || '')}</span>
    <button type="button" class="btn btn-icon btn-ghost" id="combat-level-down" title="Livello sotto" ${idx <= 0 ? 'disabled' : ''}>▼</button>
  `;
}

async function renderCombatMap() {
  const wrap = $('#combat-map-wrap');
  const map = $('#combat-map');
  if (!map || !wrap) return;
  if (!combatState || !combatViewEncounterId) { map.innerHTML = ''; map.style.width = ''; map.style.height = ''; return; }

  renderCombatLevelArrows();
  const enc = combatState.encounter;
  const level = combatResolveCurrentLevel();
  const activeLevelId = level ? level.id : null;
  const mapAssetPath = level ? level.mapAssetPath : enc.mapAssetPath;
  const cols = Math.max(2, (level ? level.map_grid_cols : enc.map_grid_cols) || 8);
  const rows = Math.max(2, (level ? level.map_grid_rows : enc.map_grid_rows) || 6);

  const availW = wrap.clientWidth || 360;
  const cellW = availW / (cols * 0.75 + 0.25);
  // Rapporto per un esagono REGOLARE con il clip-path flat-top usato in CSS
  // (vertici a 25%/75% di larghezza): altezza = larghezza × √3/2 ≈ 0.8660,
  // non l'inverso 2/√3 ≈ 1.1547 (quello darebbe celle allungate in verticale,
  // "deformate" invece che esagoni regolari).
  const cellH = cellW * 0.8660254;
  combatMapGeometry = { cols, rows, cellW, cellH, levelId: activeLevelId };
  map.style.width = Math.round(cellW * (cols * 0.75 + 0.25)) + 'px';
  map.style.height = Math.round(cellH * (rows + 0.5)) + 'px';

  map.classList.toggle('combat-map-fallback', !mapAssetPath);
  if (mapAssetPath) {
    if (!combatMapAssetCache || combatMapAssetCache.path !== mapAssetPath) {
      try {
        const url = await getCampaignAssetUrl(mapAssetPath);
        combatMapAssetCache = { path: mapAssetPath, url };
      } catch (e) { combatMapAssetCache = null; }
      if (combatViewEncounterId !== enc.id) return; // il combattimento è cambiato mentre l'URL si risolveva
    }
    map.style.backgroundImage = combatMapAssetCache ? `url(${combatMapAssetCache.url})` : '';
    // Inquadratura scelta dal Narratore (vedi combat-map-manager): con
    // background-size:cover (mai stirata, solo scalata+ritagliata) questa
    // percentuale decide quale parte dell'immagine resta visibile invece
    // del centro fisso — default 50/50 se mai impostata.
    const focusSrc = level || enc;
    const focusX = focusSrc.map_focus_x != null ? focusSrc.map_focus_x : 50;
    const focusY = focusSrc.map_focus_y != null ? focusSrc.map_focus_y : 50;
    map.style.backgroundPosition = `${focusX}% ${focusY}%`;
  } else {
    map.style.backgroundImage = '';
    map.style.backgroundPosition = '';
  }

  // Solo i personaggi sullo stesso livello mostrato ora (in modalità
  // legacy senza livelli espliciti, levelId è null per tutti: nessun
  // cambiamento rispetto a prima di questa funzione).
  const levelParticipants = (combatState.participants || []).filter(p => (p.levelId || null) === activeLevelId);
  const occupied = {};
  levelParticipants.forEach(p => {
    if (p.hexCol != null && p.hexRow != null) occupied[p.hexCol + ':' + p.hexRow] = true;
  });
  const obstacleSet = new Set(
    (combatState.obstacles || [])
      .filter(o => activeLevelId && o.level_id === activeLevelId)
      .map(o => o.hex_col + ':' + o.hex_row)
  );
  // Caselle con un passaggio/scala piazzati dal Narratore (vedi
  // setCombatLevelStaircase/setCombatLevelTransition): solo il lato
  // "sorgente" sul livello attualmente mostrato, mai il target implicito
  // sull'altro livello (quello ha una sua riga separata in combatState.transitions).
  const transitionSet = new Set(
    (combatState.transitions || [])
      .filter(t => activeLevelId && t.level_id === activeLevelId)
      .map(t => t.hex_col + ':' + t.hex_row)
  );

  let html = mapAssetPath ? '' : '<img class="combat-map-fallback-logo" src="img/logo.png" alt="">';
  // Griglia esagonale disegnata come <polygon> SVG, non più <div> con
  // clip-path: un clip-path taglia il BOX già disegnato, quindi il bordo
  // (pensato per i 4 lati rettangolari) resta visibile solo dove combacia
  // con un lato originale del rettangolo (i due lati piatti orizzontali) —
  // sugli altri 4 lati obliqui dell'esagono non c'era alcun bordo da
  // tagliare, da cui le sole "trattine" viste finora invece di un vero
  // esagono. Un <polygon> SVG con stroke disegna il contorno su tutti e
  // sei i lati, come nella board di riferimento.
  // Distacco tra le celle (più elegante, come nel riferimento a nido
  // d'ape "distanziato"): ogni esagono si rimpicciolisce verso il proprio
  // centro invece di toccare i vicini, la griglia logica (posizioni,
  // click target) resta identica.
  const HEX_GAP_SCALE = 0.95;
  // Bagliore radiale ("areale di prossimità"): si accende in automatico
  // attorno al personaggio di TURNO (chiunque lo stia guardando, non solo
  // il suo proprietario — la board è condivisa), col raggio pari alle
  // caselle ancora percorribili col budget residuo (vedi combatMovementBudget)
  // invece di un raggio fisso. Le caselle vicine sono più opache, quelle
  // oltre la portata sfumano verso il quasi invisibile; a riposo (nessuno
  // di turno, o dati del personaggio non disponibili) restano tutte alla
  // stessa leggera trasparenza bianca definita in CSS.
  const glowChar = combatState.encounter && combatState.encounter.current_turn_participant_id
    && levelParticipants.find(pp => pp.participantId === combatState.encounter.current_turn_participant_id
      && pp.hexCol != null && pp.hexRow != null);
  const glowMoveInfo = glowChar ? combatMovementBudget(glowChar) : null;
  // Nessun bagliore se la Velocità non è calcolabile (PNG del Narratore non
  // ancora rivelato ad altri, vedi combatMovementBudget): prima ricadeva su
  // un raggio fisso "finto" di 2 celle, che faceva comunque trapelare
  // un'informazione (per quanto sbagliata) su un personaggio nascosto.
  const glowCenter = (glowChar && glowMoveInfo) ? hexOddQToCube(glowChar.hexCol, glowChar.hexRow) : null;
  const GLOW_RADIUS = Math.max(1, (glowMoveInfo && glowMoveInfo.hexes) || 1);

  // Le celle sono SOLO il contorno (fill:none in CSS): il "vuoto" che
  // rivela l'immagine sotto è lo spazio dentro ogni esagono rimpicciolito,
  // mentre gap fra le celle + bordo esterno alla griglia restano una
  // campitura bianca piena — ottenuta con una <rect> bianca a piena
  // dimensione "bucata" via <mask> da un poligono nero per ogni esagono
  // (stesse coordinate rimpicciolite del contorno, un solo passaggio).
  const svgW = Math.round(cellW * (cols * 0.75 + 0.25)), svgH = Math.round(cellH * (rows + 0.5));
  // Bleed dei fori della maschera: leggermente più grandi del contorno
  // bianco visibile (mai il contrario), così l'anti-aliasing del bordo
  // della maschera resta sempre dentro la zona "vuota" (che rivela
  // l'immagine) invece di lasciare una fessura semi-trasparente proprio
  // sul bordo bianco — è lì che un pixel scoperto si vede di più, perché
  // ci sono già i due colori a massimo contrasto affiancati. La forma
  // visibile (contorno + eventuale bagliore) resta quella "vera", solo il
  // foro della maschera è quella leggermente sovradimensionata.
  const MASK_BLEED_SCALE = HEX_GAP_SCALE + 0.03;
  let maskHoles = '', hexOutlines = '', obstacleOverlays = '', transitionOverlays = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pos = hexCellPosition(c, r, cellW, cellH);
      const occClass = occupied[c + ':' + r] ? ' combat-hex-occupied' : '';
      const x0 = pos.left, y0 = pos.top;
      const { cx, cy } = hexCellCenter(c, r, cellW, cellH);
      const rawPts = [
        [x0 + cellW * 0.25, y0], [x0 + cellW * 0.75, y0],
        [x0 + cellW, y0 + cellH * 0.5],
        [x0 + cellW * 0.75, y0 + cellH], [x0 + cellW * 0.25, y0 + cellH],
        [x0, y0 + cellH * 0.5]
      ];
      const toStr = scale => rawPts.map(([px, py]) => [cx + (px - cx) * scale, cy + (py - cy) * scale])
        .map(p => p.map(n => Math.round(n * 10) / 10).join(',')).join(' ');
      const pts = toStr(HEX_GAP_SCALE);
      maskHoles += `<polygon points="${toStr(MASK_BLEED_SCALE)}" fill="black"></polygon>`;
      // Ostacolo invalicabile piazzato dal Narratore (Gestisci scena >
      // Modifica ostacoli): overlay scuro sotto il contorno interattivo,
      // mai un segreto (visibile a tutti allo stesso modo).
      if (obstacleSet.has(c + ':' + r)) {
        obstacleOverlays += `<polygon class="combat-hex-obstacle" points="${pts}"></polygon>`;
      }
      // Icona a forma di scala sulla casella: senza, il Narratore/i
      // giocatori non hanno modo di sapere a colpo d'occhio quale cella
      // sia adibita a passaggio (era piazzata ma invisibile in mappa).
      if (transitionSet.has(c + ':' + r)) {
        transitionOverlays += `<text class="combat-hex-transition-icon" x="${cx}" y="${cy}" font-size="${(cellH * 0.5).toFixed(1)}">🪜</text>`;
      }
      let glowStyle = '';
      if (glowCenter) {
        const d = hexCubeDistance(hexOddQToCube(c, r), glowCenter);
        const t = Math.max(0, 1 - d / GLOW_RADIUS);
        // Oltre al contorno più opaco (comportamento già esistente), un
        // vero riempimento bianco traslucido sulle celle raggiungibili
        // (stessa t, così sono sempre coerenti): pieno vicino al
        // personaggio di turno, sfuma verso trasparente al bordo del
        // raggio di movimento — è questo che rende l'areale visibile a
        // colpo d'occhio, non solo un contorno più acceso. Alpha massima
        // +25% (richiesto: bianco più opacizzante, specie sulle celle più
        // vicine) rispetto a 0.75/0.6: scalando entrambe con t l'aumento
        // resta comunque più marcato proprio dove t è più alto, cioè
        // vicino al personaggio di turno. Clampata a 1 perché lo scarto
        // può superare il range CSS valido.
        glowStyle = ` style="opacity:${Math.min(1, 0.10 + t * 0.94).toFixed(2)};fill:rgba(255,255,255,${Math.min(1, t * 0.75).toFixed(2)})"`;
      }
      hexOutlines += `<polygon class="combat-hex-cell combat-hex-selectable${occClass}" data-hexcol="${c}" data-hexrow="${r}" points="${pts}"${glowStyle}></polygon>`;
    }
  }
  // width/height="100%" + viewBox invece di attributi in pixel arrotondati
  // indipendentemente da .combat-map: qualunque scarto di arrotondamento
  // fra i due (anche solo mezzo pixel) lasciava una fessura scoperta sul
  // lato destro/inferiore della griglia, dove si vedeva lo sfondo scuro
  // della pagina invece del bianco pieno.
  // Checkpoint "Boost e pedina di combattimento", punto 9.2: width/height
  // erano "100%" per restare identici al box del contenitore (vedi sopra),
  // ma per un elemento position:absolute quel 100% viene risolto contro il
  // containing block — confermato con misure dirette che con il bordo di
  // 3px di .combat-map (border:3px, box-sizing:content-box) il risultato
  // finiva 6px più stretto del previsto (994px invece di 1000px), una
  // differenza di scala fra il sistema di coordinate della griglia SVG
  // (viewBox, dove sono calcolate le celle) e quello in pixel assoluti
  // usato per posizionare le pedine (non passa da questa risoluzione
  // percentuale) — la causa reale, verificata, del leggero spostamento
  // laterale della pedina rispetto alla propria casella. svgW/svgH qui
  // sotto sono calcolati con la STESSA formula di map.style.width/height
  // (stesse cellW/cols/cellH/rows, nessun ricalcolo separato): usarli anche
  // come width/height in pixel dell'SVG resta byte-per-byte identico al box
  // reale del contenitore (nessuna fessura reintrodotta) ma senza passare
  // da una risoluzione percentuale che può discostarsi dal box atteso.
  let hexSvg = `<svg class="combat-hex-grid" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none">
    <defs><mask id="combatHexVoidMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${svgW}" height="${svgH}">
      <rect x="-2" y="-2" width="${svgW + 4}" height="${svgH + 4}" fill="white"></rect>
      ${maskHoles}
    </mask></defs>
    <rect x="-2" y="-2" width="${svgW + 4}" height="${svgH + 4}" class="combat-hex-void-frame" mask="url(#combatHexVoidMask)"></rect>
    ${obstacleOverlays}
    ${transitionOverlays}
    ${hexOutlines}
  </svg>`;
  html += hexSvg;
  levelParticipants.forEach(p => {
    if (p.hexCol == null || p.hexRow == null) return;
    // Checkpoint "Boost e pedina di combattimento", punto 9.2/9.3: il
    // centro della pedina è lo STESSO centro float usato per il poligono
    // SVG della cella (hexCellCenter, un'unica fonte di verità) — nessuna
    // catena di Math.round() indipendenti su tokenW/tokenH/tokenLeft/
    // tokenTop come prima (poteva far divergere il centro "vero" della
    // cella da quello effettivo della pedina di una frazione di pixel,
    // percepibile come un lieve spostamento laterale). Il CSS posiziona
    // left/top su questo stesso centro e usa transform:translate(-50%,-50%)
    // per centrare la pedina — un solo arrotondamento (al decimale, come il
    // poligono SVG) invece di quattro in cascata.
    const { cx, cy } = hexCellCenter(p.hexCol, p.hexRow, cellW, cellH);
    const name = combatParticipantName(p);
    const portrait = p.portrait; // mai redatto: la posizione/l'aspetto restano sempre visibili
    // La pedina riempie l'esagono per intero: stessa scala HEX_GAP_SCALE
    // già usata per il contorno della cella (§renderCombatMap sopra), non
    // più un cerchio staccato più piccolo centrato sopra la cella.
    const tokenW = Math.round(cellW * HEX_GAP_SCALE);
    const tokenH = Math.round(cellH * HEX_GAP_SCALE);
    const tokenCenterLeft = Math.round(cx * 10) / 10;
    const tokenCenterTop = Math.round(cy * 10) / 10;
    const mineClass = combatIsMine(p) ? ' combat-token-mine' : (p.isMasterOwned ? ' combat-token-master-owned' : '');
    const selectedClass = combatSelectedTokenCharId === p.characterId ? ' combat-token-selected' : '';
    // Un candidato già scelto in una selezione multi-bersaglio smette di
    // pulsare (altrimenti l'animazione, che anima anch'essa `filter`,
    // coprirebbe visivamente lo stato "scelto") e passa a un bordo pieno
    // distinto — resta comunque cliccabile per togglere la scelta (vedi
    // combatIsPendingTargetCandidate, indipendente dalla selezione corrente).
    const multiPicked = combatIsMultiTargetSelected(p.characterId);
    const targetableClass = (combatIsPendingTargetCandidate(p.characterId) && !multiPicked) ? ' combat-token-targetable' : '';
    const multiPickedClass = multiPicked ? ' combat-token-multipicked' : '';
    const avatarStyle = portrait ? `background-image:url(${portrait});${portraitPosCss(p.portraitPos)}` : '';
    // Checkpoint "Boost e pedina di combattimento", punto 8: il bagliore
    // dipende ESCLUSIVAMENTE dallo stato autorevole (combatState.activeEffects,
    // sincronizzato dal server per tutti i dispositivi) — mai un booleano
    // grafico locale scollegato. Nessuna lettura di boostLocalActivation qui:
    // quello stato esiste solo FUORI da un combattimento cloud attivo, e la
    // mappa esiste solo DENTRO uno — l'unica fonte possibile è già quella
    // giusta.
    const boostGlowClass = combatParticipantHasActiveBoost(p.characterId) ? ' combat-token-boost-glow' : '';
    // Barra del budget di turno: quarti residui su 4 (condiviso fra
    // spostamento e azioni, vedi combatMovementBudget) — niente barra se il
    // personaggio non è ancora stato collocato o i dati non sono disponibili
    // (PNG non rivelato), il budget resta comunque applicato lato server
    // anche senza poterlo mostrare qui.
    const moveInfo = combatMovementBudget(p);
    const moveBarHtml = moveInfo
      ? `<div class="combat-token-move-bar" title="Turno: ${moveInfo.quarti.toFixed(2)}/4 quarti residui — ancora ${moveInfo.hexes} caselle percorribili (Velocità ${moveInfo.vel})">
          <div class="combat-token-move-fill" style="width:${Math.min(100, Math.round(100 * moveInfo.quarti / 4))}%;"></div>
        </div>`
      : '';
    // Anello colorato (proprietario) come riempimento dell'esagono ESTERNO,
    // con la faccia (ritratto/iniziale) su un esagono interno più piccolo
    // (combat-token-face, vedi CSS): non più un CSS `border` sul box
    // rettangolare tagliato da clip-path, che si vedeva solo sui due lati
    // piatti orizzontali (le "trattine" già diagnosticate per i contorni
    // delle celle in renderCombatMap, mai risolte qui) invece di un vero
    // esagono completo — con due poligoni concentrici della stessa forma
    // l'anello resta uniforme su tutti e sei i lati.
    html += `<div class="combat-token${mineClass}${selectedClass}${targetableClass}${multiPickedClass}${boostGlowClass}" data-tokenchar="${p.characterId}"
      style="left:${tokenCenterLeft}px;top:${tokenCenterTop}px;width:${tokenW}px;height:${tokenH}px;">
      <div class="combat-token-face" style="font-size:${Math.round(Math.min(tokenW, tokenH) * 0.35)}px;${avatarStyle}">${!portrait ? escapeHtml((name || '?').trim().charAt(0).toUpperCase() || '?') : ''}</div>
      <div class="combat-token-glow" aria-hidden="true"></div>
      <span class="combat-token-label">${escapeHtml(name)}</span>
      ${moveBarHtml}
    </div>`;
  });
  map.innerHTML = html;
}

/* ---------------------------------------------------------- barra "Personaggi in gioco" */

function combatRosterHpPercent(p) {
  if (!p.redacted) {
    const d = p.data || {};
    if (!d.hpMaxTracked) return null;
    return Math.max(0, Math.min(100, Math.round(100 * (d.hpCur || 0) / d.hpMaxTracked)));
  }
  const hp = p.revealed && p.revealed.resource && p.revealed.resource.hp;
  if (!hp || !hp.max) return null;
  return Math.max(0, Math.min(100, Math.round(100 * (hp.cur || 0) / hp.max)));
}

/* Effetti attivi (buff/regen/danno nel tempo, tabella combat_active_effects
   — mai redatti, vedi get_combat_board): il countdown vero vive solo lato
   server, qui si legge soltanto remaining_quarters per mostrarlo. */
function combatEffectsForChar(characterId) {
  // Finora chiamata solo da funzioni di tiro (combatRollAttackAndDamage e
  // affini), sempre dentro una vista di combattimento con combatState già
  // popolato — getTraitValue la richiama anche fuori da un incontro attivo
  // (es. tab Tratti), dove combatState resta null: guard esplicito, non un
  // caso ipotetico.
  return ((combatState && combatState.activeEffects) || []).filter(e => e.target_character_id === characterId);
}
/* Somma dei modificatori percentuali attivi su una statistica (droghe a
   due fasi, buff o malus): 25 per +25%, -35 per -35%, sommati fra più
   effetti attivi insieme. Ritorna un moltiplicatore (1.25, 0.65...), mai
   sotto zero. Percentuale del valore IN SCHEDA, non di un massimo derivato
   — applicato da chi legge quella statistica prima di sommare dado/base. */
function statModMultiplier(characterId, statKey) {
  const pct = combatEffectsForChar(characterId)
    .filter(e => Array.isArray(e.stat_mods))
    .flatMap(e => e.stat_mods)
    .filter(m => m && m.stat === statKey)
    .reduce((sum, m) => sum + (Number(m.pct) || 0), 0);
  return Math.max(0, 1 + pct / 100);
}
/* Bonus FLAT (non percentuale) al tiro d'ingresso di uno stato del
   catalogo, da una droga a tempo (es. Scintille neuronali → +35 al tiro
   di Accecare, il "bonus luminoso" richiesto) — stesso array stat_mods
   della droga, chiave "statusroll_<stato>" per distinguerlo dai
   modificatori percentuali su statistiche/tratti. */
function statusRollBonus(characterId, statusKey) {
  return combatEffectsForChar(characterId)
    .filter(e => Array.isArray(e.stat_mods))
    .flatMap(e => e.stat_mods)
    .filter(m => m && m.stat === `statusroll_${statusKey}`)
    .reduce((sum, m) => sum + (Number(m.pct) || 0), 0);
}
/* Bonus FLAT (non percentuale) su un TRATTO, da una droga a tempo (es.
   Tranquillante: +3 Resistenza/Spirito, poi -5 Resistenza) — motore
   gemello di statModMultiplier ma additivo puro invece che moltiplicativo,
   e su combat_active_effects.trait_mods invece di stat_mods (i tratti non
   sono nel pool delle statistiche primarie, vedi getTraitValue). */
function combatTraitModTotal(characterId, listKey, name) {
  return combatEffectsForChar(characterId)
    .filter(e => Array.isArray(e.trait_mods))
    .flatMap(e => e.trait_mods)
    .filter(m => m && m.listKey === listKey && m.name === name)
    .reduce((sum, m) => sum + (Number(m.valore) || 0), 0);
}
/* Soglia K.O. nel motore di combattimento: 10% di hpMaxTracked (stesso
   KO_THRESHOLD_PCT già usato dal widget locale sulla scheda standalone,
   js/data.js), ma qui è dovuto un tiro di Resistenza OGNI turno finché il
   personaggio resta sotto soglia — vedi submit_ko_check. `p` è la riga
   partecipante di combatState.participants (non redatta: solo il
   proprietario/Narratore la vedono comunque, coerente con dove viene
   chiamata questa funzione). */
function combatKoCheckDue(p) {
  if (!p || p.redacted || p.koCheckDoneThisTurn) return false;
  const data = p.data;
  const hpMax = data && Number(data.hpMaxTracked);
  if (!hpMax) return false;
  const hpCur = Number(data.hpCur) || 0;
  if (hpCur > Math.ceil(hpMax * KO_THRESHOLD_PCT)) return false;
  const immune = combatEffectsForChar(p.characterId)
    .some(e => e.phase === 'buff' && e.immune_status_key === 'ko' && Number(e.remaining_quarters) > 0);
  return !immune;
}
/* Riepilogo dei tick applicati da un avanzamento round/passaggio turno
   (result.ticks, popolato server-side da combat_tick_effects_for_participant
   — vedi advance_combat_round/combat_pass_turn): ora scattano al VERO
   inizio del turno del bersaglio, non più una volta per round per tutti, e
   possono capitare anche solo passando il turno senza cambiare round. */
function combatTicksToast(baseMsg, result) {
  const ticks = (result && result.ticks) || [];
  if (!ticks.length) return baseMsg;
  const lines = ticks.map(t => {
    const p = (combatState.participants || []).find(pp => pp.characterId === t.targetCharacterId);
    const name = p ? combatParticipantName(p) : '?';
    // Cessazione di un Boost per PP insufficienti al mantenimento
    // (decisione definitiva dell'utente, mai una deduzione parziale):
    // messaggio comprensibile dedicato, non il generico "+0 PP" che
    // risulterebbe dal ramo sotto per un delta nullo.
    if (t.effectKind === 'boost_terminated_insufficient_pp') {
      return `${name}: ${t.sourceLabel || 'Boost'} terminato — PP insufficienti per il mantenimento`;
    }
    const sign = t.delta > 0 ? '+' : '';
    return `${name} ${sign}${t.delta} ${String(t.tickStat || '').toUpperCase()} (${t.sourceLabel || t.effectKind})`;
  });
  return `${baseMsg} — ${lines.join(' · ')}`;
}
function combatEffectIcon(kind) { return kind === 'danno' ? '🩸' : (kind === 'regen' ? '💚' : (kind === 'scudo' ? '🛡️' : (kind === 'sovracura' ? '🔷' : '✨'))); }
function combatEffectTurnsLabel(quarters) {
  const turns = quarters / 4;
  const n = Number.isInteger(turns) ? String(turns) : turns.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return n + (turns === 1 ? ' turno' : ' turni');
}
function combatEffectBadgesHtml(p) {
  const effects = combatEffectsForChar(p.characterId);
  if (!effects.length) return '';
  const canRemove = combatState.callerIsMaster || combatIsMine(p);
  return `<div class="cr-effects">${effects.map(e => {
    // Uno stato del catalogo (Bruciare/Avvelenare/...) usa la propria icona
    // ed etichetta invece del generico 🩸 "danno nel tempo" — stessa
    // funzione, badge visivamente distinguibile da un DoT qualunque.
    const status = percentContestStatusInfo(e.status_key);
    // Droghe a due fasi (stat_mods): nessuno status_key, il nome è solo in
    // source_label — mostrato in etichetta (non solo al passaggio del
    // mouse) insieme alla fase attuale, altrimenti resterebbe solo
    // un'icona generica senza nome.
    const isStatMod = Array.isArray(e.stat_mods) && e.stat_mods.length;
    const icon = status ? status.icon : (isStatMod ? (e.phase === 'malus' ? '💥' : '💊') : combatEffectIcon(e.effect_kind));
    // Scudo (Sovracura e affini): mostra i PS residui invece della sola
    // durata, così si vede a colpo d'occhio quanto danno assorbe ancora.
    const label = status ? `${escapeHtml(status.label)} — ${escapeHtml(combatEffectTurnsLabel(e.remaining_quarters))}`
      : isStatMod ? `${escapeHtml(e.source_label || 'Droga')} (${e.phase === 'malus' ? 'crollo' : 'potenziamento'}) — ${escapeHtml(combatEffectTurnsLabel(e.remaining_quarters))}`
      : e.effect_kind === 'scudo' ? `${escapeHtml(e.source_label || 'Scudo')} (${Math.max(0, Math.round(Number(e.shield_hp) || 0))} PS) — ${escapeHtml(combatEffectTurnsLabel(e.remaining_quarters))}`
      : escapeHtml(combatEffectTurnsLabel(e.remaining_quarters));
    // Tentativo di liberazione da Tramortire (dal 2° turno in poi) o da
    // Immobilizzare (un solo tentativo, al 1° turno) — turns_elapsed
    // accreditato da combat_tick_effects_for_participant, solo per chi
    // possiede il bersaglio o il Narratore — stesso pubblico di "Sospendi".
    const canEscape = canRemove && (
      (e.status_key === 'tramortire' && Number(e.turns_elapsed) >= 2) ||
      (e.status_key === 'immobilizzare' && Number(e.turns_elapsed) >= 1)
    );
    return `
    <span class="cr-effect-badge cr-effect-${e.effect_kind}" title="${escapeHtml(e.source_label || '')} — ${escapeHtml(combatEffectTurnsLabel(e.remaining_quarters))} residui">
      ${icon} ${label}
      ${canEscape ? `<button type="button" class="cr-effect-escape" data-statusescape="${e.id}" title="Tenta di liberarti (tiro percentuale)">🎲</button>` : ''}
      ${canRemove ? `<button type="button" class="cr-effect-remove" data-effectremove="${e.id}" title="Sospendi">✕</button>` : ''}
    </span>`;
  }).join('')}</div>`;
}
function combatRosterCardHtml(p) {
  const name = combatParticipantName(p);
  const portrait = p.portrait;
  const avatarStyle = portrait ? ` style="background-image:url(${portrait});${portraitPosCss(p.portraitPos)}"` : '';
  const mineClass = combatIsMine(p) ? ' combat-roster-card-mine' : '';
  const turnClass = combatIsCurrentTurn(p) ? ' combat-roster-card-turn' : '';
  const hpPct = combatRosterHpPercent(p);
  const initiativeRevealed = !!(combatState && combatState.encounter && combatState.encounter.initiative_revealed);
  return `<div class="combat-roster-card${mineClass}${turnClass}" data-rostercard="${p.characterId}">
    ${initiativeRevealed ? `<span class="cr-initiative" title="Ordine di iniziativa">${p.initiativeOrder}º · ${p.initiativeRoll}</span>` : ''}
    <div class="avatar${portrait ? ' has-portrait' : ''}"${avatarStyle}>${!portrait ? escapeHtml((name || '?').trim().charAt(0).toUpperCase() || '?') : ''}</div>
    <div class="cr-name">${escapeHtml(name)}</div>
    <span class="chip" style="font-size:9px;padding:1px 6px;">Lv ${p.level}</span>
    ${hpPct != null ? `<div class="cr-hp"><div class="cr-hp-fill" style="width:${hpPct}%;"></div></div>` : ''}
    ${p.koLastRollDetail ? `<span class="cr-effect-badge" title="Ultimo tiro K.O.: ${escapeHtml(p.koLastRollDetail)}">${p.koLastRollSuccess ? '🎲 vigile' : '💀 K.O.'}</span>` : ''}
    ${combatEffectBadgesHtml(p)}
  </div>`;
}

function renderCombatRoster() {
  const bar = $('#combat-roster-bar');
  if (!bar) return;
  if (!combatViewEncounterId) {
    // il pannello "Gestisci scena" copre già questo caso per il Narratore;
    // per un giocatore (che non lo vede) serve comunque un messaggio
    bar.innerHTML = !combatViewIsMaster
      ? '<div class="empty-state" style="padding:20px;">Nessun combattimento in corso per questa storia al momento.</div>' : '';
    return;
  }
  const list = (combatState && combatState.participants) || [];
  // Ordine di iniziativa (quando rivelato) impostato qui, nella barra dei
  // personaggi in gioco: prima era una fascia separata sopra la mappa,
  // ora la barra in basso è l'unico posto in cui compare l'ordine dei turni.
  const initiativeRevealed = !!(combatState && combatState.encounter && combatState.encounter.initiative_revealed);
  const ordered = initiativeRevealed
    ? [...list].sort((a, b) => (a.initiativeOrder || 99) - (b.initiativeOrder || 99))
    : list;
  bar.innerHTML = ordered.length ? ordered.map(combatRosterCardHtml).join('')
    : '<div class="empty-state" style="padding:20px;">Nessun personaggio ancora in scena.</div>';
}

/* ---------------------------------------------------------- pannello comandi (sempre presente) */

/* Attacca/Tecniche/Abilità/Boost/Oggetti: non più un popup a comparsa
   legato al tocco su una faccia, ma una finestra sempre presente sotto la
   barra ritratti — mostra automaticamente il personaggio DI TURNO (nessuna
   selezione manuale), visibile/usabile solo dal Narratore o dal
   proprietario di quel personaggio (per chiunque altro, un messaggio
   neutro). Le altre azioni (Apri scheda, Passa turno, Posiziona/Sposta,
   Rivela, Rimuovi) restano nel popup a comparsa toccando una faccia, vedi
   openCombatOwnActionsMenu. */
function renderCombatCommandPanel() {
  const panel = $('#combat-command-panel');
  if (!panel) return;
  if (!combatViewEncounterId) { panel.innerHTML = ''; return; }
  const enc = combatState && combatState.encounter;
  const activeId = enc && enc.status === 'active' && enc.current_turn_participant_id;
  const p = activeId && (combatState.participants || []).find(pp => pp.participantId === activeId);
  if (!p) {
    panel.innerHTML = '<p class="helper-text" style="margin:0;">Nessun personaggio di turno al momento.</p>';
    return;
  }
  const isMaster = combatState.callerIsMaster;
  const mine = combatIsMine(p);
  const name = combatParticipantName(p);
  if (!isMaster && !mine) {
    panel.innerHTML = `<p class="helper-text" style="margin:0;">Turno di <strong>${escapeHtml(name)}</strong>…</p>`;
    return;
  }
  combatOwnActionsCharId = p.characterId;
  // Soglia K.O.: tiro di Resistenza sempre dovuto prima di poter agire,
  // sostituisce l'intero pannello finché non è risolto (stesso principio
  // della salvezza "sempre dovuta" su un attacco, ma qui a inizio turno).
  if (combatKoCheckDue(p)) {
    panel.innerHTML = `
      <p class="cmdpanel-title">${escapeHtml(name)}</p>
      <p class="helper-text" style="margin:0 0 8px;color:var(--fisico-forte,#FF5C5C);">Sotto la soglia K.O.: tiro di Resistenza sempre dovuto prima di poter agire (serve ≥10).</p>
      <button type="button" class="cmdpanel-btn" id="combat-cmd-ko-check">🎲 Tiro K.O.</button>`;
    return;
  }
  const data = combatFindParticipantChar(p.characterId);
  const hasAbilita = !!(data && (data.abilita || []).some(r => r.nome && String(r.nome).trim()));
  const buttons = [];
  buttons.push(`<button type="button" class="cmdpanel-btn" id="combat-cmd-attack">⚔ Attacca</button>`);
  buttons.push(`<button type="button" class="cmdpanel-btn" id="combat-cmd-tecniche">✨ Tecniche</button>`);
  if (hasAbilita) buttons.push(`<button type="button" class="cmdpanel-btn" id="combat-cmd-abilita">🎯 Abilità</button>`);
  buttons.push(`<button type="button" class="cmdpanel-btn" id="combat-cmd-boost">💪 Boost</button>`);
  buttons.push(`<button type="button" class="cmdpanel-btn" id="combat-cmd-items">🎒 Oggetti</button>`);
  // Passaggio di livello: solo se la casella del personaggio di turno
  // combacia con una transizione piazzata dal Narratore (Gestisci scena >
  // Aggiungi passaggio) sul suo livello attuale.
  const transition = (combatState.transitions || []).find(t =>
    p.levelId && t.level_id === p.levelId && t.hex_col === p.hexCol && t.hex_row === p.hexRow);
  if (transition) {
    buttons.push(`<button type="button" class="cmdpanel-btn" id="combat-cmd-transition">🪜 ${escapeHtml(transition.label || 'Passaggio')}</button>`);
  }
  panel.innerHTML = `<p class="cmdpanel-title">${escapeHtml(name)}</p>${buttons.join('')}`;
}

/* ---------------------------------------------------------- menu azioni (dalla barra roster) */

let combatOwnActionsCharId = null;
// PNG di questa campagna (character.id), rinfrescato ad ogni render di
// renderCombatStagingPanel: decide se mostrare "☠ Segna come morto" nel
// menu azioni — mai sui personaggi dei giocatori o del Narratore in prima
// persona, solo sui PNG generati/gestiti dal Randomizer.
let combatNpcCharIds = new Set();

function openCombatOwnActionsMenu(characterId) {
  const p = (combatState.participants || []).find(pp => pp.characterId === characterId);
  if (!p) return;
  combatOwnActionsCharId = characterId;
  const isMaster = combatState.callerIsMaster;
  const mine = combatIsMine(p);
  $('#combat-own-actions-title').textContent = combatParticipantName(p);

  // Governare solo i propri personaggi: chi non possiede questo personaggio
  // (e non è Narratore) non ha alcuna azione disponibile qui — solo
  // spettatore, niente "Attacca con questo personaggio" su chi non è suo.
  if (!mine && !isMaster) {
    $('#combat-own-actions-body').innerHTML = '<p class="helper-text" style="margin:0;">Non è un tuo personaggio.</p>';
    $('#combat-own-actions-menu').classList.remove('hidden');
    return;
  }

  const buttons = [];
  const isActive = combatState.encounter && combatState.encounter.status === 'active';
  // Attacca/Tecniche/Abilità/Boost/Oggetti non vivono più in questo popup a
  // comparsa: sono nel pannello comandi sempre presente sotto la barra
  // ritratti (vedi renderCombatCommandPanel), che mostra sempre il
  // personaggio di turno automaticamente. Qui restano solo le azioni di
  // gestione (scheda, turno, posizione, rivela, rimuovi).
  if (mine) {
    buttons.push('<button class="btn btn-ghost" id="combat-own-open-sheet">📋 Apri scheda</button>');
  }
  // Passa turno: solo quando è davvero il turno di questo personaggio (o è
  // il Narratore che lo passa per conto suo) e il combattimento è attivo —
  // il turno può sempre essere passato volontariamente, anche con budget
  // residuo, oppure quando non resta più nulla da permettersi (vedi
  // combatMovementBudget/turnBudgetQuarti, nessun avanzamento automatico).
  if (isActive && (isMaster || mine) && combatIsCurrentTurn(p)) {
    buttons.push(`<button class="btn btn-primary" id="combat-own-pass-turn">⏭ Passa turno</button>`);
  }
  // Unica via per assegnare/cambiare la posizione sulla griglia: il tap
  // diretto su una pedina funziona solo su chi è GIÀ posizionato (hexCol/
  // hexRow non nulli), quindi un personaggio appena messo in scena non ha
  // alcuna pedina da toccare sulla mappa — senza questo bottone non c'era
  // alcun modo di dargli una prima posizione.
  if (isMaster || mine) {
    const label = (p.hexCol == null || p.hexRow == null) ? '📍 Posiziona sulla mappa' : '📍 Sposta sulla mappa';
    buttons.push(`<button class="btn btn-ghost" id="combat-own-place-token">${label}</button>`);
  }
  if (isMaster && p.isMasterOwned) {
    buttons.push(`<button class="btn btn-ghost" data-combatreveal="${characterId}">🔍 Rivela statistiche</button>`);
  }
  if (isMaster) {
    buttons.push(`<button class="btn btn-ghost" data-combatunstage="${characterId}">✕ Rimuovi dalla scena</button>`);
  }
  // Solo sui PNG (mai su un PG o sul personaggio del Narratore stesso):
  // uccide il PNG a tutti gli effetti, vedi killNpcInCombat.
  if (isMaster && combatNpcCharIds.has(characterId)) {
    buttons.push(`<button class="btn btn-ghost" data-combatkillnpc="${characterId}" style="color:var(--fisico-forte);">☠ Segna come morto</button>`);
  }
  $('#combat-own-actions-body').innerHTML = buttons.join('');
  $('#combat-own-actions-menu').classList.remove('hidden');
}

/* Equip indossato di un PNG (weaponSlots + slots già equipaggiati/rollati,
   vedi statsConfirmed) nella stessa forma richiesta dalla Borsa del
   Narratore (narratore_add_bag_item/narratore_assign_bag_item, cloud-account.js
   — identica a quella di narratore_send_loot): l'armatura riceve anche
   targetSlotIndex (posizione fra le 6 locazioni, vedi ARMOR_LOCATIONS) dato
   che sulla scheda del PNG quel campo non serve (una locazione fissa),
   mentre la Borsa deve sapere dove va rimessa una volta assegnata. */
function extractNpcEquippedLoot(npcData) {
  const items = [];
  ((npcData && npcData.weaponSlots) || []).forEach(s => {
    if (!s || !s.equipaggiato || !s.statsConfirmed) return;
    const item = {
      name: s.name, kind: s.kind, size: s.size, quality: s.quality,
      atk: s.atk, dif: s.dif, dur: s.dur, durCur: s.durCur, peso: s.peso,
      bonus: s.bonus || '', bonuses: s.bonuses || [], statsConfirmed: true, equipaggiato: true
    };
    if (s.kind === 'arma') Object.assign(item, { weaponClass: s.weaponClass, usaFor: s.usaFor, usaDex: s.usaDex, usaFmen: s.usaFmen });
    items.push({ itemType: s.kind, item });
  });
  ((npcData && npcData.slots) || []).forEach((s, idx) => {
    if (!s || !s.equipaggiato || !s.statsConfirmed) return;
    const typeDef = EQUIP_TYPES.find(t => t.key === 'armatura');
    const sizeDef = typeDef && typeDef.sizes.find(sz => sz.key === s.size);
    const label = sizeDef ? `${typeDef.label} ${sizeDef.label}` : (s.name || 'Armatura');
    items.push({ itemType: 'armatura', item: {
      targetSlotIndex: idx, name: label, kind: 'armatura', size: s.size, quality: s.quality,
      atk: s.atk, dif: s.dif, dur: s.dur, durCur: s.durCur, peso: s.peso,
      bonus: s.bonus || '', bonuses: s.bonuses || [], statsConfirmed: true
    } });
  });
  return items;
}

/* "Segna come morto" (solo Narratore, solo PNG): trasferisce l'equip
   indossato nella Borsa del Narratore, poi rimuove il PNG dal
   combattimento (stessa RPC di "Rimuovi dalla scena") e lo elimina del
   tutto (narratore_delete_npc) — sparisce anche dalla tab PNG della
   storia, coerente col fatto che un PNG morto non torna più in gioco. */
async function killNpcInCombat(characterId) {
  const p = (combatState.participants || []).find(pp => pp.characterId === characterId);
  if (!p) return;
  const name = combatParticipantName(p);
  if (!confirm(`Segnare "${name}" come morto? Verrà rimosso dal campo di battaglia e dalla sezione PNG; l'equip indossato finisce nella Borsa del Narratore.`)) return;
  const loot = extractNpcEquippedLoot(p.data || {});
  try {
    for (const entry of loot) {
      await addNarratorBagItemCloud(combatViewCampaignId, entry.itemType, entry.item, `Bottino di ${name}`);
    }
    await unstageCombatCharacter(combatViewEncounterId, characterId);
    await deleteNpcCloud(characterId);
    toast(loot.length ? `${name} è morto: ${loot.length} oggetto/i nella Borsa del Narratore` : `${name} è morto`);
    await refreshCombatBoard();
  } catch (err) { toast(describeError(err)); }
}

/* Apre la scheda normale (view-sheet) per il personaggio in gioco, con
   Background e Livelli nascosti finché non si torna al tabellone — vedi
   combatSheetRestricted, gestito in showViewDom. */
let combatSheetRestricted = false;
function openCharacterForCombatAction(characterId) {
  const local = characters.find(c => c.cloudCharacterId === characterId);
  if (!local) { toast('Personaggio non trovato su questo dispositivo'); return; }
  combatSheetRestricted = true;
  openCharacter(local.id);
}

/* Editing libero della scheda di un personaggio ALTRUI da parte del
   Narratore (bottone ✏️ nel roster "Personaggi in gioco", Account →
   Narratore → dettaglio campagna): a differenza di
   openCharacterForCombatAction (che apre un personaggio già presente su
   QUESTO dispositivo), qui il personaggio non è mai stato salvato in
   locale — arriva dalla riga cloud (row = lastCampaignCharactersById[id],
   js/cloud-account.js) e viene caricato come oggetto "ospite" temporaneo:
   riusa per intero #view-sheet (tutte le tab, tutti i render/handler già
   esistenti) invece di costruire un secondo editor.

   L'ospite NON deve mai finire nell'array characters "per davvero": viene
   marcato narratorEditGuest, escluso da visibleCharacters()/renderCharList
   e rimosso non appena si lascia 'sheet' (vedi showViewDom). L'ospite EREDITA
   però cloudCampaignId/cloudJoinRequestId/cloudSessionActive da row.data
   (Object.assign qui sotto copia l'intero blob del giocatore, li sovrascrive
   solo id/nome/livello/narratorEditGuest) — isLevelLocked/isSessionLocked/
   traitBonusRowLocked (e tipoConfirmed/boostConfirmed nel rendering) restano
   quindi bloccati esattamente come per il giocatore, a meno del bypass
   esplicito `&& !narratorEditMode` già incorporato in ciascuno: il Narratore
   deve poter correggere anche righe/campi già confermati dal giocatore,
   mai un varco per il giocatore stesso (la scrittura passa comunque da
   narratoreUpdateCharacterDataCloud, verificata server-side). Il salvataggio
   (scheduleCloudAutoPush) va deviato verso quella RPC (narratore_update_
   character_data): pushCharacterToCloud fallirebbe comunque, riservata al
   proprietario. */
let narratorEditMode = false;
let narratorEditCharacterCloudId = null;
let narratorEditState = 'closed'; // closed | viewing | editing | saving
let narratorEditSnapshot = null;
let narratorEditDirty = false;
let narratorTecabEdit = null; // { dataAttr, field, index }

function cloneNarratorDraft(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyNarratorEditUiState() {
  const active = narratorEditMode;
  const editing = active && narratorEditState === 'editing';
  const saving = active && narratorEditState === 'saving';
  const body = $('#view-sheet .sheet-body');
  if (body && active) {
    const controls = [...body.querySelectorAll('input, select, textarea, button')];
    controls.forEach(el => {
      el.dataset.narratorAllowed = el.disabled ? '0' : '1';
      if (!editing) el.disabled = true;
    });
    if (!editing) {
      body.querySelectorAll('[data-tecabedit]').forEach(el => { el.disabled = false; });
    } else if (narratorTecabEdit) {
      controls.forEach(el => { el.disabled = true; });
      const card = body.querySelector(`[data-tecab-card="${narratorTecabEdit.dataAttr}::${narratorTecabEdit.index}"]`);
      if (card) card.querySelectorAll('input, select, textarea, button').forEach(el => {
        if (el.dataset.narratorAllowed !== '0') el.disabled = false;
      });
    }
  }
  const name = $('#f-nome');
  if (name && active) name.disabled = !editing;
  const editBtn = $('#btn-narrator-edit');
  const confirmBtn = $('#btn-narrator-confirm');
  const cancelBtn = $('#btn-narrator-cancel');
  const status = $('#narrator-edit-status');
  if (editBtn) editBtn.classList.toggle('hidden', !active || editing || saving);
  if (confirmBtn) {
    confirmBtn.classList.toggle('hidden', !active || (!editing && !saving));
    confirmBtn.disabled = saving || !narratorEditDirty;
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !active || (!editing && !saving));
    cancelBtn.disabled = saving;
  }
  if (status) status.textContent = saving
    ? 'Salvataggio in corso…'
    : editing
      ? (narratorEditDirty ? 'Modifiche non ancora salvate' : 'Modalità modifica')
      : 'Scheda confermata · sola lettura';
}

function beginNarratorEdit() {
  const c = getActive();
  if (!narratorEditMode || !c || narratorEditState === 'saving') return;
  narratorEditSnapshot = cloneNarratorDraft(c);
  narratorEditDirty = false;
  narratorTecabEdit = null;
  narratorEditState = 'editing';
  renderSheet();
  applyNarratorEditUiState();
}

async function confirmNarratorEdit() {
  const c = getActive();
  if (!narratorEditMode || !c || narratorEditState !== 'editing' || !narratorEditDirty) return;
  narratorEditState = 'saving';
  applyNarratorEditUiState();
  try {
    await narratorPushWithVersionCheck(c, narratorEditCharacterCloudId);
    narratorEditSnapshot = cloneNarratorDraft(c);
    narratorEditDirty = false;
    narratorEditState = 'viewing';
    narratorTecabEdit = null;
    renderSheet();
    applyNarratorEditUiState();
    toast('Scheda salvata nel cloud');
  } catch (err) {
    narratorEditState = 'editing';
    applyNarratorEditUiState();
    toast(err && err.message ? err.message : 'Salvataggio non riuscito');
  }
}

function cancelNarratorEdit() {
  const c = getActive();
  if (!narratorEditMode || !c || narratorEditState === 'saving') return;
  if (narratorEditSnapshot) {
    const restored = cloneNarratorDraft(narratorEditSnapshot);
    Object.keys(c).forEach(key => delete c[key]);
    Object.assign(c, restored);
  }
  narratorEditDirty = false;
  narratorTecabEdit = null;
  narratorEditState = 'viewing';
  renderSheet();
  applyNarratorEditUiState();
  toast('Modifiche annullate');
}

function wireNarratorEditControls() {
  const editBtn = $('#btn-narrator-edit');
  const confirmBtn = $('#btn-narrator-confirm');
  const cancelBtn = $('#btn-narrator-cancel');
  if (editBtn) editBtn.addEventListener('click', beginNarratorEdit);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmNarratorEdit);
  if (cancelBtn) cancelBtn.addEventListener('click', cancelNarratorEdit);
}
// Un PNG (row.is_npc) non ha mai Background/Identità narrativa da
// compilare — solo la scheda tecnica e un volto opzionale, vedi
// applyNpcIdentityRestriction/showViewDom.
let narratorEditIsNpc = false;
/* Nasconde in tab "Identità" tutto tranne "Volto del personaggio" (Anagrafica,
   Storia legacy/cloud, Classe, Bellezza): un PNG non ha mai bisogno di
   quei campi, restano solo utili per un PG vero. La tab "Background" viene
   nascosta a parte, vedi showViewDom. */
function applyNpcIdentityRestriction(restricted) {
  ['creation-anagrafica-block', 'storia-legacy-section', 'identita-cloudstory-block', 'creation-build-block', 'identita-bellezza-block']
    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', restricted); });
}
function openCharacterForNarratorEdit(row) {
  if (!row) { toast('Personaggio non trovato'); return; }
  const c = Object.assign({}, row.data, {
    id: uid(),
    nome: (row.data && row.data.nome) || row.name,
    livello: Number(row.level) || 1,
    narratorEditGuest: true
  });
  ensureShape(c);
  // Versione autorevole appena letta da listCampaignCharacters, non quella
  // eventualmente incorporata in row.data (scritta dall'ultimo dispositivo
  // che ha salvato, può essere rimasta indietro rispetto a scritture
  // successive che non l'hanno più toccata) — è la base del controllo di
  // versione ottimistico in narratoreUpdateCharacterDataCloud/pushCharacterToCloud.
  c.cloudVersion = (row.current_version === null || row.current_version === undefined) ? null : Number(row.current_version);
  characters.push(c);
  activeId = c.id;
  narratorEditMode = true;
  narratorEditIsNpc = !!row.is_npc;
  narratorEditCharacterCloudId = row.id;
  narratorEditSnapshot = cloneNarratorDraft(c);
  narratorEditDirty = false;
  narratorEditState = 'viewing';
  renderSheet();
  showView('sheet');
  showTab('gioco');
  const banner = $('#narrator-edit-banner');
  if (banner) {
    const nameEl = $('#narrator-edit-banner-name');
    if (nameEl) nameEl.textContent = `«${c.nome}» (${row.playerName || 'giocatore'})`;
    banner.classList.remove('hidden');
  }
  applyNarratorEditUiState();
}
/* Chiamata da showViewDom quando si lascia 'sheet' mentre narratorEditMode
   è attivo: scarta l'ospite (mai persistito come personaggio reale) e
   resetta lo stato, così una prossima apertura normale della scheda (dalla
   lista) riparte pulita. */
function exitNarratorEditMode() {
  // Uscire non equivale mai a confermare: una bozza non salvata viene
  // scartata, senza alcuna scrittura cloud implicita.
  if (cloudAutoPushPending && cloudAutoPushPending.isNarratorGuest) {
    clearTimeout(cloudAutoPushTimer);
    cloudAutoPushTimer = null;
    cloudAutoPushPending = null;
  }
  const idx = characters.findIndex(ch => ch.id === activeId && ch.narratorEditGuest);
  if (idx !== -1) characters.splice(idx, 1);
  narratorEditMode = false;
  narratorEditIsNpc = false;
  narratorEditCharacterCloudId = null;
  narratorEditState = 'closed';
  narratorEditSnapshot = null;
  narratorEditDirty = false;
  narratorTecabEdit = null;
  activeId = null;
  saveAll();
  const banner = $('#narrator-edit-banner');
  if (banner) banner.classList.add('hidden');
}

/* ---------------------------------------------------------- libreria mappe (pannello Gestisci scena) */

/* Quale livello sta modificando il Narratore in "Gestisci scena" — null
   finché l'incontro non ha alcun livello esplicito (mappa singola
   sull'encounter, interfaccia identica a prima del multi-livello). */
let combatMapManagerEditingLevelId = null;
let combatTransitionSourceLevelId = null;

/* Modalità temporanea di piazzamento su "Gestisci scena": intercetta i
   tocchi sulla board vera (stesso #combat-map, stesso click-to-cell già
   costruito per muovere le pedine — nessun secondo widget a griglia
   duplicato) invece di aprire un editor a parte.
   { type:'obstacle', levelId }
   { type:'transition', phase:'source'|'target', sourceLevelId, targetLevelId, sourceCol, sourceRow, config }
*/
let combatLevelPlacementMode = null;

/* Tutto lo stato di "Gestisci scena" sopra è scoped al SINGOLO encounter
   aperto quando è stato impostato, ma vive in variabili globali del modulo:
   senza un reset esplicito, terminare un combattimento e avviarne subito
   uno nuovo (restando sulla stessa vista, senza mai uscire da 'combat') li
   lasciava puntati al vecchio encounter — combatMapManagerEditingLevelId in
   particolare restava un level_id del combattimento ormai concluso, quindi
   "Applica griglia"/"Usa" (scelta immagine) continuavano a scrivere lì
   invece che sul nuovo encounter: la mappa nuova sembrava "bloccata" (le
   dimensioni non cambiavano mai) e le immagini scelte non comparivano mai,
   perché la scrittura andava a un livello che il nuovo tabellone non legge
   più. Stesso discorso per un "🪜 Aggiungi passaggio" tentato con una
   sorgente ormai orfana: l'RPC set_combat_level_transition rifiuta un
   livello che non esiste (più) con un errore visibile. */
function resetCombatMapManagerState() {
  combatMapManagerEditingLevelId = null;
  combatTransitionSourceLevelId = null;
  combatLevelPlacementMode = null;
  combatMapAssetCache = null;
}

function updateCombatPlacementBanner() {
  const el = $('#combat-placement-banner');
  if (!el) return;
  if (!combatLevelPlacementMode) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const textEl = $('#combat-placement-banner-text');
  if (combatLevelPlacementMode.type === 'obstacle') {
    textEl.textContent = '🚧 Tocca le caselle da bloccare/sbloccare.';
  } else if (combatLevelPlacementMode.phase === 'source') {
    textEl.textContent = '🪜 Tocca la casella di partenza del passaggio.';
  } else {
    textEl.textContent = '🪜 Tocca la casella di arrivo del passaggio.';
  }
}

function startCombatObstaclePlacement(levelId) {
  combatLevelPlacementMode = { type: 'obstacle', levelId };
  combatApplyViewedCombatLevel(levelId);
  $('#combat-scene-modal').classList.add('hidden');
  renderCombatBoard();
}

function startCombatTransitionPlacement(sourceLevelId, targetLevelId, config) {
  combatLevelPlacementMode = { type: 'transition', phase: 'source', sourceLevelId, targetLevelId, config };
  combatApplyViewedCombatLevel(sourceLevelId);
  renderCombatBoard();
}

/* Un tocco su una cella mentre una modalità di piazzamento è attiva: per
   gli ostacoli, toggle immediato; per un passaggio, prima cattura la
   cella di partenza e passa alla destinazione (spostando la vista sul
   livello target), poi cattura la cella di arrivo e salva. */
async function combatHandlePlacementTap(col, row) {
  const mode = combatLevelPlacementMode;
  if (!mode) return;
  if (mode.type === 'obstacle') {
    try { await toggleCombatLevelObstacle(mode.levelId, col, row); await refreshCombatBoard(); }
    catch (err) { toast(describeError(err)); }
    return;
  }
  if (mode.phase === 'source') {
    combatLevelPlacementMode = { ...mode, phase: 'target', sourceCol: col, sourceRow: row };
    combatApplyViewedCombatLevel(mode.targetLevelId);
    renderCombatBoard();
    return;
  }
  // phase 'target'
  const { sourceLevelId, sourceCol, sourceRow, config } = mode;
  combatLevelPlacementMode = null;
  try {
    await setCombatLevelTransition(
      sourceLevelId, sourceCol, sourceRow, mode.targetLevelId, col, row,
      config.label, config.traitList, config.traitName, config.difficulty, config.actionCost
    );
    toast('Passaggio creato');
    await refreshCombatBoard();
  } catch (err) { toast(describeError(err)); renderCombatBoard(); }
}

/* Scala automatica fra due livelli adiacenti, piazzata quando si crea un
   nuovo livello (vedi "+ Nuovo livello" in Gestisci scena): senza questo,
   un nuovo piano restava isolato finché il Narratore non piazzava a mano un
   passaggio — un errore facile da dimenticare, specie perché servono DUE
   passaggi separati (uno per verso, vedi set_combat_level_transition) per
   poter salire E scendere. Cella (0,0) su entrambi i livelli: sempre
   valida (la griglia minima è 2×2) e sicuramente libera su un livello
   appena creato. "Spostabile": resta un passaggio come un altro, il
   Narratore può eliminarlo (🗑) e ripiazzarlo altrove con "🪜 Aggiungi
   passaggio" se la cella di default non gli va bene. Nessun tratto
   richiesto (passaggio automatico, si supera solo spostandocisi sopra). */
async function autoPlaceLevelStaircase(levelA, levelB) {
  try {
    await setCombatLevelStaircase(levelA.id, levelB.id, '🪜 Scala', 4);
  } catch (e) {
    // non bloccante: il livello resta comunque creato, il Narratore piazza
    // la scala a mano da "Gestisci scena" se questo fallisce per qualunque motivo
    toast('Livello creato, ma la scala automatica non si è piazzata: aggiungila a mano da "🪜 Aggiungi passaggio"');
  }
}

// Barra strumenti Narratore ripiegata (tasto "Nascondi barra"): resta solo
// la freccetta per riaprirla. Azzerata ad ogni apertura della vista
// Combattimento (vedi openCombatView) — riparte sempre espansa.
let combatNarratorToolbarCollapsed = false;
function renderCombatNarratorToolbarCollapse() {
  const bar = $('#combat-narrator-toolbar');
  const btn = $('#combat-toolbar-collapse');
  if (!bar || !btn) return;
  bar.classList.toggle('collapsed', combatNarratorToolbarCollapsed);
  btn.textContent = combatNarratorToolbarCollapsed ? '▼' : '▲';
  btn.title = combatNarratorToolbarCollapsed ? 'Mostra barra' : 'Nascondi barra';
}

/* Livello su cui agiscono le scorciatoie della toolbar Narratore
   (🪜 Passaggio / 🚧 Ostacoli): quello attualmente mostrato sulla board,
   oppure — se l'encounter non ha ancora nessun livello esplicito (mappa
   singola) — lo materializza al volo (ensureCombatLevelDefault), così
   anche un combattimento "semplice" può avere passaggi/ostacoli senza
   dover prima passare da "⚙ Gestisci scena" > "+ Nuovo livello". */
async function narratorToolbarCurrentLevelId() {
  if (!(combatState.levels || []).length) {
    const lvl = await ensureCombatLevelDefault(combatViewEncounterId);
    await refreshCombatBoard();
    return lvl.id;
  }
  const current = combatResolveCurrentLevel();
  return (current && current.id) || (combatState.levels[0] && combatState.levels[0].id) || null;
}

function openCombatTransitionModal(sourceLevelId) {
  combatTransitionSourceLevelId = sourceLevelId;
  const levels = (combatState.levels || []).slice().sort((a, b) => a.order_index - b.order_index);
  $('#combat-transition-target-level').innerHTML = levels.map(l => `<option value="${l.id}">${escapeHtml(l.label)}</option>`).join('');
  const traitSel = $('#combat-transition-trait');
  traitSel.innerHTML = '<option value="">Nessuno (passaggio automatico)</option>' +
    Object.keys(TRAIT_LISTS).map(listKey => `<optgroup label="${escapeHtml(TRAIT_LIST_LABELS[listKey])}">${
      TRAIT_LISTS[listKey].map(name => `<option value="${listKey}::${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
    }</optgroup>`).join('');
  traitSel.value = '';
  $('#combat-transition-label').value = '';
  $('#combat-transition-difficulty').value = 12;
  $('#combat-transition-cost').value = 4;
  $('#combat-transition-difficulty-field').classList.remove('hidden');
  $('#combat-transition-modal').classList.remove('hidden');
}

async function renderCombatMapManager() {
  const el = $('#combat-map-manager');
  if (!el) return;
  if (!combatState || !combatState.callerIsMaster || !combatViewEncounterId) { el.innerHTML = ''; return; }
  const enc = combatState.encounter;
  let assets = [];
  try { assets = await fetchCampaignAssets(combatViewCampaignId); } catch (e) { /* elenco vuoto, non bloccante */ }

  const levels = (combatState.levels || []).slice().sort((a, b) => a.order_index - b.order_index);
  const editingLevel = levels.length ? (levels.find(l => l.id === combatMapManagerEditingLevelId) || levels[0]) : null;
  if (editingLevel) combatMapManagerEditingLevelId = editingLevel.id;

  const target = editingLevel || enc;
  const cols = target.map_grid_cols || 8, rows = target.map_grid_rows || 6;
  const aspect = (cols * 0.75 + 0.25) / (rows + 0.5);

  const levelsHtml = `
    <div class="section-title" style="margin-top:0;"><span class="dot neutral"></span>Livelli</div>
    ${levels.length ? levels.map(l => `
      <div class="combat-asset-row">
        <span class="combat-asset-label">${escapeHtml(l.label)}</span>
        <button type="button" class="btn btn-icon btn-sm btn-ghost" data-renamelevel="${l.id}" title="Rinomina livello">✏️</button>
        <button type="button" class="btn btn-sm ${editingLevel && editingLevel.id === l.id ? 'btn-primary' : 'btn-ghost'}" data-editlevel="${l.id}">Modifica</button>
        <button type="button" class="btn btn-icon btn-sm btn-ghost" data-deletelevel="${l.id}" title="Elimina livello">🗑</button>
      </div>
    `).join('') : `
      <div class="combat-asset-row">
        <span class="combat-asset-label">Livello 1</span>
        <button type="button" class="btn btn-icon btn-sm btn-ghost" id="btn-rename-combat-level-default" title="Rinomina livello">✏️</button>
      </div>
      <p class="helper-text" style="margin:0;">Ancora nessun livello aggiuntivo: la mappa qui sotto resta quella singola di questo combattimento.</p>
    `}
    <button type="button" class="btn btn-ghost btn-sm" id="btn-add-combat-level" style="margin:6px 0 14px;">➕ Nuovo livello${levels.length ? '' : ' (passa a più mappe)'}</button>
  `;

  const levelTransitions = editingLevel ? (combatState.transitions || []).filter(t => t.level_id === editingLevel.id) : [];
  const passaggiOstacoliHtml = editingLevel ? `
    <div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>Passaggi da "${escapeHtml(editingLevel.label)}"</div>
    ${levelTransitions.length ? levelTransitions.map(t => {
      const targetLevel = levels.find(l => l.id === t.target_level_id);
      return `<div class="combat-asset-row">
        <span class="combat-asset-label">${escapeHtml(t.label)} → ${escapeHtml(targetLevel ? targetLevel.label : '?')}</span>
        <button type="button" class="btn btn-icon btn-sm btn-ghost" data-deletetransition="${t.id}" title="Elimina">🗑</button>
      </div>`;
    }).join('') : '<p class="helper-text" style="margin:0;">Nessun passaggio piazzato su questo livello.</p>'}
    <button type="button" class="btn btn-ghost btn-sm" id="btn-add-transition" style="margin-top:6px;">🪜 Aggiungi passaggio</button>
    <button type="button" class="btn btn-ghost btn-sm" id="btn-toggle-obstacles" style="margin-top:6px;">🚧 Modifica ostacoli</button>
  ` : '';

  el.innerHTML = `
    ${levelsHtml}
    <div class="field-row">
      <div class="field"><label for="combat-map-cols">Colonne</label><input type="number" id="combat-map-cols" min="2" max="30" value="${cols}"></div>
      <div class="field"><label for="combat-map-rows">Righe</label><input type="number" id="combat-map-rows" min="2" max="30" value="${rows}"></div>
    </div>
    <div class="combat-asset-row">
      <div class="combat-asset-thumb"></div>
      <span class="combat-asset-label">Preset: carta invecchiata + logo</span>
      <button type="button" class="btn btn-sm ${!target.map_asset_id ? 'btn-primary' : 'btn-ghost'}" data-choosemapasset="">Usa</button>
    </div>
    ${assets.map(a => `<div class="combat-asset-row">
      <div class="combat-asset-thumb" data-assetthumb="${a.id}"></div>
      <span class="combat-asset-label">${escapeHtml(a.label)}</span>
      <button type="button" class="btn btn-sm ${target.map_asset_id === a.id ? 'btn-primary' : 'btn-ghost'}" data-choosemapasset="${a.id}">Usa</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-removemapasset="${a.id}" data-removepath="${escapeHtml(a.storage_path)}" title="Elimina">🗑</button>
    </div>`).join('')}
    <button type="button" class="btn btn-ghost btn-sm" id="btn-upload-map-asset" style="margin-top:8px;">📤 Carica nuova immagine</button>
    <input type="file" id="combat-map-asset-file" accept="image/*" class="hidden">
    <button type="button" class="btn btn-primary btn-sm" id="btn-apply-map-grid" style="margin-top:8px;">Applica righe/colonne</button>
    ${target.map_asset_id ? `
      <div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>Inquadra l'immagine</div>
      <p class="helper-text" style="margin:0 0 8px;">Trascina l'immagine per scegliere quale parte resta visibile nel riquadro — non viene mai stirata, solo scalata e ritagliata (come sulla board vera).</p>
      <div class="combat-map-focus-preview" id="combat-map-focus-preview" style="aspect-ratio:${aspect};"></div>
    ` : ''}
    ${passaggiOstacoliHtml}
  `;
  assets.forEach(a => {
    getCampaignAssetUrl(a.storage_path).then(url => {
      const thumb = el.querySelector(`[data-assetthumb="${a.id}"]`);
      if (thumb) thumb.style.backgroundImage = `url(${url})`;
    }).catch(() => {});
  });
  const targetMapAssetPath = editingLevel ? editingLevel.mapAssetPath : enc.mapAssetPath;
  if (target.map_asset_id && targetMapAssetPath) {
    try {
      const url = await getCampaignAssetUrl(targetMapAssetPath);
      const onCommit = editingLevel
        ? (fx, fy) => setCombatLevelFocus(editingLevel.id, fx, fy)
        : (fx, fy) => setMapFocus(combatViewEncounterId, fx, fy);
      setupMapFocusDrag(url, target.map_focus_x != null ? target.map_focus_x : 50, target.map_focus_y != null ? target.map_focus_y : 50, onCommit);
    } catch (e) { /* anteprima non disponibile, non bloccante */ }
  }
}

/* Anteprima trascinabile per scegliere l'inquadratura (background-position
   in %) di un'immagine mappa più larga/stretta della griglia — con
   background-size:cover (mai stirata) il ritaglio dipende da quale parte
   resta scoperta, questa anteprima lo rende scelto invece che sempre al
   centro. Il tracking è 1:1 col dito: calcola l'overflow REALE dell'
   immagine scalata a cover rispetto al riquadro (da naturalWidth/Height),
   non una percentuale approssimata sulla larghezza del riquadro. */
function setupMapFocusDrag(imgUrl, initialX, initialY, onCommit) {
  const box = $('#combat-map-focus-preview');
  if (!box) return;
  let focusX = initialX, focusY = initialY;
  box.style.backgroundImage = `url(${imgUrl})`;
  box.style.backgroundPosition = `${focusX}% ${focusY}%`;

  const probe = new Image();
  probe.onload = () => {
    if (!document.body.contains(box)) return; // il pannello è stato richiuso nel frattempo
    const rect = box.getBoundingClientRect();
    const scale = Math.max(rect.width / probe.naturalWidth, rect.height / probe.naturalHeight);
    const overflowX = Math.max(0, probe.naturalWidth * scale - rect.width);
    const overflowY = Math.max(0, probe.naturalHeight * scale - rect.height);

    let dragging = false, startX = 0, startY = 0, startFocusX = focusX, startFocusY = focusY;
    function onDown(x, y) { dragging = true; startX = x; startY = y; startFocusX = focusX; startFocusY = focusY; }
    function onMove(x, y, ev) {
      if (!dragging) return;
      if (ev && ev.cancelable) ev.preventDefault();
      const dx = x - startX, dy = y - startY;
      // trascinare l'immagine a destra rivela più del suo lato sinistro:
      // il segno è invertito rispetto allo spostamento del dito.
      focusX = overflowX > 0 ? clamp(startFocusX - (dx / overflowX) * 100, 0, 100) : startFocusX;
      focusY = overflowY > 0 ? clamp(startFocusY - (dy / overflowY) * 100, 0, 100) : startFocusY;
      box.style.backgroundPosition = `${focusX}% ${focusY}%`;
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      onCommit(focusX, focusY).then(refreshCombatBoard).catch(err => toast(describeError(err)));
    }
    box.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    box.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    box.addEventListener('touchend', onUp);
    let mouseDown = false;
    box.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; mouseDown = true; onDown(e.clientX, e.clientY); });
    box.addEventListener('pointermove', e => { if (!mouseDown) return; onMove(e.clientX, e.clientY, e); });
    box.addEventListener('pointerup', e => { if (!mouseDown) return; mouseDown = false; onUp(); });
    box.addEventListener('pointercancel', () => { mouseDown = false; dragging = false; });
  };
  probe.src = imgUrl;
}

function combatCharNameById(id) {
  const p = (combatState.participants || []).find(pp => pp.characterId === id);
  return p ? combatParticipantName(p) : '?';
}

/* Esito dell'effetto (Rompere/Tramortire/nome libero) di una Tecnica/Abilità
   a Danno: le conseguenze automatiche (equip danneggiato) sono già state
   applicate server-side in submit_attack_defense_roll (vedi migrazione
   defense_rework) — qui si limita a mostrarle, mai a ricalcolarle. Solo
   Rompere passa più di qui:
   Tramortire usa ora lo stesso dado contrapposto percentuale degli altri
   stati, vedi combatStatusOutcomeHtml. Un nome effetto diverso da Rompere
   non ha automatismi: mostra solo l'esito del tiro, l'interpretazione resta
   al Narratore. */
function combatEffectOutcomeHtml(atk, saveSuccess) {
  if (!atk.effect_name) return '';
  const key = String(atk.effect_name).trim().toLowerCase();
  if (saveSuccess) {
    return `<p class="helper-text" style="margin:0;">✅ Salvezza riuscita: nessun effetto aggiuntivo da ${escapeHtml(atk.effect_name)}.</p>`;
  }
  if (key === 'rompere') {
    return `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">🔨 Rompere: equipaggiamento (Busto) danneggiato, mezzo turno perso al prossimo turno.</p>`;
  }
  return `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">⚠ ${escapeHtml(atk.effect_name)}: salvezza fallita — nessun automatismo, valuta l'effetto a voce.</p>`;
}
/* Esito del tiro d'ingresso di uno stato a dado percentuale (catalogo dei
   12 + Tramortire): indipendente dalla salvezza normale sopra — mostra
   entrambi i tiri (attaccante/bersaglio) e se lo stato è entrato. La
   conseguenza (danno nel tempo, turno bloccato, badge nel roster) è già
   applicata server-side; qui solo la si racconta. */
function combatStatusOutcomeHtml(atk) {
  const status = percentContestStatusInfo(atk.effect_name);
  if (!status) return '';
  if (atk.defender_status_roll_total == null) {
    return `<p class="helper-text" style="margin:0;">${status.icon} ${escapeHtml(status.label)}: in attesa del tiro di resistenza del bersaglio...</p>`;
  }
  const landed = !!atk.status_applied;
  const rollLine = `${escapeHtml(status.label)} — attacco ${atk.attacker_status_roll_total} vs resistenza ${atk.defender_status_roll_total}`;
  if (!landed) {
    return `<p class="helper-text" style="margin:0;">${status.icon} ${rollLine}: stato non entrato.</p>`;
  }
  const wired = ['bruciare', 'avvelenare', 'tramortire', 'elettrificare', 'stordire', 'immobilizzare', 'rallentare', 'confondere', 'corrodere', 'silenziare', 'congelare'].includes(status.key);
  const durataInfo = status.key === 'tramortire'
    ? ' (3 turni, tentativo di liberazione dal 2° in poi — vedi badge nel roster)'
    : status.key === 'immobilizzare'
    ? ' (2 turni, un solo tentativo di liberazione al 1° turno — vedi badge nel roster)'
    : status.key === 'stordire'
    ? ' (fino al turno successivo: niente schivata/blocco nel frattempo)'
    : status.key === 'rallentare'
    ? ' (3 turni: Velocità e budget del turno dimezzati)'
    : status.key === 'confondere'
    ? ' (2 turni: 50% di possibilità che ogni attacco dichiarato venga ridiretto)'
    : status.key === 'corrodere'
    ? ' (3 turni: Difesa e Resistenza dimezzate)'
    : status.key === 'silenziare'
    ? ' (2 turni: blocca ogni uso di Abilità)'
    : status.key === 'congelare'
    ? ' (5 turni: il prossimo colpo sulla parte del corpo mirata è un critico confermato)'
    : (status.turns ? ` (dura ${status.turns} turni, vedi badge nel roster)` : '');
  return `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">${status.icon} ${rollLine}: stato entrato${wired ? durataInfo : ' — meccanica non ancora attiva, nessun automatismo'}.</p>`;
}
/* Innesco automatico Perforare/Tagliare -> Sanguinare: indipendente da
   qualunque effetto scelto dal Narratore (vedi submit_attack_resistenza_
   save), mostrato solo quando è scattato il controllo (salvezza su
   Resistenza + un tiro di Perforare/Tagliare registrato). Il danno (30%
   HP massimi, al massimo una volta a turno) è tutto lato server —
   combat_maybe_trigger_sanguinare, richiamato da declare_combat_attack/
   submit_attack_defense_roll/move_combat_token — quindi qui non c'è
   nient'altro da mostrare oltre all'esito dell'ingresso. */
function combatSanguinareAutoOutcomeHtml(atk) {
  if (atk.attacker_perforare_taglio_roll_total == null) return '';
  // Confrontato ora col tiro Elusione/Guardia del bersaglio (vedi
  // submit_attack_defense_roll) — la vecchia salvezza di Resistenza non
  // esiste più. Nessun confronto se "Non mi difendo" (nessun tiro fatto).
  if (atk.defense_type === 'none' || atk.defense_roll_total == null) return '';
  if (!atk.sanguinare_applied) {
    return `<p class="helper-text" style="margin:0;">🩸 Perforare/Tagliare ${atk.attacker_perforare_taglio_roll_total} vs ${atk.defense_type === 'dodge' ? 'Elusione/Destrezza' : 'Guardia'} ${atk.defense_roll_total}: Sanguinare non innescato.</p>`;
  }
  return `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">🩸 Perforare/Tagliare ${atk.attacker_perforare_taglio_roll_total} vs ${atk.defense_type === 'dodge' ? 'Elusione/Destrezza' : 'Guardia'} ${atk.defense_roll_total}: Sanguinare innescato — perde il 30% degli HP massimi (al massimo una volta a turno) quando attacca, si sposta o si difende attivamente.</p>`;
}

function renderCombatAttackPanel() {
  const panel = $('#combat-attack-panel');
  if (!panel) return;
  const atk = activeCombatAttack();
  if (!atk) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
  panel.classList.remove('hidden');

  const isMaster = combatState.callerIsMaster;
  const myIds = combatMyCharacterIds();
  const iAmAttacker = isMaster || myIds.includes(atk.attacker_character_id);
  const iAmTarget = isMaster || myIds.includes(atk.target_character_id);

  const attackerLabel = atk.is_environmental ? 'Evento' : combatCharNameById(atk.attacker_character_id);
  let body = `<div class="section-title"><span class="dot"></span>Attacco in corso</div>
    <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:10px;">
    <p style="margin:0;"><b>${escapeHtml(attackerLabel)}</b> ${atk.is_environmental ? 'colpisce' : 'attacca'} <b>${escapeHtml(combatCharNameById(atk.target_character_id))}</b> con <i>${escapeHtml(atk.source_label || '')}</i>${atk.is_surprise_attack ? ' <span class="chip">Sorpresa</span>' : ''}</p>`;
  if (atk.original_target_character_id) {
    body += `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">❓ Confuso: l'attacco doveva colpire <b>${escapeHtml(combatCharNameById(atk.original_target_character_id))}</b> ma è stato ridiretto.</p>`;
  }

  // "Danno fisso": già completamente risolto al momento della creazione
  // (vedi apply_danno_fisso/resolveDannoFisso) — niente narrazione di
  // riduzione/schivata/blocco (mai avvenute, per costruzione), solo
  // l'esito dell'eventuale stato e il bottone "Applica danno" già esistente.
  if (atk.is_danno_fisso) {
    body += '<p class="helper-text" style="margin:0;color:var(--fisico-forte);">⚡ Danno fisso: ignora completamente le difese del bersaglio.</p>';
    body += `<p style="margin:0;"><b>Danno finale: ${atk.final_damage}</b></p>`;
    body += percentContestStatusInfo(atk.effect_name) ? combatStatusOutcomeHtml(atk) : '';
    body += isMaster ? '<button type="button" class="btn btn-primary btn-sm" id="btn-combat-apply-damage">✔ Applica danno</button>'
      : '<p class="helper-text" style="margin:0;">In attesa che il Narratore applichi il danno...</p>';
    if (isMaster) body += '<button type="button" class="btn btn-ghost btn-sm" id="btn-combat-cancel-attack">✕ Annulla attacco</button>';
    body += '</div></div>';
    panel.innerHTML = body;
    return;
  }

  if (atk.status === 'declared') {
    if (isMaster) body += '<button type="button" class="btn btn-ghost btn-sm" id="btn-combat-attack-flags">⚙ Sorpresa/Schivata...</button>';
    if (iAmAttacker) {
      // "Tiro dal tavolo": solo il Narratore, per registrare il tiro fatto
      // realmente con dadi fisici dal giocatore invece che dall'app (vedi
      // combatAttackDiceNeeded/combatRollAttackAndDamageManual) — l'attacco
      // resta risolvibile anche dall'attaccante stesso col bottone normale.
      body += `<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" id="btn-combat-roll-attack">🎲 Tira per colpire e danno</button>
        ${isMaster ? '<button type="button" class="btn btn-ghost btn-sm" id="btn-combat-roll-attack-manual">✏️ Tiro dal tavolo...</button>' : ''}
      </div>`;
    } else {
      body += '<p class="helper-text" style="margin:0;">In attesa del tiro dell\'attaccante...</p>';
    }
  } else if (atk.status === 'attack_rolled') {
    const isMixed = Number(atk.danno_base_2) > 0;
    body += atk.is_environmental
      ? `<p class="helper-text" style="margin:0;">Difficoltà: ${atk.difficulty} · Danno: ${atk.damage_roll_total} (${escapeHtml(atk.damage_roll_detail || '')})</p>`
      : `<p class="helper-text" style="margin:0;">Per colpire: ${atk.attack_roll_total} (${escapeHtml(atk.attack_roll_detail || '')})<br>Danno${isMixed ? ' Fisico' : ''}: ${atk.damage_roll_total} (${escapeHtml(atk.damage_roll_detail || '')})${isMixed ? `<br>Danno Magico: ${atk.damage_roll_total_2} (${escapeHtml(atk.damage_roll_detail_2 || '')})` : ''}</p>`;
    const targetStordito = combatEffectsForChar(atk.target_character_id).some(e => e.status_key === 'stordire');
    if (!atk.dodge_block_allowed) {
      body += iAmTarget ? '<button type="button" class="btn btn-primary btn-sm" data-combatdefensenone="1">Schivata/blocco non consentiti — prosegui</button>'
        : '<p class="helper-text" style="margin:0;">In attesa del bersaglio (schivata/blocco non consentiti)...</p>';
    } else if (targetStordito) {
      body += iAmTarget ? '<button type="button" class="btn btn-primary btn-sm" data-combatdefensenone="1">💫 Stordito: schivata/blocco non consentiti — prosegui</button>'
        : '<p class="helper-text" style="margin:0;">In attesa del bersaglio (💫 stordito: schivata/blocco non consentiti)...</p>';
    } else if (iAmTarget) {
      const targetDataForCounter = combatFindParticipantChar(atk.target_character_id);
      const counterAvailable = combatContrattaccoAvailable(atk, targetDataForCounter);
      body += `<div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" data-combatdefense="dodge">🌀 Schiva</button>
        <button type="button" class="btn btn-primary btn-sm" data-combatdefense="block">🛡 Blocca</button>
        <button type="button" class="btn btn-primary btn-sm" data-combatdefense="save">🙏 Salvezza (${escapeHtml(atk.effect_save_stat || 'Resistenza')})</button>
        ${counterAvailable ? '<button type="button" class="btn btn-primary btn-sm" data-combatdefense="counter">🥊 Contrattacco</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-combatdefense="none">Non mi difendo</button>
      </div>`;
    } else {
      body += '<p class="helper-text" style="margin:0;">In attesa della schivata/blocco del bersaglio...</p>';
    }
  } else if (atk.status === 'defense_rolled' || atk.status === 'save_rolled') {
    const isMixed = Number(atk.danno_base_2) > 0;
    const defenseLabel = atk.defense_type === 'dodge' ? 'Schivata (Elusione/Destrezza)'
      : atk.defense_type === 'block' ? 'Blocco (Guardia)'
      : atk.defense_type === 'save' ? `🙏 Salvezza (${escapeHtml(atk.effect_save_stat || 'Resistenza')})`
      : atk.defense_type === 'counter' ? '🥊 Contrattacco (Arte Combattiva)' : '';
    body += (atk.defense_type && atk.defense_type !== 'none')
      ? `<p class="helper-text" style="margin:0;">${defenseLabel}: ${atk.defense_roll_total} (${escapeHtml(atk.defense_roll_detail || '')}) — ${atk.defense_success ? 'riuscita' : 'fallita'}</p>`
      : `<p class="helper-text" style="margin:0;">Nessuna difesa tentata.</p>`;
    // Contrattacco riuscito: il subente non ha subito nulla di questo
    // attacco (danno residuo azzerato più sotto) e ha già restituito metà
    // danno all'attaccante, applicato direttamente qui — nessun ulteriore
    // tiro critico da fare (vedi combatRollDefense/submit_attack_defense_roll).
    if (atk.defense_type === 'counter' && atk.defense_success) {
      body += `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">🥊 Contrattacco riuscito: nessun danno subito, ${atk.counter_damage_dealt || 0} danno restituito direttamente a ${escapeHtml(combatCharNameById(atk.attacker_character_id))} (difese ignorate).</p>`;
    }
    body += `<p class="helper-text" style="margin:0;">Riduzione automatica${isMixed ? ' Fisica' : ''}: ${atk.auto_reduction_1} (${escapeHtml(atk.auto_reduction_1_detail || '')})${isMixed ? `<br>Riduzione automatica Magica: ${atk.auto_reduction_2} (${escapeHtml(atk.auto_reduction_2_detail || '')})` : ''}</p>`;
    body += `<p class="helper-text" style="margin:0;">Danno residuo${isMixed ? ' Fisico' : ''}: ${atk.damage_after_defense}${isMixed ? `<br>Danno residuo Magico: ${atk.damage_after_defense_2}` : ''}</p>`;
    if (atk.status === 'defense_rolled') {
      body += iAmTarget ? '<button type="button" class="btn btn-primary btn-sm" id="btn-combat-roll-critcheck">🎲 Tira Resistenza (critico?)</button>'
        : '<p class="helper-text" style="margin:0;">In attesa del tiro critico del bersaglio...</p>';
    }
  }
  if (atk.status === 'save_rolled') {
    if (atk.crit_check_roll_total != null) {
      body += `<p class="helper-text" style="margin:0;">Resistenza: ${atk.crit_check_roll_total} (${escapeHtml(atk.crit_check_roll_detail || '')})</p>`;
    }
    if (atk.is_critical_hit) {
      body += '<p class="helper-text" style="margin:0;color:var(--fisico-forte);">🎯 Colpo critico! Danno raddoppiato.</p>';
    }
    if (atk.is_frozen_crit) {
      body += `<p class="helper-text" style="margin:0;color:var(--fisico-forte);">❄️ ${escapeHtml(atk.targeted_body_part || '')}: colpo alla parte congelata — critico confermato, danno raddoppiato!</p>`;
    }
    body += `<p style="margin:0;"><b>Danno finale: ${atk.final_damage}</b></p>`;
    // "Rompere" (e ogni altro effect_name libero non nel catalogo a
    // percentuale): scatta quando il colpo non è stato del tutto evitato
    // (Schiva fallita/non tentata, Blocco, Nessuna difesa) — prima
    // dipendeva dal fallimento della vecchia salvezza di Resistenza.
    const effectAvoided = atk.defense_type === 'dodge' && atk.defense_success === true;
    body += percentContestStatusInfo(atk.effect_name) ? combatStatusOutcomeHtml(atk) : combatEffectOutcomeHtml(atk, effectAvoided);
    body += combatSanguinareAutoOutcomeHtml(atk);
    body += isMaster ? '<button type="button" class="btn btn-primary btn-sm" id="btn-combat-apply-damage">✔ Applica danno</button>'
      : '<p class="helper-text" style="margin:0;">In attesa che il Narratore applichi il danno...</p>';
  }
  if (isMaster) body += '<button type="button" class="btn btn-ghost btn-sm" id="btn-combat-cancel-attack">✕ Annulla attacco</button>';
  body += '</div></div>';
  panel.innerHTML = body;
}

/* ---------------------------------------------------------- tiri (client-side, stesse formule già in uso) */

/* Calcola l'esito di un attacco dichiarato (per colpire, danno, tiri di
   stato, Perforare/Tagliare) SENZA alcun effetto collaterale — nessuna
   scrittura sul server, nessun refresh. Stessa identica formula sia in
   modalità automatica (dadi generati da rollDie/Math.random) sia in
   modalità manuale (dadi presi dai valori inseriti dal Narratore, vedi
   combatManualDiceQueue in js/data.js) sia in modalità "enumerazione"
   (combatDiceRecorder attivo: nessun dado viene davvero tirato, si
   raccolgono solo le etichette/facce necessarie — vedi
   combatAttackDiceNeeded) — unica fonte di verità per tutti e tre i casi,
   ogni rollDie/rollPureStatTotal qui dentro porta un'etichetta leggibile
   proprio per questo. */
function combatComputeAttackRoll(atk, attackerData) {
  // "per colpire": il tratto dipende dalla tipologia d'arma scelta al
  // momento della dichiarazione (vedi openCombatWeaponPicker) — Arte
  // Combattiva di default (armi bianche, Tecniche/Abilità, lancio corpo a
  // corpo), Mira per le armi a distanza (dado scalato sulla statistica
  // primaria, stessa forma di "Dif" nel blocco — vedi rollPureStatTotal),
  // Lanciare per il lancio a distanza.
  const attackTrait = atk.attack_trait || 'Arte Combattiva';
  let attackRollTotal, attackRollDetail;
  if (attackTrait === 'Mira') {
    // Accecare: la Mira dell'attaccante è ridotta del 70% (arrotondato per
    // eccesso sulla riduzione) finché lo stato è attivo su di lui. Droghe a
    // due fasi: eventuali modificatori percentuali attivi su 'mira' si
    // applicano moltiplicativamente sul valore in scheda, prima del malus
    // di Accecare.
    const isAccecato = combatEffectsForChar(atk.attacker_character_id).some(e => e.status_key === 'accecare');
    const miraBase = (Number(attackerData.primary.mira) || 0) * statModMultiplier(atk.attacker_character_id, 'mira');
    const miraEff = isAccecato ? (miraBase - Math.ceil(miraBase * 0.7)) : miraBase;
    const miraChar = Object.assign({}, attackerData, { primary: Object.assign({}, attackerData.primary, { mira: Math.round(miraEff) }) });
    const r = rollPureStatTotal(miraChar, 'mira', 'Per colpire (Mira)');
    attackRollTotal = r.total;
    attackRollDetail = `Mira ${r.detail}${isAccecato ? ' (accecato)' : ''}`;
    if (combatHasDoppioTiro(attackerData, 'mira')) {
      const r2 = rollPureStatTotal(miraChar, 'mira', 'Tiro doppio: secondo tiro Mira');
      attackRollTotal += r2.total;
      attackRollDetail += ` · Tiro doppio: secondo tiro Mira puro ${r2.detail}`;
    }
  } else {
    // Droghe a due fasi: un modificatore percentuale può agire anche su un
    // TRATTO (non solo statistiche primarie) — qui Arte Combattiva per gli
    // attacchi in mischia (chiave 'arteCombattiva'), es. RUSH-4. Un'arma con
    // un tratto di specializzazione proprio (attackTraitName, es. "Arte
    // marziale Systema") sostituisce "Arte Combattiva" qui — il nome stesso
    // di attackTrait è il tratto da cercare in Capacità Combattive, non più
    // fisso: solo quando è letteralmente "Arte Combattiva" si applica anche
    // il moltiplicatore droga dedicato (un tratto diverso per nome non va
    // bonificato da una droga che parla di Arte Combattiva).
    const traitValBase = attackTrait === 'Lanciare'
      ? getTraitValue(attackerData, 'capacitaNormali', 'Lanciare')
      : getTraitValue(attackerData, 'capacitaCombattive', attackTrait);
    const traitVal = attackTrait === 'Arte Combattiva'
      ? Math.round(traitValBase * statModMultiplier(atk.attacker_character_id, 'arteCombattiva'))
      : traitValBase;
    const d20 = rollDie(20, `Per colpire (d20 + ${attackTrait})`);
    attackRollTotal = d20 + traitVal;
    attackRollDetail = `d20:${d20} +${attackTrait} ${traitVal}`;
  }

  // danno: stessa identica formula di "Tira danno" (dmg-tecab-resolve-btn),
  // tranne per 'esplosivo' — danno puro, nessuna statistica sommata: il
  // dado si scala sul dannoBase stesso invece che su un bonus statistica.
  const isEsplosivo = atk.danno_tipo === 'esplosivo';
  const stat = dannoStatFor(atk.danno_tipo, atk.danno_stat);
  // Droghe a due fasi: il moltiplicatore percentuale si applica al valore
  // in scheda della statistica, prima di sommare i bonus fissi di equip.
  const withBonus = isEsplosivo ? 0
    : Math.round((Number(attackerData.primary[stat]) || 0) * statModMultiplier(atk.attacker_character_id, stat)) + buffTotal(attackerData, stat);
  const diceLabel = diceForValue(isEsplosivo ? (Number(atk.danno_base) || 0) : withBonus);
  let dieRoll, dieText;
  if (diceLabel === 'd12+d8') {
    const a = rollDie(12, 'Danno (d12)'), b = rollDie(8, 'Danno (d8)');
    dieRoll = a + b; dieText = `d12+d8 (${a}+${b})`;
  } else {
    const sides = Number(diceLabel.slice(1));
    dieRoll = rollDie(sides, `Danno (${diceLabel})`); dieText = `${diceLabel} (${dieRoll})`;
  }
  // Droghe con un bonus al DANNO invece che a una statistica (es. Redline,
  // "+25% danni fisici"): moltiplicatore separato, applicato al totale
  // finale del tiro danno, solo per il tipo (fisico/magico) coerente.
  const dannoPctKey = atk.danno_tipo === 'magico' ? 'dannoMagico' : 'dannoFisico';
  const dannoPctMult = isEsplosivo ? 1 : statModMultiplier(atk.attacker_character_id, dannoPctKey);
  // "Tiro doppio" sul danno (es. Colpo Soppressore — vedi
  // combatTecAbSourcesFor/effettoCellHtml): un secondo tiro dado+statistica
  // indipendente, stessa formula del primo, sommato prima del
  // moltiplicatore percentuale delle droghe (che così scala l'intero danno
  // raddoppiato, non solo la prima metà).
  let dieRoll2 = 0, dieText2 = '';
  if (!isEsplosivo && atk.danno_stat_doppio) {
    if (diceLabel === 'd12+d8') {
      const a2 = rollDie(12, 'Tiro doppio danno (d12)'), b2 = rollDie(8, 'Tiro doppio danno (d8)');
      dieRoll2 = a2 + b2; dieText2 = `d12+d8 (${a2}+${b2})`;
    } else {
      const sides2 = Number(diceLabel.slice(1));
      dieRoll2 = rollDie(sides2, `Tiro doppio danno (${diceLabel})`); dieText2 = `${diceLabel} (${dieRoll2})`;
    }
  }
  const secondRollBonus = atk.danno_stat_doppio ? withBonus : 0;
  const damageRollTotalPreMult = (Number(atk.danno_base) || 0) + dieRoll + withBonus + dieRoll2 + secondRollBonus;
  const damageRollTotal = Math.round(damageRollTotalPreMult * dannoPctMult);
  const damageRollDetail = (isEsplosivo
    ? `${atk.danno_base} + ${dieText} (esplosivo, nessuna statistica)`
    : `${atk.danno_base} + ${dieText} + ${stat.toUpperCase()} ${withBonus}`)
    + (atk.danno_stat_doppio ? ` · Tiro doppio: secondo ${dieText2} + ${stat.toUpperCase()} ${withBonus}` : '')
    + (dannoPctMult !== 1 ? ` ×${dannoPctMult.toFixed(2)} (droga)` : '');

  // Danno misto (solo attacchi con arma/Abilità, mai Tecniche): componente
  // magica separata, sempre scalata su Forza Mentale, stesso dannoBase
  // (arma: stesso Atk; Abilità: il proprio campo dannoBase2) — dado e
  // percentuale-droga indipendenti dalla componente principale sopra.
  let damageRollTotal2 = null, damageRollDetail2 = null;
  if (Number(atk.danno_base_2) > 0) {
    const withBonus2 = Math.round((Number(attackerData.primary.fmen) || 0) * statModMultiplier(atk.attacker_character_id, 'fmen')) + buffTotal(attackerData, 'fmen');
    const diceLabel2 = diceForValue(withBonus2);
    let dieRoll2b, dieText2b;
    if (diceLabel2 === 'd12+d8') {
      const a3 = rollDie(12, 'Danno magico (d12)'), b3 = rollDie(8, 'Danno magico (d8)');
      dieRoll2b = a3 + b3; dieText2b = `d12+d8 (${a3}+${b3})`;
    } else {
      const sides2b = Number(diceLabel2.slice(1));
      dieRoll2b = rollDie(sides2b, `Danno magico (${diceLabel2})`); dieText2b = `${diceLabel2} (${dieRoll2b})`;
    }
    const dannoPctMult2 = statModMultiplier(atk.attacker_character_id, 'dannoMagico');
    damageRollTotal2 = Math.round(((Number(atk.danno_base_2) || 0) + dieRoll2b + withBonus2) * dannoPctMult2);
    damageRollDetail2 = `${atk.danno_base_2} + ${dieText2b} + FMEN ${withBonus2}`
      + (dannoPctMult2 !== 1 ? ` ×${dannoPctMult2.toFixed(2)} (droga)` : '');
  }

  // Ingresso di uno stato del catalogo (Bruciare/Avvelenare/...): dado
  // contrapposto percentuale, lato attaccante — 1d100 puro (la riuscita
  // dipende dalla tecnica scelta, non da chi la usa), più l'eventuale bonus
  // di equipaggiamento specifico per QUESTO stato (kind:'status' sui bonus
  // di arma/scudo/armatura, vedi equipBonusRowHtml) — nessun bonus di
  // tratto altrimenti. Confrontato server-side col tiro di resistenza del
  // bersaglio, vedi combatRollDefense.
  let statusRollTotal = null, statusRollDetail = null;
  const statusMatch = percentContestStatusInfo(atk.effect_name);
  if (statusMatch) {
    const equipBonus = equipBonusTotal(attackerData, 'status', statusMatch.key);
    const drugBonus = statusRollBonus(atk.attacker_character_id, statusMatch.key);
    // Bonus intrinseco dell'Abilità stessa (mai su una Tecnica, vedi
    // combatTecAbSourcesFor/effettoBonusPct).
    const abilityBonus = Number(atk.effect_bonus_pct) || 0;
    const totalBonus = equipBonus + drugBonus + abilityBonus;
    const d100 = rollDie(100, `Stato: ${statusMatch.label} (d100)`);
    statusRollTotal = d100 + totalBonus;
    statusRollDetail = totalBonus ? `d100:${d100} +${totalBonus} (${statusMatch.label})` : `d100: ${d100}`;
  }

  // Secondo tiro di stato INDIPENDENTE, solo se l'attacco viene da una
  // Tecnica il cui arma equipaggiata ha un proprio effetto configurato
  // (weapon_effect_name, vedi combatTecAbSourcesFor/openCombatWeaponPicker
  // e declare_combat_attack) — dado separato, mai lo stesso di sopra: i due
  // effetti (Tecnica + arma) sono completamente slegati, possono landare
  // entrambi, uno solo o nessuno.
  let weaponStatusRollTotal = null, weaponStatusRollDetail = null;
  const weaponStatusMatch = percentContestStatusInfo(atk.weapon_effect_name);
  if (weaponStatusMatch) {
    const equipBonus = equipBonusTotal(attackerData, 'status', weaponStatusMatch.key);
    const drugBonus = statusRollBonus(atk.attacker_character_id, weaponStatusMatch.key);
    const totalBonus = equipBonus + drugBonus;
    const d100 = rollDie(100, `Stato arma: ${weaponStatusMatch.label} (d100)`);
    weaponStatusRollTotal = d100 + totalBonus;
    weaponStatusRollDetail = totalBonus ? `d100:${d100} +${totalBonus} (${weaponStatusMatch.label})` : `d100: ${d100}`;
  }

  // Perforare/Tagliare -> Sanguinare automatico: nessun effetto scelto dal
  // Narratore, tirato ogni volta che il tratto di salvezza fissato sulla
  // riga è Resistenza — il maggiore fra i due tratti (base + eventuale
  // bonus dell'arma equipaggiata, stesso getTraitValue di sempre), d20 come
  // gli altri tiri su capacità combattive. Confrontato server-side col
  // tiro Elusione/Guardia del bersaglio, vedi combatRollDefense.
  let perforareTaglioRollTotal = null, perforareTaglioRollDetail = null;
  if (atk.effect_save_stat === 'Resistenza') {
    const perforareVal = getTraitValue(attackerData, 'capacitaCombattive', 'Perforare');
    const taglioVal = getTraitValue(attackerData, 'capacitaCombattive', 'Tagliare');
    const trattoNome = taglioVal > perforareVal ? 'Tagliare' : 'Perforare';
    const trattoVal = Math.max(perforareVal, taglioVal);
    const d20b = rollDie(20, `${trattoNome} (Perforare/Tagliare, d20)`);
    perforareTaglioRollTotal = d20b + trattoVal;
    perforareTaglioRollDetail = `d20:${d20b} +${trattoNome} ${trattoVal}`;
  }

  // Contrattacco (difesa reattiva, vedi combatRollDefense/effettoCellHtml):
  // il bersaglio potrebbe scegliere di rispondere con un tiro contrapposto
  // di Arte Combattiva — il proprio lato dell'attaccante va quindi tirato
  // GIÀ ORA (asincrono: l'attaccante non è presente al momento in cui il
  // bersaglio sceglierà), come già fatto per attacker_status_roll_total,
  // usato solo se davvero serve. Mai contro armi a distanza/da fuoco
  // (Mira) — nessun tiro da fare in quel caso, coerente con
  // combatContrattaccoAvailable lato client e col controllo server-side.
  let counterRollTotal = null, counterRollDetail = null;
  if (attackTrait !== 'Mira') {
    const arteCombattivaAtk = Math.round(getTraitValue(attackerData, 'capacitaCombattive', 'Arte Combattiva') * statModMultiplier(atk.attacker_character_id, 'arteCombattiva'));
    const d20c = rollDie(20, 'Contrattacco avversario: d20 + Arte Combattiva');
    counterRollTotal = d20c + arteCombattivaAtk;
    counterRollDetail = `d20:${d20c} +Arte Combattiva ${arteCombattivaAtk}`;
  }

  return { attackRollTotal, attackRollDetail, damageRollTotal, damageRollDetail, damageRollTotal2, damageRollDetail2, statusRollTotal, statusRollDetail, perforareTaglioRollTotal, perforareTaglioRollDetail, weaponStatusRollTotal, weaponStatusRollDetail, counterRollTotal, counterRollDetail };
}

async function combatRollAttackAndDamage(atk) {
  const attackerData = combatFindParticipantChar(atk.attacker_character_id);
  if (!attackerData) { toast('Dati del personaggio non disponibili'); return; }
  const r = combatComputeAttackRoll(atk, attackerData);
  try {
    await submitCombatAttackRolls(atk.id, r.attackRollTotal, r.attackRollDetail, r.damageRollTotal, r.damageRollDetail, r.statusRollTotal, r.statusRollDetail, r.perforareTaglioRollTotal, r.perforareTaglioRollDetail, r.weaponStatusRollTotal, r.weaponStatusRollDetail, r.damageRollTotal2, r.damageRollDetail2, r.counterRollTotal, r.counterRollDetail);
    await refreshCombatBoard();
  } catch (err) { toast(describeErrorWithContext('Errore nel tiro', err)); }
}

/* Elenco dei dadi che servirebbero per risolvere QUESTO attacco (etichetta +
   facce, nello stesso ordine in cui combatComputeAttackRoll li chiederebbe)
   — nessun dado viene davvero tirato, nessuna scrittura: usata per costruire
   il form di tiro manuale del Narratore (vedi openCombatManualRollModal),
   prima ancora di sapere quali valori inserire. */
function combatAttackDiceNeeded(atk, attackerData) {
  combatDiceRecorder = [];
  try { combatComputeAttackRoll(atk, attackerData); }
  finally { var needed = combatDiceRecorder; combatDiceRecorder = null; }
  return needed;
}

/* Stessa risoluzione di combatRollAttackAndDamage, ma i dadi non vengono
   generati dall'app: sono quelli realmente usciti al tavolo, inseriti dal
   Narratore (uno per voce di combatAttackDiceNeeded, stesso ordine) — per
   quando il gruppo gioca con dadi fisici e vuole che l'app applichi comunque
   tutta la matematica (bonus, tiri doppi, droghe, ecc.) sui valori reali. */
async function combatRollAttackAndDamageManual(atk, manualValues) {
  const attackerData = combatFindParticipantChar(atk.attacker_character_id);
  if (!attackerData) { toast('Dati del personaggio non disponibili'); return; }
  combatManualDiceQueue = manualValues.slice();
  let r;
  try { r = combatComputeAttackRoll(atk, attackerData); }
  finally { combatManualDiceQueue = null; }
  try {
    await submitCombatAttackRolls(atk.id, r.attackRollTotal, r.attackRollDetail, r.damageRollTotal, r.damageRollDetail, r.statusRollTotal, r.statusRollDetail, r.perforareTaglioRollTotal, r.perforareTaglioRollDetail, r.weaponStatusRollTotal, r.weaponStatusRollDetail, r.damageRollTotal2, r.damageRollDetail2, r.counterRollTotal, r.counterRollDetail);
    await refreshCombatBoard();
  } catch (err) { toast(describeErrorWithContext('Errore nel tiro', err)); }
}

/* Apre il form "Tiro dal tavolo": un campo numerico per ciascun dado che
   combatComputeAttackRoll chiederebbe per QUESTO attacco (etichetta +
   facce, vedi combatAttackDiceNeeded) — alla conferma i valori vanno,
   nello stesso ordine, a combatRollAttackAndDamageManual. */
function openCombatManualRollModal(atk) {
  const attackerData = combatFindParticipantChar(atk.attacker_character_id);
  if (!attackerData) { toast('Dati del personaggio non disponibili'); return; }
  const needed = combatAttackDiceNeeded(atk, attackerData);
  if (!needed.length) { toast('Nessun dado da inserire per questo attacco'); return; }
  combatManualRollPendingAtk = atk;
  $('#combat-manual-roll-fields').innerHTML = needed.map((d, idx) => `
    <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span>${escapeHtml(d.label)}</span>
      <input type="number" min="1" max="${d.sides}" step="1" data-manualdie="${idx}" data-manualdielabel="${escapeHtml(d.label)}" style="width:70px;">
    </label>`).join('');
  $('#combat-manual-roll-modal').classList.remove('hidden');
}

/* Vero se il personaggio ha una riga Supporto/Misto Attiva con
   doppioTiroStat impostato sulla statistica indicata (es. Difesa Corazzata
   su 'dif') — vedi combatRollDefense/combatRollAttackAndDamage e i
   gestori dei bottoni standalone "Bloccare"/"Attacca". */
function combatHasDoppioTiro(data, statKey) {
  return [...(data.tecniche || []), ...(data.abilita || [])].some(r => r.attiva && r.doppioTiroStat === statKey);
}
/* Riduzione automatica (Layer A, SEMPRE applicata indipendentemente dalla
   scelta Schiva/Blocca/Nessuna): tiro puro della statistica PRIMARIA 'dif'
   o 'dmen' (Difesa/Difesa Mentale — stesse chiavi di "Tiro doppio", non il
   tratto omonimo in capacitaCombattive), bonus equip/droga inclusi.
   Corrodere dimezza solo 'dif' (mai 'dmen'), stessa regola già in uso per
   Resistenza. */
function combatAutoReductionRoll(targetData, targetCharacterId, statKey, targetedBodyPart) {
  const label = statKey === 'dif' ? 'Difesa' : 'Difesa Mentale';
  const isCorroso = statKey === 'dif' && combatEffectsForChar(targetCharacterId).some(e => e.status_key === 'corrodere');
  // buffTotal sommerebbe l'equip su TUTTI i pezzi indossati: qui va sostituito
  // col solo bonus del pezzo che copre la parte colpita (vedi equipDefensiveBonusForHit).
  const consumableBuff = (targetData.statBuffs || []).filter(b => b.target === statKey && !b.listKey).reduce((s, b) => s + (Number(b.valore) || 0), 0);
  const armorBonus = equipDefensiveBonusForHit(targetData, 'primary', statKey, null, targetedBodyPart);
  const base = Math.round((Number(targetData.primary[statKey]) || 0) * statModMultiplier(targetCharacterId, statKey)) + consumableBuff + tecAbBuffTotal(targetData, statKey) + armorBonus;
  const finalBase = isCorroso ? Math.floor(base / 2) : base;
  const statChar = Object.assign({}, targetData, { primary: Object.assign({}, targetData.primary, { [statKey]: finalBase }) });
  const r = rollPureStatTotal(statChar, statKey, `Riduzione automatica ${label}`);
  let total = r.total, detail = `${label}${isCorroso ? ' (corrosa)' : ''} ${r.detail}`;
  if (combatHasDoppioTiro(targetData, statKey)) {
    const r2 = rollPureStatTotal(statChar, statKey, `Riduzione automatica ${label}: secondo tiro`);
    total += r2.total;
    detail += ` · Tiro doppio: secondo tiro ${label} puro ${r2.detail}`;
  }
  return { total, detail };
}

/* Tiro di resistenza percentuale (d100) a uno stato del catalogo, lato
   bersaglio — indipendente dal resto della difesa, sempre calcolato quando
   l'attacco porta un effetto di stato (il server decide se applicarlo
   davvero: niente stato se il colpo è stato del tutto evitato, vedi
   submit_attack_defense_roll). Estratto in un helper perché serve sia per
   l'effetto principale sia per quello dell'arma equipaggiata.

   Solo bonus percentuali su entrambi i lati (stessa scala del d100 usato
   dall'attaccante in combatComputeAttackRoll: equip + droga, mai un valore
   grezzo di tratto sommato al dado — un tratto come Resistenza vale ~15-20,
   pensato per un d20, non per un d100). Il tratto di salvezza (saveStat)
   resta nella firma solo per compatibilità con i chiamanti: la sua vera
   funzione ora è decidere il tratto della difesa "Salvezza" (vedi
   combatRollDefense), non più contribuire a questo tiro. */
function combatStatusResistRoll(targetData, targetCharacterId, saveStat, statusKey, label, targetedBodyPart) {
  // un pezzo d'equipaggiamento che rende immuni a questo stato annulla il
  // tiro: nessun dado, successo automatico (stesso principio di
  // immuneStatusKey già in uso per le droghe a due fasi, ma da equip).
  if (equipBonusTotal(targetData, 'statusimmune', statusKey) > 0) {
    return { total: 9999, detail: 'Immune (equipaggiamento)', immune: true };
  }
  const defenderDrugBonus = statusRollBonus(targetCharacterId, statusKey);
  const equipResistBonus = equipBonusTotal(targetData, 'statusresist', statusKey);
  const d100 = rollDie(100, `${label}: resistenza (d100)`);
  const total = d100 + defenderDrugBonus + equipResistBonus;
  const detail = `d100:${d100}${defenderDrugBonus ? ` +${defenderDrugBonus} (droga)` : ''}${equipResistBonus ? ` +${equipResistBonus} (equip.)` : ''}`;
  return { total, detail };
}

/* Prima Tecnica (mai Abilità: poteri magici senza contatto fisico) con
   contrattacco:true e un nome — la difesa reattiva "Contrattacco" (vedi
   effettoCellHtml) è disponibile solo se il personaggio ne ha almeno una
   configurata in scheda. */
function combatFindContrattaccoRow(data) {
  if (!data) return null;
  const idx = (data.tecniche || []).findIndex(r => r.contrattacco && r.nome && String(r.nome).trim());
  return idx >= 0 ? { index: idx, row: data.tecniche[idx] } : null;
}
/* Il bottone "🥊 Contrattacco" compare come difesa reattiva solo se: il
   bersaglio ha una Tecnica di Contrattacco in scheda, l'attacco non è con
   arma a distanza/da fuoco (Mira — vedi combat_attacks.attack_trait; le
   armi da lancio/bianche restano valide), Schiva/Blocco sono comunque
   consentiti su questo attacco (nessuna sorpresa) e il bersaglio non è
   Stordito (nessuna difesa attiva possibile, stesso motivo per cui
   Schiva/Blocco spariscono già in quel caso). */
function combatContrattaccoAvailable(atk, targetData) {
  if (!targetData || !atk) return false;
  if (atk.attack_trait === 'Mira') return false;
  if (!atk.dodge_block_allowed) return false;
  if (combatEffectsForChar(atk.target_character_id).some(e => e.status_key === 'stordire')) return false;
  return !!combatFindContrattaccoRow(targetData);
}
/* Schiva/Blocca/Contrattacco/Nessuna difesa, UNA sola scelta per l'intero
   attacco (vale per entrambe le componenti se il danno è misto). Insieme,
   sempre: la riduzione automatica Dif/DifMen (Layer A, per ciascuna
   componente) e gli eventuali tiri di resistenza percentuale agli stati del
   catalogo — tutto inviato in un'unica chiamata (submit_attack_defense_roll),
   che decide server-side se serve ancora il tiro critico
   (submitCombatCritCheck) o se il danno finale è già pronto. */
async function combatRollDefense(atk, type) {
  const targetData = combatFindParticipantChar(atk.target_character_id);
  if (!targetData) { toast('Dati del personaggio non disponibili'); return; }
  const targetId = atk.target_character_id;
  const isMixed = Number(atk.danno_base_2) > 0;

  const stat1 = atk.danno_stat === 'fmen' ? 'dmen' : 'dif';
  const auto1 = combatAutoReductionRoll(targetData, targetId, stat1, atk.targeted_body_part);
  const auto2 = isMixed ? combatAutoReductionRoll(targetData, targetId, 'dmen', atk.targeted_body_part) : null;

  let statusRollTotal = null, statusRollDetail = null;
  const statusMatchDef = percentContestStatusInfo(atk.effect_name);
  if (statusMatchDef) {
    const r = combatStatusResistRoll(targetData, targetId, atk.effect_save_stat || 'Resistenza', statusMatchDef.key, `Stato: ${statusMatchDef.label}`, atk.targeted_body_part);
    statusRollTotal = r.total; statusRollDetail = r.detail;
  }
  let weaponStatusRollTotal = null, weaponStatusRollDetail = null;
  const weaponStatusMatchDef = percentContestStatusInfo(atk.weapon_effect_name);
  if (weaponStatusMatchDef) {
    const r = combatStatusResistRoll(targetData, targetId, atk.weapon_effect_save_stat || 'Resistenza', weaponStatusMatchDef.key, `Stato arma: ${weaponStatusMatchDef.label}`, atk.targeted_body_part);
    weaponStatusRollTotal = r.total; weaponStatusRollDetail = r.detail;
  }

  if (type === 'none') {
    try {
      await submitCombatDefenseRoll(atk.id, 'none', null, null, auto1.total, auto1.detail, auto2 ? auto2.total : null, auto2 ? auto2.detail : null, statusRollTotal, statusRollDetail, weaponStatusRollTotal, weaponStatusRollDetail);
      await refreshCombatBoard();
    } catch (err) { toast(describeError(err)); }
    return;
  }

  const isRanged = atk.attack_trait === 'Mira';
  let total, detail;
  if (type === 'dodge') {
    // A distanza: Destrezza pura invece di Elusione, invariato.
    if (isRanged) {
      const destrezzaBase = Math.round((Number(targetData.primary.dex) || 0) * statModMultiplier(targetId, 'dex'));
      const dexChar = Object.assign({}, targetData, { primary: Object.assign({}, targetData.primary, { dex: destrezzaBase }) });
      const r = rollPureStatTotal(dexChar, 'dex', 'Schiva: Destrezza (a distanza)');
      total = r.total; detail = `Destrezza (a distanza) ${r.detail}`;
      if (combatHasDoppioTiro(targetData, 'dex')) {
        const r2 = rollPureStatTotal(dexChar, 'dex', 'Schiva: secondo tiro Destrezza');
        total += r2.total;
        detail += ` · Tiro doppio: secondo tiro Destrezza puro ${r2.detail}`;
      }
    } else {
      const elusione = Math.round(getTraitValue(targetData, 'capacitaCombattive', 'Elusione') * statModMultiplier(targetId, 'elusione'));
      const d20 = rollDie(20, 'Schiva: d20 + Elusione');
      total = d20 + elusione;
      detail = `d20:${d20} +Elusione ${elusione}`;
    }
  } else if (type === 'block') { // block: tratto Guardia + scudo, stesso per Fisico/Magico/misto
    const shields = (targetData.weaponSlots || []).filter(s => s.kind === 'scudo' && isEquipmentUsable(s));
    if (!shields.length) { toast('Nessuno scudo equipaggiato'); return; }
    const shieldDif = shields.reduce((s, sh) => s + (Number(sh.dif) || 0), 0);
    const guardia = Math.round(getTraitValue(targetData, 'capacitaCombattive', 'Guardia') * statModMultiplier(targetId, 'guardia'));
    const d20 = rollDie(20, 'Blocco: d20 + Guardia');
    total = shieldDif + d20 + guardia;
    detail = `Scudo Dif +${shieldDif} · d20:${d20} +Guardia ${guardia}`;
  } else if (type === 'save') { // Salvezza: tratto di salvezza dell'attacco
    // (Resistenza/Spirito/Resistenza, effect_save_stat — sempre valorizzato,
    // default Resistenza in declare_combat_attack) contro il tiro per
    // colpire dell'attaccante: terza alternativa a Schiva/Blocca, evita il
    // colpo per intero in caso di successo (vedi submit_attack_defense_roll).
    const saveStat = atk.effect_save_stat || 'Resistenza';
    const saveStatKey = saveStat.split(' ').map((w, i) => i === 0 ? (w.charAt(0).toLowerCase() + w.slice(1)) : w).join('');
    const saveVal = Math.round(getTraitValue(targetData, 'capacitaCombattive', saveStat) * statModMultiplier(targetId, saveStatKey));
    const d20 = rollDie(20, `Salvezza: d20 + ${saveStat}`);
    total = d20 + saveVal;
    detail = `d20:${d20} +${saveStat} ${saveVal}`;
  } else { // counter: tiro contrapposto di Arte Combattiva (d20 puro se il
    // personaggio non ha il tratto, getTraitValue ritorna 0 da sé) — l'esito
    // e il danno restituito si calcolano server-side, confrontando col tiro
    // già inviato dall'attaccante in submit_attack_rolls (attacker_counter_
    // roll_total), vedi submit_attack_defense_roll.
    const arteCombattiva = Math.round(getTraitValue(targetData, 'capacitaCombattive', 'Arte Combattiva') * statModMultiplier(targetId, 'arteCombattiva'));
    const d20 = rollDie(20, 'Contrattacco: d20 + Arte Combattiva');
    total = d20 + arteCombattiva;
    detail = `d20:${d20} +Arte Combattiva ${arteCombattiva}`;
  }

  try {
    await submitCombatDefenseRoll(atk.id, type, total, detail, auto1.total, auto1.detail, auto2 ? auto2.total : null, auto2 ? auto2.detail : null, statusRollTotal, statusRollDetail, weaponStatusRollTotal, weaponStatusRollDetail);
    // Scegliere Contrattacco come difesa consuma un utilizzo della Tecnica,
    // indipendentemente dall'esito (stesso principio già in uso per
    // "Attiva" su Supporto: attivarla/tentarla è l'utilizzo, non il successo).
    if (type === 'counter') {
      const contrattacco = combatFindContrattaccoRow(targetData);
      const localChar = characters.find(ch => ch.cloudCharacterId === targetId);
      if (contrattacco && localChar) logTecnicaAbilitaUsageFor(localChar, 'tecniche', contrattacco.index);
    }
    await refreshCombatBoard();
  } catch (err) { toast(describeErrorWithContext('Errore nel tiro', err)); }
}

/* Tiro critico condizionale: solo quando Schiva/Blocca sono stati tentati e
   hanno FALLITO (mai su danno misto — il server rifiuta la chiamata se lo
   stato dell'attacco non è 'defense_rolled'). d20 + Resistenza (tratto
   hardcoded, non più legato a effect_save_stat), confrontato col "per
   colpire" dell'attaccante già tirato. */
async function combatRollCritCheck(atk) {
  const targetData = combatFindParticipantChar(atk.target_character_id);
  if (!targetData) { toast('Dati del personaggio non disponibili'); return; }
  const targetId = atk.target_character_id;
  const isCorrosoRes = combatEffectsForChar(targetId).some(e => e.status_key === 'corrodere');
  let resVal = Math.round(getTraitValue(targetData, 'capacitaCombattive', 'Resistenza') * statModMultiplier(targetId, 'resistenza'));
  if (isCorrosoRes) resVal = Math.floor(resVal / 2);
  const d20 = rollDie(20, 'Tiro critico: d20 + Resistenza');
  const total = d20 + resVal;
  const detail = `d20:${d20} +Resistenza ${resVal}${isCorrosoRes ? ' (corrosa)' : ''}`;
  try {
    await submitCombatCritCheck(atk.id, total, detail);
    await refreshCombatBoard();
  } catch (err) { toast(describeErrorWithContext('Errore nel tiro', err)); }
}

/* Tiro K.O. (soglia HP, vedi combatKoCheckDue): NON legato a un attacco —
   d20 + Resistenza (statModMultiplier incluso), inviato a submit_ko_check,
   che rifiuta la chiamata se il tiro non è davvero dovuto (ricalcolato
   server-side) o già tentato questo turno. */
async function combatRollKoCheck(characterId) {
  const p = (combatState.participants || []).find(pp => pp.characterId === characterId);
  const data = p && p.data;
  if (!data) { toast('Dati del personaggio non disponibili'); return; }
  const resistenza = Math.round(getTraitValue(data, 'capacitaCombattive', 'Resistenza') * statModMultiplier(characterId, 'resistenza'));
  const d20 = rollDie(20);
  const total = d20 + resistenza;
  const detail = `d20:${d20} +Resistenza ${resistenza}`;
  try {
    const result = await submitKoCheck(combatViewEncounterId, characterId, total, detail);
    await refreshCombatBoard();
    toast(result && result.success ? `🎲 ${total} ≥ 10 — resta vigile` : `🎲 ${total} < 10 — K.O.: perde il turno`);
  } catch (err) { toast(describeErrorWithContext('Errore nel tiro K.O.', err)); }
}

async function combatRollAndSendInitiative() {
  if (!combatViewEncounterId || !combatState) return;
  const stagedParticipants = combatState.participants || [];
  if (!stagedParticipants.length) { toast('Metti in scena almeno un personaggio prima di rivelare l\'iniziativa'); return; }
  const unpositioned = stagedParticipants.filter(p => p.hexCol == null || p.hexRow == null).length;
  if (unpositioned > 0) {
    toast(`Posiziona sulla mappa tutti i personaggi prima di rivelare l'iniziativa (${unpositioned} ancora da posizionare)`);
    return;
  }
  // il Narratore (unico che può rivelare l'iniziativa) vede sempre 'data'
  // per intero su ogni partecipante, PNG compresi: mai 'revealed' qui
  const rolls = (combatState.participants || []).map(p => {
    if (p.redacted || !p.data) return null;
    const vel = (Number(p.data.primary && p.data.primary.vel) || 0) + buffTotal(p.data, 'vel');
    const d8 = rollDie(8);
    return { characterId: p.characterId, rollTotal: d8 + vel, rollDetail: `d8:${d8} +Vel ${vel}` };
  }).filter(Boolean);
  try {
    await rollAndSetInitiative(combatViewEncounterId, rolls);
    await refreshCombatBoard();
    toast('Iniziativa rivelata');
  } catch (err) { toast(describeErrorWithContext('Errore nel tiro di iniziativa', err)); }
}

/* ---------------------------------------------------------- picker (target/sorgente/reveal) */

/* Riuso totale di #combat-source-picker/#combat-source-list per tutti e
   cinque i rami del menù comandi (Attacca/Tecniche/Abilità/Boost/Oggetti):
   ogni voce porta un payload con `action` che dice al gestore click
   (wireCombatView) cosa fare — 'attack' apre il target picker escludendo
   se stessi, 'effect-heal' lo apre INCLUDENDO se stessi (uniche cure),
   'effect-buff' applica direttamente su se stessi senza picker, 'boost'/
   'item' applicano direttamente su se stessi senza picker né RPC di
   attacco/effetto. */
/* `desc` opzionale: se presente, la voce si spezza in due zone (nome a
   sinistra, dettaglio abbreviato a destra — danno/effetto per Tecniche e
   Abilità, vedi combatTecAbSourceDesc) invece dell'unica etichetta centrata
   usata da armi/boost/oggetti. */
function combatSourceButtonHtml(payload, label, desc) {
  const inner = desc
    ? `<span class="cmb-source-label">${label}</span><span class="cmb-source-desc">${desc}</span>`
    : label;
  return `<button type="button" class="btn btn-ghost${desc ? ' cmb-source-btn' : ''}" data-combatsource='${escapeHtml(JSON.stringify(payload))}'>${inner}</button>`;
}

function openCombatWeaponPicker(attackerCharacterId) {
  const data = combatFindParticipantChar(attackerCharacterId);
  if (!data) { toast('Dati del personaggio non disponibili'); return; }
  const weapons = (data.weaponSlots || []).filter(s => s.equipaggiato !== false && s.name);
  cancelPendingCombatAction();
  combatPendingAttack = { attackerCharacterId };
  const list = $('#combat-source-list');
  // Ambito ridotto rispetto alla scheda (Fronte Scheda → "Attacca"): una
  // sola arma per attacco, niente combo a due armi né bonus di tiro puro
  // FOR/DEX/F.MEN aggiuntivo — quella resta la modalità avanzata sulla
  // scheda, qui basta scegliere l'arma e il bersaglio.
  list.innerHTML = weapons.length
    ? weapons.map(w => {
        // Danno misto: un'arma con usaFmen INSIEME a usaFor/usaDex produce
        // due componenti nella stessa azione (Fisica + Magica, stesso Atk
        // come base per entrambe) — vedi submit_attack_defense_roll, mai
        // per Tecniche/Abilità con una sola statistica di danno.
        const isMixedWeapon = !!w.usaFmen && !!(w.usaFor || w.usaDex);
        const dannoStat = isMixedWeapon ? (w.usaDex ? 'dex' : 'for') : (w.usaFmen ? 'fmen' : (w.usaDex ? 'dex' : 'for'));
        const dannoTipo = (w.usaFmen && !isMixedWeapon) ? 'magico' : 'fisico';
        const base = { action: 'attack', kind: 'weapon', dannoTipo, dannoStat, dannoBase: Number(w.atk) || 0, dannoBase2: isMixedWeapon ? (Number(w.atk) || 0) : 0, effettoNome: w.effettoNome || '', effettoTratto: w.effettoTratto || '' };
        // 'tiro' (arma a distanza): per colpire usa sempre Mira, mai Arte
        // Combattiva — attiva anche la nuova difesa Destrezza/Difesa
        // Mentale + critico x2, vedi combatRollAttackAndDamage/Defense.
        if (w.weaponClass === 'tiro') {
          const payload = Object.assign({}, base, { label: w.name, attackTrait: 'Mira' });
          return combatSourceButtonHtml(payload, `${escapeHtml(w.name)} (Atk ${Number(w.atk) || 0})`);
        }
        // 'lancio' (arma da lancio): l'attaccante sceglie ad ogni attacco
        // se colpire corpo a corpo (Arte Combattiva o la specializzazione
        // dell'arma, vedi sotto) o a distanza (Lanciare, mai la
        // specializzazione — resta fisso) — in entrambi i casi la difesa
        // del bersaglio resta quella di un'arma bianca (Elusione/Difesa),
        // mai la nuova.
        if (w.weaponClass === 'lancio') {
          const meleePayload = Object.assign({}, base, { label: w.name, attackTrait: w.attackTraitName || 'Arte Combattiva' });
          const rangedPayload = Object.assign({}, base, { label: w.name, attackTrait: 'Lanciare' });
          return combatSourceButtonHtml(meleePayload, `${escapeHtml(w.name)} — corpo a corpo (Atk ${Number(w.atk) || 0})`)
            + combatSourceButtonHtml(rangedPayload, `${escapeHtml(w.name)} — a distanza (Atk ${Number(w.atk) || 0})`);
        }
        // Tratto di specializzazione (attackTraitName, es. "Arte marziale
        // Systema"): sostituisce "Arte Combattiva" nel tiro per colpire,
        // solo per armi non a distanza — vedi combatComputeAttackRoll.
        const payload = Object.assign({}, base, { label: w.name, attackTrait: w.attackTraitName || 'Arte Combattiva' });
        return combatSourceButtonHtml(payload, `${escapeHtml(w.name)} (Atk ${Number(w.atk) || 0})`);
      }).join('')
    : '<p class="helper-text" style="margin:0;">Nessuna arma equipaggiata.</p>';
  $('#combat-source-picker').classList.remove('hidden');
}

/* Righe di Tecniche/Abilità con una Durata impostata (diversa da
   "Gratuita"): materiale per applicare un effetto nel tempo sul bersaglio
   colpito (vedi apply_combat_effect) — Danno→danno nel tempo su HP,
   Supporto con un bonus su HP/MP→rigenerazione, ogni altro Supporto→buff
   informativo. Non serve un campo esplicito "tipo effetto" sulla scheda:
   si deduce da Tipo + Effetto già compilati (vedi tecAbRowIsComplete). */
function combatEffectRowsFor(data) {
  const rows = [];
  ['tecniche', 'abilita'].forEach(field => {
    (data[field] || []).forEach((r, i) => {
      if (!r.nome || !r.durata || r.durata === 'gratuita') return;
      const durataDef = AZIONE_DURATE.find(d => d.key === r.durata);
      if (!durataDef) return;
      const rowKind = field === 'tecniche' ? 'tecnica' : 'abilita';
      if (r.tipo === 'danno' && Number(r.dannoBase) > 0) {
        rows.push({ rowKind, rowId: r.id || '', index: i, label: r.nome, effectKind: 'danno', tickStat: 'hp', tickAmount: Number(r.dannoBase) || 0, durationKey: r.durata, durationQuarters: durataDef.quarti, durataLabel: durataDef.label, multiTarget: !!r.multiTarget });
        return;
      }
      // "Bonus fisso" (booleano) è sostituito da r.bonusMode ('fisso' di
      // default, 'scalante' o — solo su HP — 'sovracura'), solo Abilità
      // (le Tecniche restano sempre 'fisso'). 3 meccaniche DISTINTE su HP,
      // mai varianti l'una dell'altra:
      //  - 'fisso': cura fissa, importo scritto in scheda (Guarigione
      //    rapida) — regen normale, già istantaneo (apply_combat_effect).
      //  - 'scalante': cura che scala (dado + caratteristica, tirato al
      //    momento dell'attivazione — Guarigione maggiore) — VA DRITTA
      //    AGLI HP, mai uno scudo: stesso regen istantaneo di sopra, ma
      //    l'importo si tira solo al momento (vedi combatResolvePendingTarget/
      //    combatRollScaledAmount), non è già scritto qui.
      //  - 'sovracura': non un regen — un cuscinetto HP persistente,
      //    attivabile solo a HP pieni, che non scade a turni (vedi
      //    activateSovracuraTarget più sotto, mai apply_combat_effect).
      // Sul MP resta sempre un regen fisso (struttura incompatibile con un
      // singolo tiro/cuscinetto): mai interessato da bonusMode.
      const isDebuff = r.tipo === 'debuff';
      const primaryBonus = (r.bonusItems || []).find(it => it.listKey === 'primaria' && (it.name === 'hp' || it.name === 'mp'));
      const bonusMode = rowKind === 'abilita' ? (r.bonusMode || 'fisso') : 'fisso';
      if (!isDebuff && primaryBonus && primaryBonus.name === 'hp' && bonusMode === 'sovracura') {
        rows.push({ rowKind, rowId: r.id || '', index: i, label: r.nome, effectKind: 'sovracura', shieldBase: Math.abs(Number(primaryBonus.valore) || 0), scaleStat: r.scalaStat, durataLabel: 'Persistente, fino al riposo', multiTarget: !!r.multiTarget });
        return;
      }
      if (!isDebuff && primaryBonus && primaryBonus.name === 'hp' && bonusMode === 'scalante') {
        rows.push({ rowKind, rowId: r.id || '', index: i, label: r.nome, effectKind: 'regen', tickStat: 'hp', tickAmount: null, scaledRoll: true, shieldBase: Math.abs(Number(primaryBonus.valore) || 0), scaleStat: r.scalaStat, durationKey: r.durata, durationQuarters: durataDef.quarti, durataLabel: durataDef.label, multiTarget: !!r.multiTarget });
        return;
      }
      if (!isDebuff && primaryBonus) {
        rows.push({ rowKind, rowId: r.id || '', index: i, label: r.nome, effectKind: 'regen', tickStat: primaryBonus.name, tickAmount: Math.abs(Number(primaryBonus.valore) || 0), durationKey: r.durata, durationQuarters: durataDef.quarti, durataLabel: durataDef.label, multiTarget: !!r.multiTarget });
        return;
      }
      // Più tratti insieme (es. Infezione: -1 Guardia, -1 altro tratto): a
      // differenza del singolo buffTarget/buffAmount qui sotto (una sola
      // statistica primaria), qualunque voce bonus/malus su un TRATTO
      // (listKey diverso da 'primaria' — capacitaCombattive/capacitaNormali/
      // conoscenze) confluisce in trait_mods, applicato tutto insieme al
      // bersaglio scelto (vedi apply_combat_effect/combatTraitModTotal,
      // riusa lo stesso motore già costruito per le droghe a due fasi).
      // Tipo "Debuff": stesso campo bonus di un'Abilità di Supporto, ma il
      // valore inserito va SEMPRE applicato come malus al bersaglio scelto
      // (mai come buff), a prescindere dal segno digitato — su statistiche
      // primarie e tratti allo stesso modo. La normalizzazione avviene qui
      // (traitMods) e sul buffBase sotto; per il ramo scalabile, il segno va
      // rovesciato DOPO il tiro (combatResolvePendingTarget/MultiTargets),
      // perché combatRollScaledAmount forza sempre un risultato ≥0 (pensata
      // per scudi/cure/buff, mai per un malus).
      const traitItems = [...(r.bonusItems || []), ...(r.malusItems || [])]
        .filter(it => it.name && it.listKey && it.listKey !== 'primaria');
      if (traitItems.length) {
        rows.push({
          rowKind, rowId: r.id || '', index: i, label: r.nome, effectKind: 'buff',
          traitMods: traitItems.map(it => ({ listKey: it.listKey, name: it.name, valore: isDebuff ? -Math.abs(Number(it.valore) || 0) : (Number(it.valore) || 0) })),
          durationKey: r.durata, durationQuarters: durataDef.quarti, durataLabel: durataDef.label, multiTarget: !!r.multiTarget
        });
        return;
      }
      const anyBonus = (r.bonusItems || []).find(it => it.name);
      if (anyBonus) {
        // Come lo scudo (sopra): se scala, l'importo fisso è solo la base a
        // cui si somma un tiro in base alla caratteristica scelta sulla riga
        // (r.scalaStat, sempre Forza Mentale o Difesa Mentale — vedi effettoCellHtml)
        // al momento dell'attivazione (combatResolvePendingTarget/
        // combatRollScaledAmount).
        const scaleStat = r.scalaStat;
        const scalesBuff = bonusMode !== 'fisso';
        rows.push({
          rowKind, rowId: r.id || '', index: i, label: r.nome, effectKind: 'buff', buffTarget: anyBonus.name,
          buffAmount: scalesBuff ? null : (isDebuff ? -Math.abs(Number(anyBonus.valore) || 0) : (Number(anyBonus.valore) || 0)),
          scalable: scalesBuff, buffBase: Math.abs(Number(anyBonus.valore) || 0), scaleStat, debuff: isDebuff,
          durationKey: r.durata, durationQuarters: durataDef.quarti, durataLabel: durataDef.label, multiTarget: !!r.multiTarget
        });
      }
    });
  });
  return rows;
}

/* Tecniche/Abilità (a scelta di `field`), unificando in un'unica lista le
   righe istantanee di tipo Danno (attacco, ex openCombatSourcePicker) e
   quelle a durata (effetto, ex openCombatEffectSourcePicker/
   combatEffectRowsFor) — la scelta fra attacco/effetto e le regole di
   bersaglio si decidono al click (vedi payload.action). */
function combatTecAbSourcesFor(data, field) {
  const rowKind = field === 'tecniche' ? 'tecnica' : 'abilita';
  const sources = [];
  // Solo per le Tecniche: la prima arma equipaggiata con un proprio effetto
  // configurato "presta" quell'effetto all'attacco, in parallelo a quello
  // (eventuale) della Tecnica stessa — doppio tiro di stato indipendente,
  // vedi combatRollAttackAndDamage/submit_attack_defense_roll. Le
  // Abilità non hanno mai un'arma coinvolta (poteri magici).
  const weaponEffect = rowKind === 'tecnica'
    ? (data.weaponSlots || []).find(w => w.kind === 'arma' && w.equipaggiato !== false && w.effettoNome)
    : null;
  (data[field] || []).forEach((r, i) => {
    if (!r.nome || !String(r.nome).trim()) return;
    // Una riga "misto" usa la Durata per il solo lato Supporto (il
    // potenziamento a tempo, vedi combatEffectRowsFor) — l'attacco/effetto
    // resta sempre disponibile come azione istantanea indipendentemente da
    // quel valore, a differenza di una riga "danno" pura dove Durata!=
    // gratuita sposta l'intera riga sul danno-nel-tempo (combatEffectRowsFor).
    const isMisto = r.tipo === 'misto';
    if ((isMisto || !r.durata || r.durata === 'gratuita') && (r.tipo === 'danno' || isMisto) && Number(r.dannoBase) > 0) {
      sources.push({
        action: 'attack', kind: rowKind, rowId: r.id || '', index: i, label: r.nome, dannoTipo: r.dannoTipo, dannoStat: r.dannoStat, dannoBase: Number(r.dannoBase) || 0,
        // Danno misto (componente Magica secondaria): solo Abilità, vedi
        // dannoConfigHtml/makeAbilitaRow — 0/assente su Tecniche.
        dannoBase2: rowKind === 'abilita' ? (Number(r.dannoBase2) || 0) : 0,
        // Effetto opzionale (Rompere/Tramortire/nome libero) + tratto di
        // salvezza fissato dal Narratore sulla riga: portati fino a
        // declare_combat_attack, che li salva su combat_attacks (vedi
        // migrazione tecab_danno_effects) — mai per le armi, solo Tecniche/Abilità.
        effettoNome: r.effettoNome || '', effettoTratto: r.effettoTratto || '',
        // Bonus % al tiro di stato intrinseco della riga: solo Abilità
        // (vedi dannoConfigHtml/makeAbilitaRow), sempre 0/assente su Tecniche.
        effettoBonusPct: rowKind === 'abilita' ? (Number(r.effettoBonusPct) || 0) : 0,
        // Raggio d'area (celle esagonali): stesso trattamento Abilità-only
        // di effettoBonusPct — 0 = solo il bersaglio scelto (comportamento
        // invariato), vedi declare_combat_attack_aoe.
        raggioHex: rowKind === 'abilita' ? (Number(r.raggioHex) || 0) : 0,
        // Secondo effetto, dall'arma equipaggiata (solo Tecniche, vedi sopra).
        weaponEffettoNome: weaponEffect ? weaponEffect.effettoNome : '',
        weaponEffettoTratto: weaponEffect ? (weaponEffect.effettoTratto || '') : '',
        weaponLabel: weaponEffect ? weaponEffect.name : '',
        // Multi-bersaglio: proprietà della riga Tecnica/Abilità (mai per le
        // armi), vedi effettoCellHtml/declare_combat_attack_multi.
        multiTarget: !!r.multiTarget,
        // "Tiro doppio" applicato al danno: raddoppia il tiro di QUESTO
        // attacco (dado+statistica) quando la statistica scelta in "Tiro
        // doppio" combacia con quella EFFETTIVAMENTE usata per il Danno
        // della riga (dannoStatFor, non il campo grezzo r.dannoStat: sul
        // Magico il select Statistica di dannoConfigHtml resta nascosto,
        // quindi r.dannoStat può essere rimasto su un valore stantio mentre
        // il danno reale è sempre F.MEN) — nessuna scelta separata al
        // momento dell'attacco (unificato con la stessa select, ex checkbox
        // "X2 Forza/Destrezza", vedi effettoCellHtml/ensureDannoAttivaFields).
        // dannoStatFor ritorna null per l'Esplosivo (danno puro, nessuna
        // statistica sommata), quindi il confronto è già sempre false lì.
        // Stesso nome campo già letto da declare_combat_attack/
        // combatRollAttackAndDamage.
        dannoStatDoppio: !!r.doppioTiroStat && r.doppioTiroStat === dannoStatFor(r.dannoTipo, r.dannoStat)
      });
    }
    // "Danno fisso": azione istantanea a parte, mai attraverso
    // declare_combat_attack (vedi apply_danno_fisso/resolveDannoFisso) —
    // nessun dannoTipo/dannoStat/raggioHex/arma coinvolti, solo il valore
    // fisso più l'eventuale effetto.
    if (r.tipo === 'dannofisso' && Number(r.dannoBase) > 0) {
      sources.push({
        action: 'danno-fisso', kind: rowKind, rowId: r.id || '', index: i, label: r.nome, dannoBase: Number(r.dannoBase) || 0,
        effettoNome: r.effettoNome || '', effettoTratto: r.effettoTratto || '',
        effettoBonusPct: Number(r.effettoBonusPct) || 0
      });
    }
  });
  combatEffectRowsFor(data).filter(r => r.rowKind === rowKind).forEach(r => {
    const action = (r.effectKind === 'regen' || r.effectKind === 'scudo') ? 'effect-heal' : (r.effectKind === 'sovracura' ? 'effect-sovracura' : (r.effectKind === 'danno' ? 'effect-attack' : 'effect-buff'));
    sources.push(Object.assign({ action }, r));
  });
  return sources;
}

function combatTecAbSourceLabel(s) {
  if (s.action === 'attack' || s.action === 'danno-fisso') return escapeHtml(s.label);
  return `${combatEffectIcon(s.effectKind)} ${escapeHtml(s.label)}`;
}
/* Icona per l'effetto opzionale (Rompere/Tramortire/nome libero) di una
   riga a Danno: solo i due nomi riconosciuti hanno un'icona dedicata
   (stessa usata nell'esito dopo la salvezza, vedi combatEffectOutcomeHtml),
   un nome personalizzato resta con un simbolo generico. */
function combatTecAbEffectIcon(name) {
  const key = String(name || '').trim().toLowerCase();
  if (key === 'rompere') return '🔨';
  const status = percentContestStatusInfo(name);
  return status ? status.icon : '✦';
}
/* Dettaglio abbreviato mostrato a destra del nome, PRIMA di scegliere il
   bersaglio (menu Tecniche/Abilità in combattimento): danno+statistica come
   già in scheda (FRZ/DEX/F.MEN), più — se la riga ha un effetto configurato
   — icona+nome effetto e le prime 3 lettere del tratto di salvezza, per
   restare leggibile anche sullo schermo stretto di un telefono. */
function combatTecAbSourceDesc(s) {
  if (s.action === 'danno-fisso') {
    const base = `⚡${s.dannoBase} (ignora difese)`;
    if (!s.effettoNome) return escapeHtml(base);
    const trattoAbbr = String(s.effettoTratto || 'Resistenza').slice(0, 3).toUpperCase();
    return `${escapeHtml(base)} · ${combatTecAbEffectIcon(s.effettoNome)}${escapeHtml(s.effettoNome)}→${escapeHtml(trattoAbbr)}`;
  }
  if (s.action !== 'attack') return escapeHtml(s.durataLabel);
  const base = s.dannoTipo === 'esplosivo' ? `${s.dannoBase} 💥EXP`
    : `${s.dannoBase}+${DANNO_STAT_LABELS[dannoStatFor(s.dannoTipo, s.dannoStat)]}`;
  if (!s.effettoNome) return escapeHtml(base);
  const trattoAbbr = String(s.effettoTratto || 'Resistenza').slice(0, 3).toUpperCase();
  return `${escapeHtml(base)} · ${combatTecAbEffectIcon(s.effettoNome)}${escapeHtml(s.effettoNome)}→${escapeHtml(trattoAbbr)}`;
}

/* ---------------------------------------------------------- passaggio di livello */

/* A differenza di combatTecAbSourcesFor (solo le righe già utilizzabili
   come attacco/effetto in combattimento), qui basta che la Tecnica/
   Abilità esista in scheda: usarla per superare un passaggio non è un
   attacco né un effetto, ha sempre successo, spende solo il suo Tempo
   d'azione proprio (vedi attempt_combat_level_transition lato SQL). */
function combatLevelTransitionTecAbSources(data) {
  const list = [];
  (data.tecniche || []).forEach((r, i) => { if (r.nome && String(r.nome).trim()) list.push({ kind: 'tecnica', index: i, label: r.nome }); });
  (data.abilita || []).forEach((r, i) => { if (r.nome && String(r.nome).trim()) list.push({ kind: 'abilita', index: i, label: r.nome }); });
  return list;
}

function combatDoLevelTransition(characterId, source) {
  attemptCombatLevelTransition(combatViewEncounterId, characterId, source || null, null).then(result => {
    refreshCombatBoard();
    toast(result && result.success ? 'Passaggio riuscito!' : 'Passaggio non riuscito');
  }).catch(err => toast(describeError(err)));
}

/* Tiro sul tratto configurato dal Narratore sulla casella (d20+tratto,
   stessa formula/fiducia già in uso per "Tira per colpire" — vedi
   combatRollAttackAndDamage): calcolato qui dal client, il server confronta
   solo il totale con la Difficoltà. */
function combatRollLevelTransitionTrait(characterId, option) {
  const data = combatFindParticipantChar(characterId);
  if (!data) { toast('Dati del personaggio non disponibili'); return; }
  const traitValue = getTraitValue(data, option.traitList, option.traitName);
  const d20 = rollDie(20);
  const rollTotal = d20 + traitValue;
  attemptCombatLevelTransition(combatViewEncounterId, characterId, null, rollTotal).then(result => {
    refreshCombatBoard();
    const detail = `${option.traitName}: ${rollTotal} (d20:${d20}+${traitValue})`;
    toast(result && result.success ? `${detail} — passaggio riuscito!` : `${detail} — non basta, resti dove sei`);
  }).catch(err => toast(describeError(err)));
}

function combatLevelTransitionChooseOption(characterId, option) {
  if (option.action === 'level-transition-trait') combatRollLevelTransitionTrait(characterId, option);
  else combatDoLevelTransition(characterId, { kind: option.kind, index: option.index });
}

/* Al tocco del bottone "🪜 <etichetta>" nel pannello comandi: se il
   personaggio ha modo di scegliere (il tratto configurato e/o proprie
   Tecniche/Abilità), apre lo stesso picker sorgente già usato per
   Tecniche/Abilità in combattimento (vedi combatPendingLevelTransition nel
   suo click handler); altrimenti — nessuna Tecnica/Abilità e nessun tratto
   richiesto (es. una scala) — il passaggio è automatico. */
function openCombatLevelTransitionPicker(characterId) {
  const p = (combatState.participants || []).find(pp => pp.characterId === characterId);
  if (!p || p.levelId == null || p.hexCol == null || p.hexRow == null) { toast('Personaggio non posizionato'); return; }
  const transition = (combatState.transitions || []).find(t =>
    t.level_id === p.levelId && t.hex_col === p.hexCol && t.hex_row === p.hexRow);
  if (!transition) { toast('Nessun passaggio su questa casella'); return; }
  const data = combatFindParticipantChar(characterId);
  const tecAbSources = data ? combatLevelTransitionTecAbSources(data) : [];

  const options = [];
  if (transition.trait_name) {
    options.push({ action: 'level-transition-trait', traitList: transition.trait_list, traitName: transition.trait_name, difficulty: transition.difficulty });
  }
  tecAbSources.forEach(s => options.push({ action: 'level-transition-tecab', kind: s.kind, index: s.index, label: s.label }));

  if (!options.length) { combatDoLevelTransition(characterId, null); return; }
  if (options.length === 1) { combatLevelTransitionChooseOption(characterId, options[0]); return; }

  cancelPendingCombatAction();
  combatPendingLevelTransition = true;
  combatOwnActionsCharId = characterId;
  const list = $('#combat-source-list');
  list.innerHTML = options.map(o => combatSourceButtonHtml(o,
    o.action === 'level-transition-trait'
      ? `🎲 Tira ${escapeHtml(o.traitName)}${o.difficulty != null ? ' (Difficoltà ' + o.difficulty + ')' : ''}`
      : `✨ Usa "${escapeHtml(o.label)}" (${o.kind === 'tecnica' ? 'Tecnica' : 'Abilità'})`
  )).join('');
  $('#combat-source-picker').classList.remove('hidden');
}

function openCombatTecAbPicker(casterCharacterId, field) {
  const data = combatFindParticipantChar(casterCharacterId);
  if (!data) { toast('Dati del personaggio non disponibili'); return; }
  const sources = combatTecAbSourcesFor(data, field);
  cancelPendingCombatAction();
  const list = $('#combat-source-list');
  list.innerHTML = sources.length
    ? sources.map(s => combatSourceButtonHtml(s, combatTecAbSourceLabel(s), combatTecAbSourceDesc(s))).join('')
    : `<p class="helper-text" style="margin:0;">Nessuna ${field === 'tecniche' ? 'Tecnica' : 'Abilità'} disponibile per questo personaggio.</p>`;
  $('#combat-source-picker').classList.remove('hidden');
}

/* Boost: sempre e solo su se stessi, nessun target picker — stesso
   filtro "solo livelli appresi" di populateBoostActivateSelect
   (js/app.js), qui riletto sui dati del partecipante invece che sul DOM
   della scheda. */
function openCombatBoostPicker(characterId) {
  const data = combatFindParticipantChar(characterId);
  if (!data) { toast('Dati del personaggio non disponibili'); return; }
  // Checkpoint "Boost e pedina di combattimento", punto 2/5: elenca i Boost
  // NOMINATI confermati (non più i vecchi livelli generici c.boost[lv].
  // appreso), col nome reale — "IRA — Lv 3 — 24 PP", mai solo "Lv 3 — 24 PP".
  // Un solo Boost per personaggio (decisione definitiva, punto 2): se uno è
  // già attivo, non elenca alternative bloccate — mostra invece quale
  // Boost è attivo, mai una sostituzione silenziosa.
  const info = boostActiveInfoByCharacterId(characterId);
  const options = [];
  (data.boostRows || []).forEach(row => {
    if (info && info.rowId !== row.id) return;
    boostSelectableLevels(row).forEach(b => {
      options.push({ row, lv: b.lv });
    });
  });
  cancelPendingCombatAction();
  const list = $('#combat-source-list');
  list.innerHTML = options.length
    ? options.map(({ row, lv }) => combatSourceButtonHtml(
        { action: 'boost', rowId: row.id, lv },
        `${row.nome || 'Boost'} — Lv ${lv} — ${boostActivationCost(row, lv)} PP`
      )).join('')
    : info
      ? `<p class="helper-text" style="margin:0;">Hai già ${escapeHtml(info.label || 'un Boost')} attivo: un solo Boost alla volta.</p>`
      : '<p class="helper-text" style="margin:0;">Nessun Boost confermato per questo personaggio.</p>';
  $('#combat-source-picker').classList.remove('hidden');
}

/* Oggetti a consumo: sempre e solo su se stessi (comportamento già così
   sulla scheda, useConsumable), nessun target picker. Elenco letto
   direttamente dal personaggio LOCALE (non dai dati del partecipante sul
   tabellone, che sono lo snapshot cloud): useConsumable applica per indice
   su quello stesso array, un indice preso da un array diverso (anche solo
   temporaneamente fuori sincrono) punterebbe all'oggetto sbagliato. */
function openCombatItemPicker(characterId) {
  const localChar = characters.find(ch => ch.cloudCharacterId === characterId);
  if (!localChar) { toast('Personaggio non trovato su questo dispositivo'); return; }
  const items = (localChar.consumabili || [])
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => it.nome && Number(it.quantita) > 0);
  cancelPendingCombatAction();
  const list = $('#combat-source-list');
  list.innerHTML = items.length
    ? items.map(({ it, index }) => combatSourceButtonHtml({ action: 'item', index, label: it.nome }, `${escapeHtml(it.nome)} ×${Number(it.quantita) || 0}`)).join('')
    : '<p class="helper-text" style="margin:0;">Nessun oggetto disponibile per questo personaggio.</p>';
  $('#combat-source-picker').classList.remove('hidden');
}

/* Non mostra più una tendina con l'elenco dei bersagli: il click diretto
   sul token pulsante (glow-in/glow-out, classe combat-token-targetable
   aggiunta da renderCombatMap in base a combatPendingTargetInfo) sostituisce
   la scelta da lista. Questa funzione resta responsabile di impostare lo
   stato pendente, mostrare la barra non bloccante (solo per il selettore
   "parte del corpo" e gli eventuali bersagli non posizionati sulla mappa,
   senza token da toccare) e far ridisegnare la mappa coi nuovi glow. */
function openCombatTargetPicker(attackerCharacterId, source, opts) {
  const isAttack = !combatPendingEffect && source.action === 'attack';
  const includeSelf = !!(opts && opts.includeSelf);
  if (combatPendingEffect) combatPendingEffect = { casterCharacterId: attackerCharacterId, payload: source, includeSelf };
  else combatPendingAttack = { attackerCharacterId, source };
  combatSelectedMultiTargets = new Set();
  // Una pedina lasciata "selezionata per il movimento" (anello arancione
  // statico, mai completata con un tap su una cella) non ha più senso ora
  // che si sta scegliendo un bersaglio: oltre al bug di movimento fantasma
  // già bloccato nel click handler della mappa, l'anello resterebbe acceso
  // insieme al glow pulsante dei bersagli validi, confondendo i due stati.
  combatSelectedTokenCharId = null;
  const isMulti = !!source.multiTarget;
  // Parte del corpo mirata: scelta opzionale ad ogni ATTACCO (non per
  // effetti nel tempo), serve solo a far scattare il critico x2 di
  // Congelare se combacia con la parte già congelata sul bersaglio.
  const bodyPartWrap = $('#combat-target-bodypart-wrap');
  const bodyPartSelect = $('#combat-target-bodypart');
  if (isAttack) {
    bodyPartWrap.classList.remove('hidden');
    bodyPartSelect.innerHTML = '<option value="">Nessuna (generico)</option>'
      + ARMOR_LOCATIONS.map(loc => `<option value="${escapeHtml(loc)}">${escapeHtml(loc)}</option>`).join('');
    bodyPartSelect.value = '';
  } else {
    bodyPartWrap.classList.add('hidden');
  }
  renderCombatTargetUnplacedList(attackerCharacterId, includeSelf);
  $('#combat-target-multi-confirm').classList.toggle('hidden', !isMulti);
  updateCombatMultiConfirmLabel();
  $('#combat-target-hint-text').textContent = isMulti
    ? 'Tocca i bersagli sulla mappa (uno o più), poi premi "Conferma bersagli"'
    : (includeSelf ? 'Tocca il bersaglio sulla mappa (anche te stesso)' : 'Tocca il bersaglio sulla mappa');
  $('#combat-target-hint').classList.remove('hidden');
  renderCombatMap();
}
/* Elenco supplementare dei bersagli senza una posizione sulla mappa (raro):
   nessun token da toccare lì, restano raggiungibili da questi bottoni —
   estratto a parte da openCombatTargetPicker perché va ridisegnato anche
   ad ogni toggle di una selezione multi-bersaglio (per riflettere lo stato
   "già scelto"), senza dover riaprire l'intero picker (che azzererebbe la
   selezione in corso). */
function renderCombatTargetUnplacedList(attackerCharacterId, includeSelf) {
  const unplaced = (combatState.participants || []).filter(p =>
    (includeSelf || p.characterId !== attackerCharacterId) && (p.hexCol == null || p.hexRow == null));
  const unplacedWrap = $('#combat-target-unplaced-wrap');
  $('#combat-target-unplaced-list').innerHTML = unplaced.map(p => {
    const picked = combatIsMultiTargetSelected(p.characterId);
    return `<button type="button" class="btn ${picked ? 'btn-primary' : 'btn-ghost'} btn-sm" data-combattargetpick="${p.characterId}">${picked ? '✔ ' : ''}${escapeHtml(combatParticipantName(p))} (Lv ${p.level})</button>`;
  }).join('');
  unplacedWrap.classList.toggle('hidden', unplaced.length === 0);
}
function updateCombatMultiConfirmLabel() {
  const btn = $('#combat-target-multi-confirm');
  if (!btn) return;
  const n = combatSelectedMultiTargets.size;
  btn.textContent = n > 0 ? `Conferma bersagli (${n})` : 'Conferma bersagli';
  btn.disabled = n === 0;
}
/* Toggle di un bersaglio in una selezione multi-bersaglio: aggiunge/rimuove
   invece di risolvere subito (vedi combatResolvePendingTarget per il
   percorso a bersaglio singolo) — la conferma esplicita spetta al bottone
   "Conferma bersagli" (combatResolvePendingMultiTargets). */
function combatToggleMultiTarget(characterId) {
  const info = combatPendingTargetInfo();
  if (!info || !info.multiTarget) return;
  if (combatSelectedMultiTargets.has(characterId)) combatSelectedMultiTargets.delete(characterId);
  else combatSelectedMultiTargets.add(characterId);
  updateCombatMultiConfirmLabel();
  renderCombatTargetUnplacedList(info.attackerCharacterId, info.includeSelf);
  renderCombatMap();
}
/* Magnitudine di un bonus Supporto "Extra" (Abilità, vedi effettoCellHtml/
   combatEffectRowsFor: scudo su HP, o un buff su qualunque altra
   statistica/tratto): importo fisso già inserito sulla riga + un vero tiro
   scalato sulla caratteristica del CASTER — stesso dado-per-magnitudine già
   usato dal Danno (dannoConfigHtml/diceForValue: d4/d6/d8/d12/d12+d8 in
   base al valore) + la caratteristica stessa sommata di nuovo, non un d20
   fisso — ricalcolato da capo a ogni attivazione, mai riusato da una
   precedente. statKey è quella scelta sulla riga (r.scalaStat) o, se non
   impostata, 'fmen' (Forza Mentale, il caso comune) / 'dmen' (Difesa
   Mentale, quando il bonus è su Difesa/Difesa Mentale — vedi
   combatEffectRowsFor). Letto da combatState.participants (fresco dal
   server) invece che dall'array locale characters, così funziona anche se
   il caster non è caricato per intero su questo dispositivo. */
function rollScaledAmountFromData(data, casterCharacterId, baseValue, statKey) {
  const base = Math.max(0, Number(baseValue) || 0);
  if (!data) return base;
  const key = statKey || 'fmen';
  const statTotal = Math.round((Number(data.primary && data.primary[key]) || 0) * statModMultiplier(casterCharacterId, key)) + buffTotal(data, key);
  const diceLabel = diceForValue(statTotal);
  let dieRoll;
  if (diceLabel === 'd12+d8') {
    dieRoll = rollDie(12) + rollDie(8);
  } else {
    dieRoll = rollDie(Number(diceLabel.slice(1)));
  }
  return Math.max(0, base + dieRoll + statTotal);
}
function combatRollScaledAmount(casterCharacterId, baseValue, statKey) {
  const caster = (combatState.participants || []).find(pp => pp.characterId === casterCharacterId);
  return rollScaledAmountFromData(caster && caster.data, casterCharacterId, baseValue, statKey);
}
/* Stessa formula di combatRollScaledAmount, ma FUORI da un incontro attivo:
   legge direttamente il personaggio locale invece di combatState.participants
   (che esiste solo dentro una vista di combattimento) — usata da Sovracura
   quando attivata dal fronte scheda. statModMultiplier/buffTotal restano
   sicuri da chiamare anche qui: senza un incontro attivo semplicemente non
   trovano alcun modificatore da droghe/stati, moltiplicatore neutro (1x). */
function rollScaledAmountLocal(c, baseValue, statKey) {
  return rollScaledAmountFromData(c, c.cloudCharacterId || c.id, baseValue, statKey);
}
/* Sovracura (in combattimento): un sistema a parte, MAI apply_combat_effect
   — nessuna riga combat_active_effects, nessuna durata a turni. Tira qui
   (stessa formula di combatRollScaledAmount) e invia già pronto il totale
   alla RPC dedicata (activate_sovracura), che verifica di nuovo server-side
   che il bersaglio sia a HP pieni (mai fidarsi del solo client) e somma il
   risultato a characters.data.hpBuffer. */
async function activateSovracuraTarget(encounterId, casterCharacterId, targetCharacterId, payload) {
  const rolled = combatRollScaledAmount(casterCharacterId, payload.shieldBase, payload.scaleStat || 'fmen');
  const newBuffer = await activateSovracura(encounterId, casterCharacterId, targetCharacterId,
    { characterId: casterCharacterId, kind: payload.rowKind, rowId: payload.rowId || null, index: payload.index, label: payload.label }, rolled);
  toast(`🔷 Sovracura: +${rolled} cuscinetto HP a ${combatCharNameById(targetCharacterId)} (totale ${newBuffer})`);
}
/* Attribuisce l'attacco/effetto pendente al bersaglio scelto (click sul
   token pulsante in mappa, o sul piccolo elenco supplementare per i
   bersagli non posizionati): stesso corpo che prima viveva nel listener di
   #combat-target-list, ora richiamabile da entrambi i punti d'ingresso. */
/* "Danno fisso": risolve un'azione istantanea che bypassa completamente la
   catena declare_combat_attack/submit_attack_rolls/
   submit_attack_defense_roll (vedi apply_danno_fisso) — il chiamante ha
   già accesso ai dati live di entrambi i partecipanti, quindi calcola qui
   in un colpo solo l'eventuale tiro di stato (stesse formule già in uso in
   combatRollAttackAndDamage/combatStatusResistRoll) e lo invia già pronto,
   senza una seconda fase "in attesa del bersaglio" che romperebbe
   l'istantaneità. Mai un tracking d'uso automatico (stesso trattamento di
   ogni altro Danno: solo il bottone "+1" in scheda). */
async function resolveDannoFisso(encounterId, attackerCharacterId, targetCharacterId, source) {
  const attackerData = combatFindParticipantChar(attackerCharacterId);
  const targetData = combatFindParticipantChar(targetCharacterId);
  if (!attackerData || !targetData) { toast('Dati del personaggio non disponibili'); return; }
  let statusAttackerRoll = null, statusAttackerDetail = null, statusDefenderRoll = null, statusDefenderDetail = null;
  const statusMatch = percentContestStatusInfo(source.effettoNome);
  if (statusMatch) {
    const equipBonus = equipBonusTotal(attackerData, 'status', statusMatch.key);
    const drugBonus = statusRollBonus(attackerCharacterId, statusMatch.key);
    const abilityBonus = Number(source.effettoBonusPct) || 0;
    const totalBonus = equipBonus + drugBonus + abilityBonus;
    const d100 = rollDie(100, `Stato: ${statusMatch.label} (d100)`);
    statusAttackerRoll = d100 + totalBonus;
    statusAttackerDetail = totalBonus ? `d100:${d100} +${totalBonus} (${statusMatch.label})` : `d100: ${d100}`;
    const r = combatStatusResistRoll(targetData, targetCharacterId, source.effettoTratto || 'Resistenza', statusMatch.key, `Stato: ${statusMatch.label}`, null);
    statusDefenderRoll = r.total; statusDefenderDetail = r.detail;
  }
  try {
    await applyDannoFisso(encounterId, attackerCharacterId, targetCharacterId, source, statusAttackerRoll, statusAttackerDetail, statusDefenderRoll, statusDefenderDetail);
    await refreshCombatBoard();
    toast(`⚡ Danno fisso: ${source.dannoBase} a ${combatCharNameById(targetCharacterId)}`);
  } catch (err) { toast(describeErrorWithContext('Errore nell\'applicare il danno fisso', err)); renderCombatMap(); }
}
async function combatResolvePendingTarget(targetId) {
  if (!(combatPendingAttack || combatPendingEffect)) return;
  // resolutionState: una richiesta è già in volo (tap doppio/rapido sullo
  // stesso o su un altro token) — non partirne una seconda, mai.
  if (combatActionResolving) return;
  $('#combat-target-hint').classList.add('hidden');
  if (combatPendingEffect) {
    // pendingAction → confirmedAction QUI, prima di qualunque attesa di
    // rete: un secondo tap durante l'attesa non troverà più nulla di
    // pendente su cui agire, e una risposta tardiva non potrà mai
    // "riaprire" questo stato (taskFn sotto lavora solo su variabili
    // locali già catturate).
    const { casterCharacterId, payload } = combatPendingEffect;
    combatPendingEffect = null;
    await resolveConfirmedCombatAction(async () => {
      // Sovracura: NON passa da applyCombatEffect/apply_combat_effect (niente
      // riga combat_active_effects, niente durata a turni) — un sistema a
      // parte, vedi activateSovracuraTarget.
      if (payload.effectKind === 'sovracura') {
        try {
          await activateSovracuraTarget(combatViewEncounterId, casterCharacterId, targetId, payload);
          const localChar = characters.find(ch => ch.cloudCharacterId === casterCharacterId);
          if (localChar) logTecnicaAbilitaUsageFor(localChar, payload.rowKind === 'tecnica' ? 'tecniche' : 'abilita', payload.index);
          await refreshCombatBoard();
        } catch (err) { toast(describeErrorWithContext('Errore nell\'attivare Sovracura', err)); renderCombatMap(); }
        return;
      }
      try {
        const shieldHp = payload.effectKind === 'scudo' ? combatRollScaledAmount(casterCharacterId, payload.shieldBase, payload.scaleStat || 'fmen') : null;
        // Guarigione maggiore ("Cura scalante"): il tickAmount non è ancora
        // scritto sulla riga (payload.scaledRoll), va tirato solo ora — stessa
        // formula/funzione già usata per scudi e buff scalabili, applicata
        // però dritta agli HP tramite il regen istantaneo esistente, mai come
        // scudo (vedi combatEffectRowsFor).
        const tickAmount = payload.scaledRoll ? combatRollScaledAmount(casterCharacterId, payload.shieldBase, payload.scaleStat || 'fmen') : payload.tickAmount;
        let buffAmount = payload.scalable ? combatRollScaledAmount(casterCharacterId, payload.buffBase, payload.scaleStat) : payload.buffAmount;
        // combatRollScaledAmount ritorna sempre ≥0 (pensata per buff/cure): un
        // Debuff scalabile va reso negativo solo ORA, dopo il tiro — per un
        // debuff non scalabile buffAmount è già negativo da combatEffectRowsFor,
        // -Math.abs è quindi innocuo (idempotente) in entrambi i casi.
        if (payload.debuff && buffAmount != null) buffAmount = -Math.abs(buffAmount);
        await applyCombatEffect(
          combatViewEncounterId, targetId,
          { characterId: casterCharacterId, kind: payload.rowKind, rowId: payload.rowId || null, index: payload.index, label: payload.label },
          payload.effectKind, payload.buffTarget, buffAmount, payload.tickStat, tickAmount, payload.durationKey,
          payload.durationQuarters, payload.traitMods, shieldHp
        );
        // Conta come utilizzo qualunque applicazione reale dell'effetto,
        // incluso 'danno' (danno nel tempo, vedi combatEffectRowsFor): il
        // vecchio bottone manuale "+1" che copriva questo caso non esiste
        // più (vedi utilizziCellHtml) — attivare l'effetto è l'utilizzo,
        // indipendentemente dal tipo, stesso principio già in uso per
        // Supporto/Sovracura/Cura/Contrattacco.
        {
          const localChar = characters.find(ch => ch.cloudCharacterId === casterCharacterId);
          if (localChar) logTecnicaAbilitaUsageFor(localChar, payload.rowKind === 'tecnica' ? 'tecniche' : 'abilita', payload.index);
        }
        await refreshCombatBoard();
        toast(shieldHp != null ? `🛡️ Scudo ${shieldHp} PS: ${payload.label}`
          : payload.scaledRoll ? `💚 ${payload.label}: +${tickAmount} HP`
          : payload.scalable ? `${payload.debuff ? '☠️' : '✨'} ${payload.label}: ${buffAmount >= 0 ? '+' : ''}${buffAmount} ${payload.buffTarget}`
          : 'Effetto applicato: ' + payload.label);
      } catch (err) { toast(describeErrorWithContext('Errore nell\'applicare l\'effetto', err)); renderCombatMap(); }
    });
    return;
  }
  // Stesso principio per l'attacco: attaccante e source catturati ORA,
  // combatPendingAttack azzerato SUBITO (prima dell'attesa), mai dopo —
  // era il difetto reale (doppio invio possibile) confermato leggendo
  // questa funzione durante l'audit.
  const attackerCharacterId = combatPendingAttack.attackerCharacterId;
  const source = combatBuildResolvedAttackSource(combatPendingAttack.source);
  combatPendingAttack = null;
  await resolveConfirmedCombatAction(async () => {
    try {
      if (source.action === 'danno-fisso') {
        await resolveDannoFisso(combatViewEncounterId, attackerCharacterId, targetId, source);
        combatLogAttackUsage(attackerCharacterId, source);
        return;
      }
      // Raggio d'area (solo Abilità, vedi combatTecAbSourcesFor): il
      // bersaglio scelto qui resta l'"ancora", il server trova da sé tutti
      // gli altri partecipanti entro raggio sulla stessa mappa/livello e
      // crea un attacco per ciascuno — nessuna nuova UI di coda, la board
      // mostra un attacco attivo alla volta (activeCombatAttack) e li
      // risolve in sequenza con la stessa interfaccia di sempre.
      if (Number(source.raggioHex) > 0) {
        await declareCombatAttackAoe(combatViewEncounterId, attackerCharacterId, targetId, source, Number(source.raggioHex));
      } else {
        await declareCombatAttack(combatViewEncounterId, attackerCharacterId, targetId, source);
      }
      combatLogAttackUsage(attackerCharacterId, source);
      await refreshCombatBoard();
    } catch (err) { toast(describeErrorWithContext('Errore nella dichiarazione dell\'attacco', err)); renderCombatMap(); }
  });
}
/* Registra un utilizzo per un attacco reale (Danno/Misto/DannoFisso di
   Tecnica o Abilità) dichiarato con successo in combattimento — colma il
   buco storico "nessun auto-tracking per gli attacchi" (il vecchio bottone
   manuale "+1" nella cella Utilizzi, ora rimosso, era l'unica via prima di
   questo checkpoint): stesso principio già in uso per Supporto/Sovracura/
   Cura/Contrattacco (l'azione stessa è l'utilizzo, indipendentemente
   dall'esito del tiro). source.kind è 'tecnica'/'abilita' solo quando
   l'attacco viene davvero da una riga (mai per un'arma pura, kind:'weapon'
   — vedi combatTecAbSourcesFor). */
function combatLogAttackUsage(attackerCharacterId, source) {
  if (source.kind !== 'tecnica' && source.kind !== 'abilita') return;
  const localChar = characters.find(ch => ch.cloudCharacterId === attackerCharacterId);
  if (localChar) logTecnicaAbilitaUsageFor(localChar, source.kind === 'tecnica' ? 'tecniche' : 'abilita', source.index);
}
/* Applica alla source dell'attacco pendente la scelta fatta nella barra di
   targeting (parte del corpo) subito prima di dichiararlo — condivisa fra
   bersaglio singolo e multi. Il raddoppio danno ("Tiro doppio") è già
   deciso sulla riga stessa (vedi combatTecAbSourcesFor), nessuna scelta
   aggiuntiva qui. */
function combatBuildResolvedAttackSource(baseSource) {
  const bodyPart = $('#combat-target-bodypart') ? $('#combat-target-bodypart').value : '';
  return bodyPart ? Object.assign({}, baseSource, { targetedBodyPart: bodyPart }) : baseSource;
}
/* Variante "Conferma bersagli" di combatResolvePendingTarget: applica
   l'attacco/effetto pendente a TUTTI i personaggi accumulati in
   combatSelectedMultiTargets (vedi combatToggleMultiTarget), con un solo
   costo dedotto dal budget di turno (declare_combat_attack_multi/
   apply_combat_effect_multi, stesso principio già in uso per l'AoE a
   raggio). Richiamata solo dal bottone "Conferma bersagli", mai dal click
   su un singolo token (quello passa sempre da combatToggleMultiTarget
   quando la riga sorgente ha multiTarget attivo). */
async function combatResolvePendingMultiTargets() {
  if (!(combatPendingAttack || combatPendingEffect)) return;
  // resolutionState: doppio click su "Conferma bersagli" — non partirne
  // una seconda richiesta mentre la prima è ancora in volo.
  if (combatActionResolving) return;
  const targetIds = Array.from(combatSelectedMultiTargets);
  if (!targetIds.length) { toast('Scegli almeno un bersaglio sulla mappa'); return; }
  $('#combat-target-hint').classList.add('hidden');
  combatSelectedMultiTargets = new Set();
  if (combatPendingEffect) {
    // pendingAction → confirmedAction QUI, prima dell'attesa di rete.
    const { casterCharacterId, payload } = combatPendingEffect;
    combatPendingEffect = null;
    await resolveConfirmedCombatAction(async () => {
      // Sovracura: nessuna RPC "multi" dedicata (attivazione rara, quasi
      // sempre un solo bersaglio) — un'attivazione per bersaglio, in
      // sequenza, riusando la stessa funzione del percorso a bersaglio
      // singolo (gate "solo a HP pieni" verificato per ciascuno, un
      // bersaglio già pieno di HP non blocca gli altri).
      if (payload.effectKind === 'sovracura') {
        let okCount = 0;
        for (const tId of targetIds) {
          try {
            await activateSovracuraTarget(combatViewEncounterId, casterCharacterId, tId, payload);
            okCount++;
          } catch (err) { toast(`${describeError(err)} (${combatCharNameById(tId)})`); }
        }
        if (okCount) {
          const localChar = characters.find(ch => ch.cloudCharacterId === casterCharacterId);
          if (localChar) logTecnicaAbilitaUsageFor(localChar, payload.rowKind === 'tecnica' ? 'tecniche' : 'abilita', payload.index);
        }
        await refreshCombatBoard();
        return;
      }
      try {
        const shieldHp = payload.effectKind === 'scudo' ? combatRollScaledAmount(casterCharacterId, payload.shieldBase, payload.scaleStat || 'fmen') : null;
        const tickAmount = payload.scaledRoll ? combatRollScaledAmount(casterCharacterId, payload.shieldBase, payload.scaleStat || 'fmen') : payload.tickAmount;
        let buffAmount = payload.scalable ? combatRollScaledAmount(casterCharacterId, payload.buffBase, payload.scaleStat) : payload.buffAmount;
        if (payload.debuff && buffAmount != null) buffAmount = -Math.abs(buffAmount);
        await applyCombatEffectMulti(
          combatViewEncounterId, targetIds,
          { characterId: casterCharacterId, kind: payload.rowKind, rowId: payload.rowId || null, index: payload.index, label: payload.label },
          payload.effectKind, payload.buffTarget, buffAmount, payload.tickStat, tickAmount, payload.durationKey,
          payload.durationQuarters, payload.traitMods, shieldHp
        );
        if (payload.effectKind !== 'danno') {
          const localChar = characters.find(ch => ch.cloudCharacterId === casterCharacterId);
          if (localChar) logTecnicaAbilitaUsageFor(localChar, payload.rowKind === 'tecnica' ? 'tecniche' : 'abilita', payload.index);
        }
        await refreshCombatBoard();
        toast(shieldHp != null ? `🛡️ Scudo ${shieldHp} PS su ${targetIds.length} bersagli: ${payload.label}`
          : payload.scaledRoll ? `💚 ${payload.label}: +${tickAmount} HP su ${targetIds.length} bersagli`
          : payload.scalable ? `${payload.debuff ? '☠️' : '✨'} ${payload.label}: ${buffAmount >= 0 ? '+' : ''}${buffAmount} ${payload.buffTarget} su ${targetIds.length} bersagli`
          : `Effetto applicato a ${targetIds.length} bersagli: ${payload.label}`);
      } catch (err) { toast(describeErrorWithContext('Errore nell\'applicare l\'effetto', err)); renderCombatMap(); }
    });
    return;
  }
  const attackerCharacterId = combatPendingAttack.attackerCharacterId;
  const source = combatBuildResolvedAttackSource(combatPendingAttack.source);
  combatPendingAttack = null;
  await resolveConfirmedCombatAction(async () => {
    try {
      await declareCombatAttackMulti(combatViewEncounterId, attackerCharacterId, targetIds, source);
      combatLogAttackUsage(attackerCharacterId, source);
      await refreshCombatBoard();
      toast(`Attacco dichiarato su ${targetIds.length} bersagli`);
    } catch (err) { toast(describeErrorWithContext('Errore nella dichiarazione dell\'attacco', err)); renderCombatMap(); }
  });
}

/* Select "Durata" del modale Effetto libero: stesso vocabolario di
   AZIONE_DURATE usato in scheda, "Gratuita" esclusa (nessun effetto da
   tracciare qui, vedi apply_combat_effect lato server). */
function populateAzioneDurataSelect(sel) {
  sel.innerHTML = AZIONE_DURATE.filter(d => d.key !== 'gratuita')
    .map(d => `<option value="${d.key}">${escapeHtml(d.label)}</option>`).join('');
}
function updateFreeEffectFieldsVisibility() {
  const isBuff = $('#combat-freeeffect-kind').value === 'buff';
  $('#combat-freeeffect-tick-fields').classList.toggle('hidden', isBuff);
  $('#combat-freeeffect-buff-fields').classList.toggle('hidden', !isBuff);
}

function openCombatRevealPicker(characterId) {
  combatRevealTargetId = characterId;
  const p = (combatState.participants || []).find(pp => pp.characterId === characterId);
  const revealed = p ? p.revealed : null;
  const list = $('#combat-reveal-list');
  list.innerHTML = COMBAT_REVEALABLE_FIELDS.map(f =>
    `<label class="chk-inline"><input type="checkbox" data-revealfield="${escapeHtml(f.key)}" ${combatFieldIsRevealed(revealed, f.key) ? 'checked' : ''}> ${escapeHtml(f.label)}</label>`
  ).join('');
  $('#combat-reveal-picker').classList.remove('hidden');
}

/* ---------------------------------------------------------- event wiring */

function wireCombatView() {
  $('#btn-end-combat').addEventListener('click', async () => {
    if (!combatViewEncounterId) return;
    try {
      await endCombatEncounter(combatViewEncounterId);
      $('#combat-scene-modal').classList.add('hidden');
      resetCombatMapManagerState();
      // get_combat_board non filtra per status: un semplice refresh avrebbe
      // ririnviato lo stesso encounter (ormai 'ended'), lasciando la vista
      // "incastrata" sul combattimento appena chiuso invece di proporre
      // "Avvia combattimento". Si riparte da capo come all'apertura della
      // vista, così la ricerca del combattimento in corso (che ignora
      // 'ended') non trova più nulla e mostra subito lo stato vuoto.
      stopCombatRealtimeWatch();
      combatViewEncounterId = null;
      combatState = null;
      // Aggiorna la board SUBITO (round/toolbar/pedine spariscono anche se
      // la richiesta sotto fallisce): loadCombatEncounterForCampaign fa lo
      // stesso lavoro solo se la sua query va a buon fine, e in caso di
      // intoppo di rete il suo try/catch la assorbe in silenzio (solo un
      // toast), lasciando la schermata bloccata sul combattimento vecchio
      // nonostante fosse già davvero terminato lato server.
      renderCombatBoard();
      await loadCombatEncounterForCampaign(combatViewCampaignId);
      toast('Combattimento terminato: puoi avviarne uno nuovo quando vuoi');
    } catch (err) { toast(describeError(err)); }
  });

  // ---- frecce ▲/▼ per cambiare il livello mostrato (fra quelli noti) ----
  $('#combat-level-arrows').addEventListener('click', e => {
    if (e.target.closest('#combat-level-up')) { combatShiftViewLevel(1); return; }
    if (e.target.closest('#combat-level-down')) { combatShiftViewLevel(-1); return; }
  });

  // ---- banner "Fine" della modalità piazzamento passaggi/ostacoli ----
  $('#combat-placement-banner-done').addEventListener('click', () => {
    combatLevelPlacementMode = null;
    updateCombatPlacementBanner();
  });

  // ---- modale "Nuovo passaggio" (Gestisci scena) ----
  $('#combat-transition-trait').addEventListener('change', () => {
    $('#combat-transition-difficulty-field').classList.toggle('hidden', !$('#combat-transition-trait').value);
  });
  $('#combat-transition-cancel').addEventListener('click', () => $('#combat-transition-modal').classList.add('hidden'));
  $('#combat-transition-confirm').addEventListener('click', () => {
    const label = $('#combat-transition-label').value.trim() || 'Passaggio';
    const targetLevelId = $('#combat-transition-target-level').value;
    if (!targetLevelId) { toast('Scegli un livello di destinazione'); return; }
    const traitRaw = $('#combat-transition-trait').value;
    const traitList = traitRaw ? traitRaw.split('::')[0] : null;
    const traitName = traitRaw ? traitRaw.split('::')[1] : null;
    const difficulty = traitRaw ? (Number($('#combat-transition-difficulty').value) || 0) : null;
    const actionCost = Math.max(1, Number($('#combat-transition-cost').value) || 4);
    $('#combat-transition-modal').classList.add('hidden');
    // Senza questo, "Gestisci scena" restava sopra la mappa (mai nascosta
    // qui, a differenza di startCombatObstaclePlacement) e ne bloccava
    // ogni tocco: il piazzamento sembrava "non funzionare", in realtà le
    // celle non ricevevano mai il tap.
    $('#combat-scene-modal').classList.add('hidden');
    startCombatTransitionPlacement(combatTransitionSourceLevelId, targetLevelId, { label, traitList, traitName, difficulty, actionCost });
  });

  // ---- "Avanza turno" (Narratore): unico trigger che fa scendere i
  // countdown degli effetti attivi, applicando regen/danno nel frattempo ----
  $('#btn-advance-round').addEventListener('click', async () => {
    if (!combatViewEncounterId) return;
    try {
      const result = await advanceCombatRound(combatViewEncounterId);
      await refreshCombatBoard();
      toast(combatTicksToast('Turno avanzato', result));
    } catch (err) { toast(describeError(err)); }
  });

  $('#combat-turn-banner').addEventListener('click', async e => {
    if (!e.target.closest('#combat-turn-banner-pass') || !combatViewEncounterId) return;
    const enc = combatState && combatState.encounter;
    const activeId = enc && enc.current_turn_participant_id;
    const p = activeId && (combatState.participants || []).find(pp => pp.participantId === activeId);
    if (!p) return;
    try {
      const result = await passCombatTurn(combatViewEncounterId, p.characterId);
      await refreshCombatBoard();
      toast(combatTicksToast('Turno passato', result));
    } catch (err) { toast(describeError(err)); }
  });

  $('#combat-staging-panel').addEventListener('click', async e => {
    if (e.target.closest('#btn-start-combat')) {
      try {
        resetCombatMapManagerState();
        const enc = await startCombatEncounter(combatViewCampaignId, null);
        combatViewEncounterId = enc.id;
        startCombatRealtimeWatch(combatViewEncounterId, onCombatRealtimeChange);
        await refreshCombatBoard();
      } catch (err) { toast(describeError(err)); }
      return;
    }
    if (e.target.closest('#btn-roll-initiative')) { await combatRollAndSendInitiative(); return; }
  });
  $('#combat-staging-panel').addEventListener('change', async e => {
    const chk = e.target.closest('[data-stagechar]');
    if (!chk || !combatViewEncounterId) return;
    try {
      if (chk.checked) await stageCombatCharacter(combatViewEncounterId, chk.dataset.stagechar);
      else await unstageCombatCharacter(combatViewEncounterId, chk.dataset.stagechar);
      await refreshCombatBoard();
    } catch (err) { toast(describeError(err)); chk.checked = !chk.checked; }
  });

  // ---- board: tap una pedina per selezionarla, tap una cella per spostarla ----
  $('#combat-map').addEventListener('click', e => {
    // ---- piazzamento passaggi/ostacoli (Gestisci scena): intercetta ogni
    // tocco sulla board finché è attivo, niente selezione/spostamento
    // pedine nel frattempo (vedi startCombatTransitionPlacement/
    // startCombatObstaclePlacement). ----
    if (combatLevelPlacementMode) {
      const cellHit = e.target.closest('[data-hexcol]');
      if (cellHit) combatHandlePlacementTap(Number(cellHit.dataset.hexcol), Number(cellHit.dataset.hexrow));
      return;
    }
    const token = e.target.closest('[data-tokenchar]');
    if (token) {
      const charId = token.dataset.tokenchar;
      if (combatPendingAttack || combatPendingEffect) {
        if (combatIsPendingTargetCandidate(charId)) {
          const info = combatPendingTargetInfo();
          if (info && info.multiTarget) combatToggleMultiTarget(charId);
          else combatResolvePendingTarget(charId);
        }
        return;
      }
      const p = (combatState.participants || []).find(pp => pp.characterId === charId);
      const canMove = combatState.callerIsMaster || combatIsMine(p);
      if (!canMove) return;
      combatSelectedTokenCharId = (combatSelectedTokenCharId === charId) ? null : charId;
      renderCombatMap();
      return;
    }
    const cell = e.target.closest('[data-hexcol]');
    // Bug: senza il guard su combatPendingAttack/combatPendingEffect, una
    // pedina lasciata "selezionata per il movimento" (tap su un token, mai
    // completato con un tap su una cella) restava tale anche dopo aver
    // aperto un attacco/effetto (il click sui TOKEN la ignora già, vedi il
    // ramo sopra, ma un tap su una cella VUOTA mentre si sta scegliendo il
    // bersaglio ci arrivava comunque qui sotto e spostava silenziosamente
    // quella pedina, invece di non fare nulla — nessun'azione valida in
    // quel momento è "muovi la pedina selezionata in precedenza").
    if (cell && combatSelectedTokenCharId && !combatPendingAttack && !combatPendingEffect) {
      const col = Number(cell.dataset.hexcol), row = Number(cell.dataset.hexrow);
      const charId = combatSelectedTokenCharId;
      combatSelectedTokenCharId = null;
      const activeLevel = combatResolveCurrentLevel();
      moveCombatToken(combatViewEncounterId, charId, col, row, activeLevel && activeLevel.id).then(refreshCombatBoard)
        .catch(err => { toast(describeError(err)); renderCombatMap(); });
    }
  });

  // ---- trascinamento diretto di una pedina già posizionata: più immediato
  // del doppio tap (seleziona poi tocca la cella), che resta comunque
  // valido per chi preferisce quel gesto. Un tap semplice (senza superare
  // la soglia di movimento) non attiva il drag: il 'click' nativo che
  // segue è gestito dal listener sopra, invariato. Solo pedine già
  // collocate (hexCol/hexRow non nulli): la prima collocazione resta dal
  // menu "Posiziona sulla mappa". */
  (function setupCombatTokenDrag() {
    const map = $('#combat-map');
    if (!map) return;
    const DRAG_THRESHOLD = 8;
    let dragEl = null, dragCharId = null, dragging = false, startX = 0, startY = 0, offsetX = 0, offsetY = 0;

    function canDragToken(charId) {
      if (combatLevelPlacementMode) return false; // piazzamento passaggi/ostacoli in corso: niente drag pedine
      if (combatPendingAttack || combatPendingEffect) return false; // bersaglio pendente: il tap seleziona il bersaglio, non trascina
      const p = (combatState.participants || []).find(pp => pp.characterId === charId);
      return !!p && (combatState.callerIsMaster || combatIsMine(p)) && p.hexCol != null && p.hexRow != null;
    }
    // Fuori dal rettangolo della mappa: solo il Narratore può "far cadere"
    // la pedina fin lì per espellerla dalla scena (stesso permesso del
    // bottone "Rimuovi dalla scena" nel menu, mai per il proprietario).
    function isOutsideMap(x, y) {
      const r = map.getBoundingClientRect();
      return x < r.left || x > r.right || y < r.top || y > r.bottom;
    }
    function onDown(x, y, target) {
      const tokenEl = target && target.closest && target.closest('[data-tokenchar]');
      if (!tokenEl || !canDragToken(tokenEl.dataset.tokenchar)) return;
      dragEl = tokenEl; dragCharId = tokenEl.dataset.tokenchar; dragging = false;
      startX = x; startY = y;
      // CSS left/top del token sono ora il suo CENTRO, non più l'angolo in
      // alto a sinistra (vedi .combat-token/hexCellCenter): l'offset di
      // trascinamento va quindi preso dal centro del rettangolo renderizzato
      // (getBoundingClientRect resta corretto per il centro anche con
      // transform:translate applicato, riflette sempre la posizione finale
      // effettiva), non più dal suo angolo — altrimenti onMove sposterebbe
      // il token con un offset sbagliato non appena inizia il trascinamento.
      const rect = tokenEl.getBoundingClientRect();
      offsetX = x - (rect.left + rect.width / 2); offsetY = y - (rect.top + rect.height / 2);
    }
    function onMove(x, y, ev) {
      if (!dragEl) return;
      const dx = x - startX, dy = y - startY;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
        dragEl.classList.add('combat-token-dragging');
        // il drag sostituisce la selezione tap: evita che resti un
        // bagliore radiale "appeso" a una pedina che si sta spostando qui
        if (combatSelectedTokenCharId) { combatSelectedTokenCharId = null; renderCombatMap(); }
      }
      if (ev && ev.cancelable) ev.preventDefault();
      const mapRect = map.getBoundingClientRect();
      dragEl.style.left = Math.round(x - mapRect.left - offsetX) + 'px';
      dragEl.style.top = Math.round(y - mapRect.top - offsetY) + 'px';
      // Fuori dai bordi: segnala visivamente che il rilascio qui espelle
      // la pedina (solo se il Narratore può davvero farlo, altrimenti il
      // drag resta un normale spostamento che si aggancerà comunque alla
      // cella più vicina anche se il dito/mouse esce un po' dal riquadro).
      dragEl.classList.toggle('combat-token-eject-armed', combatState.callerIsMaster && isOutsideMap(x, y));
    }
    function onUp(x, y) {
      if (!dragEl) return;
      const wasDragging = dragging, charId = dragCharId, el = dragEl;
      dragEl = null; dragCharId = null; dragging = false;
      el.classList.remove('combat-token-dragging', 'combat-token-eject-armed');
      if (!wasDragging) return; // solo un tap: lascia fare al 'click' nativo
      if (combatState.callerIsMaster && isOutsideMap(x, y)) {
        unstageCombatCharacter(combatViewEncounterId, charId).then(refreshCombatBoard)
          .catch(err => { toast(describeError(err)); renderCombatMap(); });
        return;
      }
      // Cella più vicina al punto di rilascio (non un hit test sul DOM: col
      // disegno "solo contorno" ci sono vuoti reali fra le celle dove un
      // elementFromPoint esatto fallirebbe, vedi combatNearestHexCell).
      const mapRect = map.getBoundingClientRect();
      const hex = combatNearestHexCell(x - mapRect.left, y - mapRect.top);
      if (!hex) { renderCombatMap(); return; }
      const activeLevel = combatResolveCurrentLevel();
      moveCombatToken(combatViewEncounterId, charId, hex.col, hex.row, activeLevel && activeLevel.id).then(refreshCombatBoard)
        .catch(err => { toast(describeError(err)); renderCombatMap(); });
    }

    map.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
    map.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    map.addEventListener('touchend', e => onUp(e.changedTouches[0].clientX, e.changedTouches[0].clientY));
    // pointermove/pointerup vanno su document, non su map: appena il mouse
    // esce dal riquadro (proprio il gesto che serve per espellere una
    // pedina) un listener attaccato solo a map smetterebbe di ricevere gli
    // eventi, dato che non sono più mirati a un suo discendente.
    let mouseDown = false;
    map.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; mouseDown = true; onDown(e.clientX, e.clientY, e.target); });
    document.addEventListener('pointermove', e => { if (!mouseDown) return; onMove(e.clientX, e.clientY, e); });
    document.addEventListener('pointerup', e => { if (!mouseDown) return; mouseDown = false; onUp(e.clientX, e.clientY); });
    document.addEventListener('pointercancel', () => { mouseDown = false; if (dragEl) { dragEl.classList.remove('combat-token-dragging', 'combat-token-eject-armed'); dragEl = null; dragging = false; renderCombatMap(); } });
  })();

  // ---- trascinamento di una card della barra "Personaggi in gioco" fin
  // dentro la board, per posizionarla/spostarla senza passare dal menu
  // "Posiziona sulla mappa" — più intuitivo di aprire il menu e poi
  // toccare una cella. Lock di direzione: solo un trascinamento
  // prevalentemente VERTICALE avvia il drag (un semplice tap resta gestito
  // dal 'click' sotto), quello ORIZZONTALE non viene intercettato per
  // niente e lascia lo scroll nativo della barra intatto. ----
  (function setupCombatRosterDrag() {
    const bar = $('#combat-roster-bar');
    const map = $('#combat-map');
    if (!bar || !map) return;
    const DIRECTION_THRESHOLD = 10;
    let sourceCard = null, sourceCharId = null, ghost = null, phase = 'idle'; // idle | pending | dragging | scrolling
    let startX = 0, startY = 0;

    function canPlace(charId) {
      if (combatLevelPlacementMode) return false; // piazzamento passaggi/ostacoli in corso: niente drag pedine
      const p = (combatState.participants || []).find(pp => pp.characterId === charId);
      return !!p && (combatState.callerIsMaster || combatIsMine(p));
    }
    function overMap(x, y) {
      const r = map.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }
    function makeGhost(card) {
      const avatarEl = card.querySelector('.avatar');
      const g = document.createElement('div');
      g.className = 'combat-roster-drag-ghost';
      if (avatarEl && avatarEl.classList.contains('has-portrait')) g.style.backgroundImage = avatarEl.style.backgroundImage;
      else g.textContent = avatarEl ? avatarEl.textContent : '';
      document.body.appendChild(g);
      return g;
    }
    function cleanup() {
      if (ghost) { ghost.remove(); ghost = null; }
      if (sourceCard) sourceCard.classList.remove('combat-roster-card-lifted');
      sourceCard = null; sourceCharId = null; phase = 'idle';
    }
    function onDown(x, y, target) {
      const card = target && target.closest && target.closest('[data-rostercard]');
      if (!card || !canPlace(card.dataset.rostercard)) return;
      sourceCard = card; sourceCharId = card.dataset.rostercard;
      phase = 'pending'; startX = x; startY = y;
    }
    function onMove(x, y, ev) {
      if (phase === 'idle' || !sourceCard) return;
      const dx = x - startX, dy = y - startY;
      if (phase === 'pending') {
        if (Math.abs(dx) < DIRECTION_THRESHOLD && Math.abs(dy) < DIRECTION_THRESHOLD) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          phase = 'dragging';
          ghost = makeGhost(sourceCard);
          sourceCard.classList.add('combat-roster-card-lifted');
        } else {
          phase = 'scrolling'; // orizzontale: non si tocca più nulla, scroll nativo della barra
        }
      }
      if (phase !== 'dragging') return;
      if (ev && ev.cancelable) ev.preventDefault();
      ghost.style.left = x + 'px';
      ghost.style.top = y + 'px';
      ghost.classList.toggle('combat-roster-drag-ghost-armed', overMap(x, y));
    }
    function onUp(x, y) {
      if (phase !== 'dragging') { cleanup(); return; }
      const charId = sourceCharId;
      const isOverMap = overMap(x, y);
      cleanup();
      if (!isOverMap) return; // rilasciata fuori dalla board: annulla, nessuna azione
      const mapRect = map.getBoundingClientRect();
      const hex = combatNearestHexCell(x - mapRect.left, y - mapRect.top);
      if (!hex) return;
      const activeLevel = combatResolveCurrentLevel();
      moveCombatToken(combatViewEncounterId, charId, hex.col, hex.row, activeLevel && activeLevel.id).then(refreshCombatBoard)
        .catch(err => toast(describeError(err)));
    }

    bar.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
    bar.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    bar.addEventListener('touchend', e => onUp(e.changedTouches[0].clientX, e.changedTouches[0].clientY));
    let mouseDown = false;
    bar.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; mouseDown = true; onDown(e.clientX, e.clientY, e.target); });
    document.addEventListener('pointermove', e => { if (!mouseDown) return; onMove(e.clientX, e.clientY, e); });
    document.addEventListener('pointerup', e => { if (!mouseDown) return; mouseDown = false; onUp(e.clientX, e.clientY); });
    document.addEventListener('pointercancel', () => { mouseDown = false; cleanup(); });
  })();

  // ---- barra "Personaggi in gioco": tap una card apre il menu azioni ----
  $('#combat-roster-bar').addEventListener('click', async e => {
    const removeEffectBtn = e.target.closest('[data-effectremove]');
    if (removeEffectBtn) {
      removeCombatEffect(removeEffectBtn.dataset.effectremove).then(refreshCombatBoard).catch(err => toast(describeError(err)));
      return;
    }
    const escapeBtn = e.target.closest('[data-statusescape]');
    if (escapeBtn) {
      // tiro percentuale puro, nessun bonus di tratto — la soglia (70%/85%)
      // è decisa e verificata server-side in base a turns_elapsed
      const d100 = rollDie(100);
      const effectForToast = (combatState.activeEffects || []).find(x => x.id === escapeBtn.dataset.statusescape);
      const statusForToast = percentContestStatusInfo(effectForToast && effectForToast.status_key);
      const statusLabelForToast = statusForToast ? statusForToast.label.toLowerCase() : 'bloccato';
      try {
        const result = await submitStatusEscapeRoll(escapeBtn.dataset.statusescape, d100, `d100: ${d100}`);
        await refreshCombatBoard();
        toast(result.escaped
          ? `🎲 ${d100} > ${result.threshold}% — libero!`
          : `🎲 ${d100} ≤ ${result.threshold}% — ancora ${statusLabelForToast}`);
      } catch (err) { toast(describeError(err)); }
      return;
    }
    const card = e.target.closest('[data-rostercard]');
    if (card) openCombatOwnActionsMenu(card.dataset.rostercard);
  });
  // ---- pannello comandi sempre presente (Attacca/Tecniche/Abilità/Boost/
  // Oggetti): stesso combatOwnActionsCharId già impostato da
  // renderCombatCommandPanel, nessuna finestra da nascondere dato che non
  // è più un popup ----
  $('#combat-command-panel').addEventListener('click', e => {
    if (e.target.closest('#combat-cmd-ko-check')) { combatRollKoCheck(combatOwnActionsCharId); return; }
    if (e.target.closest('#combat-cmd-attack')) { openCombatWeaponPicker(combatOwnActionsCharId); return; }
    if (e.target.closest('#combat-cmd-tecniche')) { openCombatTecAbPicker(combatOwnActionsCharId, 'tecniche'); return; }
    if (e.target.closest('#combat-cmd-abilita')) { openCombatTecAbPicker(combatOwnActionsCharId, 'abilita'); return; }
    if (e.target.closest('#combat-cmd-boost')) { openCombatBoostPicker(combatOwnActionsCharId); return; }
    if (e.target.closest('#combat-cmd-items')) { openCombatItemPicker(combatOwnActionsCharId); return; }
    if (e.target.closest('#combat-cmd-transition')) { openCombatLevelTransitionPicker(combatOwnActionsCharId); return; }
  });
  $('#combat-own-actions-cancel').addEventListener('click', () => $('#combat-own-actions-menu').classList.add('hidden'));
  $('#combat-own-actions-body').addEventListener('click', e => {
    if (e.target.closest('#combat-own-pass-turn')) {
      $('#combat-own-actions-menu').classList.add('hidden');
      passCombatTurn(combatViewEncounterId, combatOwnActionsCharId)
        .then(async result => { await refreshCombatBoard(); toast(combatTicksToast('Turno passato', result)); })
        .catch(err => toast(describeError(err)));
      return;
    }
    if (e.target.closest('#combat-own-open-sheet')) {
      $('#combat-own-actions-menu').classList.add('hidden');
      openCharacterForCombatAction(combatOwnActionsCharId);
      return;
    }
    if (e.target.closest('#combat-own-place-token')) {
      $('#combat-own-actions-menu').classList.add('hidden');
      combatSelectedTokenCharId = combatOwnActionsCharId;
      renderCombatMap();
      toast('Tocca una casella della mappa per posizionare ' + combatParticipantName(
        (combatState.participants || []).find(pp => pp.characterId === combatOwnActionsCharId) || {}
      ));
      return;
    }
    const revealBtn = e.target.closest('[data-combatreveal]');
    if (revealBtn) { $('#combat-own-actions-menu').classList.add('hidden'); openCombatRevealPicker(revealBtn.dataset.combatreveal); return; }
    const unstageBtn = e.target.closest('[data-combatunstage]');
    if (unstageBtn) {
      $('#combat-own-actions-menu').classList.add('hidden');
      unstageCombatCharacter(combatViewEncounterId, unstageBtn.dataset.combatunstage).then(refreshCombatBoard).catch(err => toast(describeError(err)));
      return;
    }
    const killBtn = e.target.closest('[data-combatkillnpc]');
    if (killBtn) {
      $('#combat-own-actions-menu').classList.add('hidden');
      killNpcInCombat(killBtn.dataset.combatkillnpc);
    }
  });

  // ---- pannello "Gestisci scena" (Narratore): messa in scena + mappa + danno ambientale ----
  $('#btn-combat-scene').addEventListener('click', () => {
    $('#combat-scene-modal').classList.remove('hidden');
    renderCombatMapManager();
  });
  $('#combat-scene-close').addEventListener('click', () => $('#combat-scene-modal').classList.add('hidden'));

  // ---- toolbar Narratore fra mappa e personaggi: stessi strumenti di
  // "Gestisci scena" ma a un tocco, senza aprire il pannello ----
  $('#combat-narrator-toolbar').addEventListener('click', async e => {
    if (e.target.closest('#combat-toolbar-collapse')) {
      combatNarratorToolbarCollapsed = !combatNarratorToolbarCollapsed;
      renderCombatNarratorToolbarCollapse();
      return;
    }
    if (e.target.closest('#combat-toolbar-transition')) {
      try {
        const levelId = await narratorToolbarCurrentLevelId();
        if (!levelId) { toast('Impossibile determinare il livello'); return; }
        combatMapManagerEditingLevelId = levelId;
        openCombatTransitionModal(levelId);
      } catch (err) { toast(describeError(err)); }
      return;
    }
    if (e.target.closest('#combat-toolbar-obstacles')) {
      try {
        const levelId = await narratorToolbarCurrentLevelId();
        if (!levelId) { toast('Impossibile determinare il livello'); return; }
        combatMapManagerEditingLevelId = levelId;
        startCombatObstaclePlacement(levelId);
      } catch (err) { toast(describeError(err)); }
      return;
    }
    // Danno ambientale/Effetto libero: stessi bottoni già presenti (e già
    // cablati) dentro "Gestisci scena" — click programmatico invece di
    // duplicarne la logica di apertura/popolamento del modale.
    if (e.target.closest('#combat-toolbar-environmental')) { $('#btn-open-environmental').click(); return; }
    if (e.target.closest('#combat-toolbar-freeeffect')) { $('#btn-open-freeeffect').click(); return; }
  });

  $('#combat-map-manager').addEventListener('click', async e => {
    if (e.target.id === 'btn-upload-map-asset') { $('#combat-map-asset-file').click(); return; }
    const chooseBtn = e.target.closest('[data-choosemapasset]');
    if (chooseBtn) {
      const assetId = chooseBtn.dataset.choosemapasset || null;
      const cols = Math.max(2, Math.floor(Number($('#combat-map-cols').value)) || 8);
      const rows = Math.max(2, Math.floor(Number($('#combat-map-rows').value)) || 6);
      try {
        if (combatMapManagerEditingLevelId) await setCombatLevelMap(combatMapManagerEditingLevelId, assetId, cols, rows);
        else await setEncounterMap(combatViewEncounterId, assetId, cols, rows);
        combatMapAssetCache = null;
        await refreshCombatBoard();
        await renderCombatMapManager();
        toast('Mappa aggiornata');
      } catch (err) { toast(describeError(err)); }
      return;
    }
    const removeBtn = e.target.closest('[data-removemapasset]');
    if (removeBtn) {
      try { await removeCampaignAsset(removeBtn.dataset.removemapasset, removeBtn.dataset.removepath); await renderCombatMapManager(); }
      catch (err) { toast(describeError(err)); }
      return;
    }
    if (e.target.id === 'btn-apply-map-grid') {
      const cols = Math.max(2, Math.floor(Number($('#combat-map-cols').value)) || 8);
      const rows = Math.max(2, Math.floor(Number($('#combat-map-rows').value)) || 6);
      try {
        if (combatMapManagerEditingLevelId) {
          const lvl = (combatState.levels || []).find(l => l.id === combatMapManagerEditingLevelId);
          await setCombatLevelMap(combatMapManagerEditingLevelId, lvl ? lvl.map_asset_id : null, cols, rows);
        } else {
          await setEncounterMap(combatViewEncounterId, combatState.encounter.map_asset_id, cols, rows);
        }
        await refreshCombatBoard();
        toast('Griglia aggiornata');
      } catch (err) { toast(describeError(err)); }
      return;
    }

    // ---- livelli ----
    if (e.target.id === 'btn-add-combat-level') {
      try {
        if (!(combatState.levels || []).length) { await ensureCombatLevelDefault(combatViewEncounterId); await refreshCombatBoard(); }
        // "Piano precedente" = quello con l'order_index più alto PRIMA di
        // questa creazione (i livelli si accodano sempre in cima, vedi
        // create_combat_level): la scala automatica collega sempre due
        // piani adiacenti, mai il nuovo livello al piano terra se nel
        // frattempo ce ne sono già altri in mezzo.
        const previousTopLevel = (combatState.levels || []).slice().sort((a, b) => a.order_index - b.order_index).pop() || null;
        const label = prompt('Nome del nuovo livello:', 'Livello ' + (((combatState.levels || []).length || 0) + 1));
        if (label === null) { await refreshCombatBoard(); await renderCombatMapManager(); return; }
        const created = await createCombatLevel(combatViewEncounterId, label, null, 8, 6);
        combatMapManagerEditingLevelId = created.id;
        if (previousTopLevel) await autoPlaceLevelStaircase(previousTopLevel, created);
        await refreshCombatBoard();
        await renderCombatMapManager();
        toast(previousTopLevel ? `Livello creato con una scala verso "${previousTopLevel.label}" (spostabile: elimina e ripiazza da qui)` : 'Livello creato');
      } catch (err) { toast(describeError(err)); }
      return;
    }
    const renameLevelBtn = e.target.closest('[data-renamelevel]');
    if (renameLevelBtn) {
      const lvl = (combatState.levels || []).find(l => l.id === renameLevelBtn.dataset.renamelevel);
      const label = prompt('Nuovo nome del livello:', lvl ? lvl.label : '');
      if (!label) return;
      try { await renameCombatLevel(renameLevelBtn.dataset.renamelevel, label); await refreshCombatBoard(); await renderCombatMapManager(); toast('Livello rinominato'); }
      catch (err) { toast(describeError(err)); }
      return;
    }
    if (e.target.id === 'btn-rename-combat-level-default') {
      const label = prompt('Nuovo nome del livello:', 'Livello 1');
      if (!label) return;
      try {
        await ensureCombatLevelDefault(combatViewEncounterId);
        await refreshCombatBoard();
        const lvl = (combatState.levels || [])[0];
        if (lvl) await renameCombatLevel(lvl.id, label);
        await refreshCombatBoard();
        await renderCombatMapManager();
        toast('Livello rinominato');
      } catch (err) { toast(describeError(err)); }
      return;
    }
    const editLevelBtn = e.target.closest('[data-editlevel]');
    if (editLevelBtn) { combatMapManagerEditingLevelId = editLevelBtn.dataset.editlevel; renderCombatMapManager(); return; }
    const deleteLevelBtn = e.target.closest('[data-deletelevel]');
    if (deleteLevelBtn) {
      if (!confirm('Eliminare questo livello? Solo se non ha più personaggi posizionati.')) return;
      try {
        await deleteCombatLevel(deleteLevelBtn.dataset.deletelevel);
        if (combatMapManagerEditingLevelId === deleteLevelBtn.dataset.deletelevel) combatMapManagerEditingLevelId = null;
        await refreshCombatBoard();
        await renderCombatMapManager();
        toast('Livello eliminato');
      } catch (err) { toast(describeError(err)); }
      return;
    }

    // ---- passaggi ----
    if (e.target.id === 'btn-add-transition') {
      if (!combatMapManagerEditingLevelId) return;
      openCombatTransitionModal(combatMapManagerEditingLevelId);
      return;
    }
    const deleteTransitionBtn = e.target.closest('[data-deletetransition]');
    if (deleteTransitionBtn) {
      if (!confirm('Eliminare questo passaggio?')) return;
      try { await removeCombatLevelTransition(deleteTransitionBtn.dataset.deletetransition); await refreshCombatBoard(); await renderCombatMapManager(); }
      catch (err) { toast(describeError(err)); }
      return;
    }

    // ---- ostacoli ----
    if (e.target.id === 'btn-toggle-obstacles') {
      if (!combatMapManagerEditingLevelId) return;
      startCombatObstaclePlacement(combatMapManagerEditingLevelId);
      return;
    }
  });
  $('#combat-map-manager').addEventListener('change', async e => {
    const fileInput = e.target.closest('#combat-map-asset-file');
    if (!fileInput) return;
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const label = prompt('Nome per questa immagine (facoltativo):') || '';
    try { await uploadCampaignAsset(combatViewCampaignId, file, label); await renderCombatMapManager(); toast('Immagine caricata'); }
    catch (err) { toast(describeError(err)); }
  });

  // ---- danno ambientale (Narratore) ----
  $('#btn-open-environmental').addEventListener('click', () => {
    const sel = $('#combat-env-target');
    sel.innerHTML = (combatState.participants || [])
      .map(p => `<option value="${p.characterId}">${escapeHtml(combatParticipantName(p))} (Lv ${p.level})</option>`).join('');
    $('#combat-env-label').value = '';
    $('#combat-env-damage').value = 10;
    $('#combat-env-difficulty').value = 12;
    $('#combat-env-surprise').checked = false;
    $('#combat-env-dodgeblock').checked = true;
    $('#combat-env-dodgeblock').disabled = false;
    $('#combat-scene-modal').classList.add('hidden');
    $('#combat-environmental-modal').classList.remove('hidden');
  });
  $('#combat-env-cancel').addEventListener('click', () => $('#combat-environmental-modal').classList.add('hidden'));
  $('#combat-env-surprise').addEventListener('change', () => {
    const dodgeChk = $('#combat-env-dodgeblock');
    if ($('#combat-env-surprise').checked) { dodgeChk.checked = false; dodgeChk.disabled = true; }
    else { dodgeChk.disabled = false; }
  });
  $('#combat-env-confirm').addEventListener('click', async () => {
    const targetId = $('#combat-env-target').value;
    if (!targetId) { toast('Scegli un bersaglio'); return; }
    const label = $('#combat-env-label').value.trim();
    const damage = Math.max(0, Math.floor(Number($('#combat-env-damage').value)) || 0);
    const difficulty = Math.max(0, Math.floor(Number($('#combat-env-difficulty').value)) || 0);
    try {
      await declareEnvironmentalAttack(
        combatViewEncounterId, targetId, label, damage, difficulty,
        $('#combat-env-surprise').checked, $('#combat-env-dodgeblock').checked
      );
      $('#combat-environmental-modal').classList.add('hidden');
      await refreshCombatBoard();
    } catch (err) { toast(describeError(err)); }
  });

  // ---- effetto libero (Narratore): buff/regen/danno nel tempo senza una Tecnica/Abilità specifica ----
  $('#btn-open-freeeffect').addEventListener('click', () => {
    const sel = $('#combat-freeeffect-target');
    sel.innerHTML = (combatState.participants || [])
      .map(p => `<option value="${p.characterId}">${escapeHtml(combatParticipantName(p))} (Lv ${p.level})</option>`).join('');
    $('#combat-freeeffect-label').value = '';
    $('#combat-freeeffect-kind').value = 'danno';
    $('#combat-freeeffect-tick-stat').value = 'hp';
    $('#combat-freeeffect-tick-amount').value = 2;
    $('#combat-freeeffect-buff-target').value = '';
    $('#combat-freeeffect-buff-amount').value = 1;
    populateAzioneDurataSelect($('#combat-freeeffect-duration'));
    updateFreeEffectFieldsVisibility();
    $('#combat-scene-modal').classList.add('hidden');
    $('#combat-freeeffect-modal').classList.remove('hidden');
  });
  $('#combat-freeeffect-cancel').addEventListener('click', () => $('#combat-freeeffect-modal').classList.add('hidden'));
  $('#combat-freeeffect-kind').addEventListener('change', updateFreeEffectFieldsVisibility);
  $('#combat-freeeffect-confirm').addEventListener('click', async () => {
    const targetId = $('#combat-freeeffect-target').value;
    if (!targetId) { toast('Scegli un bersaglio'); return; }
    const label = $('#combat-freeeffect-label').value.trim() || 'Effetto';
    const kind = $('#combat-freeeffect-kind').value;
    const durationKey = $('#combat-freeeffect-duration').value;
    if (!durationKey) { toast('Scegli una durata'); return; }
    try {
      if (kind === 'buff') {
        await applyCombatEffect(
          combatViewEncounterId, targetId, { characterId: null, kind: 'altro', label },
          'buff', $('#combat-freeeffect-buff-target').value.trim() || label,
          Math.floor(Number($('#combat-freeeffect-buff-amount').value)) || 0,
          null, null, durationKey
        );
      } else {
        await applyCombatEffect(
          combatViewEncounterId, targetId, { characterId: null, kind: 'altro', label },
          kind, null, null,
          $('#combat-freeeffect-tick-stat').value, Math.max(0, Math.floor(Number($('#combat-freeeffect-tick-amount').value)) || 0),
          durationKey
        );
      }
      $('#combat-freeeffect-modal').classList.add('hidden');
      await refreshCombatBoard();
      toast('Effetto applicato: ' + label);
    } catch (err) { toast(describeError(err)); }
  });

  $('#combat-source-cancel').addEventListener('click', () => {
    $('#combat-source-picker').classList.add('hidden');
    cancelPendingCombatAction();
  });
  // Escape: uno dei trigger di annullamento completo esplicitamente
  // previsti (checkpoint audit combattimento multilivello, punto 2) —
  // no-op se non c'è nulla di pendente.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!(combatPendingAttack || combatPendingEffect)) return;
    cancelPendingCombatAction();
    $('#combat-source-picker').classList.add('hidden');
    $('#combat-target-hint').classList.add('hidden');
    renderCombatMap();
  });
  $('#combat-source-list').addEventListener('click', async e => {
    const item = e.target.closest('[data-combatsource]');
    if (!item) return;
    $('#combat-source-picker').classList.add('hidden');
    const payload = JSON.parse(item.dataset.combatsource);
    const casterId = combatOwnActionsCharId;
    // Passaggio di livello: non un attacco/effetto, niente target picker —
    // qui si sceglie solo COME superarlo (tratto o Tecnica/Abilità propria).
    if (combatPendingLevelTransition) {
      combatPendingLevelTransition = false;
      combatLevelTransitionChooseOption(casterId, payload);
      return;
    }
    // Boost/Oggetti: sempre e solo su se stessi, nessun target picker, mai
    // un attacco/effetto verso un altro — applicati subito qui.
    if (payload.action === 'boost') {
      const localChar = characters.find(ch => ch.cloudCharacterId === casterId);
      if (!localChar) { toast('Personaggio non trovato su questo dispositivo'); return; }
      activateBoostRow(localChar, payload.rowId, payload.lv);
      return;
    }
    if (payload.action === 'item') {
      const localChar = characters.find(ch => ch.cloudCharacterId === casterId);
      if (!localChar) { toast('Personaggio non trovato su questo dispositivo'); return; }
      await useConsumable(localChar, payload.index);
      return;
    }
    // Cura (effect-heal) e buff/malus a durata (effect-buff, es. Infezione):
    // bersaglio a scelta, se stessi compresi — nessun concetto di
    // squadra/alleanza nello schema (già così per gli attacchi), un
    // "buff" può quindi finire tanto su un alleato quanto su un nemico se i
    // suoi bonusItems/malusItems sono negativi (vedi combatEffectRowsFor).
    // effect-attack (danno nel tempo): bersaglio a scelta, mai se stessi.
    if (payload.action === 'effect-heal' || payload.action === 'effect-buff' || payload.action === 'effect-attack') {
      // cancelPendingCombatAction() azzera anche combatSelectedMultiTargets:
      // un'eventuale selezione multi-bersaglio lasciata da un'azione
      // precedente non deve "sanguinare" su questa nuova azione appena
      // scelta (difetto reale confermato nell'audit).
      cancelPendingCombatAction();
      combatPendingEffect = { casterCharacterId: casterId, payload };
      openCombatTargetPicker(casterId, payload, { includeSelf: !payload.debuff && payload.action !== 'effect-attack' });
      return;
    }
    cancelPendingCombatAction();
    combatPendingAttack = { attackerCharacterId: casterId };
    openCombatTargetPicker(casterId, payload, { includeSelf: false });
  });

  $('#combat-target-cancel').addEventListener('click', () => {
    $('#combat-target-hint').classList.add('hidden');
    cancelPendingCombatAction();
    renderCombatMap();
  });
  $('#combat-target-multi-confirm').addEventListener('click', () => {
    combatResolvePendingMultiTargets();
  });
  // Bersagli non posizionati sulla mappa (nessun token da toccare, vedi
  // openCombatTargetPicker): stesso resolver del click sul token (o lo
  // stesso toggle, se la riga sorgente ha multiTarget attivo), invocato
  // qui dal piccolo elenco supplementare nella barra invece che dalla mappa.
  $('#combat-target-unplaced-list').addEventListener('click', e => {
    const item = e.target.closest('[data-combattargetpick]');
    if (!item) return;
    const info = combatPendingTargetInfo();
    if (info && info.multiTarget) { combatToggleMultiTarget(item.dataset.combattargetpick); return; }
    combatResolvePendingTarget(item.dataset.combattargetpick);
  });

  $('#combat-flags-cancel').addEventListener('click', () => $('#combat-flags-modal').classList.add('hidden'));
  $('#combat-flag-surprise').addEventListener('change', () => {
    const dodgeChk = $('#combat-flag-dodgeblock');
    if ($('#combat-flag-surprise').checked) { dodgeChk.checked = false; dodgeChk.disabled = true; }
    else { dodgeChk.disabled = false; }
  });
  $('#combat-flags-confirm').addEventListener('click', async () => {
    const atk = activeCombatAttack(); if (!atk) return;
    $('#combat-flags-modal').classList.add('hidden');
    try {
      await setCombatAttackFlags(atk.id, $('#combat-flag-surprise').checked, $('#combat-flag-dodgeblock').checked);
      await refreshCombatBoard();
    } catch (err) { toast(describeError(err)); }
  });

  $('#combat-manual-roll-cancel').addEventListener('click', () => {
    $('#combat-manual-roll-modal').classList.add('hidden');
    combatManualRollPendingAtk = null;
  });
  $('#combat-manual-roll-confirm').addEventListener('click', async () => {
    if (!combatManualRollPendingAtk) return;
    const inputs = $$('#combat-manual-roll-fields [data-manualdie]');
    const values = [];
    for (const inp of inputs) {
      const sides = Number(inp.max);
      const v = Math.round(Number(inp.value));
      if (!inp.value || !Number.isFinite(v) || v < 1 || v > sides) {
        toast(`Valore non valido per "${inp.dataset.manualdielabel}" (1-${sides})`);
        return;
      }
      values.push(v);
    }
    const atk = combatManualRollPendingAtk;
    $('#combat-manual-roll-modal').classList.add('hidden');
    combatManualRollPendingAtk = null;
    await combatRollAttackAndDamageManual(atk, values);
  });

  $('#combat-reveal-cancel').addEventListener('click', () => $('#combat-reveal-picker').classList.add('hidden'));
  $('#combat-reveal-list').addEventListener('change', async e => {
    const chk = e.target.closest('[data-revealfield]');
    if (!chk || !combatRevealTargetId) return;
    try {
      if (chk.checked) await revealCombatField(combatViewEncounterId, combatRevealTargetId, chk.dataset.revealfield);
      else await hideCombatField(combatViewEncounterId, combatRevealTargetId, chk.dataset.revealfield);
      await refreshCombatBoard();
      // il picker resta aperto (si possono rivelare più campi di fila): lo
      // si ridisegna con lo stato aggiornato invece di richiuderlo
      if (!$('#combat-reveal-picker').classList.contains('hidden')) openCombatRevealPicker(combatRevealTargetId);
    } catch (err) { toast(describeError(err)); chk.checked = !chk.checked; }
  });

  $('#combat-attack-panel').addEventListener('click', async e => {
    const atk = activeCombatAttack(); if (!atk) return;
    if (e.target.closest('#btn-combat-attack-flags')) {
      $('#combat-flag-surprise').checked = !!atk.is_surprise_attack;
      $('#combat-flag-dodgeblock').checked = !!atk.dodge_block_allowed;
      $('#combat-flag-dodgeblock').disabled = !!atk.is_surprise_attack;
      $('#combat-flags-modal').classList.remove('hidden');
      return;
    }
    if (e.target.closest('#btn-combat-roll-attack')) { await combatRollAttackAndDamage(atk); return; }
    if (e.target.closest('#btn-combat-roll-attack-manual')) { openCombatManualRollModal(atk); return; }
    const defBtn = e.target.closest('[data-combatdefense]');
    if (defBtn) { await combatRollDefense(atk, defBtn.dataset.combatdefense); return; }
    if (e.target.closest('[data-combatdefensenone]')) { await combatRollDefense(atk, 'none'); return; }
    if (e.target.closest('#btn-combat-roll-critcheck')) { await combatRollCritCheck(atk); return; }
    if (e.target.closest('#btn-combat-apply-damage')) {
      try {
        // Durabilità di armatura/scudo/arma coinvolti: calcolata qui (dati
        // reali disponibili solo al Narratore, vedi combatFindParticipantChar)
        // e passata già pronta — il server applica solo, con validazione/clamp.
        const attackerData = combatFindParticipantChar(atk.attacker_character_id);
        const targetData = combatFindParticipantChar(atk.target_character_id);
        const durabilityLosses = computeEquipDurabilityLosses(atk, attackerData, targetData);
        await applyCombatAttackDamage(atk.id, durabilityLosses);
        await refreshCombatBoard();
        toast('Danno applicato');
      }
      catch (err) { toast(describeError(err)); }
      return;
    }
    if (e.target.closest('#btn-combat-cancel-attack')) {
      try { await cancelCombatAttack(atk.id); await refreshCombatBoard(); }
      catch (err) { toast(describeError(err)); }
      return;
    }
  });

  $('#btn-back-combat').addEventListener('click', () => history.back());
}

/* ---------------------------------------------------------- lista schede */

function axisClass(buildKey) {
  const b = BUILDS[buildKey];
  return b.axis === 'magic' ? 'magic' : (b.axis === 'bicolor' ? 'bicolor' : 'physical');
}

/* Su un dispositivo/browser condiviso da più account, mostra solo i
   personaggi "non rivendicati" (ownerAccountId nullo: creati prima di
   questo filtro, o senza nessun account collegato al momento) e quelli
   dell'account attualmente collegato — mai quelli creati da un ALTRO
   account su questo stesso dispositivo. Finché la sessione non è ancora
   stata verificata (currentSessionUserId === undefined, solo nell'istante
   iniziale) si mostra tutto: meglio un attimo di lista "non filtrata" che
   far sparire per errore i personaggi giusti prima che il controllo finisca. */
function visibleCharacters() {
  // narratorEditGuest (openCharacterForNarratorEdit): personaggio altrui
  // caricato temporaneamente per l'editing dal Narratore, mai un vero
  // personaggio di questo dispositivo — non deve mai comparire in "I tuoi
  // personaggi", a prescindere da quando/come si esce dalla scheda.
  const base = characters.filter(c => !c.narratorEditGuest);
  if (currentSessionUserId === undefined) return base;
  return base.filter(c => !c.ownerAccountId || c.ownerAccountId === currentSessionUserId);
}
function renderCharList() {
  const wrap = $('#char-list');
  const visible = visibleCharacters();
  if (!visible.length) {
    wrap.innerHTML = `<div class="empty-state">Nessun personaggio ancora.<br>Tocca "+" per crearne uno.</div>`;
  } else {
    const sorted = [...visible].sort((a, b) => b.updatedAt - a.updatedAt);
    wrap.innerHTML = sorted.map(c => {
      const b = BUILDS[c.build];
      const initial = (c.nome || '?').trim().charAt(0).toUpperCase() || '?';
      const portraitStyle = c.portrait ? ` style="background-image:url(${c.portrait});${portraitPosCss(c.portraitPos)}"` : '';
      const draftBadge = !c.creationCompleted ? `<span class="chip" style="margin-left:6px;">Bozza</span>` : '';
      // Appartenenza a una storia: visibile direttamente qui, senza dover
      // passare da Account > Le tue campagne > elenco personaggi solo per
      // saperlo. cloudCampaignId è la fonte di verità (colonna server
      // campaign_id, riscritta ad ogni sync — vedi applyFullCloudSnapshot),
      // mai un campo solo "impostato una volta": un personaggio rimosso
      // dalla storia o mai sincronizzato torna correttamente a "Nessuna
      // storia" invece di restare bloccato sull'ultimo nome noto.
      const storyBadge = c.cloudCampaignId
        ? `<span class="chip" style="margin-left:6px;" title="Fa parte di questa storia">📖 ${escapeHtml(c.cloudCampaignName || 'In una storia')}</span>`
        : `<span class="chip" style="margin-left:6px;opacity:.6;" title="Non fa parte di nessuna storia">Nessuna storia</span>`;
      return `<div class="char-card" data-id="${c.id}">
        <div class="avatar ${axisClass(c.build)}${c.portrait ? ' has-portrait' : ''}"${portraitStyle}>${initial}</div>
        <div class="info">
          <div class="name">${escapeHtml(c.nome || 'Senza nome')}${draftBadge}</div>
          <div class="meta">${b.label} · Lv ${c.livello || 1}${storyBadge}</div>
        </div>
        <button class="btn btn-icon btn-ghost" data-dup="${c.id}" title="Duplica" aria-label="Duplica">⎘</button>
        <button class="btn btn-icon btn-ghost" data-del="${c.id}" title="Elimina" aria-label="Elimina">🗑</button>
      </div>`;
    }).join('');
  }
  syncMyCharactersInBackground();
  if (typeof renderListAccountBadge === 'function') renderListAccountBadge();
}

/* All'apertura dell'elenco, importa in background gli eventuali personaggi
   già salvati nel cloud da un altro dispositivo con lo stesso account (vedi
   syncMyCharactersFromCloud in cloud-character.js): senza, un personaggio
   creato sul telefono e salvato nel cloud non comparirebbe mai aprendo
   l'app da un browser diverso. Nessun effetto per chi non ha un account
   permanente (per un ospite non ha senso: è per definizione legato a questo
   solo dispositivo). Si ri-renderizza l'elenco solo se arriva qualcosa di
   nuovo, altrimenti il giro di rete resta invisibile. */
function syncMyCharactersInBackground() {
  if (typeof syncMyCharactersFromCloud !== 'function') return;
  syncMyCharactersFromCloud().then(imported => {
    if (imported) { renderCharList(); toast('Personaggi aggiornati dal tuo account'); }
  }).catch(() => {});
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* -------------------------------------------------------------- header */

function renderHeader(c) {
  $('#f-nome').value = c.nome;
  $('#sheet-sub').textContent = `${BUILDS[c.build].label} · Livello ${c.livello}`;
  const av = $('#header-avatar');
  av.classList.toggle('hidden', !c.portrait);
  av.style.backgroundImage = c.portrait ? `url(${c.portrait})` : '';
  av.style.backgroundPosition = c.portrait ? portraitPosValue(c.portraitPos) : '';
}

/* ------------------------------------------------------------- build UI */

const BUILD_KEYS = ['guerriero', 'eclettico', 'mago'];
let pendingBuild = null;
// true mentre il wizard di creazione (view-create) è aperto: build,
// statistiche primarie, tratti e tecniche/abilità iniziali restano
// liberamente modificabili (nessun bottone "Conferma" per-sezione) e le
// sezioni di Background si mostrano già sbloccate — vedi
// openCreationWizard/wizardTeardown più sotto.
let wizardActive = false;
let pendingWizardBuildClick = null;

/* Aggiorna tutte le viste che dipendono dalla classe selezionata */
function refreshAfterBuildChange(c) {
  renderBuildGrid(c);
  updateDerived(c);
  updatePrimaryRemaining(c);
  renderHeader(c);
  renderRetroNote(c);
  renderTecniche(c);
  renderAbilita(c);
  touchActive();
}

function renderBuildGrid(c) {
  const grid = $('#build-grid');
  grid.innerHTML = BUILD_KEYS.map(key => {
    const b = BUILDS[key];
    const selected = c.build === key;
    const locked = c.buildConfirmed && !selected;
    const selClass = b.axis === 'magic' ? 'magic-sel' : (b.axis === 'bicolor' ? 'bicolor-sel' : '');
    let statsHtml, swapHtml = '';
    if (key === 'eclettico') {
      const hpM = c.eclecticoHpMult === 5 ? 5 : 7;
      const mpM = hpM === 7 ? 5 : 7;
      statsHtml = `<b>×${hpM}</b> HP · <b>×${mpM}</b> MP`;
      if (!c.buildConfirmed) {
        swapHtml = `<div class="swap-row">
          <button class="btn btn-sm ${hpM === 7 ? 'btn-primary' : 'btn-ghost'}" data-swap="7" data-buildkey="eclettico">HP×7 / MP×5</button>
          <button class="btn btn-sm ${hpM === 5 ? 'btn-primary' : 'btn-ghost'}" data-swap="5" data-buildkey="eclettico">HP×5 / MP×7</button>
        </div>`;
      }
    } else {
      statsHtml = `<b>×${b.hpMult}</b> HP · <b>×${b.mpMult}</b> MP`;
    }
    const badge = c.buildConfirmed && selected ? `<span class="chip physical" style="margin-left:8px;">Confermata</span>` : '';
    return `<div class="build-card ${selected ? 'selected ' + selClass : ''} ${locked ? 'locked' : ''}" data-buildcard="${key}">
      <div class="bc-top"><span class="bc-name">${b.label}${badge}</span><span class="bc-radio"></span></div>
      <div class="bc-stats">${statsHtml}</div>
      <div class="bc-meta">Dotazione: ${b.dotazione} · P.R. iniziali: ${b.prIniziali}</div>
      ${key === 'eclettico' ? swapHtml : ''}
    </div>`;
  }).join('');
  $('#build-helper').textContent = c.buildConfirmed
    ? 'Classe confermata: non può più essere cambiata. I massimali HP/MP sono ufficializzati e crescono solo con i level-up.'
    : (wizardActive
      ? 'Scegli la classe: i massimali HP/MP in scheda seguono il moltiplicatore selezionato. Resta modificabile finché non confermi tutte le scelte alla fine della creazione.'
      : 'Scegli la classe: i massimali HP/MP in scheda seguono il moltiplicatore selezionato. Alla scelta ti verrà chiesta una conferma — dopo il Sì la classe non si può più cambiare.');
}

/* ------------------------------------------------------------ primarie */

/* Riga con stepper condivisa da statistiche primarie e dalla (unica)
   secondaria: stessa card, stesso comportamento di bonus (consumabile in
   ambra, equip in verde) — cambia solo quali chiavi/dati arrivano da fuori. */
function statStepperRowHtml(c, stat, val, min, locked, fullLabel) {
  // Difesa/Difesa Mentale sono le uniche primarie "protette" da un'armatura
  // a locazione: il bonus da equip qui non è più un numero fisso ma dipende
  // da dove verrà colpito il personaggio (vedi equipDefensiveBonusRange) —
  // ogni altra primaria (Forza, Mira, Velocità...) resta il bonus flat di
  // sempre, sommato su tutti i pezzi indossati.
  const isDefensive = stat.key === 'dif' || stat.key === 'dmen';
  const consumableBuff = (c.statBuffs || []).filter(b => b.target === stat.key && !b.listKey).reduce((s, b) => s + (Number(b.valore) || 0), 0) + tecAbBuffTotal(c, stat.key);
  const equipBuff = isDefensive ? 0 : equipBonusTotal(c, 'primary', stat.key);
  const defRange = isDefensive ? equipDefensiveBonusRange(c, 'primary', stat.key) : null;
  const hasDefRange = defRange && (defRange.min || defRange.max);
  // Riga unica per TUTTE le statistiche (primarie, P.R., terziarie): nome
  // esteso e valore derivato insieme, nella stessa colonna a sinistra
  // (.stat-info, larghezza flessibile) — lo stepper è un blocco a parte, a
  // larghezza fissa, sempre ancorato a destra (.stepper NON è più flex:1,
  // vedi style.css): un bonus/derivato più lungo (es. "Iniziativa 2–9")
  // allarga solo la colonna di sinistra, non sposta mai i pulsanti.
  const secondaryBits = [
    consumableBuff ? `<span title="Incremento attivo da consumabile">+${consumableBuff}</span>` : '',
    equipBuff ? `<span title="Bonus da arma/scudo equipaggiato: momentaneo, dura finché il pezzo resta equipaggiato">+${equipBuff} equip.</span>` : '',
    hasDefRange ? `<span title="Bonus da equipaggiamento in base a dove verrà colpito: solo il pezzo d'armatura sulla parte colpita protegge, arma/scudo sempre attivi">+${defRange.min}/+${defRange.max} equip.</span>` : ''
  ].filter(Boolean).join(' · ');
  return `<div class="stat-row">
    <div class="stat-info">
      <div class="stat-label ${stat.axis}${(consumableBuff || equipBuff || hasDefRange) ? ' buffed' : ''}"><span class="abbr">${stat.label}</span><span class="full">${fullLabel}</span></div>
      <div class="stat-row-secondary"${secondaryBits ? '' : ' hidden'}>${secondaryBits}</div>
      <div id="stat-danno-preview-${stat.key}" class="stat-row-secondary stat-danno-preview"></div>
    </div>
    <div class="stepper">
      <button data-pstat="${stat.key}" data-dir="-1" aria-label="Diminuisci ${escapeHtml(fullLabel)}" class="${Number(val) <= Number(min) ? 'hidden' : ''}" ${locked ? 'disabled' : ''}>▼</button>
      <input type="number" data-pstat-input="${stat.key}" value="${val}" min="${min}" aria-label="Valore attuale di ${escapeHtml(fullLabel)}" ${locked ? 'disabled' : ''}>
      <button data-pstat="${stat.key}" data-dir="1" aria-label="Aumenta ${escapeHtml(fullLabel)}" ${locked ? 'disabled' : ''}>▲</button>
    </div>
  </div>`;
}
/* Estremi (min–max) del dado usato per un dato valore statistica: mai un
   numero medio "inventato" che finge una precisione che i dadi non hanno —
   il minimo e il massimo sono gli unici due valori davvero garantiti dalla
   regola (vedi diceForValue/rollDie in data.js: d12+d8 sono DUE dadi
   sommati, quindi il minimo è 1+1=2, non 1). */
function dieRangeFor(diceLabel) {
  if (diceLabel === 'd12+d8') return { min: 2, max: 20 };
  return { min: 1, max: Number(diceLabel.slice(1)) };
}
/* Anteprima in tempo reale (un chip compatto sulla STESSA riga dello
   stepper, mai a capo — vedi .stat-danno-preview in style.css) del valore
   che quella statistica produce da sola, ricalcolata a ogni click sullo
   stepper (vedi handlePstatClick/handlePstatInput in init()):
   - HP/MP: base × moltiplicatore di classe, SOLO in creazione (Lv1) — dal
     Lv2 il valore in scheda è già il totale cresciuto in diretta con gli
     AP, nessun moltiplicatore da mostrare (stesso calcolo di
     #derived-hpmax/#derived-mpmax in updateDerived, ma visibile anche nel
     wizard: quei due box vivono fuori da #creation-primary-block, mai
     spostati lì — vedi moveIntoWizard).
   - VEL: range di Iniziativa, VEL + 1d8 FISSO (mai scalato da
     diceForValue: stessa identica formula di combatRollAndSendInitiative,
     "d8 + Vel").
   - FRZ/MIRA/DEX/F.MEN (DANNO_STAT_KEYS): range di danno puro, statistica
     + il dado che le corrisponde secondo diceForValue (stessa scala della
     Regola del Danno reale) — nessuna Tecnica/Abilità specifica, nessun
     dannoBase, solo la caratteristica da sola. */
function renderStatDannoPreview(c, key) {
  const el = document.getElementById(`stat-danno-preview-${key}`);
  if (!el) return;
  if ((key === 'hp' || key === 'mp') && Number(c.livello) <= 1) {
    const mult = key === 'hp' ? currentHpMult(c) : currentMpMult(c);
    const base = Number(c.primary[key]) || 0;
    el.textContent = `${key === 'hp' ? 'HP' : 'MP'} max ${base * mult}`;
    return;
  }
  const statValue = Number(c.primary[key]) || 0;
  if (key === 'vel') {
    el.textContent = `Iniziativa ${statValue + 1}–${statValue + 8}`;
    return;
  }
  if (!DANNO_STAT_KEYS.includes(key)) { el.textContent = ''; return; }
  const range = dieRangeFor(diceForValue(statValue));
  el.textContent = `Danno ${statValue + range.min}–${statValue + range.max}`;
}
function renderPrimaryStats(c) {
  const wrap = $('#primary-stats');
  // Il Narratore che modifica la scheda di un PNG/PG (narratorEditMode,
  // openCharacterForNarratorEdit) deve poter ritoccare a mano le primarie
  // anche a "statistiche confermate": senza questo, un PNG generato dal
  // Randomizer restava bloccato in sola lettura, senza alcun modo di
  // correggere un valore che al Narratore sembra incoerente.
  const locked = c.primaryConfirmed && !narratorEditMode;
  // dal Lv2 in poi HP/MP crescono in diretta sul totale (niente più
  // moltiplicatore): il campo mostra e modifica il totale, non il
  // punteggio base impostato in creazione (che resta congelato)
  const grown = Number(c.livello) > 1;
  wrap.innerHTML = PRIMARY_STATS.map(stat => {
    const isHpMp = stat.key === 'hp' || stat.key === 'mp';
    const val = (isHpMp && grown) ? (stat.key === 'hp' ? c.hpMaxTracked : c.mpMaxTracked) || 0 : c.primary[stat.key];
    const absoluteMin = (isHpMp && grown) ? 0 : PRIMARY_MIN;
    const min = primaryFloorFor(c, stat.key, absoluteMin);
    const fullLabel = (isHpMp && grown) ? `${stat.full} (totale)` : stat.full;
    return statStepperRowHtml(c, stat, val, min, locked, fullLabel);
  }).join('');
  PRIMARY_STATS.forEach(stat => renderStatDannoPreview(c, stat.key));
  updatePrimaryRemaining(c);
  renderStatRollSelect();
  // il P.R. (unica statistica secondaria) vive in una sezione a parte ma va
  // aggiornato insieme alle primarie: stessi trigger (bonus, buff, livello,
  // conferma) le tengono sincronizzate senza dover toccare ogni chiamata
  renderSecondaryStats(c);
}
/* Statistica secondaria (solo P.R.): fissa da classe alla creazione (mai in
   pool libero, a differenza delle primarie), dal Lv2 cresce con gli AP
   secondo le stesse regole di crescita — vedi changePrimary, che gestisce
   'pr' come "sempre cresciuta" indipendentemente da PRIMARY_STATS. Sezione
   separata proprio perché il manuale la classifica come secondaria, non
   primaria: non entra nel pool dei 40 punti né nella loro lista. */
function renderSecondaryStats(c) {
  const wrap = $('#secondary-stats');
  if (!wrap) return;
  const stat = SECONDARY_STATS[0];
  wrap.innerHTML = statStepperRowHtml(c, stat, c.prMaxTracked || 0, primaryFloorFor(c, 'pr', 0), c.primaryConfirmed && !narratorEditMode, stat.full);
}
/* Selettore del tool "Tiro statistica": elenca gli attributi primari
   tirabili (esclusi HP/MP, riserve di punti e non prove). Opzioni fisse,
   non dipendono dal personaggio. */
function renderStatRollSelect() {
  const sel = $('#stat-roll-select');
  if (!sel || sel.options.length) return;
  sel.innerHTML = PRIMARY_STATS
    .filter(s => s.key !== 'hp' && s.key !== 'mp')
    .map(s => `<option value="${s.key}">${s.label} — ${s.full}</option>`).join('');
}
function primaryRemaining(c) {
  const sum = PRIMARY_STATS.reduce((s, k) => s + Number(c.primary[k.key] || 0), 0);
  return PRIMARY_POOL - sum;
}
/* Il bottone di conferma resta disabilitato se "Punti rimanenti" è
   negativo (può succedere con dati importati o corretti a mano): non si
   può blindare una scheda già fuori dalle regole. */
/* Si può confermare solo a punti rimanenti esattamente zero, ma solo in
   fase di creazione (Lv1): dal Lv2 il pool dei 40 punti diventa solo
   indicativo (la crescita passa agli AP) e resterebbe quasi sempre
   negativo, bloccando la conferma per sempre se lo usassimo come gate. */
function renderPrimaryLockStatus(c) {
  const el = $('#primary-lock-status');
  if (!el) return;
  // nel wizard di creazione non c'è conferma per-sezione: si blocca tutto
  // insieme alla fine (vedi wizardFinalConfirm)
  if (wizardActive) { el.innerHTML = ''; return; }
  if (c.primaryConfirmed) {
    el.innerHTML = `<div class="row-between"><span class="chip physical">🔒 Statistiche confermate</span><span class="helper-text" style="margin:0;">Si sbloccano con un level-up</span></div>`;
    return;
  }
  const remaining = primaryRemaining(c);
  const creationPhase = Number(c.livello) <= 1;
  const blocked = creationPhase && remaining !== 0;
  let note = '';
  if (creationPhase && remaining > 0) note = `Hai ancora ${remaining} punt${remaining === 1 ? 'o' : 'i'} da spendere prima di poter confermare.`;
  else if (creationPhase && remaining < 0) note = 'Punti rimanenti negativo: riduci qualche attributo prima di confermare.';
  el.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-confirm-primary" ${blocked ? 'disabled' : ''}>Conferma statistiche</button>`
    + (note ? `<p class="helper-text" style="margin:6px 0 0;color:var(--fisico-forte);">${note}</p>` : '');
}
/* Dal Lv2 in poi il pool dei 40 punti di creazione è solo storico (la
   crescita passa agli AP, vedi changePrimary): "Punti rimanenti" andrebbe
   quasi sempre in negativo, un numero rosso che sembra un errore ma non lo
   è. Da leveled in su il riquadro in alto mostra quindi "AP disponibili"
   (non scende mai sotto zero, changePrimary blocca la spesa oltre il
   disponibile) al posto di "Punti rimanenti", che resta comunque spiegato
   nella nota sotto per chi lo cerca. */
function updatePrimaryRemaining(c) {
  const el = $('#primary-remaining');
  const label = $('#primary-remaining-label');
  const leveled = Number(c.livello) > 1;
  if (leveled) {
    label.textContent = 'AP disponibili';
    el.textContent = Number(c.apDisponibili) || 0;
    el.className = 'remaining';
  } else {
    const remaining = primaryRemaining(c);
    label.textContent = 'Punti rimanenti';
    el.textContent = remaining;
    el.className = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));
  }
  renderPrimaryLockStatus(c);
}

function currentHpMult(c) {
  const b = BUILDS[c.build];
  if (c.build === 'eclettico') return c.eclecticoHpMult === 5 ? 5 : 7;
  return b.hpMult;
}
function currentMpMult(c) {
  const b = BUILDS[c.build];
  if (c.build === 'eclettico') return currentHpMult(c) === 7 ? 5 : 7;
  return b.mpMult;
}

/* --------------------------------------------------------- oggetti consumabili */

function statLabel(key) {
  const s = PRIMARY_STATS.find(st => st.key === key) || SECONDARY_STATS.find(st => st.key === key);
  return s ? s.label : key;
}
/* Validità MECCANICA di un pezzo d'equipaggiamento (armatura/scudo/arma):
   scheda confermata, equipaggiato, Durabilità corrente > 0. Punto unico —
   riusato ovunque un pezzo debba poter contribuire ad Atk/Dif/bonus
   statistiche/bonus tratti/resistenze e immunità agli stati/effetti propri
   dell'arma/rigenerazione/attacco/blocco (locale e cloud): un pezzo rotto
   (durCur<=0) è meccanicamente identico a uno nello Zaino, un pezzo mai
   confermato non ha numeri validi da usare. Non decide nulla su COME un
   pezzo rotto vada penalizzato oltre l'inutilizzabilità — quella è materia
   della proposta di ricalibrazione Durabilità, non di questo helper. */
function isEquipmentUsable(item) {
  return !!item && item.statsConfirmed === true && item.equipaggiato !== false && (Number(item.durCur) || 0) > 0;
}
/* Somma dei bonus meccanici assegnati su arma/scudo/armatura per un dato
   bersaglio: kind 'primary'/'tertiary' confrontano key, kind 'trait'
   confronta listKey+name (un tratto può chiamarsi allo stesso modo in
   categorie diverse). Scansiona sia il fronte (weaponSlots) sia il retro
   (slots): tutti e due i gruppi contano solo se davvero utilizzabili (vedi
   isEquipmentUsable) — altrimenti sono "nello zaino" o rotti, e i loro
   bonus sono sospesi. */
function equipBonusTotal(c, kind, key, listKey) {
  const allSlots = [...(c.weaponSlots || []).filter(isEquipmentUsable), ...(c.slots || []).filter(isEquipmentUsable)];
  let total = 0;
  allSlots.forEach(s => (s.bonuses || []).forEach(b => {
    if (b.kind !== kind) return;
    if (kind === 'trait') { if (b.listKey === listKey && b.name === key) total += Number(b.valore) || 0; }
    else if (b.key === key) total += Number(b.valore) || 0;
  }));
  return total;
}
/* Somma dei bonus da SOLO arma/scudo (c.weaponSlots): sempre attivi,
   indipendenti da quale parte del corpo viene colpita — a differenza
   dell'armatura (c.slots), che protegge solo dove viene effettivamente
   indossata (vedi equipDefensiveBonus* sotto). */
function equipWeaponBonusTotal(c, kind, key, listKey) {
  const wSlots = (c.weaponSlots || []).filter(isEquipmentUsable);
  let total = 0;
  wSlots.forEach(s => (s.bonuses || []).forEach(b => {
    if (b.kind !== kind) return;
    if (kind === 'trait') { if (b.listKey === listKey && b.name === key) total += Number(b.valore) || 0; }
    else if (b.key === key) total += Number(b.valore) || 0;
  }));
  return total;
}
/* Bonus di UNA SOLA armatura (c.slots) per parte del corpo, nello stesso
   ordine di ARMOR_LOCATIONS: 0 per uno slot vuoto/disequipaggiato/senza
   quel bonus specifico. */
function equipArmorBonusPerLocation(c, kind, key, listKey) {
  return (c.slots || []).map(s => {
    if (!isEquipmentUsable(s)) return 0;
    let total = 0;
    (s.bonuses || []).forEach(b => {
      if (b.kind !== kind) return;
      if (kind === 'trait') { if (b.listKey === listKey && b.name === key) total += Number(b.valore) || 0; }
      else if (b.key === key) total += Number(b.valore) || 0;
    });
    return total;
  });
}
/* Bonus DIFENSIVO (Difesa/Difesa Mentale primarie, o un tratto usato come
   tiro di resistenza) per UN COLPO PRECISO: arma/scudo (sempre attivi) +
   SOLO il pezzo d'armatura che copre la parte colpita — mai l'intera
   "guardaroba" sommata, a differenza di equipBonusTotal. targetedBodyPart
   vuoto/assente = colpo generico: media dei soli pezzi d'armatura
   effettivamente indossati (mai 0 fisso, mai il pezzo migliore/peggiore —
   scelta esplicita). Usare solo per bonus davvero difensivi: ogni altro
   bonus da equipaggiamento (rigenerazione, ingresso di uno stato,
   immunità/resistenza a uno stato, primarie non difensive) resta sempre
   sommato su tutti i pezzi indossati, invariato — vedi equipBonusTotal. */
function equipDefensiveBonusForHit(c, kind, key, listKey, targetedBodyPart) {
  const weapon = equipWeaponBonusTotal(c, kind, key, listKey);
  const perLoc = equipArmorBonusPerLocation(c, kind, key, listKey);
  if (targetedBodyPart) {
    const idx = ARMOR_LOCATIONS.indexOf(targetedBodyPart);
    return weapon + (idx >= 0 ? (perLoc[idx] || 0) : 0);
  }
  const worn = (c.slots || []).map((s, i) => (isEquipmentUsable(s) ? perLoc[i] : null)).filter(v => v !== null);
  const armorAvg = worn.length ? Math.round(worn.reduce((a, b) => a + b, 0) / worn.length) : 0;
  return weapon + armorAvg;
}
/* Range min–max del bonus difensivo per una visualizzazione rapida fuori
   da un attacco specifico (non si sa ancora dove verrà colpito il
   personaggio): arma/scudo sempre inclusi, più il pezzo d'armatura più
   debole/più forte fra quelli indossati (0 per una parte scoperta). */
function equipDefensiveBonusRange(c, kind, key, listKey) {
  const weapon = equipWeaponBonusTotal(c, kind, key, listKey);
  const perLoc = equipArmorBonusPerLocation(c, kind, key, listKey);
  return { min: weapon + Math.min(...perLoc), max: weapon + Math.max(...perLoc) };
}
/* Somma degli incrementi attivi su una caratteristica (0 se nessuno): gli
   incrementi da consumabile non toccano il valore base salvato, restano un
   bonus reversibile finché non viene sospeso; i bonus da equipaggiamento si
   sommano allo stesso modo, ma restano finché il pezzo ha quella riga di
   bonus (non serve "sospenderli" a mano). */
/* Bonus/malus di Tecniche/Abilità su una statistica primaria (bonusItems/
   malusItems con listKey==='primaria'), ma solo per le righe "Attiva":
   una tecnica non attivata resta solo descrittiva, come i bonus su tratto. */
function tecAbBuffTotal(c, key) {
  // Legacy row.attiva is preserved for recovery but is never mechanical:
  // authoritative timed effects come only from combat_active_effects.
  return 0;
}
function buffTotal(c, key) {
  const consumable = (c.statBuffs || []).filter(b => b.target === key && !b.listKey).reduce((s, b) => s + (Number(b.valore) || 0), 0);
  // Boost realmente attivo (checkpoint "Boost e pedina di combattimento",
  // punto 4): in combattimento cloud i bonusItems 'primaria' del Boost
  // viaggiano dentro trait_mods (stesso campo generico letto da
  // combatTraitModTotal per qualunque effetto attivo, vedi activateBoostRow)
  // — 'primaria' è solo un altro listKey per quella stessa funzione, niente
  // di nuovo da leggere. Fuori da un combattimento cloud attivo,
  // combatTraitModTotal è no-op (0) e boostLocalBuffTotal copre quel caso.
  const boost = combatTraitModTotal(c.cloudCharacterId || '', 'primaria', key) + boostLocalBuffTotal(c, 'primaria', key);
  return consumable + equipBonusTotal(c, 'primary', key) + tecAbBuffTotal(c, key) + boost;
}
function effectiveHpMax(c) { return (c.hpMaxTracked || 0) + buffTotal(c, 'hp'); }
function effectiveMpMax(c) { return (c.mpMaxTracked || 0) + buffTotal(c, 'mp'); }
function effectivePrMax(c) { return (c.prMaxTracked || 0) + buffTotal(c, 'pr'); }
function effectivePpMax(c) { return (c.hpMaxTracked || 0) / 2 + (c.mpMaxTracked || 0) / 2; }
/* Soglia di K.O.: 10% degli HP massimi effettivi (incrementi attivi inclusi) */
function koThreshold(c) { return Math.ceil(effectiveHpMax(c) * KO_THRESHOLD_PCT); }

function updateDerived(c) {
  const hpMult = currentHpMult(c), mpMult = currentMpMult(c);
  const hpMax = Number(c.primary.hp || 0) * hpMult;
  const mpMax = Number(c.primary.mp || 0) * mpMult;
  const pp = hpMax / 2 + mpMax / 2;
  $('#derived-hpmax').textContent = hpMax;
  $('#derived-hpmax-sub').textContent = `${c.primary.hp} base × ${hpMult}`;
  $('#derived-mpmax').textContent = mpMax;
  $('#derived-mpmax-sub').textContent = `${c.primary.mp} base × ${mpMult}`;
  $('#derived-pp').textContent = pp;
  $('#derived-pr').textContent = BUILDS[c.build].prIniziali;

  $('#hud-build').textContent = BUILDS[c.build].label;
  $('#hud-lv').textContent = c.livello;
  $('#derived-ap').textContent = Number(c.apDisponibili) || 0;

  if (!c.buildConfirmed) {
    // classe non ancora confermata: i massimali seguono automaticamente il
    // moltiplicatore della classe selezionata (base × mult), ma i punti già
    // spesi (USO) vengono preservati attraverso i ricalcoli
    const hpSpent = Math.max(0, (c.hpMaxTracked ?? hpMax) - (c.hpCur ?? (c.hpMaxTracked ?? hpMax)));
    const mpSpent = Math.max(0, (c.mpMaxTracked ?? mpMax) - (c.mpCur ?? (c.mpMaxTracked ?? mpMax)));
    const prMaxNew = BUILDS[c.build].prIniziali;
    const prSpent = Math.max(0, (c.prMaxTracked ?? prMaxNew) - (c.prCur ?? (c.prMaxTracked ?? prMaxNew)));
    const ppMaxOld = (c.hpMaxTracked ?? hpMax) / 2 + (c.mpMaxTracked ?? mpMax) / 2;
    const ppSpent = Math.max(0, ppMaxOld - (c.ppCur ?? ppMaxOld));
    c.hpMaxTracked = hpMax;
    c.mpMaxTracked = mpMax;
    c.prMaxTracked = prMaxNew;
    c.hpCur = clamp(hpMax - hpSpent, 0, hpMax);
    c.mpCur = clamp(mpMax - mpSpent, 0, mpMax);
    c.prCur = clamp(prMaxNew - prSpent, 0, prMaxNew);
    const ppMaxNew = hpMax / 2 + mpMax / 2;
    c.ppCur = clamp(ppMaxNew - ppSpent, 0, ppMaxNew);
  } else {
    // classe confermata: i massimali sono ufficializzati e crescono
    // solo con i level-up (seed al primo uso se mancanti)
    if (c.hpMaxTracked === null) c.hpMaxTracked = hpMax;
    if (c.mpMaxTracked === null) c.mpMaxTracked = mpMax;
    if (c.prMaxTracked === null) c.prMaxTracked = BUILDS[c.build].prIniziali;
    if (c.hpCur === null) c.hpCur = c.hpMaxTracked;
    if (c.mpCur === null) c.mpCur = c.mpMaxTracked;
    if (c.prCur === null) c.prCur = c.prMaxTracked;
  }

  updatePlayBars(c);
}

function updatePlayBars(c) {
  const ppMax = (c.hpMaxTracked || 0) / 2 + (c.mpMaxTracked || 0) / 2;
  if (c.ppCur === null || c.ppCur === undefined) c.ppCur = ppMax;
  const hpMaxEff = effectiveHpMax(c), mpMaxEff = effectiveMpMax(c), prMaxEff = effectivePrMax(c);

  // il campo mostra il massimo effettivo (incrementi attivi inclusi); se
  // l'utente lo modifica a mano, l'eventuale incremento resta scorporato
  // dal massimo base tracciato
  $('#hp-max').value = hpMaxEff;
  $('#mp-max').value = mpMaxEff;
  $('#hud-pr-max').value = prMaxEff;

  c.hpCur = clamp(c.hpCur, 0, hpMaxEff);
  c.mpCur = clamp(c.mpCur, 0, mpMaxEff);
  c.ppCur = clamp(c.ppCur, 0, ppMax);
  c.prCur = clamp(c.prCur, 0, prMaxEff);

  $('#hp-cur').textContent = c.hpCur;
  $('#mp-cur').textContent = c.mpCur;
  $('#pp-cur').textContent = c.ppCur;
  $('#pp-max').textContent = ppMax;
  $('#hud-pr').textContent = c.prCur;

  $('#hp-bar').style.width = pct(c.hpCur, hpMaxEff) + '%';
  $('#mp-bar').style.width = pct(c.mpCur, mpMaxEff) + '%';
  $('#pp-bar').style.width = pct(c.ppCur, ppMax) + '%';
  $('#hp-bar-name').classList.toggle('buffed', buffTotal(c, 'hp') !== 0);
  $('#mp-bar-name').classList.toggle('buffed', buffTotal(c, 'mp') !== 0);
  // Cuscinetto HP di Sovracura: persistente, mai legato a hpMaxEff/hpCur —
  // solo un'etichetta informativa qui, il drenaggio vero avviene in
  // applyDamageDrainingBuffer.
  const bufferBadge = $('#hp-buffer-badge');
  if (bufferBadge) {
    const buf = Math.max(0, Math.round(Number(c.hpBuffer) || 0));
    bufferBadge.textContent = `🔷 +${buf}`;
    bufferBadge.classList.toggle('hidden', buf <= 0);
  }
  renderKoStatus(c);
  renderDiagram(c);
}
function pct(cur, max) { return max > 0 ? clamp((cur / max) * 100, 0, 100) : 0; }

/* Applica del danno agli HP del personaggio, drenando PRIMA il cuscinetto
   di Sovracura (c.hpBuffer) e solo per l'eccedenza gli HP veri — stesso
   principio "assorbe fino a esaurirsi, mai oltre il danno reale" già in uso
   lato server per apply_combat_attack_damage, qui per i due punti in cui
   il danno si applica a mano sul fronte scheda (fuori da un vero
   incontro di combattimento, dove droga il servizio è già gestito server-
   side). */
function applyDamageDrainingBuffer(c, amount) {
  const dmg = Math.max(0, Math.floor(Number(amount)) || 0);
  const fromBuffer = Math.min(Math.max(0, Number(c.hpBuffer) || 0), dmg);
  c.hpBuffer = Math.max(0, (Number(c.hpBuffer) || 0) - fromBuffer);
  const remaining = dmg - fromBuffer;
  if (remaining > 0) c.hpCur = clamp(c.hpCur - remaining, 0, effectiveHpMax(c));
}

/* ---------------------------------------------------------- riposo/P.R. */

/* Riposo o meditazione: il moltiplicatore (0-24, a scaglioni di un quarto,
   pensato come ore di riposo) applicato al P.R. effettivo dà il totale di
   punti che si possono togliere dall'Uso di HP e MP, divisi come si vuole
   tra i due. Il pannello è puramente transitorio (nessun campo salvato sul
   personaggio): si azzera ogni volta che si apre una scheda. */
function riposoState(c) {
  const mult = Math.max(0, Number($('#riposo-moltiplicatore').value) || 0);
  const budget = Math.floor(effectivePrMax(c) * mult);
  const hpUso = Math.max(0, effectiveHpMax(c) - (c.hpCur || 0));
  const mpUso = Math.max(0, effectiveMpMax(c) - (c.mpCur || 0));
  const ppUso = Math.max(0, effectivePpMax(c) - (Number(c.ppCur) || 0));
  return { budget, hpUso, mpUso, ppUso };
}
function syncRiposoInputs(c, changed) {
  const { budget, hpUso, mpUso, ppUso } = riposoState(c);
  const vals = {
    hp: clamp(Math.floor(Number($('#riposo-hp').value)) || 0, 0, hpUso),
    mp: clamp(Math.floor(Number($('#riposo-mp').value)) || 0, 0, mpUso),
    pp: clamp(Math.floor(Number($('#riposo-pp').value)) || 0, 0, ppUso)
  };
  if (changed && vals[changed] > budget) vals[changed] = budget;
  // il campo appena toccato dall'utente ha sempre la priorità: gli altri due
  // si riducono, nell'ordine, per restare nel totale disponibile
  const reduceOrder = ['hp', 'mp', 'pp'].filter(k => k !== changed);
  let used = vals.hp + vals.mp + vals.pp;
  for (const k of reduceOrder) {
    if (used <= budget) break;
    const cut = Math.min(vals[k], used - budget);
    vals[k] -= cut;
    used -= cut;
  }
  $('#riposo-hp').value = vals.hp;
  $('#riposo-mp').value = vals.mp;
  $('#riposo-pp').value = vals.pp;
  $('#riposo-residuo').textContent = Math.max(0, budget - used);
}
function renderRiposoPanel(c) {
  $('#riposo-pr-eff').textContent = effectivePrMax(c);
  $('#riposo-totale').textContent = riposoState(c).budget;
  syncRiposoInputs(c);
}
function resetRiposoPanel() {
  const panel = $('#riposo-panel');
  if (!panel) return;
  panel.classList.add('hidden');
  $('#riposo-moltiplicatore').value = 0;
  $('#riposo-hp').value = 0;
  $('#riposo-mp').value = 0;
  $('#riposo-pp').value = 0;
  $('#riposo-totale').textContent = 0;
  $('#riposo-residuo').textContent = 0;
  $('#riposo-pr-eff').textContent = 0;
}

/* ------------------------------------------- diagramma scheda (fronte) */

/* Ogni voce: chiave dato, posizione (coordinate viewBox 320x430) e
   larghezza input in % del contenitore. p: primaria · t: terziaria */
const DIAGRAM_SPEC = [
  { key: 'lv',      x: 37,  y: 27,  w: 13, label: 'Livello' },
  { key: 'qi',      x: 283, y: 27,  w: 13, label: 'Quoziente Intellettivo' },
  { key: 'p:mira',  x: 160, y: 55,  w: 11, label: 'Mira' },
  { key: 'p:dex',   x: 120, y: 95,  w: 11, label: 'Destrezza' },
  { key: 'p:dif',   x: 200, y: 95,  w: 11, label: 'Difesa' },
  { key: 'p:for',   x: 160, y: 135, w: 11, label: 'Forza' },
  { key: 'p:vel',   x: 120, y: 175, w: 11, label: 'Velocità' },
  { key: 'p:dmen',  x: 200, y: 175, w: 11, label: 'Difesa Mentale' },
  { key: 'p:fmen',  x: 160, y: 215, w: 11, label: 'Forza Mentale' },
  { key: 't:carisma', x: 120, y: 255, w: 11, label: 'Carisma' },
  { key: 't:stile',   x: 200, y: 255, w: 11, label: 'Stile' },
  { key: 't:fortuna', x: 160, y: 295, w: 11, label: 'Fortuna' },
  { key: 'hprim',   x: 90,  y: 345, w: 13, label: 'HP correnti' },
  { key: 'hpko',    x: 70,  y: 368, w: 9, ro: true, label: 'Soglia K.O. HP' },
  { key: 'hpuso',   x: 112, y: 368, w: 9, label: 'HP in uso (danno subito)' },
  { key: 'mprim',   x: 230, y: 345, w: 13, label: 'MP correnti' },
  { key: 'mpko',    x: 250, y: 368, w: 9, ro: true, label: 'Soglia K.O. MP' },
  { key: 'mpuso',   x: 208, y: 368, w: 9, label: 'MP in uso' },
  { key: 'prcur',   x: 160, y: 385, w: 11, label: 'P.R. correnti' }
];

function initDiagram() {
  $('#dg-inputs').innerHTML = DIAGRAM_SPEC.map(f =>
    `<input type="number" class="dg-input${f.ro ? ' dg-ro' : ''}" data-dg="${f.key}" aria-label="${escapeHtml(f.label)}" ${f.ro ? 'readonly tabindex="-1"' : ''} style="left:${(f.x / 320 * 100).toFixed(2)}%;top:${(f.y / 430 * 100).toFixed(2)}%;width:${f.w}%;">`
  ).join('');
}


function diagramValue(c, key) {
  // gli incrementi da consumabile si sommano al valore base finché attivi
  if (key.startsWith('p:')) return c.primary[key.slice(2)] + buffTotal(c, key.slice(2));
  if (key.startsWith('t:')) return c.tertiary[key.slice(2)];
  if (key === 'lv') return c.livello;
  if (key === 'qi') return c.qi;
  // HP/MP: punti rimanenti — partono dal massimo (moltiplicatore + level-up
  // + eventuali incrementi attivi) e si riducono in base a quanto scritto in USO
  if (key === 'hprim') return c.hpCur;
  if (key === 'mprim') return c.mpCur;
  // USO: punti spesi (danni subiti / abilità usate) = max - correnti
  if (key === 'hpuso') return Math.max(0, effectiveHpMax(c) - (c.hpCur || 0));
  if (key === 'mpuso') return Math.max(0, effectiveMpMax(c) - (c.mpCur || 0));
  // K.O.: soglia di cedimento = 10% del massimo (calcolo automatico)
  if (key === 'hpko') return koThreshold(c);
  if (key === 'mpko') return Math.ceil(effectiveMpMax(c) * KO_THRESHOLD_PCT);
  if (key === 'prcur') return c.prCur;
  return null;
}

function diagramBuffed(c, key) {
  if (key.startsWith('p:')) return buffTotal(c, key.slice(2)) !== 0;
  if (key === 'hprim' || key === 'hpuso' || key === 'hpko') return buffTotal(c, 'hp') !== 0;
  if (key === 'mprim' || key === 'mpuso' || key === 'mpko') return buffTotal(c, 'mp') !== 0;
  return false;
}

function renderDiagram(c) {
  $$('#stat-diagram [data-dg]').forEach(inp => {
    inp.classList.toggle('dg-buffed', diagramBuffed(c, inp.dataset.dg));
    if (inp === document.activeElement) return;
    const v = diagramValue(c, inp.dataset.dg);
    inp.value = (v === null || v === undefined) ? '' : v;
  });
}

/* ------------------------------------------------------------ terziarie */

function renderTertiaryStats(c) {
  const wrap = $('#tertiary-stats');
  wrap.innerHTML = TERTIARY_STATS.map(stat => {
    const val = c.tertiary[stat.key];
    const floor = tertiaryFloorFor(c, stat.key);
    // il valore base resta impostabile a mano nel campo; il bonus da
    // equipaggiamento compare solo come chip a fianco (come per le
    // primarie), non nel diagramma: quel campo ha un solo input, non c'è
    // spazio per separare base ed effettivo senza confondere la modifica
    const buff = equipBonusTotal(c, 'tertiary', stat.key);
    return `<div class="stat-row">
      <div class="stat-info">
        <div class="stat-label neutral${buff ? ' buffed' : ''}"><span class="abbr">${stat.label}</span></div>
        <div class="stat-row-secondary"${buff ? '' : ' hidden'}>${buff ? `+${buff} equip.` : ''}</div>
      </div>
      <div class="stepper">
        <button data-tstat="${stat.key}" data-dir="-1" aria-label="Diminuisci ${escapeHtml(stat.label)}">−</button>
        <input type="number" data-tstat-input="${stat.key}" value="${val}" min="${floor}" aria-label="Valore attuale di ${escapeHtml(stat.label)}">
        <button data-tstat="${stat.key}" data-dir="1" aria-label="Aumenta ${escapeHtml(stat.label)}">+</button>
      </div>
    </div>`;
  }).join('');
  updateTertiaryRemaining(c);
}
function updateTertiaryRemaining(c) {
  const label = $('#tertiary-remaining-label');
  const el = $('#tertiary-remaining');
  const leveled = Number(c.livello) > 1;
  if (leveled) {
    label.textContent = 'AP disponibili';
    el.textContent = Number(c.apDisponibili) || 0;
    el.className = 'remaining';
  } else {
    const sum = TERTIARY_STATS.reduce((s, k) => s + Number(c.tertiary[k.key] || 0), 0);
    const remaining = TERTIARY_POOL - sum;
    label.textContent = 'Punti rimanenti';
    el.textContent = remaining;
    el.className = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));
  }
}
function renderTertiaryRefTable() {
  $('#tertiary-ref-table').innerHTML = TERTIARY_ROLL_TABLE.map(r =>
    `<tr><td class="num">${r.range}</td><td>${r.carisma}</td><td>${r.altro}</td></tr>`
  ).join('');
}

/* ------------------------------------------------------------------ QI */

function renderQi(c) {
  $('#qi-result').textContent = c.qi !== null ? c.qi : '—';
  $('#f-qi-progresso').value = c.qiProgresso || 0;
  if (c.qi !== null) {
    $('#qi-limite-chip').textContent = `0 / ${qiLimite(c.qi)}`;
  } else {
    $('#qi-limite-chip').textContent = '—';
  }
}

/* --------------------------------------------------------------- tratti */

function normalizedTraitName(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
function traitNameDistance(a, b) {
  const x = normalizedTraitName(a), y = normalizedTraitName(b);
  if (!x || !y) return Infinity;
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return row[y.length];
}
function similarTraitCandidate(c, list, name, excludeIdx) {
  const norm = normalizedTraitName(name);
  if (!norm) return null;
  const candidates = [
    ...TRAIT_LISTS[list].map(n => ({ kind: 'official', name: n })),
    ...(c.customTraits[list] || []).map((t, i) => ({ kind: 'custom', name: t.name, idx: i, narratore: !!t.narratore }))
      .filter(t => t.idx !== excludeIdx && t.name),
    ...((c.cloudCampaignId && campaignTraitsCache[c.cloudCampaignId] && campaignTraitsCache[c.cloudCampaignId][list]) || [])
      .map(n => ({ kind: 'known', name: n }))
  ];
  const exact = candidates.find(t => normalizedTraitName(t.name) === norm);
  if (exact) return exact;
  const maxDistance = norm.length >= 8 ? 2 : norm.length >= 4 ? 1 : 0;
  if (!maxDistance) return null;
  return candidates.map(t => ({ ...t, distance: traitNameDistance(name, t.name) }))
    .filter(t => t.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))[0] || null;
}
function reconcileCustomTrait(c, list, idx, previousName) {
  const row = c.customTraits[list] && c.customTraits[list][idx];
  if (!row || !String(row.name || '').trim()) return { changed: false, name: '' };
  row.name = String(row.name).trim();
  const match = similarTraitCandidate(c, list, row.name, idx);
  if (!match || (match.kind === 'custom' && !!match.narratore !== !!row.narratore)) {
    return { changed: false, name: row.name };
  }
  const value = Number(row.value) || 0;
  const oldFloor = traitFloorFor(c, list, previousName || row.name);
  if (match.kind === 'official') {
    c.traits[list][match.name] = Math.min(50, (Number(c.traits[list][match.name]) || 0) + value);
    if (!(c.shownTraits[list] || []).includes(match.name)) c.shownTraits[list].push(match.name);
    if (!c.traitsFloor[list]) c.traitsFloor[list] = {};
    c.traitsFloor[list][match.name] = Math.min(50, (c.traitsFloor[list][match.name] || 0) + oldFloor);
    c.customTraits[list].splice(idx, 1);
  } else if (match.kind === 'custom') {
    const target = c.customTraits[list][match.idx];
    target.value = Math.min(50, (Number(target.value) || 0) + value);
    if (!c.traitsFloor[list]) c.traitsFloor[list] = {};
    c.traitsFloor[list][target.name] = Math.min(50, (c.traitsFloor[list][target.name] || 0) + oldFloor);
    c.customTraits[list].splice(idx, 1);
  } else {
    row.name = match.name;
    if (oldFloor > 0) {
      if (!c.traitsFloor[list]) c.traitsFloor[list] = {};
      c.traitsFloor[list][match.name] = Math.max(c.traitsFloor[list][match.name] || 0, oldFloor);
    }
  }
  return { changed: true, name: match.name };
}

function renderTraits(c) {
  const wrap = $('#trait-lists');
  // Il Narratore in modifica libera di una scheda (narratorEditMode) può
  // scavalcare il blocco "tratti confermati", stesso trattamento già in uso
  // per le statistiche primarie (vedi renderPrimaryStats): il tetto punti
  // per categoria (traitsPoolForCharacter/traitsRemainingForList) resta
  // comunque valido indipendentemente da questo, applicato nell'handler
  // dell'input (vedi sotto, wiring '#trait-lists' 'input').
  const locked = c.traitsConfirmed && !narratorEditMode;
  // fuori da una campagna il campo resta libero come sempre: il "database"
  // di tratti condivisi esiste solo per i personaggi dentro una storia
  const campaignId = c.cloudCampaignId;
  if (campaignId && !campaignTraitsCache[campaignId]) {
    fetchCampaignKnownTraits(campaignId).then(() => { if (getActive() === c) renderTraits(c); });
  }
  const known = campaignId ? cachedCampaignKnownTraits(campaignId) : null;
  wrap.innerHTML = Object.keys(TRAIT_LISTS).map(listKey => {
    const shown = c.shownTraits[listKey] || [];
    const rows = TRAIT_LISTS[listKey]
      .filter(name => shown.includes(name))
      .map(name => traitRowHtml(listKey, name, c.traits[listKey][name] || 0, false, undefined, locked, false,
        listKey === 'capacitaCombattive' ? equipDefensiveBonusForHit(c, 'trait', name, listKey, null) : equipBonusTotal(c, 'trait', name, listKey),
        listKey === 'capacitaCombattive' ? equipDefensiveBonusRange(c, 'trait', name, listKey) : null,
        traitFloorFor(c, listKey, name)));
    const customRows = (c.customTraits[listKey] || []).map((t, i) => traitRowHtml(listKey, t.name, t.value, true, i, locked, t.narratore,
      listKey === 'capacitaCombattive' ? equipDefensiveBonusForHit(c, 'trait', t.name, listKey, null) : equipBonusTotal(c, 'trait', t.name, listKey),
      listKey === 'capacitaCombattive' ? equipDefensiveBonusRange(c, 'trait', t.name, listKey) : null,
      traitFloorFor(c, listKey, t.name)));
    const empty = !rows.length && !customRows.length
      ? `<div class="helper-text" style="padding:2px 2px 6px;">Nessun tratto ancora — aggiungine uno dal menù qui sotto.</div>` : '';
    const available = TRAIT_LISTS[listKey].filter(name => !shown.includes(name));
    // tratti già scritti da qualcun altro in questa storia (né ufficiali né
    // già presenti su questa scheda): pescabili senza doverli riscrivere
    const alreadyOnSheet = new Set([...TRAIT_LISTS[listKey], ...(c.customTraits[listKey] || []).map(t => t.name)]);
    const knownExtra = known ? known[listKey].filter(n => n && !alreadyOnSheet.has(n)) : [];
    return `<div class="section-title"><span class="dot neutral"></span>${TRAIT_LIST_LABELS[listKey]} <span class="chip" style="margin-left:auto;">${rows.length + customRows.length}</span></div>
      <div class="trait-group" data-list="${listKey}">
        ${empty}
        ${rows.join('')}
        ${customRows.join('')}
      </div>
      <select class="trait-add-select" data-addtraitsel="${listKey}" aria-label="Aggiungi tratto — ${escapeHtml(TRAIT_LIST_LABELS[listKey])}" ${locked ? 'disabled' : ''}>
        <option value="" selected disabled>+ Aggiungi tratto…</option>
        ${available.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
        ${knownExtra.length ? `<optgroup label="Già usati in questa storia">${knownExtra.map(n => `<option value="known::${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}</optgroup>` : ''}
        <option value="__custom__">Tratto personalizzato…</option>
      </select>`;
  }).join('');
  updateTraitsRemaining(c);
  renderTraitRollSelect(c);
}
/* Punti spesi in una singola categoria (conoscenze/capacitaNormali/
   capacitaCombattive): tre "tipologie di punti" separate e non fungibili
   tra loro — traitsPoolForList (data.js) ne calcola il tetto per livello. */
function traitsSumForList(c, listKey) {
  let sum = 0;
  TRAIT_LISTS[listKey].forEach(name => { sum += Number(c.traits[listKey][name]) || 0; });
  // i tratti scritti di suo pugno dal Narratore sono un dono: non consumano
  // il pool del giocatore, restano fuori da questo conteggio
  (c.customTraits[listKey] || []).forEach(t => { if (!t.narratore) sum += Number(t.value) || 0; });
  return sum;
}
/* Tetto di punti spendibili in una categoria: pool di livello (data.js) +
   eventuali punti concessi dal Narratore per motivi di trama. */
function traitsPoolForCharacter(c, listKey) {
  return traitsPoolForList(listKey, c.livello || 1) + ((c.traitNarratoreBonus && c.traitNarratoreBonus[listKey]) || 0);
}
function traitsRemainingForList(c, listKey) {
  return traitsPoolForCharacter(c, listKey) - traitsSumForList(c, listKey);
}
function allTraitsAtZero(c) {
  return Object.keys(TRAIT_LISTS).every(k => traitsRemainingForList(c, k) === 0);
}
function updateTraitsRemaining(c) {
  const rowsEl = $('#traits-remaining-rows');
  if (rowsEl) {
    const rowsHtml = Object.keys(TRAIT_LISTS).map(listKey => {
      const remaining = traitsRemainingForList(c, listKey);
      const bonus = traitBonusAtLevel(c.livello || 1)[listKey] || 0;
      const narratoreBonus = (c.traitNarratoreBonus && c.traitNarratoreBonus[listKey]) || 0;
      const cls = 'remaining' + (remaining < 0 ? ' neg' : (remaining === 0 ? ' zero' : ''));
      const extra = [bonus ? `${bonus} dai level-up` : '', narratoreBonus ? `${narratoreBonus} dal Narratore` : ''].filter(Boolean).join(' + ');
      return `<div class="pointbuy-header">
        <span class="label">${TRAIT_LIST_LABELS[listKey]}${extra ? ` (${TRAIT_POOL_PER_LIST} + ${extra})` : ''}</span>
        <span class="${cls}">${remaining}</span>
      </div>`;
    }).join('');
    rowsEl.innerHTML = rowsHtml;
  }
  renderTraitsLockStatus(c);
}
/* Il bottone di conferma resta disabilitato se una categoria è negativa
   (può succedere con dati importati, con il livello ridotto a mano dopo
   aver speso i punti del bonus, o corretti manualmente): non si può
   blindare una scheda già fuori dalle regole. */
function renderTraitsLockStatus(c) {
  const el = $('#traits-lock-status');
  if (!el) return;
  const box = $('#traits-lock-status-box');
  // nel wizard di creazione non c'è conferma per-sezione: si blocca tutto
  // insieme alla fine (vedi wizardFinalConfirm) — il box va nascosto anche
  // lui, altrimenti resta una card vuota (bordo+sfondo senza contenuto).
  if (wizardActive) { el.innerHTML = ''; if (box) box.classList.add('hidden'); return; }
  if (box) box.classList.remove('hidden');
  if (c.traitsConfirmed) {
    el.innerHTML = `<div class="row-between"><span class="chip physical">🔒 Tratti confermati</span><span class="helper-text" style="margin:0;">Si sbloccano con un level-up</span></div>`;
    return;
  }
  const perList = Object.keys(TRAIT_LISTS).map(k => ({ label: TRAIT_LIST_LABELS[k], remaining: traitsRemainingForList(c, k) }));
  const blocked = perList.some(r => r.remaining !== 0);
  const positive = perList.filter(r => r.remaining > 0);
  const negative = perList.filter(r => r.remaining < 0);
  let note = '';
  if (positive.length) note = `Punti ancora da spendere: ${positive.map(r => `${r.label} ${r.remaining}`).join(' · ')}.`;
  else if (negative.length) note = `Punti rimanenti negativo in ${negative.map(r => r.label).join(', ')}: riduci qualche tratto prima di confermare.`;
  el.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-confirm-traits" ${blocked ? 'disabled' : ''}>Conferma tratti</button>`
    + (note ? `<p class="helper-text" style="margin:6px 0 0;color:var(--fisico-forte);">${note}</p>` : '');
}
/* Selettore del tool "Tiro tratto": un dado unico (1d20 + valore del
   tratto) invece di un tasto di tiro per riga, per lasciare spazio in
   larghezza sul telefono. Elenca i tratti posseduti, più un'opzione per
   un tiro non addestrato (1d100, nessun modificatore) su qualcosa che
   non è in scheda. */
function renderTraitRollSelect(c) {
  const sel = $('#trait-roll-select');
  if (!sel) return;
  const prevVal = sel.value;
  const groups = Object.keys(TRAIT_LISTS).map(listKey => {
    const shown = c.shownTraits[listKey] || [];
    const rows = shown.map(name => ({ name, value: (Number(c.traits[listKey][name]) || 0) + equipBonusTotal(c, 'trait', name, listKey) }));
    (c.customTraits[listKey] || []).forEach(t => { if (t.name) rows.push({ name: t.name, value: (Number(t.value) || 0) + equipBonusTotal(c, 'trait', t.name, listKey) }); });
    if (!rows.length) return '';
    const opts = rows.map(r => `<option value="${listKey}::${escapeHtml(r.name)}">${escapeHtml(r.name)} (+${r.value})</option>`).join('');
    return `<optgroup label="${TRAIT_LIST_LABELS[listKey]}">${opts}</optgroup>`;
  }).join('');
  sel.innerHTML = '<option value="__unknown__">Altro (non in scheda) — d100</option>' + groups;
  if (prevVal && sel.querySelector(`option[value="${cssEscapeAttr(prevVal)}"]`)) sel.value = prevVal;
}
function cssEscapeAttr(v) {
  return v.replace(/["\\]/g, '\\$&');
}

function traitRowHtml(listKey, name, value, isCustom, idx, locked, narratore, equipBonus, equipRange, floor) {
  const base = Number(value) || 0;
  const bonus = Number(equipBonus) || 0;
  const effective = base + bonus;
  // un tratto scritto dal Narratore non è mai modificabile o rimovibile dal
  // giocatore, a prescindere dal blocco tratti: è un dono che gestisce solo
  // lui, dal suo Account
  const rowLocked = locked || narratore;
  const nameHtml = isCustom
    ? `<input type="text" value="${escapeHtml(name)}" data-original-name="${escapeHtml(name)}" data-customname="${listKey}" data-idx="${idx}" ${rowLocked ? 'disabled' : ''} placeholder="Nome tratto">`
    : escapeHtml(name);
  const badge = narratore ? ` <span class="chip buff-chip" title="Scritto dal Narratore: non consuma i punti del giocatore, modificabile solo da lui">Narratore</span>` : '';
  // Capacità Combattive (tratti da tiro di resistenza): l'equip qui arriva
  // solo dal pezzo d'armatura che copre la parte colpita, mai da tutti i
  // pezzi insieme — il badge mostra il range min–max invece di un unico
  // numero, il "t-dice" resta un valore medio unico (stesso criterio del
  // colpo generico) per avere comunque un totale utilizzabile a colpo d'occhio.
  const equipBadge = equipRange
    ? (equipRange.min || equipRange.max ? ` <span class="chip buff-chip-equip" title="Bonus da equipaggiamento in base a dove verrà colpito: solo il pezzo d'armatura sulla parte colpita protegge questo tratto, arma/scudo restano sempre attivi">+${equipRange.min}/+${equipRange.max} equip.</span>` : '')
    : (bonus ? ` <span class="chip buff-chip-equip" title="Bonus da arma/scudo equipaggiato: momentaneo, dura finché il pezzo resta equipaggiato">+${bonus} equip.</span>` : '');
  return `<div class="trait-row" data-trait="${escapeHtml(name)}" data-list="${listKey}" ${isCustom ? `data-custom-idx="${idx}"` : ''} ${narratore ? 'data-narratore="1"' : ''}>
    <div class="t-name">${nameHtml}${badge}${equipBadge}</div>
    <span class="t-dice" title="${bonus ? `Base ${base} + equipaggiamento ${bonus}${equipRange ? ' (media fra i pezzi indossati: dipende da dove verrai colpito, vedi il bollino accanto per il range)' : ''}` : 'Valore base'}">+${effective}</span>
    <div class="stepper trait-stepper">
      <button type="button" data-traitstep="-1" class="${base <= (Number(floor) || 0) ? 'hidden' : ''}" aria-label="Diminuisci ${escapeHtml(name)}" ${rowLocked ? 'disabled' : ''}>▼</button>
      <input type="number" value="${base}" min="${Number(floor) || 0}" max="50" data-traitvalue="${escapeHtml(name)}" data-list="${listKey}" ${isCustom ? `data-custom-idx="${idx}"` : ''} ${rowLocked ? 'disabled' : ''}>
      <button type="button" data-traitstep="1" aria-label="Aumenta ${escapeHtml(name)}" ${rowLocked ? 'disabled' : ''}>▲</button>
    </div>
    <button class="btn btn-icon btn-sm btn-ghost btn-roll" data-traitroll="${escapeHtml(name)}" data-list="${listKey}" title="Tira 1d20+valore">🎲</button>
    ${(Number(floor) || 0) > 0 ? '' : isCustom
      ? `<button class="btn btn-icon btn-sm btn-ghost btn-del" data-delcustom="${listKey}" data-idx="${idx}" title="Rimuovi" ${rowLocked ? 'disabled' : ''}>✕</button>`
      : `<button class="btn btn-icon btn-sm btn-ghost btn-del" data-hidetrait="${escapeHtml(name)}" data-list="${listKey}" title="Rimuovi" ${locked ? 'disabled' : ''}>✕</button>`}
  </div>`;
}
/* --------------------------------------------------------------- livelli */

/* AP guadagnati raggiungendo un livello (tabella limiti di livello) */
function apForLevel(lv) {
  const r = LEVEL_TABLE.find(x => x.lv === lv);
  return r ? r.ap : 0;
}

/* Unico punto di aggiornamento per ogni box "AP disponibili" in scheda: gli
   AP sono un pool condiviso (primarie, terziarie, P.R.), ma ciascuna sezione
   ha il proprio box con la propria etichetta — senza richiamarli tutti da
   qui, spendere AP in una sezione lasciava le altre ferme al valore letto
   l'ultima volta che erano state toccate direttamente (bug segnalato). */
function refreshApUI(c) {
  const apInput = $('#f-ap-disponibili');
  apInput.value = c.apDisponibili;
  // Editabile solo dal Narratore in narratorEditMode (vedi il suo handler
  // 'change'): per il giocatore resta un puro visualizzatore, invariato.
  apInput.disabled = !narratorEditMode;
  const t = $('#derived-ap');
  if (t) t.textContent = c.apDisponibili;
  updatePrimaryRemaining(c);
  updateTertiaryRemaining(c);
}

/* Accredita (o storna) automaticamente gli AP dei livelli attraversati.
   c.livelloAP è l'ultimo livello per cui gli AP sono già stati conteggiati. */
function creditLevelAP(c) {
  const from = typeof c.livelloAP === 'number' ? c.livelloAP : c.livello;
  const to = c.livello;
  if (to === from) return;
  const crossedLevels = to > from ? Array.from({ length: to - from }, (_, i) => from + i + 1) : [];
  let delta = 0;
  if (to > from) { for (let l = from + 1; l <= to; l++) delta += apForLevel(l); }
  else { for (let l = from; l > to; l--) delta -= apForLevel(l); }
  c.livelloAP = to;
  // un level-up sblocca di nuovo le statistiche/i tratti confermati, per
  // poter spendere i nuovi punti; vanno riconfermati per bloccarli di nuovo
  const unlockedPrimary = to > from && c.primaryConfirmed;
  const hasTraitReward = crossedLevels.some(l => {
    const g = perkGainForLevel(l);
    return g.capacitaNormali || g.capacitaCombattive || g.conoscenze;
  });
  const unlockedTraits = to > from && hasTraitReward && c.traitsConfirmed;
  if (unlockedPrimary) { c.primaryConfirmed = false; renderPrimaryStats(c); }
  if (unlockedTraits) { c.traitsConfirmed = false; renderTraits(c); }
  // stesso meccanismo per il Tipo (Supporto/Danno) di Tecniche/Abilità: un
  // level-up permette di ripensare la scelta, va riconfermata per bloccarla
  // di nuovo fino al prossimo level-up.
  const tecAbRows = [...(c.tecniche || []), ...(c.abilita || [])];
  const crossedTecabReward = crossedLevels.some(l => TECAB_CLASS_LEVELS.includes(l) || TECAB_ALL_LEVELS.includes(l));
  const unlockedTecAbTipo = to > from && (from < 20 || crossedTecabReward)
    && tecAbRows.some(r => r.tipoConfirmed);
  if (unlockedTecAbTipo) {
    tecAbRows.forEach(r => { r.tipoConfirmed = false; });
    renderTecniche(c);
    renderAbilita(c);
  }
  if (!Array.isArray(c.boostSupremeAwards)) c.boostSupremeAwards = [];
  const newBoostAwards = [25, 30].filter(l => crossedLevels.includes(l) && !c.boostSupremeAwards.includes(l));
  if (newBoostAwards.length) {
    c.boostSupremeAwards.push(...newBoostAwards);
    c.boostSupremeCredits = Math.max(0, Number(c.boostSupremeCredits) || 0) + newBoostAwards.length;
  }
  const unlockedBoost = to > from && (from < 20 || newBoostAwards.length > 0)
    && (c.boostRows || []).some(r => r.boostConfirmed);
  if (unlockedBoost) {
    c.boostRows.forEach(r => { r.boostConfirmed = false; });
    renderBoostRows(c);
  }
  const unlocked = unlockedPrimary || unlockedTraits || unlockedTecAbTipo || unlockedBoost;
  if (!delta) { if (unlocked) touchActive(); return; }
  // Un calo di livello non deve mai lasciare un debito di AP (nessun senso
  // di gioco per un valore negativo): al più azzera quanto disponibile,
  // non sottrae oltre — stesso principio già in uso per HP/MP a 0.
  c.apDisponibili = Math.max(0, (Number(c.apDisponibili) || 0) + delta);
  c.ledger.push({
    id: uid(),
    desc: to > from ? `Level up Lv ${from} → ${to}` : `Livello ridotto Lv ${from} → ${to}`,
    amt: delta,
    gain: true,
    ts: Date.now()
  });
  refreshApUI(c);
  updatePrimaryRemaining(c);
  const base = delta > 0 ? `+${delta} AP disponibili (Lv ${from} → ${to})` : `${delta} AP (Lv ${from} → ${to})`;
  const unlockedWhat = [unlockedPrimary && 'statistiche', unlockedTraits && 'tratti', newBoostAwards.length && 'credito Boost supremo'].filter(Boolean).join(' e ');
  toast(unlocked ? `${base} — ${unlockedWhat} sbloccat${unlockedWhat.endsWith('e') ? 'e' : 'i'}` : base);
  touchActive();
}

/* Cambia un attributo primario. Al Lv1 gli attributi si assegnano ancora
   liberamente coi 40 punti di partenza (scegliere/confermare la classe non
   chiude questa fase, ma non si può comunque superare il pool): il punteggio
   base di HP/MP in questa fase interagisce col moltiplicatore di classe.
   Solo dopo il primo Lv Up ogni attributo si compra con gli AP guadagnati a
   level up: HP e MP smettono di usare il moltiplicatore e crescono in
   diretta sul totale (c.hpMaxTracked/c.mpMaxTracked, congelando il
   punteggio base scelto in creazione) secondo la loro tabella dedicata; gli
   altri attributi (e i P.R., gestiti a parte) seguono la tabella generica.
   La spesa è automatica, la riduzione rimborsa, e senza AP il cambio è
   bloccato. Una volta confermate (primaryConfirmed), le statistiche sono
   bloccate del tutto finché un level-up non le sblocca di nuovo.
   Restituisce il valore applicato o null se bloccato. */
/* Al momento della conferma, registra il valore attuale di ogni statistica
   primaria (il totale per HP/MP quando "cresciuta" oltre il moltiplicatore
   di classe): da quel momento, ogni volta che un level-up sblocca di nuovo
   le statistiche, non si potrà scendere sotto questo valore — solo salire,
   o tornare fino a questo punto. */
function snapshotPrimaryFloor(c) {
  if (!c.primaryFloor) c.primaryFloor = {};
  // le primarie e l'unica secondaria (P.R.) condividono lo stesso
  // meccanismo di "pavimento": vanno scandite insieme, altrimenti il P.R.
  // perderebbe la protezione contro un abbassamento sotto l'ultimo confermato
  [...PRIMARY_STATS, ...SECONDARY_STATS].forEach(stat => {
    const isHpMp = stat.key === 'hp' || stat.key === 'mp';
    const isPr = stat.key === 'pr';
    const grown = (isHpMp && Number(c.livello) > 1) || isPr;
    const trackedKey = stat.key === 'hp' ? 'hpMaxTracked' : stat.key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
    c.primaryFloor[stat.key] = grown ? (Number(c[trackedKey]) || 0) : (Number(c.primary[stat.key]) || 0);
  });
}
/* Minimo consentito per una statistica: il minimo assoluto di regola,
   oppure il valore registrato all'ultima conferma se più alto — non si può
   scendere sotto quanto già confermato in passato. */
function primaryFloorFor(c, key, baseFloor) {
  const stored = c.primaryFloor && typeof c.primaryFloor[key] === 'number' ? c.primaryFloor[key] : null;
  return stored !== null ? Math.max(baseFloor, stored) : baseFloor;
}
/* Stesso "pavimento" di snapshotPrimaryFloor, ma per i Tratti (Conoscenze/
   Capacità Normali/Capacità Combattive): al momento della conferma, ogni
   tratto valorizzato (standard o personalizzato, compresi i doni del
   Narratore) diventa la base da cui non si potrà più scendere al prossimo
   sblocco per level-up — senza questo, riaprire i tratti per spendere i
   nuovi punti del livello permetteva di abbassare un tratto già confermato
   fino a 0 per "liberare" punti fantasma da spostare altrove, vanificando
   il senso stesso della conferma. Math.max con un eventuale valore già
   registrato: il pavimento non scende mai, nemmeno riconfermando più volte. */
function snapshotTraitsFloor(c) {
  if (!c.traitsFloor) c.traitsFloor = {};
  Object.keys(TRAIT_LISTS).forEach(list => {
    if (!c.traitsFloor[list]) c.traitsFloor[list] = {};
    TRAIT_LISTS[list].forEach(name => {
      const v = Number(c.traits[list] && c.traits[list][name]) || 0;
      if (v > 0) c.traitsFloor[list][name] = Math.max(c.traitsFloor[list][name] || 0, v);
    });
    (c.customTraits[list] || []).forEach(t => {
      if (!t.name) return;
      const v = Number(t.value) || 0;
      if (v > 0) c.traitsFloor[list][t.name] = Math.max(c.traitsFloor[list][t.name] || 0, v);
    });
  });
}
/* Minimo consentito per UN tratto (per nome, standard o personalizzato): il
   pavimento registrato all'ultima conferma, o 0 se non è mai stato
   confermato (personaggio nuovo, o tratto aggiunto dopo l'ultima conferma). */
function traitFloorFor(c, list, name) {
  const stored = c.traitsFloor && c.traitsFloor[list] && typeof c.traitsFloor[list][name] === 'number'
    ? c.traitsFloor[list][name] : null;
  return stored !== null ? stored : 0;
}
/* Statistiche terziarie: non esiste un passaggio di "conferma" come per le
   primarie, ma ogni volta che il meccanismo dei 3 successi (dg-pm-plus) fa
   salire di livello una terziaria spendendo AP, quel valore va "blindato":
   la point-buy libera (stepper/diagramma) non può più farla scendere sotto
   quel punto, altrimenti si potrebbe pagare l'AP e poi riassegnarlo gratis
   riabbassando la statistica coi punti liberi. */
function tertiaryFloorFor(c, key) {
  if (!c.tertiaryFloor) c.tertiaryFloor = {};
  const stored = typeof c.tertiaryFloor[key] === 'number' ? c.tertiaryFloor[key] : null;
  return stored !== null ? Math.max(TERTIARY_MIN, stored) : TERTIARY_MIN;
}
/* Al Lv1 le terziarie sono un point-buy libero dal pool di 5 punti (nessun
   costo in AP, come per le primarie in fase di creazione); dal Lv2 in poi
   funzionano come le primarie: crescono spendendo AP secondo
   tertiaryApCostForPoint (TERTIARY_AP_TABLE) invece di attingere a un pool
   ormai chiuso — senza questo passaggio lo stepper poteva svuotare il pool
   ben oltre lo zero senza mai consumare AP (bug segnalato dall'utente).
   Restituisce il valore applicato, o null se bloccato (fuori range/AP
   insufficienti). */
function changeTertiary(c, key, newVal) {
  const oldVal = Number(c.tertiary[key]) || 0;
  newVal = Math.floor(Number(newVal));
  if (isNaN(newVal)) newVal = oldVal;
  const floor = tertiaryFloorFor(c, key);
  // Blocca solo un vero tentativo di scendere (newVal < oldVal): se il
  // valore attuale è già sotto il pavimento per qualunque motivo (es. una
  // modifica libera del Narratore), un "+" (newVal > oldVal) deve poter
  // avvicinarsi un punto alla volta, altrimenti resterebbe bloccato per
  // sempre — ogni singolo +1 sarebbe comunque ancora sotto la soglia.
  if (newVal < floor && newVal < oldVal) { toast(`Valore minimo raggiunto (${floor})`); return null; }
  if (newVal > TERTIARY_MAX) return null;
  if (newVal === oldVal) return oldVal;
  if (Number(c.livello) > 1) {
    let cost = 0;
    if (newVal > oldVal) { for (let n = oldVal + 1; n <= newVal; n++) cost += tertiaryApCostForPoint(n); }
    else { for (let n = oldVal; n > newVal; n--) cost -= tertiaryApCostForPoint(n); }
    const disponibili = Number(c.apDisponibili) || 0;
    if (cost > 0 && cost > disponibili) {
      toast(`AP insufficienti: servono ${cost} AP (disponibili ${disponibili})`);
      return null;
    }
    c.apDisponibili = disponibili - cost;
    refreshApUI(c);
  }
  c.tertiary[key] = newVal;
  return newVal;
}
function changePrimary(c, key, newVal) {
  const isHpMp = key === 'hp' || key === 'mp';
  const isPr = key === 'pr';
  // P.R. non ha mai una fase "pool libero" a Lv1 come gli altri attributi
  // (parte fissa dal valore di classe): e' sempre "cresciuta", comprata
  // con AP fin da subito, non appena ce ne sono.
  const grown = (isHpMp && Number(c.livello) > 1) || isPr;
  const trackedKey = key === 'hp' ? 'hpMaxTracked' : key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
  const oldVal = grown ? (Number(c[trackedKey]) || 0) : (Number(c.primary[key]) || 0);
  newVal = Math.floor(Number(newVal));
  const floor = primaryFloorFor(c, key, grown ? 0 : PRIMARY_MIN);
  if (isNaN(newVal) || newVal < floor) newVal = floor;
  // P.R.: 50 è il valore massimo raggiungibile (regola ufficiale)
  if (isPr && newVal > PR_MAX) newVal = PR_MAX;
  if (newVal === oldVal) return newVal;
  // Il Narratore in modifica libera di una scheda (narratorEditMode) può
  // scavalcare solo il blocco "statistiche confermate": il costo/rimborso
  // in AP resta lo stesso identico meccanismo del level-up normale (vedi
  // sotto), altrimenti il PNG uscirebbe dall'economia del regolamento —
  // abbassare una statistica libera AP da rispendere altrove, non crea
  // punti dal nulla.
  if (c.primaryConfirmed && !narratorEditMode) {
    toast('Statistiche confermate: si sbloccano solo con un level-up');
    return null;
  }
  // il P.R. e' fisso da classe fino al Lv1 (nessuna crescita, nemmeno con
  // AP): solo dal Lv2 in poi si puo' iniziare a farlo crescere
  if (isPr && Number(c.livello) < 2) {
    toast('P.R. è fisso in base alla classe fino al Lv1: si può far crescere solo dal Lv2 in poi');
    return null;
  }
  if (Number(c.livello) > 1 || isPr) {
    const costFn = key === 'hp' ? hpApCostForPoint : key === 'mp' ? mpApCostForPoint : primaryApCostForPoint;
    let cost = 0;
    if (newVal > oldVal) { for (let n = oldVal + 1; n <= newVal; n++) cost += costFn(n); }
    else { for (let n = oldVal; n > newVal; n--) cost -= costFn(n); }
    const disponibili = Number(c.apDisponibili) || 0;
    if (cost > 0 && cost > disponibili) {
      toast(`AP insufficienti: servono ${cost} AP (disponibili ${disponibili})`);
      return null;
    }
    const stat = PRIMARY_STATS.find(s => s.key === key) || SECONDARY_STATS.find(s => s.key === key);
    c.apDisponibili = disponibili - cost;
    c.ledger.push({
      id: uid(),
      desc: `${newVal > oldVal ? '+' : ''}${newVal - oldVal} ${stat ? stat.label : key} (→ ${newVal})`,
      amt: cost,
      ts: Date.now()
    });
    refreshApUI(c);
    if (grown) { c[trackedKey] = newVal; updatePlayBars(c); return newVal; }
  } else if (newVal > oldVal) {
    // fase di creazione (Lv1): non si può superare il pool di 40 punti
    const sum = PRIMARY_STATS.reduce((s, k) => s + Number(c.primary[k.key] || 0), 0);
    if (sum + (newVal - oldVal) > PRIMARY_POOL) {
      toast(`Punti esauriti: hai già assegnato tutti i ${PRIMARY_POOL} punti disponibili`);
      return null;
    }
  }
  c.primary[key] = newVal;
  return newVal;
}

function renderLevelTable() {
  $('#level-table-body').innerHTML = LEVEL_TABLE.map(r =>
    `<tr data-lv="${r.lv}"><td class="num">${r.lv}</td><td class="num">${r.ap}</td><td>${r.perk}</td><td>${r.note || ''}</td></tr>`
  ).join('');
}
function highlightCurrentLevel(c) {
  $$('#level-table-body tr').forEach(tr => tr.classList.toggle('current-row', Number(tr.dataset.lv) === Number(c.livello) + 1));
}
function renderTertiaryCostTable() {
  $('#tertiary-cost-table').innerHTML = Object.entries(TERTIARY_AP_TABLE)
    .map(([val, ap]) => `<tr><td class="num">${val}</td><td class="num">${ap}</td></tr>`).join('');
}
/* Bottoni +/- circolari sovrapposti al diagramma, vicino agli anelli di
   Carisma, Stile e Fortuna (coordinate viewBox 320x430, come DIAGRAM_SPEC).
   Posizionati sul bordo dell'anello evitando testo ed etichette e le linee
   di collegamento. cx/cy = centro del cerchio SVG di quella statistica
   (stessi valori di DIAGRAM_SPEC t:carisma/t:stile/t:fortuna), usati per
   posizionare il conteggio accanto alla cifra invece che sui bottoni. */
const DIAGRAM_PM_SPEC = [
  { key: 'carisma', label: 'Carisma', px: 111.45, py: 278.49, mx: 128.55, my: 278.49, cx: 120, cy: 255 },
  { key: 'stile',   label: 'Stile',   px: 208.55, py: 278.49, mx: 191.45, my: 278.49, cx: 200, cy: 255 },
  { key: 'fortuna', label: 'Fortuna', px: 151.45, py: 318.49, mx: 168.55, my: 318.49, cx: 160, cy: 295 }
];
// Distanza dal centro dell'anello (raggio 19) a cui compare il conteggio
// accanto alla cifra: dentro l'anello stesso, a sinistra (−) e a destra (+)
// della cifra centrale, non più fuori dal bordo.
const DIAGRAM_PM_NUM_OFFSET = 11;

function renderTertiaryPlusMinus(c) {
  // registrare esiti dei tiri ha senso solo durante la sessione di gioco
  // vera e propria (vedi isSessionLocked): fuori da una campagna, o mentre
  // il Narratore non l'ha ancora avviata, i bottoni restano disabilitati
  const locked = isSessionLocked(c);
  const diagramHtml = DIAGRAM_PM_SPEC.map(f => {
    const pm = c.tertiaryPM[f.key];
    // in compresenza di + e - il traguardo dei "+" sale da 3 a 4 (regola ufficiale)
    const plusThreshold = pm.minus > 0 ? 4 : 3;
    // Conteggio degli esiti accumulati verso il traguardo, mostrato accanto
    // alla cifra dentro/a fianco dell'anello (non più come badge sui bottoni,
    // che ne rovinava la leggibilità): "−N" a sinistra, "+N" a destra,
    // compare solo mentre pm.plus/pm.minus > 0, sparisce da solo non appena
    // il click handler li azzera scattando la modifica sulla statistica.
    const numMinus = pm.minus > 0
      ? `<span class="dg-pm-num dg-pm-num-minus" aria-hidden="true" style="left:${((f.cx - DIAGRAM_PM_NUM_OFFSET) / 320 * 100).toFixed(2)}%;top:${(f.cy / 430 * 100).toFixed(2)}%;">−${pm.minus}</span>` : '';
    const numPlus = pm.plus > 0
      ? `<span class="dg-pm-num dg-pm-num-plus" aria-hidden="true" style="left:${((f.cx + DIAGRAM_PM_NUM_OFFSET) / 320 * 100).toFixed(2)}%;top:${(f.cy / 430 * 100).toFixed(2)}%;">+${pm.plus}</span>` : '';
    return `<button class="dg-pm-btn dg-pm-minus" data-pm="${f.key}" data-pmtype="minus" ${locked ? 'disabled' : ''} style="left:${(f.mx / 320 * 100).toFixed(2)}%;top:${(f.my / 430 * 100).toFixed(2)}%;" aria-label="${f.label}: esito negativo (${pm.minus}/3)" title="${f.label} − (${pm.minus}/3)">−</button>
      <button class="dg-pm-btn dg-pm-plus" data-pm="${f.key}" data-pmtype="plus" ${locked ? 'disabled' : ''} style="left:${(f.px / 320 * 100).toFixed(2)}%;top:${(f.py / 430 * 100).toFixed(2)}%;" aria-label="${f.label}: esito positivo (${pm.plus}/${plusThreshold})" title="${f.label} + (${pm.plus}/${plusThreshold})">+</button>
      ${numMinus}${numPlus}`;
  }).join('');
  $$('.tertiary-pm-wrap').forEach(wrap => {
    wrap.innerHTML = diagramHtml;
  });
}
const GROWTH_COST_FN = { hp: hpApCostForPoint, mp: mpApCostForPoint, pr: primaryApCostForPoint };
PRIMARY_STATS.forEach(s => { if (s.key !== 'hp' && s.key !== 'mp') GROWTH_COST_FN[s.key] = primaryApCostForPoint; });
TERTIARY_STATS.forEach(s => { GROWTH_COST_FN[s.key] = tertiaryApCostForPoint; });
// Ogni voce del selettore è una statistica precisa: alla selezione, "Valore
// attuale" richiama la cifra corrispondente dal Fronte Scheda al netto di
// bonus/malus attivi (base/tracked, non l'effettivo con i buff dei consumabili)
function growthCurrentFromSheet(c, type) {
  if (type === 'hp') return Number(c.hpMaxTracked) || 0;
  if (type === 'mp') return Number(c.mpMaxTracked) || 0;
  if (type === 'pr') return Number(c.prMaxTracked) || 0;
  if (PRIMARY_STATS.some(s => s.key === type)) return Number(c.primary[type]) || 0;
  if (TERTIARY_STATS.some(s => s.key === type)) return Number(c.tertiary[type]) || 0;
  return null;
}
function syncGrowthCurrent() {
  const c = getActive(); if (!c) return;
  const val = growthCurrentFromSheet(c, $('#growth-type').value);
  if (val !== null) $('#growth-current').value = val;
}
function updateGrowthCost() {
  const c = getActive(); if (!c) return;
  const type = $('#growth-type').value;
  const cur = Number($('#growth-current').value) || 0;
  const tgt = Number($('#growth-target').value) || 0;
  const costFn = GROWTH_COST_FN[type] || primaryApCostForPoint;
  const cost = totalGrowthCost(cur, tgt, costFn);
  $('#growth-cost-chip').textContent = `${cost} AP`;
}

/* ------------------------------------------------------------- retro/eq */

/* Statistiche primarie selezionabili per un bonus su questo pezzo: scudo e
   arma sono limitati alle sole statistiche indicate per l'equipaggiamento
   (DIF/D.MEN per gli scudi, FOR/DEX/F.MEN per le armi), l'armatura resta
   generica su tutte le primarie. Il P.R. (statistica secondaria) NON è mai
   un bersaglio valido per l'equipaggiamento: solo i consumabili possono
   incrementarlo (vedi il target select in renderConsumabili). */
function primaryBonusKeysFor(itemKind) {
  if (itemKind === 'scudo') return SHIELD_PRIMARY_BONUS_KEYS;
  if (itemKind === 'arma') return WEAPON_PRIMARY_BONUS_KEYS;
  return PRIMARY_STATS.map(s => s.key);
}
/* Tratti selezionabili per un bonus su questo pezzo: elenco chiuso
   (SHIELD_TRAIT_OPTIONS/WEAPON_TRAIT_OPTIONS) per scudo/arma; per l'armatura
   (nessun elenco ufficiale per quel pezzo) torna null e il nome viene invece
   suggerito dinamicamente in equipBonusRowHtml, dai tratti già in scheda. */
function traitOptionsFor(itemKind) {
  if (itemKind === 'scudo') return SHIELD_TRAIT_OPTIONS;
  if (itemKind === 'arma') return WEAPON_TRAIT_OPTIONS;
  return null;
}
/* Una riga di bonus meccanico su un pezzo di equipaggiamento: tipo (statistica
   primaria o tratto — mai terziarie: Stile/Fortuna/Carisma non sono tra
   quelle su cui il manuale fa incidere l'equipaggiamento, arma/scudo/armatura
   comprese) + bersaglio + valore. Il nome del tratto è sempre selezionabile
   da un elenco (mai un campo libero "muto"): per scudo/arma l'elenco chiuso
   ufficiale (SHIELD_TRAIT_OPTIONS/WEAPON_TRAIT_OPTIONS); per l'armatura,
   senza un elenco ufficiale, i tratti già posseduti dal personaggio nella
   categoria scelta (propri + di storia) — in entrambi i casi "Nuovo tratto
   personalizzato…" resta l'opzione per un nome non ancora previsto, che apre
   il campo libero. La categoria "Conoscenze" resta comunque esclusa anche per
   l'armatura: un pezzo di equipaggiamento non aumenta davvero nozioni
   teoriche, solo Capacità Normali/Combattive sono bersagli validi. */
function equipBonusRowHtml(b, i, bi, itemKind, locked) {
  const kind = b.kind || 'primary';
  const lockAttr = locked ? 'disabled' : '';
  const primaryKeys = primaryBonusKeysFor(itemKind);
  const primaryOpts = PRIMARY_STATS.filter(s => primaryKeys.includes(s.key))
    .map(s => `<option value="${s.key}" ${kind === 'primary' && b.key === s.key ? 'selected' : ''}>${s.label}</option>`).join('');
  const listOpts = Object.keys(TRAIT_LISTS).filter(lk => lk !== 'conoscenze')
    .map(lk => `<option value="${lk}" ${kind === 'trait' && b.listKey === lk ? 'selected' : ''}>${TRAIT_LIST_LABELS[lk]}</option>`).join('');
  const fixedTraitOptions = traitOptionsFor(itemKind);
  const activeChar = getActive();
  // armatura: nessun elenco ufficiale, si suggeriscono i tratti già in scheda
  // (propri + personalizzati) nella categoria scelta dal selettore accanto
  const armorListKey = (b.listKey === 'capacitaNormali' || b.listKey === 'capacitaCombattive') ? b.listKey : 'capacitaCombattive';
  const traitOptions = fixedTraitOptions || (activeChar
    ? [...new Set([...(activeChar.shownTraits[armorListKey] || []), ...((activeChar.customTraits[armorListKey] || []).map(t => t.name))])].filter(Boolean)
    : []);
  // tratti già scritti da un altro personaggio di questa storia: pescabili
  // come i propri, non serve riscriverli — fuori da una campagna resta vuoto
  const knownListKey = fixedTraitOptions ? 'capacitaCombattive' : armorListKey;
  const knownExtra = (activeChar && activeChar.cloudCampaignId)
    ? cachedCampaignKnownTraits(activeChar.cloudCampaignId)[knownListKey].filter(n => n && !traitOptions.includes(n))
    : [];
  const isCustomTrait = !traitOptions.includes(b.name) && !knownExtra.includes(b.name);
  const traitPresetSelect = `<select data-bonustraitpreset="${i}::${bi}" ${lockAttr}>
        ${traitOptions.map(n => `<option value="${escapeHtml(n)}" ${!isCustomTrait && b.name === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        ${knownExtra.length ? `<optgroup label="Già usati in questa storia">${knownExtra.map(n => `<option value="${escapeHtml(n)}" ${!isCustomTrait && b.name === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</optgroup>` : ''}
        <option value="__custom__" ${isCustomTrait ? 'selected' : ''}>Nuovo tratto personalizzato…</option>
      </select>
      <input type="text" data-bonusname="${i}::${bi}" value="${escapeHtml(b.name || '')}" placeholder="Nome tratto" maxlength="40" class="${isCustomTrait ? '' : 'hidden'}" ${lockAttr}>`;
  // scudo/arma: la categoria è sempre "Capacità Combattive" (unica su cui il
  // manuale li fa incidere), niente selettore libero come per l'armatura, che
  // invece sceglie la categoria a parte e ci affianca lo stesso preset select
  const traitField = fixedTraitOptions
    ? traitPresetSelect
    : `<select data-bonuslistkey="${i}::${bi}" ${lockAttr}>${listOpts}</select>
      ${traitPresetSelect}`;
  // niente "statistica terziaria" (Stile/Fortuna/Carisma) sull'equipaggiamento,
  // arma/scudo/armatura comprese: non è tra le statistiche su cui il manuale
  // fa incidere l'equipaggiamento
  const kindOpts = `<option value="primary" ${kind === 'primary' ? 'selected' : ''}>Statistica primaria</option>
       <option value="trait" ${kind === 'trait' ? 'selected' : ''}>Tratto</option>
       <option value="rigenerazione" ${kind === 'rigenerazione' ? 'selected' : ''}>Rigenerazione (HP/MP/PP)</option>
       <option value="status" ${kind === 'status' ? 'selected' : ''}>Bonus a uno stato (Bruciare, Avvelenare...)</option>
       <option value="statusresist" ${kind === 'statusresist' ? 'selected' : ''}>Resistenza a uno stato</option>
       <option value="statusimmune" ${kind === 'statusimmune' ? 'selected' : ''}>Immunità a uno stato</option>`;
  const regenTargetOpts = EQUIP_REGEN_TARGETS.map(t => `<option value="${t.key}" ${kind === 'rigenerazione' && b.key === t.key ? 'selected' : ''}>${t.label}</option>`).join('');
  // Bonus al dado d'ingresso di uno stato (Bruciare/Avvelenare/...): sommato
  // al d100 puro dell'attaccante in combatRollAttackAndDamage tramite
  // equipBonusTotal(c, 'status', key) — stesso valore numerico generico già
  // usato da primaria/tratto (data-bonusvalore), qui riletto come "+N al
  // tiro d'ingresso" invece che come incremento statistico.
  // Tramortire non è nel catalogo STATUS_EFFECTS (resta un nome storico
  // insieme a Rompere) ma dalla revisione del suo meccanismo usa lo stesso
  // dado percentuale d'ingresso: va offerto qui come bersaglio di bonus
  // alla pari dei 12, Rompere no (resta sul vecchio tiro Resistenza).
  // Resistenza/Immunità a uno stato: bersaglio lato DIFENSORE, stessa lista
  // di stati, ma sommato/verificato in combatStatusResistRoll invece che in
  // combatRollAttackAndDamage (vedi equipBonusTotal(c, 'statusresist'/
  // 'statusimmune', key)) — mai location-gated: un filtro antigas o un
  // isolante protegge sempre, non solo se colpito in un punto preciso.
  const isStatusKind = kind === 'status' || kind === 'statusresist' || kind === 'statusimmune';
  const statusTargetOpts = STATUS_EFFECTS.concat([{ key: 'tramortire', icon: '💫', label: 'Tramortire' }])
    .map(s => `<option value="${s.key}" ${isStatusKind && b.key === s.key ? 'selected' : ''}>${s.icon} ${s.label}</option>`).join('');
  return `<div class="equip-bonus-row">
    <select data-bonuskind="${i}::${bi}" ${lockAttr}>${kindOpts}</select>
    <select data-bonuskey="${i}::${bi}" class="${kind === 'primary' ? '' : 'hidden'}" ${lockAttr}>${primaryOpts}</select>
    <span class="equip-bonus-trait ${kind === 'trait' ? '' : 'hidden'}">
      ${traitField}
    </span>
    <span class="equip-bonus-regen ${kind === 'rigenerazione' ? '' : 'hidden'}" style="display:inline-flex;align-items:center;gap:4px;">
      <select data-bonusregentarget="${i}::${bi}" ${lockAttr}>${regenTargetOpts}</select>
      <span style="white-space:nowrap;">ogni</span>
      <input type="number" data-bonusregeninterval="${i}::${bi}" value="${Number(b.intervalMin) || 10}" min="1" max="1440" style="width:56px;" ${lockAttr}>
      <span style="white-space:nowrap;">min</span>
    </span>
    <select data-bonusstatustarget="${i}::${bi}" class="${isStatusKind ? '' : 'hidden'}" ${lockAttr}>${statusTargetOpts}</select>
    <input type="number" data-bonusvalore="${i}::${bi}" value="${Number(b.valore) || 1}" min="1" max="50" style="width:56px;" class="${kind === 'statusimmune' ? 'hidden' : ''}" ${lockAttr}>
    ${locked ? '' : `<button type="button" class="btn btn-icon btn-sm btn-ghost" data-delequipbonus="${i}::${bi}" title="Rimuovi bonus">✕</button>`}
  </div>`;
}
/* Card di equip condivisa da retro (solo armature) e fronte (scudo/armi):
   il tipo è fisso per contesto/indice, restano da scegliere taglia e qualità.
   Atk/Dif/Durabilità sono digitabili nel range ufficiale e, una volta
   confermati con "Conferma scheda", restano fissi insieme a taglia/qualità
   (come una vera scheda del pezzo) finché non si tocca "Modifica" — vedi
   statsConfirmed. La Durabilità, dopo la conferma, diventa un tracker
   corrente/massimo (durCur/dur): il pannello "Subisci un colpo" la scala.
   Il toggle equipaggiato/inventario e il campo Peso sono legati a
   `equippable` (armi/scudi/armatura, tutti flaggabili); il pulsante di
   rimozione definitiva e, per le armi, classe e caratteristiche usate
   restano legati a `removable` (solo scudi/armi: le locazioni di armatura
   sono fisse, non si eliminano). */
function equipCardHtml(s, i, namePlaceholder, removable, equippable) {
  if (equippable === undefined) equippable = removable;
  const typeInfo = EQUIP_TYPES.find(t => t.key === s.kind);
  const sizes = typeInfo ? typeInfo.sizes : [];
  const range = equipRange(s.kind, s.size, s.quality);
  const confirmed = !!s.statsConfirmed;
  const pickerRow = (label, options, selected, attr, locked) => `
    <div class="slot-picker">
      <span class="sp-label">${label}</span>
      <div class="sp-row">
        ${options.map(o => `<button type="button" class="btn btn-sm ${selected === o.key ? 'btn-primary' : 'btn-ghost'}" data-${attr}="${o.key}" ${locked ? 'disabled' : ''}>${o.label}</button>`).join('')}
      </div>
    </div>`;
  const statField = (label, key) => {
    const r = range ? range[key] : null;
    const min = r ? r[0] : 0, max = r ? r[1] : 0;
    const val = r ? clamp(Number(s[key]) || min, min, max) : 0;
    return `<div class="sf">
      <label>${label}${r ? ` <span class="sf-range">${min}–${max}</span>` : ''}</label>
      <input type="number" min="${min}" max="${max}" value="${val}" data-slotfield="${key}" data-idx="${i}" aria-label="${label} — slot ${i + 1}" ${r ? '' : 'disabled'} ${confirmed ? 'readonly' : ''}>
    </div>`;
  };
  const durField = () => {
    if (confirmed) {
      const broken = (Number(s.durCur) || 0) <= 0;
      return `<div class="sf sf-dur-locked">
        <label>Durabilità</label>
        <div class="sf-dur-readout">${Number(s.durCur) || 0} / ${Number(s.dur) || 0}</div>
        ${broken ? '<span class="badge-broken">🔨 Rotta</span>' : ''}
      </div>`;
    }
    const r = range ? range.dur : null;
    const min = r ? r[0] : 0, max = r ? r[1] : 0;
    const val = r ? clamp(Number(s.dur) || min, min, max) : 0;
    return `<div class="sf">
      <label>Durabilità${r ? ` <span class="sf-range">${min}–${max}</span>` : ''}</label>
      <input type="number" min="${min}" max="${max}" value="${val}" data-slotfield="dur" data-idx="${i}" aria-label="Durabilità — slot ${i + 1}" ${r ? '' : 'disabled'}>
    </div>`;
  };
  const confirmUi = confirmed
    ? `<button type="button" class="btn btn-sm btn-ghost" data-slotunlock="${i}">✎ Modifica scheda</button>`
    : (range ? `<button type="button" class="btn btn-sm btn-primary" data-slotconfirm="${i}">✔ Conferma scheda</button>` : '');
  const equipped = s.equipaggiato !== false;
  const equipToggle = equippable ? `
    <div class="slot-equip-toggle">
      <button type="button" class="btn btn-sm ${equipped ? 'btn-primary' : 'btn-ghost'}" data-slotequip="${i}" title="${equipped ? 'Equipaggiato: tocca per spostare in Zaino' : 'Nello Zaino: tocca per equipaggiare'}">
        ${equipped ? '✓ Equipaggiato' : '🎒 Nello Zaino'}
      </button>
      ${removable ? `<button type="button" class="btn btn-icon btn-sm btn-ghost" data-slotremove="${i}" title="Rimuovi definitivamente">🗑</button>` : ''}
    </div>` : '';
  // Effetto di stato proprio dell'arma (Elettrificare/Immobilizzare/...): un
  // tiro percentuale indipendente che scatta quando l'arma colpisce, in
  // parallelo a quello di una Tecnica eventualmente usata insieme (vedi
  // combatTecAbSourcesFor/submit_attack_defense_roll) — stesso catalogo
  // STATUS_EFFECTS e stesso pattern <details> di dannoConfigHtml/effettoBlock,
  // ma con attributi dedicati (data-weaponeffetto...) per non confondersi con
  // quelli di Tecniche/Abilità, cablati su un contenitore DOM diverso.
  const dis = confirmed ? 'disabled' : '';
  // Tratto di specializzazione per il tiro DI COLPIRE (es. "Arte marziale
  // Systema" al posto di "Arte Combattiva"): solo per armi non a distanza
  // (quelle usano sempre Mira, nessuna specializzazione ha senso lì). La
  // statistica FOR/DEX/F.MEN sotto resta invariata e serve solo al danno.
  const weaponAttackTraitIsOfficial = TRAIT_LISTS.capacitaCombattive.includes(s.attackTraitName);
  const weaponAttackTraitIsCustom = !!s.attackTraitName && !weaponAttackTraitIsOfficial;
  const weaponAttackTraitBlock = ((s.weaponClass || 'bianca') !== 'tiro') ? `<div class="slot-picker">
      <span class="sp-label">Specializzazione per colpire (opzionale, sostituisce Arte Combattiva)</span>
      <div class="equip-bonus-row">
        <select data-weaponattacktraitsel="${i}" aria-label="Specializzazione per colpire — slot ${i + 1}" ${dis}>
          <option value="" ${!s.attackTraitName ? 'selected' : ''}>Arte Combattiva (predefinito)</option>
          ${TRAIT_LISTS.capacitaCombattive.map(n => `<option value="${escapeHtml(n)}" ${s.attackTraitName === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
          <option value="__custom__" ${weaponAttackTraitIsCustom ? 'selected' : ''}>Personalizzato…</option>
        </select>
        <input type="text" data-weaponattacktraitcustom="${i}" value="${escapeHtml(weaponAttackTraitIsCustom ? s.attackTraitName : '')}" placeholder="Nome tratto" maxlength="40" aria-label="Nome tratto personalizzato per colpire — slot ${i + 1}" class="${weaponAttackTraitIsCustom ? '' : 'hidden'}" ${dis}>
      </div>
    </div>` : '';
  const weaponEffettoIsOfficial = TRAIT_LISTS.capacitaCombattive.includes(s.effettoTratto);
  const weaponEffettoIsCustom = !!s.effettoTratto && !weaponEffettoIsOfficial;
  const weaponEffettoBlock = (removable && s.kind === 'arma') ? `<details class="tec-effetto-details" ${s.effettoNome ? 'open' : ''}>
      <summary class="tec-effetto-summary">+ Effetto di stato (Elettrificare, Immobilizzare...)</summary>
      <div class="equip-bonus-row" style="margin-top:6px;">
        <input type="text" list="weaponEffettoSuggest-${i}" value="${escapeHtml(s.effettoNome || '')}" placeholder="Nome effetto" maxlength="30" data-weaponeffettonome="${i}" aria-label="Nome effetto di stato — slot ${i + 1}" ${dis}>
        <datalist id="weaponEffettoSuggest-${i}">
          ${STATUS_EFFECTS.map(st => `<option value="${escapeHtml(st.label)}"></option>`).join('')}
        </datalist>
      </div>
      ${s.effettoNome ? `<div class="equip-bonus-row" style="margin-top:4px;">
        <select data-weaponeffettotrattosel="${i}" aria-label="Tratto di salvezza — slot ${i + 1}" ${dis}>
          <option value="" ${!s.effettoTratto ? 'selected' : ''}>Tratto di salvezza…</option>
          ${TRAIT_LISTS.capacitaCombattive.map(n => `<option value="${escapeHtml(n)}" ${s.effettoTratto === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}
          <option value="__custom__" ${weaponEffettoIsCustom ? 'selected' : ''}>Personalizzato…</option>
        </select>
        <input type="text" data-weaponeffettotrattocustom="${i}" value="${escapeHtml(weaponEffettoIsCustom ? s.effettoTratto : '')}" placeholder="Nome tratto" maxlength="40" aria-label="Nome tratto di salvezza personalizzato — slot ${i + 1}" class="${weaponEffettoIsCustom ? '' : 'hidden'}" ${dis}>
      </div>` : ''}
    </details>` : '';
  const weaponExtras = (removable && s.kind === 'arma') ? `
    ${pickerRow('Tipologia', WEAPON_CLASSES, s.weaponClass || 'bianca', 'slotweaponclass')}
    <div class="slot-picker">
      <span class="sp-label">Agisce con (per il calcolo di Attacca)</span>
      <div class="sp-row weapon-stat-flags">
        <label class="chk-inline"><input type="checkbox" data-slotusa="${i}::usaFor" ${s.usaFor ? 'checked' : ''}> FOR</label>
        <label class="chk-inline"><input type="checkbox" data-slotusa="${i}::usaDex" ${s.usaDex ? 'checked' : ''}> DEX</label>
        <label class="chk-inline"><input type="checkbox" data-slotusa="${i}::usaFmen" ${s.usaFmen ? 'checked' : ''}> F.MEN (Danno magico)</label>
      </div>
    </div>
    ${weaponAttackTraitBlock}
    ${weaponEffettoBlock}` : '';
  return `
    <div class="slot-card${equippable && !equipped ? ' slot-card-inventory' : ''}" data-slotidx="${i}">
      ${equipToggle}
      <input type="text" class="slot-name" value="${escapeHtml(s.name)}" data-slotname="${i}" placeholder="${namePlaceholder}" aria-label="${escapeHtml(namePlaceholder)} ${i + 1}">
      ${sizes.length ? pickerRow('Taglia', sizes, s.size, 'slotsize', confirmed) : ''}
      ${pickerRow('Qualità', EQUIP_QUALITIES, s.quality, 'slotquality', confirmed)}
      ${weaponExtras}
      <div class="slot-fields">
        ${statField('Atk', 'atk')}
        ${statField('Dif', 'dif')}
        ${durField()}
      </div>
      <div class="slot-confirm-row">${confirmUi}</div>
      ${equippable ? `<div class="field" style="max-width:120px;">
        <label>Peso (Kg) — conta nello Zaino se non equipaggiato</label>
        <input type="number" min="0" step="0.5" value="${Number(s.peso) || 0}" data-slotfield="peso" data-idx="${i}" aria-label="Peso (Kg) — slot ${i + 1}">
      </div>` : ''}
      <div class="field slot-bonus">
        <label>Note (testo libero)</label>
        <input type="text" value="${escapeHtml(s.bonus || '')}" data-slotfield="bonus" data-idx="${i}" placeholder="es. incisa con rune, appartenuta al nonno..." aria-label="Note — slot ${i + 1}">
      </div>
      <div class="slot-picker equip-bonuses">
        <span class="sp-label">Bonus meccanici (aumentano davvero statistiche/tratti)${equippable ? ' — attivi solo se equipaggiato' : ''}${confirmed ? ' — bloccati insieme alla scheda del pezzo' : ''}</span>
        ${(s.bonuses || []).map((b, bi) => equipBonusRowHtml(b, i, bi, s.kind, confirmed)).join('')}
        ${confirmed ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-addequipbonus="${i}" style="align-self:flex-start;">+ Aggiungi bonus</button>`}
      </div>
    </div>`;
}
function renderSlots(c) {
  const cards = c.slots.map((s, i) => equipCardHtml(s, i, 'Locazione', false, true));
  // equipaggiati prima, poi zaino: stesso ordine di renderWeaponSlots, senza
  // perdere l'indice reale (data-slotidx resta quello vero in c.slots)
  const order = c.slots
    .map((s, i) => ({ i, equipped: s.equipaggiato !== false }))
    .sort((a, b) => (a.equipped === b.equipped) ? (a.i - b.i) : (a.equipped ? -1 : 1))
    .map(x => x.i);
  $('#slot-grid').innerHTML = order.map(i => cards[i]).join('');
  renderHitTargetSelect(c);
  // il peso di un pezzo di armatura conta nello Zaino solo quando non
  // equipaggiato: ogni cambio qui (equip/zaino, peso) tiene aggiornato il totale
  renderZainoSummary(c);
}
/* Tendina "Bersaglio" del pannello Subisci un colpo: armature (c.slots) E
   armi/scudi (c.weaponSlots) con scheda confermata sono bersagli validi
   (senza taglia/qualità/numeri fissati non ha senso scalarne la Durabilità)
   — il valore codifica array+indice come "slots:2"/"weaponSlots:0". Richiamata
   a ogni render di renderSlots, quindi si aggiorna da sola dopo
   conferma/sblocco/rimozione. */
function renderHitTargetSelect(c) {
  const sel = $('#hit-target-select');
  const note = $('#hit-no-target-note');
  const btn = $('#hit-resolve-btn');
  if (!sel || !note || !btn) return;
  const prevVal = sel.value;
  // Solo pezzi davvero indossati/impugnati: uno confermato ma nello Zaino
  // (equipaggiato:false) non è raggiungibile da un colpo, non deve comparire
  // come bersaglio implicito nel selettore.
  const targets = ['slots', 'weaponSlots'].flatMap(arrKey =>
    (c[arrKey] || []).map((s, i) => ({ s, key: `${arrKey}:${i}` })).filter(x => x.s.statsConfirmed && x.s.equipaggiato !== false)
  );
  sel.innerHTML = targets.map(({ s, key }) =>
    `<option value="${key}">${escapeHtml(s.name)} (Dur ${Number(s.durCur) || 0}/${Number(s.dur) || 0}${(Number(s.durCur) || 0) <= 0 ? ' · 🔨 Rotta' : ''})</option>`
  ).join('');
  if (targets.some(x => x.key === prevVal)) sel.value = prevVal;
  note.classList.toggle('hidden', targets.length > 0);
  btn.disabled = targets.length === 0;
}
/* Risolve "slots:2"/"weaponSlots:0" nel pezzo corrispondente. */
function resolveHitTarget(c, key) {
  const sep = String(key || '').indexOf(':');
  if (sep === -1) return null;
  const arrKey = key.slice(0, sep);
  const idx = Number(key.slice(sep + 1));
  return (c[arrKey] && c[arrKey][idx]) || null;
}
/* Popola il select del pannello "Tira danno" (tab gioco) con le sole righe
   di Tecniche/Abilità che hanno un danno base impostato — richiamata alla
   fine di renderTecniche/renderAbilita, uniche funzioni che ridisegnano
   quelle righe (stesso pattern di renderHitTargetSelect per l'equip). */
function renderDmgTecAbSelect(c) {
  const sel = $('#dmg-tecab-select');
  const note = $('#dmg-tecab-no-target-note');
  const btn = $('#dmg-tecab-resolve-btn');
  if (!sel || !note || !btn) return;
  const prevVal = sel.value;
  const targets = [];
  ['tecniche', 'abilita'].forEach(field => {
    (c[field] || []).forEach((r, i) => {
      if (r.nome && (r.tipo === 'danno' || r.tipo === 'misto') && Number(r.dannoBase) > 0) targets.push({ field, i, r });
    });
  });
  sel.innerHTML = targets.map(({ field, i, r }) => {
    const statKey = dannoStatFor(r.dannoTipo, r.dannoStat);
    const statLabel = statKey ? DANNO_STAT_LABELS[statKey] : null;
    return `<option value="${field}::${i}">${escapeHtml(r.nome)} (${r.dannoBase}${statLabel ? ` + ${statLabel}` : ' — esplosivo'})</option>`;
  }).join('');
  const prevStillThere = targets.some(({ field, i }) => `${field}::${i}` === prevVal);
  if (prevStillThere) sel.value = prevVal;
  note.classList.toggle('hidden', targets.length > 0);
  btn.disabled = targets.length === 0;
}
function renderWeaponSlots(c) {
  // stessa cache di tratti condivisi usata dalla scheda Tratti: una sola
  // rilettura per campagna, non a ogni riga di bonus
  if (c.cloudCampaignId && !campaignTraitsCache[c.cloudCampaignId]) {
    fetchCampaignKnownTraits(c.cloudCampaignId).then(() => { if (getActive() === c) renderWeaponSlots(c); });
  }
  const cards = c.weaponSlots.map((s, i) =>
    equipCardHtml(s, i, s.kind === 'scudo' ? 'Nome scudo' : 'Nome arma', true));
  // equipaggiati prima, poi inventario: rispecchia lo spostamento richiesto
  // quando un'arma/scudo viene disequipaggiato, senza perdere l'indice reale
  // (data-slotidx resta quello vero in c.weaponSlots, gli event handler non
  // dipendono dall'ordine visivo)
  const order = c.weaponSlots
    .map((s, i) => ({ i, equipped: s.equipaggiato !== false }))
    .sort((a, b) => (a.equipped === b.equipped) ? (a.i - b.i) : (a.equipped ? -1 : 1))
    .map(x => x.i);
  $('#weapon-grid').innerHTML = order.map(i => cards[i]).join('');
  renderBlockSection(c);
  renderAttackWeaponList(c);
  // il peso delle armi/scudi conta nello Zaino solo quando non equipaggiati:
  // ogni cambio qui (equip/inventario, peso) deve tenere aggiornato il totale
  renderZainoSummary(c);
}

/* ------------------------------------------------------- Bloccare/Attacca */

function equippedShields(c) { return (c.weaponSlots || []).filter(s => s.kind === 'scudo' && isEquipmentUsable(s)); }
function equippedWeapons(c) { return (c.weaponSlots || []).filter(s => s.kind === 'arma' && isEquipmentUsable(s)); }

/* Tiro "puro" di una statistica primaria: il dado dipende dal suo valore
   BASE (senza i bonus da equipaggiamento/consumabile, come da regola per
   Bloccare e Attacca) e il risultato si somma a quello stesso valore base —
   stessa convenzione già in uso per il Tiro statistica generico. */
function rollPureStatTotal(c, key, rollLabel) {
  const pure = Number(c.primary[key]) || 0;
  const label = diceForValue(pure);
  if (label === 'd12+d8') {
    const a = rollDie(12, rollLabel ? `${rollLabel} (d12)` : undefined);
    const b = rollDie(8, rollLabel ? `${rollLabel} (d8)` : undefined);
    return { total: a + b + pure, detail: `d12+d8 ${a}+${b} +${pure}` };
  }
  const sides = Number(label.slice(1));
  const r = rollDie(sides, rollLabel);
  return { total: r + pure, detail: `${label} ${r} +${pure}` };
}

function renderBlockSection(c) {
  const note = $('#block-no-shield-note');
  const btn = $('#block-roll-btn');
  if (!note || !btn) return;
  const has = equippedShields(c).length > 0;
  note.classList.toggle('hidden', has);
  btn.disabled = !has;
}

function renderAttackWeaponList(c) {
  const wrap = $('#attack-weapon-list');
  const note = $('#attack-no-weapon-note');
  if (!wrap || !note) return;
  const weapons = equippedWeapons(c);
  note.classList.toggle('hidden', weapons.length > 0);
  wrap.innerHTML = weapons.map(w => {
    const realIdx = c.weaponSlots.indexOf(w);
    const used = [w.usaFor ? 'FOR' : null, w.usaDex ? 'DEX' : null, w.usaFmen ? 'F.MEN' : null].filter(Boolean).join(' + ') || '—';
    const classLabel = (WEAPON_CLASSES.find(wc => wc.key === w.weaponClass) || WEAPON_CLASSES[0]).label;
    return `<label class="chk-inline attack-weapon-row">
      <input type="checkbox" data-attackweapon="${realIdx}">
      <span>${escapeHtml(w.name || 'Arma')} — <span class="chip">${classLabel}</span> <span class="chip">Atk ${Number(w.atk) || 0}</span> <span class="chip">${used}</span></span>
    </label>`;
  }).join('');
}

function editTableRows(id, rows, dataAttr, fields, cellRenderers) {
  if (!rows.length) {
    $(id).innerHTML = `<tr><td colspan="${fields.length}" class="helper-text" style="padding:10px 8px;">Nessuna sbloccata a questo livello.</td></tr>`;
    return;
  }
  $(id).innerHTML = rows.map((r, i) => `
    <tr>${fields.map(f => {
      if (cellRenderers && cellRenderers[f]) return cellRenderers[f](r, i);
      return `<td class="${f === fields[0] ? 'col-wide' : 'col-narrow'}"><input type="text" value="${escapeHtml(r[f] || '')}" data-${dataAttr}="${f}" data-idx="${i}"></td>`;
    }).join('')}
    </tr>`).join('');
}

/* ============================================================= TECNICHE/
   ABILITÀ — VISTA A SCHEDE (sostituisce la tabella larga 1038px,
   inutilizzabile su mobile senza scorrere orizzontalmente entro i 356px
   disponibili).
   UNICA fonte di dati/calcolo: le cellRenderers passate qui sono le
   IDENTICHE funzioni già usate da editTableRows per la tabella
   (lockableTextCellHtml, tipoCellHtml, effettoCellHtml, dannoConfigHtml,
   tecAbBonusCellHtml, tecAbMalusCellHtml, abilitaCostoCellHtml,
   tempoAzioneCellHtml, durataCellHtml, utilizziCellHtml) — nessuna formula
   o validazione duplicata, cambia solo il contenitore di ogni campo (da
   <td> a <div>, vedi stripTdWrapper). Stessi data-attribute
   (data-tecnica/data-abilita, data-idx, data-tectipo, data-dannotipo...)
   quindi tutti i listener esistenti (wireEditTable/wireTecAbExtra/
   wireTraitBonusTable, delegati sullo stesso #tecniche-table/#abilita-table
   via addEventListener — mai closest('tr')/closest('td'), verificato)
   continuano a funzionare senza nessuna modifica.
   "lv" NON è più uno di questi campi (vedi tecabSectionHeaderHtml): non
   compare mai in TECAB_FIELD_LABELS/TECAB_MAIN_INFO_FIELDS né nei "fields"
   passati da renderTecniche/renderAbilita, altrimenti tornerebbe a occupare
   una riga a sé nella griglia invece di stare nell'intestazione. */
const TECAB_FIELD_LABELS = {
  nome: 'Nome', tipo: 'Tipo', effetto: 'Effetto', bonus: 'Bonus', malus: 'Malus',
  costo: 'Costo', tempoAzione: "Tempo d'azione", durata: 'Durata', utilizzi: 'Utilizzi'
};
// Campi secondari raccolti in "Altri dettagli" (espandibile): timing/
// conteggi, mai la definizione della Tecnica/Abilità in sé (nome, tipo,
// effetto, bonus/malus/costo restano SEMPRE visibili, mai nascosti).
const TECAB_DETAIL_FIELDS = new Set(['tempoAzione', 'durata', 'utilizzi']);
// Quali <details> "Altri dettagli" sono aperti, per sopravvivere a un
// nuovo render (es. dopo aver cambiato il Tipo di un'altra riga): senza
// questo, ogni editTecAbCardRows richiuderebbe tutto da capo.
const tecabCardDetailsOpen = new Set();
// Raggruppamento in sezioni visive dell'editor di una singola riga (wizard,
// vedi tecabEditorSectionedHtml): ripartisce gli stessi campi già passati a
// editTecAbCardRows, nessun campo inventato o duplicato ("lv" escluso, vedi
// sopra: è nell'intestazione di ogni sezione/scheda, non qui).
const TECAB_MAIN_INFO_FIELDS = new Set(['nome', 'tipo']);
const TECAB_MOD_FIELDS = new Set(['bonus', 'malus', 'costo']);
// Stesse etichette già mostrate nel <select> Tipo (tipoCellHtml): riusate
// qui identiche per la panoramica, mai reinventate.
const TECAB_TIPO_LABELS = {
  supporto: 'Supporto', debuff: 'Debuff', danno: 'Danno',
  misto: 'Misto (Danno+Supporto)', dannofisso: 'Danno fisso',
  cura: 'Cura', curamax: 'Cura max', extra: 'Extra'
};
/* Riepilogo compatto "Statistica +N" di una lista bonusItems/malusItems —
   stessa lettura già usata da tecAbBuffTotal/traitBonusItemsHtml (listKey
   'primaria' = statistica primaria, altrimenti nome del tratto), qui solo
   per mostrarla in una riga sola nella panoramica, mai per calcolarla. */
function tecAbItemsSummary(items) {
  return (items || []).filter(it => it.name).map(it => {
    const label = it.listKey === 'primaria' ? ((PRIMARY_STATS.find(s => s.key === it.name) || {}).full || it.name) : it.name;
    const v = Number(it.valore) || 0;
    return `${label} ${v > 0 ? '+' : ''}${v}`;
  }).join(' · ');
}
/* Testo umano sugli slot sbloccati (sostituisce il "2/10" ambiguo nella sola
   panoramica del wizard — il chip "2/10" della scheda normale resta
   invariato, non è questo il problema segnalato lì): usa esclusivamente
   tecAbSbloccate/prossimoSblocco (js/data.js, tabella limiti di livello
   ufficiale), nessun numero inventato qui. */
function tecAbProgressText(c, field) {
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices, c.tecAbNarratoreBonus);
  const count = field === 'tecniche' ? un.tec : un.ab;
  const noun = field === 'tecniche' ? (count === 1 ? 'Tecnica' : 'Tecniche') : 'Abilità';
  const next = prossimoSblocco(c.livello);
  return {
    available: `${count} ${noun} disponibil${count === 1 ? 'e' : 'i'} al livello ${c.livello}${tecabNarratoreGrantsSuffix(c, field)}`,
    next: next ? `Prossimo slot al livello ${next}` : null
  };
}
/* Card di panoramica (sola lettura + azione "Modifica"): mai i campi veri
   del modulo, solo un riepilogo derivato dai dati reali della riga — vedi
   STATO 1 del checkpoint "Tecniche e Abilità: panoramica ed editor". */
function tecAbOverviewCardHtml(field, r, trueIdx, slotNumber) {
  const dataAttr = field === 'tecniche' ? 'tecnica' : 'abilita';
  const complete = tecAbRowIsComplete(r, field);
  const tipoLabel = TECAB_TIPO_LABELS[r.tipo] || TECAB_TIPO_LABELS.supporto;
  const lv = r.lv || 1;
  const modSummary = [tecAbItemsSummary(r.bonusItems), field === 'tecniche' ? tecAbItemsSummary(r.malusItems) : ''].filter(Boolean).join(' · ');
  const named = r.nome && String(r.nome).trim();
  return `<div class="tecab-overview-card">
    <div class="tecab-overview-slot">${field === 'tecniche' ? 'Tecnica' : 'Abilità'} ${slotNumber}</div>
    <div class="tecab-overview-name">${named ? escapeHtml(r.nome) : 'Senza nome'}</div>
    <div class="tecab-overview-meta">${tipoLabel} · Livello ${escapeHtml(String(lv))}</div>
    ${modSummary ? `<div class="tecab-overview-mod">${modSummary}</div>` : ''}
    <div class="tecab-overview-footer">
      <span class="chip ${complete ? 'chip-complete' : 'chip-incomplete'}">${complete ? 'Completa' : 'Da completare'}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-tecabedit="${dataAttr}" data-idx="${trueIdx}">Modifica</button>
    </div>
  </div>`;
}
/* Panoramica dell'intero campo (Tecniche o Abilità): un elenco compatto
   invece delle schede complete di editTecAbCardRows — vedi STATO 1. Sopra
   l'elenco, il testo umano che sostituisce il chip "2/10" nel solo wizard. */
function renderTecAbOverview(id, countId, rows, field, c) {
  const container = $(id);
  const progress = tecAbProgressText(c, field);
  const summaryHtml = `<p class="helper-text tecab-progress-text">${progress.available}${progress.next ? ` — ${progress.next}` : ''}</p>`
    + tecabPendingAssignmentsHtml(c, field);
  if (!rows.length) {
    container.innerHTML = summaryHtml + `<p class="helper-text" style="padding:10px 2px;">Nessuna sbloccata a questo livello.</p>`;
  } else {
    container.innerHTML = summaryHtml + `<div class="tecab-overview-list">${rows.map((r, i) => tecAbOverviewCardHtml(field, r, i, i + 1)).join('')}</div>`;
  }
  if (countId) $(countId).classList.add('hidden');
}

/* Rimuove il wrapping <td>...</td> più esterno da un frammento HTML già
   pronto per la tabella: stesso contenuto, nessuna riga duplicata. Sicuro
   perché nessuna delle celle di Tecniche/Abilità contiene mai un'altra
   <td> annidata (solo input/select/div/span/details/button — verificato
   leggendo per intero dannoConfigHtml/effettoCellHtml/tipoCellHtml prima
   di questo intervento). */
function stripTdWrapper(html) {
  const m = /^\s*<td[^>]*>([\s\S]*)<\/td>\s*$/.exec(html);
  return m ? m[1] : html;
}

function editTecAbCardRows(id, rows, dataAttr, fields, cellRenderers, c) {
  const container = $(id);
  const field = dataAttr === 'tecnica' ? 'tecniche' : 'abilita';
  const pendingHtml = tecabPendingAssignmentsHtml(c, field);
  if (!rows.length) {
    container.innerHTML = pendingHtml + `<p class="helper-text" style="padding:10px 2px;">Nessuna sbloccata a questo livello.</p>`;
    return;
  }
  const charId = c.id;
  const cardTitle = dataAttr === 'tecnica' ? 'Tecnica' : 'Abilità';
  // Un campo che il Tipo della riga rende strutturalmente non pertinente
  // (es. "Bonus" su una riga di tipo Danno: tecAbBonusCellHtml torna
  // apposta una cella vuota) non mostra l'etichetta a vuoto — stesso
  // criterio già usato dalla tabella per non mostrare quella colonna come
  // "vuota", qui applicato riga per riga invece che a colonna intera.
  const fieldBlock = (r, i, f) => {
    const content = stripTdWrapper(cellRenderers[f](r, i)).trim();
    if (!content) return '';
    return `<div class="tecab-field tecab-field-${f}">
      <div class="tecab-field-label">${TECAB_FIELD_LABELS[f] || f}</div>
      <div class="tecab-field-control">${content}</div>
    </div>`;
  };
  container.innerHTML = pendingHtml + rows.map((r, i) => {
    const mainFields = fields.filter(f => f !== 'nome' && !TECAB_DETAIL_FIELDS.has(f));
    const detailFields = fields.filter(f => TECAB_DETAIL_FIELDS.has(f));
    // Comprende l'id del personaggio: senza, aprire "Altri dettagli" sulla
    // riga 0 di un personaggio risultava (erroneamente) aperto anche sulla
    // riga 0 di un altro personaggio, la stessa chiave "tecnica::0" per
    // chiunque.
    const detailsKey = `${charId}::${dataAttr}::${i}`;
    const openAttr = tecabCardDetailsOpen.has(detailsKey) ? ' open' : '';
    return `<div class="tecab-card">
      ${tecabSectionHeaderHtml(`${cardTitle} ${i + 1}`, dataAttr, r)}
      ${tecabAnnullaRiassegnaHtml(dataAttr, r, i)}
      ${fieldBlock(r, i, 'nome')}
      <div class="tecab-card-main">${mainFields.map(f => fieldBlock(r, i, f)).join('')}</div>
      ${detailFields.length ? `<details class="tecab-card-details" data-tecabdetails="${detailsKey}"${openAttr}>
        <summary>Altri dettagli</summary>
        <div class="tecab-card-main">${detailFields.map(f => fieldBlock(r, i, f)).join('')}</div>
      </details>` : ''}
    </div>`;
  }).join('');
}
/* Editor di UNA sola riga (wizard, STATO 2), organizzato in sezioni visive
   invece dell'elenco piatto di editTecAbCardRows — vedi TECAB_MAIN_INFO_FIELDS/
   TECAB_MOD_FIELDS. Riusa GLI STESSI cellRenderers/celle di editTecAbCardRows
   (nessun campo reinventato o duplicato): l'unica differenza è come vengono
   raggruppati in HTML. "i" è l'indice VERO in c.tecniche/c.abilita (non
   quello di uno slice), fondamentale perché tutti i listener delegati su
   #tecniche-table/#abilita-table (wireEditTable, wireTraitBonusTable,
   wireTecAbExtra) leggono data-idx per scrivere su c[field][idx]. */
function tecabEditorSectionedHtml(r, i, dataAttr, fields, cellRenderers, c) {
  const charId = c.id;
  const fieldBlock = (f) => {
    const content = stripTdWrapper(cellRenderers[f](r, i)).trim();
    if (!content) return '';
    return `<div class="tecab-field tecab-field-${f}">
      <div class="tecab-field-label">${TECAB_FIELD_LABELS[f] || f}</div>
      <div class="tecab-field-control">${content}</div>
    </div>`;
  };
  const section = (title, list) => {
    const html = list.map(fieldBlock).join('');
    if (!html) return '';
    return `<div class="tecab-editor-section">
      <div class="tecab-editor-section-title">${title}</div>
      <div class="tecab-card-main">${html}</div>
    </div>`;
  };
  const mainInfoFields = fields.filter(f => TECAB_MAIN_INFO_FIELDS.has(f));
  const effettoFields = fields.filter(f => f === 'effetto');
  const modFields = fields.filter(f => TECAB_MOD_FIELDS.has(f));
  const detailFields = fields.filter(f => TECAB_DETAIL_FIELDS.has(f));
  const detailsKey = `${charId}::${dataAttr}::${i}`;
  const openAttr = tecabCardDetailsOpen.has(detailsKey) ? ' open' : '';
  // "Informazioni principali" è l'unica sezione con l'intestazione a due
  // colonne (titolo + LV, vedi tecabSectionHeaderHtml): Nome/Tipo iniziano
  // SUBITO sotto, nessuna riga "Livello" a sé nella griglia dei campi.
  const mainInfoHtml = mainInfoFields.map(fieldBlock).join('');
  const mainInfoSection = mainInfoHtml ? `<div class="tecab-editor-section">
      ${tecabSectionHeaderHtml('Informazioni principali', dataAttr, r)}
      ${tecabAnnullaRiassegnaHtml(dataAttr, r, i)}
      <div class="tecab-card-main">${mainInfoHtml}</div>
    </div>` : '';
  return `<div class="tecab-card tecab-editor-card" data-tecab-card="${dataAttr}::${i}">
    ${mainInfoSection}
    ${section('Effetto', effettoFields)}
    ${section('Modificatori', modFields)}
    ${detailFields.length ? `<details class="tecab-card-details" data-tecabdetails="${detailsKey}"${openAttr}>
      <summary>Altri dettagli</summary>
      <div class="tecab-card-main">${detailFields.map(fieldBlock).join('')}</div>
    </details>` : ''}
  </div>`;
}
/* Le righe di Tecniche e Abilità si sbloccano con i level-up (dotazione
   iniziale + acquisizioni ai Lv 4/8/12/16/20 secondo la build). Le righe
   già compilate oltre il limite (es. dopo un cambio di build o una
   concessione del Narratore) restano visibili.
   Utilizzi/costo/range/pp/limite/lv sono ricalcolati a ogni render (vedi
   recomputeTecnicaRow e affini): esclusi qui, altrimenti ogni riga
   risulterebbe sempre "piena" non appena ricalcolata anche se il giocatore
   non ha scritto nulla di suo, rompendo lo sblocco progressivo per livello. */
/* dannoTipo/dannoStat/tipo hanno un default sempre non vuoto ('fisico'/
   'for'/'supporto'): senza escluderli qui, ogni riga anche vuota
   risulterebbe sempre "con contenuto", impedendo di nascondere le righe
   extra oltre lo sblocco per livello (stesso motivo per cui lv/utilizzi
   sono già esclusi). tipoConfirmed è un booleano di stato, non un dato. */
const ROW_DERIVED_FIELDS = new Set(['utilizzi', 'utilizziCount', 'costo', 'range', 'pp', 'limite', 'lv', 'dannoTipo', 'dannoStat', 'tipo', 'tipoConfirmed', 'boostConfirmed']);
function rowHasContent(r) {
  return Object.keys(r).some(k => !ROW_DERIVED_FIELDS.has(k) && String(r[k] || '') !== '' && r[k] !== 0);
}
function buildRows(rows, max, makeRow) {
  while (rows.length < max) rows.push(makeRow());
  let visible = max;
  for (let i = rows.length - 1; i >= max; i--) {
    if (rowHasContent(rows[i])) { visible = i + 1; break; }
  }
  return rows.slice(0, visible);
}
/* Compatta l'array Tecniche/Abilità: le righe nominate restano nell'ordine
   relativo ma spostate all'inizio, quelle senza nome (mai nominate) vanno
   in coda.
   Evita i "buchi" (una riga vuota in mezzo, seguita più avanti da una
   nominata) che farebbero apparire più righe del necessario nella tabella
   e nascondere l'unico slot davvero libero in mezzo invece che in fondo. */
function compactTecAbRows(rows) {
  const named = [], blank = [];
  rows.forEach(r => (r.nome && String(r.nome).trim() ? named : blank).push(r));
  return named.concat(blank);
}
/* Righe visibili di Tecniche/Abilità: DUE gruppi tenuti volutamente
   separati, mai un unico totale implicito come prima di questo checkpoint.
   1) Righe di CREAZIONE (r.assignmentId falsy): esattamente
      tecabCreationCount, sempre compilabili da subito, paddate/troncate
      come sempre (buildRows) — mai legate a un'assegnazione, mai frutto di
      una scelta Nuova/Aumenta.
   2) Righe da ASSEGNAZIONE (r.assignmentId valorizzato): una per ogni
      assegnazione già scelta come "nuova voce" (consumeTecabAssignmentForNew
      le crea già dentro c[field], vedi tecabPendingAssignmentsHtml) — MAI
      auto-create/rimosse qui: compaiono solo dopo la scelta esplicita del
      giocatore, spariscono solo con "Annulla e riassegna" (cancelTecabDraftRow)
      o restano per sempre una volta confermate. */
function buildTecabRows(c, field, makeRow) {
  const rows = c[field] || [];
  const creationRows = compactTecAbRows(rows.filter(r => !r.assignmentId));
  const assignmentRows = rows.filter(r => r.assignmentId);
  const creationCount = tecabCreationCount(c, field);
  const paddedCreation = buildRows(creationRows, creationCount, makeRow);
  return paddedCreation.concat(assignmentRows);
}
/* Passo "tecab" del wizard: mostra/nasconde intestazione e piè di pagina
   generali + la barra "Modifica.../Fatto" a seconda che sia aperto l'editor
   di una singola riga (wizardTecabEditing) — invariante sempre falso fuori
   da questo passo (vedi renderWizardStep, che lo azzera lasciandolo).
   Chiamata da renderTecniche/renderAbilita: idempotente, sicura da
   richiamare più volte con lo stesso stato (es. quando vengono chiamate
   entrambe in sequenza). Fuori dal wizard (scheda normale) non fa nulla:
   quegli elementi vivono solo dentro #view-create. */
function updateWizardTecabChrome() {
  if (!wizardActive) return;
  const editing = !!wizardTecabEditing;
  const bar = $('#wiz-tecab-editor-bar');
  if (bar) bar.classList.toggle('hidden', !editing);
  const header = document.querySelector('.wiz-header');
  const nav = document.querySelector('.wiz-nav-wrap');
  if (header) header.classList.toggle('hidden', editing);
  if (nav) nav.classList.toggle('hidden', editing);
  // "non mostrare contemporaneamente elenco ed editor": mentre si modifica
  // una riga, anche la nota di build/scelta Eclettico e la sezione
  // dell'ALTRO campo (Tecniche mentre si edita un'Abilità o viceversa)
  // restano nascoste, non solo la panoramica del campo in modifica.
  const buildNote = $('#retro-build-note');
  const choiceBox = $('#tecab-choice-box');
  const tecSection = $('#tecniche-section');
  const abSection = $('#abilita-section');
  if (buildNote) buildNote.classList.toggle('hidden', editing);
  if (choiceBox) choiceBox.classList.toggle('hidden', editing);
  if (editing) {
    const editingTec = wizardTecabEditing.field === 'tecniche';
    if (tecSection) tecSection.classList.toggle('hidden', !editingTec);
    if (abSection) abSection.classList.toggle('hidden', editingTec);
    const title = $('#wiz-tecab-editor-title');
    if (title) title.textContent = editingTec ? 'Modifica Tecnica' : 'Modifica Abilità';
  } else {
    if (tecSection) tecSection.classList.remove('hidden');
    if (abSection) abSection.classList.remove('hidden');
  }
}
/* Punto unico che decide COME rendere il contenuto di un campo (Tecniche o
   Abilità) dentro il suo contenitore: schede complete simultanee (scheda
   normale, invariato), panoramica compatta (wizard, nessuna riga in
   modifica) o editor di una sola riga (wizard, wizardTecabEditing). Le
   celle/i listener restano SEMPRE gli stessi (editTecAbCardRows/
   tecabEditorSectionedHtml riusano gli stessi cellRenderers) — cambia solo
   quanto e come viene disegnato. */
function renderTecabField(containerId, countId, rows, field, dataAttr, fields, cellRenderers, c) {
  const editingThis = wizardActive && wizardTecabEditing && wizardTecabEditing.field === field;
  if (editingThis) {
    const r = rows[wizardTecabEditing.idx];
    $(containerId).innerHTML = r ? tecabEditorSectionedHtml(r, wizardTecabEditing.idx, dataAttr, fields, cellRenderers, c) : '';
    if (countId) $(countId).classList.add('hidden');
  } else if (wizardActive) {
    renderTecAbOverview(containerId, countId, rows, field, c);
  } else {
    if (countId) $(countId).classList.remove('hidden');
    editTecAbCardRows(containerId, rows, dataAttr, fields, cellRenderers, c);
  }
  updateWizardTecabChrome();
}
function renderTecniche(c) {
  syncTecabAssignments(c);
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices, c.tecAbNarratoreBonus);
  const max = tecAbSbloccate(c.build, MAX_LEVEL, c.tecAbChoices, c.tecAbNarratoreBonus);
  const usedLevelup = tecabUsedLevelupSlots(c, 'tecniche');
  const rows = c.tecniche = buildTecabRows(c, 'tecniche', makeTecnicaRow);
  rows.forEach(r => recomputeTecnicaRow(r, c.qi));
  const locked = isSessionLocked(c);
  renderTecabField('#tecniche-table', '#tecniche-count', rows, 'tecniche', 'tecnica',
    ['nome', 'tipo', 'effetto', 'bonus', 'malus', 'tempoAzione', 'durata', 'utilizzi'],
    {
      nome: (r, i) => lockableTextCellHtml('tecnica', 'nome', r, i, tecAbRowLocked('tecnica', r, i), true),
      tipo: (r, i) => tipoCellHtml('tecnica', r, i),
      effetto: (r, i) => effettoCellHtml('tecnica', r, i, c),
      bonus: (r, i) => tecAbBonusCellHtml('tecnica', 'bonusItems', r, i, c),
      malus: (r, i) => tecAbMalusCellHtml('tecnica', 'malusItems', r, i, c),
      tempoAzione: (r, i) => tempoAzioneCellHtml('tecnica', r, i, tecAbRowLocked('tecnica', r, i)),
      durata: (r, i) => durataCellHtml('tecnica', r, i, tecAbRowLocked('tecnica', r, i)),
      utilizzi: (r, i) => utilizziCellHtml('tecnica', r, i, locked)
    }, c);
  $('#tecniche-count').textContent = (usedLevelup
    ? `${un.tec} / ${max.tec} (${usedLevelup} usati per aumentare una voce esistente)`
    : `${un.tec} / ${max.tec}`) + tecabNarratoreGrantsSuffix(c, 'tecniche');
  populateMpCostSelect(c);
  renderDmgTecAbSelect(c);
}
function renderAbilita(c) {
  syncTecabAssignments(c);
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices, c.tecAbNarratoreBonus);
  const max = tecAbSbloccate(c.build, 20, c.tecAbChoices, c.tecAbNarratoreBonus);
  const usedLevelup = tecabUsedLevelupSlots(c, 'abilita');
  const rows = c.abilita = buildTecabRows(c, 'abilita', makeAbilitaRow);
  rows.forEach(r => recomputeAbilitaRow(r, c.qi));
  const locked = isSessionLocked(c);
  renderTecabField('#abilita-table', '#abilita-count', rows, 'abilita', 'abilita',
    ['nome', 'tipo', 'effetto', 'bonus', 'costo', 'tempoAzione', 'durata', 'utilizzi'],
    {
      nome: (r, i) => lockableTextCellHtml('abilita', 'nome', r, i, tecAbRowLocked('abilita', r, i), true),
      tipo: (r, i) => tipoCellHtml('abilita', r, i),
      effetto: (r, i) => effettoCellHtml('abilita', r, i, c),
      bonus: (r, i) => tecAbBonusCellHtml('abilita', 'bonusItems', r, i, c),
      costo: (r, i) => abilitaCostoCellHtml(r, i, tecAbRowLocked('abilita', r, i)),
      tempoAzione: (r, i) => tempoAzioneCellHtml('abilita', r, i, tecAbRowLocked('abilita', r, i)),
      durata: (r, i) => durataCellHtml('abilita', r, i, tecAbRowLocked('abilita', r, i)),
      utilizzi: (r, i) => utilizziCellHtml('abilita', r, i, locked)
    }, c);
  $('#abilita-count').textContent = (usedLevelup
    ? `${un.ab} / ${max.ab} (${usedLevelup} usati per aumentare una voce esistente)`
    : `${un.ab} / ${max.ab}`) + tecabNarratoreGrantsSuffix(c, 'abilita');
  populateMpCostSelect(c);
  renderDmgTecAbSelect(c);
}
/* Selettore "Attiva" nel Fronte Scheda: unica via reale per attivare una
   Tecnica/Abilità di Supporto o Misto DURANTE il gioco — una volta che il
   Tipo è confermato, la checkbox "Attiva" del retro scheda si blocca
   apposta (vedi effettoCellHtml, `locked`), quindi senza questo selettore
   nessuna riga con Tipo confermato sarebbe più attivabile. Elenca OGNI
   riga (Tecniche e Abilità, non solo le Abilità con un costo MP numerico
   come prima) di Tipo Supporto/Misto con un nome — il costo MP, se
   presente e numerico, viene dedotto al click; se assente/non numerico
   l'attivazione resta comunque gratuita (nessun blocco). */
function populateMpCostSelect(c) {
  const sel = $('#mp-cost-select');
  if (!sel) return;
  const prevVal = sel.value;
  const opts = [];
  const activatableTipi = ['supporto', 'misto', 'cura', 'curamax', 'extra'];
  ['tecniche', 'abilita'].forEach(field => {
    (c[field] || []).forEach((r, i) => {
      if (!r.nome || !activatableTipi.includes(r.tipo)) return;
      const m = String(r.costo || '').match(/\d+(?:\.\d+)?/);
      const cost = m ? Number(m[0]) : 0;
      const label = cost ? `${r.nome} (${cost} MP)` : r.nome;
      opts.push(`<option value="${field}::${i}">${escapeHtml(label)}</option>`);
    });
  });
  sel.innerHTML = opts.length ? opts.join('') : '<option value="">Nessuna Tecnica/Abilità attivabile</option>';
  if (prevVal && sel.querySelector(`option[value="${cssEscapeAttr(prevVal)}"]`)) sel.value = prevVal;
}
/* Card di un Boost nominato (checkpoint "Boost e pedina di combattimento",
   punto 3): sostituisce la vecchia riga di tabella, stesso linguaggio
   visivo di Tecniche/Abilità (.tecab-card/.tecab-field, mai duplicato).
   Consultazione e modifica restano distinte: nome/bonus sono i soli input
   veri, tutto il resto (range/mantenimento/costo/avanzamento/stato) è un
   riepilogo di sola lettura — mai un grande campo modificabile per un dato
   che deriva comunque dal livello. Il Lv non è più un input libero (punto
   7): è testo, cambia solo tramite l'avanzamento (checkBoostPendingAdvancement/
   applyBoostAdvancement), mai digitato a mano. */
function applyBoostSupremeCredit(c, i) {
  const row = (c.boostRows || [])[i];
  if (!row || !row.boostConfirmed) { toast('Conferma il Boost prima di applicare il level-up supremo.'); return false; }
  if ((Number(c.boostSupremeCredits) || 0) < 1) { toast('Nessun level-up Boost supremo disponibile.'); return false; }
  const lv = clamp(parseInt(row.lv, 10) || 1, 1, 5);
  if (lv >= 5) { toast('Questo Boost è già al livello massimo: scegli un altro Boost.'); return false; }
  row.lv = String(lv + 1);
  row.progresso = 0;
  row.boostConfirmed = false;
  recomputeBoostRow(row);
  c.boostSupremeCredits -= 1;
  c.ledger.push({ id: uid(), desc: `Level-up supremo Boost: ${row.nome || 'Boost'} (Lv ${lv} → ${lv + 1})`, amt: 0, gain: true, ts: Date.now() });
  touchActive();
  toast(`${row.nome || 'Boost'} sale direttamente al Lv ${lv + 1}`);
  return true;
}
function boostCardHtml(c, r, i) {
  const locked = traitBonusRowLocked(c, 'boostrow', i);
  const blockedBy = boostActivationBlockedBy(c, r.id);
  const active = blockedBy === 'stessa';
  const blockedByOther = blockedBy === 'altro';
  const otherLabel = blockedByOther ? ((boostActiveInfo(c) || {}).label || 'un altro Boost') : '';
  const stato = active ? { cls: 'btn-primary', label: '● Attivo' }
    : blockedByOther ? { cls: '', label: `🔒 ${otherLabel} attivo` }
    : r.boostConfirmed ? { cls: '', label: '🔒 Confermato' }
    : { cls: '', label: 'Da completare' };
  const lv = clamp(parseInt(r.lv, 10) || 1, 1, 5);
  const soglia = boostAdvancementThreshold(lv);
  const progresso = Number(r.progresso) || 0;
  // Estensione esplicita (decisione definitiva, dal Lv 2): il bottone
  // compare SOLO sulla riga davvero attiva, di Lv estendibile, e solo
  // dentro un vero combattimento a turni — mai fuori scena, mai su una
  // riga diversa da quella realmente in corso.
  const bLevelForExtend = BOOST_LEVELS.find(b => b.lv === lv) || BOOST_LEVELS[0];
  const canExtend = active && bLevelForExtend.estendibile && boostInCloudCombat(c);
  return `<div class="tecab-card boost-card" data-boostcard="${i}">
    <div class="tecab-section-header">
      <span class="tecab-section-title">Boost ${i + 1}</span>
      <span class="chip ${stato.cls}">${stato.label}</span>
    </div>
    <div class="tecab-field tecab-field-nome">
      <label class="tecab-field-label" for="boostrow-nome-${i}">Nome</label>
      <div class="tecab-field-control">
        <input type="text" id="boostrow-nome-${i}" value="${escapeHtml(r.nome || '')}" data-boostrow="nome" data-idx="${i}" placeholder="Es. Ira" ${locked ? 'disabled' : ''} aria-label="Nome — Boost ${i + 1}">
      </div>
    </div>
    <div class="tecab-field">
      <label class="tecab-field-label">Bonus</label>
      <div class="tecab-field-control">${traitBonusItemsHtml('boostrow', 'bonusItems', r, i, false, c, locked)}</div>
    </div>
    <div class="boost-card-summary">
      <div class="boost-card-stat"><span>Livello</span><b>${lv}${r.lvTop ? ' (Top)' : ''}</b></div>
      <div class="boost-card-stat"><span>Costo attivazione</span><b>${boostActivationCost(r, lv)} PP</b></div>
      <div class="boost-card-stat"><span>Mantenimento</span><b>${escapeHtml(r.pp || '')}</b></div>
      <div class="boost-card-stat"><span>Durata</span><b>${escapeHtml(boostDurataLabel(BOOST_LEVELS.find(b => b.lv === lv) || BOOST_LEVELS[0]))}</b></div>
      <div class="boost-card-stat"><span>Range</span><b>${escapeHtml(r.range || '')}</b></div>
      <div class="boost-card-stat boost-card-stat-wide"><span>Avanzamento</span><b>${progresso}/${soglia} PP</b></div>
    </div>
    <div class="boost-card-confirm">
      ${(!!r.boostConfirmed && !narratorEditMode)
        ? '<span class="chip" title="Si sblocca solo con un level-up">🔒 Confermato</span>'
        : `<button type="button" class="btn btn-sm btn-primary" data-boostconfirm="${i}">✔ Conferma</button>`}
      ${(Number(c.boostSupremeCredits) || 0) > 0 && r.boostConfirmed && lv < 5
        ? `<button type="button" class="btn btn-sm btn-primary" data-boostsupreme="${i}">⬆ Level-up supremo (${c.boostSupremeCredits})</button>`
        : ''}
      ${canExtend ? `<button type="button" class="btn btn-sm" data-boostextend="${r.id}" title="Aggiunge 1 turno di durata: il mantenimento continua a essere dedotto ogni turno">⏱ Estendi (+1 turno)</button>` : ''}
    </div>
  </div>`;
}
/* Vero se la riga r ha davvero un Boost compilato (nome + almeno un bonus),
   non solo un id assegnato dalla migrazione additiva — stessa condizione
   già usata per sbloccare "Conferma" (vedi il listener di data-boostconfirm),
   riusata qui invece di una seconda definizione di "riga vuota". */
function boostRowIsCompiled(r) {
  return !!(r && String(r.nome || '').trim() && (r.bonusItems || []).some(it => it && it.name));
}
/* Livello più alto raggiunto secondo le VECCHIE spunte c.boost[lv].appreso
   (pre-esistenti a boostRows, mai lette per guidare nulla dal checkpoint
   "Boost e pedina" in poi — vedi renderBoost) — usato SOLO per riconoscere
   un personaggio legacy con un traguardo dichiarato ma nessuna riga Boost
   realmente compilata (verifica obbligatoria, decisione definitiva
   dell'utente): 0 se non c'è alcuna spunta appresa. */
function boostLegacyHighestLv(c) {
  if (!c || !c.boost) return 0;
  let highest = 0;
  BOOST_LEVELS.forEach(b => { if (c.boost[b.lv] && c.boost[b.lv].appreso) highest = Math.max(highest, b.lv); });
  return highest;
}
function renderBoostRows(c) {
  const shown = clamp(c.boostRowsShown || 1, 1, BOOST_ROWS_MAX);
  const rows = buildRows(c.boostRows, shown, makeBoostRow);
  rows.forEach(recomputeBoostRow);
  const container = $('#boostrows-table');
  if (container) container.innerHTML = rows.map((r, i) => boostCardHtml(c, r, i)).join('');
  $('#boost-add').classList.toggle('hidden', shown >= BOOST_ROWS_MAX);
  $('#boost-remove').classList.toggle('hidden', shown < 2);
  // Verifica obbligatoria personaggi legacy (decisione definitiva
  // dell'utente): una spunta c.boost[lv].appreso senza ALCUNA riga
  // realmente compilata non deve sparire né ricevere nome/bonus inventati
  // — un banner esplicito chiede di completare e confermare una card prima
  // di poter attivare qualunque Boost, il dato legacy resta comunque
  // intatto in c.boost (mai toccato da questa funzione).
  const legacyLv = boostLegacyHighestLv(c);
  const banner = $('#boost-legacy-banner');
  if (banner) {
    const hasCompiled = (c.boostRows || []).some(boostRowIsCompiled);
    const showBanner = legacyLv > 0 && !hasCompiled;
    banner.classList.toggle('hidden', !showBanner);
    if (showBanner) {
      banner.textContent = `Questo personaggio ha una progressione Boost dalle vecchie schede (appreso fino al Lv ${legacyLv}), ma nessuna card è ancora compilata: i dati non sono andati persi, ma nome e bonus non possono essere ricostruiti automaticamente. Completa nome e bonus e conferma una card qui sotto prima di poter attivare un Boost.`;
    }
  }
}
function renderRetroNote(c) {
  const b = BUILDS[c.build];
  const un = tecAbSbloccate(c.build, c.livello, c.tecAbChoices, c.tecAbNarratoreBonus);
  const max = tecAbSbloccate(c.build, 20, c.tecAbChoices, c.tecAbNarratoreBonus);
  const next = prossimoSblocco(c.livello);
  $('#retro-build-note').textContent =
    `${b.label} · Lv ${c.livello}: ${un.tec} Tecniche e ${un.ab} Abilità sbloccate (al Lv ${MAX_LEVEL}: ${max.tec}+${max.ab}).`
    + (next ? ` Prossimo apprendimento al Lv ${next}.` : ' Tutti gli apprendimenti sbloccati.');
  renderTecAbChoiceBox(c);
}
/* Solo l'Eclettico sceglie, ai Lv 8/16/24 (una volta raggiunti), tra 2
   Tecniche / 2 Abilità / 1 Tecnica + 1 Abilità — Guerriero e Mago non
   hanno questa scelta, restano sempre a 1+1 in quei livelli. */
const TECAB_CHOICE_LABELS = { '1+1': '1 Tecnica + 1 Abilità', '2tec': '2 Tecniche', '2ab': '2 Abilità' };
function renderTecAbChoiceBox(c) {
  const box = $('#tecab-choice-box');
  if (!box) return;
  if (c.build !== 'eclettico') { box.innerHTML = ''; return; }
  const reached = TECAB_ALL_LEVELS.filter(l => c.livello >= l);
  if (!reached.length) { box.innerHTML = ''; return; }
  box.innerHTML = reached.map(l => {
    const current = (c.tecAbChoices && c.tecAbChoices[l]) || '1+1';
    return `
      <div class="field">
        <label>Apprendimento al Lv ${l}</label>
        <select data-tecabchoice="${l}">
          ${Object.keys(TECAB_CHOICE_LABELS).map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${TECAB_CHOICE_LABELS[v]}</option>`).join('')}
        </select>
      </div>`;
  }).join('');
}

/* "3 turni" fisso (durataQuarti) + "o più" solo dove il manuale lo ammette
   (mantenimento PP/turno oltre la base, vedi BOOST_LEVELS in data.js). */
function boostDurataLabel(b) {
  return `${b.durataQuarti / 4} turni${b.estendibile ? ' o più' : ''}`;
}
/* Riferimento ufficiale dei 5 livelli (checkpoint, punto 2/3): PURAMENTE
   informativo, mai più una progressione parallela — le vecchie spunte
   c.boost[lv].appreso restano nei dati salvati (mai eliminate, servono da
   storico/migrazione) ma non guidano più niente qui: cosa si può attivare
   dipende solo dal livello raggiunto dalla riga Boost nominata (vedi
   boostSelectableLevels), mai da questa tabella. Card/lista compatta, mai
   una tabella larga (stesso .tecab-cards di Tecniche/Abilità/Boost sopra). */
function renderBoost(c) {
  const box = $('#boost-table');
  if (box) {
    box.innerHTML = BOOST_LEVELS.map(b => `
      <div class="tecab-card boost-ref-card">
        <div class="tecab-section-header">
          <span class="tecab-section-title">Livello ${b.lv}</span>
          <span class="tecab-lv-badge-value">${b.costo} PP</span>
        </div>
        <div class="boost-card-summary">
          <div class="boost-card-stat"><span>Mantenimento</span><b>${escapeHtml(b.mantenimento)}</b></div>
          <div class="boost-card-stat"><span>Durata</span><b>${escapeHtml(boostDurataLabel(b))}</b></div>
          <div class="boost-card-stat"><span>Range</span><b>${escapeHtml(b.range)}</b></div>
          <div class="boost-card-stat"><span>Limite avanzamento</span><b>${escapeHtml(b.limite)}</b></div>
        </div>
      </div>`).join('');
  }
  populateBoostActivateSelect(c);
}
/* Selettore "attiva Boost" nel Fronte Scheda: elenca ogni Boost NOMINATO
   confermato, per ciascun livello selezionabile (1..livello raggiunto dalla
   riga — checkpoint, punto 2), col nome reale e non solo il livello ("IRA —
   Lv 3 — 24 PP", mai solo "Lv 3 — 24 PP" — punto 5). value = "rowId::lv",
   letto da activateBoostBtn più sotto. */
function populateBoostActivateSelect(c) {
  const sel = $('#boost-activate-select');
  if (!sel) return;
  const prevVal = sel.value;
  const info = boostActiveInfo(c);
  const opts = [];
  if (info) opts.push(`<option value="" disabled>— Boost attivo: ${escapeHtml(info.label || 'sconosciuto')} —</option>`);
  (c.boostRows || []).forEach(row => {
    // Un solo Boost per personaggio (punto 2): finché un Boost diverso è
    // attivo, le sue alternative non compaiono nemmeno nell'elenco — mai
    // un'opzione selezionabile che porterebbe comunque al blocco.
    if (info && info.rowId !== row.id) return;
    boostSelectableLevels(row).forEach(b => {
      const already = info && info.rowId === row.id;
      const label = `${row.nome || 'Boost'} — Lv ${b.lv} — ${boostActivationCost(row, b.lv)} PP${already ? ' (già attivo)' : ''}`;
      opts.push(`<option value="${row.id}::${b.lv}"${already ? ' disabled' : ''}>${escapeHtml(label)}</option>`);
    });
  });
  sel.innerHTML = opts.length ? opts.join('') : '<option value="">Nessun Boost confermato</option>';
  if (prevVal && sel.querySelector(`option[value="${cssEscapeAttr(prevVal)}"]`)) sel.value = prevVal;
}
/* Attiva un Boost NOMINATO (riga boostRows), non più un semplice livello
   generico (checkpoint "Boost e pedina di combattimento", punto 2/5):
   validazioni PRIMA di qualunque scrittura (riga esistente/con id/
   confermata, livello valido e raggiunto, nessuna attivazione incompatibile
   già in corso, PP sufficienti — MAI clamp() a zero fingendo un pagamento
   non coperto). In un combattimento cloud attivo chiama PRIMA il server
   (apply_combat_effect convalida turno/quarti e crea l'effetto in
   un'unica transazione atomica — v_cost:=2 quarti fisso per source.kind
   ='boost', il mezzo turno preteso dal regolamento è già imposto lì) e SOLO
   se quella chiamata riesce sottrae i PP in locale e salva: se il server
   fallisce (rete, budget turno insufficiente, silenziato, ecc.) non resta
   né un PP sottratto né alcun effetto — mai più un'attivazione locale "a
   parte" che sopravvive a un fallimento server (il vecchio .catch(() => {})
   "best-effort" è stato rimosso). Fuori da un combattimento cloud attivo
   usa la STESSA validazione, senza alcuna chiamata di rete: stato locale
   (c.boostLocalActivation) aggiornato per bonus/badge di scheda, nessun
   conto alla rovescia a turni (fuori da un incontro non esiste un vero
   turno da contare, mai un finto combattimento — punto 5). Condivisa fra
   il bottone sulla scheda (#boost-activate-btn) e il ramo "Boost" del menù
   comandi sul tabellone (openCombatBoostPicker). */
async function activateBoostRow(c, rowId, lv) {
  if (!c || !rowId) return;
  if (isEntryLocked(c)) { toast('Il Narratore non ha ancora accettato la richiesta di ingresso: attendi la conferma per usare i PP.'); return; }
  const row = (c.boostRows || []).find(r => r.id === rowId);
  if (!row || !row.id) { toast('Boost non trovato.'); return; }
  if (!row.boostConfirmed) { toast('Conferma prima questo Boost: una riga non confermata non può essere attivata.'); return; }
  const lvNum = parseInt(lv, 10);
  const cap = clamp(parseInt(row.lv, 10) || 1, 1, 5);
  if (!Number.isInteger(lvNum) || lvNum < 1 || lvNum > 5) { toast('Livello non valido.'); return; }
  if (lvNum > cap) { toast(`Questo Boost è appreso fino al Lv ${cap}: non puoi attivarlo a un livello superiore.`); return; }
  const blocked = boostActivationBlockedBy(c, row.id);
  if (blocked === 'stessa') { toast('Questo Boost è già attivo.'); return; }
  if (blocked === 'altro') {
    const info = boostActiveInfo(c);
    const label = (info && info.label) ? info.label : 'un altro Boost';
    toast(`Hai già ${label} attivo: puoi avere un solo Boost attivo alla volta. Attendi la scadenza prima di attivarne un altro.`);
    return;
  }
  const costo = boostActivationCost(row, lvNum);
  const ppCurNow = Number(c.ppCur) || 0;
  if (costo > ppCurNow) { toast(`PP insufficienti: servono ${costo} PP, ne hai ${ppCurNow}.`); return; }

  const inCloudCombat = boostInCloudCombat(c);

  const bLevel = BOOST_LEVELS.find(b => b.lv === lvNum);
  if (inCloudCombat) {
    try {
      await applyCombatEffect(
        combatViewEncounterId, c.cloudCharacterId,
        {
          characterId: c.cloudCharacterId, kind: 'boost', label: `${row.nome || 'Boost'} — Lv ${lvNum}`, rowId: row.id,
          // Mantenimento server-autorevole (decisione definitiva
          // dell'utente): il server dedurrà da solo questo importo a ogni
          // inizio turno del bersaglio (combat_tick_effects_for_
          // participant), senza bisogno di alcuna ulteriore chiamata dal
          // client — stessa fonte già usata per il costo di attivazione
          // (boostMaintenancePerTurn), mai un secondo numero inventato qui.
          maintenancePp: boostMaintenancePerTurn(lvNum)
        },
        'buff', null, null, null, null, null, bLevel.durataQuarti,
        row.bonusItems || []
      );
    } catch (err) {
      toast(describeError(err));
      return; // fallimento server: nessuna scrittura locale, nessun costo applicato
    }
    await refreshCombatBoard();
  } else {
    c.boostLocalActivation = { rowId: row.id, lv: lvNum };
  }

  // PP sottratti SOLO dopo il successo (server o percorso locale): il
  // controllo sopra ha già garantito costo <= ppCurNow, nessun clamp che
  // finga un pagamento non coperto.
  const ppMax = effectivePpMax(c);
  c.ppCur = clamp(ppCurNow - costo, 0, ppMax);
  updatePlayBars(c);
  row.progresso = (Number(row.progresso) || 0) + costo;
  checkBoostPendingAdvancement(c, row);
  touchActive();
  toast(`${row.nome || 'Boost'} Lv ${lvNum} attivato: -${costo} PP`);
}
/* Estensione ESPLICITA della durata di un Boost già attivo (checkpoint
   "Boost e pedina", decisioni definitive: "estensione esplicita dal Lv 2"
   — mai automatica/silenziosa, mai indotta da un semplice mantenimento
   pagato). Disponibile solo dal Lv 2 in su (BOOST_LEVELS[].estendibile) e
   solo mentre il Boost è realmente quello attivo in un vero combattimento
   cloud: fuori da un incontro non esiste un turno reale da estendere
   (stesso principio del punto 5). Il costo resta il solo mantenimento già
   dedotto automaticamente a ogni turno da combat_tick_effects_for_
   participant — qui non viene sottratto alcun PP aggiuntivo, si aggiungono
   solo altri quarti di durata da mantenere pagando. */
async function extendBoostRow(c, rowId) {
  if (!c) return;
  const row = (c.boostRows || []).find(r => r.id === rowId);
  if (!row) { toast('Boost non trovato.'); return; }
  const lv = clamp(parseInt(row.lv, 10) || 1, 1, 5);
  const bLevel = BOOST_LEVELS.find(b => b.lv === lv) || BOOST_LEVELS[0];
  if (!bLevel.estendibile) { toast('Questo Boost è estendibile solo dal Lv 2 in su.'); return; }
  const info = boostActiveInfo(c);
  if (!info || info.rowId !== row.id) { toast('Questo Boost non è attualmente attivo: nulla da estendere.'); return; }
  if (!boostInCloudCombat(c)) { toast('L\'estensione della durata esiste solo durante un vero combattimento a turni.'); return; }
  const active = (combatState.activeEffects || []).find(e =>
    e.source_kind === 'boost' && e.target_character_id === c.cloudCharacterId && e.remaining_quarters > 0);
  if (!active || !active.id) { toast('Boost non trovato in combattimento.'); return; }
  try {
    await extendCombatBoostEffect(combatViewEncounterId, active.id, 4);
  } catch (err) {
    toast(describeError(err));
    return;
  }
  await refreshCombatBoard();
  toast(`${row.nome || 'Boost'} esteso di 1 turno: il mantenimento continua a essere dedotto a ogni turno.`);
}
/* Peso corporeo del personaggio: letto dal campo libero di background
   (Aspetto > Peso). Se non contiene un numero, conta 0 (la Regola del Peso
   resta comunque indicativa, a discrezione del Narratore). */
function pesoCorporeoOf(c) {
  const n = parseFloat(String((c.bg && c.bg.peso) || '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
/* Peso trasportabile nello Zaino (Regola del Peso, manuale): Forza effettiva
   (bonus attivi inclusi) + peso corporeo, /2 — restituisce anche le due
   componenti per poterle mostrare nella formula (vedi renderZainoSummary). */
function zainoPesoComponents(c) {
  const forza = (Number(c.primary.for) || 0) + buffTotal(c, 'for');
  const peso = pesoCorporeoOf(c);
  return { forza, peso, max: pesoTrasportabile(forza, peso) };
}
function zainoPesoMax(c) { return zainoPesoComponents(c).max; }
/* Peso occupato: oggetti normali + armi/scudi NON equipaggiati. Ciò che è
   indossato/impugnato non pesa sullo Zaino, solo ciò che sta riposto. */
function zainoPesoUsato(c) {
  const oggetti = (c.inventario || []).reduce((s, r) => s + (Number(r.peso) || 0), 0);
  const armiScudi = (c.weaponSlots || []).filter(s => s.equipaggiato === false)
    .reduce((s, sl) => s + (Number(sl.peso) || 0), 0);
  const armatura = (c.slots || []).filter(s => s.equipaggiato === false)
    .reduce((s, sl) => s + (Number(sl.peso) || 0), 0);
  return oggetti + armiScudi + armatura;
}
function renderZainoSummary(c) {
  const el = $('#zaino-peso-summary');
  if (!el) return;
  const usato = zainoPesoUsato(c);
  const max = zainoPesoMax(c);
  el.textContent = `${usato} / ${max} Kg`;
  el.className = 'remaining' + (usato > max ? ' neg' : '');
  const inZaino = (c.weaponSlots || []).filter(s => s.equipaggiato === false);
  const listEl = $('#zaino-armi-list');
  if (listEl) {
    listEl.innerHTML = inZaino.length
      ? inZaino.map(s => `<div class="row-between"><span>${escapeHtml(s.name || (s.kind === 'scudo' ? 'Scudo' : 'Arma'))} <span class="chip">${s.kind === 'scudo' ? 'Scudo' : 'Arma'}</span></span><span class="num">${Number(s.peso) || 0} Kg</span></div>`).join('')
      : `<p class="helper-text" style="margin:0;">Nessuna arma o scudo in Inventario: sono tutti equipaggiati.</p>`;
  }
  renderZainoGrid(c);
}
/* Griglia Zaino (5x4 = 20 slot): unisce in un'unica vista a icone i quattro
   "contenitori" già esistenti di oggetti non equipaggiati — consumabili
   (js/app.js renderConsumabili), armi/scudi disequipaggiati (weaponSlots),
   armatura disequipaggiata (slots) e oggetti generici (inventario, qui
   reinterpretati come "oggetti chiave non consumabili") — senza introdurre
   un nuovo modello dati: ciascuno resta modificabile dalla sua tabella
   originale, la griglia è solo una vista. refType/refIdx permettono di
   risalire all'oggetto esatto al tap (vedi showEquipDetail). */
const ZAINO_GRID_SLOTS = 20;
// Icona per parte del corpo, derivata dalla posizione fissa in c.slots
// (l'ordine di defaultSlots non cambia mai: 0=Capo,1=Busto,2=Braccio Sx,
// 3=Braccio Dx,4=Gamba Sx,5=Gamba Dx) e non dal nome, che è testo libero
// modificabile dal giocatore.
const ARMOR_PART_ICON = ['🪖', '🦺', '🧤', '🧤', '🥾', '🥾'];
function zainoGridItems(c) {
  const items = [];
  (c.consumabili || []).forEach((r, i) => {
    if (!r.nome) return;
    const cls = r.effetto === 'recuperoHp' ? 'zaino-icon-hp' : r.effetto === 'recuperoMp' ? 'zaino-icon-mp' : 'zaino-icon-buff';
    items.push({ icon: '🧪', cssClass: cls, label: r.nome, refType: 'consumabile', refIdx: i });
  });
  (c.weaponSlots || []).forEach((s, i) => {
    if (s.equipaggiato !== false) return;
    const icon = s.kind === 'scudo' ? '🛡️' : (s.weaponClass === 'tiro' ? '🏹' : '🗡️');
    items.push({ icon, cssClass: '', label: s.name || (s.kind === 'scudo' ? 'Scudo' : 'Arma'), refType: 'weaponSlot', refIdx: i });
  });
  (c.slots || []).forEach((s, i) => {
    if (s.equipaggiato !== false) return;
    items.push({ icon: ARMOR_PART_ICON[i] || '🛡️', cssClass: '', label: s.name || 'Armatura', refType: 'slot', refIdx: i });
  });
  (c.inventario || []).forEach((r, i) => {
    if (!r.nome) return;
    items.push({ icon: '🔑', cssClass: '', label: r.nome, refType: 'inventario', refIdx: i });
  });
  return items;
}
function renderZainoGrid(c) {
  const grid = $('#zaino-grid');
  const note = $('#zaino-grid-note');
  if (!grid || !note) return;
  const items = zainoGridItems(c);
  const cells = [];
  for (let i = 0; i < ZAINO_GRID_SLOTS; i++) {
    const it = items[i];
    cells.push(it
      ? `<button type="button" class="zaino-slot filled ${it.cssClass}" title="${escapeHtml(it.label)}" data-zainoref="${it.refType}::${it.refIdx}">${it.icon}</button>`
      : `<div class="zaino-slot"></div>`);
  }
  grid.innerHTML = cells.join('');
  note.textContent = items.length > ZAINO_GRID_SLOTS
    ? `Zaino pieno: ${items.length}/${ZAINO_GRID_SLOTS} slot, gli oggetti in eccesso non hanno un'icona disponibile.`
    : '';
}
/* Una riga "etichetta / valore" del popup di dettaglio equip (tap su
   un'icona dello Zaino): stessa classe .row-between già in uso nel
   riepilogo Zaino, sola lettura — la modifica resta nella sezione
   d'origine (Locazioni armatura / Scudo e armi / Consumabili / Zaino). */
function equipDetailRow(label, value) {
  return `<div class="row-between"><span class="helper-text" style="margin:0;">${label}</span><span>${value}</span></div>`;
}
/* Corpo del popup per arma/scudo/armatura (tutti passano per equipCardHtml,
   condividono taglia/qualità/atk/dif/durabilità/peso/nota/bonus). */
function equipDetailEquipHtml(s) {
  const rangeLabel = (s.size || s.quality) ? [s.size, s.quality].filter(Boolean).join(' · ') : '—';
  const broken = (Number(s.durCur) || 0) <= 0 && s.statsConfirmed;
  const bonusLines = (s.bonuses || []).map(b => {
    const label = b.kind === 'primary' ? (PRIMARY_STATS.find(p => p.key === b.key) || {}).label || b.key : (b.name || '—');
    return equipDetailRow(label, `+${Number(b.valore) || 0}`);
  });
  const weaponInfo = s.kind === 'arma' ? `
    ${equipDetailRow('Tipologia', s.weaponClass === 'tiro' ? 'A distanza' : s.weaponClass === 'lancio' ? 'Da lancio' : 'Bianca')}
    ${equipDetailRow('Agisce con', [s.usaFor && 'FRZ', s.usaDex && 'DEX', s.usaFmen && 'F.MEN'].filter(Boolean).join(', ') || '—')}` : '';
  return `<div class="equip-detail-stats">
    ${equipDetailRow('Taglia · Qualità', rangeLabel)}
    ${weaponInfo}
    ${equipDetailRow('Atk', Number(s.atk) || 0)}
    ${equipDetailRow('Dif', Number(s.dif) || 0)}
    ${equipDetailRow('Durabilità', `${Number(s.durCur) || 0} / ${Number(s.dur) || 0}${broken ? ' · 🔨 Rotta' : ''}`)}
    ${equipDetailRow('Peso', `${Number(s.peso) || 0} Kg`)}
    ${s.bonus ? `<p class="helper-text" style="margin:6px 0 0;">${escapeHtml(s.bonus)}</p>` : ''}
    ${bonusLines.length ? `<div class="equip-detail-bonuses"><span class="helper-text" style="margin:0;">Bonus meccanici${s.equipaggiato === false ? ' (non attivi: non equipaggiato)' : ''}</span>${bonusLines.join('')}</div>` : ''}
  </div>`;
}
function equipDetailConsumabileHtml(r) {
  const effLabel = (CONSUMABLE_EFFECTS.find(e => e.key === r.effetto) || {}).label || '—';
  const targetLabel = r.effetto === 'incremento' && r.target ? statLabel(r.target)
    : r.effetto === 'rimuoviStato' && r.target ? (statusEffectByName(r.target) || {}).label || r.target
    : '';
  const effetti = Array.isArray(r.effetti) ? r.effetti : [];
  const extraCount = Math.max(0, effetti.length - 1);
  return `<div class="equip-detail-stats">
    ${equipDetailRow('Effetto', targetLabel ? `${effLabel} (${targetLabel})` : effLabel)}
    ${extraCount ? equipDetailRow('Altri effetti', `+${extraCount}`) : ''}
    ${equipDetailRow('Valore', Number(r.valore) || 0)}
    ${equipDetailRow('Quantità', Number(r.quantita) || 0)}
  </div>`;
}
function equipDetailInventarioHtml(r) {
  return `<div class="equip-detail-stats">
    ${equipDetailRow('Peso', `${Number(r.peso) || 0} Kg`)}
    ${r.note ? `<p class="helper-text" style="margin:6px 0 0;">${escapeHtml(r.note)}</p>` : ''}
  </div>`;
}
/* Apre il popup di dettaglio (sola lettura) per l'oggetto risolto da
   refType/refIdx — stessi identificatori scritti in data-zainoref da
   renderZainoGrid/zainoGridItems. */
function showEquipDetail(c, refType, refIdx) {
  let title = '', body = '';
  if (refType === 'weaponSlot') {
    const s = c.weaponSlots[refIdx]; if (!s) return;
    title = s.name || (s.kind === 'scudo' ? 'Scudo' : 'Arma');
    body = equipDetailEquipHtml(s);
  } else if (refType === 'slot') {
    const s = c.slots[refIdx]; if (!s) return;
    title = s.name || 'Armatura';
    body = equipDetailEquipHtml(s);
  } else if (refType === 'consumabile') {
    const r = c.consumabili[refIdx]; if (!r) return;
    title = r.nome || 'Oggetto';
    body = equipDetailConsumabileHtml(r);
  } else if (refType === 'inventario') {
    const r = c.inventario[refIdx]; if (!r) return;
    title = r.nome || 'Oggetto';
    body = equipDetailInventarioHtml(r);
  } else return;
  $('#equip-detail-title').textContent = title;
  $('#equip-detail-body').innerHTML = body;
  $('#equip-detail-modal').classList.remove('hidden');
}
/* Wiring statico (una volta sola in init): tap su un'icona dello Zaino apre
   il popup, il bottone Chiudi o un tap sul backdrop lo richiudono (il tasto
   indietro Android lo chiude già da solo via closeTopOverlay, essendo un
   .confirm-modal). */
function wireZainoGridDetail() {
  $('#zaino-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-zainoref]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const [refType, refIdx] = btn.dataset.zainoref.split('::');
    showEquipDetail(c, refType, Number(refIdx));
  });
  $('#equip-detail-close').addEventListener('click', () => $('#equip-detail-modal').classList.add('hidden'));
  $('#equip-detail-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) $('#equip-detail-modal').classList.add('hidden');
  });
}
/* Stesso ordine di defaultSlots() (js/app.js:201-207): usato per mostrare
   la locazione scelta dal Narratore nel titolo del popup di ricezione. */
const ARMOR_LOCATIONS = ['Capo', 'Busto', 'Braccio Sx', 'Braccio Dx', 'Gamba Sx', 'Gamba Dx'];
/* Popup "loot dal Narratore" (c.pendingLoot, riempito da
   syncCharacterFromCloud in js/cloud-character.js): un elemento alla volta,
   sola lettura — riusa le stesse funzioni di dettaglio del popup zaino
   (equipDetailEquipHtml/equipDetailConsumabileHtml/equipDetailInventarioHtml),
   dato che ogni item ha esattamente la stessa forma di weaponSlots/slots/
   consumabili/inventario. */
function showNextPendingLoot(c) {
  if (!c || !Array.isArray(c.pendingLoot) || !c.pendingLoot.length) return;
  if (!$('#loot-received-modal').classList.contains('hidden')) return;
  const entry = c.pendingLoot[0];
  const item = entry.item || {};
  let title = '', body = '';
  if (entry.itemType === 'arma' || entry.itemType === 'scudo') {
    title = `Il Narratore ti ha inviato: ${item.name || 'Oggetto'}`;
    body = equipDetailEquipHtml(item);
  } else if (entry.itemType === 'armatura') {
    const loc = ARMOR_LOCATIONS[Number(item.targetSlotIndex)] || 'Armatura';
    title = `Il Narratore ti ha inviato: ${item.name || 'Armatura'} (per: ${loc})`;
    body = equipDetailEquipHtml(item);
  } else if (entry.itemType === 'consumabile') {
    title = `Il Narratore ti ha inviato: ${item.nome || 'Oggetto'}`;
    body = equipDetailConsumabileHtml(item);
  } else if (entry.itemType === 'chiave') {
    title = `Il Narratore ti ha inviato: ${item.nome || 'Oggetto'}`;
    body = equipDetailInventarioHtml(item);
  } else { c.pendingLoot.shift(); showNextPendingLoot(c); return; }
  $('#loot-received-title').textContent = title;
  $('#loot-received-body').innerHTML = body;
  $('#loot-received-modal').classList.remove('hidden');
}
/* Accetta/rifiuta il primo elemento in coda: se accettato lo aggiunge
   nell'array giusto (armi/scudi arrivano non equipaggiati, nello Zaino;
   l'armatura sovrascrive subito la locazione scelta dal Narratore, già
   equipaggiata), in ogni caso lo toglie dalla coda e ripubblica la scheda
   (così il server smette di riproporlo), poi passa al prossimo in coda. */
function applyPendingLootItem(c, accepted) {
  const entry = c.pendingLoot[0];
  if (!entry) return;
  if (accepted) {
    const item = entry.item || {};
    if (entry.itemType === 'arma' || entry.itemType === 'scudo') {
      // i bonus (statistica/tratto/rigenerazione) eventualmente allegati dal
      // Narratore in "Invia loot" arrivano con il pezzo, non vanno azzerati.
      // hasBeenConfirmed riflette qui l'identità reale del pezzo in arrivo
      // (già confermato dal Narratore se statsConfirmed true) — mai dedotta
      // da dur, così un successivo sblocco+riconferma dal giocatore non lo
      // ripara gratis; il backfill di ensureShape farebbe lo stesso al primo
      // giro, ma va fissato subito per restare corretto anche prima di un
      // reload.
      c.weaponSlots.push(Object.assign({}, item, { equipaggiato: false, hasBeenConfirmed: item.statsConfirmed === true }));
      renderWeaponSlots(c);
    } else if (entry.itemType === 'armatura') {
      const idx = Number(item.targetSlotIndex) || 0;
      const { targetSlotIndex, ...stats } = item;
      if (c.slots[idx]) Object.assign(c.slots[idx], stats, { equipaggiato: true, hasBeenConfirmed: item.statsConfirmed === true });
      renderSlots(c);
    } else if (entry.itemType === 'consumabile') {
      c.consumabili.push(item);
      renderConsumabili(c);
    } else if (entry.itemType === 'chiave') {
      c.inventario.push(item);
      renderInventario(c);
    }
    toast(`Aggiunto: ${item.name || item.nome || 'oggetto'}`);
  }
  c.pendingLoot.shift();
  $('#loot-received-modal').classList.add('hidden');
  touchActive();
  showNextPendingLoot(c);
}
function wireLootReceivedModal() {
  $('#loot-received-accept').addEventListener('click', () => { const c = getActive(); if (c) applyPendingLootItem(c, true); });
  $('#loot-received-reject').addEventListener('click', () => { const c = getActive(); if (c) applyPendingLootItem(c, false); });
}
/* Riga di riepilogo di una versione della scheda (locale o cloud), usata
   dal popup di conflitto sotto: gli stessi 4 numeri che decidono davvero
   quale versione è "più sviluppata" (livello, HP/MP massimi, quante righe
   di Tecniche/Abilità hanno un nome compilato — gli slot vuoti non contano),
   mai un'etichetta "questo dispositivo"/"cloud" che non dice nulla su COSA
   si sta per tenere o buttare. */
function characterSyncSummaryLine(level, charData) {
  const cd = charData || {};
  const nTec = (cd.tecniche || []).filter(t => t && t.nome).length;
  const nAb = (cd.abilita || []).filter(t => t && t.nome).length;
  return `Lv ${level != null ? level : '?'} · HP max ${cd.hpMaxTracked != null ? cd.hpMaxTracked : '?'} · `
    + `MP max ${cd.mpMaxTracked != null ? cd.mpMaxTracked : '?'} · `
    + `${nTec} Tecnic${nTec === 1 ? 'a' : 'he'}, ${nAb} Abilità`;
}
/* Popup di conflitto sincronizzazione (vedi syncCharacterFromCloud in
   cloud-character.js): a differenza degli altri popup qui la scelta
   dell'utente deve tornare a chi ha chiamato, che è una funzione async in
   attesa — una Promise tenuta in una variabile di modulo, risolta dai due
   bottoni (wired una sola volta in init, come wireLootReceivedModal). Se più
   personaggi sono in conflitto nello stesso giro, syncMyCharactersFromCloud
   li risolve in sequenza (un await per personaggio dentro un for...of),
   quindi il popup successivo compare solo dopo la risposta a quello attuale.
   p_cloudLevel/p_cloudData: livello e dati della riga cloud appena letta
   (vedi syncCharacterFromCloud), per mostrare le due carte affiancate. */
let syncConflictResolve = null;
// Le due versioni a confronto, tenute qui (non solo nella Promise) perché il
// bottone "👁 Visualizza" apre una schermata separata (renderCharView) e
// deve poter ritrovarle al ritorno, senza richiudere il popup di conflitto.
let syncConflictLocalChar = null;
let syncConflictCloudChar = null;
// Vero mentre una delle due schede è aperta in anteprima (openSyncConflictPreview):
// dice a goBackStep() di riaprire il popup di conflitto DOPO il cambio vista.
let syncConflictPreviewPending = false;
function promptSyncConflict(c, cloudLevel, cloudData) {
  return new Promise(resolve => {
    syncConflictResolve = resolve;
    syncConflictLocalChar = c;
    // renderCharView si aspetta un oggetto "a forma di personaggio" con id:
    // cloudData è il blob grezzo di characters.data, senza .id (mai stato
    // dentro characters[] su questo dispositivo) — stesso trucco già usato
    // da openNarratoreCharacterView per una scheda letta dal cloud.
    syncConflictCloudChar = Object.assign({}, cloudData, { id: c.id, nome: (cloudData && cloudData.nome) || c.nome, livello: cloudLevel });
    $('#sync-conflict-title').textContent = `Personaggio modificato anche altrove: ${c.nome || 'senza nome'}`;
    const localAvatar = $('#sync-conflict-local-avatar');
    localAvatar.style.backgroundImage = c.portrait ? `url(${c.portrait})` : '';
    localAvatar.style.backgroundPosition = c.portrait ? portraitPosValue(c.portraitPos) : '';
    $('#sync-conflict-local-label').innerHTML = `<b>Versione su questo dispositivo:</b> ${escapeHtml(characterSyncSummaryLine(c.livello, c))}`;
    const cloudAvatar = $('#sync-conflict-cloud-avatar');
    cloudAvatar.style.backgroundImage = (cloudData && cloudData.portrait) ? `url(${cloudData.portrait})` : '';
    cloudAvatar.style.backgroundPosition = (cloudData && cloudData.portrait) ? portraitPosValue(cloudData.portraitPos) : '';
    $('#sync-conflict-cloud-label').innerHTML = `<b>Versione nel cloud:</b> ${escapeHtml(characterSyncSummaryLine(cloudLevel, cloudData))}`;
    $('#sync-conflict-modal').classList.remove('hidden');
  });
}
/* Apre la scheda completa in sola lettura di una delle due versioni a
   confronto (charViewMode dedicata: nasconde le azioni Narratore/rimuovi,
   che qui non hanno senso), nascondendo temporaneamente il popup di
   conflitto — non lo risolve, il popup ricompare al "Indietro". */
function openSyncConflictPreview(which) {
  const target = which === 'cloud' ? syncConflictCloudChar : syncConflictLocalChar;
  if (!target) return;
  $('#sync-conflict-modal').classList.add('hidden');
  syncConflictPreviewPending = true;
  charViewMode = 'sync-conflict';
  renderCharView(target);
  $('#btn-del-charview').classList.add('hidden');
  $('#charview-narratore-actions').classList.add('hidden');
  showView('charview');
}
function wireSyncConflictModal() {
  $('#sync-conflict-view-local').addEventListener('click', () => openSyncConflictPreview('local'));
  $('#sync-conflict-view-cloud').addEventListener('click', () => openSyncConflictPreview('cloud'));
  $('#sync-conflict-keep-local').addEventListener('click', () => {
    $('#sync-conflict-modal').classList.add('hidden');
    syncConflictLocalChar = null; syncConflictCloudChar = null;
    if (syncConflictResolve) { const r = syncConflictResolve; syncConflictResolve = null; r('local'); }
  });
  $('#sync-conflict-use-cloud').addEventListener('click', () => {
    $('#sync-conflict-modal').classList.add('hidden');
    syncConflictLocalChar = null; syncConflictCloudChar = null;
    if (syncConflictResolve) { const r = syncConflictResolve; syncConflictResolve = null; r('cloud'); }
  });
}
function renderInventario(c) {
  $('#inventario-table').innerHTML = c.inventario.map((r, i) => `
    <tr>
      <td><input type="text" value="${escapeHtml(r.nome)}" data-inv="nome" data-idx="${i}" placeholder="Oggetto"></td>
      <td><input type="number" min="0" step="0.5" value="${Number(r.peso) || 0}" data-inv="peso" data-idx="${i}"></td>
      <td><input type="text" value="${escapeHtml(r.note)}" data-inv="note" data-idx="${i}" placeholder="Note"></td>
    </tr>`).join('') || `<tr><td colspan="3" class="helper-text">Nessun oggetto.</td></tr>`;
  renderZainoSummary(c);
}

/* ------------------------------------------------------- consumo oggetti */

/* Select combinato per il bersaglio di un oggetto 'incremento' (statistica
   O tratto) / 'applicaBuffMalus' (solo tratto, traitOnly=true — vedi
   submit_use_consumable, il ramo statMods percentuale non è nello scope di
   questo checkpoint): stessa fonte e stessa codifica valore di
   traitBonusItemSelectHtml, "copiando quelli già presenti" come richiesto —
   tratti già posseduti dal personaggio, poi quelli già noti e approvati
   dal Narratore in questa storia (cachedCampaignKnownTraits, il "database
   di tratti" di campaign_known_traits), infine "Nuovo tratto
   personalizzato" per categoria (propone il nome al Narratore via
   addCampaignKnownTrait, stesso circuito di approvazione già in uso). */
function consumableTargetSelectHtml(c, i, item, traitOnly) {
  const ownByList = {};
  ITEM_BONUS_TRAIT_LISTS.forEach(lk => {
    ownByList[lk] = [...new Set([...(c.shownTraits[lk] || []), ...((c.customTraits[lk] || []).map(t => t.name))])].filter(Boolean);
  });
  const knownExtra = {};
  ITEM_BONUS_TRAIT_LISTS.forEach(lk => {
    const known = (c.cloudCampaignId ? (cachedCampaignKnownTraits(c.cloudCampaignId)[lk] || []) : []);
    knownExtra[lk] = known.filter(n => n && !ownByList[lk].includes(n));
  });
  const listKey = ITEM_BONUS_TRAIT_LISTS.includes(item.targetListKey) ? item.targetListKey : '';
  const isCustom = !!listKey && !!item.target && !ownByList[listKey].includes(item.target) && !knownExtra[listKey].includes(item.target);
  const optGroup = (label, lk, names) => names.length
    ? `<optgroup label="${escapeHtml(label)}">${names.map(n => `<option value="trait::${lk}::${escapeHtml(n)}" ${!isCustom && listKey === lk && item.target === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</optgroup>`
    : '';
  const knownAll = ITEM_BONUS_TRAIT_LISTS.flatMap(lk => knownExtra[lk].map(n => ({ lk, n })));
  const statOptGroup = traitOnly ? '' : `
      <optgroup label="Statistiche primarie">${PRIMARY_STATS.map(s => `<option value="stat::${s.key}" ${!listKey && item.target === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}</optgroup>
      <optgroup label="Statistiche secondarie">${SECONDARY_STATS.map(s => `<option value="stat::${s.key}" ${!listKey && item.target === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}</optgroup>`;
  return `
    <select data-cons="target" data-idx="${i}" aria-label="Bersaglio dell'oggetto">
      <option value="">— scegli —</option>
      ${optGroup(TRAIT_LIST_LABELS.capacitaCombattive, 'capacitaCombattive', ownByList.capacitaCombattive)}
      ${optGroup(TRAIT_LIST_LABELS.capacitaNormali, 'capacitaNormali', ownByList.capacitaNormali)}
      ${optGroup(TRAIT_LIST_LABELS.conoscenze, 'conoscenze', ownByList.conoscenze)}
      ${knownAll.length ? `<optgroup label="Già usati in questa storia">${knownAll.map(({ lk, n }) => `<option value="trait::${lk}::${escapeHtml(n)}" ${!isCustom && listKey === lk && item.target === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</optgroup>` : ''}
      ${statOptGroup}
      <option value="__custom__::capacitaCombattive" ${isCustom && listKey === 'capacitaCombattive' ? 'selected' : ''}>Nuovo tratto (Combattive)…</option>
      <option value="__custom__::capacitaNormali" ${isCustom && listKey === 'capacitaNormali' ? 'selected' : ''}>Nuovo tratto (Normali)…</option>
      <option value="__custom__::conoscenze" ${isCustom && listKey === 'conoscenze' ? 'selected' : ''}>Nuovo tratto (Conoscenze)…</option>
    </select>
    <input type="text" data-conscustom="${i}" value="${escapeHtml(isCustom ? item.target : '')}" placeholder="Nome tratto" maxlength="40" aria-label="Nome tratto personalizzato" class="${isCustom ? '' : 'hidden'}">`;
}

function renderConsumabili(c) {
  $('#consum-table').innerHTML = c.consumabili.map((r, i) => {
    const isIncrement = r.effetto === 'incremento';
    const isRimuoviStato = r.effetto === 'rimuoviStato';
    const isTimedTraitBuff = r.effetto === 'applicaBuffMalus';
    const targetCell = isIncrement
      ? consumableTargetSelectHtml(c, i, r, false)
      : isTimedTraitBuff
      ? `${consumableTargetSelectHtml(c, i, r, true)}
         <div style="display:inline-flex;align-items:center;gap:4px;margin-top:4px;"><label class="helper-text" style="margin:0;">Durata (turni)</label>
         <input type="number" min="1" value="${Number(r.durationQuarters) || 12}" data-cons="durationQuarters" data-idx="${i}" style="width:64px;"></div>`
      : isRimuoviStato
      ? `<select data-cons="target" data-idx="${i}">
          <option value="">— scegli —</option>
          ${STATUS_EFFECTS.map(s => `<option value="${s.key}" ${r.target === s.key ? 'selected' : ''}>${s.icon} ${s.label}</option>`).join('')}
        </select>`
      : '<span class="helper-text" style="margin:0;">—</span>';
    return `<tr>
      <td class="col-wide"><input type="text" value="${escapeHtml(r.nome)}" data-cons="nome" data-idx="${i}" placeholder="Nome oggetto"></td>
      <td><select data-cons="effetto" data-idx="${i}">
        ${CONSUMABLE_EFFECTS.map(ef => `<option value="${ef.key}" ${r.effetto === ef.key ? 'selected' : ''}>${ef.label}</option>`).join('')}
      </select></td>
      <td>${targetCell}</td>
      <td class="col-narrow"><input type="number" value="${r.valore}" min="0" data-cons="valore" data-idx="${i}"></td>
      <td class="col-narrow"><input type="number" value="${r.quantita}" min="0" data-cons="quantita" data-idx="${i}"></td>
      <td><button class="btn btn-sm btn-primary" data-cons-use="${i}" ${((isIncrement || isRimuoviStato || isTimedTraitBuff) && !r.target) || Number(r.quantita) <= 0 ? 'disabled' : ''}>Usa</button></td>
      <td><button class="btn btn-icon btn-sm btn-ghost" data-cons-del="${i}" aria-label="Rimuovi oggetto">✕</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="helper-text">Nessun oggetto consumabile.</td></tr>`;
  renderZainoGrid(c);
}

function renderActiveBuffs(c) {
  const wrap = $('#active-buffs');
  if (!c.statBuffs.length) {
    wrap.innerHTML = `<p class="helper-text" style="margin:0;">Nessun incremento attivo.</p>`;
    return;
  }
  wrap.innerHTML = c.statBuffs.map(b => `
    <div class="row-between buff-row">
      <span class="helper-text" style="margin:0;">${escapeHtml(b.nome || 'Oggetto')} → <strong class="buff-amt">+${b.valore} ${statLabel(b.target)}</strong></span>
      <button class="btn btn-ghost btn-sm" data-buff-suspend="${b.id}">Sospendi</button>
    </div>`).join('');
}

/* Applica l'effetto di un consumabile e scala di 1 le scorte (mai sotto zero) */
/* Elenco degli "effetti" applicati da una riga consumabile: l'array
   composto se presente (oggetti come Benda = HP + rimuovi Sanguinare
   insieme), altrimenti la tripla singola incapsulata — stessa logica di
   submit_use_consumable lato server. */
function consumableEffectsList(item) {
  if (Array.isArray(item.effetti) && item.effetti.length) return item.effetti;
  return [{ effetto: item.effetto, target: item.target, valore: item.valore }];
}
/* Prompt di scelta per un consumabile 'rimuoviStatoScelta' (es. Kit
   medico): mostra gli stati attualmente attivi sul personaggio (noti al
   client solo dentro un incontro di combattimento, combatState.activeEffects)
   e risolve con la status_key scelta, o null se annullato/nessuno stato. */
function openStatusChoicePicker(activeStatuses) {
  return new Promise(resolve => {
    const modal = $('#consumable-status-choice-modal');
    const list = $('#consumable-status-choice-list');
    list.innerHTML = activeStatuses.map(e => {
      const info = percentContestStatusInfo(e.status_key) || { icon: '✦', label: e.status_key };
      return `<button type="button" class="btn btn-ghost" data-statuschoicepick="${escapeHtml(e.status_key)}">${info.icon} ${escapeHtml(info.label)}</button>`;
    }).join('');
    modal.classList.remove('hidden');
    const cleanup = () => {
      modal.classList.add('hidden');
      list.removeEventListener('click', onPick);
      $('#consumable-status-choice-cancel').removeEventListener('click', onCancel);
    };
    const onPick = e => {
      const btn = e.target.closest('[data-statuschoicepick]');
      if (!btn) return;
      cleanup();
      resolve(btn.dataset.statuschoicepick);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    list.addEventListener('click', onPick);
    $('#consumable-status-choice-cancel').addEventListener('click', onCancel);
  });
}
async function useConsumable(c, idx) {
  const item = c.consumabili[idx];
  if (!item || Number(item.quantita) <= 0) return;

  // Personaggi collegati al cloud: la RPC applica tutto server-side (HP/MP/
  // rimozione stato/effetti composti), funzionando anche a combattimento
  // attivo — a differenza della vecchia mutazione puramente locale, che
  // falliva in silenzio quando hpCur/mpCur erano bloccati dal trigger di
  // guardia durante un incontro 'active'.
  if (c.cloudCharacterId) {
    const effects = consumableEffectsList(item);
    let choiceStatusKey = null;
    if (effects.some(e => e.effetto === 'rimuoviStatoScelta')) {
      const activeStatuses = combatEffectsForChar(c.cloudCharacterId);
      if (!activeStatuses.length) { toast('Nessuno stato attivo da rimuovere'); return; }
      choiceStatusKey = await openStatusChoicePicker(activeStatuses);
      if (!choiceStatusKey) return;
    }
    try {
      await submitUseConsumableCloud(c.cloudCharacterId, idx, choiceStatusKey);
      await syncCharacterFromCloud(c);
      renderConsumabili(c);
      renderActiveBuffs(c);
      // Il bersaglio può ora essere anche un Tratto (non solo una
      // statistica): refreshAfterEquipBonusChange ridisegna anche
      // renderTraits (oltre a updatePlayBars/renderPrimaryStats/renderDiagram
      // già inclusi), altrimenti un incremento su un Tratto resterebbe
      // invisibile finché non si cambia scheda/tab.
      refreshAfterEquipBonusChange(c);
      toast(`${item.nome || 'Oggetto'} usato`);
    } catch (err) { toast(describeErrorWithContext('Errore nell\'uso dell\'oggetto', err)); }
    return;
  }

  // Personaggio solo-locale (mai salvato nel cloud): nessun combattimento
  // server-autorevole a cui agganciarsi, resta la mutazione diretta di
  // sempre — solo HP/MP/PP/incremento hanno senso qui, gli effetti di
  // rimozione stato non si applicano (nessuno stato tracciato localmente).
  const valore = Number(item.valore) || 0;
  if (item.effetto === 'recuperoHp') {
    c.hpCur = clamp(c.hpCur + valore, 0, effectiveHpMax(c));
    toast(`${item.nome || 'Oggetto'} usato`);
  } else if (item.effetto === 'recuperoMp') {
    c.mpCur = clamp(c.mpCur + valore, 0, effectiveMpMax(c));
    toast(`${item.nome || 'Oggetto'} usato`);
  } else if (item.effetto === 'recuperoPp') {
    c.ppCur = clamp((Number(c.ppCur) || 0) + valore, 0, effectivePpMax(c));
    toast(`${item.nome || 'Oggetto'} usato`);
  } else if (item.effetto === 'incremento') {
    if (!item.target) { toast('Scegli prima la statistica o il tratto da incrementare'); return; }
    c.statBuffs.push({ id: uid(), nome: item.nome || 'Oggetto', target: item.target, listKey: item.targetListKey || null, valore });
    toast(`Incremento attivo: +${valore} a ${statLabel(item.target)}. Avvisa il Narratore.`);
  }
  item.quantita = Math.max(0, Number(item.quantita) - 1);
  renderConsumabili(c);
  renderActiveBuffs(c);
  refreshAfterEquipBonusChange(c);
  touchActive();
}

/* Stato K.O.: sotto il 10% degli HP massimi restano possibili solo un tiro
   percentuale (agisce se supera il 70%) o il consumo di una risorsa di
   recupero HP */
function renderKoStatus(c) {
  const hpMax = effectiveHpMax(c);
  const inKo = hpMax > 0 && c.hpCur <= koThreshold(c);
  $('#ko-section-title').classList.toggle('hidden', !inKo);
  $('#ko-box').classList.toggle('hidden', !inKo);
  if (!inKo) return;
  $('#ko-status-text').textContent =
    `HP ${c.hpCur} / ${hpMax} — soglia K.O. (${koThreshold(c)}) raggiunta: puoi solo tentare un tiro percentuale (agisci se superi il ${KO_ROLL_SUCCESS}%) oppure consumare una risorsa di recupero HP.`;
  const healables = c.consumabili
    .map((r, i) => ({ r, i }))
    .filter(x => x.r.effetto === 'recuperoHp' && Number(x.r.quantita) > 0);
  $('#ko-heal-options').innerHTML = healables.length
    ? healables.map(x => `<button class="btn btn-ghost btn-sm" data-cons-use="${x.i}" style="margin:0 6px 6px 0;">${escapeHtml(x.r.nome || 'Oggetto')} (+${Number(x.r.valore) || 0} HP · ${x.r.quantita} rimasti)</button>`).join('')
    : `<p class="helper-text" style="margin:0;">Nessuna risorsa di recupero HP disponibile.</p>`;
}

/* ---------------------------------------------------------------- note */

function renderNote(c) {
  $$('[data-bg]').forEach(el => { el.value = c.bg[el.dataset.bg] || ''; });
  $('#n-libere').value = c.note.libere;
  renderRelazioni(c);
  renderBgLockUI(c);
}
/* Ogni sezione del Background è sola lettura finché non si preme
   "Modifica" (nessuna conferma richiesta per sbloccarla) e torna bloccata
   solo dopo conferma esplicita su "Conferma e blocca" — vedi il modale
   #bg-lock-confirm. I campi restano sempre interamente leggibili: niente
   scorrimento interno, l'altezza della textarea segue il contenuto. */
function renderBgLockUI(c) {
  if (!c.bgLocked) c.bgLocked = defaultBgLocked();
  BG_SECTIONS.forEach(key => {
    // nel wizard di creazione le sezioni si mostrano già pronte alla
    // scrittura (nessun "Modifica" da premere prima) senza toccare
    // c.bgLocked stesso — "Conferma e blocca" resta comunque disponibile
    const locked = wizardActive ? false : (c.bgLocked[key] !== false);
    const body = document.querySelector(`[data-bgbody="${key}"]`);
    if (body) {
      body.querySelectorAll('textarea, input[type="text"]').forEach(el => {
        el.readOnly = locked;
        if (el.tagName === 'TEXTAREA') autoResizeTextarea(el);
      });
    }
    const editBtn = document.querySelector(`[data-bgedit="${key}"]`);
    const lockBtn = document.querySelector(`[data-bglock="${key}"]`);
    if (editBtn) editBtn.classList.toggle('hidden', !locked);
    if (lockBtn) lockBtn.classList.toggle('hidden', locked);
  });
}
/* Relazioni: N schede libere (familiari, amici, colleghi...), ciascuna con
   Nome, Relazione (che rapporto lega l'NPC al personaggio) e Descrizione. */
function renderRelazioni(c) {
  const wrap = $('#relazioni-list');
  const locked = wizardActive ? false : (!c.bgLocked || c.bgLocked.relazioni !== false);
  const ro = locked ? 'readonly' : '';
  wrap.innerHTML = (c.relazioni || []).map((r, i) => `
    <div class="box relazione-card"><div class="box-bar"></div><div class="box-pad">
      <div class="field-row">
        <div class="field"><label>Nome</label><input type="text" ${ro} value="${escapeHtml(r.nome)}" data-relazione="nome" data-idx="${i}" placeholder="Nome dell'NPC" aria-label="Nome — relazione ${i + 1}"></div>
        <div class="field"><label>Relazione</label><input type="text" ${ro} value="${escapeHtml(r.relazione)}" data-relazione="relazione" data-idx="${i}" placeholder="Es. Fratello, Amico, Collega..." aria-label="Relazione — relazione ${i + 1}"></div>
      </div>
      <div class="field" style="margin-top:8px;"><label>Descrizione</label><textarea ${ro} data-relazione="descrizione" data-idx="${i}" placeholder="Che rapporto lega il personaggio a questo NPC" aria-label="Descrizione — relazione ${i + 1}">${escapeHtml(r.descrizione)}</textarea></div>
      <button class="btn btn-ghost btn-sm" data-del-relazione="${i}" style="align-self:flex-start;margin-top:8px;" ${locked ? 'disabled' : ''}>✕ Rimuovi relazione</button>
    </div></div>`).join('')
    || `<p class="helper-text" style="margin:0;">Nessuna relazione ancora — aggiungine una qui sotto.</p>`;
  wrap.querySelectorAll('textarea[data-relazione]').forEach(autoResizeTextarea);
  const addBtn = $('#relazioni-add');
  if (addBtn) addBtn.disabled = locked;
}

/* Inquadratura del ritratto (background-position in %): di default centrata
   (50/50), regolabile trascinando #portrait-frame (vedi wirePortraitDrag) —
   senza, un'immagine a figura intera mostrava sempre e solo il centro,
   tagliando via viso/spalle se il soggetto non è centrato in verticale.
   Accetta l'oggetto {x,y} (c.portraitPos / p.portraitPos / cloudData.
   portraitPos), mai il personaggio intero. */
function portraitPosValue(pos) {
  const x = (pos && Number.isFinite(pos.x)) ? pos.x : 50;
  const y = (pos && Number.isFinite(pos.y)) ? pos.y : 50;
  return `${x}% ${y}%`;
}
function portraitPosCss(pos) {
  return `background-position:${portraitPosValue(pos)};`;
}

function renderPortrait(c) {
  const frame = $('#portrait-frame');
  frame.style.backgroundImage = c.portrait ? `url(${c.portrait})` : '';
  frame.style.backgroundPosition = c.portrait ? portraitPosValue(c.portraitPos) : '';
  $('#portrait-placeholder').classList.toggle('hidden', !!c.portrait);
  $('#portrait-remove').classList.toggle('hidden', !c.portrait);
  $('#portrait-load').textContent = c.portrait ? 'Cambia immagine' : 'Carica immagine';
  $('#f-nome2').value = c.nome || '';
  updatePortraitDragOverflow(c);
}

/* Ricalcola quanto l'immagine "cover" eccede la cornice (in px, per asse):
   serve al drag di wirePortraitDrag per tradurre lo spostamento del dito in
   uno spostamento coerente del background-position in %, esattamente come
   già fa setupMapFocusDrag per l'inquadratura delle mappe. Il personaggio
   attivo è sempre riletto al bisogno da wirePortraitDrag (getActive()), qui
   si aggiorna solo l'overflow — va rifatto ad ogni nuova immagine/cambio
   personaggio, mai una volta sola. */
let portraitDragOverflow = { x: 0, y: 0 };
function updatePortraitDragOverflow(c) {
  portraitDragOverflow = { x: 0, y: 0 };
  if (!c || !c.portrait) return;
  const box = $('#portrait-frame');
  if (!box) return;
  const probe = new Image();
  probe.onload = () => {
    if (!document.body.contains(box)) return; // scheda chiusa nel frattempo
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.max(rect.width / probe.naturalWidth, rect.height / probe.naturalHeight);
    portraitDragOverflow = {
      x: Math.max(0, probe.naturalWidth * scale - rect.width),
      y: Math.max(0, probe.naturalHeight * scale - rect.height)
    };
  };
  probe.src = c.portrait;
}

/* Trascinamento sul riquadro ritratto per scegliere l'inquadratura — wired
   UNA SOLA VOLTA (il frame è un elemento statico della scheda, mai
   ricreato via innerHTML, a differenza del riquadro mappa che invece si
   ricrea ad ogni apertura del pannello e per cui setupMapFocusDrag viene
   richiamata ogni volta): qui il personaggio attivo va sempre riletto al
   bisogno con getActive(), mai catturato in chiusura. Un tap senza
   spostamento reale continua a funzionare come prima (apre il lightbox o
   il selettore file, vedi il listener 'click' più sotto) grazie al flag
   portraitDragMoved, azzerato lì subito dopo averlo controllato. */
let portraitDragMoved = false;
function wirePortraitDrag() {
  const box = $('#portrait-frame');
  if (!box) return;
  let dragging = false, startX = 0, startY = 0, startFocusX = 50, startFocusY = 50;
  function onDown(x, y) {
    const c = getActive();
    if (!c || !c.portrait) return;
    dragging = true; portraitDragMoved = false; startX = x; startY = y;
    const pos = c.portraitPos || { x: 50, y: 50 };
    startFocusX = pos.x; startFocusY = pos.y;
  }
  function onMove(x, y, ev) {
    if (!dragging) return;
    const c = getActive(); if (!c) return;
    const dx = x - startX, dy = y - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) portraitDragMoved = true;
    if (ev && ev.cancelable) ev.preventDefault();
    const fx = portraitDragOverflow.x > 0 ? clamp(startFocusX - (dx / portraitDragOverflow.x) * 100, 0, 100) : startFocusX;
    const fy = portraitDragOverflow.y > 0 ? clamp(startFocusY - (dy / portraitDragOverflow.y) * 100, 0, 100) : startFocusY;
    c.portraitPos = { x: fx, y: fy };
    box.style.backgroundPosition = `${fx}% ${fy}%`;
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    if (portraitDragMoved) touchActive();
  }
  box.addEventListener('touchstart', e => onDown(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  box.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
  box.addEventListener('touchend', onUp);
  let mouseDown = false;
  box.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; mouseDown = true; onDown(e.clientX, e.clientY); });
  box.addEventListener('pointermove', e => { if (!mouseDown) return; onMove(e.clientX, e.clientY, e); });
  box.addEventListener('pointerup', e => { if (!mouseDown) return; mouseDown = false; onUp(); });
  box.addEventListener('pointercancel', () => { mouseDown = false; dragging = false; });
}

/* Ridimensiona l'immagine scelta (max 512px, JPEG) per stare nei limiti
   dello storage locale, poi la salva come data-URL nel personaggio. */
function loadPortraitFile(file) {
  const c = getActive(); if (!c || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      c.portrait = canvas.toDataURL('image/jpeg', 0.85);
      c.portraitPos = null; // nuova immagine: riparte centrata, il ritaglio della precedente non ha senso qui
      renderPortrait(c);
      renderHeader(c);
      touchActive();
      toast('Immagine salvata');
    };
    img.onerror = () => toast('Immagine non valida');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* La vecchia sezione "Storia" (nome libero + selezione da elenco locale) è
   ridondante appena il personaggio ha già una storia in cloud (attiva o in
   attesa di conferma): "Storia in cloud" mostra già lo stato, tenerle
   entrambe confonde su quale sia quella vera. */
function updateStoriaLegacyVisibility(c) {
  const el = $('#storia-legacy-section');
  if (!el) return;
  el.classList.toggle('hidden', !!(c.cloudCampaignId || c.cloudJoinRequestId));
}

/* Il livello, una volta legato a un Narratore (in campagna, o anche solo
   con una richiesta di ingresso in attesa), lo assegna solo lui (RPC
   narratore_set_level): il giocatore non deve poterlo modificare a mano né
   dalla tab Livelli né dal diagramma, altrimenti si accrediterebbe da solo
   AP non autorizzati — anche mentre la richiesta è ancora in attesa,
   altrimenti potrebbe gonfiarsi il livello prima di essere accettato. Fuori
   da qualsiasi rapporto con un Narratore (gioco locale) resta libero come
   sempre. */
// narratorEditMode: il Narratore che sta correggendo la scheda di un
// giocatore deve poter cambiare il livello direttamente — lo stesso
// bypass già in uso per primaryConfirmed/traitsConfirmed, mai un varco
// per il giocatore stesso (l'RPC di scrittura lato Narratore verifica
// comunque server-side che chi chiama sia davvero il Narratore della
// campagna, indipendentemente da questo flag locale).
function isLevelLocked(c) { return !!(c.cloudCampaignId || c.cloudJoinRequestId) && !narratorEditMode; }
function updateLevelLockUI(c) {
  const locked = isLevelLocked(c);
  const input = $('#f-livello');
  if (input) input.disabled = locked;
  const note = $('#f-livello-lock-note');
  if (note) note.classList.toggle('hidden', !locked);
  const dg = document.querySelector('#stat-diagram [data-dg="lv"]');
  if (dg) dg.classList.toggle('dg-ro', locked);
}

/* Sessione di gioco: quando il personaggio è in una campagna, Riposo e gli
   utilizzi di Tecniche/Abilità restano disponibili solo mentre il Narratore
   ha la sessione "avviata" (narratore_set_session_active) — così non si
   attivano fuori dalla giocata vera e propria. Fuori da qualsiasi campagna
   (gioco locale) resta tutto libero come sempre, nessun gate. A differenza
   del livello/tratti non è un confine di sicurezza sui dati (nessun vantaggio
   permanente in gioco a bypassarlo), quindi basta un gate lato client. */
function isSessionLocked(c) { return !!(c && c.cloudCampaignId) && !c.cloudSessionActive && !narratorEditMode; }
function updateSessionLockUI(c) {
  const locked = isSessionLocked(c);
  const toggleBtn = $('#btn-riposo-toggle');
  if (toggleBtn) toggleBtn.disabled = locked;
  if (locked) { const panel = $('#riposo-panel'); if (panel) panel.classList.add('hidden'); }
  const applyBtn = $('#btn-riposo-applica');
  if (applyBtn) applyBtn.disabled = locked;
  const note = $('#session-lock-note');
  if (note) note.classList.toggle('hidden', !locked);
  renderTertiaryPlusMinus(c);
  renderTecniche(c);
  renderAbilita(c);
}

/* Entrata in gioco: finché una richiesta di ingresso in campagna resta in
   attesa (cloudJoinRequestId senza cloudCampaignId), il personaggio non è
   ancora ufficialmente nella storia — non deve poter spendere P.P. (Boost),
   subire/segnare danni HP o consumare MP, altrimenti si presenterebbe già
   "in gioco" prima ancora che il Narratore lo accetti. Una volta accettato
   (cloudCampaignId valorizzato) torna tutto libero; fuori da qualunque
   campagna (gioco locale) non è mai bloccato. */
function isEntryLocked(c) { return !c.cloudCampaignId && !!c.cloudJoinRequestId; }
function updateEntryLockUI(c) {
  const locked = isEntryLocked(c);
  const boostBtn = $('#boost-activate-btn');
  if (boostBtn) boostBtn.disabled = locked;
  const boostSel = $('#boost-activate-select');
  if (boostSel) boostSel.disabled = locked;
  const note = $('#entry-lock-note');
  if (note) note.classList.toggle('hidden', !locked);
  // "Attacco": nessun personaggio locale (fuori da una campagna condivisa),
  // in attesa d'ingresso, o fuori sessione può chiamare il Narratore —
  // calcolato qui (chiamata sempre dopo updateSessionLockUI, che gira per
  // prima) così unisce entrambi i vincoli invece di sovrascriverne uno.
  // Stato ripristinato ad ogni render della scheda (personaggio appena
  // cambiato/riaperto).
  const combatBtn = $('#btn-request-combat');
  if (combatBtn) combatBtn.disabled = locked || isSessionLocked(c) || !c.cloudCampaignId || !c.cloudCharacterId;
  const combatPendingNote = $('#combat-attack-pending-note');
  if (combatPendingNote) combatPendingNote.classList.add('hidden');
  ['hprim', 'hpuso', 'mprim', 'mpuso'].forEach(key => {
    const dg = document.querySelector(`#stat-diagram [data-dg="${key}"]`);
    if (dg) dg.classList.toggle('dg-ro', locked);
  });
}

/* ----------------------------------------------------------- full render */

function renderSheet() {
  const c = getActive();
  if (!c) return;
  renderHeader(c);
  renderPortrait(c);
  renderBuildGrid(c);
  $('#f-razza').value = c.razza;
  $('#f-eta').value = c.eta;
  $('#f-ruolo').value = c.ruolo;
  $('#f-storia').value = c.storia;
  renderStoriaSelect(c);
  renderCloudStoryBox(c);
  updateStoriaLegacyVisibility(c);
  updateLevelLockUI(c);
  updateSessionLockUI(c);
  updateEntryLockUI(c);
  $('#f-bellezza-manuale').value = c.bellezzaManuale !== null ? c.bellezzaManuale : '';
  $('#bellezza-result').textContent = c.bellezzaTirata !== null ? c.bellezzaTirata : '—';
  // updateDerived calcola hpMaxTracked/mpMaxTracked/prMaxTracked (se ancora
  // null, li inizializza dal moltiplicatore/build): va eseguito PRIMA di
  // renderPrimaryStats, che li legge per mostrare i valori "cresciuti"
  // (HP/MP dal Lv2, P.R. sempre) — altrimenti il primo render di una
  // scheda nuova li mostrerebbe a 0 finché non scatta un secondo render.
  updateDerived(c);
  renderPrimaryStats(c);
  resetRiposoPanel();
  renderDiagram(c);
  renderQi(c);
  renderTertiaryStats(c);
  renderTertiaryRefTable();
  renderTraits(c);
  $('#f-livello').value = c.livello;
  $('#f-ap-disponibili').value = c.apDisponibili;
  renderLevelTable();
  highlightCurrentLevel(c);
  renderTertiaryCostTable();
  renderTertiaryPlusMinus(c);
  syncGrowthCurrent();
  updateGrowthCost();
  renderSlots(c);
  renderWeaponSlots(c);
  renderRetroNote(c);
  // Tecniche/Abilità sono già state renderizzate da updateSessionLockUI(c)
  // (poco sopra): nessuna funzione fra le due righe modifica c.qi/c.livello/
  // c.tecAbChoices/c.tecAbNarratoreBonus, quindi una seconda chiamata qui
  // produrrebbe lo stesso identico output — solo lavoro raddoppiato ad ogni
  // apertura scheda (vedi anche il commento su renderTecabField, idempotente
  // proprio per tollerare la doppia chiamata che c'era prima).
  renderBoostRows(c);
  renderBoost(c);
  renderInventario(c);
  renderConsumabili(c);
  renderActiveBuffs(c);
  renderNote(c);
  applyNarratorEditUiState();
}

/* =========================================================== EVENT WIRING */

function init() {
  loadAll();
  initDiagram();
  renderCharList();
  if (activeId && getActive()) {
    renderSheet();
  }
  showView('cover');
  wireStaticEvents();
  wireNarratorEditControls();
  // Punto di controllo "avvio app" per gli avanzamenti pendenti (vedi
  // checkTecabPendingAdvancements): un incontro può essersi concluso
  // mentre l'app era chiusa, per qualunque personaggio salvato qui.
  checkTecabPendingAdvancementsForAll();
  renderHomeIdentityBox();
  registerServiceWorker();
  // conferma al plugin OTA che il bundle avviato funziona (altrimenti
  // dopo un timeout tornerebbe automaticamente alla versione precedente)
  const up = otaPlugin();
  if (up && up.notifyAppReady) up.notifyAppReady().catch(() => {});
  lastUpdateCheckAt = Date.now();
  checkForUpdate();
  wireHardwareBackButton();
}

/* Tasto "indietro" fisico/gesture Android: chiude un eventuale overlay
   aperto, altrimenti risale la pila delle view (stessa logica del back
   del browser/PC) fino alla Home, dove si ferma. Un'ulteriore pressione a
   quel punto (viewStack già a 1, nessun altro overlay aperto) chiede
   conferma ("Vuoi uscire dal gioco?", #exit-app-confirm) invece di uscire
   subito o di restare bloccati lì per sempre: solo confermando esplicitamente
   chiude l'app. closeTopOverlay() considera anche #exit-app-confirm stesso
   (è un .confirm-modal come gli altri), quindi un ulteriore "indietro" con
   la conferma già aperta la chiude soltanto, senza uscire. */
function wireHardwareBackButton() {
  const app = nativeAppPlugin();
  if (!app) return;
  app.addListener('backButton', () => {
    if (closeTopOverlay()) return;
    if (viewStack.length > 1) { history.back(); return; }
    const modal = $('#exit-app-confirm');
    if (modal) modal.classList.remove('hidden');
  });
}

function wireStaticEvents() {
  // ---- navigazione ----
  $('#btn-new-char').addEventListener('click', createCharacterFlow);
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => history.back()));
  $('#btn-char-menu').addEventListener('click', charMenu);
  wireCloudAccountEvents();
  wireCloudCharacterEvents();
  wireRulesEvents();
  wireTecabAdvancementModal();
  wireAccessibleModals();
  wireFieldLabelObserver();

  // ---- banner aggiornamento ----
  $('#update-banner-btn').addEventListener('click', () => {
    if (!updateUrl) return;
    toast('Download avviato: a fine scaricamento tocca la notifica per installare');
    // Chrome (Safe Browsing) può segnare come "non sicuro" o bloccare il
    // download di un .apk poco diffuso come questo: non è un problema
    // dell'app né del file, è una verifica di reputazione che Google fa
    // per qualunque eseguibile scaricato da un sito "sconosciuto" ai suoi
    // occhi. L'istruzione per sbloccarlo resta visibile qui sotto (prima
    // andava cercata a memoria, o si passava dalla modalità in incognito).
    $('#update-banner-chrome-help').classList.remove('hidden');
    // Navigazione diretta: in Capacitor gli URL esterni si aprono nel
    // browser di sistema e la WebView resta sull'app.
    location.href = updateUrl;
  });

  // ---- menù copertina (hamburger + indice) ----
  const coverMenuBtn = $('#btn-cover-menu');
  const coverMenu = $('#cover-menu');
  function closeCoverMenu() {
    coverMenu.classList.add('hidden');
    coverMenuBtn.setAttribute('aria-expanded', 'false');
  }
  coverMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = coverMenu.classList.toggle('hidden');
    coverMenuBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
  });
  document.addEventListener('click', e => {
    if (!coverMenu.classList.contains('hidden') && !coverMenu.contains(e.target)) closeCoverMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCoverMenu();
  });
  coverMenu.addEventListener('click', e => {
    const item = e.target.closest('.cm-item');
    if (!item) return;
    closeCoverMenu();
    if (item.dataset.menuNav === 'rules') { renderRules(); showView('rules'); return; }
    if (item.dataset.menuNav === 'master') { renderMasterArea(); showView('master'); return; }
    if (item.dataset.menuNav === 'premises') { renderPremisesArea(); showView('premises'); return; }
    if (item.dataset.menuNav === 'account') { renderAccountArea(); showView('account'); return; }
    if (item.dataset.menuNav === 'previously') { renderPreviouslyOnView(); showView('previously'); return; }
    if (item.dataset.menuNav === 'campaigns') { if (typeof renderMyCampaignsBox === 'function') renderMyCampaignsBox(); showView('campaigns'); return; }
    if (item.dataset.menuNav === 'charlist') { renderCharList(); showView('list'); return; }
    if (item.dataset.menuNav === 'newchar') { createCharacterFlow(); return; }
  });

  // ---- Area Master ----
  $('#btn-create-story').addEventListener('click', () => {
    const nome = $('#new-story-name').value.trim();
    const pass = $('#new-story-pass').value;
    if (!nome) { toast('Dai un nome alla storia'); return; }
    if (!pass) { toast('Imposta una password'); return; }
    stories.push({ id: uid(), nome, password: pass, characters: [], premessa: null, createdAt: Date.now() });
    saveStories();
    $('#new-story-name').value = '';
    $('#new-story-pass').value = '';
    renderMasterArea();
    toast('Storia creata');
  });
  $('#story-list').addEventListener('click', e => {
    const card = e.target.closest('[data-storyid]');
    if (!card) return;
    const s = stories.find(x => x.id === card.dataset.storyid);
    if (!s) return;
    const pass = prompt(`Password per "${s.nome}":`);
    if (pass === null) return;
    if (pass !== s.password) { toast('Password errata'); return; }
    openStory(s.id);
  });
  $('#btn-del-story').addEventListener('click', () => {
    const s = getActiveStory(); if (!s) return;
    if (!confirm(`Eliminare la storia "${s.nome}" e i ${s.characters.length} personaggi importati? L'azione non è reversibile.`)) return;
    stories = stories.filter(x => x.id !== s.id);
    activeStoryId = null;
    saveStories();
    renderMasterArea();
    showView('master');
    toast('Storia eliminata');
  });
  $('#btn-import-char').addEventListener('click', () => {
    const text = $('#import-json').value.trim();
    if (!text) { toast('Incolla prima la scheda del giocatore'); return; }
    importCharacterFromText(text);
    $('#import-json').value = '';
  });
  // ---- premesse di gioco (lato Narratore) ----
  $('#premises-story-list').addEventListener('click', e => {
    const card = e.target.closest('[data-premstoryid]');
    if (!card) return;
    const s = stories.find(x => x.id === card.dataset.premstoryid);
    if (!s) return;
    const pass = prompt(`Password per "${s.nome}":`);
    if (pass === null) return;
    if (pass !== s.password) { toast('Password errata'); return; }
    openPremisesStory(s.id);
  });
  $('#premises-title').addEventListener('input', () => {
    const s = getActiveStory(); if (!s || !s.premessa) return;
    s.premessa.titolo = $('#premises-title').value;
    saveStories();
  });
  $('#premises-upload-btn').addEventListener('click', () => $('#premises-pdf-input').click());
  $('#premises-pdf-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const s = getActiveStory(); if (!s) return;
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) { toast('Seleziona un file PDF'); return; }
    if (file.size > PREMESSA_MAX_BYTES) {
      toast(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`);
      return;
    }
    try {
      await savePdfBlob(s.id, file); // il contenuto va in IndexedDB, non in localStorage
    } catch (err) {
      toast('Impossibile salvare il PDF sul dispositivo (spazio insufficiente?)');
      return;
    }
    s.premessa = {
      titolo: ($('#premises-title').value || '').trim() || file.name.replace(/\.pdf$/i, ''),
      filename: file.name,
      size: file.size,
      pubblicata: false,
      uploadedAt: Date.now()
    };
    saveStories();
    renderPremisesStory();
    toast('PDF caricato');
  });
  $('#premises-open-btn').addEventListener('click', async () => {
    const s = getActiveStory(); if (!s || !s.premessa) return;
    const blob = await loadPdfBlob(s.id);
    if (!blob) { toast('PDF non trovato sul dispositivo: ricaricalo'); return; }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (window.MSPdfViewer) window.MSPdfViewer.open({ bytes, title: s.premessa.titolo || s.nome, label: 'Narratore · ' + s.nome });
  });
  $('#premises-remove-btn').addEventListener('click', async () => {
    const s = getActiveStory(); if (!s) return;
    if (!confirm('Rimuovere il PDF caricato?')) return;
    s.premessa = null;
    saveStories();
    renderPremisesStory();
    await deletePdfBlob(s.id).catch(() => {});
  });
  $('#btn-share-premesse-pdf').addEventListener('click', async () => {
    const s = getActiveStory(); if (!s) return;
    if (!s.premessa) { toast('Carica prima un PDF'); return; }
    const blob = await loadPdfBlob(s.id);
    if (!blob) { toast('PDF non trovato sul dispositivo: ricaricalo'); return; }
    const dataUrl = 'data:application/pdf;base64,' + (await blobToBase64(blob));
    const text = JSON.stringify({
      type: 'premessa_pdf', storia: s.nome,
      titolo: s.premessa.titolo, filename: s.premessa.filename, dataUrl
    });
    const proceed = () => {
      const done = () => toast('Invito copiato: incollalo nella chat coi giocatori');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    };
    const mb = text.length / (1024 * 1024);
    if (mb > 4 && !confirm(`L'invito è pesante (~${mb.toFixed(1)} MB): su alcuni telefoni copia/incolla può non funzionare. Continuare comunque?`)) return;
    proceed();
  });

  // ---- premesse di gioco (lato giocatore) ----
  $('#btn-premesse').addEventListener('click', () => {
    renderPremPopup();
    $('#prem-popup').classList.remove('hidden');
  });
  $('#prem-popup-close').addEventListener('click', () => $('#prem-popup').classList.add('hidden'));
  $('#prem-popup').addEventListener('click', e => {
    if (e.target.id === 'prem-popup') $('#prem-popup').classList.add('hidden');
  });
  $('#prem-popup-list').addEventListener('click', async e => {
    const c = getActive(); if (!c) return;
    const storia = (c.storia || '').trim();
    const onlineBtn = e.target.closest('#prem-popup-open-online');
    if (onlineBtn) {
      const original = onlineBtn.textContent;
      onlineBtn.disabled = true;
      onlineBtn.textContent = 'Scaricamento…';
      const bytes = await fetchStoryPdfBytes(onlineBtn.dataset.storyid);
      onlineBtn.disabled = false;
      onlineBtn.textContent = original;
      if (!bytes) { toast('Impossibile scaricare il PDF: verifica la connessione'); return; }
      if (window.MSPdfViewer) {
        const index = await getStoriesIndex();
        const entry = index.find(x => x.id === onlineBtn.dataset.storyid);
        window.MSPdfViewer.open({ bytes, title: (entry && entry.titolo) || 'Premessa', label: (c.nome || 'Giocatore') + ' · ' + storia });
      }
      return;
    }
    if (!e.target.closest('#prem-popup-open')) return;
    const p = loadPremesse()[storia];
    if (!p) return;
    const blob = await loadPdfBlob('import:' + storia);
    if (!blob) { toast('PDF non trovato sul dispositivo: incolla di nuovo l\'invito'); return; }
    if (window.MSPdfViewer) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      window.MSPdfViewer.open({ bytes, title: p.titolo || 'Premessa', label: (c.nome || 'Giocatore') + ' · ' + storia });
    }
  });
  $('#prem-import-btn').addEventListener('click', () => {
    const text = $('#prem-import').value.trim();
    if (!text) { toast('Incolla prima l\'invito del Narratore'); return; }
    importPremesseInvito(text);
    $('#prem-import').value = '';
  });

  $('#story-chars').addEventListener('click', e => {
    const card = e.target.closest('[data-viewchar]');
    if (!card) return;
    const s = getActiveStory(); if (!s) return;
    const c = s.characters.find(x => x.id === card.dataset.viewchar);
    if (c) { charViewMode = 'story'; renderCharView(c); }
  });
  // Torna sempre indietro nella history invece di forzare una view fissa:
  // charview si apre sia da "story" sia dal pannello Narratore ("account"),
  // e un showView(target) diretto qui spingerebbe una voce duplicata sulla
  // pila (viewStack) ogni volta che il target è già presente più in basso,
  // finché avanti e indietro finivano per rimbalzare solo fra le ultime due
  // view senza mai risalire fino alla Home.
  $('#btn-back-story').addEventListener('click', () => history.back());
  $('#btn-del-charview').addEventListener('click', async () => {
    if (charViewMode === 'cloud-narratore') {
      if (!viewingCharId) return;
      const name = $('#charview-title').textContent || 'questo personaggio';
      if (!confirm(`Rimuovere "${name}" dalla storia? La sua scheda resta al giocatore, solo scollegata da questa storia.`)) return;
      try {
        await narratoreRemoveCharacterCloud(viewingCharId);
        toast('Personaggio rimosso dalla storia');
        viewingCharId = null;
        history.back();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    const s = getActiveStory(); if (!s || !viewingCharId) return;
    const c = s.characters.find(x => x.id === viewingCharId);
    if (!confirm(`Rimuovere "${(c && c.nome) || 'questo personaggio'}" dalla storia?`)) return;
    s.characters = s.characters.filter(x => x.id !== viewingCharId);
    viewingCharId = null;
    saveStories();
    history.back();
    toast('Rimosso dalla storia');
  });

  // ---- lista personaggi (delegation) ----
  $('#char-list').addEventListener('click', e => {
    const dup = e.target.closest('[data-dup]');
    const del = e.target.closest('[data-del]');
    if (dup) { e.stopPropagation(); duplicateCharacter(dup.dataset.dup); return; }
    if (del) { e.stopPropagation(); deleteCharacter(del.dataset.del); return; }
    const card = e.target.closest('.char-card');
    if (!card) return;
    const cc = characters.find(x => x.id === card.dataset.id);
    if (cc && !cc.creationCompleted) openCreationWizard(cc.id);
    else openCharacter(card.dataset.id);
  });

  // ---- wizard di creazione: navigazione ----
  $('#wiz-prev').addEventListener('click', wizPrev);
  $('#wiz-next').addEventListener('click', wizNext);
  $('#wiz-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-wizmode]');
    if (btn) setWizardMode(btn.dataset.wizmode);
  });
  // Build/Statistiche/Tratti/Tecniche&Abilità sono editabili dentro il loro
  // step senza mai lasciarlo: ogni interazione lì dentro deve poter
  // riabilitare Avanti (es. spendere l'ultimo punto statistica rimasto),
  // non solo il passaggio da uno step all'altro (vedi updateWizardNavButtons)
  $('#wiz-body').addEventListener('click', () => updateWizardNavButtons());
  $('#wiz-body').addEventListener('input', () => updateWizardNavButtons());
  $('#wiz-body').addEventListener('change', () => updateWizardNavButtons());
  $('#wiz-finish').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (!wizardAllValid(c)) { toast('Completa tutti i passaggi prima di confermare'); return; }
    $('#wiz-final-confirm').classList.remove('hidden');
  });
  $('#wiz-final-confirm-yes').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#wiz-final-confirm').classList.add('hidden');
    if (!wizardAllValid(c)) { toast('Completa tutti i passaggi prima di confermare'); return; }
    c.buildConfirmed = true;
    c.primaryConfirmed = true;
    snapshotPrimaryFloor(c);
    snapshotTraitsFloor(c);
    c.traitsConfirmed = true;
    // solo le righe davvero mostrate per questa build (vedi
    // wizardVisibleTecAbRows): l'array può contenere righe vuote residue di
    // una build scelta e poi cambiata durante il wizard, mai ripulite
    wizardVisibleTecAbRows(c, 'tecniche').forEach(r => { r.tipoConfirmed = true; });
    wizardVisibleTecAbRows(c, 'abilita').forEach(r => { r.tipoConfirmed = true; });
    c.creationCompleted = true;
    wizardTeardown();
    renderBuildGrid(c);
    renderPrimaryStats(c);
    renderTraits(c);
    renderTecniche(c);
    renderAbilita(c);
    touchActive();
    if (viewStack[viewStack.length - 1] === 'create') viewStack.pop();
    showView('sheet');
    showTab('identita');
    toast('Personaggio creato!');
  });
  $('#wiz-final-confirm-no').addEventListener('click', () => {
    $('#wiz-final-confirm').classList.add('hidden');
  });

  // ---- wizard di creazione: swipe orizzontale (in aggiunta ai bottoni
  // Indietro/Avanti, che restano sempre il modo primario di navigare) ----
  (function setupWizardSwipe() {
    const body = $('#wiz-body');
    if (!body) return;
    const INTERACTIVE_SEL = 'input,button,select,textarea,.stepper,.data-table,.bg-section-body,.build-grid';
    let startX = 0, startY = 0, tracking = false, decided = false, horizontal = false;
    function onStart(x, y, target) {
      if (target && target.closest && target.closest(INTERACTIVE_SEL)) { tracking = false; return; }
      startX = x; startY = y; tracking = true; decided = false; horizontal = false;
    }
    function onMove(x, y, ev) {
      if (!tracking) return;
      const dx = x - startX, dy = y - startY;
      if (!decided) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        decided = true;
        horizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (horizontal && ev.cancelable) ev.preventDefault();
    }
    function onEnd(x) {
      const wasHorizontal = tracking && decided && horizontal;
      const dx = x - startX;
      tracking = false;
      if (!wasHorizontal || Math.abs(dx) < 40) return;
      if (dx < 0) wizNext(); else wizPrev();
    }
    body.addEventListener('touchstart', e => onStart(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
    body.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    body.addEventListener('touchend', e => onEnd(e.changedTouches[0].clientX));
    let mouseDown = false;
    body.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; mouseDown = true; onStart(e.clientX, e.clientY, e.target); });
    body.addEventListener('pointermove', e => { if (!mouseDown) return; onMove(e.clientX, e.clientY, e); });
    body.addEventListener('pointerup', e => { if (!mouseDown) return; mouseDown = false; onEnd(e.clientX); });
    body.addEventListener('pointercancel', () => { mouseDown = false; tracking = false; });
  })();

  // ---- tabs ----
  $('#tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) showTab(btn.dataset.tab);
  });

  // ---- header nome (sincronizzato col campo in Identità) ----
  $('#f-nome').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.nome = $('#f-nome').value;
    $('#f-nome2').value = c.nome;
    touchActive();
  });

  // ---- identità ----
  $('#f-razza').addEventListener('input', () => setField('razza', $('#f-razza').value));
  $('#f-eta').addEventListener('input', () => setField('eta', $('#f-eta').value));
  $('#f-ruolo').addEventListener('input', () => setField('ruolo', $('#f-ruolo').value));
  $('#f-storia').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.storia = $('#f-storia').value;
    // se il nome digitato non coincide più con la storia scelta dal menù, scollega l'id
    if (c.storiaId) {
      const opt = $('#f-storia-select').selectedOptions[0];
      if (!opt || opt.textContent !== c.storia) c.storiaId = null;
    }
    touchActive();
  });
  $('#f-storia-select').addEventListener('change', () => {
    const c = getActive(); if (!c) return;
    const sel = $('#f-storia-select');
    const opt = sel.selectedOptions[0];
    if (!opt || !opt.value) { c.storiaId = null; touchActive(); return; }
    c.storiaId = opt.value;
    c.storia = opt.textContent;
    $('#f-storia').value = c.storia;
    touchActive();
  });
  $('#btn-refresh-stories').addEventListener('click', async () => {
    const c = getActive(); if (!c) return;
    const index = await getStoriesIndex(true);
    await renderStoriaSelect(c);
    toast(index.length ? `${index.length} stori${index.length === 1 ? 'a' : 'e'} pubblicat${index.length === 1 ? 'a' : 'e'}` : 'Nessuna storia pubblicata al momento');
  });
  $('#btn-share-master').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const copy = JSON.parse(JSON.stringify(c));
    delete copy.portrait; // troppo pesante per la chat
    const text = JSON.stringify(copy);
    const done = () => toast('Scheda copiata: incollala nella chat col Narratore');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  });
  $('#f-bellezza-manuale').addEventListener('input', () => {
    const v = $('#f-bellezza-manuale').value;
    setField('bellezzaManuale', v === '' ? null : Number(v));
  });
  $('#roll-bellezza-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const roll = rollDie(20);
    c.bellezzaTirata = roll;
    $('#bellezza-result').textContent = roll;
    touchActive();
  });

  // applica materialmente il click sulla build-card/swap (condiviso dal
  // percorso normale e da quello del wizard, dopo l'eventuale conferma di
  // azzeramento Tecniche/Abilità)
  function applyBuildCardClick(c, swap, card) {
    pendingBuild = { build: c.build, eclMult: c.eclecticoHpMult };
    if (swap) {
      c.eclecticoHpMult = Number(swap.dataset.swap);
      c.build = 'eclettico';
    } else {
      c.build = card.dataset.buildcard;
      if (c.build === 'eclettico' && !c.eclecticoHpMult) c.eclecticoHpMult = 7;
    }
    refreshAfterBuildChange(c); // richiama già touchActive()
  }
  $('#build-grid').addEventListener('click', e => {
    const swap = e.target.closest('[data-swap]');
    const card = e.target.closest('[data-buildcard]');
    const c = getActive(); if (!c) return;
    if (!swap && !card) return;
    if (c.buildConfirmed) {
      toast('Classe già confermata: non può essere cambiata');
      return;
    }
    if (wizardActive) {
      e.stopPropagation();
      // cambio classe effettivo? (non solo un secondo click sulla stessa)
      const changing = swap
        ? (c.build !== 'eclettico' || Number(swap.dataset.swap) !== currentHpMult(c))
        : card.dataset.buildcard !== c.build;
      const tecAbHasContent = (c.tecniche || []).some(rowHasContent) || (c.abilita || []).some(rowHasContent);
      if (changing && tecAbHasContent) {
        pendingWizardBuildClick = { swap, card };
        $('#build-change-confirm').classList.remove('hidden');
        return;
      }
      // nessun contenuto da perdere: applica subito, senza modale di
      // conferma classe (nel wizard tutto resta modificabile fino al
      // passo finale)
      applyBuildCardClick(c, swap, card);
      return;
    }
    applyBuildCardClick(c, swap, card);
    // chiede conferma della scelta
    const b = BUILDS[c.build];
    const variante = c.build === 'eclettico' ? ` (HP×${currentHpMult(c)} / MP×${currentMpMult(c)})` : '';
    $('#class-confirm-text').textContent = `Sei sicuro di voler scegliere la classe ${b.label}${variante}? Dopo la conferma non potrà più essere cambiata.`;
    $('#class-confirm').classList.remove('hidden');
  });
  $('#build-change-confirm-yes').addEventListener('click', () => {
    const c = getActive();
    $('#build-change-confirm').classList.add('hidden');
    if (!c || !pendingWizardBuildClick) { pendingWizardBuildClick = null; return; }
    c.tecniche = [];
    c.abilita = [];
    c.tecDirectLvUsed = 0;
    c.abDirectLvUsed = 0;
    applyBuildCardClick(c, pendingWizardBuildClick.swap, pendingWizardBuildClick.card);
    pendingWizardBuildClick = null;
  });
  $('#build-change-confirm-no').addEventListener('click', () => {
    $('#build-change-confirm').classList.add('hidden');
    pendingWizardBuildClick = null;
  });
  $('#class-yes').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#class-confirm').classList.add('hidden');
    c.buildConfirmed = true;
    pendingBuild = null;
    // ufficializza i moltiplicatori sui valori presenti in scheda
    refreshAfterBuildChange(c);
    toast(`Classe confermata: ${BUILDS[c.build].label}`);
    touchActive();
  });
  $('#class-no').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#class-confirm').classList.add('hidden');
    // torna alla scelta: ripristina la selezione precedente
    if (pendingBuild) {
      c.build = pendingBuild.build;
      c.eclecticoHpMult = pendingBuild.eclMult;
      pendingBuild = null;
    }
    refreshAfterBuildChange(c);
    touchActive();
  });

  // ---- conferma statistiche primarie (blocco anti-min-max) ----
  $('#primary-lock-status').addEventListener('click', e => {
    if (!e.target.closest('#btn-confirm-primary')) return;
    const c = getActive(); if (!c) return;
    if (Number(c.livello) <= 1 && primaryRemaining(c) !== 0) { toast('Puoi confermare solo con "Punti rimanenti" a zero'); return; }
    $('#primary-confirm-text').textContent = 'Vuoi confermare le tue statistiche primarie? Una volta confermate resteranno bloccate: potrai modificarle di nuovo solo effettuando un level-up.';
    $('#primary-confirm').classList.remove('hidden');
  });
  $('#primary-confirm-yes').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#primary-confirm').classList.add('hidden');
    if (Number(c.livello) <= 1 && primaryRemaining(c) !== 0) { toast('Puoi confermare solo con "Punti rimanenti" a zero'); return; }
    c.primaryConfirmed = true;
    snapshotPrimaryFloor(c);
    renderPrimaryStats(c);
    toast('Statistiche confermate e bloccate');
    touchActive();
  });
  $('#primary-confirm-no').addEventListener('click', () => {
    $('#primary-confirm').classList.add('hidden');
  });

  // ---- conferma tratti (blocco anti-min-max) ----
  $('#traits-lock-status').addEventListener('click', e => {
    if (!e.target.closest('#btn-confirm-traits')) return;
    const c = getActive(); if (!c) return;
    if (!allTraitsAtZero(c)) { toast('Puoi confermare solo con "Punti rimanenti" a zero in tutte le categorie'); return; }
    $('#traits-confirm-text').textContent = 'Vuoi confermare i tuoi tratti? Una volta confermati resteranno bloccati: potrai modificarli di nuovo solo effettuando un level-up.';
    $('#traits-confirm').classList.remove('hidden');
  });
  $('#traits-confirm-yes').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    $('#traits-confirm').classList.add('hidden');
    if (!allTraitsAtZero(c)) { toast('Puoi confermare solo con "Punti rimanenti" a zero in tutte le categorie'); return; }
    snapshotTraitsFloor(c);
    c.traitsConfirmed = true;
    renderTraits(c);
    toast('Tratti confermati e bloccati');
    touchActive();
  });
  $('#traits-confirm-no').addEventListener('click', () => {
    $('#traits-confirm').classList.add('hidden');
  });
  $('#trait-roll-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const raw = $('#trait-roll-select').value;
    if (!raw) return;
    const resultEl = $('#trait-roll-result'), detailEl = $('#trait-roll-detail');
    resultEl.className = 'roll-result';
    if (raw === '__unknown__') {
      const d100 = rollDie(100);
      const success = d100 > 70;
      resultEl.textContent = d100;
      resultEl.classList.add(success ? 'success' : 'fail');
      detailEl.innerHTML = `d100: ${d100} — <span class="${success ? 'success-note' : 'fail-note'}">${success ? 'Successo' : 'Fallimento'}</span>`;
      return;
    }
    const sep = raw.indexOf('::');
    const list = raw.slice(0, sep), name = raw.slice(sep + 2);
    const val = getTraitValue(c, list, name);
    const d20 = rollDie(20);
    resultEl.textContent = d20 + val;
    detailEl.textContent = `d20: ${d20} +${val}`;
  });

  $('#stat-roll-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const key = $('#stat-roll-select').value;
    if (!key) return;
    const stat = PRIMARY_STATS.find(s => s.key === key);
    const val = Number(c.primary[key]) || 0;
    const label = diceForValue(val);
    const resultEl = $('#stat-roll-result'), detailEl = $('#stat-roll-detail');
    if (label === 'd12+d8') {
      const a = rollDie(12), b = rollDie(8);
      resultEl.textContent = a + b + val;
      detailEl.textContent = `${stat.label}: d12+d8 ${a}+${b} +${val}`;
    } else {
      const sides = Number(label.slice(1));
      const roll = rollDie(sides);
      resultEl.textContent = roll + val;
      detailEl.textContent = `${stat.label}: ${label} ${roll} +${val}`;
    }
  });

  // ---- diagramma scheda (fronte) ----
  $('#stat-diagram').addEventListener('input', e => {
    const inp = e.target.closest('[data-dg]');
    if (!inp) return;
    const c = getActive(); if (!c) return;
    const key = inp.dataset.dg;
    const raw = Math.floor(Number(inp.value));
    if (key.startsWith('p:')) {
      const k = key.slice(2);
      const applied = changePrimary(c, k, raw);
      if (applied === null) { inp.value = c.primary[k]; return; } // AP insufficienti
      const st = $(`#primary-stats input[data-pstat-input="${k}"]`);
      if (st) st.value = applied;
      updatePrimaryRemaining(c);
      updateDerived(c);
    } else if (key.startsWith('t:')) {
      const k = key.slice(2);
      const floor = tertiaryFloorFor(c, k);
      const v = isNaN(raw) ? floor : clamp(raw, floor, TERTIARY_MAX);
      c.tertiary[k] = v;
      const st = $(`#tertiary-stats input[data-tstat-input="${k}"]`);
      if (st) st.value = v;
      updateTertiaryRemaining(c);
      renderTertiaryPlusMinus(c);
    } else if (key === 'lv') {
      if (isLevelLocked(c)) { inp.value = c.livello; toast('Sei in una storia: il livello lo assegna il Narratore'); return; }
      c.livello = clamp(isNaN(raw) ? 1 : raw, 1, MAX_LEVEL);
      $('#f-livello').value = c.livello;
      $('#hud-lv').textContent = c.livello;
      $('#sheet-sub').textContent = `${BUILDS[c.build].label} · Livello ${c.livello}`;
      highlightCurrentLevel(c);
      renderRetroNote(c);
      renderTecniche(c);
      renderAbilita(c);
      updateTraitsRemaining(c);
    } else if (key === 'qi') {
      c.qi = isNaN(raw) ? null : raw;
      renderQi(c);
      renderTecniche(c);
      renderAbilita(c);
    } else if (key === 'hprim' || key === 'mprim' || key === 'hpuso' || key === 'mpuso') {
      if (isEntryLocked(c)) {
        inp.value = diagramValue(c, key);
        toast('Il Narratore non ha ancora accettato la richiesta di ingresso: attendi la conferma per segnare danni o uso');
        return;
      }
      if (key === 'hprim') {
        c.hpCur = clamp(isNaN(raw) ? 0 : raw, 0, c.hpMaxTracked || 0);
      } else if (key === 'mprim') {
        c.mpCur = clamp(isNaN(raw) ? 0 : raw, 0, c.mpMaxTracked || 0);
      } else if (key === 'hpuso') {
        const max = c.hpMaxTracked || 0;
        c.hpCur = clamp(max - (isNaN(raw) ? 0 : raw), 0, max);
      } else {
        const max = c.mpMaxTracked || 0;
        c.mpCur = clamp(max - (isNaN(raw) ? 0 : raw), 0, max);
      }
      updatePlayBars(c);
    } else if (key === 'prcur') {
      c.prCur = clamp(isNaN(raw) ? 0 : raw, 0, c.prMaxTracked || 0);
      updatePlayBars(c);
    }
    touchActive();
  });

  // ---- primarie + secondaria (P.R.): point buy (delegation, stessi
  // handler su entrambi i contenitori — sono due box separate solo perché
  // il P.R. non è una primaria, ma condivide identica meccanica di stepper) ----
  function handlePstatClick(e) {
    const btn = e.target.closest('[data-pstat]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const key = btn.dataset.pstat, dir = Number(btn.dataset.dir);
    const isPr = key === 'pr';
    const grown = ((key === 'hp' || key === 'mp') && Number(c.livello) > 1) || isPr;
    const trackedKey = key === 'hp' ? 'hpMaxTracked' : key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
    const current = grown ? (Number(c[trackedKey]) || 0) : Number(c.primary[key]);
    const floor = primaryFloorFor(c, key, grown ? 0 : PRIMARY_MIN);
    const next = current + dir;
    // Il pavimento è un vincolo solo verso il basso: bloccare anche un "+"
    // (dir>0) non ha senso e, se il valore attuale è già sotto il pavimento
    // per qualunque motivo (es. una modifica libera del Narratore), impedisce
    // per sempre di risalire un punto alla volta — ogni "+1" resterebbe
    // comunque sotto la soglia. changePrimary applica comunque il pavimento
    // come clamp finale, quindi qui basta bloccare solo i tentativi di scendere.
    if (dir < 0 && next < floor) { toast(`Valore minimo raggiunto (${floor})`); return; }
    const applied = changePrimary(c, key, next);
    if (applied === null) return; // AP insufficienti (toast già mostrato da changePrimary)
    const stepInput = $(`[data-pstat-input="${key}"]`);
    stepInput.value = applied;
    const down = stepInput.closest('.stepper').querySelector('[data-dir="-1"]');
    if (down) down.classList.toggle('hidden', Number(applied) <= floor);
    updatePrimaryRemaining(c);
    updateDerived(c);
    renderStatDannoPreview(c, key);
    if (key === 'for') renderZainoSummary(c); // la FOR entra nella Regola del Peso
    touchActive();
  }
  function handlePstatInput(e) {
    const input = e.target.closest('[data-pstat-input]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const key = input.dataset.pstatInput;
    const isPr = key === 'pr';
    const grown = ((key === 'hp' || key === 'mp') && Number(c.livello) > 1) || isPr;
    const trackedKey = key === 'hp' ? 'hpMaxTracked' : key === 'mp' ? 'mpMaxTracked' : 'prMaxTracked';
    const applied = changePrimary(c, key, input.value);
    if (applied === null) { input.value = grown ? (Number(c[trackedKey]) || 0) : c.primary[key]; return; } // AP insufficienti
    const floor = primaryFloorFor(c, key, grown ? 0 : PRIMARY_MIN);
    const down = input.closest('.stepper').querySelector('[data-dir="-1"]');
    if (down) down.classList.toggle('hidden', Number(applied) <= floor);
    updatePrimaryRemaining(c);
    updateDerived(c);
    renderStatDannoPreview(c, key);
    if (key === 'for') renderZainoSummary(c);
    touchActive();
  }
  /* Pressione prolungata su un pulsante +/- dello stepper: un tocco singolo
     passa dal normale 'click' (già gestito da handlePstatClick/
     handleTstatClick, sotto); qui si aggiunge solo la ripetizione quando il
     dito/il puntatore resta premuto, richiamando la STESSA funzione con un
     evento sintetico {target: btn} — nessuna duplicazione della logica di
     validazione/costo AP, che resta tutta nei due handler esistenti. Il
     click nativo che segue il rilascio (pointerup→click) va soppresso in
     capture (prima del listener 'click' vero e proprio) solo se la
     ripetizione è già scattata, altrimenti un tap normale duplicherebbe
     l'ultimo incremento. */
  function setupStepperLongPress(containerId, handlerFn) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const LONG_PRESS_DELAY = 450, REPEAT_INTERVAL = 110;
    let timer = null, interval = null, firedByHold = false;
    const stop = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (interval) { clearInterval(interval); interval = null; }
    };
    container.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.stepper button[data-dir]');
      if (!btn || btn.disabled) return;
      firedByHold = false;
      timer = setTimeout(() => {
        firedByHold = true;
        interval = setInterval(() => handlerFn({ target: btn }), REPEAT_INTERVAL);
      }, LONG_PRESS_DELAY);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => container.addEventListener(evt, stop));
    container.addEventListener('click', e => {
      if (firedByHold) { firedByHold = false; e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }
  $('#primary-stats').addEventListener('click', handlePstatClick);
  $('#primary-stats').addEventListener('input', handlePstatInput);
  $('#secondary-stats').addEventListener('click', handlePstatClick);
  $('#secondary-stats').addEventListener('input', handlePstatInput);
  $('#btn-sync-derived').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (!c.primaryConfirmed) {
      toast('Conferma prima le statistiche primarie');
      return;
    }
    // Dal Lv2 in poi HP/MP/P.R. crescono in diretta con gli AP: risincronizzare
    // qui non deve ricalcolarli dal moltiplicatore (cancellerebbe la crescita),
    // si limita a riportare i punti attuali al massimo già raggiunto
    if (Number(c.livello) <= 1) {
      c.hpMaxTracked = Number(c.primary.hp || 0) * currentHpMult(c);
      c.mpMaxTracked = Number(c.primary.mp || 0) * currentMpMult(c);
      c.prMaxTracked = BUILDS[c.build].prIniziali;
    }
    c.hpCur = c.hpMaxTracked || 0; c.mpCur = c.mpMaxTracked || 0; c.prCur = c.prMaxTracked || 0;
    updatePlayBars(c);
    touchActive();
    toast('Sincronizzato');
  });

  // ---- QI ----
  $('#roll-qi-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const qi = (rollDie(4) + rollDie(6) + rollDie(10)) * 10;
    c.qi = qi;
    renderQi(c);
    renderDiagram(c);
    renderTecniche(c);
    renderAbilita(c);
    touchActive();
  });
  $('#f-qi-progresso').addEventListener('input', () => setField('qiProgresso', Number($('#f-qi-progresso').value) || 0));

  // ---- terziarie ----
  function handleTstatClick(e) {
    const btn = e.target.closest('[data-tstat]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    const key = btn.dataset.tstat, dir = Number(btn.dataset.dir);
    const next = Number(c.tertiary[key]) + dir;
    const applied = changeTertiary(c, key, next);
    if (applied === null) return;
    $(`#tertiary-stats input[data-tstat-input="${key}"]`).value = applied;
    updateTertiaryRemaining(c);
    renderTertiaryPlusMinus(c);
    renderDiagram(c);
    touchActive();
  }
  $('#tertiary-stats').addEventListener('click', handleTstatClick);
  $('#tertiary-stats').addEventListener('input', e => {
    const input = e.target.closest('[data-tstat-input]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const key = input.dataset.tstatInput;
    const applied = changeTertiary(c, key, input.value);
    if (applied === null) { input.value = c.tertiary[key]; return; }
    updateTertiaryRemaining(c);
    renderTertiaryPlusMinus(c);
    renderDiagram(c);
    touchActive();
  });
  setupStepperLongPress('primary-stats', handlePstatClick);
  setupStepperLongPress('secondary-stats', handlePstatClick);
  setupStepperLongPress('tertiary-stats', handleTstatClick);

  // ---- tratti (delegation su container) ----
  $('#trait-lists').addEventListener('click', e => {
    const c = getActive(); if (!c) return;
    const stepBtn = e.target.closest('[data-traitstep]');
    const rollBtn = e.target.closest('[data-traitroll]');
    const delBtn = e.target.closest('[data-delcustom]');
    const hideBtn = e.target.closest('[data-hidetrait]');
    if (stepBtn) {
      const input = stepBtn.closest('.trait-stepper').querySelector('[data-traitvalue]');
      input.value = (Number(input.value) || 0) + Number(stepBtn.dataset.traitstep);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      renderTraits(c);
      return;
    }
    if (hideBtn) {
      if (c.traitsConfirmed && !narratorEditMode) { toast('Tratti confermati: si sbloccano solo con un level-up'); return; }
      const list = hideBtn.dataset.list, name = hideBtn.dataset.hidetrait;
      c.shownTraits[list] = (c.shownTraits[list] || []).filter(n => n !== name);
      c.traits[list][name] = 0;
      renderTraits(c);
      touchActive();
      return;
    }
    if (rollBtn) {
      const list = rollBtn.dataset.list, name = rollBtn.dataset.traitroll;
      const val = getTraitValue(c, list, name);
      const d20 = rollDie(20);
      toast(`${name}: 1d20+${val} → ${d20 + val} (dado ${d20})`);
      return;
    }
    if (delBtn) {
      if (c.traitsConfirmed && !narratorEditMode) { toast('Tratti confermati: si sbloccano solo con un level-up'); return; }
      const list = delBtn.dataset.delcustom, idx = Number(delBtn.dataset.idx);
      c.customTraits[list].splice(idx, 1);
      renderTraits(c);
      touchActive();
      return;
    }
  });
  $('#trait-lists').addEventListener('change', e => {
    const sel = e.target.closest('[data-addtraitsel]');
    if (!sel || !sel.value) return;
    const c = getActive(); if (!c) return;
    if (c.traitsConfirmed && !narratorEditMode) { toast('Tratti confermati: si sbloccano solo con un level-up'); sel.value = ''; return; }
    const list = sel.dataset.addtraitsel;
    if (sel.value === '__custom__') {
      c.customTraits[list].push({ name: '', value: 0 });
    } else if (sel.value.startsWith('known::')) {
      // già scritto da un altro personaggio di questa storia: si aggiunge
      // subito con quel nome, non serve ridigitarlo
      const name = sel.value.slice('known::'.length);
      if (!c.customTraits[list].some(t => t.name === name)) c.customTraits[list].push({ name, value: 0 });
    } else if (!(c.shownTraits[list] || []).includes(sel.value)) {
      c.shownTraits[list].push(sel.value);
    }
    renderTraits(c);
    touchActive();
  });
  // A modifica finita normalizza refusi e doppioni nella stessa categoria:
  // un valore già speso confluisce nel tratto canonico, mai eliminato.
  $('#trait-lists').addEventListener('change', e => {
    const nameInput = e.target.closest('[data-customname]');
    if (!nameInput) return;
    const c = getActive(); if (!c) return;
    const list = nameInput.dataset.customname, idx = Number(nameInput.dataset.idx);
    const result = reconcileCustomTrait(c, list, idx, nameInput.dataset.originalName || '');
    if (result.changed) toast(`Tratto ricondotto a “${result.name}”`);
    if (c.cloudCampaignId && result.name) addCampaignKnownTrait(c.cloudCampaignId, list, result.name);
    renderTraits(c);
    touchActive();
  });
  $('#trait-lists').addEventListener('input', e => {
    const c = getActive(); if (!c) return;
    const valInput = e.target.closest('[data-traitvalue]');
    const nameInput = e.target.closest('[data-customname]');
    if (valInput) {
      const list = valInput.dataset.list;
      const hasCustomIdx = valInput.dataset.customIdx !== undefined;
      const idx = hasCustomIdx ? Number(valInput.dataset.customIdx) : null;
      const isNarratoreFree = hasCustomIdx && c.customTraits[list][idx] && !!c.customTraits[list][idx].narratore;
      const traitName = hasCustomIdx ? (c.customTraits[list][idx].name || '') : valInput.dataset.traitvalue;
      const oldVal = hasCustomIdx
        ? (Number(c.customTraits[list][idx].value) || 0)
        : (Number(c.traits[list][valInput.dataset.traitvalue]) || 0);
      let v = clamp(Math.floor(Number(valInput.value)) || 0, 0, 50);
      if (c.traitsConfirmed && !narratorEditMode) {
        toast('Tratti confermati: si sbloccano solo con un level-up');
        v = oldVal;
      } else if (v > oldVal && !isNarratoreFree) {
        // fase di creazione/crescita: non si può superare il pool di QUESTA
        // categoria (le tre tipologie di punti non sono fungibili tra loro).
        // I tratti scritti dal Narratore sono un dono gratuito: non passano
        // da questo controllo.
        const sum = traitsSumForList(c, list);
        const pool = traitsPoolForCharacter(c, list);
        const maxAllowed = oldVal + Math.max(0, pool - sum);
        if (v > maxAllowed) {
          toast(`Punti esauriti in ${TRAIT_LIST_LABELS[list]}: hai già assegnato tutti i ${pool} punti disponibili`);
          v = maxAllowed;
        }
      } else if (v < oldVal && !narratorEditMode) {
        // Un tratto già confermato in un livello precedente non può scendere
        // sotto quel punto neanche mentre si riassegnano i nuovi punti dello
        // sblocco corrente: altrimenti si "libererebbero" punti fantasma
        // spostabili altrove, vanificando la conferma già fatta (vedi
        // snapshotTraitsFloor) — stesso principio già in uso per le
        // statistiche primarie (primaryFloorFor).
        const floor = traitFloorFor(c, list, traitName);
        if (v < floor) {
          toast(`Non puoi scendere sotto ${floor}: valore già confermato in un livello precedente`);
          v = floor;
        }
      }
      valInput.value = v;
      if (hasCustomIdx) c.customTraits[list][idx].value = v;
      else c.traits[list][valInput.dataset.traitvalue] = v;
      const row = valInput.closest('.trait-row');
      row.querySelector('.t-dice').textContent = `+${v}`;
      updateTraitsRemaining(c);
      renderTraitRollSelect(c);
      touchActive();
      return;
    }
    if (nameInput) {
      if (c.traitsConfirmed && !narratorEditMode) return;
      const list = nameInput.dataset.customname, idx = Number(nameInput.dataset.idx);
      c.customTraits[list][idx].name = nameInput.value;
      touchActive();
      return;
    }
  });

  // ---- livelli ----
  $('#f-livello').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    if (isLevelLocked(c)) { $('#f-livello').value = c.livello; return; }
    c.livello = clamp(Math.floor(Number($('#f-livello').value)) || 1, 1, MAX_LEVEL);
    $('#hud-lv').textContent = c.livello;
    $('#sheet-sub').textContent = `${BUILDS[c.build].label} · Livello ${c.livello}`;
    highlightCurrentLevel(c);
    renderRetroNote(c);
    renderTecniche(c);
    renderAbilita(c);
    renderDiagram(c);
    updateTraitsRemaining(c);
    updatePrimaryRemaining(c);
    touchActive();
  });
  // accredita gli AP dei livelli attraversati: subito al blur, e comunque
  // poco dopo l'ultima cifra digitata (alcune tastiere mobili non emettono
  // l'evento change in modo affidabile)
  let livelloCreditTimer = null;
  const scheduleLevelCredit = () => {
    clearTimeout(livelloCreditTimer);
    livelloCreditTimer = setTimeout(() => {
      const c = getActive(); if (c) creditLevelAP(c);
    }, 700);
  };
  $('#f-livello').addEventListener('input', scheduleLevelCredit);
  $('#f-livello').addEventListener('change', () => {
    clearTimeout(livelloCreditTimer);
    const c = getActive(); if (!c) return;
    creditLevelAP(c);
  });
  $('#stat-diagram').addEventListener('input', e => {
    if (e.target.closest('[data-dg="lv"]')) scheduleLevelCredit();
  });
  $('#stat-diagram').addEventListener('change', e => {
    const inp = e.target.closest('[data-dg="lv"]');
    if (!inp) return;
    clearTimeout(livelloCreditTimer);
    const c = getActive(); if (!c) return;
    creditLevelAP(c);
  });
  // "AP disponibili" è solo un visualizzatore per il giocatore (non deve
  // poter scrivercisi direttamente sopra, altrimenti si attribuirebbe da
  // solo AP per comprare statistiche — gli arrivano solo da un level-up, in
  // automatico tramite creditLevelAP, o li spendono le funzioni che già li
  // scalano correttamente: changePrimary, i tratti, i boost...) — ma il
  // Narratore in narratorEditMode deve poter FISSARE un valore esatto come
  // nuovo punto di partenza (es. dopo un level-up fatto a mano che ha
  // lasciato AP incoerenti/negativi), vedi refreshApUI per l'abilitazione
  // del campo. Impostarlo a mano segna anche c.livelloAP = c.livello: da
  // qui in poi un vero level-up successivo accredita solo il delta del
  // NUOVO livello, senza ricontare quanto appena corretto a mano.
  $('#f-ap-disponibili').addEventListener('change', () => {
    const c = getActive(); if (!c || !narratorEditMode) return;
    c.apDisponibili = Math.max(0, Math.floor(Number($('#f-ap-disponibili').value)) || 0);
    c.livelloAP = c.livello;
    refreshApUI(c);
    touchActive();
  });

  ['#growth-type', '#growth-current', '#growth-target'].forEach(sel => {
    $(sel).addEventListener('input', updateGrowthCost);
    $(sel).addEventListener('change', updateGrowthCost);
  });
  $('#growth-type').addEventListener('change', () => { syncGrowthCurrent(); updateGrowthCost(); });

  $$('.tertiary-pm-wrap').forEach(wrap => wrap.addEventListener('click', e => {
    const btn = e.target.closest('[data-pm]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    if (isSessionLocked(c)) {
      toast('Disponibile solo durante la sessione di gioco: attendi che il Narratore la avvii');
      return;
    }
    if (Number(c.livello) <= 1) {
      toast('Stile, Carisma e Fortuna si sbloccano dal Livello 2');
      return;
    }
    const key = btn.dataset.pm, type = btn.dataset.pmtype;
    const pm = c.tertiaryPM[key];
    const label = TERTIARY_STATS.find(s => s.key === key).label;
    if (type === 'plus') {
      // in compresenza di + e - (esiti misti non ancora risolti) il
      // traguardo sale da 3 a 4 "+" (regola ufficiale)
      const threshold = pm.minus > 0 ? 4 : 3;
      pm.plus = Math.min(pm.plus + 1, threshold);
      if (pm.plus >= threshold) {
        const targetLv = c.tertiary[key] + 1;
        if (targetLv > TERTIARY_MAX) {
          pm.plus = 0;
        } else {
          // level-up guadagnato in gioco coi tiri: indipendente dagli AP,
          // a differenza dell'acquisto manuale in "Statistiche" (che invece
          // li spende secondo TERTIARY_AP_TABLE)
          pm.plus = 0;
          pm.minus = 0;
          c.tertiary[key] = targetLv;
          if (!c.tertiaryFloor) c.tertiaryFloor = {};
          c.tertiaryFloor[key] = Math.max(c.tertiaryFloor[key] || TERTIARY_MIN, targetLv);
          toast(`${label} sale di livello!`);
          renderTertiaryStats(c);
        }
      }
    } else {
      pm.minus++;
      // ogni 3 tiri andati male la statistica scende di un punto, senza
      // un fondo minimo (es. da -1 puo' scendere a -2); risolve anche
      // un'eventuale compresenza in corso coi "+", azzerandoli entrambi
      if (pm.minus >= 3) {
        pm.minus = 0;
        pm.plus = 0;
        c.tertiary[key]--;
        toast(`${label} scende di un punto`);
        renderTertiaryStats(c);
      }
    }
    renderTertiaryPlusMinus(c);
    renderDiagram(c);
    touchActive();
  }));

  // ---- retro (solo armature) e fronte (scudo + armi): equip a card ----
  wireEquipGrid('#slot-grid', c => c.slots, renderSlots);
  wireEquipGrid('#weapon-grid', c => c.weaponSlots, renderWeaponSlots);
  wireZainoGridDetail();
  wireLootReceivedModal();
  wireSyncConflictModal();
  wireCombatView();
  wirePortraitDrag();

  $('#btn-add-weapon').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const n = c.weaponSlots.filter(s => s.kind === 'arma').length + 1;
    const w = makeWeaponSlot('arma'); w.name = `Arma ${n}`;
    c.weaponSlots.push(w);
    renderWeaponSlots(c);
    touchActive();
  });
  $('#btn-add-shield').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const n = c.weaponSlots.filter(s => s.kind === 'scudo').length + 1;
    const s = makeWeaponSlot('scudo'); s.name = n > 1 ? `Scudo ${n}` : 'Scudo';
    c.weaponSlots.push(s);
    renderWeaponSlots(c);
    touchActive();
  });

  // ---- Bloccare: Dif scudo + Dif personaggio (bonus inclusi) + tiro Dif puro ----
  $('#block-roll-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const shields = equippedShields(c);
    if (!shields.length) { toast('Nessuno scudo equipaggiato'); return; }
    const shieldDif = shields.reduce((s, sh) => s + (Number(sh.dif) || 0), 0);
    // fuori da un incontro non si sa dove verrebbe colpito: stesso criterio
    // del "colpo generico" (media dei pezzi d'armatura indossati) usato in
    // combatAutoReductionRoll, invece del bonus flat su tutti i pezzi.
    const charDif = (Number(c.primary.dif) || 0)
      + (c.statBuffs || []).filter(b => b.target === 'dif' && !b.listKey).reduce((s, b) => s + (Number(b.valore) || 0), 0)
      + tecAbBuffTotal(c, 'dif')
      + equipDefensiveBonusForHit(c, 'primary', 'dif', null, null);
    const roll = rollPureStatTotal(c, 'dif');
    let total = shieldDif + charDif + roll.total;
    let detail = `Scudo Dif +${shieldDif} · Dif personaggio +${charDif} · tiro Dif puro ${roll.detail}`;
    // Stesso principio di combatRollDefense: una riga Supporto/Misto Attiva
    // con doppioTiroStat='dif' (es. Difesa Corazzata) somma un secondo tiro
    // Dif puro indipendente, anche in questo tiro manuale fuori da un incontro.
    if (combatHasDoppioTiro(c, 'dif')) {
      const roll2 = rollPureStatTotal(c, 'dif');
      total += roll2.total;
      detail += ` · Tiro doppio: secondo tiro Dif puro ${roll2.detail}`;
    }
    $('#block-roll-result').textContent = total;
    $('#block-roll-detail').textContent = detail;
  });

  // ---- Attacca: al massimo 2 armi equipaggiate, stessa Tipologia; la
  // seconda vale metà danno; Danno Fisico (FOR/DEX) e Danno Magico (F.MEN)
  // restano due totali distinti ----
  $('#attack-weapon-list').addEventListener('change', e => {
    const box = e.target.closest('[data-attackweapon]');
    if (!box) return;
    const checked = $$('#attack-weapon-list [data-attackweapon]:checked');
    if (checked.length > 2) {
      box.checked = false;
      toast('Puoi usare al massimo 2 armi nello stesso attacco');
      return;
    }
    if (checked.length === 2) {
      const c = getActive(); if (!c) return;
      const [a, b] = checked.map(inp => c.weaponSlots[Number(inp.dataset.attackweapon)]);
      if (a && b && a.weaponClass !== b.weaponClass) {
        box.checked = false;
        toast('Puoi usare insieme solo armi della stessa tipologia (bianca/a distanza/da lancio)');
      }
    }
  });
  $('#attack-roll-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const checked = $$('#attack-weapon-list [data-attackweapon]:checked')
      .map(inp => c.weaponSlots[Number(inp.dataset.attackweapon)]).filter(Boolean);
    if (!checked.length) { toast('Scegli almeno un\'arma equipaggiata'); return; }
    if (checked.length > 2) { toast('Puoi usare al massimo 2 armi nello stesso attacco'); return; }
    if (checked.length === 2 && checked[0].weaponClass !== checked[1].weaponClass) {
      toast('Arma bianca e arma a distanza non si possono usare insieme'); return;
    }
    const main = checked[0], second = checked[1];
    const detail = [`Arma principale "${main.name || 'Arma'}" Atk +${Number(main.atk) || 0}`];
    let physTotal = Number(main.atk) || 0;
    if (second) {
      const half = Math.floor((Number(second.atk) || 0) / 2);
      physTotal += half;
      detail.push(`Arma secondaria "${second.name || 'Arma'}" Atk ${Number(second.atk) || 0}/2 = +${half}`);
    }
    const usaFor = checked.some(w => w.usaFor), usaDex = checked.some(w => w.usaDex), usaFmen = checked.some(w => w.usaFmen);
    if (usaFor) {
      const r = rollPureStatTotal(c, 'for'); physTotal += r.total; detail.push(`FOR puro: ${r.detail}`);
      if (combatHasDoppioTiro(c, 'for')) { const r2 = rollPureStatTotal(c, 'for'); physTotal += r2.total; detail.push(`Tiro doppio: secondo tiro FOR puro ${r2.detail}`); }
    }
    if (usaDex) {
      const r = rollPureStatTotal(c, 'dex'); physTotal += r.total; detail.push(`DEX puro: ${r.detail}`);
      if (combatHasDoppioTiro(c, 'dex')) { const r2 = rollPureStatTotal(c, 'dex'); physTotal += r2.total; detail.push(`Tiro doppio: secondo tiro DEX puro ${r2.detail}`); }
    }
    let magicTotal = 0;
    if (usaFmen) {
      const r = rollPureStatTotal(c, 'fmen'); magicTotal += r.total; detail.push(`F.MEN puro (Danno magico): ${r.detail}`);
      if (combatHasDoppioTiro(c, 'fmen')) { const r2 = rollPureStatTotal(c, 'fmen'); magicTotal += r2.total; detail.push(`Tiro doppio: secondo tiro F.MEN puro ${r2.detail}`); }
    }
    $('#attack-phys-result').textContent = physTotal;
    $('#attack-magic-result').textContent = usaFmen ? magicTotal : '—';
    $('#attack-roll-detail').innerHTML = detail.join('<br>');
  });

  // ---- scelta Eclettico ai Lv 8/16 (2 Tec / 2 Ab / 1+1) ----
  $('#tecab-choice-box').addEventListener('change', e => {
    const sel = e.target.closest('[data-tecabchoice]');
    if (!sel) return;
    const c = getActive(); if (!c) return;
    if (!c.tecAbChoices) c.tecAbChoices = {};
    c.tecAbChoices[sel.dataset.tecabchoice] = sel.value;
    renderRetroNote(c);
    renderTecniche(c);
    renderAbilita(c);
    touchActive();
  });

  // ---- tecniche / abilità / boost personali (edit tables) ----
  wireEditTable('#tecniche-table', 'tecnica', 'tecniche');
  wireEditTable('#abilita-table', 'abilita', 'abilita');
  wireEditTable('#boostrows-table', 'boostrow', 'boostRows');
  // il selettore "costo incantesimo" nel Fronte Scheda deve restare aggiornato
  // mentre si scrive nome/costo di un'Abilità, non solo ai render completi
  $('#abilita-table').addEventListener('input', () => {
    const c = getActive(); if (c) populateMpCostSelect(c);
  });
  // Blocco "Assegnazioni disponibili" (vedi tecabPendingAssignmentsHtml):
  // UNICO punto in cui un'assegnazione Level Up/Narratore si consuma, con
  // una scelta esplicita — mai una freccia nell'editor. "Annulla e
  // riassegna" (tecabAnnullaRiassegnaHtml) vive sulla riga stessa, stesso
  // handler condiviso fra Tecniche e Abilità.
  const wireTecabAssignmentChoices = (sel, field) => {
    $(sel).addEventListener('click', e => {
      const item = e.target.closest('[data-tecabpending]');
      if (item && e.target.closest('[data-tecabchoosenuova]')) {
        const c = getActive(); if (!c) return;
        const row = consumeTecabAssignmentForNew(c, field, item.dataset.tecabassignid);
        if (row) { touchActive(); if (field === 'tecniche') renderTecniche(c); else renderAbilita(c); }
        return;
      }
      if (item && e.target.closest('[data-tecabchooseincrease]')) {
        const c = getActive(); if (!c) return;
        const sel2 = item.querySelector('[data-tecabincreasesel]');
        const targetIdx = sel2 ? Number(sel2.value) : NaN;
        if (!Number.isFinite(targetIdx) || sel2.value === '') { toast('Scegli quale voce far salire di livello'); return; }
        const row = (c[field] || [])[targetIdx];
        const prevLv = row ? Math.max(1, parseInt(row.lv, 10) || 1) : null;
        if (consumeTecabAssignmentForLevelUp(c, field, item.dataset.tecabassignid, targetIdx)) {
          touchActive();
          toast(row ? `${row.nome} sale di livello (Lv ${prevLv} → ${row.lv})` : 'Livello aumentato');
          if (field === 'tecniche') renderTecniche(c); else renderAbilita(c);
        }
        return;
      }
      const cancelBtn = e.target.closest('[data-tecabcancelassign]');
      if (cancelBtn) {
        const c = getActive(); if (!c) return;
        if (cancelTecabDraftRow(c, field, Number(cancelBtn.dataset.idx))) {
          touchActive();
          toast('Assegnazione restituita: disponibile di nuovo per Nuova voce o Aumenta una esistente');
          if (field === 'tecniche') renderTecniche(c); else renderAbilita(c);
        }
        return;
      }
    });
  };
  wireTecabAssignmentChoices('#tecniche-table', 'tecniche');
  wireTecabAssignmentChoices('#abilita-table', 'abilita');
  // il bottone "+" nella cella Utilizzi non esiste più (vedi utilizziCellHtml):
  // resta solo "Modifica" per aprire l'editor di una singola riga (wizard).
  $('#tecniche-table').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-tecabedit="tecnica"]');
    if (editBtn) { wizardTecabEditing = { field: 'tecniche', idx: Number(editBtn.dataset.idx) }; const c = getActive(); if (c) renderTecniche(c); }
  });
  // bonus/malus rinfrescano l'anteprima puntata sotto la textarea, solo
  // lasciando il campo, mai a ogni tasto.
  $('#tecniche-table').addEventListener('change', e => {
    if (['bonus', 'malus'].includes(e.target.dataset.tecnica)) { const c = getActive(); if (c) renderTecniche(c); }
  });
  $('#abilita-table').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-tecabedit="abilita"]');
    if (editBtn) { wizardTecabEditing = { field: 'abilita', idx: Number(editBtn.dataset.idx) }; const c = getActive(); if (c) renderAbilita(c); }
  });
  // "Fatto" (barra editor di una sola Tecnica/Abilità nel wizard, vedi
  // updateWizardTecabChrome): torna alla panoramica, ri-renderizzando
  // entrambi i campi (uno dei due era nascosto mentre si editava l'altro).
  const wizTecabDone = $('#wiz-tecab-editor-done');
  if (wizTecabDone) wizTecabDone.addEventListener('click', () => {
    wizardTecabEditing = null;
    const c = getActive(); if (!c) return;
    renderTecniche(c);
    renderAbilita(c);
  });
  $('#abilita-table').addEventListener('change', e => {
    if (e.target.dataset.abilita === 'bonus') { const c = getActive(); if (c) renderAbilita(c); }
  });
  $('#boostrows-table').addEventListener('change', e => {
    // 'lv' non è più un input (checkpoint "Boost e pedina di combattimento",
    // punto 7: cambia solo tramite l'avanzamento, mai digitato a mano).
    if (e.target.dataset.boostrow === 'bonus') { const c = getActive(); if (c) renderBoostRows(c); }
  });
  // Ricorda quali "Altri dettagli" sono aperti (vedi tecabCardDetailsOpen
  // in editTecAbCardRows): senza, ogni render successivo (cambio Tipo,
  // aggiunta bonus, level-up...) richiuderebbe tutto da capo.
  ['#tecniche-table', '#abilita-table'].forEach(sel => {
    $(sel).addEventListener('toggle', e => {
      const details = e.target.closest('[data-tecabdetails]');
      if (!details) return;
      const key = details.dataset.tecabdetails;
      if (details.open) tecabCardDetailsOpen.add(key); else tecabCardDetailsOpen.delete(key);
    }, true); // 'toggle' non risale (bubbla solo nei browser più recenti): capture per sicurezza
  });
  wireTraitBonusTable('#tecniche-table');
  wireTraitBonusTable('#abilita-table');
  wireTraitBonusTable('#boostrows-table');
  wireTecAbExtra('#tecniche-table', 'tecniche');
  wireTecAbExtra('#abilita-table', 'abilita');
  $('#boost-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.boostRowsShown = BOOST_ROWS_MAX;
    renderBoostRows(c);
    touchActive();
  });
  $('#boost-remove').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    // Checkpoint "Boost e pedina di combattimento", punto 3: se il secondo
    // Boost contiene dati (nome o bonus compilati) chiede conferma prima di
    // eliminarlo, invece di farlo sparire in silenzio con un click.
    if (c.boostRows[1] && rowHasContent(c.boostRows[1])) {
      const nome = c.boostRows[1].nome || 'questo Boost';
      if (!confirm(`Eliminare "${nome}"? I dati compilati (nome, bonus, avanzamento) andranno persi.`)) return;
    }
    if (c.boostRows[1]) c.boostRows[1] = makeBoostRow();
    c.boostRowsShown = 1;
    renderBoostRows(c);
    touchActive();
  });
  // Conferma di un Boost: blocca nome/bonus/Lv fino al prossimo level-up
  // (vedi creditLevelAP) — bloccata a sua volta finché nome e almeno un
  // bonus non sono compilati, stessa filosofia della Conferma di Tipo di
  // Tecniche/Abilità (wireTecAbExtra).
  $('#boostrows-table').addEventListener('click', async e => {
    const extendBtn = e.target.closest('[data-boostextend]');
    if (extendBtn) {
      const c = getActive(); if (!c) return;
      await extendBoostRow(c, extendBtn.dataset.boostextend);
      renderBoostRows(c);
      return;
    }
    const supremeBtn = e.target.closest('[data-boostsupreme]');
    if (supremeBtn) {
      const c = getActive(); if (!c) return;
      if (applyBoostSupremeCredit(c, Number(supremeBtn.dataset.boostsupreme))) renderBoostRows(c);
      return;
    }
    const confirmBtn = e.target.closest('[data-boostconfirm]');
    if (!confirmBtn) return;
    const c = getActive(); if (!c) return;
    const i = Number(confirmBtn.dataset.boostconfirm);
    const row = c.boostRows[i];
    if (!row || row.boostConfirmed) return;
    const hasNome = !!String(row.nome || '').trim();
    const hasBonus = (row.bonusItems || []).some(it => it.name);
    if (!hasNome || !hasBonus) { toast('Compila nome e almeno un bonus prima di confermare'); return; }
    row.boostConfirmed = true;
    renderBoostRows(c);
    touchActive();
  });

  // ---- inventario ----
  $('#inv-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.inventario.push({ nome: '', note: '', peso: 0 });
    renderInventario(c);
    touchActive();
  });
  $('#inventario-table').addEventListener('input', e => {
    const input = e.target.closest('[data-inv]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), field = input.dataset.inv;
    c.inventario[idx][field] = field === 'peso' ? (Number(input.value) || 0) : input.value;
    if (field === 'peso') renderZainoSummary(c);
    touchActive();
  });

  // ---- relazioni ----
  $('#relazioni-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.relazioni.push(makeRelazioneRow());
    renderRelazioni(c);
    touchActive();
  });
  $('#relazioni-list').addEventListener('input', e => {
    const input = e.target.closest('[data-relazione]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), field = input.dataset.relazione;
    c.relazioni[idx][field] = input.value;
    if (input.tagName === 'TEXTAREA') autoResizeTextarea(input);
    touchActive();
  });
  $('#relazioni-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-del-relazione]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    c.relazioni.splice(Number(btn.dataset.delRelazione), 1);
    renderRelazioni(c);
    touchActive();
  });

  // ---- consumo oggetti ----
  $('#cons-add').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.consumabili.push(makeConsumabileRow());
    renderConsumabili(c);
    touchActive();
  });
  // testo/numeri: aggiorna solo il dato (niente re-render, per non perdere
  // il focus mentre si digita, come per l'inventario)
  $('#consum-table').addEventListener('input', e => {
    const input = e.target.closest('[data-cons]');
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), field = input.dataset.cons;
    const row = c.consumabili[idx]; if (!row) return;
    if (field === 'nome') { row.nome = input.value; touchActive(); return; }
    // le scorte e il valore non possono mai scendere sotto zero
    if (field === 'valore') { row.valore = Math.max(0, Number(input.value) || 0); }
    else if (field === 'quantita') {
      row.quantita = Math.max(0, Number(input.value) || 0);
      const useBtn = $(`#consum-table [data-cons-use="${idx}"]`);
      if (useBtn) useBtn.disabled = (['incremento', 'rimuoviStato', 'applicaBuffMalus'].includes(row.effetto) && !row.target) || row.quantita <= 0;
    } else if (field === 'durationQuarters') {
      row.durationQuarters = Math.max(1, Number(input.value) || 12);
    } else return;
    renderKoStatus(c);
    touchActive();
  });
  // testo libero del "nuovo tratto personalizzato" del bersaglio: come per
  // data-bonusitemcustom, propone subito il nome al database di tratti
  // della campagna (campaign_known_traits), in attesa di approvazione del
  // Narratore — stesso circuito già in uso per i bonus di Tecniche/Abilità.
  $('#consum-table').addEventListener('change', e => {
    const custom = e.target.closest('[data-conscustom]');
    if (custom) {
      const c = getActive(); if (!c) return;
      const idx = Number(custom.dataset.conscustom);
      const row = c.consumabili[idx]; if (!row) return;
      row.target = custom.value.trim();
      if (row.target && c.cloudCampaignId && row.targetListKey) {
        addCampaignKnownTrait(c.cloudCampaignId, row.targetListKey, row.target);
      }
      renderConsumabili(c);
      renderKoStatus(c);
      touchActive();
    }
  });
  // select (effetto/bersaglio): il cambio non interrompe la digitazione,
  // quindi qui si può ridisegnare la riga per intero
  $('#consum-table').addEventListener('change', e => {
    const sel = e.target.closest('select[data-cons]');
    if (!sel) return;
    const c = getActive(); if (!c) return;
    const idx = Number(sel.dataset.idx), field = sel.dataset.cons;
    const row = c.consumabili[idx]; if (!row) return;
    if (field === 'effetto') {
      row.effetto = sel.value;
      if (!['incremento', 'rimuoviStato', 'applicaBuffMalus'].includes(row.effetto)) { row.target = ''; row.targetListKey = ''; }
      if (row.effetto !== 'applicaBuffMalus') row.durationQuarters = 12;
    } else if (field === 'target') {
      // Codifica del valore (stessa convenzione di traitBonusItemSelectHtml):
      // "stat::chiave" = statistica primaria/secondaria (come sempre finora),
      // "trait::listKey::nome" = un Tratto già posseduto/noto nella storia,
      // "__custom__::listKey" = nuovo tratto personalizzato (rivela l'input
      // di testo qui sotto, che propone il nome al Narratore).
      if (sel.value.startsWith('__custom__::')) {
        row.targetListKey = sel.value.slice('__custom__::'.length);
        row.target = '';
      } else if (sel.value.startsWith('trait::')) {
        const [, lk, name] = sel.value.split('::');
        row.targetListKey = lk;
        row.target = name;
      } else if (sel.value.startsWith('stat::')) {
        row.targetListKey = '';
        row.target = sel.value.slice('stat::'.length);
      } else {
        row.targetListKey = '';
        row.target = '';
      }
    }
    renderConsumabili(c);
    renderKoStatus(c);
    touchActive();
  });
  $('#consum-table').addEventListener('click', e => {
    const delBtn = e.target.closest('[data-cons-del]');
    if (delBtn) {
      const c = getActive(); if (!c) return;
      c.consumabili.splice(Number(delBtn.dataset.consDel), 1);
      renderConsumabili(c);
      touchActive();
      return;
    }
  });
  // il bottone "Usa" compare anche nel riquadro K.O., per questo è delegato
  // a livello di scheda invece che alla sola tabella
  $('.sheet-body').addEventListener('click', async e => {
    const useBtn = e.target.closest('[data-cons-use]');
    if (!useBtn) return;
    const c = getActive(); if (!c) return;
    await useConsumable(c, Number(useBtn.dataset.consUse));
  });
  $('#active-buffs').addEventListener('click', e => {
    const btn = e.target.closest('[data-buff-suspend]');
    if (!btn) return;
    const c = getActive(); if (!c) return;
    c.statBuffs = c.statBuffs.filter(b => b.id !== btn.dataset.buffSuspend);
    renderActiveBuffs(c);
    renderConsumabili(c);
    updatePlayBars(c);
    renderPrimaryStats(c);
    renderDiagram(c);
    touchActive();
  });

  // ---- soglia K.O. ----
  $('#ko-roll-btn').addEventListener('click', () => {
    const roll = rollDie(100);
    const success = roll > KO_ROLL_SUCCESS;
    $('#ko-roll-result').textContent = roll;
    $('#ko-roll-result').style.color = success ? 'var(--magico-forte)' : '#FF5C5C';
    $('#ko-roll-detail').textContent = success
      ? `Superato (>${KO_ROLL_SUCCESS}%): il personaggio può agire questo turno.`
      : `Fallito: il personaggio non può agire questo turno.`;
  });

  // ---- volto del personaggio ----
  $('#portrait-frame').addEventListener('click', () => {
    // Un trascinamento vero (per inquadrare il ritratto, vedi
    // wirePortraitDrag) non deve anche aprire il lightbox subito dopo: il
    // click nativo scatta comunque a fine gesto, qui viene solo ignorato.
    if (portraitDragMoved) { portraitDragMoved = false; return; }
    const c = getActive(); if (!c) return;
    if (c.portrait) {
      $('#pl-img').src = c.portrait;
      $('#portrait-lightbox').classList.remove('hidden');
    } else {
      $('#portrait-file').click();
    }
  });
  const closeLightbox = () => $('#portrait-lightbox').classList.add('hidden');
  $('#pl-close').addEventListener('click', closeLightbox);
  $('#portrait-lightbox').addEventListener('click', e => {
    if (e.target.id === 'portrait-lightbox') closeLightbox();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeLightbox();
  });
  $('#f-nome2').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.nome = $('#f-nome2').value;
    $('#f-nome').value = c.nome;
    touchActive();
  });
  $('#portrait-load').addEventListener('click', () => $('#portrait-file').click());
  $('#portrait-file').addEventListener('change', e => {
    loadPortraitFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#portrait-remove').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    c.portrait = null;
    c.portraitPos = null;
    renderPortrait(c);
    renderHeader(c);
    touchActive();
  });

  // ---- background ----
  // delegato su document (non su [data-panel="note"]): le 4 sezioni di
  // Background vengono spostate fuori da quel tab-panel mentre il wizard di
  // creazione è aperto (vedi moveIntoWizard/wizardTeardown), un listener
  // legato all'antenato tab-panel non le raggiungerebbe più
  document.addEventListener('input', e => {
    const el = e.target.closest('[data-bg]');
    if (!el) return;
    const c = getActive(); if (!c) return;
    c.bg[el.dataset.bg] = el.value;
    if (el.dataset.bg === 'peso') renderZainoSummary(c); // entra nella Regola del Peso dello Zaino
    if (el.tagName === 'TEXTAREA') autoResizeTextarea(el);
    touchActive();
  });
  $('#n-libere').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    c.note.libere = $('#n-libere').value;
    touchActive();
  });

  // ---- Background: un contenitore alla volta (scelto dal menu #bg-nav-select), modifica, blocca ----
  let pendingBgLockSection = null;
  $('#bg-nav-select').addEventListener('change', e => {
    const key = e.target.value;
    document.querySelectorAll('[data-bgsection]').forEach(section => {
      const active = section.dataset.bgsection === key;
      section.classList.toggle('hidden', !active);
      // era display:none finché non selezionato: scrollHeight non era
      // misurabile, va ricalcolato solo ora che il contenitore si mostra
      if (active) section.querySelectorAll('textarea').forEach(autoResizeTextarea);
    });
  });
  // stesso motivo del listener 'input' qui sopra: delegato su document
  // invece che su [data-panel="note"] per restare valido anche quando le
  // sezioni Background sono spostate dentro il wizard di creazione
  document.addEventListener('click', e => {
    const editBtn = e.target.closest('[data-bgedit]');
    const lockBtn = e.target.closest('[data-bglock]');
    if (editBtn) {
      // sbloccare per modificare non richiede conferma, solo il ribloccare
      const c = getActive(); if (!c) return;
      if (!c.bgLocked) c.bgLocked = defaultBgLocked();
      c.bgLocked[editBtn.dataset.bgedit] = false;
      renderBgLockUI(c);
      renderRelazioni(c);
      touchActive();
      return;
    }
    if (lockBtn) {
      pendingBgLockSection = lockBtn.dataset.bglock;
      $('#bg-lock-confirm').classList.remove('hidden');
      return;
    }
  });
  $('#bg-lock-confirm-yes').addEventListener('click', () => {
    const c = getActive();
    $('#bg-lock-confirm').classList.add('hidden');
    if (!c || !pendingBgLockSection) { pendingBgLockSection = null; return; }
    if (!c.bgLocked) c.bgLocked = defaultBgLocked();
    c.bgLocked[pendingBgLockSection] = true;
    pendingBgLockSection = null;
    renderBgLockUI(c);
    renderRelazioni(c);
    touchActive();
  });
  $('#bg-lock-confirm-no').addEventListener('click', () => {
    $('#bg-lock-confirm').classList.add('hidden');
    pendingBgLockSection = null;
  });
  $('#exit-app-confirm-yes').addEventListener('click', () => {
    $('#exit-app-confirm').classList.add('hidden');
    const app = nativeAppPlugin();
    if (app && app.exitApp) app.exitApp();
  });
  $('#exit-app-confirm-no').addEventListener('click', () => {
    $('#exit-app-confirm').classList.add('hidden');
  });
  // ---- barre in gioco: danno HP, costo incantesimo MP e attivazione Boost, sommati in Uso ----
  $('#hp-dmg-apply').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const dmg = Math.max(0, Math.floor(Number($('#hp-dmg-input').value)) || 0);
    if (!dmg) return;
    applyDamageDrainingBuffer(c, dmg);
    $('#hp-dmg-input').value = '';
    updatePlayBars(c);
    touchActive();
  });
  $('#hit-resolve-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const target = resolveHitTarget(c, $('#hit-target-select').value);
    if (!target || !target.statsConfirmed) return;
    const dmgInput = Math.max(0, Math.floor(Number($('#hit-dmg-input').value)) || 0);
    const prevDurCur = Number(target.durCur) || 0;
    const prevHpCur = c.hpCur;
    // "Resistenza" unifica il vecchio "Robustezza" (main, commit "Unifica
    // Robustezza nel tratto Resistenza") — la formula di Durabilità (Ipotesi 2,
    // già concordata su questo branch) resta quella nuova, solo il nome del
    // tratto letto cambia.
    const trattoResistenza = getTraitValue(c, 'capacitaCombattive', 'Resistenza');
    // Pannello manuale "Subisci un colpo": senza un pezzo attaccante fisico
    // selezionabile in UI, il danno è trattato come un colpo generico (mani
    // nude/ambientale) -> attaccante=null usa R_GENERICO nel rapporto di scontro.
    const { perdita, ramo, dettagli } = durabilityCalcolaPerdita({
      bersaglio: target, attaccante: null, dannoReale: dmgInput, trattoResistenza
    });
    target.durCur = Math.max(0, prevDurCur - perdita);
    const lines = [];
    if (ramo === 'critico') {
      lines.push('Fallimento critico: 1 naturale sul d20 di Resistenza (nessun bonus di tratto/equip)');
      lines.push(`Danno 1: d100 ${dettagli.pct1}% -> -${dettagli.loss1} Durabilità`);
      lines.push(`Danno 2: d100 ${dettagli.pct2}% -> -${dettagli.loss2} Durabilità`);
    } else {
      lines.push(`Tiro attacco ${dettagli.tiroAtk} vs Resistenza ${dettagli.tiroRes} (tratto ${trattoResistenza}) · rapporto di scontro ${dettagli.rapporto.toFixed(2)} (R bersaglio ${dettagli.rBersaglio} vs R attaccante ${dettagli.rAttaccante})`);
    }
    const brokeNow = prevDurCur > 0 && target.durCur <= 0;
    // Il raddoppio del danno HP alla rottura vale solo per l'armatura (assorbimento
    // che viene meno sulla locazione): un'arma o uno scudo rotto non raddoppia l'HP subito.
    const finalDamage = (brokeNow && target.kind === 'armatura') ? dmgInput * 2 : dmgInput;
    applyDamageDrainingBuffer(c, finalDamage);
    lines.push(`Durabilità ${target.name}: ${prevDurCur} -> ${target.durCur} (-${perdita})${brokeNow ? ' · 🔨 SI ROMPE ORA' : ''}`);
    lines.push(`Danno HP: ${dmgInput}${brokeNow && target.kind === 'armatura' ? ` ×2 (armatura rotta) = ${finalDamage}` : ''} · HP ${prevHpCur} -> ${c.hpCur}`);
    $('#hit-result-detail').textContent = lines.join('\n');
    $('#hit-dmg-input').value = '';
    renderSlots(c);
    updatePlayBars(c);
    touchActive();
  });
  $('#dmg-tecab-resolve-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const sep = $('#dmg-tecab-select').value.indexOf('::');
    if (sep === -1) return;
    const field = $('#dmg-tecab-select').value.slice(0, sep);
    const idx = Number($('#dmg-tecab-select').value.slice(sep + 2));
    const row = c[field] && c[field][idx];
    if (!row) return;
    const isEsplosivo = row.dannoTipo === 'esplosivo';
    const stat = dannoStatFor(row.dannoTipo, row.dannoStat);
    const statLabel = isEsplosivo ? null : ((PRIMARY_STATS.find(s => s.key === stat) || {}).full || stat);
    // Stessa identica formula di combatRollAttackAndDamage (vedi commento
    // lì): mancavano i due moltiplicatori percentuali delle droghe a due
    // fasi (sulla statistica di danno e sul totale finale) — con una
    // droga attiva questo pannello mostrava un numero sottostimato rispetto
    // al danno realmente applicato in combattimento, fino al 40%+ di scarto.
    const withBonus = isEsplosivo ? 0
      : Math.round((Number(c.primary[stat]) || 0) * statModMultiplier(c.cloudCharacterId, stat)) + buffTotal(c, stat);
    const base = Number(row.dannoBase) || 0;
    const diceLabel = diceForValue(isEsplosivo ? base : withBonus);
    let rollTotal, rollText;
    if (diceLabel === 'd12+d8') {
      const a = rollDie(12), b = rollDie(8);
      rollTotal = a + b;
      rollText = `d12+d8 (${a}+${b})`;
    } else {
      const sides = Number(diceLabel.slice(1));
      const r2 = rollDie(sides);
      rollTotal = r2;
      rollText = `${diceLabel} (${r2})`;
    }
    const dannoPctKey = row.dannoTipo === 'magico' ? 'dannoMagico' : 'dannoFisico';
    const dannoPctMult = isEsplosivo ? 1 : statModMultiplier(c.cloudCharacterId, dannoPctKey);
    const total = Math.round((base + rollTotal + withBonus) * dannoPctMult);
    $('#dmg-tecab-result-detail').textContent = (isEsplosivo
      ? `${row.nome}: ${base} (base) + ${rollText} (esplosivo, nessuna statistica)`
      : `${row.nome}: ${base} (base) + ${rollText} + ${withBonus} (${statLabel} con bonus)`)
      + (dannoPctMult !== 1 ? ` ×${dannoPctMult.toFixed(2)} (droga)` : '') + ` = ${total}`;
    touchActive();
  });
  $('#mp-cost-apply').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const val = $('#mp-cost-select').value;
    const sep = val.indexOf('::');
    if (sep === -1) return;
    const field = val.slice(0, sep);
    const idx = Number(val.slice(sep + 2));
    const row = c[field] && c[field][idx];
    if (!row) return;
    if (isSessionLocked(c)) { toast('Disponibile solo durante la sessione di gioco: attendi che il Narratore la avvii'); return; }
    if (combatViewEncounterId) { toast('Non disponibile durante un combattimento attivo: usa il pannello Tecniche/Abilità in combattimento'); return; }
    // Sovracura: sistema a parte, mai un buff "mentre Attiva resta acceso"
    // (vedi tecAbBuffTotal) — gate esplicito "solo a HP pieni", poi un tiro
    // una tantum sommato a c.hpBuffer, invece di impostare row.attiva.
    if (row.bonusMode === 'sovracura') {
      if (c.hpCur < effectiveHpMax(c)) { toast('Sovracura si attiva solo a HP pieni'); return; }
      const primaryBonus = (row.bonusItems || []).find(it => it.listKey === 'primaria' && it.name === 'hp');
      const base = primaryBonus ? Math.abs(Number(primaryBonus.valore) || 0) : 0;
      const m2 = String(row.costo || '').match(/\d+(?:\.\d+)?/);
      const cost2 = m2 ? Number(m2[0]) : 0;
      if (cost2) c.mpCur = clamp(c.mpCur - cost2, 0, effectiveMpMax(c));
      const rolled = rollScaledAmountLocal(c, base, row.scalaStat);
      c.hpBuffer = (Number(c.hpBuffer) || 0) + rolled;
      updatePlayBars(c);
      logTecnicaAbilitaUsageFor(c, field, idx);
      toast(`🔷 Sovracura: +${rolled} cuscinetto HP${cost2 ? ` (-${cost2} MP)` : ''}`);
      return;
    }
    // Cura/Cura max: come Sovracura, un'azione una tantum (mai row.attiva —
    // quello alzerebbe il tetto massimo via tecAbBuffTotal/effectiveHpMax,
    // non è una cura) — applica súbito agli HP CORRENTI, con o senza tiro
    // scalato in base al tipo.
    if (row.tipo === 'cura' || row.tipo === 'curamax') {
      const primaryBonus = (row.bonusItems || []).find(it => it.listKey === 'primaria' && it.name === 'hp');
      const base = primaryBonus ? Math.abs(Number(primaryBonus.valore) || 0) : 0;
      const healed = row.tipo === 'curamax' ? rollScaledAmountLocal(c, base, row.scalaStat) : base;
      const m3 = String(row.costo || '').match(/\d+(?:\.\d+)?/);
      const cost3 = m3 ? Number(m3[0]) : 0;
      if (cost3) c.mpCur = clamp(c.mpCur - cost3, 0, effectiveMpMax(c));
      c.hpCur = clamp(c.hpCur + healed, 0, effectiveHpMax(c));
      updatePlayBars(c);
      logTecnicaAbilitaUsageFor(c, field, idx);
      toast(`💚 ${row.nome}: +${healed} HP${cost3 ? ` (-${cost3} MP)` : ''}`);
      return;
    }
    const m = String(row.costo || '').match(/\d+(?:\.\d+)?/);
    const cost = m ? Number(m[0]) : 0;
    toast(`${row.nome}: attivala dal pannello Combattimento per applicare tempo d'azione e durata`);
  });
  $('#boost-activate-btn').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    const [rowId, lv] = String($('#boost-activate-select').value || '').split('::');
    if (!rowId || !lv) { toast('Scegli un Boost da attivare'); return; }
    activateBoostRow(c, rowId, Number(lv));
  });
  // ---- "Attacco": chiama il Narratore a strutturare un combattimento ----
  $('#btn-request-combat').addEventListener('click', async () => {
    const c = getActive(); if (!c) return;
    if (isEntryLocked(c)) { toast('Il Narratore non ha ancora accettato la richiesta di ingresso'); return; }
    if (isSessionLocked(c)) { toast('Disponibile solo durante la sessione di gioco'); return; }
    if (!c.cloudCampaignId || !c.cloudCharacterId) { toast('Disponibile solo per un personaggio in una storia condivisa'); return; }
    const btn = $('#btn-request-combat');
    const note = ($('#combat-attack-note').value || '').trim();
    btn.disabled = true;
    try {
      await requestCombatStart(c.cloudCampaignId, c.cloudCharacterId, note);
      $('#combat-attack-note').value = '';
      $('#combat-attack-pending-note').classList.remove('hidden');
      toast('Richiesta inviata al Narratore');
    } catch (err) { toast(describeError(err)); btn.disabled = false; }
  });
  // ---- riposo/meditazione: recupera HP/MP spendendo i P.R. ----
  $('#btn-riposo-toggle').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (isSessionLocked(c)) { toast('Riposo disponibile solo durante la sessione di gioco'); return; }
    const panel = $('#riposo-panel');
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) renderRiposoPanel(c);
  });
  $('#riposo-moltiplicatore').addEventListener('input', () => {
    const c = getActive(); if (!c) return;
    let v = Math.round((Number($('#riposo-moltiplicatore').value) || 0) * 4) / 4;
    v = clamp(v, 0, 24);
    $('#riposo-moltiplicatore').value = v;
    renderRiposoPanel(c);
  });
  $('#riposo-hp').addEventListener('input', () => { const c = getActive(); if (c) syncRiposoInputs(c, 'hp'); });
  $('#riposo-mp').addEventListener('input', () => { const c = getActive(); if (c) syncRiposoInputs(c, 'mp'); });
  $('#riposo-pp').addEventListener('input', () => { const c = getActive(); if (c) syncRiposoInputs(c, 'pp'); });
  $('#btn-riposo-applica').addEventListener('click', () => {
    const c = getActive(); if (!c) return;
    if (isSessionLocked(c)) { toast('Riposo disponibile solo durante la sessione di gioco'); return; }
    const hp = Math.max(0, Math.floor(Number($('#riposo-hp').value)) || 0);
    const mp = Math.max(0, Math.floor(Number($('#riposo-mp').value)) || 0);
    const pp = Math.max(0, Math.floor(Number($('#riposo-pp').value)) || 0);
    if (!hp && !mp && !pp) { toast('Imposta quanto recuperare su HP, MP o PP'); return; }
    c.hpCur = clamp(c.hpCur + hp, 0, effectiveHpMax(c));
    c.mpCur = clamp(c.mpCur + mp, 0, effectiveMpMax(c));
    c.ppCur = clamp((Number(c.ppCur) || 0) + pp, 0, effectivePpMax(c));
    // Sovracura: il cuscinetto persistente si azzera al riposo (vedi
    // makeAbilitaRow/effettoCellHtml, "fino al prossimo riposo").
    c.hpBuffer = 0;
    updatePlayBars(c);
    toast(`Riposo applicato: +${hp} HP, +${mp} MP, +${pp} PP`);
    $('#riposo-hp').value = 0;
    $('#riposo-mp').value = 0;
    $('#riposo-pp').value = 0;
    renderRiposoPanel(c);
    touchActive();
  });
  ['#hp-max', '#mp-max', '#hud-pr-max'].forEach(sel => {
    $(sel).addEventListener('change', () => {
      const c = getActive(); if (!c) return;
      // il campo mostra il massimo effettivo (base + incrementi attivi): la
      // modifica manuale aggiorna solo il massimo base, senza inglobare
      // per sempre un incremento temporaneo
      if (sel === '#hp-max') c.hpMaxTracked = Math.max(0, (Number($(sel).value) || 0) - buffTotal(c, 'hp'));
      if (sel === '#mp-max') c.mpMaxTracked = Math.max(0, (Number($(sel).value) || 0) - buffTotal(c, 'mp'));
      if (sel === '#hud-pr-max') c.prMaxTracked = Math.max(0, (Number($(sel).value) || 0) - buffTotal(c, 'pr'));
      updatePlayBars(c);
      touchActive();
    });
  });

}

/* "i::bi" -> [indice slot, indice riga bonus dentro quello slot] */
function parseBonusCtx(v) {
  const sep = v.indexOf('::');
  return [Number(v.slice(0, sep)), Number(v.slice(sep + 2))];
}

/* Wiring dei bonus/malus "da tratto" di Tecniche/Abilità/Boost (vedi
   traitBonusCellHtml/migrateTextBonusToItems): stesso pattern di
   wireEquipGrid, ma qui il valore non alimenta nessun calcolo (resta solo
   descrittivo), quindi non serve mai un refresh delle statistiche. */
const TECAB_FIELD_FOR_DATA_ATTR = { tecnica: 'tecniche', abilita: 'abilita', boostrow: 'boostRows' };
function traitBonusRenderFor(dataAttr) {
  if (dataAttr === 'tecnica') return renderTecniche;
  if (dataAttr === 'abilita') return renderAbilita;
  return renderBoostRows;
}
function traitBonusItemsArray(c, dataAttr, itemsField, i) {
  const rows = c[TECAB_FIELD_FOR_DATA_ATTR[dataAttr]];
  const row = rows && rows[i];
  if (!row) return null;
  if (!Array.isArray(row[itemsField])) row[itemsField] = [];
  return row[itemsField];
}
/* Vero se la riga (Tecnica/Abilità confermate su Tipo, Boost confermato) è
   bloccata: controllo difensivo per i wiring sotto, dato che gli input sono
   già "disabled" a render — mai fidarsi solo del markup per l'evento. */
function traitBonusRowLocked(c, dataAttr, i) {
  const rows = c[TECAB_FIELD_FOR_DATA_ATTR[dataAttr]];
  const row = rows && rows[i];
  if (!row) return false;
  if (dataAttr !== 'boostrow' && narratorTecabRowIsEditing(dataAttr, i)) return false;
  if (narratorEditMode && dataAttr === 'boostrow') return false;
  return dataAttr === 'boostrow' ? !!row.boostConfirmed : !!row.tipoConfirmed;
}
/* Vero se una voce in bonusItems di questa riga va trattata (segno, editing)
   come un vero malus: il campo si chiama sempre 'malusItems' per le Tecniche,
   ma una riga Tipo "Debuff" applica il suo (unico) elenco "bonus" sempre
   come malus al bersaglio — vedi combatEffectRowsFor/effettoCellHtml. */
function isBonusItemsNegative(c, dataAttr, itemsField, i) {
  if (itemsField === 'malusItems') return true;
  const rows = c[TECAB_FIELD_FOR_DATA_ATTR[dataAttr]];
  const row = rows && rows[i];
  return !!row && row.tipo === 'debuff';
}
/* Interruttore "Attiva" e configurazione "Danno" (tipo/statistica/base) di
   Tecniche/Abilità: non riguardano bonusItems/malusItems, quindi hanno un
   wiring a parte da wireTraitBonusTable. */
function wireTecAbExtra(sel, field) {
  $(sel).addEventListener('change', e => {
    const c = getActive(); if (!c) return;
    const attiva = e.target.closest('[data-tecattiva]');
    if (attiva) {
      const i = Number(attiva.dataset.tecattiva.split('::')[1]);
      const row = c[field][i];
      // il checkbox è comunque disabled quando la riga è confermata: stesso
      // controllo difensivo del select Tipo qui sotto.
      if (tecAbFieldRowLocked(field, row, i)) return;
      // Accendere "Attiva" è un vero utilizzo (consuma il contatore, come il
      // vecchio bottone "+1" che su Supporto non esiste più): stesso gating
      // di sessione, più un blocco se è aperto un incontro di combattimento
      // su questo dispositivo — lì il buff si applica dal picker di
      // combattimento (applyCombatEffect), non da qui. Lo spegnimento resta
      // sempre libero, per non intrappolare un buff acceso se un
      // combattimento parte mentre è già attivo.
      const turningOn = attiva.checked && !row.attiva;
      if (turningOn) {
        if (isSessionLocked(c)) { toast('Disponibile solo durante la sessione di gioco: attendi che il Narratore la avvii'); attiva.checked = false; return; }
        if (combatViewEncounterId) { toast('Non disponibile durante un combattimento attivo: usa il pannello Tecniche/Abilità in combattimento'); attiva.checked = false; return; }
        // Sovracura fuori combattimento: stesso gate/tiro del percorso in
        // combattimento (activateSovracuraTarget), ma puramente locale — un
        // cuscinetto HP persistente non è un "buff mentre Attiva resta
        // acceso" come gli altri Supporto, è un'azione una tantum che
        // somma a c.hpBuffer, vedi applyDamageDrainingBuffer/riposo.
        if (row.bonusMode === 'sovracura') {
          if (c.hpCur < effectiveHpMax(c)) { toast('Sovracura si attiva solo a HP pieni'); attiva.checked = false; return; }
          const rolled = rollScaledAmountLocal(c, row.bonusItems.find(it => it.listKey === 'primaria' && it.name === 'hp')
            ? Math.abs(Number(row.bonusItems.find(it => it.listKey === 'primaria' && it.name === 'hp').valore) || 0) : 0, row.scalaStat || 'fmen');
          c.hpBuffer = (Number(c.hpBuffer) || 0) + rolled;
          toast(`🔷 Sovracura: +${rolled} cuscinetto HP`);
        }
      }
      row.attiva = attiva.checked;
      refreshAfterEquipBonusChange(c);
      if (turningOn) logTecnicaAbilitaUsageFor(c, field, i); else touchActive();
      return;
    }
    const bonusmode = e.target.closest('[data-bonusmode]');
    if (bonusmode) {
      const i = Number(bonusmode.dataset.bonusmode.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.bonusMode = bonusmode.value;
      (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
      touchActive();
      return;
    }
    const scalastat = e.target.closest('[data-scalastat]');
    if (scalastat) {
      const i = Number(scalastat.dataset.scalastat.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.scalaStat = scalastat.value;
      touchActive();
      return;
    }
    const contrattacco = e.target.closest('[data-contrattacco]');
    if (contrattacco) {
      const i = Number(contrattacco.dataset.contrattacco.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.contrattacco = contrattacco.checked;
      touchActive();
      return;
    }
    const multitarget = e.target.closest('[data-multitarget]');
    if (multitarget) {
      const i = Number(multitarget.dataset.multitarget.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.multiTarget = multitarget.checked;
      touchActive();
      return;
    }
    const doppiotirostat = e.target.closest('[data-doppiotirostat]');
    if (doppiotirostat) {
      const i = Number(doppiotirostat.dataset.doppiotirostat.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.doppioTiroStat = doppiotirostat.value;
      touchActive();
      return;
    }
    const tectipo = e.target.closest('[data-tectipo]');
    if (tectipo) {
      const i = Number(tectipo.dataset.tectipo.split('::')[1]);
      const row = c[field][i];
      // il <select> è comunque disabled da tipoConfirmed: controllo difensivo,
      // il tipo confermato si sblocca solo con un level-up (vedi creditLevelAP)
      if (tecAbFieldRowLocked(field, row, i)) return;
      // "Danno fisso": solo Abilità, mai le Tecniche (vedi tipoCellHtml) —
      // se il valore arriva comunque da una Tecnica (markup non dovrebbe
      // mai offrirlo lì) ricade su Supporto invece di accettarlo alla cieca.
      const isAbilitaOnlyTipo = ['dannofisso', 'cura', 'curamax', 'extra'].includes(tectipo.value) && field === 'abilita';
      row.tipo = (tectipo.value === 'danno' || tectipo.value === 'misto' || tectipo.value === 'debuff' || isAbilitaOnlyTipo) ? tectipo.value : 'supporto';
      (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
      touchActive();
      return;
    }
    const tipo = e.target.closest('[data-dannotipo]');
    if (tipo) {
      const i = Number(tipo.dataset.dannotipo.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      // Il Danno Magico è una prerogativa delle Abilità, non delle Tecniche
      // (il <select> non offre nemmeno l'opzione lì, controllo difensivo).
      const allowMagico = field === 'abilita' && tipo.value === 'magico';
      row.dannoTipo = (allowMagico || tipo.value === 'esplosivo') ? tipo.value : 'fisico';
      if (row.dannoTipo === 'fisico' && !DANNO_STAT_KEYS.includes(row.dannoStat)) row.dannoStat = 'for';
      (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
      touchActive();
      return;
    }
    const stat = e.target.closest('[data-dannostat]');
    if (stat) {
      const i = Number(stat.dataset.dannostat.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.dannoStat = DANNO_STAT_KEYS.includes(stat.value) ? stat.value : 'for';
      touchActive();
      return;
    }
    const effettopreset = e.target.closest('[data-effettopreset]');
    if (effettopreset) {
      const i = Number(effettopreset.dataset.effettopreset.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      if (effettopreset.value === '__custom__') {
        const customInput = effettopreset.parentElement.querySelector('[data-effettonome]');
        if (customInput) { customInput.classList.remove('hidden'); customInput.focus(); }
        return;
      }
      row.effettoNome = effettopreset.value;
      if (!row.effettoNome) row.effettoTratto = '';
      (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
      touchActive();
      return;
    }
    const effettonome = e.target.closest('[data-effettonome]');
    if (effettonome) {
      const i = Number(effettonome.dataset.effettonome.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.effettoNome = effettonome.value.trim();
      // senza nome effetto non ha senso tenere agganciato un tratto
      if (!row.effettoNome) row.effettoTratto = '';
      (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
      touchActive();
      return;
    }
    const effettotrattosel = e.target.closest('[data-effettotrattosel]');
    if (effettotrattosel) {
      const i = Number(effettotrattosel.dataset.effettotrattosel.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      if (effettotrattosel.value === '__custom__') {
        // Non tocca ancora il dato (nessun nome scelto): un re-render qui lo
        // farebbe subito sparire (campo vuoto = "non personalizzato"), quindi
        // si mostra solo il campo di testo per digitarlo — resta scritto
        // solo quando l'input custom viene compilato.
        const customInput = effettotrattosel.parentElement.querySelector('[data-effettotrattocustom]');
        if (customInput) { customInput.classList.remove('hidden'); customInput.focus(); }
        return;
      }
      row.effettoTratto = effettotrattosel.value;
      (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
      touchActive();
      return;
    }
    const effettotrattocustom = e.target.closest('[data-effettotrattocustom]');
    if (effettotrattocustom) {
      const i = Number(effettotrattocustom.dataset.effettotrattocustom.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.effettoTratto = effettotrattocustom.value.trim();
      touchActive();
    }
  });
  $(sel).addEventListener('input', e => {
    const base = e.target.closest('[data-dannobase]');
    if (base) {
      const c = getActive(); if (!c) return;
      const i = Number(base.dataset.dannobase.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.dannoBase = Math.max(0, Math.floor(Number(base.value)) || 0);
      touchActive();
      renderDmgTecAbSelect(c);
      return;
    }
    // Danno secondario Magico (danno misto): prerogativa esclusiva delle
    // Abilità, stesso trattamento di effettoBonusPct/raggioHex qui sotto.
    const base2 = e.target.closest('[data-dannobase2]');
    if (base2 && field === 'abilita') {
      const c = getActive(); if (!c) return;
      const i = Number(base2.dataset.dannobase2.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.dannoBase2 = Math.max(0, Math.floor(Number(base2.value)) || 0);
      touchActive();
      return;
    }
    // Bonus % al tiro di stato: prerogativa esclusiva delle Abilità (le
    // Tecniche "ereditano" invece l'effetto/bonus dell'arma equipaggiata,
    // vedi combatTecAbSourcesFor) — il markup non lo espone mai su una
    // Tecnica, ma il guard resta comunque qui, wireTecAbExtra è generica.
    const bonusPct = e.target.closest('[data-effettobonuspct]');
    if (bonusPct && field === 'abilita') {
      const c = getActive(); if (!c) return;
      const i = Number(bonusPct.dataset.effettobonuspct.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.effettoBonusPct = Math.floor(Number(bonusPct.value)) || 0;
      touchActive();
      return;
    }
    // Raggio d'area: stesso trattamento esclusivo Abilità-only di effettoBonusPct
    // qui sopra (vedi anche ensureDannoAttivaFields/dannoConfigHtml).
    const raggio = e.target.closest('[data-raggiohex]');
    if (raggio && field === 'abilita') {
      const c = getActive(); if (!c) return;
      const i = Number(raggio.dataset.raggiohex.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      row.raggioHex = Math.max(0, Math.min(6, Math.floor(Number(raggio.value)) || 0));
      touchActive();
      return;
    }
    // Valore fisso di cura (Cura/Cura max/Extra, vedi effettoCellHtml):
    // scrive direttamente la voce bonusItems su HP, creandola se assente —
    // evita di dover passare dalla colonna Bonus generica per il caso comune.
    const hpcure = e.target.closest('[data-hpcurevalue]');
    if (hpcure && field === 'abilita') {
      const c = getActive(); if (!c) return;
      const i = Number(hpcure.dataset.hpcurevalue.split('::')[1]);
      const row = c[field][i];
      if (tecAbFieldRowLocked(field, row, i)) return;
      const val = Math.max(0, Math.floor(Number(hpcure.value)) || 0);
      if (!row.bonusItems) row.bonusItems = [];
      let item = row.bonusItems.find(it => it.listKey === 'primaria' && it.name === 'hp');
      if (!item) { item = { listKey: 'primaria', name: 'hp', valore: 0 }; row.bonusItems.push(item); }
      item.valore = val;
      touchActive();
    }
  });
  $(sel).addEventListener('click', async e => {
    const editBtn = e.target.closest('[data-tecabedit]');
    if (editBtn) {
      const c = getActive(); if (!c || !narratorEditMode || narratorEditState === 'saving') return;
      const [dataAttr, rawIndex] = editBtn.dataset.tecabedit.split('::');
      const index = Number(rawIndex);
      narratorEditSnapshot = cloneNarratorDraft(c);
      narratorEditDirty = false;
      narratorTecabEdit = { dataAttr, field, index };
      narratorEditState = 'editing';
      (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
      applyNarratorEditUiState();
      return;
    }
    const cancelBtn = e.target.closest('[data-tecabcancel]');
    if (cancelBtn) {
      cancelNarratorEdit();
      return;
    }
    const confirmBtn = e.target.closest('[data-tipoconfirm]');
    if (!confirmBtn) return;
    const c = getActive(); if (!c) return;
    const i = Number(confirmBtn.dataset.tipoconfirm.split('::')[1]);
    const row = c[field][i];
    const narratorEditingRow = narratorTecabRowIsEditing(field === 'tecniche' ? 'tecnica' : 'abilita', i);
    if (!row || (row.tipoConfirmed && !narratorEditingRow)) return;
    // Conferma bloccata finché la riga "Supporto" non ha almeno un bonus e
    // (per le Tecniche, che hanno anche il malus) almeno un malus compilati:
    // altrimenti si bloccherebbe una riga ancora vuota, senza modo di
    // completarla prima del prossimo level-up.
    if (!tecAbRowIsComplete(row, field)) {
      toast(field === 'tecniche' ? 'Compila almeno un bonus e un malus prima di confermare' : 'Compila almeno un bonus prima di confermare');
      return;
    }
    row.tipoConfirmed = true;
    // Un "Attiva" lasciato acceso mentre si compilava/correggeva la riga
    // (es. durante un level-up, quando il Tipo è temporaneamente sbloccato)
    // non deve restare attivo per sempre in automatico solo perché si è
    // premuto Conferma: il bonus/malus collegato va riacceso di proposito,
    // non ritrovato già acceso senza che nessuno l'abbia notato.
    if (row.attiva) { row.attiva = false; refreshAfterEquipBonusChange(c); }
    (field === 'tecniche' ? renderTecniche : renderAbilita)(c);
    touchActive();
    if (narratorEditingRow) await confirmNarratorEdit();
  });
}
function wireTraitBonusTable(sel) {
  $(sel).addEventListener('click', e => {
    const c = getActive(); if (!c) return;
    const del = e.target.closest('[data-delbonusitem]');
    if (del) {
      const [dataAttr, itemsField, i, ii] = del.dataset.delbonusitem.split('::');
      if (traitBonusRowLocked(c, dataAttr, Number(i))) return;
      const items = traitBonusItemsArray(c, dataAttr, itemsField, Number(i));
      if (items) items.splice(Number(ii), 1);
      traitBonusRenderFor(dataAttr)(c); refreshAfterEquipBonusChange(c); touchActive();
      return;
    }
    const add = e.target.closest('[data-addbonusitem]');
    if (add) {
      const [dataAttr, itemsField, i] = add.dataset.addbonusitem.split('::');
      if (traitBonusRowLocked(c, dataAttr, Number(i))) return;
      const items = traitBonusItemsArray(c, dataAttr, itemsField, Number(i));
      // il malus (o il "bonus" di una riga Debuff, sempre negativo) parte già
      // negativo — mai una magnitudine positiva sottratta implicitamente,
      // vedi traitBonusItemsHtml/tecAbBuffTotal.
      if (items) items.push({ listKey: 'capacitaCombattive', name: '', valore: isBonusItemsNegative(c, dataAttr, itemsField, Number(i)) ? -1 : 1 });
      traitBonusRenderFor(dataAttr)(c); touchActive();
    }
  });
  $(sel).addEventListener('change', e => {
    const c = getActive(); if (!c) return;
    const nameSel = e.target.closest('[data-bonusitemsel]');
    if (nameSel) {
      const [dataAttr, itemsField, i, ii] = nameSel.dataset.bonusitemsel.split('::');
      if (traitBonusRowLocked(c, dataAttr, Number(i))) return;
      const items = traitBonusItemsArray(c, dataAttr, itemsField, Number(i));
      const item = items && items[Number(ii)];
      if (item) {
        if (nameSel.value.startsWith('__custom__::')) {
          item.listKey = nameSel.value.slice('__custom__::'.length);
        } else if (nameSel.value) {
          const [lk, name] = nameSel.value.split('::');
          item.listKey = lk; item.name = name;
        } else {
          item.name = '';
        }
        traitBonusRenderFor(dataAttr)(c); refreshAfterEquipBonusChange(c); touchActive();
      }
      return;
    }
    const custom = e.target.closest('[data-bonusitemcustom]');
    if (custom) {
      const [dataAttr, itemsField, i, ii] = custom.dataset.bonusitemcustom.split('::');
      if (traitBonusRowLocked(c, dataAttr, Number(i))) return;
      const items = traitBonusItemsArray(c, dataAttr, itemsField, Number(i));
      const item = items && items[Number(ii)];
      if (item) {
        item.name = custom.value.trim();
        if (item.name && c.cloudCampaignId && typeof addCampaignKnownTrait === 'function') {
          addCampaignKnownTrait(c.cloudCampaignId, item.listKey, item.name);
        }
        traitBonusRenderFor(dataAttr)(c); touchActive();
      }
    }
  });
  $(sel).addEventListener('input', e => {
    const val = e.target.closest('[data-bonusitemvalore]');
    if (!val) return;
    const c = getActive(); if (!c) return;
    const [dataAttr, itemsField, i, ii] = val.dataset.bonusitemvalore.split('::');
    if (traitBonusRowLocked(c, dataAttr, Number(i))) return;
    const items = traitBonusItemsArray(c, dataAttr, itemsField, Number(i));
    const item = items && items[Number(ii)];
    if (item) {
      const isMalus = isBonusItemsNegative(c, dataAttr, itemsField, Number(i));
      const n = Math.floor(Number(val.value)) || (isMalus ? -1 : 1);
      item.valore = isMalus ? Math.min(-1, n) : Math.max(1, n);
      refreshAfterEquipBonusChange(c); touchActive();
    }
  });
}
/* Se un bonus da equipaggiamento punta a un tratto non ancora in scheda, lo
   aggiunge con base 0 (ufficiale -> shownTraits, altrimenti nuovo
   customTraits): senza, il bonus non avrebbe nessuna riga su cui sommarsi. */
function ensureTraitExists(c, listKey, name) {
  if (!name || !listKey || !TRAIT_LISTS[listKey]) return;
  if (TRAIT_LISTS[listKey].includes(name)) {
    if (!(c.shownTraits[listKey] || []).includes(name)) c.shownTraits[listKey].push(name);
  } else if (!(c.customTraits[listKey] || []).some(t => t.name === name)) {
    c.customTraits[listKey].push({ name, value: 0 });
  }
}
/* Righe di bonus "rigenerazione" (kind==='rigenerazione') sui pezzi
   equipaggiati (armatura + scudo/arma): a differenza dei bonus statici
   (primary/trait) queste non alzano un valore in modo permanente, ma
   recuperano una quantità fissa di HP/MP/PP a intervalli regolari mentre
   si gioca — vedi tickEquipRegen. */
function equipRegenBonuses(c) {
  const slots = [...(c.slots || []), ...(c.weaponSlots || [])];
  const rows = [];
  slots.forEach(s => {
    if (!isEquipmentUsable(s)) return;
    (s.bonuses || []).forEach(b => { if (b.kind === 'rigenerazione') rows.push(b); });
  });
  return rows;
}
/* Rigenerazione dell'equip: quantità e intervallo (minuti) fissi, impostati
   sul pezzo — non spende P.R. e non passa dalla scelta libera di Riposo.
   Il conto alla rovescia (b.regenRemainingSec) avanza di un secondo per
   ogni chiamata di questa funzione, richiamata da un timer che gira SOLO
   mentre la scheda di questo personaggio è la vista in primo piano (vedi
   startEquipRegenTimer/stopEquipRegenTimer più sotto): chiudendo l'app o
   tornando all'elenco il tempo si ferma lì dov'era, senza recuperare
   "in differita" alla riapertura — come richiesto esplicitamente, a
   differenza di un vero cron lato server che qui non esiste. Fuori da una
   campagna, o con la sessione avviata dal Narratore, funziona sempre come
   Riposo/Tecniche/Abilità (vedi isSessionLocked); dentro una campagna senza
   sessione avviata resta fermo. */
function tickEquipRegen(c) {
  if (!c || isSessionLocked(c)) return;
  const rows = equipRegenBonuses(c);
  if (!rows.length) return;
  let ticked = false;
  rows.forEach(b => {
    const intervalSec = Math.max(60, Math.round((Number(b.intervalMin) || 10) * 60));
    if (typeof b.regenRemainingSec !== 'number' || b.regenRemainingSec > intervalSec) b.regenRemainingSec = intervalSec;
    b.regenRemainingSec -= 1;
    if (b.regenRemainingSec <= 0) {
      const amount = Number(b.valore) || 0;
      const key = b.key || 'hp';
      if (key === 'hp') c.hpCur = clamp(c.hpCur + amount, 0, effectiveHpMax(c));
      else if (key === 'mp') c.mpCur = clamp(c.mpCur + amount, 0, effectiveMpMax(c));
      else if (key === 'pp') c.ppCur = clamp((Number(c.ppCur) || 0) + amount, 0, effectivePpMax(c));
      b.regenRemainingSec = intervalSec;
      ticked = true;
    }
  });
  if (ticked) {
    updatePlayBars(c);
    touchActive();
  }
}
let equipRegenTimer = null;
function stopEquipRegenTimer() {
  clearInterval(equipRegenTimer);
  equipRegenTimer = null;
}
function startEquipRegenTimer() {
  stopEquipRegenTimer();
  equipRegenTimer = setInterval(() => { const c = getActive(); if (c) tickEquipRegen(c); }, 1000);
}
/* Un bonus da equipaggiamento tocca statistiche primarie/secondarie e
   tratti: dopo ogni modifica vanno rinfrescate tutte le viste che ne
   mostrano il valore effettivo. */
function refreshAfterEquipBonusChange(c) {
  renderPrimaryStats(c);
  renderTertiaryStats(c);
  renderTraits(c);
  renderDiagram(c);
  updatePlayBars(c);
  renderBlockSection(c);
  renderAttackWeaponList(c);
}
function wireEquipGrid(sel, getSlots, doRender) {
  $(sel).addEventListener('input', e => {
    const c = getActive(); if (!c) return;
    const slots = getSlots(c);
    const nameInput = e.target.closest('[data-slotname]');
    const fieldInput = e.target.closest('[data-slotfield]');
    const bonusName = e.target.closest('[data-bonusname]');
    const bonusValore = e.target.closest('[data-bonusvalore]');
    if (nameInput) {
      slots[Number(nameInput.dataset.slotname)].name = nameInput.value;
      touchActive();
    } else if (fieldInput) {
      const idx = Number(fieldInput.dataset.idx), field = fieldInput.dataset.slotfield;
      // scheda confermata: atk/dif/dur sono "readonly" lato DOM, ma un input
      // programmatico li aggirerebbe — si difende anche qui
      if (['atk', 'dif', 'dur'].includes(field) && slots[idx].statsConfirmed) return;
      // il Bonus è testo libero (es. "+2 a Tagliare"), gli altri campi sono numerici
      slots[idx][field] = field === 'bonus' ? fieldInput.value : (Number(fieldInput.value) || 0);
      // il peso di un'arma/scudo non equipaggiato conta nello Zaino: tenere
      // aggiornato il totale a ogni modifica, non solo al re-render della card
      if (field === 'peso') renderZainoSummary(c);
      touchActive();
    } else if (bonusName) {
      const [idx, bi] = parseBonusCtx(bonusName.dataset.bonusname);
      if (slots[idx].statsConfirmed) return;
      // solo il nome, senza rinfrescare a ogni tasto: altrimenti si perde il
      // focus del campo a metà digitazione (vedi 'change' più sotto)
      slots[idx].bonuses[bi].name = bonusName.value;
      touchActive();
    } else if (bonusValore) {
      const [idx, bi] = parseBonusCtx(bonusValore.dataset.bonusvalore);
      if (slots[idx].statsConfirmed) return;
      slots[idx].bonuses[bi].valore = Math.max(1, Math.floor(Number(bonusValore.value)) || 1);
      refreshAfterEquipBonusChange(c);
      touchActive();
    }
  });
  $(sel).addEventListener('change', e => {
    const slotUsa = e.target.closest('[data-slotusa]');
    if (slotUsa) {
      const c = getActive(); if (!c) return;
      const slots = getSlots(c);
      const [idx, field] = slotUsa.dataset.slotusa.split('::');
      slots[Number(idx)][field] = slotUsa.checked;
      renderAttackWeaponList(c);
      touchActive();
      return;
    }
    const weaponEffettoNome = e.target.closest('[data-weaponeffettonome]');
    if (weaponEffettoNome) {
      const c = getActive(); if (!c) return;
      const slots = getSlots(c);
      const idx = Number(weaponEffettoNome.dataset.weaponeffettonome);
      const slot = slots[idx];
      if (slot.statsConfirmed) return;
      slot.effettoNome = weaponEffettoNome.value.trim();
      if (!slot.effettoNome) slot.effettoTratto = '';
      doRender(c);
      touchActive();
      return;
    }
    const weaponEffettoTrattoSel = e.target.closest('[data-weaponeffettotrattosel]');
    if (weaponEffettoTrattoSel) {
      const c = getActive(); if (!c) return;
      const slots = getSlots(c);
      const idx = Number(weaponEffettoTrattoSel.dataset.weaponeffettotrattosel);
      const slot = slots[idx];
      if (slot.statsConfirmed) return;
      if (weaponEffettoTrattoSel.value === '__custom__') {
        // Non tocca ancora il dato (nessun nome scelto): un doRender qui lo
        // farebbe subito sparire (campo vuoto = "non personalizzato" per il
        // render), quindi si mostra solo il campo di testo affinché si possa
        // digitare — resta scritto solo quando l'input custom viene compilato.
        const customInput = weaponEffettoTrattoSel.parentElement.querySelector('[data-weaponeffettotrattocustom]');
        if (customInput) { customInput.classList.remove('hidden'); customInput.focus(); }
        return;
      }
      slot.effettoTratto = weaponEffettoTrattoSel.value;
      doRender(c);
      touchActive();
      return;
    }
    const weaponEffettoTrattoCustom = e.target.closest('[data-weaponeffettotrattocustom]');
    if (weaponEffettoTrattoCustom) {
      const c = getActive(); if (!c) return;
      const slots = getSlots(c);
      const idx = Number(weaponEffettoTrattoCustom.dataset.weaponeffettotrattocustom);
      const slot = slots[idx];
      if (slot.statsConfirmed) return;
      slot.effettoTratto = weaponEffettoTrattoCustom.value.trim();
      touchActive();
      return;
    }
    const weaponAttackTraitSel = e.target.closest('[data-weaponattacktraitsel]');
    if (weaponAttackTraitSel) {
      const c = getActive(); if (!c) return;
      const slots = getSlots(c);
      const idx = Number(weaponAttackTraitSel.dataset.weaponattacktraitsel);
      const slot = slots[idx];
      if (slot.statsConfirmed) return;
      if (weaponAttackTraitSel.value === '__custom__') {
        // Stesso principio di weaponEffettoTrattoSel sopra: non tocca il
        // dato finché non si digita, solo il campo di testo va mostrato.
        const customInput = weaponAttackTraitSel.parentElement.querySelector('[data-weaponattacktraitcustom]');
        if (customInput) { customInput.classList.remove('hidden'); customInput.focus(); }
        return;
      }
      slot.attackTraitName = weaponAttackTraitSel.value;
      doRender(c);
      touchActive();
      return;
    }
    const weaponAttackTraitCustom = e.target.closest('[data-weaponattacktraitcustom]');
    if (weaponAttackTraitCustom) {
      const c = getActive(); if (!c) return;
      const slots = getSlots(c);
      const idx = Number(weaponAttackTraitCustom.dataset.weaponattacktraitcustom);
      const slot = slots[idx];
      if (slot.statsConfirmed) return;
      slot.attackTraitName = weaponAttackTraitCustom.value.trim();
      touchActive();
      return;
    }
    const fieldChange = e.target.closest('[data-slotfield]');
    if (fieldChange && ['atk', 'dif', 'dur'].includes(fieldChange.dataset.slotfield)) {
      const c = getActive(); if (!c) return;
      const slots = getSlots(c);
      const idx = Number(fieldChange.dataset.idx), field = fieldChange.dataset.slotfield;
      const slot = slots[idx];
      // riscatta il valore digitato nel range ufficiale solo a digitazione
      // conclusa (non a ogni tasto, altrimenti si combatte con la tastiera);
      // da confermata la scheda non è comunque scrivibile (readonly)
      if (!slot.statsConfirmed) {
        const r = equipRange(slot.kind, slot.size, slot.quality);
        if (r) {
          const [min, max] = r[field];
          slot[field] = clamp(Number(fieldChange.value) || min, min, max);
        }
        doRender(c);
        touchActive();
      }
      return;
    }
    const bonusName = e.target.closest('[data-bonusname]');
    const bonusKind = e.target.closest('[data-bonuskind]');
    const bonusKey = e.target.closest('[data-bonuskey]');
    const bonusListKey = e.target.closest('[data-bonuslistkey]');
    const bonusTraitPreset = e.target.closest('[data-bonustraitpreset]');
    const bonusRegenTarget = e.target.closest('[data-bonusregentarget]');
    const bonusRegenInterval = e.target.closest('[data-bonusregeninterval]');
    const bonusStatusTarget = e.target.closest('[data-bonusstatustarget]');
    if (!bonusName && !bonusKind && !bonusKey && !bonusListKey && !bonusTraitPreset && !bonusRegenTarget && !bonusRegenInterval && !bonusStatusTarget) return;
    const c = getActive(); if (!c) return;
    const slots = getSlots(c);
    // scheda confermata: i bonus restano bloccati insieme alle statistiche
    // (vedi statField/durField più sopra) finché non si preme "Modifica
    // scheda" — un evento programmatico non deve poterli aggirare
    const bonusEl = bonusKind || bonusKey || bonusListKey || bonusTraitPreset || bonusRegenTarget || bonusRegenInterval || bonusStatusTarget || bonusName;
    const bonusCtxAttr = bonusKind ? 'bonuskind' : bonusKey ? 'bonuskey' : bonusListKey ? 'bonuslistkey' : bonusTraitPreset ? 'bonustraitpreset' : bonusRegenTarget ? 'bonusregentarget' : bonusRegenInterval ? 'bonusregeninterval' : bonusStatusTarget ? 'bonusstatustarget' : 'bonusname';
    const [lockedIdx] = parseBonusCtx(bonusEl.dataset[bonusCtxAttr]);
    if (slots[lockedIdx].statsConfirmed) return;
    if (bonusKind) {
      const [idx, bi] = parseBonusCtx(bonusKind.dataset.bonuskind);
      const b = slots[idx].bonuses[bi];
      const itemKind = slots[idx].kind;
      b.kind = bonusKind.value;
      // riallinea il dato al primo valore consentito per QUESTO pezzo,
      // altrimenti resterebbe vuoto (o puntato a una statistica non
      // ammessa per scudo/arma) finché l'utente non lo tocca
      const allowedPrimary = primaryBonusKeysFor(itemKind);
      if (b.kind === 'primary' && !allowedPrimary.includes(b.key)) b.key = allowedPrimary[0];
      if (b.kind === 'trait') {
        const traitOptions = traitOptionsFor(itemKind);
        if (traitOptions) {
          // scudo/arma: categoria sempre "Capacità Combattive", non scelta libera
          b.listKey = 'capacitaCombattive';
          if (!traitOptions.includes(b.name)) b.name = traitOptions[0];
        } else if (!b.listKey || b.listKey === 'conoscenze') b.listKey = 'capacitaNormali';
      }
      if (b.kind === 'rigenerazione') {
        if (!EQUIP_REGEN_TARGETS.some(t => t.key === b.key)) b.key = 'hp';
        if (!b.intervalMin) b.intervalMin = 10;
        b.regenRemainingSec = Math.round(b.intervalMin * 60);
      }
      if ((b.kind === 'status' || b.kind === 'statusresist' || b.kind === 'statusimmune') && !percentContestStatusInfo(b.key)) b.key = STATUS_EFFECTS[0].key;
      doRender(c);
    } else if (bonusKey) {
      const [idx, bi] = parseBonusCtx(bonusKey.dataset.bonuskey);
      slots[idx].bonuses[bi].key = bonusKey.value;
    } else if (bonusRegenTarget) {
      const [idx, bi] = parseBonusCtx(bonusRegenTarget.dataset.bonusregentarget);
      slots[idx].bonuses[bi].key = bonusRegenTarget.value;
    } else if (bonusStatusTarget) {
      const [idx, bi] = parseBonusCtx(bonusStatusTarget.dataset.bonusstatustarget);
      slots[idx].bonuses[bi].key = bonusStatusTarget.value;
    } else if (bonusRegenInterval) {
      const [idx, bi] = parseBonusCtx(bonusRegenInterval.dataset.bonusregeninterval);
      const b = slots[idx].bonuses[bi];
      b.intervalMin = Math.max(1, Math.floor(Number(bonusRegenInterval.value)) || 10);
      // il conto alla rovescia in corso non deve mai superare il nuovo
      // intervallo appena impostato
      b.regenRemainingSec = Math.min(Number(b.regenRemainingSec) || Infinity, Math.round(b.intervalMin * 60));
    } else if (bonusListKey) {
      const [idx, bi] = parseBonusCtx(bonusListKey.dataset.bonuslistkey);
      slots[idx].bonuses[bi].listKey = bonusListKey.value;
      // solo l'armatura ha questo selettore (scudo/arma restano fissi su
      // Capacità Combattive): cambiare categoria cambia anche i tratti
      // suggeriti dal preset accanto, va ri-renderizzato
      doRender(c);
    } else if (bonusTraitPreset) {
      // una voce suggerita -> nome impostato in automatico (categoria
      // invariata: già scelta a parte per l'armatura, sempre "Capacità
      // Combattive" per scudo/arma); "personalizzato" -> rivela il nome
      // libero, senza toccare quanto già digitato
      const [idx, bi] = parseBonusCtx(bonusTraitPreset.dataset.bonustraitpreset);
      const b = slots[idx].bonuses[bi];
      const itemKind = slots[idx].kind;
      if (bonusTraitPreset.value !== '__custom__') {
        b.name = bonusTraitPreset.value;
        if (traitOptionsFor(itemKind)) b.listKey = 'capacitaCombattive';
      } else {
        // svuota il nome: altrimenti, se combaciava ancora con un
        // suggerimento, il render lo riconoscerebbe come preset e non come
        // "personalizzato", ripristinando la tendina alla voce precedente
        b.name = '';
        if (traitOptionsFor(itemKind)) b.listKey = 'capacitaCombattive';
      }
      doRender(c);
    } else if (bonusName) {
      const [idx, bi] = parseBonusCtx(bonusName.dataset.bonusname);
      slots[idx].bonuses[bi].name = bonusName.value.trim();
      // nome nuovo scritto a mano: condividilo con la campagna (se il
      // personaggio ne è membro), così altri personaggi della stessa storia
      // lo trovano già pronto da pescare, nella categoria corretta
      const editedSlot = slots[idx];
      const editedBonus = slots[idx].bonuses[bi];
      if (c.cloudCampaignId && editedBonus.name && (editedSlot.kind === 'scudo' || editedSlot.kind === 'arma' || editedSlot.kind === 'armatura')) {
        addCampaignKnownTrait(c.cloudCampaignId, editedBonus.listKey || 'capacitaCombattive', editedBonus.name);
      }
    }
    // qualunque campo sia cambiato (tipo, categoria o nome), se la riga punta
    // ormai a un tratto con un nome valido va creato se ancora non c'è —
    // non solo quando si tocca proprio il campo nome
    slots.forEach(s => (s.bonuses || []).forEach(b => {
      if (b.kind === 'trait') ensureTraitExists(c, b.listKey, b.name);
    }));
    refreshAfterEquipBonusChange(c);
    touchActive();
  });
  $(sel).addEventListener('click', e => {
    const addBtn = e.target.closest('[data-addequipbonus]');
    const delBtn = e.target.closest('[data-delequipbonus]');
    const equipBtn = e.target.closest('[data-slotequip]');
    const removeBtn = e.target.closest('[data-slotremove]');
    const confirmBtn = e.target.closest('[data-slotconfirm]');
    const unlockBtn = e.target.closest('[data-slotunlock]');
    const btn = e.target.closest('[data-slotsize],[data-slotquality],[data-slotweaponclass]');
    const c = getActive(); if (!c) return;
    const slots = getSlots(c);
    if (confirmBtn) {
      const slot = slots[Number(confirmBtn.dataset.slotconfirm)];
      applySlotConfirm(slot);
      doRender(c);
      touchActive();
      return;
    }
    if (unlockBtn) {
      slots[Number(unlockBtn.dataset.slotunlock)].statsConfirmed = false;
      doRender(c);
      touchActive();
      return;
    }
    if (addBtn) {
      const idx = Number(addBtn.dataset.addequipbonus);
      if (slots[idx].statsConfirmed) return;
      if (!Array.isArray(slots[idx].bonuses)) slots[idx].bonuses = [];
      slots[idx].bonuses.push(makeEquipBonusRow(slots[idx].kind));
      doRender(c);
      touchActive();
      return;
    }
    if (delBtn) {
      const [idx, bi] = parseBonusCtx(delBtn.dataset.delequipbonus);
      if (slots[idx].statsConfirmed) return;
      slots[idx].bonuses.splice(bi, 1);
      doRender(c);
      refreshAfterEquipBonusChange(c);
      touchActive();
      return;
    }
    if (equipBtn) {
      const idx = Number(equipBtn.dataset.slotequip);
      const willEquip = slots[idx].equipaggiato === false;
      // Max 2 scudi equipaggiati (una mano ciascuno): il secondo richiede il
      // tratto "Guardia a Torre" — controllo scoped naturalmente a
      // kind==='scudo', quindi non tocca mai gli slot armatura (stesso
      // handler condiviso, vedi wireEquipGrid).
      if (willEquip && slots[idx].kind === 'scudo') {
        const altriScudiEquipaggiati = slots.filter((s, i) => i !== idx && s.kind === 'scudo' && s.equipaggiato !== false).length;
        if (altriScudiEquipaggiati >= 2) {
          toast('Puoi avere al massimo 2 scudi equipaggiati contemporaneamente');
          return;
        }
        if (altriScudiEquipaggiati === 1 && getTraitValue(c, 'capacitaCombattive', 'Guardia a Torre') <= 0) {
          toast('Il secondo scudo equipaggiato richiede il tratto "Guardia a Torre"');
          return;
        }
      }
      slots[idx].equipaggiato = willEquip ? true : false;
      doRender(c);
      refreshAfterEquipBonusChange(c);
      touchActive();
      return;
    }
    if (removeBtn) {
      const idx = Number(removeBtn.dataset.slotremove);
      slots.splice(idx, 1);
      doRender(c);
      refreshAfterEquipBonusChange(c);
      touchActive();
      return;
    }
    if (!btn) return;
    const card = btn.closest('[data-slotidx]');
    const slot = slots[Number(card.dataset.slotidx)];
    if (btn.hasAttribute('data-slotweaponclass')) {
      // classe dell'arma: sempre una delle due, mai vuota (serve per la
      // regola "bianca e da tiro non si combinano" in Attacca)
      slot.weaponClass = btn.dataset.slotweaponclass;
      doRender(c);
      renderAttackWeaponList(c);
      touchActive();
      return;
    }
    const val = btn.dataset.slotsize || btn.dataset.slotquality;
    if (btn.hasAttribute('data-slotsize')) {
      slot.size = slot.size === val ? '' : val;
    } else {
      slot.quality = slot.quality === val ? '' : val;
    }
    clampSlotToRange(slot);
    doRender(c);
    touchActive();
  });
}
function wireEditTable(sel, dataAttr, field) {
  $(sel).addEventListener('input', e => {
    const input = e.target.closest(`[data-${dataAttr}]`);
    if (!input) return;
    const c = getActive(); if (!c) return;
    const idx = Number(input.dataset.idx), key = input.dataset[dataAttr] || input.getAttribute(`data-${dataAttr}`);
    // nome/durata restano disabled a render una volta confermata la riga
    // (Tipo per Tecniche/Abilità, boostConfirmed per Boost): controllo
    // difensivo, stesso pattern di traitBonusRowLocked più sopra.
    if (['tecnica', 'abilita', 'boostrow'].includes(dataAttr) && traitBonusRowLocked(c, dataAttr, idx)) return;
    c[field][idx][key] = input.value;
    touchActive();
  });
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copia non riuscita'); }
  ta.remove();
}

function setField(key, value) {
  const c = getActive(); if (!c) return;
  c[key] = value;
  touchActive();
}
/* Somma degli "Incremento statistica" da oggetto consumabile che puntano a
   un Tratto (c.statBuffs con listKey valorizzato — vedi useConsumable):
   permanente finché non sospeso da "Incrementi attivi", stesso principio
   già in uso per le statistiche (buffTotal). Un incremento su statistica
   NON ha listKey e non viene mai contato qui (nessuna doppia lettura). */
function consumableTraitBuffTotal(c, list, name) {
  return (c.statBuffs || []).filter(b => b.listKey === list && b.target === name).reduce((s, b) => s + (Number(b.valore) || 0), 0);
}
function getTraitValue(c, list, name) {
  const custom = (c.customTraits[list] || []).find(t => t.name === name);
  const base = custom ? (Number(custom.value) || 0) : (Number(c.traits[list][name]) || 0);
  // combatTraitModTotal è no-op (0) fuori da un incontro attivo o per un
  // personaggio senza cloudCharacterId: combatEffectsForChar torna [] in
  // quei casi, stesso trattamento già valido per statModMultiplier.
  // Checkpoint "Boost e pedina di combattimento": il bonus a tratto di un
  // Boost attivo in combattimento cloud è GIÀ incluso qui sopra (viaggia
  // dentro trait_mods come qualunque altro effetto attivo, vedi
  // activateBoostRow) — boostLocalBuffTotal copre solo il caso fuori da un
  // combattimento cloud attivo (dove combatTraitModTotal è no-op).
  // Il bonus "a tempo" di un oggetto (applicaBuffMalus, N turni) viaggia
  // anch'esso in trait_mods (combatTraitModTotal) come Boost/tecab; solo il
  // bonus PERMANENTE (incremento) ha bisogno del suo lettore dedicato,
  // consumableTraitBuffTotal, perché vive in c.statBuffs e non in
  // combat_active_effects.
  return base + equipBonusTotal(c, 'trait', name, list) + combatTraitModTotal(c.cloudCharacterId || '', list, name)
    + boostLocalBuffTotal(c, list, name) + consumableTraitBuffTotal(c, list, name);
}

/* ------------------------------------------------------------ char CRUD */

/* Blocco 3: limite personaggi del piano — visibleCharacters() è lo stesso
   conteggio già usato da "I tuoi personaggi", così il numero mostrato
   all'utente e quello che blocca la creazione sono sempre lo stesso.
   null = nessun limite (piano che lo consente). Per un account collegato
   il server verifica comunque lo stesso limite alla scrittura reale (vedi
   trg_enforce_character_limit): questo controllo qui evita solo di far
   percorrere tutto il wizard per poi fallire al salvataggio. */
function createCharacterFlow() {
  const limit = typeof effectiveCharacterLimit === 'function' ? effectiveCharacterLimit() : FREE_CHARACTER_LIMIT;
  if (limit !== null && limit !== undefined && visibleCharacters().length >= limit) {
    if (typeof showLimitReachedNotice === 'function') showLimitReachedNotice('personaggi');
    else toast('Hai raggiunto il limite di personaggi del tuo piano attuale');
    return;
  }
  const c = ensureShape(newCharacter('Nuovo personaggio'));
  c.ownerAccountId = currentSessionUserId || null;
  characters.push(c);
  saveAll();
  openCreationWizard(c.id);
}
function duplicateCharacter(id) {
  const orig = characters.find(c => c.id === id);
  if (!orig) return;
  // Blocco 3: stesso limite/stesso conteggio di createCharacterFlow — un
  // duplicato è comunque un personaggio nuovo, non un'eccezione al limite.
  const limit = typeof effectiveCharacterLimit === 'function' ? effectiveCharacterLimit() : FREE_CHARACTER_LIMIT;
  if (limit !== null && limit !== undefined && visibleCharacters().length >= limit) {
    if (typeof showLimitReachedNotice === 'function') showLimitReachedNotice('personaggi');
    else toast('Hai raggiunto il limite di personaggi del tuo piano attuale');
    return;
  }
  const copy = JSON.parse(JSON.stringify(orig));
  copy.id = uid();
  copy.nome = (orig.nome || 'Personaggio') + ' (copia)';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  // Un duplicato non deve MAI restare agganciato alla riga cloud
  // dell'originale: senza azzerare questi campi, un domani questo doppione
  // dormiente (magari mai più aperto per mesi) potrebbe venire risalvato e
  // sovrascrivere per intero i dati reali dell'originale nel cloud — il
  // guard di versione ottimistico non lo impedirebbe, perché senza
  // cloudVersion tracciata il push la tratta come un primo salvataggio
  // legittimo, non come un conflitto (bug reale riscontrato su Chroma
  // Karsavina). Un duplicato riparte scollegato: se lo si vuole salvare nel
  // cloud, crea una riga tutta sua.
  copy.cloudCharacterId = null;
  copy.cloudCampaignId = null;
  copy.cloudCampaignName = null;
  copy.cloudCampaignTrashedAt = null;
  copy.cloudCampaignPurgeAt = null;
  copy.cloudJoinRequestId = null;
  copy.cloudJoinCampaignId = null;
  copy.cloudJoinCampaignName = null;
  copy.cloudVersion = null;
  copy.cloudDirty = false;
  copy.cloudSyncPending = false;
  characters.push(copy);
  saveAll();
  renderCharList();
  toast('Duplicato');
}
/* Se il personaggio è già stato salvato nel cloud, va eliminata anche quella
   riga: altrimenti resterebbe lì, e syncMyCharactersFromCloud (che importa
   automaticamente i personaggi dell'account da altri dispositivi) lo
   re-importerebbe subito, facendolo "resuscitare" alla prossima apertura
   dell'elenco. */
async function deleteCharacter(id) {
  const c = characters.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Eliminare "${c.nome || 'personaggio senza nome'}"? L'azione non è reversibile.`)) return;
  if (c.cloudCharacterId && typeof deleteCharacterCloud === 'function') {
    try { await deleteCharacterCloud(c.cloudCharacterId); }
    catch (err) { toast('Eliminazione dal cloud non riuscita: ' + describeError(err)); return; }
  }
  characters = characters.filter(x => x.id !== id);
  if (activeId === id) activeId = null;
  saveAll();
  renderCharList();
  // Il nome nel messaggio evita confusione se il toast si vede ancora
  // sfumare su un'altra schermata (es. dopo aver aperto subito un altro
  // personaggio): un "Eliminato" da solo non direbbe cosa.
  toast(`Eliminato: ${c.nome || 'personaggio senza nome'}`);
}
function charMenu() {
  const c = getActive(); if (!c) return;
  const choice = prompt('Digita:\n"esporta" per scaricare il JSON del personaggio\n"elimina" per eliminarlo', 'esporta');
  if (choice === null) return;
  if (choice.trim().toLowerCase().startsWith('esp')) {
    exportCharacter(c);
  } else if (choice.trim().toLowerCase().startsWith('eli')) {
    deleteCharacter(c.id);
    showView('list');
  }
}
function exportCharacter(c) {
  const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c.nome || 'personaggio').replace(/[^a-z0-9]+/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------- aggiornamenti app */

/* Il repository da cui leggere le release (per l'aggiornamento OTA) NON è
   più scritto qui dentro come costante fissa: viveva così fino a poco fa
   (puntava per errore a un vecchio repository, "MinimalSystem-ManualediGioco",
   rimasto indietro a v1.0.99 — un refuso ereditato dal momento in cui
   questo repository è stato creato copiando il codice dal vecchio, mai
   corretto da allora) e un errore così silenzioso, in un valore incorporato
   nel bundle stesso, blocca l'aggiornamento automatico finché non si
   reinstalla a mano l'APK — l'unico modo per far arrivare la correzione a
   chi ha già l'app installata. Per non poterci ricadere in futuro (es. un
   altro cambio di nome/organizzazione del repository), il valore vero
   vive in Supabase (tabella app_config, sola lettura pubblica) e viene
   letto ad ogni avvio: correggerlo da lì aggiorna SUBITO tutte le app già
   installate, senza bisogno di una nuova release. La costante qui sotto
   resta solo come ripiego offline/di primo avvio.
   */
const DEFAULT_RELEASES_REPO = 'mauromameliarchitetto-afk/MinimalSystem-Releases';
async function resolveReleasesRepo() {
  try {
    const { data, error } = await withTimeout(
      sb.from('app_config').select('value').eq('key', 'releases_repo').single(),
      'Configurazione aggiornamenti'
    );
    if (error || !data || !data.value) return DEFAULT_RELEASES_REPO;
    return data.value;
  } catch (e) { return DEFAULT_RELEASES_REPO; }
}
let updateUrl = null;

function isNativeApp() {
  return window.Capacitor !== undefined || location.hostname === 'localhost';
}

function cmpVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/* Hotfix "intro che si blocca e riparte": unico coordinatore che differisce
   QUALUNQUE reload o applicazione di bundle fino alla fine reale
   dell'introduzione — riusato da checkForUpdate (OTA, up.set), dal ramo
   nativo e dal ramo web di registerServiceWorker (location.reload), mai
   una copia della stessa logica per ciascun percorso. Se #intro-layer non
   esiste più (intro già conclusa o mai mostrata) esegue subito. Se esiste
   ancora, attende UNA sola volta l'evento 'rm-intro-finished' (disparato
   da js/intro.js, sempre e solo una volta per finishIntro()): nessun
   polling, nessun timeout arbitrario.

   Revisione: un semplice "vince il primo arrivato" non basta — se il
   reload del vecchio service worker si accoda PRIMA che l'OTA sia pronta,
   l'aggiornamento scaricato andrebbe perso per quel giro (il reload
   "vincitore" ricarica la pagina senza mai applicare il bundle già
   scaricato). Priorità esplicita fra le richieste in coda:
     1) up.set() (OTA) sostituisce e annulla un semplice reload già in coda;
     2) un reload arrivato DOPO che l'OTA è già in coda non lo sostituisce;
     3) qualunque richiesta arrivata DOPO che l'operazione vincente è già
        partita (rm-intro-finished già disparato) viene ignorata — mai due
        operazioni, mai un secondo reload sopra il primo.
   A parità di priorità (es. due reload, native+web) resta in coda solo il
   primo: identico comportamento di prima in quel caso. */
var MS_INTRO_DEFER_PRIORITY = { RELOAD: 1, OTA_APPLY: 2 };
var msIntroDeferredAction = null; // { priority, fn } — la richiesta con priorità più alta finora
var msIntroDeferredStarted = false; // vero SOLO dopo che rm-intro-finished ha già fatto partire l'azione vincente
function afterIntroFinished(fn, priority) {
  priority = priority || 0;
  if (!document.getElementById('intro-layer')) { fn(); return; }
  if (msIntroDeferredStarted) return; // l'operazione vincente è già partita: ignora qualunque richiesta successiva
  if (msIntroDeferredAction && priority <= msIntroDeferredAction.priority) return; // priorità pari o inferiore a quella già in coda: ignorata
  const isFirstRequest = !msIntroDeferredAction;
  msIntroDeferredAction = { priority: priority, fn: fn };
  if (isFirstRequest) {
    window.addEventListener('rm-intro-finished', () => {
      msIntroDeferredStarted = true;
      const action = msIntroDeferredAction;
      msIntroDeferredAction = null;
      if (action) action.fn();
    }, { once: true });
  }
}

function otaPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater) || null;
}

/* Blocco screenshot reale (FLAG_SECURE) durante la lettura di una premessa
   in PDF: disponibile solo nell'app Android nativa. Chiamata dal
   visualizzatore PDF (js/pdfviewer.js) all'apertura/chiusura. Sul web non
   esiste un modo per impedire davvero uno screenshot: lì il visualizzatore
   applica solo una filigrana come deterrente. */
function privacyScreenPlugin() {
  return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PrivacyScreen) || null;
}
window.MSSetScreenshotBlock = function (on) {
  const p = privacyScreenPlugin();
  if (!p) return;
  (on ? p.enable() : p.disable()).catch(() => {});
};

/* ---------------------------------------------- pubblicazione online (GitHub) */

/* Blocco 2 (rebrand + ripulitura tecnica): rimossa la pubblicazione via
   token GitHub incollato dal Narratore (ghToken/setGhToken/ghRequest/
   ghEnsureBranch/ghGetFileSha/ghPutFile/ghDeleteFile/publishStoryOnline/
   unpublishStoryOnline, più il relativo pannello "Pubblicazione online"
   in index.html) — un prodotto commerciale non deve chiedere a un
   utente di incollare un Personal Access Token. Resta INVECE la lettura
   pubblica sotto (nessun token, mai richiesto ai giocatori): chi aveva
   già pubblicato una premessa in passato la trova ancora nell'elenco e
   i giocatori già collegati a quella storia continuano a leggerla — solo
   non è più possibile pubblicarne di nuove o aggiornarle da qui.
   L'unica via di condivisione rimasta è l'invito manuale (copia/incolla
   già esistente, vedi #btn-share-premesse-pdf), sempre stato locale e
   senza alcun token. Una premessa pubblicata in passato e mai rimossa
   resta sul repository pubblico finché qualcuno con un token non la
   toglie a mano: nessun modo di farlo da qui senza reintrodurre lo
   stesso problema. */
function jsonFromB64(b64) { return JSON.parse(decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))))); }

/* Lettura pubblica (lato giocatore): nessun token, il repository è pubblico */
function loadStoriesIndexCache() {
  try { return JSON.parse(localStorage.getItem(STORIES_CACHE_KEY)) || null; } catch (e) { return null; }
}
function saveStoriesIndexCache(data) {
  try { localStorage.setItem(STORIES_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data })); } catch (e) {}
}
function invalidateStoriesIndexCache() {
  try { localStorage.removeItem(STORIES_CACHE_KEY); } catch (e) {}
}
async function fetchStoriesIndexRemote() {
  try {
    const res = await fetch(`${GH_API}/contents/stories/index.json?ref=${GH_BRANCH}`, {
      headers: { 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return jsonFromB64(data.content);
  } catch (e) { return null; }
}
/* Elenco storie pubblicate, con cache locale (5 min) per non consumare
   il limite di richieste anonime dell'API GitHub. force=true ignora la cache. */
async function getStoriesIndex(force) {
  const cache = loadStoriesIndexCache();
  if (!force && cache && (Date.now() - cache.fetchedAt) < STORIES_CACHE_TTL) return cache.data;
  const remote = await fetchStoriesIndexRemote();
  if (remote) { saveStoriesIndexCache(remote); return remote; }
  return (cache && cache.data) || [];
}
async function fetchStoryPdfBytes(id) {
  const res = await fetch(`${GH_API}/contents/stories/${id}.pdf?ref=${GH_BRANCH}`, {
    headers: { 'Accept': 'application/vnd.github.raw+json' }
  });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/* Solo nell'app nativa: confronta la versione installata (APP_VERSION,
   scritta dalla build) con l'ultima release Android su GitHub.
   Se esiste una versione più recente prova l'aggiornamento OTA in
   background (scarica bundle.zip nella memoria interna e lo applica
   subito, senza download visibili né installazioni); se l'OTA non è
   disponibile o fallisce, mostra il banner col download dell'APK. */
async function checkForUpdate() {
  if (!isNativeApp() || typeof APP_VERSION === 'undefined' || !APP_VERSION) return;
  const repo = await resolveReleasesRepo();
  fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`)
    .then(r => r.json())
    .then(async rels => {
      // cerca la release Android (apk-v…) più recente, ignorando le altre
      let best = null, bestVer = null;
      (Array.isArray(rels) ? rels : []).forEach(rel => {
        if (rel.draft || rel.prerelease) return;
        const m = /^apk-v(\d+(?:\.\d+)*)$/.exec(rel.tag_name || '');
        if (m && (bestVer === null || cmpVersions(m[1], bestVer) > 0)) { best = rel; bestVer = m[1]; }
      });
      if (!best || cmpVersions(bestVer, APP_VERSION) <= 0) return;

      // 1) tentativo OTA silenzioso
      const up = otaPlugin();
      const zip = (best.assets || []).find(a => a.name === 'bundle.zip');
      if (up && zip) {
        try {
          toast(`Aggiornamento alla v${bestVer} in corso…`);
          const bundle = await up.download({ url: zip.browser_download_url, version: bestVer });
          // Il download può concludersi mentre l'intro è ancora in corso:
          // applicare subito il bundle ricaricherebbe la WebView a metà
          // del video (hotfix "intro che si blocca e riparte", percorso 1).
          // Il download resta comunque libero di proseguire dietro l'intro,
          // solo l'applicazione/reload viene differita.
          afterIntroFinished(() => { up.set(bundle); }, MS_INTRO_DEFER_PRIORITY.OTA_APPLY); // applica e ricarica, mai prima della fine reale dell'intro — priorità massima: sostituisce un semplice reload già in coda
          return;
        } catch (e) {
          console.error('OTA non riuscito, ripiego su APK', e);
        }
      }

      // 2) ripiego: banner con download manuale dell'APK
      const apk = (best.assets || []).find(a => a.name && a.name.endsWith('.apk'));
      updateUrl = apk ? apk.browser_download_url : best.html_url;
      $('#update-banner-text').textContent = `Nuova versione disponibile (v${bestVer})`;
      $('#update-banner-chrome-help').classList.add('hidden');
      $('#update-banner').classList.remove('hidden');
    })
    .catch(() => { /* offline o API non raggiungibile: nessun avviso */ });
}

/* ------------------------------------------------------ premesse di gioco */

const PREMESSE_KEY = 'ms_premesse_v1';

function loadPremesse() {
  try { return JSON.parse(localStorage.getItem(PREMESSE_KEY)) || {}; }
  catch (e) { return {}; }
}
function savePremesse(map) {
  try { localStorage.setItem(PREMESSE_KEY, JSON.stringify(map)); }
  catch (e) { toast('Salvataggio non riuscito'); }
}

/* Menù a tendina "Storie pubblicate" in Identità: elenco scaricato dal
   repository (nessun token richiesto, il repository è pubblico). */
async function renderStoriaSelect(c) {
  const sel = $('#f-storia-select');
  if (!sel) return;
  const rawIndex = await getStoriesIndex();
  // il personaggio potrebbe essere cambiato mentre la richiesta era in corso
  if (getActive() !== c) return;
  const index = dedupeStoriesByName(rawIndex);
  sel.innerHTML = `<option value="">— scegli dall'elenco, oppure scrivi il nome sotto —</option>` +
    index.map(entry => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.nome)}</option>`).join('');
  sel.value = (c.storiaId && index.some(x => x.id === c.storiaId)) ? c.storiaId : '';
}
/* Filtro difensivo: se per qualunque motivo l'indice online contenesse più
   voci per la stessa storia (es. pubblicata da due dispositivi diversi
   prima che publishStoryOnline() le unificasse), il menù ne mostra una
   sola — la più recente. */
function dedupeStoriesByName(index) {
  const norm = n => String(n || '').trim().toLowerCase();
  const byName = new Map();
  index.forEach(entry => {
    const key = norm(entry.nome);
    const prev = byName.get(key);
    if (!prev || (entry.updatedAt || 0) > (prev.updatedAt || 0)) byName.set(key, entry);
  });
  return [...byName.values()];
}

/* Lato giocatore: popup con la premessa della storia del personaggio.
   Se la storia è stata scelta dal menù (storiaId), il PDF si scarica al
   volo dal repository pubblico; altrimenti si usa l'eventuale invito
   incollato in passato (fallback locale, offline). */
async function renderPremPopup() {
  const c = getActive(); if (!c) return;
  const storia = (c.storia || '').trim();
  $('#prem-popup-story').textContent = storia
    ? `Storia: ${storia}`
    : 'Scegli una storia in Identità (dal menù o scrivendone il nome), poi torna qui.';
  const wrap = $('#prem-popup-list');
  if (c.storiaId) {
    wrap.innerHTML = `<div class="helper-text" style="padding:4px 0 8px;">Verifica in corso…</div>`;
    const index = await getStoriesIndex();
    if (getActive() !== c) return;
    const entry = index.find(x => x.id === c.storiaId);
    if (entry) {
      wrap.innerHTML = `
        <div class="prem-row">
          <div class="pr-main">
            <div class="pr-title">${escapeHtml(entry.titolo || entry.nome)}</div>
            <div class="pr-text">${escapeHtml(entry.filename || '')}</div>
          </div>
          <button class="btn btn-primary btn-sm" id="prem-popup-open-online" data-storyid="${escapeHtml(entry.id)}">Apri PDF</button>
        </div>`;
      return;
    }
  }
  const p = loadPremesse()[storia];
  wrap.innerHTML = p ? `
    <div class="prem-row">
      <div class="pr-main">
        <div class="pr-title">${escapeHtml(p.titolo || p.filename || 'Premessa')}</div>
        <div class="pr-text">${escapeHtml(p.filename || '')}</div>
      </div>
      <button class="btn btn-primary btn-sm" id="prem-popup-open">Apri PDF</button>
    </div>`
    : `<div class="helper-text" style="padding:4px 0 8px;">Nessuna premessa per questa storia: scegli una storia pubblicata dal menù in Identità, oppure incolla qui sotto l'invito del Narratore.</div>`;
}

async function importPremesseInvito(text) {
  const c = getActive(); if (!c) return;
  let data;
  try { data = JSON.parse(text); } catch (e) { toast('Invito non valido'); return; }
  if (!data || data.type !== 'premessa_pdf' || !data.dataUrl) { toast('Questo testo non è un invito premessa'); return; }
  const storia = (data.storia || c.storia || '').trim();
  if (!storia) { toast('L\'invito non indica la storia'); return; }
  if (!(c.storia || '').trim()) { c.storia = storia; $('#f-storia').value = storia; touchActive(); }
  try {
    const blob = await (await fetch(data.dataUrl)).blob();
    await savePdfBlob('import:' + storia, blob); // il contenuto va in IndexedDB, non in localStorage
  } catch (e) {
    toast('Impossibile salvare il PDF sul dispositivo');
    return;
  }
  const map = loadPremesse();
  map[storia] = { titolo: data.titolo || '', filename: data.filename || '', importedAt: Date.now() };
  savePremesse(map);
  renderPremPopup();
  toast(`Premessa importata per «${storia}»`);
}

/* --------------------------------------------------- Area Master e storie */

function renderMasterArea() {
  const wrap = $('#story-list');
  if (!stories.length) {
    wrap.innerHTML = `<div class="helper-text" style="padding:6px 2px 2px;">Nessuna storia ancora: creane una qui sotto.</div>`;
    return;
  }
  wrap.innerHTML = stories.map(s => `
    <div class="char-card" data-storyid="${s.id}">
      <div class="avatar bicolor">📖</div>
      <div class="info">
        <div class="name">${escapeHtml(s.nome)}</div>
        <div class="meta">${s.characters.length} personagg${s.characters.length === 1 ? 'io' : 'i'} · protetta da password</div>
      </div>
    </div>`).join('');
}

function openStory(id) {
  activeStoryId = id;
  renderStory();
  showView('story');
}

/* Lato Narratore: elenco storie per caricare/sostituire la premessa in PDF */
function renderPremisesArea() {
  const wrap = $('#premises-story-list');
  if (!stories.length) {
    wrap.innerHTML = `<div class="helper-text" style="padding:6px 2px 2px;">Nessuna storia ancora: creane una in "Area del Narratore", poi torna qui per caricare la premessa in PDF.</div>`;
    return;
  }
  wrap.innerHTML = stories.map(s => {
    const has = !!s.premessa;
    const stato = has ? 'Premessa caricata' : 'Nessuna premessa caricata';
    return `<div class="char-card" data-premstoryid="${s.id}">
      <div class="avatar bicolor">📄</div>
      <div class="info">
        <div class="name">${escapeHtml(s.nome)}</div>
        <div class="meta">${stato}</div>
      </div>
    </div>`;
  }).join('');
}
function openPremisesStory(id) {
  activeStoryId = id;
  renderPremisesStory();
  showView('premises-story');
}
function renderPremisesStory() {
  const s = getActiveStory(); if (!s) return;
  $('#premises-story-title').textContent = s.nome;
  $('#premises-title').value = (s.premessa && s.premessa.titolo) || '';
  const has = !!s.premessa;
  $('#premises-open-btn').classList.toggle('hidden', !has);
  $('#premises-remove-btn').classList.toggle('hidden', !has);
  $('#premises-file-info').innerHTML = has
    ? `<div class="pr-title">${escapeHtml(s.premessa.filename || 'premessa.pdf')}</div>
       <div class="pr-text">${Math.round((s.premessa.size || 0) / 1024)} KB · caricato ${new Date(s.premessa.uploadedAt).toLocaleString('it-IT')}</div>`
    : `<div class="helper-text" style="margin:0;">Nessun PDF caricato.</div>`;
}

function renderStory() {
  const s = getActiveStory(); if (!s) return;
  $('#story-title').textContent = s.nome;
  $('#story-count').textContent = s.characters.length;
  const wrap = $('#story-chars');
  if (!s.characters.length) {
    wrap.innerHTML = `<div class="empty-state">Nessun personaggio ancora.<br>Fatti inviare le schede dai giocatori e incollale qui sopra.</div>`;
    return;
  }
  const sorted = [...s.characters].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  wrap.innerHTML = sorted.map(c => {
    const b = BUILDS[c.build] || BUILDS.guerriero;
    const initial = (c.nome || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="char-card" data-viewchar="${c.id}">
      <div class="avatar ${axisClass(c.build in BUILDS ? c.build : 'guerriero')}">${initial}</div>
      <div class="info">
        <div class="name">${escapeHtml(c.nome || 'Senza nome')}</div>
        <div class="meta">${b.label} · Lv ${c.livello || 1}${c.storia ? ' · ' + escapeHtml(c.storia) : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function importCharacterFromText(text) {
  const s = getActiveStory(); if (!s) return;
  let c;
  try {
    c = JSON.parse(text);
  } catch (e) {
    toast('Testo non valido: incolla la scheda copiata dal giocatore');
    return;
  }
  if (!c || typeof c !== 'object' || !c.id || !c.primary) {
    toast(`Questo testo non è una scheda di ${window.BRAND_NAME || 'Role Makers'}`);
    return;
  }
  ensureShape(c);
  const idx = s.characters.findIndex(x => x.id === c.id);
  if (idx >= 0) { s.characters[idx] = c; toast(`Aggiornato: ${c.nome || 'personaggio'}`); }
  else { s.characters.push(c); toast(`Importato: ${c.nome || 'personaggio'}`); }
  saveStories();
  renderStory();
}

/* Scheda in sola lettura per l'analisi del Master */
function renderCharView(c) {
  viewingCharId = c.id;
  $('#charview-title').textContent = c.nome || 'Senza nome';
  const b = BUILDS[c.build] || BUILDS.guerriero;
  const dice = v => `+${Number(v) || 0}`;
  const kvRows = pairs => pairs.filter(p => String(p[1] ?? '').trim() !== '')
    .map(p => `<tr><td class="field" style="white-space:nowrap;color:var(--testo-secondario-dark);">${p[0]}</td><td>${escapeHtml(String(p[1]))}</td></tr>`).join('');
  const section = (title, inner) => inner
    ? `<div class="section-title" style="margin-top:14px;"><span class="dot neutral"></span>${title}</div>${inner}` : '';
  const table = rows => rows ? `<div class="table-scroll"><table class="data-table"><tbody>${rows}</tbody></table></div>` : '';

  const primarie = PRIMARY_STATS.map(st => `<tr><td class="field">${st.label}</td><td class="num">${Number(c.primary[st.key]) || 0}</td></tr>`).join('');
  const terziarie = TERTIARY_STATS.map(st => `<tr><td class="field">${st.label}</td><td class="num">${Number(c.tertiary[st.key]) || 0}</td></tr>`).join('');

  let tratti = '';
  Object.keys(TRAIT_LISTS).forEach(k => {
    const own = (c.shownTraits[k] || []).map(n => [n, c.traits[k][n] || 0]);
    (c.customTraits[k] || []).forEach(t => { if (t.name) own.push([t.name, t.value || 0]); });
    if (own.length) {
      tratti += `<tr><td colspan="3" style="color:var(--testo-secondario-dark);text-transform:uppercase;font-size:10px;">${TRAIT_LIST_LABELS[k]}</td></tr>`
        + own.map(([n, v]) => `<tr><td>${escapeHtml(n)}</td><td class="num">${v}</td><td class="num">${dice(v)}</td></tr>`).join('');
    }
  });

  const equipRow = s2 => {
    const t = EQUIP_TYPES.find(t2 => t2.key === s2.kind);
    const sz = t && t.sizes.find(sz2 => sz2.key === s2.size);
    const q = EQUIP_QUALITIES.find(q2 => q2.key === s2.quality);
    const desc = [t && t.label, sz && sz.label, q && q.label].filter(Boolean).join(' · ') || '—';
    return `<tr><td class="field">${escapeHtml(s2.name)}</td><td>${escapeHtml(desc)}</td><td class="num">${s2.atk}/${s2.dif}/${s2.dur}</td><td>${escapeHtml(s2.bonus || '—')}</td></tr>`;
  };
  const slots = (c.slots || []).filter(s2 => s2.size || s2.atk || s2.dif || s2.bonus || s2.dur).map(equipRow).join('');
  const weaponSlots = (c.weaponSlots || []).filter(s2 => s2.size || s2.atk || s2.dif || s2.bonus || s2.dur).map(equipRow).join('');

  // Ricalcolo difensivo: questa e' una scheda in sola lettura (dati magari
  // arrivati da un incollato/importato), non e' detto che utilizzi/costo/
  // range/pp/limite siano gia' aggiornati all'ultimo lv/Q.I.
  (c.tecniche || []).forEach(r => recomputeTecnicaRow(r, c.qi));
  (c.abilita || []).forEach(r => recomputeAbilitaRow(r, c.qi));
  (c.boostRows || []).forEach(recomputeBoostRow);
  // Bonus/malus: unisce le voci strutturate (bonusItems/malusItems, "+2
  // Elusione") con l'eventuale testo libero non ancora migrato — il
  // Narratore vede tutto in un'unica lista puntata, indipendentemente da
  // quali righe sono già strutturate e quali no (vedi
  // migrateTextBonusToItems/traitBonusCellHtml).
  const combinedBonusText = (r, field, itemsField, malus) => {
    const structured = bonusItemsToLines(r[itemsField], malus).join('\n');
    const legacy = String(r[field] || '');
    return [structured, legacy].filter(Boolean).join('\n');
  };
  const durataLabel = v => (AZIONE_DURATE.find(d => d.key === v) || {}).label || String(v || '');
  const rowTable = (rows, fields) => (rows || []).filter(rowHasContent)
    .map(r => `<tr>${fields.map(f =>
      f === 'bonus' ? `<td>${bulletListHtml(combinedBonusText(r, 'bonus', 'bonusItems', false), false)}</td>`
      : f === 'malus' ? `<td>${bulletListHtml(combinedBonusText(r, 'malus', 'malusItems', true), true)}</td>`
      : (f === 'durata' || f === 'tempoAzione') ? `<td>${escapeHtml(durataLabel(r[f]))}</td>`
      : `<td>${escapeHtml(String(r[f] || ''))}</td>`
    ).join('')}</tr>`).join('');
  const tecniche = rowTable(c.tecniche, ['nome', 'bonus', 'malus', 'tempoAzione', 'durata', 'utilizzi', 'lv']);
  const abilita = rowTable(c.abilita, ['nome', 'bonus', 'costo', 'tempoAzione', 'durata', 'utilizzi', 'lv']);
  const boosts = rowTable(c.boostRows, ['nome', 'bonus', 'range', 'pp', 'costo', 'limite', 'lv']);

  const BG_LABELS = {
    nascitaData: 'Data di nascita', nascitaLuogo: 'Luogo di nascita', eta: 'Età', origini: 'Origini', frase: 'In una frase',
    altezza: 'Altezza', peso: 'Peso', pelle: 'Pelle', acconciatura: 'Acconciatura', occhi: 'Occhi', segni: 'Segni particolari',
    corporatura: 'Corporatura', postura: 'Postura', vestiario: 'Vestiario', oggetto: 'Porta sempre con sé',
    abilita: 'Abilità', incompetenze: 'Incompetenze', debolezze: 'Debolezze', hobby: 'Hobby', abitudini: 'Abitudini',
    personalita: 'Personalità', morale: 'Morale', autocontrollo: 'Autocontrollo', motivazione: 'Motivazione',
    scoraggiamento: 'Scoraggiamento', sicurezza: 'Sicurezza', filosofia: 'Filosofia', paura: 'Paura più grande',
    obiettivoBreve: 'Obiettivo breve', obiettivoLungo: 'Obiettivo lungo',
    infanzia: 'Infanzia', eventoImportante: 'Evento importante', segreto: 'Segreto',
    peggiorMomento: 'Peggior momento', migliorMomento: 'Miglior momento'
  };
  const bg = kvRows(Object.keys(BG_LABELS).map(k => [BG_LABELS[k], (c.bg || {})[k]]));
  const relazioni = (c.relazioni || []).filter(r => r.nome || r.relazione || r.descrizione)
    .map(r => `<tr><td class="field">${escapeHtml(r.nome)}</td><td>${escapeHtml(r.relazione)}</td><td>${escapeHtml(r.descrizione)}</td></tr>`).join('');

  const hpMaxEff = effectiveHpMax(c), mpMaxEff = effectiveMpMax(c);
  const consumabiliRows = (c.consumabili || []).filter(r => r.nome).map(r => {
    const eff = CONSUMABLE_EFFECTS.find(e => e.key === r.effetto);
    const effTxt = r.effetto === 'incremento'
      ? `Incremento +${Number(r.valore) || 0} ${statLabel(r.target)}`
      : `${eff ? eff.label : r.effetto} +${Number(r.valore) || 0}`;
    return `<tr><td class="field">${escapeHtml(r.nome)}</td><td>${effTxt}</td><td class="num">${Number(r.quantita) || 0}</td></tr>`;
  }).join('');
  const buffRows = (c.statBuffs || []).map(b2 =>
    `<tr><td class="field">${escapeHtml(b2.nome || 'Oggetto')}</td><td>+${Number(b2.valore) || 0} ${statLabel(b2.target)}</td></tr>`).join('');

  $('#charview-body').innerHTML = `
    ${section('Identità', table(kvRows([
      ['Storia', c.storia], ['Build', b.label], ['Livello', c.livello],
      ['Razza', c.razza], ['Età', c.eta], ['Ruolo', c.ruolo],
      ['Bellezza', c.bellezzaManuale !== null && c.bellezzaManuale !== undefined && c.bellezzaManuale !== '' ? c.bellezzaManuale : c.bellezzaTirata],
      ['Q.I.', c.qi], ['AP disponibili', c.apDisponibili]
    ])))}
    ${section('Risorse', table(kvRows([
      ['HP', `${c.hpCur ?? '—'} / ${hpMaxEff}${hpMaxEff !== (c.hpMaxTracked || 0) ? ` (base ${c.hpMaxTracked || 0})` : ''}`],
      ['MP', `${c.mpCur ?? '—'} / ${mpMaxEff}${mpMaxEff !== (c.mpMaxTracked || 0) ? ` (base ${c.mpMaxTracked || 0})` : ''}`],
      ['Soglia K.O.', koThreshold(c)],
      ['PP', c.ppCur], ['P.R.', `${c.prCur ?? '—'} / ${c.prMaxTracked ?? '—'}`]
    ])))}
    ${section('Caratteristiche primarie', table(primarie))}
    ${section('Terziarie', table(terziarie))}
    ${section('Tratti', tratti ? table(tratti) : '')}
    ${section('Armatura (Locazione · Atk/Dif/Durabilità · Bonus)', slots ? table(slots) : '')}
    ${section('Scudo e armi (Atk/Dif/Durabilità · Bonus)', weaponSlots ? table(weaponSlots) : '')}
    ${section('Tecniche (Nome · Bonus · Malus · Tempo d\'azione · Durata · Utilizzi · Lv)', tecniche ? table(tecniche) : '')}
    ${section('Abilità (Nome · Bonus · Costo · Tempo d\'azione · Durata · Utilizzi · Lv)', abilita ? table(abilita) : '')}
    ${section('Boost (Nome · Bonus · Range · PP · Costo · Limite · Lv)', boosts ? table(boosts) : '')}
    ${section('Oggetti consumabili (Nome · Effetto · Scorte)', consumabiliRows ? table(consumabiliRows) : '')}
    ${section('Incrementi attivi (da sospendere quando concordato)', buffRows ? table(buffRows) : '')}
    ${section('Background', bg ? table(bg) : '')}
    ${section('Relazioni (Nome · Relazione · Descrizione)', relazioni ? table(relazioni) : '')}
    ${section('Note libere', c.note && c.note.libere ? `<div class="box-lore">${escapeHtml(c.note.libere)}</div>` : '')}
    <div class="helper-text" style="margin-top:14px;">Scheda in sola lettura, importata dal giocatore${c.updatedAt ? ' · ultimo aggiornamento ' + new Date(c.updatedAt).toLocaleString('it-IT') : ''}.</div>
  `;
  showView('charview');
}

/* ------------------------------------------------------------ service worker */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Nell'app nativa (Capacitor) i file sono già sul dispositivo: il service
  // worker serve solo alla versione web. Se una versione precedente lo aveva
  // registrato va rimosso insieme alla sua cache, altrimenti dopo un
  // aggiornamento dell'APK continua a mostrare i file dell'app vecchia.
  const isNative = window.Capacitor !== undefined || location.hostname === 'localhost';
  if (isNative) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      const hadSw = regs.length > 0;
      return Promise.all(regs.map(r => r.unregister()))
        // Solo le cache DI QUESTA app (stesso prefisso di CACHE_NAME in
        // service-worker.js), mai una cancellazione indiscriminata di ogni
        // cache dell'origine — un'altra cache estranea condivisa non va
        // toccata qui (revisione checkpoint "8 punti", terza revisione,
        // punto 2, applicata anche a questo ramo nativo).
        .then(() => (window.caches ? caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('minimal-system-v')).map(k => caches.delete(k)))) : null))
        // Hotfix "intro che si blocca e riparte", percorso 2: questo reload
        // partiva PRIMA, senza attendere la fine dell'intro — su un avvio
        // nativo con un vecchio service worker registrato, interrompeva il
        // video a metà e lo faceva ripartire dall'inizio dopo il reload.
        .then(() => { if (hadSw) afterIntroFinished(() => location.reload(), MS_INTRO_DEFER_PRIORITY.RELOAD); });
    }).catch(() => {});
    return;
  }
  // updateViaCache:'none' forza il browser a ricontrollare service-worker.js
  // in rete a ogni caricamento invece di fidarsi della cache HTTP (GitHub
  // Pages non permette di impostare gli header Cache-Control): senza questo
  // il browser può continuare a servire per giorni un service worker vecchio
  // senza mai accorgersi che ne esiste uno nuovo.
  // Alla primissima installazione (nessun service worker preesistente) la
  // pagina non ha MAI avuto un controller: self.clients.claim() nell'evento
  // 'activate' (service-worker.js) fa comunque scattare 'controllerchange'
  // anche in questo caso, non solo per un vero aggiornamento — confermato
  // empiricamente (senza questa guardia, la primissima visita ricarica da
  // sola la pagina non appena il worker si attiva, potendo interrompere a
  // metà anche l'introduzione appena avviata). Un reload ha senso SOLO se
  // la pagina aveva già un controller prima di questa registrazione: solo
  // allora in memoria c'è davvero un HTML/JS "vecchio" da rinfrescare.
  const hadControllerBeforeRegistering = !!navigator.serviceWorker.controller;
  let refreshingAfterUpdate = false;
  // Se controllerchange arriva mentre l'introduzione è ancora attiva
  // (#intro-layer presente: gate o video in corso), un reload immediato
  // interromperebbe la sessione PRIMA che js/intro.js abbia finito il suo
  // percorso — a rigore il flag di sessione è già scritto quando serve (vedi
  // hardRemoveLayerAndActivateApp), ma l'utente vedrebbe comunque saltare via
  // il gate o il video a metà. Rimanda il reload tramite afterIntroFinished
  // (hotfix "intro che si blocca e riparte": stesso helper condiviso di
  // checkForUpdate e del ramo nativo qui sopra, mai una seconda copia della
  // stessa logica) — refreshingAfterUpdate resta comunque una guardia
  // locale in più contro un secondo reload da questo stesso listener.
  function doReloadOnce() {
    if (refreshingAfterUpdate) return;
    refreshingAfterUpdate = true;
    location.reload();
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerBeforeRegistering) return;
    if (refreshingAfterUpdate) return;
    afterIntroFinished(doReloadOnce, MS_INTRO_DEFER_PRIORITY.RELOAD);
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(err => console.error('SW error', err));
  });
}

document.addEventListener('DOMContentLoaded', init);
