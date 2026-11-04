import { expect, type Page } from '@playwright/test';

export const NOTE = [
  'The Orion project launched in March 2025 and was led by Priya Raman.',
  'Its budget was 1.2 million dollars.',
  'The team shipped the billing rewrite in June.',
].join(' ');

// "Continue as guest" opens the new guest's own workspace.
export async function openMyWorkspace(page: Page) {
  await page.getByRole('button', { name: 'Continue as guest' }).click();
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
  await page.getByLabel('Your question').fill('Who led the Orion project');
  await expect(async () => {
    await page.getByRole('button', { name: 'Find passages' }).click();
    await expect(page.getByText('led by Priya Raman').first()).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 40_000 });
}

// The way most people ask: type the question on the workspace page and press Ask.
export async function askFromWorkspace(page: Page, question: string) {
  await page.getByLabel('Your question').fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
}
