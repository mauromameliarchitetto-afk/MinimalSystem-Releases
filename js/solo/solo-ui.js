/* ==========================================================================
   Role Makers — Gioca in solitaria: interfaccia (#view-solo).

   Sezione autonoma, dietro il flag solo_player_v1 (spento di default:
   prototipo, non rilascio). Non legge né scrive le schede normali
   (localStorage 'ms_characters_v1'), non usa Supabase, non compare nei
   selettori dei personaggi, negli inviti o nelle campagne: tutto passa da
   RMSoloStore (IndexedDB dedicato) e dal motore locale.

   Flusso di un'azione: blocco dell'input -> (testo libero) interpretazione
   -> applyCommand con id e versione attesa -> salvataggio -> narrazione ->
   attachNarration -> salvataggio. Se la narrazione fallisce o l'app si
   chiude a metà, alla ripresa l'evento risulta "da generare" e viene
   narrato di nuovo dallo STESSO esito: nessun nuovo tiro, nessun premio.
   ========================================================================== */
(function (global) {
  'use strict';

  const S = { content: {}, archetipi: {}, voce: {}, storia: null, state: null, busy: false, view: 'hub', setup: null, abort: null, tab: 'gioco' };
  const STORIE_INFO = {
    // avventura: titolo mostrato fuori dalla partita (pagina dell'avventura nel
    // Compendio) senza caricare i contenuti; coincide con content.titolo
    eidos: { titolo: 'Eidos', avventura: 'Alla ricerca dell\'Aletheia', disponibile: true, nota: '"Alla ricerca dell\'Aletheia" — proposta editoriale da approvare' },
    ich: { titolo: 'Ich', avventura: 'Il filo senza padrone', disponibile: true, nota: '"Il filo senza padrone" — proposta editoriale da approvare' },
    icaro: { titolo: 'Icaro', avventura: 'Otto minuti di calore', disponibile: true, nota: '"Otto minuti di calore" — proposta editoriale da approvare' }
  };
  // trame d'autore (docs/single-player/TRAMA_NEL_GIOCO.md): le schede vengono da js/solo/content/mondi.js
  Object.keys(global.RMSoloMondi || {}).forEach(k => { STORIE_INFO[k] = global.RMSoloMondi[k].info; });
  // Le vecchie avventure di prova restano recuperabili dagli slot esistenti
  // e in sviluppo, senza duplicare le dodici trame nel menu ordinario.
  ['eidos', 'ich', 'icaro'].forEach(k => { STORIE_INFO[k].pilota = true; });
  const MONDI = ['eidos', 'ich', 'icaro'], mondoDi = k => ((global.RMSoloMondi || {})[k] || { mondo: k }).mondo;
  const DIFF = [
    { key: 'esplorativa', label: 'Esplorativa', desc: 'Sfide accessibili, recupero più frequente. Morte rara, solo in situazioni estreme.' },
    { key: 'bilanciata', label: 'Bilanciata', desc: 'Rischi e risorse da amministrare con attenzione. Morte possibile nelle situazioni letali.' },
    { key: 'permadeath', label: 'Permadeath', desc: 'Pressione alta. Una caduta è la fine: la partita si chiude e resta consultabile.' }
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $v = sel => document.querySelector('#view-solo ' + sel);
  const uuid = () => (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2);

  async function loadJson(path) { const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) throw new Error('Contenuto non disponibile: ' + path); return r.json(); }
  /* Contenuto della partita: la sede della campagna nella città di partenza
     del personaggio (decisione dell'autore, 2026-10-02; RMSoloCampaign.localizza).
     Il contenuto caricato resta quello dei dati; quello localizzato è in memoria. */
  function contentDi(storia, pg) {
    const base = S.content[storia];
    const arch = pg && ((S.archetipi[storia] || {}).archetipi || []).find(a => a.id === pg.archetipo);
    // i segnaposto di genere ({m|f|n}) si risolvono col genere della scheda (js/solo/solo-genere.js)
    return RMSoloGenere.contenuto(RMSoloCampaign.localizza(base, Object.assign({ citta: arch ? arch.citta : null }, pg || {})), pg && pg.genere, pg && pg.nome);
  }
  function gameContent() { return contentDi(S.storia, S.state && S.state.personaggio); }
  async function contentFor(storia) {
    if (!S.content[storia]) {
      S.content[storia] = await loadJson('js/solo/content/' + storia + '-campagna.json');
      S.archetipi[storia] = await loadJson('js/solo/content/' + storia + '-archetipi.json');
      // trama d'autore: PNG, fatti, luoghi ed eventi comuni del suo mondo (<mondo>-mondo.json), solo quelli che la trama dichiara
      if (S.content[storia].dalMondo && (global.RMSoloMondi || {})[storia]) {
        const mondo = RMSoloOntologia.mondoDi(storia);
        try { RMSoloCampaign.uniscoMondo(S.content[storia], await loadJson('js/solo/content/' + mondo + '-mondo.json'), mondo); }
        catch (e) { console.warn('Dati del mondo non disponibili:', e.message); }
      }
      // catalogo d'autore per gruppo e classe (dotazione di Lv 1 e voci dei livelli successivi)
      // il catalogo di dotazioni è del mondo (una trama usa quello del suo mondo)
      try { S.content[storia].catalogo = await loadJson('js/solo/content/' + RMSoloOntologia.mondoDi(storia) + '-catalogo.json'); }
      catch (e) { console.warn('Catalogo non disponibile:', e.message); }
      // imprevisti di scena (Fase 5.2)
      try { S.content[storia].imprevisti = await loadJson('js/solo/content/' + storia + '-imprevisti.json'); }
      catch (e) { console.warn('Imprevisti non disponibili:', e.message); }
      // schede di conoscenze dei PNG per le domande libere (opzionale)
      try { S.content[storia].conoscenze = await loadJson('js/solo/content/' + storia + '-conoscenze.json'); }
      catch (e) { /* storie senza schede: comportamento di sempre */ }
      // ingresso in scena, percezione passiva e aspetto dei PNG (Fase 4)
      try { S.content[storia].scena = await loadJson('js/solo/content/' + storia + '-scena.json'); }
      catch (e) { console.warn('Dati di scena non disponibili:', e.message); }
      // percorsi d'obiettivo (Fase 3): traguardi per atto, velati finché non raggiunti
      try { S.content[storia].percorsi = await loadJson('js/solo/content/' + storia + '-percorsi.json'); }
      catch (e) { console.warn('Percorsi non disponibili:', e.message); }
      // scene ampliate (esplorazione e dialoghi prima dello svolgimento)
      try { S.content[storia].interazioni = await loadJson('js/solo/content/' + storia + '-interazioni.json'); }
      catch (e) { console.warn('Interazioni non disponibili:', e.message); }
      // dati narrativi (verità, drammaturgia, profilo vocale): livello separato
      try { S.content[storia].narrativa = await loadJson('js/solo/content/' + storia + '-narrativa.json'); }
      catch (e) { console.warn('Dati narrativi non disponibili:', e.message); }
      // scene-seme: materiali di preparazione del Narratore (improvvisazione)
      try { S.content[storia].semi = await loadJson('js/solo/content/' + storia + '-semi.json'); }
      catch (e) { console.warn('Scene-seme non disponibili:', e.message); }
      // campagna lunga: macro-capitoli con contratto, schede di PNG e avversari
      if (S.content[storia].semi) {
        try { S.content[storia].struttura = await loadJson('js/solo/content/' + storia + '-struttura.json'); }
        catch (e) { console.warn('Struttura della campagna non disponibile:', e.message); }
      }
      // mappa canonica della storia (luoghi, rotte del copione, dati mancanti dichiarati)
      try { S.content[storia].mappa = await loadJson('js/solo/content/' + storia + '-mappa.json'); }
      catch (e) { console.warn('Mappa non disponibile:', e.message); }
      // pacchetto di contesto: SOLO quello della campagna scelta (isolamento)
      try { S.content[storia].contesto = await loadJson('js/solo/content/' + storia + '-contesto.json'); }
      catch (e) { console.warn('Contesto della campagna non disponibile:', e.message); }
      // voce narrante: livello separato; se manca o non è valida si narra
      // con la formula generica, il gioco non si blocca
      try {
        // voce autoriale condivisa (una per tutte le campagne) + timbro della campagna
        if (S.voceAutore === undefined) {
          try { const a = await loadJson('js/solo/content/voce-autore.json'); const ea = RMSoloVoice.validateAuthorVoice(a); if (ea.length) { console.warn('Voce autoriale non valida:', ea); S.voceAutore = null; } else S.voceAutore = a; }
          catch (e) { console.warn('Voce autoriale non disponibile:', e.message); S.voceAutore = null; }
        }
        const v = RMSoloVoice.componi(S.voceAutore, await loadJson('js/solo/content/' + storia + '-voce.json'), S.content[storia].contesto);
        const err = RMSoloVoice.validateVoice(v, S.content[storia]);
        if (err.length) console.warn('Voce narrante non valida:', err); else S.voce[storia] = v;
      } catch (e) { console.warn('Voce narrante non disponibile:', e.message); }
    }
    return S.content[storia];
  }

  function root() { return document.getElementById('view-solo'); }
  function render(html) { root().innerHTML = '<div class="solo-wrap">' + html + '</div>'; }

  /* ---------------------------------------------------------- modale */
  function modal(title, bodyHtml, buttons) {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'confirm-modal solo-modal';
      m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
      m.innerHTML = '<div class="cc-box"><div class="cc-title">' + esc(title) + '</div>' + bodyHtml +
        '<div class="cc-actions solo-modal-actions">' + buttons.map((b, i) => '<button type="button" class="btn ' + (b.cls || 'btn-ghost') + '" data-i="' + i + '">' + esc(b.label) + '</button>').join('') + '</div></div>';
      document.body.appendChild(m);
      m.querySelectorAll('button[data-i]').forEach(btn => btn.addEventListener('click', () => { m.remove(); resolve(buttons[+btn.dataset.i].value); }));
      const first = m.querySelector('button[data-i]'); if (first) first.focus();
    });
  }

  /* ------------------------------------------------------------ hub */
  async function renderHub() {
    S.view = 'hub'; S.state = null;
    if (global.RMSoloLink && RMSoloLink.avvisoSpostati) RMSoloLink.avvisoSpostati();
    const slots = await RMSoloStore.list();
    const dev = devMode();
    const inst = dev ? await RMSoloModels.readInstalled().catch(() => null) : null;
    const st = RMSoloLLM.status();
    const visibili = slots.filter(sl => dev || sl.partita || !(STORIE_INFO[sl.storia] || {}).pilota)
      .sort((x, y) => MONDI.indexOf(mondoDi(x.storia)) - MONDI.indexOf(mondoDi(y.storia)));
    const mondi = visibili.map(sl => mondoDi(sl.storia)).filter((m, i, a) => a.indexOf(m) === i);
    // giocatori: prima il mondo con la sua premessa, poi la storia (autore, 8/11/2026); in sviluppo l'elenco intero
    if (mondi.indexOf(S.mondo) === -1) S.mondo = null;
    const scegliMondo = !dev && !S.mondo;
    const cards = visibili.filter(sl => dev || mondoDi(sl.storia) === S.mondo).map(sl => {
      const info = STORIE_INFO[sl.storia];
      const p = sl.partita;
      const stato = p ? ({ attivo: 'In corso', concluso: 'Capitolo concluso', morto: 'Personaggio morto', terminato: 'Partita terminata', atto_concluso: 'Fine dell\'atto ' + ((p.fineAtto || {}).atto || 1) }[p.stato] || p.stato) : 'Slot libero';
      return '<div class="solo-slot" data-storia="' + sl.storia + '">' +
        '<div class="solo-slot-head"><span class="solo-slot-title">' + esc(info.avventura) + (info.pilota ? ' <span class="solo-chip solo-pilota">pilota</span>' : '') + '</span><span class="solo-chip">' + esc(stato) + '</span></div>' +
        (p ? '<div class="solo-slot-sub">' + esc(p.personaggio.nome) + ' · Lv ' + p.personaggio.livello + ' · ' + esc(p.difficolta) + '</div>' : ((devMode() || info.in_revisione) ? '<div class="solo-slot-sub">' + esc(info.nota) + '</div>' : '')) +
        '<div class="solo-slot-actions">' +
        (p ? '<button class="btn btn-primary btn-sm" data-act="riprendi">' + (p.stato === 'attivo' ? 'Continua l\'avventura' : 'Consulta') + '</button>' : '') +
        (info.disponibile ? '<button class="btn btn-ghost btn-sm" data-act="nuova">Nuova partita</button>' : '<button class="btn btn-ghost btn-sm" disabled>Non ancora disponibile</button>') +
        '</div></div>';
    }).join('');
    render('<header class="solo-head"><button class="btn btn-ghost btn-sm" id="solo-back" aria-label="Torna indietro">←</button><h1>Gioca in solitaria</h1></header>' +
      '<p class="solo-note">I personaggi di questa sezione non possono essere usati nelle campagne di gruppo.</p>' +
      (dev ? modelPanel(inst, st) : '<div id="solo-narratore"></div>') +
      (scegliMondo ? '<h2 class="solo-h2">Scegli un mondo</h2><div class="solo-choices" id="solo-mondi">' + mondi.map(m => {
        const set = typeof LIBRARY_SETTINGS !== 'undefined' ? LIBRARY_SETTINGS[m] : null, n = visibili.filter(sl => mondoDi(sl.storia) === m).length;
        return '<button type="button" class="solo-choice" data-mondo="' + esc(m) + '"><b>' + esc(set ? set.title : m) + '</b>' + (set && set.summary ? '<span>' + esc(set.summary) + '</span>' : '') + '<span>' + n + (n === 1 ? ' storia' : ' storie') + '</span></button>';
      }).join('') + '</div>'
        : (S.mondo ? '<h2 class="solo-h2 solo-mondo">' + esc(STORIE_INFO[visibili.find(sl => mondoDi(sl.storia) === S.mondo).storia].titolo) + '</h2>' + premessaMondoHtml(S.mondo) + '<h2 class="solo-h2">Scegli una storia</h2>'
          : '<h2 class="solo-h2">Scegli un’avventura (una partita per storia)</h2>') + cards));
    $v('#solo-back').addEventListener('click', () => {
      if (S.mondo && !dev) { S.mondo = null; renderHub(); window.scrollTo(0, 0); return; }
      if (typeof goToMenuTarget === 'function') goToMenuTarget('home');
    });
    root().querySelectorAll('[data-mondo]').forEach(b => b.addEventListener('click', () => { S.mondo = b.dataset.mondo; renderHub(); window.scrollTo(0, 0); }));
    if (dev) wireModelPanel(); else renderNarratorLine();
    root().querySelectorAll('.solo-slot').forEach(el => {
      const storia = el.dataset.storia;
      el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'riprendi') openGame(storia);
        if (a === 'nuova') startSetup(storia);
      }));
    });
  }

  function modelPanel(inst, st) {
    const stato = st.stato === 'pronto' ? 'Caricato (' + esc(st.modello) + ', thread: ' + esc(st.thread) + ')'
      : st.stato === 'caricamento' ? 'Caricamento in corso…'
        : inst ? 'Installato e verificato: ' + esc(inst.id) + ' — non ancora caricato'
          : 'Nessun modello installato: il gioco usa i testi di riserva.';
    return '<section class="solo-panel" id="solo-model">' +
      '<h2 class="solo-h2">Narratore IA locale</h2><p class="solo-note" id="solo-model-status">' + stato + (st.errore ? '<br>Errore: ' + esc(st.errore) : '') + '</p>' +
      (S.importErrore ? '<p class="solo-warn" id="solo-model-error">' + esc(S.importErrore) + '</p>' : '') +
      '<div class="solo-row"><select id="solo-model-pick" aria-label="Modello da importare"></select>' +
      (RMSoloModels.native()
        ? '<button class="btn btn-ghost btn-sm" id="solo-model-native">Importa file del modello</button>'
        : '<label class="btn btn-ghost btn-sm solo-file">Importa file del modello<input type="file" id="solo-model-file" accept=".gguf" multiple hidden></label>') +
      (inst ? '<button class="btn btn-ghost btn-sm" id="solo-model-load">Carica</button><button class="btn btn-ghost btn-sm" id="solo-model-remove">Rimuovi</button>' : '') +
      '</div><div class="solo-progress hidden" id="solo-model-progress"><div></div><span></span><button class="btn btn-ghost btn-sm" id="solo-model-cancel">Annulla</button></div>' +
      (devMode() ? '<p class="solo-note solo-small">Distribuzione del modello non ancora definita: nel prototipo il file (.gguf) si importa dal dispositivo e viene verificato (dimensione e SHA-256) prima dell\'uso.</p>' : '') + '</section>';
  }

  async function wireModelPanel() {
    const pick = $v('#solo-model-pick');
    try {
      const man = await RMSoloModels.manifest();
      pick.innerHTML = man.modelli.map(m => {
        const size = m.parti.reduce((a, p) => a + p.dimensione, 0);
        return '<option value="' + esc(m.id) + '">' + esc(m.nome) + ' — ' + (size / 1e9).toFixed(2) + ' GB, ' + m.parti.length + ' file, ' + esc(m.licenza) + '</option>';
      }).join('');
    } catch (e) { pick.innerHTML = '<option>Manifest non disponibile</option>'; }
    const file = $v('#solo-model-file') || $v('#solo-model-native');
    // APK: selettore di sistema e verifica in Java; browser: <input type=file>
    file.addEventListener(file.tagName === 'BUTTON' ? 'click' : 'change', async () => {
      if (file.tagName !== 'BUTTON' && !file.files.length) return;
      const prog = $v('#solo-model-progress');
      prog.classList.remove('hidden');
      const ac = new AbortController();
      $v('#solo-model-cancel').onclick = () => ac.abort();
      try {
        await RMSoloModels.importFromFiles(pick.value, file.files || null, p => {
          const pct = Math.floor(p.fatto / p.totale * 100);
          prog.querySelector('div').style.width = pct + '%';
          prog.querySelector('span').textContent = 'Copia e verifica: ' + pct + '%';
        }, ac.signal);
        S.importErrore = null;
        toastSafe('Modello verificato e installato');
      } catch (e) {
        S.importErrore = e.name === 'AbortError' ? 'Copia interrotta: nessun modello attivato.'
          : e.name === 'SelezioneVuota' || /^Selezione annullata/.test(e.message || '')
            ? 'Il selettore si è chiuso senza un file. Tocca il file .gguf e, se in alto compare "Seleziona" o "Apri", premilo.'
            : ('Importazione non riuscita: ' + e.message);
        toastSafe(S.importErrore);
      }
      renderHub();
    });
    const load = $v('#solo-model-load');
    if (load) load.addEventListener('click', async () => { $v('#solo-model-status').textContent = 'Caricamento in corso…'; await RMSoloLLM.load(); renderHub(); });
    const rm = $v('#solo-model-remove');
    if (rm) rm.addEventListener('click', async () => {
      const ok = await modal('Rimuovere il modello?', '<p>Il file verrà cancellato dal dispositivo. Le partite restano salvate.</p>', [{ label: 'Annulla', value: false }, { label: 'Rimuovi', value: true, cls: 'btn-primary' }]);
      if (!ok) return;
      await RMSoloLLM.unload(); await RMSoloModels.removeInstalled(); renderHub();
    });
  }

  /* ------------------------------------------- Narratore automatico */

  /* Nessuna scelta per il giocatore: nell'APK il modello si sceglie e si
     scarica da solo (RMSoloNarratorSetup in solo-llm.js), poi si carica.
     Nel browser non c'è nulla da mostrare: si gioca con i testi di riserva.
     Il vecchio pannello di importazione manuale resta solo per chi sviluppa
     (?ff_solo_dev_v1=1). */
  let ASPETTO_GIOCATORE = false; // prova locale sul PC: schermata del giocatore anche con il flag di sviluppo acceso
  function devMode() { return !ASPETTO_GIOCATORE && typeof rmFeatureEnabled === 'function' && rmFeatureEnabled('solo_dev_v1'); }
  // impostazione globale (Impostazioni, js/settings-view.js): spenta di default
  const DETTAGLI_KEY = 'rm_solo_dettagli_tiri';
  function dettagliTiri() { try { return global.localStorage.getItem(DETTAGLI_KEY) === '1'; } catch (e) { return false; } }
  // proposte meccaniche usate come approvate: solo sviluppo o anteprima
  function anteprima() { return devMode() || (typeof rmFeatureEnabled === 'function' && rmFeatureEnabled('solo_anteprima_v1')); }
  function narratoreAddestratoPronto() { return !!(RMSoloLLM.ready() && RMSoloLLM.narratoreAddestrato); }
  // stessa accensione delle prove al PC, senza le funzioni da sviluppatore: la decide il contratto del modello caricato
  function motoreNuovo() { return anteprima() || !!RMSoloLLM.contrattoPiano; }
  function sincronizzaMotore() {
    if (!S.state) return;
    S.state = RMSoloMondo.accendiSePredefinito(S.state, motoreNuovo(), narratoreAddestratoPronto());
    if (narratoreAddestratoPronto() || RMSoloLLM.contrattoPiano) RMSoloMondo.ensure(S.state, gameContent());
  }
  global.addEventListener('rm-solo-llm-status', () => {
    if (!S.state || S.busy) return;
    sincronizzaMotore();
    RMSoloStore.save(S.state).catch(() => {});
    if (S.view === 'gioco') renderGame();
  });
  const WIFI_KEY = 'rm_solo_attendi_wifi';
  function waitWifi(v) {
    try { if (v === undefined) return global.localStorage.getItem(WIFI_KEY) === '1'; if (v) global.localStorage.setItem(WIFI_KEY, '1'); else global.localStorage.removeItem(WIFI_KEY); } catch (e) { /* storage non disponibile */ }
    return false;
  }
  function gb(n) { return (n / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' GB'; }

  let setupWired = false, consentAsked = false;
  function prepareNarrator(opts) {
    const NS = global.RMSoloNarratorSetup;
    if (!NS || !RMSoloModels.native()) return;
    if (!setupWired) {
      setupWired = true;
      NS.watch(st => {
        renderNarratorLine();
        if (st.messaggio) toastSafe(st.messaggio);
        if (st.stato === 'pronto' && !RMSoloLLM.ready() && RMSoloLLM.status().stato !== 'caricamento') {
          RMSoloLLM.load().then(() => { renderNarratorLine(); if (S.view === 'gioco') { renderStatusLine(); narratePending(); } });
        }
      });
    }
    NS.ensure(opts).then(async st => {
      if (st.stato !== 'disponibile' || consentAsked || opts && opts.scarica) return;
      try { if (localStorage.getItem('rm_narratore_proposto_v1') === '1') return; } catch (e) {}
      consentAsked = true;
      try { localStorage.setItem('rm_narratore_proposto_v1', '1'); } catch (e) {}
      // iPhone: il Narratore è già nell'app (DECISIONI §15 H): si attiva, non si scarica
      const yes = st.incluso
        ? await modal('Attiva il Narratore', '<p>Attiva il Narratore: è già nell\'app, non serve scaricare nulla.</p><p>Puoi continuare a giocare anche senza.</p>',
          [{ label: 'Più tardi', value: false }, { label: 'Sì', value: true, cls: 'btn-primary' }])
        : await modal('Scarica il Narratore', '<p>Scarica il Narratore (' + gb(st.dimensione) + ', meglio con il Wi-Fi).</p><p>Puoi continuare a giocare anche senza scaricarlo.</p>',
        [{ label: 'Più tardi', value: false }, { label: 'Sì', value: true, cls: 'btn-primary' }]);
      if (yes) prepareNarrator({ scarica: true });
    });
  }
  function renderNarratorLine() {
    const el = $v('#solo-narratore'); if (!el) return;
    const NS = global.RMSoloNarratorSetup;
    if (!NS || !RMSoloModels.native()) { el.innerHTML = ''; return; }
    const st = NS.state();
    if (st.stato === 'scaricamento') {
      const pct = st.totale ? Math.min(100, Math.floor(st.fatto / st.totale * 100)) : 0;
      el.innerHTML = '<p class="solo-note">Download Narratore: ' + pct + '% — puoi continuare a giocare.</p><div class="solo-progress"><div style="width:' + pct + '%"></div></div>';
    } else if (st.stato === 'non_supportato' && st.messaggio) el.innerHTML = '<p class="solo-note">' + esc(st.messaggio) + '</p>';   // telefono con poca memoria
    else el.innerHTML = '';
  }

  function toastSafe(msg) { if (typeof toast === 'function') toast(msg); }

  /* ---------------------------------------------------------- nuova */
  async function startSetup(storia) {
    await contentFor(storia);
    // Prima la premessa della storia, poi la strada: «Scegli personaggio» (i preset) o «Crea il tuo»
    S.setup = { storia, difficolta: null, archetipo: null, vista: premessaHtml(storia) ? 'premessa' : 'via', confronto: [], tab: 'identita', ritratto: null, creatoId: null, ob: { tipo: null, dettaglio: '' }, errori: [] };
    renderSetup();
  }

  /* Scelta iniziale: la scheda del personaggio, non il volto, è il
     contenuto. Lista di carte compatte, anteprima completa con le sezioni
     della scheda dell'app, confronto fra due personaggi, conferma. */
  function previewSheet(a) {
    return Object.assign(RMSoloEngine.sheetFromArchetype(a, { roll: () => 1 }), { qi: null, ritratto: S.setup.ritratto && S.setup.archetipo === a.id ? S.setup.ritratto : null });
  }
  function pngNomi(content) { const o = {}; Object.entries(content.png || {}).forEach(([k, v]) => { o[k] = v.nome; }); return o; }
  // personaggi mostrati: in produzione solo quelli con ogni campo meccanico approvato
  function selezionabili(arch) { return arch.filter(a => RMSoloEngine.archetypeReady(a, anteprima())); }
  function sheetOpts(a, content) {
    // zaino iniziale con i nomi del catalogo della campagna
    const zaino = (a.inventarioIniziale || []).map(x => { const o = content.borsa.oggetti[x.id]; return o ? { nome: o.nome, qty: x.qty, descrizione: o.descrizione } : null; }).filter(Boolean);
    return { tab: S.setup.tab, editabile: true, ritrattoPredefinito: a.ritratto || '', id: a.id, archetipo: a, pngNomi: pngNomi(content), dev: devMode(), anteprima: anteprima(), zainoIniziale: zaino };
  }
  function renderSetup() {
    const { storia, vista } = S.setup;
    const content = S.content[storia];
    const arch = S.archetipi[storia].archetipi;
    const head = '<header class="solo-head"><button class="btn btn-ghost btn-sm" id="solo-back" aria-label="Indietro">←</button><div class="solo-head-txt"><h1>' + esc(STORIE_INFO[storia].titolo) + ' — nuova partita</h1><div class="solo-sub">' + esc(content.titolo) + '</div></div></header>';
    let body = '';
    if (vista === 'premessa') {
      body = premessaHtml(storia) +
        '<div class="solo-choose-bar"><button type="button" class="btn btn-primary solo-act" id="solo-premessa-avanti">Continua</button></div>';
    } else if (vista === 'via') {
      body = '<h2 class="solo-h2">Con chi giochi?</h2><div class="solo-choices" id="solo-via">' +
        '<button type="button" class="solo-choice" id="solo-via-preset"><b>Scegli personaggio</b><span>Uno dei personaggi della storia, già pronto: ne leggi la scheda e poi scegli.</span></button>' +
        '<button type="button" class="solo-choice" id="solo-via-crea"><b>Crea il tuo</b><span>La creazione guidata di «I miei personaggi», dentro il mondo di questa storia. Parti dal livello 1; armi, armature, tecniche e abilità iniziali le assegna il gioco.</span></button></div>';
    } else if (vista === 'obiettivo') {
      body = obiettivoHtml(storia);
    } else if (vista === 'scheda') {
      const a = arch.find(x => x.id === S.setup.archetipo);
      const errs = RMSoloEngine.validateArchetype(a, content);
      body = RMSoloSheet.render(previewSheet(a), sheetOpts(a, content)) +
        (errs.length ? '<p class="solo-warn">Scheda non valida: ' + esc(errs.join('; ')) + '</p>' : '') +
        '<div class="solo-choose-bar"><button type="button" class="btn btn-ghost solo-act" id="solo-lista">Torna ai personaggi</button>' +
        '<button type="button" class="btn btn-primary solo-act" id="solo-scegli"' + (errs.length ? ' disabled' : '') + '>Scegli questo personaggio</button></div>';
    } else if (vista === 'confronto') {
      const [x, y] = S.setup.confronto.map(id => arch.find(q => q.id === id));
      body = '<h2 class="solo-h2">Confronto</h2>' + RMSoloSheet.compare(x, previewSheet(x), y, previewSheet(y)) +
        '<div class="solo-choose-bar"><button type="button" class="btn btn-ghost solo-act" id="solo-lista">Torna ai personaggi</button>' +
        '<button type="button" class="btn btn-ghost solo-act" data-apri="' + esc(x.id) + '">Scheda di ' + esc(x.nome) + '</button>' +
        '<button type="button" class="btn btn-ghost solo-act" data-apri="' + esc(y.id) + '">Scheda di ' + esc(y.nome) + '</button></div>';
    } else {
      const n = S.setup.confronto.length;
      body = '<h2 class="solo-h2">1. Difficoltà</h2><div class="solo-choices" id="solo-diff">' +
        DIFF.map(d => '<button class="solo-choice' + (S.setup.difficolta === d.key ? ' selected' : '') + '" data-v="' + d.key + '"><b>' + d.label + '</b><span>' + d.desc + '</span></button>').join('') + '</div>' +
        '<h2 class="solo-h2">2. Personaggio</h2><p class="solo-note">Si parte sempre dal livello 1. Apri una scheda per vedere statistiche, tecniche, magie ed equipaggiamento, oppure confrontane due.</p>' +
        (selezionabili(arch).length ? '<div class="solo-pgcards" id="solo-arch">' + selezionabili(arch).map(a => RMSoloSheet.card(a, previewSheet(a), {
          confronto: S.setup.confronto.indexOf(a.id) !== -1,
          // note editoriali e campi mancanti: solo in sviluppo
          nota: !devMode() ? '' : [a.fixture_interna ? 'Fixture tecnica interna — bozza non approvata' : a.content_status && a.content_status !== 'approved' ? 'Proposta da approvare' : '',
            RMSoloEngine.archetypeReady(a, false) ? '' : 'Non disponibile in produzione: valori meccanici da approvare'].filter(Boolean).join(' · ')
        })).join('') + '</div>' : '<p class="solo-note" id="solo-arch-vuoto">I personaggi di questa storia non sono ancora disponibili.</p>') +
        '<div class="solo-choose-bar solo-compare-bar"><button type="button" class="btn btn-ghost solo-act" id="solo-confronta"' + (n === 2 ? '' : ' disabled') + '>Confronta' + (n ? ' (' + n + '/2)' : '') + '</button></div>';
    }
    render(head + body);
    $v('#solo-back').addEventListener('click', () => {
      const INDIETRO = { scheda: 'lista', confronto: 'lista', lista: 'via', obiettivo: 'via', via: premessaHtml(S.setup.storia) ? 'premessa' : null };
      if (INDIETRO[S.setup.vista]) { S.setup.vista = INDIETRO[S.setup.vista]; renderSetup(); }
      else if (S.origine && typeof openLibrarySettingPage === 'function') { const k = S.origine; S.origine = null; openLibrarySettingPage(k); }
      else renderHub();
    });
    root().querySelectorAll('#solo-diff .solo-choice').forEach(b => b.addEventListener('click', () => { S.setup.difficolta = b.dataset.v; renderSetup(); }));
    root().querySelectorAll('[data-apri]').forEach(b => b.addEventListener('click', () => {
      if (S.setup.archetipo !== b.dataset.apri) { S.setup.ritratto = null; S.setup.tab = 'identita'; }
      S.setup.archetipo = b.dataset.apri; S.setup.vista = 'scheda'; renderSetup(); window.scrollTo(0, 0);
    }));
    root().querySelectorAll('[data-confronta]').forEach(c => c.addEventListener('change', () => {
      const id = c.dataset.confronta, L = S.setup.confronto;
      if (c.checked && L.indexOf(id) === -1) { L.push(id); if (L.length > 2) L.shift(); }
      if (!c.checked) S.setup.confronto = L.filter(x => x !== id);
      renderSetup();
    }));
    const cf = $v('#solo-confronta'); if (cf) cf.addEventListener('click', () => { S.setup.vista = 'confronto'; renderSetup(); window.scrollTo(0, 0); });
    const li = $v('#solo-lista'); if (li) li.addEventListener('click', () => { S.setup.vista = 'lista'; renderSetup(); });
    const sc = $v('#solo-scegli'); if (sc) sc.addEventListener('click', chooseCharacter);
    if (vista === 'scheda') wireSheet(t => { S.setup.tab = t; renderSetup(); }, url => { S.setup.ritratto = url; renderSetup(); });
    const pa = $v('#solo-premessa-avanti'); if (pa) pa.addEventListener('click', () => { S.setup.vista = 'via'; renderSetup(); window.scrollTo(0, 0); });
    const vp = $v('#solo-via-preset'); if (vp) vp.addEventListener('click', () => { S.setup.vista = 'lista'; renderSetup(); window.scrollTo(0, 0); });
    const vc = $v('#solo-via-crea'); if (vc) vc.addEventListener('click', creaIlTuo);
    root().querySelectorAll('#solo-ob .solo-choice').forEach(b => b.addEventListener('click', () => { S.setup.ob.tipo = b.dataset.ob; S.setup.errori = []; renderSetup(); }));
    const det = $v('#solo-ob-dettaglio'); if (det) det.addEventListener('input', () => { S.setup.ob.dettaglio = det.value; });
    const ini = $v('#solo-inizia-creato'); if (ini) ini.addEventListener('click', iniziaCreato);
    const alt = $v('#solo-ob-altro'); if (alt) alt.addEventListener('click', altroPersonaggio);
  }

  /* ------------------------------------------------ «Crea il tuo» */
  /* Testo della premessa: quello della pagina della storia nella Biblioteca (library-settings.js). */
  function premessaDi(storia) {
    try {
      const set = typeof LIBRARY_SETTINGS !== 'undefined' ? LIBRARY_SETTINGS[storia] : null;
      const sec = set && (set.sections || []).find(x => /^premess/i.test(x.label || ''));
      if (sec) return (sec.blocks || []).filter(b => b && b.p).map(b => b.p);
      // trama d'autore senza pagina nel Compendio: la premessa pubblica della trama
      const c = S.content[storia];
      return c && c.contratto && c.contratto.premessa_pubblica ? [c.contratto.premessa_pubblica] : [];
    } catch (e) { return []; }
  }
  const paragrafi = L => L.map(t => '<p>' + esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</p>').join('');
  // Premessa del mondo (pagina del Compendio), letta prima di scegliere la storia: senza, i motivi della trama non si capiscono (autore, 8/11/2026)
  function premessaMondoHtml(mondo) { const L = premessaDi(mondo); return L.length ? '<div class="solo-premessa-mondo">' + paragrafi(L) + '</div>' : ''; }
  function premessaHtml(storia) { const L = premessaDi(storia); return L.length ? '<h2 class="solo-h2">Premessa</h2><div class="solo-premessa">' + paragrafi(L) + '</div>' : ''; }
  function datiStoria(storia) {
    if (!S.content[storia] || !S.archetipi[storia]) return null;
    return { content: S.content[storia], archetipi: S.archetipi[storia].archetipi, catalogo: S.content[storia].catalogo || null, pronto: a => RMSoloEngine.archetypeReady(a, anteprima()) };
  }
  function riassuntoCreato(c, storia) {
    const d = datiStoria(storia), sc = RMSoloLink.scelteDi(c), cs = RMSoloProprio.campi(storia, d.archetipi, d.catalogo);
    const voci = ['popolazione', 'citta', 'appartenenza', 'ruolo'].map(k => RMSoloProprio.nomeScelta(cs, sc, k)).filter(Boolean);
    return '<p class="solo-note"><b>' + esc(c.nome) + '</b> · ' + esc((BUILDS[c.build] || {}).label || c.build) + ' · livello 1' + (voci.length ? '<br>' + esc(voci.join(' · ')) : '') + '</p>';
  }
  function obiettivoHtml(storia) {
    const c = characters.find(x => x.id === S.setup.creatoId);
    if (!c) return '<p class="solo-warn">Il personaggio non c\'è più nella lista.</p><div class="solo-choose-bar"><button type="button" class="btn btn-primary solo-act" id="solo-ob-altro">Crea il tuo</button></div>';
    const ob = S.setup.ob, pronto = ob.tipo && S.setup.difficolta;
    return '<h2 class="solo-h2">Il tuo personaggio</h2>' + riassuntoCreato(c, storia) +
      '<h2 class="solo-h2">1. Obiettivo</h2><p class="solo-note">Che cosa cerchi in questa storia? Per ora lo scegli e lo ritrovi in scheda e diario; la trama non lo segue ancora.</p>' +
      '<div class="solo-choices" id="solo-ob">' + RMSoloProprio.obiettivi(storia).map(o =>
        '<button type="button" class="solo-choice' + (ob.tipo === o.id ? ' selected' : '') + '" data-ob="' + esc(o.id) + '"><b>' + esc(o.nome) + '</b></button>').join('') + '</div>' +
      '<label class="solo-label" for="solo-ob-dettaglio">Un dettaglio tuo (facoltativo)</label>' +
      '<textarea id="solo-ob-dettaglio" class="solo-textarea" rows="3" maxlength="' + RMSoloProprio.DETTAGLIO_MAX + '" placeholder="Per chi lo fai, che cosa ti spinge…">' + esc(ob.dettaglio) + '</textarea>' +
      '<h2 class="solo-h2">2. Difficoltà</h2><div class="solo-choices" id="solo-diff">' +
      DIFF.map(d => '<button class="solo-choice' + (S.setup.difficolta === d.key ? ' selected' : '') + '" data-v="' + d.key + '"><b>' + d.label + '</b><span>' + d.desc + '</span></button>').join('') + '</div>' +
      ((S.setup.errori || []).length ? '<p class="solo-warn" role="alert">' + esc(S.setup.errori.join(' ')) + '</p>' : '') +
      (pronto ? '' : '<p class="solo-note solo-small">Scegli un obiettivo e la difficoltà per iniziare.</p>') +
      '<div class="solo-choose-bar"><button type="button" class="btn btn-ghost solo-act" id="solo-ob-altro">Crea un altro personaggio</button>' +
      '<button type="button" class="btn btn-primary solo-act" id="solo-inizia-creato"' + (pronto ? '' : ' disabled') + '>Inizia la storia</button></div>';
  }
  /* «Crea il tuo»: apre la creazione guidata normale. Una bozza già iniziata si riprende. */
  async function creaIlTuo() {
    const { storia } = S.setup;
    await contentFor(storia);
    const bozza = RMSoloLink.bozzaInCorso(storia);
    if (bozza && bozza.creationCompleted) { S.setup.creatoId = bozza.id; S.setup.vista = 'obiettivo'; renderSetup(); window.scrollTo(0, 0); return; }
    if (bozza) { openCreationWizard(bozza.id, true); return; }
    createCharacterFlow({ solo: { storia, titolo: (STORIE_INFO[storia] || {}).titolo || storia } });
  }
  /* Fine della creazione guidata: si torna qui per obiettivo e difficoltà. */
  async function creazioneCompletata(c) {
    const storia = c.soloCreazione.storia;
    await contentFor(storia);
    S.setup = { storia, difficolta: null, archetipo: null, vista: 'obiettivo', confronto: [], tab: 'identita', ritratto: null, creatoId: c.id, ob: { tipo: null, dettaglio: '' }, errori: [] };
    if (typeof showView === 'function') showView('solo');
    renderSetup();
    window.scrollTo(0, 0);
  }
  /* Il personaggio completato resta nella lista come personaggio normale; se ne crea un altro. */
  function altroPersonaggio() {
    const c = characters.find(x => x.id === S.setup.creatoId);
    if (c) delete c.soloCreazione;
    saveAll();
    S.setup.creatoId = null; S.setup.vista = 'via';
    creaIlTuo();
  }
  async function iniziaCreato() {
    const { storia, difficolta, ob } = S.setup;
    if (!(await contenutoAvviabile(storia))) return;
    const c = characters.find(x => x.id === S.setup.creatoId);
    if (!c) { S.setup.vista = 'via'; return renderSetup(); }
    const d = datiStoria(storia);
    const r = RMSoloProprio.archetipoDaPersonaggio(storia, d.archetipi, c, RMSoloLink.scelteDi(c), ob, d.pronto, d.catalogo);
    if (r.errori) { S.setup.errori = r.errori; return renderSetup(); }
    const errs = RMSoloEngine.validateArchetype(r.arch, d.content);
    if (errs.length) { S.setup.errori = ['Il personaggio non è ammesso in questa storia: ' + errs.join('; ')]; return renderSetup(); }
    const diff = (DIFF.find(x => x.key === difficolta) || {}).label || difficolta;
    const ok = await modal('Confermi il personaggio?', '<p>Inizierai questa storia con ' + esc(r.arch.nome) + ', al livello 1. Il personaggio resterà legato esclusivamente a questa avventura e comparirà in «I miei personaggi». Vuoi proseguire?</p><p class="solo-note">Difficoltà: ' + esc(diff) + '.</p>',
      [{ label: 'Torna indietro', value: false }, { label: 'Prosegui', value: true, cls: 'btn-primary' }]);
    if (!ok) return;
    const content = contentDi(storia, Object.assign({ archetipo: r.arch.id }, r.arch));
    let nuovo = RMSoloEngine.newGame({ content, archetipo: r.arch, difficolta, dice: RMSoloRules.makeDice(), now: Date.now(), id: 'solo-' + uuid(), anteprima: anteprima() });
    nuovo = RMSoloMondo.accendiSePredefinito(nuovo, motoreNuovo(), narratoreAddestratoPronto());
    if (typeof c.portrait === 'string' && c.portrait) nuovo.personaggio.ritratto = c.portrait;
    await registraPartita(storia, nuovo);
  }

  async function chooseCharacter() {
    if (!(await contenutoAvviabile(S.setup.storia))) return;
    const a = S.archetipi[S.setup.storia].archetipi.find(x => x.id === S.setup.archetipo);
    if (!S.setup.difficolta) {
      const d = await modal('Scegli la difficoltà', '<p>Prima di iniziare scegli la difficoltà: non si potrà cambiare durante la partita.</p>',
        DIFF.map(x => ({ label: x.label, value: x.key })).concat([{ label: 'Annulla', value: null }]));
      if (!d) return;
      S.setup.difficolta = d;
    }
    const diff = (DIFF.find(x => x.key === S.setup.difficolta) || {}).label || S.setup.difficolta;
    const ok = await modal('Confermi il personaggio?', '<p>Inizierai questa storia con ' + esc(a.nome) + ', al livello 1. Il personaggio resterà legato esclusivamente a questa avventura. Vuoi proseguire?</p><p class="solo-note">Difficoltà: ' + esc(diff) + '.</p>',
      [{ label: 'Torna alla scheda', value: false }, { label: 'Prosegui', value: true, cls: 'btn-primary' }]);
    if (ok) confirmStart();
  }

  async function confirmStart() {
    const { storia, difficolta, archetipo } = S.setup;
    await contentFor(storia);
    if (!(await contenutoAvviabile(storia))) return;
    const arch = S.archetipi[storia].archetipi.find(x => x.id === archetipo);
    const content = contentDi(storia, Object.assign({ archetipo: arch.id }, arch));
    let nuovo = RMSoloEngine.newGame({ content, archetipo: arch, difficolta, dice: RMSoloRules.makeDice(), now: Date.now(), id: 'solo-' + uuid(), anteprima: anteprima() });
    nuovo = RMSoloMondo.accendiSePredefinito(nuovo, motoreNuovo(), narratoreAddestratoPronto());
    if (S.setup.ritratto) nuovo.personaggio.ritratto = S.setup.ritratto;
    await registraPartita(storia, nuovo);
  }

  // Un finale non deciso non diventa un finale tecnico di ripiego.
  // Si possono leggere premessa e scheda; lo slot resta intatto.
  async function contenutoAvviabile(storia) {
    const content = await contentFor(storia);
    const problemi = RMSoloCampaign.validateCampaign(content);
    if (!problemi.length) return true;
    await modal('Storia in revisione', '<p>Questa storia non può ancora iniziare: occorre completare e verificare la sua conclusione.</p>' +
      (devMode() ? '<p class="solo-note">' + esc(problemi.join('; ')) + '</p>' : ''),
      [{ label: 'Torna alla scheda', value: false }]);
    return false;
  }

  /* Salva la nuova partita nello slot della storia (con la procedura di sostituzione) e la apre. */
  async function registraPartita(storia, nuovo) {
    const slot = await RMSoloStore.get(storia);
    if (slot && slot.partita) {
      const ok = S.sostituzioneConfermata || await replaceFlow();
      S.sostituzioneConfermata = false;
      if (!ok) return;
      try { await RMSoloStore.replace(storia, slot.partita.id, nuovo); }
      catch (e) { toastSafe('Sostituzione annullata: ' + e.message); return renderHub(); }
    } else {
      await RMSoloStore.create(nuovo);
    }
    if (typeof markGettingStartedComplete === 'function') markGettingStartedComplete();
    openGame(storia);
  }

  /* Prima di sostituire una partita: una sola conferma. */
  async function replaceFlow() {
    const ans = await modal('Slot occupato', '<p>La partita attuale verrà sostituita.</p>',
      [{ label: 'Annulla', value: false }, { label: 'Sostituisci', value: true, cls: 'btn-primary' }]);
    return ans === true;
  }

  /* ---------------------------------------------------------- partita */
  async function openGame(storia) {
    await contentFor(storia);
    const slot = await RMSoloStore.get(storia);
    if (!slot || !slot.partita) return renderHub();
    const content = contentDi(storia, slot.partita.personaggio);
    const arch = ((S.archetipi[storia] || {}).archetipi || []).find(a => a.id === slot.partita.personaggio.archetipo);
    S.storia = storia; S.state = RMSoloMondo.accendiSePredefinito(RMSoloEngine.migrate(slot.partita, arch, content), motoreNuovo(), narratoreAddestratoPronto()); S.view = 'gioco'; S.tab = 'gioco'; S.eventiVisti = 0; S.diarioVisto = S.state.eventi.length; S.ingressoSig = null;
    // il personaggio vero nella lista di «I miei personaggi» (anche se era stato eliminato)
    if (global.RMSoloLink && typeof characters !== 'undefined') { try { RMSoloLink.collega(S.state, (STORIE_INFO[storia] || {}).titolo || storia); saveAll(); } catch (e) { /* la partita non dipende dalla lista */ } }
    renderGame();
    // una conseguenza rimasta senza racconto (app chiusa a metà) riceve
    // subito almeno il testo di riserva: le azioni non restano nascoste
    narratePending();
    // modello: preparazione e caricamento in background, mai bloccanti
    prepareNarrator();
    if (!RMSoloLLM.ready() && (devMode() || !global.RMSoloNarratorSetup || global.RMSoloNarratorSetup.state().stato !== 'scaricamento')) RMSoloLLM.load().then(() => { if (S.view === 'gioco') { renderStatusLine(); narratePending(); } });
    narratePending();
  }

  function narrBadge(n) {
    if (!n || n.stato === 'da_generare') return '<span class="solo-badge pending">narrazione in attesa</span>';
    const lab = { ia: 'IA locale', riserva: 'testo di riserva', fissa: 'testo fisso' }[n.fonte] || n.fonte;
    return '<span class="solo-badge ' + esc(n.fonte) + '" title="' + esc(n.modello || '') + (n.scarto ? ' — scartata: ' + esc(n.scarto.join(', ')) : '') + (n.voce && n.voce.avvisi.length ? ' — voce: ' + esc(n.voce.avvisi.join(', ')) : '') + '">' + lab + (n.ms ? ' · ' + (n.ms / 1000).toFixed(1) + 's' : '') + '</span>';
  }

  function checkLine(ev) {
    const c = ev.check || (ev.conoscenza && ev.conoscenza.check);
    if (!c) return '';
    const d = c.tipo === 'tratto' ? 'd20 ' + c.d20 + ' + ' + esc(c.trait) + ' ' + c.traitValue + (c.mod ? (c.mod > 0 ? ' +' : ' ') + c.mod : '') + ' = ' + c.total + ' vs NC ' + c.nc
      : 'senza competenza: d100 ' + c.d100 + ' − 20' + (c.mod ? ' ' + (c.mod > 0 ? '+' : '') + c.mod * 5 : '') + ' = ' + c.total + ' vs 50';
    const margine = c.total - (c.tipo === 'tratto' ? c.nc : c.soglia);
    return '<div class="solo-roll">🎲 ' + d + ' · Scarto dalla soglia: ' + (margine >= 0 ? '+' : '') + margine + ' → <b>' + esc(ESITI[ev.esito || c.esito] || ev.esito || c.esito) + '</b></div>';
  }

  /* Voci meccaniche dell'evento, una per riga (pannello Esito). */
  function effectItems(ev, content) {
    return (ev.effetti || []).map(a => {
      if (a.tipo === 'ricompensa') return '🎒 ' + esc(a.nome);
      if (a.tipo === 'scoperta') return '🔎 ' + esc(a.testo);
      if (a.tipo === 'costo') return '− ' + (-a.delta) + ' ' + esc(a.risorsa);
      if (a.tipo === 'hp') return '❤ ' + a.delta + ' HP';
      if (a.tipo === 'orologio') return '⏳ ' + esc(((content.orologi || {})[a.orologio] || {}).nome || a.orologio) + ' ' + a.valore + '/' + a.max;
      if (a.tipo === 'orologio_pieno') return '⌛ ' + esc(a.nome || a.orologio);
      if (a.tipo === 'risorsa') return '▣ ' + esc(a.nome || a.risorsa) + ' ' + (a.delta >= 0 ? '+' : '') + a.delta;
      if (a.tipo === 'custode') return '⇄ ' + esc(a.nome) + ' → ' + esc(content.png[a.png].nome);
      if (a.tipo === 'oggetto_perso') return '✕ perso: ' + esc(a.nome);
      if (a.tipo === 'oggetto_salvo') return '✓ ' + esc(a.nome) + ' resta con te';
      if (a.tipo === 'asse') return null; // gli assi di esito non si mostrano come punteggio
      if (a.tipo === 'relazione') return (a.delta > 0 ? '▲ ' : '▼ ') + esc(content.png[a.png].nome);
      if (a.tipo === 'avanzamento') return '⬆ Livello ' + a.livello + ' (+' + (a.apGuadagnati != null ? a.apGuadagnati : a.ap) + ' AP)';
      if (a.tipo === 'capacita_lv') return '⬆ ' + esc(a.capacita) + ' Lv ' + a.lv;
      if (a.tipo === 'nuova_capacita') return '✦ impari: ' + esc(a.nome);
      if (a.tipo === 'magia_senza_gemme') return '⚠ magia senza gemme';
      if (a.tipo === 'ricercato') return RMSoloGenere.applica('⚠ {sei ricercato|sei ricercata|ti cercano}', S.state && S.state.personaggio && S.state.personaggio.genere);
      if (a.tipo === 'loot_scoperto') return '✦ trovato: ' + esc(a.nome);
      if (a.tipo === 'consumato') return '− ' + esc(a.nome);
      if (a.tipo === 'atto') return '§ Atto ' + ['', 'I', 'II', 'III'][a.numero] + ': ' + esc(a.titolo || '');
      if (a.tipo === 'promessa') return '✎ promessa: ' + esc(a.testo);
      if (a.tipo === 'promessa_esito') return '✎ promessa ' + esc(a.stato);
      if (a.tipo === 'reputazione') return (a.delta > 0 ? '▲ ' : '▼ ') + esc(a.fazione);
      if (a.tipo === 'voce') return '🗣 si dice: «' + esc(a.testo) + '»';
      if (a.tipo === 'nota') return ({ indizio: '🔎 indizio: ', cambiamento: '↻ la scena cambia: ' }[a.categoria] || '✎ diario: ') + esc(a.testo);
      if (a.tipo === 'vantaggio') return '＋ vantaggio nella prova' + (a.motivo ? ': ' + esc(a.motivo) : '');
      if (a.tipo === 'svantaggio') return '－ svantaggio nella prova' + (a.motivo ? ': ' + esc(a.motivo) : '');
      if (a.tipo === 'pressione') return '⏳ ' + esc(a.nome) + ' ' + a.valore + '/' + a.max;
      if (a.tipo === 'sposta') return '→ ' + esc(a.chi) + ': ' + esc(a.dove);
      if (a.tipo === 'atteggiamento') return (a.delta > 0 ? '▲ ' : '▼ ') + 'atteggiamento di ' + esc(content.png[a.png].nome);
      if (a.tipo === 'incontro_inizia') return '⚔ Scontro: ' + esc(a.nemico);
      if (a.tipo === 'gemma_scarica') return '◇ ' + esc(a.nome) + ' scarica: ' + esc(a.capacita) + ' non disponibile fino al reintegro';
      if (a.tipo === 'gemma_reintegrata') return '◆ ' + esc(a.nome) + ' di nuovo attiva: ' + esc(a.capacita);
      if (a.tipo === 'filo') return (a.stato === 'aperto' ? '✦ nuovo filo: ' : '✓ filo chiuso: ') + esc(a.titolo);
      return null;
    }).filter(Boolean);
  }

  /* Fiducia: nel racconto solo quando la relazione cambia di soglia (stesse soglie del Diario, relazioneTesto in
     solo-feedback.js); ogni variazione, anche piccola, va comunque nel Diario (vociDiario). */
  const bandaFiducia = v => v >= 3 ? 3 : v >= 1 ? 2 : v <= -3 ? -3 : v <= -1 ? -2 : 0;
  function fiduciaFrase(ev, content) {
    const f = (ev.effetti || []).filter(a => a.tipo === 'relazione' && Number.isFinite(a.valore) && bandaFiducia(a.valore) !== bandaFiducia(a.valore - a.delta) && content.png[a.png]).map(a => {
      const nome = esc(content.png[a.png].nome), b = bandaFiducia(a.valore);
      return nome + (b >= 3 ? ' ti affida ormai la sua piena fiducia.' : b === 2 ? ' ha cominciato a fidarsi di te.' : b <= -3 ? ' è ormai ostile.' : b === -2 ? ' diffida di te.' : a.delta > 0 ? ' non diffida più di te.' : ' non si fida più come prima.');
    });
    return f.length ? '<p class="solo-relazione">' + f.join(' ') + '</p>' : '';
  }
  /* Voci del Diario per esteso, senza prefissi da registro: tutto ciò che prima compariva come notifica sotto il racconto. */
  /* Fatti: solo quelli comunicati dal racconto, nella voce dell'evento in cui il giocatore li ha letti, con il testo canonico (le sole
     unità lette, se è stato detto a metà). Contratto docs/single-player/CONTRATTO_MEMORIA_NARRATORE.md §3.4. */
  function vociDiario(ev, content, state) {
    const st = state || S.state;
    const png = id => (content.png[id] || {}).nome || id;
    const comunicati = st && st.fattiComunicati && window.RMSoloComunicati;
    const fatti = comunicati ? RMSoloComunicati.comunicatiInEvento(st, content, ev.n).map(x => x.testo) : [];
    return (ev.effetti || []).map(a => {
      if (a.tipo === 'scoperta' && comunicati) return null;
      if (a.tipo === 'relazione') return png(a.png) + (a.delta > 0 ? ' si fida di più di te.' : ' si fida meno di te.');
      if (a.tipo === 'ricompensa' || a.tipo === 'loot_scoperto') return 'Hai ottenuto: ' + a.nome + '.';
      if (a.tipo === 'scoperta' || a.tipo === 'nota') return a.testo;
      if (a.tipo === 'costo' && a.risorsa !== 'HP' && a.risorsa !== 'MP' && a.delta) return 'Hai speso ' + (-a.delta) + ' ' + a.risorsa + '.';
      if (a.tipo === 'voce') return 'Si dice: «' + a.testo + '».';
      if (a.tipo === 'oggetto_perso') return 'Hai perso: ' + a.nome + '.';
      if (a.tipo === 'filo') return (a.stato === 'aperto' ? 'Un nuovo filo si apre: ' : 'Un filo si chiude: ') + a.titolo + '.';
      if (a.tipo === 'atto') return 'Atto ' + ['', 'I', 'II', 'III'][a.numero] + (a.titolo ? ': ' + a.titolo : '') + '.';
      if (a.tipo === 'orologio_pieno') return (a.nome || a.orologio) + ': il tempo è scaduto.';
      if (a.tipo === 'gemma_scarica') return a.nome + ' si è scaricata: ' + a.capacita + ' non è disponibile fino al reintegro.';
      if (a.tipo === 'gemma_reintegrata') return a.nome + ' è di nuovo attiva: ' + a.capacita + '.';
      if (a.tipo === 'ricercato') return RMSoloGenere.applica('{Sei ricercato|Sei ricercata|Ti cercano}.', S.state && S.state.personaggio && S.state.personaggio.genere);
      if (a.tipo === 'magia_senza_gemme') return 'Hai usato la magia senza gemme davanti a dei testimoni.';
      return null;
    }).filter(Boolean).concat(fatti);
  }
  function novitaDiario(state, content) {
    const out = [];
    state.eventi.forEach(ev => vociDiario(ev, content, state).forEach(t => out.push(t)));
    return out.reverse();
  }
  /* Puntino sul Diario: c'è una voce arrivata dopo l'ultima volta che l'hai aperto. */
  function diarioNuovo(state, content) {
    const visto = S.diarioVisto == null ? state.eventi.length : S.diarioVisto;
    return state.eventi.slice(visto).some(ev => ev.narrazione && ev.narrazione.stato === 'pronta' && vociDiario(ev, content, state).length);
  }

  /* Notifiche brevi (non più mostrate al giocatore: vedi vociDiario). Restano le voci meccaniche per chi sviluppa. */
  const NOTIFICA = ['gemma_scarica', 'gemma_reintegrata', 'relazione', 'voce', 'ricompensa', 'scoperta', 'loot_scoperto', 'nota', 'vantaggio', 'svantaggio', 'oggetto_perso', 'custode', 'atto', 'orologio_pieno', 'ricercato', 'magia_senza_gemme', 'sposta', 'incontro_inizia', 'filo'];
  function notifications(ev, content) {
    const items = (ev.effetti || []).filter(a => NOTIFICA.indexOf(a.tipo) !== -1).map(a => {
      if (a.tipo === 'relazione') return (a.delta > 0 ? '▲ ' : '▼ ') + esc(content.png[a.png].nome) + (a.delta > 0 ? ' si fida di più' : ' si fida di meno');
      return effectItems({ effetti: [a] }, content)[0];
    }).filter(Boolean);
    return items.length ? '<ul class="solo-notes">' + items.map(t => '<li>' + t + '</li>').join('') + '</ul>' : '';
  }
  /* Punti ancora da spendere (AP o punti tratto): fa comparire il pallino
     sulla linguetta Scheda e il pulsante nell'avviso di livello. */
  function haPuntiDaSpendere(state) {
    return !!(state && state.personaggio && RMSoloEngine.improvementOptions(state.personaggio).spendibile);
  }
  function levelNotice(ev, state) {
    const migliora = haPuntiDaSpendere(state) && !RMSoloEngine.isOver(state);
    return (ev.effetti || []).filter(a => a.tipo === 'avanzamento').map(a =>
      '<div class="solo-levelup" role="status"><div class="solo-levelup-row">⬆ Livello ' + a.livello + ' raggiunto <span>+' + (a.apGuadagnati != null ? a.apGuadagnati : a.ap) + ' AP</span></div>' +
      (migliora ? '<button type="button" class="btn btn-primary btn-sm solo-act" data-migliora="1">Migliora il personaggio</button>' : '') + '</div>').join('');
  }
  /* Level up non ancora completato: la storia è bloccata (lo impone il motore). */
  function levelUpBlock(state) {
    const off = RMSoloEngine.slotOffers(state, gameContent());
    return '<section class="solo-actions solo-levelup-lock" id="solo-actions" role="status"><p><b>Level up da completare.</b> La storia riprende quando avrai ' + (off.totale ? 'assegnato le nuove capacità, ' : '') + 'speso i punti o concluso il level up.</p>' +
      slotPanel(off) +
      '<button type="button" class="btn btn-primary solo-act" data-migliora="1">Vai al level up</button></section>';
  }
  /* Level up di una Tecnica o Abilità: il danno è già salito; il giocatore sceglie il pregio del livello fra quelli
     disponibili. Lo sceglie lui, lo applica il motore (comando «pregio»); il Narratore non c'entra. */
  function pregioPanel(state) {
    const dis = S.busy ? ' disabled' : '';
    const blocchi = RMSoloEngine.pregiInAttesa(state).map(x => {
      const gruppi = [['durata', 'Durata'], ['incremento', 'Incremento di statistica'], ['stato_maggiorato', 'Effetto di stato maggiorato'], ['stato_nuovo', 'Un effetto di stato in più']];
      return '<div class="solo-capslot"><h3 class="solo-h3">' + esc(x.nome) + ' sale al Lv ' + x.lv + '</h3>' +
        (x.dannoBase != null ? '<p class="solo-muted">Il danno base sale a ' + x.dannoBase + '.</p>' : '') +
        '<p class="solo-muted">Scegli il pregio di questo livello:</p>' +
        gruppi.map(([k, titolo]) => {
          const o = x.opzioni.filter(y => y.pregio === k);
          return o.length ? '<div class="solo-cap-esempi"><b>' + titolo + '</b>' + o.map(y => '<button type="button" class="btn btn-primary btn-sm solo-act" data-pregio="' + y.pregio + '" data-ab="' + esc(x.id) + '"' + (y.stato ? ' data-stato="' + esc(y.stato) + '"' : '') + dis + '>' + esc(y.etichetta) + '</button>').join('') + '</div>' : '';
        }).join('') + '</div>';
    }).join('');
    return '<section class="solo-actions solo-levelup" id="solo-pregio"><p class="solo-warn"><b>Una capacità è salita di livello.</b> Scegli il pregio per proseguire.</p>' + blocchi + '</section>';
  }
  /* Nuovi slot di tecniche e abilità: per ciascuno 2-3 esempi del tuo gruppo e della tua classe («Scegli un esempio»)
     oppure una capacità scritta da te, entro il tetto di danno delle capacità di Lv 1. Lo slot va assegnato per
     concludere il level up (lo impone il motore, assegna_slot). */
  function slotPanel(off) {
    if (!off.totale) return '';
    const dis = S.busy ? ' disabled' : '';
    const STAT = [['for', 'Forza'], ['dex', 'Destrezza'], ['mira', 'Mira'], ['fmen', 'Forza Magica']];
    const STAT_BONUS = [['for', 'Forza'], ['mira', 'Mira'], ['vel', 'Velocità'], ['fmen', 'Forza Magica'], ['dex', 'Destrezza'], ['dif', 'Difesa'], ['dmen', 'Difesa Magica']];
    const opz = l => l.map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('');
    const blocco = (kind, titolo) => {
      const n = off.liberi[kind];
      if (!n) return '';
      return '<div class="solo-capslot" data-slot-kind="' + kind + '"><h3 class="solo-h3">' + titolo + ' da assegnare: ' + n + '</h3>' +
        (off[kind].length ? '<p class="solo-muted">Scegli un esempio del tuo gruppo e della tua classe:</p><div class="solo-cap-esempi">' + off[kind].map(c =>
          '<div class="solo-cap-card"><b>' + esc(c.nome) + '</b><small>' + esc(c.effetto) + '</small><button type="button" class="btn btn-primary btn-sm solo-act" data-kind="' + kind + '" data-slot-esempio="' + esc(c.id) + '"' + dis + '>Scegli</button></div>').join('') + '</div>'
          : '<p class="solo-muted">Gli esempi del tuo gruppo sono finiti: scrivine una tua.</p>') +
        '<details class="solo-cap-own"><summary>Oppure scrivine una tua</summary>' +
        '<form class="solo-cap-form" data-slot-propria="1" data-kind="' + kind + '">' +
        '<label>Nome <input name="nome" maxlength="40" required' + dis + '></label>' +
        '<label>Effetto <select name="tipo"' + dis + '><option value="danno">Danno</option><option value="supporto">Supporto</option></select></label>' +
        '<label>Danno base (al massimo ' + off.tetto + ') <input name="dannoBase" type="number" min="0" max="' + off.tetto + '" value="6"' + dis + '></label>' +
        '<label>Statistica del colpo <select name="stat"' + dis + '>' + opz(STAT) + '</select></label>' +
        (kind === 'abilita' ? '<label>Tipo di danno <select name="dannoTipo"' + dis + '><option value="fisico">Fisico</option><option value="magico">Magico</option></select></label>' : '') +
        '<label>Bonus (supporto) <select name="bonusStat"' + dis + '>' + opz(STAT_BONUS) + '</select></label>' +
        '<label>Valore del bonus <input name="bonusValore" type="number" min="1" max="3" value="1"' + dis + '></label>' +
        '<label>Durata <select name="durata"' + dis + '><option value="turno">1 turno</option><option value="due">2 turni</option><option value="tre">3 turni</option></select></label>' +
        '<button type="submit" class="btn btn-primary btn-sm solo-act"' + dis + '>Assegna</button></form></details></div>';
    };
    return '<div class="solo-capnuove">' + blocco('tecniche', 'Tecnica') + blocco('abilita', 'Abilità') + '</div>';
  }
  /* Strumenti di prova: SOLO in modalità sviluppatore (?ff_solo_dev_v1=1),
     mai nella build play. Non sono comandi di gioco. */
  function devTools(state) {
    if (!devMode() || !state) return '';
    return '<section class="solo-dev solo-devtools" id="solo-devtools" aria-label="Strumenti di prova"><b>Strumenti di prova</b>' +
      '<div class="solo-btns solo-grid"><button type="button" class="' + ACT + '" data-dev="levelup">Simula level up</button>' +
      '<button type="button" class="' + ACT + '" data-dev="danneggia">Danneggia equipaggiamento</button></div></section>';
  }
  async function devTool(nome) {
    if (!devMode() || S.busy || !S.state) return;
    setBusy(true);
    try {
      const r = nome === 'levelup' ? RMSoloEngine.devSimulaLevelUp(S.state, gameContent()) : RMSoloEngine.devDanneggiaEquip(S.state);
      await RMSoloStore.save(r.state); S.state = r.state;
      if (nome === 'levelup') { S.tab = 'gioco'; }
    } catch (e) { toastSafe(e.message); }
    finally { setBusy(false); renderGame(); }
  }
  /* Perché la spesa è ferma adesso (il motore la rifiuterebbe comunque). */
  function motivoSpesaBloccata(state) {
    if (S.busy) return 'Attendi la fine dell\'azione in corso.';
    // con il level up aperto si spende anche a metà scontro, dialogo o viaggio: riprendono dopo
    if (state.personaggio.levelUpInAttesa) return RMSoloEngine.isOver(state) ? 'La partita è conclusa.' : '';
    if (state.incontro) return 'Non durante uno scontro.';
    if (state.interazione && state.interazione.dialogo) return 'Non durante un dialogo: concludilo prima.';
    if (state.mappa && state.mappa.viaggio && state.mappa.viaggio.stato === 'in_corso') return 'Non durante un viaggio.';
    if (RMSoloEngine.isOver(state)) return 'La partita è conclusa.';
    return '';
  }
  const ESITI = { successo: 'Successo', parziale: 'Successo parziale', fallimento: 'Fallimento', critico: 'Successo critico', successo_critico: 'Successo critico', successo_pieno: 'Successo pieno', fallimento_critico: 'Fallimento critico' };
  /* Prova confermata (4/11/2026): il tiro appena fatto, prima del racconto. Valore, calcolo, soglia ed esito delle regole. */
  function diceLine(ev) {
    const ck = ev.check;
    if (!ck) return '';
    const e = ESITI[ck.esito] || ck.esito;
    const segno = m => (m > 0 ? ' + ' : ' − ') + Math.abs(m);
    const calcolo = ck.tipo === 'inesperto'
      ? 'd100: <b>' + esc(ck.d100) + '</b> − 20 = ' + esc(ck.total) + ' · serve 50'
      : 'd20: <b>' + esc(ck.d20) + '</b> + ' + esc(ck.trait) + ' ' + esc(ck.traitValue) + (ck.mod ? segno(ck.mod) : '') + ' = ' + esc(ck.total) + ' · serve ' + esc(ck.nc);
    return '<p class="solo-dado ' + esc(ck.esito) + '" aria-label="Risultato del tiro">' + calcolo + ' → <b>' + esc(e) + '</b></p>';
  }
  function provaPanel(state) {
    const pa = state.provaInAttesa, p = pa.prova;
    const mods = (p.modificatori || []).map(m => esc(m.nome) + ' ' + (m.valore > 0 ? '+' : '−') + Math.abs(m.valore)).join(', ');
    const righe = p.tipo === 'inesperto'
      ? ['Non hai competenza in ' + esc(p.tratto || 'questa prova') + ': si tira senza bonus.', 'Si tira: <b>d100 − 20</b>. Serve almeno <b>50</b>.']
      : ['Competenza: <b>' + esc(p.tratto) + ' ' + esc(p.valore) + '</b>.', 'Si tira: <b>' + esc(p.formula) + '</b>' + (mods ? ' (' + mods + ')' : '') + '. Serve almeno <b>' + esc(p.nc) + '</b>.'];
    return '<section class="solo-actions solo-prova" id="solo-actions" aria-label="Prova da tirare"><h3 class="solo-h3">Prova di ' + esc(p.tratto || 'abilità') + (p.tipo === 'inesperto' ? ', senza competenza' : '') + '</h3>' +
      (pa.comando && pa.comando.testo ? '<p class="solo-muted">Azione: «' + esc(pa.comando.testo) + '»</p>' : '') +
      righe.map(r => '<p>' + r + '</p>').join('') +
      '<div class="solo-prova-azioni"><button class="btn btn-primary" id="solo-tira">Tira il ' + esc(p.dado) + '</button>' +
      '<button class="' + ACT + '" id="solo-prova-annulla">Non è questo che intendo</button></div>' +
      '<p class="solo-muted"><small>Se l\'azione è stata capita male, annulla e riscrivila: il motore la esamina di nuovo. Il tratto non si sceglie da un elenco.</small></p></section>';
  }
  function outcomeLine(ev) {
    if (!ev.check) return '';
    const e = ev.esito || ev.check.esito;
    // gli esiti critici li racconta il Narratore: nessuna etichetta
    if (/critico/.test(e)) return ev.obiettivoTesto ? '<p class="solo-outcome">' + esc(ev.obiettivoTesto) + '</p>' : '';
    return '<p class="solo-outcome ' + esc(e) + '"><b>' + esc(ESITI[e] || e) + '</b>' + (ev.obiettivoTesto ? ' — ' + esc(ev.obiettivoTesto) : '') + '</p>';
  }
  /* Riepilogo tecnico: valori già applicati dal motore, separati dal
     racconto. Gli stati mostrano bersaglio, durata, effetto e fonte. */
  function techBlock(r) {
    if (!r) return '';
    const righe = (r.effettiTecnici || []).filter(t => t.tipo !== 'stato').map(t => '<li class="solo-tech-' + esc(t.tipo) + '">' + esc(t.testo) + '</li>');
    const stati = (r.cambiamentiDiStato || []).filter(c => c.tipo === 'stato').map(c =>
      '<li class="solo-tech-stato"><b>' + esc(c.bersaglio) + '</b><br>' + (c.azione === 'rimosso' ? 'Stato rimosso: ' : 'Stato applicato: ') + esc(c.nome) +
      (c.azione === 'applicato' ? '<br>Durata: ' + esc(c.durata) + '<br>Effetto: ' + esc(c.effetto) : '') + '<br><small>Fonte: ' + esc(c.fonte) + '</small></li>');
    const all = righe.concat(stati);
    return all.length ? '<ul class="solo-tech" aria-label="Riepilogo tecnico">' + all.join('') + '</ul>' : '';
  }
  function transitionBlock(r) {
    const t = r && r.transizione;
    if (!t) return '';
    return '<aside class="solo-transition" aria-label="Spostamento"><p>' + esc(t.testo) + '</p><p class="solo-small">' + esc(t.luogoPartenza) + ' → ' + esc(t.luogoArrivo) +
      ' · ' + esc(t.modalita) + ' · ' + esc(t.durataNarrativa) + (t.condizioniArrivo.length ? ' · all\'arrivo: ' + esc(t.condizioniArrivo.join(', ')) : '') + '</p>' +
      (t.decompressione ? '<p class="solo-aftermath">' + esc(t.decompressione) + '</p>' : '') + '</aside>';
  }
  function detailsPanel(ev, content, n, ultimo) {
    const mecc = [checkLine(ev), combatLine(ev)].filter(Boolean);
    // giocatore: solo l'icona ⓘ accanto all'ultimo racconto, e solo se l'impostazione è accesa
    if (!devMode()) return mecc.length && ultimo && dettagliTiri()
      ? '<details class="solo-esito solo-info"><summary aria-label="Dettagli dei tiri" title="Dettagli dei tiri">ⓘ</summary><div class="solo-esito-body">' + mecc.join('') + '</div></details>' : '';
    const rows = mecc;
    if (devMode()) rows.push('<div class="solo-dev">' + narrBadge(n) + '</div>');
    return rows.length ? '<details class="solo-esito"><summary>Dettagli dei tiri</summary><div class="solo-esito-body">' + rows.join('') + '</div></details>' : '';
  }
  function paragraphs(t) { return String(t || '').split(/\n\s*\n/).map(p => '<p>' + esc(p.trim()) + '</p>').join(''); }

  /* Tiri degli attacchi, visibili prima del racconto (5/11/2026): solo i valori già calcolati dal combattimento (resolveAttack), nessun secondo tiro. */
  // manovra: tiro del protagonista contro quello del bersaglio, con dadi e bonus (d20 + Arte Combattiva contro d20 + Elusione, oppure d100)
  function rigaManovra(a) {
    const t = a.tiro, d20 = t.dado === 'd20' && t.dadoAtt != null;
    const att = d20 ? 'd20 <b>' + esc(t.dadoAtt) + '</b> + Arte Combattiva ' + esc(t.ac) + ' = ' + esc(t.att) : esc(t.dado) + ' ' + esc(t.att);
    const dif = d20 ? 'd20 ' + esc(t.dadoDif) + ' + Elusione ' + esc(t.el) + ' = ' + esc(t.dif) : (t.dadoDif != null ? esc(t.dado) + ' ' : '') + esc(t.dif);
    return '<li>Tu · ' + esc(a.capacita) + ': ' + att + ' contro ' + dif + ' → <b>' + (a.riuscita ? 'riuscita' : 'fallita') + '</b></li>';
  }
  function attacchiVisibili(ev) {
    if (!ev.combattimento) return '';
    // nell'ordine in cui le azioni sono avvenute: attacchi e manovre
    const righe = ev.combattimento.azioni.filter(a => (a.tipo === 'attacco' && a.esito) || (a.tipo === 'manovra' && a.tiro)).map(a => {
      if (a.tipo === 'manovra') return rigaManovra(a);
      const r = a.esito, c = a.colpo;
      const chi = a.chi === 'pg' ? 'Tu' : esc(a.nemicoNome || ev.nemicoNome || 'Nemico');
      const colpire = r.hitRoll != null && c
        ? 'd20: <b>' + esc(r.hitRoll) + '</b> + ' + esc(c.tratto) + ' ' + esc(c.valore) + (c.bonus ? ' + precisione ' + esc(c.bonus) : '') + ' = ' + esc(r.hitTotal)
        : 'per colpire ' + esc(r.hitTotal);
      const difesa = r.defense ? ' · ' + (r.defense.type === 'dodge' ? 'schivata' : 'blocco') + ' d20 ' + esc(r.defense.roll) + ' = ' + esc(r.defense.total) + (r.defense.success ? ', riuscita' : ', fallita') : '';
      // eventi salvati prima del 6/11/2026: salvezza che dimezzava; dopo: riduzione di Difesa e controllo critico
      const salvezza = r.save ? ' · salvezza ' + esc(r.save.total) + (r.save.halved ? ' (dimezza)' : '') : '';
      const riduzione = r.reduction && r.reduction.total ? ' · danno ' + esc(r.damageRoll) + ' − ' + (r.reduction.stat === 'dmen' ? 'Difesa Mentale' : 'Difesa') + ' ' + esc(r.reduction.total) : '';
      const critico = !r.crit ? '' : r.crit.automatico ? ' · nessuna difesa: critico ×2' : ' · critico: Resistenza d20 ' + esc(r.crit.roll) + ' = ' + esc(r.crit.total) + (r.crit.critico ? ', superata → ×2' : ', tiene');
      const quarto = r.defense && r.defense.type === 'block' && r.defense.success ? ' · bloccato: un quarto' : '';
      const danno = r.finalDamage > 0 ? '<b>' + esc(r.finalDamage) + ' danni</b>' : '<b>nessun danno</b>';
      return '<li>' + chi + ' · ' + esc(a.capacita || '') + ': ' + colpire + difesa + salvezza + riduzione + quarto + critico + ' → ' + danno + '</li>';
    });
    // iniziativa del primo round: 1d8 + Velocità per ciascuno
    const it = ev.combattimento.iniziativaTiri;
    const nomeIt = uid => uid === 'pg' ? 'tu' : esc(((ev.combattimento.unita || []).find(u => u.uid === uid) || {}).nome || ev.nemicoNome || 'nemico');
    const riga = (chi, t) => chi + ' d8 ' + esc(t.d8) + ' + Velocità ' + esc(t.vel) + ' = <b>' + esc(t.totale) + '</b>';
    const iniz = !it ? '' : Array.isArray(it) ? '<li>Iniziativa: ' + it.map(t => riga(nomeIt(t.uid), t)).join(' · ') + '</li>'
      : '<li>Iniziativa: ' + riga('tu', it.pg) + ' · ' + riga(esc(ev.nemicoNome || 'nemico'), it.nemico) + (it.nemico.totale > it.pg.totale ? ' → il nemico agisce prima' : ' → agisci prima tu') + '</li>';
    if (iniz) righe.unshift(iniz);
    return righe.length ? '<ul class="solo-dado solo-colpi" aria-label="Tiri degli attacchi">' + righe.join('') + '</ul>' : '';
  }
  function combatLine(ev) {
    if (!ev.combattimento) return '';
    return '<div class="solo-roll">' + ev.combattimento.azioni.map(a => {
      if (a.tipo === 'boost') return 'Boost · ' + esc(a.capacita) + ' Lv ' + a.livello + ' (−' + a.costo + ' PP)';
      if (a.tipo === 'boost_estendi') return 'Boost · ' + esc(a.capacita) + ' esteso di un round';
      if (a.tipo === 'boost_fine') return 'Boost · ' + esc(a.capacita) + (a.motivo === 'senza_pp' ? ' si spegne (PP finiti)' : ' finito');
      if (a.tipo === 'movimento' && a.caselle) return (a.chi === 'pg' ? 'Tu' : esc(a.nome || 'Nemico')) + ' · movimento di ' + a.caselle + (a.caselle === 1 ? ' casella' : ' caselle');
      if (a.tipo === 'manovra' && a.tiro) return 'Tu · ' + esc(a.capacita) + ': ' + a.tiro.att + ' contro ' + a.tiro.dif + (a.riuscita ? ', riuscita' : ', fallita');
      if (a.tipo === 'stato_effetto') return esc(a.nome || 'Nemico') + ' · ' + esc(a.stato || 'stato') + (a.perso ? ': −' + a.perso + ' HP' : '') + (a.turniRimasti ? ' (ancora ' + a.turniRimasti + (a.turniRimasti === 1 ? ' turno)' : ' turni)') : '');
      if (a.tipo === 'stato' && a.stato) return esc(a.bersaglioNome || 'Bersaglio') + ' · ' + esc(a.stato) + (a.turni ? ', ' + a.turni + (a.turni === 1 ? ' turno' : ' turni') : '');
      if (a.tipo !== 'attacco') return esc(a.capacita || a.tipo);
      const r = a.esito;
      return (a.chi === 'pg' ? 'Tu' : 'Nemico') + ' · ' + esc(a.capacita) + ': colpire ' + r.hitTotal + ', danno ' + r.damageRoll +
        (r.defense ? ' (' + (r.defense.type === 'dodge' ? 'schivata' : 'blocco') + ' ' + r.defense.total + (r.defense.success ? ' riuscita' : ' fallita') + ')' : '') +
        (r.save ? ', salvezza ' + r.save.total + (r.save.halved ? ' dimezza' : '') : '') +
        (r.reduction && r.reduction.total ? ', riduzione ' + r.reduction.total : '') + (r.crit && r.crit.critico ? ', critico ×2' : '') + ' → ' + r.finalDamage;
    }).join('<br>') + '</div>';
  }

  function renderStatusLine() {
    const el = $v('#solo-status'); if (!el || !S.state) return;
    const pg = S.state.personaggio, content = gameContent();
    const st = RMSoloLLM.status();
    const clocks = Object.entries(S.state.orologi || {}).filter(([k, o]) => o.attivo && ((content.orologi || {})[k] || {}).visibile !== false)
      .map(([k, o]) => '<span title="' + esc(content.orologi[k].nome) + '">⏳ ' + esc(content.orologi[k].nome) + ' ' + o.valore + '/' + o.max + '</span>').join('');
    const res = Object.entries(S.state.risorse || {}).filter(([k]) => ((content.risorse || {})[k] || {}).visibile !== false)
      .map(([k, v]) => '<span>▣ ' + esc(content.risorse[k].nome) + ' ' + v + '</span>').join('');
    el.innerHTML = '<span>Lv ' + pg.livello + '</span><span>❤ ' + pg.hpCur + '/' + pg.hpMaxTracked + '</span><span>✦ ' + pg.mpCur + '/' + pg.mpMaxTracked + '</span>' +
      ((pg.gemme || []).length ? '<span>◆ gemme ' + pg.gemme.filter(g => g.stato === 'attiva').length + '/' + pg.gemme.length + '</span>' : '') + clocks + res +
      llmStateBadge(st);
  }

  /* Nessun dettaglio tecnico durante il gioco: solo un cenno mentre il
     Narratore si prepara; per chi sviluppa lo stato completo. */
  function llmStateBadge(st) {
    if (devMode()) return '<span class="solo-llm-state">' + (st.stato === 'pronto' ? 'IA locale pronta' : st.stato === 'caricamento' ? 'IA in caricamento…' : 'IA non disponibile: testi di riserva') + '</span>';
    const prep = st.stato === 'caricamento' || (global.RMSoloNarratorSetup && global.RMSoloNarratorSetup.state().stato === 'scaricamento');
    return prep ? '<span class="solo-llm-state">Il Narratore si sta preparando…</span>' : '';
  }

  function sceneOpening(content, sceneId) {
    const sc = RMSoloEngine.sceneOf(content, sceneId);
    const txt = RMSoloEngine.sceneOpeningText(S.state, content, sceneId);
    if (!sc || !txt) return '';
    return '<article class="solo-ev solo-scene-open"><h2 class="solo-scene-title">' + esc(sc.titolo) + '</h2><div class="solo-narr">' + paragraphs(txt) + '</div>' +
      (devMode() ? '<div class="solo-ev-meta"><span class="solo-badge fissa">testo del capitolo</span></div>' : '') + '</article>';
  }

  function renderGame() {
    const state = S.state, content = gameContent();
    if (!state.incontro) S.difesa = null; // la scelta della difesa vale solo nello scontro in corso
    const sc = RMSoloEngine.currentScene(state, content);
    const over = RMSoloEngine.isOver(state);
    // B36: le spese fatte insieme (una per punto) diventano una riga sola del registro
    const spesa = e => !!e && e.tipo === 'miglioramento' && !!e.narrazione && e.narrazione.stato === 'pronta';
    const log = state.eventi.map((ev, i, evs) => {
      if (ev.dialogoImplicito) return '';   // il dialogo si è chiuso perché il giocatore ha fatto altro: nessuna voce nel racconto
      if (spesa(ev) && spesa(evs[i - 1])) return '';
      let j = i; while (spesa(ev) && spesa(evs[j + 1])) j++;
      const n = j > i ? Object.assign({}, ev.narrazione, { testo: evs.slice(i, j + 1).map(e => e.narrazione.testo).join(' ') }) : (ev.narrazione || {});
      const bat = (n.battute || []).map(b => '<p class="solo-line"><span class="solo-speaker">' + esc(b.png) + '</span>' + esc(b.testo) + '</p>').join('');
      const parla = ev.tipo === 'dialogo' || ev.tipo === 'battuta' || ev.tipo === 'dialogo_fine';
      const player = ev.sceltaTesto || ev.testo;
      // ordine: azione, conseguenza, riepilogo tecnico, transizione; le
      // nuove azioni arrivano solo dopo (actionsPanel)
      const gruppo = evs.slice(i, j + 1), unisci = k => [].concat.apply([], gruppo.map(e => (e.resoconto || {})[k] || []));
      const r = j > i && ev.resoconto ? Object.assign({}, ev.resoconto, { effettiTecnici: unisci('effettiTecnici'), cambiamentiDiStato: unisci('cambiamentiDiStato') }) : ev.resoconto;
      const dichiarata = r ? r.azioneDichiarata : player;
      const pronta = n.stato === 'pronta';
      return '<article class="solo-ev' + (parla ? ' solo-ev-dialogo' : '') + '" data-n="' + ev.n + '">' +
        (dichiarata ? '<p class="solo-player"><span>Tu</span>' + esc(dichiarata) + '</p>' : '') +
        (ev.provaConfermata ? diceLine(ev) : outcomeLine(ev)) + attacchiVisibili(ev) +
        (parla && ev.pngNome ? '<p class="solo-speaker-head">' + esc(ev.pngNome) + '</p>' : '') +
        '<div class="solo-narr">' + (n.testo ? paragraphs(n.testo) + bat : S.anteprima && S.anteprima.n === ev.n ? paragraphs(S.anteprima.testo) : '<p class="solo-muted">Il Narratore racconta…</p>') + '</div>' +
        // testo scritto dal modello: si può segnalare senza uscire dall'app (requisito Play per l'IA generativa, js/solo/solo-segnalazioni.js)
        (pronta && n.fonte === 'ia' ? '<button type="button" class="solo-segnala" data-segnala="' + ev.n + '" aria-label="Segnala questa risposta del Narratore">⚑ Segnala</button>' : '') +
        (pronta ? techBlock(r) + detailsPanel(ev, content, n, evs[j] === evs[evs.length - 1]) + fiduciaFrase(ev, content) : '') + '</article>' +
        (pronta ? transitionBlock(r) + levelNotice(evs[j], state) +
          (ev.effetti || []).filter(a => a.tipo === 'scena').map(a => sceneOpening(content, a.scena)).join('') : '');
    }).join('');
    const opening = sceneOpening(content, content.scene[0].id);
    const schede = ['gioco', 'diario', 'scheda'].concat(state.mappa && typeof RMSoloMappa !== 'undefined' ? ['mappa'] : []);
    const tabs = '<nav class="solo-tabs" role="tablist">' + schede.map(t => '<button role="tab" class="' + (S.tab === t ? 'active' : '') + '" data-tab="' + t + '">' + { gioco: 'Gioco', diario: 'Diario', scheda: 'Scheda', mappa: 'Mappa' }[t] +
      (t === 'scheda' && haPuntiDaSpendere(state) ? '<span class="solo-dot" role="img" aria-label="punti da spendere"></span>' : '') +
      (t === 'diario' && S.tab !== 'diario' && diarioNuovo(state, content) ? '<span class="solo-dot" role="img" aria-label="nuova voce"></span>' : '') + '</button>').join('') + '</nav>';
    let body = '';
    if (S.tab === 'gioco') {
      const ultimo = state.eventi[state.eventi.length - 1];
      const inAttesa = ultimo && ultimo.narrazione && ultimo.narrazione.stato !== 'pronta';
      body = '<div class="solo-log" id="solo-log" aria-live="polite">' + opening + log + '</div>' +
        (inAttesa ? '<section class="solo-actions" id="solo-actions"><p class="solo-muted">Le nuove azioni compariranno dopo il racconto della conseguenza.</p>' +
          (S.abort ? '<button class="' + ACT + '" id="solo-abort" data-keep-enabled="1">Interrompi la descrizione</button>' : '') + '</section>'
          : over ? endPanel(state, content) : (state.personaggio.pregiDaScegliere || []).length ? pregioPanel(state) : state.personaggio.levelUpInAttesa ? levelUpBlock(state) : state.provaInAttesa ? provaPanel(state) : actionsPanel(state, content, sc));
    } else if (S.tab === 'diario') body = diaryPanel(state, content);
    else if (S.tab === 'mappa' && state.mappa) body = (state.personaggio.levelUpInAttesa && !over ? levelUpBlock(state) : '') + mapPanel(state, content);
    else body = sheetPanel(state, content);
    render('<header class="solo-head"><button class="btn btn-ghost btn-sm" id="solo-back" aria-label="Torna alle partite">←</button><div class="solo-head-txt"><h1>' + esc(sc.titolo) + '</h1><div class="solo-sub">' + esc(sc.luogo) + '</div></div>' + phaseIndicator(state, content) + '</header>' +
      '<div class="solo-status" id="solo-status"></div>' + tabs + body + devTools(state));
    renderStatusLine();
    $v('#solo-back').addEventListener('click', renderHub);
    root().querySelectorAll('.solo-tabs button').forEach(b => b.addEventListener('click', () => { const da = S.tab; S.tab = b.dataset.tab; if (S.tab === 'diario') S.diarioVisto = S.state.eventi.length; if (S.tab === 'gioco' && da !== 'gioco') S.inFondo = true; renderGame(); }));
    wireActions();
    if (S.tab === 'scheda') wireSheet(t => { S.sheetTab = t; renderGame(); }, setGamePortrait);
    if (S.tab === 'mappa') wireMap();
    // pagina intera che scorre (nessun riquadro interno che taglia il
    // testo): a ogni nuovo evento si porta in vista il suo inizio
    const evs = root().querySelectorAll('#solo-log .solo-ev');
    if (S.tab === 'gioco' && S.inFondo) {
      // ritorno su «Gioco» da Diario, Scheda o Mappa: subito in fondo, dove sono le azioni (prova della Cavaliera, B24)
      S.inFondo = false; S.eventiVisti = evs.length;
      const fondo = $v('#solo-actions') || evs[evs.length - 1];
      if (fondo && fondo.scrollIntoView) fondo.scrollIntoView({ block: 'end' });
    } else if (S.tab === 'gioco' && evs.length && evs.length !== S.eventiVisti) {
      S.eventiVisti = evs.length;
      const last = evs[evs.length - 1];
      if (last.scrollIntoView) last.scrollIntoView({ block: 'start' });
    }
  }

  /* Fase della scena, senza numeri: Esplora, Approfondisci, Decidi. */
  function phaseIndicator(state, content) {
    // diagnostica interna: le scene non attraversano fasi obbligatorie
    if (!devMode()) return '';
    const io = RMSoloEngine.interactionOptions(state, content);
    if (!io || RMSoloEngine.isOver(state)) return '';
    const k = io.fase === 'resolution' ? 2 : io.fase === 'development' ? 1 : 0;
    return '<ol class="solo-phase" aria-label="Fase della scena">' + ['Esplora', 'Approfondisci', 'Decidi'].map((t, i) =>
      '<li class="' + (i === k ? 'on' : i < k ? 'done' : '') + '"' + (i === k ? ' aria-current="step"' : '') + '>' + t + '</li>').join('') + '</ol>';
  }

  // pulsanti con etichette lunghe: testo normale, a capo, in griglia
  const ACT = 'btn btn-ghost btn-sm solo-act';
  function interactionButtons(io, dis) {
    if (!io.esplora.length && !io.dialoghi.length) return '';
    return '<div class="solo-btns solo-grid">' +
      io.dialoghi.map(d => '<button class="' + ACT + ' solo-talk" data-dialogo="' + esc(d.png) + '"' + dis + '>Parla con ' + esc(d.nome) + '</button>').join('') +
      io.esplora.map(p => '<button class="' + ACT + '" data-esplora="' + esc(p.id) + '"' + dis + '>' + esc(p.testo) + '</button>').join('') + '</div>';
  }
  function restButtons(state, content, sc, dis) {
    const scariche = (state.personaggio.gemme || []).filter(g => g.stato === 'scarica').length;
    const b = (sc.avamposto && scariche && !state.flags['reintegro_' + sc.id] ? '<button class="' + ACT + '" data-ricarica="1"' + dis + '>Reintegra una gemma all\'avamposto</button>' : '') +
      (sc.calma && !state.flags['riposo_' + sc.id] ? '<button class="' + ACT + '" data-riposo="1"' + dis + '>Riposa</button>' : '') +
      Object.values((state.borsa && state.borsa.istanze) || {}).filter(i => i.stato === 'scoperto' && (!i.scena || i.scena === state.scena))
        .map(i => '<button class="' + ACT + '" data-raccogli="' + esc(i.id) + '"' + dis + '>Raccogli: ' + esc(i.nome) + '</button>').join('') +
      state.inventario.map(i => RMSoloEngine.itemInfo(state, content, i.id)).filter(d => d && d.tipo === 'consumabile' && d.effetto && !d.effetto.cariche_gemma)
        .map(d => '<button class="' + ACT + '" data-usa="' + esc(d.id) + '"' + dis + '>Usa: ' + esc(d.nome) + '</button>').join('');
    return b ? '<div class="solo-btns solo-grid solo-secondary">' + b + '</div>' : '';
  }

  /* Campagna lunga: "prosegui" compare solo quando il capitolo è concluso
     (contratto soddisfatto); nessun contatore, nessuna lista di requisiti. */
  function proceedButton(state, content, dis) {
    const ST = global.RMSoloStruttura;
    if (!ST || !ST.attivo(content) || !ST.pronta(state)) return '';
    const v = ST.vista(state, content);
    return '<div class="solo-btns solo-grid solo-proceed"><button class="btn btn-primary btn-sm solo-act" data-prosegui="1"' + dis + '>' + (v && v.epilogo ? 'Chiudi la storia' : 'Lascia questo luogo e prosegui') + '</button></div>';
  }
  function structureDev(state, content) {
    const ST = global.RMSoloStruttura;
    if (!devMode() || !ST || !ST.attivo(content) || !state.campagna) return '';
    const c = state.campagna;
    const v = ST.valutaContratto(state, content, state.scena);
    const sc = ST.scenaCorrente(state);
    return '<div class="solo-dev"><b>Campagna lunga</b> · ' + esc(c.macro) + ' / ' + esc(c.arcoLocale || '') + ' / ' + esc(c.scena || '—') + ' / ' + esc(c.sottoscena || '—') + ' · turno ' + c.turno +
      (sc ? '<br>Scena interna: ' + esc(sc.categoria) + ' — ' + esc(sc.funzione) : '') +
      '<br>Contratto: ' + Object.keys(v.clausole).map(k => (v.clausole[k].ok ? '✓' : '✗') + k).join(' ') +
      '<br>Budget: ' + esc(JSON.stringify((c.budget[c.macro] || {}).usato || {})) + '</div>';
  }

  /* Ingresso in scena (Fase 4): dove sei, che cosa fai e chi c'è, con posizione e attività, prima delle scelte.
     Aperto all'inizio della scena, richiudibile dopo. */
  function ingressoPanel(state, content) {
    if (typeof RMSoloScena === 'undefined' || state.incontro) return '';
    const ing = RMSoloScena.ingresso(state, content);
    if (!ing) return '';
    const tu = ing.protagonista.posizione ? '<p class="solo-ingresso-tu"><b>Tu:</b> ' + esc(ing.protagonista.posizione) + (ing.protagonista.attivita ? ' — ' + esc(ing.protagonista.attivita) : '') + '.</p>' : '';
    const chi = ing.presenti.length
      ? '<ul class="solo-ingresso-presenti">' + ing.presenti.map(p => '<li><b>' + esc(p.nome) + '</b>' + (p.posizione || p.attivita ? ': ' + esc([p.posizione, p.attivita].filter(Boolean).join(', ')) : '') + '</li>').join('') + '</ul>'
      : '<p class="solo-muted">Nessun altro è presente.</p>';
    // aperto solo all'ingresso in una scena o quando cambia chi è presente; poi una riga apribile
    const sig = state.scena + '|' + ing.presenti.map(p => p.nome).join(',');
    if (S.ingressoSig !== sig) { S.ingressoSig = sig; S.ingressoVersione = state.version; }
    return '<details class="solo-ingresso" id="solo-ingresso"' + (S.ingressoVersione === state.version ? ' open' : '') + '><summary>Dove sei e chi c\'è</summary>' +
      '<p class="solo-ingresso-luogo"><b>Luogo:</b> ' + esc(ing.luogo) + '.</p>' + tu + chi + '</details>';
  }
  /* Scelte contestuali (Fase 4): al massimo tre, per priorità; la scrittura libera c'è sempre. */
  function bottoneScelta(c, dis) {
    if (c.tipo === 'scelta') return c.disponibile
      ? '<button class="btn btn-primary btn-sm solo-act" data-scelta="' + esc(c.id) + '"' + dis + '>' + esc(c.testo) + '</button>'
      : '<button class="' + ACT + '" disabled title="' + esc(c.motivo || '') + '">' + esc(c.testo) + ' <small>' + esc(c.motivo || 'non disponibile') + '</small></button>';
    if (c.tipo === 'obiettivo') return '<button class="btn btn-primary btn-sm solo-act solo-filo" data-obiettivo="' + esc(c.id) + '"' + dis + '>' + esc(c.testo) + '</button>';
    if (c.tipo === 'suggerimento') return '<button class="btn btn-primary btn-sm solo-act" data-sugg="' + c.indice + '"' + dis + '>' + esc(c.testo) + '</button>';
    if (c.tipo === 'dialogo') return '<button class="' + ACT + ' solo-talk" data-dialogo="' + esc(c.id) + '"' + dis + '>' + esc(c.testo) + '</button>';
    if (c.tipo === 'argomento') return '<button class="' + ACT + '" data-argomento="' + esc(c.id) + '"' + dis + '>' + esc(c.testo) + '</button>';
    if (c.tipo === 'passo') return '<button class="btn btn-primary btn-sm solo-act" data-passo="' + esc(c.id) + '" data-atto="' + esc(c.atto) + '" data-png="' + esc(c.png || '') + '" data-testo="' + esc(c.testo) + '"' + dis + '>' + esc(c.testo) + '</button>';
    if (c.tipo === 'intenzione') return '<button class="' + ACT + '" data-libera="' + esc(c.invio) + '"' + dis + '>' + esc(c.testo) + '</button>';
    return '<button class="' + ACT + '" data-esplora="' + esc(c.id) + '"' + dis + '>' + esc(c.testo) + '</button>';
  }
  const TESTO_ALTRE = 'C\'è dell\'altro da fare qui: compare man mano, e puoi sempre scrivere tu che cosa fai.';
  /* Una sola volta per partita (resta visibile finché dura quel turno); poi vive nell'aiuto. */
  function avvisoAltre(state) {
    if (S.altreVersione === state.version) return true;
    if (state.opzioni && state.opzioni.avvisoAltre) return false;
    S.altreVersione = state.version;
    state.opzioni = Object.assign({}, state.opzioni, { avvisoAltre: true });
    return true;
  }
  function scelteHtml(state, content, io, dis, extra) {
    const r = RMSoloScena.scelte(state, content, io);
    const btn = r.scelte.map(c => bottoneScelta(c, dis)).join('');
    // il congedo (extra) è un'uscita, non una scelta: non conta fra le tre
    return (btn ? '<div class="solo-btns solo-grid solo-scelte" data-scelte="' + r.scelte.length + '">' + btn + '</div>' : '') + (extra ? '<div class="solo-btns solo-grid">' + extra + '</div>' : '') +
      (r.nascoste && avvisoAltre(state) ? '<p class="solo-muted solo-altre">' + TESTO_ALTRE + '</p>' : '');
  }

  const NOME_STAT_UI = { for: 'Forza', mira: 'Mira', vel: 'Velocità', fmen: 'Forza Magica', dex: 'Destrezza', dif: 'Difesa', dmen: 'Difesa Magica' };
  const testoBonus = bonus => Object.entries(bonus || {}).map(([k, v]) => (v > 0 ? '+' : '−') + Math.abs(v) + ' ' + (NOME_STAT_UI[k] || k)).join(', ');
  /* Boost del pannello del combattimento: costi, mantenimento e livelli li calcola il motore con le regole esistenti. */
  function boostButtons(bi, dis) {
    return bi.boost.map(b => {
      if (b.attivo) {
        return '<span class="solo-boost-on" role="status">⚡ ' + esc(b.nome) + ' attivo <small>ancora ' + b.roundRestanti + ' round</small></span>' +
          (b.estendibile ? '<button class="' + ACT + '" data-boost-estendi="1"' + dis + ' title="Un round in più; continui a pagare il mantenimento">Estendi ' + esc(b.nome) + ' <small>+1 round</small></button>' : '');
      }
      return b.livelli.map(l => {
        const tip = (testoBonus(l.bonus) || 'potenziamento') + ' · mantenimento ' + l.mantenimento + ' PP a turno, 3 turni · mezzo turno';
        return '<button class="btn btn-primary btn-sm solo-act" data-boost="' + esc(b.id) + '" data-livello="' + l.lv + '"' + (l.motivo ? ' disabled' : dis) + ' title="' + esc(l.motivo || tip) + '">Boost: ' + esc(b.nome) + (b.lv > 1 ? ' Lv ' + l.lv : '') + ' <small>' + l.costo + ' PP</small>' + (l.motivo ? ' <small>— ' + esc(l.motivo) + '</small>' : ' <small class="solo-cap-eff">' + esc(tip) + '</small>') + '</button>';
      }).join('');
    }).join('');
  }

  /* Griglia dello scontro (js/solo/solo-griglia.js, pezzo 2.8): SVG con hexCellCenter di app.js e le classi .combat-hex-* del
     gioco online. Le caselle raggiungibili sono pulsanti (tocco, Invio o Spazio) che spostano il protagonista senza consumare
     l'azione; ogni pedina ha una sigla e un nome (Tu, 1, 2…), mai solo un colore. */
  function grigliaHtml(state, gi, bers, dis) {
    const G = typeof RMSoloGriglia !== 'undefined' && RMSoloGriglia.attiva;
    if (!G || !gi) return '';
    const g = gi.griglia, inc = state.incontro, geo = G.geometria(g, 44), w = geo.cellW, h = geo.cellH;
    const nemici = inc.gruppo ? inc.nemici.filter(n => n.attivo) : [Object.assign({}, inc.nemico, { uid: 'nemico' })];
    const chi = {};
    nemici.forEach((n, i) => { const p = g.pos[n.uid]; if (p) chi[p.col + ':' + p.row] = { n, sigla: String(i + 1) }; });
    const f = x => x.toFixed(1);
    const punti = (cx, cy) => [[cx - w / 4, cy - h / 2], [cx + w / 4, cy - h / 2], [cx + w / 2, cy], [cx + w / 4, cy + h / 2], [cx - w / 4, cy + h / 2], [cx - w / 2, cy]].map(p => f(p[0]) + ',' + f(p[1])).join(' ');
    const caselle = n => n + (n === 1 ? ' casella' : ' caselle');
    let celle = '', pedine = '';
    geo.celle.forEach(c => {
      const occ = chi[c.col + ':' + c.row], tu = g.pg.col === c.col && g.pg.row === c.row, passi = G.tra(g.pg, c);
      const ok = !occ && !tu && passi <= gi.caselle && !dis;
      celle += '<polygon class="combat-hex-cell' + (ok ? ' combat-hex-selectable solo-hex-ok' : '') + (occ || tu ? ' combat-hex-occupied' : '') + '" points="' + punti(c.cx, c.cy) + '"' +
        (ok ? ' role="button" tabindex="0" data-muovi="' + c.col + ',' + c.row + '" aria-label="Spostati qui, ' + caselle(passi) + '"><title>Spostati qui (' + caselle(passi) + ')</title></polygon>' : ' aria-hidden="true"></polygon>') +
        (ok ? '<circle class="solo-hex-dot" cx="' + f(c.cx) + '" cy="' + f(c.cy) + '" r="3" aria-hidden="true"></circle>' : '');
      if (tu || occ) pedine += '<g class="solo-pedina ' + (tu ? 'solo-pedina-pg' : 'solo-pedina-nemico' + (occ.n.uid === bers ? ' solo-pedina-bersaglio' : '')) + '" role="img" aria-label="' + esc(tu ? 'Tu' : occ.sigla + ': ' + occ.n.nome + ', a ' + caselle(gi.distanze[occ.n.uid]) + (occ.n.uid === bers ? ', bersaglio' : '')) + '">' +
        '<circle cx="' + f(c.cx) + '" cy="' + f(c.cy) + '" r="' + f(h * 0.36) + '"></circle><text x="' + f(c.cx) + '" y="' + f(c.cy) + '">' + (tu ? 'Tu' : occ.sigla + (occ.n.uid === bers ? '◎' : '')) + '</text></g>';
    });
    const legenda = nemici.map((n, i) => (i + 1) + ' = ' + esc(n.nome) + ' (' + caselle(gi.distanze[n.uid]) + ')').join(' · ');
    return '<div class="solo-griglia-box"><svg class="combat-hex-grid solo-griglia" viewBox="0 0 ' + f(geo.larghezza) + ' ' + f(geo.altezza) + '" role="group" aria-label="Campo dello scontro: tocca una casella con il punto per spostarti">' + celle + pedine + '</svg>' +
      '<p class="solo-muted solo-griglia-nota">' + legenda + '. ' + (gi.caselle ? 'Puoi spostarti ancora di ' + caselle(gi.caselle) + ' in questo round (le caselle con il punto): spostarsi non consuma l\'azione.' : 'In questo round non puoi più spostarti.') + ' Il corpo a corpo vuole il bersaglio a una casella; armi da tiro senza limite.</p></div>';
  }

  function actionsPanel(state, content, sc) {
    const dis = S.busy ? ' disabled' : '';
    const io = RMSoloEngine.interactionOptions(state, content);
    let html = '<section class="solo-actions" id="solo-actions">';
    if (state.incontro) {
      // combattimento: sezione normale del flusso, stato essenziale sempre
      // visibile, dettagli del round nel pannello Esito dell'evento
      const pg = state.personaggio, inc = state.incontro, ne = inc.nemico;
      const bi = RMSoloEngine.boostInfo(state);
      const pct = (v, m) => Math.max(0, Math.min(100, Math.round(v / m * 100)));
      // scontro con più partecipanti: ogni avversario con il suo stato e il
      // bersaglio scelto evidenziato; si cambia bersaglio con un tocco
      const gruppo = inc.gruppo && inc.nemici;
      const bers = gruppo ? (S.bersaglio && inc.nemici.some(n => n.uid === S.bersaglio && n.attivo) ? S.bersaglio : inc.bersaglio) : null;
      // griglia dello scontro (null negli scontri iniziati prima della griglia)
      const gi = RMSoloEngine.grigliaInfo ? RMSoloEngine.grigliaInfo(state) : null;
      const riga = n => '<div class="solo-unit' + (n.uid === bers ? ' solo-target' : '') + (n.attivo ? '' : ' solo-unit-out') + '">' +
        (n.attivo ? '<button class="' + ACT + ' solo-target-btn" data-bersaglio="' + esc(n.uid) + '" aria-pressed="' + (n.uid === bers) + '"' + dis + '>' + (n.uid === bers ? '◎ ' : '') + esc(n.nome) + '</button>' : '<span>' + esc(n.nome) + ' — ' + esc({ sconfitto: 'a terra', incapacitato: 'fuori combattimento', fuggito: 'fuggito', arreso: 'arreso' }[n.esito] || n.esito) + '</span>') +
        '<div class="bar-track"><div class="bar-fill physical" style="width:' + pct(n.hp, n.hpMax) + '%"></div></div><b>' + n.hp + '/' + n.hpMax + '</b>' +
        '<small>' + esc(n.posizione === 'distanza' ? 'a distanza' : 'in mischia') + (gi && gi.distanze[n.uid] != null ? ' · a ' + gi.distanze[n.uid] + (gi.distanze[n.uid] === 1 ? ' casella' : ' caselle') : '') + (n.esposto >= inc.round ? ' · scoperto' : '') + (n.protettoDa ? ' · protetto' : '') + (n.guardia >= inc.round ? ' · in guardia' : '') + '</small></div>';
      html += '<div class="solo-combat"><div class="solo-combat-head">' + esc(gruppo && inc.nemici.length > 1 ? inc.nemici.length + ' avversari' : gruppo ? inc.nemici[0].nome : ne.nome) + ' <span>round ' + inc.round + '</span>' + ((pg.boost || []).length ? ' <span class="solo-pp" title="Punti Potere: servono ad attivare e mantenere i Boost">PP ' + Math.floor(bi.pp) + '/' + Math.floor(bi.ppMax) + '</span>' : '') + '</div>' +
        (gruppo ? '<div class="solo-units" role="group" aria-label="Scegli il bersaglio">' + inc.nemici.map(riga).join('') + '</div>' : '') +
        '<div class="solo-combat-bars">' + (gruppo ? '' : '<div><span>' + esc(ne.nome.split(' ')[0]) + '</span><div class="bar-track"><div class="bar-fill physical" style="width:' + pct(ne.hp, ne.hpMax) + '%"></div></div><b>' + ne.hp + '/' + ne.hpMax + '</b></div>') +
        '<div><span>Tu</span><div class="bar-track"><div class="bar-fill physical" style="width:' + pct(pg.hpCur, pg.hpMaxTracked) + '%"></div></div><b>' + pg.hpCur + '/' + pg.hpMaxTracked + '</b></div></div>' + grigliaHtml(state, gi, bers, dis) + '</div>' +
        // la difesa contro il prossimo attacco la sceglie il giocatore (js/rules.js); vale finché non la cambia
        (dif => '<div class="solo-btns solo-difesa" role="group" aria-label="Come ti difendi dal prossimo attacco"><small>Difesa:</small>' +
          [['dodge', 'Schivata', true], ['block', 'Blocco', dif.scudo], ['none', 'Nessuna', true]].map(([k, t, ok]) => '<button class="btn btn-sm' + (dif.scelta === k ? ' btn-primary' : '') + '" data-difesa="' + k + '" aria-pressed="' + (dif.scelta === k) + '"' + (ok ? dis : ' disabled title="Serve uno scudo"') + '>' + t + '</button>').join('') + '</div>')(Object.assign(RMSoloEngine.difeseProtagonista(state), S.difesa && (S.difesa !== 'block' || RMSoloEngine.difeseProtagonista(state).scudo) ? { scelta: S.difesa } : {})) +
        '<div class="solo-btns solo-grid">' +
        [['abilita', pg.abilita], ['tecnica', pg.tecniche], ['gemma', RMSoloEngine.capacityList(pg, 'gemma')]].map(([kind, list]) => list.map(a => {
          // capacità non utilizzabile (MP, gemma scarica, utilizzi): pulsante spento con il motivo
          const st = RMSoloEngine.capacityStatus(state, content, kind, a);
          const costo = st.costoMP ? ' <small>' + st.costoMP + ' MP</small>' : '';
          // effetto e danno visibili sul pulsante, come nella plancia online (prova della Cavaliera, B23)
          // Tecnica di danno: si somma l'Atk dell'arma in mano (DECISIONI_AUTORE §15 I.4a; dannoCapacita nel motore)
          const armaT = kind === 'tecnica' && a.tipo === 'danno' ? (pg.equip || []).find(e => e.tipo === 'arma' && e.atk != null && !(Number.isFinite(e.durabilitaCorrente) && e.durabilitaCorrente <= 0)) : null;
          const eff = (a.effetto || (a.tipo === 'danno' && a.dannoBase ? 'danno base ' + a.dannoBase : '')) + (armaT ? ' + Atk ' + armaT.atk + ' (' + armaT.nome + ')' : '');
          return '<button class="btn btn-primary btn-sm solo-act" data-combat="' + kind + '" data-id="' + esc(a.id) + '"' + (st.ok ? dis : ' disabled title="' + esc(st.motivo) + '"') + '>' + esc(a.nome) + costo + (st.ok ? (eff ? ' <small class="solo-cap-eff">' + esc(eff) + '</small>' : '') : ' <small>— ' + esc(st.motivo) + '</small>') + '</button>' +
            (!st.ok && st.forzabile ? '<button class="' + ACT + '" data-combat="' + kind + '" data-forza="1" data-id="' + esc(a.id) + '"' + dis + '>Forza l\'armatura: ' + esc(a.nome) + ' <small>−' + st.costoHP + ' HP</small></button>' : '');
        }).join('')).join('') +
        // capacità delle gemme (fuori slot): disponibili finché la gemma associata è attiva
        (pg.capacitaSpeciali || []).filter(a => !a.fuoriSlot).map(a => { const st = RMSoloEngine.capacityStatus(state, content, 'speciale', a); return st.ok ? '<button class="' + ACT + '" data-combat="speciale" data-id="' + esc(a.id) + '"' + dis + '>' + esc(a.nome) + '</button>' : ''; }).join('') +
        ((pg.gemme || []).some(g => g.stato === 'attiva') && pg.mpCur < pg.mpMaxTracked ? '<button class="' + ACT + '" data-gemme="1"' + dis + '>Gemme…</button>' : '') +
        boostButtons(bi, dis) +
        (function () {
          // munizioni (js/munizioni.js): colpi pronti e riserva sempre visibili; Ricarica se serve
          const mun = RMSoloEngine.munizioniArma && RMSoloEngine.munizioniArma(state, content);
          return '<button class="' + ACT + '" data-combat="arma"' + dis + '>Attacco con l\'arma' + (mun ? ' <small>' + esc(mun.etichetta) + '</small>' : '') + '</button>' +
            (mun && mun.ricaricabile ? '<button class="' + ACT + '" data-combat="ricarica"' + dis + '>↻ Ricarica</button>' : '');
        })() +
        // consumabili dello zaino: mezzo turno, uno per round (DECISIONI §13); già usato in questo round: il pulsante dice perché è spento
        state.inventario.filter(i => i.qty > 0).map(i => RMSoloEngine.itemInfo(state, content, i.id)).filter(d => d && d.tipo === 'consumabile' && d.effetto && !d.effetto.cariche_gemma && (d.effetto.hp || d.effetto.effetti))
          .map(d => { const usato = inc.oggettoRound === inc.round || inc.mezzoTurnoRound === inc.round; const perche = inc.oggettoRound === inc.round ? 'già usato un oggetto in questo round' : 'mezzo turno già usato per il Boost'; return '<button class="' + ACT + '" data-combat-oggetto="' + esc(d.id) + '"' + (usato ? ' disabled title="' + perche + '"' : dis) + '>Usa: ' + esc(d.nome) + (usato ? '<span class="solo-cap-eff">' + perche + '</span>' : '') + '</button>'; }).join('') +
        (inc.negoziabile ? '<button class="' + ACT + '" data-combat="negozia"' + dis + '>Proponi la resa</button>' : '') +
        // fuga impedita: il pulsante resta, spento, con il motivo (come le capacità non disponibili)
        (fugaNo => '<button class="' + ACT + '" data-combat="fuga"' + (fugaNo ? ' disabled title="' + esc(fugaNo) + '"' : dis) + '>Fuga' + (fugaNo ? ' <small>— ' + esc(fugaNo) + '</small>' : '') + '</button>')(RMSoloEngine.fugaImpedita(state, content)) + '</div>';
    } else if (io && io.sceltaIncontro) {
      // scontro annunciato: affrontarlo oppure tentare l'altra via
      html += '<p class="solo-pressure">⚔ ' + esc(io.sceltaIncontro.nemico) + ' ti sbarra la strada.</p><div class="solo-btns solo-grid">' +
        '<button class="btn btn-primary btn-sm solo-act" data-incontro="affronta"' + dis + '>Affronta ' + esc(io.sceltaIncontro.nemico) + '</button>' +
        '<button class="btn btn-primary btn-sm solo-act" data-incontro="alternativa"' + dis + '>' + esc(io.sceltaIncontro.alternativa) + '</button></div>';
    } else if (io && io.dialogo) {
      // dialogo a più battute: al massimo tre argomenti, domande libere e congedo
      html += ingressoPanel(state, content) + '<div class="solo-dialog-head">In dialogo con <b>' + esc(io.dialogo.nome) + '</b></div>' +
        (io.aperta ? '<p class="solo-pressure solo-ready">La scena è pronta per una decisione: congedati quando vuoi.</p>' : '') +
        scelteHtml(state, content, io, dis, '<button class="btn btn-primary btn-sm solo-act" data-chiudi="1"' + dis + '>Congedati</button>');
    } else if (io && !io.aperta) {
      // prima della risoluzione: ciò che è percepibile nella scena, al massimo tre scelte
      html += ingressoPanel(state, content) + (io.pressione ? '<p class="solo-pressure">⏳ ' + esc(io.pressione.nome) + '</p>' : '') +
        scelteHtml(state, content, io, dis) + restButtons(state, content, sc, dis);
    } else {
      // scene-seme: solo ciò che il personaggio può concepire e tentare ora
      // (l'input libero resta sempre disponibile)
      html += ingressoPanel(state, content) + scelteHtml(state, content, io, dis) + restButtons(state, content, sc, dis);
    }
    if (!state.incontro && !(io && (io.dialogo || io.sceltaIncontro))) html += proceedButton(state, content, dis);
    html += structureDev(state, content);
    const parla = io && io.dialogo;
    html += '<form class="solo-free" id="solo-free"><label for="solo-input">' + (parla ? 'Oppure scrivi che cosa dici a ' + esc(io.dialogo.nome) : 'Oppure scrivi che cosa fai') + '</label><textarea id="solo-input" rows="2" maxlength="600" placeholder="' + (parla ? 'La tua battuta' : 'Descrivi che cosa fa il tuo personaggio') + '"' + dis + '></textarea>' +
      '<button class="btn btn-primary" type="submit"' + dis + '>Agisci</button>' +
      (!state.incontro && typeof RMSoloTrama !== 'undefined' ? '<button class="' + ACT + '" type="button" id="solo-oracolo" title="Fai una domanda sì/no al mondo: risponde il motore, pesando la tensione"' + dis + '>Chiedi al mondo (sì/no)</button>' : '') + '</form>' +
      (!devMode() || state.incontro || !RMSoloMondo ? '' : '<label class="solo-muted solo-opz"><input type="checkbox" id="solo-opz-motore2"' + (RMSoloMondo.attivo(state, 'regia') ? ' checked' : '') + dis + '> Motore narrativo V2: iniziative dei personaggi, costi concreti, domande di chiarimento</label>') +
      (state.incontro || !(content.imprevisti && content.imprevisti.imprevisti) ? '' : '<label class="solo-muted solo-opz"><input type="checkbox" id="solo-opz-imprevisti"' + (state.opzioni && state.opzioni.imprevisti === false ? '' : ' checked') + dis + '> Imprevisti di scena (eventi occasionali legati ai fili aperti)</label>');
    html += '<details class="solo-aiuto"><summary>Aiuto</summary><p class="solo-muted">' + TESTO_ALTRE + '</p><p class="solo-muted">Indizi, appunti, ricompense, costi e fiducia dei personaggi li trovi nel Diario.</p></details>';
    const last = state.eventi[state.eventi.length - 1];
    // «Riprova» (Fase 4.4): riscrive solo la descrizione dell'ultimo evento, a esiti invariati. Disponibile solo con
    // il modello locale pronto, per l'ultimo evento con la descrizione pronta, non per i testi fissi, al massimo
    // tre volte; in sviluppo resta sempre visibile (anche per la riserva).
    const rp = RMSoloEngine.riprovaStato(state, content, { occupato: S.busy, modello: RMSoloLLM.ready() });
    if (rp.disponibile || (devMode() && last && last.narrazione && last.narrazione.stato === 'pronta' && !last.testoFisso)) {
      html += '<button class="' + ACT + ' solo-regen" id="solo-regen" title="Riscrive solo il testo: esito, dadi e oggetti restano quelli"' + dis + '>Riprova' + (rp.disponibile ? ' <small>(' + rp.restanti + ' rimaste)</small>' : '') + '</button>';
    } else if (/già riprovato|modello locale/.test(rp.motivo || '')) html += '<p class="solo-muted solo-regen-nota">Riprova non disponibile: ' + esc(rp.motivo) + '</p>';
    // memoria dello stile del giocatore: solo ricorrenze, mai le frasi; si azzera quando si vuole
    if (state.stile && state.stile.n > 0) html += '<p class="solo-muted solo-stile">Il gioco ricorda come scrivi (solo ricorrenze, mai le tue frasi) per capirti meglio. <button type="button" class="' + ACT + '" id="solo-stile-azzera"' + dis + '>Dimentica il mio stile</button></p>';
    // sempre attivo: interrompe solo la generazione del testo, mai l'esito
    if (S.abort) html += '<button class="' + ACT + '" id="solo-abort" data-keep-enabled="1">Interrompi la descrizione</button>';
    return html + '</section>';
  }

  /* Epilogo: variante e modificatori calcolati dal motore (mai dall'IA),
     testo di riserva della variante e conseguenza personale. */
  // campagna lunga: legami con cui si chiude la storia (dallo stato, mai dall'IA)
  const LEGAME = { neutro: 'rapporto aperto', alleato: 'alleanza', rotto: 'rottura', traditore: 'tradimento', antagonista: 'contro di te', abbandonato: 'lasciato indietro' };
  function epilogueBonds(state, content) {
    const ST = global.RMSoloStruttura;
    const ep = ST && ST.attivo(content) ? ST.epilogo(state, content) : null;
    if (!ep) return '';
    const l = ep.legami.filter(x => (state.png[x.id] || {}).incontrato);
    return l.length ? '<h3 class="solo-h3">Legami</h3><ul class="solo-bonds">' + l.map(x => '<li><b>' + esc(String(x.nome).split(' (')[0]) + '</b>: ' + esc(x.stato === 'morto' ? 'caduto' : LEGAME[x.legame] || x.legame) + '</li>').join('') + '</ul>' : '';
  }
  function endPanel(state, content) {
    // fine di un atto (storia che si ferma prima, DECISIONI §15 G.5): la partita resta salvata e riprende con gli atti successivi
    if (state.stato === 'atto_concluso') {
      const n = (state.fineAtto || {}).atto || 1;
      return '<section class="solo-panel solo-end"><h2 class="solo-h2">Fine del ' + esc(['', 'primo', 'secondo', 'terzo'][n] || n + '°') + ' atto</h2>' +
        '<p>La storia continua con un prossimo aggiornamento del gioco. Questa partita resta salvata e riprenderà da qui.</p></section>';
    }
    const rec = state.esitoFinale;
    const fin = state.finale && RMSoloCampaign.variantDef(content, state.finale);
    const titolo = fin ? 'Campagna conclusa: ' + fin.titolo : state.motivoFine === 'raven' ? 'Raven' : state.stato === 'morto' ? 'Il personaggio è morto' : 'Partita terminata';
    const mods = rec && rec.modificatori ? rec.modificatori.map(m => RMSoloCampaign.variantDef(content, m)).filter(Boolean) : [];
    return '<section class="solo-panel solo-end"><h2 class="solo-h2">' + esc(titolo) + '</h2>' +
      (fin ? '<p>' + esc(fin.riserva) + '</p>' : '') +
      mods.map(m => '<p><b>' + esc(m.titolo) + '.</b> ' + esc(m.riserva) + '</p>').join('') +
      (typeof RMSoloTrama !== 'undefined' && RMSoloTrama.epilogo(state, content) ? (e => '<h3 class="solo-h3">Il tuo obiettivo</h3><p><b>' + esc(e.nome) + ' — ' + esc({ raggiunto: 'raggiunto', parziale: 'raggiunto in parte', mancato: 'non raggiunto' }[e.esito]) + '.</b> ' + esc(e.testo) + '</p>')(RMSoloTrama.epilogo(state, content)) : '') +
      (fin && fin.conseguenza_personale ? '<p><i>' + esc(fin.conseguenza_personale) + '</i></p>' : '') +
      epilogueBonds(state, content) +
      (devMode() && fin && fin.content_status && fin.content_status !== 'approved' ? '<p class="solo-note">Epilogo proposto, da approvare.</p>' : '') +
      (devMode() && state.stato === 'morto' && state.ritorno === 'non_definito' ? '<p class="solo-note">Il ritorno dalla morte non è ancora definito per questi contenuti.</p>' : '') +
      '<p class="solo-note">La partita resta consultabile finché non la sostituisci con una nuova.</p></section>';
  }

  /* Diario a sezioni richiudibili (RMSoloFeedback.diary): in vista solo
     obiettivo corrente, ultimi indizi e ultima conseguenza; lo storico si
     apre a richiesta. Voci senza etichetta leggibile: solo in sviluppo. */
  function diaryPanel(state, content) {
    const d = RMSoloFeedback.diary(state, content);
    const atto = RMSoloCampaign.actDef(content, state.atto) || {};
    const li = l => l.map(x => '<li>' + esc(x) + '</li>').join('');
    const body = d.sezioni.filter(sec => sec.voci.length).map(sec => {
      const n = sec.inVista || sec.voci.length;
      const vista = sec.voci.slice(0, n), resto = sec.voci.slice(n);
      return '<details class="solo-diary-sec" data-sez="' + sec.id + '"' + (sec.aperta ? ' open' : '') + '><summary>' + esc(sec.titolo) + ' <span class="chip">' + sec.voci.length + '</span></summary>' +
        '<ul>' + li(vista) + '</ul>' +
        (resto.length ? '<details class="solo-diary-old"><summary>Storico (' + resto.length + ')</summary><ul>' + li(resto) + '</ul></details>' : '') + '</details>';
    }).join('');
    const err = devMode() && d.errori.length ? '<div class="solo-dev"><b>Diario, voci scartate:</b><ul>' + li(d.errori) + '</ul></div>' : '';
    if (devMode() && d.errori.length && global.console) console.warn('Diario: voci senza etichetta leggibile', d.errori);
    const ob = state.personaggio.obiettivoPersonale;
    const mio = ob ? '<details class="solo-diary-sec" data-sez="obiettivo-personale" open><summary>Il tuo obiettivo</summary><p><b>' + esc(ob.nome) + '</b>' + (ob.dettaglio ? ' — ' + esc(ob.dettaglio) : '') + '</p>' + (typeof RMSoloTrama !== 'undefined' && RMSoloTrama.epilogo(state, content) ? '<ul>' + RMSoloTrama.epilogo(state, content).traguardi.filter(t => t.esito).map(t => '<li>' + esc(t.titolo) + ': ' + esc({ pieno: 'riuscito', parziale: 'in parte', mancato: 'non riuscito' }[t.esito]) + '</li>').join('') + '</ul>' : '') + '</details>' : '';
    const nov = novitaDiario(state, content);
    const novita = nov.length ? '<details class="solo-diary-sec" data-sez="novita" open><summary>Novità <span class="chip">' + nov.length + '</span></summary><ul>' + li(nov.slice(0, 5)) + '</ul>' +
      (nov.length > 5 ? '<details class="solo-diary-old"><summary>Storico (' + (nov.length - 5) + ')</summary><ul>' + li(nov.slice(5)) + '</ul></details>' : '') + '</details>' : '';
    return '<section class="solo-panel solo-diary"><h2 class="solo-h2">Atto ' + ['', 'I', 'II', 'III'][state.atto] + (atto.titolo ? ' — ' + esc(atto.titolo) : '') + '</h2>' + mio + novita + body + err + '</section>';
  }

  /* Scheda con la grafica di "I miei personaggi" (js/solo/solo-sheet.js) */
  /* Mappa della storia: solo luoghi conosciuti e informazioni pubbliche
     (RMSoloMappa.vista). Se la storia ha un'immagine con coordinate si
     riusa il disegno della mappa di gruppo (Leaflet CRS.Simple e pin dei
     luoghi di story_map_2d_v1); altrimenti l'elenco dei luoghi noti. Una
     destinazione è una richiesta: il motore calcola l'itinerario. */
  const CONOSCENZA_LABEL = { sentito_dire: 'ne hai sentito parlare', approssimativo: 'sai più o meno dove si trova', localizzato: 'sai dove si trova', visitato: 'ci {sei stato|sei stata|hai messo piede}', modificato: 'ci {sei stato|sei stata|hai messo piede}: è cambiato', inaccessibile: 'non più raggiungibile' };
  const ROTTA_LABEL = { terrestre: 'via di terra', marittimo: 'per mare', costiero: 'lungo la costa', interno_insediamento: 'dentro l\'insediamento', sotterraneo: 'sotto terra', collegamento_protetto: 'collegamento protetto', esterno_protetto: 'all\'esterno, con protezione sigillata', speciale: 'rotta speciale', da_classificare: 'percorso' };
  const ICONA_LUOGO = { citta: 'insediamento', citta_cupola: 'insediamento', insediamento: 'insediamento', area_pericolosa: 'pericolo', area_inabitabile: 'pericolo', acque: 'natura', territorio: 'natura', regione: 'natura', continente: 'natura' };
  function durataTesto(d) { return d && Number.isFinite(d.valore) ? d.valore + ' ' + (d.unita === 'ore' ? 'ore' : 'giorni') : 'non indicata'; }
  /* Mappa del percorso (Fase 3): le tappe previste, velate finche non scoperte, con la posizione attuale,
     le tappe visitate, la prossima destinazione e i traguardi dell'obiettivo scelto (RMSoloPercorso.vista). */
  const SEGNO_TAPPA = { visitata: '✔', attuale: '●', prossima: '➜', velata: '◌' };
  const NOME_TAPPA = { visitata: 'visitata', attuale: 'sei qui', prossima: 'prossima', velata: 'ancora nascosta' };
  function percorsoPanel(state, content) {
    if (typeof RMSoloPercorso === 'undefined') return '';
    const p = RMSoloPercorso.vista(state, content);
    if (!p) return '';
    const romano = n => ['', 'I', 'II', 'III'][n] || n;
    const tappa = t => '<li class="solo-tappa ' + t.stato + '" data-scena="' + esc(t.scena) + '"><span class="solo-tappa-segno" aria-hidden="true">' + SEGNO_TAPPA[t.stato] + '</span><span class="solo-tappa-testo"><b>' +
      (t.titolo ? esc(t.titolo) : 'Tappa ' + t.indice) + '</b> <small>' + esc(NOME_TAPPA[t.stato]) + (t.luogo ? ' · ' + esc(t.luogo) : '') + '</small>' +
      (t.traguardo ? '<span class="solo-traguardo ' + t.traguardo.stato + '"><span aria-hidden="true">◆</span> ' + (t.traguardo.stato === 'raggiunto' ? '<b>Traguardo:</b> ' + esc(t.traguardo.titolo) : '<b>Traguardo atteso:</b> ' + esc(t.traguardo.indizio)) + '</span>' : '') + '</span></li>';
    const aqui = p.posizione ? 'Atto ' + romano(p.posizione.atto) + ' · tappa ' + p.posizione.indice + ' di ' + p.progresso.totale + (p.posizione.titolo ? ' — ' + esc(p.posizione.titolo) : '') + (p.posizione.luogo ? ' (' + esc(p.posizione.luogo) + ')' : '') : 'da determinare';
    const prossima = p.prossima ? (p.prossima.velata ? 'ancora nascosta: la scoprirai andando avanti' : esc(p.prossima.titolo) + (p.prossima.luogo ? ' (' + esc(p.prossima.luogo) + ')' : '')) : 'nessuna: sei all\'ultima tappa';
    return '<section class="solo-percorso" aria-label="Il percorso"><h3>Il percorso</h3>' +
      (p.obiettivo ? '<p class="solo-percorso-ob"><b>Il tuo filo:</b> ' + esc(p.obiettivo.nome) + (p.obiettivo.dettaglio ? ' — ' + esc(p.obiettivo.dettaglio) : '') + '</p>' : '') +
      '<p class="solo-percorso-qui"><b>Sei qui:</b> ' + aqui + '</p>' +
      '<p class="solo-percorso-next"><b>Prossima destinazione:</b> ' + prossima + '</p>' +
      '<p class="solo-muted solo-small">Tappe percorse: ' + p.progresso.visitate + ' su ' + p.progresso.totale + '. Le tappe nascoste si svelano arrivandoci.</p>' +
      p.atti.map(a => '<details class="solo-percorso-atto"' + (p.posizione && p.posizione.atto === a.numero ? ' open' : '') + '><summary>Atto ' + romano(a.numero) + (a.titolo ? ' — ' + esc(a.titolo) : '') + '</summary><ol class="solo-percorso-lista">' + a.tappe.map(tappa).join('') + '</ol></details>').join('') +
      '</section>';
  }
  function mapPanel(state, content) {
    const v = RMSoloMappa.vista(state, content);
    const nome = id => (v.luoghi.find(l => l.id === id) || {}).nome || '';
    const sel = S.mapSel && v.luoghi.find(l => l.id === S.mapSel) ? S.mapSel : null;
    // alternative realmente possibili (terra, mare, misto): preselezionata la consigliata; con una sola via niente selettore
    const alt = sel || S.mapTesto ? RMSoloMappa.alternative(state, content, sel || S.mapTesto) : null;
    const scelta = alt && alt.alternative.length ? (alt.alternative.find(x => x.modo === S.mapModo) || alt.alternative.find(x => x.consigliata)) : null;
    const piano = scelta ? scelta.piano : alt ? alt.piano : null;
    const viaggio = state.mappa.viaggio;
    const selettore = alt && alt.alternative.length > 1 ? '<section class="solo-map-modi" aria-label="Come raggiungerlo"><h3>Come raggiungerlo</h3><ul class="solo-map-list">' + alt.alternative.map(x => {
      const p = x.piano, rischi = (p.rischi || []).map(r => r.causa).filter(Boolean), manca = p.requisitiMancanti || [];
      return '<li><button type="button" class="solo-map-place' + (x === scelta ? ' sel' : '') + '" data-modo="' + x.modo + '" aria-pressed="' + (x === scelta) + '"><b>' + esc(x.etichetta) + (x.consigliata ? ' <small>consigliata</small>' : '') + '</b>' +
        '<small>Durata: ' + esc(durataTesto(p.durata)) + ' · Tappe: ' + esc(p.tappe.map(nome).join(', ') || 'nessuna intermedia') + '</small>' +
        '<small>' + (rischi.length ? 'Rischi: ' + esc(rischi.join('; ')) : 'Nessun rischio noto') + '</small>' +
        (manca.length ? '<small class="solo-warn">Manca: ' + esc(manca.join(', ')) + '</small>' : '') + '</button></li>';
    }).join('') + '</ul></section>' : '';
    const lista = v.luoghi.map(l => '<li><button type="button" class="solo-map-place' + (l.id === sel ? ' sel' : '') + (l.id === v.posizione ? ' qui' : '') + '" data-luogo="' + esc(l.id) + '"><b>' + esc(l.nome) + '</b><small>' + esc(l.id === v.posizione ? 'sei qui' : RMSoloGenere.applica(CONOSCENZA_LABEL[l.conoscenza] || '', state.personaggio && state.personaggio.genere)) + '</small></button></li>').join('');
    const scheda = sel ? (() => {
      const l = v.luoghi.find(x => x.id === sel);
      return '<section class="solo-map-info" aria-label="Luogo selezionato"><h3>' + esc(l.nome) + '</h3>' + (l.regione ? '<p class="solo-muted">' + esc(l.regione) + '</p>' : '') +
        (l.descrizione ? '<p>' + esc(l.descrizione) + '</p>' : '') + (l.trasformazioni.length ? '<p>' + esc(l.trasformazioni.join(' ')) + '</p>' : '') +
        (l.requisiti.length ? '<p><b>Serve:</b> ' + esc(l.requisiti.join(', ')) + '</p>' : '') + '</section>';
    })() : '';
    const itin = piano ? (piano.tratte && piano.tratte.length ? '<section class="solo-map-route" aria-label="Itinerario"><h3>Itinerario</h3><ol>' + piano.tratte.map(t => '<li>' + esc(nome(t.da) || 'qui') + ' → ' + esc(nome(t.a)) + ' · ' + esc(ROTTA_LABEL[t.tipo] || 'percorso') + '</li>').join('') + '</ol>' +
        '<p><b>Durata:</b> ' + esc(durataTesto(piano.durata)) + '</p>' + (piano.compagni && piano.compagni.length ? '<p><b>Con te:</b> ' + esc(piano.compagni.map(id => (content.png[id] || {}).nome).join(', ')) + '</p>' : '') + '</section>' : '') +
      (piano.ok ? '<div class="solo-map-actions"><button type="button" class="btn btn-primary btn-sm solo-act" data-viaggio="' + esc(piano.destinazione) + '"' + (scelta ? ' data-modo-viaggio="' + scelta.modo + '"' : '') + '>Chiedi al Narratore di raggiungerlo</button><button type="button" class="' + ACT + '" data-map-annulla="1">Annulla</button></div>'
        : '<p class="solo-warn">' + esc(piano.motivo || 'Non puoi andarci adesso.') + '</p><button type="button" class="' + ACT + '" data-map-annulla="1">Annulla</button>') : '';
    // la mappa originale è sempre visibile; i segnaposto sono solo i luoghi che conosci
    const proporzioni = v.dimensioni ? ' style="aspect-ratio:' + v.dimensioni.larghezza + ' / ' + v.dimensioni.altezza + '"' : '';
    const canvas = v.disponibile ? '<div id="solo-map-canvas" class="solo-map-canvas" role="img" aria-label="Mappa della storia con i luoghi che conosci"' + proporzioni + '></div>' +
        '<p class="solo-muted solo-map-legend">Tocca un segnaposto per vederne la scheda. I segnaposto sbiaditi indicano una posizione approssimata.</p>'
      : '<p class="solo-muted">La mappa illustrata di questa storia non è ancora disponibile: qui trovi i luoghi che conosci.</p>';
    return '<section class="solo-map" aria-label="Mappa">' + canvas +
      '<p class="solo-map-pos"><b>Posizione:</b> ' + esc(v.posizione ? nome(v.posizione) : 'da determinare') + '</p>' + percorsoPanel(state, content) +
      (viaggio ? '<div class="solo-map-actions"><p>In viaggio verso ' + esc(nome(viaggio.destinazione)) + '.</p><button type="button" class="btn btn-primary btn-sm solo-act" data-viaggio-prosegui="1">Prosegui il viaggio</button></div>' : '') +
      scheda + selettore + itin +
      '<details class="solo-map-elenco"' + (v.disponibile ? '' : ' open') + '><summary>Luoghi che conosci (' + v.luoghi.length + ')</summary><ul class="solo-map-list">' + lista + '</ul></details>' +
      (viaggio ? '' : '<form class="solo-map-free" id="solo-map-free"><label for="solo-map-dest">Dove vuoi andare?</label><div><input id="solo-map-dest" type="text" autocomplete="off" maxlength="120" value="' + esc(S.mapTesto || '') + '"><button type="submit" class="' + ACT + '">Proponi</button></div></form>') +
      '</section>';
  }
  function wireMap() {
    root().querySelectorAll('[data-luogo]').forEach(b => b.addEventListener('click', () => { S.mapSel = b.dataset.luogo; S.mapTesto = null; S.mapModo = null; renderGame(); }));
    root().querySelectorAll('[data-modo]').forEach(b => b.addEventListener('click', () => { S.mapModo = b.dataset.modo; renderGame(); }));
    root().querySelectorAll('[data-map-annulla]').forEach(b => b.addEventListener('click', () => { S.mapSel = null; S.mapTesto = null; S.mapModo = null; renderGame(); }));
    root().querySelectorAll('[data-viaggio]').forEach(b => b.addEventListener('click', async () => { const d = b.dataset.viaggio, modo = b.dataset.modoViaggio; S.mapSel = null; S.mapTesto = null; S.mapModo = null; S.tab = 'gioco'; await submit({ tipo: 'viaggio', sorgente: 'mappa', destinazione: d, modo: modo === 'terra' || modo === 'mare' ? modo : undefined }); }));
    root().querySelectorAll('[data-viaggio-prosegui]').forEach(b => b.addEventListener('click', async () => { S.tab = 'gioco'; await submit({ tipo: 'viaggio_prosegui', sorgente: 'mappa' }); }));
    const f = $v('#solo-map-free');
    if (f) f.addEventListener('submit', e => { e.preventDefault(); const t = ($v('#solo-map-dest').value || '').trim(); S.mapSel = null; S.mapTesto = t || null; S.mapModo = null; renderGame(); });
    const cv = $v('#solo-map-canvas');
    if (cv && typeof L !== 'undefined') {
      const content = gameContent();
      const v = RMSoloMappa.vista(S.state, content);
      const w = v.dimensioni.larghezza, h = v.dimensioni.altezza;
      const lmap = L.map(cv, { crs: L.CRS.Simple, minZoom: -4, maxZoom: 2, zoomSnap: 0.1, zoomDelta: 0.5, attributionControl: false });
      const bounds = [[0, 0], [h, w]];
      L.imageOverlay(v.immagine, bounds).addTo(lmap);
      lmap.fitBounds(bounds, { padding: [0, 0] });
      lmap.setMinZoom(lmap.getZoom() - 0.5);
      lmap.setMaxBounds(L.latLngBounds(bounds).pad(0.15));
      // stessa convenzione della mappa di gruppo (coordinate normalizzate, y verso il basso)
      const toLL = c => typeof mapNormToLatLng === 'function' ? mapNormToLatLng(c.x, c.y, w, h) : [h - c.y * h, c.x * w];
      const punti = {};
      v.luoghi.filter(l => l.coordinate).forEach(l => {
        const ll = toLL(l.coordinate);
        const qui = l.id === v.posizione;
        // più luoghi approssimati sullo stesso punto (stanze di un insediamento): un solo segnaposto, quello della posizione se c'è
        const chiave = l.coordinate.x + ',' + l.coordinate.y;
        if (l.approssimativo && punti[chiave] && !qui) return;
        if (punti[chiave] && punti[chiave].qui) return;
        if (punti[chiave]) lmap.removeLayer(punti[chiave].mk);
        // pin per la posizione e i luoghi visitati; un punto discreto per gli altri luoghi noti (la mappa ha già le etichette)
        const pin = qui || l.id === S.mapSel || ['visitato', 'modificato'].indexOf(l.conoscenza) !== -1;
        const icon = pin && typeof mapLocationMarkerIcon === 'function' ? mapLocationMarkerIcon({ icon: ICONA_LUOGO[l.tipo] || 'luogo', visible_to_players: true }, qui ? 30 : 22, l.approssimativo && !qui) : undefined;
        const mk = pin ? L.marker(ll, icon ? { icon, keyboard: true, title: l.nome, zIndexOffset: qui ? 1000 : 0 } : { title: l.nome }).addTo(lmap)
          : L.circleMarker(ll, { radius: 6, color: '#ffffff', weight: 1.5, fillColor: '#f28c28', fillOpacity: l.approssimativo ? 0.35 : 0.8 }).addTo(lmap);
        mk.bindTooltip(esc(l.nome) + (qui ? ' · sei qui' : ''), { direction: 'top', offset: [0, -10] });
        mk.on('click', () => { S.mapSel = l.id; renderGame(); });
        punti[chiave] = { mk, qui };
      });
      // itinerario proposto: linea fra le tappe che hanno un punto sulla mappa
      const pianoSel = S.mapSel ? RMSoloMappa.pianifica(S.state, content, S.mapSel) : S.mapTesto ? RMSoloMappa.pianifica(S.state, content, S.mapTesto) : null;
      if (pianoSel && pianoSel.tratte && pianoSel.tratte.length) {
        const coord = id => { const l = v.luoghi.find(x => x.id === id); return l && l.coordinate ? toLL(l.coordinate) : null; };
        const linea = [coord(v.posizione)].concat(pianoSel.tratte.map(t => coord(t.a))).filter(Boolean);
        if (linea.length > 1) L.polyline(linea, { color: '#f2c14e', weight: 3, dashArray: '6 6' }).addTo(lmap);
      }
    }
  }

  /* Scheda: la scheda completa è quella di «I miei personaggi» (js/solo/solo-link.js);
     qui restano i dettagli che esistono solo in partita (premessa, legami,
     capacità e gemme, zaino). */
  function apriSchedaCompleta(state, tab) {
    if (!global.RMSoloLink) return;
    const info = STORIE_INFO[S.storia];
    RMSoloLink.apri(state, info && info.titolo || S.storia, tab || (state.personaggio.levelUpInAttesa ? RMSoloLink.tabLevelUp(state.personaggio) : 'gioco'));
  }
  function sheetPanel(state, content) {
    const inventario = (state.inventario || []).map(i => { const d = RMSoloEngine.itemInfo(state, content, i.id); return { nome: d ? d.nome : i.id, qty: i.qty }; });
    const lv = state.personaggio.levelUpInAttesa;
    return '<section class="solo-actions" id="solo-scheda-completa">' +
      (lv ? '<p class="solo-warn"><b>Level up da completare.</b> Spendi statistiche e tratti nella scheda completa, poi concludilo.</p>' : '') +
      '<button type="button" class="btn btn-primary solo-act" data-apri-scheda="1">' + (lv ? 'Vai al level up' : 'Apri la scheda completa') + '</button>' +
      '<p class="helper-text">Statistiche, tratti, livelli ed equipaggiamento: la stessa scheda di «I miei personaggi».</p></section>' +
      RMSoloSheet.render(state.personaggio, { tab: S.sheetTab, partita: true, editabile: true, inventario, ritrattoPredefinito: defaultPortrait(state.storia, state.personaggio.archetipo),
        gemInfo: id => S.busy ? Object.assign(RMSoloEngine.gemInfo(state, content, id), { scaricabile: false }) : RMSoloEngine.gemInfo(state, content, id),
        statoCapacita: (kind, t) => RMSoloEngine.capacityStatus(state, content, kind, t),
        dev: devMode(), anteprima: !!state.anteprima });
  }

  /* ------------------------------------------------------ ritratti */
  function defaultPortrait(storia, archId) {
    const a = ((S.archetipi[storia] || {}).archetipi || []).find(x => x.id === archId);
    return (a && a.ritratto) || 'img/solo/ritratti/predefinito.svg';
  }
  function readPortrait(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          if (typeof compressPortraitImage === 'function') return resolve(compressPortraitImage(img).dataUrl);
          const k = Math.min(1, 512 / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.85));
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Immagine non leggibile')); };
      img.src = url;
    });
  }
  /* Collega tab e pulsanti del ritratto di una scheda; setPortrait(url|null) */
  function wireSheet(onTab, setPortrait) {
    const box = root().querySelector('.solo-sheet'); if (!box) return;
    RMSoloSheet.wire(box, onTab);
    const f = $v('#solo-portrait-file');
    if (f) f.addEventListener('change', async () => {
      if (!f.files.length) return;
      try { await setPortrait(await readPortrait(f.files[0])); } catch (e) { toastSafe('Immagine non valida: ' + e.message); }
    });
    const r = $v('#solo-portrait-reset'); if (r) r.addEventListener('click', () => setPortrait(null));
    box.querySelectorAll('[data-scarica]').forEach(b => b.addEventListener('click', () => dischargeGem(b.dataset.scarica)));
  }
  /* Scarica di una gemma: conferma con MP e capacità perse, poi un'azione
     completa (in combattimento è il turno del protagonista). */
  async function dischargeGem(id) {
    const i = RMSoloEngine.gemInfo(S.state, gameContent(), id);
    if (!i || !i.scaricabile) return;
    const ok = await modal(i.nome, '<p>Scaricando questa gemma recupererai ' + i.recuperoEffettivo + ' MP' + (i.capacitaSospesa ? '; ' + esc(i.capacita) + ' non è comunque disponibile per la tua classe' : ', ma perderai ' + esc(i.capacita) + ' fino al prossimo reintegro') + '. Vuoi proseguire?</p>',
      [{ label: 'Annulla', value: false }, { label: 'Scarica la gemma', value: true, cls: 'btn-primary' }]);
    if (!ok) return;
    S.tab = 'gioco';
    await submit(S.state.incontro ? { tipo: 'combattimento', azione: 'scarica_gemma', gemmaId: id } : { tipo: 'scarica_gemma', gemmaId: id });
  }
  async function reintegrateGem() {
    const scariche = (S.state.personaggio.gemme || []).filter(g => g.stato === 'scarica');
    const v = await modal('Reintegro all\'avamposto', '<p>Puoi reintegrare una sola gemma prima del prossimo avamposto. Il reintegro non restituisce MP.</p>',
      scariche.map(g => ({ label: g.nome, value: g.id, cls: 'btn-primary' })).concat([{ label: 'Annulla', value: null }]));
    if (v) await submit({ tipo: 'reintegra_gemma', gemmaId: v });
  }
  async function setGamePortrait(url) {
    const next = JSON.parse(JSON.stringify(S.state));
    next.personaggio.ritratto = url;
    await RMSoloStore.save(next); S.state = next; renderGame();
  }

  function wireActions() {
    const content = gameContent();
    const sc = RMSoloEngine.currentScene(S.state, content);
    root().querySelectorAll('[data-segnala]').forEach(b => b.addEventListener('click', () => {
      const ev = S.state.eventi.find(e => e.n === +b.dataset.segnala), nar = (ev && ev.narrazione) || {};
      if (typeof RMSoloSegnalazioni !== 'undefined') RMSoloSegnalazioni.apri({ testo: nar.testo, modello: nar.modello, storia: S.storia, scena: ev && ev.scena });
    }));
    root().querySelectorAll('[data-sugg]').forEach(b => b.addEventListener('click', () => {
      const s = (sc.suggerimenti || [])[+b.dataset.sugg]; // indice originale (solo-scena.js, candidati)
      const it = s.oggetto && RMSoloEngine.itemDef(content, s.oggetto);
      submit({ tipo: 'azione', sorgente: 'pulsante', testo: s.testo, proposta: { tipo: 'azione', obiettivo: s.obiettivo, tratto: s.tratto, oggetto: it && RMSoloEngine.hasItem(S.state, s.oggetto) ? it.nome : 'nessuno', qualita: 'normale' } });
    }));
    root().querySelectorAll('[data-obiettivo]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'obiettivo_personale', sorgente: 'pulsante' })));
    const orac = $v('#solo-oracolo'); if (orac) orac.addEventListener('click', () => { const t = ($v('#solo-input').value || '').trim(); if (t) submit({ tipo: 'oracolo', sorgente: 'testo', domanda: t, testo: t }); else toastSafe('Scrivi qui sopra una domanda a cui si possa rispondere sì o no.'); });
    const m2 = $v('#solo-opz-motore2'); if (m2) m2.addEventListener('change', async () => { const v = m2.checked; const next = RMSoloMondo.impostaOpzioni(S.state, { mondo: v, regia: v, narratore: v, post: v, interprete: v, memoria: v }); await RMSoloStore.save(next); S.state = next; renderGame(); });
    const impo = $v('#solo-opz-imprevisti'); if (impo) impo.addEventListener('change', async () => { const next = RMSoloEngine.impostaOpzione(S.state, 'imprevisti', impo.checked); await RMSoloStore.save(next); S.state = next; renderGame(); });
    root().querySelectorAll('[data-scelta]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'scelta', sceltaId: b.dataset.scelta })));
    root().querySelectorAll('[data-incontro]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'incontro', scelta: b.dataset.incontro })));
    root().querySelectorAll('[data-esplora]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'esplora', punto: b.dataset.esplora, sorgente: 'pulsante' })));
    // passo della scena proposto come pulsante: la stessa azione aperta che il giocatore potrebbe scrivere
    root().querySelectorAll('[data-passo]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'azione_aperta', sorgente: 'pulsante', testo: b.dataset.testo, atto: b.dataset.atto, png: b.dataset.png || null })));
    // il resto dell'intenzione del giocatore: come se la scrivesse
    root().querySelectorAll('[data-libera]').forEach(b => b.addEventListener('click', () => submitText(b.dataset.libera)));
    root().querySelectorAll('[data-dialogo]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'dialogo_inizia', png: b.dataset.dialogo, sorgente: 'pulsante' })));
    root().querySelectorAll('[data-argomento]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'battuta', argomento: b.dataset.argomento, sorgente: 'pulsante' })));
    const chiudi = root().querySelector('[data-chiudi]'); if (chiudi) chiudi.addEventListener('click', () => submit({ tipo: 'dialogo_chiudi', sorgente: 'pulsante' }));
    const avanti = root().querySelector('[data-prosegui]'); if (avanti) avanti.addEventListener('click', () => submit({ tipo: 'prosegui', sorgente: 'pulsante' }));
    root().querySelectorAll('[data-bersaglio]').forEach(b => b.addEventListener('click', () => { S.bersaglio = b.dataset.bersaglio; renderGame(); }));
    root().querySelectorAll('[data-combat]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'combattimento', azione: b.dataset.combat, abilitaId: b.dataset.id, forza: b.dataset.forza === '1' || undefined, bersaglio: S.state.incontro && S.state.incontro.gruppo ? (S.bersaglio && S.state.incontro.nemici.some(n => n.uid === S.bersaglio && n.attivo) ? S.bersaglio : S.state.incontro.bersaglio) : undefined })));
    const gm = root().querySelector('[data-gemme]'); if (gm) gm.addEventListener('click', () => { S.tab = 'scheda'; S.sheetTab = 'capacita'; renderGame(); const el = root().querySelector('.solo-gem'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); });
    root().querySelectorAll('[data-apri-scheda], [data-migliora]').forEach(b => b.addEventListener('click', () => apriSchedaCompleta(S.state)));
    root().querySelectorAll('[data-dev]').forEach(b => b.addEventListener('click', () => devTool(b.dataset.dev)));
    const rest = root().querySelector('[data-riposo]'); if (rest) rest.addEventListener('click', () => submit({ tipo: 'riposo' }));
    const rech = root().querySelector('[data-ricarica]'); if (rech) rech.addEventListener('click', reintegrateGem);
    root().querySelectorAll('[data-raccogli]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'raccogli', istanza: b.dataset.raccogli })));
    root().querySelectorAll('[data-usa]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'usa', oggetto: b.dataset.usa })));
    root().querySelectorAll('[data-pregio]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'pregio', sorgente: 'pulsante', abilitaId: b.dataset.ab, pregio: b.dataset.pregio, stato: b.dataset.stato || undefined })));
    root().querySelectorAll('[data-slot-esempio]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'assegna_slot', sorgente: 'pulsante', kind: b.dataset.kind, esempio: b.dataset.slotEsempio })));
    root().querySelectorAll('form[data-slot-propria]').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      const d = new FormData(f), danno = d.get('tipo') === 'danno';
      submit({ tipo: 'assegna_slot', sorgente: 'modulo', kind: f.dataset.kind, propria: Object.assign({ nome: d.get('nome'), tipo: d.get('tipo'), durata: d.get('durata') },
        danno ? { dannoBase: Number(d.get('dannoBase')), stat: d.get('stat'), dannoTipo: d.get('dannoTipo') || 'fisico' } : { bonus: [{ stat: d.get('bonusStat'), valore: Number(d.get('bonusValore')) }] }) });
    }));
    root().querySelectorAll('[data-boost]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'combattimento', azione: 'boost', boostId: b.dataset.boost, livello: Number(b.dataset.livello) })));
    root().querySelectorAll('[data-boost-estendi]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'combattimento', azione: 'boost_estendi' })));
    // scelta della difesa: non consuma il turno; viaggia con il prossimo comando di combattimento e il motore la registra
    root().querySelectorAll('[data-difesa]').forEach(b => b.addEventListener('click', () => { if (S.busy) return; S.difesa = b.dataset.difesa; renderGame(); }));
    // griglia dello scontro: spostarsi su una casella raggiungibile (tocco o tastiera) non consuma l'azione del round
    root().querySelectorAll('[data-muovi]').forEach(c => {
      const vai = () => { if (S.busy) return; const [col, row] = c.getAttribute('data-muovi').split(',').map(Number); submit({ tipo: 'combattimento', azione: 'muovi', verso: { col, row } }); };
      c.addEventListener('click', vai);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vai(); } });
    });
    root().querySelectorAll('[data-combat-oggetto]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'combattimento', azione: 'oggetto', oggetto: b.dataset.combatOggetto, bersaglio: S.state.incontro && S.state.incontro.gruppo ? S.state.incontro.bersaglio : undefined })));
    // tastiera aperta: il campo di testo resta visibile sopra la tastiera
    const inp = $v('#solo-input');
    if (inp) inp.addEventListener('focus', () => setTimeout(() => { if (inp.scrollIntoView) inp.scrollIntoView({ block: 'center' }); }, 300));
    const form = $v('#solo-free');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); const t = $v('#solo-input').value.trim(); if (t) submitText(t); });
    const regen = $v('#solo-regen'); if (regen) regen.addEventListener('click', regenerateLast);
    const stileAz = $v('#solo-stile-azzera'); if (stileAz) stileAz.addEventListener('click', azzeraStile);
    const ab = $v('#solo-abort'); if (ab) ab.addEventListener('click', () => { if (S.abort) S.abort.abort(); });
    const tira = $v('#solo-tira'); if (tira) tira.addEventListener('click', tiraProva);
    const ann = $v('#solo-prova-annulla'); if (ann) ann.addEventListener('click', annullaProvaUI);
  }

  function setBusy(b) {
    S.busy = b;
    root().querySelectorAll('#solo-actions button:not([data-keep-enabled]), #solo-actions textarea').forEach(el => { el.disabled = b; });
  }

  /* Chiarimento dell'interprete (motore V2): nessun tempo passa finché il giocatore non sceglie. Ritorna la scelta
     ({ fields }), 'forza' (fai come ho scritto) o null (riscrivo io). */
  async function chiarisci(ch) {
    const bottoni = ch.alternative.map((a, i) => ({ label: String(a.etichetta).slice(0, 90), value: i, cls: 'btn-primary' }))
      .concat([{ label: 'Fai come ho scritto', value: 'forza' }, { label: 'Riscrivo io', value: 'annulla' }]);
    const v = await modal('Non è chiaro', '<p>' + esc(ch.domanda) + '</p><p class="solo-muted">Nessun tempo passa finché non scegli.</p>', bottoni);
    if (v === 'forza') return 'forza';
    return typeof v === 'number' ? ch.alternative[v] : null;
  }

  async function submitText(text, forzaIn) {
    if (S.busy) return;
    setBusy(true);
    const content = gameContent();
    let bozza = null;   // «Riscrivo io»: il testo torna nel campo
    try {
      if (S.state.incontro) {
        // in combattimento il testo libero passa dal riconoscimento di RMSoloTurno: capacità della scheda, arma, fuga e manovre
        // (sgambetto, disarmo, spinta, presa: decisione dell'autore del 6/11, le manovre vanno comprese, non trasformate in un attacco)
        const inc = S.state.incontro;
        const bers = inc.gruppo ? ((S.bersaglio && inc.nemici.some(n => n.uid === S.bersaglio && n.attivo)) ? S.bersaglio : inc.bersaglio) : undefined;
        const conB = c => Object.assign({}, c, { bersaglio: bers });
        const rc = RMSoloTurno.instradaCombattimento(S.state, text);
        if (rc.via === 'nessuno') { toastSafe(rc.avviso); bozza = text; return; }
        if (rc.via === 'chiarimento') {
          const sc = await chiarisci(rc.chiarimento);
          if (sc && sc !== 'forza' && sc.fields) await apply(conB(sc.fields));
          else if (sc === 'forza' && rc.chiarimento.alternative.length) await apply(conB(rc.chiarimento.alternative[rc.chiarimento.alternative.length - 1].fields));
          else bozza = text;
          return;
        }
        for (const c of rc.cmds) await apply(conB(c));
        return;
      }
      // Instradamento condiviso con l'harness (js/solo/solo-turno.js): dialogo, domanda al mondo (oracolo),
      // chiarimento dell'interprete (motore V2), personaggio, improvvisazione, esplorazione, interprete.
      // Una frase ambigua non consuma il turno: si chiede, con scelte concrete.
      sincronizzaMotore();
      let forza = !!forzaIn, rt;
      for (;;) {
        rt = RMSoloTurno.instrada(S.state, content, text, { forza });
        if (!rt.chiarimento) break;
        const sc = await chiarisci(rt.chiarimento);
        if (sc === 'forza') { forza = true; continue; }
        if (sc && sc.cmds) await applyTutti(sc.cmds);
        else if (sc && sc.fields) await apply(sc.fields);
        else bozza = text;
        return;
      }
      if (rt.via === 'nessuno') { toastSafe(rt.avviso); return; }
      const intento = rt.cmds[0] && rt.cmds[0].intento;
      if (rt.via === 'azione') { await applyTutti(rt.cmds); return; }
      if (rt.via === 'dialogo' || rt.via === 'oracolo' || rt.via === 'esplora') { await apply(rt.cmds[0]); return; }
      // intenzione di avanzare: i comandi del passo successivo (punto richiesto, apertura del dialogo o tentativo dell'obiettivo)
      if (rt.via === 'avanza') { await applyTutti(rt.cmds); return; }
      // un testo rivolto a un PNG presente con cui si può parlare apre il dialogo e diventa la prima battuta
      if (rt.via === 'png') { await applyTutti(rt.cmds); return; }
      // scene-seme: il Regista improvvisa. Percorso narrativo = una chiamata
      // (proposta con testo, validata dal motore); percorso meccanico = due
      // (proposta, poi racconto dell'esito del motore); senza modello la
      // proposta deterministica e i testi di riserva
      if (rt.via === 'improvvisa') {
        const t0 = Date.now();
        const fields = rt.cmds[0];
        if (RMSoloLLM.ready()) {
          const gameId = S.state.id, version = S.state.version;
          const r = await RMSoloNarrator.regia(RMSoloLLM, S.state, content, text, { voce: S.voce[S.storia] });
          if (!S.state || S.state.id !== gameId || S.state.version !== version) return; // risposta tardiva: scartata
          const v = r.proposta ? RMSoloImprov.valida(S.state, content, r.proposta) : null;
          if (r.proposta) { fields.regia = r.proposta; fields.fonte = 'ia'; fields.modello = r.modello || null; }
          fields.interprete = { fonte: r.proposta ? 'ia' : 'riserva', percorso: v && RMSoloImprov.meccanica(v) ? 'meccanico' : 'narrativo', ms: Date.now() - t0, errore: r.errore || null };
        } else fields.interprete = { fonte: 'riserva', percorso: 'deterministico', ms: 0, errore: null };
        await apply(fields);
        return;
      }
      const gameId = S.state.id, version = S.state.version;
      const r = await RMSoloNarrator.interpret(RMSoloLLM, S.state, content, text);
      if (!S.state || S.state.id !== gameId || S.state.version !== version) return; // risposta tardiva: scartata
      await apply({ tipo: 'azione', sorgente: 'testo', testo: text, proposta: r.proposta, intento, interprete: { fonte: r.fonte, ms: r.ms, errore: r.errore || null } });
    } finally {
      setBusy(false);
      if (S.view === 'gioco') renderGame();
      const inp = bozza != null && $v('#solo-input'); if (inp) { inp.value = bozza; inp.focus(); }
    }
  }

  /* Più comandi dallo stesso messaggio: se uno chiede una prova, gli altri aspettano il tiro (restano nella proposta). */
  async function applyTutti(cmds) {
    for (let i = 0; i < cmds.length; i++) { if ((await apply(cmds[i], cmds.slice(i + 1))) === 'attesa') return 'attesa'; }
  }
  async function tiraProva() {
    if (S.busy || !S.state || !S.state.provaInAttesa) return;
    setBusy(true);
    try {
      const dopo = S.state.provaInAttesa.dopo || [];
      await apply(null, null, { comando: RMSoloEngine.comandoDaTirare(S.state) });
      if (dopo.length && S.state && !S.state.provaInAttesa) await applyTutti(dopo);
    } finally { setBusy(false); if (S.view === 'gioco') renderGame(); }
  }
  async function annullaProvaUI() {
    if (S.busy || !S.state || !S.state.provaInAttesa) return;
    const testo = S.state.provaInAttesa.comando && S.state.provaInAttesa.comando.testo;
    const next = RMSoloEngine.annullaProva(S.state);
    try { await RMSoloStore.save(next); } catch (e) { toastSafe('Salvataggio non riuscito (' + e.message + ')'); return; }
    S.state = next;
    renderGame();
    const inp = $v('#solo-input'); if (inp) { inp.value = testo || ''; inp.focus(); }
  }

  async function submit(fields) {
    if (S.busy) return;
    setBusy(true);
    try { await apply(fields); } finally { setBusy(false); if (S.view === 'gioco') renderGame(); }
  }

  async function apply(fields, resto, opz) {
    // la difesa scelta nel pannello dello scontro accompagna ogni comando di combattimento, anche da testo libero
    if (fields && fields.tipo === 'combattimento' && S.difesa && !fields.difesa) fields = Object.assign({}, fields, { difesa: S.difesa });
    sincronizzaMotore();
    const content = gameContent();
    const confermato = opz && opz.comando;
    const cmd = confermato ? opz.comando : Object.assign({ id: uuid(), expectedVersion: S.state.version }, fields);
    const env = { content, dice: RMSoloRules.makeDice(), now: Date.now(), voce: S.voce[S.storia] || null };
    // prova confermata (4/11/2026): un'azione del giocatore che richiede una prova non tira subito; si propone la prova e si aspetta «Tira»
    if (!confermato && !S.state.incontro && cmd.tipo !== 'combattimento' && RMSoloEngine.sondaProva) {
      const prova = RMSoloEngine.sondaProva(S.state, cmd, env);
      if (prova) {
        const next = RMSoloEngine.proponiProva(S.state, cmd, prova, resto || []);
        try { await RMSoloStore.save(next); } catch (e) { toastSafe('Salvataggio non riuscito (' + e.message + ')'); return 'errore'; }
        S.state = next;
        renderGame();
        return 'attesa';
      }
    }
    let res;
    try { res = RMSoloEngine.applyCommand(S.state, cmd, env); }
    catch (e) { toastSafe(e.message); return; }
    // percorso del turno (misure future sul dispositivo): strutturato,
    // narrativo, meccanico o deterministico
    res.event.interprete = (fields && fields.interprete) || (confermato && confermato.interprete) || { percorso: 'strutturato' };
    try { await RMSoloStore.save(res.state); }
    catch (e) {
      // il salvataggio è la conferma: se fallisce, l'azione non è avvenuta
      toastSafe('Salvataggio non riuscito: azione annullata (' + e.message + ')');
      const slot = await RMSoloStore.get(S.storia); S.state = slot && slot.partita; return;
    }
    S.state = res.state;
    renderGame();
    await narrateEvent(res.event.n);
  }

  /* Comandi decisi dalla scheda completa di "I miei personaggi"
     (js/solo/solo-link.js: spese di AP e punti, conclusione del level up):
     ognuno passa dallo stesso applyCommand della partita, che convalida,
     salva e chiude il blocco levelUpInAttesa. Si ferma al primo rifiuto. */
  async function comandiDaScheda(soloId, comandi) {
    if (!S.state || S.state.id !== soloId) return { ok: false, errore: "Apri la partita dalla solitaria per completare l'operazione." };
    const motivo = motivoSpesaBloccata(S.state);
    if (motivo) return { ok: false, errore: motivo };
    setBusy(true);
    try {
      for (const fields of comandi) {
        const v0 = S.state.version;
        await apply(fields);
        if (S.state.version === v0) return { ok: false, errore: 'La partita ha rifiutato il comando.' };
      }
      return { ok: true };
    } finally { setBusy(false); if (S.view === 'gioco') renderGame(); }
  }

  async function narrateEvent(n) {
    const content = gameContent();
    const ev = S.state.eventi[n - 1];
    if (!ev || (ev.narrazione && ev.narrazione.stato === 'pronta')) return;
    const gameId = S.state.id;
    S.abort = RMSoloLLM.ready() ? new AbortController() : null;
    if (S.abort && S.view === 'gioco') renderGame();
    let nar;
    // testo mostrato mentre viene scritto: ogni battuta appena completa; il racconto controllato dal motore lo sostituisce alla fine
    const anteprima = t => { if (S.state && S.state.id === gameId) { S.anteprima = { n, testo: t }; if (S.view === 'gioco') renderGame(); } };
    try {
      nar = await RMSoloNarrator.narrate(RMSoloLLM, S.state, content, ev, { signal: S.abort && S.abort.signal, voce: S.voce[S.storia], anteprima });
      // una sola rigenerazione, con il motivo, se la risposta non passa i controlli; poi l'aggancio rifà tutto e, se serve, usa la riserva
      const v = nar && nar.fonte === 'ia' && RMSoloEngine.verificaNarrazione ? RMSoloEngine.verificaNarrazione(S.state, content, n, nar, S.voce[S.storia]) : null;
      if (v && !v.ok && RMSoloLLM.ready() && !(S.abort && S.abort.signal.aborted)) {
        const nar2 = await RMSoloNarrator.narrate(RMSoloLLM, S.state, content, ev, { signal: S.abort && S.abort.signal, voce: S.voce[S.storia], anteprima, correzione: v.problemi });
        if (nar2 && nar2.fonte === 'ia') nar = Object.assign({}, nar2, { rigenerata: v.problemi });
      }
    }
    finally { S.abort = null; S.anteprima = null; }
    // Risposta tardiva: se nel frattempo si è cambiata partita o schermata,
    // il testo non tocca il nuovo personaggio (resterà "da generare").
    if (!S.state || S.state.id !== gameId) { if (RMSoloLLM.esitoDiagnostica) RMSoloLLM.esitoDiagnostica(gameId, n, { fonte: 'riserva', scarto: ['risposta_tardiva'] }); return; }
    RMSoloLLM.notaTurno(nar);
    const next = RMSoloEngine.attachNarration(S.state, content, n, nar, S.voce[S.storia]);
    if (RMSoloLLM.esitoDiagnostica) RMSoloLLM.esitoDiagnostica(gameId, n, next.eventi[n - 1].narrazione);
    try { await RMSoloStore.save(next); if (S.state && S.state.id === gameId) S.state = next; } catch (e) { /* resta "da generare": si riprova alla ripresa */ }
    if (S.view === 'gioco') renderGame();
  }

  async function narratePending() {
    if (!S.state) return;
    for (const ev of S.state.eventi) if (ev.narrazione && ev.narrazione.stato === 'da_generare') await narrateEvent(ev.n);
  }

  async function regenerateLast() {
    if (S.busy) return;
    const content = gameContent();
    const ev0 = S.state.eventi[S.state.eventi.length - 1];
    const stato = RMSoloEngine.riprovaStato(S.state, content, { occupato: false, modello: RMSoloLLM.ready() });
    // in sviluppo la riscrittura resta possibile anche con la riserva; per i giocatori solo se «Riprova» è disponibile
    if (!stato.disponibile && !(devMode() && ev0 && ev0.narrazione && ev0.narrazione.stato === 'pronta' && !ev0.testoFisso)) { toastSafe(stato.motivo); return; }
    setBusy(true);
    try {
      const ev = ev0;
      S.abort = RMSoloLLM.ready() ? new AbortController() : null;
      renderGame(); setBusy(true);
      const gameId = S.state.id;
      const usate = ev.riprove || 0;
      // variante: stessa scena, parole diverse (un po' più di libertà a ogni tentativo, mai l'esito)
      const nar = await RMSoloNarrator.narrate(RMSoloLLM, S.state, content, ev, { signal: S.abort && S.abort.signal, voce: S.voce[S.storia], evita: ev.narrazione && ev.narrazione.testo, temperatura: Math.min(0.9, 0.5 + 0.15 * usate) });
      if (!S.state || S.state.id !== gameId) return;
      const next = RMSoloEngine.attachNarration(S.state, content, ev.n, nar, S.voce[S.storia], { riprova: true });
      if (RMSoloLLM.esitoDiagnostica) RMSoloLLM.esitoDiagnostica(gameId, ev.n, next.eventi[ev.n - 1].narrazione);
      await RMSoloStore.save(next); S.state = next;
    } finally { S.abort = null; setBusy(false); renderGame(); }
  }
  /* Dimentica lo stile del giocatore: la partita non cambia (nessun evento). */
  async function azzeraStile() {
    if (S.busy) return;
    const next = RMSoloEngine.azzeraStile(S.state);
    await RMSoloStore.save(next); S.state = next;
    toastSafe('Ho dimenticato come scrivi.');
    renderGame();
  }

  global.openSoloHub = function (mondo) {
    if (!soloEnabled()) return;
    S.origine = null; S.mondo = typeof mondo === 'string' ? mondo : null;
    if (typeof showView === 'function') showView('solo');
    renderHub();
  };

  /* Ingresso diretto da una storia (pagina dell'avventura nel Compendio):
     stessi salvataggi (RMSoloStore, uno slot per storia) e stessi flussi
     dell'elenco "Le tue partite" — openGame per riprendere o consultare,
     startSetup per una nuova partita, replaceFlow alla conferma finale. */
  function soloEnabled() { return !(typeof rmFeatureEnabled === 'function' && !rmFeatureEnabled('solo_player_v1')); }
  async function slotInfo(storia) {
    const info = STORIE_INFO[storia];
    if (!info || !info.disponibile || !soloEnabled()) return { storia, disponibile: false, stato: 'nessuna' };
    const slot = await RMSoloStore.get(storia);
    const p = slot && slot.partita;
    // una nuova partita richiede almeno un personaggio selezionabile (valori
    // meccanici approvati, o anteprima attiva): stesso filtro di renderSetup
    if (!S.archetipi[storia]) S.archetipi[storia] = await loadJson('js/solo/content/' + storia + '-archetipi.json');
    const nuova = selezionabili(S.archetipi[storia].archetipi).length > 0;
    if (!p && !nuova) return { storia, disponibile: false, stato: 'nessuna' };
    return { storia, disponibile: true, nuova, avventura: info.avventura, stato: !p ? 'nessuna' : (p.stato === 'attivo' ? 'attiva' : 'conclusa'), esito: p ? p.stato : null, personaggio: p ? p.personaggio.nome : null };
  }
  /* Nuova partita dalla carta della storia: la conferma di sostituzione viene prima (una sola volta), poi la preparazione. */
  async function nuovaPartita(storia, opts) {
    const info = await slotInfo(storia);
    if (!info.disponibile || info.nuova === false) { toastSafe('Una nuova partita in questa storia non è ancora disponibile.'); return false; }
    S.sostituzioneConfermata = false;
    if (info.stato !== 'nessuna') {
      if (!(await replaceFlow())) return false;
      S.sostituzioneConfermata = true;
    }
    S.origine = (opts && opts.origine) || null;
    if (typeof showView === 'function') showView('solo');
    await startSetup(storia);
    return true;
  }
  async function playStory(storia, opts) {
    const o = opts || {};
    const info = await slotInfo(storia);
    if (!info.disponibile) { toastSafe('Gioca in solitaria: non ancora disponibile per questa storia.'); return false; }
    if (info.stato === 'conclusa' && o.azione !== 'consulta' && !info.nuova) { toastSafe('Una nuova partita in questa storia non è ancora disponibile.'); return false; }
    if (info.stato === 'conclusa' && o.azione !== 'consulta') {
      const ans = await modal('Sostituire la partita conclusa?',
        '<p>La partita di ' + esc(info.personaggio) + ' in questa storia è conclusa ed è ancora consultabile. Iniziando una nuova partita verrà sostituita.</p>',
        [{ label: 'Annulla', value: 'annulla' }, { label: 'Consulta la partita', value: 'consulta' }, { label: 'Nuova partita', value: 'nuova', cls: 'btn-primary' }]);
      if (ans !== 'consulta' && ans !== 'nuova') return false;
      o.azione = ans;
    }
    S.origine = o.origine || null;
    if (typeof showView === 'function') showView('solo');
    if (info.stato !== 'nessuna' && (info.stato === 'attiva' || o.azione === 'consulta')) await openGame(storia);
    else await startSetup(storia);
    return true;
  }
  // voce di menu visibile solo con il flag attivo
  function showMenuEntry() {
    const item = document.getElementById('cm-item-solo');
    if (item && typeof rmFeatureEnabled === 'function' && rmFeatureEnabled('solo_player_v1')) item.classList.remove('hidden');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showMenuEntry); else showMenuEntry();

  global.RMSoloUI = { renderHub, openGame, premessaMondoHtml, comandiDaScheda, datiStoria, caricaStoria: contentFor, creazioneCompletata, slotInfo, playStory, nuovaPartita, storieInfo: STORIE_INFO, _state: () => S, ritrattoDi: defaultPortrait, aspettoGiocatore: v => { if (v === undefined) return ASPETTO_GIOCATORE; ASPETTO_GIOCATORE = !!v; if (S.view === 'gioco' && S.state) renderGame(); return ASPETTO_GIOCATORE; } };
})(typeof window !== 'undefined' ? window : globalThis);
