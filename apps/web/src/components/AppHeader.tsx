'use client';

import Link from 'next/link';
import { useSession } from '@/lib/queries';
import AccountMenu from './AccountMenu';
import Logo from './Logo';
import styles from './AppHeader.module.css';

export default function AppHeader() {
  const { data: user } = useSession();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href={user ? '/workspaces' : '/'} className={styles.brand}>
          <Logo />
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
