/* Role Makers — modelli di capacità condivisi.
   Un solo catalogo di modelli meccanici di Tecniche, Abilità e Boost, usato da:
   - la creazione guidata del personaggio (js/creazione-guidata.js, «Scegli un punto di partenza»);
   - il Randomixer dei PNG (js/npc-randomizer.js, npcRollCapacitaRow).
   Nome, descrizione ed elemento restano liberi; i numeri stanno qui, una volta sola.

   Regole esistenti riusate (CLAUDE.md §10): CAPACITA_TETTI/capacitaTetto (tetto del Lv 1 della capacità,
   approvato), abilitaCostoForLv (costo MP via recomputeAbilitaRow), makeTecnicaRow/makeAbilitaRow/makeBoostRow,
   AZIONE_DURATE, STATUS_EFFECTS. I valori dei modelli sono approvati dall'autore il 7/11/2026 come suggerimenti
   (DECISIONI_AUTORE §15 I.1; docs/proposte/CREAZIONE_GUIDATA_CATALOGO.md): non cambiano regole e il giocatore può
   modificarli.
   Le due decisioni che erano aperte (BOZZA §6, B1 e B3) le ha prese l'autore il 7/11/2026 (DECISIONI_AUTORE §15 I.4a-b):
   - il danno della Tecnica si somma all'Atk dell'arma impugnata: il danno della riga resta quello del modello (entro
     CAPACITA_TETTI) e il motore gli aggiunge l'arma al momento dell'attacco;
   - il tempo di una Tecnica è quello dell'arma con cui si esegue (online mezzo turno): i modelli usano «mezzo turno».
   Logica pura: nessun DOM. In Node si carica con require() per i test. */
(function (global) {
  'use strict';

  const STILI = ['mischia', 'distanza', 'protezione', 'controllo', 'supporto', 'versatilita'];
  const TRATTO = (name, valore) => ({ listKey: 'capacitaCombattive', name, valore });
  const PRIM = (name, valore) => ({ listKey: 'primaria', name, valore });

  /* stat: 'arma' = la statistica dell'arma impugnata (for o dex); usa = statistiche e tratti che la capacità fa lavorare
     (servono ai preset «dal pacchetto»). solitaria:false = la meccanica non esiste nel motore della solitaria. */
  const MODELLI = [
    // ---- danno puro: tenuti anche se oggi rendono meno dell'arma (decisione B1 aperta, non un difetto della capacità)
    { id: 'fendente', nome: 'Fendente pesante', kind: 'tecnica', tipo: 'danno', stili: ['mischia'], danno: { base: 8, stat: 'arma', tipo: 'fisico' },
      usa: ['danno:arma', 'colpo:Arte Combattiva'], nota: 'Con le regole di oggi fa meno danno dell\'attacco con l\'arma: dipende dalla decisione «la Tecnica si somma all\'arma?».' },
    { id: 'tiro_mirato', nome: 'Tiro mirato', kind: 'tecnica', tipo: 'danno', stili: ['distanza'], danno: { base: 8, stat: 'mira', tipo: 'fisico' },
      usa: ['danno:mira', 'colpo:Arte Combattiva'], nota: 'Come il Fendente pesante, per chi colpisce da lontano.' },
    { id: 'dardo', nome: 'Dardo arcano', kind: 'abilita', tipo: 'danno', stili: ['controllo', 'supporto', 'versatilita'], danno: { base: 8, stat: 'fmen', tipo: 'magico' },
      usa: ['danno:fmen', 'costo:mp', 'colpo:Arte Combattiva'] },
    // ---- danno con stato (la gravità dello stato riduce il danno base: CATALOGO §4)
    { id: 'colpo_stordente', nome: 'Colpo stordente', kind: 'tecnica', tipo: 'danno', stili: ['mischia', 'protezione'], danno: { base: 4, stat: 'arma', tipo: 'fisico' },
      effetto: { nome: 'Stordire', tratto: 'Resistenza' }, usa: ['danno:arma', 'colpo:Arte Combattiva'] },
    { id: 'freccia_azzoppante', nome: 'Freccia azzoppante', kind: 'tecnica', tipo: 'danno', stili: ['distanza'], danno: { base: 6, stat: 'arma', tipo: 'fisico' },
      effetto: { nome: 'Rallentare', tratto: 'Elusione' }, usa: ['danno:arma', 'colpo:Arte Combattiva'] },
    { id: 'laccio', nome: 'Laccio', kind: 'abilita', tipo: 'danno', stili: ['controllo'], danno: { base: 5, stat: 'fmen', tipo: 'magico' },
      effetto: { nome: 'Immobilizzare', tratto: 'Resistenza' }, usa: ['danno:fmen', 'costo:mp', 'colpo:Arte Combattiva'] },
    // ---- danno misto: non esiste in solitaria, e online oggi subisce due riduzioni e niente critico (B5)
    { id: 'lama_infusa', nome: 'Lama infusa', kind: 'abilita', tipo: 'misto', stili: ['versatilita'], danno: { base: 4, stat: 'arma', tipo: 'fisico' }, danno2: { base: 4 },
      usa: ['danno:arma', 'danno:fmen', 'costo:mp', 'colpo:Arte Combattiva'], solitaria: false,
      nota: 'Danno misto: in solitaria non esiste; online oggi ogni parte è ridotta a parte e non fa critico.' },
    // ---- supporto e debuff (le Tecniche di supporto richiedono anche un malus: tecAbRowIsComplete)
    { id: 'guardia_ferma', nome: 'Guardia ferma', kind: 'tecnica', tipo: 'supporto', stili: ['protezione', 'mischia'], requisiti: { scudo: true },
      bonus: [TRATTO('Guardia', 2)], malus: [TRATTO('Elusione', 1)], durata: 'due', usa: ['tratto:Guardia'] },
    { id: 'occhio_fermo', nome: 'Occhio fermo', kind: 'tecnica', tipo: 'supporto', stili: ['distanza', 'mischia', 'versatilita'],
      bonus: [TRATTO('Arte Combattiva', 2)], malus: [TRATTO('Elusione', 1)], durata: 'due', usa: ['tratto:Arte Combattiva'] },
    { id: 'muro', nome: 'Muro', kind: 'tecnica', tipo: 'supporto', stili: ['protezione'],
      bonus: [TRATTO('Resistenza', 2)], malus: [PRIM('vel', 1)], durata: 'due', usa: ['tratto:Resistenza'] },
    { id: 'scatto', nome: 'Scatto', kind: 'tecnica', tipo: 'supporto', stili: ['distanza', 'versatilita'],
      bonus: [PRIM('vel', 2), TRATTO('Elusione', 1)], malus: [PRIM('dif', 1)], durata: 'due', usa: ['tratto:Elusione', 'iniziativa:vel'] },
    { id: 'benedizione', nome: 'Benedizione', kind: 'abilita', tipo: 'supporto', stili: ['supporto'], multi: false,
      bonus: [TRATTO('Arte Combattiva', 2)], durata: 'due', usa: ['costo:mp'] },
    { id: 'indebolire', nome: 'Indebolire', kind: 'abilita', tipo: 'debuff', stili: ['controllo'],
      bonus: [TRATTO('Arte Combattiva', 2)], durata: 'due', usa: ['costo:mp'] },
    // ---- cura: «Cura max» scala con la F.Men (base + dado + F.Men, app.js:7754-7767); la base resta nel tetto di cura
    { id: 'cura_scalata', nome: 'Cura', kind: 'abilita', tipo: 'curamax', stili: ['supporto'], cura: { base: 4, scala: 'fmen' }, durata: 'turno',
      usa: ['scala:fmen', 'costo:mp'] }
  ];

  /* Boost di partenza per le campagne: approvati dall'autore il 7/11/2026 come suggerimenti (DECISIONI_AUTORE §15 I.1). */
  const BOOST = [
    { id: 'furia', nome: 'Furia', stili: ['mischia'], bonus: [PRIM('for', 2), PRIM('vel', 1)] },
    { id: 'occhio_predatore', nome: 'Occhio del predatore', stili: ['distanza'], bonus: [TRATTO('Arte Combattiva', 2), TRATTO('Elusione', 1)] },
    { id: 'pelle_pietra', nome: 'Pelle di pietra', stili: ['protezione'], bonus: [TRATTO('Resistenza', 2), TRATTO('Guardia', 1)] },
    { id: 'marea_mentale', nome: 'Marea mentale', stili: ['controllo'], bonus: [PRIM('fmen', 2)] },
    { id: 'fonte', nome: 'Fonte', stili: ['supporto'], bonus: [PRIM('fmen', 1), TRATTO('Spirito', 2)] },
    { id: 'adattamento', nome: 'Adattamento', stili: ['versatilita'], bonus: [PRIM('for', 1), PRIM('fmen', 1), PRIM('vel', 1)] }
  ];

  const clone = o => JSON.parse(JSON.stringify(o));
  const tetto = (tipo, lv) => (typeof capacitaTetto === 'function' ? capacitaTetto(tipo, lv) : null);
  const entroTetto = (v, tipo, lv) => { const t = tetto(tipo, lv); return t == null ? v : Math.min(v, t); };

  function modello(id) { return MODELLI.find(m => m.id === id) || null; }
  function boostModello(id) { return BOOST.find(b => b.id === id) || null; }

  /* Modelli adatti a un tipo di slot ('tecnica'|'abilita'), filtrati per stile, scudo e modalità. Ordine: prima quelli
     dello stile principale, poi del secondario, poi gli altri. */
  function perSlot(kind, opts) {
    const o = opts || {};
    const st = [o.stile, o.stile2].filter(Boolean);
    return MODELLI.filter(m => m.kind === kind)
      .filter(m => !(m.requisiti && m.requisiti.scudo && o.scudo === false))
      .filter(m => !(o.solitaria && m.solitaria === false))
      .map(m => ({ m, p: st.indexOf(m.stili.find(s => st.indexOf(s) !== -1)) }))
      .sort((a, b) => (a.p === -1 ? 9 : a.p) - (b.p === -1 ? 9 : b.p) || (a.m.stili.indexOf(st[0]) === -1) - (b.m.stili.indexOf(st[0]) === -1))
      .map(x => x.m);
  }

  /* Riga di scheda (forma di makeTecnicaRow/makeAbilitaRow) da un modello. opts.armaStat = 'for'|'dex' dell'arma,
     opts.nome = nome scelto dal giocatore, opts.qi per gli utilizzi. Sempre livello 1 della capacità (gli slot di
     creazione nascono al Lv 1, regola esistente) e sempre entro CAPACITA_TETTI. */
  function riga(m, opts) {
    const o = opts || {};
    const tec = m.kind === 'tecnica';
    const r = tec ? makeTecnicaRow() : makeAbilitaRow();
    r.nome = o.nome || m.nome;
    r.lv = '1';
    r.tipo = m.tipo;
    r.tipoConfirmed = false;
    r.modelloId = m.id;
    r.tempoAzione = 'mezzo';
    r.durata = m.durata || '';
    if (m.danno) {
      r.dannoBase = entroTetto(m.danno.base, 'danno', 1);
      r.dannoTipo = tec ? 'fisico' : m.danno.tipo;
      r.dannoStat = m.danno.stat === 'arma' ? (o.armaStat === 'dex' ? 'dex' : 'for') : m.danno.stat;
    }
    if (m.danno2 && !tec) r.dannoBase2 = entroTetto(m.danno2.base, 'danno', 1);
    if (m.effetto) { r.effettoNome = m.effetto.nome; r.effettoTratto = m.effetto.tratto; }
    if (m.bonus) r.bonusItems = clone(m.bonus);
    if (m.malus && tec) r.malusItems = clone(m.malus);
    if (m.multi) r.multiTarget = true;
    if (m.cura) { r.bonusItems = [PRIM('hp', entroTetto(m.cura.base, 'cura', 1))]; r.scalaStat = m.cura.scala; }
    if (tec && typeof recomputeTecnicaRow === 'function') recomputeTecnicaRow(r, o.qi);
    if (!tec && typeof recomputeAbilitaRow === 'function') recomputeAbilitaRow(r, o.qi);
    return r;
  }

  /* Riga boost (forma di makeBoostRow), livello 1 del boost. */
  function rigaBoost(b, opts) {
    const r = makeBoostRow();
    r.nome = (opts && opts.nome) || b.nome;
    r.bonusItems = clone(b.bonus);
    r.lv = '1';
    r.modelloId = b.id;
    if (typeof recomputeBoostRow === 'function') recomputeBoostRow(r);
    return r;
  }

  /* Statistiche e tratti che una riga di scheda fa lavorare (per i preset dal pacchetto). */
  function ruoliRiga(r, kind) {
    const out = [];
    if (!r || !String(r.nome || '').trim()) return out;
    const tec = kind === 'tecnica';
    if (r.tipo === 'danno' || r.tipo === 'misto') {
      out.push('danno:' + (r.dannoTipo === 'magico' ? 'fmen' : (r.dannoStat || 'for')));
      out.push('colpo:Arte Combattiva');
    }
    if (r.tipo === 'misto' && !tec) out.push('danno:fmen');
    if (r.tipo === 'curamax' || r.tipo === 'extra') out.push('scala:' + (r.scalaStat || 'fmen'));
    if (!tec) out.push('costo:mp');
    (r.bonusItems || []).forEach(it => { if (it.listKey !== 'primaria') out.push('tratto:' + it.name); });
    return out;
  }

  const api = { STILI, MODELLI, BOOST, modello, boostModello, perSlot, riga, rigaBoost, ruoliRiga };
  global.RMCapacitaModelli = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
