/* ==========================================================================
   Role Makers — Gioca in solitaria: segnalare una risposta del Narratore
   (requisito di Google Play per le app con IA generativa; DECISIONI §15,
   punto 8 del 7/11/2026).

   Riusa il sistema di segnalazioni del gioco online: la stessa finestra
   «Segnala» (#ugc-report-modal, openReportModal in js/cloud-account.js),
   le stesse categorie e la stessa funzione del server (submit_report),
   con il tipo `narratore_solo` (migrazione
   20261107120000_report_narratore_solo.sql, applicata nell'ordine della
   decisione 4). Il testo del Narratore esiste solo sul telefono: va nei
   dettagli della segnalazione, con storia, scena e modello.

   Senza rete, senza accesso o prima che il server conosca il tipo, la
   segnalazione resta in coda (localStorage) e parte appena possibile:
   all'avvio, al ritorno della rete, a ogni nuova segnalazione.
   ========================================================================== */
(function (global) {
  'use strict';

  const CHIAVE = 'rm_segnalazioni_narratore_v1';
  const TIPO = 'narratore_solo';
  const MAX_TESTO = 1500;

  function leggi() { try { return JSON.parse(global.localStorage.getItem(CHIAVE) || '[]'); } catch (e) { return []; } }
  function scrivi(coda) { try { global.localStorage.setItem(CHIAVE, JSON.stringify(coda)); } catch (e) { /* spazio pieno: resta in memoria */ } }
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  }
  // dettagli per chi modera: ciò che ha scritto il giocatore, poi il contesto e il testo segnalato
  function dettagli(note, info) {
    const t = String(info.testo || '').slice(0, MAX_TESTO);
    return [String(note || '').trim(), '—', 'Narratore in solitaria · storia: ' + (info.storia || '?') + ' · scena: ' + (info.scena || '?') + ' · modello: ' + (info.modello || '?'), 'Testo: «' + t + '»'].filter(Boolean).join('\n');
  }

  let inVolo = null;
  /* Invia le segnalazioni in coda; quelle che non partono restano. `invia` = submitUgcReport (js/cloud-account.js). */
  function svuota(invia) {
    const send = invia || global.submitUgcReport;
    if (typeof send !== 'function') return Promise.resolve(0);
    if (global.navigator && global.navigator.onLine === false) return Promise.resolve(0);
    if (inVolo) return inVolo;
    inVolo = (async () => {
      let inviate = 0;
      for (const r of leggi()) {
        try { await send(TIPO, r.id, r.categoria, r.dettagli); inviate++; scrivi(leggi().filter(x => x.id !== r.id)); }
        catch (e) { break; } // niente rete, niente accesso o tipo non ancora sul server: si riprova più tardi
      }
      return inviate;
    })().finally(() => { inVolo = null; });
    return inVolo;
  }

  /* Mette in coda e prova subito a inviare. Restituisce true se è già partita. */
  async function registra(categoria, note, info, invia) {
    const r = { id: uuid(), categoria: categoria || 'other', dettagli: dettagli(note, info), creata: Date.now() };
    scrivi(leggi().concat([r]));
    await svuota(invia);
    return !leggi().some(x => x.id === r.id);
  }

  /* Dalla schermata di gioco: apre la finestra «Segnala» del gioco online; l'invio passa dalla coda. */
  function apri(info) {
    const toastFn = typeof global.toast === 'function' ? global.toast : () => {};
    if (typeof global.openReportModal !== 'function') return false;
    global.openReportModal(TIPO, uuid(), 'Segnala questa risposta del Narratore', async (tipo, id, categoria, note) => {
      const partita = await registra(categoria, note, info);
      toastFn(partita ? 'Segnalazione inviata: grazie, verrà esaminata' : 'Segnalazione registrata: partirà appena c\'è connessione');
    });
    return true;
  }

  if (global.addEventListener) global.addEventListener('online', () => { svuota(); });
  // all'avvio, quando lo script del cloud è pronto
  if (global.setTimeout) global.setTimeout(() => { svuota(); }, 5000);

  global.RMSoloSegnalazioni = { apri, registra, svuota, coda: leggi, TIPO, _dettagli: dettagli };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloSegnalazioni;
})(typeof window !== 'undefined' ? window : globalThis);
