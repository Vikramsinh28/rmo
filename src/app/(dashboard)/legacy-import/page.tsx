'use client';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/components/organisms/modules/administration/api';
import { useState } from 'react';
import { toast } from 'sonner';

interface ImportResult {
  summary: Record<string, number>;
  report: Array<{ bucket: string; entity: string; key: string; message: string }>;
}

const SAMPLE = `{
  "crewTypes": [{ "code": "ALP", "name": "ALP" }],
  "dutyTypes": [{ "code": "SIGN_ON", "name": "Sign On" }],
  "registerTypes": [{ "code": "DETONATOR", "name": "Detonator" }],
  "questions": [{
    "code": "DET_CHECKED",
    "text": "Was the detonator checked?",
    "type": "YES_NO",
    "registers": ["DETONATOR"]
  }],
  "configurations": [{
    "questionCode": "DET_CHECKED",
    "crewTypeCode": "ALP",
    "dutyTypeCode": "SIGN_ON"
  }],
  "users": [{ "loginId": "crew1", "staffType": "ALP" }],
  "submissions": []
}`;

export default function LegacyImportPage() {
  const [payload, setPayload] = useState(SAMPLE);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const parsed = JSON.parse(payload);
      const response = await apiRequest<ImportResult>('/api/admin/legacy-import', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      setResult(response);
      toast.success('Import completed');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Legacy Import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          File-based JSON import. Unmapped rows are reported — never silently discarded.
        </p>
      </div>
      <textarea
        className="min-h-[320px] w-full rounded-md border bg-background p-3 font-mono text-xs"
        value={payload}
        onChange={event => setPayload(event.target.value)}
      />
      <Button className="h-9 w-fit" disabled={busy} onClick={() => void run()}>
        {busy ? 'Importing…' : 'Run import'}
      </Button>
      {result ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-5">
            {Object.entries(result.summary).map(([key, value]) => (
              <div key={key} className="rounded-lg border p-3 text-sm">
                <div className="text-muted-foreground">{key}</div>
                <div className="text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Bucket</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Key</th>
                  <th className="px-3 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {result.report.map((row, index) => (
                  <tr key={`${row.entity}-${row.key}-${index}`} className="border-t">
                    <td className="px-3 py-2">{row.bucket}</td>
                    <td className="px-3 py-2">{row.entity}</td>
                    <td className="px-3 py-2">{row.key}</td>
                    <td className="px-3 py-2">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
