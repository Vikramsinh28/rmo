'use client';

import { PublicCrewFormScreen } from '@/components/organisms/modules/forms/PublicCrewFormScreen';
import { use } from 'react';

export default function PublicCrewFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  return <PublicCrewFormScreen token={decodeURIComponent(token)} />;
}
