/* Account cloud (Supabase): ospite/permanente, upgrade, campagne del
   Narratore. Punti 1/2/3: l'account serve solo quando serve davvero il
   cloud (salvataggio, creazione campagna, ingresso in storia) — il resto
   dell'app resta locale come sempre, questo file non tocca nient'altro. */

/* Nessuna chiamata di rete verso Supabase deve poter bloccare la UI
   all'infinito (connessione lenta, assente, o che cade a meta'): oltre la
   soglia si preferisce fallire con un errore visibile all'utente. */
const CLOUD_TIMEOUT_MS = 10000;
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: nessuna risposta dal server, riprova`)), CLOUD_TIMEOUT_MS))
  ]);
}

/* Traduzioni dei messaggi grezzi più comuni restituiti da Supabase Auth
   (sempre in inglese) e da Postgres/PostgREST (RLS, vincoli...): un utente
   finale non deve mai leggere "Invalid login credentials" o "new row
   violates row-level security policy" — messaggi tecnici pensati per chi
   sviluppa, non per chi gioca. Elenco deliberatamente corto (i casi che
   capitano davvero in questo prodotto, non un dizionario esaustivo di
   ogni possibile errore Supabase): pattern nuovi vanno aggiunti qui man
   mano che si presentano, non un punto dove "tradurre tutto a priori".
   Ogni voce: espressione regolare sul messaggio grezzo (case-insensitive)
   -> messaggio in italiano comprensibile. */
const FRIENDLY_ERROR_PATTERNS = [
  [/invalid login credentials/i, 'Email o password non corretti.'],
  [/email not confirmed/i, 'Devi prima confermare la tua email: controlla la posta (anche lo spam).'],
  [/user already registered|already registered/i, 'Esiste già un account con questa email: prova ad accedere invece di registrarti.'],
  [/password should be at least/i, 'La password è troppo corta: usane una più lunga.'],
  [/unable to validate email address|invalid.*email/i, "L'indirizzo email non è valido."],
  [/for security purposes.*only request this|rate limit/i, 'Hai fatto troppi tentativi in poco tempo: aspetta qualche minuto e riprova.'],
  [/token has expired or is invalid|expired|invalid.*token/i, 'Il codice o il link non è più valido: richiedine uno nuovo.'],
  [/new password should be different/i, 'La nuova password deve essere diversa da quella attuale.'],
  [/row-level security|permission denied|not authorized|violates.*policy/i, 'Non hai i permessi per questa operazione.'],
  [/duplicate key|already exists|violates unique/i, 'Esiste già un elemento con questi dati.'],
  [/violates foreign key|violates.*constraint/i, "Impossibile completare l'operazione: alcuni dati collegati non sono validi."],
  [/failed to fetch|networkerror|network request failed/i, 'Connessione assente o instabile: riprova quando torni online.']
];
function friendlyErrorText(raw) {
  const s = String(raw || '');
  for (const [re, friendly] of FRIENDLY_ERROR_PATTERNS) if (re.test(s)) return friendly;
  return null;
}

/* Non tutti gli errori restituiti da Supabase Auth hanno un campo .message
   leggibile. In particolare per gli errori 500 la libreria costruisce
   .message come JSON.stringify({message: ...}) del corpo della risposta:
   se il server risponde con un campo "msg" invece di "message" (es. i 500
   generici di GoTrue), il risultato è la stringa letterale "{}" — non
   assente, quindi il normale fallback "a || b" non basta, va scartata
   esplicitamente insieme alle altre forme non informative.
   Messaggio GREZZO (inglese, tecnico): usato solo dove il chiamante deve
   distinguere QUALE errore è successo (vedi i vari /pattern/i.test(...)
   più sotto in questo file) — mai mostrato direttamente all'utente. */
function rawErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const uninformative = v => !v || /^(\{\}|\[object Object\]|null|undefined)$/.test(String(v).trim());
  const candidates = [err.message, err.msg, err.error_description, err.error];
  for (const c of candidates) if (!uninformative(c)) return c;
  if (err.error_code || err.code) return `errore lato server (${err.error_code || err.code})`;
  if (err.name && err.status) return `${err.name} (${err.status})`;
  return '';
}
/* Un messaggio grezzo può venire mostrato all'utente COSÌ COM'È solo se la
   sua origine è nota e controllata da questo stesso progetto — mai per
   "sembra scritto in italiano" o "sembra leggibile" (un messaggio tecnico
   può benissimo esserlo). Due origini riconosciute, entrambe verificabili
   da codice/provenienza e non dal testo:
   1) le RPC Supabase di questo progetto sollevano i propri errori
      applicativi con `raise exception 'testo in italiano'` SENZA un
      ERRCODE esplicito (verificato: nessuna delle 70 occorrenze in
      supabase/migrations/ usa `USING ERRCODE`) — Postgres assegna in quel
      caso lo SQLSTATE di default P0001, che PostgREST/supabase-js
      propaga in err.code: un messaggio con questo codice è per
      costruzione un messaggio applicativo pensato per il giocatore, mai
      uno stack/una query/un dettaglio del provider.
   2) il timeout costruito da withTimeout() poco sopra in questo stesso
      file: non un errore tecnico intercettato, un messaggio scritto
      apposta per l'utente da questo codice, riconoscibile dal suffisso
      fisso che quella funzione usa sempre. */
function isSafeApplicationMessage(err, raw) {
  if (err && err.code === 'P0001') return true;
  if (/: nessuna risposta dal server, riprova$/.test(raw)) return true;
  return false;
}
/* Versione da mostrare all'utente: stesso messaggio, tradotto quando
   riconosciuto (vedi FRIENDLY_ERROR_PATTERNS sopra) — mai un codice errore
   nudo (es. "42501"), uno stack, una query o un qualunque altro dettaglio
   tecnico non riconosciuto: se l'origine non è una di quelle sicure sopra,
   il messaggio grezzo non raggiunge mai la UI, solo i log tecnici
   (vedi ogni chiamante in js/app.js, che logga err per intero prima di
   passare qui solo la versione sicura). */
function describeError(err) {
  const raw = rawErrorMessage(err);
  if (!raw) return 'errore sconosciuto';
  const friendly = friendlyErrorText(raw);
  if (friendly) return friendly;
  if (isSafeApplicationMessage(err, raw)) return raw;
  return 'Si è verificato un errore imprevisto: riprova tra poco.';
}
/* Secondo livello: contesto operativo + descrizione sicura, per i punti in
   cui perdere il "dove" (es. "Errore nel tiro K.O.") rende il messaggio
   comprensibile ma inutile per capire quale azione è fallita (persa nel
   passaggio a describeError(err) puro nel commit fcf168e). Mai testo
   duplicato tipo "Errore: errore imprevisto...": quando describeError()
   restituisce il fallback generico anonimo ('errore sconosciuto') il
   contesto da solo, con un invito a riprovare, è già sufficiente. */
function describeErrorWithContext(context, err) {
  const detail = describeError(err);
  if (detail === 'errore sconosciuto') {
    // Contesti come "Errore nel tiro K.O." terminano già con un punto
    // (l'abbreviazione): mai un doppio punto ("K.O.. Riprova.").
    return /[.!?]$/.test(context) ? `${context} Riprova.` : `${context}. Riprova.`;
  }
  return `${context}: ${detail}`;
}

/* Chiede esplicitamente al browser (Chrome/Google Password Manager e
   compatibili) di offrire il salvataggio della credenziale appena usata con
   successo: i soli <form>+autocomplete corretti (vedi accountStatusHtml)
   bastano quasi sempre da soli, ma la Credential Management API rende il
   prompt affidabile anche nei flussi via AJAX senza un vero invio di form.
   Sempre "best effort": se l'API non esiste (browser non supportato, o
   contesto non https) o l'utente rifiuta, non deve mai bloccare l'accesso. */
async function maybeStoreCredential(email, password) {
  if (!email || !password) return;
  if (typeof PasswordCredential === 'undefined' || !navigator.credentials || !navigator.credentials.store) return;
  try {
    await navigator.credentials.store(new PasswordCredential({ id: email, password, name: email }));
  } catch (e) { /* nessun problema: il salvataggio password resta solo un aiuto, non un requisito */ }
}

/* true quando la sessione attuale viene da un link "password dimenticata":
   in quel caso, prima di considerare l'accesso completo, va mostrato un
   modulo per impostare la nuova password (sb.auth.updateUser). Serve anche
   per chi si era registrato prima del passaggio a email+password (link
   magico, nessuna password mai impostata): per loro e' l'unico modo di
   ottenerne una, visto che Accedi e Registrati falliscono entrambi. */
let pendingPasswordRecovery = false;
function notifyPasswordRecovery() {
  pendingPasswordRecovery = true;
  pendingRecoveryEmail = null;
  if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
}

/* Email a cui abbiamo appena inviato un codice di recupero, in attesa che
   l'utente lo inserisca (vedi accountStatusHtml, ramo "codice di recupero"):
   null quando non c'e' alcun recupero in corso. */
let pendingRecoveryEmail = null;

let authCapabilitiesCache = null;
/* Legge /auth/v1/settings (pubblico, nessuna sessione richiesta) per sapere
   quali metodi di accesso sono davvero attivi sul progetto: mostrare un
   bottone "Accedi con Google" che poi fallisce sarebbe solo confusione. */
async function getAuthCapabilities() {
  if (authCapabilitiesCache) return authCapabilitiesCache;
  try {
    // Timeout di sicurezza: su rete lenta/instabile non deve bloccare la UI
    // all'infinito, meglio degradare ai valori prudenti del catch qui sotto.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY }, signal: ctrl.signal });
    clearTimeout(timer);
    const json = await res.json();
    authCapabilitiesCache = {
      anonymous: !!(json.external && json.external.anonymous_users),
      google: !!(json.external && json.external.google),
      apple: !!(json.external && json.external.apple),
      passkey: !!json.passkeys_enabled
    };
  } catch (e) {
    authCapabilitiesCache = { anonymous: false, google: false, apple: false, passkey: false };
  }
  return authCapabilitiesCache;
}

async function currentCloudSession() {
  const { data } = await withTimeout(sb.auth.getSession(), 'Sessione');
  return data.session;
}

function isGuestUser(session) {
  return !!(session && session.user && session.user.is_anonymous);
}

/* Avviso nell'elenco personaggi di quale account cloud è attivo ADESSO su
   questo dispositivo: creare o salvare un personaggio lo lega sempre e solo
   a quell'account (mai a uno "scelto" a parte). Su un dispositivo condiviso
   (es. Narratore e giocatore che provano l'app sullo stesso telefono) è
   facile restare loggati con l'account sbagliato senza accorgersene finché
   non arriva un errore di sincronizzazione incomprensibile: questo lo rende
   visibile subito, prima ancora di creare/salvare qualcosa. */
async function renderListAccountBadge() {
  const el = $('#list-account-badge');
  if (!el) return;
  let session = null;
  try {
    session = await currentCloudSession();
  } catch (e) { el.textContent = ''; return; }
  // Aggiorna la cache usata da visibleCharacters() per filtrare l'elenco: se
  // il valore è cambiato rispetto all'ultimo giro (login/logout, cambio
  // account), ri-renderizza subito l'elenco con il filtro corretto invece di
  // aspettare la prossima apertura della vista.
  const newId = session ? session.user.id : null;
  const changed = currentSessionUserId !== newId;
  currentSessionUserId = newId;
  if (!session) { el.textContent = 'Nessun account collegato: i personaggi restano solo su questo dispositivo.'; }
  else if (isGuestUser(session)) { el.textContent = 'Account ospite (solo questo dispositivo): i nuovi personaggi restano legati a questo ospite.'; }
  else { el.textContent = `Account collegato: ${session.user.email || session.user.id} — i personaggi che crei o salvi nel cloud restano legati a questo account.`; }
  // Blocco 3: quanti personaggi restano prima del limite del piano — solo
  // quando un limite esiste davvero (piano illimitato = nessuna riga in
  // più, nessun conto alla rovescia inutile da mostrare).
  const limit = typeof effectiveCharacterLimit === 'function' ? effectiveCharacterLimit() : FREE_CHARACTER_LIMIT;
  if (limit !== null && limit !== undefined) {
    const used = typeof visibleCharacters === 'function' ? visibleCharacters().length : characters.length;
    el.textContent += ` Personaggi: ${used}/${limit}.`;
  }
  if (changed) renderCharList();
}

/* Crea (o recupera) una sessione ospite, solo se gli accessi anonimi sono
   attivi sul progetto — altrimenti non forza nulla, l'utente resta senza
   account finche' non sceglie di accedere con email/Google/Apple. Va
   richiamata solo nei momenti che davvero richiedono il cloud, non
   all'avvio dell'app (altrimenti si perderebbe l'attrito zero di chi gioca
   solo in locale). */
async function ensureCloudAccount() {
  const existing = await currentCloudSession();
  if (existing) return existing;
  const caps = await getAuthCapabilities();
  if (!caps.anonymous) return null;
  const { data, error } = await withTimeout(sb.auth.signInAnonymously(), 'Accesso ospite');
  if (error) { console.warn('Accesso ospite non disponibile:', error.message); return null; }
  return data.session;
}

/* Accesso/registrazione con email + password: niente email da inviare per
   riaccedere. La registrazione invece manda sempre un'email di conferma
   (SMTP dedicato configurato in Supabase, non più il mailer di default dal
   limite bassissimo): senza confermarla l'account resta inattivo,
   data.session torna null finché il link non viene aperto (vedi il
   controllo su "session" nel gestore del submit più sotto). Su nativo il
   link di conferma deve tornare nell'app (schema minimalsystem://), sul
   web basta il comportamento di default (Site URL). */
async function signUpWithPassword(email, password) {
  const options = {};
  if (AUTH_REDIRECT_URL) options.emailRedirectTo = AUTH_REDIRECT_URL;
  const { data, error } = await withTimeout(sb.auth.signUp({ email, password, options }), 'Registrazione');
  if (error) throw error;
  return data.session;
}
async function signInWithPassword(email, password) {
  const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email, password }), 'Accesso');
  if (error) throw error;
  return data.session;
}
/* Password dimenticata: qui l'email è inevitabile (serve dimostrare il
   possesso della casella), ma capita di rado, non a ogni accesso.
   Il link NON usa lo schema personalizzato minimalsystem:// (a differenza
   del resto dell'app nativa): molti client di posta (Gmail compreso) fanno
   passare i link toccati attraverso un proprio redirect di controllo prima
   di aprirli, e quel passaggio intermedio spesso non riesce a rilanciare
   uno schema non-http, lasciando una pagina bianca. La password impostata
   e' comunque condivisa da Supabase Auth fra app e sito: il link apre il
   sito nel browser del telefono (redirect di default, gia' impostato sul
   Site URL corretto), li' si imposta la nuova password, poi si torna
   nell'app e si accede normalmente. */
async function sendPasswordReset(email) {
  const { error } = await withTimeout(sb.auth.resetPasswordForEmail(email, {}), 'Recupero password');
  if (error) throw error;
}
/* Percorso alternativo al link via email: la stessa email di recupero
   contiene anche un codice numerico ({{ .Token }} nel template), verificabile
   qui senza mai lasciare l'app o dipendere da una pagina web esterna. Un
   codice valido apre una sessione di recupero autentica quanto quella del
   link (stesso esito lato Supabase), quindi segnaliamo pendingPasswordRecovery
   noi stessi invece di aspettare l'evento PASSWORD_RECOVERY (che comunque
   arriva in parallelo dallo stesso onAuthStateChange, senza conflitti). */
async function verifyRecoveryCode(email, code) {
  const { error } = await withTimeout(sb.auth.verifyOtp({ email, token: code, type: 'recovery' }), 'Verifica codice');
  if (error) throw error;
  notifyPasswordRecovery();
}
/* Completa il recupero: va chiamata solo dopo aver aperto il link ricevuto
   via email (la sessione a quel punto e' gia' attiva, vedi
   notifyPasswordRecovery/PASSWORD_RECOVERY). */
async function setNewPassword(newPassword) {
  const { error } = await withTimeout(sb.auth.updateUser({ password: newPassword }), 'Nuova password');
  if (error) throw error;
  pendingPasswordRecovery = false;
}

/* Ospite -> permanente: collega email+password all'utente anonimo gia'
   loggato. A differenza della registrazione diretta, collegare un'email a
   un utente esistente richiede sempre una conferma via email (protegge da
   chi provasse a "rubare" l'email di qualcun altro): capita comunque una
   sola volta, non a ogni accesso. Come per sendPasswordReset, niente
   schema personalizzato qui: la conferma aggiorna l'utente lato server
   comunque, non serve tornare per forza nell'app nativa, e il link
   https di default arriva a destinazione anche quando il client di posta
   lo fa passare da un proprio redirect di controllo. */
async function upgradeGuestWithEmail(email, password) {
  const { error } = await withTimeout(sb.auth.updateUser({ email, password }, {}), 'Collegamento email');
  if (error) throw error;
}

async function signInWithProvider(provider) {
  const options = {};
  if (AUTH_REDIRECT_URL) options.redirectTo = AUTH_REDIRECT_URL;
  const { error } = await withTimeout(sb.auth.signInWithOAuth({ provider, options }), 'Accesso');
  if (error) throw error;
}

async function signOutCloud() {
  await withTimeout(sb.auth.signOut(), 'Uscita');
}

/* ------------------------------------------------------- campagne (Narratore) */

/* Ridimensiona un'immagine caricata (max 256px, JPEG) e la restituisce come
   data-URL: stessa tecnica di loadPortraitFile per i personaggi (js/app.js),
   qui per l'icona della campagna — il valore vive direttamente nella
   colonna campaigns.icon, nessuno storage bucket dedicato. */
function resizeImageToDataUrl(file, maxSize = 256, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Immagine non leggibile'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Immagine non valida'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function createCampaign(name, icon) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account per creare una campagna');
  const row = { name, owner_user_id: session.user.id };
  if (icon) row.icon = icon;
  const { data, error } = await withTimeout(
    sb.from('campaigns').insert(row).select().single(),
    'Creazione campagna'
  );
  if (error) throw error;
  return data;
}

async function setCampaignIcon(campaignId, icon) {
  const { error } = await withTimeout(
    sb.from('campaigns').update({ icon }).eq('id', campaignId),
    'Icona campagna'
  );
  if (error) throw error;
}

/* Le "mie campagne" (pannello Narratore) sono per definizione solo quelle
   possedute, non quelle a cui si partecipa come membro: la RLS di lettura
   ("campagne: lettura membri", owner_user_id = auth.uid() OR
   is_campaign_member(id)) resta più ampia di proposito — serve anche a un
   giocatore membro per leggere stato sessione/premessa/cestino della
   storia altrui (vedi syncCharacterFromCloud) — quindi qui si aggiunge un
   filtro esplicito lato client per restringere a "solo le mie", in difesa
   in profondità oltre alla RLS. */
async function listMyCampaigns() {
  const session = await currentCloudSession();
  if (!session) return [];
  const { data, error } = await withTimeout(
    sb.from('campaigns').select('id, name, icon, created_at, deleted_at, listed, session_active, session_label')
      .eq('owner_user_id', session.user.id).is('deleted_at', null).order('created_at', { ascending: false }),
    'Elenco campagne'
  );
  if (error) throw error;
  return data;
}

/* Elenco (nome+id) delle sole campagne che il Narratore ha scelto di
   rendere visibili nella ricerca del giocatore — sostituisce il vecchio
   "codice campagna" da copiare a mano: con quello, chiunque lo ottenesse
   poteva comunque mandare una richiesta a una storia mai condivisa apposta
   con lui. Chiamabile da chiunque abbia un account, anche ospite. */
async function listPublishedCampaigns() {
  const { data, error } = await withTimeout(sb.rpc('list_published_campaigns'), 'Storie pubblicate');
  if (error) throw error;
  return data || [];
}

async function setCampaignListed(campaignId, listed) {
  const { error } = await withTimeout(
    sb.from('campaigns').update({ listed }).eq('id', campaignId),
    'Visibilità campagna'
  );
  if (error) throw error;
}

/* -------------------------------------------------- premessa (Narratore) */

/* Un solo PDF per campagna, in Storage sul percorso <campaign_id>/premessa.pdf
   (sovrascritto a ogni caricamento) — al posto del vecchio sistema locale a
   password + token GitHub personale ("Area del Narratore"/"Premesse di
   gioco", rimasto invariato e indipendente). I metadati (titolo, nome file,
   dimensione, pubblicata) vivono invece nella riga della campagna, protetti
   dalla stessa policy "solo owner" gia' in uso per il resto della campagna. */
const PREMISE_MAX_BYTES = 30 * 1024 * 1024;
function premisePath(campaignId) { return `${campaignId}/premessa.pdf`; }

/* Impostazioni della campagna gestite dalla sua scheda espandibile:
   premessa (titolo/file/pubblicazione) e visibilità nella ricerca del
   giocatore ("listed") — un'unica lettura invece di due. */
async function getCampaignSettingsInfo(campaignId) {
  const { data, error } = await withTimeout(
    sb.from('campaigns').select('name, icon, premise_title, premise_filename, premise_size, premise_published, premise_updated_at, listed, session_active, session_label').eq('id', campaignId).single(),
    'Impostazioni campagna'
  );
  if (error) throw error;
  return data;
}

/* ------------------------------------------------ sessione di gioco (Narratore) */

/* Avvio/chiusura sessione: un gate di flusso di gioco, non di sicurezza sui
   dati (a differenza di livello/tratti) — mentre e' chiusa, il giocatore non
   puo' usare Riposo ne' registrare utilizzi di Tecniche/Abilita' (vedi
   isSessionLocked in app.js). Passa comunque dalla RPC (non da un update
   diretto) perche' "campagne: modifica solo owner" bloccherebbe un
   co-narratore, che invece deve poterla avviare/chiudere come il Narratore. */
async function narratoreSetSessionActiveCloud(campaignId, active, label) {
  const { error } = await withTimeout(
    sb.rpc('narratore_set_session_active', { p_campaign_id: campaignId, p_active: active, p_label: label || null }),
    'Sessione di gioco'
  );
  if (error) throw error;
}

/* ---------------------------------------------- registro sessioni ("Previously on") */

async function listSessionLogs(campaignId) {
  const { data, error } = await withTimeout(
    sb.from('campaign_session_logs').select('id, season, episode, title, body, created_at')
      .eq('campaign_id', campaignId).order('season', { ascending: false }).order('episode', { ascending: false }),
    'Registro sessioni'
  );
  if (error) throw error;
  return data || [];
}
async function addSessionLogCloud(campaignId, season, episode, title, body) {
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { error } = await withTimeout(
    sb.from('campaign_session_logs').insert({ campaign_id: campaignId, season, episode, title, body, created_by: session.user.id }),
    'Pubblicazione riassunto'
  );
  if (error) throw error;
}
async function updateSessionLogCloud(logId, fields) {
  const { error } = await withTimeout(sb.from('campaign_session_logs').update(fields).eq('id', logId), 'Modifica riassunto');
  if (error) throw error;
}
async function deleteSessionLogCloud(logId) {
  const { error } = await withTimeout(sb.from('campaign_session_logs').delete().eq('id', logId), 'Eliminazione riassunto');
  if (error) throw error;
}

async function uploadCampaignPremise(campaignId, file, title) {
  if (file.size > PREMISE_MAX_BYTES) throw new Error(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`);
  const { error: upErr } = await withTimeout(
    sb.storage.from('premises').upload(premisePath(campaignId), file, { upsert: true, contentType: 'application/pdf' }),
    'Caricamento PDF'
  );
  if (upErr) throw upErr;
  const { error } = await withTimeout(
    sb.from('campaigns').update({
      premise_title: (title || '').trim() || file.name.replace(/\.pdf$/i, ''),
      premise_filename: file.name,
      premise_size: file.size,
      premise_updated_at: new Date().toISOString()
    }).eq('id', campaignId),
    'Salvataggio premessa'
  );
  if (error) throw error;
}

async function setCampaignPremisePublished(campaignId, published) {
  const { error } = await withTimeout(
    sb.from('campaigns').update({ premise_published: published }).eq('id', campaignId),
    'Pubblicazione premessa'
  );
  if (error) throw error;
}

async function removeCampaignPremise(campaignId) {
  await withTimeout(sb.storage.from('premises').remove([premisePath(campaignId)]), 'Rimozione PDF');
  const { error } = await withTimeout(
    sb.from('campaigns').update({
      premise_title: null, premise_filename: null, premise_size: null,
      premise_published: false, premise_updated_at: null
    }).eq('id', campaignId),
    'Rimozione premessa'
  );
  if (error) throw error;
}

/* Usata sia dal Narratore (anteprima, anche in bozza) sia dal giocatore
   (lettura, solo se pubblicata): la RLS di Storage decide da sola cosa e'
   davvero leggibile per chi chiama, qui c'e' solo il download dei byte. */
async function downloadCampaignPremiseBytes(campaignId) {
  const { data, error } = await withTimeout(sb.storage.from('premises').download(premisePath(campaignId)), 'Lettura premessa');
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

/* Profili (solo nome visualizzato) per una lista di user_id: usata per
   mostrare "chi" ha fatto una richiesta o possiede un personaggio, senza
   esporre email/altri dati (profiles non li contiene comunque). */
async function fetchDisplayNames(userIds) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await withTimeout(
    sb.from('profiles').select('id, display_name').in('id', ids),
    'Nomi giocatori'
  );
  if (error) throw error;
  const byId = {};
  (data || []).forEach(p => { byId[p.id] = p.display_name; });
  return byId;
}

async function getMyProfile(userId) {
  const { data, error } = await withTimeout(
    sb.from('profiles').select('display_name, account_role').eq('id', userId).single(),
    'Profilo'
  );
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------- piano/diritti (Blocco 3) */

/* Diritti dell'account collegato in questo momento: null finché non
   risolta (nessun account collegato, o non ancora richiesta). Il
   contatore dei personaggi/storie attive lo calcola il server (RPC
   my_entitlements) sulla base dei dati REALI, mai una copia locale che
   potrebbe disallinearsi — la UI legge sempre da qui, mai un proprio
   conteggio duplicato lato client per un account collegato. */
window.myEntitlements = null;
async function refreshMyEntitlements() {
  try {
    const session = await currentCloudSession();
    if (!session || isGuestUser(session)) { window.myEntitlements = null; return null; }
    const { data, error } = await withTimeout(sb.rpc('my_entitlements'), 'Diritti account');
    if (error) throw error;
    window.myEntitlements = data;
    return data;
  } catch (e) {
    // Rete assente/lenta: nessun diritto aggiornato disponibile, ma non
    // deve bloccare nulla — i controlli lato client che lo consultano
    // trattano window.myEntitlements nullo come "usa il limite gratuito
    // di base", mai come "nessun limite".
    return null;
  }
}
/* Limite personaggi effettivo: quello del piano se noto (account
   collegato con diritti già risolti), altrimenti il limite gratuito di
   base — mai "nessun limite" per assenza di dati, altrimenti un ospite o
   una sessione appena aperta potrebbe crearne a piacere prima che la
   verifica col server sia arrivata. null = davvero senza limite (piano
   che lo consente). */
function effectiveCharacterLimit() {
  if (window.myEntitlements && window.myEntitlements.max_characters !== undefined) {
    return window.myEntitlements.max_characters;
  }
  return typeof FREE_CHARACTER_LIMIT !== 'undefined' ? FREE_CHARACTER_LIMIT : 3;
}
/* Messaggio unico "limite raggiunto", riusato per personaggi/storie/PNG:
   mai un finto flusso d'acquisto (nessun provider di pagamento è ancora
   collegato, vedi supabase/migrations/20260903000000_premium_plans_scaffolding.sql) —
   solo una spiegazione onesta di cosa è successo e perché. */
function showLimitReachedNotice(kind) {
  const messages = {
    personaggi: `Hai raggiunto il limite di personaggi del tuo piano attuale. Le funzioni per sbloccarne altri arriveranno presto — i personaggi già creati restano tutti pienamente utilizzabili.`,
    storie: `Hai raggiunto il limite di storie attive del tuo piano attuale. Le funzioni per sbloccarne altre arriveranno presto — le storie già create restano tutte pienamente utilizzabili.`,
    png: `Il generatore di PNG richiede un piano che lo includa. Le funzioni per sbloccarlo arriveranno presto.`
  };
  toast(messages[kind] || 'Limite del piano attuale raggiunto');
}

async function updateMyDisplayName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Il nickname non può essere vuoto');
  if (trimmed.length > 40) throw new Error('Il nickname è troppo lungo (max 40 caratteri)');
  const session = await currentCloudSession();
  if (!session) throw new Error('Serve un account');
  const { error } = await withTimeout(
    sb.from('profiles').update({ display_name: trimmed }).eq('id', session.user.id),
    'Salvataggio nickname'
  );
  if (error) throw error;
}

async function listPendingJoinRequests(campaignId) {
  const { data: requests, error } = await withTimeout(
    sb.from('campaign_join_requests').select('id, character_id, requested_by, created_at')
      .eq('campaign_id', campaignId).eq('status', 'pending').order('created_at'),
    'Richieste in attesa'
  );
  if (error) throw error;
  if (!requests.length) return [];
  const charIds = requests.map(r => r.character_id);
  const { data: chars, error: charErr } = await withTimeout(
    sb.from('characters').select('id, name').in('id', charIds),
    'Personaggi richiedenti'
  );
  if (charErr) throw charErr;
  const names = await fetchDisplayNames(requests.map(r => r.requested_by));
  const charById = {}; (chars || []).forEach(ch => { charById[ch.id] = ch.name; });
  return requests.map(r => ({
    ...r,
    characterName: charById[r.character_id] || '(personaggio)',
    playerName: names[r.requested_by] || 'Avventuriero'
  }));
}

/* Ripiego per il pop-up realtime "richiesta di combattimento": se il
   Narratore lo manca (app in background, tab non attiva, disconnessione
   momentanea del canale) la richiesta non deve sparire nel nulla — resta
   qui, nel dettaglio della campagna, finché non viene accettata o
   rifiutata. Stesso schema di listPendingJoinRequests. */
async function listPendingCombatStartRequests(campaignId) {
  const { data: requests, error } = await withTimeout(
    sb.from('combat_start_requests').select('id, character_id, requested_by, note, created_at')
      .eq('campaign_id', campaignId).eq('status', 'pending').order('created_at'),
    'Richieste di combattimento in attesa'
  );
  if (error) throw error;
  if (!requests.length) return [];
  const charIds = requests.map(r => r.character_id);
  const { data: chars, error: charErr } = await withTimeout(
    sb.from('characters').select('id, name').in('id', charIds),
    'Personaggi richiedenti'
  );
  if (charErr) throw charErr;
  const charById = {}; (chars || []).forEach(ch => { charById[ch.id] = ch.name; });
  return requests.map(r => ({ ...r, characterName: charById[r.character_id] || '(personaggio)' }));
}

/* isMasterOwned distingue "PNG del Narratore" (personaggio il cui
   proprietario è narratore/co-narratore/owner della campagna) da "PG di un
   giocatore" — stessa regola già codificata lato SQL in
   character_owner_is_master (supabase/migrations/20260803120000_combat_tables.sql),
   qui solo riportata lato client con una query in più invece di N round-trip
   RPC. RLS "membri: lettura altri membri stessa campagna" lascia leggere i
   ruoli di chiunque sia nella stessa campagna, nessun nuovo permesso. */
async function listCampaignCharacters(campaignId) {
  const [{ data: chars, error }, { data: members, error: membersErr }] = await Promise.all([
    withTimeout(
      sb.from('characters').select('id, name, level, sheet_status, updated_at, owner_user_id, data, is_npc, current_version')
        .eq('campaign_id', campaignId).order('name'),
      'Personaggi in gioco'
    ),
    withTimeout(
      sb.from('campaign_members').select('user_id, role').eq('campaign_id', campaignId),
      'Ruoli campagna'
    )
  ]);
  if (error) throw error;
  const names = await fetchDisplayNames((chars || []).map(c => c.owner_user_id));
  const roleByUser = {}; (membersErr ? [] : (members || [])).forEach(m => { roleByUser[m.user_id] = m.role; });
  const masterRoles = ['owner', 'narratore', 'co_narratore'];
  return (chars || []).map(c => ({
    ...c,
    playerName: names[c.owner_user_id] || 'Avventuriero',
    isMasterOwned: masterRoles.includes(roleByUser[c.owner_user_id])
  }));
}

/* Salva un PNG generato dal Randomizer (js/npc-randomizer.js) direttamente
   nella campagna del Narratore, senza passare da request_join_campaign +
   approve_join_request (la RPC imposta già campaign_id, riservata a chi è
   master di quella campagna — vedi narratore_create_npc). */
async function createNpcCharacter(campaignId, name, level, data) {
  const { data: row, error } = await withTimeout(
    sb.rpc('narratore_create_npc', { p_campaign_id: campaignId, p_name: name, p_level: level, p_data: data }),
    'Creazione PNG'
  );
  if (error) throw error;
  return row;
}

async function approveJoinRequestCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('approve_join_request', { p_request_id: requestId }), 'Approvazione richiesta');
  if (error) throw error;
}
async function rejectJoinRequestCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('reject_join_request', { p_request_id: requestId }), 'Rifiuto richiesta');
  if (error) throw error;
}

/* ------------------------------------------ ruolo Narratore (persistente, DB) */

/* Il ruolo Narratore è un acquisto self-service (purchase_narrator_role,
   vedi 20260905000000_purchase_narrator_role.sql): concesso subito, senza
   attesa di un admin. La funzione lato database controlla da sola il
   prezzo del piano 'narrator' (oggi 0) prima di concedere qualunque cosa —
   se in futuro diventa a pagamento smette da sola di funzionare finché non
   sarà collegato un vero flusso di pagamento, quindi qui non serve nessuna
   logica di prezzo lato client. */
async function purchaseNarratorRole() {
  const { data, error } = await withTimeout(sb.rpc('purchase_narrator_role'), 'Attivazione ruolo Narratore');
  if (error) throw error;
  return data;
}

/* Solo per admin: le richieste in attesa di tutti gli account, con nickname
   già risolto (RPC security definer: un admin non condivide necessariamente
   una campagna col richiedente, quindi non potrebbe leggerne il profilo
   con la RLS diretta di profiles). */
async function listPendingNarratorRoleRequests() {
  const { data, error } = await withTimeout(sb.rpc('list_pending_narrator_role_requests'), 'Richieste ruolo Narratore');
  if (error) throw error;
  return data || [];
}
async function approveNarratorRoleRequestCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('approve_narrator_role_request', { p_request_id: requestId }), 'Approvazione ruolo Narratore');
  if (error) throw error;
}
async function rejectNarratorRoleRequestCloud(requestId) {
  const { error } = await withTimeout(sb.rpc('reject_narrator_role_request', { p_request_id: requestId }), 'Rifiuto ruolo Narratore');
  if (error) throw error;
}

/* Tratti proposti dai giocatori per il database condiviso della campagna,
   ancora in attesa di approvazione (vedi campaign_known_traits, migrazione
   dedicata): il Narratore li vede qui e decide se diventano pescabili da
   tutti o no (refusi/doppioni si rifiutano senza inquinare l'elenco). */
async function listPendingKnownTraits(campaignId) {
  const { data: rows, error } = await withTimeout(
    sb.from('campaign_known_traits').select('id, list_key, name, created_by, created_at')
      .eq('campaign_id', campaignId).eq('status', 'pending').order('created_at'),
    'Tratti proposti in attesa'
  );
  if (error) throw error;
  if (!rows.length) return [];
  const names = await fetchDisplayNames(rows.map(r => r.created_by));
  return rows.map(r => ({ ...r, playerName: names[r.created_by] || 'Avventuriero' }));
}
async function approveKnownTraitCloud(traitId) {
  const { error } = await withTimeout(sb.rpc('approve_known_trait', { p_trait_id: traitId }), 'Approvazione tratto');
  if (error) throw error;
}
async function rejectKnownTraitCloud(traitId) {
  const { error } = await withTimeout(sb.rpc('reject_known_trait', { p_trait_id: traitId }), 'Rifiuto tratto');
  if (error) throw error;
}
/* Scheda completa di un personaggio della propria campagna, aperta da
   Account → dettaglio campagna: riusa il visualizzatore in sola lettura già
   esistente (renderCharView) più un pannello di azioni riservate al
   Narratore (livello, concessioni tratti) — le uniche modifiche che può
   applicare da qui, coerentemente con le RPC dedicate e sicure già in uso
   altrove: non è un editor libero dell'intera scheda, che resta del
   giocatore. */
function narratoreCharviewActionsHtml(ch) {
  const bonus = (ch.data && ch.data.traitNarratoreBonus) || {};
  const traitRows = Object.keys(TRAIT_LISTS).map(listKey => {
    const b = Number(bonus[listKey]) || 0;
    return `<div class="row-between" style="padding:3px 0;flex-wrap:wrap;gap:6px;">
      <span class="helper-text" style="margin:0;">${TRAIT_LIST_LABELS[listKey]}${b ? ` <strong>+${b}</strong>` : ''}</span>
      <span style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
        <input type="number" min="1" value="1" data-cvtraitgrantinput="${listKey}" style="width:44px;">
        <button type="button" class="btn btn-sm btn-ghost" data-cvtraitgrant="${listKey}">Concedi</button>
        <button type="button" class="btn btn-sm btn-ghost" data-cvtraitcustom="${listKey}">+ Tratto</button>
      </span>
    </div>`;
  }).join('');
  return `
    <div class="section-title"><span class="dot neutral"></span>Azioni del Narratore</div>
    <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:12px;">
      <div class="row-between" style="flex-wrap:wrap;gap:6px;">
        <span class="helper-text" style="margin:0;">Livello attuale: <strong>${ch.level}</strong></span>
        <span style="display:flex;gap:6px;align-items:center;">
          <input type="number" min="1" max="20" value="${ch.level}" data-cvlevelinput style="width:52px;">
          <button type="button" class="btn btn-sm btn-primary" data-cvsetlevel="${ch.id}">Assegna</button>
        </span>
      </div>
      <div class="helper-text" style="margin:0;">Concessioni sui tratti</div>
      ${traitRows}
      ${narratoreLootFormHtml(ch)}
    </div></div>
  `;
}
/* Bonus meccanici composti dal Narratore per il pezzo di loot in
   preparazione (arma/scudo/armatura): stato del solo form, si azzera a ogni
   ri-render del pannello (vedi narratoreLootFormHtml) o cambio Tipo, dato
   che i bersagli ammessi dipendono dal tipo di pezzo scelto. Stessa forma
   dei bonus reali di equip (kind 'primary'/'trait'/'rigenerazione'): una
   volta inviato il pezzo, il giocatore lo riceve già pronto, senza doverlo
   configurare lui stesso dalla propria card equip. */
let lootFormBonuses = [];
function lootBonusRowHtml(b, idx, itemType) {
  const kind = b.kind || 'primary';
  const primaryKeys = primaryBonusKeysFor(itemType);
  const primaryOpts = PRIMARY_STATS.filter(s => primaryKeys.includes(s.key))
    .map(s => `<option value="${s.key}" ${kind === 'primary' && b.key === s.key ? 'selected' : ''}>${s.label}</option>`).join('');
  const listOpts = Object.keys(TRAIT_LISTS).filter(lk => lk !== 'conoscenze')
    .map(lk => `<option value="${lk}" ${kind === 'trait' && b.listKey === lk ? 'selected' : ''}>${TRAIT_LIST_LABELS[lk]}</option>`).join('');
  const regenOpts = EQUIP_REGEN_TARGETS.map(t => `<option value="${t.key}" ${kind === 'rigenerazione' && b.key === t.key ? 'selected' : ''}>${t.label}</option>`).join('');
  const fixedTraitOptions = traitOptionsFor(itemType);
  // scudo/arma: categoria tratto sempre "Capacità Combattive" (nessun
  // selettore libero); l'armatura sceglie la categoria, il nome resta testo
  // libero (qui non serve la suggestione dai tratti di un personaggio: il
  // Narratore lo compone a mente, non da una scheda già aperta)
  return `<div class="equip-bonus-row" data-lootbonusidx="${idx}">
    <select data-lootbonuskind="${idx}">
      <option value="primary" ${kind === 'primary' ? 'selected' : ''}>Statistica primaria</option>
      <option value="trait" ${kind === 'trait' ? 'selected' : ''}>Tratto</option>
      <option value="rigenerazione" ${kind === 'rigenerazione' ? 'selected' : ''}>Rigenerazione (HP/MP/PP)</option>
    </select>
    <select data-lootbonuskey="${idx}" class="${kind === 'primary' ? '' : 'hidden'}">${primaryOpts}</select>
    <span class="${kind === 'trait' ? '' : 'hidden'}" style="display:inline-flex;gap:4px;">
      ${fixedTraitOptions ? '' : `<select data-lootbonuslistkey="${idx}">${listOpts}</select>`}
      <input type="text" data-lootbonusname="${idx}" value="${escapeHtml(b.name || '')}" placeholder="Nome tratto" maxlength="40">
    </span>
    <span class="${kind === 'rigenerazione' ? '' : 'hidden'}" style="display:inline-flex;align-items:center;gap:4px;">
      <select data-lootbonusregentarget="${idx}">${regenOpts}</select>
      <span style="white-space:nowrap;">ogni</span>
      <input type="number" data-lootbonusregeninterval="${idx}" value="${Number(b.intervalMin) || 10}" min="1" max="1440" style="width:56px;">
      <span style="white-space:nowrap;">min</span>
    </span>
    <input type="number" data-lootbonusvalore="${idx}" value="${Number(b.valore) || 1}" min="1" max="50" style="width:56px;">
    <button type="button" class="btn btn-icon btn-sm btn-ghost" data-lootbonusdel="${idx}" title="Rimuovi bonus">✕</button>
  </div>`;
}
function renderLootBonusRows(itemType) {
  const wrap = $('#loot-bonus-rows');
  if (!wrap) return;
  wrap.innerHTML = lootFormBonuses.map((b, idx) => lootBonusRowHtml(b, idx, itemType)).join('');
}
/* Form "Invia loot": il tipo scelto (di default Arma) mostra solo i campi
   pertinenti, gli altri restano nascosti (vedi wireLootTypeToggle) finché
   il Narratore non cambia tipo — si azzera a ogni ri-render del pannello,
   coerente col fatto che qui non c'è uno stato da conservare tra un'azione
   e l'altra. I bonus meccanici sono opzionali: il Narratore può allegarli
   già qui (il giocatore li riceve pronti) oppure lasciare il pezzo "nudo" e
   farli aggiungere al giocatore dalla propria card equip dopo la ricezione. */
/* Campi comuni del form di un oggetto arma/scudo/armatura/consumabile/
   chiave (tipo, nome, taglia/qualità/atk/dif/dur/peso, bonus meccanici) —
   condivisi fra "Invia loot" (destinatario fisso, un personaggio preciso) e
   la "Borsa del Narratore" (nessun destinatario, l'oggetto resta in borsa
   finché non viene assegnato): stesso markup, cambia solo il bottone finale
   e quale RPC chiama (vedi narratoreLootFormHtml/npcBagAddFormHtml). */
function lootItemFieldsHtml() {
  const g = types => types.includes('arma') ? '' : 'hidden';
  const sizesOf = kind => ((EQUIP_TYPES.find(t => t.key === kind) || {}).sizes || [])
    .map(s => `<option value="${s.key}">${s.label}</option>`).join('');
  const qualityOpts = EQUIP_QUALITIES.map(q => `<option value="${q.key}">${q.label}</option>`).join('');
  const weaponClassOpts = WEAPON_CLASSES.map(w => `<option value="${w.key}">${w.label}</option>`).join('');
  const effectOpts = CONSUMABLE_EFFECTS.map(e => `<option value="${e.key}">${e.label}</option>`).join('');
  const statOpts = [...PRIMARY_STATS, ...TERTIARY_STATS].map(s => `<option value="${s.key}">${s.label}</option>`).join('');
  const armorLocations = ['Capo', 'Busto', 'Braccio Sx', 'Braccio Dx', 'Gamba Sx', 'Gamba Dx'];
  const armorLocOpts = armorLocations.map((n, i) => `<option value="${i}">${n}</option>`).join('');
  const numField = (label, field, extra) => `<div class="field"><label>${label}</label><input type="number" data-lootfield="${field}" value="0" ${extra || ''}></div>`;
  return `
      <div class="field"><label>Tipo</label>
        <select data-loottype>
          <option value="arma">Arma</option>
          <option value="scudo">Scudo</option>
          <option value="armatura">Armatura</option>
          <option value="consumabile">Consumabile</option>
          <option value="chiave">Oggetto chiave</option>
        </select>
      </div>
      <div class="field"><label>Nome</label><input type="text" data-lootfield="nome" placeholder="Nome oggetto"></div>

      <div data-lootgroup="armatura" class="field ${g(['armatura'])}"><label>Locazione</label><select data-lootfield="targetSlotIndex">${armorLocOpts}</select></div>
      <div data-lootgroup="arma" class="field ${g(['arma'])}"><label>Tipologia</label><select data-lootfield="weaponClass">${weaponClassOpts}</select></div>

      <div data-lootgroup="arma" class="field ${g(['arma'])}"><label>Taglia</label><select data-lootfield="size">${sizesOf('arma')}</select></div>
      <div data-lootgroup="scudo" class="field ${g(['scudo'])}"><label>Taglia</label><select data-lootfield="size">${sizesOf('scudo')}</select></div>
      <div data-lootgroup="armatura" class="field ${g(['armatura'])}"><label>Taglia</label><select data-lootfield="size">${sizesOf('armatura')}</select></div>

      <div data-lootgroup="arma,scudo,armatura" class="field ${g(['arma', 'scudo', 'armatura'])}"><label>Qualità</label><select data-lootfield="quality">${qualityOpts}</select></div>

      <div data-lootgroup="arma,scudo,armatura" class="${g(['arma', 'scudo', 'armatura'])}" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${numField('Atk', 'atk')}
        ${numField('Dif', 'dif')}
        ${numField('Durabilità', 'dur')}
        ${numField('Peso (Kg)', 'peso')}
      </div>

      <div data-lootgroup="arma,scudo,armatura" class="${g(['arma', 'scudo', 'armatura'])}" style="display:flex;flex-direction:column;gap:6px;">
        <div class="helper-text" style="margin:0;">Bonus meccanici (opzionale)</div>
        <div id="loot-bonus-rows"></div>
        <button type="button" class="btn btn-ghost btn-sm" data-lootbonusadd style="align-self:flex-start;">+ Aggiungi bonus</button>
      </div>

      <div data-lootgroup="consumabile" class="field hidden"><label>Effetto</label><select data-lootfield="effetto">${effectOpts}</select></div>
      <div data-lootgroup="consumabile" class="field hidden"><label>Statistica da incrementare</label><select data-lootfield="target">${statOpts}</select></div>
      <div data-lootgroup="consumabile" class="hidden" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${numField('Valore', 'valore')}
        ${numField('Quantità', 'quantita', 'min="1" value="1"')}
      </div>

      <div data-lootgroup="chiave" class="hidden" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${numField('Peso (Kg)', 'peso')}
      </div>
      <div data-lootgroup="chiave" class="field hidden"><label>Note</label><input type="text" data-lootfield="note" placeholder="Note"></div>
  `;
}
function narratoreLootFormHtml(ch) {
  lootFormBonuses = [];
  return `
    <div class="helper-text" style="margin:10px 0 0;">Invia loot</div>
    <div class="loot-form" style="display:flex;flex-direction:column;gap:8px;">
      ${lootItemFieldsHtml()}
      <button type="button" class="btn btn-sm btn-primary" data-cvsendloot="${ch.id}" style="align-self:flex-start;">Invia</button>
    </div>
  `;
}
/* Form "+ Aggiungi oggetto" della Borsa del Narratore: stessi campi di
   "Invia loot" ma senza destinatario (narratore_add_bag_item invece di
   narratore_send_loot) — vedi apertura/chiusura in openNpcBagAddModal. */
function npcBagAddFormHtml() {
  lootFormBonuses = [];
  return `
    <div class="loot-form" style="display:flex;flex-direction:column;gap:8px;">
      ${lootItemFieldsHtml()}
    </div>
  `;
}
/* Mostra solo i gruppi di campi pertinenti al tipo scelto; richiamata al
   'change' del select Tipo (vedi wiring in fondo al file). */
function updateLootFormGroups(root) {
  const type = root.querySelector('[data-loottype]').value;
  root.querySelectorAll('[data-lootgroup]').forEach(el => {
    el.classList.toggle('hidden', !el.dataset.lootgroup.split(',').includes(type));
  });
}
/* Ripulisce i bonus composti nel form (lootFormBonuses) nella stessa forma
   dei bonus reali di equip: righe non valide (tratto senza nome) vengono
   scartate invece di essere inviate a metà. La rigenerazione parte già col
   conto alla rovescia pieno (regenRemainingSec), pronta a ticchettare non
   appena il giocatore equipaggia il pezzo. */
function cleanedLootBonuses() {
  return lootFormBonuses.map(b => {
    const kind = b.kind || 'primary';
    const valore = Math.max(1, Math.floor(Number(b.valore)) || 1);
    if (kind === 'trait') {
      const name = (b.name || '').trim();
      if (!name) return null;
      return { id: uid(), kind: 'trait', listKey: b.listKey || 'capacitaCombattive', name, valore };
    }
    if (kind === 'rigenerazione') {
      const key = EQUIP_REGEN_TARGETS.some(t => t.key === b.key) ? b.key : 'hp';
      const intervalMin = Math.max(1, Math.floor(Number(b.intervalMin)) || 10);
      return { id: uid(), kind: 'rigenerazione', key, valore, intervalMin, regenRemainingSec: intervalMin * 60 };
    }
    return { id: uid(), kind: 'primary', key: b.key || 'for', valore };
  }).filter(Boolean);
}
/* Legge i campi visibili del form e costruisce l'oggetto nella stessa forma
   dei dati locali (makeWeaponSlot/defaultSlots/makeConsumabileRow), pronto
   per narratore_send_loot. Ritorna null (con toast) se il nome manca. */
function readLootFormItem(root, itemType) {
  const val = field => { const el = root.querySelector(`[data-lootfield="${field}"]`); return el ? el.value : ''; };
  const num = field => Number(val(field)) || 0;
  const nome = val('nome').trim();
  if (!nome) { toast('Il loot deve avere un nome'); return null; }
  if (itemType === 'arma' || itemType === 'scudo') {
    const item = {
      name: nome, kind: itemType, size: val('size'), quality: val('quality'),
      atk: num('atk'), dif: num('dif'), dur: num('dur'), durCur: num('dur'),
      bonus: '', peso: num('peso'), bonuses: cleanedLootBonuses(), equipaggiato: true, statsConfirmed: true
    };
    if (itemType === 'arma') { item.weaponClass = val('weaponClass'); item.usaFor = true; item.usaDex = false; item.usaFmen = false; }
    return item;
  }
  if (itemType === 'armatura') {
    return {
      targetSlotIndex: Number(val('targetSlotIndex')) || 0,
      name: nome, kind: 'armatura', size: val('size'), quality: val('quality'),
      atk: num('atk'), dif: num('dif'), dur: num('dur'), durCur: num('dur'),
      bonus: '', peso: num('peso'), bonuses: cleanedLootBonuses(), statsConfirmed: true
    };
  }
  if (itemType === 'consumabile') {
    const effetto = val('effetto');
    return { nome, effetto, target: effetto === 'incremento' ? val('target') : '', valore: num('valore'), quantita: num('quantita') || 1 };
  }
  // chiave
  return { nome, peso: num('peso'), note: val('note') };
}
function openNarratoreCharacterView(ch, campaignId) {
  const c = Object.assign({}, ch.data, { id: ch.id, nome: (ch.data && ch.data.nome) || ch.name });
  charViewMode = 'cloud-narratore';
  charViewCampaignId = campaignId;
  renderCharView(c);
  const box = $('#charview-narratore-actions');
  box.innerHTML = narratoreCharviewActionsHtml(ch);
  box.classList.remove('hidden');
  showView('charview');
}
async function narratoreSetLevelCloud(characterId, newLevel) {
  const { error } = await withTimeout(sb.rpc('narratore_set_level', { p_character_id: characterId, p_new_level: newLevel }), 'Assegnazione livello');
  if (error) throw error;
}
/* Editing libero della scheda intera (view-sheet aperta in modalità
   Narratore, vedi openCharacterForNarratorEdit in app.js): a differenza di
   pushCharacterToCloud (riservata al proprietario, bloccata dalla RLS
   "personaggi: modifica solo proprietario"), questa passa dalla RPC
   narratore_update_character_data, che tiene anche sincronizzata la colonna
   "level" col "livello" dentro data. */
async function narratoreUpdateCharacterDataCloud(characterId, data, expectedVersion) {
  const { data: row, error } = await withTimeout(
    sb.rpc('narratore_update_character_data', {
      p_character_id: characterId, p_data: data,
      p_expected_version: (expectedVersion === null || expectedVersion === undefined) ? null : Number(expectedVersion)
    }),
    'Salvataggio scheda (Narratore)'
  );
  if (error) throw error;
  return row; // include current_version aggiornata (RETURNS characters)
}
/* Concessioni del Narratore sui tratti: privilegio esclusivo suo, mai
   esposto al giocatore (vedi migrazione narratore_trait_grants). */
async function narratoreGrantTraitPointsCloud(characterId, listKey, points) {
  const { error } = await withTimeout(
    sb.rpc('narratore_grant_trait_points', { p_character_id: characterId, p_list_key: listKey, p_points: points }),
    'Concessione punti tratto'
  );
  if (error) throw error;
}
async function narratoreAddCustomTraitCloud(characterId, listKey, name, value) {
  const { error } = await withTimeout(
    sb.rpc('narratore_add_custom_trait', { p_character_id: characterId, p_list_key: listKey, p_name: name, p_value: value }),
    'Scrittura tratto'
  );
  if (error) throw error;
}
/* Concessione narrativa di un apprendimento (1 Tecnica o 1 Abilità),
   discrezionale e fuori dalla normale progressione di classe: privilegio
   esclusivo del Narratore, mai esposto al giocatore (vedi migrazione
   narratore_tecab_assignment_grants — la stessa scrittura crea sia il
   record tracciabile in tecabAssignments sia il contatore che fa comparire
   lo slot in più, coerente con tecAbSbloccate). */
async function narratoreGrantTecabAssignmentCloud(characterId, tipo, motivazione) {
  const { error } = await withTimeout(
    sb.rpc('narratore_grant_tecab_assignment', { p_character_id: characterId, p_tipo: tipo, p_motivazione: motivazione || '' }),
    'Concessione apprendimento'
  );
  if (error) throw error;
}
/* Invia un oggetto già preparato (arma/scudo/armatura/consumabile/oggetto
   chiave) al personaggio: si accoda in data.pendingLoot, il giocatore lo
   accetta o rifiuta dal proprio dispositivo (vedi narratore_send_loot). */
async function sendLootCloud(characterId, itemType, item) {
  const { error } = await withTimeout(
    sb.rpc('narratore_send_loot', { p_character_id: characterId, p_item_type: itemType, p_item: item }),
    'Invio loot'
  );
  if (error) throw error;
}

/* ------------------------------------------------ Borsa del Narratore */

/* Oggetti pronti da assegnare (bottino di un PNG morto o creati a mano),
   in attesa nella campagna finché il Narratore non sceglie il destinatario
   — vedi narratore_add_bag_item/narratore_assign_bag_item/
   narratore_remove_bag_item (migrazione narrator_bag_items). */
async function fetchNarratorBagItems(campaignId) {
  const { data, error } = await withTimeout(
    sb.from('narrator_bag_items').select('id, item_type, item, source_label, created_at')
      .eq('campaign_id', campaignId).order('created_at', { ascending: false }),
    'Borsa del Narratore'
  );
  if (error) throw error;
  return data || [];
}
async function addNarratorBagItemCloud(campaignId, itemType, item, sourceLabel) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_add_bag_item', { p_campaign_id: campaignId, p_item_type: itemType, p_item: item, p_source_label: sourceLabel || null }),
    'Aggiunta alla borsa'
  );
  if (error) throw error;
  return data;
}
async function removeNarratorBagItemCloud(bagItemId) {
  const { error } = await withTimeout(sb.rpc('narratore_remove_bag_item', { p_bag_item_id: bagItemId }), 'Rimozione dalla borsa');
  if (error) throw error;
}
async function assignNarratorBagItemCloud(bagItemId, characterId) {
  const { error } = await withTimeout(
    sb.rpc('narratore_assign_bag_item', { p_bag_item_id: bagItemId, p_character_id: characterId }),
    'Assegnazione oggetto'
  );
  if (error) throw error;
}

/* Elimina definitivamente un PNG (solo righe is_npc: mai un personaggio di
   un giocatore) — usata dal tasto ✕ della tab PNG e dal flusso "Segna come
   morto" in combattimento (dopo aver trasferito l'equip indossato nella
   borsa, vedi killNpcInCombat in js/app.js). */
async function deleteNpcCloud(characterId) {
  const { error } = await withTimeout(sb.rpc('narratore_delete_npc', { p_character_id: characterId }), 'Eliminazione PNG');
  if (error) throw error;
}
/* Rimuove un personaggio dalla campagna (kick): la scheda resta del
   giocatore, solo scollegata dalla storia. */
async function narratoreRemoveCharacterCloud(characterId) {
  const { error } = await withTimeout(sb.rpc('narratore_remove_character', { p_character_id: characterId }), 'Rimozione personaggio');
  if (error) throw error;
}
/* Condivide una COPIA di una scheda del Narratore con un giocatore già
   iscritto alla campagna (personaggio pre-fatto): la scheda del Narratore
   resta intatta, riusabile come modello per altri giocatori. */
async function narratoreShareCharacterCloud(characterId, campaignId, targetUserId) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_share_character', { p_character_id: characterId, p_campaign_id: campaignId, p_target_user_id: targetUserId }),
    'Condivisione scheda'
  );
  if (error) throw error;
  return data;
}
/* Riassegna la PROPRIETÀ di un personaggio già esistente nella campagna a
   un giocatore diverso — a differenza di narratoreShareCharacterCloud
   (regala una COPIA, l'originale resta del Narratore), qui è la STESSA riga
   che cambia proprietario: nessuna copia, nessun dato perso. */
async function narratoreReassignCharacterOwnerCloud(characterId, newOwnerUserId) {
  const { data, error } = await withTimeout(
    sb.rpc('narratore_reassign_character_owner', { p_character_id: characterId, p_new_owner_user_id: newOwnerUserId }),
    'Riassegnazione personaggio'
  );
  if (error) throw error;
  return data;
}
/* Membri della campagna con nome visualizzato, per il picker "riassegna a
   un altro giocatore" — a differenza di listCampaignCharacters (che deriva
   i giocatori solo da chi ha già un personaggio in gioco), qui servono
   TUTTI i membri: il bersaglio di una riassegnazione può non avere ancora
   una propria scheda in questa campagna. */
async function fetchCampaignMembersWithNames(campaignId) {
  const { data: members, error } = await withTimeout(
    sb.from('campaign_members').select('user_id, role').eq('campaign_id', campaignId),
    'Membri campagna'
  );
  if (error) throw error;
  const names = await fetchDisplayNames((members || []).map(m => m.user_id));
  return (members || []).map(m => ({ userId: m.user_id, role: m.role, name: names[m.user_id] || 'Avventuriero' }));
}

/* ------------------------------------------------------------- cestino */

async function trashCampaignCloud(campaignId) {
  const { error } = await withTimeout(sb.rpc('trash_campaign', { p_campaign_id: campaignId }), 'Eliminazione campagna');
  if (error) throw error;
}
async function restoreCampaignCloud(campaignId) {
  const { error } = await withTimeout(sb.rpc('restore_campaign', { p_campaign_id: campaignId }), 'Ripristino campagna');
  if (error) throw error;
}
async function listTrashedCampaigns() {
  const session = await currentCloudSession();
  if (!session) return [];
  const { data, error } = await withTimeout(
    sb.from('campaigns').select('id, name, deleted_at, purge_at')
      .eq('owner_user_id', session.user.id).not('deleted_at', 'is', null).order('purge_at'),
    'Cestino campagne'
  );
  if (error) throw error;
  return data;
}
function daysRemaining(purgeAt) {
  const ms = new Date(purgeAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/* --------------------------------------------------------------- render */

/* Nickname (profiles.display_name): l'unico dato "sociale" visibile agli
   altri partecipanti di una campagna condivisa (nelle richieste di
   ingresso, nella lista "Personaggi in gioco", e qui sotto nella storia del
   giocatore per il nome del Narratore) — email/altri dati restano privati.
   Un solo campo per account, non per ruolo: vale sia da Narratore sia da
   giocatore, visto che e' la stessa persona/riga di profiles. */
function nicknameFieldHtml(profile) {
  const current = (profile && profile.display_name) || '';
  return `
    <div class="field"><label>Nickname (visibile agli altri partecipanti)</label><input type="text" id="acc-nickname" placeholder="es. Mauro" maxlength="40" value="${escapeHtml(current)}"></div>
    <button class="btn btn-ghost btn-sm" id="acc-save-nickname" style="align-self:flex-start;">Salva nickname</button>
  `;
}

/* I campi email/password vanno dentro un vero <form> (con autocomplete
   corretto e un bottone submit): senza, Chrome/Google Password Manager non
   riconosce affatto un accesso avvenuto e non offre mai di salvare la
   password — è il motivo per cui prima non compariva alcun prompt.
   wireCloudAccountEvents intercetta il "submit" (preventDefault, niente
   ricaricamento di pagina) mantenendo la logica già sui pulsanti. */
function accountStatusHtml(session, caps, profile) {
  if (!session) {
    if (pendingRecoveryEmail) {
      return `
        <p class="helper-text" style="margin:0;">Abbiamo inviato un codice a <strong>${escapeHtml(pendingRecoveryEmail)}</strong>. Inseriscilo qui sotto per continuare (in alternativa, puoi anche aprire il link ricevuto nella stessa email).</p>
        <form id="acc-recovery-code-form" autocomplete="on">
          <input type="text" id="acc-recovery-code-email" value="${escapeHtml(pendingRecoveryEmail)}" name="username" autocomplete="username" class="hidden" readonly>
          <div class="field"><label>Codice ricevuto via email</label><input type="text" id="acc-recovery-code" name="one-time-code" placeholder="123456" autocomplete="one-time-code" inputmode="numeric" maxlength="8"></div>
          <button type="submit" class="btn btn-primary btn-sm" id="acc-verify-recovery-code" style="align-self:flex-start;">Verifica codice</button>
        </form>
        <p class="helper-text" style="margin:0;"><a href="#" id="acc-recovery-code-cancel" style="color:var(--testo-secondario-dark-2);">Annulla</a></p>
      `;
    }
    return `
      <p class="helper-text" style="margin:0;"><strong>Stai accedendo come ospite.</strong> Accedi o registrati per salvare i tuoi personaggi nel cloud e ritrovarli su ogni dispositivo.</p>
      <div class="tabs" id="acc-authmode-toggle" style="padding:0;border-bottom:none;">
        <button class="tab-btn active" data-authmode="signin">Accedi</button>
        <button class="tab-btn" data-authmode="signup">Registrati</button>
      </div>
      <form id="acc-auth-form" autocomplete="on">
        <div class="field"><label>Email</label><input type="email" id="acc-email" name="username" placeholder="tua@email.it" autocomplete="username"></div>
        <div class="field"><label>Password</label><input type="password" id="acc-password" name="password" placeholder="••••••••" autocomplete="current-password"></div>
        <button type="submit" class="btn btn-primary btn-sm" id="acc-submit-auth" data-mode="signin" style="align-self:flex-start;">Accedi</button>
      </form>
      <p class="helper-text" style="margin:0;"><a href="#" id="acc-forgot-password" style="color:var(--testo-secondario-dark-2);">Password dimenticata?</a></p>
      ${caps.google ? '<button class="btn btn-ghost btn-sm" id="acc-google">Accedi con Google</button>' : ''}
      ${caps.apple ? '<button class="btn btn-ghost btn-sm" id="acc-apple">Accedi con Apple</button>' : ''}
    `;
  }
  if (pendingPasswordRecovery) {
    return `
      <p class="helper-text" style="margin:0;">Imposta una nuova password per <strong>${session.user.email || session.user.id}</strong>.</p>
      <form id="acc-recovery-form" autocomplete="on">
        <input type="text" id="acc-recovery-email" value="${escapeHtml(session.user.email || '')}" name="username" autocomplete="username" class="hidden" readonly>
        <div class="field"><label>Nuova password</label><input type="password" id="acc-new-password" name="new-password" placeholder="••••••••" autocomplete="new-password"></div>
        <button type="submit" class="btn btn-primary btn-sm" id="acc-set-new-password" style="align-self:flex-start;">Salva nuova password</button>
      </form>
    `;
  }
  if (isGuestUser(session)) {
    return `
      <p class="helper-text" style="margin:0;"><strong>Stai accedendo come ospite</strong> (solo questo dispositivo): senza collegare un'identità, i dati non sincronizzati potrebbero andare persi.</p>
      ${nicknameFieldHtml(profile)}
      <form id="acc-upgrade-form" autocomplete="on">
        <div class="field"><label>Email</label><input type="email" id="acc-email" name="username" placeholder="tua@email.it" autocomplete="username"></div>
        <div class="field"><label>Password</label><input type="password" id="acc-password" name="new-password" placeholder="••••••••" autocomplete="new-password"></div>
        <button type="submit" class="btn btn-primary btn-sm" id="acc-upgrade" style="align-self:flex-start;">Rendi permanente questo account</button>
      </form>
      <p class="helper-text" style="margin:0;">Ti arriverà un'email di conferma (solo questa volta): aprila per completare.</p>
    `;
  }
  // Account permanente: niente da fare in copertina, nickname ed uscita
  // vivono nella sezione Account (vedi accountIdentityControlsHtml).
  return '';
}

/* Nickname ed uscita per un account permanente: unici controlli che
   restano legati all'identità dopo lo spostamento del modulo di
   accesso/registrazione in copertina — per questo vivono nella sezione
   Account (scelta del ruolo) e non in copertina. */
function accountIdentityControlsHtml(profile) {
  return `
    ${nicknameFieldHtml(profile)}
    <button class="btn btn-ghost btn-sm" id="acc-signout" style="align-self:flex-start;">Esci</button>
  `;
}

/* accountRole arriva dal database (profiles.account_role), non da un tab:
   un account 'player' non vede mai il modulo "Crea campagna", solo il modo
   per attivare il ruolo. */
/* Estratta da campaignsBoxHtml: usata sia lì (difensivo, se mai richiamata
   per un account non-Narratore) sia dalla "Diventa Narratore" in Account
   (renderNarratorCtaBox) — dopo che "Le tue campagne" si è spostata in
   copertina (sempre nascosta per un account 'player', vedi
   renderMyCampaignsBox), questo resta l'unico punto in cui un account
   'player' può ancora attivare il ruolo. Self-service (purchaseNarratorRole):
   nessuna attesa di approvazione, il piano 'narrator' è oggi a costo 0. */
function narratorRoleRequestHtml() {
  return `
    <p class="helper-text" style="margin:0;">Questo account non è ancora abilitato come Narratore. Per creare e gestire una campagna serve prima il ruolo Narratore.</p>
    <button class="btn btn-primary btn-sm" id="acc-request-narrator" style="align-self:flex-start;">Diventa Narratore</button>
  `;
}
/* Icona scelta nel form di creazione, già ridimensionata in data-URL:
   in attesa che "Crea campagna" la passi a createCampaign insieme al nome
   (la campagna non esiste ancora, niente riga su cui fare update). */
let pendingNewCampaignIcon = null;

/* Card di una campagna nell'elenco "Le tue storie": stesso stile
   (icona+nome+meta) di .char-card in renderCharList (js/app.js), un
   tocco apre la scheda dedicata a tutto schermo (openCampaignSheet)
   invece di espandere un pannello in linea come prima. */
function campaignCardHtml(c) {
  const initial = (c.name || '?').trim().charAt(0).toUpperCase() || '?';
  const meta = c.session_active ? '🟢 Sessione in corso' : (c.listed ? 'Visibile ai giocatori' : 'Nascosta');
  const iconStyle = c.icon ? ` style="background-image:url(${c.icon})"` : '';
  return `<div class="char-card" data-campaignid="${c.id}" data-campaignname="${escapeHtml(c.name)}">
    <div class="avatar${c.icon ? ' has-portrait' : ''}"${iconStyle}>${c.icon ? '' : initial}</div>
    <div class="info">
      <div class="name">${escapeHtml(c.name)}</div>
      <div class="meta">${meta}</div>
    </div>
    <button class="btn btn-icon btn-ghost" data-trashcampaign="${c.id}" title="Elimina" aria-label="Elimina">🗑</button>
  </div>`;
}
function campaignsBoxHtml(session, campaigns, accountRole) {
  if (!session || isGuestUser(session)) {
    return '<p class="helper-text" style="margin:0;">Accedi con un account permanente per creare o vedere le tue campagne.</p>';
  }
  if (accountRole !== 'narrator' && accountRole !== 'admin') {
    return narratorRoleRequestHtml();
  }
  const list = (campaigns || []).map(campaignCardHtml).join('') || '<p class="empty-state">Nessuna campagna ancora.</p>';
  return `
    <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:10px;">
      <div class="field-row">
        <div class="field"><label>Nome storia</label><input type="text" id="acc-new-campaign-name" placeholder="es. La Torre di Vetro"></div>
      </div>
      <div id="acc-new-campaign-icon-info"><div class="helper-text" style="margin:0;">Nessuna icona selezionata.</div></div>
      <input type="file" id="acc-new-campaign-icon-input" accept="image/*" class="hidden">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="acc-new-campaign-icon-upload">🖼 Scegli icona</button>
      </div>
      <div class="field"><label>Premessa (facoltativa)</label><input type="text" id="acc-new-campaign-premise-title" placeholder="es. Sessione 1 — L'arrivo"></div>
      <div id="acc-new-campaign-premise-info"><div class="helper-text" style="margin:0;">Nessun PDF selezionato.</div></div>
      <input type="file" id="acc-new-campaign-premise-input" accept="application/pdf" class="hidden">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="acc-new-campaign-premise-upload">📄 Scegli PDF premessa</button>
      </div>
      <label class="row-between" style="cursor:pointer;">
        <span class="helper-text" style="margin:0;">Pubblica subito la premessa (visibile ai giocatori appena entrano)</span>
        <input type="checkbox" id="acc-new-campaign-premise-publish">
      </label>
      <label class="row-between" style="cursor:pointer;">
        <span class="helper-text" style="margin:0;">Rendi visibile nella ricerca dei giocatori</span>
        <input type="checkbox" id="acc-new-campaign-listed">
      </label>
      <button class="btn btn-primary btn-sm" id="acc-create-campaign" style="align-self:flex-start;">Crea storia</button>
    </div></div>
    <div id="acc-campaign-list" style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">${list}</div>
  `;
}

/* Icona della campagna (Gestisci > in cima): sostituisce l'iniziale del
   nome nella card di "Le tue storie" (vedi campaignCardHtml) quando
   presente — stesso meccanismo (data-URL ridimensionata) del ritratto
   personaggio, qui salvata subito in campaigns.icon via setCampaignIcon
   invece che restare in un campo del form. */
function campaignIconHtml(campaignId, icon) {
  const preview = icon
    ? `<img src="${icon}" alt="" style="width:56px;height:56px;border-radius:var(--radius-sm);object-fit:cover;">`
    : '<div class="helper-text" style="margin:0;">Nessuna icona: l\'elenco mostra l\'iniziale del nome.</div>';
  return `
    <div class="section-title" style="margin-top:0;"><span class="dot neutral"></span>Icona</div>
    <div style="display:flex;align-items:center;gap:10px;">${preview}</div>
    <input type="file" data-iconinput="${campaignId}" accept="image/*" class="hidden">
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" data-iconupload="${campaignId}">🖼 ${icon ? 'Cambia icona' : 'Carica icona'}</button>
      ${icon ? `<button class="btn btn-ghost btn-sm" data-iconremove="${campaignId}">✕ Rimuovi</button>` : ''}
    </div>
  `;
}

/* "Listed": decide se la campagna compare nell'elenco che il giocatore
   consulta per cercare una storia a cui chiedere di partecipare — non va
   confuso con l'ingresso vero e proprio, sempre soggetto ad approvazione
   (approve_join_request): qui si decide solo chi puo' anche solo trovarla. */
function campaignVisibilityHtml(campaignId, listed) {
  return `
    <div class="section-title" style="margin-top:0;"><span class="dot neutral"></span>Visibilità</div>
    <label class="row-between" style="cursor:pointer;">
      <span class="helper-text" style="margin:0;">Visibile nella ricerca dei giocatori</span>
      <input type="checkbox" data-listedtoggle="${campaignId}" ${listed ? 'checked' : ''}>
    </label>
    <p class="helper-text" style="margin:0;">${listed ? 'I giocatori possono trovarla e mandare una richiesta di partecipazione.' : 'Nascosta: nessun giocatore può trovarla o chiedere di entrare.'}</p>
  `;
}

function campaignPremiseHtml(campaignId, premise) {
  const has = !!premise.premise_filename;
  const info = has
    ? `<div class="pr-title">${escapeHtml(premise.premise_title || premise.premise_filename)}</div>
       <div class="pr-text">${escapeHtml(premise.premise_filename)} · ${Math.round((premise.premise_size || 0) / 1024)} KB${premise.premise_updated_at ? ' · aggiornata ' + new Date(premise.premise_updated_at).toLocaleString('it-IT') : ''}</div>`
    : '<div class="helper-text" style="margin:0;">Nessun PDF caricato.</div>';
  return `
    <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Premessa</div>
    <div class="field"><label>Titolo</label><input type="text" data-premisetitle="${campaignId}" placeholder="es. Sessione 1 — L'arrivo" value="${escapeHtml(premise.premise_title || '')}"></div>
    <div>${info}</div>
    <input type="file" data-premiseinput="${campaignId}" accept="application/pdf" class="hidden">
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" data-premiseupload="${campaignId}">📄 ${has ? 'Sostituisci PDF' : 'Carica PDF'}</button>
      ${has ? `<button class="btn btn-ghost btn-sm" data-premisepreview="${campaignId}">👁 Anteprima</button>` : ''}
      ${has ? `<button class="btn btn-ghost btn-sm" data-premiseremove="${campaignId}">✕ Rimuovi</button>` : ''}
    </div>
    <label class="row-between" style="cursor:pointer;">
      <span class="helper-text" style="margin:0;">Pubblica (visibile ai giocatori della storia)</span>
      <input type="checkbox" data-premisepublish="${campaignId}" ${premise.premise_published ? 'checked' : ''} ${has ? '' : 'disabled'}>
    </label>
  `;
}

/* Avvio/chiusura sessione: l'etichetta (es. "E01 S02") si chiede solo
   all'avvio; alla chiusura resta quella gia' impostata (vedi RPC, che la
   preserva se non ne arriva una nuova), cosi' il Narratore non deve
   riscriverla ogni volta solo per richiuderla. */
function campaignSessionHtml(campaignId, settings) {
  const active = !!settings.session_active;
  const label = settings.session_label || '';
  return `
    <div class="section-title" style="margin-top:10px;"><span class="dot ${active ? '' : 'neutral'}"></span>Sessione di gioco</div>
    <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:10px;">
      <p class="helper-text" style="margin:0;">${active
        ? `🟢 Sessione in corso${label ? ': <strong>' + escapeHtml(label) + '</strong>' : ''}. I giocatori possono usare Riposo, Tecniche e Abilità.`
        : 'Sessione chiusa: i giocatori non possono usare Riposo, Tecniche o Abilità finché non la avvii.'}</p>
      ${active ? '' : `<div class="field"><label>Riferimento sessione (es. E01 S02)</label><input type="text" data-sessionlabel="${campaignId}" placeholder="E01 S02" value="${escapeHtml(label)}"></div>`}
      <button type="button" class="btn btn-sm ${active ? 'btn-ghost' : 'btn-primary'}" data-togglesession="${campaignId}" data-active="${active}" style="align-self:flex-start;">${active ? '⏸ Chiudi sessione' : '▶ Avvia sessione'}</button>
    </div></div>
  `;
}

/* Registro "Previously on": una riga per riassunto pubblicato, con
   riferimento stagione/episodio. Modifica/eliminazione riservate al
   Narratore/co-narratore (RLS su campaign_session_logs). */
function sessionLogRowHtml(l) {
  return `<div class="row-between" style="padding:4px 0;flex-wrap:wrap;gap:6px;" data-logrow="${l.id}">
    <span>E${String(l.episode).padStart(2, '0')} S${String(l.season).padStart(2, '0')}${l.title ? ' — ' + escapeHtml(l.title) : ''}</span>
    <span style="display:flex;gap:4px;">
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-editlog="${l.id}" title="Modifica">✎</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-deletelog="${l.id}" title="Elimina" style="color:var(--fisico-forte);">✕</button>
    </span>
  </div>`;
}
function campaignSessionLogsHtml(campaignId, logs) {
  const list = logs.length ? logs.map(sessionLogRowHtml).join('') : '<p class="helper-text" style="margin:0;">Nessun riassunto pubblicato ancora.</p>';
  return `
    <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Recap — registro sessioni</div>
    <div class="box"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:10px;">
      <p class="helper-text" style="margin:0;">Riassunti che i giocatori possono leggere dalla propria scheda, per ricordare cosa è successo nella giocata precedente.</p>
      <div class="field-row">
        <div class="field" style="max-width:100px;"><label>Stagione</label><input type="number" min="1" value="1" data-newlogseason="${campaignId}"></div>
        <div class="field" style="max-width:100px;"><label>Episodio</label><input type="number" min="1" value="1" data-newlogepisode="${campaignId}"></div>
      </div>
      <div class="field"><label>Titolo (facoltativo)</label><input type="text" data-newlogtitle="${campaignId}" placeholder="es. L'arrivo alla Torre"></div>
      <div class="field"><label>Riassunto</label><textarea data-newlogbody="${campaignId}" rows="4" placeholder="Cosa è successo nella giocata precedente..."></textarea></div>
      <button type="button" class="btn btn-primary btn-sm" data-addlog="${campaignId}" style="align-self:flex-start;">Pubblica riassunto</button>
      <div style="margin-top:6px;">${list}</div>
    </div></div>
  `;
}

function joinRequestRowHtml(r) {
  return `<div class="row-between" style="padding:4px 0;">
    <span>${escapeHtml(r.characterName)} <span class="helper-text" style="margin:0;">(${escapeHtml(r.playerName)})</span></span>
    <span>
      <button class="btn btn-sm btn-primary" data-approve="${r.id}">Accetta</button>
      <button class="btn btn-sm btn-ghost" data-reject="${r.id}">Rifiuta</button>
    </span>
  </div>`;
}

function combatStartRequestRowHtml(r) {
  return `<div class="row-between" style="padding:4px 0;">
    <span>⚔ ${escapeHtml(r.characterName)}${r.note ? ` <span class="helper-text" style="margin:0;">(${escapeHtml(r.note)})</span>` : ''}</span>
    <span>
      <button class="btn btn-sm btn-primary" data-acceptcombat="${r.id}">Accetta</button>
      <button class="btn btn-sm btn-ghost" data-declinecombat="${r.id}">Rifiuta</button>
    </span>
  </div>`;
}

function knownTraitRowHtml(t) {
  return `<div class="row-between" style="padding:4px 0;">
    <span>${escapeHtml(t.name)} <span class="helper-text" style="margin:0;">${TRAIT_LIST_LABELS[t.list_key] || t.list_key} · proposto da ${t.playerName}</span></span>
    <span>
      <button class="btn btn-sm btn-primary" data-approvetrait="${t.id}">Approva</button>
      <button class="btn btn-sm btn-ghost" data-rejecttrait="${t.id}">Rifiuta</button>
    </span>
  </div>`;
}

/* Concessioni del Narratore sui tratti: privilegio suo esclusivo, per questo
   compare qui (Account → Narratore → dettaglio campagna) e non nella scheda
   del giocatore, che non deve poterle vedere né tanto meno attivare da sé. */
function campaignCharacterTraitsHtml(ch) {
  const bonus = (ch.data && ch.data.traitNarratoreBonus) || {};
  return Object.keys(TRAIT_LISTS).map(listKey => {
    const b = Number(bonus[listKey]) || 0;
    return `<div class="row-between" style="padding:3px 0;flex-wrap:wrap;gap:6px;">
      <span class="helper-text" style="margin:0;">${TRAIT_LIST_LABELS[listKey]}${b ? ` <strong>+${b}</strong>` : ''}</span>
      <span style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
        <input type="number" min="1" value="1" data-traitgrantinput="${ch.id}::${listKey}" aria-label="Punti da concedere — ${TRAIT_LIST_LABELS[listKey]}" style="width:44px;">
        <button type="button" class="btn btn-sm btn-ghost" data-traitgrant="${ch.id}::${listKey}">Concedi</button>
        <button type="button" class="btn btn-sm btn-ghost" data-traitcustom="${ch.id}::${listKey}">+ Tratto</button>
      </span>
    </div>`;
  }).join('');
}
/* Concessioni narrative di apprendimenti (1 Tecnica o 1 Abilità,
   discrezionale, fuori dalla normale progressione di classe — vedi
   checkpoint "Tecniche e Abilità: sistema apprendimenti"): stesso posto
   e stesso privilegio esclusivo dei punti tratto qui sopra, mai visibile
   né attivabile dal giocatore. Elenca anche le concessioni già fatte non
   ancora usate, con la motivazione, per non perdere traccia di cosa è
   stato concesso e perché. */
function campaignCharacterTecabHtml(ch) {
  const assignments = (ch.data && Array.isArray(ch.data.tecabAssignments)) ? ch.data.tecabAssignments : [];
  const pending = assignments.filter(a => a.origine === 'narratore' && a.stato === 'disponibile');
  const TECAB_TIPO_LABEL = { tecniche: 'Tecnica', abilita: 'Abilità' };
  return `
    <div class="row-between" style="padding:3px 0;flex-wrap:wrap;gap:6px;">
      <span class="helper-text" style="margin:0;">Apprendimento</span>
      <span style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
        <select data-tecabgranttipo="${ch.id}" aria-label="Tipo di apprendimento da concedere" style="width:auto;">
          <option value="tecniche">Tecnica</option>
          <option value="abilita">Abilità</option>
        </select>
        <input type="text" placeholder="Motivazione (facoltativa)" data-tecabgrantreason="${ch.id}" aria-label="Motivazione dell'apprendimento concesso" style="width:170px;">
        <button type="button" class="btn btn-sm btn-ghost" data-tecabgrant="${ch.id}">Concedi</button>
      </span>
    </div>
    ${pending.length ? `<p class="helper-text" style="margin:4px 0 0;">In attesa d'uso: ${pending.map(a => `${TECAB_TIPO_LABEL[a.tipo] || a.tipo}${a.motivazione ? ` ("${escapeHtml(a.motivazione)}")` : ''}`).join(', ')}</p>` : ''}
  `;
}
/* Riga di un PNG generato dal Randomizer (tab "PNG"): niente livello
   assegnabile a mano qui (già scelto alla generazione, resta modificabile
   dalla scheda completa come per qualunque altro personaggio) né tratti
   concessi (non è un giocatore) — solo apertura scheda e rimozione. Per
   "richiamarlo in battaglia" non serve un bottone dedicato: il pannello
   "Metti in scena" del tabellone di combattimento elenca già tutti i
   personaggi della campagna (listCampaignCharacters, js/app.js), PNG
   inclusi, con una semplice checkbox. */
function npcCharacterRowHtml(ch) {
  return `<div class="row-between" style="padding:4px 0;flex-wrap:wrap;gap:6px;" data-charrow="${ch.id}">
    <span><a href="#" data-opencharview="${ch.id}" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;">${escapeHtml(ch.name)}</a> <span class="helper-text" style="margin:0;">Lv ${ch.level}</span></span>
    <span style="display:flex;gap:4px;align-items:center;">
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-narratoredit="${ch.id}" title="Apri scheda completa">✏️</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-deletenpc="${ch.id}" title="Elimina PNG" style="color:var(--fisico-forte);">✕</button>
    </span>
  </div>`;
}

/* Riga della Borsa del Narratore: nome ricavato dall'item (arma/scudo/
   armatura hanno "name", consumabile/chiave hanno "nome"), select con i
   personaggi giocatore della campagna per l'assegnazione immediata. */
function narratorBagItemRowHtml(it, playerChars) {
  const label = (it.item && (it.item.name || it.item.nome)) || 'Oggetto';
  const typeLabel = { arma: 'Arma', scudo: 'Scudo', armatura: 'Armatura', consumabile: 'Consumabile', chiave: 'Oggetto chiave' }[it.item_type] || it.item_type;
  const sourceHtml = it.source_label ? ` <span class="helper-text" style="margin:0;">(${escapeHtml(it.source_label)})</span>` : '';
  const opts = playerChars.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.playerName)})</option>`).join('');
  return `<div class="row-between" style="padding:4px 0;flex-wrap:wrap;gap:6px;" data-bagitemrow="${it.id}">
    <span>${escapeHtml(label)} <span class="helper-text" style="margin:0;">${typeLabel}</span>${sourceHtml}</span>
    <span style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
      <select data-bagassignselect="${it.id}" aria-label="Assegna ${escapeHtml(label)} a" ${playerChars.length ? '' : 'disabled'}>${playerChars.length ? opts : '<option>Nessun giocatore</option>'}</select>
      <button type="button" class="btn btn-sm btn-ghost" data-bagassignbtn="${it.id}" ${playerChars.length ? '' : 'disabled'}>Assegna</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-bagremovebtn="${it.id}" title="Rimuovi dalla borsa" style="color:var(--fisico-forte);">✕</button>
    </span>
  </div>`;
}

/* ------------------------------------------------------- Randomize NPC */

/* Aggiorna classe/qualità/pesantezza/n.tecniche coi suggerimenti pesati
   dell'archetipo scelto (rollNpcSuggestedParams, js/npc-randomizer.js):
   richiamata all'apertura del modale e ogni volta che cambia l'archetipo,
   così i campi partono già coerenti col "tipo di NPC" invece che a caso. */
function npcRandomizerApplySuggestion() {
  const archetypeKey = $('#npc-rand-archetype').value;
  const level = clamp(parseInt($('#npc-rand-level').value, 10) || 1, 1, 20);
  const s = rollNpcSuggestedParams(archetypeKey, level);
  $('#npc-rand-build').value = s.build;
  $('#npc-rand-quality').value = s.equipQuality;
  $('#npc-rand-weight').value = s.pesantezza;
  $('#npc-rand-tecab-count').value = s.tecabCount;
  $('#npc-rand-tecab-count').max = s.maxTecAb;
  $('#npc-rand-tecab-max').textContent = `Massimo per Lv ${level} e questa classe: ${s.maxTecAb}.`;
}

function openNpcRandomizerModal() {
  const sel = $('#npc-rand-archetype');
  sel.innerHTML = NPC_ARCHETYPES.map(a => `<option value="${a.key}">${escapeHtml(a.label)}</option>`).join('');
  const archetype = NPC_ARCHETYPES[Math.floor(Math.random() * NPC_ARCHETYPES.length)];
  sel.value = archetype.key;
  $('#npc-rand-name').value = archetype.label;
  $('#npc-rand-level').value = 1;
  npcRandomizerApplySuggestion();
  $('#npc-randomizer-modal').classList.remove('hidden');
}
function closeNpcRandomizerModal() {
  $('#npc-randomizer-modal').classList.add('hidden');
}

/* ---------------------------------------------- Aggiungi oggetto alla Borsa */

function openNpcBagAddModal() {
  $('#npc-bag-add-fields').innerHTML = npcBagAddFormHtml();
  $('#npc-bag-add-modal').classList.remove('hidden');
}
function closeNpcBagAddModal() {
  $('#npc-bag-add-modal').classList.add('hidden');
}
function campaignCharacterRowHtml(ch) {
  return `<div class="row-between" style="padding:4px 0;flex-wrap:wrap;gap:6px;" data-charrow="${ch.id}">
    <span><a href="#" data-opencharview="${ch.id}" style="color:inherit;text-decoration:underline;text-decoration-style:dotted;">${escapeHtml(ch.name)}</a> <span class="helper-text" style="margin:0;">(${escapeHtml(ch.playerName)}) — Lv ${ch.level}</span></span>
    <span style="display:flex;gap:4px;align-items:center;">
      <input type="number" min="1" max="20" value="${ch.level}" data-levelinput="${ch.id}" aria-label="Nuovo livello per ${escapeHtml(ch.name)}" style="width:52px;">
      <button class="btn btn-sm btn-ghost" data-setlevel="${ch.id}">Assegna</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-toggletraits="${ch.id}" title="Concedi punti tratto">🎁</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-toggletecab="${ch.id}" title="Concedi un apprendimento">🎓</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-togglereassign="${ch.id}" title="Riassegna a un altro giocatore">👤</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-narratoredit="${ch.id}" title="Apri scheda completa">✏️</button>
      <button type="button" class="btn btn-icon btn-sm btn-ghost" data-removechar="${ch.id}" title="Rimuovi dalla storia" style="color:var(--fisico-forte);">✕</button>
    </span>
  </div>
  <div class="hidden" data-chartraits="${ch.id}" style="padding:2px 8px 10px;">
    ${campaignCharacterTraitsHtml(ch)}
  </div>
  <div class="hidden" data-chartecab="${ch.id}" style="padding:2px 8px 10px;">
    ${campaignCharacterTecabHtml(ch)}
  </div>
  <div class="hidden" data-charreassign="${ch.id}" style="padding:2px 8px 10px;">
    <div class="row-between" style="gap:6px;flex-wrap:wrap;">
      <select data-reassignselect="${ch.id}" aria-label="Nuovo giocatore per ${escapeHtml(ch.name)}" style="flex:1;min-width:160px;"><option value="">Caricamento…</option></select>
      <button type="button" class="btn btn-sm btn-primary" data-reassignconfirm="${ch.id}">Riassegna</button>
    </div>
  </div>`;
}

// Cache in memoria dell'ultimo elenco "Personaggi in gioco" caricato, per
// poter aprire la scheda completa di un personaggio al click senza dover
// rifare la chiamata di rete (i dati includono già l'intera "data" jsonb).
let lastCampaignCharactersById = {};

/* Scheda a tutto schermo di una storia (#view-campaignsheet), stesso
   schema a tab della scheda personaggio (#view-sheet): un solo pannello
   alla volta popolato, cambio tab puro CSS senza ri-render (vedi il
   delegato su #campaign-sheet-tabs in wireCloudAccountEvents). Sostituisce
   la vecchia campaignDetailHtml (pannello unico "Personaggi"/"Gestisci
   campagna" espanso in linea sotto la riga della campagna): le
   sotto-funzioni di rendering (campaignVisibilityHtml, campaignPremiseHtml,
   campaignSessionHtml, campaignSessionLogsHtml, joinRequestRowHtml,
   combatStartRequestRowHtml, knownTraitRowHtml, campaignCharacterRowHtml)
   restano invariate, cambia solo come vengono assemblate nei 5 pannelli. */
let activeCampaignSheetId = null;
let activeCampaignSheetName = '';

function openCampaignSheet(campaignId) {
  activeCampaignSheetId = campaignId;
  showView('campaignsheet');
  renderCampaignSheet();
}

async function renderCampaignSheet() {
  const id = activeCampaignSheetId;
  if (!id) return;
  const personaggiPanel = $('[data-camppanel="personaggi"]');
  const npcPanel = $('[data-camppanel="png"]');
  const combattimentoPanel = $('[data-camppanel="combattimento"]');
  const riassuntoPanel = $('[data-camppanel="riassunto"]');
  const premessaPanel = $('[data-camppanel="premessa"]');
  const gestisciPanel = $('[data-camppanel="gestisci"]');
  if (!personaggiPanel) return;
  try {
    const [pending, chars, settings, logs, pendingTraits, pendingCombat, bagItems] = await Promise.all([
      listPendingJoinRequests(id), listCampaignCharacters(id),
      getCampaignSettingsInfo(id), listSessionLogs(id),
      listPendingKnownTraits(id).catch(() => []),
      listPendingCombatStartRequests(id).catch(() => []),
      fetchNarratorBagItems(id).catch(() => [])
    ]);
    if (id !== activeCampaignSheetId) return; // la vista è cambiata mentre aspettavamo
    activeCampaignSheetName = settings.name || 'Storia';
    $('#campaign-sheet-title').textContent = activeCampaignSheetName;
    chars.forEach(ch => { lastCampaignCharactersById[ch.id] = ch; });

    // Roster diviso: PG dei giocatori (chi gioca la campagna) da PNG del
    // Narratore (personaggi il cui proprietario è narratore/co-narratore/
    // owner — stessa regola già in uso lato SQL per il fog-of-war di
    // combattimento, character_owner_is_master). I PNG generati dal
    // Randomizer (is_npc) escono da qui e vivono nella loro tab dedicata:
    // "Personaggi del Narratore" resta solo per un eventuale PG che il
    // Narratore gioca in prima persona nella propria storia.
    const playerChars = chars.filter(ch => !ch.isMasterOwned);
    const masterChars = chars.filter(ch => ch.isMasterOwned && !ch.is_npc);
    const npcChars = chars.filter(ch => ch.is_npc);
    const playerCharsHtml = playerChars.length
      ? playerChars.map(campaignCharacterRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessun personaggio giocatore ancora in questa storia.</p>';
    const masterCharsHtml = masterChars.length
      ? masterChars.map(campaignCharacterRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessun personaggio del Narratore ancora in questa storia.</p>';
    personaggiPanel.innerHTML = `
      <div class="section-title" style="margin-top:0;"><span class="dot neutral"></span>Personaggi dei giocatori</div>
      ${playerCharsHtml}
      <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Personaggi del Narratore</div>
      ${masterCharsHtml}
    `;

    const npcCharsHtml = npcChars.length
      ? npcChars.map(npcCharacterRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessun PNG generato ancora in questa storia.</p>';
    const bagItemsHtml = bagItems.length
      ? bagItems.map(it => narratorBagItemRowHtml(it, playerChars)).join('')
      : '<p class="helper-text" style="margin:0;">Vuota: raccogli il bottino di un PNG segnato come morto in combattimento, oppure aggiungi un oggetto a mano.</p>';
    // Blocco 3: il generatore resta riservato a un piano che lo includa.
    // window.myEntitlements nullo (non ancora risolto) mostra comunque il
    // pulsante — fail-open lato client, il vero controllo resta la RPC
    // narratore_create_npc (security definer), non aggirabile da qui.
    const npcAllowed = !window.myEntitlements || window.myEntitlements.npc_generator !== false;
    const npcRandomizerBtnHtml = npcAllowed
      ? `<button type="button" class="btn btn-primary btn-sm" id="btn-open-npc-randomizer" style="margin-top:10px;align-self:flex-start;">🎲 Genera PNG</button>`
      : `<p class="helper-text" style="margin:10px 0 0;">🎲 Il generatore di PNG richiede un piano che lo includa.</p>`;
    if (npcPanel) npcPanel.innerHTML = `
      <div class="section-title" style="margin-top:0;"><span class="dot neutral"></span>PNG di questa storia</div>
      <p class="helper-text">Generati al volo per dare più sfida ai giocatori: compaiono anche nel pannello "Metti in scena" del Combattimento, mai in "I tuoi personaggi". Segnarli come morti in combattimento li elimina da qui e ne trasferisce l'equip indossato nella Borsa qui sotto.</p>
      ${npcCharsHtml}
      ${npcRandomizerBtnHtml}
      <div class="section-title" style="margin-top:16px;"><span class="dot neutral"></span>🎒 Borsa del Narratore</div>
      <p class="helper-text">Armi, armature e oggetti pronti da assegnare a un giocatore come bottino — bottino di un PNG morto o creati a mano qui.</p>
      ${bagItemsHtml}
      <button type="button" class="btn btn-ghost btn-sm" id="btn-open-npc-bag-add" style="margin-top:6px;align-self:flex-start;">+ Aggiungi oggetto alla borsa</button>
    `;

    const pendingCombatHtml = pendingCombat.length
      ? pendingCombat.map(combatStartRequestRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessuna richiesta di combattimento in attesa.</p>';
    combattimentoPanel.innerHTML = `
      <button class="btn btn-primary" data-opencombat="${id}" style="align-self:flex-start;">⚔ Vai al tabellone di combattimento</button>
      <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Richieste di combattimento in attesa</div>
      ${pendingCombatHtml}
    `;

    riassuntoPanel.innerHTML = campaignSessionLogsHtml(id, logs);
    premessaPanel.innerHTML = campaignPremiseHtml(id, settings);

    const pendingHtml = pending.length
      ? pending.map(joinRequestRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessuna richiesta in attesa.</p>';
    const pendingTraitsHtml = pendingTraits.length
      ? pendingTraits.map(knownTraitRowHtml).join('')
      : '<p class="helper-text" style="margin:0;">Nessun tratto proposto in attesa.</p>';
    gestisciPanel.innerHTML = `
      ${campaignIconHtml(id, settings.icon)}
      ${campaignVisibilityHtml(id, settings.listed)}
      ${campaignSessionHtml(id, settings)}
      <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Richieste in attesa</div>
      ${pendingHtml}
      <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Tratti proposti dai giocatori</div>
      <p class="helper-text">Un tratto personalizzato scritto da un giocatore (scheda Tratti o bonus di scudo/arma) resta qui finché non lo approvi: solo dopo diventa pescabile da tutti i personaggi di questa storia.</p>
      ${pendingTraitsHtml}
      <div class="section-title" style="margin-top:10px;"><span class="dot neutral"></span>Ambientazioni</div>
      <p class="helper-text">Le immagini caricate qui alimentano la libreria mappe del tabellone di combattimento.</p>
      <button class="btn btn-ghost btn-sm" data-openassets="${id}" style="align-self:flex-start;">🖼 Ambientazioni</button>
      <button class="btn btn-ghost btn-sm" data-trashcampaign="${id}" style="align-self:flex-start;margin-top:10px;color:var(--fisico-forte);">🗑 Elimina storia</button>
    `;
  } catch (e) {
    personaggiPanel.innerHTML = `<p class="helper-text" style="margin:0;">Errore: ${escapeHtml(describeError(e))}</p>`;
  }
}

/* Libreria "Ambientazioni" (Gestisci > Ambientazioni): stessa libreria
   immagini già usata dalla mappa di combattimento (campaign_assets/
   uploadCampaignAsset/removeCampaignAsset/getCampaignAssetUrl, vedi
   js/cloud-combat.js), ma qui sfogliabile a griglia — come una galleria
   foto — indipendentemente da un combattimento in corso, invece che solo
   dal pannello "Gestisci scena" dentro il tabellone. */
let activeCampaignAssetsCampaignId = null;

function openCampaignAssetsGallery(campaignId) {
  activeCampaignAssetsCampaignId = campaignId;
  $('#campaign-assets-popup').classList.remove('hidden');
  renderCampaignAssetsGallery();
}

async function renderCampaignAssetsGallery() {
  const id = activeCampaignAssetsCampaignId;
  const body = $('#campaign-assets-popup-body');
  if (!id || !body) return;
  let assets = [];
  try { assets = await fetchCampaignAssets(id); }
  catch (err) { body.innerHTML = `<p class="helper-text" style="margin:16px;">Errore: ${describeError(err)}</p>`; return; }
  if (id !== activeCampaignAssetsCampaignId) return; // la galleria è stata chiusa/cambiata nel frattempo
  body.innerHTML = `
    <div class="asset-gallery-grid">
      <div class="asset-gallery-tile">
        <div class="asset-gallery-name">&nbsp;</div>
        <button type="button" class="asset-gallery-add" id="campaign-assets-add" title="Carica immagine" aria-label="Carica immagine">+</button>
      </div>
      ${assets.map(a => `
        <div class="asset-gallery-tile">
          <div class="asset-gallery-name">${escapeHtml(a.label)}</div>
          <div class="asset-gallery-thumb" data-assetgallerythumb="${a.id}">
            <button type="button" class="ag-del" data-removegalleryasset="${a.id}" data-removegallerypath="${escapeHtml(a.storage_path)}" title="Elimina" aria-label="Elimina">🗑</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  assets.forEach(a => {
    getCampaignAssetUrl(a.storage_path).then(url => {
      const thumb = body.querySelector(`[data-assetgallerythumb="${a.id}"]`);
      if (thumb) thumb.style.backgroundImage = `url(${url})`;
    }).catch(() => {});
  });
}

/* Condivisa fra la card in "Le tue storie" (elimina rapida) e il tab
   "Gestisci" della scheda (stessa conferma, stessa RPC): l'unica
   differenza è cosa succede dopo (vedi i due call site). */
async function trashCampaignFlow(campaignId, campaignName) {
  if (!confirm(`Eliminare "${campaignName}"? Entrerà nel cestino per 30 giorni, recuperabile in ogni momento; i giocatori riceveranno un avviso.`)) return false;
  try {
    await trashCampaignCloud(campaignId);
    toast('Storia spostata nel cestino');
    return true;
  } catch (err) { toast('Errore: ' + describeError(err)); return false; }
}

function trashBoxHtml(session, trashed) {
  if (!session || isGuestUser(session)) return '<p class="helper-text" style="margin:0;">—</p>';
  if (!trashed || !trashed.length) return '<p class="helper-text" style="margin:0;">Il cestino è vuoto.</p>';
  return trashed.map(t => `
    <div class="row-between" style="padding:4px 0;">
      <span>${escapeHtml(t.name)} <span class="helper-text" style="margin:0;">(${daysRemaining(t.purge_at)} giorni rimasti)</span></span>
      <button class="btn btn-sm btn-ghost" data-restorecampaign="${t.id}">Ripristina</button>
    </div>
  `).join('');
}

/* ------------------------------------------- entrata in gioco (Narratore) */

/* "Entrata in gioco" = richiesta di ingresso in una campagna: il Narratore
   deve saperlo subito, non scoprirlo aprendo a mano Account -> "Richieste in
   attesa". Un canale realtime sugli INSERT di campaign_join_requests (RLS
   "richieste: richiedente o narratore" già in vigore anche qui: arrivano
   solo le richieste delle proprie campagne) apre un pop-up con Conferma/
   Rifiuta nell'istante in cui il giocatore la manda, indipendentemente dalla
   schermata su cui si trova il Narratore in quel momento. */
let narratoreRealtimeChannel = null;
// Vero SOLO durante l'attesa di currentCloudSession() qui sotto: senza,
// due chiamate ravvicinate (renderHomeIdentityBox è richiamata da 8 punti
// diversi, incluso ogni evento onAuthStateChange — un INITIAL_SESSION
// seguito a ruota da un SIGNED_IN è normale) superano ENTRAMBE il guard
// "if (narratoreRealtimeChannel) return" perché nessuna delle due lo ha
// ancora valorizzato, creando due canali realtime distinti: quello vecchio
// resta orfano (mai un removeChannel), i suoi eventi continuano ad arrivare
// insieme a quelli del nuovo — bug reale riprodotto (sb.channel chiamata 2
// volte) forzando un ritardo su currentCloudSession().
let narratoreRealtimeStarting = false;
// Token di generazione: incrementato ad OGNI stop, mai solo quando esiste
// già un canale. Senza, questa sequenza creava un canale orfano che nessuno
// stop successivo poteva più fermare: (1) start() entra nell'attesa di
// currentCloudSession(); (2) prima che risolva, arriva uno stop() per
// logout/cambio sessione — narratoreRealtimeChannel è ancora null, quindi
// stop() non ha nulla da rimuovere e tornava subito senza lasciare traccia
// di essere mai stato chiamato; (3) la Promise di currentCloudSession() si
// risolve DOPO, magari con la vecchia sessione ancora valida (una race
// tipica: la chiamata di rete era partita PRIMA del logout); (4) start()
// non aveva alcun modo di sapere che nel frattempo era arrivato uno stop,
// e creava comunque il canale. Ogni start() cattura l'epoch corrente prima
// di attendere; se al risveglio l'epoch è cambiato, uno stop è intervenuto
// nel frattempo e la creazione va abortita, indipendentemente dal fatto che
// stop() avesse trovato o no un canale già esistente da rimuovere.
let narratoreRealtimeEpoch = 0;
let joinRequestQueue = [];
let joinRequestPopupBusy = false;

/* Stesso canale, due eventi in più aggiunti in seguito (non più solo
   "narratore"): combat_start_requests avvisa il Narratore quando un
   giocatore chiede di iniziare un combattimento ("Attacco" in scheda,
   vedi request_combat_start), combat_participants avvisa QUALUNQUE
   giocatore quando un proprio personaggio viene messo in scena in un
   combattimento — dovunque si trovi nell'app in quel momento, non solo
   quando ha già aperto il tabellone. Un solo canale per sessione invece di
   uno per funzionalità: stesso costo di sottoscrizione, meno codice. */
async function startNarratoreRealtimeWatch() {
  if (narratoreRealtimeChannel || narratoreRealtimeStarting) return; // già attivo o già in corso
  const myEpoch = narratoreRealtimeEpoch;
  narratoreRealtimeStarting = true;
  try {
    const session = await currentCloudSession();
    // uno stop() è intervenuto mentre questa chiamata era in attesa
    // (logout, cambio sessione): la sessione appena letta può anche essere
    // ancora valida, ma non è più quella che questo avvio deve rispettare.
    if (myEpoch !== narratoreRealtimeEpoch) return;
    if (!session || isGuestUser(session)) return;
    // una chiamata concorrente può aver già completato la sottoscrizione
    // mentre questa attendeva currentCloudSession(): ricontrollato dopo
    // l'unico await della funzione, non serve altro.
    if (narratoreRealtimeChannel) return;
    narratoreRealtimeChannel = sb.channel('narratore-join-requests')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'campaign_join_requests' },
        payload => handleNewJoinRequestRealtime(payload.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'narrator_role_requests' },
        payload => handleNewNarratorRoleRequestRealtime(payload.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'combat_start_requests' },
        payload => handleNewCombatStartRequestRealtime(payload.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'combat_participants' },
        payload => handleNewCombatParticipantRealtime(payload.new))
      .subscribe();
  } finally {
    narratoreRealtimeStarting = false;
  }
}
function stopNarratoreRealtimeWatch() {
  narratoreRealtimeEpoch++; // invalida ogni avvio in corso, anche senza un canale da rimuovere
  if (!narratoreRealtimeChannel) return;
  sb.removeChannel(narratoreRealtimeChannel);
  narratoreRealtimeChannel = null;
}
async function handleNewJoinRequestRealtime(row) {
  if (!row || row.status !== 'pending') return;
  // La RLS di campaign_join_requests lascia vedere una riga anche a CHI
  // l'ha mandata (requested_by = auth.uid()), non solo al Narratore
  // (is_campaign_master): senza questo controllo, chiunque avesse questo
  // canale attivo (qualunque account permanente, non solo un Narratore)
  // si vedeva comparire il popup "Nuova richiesta di ingresso" per la
  // PROPRIA richiesta appena inviata, come se dovesse approvare se stesso.
  try {
    const session = await currentCloudSession();
    if (session && row.requested_by === session.user.id) return;
  } catch (e) { /* se non verificabile, meglio comunque mostrare il popup che nasconderlo a un vero Narratore */ }
  try {
    const [charRes, campRes, names] = await Promise.all([
      sb.from('characters').select('name').eq('id', row.character_id).single(),
      sb.from('campaigns').select('name').eq('id', row.campaign_id).single(),
      fetchDisplayNames([row.requested_by])
    ]);
    joinRequestQueue.push({
      id: row.id,
      characterName: (charRes.data && charRes.data.name) || 'un personaggio',
      campaignName: (campRes.data && campRes.data.name) || 'una tua storia',
      playerName: names[row.requested_by] || 'Un avventuriero'
    });
    showNextJoinRequestPopup();
  } catch (e) { /* niente pop-up stavolta: la richiesta resta comunque visibile in Account -> Richieste in attesa */ }
}
/* Solo un admin riceve questo evento (la RLS "richieste ruolo: richiedente
   o admin" filtra già a livello di Realtime), tranne quando è l'admin
   stesso a mandare la propria richiesta — caso limite ma va comunque
   escluso, stesso motivo di handleNewJoinRequestRealtime. Niente coda di
   pop-up dedicata: un toast + refresh del pannello bastano, è un evento
   raro rispetto alle richieste di ingresso in campagna. */
async function handleNewNarratorRoleRequestRealtime(row) {
  if (!row || row.status !== 'pending') return;
  try {
    const session = await currentCloudSession();
    if (session && row.requested_by === session.user.id) return;
  } catch (e) { /* mostriamo comunque: se non siamo admin la riga non sarebbe arrivata */ }
  toast('Nuova richiesta di ruolo Narratore in attesa di approvazione');
  if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
}
function showNextJoinRequestPopup() {
  const popup = $('#join-request-popup');
  if (!popup || joinRequestPopupBusy || !joinRequestQueue.length) return;
  const req = joinRequestQueue[0];
  joinRequestPopupBusy = true;
  $('#join-request-popup-text').textContent =
    `${req.playerName} chiede di far entrare «${req.characterName}» in «${req.campaignName}».`;
  popup.dataset.requestId = req.id;
  popup.classList.remove('hidden');
}
function closeJoinRequestPopup() {
  joinRequestQueue.shift();
  joinRequestPopupBusy = false;
  const popup = $('#join-request-popup');
  if (popup) popup.classList.add('hidden');
  showNextJoinRequestPopup();
}

/* ------------------------------------------- richiesta "Attacco" (Narratore) */

let combatStartRequestQueue = [];
let combatStartRequestPopupBusy = false;

async function handleNewCombatStartRequestRealtime(row) {
  if (!row || row.status !== 'pending') return;
  // La RLS "richieste combattimento: richiedente o narratore" filtra già a
  // livello di Realtime: questo evento arriva solo a chi è narratore della
  // campagna (o al richiedente stesso, da escludere qui sotto), stesso
  // schema di handleNewJoinRequestRealtime.
  try {
    const session = await currentCloudSession();
    if (session && row.requested_by === session.user.id) return;
  } catch (e) { /* se non verificabile, meglio comunque mostrare il popup che nasconderlo a un vero Narratore */ }
  try {
    const [charRes, campRes] = await Promise.all([
      sb.from('characters').select('name').eq('id', row.character_id).single(),
      sb.from('campaigns').select('name').eq('id', row.campaign_id).single()
    ]);
    combatStartRequestQueue.push({
      id: row.id,
      campaignId: row.campaign_id,
      characterName: (charRes.data && charRes.data.name) || 'un personaggio',
      campaignName: (campRes.data && campRes.data.name) || 'una tua storia',
      note: row.note || ''
    });
    showNextCombatStartRequestPopup();
  } catch (e) { /* niente pop-up stavolta: la richiesta resta comunque nella tabella per un giro successivo */ }
}
function showNextCombatStartRequestPopup() {
  const popup = $('#combat-request-popup');
  if (!popup || combatStartRequestPopupBusy || !combatStartRequestQueue.length) return;
  const req = combatStartRequestQueue[0];
  combatStartRequestPopupBusy = true;
  $('#combat-request-popup-text').textContent =
    `«${req.characterName}» chiede di iniziare un combattimento in «${req.campaignName}»` +
    (req.note ? `: ${req.note}` : '.');
  popup.dataset.requestId = req.id;
  popup.dataset.campaignId = req.campaignId;
  popup.classList.remove('hidden');
}
function closeCombatStartRequestPopup() {
  combatStartRequestQueue.shift();
  combatStartRequestPopupBusy = false;
  const popup = $('#combat-request-popup');
  if (popup) popup.classList.add('hidden');
  showNextCombatStartRequestPopup();
}

/* ------------------------------------------- chiamata in combattimento (giocatore) */

/* Quando il Narratore struttura un combattimento (accettando una richiesta
   "Attacco", o mettendo in scena un personaggio a mano dal pannello
   "Gestisci scena") il proprietario di quel personaggio deve saperlo
   subito e poter saltare direttamente nella sezione Combattimento,
   qualunque schermata stia guardando in quel momento — stesso principio
   del pop-up di richiesta d'ingresso, in direzione opposta. */
let combatCallQueue = [];
let combatCallPopupBusy = false;

async function handleNewCombatParticipantRealtime(row) {
  if (!row || !row.character_id || !row.encounter_id) return;
  // già dentro esattamente quel combattimento: l'aggiornamento arriva già
  // in tempo reale sulla board (vedi startCombatRealtimeWatch), niente
  // pop-up che interromperebbe chi lo sta già guardando.
  if (typeof combatViewEncounterId !== 'undefined' && combatViewEncounterId === row.encounter_id
    && !$('#view-combat').classList.contains('hidden')) return;
  try {
    const session = await currentCloudSession();
    if (!session) return;
    const [charRes, encRes] = await Promise.all([
      sb.from('characters').select('name, owner_user_id').eq('id', row.character_id).single(),
      sb.from('combat_encounters').select('campaign_id').eq('id', row.encounter_id).single()
    ]);
    if (!charRes.data || charRes.data.owner_user_id !== session.user.id) return; // non un mio personaggio
    if (!encRes.data) return;
    const campRes = await sb.from('campaigns').select('name').eq('id', encRes.data.campaign_id).single();
    combatCallQueue.push({
      campaignId: encRes.data.campaign_id,
      campaignName: (campRes.data && campRes.data.name) || 'una tua storia',
      characterName: charRes.data.name || 'il tuo personaggio'
    });
    showNextCombatCallPopup();
  } catch (e) { /* niente pop-up stavolta: il giocatore trova comunque il combattimento aprendo la storia */ }
}
function showNextCombatCallPopup() {
  const popup = $('#combat-call-popup');
  if (!popup || combatCallPopupBusy || !combatCallQueue.length) return;
  const call = combatCallQueue[0];
  combatCallPopupBusy = true;
  $('#combat-call-popup-text').textContent =
    `Il Narratore ha chiamato «${call.characterName}» in combattimento, in «${call.campaignName}»!`;
  popup.dataset.campaignId = call.campaignId;
  popup.classList.remove('hidden');
}
function closeCombatCallPopup() {
  combatCallQueue.shift();
  combatCallPopupBusy = false;
  const popup = $('#combat-call-popup');
  if (popup) popup.classList.add('hidden');
  showNextCombatCallPopup();
}

/* Identità dell'account (accesso/registrazione se non connesso, o stato +
   nickname + uscita se già connesso): vive in copertina, non più in
   Account, così è la prima cosa che si vede aprendo l'app — la sezione
   Account resta così libera per la sola scelta del ruolo. */
async function renderHomeIdentityBox() {
  const box = $('#home-status-box');
  if (!box) return;
  // Niente più "Verifica in corso..." come primo stato: currentCloudSession()
  // legge quasi sempre la sessione salvata in locale (nessuna rete, se non
  // scaduta) — è solo getAuthCapabilities() (sapere se Google/Apple sono
  // attivi) a dipendere davvero dalla rete, ed è rilevante SOLO per il
  // modulo di accesso quando non c'è ancora nessuna sessione. Separandoli:
  // la modalità locale/ospite si vede da subito, la rete non blocca più
  // nulla — se cade o è lenta il modulo resta comunque lì, pienamente
  // utilizzabile (accesso/registrazione provano comunque, falliranno con un
  // messaggio chiaro se davvero non c'è connessione).
  const noCaps = { google: false, apple: false, passkey: false };
  let session;
  try {
    session = await currentCloudSession();
  } catch (e) {
    box.innerHTML = accountStatusHtml(null, noCaps, null);
    return;
  }
  let profile = null;
  if (session && !pendingPasswordRecovery) {
    try { profile = await getMyProfile(session.user.id); } catch (e) { /* nickname non essenziale: il campo resta vuoto */ }
  }
  box.innerHTML = accountStatusHtml(session, noCaps, profile);
  startNarratoreRealtimeWatch();
  if (typeof renderMyCampaignsBox === 'function') renderMyCampaignsBox();
  refreshMyEntitlements();
  // Pulsanti Google/Apple: si aggiungono solo se davvero attivi, un istante
  // dopo — mai a costo di far aspettare tutto il resto, e mai riscrivendo
  // il modulo se l'utente ha già iniziato a compilarlo (vedi sotto).
  if (!session) {
    try {
      const caps = await getAuthCapabilities();
      const emailField = $('#acc-email');
      const passwordField = $('#acc-password');
      const untouched = (!emailField || !emailField.value) && (!passwordField || !passwordField.value);
      if ((caps.google || caps.apple) && untouched) box.innerHTML = accountStatusHtml(session, caps, profile);
    } catch (e) { /* Google/Apple restano nascosti: nessun problema, si accede comunque con email+password */ }
  }
}

/* "Le tue campagne" (creazione + elenco, campaignsBoxHtml) non vive più
   qui: si è spostata direttamente in copertina (#view-cover,
   #list-campaigns-wrap, subito sotto il modulo di accesso), sempre
   visibile per un account Narratore/admin anche a zero campagne e senza
   dover navigare da nessuna parte — vedi renderMyCampaignsBox, richiamata
   da renderHomeIdentityBox ad ogni verifica/cambio di sessione (stesso
   punto che già disegna il modulo di accesso, quindi sempre coerente con
   esso). L'elemento #account-campaigns-box resta lo stesso nodo
   indipendentemente da quale vista lo contiene, quindi tutta la delega di
   eventi già esistente su di esso (wireCloudAccountEvents) continua a
   funzionare senza modifiche. */
async function renderAccountArea() {
  const trashBox = $('#account-trash-box');
  const identityBox = $('#account-identity-controls');
  // Dato solo locale, nessuna rete: non deve aspettare le chiamate cloud qui sotto.
  renderPlayerStoriesBox();

  let session;
  try {
    session = await currentCloudSession();
  } catch (e) {
    if (trashBox) trashBox.innerHTML = trashBoxHtml(null, null);
    if (identityBox) identityBox.innerHTML = '<p class="helper-text" style="margin:0;">Impossibile verificare l\'account.</p>';
    renderNarratorRequestsBox(null);
    renderPlayerStoriesBox();
    return;
  }

  let accountRole = 'player';
  if (identityBox) {
    if (session && !isGuestUser(session)) {
      let profile = null;
      try { profile = await getMyProfile(session.user.id); } catch (e) { /* nickname non essenziale: il campo resta vuoto */ }
      accountRole = (profile && profile.account_role) || 'player';
      identityBox.innerHTML = accountIdentityControlsHtml(profile);
    } else {
      identityBox.innerHTML = '<p class="helper-text" style="margin:0;">Accedi dalla copertina per modificare il nickname o uscire dall\'account.</p>';
    }
  }

  if (session && !isGuestUser(session)) {
    if (trashBox) {
      try {
        const trashed = (accountRole === 'narrator' || accountRole === 'admin') ? await listTrashedCampaigns() : [];
        trashBox.innerHTML = trashBoxHtml(session, trashed);
      } catch (e) {
        trashBox.innerHTML = `<p class="helper-text" style="margin:0;">Errore nel caricare il cestino: ${escapeHtml(describeError(e))}</p>`;
      }
    }
  } else {
    if (trashBox) trashBox.innerHTML = trashBoxHtml(session, null);
  }

  await renderNarratorCtaBox(session, accountRole);
  renderNarratorRequestsBox(accountRole);
  renderPlayerStoriesBox();
}

/* "Diventa Narratore": unico punto rimasto (dopo lo spostamento di "Le tue
   campagne" in copertina) in cui un account 'player' può attivare il
   ruolo — visibile solo per lui, invisibile per un account già
   Narratore/admin (che la vede già in copertina, nessun bisogno di
   ripeterla qui). */
function renderNarratorCtaBox(session, accountRole) {
  const wrap = $('#account-narrator-cta-wrap');
  const box = $('#account-narrator-cta-box');
  if (!wrap || !box) return;
  if (!session || isGuestUser(session) || accountRole === 'narrator' || accountRole === 'admin') {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  box.innerHTML = narratorRoleRequestHtml();
}

/* "Le tue campagne": voce di menu dedicata ("Le tue storie", nel menù a
   tendina di copertina, sopra "I tuoi personaggi") che apre #view-campaigns
   con l'elenco/creazione campagne (campaignsBoxHtml). La voce di menu è
   sempre nascosta per un account 'player' semplice o non connesso — solo
   Narratore/admin la vede comparire. Richiamata da renderHomeIdentityBox
   ad ogni verifica/cambio di sessione (init, accesso, uscita, evento
   onAuthStateChange), così la voce di menu compare/scompare in sincronia
   col modulo di accesso, indipendentemente da quale vista sia aperta al
   momento; richiamata di nuovo all'apertura di #view-campaigns stessa
   (vedi il gestore di data-menu-nav="campaigns") per un contenuto fresco. */
async function renderMyCampaignsBox() {
  const menuItem = $('#cm-item-campaigns');
  if (!menuItem) return;
  let session;
  try { session = await currentCloudSession(); } catch (e) { menuItem.classList.add('hidden'); return; }
  if (!session || isGuestUser(session)) { menuItem.classList.add('hidden'); return; }
  let accountRole = 'player';
  try {
    const profile = await getMyProfile(session.user.id);
    accountRole = (profile && profile.account_role) || 'player';
  } catch (e) { /* ruolo non verificabile: meglio nascondere che mostrare a torto */ menuItem.classList.add('hidden'); return; }
  if (accountRole !== 'narrator' && accountRole !== 'admin') { menuItem.classList.add('hidden'); return; }
  menuItem.classList.remove('hidden');
  const box = $('#account-campaigns-box');
  if (!box) return;
  pendingNewCampaignIcon = null;
  try {
    const campaigns = await listMyCampaigns();
    box.innerHTML = campaignsBoxHtml(session, campaigns, accountRole);
  } catch (e) {
    box.innerHTML = `<p class="helper-text" style="margin:0;">Errore nel caricare le storie: ${escapeHtml(describeError(e))}</p>`;
  }
}

/* Pannello "Richieste ruolo Narratore": visibile solo agli admin. Da quando
   il ruolo è un acquisto self-service (purchaseNarratorRole, non passa più
   da qui), non arriveranno più nuove richieste — il pannello resta solo
   come infrastruttura dormiente (narrator_role_requests/approve/reject non
   sono state rimosse) nel caso serva ancora smaltire righe pending storiche. */
async function renderNarratorRequestsBox(accountRole) {
  const wrap = $('#account-narrator-requests-wrap');
  const box = $('#account-narrator-requests-box');
  if (!wrap || !box) return;
  if (accountRole !== 'admin') { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  box.innerHTML = '<p class="helper-text" style="margin:0;">Verifica in corso…</p>';
  try {
    const pending = await listPendingNarratorRoleRequests();
    box.innerHTML = pending.length
      ? pending.map(r => `<div class="row-between" data-narratorreqrow="${r.id}" style="padding:4px 0;flex-wrap:wrap;gap:6px;">
          <span>${escapeHtml(r.display_name)}</span>
          <span style="display:flex;gap:6px;">
            <button type="button" class="btn btn-sm btn-primary" data-approvenarratorreq="${r.id}">✓ Approva</button>
            <button type="button" class="btn btn-sm btn-ghost" data-rejectnarratorreq="${r.id}">✕ Rifiuta</button>
          </span>
        </div>`).join('')
      : '<p class="helper-text" style="margin:0;">Nessuna richiesta in attesa.</p>';
  } catch (e) {
    box.innerHTML = `<p class="helper-text" style="margin:0;">Errore: ${escapeHtml(describeError(e))}</p>`;
  }
}

/* Sezione "Giocatore": storie a cui i propri personaggi hanno gia' chiesto
   di entrare o di cui gia' fanno parte (anche gia' caricate), non solo la
   possibilita' di cercarne una nuova — dato locale, nessuna chiamata di rete. */
function renderPlayerStoriesBox() {
  const box = $('#account-giocatore-stories');
  if (!box) return;
  if (!characters.length) {
    box.innerHTML = '<p class="helper-text" style="margin:0;">Non hai ancora personaggi.</p>';
    return;
  }
  box.innerHTML = characters.map(c => {
    let status;
    let canReadPremise = false;
    let canOpenCombat = false;
    if (c.cloudCampaignId && c.cloudCampaignTrashedAt) {
      status = `«${escapeHtml(c.cloudCampaignName || c.cloudJoinCampaignName || '')}» — eliminata dal Narratore, nel cestino`;
    } else if (c.cloudCampaignId) {
      status = `«${escapeHtml(c.cloudCampaignName || c.cloudJoinCampaignName || 'storia')}» — in gioco (Lv ${c.livello || 1})`;
      canReadPremise = !!c.cloudCampaignPremisePublished;
      canOpenCombat = true;
    } else if (c.cloudJoinRequestId) {
      status = `«${escapeHtml(c.cloudJoinCampaignName || 'storia')}» — in attesa di conferma del Narratore`;
    } else {
      status = 'Nessuna storia — apri la scheda, tab Identità, per entrare in una';
    }
    return `<div class="row-between" data-openchar="${c.id}" style="cursor:pointer;padding:4px 0;flex-wrap:wrap;gap:6px;">
      <span>${escapeHtml(c.nome || 'Senza nome')}</span>
      <span style="display:flex;align-items:center;gap:8px;">
        <span class="helper-text" style="margin:0;text-align:right;">${status}</span>
        ${canReadPremise ? `<button type="button" class="btn btn-ghost btn-sm" data-readpremise="${c.id}" title="Leggi la premessa senza aprire la scheda">📖 Premessa</button>` : ''}
        ${canOpenCombat ? `<button type="button" class="btn btn-ghost btn-sm" data-opencombatfor="${c.cloudCampaignId}" title="Vai al tabellone di combattimento">⚔ Combattimento</button>` : ''}
      </span>
    </div>`;
  }).join('');
}

/* "Previously on": riassunti pubblicati dal Narratore per il personaggio
   attivo, letti dalla sua campagna in cloud (se ne fa parte). Sola lettura
   per il giocatore: modifica/eliminazione restano riservate al Narratore
   dal suo Account (vedi campaignSessionLogsHtml). */
function previouslyOnEntryHtml(l) {
  return `<div class="box" style="margin-top:10px;"><div class="box-bar"></div><div class="box-pad" style="display:flex;flex-direction:column;gap:6px;">
    <strong>E${String(l.episode).padStart(2, '0')} S${String(l.season).padStart(2, '0')}${l.title ? ' — ' + escapeHtml(l.title) : ''}</strong>
    <p style="white-space:pre-wrap;margin:0;">${escapeHtml(l.body)}</p>
    <p class="helper-text" style="margin:0;">${new Date(l.created_at).toLocaleDateString('it-IT')}</p>
  </div></div>`;
}
async function renderPreviouslyOnView() {
  const box = $('#previously-body');
  if (!box) return;
  const c = getActive();
  if (!c || !c.cloudCampaignId) {
    box.innerHTML = '<p class="helper-text" style="margin:0;">Il personaggio attivo non fa parte di nessuna storia in cloud: qui compariranno i riassunti pubblicati dal Narratore quando entrerà in una campagna.</p>';
    return;
  }
  box.innerHTML = '<p class="helper-text" style="margin:0;">Verifica in corso…</p>';
  try {
    const logs = await listSessionLogs(c.cloudCampaignId);
    const storyName = c.cloudJoinCampaignName || c.cloudCampaignName || 'questa storia';
    box.innerHTML = `
      <p class="helper-text">Riassunti pubblicati dal Narratore di «${escapeHtml(storyName)}», per ricordare cosa è successo prima di ricominciare a giocare.</p>
      ${logs.length ? logs.map(previouslyOnEntryHtml).join('') : '<p class="helper-text" style="margin:0;">Il Narratore non ha ancora pubblicato nessun riassunto.</p>'}
    `;
  } catch (e) {
    box.innerHTML = `<p class="helper-text" style="margin:0;">Errore: ${escapeHtml(describeError(e))}</p>`;
  }
}

function wireCloudAccountEvents() {
  $('#account-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-accmode]');
    if (!btn) return;
    $$('#account-mode-toggle .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    $('#account-mode-narratore').classList.toggle('active', btn.dataset.accmode === 'narratore');
    $('#account-mode-giocatore').classList.toggle('active', btn.dataset.accmode === 'giocatore');
  });

  $('#account-mode-giocatore').addEventListener('click', async e => {
    if (e.target.id === 'acc-goto-new-char') { createCharacterFlow(); return; }
    if (e.target.id === 'acc-goto-char-list') { renderCharList(); showView('list'); return; }
    const readBtn = e.target.closest('[data-readpremise]');
    if (readBtn) {
      const c = characters.find(x => x.id === readBtn.dataset.readpremise);
      if (!c || !c.cloudCampaignId) return;
      try {
        const bytes = await downloadCampaignPremiseBytes(c.cloudCampaignId);
        const title = c.cloudCampaignPremiseTitle || c.cloudJoinCampaignName || 'Premessa';
        if (window.MSPdfViewer) window.MSPdfViewer.open({ bytes, title, label: c.nome || 'Giocatore' });
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    const combatBtn = e.target.closest('[data-opencombatfor]');
    if (combatBtn) { openCombatView(combatBtn.dataset.opencombatfor); return; }
    const row = e.target.closest('[data-openchar]');
    if (row) { openCharacter(row.dataset.openchar); showTab('identita'); return; }
  });

  $('#home-status-box').addEventListener('click', async e => {
    const emailInput = $('#acc-email');
    const passwordInput = $('#acc-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';

    if (e.target.dataset.authmode) {
      $$('#acc-authmode-toggle .tab-btn').forEach(b => b.classList.toggle('active', b === e.target));
      const mode = e.target.dataset.authmode;
      const submitBtn = $('#acc-submit-auth');
      submitBtn.dataset.mode = mode;
      submitBtn.textContent = mode === 'signup' ? 'Registrati' : 'Accedi';
      return;
    }
    if (e.target.id === 'acc-submit-auth') {
      if (!email || !password) { toast('Inserisci email e password'); return; }
      try {
        if (e.target.dataset.mode === 'signup') {
          const session = await signUpWithPassword(email, password);
          if (!session) {
            // Nessuna sessione: e' l'esito normale ora che la conferma via
            // email e' obbligatoria (SMTP dedicato, niente piu'
            // auto-conferma) — l'account esiste gia' ma resta inattivo
            // finche' non si apre il link ricevuto (vedi
            // pendingSignupConfirmation/onAuthStateChange piu' sotto).
            toast(`Ti abbiamo inviato un'email a ${email}: apri il link per confermare e attivare l'account.`);
            return;
          }
          toast('Account creato e connesso');
        } else {
          await signInWithPassword(email, password);
          toast('Accesso effettuato');
        }
        maybeStoreCredential(email, password);
        renderHomeIdentityBox();
      } catch (err) {
        if (/already registered|already exists/i.test(rawErrorMessage(err))) {
          toast('Esiste già un account con questa email. Usa "Accedi", oppure "Password dimenticata" se non hai mai impostato una password.');
        } else if (/invalid login credentials/i.test(rawErrorMessage(err))) {
          toast('Email o password errati. Se ti eri registrato prima con il link via email, non hai ancora una password: usa "Password dimenticata" per impostarne una.');
        } else if (err && err.status >= 500) {
          toast('Il server di invio email non è al momento disponibile. Riprova più tardi o contatta il Narratore.');
        } else {
          toast('Errore: ' + describeError(err));
        }
      }
      return;
    }
    if (e.target.id === 'acc-forgot-password') {
      e.preventDefault();
      if (!email) { toast('Inserisci prima la tua email'); return; }
      try {
        await sendPasswordReset(email);
        pendingRecoveryEmail = email;
        renderHomeIdentityBox();
      } catch (err) {
        if (err && err.status >= 500) {
          toast('Il server di invio email non è al momento disponibile. Riprova più tardi o contatta il Narratore.');
        } else {
          toast('Errore: ' + describeError(err));
        }
      }
      return;
    }
    if (e.target.id === 'acc-recovery-code-cancel') {
      e.preventDefault();
      pendingRecoveryEmail = null;
      renderHomeIdentityBox();
      return;
    }
    if (e.target.id === 'acc-verify-recovery-code') {
      const code = ($('#acc-recovery-code') || {}).value || '';
      if (!code.trim()) { toast('Inserisci il codice ricevuto via email'); return; }
      try {
        await verifyRecoveryCode(pendingRecoveryEmail, code.trim());
        renderHomeIdentityBox();
      } catch (err) {
        toast(/expired|invalid/i.test(rawErrorMessage(err)) ? 'Codice errato o scaduto: richiedine uno nuovo con "Password dimenticata"' : 'Errore: ' + describeError(err));
      }
      return;
    }
    if (e.target.id === 'acc-set-new-password') {
      const newPasswordInput = $('#acc-new-password');
      const newPassword = newPasswordInput ? newPasswordInput.value : '';
      if (!newPassword || newPassword.length < 6) { toast('La password deve avere almeno 6 caratteri'); return; }
      try {
        await setNewPassword(newPassword);
        toast('Nuova password impostata: ora sei connesso');
        const recoveryEmail = $('#acc-recovery-email');
        maybeStoreCredential(recoveryEmail ? recoveryEmail.value : '', newPassword);
        renderHomeIdentityBox();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'acc-save-nickname') {
      const nicknameInput = $('#acc-nickname');
      const nickname = nicknameInput ? nicknameInput.value : '';
      try {
        await updateMyDisplayName(nickname);
        toast('Nickname salvato');
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'acc-upgrade') {
      if (!email || !password) { toast('Inserisci email e password'); return; }
      try {
        await upgradeGuestWithEmail(email, password);
        toast('Controlla la tua email per confermare e rendere permanente l\'account');
        maybeStoreCredential(email, password);
      } catch (err) {
        if (err && err.status >= 500) {
          toast('Il server di invio email non è al momento disponibile. Riprova più tardi o contatta il Narratore.');
        } else {
          toast('Errore: ' + describeError(err));
        }
      }
      return;
    }
    if (e.target.id === 'acc-google') {
      signInWithProvider('google').catch(err => toast('Errore: ' + describeError(err)));
      return;
    }
    if (e.target.id === 'acc-apple') {
      signInWithProvider('apple').catch(err => toast('Errore: ' + describeError(err)));
      return;
    }
  });
  // I bottoni "Accedi"/"Registrati"/"Salva nuova password"/"Rendi permanente"
  // sono ora dentro un <form> (serve perché Chrome/Google Password Manager
  // offra di salvare la password, vedi accountStatusHtml): senza intercettare
  // il "submit", il browser ricaricherebbe la pagina inviandolo per davvero.
  // La logica vera resta tutta nel listener "click" sopra, invariata.
  $('#home-status-box').addEventListener('submit', e => e.preventDefault());

  // ---- nickname/uscita per un account permanente: sezione Account, non più
  // in copertina (vedi accountIdentityControlsHtml) ----
  $('#account-identity-controls').addEventListener('click', async e => {
    if (e.target.id === 'acc-save-nickname') {
      const nicknameInput = $('#acc-nickname');
      const nickname = nicknameInput ? nicknameInput.value : '';
      try {
        await updateMyDisplayName(nickname);
        toast('Nickname salvato');
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'acc-signout') {
      stopNarratoreRealtimeWatch();
      await signOutCloud();
      toast('Disconnesso');
      // azzera subito l'account attivo usato per filtrare "I tuoi
      // personaggi" (vedi visibleCharacters/currentSessionUserId in
      // app.js): senza, l'elenco resterebbe filtrato sul vecchio account
      // finché non si naviga altrove e si ritorna
      if (typeof renderCharList === 'function') renderCharList();
      renderAccountArea();
      renderHomeIdentityBox();
      return;
    }
  });

  // ---- pop-up realtime "nuova richiesta di ingresso" (Narratore) ----
  $('#join-request-popup').addEventListener('click', async e => {
    const popup = $('#join-request-popup');
    const id = popup.dataset.requestId;
    if (e.target.id === 'join-request-confirm') {
      try {
        await approveJoinRequestCloud(id);
        toast('Richiesta accettata');
        if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      closeJoinRequestPopup();
      return;
    }
    if (e.target.id === 'join-request-reject') {
      try {
        await rejectJoinRequestCloud(id);
        toast('Richiesta rifiutata');
        if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      closeJoinRequestPopup();
      return;
    }
  });

  // ---- pop-up realtime "richiesta di combattimento" (Narratore) ----
  $('#combat-request-popup').addEventListener('click', async e => {
    const popup = $('#combat-request-popup');
    const id = popup.dataset.requestId;
    const campaignId = popup.dataset.campaignId;
    if (e.target.id === 'combat-request-accept') {
      try {
        const result = await acceptCombatStart(id);
        toast('Combattimento avviato');
        openCombatView(result.campaignId || campaignId, true);
      } catch (err) { toast('Errore: ' + describeError(err)); }
      closeCombatStartRequestPopup();
      return;
    }
    if (e.target.id === 'combat-request-decline') {
      try { await declineCombatStart(id); } catch (err) { toast('Errore: ' + describeError(err)); }
      closeCombatStartRequestPopup();
      return;
    }
  });

  // ---- pop-up realtime "chiamata in combattimento" (giocatore) ----
  $('#combat-call-popup').addEventListener('click', e => {
    const popup = $('#combat-call-popup');
    const campaignId = popup.dataset.campaignId;
    if (e.target.id === 'combat-call-go') {
      closeCombatCallPopup();
      if (campaignId) openCombatView(campaignId);
      return;
    }
    if (e.target.id === 'combat-call-dismiss') {
      closeCombatCallPopup();
      return;
    }
  });

  $('#account-narrator-cta-box').addEventListener('click', async e => {
    if (e.target.id === 'acc-request-narrator') {
      try {
        await purchaseNarratorRole();
        toast('Ruolo Narratore attivato');
        renderAccountArea();
        if (typeof renderMyCampaignsBox === 'function') renderMyCampaignsBox();
        refreshMyEntitlements();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });

  // ---- "Le tue storie": solo creazione + elenco card (il dettaglio di
  // ogni storia vive tutto in #view-campaignsheet, vedi sotto) ----
  $('#account-campaigns-box').addEventListener('click', async e => {
    if (e.target.id === 'acc-create-campaign') {
      const nameInput = $('#acc-new-campaign-name');
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) { toast('Dai un nome alla storia'); return; }
      const fileInput = $('#acc-new-campaign-premise-input');
      const file = fileInput && fileInput.files[0];
      const titleInput = $('#acc-new-campaign-premise-title');
      const title = titleInput ? titleInput.value.trim() : '';
      const publishNow = !!($('#acc-new-campaign-premise-publish') && $('#acc-new-campaign-premise-publish').checked);
      const listedNow = !!($('#acc-new-campaign-listed') && $('#acc-new-campaign-listed').checked);
      // Blocco 3: stesso controllo che il server applica comunque alla
      // scrittura reale (trg_enforce_active_story_limit) — qui solo per
      // evitare un giro a vuoto quando il limite è già raggiunto.
      const ent = window.myEntitlements;
      if (ent && ent.max_active_stories !== null && ent.max_active_stories !== undefined
          && (ent.current_active_stories || 0) >= ent.max_active_stories) {
        showLimitReachedNotice('storie');
        return;
      }
      try {
        const campaign = await createCampaign(name, pendingNewCampaignIcon);
        if (file) {
          await uploadCampaignPremise(campaign.id, file, title);
          if (publishNow) await setCampaignPremisePublished(campaign.id, true);
        }
        if (listedNow) await setCampaignListed(campaign.id, true);
        toast(file ? 'Storia creata con premessa' : 'Storia creata');
        renderMyCampaignsBox();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'acc-new-campaign-premise-upload') { $('#acc-new-campaign-premise-input').click(); return; }
    if (e.target.id === 'acc-new-campaign-icon-upload') { $('#acc-new-campaign-icon-input').click(); return; }
    const trashBtn = e.target.closest('[data-trashcampaign]');
    if (trashBtn) {
      e.stopPropagation();
      const campaignId = trashBtn.dataset.trashcampaign;
      const card = trashBtn.closest('.char-card');
      const campaignName = (card && card.dataset.campaignname) || 'questa campagna';
      if (await trashCampaignFlow(campaignId, campaignName)) renderMyCampaignsBox();
      return;
    }
    const card = e.target.closest('.char-card[data-campaignid]');
    if (card) { openCampaignSheet(card.dataset.campaignid); return; }
  });

  // ---- scheda a tutto schermo di una storia (#view-campaignsheet) ----
  $('#view-campaignsheet').addEventListener('click', async e => {
    const tabBtn = e.target.closest('[data-campshtab]');
    if (tabBtn) {
      $$('#campaign-sheet-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
      $$('#view-campaignsheet [data-camppanel]').forEach(p =>
        p.classList.toggle('active', p.dataset.camppanel === tabBtn.dataset.campshtab));
      return;
    }
    if (e.target.id === 'btn-open-npc-randomizer') { openNpcRandomizerModal(); return; }
    if (e.target.dataset.openassets) { openCampaignAssetsGallery(e.target.dataset.openassets); return; }
    if (e.target.dataset.iconupload) {
      const input = $(`[data-iconinput="${e.target.dataset.iconupload}"]`);
      if (input) input.click();
      return;
    }
    if (e.target.dataset.iconremove) {
      const campaignId = e.target.dataset.iconremove;
      if (!confirm('Rimuovere l\'icona della campagna?')) return;
      try { await setCampaignIcon(campaignId, null); toast('Icona rimossa'); renderCampaignSheet(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.premiseupload) {
      const input = $(`[data-premiseinput="${e.target.dataset.premiseupload}"]`);
      if (input) input.click();
      return;
    }
    if (e.target.dataset.premisepreview) {
      const campaignId = e.target.dataset.premisepreview;
      const title = activeCampaignSheetName || 'Premessa';
      try {
        const bytes = await downloadCampaignPremiseBytes(campaignId);
        if (window.MSPdfViewer) window.MSPdfViewer.open({ bytes, title, label: 'Narratore · ' + title });
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.premiseremove) {
      const campaignId = e.target.dataset.premiseremove;
      if (!confirm('Rimuovere il PDF della premessa? Se era pubblicata, i giocatori non la vedranno più.')) return;
      try {
        await removeCampaignPremise(campaignId);
        toast('Premessa rimossa');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.approve) {
      try { await approveJoinRequestCloud(e.target.dataset.approve); toast('Richiesta accettata'); renderCampaignSheet(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.reject) {
      try { await rejectJoinRequestCloud(e.target.dataset.reject); toast('Richiesta rifiutata'); renderCampaignSheet(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.acceptcombat) {
      try {
        const result = await acceptCombatStart(e.target.dataset.acceptcombat);
        toast('Combattimento avviato');
        await renderCampaignSheet();
        if (result && result.campaignId) openCombatView(result.campaignId, true);
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.declinecombat) {
      try { await declineCombatStart(e.target.dataset.declinecombat); toast('Richiesta rifiutata'); renderCampaignSheet(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.approvetrait) {
      try { await approveKnownTraitCloud(e.target.dataset.approvetrait); toast('Tratto approvato'); renderCampaignSheet(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.rejecttrait) {
      try { await rejectKnownTraitCloud(e.target.dataset.rejecttrait); toast('Tratto rifiutato'); renderCampaignSheet(); }
      catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.setlevel) {
      const charId = e.target.dataset.setlevel;
      const input = $(`[data-levelinput="${charId}"]`);
      const newLevel = Number(input.value);
      if (!newLevel || newLevel < 1 || newLevel > 20) { toast('Livello non valido (1-20)'); return; }
      try {
        await narratoreSetLevelCloud(charId, newLevel);
        toast(`Livello assegnato: Lv ${newLevel}`);
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.toggletraits) {
      const box = $(`[data-chartraits="${e.target.dataset.toggletraits}"]`);
      if (box) {
        box.classList.toggle('hidden');
        // Su una riga vicina al fondo di un elenco lungo (es. l'ultimo
        // personaggio della lista) il pannello che si apre finisce sotto lo
        // schermo senza scorrimento automatico: sembra che il bottone non
        // abbia fatto nulla. Stesso fix di data-togglereassign qui sotto.
        if (!box.classList.contains('hidden')) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }
    if (e.target.dataset.togglereassign) {
      const charId = e.target.dataset.togglereassign;
      const box = $(`[data-charreassign="${charId}"]`);
      if (!box) return;
      const wasHidden = box.classList.contains('hidden');
      box.classList.toggle('hidden');
      // Stesso motivo di data-toggletraits sopra: senza questo, aprire il
      // pannello su una riga in fondo alla lista (es. l'ultimo personaggio,
      // "Scilla/ HUMBLE" nella storia Icaro) non mostra alcun effetto
      // visibile — il pannello si apre comunque, solo fuori dallo schermo.
      if (wasHidden) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (wasHidden) {
        const ch = lastCampaignCharactersById[charId];
        const select = $(`[data-reassignselect="${charId}"]`);
        if (ch && select) {
          select.innerHTML = '<option value="">Caricamento…</option>';
          try {
            const members = await fetchCampaignMembersWithNames(ch.campaign_id || activeCampaignSheetId);
            const others = members.filter(m => m.userId !== ch.owner_user_id);
            select.innerHTML = others.length
              ? others.map(m => `<option value="${m.userId}">${escapeHtml(m.name)}</option>`).join('')
              : '<option value="">Nessun altro membro in questa campagna</option>';
          } catch (err) {
            select.innerHTML = `<option value="">Errore: ${escapeHtml(describeError(err))}</option>`;
          }
        }
      }
      return;
    }
    if (e.target.dataset.reassignconfirm) {
      const charId = e.target.dataset.reassignconfirm;
      const select = $(`[data-reassignselect="${charId}"]`);
      const newOwnerUserId = select ? select.value : '';
      if (!newOwnerUserId) { toast('Scegli a quale giocatore riassegnare il personaggio'); return; }
      try {
        await narratoreReassignCharacterOwnerCloud(charId, newOwnerUserId);
        toast('Personaggio riassegnato');
        await renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.opencharview) {
      e.preventDefault();
      const charId = e.target.dataset.opencharview;
      const ch = lastCampaignCharactersById[charId];
      if (!ch) { toast('Personaggio non trovato, riprova'); return; }
      openNarratoreCharacterView(ch, activeCampaignSheetId);
      return;
    }
    if (e.target.dataset.narratoredit) {
      const charId = e.target.dataset.narratoredit;
      const ch = lastCampaignCharactersById[charId];
      if (!ch) { toast('Personaggio non trovato, riprova'); return; }
      if (typeof openCharacterForNarratorEdit === 'function') openCharacterForNarratorEdit(ch);
      return;
    }
    if (e.target.dataset.traitgrant) {
      const [charId, listKey] = e.target.dataset.traitgrant.split('::');
      const input = $(`[data-traitgrantinput="${charId}::${listKey}"]`);
      const points = Math.floor(Number(input.value));
      if (!points || points <= 0) { toast('Inserisci un numero di punti positivo'); return; }
      try {
        await narratoreGrantTraitPointsCloud(charId, listKey, points);
        toast(`Concessi +${points} punti a ${TRAIT_LIST_LABELS[listKey]}`);
        await renderCampaignSheet();
        const box = $(`[data-chartraits="${charId}"]`);
        if (box) box.classList.remove('hidden');
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.traitcustom) {
      const [charId, listKey] = e.target.dataset.traitcustom.split('::');
      const name = prompt(`Nome del tratto (${TRAIT_LIST_LABELS[listKey]}):`);
      if (!name || !name.trim()) return;
      const valueStr = prompt('Valore del tratto:', '1');
      const value = Math.max(0, Math.floor(Number(valueStr)) || 0);
      try {
        await narratoreAddCustomTraitCloud(charId, listKey, name.trim(), value);
        toast(`Tratto "${name.trim()}" scritto sulla scheda`);
        await renderCampaignSheet();
        const box = $(`[data-chartraits="${charId}"]`);
        if (box) box.classList.remove('hidden');
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.toggletecab) {
      const box = $(`[data-chartecab="${e.target.dataset.toggletecab}"]`);
      if (box) {
        box.classList.toggle('hidden');
        if (!box.classList.contains('hidden')) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return;
    }
    if (e.target.dataset.tecabgrant) {
      const charId = e.target.dataset.tecabgrant;
      const tipoSel = $(`[data-tecabgranttipo="${charId}"]`);
      const reasonInput = $(`[data-tecabgrantreason="${charId}"]`);
      const tipo = tipoSel ? tipoSel.value : 'tecniche';
      const motivazione = reasonInput ? reasonInput.value.trim() : '';
      const tipoLabel = tipo === 'tecniche' ? 'una Tecnica' : "un'Abilità";
      try {
        await narratoreGrantTecabAssignmentCloud(charId, tipo, motivazione);
        toast(`Concesso: ${tipoLabel} in più`);
        await renderCampaignSheet();
        const box = $(`[data-chartecab="${charId}"]`);
        if (box) box.classList.remove('hidden');
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.togglesession) {
      const campaignId = e.target.dataset.togglesession;
      const currentlyActive = e.target.dataset.active === 'true';
      let label = null;
      if (!currentlyActive) {
        const input = $(`[data-sessionlabel="${campaignId}"]`);
        if (input) {
          label = input.value.trim();
          if (!label) { toast('Indica un riferimento sessione, es. E01 S02'); return; }
        }
      }
      try {
        await narratoreSetSessionActiveCloud(campaignId, !currentlyActive, label);
        toast(!currentlyActive ? 'Sessione avviata: i giocatori possono giocare' : 'Sessione chiusa');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.addlog) {
      const campaignId = e.target.dataset.addlog;
      const season = Math.max(1, Math.floor(Number($(`[data-newlogseason="${campaignId}"]`).value)) || 1);
      const episode = Math.max(1, Math.floor(Number($(`[data-newlogepisode="${campaignId}"]`).value)) || 1);
      const title = (($(`[data-newlogtitle="${campaignId}"]`) || {}).value || '').trim();
      const body = (($(`[data-newlogbody="${campaignId}"]`) || {}).value || '').trim();
      if (!body) { toast('Scrivi un riassunto'); return; }
      try {
        await addSessionLogCloud(campaignId, season, episode, title, body);
        toast('Riassunto pubblicato');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.editlog) {
      const logId = e.target.dataset.editlog;
      const titleStr = prompt('Titolo (vuoto per nessuno):');
      if (titleStr === null) return;
      const bodyStr = prompt('Riassunto:');
      if (bodyStr === null || !bodyStr.trim()) { toast('Il riassunto non può restare vuoto'); return; }
      try {
        await updateSessionLogCloud(logId, { title: titleStr.trim(), body: bodyStr.trim() });
        toast('Riassunto aggiornato');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.deletelog) {
      if (!confirm('Eliminare questo riassunto?')) return;
      try {
        await deleteSessionLogCloud(e.target.dataset.deletelog);
        toast('Riassunto eliminato');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.opencombat) {
      openCombatView(e.target.dataset.opencombat, true);
      return;
    }
    if (e.target.dataset.trashcampaign) {
      const campaignId = e.target.dataset.trashcampaign;
      const campaignName = activeCampaignSheetName || 'questa campagna';
      if (await trashCampaignFlow(campaignId, campaignName)) { renderMyCampaignsBox(); history.back(); }
      return;
    }
    if (e.target.dataset.removechar) {
      const charId = e.target.dataset.removechar;
      const row = e.target.closest('[data-charrow]');
      const charName = row ? row.querySelector('span')?.textContent?.trim() : 'questo personaggio';
      if (!confirm(`Rimuovere "${charName}" dalla storia? La sua scheda resta al giocatore, solo scollegata da questa storia.`)) return;
      try {
        await narratoreRemoveCharacterCloud(charId);
        toast('Personaggio rimosso dalla storia');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.deletenpc) {
      const charId = e.target.dataset.deletenpc;
      const row = e.target.closest('[data-charrow]');
      const charName = row ? row.querySelector('span')?.textContent?.trim() : 'questo PNG';
      if (!confirm(`Eliminare definitivamente "${charName}"? Non è un personaggio giocatore, la scheda va persa per sempre.`)) return;
      try {
        await deleteNpcCloud(charId);
        toast('PNG eliminato');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.id === 'btn-open-npc-bag-add') { openNpcBagAddModal(); return; }
    if (e.target.dataset.bagassignbtn) {
      const bagItemId = e.target.dataset.bagassignbtn;
      const sel = $(`[data-bagassignselect="${bagItemId}"]`);
      const charId = sel && sel.value;
      if (!charId) { toast('Scegli un giocatore'); return; }
      try {
        await assignNarratorBagItemCloud(bagItemId, charId);
        toast('Oggetto assegnato');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.bagremovebtn) {
      if (!confirm('Rimuovere questo oggetto dalla borsa?')) return;
      try {
        await removeNarratorBagItemCloud(e.target.dataset.bagremovebtn);
        toast('Oggetto rimosso dalla borsa');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });

  $('#account-narrator-requests-box').addEventListener('click', async e => {
    if (e.target.dataset.approvenarratorreq) {
      try {
        await approveNarratorRoleRequestCloud(e.target.dataset.approvenarratorreq);
        toast('Ruolo Narratore approvato');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.rejectnarratorreq) {
      try {
        await rejectNarratorRoleRequestCloud(e.target.dataset.rejectnarratorreq);
        toast('Richiesta rifiutata');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });

  $('#account-campaigns-box').addEventListener('change', async e => {
    if (e.target.id === 'acc-new-campaign-premise-input') {
      const file = e.target.files[0];
      const info = $('#acc-new-campaign-premise-info');
      if (!file) { info.innerHTML = '<div class="helper-text" style="margin:0;">Nessun PDF selezionato.</div>'; return; }
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) { toast('Seleziona un file PDF'); e.target.value = ''; return; }
      if (file.size > PREMISE_MAX_BYTES) { toast(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`); e.target.value = ''; return; }
      info.innerHTML = `<div class="pr-title">${escapeHtml(file.name)}</div><div class="pr-text">${Math.round(file.size / 1024)} KB</div>`;
      return;
    }
    if (e.target.id === 'acc-new-campaign-icon-input') {
      const file = e.target.files[0];
      const info = $('#acc-new-campaign-icon-info');
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast('Seleziona un\'immagine'); return; }
      try {
        pendingNewCampaignIcon = await resizeImageToDataUrl(file);
        info.innerHTML = `<img src="${pendingNewCampaignIcon}" alt="" style="width:48px;height:48px;border-radius:var(--radius-sm);object-fit:cover;">`;
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });

  $('#view-campaignsheet').addEventListener('change', async e => {
    if (e.target.dataset.iconinput) {
      const campaignId = e.target.dataset.iconinput;
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { toast('Seleziona un\'immagine'); return; }
      try {
        const dataUrl = await resizeImageToDataUrl(file);
        await setCampaignIcon(campaignId, dataUrl);
        toast('Icona caricata');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.premiseinput) {
      const campaignId = e.target.dataset.premiseinput;
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      if (!isPdf) { toast('Seleziona un file PDF'); return; }
      if (file.size > PREMISE_MAX_BYTES) { toast(`PDF troppo grande (${(file.size / (1024 * 1024)).toFixed(1)} MB): il limite è 30 MB`); return; }
      const titleInput = $(`[data-premisetitle="${campaignId}"]`);
      const title = titleInput ? titleInput.value.trim() : '';
      try {
        await uploadCampaignPremise(campaignId, file, title);
        toast('PDF caricato');
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.premisepublish) {
      const campaignId = e.target.dataset.premisepublish;
      const checked = e.target.checked;
      e.target.disabled = true;
      try {
        await setCampaignPremisePublished(campaignId, checked);
        toast(checked ? 'Premessa pubblicata: ora è visibile ai giocatori' : 'Premessa non più pubblicata');
      } catch (err) {
        e.target.checked = !checked;
        toast('Errore: ' + describeError(err));
      } finally {
        renderCampaignSheet();
      }
      return;
    }
    if (e.target.dataset.listedtoggle) {
      const campaignId = e.target.dataset.listedtoggle;
      const checked = e.target.checked;
      e.target.disabled = true;
      try {
        await setCampaignListed(campaignId, checked);
        toast(checked ? 'Storia visibile nella ricerca dei giocatori' : 'Storia nascosta dalla ricerca');
      } catch (err) {
        e.target.checked = !checked;
        toast('Errore: ' + describeError(err));
      } finally {
        renderCampaignSheet();
      }
      return;
    }
  });

  // ---- Randomize NPC (modale, aperta dalla tab "PNG" di una storia) ----
  $('#npc-randomizer-modal').addEventListener('click', async e => {
    if (e.target.id === 'npc-rand-cancel' || e.target.id === 'npc-randomizer-modal') { closeNpcRandomizerModal(); return; }
    if (e.target.id === 'npc-rand-build-dice') {
      $('#npc-rand-build').value = npcWeightedPick(npcArchetypeByKey($('#npc-rand-archetype').value).buildWeights);
      return;
    }
    if (e.target.id === 'npc-rand-quality-dice') {
      $('#npc-rand-quality').value = npcWeightedPick(npcArchetypeByKey($('#npc-rand-archetype').value).qualityWeights);
      return;
    }
    if (e.target.id === 'npc-rand-weight-dice') {
      $('#npc-rand-weight').value = npcWeightedPick(npcArchetypeByKey($('#npc-rand-archetype').value).weightClassWeights);
      return;
    }
    if (e.target.id === 'npc-rand-tecab-dice') {
      const level = clamp(parseInt($('#npc-rand-level').value, 10) || 1, 1, 20);
      const unlocked = tecAbSbloccate($('#npc-rand-build').value, level, {});
      const maxTecAb = unlocked.tec + unlocked.ab;
      $('#npc-rand-tecab-count').value = maxTecAb > 0 ? npcRandInt(Math.max(1, Math.ceil(maxTecAb / 2)), maxTecAb) : 0;
      return;
    }
    if (e.target.id === 'npc-rand-roll') {
      const campaignId = activeCampaignSheetId;
      if (!campaignId) { closeNpcRandomizerModal(); return; }
      const opts = {
        archetypeKey: $('#npc-rand-archetype').value,
        name: $('#npc-rand-name').value.trim() || npcArchetypeByKey($('#npc-rand-archetype').value).label,
        build: $('#npc-rand-build').value,
        level: clamp(parseInt($('#npc-rand-level').value, 10) || 1, 1, 20),
        equipQuality: $('#npc-rand-quality').value,
        pesantezza: $('#npc-rand-weight').value,
        tecabCount: parseInt($('#npc-rand-tecab-count').value, 10) || 0
      };
      const btn = e.target; btn.disabled = true;
      try {
        const data = generateNpcCharacterData(opts);
        await createNpcCharacter(campaignId, opts.name, opts.level, data);
        toast('PNG generato');
        closeNpcRandomizerModal();
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); } finally { btn.disabled = false; }
      return;
    }
  });
  $('#npc-randomizer-modal').addEventListener('change', e => {
    if (e.target.id === 'npc-rand-archetype' || e.target.id === 'npc-rand-level') npcRandomizerApplySuggestion();
  });

  $('#campaign-assets-popup-close').addEventListener('click', () => {
    $('#campaign-assets-popup').classList.add('hidden');
    activeCampaignAssetsCampaignId = null;
  });
  $('#campaign-assets-popup-body').addEventListener('click', e => {
    if (e.target.closest('#campaign-assets-add')) { $('#campaign-assets-file').click(); return; }
    const delBtn = e.target.closest('[data-removegalleryasset]');
    if (delBtn) {
      if (!confirm('Eliminare questa immagine dalla libreria?')) return;
      removeCampaignAsset(delBtn.dataset.removegalleryasset, delBtn.dataset.removegallerypath)
        .then(renderCampaignAssetsGallery)
        .catch(err => toast('Errore: ' + describeError(err)));
    }
  });
  $('#campaign-assets-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !activeCampaignAssetsCampaignId) return;
    const rawLabel = prompt('Nome dell\'ambientazione:', file.name.replace(/\.[^.]+$/, ''));
    if (rawLabel === null) return;
    const label = rawLabel.trim();
    try {
      await uploadCampaignAsset(activeCampaignAssetsCampaignId, file, label);
      toast('Immagine caricata');
      renderCampaignAssetsGallery();
    } catch (err) { toast('Errore: ' + describeError(err)); }
  });

  $('#account-trash-box').addEventListener('click', async e => {
    if (e.target.dataset.restorecampaign) {
      try {
        await restoreCampaignCloud(e.target.dataset.restorecampaign);
        toast('Storia ripristinata');
        renderAccountArea();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
  });

  // ---- azioni del Narratore dentro la scheda completa del personaggio ----
  $('#charview-narratore-actions').addEventListener('click', async e => {
    if (!viewingCharId) return;
    if (e.target.dataset.cvsetlevel) {
      const input = $('#charview-narratore-actions [data-cvlevelinput]');
      const newLevel = Number(input.value);
      if (!newLevel || newLevel < 1 || newLevel > 20) { toast('Livello non valido (1-20)'); return; }
      try {
        await narratoreSetLevelCloud(viewingCharId, newLevel);
        toast(`Livello assegnato: Lv ${newLevel}`);
        const ch = lastCampaignCharactersById[viewingCharId];
        if (ch) {
          ch.level = newLevel;
          $('#charview-narratore-actions').innerHTML = narratoreCharviewActionsHtml(ch);
        }
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.cvtraitgrant) {
      const listKey = e.target.dataset.cvtraitgrant;
      const input = $(`#charview-narratore-actions [data-cvtraitgrantinput="${listKey}"]`);
      const points = Math.floor(Number(input.value));
      if (!points || points <= 0) { toast('Inserisci un numero di punti positivo'); return; }
      try {
        await narratoreGrantTraitPointsCloud(viewingCharId, listKey, points);
        toast(`Concessi +${points} punti a ${TRAIT_LIST_LABELS[listKey]}`);
        const ch = lastCampaignCharactersById[viewingCharId];
        if (ch) {
          if (!ch.data.traitNarratoreBonus) ch.data.traitNarratoreBonus = {};
          ch.data.traitNarratoreBonus[listKey] = (ch.data.traitNarratoreBonus[listKey] || 0) + points;
          $('#charview-narratore-actions').innerHTML = narratoreCharviewActionsHtml(ch);
        }
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.cvtraitcustom) {
      const listKey = e.target.dataset.cvtraitcustom;
      const name = prompt(`Nome del tratto (${TRAIT_LIST_LABELS[listKey]}):`);
      if (!name || !name.trim()) return;
      const trimmedName = name.trim();
      // Un nome uguale a un tratto STANDARD del personaggio non viene
      // bloccato (può essere voluto, es. un dono che rinforza quel tratto)
      // ma il tratto personalizzato prende comunque il sopravvento su
      // quello standard per i tiri veri (getTraitValue legge solo la
      // prima corrispondenza) — mai il contrario — quindi va segnalato
      // prima di procedere, non dopo.
      const isStandardName = (TRAIT_LISTS[listKey] || []).some(n => n.toLowerCase() === trimmedName.toLowerCase());
      if (isStandardName && !confirm(`"${trimmedName}" è già un tratto standard di questa lista: il dono lo sovrascriverà nei tiri reali, ma in scheda resteranno due righe separate (non sommate). Continuare?`)) return;
      const valueStr = prompt('Valore del tratto:', '1');
      const value = Math.max(0, Math.floor(Number(valueStr)) || 0);
      try {
        await narratoreAddCustomTraitCloud(viewingCharId, listKey, trimmedName, value);
        toast(`Tratto "${trimmedName}" scritto sulla scheda`);
        const ch = lastCampaignCharactersById[viewingCharId];
        if (ch) {
          if (!ch.data.customTraits) ch.data.customTraits = {};
          if (!Array.isArray(ch.data.customTraits[listKey])) ch.data.customTraits[listKey] = [];
          // Riconcedere lo stesso nome (già donato da un Narratore in
          // precedenza) AGGIORNA quella riga invece di aggiungerne una
          // seconda identica — stesso comportamento della RPC, vedi
          // narratore_add_custom_trait. Un tratto con lo stesso nome ma
          // creato dal GIOCATORE (mai narratore:true) non viene toccato:
          // resta una riga separata, la RPC lato server segue la stessa
          // regola per non perdere dati scritti dal giocatore.
          const existing = ch.data.customTraits[listKey].find(t => t.narratore && t.name.toLowerCase() === trimmedName.toLowerCase());
          if (existing) existing.value = value;
          else ch.data.customTraits[listKey].push({ name: trimmedName, value, narratore: true });
          $('#charview-narratore-actions').innerHTML = narratoreCharviewActionsHtml(ch);
        }
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.dataset.cvsendloot) {
      const root = e.target.closest('.loot-form');
      const itemType = root.querySelector('[data-loottype]').value;
      const item = readLootFormItem(root, itemType);
      if (!item) return;
      try {
        await sendLootCloud(viewingCharId, itemType, item);
        toast(`Loot inviato: ${item.name || item.nome}`);
        const ch = lastCampaignCharactersById[viewingCharId];
        if (ch) $('#charview-narratore-actions').innerHTML = narratoreCharviewActionsHtml(ch);
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.closest('[data-lootbonusadd]')) {
      const root = e.target.closest('.loot-form');
      const itemType = root.querySelector('[data-loottype]').value;
      lootFormBonuses.push(makeEquipBonusRow(itemType));
      renderLootBonusRows(itemType);
      return;
    }
    const delBonusBtn = e.target.closest('[data-lootbonusdel]');
    if (delBonusBtn) {
      const root = e.target.closest('.loot-form');
      const itemType = root.querySelector('[data-loottype]').value;
      lootFormBonuses.splice(Number(delBonusBtn.dataset.lootbonusdel), 1);
      renderLootBonusRows(itemType);
      return;
    }
  });
  $('#charview-narratore-actions').addEventListener('change', e => {
    if (e.target.dataset.loottype !== undefined) {
      updateLootFormGroups(e.target.closest('.loot-form'));
      // i bersagli ammessi (statistiche primarie, categoria tratto) dipendono
      // dal tipo di pezzo: si riparte da zero invece di lasciare bonus non
      // più coerenti col nuovo tipo scelto
      lootFormBonuses = [];
      renderLootBonusRows(e.target.value);
      return;
    }
    const kindSel = e.target.closest('[data-lootbonuskind]');
    const keySel = e.target.closest('[data-lootbonuskey]');
    const listKeySel = e.target.closest('[data-lootbonuslistkey]');
    const nameInput = e.target.closest('[data-lootbonusname]');
    const valoreInput = e.target.closest('[data-lootbonusvalore]');
    const regenTargetSel = e.target.closest('[data-lootbonusregentarget]');
    const regenIntervalInput = e.target.closest('[data-lootbonusregeninterval]');
    if (!kindSel && !keySel && !listKeySel && !nameInput && !valoreInput && !regenTargetSel && !regenIntervalInput) return;
    const root = e.target.closest('.loot-form');
    const itemType = root.querySelector('[data-loottype]').value;
    if (kindSel) {
      const b = lootFormBonuses[Number(kindSel.dataset.lootbonuskind)];
      b.kind = kindSel.value;
      if (b.kind === 'primary') {
        const allowed = primaryBonusKeysFor(itemType);
        if (!allowed.includes(b.key)) b.key = allowed[0];
      } else if (b.kind === 'trait') {
        if (!traitOptionsFor(itemType) && !b.listKey) b.listKey = 'capacitaCombattive';
      } else if (b.kind === 'rigenerazione') {
        if (!EQUIP_REGEN_TARGETS.some(t => t.key === b.key)) b.key = 'hp';
        if (!b.intervalMin) b.intervalMin = 10;
      }
      renderLootBonusRows(itemType);
    } else if (keySel) {
      lootFormBonuses[Number(keySel.dataset.lootbonuskey)].key = keySel.value;
    } else if (listKeySel) {
      lootFormBonuses[Number(listKeySel.dataset.lootbonuslistkey)].listKey = listKeySel.value;
    } else if (regenTargetSel) {
      lootFormBonuses[Number(regenTargetSel.dataset.lootbonusregentarget)].key = regenTargetSel.value;
    } else if (regenIntervalInput) {
      lootFormBonuses[Number(regenIntervalInput.dataset.lootbonusregeninterval)].intervalMin = Math.max(1, Math.floor(Number(regenIntervalInput.value)) || 10);
    } else if (nameInput) {
      lootFormBonuses[Number(nameInput.dataset.lootbonusname)].name = nameInput.value;
    } else if (valoreInput) {
      lootFormBonuses[Number(valoreInput.dataset.lootbonusvalore)].valore = Math.max(1, Math.floor(Number(valoreInput.value)) || 1);
    }
  });

  // ---- "+ Aggiungi oggetto alla Borsa" (modale, aperta dalla tab PNG di
  // una storia): stessi campi/handler di "Invia loot" sopra (operano su
  // qualunque .loot-form trovato, indipendentemente dal contenitore), solo
  // che il bottone finale chiama narratore_add_bag_item invece di
  // narratore_send_loot — nessun destinatario da scegliere qui. ----
  $('#npc-bag-add-modal').addEventListener('click', async e => {
    if (e.target.id === 'npc-bag-add-cancel' || e.target.id === 'npc-bag-add-modal') { closeNpcBagAddModal(); return; }
    if (e.target.id === 'npc-bag-add-submit') {
      const root = e.target.closest('.cc-box').querySelector('.loot-form');
      const itemType = root.querySelector('[data-loottype]').value;
      const item = readLootFormItem(root, itemType);
      if (!item) return;
      const sourceLabel = ($('#npc-bag-add-source').value || '').trim();
      try {
        await addNarratorBagItemCloud(activeCampaignSheetId, itemType, item, sourceLabel);
        toast(`Aggiunto alla borsa: ${item.name || item.nome}`);
        closeNpcBagAddModal();
        renderCampaignSheet();
      } catch (err) { toast('Errore: ' + describeError(err)); }
      return;
    }
    if (e.target.closest('[data-lootbonusadd]')) {
      const root = e.target.closest('.loot-form');
      const itemType = root.querySelector('[data-loottype]').value;
      lootFormBonuses.push(makeEquipBonusRow(itemType));
      renderLootBonusRows(itemType);
      return;
    }
    const delBonusBtn = e.target.closest('[data-lootbonusdel]');
    if (delBonusBtn) {
      const root = e.target.closest('.loot-form');
      const itemType = root.querySelector('[data-loottype]').value;
      lootFormBonuses.splice(Number(delBonusBtn.dataset.lootbonusdel), 1);
      renderLootBonusRows(itemType);
      return;
    }
  });
  $('#npc-bag-add-modal').addEventListener('change', e => {
    if (e.target.dataset.loottype !== undefined) {
      updateLootFormGroups(e.target.closest('.loot-form'));
      lootFormBonuses = [];
      renderLootBonusRows(e.target.value);
      return;
    }
    const kindSel = e.target.closest('[data-lootbonuskind]');
    const keySel = e.target.closest('[data-lootbonuskey]');
    const listKeySel = e.target.closest('[data-lootbonuslistkey]');
    const nameInput = e.target.closest('[data-lootbonusname]');
    const valoreInput = e.target.closest('[data-lootbonusvalore]');
    const regenTargetSel = e.target.closest('[data-lootbonusregentarget]');
    const regenIntervalInput = e.target.closest('[data-lootbonusregeninterval]');
    if (!kindSel && !keySel && !listKeySel && !nameInput && !valoreInput && !regenTargetSel && !regenIntervalInput) return;
    const root = e.target.closest('.loot-form');
    const itemType = root.querySelector('[data-loottype]').value;
    if (kindSel) {
      const b = lootFormBonuses[Number(kindSel.dataset.lootbonuskind)];
      b.kind = kindSel.value;
      if (b.kind === 'primary') {
        const allowed = primaryBonusKeysFor(itemType);
        if (!allowed.includes(b.key)) b.key = allowed[0];
      } else if (b.kind === 'trait') {
        if (!traitOptionsFor(itemType) && !b.listKey) b.listKey = 'capacitaCombattive';
      } else if (b.kind === 'rigenerazione') {
        if (!EQUIP_REGEN_TARGETS.some(t => t.key === b.key)) b.key = 'hp';
        if (!b.intervalMin) b.intervalMin = 10;
      }
      renderLootBonusRows(itemType);
    } else if (keySel) {
      lootFormBonuses[Number(keySel.dataset.lootbonuskey)].key = keySel.value;
    } else if (listKeySel) {
      lootFormBonuses[Number(listKeySel.dataset.lootbonuslistkey)].listKey = listKeySel.value;
    } else if (regenTargetSel) {
      lootFormBonuses[Number(regenTargetSel.dataset.lootbonusregentarget)].key = regenTargetSel.value;
    } else if (regenIntervalInput) {
      lootFormBonuses[Number(regenIntervalInput.dataset.lootbonusregeninterval)].intervalMin = Math.max(1, Math.floor(Number(regenIntervalInput.value)) || 10);
    } else if (nameInput) {
      lootFormBonuses[Number(nameInput.dataset.lootbonusname)].name = nameInput.value;
    } else if (valoreInput) {
      lootFormBonuses[Number(valoreInput.dataset.lootbonusvalore)].valore = Math.max(1, Math.floor(Number(valoreInput.value)) || 1);
    }
  });

  sb.auth.onAuthStateChange((event, session) => {
    // currentSessionUserId (usato da visibleCharacters() per filtrare "I
    // tuoi personaggi") prima veniva aggiornato SOLO come effetto
    // collaterale di renderListAccountBadge(), a sua volta richiamata solo
    // da dentro renderCharList() — nessun listener lo risincronizzava su un
    // vero cambio di sessione (login normale, refresh automatico del
    // token, ripristino della sessione persistita all'avvio: nessuno di
    // questi eventi richiamava renderCharList()/renderListAccountBadge).
    // Se in quella finestra sb.auth.getSession() restituiva momentaneamente
    // una sessione ancora nulla/scaduta (in attesa del refresh interno),
    // currentSessionUserId restava agganciato a quel valore sbagliato
    // finché qualcos'altro non richiamava di nuovo renderCharList() — nel
    // frattempo ogni personaggio con ownerAccountId valorizzato (chiunque
    // avesse già sincronizzato col cloud) spariva da "I tuoi personaggi"
    // pur essendo perfettamente a posto lato server (da cui il sintomo:
    // visibile per il Narratore in Account, invisibile al proprietario
    // nella sua stessa lista). onAuthStateChange riceve già la sessione
    // aggiornata come secondo argomento ad OGNI evento (incluso
    // TOKEN_REFRESHED e il ripristino iniziale): fonte diretta e sempre
    // aggiornata, nessuna richiesta di rete separata necessaria qui.
    const newSessionUserId = session ? session.user.id : null;
    if (currentSessionUserId !== newSessionUserId) {
      currentSessionUserId = newSessionUserId;
      if (!$('#view-list').classList.contains('hidden')) renderCharList();
      // Punto di controllo "login/riconnessione" per gli avanzamenti
      // Tecnica/Abilità pendenti (vedi checkTecabPendingAdvancementsForAll,
      // js/app.js): un vero cambio di identità/sessione, non un refresh di
      // token che lascia lo stesso utente.
      if (typeof checkTecabPendingAdvancementsForAll === 'function') checkTecabPendingAdvancementsForAll();
    }
    // Sul web il link di recupero viene letto automaticamente da
    // detectSessionInUrl, che genera questo evento (nell'app nativa lo
    // stesso caso arriva invece da completeSessionFromDeepLink, vedi
    // supabase-client.js).
    if (event === 'PASSWORD_RECOVERY') pendingPasswordRecovery = true;
    // renderHomeIdentityBox richiama anche renderMyCampaignsBox ("Le tue
    // campagne", ora in copertina): un solo punto aggiorna sia il modulo
    // di accesso che il box campagne ad ogni cambio di sessione, senza
    // bisogno di controllare quale vista sia attiva (a differenza di
    // #view-account qui sotto, che vive altrove e va gestito a parte).
    renderHomeIdentityBox();
    if (!$('#view-account').classList.contains('hidden')) renderAccountArea();
    // Link di conferma registrazione appena aperto sul web: pendingSignupConfirmation
    // (supabase-client.js) e' stato letto dall'hash dell'URL al primissimo
    // caricamento della pagina, prima che detectSessionInUrl lo ripulisse —
    // qui arriva il SIGNED_IN che ne e' conseguenza. Si azzera subito dopo,
    // altrimenti un SIGNED_IN successivo (es. un accesso normale nella
    // stessa scheda) reindirizzerebbe di nuovo alla Home senza motivo.
    if (event === 'SIGNED_IN' && pendingSignupConfirmation) {
      pendingSignupConfirmation = false;
      toast('Email confermata! Il tuo account è attivo.');
      renderCharList();
      showView('list');
    }
  });
}
