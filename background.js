// Service worker: gets the caption text out of a tab (current one, or a background one opened from a link).

const ALLOWED = /^https:\/\/(?:[\w-]+\.)?(?:instagram\.com|facebook\.com|fb\.watch)\//i;

// Runs INSIDE the page. Must be fully self-contained (no outside references).
async function pageExtract() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Expand truncated captions ("… more" / "See more").
  const moreRe = /^[….\s]*(more|see more|mehr|más|plus)$/i;
  document.querySelectorAll('[role="button"]').forEach((el) => {
    const t = (el.innerText || '').trim();
    if (t.length <= 14 && moreRe.test(t)) {
      try { el.click(); } catch (e) { /* ignore */ }
    }
  });
  await sleep(450);

  // Instagram's og:description looks like: 1,234 likes, 5 comments - user on May 1, 2025: "caption"
  const cleanMeta = (s) => {
    if (!s) return '';
    const m = s.match(/^[^:]{0,250}?(?: on [A-Z][a-z]+ \d{1,2}, \d{4}| on Instagram)\s*:\s*["“]([\s\S]*?)["”]\.?\s*$/);
    return m ? m[1] : s;
  };
  const meta = (n) => {
    const el = document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]');
    return el ? el.content : '';
  };

  const cands = [];
  const add = (text, source) => {
    text = (text || '').replace(/ /g, ' ').trim();
    if (text.length >= 25 && text.length < 8000) cands.push({ text, source });
  };
  ['og:description', 'twitter:description', 'description'].forEach((n) => add(cleanMeta(meta(n)), 'meta'));
  document
    .querySelectorAll('h1, [data-ad-preview="message"], [data-ad-comet-preview="message"], span[dir="auto"], div[dir="auto"]')
    .forEach((el) => add(el.innerText, 'dom'));

  const score = (t) => {
    let s = 0;
    if (/ingredients?|instructions?|directions?|method|recipe/i.test(t)) s += 5;
    const qty = t.match(/^[\s\W]*\d+(?:[\/.,]\d+)?\s*(?:g|kg|ml|l|oz|lbs?|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|pinch|slices?|cans?)\b/gim);
    s += (qty ? qty.length : 0) * 2;
    const verbs = t.match(/\b(bake|stir|mix|add|cook|simmer|preheat|chop|whisk|fry|boil)\b/gi);
    s += (verbs ? verbs.length : 0) * 0.5;
    return s;
  };

  cands.forEach((c) => { c.score = score(c.text); });
  cands.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const best = cands[0];

  // The post's picture: the share-preview image, or the video's poster frame.
  let image = meta('og:image') || meta('twitter:image') || '';
  if (!image) {
    const v = document.querySelector('video[poster]');
    if (v) image = v.getAttribute('poster') || '';
  }

  return {
    image: /^https:\/\//i.test(image) ? image : '',
    caption: best ? best.text : '',
    score: best ? best.score : 0,
    source: best ? best.source : null,
    pageUrl: location.href,
    pageTitle: document.title,
  };
}

async function extractFromTab(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: pageExtract });
  return res && res.result;
}

function waitForLoad(tabId, timeout = 25000) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeout);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractFromUrl(url) {
  if (!ALLOWED.test(url)) throw new Error('That does not look like an Instagram or Facebook link.');
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id);
    let best = null;
    let image = '';
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const r = await extractFromTab(tab.id);
        if (r && r.image) image = r.image;
        if (r && (!best || r.score > best.score || (r.score === best.score && r.caption.length > best.caption.length))) best = r;
        if (best && best.score >= 5) break; // clearly looks like a recipe
      } catch (e) {
        if (i === 5) throw e;
      }
    }
    if (!best || !best.caption) {
      throw new Error('Could not find a caption. Are you logged in to Instagram/Facebook in this browser?');
    }
    best.pageUrl = url;
    best.image = best.image || image;
    return best;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ---- Send to Kaalusemud ----------------------------------------------------------------------------

// Where the calorie tracker lives. For local development use 'http://localhost:3000'.
const APP_URL = 'https://kaalusemud.vercel.app';

// Downloads the post's picture and shrinks it to a small JPEG data URL (<= ~650 KB). Instagram's picture
// links expire after a few days, so the app stores its own copy. Returns null if anything goes wrong:
// the recipe is still sent, just without a picture.
async function fetchImageDataUrl(url) {
  try {
    if (!/^https:\/\//i.test(url)) return null;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    let scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: attempt < 2 ? 0.82 : 0.65 });
      if (blob.size <= 650000) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return 'data:image/jpeg;base64,' + btoa(bin);
      }
      scale *= 0.75;
    }
  } catch (e) { /* no picture */ }
  return null;
}

// The recipe is left in extension storage and the Kaalusemud import page picks it up (content-app.js).
// This way it still arrives if the popup closes (opening a tab closes it) or if the person has to sign in
// to Kaalusemud first: the login page returns them to the import page, where the recipe is delivered.
async function sendToApp(recipe) {
  const image = recipe.imageUrl ? await fetchImageDataUrl(recipe.imageUrl) : null;
  const payload = {
    title: recipe.title,
    description: recipe.description,
    meta: recipe.meta,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    notes: recipe.notes,
    sourceUrl: recipe.sourceUrl,
    image,
  };

  await chrome.storage.local.set({ pendingRecipe: { at: Date.now(), payload } });
  await chrome.tabs.create({ url: APP_URL + '/recipes/import', active: true });
  return { picture: !!image };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'extractTab') {
        const data = await extractFromTab(msg.tabId);
        if (!data || !data.caption) throw new Error('No caption found on this page.');
        sendResponse({ ok: true, data });
      } else if (msg.type === 'extractUrl') {
        sendResponse({ ok: true, data: await extractFromUrl(msg.url) });
      } else if (msg.type === 'sendToApp') {
        sendResponse({ ok: true, data: await sendToApp(msg.recipe) });
      } else {
        sendResponse({ ok: false, error: 'Unknown request' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true; // async response
});
