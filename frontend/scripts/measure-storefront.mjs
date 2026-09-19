// Read-only browser baseline. No checkout, admin action or production mutation.
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const url = process.env.AUDIT_URL || 'https://lessence-furlani-vitrine.onrender.com/';
const stress = process.env.AUDIT_STRESS === '1';
const profile = process.env.AUDIT_PROFILE === '1';
try {
  for (const width of [393, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const profiler = profile ? await context.newCDPSession(page) : null;
    if (profiler) await profiler.send('Profiler.enable');
    page.setDefaultNavigationTimeout(120000);
    if (stress) {
      const session = await context.newCDPSession(page);
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', {
        offline: false, latency: 150,
        downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8,
      });
      await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    await page.addInitScript(() => {
      window.__longTasks = [];
      new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => e.duration)))
        .observe({ type: 'longtask', buffered: true });
    });
    for (const visit of ['fresh-browser', 'cached-reload']) {
      if (profiler) await profiler.send('Profiler.start');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-testid^="vitrine-card-"]').first().waitFor({ timeout: 120000 });
      await page.getByTestId('launch-intro').waitFor({ state: 'hidden', timeout: 30000 });
      const catalogVisibleMs = await page.evaluate(() => performance.now());
      await page.locator('#brand-preloader').waitFor({ state: 'hidden', timeout: 120000 });
      const catalogUncoveredMs = await page.evaluate(() => performance.now());
      const summarizeProfile = async () => {
        if (!profiler) return undefined;
        const { profile: result } = await profiler.send('Profiler.stop');
        const nodes = new Map(result.nodes.map(node => [node.id, node.callFrame]));
        const totals = new Map();
        result.samples?.forEach((id, index) => {
          const frame = nodes.get(id);
          const key = `${frame?.functionName || '(anonymous)'} ${frame?.url || ''}:${(frame?.lineNumber ?? -1) + 1}`;
          totals.set(key, (totals.get(key) || 0) + (result.timeDeltas?.[index] || 0));
        });
        return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 12)
          .map(([frame, microseconds]) => ({ frame, sampledMs: Math.round(microseconds / 1000) }));
      };
      const startupProfile = await summarizeProfile();
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
      if (profiler) await profiler.send('Profiler.start');
      for (let step = 0; step < (stress ? 40 : 6); step++) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(200);
      }
      const afterScroll = await page.evaluate(() => ({
        cardsInDOM: document.querySelectorAll('[data-testid^="vitrine-card-"]').length,
        longTasks: window.__longTasks.length,
        maxLongTaskMs: Math.round(Math.max(0,...window.__longTasks)),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      }));
      const scrollProfile = await summarizeProfile();
      console.log(JSON.stringify({ width, visit, profile: stress ? '1.6Mbps-150ms-CPU4x-40scrolls' : 'unthrottled-6scrolls', catalogVisibleMs: Math.round(catalogVisibleMs), catalogUncoveredMs: Math.round(catalogUncoveredMs), ...metrics, afterScroll, startupProfile, scrollProfile }));
    }
    await context.close();
  }
} finally { await browser.close(); }
