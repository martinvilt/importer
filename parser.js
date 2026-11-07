// Turns a messy social-media caption into { title, meta, ingredients, steps, notes }.
// Heuristic, offline, no API. Works in the popup and in Node (for tests).
(function (root) {
  const EMOJI = '\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\ufe0f\\u200d\\u20e3';
  const LEAD_JUNK = new RegExp('^[\\s' + EMOJI + '•·▪■□●○◦‣⁃*\\-–—✓✔☑➡▶►→>#_~]+', 'u');
  const TRAIL_JUNK = new RegExp('[\\s' + EMOJI + ':：\\-–—*_#~]+$', 'u');

  const UNITS =
    '(?:g|gr|grams?|kg|ml|cl|dl|l|liters?|litres?|oz|ounces?|lbs?|pounds?|cups?|tbsp|tbs|tsp|tablespoons?|teaspoons?|' +
    'cloves?|pinch(?:es)?|dash(?:es)?|slices?|cans?|sticks?|pieces?|bunch(?:es)?|handfuls?|sprigs?|stalks?|heads?|packs?|packets?|sachets?)';
  const NUM = '(?:\\d+\\s*\\/\\s*\\d+|\\d+[.,]\\d+|\\d+|[¼½¾⅓⅔⅛])';
  const QTY_UNIT = new RegExp('(?:^|\\s)' + NUM + '(?:\\s*(?:-|–|to)\\s*' + NUM + ')?\\s*' + UNITS + '\\b', 'i');
  const STARTS_NUM = new RegExp('^' + NUM);
  const COOK_VERB =
    /\b(mix|stir|add|bake|cook|heat|preheat|simmer|boil|fry|saute|sauté|chop|slice|dice|whisk|blend|pour|combine|season|serve|place|put|let|cover|remove|drain|toss|fold|knead|roast|grill|bring|reduce|garnish|top|spread|transfer|cut|mash|set|rest|cool|refrigerate|marinate|brush|sprinkle)\b/i;

  const ING_H = /^(?:ingredients?|what you(?:'|’)?ll need|you(?:'|’)?ll need|shopping list|zutaten|ingr[ée]dients|ingredientes|ingredienti)$/i;
  const STEP_H = /^(?:instructions?|directions?|method|steps?|preparation|how to make(?: it)?|how to cook|procedure|zubereitung|pr[ée]paration|preparaci[oó]n|preparazione|modo de preparo)$/i;
  const NOTE_H = /^(?:notes?|tips?|nutrition|macros?|storage|serving suggestions?)$/i;
  const NEUTRAL_H = /^(?:recipe|the recipe|full recipe)$/i;
  const META_RE =
    /^(?:serves?|servings?|yields?|makes|prep(?:\s*time)?|cook(?:\s*time)?|total(?:\s*time)?|time|calories|cals|kcal|protein|carbs|fat)\s*(?:[:\-–]\s*\S|\s+\d)/i;
  const JUNK_RE =
    /^(?:follow (?:me|us|for|@)|like (?:and|&|this)|share (?:this|with)|save (?:this|it|for)|tag (?:a|your|someone)|comment\b.*\b(?:recipe|below|link|and i|send)|dm me|link in bio|full recipe (?:in|on|at|below)|subscribe|music|song|audio)/i;

  function normalize(raw) {
    return String(raw || '')
      .replace(/\r/g, '')
      .replace(/(\d)️?⃣/g, '$1. ') // keycap emoji 1️⃣ -> "1."
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  function stripInline(line) {
    return line.replace(/(^|\s)[#@][\w.]+/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  function cleanItem(line) {
    return line.replace(LEAD_JUNK, '').replace(/[ \t]+$/g, '').trim();
  }

  function stripNumbering(line) {
    return line.replace(/^\s*(?:step\s*)?\d{1,2}\s*[.):]\s+/i, '').trim();
  }

  function parseHeader(line) {
    const base = cleanItem(line);
    const m = base.match(/^(.{1,40}?)\s*[:：]\s*(.*)$/);
    let head = m ? m[1] : base;
    const rest = m ? m[2] : '';
    head = head.replace(/\s*\(.*?\)\s*/g, ' ').replace(TRAIL_JUNK, '').trim();
    if (head.length > 40) return null;
    if (!m && base.length > 40) return null;
    let type = null;
    if (ING_H.test(head)) type = 'ing';
    else if (STEP_H.test(head)) type = 'step';
    else if (NOTE_H.test(head)) type = 'note';
    else if (NEUTRAL_H.test(head)) type = 'neutral';
    if (!type) return null;
    return { type, rest: rest.trim() };
  }

  const isNumbered = (l) => /^\s*(?:step\s*)?\d{1,2}\s*[.):]\s+\S/i.test(l);
  function isIngredientLike(l) {
    const c = cleanItem(l);
    if (c.length > 90) return false;
    return QTY_UNIT.test(c) || (STARTS_NUM.test(c) && c.length < 60 && !COOK_VERB.test(c));
  }
  function isStepLike(l) {
    if (isNumbered(l)) return !isIngredientLike(stripNumbering(l));
    const c = cleanItem(l);
    return c.length > 50 && COOK_VERB.test(c) && !isIngredientLike(c);
  }

  function parseRecipe(raw) {
    const result = { title: '', description: '', meta: [], ingredients: [], steps: [], notes: [], found: false };
    const lines = normalize(raw).split('\n');
    const pre = [];
    let section = 'pre';
    let sawIng = false;
    let sawStep = false;
    const push = (arr, text, heading) => {
      if (text) arr.push(heading ? { heading: true, text } : { text });
    };

    for (const original of lines) {
      let line = stripInline(original);
      if (!cleanItem(line)) continue;
      if (JUNK_RE.test(cleanItem(line))) continue;

      const h = parseHeader(line);
      if (h) {
        if (h.type === 'ing') { section = 'ing'; sawIng = true; }
        else if (h.type === 'step') { section = 'step'; sawStep = true; }
        else if (h.type === 'note') section = 'note';
        else section = sawIng || sawStep ? section : 'neutral';
        if (!h.rest) continue;
        line = h.rest;
      }

      const item = cleanItem(line);
      if (!item) continue;

      if (section !== 'step' && item.length < 70 && META_RE.test(item)) {
        result.meta.push(item);
        continue;
      }

      // sub-heading such as "For the sauce:"
      if ((section === 'ing' || section === 'step') && /[:：]$/.test(item) && item.length <= 40) {
        push(section === 'ing' ? result.ingredients : result.steps, item.replace(TRAIL_JUNK, ''), true);
        continue;
      }

      if (section === 'ing') {
        // no explicit steps header: a numbered / sentence-like line after ingredients starts the method
        if (!sawStep && isStepLike(line)) {
          section = 'step';
          push(result.steps, stripNumbering(item));
        } else {
          push(result.ingredients, item);
        }
      } else if (section === 'step') {
        push(result.steps, stripNumbering(item));
      } else if (section === 'note') {
        push(result.notes, item);
      } else {
        pre.push({ line, item });
      }
    }

    const headerMode = sawIng || sawStep;
    if (headerMode) {
      // lines before the first header = title + description
      pre.forEach((p, i) => {
        if (i === 0 && p.item.length <= 100) result.title = p.item;
        else result.description += (result.description ? ' ' : '') + p.item;
      });
    } else {
      // no headers at all: classify line by line
      let seenIng = false;
      pre.forEach((p, i) => {
        if (i === 0 && !isIngredientLike(p.line) && !isStepLike(p.line) && p.item.length <= 100) {
          result.title = p.item;
        } else if (isIngredientLike(p.line)) {
          seenIng = true;
          push(result.ingredients, p.item);
        } else if (isStepLike(p.line)) {
          push(result.steps, stripNumbering(p.item));
        } else if (LEAD_JUNK.test(p.line) && /^[•·▪■□●○◦‣⁃*\-–—✓✔☑✅\p{Extended_Pictographic}]/u.test(p.line.trim()) && p.item.length < 60 && !COOK_VERB.test(p.item)) {
          seenIng = true;
          push(result.ingredients, p.item);
        } else if (seenIng) {
          push(result.notes, p.item);
        } else {
          result.description += (result.description ? ' ' : '') + p.item;
        }
      });
    }

    const count = (arr) => arr.filter((x) => !x.heading).length;
    result.found = count(result.ingredients) >= 2 || count(result.steps) >= 2;
    return result;
  }

  function toText(r) {
    const out = [];
    if (r.title) out.push(r.title.toUpperCase());
    if (r.meta.length) out.push(r.meta.join(' | '));
    if (r.description) out.push('\n' + r.description);
    if (r.ingredients.length) {
      out.push('\nINGREDIENTS');
      r.ingredients.forEach((i) => out.push(i.heading ? '\n' + i.text + ':' : '- ' + i.text));
    }
    if (r.steps.length) {
      out.push('\nINSTRUCTIONS');
      let n = 0;
      r.steps.forEach((s) => out.push(s.heading ? '\n' + s.text + ':' : ++n + '. ' + s.text));
    }
    if (r.notes.length) {
      out.push('\nNOTES');
      r.notes.forEach((n) => out.push('- ' + n.text));
    }
    return out.join('\n').trim() + '\n';
  }

  function toMarkdown(r, sourceUrl) {
    const out = [];
    out.push('# ' + (r.title || 'Recipe'));
    if (r.meta.length) out.push('\n*' + r.meta.join(' · ') + '*');
    if (r.description) out.push('\n' + r.description);
    if (r.ingredients.length) {
      out.push('\n## Ingredients\n');
      r.ingredients.forEach((i) => out.push(i.heading ? '\n**' + i.text + '**\n' : '- ' + i.text));
    }
    if (r.steps.length) {
      out.push('\n## Instructions\n');
      let n = 0;
      r.steps.forEach((s) => out.push(s.heading ? '\n**' + s.text + '**\n' : ++n + '. ' + s.text));
    }
    if (r.notes.length) {
      out.push('\n## Notes\n');
      r.notes.forEach((n) => out.push('- ' + n.text));
    }
    if (sourceUrl) out.push('\n---\nSource: ' + sourceUrl);
    return out.join('\n').trim() + '\n';
  }

  const api = { parseRecipe, toText, toMarkdown };
  root.RecipeParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
