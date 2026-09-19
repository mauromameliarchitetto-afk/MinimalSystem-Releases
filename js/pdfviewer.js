/* ==========================================================================
   Role Makers — Companion App
   Visualizzatore PDF in-app per le premesse di gioco (niente uscita
   dall'app, niente viewer di sistema). Durante la lettura: blocco
   screenshot reale su Android (via window.MSSetScreenshotBlock, definito
   in app.js) e, ovunque, una filigrana con l'identità di chi legge come
   deterrente — sul web non esiste modo di impedire davvero uno screenshot.
   ========================================================================== */

import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

let currentDoc = null;

function watermarkDataUri(label) {
  const esc = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="150">
    <text x="0" y="90" transform="rotate(-28 140 75)" font-family="sans-serif" font-size="14" fill="rgba(120,120,120,0.38)">${esc}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function open({ dataUrl, bytes, title, label }) {
  const overlay = document.getElementById('pdf-viewer');
  const pagesEl = document.getElementById('pdf-viewer-pages');
  const wmEl = document.getElementById('pdf-viewer-watermark');
  const titleEl = document.getElementById('pdf-viewer-title');
  const statusEl = document.getElementById('pdf-viewer-status');
  const data = bytes || (dataUrl ? dataUrlToBytes(dataUrl) : null);
  if (!overlay || !pagesEl || !data) return;

  titleEl.textContent = title || 'Premessa';
  statusEl.textContent = 'Caricamento…';
  pagesEl.innerHTML = '';
  wmEl.style.backgroundImage = '';
  overlay.classList.remove('hidden');
  document.body.classList.add('pdf-lock-scroll');
  if (typeof window.MSSetScreenshotBlock === 'function') window.MSSetScreenshotBlock(true);

  const now = new Date();
  const stamp = now.toLocaleDateString('it-IT') + ' ' + now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  wmEl.style.backgroundImage = `url("${watermarkDataUri(`${label || window.BRAND_NAME || 'Role Makers'} · ${stamp}`)}")`;

  try {
    const loadingTask = pdfjsLib.getDocument({ data });
    currentDoc = await loadingTask.promise;
    statusEl.textContent = `${currentDoc.numPages} pagin${currentDoc.numPages === 1 ? 'a' : 'e'}`;
    const dpr = window.devicePixelRatio || 1;
    const containerWidth = pagesEl.clientWidth || 320;
    for (let n = 1; n <= currentDoc.numPages; n++) {
      const page = await currentDoc.getPage(n);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = (containerWidth / baseViewport.width) * dpr;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas';
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
      pagesEl.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    wmEl.style.height = pagesEl.offsetHeight + 'px';
    statusEl.textContent = '';
  } catch (e) {
    statusEl.textContent = 'Impossibile leggere il PDF.';
    console.error('Errore lettura PDF', e);
  }
}

function close() {
  const overlay = document.getElementById('pdf-viewer');
  const pagesEl = document.getElementById('pdf-viewer-pages');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('pdf-lock-scroll');
  if (pagesEl) pagesEl.innerHTML = '';
  if (currentDoc) { currentDoc.destroy(); currentDoc = null; }
  if (typeof window.MSSetScreenshotBlock === 'function') window.MSSetScreenshotBlock(false);
}

window.MSPdfViewer = { open, close };

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('pdf-viewer');
  const closeBtn = document.getElementById('pdf-viewer-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (overlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('contextmenu', e => e.preventDefault());
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
});
