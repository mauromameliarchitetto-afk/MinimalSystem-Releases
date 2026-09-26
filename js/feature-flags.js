/* ==========================================================================
   Role Makers — Feature flags per i moduli in sviluppo (Tomo dei
   Personaggi, revisione chat, mappa narrativa 2D). Attivabili solo lato
   client (per l'ambiente di anteprima), via localStorage o parametro
   d'URL — nessun sistema di config server-side finché non emerge una
   necessità reale (non esiste già nulla di equivalente nel progetto,
   vedi checkpoint G0).

   Rilascio completo autorizzato: i tre moduli sono ON di default.
   Condizione vincolante per story_map_2d_v1/chat_revision_v1: la catena
   di migrazioni 20260930100000..160000 deve essere applicata al database
   live PRIMA che questa modifica raggiunga la produzione (senza quelle
   tabelle/RPC/bucket la scheda Mappa e le Conversazioni comparirebbero ma
   ogni azione fallirebbe) — vedi il report di verifica per l'analisi
   completa delle dipendenze e l'ordine esatto. Da qui in poi la condizione
   non è più affidata solo alla disciplina di rilascio: rmFeatureBackendReady()
   (sotto) tiene i due moduli nascosti finché il database non conferma a
   runtime la presenza delle loro dipendenze (fail-closed). */
(function (global) {
  var STORAGE_KEY = 'rm_feature_flags_v1';
  var DEFAULTS = {
    character_tome_v1: true,
    chat_revision_v1: true,
    story_map_2d_v1: true
  };

  function readStorageOverrides() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) { return {}; }
  }

  // Comodo per un link di anteprima condivisibile (?ff_character_tome_v1=1):
  // MAI persistito da solo, resta valido solo per il caricamento corrente
  // (chi vuole l'attivazione stabile su un dispositivo usa rmSetFeatureFlag).
  function readUrlOverrides() {
    var out = {};
    try {
      var params = new global.URLSearchParams(global.location.search);
      Object.keys(DEFAULTS).forEach(function (key) {
        if (!params.has('ff_' + key)) return;
        var raw = params.get('ff_' + key);
        out[key] = raw === '1' || raw === 'true';
      });
    } catch (e) {}
    return out;
  }

  var flags = {};
  Object.keys(DEFAULTS).forEach(function (key) { flags[key] = DEFAULTS[key]; });
  var stored = readStorageOverrides();
  Object.keys(stored).forEach(function (key) { if (key in DEFAULTS) flags[key] = !!stored[key]; });
  var fromUrl = readUrlOverrides();
  Object.keys(fromUrl).forEach(function (key) { flags[key] = fromUrl[key]; });

  global.RM_FEATURE_FLAGS = flags;
  global.rmFeatureEnabled = function (name) { return !!flags[name]; };

  /* ------------------------------------------------------------------
     Gate FAIL-CLOSED sulle dipendenze backend (audit Play Store, punto 6).
     Un flag attivo non basta: chat_revision_v1 e story_map_2d_v1 restano
     nascosti finché una verifica reale contro il database (una volta per
     sessione, sola lettura) non conferma che gli oggetti introdotti dalla
     catena 20260930100000..160000 esistono davvero. Se il database live
     non avesse quelle migrazioni, la UI non comparirebbe affatto invece
     di mostrare schede che falliscono a ogni azione.

     Solo gli errori che significano "oggetto inesistente" (PostgREST
     PGRST202/PGRST204/PGRST205, Postgres 42703/42P01/42883) segnano la
     dipendenza come mancante, in modo definitivo per la sessione. Un
     errore di rete o una sessione assente NON viene memorizzato: la
     funzione resta nascosta (fail-closed) e la verifica si ripete al
     prossimo accesso alla schermata. Qualunque altro errore applicativo
     (es. "non sei membro di questa storia" per la chiamata con uuid
     nullo) prova che l'oggetto esiste. */
  var MISSING_CODES = ['PGRST202', 'PGRST204', 'PGRST205', '42703', '42P01', '42883'];
  var NIL_UUID = '00000000-0000-0000-0000-000000000000';
  // Ogni probe è una lettura con limit(0) o una RPC stabile di sola
  // lettura: nessuna scrittura, nessun dato restituito oltre la forma.
  var BACKEND_PROBES = {
    chat_revision_v1: [
      // 20260930100000: tabelle contatti/chat privata
      function (sb) { return sb.from('rm_contacts').select('requester_id').limit(0); },
      function (sb) { return sb.from('rm_direct_messages').select('id').limit(0); },
      // 20260930160000: colonna last_message_body nel riepilogo
      function (sb) { return sb.rpc('list_my_direct_conversations_summary').select('last_message_body').limit(0); }
    ],
    story_map_2d_v1: [
      // 20260930130000: schema mappa
      function (sb) { return sb.from('campaign_maps').select('id').limit(0); },
      function (sb) { return sb.from('map_move_requests').select('id').limit(0); },
      // 20260930150000: colonna location_id + RPC riscritta
      function (sb) { return sb.from('session_character_positions').select('location_id').limit(0); },
      // 20260930140000/150000: RPC della vista di sessione (uuid nullo:
      // nessuna storia, risponde vuoto o con un errore di autorizzazione)
      function (sb) { return sb.rpc('list_map_session_participants', { p_campaign_id: NIL_UUID }).select('location_id').limit(0); }
    ]
  };
  var backendCache = {};   // name -> true | false (solo esiti definitivi)
  var backendInflight = {};

  function isMissingError(err) {
    return !!(err && MISSING_CODES.indexOf(String(err.code || '')) !== -1);
  }

  global.RM_FEATURE_BACKEND_PROBES = BACKEND_PROBES;
  global.rmFeatureIsMissingError = isMissingError;

  // Promise<boolean>. true solo se il flag è attivo E (nessuna dipendenza
  // backend dichiarata, oppure tutte confermate presenti).
  global.rmFeatureBackendReady = function (name) {
    if (!flags[name]) return Promise.resolve(false);
    var probes = BACKEND_PROBES[name];
    if (!probes) return Promise.resolve(true);
    if (name in backendCache) return Promise.resolve(backendCache[name]);
    if (backendInflight[name]) return backendInflight[name];
    // `sb` (js/supabase-client.js) è un const top-level di uno script
    // classico: binding globale lessicale, NON una proprietà di window.
    var client = (typeof sb !== 'undefined') ? sb : null;
    if (!client || typeof client.from !== 'function') return Promise.resolve(false);
    var run = Promise.all(probes.map(function (probe) {
      return Promise.resolve().then(function () { return probe(client); }).then(function (res) {
        var err = res && res.error;
        if (!err) return 'ok';
        if (isMissingError(err)) return 'missing';
        // Errore HTTP senza codice Postgres/PostgREST (rete, 5xx, fetch
        // fallita): esito indeterminato, mai memorizzato.
        if (!err.code || /^(FetchError|TypeError)$/.test(String(err.name || ''))) return 'unknown';
        return 'ok';
      }, function () { return 'unknown'; });
    })).then(function (results) {
      delete backendInflight[name];
      if (results.indexOf('missing') !== -1) {
        backendCache[name] = false;
        try { console.warn('[feature-flags] ' + name + ' disattivato: dipendenze backend assenti sul database'); } catch (e) {}
        return false;
      }
      if (results.indexOf('unknown') !== -1) return false;
      backendCache[name] = true;
      return true;
    });
    backendInflight[name] = run;
    return run;
  };
  // Solo per i test: azzera gli esiti memorizzati.
  global.rmFeatureBackendResetCache = function () { backendCache = {}; backendInflight = {}; };

  // Attivazione/disattivazione persistente per-dispositivo (console o UI di
  // anteprima): MAI lato server, stessa filosofia delle altre preferenze
  // locali dell'app (vedi ACTIVE_KEY ecc. in js/app.js).
  global.rmSetFeatureFlag = function (name, value) {
    if (!(name in DEFAULTS)) return;
    flags[name] = !!value;
    try {
      var toSave = {};
      Object.keys(DEFAULTS).forEach(function (key) { toSave[key] = flags[key]; });
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {}
  };
})(window);
