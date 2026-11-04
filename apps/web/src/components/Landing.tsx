'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Button } from '@yashwanthvarma74/react/components/Button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useGuestLogin, useSession } from '@/lib/queries';
import Logo from './Logo';
import styles from './Landing.module.css';

export default function Landing() {
  const router = useRouter();
  const { data: user } = useSession();
  const guest = useGuestLogin();

  useEffect(() => {
    if (user) router.replace('/workspaces');
  }, [user, router]);

  // A new guest has exactly one workspace, so they go straight into it.
  function continueAsGuest() {
    guest.mutate(undefined, {
      onSuccess: async () => {
        const [first] = await api.workspaces().catch(() => []);
        router.push(first ? `/w/${first.id}` : '/workspaces');
      },
    });
  }

  return (
    <section className={styles.landing} aria-labelledby="landing-title">
      <Logo />
      <div className={styles.text}>
        <h1 id="landing-title" className={styles.title}>
          Ask your documents
        </h1>
        <p className={styles.pitch}>
          Upload PDFs, notes and images to a private workspace and ask questions in plain words.
          Every answer cites the page it came from, so you can check it.
        </p>
      </div>

      <div className={styles.actions}>
        <Button variant="primary" size="lg" loading={guest.isPending} onClick={continueAsGuest}>
          Continue as guest
        </Button>
        <p className={styles.other}>
          <Link href="/login">Sign in</Link>
          <span aria-hidden="true">·</span>
          <Link href="/register">Create an account</Link>
        </p>
      </div>

      {guest.error && (
        <Alert variant="danger" title="Could not start a guest session">
          {guest.error.message}
        </Alert>
      )}

      <p className={styles.note}>
        This is a demo. A guest&rsquo;s workspace is emptied when the page is reloaded, and nothing
        is kept for more than three hours.
      </p>
    </section>
  );
}
