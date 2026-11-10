/* Role Makers — Gioca in solitaria: SCHEDE DEL MONDO a innesco (Fase 4.1).

   Ogni PNG, luogo e fazione ha una scheda breve: aspetto, ruolo pubblico e cosa sa il protagonista. Il narratore
   riceve SOLO le schede delle entità presenti o nominate, nel limite di un budget di token:
   priorità presenti > nominate (PNG, fazioni) > luogo; ciò che non entra nel budget finisce in `dropped`.
   «Nominata» = citata nel testo del giocatore, nell'evento o fra le entità dell'interpretazione.

   Fonti (tutte della storia attiva, mai di un'altra): aspetto dei PNG in <storia>-scena.json (schede.png),
   luoghi da <storia>-mappa.json (descrizionePubblica), fazioni dal catalogo d'autore (<storia>-catalogo.json,
   aspetto pubblico del gruppo). Mai descrizioni riservate, mai verità non scoperte, mai lessico bloccato.
   Cosa sa il protagonista: relazione e fatti già scoperti (state.fattiScoperti), conoscenza del luogo
   (state.mappa). Logica pura, testabile in Node. */
(function (global) {
  'use strict';

  const BUDGET_TOKEN = 420;
  const C = () => global.RMSoloCampaign;
  const E = () => global.RMSoloEngine;
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = s => Math.ceil(String(s || '').length / 3.2);
  const rel = v => (v >= 3 ? 'fiducia piena' : v >= 1 ? 'fiducia' : v <= -3 ? 'ostilità' : v <= -1 ? 'diffidenza' : 'nessun legame particolare');
  const CONOSCENZA = { sentito_dire: 'ne hai solo sentito parlare', approssimativo: 'sai più o meno dove si trova', localizzato: 'sai dove si trova', visitato: 'ci {sei stato|sei stata|hai messo piede}', modificato: 'ci {sei stato|sei stata|hai messo piede}, ed è cambiato' };

  /* La parola (o il nome) compare nel testo come parola intera. */
  function citata(testoNorm, nome) {
    const n = norm(nome);
    return !!n && new RegExp('(^| )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(testoNorm);
  }
  /* Nomi con cui un PNG si chiama: nome intero e ciascuna parola capitalizzata lunga (nome di battesimo, cognome). */
  function nomiDi(nomeCompleto) {
    const pulito = String(nomeCompleto || '').replace(/\(.*?\)/g, '').trim();
    const parole = pulito.split(/\s+/).filter(p => p.length >= 3 && /^[A-ZÀ-Ý]/.test(p));
    return [pulito].concat(parole);
  }

  function schedaPng(state, content, id) {
    const p = content.png[id];
    const d = content.scena && content.scena.schede && content.scena.schede.png && content.scena.schede.png[id];
    if (!p) return null;
    const st = (state.png || {})[id] || {};
    const noti = (p.sa || []).filter(f => (global.RMSoloComunicati ? global.RMSoloComunicati.noto(state, content, f) : (state.fattiScoperti || []).indexOf(f) !== -1) && content.fatti[f]).slice(0, 2).map(f => content.fatti[f].testo);
    const t = p.nome + ' (' + p.ruolo + ').' + (d && d.aspetto ? ' Aspetto: ' + d.aspetto : '') +
      ' Per il protagonista: ' + (st.incontrato ? rel(Number(st.atteggiamento) || 0) + '.' : 'non ci ha ancora parlato.') + (noti.length ? ' Il protagonista sa che ' + noti.join(' ') : '');
    return { tipo: 'png', id, nome: p.nome, testo: t };
  }
  function schedaLuogo(state, content, luogoId) {
    const m = content.mappa && content.mappa.formato === 'rm-solo-mappa/1' ? content.mappa : null;
    const l = m && m.luoghi[luogoId];
    if (!l || !l.descrizionePubblica) return null;
    if (l.rivelazione && !(global.RMSoloComunicati ? global.RMSoloComunicati.noto(state, content, l.rivelazione) : (state.fattiScoperti || []).indexOf(l.rivelazione) !== -1)) return null;
    const x = state.mappa && state.mappa.luoghi && state.mappa.luoghi[luogoId];
    return { tipo: 'luogo', id: luogoId, nome: l.nome, testo: l.nome + '. ' + l.descrizionePubblica + (x && CONOSCENZA[x.conoscenza] ? ' Per il protagonista: ' + (global.RMSoloGenere ? global.RMSoloGenere.applica(CONOSCENZA[x.conoscenza], state.personaggio && state.personaggio.genere) : CONOSCENZA[x.conoscenza]) + '.' : '') };
  }
  function schedeFazioni(content, testoNorm) {
    const cat = content.catalogo;
    if (!cat || !cat.gruppi) return [];
    return Object.keys(cat.gruppi).filter(g => {
      const gr = cat.gruppi[g];
      return citata(testoNorm, gr.nome.split(' — ')[0]) || citata(testoNorm, g.replace(/_/g, ' '));
    }).map(g => ({ tipo: 'fazione', id: g, nome: cat.gruppi[g].nome, testo: cat.gruppi[g].nome + '. Aspetto: ' + cat.gruppi[g].aspetto }));
  }
  function luogoDiScena(content, sceneId) {
    const m = content.mappa && content.mappa.formato === 'rm-solo-mappa/1' ? content.mappa : null;
    if (!m) return null;
    const ids = Object.keys(m.luoghi).filter(id => (m.luoghi[id].macroCapitoli || []).indexOf(sceneId) !== -1);
    return ids.length === 1 ? ids[0] : null;
  }

  /* opts: { testo (azione del giocatore e testo dell'evento), entita (da interprete), budget } */
  function schede(state, content, opts) {
    const o = opts || {};
    const sc = E().currentScene(state, content);
    if (!sc) return { carte: [], dropped: [], tokens: 0, budget: o.budget != null ? o.budget : BUDGET_TOKEN };
    const rules = C() ? C().lockedLexicon(state, content) : [];
    const pulito = t => !(C() && rules.length && C().lexiconHits(t, rules).length);
    const testoNorm = norm([o.testo].concat(o.entita || []).filter(Boolean).join(' '));
    const presenti = sc.png_presenti || [];
    const cand = [];
    presenti.forEach(id => { const s = schedaPng(state, content, id); if (s) cand.push(Object.assign(s, { priorita: 100, motivo: 'presente' })); });
    Object.keys(content.png || {}).forEach(id => {
      if (presenti.indexOf(id) !== -1) return;
      if (nomiDi(content.png[id].nome).some(n => citata(testoNorm, n))) { const s = schedaPng(state, content, id); if (s) cand.push(Object.assign(s, { priorita: 80, motivo: 'nominato' })); }
    });
    schedeFazioni(content, testoNorm).forEach(s => cand.push(Object.assign(s, { priorita: 70, motivo: 'nominata' })));
    const l = schedaLuogo(state, content, luogoDiScena(content, state.scena));
    if (l) cand.push(Object.assign(l, { priorita: 60, motivo: 'luogo' }));
    const valide = cand.filter(c => pulito(c.testo));
    const budget = o.budget != null ? o.budget : BUDGET_TOKEN;   // 0 = nessuna scheda
    const carte = [], dropped = [];
    let usato = 0;
    valide.forEach((c, i) => { c.k = i; });
    valide.slice().sort((a, b) => b.priorita - a.priorita || a.k - b.k).forEach(c => {
      const t = tokens(c.testo);
      if (usato + t <= budget) { carte.push(c); usato += t; } else dropped.push(c.tipo + ':' + c.id);
    });
    carte.sort((a, b) => b.priorita - a.priorita || a.k - b.k);
    return { carte, dropped, tokens: usato, budget };
  }
  function testo(r) {
    if (!r || !r.carte.length) return '';
    return 'SCHEDE DEL MONDO (solo ciò che serve ora):\n' + r.carte.map(c => '- ' + c.testo).join('\n');
  }

  global.RMSoloSchede = { BUDGET_TOKEN, nomiDi, citata, schede, testo };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloSchede;
})(typeof window !== 'undefined' ? window : globalThis);
