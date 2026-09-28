import { POST as analyze } from '@/app/api/ai/impairment/analyze/route';
import { prisma } from '@/lib/prisma';
import { toSessionClaims } from '@/lib/rmo/session-claims';
import { hashPassword } from '@/lib/utils';
import { NextRequest } from 'next/server';
import { cleanupDatabase } from '../setup';

jest.mock('@/lib/auth/jwt', () => ({
  generateJWT: jest.fn(async () => 'test-token'),
  setAuthCookie: jest.fn(),
  JWT_KEY: 'auth-token',
  getAuthUser: jest.fn(async (request: { headers: { get: (name: string) => string | null } }) => {
    const raw = request.headers.get('x-test-user');
    return raw ? JSON.parse(raw) : null;
  }),
}));

type Role = 'SYSTEM_ADMIN' | 'DIVISION_MONITOR' | 'CREW_USER';

async function userWith(input: {
  name: string;
  email: string;
  loginId: string;
  rmoRole: Role;
}) {
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      loginId: input.loginId,
      password: await hashPassword('TestPassword123!'),
      role: input.rmoRole === 'SYSTEM_ADMIN' ? 'ADMIN' : 'USER',
      rmoRole: input.rmoRole,
      accountStatus: 'ACTIVE',
      isOnboarded: true,
    },
  });
}

function jpegBytes() {
  // Minimal valid-looking JPEG SOI/EOI for RMO proxy validation (AI is mocked).
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(64, 0x00),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function requestFor(
  user: Parameters<typeof toSessionClaims>[0] | null,
  body?: BodyInit | null,
) {
  const headers = new Headers();
  if (user) headers.set('x-test-user', JSON.stringify(toSessionClaims(user)));
  return new NextRequest('http://localhost/api/ai/impairment/analyze', {
    method: 'POST',
    headers,
    body: body ?? undefined,
  });
}

async function frameForm() {
  const form = new FormData();
  form.append('frame', new Blob([new Uint8Array(jpegBytes())], { type: 'image/jpeg' }), 'frame.jpg');
  return form;
}

describe('Phase 9A impairment POC proxy', () => {
  let admin: Awaited<ReturnType<typeof userWith>>;
  let monitor: Awaited<ReturnType<typeof userWith>>;
  let crew: Awaited<ReturnType<typeof userWith>>;

  beforeEach(async () => {
    await cleanupDatabase();
    process.env.IMPAIRMENT_POC_ENABLED = 'true';
    process.env.AI_SERVICE_URL = 'http://127.0.0.1:8090';
    process.env.AI_SERVICE_TOKEN = 'local-ai-service-token';

    admin = await userWith({
      name: 'Admin',
      email: `admin-${Date.now()}@local`,
      loginId: `admin-${Date.now()}`,
      rmoRole: 'SYSTEM_ADMIN',
    });
    monitor = await userWith({
      name: 'Monitor',
      email: `mon-${Date.now()}@local`,
      loginId: `mon-${Date.now()}`,
      rmoRole: 'DIVISION_MONITOR',
    });
    crew = await userWith({
      name: 'Crew',
      email: `crew-${Date.now()}@local`,
      loginId: `crew-${Date.now()}`,
      rmoRole: 'CREW_USER',
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        analysis: {
          status: 'NO_CLEAR_INDICATOR',
          riskLevel: 'LOW',
          confidence: null,
          indicators: [],
          requiresHumanReview: false,
          disclaimer: 'assistive only',
        },
        provider: 'mock',
        developmentOnly: true,
        analyzedAt: new Date().toISOString(),
        limitations: {
          singleFrameOnly: true,
          pocOnly: true,
          doesNotConfirmAlcoholConsumption: true,
          doesNotConfirmIntoxication: true,
          requiresHumanVerification: true,
        },
      }),
    })) as unknown as typeof fetch;
  });

  afterAll(async () => {
    delete process.env.IMPAIRMENT_POC_ENABLED;
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  it('rejects anonymous and non-admin roles', async () => {
    const anon = await analyze(await requestFor(null, await frameForm()));
    expect(anon.status).toBe(401);

    for (const actor of [monitor, crew]) {
      const denied = await analyze(await requestFor(actor, await frameForm()));
      expect(denied.status).toBe(403);
    }
  });

  it('rejects when POC flag is disabled', async () => {
    delete process.env.IMPAIRMENT_POC_ENABLED;
    const denied = await analyze(await requestFor(admin, await frameForm()));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe('IMPAIRMENT_POC_DISABLED');
  });

  it('proxies a valid frame to the AI service and returns normalized POC result', async () => {
    const response = await analyze(await requestFor(admin, await frameForm()));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.success).toBe(true);
    expect(body.data.provider).toBe('mock');
    expect(body.data.internalPoc).toBe(true);
    expect(body.data.analysis.status).toBe('NO_CLEAR_INDICATOR');
    expect(body.data.limitations.doesNotConfirmAlcoholConsumption).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/secretAccessKey|AWS_ACCESS_KEY|providerFaceId/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(call[0])).toContain('/impairment/analyze');
  });

  it('rejects empty and invalid images without calling AI', async () => {
    const emptyForm = new FormData();
    emptyForm.append('frame', new Blob([]), 'empty.jpg');
    const empty = await analyze(await requestFor(admin, emptyForm));
    expect(empty.status).toBe(400);

    const badForm = new FormData();
    badForm.append('frame', new Blob([new Uint8Array([1, 2, 3])]), 'bad.bin');
    const bad = await analyze(await requestFor(admin, badForm));
    expect(bad.status).toBe(400);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 503 when AI service is down', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const response = await analyze(await requestFor(admin, await frameForm()));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('IMPAIRMENT_SERVICE_UNAVAILABLE');
  });
});
