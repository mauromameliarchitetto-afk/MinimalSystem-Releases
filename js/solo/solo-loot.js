/* ==========================================================================
   Role Makers — Gioca in solitaria: borsa del Narratore IA e loot.

   La borsa è una riserva di contenuti DELLA PARTITA, separata
   dall'inventario del giocatore e dalla borsa delle campagne multiplayer.
   Un oggetto può esistere nella borsa senza essere visibile o assegnato.

   Stati di un'istanza: collocato -> scoperto -> raccolto -> consumato | perso.
   ("disponibile" è il modello nel catalogo, non ancora istanziato.)
   La scoperta non è la raccolta; solo la raccolta sposta l'istanza
   nell'inventario, con un'operazione idempotente.

   Pipeline (pacchetto avventure §6):
   1. il motore conferma l'evento che dà diritto al premio (chiave evento);
   2. seleziona i modelli compatibili (difficoltà, atto, livello, luogo,
      fazione, contesto, unicità, requisiti di classe);
   3. estrae un modello e lo compone da base + materiale + proprietà;
   4. valida potenza (statistiche dentro EQUIP_TABLE di js/data.js),
      budget delle proprietà, incompatibilità, unicità;
   5. registra l'istanza con id, origine e stato;
   6. al narratore arriva solo ciò che il personaggio percepisce;
   7. raccolta o consegna: trasferimento atomico e idempotente.
   Le statistiche vengono SEMPRE dalle regole (equipRange); nome e
   descrizione dal modello approvato. Nessun bonus casuale fuori budget.
   Un premio escluso da tutti i filtri produce un esito "nessuno", mai un
   oggetto inventato. Gli oggetti di trama non escono da estrazioni casuali.
   ========================================================================== */
(function (global) {
  'use strict';

  const STATI = Object.freeze(['collocato', 'scoperto', 'raccolto', 'consumato', 'perso']);
  const CATEGORIE = Object.freeze(['arma', 'scudo', 'armatura', 'consumabile', 'materiale', 'generico', 'oggetto_chiave', 'indizio', 'documento', 'valuta', 'strumento']);
  const FAMIGLIE = Object.freeze(['ordinario', 'personale', 'trama']);
  const EQUIP = { arma: true, scudo: true, armatura: true };
  // taglie scritte negli archetipi -> chiavi di EQUIP_TABLE
  const TAGLIA = { leggera: 'leggere', media: 'medie', pesante: 'pesanti', corta: 'corte', corte: 'corte', medie: 'medie', grandi: 'grandi', leggere: 'leggere', pesanti: 'pesanti', piccoli: 'piccoli', medi: 'medi' };

  class LootError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  function inRange(v, r) { return Array.isArray(r) && v >= r[0] && v <= r[1]; }

  /* Statistiche di un pezzo di equipaggiamento dentro la tabella
     ufficiale (EQUIP_TABLE via equipRange di js/data.js). */
  function checkEquipStats(tipo, taglia, qualita, s) {
    const r = equipRange(tipo, TAGLIA[taglia] || taglia, qualita);
    if (!r) return ['combinazione ' + tipo + '/' + taglia + '/' + qualita + ' assente dalla tabella ufficiale'];
    const err = [];
    if (s.atk != null && !inRange(s.atk, r.atk)) err.push('ATK ' + s.atk + ' fuori da ' + r.atk.join('–'));
    if (s.dif != null && !inRange(s.dif, r.dif)) err.push('DIF ' + s.dif + ' fuori da ' + r.dif.join('–'));
    if (s.durabilita != null && !inRange(s.durabilita, r.dur)) err.push('Durabilità ' + s.durabilita + ' fuori da ' + r.dur.join('–'));
    return err;
  }

  /* ------------------------------------------------ validazione catalogo */

  function validateCatalog(loot) {
    const e = [];
    if (!loot) return e;
    const C = loot.componenti || {};
    const basi = C.basi || {}, mat = C.materiali || {}, prop = C.proprieta || {};
    Object.entries(basi).forEach(([id, b]) => {
      if (CATEGORIE.indexOf(b.categoria) === -1) e.push('base ' + id + ': categoria non valida');
      if (EQUIP[b.categoria] && !equipRange(b.categoria, TAGLIA[b.taglia] || b.taglia, b.qualita)) e.push('base ' + id + ': taglia/qualità assenti dalla tabella ufficiale (' + b.taglia + '/' + b.qualita + ')');
    });
    Object.entries(prop).forEach(([id, p]) => {
      if (!(p.costo > 0)) e.push('proprietà ' + id + ': costo mancante');
      (p.incompatibili || []).forEach(x => { if (!prop[x]) e.push('proprietà ' + id + ': incompatibile con inesistente ' + x); });
    });
    Object.entries(loot.modelli || {}).forEach(([id, t]) => {
      if (FAMIGLIE.indexOf(t.famiglia) === -1) e.push('modello ' + id + ': famiglia non valida');
      (t.basi || []).forEach(b => { if (!basi[b]) e.push('modello ' + id + ': base inesistente ' + b); });
      (t.materiali || []).forEach(m => { if (!mat[m]) e.push('modello ' + id + ': materiale inesistente ' + m); });
      (t.proprieta || []).forEach(p => { if (!prop[p]) e.push('modello ' + id + ': proprietà inesistente ' + p); });
      if (!(t.basi || []).length) e.push('modello ' + id + ': nessuna base');
    });
    Object.entries(loot.pool || {}).forEach(([id, p]) => {
      (p.modelli || []).forEach(m => {
        const t = (loot.modelli || {})[m];
        if (!t) e.push('pool ' + id + ': modello inesistente ' + m);
        else if (t.famiglia === 'trama') e.push('pool ' + id + ': il modello di trama ' + m + ' non può uscire da un\'estrazione');
      });
    });
    return e;
  }

  /* ------------------------------------------------------- selezione */

  function passesFilters(t, ctx) {
    const f = t.filtri || {};
    const has = (arr, v) => !arr || !arr.length || arr.indexOf(v) !== -1;
    if (!has(f.difficolta, ctx.difficolta)) return false;
    if (!has(f.atto, ctx.atto)) return false;
    if (f.livello && (ctx.livello < f.livello[0] || ctx.livello > f.livello[1])) return false;
    if (!has(f.luogo, ctx.luogo)) return false;
    if (!has(f.fazione, ctx.fazione)) return false;
    if (!has(f.contesto, ctx.contesto)) return false;
    if (t.requisiti && t.requisiti.classe && t.requisiti.classe.indexOf(ctx.classe) === -1) return false;
    return true;
  }

  function eligibleTemplates(loot, poolId, ctx, generatedUnique) {
    const pool = (loot.pool || {})[poolId];
    if (!pool) throw new LootError('pool', 'Pool inesistente: ' + poolId);
    return (pool.modelli || []).filter(id => {
      const t = loot.modelli[id];
      // modelli disattivati in attesa di approvazione: mai generati
      if (!t || t.famiglia === 'trama' || t.disattivato) return false;
      if (t.unico && generatedUnique[id]) return false;
      // coerenza con la fonte (es. l'avversario sconfitto): modelli esclusi
      if (ctx.escludi && ctx.escludi.indexOf(id) !== -1) return false;
      return passesFilters(t, ctx);
    });
  }

  function pick(dice, arr, label) { return arr[dice.roll(arr.length, label) - 1]; }

  /* Composizione: base, materiale compatibile con la qualità della base,
     proprietà entro il budget del modello e senza incompatibilità. */
  function compose(loot, templateId, dice) {
    const t = loot.modelli[templateId];
    const C = loot.componenti;
    const baseId = pick(dice, t.basi, 'Loot: base');
    const base = C.basi[baseId];
    const mats = (t.materiali || []).filter(m => { const q = C.materiali[m].qualita; return !q || q.indexOf(base.qualita) !== -1; });
    const matId = mats.length ? pick(dice, mats, 'Loot: materiale') : null;
    const chosen = [];
    let budget = Number(t.budget) || 0;
    const candidates = (t.proprieta || []).slice();
    const maxP = Math.min(Number(t.max_proprieta) || 0, candidates.length);
    for (let i = 0; i < maxP && candidates.length; i++) {
      const id = pick(dice, candidates, 'Loot: proprietà');
      candidates.splice(candidates.indexOf(id), 1);
      const p = C.proprieta[id];
      if (p.costo > budget) continue;
      if (chosen.some(c => (C.proprieta[c].incompatibili || []).indexOf(id) !== -1 || (p.incompatibili || []).indexOf(c) !== -1)) continue;
      if (p.categorie && p.categorie.indexOf(base.categoria) === -1) continue;
      chosen.push(id); budget -= p.costo;
    }
    const stats = {};
    if (EQUIP[base.categoria]) {
      const r = equipRange(base.categoria, TAGLIA[base.taglia] || base.taglia, base.qualita);
      const inR = (rg, label) => rg[0] + dice.roll(rg[1] - rg[0] + 1, label) - 1;
      stats.atk = inR(r.atk, 'Loot: ATK');
      stats.dif = inR(r.dif, 'Loot: DIF');
      stats.durabilita = inR(r.dur, 'Loot: Durabilità');
    }
    const mat = matId ? C.materiali[matId] : null;
    const nome = String(t.nome_modello || base.nome).replace('{base}', base.nome).replace('{materiale}', mat ? mat.nome : '').replace(/\s+/g, ' ').trim();
    return {
      modello: templateId, versioneCatalogo: loot.versione, famiglia: t.famiglia, categoria: base.categoria,
      base: baseId, materiale: matId, proprieta: chosen, statistiche: stats,
      taglia: base.taglia || null, qualita: base.qualita || null,
      nome, descrizione: t.descrizione || base.descrizione || '',
      descrizioneIdentificata: t.descrizione_identificata || null,
      daIdentificare: t.visibilita === 'da_identificare',
      effetto: base.effetto || null, unico: !!t.unico, tag: (base.tag || []).slice(), classe: base.classe || null
    };
  }

  function validateInstance(loot, inst) {
    const e = [];
    const t = loot.modelli[inst.modello];
    if (!t) return ['modello inesistente'];
    if (EQUIP[inst.categoria]) e.push.apply(e, checkEquipStats(inst.categoria, inst.taglia, inst.qualita, inst.statistiche));
    const C = loot.componenti;
    const cost = inst.proprieta.reduce((a, p) => a + C.proprieta[p].costo, 0);
    if (cost > (Number(t.budget) || 0)) e.push('proprietà oltre il budget');
    inst.proprieta.forEach(p => (C.proprieta[p].incompatibili || []).forEach(x => { if (inst.proprieta.indexOf(x) !== -1) e.push('proprietà incompatibili ' + p + '/' + x); }));
    return e;
  }

  /* ------------------------------------------------- borsa della partita */

  function ensureBag(state) {
    if (!state.borsa) state.borsa = { seq: 0, istanze: {}, premi: {}, unici: {} };
    return state.borsa;
  }

  /* Genera (una sola volta per chiave evento) e colloca nella borsa. */
  function generateReward(state, loot, req, dice, applied) {
    const bag = ensureBag(state);
    if (bag.premi[req.chiave]) return bag.premi[req.chiave];
    const ctx = Object.assign({ difficolta: state.difficolta, atto: state.atto, livello: state.personaggio.livello, classe: state.personaggio.build, fazione: state.personaggio.popolazione }, req.contesto || {});
    const eligible = eligibleTemplates(loot, req.pool, ctx, bag.unici);
    const pool = loot.pool[req.pool];
    const qta = req.quantita != null ? req.quantita : (pool.quantita && pool.quantita[state.difficolta]) != null ? pool.quantita[state.difficolta] : 1;
    const out = { chiave: req.chiave, pool: req.pool, istanze: [], esito: 'nessuno', motivo: null };
    if (!eligible.length || qta <= 0) {
      out.motivo = !eligible.length ? 'nessun modello compatibile con i filtri' : 'quantità zero per questa difficoltà';
      bag.premi[req.chiave] = out;
      applied.push({ tipo: 'loot_nessuno', pool: req.pool, motivo: out.motivo });
      return out;
    }
    for (let i = 0; i < qta; i++) {
      const list = eligibleTemplates(loot, req.pool, ctx, bag.unici);
      if (!list.length) break;
      const inst = compose(loot, pick(dice, list, 'Loot: modello'), dice);
      const errs = validateInstance(loot, inst);
      if (errs.length) { out.motivo = 'istanza scartata: ' + errs.join('; '); continue; }
      bag.seq += 1;
      inst.id = 'ist-' + bag.seq;
      inst.origine = { chiave: req.chiave, scena: state.scena, atto: state.atto, evento: req.evento || null, unita: req.unita || null };
      inst.stato = req.visibile === false ? 'collocato' : 'scoperto';
      // a portata di mano (es. sul nemico sconfitto): resta raccoglibile
      // anche se la scena cambia nello stesso istante; altrimenti è legata
      // al luogo in cui è stata collocata
      inst.scena = req.aPortata ? null : state.scena;
      bag.istanze[inst.id] = inst;
      if (inst.unico) bag.unici[inst.modello] = inst.id;
      out.istanze.push(inst.id);
      applied.push({ tipo: inst.stato === 'scoperto' ? 'loot_scoperto' : 'loot_collocato', istanza: inst.id, nome: inst.nome });
    }
    out.esito = out.istanze.length ? 'generato' : 'nessuno';
    bag.premi[req.chiave] = out;
    return out;
  }

  function discoverInstance(state, id, applied) {
    const inst = ensureBag(state).istanze[id];
    if (!inst || inst.stato !== 'collocato') return false;
    inst.stato = 'scoperto';
    applied.push({ tipo: 'loot_scoperto', istanza: id, nome: inst.nome });
    return true;
  }

  /* Raccolta: solo un'istanza scoperta nella scena corrente. Idempotente:
     un'istanza già raccolta non entra due volte nell'inventario. */
  function pickUp(state, id, applied) {
    const inst = ensureBag(state).istanze[id];
    if (!inst) throw new LootError('istanza', 'Oggetto inesistente');
    if (inst.stato === 'raccolto') return false;
    if (inst.stato !== 'scoperto') throw new LootError('stato', 'Non hai ancora trovato questo oggetto');
    if (inst.scena && inst.scena !== state.scena) throw new LootError('scena', 'L\'oggetto non è qui');
    inst.stato = 'raccolto';
    state.inventario.push({ id, qty: 1, istanza: true });
    applied.push({ tipo: 'ricompensa', oggetto: id, nome: inst.nome, qty: 1, istanza: true });
    return true;
  }

  function consume(state, id, applied) {
    const inst = ensureBag(state).istanze[id];
    const inv = state.inventario.find(i => i.id === id);
    if (!inst || inst.stato !== 'raccolto' || !inv) throw new LootError('stato', 'Oggetto non disponibile');
    inst.stato = 'consumato';
    state.inventario.splice(state.inventario.indexOf(inv), 1);
    applied.push({ tipo: 'consumato', oggetto: id, nome: inst.nome });
    return inst.effetto || null;
  }

  /* Ciò che il personaggio può percepire di un'istanza (per narratore,
     diario, esportazione): niente segreti, niente stato interno. */
  function perceivable(inst) {
    return { id: inst.id, nome: inst.nome, categoria: inst.categoria,
      descrizione: inst.daIdentificare && inst.stato !== 'raccolto' ? inst.descrizione : (inst.descrizioneIdentificata || inst.descrizione),
      statistiche: inst.stato === 'raccolto' ? inst.statistiche : undefined };
  }

  global.RMSoloLoot = { STATI, CATEGORIE, FAMIGLIE, LootError, validateCatalog, checkEquipStats, eligibleTemplates, compose, validateInstance, generateReward, discoverInstance, pickUp, consume, perceivable, ensureBag, TAGLIA };
})(typeof window !== 'undefined' ? window : globalThis);
