'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { hasRole } from '@atlas/shared';
import { useSession, useWorkspace } from '@/lib/queries';
import AccountMenu from './AccountMenu';
import Logo from './Logo';
import styles from './WorkspaceShell.module.css';

// 16-pixel outline icons, drawn once here so the navigation does not need an icon library
const ICONS = {
  documents: 'M5 2.5h4.5L13 6v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM9.5 2.5V6H13',
  conversations:
    'M3 4a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 13 4v5.5a1.5 1.5 0 0 1-1.5 1.5H7L4 13.5V11H4.5A1.5 1.5 0 0 1 3 9.5Z',
  members:
    'M6 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.5 13.5c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5M11 2.7a2.5 2.5 0 0 1 0 4.6M12.5 10.2c1.3.5 2 1.6 2 3.3',
  audit: 'M8 1.5 13.5 3.5v4c0 3.2-2.3 5.6-5.5 7-3.2-1.4-5.5-3.8-5.5-7v-4ZM5.8 8l1.6 1.6L10.5 6.5',
  back: 'M10 3.5 5.5 8l4.5 4.5',
};

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" className={styles.icon} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

// Everything inside a workspace: where you are, where you can go, and who you are signed in as, always in the same
// place. The page itself gets the rest of the width.
export default function WorkspaceShell({ id, children }: { id: string; children: ReactNode }) {
  const pathname = usePathname();
  const { data: user } = useSession();
  const workspace = useWorkspace(id);
  const base = `/w/${id}`;
  const canAudit = workspace.data ? hasRole(workspace.data.role, 'editor') : false;

  const items = [
    { href: base, label: 'Documents', icon: ICONS.documents, exact: true },
    { href: `${base}/chat`, label: 'Conversations', icon: ICONS.conversations },
    { href: `${base}/members`, label: 'Members', icon: ICONS.members },
    ...(canAudit ? [{ href: `${base}/audit`, label: 'Audit trail', icon: ICONS.audit }] : []),
  ];
  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/workspaces" className={styles.brand}>
          <Logo />
          <span className={styles.brandName}>Atlas AI</span>
        </Link>

        <div className={styles.workspace}>
          <span className={styles.label}>Workspace</span>
          <span className={styles.name} title={workspace.data?.name}>
            {workspace.data?.name ?? ' '}
          </span>
        </div>

        <nav aria-label="Workspace" className={styles.nav}>
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.item}
              aria-current={active(item.href, item.exact) ? 'page' : undefined}
            >
              <Icon path={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.footer}>
          <Link href="/workspaces" className={styles.item}>
            <Icon path={ICONS.back} />
            All workspaces
          </Link>
          <Link href="/eval" className={styles.item}>
            <Icon path="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />
            Evaluation
          </Link>
          <div className={styles.account}>
            <AccountMenu user={user ?? null} />
          </div>
        </div>
      </aside>

      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </div>
  );
}
