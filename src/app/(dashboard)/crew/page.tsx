'use client';

import { ScopeHome } from '@/components/organisms/modules/administration/ScopeHome';

export default function CrewPage() {
  return (
    <ScopeHome
      title="Crew"
      description="This account can see only its own profile. Organization administration is not available."
    />
  );
}
