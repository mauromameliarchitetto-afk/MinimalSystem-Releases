/* Role Makers — Gioca in solitaria: mappa del PERCORSO (Fase 3).

   Il percorso è la catena delle tappe che la storia prevede (le scene della campagna, raggruppate negli
   atti), con quattro stati:
   - visitata (già attraversata), attuale (dove sei), prossima (la tappa che segue),
   - velata (ancora nascosta: nessun titolo, nessun luogo, niente che anticipi la trama).
   Secondo l'OBIETTIVO scelto (tipo salvato in personaggio.obiettivoPersonale) ogni atto ha un TRAGUARDO
   dell'obiettivo, ancorato a una scena: l'indizio si legge subito (volutamente vago), il titolo solo a
   traguardo raggiunto. I percorsi stanno in js/solo/content/<storia>-percorsi.json (generati da
   scripts/solo-genera-percorsi.js). Un personaggio pronto (senza tipo di obiettivo) vede solo le tappe.

   Regole di non-rivelazione: titolo e luogo di una tappa compaiono solo se è visitata o attuale; la tappa
   «prossima» mostra titolo e luogo solo se il luogo è già noto sulla mappa (conoscenza diversa da
   «sconosciuto»); mai il lessico ancora bloccato (Ich) né i campi riservati. Nessuna modifica allo stato:
   la vista è calcolata da stato e contenuti. Logica pura, testabile in Node. */
(function (global) {
  'use strict';

  /* Tipi di obiettivo salvati prima della lista definitiva dell'autore (2026-10-17) → voce attuale. */
  const ALIAS_OBIETTIVO = {
    dimostrare_cio_che_tutti_negano: 'smascherare_una_menzogna',
    ottenere_di_piu: 'conquistare_una_vita_agiata',
    dare_senso_a_una_perdita: 'capire_cosa_ti_rende_umano'
  };
  const C = () => global.RMSoloCampaign;
  const M = content => (content && content.mappa && content.mappa.formato === 'rm-solo-mappa/1' ? content.mappa : null);
  const P = content => (content && content.percorsi && content.percorsi.formato === 'rm-solo-percorsi/1' ? content.percorsi : null);

  function idObiettivo(tipo) { return ALIAS_OBIETTIVO[tipo] || tipo || null; }

  /* Scene nell'ordine della storia: si segue la prima uscita da quella iniziale, poi le scene rimaste. */
  function catena(content) {
    const per = {};
    (content.scene || []).forEach(s => { per[s.id] = s; });
    const out = [], visti = {};
    let cur = (content.scene || [])[0];
    while (cur && !visti[cur.id]) {
      visti[cur.id] = true; out.push(cur.id);
      const u = (cur.uscite || [])[0];
      cur = u ? per[typeof u === 'string' ? u : (u.verso || u.scena || u.a)] : null;
    }
    (content.scene || []).forEach(s => { if (!visti[s.id]) { visti[s.id] = true; out.push(s.id); } });
    return out;
  }
  function attoDi(content, sceneId) {
    const a = (content.atti || []).find(x => (x.scene || []).indexOf(sceneId) !== -1);
    return a ? a.numero : null;
  }
  function luogoDiScena(content, sceneId) {
    const m = M(content); if (!m) return null;
    const ids = Object.keys(m.luoghi).filter(id => (m.luoghi[id].macroCapitoli || []).indexOf(sceneId) !== -1);
    return ids.length === 1 ? ids[0] : null;
  }
  /* Scene già attraversate: quelle degli eventi, la corrente e tutte le precedenti della catena. */
  function visitate(state, content, ordine) {
    const v = {};
    (state.eventi || []).forEach(e => { if (e.scena) v[e.scena] = true; });
    const i = ordine.indexOf(state.scena);
    if (i !== -1) ordine.slice(0, i + 1).forEach(s => { v[s] = true; });
    return v;
  }

  function vista(state, content) {
    if (!state || !content || !content.scene || !content.scene.length) return null;
    const ordine = catena(content);
    const per = {}; content.scene.forEach(s => { per[s.id] = s; });
    const vis = visitate(state, content, ordine);
    const sm = state.mappa && M(content) ? state.mappa : null;
    const rules = C() ? C().lockedLexicon(state, content) : [];
    const pulito = t => !(C() && C().lexiconHits(t, rules).length);
    const ob = (state.personaggio || {}).obiettivoPersonale || null;
    const id = ob ? idObiettivo(ob.tipo) : null;
    const per_ob = id && P(content) && P(content).obiettivi[id] ? P(content).obiettivi[id] : null;
    const traguardi = {};
    if (per_ob) per_ob.traguardi.forEach(t => { traguardi[t.scena] = t; });
    const ix = ordine.indexOf(state.scena);
    const luogoNoto = sceneId => {
      const lid = luogoDiScena(content, sceneId);
      const c = lid && sm && sm.luoghi[lid] ? sm.luoghi[lid].conoscenza : 'sconosciuto';
      return !!lid && c !== 'sconosciuto' && c !== 'inaccessibile';
    };
    const tappe = ordine.map((sid, i) => {
      const sc = per[sid];
      const stato = sid === state.scena ? 'attuale' : vis[sid] ? 'visitata' : i === ix + 1 ? 'prossima' : 'velata';
      const aperta = stato === 'attuale' || stato === 'visitata';
      const noto = aperta || (stato === 'prossima' && luogoNoto(sid));
      const t = traguardi[sid] || null;
      return {
        scena: sid, indice: i + 1, atto: attoDi(content, sid), stato,
        titolo: noto && pulito(sc.titolo) ? sc.titolo : null,
        luogo: noto && pulito(sc.luogo || '') ? (sc.luogo || null) : null,
        traguardo: t ? { atto: t.atto, stato: aperta ? 'raggiunto' : 'atteso', indizio: t.indizio, titolo: aperta ? t.titolo : null } : null
      };
    });
    const att = tappe.find(t => t.stato === 'attuale') || null;
    const pros = tappe.find(t => t.stato === 'prossima') || null;
    // il titolo di un atto compare solo quando l'atto è cominciato (potrebbe anticipare la trama)
    const atti = (content.atti || []).map(a => {
      const ts = tappe.filter(t => t.atto === a.numero);
      const iniziato = ts.some(t => t.stato === 'visitata' || t.stato === 'attuale');
      return { numero: a.numero, titolo: iniziato && pulito(a.titolo) ? a.titolo : null, iniziato, tappe: ts };
    }).filter(a => a.tappe.length);
    // scene fuori dagli atti (epilogo o prologo): in coda, sotto l'ultimo atto
    const fuori = tappe.filter(t => t.atto == null);
    if (fuori.length && atti.length) atti[atti.length - 1].tappe = atti[atti.length - 1].tappe.concat(fuori);
    return {
      obiettivo: per_ob ? { id, nome: ob.nome || per_ob.nome, dettaglio: ob.dettaglio || '' } : (ob ? { id: null, nome: ob.nome || '', dettaglio: ob.dettaglio || '' } : null),
      atti, posizione: att ? { scena: att.scena, indice: att.indice, atto: att.atto, titolo: att.titolo, luogo: att.luogo } : null,
      prossima: pros ? { scena: pros.scena, indice: pros.indice, atto: pros.atto, titolo: pros.titolo, luogo: pros.luogo, velata: !pros.titolo } : null,
      progresso: { visitate: tappe.filter(t => t.stato === 'visitata' || t.stato === 'attuale').length, totale: tappe.length },
      traguardi: tappe.filter(t => t.traguardo).map(t => Object.assign({ scena: t.scena }, t.traguardo))
    };
  }

  /* Controllo dei dati: ogni tipo di obiettivo ha un traguardo per atto, ancorato a una scena di quell'atto. */
  function valida(percorsi, content, obiettivi, tratti) {
    const e = [];
    if (!percorsi || percorsi.formato !== 'rm-solo-percorsi/1') return ['formato dei percorsi non valido'];
    const sceneIds = (content.scene || []).map(s => s.id);
    (obiettivi || []).forEach(o => {
      const p = percorsi.obiettivi[o.id];
      if (!p) { e.push(o.id + ': percorso mancante'); return; }
      const atti = (content.atti || []).map(a => a.numero);
      if (p.traguardi.length !== atti.length) e.push(o.id + ': ' + p.traguardi.length + ' traguardi invece di ' + atti.length);
      atti.forEach(n => { if (!p.traguardi.some(t => t.atto === n)) e.push(o.id + ': nessun traguardo per l\'atto ' + n); });
      ['raggiunto', 'parziale', 'mancato'].forEach(k => { if (!String((p.epilogo || {})[k] || '').trim()) e.push(o.id + ': epilogo ' + k + ' vuoto'); });
      p.traguardi.forEach(t => {
        if (sceneIds.indexOf(t.scena) === -1) e.push(o.id + ': scena inesistente ' + t.scena);
        else if (attoDi(content, t.scena) !== t.atto) e.push(o.id + ': ' + t.scena + ' non è dell\'atto ' + t.atto);
        // trama guidata (Fase 5): ogni traguardo ha un beat, una prova con tratti validi e tre esiti
        if (t.beat !== undefined || (tratti && tratti.length)) {
          ['beat'].forEach(k => { if (!String(t[k] || '').trim()) e.push(o.id + ': ' + k + ' vuoto'); });
          if (!Array.isArray(t.tratti) || !t.tratti.length) e.push(o.id + ': nessun tratto per la prova');
          else if (tratti) t.tratti.forEach(x => { if (tratti.indexOf(x) === -1) e.push(o.id + ': tratto sconosciuto ' + x); });
          if (!(t.nc >= 10 && t.nc <= 16)) e.push(o.id + ': NC fuori da 10-16');
          ['pieno', 'parziale', 'mancato'].forEach(k => { if (!String((t.esiti || {})[k] || '').trim()) e.push(o.id + ': esito ' + k + ' vuoto'); });
        }
        ['titolo', 'indizio'].forEach(k => { if (!String(t[k] || '').trim()) e.push(o.id + ': ' + k + ' vuoto'); else if (/\bMANCA\b/.test(t[k])) e.push(o.id + ': ' + k + ' non completato'); });
      });
    });
    return e;
  }

  global.RMSoloPercorso = { ALIAS_OBIETTIVO, idObiettivo, catena, vista, valida };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloPercorso;
})(typeof window !== 'undefined' ? window : globalThis);
