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
