const $ = (id) => document.getElementById(id);
const { parseRecipe, toText, toMarkdown } = RecipeParser;
const SITE = /^https:\/\/(?:[\w-]+\.)?(?:instagram\.com|facebook\.com|fb\.watch)\//i;

let current = { caption: '', url: '', image: '', recipe: null };
let activeTabId = null;

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function busy(on) {
  $('goUrl').disabled = on;
  $('goTab').disabled = on || activeTabId == null;
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function render() {
  const r = current.recipe;
  $('rawWrap').hidden = !current.caption;
  $('raw').value = current.caption;
  if (!r) { $('result').hidden = true; return; }

  $('result').hidden = false;
  $('title').textContent = r.title || 'Recipe';
  $('desc').textContent = r.description || '';
  $('desc').hidden = !r.description;

  const meta = $('meta');
  meta.replaceChildren();
  r.meta.forEach((m) => { const s = document.createElement('span'); s.textContent = m; meta.appendChild(s); });

  const ing = $('ingredients');
  ing.replaceChildren();
  r.ingredients.forEach((i) => {
    const li = document.createElement('li');
    if (i.heading) {
      li.className = 'heading';
      li.textContent = i.text;
    } else {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      const sp = document.createElement('span');
      sp.textContent = i.text;
      label.append(cb, sp);
      li.appendChild(label);
    }
    ing.appendChild(li);
  });

  const steps = $('steps');
  steps.replaceChildren();
  r.steps.forEach((s) => {
    const li = document.createElement('li');
    li.textContent = s.text;
    if (s.heading) li.className = 'heading';
    steps.appendChild(li);
  });

  const notes = $('notes');
  notes.replaceChildren();
  r.notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n.text; notes.appendChild(li); });
  $('notesWrap').hidden = !r.notes.length;

  if (!r.found) {
    setStatus('Could not clearly find a recipe in this caption. Check the original caption below - the recipe may be in the video or comments.', 'warn');
    $('rawWrap').open = true;
  }
}

function load(caption, url, image) {
  current = { caption, url: url || '', image: image || '', recipe: parseRecipe(caption) };
  if (current.recipe.found) setStatus('');
  render();
  try { chrome.storage.local.set({ last: { caption, url: current.url, image: current.image } }); } catch (e) { /* ignore */ }
}

async function run(msg) {
  busy(true);
  setStatus('Reading caption…');
  const res = await send(msg);
  busy(false);
  if (!res || !res.ok) {
    setStatus((res && res.error) || 'Something went wrong.', 'error');
    return;
  }
  load(res.data.caption, res.data.pageUrl, res.data.image);
}

$('goUrl').addEventListener('click', () => {
  const url = $('url').value.trim();
  if (!SITE.test(url)) { setStatus('Paste an Instagram or Facebook link first.', 'error'); return; }
  run({ type: 'extractUrl', url });
});
$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('goUrl').click(); });
$('goTab').addEventListener('click', () => run({ type: 'extractTab', tabId: activeTabId }));
$('reparse').addEventListener('click', () => load($('raw').value, current.url, current.image));

$('sendApp').addEventListener('click', async () => {
  const r = current.recipe;
  if (!r) return;
  $('sendApp').disabled = true;
  setStatus('Sending to Kaalusemud...');
  const res = await send({
    type: 'sendToApp',
    recipe: {
      title: r.title,
      description: r.description,
      meta: r.meta,
      ingredients: r.ingredients,
      steps: r.steps,
      notes: r.notes.map((n) => n.text),
      sourceUrl: current.url,
      imageUrl: current.image,
    },
  });
  $('sendApp').disabled = false;
  if (!res || !res.ok) { setStatus((res && res.error) || 'Could not send the recipe.', 'error'); return; }
  setStatus(res.data.picture ? 'Opened Kaalusemud. Finish the import in that tab.' : 'Opened Kaalusemud (no picture). Finish the import in that tab.');
});

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(label + ' copied.');
  } catch (e) {
    setStatus('Could not copy to clipboard.', 'error');
  }
}
$('copyText').addEventListener('click', () => current.recipe && copy(toText(current.recipe), 'Recipe'));
$('copyMd').addEventListener('click', () => current.recipe && copy(toMarkdown(current.recipe, current.url), 'Markdown'));
$('download').addEventListener('click', () => {
  if (!current.recipe) return;
  const name = (current.recipe.title || 'recipe').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'recipe';
  const blob = new Blob([toMarkdown(current.recipe, current.url)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

(async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id != null) {
      activeTabId = tab.id;
      $('goTab').disabled = false;
      if (tab.url && SITE.test(tab.url)) $('goTab').textContent = 'Extract from this tab (' + new URL(tab.url).hostname.replace(/^www\./, '') + ')';
    }
  } catch (e) { /* ignore */ }
  try {
    const { last } = await chrome.storage.local.get('last');
    if (last && last.caption) { if (last.url) $('url').value = last.url; load(last.caption, last.url, last.image); }
  } catch (e) { /* ignore */ }
})();
