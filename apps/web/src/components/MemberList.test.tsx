import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Member, Role } from '@atlas/shared';
import { expectNoAxeViolations, json, renderWithProviders } from '@/test/render';
import MemberList from './MemberList';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const members: Member[] = [
  { userId: 'u1', name: 'Olivia', email: 'olivia@example.com', role: 'owner', joinedAt: '' },
  { userId: 'u2', name: 'Eddie', email: 'eddie@example.com', role: 'editor', joinedAt: '' },
  { userId: 'u3', name: 'Vera', email: 'vera@example.com', role: 'viewer', joinedAt: '' },
];

function show(userId: string, role: Role) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
    init?.method === 'DELETE' ? json(204) : json(200, { members }),
  );
  return renderWithProviders(<MemberList workspaceId="w1" userId={userId} role={role} />);
}

describe('MemberList', () => {
  it('lets the owner add people and change or remove everyone but themselves', async () => {
    const { container } = show('u1', 'owner');
    await screen.findByText('Eddie');

    expect(screen.getByLabelText('Add someone by email')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Eddie' })).toHaveValue('editor');
    expect(screen.getByRole('button', { name: 'Remove Vera' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for Olivia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Olivia|Leave/ })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('gives an editor no way to manage others, only to leave', async () => {
    show('u2', 'editor');
    await screen.findByText('Eddie (you)');

    expect(screen.queryByLabelText('Add someone by email')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Role for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeInTheDocument();
  });

  it('asks before removing someone, and removes them once confirmed', async () => {
    const user = userEvent.setup();
    show('u1', 'owner');
    await screen.findByText('Vera');

    await user.click(screen.getByRole('button', { name: 'Remove Vera' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove Vera?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/workspaces/w1/members/u3',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('returns to the workspace list after the user leaves', async () => {
    const user = userEvent.setup();
    show('u3', 'viewer');
    await screen.findByText('Vera (you)');

    await user.click(screen.getByRole('button', { name: 'Leave workspace' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith('/workspaces'));
  });
});
