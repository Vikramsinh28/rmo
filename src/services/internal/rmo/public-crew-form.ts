import { prisma } from '@/lib/prisma';
import { Prisma, SubmissionSource } from '@/lib/prisma/generated/client';
import { formatIstDate, formatIstDateTime } from '@/lib/rmo/datetime';
import { RmoError } from '@/lib/rmo/errors';
import { FormSchemaError, parseFormSchema, validateAnswers } from '@/lib/rmo/form-schema';
import {
  generatePublicSubmissionReference,
  normalizeEmail,
  normalizeStaffNumber,
  signPublicCrewFormSession,
  verifyPublicCrewFormSession,
  type PublicCrewFormSessionClaims,
} from '@/lib/rmo/public-crew-form';
import {
  consumeRateLimit,
  publicFormMaxBodySize,
  publicFormRateLimit,
  publicIdentityAttemptLimit,
} from '@/lib/rmo/rate-limit';
import { recordAudit } from '@/services/internal/rmo/audit-event';

const INVALID_TOKEN = 'This lobby form link is invalid or unavailable.';
const INVALID_IDENTITY =
  'We could not verify the provided details. Please check your Staff Number and Email.';
const SESSION_EXPIRED = 'Your form session has expired. Please scan the lobby QR again.';
const NO_FORM = 'No form is currently available for this duty type.';
const ALREADY = 'This form has already been submitted.';
const RATE_LIMITED = 'Too many requests. Please wait and try again.';

function clientKey(ip: string | null | undefined, suffix: string) {
  return `public-crew:${suffix}:${ip || 'unknown'}`;
}

export function assertPublicBodySize(contentLength: number | null) {
  const max = publicFormMaxBodySize();
  if (contentLength != null && contentLength > max) {
    throw new RmoError('Request payload is too large.', 413);
  }
}

export function assertPublicRateLimit(ip: string | null | undefined, scope: string) {
  const result = consumeRateLimit(clientKey(ip, scope), publicFormRateLimit());
  if (!result.allowed) throw new RmoError(RATE_LIMITED, 429);
}

function assertIdentityRateLimit(ip: string | null | undefined) {
  const result = consumeRateLimit(
    clientKey(ip, 'identify'),
    publicIdentityAttemptLimit(),
  );
  if (!result.allowed) throw new RmoError(RATE_LIMITED, 429);
}

async function resolveLobbyByToken(token: string) {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 12) {
    throw new RmoError(INVALID_TOKEN, 404);
  }
  const lobby = await prisma.lobby.findFirst({
    where: {
      publicToken: trimmed,
      publicTokenRevokedAt: null,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      code: true,
      divisionId: true,
      publicToken: true,
      division: { select: { id: true, name: true, code: true, status: true } },
    },
  });
  if (!lobby || lobby.division.status !== 'ACTIVE') {
    await recordAudit(null, 'public_form.invalid_token', 'lobby', null, {
      source: 'PUBLIC_QR',
    });
    throw new RmoError(INVALID_TOKEN, 404);
  }
  return lobby;
}

export async function getPublicLobbyFormContext(token: string, ip?: string | null) {
  assertPublicRateLimit(ip, 'resolve');
  const lobby = await resolveLobbyByToken(token);
  return {
    lobbyName: lobby.name,
    divisionName: lobby.division.name,
    title: 'Crew Form Submission',
  };
}

export async function identifyPublicCrew(
  token: string,
  input: { staffNumber?: string; email?: string },
  ip?: string | null,
) {
  assertPublicRateLimit(ip, 'identify');
  assertIdentityRateLimit(ip);
  const lobby = await resolveLobbyByToken(token);

  const staffNumber = normalizeStaffNumber(String(input.staffNumber || ''));
  const email = normalizeEmail(String(input.email || ''));
  if (!staffNumber || !email || !email.includes('@')) {
    await recordAudit(null, 'public_form.identity_failed', 'lobby', lobby.id, {
      source: 'PUBLIC_QR',
      lobbyId: lobby.id,
      divisionId: lobby.divisionId,
      reason: 'missing_fields',
    });
    throw new RmoError(INVALID_IDENTITY, 401);
  }

  const candidates = await prisma.user.findMany({
    where: {
      deletedAt: null,
      rmoRole: 'CREW_USER',
      email: { equals: email, mode: 'insensitive' },
    },
    select: {
      id: true,
      name: true,
      email: true,
      loginId: true,
      accountStatus: true,
      homeDivisionId: true,
      homeLobbyId: true,
      crewTypeId: true,
      crewType: { select: { id: true, code: true, name: true, isActive: true } },
    },
    take: 5,
  });

  const user = candidates.find(
    row =>
      row.loginId &&
      normalizeStaffNumber(row.loginId) === staffNumber &&
      normalizeEmail(row.email) === email,
  );

  if (
    !user ||
    user.accountStatus !== 'ACTIVE' ||
    !user.crewTypeId ||
    !user.crewType?.isActive ||
    !user.homeDivisionId ||
    !user.homeLobbyId ||
    user.homeLobbyId !== lobby.id ||
    user.homeDivisionId !== lobby.divisionId
  ) {
    await recordAudit(null, 'public_form.identity_failed', 'lobby', lobby.id, {
      source: 'PUBLIC_QR',
      lobbyId: lobby.id,
      divisionId: lobby.divisionId,
      reason: 'no_match',
    });
    throw new RmoError(INVALID_IDENTITY, 401);
  }

  const dutyTypes = await prisma.dutyType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true },
  });

  const sessionToken = await signPublicCrewFormSession({
    lobbyId: lobby.id,
    userId: user.id,
    crewTypeId: user.crewTypeId,
    divisionId: user.homeDivisionId,
    lobbyToken: lobby.publicToken as string,
  });

  await recordAudit(user.id, 'public_form.identity_verified', 'user', user.id, {
    source: 'PUBLIC_QR',
    lobbyId: lobby.id,
    divisionId: lobby.divisionId,
    crewTypeId: user.crewTypeId,
  });

  return {
    publicSessionToken: sessionToken,
    crew: {
      name: user.name,
      staffNumber: user.loginId,
      crewType: user.crewType,
    },
    lobby: {
      name: lobby.name,
      divisionName: lobby.division.name,
    },
    dutyTypes,
  };
}

async function loadSession(sessionToken: string): Promise<{
  claims: PublicCrewFormSessionClaims;
  user: {
    id: number;
    name: string;
    loginId: string | null;
    homeDivisionId: number | null;
    homeLobbyId: number | null;
    crewTypeId: number | null;
    accountStatus: string;
    crewType: { id: number; code: string; name: string; isActive: boolean } | null;
  };
  lobby: {
    id: number;
    name: string;
    divisionId: number;
    publicToken: string | null;
    publicTokenRevokedAt: Date | null;
    status: string;
    division: { id: number; name: string; status: string };
  };
}> {
  let claims: PublicCrewFormSessionClaims;
  try {
    claims = await verifyPublicCrewFormSession(sessionToken);
  } catch {
    throw new RmoError(SESSION_EXPIRED, 401);
  }

  const [user, lobby] = await Promise.all([
    prisma.user.findFirst({
      where: { id: claims.userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        loginId: true,
        homeDivisionId: true,
        homeLobbyId: true,
        crewTypeId: true,
        accountStatus: true,
        crewType: { select: { id: true, code: true, name: true, isActive: true } },
      },
    }),
    prisma.lobby.findUnique({
      where: { id: claims.lobbyId },
      select: {
        id: true,
        name: true,
        divisionId: true,
        publicToken: true,
        publicTokenRevokedAt: true,
        status: true,
        division: { select: { id: true, name: true, status: true } },
      },
    }),
  ]);

  if (
    !user ||
    user.accountStatus !== 'ACTIVE' ||
    user.crewTypeId !== claims.crewTypeId ||
    user.homeDivisionId !== claims.divisionId ||
    user.homeLobbyId !== claims.lobbyId ||
    !lobby ||
    lobby.status !== 'ACTIVE' ||
    lobby.publicTokenRevokedAt ||
    lobby.publicToken !== claims.lobbyToken ||
    lobby.division.status !== 'ACTIVE'
  ) {
    throw new RmoError(SESSION_EXPIRED, 401);
  }

  return { claims, user, lobby };
}

export async function listPublicDutyTypes(sessionToken: string, ip?: string | null) {
  assertPublicRateLimit(ip, 'duty-types');
  await loadSession(sessionToken);
  return prisma.dutyType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, code: true, name: true },
  });
}

async function findPublishedCrewForm(input: {
  divisionId: number;
  crewTypeId: number;
  dutyTypeId: number;
}) {
  return prisma.form.findFirst({
    where: {
      status: 'PUBLISHED',
      purpose: 'GENERAL',
      divisionId: input.divisionId,
      crewTypeId: input.crewTypeId,
      dutyTypeId: input.dutyTypeId,
      currentVersion: { status: 'PUBLISHED' },
    },
    include: {
      currentVersion: true,
      dutyType: { select: { id: true, code: true, name: true } },
      crewType: { select: { id: true, code: true, name: true } },
    },
    orderBy: { id: 'asc' },
  });
}

function istDayBounds(at = new Date()) {
  const day = formatIstDate(at);
  // IST day as UTC instants: day 00:00 IST = previous UTC 18:30
  const start = new Date(`${day}T00:00:00+05:30`);
  const end = new Date(`${day}T23:59:59.999+05:30`);
  return { start, end, day };
}

async function findSameDaySubmission(input: {
  userId: number;
  formId: number;
  dutyTypeId: number;
}) {
  const { start, end } = istDayBounds();
  return prisma.submission.findFirst({
    where: {
      submittedById: input.userId,
      formId: input.formId,
      dutyTypeId: input.dutyTypeId,
      source: 'PUBLIC_QR',
      submittedAt: { gte: start, lte: end },
    },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      publicReference: true,
      submittedAt: true,
      form: { select: { name: true } },
      dutyType: { select: { name: true, code: true } },
    },
  });
}

export async function getPublicCrewForm(
  sessionToken: string,
  dutyTypeIdRaw: unknown,
  ip?: string | null,
) {
  assertPublicRateLimit(ip, 'form');
  const { claims, user } = await loadSession(sessionToken);
  const dutyTypeId = Number(dutyTypeIdRaw);
  if (!Number.isInteger(dutyTypeId)) throw new RmoError('Duty type is required.', 400);

  const dutyType = await prisma.dutyType.findUnique({
    where: { id: dutyTypeId },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!dutyType || !dutyType.isActive) throw new RmoError(NO_FORM, 404);

  const form = await findPublishedCrewForm({
    divisionId: claims.divisionId,
    crewTypeId: claims.crewTypeId,
    dutyTypeId: dutyType.id,
  });
  if (!form || !form.currentVersion) {
    throw new RmoError(
      `No form is currently available for ${user.crewType?.code || 'crew'} — ${dutyType.name}.`,
      404,
    );
  }

  const existing = await findSameDaySubmission({
    userId: claims.userId,
    formId: form.id,
    dutyTypeId: dutyType.id,
  });

  const schema = parseFormSchema(form.currentVersion.schema);
  return {
    form: {
      name: form.name,
      description: form.description,
      questionCount: schema.fields.length,
      schema,
      dutyType: form.dutyType,
      crewType: form.crewType,
    },
    alreadySubmitted: existing
      ? {
          reference: existing.publicReference,
          submittedAt: formatIstDateTime(existing.submittedAt),
          formName: existing.form.name,
          dutyType: existing.dutyType?.name || '',
        }
      : null,
  };
}

export async function submitPublicCrewForm(
  sessionToken: string,
  input: {
    dutyTypeId?: unknown;
    formId?: unknown;
    answers?: unknown;
    userId?: unknown;
    divisionId?: unknown;
    lobbyId?: unknown;
    crewTypeId?: unknown;
  },
  ip?: string | null,
) {
  assertPublicRateLimit(ip, 'submit');
  const { claims, user, lobby } = await loadSession(sessionToken);

  // Ignore any client-supplied identity / org / crew fields.
  void input.userId;
  void input.divisionId;
  void input.lobbyId;
  void input.crewTypeId;

  const dutyTypeId = Number(input.dutyTypeId);
  if (!Number.isInteger(dutyTypeId)) throw new RmoError('Duty type is required.', 400);

  const dutyType = await prisma.dutyType.findUnique({
    where: { id: dutyTypeId },
    select: { id: true, code: true, name: true, isActive: true },
  });
  if (!dutyType || !dutyType.isActive) throw new RmoError(NO_FORM, 404);

  const form = await findPublishedCrewForm({
    divisionId: claims.divisionId,
    crewTypeId: claims.crewTypeId,
    dutyTypeId: dutyType.id,
  });
  if (!form || !form.currentVersion || form.currentVersion.status !== 'PUBLISHED') {
    throw new RmoError(NO_FORM, 404);
  }

  // Client may echo formId but it cannot choose a different form.
  if (input.formId != null && Number(input.formId) !== form.id) {
    throw new RmoError(NO_FORM, 403);
  }

  const existing = await findSameDaySubmission({
    userId: claims.userId,
    formId: form.id,
    dutyTypeId: dutyType.id,
  });
  if (existing) {
    await recordAudit(user.id, 'public_form.duplicate_submission', 'submission', existing.id, {
      source: 'PUBLIC_QR',
      lobbyId: lobby.id,
      divisionId: lobby.divisionId,
      formId: form.id,
      dutyTypeId: dutyType.id,
    });
    throw new RmoError(ALREADY, 409, 'ALREADY_SUBMITTED');
  }

  let answers;
  try {
    answers = validateAnswers(parseFormSchema(form.currentVersion.schema), input.answers ?? {});
  } catch (error) {
    if (error instanceof FormSchemaError) throw new RmoError(error.message, 400);
    throw error;
  }

  const publicReference = generatePublicSubmissionReference();
  const submission = await prisma.submission.create({
    data: {
      formId: form.id,
      formVersionId: form.currentVersion.id,
      divisionId: claims.divisionId,
      lobbyId: claims.lobbyId,
      crewTypeId: claims.crewTypeId,
      dutyTypeId: dutyType.id,
      submittedById: claims.userId,
      status: 'COMPLETED',
      source: 'PUBLIC_QR' as SubmissionSource,
      publicReference,
      answers: answers as unknown as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      publicReference: true,
      submittedAt: true,
      form: { select: { name: true } },
      dutyType: { select: { name: true, code: true } },
      crewType: { select: { name: true, code: true } },
    },
  });

  await recordAudit(user.id, 'public_form.submitted', 'submission', submission.id, {
    source: 'PUBLIC_QR',
    lobbyId: lobby.id,
    divisionId: lobby.divisionId,
    userId: user.id,
    submissionId: submission.id,
    formId: form.id,
    dutyTypeId: dutyType.id,
    publicReference: submission.publicReference,
  });

  return {
    message: 'Form submitted successfully.',
    reference: submission.publicReference,
    formName: submission.form.name,
    dutyType: submission.dutyType?.name || '',
    crewType: submission.crewType?.name || '',
    submittedAt: formatIstDateTime(submission.submittedAt),
  };
}
