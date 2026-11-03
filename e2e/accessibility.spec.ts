import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInWithADocument, waitUntilSearchable } from './helpers';

// WCAG 2.2 A and AA, as axe measures them. Zero violations is the bar; a failure lists the elements.
async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
}

test('the landing page has no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue as guest' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('the workspace and a conversation have no accessibility violations', async ({ page }) => {
  await signInWithADocument(page);
  await waitUntilSearchable(page);
  expect(await violations(page)).toEqual([]);

  await page.getByRole('link', { name: 'Conversations' }).click();
  await page.getByRole('button', { name: 'New conversation' }).first().click();
  await page.getByLabel('Your question').fill('Who led the Orion project?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(
    page.getByRole('list', { name: 'Conversation' }).getByText('Priya Raman').first(),
  ).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('the main flow works with the keyboard alone', async ({ page }) => {
  await page.goto('/');
  // tab to the guest button, using nothing but the keyboard, and press it
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (focused === 'Continue as guest') break;
  }
  await expect(page.getByRole('button', { name: 'Continue as guest' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'My workspace' })).toBeVisible();
});
