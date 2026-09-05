const CACHE_NAME = 'minimal-system-v98';
// Prefisso di TUTTE le cache di questa app, mai un nome libero: la pulizia in
// 'activate' deve toccare solo le versioni precedenti DI QUESTA app, mai le
// cache di un altro service worker/altro codice che condivide la stessa
// origine (es. un widget di terze parti) — keys.filter(k => k !== CACHE_NAME)
// cancellava indiscriminatamente QUALUNQUE cache non corrente, estranee
// comprese (revisione checkpoint "8 punti", terza revisione, punto 2).
const CACHE_PREFIX = 'minimal-system-v';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/intro.js',
  './js/brand.js',
  './js/version.js',
  './js/rules.js',
  './js/vendor/supabase.js',
  './js/supabase-client.js',
  './js/cloud-account.js',
  './js/cloud-character.js',
  './js/cloud-combat.js',
  './js/data.js',
  './js/app.js',
  './js/npc-randomizer.js',
  './js/pdfviewer.js',
  './js/vendor/pdf.min.mjs',
  './js/vendor/pdf.worker.min.mjs',
  './media/intro-role-makers.mp4',
  './media/intro-role-makers-poster.webp',
  './img/role-makers-cover-top.png',
  './img/role-makers-cover-payoff.png',
  './img/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-16.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* Punto 10 del checkpoint (seconda revisione): la Cache Storage API NON
   gestisce mai da sola le richieste Range (verificato: cache.match() su una
   richiesta con header Range restituisce sempre undefined, per qualunque
   browser — non è una scelta di questo service worker, è come funziona
   l'API) — senza questo, un <video> offline che chiede un intervallo di
   byte (come fa sempre per il buffering/seeking) riceve un fetch fallito
   ("Failed to fetch"), non l'intervallo richiesto: la riproduzione si
   interrompe alla primissima richiesta parziale. Qui si ricostruisce a
   mano la risposta 206 dalla copia integrale (200) già in cache, la stessa
   tecnica usata da librerie come workbox-range-requests. */
function parseRangeHeader(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start = m[1] === '' ? null : parseInt(m[1], 10);
  let end = m[2] === '' ? null : parseInt(m[2], 10);
  if (start === null) { start = size - end; end = size - 1; }
  else if (end === null || end >= size) end = size - 1;
  if (!(start >= 0) || !(end >= start)) return null;
  return { start, end };
}
async function matchWithRangeSupport(request) {
  // Il lookup è sempre per SOLO url: Range non fa mai parte della chiave di
  // cache (vedi sopra), va tolto di mezzo esplicitamente per trovare la
  // copia integrale già salvata da cache.addAll() in 'install'.
  const cached = await caches.match(request.url);
  if (!cached) return undefined;
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) return cached;
  const buf = await cached.clone().arrayBuffer();
  const range = parseRangeHeader(rangeHeader, buf.byteLength);
  if (!range) return cached; // header Range malformato/non soddisfacibile: la copia integrale resta una risposta valida
  const sliced = buf.slice(range.start, range.end + 1);
  const headers = new Headers(cached.headers);
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${buf.byteLength}`);
  headers.set('Content-Length', String(sliced.byteLength));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(sliced, { status: 206, statusText: 'Partial Content', headers });
}

/* Prima la rete, cache solo come riserva: online si vede sempre l'ultima
   versione pubblicata; offline si usa la copia salvata (con supporto Range
   esplicito, vedi sopra — indispensabile per il video). */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Mai mettere in cache una risposta 206 (parziale) al posto della
        // copia integrale già presente: sovrascriverebbe l'unica versione
        // da cui matchWithRangeSupport può ricostruire QUALUNQUE intervallo,
        // lasciandone solo uno.
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => matchWithRangeSupport(event.request))
  );
});
