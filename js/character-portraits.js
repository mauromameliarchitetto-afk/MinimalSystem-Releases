/* Ritratto del personaggio in Supabase Storage (audit Play Store, punto 1 —
   "gestione sostitutiva degli upload"; migrazione
   20261001040000_character_portraits_storage.sql).

   Modello:
   - c.portrait resta l'immagine MOSTRATA (data-URL): per un personaggio
     solo locale è l'unica copia, come prima; per un personaggio nel cloud
     è la cache locale del dispositivo, mai inviata nel JSON cloud
     (characterCloudPayload la esclude).
   - Nel cloud esiste UN oggetto per personaggio, nel bucket privato
     character-portraits al percorso stabile <owner>/<character>/portrait:
     ogni sostituzione riscrive lo stesso oggetto (upsert), mai copie.
   - In PostgreSQL solo characters.portrait_path + portrait_updated_at,
     scritti esclusivamente dalle RPC set_character_portrait /
     clear_character_portrait dopo un upload verificato.
   - c.portraitPath / c.portraitUpdatedAt rispecchiano le colonne;
     c.portraitCacheKey = portrait_updated_at dell'immagine in cache;
     c.portraitDirty = modifica locale non ancora caricata (nuova immagine o
     rimozione).
   - Per chi guarda il personaggio di un altro (tabellone), URL firmati
     generati al bisogno e tenuti solo in memoria, per chiave
     id + portrait_updated_at (cache-busting). */

const PORTRAIT_BUCKET = 'character-portraits';
const PORTRAIT_MAX_PX = 512;
const PORTRAIT_QUALITY = 0.85;

/* Ridimensiona (lato lungo ≤ 512 px) e comprime (WebP, JPEG se il WebView
   non sa codificare WebP). Restituisce { dataUrl, blob, type }. */
function compressPortraitImage(img) {
  const scale = Math.min(1, PORTRAIT_MAX_PX / Math.max(img.width || 1, img.height || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  let dataUrl = canvas.toDataURL('image/webp', PORTRAIT_QUALITY);
  if (!/^data:image\/webp/.test(dataUrl)) dataUrl = canvas.toDataURL('image/jpeg', PORTRAIT_QUALITY);
  const blob = portraitDataUrlToBlob(dataUrl);
  return { dataUrl, blob, type: blob.type };
}

function portraitDataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Immagine non valida');
  const bytes = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: m[1] });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Lettura immagine non riuscita'));
    r.readAsDataURL(blob);
  });
}

/* Porta nel cloud la modifica locale del ritratto (nuova immagine o
   rimozione). Solo il proprietario: la copia temporanea con cui il
   Narratore corregge la scheda di un giocatore non tocca mai il ritratto.
   Ordine sicuro:
     nuova immagine → upload sullo STESSO percorso (upsert) → RPC che
       verifica l'oggetto e registra percorso/data. Se l'upload fallisce,
       oggetto e riferimento precedenti restano intatti.
     rimozione → RPC che toglie il riferimento → rimozione dell'oggetto
       (se fallisce resta in coda di pulizia lato server, mai referenziato).
   Anche un ritratto legacy (data-URL senza percorso) viene caricato qui:
   è la migrazione "dal basso" fatta dal proprietario stesso. */
async function syncCharacterPortraitToCloud(c) {
  if (!c || !c.cloudCharacterId || c.narratorEditGuest) return { skipped: 'not_cloud' };
  const session = await currentCloudSession();
  if (!session || isGuestUser(session)) return { skipped: 'no_session' };
  const uid = session.user.id;
  if (c.ownerAccountId && c.ownerAccountId !== uid) return { skipped: 'not_owner' };
  const needsUpload = !!c.portrait && (c.portraitDirty || !c.portraitPath);
  const needsClear = !c.portrait && c.portraitDirty;
  if (!needsUpload && !needsClear) return { skipped: 'nothing_to_do' };

  if (needsUpload) {
    const path = `${uid}/${c.cloudCharacterId}/portrait`;
    const blob = portraitDataUrlToBlob(c.portrait);
    const { error: upErr } = await withTimeout(
      sb.storage.from(PORTRAIT_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' }),
      'Caricamento ritratto'
    );
    if (upErr) throw upErr;
    const { data, error } = await withTimeout(sb.rpc('set_character_portrait', { p_character_id: c.cloudCharacterId }), 'Salvataggio ritratto');
    if (error) throw error;
    c.portraitPath = data.path;
    c.portraitUpdatedAt = data.updated_at;
    c.portraitCacheKey = data.updated_at;
    if (data.current_version) c.cloudVersion = data.current_version;
    c.portraitDirty = false;
    if (typeof saveAll === 'function') saveAll();
    return { uploaded: path };
  }

  const { data, error } = await withTimeout(sb.rpc('clear_character_portrait', { p_character_id: c.cloudCharacterId }), 'Rimozione ritratto');
  if (error) throw error;
  const previous = data && data.previous_path;
  if (previous && previous.indexOf(uid + '/') === 0) {
    try { await withTimeout(sb.storage.from(PORTRAIT_BUCKET).remove([previous]), 'Rimozione ritratto'); }
    catch (e) { /* resta nella coda di pulizia lato server */ }
  }
  c.portraitPath = null;
  c.portraitUpdatedAt = data && data.updated_at;
  c.portraitCacheKey = c.portraitUpdatedAt;
  if (data && data.current_version) c.cloudVersion = data.current_version;
  c.portraitDirty = false;
  if (typeof saveAll === 'function') saveAll();
  return { cleared: previous || null };
}

/* Allinea la cache locale al cloud dopo una lettura della riga
   {portrait_path, portrait_updated_at}. Scarica l'immagine solo se è
   cambiata (portrait_updated_at diverso dalla chiave in cache). Una
   modifica locale non ancora caricata ha sempre la precedenza. */
async function hydrateCharacterPortraitFromCloud(c, row) {
  if (!c || !row || c.portraitDirty) return false;
  const path = row.portrait_path || null;
  const updatedAt = row.portrait_updated_at || null;
  c.portraitPath = path;
  c.portraitUpdatedAt = updatedAt;
  if (!updatedAt || c.portraitCacheKey === updatedAt) return false;
  if (!path) {
    // Rimosso da un altro dispositivo.
    c.portrait = null;
    c.portraitCacheKey = updatedAt;
    return true;
  }
  const { data, error } = await withTimeout(sb.storage.from(PORTRAIT_BUCKET).download(path), 'Ritratto');
  if (error || !data) return false;
  c.portrait = await blobToDataUrl(data);
  c.portraitCacheKey = updatedAt;
  return true;
}

/* URL firmati per i ritratti di personaggi ALTRUI visibili al chiamante
   (tabellone): percorsi dalla RPC get_character_portraits (stesse regole
   della policy di lettura Storage), URL creati al bisogno, mai salvati. */
const portraitSignedUrlCache = new Map(); // `${id}:${updated_at}` -> { url, expiresAt }
async function signedPortraitUrls(characterIds) {
  const ids = Array.from(new Set((characterIds || []).filter(Boolean)));
  const out = {};
  if (!ids.length) return out;
  const { data, error } = await withTimeout(sb.rpc('get_character_portraits', { p_character_ids: ids }), 'Ritratti');
  if (error || !data || !data.length) return out;
  const now = Date.now();
  const missing = [];
  data.forEach(r => {
    const key = `${r.character_id}:${r.portrait_updated_at}`;
    const hit = portraitSignedUrlCache.get(key);
    if (hit && hit.expiresAt > now + 60000) out[r.character_id] = hit.url;
    else missing.push(r);
  });
  if (missing.length) {
    const { data: signed, error: sErr } = await withTimeout(
      sb.storage.from(PORTRAIT_BUCKET).createSignedUrls(missing.map(r => r.portrait_path), 3600),
      'Ritratti'
    );
    if (!sErr && signed) {
      signed.forEach((s, i) => {
        if (!s || !s.signedUrl) return;
        const r = missing[i];
        // Cache-busting: la data di aggiornamento entra nell'URL, così una
        // sostituzione non viene mai servita dalla cache del WebView.
        const url = s.signedUrl + (s.signedUrl.indexOf('?') === -1 ? '?' : '&') + 'v=' + encodeURIComponent(r.portrait_updated_at);
        portraitSignedUrlCache.set(`${r.character_id}:${r.portrait_updated_at}`, { url, expiresAt: now + 3600 * 1000 });
        out[r.character_id] = url;
      });
    }
  }
  return out;
}

/* Tabellone: i partecipanti senza ritratto nel JSON (tutti, dopo la
   migrazione) ricevono l'URL firmato. true se qualcosa è cambiato. */
async function hydrateParticipantPortraits(participants) {
  const need = (participants || []).filter(p => p && !p.portrait && p.characterId);
  if (!need.length) return false;
  let urls;
  try { urls = await signedPortraitUrls(need.map(p => p.characterId)); } catch (e) { return false; }
  let changed = false;
  need.forEach(p => { if (urls[p.characterId]) { p.portrait = urls[p.characterId]; changed = true; } });
  return changed;
}

/* Eliminazione di un personaggio cloud: rimuove anche il suo oggetto (il
   proprio prefisso). Se fallisce, il server l'ha comunque messo in coda di
   pulizia (trigger su characters) e lo rimuoverà quando non è più
   referenziato. */
async function removeCharacterPortraitObject(cloudCharacterId) {
  const session = await currentCloudSession();
  if (!session || !cloudCharacterId) return;
  try {
    await withTimeout(sb.storage.from(PORTRAIT_BUCKET).remove([`${session.user.id}/${cloudCharacterId}/portrait`]), 'Rimozione ritratto');
  } catch (e) { /* in coda lato server */ }
}
