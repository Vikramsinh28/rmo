import { prisma } from '@/lib/prisma';
import { EnrollmentStatus, Prisma } from '@/lib/prisma/generated/client';
import { parseFormSchema, validateAnswers } from '@/lib/rmo/form-schema';
import { RmoError } from '@/lib/rmo/errors';
import { comparePassword, hashPassword, validatePassword } from '@/lib/utils';
import type { Actor } from '@/services/internal/rmo/administration';

const DENIED = 'You do not have permission to perform this action.';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STATUSES: readonly EnrollmentStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

const enrollmentSelect = {
  id: true,
  publicCode: true,
  fullName: true,
  email: true,
  phone: true,
  employeeId: true,
  staffNumber: true,
  loginId: true,
  requestedZoneId: true,
  requestedDivisionId: true,
  requestedLobbyId: true,
  formId: true,
  formVersionId: true,
  formSubmissionId: true,
  answers: true,
  status: true,
  reviewedAt: true,
  rejectionReason: true,
  createdUserId: true,
  createdAt: true,
  updatedAt: true,
  requestedZone: { select: { id: true, name: true, code: true } },
  requestedDivision: { select: { id: true, name: true, code: true } },
  requestedLobby: { select: { id: true, name: true, code: true } },
  form: { select: { id: true, name: true } },
  formVersion: { select: { id: true, versionNumber: true, schema: true } },
  reviewedBy: { select: { id: true, name: true, loginId: true } },
  createdUser: {
    select: {
      id: true,
      name: true,
      loginId: true,
      rmoRole: true,
      accountStatus: true,
      homeDivisionId: true,
      homeLobbyId: true,
    },
  },
} satisfies Prisma.CrewEnrollmentSelect;

export interface EnrollmentWriteInput {
  fullName?: string;
  email?: string;
  phone?: string;
  employeeId?: string;
  staffNumber?: string;
  loginId?: string;
  password?: string;
  confirmPassword?: string;
  zoneId?: number;
  divisionId?: number;
  lobbyId?: number;
  answers?: unknown;
  rmoRole?: string;
}

export interface EnrollmentListQuery {
  search?: string;
  status?: string;
  divisionId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new RmoError(`${label} is required.`, 400);
  const trimmed = value.trim();
  if (!trimmed) throw new RmoError(`${label} is required.`, 400);
  if (trimmed.length > max) throw new RmoError(`${label} is too long.`, 400);
  return trimmed;
}

function identity(value: string): string {
  return value.trim().toLowerCase();
}

function publicCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function applicationId(code: string): string {
  return `RMO-ENR-${code}`;
}

function statusMessage(status: EnrollmentStatus): string {
  if (status === 'PENDING') return 'Your enrollment is awaiting approval from the Division Admin.';
  if (status === 'APPROVED') return 'Your enrollment is approved. Sign in with the login ID and password you created.';
  if (status === 'REJECTED') return 'Your crew enrollment was not approved.';
  return 'This enrollment is no longer active.';
}

function assertReader(actor: Actor) {
  if (actor.rmoRole !== 'SYSTEM_ADMIN' && actor.rmoRole !== 'DIVISION_ADMIN') {
    throw new RmoError(DENIED, 403);
  }
  if (actor.rmoRole === 'DIVISION_ADMIN' && !actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
}

function scopedDivision(actor: Actor, requested?: number): number | undefined {
  if (requested != null && !Number.isInteger(requested)) {
    throw new RmoError('Division is not valid.', 400);
  }
  if (actor.rmoRole === 'DIVISION_ADMIN') {
    if (requested != null && requested !== actor.homeDivisionId) throw new RmoError(DENIED, 403);
    return actor.homeDivisionId as number;
  }
  return requested;
}

function pageArgs(query: EnrollmentListQuery) {
  const page = Math.max(query.page || 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize || 10, 1), 50);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function parseDay(value: string, end: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RmoError('Date is not valid.', 400);
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(date.getTime())) throw new RmoError('Date is not valid.', 400);
  return date;
}

async function publishedEnrollmentForm() {
  return prisma.form.findFirst({
    where: { purpose: 'CREW_ENROLLMENT', status: 'PUBLISHED' },
    orderBy: { updatedAt: 'desc' },
    include: { currentVersion: true },
  });
}

export async function enrollmentCatalog() {
  const [zones, divisions, lobbies, form] = await Promise.all([
    prisma.zone.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.division.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, zoneId: true },
    }),
    prisma.lobby.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, divisionId: true },
    }),
    publishedEnrollmentForm(),
  ]);
  const version = form?.currentVersion?.status === 'PUBLISHED' ? form.currentVersion : null;
  return {
    zones,
    divisions,
    lobbies,
    form: version
      ? {
          name: form?.name,
          description: form?.description,
          schema: version.schema,
        }
      : null,
  };
}

export async function submitCrewEnrollment(input: EnrollmentWriteInput) {
  if (input.rmoRole && input.rmoRole !== 'CREW_USER') {
    throw new RmoError('Enrollment can only request a crew account.', 400);
  }
  const fullName = text(input.fullName, 'Full name', 120);
  const email = identity(text(input.email, 'Email', 254));
  const phone = text(input.phone, 'Phone', 30);
  const employeeId = text(input.employeeId, 'Employee ID', 40);
  const staffNumber = text(input.staffNumber, 'Employee / staff number', 40);
  const loginId = identity(text(input.loginId, 'Login ID', 80));
  const password = typeof input.password === 'string' ? input.password : '';
  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RmoError('Email is not valid.', 400);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(loginId)) {
    throw new RmoError('Login ID must be 3 to 80 letters, numbers, dots, hyphens, or underscores.', 400);
  }
  if (!/^[0-9+().\-\s]{7,30}$/.test(phone)) throw new RmoError('Phone is not valid.', 400);
  if (!password || password !== confirmPassword) {
    throw new RmoError('Password confirmation does not match.', 400);
  }
  const passwordCheck = validatePassword(password);
  if (!passwordCheck.isValid) throw new RmoError(passwordCheck.errors.join(', '), 400);
  if (!Number.isInteger(input.zoneId) || !Number.isInteger(input.divisionId) || !Number.isInteger(input.lobbyId)) {
    throw new RmoError('Zone, division, and lobby are required.', 400);
  }

  const answerPayload = input.answers ?? {};
  if (JSON.stringify(answerPayload).length > 20000) {
    throw new RmoError('Enrollment answers are too large.', 400);
  }

  const [zone, division, lobby, form, existingUser, pending] = await Promise.all([
    prisma.zone.findFirst({ where: { id: input.zoneId, status: 'ACTIVE' } }),
    prisma.division.findFirst({ where: { id: input.divisionId, status: 'ACTIVE' } }),
    prisma.lobby.findFirst({ where: { id: input.lobbyId, status: 'ACTIVE' } }),
    publishedEnrollmentForm(),
    prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { loginId: { equals: loginId, mode: 'insensitive' } },
          { email: { equals: loginId, mode: 'insensitive' } },
          { loginId: { equals: email, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    }),
    prisma.crewEnrollment.findFirst({
      where: {
        status: 'PENDING',
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { loginId: { equals: loginId, mode: 'insensitive' } },
          { email: { equals: loginId, mode: 'insensitive' } },
          { loginId: { equals: email, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    }),
  ]);
  if (!zone || !division || division.zoneId !== zone.id) {
    throw new RmoError('Division does not belong to the selected zone.', 400);
  }
  if (!lobby || lobby.divisionId !== division.id) {
    throw new RmoError('Lobby does not belong to the selected division.', 400);
  }
  if (existingUser) {
    throw new RmoError('An account with this email or login ID already exists.', 400);
  }
  if (pending) {
    throw new RmoError('An enrollment with this email or login ID is already awaiting approval.', 400);
  }

  let formId: number | null = null;
  let formVersionId: number | null = null;
  let answers: Prisma.InputJsonValue = {};
  const version = form?.currentVersion?.status === 'PUBLISHED' ? form.currentVersion : null;
  if (version) {
    let parsed;
    try {
      parsed = validateAnswers(parseFormSchema(version.schema), answerPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Enrollment answers are not valid.';
      throw new RmoError(message, 400);
    }
    formId = form?.id ?? null;
    formVersionId = version.id;
    answers = parsed as unknown as Prisma.InputJsonValue;
  } else if (input.answers != null && JSON.stringify(input.answers) !== '{}') {
    throw new RmoError('There is no published enrollment form for these answers.', 400);
  }

  const passwordHash = await hashPassword(password);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await prisma.crewEnrollment.create({
        data: {
          publicCode: publicCode(),
          fullName,
          email,
          phone,
          employeeId,
          staffNumber,
          loginId,
          requestedZoneId: zone.id,
          requestedDivisionId: division.id,
          requestedLobbyId: lobby.id,
          formId,
          formVersionId,
          answers,
          passwordHash,
          status: 'PENDING',
        },
        select: enrollmentSelect,
      });
      await prisma.auditLog.create({
        data: {
          action: 'crew_enrollment.created',
          targetType: 'crew_enrollment',
          targetId: String(created.id),
          metadata: {
            divisionId: created.requestedDivisionId,
            lobbyId: created.requestedLobbyId,
            formId: created.formId,
            formVersionId: created.formVersionId,
            publicCode: created.publicCode,
          },
        },
      });
      return publicView(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String(error.meta?.target || '');
        if (target.includes('publicCode')) continue;
        throw new RmoError('An enrollment with this email or login ID is already awaiting approval.', 400);
      }
      throw error;
    }
  }
  throw new RmoError('Could not save the enrollment. Try again.', 500);
}

function publicView(row: {
  publicCode: string;
  status: EnrollmentStatus;
  requestedDivision: { name: string };
  requestedLobby: { name: string };
}) {
  return {
    applicationId: applicationId(row.publicCode),
    status: row.status,
    requestedDivision: row.requestedDivision.name,
    requestedLobby: row.requestedLobby.name,
    message: statusMessage(row.status),
  };
}

export async function crewEnrollmentStatus(code: string) {
  const publicCode = code.trim().replace(/^RMO-ENR-/i, '').toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(publicCode)) throw new RmoError('Enrollment not found.', 404);
  const row = await prisma.crewEnrollment.findUnique({
    where: { publicCode },
    select: {
      publicCode: true,
      status: true,
      requestedDivision: { select: { name: true } },
      requestedLobby: { select: { name: true } },
    },
  });
  if (!row) throw new RmoError('Enrollment not found.', 404);
  return publicView(row);
}

export async function listCrewEnrollments(actor: Actor, query: EnrollmentListQuery) {
  assertReader(actor);
  const divisionId = scopedDivision(actor, query.divisionId);
  if (query.status && !STATUSES.includes(query.status as EnrollmentStatus)) {
    throw new RmoError('Status is not valid.', 400);
  }
  const createdAt = query.dateFrom || query.dateTo
    ? {
        ...(query.dateFrom ? { gte: parseDay(query.dateFrom, false) } : {}),
        ...(query.dateTo ? { lte: parseDay(query.dateTo, true) } : {}),
      }
    : undefined;
  const where: Prisma.CrewEnrollmentWhereInput = {
    ...(divisionId ? { requestedDivisionId: divisionId } : {}),
    ...(query.status ? { status: query.status as EnrollmentStatus } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { employeeId: { contains: query.search, mode: 'insensitive' } },
            { loginId: { contains: query.search, mode: 'insensitive' } },
            { publicCode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const { page, pageSize, skip, take } = pageArgs(query);
  const [items, total, pendingCount] = await Promise.all([
    prisma.crewEnrollment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: enrollmentSelect,
    }),
    prisma.crewEnrollment.count({ where }),
    prisma.crewEnrollment.count({
      where: {
        status: 'PENDING',
        ...(divisionId ? { requestedDivisionId: divisionId } : {}),
      },
    }),
  ]);
  return { items, total, page, pageSize, pendingCount };
}

async function loadInScope(actor: Actor, id: number) {
  assertReader(actor);
  if (!Number.isInteger(id)) throw new RmoError('Enrollment not found.', 404);
  const row = await prisma.crewEnrollment.findUnique({
    where: { id },
    select: enrollmentSelect,
  });
  if (!row) throw new RmoError('Enrollment not found.', 404);
  if (actor.rmoRole === 'DIVISION_ADMIN' && row.requestedDivisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  return row;
}

export async function getCrewEnrollment(actor: Actor, id: number) {
  return loadInScope(actor, id);
}

export interface ApprovalInput {
  lobbyId?: number;
  divisionId?: number;
  rmoRole?: string;
  password?: string;
  passwordHash?: string;
}

export async function approveCrewEnrollment(actor: Actor, id: number, input: ApprovalInput) {
  if (actor.rmoRole !== 'DIVISION_ADMIN' || !actor.homeDivisionId) {
    throw new RmoError('Only a division admin can approve crew enrollment.', 403);
  }
  if (input.rmoRole && input.rmoRole !== 'CREW_USER') {
    throw new RmoError('Enrollment approval can only create a crew user.', 400);
  }
  if (input.password || input.passwordHash) {
    throw new RmoError('A division admin cannot set the crew password.', 400);
  }
  if (input.divisionId != null && input.divisionId !== actor.homeDivisionId) {
    throw new RmoError(DENIED, 403);
  }
  if (!Number.isInteger(input.lobbyId)) throw new RmoError('A lobby in your division is required.', 400);

  const lobby = await prisma.lobby.findFirst({
    where: { id: input.lobbyId, status: 'ACTIVE' },
    include: { division: { select: { id: true, zoneId: true, status: true } } },
  });
  if (!lobby || lobby.divisionId !== actor.homeDivisionId || lobby.division.status !== 'ACTIVE') {
    throw new RmoError('You can only assign a lobby inside your division.', 403);
  }

  try {
    return await prisma.$transaction(async tx => {
      const existing = await tx.crewEnrollment.findUnique({ where: { id } });
      if (!existing) throw new RmoError('Enrollment not found.', 404);
      if (existing.requestedDivisionId !== actor.homeDivisionId) throw new RmoError(DENIED, 403);
      if (existing.status !== 'PENDING') {
        throw new RmoError('Only a pending enrollment can be approved.', 400);
      }
      const conflict = await tx.user.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { email: { equals: existing.email, mode: 'insensitive' } },
            { loginId: { equals: existing.loginId, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (conflict) {
        throw new RmoError('An account with this email or login ID already exists.', 400);
      }

      const user = await tx.user.create({
        data: {
          name: existing.fullName,
          email: existing.email,
          loginId: existing.loginId,
          password: existing.passwordHash,
          role: 'USER',
          rmoRole: 'CREW_USER',
          accountStatus: 'ACTIVE',
          isOnboarded: true,
          homeZoneId: lobby.division.zoneId,
          homeDivisionId: actor.homeDivisionId,
          homeLobbyId: lobby.id,
        },
        select: { id: true, rmoRole: true, accountStatus: true, homeDivisionId: true, homeLobbyId: true },
      });

      let formSubmissionId: number | null = null;
      if (existing.formId && existing.formVersionId) {
        const submission = await tx.submission.create({
          data: {
            formId: existing.formId,
            formVersionId: existing.formVersionId,
            divisionId: actor.homeDivisionId as number,
            lobbyId: lobby.id,
            submittedById: user.id,
            status: 'COMPLETED',
            answers: existing.answers as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        formSubmissionId = submission.id;
      }

      const approved = await tx.crewEnrollment.update({
        where: { id: existing.id },
        data: {
          status: 'APPROVED',
          reviewedById: actor.id,
          reviewedAt: new Date(),
          createdUserId: user.id,
          formSubmissionId,
        },
        select: enrollmentSelect,
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'user.created',
          targetType: 'user',
          targetId: String(user.id),
          metadata: {
            divisionId: user.homeDivisionId,
            lobbyId: user.homeLobbyId,
            rmoRole: 'CREW_USER',
            accountStatus: 'ACTIVE',
            enrollmentId: existing.id,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'crew_enrollment.approved',
          targetType: 'crew_enrollment',
          targetId: String(existing.id),
          metadata: {
            divisionId: actor.homeDivisionId,
            lobbyId: lobby.id,
            userId: user.id,
            formId: existing.formId,
            formVersionId: existing.formVersionId,
            formSubmissionId,
            rmoRole: 'CREW_USER',
          },
        },
      });
      return approved;
    });
  } catch (error) {
    if (error instanceof RmoError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new RmoError('An account with this email or login ID already exists.', 400);
    }
    throw error;
  }
}

export async function rejectCrewEnrollment(actor: Actor, id: number, reason: unknown) {
  if (actor.rmoRole !== 'DIVISION_ADMIN' || !actor.homeDivisionId) {
    throw new RmoError('Only a division admin can reject crew enrollment.', 403);
  }
  const rejectionReason = text(reason, 'Rejection reason', 500);
  return prisma.$transaction(async tx => {
    const existing = await tx.crewEnrollment.findUnique({ where: { id } });
    if (!existing) throw new RmoError('Enrollment not found.', 404);
    if (existing.requestedDivisionId !== actor.homeDivisionId) throw new RmoError(DENIED, 403);
    if (existing.status !== 'PENDING') {
      throw new RmoError('Only a pending enrollment can be rejected.', 400);
    }
    const rejected = await tx.crewEnrollment.update({
      where: { id: existing.id },
      data: {
        status: 'REJECTED',
        rejectionReason,
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
      select: enrollmentSelect,
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'crew_enrollment.rejected',
        targetType: 'crew_enrollment',
        targetId: String(existing.id),
        metadata: {
          divisionId: existing.requestedDivisionId,
          reason: rejectionReason,
        },
      },
    });
    return rejected;
  });
}

export async function enrollmentLoginMessage(identifier: string, password: string): Promise<string | null> {
  const key = identifier.trim().toLowerCase();
  if (!key || !password) return null;
  const rows = await prisma.crewEnrollment.findMany({
    where: {
      status: { in: ['PENDING', 'REJECTED'] },
      OR: [
        { email: { equals: key, mode: 'insensitive' } },
        { loginId: { equals: key, mode: 'insensitive' } },
      ],
    },
    select: { status: true, passwordHash: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const pending = rows.filter(row => row.status === 'PENDING');
  const rejected = rows.filter(row => row.status === 'REJECTED');
  for (const row of [...pending, ...rejected]) {
    if (await comparePassword(password, row.passwordHash)) {
      return row.status === 'PENDING'
        ? 'Your crew enrollment is awaiting approval.'
        : 'Your crew enrollment was not approved.';
    }
  }
  return null;
}

export async function enrollmentCounts(divisionId: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [pendingEnrollments, approvedToday, rejectedToday, crewMembers] = await Promise.all([
    prisma.crewEnrollment.count({ where: { requestedDivisionId: divisionId, status: 'PENDING' } }),
    prisma.crewEnrollment.count({
      where: {
        requestedDivisionId: divisionId,
        status: 'APPROVED',
        reviewedAt: { gte: start, lt: end },
      },
    }),
    prisma.crewEnrollment.count({
      where: {
        requestedDivisionId: divisionId,
        status: 'REJECTED',
        reviewedAt: { gte: start, lt: end },
      },
    }),
    prisma.user.count({
      where: { deletedAt: null, homeDivisionId: divisionId, rmoRole: 'CREW_USER' },
    }),
  ]);
  return { pendingEnrollments, approvedToday, rejectedToday, crewMembers };
}
