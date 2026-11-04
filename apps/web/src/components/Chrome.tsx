'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import AppHeader from './AppHeader';
import styles from './Chrome.module.css';

// Inside a workspace the page brings its own sidebar (app/w/[id]/layout.tsx). Everywhere else there is a slim top bar
// and a centred column.
export default function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (/^\/w\/[^/]+/.test(pathname)) return children;
  return (
    <>
      <AppHeader />
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </>
  );
}
