/* ==========================================================================
   Role Makers — Mappa della sessione, vista dei personaggi (story_map_2d_v1,
   checkpoint M2). Sopra lo stesso canvas Leaflet CRS.Simple introdotto in
   M1 (js/story-map-editor.js, di cui riusa mapNormToLatLng/mapLatLngToNorm
   e le funzioni dati campaign_maps/session_map_state): qui SOLO la lettura
   e la presentazione dei personaggi partecipanti — personaggi in luoghi
   diversi, due o più nello stesso punto (anello/contatore), apertura
   radiale al tocco, presenza online/via/offline separata dalla posizione
   (riusa la stessa Presence di C3, mai un secondo canale), colori
   coordinati con la chat privata. Il MOVIMENTO vero e proprio (trascinare
   il proprio indicatore, richieste, approvazioni) è il prossimo checkpoint
   (M3): qui i personaggi sono presentati, non ancora spostabili dal
   giocatore. */

const MAP_SESSION_STATE = {
  campaignId: null,
  myCharacter: null,
  myColor: null,
  participants: [],
  radialGroupKey: null,
  detailCharacterId: null,
  isMaster: false,
  locationsById: {},
  _lastOpts: null,
  leafletMap: null,      // per refreshMapSessionCanvasSize(), stesso bug/correzione di story-map-editor.js
  leafletBounds: null
};

/* ------------------------------------------------------------ dati */

async function listMapSessionParticipants(campaignId) {
  const { data, error } = await withTimeout(
    sb.rpc('list_map_session_participants', { p_campaign_id: campaignId }),
    'Partecipanti alla mappa'
  );
  if (error) throw error;
  return data || [];
}

async function getCampaignCharacterMapColor(ownerUserId, campaignId) {
  const { data, error } = await withTimeout(
    sb.rpc('get_campaign_character_map_color', { p_owner_user_id: ownerUserId, p_campaign_id: campaignId }),
    'Colore personaggio'
  );
  if (error) throw error;
  return data || null;
}

async function findMyActiveCharacterInCampaign(campaignId) {
  const session = await currentCloudSession();
  if (!session) return null;
  const { data, error } = await withTimeout(
    sb.from('characters').select('id, name, portrait_url').eq('campaign_id', campaignId)
      .eq('owner_user_id', session.user.id).eq('sheet_status', 'attiva').limit(1).maybeSingle(),
    'Il tuo personaggio'
  );
  if (error) throw error;
  return data || null;
}

async function getMyCharacterMapPreference(characterId) {
  const { data, error } = await withTimeout(
    sb.from('character_map_preferences').select('color, symbol').eq('character_id', characterId).maybeSingle(),
    'Preferenza colore'
  );
  if (error) throw error;
  return data || null;
}

/* ------------------------------------------------------------ raggruppamento */

/* Un gruppo = un LUOGO (location_id), non più solo coordinate vicine
   (correzioni mirate pacchetto v1, punto 14): due personaggi mandati allo
   stesso luogo da narratore_move_character/request_character_move
   condividono sempre lo stesso location_id (e le stesse x/y del luogo,
   vedi supabase/migrations/20260930150000_chat_identity_and_map_location_id.sql)
   — raggrupparli per location_id resta affidabile anche quando più luoghi
   sono vicini sulla mappa, cosa che il solo confronto di coordinate
   arrotondate non garantiva. Il fallback spaziale (coordinate
   arrotondate) resta SOLO per le posizioni libere (location_id = null:
   appena entrati in mappa a (0.5, 0.5), o spostati a una coordinata
   libera in modalità 'free'). Ritorna un array di gruppi
   {locationId,x,y,members[]}. */
function groupMapParticipantsByPoint(participants) {
  const groups = {};
  participants.forEach(p => {
    const key = p.location_id ? ('loc:' + p.location_id) : ('xy:' + Number(p.x).toFixed(3) + '|' + Number(p.y).toFixed(3));
    if (!groups[key]) groups[key] = { locationId: p.location_id || null, x: Number(p.x), y: Number(p.y), members: [] };
    groups[key].members.push(p);
  });
  return Object.values(groups);
}

function conicGradientForColors(colors) {
  const n = colors.length;
  const step = 100 / n;
  const stops = colors.map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(', ');
  return `conic-gradient(${stops})`;
}

function participantInitial(p) {
  return (p.symbol && p.symbol.trim()) || (p.name || '?').trim().charAt(0).toUpperCase() || '?';
}
function participantColor(p) {
  return p.color || 'var(--testo-secondario-dark)';
}

/* ------------------------------------------------------------ rendering Leaflet */

/* Layer condiviso: usato sia dalla vista di sessione del giocatore (sola
   lettura) sia — se disponibile — dal canvas del Narratore in M1, per non
   duplicare la logica di raggruppamento/disegno in due posti.
   opts.excludeCharacterId: il proprio personaggio ha già un segnaposto
   dedicato trascinabile (renderMyOwnDraggableMarker, disegnato sopra
   questo layer) — escluderlo qui evita di disegnarlo due volte (bug di
   doppio rendering corretto, correzioni mirate punto 14). opts.locations
   e opts.isMaster alimentano l'etichetta del luogo e i controlli del
   Narratore nel pannello di dettaglio (vedi showMapCharacterDetail). */
function renderMapParticipantsLayer(map, leafletMap, participants, opts) {
  if (!leafletMap) return;
  opts = opts || {};
  if (MAP_SESSION_STATE._layerGroup) { leafletMap.removeLayer(MAP_SESSION_STATE._layerGroup); }
  const layerGroup = L.layerGroup().addTo(leafletMap);
  MAP_SESSION_STATE._layerGroup = layerGroup;
  MAP_SESSION_STATE._currentMap = map;
  MAP_SESSION_STATE._currentLeafletMap = leafletMap;
  MAP_SESSION_STATE.isMaster = !!opts.isMaster;
  MAP_SESSION_STATE.locationsById = {};
  (opts.locations || []).forEach(loc => { MAP_SESSION_STATE.locationsById[loc.id] = loc; });
  // Riusato dal ridisegno su 'rm-presence-updated' qui sotto: la presenza
  // cambia senza passare di nuovo da renderMapSessionView/renderMapEditorCanvas,
  // che altrimenti perderebbe isMaster/locations/esclusione del proprio
  // personaggio a ogni aggiornamento di presenza (avrebbe fatto ricomparire
  // il doppio segnaposto e i controlli del Narratore).
  MAP_SESSION_STATE._lastOpts = opts;
  closeMapClusterPanel();
  closeMapCharacterDetail();

  const visible = opts.excludeCharacterId ? participants.filter(p => p.character_id !== opts.excludeCharacterId) : participants;
  const groups = groupMapParticipantsByPoint(visible);
  groups.forEach(group => {
    const latlng = mapNormToLatLng(group.x, group.y, map.width_px, map.height_px);
    const locName = group.locationId && MAP_SESSION_STATE.locationsById[group.locationId] ? MAP_SESSION_STATE.locationsById[group.locationId].name : null;
    let html;
    if (group.members.length === 1) {
      const p = group.members[0];
      const presence = rmPresenceStatusFor(p.owner_user_id);
      html = `<div class="map-char-pin map-char-pin-presence-${presence}" title="${escapeHtml(p.name)}${locName ? ' — ' + escapeHtml(locName) : ''}">
        <div class="map-char-pin-core" style="background:${participantColor(p)};">${escapeHtml(participantInitial(p))}</div>
      </div>`;
    } else if (group.members.length <= 4) {
      const colors = group.members.map(participantColor);
      html = `<div class="map-cluster-ring" style="background:${conicGradientForColors(colors)};" title="${group.members.length} personaggi${locName ? ' — ' + escapeHtml(locName) : ''}"></div>`;
    } else {
      const colors = group.members.map(participantColor);
      html = `<div class="map-cluster-multiborder" style="background:${conicGradientForColors(colors)};" title="${group.members.length} personaggi${locName ? ' — ' + escapeHtml(locName) : ''}">
        <div class="map-cluster-counter-inner">${group.members.length}</div>
      </div>`;
    }
    const icon = L.divIcon({ className: '', html, iconSize: [38, 38], iconAnchor: [19, 19] });
    const marker = L.marker(latlng, { icon, keyboard: false });
    marker.on('click', (ev) => {
      if (ev.originalEvent) ev.originalEvent._mapMarkerHandled = true;
      const point = leafletMap.latLngToContainerPoint(latlng);
      if (group.members.length === 1) {
        MAP_SESSION_STATE.detailCharacterId = group.members[0].character_id;
        showMapCharacterDetail(leafletMap, point, group.members[0]);
      } else {
        openMapClusterPanel(leafletMap, point, group);
      }
    });
    marker.addTo(layerGroup);
  });
}

/* Cluster (2+ personaggi nello stesso luogo): un bottom sheet ancorato al
   fondo dello schermo su mobile, un popover ancorato al punto toccato su
   desktop — non più l'apertura radiale (mini-avatar che uscivano dai
   bordi della mappa su schermi piccoli, correzioni mirate punto 14).
   Stessa soglia 768px già in uso nel resto dell'app (css/style.css). Un
   tocco su un membro apre il suo dettaglio (showMapCharacterDetail);
   chiusura automatica toccando fuori (listener su document, capture). */
function mapViewportIsDesktop() {
  return !!(window.matchMedia && window.matchMedia('(min-width:768px)').matches);
}
function openMapClusterPanel(leafletMap, containerPoint, group) {
  closeMapClusterPanel();
  closeMapCharacterDetail();
  const mapEl = leafletMap.getContainer();
  const desktop = mapViewportIsDesktop();
  const locName = group.locationId && MAP_SESSION_STATE.locationsById[group.locationId] ? MAP_SESSION_STATE.locationsById[group.locationId].name : null;
  const panel = document.createElement('div');
  panel.className = desktop ? 'map-cluster-popover' : 'map-cluster-sheet';
  if (desktop) { panel.style.left = containerPoint.x + 'px'; panel.style.top = containerPoint.y + 'px'; }
  panel.innerHTML = `
    <div class="map-cluster-head">
      <strong>${escapeHtml(locName || (group.members.length + ' personaggi'))}</strong>
      <button type="button" class="btn btn-icon btn-ghost btn-sm" data-clusterclose aria-label="Chiudi">✕</button>
    </div>
    <div class="map-cluster-list">${group.members.map(p => {
      const presence = rmPresenceStatusFor(p.owner_user_id);
      return `<button type="button" class="map-cluster-item" data-clustermember="${escapeHtml(p.character_id)}">
        <span class="map-char-pin map-char-pin-presence-${presence}" style="width:32px;height:32px;">
          ${p.portrait_url ? `<img src="${escapeHtml(p.portrait_url)}" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">` : `<span class="map-char-pin-core" style="background:${participantColor(p)};width:100%;height:100%;">${escapeHtml(participantInitial(p))}</span>`}
        </span>
        <span class="map-cluster-item-name">${escapeHtml(p.name)}</span>
      </button>`;
    }).join('')}</div>
  `;
  mapEl.appendChild(panel);
  panel.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-clusterclose]')) { closeMapClusterPanel(); return; }
    const item = ev.target.closest('[data-clustermember]');
    if (!item) return;
    const p = group.members.find(m => m.character_id === item.dataset.clustermember);
    if (!p) return;
    closeMapClusterPanel();
    const point = leafletMap.latLngToContainerPoint(mapNormToLatLng(group.x, group.y, MAP_SESSION_STATE._currentMap.width_px, MAP_SESSION_STATE._currentMap.height_px));
    MAP_SESSION_STATE.detailCharacterId = p.character_id;
    showMapCharacterDetail(leafletMap, point, p);
  });
  MAP_SESSION_STATE.radialGroupKey = group.members.map(m => m.character_id).join(',');
}
function closeMapClusterPanel() {
  MAP_SESSION_STATE.radialGroupKey = null;
  document.querySelectorAll('.map-cluster-sheet,.map-cluster-popover').forEach(e => e.remove());
}

const MAP_PRESENCE_LABEL = { online: 'Online', away: 'Assente', offline: 'Disconnesso' };

function showMapCharacterDetail(leafletMap, point, p) {
  closeMapCharacterDetail();
  const mapEl = leafletMap.getContainer();
  const presence = rmPresenceStatusFor(p.owner_user_id);
  const locName = p.location_id && MAP_SESSION_STATE.locationsById[p.location_id] ? MAP_SESSION_STATE.locationsById[p.location_id].name : null;
  const el = document.createElement('div');
  el.className = 'map-detail-popup';
  el.style.left = point.x + 'px'; el.style.top = point.y + 'px';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <div class="map-char-pin map-char-pin-presence-${presence}" style="width:38px;height:38px;">
        ${p.portrait_url
          ? `<img src="${escapeHtml(p.portrait_url)}" alt="" style="width:26px;height:26px;border-radius:50%;object-fit:cover;">`
          : `<div class="map-char-pin-core" style="background:${participantColor(p)};">${escapeHtml(participantInitial(p))}</div>`}
      </div>
      <div>
        <div style="font-weight:600;">${escapeHtml(p.name)}</div>
        <div class="helper-text" style="margin:0;">${MAP_PRESENCE_LABEL[presence] || 'Disconnesso'}${locName ? ' · ' + escapeHtml(locName) : ''}</div>
      </div>
    </div>
  `;
  // Controlli del Narratore (correzioni mirate punto 14): "Sposta" verso
  // un luogo esistente copre anche "correggi posizione" (stessa RPC
  // narratore_move_character, già presente in js/story-map-editor.js ma
  // finora mai collegata a un controllo reale) e "Blocca/Sblocca" il
  // movimento di QUESTO personaggio — mai per i giocatori, solo per chi
  // amministra la storia.
  if (MAP_SESSION_STATE.isMaster) {
    const locations = Object.values(MAP_SESSION_STATE.locationsById);
    const actions = document.createElement('div');
    actions.className = 'map-detail-actions';
    actions.innerHTML =
      (locations.length
        ? `<button type="button" class="btn btn-ghost btn-sm" data-mapchardetail-movetoggle>📍 Sposta / correggi posizione</button>
           <div class="map-detail-move-list hidden">${locations.map(l => `<button type="button" class="btn btn-ghost btn-sm" data-mapchardetail-moveto="${escapeHtml(l.id)}">→ ${escapeHtml(l.name)}</button>`).join('')}</div>`
        : '<p class="helper-text" style="margin:0;">Nessun luogo definito su questa mappa.</p>') +
      `<button type="button" class="btn btn-ghost btn-sm" data-mapchardetail-lock>${p.movement_locked ? '🔓 Sblocca movimento' : '🔒 Blocca movimento'}</button>`;
    el.appendChild(actions);
    actions.addEventListener('click', async (ev) => {
      const moveToggle = ev.target.closest('[data-mapchardetail-movetoggle]');
      if (moveToggle) { const list = actions.querySelector('.map-detail-move-list'); if (list) list.classList.toggle('hidden'); return; }
      const moveTo = ev.target.closest('[data-mapchardetail-moveto]');
      if (moveTo) {
        try { await narratoreMoveCharacterCloud(p.character_id, moveTo.dataset.mapchardetailMoveto, null, null); toast('Personaggio spostato.'); closeMapCharacterDetail(); }
        catch (e) { toast(describeError(e)); }
        return;
      }
      const lockBtn = ev.target.closest('[data-mapchardetail-lock]');
      if (lockBtn) {
        try { await narratoreSetCharacterMovementLockCloud(p.character_id, !p.movement_locked); toast(p.movement_locked ? 'Movimento sbloccato.' : 'Movimento bloccato.'); closeMapCharacterDetail(); }
        catch (e) { toast(describeError(e)); }
        return;
      }
    });
  }
  mapEl.appendChild(el);
}
function closeMapCharacterDetail() {
  MAP_SESSION_STATE.detailCharacterId = null;
  document.querySelectorAll('.map-detail-popup').forEach(e => e.remove());
}

document.addEventListener('click', function (ev) {
  if (ev.target.closest('.map-cluster-sheet') || ev.target.closest('.map-cluster-popover') || ev.target.closest('.map-detail-popup') || (ev.originalEvent && ev.originalEvent._mapMarkerHandled)) return;
  if (ev._mapMarkerHandled) return;
  closeMapClusterPanel();
  closeMapCharacterDetail();
}, true);

document.addEventListener('rm-presence-updated', function () {
  if (MAP_SESSION_STATE._currentMap && MAP_SESSION_STATE._currentLeafletMap && MAP_SESSION_STATE.participants.length) {
    renderMapParticipantsLayer(MAP_SESSION_STATE._currentMap, MAP_SESSION_STATE._currentLeafletMap, MAP_SESSION_STATE.participants, MAP_SESSION_STATE._lastOpts);
  }
});

/* ------------------------------------------------------------ realtime (M3) */

/* Stesso pattern già in uso per Conversazioni (checkpoint C3,
   js/cloud-contacts-chat.js): un canale per sessione, "*" su ciascuna
   tabella rilevante, ridisegno con un piccolo debounce — mai una seconda
   infrastruttura. Usato SIA dalla vista di sessione (giocatore) SIA dal
   canvas del Narratore (M1/story-map-editor.js), entrambi richiamano
   solo questa singola funzione. */
let mapSessionRealtimeChannel = null;
let mapSessionRealtimeDebounce = null;
async function subscribeMapSessionRealtime(campaignId) {
  unsubscribeMapSessionRealtime();
  const session = await currentCloudSession();
  if (!session) return;
  mapSessionRealtimeChannel = sb.channel('map-session-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_character_positions' }, scheduleMapSessionRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'map_move_requests' }, scheduleMapSessionRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_map_state' }, scheduleMapSessionRefresh)
    .subscribe();
}
function unsubscribeMapSessionRealtime() {
  clearTimeout(mapSessionRealtimeDebounce);
  if (!mapSessionRealtimeChannel) return;
  sb.removeChannel(mapSessionRealtimeChannel);
  mapSessionRealtimeChannel = null;
}
function scheduleMapSessionRefresh() {
  clearTimeout(mapSessionRealtimeDebounce);
  mapSessionRealtimeDebounce = setTimeout(function () {
    const panel = $('[data-camppanel="mappa"]');
    if (!panel || !MAP_SESSION_STATE.campaignId) return;
    // Il Narratore ha il proprio canvas (M1/story-map-editor.js): qui
    // aggiorniamo solo il layer partecipanti + la coda di richieste,
    // mai l'intera vista (perderebbe lo stato dell'editor in corso).
    if (typeof isCampaignMapMaster === 'function') {
      isCampaignMapMaster(MAP_SESSION_STATE.campaignId).then(isMaster => {
        if (isMaster) {
          const map = (typeof MAP_EDITOR_STATE !== 'undefined') ? MAP_EDITOR_STATE.maps.find(m => m.id === MAP_EDITOR_STATE.editingMapId) : null;
          if (map && MAP_EDITOR_STATE.leafletMap) {
            listMapSessionParticipants(MAP_SESSION_STATE.campaignId).then(p => renderMapParticipantsLayer(map, MAP_EDITOR_STATE.leafletMap, p, { isMaster: true, locations: MAP_EDITOR_STATE.locations || [] })).catch(() => {});
            if (typeof renderMapMoveRequestsPanel === 'function') renderMapMoveRequestsPanel(map).catch(() => {});
          }
        } else {
          renderMapSessionView(MAP_SESSION_STATE.campaignId);
        }
      });
    }
  }, 250);
}

/* ------------------------------------------------------------ movimento del proprio personaggio (M3) */

/* Segnaposto separato e trascinabile per il PROPRIO personaggio, sempre
   sopra il layer di sola lettura (anche se il proprio personaggio è
   dentro un cluster con altri: qui resta comunque individualmente
   raggiungibile/trascinabile) — "selezionare il proprio indicatore,
   trascinarlo... confermare 'Sposta in...'". */
function renderMyOwnDraggableMarker(map, leafletMap, myChar, myPosition, movementMode) {
  if (MAP_SESSION_STATE._myMarker) { leafletMap.removeLayer(MAP_SESSION_STATE._myMarker); MAP_SESSION_STATE._myMarker = null; }
  if (!myChar || !myPosition) return;
  const draggable = movementMode !== 'locked' && !myPosition.movement_locked;
  const latlng = mapNormToLatLng(myPosition.x, myPosition.y, map.width_px, map.height_px);
  const html = `<div class="map-char-pin map-char-pin-selected" style="border-color:#fff;" title="Tu — ${escapeHtml(myChar.name)}">
    <div class="map-char-pin-core" style="background:${MAP_SESSION_STATE.myColor || '#E0E0E0'};">${escapeHtml((myChar.name || '?').charAt(0).toUpperCase())}</div>
  </div>`;
  const icon = L.divIcon({ className: '', html, iconSize: [38, 38], iconAnchor: [19, 19] });
  const marker = L.marker(latlng, { icon, draggable, keyboard: false, zIndexOffset: 1000 });
  marker.on('dragend', async () => {
    const p = marker.getLatLng();
    const norm = mapLatLngToNorm(p.lat, p.lng, map.width_px, map.height_px);
    const modeLabel = movementMode === 'free' ? 'Confermi lo spostamento? Sarà applicato subito.' : 'Confermi la richiesta di spostamento? Il Narratore dovrà approvarla.';
    if (!confirm(modeLabel)) { marker.setLatLng(latlng); return; }
    try {
      const result = await requestCharacterMoveCloud(myChar.id, null, norm.x, norm.y);
      toast(result && result.applied ? 'Spostamento applicato.' : 'Richiesta inviata: in attesa di approvazione del Narratore.');
    } catch (e) { toast(describeError(e)); marker.setLatLng(latlng); }
  });
  marker.addTo(leafletMap);
  MAP_SESSION_STATE._myMarker = marker;
}

async function requestCharacterMoveCloud(characterId, locationId, x, y) {
  const { data, error } = await withTimeout(
    sb.rpc('request_character_move', { p_character_id: characterId, p_target_location_id: locationId || null, p_target_x: locationId ? null : x, p_target_y: locationId ? null : y }),
    'Richiesta di spostamento'
  );
  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------ vista giocatore */

function mapColorPaletteHtml(selectedColor) {
  const colors = ['#FF7A33', '#33D6E8', '#FFD873', '#6BFFAF', '#B38CFF', '#FF6B9D', '#5B8DEF', '#FF5C5C', '#4FD1C5', '#E0E0E0'];
  return colors.map(c => `<button type="button" class="map-color-swatch${c === selectedColor ? ' map-color-swatch-selected' : ''}" style="background:${c};" data-mapcolor="${c}" aria-label="Colore ${c}"></button>`).join('');
}

/* Vista di sessione per chi NON è Narratore (renderCampaignMapPanel
   chiama questa invece del placeholder quando esiste una mappa attiva).
   Sola lettura di luoghi/personaggi: il movimento del proprio personaggio
   arriva a M3. */
async function renderMapSessionView(campaignId) {
  const panel = $('[data-camppanel="mappa"]');
  if (!panel) return;
  MAP_SESSION_STATE.campaignId = campaignId;
  try {
    const sessionState = await getSessionMapState(campaignId);
    if (!sessionState.active_map_id) {
      panel.innerHTML = '<p class="helper-text" style="margin:0;">Nessuna mappa attiva al momento per questa storia.</p>';
      return;
    }
    const maps = await listCampaignMaps(campaignId);
    const map = maps.find(m => m.id === sessionState.active_map_id) || (await (async () => {
      const { data } = await sb.from('campaign_maps').select('id, title, description, storage_path, width_px, height_px').eq('id', sessionState.active_map_id).maybeSingle();
      return data;
    })());
    if (!map) { panel.innerHTML = '<p class="helper-text" style="margin:0;">Nessuna mappa attiva al momento per questa storia.</p>'; return; }

    const myChar = await findMyActiveCharacterInCampaign(campaignId);
    MAP_SESSION_STATE.myCharacter = myChar;
    let myPref = null;
    if (myChar) myPref = await getMyCharacterMapPreference(myChar.id);
    MAP_SESSION_STATE.myColor = myPref ? myPref.color : null;

    startPresence();

    panel.innerHTML = `
      <div class="section-title" style="margin-top:0;">${escapeHtml(map.title)}</div>
      ${map.description ? `<p class="helper-text" style="margin:0 0 8px;">${escapeHtml(map.description)}</p>` : ''}
      <div id="map-session-join-box"></div>
      <div id="map-session-canvas-wrap" style="position:relative;margin-top:8px;">
        <div id="map-session-leaflet-canvas" class="map-canvas"></div>
        <div class="map-canvas-loading" id="map-session-canvas-loading">Caricamento mappa…</div>
      </div>
    `;

    const joinBox = $('#map-session-join-box');
    if (myChar) {
      joinBox.innerHTML = `
        <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:8px;">
          <p class="helper-text" style="margin:0;">Colore del tuo personaggio sulla mappa (coordinato con la chat privata):</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;" id="map-session-palette">${mapColorPaletteHtml(MAP_SESSION_STATE.myColor)}</div>
          <button type="button" class="btn btn-primary btn-sm" id="map-session-join-btn" style="align-self:flex-start;" ${MAP_SESSION_STATE.myColor ? '' : 'disabled'}>📍 Entra in mappa</button>
        </div></div>`;
    } else {
      joinBox.innerHTML = '<p class="helper-text" style="margin:0;">Non hai un personaggio attivo in questa storia.</p>';
    }

    const bounds = [[0, 0], [map.height_px, map.width_px]];
    let imageUrl;
    try { imageUrl = await getCampaignMapImageUrl(map.storage_path); }
    catch (e) { $('#map-session-canvas-wrap').innerHTML = `<p class="helper-text" style="margin:0;">Errore nel caricare l'immagine: ${escapeHtml(describeError(e))}</p>`; return; }
    const lmap = L.map('map-session-leaflet-canvas', { crs: L.CRS.Simple, minZoom: -3, attributionControl: false });
    // Stato di caricamento reale (correzioni mirate punto 15): l'overlay
    // resta finché il browser non ha davvero finito di scaricare/decodificare
    // l'immagine (evento 'load' di L.ImageOverlay), mai un timer finto.
    const sessionOverlay = L.imageOverlay(imageUrl, bounds).addTo(lmap);
    const hideCanvasLoading = () => { const l = $('#map-session-canvas-loading'); if (l) l.remove(); };
    sessionOverlay.on('load', hideCanvasLoading);
    sessionOverlay.on('error', hideCanvasLoading);
    lmap.fitBounds(bounds);
    MAP_SESSION_STATE.leafletMap = lmap;
    MAP_SESSION_STATE.leafletBounds = bounds;

    const locations = await listMapLocations(map.id).catch(() => []);
    locations.forEach(loc => {
      const latlng = mapNormToLatLng(loc.x, loc.y, map.width_px, map.height_px);
      const icon = mapLocationMarkerIcon(loc, 26, true);
      const locMarker = L.marker(latlng, { icon, keyboard: false, interactive: false }).addTo(lmap);
      locMarker.bindTooltip(loc.name, { permanent: true, direction: 'bottom', offset: [0, 2], className: 'map-loc-label' });
    });

    const participants = await listMapSessionParticipants(campaignId);
    MAP_SESSION_STATE.participants = participants;
    renderMapParticipantsLayer(map, lmap, participants, { excludeCharacterId: myChar ? myChar.id : null, locations, isMaster: false });

    const myPosition = myChar ? participants.find(p => p.character_id === myChar.id) : null;
    renderMyOwnDraggableMarker(map, lmap, myChar, myPosition, sessionState.movement_mode);
    if (myPosition) {
      try {
        const { data: pendingRow } = await sb.from('map_move_requests').select('id').eq('character_id', myChar.id).eq('status', 'pending').limit(1).maybeSingle();
        if (pendingRow) {
          const badge = document.createElement('p');
          badge.className = 'helper-text'; badge.style.margin = '6px 0 0';
          badge.textContent = '⏳ Hai una richiesta di spostamento in attesa di approvazione.';
          $('#map-session-canvas-wrap').appendChild(badge);
        }
      } catch (e) { /* non essenziale: un errore qui non deve rompere il resto della vista */ }
    }

    if (joinBox.querySelector('#map-session-join-btn')) {
      const iAlreadyJoined = myChar && participants.some(p => p.character_id === myChar.id);
      if (iAlreadyJoined) {
        joinBox.querySelector('#map-session-join-btn').textContent = '✅ Sei sulla mappa';
        joinBox.querySelector('#map-session-join-btn').disabled = true;
      }
    }
    if (sessionState.movement_mode === 'locked') {
      const lockNote = document.createElement('p');
      lockNote.className = 'helper-text'; lockNote.style.margin = '6px 0 0';
      lockNote.textContent = '🔴 Il Narratore ha bloccato il movimento su questa mappa.';
      $('#map-session-canvas-wrap').appendChild(lockNote);
    }

    subscribeMapSessionRealtime(campaignId);
  } catch (e) {
    panel.innerHTML = `<p class="helper-text" style="margin:0;">Errore: ${escapeHtml(describeError(e))}</p>`;
  }
}

/* Stesso bug/correzione di refreshMapEditorCanvasSize() in
   story-map-editor.js: renderCampaignMapPanel() (quindi renderMapSessionView())
   può girare mentre il tab "Mappa" non è ancora quello attivo (.tab-panel
   resta display:none), creando L.map() in un contenitore a dimensione
   zero — Leaflet non ricalcola da solo quando il tab diventa visibile
   più tardi. activateCampaignSheetTab() chiama questa funzione ogni volta
   che "Mappa" diventa il tab attivo. */
function refreshMapSessionCanvasSize() {
  const lmap = MAP_SESSION_STATE.leafletMap;
  if (!lmap) return;
  lmap.invalidateSize();
  if (MAP_SESSION_STATE.leafletBounds) lmap.fitBounds(MAP_SESSION_STATE.leafletBounds);
}

document.addEventListener('DOMContentLoaded', function () {
  const panel = $('[data-camppanel="mappa"]');
  if (!panel) return;

  panel.addEventListener('click', function (ev) {
    const swatch = ev.target.closest('[data-mapcolor]');
    if (swatch) {
      MAP_SESSION_STATE.myColor = swatch.dataset.mapcolor;
      const palette = $('#map-session-palette');
      if (palette) palette.querySelectorAll('.map-color-swatch').forEach(b => b.classList.toggle('map-color-swatch-selected', b.dataset.mapcolor === MAP_SESSION_STATE.myColor));
      const joinBtn = $('#map-session-join-btn');
      if (joinBtn) joinBtn.disabled = false;
      return;
    }
    const joinBtn = ev.target.closest('#map-session-join-btn');
    if (joinBtn) {
      (async () => {
        const campaignId = MAP_SESSION_STATE.campaignId;
        const myChar = MAP_SESSION_STATE.myCharacter;
        if (!campaignId || !myChar || !MAP_SESSION_STATE.myColor) return;
        joinBtn.disabled = true;
        try {
          await setCharacterMapColorCloud(myChar.id, MAP_SESSION_STATE.myColor);
          await joinMapSessionCloud(myChar.id);
          await renderMapSessionView(campaignId);
        } catch (e) { toast(describeError(e)); joinBtn.disabled = false; }
      })();
      return;
    }
  });
});

async function setCharacterMapColorCloud(characterId, color) {
  const { error } = await withTimeout(sb.rpc('set_character_map_color', { p_character_id: characterId, p_color: color }), 'Colore personaggio');
  if (error) throw error;
}

async function joinMapSessionCloud(characterId) {
  const { error } = await withTimeout(sb.rpc('join_map_session', { p_character_id: characterId }), 'Ingresso in mappa');
  if (error) throw error;
}
