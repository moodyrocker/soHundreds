import { Suspense } from 'react';
import { RunwayView } from '@/components/runway/runway-view';

export default function RunwayPage() {
  return (
    <Suspense fallback={<div className="profile-page profile-page--wide"><p className="t-dim">Loading Runway…</p></div>}>
      <RunwayView />
    </Suspense>
  );
}
