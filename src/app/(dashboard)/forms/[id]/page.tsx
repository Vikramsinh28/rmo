'use client';

import { FormBuilderScreen } from '@/components/organisms/modules/forms/FormBuilderScreen';
import { useParams } from 'next/navigation';

export default function FormDetailPage() {
  const params = useParams<{ id: string }>();
  return <FormBuilderScreen formId={Number(params.id)} />;
}
