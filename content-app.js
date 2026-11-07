// Runs on the Kaalusemud import page (see manifest "content_scripts"). The extension leaves the recipe in
// extension storage; this script hands it to the page and then clears it. Because the recipe waits in
// storage, it still arrives when the extension popup has closed, or when the person first had to sign in
// to Kaalusemud (the login page sends them back to the import page).
(async () => {
  const MAX_AGE_MS = 10 * 60 * 1000;
  let pending = null;
  try {
    ({ pendingRecipe: pending } = await chrome.storage.local.get('pendingRecipe'));
  } catch (e) {
    return;
  }
  if (!pending || !pending.payload || Date.now() - pending.at > MAX_AGE_MS) return;

  let answered = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'kaalusemud:ack') return;
    answered = true;
    chrome.storage.local.remove('pendingRecipe').catch(() => {});
  });

  // The page may still be loading, so offer the recipe until it answers (up to ~30 seconds).
  for (let i = 0; i < 60 && !answered; i++) {
    window.postMessage({ type: 'kaalusemud:recipe', recipe: pending.payload }, window.location.origin);
    await new Promise((r) => setTimeout(r, 500));
  }
})();
