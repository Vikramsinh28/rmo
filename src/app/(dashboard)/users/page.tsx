'use client';

import { UserScreen } from '@/components/organisms/modules/administration/UserScreen';
import { useAuthStore } from '@/store/auth';

export default function UsersPage() {
  const user = useAuthStore(state => state.user);
  const role = user?.rmoRole || user?.role;
  const canWrite = role === 'SYSTEM_ADMIN' || role === 'DIVISION_ADMIN';
  return (
    <UserScreen
      canWrite={canWrite}
      actorRole={role === 'DIVISION_ADMIN' ? 'DIVISION_ADMIN' : 'SYSTEM_ADMIN'}
      homeZoneId={user?.homeZoneId}
      homeDivisionId={user?.homeDivisionId}
    />
  );
}
