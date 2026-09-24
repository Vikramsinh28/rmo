'use client';

import { OrgScreen } from '@/components/organisms/modules/administration/OrgScreen';
import { ScopeHome } from '@/components/organisms/modules/administration/ScopeHome';
import { useAuthStore } from '@/store/auth';

export default function ZonesPage() {
  const role = useAuthStore(state => state.user?.rmoRole || state.user?.role);
  const canWrite = role === 'SYSTEM_ADMIN';
  if (!canWrite) {
    return <ScopeHome title="Zones" description="Zone administration is limited to system roles." />;
  }
  return <OrgScreen kind="zones" canWrite />;
}
