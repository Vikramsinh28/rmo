import { RmoError } from '@/lib/rmo/errors';
import type { Actor } from '@/services/internal/rmo/administration';
import { recordAudit } from '@/services/internal/rmo/audit-event';
import { seedClientFormsForDivision } from '@/services/internal/rmo/client-registers';
import { assertFormManager, rejectForeignDivision } from '@/services/internal/rmo/submission-scope';

export async function seedClientForms(actor: Actor, input: { divisionId?: number }) {
  assertFormManager(actor);
  const divisionId =
    actor.rmoRole === 'SYSTEM_ADMIN' ? input.divisionId : actor.homeDivisionId ?? undefined;
  if (divisionId == null || !Number.isInteger(divisionId)) {
    throw new RmoError('A division is required.', 400);
  }
  rejectForeignDivision(actor, divisionId);

  const result = await seedClientFormsForDivision({
    divisionId,
    createdById: actor.id,
    assignDivisionWide: true,
  });

  await recordAudit(actor.id, 'form.client_forms_seeded', 'form', null, {
    divisionId,
    formCount: result.results.length,
    createdCount: result.results.filter(row => row.created).length,
    formNames: result.results.map(row => row.formName),
  });

  return result;
}
