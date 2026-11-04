'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@yashwanthvarma74/react/components/Toast';
import { useState, type ReactNode } from 'react';
import { ThemeProvider } from '@/lib/theme';
import FreshStart from './FreshStart';

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <FreshStart>{children}</FreshStart>
        </QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
