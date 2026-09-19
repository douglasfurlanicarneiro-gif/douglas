// Controlled browser-only comparison. Never modifies production files/data.
import { chromium } from '@playwright/test';
const site = 'https://lessence-furlani-vitrine.onrender.com';
const html = await (await fetch(site)).text();
const entry = html.match(/src="([^"]*\/entry-[^"]+\.js)"/)?.[1];
if (!entry) throw new Error('Entry bundle not found');
const source = await (await fetch(site + entry)).text();
const old = "O=t=>(t||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})";
if (source.split(old).length !== 2) throw new Error('Expected one known formatter; refusing ambiguous comparison');
const optimized = source.replace(old, "O=(()=>{const f=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});return t=>f.format(t||0)})()");
const browser = await chromium.launch();
const apiSnapshots = new Map();
let referenceCard;
try {
  for (const [round, variants] of [[1, ['before', 'after']], [2, ['after', 'before']]]) {
    for (const variant of variants) {
      const context = await browser.newContext({ viewport: { width: 393, height: 900 } });
      const page = await context.newPage();
      // Routing disables browser HTTP cache equally in both variants.
      await page.route(site + entry, route => route.fulfill({ contentType: 'application/javascript', body: variant === 'before' ? source : optimized }));
      await page.route('**/api/**', async route => {
        if (route.request().method() !== 'GET') return route.abort();
        const url = route.request().url();
        if (!apiSnapshots.has(url)) {
          const response = await route.fetch();
          apiSnapshots.set(url, { status: response.status(), contentType: 'application/json', body: await response.text() });
        }
        await route.fulfill(apiSnapshots.get(url));
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.addInitScript(() => {
        window.__tasks = [];
        new PerformanceObserver(list => window.__tasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))))
          .observe({ type: 'longtask', buffered: true });
      });
      await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.locator('[data-testid^="vitrine-card-"]').first().waitFor({ timeout: 120000 });
      await page.locator('#brand-preloader').waitFor({ state: 'hidden', timeout: 120000 });
      await page.getByTestId('launch-intro').waitFor({ state: 'hidden' });
      const uncoveredMs = await page.evaluate(() => performance.now());
      const prices = await page.locator('[data-testid^="vitrine-card-"]').first().innerText();
      if (referenceCard === undefined) referenceCard = prices;
      if (prices !== referenceCard) throw new Error('First card output changed between variants');
      await page.waitForTimeout(1500);
      const scrollStart = await page.evaluate(() => performance.now());
      await page.mouse.move(190, 650);
      for (let step = 0; step < 40; step++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(200); }
      const scroll = await page.evaluate(start => {
        const tasks = window.__tasks.filter(t => t.start >= start);
        return { longTasks: tasks.length, totalLongTaskMs: Math.round(tasks.reduce((s,t) => s+t.duration,0)), maxLongTaskMs: Math.round(Math.max(0,...tasks.map(t => t.duration))), cards: document.querySelectorAll('[data-testid^="vitrine-card-"]').length };
      }, scrollStart);
      console.log(JSON.stringify({ round, variant, uncoveredMs: Math.round(uncoveredMs), scroll, firstCard: prices }));
      await context.close();
    }
  }
} finally { await browser.close(); }
