/* ==========================================================================
   Role Makers — Gioca in solitaria: regole pure del motore locale.

   Nessun DOM, nessuna rete, nessuno stato globale mutabile: solo funzioni
   che ricevono dati e un generatore di dadi e restituiscono esiti. Le
   formule sono quelle già in uso nell'app, non una seconda economia:
   - prova su un tratto: 1d20 + valore del tratto contro il Numero Chiave
     (1 naturale = fallimento critico, 20 naturale = successo critico, senza
     bonus; niente «successo parziale»; NC, di norma 12 — js/rules.js, "Prove sulle Capacità e Conoscenze";
     stesso tiro del tool "Tiro tratto" in js/app.js);
   - prova senza competenza: d100 − 20, superata da 50 in su (d100 ≥ 70),
     critica sotto 20 (d100 < 40), nessun bonus (js/rules.js, "Esperienza/Inesperienza");
   - attacco: per colpire d20 + Arte Combattiva, danno = danno base + dado
     scalato sulla statistica (diceForValue) + statistica
     (combatComputeAttackRoll in js/app.js);
   - difesa: riduzione automatica di Difesa, schivata/blocco contro il tiro
     per colpire (blocco riuscito → 1/4), controllo critico di Resistenza
     se la difesa fallisce (submit_attack_defense_roll, migrazione
     20260825000000_defense_rework.sql).
   Tutto ciò che qui NON deriva dall'app (modificatori di difficoltà,
   scalatura dei nemici) è dichiarato in SOLO_TUNING
   come valore provvisorio da approvare.

   Dipende dalle costanti globali di js/data.js (diceForValue, LEVEL_TABLE,
   BUILDS, abilitaCostoForLv, hpApCostForPoint, primaryApCostForPoint):
   caricato dopo data.js sia nel browser sia nei test Node (vm).
   ========================================================================== */
(function (global) {
  'use strict';

  /* Valori di taratura del prototipo. NON approvati: servono a rendere
     giocabile la prova e sono raccolti qui per poterli rivedere in un
     punto solo (vedi docs/single-player/DECISIONI_APERTE.md). */
  const SOLO_TUNING = Object.freeze({
    stato: 'provvisorio',
    ncBase: 12,
    // modificatore al Numero Chiave per difficoltà
    ncDifficolta: { esplorativa: -2, bilanciata: 0, permadeath: 1 },
    // livello dei nemici ordinari rispetto al protagonista, per difficoltà
    // (decisione dell'autore, 2026-10-17: un livello sopra in bilanciata; la differenza fra difficoltà resta di ±1)
    livelloNemici: { esplorativa: 0, bilanciata: 1, permadeath: 2 },
    // boss e sfide principali (scontro finale e nemici con «boss: true»): due livelli sopra in bilanciata
    livelloBoss: { esplorativa: 1, bilanciata: 2, permadeath: 3 },
    // bonus massimo che un oggetto pertinente può dare a una prova
    bonusOggetto: 2,
    // qualità dell'approccio proposta dall'interprete: -2..+2 al tiro
    qualitaApproccio: { debole: -2, normale: 0, forte: 2 },
    // Raven: livello del protagonista + 2 fino al 28 (regola approvata)
    ravenOffset: 2,
    ravenLivelloSpeciale: 29,
    // gemme dei Chorisfos: MP recuperati scaricando una gemma, in
    // percentuale degli MP massimi. L'app non ha una regola unica di
    // arrotondamento per le percentuali (K.O. per eccesso, durabilità al
    // più vicino): qui si arrotonda per difetto.
    gemme: Object.freeze({ recuperoMpPercentuale: 20, arrotondamento: 'difetto' }),
    // scontri uno contro uno: il danno dei nemici si scala sugli HP massimi
    // del protagonista rispetto a un riferimento (per un Mago da 18 HP un
    // Morso non vale quanto per un Guerriero da 80), mai sotto il minimo;
    // per eccesso, almeno 1 se il colpo va a segno. Provvisorio.
    dannoNemico: Object.freeze({ hpRiferimento: 60, fattoreMinimo: 0.45 }),
    // equipaggiamento difensivo (protagonista e nemici). Il manuale somma la DIF
    // dell'armatura alla Difesa nella riduzione automatica; la scala (× 0,25,
    // al massimo +6) è ARMOR_DIF_SCALE di js/data.js, la stessa del gioco
    // online (decisione dell'autore del 7/11/2026, DECISIONI_AUTORE §15 I.4f).
    // Lo scudo abilita il Blocco e ne somma la DIF al tiro (manuale:
    // «Blocco, 1d20 + Guardia, con scudo»).
    equipDifensivo: ARMOR_DIF_SCALE
  });

  const DIFFICOLTA = Object.freeze(['esplorativa', 'bilanciata', 'permadeath']);

  /* ------------------------------------------------------------ dadi */

  /* Generatore di dadi registrato: ogni tiro finisce in `log` con la sua
     etichetta, così l'esito di un comando si può mostrare, salvare e — se
     la narrazione fallisce — riusare tale e quale invece di ritirare.
     `source` restituisce un numero in [0,1): Math.random nel gioco,
     una sequenza fissa nei test. */
  function makeDice(source) {
    const next = typeof source === 'function' ? source : Math.random;
    const log = [];
    function roll(sides, label) {
      const v = 1 + Math.floor(next() * sides);
      log.push({ label: label || ('d' + sides), sides, value: v });
      return v;
    }
    return { roll, log };
  }

  /* Dadi di prova per i test: le facce uscite sono prese in ordine. */
  function makeScriptedDice(faces) {
    const queue = faces.slice();
    const log = [];
    function roll(sides, label) {
      if (!queue.length) throw new Error('Dadi di prova esauriti (' + (label || 'd' + sides) + ')');
      const v = Math.max(1, Math.min(sides, Math.round(queue.shift())));
      log.push({ label: label || ('d' + sides), sides, value: v });
      return v;
    }
    return { roll, log };
  }

  function rollValueDie(dice, value, label) {
    const d = diceForValue(Number(value) || 0);
    if (d === 'd12+d8') return dice.roll(12, label + ' (d12)') + dice.roll(8, label + ' (d8)');
    return dice.roll(Number(d.slice(1)), label + ' (' + d + ')');
  }

  /* ----------------------------------------------------------- scheda */

  function traitValue(sheet, name) {
    if (!sheet || !sheet.traits || !name) return null;
    const lists = ['conoscenze', 'capacitaNormali', 'capacitaCombattive'];
    for (const l of lists) {
      const v = sheet.traits[l] && sheet.traits[l][name];
      if (v != null && Number(v) > 0) return { list: l, value: Number(v) };
    }
    return null;
  }

  function ncFor(nc, difficolta) {
    const base = Number.isFinite(Number(nc)) ? Number(nc) : SOLO_TUNING.ncBase;
    return base + (SOLO_TUNING.ncDifficolta[difficolta] || 0);
  }

  /* Prova su un tratto (o senza competenza). `mod` è la somma dei soli
     modificatori già convalidati dal motore (oggetto pertinente, qualità
     dell'approccio): mai un numero scritto dall'IA o dal giocatore. */
  function resolveCheck(opts) {
    const dice = opts.dice;
    const nc = ncFor(opts.nc, opts.difficolta);
    const mod = Math.max(-4, Math.min(4, Number(opts.mod) || 0));
    const tv = traitValue(opts.sheet, opts.trait);
    if (!tv) {
      // Esperienza/Inesperienza: d100 − 20, successo da 50 in su; il manuale non dà bonus: `mod` non si applica.
      const d = dice.roll(100, 'Prova senza competenza (d100)');
      const total = d - 20;
      const esito = total >= 50 ? 'successo' : (total < 20 ? 'fallimento_critico' : 'fallimento');
      return { tipo: 'inesperto', trait: opts.trait || null, d100: d, total, soglia: 50, mod: 0, esito };
    }
    const d20 = dice.roll(20, 'Prova (d20 + ' + opts.trait + ')');
    const total = d20 + tv.value + mod;
    // 1 e 20 naturali decidono prima di ogni bonus e dell'NC; 18–19 con totale riuscito = successo pieno (manuale)
    let esito;
    if (d20 === 1) esito = 'fallimento_critico';
    else if (d20 === 20) esito = 'successo_critico';
    else if (total >= nc) esito = (d20 >= 18) ? 'successo_pieno' : 'successo';
    else esito = 'fallimento';
    return { tipo: 'tratto', trait: opts.trait, traitValue: tv.value, d20, mod, total, nc, esito };
  }

  function isSuccess(esito) { return esito === 'successo' || esito === 'successo_pieno' || esito === 'successo_critico'; }

  /* ------------------------------------------------------ combattimento */

  function statOf(c, key) { return Number(c && c.primary && c.primary[key]) || 0; }

  /* Un attacco completo tra due combattenti "piatti" (vedi toCombatant).
     `action` = { kind: 'arma' | 'tecab', dannoBase, stat, costoMp }.
     Regola delle difese del combattimento online (supabase/migrations/
     20260825000000_defense_rework.sql; js/rules.js): riduzione automatica
     di Difesa sempre; schivata riuscita → 0; blocco riuscito → 1/4; difesa
     fallita → controllo critico d20 + Resistenza contro il «per colpire»,
     ×2 se perso; nessuna difesa → ×2. Corretta il 6/11/2026 su
     autorizzazione dell'autore (prima: salvezza che dimezzava). */
  function resolveAttack(dice, attacker, target, action, difesa) {
    // Arte Combattiva per le armi e le capacità ordinarie; le azioni di Arkè (Eidos) tirano il tratto «Arkè»
    const nomeAtk = action.tratto || 'Arte Combattiva';
    const traitAtk = (attacker.traits && attacker.traits[nomeAtk]) || 0;
    const d20 = dice.roll(20, 'Per colpire (d20 + ' + nomeAtk + ')');
    // precisione (Destrezza, stati) e difese speciali calcolate dal motore
    const hitTotal = d20 + traitAtk + (Number(action.bonusColpire) || 0);
    const statKey = action.stat || 'for';
    const statVal = statOf(attacker, statKey);
    const dmgDie = rollValueDie(dice, statVal, 'Danno');
    const dmg = (Number(action.dannoBase) || 0) + dmgDie + statVal;
    // riduzione automatica, sempre: tiro puro (dado + valore) di Difesa, o di Difesa Mentale contro gli attacchi di Forza Magica
    // (combatAutoReductionRoll in js/app.js); `bonusRiduzione` = armatura e stati di supporto, come nell'app
    const redKey = statKey === 'fmen' ? 'dmen' : 'dif';
    const redVal = statOf(target, redKey) + (Number((target.bonusRiduzione || {})[redKey]) || 0);
    const redDie = redVal > 0 ? rollValueDie(dice, redVal, 'Riduzione (' + (redKey === 'dif' ? 'Difesa' : 'Difesa Mentale') + ')') : 0;
    const reduction = { stat: redKey, roll: redDie, total: redVal > 0 ? redDie + redVal : 0 };
    let after = Math.max(0, dmg - reduction.total), defense = null, crit = null;
    if (difesa === 'dodge' || difesa === 'block') {
      const tName = difesa === 'dodge' ? 'Elusione' : 'Guardia';
      const tv = (target.traits && target.traits[tName]) || 0;
      const dr = dice.roll(20, (difesa === 'dodge' ? 'Schivata' : 'Blocco') + ' (d20 + ' + tName + ')');
      // il Blocco somma la Difesa dello scudo (combatRollDefense in js/app.js)
      const total = dr + tv + (difesa === 'block' ? (Number(target.bonusBlocco) || 0) : 0);
      const ok = total >= hitTotal;
      defense = { type: difesa, roll: dr, total, success: ok };
      if (ok) after = difesa === 'dodge' ? 0 : Math.round(after / 4);
      else {
        // difesa fallita: controllo critico d20 + Resistenza contro il «per colpire»; se l'attaccante lo supera, danno ×2
        const rv = (target.traits && target.traits['Resistenza']) || 0;
        const cr = dice.roll(20, 'Controllo critico (d20 + Resistenza)');
        crit = { roll: cr, total: cr + rv, critico: hitTotal > cr + rv };
        if (crit.critico) after *= 2;
      }
    } else {
      // nessuna difesa: critico automatico
      crit = { automatico: true, critico: true };
      after *= 2;
    }
    return { hitRoll: d20, hitTotal, damageRoll: dmg, reduction, defense, crit, finalDamage: after };
  }

  /* Riduce una scheda (formato app, vedi newCharacter in js/app.js) al
     minimo che serve al combattimento locale. */
  function toCombatant(sheet, extra) {
    const t = {};
    ['capacitaCombattive', 'capacitaNormali', 'conoscenze'].forEach(l => {
      Object.keys((sheet.traits && sheet.traits[l]) || {}).forEach(k => { t[k] = Number(sheet.traits[l][k]) || 0; });
    });
    return Object.assign({
      id: sheet.id || null,
      nome: sheet.nome || '',
      livello: Number(sheet.livello) || 1,
      primary: Object.assign({}, sheet.primary || {}),
      traits: t,
      hpMax: Number(sheet.hpMaxTracked) || 0,
      hp: sheet.hpCur != null ? Number(sheet.hpCur) : (Number(sheet.hpMaxTracked) || 0),
      mp: sheet.mpCur != null ? Number(sheet.mpCur) : (Number(sheet.mpMaxTracked) || 0)
    }, extra || {});
  }

  /* Budget AP accumulato dal Lv 2 al livello dato: stessa somma di
     npcTotalApBudget (js/npc-randomizer.js), ma senza il tetto al Lv 20
     di quel generatore — Raven e i nemici del solitario arrivano al 30. */
  function apBudgetForLevel(level) {
    let total = 0;
    for (let l = 2; l <= level; l++) {
      const r = LEVEL_TABLE.find(x => x.lv === l);
      if (r) total += r.ap;
    }
    return total;
  }

  /* Combattente scalato per livello a partire da un modello di Lv 1
     (40 punti primari già distribuiti, tratti, danno base). La crescita
     spende il budget AP con le funzioni di costo ufficiali, a turno sulle
     statistiche del modello: stessa idea di npcSpendApGrowth, in forma
     deterministica (niente casualità: due caricamenti danno lo stesso
     avversario). */
  function scaledCombatant(template, level) {
    const lv = Math.max(1, Math.min(30, Math.round(level)));
    const prim = Object.assign({}, template.primary);
    const build = BUILDS[template.build || 'guerriero'];
    const hpMult = build.hpMult || 7, mpMult = build.mpMult || 5;
    let hpMax = prim.hp * hpMult, mpMax = prim.mp * mpMult;
    let budget = apBudgetForLevel(lv);
    const order = template.crescita || ['hp', 'for', 'dif', 'vel', 'dex'];
    // A turno sulle statistiche del modello; si ferma quando un giro
    // intero non riesce più a comprare nulla col budget residuo.
    let bought = true;
    while (budget > 0 && bought) {
      bought = false;
      for (const k of order) {
        if (k === 'hp') {
          const cost = hpApCostForPoint(hpMax + 1) * 5;
          if (cost <= budget) { hpMax += 5; budget -= cost; bought = true; }
        } else {
          const cost = primaryApCostForPoint((prim[k] || 0) + 1);
          if (cost <= budget) { prim[k] = (prim[k] || 0) + 1; budget -= cost; bought = true; }
        }
      }
    }
    const traits = {};
    Object.keys(template.traits || {}).forEach(k => {
      traits[k] = (Number(template.traits[k]) || 0) + Math.floor((lv - 1) / 3);
    });
    return {
      id: template.id, nome: template.nome, livello: lv, primary: prim, traits,
      hpMax, hp: hpMax, mp: mpMax,
      attacco: Object.assign({}, template.attacco)
    };
  }

  /* Raven: configurazione dal livello del protagonista (specifica V3 §8).
     PG 1–28: livello PG + 2, incontro con tentativo di uccisione.
     PG 29–30: HP/MP 9999, tutte le altre statistiche 99, precedenza
     assoluta — qui marcata `inevitabile`, così il motore applica una
     transizione speciale invece di un combattimento con iniziativa alta. */
  function ravenConfig(pgLevel, template) {
    const lv = Math.max(1, Math.min(30, Math.round(pgLevel)));
    if (lv >= SOLO_TUNING.ravenLivelloSpeciale) {
      const prim = {};
      ['for', 'mira', 'vel', 'fmen', 'dex', 'dif', 'dmen'].forEach(k => { prim[k] = 99; });
      const traits = {};
      Object.keys(template.traits || {}).forEach(k => { traits[k] = 99; });
      return {
        id: 'raven', nome: 'Raven', livello: null, speciale: true, inevitabile: true,
        primary: Object.assign(prim, { hp: 9999, mp: 9999 }), traits,
        hpMax: 9999, hp: 9999, mp: 9999, attacco: Object.assign({}, template.attacco)
      };
    }
    const c = scaledCombatant(template, lv + SOLO_TUNING.ravenOffset);
    c.id = 'raven'; c.nome = 'Raven'; c.speciale = false; c.inevitabile = false;
    return c;
  }

  const api = {
    SOLO_TUNING, DIFFICOLTA, makeDice, makeScriptedDice,
    traitValue, ncFor, resolveCheck, isSuccess, resolveAttack, toCombatant,
    apBudgetForLevel, scaledCombatant, ravenConfig, rollValueDie
  };
  global.RMSoloRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
