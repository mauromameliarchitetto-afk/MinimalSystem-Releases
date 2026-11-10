/* ==========================================================================
   Role Makers — Gioca in solitaria: l'orchestratore del turno (motore V2).

   Decide che cosa fare di una frase scritta dal giocatore: quale comando
   inviare al motore delle regole. È lo stesso instradamento della UI
   (js/solo/solo-ui.js, submitText), in un solo posto usato dalla UI e
   dall'harness, così ciò che si misura è ciò che si gioca.

   Con l'interruttore «interprete» (state.opzioni.motore2.interprete) prima di
   instradare si controlla l'ambiguità (RMSoloInterprete): se l'intenzione non
   è chiara si ritorna una DOMANDA con scelte concrete, che non costa tempo di
   gioco. Le chiamate al modello (regia/interprete IA) restano alla UI: qui
   si decide solo la via e il comando di base.

   Ritorna { via, cmds, chiarimento? }, con via in: 'avanza' ·
     'dialogo' · 'oracolo' · 'png' · 'improvvisa' · 'esplora' · 'interprete' · 'chiarimento'
   ========================================================================== */
(function (global) {
  'use strict';

  const E = () => global.RMSoloEngine;
  const M = () => global.RMSoloMondo;

  /* La parola con cui il giocatore chiama un PNG: la prima del nome che non è un articolo o un possessivo
     («Lo spettro» → spettro, «Tuo padre» → padre, «Barn Hesse» → Barn). */
  const NON_NOME = /^(il|lo|la|i|gli|le|l|un|uno|una|tuo|tua|tuoi|tue|mio|mia|suo|sua)$/i;
  function nomeDiRichiamo(nome) {
    return String(nome || '').split(/[\s']+/).map(w => w.replace(/[^A-Za-zÀ-ÿ]/g, '')).find(w => w && !NON_NOME.test(w)) || '';
  }

  /* A quale PNG con cui si può parlare è rivolta la frase: nome come vocativo o in una domanda, «signore/capitano» (il grado più alto presente),
     oppure una domanda in seconda persona o al gruppo (il primo presente). */
  function pngRivolto(content, io, testo, soloNome, state) {
    const lista = io.dialoghi || [];
    if (!lista.length) return null;
    const t = String(testo || '');
    const dom = /\?/.test(t);
    let migliore = null;
    lista.forEach(d => {
      const nome = nomeDiRichiamo(d.nome);
      if (!nome) return;
      // come la scena lo chiama («l'ombra» per lo spettro): vale dopo un verbo di rivolgersi o come vocativo, non come menzione in una domanda
      const alias = state && global.RMSoloAzioni ? global.RMSoloAzioni.aliasPng(state, content, d.png) : [];
      [nome].concat(alias).forEach((n, k) => {
        // «parlo con X», «chiedo a X…», «parlo allo spettro», «dico piano all'ombra»: il nome dopo un verbo di rivolgersi a qualcuno
        const verbo = new RegExp('\\b(?:parl|chied|dic|rispond|rivolg|ascolt|domand|interrog|sussurr|mormor)\\w*\\s+(?:(?:piano|sottovoce|a bassa voce|ad alta voce|a voce alta|forte)\\s+)?(?:con |a |ad |da |di |al |allo |alla |all\'|col )?' + n + '\\b', 'i').exec(t);
        if (verbo && (!migliore || verbo.index < migliore.i)) { migliore = { png: d.png, i: verbo.index }; return; }
        const m = new RegExp('(^|[.!?,;:]\\s*)' + n + '\\b', 'i').exec(t) || (dom && !k ? new RegExp('\\b' + n + '\\b', 'i').exec(t) : null);
        if (m && (!migliore || m.index < migliore.i)) migliore = { png: d.png, i: m.index };
      });
    });
    if (migliore) return migliore.png;
    if (soloNome) return null;
    if (/^\s*(signore|capitano|sergente|signora)\b/i.test(t)) {
      const grado = lista.find(d => /capitan|general|tenent/i.test(((content.png || {})[d.png] || {}).ruolo || ''));
      if (grado) return grado.png;
    }
    if (dom && /\b(voi|tu|te|ti|vi|sentite|ditemi|dimmi|ascoltate|ascolta)\b/i.test(t)) return lista[0].png;
    return null;
  }

  /* Un PNG della storia che non è in scena, chiamato per nome proprio o per parentela («Padre, …», «chiedo a mia madre», «dice mia madre»):
     { id, etichetta } o null. Solo vocativo o verbo di rivolgersi/ascoltare, mai una menzione («se Occhio vispo è morto»); se il messaggio
     nomina anche un presente, vale il presente. Nomi comuni («La donna fiore») no: possono indicare chi c'è.
     distanza: il giocatore prova a farsi sentire da lontano («Grido: Padre!», «chiamo mia madre a gran voce», «Ligo, ci sei?»). */
  const RICHIAMO = 'grid|url|strill|chiam|richiam|sbracci';
  function pngAssenteRivolto(state, content, testo) {
    const presenti = E().presentiEffettivi(state, content, state.scena);
    const t = String(testo || '');
    const nomiPresenti = presenti.map(id => nomeDiRichiamo((content.png[id] || {}).nome)).filter(Boolean);
    if (nomiPresenti.some(n => new RegExp('\\b' + n + '\\b', 'i').test(t))) return null;
    const poss = '(?:(?:mio|mia|tuo|tua|nostro|nostra)\\s+)?';
    let trovato = null;
    Object.keys(content.png || {}).forEach(id => {
      if (trovato || presenti.indexOf(id) !== -1) return;
      const p = content.png[id];
      const par = /^(tuo|tua)\s+([a-zà-ÿ]+)/i.exec(String(p.nome || '')) || /^(tuo|tua)\s+([a-zà-ÿ]+)/i.exec(String(p.ruolo || ''));
      const proprio = nomeDiRichiamo(p.nome);
      [/^[A-ZÀ-Ý]/.test(proprio) && proprio.length >= 3 ? proprio : null, par ? par[2] : null].filter(Boolean).forEach(nome => {
        if (trovato || nomiPresenti.indexOf(nome) !== -1) return;
        const re = new RegExp('(^|[.!?,;:«"“]\\s*)' + nome + '\\b|\\b(?:parl|chied|dic|rispond|rivolg|ascolt|domand|interrog|' + RICHIAMO + ')\\w*\\s+(?:a gran voce |ad alta voce |forte )?(?:con |a |ad |da |di |al |allo |alla |all\'|col |verso )?' + poss + nome + '\\b', 'i');
        if (re.test(t)) trovato = { id, distanza: new RegExp('\\b(?:' + RICHIAMO + ')\\w*|\\b(?:a gran voce|ad alta voce|ci sei|dove sei|mi senti)\\b', 'i').test(t), etichetta:par && nome === par[2] ? par[1].charAt(0).toUpperCase() + par[1].slice(1).toLowerCase() + ' ' + nome.toLowerCase() : String(p.nome).replace(/\s*\([^)]*\)/g, '') };
      });
    });
    return trovato;
  }

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ALIAS = (state, content, id) => (global.RMSoloAzioni && global.RMSoloAzioni.aliasPng ? global.RMSoloAzioni.aliasPng(state, content, id) : []);

  /* Una frase detta a qualcuno anche senza nome: tutta fra virgolette, un saluto o un «scusate» in apertura, oppure una domanda
     in seconda persona («Mi avete cercata…?», «state raccontando…?»). «C'è qualcuno?» no: è una domanda sul luogo. */
  const SALUTO = /^\s*(?:salve|buongiorno|buonasera|buondì|ehi|ehilà|scusate|scusi|scusa|perdonate|perdoni|perdona|signore|signora|messere)\b/i;
  const SECONDA = /\b(?:voi|vi|vostr[oaie]|tu|ti|te|tuo|tua|tuoi|tue|avete|sapete|siete|volete|potete|state|dite|fate|conoscete|cercate|cercavate|hai|sai|sei|vuoi|puoi|stai|conosci|cerchi|cercavi)\b/i;
  function parlato(testo) {
    const t = String(testo || '');
    return /^\s*[«"“][^»"”]+[»"”][\s.!?…]*$/.test(t) || SALUTO.test(t) || (/\?/.test(t) && SECONDA.test(t));
  }

  /* Il PNG (fra `ids`) che ha appena avuto a che fare con il protagonista: l'ultimo con cui ha parlato o agito in questa scena (anche il
     dialogo appena chiuso), oppure l'unico nominato dal testo d'autore dell'ultimo punto o scelta («Il burattinaio ti viene incontro…»).
     Si guardano gli ultimi eventi della scena, nessuna sequenza prefissata; con più nomi nello stesso testo non c'è un interlocutore evidente. */
  function ultimoCoinvolto(state, content, ids) {
    if (!ids.length) return null;
    const nomi = id => [norm(nomeDiRichiamo((content.png[id] || {}).nome))].concat(ALIAS(state, content, id)).filter(n => n.length >= 2);
    const evs = (state.eventi || []).filter(e => e && e.scena === state.scena).slice(-4).reverse();
    for (const e of evs) {
      if (e.png) return ids.indexOf(e.png) !== -1 ? e.png : null;
      if (e.tipo !== 'esplorazione' && e.tipo !== 'scelta') continue;
      const t = norm(e.riserva || '');
      const chi = ids.filter(id => nomi(id).some(n => new RegExp('\\b' + n + '\\b').test(t)));
      if (chi.length) return chi.length === 1 ? chi[0] : null;
    }
    return ids.length === 1 ? ids[0] : null;
  }
  // con chi si può parlare adesso, fra i presenti
  const parlabili = (state, content, io) => { const pr = E().presentiEffettivi(state, content, state.scena); return ((io && io.dialoghi) || []).map(d => d.png).filter(id => pr.indexOf(id) !== -1); };
  const interlocutoreEvidente = (state, content, io) => ultimoCoinvolto(state, content, parlabili(state, content, io));

  /* Un presente nominato per nome o come la scena lo chiama («l'ombra»), non con un possessivo davanti («la mia ombra»). */
  function pngNominato(state, content, testo, ids) {
    const t = norm(testo);
    const trovati = ids.map(id => {
      const ms = [norm(nomeDiRichiamo((content.png[id] || {}).nome))].concat(ALIAS(state, content, id)).filter(n => n.length >= 2)
        .map(n => new RegExp('(?<!\\b(?:mia|mio|tua|tuo|sua|suo) )\\b' + n + '\\b').exec(t)).filter(Boolean);
      return ms.length ? { id, i: Math.min.apply(null, ms.map(m => m.index)) } : null;
    }).filter(Boolean).sort((a, b) => a.i - b.i);
    return trovati.length ? trovati[0].id : null;
  }

  /* Domanda su come appare ciò che si ha davanti (aspetto, forma, volto, colore, se è un uomo o una donna): regola dell'autore del 6/11,
     si risponde con una descrizione di ciò che è visibile, senza tiro; un tiro solo per dettagli nascosti con una difficoltà concreta. */
  // l'aspetto di qualcuno (senza nome vale chi ha appena avuto a che fare con il protagonista) / ciò che si vede in generale
  const DI_PERSONA = /\b(?:che aspetto|com'e fatt|come e fatt|che forma|ha la forma|ha forma|com'e vestit|come e vestit|e (?:un uomo|una donna|un ragazzo|una ragazza|un bambino|una bambina)|maschio|femmina|un volto|il volto|un viso|il viso|che faccia)\b/;
  const DESCRITTIVA = /\b(?:si vede|si vedono|di che colore|che cosa vedo|cosa vedo|che cosa si vede|cosa si vede)\b/;
  const domandaDescrittiva = testo => /\?/.test(String(testo || '')) && (DI_PERSONA.test(norm(testo)) || DESCRITTIVA.test(norm(testo)));
  function descrizione(state, content, io, testo, png, o) {
    const cmd = id => ({ tipo: 'esplora', libera: true, descrittiva: true, png: id || null, sorgente: 'testo', testo });
    const presenti = E().presentiEffettivi(state, content, state.scena).filter(id => content.png[id]);
    const chi = png || pngNominato(state, content, testo, presenti);
    if (chi || !DI_PERSONA.test(norm(testo))) return { via: 'esplora', cmds: [cmd(chi)] };
    const evidente = ultimoCoinvolto(state, content, presenti);
    if (evidente || o.forza || presenti.length < 2) return { via: 'esplora', cmds: [cmd(evidente || presenti[0])] };
    const nome = id => String(content.png[id].nome).replace(/\s*\([^)]*\)/g, '');
    return { via: 'chiarimento', cmds: [], chiarimento: { motivo: 'bersaglio', domanda: 'Di chi vuoi vedere com\'è?',
      alternative: presenti.slice(0, 3).map(id => ({ etichetta: 'Guardare ' + nome(id).charAt(0).toLowerCase() + nome(id).slice(1), png: id, fields: cmd(id) })) } };
  }

  /* Comandi di un'azione aperta: l'azione e la parte detta (nell'ordine in cui il giocatore l'ha scritta). Senza dialogo aperto, se la
     parte detta è rivolta a qualcuno (parlato) e c'è un interlocutore evidente, si apre il dialogo con lui; i gesti verso chi ascolta
     («Gli do le tre monete») vanno con la battuta. */
  function azioneVia(az, io, testo, state, content) {
    const da = az.da || az.passi[0];
    const cmdAz = { tipo: 'azione_aperta', sorgente: 'testo', testo: da.testo, atto: da.atto, png: da.png, tratto: da.tratto, oggetto: da.cond && da.cond.oggetto && da.cond.oggetto.id || null, mancanti: az.mancanti, restanti: az.restanti || [] };
    // il messaggio intero: l'atto da solo può dire «lo guardo» e perdere che cosa (serve a ricordare ciò che è stato visto)
    if (testo && testo !== da.testo) cmdAz.contesto = testo;
    // con dei gesti la battuta è il messaggio senza le azioni e senza i pensieri, nell'ordine scritto («Salve, …? Gli do le tre monete…»)
    const detto = !az.detto ? '' : !(az.gesti || []).length ? az.detto
      : [da.testo].concat(az.restanti || [], az.pensieri || []).reduce((t, p) => t.replace(p, ' '), testo).replace(/[ \t]*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim();
    const chi = detto && !io.dialogo && state && (/[«"“]/.test(testo) || parlato(az.detto)) ? (pngRivolto(content, io, az.detto, true, state) || interlocutoreEvidente(state, content, io) || pngRivolto(content, io, az.detto, false, state)) : null;
    const parola = detto && (io.dialogo || chi) ? [].concat(chi ? [{ tipo: 'dialogo_inizia', png: chi, sorgente: 'testo' }] : [], [{ tipo: 'battuta', sorgente: 'testo', testo: detto }]) : null;
    return { via: 'azione', cmds: az.detto_prima && parola ? parola.concat([cmdAz]) : parola ? [cmdAz].concat(parola) : [cmdAz] };
  }

  /* Ogni comando nato da un messaggio porta il messaggio intero (testoGiocatore, contratto §5.2): la parte agita (cmd.testo) e la forma
     normalizzata servono solo all'instradamento e al motore; il Narratore e la memoria leggono ciò che il giocatore ha scritto. */
  function instrada(state, content, testo, opz) {
    const r = instradaBase(state, content, testo, opz);
    if (r && Array.isArray(r.cmds) && typeof testo === 'string') r.cmds.forEach(c => { if (c && !c.testoGiocatore) c.testoGiocatore = testo; });
    return r;
  }
  function instradaBase(state, content, testo, opz) {
    const o = opz || {};
    const Dir = global.RMSoloDirector, IM = global.RMSoloImprov, TRM = global.RMSoloTrama, N = global.RMSoloNarrator;
    const io = E().interactionOptions(state, content);
    // azione aperta (con o senza parole dette nello stesso messaggio): prima capire, poi agire; fuori dal combattimento
    const AZ = global.RMSoloAzioni;
    // scene-seme: fuori dai dialoghi il Regista improvvisa e ha i suoi obiettivi di scena; un passo dichiarato dalla scena vale comunque
    const az0 = AZ && io && !state.incontro ? AZ.analizza(state, content, testo, io) : null;
    const semi = !!(global.RMSoloImprov && global.RMSoloImprov.modoSemi(content));
    // pensieri del personaggio e disposizioni per il futuro («Da ora in poi lo osserverò…»): né tiro né battuta; si instrada il resto
    // del messaggio, e il Narratore legge comunque tutto (testoGiocatore). Solo un pensiero: nessuno lo sente, il tempo non passa.
    if (az0 && (az0.pensieri || []).length && !az0.da && !az0.mancanti.length) {
      const resto = az0.pensieri.reduce((t, p) => t.replace(p, ' '), testo).replace(/\s+/g, ' ').trim();
      if (!/[A-Za-zÀ-ÿ]/.test(resto)) return { via: 'nessuno', cmds: [], avviso: 'È un pensiero: resta tuo, nessuno lo sente.' };
      return instradaBase(state, content, resto, o);
    }
    // scene-seme: l'azione resta al Regista solo se tocca uno dei suoi obiettivi o una sua prova (richiesta meccanica); altrimenti si risolve come azione aperta
    const alRegista = () => {
      const IMx = global.RMSoloImprov;
      try { const v = IMx.valida(state, content, IMx.proponi(testo, state, content), { testo }); return !!(v.accettata && (v.accettata.mechanicalResolutionRequests || []).some(r => r.tipo !== 'prova_libera')); } catch (e) { return true; }
    };
    const az = az0 && (!semi || io.dialogo || (az0.da && E().trovaPasso(state, content, E().sceneInteractions(content, state.scena), state.interazione, { atto: az0.da.atto, png: az0.da.png, testo: az0.da.testo })) || !alRegista()) ? az0 : null;
    const passoAz = az && az.da && E().trovaPasso ? E().trovaPasso(state, content, E().sceneInteractions(content, state.scena), state.interazione, { atto: az.da.atto, png: az.da.png, testo: az.da.testo }) : null;
    if (az && az.da && passoAz) return azioneVia(az, io, testo, state, content);
    // domanda su com'è ciò che si vede («Che aspetto ha?», «Guardo bene l'ombra: ha un volto?»), senza altre azioni né parole fra
    // virgolette e fuori da un dialogo: descrizione senza tiro (al motore: esplora con descrittiva/png), mai l'obiettivo della scena
    // («Astrid, si vede il villaggio da qui?» e le domande in seconda persona sono rivolte a qualcuno: restano un dialogo)
    const vocativo = io && (io.dialoghi || []).some(d => { const n = nomeDiRichiamo(d.nome); return n && new RegExp('^\\s*' + n + '\\s*[,!:]', 'i').test(testo); });
    if (io && !io.dialogo && !/[«"“]/.test(testo) && !vocativo && !parlato(testo) && domandaDescrittiva(testo) &&(!az0 || !az0.da || (az0.da.atto === 'esaminare' && !(az0.restanti || []).length && !az0.mancanti.length))) {
      return descrizione(state, content, io, testo, az0 && az0.da && az0.da.png, o);
    }
    // intenzione di avanzare (muoversi, seguire le tracce…): apre il passo successivo della scena, anche a dialogo aperto (che si chiude)
    // il passo deve essere quello di cui parla la frase; se il giocatore si rivolge per nome a un PNG, solo il dialogo con lui
    const av = E().avanzamento && E().avanzamento(state, content, testo, { png: io ? pngRivolto(content, io, testo, true, state) : null });
    if (av) return { via: 'avanza', cmds: (io && io.dialogo && !(av[0].tipo === 'battuta' || (av[0].tipo === 'dialogo_inizia' && av[0].png === io.dialogo.png)) ? [{ tipo: 'dialogo_chiudi', sorgente: 'testo', testo, implicita: true }] : []).concat(av) };
    // un'azione su una cosa che è un punto della scena («Osservo chi aspetta fuori dal consiglio») si esplora: il passo d'autore, senza tiro
    if (az && az.da && !az.da.png && !az.detto && E().puntoDiTesto && E().puntoDiTesto(state, content, testo)) {
      const esplora = { tipo: 'esplora', libera: true, sorgente: 'testo', testo };
      // la UI applica tutti i comandi solo per le vie «avanza»/«azione»/«png»: con un dialogo da chiudere si usa «avanza»
      return io && io.dialogo ? { via: 'avanza', cmds: [{ tipo: 'dialogo_chiudi', sorgente: 'testo', testo, implicita: true }, esplora] } : { via: 'esplora', cmds: [esplora] };
    }
    if (az && az.da) return azioneVia(az, io, testo, state, content);
    // scene-seme: un'azione che tocca un obiettivo del Regista la risolve il Regista (con la sua prova), anche se nomina un presente
    if (az0 && az0.da && !az && semi && !io.dialogo) return { via: 'improvvisa', cmds: [{ tipo: 'improvvisa', sorgente: 'testo', testo }] };
    if (az && !az.da && az.mancanti.length) return azioneVia(az, io, testo, state, content);
    // rivolto a un PNG che non è in scena: nessun presente risponde al suo posto; si chiede, senza tempo che passa (il motore dice già
    // «X non è qui.» per le proposte che lo nominano).
    const assente = io && !state.incontro ? pngAssenteRivolto(state, content, testo) : null;
    // richiamo a distanza («Grido: Padre!»): un tentativo plausibile, non una battuta al presente; azione libera della scena
    // (il Regista nelle scene-seme), senza dialoghi né incontri: chi è lontano non compare per questo. Il motore non esplora
    // a dialogo aperto: il richiamo lo interrompe, come gli altri punti della scena qui sopra
    if (assente && assente.distanza) {
      const cmd = global.RMSoloImprov && global.RMSoloImprov.modoSemi(content) ? { tipo: 'improvvisa', sorgente: 'testo', testo } : { tipo: 'esplora', libera: true, sorgente: 'testo', testo };
      if (io.dialogo) return { via: 'avanza', cmds: [{ tipo: 'dialogo_chiudi', sorgente: 'testo', testo, implicita: true }, cmd] };
      return { via: cmd.tipo, cmds: [cmd] };
    }
    // «Fai come ho scritto» con un destinatario che non c'è e non può sentire: nessuno risponde, nessun evento
    if (assente && o.forza) return { via: 'nessuno', cmds: [], avviso: assente.etichetta + ' non è qui e non può sentirti: nessuno risponde.' };
    if (assente) {
      // «Lo dico a …» cambia l'interlocutore in modo esplicito: il PNG del dialogo aperto o, senza dialogo, un presente con cui si può parlare
      const presenti = E().presentiEffettivi(state, content, state.scena);
      const ids = io.dialogo ? [io.dialogo.png] : (io.dialoghi || []).map(d => d.png).filter(id => presenti.indexOf(id) !== -1).slice(0, 2);
      const a = id => { const n = nomeDiRichiamo((content.png[id] || {}).nome); return (/^[aeiou]/i.test(n) ? 'ad ' : 'a ') + n; };
      const battuta = { tipo: 'battuta', sorgente: 'testo', testo, testoGiocatore: testo };
      return { via: 'chiarimento', cmds: [], chiarimento: {
        motivo: 'png_assente', png: assente.id,
        domanda: assente.etichetta + ' non è qui.' + (ids.length === 1 ? ' Vuoi dirlo ' + a(ids[0]) + '?' : ids.length ? ' Vuoi dirlo a uno dei presenti?' : ''),
        alternative: ids.map(id => ({ etichetta: 'Lo dico ' + a(id), png: id,
          cmds: io.dialogo ? [battuta] : [{ tipo: 'dialogo_inizia', png: id, sorgente: 'testo' }, battuta] }))
      } };
    }
    // dialogo in corso: il testo è una battuta rivolta al PNG, salvo che il giocatore si rivolga per nome a un altro PNG presente
    if (io && io.dialogo) {
      const altro = pngRivolto(content, io, testo, true, state);
      if (altro && altro !== io.dialogo.png) return { via: 'png', cmds: [{ tipo: 'dialogo_chiudi', sorgente: 'testo', testo, implicita: true }, { tipo: 'dialogo_inizia', png: altro, sorgente: 'testo' }, { tipo: 'battuta', sorgente: 'testo', testo }] };
      return { via: 'dialogo', cmds: [{ tipo: 'battuta', sorgente: 'testo', testo }] };
    }
    // l'oracolo sì/no parte solo dal suo pulsante («Chiedi al mondo»), mai da un testo libero
    // frase rivolta a un PNG presente (per nome, con «signore»/«capitano» o come domanda a loro): dialogo con quel PNG
    const rivolto = io && !io.dialogo ? pngRivolto(content, io, testo, false, state) : null;
    if (rivolto) return { via: 'png', cmds: [{ tipo: 'dialogo_inizia', png: rivolto, sorgente: 'testo' }, { tipo: 'battuta', sorgente: 'testo', testo }] };
    // una battuta senza nome a chi ha appena avuto a che fare con il protagonista (ti è venuto incontro, il dialogo appena chiuso): dialogo con lui
    const evidente = io && !io.dialogo && parlato(testo) ? interlocutoreEvidente(state, content, io) : null;
    if (evidente) return { via: 'png', cmds: [{ tipo: 'dialogo_inizia', png: evidente, sorgente: 'testo' }, { tipo: 'battuta', sorgente: 'testo', testo }] };
    // V2: se l'intenzione è ambigua si chiede, senza consumare il turno
    if (!o.forza && global.RMSoloInterprete && M() && M().attivo(state, 'interprete')) {
      const a = global.RMSoloInterprete.analizza(state, content, testo);
      if (a.chiarimento) return { via: 'chiarimento', cmds: [], chiarimento: a.chiarimento };
    }
    const intento = Dir ? Dir.interpret(testo, state, content) : null;
    const conPng = intento && intento.targetType === 'png' && io && (io.dialoghi || []).find(d => d.png === intento.targetId);
    if (conPng && intento.intentType === 'parlare') {
      return { via: 'png', cmds: [{ tipo: 'dialogo_inizia', png: conPng.png, sorgente: 'testo', intento }, { tipo: 'battuta', sorgente: 'testo', testo, intento }] };
    }
    // scene-seme: il Regista improvvisa (con il modello la UI aggiunge la proposta)
    if (IM && IM.modoSemi(content)) return { via: 'improvvisa', cmds: [{ tipo: 'improvvisa', sorgente: 'testo', testo, intento }] };
    // prima dello svolgimento il testo libero è esplorazione: niente prova
    if (io && !io.aperta) return { via: 'esplora', cmds: [{ tipo: 'esplora', libera: true, sorgente: 'testo', testo, intento }] };
    return { via: 'interprete', cmds: [{ tipo: 'azione', sorgente: 'testo', testo, intento }], richiedeProposta: true };
  }

  /* Combattimento: il testo libero diventa una capacità della scheda, l'arma, la fuga o una MANOVRA (decisione dell'autore del 6/11, §13:
     sgambetto, disarmo, spinta… vanno compresi, non trasformati in un attacco normale). Stesse regole di riconoscimento della UI
     (js/solo/solo-ui.js, submitText), più le manovre prima dell'arma: «fargli cadere l'arma» è un disarmo, non «Attacco con l'arma».
     Il bersaglio lo aggiunge chi invia. La manovra è solo riconosciuta: tiro (Arte Combattiva, o percentuale con la sola arma) ed
     effetti (stati esistenti) spettano al motore, che oggi non conosce azione 'manovra'. */
  const MANOVRE = [
    ['sgambetto', /\bsgambett|\bfa\w* inciampare\b/],
    ['disarmo', /\bdisarm|\b(?:far\w*|fa)\s+cadere\s+(?:di mano\s+)?(?:l'|la |il |lo )?(?:arma|spada|lama|coltello|pugnale|ascia|mazza|bastone|lancia)|\bstrapp\w*\s+(?:di mano\s+)?(?:l'|la |il |lo )?(?:arma|spada|lama|coltello|pugnale|ascia|mazza|bastone|lancia)/],
    ['spinta', /\bsping(?:o|erl\w*)\b|\buna spinta\b|\bbutt\w* a terra\b|\bscaravent/],
    ['presa', /\bimmobilizz|\bafferr\w*\s+(?:per |il |la |le |i |gli )|\bblocc\w* (?:il|i|le|gli) (?:braccio|braccia|polso|polsi)\b/]
  ];
  const NOME_MANOVRA = { sgambetto: 'lo sgambetto', disarmo: 'il disarmo', spinta: 'la spinta', presa: 'la presa' };
  function instradaCombattimento(state, testo) {
    // una battuta fra virgolette non è un'azione: non toglie l'azione del turno e non ha effetti meccanici
    const t = String(testo || '').replace(/[«"“][^»"”]*[»"”]/g, ' ').toLowerCase();
    const pg = state.personaggio;
    const caps = [['abilita', pg.abilita], ['tecnica', pg.tecniche], ['gemma', E().capacityList(pg, 'gemma')]]
      .flatMap(([kind, list]) => (list || []).filter(a => t.includes(a.nome.toLowerCase())).map(a => ({ kind, ab: a })));
    if (caps.length > 1 || /^\s*(non\b|rifiuto\b)/i.test(testo)) return { via: 'nessuno', cmds: [], avviso: 'Indica una sola azione che vuoi compiere.' };
    const base = { tipo: 'combattimento', sorgente: 'testo', testo };
    if (/fugg|scapp|ritir/.test(t)) return { via: 'combattimento', cmds: [Object.assign(base, { azione: 'fuga' })] };
    if (caps.length) return { via: 'combattimento', cmds: [Object.assign(base, { azione: caps[0].kind, abilitaId: caps[0].ab.id })] };
    // il disarmo si tenta e si verifica come le altre manovre; la conseguenza la decide il motore (oggi nessuna: manca la regola)
    const man = MANOVRE.map(([k, re]) => { const m = re.exec(t); return m ? { k, i: m.index } : null; }).filter(Boolean).sort((a, b) => a.i - b.i);
    if (man.length) {
      const cmd = Object.assign({}, base, { azione: 'manovra', manovra: man[0].k }, man.length > 1 ? { manovre: man.map(m => m.k) } : {});
      // colpire e tentare la manovra nello stesso messaggio: si chiede quale delle due (una sola azione per turno)
      if (/colpisc|attacc|fendent|affond|trafigg/.test(t)) return { via: 'chiarimento', cmds: [], chiarimento: { motivo: 'manovra', domanda: 'Vuoi colpirlo o tentare ' + NOME_MANOVRA[man[0].k] + '?',
        alternative: [{ etichetta: 'Lo colpisco con l\'arma', fields: Object.assign({}, base, { azione: 'arma' }) }, { etichetta: 'Tento ' + NOME_MANOVRA[man[0].k], fields: cmd }] } };
      return { via: 'combattimento', cmds: [cmd] };
    }
    if (/arma|colpisc|attacc/.test(t)) return { via: 'combattimento', cmds: [Object.assign(base, { azione: 'arma' })] };
    // qualunque altra azione scritta (decisione dell'autore del 7/11: non si respinge un'azione perché manca un pulsante) si tenta
    // e si verifica come una manovra; senza una regola che la descriva non ha conseguenze meccaniche
    if (/[a-zà-ù]{3}/.test(t)) return { via: 'combattimento', cmds: [Object.assign(base, { azione: 'manovra', manovra: 'libera' })] };
    return { via: 'nessuno', cmds: [], avviso: 'In combattimento indica una capacità della scheda, l\'arma o la fuga.' };
  }

  global.RMSoloTurno = { instrada, instradaCombattimento };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloTurno;
})(typeof window !== 'undefined' ? window : globalThis);
