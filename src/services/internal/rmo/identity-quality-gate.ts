export type IdentityGateReason =
  | 'GOOD'
  | 'NO_FACE'
  | 'FACE_TOO_SMALL'
  | 'LOW_FACE_QUALITY'
  | 'INVALID_FACE_BOX'
  // Back-compat aliases used in older Phase 11 drafts / logs:
  | 'LOW_QUALITY'
  | 'INVALID_CROP';

export interface IdentityQualityGateResult {
  eligible: boolean;
  qualityScore: number | null;
  reason: IdentityGateReason;
}

export interface FaceBoxNorm {
  x: number;
  y: number;
  width: number;
  height: number;
}

function minFaceQuality() {
  const value = Number(process.env.IDENTITY_RESOLUTION_MIN_FACE_QUALITY || 0.7);
  if (!Number.isFinite(value) || value < 0 || value > 1) return 0.7;
  return value;
}

function minFaceSize() {
  const value = Number(process.env.IDENTITY_RESOLUTION_MIN_FACE_SIZE || 0.05);
  if (!Number.isFinite(value) || value <= 0) return 0.05;
  return value;
}

/** Evaluate whether a tracked face is eligible for an identity lookup. */
export function evaluateIdentityQualityGate(input: {
  faceVisible?: boolean | null;
  faceQuality?: number | null;
  faceBox?: FaceBoxNorm | null;
  personQualityScore?: number | null;
}): IdentityQualityGateResult {
  if (!input.faceVisible || !input.faceBox) {
    return { eligible: false, qualityScore: input.faceQuality ?? null, reason: 'NO_FACE' };
  }

  const box = input.faceBox;
  if (
    !Number.isFinite(box.x)
    || !Number.isFinite(box.y)
    || !Number.isFinite(box.width)
    || !Number.isFinite(box.height)
    || box.width <= 0
    || box.height <= 0
    || box.x < 0
    || box.y < 0
    || box.x + box.width > 1.001
    || box.y + box.height > 1.001
  ) {
    return { eligible: false, qualityScore: input.faceQuality ?? null, reason: 'INVALID_FACE_BOX' };
  }

  const minSize = minFaceSize();
  if (box.width < minSize || box.height < minSize) {
    return {
      eligible: false,
      qualityScore: input.faceQuality ?? null,
      reason: 'FACE_TOO_SMALL',
    };
  }

  const quality = input.faceQuality ?? input.personQualityScore ?? null;
  if (quality == null || quality < minFaceQuality()) {
    return { eligible: false, qualityScore: quality, reason: 'LOW_FACE_QUALITY' };
  }

  return { eligible: true, qualityScore: quality, reason: 'GOOD' };
}
