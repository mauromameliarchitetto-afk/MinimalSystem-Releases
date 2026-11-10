/* Role Makers — Gioca in solitaria: catalogo d'autore per storia e per gruppo (Fase 2b).

   Il catalogo (js/solo/content/<storia>-catalogo.json, generato da
   scripts/solo-genera-catalogo.js) dice, per ogni GRUPPO dell'ambientazione
   (Eidos: popolo; Ich: regione/clan + società; Icaro: colore del Cromo) e per
   ogni CLASSE ammessa, la dotazione di Lv 1: armi, protezione, scudo, zaino,
   tecniche, abilità, Boost. Contiene anche i «pool» da cui si offrono gli
   esempi («Scegli un esempio») e si riempiono gli slot sbloccati ai livelli
   successivi. Niente DOM: logica pura, testabile in Node.

   Regole esistenti riusate (CLAUDE.md §10), mai duplicate: statistiche di armi
   e armature da EQUIP_TABLE (equipRange), slot da tecAbSbloccate, tetto del
   danno al Lv 1 da CAPACITA_TETTI (capacitaTetto), costo MP delle abilità da
   abilitaCostoForLv, Boost da BOOST_LEVELS.

   PROPOSTA DA APPROVARE – armi ammesse per classe e numero di armi (cercata in
   js/data.js, js/rules.js, js/app.js, js/cloud-combat.js, js/solo/solo-loot.js:
   nessuna regola «arma per classe»; esiste solo la frase della premessa di
   Eidos «non più di due armi alla volta» per i Chorisfos). Qui vale per tutti i
   popoli ed è attiva nel gioco: vedi REGOLA_ARMI. */
(function (global) {
  'use strict';

  const clone = o => JSON.parse(JSON.stringify(o));
  const CLASSI = ['guerriero', 'eclettico', 'mago'];
  /* Oltre questo livello il catalogo non garantisce nuovi slot: la campagna arriva a Lv 6-7. */
  const LIVELLO_POOL = 12;

  const REGOLA_ARMI = {
    stato: 'PROPOSTA DA APPROVARE (attiva nel gioco)',
    massimoArmi: 2, // premessa di Eidos per i Chorisfos, estesa a tutti i popoli
    guerriero: { armi: [1, 2], scudo: true },
    eclettico: { armi: [1, 1], scudo: false },
    mago: { armi: [1, 1], scudo: false },
    livello1: { taglieArma: ['corte', 'medie'], taglieArmatura: ['leggere', 'medie'], taglieScudo: ['piccoli', 'medi'] }
  };

  /* ------------------------------------------------ lettura del catalogo */
  function gruppoDi(cat, scelte) {
    if (!cat || !cat.gruppi) return null;
    const s = scelte || {};
    const trovati = Object.keys(cat.gruppi).filter(id => {
      const m = cat.gruppi[id].match || {};
      return Object.keys(m).length > 0 && Object.keys(m).every(k => [].concat(m[k]).indexOf(s[k]) !== -1);
    });
    return trovati.length === 1 ? trovati[0] : null;
  }
  /* Gruppo di un archetipo dai suoi campi ontologici (preset compresi): così anche i
     personaggi pronti ricevono dal catalogo le voci dei livelli successivi. */
  function gruppoDaOntologia(cat, o) {
    if (!cat || !o) return null;
    return gruppoDi(cat, {
      popolazione: o.peopleId || o.factionId,
      citta: o.cityId || o.regionId,
      appartenenza: o.societyId || o.socialClassId || o.factionId || (o.regionId === 'margini' ? 'senza_colore' : undefined)
    });
  }
  function classiDi(cat, gruppoId) {
    const g = cat && cat.gruppi && cat.gruppi[gruppoId];
    const out = {};
    CLASSI.forEach(b => {
      const c = g && g.classi && g.classi[b];
      out[b] = c && c.ammessa ? { ok: true, motivo: '' } : { ok: false, motivo: (c && c.motivo) || 'Dotazione non prevista per questo gruppo.' };
    });
    return out;
  }

  function equipDa(o) {
    const e = { id: o.id, nome: o.nome, tipo: o.tipo, descrizione: o.descrizione, fonteCanone: o.fonteCanone, catalogo: true, origine: o.origine };
    if (o.tipo === 'descrittivo') return e;
    Object.assign(e, { taglia: o.taglia, qualita: o.qualita, atk: o.atk, dif: o.dif, durabilita: o.durabilita, resistenza: null, base: 'catalogo' });
    if (o.classe) e.classe = o.classe;
    return e;
  }
  function capDa(cat, id) { return clone(cat.capacita[id]); }

  /* Dotazione di Lv 1 di un gruppo e di una classe, pronta da copiare in un archetipo. */
  function dotazione(cat, gruppoId, build) {
    const g = cat && cat.gruppi && cat.gruppi[gruppoId];
    const c = g && g.classi && g.classi[build];
    if (!c || !c.ammessa) return null;
    const equip = c.armi.map(id => cat.oggetti[id]).concat([cat.oggetti[c.armatura]], c.scudo ? [cat.oggetti[c.scudo]] : [], (c.extra || []).map(id => cat.oggetti[id])).map(equipDa);
    const out = {
      equip,
      inventarioIniziale: Object.keys(c.zaino).map(id => ({ id, qty: c.zaino[id] })),
      tecniche: c.tecniche.map(id => capDa(cat, id)),
      abilita: c.abilita.map(id => capDa(cat, id)),
      boost: g.boost ? [clone(cat.boost[g.boost])] : []
    };
    if (g.gemme) out.gemme = clone(g.gemme);
    if (g.capacitaSpeciali) out.capacitaSpeciali = clone(g.capacitaSpeciali);
    return out;
  }

  /* Esempi offerti da «Scegli un esempio» e dal level up: i pool del gruppo per la
     classe, senza le voci già in scheda. kind: 'tecniche' | 'abilita'. */
  function esempi(cat, gruppoId, build, kind, giaUsate) {
    const g = cat && cat.gruppi && cat.gruppi[gruppoId];
    const c = g && g.classi && g.classi[build];
    if (!c || !c.ammessa) return [];
    const usate = giaUsate || [];
    return (c.pool[kind] || []).filter(id => usate.indexOf(id) === -1).map(id => capDa(cat, id));
  }
  /* Prossime n voci per il level up: le prime del pool non ancora in scheda. */
  function prossime(cat, gruppoId, build, kind, giaUsate, n) {
    return esempi(cat, gruppoId, build, kind, giaUsate).slice(0, Math.max(0, n || 0));
  }

  /* ------------------------------------------------ riepilogo e controllo */
  function riepilogoProposte(cat) {
    const conta = o => Object.keys(o || {}).filter(k => o[k].origine === 'proposta').length;
    const dotazioni = Object.keys(cat.gruppi).reduce((a, id) => a + CLASSI.filter(b => cat.gruppi[id].classi[b] && cat.gruppi[id].classi[b].ammessa && cat.gruppi[id].classi[b].origine === 'proposta').length, 0);
    return { oggetti: conta(cat.oggetti), capacita: conta(cat.capacita), boost: conta(cat.boost), dotazioni, totale: conta(cat.oggetti) + conta(cat.capacita) + conta(cat.boost) + dotazioni };
  }

  function testiVuoti(v, percorso, out) {
    if (typeof v === 'string') {
      if (!v.trim()) out.push(percorso + ': testo vuoto');
      else if (/\bMANCA\b|\bda scrivere\b|\bda compilare\b|\bTODO\b|\?\?\?/.test(v)) out.push(percorso + ': voce non completata («' + v.slice(0, 40) + '»)');
    } else if (Array.isArray(v)) v.forEach((x, i) => testiVuoti(x, percorso + '[' + i + ']', out));
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => testiVuoti(v[k], percorso + '.' + k, out));
  }

  /* Controllo di completezza (usato dal generatore e dal test): ritorna l'elenco degli errori.
     ctx: { equipRange, tecAbSbloccate, capacitaTetto, abilitaCostoForLv, borsa } presi da js/data.js e dalla campagna. */
  function valida(cat, ctx) {
    const e = [];
    if (!cat || cat.formato !== 'rm-solo-catalogo/1') return ['formato del catalogo non valido'];
    testiVuoti(cat, cat.storia, e);
    if (!cat.gruppi || !Object.keys(cat.gruppi).length) e.push('nessun gruppo');
    Object.keys(cat.oggetti || {}).forEach(id => {
      const o = cat.oggetti[id];
      if (['fonte', 'proposta'].indexOf(o.origine) === -1) e.push(id + ': origine non valida');
      if (o.tipo === 'descrittivo') return;
      const r = ctx.equipRange(o.tipo, o.taglia, o.qualita);
      if (!r) e.push(id + ': ' + o.tipo + '/' + o.taglia + '/' + o.qualita + ' assente da EQUIP_TABLE');
      else {
        if (o.atk < r.atk[0] || o.atk > r.atk[1]) e.push(id + ': ATK ' + o.atk + ' fuori da ' + r.atk.join('–'));
        if (o.dif < r.dif[0] || o.dif > r.dif[1]) e.push(id + ': DIF ' + o.dif + ' fuori da ' + r.dif.join('–'));
        if (o.durabilita < r.dur[0] || o.durabilita > r.dur[1]) e.push(id + ': durabilità ' + o.durabilita + ' fuori da ' + r.dur.join('–'));
      }
      const L = REGOLA_ARMI.livello1;
      if (o.tipo === 'arma' && L.taglieArma.indexOf(o.taglia) === -1) e.push(id + ': arma di taglia ' + o.taglia + ' oltre il Lv 1');
      if (o.tipo === 'armatura' && L.taglieArmatura.indexOf(o.taglia) === -1) e.push(id + ': armatura di taglia ' + o.taglia + ' oltre il Lv 1');
      if (o.tipo === 'scudo' && L.taglieScudo.indexOf(o.taglia) === -1) e.push(id + ': scudo di taglia ' + o.taglia + ' oltre il Lv 1');
      if (o.tipo === 'arma' && o.qualita !== 'bassa' && !(o.taglia === 'corte' && o.qualita === 'media')) e.push(id + ': arma di qualità ' + o.qualita + ' oltre il Lv 1');
    });
    const tettoDanno = ctx.capacitaTetto('danno', 1), tettoCura = ctx.capacitaTetto('cura', 1), tettoEffetti = ctx.capacitaTetto('effetti', 1);
    Object.keys(cat.capacita || {}).forEach(id => {
      const c = cat.capacita[id];
      if (['fonte', 'proposta'].indexOf(c.origine) === -1) e.push(id + ': origine non valida');
      const danno = (Number(c.dannoBase) || 0) + (Number(c.dannoBase2) || 0);
      if (danno > tettoDanno) e.push(c.nome + ': danno base ' + danno + ' oltre il tetto di ' + tettoDanno + ' al Lv 1');
      if ((Number(c.curaPercentuale) || 0) < 0) e.push(c.nome + ': cura negativa');
      if (Object.keys(c.bonusStat || {}).length > tettoEffetti) e.push(c.nome + ': ' + Object.keys(c.bonusStat).length + ' effetti oltre il tetto di ' + tettoEffetti);
      if (!c.nome || !c.descrizione || !c.effetto) e.push(id + ': nome, descrizione o effetto mancanti');
      if (c.tipo === 'danno' && !c.stat) e.push(c.nome + ': attacco senza statistica');
      if (c.lv !== 1) e.push(c.nome + ': le voci di catalogo partono dal Lv 1');
      const mp = c.categoria === 'tecnica' ? 0 : ctx.abilitaCostoForLv(1);
      if (c.costoMP !== mp) e.push(c.nome + ': costo MP ' + c.costoMP + ' invece di ' + mp + ' (regola esistente)');
    });
    Object.keys(cat.boost || {}).forEach(id => {
      const b = cat.boost[id];
      if (!b.nome || !b.descrizione || !(b.bonus || []).length) e.push(id + ': Boost incompleto');
      if (b.lv !== 1) e.push(id + ': i Boost di catalogo partono dal Lv 1');
    });
    Object.keys(cat.gruppi || {}).forEach(gid => {
      const g = cat.gruppi[gid];
      ['nome', 'aspetto', 'fonte', 'limiti'].forEach(k => { if (!String(g[k] || '').trim()) e.push(gid + ': ' + k + ' mancante'); });
      if (!g.match || !Object.keys(g.match).length) e.push(gid + ': nessun criterio di appartenenza (match)');
      if (!g.boost || !cat.boost[g.boost]) e.push(gid + ': Boost mancante');
      let ammesse = 0;
      CLASSI.forEach(b => {
        const c = g.classi && g.classi[b];
        const dove = gid + '/' + b;
        if (!c) { e.push(dove + ': classe non dichiarata (ammessa o motivata)'); return; }
        if (!c.ammessa) { if (!String(c.motivo || '').trim()) e.push(dove + ': classe non ammessa senza motivo'); return; }
        ammesse++;
        if (['fonte', 'proposta'].indexOf(c.origine) === -1) e.push(dove + ': origine della dotazione non valida');
        const reg = REGOLA_ARMI[b];
        const oggetto = (id, tipo) => { const o = cat.oggetti[id]; if (!o) { e.push(dove + ': oggetto inesistente ' + id); return null; } if (o.tipo !== tipo) e.push(dove + ': ' + id + ' non è ' + tipo); return o; };
        if (!Array.isArray(c.armi) || c.armi.length < reg.armi[0] || c.armi.length > reg.armi[1]) e.push(dove + ': armi ' + (c.armi || []).length + ' fuori da ' + reg.armi.join('–'));
        if ((c.armi || []).length > REGOLA_ARMI.massimoArmi) e.push(dove + ': più di ' + REGOLA_ARMI.massimoArmi + ' armi');
        (c.armi || []).forEach(id => oggetto(id, 'arma'));
        if (!c.armatura) e.push(dove + ': protezione mancante'); else oggetto(c.armatura, 'armatura');
        if (c.scudo) { if (!reg.scudo) e.push(dove + ': scudo non ammesso alla classe'); oggetto(c.scudo, 'scudo'); }
        (c.extra || []).forEach(id => oggetto(id, 'descrittivo'));
        const zk = Object.keys(c.zaino || {});
        if (!zk.length) e.push(dove + ': zaino vuoto');
        zk.forEach(id => {
          const og = ctx.borsa && ctx.borsa[id];
          if (!og) e.push(dove + ': oggetto di zaino inesistente ' + id);
          else if (og.tipo !== 'consumabile' && og.tipo !== 'strumento') e.push(dove + ': ' + id + ' non è un oggetto di zaino');
          if (!(Number(c.zaino[id]) > 0)) e.push(dove + ': quantità non valida per ' + id);
        });
        const sl = ctx.tecAbSbloccate(b, 1, {});
        if ((c.tecniche || []).length !== sl.tec) e.push(dove + ': ' + (c.tecniche || []).length + ' tecniche invece di ' + sl.tec);
        if ((c.abilita || []).length !== sl.ab) e.push(dove + ': ' + (c.abilita || []).length + ' abilità invece di ' + sl.ab);
        const kind = (ids, tecnica) => (ids || []).forEach(id => {
          const cp = cat.capacita[id];
          if (!cp) e.push(dove + ': capacità inesistente ' + id);
          else if ((cp.categoria === 'tecnica') !== tecnica) e.push(dove + ': ' + cp.nome + ' è nella lista sbagliata');
        });
        kind(c.tecniche, true); kind(c.abilita, false);
        if (new Set([].concat(c.tecniche || [], c.abilita || [])).size !== (c.tecniche || []).length + (c.abilita || []).length) e.push(dove + ': capacità ripetute');
        // pool: copre gli slot fino a LIVELLO_POOL (con ogni scelta possibile dell'Eclettico)
        const max = { tec: 0, ab: 0 };
        ['1+1', '2tec', '2ab'].forEach(s => { const x = ctx.tecAbSbloccate(b, LIVELLO_POOL, { 8: s }); max.tec = Math.max(max.tec, x.tec); max.ab = Math.max(max.ab, x.ab); });
        if (!c.pool || (c.pool.tecniche || []).length < max.tec) e.push(dove + ': pool di tecniche ' + ((c.pool || {}).tecniche || []).length + ' < ' + max.tec + ' slot fino al Lv ' + LIVELLO_POOL);
        if (!c.pool || (c.pool.abilita || []).length < max.ab) e.push(dove + ': pool di abilità ' + ((c.pool || {}).abilita || []).length + ' < ' + max.ab + ' slot fino al Lv ' + LIVELLO_POOL);
        kind((c.pool || {}).tecniche, true); kind((c.pool || {}).abilita, false);
        (c.tecniche || []).forEach(id => { if ((c.pool.tecniche || []).indexOf(id) === -1) e.push(dove + ': ' + id + ' manca dal pool'); });
        (c.abilita || []).forEach(id => { if ((c.pool.abilita || []).indexOf(id) === -1) e.push(dove + ': ' + id + ' manca dal pool'); });
      });
      if (!ammesse) e.push(gid + ': nessuna classe ammessa');
    });
    return e;
  }

  global.RMSoloCatalogo = { CLASSI, LIVELLO_POOL, REGOLA_ARMI, gruppoDi, gruppoDaOntologia, classiDi, dotazione, esempi, prossime, equipDa, riepilogoProposte, valida };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloCatalogo;
})(typeof window !== 'undefined' ? window : globalThis);
