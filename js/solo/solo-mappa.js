/* ==========================================================================
   Role Makers — Gioca in solitaria: mappa, luoghi e viaggi
   --------------------------------------------------------------------------
   Separazioni (richiesta dell'autore):
   - mappa CANONICA della storia: content.mappa (<storia>-mappa.json), sola
     lettura, uguale per ogni partita;
   - stato PERSONALE della mappa nella partita: state.mappa (posizione,
     conoscenze, rotte scoperte, viaggio, trasformazioni dei luoghi);
   - la mappa condivisa delle campagne di gruppo (story_map_2d_v1, tabelle
     campaign_maps su Supabase) non viene mai letta né scritta da qui: se ne
     riusa solo il disegno (Leaflet CRS.Simple, coordinate normalizzate,
     pin dei luoghi) nell'interfaccia.

   Il motore decide partenza, destinazione, percorso, modalità, distanza,
   durata, requisiti, costo, compagni, rischi, tappe e condizioni d'arrivo.
   Il Narratore li racconta senza cambiarli. Nessuna distanza viene
   calcolata dai marker se la mappa non ha una scala; nessuna durata
   numerica senza un dato approvato.
   ========================================================================== */
(function (global) {
  'use strict';

  const VERSIONE = 1;
  const CONOSCENZE = ['sconosciuto', 'sentito_dire', 'approssimativo', 'localizzato', 'visitato', 'modificato', 'inaccessibile'];
  const RANGO = { sconosciuto: 0, sentito_dire: 1, approssimativo: 2, localizzato: 3, visitato: 4, modificato: 4, inaccessibile: 4 };
  const DISPONIBILITA = ['disponibile', 'rischiosa', 'bloccata', 'sconosciuta', 'irraggiungibile', 'condizionata'];
  const FUNZIONI_VIAGGIO = ['dialogo', 'relazione', 'conflitto_compagni', 'promessa', 'confessione', 'confronto_tematico', 'preparazione', 'recupero', 'osservazione', 'scoperta', 'decisione_itinerario', 'conseguenza', 'arco_personale', 'riflessione'];
  const E = () => global.RMSoloEngine;
  const O = () => global.RMSoloOntologia;
  const C = () => global.RMSoloCampaign;

  function M(content) { return content && content.mappa && content.mappa.formato === 'rm-solo-mappa/1' ? content.mappa : null; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function luogoDiScena(content, sceneId) {
    const m = M(content); if (!m) return null;
    const ids = Object.keys(m.luoghi).filter(id => (m.luoghi[id].macroCapitoli || []).indexOf(sceneId) !== -1);
    return ids.length === 1 ? ids[0] : null; // solo corrispondenza univoca
  }

  /* ------------------------------------------------ stato della partita */
  function vuoto(content) {
    const m = M(content);
    const luoghi = {};
    Object.values(m.luoghi).forEach(l => { if (l.conoscenzaIniziale && l.conoscenzaIniziale !== 'sconosciuto') luoghi[l.id] = { conoscenza: l.conoscenzaIniziale, fonte: 'iniziale', trasformazioni: [] }; });
    return { versione: VERSIONE, mappaId: m.id, posizione: null, posizioneDaDeterminare: false, luoghi, rotteScoperte: [], destinazione: null, viaggio: null, tratteCompletate: [], storicoViaggi: [], sceneViaggioUsate: [], mezzi: [] };
  }
  /* Migrazione idempotente: una vecchia partita senza mappa riceve lo stato
     iniziale; la posizione si ricava dalla scena corrente solo se il luogo
     corrisponde in modo univoco, altrimenti resta da determinare. */
  function migra(state, content) {
    if (!M(content) || !state) return state;
    if (state.mappa && state.mappa.versione === VERSIONE) return state;
    const sm = vuoto(content);
    const id = luogoDiScena(content, state.scena);
    if (id) { sm.posizione = id; conosci(sm, id, 'visitato', 'migrazione'); } else sm.posizioneDaDeterminare = true;
    // luoghi delle scene già attraversate: visitati (dagli eventi salvati, mai inventati)
    Array.from(new Set((state.eventi || []).map(e => e.scena))).forEach(s => { const l = luogoDiScena(content, s); if (l) conosci(sm, l, 'visitato', 'migrazione'); });
    state.mappa = sm;
    return state;
  }
  function inizia(state, content) { if (M(content)) { delete state.mappa; migra(state, content); } return state; }
  function conosci(sm, id, livello, fonte) {
    const cur = sm.luoghi[id];
    if (cur && cur.conoscenza === 'inaccessibile') return;
    if (!cur) sm.luoghi[id] = { conoscenza: livello, fonte, trasformazioni: [] };
    else if (RANGO[livello] > RANGO[cur.conoscenza] || (livello === 'modificato' || livello === 'inaccessibile')) { cur.conoscenza = livello; cur.fonte = fonte; }
  }
  /* Una voce non verificata aggiunge solo un'indicazione approssimativa,
     mai una posizione certa. */
  function voce(state, content, id, fonte) {
    const sm = state.mappa; if (!sm || !M(content).luoghi[id]) return;
    const cur = sm.luoghi[id];
    if (!cur || RANGO[cur.conoscenza] < RANGO.approssimativo) conosci(sm, id, cur && cur.conoscenza === 'sentito_dire' ? 'approssimativo' : 'sentito_dire', fonte || 'voce');
  }
  // trasformazione di un luogo in QUESTA partita (il canone resta intatto)
  function trasforma(state, id, testo, evN) {
    const sm = state.mappa; if (!sm) return;
    conosci(sm, id, 'modificato', 'partita');
    sm.luoghi[id].trasformazioni.push({ testo, evento: evN });
  }

  /* ------------------------------------------------ vista del giocatore
     Solo luoghi conosciuti, rotte scoperte e informazioni pubbliche. Mai
     descrizioni riservate, luoghi futuri, nomi riservati o spoiler (Ich:
     anche il lessico ancora bloccato). */
  function nomeVisibile(state, content, l) {
    if (l.rivelazione && (state.fattiScoperti || []).indexOf(l.rivelazione) === -1) return false;
    const locked = C() ? C().lockedLexicon(state, content) : [];
    return !(C() && C().lexiconHits(l.nome + ' ' + (l.descrizionePubblica || ''), locked).length);
  }
  function rotteNote(state, content) {
    const m = M(content), sm = state.mappa;
    return m.collegamenti.filter(k => sm.rotteScoperte.indexOf(k.id) !== -1 || (k.conoscenzaIniziale && k.conoscenzaIniziale !== 'sconosciuto'));
  }
  /* Punto sulla mappa di un luogo senza coordinate proprie: quello del luogo
     vicino (`vicinoA`) o della regione che lo contiene, risalendo. Sempre
     marcato come approssimativo. */
  function coordinateApprossimate(m, id) {
    const visti = new Set();
    let l = m.luoghi[id];
    while (l && !visti.has(l.id)) {
      visti.add(l.id);
      if (l.coordinate && l.id !== id) return l.coordinate;
      const su = l.vicinoA || l.regione;
      l = su ? m.luoghi[su] : null;
    }
    return null;
  }
  // il luogo stesso e i luoghi che lo contengono (stanza → insediamento → regione)
  function antenati(m, id) {
    const out = [], visti = new Set();
    let l = m.luoghi[id];
    while (l && !visti.has(l.id)) { visti.add(l.id); out.push(l.id); l = l.regione ? m.luoghi[l.regione] : null; }
    return out;
  }
  function vista(state, content) {
    const m = M(content), sm = state.mappa;
    if (!m || !sm) return null;
    const noti = Object.entries(sm.luoghi).filter(([id, x]) => x.conoscenza !== 'sconosciuto' && m.luoghi[id] && nomeVisibile(state, content, m.luoghi[id]));
    const luoghi = noti.map(([id, x]) => {
      const l = m.luoghi[id];
      // un luogo visitato senza punto proprio (stanza, insediamento del copione) è segnato in modo approssimato
      const proprie = l.coordinate && RANGO[x.conoscenza] >= RANGO.localizzato ? l.coordinate : null;
      const appr = !proprie && (RANGO[x.conoscenza] >= RANGO.visitato || id === sm.posizione) ? coordinateApprossimate(m, id) : null;
      const coord = proprie || appr;
      return { id, nome: l.nome, tipo: l.tipo, regione: l.regione && m.luoghi[l.regione] && sm.luoghi[l.regione] ? m.luoghi[l.regione].nome : null,
        descrizione: l.descrizionePubblica || null, conoscenza: x.conoscenza, coordinate: coord, approssimativo: x.conoscenza === 'approssimativo' || !!appr, simbolo: l.simboloMappa || null,
        pericoli: RANGO[x.conoscenza] >= RANGO.visitato ? l.pericoli.slice() : [], requisiti: l.requisiti.slice(), trasformazioni: x.trasformazioni.map(t => t.testo) };
    });
    const ids = new Set(luoghi.map(l => l.id));
    return {
      mappaId: m.id, immagine: m.immagine, dimensioni: m.dimensioni, disponibile: !!m.immagine, statoMappa: m.statoMappa,
      posizione: sm.posizione && ids.has(sm.posizione) ? sm.posizione : null, posizioneDaDeterminare: sm.posizioneDaDeterminare,
      luoghi, rotte: rotteNote(state, content).filter(k => ids.has(k.origine) && ids.has(k.destinazione)).map(k => ({ id: k.id, da: k.origine, a: k.destinazione, tipo: k.tipo, durata: k.durata, distanza: k.distanza })),
      viaggio: sm.viaggio ? { destinazione: sm.viaggio.destinazione, stato: sm.viaggio.stato } : null
    };
  }

  /* ------------------------------------------------ destinazioni */
  function risolviDestinazione(state, content, ref) {
    const v = vista(state, content); if (!v) return null;
    const r = norm(ref);
    if (!r) return null;
    const m = M(content);
    const nomi = l => [l.nome].concat((m.luoghi[l.id] && m.luoghi[l.id].alias) || []).map(norm);
    const hit = v.luoghi.find(l => l.id === ref) || v.luoghi.find(l => nomi(l).indexOf(r) !== -1) || v.luoghi.find(l => nomi(l).some(n => n.length >= 3 && r.indexOf(n) !== -1));
    return hit ? hit.id : null;
  }
  const RE_VIAGGIO = /\b(vado|andiamo|raggiungo|raggiungere|torno|tornare|mi dirigo|dirigermi|viaggio|viaggiare|parto per|partire per|mi sposto|spostarmi)\b\s+(a|ad|al|allo|alla|ai|agli|alle|verso|fino a|per|in)\b\s*(.+)/i;
  function intenzioneDiViaggio(testo) { const m = RE_VIAGGIO.exec(String(testo || '')); return m ? m[3].replace(/[.!?]+$/, '').trim() : null; }

  /* Mezzi del personaggio: dotazione, inventario, mezzi ottenuti in partita. */
  function portati(state, content) {
    const pg = state.personaggio || {};
    const t = (pg.equip || []).map(x => x.nome + ' ' + (x.id || ''));
    (state.inventario || []).forEach(i => { const d = E() && E().itemInfo ? E().itemInfo(state, content, i.id) : null; if (d) t.push(d.nome + ' ' + (d.proprieta || []).join(' ')); });
    return t.concat((state.mappa && state.mappa.mezzi) || []).join(' | ').toLowerCase();
  }
  /* Requisiti di una tratta: marittima (porto o costa alle due estremità
     e un mezzo), esterna di Icaro (protezione sigillata, eventuale mezzo e
     autonomia), requisiti dichiarati nei dati. */
  function requisitiTratta(state, content, k) {
    const m = M(content);
    const da = m.luoghi[k.origine], a = m.luoghi[k.destinazione];
    const mancanti = [];
    const ha = s => portati(state, content).indexOf(String(s).toLowerCase()) !== -1;
    if (k.tipo === 'marittimo' || k.tipo === 'costiero') {
      const approdo = l => (l.accessi || []).some(x => x === 'porto' || x === 'costa' || x === 'approdo');
      if (!approdo(da) || !approdo(a)) mancanti.push('un accesso al mare (porto o costa) a entrambe le estremità');
      const mezzi = k.mezzi || k.modalita || [];
      if (!k.mezzoFornito && !mezzi.some(ha)) mancanti.push('un\'imbarcazione (' + (mezzi.join(', ') || 'mezzo non indicato') + ')');
    }
    if (k.ambiente === 'esterno' || a.condizioniAmbientali === 'esterno') {
      if (O()) {
        const R = O().reg(content.storia) || {};
        (R.esterno ? R.esterno.protezione : []).forEach(p => { if (!p.re.test(portati(state, content))) mancanti.push(p.nome); });
      }
      if (k.mezzoRichiesto && !ha(k.mezzoRichiesto)) mancanti.push(k.mezzoRichiesto);
      if (k.autonomiaRichiesta && !ha('autonomia')) mancanti.push('autonomia per ' + k.autonomiaRichiesta);
    }
    (k.requisiti || []).forEach(r => { if (!(k.ambiente === 'esterno') && !ha(r)) mancanti.push(r); });
    return Array.from(new Set(mancanti));
  }
  function durataInGiorni(d) { if (!d || !Number.isFinite(d.valore)) return null; return d.unita === 'ore' ? d.valore / 24 : d.unita === 'giorni' ? d.valore : null; }
  function compagni(state, content) {
    const sc = E().sceneOf(content, state.scena) || {};
    // accompagnatori: solo PNG presenti qui, vivi e legati al protagonista (alleato o compagno)
    const r = (state.campagna && state.campagna.png) || {};
    return (sc.png_presenti || []).filter(id => r[id] && r[id].stato === 'vivo' && ['alleato', 'compagno'].indexOf(r[id].legame) !== -1);
  }

  /* Pianifica: il motore cerca un itinerario sulle sole rotte conosciute e
     accessibili (il Regista interpreta, il validatore verifica). Ritorna
     un piano o un rifiuto con la causa diegetica. */
  function pianifica(state, content, destRef) {
    const m = M(content), sm = state.mappa;
    if (!m || !sm) return { ok: false, tipo: 'irraggiungibile', motivo: 'Non c\'è una mappa per questa storia.' };
    const dest = risolviDestinazione(state, content, destRef);
    if (!dest) return { ok: false, tipo: 'sconosciuta', motivo: 'Non conosci un luogo con questo nome.' };
    if (!sm.posizione) return { ok: false, tipo: 'irraggiungibile', motivo: 'Non sai con certezza dove ti trovi.' };
    if (dest === sm.posizione) return { ok: false, tipo: 'irraggiungibile', motivo: 'Sei già qui.' };
    if ((sm.luoghi[dest] || {}).conoscenza === 'inaccessibile') return { ok: false, tipo: 'bloccata', motivo: 'Quel luogo non è più raggiungibile.' };
    if (m.luoghi[dest].maiLocalizzabile || RANGO[(sm.luoghi[dest] || {}).conoscenza] < RANGO.approssimativo) return { ok: false, tipo: 'irraggiungibile', motivo: 'Sai che esiste, ma non sai come arrivarci.' };
    // ricerca in ampiezza sulle rotte note (entrambe le direzioni se dichiarato)
    const rotte = rotteNote(state, content);
    const adiac = {};
    rotte.forEach(k => { (adiac[k.origine] = adiac[k.origine] || []).push({ k, a: k.destinazione }); if (k.direzione !== 'andata') (adiac[k.destinazione] = adiac[k.destinazione] || []).push({ k, a: k.origine }); });
    // si parte dal luogo in cui sei o da ciò che lo contiene (una stanza esce dal suo insediamento)
    const partenze = antenati(m, sm.posizione);
    if (partenze.indexOf(dest) !== -1) return { ok: false, tipo: 'irraggiungibile', motivo: 'Sei già qui.' };
    const prev = {}; const coda = partenze.slice(); const visti = new Set(coda);
    while (coda.length) { const x = coda.shift(); if (x === dest) break; (adiac[x] || []).forEach(({ k, a }) => { if (!visti.has(a)) { visti.add(a); prev[a] = { da: x, k }; coda.push(a); } }); }
    if (!prev[dest]) return { ok: false, tipo: 'irraggiungibile', motivo: 'Non conosci una strada per arrivarci.' };
    const tratte = [];
    for (let x = dest; partenze.indexOf(x) === -1; x = prev[x].da) tratte.unshift({ k: prev[x].k, da: prev[x].da, a: x });
    const out = tratte.map(({ k, da, a }) => {
      const bloc = k.accessibilita === 'bloccato' ? (k.causaBlocco || 'la strada è interrotta') : null;
      return { collegamento: k.id, da, a, tipo: k.tipo, modalita: (k.modalita || []).slice(), distanza: k.distanza || null, durata: k.durata || null,
        requisiti: requisitiTratta(state, content, k), rischio: k.rischio || null, costo: k.costo || null, intermedi: (k.intermedi || []).slice(), bloccata: bloc, fonte: k.fonte,
        paesaggio: (k.paesaggio || []).slice() };
    });
    const bloccata = out.find(t => t.bloccata);
    if (bloccata) return { ok: false, tipo: 'bloccata', motivo: 'Temporaneamente bloccata: ' + bloccata.bloccata + '.', tratte: out };
    const req = Array.from(new Set(out.flatMap(t => t.requisiti)));
    const giorni = out.map(t => durataInGiorni(t.durata));
    const durata = giorni.every(g => g != null) ? { valore: giorni.reduce((a, b) => a + b, 0), unita: 'giorni' } : null;
    const piano = {
      ok: !req.length, tipo: req.length ? (out.some(t => t.tipo === 'esterno_protetto') ? 'preparazione' : 'condizionata') : out.some(t => t.rischio) ? 'rischiosa' : 'disponibile',
      partenza: sm.posizione, destinazione: dest, tratte: out, modalita: Array.from(new Set(out.flatMap(t => t.modalita))),
      distanza: out.every(t => t.distanza && Number.isFinite(t.distanza.valore)) ? { valore: out.reduce((a, t) => a + t.distanza.valore, 0), unita: out[0].distanza.unita } : null,
      durata, durataIncompleta: !durata, requisitiMancanti: req, costo: out.map(t => t.costo).filter(Boolean), rischi: out.map(t => t.rischio).filter(Boolean),
      tappe: out.slice(0, -1).map(t => t.a), compagni: compagni(state, content), condizioniArrivo: (M(content).luoghi[dest].requisiti || []).slice(),
      misto: new Set(out.map(t => t.tipo)).size > 1
    };
    if (req.length) piano.motivo = (piano.tipo === 'preparazione' ? 'Prima di partire devi prepararti: servono ' : 'Per partire servono ') + req.join(', ').replace(/, ([^,]*)$/, ' e $1') + '.';
    return piano;
  }

  /* ------------------------------------------------ scene e incontri di viaggio
     Solo con una funzione narrativa e una fonte reale; mai per allungare.
     Si inseriscono (una o due) solo per un viaggio lungo, oltre la soglia
     configurata `longJourneyThresholdDays` (null = nessuna soglia scelta:
     nessuna scena intermedia). */
  function limiteSceneViaggio(content, piano) {
    const m = M(content);
    const giorni = durataInGiorni(piano && piano.durata);
    const soglia = m && m.viaggi && m.viaggi.longJourneyThresholdDays;
    if (!Number.isFinite(soglia) || giorni == null || giorni <= 3 || giorni <= soglia) return 0;
    const configurato = m.viaggi.maxSceneViaggio;
    const massimo = Number.isFinite(configurato) ? Math.max(0, Math.floor(configurato)) : 2;
    return Math.min(giorni < 8 ? 1 : 2, massimo);
  }
  function sceneDiViaggio(state, content, piano) {
    const m = M(content);
    const limite = limiteSceneViaggio(content, piano);
    if (!limite) return [];
    const usate = new Set(state.mappa.sceneViaggioUsate || []);
    const c = state.campagna || { secondari: [], arco: [] };
    const IM = global.RMSoloImprov;
    const fili = IM ? IM.memoria(state).fili.filter(f => f.stato === 'aperto') : [];
    const cand = [];
    piano.compagni.forEach(id => cand.push({ funzione: 'relazione', png: [id], fonte: 'png:' + id }));
    (c.secondari || []).filter(x => x.stato === 'aperto' || x.stato === 'tornato').forEach(x => cand.push({ funzione: x.categoria === 'promessa' ? 'promessa' : 'conseguenza', png: [], fonte: 'secondario:' + x.id }));
    (state.conseguenze || []).filter(x => x.stato === 'pendente').forEach(x => cand.push({ funzione: 'conseguenza', png: [], fonte: 'conseguenza:' + x.id }));
    fili.forEach(f => cand.push({ funzione: 'riflessione', png: [], fonte: 'filo:' + f.id }));
    const arco = global.RMSoloStruttura && state.campagna && (content.struttura || {}).archi && (content.struttura.archi[state.personaggio.archetipo]);
    if (arco && !(c.arco || []).some(e => e.atto === (state.atto || 1))) cand.push({ funzione: 'arco_personale', png: [], fonte: 'arco' });
    (piano.tratte || []).filter(t => t.rischio).forEach(t => cand.push({ funzione: 'osservazione', png: [], fonte: 'rotta:' + t.collegamento, rischio: t.rischio }));
    // un viaggio lungo ha sempre un momento raccontato: il paesaggio della tratta più lunga, poi la strada stessa
    const lunga = (piano.tratte || []).filter(t => (t.paesaggio || []).length).sort((a, b) => (durataInGiorni(b.durata) || 0) - (durataInGiorni(a.durata) || 0))[0];
    if (lunga) cand.push({ funzione: 'scoperta', png: [], fonte: 'paesaggio:' + lunga.collegamento, paesaggio: lunga.paesaggio.slice(), tratta: lunga.collegamento });
    cand.push({ funzione: 'riflessione', png: [], fonte: 'viaggio:' + piano.partenza + '>' + piano.destinazione + ':' + (state.mappa.storicoViaggi || []).length });
    const scelte = [];
    cand.forEach(x => { const firma = x.funzione + '|' + x.fonte; if (scelte.length < limite && !usate.has(firma) && !scelte.some(s => s.firma === firma) && !scelte.some(s => s.funzione === x.funzione)) scelte.push(Object.assign({ firma }, x)); });
    return scelte;
  }
  function validaSceneViaggio(state, content, piano, scene) {
    const e = [];
    (scene || []).forEach(s => {
      if (FUNZIONI_VIAGGIO.indexOf(s.funzione) === -1) e.push('funzione non ammessa: ' + s.funzione);
      (s.png || []).forEach(p => { if (piano.compagni.indexOf(p) === -1) e.push('PNG non presente nel viaggio: ' + p); });
      if (!s.fonte) e.push('scena di viaggio senza fonte');
    });
    if ((scene || []).length > limiteSceneViaggio(content, piano)) e.push('troppe scene per la durata del viaggio');
    return e;
  }

  /* ------------------------------------------------ racconto del viaggio
     Testi di riserva nella voce della storia (content.mappa.testiViaggio):
     partenza con mezzo e durata, paesaggio, momenti del viaggio, arrivo.
     Lo stesso materiale va al Narratore come contesto (ev.viaggioContesto). */
  function durataLeggibile(d) {
    if (!d || !Number.isFinite(d.valore)) return null;
    // sotto i due giorni si contano le ore (treni di Icaro, tratti brevi)
    const ore = d.unita === 'ore' ? d.valore : d.valore < 2 && d.valore % 1 ? d.valore * 24 : null;
    if (ore != null) { const o = Math.max(1, Math.round(ore)); return o + (o === 1 ? ' ora' : ' ore'); }
    const intero = Math.floor(d.valore), mezzo = Math.abs(d.valore - intero - 0.5) < 0.25;
    if (mezzo) return intero + (intero === 1 ? ' giorno' : ' giorni') + ' e mezzo';
    const v = Math.round(d.valore);
    return v + (v === 1 ? ' giorno' : ' giorni');
  }
  function modoLeggibile(tratte) {
    const t = tratte[0] || {};
    if (t.tipo === 'marittimo') return 'per mare';
    if (t.tipo === 'collegamento_protetto') return 'di treno a sospensione magnetica';
    const mm = (t.modalita || []).filter(x => x !== 'a piedi');
    return mm.length ? 'in ' + mm[0] + ' o a piedi' : 'a piedi';
  }
  function compila(tpl, dati) { return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => dati[k] != null ? dati[k] : ''); }
  function nomeLuogo(content, id) { const l = M(content).luoghi[id]; return l ? l.nome : id; }
  function testiPartenza(state, content, piano, scene) {
    const T = M(content).testiViaggio || {};
    const out = [];
    const dati = { da: nomeLuogo(content, (piano.tratte[0] || {}).da || piano.partenza), a: nomeLuogo(content, piano.destinazione), modo: modoLeggibile(piano.tratte), durata: durataLeggibile(piano.durata) || 'un tratto' };
    if (T.partenza) out.push(compila(T.partenza, dati));
    if (piano.tappe.length && T.tappe) out.push(compila(T.tappe, { tappe: piano.tappe.map(id => nomeLuogo(content, id)).join(', ').replace(/, ([^,]*)$/, ' e $1') }));
    const primo = (piano.tratte[0] || {}).paesaggio || [];
    if (primo.length && !scene.some(sc => sc.funzione === 'scoperta')) out.push(primo[0]);
    return out;
  }
  function testoScena(state, content, s) {
    const T = M(content).testiViaggio || {};
    if (s.rischio) return T.rischio || '';
    if (s.funzione === 'scoperta' && s.paesaggio) return s.paesaggio.join(' ');
    if (s.funzione === 'relazione') return compila(T.relazione, { png: s.png.map(id => ((content.png || {})[id] || {}).nome || id).join(' e ') });
    return T[s.funzione] || T.riflessione || '';
  }
  function testoArrivo(state, content, v) {
    const T = M(content).testiViaggio || {};
    const d = durataLeggibile(v.durataTrascorsa || v.durataPrevista);
    const dest = M(content).luoghi[v.destinazione];
    return [compila(d ? T.arrivo : T.arrivoBreve, { a: nomeLuogo(content, v.destinazione), durata: d }), dest && dest.descrizionePubblica ? dest.descrizionePubblica : null].filter(Boolean);
  }
  function contesto(ev, campi) { ev.viaggioContesto = Object.assign(ev.viaggioContesto || {}, campi); ev.viaggioTesti = (ev.viaggioTesti || []).concat(campi.testi || []); }
  // testo di riserva (motore) e blocco di contesto (Narratore) per un evento di viaggio
  function raccontoRiserva(ev) { return (ev.viaggioTesti || []).filter(Boolean).join('\n\n'); }
  function contestoNarratore(ev) {
    const c = ev.viaggioContesto; if (!c) return '';
    const r = ['VIAGGIO (il motore ha deciso percorso, durata e momenti: raccontali senza cambiarli; uno spostamento lungo merita dettagli sensoriali, fatica e tempo che passa)'];
    if (c.da) r.push('Partenza: ' + c.da + ' → destinazione: ' + c.a + (c.durata ? ' · durata prevista: ' + c.durata : '') + (c.modo ? ' · mezzo: ' + c.modo : ''));
    if (c.tappe && c.tappe.length) r.push('Tappe: ' + c.tappe.join(', '));
    if (c.paesaggio && c.paesaggio.length) r.push('Paesaggio: ' + c.paesaggio.join(' '));
    if (c.momento) r.push('Momento del viaggio (' + c.momento.funzione + '): ' + c.momento.testo);
    if (c.arrivo) r.push('Arrivo: ' + c.arrivo);
    return r.join('\n');
  }

  /* ------------------------------------------------ comandi (dal motore) */
  function avvia(state, content, cmd, applied, ev) {
    const sm = state.mappa;
    if (!sm) throw new Error('Nessuna mappa');
    if (sm.viaggio && sm.viaggio.stato === 'in_corso') return { rifiuto: 'Sei già in viaggio.' };
    const piano = pianifica(state, content, cmd.destinazione);
    if (!piano.ok) return { rifiuto: piano.motivo, tipo: piano.tipo, piano };
    const scene = sceneDiViaggio(state, content, piano);
    const err = validaSceneViaggio(state, content, piano, scene);
    if (err.length) return { rifiuto: 'Viaggio non valido: ' + err.join('; ') };
    sm.destinazione = piano.destinazione;
    sm.viaggio = {
      id: 'v' + (sm.storicoViaggi.length + 1), stato: 'in_corso', partenza: piano.partenza, destinazione: piano.destinazione, tratte: piano.tratte,
      partitoEvento: ev.n, durataPrevista: piano.durata, durataTrascorsa: piano.durata ? { valore: 0, unita: 'giorni' } : null,
      soste: [], ritardi: [], deviazioni: [], risorseConsumate: [], condizioni: piano.rischi.slice(), compagni: piano.compagni,
      sceneDaVivere: scene, sceneVissute: [], tratteCompletate: []
    };
    applied.push({ tipo: 'viaggio_partenza', da: piano.partenza, a: piano.destinazione, tratte: piano.tratte.length, durata: piano.durata });
    contesto(ev, { da: nomeLuogo(content, (piano.tratte[0] || {}).da || piano.partenza), a: nomeLuogo(content, piano.destinazione), durata: durataLeggibile(piano.durata), modo: modoLeggibile(piano.tratte),
      tappe: piano.tappe.map(id => nomeLuogo(content, id)), paesaggio: Array.from(new Set(piano.tratte.flatMap(t => t.paesaggio || []))), testi: testiPartenza(state, content, piano, scene) });
    if (!scene.length) arriva(state, content, applied, ev);
    return { piano };
  }
  // una scena o un incontro del viaggio; l'ultima porta all'arrivo
  function prosegui(state, content, applied, ev) {
    const sm = state.mappa, v = sm && sm.viaggio;
    if (!v || v.stato !== 'in_corso') return { rifiuto: 'Non sei in viaggio.' };
    const s = v.sceneDaVivere.shift();
    if (s) {
      v.sceneVissute.push(s);
      sm.sceneViaggioUsate.push(s.firma);
      applied.push({ tipo: 'scena_viaggio', funzione: s.funzione, png: s.png, fonte: s.fonte });
      // un incontro nasce solo da un rischio dichiarato della rotta: ritardo registrato con il dato, se c'è
      if (s.rischio) {
        const r = s.rischio.ritardo && Number.isFinite(s.rischio.ritardo.valore) ? s.rischio.ritardo : null;
        v.ritardi.push({ causa: s.rischio.causa || s.fonte, durata: r, evento: ev.n });
        applied.push({ tipo: 'viaggio_ritardo', causa: s.rischio.causa || s.fonte, durata: r });
      }
      ev.scenaViaggio = s;
      const t = testoScena(state, content, s);
      contesto(ev, { a: nomeLuogo(content, v.destinazione), momento: { funzione: s.funzione, testo: t }, testi: [t] });
      if (!v.sceneDaVivere.length) arriva(state, content, applied, ev);
      return { scena: s };
    }
    arriva(state, content, applied, ev);
    return {};
  }
  function arriva(state, content, applied, ev) {
    const sm = state.mappa, v = sm.viaggio;
    v.tratte.forEach(t => { v.tratteCompletate.push(t.collegamento); if (sm.tratteCompletate.indexOf(t.collegamento) === -1) sm.tratteCompletate.push(t.collegamento); if (sm.rotteScoperte.indexOf(t.collegamento) === -1) sm.rotteScoperte.push(t.collegamento); conosci(sm, t.a, 'visitato', 'viaggio'); });
    if (v.durataPrevista) {
      const rit = v.ritardi.map(r => r.durata ? (r.durata.unita === 'ore' ? r.durata.valore / 24 : r.durata.valore) : 0).reduce((a, b) => a + b, 0);
      v.durataTrascorsa = { valore: v.durataPrevista.valore + rit, unita: 'giorni' };
    }
    v.stato = 'arrivato'; v.arrivoEvento = ev.n;
    sm.posizione = v.destinazione; sm.posizioneDaDeterminare = false; sm.destinazione = null;
    sm.storicoViaggi.push(clone(v));
    sm.viaggio = null;
    applied.push({ tipo: 'viaggio_arrivo', a: v.destinazione, durata: v.durataTrascorsa, ritardi: v.ritardi.length });
    if (ev) { const t = testoArrivo(state, content, v); contesto(ev, { arrivo: t.join(' '), testi: t }); }
  }
  /* Dopo ogni comando: il cambio di macro-capitolo è uno spostamento sulla
     rotta del copione (scoperta, posizione, visita); i cambiamenti
     d'ambiente della scena diventano trasformazioni del luogo in questa
     partita. */
  function dopoComando(before, state, content, ev, applied) {
    const sm = state.mappa; if (!sm || !M(content)) return;
    if (before.scena !== state.scena) {
      const da = luogoDiScena(content, before.scena), a = luogoDiScena(content, state.scena);
      if (a) {
        const k = da && M(content).collegamenti.find(x => (x.origine === da && x.destinazione === a) || (x.origine === a && x.destinazione === da));
        if (k && sm.rotteScoperte.indexOf(k.id) === -1) sm.rotteScoperte.push(k.id);
        if (k && sm.tratteCompletate.indexOf(k.id) === -1) sm.tratteCompletate.push(k.id);
        sm.posizione = a; sm.posizioneDaDeterminare = false;
        conosci(sm, a, 'visitato', 'scena ' + state.scena);
        const ins = M(content).luoghi[a].regione; if (ins && M(content).luoghi[ins]) conosci(sm, ins, 'visitato', 'scena ' + state.scena);
        if (applied) applied.push({ tipo: 'mappa_spostamento', da, a, collegamento: k ? k.id : null, durata: k ? k.durata : null });
      }
    }
    (ev.effetti || []).filter(x => x.tipo === 'svolta' || (x.tipo === 'nota' && x.categoria === 'cambiamento')).forEach(x => { const id = luogoDiScena(content, state.scena); if (id) trasforma(state, id, x.testo, ev.n); });
  }

  /* ------------------------------------------------ validazione dei dati */
  function validaMappa(m, content) {
    const e = [];
    if (!m || m.formato !== 'rm-solo-mappa/1') return ['formato non valido'];
    ['id', 'storia', 'luoghi', 'collegamenti', 'viaggi'].forEach(k => { if (!(k in m)) e.push('campo ' + k + ' mancante'); });
    Object.values(m.luoghi).forEach(l => {
      ['id', 'nome', 'storia', 'tipo', 'fonte', 'coordinate', 'descrizionePubblica', 'descrizioneRiservata', 'conoscenzaIniziale', 'condizioniAmbientali', 'appartenenze', 'png', 'accessi', 'collegamenti', 'requisiti', 'macroCapitoli', 'stato'].forEach(k => { if (!(k in l)) e.push(l.id + ': ' + k + ' mancante'); });
      if ((m.tipiLuogo || []).indexOf(l.tipo) === -1) e.push(l.id + ': tipo ' + l.tipo);
      if (CONOSCENZE.indexOf(l.conoscenzaIniziale) === -1) e.push(l.id + ': conoscenza ' + l.conoscenzaIniziale);
      if (l.coordinate && !m.immagine) e.push(l.id + ': coordinate senza mappa');
      // Eidos: i Tèras sono creature e pericoli, mai un'appartenenza territoriale
      if (O() && (l.appartenenze || []).some(a => O().tipoDi(m.storia, a) === 'creatura')) e.push(l.id + ': creatura come appartenenza');
      if (m.storia === 'icaro' && O() && (l.appartenenze || []).some(a => O().tipoDi('icaro', a) === 'classe_sociale')) e.push(l.id + ': colore come appartenenza territoriale');
    });
    m.collegamenti.forEach(k => {
      if (!m.luoghi[k.origine] || !m.luoghi[k.destinazione]) e.push(k.id + ': estremità inesistente');
      if ((m.tipiRotta || []).indexOf(k.tipo) === -1) e.push(k.id + ': tipo ' + k.tipo);
      if (!k.fonte) e.push(k.id + ': senza fonte');
      if (k.distanza && !m.scala && !(k.distanza.fonte)) e.push(k.id + ': distanza senza scala né fonte');
      if (k.durata && !k.durata.fonte) e.push(k.id + ': durata senza fonte');
    });
    if (m.scala == null) m.collegamenti.forEach(k => { if (k.distanza && k.distanza.calcolata) e.push(k.id + ': distanza calcolata senza scala'); });
    return e;
  }

  const api = { VERSIONE, CONOSCENZE, DISPONIBILITA, FUNZIONI_VIAGGIO, M, vuoto, migra, inizia, conosci, voce, trasforma, vista, risolviDestinazione, intenzioneDiViaggio,
    pianifica, requisitiTratta, sceneDiViaggio, validaSceneViaggio, avvia, prosegui, arriva, dopoComando, validaMappa, luogoDiScena,
    coordinateApprossimate, raccontoRiserva, contestoNarratore, durataLeggibile };
  global.RMSoloMappa = api;
})(typeof window !== 'undefined' ? window : globalThis);
