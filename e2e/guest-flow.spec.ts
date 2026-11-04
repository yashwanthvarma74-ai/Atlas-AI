import { expect, test } from '@playwright/test';
import {
  askFromWorkspace,
  openMyWorkspace,
  signInWithADocument,
  waitUntilSearchable,
} from './helpers';

test('a guest uploads a document, searches it, asks about it and opens the citation', async ({
  page,
}) => {
  await signInWithADocument(page);

  // search: the index catches up a moment after the status says indexed
  await waitUntilSearchable(page);

  // ask, and read the answer as it is saved
  // asked from the workspace page: it opens a conversation and the answer streams there
  await askFromWorkspace(page, 'Who led the Orion project?');

  const log = page.getByRole('list', { name: 'Conversation' });
  await expect(log.getByText('Priya Raman').first()).toBeVisible();

  // the citation names its source and opens the exact passage
  const chip = log.getByRole('button', { name: /^Source S1: orion\.txt, page 1/ }).first();
  await chip.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // the cited passage is the one marked as current
  await expect(dialog.locator('[aria-current="true"]')).toContainText('Priya Raman');
});

test('a person cannot open a workspace that is not theirs', async ({ browser }) => {
  const first = await browser.newPage();
  await signInWithADocument(first);
  const workspace = first.url();

  // a second, separate guest has a different session cookie
  const second = await browser.newPage();
  await second.goto('/');
  await openMyWorkspace(second);
  await second.goto(workspace);
  await expect(second.getByText('orion.txt')).toHaveCount(0);
  await expect(second.getByText(/not found|can.t find|no such/i).first()).toBeVisible();
});
