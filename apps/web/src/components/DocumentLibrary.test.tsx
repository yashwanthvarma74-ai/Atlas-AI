import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentSummary, Role } from '@atlas/shared';
import { expectNoAxeViolations, json, renderWithProviders } from '@/test/render';
import DocumentLibrary from './DocumentLibrary';

const doc = (fields: Partial<DocumentSummary>): DocumentSummary => ({
  id: 'd1',
  name: 'report.pdf',
  kind: 'pdf',
  size: 2048,
  status: 'indexed',
  error: null,
  pageCount: 3,
  chunkCount: 12,
  uploadedBy: 'u1',
  createdAt: '2026-11-03T00:00:00.000Z',
  ...fields,
});

function show(documents: DocumentSummary[], role: Role = 'editor') {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'POST' && String(url).includes('/documents?name=')) {
      return json(202, { document: doc({ id: 'new', status: 'queued' }) });
    }
    return init?.method ? json(204) : json(200, { documents });
  });
  return { fetch, ...renderWithProviders(<DocumentLibrary workspaceId="w1" role={role} />) };
}

describe('DocumentLibrary', () => {
  it('shows each document with its status, size, pages and passages', async () => {
    const { container } = show([doc({})]);
    expect(await screen.findByText('report.pdf')).toBeInTheDocument();

    expect(screen.getByText('Indexed')).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB · 3 pages · 12 passages/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows a progress bar while a document is being processed, and not once it is done', async () => {
    show([
      doc({ id: 'a', name: 'busy.pdf', status: 'embedding', pageCount: null, chunkCount: null }),
      doc({ id: 'b', name: 'done.pdf' }),
    ]);
    await screen.findByText('busy.pdf');

    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: 'Processing busy.pdf' })).toHaveAttribute(
      'aria-valuenow',
      '75',
    );
  });

  it('explains why a document failed and offers a retry', async () => {
    const { fetch } = show([
      doc({
        status: 'failed',
        error: 'No text was found in this PDF. Scanned PDFs are not supported yet.',
      }),
    ]);
    await screen.findByText(/Scanned PDFs are not supported/);

    await userEvent.click(screen.getByRole('button', { name: 'Retry report.pdf' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/workspaces/w1/documents/d1/retry',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('uploads each chosen file as an octet-stream body with its name in the query', async () => {
    const { fetch, container } = show([]);
    await screen.findByText('No documents yet');
    const file = new File(['hello'], 'my notes.txt', { type: 'text/plain' });

    await userEvent.upload(container.querySelector('input[type=file]')!, file);

    await waitFor(() => {
      const call = fetch.mock.calls.find(([url]) => String(url).includes('/documents?name='))!;
      expect(call[0]).toBe('/api/workspaces/w1/documents?name=my%20notes.txt');
      expect(call[1]).toMatchObject({
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    });
  });

  it('refuses a file over the limit without sending it', async () => {
    const { fetch, container } = show([]);
    await screen.findByText('No documents yet');
    const huge = new File(['x'], 'huge.pdf');
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 });

    await userEvent.upload(container.querySelector('input[type=file]')!, huge);

    expect(await screen.findByText(/huge\.pdf is over 20 MB/)).toBeInTheDocument();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('gives a viewer the list and downloads, but no way to change anything', async () => {
    const { container } = show([doc({ status: 'failed', error: 'x' })], 'viewer');
    await screen.findByText('report.pdf');

    expect(screen.getByRole('button', { name: 'Download report.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload|Retry|Delete/ })).not.toBeInTheDocument();
    expect(container.querySelector('input[type=file]')).toBeNull();
  });

  it('asks before deleting', async () => {
    const { fetch } = show([doc({})]);
    await screen.findByText('report.pdf');

    await userEvent.click(screen.getByRole('button', { name: 'Delete report.pdf' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });
});
