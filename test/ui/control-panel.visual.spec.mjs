import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Local in-memory fixture only. Never use an actual Owner credential or Production URL.
async function openOwnerPanel(page) {
  // Isolated control-web-fixture supports this synthetic test-only cookie.
  // Public sign-in has a separate journey; don't let it mask Owner Panel QA.
  const origin = new URL(test.info().project.use.baseURL);
  if (origin.hostname !== '127.0.0.1') throw new Error('Owner Panel fixture QA requires loopback-only origin');
  await page.context().addCookies([{
    name: 'awh_fixture_session', value: '1', url: origin.href, httpOnly: true, sameSite: 'Strict'
  }]);
  await page.goto('/panel.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.cp-command-grid')).toBeVisible();
  await expect(page.locator('#cp-menu')).toHaveAttribute('aria-expanded', 'false');
}

test('Control Panel: responsive layout, mobile navigation and visual evidence', async ({ page }, testInfo) => {
  const csp = [];
  const exceptions = [];
  await page.addInitScript(() => {
    window.__awhCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__awhCspViolations.push({ directive:event.violatedDirective, blockedURI:event.blockedURI });
    });
  });
  page.on('pageerror', error => exceptions.push(error.message));
  page.on('console', message => {
    if (/Content Security Policy directive|Refused to apply inline style/i.test(message.text())) csp.push(message.text());
  });
  await openOwnerPanel(page);
  await expect(page.locator('#overview h1')).toBeVisible();

  if (page.viewportSize().width <= 840) {
    const menu = page.locator('#cp-menu');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cp-menu-scrim')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await menu.click();
    const search = page.locator('#cp-search');
    await search.focus();
    await search.fill('สำรองข้อมูล');
    await expect(search).toBeFocused();
    await page.locator('#cp-menu-scrim').click({ position: {x:page.viewportSize().width - 12, y: 70} });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  } else {
    await expect(page.locator('#cp-search')).toBeVisible();
    await page.locator('#cp-search').fill('สำรองข้อมูล');
  }

  const metrics = await page.evaluate(() => ({
    innerWidth,
    documentWidth:document.documentElement.scrollWidth,
    clientWidth:document.documentElement.clientWidth,
    mainWidth:document.querySelector('.cp-main')?.getBoundingClientRect().width,
    csp: window.__awhCspViolations || [],
  }));
  const image = await page.screenshot({ fullPage: true, animations:'disabled' });
  await testInfo.attach('owner-panel-render.png', { body:image, contentType:'image/png' });
  await testInfo.attach('owner-panel-metrics.json', { body:Buffer.from(JSON.stringify({viewport:testInfo.project.name,metrics,exceptions,csp},null,2)), contentType:'application/json' });
  expect(metrics.documentWidth, 'horizontal overflow').toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.mainWidth).toBeGreaterThan(0);
  expect(metrics.csp, 'CSP security violations').toEqual([]);
  expect(csp, 'CSP console errors').toEqual([]);
  expect(exceptions, 'uncaught browser errors').toEqual([]);
});

test('Control Panel: accessibility audit on current responsive viewport', async ({ page }, testInfo) => {
  // The full Owner Panel axe scan takes longer on the existing Intel Chrome QA runner.
  test.setTimeout(120_000);
  await openOwnerPanel(page);
  const findings = await new AxeBuilder({ page }).include('main').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  const summary = findings.violations.map(v => ({id:v.id,impact:v.impact,description:v.description,targets:v.nodes.map(n=>n.target)}));
  await testInfo.attach('accessibility-findings.json', { body:Buffer.from(JSON.stringify(summary,null,2)),contentType:'application/json' });
  expect(summary, 'WCAG A/AA accessibility findings').toEqual([]);
});
