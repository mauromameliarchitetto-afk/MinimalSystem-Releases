/* ==========================================================================
   Role Makers — Gioca in solitaria: salvataggi locali.

   Database IndexedDB separato ("rm_solo_v1"): le partite single player non
   passano mai da localStorage['ms_characters_v1'], dal cloud, dai
   selettori dei personaggi, dagli inviti o dalle campagne. Un solo
   archivio "slot" con chiave = storia: massimo uno slot per Eidos, Ich e
   Icaro, quindi al massimo tre partite, per costruzione.

   Ogni scrittura è una transazione:
   - save(state): rifiuta una versione più vecchia di quella salvata e una
     partita diversa da quella nello slot (sostituita altrove);
   - replace(storia, idAttuale, nuovo): verifica e scrittura nella STESSA
     transazione — un'interruzione lascia la vecchia partita o la nuova,
     mai uno slot vuoto o due partite.
   Il limite è per installazione (dispositivo/browser): un limite globale
   per account richiederebbe un server di stato, escluso dalla specifica.
   ========================================================================== */
(function (global) {
  'use strict';

  const DB_NAME = 'rm_solo_v1';
  const STORIE = Object.freeze(['eidos', 'ich', 'icaro']);
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('slot', { keyPath: 'storia' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction('slot', mode);
      const store = t.objectStore('slot');
      let result, failure = null;
      Promise.resolve(fn(store, t)).then(r => { result = r; }, e => { failure = e; try { t.abort(); } catch (x) { /* già chiusa */ } });
      t.oncomplete = () => failure ? reject(failure) : resolve(result);
      t.onabort = () => reject(failure || t.error || new Error('Transazione annullata'));
      t.onerror = () => reject(failure || t.error);
    }));
  }

  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  class StoreError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  function checkStoria(storia) { if (STORIE.indexOf(storia) === -1) throw new StoreError('storia', 'Storia non prevista per il single player'); }

  async function get(storia) {
    checkStoria(storia);
    return tx('readonly', store => req(store.get(storia)));
  }

  async function list() {
    const all = await tx('readonly', store => req(store.getAll()));
    return STORIE.map(s => all.find(x => x.storia === s) || { storia: s, partita: null });
  }

  /* Prima partita di uno slot vuoto. Se lo slot è occupato serve replace. */
  async function create(state) {
    checkStoria(state.storia);
    return tx('readwrite', async store => {
      const cur = await req(store.get(state.storia));
      if (cur && cur.partita) throw new StoreError('slot_occupato', 'Lo slot di questa storia è occupato');
      await req(store.put({ storia: state.storia, partita: state, updatedAt: Date.now() }));
      return state;
    });
  }

  async function save(state) {
    checkStoria(state.storia);
    return tx('readwrite', async store => {
      const cur = await req(store.get(state.storia));
      if (!cur || !cur.partita || cur.partita.id !== state.id) throw new StoreError('sostituita', 'Questa partita non è più nello slot');
      if (cur.partita.version > state.version) throw new StoreError('versione', 'Il salvataggio è più recente di questa copia');
      // stessa versione: consentito solo per aggiornare la narrazione
      await req(store.put({ storia: state.storia, partita: state, updatedAt: Date.now() }));
      return state;
    });
  }

  async function replace(storia, idAttuale, nuovo) {
    checkStoria(storia);
    if (nuovo.storia !== storia) throw new StoreError('storia', 'Storia diversa');
    return tx('readwrite', async store => {
      const cur = await req(store.get(storia));
      const curId = cur && cur.partita ? cur.partita.id : null;
      if (curId !== idAttuale) throw new StoreError('cambiata', 'Lo slot è cambiato: annullo la sostituzione');
      await req(store.put({ storia, partita: nuovo, updatedAt: Date.now() }));
      return nuovo;
    });
  }

  /* Usato solo dai test e dall'eliminazione dei dati locali. */
  async function clearAll() { return tx('readwrite', store => req(store.clear())); }

  global.RMSoloStore = { STORIE, get, list, create, save, replace, clearAll, StoreError, DB_NAME };
})(typeof window !== 'undefined' ? window : globalThis);
