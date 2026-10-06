/* ==========================================================================
   Role Makers — Gioca in solitaria: esportazione del personaggio prima di
   una sostituzione (specifica V3 §2).

   Un archivio ZIP con: ritratto (se presente), background completo in
   testo, fronte e retro della scheda come immagini PNG disegnate su
   canvas ad altezza calcolata sul contenuto (niente sezioni tagliate fuori
   schermo), più un riepilogo. NON contiene un salvataggio reimportabile:
   serve a conservare il ricordo e a ricostruire a mano un personaggio
   simile altrove.

   Salvataggio: con Capacitor (APK) il file si scrive nei Documenti tramite
   @capacitor/filesystem, che conferma la scrittura; nel browser il download
   non espone un esito, quindi il chiamante DEVE chiedere una conferma
   esplicita prima di sostituire la partita.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------- ZIP */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  /* ZIP "stored" (senza compressione): le PNG sono già compresse. */
  function zip(entries) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    entries.forEach(e => {
      const name = enc.encode(e.name);
      const data = e.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/zip' });
  }

  /* ------------------------------------------------------- disegno */

  const W = 1080, PAD = 56;
  const COL = { bg: '#14161A', panel: '#1E2128', ink: '#EDE6D6', muted: '#A7A08F', accent: '#C9A45C', line: '#343844' };

  /* Disegna in due passaggi: il primo misura l'altezza necessaria, il
     secondo disegna su un canvas alto esattamente quanto il contenuto. */
  function renderPage(title, sections) {
    const draw = (ctx, dry) => {
      let y = PAD;
      const text = (s, size, color, weight, x, maxW) => {
        ctx.font = (weight || 400) + ' ' + size + 'px Georgia, "Times New Roman", serif';
        ctx.fillStyle = color || COL.ink;
        const words = String(s).split(/\s+/); let line = '';
        const lh = Math.round(size * 1.35);
        const lines = [];
        words.forEach(w => { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > (maxW || W - 2 * PAD) && line) { lines.push(line); line = w; } else line = t; });
        if (line) lines.push(line);
        lines.forEach(l => { if (!dry) ctx.fillText(l, x || PAD, y + size); y += lh; });
      };
      text(title, 44, COL.accent, 700);
      y += 12;
      sections.forEach(sec => {
        y += 18;
        if (!dry) { ctx.fillStyle = COL.line; ctx.fillRect(PAD, y, W - 2 * PAD, 2); }
        y += 16;
        text(sec.titolo, 30, COL.accent, 700);
        y += 6;
        (sec.righe || []).forEach(r => {
          if (Array.isArray(r)) {
            const y0 = y;
            text(r[0], 26, COL.muted, 400, PAD, 360);
            const yA = y; y = y0;
            text(r[1], 26, COL.ink, 600, PAD + 380, W - 2 * PAD - 380);
            y = Math.max(y, yA);
          } else text(r, 26, COL.ink, 400);
          y += 4;
        });
      });
      return y + PAD;
    };
    const probe = document.createElement('canvas').getContext('2d');
    const h = Math.ceil(draw(probe, true));
    const c = document.createElement('canvas');
    c.width = W; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, h);
    draw(ctx, false);
    return new Promise(res => c.toBlob(b => res(b), 'image/png'));
  }

  const STAT_LABEL = { hp: 'HP (punti)', mp: 'MP (punti)', for: 'Forza', mira: 'Mira', vel: 'Velocità', fmen: 'Forza Magica', dex: 'Destrezza', dif: 'Difesa', dmen: 'Difesa Magica' };
  const LIST_LABEL = { conoscenze: 'Conoscenze', capacitaNormali: 'Capacità Normali', capacitaCombattive: 'Capacità Combattive' };

  function frontSections(state) {
    const pg = state.personaggio;
    const stato = { attivo: 'In corso', concluso: 'Capitolo concluso', morto: 'Morto', terminato: 'Partita terminata' }[state.stato] || state.stato;
    return [
      { titolo: 'Identità', righe: [['Nome', pg.nome], ['Popolazione', pg.popolazione || ''], ['Provenienza', pg.provenienza || ''], ['Appartenenza politica', pg.appartenenzaPolitica || ''], ['Mansione', pg.mansione], ['Classe', (BUILDS[pg.build] || {}).label || pg.build],
        ['Livello', String(pg.livello)], ['AP disponibili', String(pg.apDisponibili)], ['Q.I.', String(pg.qi)], ['Difficoltà', state.difficolta], ['Stato', stato]] },
      { titolo: 'Risorse', righe: [['HP', pg.hpCur + ' / ' + pg.hpMaxTracked], ['MP', pg.mpCur + ' / ' + pg.mpMaxTracked], ['P.R.', pg.prCur + ' / ' + pg.prMaxTracked], ['P.P.', String(pg.ppCur)]]
        .concat((pg.gemme || []).map(g => [g.nome, g.stato === 'attiva' ? 'attiva' : 'scarica']))
        .concat(pg.puntiTratto ? [['Punti tratto da assegnare', pg.puntiTratto.conoscenze + ' / ' + pg.puntiTratto.capacitaNormali + ' / ' + pg.puntiTratto.capacitaCombattive]] : [])
        .concat(state.progresso ? [['Progresso verso il livello successivo', state.progresso.tacche + ' tacche']] : []) },
      { titolo: 'Statistiche primarie', righe: Object.keys(STAT_LABEL).map(k => [STAT_LABEL[k], String(pg.primary[k])]) },
      { titolo: 'Statistiche terziarie', righe: [['Stile', String(pg.tertiary.stile)], ['Fortuna', String(pg.tertiary.fortuna)], ['Carisma', String(pg.tertiary.carisma)]] }
    ].concat(Object.keys(LIST_LABEL).map(l => ({ titolo: LIST_LABEL[l], righe: Object.entries(pg.traits[l] || {}).map(([k, v]) => [k, '+' + v]) })));
  }

  function backSections(state, content) {
    const pg = state.personaggio;
    const NOMI = { for: 'Forza', mira: 'Mira', fmen: 'Forza Magica', dex: 'Destrezza', vel: 'Velocità', dif: 'Difesa', dmen: 'Difesa Magica' };
    const cap = (a, tipo) => [a.nome + ' (' + tipo + ', Lv ' + a.lv + ')',
      (a.dannoBase ? 'Danno base ' + a.dannoBase + ' + ' + (NOMI[a.stat] || 'Forza') : (a.effetto || 'Supporto')) +
      ((tipo === 'Abilità' || (a.fuoriSlot && a.categoria === 'magia')) ? ' · ' + abilitaCostoForLv(a.lv) + ' MP' : '') + ' · usi verso il livello successivo ' + (a.utilizzi || 0) + '/' + utilizziLimitFor(pg.qi, a.lv)];
    return [
      { titolo: 'Tecniche e Abilità', righe: (pg.tecniche || []).map(a => cap(a, 'Tecnica')).concat((pg.abilita || []).map(a => cap(a, 'Abilità'))) },
      { titolo: 'Capacità delle gemme fuori slot', righe: RMSoloEngine.capacityList(pg, 'gemma').map(a => cap(a, 'Gemma, 0 slot')) },
      { titolo: 'Equipaggiamento', righe: (pg.equip || []).map(e => e.tipo === 'descrittivo' ? [e.nome, 'Dotazione descrittiva']
        : [e.nome, 'ATK ' + e.atk + ' · DIF ' + e.dif + ' · Durabilità ' + e.durabilita + (e.resistenza != null ? ' · Resistenza ' + e.resistenza : '') + ' (' + e.qualita + ')']) },
      { titolo: 'Inventario', righe: state.inventario.length ? state.inventario.map(i => { const d = RMSoloEngine.itemInfo(state, content, i.id); return [d.nome + (i.qty > 1 ? ' ×' + i.qty : ''), d.descrizione + (d.statistiche && d.statistiche.atk != null ? ' (ATK ' + d.statistiche.atk + ' · DIF ' + d.statistiche.dif + ' · Durabilità ' + d.statistiche.durabilita + ')' : '')]; }) : ['Nessun oggetto'] }
    ].concat(knownSections(state, content));
  }

  /* Solo ciò che il personaggio sa legittimamente: PNG incontrati, fatti
     scoperti, voci (segnate come tali), promesse, reputazione. Mai verità
     riservate, PNG mai incontrati o conseguenze in sospeso. */
  function relazione(v) { v = Number(v) || 0; return v >= 3 ? 'fiducia piena' : v >= 1 ? 'fiducia' : v <= -3 ? 'ostilità' : v <= -1 ? 'diffidenza' : 'nessun legame particolare'; }
  function nomeFazione(content, k) { return ((content.fazioni || {})[k] || {}).nome || (/^[A-ZÀ-Ú][A-Za-zÀ-ÿ' ]+$/.test(k) ? k : null); }
  function knownSections(state, content) {
    const v = RMSoloCampaign.playerView(state, content);
    const rep = Object.entries(v.reputazione);
    return [
      { titolo: 'Persone incontrate', righe: v.png.length ? v.png.map(p => [p.nome, p.ruolo + ' · ' + relazione(p.atteggiamento)]) : ['Nessuna'] },
      { titolo: 'Fatti scoperti', righe: v.fatti.length ? v.fatti : ['Nessuno'] },
      { titolo: 'Voci (non verificate)', righe: v.voci.length ? v.voci : ['Nessuna'] },
      { titolo: 'Promesse', righe: v.promesse.length ? v.promesse.map(p => [p.testo, p.stato]) : ['Nessuna'] },
      { titolo: 'Reputazione', righe: rep.filter(([k]) => nomeFazione(content, k)).length ? rep.filter(([k]) => nomeFazione(content, k)).map(([k, n]) => [nomeFazione(content, k), n > 0 ? 'ti stimano' : n < 0 ? 'diffidano di te' : 'neutrale']) : ['Nessuna variazione'] }
    ];
  }

  function backgroundText(state, content) {
    const pg = state.personaggio;
    const lines = [
      'ROLE MAKERS — Gioca in solitaria', 'Personaggio: ' + pg.nome, 'Storia: ' + (content.ambientazione || content.storia.charAt(0).toUpperCase() + content.storia.slice(1)) + ' — ' + content.titolo,
      'Popolazione: ' + pg.popolazione, 'Mansione: ' + pg.mansione, '', 'BACKGROUND', pg.background, '', 'OBIETTIVO', pg.obiettivo, '', 'CRONACA DELLA PARTITA'
    ];
    state.memoria.riassunti.forEach(r => lines.push('- ' + r.titolo + ': ' + r.testo));
    lines.push('', 'Atto raggiunto: ' + ['', 'I', 'II', 'III'][state.atto || 1]);
    if (state.finale && state.esitoFinale && state.esitoFinale.tipo === 'esito') {
      const v = RMSoloCampaign.variantDef(content, state.finale) || {};
      lines.push('', 'FINALE: ' + (v.titolo || state.finale));
      (state.esitoFinale.modificatori || []).forEach(m => lines.push('  + ' + ((RMSoloCampaign.variantDef(content, m) || {}).titolo || m)));
      lines.push(RMSoloCampaign.endingText(content, state.esitoFinale));
    } else if (state.finale) lines.push('', 'FINALE: ' + ((RMSoloCampaign.variantDef(content, state.finale) || {}).titolo || state.finale));
    const FINE = { morte_in_combattimento: 'morte in combattimento', raven: 'ucciso da Raven, il Corvo', armatura: 'consumato dall\'armatura', sanzione: 'partita interrotta' };
    if (state.stato === 'morto' || state.stato === 'terminato') lines.push('', 'Esito: ' + (FINE[state.motivoFine] || 'partita conclusa'));
    lines.push('', 'Questo file è un ricordo: non si può reimportare nell\'app.');
    return lines.join('\n');
  }

  function safeName(s) { return String(s || 'personaggio').replace(/[^A-Za-z0-9À-ÿ_-]+/g, '_').slice(0, 40); }

  /* opts.ritrattoPredefinito: volto dell'archetipo se il giocatore non ne ha scelto uno */
  async function buildArchive(state, content, opts) {
    const enc = new TextEncoder();
    const pg = state.personaggio;
    const front = await renderPage(pg.nome + ' — Fronte scheda', frontSections(state));
    const back = await renderPage(pg.nome + ' — Retro scheda', backSections(state, content));
    const entries = [
      { name: 'background.txt', data: enc.encode(backgroundText(state, content)) },
      { name: 'scheda-fronte.png', data: new Uint8Array(await front.arrayBuffer()) },
      { name: 'scheda-retro.png', data: new Uint8Array(await back.arrayBuffer()) }
    ];
    const riepilogo = ['Contenuto dell\'archivio:', '- background.txt', '- scheda-fronte.png', '- scheda-retro.png'];
    const ritratto = pg.ritratto || (opts && opts.ritrattoPredefinito);
    if (ritratto) {
      const r = await fetch(ritratto).then(x => x.blob());
      const ext = /png/.test(r.type) ? 'png' : /webp/.test(r.type) ? 'webp' : 'jpg';
      entries.push({ name: 'ritratto.' + ext, data: new Uint8Array(await r.arrayBuffer()) });
      riepilogo.push('- ritratto.' + ext);
    } else riepilogo.push('Nessun ritratto: il personaggio non ne aveva uno.');
    entries.push({ name: 'LEGGIMI.txt', data: enc.encode(riepilogo.join('\n')) });
    const blob = zip(entries);
    return { blob, nome: 'RoleMakers_' + safeName(pg.nome) + '_' + state.storia + '.zip', riepilogo, entries: entries.map(e => e.name) };
  }

  function blobToBase64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }

  /* Consegna del file. Restituisce { confermato: true } solo quando la
     piattaforma conferma la scrittura; altrimenti { confermato: false,
     serveConferma: true } e il chiamante chiede all'utente. */
  async function deliver(archive) {
    const Cap = global.Capacitor;
    const fs = Cap && Cap.isNativePlatform && Cap.isNativePlatform() && Cap.Plugins && Cap.Plugins.Filesystem;
    if (fs) {
      const data = await blobToBase64(archive.blob);
      const r = await fs.writeFile({ path: archive.nome, data, directory: 'DOCUMENTS', recursive: true });
      return { confermato: true, uri: r && r.uri };
    }
    const url = URL.createObjectURL(archive.blob);
    const a = document.createElement('a');
    a.href = url; a.download = archive.nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { confermato: false, serveConferma: true };
  }

  global.RMSoloExport = { buildArchive, deliver, zip, crc32, backgroundText, frontSections, backSections, knownSections };
})(typeof window !== 'undefined' ? window : globalThis);
