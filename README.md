# Reel Recipe Extractor

A Chrome extension that pulls the recipe out of an Instagram or Facebook reel and sends it to
**Kaalusemud**, where you match the ingredients to foods and save it with calories and macros.

Works in **Chrome on a computer** (Windows, Mac or Linux). It does not work on phones.

## Install (about 2 minutes)

1. Click the green **Code** button at the top of this page, then **Download ZIP**.
2. Unzip it. You get a folder called `importer-main`. Move it somewhere permanent, for example your Documents
   folder. Chrome keeps reading the extension from that folder, so don't delete it afterwards.
3. In Chrome, type `chrome://extensions` in the address bar and press Enter.
4. Switch on **Developer mode** (top right).
5. Click **Load unpacked** and choose the `importer-main` folder (the one that contains `manifest.json`).
6. Click the puzzle-piece icon in Chrome's toolbar and pin **Reel Recipe Extractor**.

Chrome may show a "disable developer mode extensions" notice every now and then. You can dismiss it.

## Use

You need to be logged in to **Instagram or Facebook**, and to **Kaalusemud** (kaalusemud.vercel.app), in this Chrome.

1. Open the reel, click the extension icon, and press **Extract from this tab**.
   (Or paste the reel's link into the extension and press **Extract**.)
2. Check the ingredients and steps. If something is missing, edit the caption at the bottom and press **Re-parse**.
3. Press **Send to Kaalusemud**. A Kaalusemud tab opens. If it asks you to sign in, do that, and the recipe
   appears.
4. On that page, check the food and amount for each ingredient, then **Save recipe**.

It only reads the **caption**. If the creator writes "comment RECIPE and I'll send it" or puts the recipe in the
video, there is nothing to extract, and the extension will tell you.

## Updating

Download the ZIP again, replace the old folder with the new one, then open `chrome://extensions` and press the
reload icon on the extension.

## Privacy

The extension reads the page you ask it to extract from, and nothing leaves your computer until you press
**Send to Kaalusemud**, which sends that recipe (and its picture) to kaalusemud.vercel.app. There is no tracking.

## Technical notes

- `manifest.json`: permissions. Only instagram.com, facebook.com, fb.watch, their image servers, and Kaalusemud.
- `background.js`: finds the caption in a tab (or in a background tab opened from a link) and stores the recipe
  for the Kaalusemud page. Caption detection is in `pageExtract()`. To use a local copy of the app, change
  `APP_URL` in the "Send to Kaalusemud" section.
- `content-app.js`: runs on the Kaalusemud import page and hands over the stored recipe.
- `parser.js`: caption to title, ingredients, steps and notes. Rule-based, runs locally.
- `popup.*`: the popup UI.
