import { CallStage } from '@/components/organisms/modules/monitoring/CallStage';

export default async function MonitoringCallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex min-h-0 flex-1">
      <CallStage callId={Number(id)} />
    </div>
  );
}
