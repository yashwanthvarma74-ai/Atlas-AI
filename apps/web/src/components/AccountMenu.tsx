'use client';

import { Avatar } from '@yashwanthvarma74/react/components/Avatar';
import { Menu } from '@yashwanthvarma74/react/components/Menu';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@atlas/shared';
import { useLogout } from '@/lib/queries';
import { useTheme, type ThemePreference } from '@/lib/theme';
import styles from './AppHeader.module.css';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Theme: match system' },
  { value: 'light', label: 'Theme: light' },
  { value: 'dark', label: 'Theme: dark' },
  { value: 'high-contrast', label: 'Theme: high contrast' },
];

export default function AccountMenu({ user }: { user: SessionUser | null }) {
  const router = useRouter();
  const logout = useLogout();
  const { preference, setTheme } = useTheme();

  return (
    <Menu>
      <Menu.Trigger
        variant="ghost"
        size="sm"
        aria-label={user ? `Account menu for ${user.name}` : 'Display settings'}
      >
        {user ? (
          <>
            <Avatar name={user.name} size="sm" />
            <span className={styles.name}>{user.name}</span>
          </>
        ) : (
          'Display'
        )}
      </Menu.Trigger>
      <Menu.Content aria-label="Account" placement="bottom end">
        {THEMES.map((theme) => (
          <Menu.Item
            key={theme.value}
            id={`theme-${theme.value}`}
            onAction={() => setTheme(theme.value)}
          >
            {theme.label}
            {preference === theme.value ? ' (current)' : ''}
          </Menu.Item>
        ))}
        {user && <Menu.Separator />}
        {user && (
          <Menu.Item
            id="logout"
            danger
            onAction={() => logout.mutate(undefined, { onSuccess: () => router.push('/') })}
          >
            Sign out
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu>
  );
}
