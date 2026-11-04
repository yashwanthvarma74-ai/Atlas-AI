'use client';

import { Spinner } from '@yashwanthvarma74/react/components/Spinner';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

// Pages that show a person's documents or conversations. Everything else (the landing page, sign-in) has nothing of
// theirs on it and draws at once.
const SHOWS_DATA = /^\/(w|workspaces)(\/|$)/;

// The demo starts every visit empty: when a page is loaded (or reloaded), the API is asked to clear this person's own
// workspaces before anything of theirs is fetched, so nothing from before is drawn and then taken away. Moving between
// pages inside the app is not a visit, so it clears nothing. The API decides whether clearing is on.
export default function FreshStart({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    // signed out, switched off or unreachable: the page carries on either way
    api
      .clearMyData()
      .catch(() => undefined)
      .finally(() => setCleared(true));
  }, []);

  if (!cleared && SHOWS_DATA.test(pathname)) {
    return <Spinner label="Starting a fresh session" />;
  }
  return children;
}
