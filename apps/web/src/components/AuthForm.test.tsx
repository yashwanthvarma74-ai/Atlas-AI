import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, json, renderWithProviders } from '@/test/render';
import AuthForm from './AuthForm';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const ada = { id: '1', name: 'Ada', email: 'ada@example.com', guest: false };

beforeEach(() => push.mockClear());

describe('AuthForm in login mode', () => {
  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<AuthForm mode="login" />);
    await expectNoAxeViolations(container);
  });

  it('signs in and moves on to the workspaces', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { user: ada }));
    renderWithProviders(<AuthForm mode="login" />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/workspaces'));
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/auth/login');
    expect(JSON.parse(init!.body as string)).toEqual({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });
  });

  it('shows the server message when the password is wrong, and stays on the page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(401, { error: { code: 'unauthorized', message: 'Email or password is incorrect.' } }),
    );
    renderWithProviders(<AuthForm mode="login" />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('AuthForm in register mode', () => {
  it('asks for a name and states the password rule', async () => {
    const { container } = renderWithProviders(<AuthForm mode="register" />);

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
