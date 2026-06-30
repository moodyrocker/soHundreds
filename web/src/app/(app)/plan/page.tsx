import { Suspense } from 'react';
import { PlanView } from '@/components/plan/plan-view';

export default function PlanPage() {
  return (
    <Suspense fallback={<p className="auth-sub">Loading your plan…</p>}>
      <PlanView />
    </Suspense>
  );
}
