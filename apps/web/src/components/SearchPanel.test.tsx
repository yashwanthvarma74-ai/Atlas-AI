import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Passage, SearchSource } from '@atlas/shared';
import { expectNoAxeViolations, json, renderWithProviders } from '@/test/render';
import SearchPanel from './SearchPanel';

const source = (n: number, fields: Partial<SearchSource> = {}): SearchSource => ({
  n,
  chunkId: `c${n}`,
  documentId: `d${n}`,
  documentName: `report-${n}.pdf`,
  page: n + 2,
  text: `Passage ${n} says revenue grew.`,
  score: 0.03,
  ...fields,
});

function show(sources: SearchSource[], passages: Passage[] = []) {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('/passages')) return json(200, { passages });
    if (init?.method === 'POST') return json(200, { sources });
    return json(404);
  });
  return { fetch, ...renderWithProviders(<SearchPanel workspaceId="w1" />) };
}

async function ask(question: string) {
  await userEvent.type(screen.getByLabelText('Search your documents'), question);
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
}

describe('SearchPanel', () => {
  it('has no accessibility violations', async () => {
    const { container } = show([]);
    await expectNoAxeViolations(container);
  });

  it('sends the question and lists numbered passages with their document and page', async () => {
    const { fetch } = show([source(1), source(2)]);
    await ask('revenue growth');

    expect(await screen.findByText('report-1.pdf, page 3')).toBeInTheDocument();
    expect(screen.getByText('S1')).toBeInTheDocument();
    expect(screen.getByText('S2')).toBeInTheDocument();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/workspaces/w1/search');
    expect(JSON.parse(init!.body as string)).toEqual({ query: 'revenue growth' });
  });

  it('announces how many passages were found', async () => {
    show([source(1), source(2), source(3)]);
    await ask('revenue');
    expect(await screen.findByText('3 passages found')).toBeInTheDocument();
  });

  it('says so when nothing matched', async () => {
    show([]);
    await ask('nothing here');
    expect(await screen.findByText(/No passages matched/)).toBeInTheDocument();
  });

  it('shows the server reason when search is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(503, {
        error: { code: 'unavailable', message: 'The embedding service is unavailable.' },
      }),
    );
    renderWithProviders(<SearchPanel workspaceId="w1" />);
    await ask('anything');
    expect(await screen.findByText('The embedding service is unavailable.')).toBeInTheDocument();
  });

  it('does not search for a blank question', async () => {
    const { fetch } = show([source(1)]);
    await userEvent.type(screen.getByLabelText('Search your documents'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens the cited page and marks the cited passage among its neighbours', async () => {
    show(
      [source(2, { chunkId: 'cited' })],
      [
        { id: 'before', ord: 4, page: 4, text: 'The text before it.' },
        { id: 'cited', ord: 5, page: 4, text: 'The passage that was cited.' },
        { id: 'after', ord: 6, page: 4, text: 'The text after it.' },
      ],
    );
    await ask('cited');
    await userEvent.click(await screen.findByRole('button', { name: 'Show in context: S2' }));

    const dialog = await screen.findByRole('dialog');
    expect(await screen.findByText('The text before it.')).toBeInTheDocument();
    await waitFor(() => {
      const marked = dialog.querySelectorAll('[aria-current="true"]');
      expect(marked).toHaveLength(1);
      expect(marked[0]).toHaveTextContent('The passage that was cited.');
    });
    expect(dialog).toHaveTextContent('report-2.pdf, page 4');
  });
});
