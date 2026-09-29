// A browser_run_code_unsafe function file: run it with
// { filename: <this file>, args: { slug, scheme } }, harness.ts running.
// Optional args: harness (URL), designOnly (skip the app side).
// Must stay one bare function expression: the tool wraps the file in parens.
async (
  page,
  { slug, scheme, harness = 'http://127.0.0.1:11096', designOnly = false }
) => {
  const cfgRes = await page.request.get(
    `${harness}/config?slug=${encodeURIComponent(slug)}&scheme=${encodeURIComponent(scheme)}`
  );
  const cfg = await cfgRes.json();
  if (!cfgRes.ok()) return { error: cfg.error };
  const collect = eval(cfg.collectSource);
  const sel = (attr, name) => `[${attr}="${name.replace(/["\\]/g, '\\$&')}"]`;
  const put = async (name, body) => {
    const r = await page.request.put(
      `${harness}/out/${encodeURIComponent(name)}`,
      { data: body }
    );
    if (!r.ok()) throw new Error(`upload ${name}: ${(await r.json()).error}`);
    return (await r.json()).path;
  };
  const shot = async selector =>
    (await page.locator(selector).screenshot()).toString('base64');

  const result = {
    slug,
    scheme,
    targets: cfg.targets.map(t => ({ stem: t.stem })),
  };
  let step = 'viewport';
  try {
    await page.setViewportSize({ width: cfg.width, height: cfg.height });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

    // The export sets text in the canvas fonts (Inter, JetBrains Mono); the app uses the
    // theme's stacks. Font is the one difference the spec allows, so the design page is
    // re-set in the app's own stacks before anything is measured.
    step = 'app: read fonts';
    await page.goto(`${cfg.appOrigin}/`);
    await page.waitForFunction(
      () =>
        document.documentElement.hasAttribute('data-mantine-color-scheme') &&
        getComputedStyle(document.documentElement)
          .getPropertyValue('--mantine-font-family-monospace')
          .trim() !== ''
    );
    const fonts = await page.evaluate(async () => {
      const probe = document.createElement('span');
      probe.style.fontFamily = 'var(--mantine-font-family-monospace)';
      document.body.appendChild(probe);
      const mono = getComputedStyle(probe).fontFamily;
      probe.remove();
      // The app's own @font-face rules, their files inlined as data URLs so the
      // design page (a file:// origin) loads the very same font files.
      const faces = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          let css = rule.cssText;
          for (const m of css.matchAll(/url\("?([^")]+)"?\)/g)) {
            const abs = new URL(m[1], sheet.href ?? location.href).href;
            const res = await fetch(abs);
            const type = res.headers.get('content-type') ?? 'font/woff2';
            const bytes = new Uint8Array(await res.arrayBuffer());
            let bin = '';
            for (const b of bytes) bin += String.fromCharCode(b);
            css = css.replace(m[0], `url("data:${type};base64,${btoa(bin)}")`);
          }
          faces.push(css);
        }
      }
      return { sans: getComputedStyle(document.body).fontFamily, mono, faces };
    });
    result.fonts = {
      sans: fonts.sans,
      mono: fonts.mono,
      faces: fonts.faces.length,
    };

    // The export pulls the canvas fonts from Google Fonts. Blocked, so the only
    // faces on the design page are the app's own.
    const webFonts = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
    await page.route(webFonts, r => r.abort());
    step = 'design: load';
    await page.goto(cfg.designUrl);
    await page.unroute(webFonts);
    step = 'design: set app fonts';
    const leftover = await page.evaluate(({ sans, mono, faces }) => {
      const style = document.createElement('style');
      style.textContent = faces.join('\n');
      document.head.appendChild(style);
      for (const el of document.querySelectorAll('[style*="font-family"]')) {
        el.style.fontFamily = /JetBrains Mono/i.test(el.style.fontFamily)
          ? mono
          : sans;
      }
      return [...document.querySelectorAll('[style*="font-family"]')].filter(
        el => ![sans, mono].includes(getComputedStyle(el).fontFamily)
      ).length;
    }, fonts);
    if (leftover > 0)
      throw new Error(`${leftover} design layers still use a canvas font`);
    const loaded = await page.evaluate(async ({ mono }) => {
      const faces = await document.fonts.load(`13px ${mono}`);
      await document.fonts.ready;
      return faces.length;
    }, fonts);
    if (fonts.faces.length > 0 && loaded === 0)
      throw new Error('the app font faces did not load on the design page');
    // Pencil's html-css export writes a stroked layer as content-box but leaves its padding
    // inside the width and height it states, so every padded, stroked layer renders too big.
    // Taking the padding back out makes the page match the board renders.
    await page.evaluate(() => {
      const px = v => (/^-?[\d.]+px$/.test(v) ? parseFloat(v) : null);
      for (const el of document.querySelectorAll('[style*="content-box"]')) {
        const s = el.style;
        const w = px(s.width);
        const h = px(s.height);
        const padX =
          (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.paddingRight) || 0);
        const padY =
          (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0);
        if (w !== null && padX) s.width = `${w - padX}px`;
        if (h !== null && padY) s.height = `${h - padY}px`;
      }
    });
    // The export freezes a stroked layer that hugs its content at the width Pencil
    // measured in the canvas font. With the app's fonts set, those layers hug again
    // (the pen says which), so they reflow instead of keeping a canvas-font width.
    step = 'design: unfreeze hug widths';
    const unfrozen = await page.evaluate(
      ({ targets, attr }) => {
        let count = 0;
        for (const t of targets) {
          const root = [...document.querySelectorAll(`[${attr}]`)].find(
            el => el.getAttribute(attr) === t.root
          );
          if (!root) continue;
          const hug = new Set(t.hugWidths);
          const namedKids = el => {
            const found = [];
            for (const k of el.children) {
              if (k.hasAttribute(attr)) found.push(k);
              else found.push(...namedKids(k));
            }
            return found;
          };
          const walk = (el, prefix) => {
            const kids = namedKids(el);
            const counts = {};
            for (const k of kids) {
              const n = k.getAttribute(attr);
              counts[n] = (counts[n] || 0) + 1;
            }
            const seen = {};
            for (const k of kids) {
              const n = k.getAttribute(attr);
              const idx =
                counts[n] > 1 ? `[${(seen[n] = (seen[n] ?? -1) + 1)}]` : '';
              const path = prefix ? `${prefix}/${n}${idx}` : `${n}${idx}`;
              if (hug.has(path) && /px$/.test(k.style.width)) {
                k.style.width = 'fit-content';
                count += 1;
              }
              walk(k, path);
            }
          };
          walk(root, '');
        }
        return count;
      },
      { targets: cfg.targets, attr: cfg.designAttr }
    );
    result.unfrozen = unfrozen;

    const designShots = {};
    for (const [i, t] of cfg.targets.entries()) {
      step = `design: collect ${t.root}`;
      const root = sel(cfg.designAttr, t.root);
      const nodes = await collect(page, {
        rootSelector: root,
        nameAttr: cfg.designAttr,
      });
      result.targets[i].design = nodes.length;
      await put(`${t.stem}.${scheme}.design.json`, JSON.stringify(nodes));
      designShots[t.stem] = await shot(root);
      await put(`${t.stem}.${scheme}.design.png`, designShots[t.stem]);
    }
    if (designOnly) return result;

    for (const [i, t] of cfg.targets.entries()) {
      step = `app: storage for ${t.route}`;
      await page.goto(`${cfg.appOrigin}/`);
      await page.evaluate(
        ({ storage, scheme }) => {
          localStorage.clear();
          for (const [k, v] of Object.entries(storage))
            localStorage.setItem(k, v);
          localStorage.setItem('ui-color-scheme', JSON.stringify(scheme));
          localStorage.setItem('mantine-color-scheme-value', scheme);
        },
        { storage: cfg.storage, scheme }
      );

      step = `app: load ${t.route}`;
      await page.goto(`${cfg.appOrigin}${t.route}`);
      await page.addStyleTag({
        content:
          '*,*::before,*::after{transition:none!important;animation-play-state:paused!important;caret-color:transparent!important}',
      });
      const root = sel(cfg.appAttr, t.root);
      const action = cfg.action;
      await page.waitForSelector(action ? sel(cfg.appAttr, action.layer) : root, {
        state: 'visible',
        timeout: 30_000,
      });
      const applied = await page.evaluate(() =>
        document.documentElement.getAttribute('data-mantine-color-scheme')
      );
      if (applied !== scheme)
        throw new Error(`app rendered ${applied}, wanted ${scheme}`);

      if (action?.kind === 'click') {
        step = `app: click ${action.layer}`;
        await page.locator(sel(cfg.appAttr, action.layer)).click();
        await page.mouse.move(0, 0);
        await page.waitForSelector(sel(cfg.appAttr, action.waitFor), {
          state: 'visible',
          timeout: 30_000,
        });
      } else if (action?.kind === 'hover') {
        step = `app: hover ${action.layer}`;
        await page.locator(sel(cfg.appAttr, action.layer)).hover();
        await page.waitForSelector(sel(cfg.appAttr, action.waitFor), {
          state: 'visible',
          timeout: 30_000,
        });
      }
      if (action?.until) {
        const u = action.until;
        step = `app: wait for ${u.layer} to match /${u.pattern}/`;
        await page.waitForFunction(
          ({ s, pattern }) =>
            new RegExp(pattern).test(
              (document.querySelector(s)?.textContent ?? '').trim()
            ),
          { s: sel(cfg.appAttr, u.layer), pattern: u.pattern },
          { timeout: u.timeoutMs }
        );
      }
      step = `app: root ${t.root}`;
      await page.waitForSelector(root, { state: 'visible', timeout: 30_000 });
      step = `app: evidence panel loaded in ${t.root}`;
      await page.waitForFunction(
        s =>
          ![...(document.querySelector(s)?.querySelectorAll('p') ?? [])].some(
            p => p.textContent?.trim() === 'Loading…'
          ),
        root,
        { timeout: 30_000 }
      );
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);

      step = `app: collect ${t.root}`;
      const nodes = await collect(page, {
        rootSelector: root,
        nameAttr: cfg.appAttr,
      });
      result.targets[i].app = nodes.length;
      await put(`${t.stem}.${scheme}.app.json`, JSON.stringify(nodes));
      const appShot = await shot(root);
      await put(`${t.stem}.${scheme}.app.png`, appShot);

      step = `app: side-by-side ${t.stem}`;
      const side = await page.evaluate(
        async ({ d, a }) => {
          const load = src =>
            new Promise((ok, fail) => {
              const img = new Image();
              img.onload = () => ok(img);
              img.onerror = fail;
              img.src = `data:image/png;base64,${src}`;
            });
          const [di, ai] = await Promise.all([load(d), load(a)]);
          const gap = 16;
          const w = Math.max(di.width, ai.width);
          const h = Math.max(di.height, ai.height);
          const c = document.createElement('canvas');
          c.width = w * 3 + gap * 2;
          c.height = h;
          const g = c.getContext('2d');
          g.fillStyle = '#ff00ff';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(di, 0, 0);
          g.drawImage(ai, w + gap, 0);
          g.drawImage(di, (w + gap) * 2, 0);
          g.globalCompositeOperation = 'difference';
          g.drawImage(ai, (w + gap) * 2, 0);
          return c.toDataURL('image/png').split(',')[1];
        },
        { d: designShots[t.stem], a: appShot }
      );
      await put(`${t.stem}.${scheme}.side.png`, side);
    }
    return result;
  } catch (err) {
    return {
      ...result,
      failedStep: step,
      error: String(err).slice(0, 500),
      url: page.url(),
    };
  }
}
