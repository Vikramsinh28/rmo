'use client';

import { useAuthStore } from '@/store/auth';
import { CrewFormListScreen } from './CrewFormListScreen';
import { ManagerFormListScreen } from './ManagerFormListScreen';

export function FormListScreen() {
  const role = useAuthStore(state => state.user?.rmoRole);
  if (role === 'CREW_USER') {
    return <CrewFormListScreen />;
  }
  return <ManagerFormListScreen />;
}
