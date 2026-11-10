/* Role Makers — Gioca in solitaria: genere del personaggio.

   Il genere è un DATO ANAGRAFICO della scheda («maschile», «femminile», «neutro»), non una regola di gioco:
   serve solo a scrivere nel modo giusto i testi che parlano del protagonista in seconda persona
   («Sei arrivato» / «Sei arrivata»). Qui c'è solo logica pura (nessun DOM, testabile in Node).

   Segnaposto nei testi fissi: {forma maschile|forma femminile|forma neutra}. La forma neutra evita il genere
   con un'altra formulazione («Arrivi», «Ce l'hai fatta»). Un testo senza segnaposto non cambia.
   Una scheda senza genere (partite e personaggi salvati prima di questo campo) vale «neutro»:
   mai una forma maschile attribuita per difetto. */
(function (global) {
  'use strict';

  const GENERI = ['maschile', 'femminile', 'neutro'];
  const ETICHETTE = { maschile: 'Maschile', femminile: 'Femminile', neutro: 'Neutro' };
  const SEGNAPOSTO = /\{([^{}|]*)\|([^{}|]*)\|([^{}|]*)\}/g;
  // {nome}: il nome del protagonista nelle battute dei PNG (con «Crea il tuo» è quello scelto dal giocatore)
  const NOME = /\{nome\}/g;

  /* Genere valido, altrimenti «neutro». */
  function normalizza(g) { return GENERI.indexOf(g) !== -1 ? g : 'neutro'; }

  /* Sceglie la forma giusta in un testo con segnaposto; {nome} diventa il nome, se è noto. */
  function applica(testo, genere, nome) {
    if (typeof testo !== 'string' || testo.indexOf('{') === -1) return testo;
    const i = GENERI.indexOf(normalizza(genere));
    const t = testo.replace(SEGNAPOSTO, (m, a, b, c) => [a, b, c][i]);
    return nome ? t.replace(NOME, () => nome) : t;
  }

  /* True se il testo ha ancora un segnaposto non risolto. */
  function haSegnaposto(testo) { SEGNAPOSTO.lastIndex = 0; NOME.lastIndex = 0; const s = String(testo || ''); const r = SEGNAPOSTO.test(s) || NOME.test(s); SEGNAPOSTO.lastIndex = 0; NOME.lastIndex = 0; return r; }

  /* Vista dei dati di una storia con i segnaposto già risolti: un Proxy che legge i dati originali e restituisce
     le stringhe col genere applicato (una sola vista per oggetto e genere, così l'identità degli oggetti resta
     stabile). Non è una copia: ciò che cambia nei dati originali si vede subito. Se il contenuto non ha
     segnaposto torna lo stesso oggetto. */
  // una mappa di viste per ogni coppia genere + nome
  const viste = new Map();
  function vista(v, g, n) {
    if (typeof v === 'string') return applica(v, g, n);
    if (!v || typeof v !== 'object') return v;
    const chiave = g + '|' + (n || '');
    if (!viste.has(chiave)) viste.set(chiave, new WeakMap());
    let p = viste.get(chiave).get(v);
    if (!p) {
      p = new Proxy(v, { get: (t, k, r) => vista(Reflect.get(t, k, r), g, n) });
      viste.get(chiave).set(v, p);
    }
    return p;
  }
  const hanno = new WeakMap();
  function contenuto(content, genere, nome) {
    if (!content || typeof content !== 'object') return content;
    let ha = hanno.get(content);
    if (ha === undefined) { ha = haSegnaposto(JSON.stringify(content)); hanno.set(content, ha); }
    return ha ? vista(content, normalizza(genere), nome || null) : content;
  }

  /* Istruzione per il Narratore (modello): come concordare i testi. */
  function istruzione(genere) {
    const g = normalizza(genere);
    if (g === 'femminile') return 'GENERE DEL PROTAGONISTA: femminile. Rivolgiti a lei al femminile (arrivata, pronta, sola…). Mai forme maschili riferite a lei.';
    if (g === 'maschile') return 'GENERE DEL PROTAGONISTA: maschile. Rivolgiti a lui al maschile (arrivato, pronto, solo…).';
    return 'GENERE DEL PROTAGONISTA: non specificato. Evita forme che esprimono il genere (niente arrivato/arrivata, pronto/pronta): usa verbi al presente e costruzioni neutre.';
  }

  global.RMSoloGenere = { GENERI, ETICHETTE, normalizza, applica, haSegnaposto, contenuto, istruzione };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloGenere;
})(typeof window !== 'undefined' ? window : globalThis);
