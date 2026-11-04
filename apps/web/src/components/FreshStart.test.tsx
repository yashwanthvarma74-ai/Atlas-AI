import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FreshStart from './FreshStart';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

describe('FreshStart', () => {
  it('asks for a clear slate before drawing a page of the person’s data', async () => {
    pathname = '/w/w1';
    let finish: (res: Response) => void = () => {};
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));

    render(<FreshStart>documents</FreshStart>);
    expect(screen.queryByText('documents')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/me/data',
      expect.objectContaining({ method: 'DELETE' }),
    );

    finish(new Response(null, { status: 204 }));
    await waitFor(() => expect(screen.getByText('documents')).toBeInTheDocument());
  });

  it('draws a page with nothing of theirs at once, and carries on if clearing fails', async () => {
    pathname = '/';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    render(<FreshStart>landing</FreshStart>);
    expect(screen.getByText('landing')).toBeInTheDocument();
  });
});
