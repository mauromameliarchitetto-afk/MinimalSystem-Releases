/* ==========================================================================
   Role Makers — Editor mappa narrativa 2D (story_map_2d_v1, checkpoint M1)

   Pannello "Mappa" nella scheda storia (#view-campaignsheet, tab già
   esistente): libreria mappe del Narratore (caricamento JPG/PNG/WebP,
   titolo/descrizione, attivazione/disattivazione/sostituzione), luoghi
   (inserimento toccando la mappa, modifica, eliminazione, blocco
   destinazione) e modalità di movimento per la sessione — tutto sopra
   Leaflet in modalità CRS.Simple (mappa piatta su un'immagine, mai una
   mappa geografica reale), vendorizzato in checkpoint precedente
   (js/vendor/leaflet.js). Nessuna scrittura diretta sul database: ogni
   azione passa dalle RPC/policy già definite in
   supabase/migrations/20260930130000_story_map_2d_schema.sql.

   A flag spento (produzione) il tab "Mappa" resta nascosto (vedi
   renderCampaignMapPanel sotto) e questo file non altera nulla del resto
   della scheda storia. M2 (vista di sessione per i giocatori) e M3
   (movimento multiutente dal vivo) arrivano come checkpoint successivi:
   qui il movimento è raggiungibile SOLO dal Narratore (narratore_move_character,
   già presente nello schema) per verificare visivamente luoghi/posizioni
   durante l'editing, non è ancora l'esperienza del giocatore. */

const MAP_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const MAP_IMAGE_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAP_LOCATION_ICONS = [
  { key: 'luogo', label: '📍 Luogo' },
  { key: 'insediamento', label: '🏠 Insediamento' },
  { key: 'natura', label: '🌲 Natura' },
  { key: 'pericolo', label: '⚠️ Pericolo' },
  { key: 'porta', label: '🚪 Passaggio' },
  { key: 'segreto', label: '❓ Segreto' }
];
function mapLocationIconEmoji(key) {
  const found = MAP_LOCATION_ICONS.find(i => i.key === key);
  return found ? found.label.split(' ')[0] : '📍';
}

/* Icona a spillo condivisa per i marker dei luoghi (correzioni mirate
   punto 15): non più solo l'emoji del tipo come unico segno (illeggibile
   a zoom basso, resa incoerente fra piattaforme) — la forma è sempre lo
   stesso pin vettoriale (rm-map-luogo, sprite in index.html), l'emoji
   resta come piccolo distintivo del tipo nell'angolo. L'etichetta col
   nome del luogo è un tooltip Leaflet permanente legato dal chiamante
   (addOrUpdateLocationMarker/renderMapSessionView), non fa parte
   dell'icona stessa. */
function mapLocationMarkerIcon(loc, sizePx, dimmed) {
  const size = sizePx || 32;
  return L.divIcon({
    className: '',
    html: `<div class="map-loc-pin${loc.locked_destination ? ' map-loc-pin-locked' : ''}${!loc.visible_to_players ? ' map-loc-pin-hidden' : ''}" style="width:${size}px;height:${size}px;${dimmed ? 'opacity:.6;' : ''}">
      <svg class="map-loc-pin-icon" aria-hidden="true"><use href="#rm-map-luogo"></use></svg>
      <span class="map-loc-pin-badge" aria-hidden="true">${mapLocationIconEmoji(loc.icon)}</span>
    </div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2]
  });
}

/* Luoghi sull'editor e sulla vista di sessione (segnalazione dei tester,
   14/10/2026: segnaposto troppo grandi, nomi sovrapposti, nessun modo di
   trovare un luogo per nome). Condiviso dalle due mappe tramite
   createMapPlaces(); la mappa del gioco in solitaria usa ancora
   mapLocationMarkerIcon qui sopra.

   - Segnaposto: il disegno cresce con lo zoom fra MAP_PIN_MIN_PX e
     MAP_PIN_MAX_PX (variabile CSS --map-pin-size sul contenitore), ma
     l'area toccabile resta sempre MAP_PIN_HIT_PX, anche col disegno
     piccolo.
   - Etichette: nascoste vicino alla vista d'insieme (meno di
     MAP_LABEL_MIN_STEPS livelli di zoom oltre il minimo), tranne quella
     del luogo selezionato; più vicino, una per volta in ordine (prima la
     selezionata, poi alfabetico) e solo se non tocca una già mostrata.
   - "Luoghi (N)": elenco alfabetico in un pannello sotto la mappa; un
     nome porta la mappa sul luogo e lo evidenzia. */
const MAP_PIN_MIN_PX = 18;
const MAP_PIN_MAX_PX = 34;
const MAP_PIN_HIT_PX = 44;
const MAP_LABEL_MIN_STEPS = 1;

function mapPinSizeForZoom(lmap) {
  const steps = lmap.getZoom() - lmap.getMinZoom();
  return Math.round(Math.min(MAP_PIN_MAX_PX, Math.max(MAP_PIN_MIN_PX, MAP_PIN_MIN_PX + steps * 8)));
}

function mapPlaceIcon(loc, dimmed) {
  const cls = 'map-loc-pin' + (loc.locked_destination ? ' map-loc-pin-locked' : '')
    + (!loc.visible_to_players ? ' map-loc-pin-hidden' : '') + (dimmed ? ' map-loc-pin-dimmed' : '');
  return L.divIcon({
    className: 'map-loc-marker',
    html: `<div class="${cls}">
      <svg class="map-loc-pin-icon" aria-hidden="true"><use href="#rm-map-luogo"></use></svg>
      <span class="map-loc-pin-badge" aria-hidden="true">${mapLocationIconEmoji(loc.icon)}</span>
    </div>`,
    iconSize: [MAP_PIN_HIT_PX, MAP_PIN_HIT_PX], iconAnchor: [MAP_PIN_HIT_PX / 2, MAP_PIN_HIT_PX / 2]
  });
}

function mapRectsOverlap(a, b) {
  return a.left < b.right + 2 && b.left < a.right + 2 && a.top < b.bottom + 2 && b.top < a.bottom + 2;
}

/* opts: { prefix, buttonHost, panelHost, onEdit(loc) facoltativo } —
   il chiamante crea i marker (trascinabili o no, con i propri eventi) e
   li registra con register(loc, marker); qui solo aspetto, etichette,
   selezione ed elenco. */
function createMapPlaces(lmap, opts) {
  const entries = {};
  let open = false;
  const ctl = { selectedId: null };
  const sorted = () => Object.values(entries).map(e => e.loc).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it', { sensitivity: 'base' }));

  function applyPinSize() {
    const size = mapPinSizeForZoom(lmap);
    lmap.getContainer().style.setProperty('--map-pin-size', size + 'px');
    Object.values(entries).forEach(e => {
      const t = e.marker.getTooltip();
      if (!t) return;
      t.options.offset = L.point(0, size / 2 + 2);
      if (t._map) t.update();
    });
  }

  function refreshLabels() {
    const showAll = lmap.getZoom() - lmap.getMinZoom() >= MAP_LABEL_MIN_STEPS - 0.01;
    const labels = Object.values(entries)
      .map(e => ({ loc: e.loc, el: e.marker.getTooltip() && e.marker.getTooltip().getElement() }))
      .filter(x => x.el);
    labels.forEach(x => x.el.classList.remove('map-loc-label-off'));
    labels.sort((a, b) => (b.loc.id === ctl.selectedId) - (a.loc.id === ctl.selectedId)
      || (a.loc.name || '').localeCompare(b.loc.name || '', 'it', { sensitivity: 'base' }));
    const rects = labels.map(x => x.el.getBoundingClientRect());
    const shown = [];
    labels.forEach((x, i) => {
      const selected = x.loc.id === ctl.selectedId;
      const visible = selected || (showAll && !shown.some(r => mapRectsOverlap(r, rects[i])));
      if (visible) shown.push(rects[i]);
      else x.el.classList.add('map-loc-label-off');
    });
  }

  function markSelection() {
    Object.values(entries).forEach(e => {
      const sel = e.loc.id === ctl.selectedId;
      const el = e.marker.getElement();
      if (el) el.classList.toggle('map-loc-selected', sel);
      e.marker.setZIndexOffset(sel ? 1000 : 0);
    });
  }

  function renderPanel() {
    const panel = opts.panelHost;
    if (!panel) return;
    if (!open) { panel.classList.add('hidden'); panel.innerHTML = ''; return; }
    panel.classList.remove('hidden');
    panel.innerHTML = `<ul class="map-places-list" aria-label="Luoghi della mappa">${sorted().map(loc => {
      const sel = loc.id === ctl.selectedId;
      return `<li class="map-places-row${sel ? ' is-selected' : ''}">
        <button type="button" class="map-places-item" data-mapplace="${escapeHtml(loc.id)}"${sel ? ' aria-current="true"' : ''}><span aria-hidden="true">${mapLocationIconEmoji(loc.icon)}</span> ${escapeHtml(loc.name || 'Senza nome')}</button>
        ${opts.onEdit ? `<button type="button" class="btn btn-ghost btn-sm" data-mapplaceedit="${escapeHtml(loc.id)}" aria-label="Modifica ${escapeHtml(loc.name || 'luogo')}">Modifica</button>` : ''}
      </li>`;
    }).join('')}</ul>`;
  }

  function renderButton() {
    const host = opts.buttonHost;
    const n = Object.keys(entries).length;
    if (!n) open = false;
    if (host) {
      host.innerHTML = n
        ? `<button type="button" class="btn btn-ghost btn-sm map-places-btn" id="${opts.prefix}-places-btn" aria-expanded="${open}" aria-controls="${opts.prefix}-places-panel">Luoghi (${n})</button>`
        : '';
    }
    if (opts.panelHost) opts.panelHost.id = opts.prefix + '-places-panel';
    renderPanel();
  }

  ctl.refresh = () => { applyPinSize(); markSelection(); refreshLabels(); };
  ctl.register = (loc, marker) => {
    entries[loc.id] = { loc, marker };
    renderButton();
    ctl.refresh();
  };
  ctl.unregister = id => {
    delete entries[id];
    if (ctl.selectedId === id) ctl.selectedId = null;
    renderButton();
    ctl.refresh();
  };
  ctl.count = () => Object.keys(entries).length;
  ctl.select = (id, focus) => {
    ctl.selectedId = entries[id] ? id : null;
    if (focus && entries[id]) {
      const target = lmap.getMinZoom() + MAP_LABEL_MIN_STEPS + 1;
      const zoom = Math.min(lmap.getMaxZoom(), Math.max(lmap.getZoom(), target));
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      lmap.setView(entries[id].marker.getLatLng(), zoom, { animate: !reduce });
    }
    renderPanel();
    ctl.refresh();
  };

  lmap.on('zoomend resize', ctl.refresh);
  // Il contenitore può cambiare larghezza senza un resize della finestra
  // (l'elenco aperto sotto la mappa fa comparire la barra di scorrimento
  // della pagina): senza invalidateSize Leaflet centra con la misura
  // vecchia e "porta sul luogo" sbaglia di qualche pixel.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { if (lmap.getContainer().isConnected) lmap.invalidateSize({ pan: false }); });
    ro.observe(lmap.getContainer());
    lmap.on('unload', () => ro.disconnect());
  }
  if (opts.buttonHost) opts.buttonHost.addEventListener('click', e => {
    if (!e.target.closest('.map-places-btn')) return;
    open = !open;
    renderButton();
    const btn = opts.buttonHost.querySelector('.map-places-btn');
    if (btn) btn.focus();
  });
  if (opts.panelHost) opts.panelHost.addEventListener('click', e => {
    const edit = e.target.closest('[data-mapplaceedit]');
    if (edit && opts.onEdit && entries[edit.dataset.mapplaceedit]) {
      ctl.select(edit.dataset.mapplaceedit, false);
      opts.onEdit(entries[edit.dataset.mapplaceedit].loc);
      return;
    }
    const item = e.target.closest('[data-mapplace]');
    if (!item) return;
    const id = item.dataset.mapplace;
    ctl.select(id, true);
    // l'elenco si ridisegna: il fuoco da tastiera resta sulla stessa voce
    const again = opts.panelHost.querySelector(`[data-mapplace="${CSS.escape(id)}"]`);
    if (again) again.focus();
  });
  renderButton();
  return ctl;
}

// Drop zone di caricamento mappa (correzioni mirate punto 15): riflette
// nel testo quale file è stato scelto, click o trascinamento che sia —
// mai un secondo stato, solo la lettura di input#map-upload-file.files.
function mapUpdateDropzoneText(fileList) {
  const label = $('#map-upload-dropzone-text');
  if (!label) return;
  const file = fileList && fileList[0];
  label.textContent = file ? ('📄 ' + file.name) : "Trascina un'immagine qui, o tocca per scegliere un file";
}

/* ------------------------------------------------------------ dati */

async function isCampaignMapMaster(campaignId) {
  const memberships = await listMyCampaignMemberships();
  const m = memberships.find(x => x.campaignId === campaignId);
  return !!m && ['owner', 'narratore', 'co_narratore'].includes(m.role);
}

async function listCampaignMaps(campaignId) {
  const { data, error } = await withTimeout(
    sb.from('campaign_maps').select('id, title, description, storage_path, width_px, height_px, created_at')
      .eq('campaign_id', campaignId).order('created_at', { ascending: false }),
    'Libreria mappe'
  );
  if (error) throw error;
  return data || [];
}

async function getSessionMapState(campaignId) {
  const { data, error } = await withTimeout(
    sb.from('session_map_state').select('campaign_id, active_map_id, movement_mode').eq('campaign_id', campaignId).maybeSingle(),
    'Stato mappa'
  );
  if (error) throw error;
  return data || { campaign_id: campaignId, active_map_id: null, movement_mode: 'controlled' };
}

function readImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
    img.src = url;
  });
}

/* Percorso a TRE livelli <campaign_id>/<map_id>/original (mai due): la
   policy di lettura di storage.objects confronta il secondo segmento con
   session_map_state.active_map_id tramite storage.foldername(), che in
   Supabase reale scarta l'ultimo segmento (il nome del file) — con un
   percorso a due soli livelli quel secondo elemento sarebbe il file
   stesso, non una cartella, e sparirebbe da foldername(). Nome file fisso
   ("original", nessuna estensione): il contentType passato all'upload
   basta al browser per interpretarlo correttamente da un URL firmato,
   e permette upsert:true sia in creazione sia in sostituzione senza
   dover prima rimuovere il vecchio file con estensione diversa. */
async function uploadCampaignMap(campaignId, { title, description, file }) {
  if (!MAP_IMAGE_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato non supportato: usa JPG, PNG o WebP');
  }
  if (file.size > MAP_IMAGE_MAX_BYTES) {
    throw new Error(`Immagine troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 20 MB`);
  }
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const dims = await readImageDimensions(file);
  const mapId = crypto.randomUUID();
  const path = `${campaignId}/${mapId}/original`;
  const { error: upErr } = await withTimeout(
    sb.storage.from('campaign-maps').upload(path, file, { upsert: true, contentType: file.type }),
    'Caricamento mappa'
  );
  if (upErr) throw upErr;
  const { data, error } = await withTimeout(
    sb.from('campaign_maps').insert({
      id: mapId, campaign_id: campaignId,
      title: (title || '').trim() || file.name, description: (description || '').trim(),
      storage_path: path, width_px: dims.width, height_px: dims.height, created_by: session.user.id
    }).select().single(),
    'Salvataggio mappa'
  );
  if (error) {
    try { await withTimeout(sb.storage.from('campaign-maps').remove([path]), 'Rimozione immagine mappa'); } catch (e) { /* rilevabile da list_storage_orphans */ }
    throw error;
  }
  return data;
}

async function replaceCampaignMapImage(map, file) {
  if (!MAP_IMAGE_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato non supportato: usa JPG, PNG o WebP');
  }
  if (file.size > MAP_IMAGE_MAX_BYTES) {
    throw new Error(`Immagine troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 20 MB`);
  }
  const dims = await readImageDimensions(file);
  const { error: upErr } = await withTimeout(
    sb.storage.from('campaign-maps').upload(map.storage_path, file, { upsert: true, contentType: file.type }),
    'Sostituzione immagine'
  );
  if (upErr) throw upErr;
  const { data, error } = await withTimeout(
    sb.from('campaign_maps').update({ width_px: dims.width, height_px: dims.height }).eq('id', map.id).select().single(),
    'Aggiornamento dimensioni mappa'
  );
  if (error) throw error;
  return data;
}

async function updateCampaignMapMeta(mapId, { title, description }) {
  const { error } = await withTimeout(
    sb.from('campaign_maps').update({ title: (title || '').trim(), description: (description || '').trim() }).eq('id', mapId),
    'Aggiornamento mappa'
  );
  if (error) throw error;
}

/* Prima il record, poi il file (stessa regola di removeCampaignAsset): un
   errore non lascia mai una mappa che punta a un'immagine inesistente; un
   file rimasto è in coda di pulizia lato server. */
async function deleteCampaignMap(map) {
  const { error } = await withTimeout(sb.from('campaign_maps').delete().eq('id', map.id), 'Rimozione mappa');
  if (error) throw error;
  try { await withTimeout(sb.storage.from('campaign-maps').remove([map.storage_path]), 'Rimozione immagine mappa'); }
  catch (e) { /* in coda di pulizia lato server */ }
}

async function getCampaignMapImageUrl(storagePath) {
  const { data, error } = await withTimeout(
    sb.storage.from('campaign-maps').createSignedUrl(storagePath, 3600),
    'URL immagine mappa'
  );
  if (error) throw error;
  return data.signedUrl;
}

async function listMapLocations(mapId) {
  const { data, error } = await withTimeout(
    sb.from('map_locations').select('id, name, description, icon, x, y, visible_to_players, locked_destination').eq('map_id', mapId).order('created_at'),
    'Luoghi'
  );
  if (error) throw error;
  return data || [];
}

async function createMapLocation(mapId, { name, description, icon, x, y, visible_to_players }) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { data, error } = await withTimeout(
    sb.from('map_locations').insert({
      map_id: mapId, name: (name || '').trim() || 'Nuovo luogo', description: (description || '').trim(),
      icon: icon || 'luogo', x, y, visible_to_players: visible_to_players !== false, created_by: session.user.id
    }).select().single(),
    'Creazione luogo'
  );
  if (error) throw error;
  return data;
}

async function updateMapLocation(id, patch) {
  const { error } = await withTimeout(sb.from('map_locations').update(patch).eq('id', id), 'Aggiornamento luogo');
  if (error) throw error;
}

async function deleteMapLocation(id) {
  const { error } = await withTimeout(sb.from('map_locations').delete().eq('id', id), 'Eliminazione luogo');
  if (error) throw error;
}

async function narratoreSetActiveMapCloud(campaignId, mapId) {
  const { error } = await withTimeout(sb.rpc('narratore_set_active_map', { p_campaign_id: campaignId, p_map_id: mapId }), 'Mappa attiva');
  if (error) throw error;
}

async function narratoreSetMovementModeCloud(campaignId, mode) {
  const { error } = await withTimeout(sb.rpc('narratore_set_movement_mode', { p_campaign_id: campaignId, p_mode: mode }), 'Modalità di movimento');
  if (error) throw error;
}

async function narratoreSetLocationLockCloud(locationId, locked) {
  const { error } = await withTimeout(sb.rpc('narratore_set_location_lock', { p_location_id: locationId, p_locked: locked }), 'Blocco luogo');
  if (error) throw error;
}

/* ------------------------------------------------------------ M3: movimento */

async function listPendingMapMoveRequests(mapId) {
  const { data, error } = await withTimeout(
    sb.from('map_move_requests').select('id, character_id, requested_by, target_location_id, target_x, target_y, created_at')
      .eq('map_id', mapId).eq('status', 'pending').order('created_at'),
    'Richieste di spostamento'
  );
  if (error) throw error;
  return data || [];
}

async function narratoreApproveMoveCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('narratore_approve_move', { p_request_id: requestId }), 'Approvazione spostamento');
  if (error) throw error;
}
async function narratoreRejectMoveCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('narratore_reject_move', { p_request_id: requestId }), 'Rifiuto spostamento');
  if (error) throw error;
}
async function narratoreMoveCharacterCloud(characterId, locationId, x, y) {
  const { error } = await withTimeout(
    sb.rpc('narratore_move_character', { p_character_id: characterId, p_target_location_id: locationId || null, p_target_x: locationId ? null : x, p_target_y: locationId ? null : y }),
    'Spostamento personaggio'
  );
  if (error) throw error;
}
async function narratoreSetCharacterMovementLockCloud(characterId, locked) {
  const { error } = await withTimeout(sb.rpc('narratore_set_character_movement_lock', { p_character_id: characterId, p_locked: locked }), 'Blocco personaggio');
  if (error) throw error;
}

/* ------------------------------------------------------------ stato/rendering */

const MAP_EDITOR_STATE = {
  campaignId: null,
  maps: [],
  sessionState: null,
  editingMapId: null,   // mappa attualmente aperta nel canvas
  editingLocationId: null,
  leafletMap: null,
  leafletOverlay: null,
  leafletBounds: null,   // per refreshMapEditorCanvasSize(): il fitBounds fatto a init va rifatto dopo un invalidateSize
  leafletMarkers: {},    // locationId -> L.Marker
  places: null,          // createMapPlaces(): dimensione segnaposto, etichette, elenco "Luoghi (N)"
  movingPositions: false, // "Modifica posizioni": solo così i segnaposto si trascinano
  locations: []          // luoghi della mappa in editing (per il layer partecipanti, vedi renderMapParticipantsLayer/opts.locations)
};

function mapEditorLibraryHtml() {
  if (!MAP_EDITOR_STATE.maps.length) {
    return '<p class="helper-text" style="margin:0;">Nessuna mappa ancora: caricane una qui sotto.</p>';
  }
  const activeId = MAP_EDITOR_STATE.sessionState && MAP_EDITOR_STATE.sessionState.active_map_id;
  return MAP_EDITOR_STATE.maps.map(m => {
    const isActive = m.id === activeId;
    const isEditing = m.id === MAP_EDITOR_STATE.editingMapId;
    return `<div class="box${isEditing ? '' : ''}" style="margin-bottom:8px;${isEditing ? 'outline:2px solid var(--fisico);' : ''}">
      <div class="box-bar"></div>
      <div class="box-pad" style="display:flex;flex-direction:column;gap:6px;">
        <div class="row-between">
          <strong>${escapeHtml(m.title)}</strong>
          ${isActive ? '<span class="chip physical">Mappa attiva</span>' : ''}
        </div>
        ${m.description ? `<p class="helper-text" style="margin:0;">${escapeHtml(m.description)}</p>` : ''}
        <p class="helper-text" style="margin:0;opacity:.7;">${m.width_px}×${m.height_px}px</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost btn-sm" data-mapedit="${m.id}">✏️ Apri editor</button>
          ${isActive
            ? `<button type="button" class="btn btn-ghost btn-sm" data-mapdeactivate="${m.id}">⏸ Disattiva</button>`
            : `<button type="button" class="btn btn-primary btn-sm" data-mapactivate="${m.id}">▶️ Attiva</button>`}
          <button type="button" class="btn btn-ghost btn-sm" data-mapdelete="${m.id}">🗑️ Elimina</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Correzioni mirate (pacchetto v1, punto 15): selettore compatto — tre
// pillole in riga (stesso linguaggio .tabs/.tab-btn già in uso per i
// canali chat/tab della scheda storia) invece di tre righe intere con
// descrizione ripetuta ad ogni riga; la descrizione resta, ma solo per
// la modalità attualmente selezionata (helper-text sotto le pillole).
const MAP_MOVEMENT_MODES = [
  ['free', '🟢 Libero', 'il giocatore si sposta subito'],
  ['controlled', '🟡 Controllato', 'il Narratore approva ogni spostamento'],
  ['locked', '🔴 Bloccato', 'nessun movimento dei giocatori']
];
function mapEditorMovementModeHtml() {
  const mode = (MAP_EDITOR_STATE.sessionState && MAP_EDITOR_STATE.sessionState.movement_mode) || 'controlled';
  const current = MAP_MOVEMENT_MODES.find(([v]) => v === mode) || MAP_MOVEMENT_MODES[1];
  return `<div class="section-title" style="margin-top:14px;">Modalità di movimento della sessione</div>
    <nav class="tabs" id="map-movement-mode-tabs" style="border-bottom:none;padding:0;">
      ${MAP_MOVEMENT_MODES.map(([v, label]) => `<button type="button" class="tab-btn${mode === v ? ' active' : ''}" data-movemode="${v}">${label}</button>`).join('')}
    </nav>
    <p class="helper-text" id="map-movement-mode-desc" style="margin:4px 0 0;">${escapeHtml(current[2])}</p>`;
}

async function renderCampaignMapPanel(campaignId) {
  const tabBtn = $('#campsh-tab-mappa');
  const panel = $('[data-camppanel="mappa"]');
  if (!tabBtn || !panel) return;
  // Fail-closed (audit Play Store, punto 6): la scheda compare solo se il
  // flag è attivo E il database conferma le dipendenze della mappa 2D.
  const flagOn = typeof rmFeatureEnabled === 'function' && rmFeatureEnabled('story_map_2d_v1');
  if (!flagOn) { tabBtn.classList.add('hidden'); return; }
  const enabled = typeof rmFeatureBackendReady === 'function' ? await rmFeatureBackendReady('story_map_2d_v1') : false;
  tabBtn.classList.toggle('hidden', !enabled);
  if (!enabled) return;

  MAP_EDITOR_STATE.campaignId = campaignId;
  panel.innerHTML = '<p class="helper-text" style="margin:0;">Caricamento…</p>';
  try {
    const isMaster = await isCampaignMapMaster(campaignId);
    if (!isMaster) {
      // Un giocatore vede la vista di sessione reale (checkpoint M2),
      // mai l'editor del Narratore: personaggi partecipanti, presenza,
      // scelta del colore — MAI la libreria/i luoghi in modifica.
      if (typeof renderMapSessionView === 'function') { await renderMapSessionView(campaignId); return; }
      panel.innerHTML = '<p class="helper-text" style="margin:0;">La mappa della storia sarà visibile qui quando il Narratore la attiva durante una sessione.</p>';
      return;
    }
    const [maps, sessionState] = await Promise.all([listCampaignMaps(campaignId), getSessionMapState(campaignId)]);
    MAP_EDITOR_STATE.maps = maps;
    MAP_EDITOR_STATE.sessionState = sessionState;
    if (!MAP_EDITOR_STATE.editingMapId && sessionState.active_map_id) MAP_EDITOR_STATE.editingMapId = sessionState.active_map_id;

    panel.innerHTML = `
      <div class="section-title" style="margin-top:0;">Libreria mappe</div>
      <div id="map-editor-library"></div>
      <div class="box" style="margin-top:8px;"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:8px;">
        <div class="field"><label>Titolo</label><input type="text" id="map-upload-title" maxlength="80" placeholder="Es. Regione delle Cripte"></div>
        <div class="field"><label>Descrizione</label><textarea id="map-upload-description" rows="2" maxlength="500" placeholder="Facoltativa"></textarea></div>
        <div class="field">
          <label>Immagine (JPG, PNG o WebP, max 20 MB)</label>
          <div class="map-dropzone" id="map-upload-dropzone" tabindex="0" role="button" aria-label="Trascina un'immagine qui, o tocca per scegliere un file">
            <span id="map-upload-dropzone-text">Trascina un'immagine qui, o tocca per scegliere un file</span>
          </div>
          <input type="file" id="map-upload-file" accept="image/png,image/jpeg,image/webp" class="hidden">
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="map-upload-btn" style="align-self:flex-start;">⬆️ Carica mappa</button>
      </div></div>
      ${mapEditorMovementModeHtml()}
      <div class="section-title" style="margin-top:14px;">Editor luoghi</div>
      <div id="map-editor-canvas-wrap"></div>
    `;
    $('#map-editor-library').innerHTML = mapEditorLibraryHtml();
    await renderMapEditorCanvas();
  } catch (e) {
    panel.innerHTML = `<p class="helper-text" style="margin:0;">Errore: ${escapeHtml(describeError(e))}</p>`;
  }
}

/* Canvas Leaflet (CRS.Simple): coordinate normalizzate (0..1, x=colonna,
   y=riga, origine in alto a sinistra come lo schermo/l'immagine).
   Leaflet, anche in CRS.Simple, mantiene la convenzione geografica
   "lat crescente = verso l'alto sullo schermo" (nord in su) — l'OPPOSTO
   della convenzione immagine/schermo (y crescente = verso il basso).
   Bug reale trovato in verifica (checkpoint M3, trascinamento del
   proprio segnaposto): senza inversione, un punto vicino al bordo
   SUPERIORE dell'immagine otteneva lat alto → Leaflet lo disegnava in
   basso, e viceversa — l'intera mappa (luoghi e personaggi) sarebbe
   apparsa capovolta verticalmente rispetto a dove si tocca/trascina
   davvero. Qui lat = height_px - y*height_px (e l'inverso nel verso
   opposto) per far coincidere "y normalizzato" con "riga dell'immagine
   come la vede l'occhio", non con la convenzione geografica di Leaflet. */
function mapNormToLatLng(x, y, widthPx, heightPx) {
  return [heightPx - y * heightPx, x * widthPx];
}
function mapLatLngToNorm(lat, lng, widthPx, heightPx) {
  return { x: Math.min(1, Math.max(0, lng / widthPx)), y: Math.min(1, Math.max(0, 1 - lat / heightPx)) };
}

/* Segnalazione tester (screenshot): la finestra della mappa era sempre
   alta min(60vh,480px) qualunque fosse il formato dell'immagine, e lo
   zoom a scatti interi (zoomSnap 1 di default) faceva entrare l'immagine
   a metà della larghezza, con ampie bande grigie. Ora il riquadro prende
   le proporzioni dell'immagine e lo zoom si adatta a frazioni (stessa
   impostazione della mappa del gioco in solitaria, js/solo/solo-ui.js),
   con lo zoom minimo fermo sull'immagine intera. Usato anche dalla vista
   di sessione (js/story-map-session.js). */
function mapCanvasAspectStyle(map) {
  const w = Number(map.width_px) || 4, h = Number(map.height_px) || 3;
  return `aspect-ratio:${w} / ${h};height:auto;max-height:70vh;min-height:200px;`;
}
const MAP_LEAFLET_OPTIONS = { crs: L.CRS.Simple, minZoom: -5, maxZoom: 2, zoomSnap: 0.1, zoomDelta: 0.5, maxBoundsViscosity: 1, attributionControl: false };
/* Lo zoom minimo si calcola dalle misure (getBoundsZoom), non leggendo
   getZoom() dopo fitBounds: se la mappa era ingrandita, fitBounds parte
   animato e getZoom() restituisce ancora lo zoom vecchio, che diventava
   il minimo (mappa bloccata ingrandita dopo un cambio di tab).
   Contenitore ancora a dimensione zero (tab nascosto): nessun minimo,
   ci pensa refreshMapEditorCanvasSize/refreshMapSessionCanvasSize. */
function fitMapToImage(lmap, bounds) {
  lmap.invalidateSize();
  lmap.setMaxBounds(null);
  lmap.setMinZoom(-5);
  const size = lmap.getSize();
  if (!size.x || !size.y) { lmap.fitBounds(bounds, { padding: [0, 0], animate: false }); return; }
  const fit = lmap.getBoundsZoom(bounds, false);
  lmap.fitBounds(bounds, { padding: [0, 0], animate: false });
  lmap.setMinZoom(fit);
  lmap.setMaxBounds(L.latLngBounds(bounds).pad(0.05));
}

async function renderMapEditorCanvas() {
  const wrap = $('#map-editor-canvas-wrap');
  if (!wrap) return;
  if (MAP_EDITOR_STATE.leafletMap) { MAP_EDITOR_STATE.leafletMap.remove(); MAP_EDITOR_STATE.leafletMap = null; MAP_EDITOR_STATE.leafletMarkers = {}; MAP_EDITOR_STATE.places = null; }
  MAP_EDITOR_STATE.movingPositions = false;

  const map = MAP_EDITOR_STATE.maps.find(m => m.id === MAP_EDITOR_STATE.editingMapId);
  if (!map) {
    wrap.innerHTML = '<p class="helper-text" style="margin:0;">Apri una mappa dalla libreria qui sopra per inserire i luoghi.</p>';
    return;
  }
  wrap.innerHTML = `
    <div class="row-between" style="margin-bottom:6px;">
      <strong>${escapeHtml(map.title)}</strong>
      <button type="button" class="btn btn-ghost btn-sm" id="map-replace-image-btn">🖼️ Sostituisci immagine</button>
    </div>
    <input type="file" id="map-replace-image-file" accept="image/png,image/jpeg,image/webp" class="hidden">
    <div class="map-places-bar">
      <button type="button" class="btn btn-ghost btn-sm" id="map-move-positions-btn" aria-pressed="false">Modifica posizioni</button>
      <div id="map-editor-places-btn-host"></div>
    </div>
    <div id="map-editor-canvas-inner" style="position:relative;">
      <div id="map-leaflet-canvas" class="map-canvas" style="${mapCanvasAspectStyle(map)}"></div>
      <div class="map-canvas-loading" id="map-editor-canvas-loading">Caricamento mappa…</div>
    </div>
    <div class="map-places-panel hidden" id="map-editor-places-panel"></div>
    <p class="helper-text" style="margin:6px 0 0;">Tocca un punto libero della mappa per inserire un nuovo luogo. Trascina un segnaposto per spostarlo, toccalo per modificarlo.</p>
    <div id="map-location-editor" style="margin-top:8px;"></div>
    <div id="map-move-requests-panel" style="margin-top:14px;"></div>
  `;

  let imageUrl;
  try { imageUrl = await getCampaignMapImageUrl(map.storage_path); }
  catch (e) { wrap.innerHTML += `<p class="helper-text" style="margin:6px 0 0;">Errore nel caricare l'immagine: ${escapeHtml(describeError(e))}</p>`; return; }

  const bounds = [[0, 0], [map.height_px, map.width_px]];
  const lmap = L.map('map-leaflet-canvas', MAP_LEAFLET_OPTIONS);
  // Stato di caricamento reale (correzioni mirate punto 15): rimosso solo
  // al vero evento 'load'/'error' di L.ImageOverlay, mai un timer finto.
  const editorOverlay = L.imageOverlay(imageUrl, bounds).addTo(lmap);
  const hideEditorCanvasLoading = () => { const l = $('#map-editor-canvas-loading'); if (l) l.remove(); };
  editorOverlay.on('load', hideEditorCanvasLoading);
  editorOverlay.on('error', hideEditorCanvasLoading);
  fitMapToImage(lmap, bounds);
  MAP_EDITOR_STATE.leafletMap = lmap;
  MAP_EDITOR_STATE.leafletBounds = bounds;
  MAP_EDITOR_STATE.places = createMapPlaces(lmap, {
    prefix: 'map-editor',
    buttonHost: $('#map-editor-places-btn-host'),
    panelHost: $('#map-editor-places-panel'),
    onEdit: loc => { MAP_EDITOR_STATE.editingLocationId = loc.id; renderMapLocationEditor(map, loc, null); }
  });

  const locations = await listMapLocations(map.id);
  MAP_EDITOR_STATE.locations = locations;
  locations.forEach(loc => addOrUpdateLocationMarker(map, loc));

  // Riuso del layer partecipanti di M2 (mai una seconda logica di
  // raggruppamento/disegno): il Narratore vede dove sono già i
  // personaggi mentre modifica i luoghi, con i propri controlli
  // "Sposta"/"Blocca" nel pannello di dettaglio (correzioni mirate
  // punto 14, opts.isMaster — vedi showMapCharacterDetail).
  if (typeof listMapSessionParticipants === 'function' && typeof renderMapParticipantsLayer === 'function') {
    listMapSessionParticipants(MAP_EDITOR_STATE.campaignId)
      .then(participants => renderMapParticipantsLayer(map, lmap, participants, { isMaster: true, locations }))
      .catch(() => {});
  }

  lmap.on('click', async (ev) => {
    if (ev.originalEvent && ev.originalEvent._mapMarkerHandled) return;
    const norm = mapLatLngToNorm(ev.latlng.lat, ev.latlng.lng, map.width_px, map.height_px);
    MAP_EDITOR_STATE.editingLocationId = null;
    renderMapLocationEditor(map, null, norm);
  });

  await renderMapMoveRequestsPanel(map);
  if (typeof subscribeMapSessionRealtime === 'function') subscribeMapSessionRealtime(MAP_EDITOR_STATE.campaignId);
}

/* Bug reale segnalato dall'utente con screenshot: la mappa non si
   "adattava" allo schermo e toccarla per inserire un luogo non faceva
   nulla — editor apparentemente vuoto. Causa: renderCampaignMapPanel()
   viene chiamata da renderCampaignSheet() (js/cloud-account.js) ogni
   volta che la scheda storia si aggiorna, indipendentemente da quale tab
   sia attivo (.tab-panel resta display:none finché non è .active) — se
   in quel momento il tab "Mappa" non è quello visibile, L.map() viene
   creata dentro un contenitore a dimensione zero: Leaflet blocca lì le
   proprie dimensioni interne (incluso lo strato che intercetta i click),
   e passare a display:flex più tardi cambiando tab NON le ricalcola da
   solo (comportamento noto di Leaflet, serve invalidateSize()). Il
   risultato pratico: mappa mal proporzionata e clic che non arrivano mai
   a lmap.on('click', ...), quindi #map-location-editor restava sempre
   vuoto. activateCampaignSheetTab() (js/cloud-account.js) chiama questa
   funzione ogni volta che il tab "Mappa" diventa quello attivo — anche
   se il canvas era già stato creato mentre era nascosto, a quel punto
   il contenitore ha finalmente una dimensione reale da misurare. */
/* Segnalazione dal telefono: scorrendo la pagina col dito sopra la mappa
   i segnaposto si spostavano (erano sempre trascinabili, e ogni
   trascinamento veniva salvato). Ora sono fermi finché il Narratore non
   accende "Modifica posizioni"; toccarli apre comunque la scheda del
   luogo e un tocco su un punto libero aggiunge un luogo. Torna spento
   dopo uno spostamento salvato, al salvataggio del modulo del luogo e
   uscendo dalla mappa (nuovo disegno del canvas o ritorno al tab). */
function setMapMovingPositions(on) {
  MAP_EDITOR_STATE.movingPositions = !!on;
  Object.values(MAP_EDITOR_STATE.leafletMarkers).forEach(m => {
    if (!m.dragging) return;
    if (on) m.dragging.enable(); else m.dragging.disable();
  });
  const btn = $('#map-move-positions-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('btn-primary', !!on);
    btn.classList.toggle('btn-ghost', !on);
    btn.textContent = on ? 'Fine: blocca posizioni' : 'Modifica posizioni';
  }
  const canvas = $('#map-leaflet-canvas');
  if (canvas) canvas.classList.toggle('map-moving-positions', !!on);
}

function refreshMapEditorCanvasSize() {
  setMapMovingPositions(false);
  const lmap = MAP_EDITOR_STATE.leafletMap;
  if (!lmap) return;
  if (MAP_EDITOR_STATE.leafletBounds) fitMapToImage(lmap, MAP_EDITOR_STATE.leafletBounds);
  else lmap.invalidateSize();
  if (MAP_EDITOR_STATE.places) MAP_EDITOR_STATE.places.refresh();
}

/* Coda di richieste in attesa (checkpoint M3, "Il Narratore dispone di...
   approvazione e rifiuto"): un compagno di nome per compagno di
   personaggio è recuperato via characters (il Narratore ha già accesso
   diretto, is_campaign_master — nessuna RPC aggiuntiva necessaria qui). */
async function renderMapMoveRequestsPanel(map) {
  const wrap = $('#map-move-requests-panel');
  if (!wrap) return;
  let requests;
  try { requests = await listPendingMapMoveRequests(map.id); }
  catch (e) { wrap.innerHTML = `<p class="helper-text" style="margin:0;">Errore richieste: ${escapeHtml(describeError(e))}</p>`; return; }
  if (!requests.length) { wrap.innerHTML = ''; return; }
  const { data: chars } = await sb.from('characters').select('id, name').in('id', requests.map(r => r.character_id));
  const nameById = {}; (chars || []).forEach(c => { nameById[c.id] = c.name; });
  wrap.innerHTML = `
    <div class="section-title" style="margin-top:0;">Richieste di spostamento in attesa (${requests.length})</div>
    ${requests.map(r => `
      <div class="box" style="margin-bottom:6px;"><div class="box-bar"></div><div class="box-pad row-between">
        <span>${escapeHtml(nameById[r.character_id] || 'Personaggio')} → ${r.target_location_id ? 'un luogo' : `(${Number(r.target_x).toFixed(2)}, ${Number(r.target_y).toFixed(2)})`}</span>
        <span style="display:flex;gap:6px;">
          <button type="button" class="btn btn-primary btn-sm" data-moveapprove="${r.id}">✅ Approva</button>
          <button type="button" class="btn btn-ghost btn-sm" data-movereject="${r.id}">🚫 Rifiuta</button>
        </span>
      </div></div>`).join('')}
  `;
}

function addOrUpdateLocationMarker(map, loc) {
  const lmap = MAP_EDITOR_STATE.leafletMap;
  if (!lmap) return;
  const latlng = mapNormToLatLng(loc.x, loc.y, map.width_px, map.height_px);
  const existing = MAP_EDITOR_STATE.leafletMarkers[loc.id];
  const icon = mapPlaceIcon(loc, false);
  const places = MAP_EDITOR_STATE.places;
  if (existing) {
    existing.setLatLng(latlng); existing.setIcon(icon); existing.setTooltipContent(loc.name);
    if (places) places.register(loc, existing);
    return;
  }
  const marker = L.marker(latlng, { icon, draggable: MAP_EDITOR_STATE.movingPositions, title: loc.name }).addTo(lmap);
  marker.bindTooltip(loc.name, { permanent: true, direction: 'bottom', offset: [0, 4], className: 'map-loc-label' });
  marker.on('click', (ev) => {
    if (ev.originalEvent) ev.originalEvent._mapMarkerHandled = true;
    MAP_EDITOR_STATE.editingLocationId = loc.id;
    if (places) places.select(loc.id, false);
    renderMapLocationEditor(map, loc, null);
  });
  marker.on('dragend', async () => {
    const p = marker.getLatLng();
    const norm = mapLatLngToNorm(p.lat, p.lng, map.width_px, map.height_px);
    try { await updateMapLocation(loc.id, { x: norm.x, y: norm.y }); loc.x = norm.x; loc.y = norm.y; setMapMovingPositions(false); }
    catch (e) { toast(describeError(e)); marker.setLatLng(mapNormToLatLng(loc.x, loc.y, map.width_px, map.height_px)); }
  });
  MAP_EDITOR_STATE.leafletMarkers[loc.id] = marker;
  if (places) places.register(loc, marker);
}

function removeLocationMarker(locationId) {
  const marker = MAP_EDITOR_STATE.leafletMarkers[locationId];
  if (marker && MAP_EDITOR_STATE.leafletMap) { MAP_EDITOR_STATE.leafletMap.removeLayer(marker); }
  delete MAP_EDITOR_STATE.leafletMarkers[locationId];
  if (MAP_EDITOR_STATE.places) MAP_EDITOR_STATE.places.unregister(locationId);
}

/* Modulo di modifica/creazione di un singolo luogo, sotto il canvas
   (mai un modale a schermo intero: il Narratore deve continuare a vedere
   la mappa mentre regola nome/icona/visibilità). */
function renderMapLocationEditor(map, loc, newPointNorm) {
  const wrap = $('#map-location-editor');
  if (!wrap) return;
  const isNew = !loc;
  const iconOpts = MAP_LOCATION_ICONS.map(i => `<option value="${i.key}" ${(!isNew && loc.icon === i.key) ? 'selected' : ''}>${i.label}</option>`).join('');
  wrap.innerHTML = `
    <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:8px;">
      <strong>${isNew ? 'Nuovo luogo' : 'Modifica luogo'}</strong>
      <div class="field"><label>Nome</label><input type="text" id="maploc-name" maxlength="60" value="${isNew ? '' : escapeHtml(loc.name)}"></div>
      <div class="field"><label>Descrizione</label><textarea id="maploc-description" rows="2" maxlength="400">${isNew ? '' : escapeHtml(loc.description || '')}</textarea></div>
      <div class="field"><label>Icona</label><select id="maploc-icon">${iconOpts}</select></div>
      <label class="row-between"><span>Visibile ai giocatori</span><input type="checkbox" id="maploc-visible" ${(isNew ? true : loc.visible_to_players) ? 'checked' : ''}></label>
      ${!isNew ? `<label class="row-between"><span>Destinazione bloccata</span><input type="checkbox" id="maploc-locked" ${loc.locked_destination ? 'checked' : ''}></label>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn btn-primary btn-sm" id="maploc-save-btn">${isNew ? '➕ Crea luogo' : '💾 Salva'}</button>
        ${!isNew ? '<button type="button" class="btn btn-ghost btn-sm" id="maploc-delete-btn">🗑️ Elimina</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="maploc-cancel-btn">Annulla</button>
      </div>
    </div></div>
  `;
  // Sul telefono il modulo nasce sotto la mappa, spesso fuori schermo:
  // senza scorrere, il tocco sulla mappa sembrava non fare nulla.
  if (wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('#maploc-save-btn').onclick = async () => {
    const name = $('#maploc-name').value;
    const description = $('#maploc-description').value;
    const icon = $('#maploc-icon').value;
    const visible = $('#maploc-visible').checked;
    try {
      if (isNew) {
        const created = await createMapLocation(map.id, { name, description, icon, x: newPointNorm.x, y: newPointNorm.y, visible_to_players: visible });
        addOrUpdateLocationMarker(map, created);
      } else {
        const locked = $('#maploc-locked') ? $('#maploc-locked').checked : loc.locked_destination;
        await updateMapLocation(loc.id, { name, description, icon, visible_to_players: visible, locked_destination: locked });
        Object.assign(loc, { name, description, icon, visible_to_players: visible, locked_destination: locked });
        addOrUpdateLocationMarker(map, loc);
      }
      setMapMovingPositions(false);
      wrap.innerHTML = '';
    } catch (e) { toast(describeError(e)); }
  };
  if (!isNew) {
    $('#maploc-delete-btn').onclick = async () => {
      if (!confirm('Eliminare questo luogo?')) return;
      try { await deleteMapLocation(loc.id); removeLocationMarker(loc.id); wrap.innerHTML = ''; }
      catch (e) { toast(describeError(e)); }
    };
  }
  $('#maploc-cancel-btn').onclick = () => { wrap.innerHTML = ''; };
}

document.addEventListener('DOMContentLoaded', function () {
  const panel = $('[data-camppanel="mappa"]');
  if (!panel) return;

  panel.addEventListener('click', async function (ev) {
    const campaignId = MAP_EDITOR_STATE.campaignId;
    if (!campaignId) return;

    const editBtn = ev.target.closest('[data-mapedit]');
    if (editBtn) { MAP_EDITOR_STATE.editingMapId = editBtn.dataset.mapedit; await renderMapEditorCanvas(); return; }

    const activateBtn = ev.target.closest('[data-mapactivate]');
    if (activateBtn) {
      try { await narratoreSetActiveMapCloud(campaignId, activateBtn.dataset.mapactivate); await renderCampaignMapPanel(campaignId); }
      catch (e) { toast(describeError(e)); }
      return;
    }
    const deactivateBtn = ev.target.closest('[data-mapdeactivate]');
    if (deactivateBtn) {
      try { await narratoreSetActiveMapCloud(campaignId, null); await renderCampaignMapPanel(campaignId); }
      catch (e) { toast(describeError(e)); }
      return;
    }
    const deleteBtn = ev.target.closest('[data-mapdelete]');
    if (deleteBtn) {
      if (!confirm('Eliminare questa mappa e tutti i suoi luoghi?')) return;
      const map = MAP_EDITOR_STATE.maps.find(m => m.id === deleteBtn.dataset.mapdelete);
      if (!map) return;
      try {
        await deleteCampaignMap(map);
        if (MAP_EDITOR_STATE.editingMapId === map.id) MAP_EDITOR_STATE.editingMapId = null;
        await renderCampaignMapPanel(campaignId);
      } catch (e) { toast(describeError(e)); }
      return;
    }

    const replaceBtn = ev.target.closest('#map-replace-image-btn');
    if (replaceBtn) { const input = $('#map-replace-image-file'); if (input) input.click(); return; }
    if (ev.target.closest('#map-move-positions-btn')) { setMapMovingPositions(!MAP_EDITOR_STATE.movingPositions); return; }

    // Drop zone (correzioni mirate punto 15): un tocco/click apre comunque
    // il selettore file nativo (nascosto, non rimosso — resta l'unico
    // vero input funzionante, qui solo la sua presentazione cambia).
    const dropzone = ev.target.closest('#map-upload-dropzone');
    if (dropzone) { const input = $('#map-upload-file'); if (input) input.click(); return; }

    const approveBtn = ev.target.closest('[data-moveapprove]');
    if (approveBtn) {
      try { await narratoreApproveMoveCloud(approveBtn.dataset.moveapprove); }
      catch (e) { toast(describeError(e)); }
      const map = MAP_EDITOR_STATE.maps.find(m => m.id === MAP_EDITOR_STATE.editingMapId);
      if (map) await renderMapMoveRequestsPanel(map);
      return;
    }
    const rejectBtn = ev.target.closest('[data-movereject]');
    if (rejectBtn) {
      try { await narratoreRejectMoveCloud(rejectBtn.dataset.movereject); }
      catch (e) { toast(describeError(e)); }
      const map = MAP_EDITOR_STATE.maps.find(m => m.id === MAP_EDITOR_STATE.editingMapId);
      if (map) await renderMapMoveRequestsPanel(map);
      return;
    }

    // Selettore compatto della modalità di movimento (correzioni mirate
    // punto 15): pillole .tab-btn, non più radio — aggiorna stato attivo
    // e descrizione senza un intero ri-render del pannello (che
    // distruggerebbe/ricreerebbe il canvas Leaflet per nulla).
    const modeBtn = ev.target.closest('[data-movemode]');
    if (modeBtn) {
      const mode = modeBtn.dataset.movemode;
      try {
        await narratoreSetMovementModeCloud(campaignId, mode);
        if (MAP_EDITOR_STATE.sessionState) MAP_EDITOR_STATE.sessionState.movement_mode = mode;
        $$('#map-movement-mode-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.movemode === mode));
        const desc = $('#map-movement-mode-desc');
        const found = MAP_MOVEMENT_MODES.find(([v]) => v === mode);
        if (desc && found) desc.textContent = found[2];
      } catch (e) { toast(describeError(e)); await renderCampaignMapPanel(campaignId); }
      return;
    }
  });

  panel.addEventListener('change', async function (ev) {
    const campaignId = MAP_EDITOR_STATE.campaignId;
    if (!campaignId) return;

    if (ev.target.id === 'map-replace-image-file') {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const map = MAP_EDITOR_STATE.maps.find(m => m.id === MAP_EDITOR_STATE.editingMapId);
      if (!map) return;
      try { await replaceCampaignMapImage(map, file); await renderCampaignMapPanel(campaignId); }
      catch (e) { toast(describeError(e)); }
      return;
    }

    if (ev.target.id === 'map-upload-file') {
      mapUpdateDropzoneText(ev.target.files);
      return;
    }
  });

  // Drag & drop sulla zona (correzioni mirate punto 15): dragover/dragleave
  // evidenziano la zona, drop assegna i file allo stesso input nativo
  // nascosto usato dal click-per-sfogliare — un solo punto di verità per
  // "quale file è stato scelto", mai una seconda variabile di stato.
  panel.addEventListener('dragover', function (ev) {
    if (!ev.target.closest('#map-upload-dropzone')) return;
    ev.preventDefault();
    $('#map-upload-dropzone').classList.add('map-dropzone-active');
  });
  panel.addEventListener('dragleave', function (ev) {
    if (!ev.target.closest('#map-upload-dropzone')) return;
    $('#map-upload-dropzone').classList.remove('map-dropzone-active');
  });
  panel.addEventListener('drop', function (ev) {
    const dropzone = ev.target.closest('#map-upload-dropzone');
    if (!dropzone) return;
    ev.preventDefault();
    dropzone.classList.remove('map-dropzone-active');
    const files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || !files.length) return;
    const input = $('#map-upload-file');
    if (input) { input.files = files; mapUpdateDropzoneText(files); }
  });

  const uploadBtn = $('#map-upload-btn');
  panel.addEventListener('click', async function (ev) {
    if (!ev.target.closest('#map-upload-btn')) return;
    const campaignId = MAP_EDITOR_STATE.campaignId;
    if (!campaignId) return;
    const fileInput = $('#map-upload-file');
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) { toast('Scegli un file immagine'); return; }
    const title = $('#map-upload-title') ? $('#map-upload-title').value : '';
    const description = $('#map-upload-description') ? $('#map-upload-description').value : '';
    try {
      await uploadCampaignMap(campaignId, { title, description, file });
      await renderCampaignMapPanel(campaignId);
    } catch (e) { toast(describeError(e)); }
  });
});
