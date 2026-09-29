'use client';

import { MasterDataScreen } from '@/components/organisms/modules/forms/MasterDataScreen';

export default function RegisterTypesPage() {
  return (
    <MasterDataScreen kind="register" title="Registers" apiPath="/api/admin/register-types" />
  );
}
