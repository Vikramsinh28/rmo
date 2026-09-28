'use client';

import { SafetyEventsScreen } from '@/components/organisms/modules/monitoring/SafetyEventsScreen';
import { Suspense } from 'react';

export default function SafetyEventsPage() {
  return (
    <Suspense fallback={null}>
      <SafetyEventsScreen />
    </Suspense>
  );
}
