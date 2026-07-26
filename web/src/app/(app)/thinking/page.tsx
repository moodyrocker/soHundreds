import { Suspense } from 'react';
import { ThinkingSequence } from '@/components/thinking/thinking-sequence';

export default function ThinkingPage() {
  return (
    <Suspense fallback={null}>
      <ThinkingSequence />
    </Suspense>
  );
}
