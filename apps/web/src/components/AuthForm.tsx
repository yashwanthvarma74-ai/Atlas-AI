'use client';

import { Alert } from '@yashwanthvarma74/react/components/Alert';
import { Button } from '@yashwanthvarma74/react/components/Button';
import { FormField } from '@yashwanthvarma74/react/components/FormField';
import { Input } from '@yashwanthvarma74/react/components/Input';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@atlas/shared';
import { useLogin, useRegister } from '@/lib/queries';
import styles from './AuthForm.module.css';

const COPY = {
  login: {
    title: 'Sign in',
    submit: 'Sign in',
    switchText: 'New here?',
    switchLink: { href: '/register', label: 'Create an account' },
  },
  register: {
    title: 'Create your account',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchLink: { href: '/login', label: 'Sign in' },
  },
} as const;

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const login = useLogin();
  const register = useRegister();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const copy = COPY[mode];

  const mutation = mode === 'login' ? login : register;

  function submit(event: FormEvent) {
    event.preventDefault();
    const onSuccess = () => router.push('/workspaces');
    if (mode === 'login') login.mutate({ email, password }, { onSuccess });
    else register.mutate({ name, email, password }, { onSuccess });
  }

  return (
    <section className={styles.panel} aria-labelledby="auth-title">
      <h1 id="auth-title">{copy.title}</h1>

      <form className={styles.form} onSubmit={submit}>
        {mode === 'register' && (
          <FormField label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              maxLength={60}
            />
          </FormField>
        )}
        <FormField label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </FormField>
        <FormField
          label="Password"
          required
          description={
            mode === 'register' ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined
          }
        >
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? PASSWORD_MIN_LENGTH : undefined}
          />
        </FormField>

        {mutation.error && (
          <Alert variant="danger" title="Could not continue">
            {mutation.error.message}
          </Alert>
        )}

        <Button type="submit" variant="primary" loading={mutation.isPending} fullWidth>
          {copy.submit}
        </Button>
      </form>

      <p className={styles.switch}>
        {copy.switchText} <Link href={copy.switchLink.href}>{copy.switchLink.label}</Link>
      </p>
    </section>
  );
}
