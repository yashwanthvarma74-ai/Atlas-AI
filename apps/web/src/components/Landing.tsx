'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Button } from '@yashwanthvarma74/react/components/Button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useGuestLogin, useSession } from '@/lib/queries';
import styles from './Landing.module.css';

const FEATURES = [
  {
    title: 'Answers you can check',
    text: 'Every claim carries a numbered source. Open it and the exact page is there, with the passage marked.',
  },
  {
    title: 'Private by construction',
    text: 'Each workspace is walled off inside every search, not by asking the model to behave.',
  },
  {
    title: 'Measured, not guessed',
    text: 'A 240-question benchmark scores retrieval on every change. Recall@10 is 95.4%, and the build fails if it drops.',
  },
];

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
    <div className={styles.landing}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Private knowledge copilot</p>
          <h1 id="landing-title" className={styles.title}>
            Ask your documents.
            <br />
            <span className={styles.accent}>Check the answer.</span>
          </h1>
          <p className={styles.pitch}>
            Upload PDFs, notes and images into a private workspace, then ask in plain words. The
            answer streams in, explained, with citations that open the exact page it came from.
          </p>

          <div className={styles.actions}>
            <Button variant="primary" size="lg" loading={guest.isPending} onClick={continueAsGuest}>
              Continue as guest
            </Button>
            <Link href="/login" className={styles.secondary}>
              Sign in
            </Link>
          </div>
          <p className={styles.note}>
            No sign-up. A guest gets a workspace of their own, and the demo keeps nothing for long.{' '}
            <Link href="/register">Create an account</Link> instead.
          </p>

          {guest.error && (
            <Alert variant="danger" title="Could not start a guest session">
              {guest.error.message}
            </Alert>
          )}
        </div>

        {/* a still of what an answer looks like, so the page shows what the product does before anyone signs in */}
        <figure className={styles.preview} aria-label="An example answer">
          <div className={styles.question}>What did the Orion project cost, and who led it?</div>
          <div className={styles.answer}>
            <p>
              The Orion project had a budget of <strong>1.2 million dollars</strong>{' '}
              <span className={styles.chip}>S1</span> and was led by <strong>Priya Raman</strong>,
              who launched it in March 2025 <span className={styles.chip}>S1</span>.
            </p>
            <p>
              The team shipped the billing rewrite in June <span className={styles.chip}>S2</span>.
            </p>
            <div className={styles.sources}>
              <span className={styles.source}>
                <span className={styles.sourceNumber}>S1</span> orion-plan.pdf · page 3
              </span>
              <span className={styles.source}>
                <span className={styles.sourceNumber}>S2</span> q2-update.pdf · page 1
              </span>
            </div>
          </div>
          <figcaption className={styles.caption}>
            An example answer · every number opens the page it came from
          </figcaption>
        </figure>
      </section>

      <section className={styles.features} aria-label="What it does">
        {FEATURES.map((feature) => (
          <div key={feature.title} className={styles.feature}>
            <h2 className={styles.featureTitle}>{feature.title}</h2>
            <p className={styles.featureText}>{feature.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
