import { prisma } from '@/lib/prisma';
import { Prisma } from '@/lib/prisma/generated/client';
import { fillSeries, type TrendBucket } from '@/lib/rmo/series';
import type { Actor } from '@/services/internal/rmo/administration';
import {
  assertAnalyticsReader,
  buildSubmissionWhere,
  type SubmissionFilter,
} from '@/services/internal/rmo/submission-scope';

function startOfUtcDay(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function endOfUtcDay(value = new Date()) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999),
  );
}

function startOfUtcWeek(value = new Date()) {
  const day = startOfUtcDay(value);
  const weekday = day.getUTCDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  day.setUTCDate(day.getUTCDate() - offset);
  return day;
}

function startOfUtcMonth(value = new Date()) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

async function scoped(
  actor: Actor,
  filter: SubmissionFilter,
) {
  assertAnalyticsReader(actor);
  return buildSubmissionWhere(actor, filter, { defaultDays: 30 });
}

export async function submissionAnalytics(actor: Actor, filter: SubmissionFilter) {
  const { where, from, to, sql } = await scoped(actor, filter);
  const now = new Date();
  const windows = {
    today: { gte: startOfUtcDay(now), lte: endOfUtcDay(now) },
    week: { gte: startOfUtcWeek(now), lte: endOfUtcDay(now) },
    month: { gte: startOfUtcMonth(now), lte: endOfUtcDay(now) },
  };
  const [total, pending, completed, today, week, month, statuses] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.count({ where: { AND: [where, { status: 'PENDING' }] } }),
    prisma.submission.count({ where: { AND: [where, { status: 'COMPLETED' }] } }),
    prisma.submission.count({ where: { AND: [where, { submittedAt: windows.today }] } }),
    prisma.submission.count({ where: { AND: [where, { submittedAt: windows.week }] } }),
    prisma.submission.count({ where: { AND: [where, { submittedAt: windows.month }] } }),
    prisma.submission.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
  ]);
  const rangeFrom = from ?? startOfUtcDay(now);
  const rangeTo = to ?? endOfUtcDay(now);
  const bucket = fillSeries(rangeFrom, rangeTo, new Map()).bucket;
  const grouped = await trendRows(sql, bucket);
  const counts = new Map(grouped.map(row => [row.label, Number(row.count)]));
  const trend = fillSeries(rangeFrom, rangeTo, counts);
  return {
    metrics: { total, today, week, month, pending, completed },
    status: statuses.map(row => ({ status: row.status, count: row._count._all })),
    trend,
  };
}

async function trendRows(whereSql: Prisma.Sql, bucket: TrendBucket) {
  const unit = bucket === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
  const trunc = bucket === 'month' ? 'month' : bucket === 'week' ? 'week' : 'day';
  if (trunc === 'day') {
    return prisma.$queryRaw<Array<{ label: string; count: number }>>`
      SELECT to_char(date_trunc('day', "submittedAt"), ${unit}) AS label,
             COUNT(*)::int AS count
      FROM "Submission"
      WHERE ${whereSql}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  if (trunc === 'week') {
    return prisma.$queryRaw<Array<{ label: string; count: number }>>`
      SELECT to_char(date_trunc('week', "submittedAt"), ${unit}) AS label,
             COUNT(*)::int AS count
      FROM "Submission"
      WHERE ${whereSql}
      GROUP BY 1
      ORDER BY 1
    `;
  }
  return prisma.$queryRaw<Array<{ label: string; count: number }>>`
    SELECT to_char(date_trunc('month', "submittedAt"), ${unit}) AS label,
           COUNT(*)::int AS count
    FROM "Submission"
    WHERE ${whereSql}
    GROUP BY 1
    ORDER BY 1
  `;
}

export async function formAnalytics(actor: Actor, filter: SubmissionFilter) {
  const { where } = await scoped(actor, filter);
  const grouped = await prisma.submission.groupBy({
    by: ['formId'],
    where,
    _count: { _all: true },
  });
  const forms = grouped.length
    ? await prisma.form.findMany({
        where: { id: { in: grouped.map(row => row.formId) } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(forms.map(form => [form.id, form.name]));
  return {
    items: grouped
      .map(row => ({
        formId: row.formId,
        name: names.get(row.formId) || 'Form',
        count: row._count._all,
      }))
      .sort((left, right) => right.count - left.count),
  };
}

export async function lobbyAnalytics(actor: Actor, filter: SubmissionFilter) {
  const { where } = await scoped(actor, filter);
  const grouped = await prisma.submission.groupBy({
    by: ['lobbyId'],
    where,
    _count: { _all: true },
  });
  const lobbyIds = grouped.flatMap(row => (row.lobbyId == null ? [] : [row.lobbyId]));
  const lobbies = lobbyIds.length
    ? await prisma.lobby.findMany({
        where: { id: { in: lobbyIds } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(lobbies.map(lobby => [lobby.id, lobby.name]));
  return {
    items: grouped
      .map(row => ({
        lobbyId: row.lobbyId,
        name: row.lobbyId == null ? 'No lobby' : names.get(row.lobbyId) || 'Lobby',
        count: row._count._all,
      }))
      .sort((left, right) => right.count - left.count),
  };
}

async function namedGroup(
  ids: number[],
  loader: (ids: number[]) => Promise<Array<{ id: number; name: string; code?: string }>>,
) {
  if (!ids.length) return new Map<number, string>();
  const rows = await loader(ids);
  return new Map(rows.map(row => [row.id, row.code ? `${row.code}` : row.name]));
}

export async function crewTypeAnalytics(actor: Actor, filter: SubmissionFilter) {
  const { where } = await scoped(actor, filter);
  const grouped = await prisma.submission.groupBy({
    by: ['crewTypeId'],
    where: { AND: [where, { crewTypeId: { not: null } }] },
    _count: { _all: true },
  });
  const names = await namedGroup(
    grouped.flatMap(row => (row.crewTypeId == null ? [] : [row.crewTypeId])),
    ids => prisma.crewType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } }),
  );
  return {
    items: grouped
      .map(row => ({
        crewTypeId: row.crewTypeId,
        name: row.crewTypeId == null ? 'Unknown' : names.get(row.crewTypeId) || 'Crew type',
        count: row._count._all,
      }))
      .sort((left, right) => right.count - left.count),
  };
}

export async function dutyTypeAnalytics(actor: Actor, filter: SubmissionFilter) {
  const { where } = await scoped(actor, filter);
  const grouped = await prisma.submission.groupBy({
    by: ['dutyTypeId'],
    where: { AND: [where, { dutyTypeId: { not: null } }] },
    _count: { _all: true },
  });
  const names = await namedGroup(
    grouped.flatMap(row => (row.dutyTypeId == null ? [] : [row.dutyTypeId])),
    ids => prisma.dutyType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } }),
  );
  return {
    items: grouped
      .map(row => ({
        dutyTypeId: row.dutyTypeId,
        name: row.dutyTypeId == null ? 'Unknown' : names.get(row.dutyTypeId) || 'Duty type',
        count: row._count._all,
      }))
      .sort((left, right) => right.count - left.count),
  };
}

export async function registerTypeAnalytics(actor: Actor, filter: SubmissionFilter) {
  const { where } = await scoped(actor, filter);
  const submissions = await prisma.submission.findMany({
    where,
    select: {
      id: true,
      answerRows: {
        select: {
          question: {
            select: {
              registers: { select: { registerTypeId: true, registerType: { select: { code: true, name: true } } } },
            },
          },
        },
      },
    },
  });
  const counts = new Map<number, { id: number; name: string; code: string; submissions: Set<number>; answers: number }>();
  for (const submission of submissions) {
    for (const answer of submission.answerRows) {
      for (const reg of answer.question.registers) {
        const current = counts.get(reg.registerTypeId) ?? {
          id: reg.registerTypeId,
          name: reg.registerType.name,
          code: reg.registerType.code,
          submissions: new Set<number>(),
          answers: 0,
        };
        current.submissions.add(submission.id);
        current.answers += 1;
        counts.set(reg.registerTypeId, current);
      }
    }
  }
  return {
    items: [...counts.values()]
      .map(row => ({
        registerTypeId: row.id,
        name: row.code,
        code: row.code,
        submissionCount: row.submissions.size,
        answerCount: row.answers,
        count: row.submissions.size,
      }))
      .sort((left, right) => right.count - left.count),
  };
}

export async function crossAnalytics(actor: Actor, filter: SubmissionFilter) {
  const { where } = await scoped(actor, filter);
  const [byCrewDuty, byDivision] = await Promise.all([
    prisma.submission.groupBy({
      by: ['crewTypeId', 'dutyTypeId'],
      where: {
        AND: [where, { crewTypeId: { not: null } }, { dutyTypeId: { not: null } }],
      },
      _count: { _all: true },
    }),
    prisma.submission.groupBy({
      by: ['divisionId'],
      where,
      _count: { _all: true },
    }),
  ]);
  const crewIds = [...new Set(byCrewDuty.flatMap(row => (row.crewTypeId == null ? [] : [row.crewTypeId])))];
  const dutyIds = [...new Set(byCrewDuty.flatMap(row => (row.dutyTypeId == null ? [] : [row.dutyTypeId])))];
  const divisionIds = byDivision.map(row => row.divisionId);
  const [crews, duties, divisions] = await Promise.all([
    crewIds.length
      ? prisma.crewType.findMany({ where: { id: { in: crewIds } }, select: { id: true, code: true } })
      : [],
    dutyIds.length
      ? prisma.dutyType.findMany({ where: { id: { in: dutyIds } }, select: { id: true, code: true } })
      : [],
    divisionIds.length
      ? prisma.division.findMany({ where: { id: { in: divisionIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const crewNames = new Map(crews.map(row => [row.id, row.code]));
  const dutyNames = new Map(duties.map(row => [row.id, row.code]));
  const divisionNames = new Map(divisions.map(row => [row.id, row.name]));
  return {
    crewDuty: byCrewDuty.map(row => ({
      crewTypeId: row.crewTypeId,
      dutyTypeId: row.dutyTypeId,
      crewType: row.crewTypeId == null ? '' : crewNames.get(row.crewTypeId) || '',
      dutyType: row.dutyTypeId == null ? '' : dutyNames.get(row.dutyTypeId) || '',
      count: row._count._all,
    })),
    divisions: byDivision
      .map(row => ({
        divisionId: row.divisionId,
        name: divisionNames.get(row.divisionId) || 'Division',
        count: row._count._all,
      }))
      .sort((left, right) => right.count - left.count),
  };
}
