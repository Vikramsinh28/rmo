import { adminErrorResponse, requireActor } from '@/lib/rmo/guard';
import { successResponse } from '@/lib/utils';
import { getUser, updateDirectoryUser } from '@/services/internal/rmo/administration';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireActor(request);
  if ('response' in auth) return auth.response;
  try {
    const { id } = await context.params;
    return successResponse(await getUser(auth.actor, Number(id)));
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
    return successResponse(await updateDirectoryUser(auth.actor, Number(id), body));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return PATCH(request, context);
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, message: 'Disable the user instead of deleting the account.' },
    { status: 400 },
  );
}
