// Read-only browser baseline. No checkout, admin action or production mutation.
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const url = process.env.AUDIT_URL || 'https://lessence-furlani-vitrine.onrender.com/';
try {
  for (const width of [393, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__longTasks = [];
      new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => e.duration)))
        .observe({ type: 'longtask', buffered: true });
    });
    for (const visit of ['fresh-browser', 'cached-reload']) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid^="vitrine-card-"]').first().waitFor({ timeout: 120000 });
      await page.getByTestId('launch-intro').waitFor({ state: 'hidden', timeout: 30000 });
      const catalogVisibleMs = await page.evaluate(() => performance.now());
      await page.waitForTimeout(1500);
      const metrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const resources = performance.getEntriesByType('resource');
        return {
          ttfbMs: Math.round(nav.responseStart),
          domReadyMs: Math.round(nav.domContentLoadedEventEnd),
          sameOriginTransferredBytes: resources.filter(r => r.name.startsWith(location.origin)).reduce((sum,r) => sum+r.transferSize,0),
          imagesRequested: resources.filter(r => /\.(avif|png|jpe?g|webp)(\?|$)/i.test(r.name)).length,
          cardsInDOM: document.querySelectorAll('[data-testid^="vitrine-card-"]').length,
          longTasks: window.__longTasks.length,
          maxLongTaskMs: Math.round(Math.max(0,...window.__longTasks)),
          api: resources.filter(r => r.name.includes('/api/vitrine')).map(r => ({ durationMs: Math.round(r.duration) })),
        };
      });
      await page.mouse.move(width / 2, 650);
      for (let step = 0; step < 6; step++) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(200);
      }
      const afterScroll = await page.evaluate(() => ({
        cardsInDOM: document.querySelectorAll('[data-testid^="vitrine-card-"]').length,
        longTasks: window.__longTasks.length,
        maxLongTaskMs: Math.round(Math.max(0,...window.__longTasks)),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      }));
      console.log(JSON.stringify({ width, visit, catalogVisibleMs: Math.round(catalogVisibleMs), ...metrics, afterScroll }));
    }
    await context.close();
  }
} finally { await browser.close(); }
