'use client';

import { RegisterDetailScreen } from '@/components/organisms/modules/forms/RegisterDetailScreen';
import { use } from 'react';

export default function RegisterDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <RegisterDetailScreen registerId={Number(id)} />;
}
