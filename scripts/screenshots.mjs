/* global process, URL, console, document, HTMLElement */
// The README's screenshots, taken from a running site so they show the product as it is.
//   node scripts/screenshots.mjs https://atlas-ai-seven-vert.vercel.app
// It signs in as a guest, uploads the two sample documents in docs/samples, asks a question and photographs each
// screen into docs/images.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const site = (process.argv[2] ?? 'http://localhost:3002').replace(/\/$/, '');
const root = new URL('..', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));
const QUESTION = 'Why did support tickets rise in Q3, and what was done about it?';

const browser = await chromium.launch();
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await desktop.newPage();
page.setDefaultTimeout(240_000);
const shot = (name) => page.screenshot({ path: path(`docs/images/${name}.png`) });

await page.goto(site);
await page.getByRole('button', { name: 'Continue as guest' }).waitFor();
await shot('landing');

await page.getByRole('button', { name: 'Continue as guest' }).click();
await page.getByRole('heading', { name: 'My workspace' }).waitFor();
await page
  .locator('input[type="file"]')
  .setInputFiles([
    path('docs/samples/q3-2025-operations-review.pdf'),
    path('docs/samples/information-security-policy.pdf'),
  ]);
// both indexed, and the search index caught up with them
await page.getByText('Indexed', { exact: true }).nth(1).waitFor();
await page.getByLabel('Your question').fill('support tickets');
for (let i = 0; i < 40; i++) {
  await page.getByRole('button', { name: 'Find passages' }).click();
  if (
    await page
      .getByText('Show in context')
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
  )
    break;
}
// leave and come back through the sidebar, so the page shows the documents and not the search that was just run
await page.getByRole('link', { name: 'Conversations' }).click();
await page.getByRole('link', { name: 'Documents' }).click();
await page.getByRole('table').waitFor();
await page.mouse.move(0, 0);
await shot('workspace');

await page.getByLabel('Your question').fill(QUESTION);
await page.getByRole('button', { name: 'Ask', exact: true }).click();
// the answer is finished when it can be written again
await page.getByRole('button', { name: 'Regenerate' }).waitFor();
await page.evaluate(
  () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
);
await page.waitForTimeout(500);
await shot('answer');

await page.getByRole('list', { name: 'Sources' }).getByRole('button').first().click();
// the page's passages load, with the cited one marked
await page.getByRole('dialog').locator('[aria-current="true"]').waitFor();
await page.waitForTimeout(400);
await shot('citation');
await page.keyboard.press('Escape');

// the same conversation on a phone, in dark mode. The page is resized, not reloaded: a reload empties a guest's
// workspace on the demo.
await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(800);
await shot('phone');

await browser.close();
console.log('screenshots written to docs/images');
