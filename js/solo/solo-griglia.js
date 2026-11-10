/* ==========================================================================
   Role Makers — Gioca in solitaria — Griglia dello scontro (pezzi 2.6-2.8
   di docs/single-player/PIANO_QUATTRO_BINARI.md; i 5 punti sono approvati,
   DECISIONI_AUTORE §13).

   Modulo puro: nessun DOM, nessuna rete. Le funzioni degli esagoni NON sono
   riscritte: arrivano come parametro da js/app.js (hexOddQToCube,
   hexCubeDistance, hexCellCenter, hexCellPosition) con `crea(hex)`. Nel
   browser le passa questo file stesso, se app.js le ha già definite; i test
   Node le leggono dal testo di app.js in sola lettura.
   I numeri del movimento sono quelli di js/data.js
   (combatMovementHexesForBudget, COMBAT_MOVEMENT_MAX_QUARTI_PER_TURN).

   Regole:
   1. posizioni iniziali decise dal gioco (`iniziale`);
   2. i nemici si avvicinano fino a N caselle verso il protagonista, con N
      dal loro budget di movimento (`avvicina`);
   3. movimento + azione nello stesso round, col solo limite dei quarti di
      movimento per turno (`muovi`);
   4. nessun ostacolo e nessuna linea di tiro;
   5. casella vicina: corpo a corpo solo a 1 casella, a distanza senza
      limite (trascritta dalle migrazioni Supabase: declare_combat_attack in
      20260909000000_combat_trajectory_los.sql e
      combat_validate_target_geometry in 20260910000000: è «a distanza» solo
      l'attacco con attackTrait 'Mira', qui `stat: 'mira'`; ogni altro
      attacco è corpo a corpo e vuole hex_cube_distance <= 1).
   ========================================================================== */
(function (global) {
  'use strict';

  // stessa misura predefinita della mappa online (js/app.js: map_grid_cols || 8, map_grid_rows || 6)
  const COLONNE = 8, RIGHE = 6;
  // il protagonista parte sul lato sinistro; chi combatte in mischia a 2 caselle (con un passo è adiacente),
  // chi sta a distanza a 4 (punto 1: posizioni decise dal gioco)
  const PG_INIZIO = { col: 1, row: 2 };
  const DISTANZA_INIZIO = { mischia: 2, distanza: 4 };
  const MSG_NON_ADIACENTE = 'Bersaglio non adiacente: questa è un\'azione corpo a corpo.';

  function maxQuarti() { return typeof COMBAT_MOVEMENT_MAX_QUARTI_PER_TURN !== 'undefined' ? COMBAT_MOVEMENT_MAX_QUARTI_PER_TURN : 2; }

  function crea(hex) {
    const dist = (a, b) => hex.hexCubeDistance(hex.hexOddQToCube(a.col, a.row), hex.hexOddQToCube(b.col, b.row));
    const dentro = (g, c) => c && Number.isInteger(c.col) && Number.isInteger(c.row) && c.col >= 0 && c.row >= 0 && c.col < g.cols && c.row < g.rows;
    const caselle = g => { const out = []; for (let col = 0; col < g.cols; col++) for (let row = 0; row < g.rows; row++) out.push({ col, row }); return out; };
    const uguali = (a, b) => a.col === b.col && a.row === b.row;
    // posizione di chi combatte ('pg' o uid dell'avversario; 'nemico' nello scontro singolo)
    const pos = (g, uid) => (uid === 'pg' ? g.pg : (g.pos || {})[uid]) || null;
    // caselle occupate da chi è ancora in campo (chi esce libera la sua)
    const occupata = (g, c, attivi) => uguali(g.pg, c) || Object.keys(g.pos || {}).some(u => (!attivi || attivi.indexOf(u) !== -1) && uguali(g.pos[u], c));

    /* Punto 1. unita: [{ uid, posizione: 'mischia'|'distanza' }]. Per ciascuna la casella libera più vicina alla
       distanza voluta, poi la più vicina alla riga del protagonista; a parità la colonna più a destra (deterministico). */
    function iniziale(unita) {
      const g = { cols: COLONNE, rows: RIGHE, pg: Object.assign({}, PG_INIZIO), pos: {}, mosso: { round: 0, quarti: 0 } };
      (unita || []).forEach(u => {
        const voluta = DISTANZA_INIZIO[u.posizione] || DISTANZA_INIZIO.mischia;
        const libere = caselle(g).filter(c => !occupata(g, c));
        libere.sort((a, b) => Math.abs(dist(a, g.pg) - voluta) - Math.abs(dist(b, g.pg) - voluta) || Math.abs(a.row - g.pg.row) - Math.abs(b.row - g.pg.row) || b.col - a.col || a.row - b.row);
        if (libere[0]) g.pos[u.uid] = libere[0];
      });
      return g;
    }

    function distanza(g, da, a) { const p = pos(g, da), q = pos(g, a); return p && q ? dist(p, q) : null; }
    function aDistanza(azione) { return !!azione && azione.stat === 'mira'; }

    /* Punto 5. Messaggio di rifiuto, o null se l'attacco si può fare. Come nel database: senza le due posizioni
       registrate il controllo è saltato per intero, mai un blocco su dati che non esistono. */
    function portata(g, da, a, azione) {
      if (!g || aDistanza(azione)) return null;
      const d = distanza(g, da, a);
      return d != null && d > 1 ? MSG_NON_ADIACENTE : null;
    }

    // caselle che `vel` può ancora percorrere in questo round (punto 3: solo il tetto dei quarti di movimento)
    function caselleDisponibili(g, vel, round) {
      const spesi = g.mosso && g.mosso.round === round ? g.mosso.quarti : 0;
      return combatMovementHexesForBudget(vel, Math.max(0, maxQuarti() - spesi));
    }

    /* Punto 3. Spostamento del protagonista: { errore } oppure { da, a, caselle, quarti }. Non consuma l'azione. */
    function muovi(g, verso, vel, round, attivi) {
      if (!dentro(g, verso)) return { errore: 'Quella casella non è sul campo.' };
      if (occupata(g, verso, attivi)) return { errore: uguali(g.pg, verso) ? 'Sei già lì.' : 'Quella casella è occupata.' };
      const n = dist(g.pg, verso);
      const max = caselleDisponibili(g, vel, round);
      if (n > max) return { errore: max ? 'Troppo lontano: in questo round puoi spostarti ancora di ' + max + (max === 1 ? ' casella.' : ' caselle.') : 'In questo round non puoi più spostarti.' };
      const quarti = n * combatMovementCostPerHex(vel);
      const prima = g.mosso && g.mosso.round === round ? g.mosso.quarti : 0;
      const da = g.pg;
      g.pg = { col: verso.col, row: verso.row };
      g.mosso = { round, quarti: prima + quarti };
      return { da, a: g.pg, caselle: n, quarti };
    }

    /* Punto 2. `uid` si avvicina fino a N caselle verso `bersaglio` ('pg' di solito), fermandosi appena è adiacente;
       N = caselle del suo budget di movimento per turno. Un passo alla volta sulla casella libera che accorcia di più. */
    function avvicina(g, uid, bersaglio, vel, attivi) {
      const meta = pos(g, bersaglio), start = pos(g, uid);
      if (!meta || !start) return 0;
      let cur = start, passi = 0;
      const n = combatMovementHexesForBudget(vel, maxQuarti());
      while (passi < n && dist(cur, meta) > 1) {
        const cand = caselle(g).filter(c => dist(c, cur) === 1 && !occupata(g, c, attivi));
        cand.sort((a, b) => dist(a, meta) - dist(b, meta) || a.col - b.col || a.row - b.row);
        if (!cand[0] || dist(cand[0], meta) >= dist(cur, meta)) break;
        cur = cand[0]; g.pos[uid] = cur; passi += 1;
      }
      return passi;
    }

    /* Spinta (decisione dell'autore del 7/11/2026, DECISIONI §15 G.4): `uid` arretra di 1 casella, sulla casella libera vicina che
       lo allontana di più da `da`; nessuna casella libera: resta dov'è. Restituisce le caselle percorse (0 o 1). */
    function allontana(g, uid, da, attivi) {
      const start = pos(g, uid), lontano = pos(g, da);
      if (!start || !lontano) return 0;
      const cand = caselle(g).filter(c => dist(c, start) === 1 && !occupata(g, c, attivi) && dist(c, lontano) > dist(start, lontano));
      cand.sort((a, b) => dist(b, lontano) - dist(a, lontano) || a.col - b.col || a.row - b.row);
      if (!cand[0]) return 0;
      g.pos[uid] = { col: cand[0].col, row: cand[0].row };
      return 1;
    }

    /* Per il disegno: centro di ogni casella con le funzioni di app.js (cellH = cellW · √3/2, esagono regolare «flat-top»). */
    function geometria(g, cellW) {
      const cellH = cellW * Math.sqrt(3) / 2;
      const celle = caselle(g).map(c => Object.assign({}, c, hex.hexCellCenter(c.col, c.row, cellW, cellH)));
      return { cellW, cellH, larghezza: (g.cols - 1) * cellW * 0.75 + cellW, altezza: g.rows * cellH + cellH / 2, celle };
    }

    return { iniziale, tra: dist, distanza, aDistanza, portata, caselleDisponibili, muovi, avvicina, allontana, geometria, pos, MSG_NON_ADIACENTE };
  }

  const api = { crea, attiva: null };
  // nel browser app.js è già caricato (index.html): la griglia si accende con le sue funzioni
  if (typeof global.hexCubeDistance === 'function' && typeof global.hexOddQToCube === 'function' && typeof global.hexCellCenter === 'function') {
    api.attiva = crea({ hexOddQToCube: global.hexOddQToCube, hexCubeDistance: global.hexCubeDistance, hexCellCenter: global.hexCellCenter, hexCellPosition: global.hexCellPosition });
  }
  global.RMSoloGriglia = api;
})(typeof window !== 'undefined' ? window : globalThis);
