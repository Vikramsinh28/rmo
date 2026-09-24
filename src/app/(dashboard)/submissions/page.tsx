'use client';

import { SubmissionListScreen } from '@/components/organisms/modules/forms/SubmissionListScreen';
import { Suspense } from 'react';

export default function SubmissionsPage() {
  return (
    <Suspense fallback={<p className="px-4 text-sm text-muted-foreground">Loading submissions…</p>}>
      <SubmissionListScreen />
    </Suspense>
  );
}
