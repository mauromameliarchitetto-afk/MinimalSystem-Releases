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
    return RMSoloCampaign.localizza(base, Object.assign({ citta: arch ? arch.citta : null }, pg || {}));
  }
  function gameContent() { return contentDi(S.storia, S.state && S.state.personaggio); }
  async function contentFor(storia) {
    if (!S.content[storia]) {
      S.content[storia] = await loadJson('js/solo/content/' + storia + '-campagna.json');
      S.archetipi[storia] = await loadJson('js/solo/content/' + storia + '-archetipi.json');
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
    const slots = await RMSoloStore.list();
    const dev = devMode();
    const inst = dev ? await RMSoloModels.readInstalled().catch(() => null) : null;
    const st = RMSoloLLM.status();
    const cards = slots.map(sl => {
      const info = STORIE_INFO[sl.storia];
      const p = sl.partita;
      const stato = p ? ({ attivo: 'In corso', concluso: 'Capitolo concluso', morto: 'Personaggio morto', terminato: 'Partita terminata' }[p.stato] || p.stato) : 'Slot libero';
      return '<div class="solo-slot" data-storia="' + sl.storia + '">' +
        '<div class="solo-slot-head"><span class="solo-slot-title">' + esc(info.titolo) + '</span><span class="solo-chip">' + esc(stato) + '</span></div>' +
        (p ? '<div class="solo-slot-sub">' + esc(p.personaggio.nome) + ' · Lv ' + p.personaggio.livello + ' · ' + esc(p.difficolta) + '</div>' : (devMode() ? '<div class="solo-slot-sub">' + esc(info.nota) + '</div>' : '')) +
        '<div class="solo-slot-actions">' +
        (p ? '<button class="btn btn-primary btn-sm" data-act="riprendi">' + (p.stato === 'attivo' ? 'Continua l\'avventura' : 'Consulta') + '</button>' : '') +
        (info.disponibile ? '<button class="btn btn-ghost btn-sm" data-act="nuova">Nuova partita</button>' : '<button class="btn btn-ghost btn-sm" disabled>Non ancora disponibile</button>') +
        (p ? '<button class="btn btn-ghost btn-sm" data-act="esporta">Esporta</button>' : '') +
        '</div></div>';
    }).join('');
    render('<header class="solo-head"><button class="btn btn-ghost btn-sm" id="solo-back" aria-label="Torna indietro">←</button><h1>Gioca in solitaria</h1></header>' +
      '<p class="solo-note">I personaggi di questa sezione non possono essere usati nelle campagne di gruppo.</p>' +
      (dev ? modelPanel(inst, st) : '<div id="solo-narratore"></div>') +
      '<h2 class="solo-h2">Le tue partite (una per storia, massimo tre)</h2>' + cards);
    $v('#solo-back').addEventListener('click', () => { if (typeof goToMenuTarget === 'function') goToMenuTarget('home'); });
    if (dev) wireModelPanel(); else { renderNarratorLine(); prepareNarrator(); }
    root().querySelectorAll('.solo-slot').forEach(el => {
      const storia = el.dataset.storia;
      el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.act;
        if (a === 'riprendi') openGame(storia);
        if (a === 'nuova') startSetup(storia);
        if (a === 'esporta') exportSlot(storia);
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
  function devMode() { return typeof rmFeatureEnabled === 'function' && rmFeatureEnabled('solo_dev_v1'); }
  // proposte meccaniche usate come approvate: solo sviluppo o anteprima
  function anteprima() { return devMode() || (typeof rmFeatureEnabled === 'function' && rmFeatureEnabled('solo_anteprima_v1')); }
  const WIFI_KEY = 'rm_solo_attendi_wifi';
  function waitWifi(v) {
    try { if (v === undefined) return global.localStorage.getItem(WIFI_KEY) === '1'; if (v) global.localStorage.setItem(WIFI_KEY, '1'); else global.localStorage.removeItem(WIFI_KEY); } catch (e) { /* storage non disponibile */ }
    return false;
  }
  function gb(n) { return (n / 1e9).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' GB'; }

  let setupWired = false, consentAsked = false;
  function prepareNarrator(opts) {
    const NS = global.RMSoloNarratorSetup;
    if (!NS || !RMSoloModels.native() || devMode()) return;
    if (!setupWired) {
      setupWired = true;
      NS.watch(st => {
        renderNarratorLine();
        if (st.stato === 'pronto' && !RMSoloLLM.ready() && RMSoloLLM.status().stato !== 'caricamento') {
          RMSoloLLM.load().then(() => { renderNarratorLine(); if (S.view === 'gioco') { renderStatusLine(); narratePending(); } });
        }
        if (st.stato === 'attesa_consenso' && !waitWifi() && !consentAsked) askMobileData(st);
        if (S.view === 'gioco') renderStatusLine();
      });
      global.addEventListener('online', () => prepareNarrator());
      document.addEventListener('visibilitychange', () => { if (!document.hidden) prepareNarrator(); });
    }
    NS.ensure(opts);
  }

  async function askMobileData(st) {
    consentAsked = true;
    const ok = await modal('Preparare il Narratore?',
      '<p>Il Narratore funziona sul telefono, senza internet, ma la prima volta va scaricato: circa ' + gb(st.dimensione) + '. Ora sei su una rete a consumo.</p>',
      [{ label: 'Aspetta il Wi-Fi', value: false }, { label: 'Scarica ora', value: true, cls: 'btn-primary' }]);
    if (ok) prepareNarrator({ consentiDatiMobili: true });
    else { waitWifi(true); renderNarratorLine(); }
  }

  function renderNarratorLine() {
    const el = $v('#solo-narratore'); if (!el) return;
    const NS = global.RMSoloNarratorSetup;
    if (!NS || !RMSoloModels.native()) { el.innerHTML = ''; return; }
    const st = NS.state(), llm = RMSoloLLM.status();
    let html = '';
    if (st.stato === 'scaricamento') {
      const pct = st.totale ? Math.floor(st.fatto / st.totale * 100) : 0;
      html = '<p class="solo-note">Il Narratore si sta preparando: ' + pct + '%</p><div class="solo-progress"><div style="width:' + pct + '%"></div></div>';
    } else if (st.stato === 'pronto' && llm.stato !== 'pronto') html = '<p class="solo-note">Il Narratore si sta preparando…</p>';
    else if (st.stato === 'attesa_consenso' || st.stato === 'attesa_rete') {
      html = '<p class="solo-note">' + (st.stato === 'attesa_rete' ? 'Il Narratore verrà preparato appena il telefono sarà connesso a internet.' : 'Il Narratore verrà preparato alla prossima connessione Wi-Fi (' + gb(st.dimensione) + ').') + ' Intanto puoi già giocare.</p>' +
        (st.stato === 'attesa_consenso' ? '<button class="btn btn-ghost btn-sm" id="solo-narratore-ora">Scarica ora</button>' : '');
    } else if (st.stato === 'sospeso' || st.stato === 'errore') {
      html = '<p class="solo-note">La preparazione del Narratore si è interrotta: riprenderà da dove si è fermata. Intanto puoi già giocare.</p><button class="btn btn-ghost btn-sm" id="solo-narratore-riprova">Riprova</button>';
    }
    el.innerHTML = html;
    const ora = $v('#solo-narratore-ora');
    if (ora) ora.addEventListener('click', () => { waitWifi(false); prepareNarrator({ consentiDatiMobili: true }); });
    const rip = $v('#solo-narratore-riprova');
    if (rip) rip.addEventListener('click', () => prepareNarrator());
  }

  function toastSafe(msg) { if (typeof toast === 'function') toast(msg); }

  /* ---------------------------------------------------------- nuova */
  async function startSetup(storia) {
    await contentFor(storia);
    S.setup = { storia, difficolta: null, archetipo: null, vista: 'lista', confronto: [], tab: 'identita', ritratto: null };
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
    if (vista === 'scheda') {
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
      if (S.setup.vista !== 'lista') { S.setup.vista = 'lista'; renderSetup(); }
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
  }

  async function chooseCharacter() {
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
    const arch = S.archetipi[storia].archetipi.find(x => x.id === archetipo);
    const content = contentDi(storia, Object.assign({ archetipo: arch.id }, arch));
    const slot = await RMSoloStore.get(storia);
    const nuovo = RMSoloEngine.newGame({ content, archetipo: arch, difficolta, dice: RMSoloRules.makeDice(), now: Date.now(), id: 'solo-' + uuid(), anteprima: anteprima() });
    if (S.setup.ritratto) nuovo.personaggio.ritratto = S.setup.ritratto;
    if (slot && slot.partita) {
      const ok = await replaceFlow(slot.partita, contentDi(storia, slot.partita.personaggio));
      if (!ok) return;
      try { await RMSoloStore.replace(storia, slot.partita.id, nuovo); }
      catch (e) { toastSafe('Sostituzione annullata: ' + e.message); return renderHub(); }
    } else {
      await RMSoloStore.create(nuovo);
    }
    openGame(storia);
  }

  /* Specifica §2: Sì / No / Annulla, poi conferma della sovrascrittura. */
  async function replaceFlow(old, content) {
    const ans = await modal('Slot occupato', '<p>Vuoi esportare il personaggio attuale (' + esc(old.personaggio.nome) + ') prima di iniziare una nuova partita?</p>',
      [{ label: 'Annulla', value: 'annulla' }, { label: 'No', value: 'no' }, { label: 'Sì', value: 'si', cls: 'btn-primary' }]);
    if (ans === 'annulla' || ans == null) return false;
    if (ans === 'si') {
      const ok = await doExport(old, content);
      if (!ok) { toastSafe('Esportazione non completata: la partita attuale è stata conservata.'); return false; }
      return true;
    }
    const conf = await modal('Sovrascrivere il personaggio?', '<p>Una volta scelto No, il personaggio verrà sovrascritto e non sarà recuperabile. Vuoi proseguire?</p>',
      [{ label: 'No', value: false }, { label: 'Sì', value: true, cls: 'btn-primary' }]);
    return conf === true;
  }

  async function doExport(state, content) {
    let archive;
    try { archive = await RMSoloExport.buildArchive(state, content, { ritrattoPredefinito: defaultPortrait(state.storia, state.personaggio.archetipo) }); }
    catch (e) { await modal('Esportazione non riuscita', '<p>' + esc(e.message) + '</p>', [{ label: 'Chiudi', value: null }]); return false; }
    let r;
    try { r = await RMSoloExport.deliver(archive); }
    catch (e) { await modal('Salvataggio non riuscito', '<p>' + esc(e.message) + '</p>', [{ label: 'Chiudi', value: null }]); return false; }
    const note = archive.riepilogo.map(esc).join('<br>');
    if (r.confermato) { await modal('Esportazione salvata', '<p>' + note + '</p>', [{ label: 'Continua', value: true, cls: 'btn-primary' }]); return true; }
    return (await modal('Hai salvato il file?', '<p>Il browser non comunica se il download è riuscito. Conferma solo se trovi <b>' + esc(archive.nome) + '</b> tra i tuoi file.</p><p class="solo-small">' + note + '</p>',
      [{ label: 'No, non l\'ho salvato', value: false }, { label: 'Sì, è salvato', value: true, cls: 'btn-primary' }])) === true;
  }

  async function exportSlot(storia) {
    const slot = await RMSoloStore.get(storia);
    if (!slot || !slot.partita) return;
    await contentFor(storia);
    await doExport(slot.partita, contentDi(storia, slot.partita.personaggio));
  }

  /* ---------------------------------------------------------- partita */
  async function openGame(storia) {
    await contentFor(storia);
    const slot = await RMSoloStore.get(storia);
    if (!slot || !slot.partita) return renderHub();
    const content = contentDi(storia, slot.partita.personaggio);
    const arch = ((S.archetipi[storia] || {}).archetipi || []).find(a => a.id === slot.partita.personaggio.archetipo);
    S.storia = storia; S.state = RMSoloEngine.migrate(slot.partita, arch, content); S.view = 'gioco'; S.tab = 'gioco'; S.eventiVisti = 0;
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
    const c = ev.check;
    if (!c) return '';
    const d = c.tipo === 'tratto' ? 'd20 ' + c.d20 + ' + ' + esc(c.trait) + ' ' + c.traitValue + (c.mod ? (c.mod > 0 ? ' +' : ' ') + c.mod : '') + ' = ' + c.total + ' vs NC ' + c.nc
      : 'senza competenza: d100 ' + c.d100 + ' − 20' + (c.mod ? ' ' + (c.mod > 0 ? '+' : '') + c.mod * 5 : '') + ' = ' + c.total + ' vs 50';
    return '<div class="solo-roll">🎲 ' + d + ' → <b>' + esc(ev.esito || c.esito) + '</b></div>';
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
      if (a.tipo === 'magia_senza_gemme') return '⚠ magia senza gemme';
      if (a.tipo === 'ricercato') return '⚠ sei ricercato';
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

  /* Notifiche brevi e separate dalla narrazione: relazioni, voci, oggetti,
     scoperte, diario. Il livello ha un avviso a parte, dopo l'evento. */
  const NOTIFICA = ['gemma_scarica', 'gemma_reintegrata', 'relazione', 'voce', 'ricompensa', 'scoperta', 'loot_scoperto', 'nota', 'vantaggio', 'svantaggio', 'oggetto_perso', 'custode', 'atto', 'orologio_pieno', 'ricercato', 'magia_senza_gemme', 'sposta', 'incontro_inizia', 'filo'];
  function notifications(ev, content) {
    const items = (ev.effetti || []).filter(a => NOTIFICA.indexOf(a.tipo) !== -1).map(a => {
      if (a.tipo === 'relazione') return (a.delta > 0 ? '▲ ' : '▼ ') + esc(content.png[a.png].nome) + (a.delta > 0 ? ' si fida di più' : ' si fida di meno');
      return effectItems({ effetti: [a] }, content)[0];
    }).filter(Boolean);
    return items.length ? '<ul class="solo-notes">' + items.map(t => '<li>' + t + '</li>').join('') + '</ul>' : '';
  }
  function levelNotice(ev) {
    return (ev.effetti || []).filter(a => a.tipo === 'avanzamento').map(a =>
      '<div class="solo-levelup" role="status">⬆ Livello ' + a.livello + ' raggiunto <span>+' + (a.apGuadagnati != null ? a.apGuadagnati : a.ap) + ' AP</span></div>').join('');
  }
  const ESITI = { successo: 'Successo', parziale: 'Successo parziale', fallimento: 'Fallimento', critico: 'Successo critico', fallimento_critico: 'Fallimento critico' };
  function outcomeLine(ev) {
    if (!ev.check) return '';
    const e = ev.esito || ev.check.esito;
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
  function detailsPanel(ev, content, n) {
    // solo se c'è qualcosa di meccanico oltre alle notifiche già mostrate
    const mecc = [checkLine(ev), combatLine(ev)].filter(Boolean);
    if (!mecc.length && !devMode()) return '';
    const rows = mecc;
    if (devMode()) rows.push('<div class="solo-dev">' + narrBadge(n) + '</div>');
    return rows.length ? '<details class="solo-esito"><summary>Dettagli dei tiri</summary><div class="solo-esito-body">' + rows.join('') + '</div></details>' : '';
  }
  function paragraphs(t) { return String(t || '').split(/\n\s*\n/).map(p => '<p>' + esc(p.trim()) + '</p>').join(''); }

  function combatLine(ev) {
    if (!ev.combattimento) return '';
    return '<div class="solo-roll">' + ev.combattimento.azioni.map(a => {
      if (a.tipo !== 'attacco') return esc(a.capacita || a.tipo);
      const r = a.esito;
      return (a.chi === 'pg' ? 'Tu' : 'Nemico') + ' · ' + esc(a.capacita) + ': colpire ' + r.hitTotal + ', danno ' + r.damageRoll +
        (r.defense ? ' (' + (r.defense.type === 'dodge' ? 'schivata' : 'blocco') + ' ' + r.defense.total + (r.defense.success ? ' riuscita' : ' fallita') + ')' : '') +
        (r.save ? ', salvezza ' + r.save.total + (r.save.halved ? ' dimezza' : '') : '') + ' → ' + r.finalDamage;
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
    const sc = RMSoloEngine.currentScene(state, content);
    const over = RMSoloEngine.isOver(state);
    const log = state.eventi.map(ev => {
      const n = ev.narrazione || {};
      const bat = (n.battute || []).map(b => '<p class="solo-line"><span class="solo-speaker">' + esc(b.png) + '</span>' + esc(b.testo) + '</p>').join('');
      const parla = ev.tipo === 'dialogo' || ev.tipo === 'battuta' || ev.tipo === 'dialogo_fine';
      const player = ev.sceltaTesto || ev.testo;
      // ordine: azione, conseguenza, riepilogo tecnico, transizione; le
      // nuove azioni arrivano solo dopo (actionsPanel)
      const r = ev.resoconto;
      const dichiarata = r ? r.azioneDichiarata : player;
      const pronta = n.stato === 'pronta';
      return '<article class="solo-ev' + (parla ? ' solo-ev-dialogo' : '') + '" data-n="' + ev.n + '">' +
        (dichiarata ? '<p class="solo-player"><span>Tu</span>' + esc(dichiarata) + '</p>' : '') +
        outcomeLine(ev) +
        (parla && ev.pngNome ? '<p class="solo-speaker-head">' + esc(ev.pngNome) + '</p>' : '') +
        '<div class="solo-narr">' + (n.testo ? paragraphs(n.testo) + bat : '<p class="solo-muted">Il Narratore racconta…</p>') + '</div>' +
        (pronta ? techBlock(r) + detailsPanel(ev, content, n) : '') + '</article>' +
        (pronta ? notifications(ev, content) + transitionBlock(r) + levelNotice(ev) +
          (ev.effetti || []).filter(a => a.tipo === 'scena').map(a => sceneOpening(content, a.scena)).join('') : '');
    }).join('');
    const opening = sceneOpening(content, content.scene[0].id);
    const schede = ['gioco', 'diario', 'scheda'].concat(state.mappa && typeof RMSoloMappa !== 'undefined' ? ['mappa'] : []);
    const tabs = '<nav class="solo-tabs" role="tablist">' + schede.map(t => '<button role="tab" class="' + (S.tab === t ? 'active' : '') + '" data-tab="' + t + '">' + { gioco: 'Gioco', diario: 'Diario', scheda: 'Scheda', mappa: 'Mappa' }[t] + '</button>').join('') + '</nav>';
    let body = '';
    if (S.tab === 'gioco') {
      const ultimo = state.eventi[state.eventi.length - 1];
      const inAttesa = ultimo && ultimo.narrazione && ultimo.narrazione.stato !== 'pronta';
      body = '<div class="solo-log" id="solo-log" aria-live="polite">' + opening + log + '</div>' +
        (inAttesa ? '<section class="solo-actions" id="solo-actions"><p class="solo-muted">Le nuove azioni compariranno dopo il racconto della conseguenza.</p>' +
          (S.abort ? '<button class="' + ACT + '" id="solo-abort" data-keep-enabled="1">Interrompi la descrizione</button>' : '') + '</section>'
          : over ? endPanel(state, content) : actionsPanel(state, content, sc));
    } else if (S.tab === 'diario') body = diaryPanel(state, content);
    else if (S.tab === 'mappa' && state.mappa) body = mapPanel(state, content);
    else body = sheetPanel(state, content);
    render('<header class="solo-head"><button class="btn btn-ghost btn-sm" id="solo-back" aria-label="Torna alle partite">←</button><div class="solo-head-txt"><h1>' + esc(sc.titolo) + '</h1><div class="solo-sub">' + esc(sc.luogo) + '</div></div>' + phaseIndicator(state, content) + '</header>' +
      '<div class="solo-status" id="solo-status"></div>' + tabs + body);
    renderStatusLine();
    $v('#solo-back').addEventListener('click', renderHub);
    root().querySelectorAll('.solo-tabs button').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderGame(); }));
    wireActions();
    if (S.tab === 'scheda') wireSheet(t => { S.sheetTab = t; renderGame(); }, setGamePortrait);
    if (S.tab === 'mappa') wireMap();
    // pagina intera che scorre (nessun riquadro interno che taglia il
    // testo): a ogni nuovo evento si porta in vista il suo inizio
    const evs = root().querySelectorAll('#solo-log .solo-ev');
    if (S.tab === 'gioco' && evs.length && evs.length !== S.eventiVisti) {
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

  function actionsPanel(state, content, sc) {
    const dis = S.busy ? ' disabled' : '';
    const io = RMSoloEngine.interactionOptions(state, content);
    let html = '<section class="solo-actions" id="solo-actions">';
    if (state.incontro) {
      // combattimento: sezione normale del flusso, stato essenziale sempre
      // visibile, dettagli del round nel pannello Esito dell'evento
      const pg = state.personaggio, inc = state.incontro, ne = inc.nemico;
      const pct = (v, m) => Math.max(0, Math.min(100, Math.round(v / m * 100)));
      // scontro con più partecipanti: ogni avversario con il suo stato e il
      // bersaglio scelto evidenziato; si cambia bersaglio con un tocco
      const gruppo = inc.gruppo && inc.nemici;
      const bers = gruppo ? (S.bersaglio && inc.nemici.some(n => n.uid === S.bersaglio && n.attivo) ? S.bersaglio : inc.bersaglio) : null;
      const riga = n => '<div class="solo-unit' + (n.uid === bers ? ' solo-target' : '') + (n.attivo ? '' : ' solo-unit-out') + '">' +
        (n.attivo ? '<button class="' + ACT + ' solo-target-btn" data-bersaglio="' + esc(n.uid) + '" aria-pressed="' + (n.uid === bers) + '"' + dis + '>' + (n.uid === bers ? '◎ ' : '') + esc(n.nome) + '</button>' : '<span>' + esc(n.nome) + ' — ' + esc({ sconfitto: 'a terra', incapacitato: 'fuori combattimento', fuggito: 'fuggito', arreso: 'arreso' }[n.esito] || n.esito) + '</span>') +
        '<div class="bar-track"><div class="bar-fill physical" style="width:' + pct(n.hp, n.hpMax) + '%"></div></div><b>' + n.hp + '/' + n.hpMax + '</b>' +
        '<small>' + esc(n.posizione === 'distanza' ? 'a distanza' : 'in mischia') + (n.esposto >= inc.round ? ' · scoperto' : '') + (n.protettoDa ? ' · protetto' : '') + (n.guardia >= inc.round ? ' · in guardia' : '') + '</small></div>';
      html += '<div class="solo-combat"><div class="solo-combat-head">' + esc(gruppo && inc.nemici.length > 1 ? inc.nemici.length + ' avversari' : gruppo ? inc.nemici[0].nome : ne.nome) + ' <span>round ' + inc.round + '</span></div>' +
        (gruppo ? '<div class="solo-units" role="group" aria-label="Scegli il bersaglio">' + inc.nemici.map(riga).join('') + '</div>' : '') +
        '<div class="solo-combat-bars">' + (gruppo ? '' : '<div><span>' + esc(ne.nome.split(' ')[0]) + '</span><div class="bar-track"><div class="bar-fill physical" style="width:' + pct(ne.hp, ne.hpMax) + '%"></div></div><b>' + ne.hp + '/' + ne.hpMax + '</b></div>') +
        '<div><span>Tu</span><div class="bar-track"><div class="bar-fill physical" style="width:' + pct(pg.hpCur, pg.hpMaxTracked) + '%"></div></div><b>' + pg.hpCur + '/' + pg.hpMaxTracked + '</b></div></div></div>' +
        '<div class="solo-btns solo-grid">' +
        [['abilita', pg.abilita], ['tecnica', pg.tecniche], ['gemma', RMSoloEngine.capacityList(pg, 'gemma')]].map(([kind, list]) => list.map(a => {
          // capacità non utilizzabile (MP, gemma scarica, utilizzi): pulsante spento con il motivo
          const st = RMSoloEngine.capacityStatus(state, content, kind, a);
          const costo = st.costoMP ? ' <small>' + st.costoMP + ' MP</small>' : '';
          return '<button class="btn btn-primary btn-sm solo-act" data-combat="' + kind + '" data-id="' + esc(a.id) + '"' + (st.ok ? dis : ' disabled title="' + esc(st.motivo) + '"') + '>' + esc(a.nome) + costo + (st.ok ? '' : ' <small>— ' + esc(st.motivo) + '</small>') + '</button>' +
            (!st.ok && st.forzabile ? '<button class="' + ACT + '" data-combat="' + kind + '" data-forza="1" data-id="' + esc(a.id) + '"' + dis + '>Forza l\'armatura: ' + esc(a.nome) + ' <small>−' + st.costoHP + ' HP</small></button>' : '');
        }).join('')).join('') +
        // capacità delle gemme (fuori slot): disponibili finché la gemma associata è attiva
        (pg.capacitaSpeciali || []).filter(a => !a.fuoriSlot).map(a => { const st = RMSoloEngine.capacityStatus(state, content, 'speciale', a); return st.ok ? '<button class="' + ACT + '" data-combat="speciale" data-id="' + esc(a.id) + '"' + dis + '>' + esc(a.nome) + '</button>' : ''; }).join('') +
        ((pg.gemme || []).some(g => g.stato === 'attiva') && pg.mpCur < pg.mpMaxTracked ? '<button class="' + ACT + '" data-gemme="1"' + dis + '>Gemme…</button>' : '') +
        '<button class="' + ACT + '" data-combat="arma"' + dis + '>Attacco con l\'arma</button>' +
        // consumabili dello zaino: l'uso è l'azione del turno
        state.inventario.filter(i => i.qty > 0).map(i => RMSoloEngine.itemInfo(state, content, i.id)).filter(d => d && d.tipo === 'consumabile' && d.effetto && !d.effetto.cariche_gemma && (d.effetto.hp || d.effetto.effetti))
          .map(d => '<button class="' + ACT + '" data-combat-oggetto="' + esc(d.id) + '"' + dis + '>Usa: ' + esc(d.nome) + '</button>').join('') +
        (inc.negoziabile ? '<button class="' + ACT + '" data-combat="negozia"' + dis + '>Proponi la resa</button>' : '') +
        (ne.inevitabile ? '' : '<button class="' + ACT + '" data-combat="fuga"' + dis + '>Fuga</button>') + '</div>';
    } else if (io && io.sceltaIncontro) {
      // scontro annunciato: affrontarlo oppure tentare l'altra via
      html += '<p class="solo-pressure">⚔ ' + esc(io.sceltaIncontro.nemico) + ' ti sbarra la strada.</p><div class="solo-btns solo-grid">' +
        '<button class="btn btn-primary btn-sm solo-act" data-incontro="affronta"' + dis + '>Affronta ' + esc(io.sceltaIncontro.nemico) + '</button>' +
        '<button class="btn btn-primary btn-sm solo-act" data-incontro="alternativa"' + dis + '>' + esc(io.sceltaIncontro.alternativa) + '</button></div>';
    } else if (io && io.dialogo) {
      // dialogo a più battute: argomenti, domande libere e congedo
      html += '<div class="solo-dialog-head">In dialogo con <b>' + esc(io.dialogo.nome) + '</b></div>' +
        (io.aperta ? '<p class="solo-pressure solo-ready">La scena è pronta per una decisione: congedati quando vuoi.</p>' : '') + '<div class="solo-btns solo-grid">' +
        io.dialogo.argomenti.map(a => '<button class="' + ACT + '" data-argomento="' + esc(a.id) + '"' + dis + '>' + esc(a.testo) + '</button>').join('') +
        '<button class="btn btn-primary btn-sm solo-act" data-chiudi="1"' + dis + '>Congedati</button></div>';
    } else if (io && !io.aperta) {
      // prima della risoluzione: ciò che è percepibile nella scena
      html += (io.pressione ? '<p class="solo-pressure">⏳ ' + esc(io.pressione.nome) + '</p>' : '') +
        interactionButtons(io, dis) + restButtons(state, content, sc, dis);
    } else {
      // scene-seme: solo ciò che il personaggio può concepire e tentare ora
      // (l'input libero resta sempre disponibile)
      const P = io && io.modo === 'semi' && io.possibili;
      const sugg = (sc.suggerimenti || []).filter(s => !(state.obiettivi[s.obiettivo] && state.obiettivi[s.obiettivo].completato));
      html += '<div class="solo-btns solo-grid">' + sugg.map((s, i) => P && s.obiettivo && P.obiettivi.indexOf(s.obiettivo) === -1 ? '' : '<button class="btn btn-primary btn-sm solo-act" data-sugg="' + i + '"' + dis + '>' + esc(s.testo) + '</button>').join('') +
        (state.scelte[sc.id] ? [] : (sc.scelte || [])).filter(c => !P || P.scelte.indexOf(c.id) !== -1).map(c => RMSoloEngine.choiceAvailable(state, c)
          ? '<button class="btn btn-primary btn-sm solo-act" data-scelta="' + esc(c.id) + '"' + dis + '>' + esc(c.testo) + '</button>'
          : '<button class="' + ACT + '" disabled title="' + esc(c.motivo_non_disponibile || '') + '">' + esc(c.testo) + ' <small>' + esc(c.motivo_non_disponibile || 'non disponibile') + '</small></button>').join('') +
        '</div>' + (io ? interactionButtons(io, dis) : '') + restButtons(state, content, sc, dis);
    }
    if (!state.incontro && !(io && (io.dialogo || io.sceltaIncontro))) html += proceedButton(state, content, dis);
    html += structureDev(state, content);
    const parla = io && io.dialogo;
    html += '<form class="solo-free" id="solo-free"><label for="solo-input">' + (parla ? 'Oppure scrivi che cosa dici a ' + esc(io.dialogo.nome) : 'Oppure scrivi che cosa fai') + '</label><textarea id="solo-input" rows="2" maxlength="600" placeholder="' + (parla ? 'La tua battuta' : 'Descrivi che cosa fa il tuo personaggio') + '"' + dis + '></textarea>' +
      '<button class="btn btn-primary" type="submit"' + dis + '>Agisci</button></form>';
    const last = state.eventi[state.eventi.length - 1];
    // "Riscrivi la descrizione" rivela che il testo è generato: solo in sviluppo
    if (devMode() && last && last.narrazione && last.narrazione.stato === 'pronta' && !last.testoFisso) html += '<button class="' + ACT + ' solo-regen" id="solo-regen"' + dis + '>Riscrivi la descrizione</button>';
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
    const rec = state.esitoFinale;
    const fin = state.finale && RMSoloCampaign.variantDef(content, state.finale);
    const titolo = fin ? 'Campagna conclusa: ' + fin.titolo : state.motivoFine === 'raven' ? 'Raven' : state.stato === 'morto' ? 'Il personaggio è morto' : 'Partita terminata';
    const mods = rec && rec.modificatori ? rec.modificatori.map(m => RMSoloCampaign.variantDef(content, m)).filter(Boolean) : [];
    return '<section class="solo-panel solo-end"><h2 class="solo-h2">' + esc(titolo) + '</h2>' +
      (fin ? '<p>' + esc(fin.riserva) + '</p>' : '') +
      mods.map(m => '<p><b>' + esc(m.titolo) + '.</b> ' + esc(m.riserva) + '</p>').join('') +
      (fin && fin.conseguenza_personale ? '<p><i>' + esc(fin.conseguenza_personale) + '</i></p>' : '') +
      epilogueBonds(state, content) +
      (devMode() && fin && fin.content_status && fin.content_status !== 'approved' ? '<p class="solo-note">Epilogo proposto, da approvare.</p>' : '') +
      (devMode() && state.stato === 'morto' && state.ritorno === 'non_definito' ? '<p class="solo-note">Il ritorno dalla morte non è ancora definito per questi contenuti.</p>' : '') +
      '<p class="solo-note">La partita resta consultabile ed esportabile finché non la sostituisci con una nuova.</p>' +
      '<button class="btn btn-ghost" id="solo-export-end">Esporta il personaggio</button></section>';
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
    return '<section class="solo-panel solo-diary"><h2 class="solo-h2">Atto ' + ['', 'I', 'II', 'III'][state.atto] + (atto.titolo ? ' — ' + esc(atto.titolo) : '') + '</h2>' + body + err + '</section>';
  }

  /* Scheda con la grafica di "I miei personaggi" (js/solo/solo-sheet.js) */
  /* Mappa della storia: solo luoghi conosciuti e informazioni pubbliche
     (RMSoloMappa.vista). Se la storia ha un'immagine con coordinate si
     riusa il disegno della mappa di gruppo (Leaflet CRS.Simple e pin dei
     luoghi di story_map_2d_v1); altrimenti l'elenco dei luoghi noti. Una
     destinazione è una richiesta: il motore calcola l'itinerario. */
  const CONOSCENZA_LABEL = { sentito_dire: 'ne hai sentito parlare', approssimativo: 'sai più o meno dove si trova', localizzato: 'sai dove si trova', visitato: 'ci sei stato', modificato: 'ci sei stato: è cambiato', inaccessibile: 'non più raggiungibile' };
  const ROTTA_LABEL = { terrestre: 'via di terra', marittimo: 'per mare', costiero: 'lungo la costa', interno_insediamento: 'dentro l\'insediamento', sotterraneo: 'sotto terra', collegamento_protetto: 'collegamento protetto', esterno_protetto: 'all\'esterno, con protezione sigillata', speciale: 'rotta speciale', da_classificare: 'percorso' };
  const ICONA_LUOGO = { citta: 'insediamento', citta_cupola: 'insediamento', insediamento: 'insediamento', area_pericolosa: 'pericolo', area_inabitabile: 'pericolo', acque: 'natura', territorio: 'natura', regione: 'natura', continente: 'natura' };
  function durataTesto(d) { return d && Number.isFinite(d.valore) ? d.valore + ' ' + (d.unita === 'ore' ? 'ore' : 'giorni') : 'non indicata'; }
  function mapPanel(state, content) {
    const v = RMSoloMappa.vista(state, content);
    const nome = id => (v.luoghi.find(l => l.id === id) || {}).nome || '';
    const sel = S.mapSel && v.luoghi.find(l => l.id === S.mapSel) ? S.mapSel : null;
    const piano = sel ? RMSoloMappa.pianifica(state, content, sel) : S.mapTesto ? RMSoloMappa.pianifica(state, content, S.mapTesto) : null;
    const viaggio = state.mappa.viaggio;
    const lista = v.luoghi.map(l => '<li><button type="button" class="solo-map-place' + (l.id === sel ? ' sel' : '') + (l.id === v.posizione ? ' qui' : '') + '" data-luogo="' + esc(l.id) + '"><b>' + esc(l.nome) + '</b><small>' + esc(l.id === v.posizione ? 'sei qui' : CONOSCENZA_LABEL[l.conoscenza] || '') + '</small></button></li>').join('');
    const scheda = sel ? (() => {
      const l = v.luoghi.find(x => x.id === sel);
      return '<section class="solo-map-info" aria-label="Luogo selezionato"><h3>' + esc(l.nome) + '</h3>' + (l.regione ? '<p class="solo-muted">' + esc(l.regione) + '</p>' : '') +
        (l.descrizione ? '<p>' + esc(l.descrizione) + '</p>' : '') + (l.trasformazioni.length ? '<p>' + esc(l.trasformazioni.join(' ')) + '</p>' : '') +
        (l.requisiti.length ? '<p><b>Serve:</b> ' + esc(l.requisiti.join(', ')) + '</p>' : '') + '</section>';
    })() : '';
    const itin = piano ? (piano.tratte && piano.tratte.length ? '<section class="solo-map-route" aria-label="Itinerario"><h3>Itinerario</h3><ol>' + piano.tratte.map(t => '<li>' + esc(nome(t.da) || 'qui') + ' → ' + esc(nome(t.a)) + ' · ' + esc(ROTTA_LABEL[t.tipo] || 'percorso') + '</li>').join('') + '</ol>' +
        '<p><b>Durata:</b> ' + esc(durataTesto(piano.durata)) + '</p>' + (piano.compagni && piano.compagni.length ? '<p><b>Con te:</b> ' + esc(piano.compagni.map(id => (content.png[id] || {}).nome).join(', ')) + '</p>' : '') + '</section>' : '') +
      (piano.ok ? '<div class="solo-map-actions"><button type="button" class="btn btn-primary btn-sm solo-act" data-viaggio="' + esc(piano.destinazione) + '">Chiedi al Narratore di raggiungerlo</button><button type="button" class="' + ACT + '" data-map-annulla="1">Annulla</button></div>'
        : '<p class="solo-warn">' + esc(piano.motivo || 'Non puoi andarci adesso.') + '</p><button type="button" class="' + ACT + '" data-map-annulla="1">Annulla</button>') : '';
    // la mappa originale è sempre visibile; i segnaposto sono solo i luoghi che conosci
    const proporzioni = v.dimensioni ? ' style="aspect-ratio:' + v.dimensioni.larghezza + ' / ' + v.dimensioni.altezza + '"' : '';
    const canvas = v.disponibile ? '<div id="solo-map-canvas" class="solo-map-canvas" role="img" aria-label="Mappa della storia con i luoghi che conosci"' + proporzioni + '></div>' +
        '<p class="solo-muted solo-map-legend">Tocca un segnaposto per vederne la scheda. I segnaposto sbiaditi indicano una posizione approssimata.</p>'
      : '<p class="solo-muted">La mappa illustrata di questa storia non è ancora disponibile: qui trovi i luoghi che conosci.</p>';
    return '<section class="solo-map" aria-label="Mappa">' + canvas +
      '<p class="solo-map-pos"><b>Posizione:</b> ' + esc(v.posizione ? nome(v.posizione) : 'da determinare') + '</p>' +
      (viaggio ? '<div class="solo-map-actions"><p>In viaggio verso ' + esc(nome(viaggio.destinazione)) + '.</p><button type="button" class="btn btn-primary btn-sm solo-act" data-viaggio-prosegui="1">Prosegui il viaggio</button></div>' : '') +
      scheda + itin +
      '<details class="solo-map-elenco"' + (v.disponibile ? '' : ' open') + '><summary>Luoghi che conosci (' + v.luoghi.length + ')</summary><ul class="solo-map-list">' + lista + '</ul></details>' +
      (viaggio ? '' : '<form class="solo-map-free" id="solo-map-free"><label for="solo-map-dest">Dove vuoi andare?</label><div><input id="solo-map-dest" type="text" autocomplete="off" maxlength="120" value="' + esc(S.mapTesto || '') + '"><button type="submit" class="' + ACT + '">Proponi</button></div></form>') +
      '</section>';
  }
  function wireMap() {
    root().querySelectorAll('[data-luogo]').forEach(b => b.addEventListener('click', () => { S.mapSel = b.dataset.luogo; S.mapTesto = null; renderGame(); }));
    root().querySelectorAll('[data-map-annulla]').forEach(b => b.addEventListener('click', () => { S.mapSel = null; S.mapTesto = null; renderGame(); }));
    root().querySelectorAll('[data-viaggio]').forEach(b => b.addEventListener('click', async () => { const d = b.dataset.viaggio; S.mapSel = null; S.mapTesto = null; S.tab = 'gioco'; await submit({ tipo: 'viaggio', sorgente: 'mappa', destinazione: d }); }));
    root().querySelectorAll('[data-viaggio-prosegui]').forEach(b => b.addEventListener('click', async () => { S.tab = 'gioco'; await submit({ tipo: 'viaggio_prosegui', sorgente: 'mappa' }); }));
    const f = $v('#solo-map-free');
    if (f) f.addEventListener('submit', e => { e.preventDefault(); const t = ($v('#solo-map-dest').value || '').trim(); S.mapSel = null; S.mapTesto = t || null; renderGame(); });
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

  function sheetPanel(state, content) {
    const inventario = (state.inventario || []).map(i => { const d = RMSoloEngine.itemInfo(state, content, i.id); return { nome: d ? d.nome : i.id, qty: i.qty }; });
    return RMSoloSheet.render(state.personaggio, { tab: S.sheetTab, editabile: true, inventario, ritrattoPredefinito: defaultPortrait(state.storia, state.personaggio.archetipo),
      gemInfo: id => S.busy ? Object.assign(RMSoloEngine.gemInfo(state, content, id), { scaricabile: false }) : RMSoloEngine.gemInfo(state, content, id),
      statoCapacita: (kind, t) => RMSoloEngine.capacityStatus(state, content, kind, t),
      dev: devMode(), anteprima: !!state.anteprima });
  }

  /* ------------------------------------------------------ ritratti */
  function defaultPortrait(storia, archId) {
    const a = ((S.archetipi[storia] || {}).archetipi || []).find(x => x.id === archId);
    return (a && a.ritratto) || '';
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
    root().querySelectorAll('[data-sugg]').forEach(b => b.addEventListener('click', () => {
      const s = (sc.suggerimenti || []).filter(x => !(S.state.obiettivi[x.obiettivo] && S.state.obiettivi[x.obiettivo].completato))[+b.dataset.sugg];
      const it = s.oggetto && RMSoloEngine.itemDef(content, s.oggetto);
      submit({ tipo: 'azione', sorgente: 'pulsante', testo: s.testo, proposta: { tipo: 'azione', obiettivo: s.obiettivo, tratto: s.tratto, oggetto: it && RMSoloEngine.hasItem(S.state, s.oggetto) ? it.nome : 'nessuno', qualita: 'normale' } });
    }));
    root().querySelectorAll('[data-scelta]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'scelta', sceltaId: b.dataset.scelta })));
    root().querySelectorAll('[data-incontro]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'incontro', scelta: b.dataset.incontro })));
    root().querySelectorAll('[data-esplora]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'esplora', punto: b.dataset.esplora, sorgente: 'pulsante' })));
    root().querySelectorAll('[data-dialogo]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'dialogo_inizia', png: b.dataset.dialogo, sorgente: 'pulsante' })));
    root().querySelectorAll('[data-argomento]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'battuta', argomento: b.dataset.argomento, sorgente: 'pulsante' })));
    const chiudi = root().querySelector('[data-chiudi]'); if (chiudi) chiudi.addEventListener('click', () => submit({ tipo: 'dialogo_chiudi', sorgente: 'pulsante' }));
    const avanti = root().querySelector('[data-prosegui]'); if (avanti) avanti.addEventListener('click', () => submit({ tipo: 'prosegui', sorgente: 'pulsante' }));
    root().querySelectorAll('[data-bersaglio]').forEach(b => b.addEventListener('click', () => { S.bersaglio = b.dataset.bersaglio; renderGame(); }));
    root().querySelectorAll('[data-combat]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'combattimento', azione: b.dataset.combat, abilitaId: b.dataset.id, forza: b.dataset.forza === '1' || undefined, bersaglio: S.state.incontro && S.state.incontro.gruppo ? (S.bersaglio && S.state.incontro.nemici.some(n => n.uid === S.bersaglio && n.attivo) ? S.bersaglio : S.state.incontro.bersaglio) : undefined })));
    const gm = root().querySelector('[data-gemme]'); if (gm) gm.addEventListener('click', () => { S.tab = 'scheda'; S.sheetTab = 'capacita'; renderGame(); const el = root().querySelector('.solo-gem'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); });
    const rest = root().querySelector('[data-riposo]'); if (rest) rest.addEventListener('click', () => submit({ tipo: 'riposo' }));
    const rech = root().querySelector('[data-ricarica]'); if (rech) rech.addEventListener('click', reintegrateGem);
    root().querySelectorAll('[data-raccogli]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'raccogli', istanza: b.dataset.raccogli })));
    root().querySelectorAll('[data-usa]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'usa', oggetto: b.dataset.usa })));
    root().querySelectorAll('[data-combat-oggetto]').forEach(b => b.addEventListener('click', () => submit({ tipo: 'combattimento', azione: 'oggetto', oggetto: b.dataset.combatOggetto, bersaglio: S.state.incontro && S.state.incontro.gruppo ? S.state.incontro.bersaglio : undefined })));
    // tastiera aperta: il campo di testo resta visibile sopra la tastiera
    const inp = $v('#solo-input');
    if (inp) inp.addEventListener('focus', () => setTimeout(() => { if (inp.scrollIntoView) inp.scrollIntoView({ block: 'center' }); }, 300));
    const form = $v('#solo-free');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); const t = $v('#solo-input').value.trim(); if (t) submitText(t); });
    const regen = $v('#solo-regen'); if (regen) regen.addEventListener('click', regenerateLast);
    const ab = $v('#solo-abort'); if (ab) ab.addEventListener('click', () => { if (S.abort) S.abort.abort(); });
    const ex = $v('#solo-export-end'); if (ex) ex.addEventListener('click', () => exportSlot(S.storia));
  }

  function setBusy(b) {
    S.busy = b;
    root().querySelectorAll('#solo-actions button:not([data-keep-enabled]), #solo-actions textarea').forEach(el => { el.disabled = b; });
  }

  async function submitText(text) {
    if (S.busy) return;
    setBusy(true);
    const content = gameContent();
    try {
      if (S.state.incontro) {
        // in combattimento il testo libero viene ricondotto alle azioni
        // della scheda: qui si accettano solo richieste esplicite
        const t = text.toLowerCase();
        const pg = S.state.personaggio;
        const caps = [['abilita', pg.abilita], ['tecnica', pg.tecniche], ['gemma', RMSoloEngine.capacityList(pg, 'gemma')]]
          .flatMap(([kind, list]) => list.filter(a => t.includes(a.nome.toLowerCase())).map(a => ({ kind, ab: a })));
        if (caps.length > 1 || /^\s*(non\b|rifiuto\b)/i.test(text)) { toastSafe('Indica una sola azione che vuoi compiere.'); return; }
        const ab = caps.length === 1 ? caps[0].ab : null;
        const azione = /fugg|scapp|ritir/.test(t) ? 'fuga' : ab ? caps[0].kind : /arma|colpisc|attacc/.test(t) ? 'arma' : null;
        if (!azione) { toastSafe('In combattimento indica una capacità della scheda, l\'arma o la fuga.'); return; }
        const inc = S.state.incontro;
        await apply({ tipo: 'combattimento', sorgente: 'testo', testo: text, azione, abilitaId: ab && ab.id, bersaglio: inc.gruppo ? ((S.bersaglio && inc.nemici.some(n => n.uid === S.bersaglio && n.attivo)) ? S.bersaglio : inc.bersaglio) : undefined });
        return;
      }
      // dialogo in corso: il testo è una battuta rivolta al PNG
      const io = RMSoloEngine.interactionOptions(S.state, content);
      if (io && io.dialogo) { await apply({ tipo: 'battuta', sorgente: 'testo', testo: text }); return; }
      // interprete strutturato (js/solo/solo-director.js): intento,
      // bersaglio, metodo, rischio, pertinenza. Un testo rivolto a un PNG
      // presente con cui si può parlare apre il dialogo e diventa la prima
      // battuta; il resto prosegue come prima, con l'intento allegato.
      const intento = global.RMSoloDirector ? RMSoloDirector.interpret(text, S.state, content) : null;
      const conPng = intento && intento.targetType === 'png' && io && (io.dialoghi || []).find(d => d.png === intento.targetId);
      if (conPng && intento.intentType === 'parlare') {
        await apply({ tipo: 'dialogo_inizia', png: conPng.png, sorgente: 'testo', intento });
        await apply({ tipo: 'battuta', sorgente: 'testo', testo: text, intento });
        return;
      }
      // scene-seme: il Regista improvvisa. Percorso narrativo = una chiamata
      // (proposta con testo, validata dal motore); percorso meccanico = due
      // (proposta, poi racconto dell'esito del motore); senza modello la
      // proposta deterministica e i testi di riserva
      if (global.RMSoloImprov && RMSoloImprov.modoSemi(content)) {
        const t0 = Date.now();
        const fields = { tipo: 'improvvisa', sorgente: 'testo', testo: text, intento };
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
      // prima dello svolgimento il testo libero è esplorazione: niente prova
      if (io && !io.aperta) { await apply({ tipo: 'esplora', libera: true, sorgente: 'testo', testo: text, intento }); return; }
      const gameId = S.state.id, version = S.state.version;
      const r = await RMSoloNarrator.interpret(RMSoloLLM, S.state, content, text);
      if (!S.state || S.state.id !== gameId || S.state.version !== version) return; // risposta tardiva: scartata
      await apply({ tipo: 'azione', sorgente: 'testo', testo: text, proposta: r.proposta, intento, interprete: { fonte: r.fonte, ms: r.ms, errore: r.errore || null } });
    } finally { setBusy(false); if (S.view === 'gioco') renderGame(); }
  }

  async function submit(fields) {
    if (S.busy) return;
    setBusy(true);
    try { await apply(fields); } finally { setBusy(false); if (S.view === 'gioco') renderGame(); }
  }

  async function apply(fields) {
    const content = gameContent();
    const cmd = Object.assign({ id: uuid(), expectedVersion: S.state.version }, fields);
    let res;
    try { res = RMSoloEngine.applyCommand(S.state, cmd, { content, dice: RMSoloRules.makeDice(), now: Date.now(), voce: S.voce[S.storia] || null }); }
    catch (e) { toastSafe(e.message); return; }
    // percorso del turno (misure future sul dispositivo): strutturato,
    // narrativo, meccanico o deterministico
    res.event.interprete = fields.interprete || { percorso: 'strutturato' };
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

  async function narrateEvent(n) {
    const content = gameContent();
    const ev = S.state.eventi[n - 1];
    if (!ev || (ev.narrazione && ev.narrazione.stato === 'pronta')) return;
    const gameId = S.state.id;
    S.abort = RMSoloLLM.ready() ? new AbortController() : null;
    if (S.abort && S.view === 'gioco') renderGame();
    let nar;
    try { nar = await RMSoloNarrator.narrate(RMSoloLLM, S.state, content, ev, { signal: S.abort && S.abort.signal, voce: S.voce[S.storia] }); }
    finally { S.abort = null; }
    // Risposta tardiva: se nel frattempo si è cambiata partita o schermata,
    // il testo non tocca il nuovo personaggio (resterà "da generare").
    if (!S.state || S.state.id !== gameId) return;
    const next = RMSoloEngine.attachNarration(S.state, content, n, nar, S.voce[S.storia]);
    try { await RMSoloStore.save(next); if (S.state && S.state.id === gameId) S.state = next; } catch (e) { /* resta "da generare": si riprova alla ripresa */ }
    if (S.view === 'gioco') renderGame();
  }

  async function narratePending() {
    if (!S.state) return;
    for (const ev of S.state.eventi) if (ev.narrazione && ev.narrazione.stato === 'da_generare') await narrateEvent(ev.n);
  }

  async function regenerateLast() {
    if (S.busy) return;
    setBusy(true);
    try {
      const content = gameContent();
      const ev = S.state.eventi[S.state.eventi.length - 1];
      S.abort = RMSoloLLM.ready() ? new AbortController() : null;
      renderGame(); setBusy(true);
      const gameId = S.state.id;
      const nar = await RMSoloNarrator.narrate(RMSoloLLM, S.state, content, ev, { signal: S.abort && S.abort.signal, voce: S.voce[S.storia] });
      if (!S.state || S.state.id !== gameId) return;
      const next = RMSoloEngine.attachNarration(S.state, content, ev.n, nar, S.voce[S.storia]);
      await RMSoloStore.save(next); S.state = next;
    } finally { S.abort = null; setBusy(false); renderGame(); }
  }

  global.openSoloHub = function () {
    if (!soloEnabled()) return;
    S.origine = null;
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
  async function playStory(storia, opts) {
    const o = opts || {};
    const info = await slotInfo(storia);
    if (!info.disponibile) { toastSafe('Gioca in solitaria: non ancora disponibile per questa storia.'); return false; }
    if (info.stato === 'conclusa' && o.azione !== 'consulta' && !info.nuova) { toastSafe('Una nuova partita in questa storia non è ancora disponibile.'); return false; }
    if (info.stato === 'conclusa' && o.azione !== 'consulta') {
      const ans = await modal('Sostituire la partita conclusa?',
        '<p>La partita di ' + esc(info.personaggio) + ' in questa storia è conclusa ed è ancora consultabile. Iniziando una nuova partita verrà sostituita: prima della sostituzione potrai comunque esportarla.</p>',
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

  global.RMSoloUI = { renderHub, openGame, slotInfo, playStory, _state: () => S };
})(typeof window !== 'undefined' ? window : globalThis);
