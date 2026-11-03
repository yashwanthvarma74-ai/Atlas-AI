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
          Atlas AI
        </Link>
        <AccountMenu user={user ?? null} />
      </div>
    </header>
  );
}
