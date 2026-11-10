/* Munizioni e ricarica delle armi a distanza: regole condivise da scheda,
   combattimento online (specchio della migrazione 20261105090000), solitaria,
   Randomixer e creazione guidata.

   Dal manuale (js/rules.js, «Equipaggiamento» e «Combattimento»):
   - le munizioni sono oggetti a «Uso Rapido» (la freccia nella faretra);
   - le armi a distanza hanno Gittata (G) e Tempo di ricarica (Tr), definiti arma per arma;
   - il Round dura 5 secondi: nel codice è diviso in 4 quarti, quindi 1 quarto = 1,25 s.
   Decisioni dell'autore (4/11/2026):
   - ogni arma ha capacità (colpi caricati) e Tr propri; arco e balestra 1, pistole e fucili secondo il modello;
   - colpi pronti nell'arma e riserva nell'inventario; ricaricare sposta munizioni compatibili
     dalla riserva all'arma, anche se non bastano a riempirla;
   - sparare consuma i colpi pronti anche se il colpo manca; senza colpi sufficienti l'azione
     è rifiutata senza consumare nulla (un attacco ridotto è una scelta del giocatore);
   - con Tr = 0 il caricamento è automatico, ma servono munizioni in riserva;
   - le capacità consumano solo se dichiarano di sparare (sparaColpi), mai per la sola Mira;
   - annullamento di un'azione non risolta: le munizioni tornano una volta, senza superare la capacità;
   - a fine scontro nulla torna da sé. */
(function (global) {
  'use strict';

  const SECONDI_PER_QUARTO = 1.25;
  const EFFETTO = 'munizione';

  const intero = v => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x > 0 ? x : 0; };
  const tipo = t => String(t || '').trim().toLowerCase();
  const aDistanza = w => !!w && (w.weaponClass === 'tiro' || w.classe === 'tiro');
  const usa = w => aDistanza(w) && intero(w.capacita) > 0;
  const caricate = w => Math.min(intero(w.caricate), intero(w.capacita));

  function riserva(w, righe) {
    const t = tipo(w && w.munizione);
    return t ? (righe || []).filter(r => r && r.effetto === EFFETTO && tipo(r.munizione) === t) : [];
  }
  const riservaTot = (w, righe) => riserva(w, righe).reduce((s, r) => s + intero(r.quantita), 0);

  function quartiRicarica(w) {
    const s = Number(w && w.trSec) || 0;
    return s > 0 ? Math.round(s / SECONDI_PER_QUARTO * 1000) / 1000 : 0;
  }

  function preleva(w, righe, quanti) {
    let resto = quanti;
    for (const r of riserva(w, righe)) {
      const p = Math.min(intero(r.quantita), resto);
      r.quantita = intero(r.quantita) - p;
      resto -= p;
      if (!resto) break;
    }
    return quanti - resto;
  }

  function ricarica(w, righe) {
    if (!usa(w)) return { ok: false, motivo: 'Quest\'arma non usa munizioni.' };
    const spazio = intero(w.capacita) - caricate(w);
    if (spazio <= 0) return { ok: false, motivo: 'L\'arma è già carica.' };
    const disp = riservaTot(w, righe);
    if (!disp) return { ok: false, motivo: 'Nessuna munizione compatibile (' + (w.munizione || 'tipo non indicato') + ') nella riserva.' };
    const t = preleva(w, righe, Math.min(spazio, disp));
    w.caricate = caricate(w) + t;
    return { ok: true, trasferite: t, caricate: w.caricate, capacita: intero(w.capacita), riserva: riservaTot(w, righe), quarti: quartiRicarica(w) };
  }

  /* Consuma `colpi` colpi pronti; con Tr = 0 prima carica in automatico dalla riserva.
     Se non bastano non cambia nulla (nemmeno il caricamento automatico). */
  function spara(w, righe, colpi) {
    const k = colpi == null ? 1 : intero(colpi);
    if (!usa(w) || !k) return { ok: true, consumate: 0 };
    const auto = quartiRicarica(w) === 0 ? Math.min(intero(w.capacita) - caricate(w), riservaTot(w, righe)) : 0;
    if (caricate(w) + auto < k) {
      return { ok: false, motivo: 'Colpi pronti ' + caricate(w) + ', ne servono ' + k + ': ricarica o scegli meno bersagli.', caricate: caricate(w), riserva: riservaTot(w, righe) };
    }
    if (caricate(w) < k) w.caricate = caricate(w) + preleva(w, righe, auto);
    w.caricate = caricate(w) - k;
    return { ok: true, consumate: k, caricate: w.caricate, riserva: riservaTot(w, righe) };
  }

  /* Rimborso: nell'arma fino alla capacità, il resto in riserva (riga nuova se manca). */
  function restituisci(w, righe, quanti, nuovaRiga) {
    const q = intero(quanti);
    if (!usa(w) || !q) return { arma: 0, riserva: 0 };
    const inArma = Math.min(q, intero(w.capacita) - caricate(w));
    w.caricate = caricate(w) + inArma;
    const resto = q - inArma;
    if (resto) {
      const r = riserva(w, righe)[0];
      if (r) r.quantita = intero(r.quantita) + resto;
      else if (righe) righe.push(Object.assign(nuovaRiga ? nuovaRiga() : {}, { nome: w.munizione, effetto: EFFETTO, munizione: w.munizione, quantita: resto }));
    }
    return { arma: inArma, riserva: resto };
  }

  /* Colpi di una Tecnica/Abilità: solo se la riga dichiara di sparare (sparaColpi).
     Per bersaglio salvo «per azione» (un proiettile ad area o perforante) o un'area (raggioHex). */
  function colpiCapacita(row, nBersagli) {
    const k = intero(row && row.sparaColpi);
    if (!k) return 0;
    const perAzione = row.colpiPer === 'azione' || Number(row.raggioHex) > 0;
    return perAzione ? k : k * Math.max(1, intero(nBersagli) || 1);
  }

  /* L'arma con cui spara una capacità: la prima a distanza equipaggiata, usabile e con munizioni. */
  function armaPerCapacita(armi) {
    return (armi || []).find(w => usa(w) && w.statsConfirmed !== false && w.equipaggiato !== false && !(w.durCur != null && Number(w.durCur) <= 0)) || null;
  }

  function etichetta(w, righe) {
    if (!usa(w)) return '';
    const tr = Number(w.trSec) || 0;
    return 'Colpi pronti ' + caricate(w) + '/' + intero(w.capacita) + ' · Riserva ' + riservaTot(w, righe) +
      (tr ? ' · Ricarica ' + String(tr).replace('.', ',') + ' s' : ' · ricarica automatica');
  }

  /* PROPOSTA DA APPROVARE: profili di capacità, Tr e munizione per tipo d'arma. Il manuale non dà
     valori di Tr (cercato in js/rules.js «Equipaggiamento» e «Combattimento»); arco e balestra a
     capacità 1 sono decisione dell'autore. Usati solo dove serve un valore di partenza (guida,
     Randomixer): ogni scheda resta modificabile. */
  const PROFILI_PROPOSTI = [
    // armi dei cataloghi delle storie, prima dei tipi generici (descrizioni dei cataloghi)
    { chiave: 'fucile a impulsi', re: /fucile a impulsi/i, munizione: "carica d'essenza", capacita: 5, trSec: 2.5 },
    { chiave: 'pistola elettrificata', re: /pistola elettrificata/i, munizione: 'dardo carico', capacita: 6, trSec: 2.5 },
    { chiave: 'helkiss', re: /helkiss/i, munizione: 'dardo di spine', capacita: 1, trSec: 1.25 },
    { chiave: 'arco', re: /\b(arco|boga)\b/i, munizione: 'freccia', capacita: 1, trSec: 0 },
    { chiave: 'balestra', re: /balestra/i, munizione: 'dardo da balestra', capacita: 1, trSec: 2.5 },
    { chiave: 'cerbottana', re: /cerbottana/i, munizione: 'dardo da cerbottana', capacita: 1, trSec: 1.25 },
    { chiave: 'fionda', re: /fionda/i, munizione: 'pietra', capacita: 1, trSec: 0 },
    { chiave: 'pistola', re: /pistola/i, munizione: 'proiettile da pistola', capacita: 6, trSec: 2.5 },
    { chiave: 'fucile', re: /fucile/i, munizione: 'proiettile da fucile', capacita: 5, trSec: 2.5 }
  ];
  const profiloPer = nome => PROFILI_PROPOSTI.find(p => p.re.test(String(nome || ''))) || null;

  /* Applica un profilo a un'arma che non ha ancora dati di munizioni (non sovrascrive mai). */
  function applicaProfilo(w, profilo, piena) {
    if (!w || !profilo || intero(w.capacita) > 0) return false;
    Object.assign(w, { munizione: profilo.munizione, capacita: profilo.capacita, trSec: profilo.trSec, caricate: piena === false ? 0 : profilo.capacita });
    return true;
  }

  const api = {
    SECONDI_PER_QUARTO, EFFETTO, PROFILI_PROPOSTI,
    aDistanza, usa, caricate, riserva, riservaTot, quartiRicarica,
    ricarica, spara, restituisci, colpiCapacita, armaPerCapacita, etichetta, profiloPer, applicaProfilo
  };
  global.RMMunizioni = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
