'use client';

import { MasterDataScreen } from '@/components/organisms/modules/forms/MasterDataScreen';

export default function DutyTypesPage() {
  return <MasterDataScreen kind="duty type" title="Duty Types" apiPath="/api/admin/duty-types" />;
}
