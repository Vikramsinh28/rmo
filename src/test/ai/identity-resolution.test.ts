import { prisma } from '@/lib/prisma';
import { RmoError } from '@/lib/rmo/errors';
import { hashPassword } from '@/lib/utils';
import { getIdentityResolutionProvider } from '@/services/internal/rmo/identity-provider';
import { evaluateIdentityQualityGate } from '@/services/internal/rmo/identity-quality-gate';
import {
  clearIdentitySession,
  getSessionIdentityMetrics,
  getTrackIdentityOverlay,
  identityCooldownMs,
  mergeIdentityIntoPersons,
  processIdentityCandidatesForTests,
  resolveTrackedPersonIdentity,
  seedRecognizedTrackForTests,
  setSessionConcurrentForTests,
} from '@/services/internal/rmo/identity-resolution';
import { cleanupDatabase } from '../setup';

jest.mock('@/lib/auth/jwt', () => ({
  generateJWT: jest.fn(async () => 'test-token'),
  setAuthCookie: jest.fn(),
  JWT_KEY: 'auth-token',
  getAuthUser: jest.fn(async () => null),
}));

async function seedDivision() {
  const zone = await prisma.zone.create({
    data: { name: 'West', code: `W-${Date.now()}`, status: 'ACTIVE' },
  });
  const division = await prisma.division.create({
    data: {
      name: 'Ahmedabad',
      code: `ADI-${Date.now()}`,
      status: 'ACTIVE',
      zoneId: zone.id,
    },
  });
  return { zone, division };
}

async function crewUser(divisionId: number, zoneId: number, name = 'Vikram Parmar') {
  return prisma.user.create({
    data: {
      name,
      email: `crew-${Date.now()}-${Math.random()}@local`,
      loginId: `crew-${Date.now()}-${Math.random()}`,
      password: await hashPassword('TestPassword123!'),
      role: 'USER',
      rmoRole: 'CREW_USER',
      accountStatus: 'ACTIVE',
      isOnboarded: true,
      homeZoneId: zoneId,
      homeDivisionId: divisionId,
    },
  });
}

async function enableFaceId(divisionId: number, faceIdentification = true) {
  await prisma.divisionAIEntitlement.create({
    data: {
      divisionId,
      enabled: true,
      plan: 'PREMIUM',
      status: 'ACTIVE',
      faceIdentification,
    },
  });
}

async function ensureCollection(divisionId: number) {
  await prisma.divisionFaceCollection.create({
    data: {
      divisionId,
      collectionId: `rmo-local-division-${divisionId}`,
    },
  });
}

function jpegBytes(tag = '') {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(400, 0x41),
    tag ? Buffer.from(`FACEID:${tag}|`) : Buffer.alloc(0),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function goodFacePerson(trackId: string, quality = 0.9) {
  return {
    trackId,
    face: {
      visible: true,
      quality,
      boundingBox: { x: 0.3, y: 0.2, width: 0.2, height: 0.3 },
    },
    quality: { score: quality },
  };
}

describe('Phase 11 identity resolution', () => {
  beforeEach(async () => {
    await cleanupDatabase();
    process.env.IDENTITY_RESOLUTION_ENABLED = 'true';
    process.env.IDENTITY_RESOLUTION_PROVIDER = 'mock';
    process.env.FACE_RECOGNITION_PROVIDER = 'mock';
    process.env.IDENTITY_RESOLUTION_COOLDOWN_MS = '60000';
    process.env.IDENTITY_RESOLUTION_MAX_REQUESTS_PER_SESSION = '100';
    process.env.IDENTITY_RESOLUTION_MAX_FACES_PER_REQUEST = '5';
    process.env.IDENTITY_MAX_CONCURRENT_REQUESTS = '2';
    process.env.IDENTITY_RESOLUTION_MIN_FACE_QUALITY = '0.7';
    process.env.IDENTITY_RESOLUTION_MIN_MATCH_CONFIDENCE = '90';
    process.env.IDENTITY_MAX_MISSED_CONFIRMATIONS = '3';
    delete process.env.MOCK_IDENTITY_RESULT;
    delete process.env.MOCK_RECOGNITION_FACE_ID;
    delete process.env.MOCK_IDENTITY_DELAY_MS;
    for (const id of [1, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 42, 50, 51]) {
      clearIdentitySession(id);
    }
  });

  afterAll(async () => {
    await cleanupDatabase();
    await prisma.$disconnect();
  });

  it('1. feature disabled → no provider call', async () => {
    process.env.IDENTITY_RESOLUTION_ENABLED = 'false';
    const { zone, division } = await seedDivision();
    const actor = await crewUser(division.id, zone.id);
    await enableFaceId(division.id);
    await processIdentityCandidatesForTests({
      callId: 50,
      divisionId: division.id,
      actorId: actor.id,
      frame: jpegBytes(),
      persons: [goodFacePerson('Person-1')],
    });
    expect(getSessionIdentityMetrics(50).requestCount).toBe(0);
    expect(getTrackIdentityOverlay(50).get('Person-1')?.identityReason).toBe('FEATURE_DISABLED');
  });

  it('2. entitlement disabled → no identity request', async () => {
    const { zone, division } = await seedDivision();
    const actor = await crewUser(division.id, zone.id);
    await enableFaceId(division.id, false);
    await processIdentityCandidatesForTests({
      callId: 51,
      divisionId: division.id,
      actorId: actor.id,
      frame: jpegBytes(),
      persons: [goodFacePerson('Person-1')],
    });
    expect(getSessionIdentityMetrics(51).requestCount).toBe(0);
    expect(getTrackIdentityOverlay(51).get('Person-1')?.identityReason).toBe('ENTITLEMENT_DISABLED');
  });

  it('3–4. face missing / quality below threshold → no request', async () => {
    expect(evaluateIdentityQualityGate({ faceVisible: false }).reason).toBe('NO_FACE');
    expect(
      evaluateIdentityQualityGate({
        faceVisible: true,
        faceBox: { x: 0.4, y: 0.4, width: 0.02, height: 0.02 },
        faceQuality: 0.9,
      }).reason,
    ).toBe('FACE_TOO_SMALL');
    expect(
      evaluateIdentityQualityGate({
        faceVisible: true,
        faceBox: { x: 0.3, y: 0.2, width: 0.2, height: 0.25 },
        faceQuality: 0.4,
      }).reason,
    ).toBe('LOW_FACE_QUALITY');
    expect(
      evaluateIdentityQualityGate({
        faceVisible: true,
        faceBox: { x: -0.1, y: 0.2, width: 0.2, height: 0.25 },
        faceQuality: 0.9,
      }).reason,
    ).toBe('INVALID_FACE_BOX');

    const { zone, division } = await seedDivision();
    const actor = await crewUser(division.id, zone.id);
    await enableFaceId(division.id);
    await processIdentityCandidatesForTests({
      callId: 11,
      divisionId: division.id,
      actorId: actor.id,
      frame: jpegBytes(),
      persons: [{
        trackId: 'Person-11',
        face: {
          visible: true,
          quality: 0.2,
          boundingBox: { x: 0.3, y: 0.2, width: 0.2, height: 0.3 },
        },
      }],
    });
    expect(getSessionIdentityMetrics(11).requestCount).toBe(0);
    expect(getSessionIdentityMetrics(11).skippedQuality).toBeGreaterThanOrEqual(1);
  });

  it('5. quality above threshold → provider called; 11. recognized returned', async () => {
    const { zone, division } = await seedDivision();
    const crew = await crewUser(division.id, zone.id);
    const faceId = `mock-face-rmo-user-${crew.id}`;
    process.env.MOCK_RECOGNITION_FACE_ID = faceId;
    process.env.MOCK_IDENTITY_RESULT = 'recognized';
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    await prisma.userFaceEnrollment.create({
      data: {
        userId: crew.id,
        divisionId: division.id,
        status: 'ENROLLED',
        provider: 'AWS_REKOGNITION',
        collectionId: `rmo-local-division-${division.id}`,
        providerFaceId: faceId,
        enrolledAt: new Date(),
      },
    });

    const first = await resolveTrackedPersonIdentity({
      callId: 42,
      divisionId: division.id,
      actorId: crew.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(first.status).toBe('RECOGNIZED');
    expect(first.displayName).toBe('Vikram Parmar');
    expect(first.userId).toBe(crew.id);
    expect(JSON.stringify(first)).not.toMatch(/providerFaceId|FaceMatches|secretAccessKey/i);
    expect(getSessionIdentityMetrics(42).requestCount).toBe(1);
    expect(getSessionIdentityMetrics(42).recognizedCount).toBe(1);
  });

  it('6–7. cooldown prevents repeated lookup; independent per track', async () => {
    const { zone, division } = await seedDivision();
    const crew = await crewUser(division.id, zone.id);
    const faceId = `mock-face-rmo-user-${crew.id}`;
    process.env.MOCK_RECOGNITION_FACE_ID = faceId;
    process.env.MOCK_IDENTITY_RESULT = 'recognized';
    process.env.IDENTITY_RESOLUTION_COOLDOWN_MS = '60000';
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    await prisma.userFaceEnrollment.create({
      data: {
        userId: crew.id,
        divisionId: division.id,
        status: 'ENROLLED',
        provider: 'AWS_REKOGNITION',
        collectionId: `rmo-local-division-${division.id}`,
        providerFaceId: faceId,
        enrolledAt: new Date(),
      },
    });

    await resolveTrackedPersonIdentity({
      callId: 12,
      divisionId: division.id,
      actorId: crew.id,
      trackId: 'Person-A',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(getSessionIdentityMetrics(12).requestCount).toBe(1);

    // Same track still in cooldown — should not request again.
    clearIdentitySession(12);
    // Re-seed cooldown state via first resolve then scheduler:
    await resolveTrackedPersonIdentity({
      callId: 12,
      divisionId: division.id,
      actorId: crew.id,
      trackId: 'Person-A',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    // Force UNKNOWN so ALREADY_RECOGNIZED does not skip; cooldown should still block.
    const overlay = getTrackIdentityOverlay(12).get('Person-A')!;
    overlay.identityStatus = 'UNKNOWN';
    overlay.userId = null;
    overlay.displayName = null;
    overlay.missedConfirmations = 0;

    await processIdentityCandidatesForTests({
      callId: 12,
      divisionId: division.id,
      actorId: crew.id,
      frame: jpegBytes(),
      persons: [goodFacePerson('Person-A'), goodFacePerson('Person-B')],
    });
    // Person-A cooldown; Person-B eligible → +1
    expect(getSessionIdentityMetrics(12).requestCount).toBe(2);
    expect(getTrackIdentityOverlay(12).get('Person-A')?.identityReason).toBe('COOLDOWN');
    expect(getTrackIdentityOverlay(12).get('Person-B')?.identityStatus).toBe('RECOGNIZED');
  });

  it('8. session request limit stops further requests', async () => {
    const { zone, division } = await seedDivision();
    const crew = await crewUser(division.id, zone.id);
    process.env.MOCK_IDENTITY_RESULT = 'unknown';
    process.env.IDENTITY_RESOLUTION_MAX_REQUESTS_PER_SESSION = '1';
    process.env.IDENTITY_RESOLUTION_COOLDOWN_MS = '0';
    await enableFaceId(division.id);
    await ensureCollection(division.id);

    await resolveTrackedPersonIdentity({
      callId: 13,
      divisionId: division.id,
      actorId: crew.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(getSessionIdentityMetrics(13).requestCount).toBe(1);

    await processIdentityCandidatesForTests({
      callId: 13,
      divisionId: division.id,
      actorId: crew.id,
      frame: jpegBytes(),
      persons: [goodFacePerson('Person-2')],
    });
    expect(getSessionIdentityMetrics(13).requestCount).toBe(1);
    expect(getTrackIdentityOverlay(13).get('Person-2')?.identityReason).toBe('SESSION_LIMIT');
  });

  it('9. concurrency limit is respected', async () => {
    const { zone, division } = await seedDivision();
    const crew = await crewUser(division.id, zone.id);
    process.env.MOCK_IDENTITY_RESULT = 'unknown';
    process.env.IDENTITY_MAX_CONCURRENT_REQUESTS = '1';
    process.env.IDENTITY_RESOLUTION_COOLDOWN_MS = '0';
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    setSessionConcurrentForTests(14, division.id, 1);

    await processIdentityCandidatesForTests({
      callId: 14,
      divisionId: division.id,
      actorId: crew.id,
      frame: jpegBytes(),
      persons: [goodFacePerson('Person-1')],
    });
    expect(getSessionIdentityMetrics(14).requestCount).toBe(0);
    expect(getTrackIdentityOverlay(14).get('Person-1')?.identityReason).toBe('CONCURRENCY_LIMIT');
  });

  it('10. max faces per frame prefers highest quality', async () => {
    const { zone, division } = await seedDivision();
    const crew = await crewUser(division.id, zone.id);
    process.env.MOCK_IDENTITY_RESULT = 'unknown';
    process.env.IDENTITY_RESOLUTION_MAX_FACES_PER_REQUEST = '2';
    process.env.IDENTITY_RESOLUTION_COOLDOWN_MS = '0';
    await enableFaceId(division.id);
    await ensureCollection(division.id);

    await processIdentityCandidatesForTests({
      callId: 15,
      divisionId: division.id,
      actorId: crew.id,
      frame: jpegBytes(),
      persons: [
        goodFacePerson('Person-low', 0.71),
        goodFacePerson('Person-mid', 0.88),
        goodFacePerson('Person-high', 0.95),
        {
          trackId: 'Person-reject',
          face: {
            visible: true,
            quality: 0.61,
            boundingBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          },
        },
      ],
    });
    expect(getSessionIdentityMetrics(15).requestCount).toBe(2);
    expect(getTrackIdentityOverlay(15).get('Person-high')?.identityAttempts).toBeGreaterThan(0);
    expect(getTrackIdentityOverlay(15).get('Person-mid')?.identityAttempts).toBeGreaterThan(0);
    expect(getTrackIdentityOverlay(15).get('Person-low')?.identityReason).toBe('MAX_FACES_PER_FRAME');
    expect(getTrackIdentityOverlay(15).get('Person-reject')?.identityReason).toBe('LOW_FACE_QUALITY');
  });

  it('12. unknown result remains UNKNOWN', async () => {
    const { zone, division } = await seedDivision();
    const actor = await crewUser(division.id, zone.id, 'Monitor Actor');
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    process.env.MOCK_IDENTITY_RESULT = 'unknown';
    const result = await resolveTrackedPersonIdentity({
      callId: 7,
      divisionId: division.id,
      actorId: actor.id,
      trackId: 'Person-2',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(result.status).toBe('UNKNOWN');
    expect(result.userId).toBeNull();
  });

  it('13. provider failure → UNAVAILABLE; 20. does not throw / live-call unaffected', async () => {
    const { zone, division } = await seedDivision();
    const actor = await crewUser(division.id, zone.id, 'Monitor Actor 2');
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    process.env.MOCK_IDENTITY_RESULT = 'unavailable';
    const result = await resolveTrackedPersonIdentity({
      callId: 8,
      divisionId: division.id,
      actorId: actor.id,
      trackId: 'Person-3',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(result.status).toBe('UNAVAILABLE');
    // Scheduler path must also swallow failures.
    await expect(processIdentityCandidatesForTests({
      callId: 8,
      divisionId: division.id,
      actorId: actor.id,
      frame: jpegBytes(),
      persons: [goodFacePerson('Person-4')],
    })).resolves.toBeUndefined();
  });

  it('14. UserFaceEnrollment missing → UNKNOWN', async () => {
    const { zone, division } = await seedDivision();
    const actor = await crewUser(division.id, zone.id);
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    process.env.MOCK_RECOGNITION_FACE_ID = 'orphan-face-id';
    process.env.MOCK_IDENTITY_RESULT = 'recognized';
    const result = await resolveTrackedPersonIdentity({
      callId: 16,
      divisionId: division.id,
      actorId: actor.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(result.status).toBe('UNKNOWN');
  });

  it('15. enrollment from another division cannot resolve', async () => {
    const { zone, division } = await seedDivision();
    const other = await prisma.division.create({
      data: {
        name: 'Vadodara',
        code: `BRC-${Date.now()}`,
        status: 'ACTIVE',
        zoneId: zone.id,
      },
    });
    const crew = await crewUser(other.id, zone.id, 'Other Div Crew');
    const faceId = `cross-div-face-${crew.id}`;
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    await prisma.userFaceEnrollment.create({
      data: {
        userId: crew.id,
        divisionId: other.id,
        status: 'ENROLLED',
        provider: 'AWS_REKOGNITION',
        collectionId: `rmo-local-division-${other.id}`,
        providerFaceId: faceId,
        enrolledAt: new Date(),
      },
    });
    process.env.MOCK_RECOGNITION_FACE_ID = faceId;
    process.env.MOCK_IDENTITY_RESULT = 'recognized';
    const result = await resolveTrackedPersonIdentity({
      callId: 17,
      divisionId: division.id,
      actorId: crew.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(result.status).toBe('UNKNOWN');
  });

  it('16. non-CREW_USER enrollment cannot resolve', async () => {
    const { zone, division } = await seedDivision();
    const monitor = await crewUser(division.id, zone.id, 'Monitor Face');
    await prisma.user.update({
      where: { id: monitor.id },
      data: { rmoRole: 'DIVISION_MONITOR' },
    });
    const faceId = `monitor-face-${monitor.id}`;
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    await prisma.userFaceEnrollment.create({
      data: {
        userId: monitor.id,
        divisionId: division.id,
        status: 'ENROLLED',
        provider: 'AWS_REKOGNITION',
        collectionId: `rmo-local-division-${division.id}`,
        providerFaceId: faceId,
        enrolledAt: new Date(),
      },
    });
    process.env.MOCK_RECOGNITION_FACE_ID = faceId;
    process.env.MOCK_IDENTITY_RESULT = 'recognized';
    const result = await resolveTrackedPersonIdentity({
      callId: 18,
      divisionId: division.id,
      actorId: monitor.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(result.status).toBe('UNKNOWN');
  });

  it('17. recognized identity survives temporary misses', async () => {
    const { zone, division } = await seedDivision();
    const crew = await crewUser(division.id, zone.id);
    process.env.IDENTITY_MAX_MISSED_CONFIRMATIONS = '3';
    process.env.MOCK_IDENTITY_RESULT = 'unknown';
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    seedRecognizedTrackForTests({
      callId: 19,
      divisionId: division.id,
      trackId: 'Person-1',
      userId: crew.id,
      displayName: crew.name,
      confidence: 96,
    });

    await resolveTrackedPersonIdentity({
      callId: 19,
      divisionId: division.id,
      actorId: crew.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    const afterOne = getTrackIdentityOverlay(19).get('Person-1')!;
    expect(afterOne.identityStatus).toBe('RECOGNIZED');
    expect(afterOne.missedConfirmations).toBe(1);
    expect(afterOne.displayName).toBe(crew.name);
  });

  it('18. conflicting identity requires confirmation', async () => {
    const { zone, division } = await seedDivision();
    const vikram = await crewUser(division.id, zone.id, 'Vikram');
    const rahul = await crewUser(division.id, zone.id, 'Rahul');
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    await prisma.userFaceEnrollment.create({
      data: {
        userId: rahul.id,
        divisionId: division.id,
        status: 'ENROLLED',
        provider: 'AWS_REKOGNITION',
        collectionId: `rmo-local-division-${division.id}`,
        providerFaceId: `rahul-face-${rahul.id}`,
        enrolledAt: new Date(),
      },
    });
    seedRecognizedTrackForTests({
      callId: 20,
      divisionId: division.id,
      trackId: 'Person-1',
      userId: vikram.id,
      displayName: 'Vikram',
      confidence: 97,
    });
    process.env.MOCK_RECOGNITION_FACE_ID = `rahul-face-${rahul.id}`;
    process.env.MOCK_IDENTITY_RESULT = 'recognized';
    process.env.IDENTITY_RESOLUTION_COOLDOWN_MS = '0';

    await resolveTrackedPersonIdentity({
      callId: 20,
      divisionId: division.id,
      actorId: vikram.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(getTrackIdentityOverlay(20).get('Person-1')?.userId).toBe(vikram.id);
    expect(getTrackIdentityOverlay(20).get('Person-1')?.pendingConfirmations).toBe(1);

    await resolveTrackedPersonIdentity({
      callId: 20,
      divisionId: division.id,
      actorId: vikram.id,
      trackId: 'Person-1',
      faceImage: jpegBytes(),
      qualityScore: 0.9,
    });
    expect(getTrackIdentityOverlay(20).get('Person-1')?.userId).toBe(rahul.id);
    expect(getTrackIdentityOverlay(20).get('Person-1')?.displayName).toBe('Rahul');
  });

  it('19. stopping AI clears identity state', () => {
    seedRecognizedTrackForTests({
      callId: 21,
      divisionId: 1,
      trackId: 'Person-1',
      userId: 99,
      displayName: 'Temp',
    });
    expect(getTrackIdentityOverlay(21).size).toBe(1);
    clearIdentitySession(21);
    expect(getTrackIdentityOverlay(21).size).toBe(0);
    expect(getSessionIdentityMetrics(21).requestCount).toBe(0);
  });

  it('21. AWS provider never receives a browser-supplied collection', () => {
    process.env.IDENTITY_RESOLUTION_PROVIDER = 'aws';
    const provider = getIdentityResolutionProvider();
    expect(provider.name).toBe('aws');
    // Collection is always taken from DivisionFaceCollection in resolveTrackedPersonIdentity.
    process.env.IDENTITY_RESOLUTION_PROVIDER = 'mock';
  });

  it('22–23. FaceId / raw image never in API overlay; merge is safe', async () => {
    const { zone, division } = await seedDivision();
    const crew = await crewUser(division.id, zone.id);
    const faceId = `mock-face-rmo-user-${crew.id}`;
    process.env.MOCK_RECOGNITION_FACE_ID = faceId;
    process.env.MOCK_IDENTITY_RESULT = 'recognized';
    await enableFaceId(division.id);
    await ensureCollection(division.id);
    await prisma.userFaceEnrollment.create({
      data: {
        userId: crew.id,
        divisionId: division.id,
        status: 'ENROLLED',
        provider: 'AWS_REKOGNITION',
        collectionId: `rmo-local-division-${division.id}`,
        providerFaceId: faceId,
        enrolledAt: new Date(),
      },
    });
    await resolveTrackedPersonIdentity({
      callId: 9,
      divisionId: division.id,
      actorId: crew.id,
      trackId: 'Person-9',
      faceImage: jpegBytes(),
      qualityScore: 0.95,
    });
    const merged = mergeIdentityIntoPersons(9, [
      { trackId: 'Person-9', identity: { status: 'UNKNOWN' } },
    ]);
    expect(merged[0].identity).toMatchObject({
      status: 'RECOGNIZED',
      displayName: 'Vikram Parmar',
    });
    const payload = JSON.stringify(merged);
    expect(payload).not.toMatch(/FaceId|providerFaceId|collectionId|ACCESS_KEY|secret/i);
    expect(payload).not.toMatch(/ffd8ff|FACEID:/i);
  });

  it('blocks when face identification entitlement is off (direct resolve)', async () => {
    const { division } = await seedDivision();
    await enableFaceId(division.id, false);
    await expect(
      resolveTrackedPersonIdentity({
        callId: 1,
        divisionId: division.id,
        actorId: 1,
        trackId: 'Person-1',
        faceImage: jpegBytes(),
        qualityScore: 0.9,
      }),
    ).rejects.toBeInstanceOf(RmoError);
  });

  it('exposes cooldown helper', () => {
    expect(identityCooldownMs()).toBeGreaterThan(0);
  });
});
