'use client';

import Link from 'next/link';
import { useSession } from '@/lib/queries';
import AccountMenu from './AccountMenu';
import styles from './AppHeader.module.css';

export default function AppHeader() {
  const { data: user } = useSession();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href={user ? '/workspaces' : '/'} className={styles.brand}>
          <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true">
            <rect width="24" height="24" rx="7" />
            <path d="M7 17.5 12 6l5 11.5M9.2 13h5.6" />
          </svg>
          Atlas AI
        </Link>
        <nav className={styles.right} aria-label="Main">
          {user && (
            <Link href="/workspaces" className={styles.nav}>
              Workspaces
            </Link>
          )}
          {user && (
            <Link href="/eval" className={styles.nav}>
              Evaluation
            </Link>
          )}
          <AccountMenu user={user ?? null} />
        </nav>
      </div>
    </header>
  );
}
