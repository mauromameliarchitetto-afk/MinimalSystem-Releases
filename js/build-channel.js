/* Canale di distribuzione della build corrente — Fase 5 del piano di
   pubblicazione store ("mantieni separati web, sideload legacy, Play e
   App Store mediante configurazioni/flavor/scheme espliciti").

   Valore di default per lo sviluppo locale e per la pipeline attuale
   (build-apk.yml, ancora unica): 'sideload' — stesso comportamento di
   sempre, updater OTA e controllo release GitHub attivi. Quando la
   pipeline verrà separata per canale (Fase 13), il job Play/App Store
   sovrascriverà questo file con lo stesso pattern già in uso per
   www/js/version.js (vedi "Stamp app version" in build-apk.yml):

     echo "const BUILD_CHANNEL = 'play';" > www/js/build-channel.js

   Valori validi: 'web' | 'sideload' | 'play' | 'appstore'. Il codice che
   legge questa costante (isStoreChannel() sotto, usata da js/app.js per
   disattivare l'updater OTA e il controllo release GitHub) deve trattare
   qualunque valore non riconosciuto come 'sideload' (fail-safe: meglio un
   controllo aggiornamenti in più nel dubbio che un self-update silenzioso
   in una build Play/App Store, dove è vietato dalle policy store). */
const BUILD_CHANNEL = 'sideload';

/* true per Play/App Store: nessun updater OTA, nessun controllo release
   GitHub, nessun download APK — quelle funzionalità restano SOLO nel
   canale sideload/PWA (vedi checkForUpdate/otaPlugin, js/app.js). */
function isStoreChannel() {
  return BUILD_CHANNEL === 'play' || BUILD_CHANNEL === 'appstore';
}
