'use client';

import { LiveWorkspace } from '@/components/organisms/modules/administration/LiveWorkspace';
import { LobbyMonitorScreen } from '@/components/organisms/modules/monitoring/LobbyMonitorScreen';
import { useAuthStore } from '@/store/auth';

export function MonitoringHome() {
  const role = useAuthStore(state => state.user?.rmoRole);
  if (role === 'DIVISION_MONITOR' || role === 'SYSTEM_ADMIN') {
    return <LobbyMonitorScreen />;
  }
  return <LiveWorkspace />;
}
