import { prisma } from '@/lib/prisma';
import {
  canAdminister,
  isRmoRole,
  type RmoRoleName,
} from '@/lib/rmo/access';
import { RmoError } from '@/lib/rmo/errors';
import {
  AIEntitlementStatus,
  AIPlan,
  Prisma,
} from '@/lib/prisma/generated/client';
import { Actor } from '@/services/internal/rmo/administration';

export type AIFeatureKey =
  | 'faceIdentification'
  | 'fatigueDetection'
  | 'impairmentDetection'
  | 'behaviorMonitoring';

export interface AIFeatures {
  faceIdentification: boolean;
  fatigueDetection: boolean;
  impairmentDetection: boolean;
  behaviorMonitoring: boolean;
}

export interface DivisionAICapabilities {
  divisionId: number;
  divisionName: string;
  enabled: boolean;
  available: boolean;
  status: AIEntitlementStatus | 'NONE';
  plan: AIPlan | null;
  startsAt: string | null;
  expiresAt: string | null;
  features: AIFeatures;
  reason: string | null;
  configured: boolean;
  moduleNote: string;
}

export interface DivisionAIEntitlementInput {
  enabled?: boolean;
  plan?: string;
  status?: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  features?: Partial<AIFeatures>;
}

const EMPTY_FEATURES: AIFeatures = {
  faceIdentification: false,
  fatigueDetection: false,
  impairmentDetection: false,
  behaviorMonitoring: false,
};

const MODULE_NOTE = 'Configured — AI module not yet active';

type EntitlementRow = {
  enabled: boolean;
  plan: AIPlan;
  status: AIEntitlementStatus;
  startsAt: Date | null;
  expiresAt: Date | null;
  faceIdentification: boolean;
  fatigueDetection: boolean;
  impairmentDetection: boolean;
  behaviorMonitoring: boolean;
};

async function audit(
  actorId: number,
  action: string,
  targetId: number,
  metadata?: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetType: 'division_ai',
      targetId: String(targetId),
      metadata,
    },
  });
}

function asRole(role: Actor['rmoRole']): RmoRoleName {
  if (!isRmoRole(role)) throw new RmoError('You do not have permission to perform this action.', 403);
  return role;
}

function parsePlan(value: string | undefined): AIPlan | undefined {
  if (value === 'BASIC' || value === 'PREMIUM' || value === 'ENTERPRISE') return value;
  return undefined;
}

function parseStatus(value: string | undefined): AIEntitlementStatus | undefined {
  if (value === 'ACTIVE' || value === 'INACTIVE') return value;
  return undefined;
}

function parseDate(value: string | null | undefined, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RmoError(`${field} must be a valid date.`, 400);
  }
  return date;
}

function snapshot(row: EntitlementRow | null) {
  if (!row) {
    return {
      enabled: false,
      plan: null,
      status: 'NONE',
      startsAt: null,
      expiresAt: null,
      features: { ...EMPTY_FEATURES },
    };
  }
  return {
    enabled: row.enabled,
    plan: row.plan,
    status: row.status,
    startsAt: row.startsAt?.toISOString() || null,
    expiresAt: row.expiresAt?.toISOString() || null,
    features: {
      faceIdentification: row.faceIdentification,
      fatigueDetection: row.fatigueDetection,
      impairmentDetection: row.impairmentDetection,
      behaviorMonitoring: row.behaviorMonitoring,
    },
  };
}

/**
 * Central resolver for division AI capability.
 * Future AI APIs must call this instead of reading flags directly.
 */
export function resolveDivisionAICapabilities(
  divisionId: number,
  divisionName: string,
  row: EntitlementRow | null,
  now = new Date(),
): DivisionAICapabilities {
  const base: DivisionAICapabilities = {
    divisionId,
    divisionName,
    enabled: false,
    available: false,
    status: row?.status || 'NONE',
    plan: row?.plan || null,
    startsAt: row?.startsAt?.toISOString() || null,
    expiresAt: row?.expiresAt?.toISOString() || null,
    features: { ...EMPTY_FEATURES },
    reason: 'AI monitoring is not configured for this division.',
    configured: Boolean(row),
    moduleNote: MODULE_NOTE,
  };

  if (!row) return base;

  base.enabled = row.enabled;
  if (!row.enabled) {
    return { ...base, reason: 'AI monitoring is disabled for this division.' };
  }
  if (row.status !== 'ACTIVE') {
    return { ...base, reason: 'AI monitoring entitlement is inactive.' };
  }
  if (row.startsAt && row.startsAt.getTime() > now.getTime()) {
    return { ...base, reason: 'AI monitoring has not started yet.' };
  }
  if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) {
    return { ...base, reason: 'AI monitoring entitlement has expired.' };
  }

  return {
    ...base,
    available: true,
    features: {
      faceIdentification: row.faceIdentification,
      fatigueDetection: row.fatigueDetection,
      impairmentDetection: row.impairmentDetection,
      behaviorMonitoring: row.behaviorMonitoring,
    },
    reason: null,
  };
}

export async function getDivisionAICapabilities(divisionId: number) {
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: {
      id: true,
      name: true,
      aiEntitlement: true,
    },
  });
  if (!division) throw new RmoError('Division not found.', 404);
  return resolveDivisionAICapabilities(division.id, division.name, division.aiEntitlement);
}

export async function assertDivisionAIFeature(divisionId: number, feature: AIFeatureKey) {
  const capabilities = await getDivisionAICapabilities(divisionId);
  if (!capabilities.available || !capabilities.features[feature]) {
    throw new RmoError('AI monitoring is not available for this division.', 403);
  }
  return capabilities;
}

function assertCanReadDivision(actor: Actor, divisionId: number) {
  const role = asRole(actor.rmoRole);
  if (role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN') return;
  if (
    (role === 'DIVISION_ADMIN' || role === 'DIVISION_MONITOR')
    && actor.homeDivisionId === divisionId
  ) {
    return;
  }
  throw new RmoError('You do not have permission to perform this action.', 403);
}

export async function getDivisionAIEntitlement(actor: Actor, divisionId: number) {
  assertCanReadDivision(actor, divisionId);
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      zone: { select: { id: true, name: true, code: true } },
      aiEntitlement: true,
    },
  });
  if (!division) throw new RmoError('Division not found.', 404);
  const capabilities = resolveDivisionAICapabilities(
    division.id,
    division.name,
    division.aiEntitlement,
  );
  return {
    division: {
      id: division.id,
      name: division.name,
      code: division.code,
      status: division.status,
      zone: division.zone,
    },
    entitlement: division.aiEntitlement
      ? {
          id: division.aiEntitlement.id,
          enabled: division.aiEntitlement.enabled,
          plan: division.aiEntitlement.plan,
          status: division.aiEntitlement.status,
          startsAt: division.aiEntitlement.startsAt,
          expiresAt: division.aiEntitlement.expiresAt,
          features: {
            faceIdentification: division.aiEntitlement.faceIdentification,
            fatigueDetection: division.aiEntitlement.fatigueDetection,
            impairmentDetection: division.aiEntitlement.impairmentDetection,
            behaviorMonitoring: division.aiEntitlement.behaviorMonitoring,
          },
          updatedAt: division.aiEntitlement.updatedAt,
        }
      : null,
    capabilities,
  };
}

export async function updateDivisionAIEntitlement(
  actor: Actor,
  divisionId: number,
  input: DivisionAIEntitlementInput,
) {
  if (!canAdminister(asRole(actor.rmoRole))) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const division = await prisma.division.findUnique({
    where: { id: divisionId },
    include: { aiEntitlement: true },
  });
  if (!division) throw new RmoError('Division not found.', 404);

  const plan = input.plan !== undefined ? parsePlan(input.plan) : undefined;
  if (input.plan !== undefined && !plan) {
    throw new RmoError('Plan must be BASIC, PREMIUM, or ENTERPRISE.', 400);
  }
  const status = input.status !== undefined ? parseStatus(input.status) : undefined;
  if (input.status !== undefined && !status) {
    throw new RmoError('Status must be ACTIVE or INACTIVE.', 400);
  }
  const startsAt = parseDate(input.startsAt, 'startsAt');
  const expiresAt = parseDate(input.expiresAt, 'expiresAt');
  if (startsAt && expiresAt && expiresAt.getTime() < startsAt.getTime()) {
    throw new RmoError('Expiry must be after the start date.', 400);
  }

  const previous = snapshot(division.aiEntitlement);
  const features = input.features || {};
  const data = {
    ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : {}),
    ...(plan ? { plan } : {}),
    ...(status ? { status } : {}),
    ...(startsAt !== undefined ? { startsAt } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(features.faceIdentification !== undefined
      ? { faceIdentification: Boolean(features.faceIdentification) }
      : {}),
    ...(features.fatigueDetection !== undefined
      ? { fatigueDetection: Boolean(features.fatigueDetection) }
      : {}),
    ...(features.impairmentDetection !== undefined
      ? { impairmentDetection: Boolean(features.impairmentDetection) }
      : {}),
    ...(features.behaviorMonitoring !== undefined
      ? { behaviorMonitoring: Boolean(features.behaviorMonitoring) }
      : {}),
  };

  const saved = division.aiEntitlement
    ? await prisma.divisionAIEntitlement.update({
        where: { divisionId },
        data,
      })
    : await prisma.divisionAIEntitlement.create({
        data: {
          divisionId,
          enabled: Boolean(input.enabled ?? false),
          plan: plan || 'BASIC',
          status: status || 'INACTIVE',
          startsAt: startsAt === undefined ? null : startsAt,
          expiresAt: expiresAt === undefined ? null : expiresAt,
          faceIdentification: Boolean(features.faceIdentification ?? false),
          fatigueDetection: Boolean(features.fatigueDetection ?? false),
          impairmentDetection: Boolean(features.impairmentDetection ?? false),
          behaviorMonitoring: Boolean(features.behaviorMonitoring ?? false),
        },
      });

  const next = snapshot(saved);
  const wasAvailable = previous.enabled && previous.status === 'ACTIVE';
  const isAvailable = next.enabled && next.status === 'ACTIVE';
  let action = 'ai.entitlement.updated';
  if (!wasAvailable && isAvailable) action = 'ai.entitlement.enabled';
  if (wasAvailable && !isAvailable) action = 'ai.entitlement.disabled';

  const featureChanges: AIFeatureKey[] = [];
  (Object.keys(EMPTY_FEATURES) as AIFeatureKey[]).forEach(key => {
    if (previous.features[key] !== next.features[key]) featureChanges.push(key);
  });

  await audit(actor.id, action, divisionId, {
    divisionId,
    divisionName: division.name,
    previous,
    next,
  });
  for (const feature of featureChanges) {
    await audit(
      actor.id,
      next.features[feature] ? 'ai.feature.enabled' : 'ai.feature.disabled',
      divisionId,
      {
        divisionId,
        divisionName: division.name,
        feature,
        previous: previous.features,
        next: next.features,
      },
    );
  }

  return getDivisionAIEntitlement(actor, divisionId);
}

async function homeDivisionIdForActor(actor: Actor): Promise<number | null> {
  if (actor.homeDivisionId) return actor.homeDivisionId;
  if (actor.homeLobbyId) {
    const lobby = await prisma.lobby.findUnique({
      where: { id: actor.homeLobbyId },
      select: { divisionId: true },
    });
    return lobby?.divisionId || null;
  }
  return null;
}

/** Capability for the authenticated user's own division. Division id is never taken from the client. */
export async function getMyDivisionAICapabilities(actor: Actor) {
  const role = asRole(actor.rmoRole);
  if (role === 'CREW_USER') {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  if (canAdminister(role)) {
    throw new RmoError('Choose a division to view AI monitoring settings.', 400);
  }
  const divisionId = await homeDivisionIdForActor(actor);
  if (!divisionId) {
    throw new RmoError('No home division is assigned to this account.', 403);
  }
  return getDivisionAICapabilities(divisionId);
}

export async function getCallAICapabilities(actor: Actor, callId: number) {
  const call = await prisma.lobbyCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      divisionId: true,
      lobbyId: true,
      monitorUserId: true,
      lobby: { select: { name: true } },
    },
  });
  if (!call) throw new RmoError('Call not found.', 404);
  const role = asRole(actor.rmoRole);
  const allowed =
    canAdminister(role)
    || role === 'SUPER_ADMIN'
    || (role === 'DIVISION_ADMIN' && actor.homeDivisionId === call.divisionId)
    || (role === 'DIVISION_MONITOR' && (
      actor.homeDivisionId === call.divisionId || actor.id === call.monitorUserId
    ))
    || (role === 'LOBBY_USER' && actor.homeLobbyId === call.lobbyId);
  if (!allowed) {
    throw new RmoError('You do not have permission to perform this action.', 403);
  }
  const capabilities = await getDivisionAICapabilities(call.divisionId);
  return {
    sessionId: call.id,
    divisionId: call.divisionId,
    lobbyName: call.lobby.name,
    ai: {
      enabled: capabilities.available,
      status: capabilities.status,
      plan: capabilities.plan,
      reason: capabilities.reason,
      moduleNote: capabilities.moduleNote,
      features: capabilities.features,
    },
  };
}

export function presentAISummary(capabilities: DivisionAICapabilities | null) {
  if (!capabilities) {
    return {
      enabled: false,
      available: false,
      plan: null,
      status: 'NONE',
      expiresAt: null,
    };
  }
  return {
    enabled: capabilities.enabled,
    available: capabilities.available,
    plan: capabilities.plan,
    status: capabilities.status,
    expiresAt: capabilities.expiresAt,
  };
}
