import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import {
  removeRegisterQuestion,
  updateRegisterQuestion,
} from '@/services/internal/rmo/registers';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; mappingId: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id, mappingId } = await context.params;
    const body = await request.json();
    return successResponse(
      await updateRegisterQuestion(auth.actor, Number(id), Number(mappingId), body),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; mappingId: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id, mappingId } = await context.params;
    return successResponse(
      await removeRegisterQuestion(auth.actor, Number(id), Number(mappingId)),
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
