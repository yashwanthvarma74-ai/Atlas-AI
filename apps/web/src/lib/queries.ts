'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { LoginInput, MemberRole, RegisterInput, SessionUser } from '@atlas/shared';
import { api } from './api';

const keys = {
  session: ['session'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  members: (id: string) => ['workspaces', id, 'members'] as const,
};

export function useSession() {
  return useQuery({ queryKey: keys.session, queryFn: api.me, staleTime: 60_000 });
}

// For pages that need someone signed in: sends everyone else to the sign-in page.
export function useRequireUser(): { user: SessionUser | null; loading: boolean } {
  const router = useRouter();
  const { data, isPending } = useSession();
  useEffect(() => {
    if (data === null) router.replace('/login');
  }, [data, router]);
  return { user: data ?? null, loading: isPending || data === null };
}

// A different person is now signed in, so nothing cached for the previous one may be shown.
function useStartSession() {
  const queryClient = useQueryClient();
  return (user: SessionUser) => {
    queryClient.removeQueries({ queryKey: keys.workspaces });
    queryClient.setQueryData(keys.session, user);
  };
}

export function useRegister() {
  const start = useStartSession();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.register(input),
    onSuccess: start,
  });
}

export function useLogin() {
  const start = useStartSession();
  return useMutation({ mutationFn: (input: LoginInput) => api.login(input), onSuccess: start });
}

export function useGuestLogin() {
  const start = useStartSession();
  return useMutation({ mutationFn: api.continueAsGuest, onSuccess: start });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(keys.session, null);
    },
  });
}

export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: api.workspaces });
}

export function useWorkspace(id: string) {
  return useQuery({ queryKey: keys.workspace(id), queryFn: () => api.workspace(id), retry: false });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createWorkspace({ name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useMembers(workspaceId: string) {
  return useQuery({ queryKey: keys.members(workspaceId), queryFn: () => api.members(workspaceId) });
}

export function useAddMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: MemberRole }) => api.addMember(workspaceId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) }),
  });
}

export function useChangeRole(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; role: MemberRole }) =>
      api.changeRole(workspaceId, vars.userId, vars.role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) }),
  });
}

export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(workspaceId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) }),
  });
}
