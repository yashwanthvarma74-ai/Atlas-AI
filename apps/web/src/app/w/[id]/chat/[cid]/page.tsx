import ChatThread from '@/components/ChatThread';

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string; cid: string }>;
}) {
  const { id, cid } = await params;
  return <ChatThread workspaceId={id} conversationId={cid} />;
}
