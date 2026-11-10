/* Role Makers — Gioca in solitaria: «Crea il tuo» personaggio.

   Il giocatore crea il personaggio con la creazione guidata normale di
   "I miei personaggi", dentro il contesto della storia:
   - popolazione, provenienza, appartenenza e ruolo si scelgono SOLO fra le
     voci dell'ambientazione (registro RMSoloOntologia e preset della storia,
     gli stessi dati da cui derivano i preset); la classe è libera, salvo
     dove la premessa la vieta o la storia non ha una dotazione per quella
     classe;
   - armi, scudi, armature e zaino NON si scelgono: li assegna il gioco dal
     CATALOGO della storia (js/solo/solo-catalogo.js, <storia>-catalogo.json)
     per gruppo e classe, mai presi da un altro popolo; tecniche e abilità
     partono dalla dotazione del catalogo e si cambiano con «Scegli un
     esempio» (voci del gruppo e della classe), poi si modificano come nella
     scheda normale entro il tetto del Lv 1 (CAPACITA_TETTI);
   - il personaggio parte sempre dal livello 1.

   Qui c'è solo logica pura (nessun DOM, testabile in Node): costruisce un
   archetipo «sintetico» che il motore tratta come un preset
   (RMSoloEngine.newGame). Niente trama personale: legami, conoscenze e
   occasioni di sviluppo restano vuoti finché non esiste la trama guidata
   dall'obiettivo (Fase 5).

   Regole esistenti riusate (CLAUDE.md §10): validateArchetype (PRIMARY_POOL,
   TRAIT_POOL_PER_LIST, slot di tecniche e abilità da tecAbSbloccate),
   classiVietate del registro (es. Epizi: niente Mago), CAPACITA_TETTI,
   RMSoloModeration. */
(function (global) {
  'use strict';

  const clone = o => JSON.parse(JSON.stringify(o));
  const O = () => global.RMSoloOntologia;
  const DETTAGLIO_MAX = 160;
  // Antarsi ed Eporiani: registro «solo_con_fonte», sbloccati dalla decisione dell'autore (fonte di livello 1)
  const DEC_AUTORE = 'autore: decisione sul «Crea il tuo» di Eidos (fonte di livello 1)';

  /* Tipi di obiettivo: lista DEFINITIVA dell'autore (2026-10-17; nessuna lista esistente in js/data.js,
     js/rules.js, js/app.js, js/cloud-combat.js né nel piano). Il tipo è salvato nella partita, mostrato in
     scheda e diario, e dà il percorso dei traguardi (js/solo/solo-percorso.js, Fase 3). I tipi della lista
     precedente restano leggibili nelle partite già salvate (RMSoloPercorso.ALIAS_OBIETTIVO). */
  const OBIETTIVI = {
    eidos: [
      { id: 'ritrovare_chi_e_stato_cancellato', nome: 'Ritrovare chi è stato cancellato' },
      { id: 'smascherare_una_menzogna', nome: 'Smascherare una menzogna' },
      { id: 'riscattarsi_da_una_colpa', nome: 'Riscattarsi da una colpa attribuita' },
      { id: 'proteggere_qualcuno', nome: 'Proteggere qualcuno' },
      { id: 'obbedire', nome: 'Obbedire (fino a dover scegliere)' },
      { id: 'porre_fine_alla_guerra', nome: 'Porre fine alla guerra' }
    ],
    ich: [
      { id: 'ricordare', nome: 'Ricordare' },
      { id: 'restare_se_stesso', nome: 'Restare se stesso' },
      { id: 'diventare_altro', nome: 'Diventare altro' },
      { id: 'trovare_chi_muove_i_fili', nome: 'Trovare chi muove i fili' },
      { id: 'salvare_chi_non_ti_riconosce', nome: 'Salvare chi non ti riconosce' }
    ],
    icaro: [
      { id: 'sopravvivere', nome: 'Sopravvivere' },
      { id: 'scalare_il_proprio_settore', nome: 'Scalare il proprio settore' },
      { id: 'conquistare_una_vita_agiata', nome: 'Conquistare una vita agiata' },
      { id: 'guarire_o_salvare_qualcuno', nome: 'Guarire o salvare qualcuno' },
      { id: 'ridare_vita_al_pianeta', nome: 'Ridare vita al pianeta' },
      { id: 'capire_cosa_ti_rende_umano', nome: 'Capire cosa ti rende umano' }
    ]
  };
  function obiettivi(storia) { return (OBIETTIVI[O().mondoDi(storia)] || []).map(o => Object.assign({}, o)); }

  /* ------------------------------------------------ scelte dell'ambientazione */
  function ruoliDi(archetipi) {
    const visti = {}, out = [];
    (archetipi || []).forEach(a => {
      const id = (a.ontologia || {}).roleId || a.mansione;
      if (!id || visti[id]) return;
      visti[id] = true; out.push({ id, nome: a.mansione });
    });
    return out;
  }
  const voci = (sez, filtra, daOpzione) => Object.entries(sez || {}).filter(([id, v]) => !filtra || filtra(id, v)).map(([id, v]) => Object.assign({ id, nome: v.nome }, daOpzione ? daOpzione(id, v) : {}));

  /* Quali valori di «citta» ammettono una voce di «appartenenza» secondo il catalogo
     (gruppi con match.citta e match.appartenenza). Senza catalogo: nessuna restrizione. */
  function cittaDi(catalogo, appartenenza) {
    if (!catalogo || !catalogo.gruppi) return null;
    const out = [];
    Object.keys(catalogo.gruppi).forEach(g => {
      const m = catalogo.gruppi[g].match || {};
      if ([].concat(m.appartenenza).indexOf(appartenenza) !== -1) [].concat(m.citta || []).forEach(c => { if (out.indexOf(c) === -1) out.push(c); });
    });
    return out;
  }
  const conDi = (catalogo, id) => { const d = cittaDi(catalogo, id); return d ? { di: d } : {}; };

  /* I quattro campi di identità, con le sole voci ammesse. Un'opzione con
     «di» vale solo se il campo indicato in «dipendeDa» ha uno di quei valori. */
  function campi(storia, archetipi, catalogo) {
    const R = O() && O().reg(storia);
    if (!R) return [];
    const ruolo = { key: 'ruolo', label: 'Ruolo', opzioni: ruoliDi(archetipi) };
    if (O().mondoDi(storia) === 'eidos') {
      // Decisione dell'autore (fonte di livello 1): Antarsi ed Eporiani sono popolazioni selezionabili
      // (nel registro sono «solo_con_fonte»; Antarsi è una forza terza, qui trattata come popolazione).
      // Le città distrutte (Antarsia) non si offrono.
      const pop = voci(R.popolazioni).concat(voci(R.terzeForze, id => id === 'antarsi'));
      return [
        { key: 'popolazione', label: 'Popolazione', opzioni: pop },
        { key: 'citta', label: 'Città di provenienza', dipendeDa: 'popolazione', opzioni: voci(R.citta, (id, v) => v.stato !== 'distrutta' && pop.some(p => p.id === v.di), (id, v) => ({ di: [v.di] })) },
        // l'appartenenza segue la popolazione (Chorisfos, Epizi, Antarsi; gli Eporiani non hanno una fazione nei dati)
        { key: 'appartenenza', label: 'Appartenenza', dipendeDa: 'popolazione', opzioni: pop.map(p => ({ id: p.id, nome: p.nome, di: [p.id] })) },
        ruolo
      ];
    }
    if (storia === 'ich') {
      return [
        // «reverie» è nel lessico riservato di Ich (verità rivelata nell'Atto III): il popolo resta
        // un dato interno (peopleId), mai un testo visibile; come nei preset si mostra la società
        { key: 'popolazione', label: 'Popolazione', nascosto: true, opzioni: voci(R.popoli, null, () => ({ nome: '' })) },
        { key: 'citta', label: 'Luogo di provenienza', opzioni: voci(R.regioni).concat(voci(R.insediamenti)) },
        // la società segue il luogo: ogni gruppo del catalogo è una coppia luogo + società
        { key: 'appartenenza', label: 'Società', dipendeDa: 'citta', opzioni: voci(R.societa, null, id => conDi(catalogo, id)) },
        ruolo
      ];
    }
    if (storia === 'icaro') {
      return [
        // tutti i preset sono «umano» (ontologia.peopleId): nessun'altra popolazione nei dati
        { key: 'popolazione', label: 'Popolazione', opzioni: [{ id: 'umano', nome: 'Umani' }] },
        { key: 'citta', label: 'Città', opzioni: voci(R.citta).concat([{ id: 'margini', nome: 'Margini delle città (esclusi dal sistema)' }]) },
        // il colore segue la città: chi vive ai margini delle città, escluso dal sistema, è «senza colore»; fuori dalle cupole non si vive
        { key: 'appartenenza', label: 'Colore del Cromo', dipendeDa: 'citta', opzioni: voci(R.classiSociali, null, id => conDi(catalogo, id)) },
        ruolo
      ];
    }
    return [];
  }
  function opzioniValide(campo, scelte) {
    return campo.opzioni.filter(o => !o.di || !campo.dipendeDa || o.di.indexOf((scelte || {})[campo.dipendeDa]) !== -1);
  }
  function nomeScelta(campiStoria, scelte, key) {
    const campo = campiStoria.find(c => c.key === key);
    const o = campo && campo.opzioni.find(x => x.id === (scelte || {})[key]);
    return o ? o.nome : '';
  }
  /* Scelte coerenti: una voce non più ammessa (cambiata la popolazione) cade;
     un campo con una sola voce valida si compila da solo. */
  function normalizza(storia, archetipi, scelte, catalogo) {
    const cs = campi(storia, archetipi, catalogo), out = {};
    cs.forEach(c => {
      const ok = opzioniValide(c, out);
      const v = (scelte || {})[c.key];
      if (ok.some(o => o.id === v)) out[c.key] = v;
      else if (ok.length === 1) out[c.key] = ok[0].id;
    });
    return out;
  }
  function mancanti(storia, archetipi, scelte, catalogo) {
    return campi(storia, archetipi, catalogo).filter(c => !(scelte || {})[c.key]).map(c => c.label);
  }

  /* --------------------------------------------- dotazione e classi */
  const C = () => global.RMSoloCatalogo;
  const SENZA_CATALOGO = 'Dotazione in preparazione.';

  /* Gruppo del catalogo che corrisponde alle scelte (Eidos: popolo; Ich: luogo + società;
     Icaro: colore), o null se le scelte non lo identificano ancora. */
  function gruppoDi(catalogo, scelte) { return C().gruppoDi(catalogo, scelte); }

  /* Classe → { ok, motivo }: ammessa se la premessa non la vieta e il catalogo ha una
     dotazione di Lv 1 per il gruppo; altrimenti il motivo è scritto (mai «MANCA»). */
  function classi(storia, archetipi, scelte, pronto, keys, catalogo) {
    const R = O() && O().reg(storia);
    const g = gruppoDi(catalogo, scelte);
    const dal = g ? C().classiDi(catalogo, g) : null;
    const out = {};
    (keys || C().CLASSI).forEach(b => {
      const viet = ((R && R.classiVietate) || {})[(scelte || {}).appartenenza] || [];
      if (viet.indexOf(b) !== -1) out[b] = { ok: false, motivo: "La premessa non ammette questa classe per l'appartenenza scelta." };
      else if (!catalogo) out[b] = { ok: false, motivo: SENZA_CATALOGO };
      else if (!g) out[b] = { ok: false, motivo: 'Completa prima le scelte di identità.' };
      else out[b] = dal[b] || { ok: false, motivo: SENZA_CATALOGO };
    });
    return out;
  }

  /* Tecniche e abilità della dotazione → righe del Retro Scheda sono costruite da js/solo/solo-link.js;
     qui il percorso inverso: una riga (modificata o no dal giocatore) → capacità del motore. */
  const STAT_DA_ETICHETTA = { for: 'for', mira: 'mira', vel: 'vel', fmen: 'fmen', dex: 'dex', dif: 'dif', dmen: 'dmen' };
  const NOME_STAT = { for: 'Forza', mira: 'Mira', vel: 'Velocità', fmen: 'Forza Magica', dex: 'Destrezza', dif: 'Difesa', dmen: 'Difesa Magica' };
  const TURNI_DA_DURATA = { turno: 1, due: 2, tre: 3 };
  function bonusDaRighe(items, segno, out) {
    (items || []).forEach(b => {
      const k = STAT_DA_ETICHETTA[b.key] || STAT_DA_ETICHETTA[b.name] || STAT_DA_ETICHETTA[b.stat];
      const v = Math.abs(Number(b.valore) || 0);
      if (k && v) out[k] = (out[k] || 0) + segno * v;
    });
  }
  /* kind: 'tecniche' | 'abilita'. Ritorna { cap } oppure { errore }. */
  function capacitaDaRiga(catalogo, riga, kind) {
    const nome = String(riga.nome || '').trim();
    if (!nome) return { errore: 'una riga di ' + (kind === 'tecniche' ? 'tecniche' : 'abilità') + ' senza nome' };
    const tecnica = kind === 'tecniche';
    const daCatalogo = riga.soloCapId && catalogo && catalogo.capacita && catalogo.capacita[riga.soloCapId];
    const lv1 = typeof capacitaTetto === 'function' ? capacitaTetto('danno', 1) : 10;
    const cap = daCatalogo ? clone(catalogo.capacita[riga.soloCapId]) : null;
    if (riga.tipo !== 'danno' && riga.tipo !== 'supporto') return { errore: nome + ': nella solitaria sono ammessi solo effetti di danno o di supporto' };
    const danno = riga.tipo === 'danno';
    const stat = ['for', 'dex', 'mira', 'fmen'].indexOf(riga.dannoStat) !== -1 ? riga.dannoStat : 'for';
    const out = cap || {
      id: 'creata-' + String(riga.id || nome).replace(/[^a-z0-9_-]/gi, '').toLowerCase(), categoria: tecnica ? 'tecnica' : (riga.dannoTipo === 'magico' ? 'magia' : 'abilità'),
      forzatura: { consentita: false, costoVitalita: null }, risorsaSpeciale: null, costoRisorsaSpeciale: 0, utilizziMassimi: 'utilizziLimitFor', condizioniUso: [], bonus: [], malus: [],
      livelloRichiesto: 1, slotRichiesti: 1, lv: 1, descrizione: 'Scritta dal giocatore partendo da un esempio.', fonteCanone: 'scelta del giocatore', origine: 'giocatore', costoMP: tecnica ? 0 : 6
    };
    out.nome = nome;
    if (danno) {
      const d = Math.max(0, Math.min(lv1, Math.floor(Number(riga.dannoBase)) || 0));
      Object.assign(out, { tipo: 'danno', tipoAzione: 'attacco', bersaglio: 'singolo nemico', dannoBase: d, stat, durataTurni: 0 });
      delete out.bonusStat;
      const tipoDanno = stat === 'fmen' ? (out.categoria === 'magia' ? 'magico' : 'tecnologico') : 'fisico';
      out.effetto = 'Attacco ' + tipoDanno + ': danno base ' + d + ' + ' + NOME_STAT[stat];
    } else {
      const b = {};
      bonusDaRighe(riga.bonusItems, 1, b);
      bonusDaRighe(riga.malusItems, -1, b);
      if (!Object.keys(b).length && !cap) return { errore: nome + ': un effetto di supporto ha bisogno di almeno un bonus' };
      const turni = TURNI_DA_DURATA[riga.durata] || (cap && cap.durataTurni) || 1;
      const bonus = Object.keys(b).length ? b : cap.bonusStat;
      if (Object.keys(bonus).length > (typeof capacitaTetto === 'function' ? capacitaTetto('effetti', 1) : 2)) return { errore: nome + ': troppi effetti per il Lv 1' };
      Object.assign(out, { tipo: 'supporto', tipoAzione: 'supporto', bersaglio: 'sé', dannoBase: 0, stat: null, bonusStat: bonus, durataTurni: turni });
      out.effetto = Object.keys(bonus).map(k => (bonus[k] > 0 ? '+' : '−') + Math.abs(bonus[k]) + ' ' + NOME_STAT[k]).join(', ') + ' per ' + turni + (turni === 1 ? ' turno' : ' turni');
    }
    return { cap: out };
  }

  /* ----------------------------------------------- archetipo sintetico */
  function trattiDi(c) {
    const out = {};
    Object.keys(c.traits || {}).forEach(lista => {
      out[lista] = {};
      Object.keys(c.traits[lista]).forEach(n => { const v = Number(c.traits[lista][n]) || 0; if (v > 0) out[lista][n] = v; });
      ((c.customTraits || {})[lista] || []).forEach(t => { const v = Number(t.value) || 0; if (t.name && v > 0) out[lista][String(t.name).trim()] = v; });
    });
    return out;
  }
  function testoObiettivo(storia, ob) {
    const tipo = obiettivi(storia).find(o => o.id === (ob || {}).tipo);
    if (!tipo) return '';
    const d = String((ob || {}).dettaglio || '').trim();
    return tipo.nome + (d ? ' — ' + d : '');
  }
  function controllaTesti(c, ob) {
    const M = global.RMSoloModeration;
    const errori = [];
    if (!M) return errori;
    [['il nome', c.nome], ['il dettaglio dell\'obiettivo', (ob || {}).dettaglio]].concat(
      Object.keys(c.customTraits || {}).reduce((acc, l) => acc.concat((c.customTraits[l] || []).map(t => ['il tratto «' + t.name + '»', t.name])), [])
    ).forEach(([chi, v]) => { if (v && !M.checkCreationField(v).ok) errori.push('Cambia ' + chi + ': il testo non è ammesso.'); });
    return errori;
  }

  /* Costruisce l'archetipo del personaggio creato dal giocatore.
     c: personaggio di "I miei personaggi" a creazione completata; scelte:
     { popolazione, citta, appartenenza, ruolo }; ob: { tipo, dettaglio }.
     catalogo: <storia>-catalogo.json. Le righe c.tecniche / c.abilita (scelte con
     «Scegli un esempio» e modificate dal giocatore) diventano le capacità di Lv 1;
     senza righe valgono quelle di default della dotazione.
     Ritorna { arch, base, gruppo } oppure { errori }. */
  function archetipoDaPersonaggio(storia, archetipi, c, scelte, ob, pronto, catalogo) {
    const errori = [];
    const cs = campi(storia, archetipi, catalogo);
    const s = normalizza(storia, archetipi, scelte, catalogo);
    mancanti(storia, archetipi, s, catalogo).forEach(m => errori.push('Manca: ' + m + '.'));
    if (!String(c.nome || '').trim()) errori.push('Manca il nome del personaggio.');
    if (!obiettivi(storia).some(o => o.id === (ob || {}).tipo)) errori.push('Scegli il tipo di obiettivo.');
    if (String((ob || {}).dettaglio || '').length > DETTAGLIO_MAX) errori.push("Il dettaglio dell'obiettivo supera " + DETTAGLIO_MAX + ' caratteri.');
    const cl = classi(storia, archetipi, s, pronto, [c.build], catalogo)[c.build];
    if (!cl || !cl.ok) errori.push((cl && cl.motivo) || 'Classe non ammessa.');
    controllaTesti(c, ob).forEach(e => errori.push(e));
    const gruppo = gruppoDi(catalogo, s);
    const dot = gruppo && cl && cl.ok ? C().dotazione(catalogo, gruppo, c.build) : null;
    // tecniche e abilità: le righe del giocatore (se compilate), altrimenti la dotazione di default
    let tecniche = dot ? dot.tecniche : [], abilita = dot ? dot.abilita : [];
    if (dot) {
      const sl = tecAbSbloccate(c.build, 1, {});
      [['tecniche', sl.tec], ['abilita', sl.ab]].forEach(([kind, n]) => {
        const righe = (c[kind] || []).filter(r => r && String(r.nome || '').trim()).slice(0, n);
        if (righe.length !== n) return; // nessuna scelta completa: restano le voci di default
        const out = [];
        righe.forEach(r => { const x = capacitaDaRiga(catalogo, r, kind); if (x.errore) errori.push(x.errore.charAt(0).toUpperCase() + x.errore.slice(1) + '.'); else out.push(x.cap); });
        if (out.length === n) { if (kind === 'tecniche') tecniche = out; else abilita = out; }
      });
      const ids = [].concat(tecniche, abilita).map(x => x.id);
      if (new Set(ids).size !== ids.length) errori.push('Tecniche e abilità: la stessa voce è scelta due volte.');
    }
    if (errori.length) return { errori };
    const base = (archetipi || []).find(a => !pronto || pronto(a)) || archetipi[0];
    const nome = k => nomeScelta(cs, s, k);
    const R = O().reg(storia);
    const arch = clone(base);
    const o = clone(base.ontologia || {});
    Object.assign(o, { entityType: 'personaggio_giocabile', playable: true, playerVisible: true, narratorOnly: [], roleId: s.ruolo, creatureFamilyId: null, corporationId: null, cultureId: null, socialClassId: null, statoAffiliazione: 'scelta_del_giocatore', dubbi: [], fonti: { creazione: "scelta del giocatore fra le voci dell'ambientazione", peopleId: DEC_AUTORE, factionId: DEC_AUTORE } });
    if (O().mondoDi(storia) === 'eidos') Object.assign(o, { peopleId: s.popolazione === 'antarsi' ? null : s.popolazione, factionId: s.appartenenza === 'eporiani' ? null : s.appartenenza, regionId: s.citta });
    else if (storia === 'ich') Object.assign(o, { peopleId: s.popolazione, factionId: null, societyId: s.appartenenza, figureId: null, regionId: R.regioni[s.citta] ? s.citta : ((R.insediamenti[s.citta] || {}).regione || null) });
    else if (storia === 'icaro') Object.assign(o, { peopleId: s.popolazione, factionId: null, socialClassId: s.appartenenza === 'senza_colore' ? 'senza_colore' : s.appartenenza, regionId: s.citta, cityId: s.citta === 'margini' ? null : s.citta, politicalGroupId: null });
    const testo = testoObiettivo(storia, ob);
    const dove = nome('citta');
    Object.assign(arch, {
      id: 'creato-' + c.id, creato: true, creatoDa: c.id, nome: String(c.nome).trim(),
      // genere della scheda («neutro» se non indicato): dato anagrafico, solo per concordare i testi
      genere: global.RMSoloGenere ? global.RMSoloGenere.normalizza(c.genere) : 'neutro',
      ritratto: '', ritratto_alt: '',
      popolazione: nome('popolazione') || nome('appartenenza'), citta: dove, mansione: nome('ruolo'),
      build: c.build, eclecticoHpMult: c.eclecticoHpMult === 5 ? 5 : 7,
      background: 'Creato dal giocatore: ' + [nome('popolazione'), dove, nome('appartenenza'), nome('ruolo')].filter(Boolean).join(' · ') + '.',
      obiettivo: testo, missione_iniziale: '',
      obiettivoPersonale: { tipo: ob.tipo, nome: obiettivi(storia).find(x => x.id === ob.tipo).nome, dettaglio: String(ob.dettaglio || '').trim() },
      primary: clone(c.primary), tertiary: clone(c.tertiary), traits: trattiDi(c),
      // dotazione dal catalogo (mai da un altro popolo): armi, protezione, scudo, zaino, tecniche, abilità, Boost
      equip: dot.equip, inventarioIniziale: dot.inventarioIniziale, tecniche, abilita, boost: dot.boost,
      slotVacanti: [], capacitaIncompatibili: [], catalogoGruppo: gruppo,
      // niente trama personale del preset: legami, conoscenze, segreti e occasioni sono suoi
      legami_iniziali: [], conoscenze: [], segreti_narratore: [], occasioni_sviluppo: [],
      ontologia: o
    });
    delete arch.gemme; delete arch.capacitaSpeciali; delete arch.classePrecedente;
    if (dot.gemme) { arch.gemme = dot.gemme; arch.capacitaSpeciali = dot.capacitaSpeciali; }
    return { arch, base, gruppo };
  }

  global.RMSoloProprio = { OBIETTIVI, DETTAGLIO_MAX, obiettivi, campi, opzioniValide, normalizza, mancanti, gruppoDi, classi, archetipoDaPersonaggio, capacitaDaRiga, testoObiettivo, nomeScelta, ruoliDi };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloProprio;
})(typeof window !== 'undefined' ? window : globalThis);
