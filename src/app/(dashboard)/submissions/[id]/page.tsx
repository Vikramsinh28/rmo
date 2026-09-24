'use client';

import { SubmissionDetailScreen } from '@/components/organisms/modules/forms/SubmissionDetailScreen';
import { useParams } from 'next/navigation';

export default function SubmissionDetailPage() {
  const params = useParams<{ id: string }>();
  return <SubmissionDetailScreen submissionId={Number(params.id)} />;
}
