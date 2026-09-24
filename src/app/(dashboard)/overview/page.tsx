'use client';

import { AdminDashboard } from '@/components/organisms/modules/administration/AdminDashboard';
import { DivisionDashboard } from '@/components/organisms/modules/administration/DivisionDashboard';
import { ScopeHome } from '@/components/organisms/modules/administration/ScopeHome';
import { useAuthStore } from '@/store/auth';

export default function OverviewPage() {
  const role = useAuthStore(state => state.user?.rmoRole || state.user?.role);
  if (role === 'SYSTEM_ADMIN') return <AdminDashboard />;
  if (role === 'DIVISION_ADMIN') return <DivisionDashboard />;
  return (
    <ScopeHome
      title="Dashboard"
      description="Your signed-in role and the location assigned to this account."
    />
  );
}
