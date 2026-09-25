'use client';

import { DivisionAIScreen } from '@/components/organisms/modules/administration/DivisionAIScreen';
import { use } from 'react';

export default function DivisionAIPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <DivisionAIScreen divisionId={Number(id)} />;
}
