import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OperatorDashboard } from '@/components/operator/dashboard';
import { isOperator } from '@/lib/server';

export const metadata: Metadata = { title: 'Operator' };

// Only accounts listed in OPERATOR_EMAILS; everyone else gets a plain 404
export default async function OperatorPage() {
  if (!(await isOperator())) notFound();
  return <OperatorDashboard />;
}
