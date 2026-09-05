/* Sincronizzazione personaggio col cloud + ingresso in una storia (punto 4)
   e assegnazione livello dal Narratore con accredito AP reale (la domanda
   a cui questo file risponde: si', ora e' collegato davvero).

   Tutto qui e' opt-in: senza toccare "Storia in cloud" il personaggio
   resta locale come sempre, nessun account viene richiesto. */

/* Il ritratto (base64, già ridimensionato a max 512px in loadPortraitFile)
   viaggia insieme al resto dei dati di gioco: senza, il personaggio
   sincronizzato su un altro dispositivo restava senza immagine. */
function characterCloudPayload(c) {
  const payload = { ...c };
  // narratorEditGuest (openCharacterForNarratorEdit, js/app.js): flag
  // puramente locale/effimero — segna una copia temporanea "ospite" creata
  // SOLO per far scorrere l'editor scheda esistente quando il Narratore
  // corregge il personaggio di un giocatore, mai un dato di gioco vero.
  // Se finisse nel payload, narratore_update_character_data lo scriverebbe
  // per davvero nella riga cloud del GIOCATORE (nessuna pulizia server-side,
  // `data = p_data` letterale): al sync successivo applyFullCloudSnapshot
  // lo re-importerebbe sul personaggio reale del giocatore, e
  // visibleCharacters() lo farebbe sparire dalla sua lista — mai inviato.
  delete payload.narratorEditGuest;
  return payload;
}

async function pushCharacterToCloud(c) {
  const session = await ensureCloudAccount();
  if (!session) throw new Error('Serve un account per salvare nel cloud');
  const payload = {
    owner_user_id: session.user.id,
    name: c.nome || 'Senza nome',
    // 'bozza' finché il wizard di creazione non è stato completato
    // (c.creationCompleted) — vedi characters.sheet_status in
    // supabase/migrations/20260721200000_campaigns_and_accounts.sql
    sheet_status: c.creationCompleted ? 'attiva' : 'bozza',
    data: characterCloudPayload(c)
  };
  if (c.cloudCharacterId) {
    // Controllo di versione ottimistico: se conosciamo l'ultima versione
    // vista (c.cloudVersion), la scrittura si aggancia esplicitamente a
    // quella riga — se nel frattempo qualcun altro ha scritto (Narratore,
    // altro dispositivo), il filtro non combacia più nessuna riga e la
    // scrittura fallisce invece di sovrascrivere alla cieca. Senza questo,
    // un dispositivo rimasto settimane senza aprire la scheda cancellava in
    // silenzio ogni correzione fatta nel frattempo (bug segnalato su
    // Chroma Karsavina). Prima volta che si salva (cloudVersion ancora
    // null) nessun filtro: non c'è nulla con cui confrontarsi.
    const expectedVersion = (c.cloudVersion === null || c.cloudVersion === undefined) ? null : Number(c.cloudVersion);
    let query = sb.from('characters').update(payload).eq('id', c.cloudCharacterId);
    if (expectedVersion !== null) query = query.eq('current_version', expectedVersion);
    const { data, error } = await withTimeout(query.select('current_version').single(), 'Salvataggio scheda');
    if (error) {
      // PGRST116 ("0 righe") con il filtro di versione attivo: o la riga non
      // esiste più (cancellata altrove — stessa causa già gestita in
      // syncCharacterFromCloud), o più probabilmente qualcuno ha scritto nel
      // frattempo e la nostra versione attesa non combacia più. Una lettura
      // mirata (senza filtro di versione) distingue i due casi.
      if (error.code === 'PGRST116' && expectedVersion !== null) {
        const { data: fresh, error: freshErr } = await withTimeout(
          sb.from('characters').select('level, campaign_id, data, current_version').eq('id', c.cloudCharacterId).single(),
          'Verifica conflitto'
        );
        if (freshErr) throw error; // riga davvero sparita: il messaggio originale resta valido
        // Conflitto vero: se questo personaggio è quello attualmente a
        // schermo si chiede subito quale versione tenere (stesso
        // meccanismo di syncCharacterFromCloud, mai una scelta automatica
        // silenziosa); altrimenti (autosave in background, app in secondo
        // piano) si lascia cloudDirty com'era — nessuna modifica persa, si
        // risolve alla prossima apertura vera della scheda.
        if (typeof getActive === 'function' && getActive() === c) {
          await resolveVersionConflict(c, fresh);
        }
        return;
      }
      throw error;
    }
    // Il numero di versione (incrementato dal trigger record_character_version
    // a ogni UPDATE) e' cio' che syncCharacterFromCloud usa per capire se un
    // altro dispositivo ha scritto qualcosa di piu' recente: senza tenerlo
    // aggiornato qui, questo stesso push sembrerebbe "novita' da scaricare".
    c.cloudVersion = data.current_version;
    c.cloudDirty = false;
    // saveAll() SUBITO: l'autopush parte da un setTimeout (scheduleCloudAutoPush,
    // js/app.js) 2.5s dopo l'ultima modifica, spesso proprio mentre l'utente
    // sta per chiudere l'app da telefono. Senza salvare qui, cloudVersion/
    // cloudDirty aggiornati restavano solo in memoria: se l'app si chiudeva
    // prima della PROSSIMA modifica (che avrebbe richiamato saveAll tramite
    // touchActive), il localStorage restava con la versione vecchia e
    // cloudDirty:true — alla riapertura, anche dallo STESSO dispositivo, il
    // cloud sembrava sempre "più avanti con modifiche nostre in sospeso":
    // esattamente il conflitto fantasma segnalato ("ogni volta che entro dal
    // telefono mi chiede quale versione tenere").
    if (typeof saveAll === 'function') saveAll();
  } else {
    const { data, error } = await withTimeout(
      sb.from('characters').insert(payload).select('id, current_version').single(),
      'Salvataggio scheda'
    );
    if (error) throw error;
    c.cloudCharacterId = data.id;
    touchActive();
    // Dopo touchActive() (che rimarca cloudDirty:true): questo primo salvataggio
    // e' gia' perfettamente allineato col cloud appena creato.
    c.cloudVersion = data.current_version;
    c.cloudDirty = false;
    if (typeof saveAll === 'function') saveAll();
  }
}

/* Risolve un conflitto di versione rilevato sulla riga freshRow appena letta
   dal server ({level, campaign_id, data, current_version}): stessa identica
   scelta (tieni la mia versione / scarica quella cloud) usata sia da
   syncCharacterFromCloud (controllo anticipato all'apertura scheda) sia da
   pushCharacterToCloud (controllo al momento stesso della scrittura) — mai
   duplicata, mai una scelta automatica silenziosa quando ci sono modifiche
   locali in sospeso. */
async function resolveVersionConflict(c, freshRow, pushFn) {
  const push = pushFn || pushCharacterToCloud;
  const serverVersion = Number(freshRow.current_version) || 1;
  const choice = await promptSyncConflict(c, freshRow.level, freshRow.data);
  if (choice === 'cloud') {
    applyFullCloudSnapshot(c, freshRow);
  } else {
    // Scelta esplicita di sovrascrivere: allinea la versione attesa a
    // quella appena letta, altrimenti il controllo di versione al prossimo
    // salvataggio fallirebbe di nuovo in loop sullo stesso conflitto.
    c.cloudVersion = serverVersion;
    await push(c);
  }
  c.cloudSyncPending = false;
}

/* Eliminazione locale di un personaggio già salvato nel cloud: senza
   cancellare anche la riga cloud (RLS "personaggi: elimina solo
   proprietario", già in uso), syncMyCharactersFromCloud lo re-importerebbe
   subito, facendolo "resuscitare" alla prossima apertura dell'elenco. */
async function deleteCharacterCloud(cloudCharacterId) {
  const { error } = await withTimeout(sb.from('characters').delete().eq('id', cloudCharacterId), 'Eliminazione scheda dal cloud');
  if (error) throw error;
}

/* Elenco (id/nome/livello/campagna/dati) di TUTTI i personaggi che l'utente
   possiede nel cloud, indipendentemente dal dispositivo che li ha salvati:
   basta la RLS "personaggi: proprietario" (owner_user_id = auth.uid()) già
   esistente, nessuna RPC dedicata. Solo account permanenti: un ospite è per
   definizione legato a questo solo dispositivo, non ha nulla da elencare da
   un altro. */
async function listMyCloudCharacters() {
  const session = await currentCloudSession();
  if (!session || isGuestUser(session)) return [];
  const { data, error } = await withTimeout(
    sb.from('characters').select('id, name, level, campaign_id, data, current_version, updated_at').eq('owner_user_id', session.user.id).eq('is_npc', false),
    'I tuoi personaggi (cloud)'
  );
  if (error) throw error;
  return data || [];
}

/* Importa in locale i personaggi dell'account salvati nel cloud da un ALTRO
   dispositivo (qui ancora sconosciuti: nessuna riga locale ha il loro
   cloudCharacterId) — senza, un personaggio creato e salvato nel cloud su
   un dispositivo non comparirebbe mai aprendo l'app su un altro. Un nuovo id
   locale viene sempre assegnato (l'id locale è per-dispositivo, solo
   cloudCharacterId è la chiave condivisa).

   Quelli già noti su questo dispositivo vengono invece passati per intero a
   syncCharacterFromCloud (stessa funzione usata aprendo la scheda): senza,
   l'elenco "I tuoi personaggi" restava fermo ai dati dell'ultima apertura
   QUI, mostrando un livello/una campagna vecchi se il personaggio era stato
   giocato e aggiornato nel frattempo da un altro dispositivo (es. livello
   assegnato dal Narratore mentre si giocava dal telefono, mai comparso
   nell'elenco visto da un browser diverso finché non si apriva proprio
   quella scheda lì). Qui sotto il personaggio non è mai quello "attivo"
   (nessuna scheda è aperta, si è nell'elenco): gli eventuali render
   richiamati da syncCharacterFromCloud scrivono su elementi della scheda,
   invisibili in questa vista e comunque ripopolati per intero alla prossima
   apertura reale (renderSheet) — nessun rischio di sporcare la scheda di un
   altro personaggio. */
async function syncMyCharactersFromCloud() {
  let cloudChars;
  try { cloudChars = await listMyCloudCharacters(); } catch (e) { return false; }
  if (!cloudChars.length) return false;
  // listMyCloudCharacters filtra già lato server per owner_user_id = questo
  // account: ogni riga qui dentro appartiene per certo a chi è loggato ora,
  // quindi ownerAccountId (identità locale del dispositivo, vedi
  // visibleCharacters) va sempre allineato a questo account — mai lasciato
  // ereditare il valore scritto dentro data.ownerAccountId dal DISPOSITIVO
  // che ha creato/pushato per ultimo quella riga (es. il Narratore, se il
  // personaggio arriva da narratore_share_character): altrimenti il
  // personaggio resta invisibile in "I tuoi personaggi" pur essendo
  // correttamente tuo lato cloud (stesso bug corretto qui per i nuovi
  // import e per quelli già collegati sotto).
  const session = await currentCloudSession();
  const myUid = session && session.user && session.user.id;
  let importedAny = false;
  let fixedOwnerAny = false;
  const alreadyLinked = [];
  cloudChars.forEach(row => {
    const existing = characters.find(c => c.cloudCharacterId === row.id);
    if (existing) {
      if (myUid && existing.ownerAccountId !== myUid) { existing.ownerAccountId = myUid; fixedOwnerAny = true; }
      alreadyLinked.push(existing);
      return;
    }
    const c = Object.assign({}, row.data, {
      id: uid(),
      nome: (row.data && row.data.nome) || row.name,
      livello: Number(row.level) || 1,
      cloudCharacterId: row.id,
      cloudCampaignId: row.campaign_id || null,
      ownerAccountId: myUid || null,
      // cloudVersion/cloudDirty: MAI ereditati da row.data (che porta
      // qualunque valore ci fosse scritto dentro l'ultimo dispositivo che ha
      // salvato questa riga — es. la versione di QUEL dispositivo al momento
      // del suo ultimo push, o un cloudDirty rimasto true per una finestra
      // di tempo) — la fonte di verità è sempre current_version, la stessa
      // colonna server già usata da openCharacterForNarratorEdit più sotto
      // in app.js. Senza questo, un personaggio importato per la prima
      // volta su un nuovo dispositivo (o ricevuto via narratore_share_
      // character, che copia data così com'è) parte con una cloudVersion
      // sbagliata: il prossimo giro di syncCharacterFromCloud la confronta
      // con quella server vera, la trova "indietro" e apre un popup di
      // conflitto fantasma già alla primissima sincronizzazione.
      cloudVersion: Number(row.current_version) || 1,
      cloudDirty: false,
      narratorEditGuest: false
    });
    ensureShape(c);
    characters.push(c);
    importedAny = true;
  });
  if (importedAny || fixedOwnerAny) saveAll();
  let refreshedAny = false;
  let pendingAny = false;
  for (const c of alreadyLinked) {
    // allowConflictPrompt:false — qui siamo ancora nell'elenco, non nella
    // scheda di QUESTO personaggio: un eventuale conflitto di versione si
    // rimanda a quando lo si apre davvero (vedi syncCharacterFromCloud)
    try {
      if (await syncCharacterFromCloud(c, false)) refreshedAny = true;
      if (c.cloudSyncPending) pendingAny = true;
    } catch (e) { /* un personaggio irraggiungibile non deve bloccare gli altri */ }
  }
  // cloudSyncPending va salvato anche se non e' scattato alcun push (nessuna
  // novita' "sicura" da scaricare, solo un conflitto rimandato): senza,
  // chiudendo l'app subito dopo l'elenco il flag si perdeva prima di riaprire
  // la scheda che dovrebbe poi mostrarlo.
  if (pendingAny && !refreshedAny) saveAll();
  return importedAny || refreshedAny || fixedOwnerAny;
}

async function requestJoinCampaign(c, campaignId, campaignName) {
  if (!c.cloudCharacterId) throw new Error('Salva prima il personaggio nel cloud');
  const { data, error } = await withTimeout(
    sb.rpc('request_join_campaign', { p_campaign_id: campaignId, p_character_id: c.cloudCharacterId }),
    'Richiesta di ingresso'
  );
  if (error) throw error;
  c.cloudJoinRequestId = data.id;
  c.cloudJoinCampaignId = campaignId;
  c.cloudJoinCampaignName = campaignName;
  touchActive();
  return data;
}

/* ------------------------------------------- database tratti di campagna */

/* Un tratto personalizzato (dalla scheda Tratti o da un bonus di scudo/
   arma) aggiunto da un personaggio dentro una campagna viene PROPOSTO al
   database condiviso della storia, ma non è pescabile dagli altri finché
   il Narratore non lo approva da Account -> dettaglio campagna (evita
   doppioni da refusi: vedi approve_known_trait/reject_known_trait).
   Fuori da una campagna (c.cloudCampaignId assente) queste funzioni non
   vengono mai chiamate: il campo resta testo libero come sempre. Cache in
   memoria per campagna: non è un dato che cambia spesso, non serve
   rileggerlo a ogni render. */
const campaignTraitsCache = {};

function emptyCampaignTraits() {
  return { conoscenze: [], capacitaNormali: [], capacitaCombattive: [] };
}

/* Rilettura best-effort: se la rete non risponde si tiene la cache già
   presente (anche vuota) invece di bloccare la scheda. Solo i tratti già
   approvati dal Narratore risultano pescabili qui. */
async function fetchCampaignKnownTraits(campaignId) {
  if (!campaignId) return null;
  try {
    const { data, error } = await withTimeout(
      sb.from('campaign_known_traits').select('list_key, name').eq('campaign_id', campaignId).eq('status', 'approved'),
      'Tratti condivisi della storia'
    );
    if (error) throw error;
    const grouped = emptyCampaignTraits();
    (data || []).forEach(r => { if (grouped[r.list_key]) grouped[r.list_key].push(r.name); });
    campaignTraitsCache[campaignId] = grouped;
  } catch (e) {
    if (!campaignTraitsCache[campaignId]) campaignTraitsCache[campaignId] = emptyCampaignTraits();
  }
  return campaignTraitsCache[campaignId];
}

/* Lettura sincrona dalla sola cache (per il render, che non può aspettare
   una chiamata di rete): vuota finché fetchCampaignKnownTraits non ha
   risposto almeno una volta per questa campagna. */
function cachedCampaignKnownTraits(campaignId) {
  return campaignTraitsCache[campaignId] || emptyCampaignTraits();
}

/* Propone un nome di tratto appena scritto alla campagna (resta "in
   attesa" finché il Narratore non lo approva): "best effort", un errore
   di rete non deve impedire di usare il tratto in locale (resta comunque
   valido sulla scheda del giocatore che l'ha scritto). Non viene aggiunto
   alla cache locale qui: non è ancora pescabile dagli altri finché non è
   approvato, la cache si aggiorna solo alla prossima fetchCampaignKnownTraits. */
async function addCampaignKnownTrait(campaignId, listKey, name) {
  if (!campaignId || !listKey || !name) return;
  const session = await currentCloudSession();
  if (!session) return;
  try {
    await withTimeout(
      sb.from('campaign_known_traits').upsert(
        { campaign_id: campaignId, list_key: listKey, name, created_by: session.user.id },
        { onConflict: 'campaign_id,list_key,name', ignoreDuplicates: true }
      ),
      'Proposta tratto'
    );
  } catch (e) { /* proposta facoltativa: il tratto resta comunque valido in locale */ }
}

/* Controlla lo stato reale della scheda cloud: la richiesta e' stata
   accettata? Il Narratore ha assegnato un nuovo livello? La storia e' stata
   eliminata (cestino) o svuotata definitivamente? In tal caso applica in
   locale lo stesso identico accredito AP di un level-up manuale
   (creditLevelAP), cosi' la formula resta unica e non duplicata.

   allowConflictPrompt=false (usata solo dalla scansione in background
   dell'elenco "I tuoi personaggi", vedi syncMyCharactersFromCloud): rimanda
   l'eventuale conflitto di versione a quando si apre DAVVERO quella scheda,
   invece di mostrare il popup mentre si è ancora nell'elenco per un
   personaggio che magari non si sta nemmeno per aprire. Lo stato live della
   campagna (sessione, cestino, richiesta d'ingresso) viene comunque
   aggiornato subito: non è mai un conflitto, solo lettura fresca dal server. */
async function syncCharacterFromCloud(c, allowConflictPrompt = true) {
  if (!c.cloudCharacterId) return false;
  const { data, error } = await withTimeout(
    sb.from('characters').select('level, campaign_id, data, current_version').eq('id', c.cloudCharacterId).single(),
    'Sincronizzazione'
  );
  if (error) {
    // Qualunque errore RESTITUITO da questa query (non un timeout: quello lo
    // gestisce già withTimeout rilanciando la sua eccezione sintetica prima
    // di arrivare qui) significa in pratica sempre la stessa cosa per una
    // ricerca per id singolo: il personaggio non è più leggibile per questo
    // account — riga cancellata (da un altro dispositivo, o un push mai
    // andato a buon fine: PGRST116, "0 righe"), oppure l'intero account
    // cloud che lo possedeva non esiste più (sessione ormai invalida:
    // l'errore può arrivare come 401/AuthApiError invece che come PGRST116).
    // In ogni caso, prima si rilanciava crudo all'utente a ogni
    // "Sincronizza", per sempre: si scollega invece il personaggio dal
    // cloud, cosi' si puo' risalvarlo da capo (anche su un account diverso)
    // invece di restare bloccati su un errore tecnico.
    toast('La scheda non è più raggiungibile nel cloud (personaggio o account eliminati altrove): puoi salvarla di nuovo quando vuoi.');
    c.cloudCharacterId = null;
    c.cloudCampaignId = null;
    c.cloudCampaignName = null;
    c.cloudJoinRequestId = null;
    c.cloudJoinCampaignId = null;
    c.cloudJoinCampaignName = null;
    touchActive();
    return true;
  }

  let changed = false;

  // Non siamo piu' agganciati alla campagna: o e' stata svuotata
  // definitivamente (purge, dopo 30 giorni nel cestino), oppure il Narratore
  // l'ha eliminata, oppure il Narratore ha rimosso proprio questo personaggio
  // dalla storia (kick) senza toccare la campagna stessa. In ogni caso la
  // scheda resta comunque nostra, solo scollegata.
  if (c.cloudCampaignId && !data.campaign_id) {
    toast(`Non fai più parte della storia «${c.cloudCampaignName || ''}»: la tua scheda resta nel tuo archivio.`);
    c.cloudCampaignId = null;
    c.cloudCampaignName = null;
    c.cloudCampaignTrashedAt = null;
    c.cloudCampaignPurgeAt = null;
    changed = true;
  }

  if (data.campaign_id && c.cloudCampaignId !== data.campaign_id) {
    c.cloudCampaignId = data.campaign_id;
    c.cloudCampaignName = c.cloudJoinCampaignName;
    c.cloudJoinRequestId = null;
    toast(`Il Narratore ha accettato la tua richiesta: sei in «${c.cloudJoinCampaignName || 'storia'}»!`);
    changed = true;
  }

  // Richiesta ancora "in attesa" lato nostro, ma non ancora approvata (niente
  // campaign_id): senza questo controllo un rifiuto del Narratore restava
  // invisibile per sempre, il giocatore vedeva "in attesa di conferma" a
  // oltranza e non aveva modo di sceglierne un'altra o rimandarla. La RLS
  // "richieste: richiedente o narratore" permette al richiedente di
  // rileggere il proprio stato direttamente, nessuna RPC dedicata.
  if (!data.campaign_id && c.cloudJoinRequestId) {
    try {
      const { data: req } = await withTimeout(
        sb.from('campaign_join_requests').select('status').eq('id', c.cloudJoinRequestId).single(),
        'Stato richiesta'
      );
      if (req && req.status === 'rejected') {
        toast(`Il Narratore ha rifiutato la tua richiesta per «${c.cloudJoinCampaignName || 'quella storia'}»: puoi sceglierne un'altra o rimandarla.`);
        c.cloudJoinRequestId = null;
        c.cloudJoinCampaignId = null;
        c.cloudJoinCampaignName = null;
        changed = true;
      }
    } catch (e) { /* nessun problema se non leggibile ora: si ricontrolla al prossimo giro */ }
  }

  // Se siamo in una campagna, controlliamo anche se e' nel cestino (la RLS
  // permette ai membri di leggerla comunque, finche' non viene svuotata).
  if (data.campaign_id) {
    try {
      const { data: camp } = await withTimeout(
        sb.from('campaigns').select('deleted_at, purge_at, premise_title, premise_published, owner_user_id, session_active, session_label').eq('id', data.campaign_id).single(),
        'Stato campagna'
      );
      const wasTrashed = !!c.cloudCampaignTrashedAt;
      const wasSessionActive = !!c.cloudSessionActive;
      c.cloudCampaignTrashedAt = (camp && camp.deleted_at) || null;
      c.cloudCampaignPurgeAt = (camp && camp.purge_at) || null;
      c.cloudCampaignPremiseTitle = (camp && camp.premise_title) || null;
      c.cloudCampaignPremisePublished = !!(camp && camp.premise_published);
      c.cloudSessionActive = !!(camp && camp.session_active);
      c.cloudSessionLabel = (camp && camp.session_label) || null;
      if (camp && camp.owner_user_id) {
        const names = await fetchDisplayNames([camp.owner_user_id]);
        c.cloudCampaignNarratoreName = names[camp.owner_user_id] || null;
      }
      if (c.cloudCampaignTrashedAt && !wasTrashed) {
        toast(`Il Narratore ha eliminato «${c.cloudCampaignName || 'la storia'}»: recuperabile ancora per qualche giorno. Esporta la tua scheda per sicurezza.`);
      }
      if (c.cloudSessionActive && !wasSessionActive) {
        toast('Il Narratore ha avviato la sessione: ora puoi usare Riposo, Tecniche e Abilità!');
      } else if (!c.cloudSessionActive && wasSessionActive) {
        toast('Il Narratore ha chiuso la sessione.');
      }
      changed = changed || (!!c.cloudCampaignTrashedAt !== wasTrashed) || (!!c.cloudSessionActive !== wasSessionActive);
    } catch (e) { /* nessun problema se non leggibile: restiamo con lo stato precedente */ }
  }

  // Sync completa della scheda (tratti, equip, tecniche, pendingLoot, e in
  // campagna anche il livello): un tempo qui si aggiornavano a mano solo
  // pochi campi separati (livello/concessioni tratti/pendingLoot), lasciando
  // tutto il resto fermo alla copia locale di QUESTO dispositivo — motivo
  // per cui lo stesso personaggio finiva per avere dati diversi su due
  // dispositivi diversi. current_version (incrementato dal trigger
  // record_character_version a ogni UPDATE, quindi anche da narratore_set_level/
  // narratore_send_loot/le concessioni tratti, non solo dai push del
  // giocatore) dice se il cloud ha qualcosa che questo dispositivo non ha
  // ancora visto; cloudDirty dice se questo dispositivo ha modifiche sue non
  // ancora confermate nel cloud. Le uniche combinazioni possibili:
  //  - cloud non piu' avanti di noi: nulla da fare qui (un eventuale push
  //    delle nostre modifiche locali lo gestisce gia' touchActive/il pulsante
  //    "Sincronizza" più sotto in cloud-character.js).
  //  - cloud piu' avanti, noi senza modifiche in sospeso: sicuro scaricare
  //    tutto, nessun rischio di perdere lavoro.
  //  - cloud piu' avanti E modifiche locali in sospeso (vero conflitto), o
  //    cloudVersion mai tracciata finora (personaggi gia' collegati prima di
  //    questa funzione: non si sa se combaciano) -> si chiede sempre
  //    all'utente quale tenere, mai una scelta automatica silenziosa.
  const serverVersion = Number(data.current_version) || 1;
  const localVersionKnown = c.cloudVersion !== null && c.cloudVersion !== undefined;
  if (!localVersionKnown || serverVersion > Number(c.cloudVersion)) {
    if (!allowConflictPrompt) {
      // scansione in background dell'elenco: si segna solo che c'è un
      // possibile disallineamento, la scelta (o il download silenzioso) si fa
      // alla prossima apertura vera e propria di QUESTA scheda
      c.cloudSyncPending = true;
    } else if (c.cloudDirty || !localVersionKnown) {
      await resolveVersionConflict(c, data);
      changed = true;
    } else {
      applyFullCloudSnapshot(c, data);
      toast('Scheda aggiornata dal cloud (modifiche più recenti da un altro dispositivo o dal Narratore).');
      c.cloudSyncPending = false;
      changed = true;
    }
  }

  // Tutto ciò che ha impostato changed in questa funzione proviene da una
  // LETTURA cloud (campagna/sessione/cestino o snapshot autorevole). Va
  // persistito soltanto sul dispositivo. Riscriverlo subito nel cloud come
  // scheda completa permette a una copia locale incompleta di sovrascrivere
  // i dati reali del personaggio appena cambia un metadato della campagna.
  // Le vere modifiche locali continuano a passare esclusivamente da
  // touchActive()/pushCharacterToCloud; la scelta esplicita “mantieni
  // locale” nel conflitto esegue già il proprio push dentro
  // resolveVersionConflict.
  if (changed && typeof saveAll === 'function') saveAll();
  return changed;
}
/* Sostituisce per intero i dati di gioco locali con l'ultimo salvataggio nel
   cloud (usata da syncCharacterFromCloud quando e' sicuro, o quando
   l'utente sceglie "Scarica l'altra versione" in un conflitto). id/
   cloudCharacterId/ownerAccountId sono identita' del dispositivo/account,
   non dati di gioco: protetti esplicitamente, altrimenti un Object.assign
   diretto del blob (che contiene comunque una copia di questi campi presa
   dal DISPOSITIVO che ha pushato per ultimo) li sovrascriverebbe con quelli
   sbagliati. Le altre chiavi "cloud*" protette sono invece stato live
   ricalcolato poco sopra in syncCharacterFromCloud da query fresche
   (campagna/cestino/sessione/richiesta d'ingresso), NON dati di gioco: se
   non le proteggessimo qui, l'Object.assign le sovrascriverebbe con
   l'istantanea (magari vecchia) presa dal dispositivo che ha pushato quel
   blob, vanificando il ricalcolo appena fatto. Il livello segue "level"
   (colonna separata, decisa dal Narratore) solo se il personaggio e' in una
   campagna: fuori da una campagna resta quello del blob appena applicato,
   dato che li' non esiste un'autorita' esterna sul livello. */
function applyFullCloudSnapshot(c, cloudRow) {
  const cloudData = cloudRow.data || {};
  const preserved = {
    id: c.id,
    cloudCharacterId: c.cloudCharacterId,
    ownerAccountId: c.ownerAccountId,
    cloudCampaignName: c.cloudCampaignName,
    cloudCampaignTrashedAt: c.cloudCampaignTrashedAt,
    cloudCampaignPurgeAt: c.cloudCampaignPurgeAt,
    cloudCampaignPremiseTitle: c.cloudCampaignPremiseTitle,
    cloudCampaignPremisePublished: c.cloudCampaignPremisePublished,
    cloudSessionActive: c.cloudSessionActive,
    cloudSessionLabel: c.cloudSessionLabel,
    cloudCampaignNarratoreName: c.cloudCampaignNarratoreName,
    cloudJoinRequestId: c.cloudJoinRequestId,
    cloudJoinCampaignId: c.cloudJoinCampaignId,
    cloudJoinCampaignName: c.cloudJoinCampaignName
  };
  Object.assign(c, cloudData, preserved, {
    cloudCampaignId: cloudRow.campaign_id || null,
    cloudVersion: Number(cloudRow.current_version) || 1,
    cloudDirty: false,
    // Mai vero su un personaggio reale (vedi characterCloudPayload): forzato
    // qui per "autoguarire" una riga cloud eventualmente già corrotta da
    // prima di quel fix, che altrimenti sparirebbe da visibleCharacters().
    narratorEditGuest: false
  });
  if (cloudRow.campaign_id) {
    const cloudLevel = Number(cloudRow.level) || 1;
    if (cloudLevel !== (Number(c.livello) || 1)) {
      c.livello = cloudLevel;
      creditLevelAP(c);
    }
    const fLivello = $('#f-livello');
    if (fLivello) fLivello.value = c.livello;
  }
  if (typeof ensureShape === 'function') ensureShape(c);
  if (typeof getActive === 'function' && getActive() === c && typeof renderSheet === 'function') renderSheet(c);
}

/* Esporta la scheda come JSON scaricabile (punto 6: il giocatore puo'
   sempre portarsi via i propri dati, anche se la campagna e' nel cestino). */
function exportCharacterJson(c) {
  const blob = new Blob([JSON.stringify(characterCloudPayload(c), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(c.nome || 'personaggio').replace(/[^a-z0-9]+/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------- render */

/* Bottone "Condividi scheda": mostrato solo sotto ad account Narratore/admin
   (verificato async in renderCloudStoryBox, che lo mostra/nasconde dopo il
   render sincrono) e solo per un personaggio già salvato nel cloud (serve
   l'id cloud per narratore_share_character). Nascosto di default qui, per
   non farlo comparire per un attimo a chiunque prima che il controllo di
   ruolo risponda. */
function shareCharacterTriggerHtml() {
  return `<button class="btn btn-ghost btn-sm hidden" id="btn-share-character" style="align-self:flex-start;margin-top:8px;">🎁 Condividi scheda</button>`;
}
function cloudStoryBoxHtml(c) {
  if (!c.cloudCharacterId) {
    return `
      <p class="helper-text" style="margin:0;">Salva il personaggio nel cloud per poter entrare nella storia di un Narratore (serve un account, anche solo ospite).</p>
      <button class="btn btn-primary btn-sm" id="cs-save-cloud" style="align-self:flex-start;">Salva nel cloud</button>
    `;
  }
  if (c.cloudCampaignId && c.cloudCampaignTrashedAt) {
    const giorni = c.cloudCampaignPurgeAt ? daysRemaining(c.cloudCampaignPurgeAt) : '?';
    return `
      <p class="helper-text" style="margin:0;color:var(--fisico-forte);">Il Narratore ha eliminato «${escapeHtml(c.cloudCampaignName || c.cloudJoinCampaignName || 'questa storia')}»: recuperabile ancora per ${giorni} giorni, poi la storia viene rimossa (la tua scheda resta comunque tua).</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" id="cs-export">Esporta la mia scheda</button>
        <button class="btn btn-ghost btn-sm" id="cs-sync">Sincronizza</button>
      </div>
      ${shareCharacterTriggerHtml()}
    `;
  }
  if (c.cloudCampaignId) {
    return `
      <p class="helper-text" style="margin:0;">Sei nella storia: <strong>${escapeHtml(c.cloudJoinCampaignName || c.cloudCampaignId)}</strong> (Lv ${c.livello})${c.cloudCampaignNarratoreName ? ` — Narratore: <strong>${escapeHtml(c.cloudCampaignNarratoreName)}</strong>` : ''}.</p>
      <p class="helper-text" style="margin:0;${c.cloudSessionActive ? '' : 'color:var(--fisico-forte);'}">${c.cloudSessionActive
        ? `🟢 Sessione in corso${c.cloudSessionLabel ? ': <strong>' + escapeHtml(c.cloudSessionLabel) + '</strong>' : ''} — Riposo, Tecniche e Abilità sono disponibili.`
        : '⏸ Sessione chiusa: Riposo, Tecniche e Abilità non sono disponibili finché il Narratore non avvia la giocata.'}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="cs-sync">Sincronizza</button>
        ${c.cloudCampaignPremisePublished ? '<button class="btn btn-ghost btn-sm" id="cs-read-premise">📖 Leggi la premessa</button>' : ''}
      </div>
      ${shareCharacterTriggerHtml()}
    `;
  }
  if (c.cloudJoinRequestId) {
    return `
      <p class="helper-text" style="margin:0;">Richiesta inviata per «${escapeHtml(c.cloudJoinCampaignName || c.cloudJoinCampaignId)}»: in attesa di conferma del Narratore.</p>
      <button class="btn btn-ghost btn-sm" id="cs-sync" style="align-self:flex-start;">Controlla se è stata accettata</button>
      ${shareCharacterTriggerHtml()}
    `;
  }
  return `
    <p class="helper-text" style="margin:0;">Scegli una storia che il Narratore ha reso visibile e manda una richiesta di partecipazione.</p>
    <div class="field"><label>Storie pubblicate</label><select id="cs-campaign-select"><option value="">Caricamento…</option></select></div>
    <button class="btn btn-primary btn-sm" id="cs-request-join-select" style="align-self:flex-start;">Invia richiesta di partecipazione</button>
    ${shareCharacterTriggerHtml()}
  `;
}

async function renderCloudStoryBox(c) {
  const box = $('#cloud-story-box');
  if (!box) return;
  box.innerHTML = cloudStoryBoxHtml(c);
  // "Condividi scheda" (bottone shareCharacterTriggerHtml, presente ma
  // nascosto in ogni ramo di cloudStoryBoxHtml dove cloudCharacterId è
  // impostato): mostrato solo ad account Narratore/admin — verifica async,
  // il resto della scheda non aspetta questa risposta.
  // narratorEditGuest (openCharacterForNarratorEdit, js/app.js): scheda di
  // un GIOCATORE aperta in editing dal Narratore, non una scheda "del
  // Narratore" — condividerla non avrebbe senso (non è sua da regalare).
  if (c.cloudCharacterId && !c.narratorEditGuest) {
    (async () => {
      try {
        const session = await currentCloudSession();
        if (!session || isGuestUser(session)) return;
        const profile = await getMyProfile(session.user.id);
        const role = (profile && profile.account_role) || 'player';
        if (role !== 'narrator' && role !== 'admin') return;
        const btn = $('#btn-share-character');
        // getActive() cambiato nel frattempo (risposta di rete lenta,
        // scheda già chiusa/sostituita): non toccare un bottone di un
        // altro personaggio.
        if (btn && getActive() === c) btn.classList.remove('hidden');
      } catch (e) { /* niente bottone stavolta, non bloccante */ }
    })();
  }
  const select = $('#cs-campaign-select');
  if (!select) return;
  try {
    const campaigns = await listPublishedCampaigns();
    select.innerHTML = campaigns.length
      ? '<option value="">— scegli una storia —</option>' + campaigns.map(camp => `<option value="${camp.id}" data-name="${escapeHtml(camp.name)}">${escapeHtml(camp.name)}</option>`).join('')
      : '<option value="">Nessuna storia pubblicata al momento</option>';
  } catch (e) {
    select.innerHTML = `<option value="">Errore: ${escapeHtml(describeError(e))}</option>`;
  }
}

function wireCloudCharacterEvents() {
  $('#cloud-story-box').addEventListener('click', async e => {
    const c = getActive(); if (!c) return;

    if (e.target.id === 'cs-save-cloud') {
      try {
        await pushCharacterToCloud(c);
        toast('Personaggio salvato nel cloud');
        renderCloudStoryBox(c);
        if (typeof updateStoriaLegacyVisibility === 'function') updateStoriaLegacyVisibility(c);
        if (typeof updateLevelLockUI === 'function') updateLevelLockUI(c);
        if (typeof updateSessionLockUI === 'function') updateSessionLockUI(c);
        if (typeof updateEntryLockUI === 'function') updateEntryLockUI(c);
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'cs-request-join-select') {
      const select = $('#cs-campaign-select');
      const campaignId = select ? select.value : '';
      if (!campaignId) { toast('Scegli una storia dall\'elenco'); return; }
      const campaignName = (select.options[select.selectedIndex] && select.options[select.selectedIndex].dataset.name) || select.options[select.selectedIndex].textContent;
      try {
        await requestJoinCampaign(c, campaignId, campaignName);
        toast('Richiesta inviata: in attesa di conferma del Narratore');
        renderCloudStoryBox(c);
        if (typeof updateStoriaLegacyVisibility === 'function') updateStoriaLegacyVisibility(c);
        if (typeof updateLevelLockUI === 'function') updateLevelLockUI(c);
        if (typeof updateSessionLockUI === 'function') updateSessionLockUI(c);
        if (typeof updateEntryLockUI === 'function') updateEntryLockUI(c);
        if (typeof renderPlayerStoriesBox === 'function') renderPlayerStoriesBox();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'cs-sync') {
      try {
        const changed = await syncCharacterFromCloud(c);
        renderCloudStoryBox(c);
        if (typeof updateStoriaLegacyVisibility === 'function') updateStoriaLegacyVisibility(c);
        if (typeof updateLevelLockUI === 'function') updateLevelLockUI(c);
        if (typeof updateSessionLockUI === 'function') updateSessionLockUI(c);
        if (typeof updateEntryLockUI === 'function') updateEntryLockUI(c);
        if (typeof renderPlayerStoriesBox === 'function') renderPlayerStoriesBox();
        if (!changed) toast('Nessuna novità');
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'cs-export') {
      exportCharacterJson(c);
      toast('Scheda esportata');
      return;
    }
    if (e.target.id === 'cs-read-premise') {
      if (!c.cloudCampaignId) return;
      try {
        const bytes = await downloadCampaignPremiseBytes(c.cloudCampaignId);
        const title = c.cloudCampaignPremiseTitle || c.cloudJoinCampaignName || 'Premessa';
        if (window.MSPdfViewer) window.MSPdfViewer.open({ bytes, title, label: c.nome || 'Giocatore' });
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'btn-share-character') {
      openShareCharacterModal(c);
      return;
    }
  });
  wireShareCharacterModal();
}

/* ---------------------------------------------- "Condividi scheda" (sulla scheda del Narratore) */

async function shareCharacterModalLoadPlayers(campaignId) {
  const playerSelect = $('#share-character-player-select');
  if (!playerSelect) return;
  if (!campaignId) { playerSelect.innerHTML = '<option value="">—</option>'; return; }
  playerSelect.innerHTML = '<option value="">Caricamento…</option>';
  try {
    const chars = await listCampaignCharacters(campaignId);
    const players = [];
    const seen = new Set();
    (chars || []).forEach(ch => {
      if (seen.has(ch.owner_user_id)) return;
      seen.add(ch.owner_user_id);
      players.push({ userId: ch.owner_user_id, name: ch.playerName });
    });
    playerSelect.innerHTML = players.length
      ? players.map(p => `<option value="${p.userId}">${escapeHtml(p.name)}</option>`).join('')
      : '<option value="">Nessun giocatore ancora in questa storia</option>';
  } catch (e) {
    playerSelect.innerHTML = `<option value="">Errore: ${escapeHtml(describeError(e))}</option>`;
  }
}

async function openShareCharacterModal(c) {
  if (!c || !c.cloudCharacterId) return;
  const modal = $('#share-character-modal');
  if (!modal) return;
  modal.dataset.characterId = c.cloudCharacterId;
  const campaignSelect = $('#share-character-campaign-select');
  campaignSelect.innerHTML = '<option value="">Caricamento…</option>';
  $('#share-character-player-select').innerHTML = '<option value="">—</option>';
  modal.classList.remove('hidden');
  try {
    const campaigns = await listMyCampaigns();
    campaignSelect.innerHTML = campaigns.length
      ? campaigns.map(camp => `<option value="${camp.id}">${escapeHtml(camp.name)}</option>`).join('')
      : '<option value="">Nessuna tua campagna</option>';
    if (campaigns.length) await shareCharacterModalLoadPlayers(campaigns[0].id);
  } catch (e) {
    campaignSelect.innerHTML = `<option value="">Errore: ${escapeHtml(describeError(e))}</option>`;
  }
}

function wireShareCharacterModal() {
  const modal = $('#share-character-modal');
  if (!modal) return;
  $('#share-character-campaign-select').addEventListener('change', e => {
    shareCharacterModalLoadPlayers(e.target.value);
  });
  $('#share-character-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  $('#share-character-confirm').addEventListener('click', async () => {
    const characterId = modal.dataset.characterId;
    const campaignId = $('#share-character-campaign-select').value;
    const targetUserId = $('#share-character-player-select').value;
    if (!campaignId) { toast('Scegli una campagna'); return; }
    if (!targetUserId) { toast('Scegli a quale giocatore condividere la scheda'); return; }
    try {
      await narratoreShareCharacterCloud(characterId, campaignId, targetUserId);
      toast('Copia condivisa con il giocatore');
      modal.classList.add('hidden');
    } catch (err) { toast('Errore: ' + describeError(err)); }
  });
}
