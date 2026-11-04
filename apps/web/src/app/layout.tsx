import type { Metadata } from 'next';
import '@yashwanthvarma74/react/styles.css';
import '@/styles/base.css';
import Chrome from '@/components/Chrome';
import Providers from '@/components/Providers';
import ThemeScript from '@/components/ThemeScript';
import styles from './layout.module.css';

export const metadata: Metadata = {
  title: { default: 'Atlas AI', template: '%s | Atlas AI' },
  authors: [{ name: 'Yashwanth Varma', url: 'https://github.com/yashwanthvarmakonduru' }],
  description:
    'A private knowledge copilot: upload your documents, ask questions, and get streamed answers with citations you can check.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script sets data-theme before first paint, so the attribute differs from the server's.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <Providers>
          <a href="#main" className={styles.skipLink}>
            Skip to main content
          </a>
          <Chrome>{children}</Chrome>
        </Providers>
      </body>
    </html>
  );
}
