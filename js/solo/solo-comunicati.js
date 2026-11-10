/* ==========================================================================
   Role Makers — Gioca in solitaria: fatti registrati e fatti comunicati
   (contratto docs/single-player/CONTRATTO_MEMORIA_NARRATORE.md, §3; decisioni D1–D4 approvate il 6/11/2026).

   - REGISTRATO: il motore ha scoperto il fatto (state.fattiScoperti, invariato): vale per le meccaniche.
   - COMUNICATO: il testo finale mostrato al giocatore ne contiene l'informazione. Vale per ciò che il
     protagonista sa: prompt, Diario, lessico bloccato, segreti.
   - Un fatto composto si divide in UNITÀ comunicabili indipendenti (le proposizioni del testo canonico
     separate da «;» o da un punto), senza riscrivere i contenuti: l'unità è un pezzo del testo d'autore.
   - IN ATTESA: registrato in un evento (o da consegnare in un evento) la cui narrazione non è ancora
     agganciata. Conta come noto: il racconto che lo comunica deve poterlo dire.

   state.fattiComunicati = { idFatto: { unita: { "0": { evento, fonte } } } }, monotono: un'unità
   comunicata non torna indietro. Fonti: ia, riserva, fissa, premessa, diario_precedente, senza_evento.
   Tutto deterministico, nessuna chiamata al modello.
   ========================================================================== */
(function (global) {
  'use strict';

  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const radici = t => Array.from(new Set(norm(t).split(/[^a-z]+/).filter(w => w.length >= 5).map(w => w.slice(0, 5))));
  const SOGLIA = 0.6;
  // negazioni e incertezze: la stessa informazione con la polarità o la modalità cambiata non è la stessa informazione.
  // Il discorso riferito («dicono che», «si dice») non è un'incertezza: molti fatti canonici sono notizie riferite.
  const NEG = /(^|[^a-z])(non|mai|nessun[oa]?|niente|nulla)([^a-z]|$)|(^|[^a-zà-ú])né([^a-zà-ú]|$)/;
  const INCERTO = /(^|[^a-z])(forse|chissa|magari|sembr\w*|pare|parev\w*|parrebbe|potrebb\w*|dubb\w*|chied\w* se|domand\w* se|si chied\w*|si domand\w*|vocifer\w*|ipotes\w*|probabil\w*|incert\w*)([^a-z]|$)/;
  const neg = t => NEG.test(norm(t)) || /(^|[^a-zà-ú])né([^a-zà-ú]|$)/i.test(String(t || ''));
  const incerto = t => INCERTO.test(norm(t));

  /* Unità di un testo canonico: proposizioni separate da «;» o da fine frase, fuori dalle virgolette. Un pezzo con meno di
     tre parole piene non sta da solo: si unisce al precedente (o al successivo, se è il primo). */
  const cacheUnita = new Map();
  function unita(testo) {
    const t = String(testo || '').trim();
    if (cacheUnita.has(t)) return cacheUnita.get(t);
    const pezzi = [];
    let cur = '', dentro = 0;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '«') dentro++;
      if (ch === '»') dentro = Math.max(0, dentro - 1);
      cur += ch;
      // fine di un'unità: «;», un a capo, o un punto (anche «.»» / «?»» dopo una citazione) seguito da una nuova frase
      const chiudeCitazione = ch === '»' && /[.!?…]/.test(t[i - 1] || '');
      const fine = !dentro && (ch === ';' || ch === '\n' || ((/[.!?]/.test(ch) || chiudeCitazione) && /\s/.test(t[i + 1] || '') && /[A-ZÀ-Ú«]/.test(t[i + 2] || '')));
      if (fine) { pezzi.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) pezzi.push(cur.trim());
    const out = [];
    pezzi.forEach(p => {
      const pulito = p.replace(/[;]\s*$/, '').trim();
      if (!pulito) return;
      if (out.length && radici(pulito).length < 3) out[out.length - 1] += (/[.!?…»]$/.test(out[out.length - 1]) ? ' ' : '; ') + pulito;
      else out.push(pulito);
    });
    if (out.length > 1 && radici(out[0]).length < 3) out.splice(0, 2, out[0] + (/[.!?…»]$/.test(out[0]) ? ' ' : '; ') + out[1]);
    const r = out.length ? out : [t];
    cacheUnita.set(t, r);
    return r;
  }
  const unitaDi = (content, id) => unita((((content && content.fatti) || {})[id] || {}).testo);
  // senza i contenuti (condizioni della campagna, voce) il numero di unità è quello salvato alla prima marcatura
  const nUnita = (state, content, id) => content && content.fatti && content.fatti[id] ? unitaDi(content, id).length : ((voce(state, id) || {}).n || 1);

  /* L'informazione di un'unità c'è nel testo mostrato? Almeno il 60% delle sue parole piene (tolte quelle del messaggio del giocatore)
     nelle frasi che ne parlano, e la stessa polarità e la stessa modalità: «l'hersir non convoca…» o «forse è morto…» non certificano
     «l'hersir convoca…» né «è morto…», e «è morto» non certifica «si chiede se è morto». Un'unità riportata quasi alla lettera passa sempre.
     shortcut: confronto lessicale, non vede chi fa che cosa («A convoca B» contro «B convoca A»); da rivedere se le misure lo mostrano. */
  function contiene(testoUnita, mostrato, dichiarata) {
    const nu = norm(testoUnita).replace(/[^a-z0-9]+/g, ' ').trim(), nm = ' ' + norm(mostrato).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    if (nu && nm.indexOf(' ' + nu + ' ') !== -1) return true;
    const tutte = radici(testoUnita), detti = new Set(radici(dichiarata));
    let chiave = tutte.filter(w => !detti.has(w));
    if (chiave.length < 2) chiave = tutte;
    if (!chiave.length) return false;
    const K = new Set(chiave);
    const frasi = String(mostrato || '').split(/(?<=[.!?…;:])\s+|\n+/).filter(f => f.trim());
    const minimo = Math.min(2, chiave.length);
    const zona = frasi.filter(f => radici(f).filter(w => K.has(w)).length >= minimo);
    if (!zona.length) return false;
    const presenti = new Set(radici(zona.join(' ')));
    if (chiave.filter(w => presenti.has(w)).length / chiave.length < SOGLIA) return false;
    // polarità e modalità sulle proposizioni che portano l'informazione: nel testo mostrato le più ricche di parole dell'unità, fino a coprirne
    // la soglia (non quelle vicine per caso); nell'unità quelle che contengono le stesse parole. Una domanda è un'incertezza: «Che sia
    // morto?» non certifica «è morto», e certifica «si chiede se è morto».
    const props = pezzi(zona.join('\n'), K).sort((a, b) => b.h.length - a.h.length);
    const scelte = [], coperte = new Set();
    for (const x of props) { if (coperte.size >= SOGLIA * chiave.length) break; if (x.h.some(w => !coperte.has(w))) { scelte.push(x); x.h.forEach(w => coperte.add(w)); } }
    const canone = pezzi(testoUnita, K).filter(x => x.h.some(w => coperte.has(w)));
    const profilo = l => { const z = l.map(x => x.p).join(' . '); return [neg(z), incerto(z) || l.some(x => x.domanda)].join(); };
    return profilo(scelte) === profilo(canone.length ? canone : [{ p: testoUnita, domanda: /\?/.test(testoUnita) }]);
  }
  /* Proposizioni di un testo con le parole dell'insieme K che contengono, e se stanno in una domanda. */
  function pezzi(testo, K) {
    const out = [];
    String(testo || '').split(/(?<=[.!?…;:])\s+|\n+/).filter(f => f.trim()).forEach(f => {
      const domanda = /\?\s*[»"”]?\s*$/.test(f.trim());
      f.split(/[,;:]|\s(?:e|ma|mentre|perché)\s/).forEach(p => { const h = radici(p).filter(w => K.has(w)); if (h.length) out.push({ p, h, domanda }); });
    });
    return out;
  }

  function voce(state, id) { return state && state.fattiComunicati ? state.fattiComunicati[id] : null; }
  function unitaComunicate(state, content, id) {
    const v = voce(state, id);
    return Array.from({ length: nUnita(state, content, id) }, (x, i) => i).filter(i => v && v.unita && v.unita[i]);
  }
  /* Evento che ha registrato il fatto (effetto «scoperta»), o null. */
  function eventoDi(state, id) {
    return (state.eventi || []).find(e => (e.effetti || []).some(a => a.tipo === 'scoperta' && a.fatto === id)) || null;
  }
  const nonPronto = e => !(e.narrazione && e.narrazione.stato === 'pronta');
  /* Il fatto aspetta un racconto non ancora agganciato: l'evento che lo registra o che deve consegnarlo. */
  function inAttesa(state, id) {
    return (state.eventi || []).some(e => nonPronto(e) && ((e.effetti || []).some(a => a.tipo === 'scoperta' && a.fatto === id) || (e.consegna || []).indexOf(id) !== -1));
  }

  /* Stato di un fatto: assente, comunicato, in_attesa, parziale, da_comunicare. Una partita senza fattiComunicati (non ancora migrata,
     o un test del solo motore) si comporta come prima: registrato = noto. Un fatto registrato senza evento (premessa, apertura) è noto. */
  function stato(state, content, id) {
    if (!state || (state.fattiScoperti || []).indexOf(id) === -1) return 'assente';
    if (!state.fattiComunicati) return 'comunicato';
    const n = nUnita(state, content, id), c = unitaComunicate(state, content, id).length;
    if (c >= n) return 'comunicato';
    if (inAttesa(state, id)) return 'in_attesa';
    if (!eventoDi(state, id)) return 'comunicato';
    return c ? 'parziale' : 'da_comunicare';
  }
  /* Il protagonista lo sa per intero (anche se il racconto che lo dice è in arrivo): sblocca lessico e segreti. */
  const noto = (state, content, id) => ['comunicato', 'in_attesa'].indexOf(stato(state, content, id)) !== -1;
  /* Testo di ciò che il protagonista sa del fatto: il testo canonico intero, le sole unità comunicate, o null. */
  function testoNoto(state, content, id) {
    const st = stato(state, content, id), f = (content.fatti || {})[id];
    if (!f) return null;
    if (st === 'comunicato' || st === 'in_attesa') return f.testo;
    if (st === 'parziale') { const u = unitaDi(content, id); return unitaComunicate(state, content, id).map(i => u[i]).join('; ') + '.'; }
    return null;
  }
  /* I fatti noti, nell'ordine di registrazione: [{ id, testo, parziale }]. */
  function noti(state, content) {
    return (state.fattiScoperti || []).map(id => { const t = testoNoto(state, content, id); return t ? { id, testo: t, parziale: stato(state, content, id) === 'parziale' } : null; }).filter(Boolean);
  }
  const testiNoti = (state, content) => noti(state, content).map(x => x.testo);
  const idNoti = (state, content) => (state.fattiScoperti || []).filter(id => noto(state, content, id));
  /* Registrati ma non (del tutto) comunicati: le unità mancanti, l'evento di registrazione e chi le ha dette. */
  function daComunicare(state, content) {
    return (state.fattiScoperti || []).filter(id => ['parziale', 'da_comunicare'].indexOf(stato(state, content, id)) !== -1).map(id => {
      const u = unitaDi(content, id), fatte = unitaComunicate(state, content, id), ev = eventoDi(state, id);
      return { id, unita: u.map((t, i) => ({ i, testo: t })).filter(x => fatte.indexOf(x.i) === -1), evento: ev ? ev.n : null, scena: ev ? ev.scena : null, png: ev ? ev.png || null : null };
    });
  }

  function segna(state, id, i, evento, fonte, n) {
    if (!state.fattiComunicati) state.fattiComunicati = {};
    const v = state.fattiComunicati[id] || (state.fattiComunicati[id] = { n: n || 1, unita: {} });
    if (!v.unita[i]) { v.unita[i] = { evento, fonte }; return true; }
    return false;
  }
  function segnaTutto(state, content, id, evento, fonte) {
    let nuove = false;
    const u = unitaDi(content, id);
    u.forEach((x, i) => { if (segna(state, id, i, evento, fonte, u.length)) nuove = true; });
    return nuove;
  }

  /* Al momento dell'aggancio del testo: per i fatti registrati o da consegnare in questo evento e per quelli ancora da comunicare,
     ogni unità contenuta nel testo finale diventa comunicata. Ritorna [{ id, unita: [i] }] delle unità nuove. */
  /* opz.autore: il testo d'autore dell'evento è arrivato al giocatore (riserva, o riscrittura accettata dai controlli di conservazione del
     post-processo). Allora i fatti REGISTRATI in questo evento sono comunicati: il testo d'autore che il contenuto abbina alla scoperta ne è la
     comunicazione canonica, anche quando lo dice con altre parole (Icaro: 0 fatti su 21 compaiono alla lettera nella prosa del loro esito). */
  function marca(state, content, ev, testo, fonte, opz) {
    if (!state.fattiComunicati) state.fattiComunicati = {};
    const autore = !!(opz && opz.autore);
    const registrati = (ev.effetti || []).filter(a => a.tipo === 'scoperta' && a.fatto).map(a => a.fatto);
    const dich = ev.testoGiocatore || (ev.resoconto && ev.resoconto.azioneDichiarata) || ev.testo || '';
    const candidati = (ev.effetti || []).filter(a => a.tipo === 'scoperta' && a.fatto).map(a => a.fatto).concat(ev.consegna || [])
      .concat(daComunicare(state, content).map(x => x.id)).filter((x, i, a) => a.indexOf(x) === i && (state.fattiScoperti || []).indexOf(x) !== -1);
    const out = [];
    candidati.forEach(id => {
      const nuove = [];
      const tutte = unitaDi(content, id);
      const daAutore = autore && registrati.indexOf(id) !== -1;
      tutte.forEach((u, i) => { if (!(voce(state, id) && voce(state, id).unita[i]) && (daAutore || contiene(u, testo, dich)) && segna(state, id, i, ev.n, fonte, tutte.length)) nuove.push(i); });
      if (nuove.length) out.push({ id, unita: nuove });
    });
    return out;
  }
  /* Testo canonico delle unità comunicate in un evento (per il Diario e per «Appena accaduto»): [{ id, testo, intero }]. */
  function comunicatiInEvento(state, content, n) {
    return Object.keys(state.fattiComunicati || {}).map(id => {
      const u = unitaDi(content, id), v = state.fattiComunicati[id];
      const qui = u.map((t, i) => i).filter(i => v.unita[i] && v.unita[i].evento === n);
      if (!qui.length || !(content.fatti || {})[id]) return null;
      // già tutto comunicato prima di adesso? niente di nuovo da dire
      const intero = qui.length === u.length;
      return { id, testo: intero ? content.fatti[id].testo : qui.map(i => u[i]).join('; ') + '.', intero, fonte: v.unita[qui[0]].fonte };
    }).filter(Boolean).sort((a, b) => (state.fattiScoperti || []).indexOf(a.id) - (state.fattiScoperti || []).indexOf(b.id));
  }

  /* Partita nuova: ciò che il protagonista sa già (conoscenze dell'archetipo, fatti dell'apertura) è comunicato dalla premessa. */
  function iniziali(state, content) {
    state.fattiComunicati = state.fattiComunicati || {};
    (state.fattiScoperti || []).forEach(id => { if (!eventoDi(state, id)) segnaTutto(state, content, id, 0, 'premessa'); });
  }

  /* Salvataggi precedenti al contratto (idempotente; non tocca esiti, tiri, inventario, obiettivi, flag). D4 approvata: le
     informazioni già accessibili restano accessibili. Fatti senza evento: premessa. Eventi con il testo pronto: la verifica sul testo
     salvato; se non passa, il Diario mostrava comunque la voce, quindi fonte «diario_precedente». Eventi senza testo: in attesa. */
  function migra(state, content) {
    if (!state || !content || state.fattiComunicati) return false;
    state.fattiComunicati = {};
    (state.fattiScoperti || []).forEach(id => {
      if (!(content.fatti || {})[id]) return;
      const ev = eventoDi(state, id);
      if (!ev) { segnaTutto(state, content, id, 0, 'premessa'); return; }
      if (nonPronto(ev)) return;
      const t = ev.narrazione.testo || '', dich = ev.testoGiocatore || (ev.resoconto && ev.resoconto.azioneDichiarata) || ev.testo || '';
      const tutte = unitaDi(content, id);
      tutte.forEach((u, i) => segna(state, id, i, ev.n, contiene(u, t, dich) ? (ev.narrazione.fonte || 'ia') : 'diario_precedente', tutte.length));
    });
    return true;
  }

  global.RMSoloComunicati = { SOGLIA, unita, unitaDi, contiene, stato, noto, testoNoto, noti, testiNoti, idNoti, daComunicare, eventoDi, inAttesa, marca, comunicatiInEvento, iniziali, migra, segnaTutto, neg, incerto, radici };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloComunicati;
})(typeof window !== 'undefined' ? window : globalThis);
