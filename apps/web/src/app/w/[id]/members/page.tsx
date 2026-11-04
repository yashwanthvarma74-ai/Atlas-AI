import type { Metadata } from 'next';
import MembersView from '@/components/MembersView';

export const metadata: Metadata = { title: 'Members' };

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MembersView id={id} />;
}
