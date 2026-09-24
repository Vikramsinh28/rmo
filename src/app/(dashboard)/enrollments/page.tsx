'use client';

import { EnrollmentListScreen } from '@/components/organisms/modules/enrollment/EnrollmentListScreen';
import { Suspense } from 'react';

export default function EnrollmentsPage() {
  return (
    <Suspense fallback={null}>
      <EnrollmentListScreen />
    </Suspense>
  );
}
