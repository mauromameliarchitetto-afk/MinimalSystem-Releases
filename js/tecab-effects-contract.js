/* Timed Tecniche/Abilita primary-stat effects.
 * Server rows are authoritative: when remaining_quarters reaches zero the
 * row disappears, so the modifier is removed without touching base stats.
 */
(function () {
  'use strict';
  if (typeof window.buffTotal !== 'function' || typeof window.combatEffectsForChar !== 'function') return;
  const baseBuffTotal = window.buffTotal;
  window.combatPrimaryEffectTotal = function (characterId, statKey) {
    return window.combatEffectsForChar(characterId)
      .filter(e => Number(e && e.remaining_quarters) > 0 && e.buff_target === statKey)
      .reduce((sum, e) => sum + (Number(e.buff_amount) || 0), 0);
  };
  window.buffTotal = function (character, statKey) {
    const characterId = character && character.cloudCharacterId || '';
    return baseBuffTotal(character, statKey) + window.combatPrimaryEffectTotal(characterId, statKey);
  };
})();
