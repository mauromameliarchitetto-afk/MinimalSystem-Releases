/* Regola d'inizio partita delle trame d'autore (docs/single-player/TRAMA_NEL_GIOCO.md §3).
   La partita non comincia mai in un punto senza contesto: l'apertura dice chi è il personaggio, perché si trova lì e che cosa vuole;
   il primo PNG incontrato è legato al suo obiettivo (chi lo aspetta, chi lo ostacola, chi gli serve); la prima scena chiede una scelta
   legata a quell'obiettivo. I testi sono scritti prima dall'autore: per i personaggi pronti c'è la loro apertura, per «Crea il tuo» il
   motore sceglie fra le varianti per obiettivo (e ruolo/popolo), mai l'IA. Solo contenuto: nessuna regola di gioco. */
(function (global) {
  'use strict';

  const LEGAMI = ['aspetta', 'ostacola', 'serve'];

  /* Variante per un personaggio: il pronto ha la sua; il creato prende la prima variante che corrisponde (l'ultima è il ripiego). */
  function scegli(content, pg) {
    const ap = content && content.apertura;
    if (!ap || !pg) return null;
    const mk = (id, v) => ({
      id, premessa: Object.assign({}, v.premessa), primoPng: v.primoPng || ap.primoPng, legame: v.legame, legameTesto: v.legameTesto || v.legame_testo || ''
    });
    const pronto = (ap.pronti || {})[pg.archetipo];
    if (pronto) return mk(pg.archetipo, pronto);
    const ob = pg.obiettivoPersonale && pg.obiettivoPersonale.tipo;
    const ruolo = pg.ontologia && pg.ontologia.roleId;
    const popolo = pg.ontologia && (pg.ontologia.peopleId || pg.ontologia.socialClassId);
    const ok = (lista, val) => !lista || !lista.length || lista.indexOf(val) !== -1;
    const v = (ap.varianti || []).find(x => ok((x.per || {}).obiettivi, ob) && ok((x.per || {}).ruoli, ruolo) && ok((x.per || {}).popoli, popolo));
    return v ? mk(v.id, v) : null;
  }

  /* Testo d'apertura della prima scena: premessa (chi, perché, che cosa vuole), il legame con il primo PNG, poi l'apertura della scena. */
  function testo(state, content, scenaTesto) {
    const a = state && state.apertura;
    if (!a) return scenaTesto || '';
    const p = a.premessa;
    const nome = (state.personaggio && state.personaggio.nome) || '';
    // una frase della premessa o del legame che ripete l'apertura della scena si omette: resta la prosa d'autore della scena
    // (prova della Cavaliera, A02: risveglio e ombra raccontati due volte di seguito)
    const QU = global.RMSoloEngine && global.RMSoloEngine.frasiQuasiUguali;
    const ripete = f => !!(f && scenaTesto && QU && QU(f + ' ' + scenaTesto).some(c => c.a === f || c.b === f));
    const pre = [p.chi, ripete(p.perche) ? '' : p.perche, p.vuole].filter(Boolean).join(' ').replace(/\{nome\}/g, nome);
    const lega = ripete(a.legameTesto) ? '' : (a.legameTesto || '');
    return [pre, lega].filter(Boolean).join(' ') + (scenaTesto ? '\n\n' + scenaTesto : '');
  }

  /* Controllo del contenuto di una trama (usato dai test): ogni apertura completa, il primo PNG presente nella prima scena. */
  function valida(content) {
    const E = [];
    const ap = content.apertura;
    if (!ap) return ['apertura mancante: ogni trama d\'autore la dichiara'];
    const prima = content.scene[0];
    const una = (id, v) => {
      ['chi', 'perche', 'vuole'].forEach(k => { if (!v.premessa || !String(v.premessa[k] || '').trim()) E.push('apertura ' + id + ': premessa.' + k + ' mancante'); });
      const png = v.primoPng || ap.primoPng;
      if (!png || !content.png[png]) E.push('apertura ' + id + ': primo PNG inesistente');
      else if ((prima.png_presenti || []).indexOf(png) === -1) E.push('apertura ' + id + ': il primo PNG ' + png + ' non è nella prima scena');
      if (LEGAMI.indexOf(v.legame) === -1) E.push('apertura ' + id + ': legame con l\'obiettivo non valido (' + v.legame + ')');
      if (!String(v.legameTesto || v.legame_testo || '').trim()) E.push('apertura ' + id + ': testo del legame mancante');
    };
    Object.keys(ap.pronti || {}).forEach(id => una(id, ap.pronti[id]));
    const vs = ap.varianti || [];
    vs.forEach(v => una(v.id, v));
    if (!vs.length) E.push('apertura: servono varianti per «Crea il tuo»');
    else if (vs[vs.length - 1].per && Object.keys(vs[vs.length - 1].per).length) E.push('apertura: l\'ultima variante deve essere il ripiego (per: {})');
    // la prima scena chiede una scelta legata all'obiettivo: un obiettivo con suggerimenti e lo stake personale dichiarato
    if (!(prima.obiettivi || []).length || !(prima.suggerimenti || []).length) E.push('prima scena: serve un obiettivo con almeno una scelta');
    if (!prima.personalStake || !(prima.characterNeedHooks || []).length) E.push('prima scena: personalStake e characterNeedHooks devono essere dichiarati');
    return E;
  }

  global.RMSoloApertura = { scegli, testo, valida, LEGAMI };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.RMSoloApertura;
})(typeof window !== 'undefined' ? window : globalThis);
