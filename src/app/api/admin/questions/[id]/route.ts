import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { getQuestion, setQuestionRegisters, updateQuestion } from '@/services/internal/rmo/questions';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    return successResponse(await getQuestion(auth.actor, Number(id)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (Array.isArray(body.registerTypeIds)) {
      return successResponse(
        await setQuestionRegisters(auth.actor, Number(id), body.registerTypeIds),
      );
    }
    return successResponse(await updateQuestion(auth.actor, Number(id), body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
