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

    step = 'design: load';
    await page.goto(cfg.designUrl);
    await page.evaluate(() => document.fonts.ready);
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
      await page.waitForSelector(root, { state: 'visible', timeout: 30_000 });
      const applied = await page.evaluate(() =>
        document.documentElement.getAttribute('data-mantine-color-scheme')
      );
      if (applied !== scheme)
        throw new Error(`app rendered ${applied}, wanted ${scheme}`);

      const action = cfg.action;
      if (action?.kind === 'click') {
        step = `app: click ${action.layer}`;
        await page.locator(sel(cfg.appAttr, action.layer)).click();
        await page.waitForSelector(sel(cfg.appAttr, action.waitFor), {
          state: 'visible',
          timeout: 30_000,
        });
      } else if (action?.kind === 'waitText') {
        step = `app: wait for ${action.layer} to read "${action.prefix}..."`;
        await page.waitForFunction(
          ({ s, prefix }) =>
            document.querySelector(s)?.textContent?.trim().startsWith(prefix),
          { s: sel(cfg.appAttr, action.layer), prefix: action.prefix },
          { timeout: action.timeoutMs }
        );
      }
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
