import type { Metadata } from 'next';
import AuditTrail from '@/components/AuditTrail';

export const metadata: Metadata = { title: 'Audit trail' };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AuditTrail workspaceId={id} />;
}
