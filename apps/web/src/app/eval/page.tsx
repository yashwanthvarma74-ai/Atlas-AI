import type { Metadata } from 'next';
import EvalDashboard from '@/components/EvalDashboard';

export const metadata: Metadata = { title: 'Evaluation' };

export default function EvalPage() {
  return <EvalDashboard />;
}
