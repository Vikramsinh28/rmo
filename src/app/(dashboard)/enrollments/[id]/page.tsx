'use client';

import { EnrollmentReviewScreen } from '@/components/organisms/modules/enrollment/EnrollmentReviewScreen';
import { useParams } from 'next/navigation';

export default function EnrollmentReviewPage() {
  const params = useParams<{ id: string }>();
  return <EnrollmentReviewScreen enrollmentId={Number(params.id)} />;
}
