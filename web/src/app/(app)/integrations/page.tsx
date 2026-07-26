import { Suspense } from 'react';
import { IntegrationsView } from '@/components/integrations/integrations-view';

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="dash-greeting">
          <p className="t-dim">Loading integrations…</p>
        </div>
      }
    >
      <IntegrationsView />
    </Suspense>
  );
}
