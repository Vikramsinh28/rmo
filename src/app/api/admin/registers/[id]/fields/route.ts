import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import {
  addRegisterQuestion,
  listRegisterFields,
  reorderRegisterQuestions,
  replaceRegisterFields,
} from '@/services/internal/rmo/registers';
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
    return successResponse(await listRegisterFields(auth.actor, Number(id)));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    if (body?.action === 'reorder') {
      return successResponse(
        await reorderRegisterQuestions(auth.actor, Number(id), body.orderedIds || []),
      );
    }
    return successResponse(await addRegisterQuestion(auth.actor, Number(id), body), 201);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    const body = await request.json();
    return successResponse(await replaceRegisterFields(auth.actor, Number(id), body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}
