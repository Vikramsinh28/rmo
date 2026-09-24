'use client';

import { OrgScreen } from '@/components/organisms/modules/administration/OrgScreen';
import { ScopeHome } from '@/components/organisms/modules/administration/ScopeHome';
import { useAuthStore } from '@/store/auth';

export default function DivisionsPage() {
  const role = useAuthStore(state => state.user?.rmoRole || state.user?.role);
  const system = role === 'SYSTEM_ADMIN';
  if (!system) {
    return (
      <ScopeHome
        title="Division"
        description="This account can see its own division. Other divisions are rejected by the server."
      />
    );
  }
  return <OrgScreen kind="divisions" canWrite />;
}
