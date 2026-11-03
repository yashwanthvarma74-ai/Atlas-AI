import type { Metadata } from 'next';
import ChatList from '@/components/ChatList';

export const metadata: Metadata = { title: 'Conversations' };

export default async function ChatListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatList workspaceId={id} />;
}
