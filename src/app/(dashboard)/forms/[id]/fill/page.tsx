'use client';

import { FormFillScreen } from '@/components/organisms/modules/forms/FormFillScreen';
import { useParams } from 'next/navigation';

export default function FormFillPage() {
  const params = useParams<{ id: string }>();
  return <FormFillScreen formId={Number(params.id)} />;
}
