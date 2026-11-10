/* Trame d'autore inserite nel gioco: per ciascuna, a quale mondo appartiene (ontologia, catalogo, voce) e la scheda mostrata nella
   schermata «Gioca in solitaria». È l'unico punto in cui il codice conosce l'elenco delle trame: il motore lavora su identificativi
   generici letti da qui (docs/single-player/TRAMA_NEL_GIOCO.md §1). */
(function (global) {
  'use strict';
  global.RMSoloMondi = {
    cenere: {
      mondo: 'eidos',
      info: { titolo: 'Eidos', avventura: 'Il filo di cenere', disponibile: true, pilota: true, nota: '"Il filo di cenere" — trama dell\'autore, Atto I (pilota), da approvare' }
    },
    figlia: {
      mondo: 'eidos',
      info: { titolo: 'Eidos', avventura: 'La figlia prediletta', disponibile: true, pilota: true, nota: '"La figlia prediletta" — trama dell\'autore (Eidos V2), in costruzione (pilota), da approvare' }
    },
    incubo: {
      mondo: 'eidos',
      info: { titolo: 'Eidos', avventura: 'L\'incubo', disponibile: true, pilota: true, nota: '"L\'incubo" — trama dell\'autore (Eidos V2), in costruzione (pilota), da approvare' }
    },
    cubo: {
      mondo: 'eidos',
      info: { titolo: 'Eidos', avventura: 'La chiave del cubo', disponibile: true, pilota: true, nota: '"La chiave del cubo" — trama dell\'autore (Roots of War, il passato di Eidos), in costruzione (pilota), da approvare' }
    },
    hersir: {
      mondo: 'ich',
      info: { titolo: 'Ich', avventura: 'L\'Hersir dei nodi', disponibile: true, pilota: true, nota: '"L\'Hersir dei nodi" — trama dell\'autore (Ich), in costruzione (pilota), da approvare' }
    },
    cavaliera: {
      mondo: 'ich',
      info: { titolo: 'Ich', avventura: 'La cavaliera di cenere', disponibile: true, pilota: true, nota: '"La cavaliera di cenere" — trama dell\'autore (Ich), in costruzione (pilota), da approvare' }
    },
    osservatrice: {
      mondo: 'ich',
      info: { titolo: 'Ich', avventura: 'L\'osservatrice dei fili', disponibile: true, pilota: true, nota: '"L\'osservatrice dei fili" — trama dell\'autore (Ich), in costruzione (pilota), da approvare' }
    },
    lupa: {
      mondo: 'ich',
      info: { titolo: 'Ich', avventura: 'La lupa senza memoria', disponibile: true, pilota: true, nota: '"La lupa senza memoria" — trama dell\'autore (Ich), in costruzione (pilota), da approvare' }
    },
    'seconda-possibilita': {
      mondo: 'icaro',
      info: { titolo: 'Icaro', avventura: 'La seconda possibilità', disponibile: true, in_revisione: true, nota: 'Primo atto: la storia continua con i prossimi aggiornamenti.' }
    },
    'nome-che-vendono': {
      mondo: 'icaro',
      info: { titolo: 'Icaro', avventura: 'Il nome che vendono', disponibile: true, in_revisione: true, nota: 'Primo atto: la storia continua con i prossimi aggiornamenti.' }
    },
    'luce-nelle-dalie': {
      mondo: 'icaro',
      info: { titolo: 'Icaro', avventura: 'La luce nelle dalie', disponibile: true, in_revisione: true, nota: 'Primo atto: la storia continua con i prossimi aggiornamenti.' }
    },
    'anima-corpo': {
      mondo: 'icaro',
      info: { titolo: 'Icaro', avventura: "L’anima che vuole un corpo", disponibile: true, in_revisione: true, nota: 'Primo atto: la storia continua con i prossimi aggiornamenti.' }
    }
  };
  // Tolte dal menu dall'autore l'8/11/2026 (prova della 1.0.352 su iPhone): «La figlia prediletta» e le quattro di Icaro (scritte
  // senza prosa). Come le avventure di prova: restano negli slot già giocati e in modalità sviluppatore (`pilota`, js/solo/solo-ui.js).
  // «L'Hersir dei nodi» resta (Knytta, confermata dall'autore). Visibilità e approvazione narrativa restano distinte.
  const TOLTE = ['figlia', 'seconda-possibilita', 'nome-che-vendono', 'luce-nelle-dalie', 'anima-corpo'];
  Object.keys(global.RMSoloMondi).forEach(k => { global.RMSoloMondi[k].info.pilota = TOLTE.indexOf(k) !== -1; });
})(typeof window !== 'undefined' ? window : globalThis);
