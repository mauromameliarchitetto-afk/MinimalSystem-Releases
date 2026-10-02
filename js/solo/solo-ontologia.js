/* ==========================================================================
   Role Makers — Gioca in solitaria: ontologia delle ambientazioni
   --------------------------------------------------------------------------
   Registro per storia di ciò che ESISTE nel mondo e di che TIPO è (fazione,
   popolazione, forza terza, società, figura trasversale, classe sociale,
   corporazione, città, famiglia di creature, materiale), con la fonte di
   ogni voce. Nessun contenuto narrativo nuovo: il registro classifica solo
   ciò che le premesse (js/library-settings.js) e i copioni già nominano.

   Priorità delle fonti (correzione dell'autore):
     1 correzioni dell'autore · 2 premesse delle ambientazioni ·
     3 copioni originali · 4 documenti derivati (pacchetto V4) ·
     5 contenuti generati (mai canone).
   Una classificazione non dimostrabile resta «da_approvare» (campo null +
   proposta), mai assegnata d'ufficio.

   Campi strutturati di un'entità (archetipi, PNG, avversari):
     entityType, peopleId, factionId, cultureId, regionId, roleId,
     creatureFamilyId, socialClassId, corporationId, playable,
     playerVisible, narratorOnly — più societyId e figureId (Ich: Stad/Stam
     e figure trasversali restano separate), cityId e politicalGroupId
     (Icaro: città e gruppo politico distinti dal colore).
   ========================================================================== */
(function (global) {
  'use strict';

  const FONTE = { AUTORE: 1, PREMESSA: 2, COPIONE: 3, DERIVATO: 4, GENERATO: 5 };

  const REGISTRO = {
    eidos: {
      fazioni: {
        chorisfos: { nome: 'Chorisfos', tipo: 'fazione_belligerante', giocabile: true, fonte: 'premessa Eidos, «Un secolo dopo Aima»; correzione dell\'autore: fazione principale e appartenenza giocabile normale' },
        epizi: { nome: 'Epizi', tipo: 'fazione_belligerante', giocabile: true, fonte: 'premessa Eidos, «Un secolo dopo Aima»; correzione dell\'autore: fazione principale e appartenenza giocabile normale' }
      },
      terzeForze: {
        antarsi: { nome: 'Antarsi', tipo: 'forza_terza_eterogenea', giocabile: 'solo_con_fonte', fonte: 'premessa Eidos, «Antarsi»: «La fazione riunisce etnie diverse»; decisione dell\'autore: etichetta dispregiativa per i popoli esterni, esclusa Lechta, e rete che infiltra Chorisfos ed Epizi contro le dittature; non un popolo o una razza' }
      },
      popolazioni: {
        chorisfos: { nome: 'Chorisfos', tipo: 'cittadinanza', fonte: 'premessa Eidos' },
        epizi: { nome: 'Epizi', tipo: 'cittadinanza', fonte: 'premessa Eidos' },
        eporiani: { nome: 'Eporiani', tipo: 'popolazione_distinta', giocabile: 'solo_con_fonte', fonte: 'premessa Eidos: «Gli Eporiani rimangono ai margini del conflitto»; decisione dell\'autore: popolazione distinta con commerci con Epizi e Chorisfos; nessun isolamento economico o neutralità personale automatica' }
      },
      famiglieCreature: {
        teras: { nome: 'Tèras', tipo: 'famiglia_di_creature', addestrabile: true, fonte: 'premessa Eidos, «Tèras e natura mutata»; Eporiani: «I Tèras dell\'isola sono stati addomesticati»; correzione dell\'autore: mai popolo, fazione, cultura, provenienza o appartenenza giocabile' }
      },
      materiali: {
        osso_teras: { nome: 'Ossa di Tèras', origine: 'teras', lavorazione: 'umana', fonte: 'premessa Eidos, «Antarsi»: «Pelli e ossa di Tèras diventano abiti, archi, impugnature e protezioni»; correzione dell\'autore: oggetti fabbricati da esseri umani con materiale animale' },
        essenza_teras: { nome: 'Essenza di Tèras', origine: 'teras', lavorazione: 'umana', fonte: 'premessa Eidos, «Epizi»: le armature militari derivano dalle essenze dei Tèras' }
      },
      citta: {
        apologeti: { nome: 'Apologeti', di: 'chorisfos', fonte: 'premessa Eidos, «Chorisfos»' },
        epimno: { nome: 'Epimno', di: 'epizi', fonte: 'premessa Eidos, «Epizi»' },
        lechta: { nome: 'Lechta', di: 'eporiani', fonte: 'premessa Eidos, «Eporiani»' },
        erissa: { nome: 'Erissa', di: 'antarsi', fonte: 'premessa Eidos, «Antarsi»' },
        antarsia: { nome: 'Antarsia', di: 'antarsi', stato: 'distrutta', fonte: 'premessa Eidos: le rovine di Antarsia' }
      },
      // classi alla creazione ammesse per appartenenza (premessa: «La magia è proibita» fra gli Epizi)
      classiVietate: { epizi: ['mago'] }
    },

    ich: {
      popoli: {
        reverie: { nome: 'reverie', tipo: 'abitanti', fonte: 'premessa Ich: «Gli abitanti di Erdegis si definiscono reveries»' }
      },
      societa: {
        stad: { nome: 'Stad', tipo: 'societa_urbana', fonte: 'premessa Ich, «Stad e Stam»' },
        stam: { nome: 'Stam', tipo: 'societa_tribale', fonte: 'premessa Ich, «Stad e Stam»: «clan legati a un territorio preciso»' }
      },
      culture: {
        kynwird: { nome: 'Kynwird', societa: 'stam', regione: 'kynhjarta', fonte: 'premessa Ich: «il Kynwird, l\'albero che dà nome al grande clan delle radici»' },
        skjold: { nome: 'casata Skjold', societa: 'stad', regione: 'skjioldland', fonte: 'premessa Ich, «Skjioldland»' },
        bhorkyn_stad: { nome: 'Stad di Bhorkyn', societa: 'stad', regione: 'bhorkyn', fonte: 'premessa Ich, «Bhorkyn»' },
        bhorkyn_tribali: { nome: 'Bhorkyn tribali', societa: 'stam', regione: 'bhorkyn', fonte: 'premessa Ich, «Bhorkyn»' },
        skrykru: { nome: 'Skrykru', societa: 'stam', regione: 'skry_y_kalter', fonte: 'premessa Ich, «Skry y Kalter»' },
        fjorbinda: { nome: 'patto Fjorbinda', societa: 'stam', regione: 'restan', fonte: 'premessa Ich, «Restan»' },
        urobri: { nome: 'Urobri', societa: null, regione: 'ourobera', fonte: 'premessa Ich, «Ourobera»' }
      },
      regioni: {
        kynhjarta: { nome: 'Kynhjarta', fonte: 'premessa Ich, «Geografia»' },
        skjioldland: { nome: 'Skjioldland', fonte: 'premessa Ich' },
        bhorkyn: { nome: 'Bhorkyn', fonte: 'premessa Ich' },
        skry_y_kalter: { nome: 'Skry y Kalter', fonte: 'premessa Ich' },
        ourobera: { nome: 'Ourobera', fonte: 'premessa Ich' },
        vanargand: { nome: 'Vanargand', fonte: 'premessa Ich' },
        restan: { nome: 'Restan', fonte: 'premessa Ich' }
      },
      famiglieCreature: {
        lupo_del_sentiero: { nome: 'Lupo del Sentiero Bianco', fonte: 'copione Ich: nemici.lupo_bianco' }
      },
      insediamenti: {
        hrafnvik: { nome: 'Hrafnvik', societa: 'stad', regione: 'kynhjarta', fonte: 'copione Ich: «Hrafnvik è una Stad di legno e pietra ai margini del Kynwird»' }
      },
      // figure o condizioni trasversali: attraversano le società, non sono fazioni territoriali
      figure: {
        kyn: { nome: 'Kyn', fonte: 'premessa Ich, «Figure del mondo»' },
        voluspa: { nome: 'Vǫluspá', fonte: 'premessa Ich, «Figure del mondo»' },
        bannsith: { nome: 'Bannsith', fonte: 'premessa Ich, «Figure del mondo»' },
        fearsith: { nome: 'Fearsith', fonte: 'premessa Ich, «Figure del mondo»' },
        skera: { nome: 'Skéra', fonte: 'premessa Ich, «Figure del mondo»' },
        aratare: { nome: 'Aratare', fonte: 'premessa Ich, «Figure del mondo»' }
      },
      /* Verità riservate (correzione dell'autore): solo motore e Narratore
         fino al fatto che le rivela. La rivelazione pianificata dal copione
         è ich_truth_therapy (Atto III): prima di essa le nature dei preset
         (ich_fact_natura_*) non sono mai scoperte, e il lessico tecnico
         della campagna si sblocca con lo stesso fatto. Le «parole» entrano nel lessico
         riservato (RMSoloCampaign.lockedLexicon), quindi valgono per
         scheda iniziale, anteprime, Diario, narrazione e contesto del
         modello locale. */
      verita: {
        erdegis_artificiale: { testo: 'Erdegis è un ambiente artificiale terapeutico.', rivelazione: 'ich_truth_therapy', parole: ['ambiente artificial', 'ambiente programmat', 'percors[oi] terapeutic'] },
        fruitori_silenziosi: { testo: 'I fruitori silenziosi vivono attraverso corpi reverie.', rivelazione: 'ich_truth_therapy', parole: ['fruitor', 'corp[oi] reverie'] },
        reverie_non_coscienti: { testo: 'Non tutte le reverie sono coscienti o controllate.', rivelazione: 'ich_truth_therapy', parole: ['reverie (non )?controllat', 'reverie ordinari'] },
        skera_hacker: { testo: 'Gli Skéra sono hacker che possono aver perso i ricordi.', rivelazione: 'ich_truth_therapy', parole: ['hacker'] },
        voluspa_bot: { testo: 'I Vǫluspá sono bot di controllo con un motore probabilistico che sognano esperienze altrui.', rivelazione: 'ich_truth_therapy', parole: ['bot di controllo', 'motore probabilistic'] },
        kyn_codice: { testo: 'I Kyn sono creazioni primordiali del settore che, coscienti, influenzano il codice.', rivelazione: 'ich_truth_therapy', parole: ['creazion[ei] primordial[ei] del settore', '(influenz|riscriv|padroneggi)\\w* (il )?codice'] },
        bannsith_residui: { testo: 'Le Bannsith sono progettate per eliminare i residui di coscienza, che percepiscono come spettri.', rivelazione: 'ich_truth_therapy', parole: ['residu[oi] di coscienza', 'bot di manutenzione'] }
      }
    },

    icaro: {
      // colori del Cromo: classi sociali/professionali, MAI fazioni
      classiSociali: {
        bianco: { nome: 'Bianco — Icaro', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        giallo: { nome: 'Giallo', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        amaranto: { nome: 'Amaranto', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        arancio: { nome: 'Arancio', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        verde: { nome: 'Verde', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        blu: { nome: 'Blu', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        viola: { nome: 'Viola', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        grigio: { nome: 'Grigio — Spenti', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        nero: { nome: 'Nero — Spegni-luce', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        senza_colore: { nome: 'Senza colore', fonte: 'premessa Icaro, «Il sistema Cromo»' }
      },
      citta: { c1: { nome: 'C1' }, c2: { nome: 'C2' }, c3: { nome: 'C3' }, c4: { nome: 'C4' }, c5: { nome: 'C5' }, c6: { nome: 'C6' }, c7: { nome: 'C7' }, c8: { nome: 'C8' }, c9: { nome: 'C9' } },
      corporazioni: {
        blackroot: { nome: 'BlackRoot Industries', citta: 'c1', fonte: 'premessa Icaro, «C1»' },
        bernard: { nome: 'Bernard', citta: 'c3', fonte: 'premessa Icaro, «C3»' },
        allure_systems: { nome: 'Allure Systems Corporation', citta: 'c2', fonte: 'premessa Icaro, «C2»' },
        eden_bioforge: { nome: 'Eden Bioforge', citta: 'c5', fonte: 'premessa Icaro, «C5»' },
        next_tech: { nome: 'Next Tech', citta: 'c5', fonte: 'premessa Icaro, «C5»' },
        delos_industries: { nome: 'Delos Industries', citta: 'c6', fonte: 'premessa Icaro, «C6»' },
        fate_trade: { nome: 'Fate Trade', citta: 'c7', fonte: 'premessa Icaro, «C7»' },
        kirov_dynamics: { nome: 'Kirov Dynamics', citta: 'c7', fonte: 'premessa Icaro, «C7»' },
        medsync: { nome: 'MedSync', citta: 'c8', fonte: 'premessa Icaro, «C8»' },
        crypto_memories: { nome: 'Crypto Memories', citta: 'c9', fonte: 'premessa Icaro, «C9»' },
        lloyd_defence: { nome: 'Lloyd Defence', citta: null, fonte: 'premessa Icaro, «Figure del mondo»: i Patrioti sono il corpo armato della Lloyd Defence' }
      },
      // gruppi politici, correnti e reti: distinti dai colori
      gruppiPolitici: {
        reionizzati: { nome: 'Reionizzati', fonte: 'premessa Icaro, «Correnti di pensiero»' },
        utilitarismo: { nome: 'Utilitarismo', tipo: 'corrente', fonte: 'premessa Icaro, «Correnti di pensiero»' },
        inflazione: { nome: 'Inflazione', tipo: 'corrente', fonte: 'premessa Icaro, «Correnti di pensiero»' },
        anonymous: { nome: 'Anonymous', tipo: 'rete clandestina', fonte: 'premessa Icaro, «C6» e «Il sistema Cromo»' },
        senzavolto: { nome: 'Senzavolto', tipo: 'rete clandestina', fonte: 'premessa Icaro, «Il sistema Cromo»' },
        demo: { nome: 'Demo', tipo: 'rete clandestina', fonte: 'premessa Icaro' },
        dotcom: { nome: 'Dotcom', tipo: 'rete clandestina', fonte: 'premessa Icaro' }
      },
      famiglieCreature: {
        predatore_del_ghiaccio: { nome: 'Predatore del ghiaccio', fonte: 'copione Icaro: nemici.predatore_ghiaccio' }
      },
      esterno: {
        abitabile: false,
        fonte: 'premessa Icaro, «Corpi, abiti e armature»: «All\'esterno delle cupole la tuta è obbligatoria»; correzione dell\'autore: esterno ghiacciato, privo di ossigeno e inabitabile',
        // tre elementi, tutti necessari
        protezione: [
          { id: 'tuta', nome: 'tuta termica', re: /\btut[ae]\b|\baerogel/i },
          { id: 'casco', nome: 'casco sigillato', re: /\bcasc[oh]i?\b|\bvisor[ei]\b|\bvisiera\b/i },
          { id: 'ossigeno', nome: 'riserva d\'ossigeno', re: /ossigeno|respirat|bombol/i }
        ]
      }
    }
  };

  function reg(storia) { return REGISTRO[storia] || null; }
  function storiaDi(content) { return content && (content.storia || (String(content.id || '').split('-')[0])) || null; }

  /* Che cosa è un identificativo in una storia: un solo tipo per voce. */
  function tipoDi(storia, id) {
    const R = reg(storia); if (!R || id == null) return null;
    const k = String(id).toLowerCase();
    const cerca = [['fazioni', 'fazione'], ['terzeForze', 'forza_terza'], ['famiglieCreature', 'creatura'], ['materiali', 'materiale'],
      ['societa', 'societa'], ['figure', 'figura'], ['culture', 'cultura'], ['regioni', 'regione'], ['insediamenti', 'insediamento'],
      ['classiSociali', 'classe_sociale'], ['corporazioni', 'corporazione'], ['gruppiPolitici', 'gruppo_politico'], ['citta', 'citta'], ['popolazioni', 'popolazione'], ['popoli', 'popolo']];
    for (const [sez, tipo] of cerca) if (R[sez] && R[sez][k]) return tipo;
    return null;
  }

  /* ------------------------------------------------ validazione preset */
  const CAMPI = ['entityType', 'peopleId', 'factionId', 'cultureId', 'regionId', 'roleId', 'creatureFamilyId', 'socialClassId', 'corporationId', 'playable', 'playerVisible', 'narratorOnly'];

  function ontologiaDi(ent) { return (ent && ent.ontologia) || null; }

  function validaPreset(arch, storia) {
    const e = [];
    const o = ontologiaDi(arch);
    if (!o) return ['campi ontologici assenti'];
    CAMPI.forEach(k => { if (!(k in o)) e.push('campo ' + k + ' assente'); });
    const R = reg(storia);
    if (!R) return e.concat(['storia senza registro: ' + storia]);
    // nessuna famiglia di creature in un campo di appartenenza
    ['peopleId', 'factionId', 'cultureId', 'regionId', 'societyId', 'cityId'].forEach(k => {
      if (o[k] != null && tipoDi(storia, o[k]) === 'creatura') e.push(k + ': ' + o[k] + ' è una famiglia di creature, non un\'appartenenza');
    });
    if (o.creatureFamilyId && o.playable) e.push('una creatura (' + o.creatureFamilyId + ') come preset giocabile');
    if (o.factionId != null) {
      const t = tipoDi(storia, o.factionId);
      if (!t) e.push('factionId inesistente: ' + o.factionId);
      else if (t === 'classe_sociale') e.push('colore del Cromo usato come fazione: ' + o.factionId);
      else if (t === 'figura') e.push('figura trasversale usata come fazione: ' + o.factionId);
      else if (t === 'societa') e.push('società (Stad/Stam) usata come fazione: ' + o.factionId);
      else if (t === 'corporazione') e.push('corporazione usata come fazione: ' + o.factionId);
      else if (t !== 'fazione' && t !== 'forza_terza') e.push('factionId di tipo ' + t + ': ' + o.factionId);
      if (t === 'forza_terza' && !(o.fonti && o.fonti.factionId && /autore|premessa|copione/i.test(o.fonti.factionId))) e.push('appartenenza a una forza terza senza fonte esplicita: ' + o.factionId);
    }
    if (storia === 'eidos' && o.peopleId && tipoDi(storia, o.peopleId) === 'popolazione' && R.popolazioni[o.peopleId].giocabile === 'solo_con_fonte' && !(o.fonti && o.fonti.peopleId && /autore|premessa|copione/i.test(o.fonti.peopleId))) e.push('popolazione ' + o.peopleId + ' senza fonte esplicita');
    if (storia === 'eidos' && o.peopleId === 'antarsi') e.push('peopleId: Antarsi è appartenenza politica, non popolo');
    // classi vietate dalla premessa per l'appartenenza
    const viet = (R.classiVietate || {})[o.factionId] || [];
    if (viet.indexOf(arch.build) !== -1) e.push(o.factionId + ': classe ' + arch.build + ' non ammessa dalla premessa');
    if (o.socialClassId != null && tipoDi(storia, o.socialClassId) !== 'classe_sociale') e.push('socialClassId non è un colore del Cromo: ' + o.socialClassId);
    if (o.corporationId != null && tipoDi(storia, o.corporationId) !== 'corporazione') e.push('corporationId inesistente: ' + o.corporationId);
    if (o.societyId != null && tipoDi(storia, o.societyId) !== 'societa') e.push('societyId non è Stad o Stam: ' + o.societyId);
    if (o.figureId != null && tipoDi(storia, o.figureId) !== 'figura') e.push('figureId non è una figura trasversale: ' + o.figureId);
    if (storia === 'icaro') ['cityId', 'politicalGroupId'].forEach(k => { if (!(k in o)) e.push('Icaro: ' + k + ' assente'); });
    if (storia === 'icaro' && o.politicalGroupId != null && tipoDi(storia, o.politicalGroupId) !== 'gruppo_politico') e.push('politicalGroupId inesistente: ' + o.politicalGroupId);
    if (storia === 'ich') ['societyId', 'figureId'].forEach(k => { if (!(k in o)) e.push('Ich: ' + k + ' assente'); });
    // verità riservate: solo nel blocco narratorOnly, mai nei campi pubblici
    if (storia === 'ich') {
      const pub = JSON.stringify(Object.assign({}, o, { narratorOnly: null, riservato: null, fonti: null, dubbi: null, proposte: null }));
      paroleRiservate(storia).forEach(r => r.parole.forEach(w => { if (new RegExp('\\b' + w, 'i').test(pub)) e.push('verità riservata in un campo pubblico: ' + w); }));
    }
    return e;
  }

  /* Classe mostrata dall'interfaccia contro classe del motore. */
  function validaClasse(arch, pg, etichettaUI) {
    const B = typeof BUILDS !== 'undefined' ? BUILDS : (global.BUILDS || {});
    const attesa = (B[arch.build] || {}).label;
    const e = [];
    if (pg && pg.build !== arch.build) e.push('classe del motore ' + pg.build + ' diversa dai dati ' + arch.build);
    if (etichettaUI != null && etichettaUI !== attesa) e.push('classe mostrata «' + etichettaUI + '» diversa dalla classe del motore «' + attesa + '»');
    return e;
  }

  /* ----------------------------------------------- avversari e PNG */
  function validaAvversario(sh, storia) {
    const e = [];
    if (!sh || sh.separataDalBilanciamento) return e;
    const fam = sh.enemyFamilyId && tipoDi(storia, sh.enemyFamilyId) === 'creatura';
    if (sh.factionId != null) {
      const t = tipoDi(storia, sh.factionId);
      if (t === 'creatura') e.push('famiglia di creature usata come fazione: ' + sh.factionId);
      if (t === 'classe_sociale') e.push('colore del Cromo usato come fazione: ' + sh.factionId);
      if (t === 'corporazione') e.push('corporazione usata come fazione: ' + sh.factionId + ' (va in corporationId)');
      if (t === 'figura') e.push('figura trasversale usata come fazione: ' + sh.factionId);
    }
    if (fam && (sh.factionId || sh.peopleId)) e.push('una creatura con fazione o popolo');
    if (fam && sh.classId) e.push('una creatura con una classe di personaggio (' + sh.classId + '): usa statProfileId');
    return e;
  }
  function validaPng(p, storia) {
    const o = ontologiaDi(p); if (!o) return [];
    return validaPreset(Object.assign({ build: null }, p), storia).filter(x => !/campo (playable|roleId)|Icaro: (cityId|politicalGroupId)|Ich: (societyId|figureId)/.test(x));
  }

  /* -------------------------------------------- verità riservate (Ich) */
  function paroleRiservate(storia) {
    const R = reg(storia);
    if (!R || !R.verita) return [];
    return Object.entries(R.verita).map(([id, v]) => ({ fino_a: v.rivelazione, parole: v.parole.slice(), verita: id }));
  }
  function veritaToccate(storia, testo, fattiScoperti) {
    const noti = fattiScoperti || [];
    const out = [];
    paroleRiservate(storia).filter(r => noti.indexOf(r.fino_a) === -1).forEach(r => r.parole.forEach(w => { if (new RegExp('\\b' + w, 'i').test(String(testo || ''))) out.push(r.verita + ':' + w); }));
    return out;
  }

  /* -------------------------------------------- esterno di Icaro */
  function oggettiPortati(state, content) {
    const pg = state.personaggio || {};
    const nomi = (pg.equip || []).map(x => (x.nome || '') + ' ' + (x.id || ''));
    (state.inventario || []).forEach(i => {
      const E = global.RMSoloEngine;
      const d = E && E.itemInfo ? E.itemInfo(state, content, i.id) : null;
      if (d) nomi.push(d.nome + ' ' + (d.descrizione || ''));
    });
    return nomi.join(' | ');
  }
  function scenaEsterna(state, content) {
    const E = global.RMSoloEngine;
    const sc = E && E.currentScene ? E.currentScene(state, content) : null;
    return sc && sc.esterno ? sc : null;
  }
  /* La protezione vale se la porta il personaggio, o se la scena
     esterna la dichiara nei dati (esterno.protezione: la scena narra la
     vestizione prima di uscire). */
  function protezioneSigillata(state, content) {
    const R = reg(storiaDi(content));
    if (!R || !R.esterno) return { ok: true, mancanti: [] };
    const sc = scenaEsterna(state, content);
    const testo = oggettiPortati(state, content) + (sc ? ' | ' + sc.esterno.protezione : '');
    const mancanti = R.esterno.protezione.filter(p => !p.re.test(testo)).map(p => p.nome);
    return { ok: !mancanti.length, mancanti, fonte: sc ? 'scena' : 'dotazione' };
  }
  const RE_USCITA = /\b(esco|usciamo|uscire|esci|vado|andare|mi avventuro|avventurarmi|mi spingo|raggiungo|raggiungere|attraverso)\b[^.!?]{0,40}\b(fuori dall[ae] cupol\w*|oltre la cupola|all'esterno|sul ghiaccio|in superficie|fra le rovine congelate)/i;
  const RE_SCOPRE = /\b(tolgo|togli|togliermi|togliere|sfilo|sfilarmi|apro|aprire|sollevo|alzo|levo|slaccio|sgancio)\b[^.!?]{0,25}\b(casco|visiera|visore|respiratore|maschera|tuta)\b|\b(volto|viso) scoperto\b|\bsenza (il )?(casco|tuta|respiratore)\b/i;
  /* Azione verso l'esterno: in una scena esterna scoprirsi il volto è
     rifiutato; da dentro, uscire senza protezione completa diventa una
     richiesta di preparazione. null se l'azione non riguarda l'esterno. */
  function azioneEsterna(state, content, testo) {
    const R = reg(storiaDi(content));
    if (!R || !R.esterno || !testo) return null;
    const t = String(testo);
    const sc = scenaEsterna(state, content);
    if (sc && RE_SCOPRE.test(t)) return { tipo: 'rifiuto', motivo: 'Fuori dalle cupole il gelo e l\'aria senza ossigeno uccidono: tuta, casco e respiratore restano sigillati finché non torni al riparo.' };
    if (!sc && RE_USCITA.test(t)) {
      const p = protezioneSigillata(state, content);
      if (!p.ok) return { tipo: 'preparazione', motivo: 'Prima di uscire devi prepararti: all\'esterno servono ' + p.mancanti.join(', ').replace(/, ([^,]*)$/, ' e $1') + '.', mancanti: p.mancanti };
    }
    return null;
  }

  /* ------------------------------------------ contesto del Narratore */
  const CONTESTO = {
    eidos: 'Ontologia: Chorisfos ed Epizi sono le fazioni in guerra; gli Antarsi una forza terza di persone diverse; gli Eporiani una popolazione distinta che commercia con Epizi e Chorisfos, senza neutralità personale automatica. I Tèras sono creature: mai un popolo, una fazione o una provenienza; gli oggetti in osso di Tèras sono lavorati da persone.',
    ich: 'Ontologia: Stad (città) e Stam (clan) sono società; Kyn, Vǫluspá, Bannsith e Skéra sono figure che attraversano ogni società, non fazioni né territori.',
    icaro: 'Ontologia: i colori del Cromo sono classi sociali, non fazioni né alleanze; città, corporazioni e gruppi politici sono distinti. Fuori dalle cupole gelo e aria senza ossigeno uccidono: chiunque sia all\'esterno indossa tuta termica, casco sigillato e respiratore, mai il volto scoperto.'
  };
  function contesto(storia) { return CONTESTO[storia] || ''; }

  /* Etichetta pubblica della provenienza, dai campi strutturati (mai i
     campi narratorOnly). */
  function etichetta(arch, storia) {
    const o = ontologiaDi(arch); const R = reg(storia);
    if (!o || !R) return arch && arch.popolazione || '';
    const nome = (sez, id) => id && R[sez] && R[sez][id] ? R[sez][id].nome : null;
    if (storia === 'ich') return [nome('societa', o.societyId), nome('figure', o.figureId)].filter(Boolean).join(' · ') || arch.popolazione;
    return arch.popolazione;
  }

  const api = { FONTE, REGISTRO, CAMPI, reg, tipoDi, validaPreset, validaClasse, validaAvversario, validaPng, paroleRiservate, veritaToccate,
    protezioneSigillata, azioneEsterna, contesto, etichetta, storiaDi };
  global.RMSoloOntologia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
