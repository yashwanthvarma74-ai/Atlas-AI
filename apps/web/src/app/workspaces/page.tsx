import type { Metadata } from 'next';
import WorkspaceList from '@/components/WorkspaceList';

export const metadata: Metadata = { title: 'Workspaces' };

export default function WorkspacesPage() {
  return <WorkspaceList />;
}
