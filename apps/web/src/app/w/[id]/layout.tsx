import type { ReactNode } from 'react';
import WorkspaceShell from '@/components/WorkspaceShell';

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  return <WorkspaceShell id={id}>{children}</WorkspaceShell>;
}
