/* Tabellone di combattimento del Narratore: messa in scena dei personaggi,
   iniziativa, fog-of-war sui PNG, risoluzione di un attacco mirato
   (danno/schivata-blocco/salvezza di Resistenza). Solo le chiamate cloud
   (RPC + canale realtime); la UI vive in app.js (renderCombatBoard e
   affini), stessa separazione già in uso fra questo file e cloud-account.js.

   get_combat_board è l'UNICA via con cui il client legge il tabellone: la
   redazione fog-of-war avviene interamente lato server (vedi
   supabase/migrations/20260803121000_combat_board_redaction.sql), qui non
   c'è alcuna logica di "nascondere" un campo — il payload che arriva è già
   quello giusto per chi lo ha richiesto. */

async function fetchCombatBoard(encounterId) {
  const { data, error } = await withTimeout(
    sb.rpc('get_combat_board', { p_encounter_id: encounterId }),
    'Tabellone di combattimento'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- ciclo vita encounter */

async function startCombatEncounter(campaignId, label) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_start_combat_encounter', { p_campaign_id: campaignId, p_label: label || null }),
    'Avvio combattimento'
  );
  if (error) throw error;
  return data;
}

async function endCombatEncounter(encounterId) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_end_combat_encounter', { p_encounter_id: encounterId }),
    'Fine combattimento'
  );
  if (error) throw error;
  return data;
}

/* Stato REALE (mai il payload di un evento realtime, che è soltanto una
   notifica "controlla di nuovo") di uno o più incontri: usata da
   checkTecabPendingAdvancements (js/app.js) per decidere se un avanzamento
   maturato in un incontro può davvero applicarsi ("fine combattimento").
   Lettura diretta permessa dalla RLS di combat_encounters a ogni membro
   della campagna (id/status non sono uno "stat block", nessuna redazione
   necessaria qui). Ritorna una mappa id -> status; un id non trovato (mai
   esistito, o incontro di un'altra campagna) resta assente dalla mappa. */
async function fetchCombatEncounterStatuses(encounterIds) {
  if (!encounterIds || !encounterIds.length) return {};
  const { data, error } = await withTimeout(
    sb.from('combat_encounters').select('id, status').in('id', encounterIds),
    'Stato combattimento'
  );
  if (error) throw error;
  const map = {};
  (data || []).forEach(row => { map[row.id] = row.status; });
  return map;
}

/* ---------------------------------------------------- richiesta "Attacco" dalla scheda */

/* Un giocatore chiama il Narratore a strutturare un combattimento (bottone
   "Attacco" in scheda) invece di poter mettere in scena personaggi per
   conto proprio — resta un privilegio del solo Narratore. Vedi
   request_combat_start/narratore_accept_combat_start/narratore_decline_combat_start
   (migrazione combat_start_requests). */
async function requestCombatStart(campaignId, characterId, note) {
  const { data, error } = await withTimeout(
    sb.rpc('request_combat_start', { p_campaign_id: campaignId, p_character_id: characterId, p_note: note || null }),
    'Richiesta di combattimento'
  );
  if (error) throw error;
  return data;
}

/* Ritorna {encounterId, campaignId}: il richiedente viene messo in scena
   con "iniziativa momentanea" (agisce per primo) in un encounter di questa
   campagna già in preparazione, o in uno nuovo — mai in uno già attivo, per
   non interrompere un combattimento diverso in corso. */
async function acceptCombatStart(requestId, label) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_accept_combat_start', { p_request_id: requestId, p_label: label || null }),
    'Accetta richiesta di combattimento'
  );
  if (error) throw error;
  return data;
}

async function declineCombatStart(requestId) {
  const { error } = await withTimeout(
    sb.rpc('narratore_decline_combat_start', { p_request_id: requestId }),
    'Rifiuta richiesta di combattimento'
  );
  if (error) throw error;
}

/* ---------------------------------------------------- messa in scena */

async function stageCombatCharacter(encounterId, characterId) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_stage_character', { p_encounter_id: encounterId, p_character_id: characterId }),
    'Messa in scena'
  );
  if (error) throw error;
  return data;
}

async function unstageCombatCharacter(encounterId, characterId) {
  const { error } = await withTimeout(
    sb.rpc('narratore_unstage_character', { p_encounter_id: encounterId, p_character_id: characterId }),
    'Rimozione dalla scena'
  );
  if (error) throw error;
}

/* ---------------------------------------------------- libreria mappe di campagna */

/* Multi-immagine per campagna, riusabile fra combattimenti diversi (niente
   generazione AI, valutata e scartata in conversazione) — stesso pattern
   di uploadCampaignPremise (upload diretto su Storage + riga di metadati),
   ma qui più file per campagna invece di un unico slot fisso. */
const CAMPAIGN_ASSET_MAX_BYTES = 15 * 1024 * 1024;

async function fetchCampaignAssets(campaignId) {
  const { data, error } = await withTimeout(
    sb.from('campaign_assets').select('id, label, storage_path, created_at')
      .eq('campaign_id', campaignId).order('created_at', { ascending: false }),
    'Libreria mappe'
  );
  if (error) throw error;
  return data || [];
}

async function uploadCampaignAsset(campaignId, file, label) {
  if (file.size > CAMPAIGN_ASSET_MAX_BYTES) {
    throw new Error(`Immagine troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 15 MB`);
  }
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const assetId = crypto.randomUUID();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${campaignId}/${assetId}.${ext}`;
  const { error: upErr } = await withTimeout(
    sb.storage.from('campaign-assets').upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' }),
    'Caricamento immagine'
  );
  if (upErr) throw upErr;
  const { data, error } = await withTimeout(
    sb.from('campaign_assets')
      .insert({ id: assetId, campaign_id: campaignId, label: (label || '').trim() || file.name, storage_path: path, created_by: session.user.id })
      .select().single(),
    'Salvataggio asset'
  );
  if (error) throw error;
  return data;
}

async function removeCampaignAsset(assetId, storagePath) {
  await withTimeout(sb.storage.from('campaign-assets').remove([storagePath]), 'Rimozione immagine');
  const { error } = await withTimeout(sb.from('campaign_assets').delete().eq('id', assetId), 'Rimozione asset');
  if (error) throw error;
}

/* URL firmato temporaneo (bucket privato): usabile direttamente come
   background-image. Scade dopo un'ora — accettabile per la durata tipica
   di una sessione di gioco; il refetch periodico del tabellone (realtime)
   lo rinnova comunque a ogni cambiamento. */
async function getCampaignAssetUrl(storagePath) {
  const { data, error } = await withTimeout(
    sb.storage.from('campaign-assets').createSignedUrl(storagePath, 3600),
    'URL immagine mappa'
  );
  if (error) throw error;
  return data.signedUrl;
}

async function setEncounterMap(encounterId, mapAssetId, gridCols, gridRows) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_set_encounter_map', {
      p_encounter_id: encounterId, p_map_asset_id: mapAssetId, p_grid_cols: gridCols, p_grid_rows: gridRows
    }),
    'Impostazione mappa'
  );
  if (error) throw error;
  return data;
}

/* Inquadratura dell'immagine (background-position in percentuale, 0-100,
   50/50 = centro): con background-size:cover un'immagine larga su una
   griglia stretta ritaglia molto, questo permette al Narratore di
   scegliere quale parte restare visibile invece di subire sempre il
   centro (vedi anteprima trascinabile in combat-map-manager). */
async function setMapFocus(encounterId, focusX, focusY) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_set_map_focus', { p_encounter_id: encounterId, p_focus_x: focusX, p_focus_y: focusY }),
    'Inquadratura mappa'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- pedine */

/* Sia il Narratore sia il proprietario del proprio personaggio possono
   spostare una pedina (decisione esplicita, non solo il Narratore).
   levelId conta solo alla primissima collocazione (vedi move_combat_token
   lato SQL): da lì in poi il livello del personaggio è fisso, cambia solo
   con attemptCombatLevelTransition. */
async function moveCombatToken(encounterId, characterId, hexCol, hexRow, levelId) {
  const { data, error } = await withTimeout(
    sb.rpc('move_combat_token', {
      p_encounter_id: encounterId, p_character_id: characterId, p_hex_col: hexCol, p_hex_row: hexRow,
      p_level_id: levelId || null
    }),
    'Spostamento pedina'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- livelli di combattimento */

async function createCombatLevel(encounterId, label, mapAssetId, gridCols, gridRows) {
  const { data, error } = await withTimeout(
    sb.rpc('create_combat_level', {
      p_encounter_id: encounterId, p_label: label, p_map_asset_id: mapAssetId || null,
      p_grid_cols: gridCols, p_grid_rows: gridRows
    }),
    'Creazione livello'
  );
  if (error) throw error;
  return data;
}

/* Crea il "Livello 1" implicito da mappa/griglia già impostate
   sull'encounter (idempotente: se un livello esiste già lo restituisce e
   basta) — usata dagli strumenti di passaggi/ostacoli in Gestisci scena
   prima di attivarsi su un encounter ancora a mappa singola. */
async function ensureCombatLevelDefault(encounterId) {
  const { data, error } = await withTimeout(
    sb.rpc('ensure_combat_level_default', { p_encounter_id: encounterId }),
    'Predisposizione livello'
  );
  if (error) throw error;
  return data;
}

async function renameCombatLevel(levelId, label) {
  const { data, error } = await withTimeout(
    sb.rpc('rename_combat_level', { p_level_id: levelId, p_label: label }),
    'Rinomina livello'
  );
  if (error) throw error;
  return data;
}

async function setCombatLevelMap(levelId, mapAssetId, gridCols, gridRows) {
  const { data, error } = await withTimeout(
    sb.rpc('set_combat_level_map', {
      p_level_id: levelId, p_map_asset_id: mapAssetId || null, p_grid_cols: gridCols, p_grid_rows: gridRows
    }),
    'Impostazione mappa livello'
  );
  if (error) throw error;
  return data;
}

async function setCombatLevelFocus(levelId, focusX, focusY) {
  const { data, error } = await withTimeout(
    sb.rpc('set_combat_level_focus', { p_level_id: levelId, p_focus_x: focusX, p_focus_y: focusY }),
    'Inquadratura livello'
  );
  if (error) throw error;
  return data;
}

async function deleteCombatLevel(levelId) {
  const { error } = await withTimeout(sb.rpc('delete_combat_level', { p_level_id: levelId }), 'Eliminazione livello');
  if (error) throw error;
}

/* ---------------------------------------------------- passaggi fra livelli */

async function setCombatLevelTransition(levelId, hexCol, hexRow, targetLevelId, targetHexCol, targetHexRow, label, traitList, traitName, difficulty, actionCostQuarti) {
  const { data, error } = await withTimeout(
    sb.rpc('set_combat_level_transition', {
      p_level_id: levelId, p_hex_col: hexCol, p_hex_row: hexRow,
      p_target_level_id: targetLevelId, p_target_hex_col: targetHexCol, p_target_hex_row: targetHexRow,
      p_label: label, p_trait_list: traitList || null, p_trait_name: traitName || null,
      p_difficulty: difficulty == null ? null : difficulty, p_action_cost_quarti: actionCostQuarti
    }),
    'Creazione passaggio'
  );
  if (error) throw error;
  return data;
}

/* Scala automatica fra due livelli (autoPlaceLevelStaircase in app.js):
   una sola chiamata RPC che scrive andata e ritorno nella stessa
   transazione server-side, invece di due setCombatLevelTransition
   separate — evita che una finestra di rete fra le due lasci la scala
   percorribile in un verso solo (vedi la migrazione che introduce
   set_combat_level_staircase per il caso reale osservato). */
async function setCombatLevelStaircase(levelAId, levelBId, label, actionCostQuarti) {
  const { error } = await withTimeout(
    sb.rpc('set_combat_level_staircase', {
      p_level_a: levelAId, p_level_b: levelBId,
      p_label: label, p_action_cost_quarti: actionCostQuarti
    }),
    'Creazione scala'
  );
  if (error) throw error;
}

async function removeCombatLevelTransition(transitionId) {
  const { error } = await withTimeout(
    sb.rpc('remove_combat_level_transition', { p_transition_id: transitionId }),
    'Rimozione passaggio'
  );
  if (error) throw error;
}

/* p_source facoltativo ({kind:'tecnica'|'abilita', index}): se presente il
   passaggio riesce sempre spendendo il costo proprio di quella
   Tecnica/Abilità invece del tiro sul tratto configurato sulla casella. */
async function attemptCombatLevelTransition(encounterId, characterId, source, rollTotal) {
  const { data, error } = await withTimeout(
    sb.rpc('attempt_combat_level_transition', {
      p_encounter_id: encounterId, p_character_id: characterId,
      p_source: source || null, p_roll_total: rollTotal == null ? null : rollTotal
    }),
    'Passaggio di livello'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- ostacoli */

async function toggleCombatLevelObstacle(levelId, hexCol, hexRow) {
  const { data, error } = await withTimeout(
    sb.rpc('toggle_combat_level_obstacle', { p_level_id: levelId, p_hex_col: hexCol, p_hex_row: hexRow }),
    'Modifica ostacolo'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- danno ambientale */

/* Crollo/esplosione/danno d'area: nessun personaggio attaccante, il
   Narratore imposta a mano etichetta, quantità di danno pura (nessun tiro)
   e la Difficoltà che schivata/blocco del bersaglio devono battere. */
async function declareEnvironmentalAttack(encounterId, targetCharacterId, label, damageAmount, difficulty, isSurprise, dodgeBlockAllowed) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_declare_environmental_attack', {
      p_encounter_id: encounterId, p_target_character_id: targetCharacterId, p_label: label,
      p_damage_amount: damageAmount, p_difficulty: difficulty,
      p_is_surprise: !!isSurprise, p_dodge_block_allowed: !!dodgeBlockAllowed
    }),
    'Danno ambientale'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- iniziativa */

/* p_rolls arriva già calcolato dal chiamante (1d8 + Velocità effettiva, con
   vantaggio/svantaggio su chi ha dato/subito un attacco a sorpresa — vedi
   rollInitiativeForParticipant in app.js): stessa scelta della formula di
   danno "Tira danno", mai ricalcolata lato server. */
async function rollAndSetInitiative(encounterId, rolls) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_set_initiative', { p_encounter_id: encounterId, p_rolls: rolls }),
    'Iniziativa'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- fog-of-war */

async function revealCombatField(encounterId, characterId, fieldKey) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_reveal_field', { p_encounter_id: encounterId, p_character_id: characterId, p_field_key: fieldKey }),
    'Rivela statistica'
  );
  if (error) throw error;
  return data;
}

async function hideCombatField(encounterId, characterId, fieldKey) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_hide_field', { p_encounter_id: encounterId, p_character_id: characterId, p_field_key: fieldKey }),
    'Nascondi statistica'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- attacco */

/* p_source: {kind:'weapon'|'tecnica'|'abilita', index, label, dannoTipo, dannoStat, dannoBase,
   effettoNome?, effettoTratto?} — gli ultimi due solo per tecnica/abilita con un effetto
   (Rompere/Tramortire/nome libero) configurato sulla riga, vedi combatTecAbSourcesFor. */
/* "Danno fisso" (vedi resolveDannoFisso, js/app.js): azione istantanea a
   parte, mai declare_combat_attack — bypassa interamente la catena
   attacco/difesa, i due tiri di stato (se presenti) arrivano già pronti. */
async function applyDannoFisso(encounterId, attackerCharacterId, targetCharacterId, source, statusAttackerRoll, statusAttackerDetail, statusDefenderRoll, statusDefenderDetail) {
  const { data, error } = await withTimeout(
    sb.rpc('apply_danno_fisso', {
      p_encounter_id: encounterId,
      p_attacker_character_id: attackerCharacterId,
      p_target_character_id: targetCharacterId,
      p_source: source,
      p_status_attacker_roll: statusAttackerRoll ?? null,
      p_status_attacker_detail: statusAttackerDetail || null,
      p_status_defender_roll: statusDefenderRoll ?? null,
      p_status_defender_detail: statusDefenderDetail || null
    }),
    'Danno fisso'
  );
  if (error) throw error;
  return data;
}

/* Sovracura: sistema a parte, mai apply_combat_effect — nessuna riga
   combat_active_effects, un cuscinetto HP persistente su
   characters.data.hpBuffer (vedi activateSovracuraTarget, js/app.js). La
   RPC ritorna il nuovo totale del cuscinetto (numero), verificando di nuovo
   server-side il gate "solo a HP pieni". */
async function activateSovracura(encounterId, casterCharacterId, targetCharacterId, source, rollAmount) {
  const { data, error } = await withTimeout(
    sb.rpc('activate_sovracura', {
      p_encounter_id: encounterId,
      p_caster_character_id: casterCharacterId,
      p_target_character_id: targetCharacterId,
      p_source: source,
      p_roll_amount: rollAmount
    }),
    'Sovracura'
  );
  if (error) throw error;
  return data;
}

async function declareCombatAttack(encounterId, attackerCharacterId, targetCharacterId, source) {
  const { data, error } = await withTimeout(
    sb.rpc('declare_combat_attack', {
      p_encounter_id: encounterId,
      p_attacker_character_id: attackerCharacterId,
      p_target_character_id: targetCharacterId,
      p_source: source
    }),
    'Dichiarazione attacco'
  );
  if (error) throw error;
  return data;
}

/* Variante ad area: p_anchorTargetCharacterId è il bersaglio scelto col
   picker esistente, il server trova da sé (via hex_cube_distance, stessa
   funzione già in uso per il movimento) tutti gli altri partecipanti entro
   p_radius celle sulla stessa mappa/livello e crea un combat_attacks per
   ciascuno — ritorna l'array di righe create, vedi declare_combat_attack_aoe. */
async function declareCombatAttackAoe(encounterId, attackerCharacterId, anchorTargetCharacterId, source, radius) {
  const { data, error } = await withTimeout(
    sb.rpc('declare_combat_attack_aoe', {
      p_encounter_id: encounterId,
      p_attacker_character_id: attackerCharacterId,
      p_anchor_target_character_id: anchorTargetCharacterId,
      p_source: source,
      p_radius: radius
    }),
    'Dichiarazione attacco ad area'
  );
  if (error) throw error;
  return data;
}

/* Variante multi-bersaglio: p_targetCharacterIds è l'elenco esplicito scelto
   a mano sulla mappa (vedi combatToggleMultiTarget/combatResolvePendingMultiTargets),
   non un raggio calcolato — stesso principio dell'AoE (un solo costo dedotto
   per l'intera dichiarazione), ma per Tecniche/Abilità con multiTarget
   attivo invece che solo Abilità con raggioHex. Vedi declare_combat_attack_multi. */
async function declareCombatAttackMulti(encounterId, attackerCharacterId, targetCharacterIds, source) {
  const { data, error } = await withTimeout(
    sb.rpc('declare_combat_attack_multi', {
      p_encounter_id: encounterId,
      p_attacker_character_id: attackerCharacterId,
      p_target_character_ids: targetCharacterIds,
      p_source: source
    }),
    'Dichiarazione attacco multi-bersaglio'
  );
  if (error) throw error;
  return data;
}

async function setCombatAttackFlags(attackId, isSurprise, dodgeBlockAllowed) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_set_attack_flags', { p_attack_id: attackId, p_is_surprise: !!isSurprise, p_dodge_block_allowed: !!dodgeBlockAllowed }),
    'Impostazioni attacco'
  );
  if (error) throw error;
  return data;
}

/* statusRollTotal/statusRollDetail: solo quando la Tecnica/Abilità porta uno
   stato del catalogo (Bruciare/Avvelenare/...) — d100 puro dell'attaccante
   per il tiro contrapposto d'ingresso, vedi submitCombatDefenseRoll per
   il lato del bersaglio. perforareTaglioRollTotal/Detail: solo quando la
   salvezza dell'attacco è su Resistenza — d20+Perforare/Tagliare
   dell'attaccante, per l'innesco automatico di Sanguinare (vedi migrazione
   status_effects_bruciare_avvelenare). */
async function submitCombatAttackRolls(attackId, attackRollTotal, attackRollDetail, damageRollTotal, damageRollDetail, statusRollTotal, statusRollDetail, perforareTaglioRollTotal, perforareTaglioRollDetail, weaponStatusRollTotal, weaponStatusRollDetail, damageRollTotal2, damageRollDetail2, counterRollTotal, counterRollDetail) {
  const { data, error } = await withTimeout(
    sb.rpc('submit_attack_rolls', {
      p_attack_id: attackId,
      p_attack_roll_total: attackRollTotal, p_attack_roll_detail: attackRollDetail,
      p_damage_roll_total: damageRollTotal, p_damage_roll_detail: damageRollDetail,
      p_attacker_status_roll_total: statusRollTotal ?? null, p_attacker_status_roll_detail: statusRollDetail || null,
      p_attacker_perforare_taglio_roll_total: perforareTaglioRollTotal ?? null, p_attacker_perforare_taglio_roll_detail: perforareTaglioRollDetail || null,
      p_attacker_weapon_status_roll_total: weaponStatusRollTotal ?? null, p_attacker_weapon_status_roll_detail: weaponStatusRollDetail || null,
      p_damage_roll_total_2: damageRollTotal2 ?? null, p_damage_roll_detail_2: damageRollDetail2 || null,
      // Contrattacco (difesa reattiva): tiro di Arte Combattiva
      // dell'attaccante, preso ora e usato solo se il bersaglio sceglierà
      // questa difesa — vedi submit_attack_defense_roll.
      p_attacker_counter_roll_total: counterRollTotal ?? null, p_attacker_counter_roll_detail: counterRollDetail || null
    }),
    'Tiro di attacco'
  );
  if (error) throw error;
  return data;
}

/* p_defenseType: 'dodge' | 'block' | 'none'. auto1/auto2: riduzione
   automatica Difesa/Difesa Mentale (SEMPRE applicata, indipendente dalla
   scelta) — auto2 solo se l'attacco ha una componente magica (danno_base_2).
   statusRollTotal/statusRollDetail (+ i loro equivalenti "arma"): d100 +
   tratto del bersaglio, solo quando l'attacco porta uno stato del catalogo —
   confrontati server-side con gli attacker_*_status_roll_total già salvati
   al tiro d'attacco, indipendentemente dal nuovo tiro critico. */
async function submitCombatDefenseRoll(attackId, defenseType, rollTotal, rollDetail, auto1, auto1Detail, auto2, auto2Detail, statusRollTotal, statusRollDetail, weaponStatusRollTotal, weaponStatusRollDetail) {
  const { data, error } = await withTimeout(
    sb.rpc('submit_attack_defense_roll', {
      p_attack_id: attackId, p_defense_type: defenseType, p_defense_roll_total: rollTotal, p_defense_roll_detail: rollDetail,
      p_auto_reduction_1: auto1 ?? 0, p_auto_reduction_1_detail: auto1Detail || null,
      p_auto_reduction_2: auto2 ?? null, p_auto_reduction_2_detail: auto2Detail || null,
      p_defender_status_roll_total: statusRollTotal ?? null, p_defender_status_roll_detail: statusRollDetail || null,
      p_defender_weapon_status_roll_total: weaponStatusRollTotal ?? null, p_defender_weapon_status_roll_detail: weaponStatusRollDetail || null
    }),
    'Schivata/blocco'
  );
  if (error) throw error;
  return data;
}

/* Tiro critico condizionale (solo se Schiva/Blocco sono stati tentati e
   hanno fallito, mai su danno misto): d20 + Resistenza del bersaglio,
   confrontato server-side col "per colpire" dell'attaccante già tirato. */
async function submitCombatCritCheck(attackId, rollTotal, rollDetail) {
  const { data, error } = await withTimeout(
    sb.rpc('submit_attack_crit_check', { p_attack_id: attackId, p_roll_total: rollTotal, p_roll_detail: rollDetail }),
    'Tiro critico'
  );
  if (error) throw error;
  return data;
}

/* Perdita di Durabilità di armatura/scudo/arma coinvolti in un attacco già
   risolto (final_damage definitivo, prima di applyCombatAttackDamage):
   calcolata QUI lato client con durabilityCalcolaPerdita (js/data.js) sugli
   stessi dati reali del Narratore (combatFindParticipantChar, app.js) per
   bersaglio E attaccante, perché il tratto Resistenza effettivo dipende da
   bonus equip/Boost/effetti attivi/consumabili — la stessa catena che ogni
   altro tiro di questo sistema (submit_attack_rolls in poi) risolve lato
   client e affida al server solo come totale, mai da ricalcolare in SQL.
   Il server (apply_combat_attack_damage/durability_apply_loss) applica solo,
   con validazione (characterId dev'essere attaccante o bersaglio di QUESTO
   attacco) e clamp (mai oltre il 'dur' del pezzo) — mai fidandosi ciecamente.
   Bloccato con successo -> lo scudo (o gli scudi, se più di uno
   equipaggiato al momento del blocco) incassa il colpo al posto
   dell'armatura, ANCHE quando il blocco azzera del tutto il danno netto
   (final_damage 0): lo scudo si è comunque usato per fermarlo, quindi si
   usura sul colpo COME SAREBBE ARRIVATO prima della sola riduzione 1/4 del
   blocco (dopo la sola riduzione automatica di Dif) — mai su final_damage,
   che qui misurerebbe solo "quanto è passato", non "quanto ha assorbito lo
   scudo". Altrimenti (blocco non tentato, o tentato e fallito: il colpo
   arriva comunque) la locazione targeted_body_part, su final_damage. L'arma
   dell'attaccante (solo se source_kind==='weapon', un attacco fisico reale)
   si usura a sua volta, contro lo stesso pezzo che ha incassato il colpo (il
   primo, se più scudi). Nessuna scrittura qui: ritorna solo
   {characterId, arrayKey, index, perdita}[] da passare a applyCombatAttackDamage. */
function computeEquipDurabilityLosses(atk, attackerData, targetData) {
  const isMixed = Number(atk.danno_base_2) > 0;
  const finalDamage = Number(atk.final_damage) || 0;
  const blockedSuccessfully = atk.defense_type === 'block' && atk.defense_success === true;
  const dannoBloccato = blockedSuccessfully
    ? Math.max(0, (Number(atk.damage_roll_total) || 0) - (Number(atk.auto_reduction_1) || 0))
      + (isMixed ? Math.max(0, (Number(atk.damage_roll_total_2) || 0) - (Number(atk.auto_reduction_2) || 0)) : 0)
    : 0;
  const dannoReale = blockedSuccessfully ? dannoBloccato : finalDamage;
  if (dannoReale <= 0) return [];
  const losses = [];

  const attackerWeapon = (atk.source_kind === 'weapon' && Number.isInteger(atk.source_index) && attackerData && attackerData.weaponSlots)
    ? attackerData.weaponSlots[atk.source_index] : null;
  // isEquipmentUsable (js/app.js) è il gate unico di validità meccanica: un
  // pezzo già rotto (durCur<=0) non deve poter subire NÉ causare altra usura
  // reciproca, esattamente come non contribuisce più ad Atk/Dif (vedi
  // equipWeaponBonusTotal). Prima di questa correzione qui si riverificava a
  // mano equipaggiato+statsConfirmed senza il controllo durCur>0, divergendo
  // dal gate reale.
  const attaccanteValido = (attackerWeapon && attackerWeapon.kind === 'arma' && isEquipmentUsable(attackerWeapon)) ? attackerWeapon : null;
  // "Resistenza" unifica il vecchio "Robustezza" (main, commit "Unifica
  // Robustezza nel tratto Resistenza") — il nome del tratto nel catalogo è
  // solo questo, 'Robustezza' non esiste più in TRAIT_LISTS.
  const attackerRes = attackerData ? getTraitValue(attackerData, 'capacitaCombattive', 'Resistenza') : 0;
  const targetRes = targetData ? getTraitValue(targetData, 'capacitaCombattive', 'Resistenza') : 0;

  let bersagliDifensore = [];
  if (blockedSuccessfully && targetData) {
    bersagliDifensore = (targetData.weaponSlots || [])
      .map((s, i) => ({ s, i, armor: false }))
      .filter(x => x.s.kind === 'scudo' && isEquipmentUsable(x.s));
  } else if (!blockedSuccessfully && atk.targeted_body_part && targetData) {
    // Solo un'armatura davvero indossata in quella locazione può perdere
    // Durabilità: un pezzo confermato ma nello Zaino (equipaggiato:false)
    // non protegge nulla, non deve poter comparire come bersaglio implicito.
    const idx = (targetData.slots || []).findIndex(s => s.name === atk.targeted_body_part && s.statsConfirmed && s.equipaggiato !== false);
    if (idx !== -1) bersagliDifensore = [{ s: targetData.slots[idx], i: idx, armor: true }];
  }

  for (const { s, i, armor } of bersagliDifensore) {
    const { perdita } = durabilityCalcolaPerdita({
      bersaglio: s, attaccante: attaccanteValido, dannoReale, trattoResistenza: targetRes
    });
    if (perdita > 0) {
      losses.push({ characterId: atk.target_character_id, arrayKey: armor ? 'slots' : 'weaponSlots', index: i, perdita });
    }
  }

  if (attaccanteValido) {
    const bersaglioPerArma = bersagliDifensore.length ? bersagliDifensore[0].s : null;
    const { perdita } = durabilityCalcolaPerdita({
      bersaglio: attaccanteValido, attaccante: bersaglioPerArma, dannoReale, trattoResistenza: attackerRes
    });
    if (perdita > 0) {
      losses.push({ characterId: atk.attacker_character_id, arrayKey: 'weaponSlots', index: atk.source_index, perdita });
    }
  }
  return losses;
}

/* Il danno HP applicato è sempre final_damage già calcolato dal server nello
   step precedente: qui non si passa alcun importo. durabilityLosses (opz.):
   vedi computeEquipDurabilityLosses. */
async function applyCombatAttackDamage(attackId, durabilityLosses) {
  const { data, error } = await withTimeout(
    sb.rpc('apply_combat_attack_damage', {
      p_attack_id: attackId,
      p_durability_losses: (durabilityLosses || []).map(l => ({
        character_id: l.characterId, array_key: l.arrayKey, index: l.index, perdita: l.perdita
      }))
    }),
    'Applica danno'
  );
  if (error) throw error;
  return data;
}

async function cancelCombatAttack(attackId) {
  const { data, error } = await withTimeout(
    sb.rpc('cancel_combat_attack', { p_attack_id: attackId }),
    'Annulla attacco'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- effetti attivi (buff/regen/danno nel tempo) */

/* p_source: {characterId: uuid|null, kind: 'tecnica'|'abilita'|'boost'|'ambientale'|'altro', label} */
/* durationKey: una chiave di AZIONE_DURATE (js/data.js). durationQuarters
   (opzionale): alternativa in quarti di turno per durate fisse fuori dal
   menu di scheda (es. il Boost, sempre 12 = 3 turni) — usata dal server
   solo se durationKey non risolve a un valore noto. */
async function applyCombatEffect(encounterId, targetCharacterId, source, effectKind, buffTarget, buffAmount, tickStat, tickAmount, durationKey, durationQuarters, traitMods, shieldHp) {
  const { data, error } = await withTimeout(
    sb.rpc('apply_combat_effect', {
      p_encounter_id: encounterId, p_target_character_id: targetCharacterId, p_source: source,
      p_effect_kind: effectKind, p_buff_target: buffTarget || null, p_buff_amount: buffAmount ?? null,
      p_tick_stat: tickStat || null, p_tick_amount: tickAmount ?? null, p_duration_key: durationKey || null,
      p_duration_quarters: durationQuarters ?? null,
      // Più tratti insieme (es. Infezione: -1 Guardia, -1 altro), invece del
      // solo buffTarget/buffAmount singolo — riusa lo stesso trait_mods già
      // scritto dal motore droghe a due fasi, letto ovunque da getTraitValue.
      p_trait_mods: (traitMods && traitMods.length) ? traitMods : null,
      // Scudo (Sovracura e affini, effectKind='scudo'): magnitudine già
      // rollata lato client (vedi combatRollScaledAmount) — assorbe danno
      // prima degli HP veri, vedi apply_combat_attack_damage.
      p_shield_hp: shieldHp ?? null
    }),
    'Applica effetto'
  );
  if (error) throw error;
  return data;
}

/* Variante multi-bersaglio di applyCombatEffect: stessi parametri, ma
   p_targetCharacterIds è l'elenco esplicito scelto a mano sulla mappa
   (vedi declareCombatAttackMulti per il principio gemello sugli attacchi). */
async function applyCombatEffectMulti(encounterId, targetCharacterIds, source, effectKind, buffTarget, buffAmount, tickStat, tickAmount, durationKey, durationQuarters, traitMods, shieldHp) {
  const { data, error } = await withTimeout(
    sb.rpc('apply_combat_effect_multi', {
      p_encounter_id: encounterId, p_target_character_ids: targetCharacterIds, p_source: source,
      p_effect_kind: effectKind, p_buff_target: buffTarget || null, p_buff_amount: buffAmount ?? null,
      p_tick_stat: tickStat || null, p_tick_amount: tickAmount ?? null, p_duration_key: durationKey || null,
      p_duration_quarters: durationQuarters ?? null,
      p_trait_mods: (traitMods && traitMods.length) ? traitMods : null,
      p_shield_hp: shieldHp ?? null
    }),
    'Applica effetto multi-bersaglio'
  );
  if (error) throw error;
  return data;
}

/* Estensione ESPLICITA della durata di un Boost già attivo (checkpoint
   "Boost e pedina", decisione definitiva: mai automatica) — stesso schema
   minimo di removeCombatEffect (solo l'id dell'effetto), il costo reale
   resta il mantenimento già dedotto ogni turno da combat_tick_effects_for_
   participant: nessun pagamento separato in questa chiamata. */
async function extendCombatBoostEffect(encounterId, effectId, extraQuarters) {
  const { data, error } = await withTimeout(
    sb.rpc('extend_combat_boost_effect', {
      p_encounter_id: encounterId, p_effect_id: effectId, p_extra_quarters: extraQuarters ?? 4
    }),
    'Estendi Boost'
  );
  if (error) throw error;
  return data;
}

async function removeCombatEffect(effectId) {
  const { error } = await withTimeout(
    sb.rpc('remove_combat_effect', { p_effect_id: effectId }),
    'Sospendi effetto'
  );
  if (error) throw error;
}

/* Tentativo di liberazione da Tramortire: tiro percentuale SOLITARIO (mai
   contrapposto), confrontato server-side con una soglia fissa (70% dal 2°
   al 3° turno, 85% dal 4° in poi) — vedi submit_status_escape_roll. Ritorna
   {escaped, threshold, rollTotal, rollDetail}. */
async function submitStatusEscapeRoll(effectId, rollTotal, rollDetail) {
  const { data, error } = await withTimeout(
    sb.rpc('submit_status_escape_roll', { p_effect_id: effectId, p_roll_total: rollTotal, p_roll_detail: rollDetail }),
    'Tentativo di liberazione'
  );
  if (error) throw error;
  return data;
}

/* Uso di un consumabile lato server (submit_use_consumable): applica
   HP/MP/rimozione stato/effetti composti in modo autorizzato anche a
   combattimento attivo (hpCur/mpCur sono bloccati contro scritture dirette
   mentre un personaggio è in un incontro 'active', vedi
   trg_characters_guard_combat_stats) — a differenza della vecchia mutazione
   puramente locale. p_choice_status_key serve solo per l'effetto
   'rimuoviStatoScelta' (es. Kit medico). Ritorna { character }. */
async function submitUseConsumableCloud(characterId, consumableIndex, choiceStatusKey) {
  const { data, error } = await withTimeout(
    sb.rpc('submit_use_consumable', {
      p_character_id: characterId, p_consumable_index: consumableIndex,
      p_choice_status_key: choiceStatusKey || null
    }),
    'Uso oggetto'
  );
  if (error) throw error;
  return data;
}

/* Tiro di Resistenza sotto la soglia K.O. (10% di hpMaxTracked): dovuto
   OGNI turno in cui il personaggio resta sotto soglia, indipendente e
   ripetibile (non legato a un attacco, vedi submit_ko_check — che rifiuta
   la chiamata se il tiro non è davvero dovuto o è già stato tentato questo
   turno). Ritorna {success, threshold, rollTotal, rollDetail}. */
async function submitKoCheck(encounterId, characterId, rollTotal, rollDetail) {
  const { data, error } = await withTimeout(
    sb.rpc('submit_ko_check', {
      p_encounter_id: encounterId, p_character_id: characterId,
      p_roll_total: rollTotal, p_roll_detail: rollDetail
    }),
    'Tiro K.O.'
  );
  if (error) throw error;
  return data;
}

/* Unico trigger che fa scendere i countdown: incrementa il round e applica
   i tick di tutti gli effetti attivi lato server (vedi advance_combat_round).
   Ritorna {encounter, ticks:[{targetCharacterId, sourceLabel, effectKind, tickStat, delta}]}
   così il chiamante può mostrare un toast di riepilogo senza ricalcolare nulla. */
async function advanceCombatRound(encounterId) {
  const { data, error } = await withTimeout(
    sb.rpc('advance_combat_round', { p_encounter_id: encounterId }),
    'Avanza turno'
  );
  if (error) throw error;
  return data;
}

/* Passa il turno del proprio personaggio (o, come Narratore, di chiunque):
   avanza al successivo in ordine di iniziativa, o fa scattare l'avanzamento
   del round (stesso motore di advanceCombatRound) se era l'ultimo — vedi
   combat_pass_turn. Stessa forma di ritorno di advanceCombatRound. */
async function passCombatTurn(encounterId, characterId) {
  const { data, error } = await withTimeout(
    sb.rpc('combat_pass_turn', { p_encounter_id: encounterId, p_character_id: characterId }),
    'Passa turno'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- realtime */

/* A differenza di startNarratoreRealtimeWatch (cloud-account.js, avviato una
   volta sola all'apertura dell'app e mai fermato), il canale di combattimento
   è per-encounter: si apre entrando in view-combat e si chiude uscendone
   (vedi showViewDom/goBackStep in app.js), altrimenti resterebbero canali
   di combattimenti ormai chiusi ad ascoltare per sempre.

   Nessuna delle tre tabelle porta uno stat block (redatto o meno): ogni
   evento, qualunque tabella l'abbia generato, si limita a dire "qualcosa è
   cambiato" e fa ripartire una singola fetchCombatBoard() — la redazione
   vive solo dentro get_combat_board, mai ricostruita da un delta realtime
   lato client (vedi commento nella migrazione realtime). */
let combatRealtimeChannel = null;
let combatRealtimeOnChange = null;
let combatRealtimeDebounceTimer = null;

function startCombatRealtimeWatch(encounterId, onChange) {
  stopCombatRealtimeWatch();
  combatRealtimeOnChange = onChange;
  const debouncedNotify = () => {
    clearTimeout(combatRealtimeDebounceTimer);
    combatRealtimeDebounceTimer = setTimeout(() => {
      if (typeof combatRealtimeOnChange === 'function') combatRealtimeOnChange();
    }, 150);
  };
  combatRealtimeChannel = sb.channel('campaign-combat-' + encounterId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_participants', filter: 'encounter_id=eq.' + encounterId }, debouncedNotify)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_attacks', filter: 'encounter_id=eq.' + encounterId }, debouncedNotify)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_active_effects', filter: 'encounter_id=eq.' + encounterId }, debouncedNotify)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_encounters', filter: 'id=eq.' + encounterId }, debouncedNotify)
    .subscribe();
}

function stopCombatRealtimeWatch() {
  clearTimeout(combatRealtimeDebounceTimer);
  combatRealtimeOnChange = null;
  if (!combatRealtimeChannel) return;
  sb.removeChannel(combatRealtimeChannel);
  combatRealtimeChannel = null;
}
