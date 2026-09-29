'use client';

import { MasterDataScreen } from '@/components/organisms/modules/forms/MasterDataScreen';

export default function CrewTypesPage() {
  return <MasterDataScreen kind="crew type" title="Crew Types" apiPath="/api/admin/crew-types" />;
}
