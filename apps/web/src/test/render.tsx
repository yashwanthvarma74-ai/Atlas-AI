import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@yashwanthvarma74/react/components/Toast';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';

export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <ToastProvider>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </ToastProvider>,
    ),
  };
}

// Fails the test with a readable list when axe finds a violation. Colour contrast needs real layout
// and styles, so it is checked on the tokens (npm run contrast in the design system) and in a browser.
export async function expectNoAxeViolations(container: HTMLElement) {
  const { violations } = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const summary = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);
  if (summary.length > 0) throw new Error(`axe violations:\n${summary.join('\n')}`);
}

export function json(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
