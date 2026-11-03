import WorkspaceView from '@/components/WorkspaceView';

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceView id={id} />;
}
