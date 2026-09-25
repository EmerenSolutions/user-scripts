// ==UserScript==
// @name         Webtoon Gap Trimmer (MangaKakalot)
// @namespace    https://github.com/EmerenSolutions/user-scripts
// @version      0.1.1
// @author       Johan Emerén
// @copyright    2026, Johan Emerén
// @description  Collapse long white bands inside chapter images; toggle back to originals.
// @match        https://www.mangakakalot.gg/manga/*
// @match        https://mangakakalot.gg/manga/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/webtoon-gap-trimmer/src/webtoon-gap-trimmer.user.js
// @updateURL    https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/webtoon-gap-trimmer/src/webtoon-gap-trimmer.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (!/\/chapter[^/]*\/?$/.test(location.pathname)) return;

  // Build 3. Conservative defaults, measured relative to the image width.
  // Only rows whose EVERY pixel is near-white qualify. No OCR or AI service.
  const WHITE = 250;
  const MIN_GAP = 0.16; // At width 720: trim blank bands at least 115px tall.
  const KEEP_GAP = 0.065; // At width 720: retain about 47px of breathing room.
  const MAX_PIXELS = 60000000;

  function retainedRanges(blank, width) {
    const min = Math.max(40, Math.round(width * MIN_GAP));
    const keep = Math.max(20, Math.round(width * KEEP_GAP));
    const ranges = [];
    let cursor = 0;
    for (let y = 0; y < blank.length;) {
      if (!blank[y]) { y++; continue; }
      const start = y;
      while (y < blank.length && blank[y]) y++;
      if (y - start < min) continue;
      const cutStart = start + Math.floor(keep / 2);
      const cutEnd = y - Math.ceil(keep / 2);
      if (cutStart > cursor) ranges.push([cursor, cutStart]);
      cursor = cutEnd;
    }
    if (cursor < blank.length) ranges.push([cursor, blank.length]);
    return ranges;
  }

  const style = document.createElement('style');
  style.textContent = `
    html.wgt-on img.wgt-original { display:none !important; }
    html:not(.wgt-on) .wgt-result { display:none !important; }
    .wgt-result { display:block !important; max-width:100% !important; margin:0 auto !important; padding:0 !important; border:0 !important; line-height:0 !important; }
    .wgt-slice { display:block !important; position:relative !important; overflow:hidden !important; padding:0 !important; margin:0 !important; border:0 !important; }
    .wgt-slice img { position:absolute !important; top:0 !important; left:0 !important; display:block !important; width:100% !important; max-width:none !important; height:auto !important; max-height:none !important; margin:0 !important; padding:0 !important; border:0 !important; opacity:1 !important; visibility:visible !important; }
  `;
  document.head.append(style);
  let enabled = true;
  document.documentElement.classList.add('wgt-on');
  const records = new Map();
  const pending = new Set();
  const queue = [];
  let running = false, trimmed = 0, checked = 0, failed = 0;
  let lastError = '';

  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647';
  const shadow = ui.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    div { font:13px/1.4 system-ui,sans-serif; background:#202124; color:white; padding:10px 12px; border-radius:9px; box-shadow:0 2px 12px #0006; }
    button { font:inherit; padding:6px 10px; cursor:pointer; border:1px solid #aaa; border-radius:5px; background:#fff; color:#111; }
    span { display:block; margin-top:5px; max-width:250px; }
  </style><div><button type="button" aria-pressed="true">Gaps shortened · show original</button><span role="status" aria-live="polite"></span></div>`;
  document.body.append(ui);
  const button = shadow.querySelector('button');
  const status = shadow.querySelector('span');
  function updateStatus() {
    status.textContent = `${trimmed} images shortened / ${checked} checked${failed ? ` · ${failed} unreadable` : ''}${running ? ' · scanning…' : ''}${lastError ? ` · ${lastError}` : ''}`;
  }
  button.onclick = () => {
    enabled = !enabled;
    document.documentElement.classList.toggle('wgt-on', enabled);
    button.textContent = enabled ? 'Gaps shortened · show original' : 'Original · shorten gaps';
    button.setAttribute('aria-pressed', String(enabled));
    if (enabled) pump();
  };
  updateStatus();

  function fetchBitmap(url) {
    // Fetch only the source of an image already displayed on this chapter.
    // @connect * permits the site's changing image CDN hosts. No uploads.
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob', anonymous: true, timeout: 20000,
        headers: { Referer: `${location.origin}/` },
        onload: async response => {
          try {
            if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
            if (!(response.response instanceof Blob)) throw new Error('No image blob');
            resolve(await createImageBitmap(response.response));
          } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('Image request failed')),
        ontimeout: () => reject(new Error('Image request timed out')),
      });
    });
  }

  async function scan(source, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.min(128, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const blank = new Uint8Array(height);
    try {
      for (let top = 0; top < height; top += 128) {
        const rows = Math.min(128, height - top);
        ctx.clearRect(0, 0, width, 128);
        ctx.drawImage(source, 0, top, width, rows, 0, 0, width, rows);
        const data = ctx.getImageData(0, 0, width, rows).data;
        for (let y = 0; y < rows; y++) {
          let white = true;
          const end = (y + 1) * width * 4;
          for (let i = y * width * 4; i < end; i += 4) {
            if (data[i] < WHITE || data[i + 1] < WHITE || data[i + 2] < WHITE || data[i + 3] !== 255) {
              white = false; break;
            }
          }
          blank[top + y] = white ? 1 : 0;
        }
        // Yield so large chapters do not monopolize the browser.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return retainedRanges(blank, width);
    } finally { canvas.width = canvas.height = 0; }
  }

  async function processImage(img) {
    const src = img.currentSrc || img.src;
    if (!img.isConnected || !img.complete || !img.naturalWidth || records.get(img)?.src === src) return;
    const width = img.naturalWidth, height = img.naturalHeight;
    if (width < 300 || height < 150 || img.getBoundingClientRect().width < 250) return;
    const previous = records.get(img);
    previous?.wrapper?.remove();
    img.classList.remove('wgt-original');
    const record = { src, wrapper: null };
    records.set(img, record);
    if (width * height > MAX_PIXELS || width > 16000) { failed++; checked++; return; }
    let bitmap;
    try {
      let ranges;
      try { ranges = await scan(img, width, height); }
      catch (error) {
        if (error.name !== 'SecurityError') throw error;
        if (!/^https?:/.test(src)) throw error;
        bitmap = await fetchBitmap(src);
        if (bitmap.width !== width || bitmap.height !== height) throw new Error('Image dimensions changed');
        ranges = await scan(bitmap, width, height);
      }
      if (!img.isConnected || (img.currentSrc || img.src) !== src) { records.delete(img); return; }
      if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === height) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'wgt-result';
      wrapper.style.width = `${img.getBoundingClientRect().width}px`;
      wrapper.setAttribute('role', 'img');
      wrapper.setAttribute('aria-label', img.alt || 'Comic image with blank gaps shortened');
      for (const [start, end] of ranges) {
        const slice = document.createElement('div');
        slice.className = 'wgt-slice';
        slice.style.aspectRatio = `${width} / ${end - start}`;
        const copy = document.createElement('img');
        copy.alt = '';
        copy.setAttribute('aria-hidden', 'true');
        copy.referrerPolicy = img.referrerPolicy;
        copy.src = src;
        copy.style.setProperty('transform', `translateY(-${100 * start / height}%)`, 'important');
        slice.append(copy);
        wrapper.append(slice);
      }
      // Wait for replacement images before hiding the original. Fail open.
      await Promise.all([...wrapper.querySelectorAll('img')].map(copy => copy.decode()));
      if (!img.isConnected || (img.currentSrc || img.src) !== src) { records.delete(img); return; }
      img.after(wrapper);
      record.wrapper = wrapper;
      img.classList.add('wgt-original');
      trimmed++;
    } catch (error) {
      failed++;
      lastError = error.message || String(error);
      console.warn('[Webtoon Gap Trimmer] Image left unchanged:', error.message);
    } finally {
      bitmap?.close();
      checked++;
    }
  }

  async function pump() {
    if (running || !enabled) return;
    running = true;
    updateStatus();
    while (queue.length && enabled) {
      const img = queue.shift();
      await processImage(img);
      pending.delete(img);
      updateStatus();
    }
    running = false;
    updateStatus();
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      if (!img.complete || !img.naturalWidth || pending.has(img)) continue;
      if (records.get(img)?.src === (img.currentSrc || img.src)) continue;
      pending.add(img);
      queue.push(img);
    }
    pump();
  }, { rootMargin: '800px 0px' });
  const observed = new WeakSet();
  function discover() {
    for (const img of document.images) {
      if (observed.has(img) || img.closest('.wgt-result, header, footer, nav, aside')) continue;
      observed.add(img);
      observer.observe(img);
      img.addEventListener('load', () => {
        if (records.get(img)?.src !== (img.currentSrc || img.src)) {
          records.get(img)?.wrapper?.remove();
          records.delete(img);
          img.classList.remove('wgt-original');
        }
        observer.unobserve(img);
        observer.observe(img);
      });
    }
  }
  let discoveryTimer;
  new MutationObserver(() => {
    clearTimeout(discoveryTimer);
    discoveryTimer = setTimeout(discover, 100);
  }).observe(document.body, { childList: true, subtree: true });
  discover();
})();
