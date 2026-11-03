import { expect, type Page } from '@playwright/test';

export const NOTE = [
  'The Orion project launched in March 2025 and was led by Priya Raman.',
  'Its budget was 1.2 million dollars.',
  'The team shipped the billing rewrite in June.',
].join(' ');

// "Continue as guest" lands on the list of workspaces, where the new guest has one.
export async function openMyWorkspace(page: Page) {
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await page.getByRole('link', { name: 'My workspace' }).click();
  await expect(page.getByRole('heading', { name: 'My workspace' })).toBeVisible();
}

// A new guest, with a workspace, and one small document that has been indexed. The same start for every test.
export async function signInWithADocument(page: Page) {
  await page.goto('/');
  await openMyWorkspace(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'orion.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(NOTE),
  });
  await expect(page.getByText('Indexed')).toBeVisible({ timeout: 60_000 });
}

// The search index trails the database by a moment, so a document that is "Indexed" may not be found yet. Asking
// before it is would get a fair "nothing found", so wait until a search finds it.
export async function waitUntilSearchable(page: Page) {
  await page.getByLabel('Search your documents').fill('Who led the Orion project');
  await expect(async () => {
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('led by Priya Raman').first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 40_000 });
}
