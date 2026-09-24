'use client';

import { OrgScreen } from '@/components/organisms/modules/administration/OrgScreen';
import { ScopeHome } from '@/components/organisms/modules/administration/ScopeHome';
import { useAuthStore } from '@/store/auth';

export default function LobbiesPage() {
  const role = useAuthStore(state => state.user?.rmoRole || state.user?.role);
  const system = role === 'SYSTEM_ADMIN';
  const division =
    role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR';
  if (!system && !division) {
    return (
      <ScopeHome
        title="Lobby"
        description="This account can see its own lobby. Other lobbies are rejected by the server."
      />
    );
  }
  return <OrgScreen kind="lobbies" canWrite={system} />;
}
