'use client';

import { DeviceScreen } from '@/components/organisms/modules/administration/DeviceScreen';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function DevicesContent() {
  const type = useSearchParams().get('type') || undefined;
  return <DeviceScreen initialType={type || undefined} />;
}

export default function DevicesPage() {
  return (
    <Suspense fallback={<p className="px-4 text-sm text-muted-foreground">Loading devices…</p>}>
      <DevicesContent />
    </Suspense>
  );
}
