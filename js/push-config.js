/* Notifiche push: la build nativa contiene davvero la configurazione
   Firebase (google-services.json)? Audit Play Store, punto 4.

   Senza google-services.json l'APK si compila lo stesso (il template
   Capacitor applica il plugin google-services solo se il file esiste), ma
   PushNotifications.register() non può funzionare — e su Android può
   chiudere l'app. Il valore qui sotto è FAIL-CLOSED: false finché la
   pipeline non lo sovrascrive, SOLO quando il file è stato davvero scritto,
   con lo stesso schema di www/js/version.js (vedi "Stamp push config" in
   .github/workflows/build-apk.yml e stamp_push_build_config in
   scripts/lib/android-common.sh):

     echo "const PUSH_BUILD_READY = true;" > www/js/push-config.js

   Con false: nessuna richiesta di permesso, nessuna registrazione del
   token, e le Impostazioni dicono onestamente che questa build non include
   le notifiche push. */
const PUSH_BUILD_READY = false;
