/* ==========================================================================
   Role Makers — Anteprima visuale chat (chat_revision_v1, checkpoint C1)
   Mostra la nuova direzione grafica della chat SENZA collegarla ancora ai
   dati reali (C1 è "chat visuale": mockup con dati di prova, come T1 per
   il Tomo — il collegamento a rm_chat_messages/Supabase arriva a C2/C3,
   dopo approvazione). Nessuna chiamata di rete, nessuna scrittura,
   nessuna lettura di conversazioni reali: solo un array locale di
   messaggi di esempio, per mostrare l'identità visiva di:
   - messaggio proprio vs altrui in una chat di campagna;
   - messaggio del Narratore (emblema campagna + "Narratore", mai
     nickname/avatar personali in quel contesto);
   - una card di evento di gioco (tiro), nel formato di notazione reale
     già usato dal motore di combattimento (vedi submitCombatAttackRolls
     in js/cloud-combat.js: "d20:14 +Mira 8" ecc. — non è una logica di
     tiro nuova, solo la stessa notazione applicata a un messaggio);
   - la chat generale tra contatti, senza alcuna icona (solo nickname).
   Reachable SOLO con chat_revision_v1 attivo (voce di menu nascosta a
   flag spento — vedi wiring sotto), attraverso #view-chatpreview: a
   flag spento questo file non altera nulla della chat reale esistente
   (js/cloud-chat.js, invariato). */

var CHAT_PREVIEW_SEED = {
  campaign: {
    name: 'Le Cripte di Val Selvaggia',
    // emblema di prova generato via canvas (nessuna immagine reale/di
    // terzi), stesso principio del fallback ritratto del Tomo (T1.1).
    initial: 'C'
  },
  messages: [
    {
      kind: 'player',
      mine: false,
      nickname: 'Bram_il_Ferreo',
      characterName: 'Bram Dolvane',
      color: '#FF7A33',
      presence: 'online',
      time: '20:41',
      body: 'Io entro per primo, tengo lo scudo alto.'
    },
    {
      kind: 'narrator',
      time: '20:42',
      body: 'La porta cigola. Dentro, un odore di muffa e qualcosa che si muove nel buio.'
    },
    {
      kind: 'player',
      mine: true,
      nickname: 'Tu',
      characterName: 'Aurelia Ferro',
      color: '#33D6E8',
      presence: 'online',
      time: '20:43',
      body: 'Preparo una torcia prima di avanzare.'
    },
    {
      kind: 'roll',
      time: '20:44',
      nickname: 'Bram_il_Ferreo',
      characterName: 'Bram Dolvane',
      color: '#FF7A33',
      label: 'Tiro di Mira',
      detail: 'd20:14 +Mira 8',
      total: 22,
      outcome: 'success',
      outcomeLabel: 'Successo'
    },
    {
      kind: 'player',
      mine: false,
      nickname: 'Meridia_Onda',
      characterName: 'Meridia Sol',
      color: '#33D6E8',
      presence: 'away',
      time: '20:45',
      body: 'Copro Bram con uno scudo magico, giusto in caso.'
    }
  ],
  contactsMessages: [
    { mine: false, nickname: 'Kesh_92', time: 'ieri 18:02', body: 'Ci vediamo alla prossima sessione?' },
    { mine: true, nickname: 'Tu', time: 'ieri 18:05', body: 'Sì, sabato alle 21 come sempre.' },
    { mine: false, nickname: 'Kesh_92', time: 'ieri 18:05', body: 'Perfetto, porto anche Meridia.' }
  ]
};

function chatPreviewAvatarHtml(seedMsg) {
  var initial = (seedMsg.characterName || seedMsg.nickname || '?').trim().charAt(0).toUpperCase();
  return '<div class="chatp-avatar" style="border-color:' + seedMsg.color + ';background:linear-gradient(160deg, rgba(255,255,255,.06), rgba(0,0,0,.25));">' +
    '<span>' + escapeHtml(initial) + '</span>' +
    '<span class="chatp-presence chatp-presence-' + (seedMsg.presence || 'offline') + '" aria-hidden="true"></span>' +
  '</div>';
}

function chatPreviewNarratorEmblemHtml() {
  return '<div class="chatp-avatar chatp-avatar-narrator">' +
    '<span>' + escapeHtml(CHAT_PREVIEW_SEED.campaign.initial) + '</span>' +
  '</div>';
}

function chatPreviewMessageHtml(m) {
  if (m.kind === 'narrator') {
    return '<div class="chatp-row chatp-row-narrator">' +
      chatPreviewNarratorEmblemHtml() +
      '<div class="chatp-bubble chatp-bubble-narrator">' +
        '<div class="chatp-head"><span class="chatp-badge-narrator">Narratore</span><span class="chatp-time">' + escapeHtml(m.time) + '</span></div>' +
        '<p class="chatp-body">' + escapeHtml(m.body) + '</p>' +
      '</div>' +
    '</div>';
  }
  if (m.kind === 'roll') {
    return '<div class="chatp-row">' +
      chatPreviewAvatarHtml(m) +
      '<div class="chatp-roll-card">' +
        '<div class="chatp-head"><span class="chatp-nickname" style="color:' + m.color + ';">' + escapeHtml(m.nickname) + '</span><span class="chatp-time">' + escapeHtml(m.time) + '</span></div>' +
        '<div class="chatp-roll-main">' +
          '<span class="chatp-roll-label">' + escapeHtml(m.label) + '</span>' +
          '<span class="chatp-roll-total">' + escapeHtml(String(m.total)) + '</span>' +
        '</div>' +
        '<div class="chatp-roll-detail">' + escapeHtml(m.detail) + '</div>' +
        '<div class="chatp-roll-outcome chatp-roll-outcome-' + m.outcome + '">' + escapeHtml(m.outcomeLabel) + '</div>' +
      '</div>' +
    '</div>';
  }
  var mineClass = m.mine ? ' chatp-row-mine' : '';
  var bubbleClass = m.mine ? 'chatp-bubble chatp-bubble-mine' : 'chatp-bubble';
  return '<div class="chatp-row' + mineClass + '">' +
    (m.mine ? '' : chatPreviewAvatarHtml(m)) +
    '<div class="' + bubbleClass + '" style="' + (m.mine ? '' : 'border-left-color:' + m.color + ';') + '">' +
      '<div class="chatp-head"><span class="chatp-nickname" style="color:' + (m.mine ? 'var(--magico-forte)' : m.color) + ';">' + escapeHtml(m.nickname) + '</span><span class="chatp-time">' + escapeHtml(m.time) + '</span></div>' +
      '<p class="chatp-body">' + escapeHtml(m.body) + '</p>' +
    '</div>' +
    (m.mine ? chatPreviewAvatarHtml(m) : '') +
  '</div>';
}

/* Chat generale tra contatti (T1 requisiti chat, §"Chat generale tra
   contatti"): nessuna icona, solo nickname — impaginazione adattata
   all'assenza dell'avatar (bolla a larghezza piena, nessuno spazio
   riservato a sinistra). */
function chatPreviewContactMessageHtml(m) {
  var mineClass = m.mine ? ' chatp-row-mine' : '';
  var bubbleClass = m.mine ? 'chatp-bubble chatp-bubble-mine chatp-bubble-noicon' : 'chatp-bubble chatp-bubble-noicon';
  return '<div class="chatp-row chatp-row-noicon' + mineClass + '">' +
    '<div class="' + bubbleClass + '">' +
      '<div class="chatp-head"><span class="chatp-nickname" style="color:' + (m.mine ? 'var(--magico-forte)' : 'var(--testo-secondario-dark-2)') + ';">' + escapeHtml(m.nickname) + '</span><span class="chatp-time">' + escapeHtml(m.time) + '</span></div>' +
      '<p class="chatp-body">' + escapeHtml(m.body) + '</p>' +
    '</div>' +
  '</div>';
}

function renderChatPreview() {
  var campaignList = $('#chatp-campaign-list');
  var contactsList = $('#chatp-contacts-list');
  var title = $('#chatp-campaign-title');
  if (title) title.textContent = CHAT_PREVIEW_SEED.campaign.name;
  if (campaignList) campaignList.innerHTML = CHAT_PREVIEW_SEED.messages.map(chatPreviewMessageHtml).join('');
  if (contactsList) contactsList.innerHTML = CHAT_PREVIEW_SEED.contactsMessages.map(chatPreviewContactMessageHtml).join('');
}

// Nota (checkpoint C2): la voce di menu #cm-item-chatpreview è ora di
// competenza di js/cloud-contacts-chat.js (punta alla vista reale
// "Conversazioni", che supera questo mockup statico) — un secondo
// handler DOMContentLoaded qui che la manipolasse dipenderebbe in modo
// implicito e fragile dall'ordine di caricamento degli script. Questo
// mockup resta comunque raggiungibile per riferimento/rigenerazione
// screenshot via console: showView('chatpreview'); renderChatPreview();
