'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Button } from '@yashwanthvarma74/react/components/Button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useGuestLogin, useSession } from '@/lib/queries';
import styles from './Landing.module.css';

export default function Landing() {
  const router = useRouter();
  const { data: user } = useSession();
  const guest = useGuestLogin();

  useEffect(() => {
    if (user) router.replace('/workspaces');
  }, [user, router]);

  return (
    <section className={styles.landing} aria-labelledby="landing-title">
      <p className={styles.eyebrow}>Private knowledge copilot</p>
      <h1 id="landing-title" className={styles.title}>
        Ask your documents. Check the answer.
      </h1>
      <p className={styles.pitch}>
        Upload your PDFs, notes and images into a private workspace, then ask questions. Every
        answer streams in with citations that open the exact page it came from.
      </p>

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="lg"
          loading={guest.isPending}
          onClick={() => guest.mutate(undefined, { onSuccess: () => router.push('/workspaces') })}
        >
          Continue as guest
        </Button>
        <p className={styles.note}>No sign up. You get a temporary account with a workspace.</p>
      </div>

      {guest.error && (
        <Alert variant="danger" title="Could not start a guest session">
          {guest.error.message}
        </Alert>
      )}

      <p className={styles.note}>
        Prefer your own account? <Link href="/login">Sign in</Link> or{' '}
        <Link href="/register">create one</Link>.
      </p>
    </section>
  );
}
