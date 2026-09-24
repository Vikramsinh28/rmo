'use client';

import { LobbyDetail } from '@/components/organisms/modules/administration/LobbyDetail';
import { useParams } from 'next/navigation';

export default function LobbyDetailPage() {
  const params = useParams<{ id: string }>();
  return <LobbyDetail lobbyId={Number(params.id)} />;
}
