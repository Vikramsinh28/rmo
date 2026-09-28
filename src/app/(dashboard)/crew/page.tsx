'use client';

import { Button } from '@/components/ui/button';
import { ScopeHome } from '@/components/organisms/modules/administration/ScopeHome';
import Link from 'next/link';

export default function CrewPage() {
  return (
    <div className="flex flex-col gap-4">
      <ScopeHome
        title="Crew"
        description="This account can see only its own profile. Organization administration is not available."
      />
      <div className="px-4 pb-6">
        <Button asChild>
          <Link href="/crew/face-enrollment">Open face enrollment</Link>
        </Button>
      </div>
    </div>
  );
}
