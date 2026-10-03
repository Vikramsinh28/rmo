import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomFromAlphabet(alphabet: string, length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function generateLobbyPublicToken(): string {
  return `RMO-LBY-${randomFromAlphabet(TOKEN_ALPHABET, 24)}`;
}

export function generatePublicSubmissionReference(at = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  return `RMO-FRM-${y}${m}${d}-${randomFromAlphabet(REF_ALPHABET, 6)}`;
}

export function normalizeStaffNumber(value: string): string {
  return value.trim().replace(/\s+/g, '').toLowerCase();
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export interface PublicCrewFormSessionClaims {
  typ: 'public_crew_form';
  lobbyId: number;
  userId: number;
  crewTypeId: number;
  divisionId: number;
  lobbyToken: string;
  exp: number;
}

function sessionSecret(): string {
  const secret =
    process.env.PUBLIC_CREW_FORM_SESSION_SECRET ||
    process.env.JWT_SECRET ||
    '';
  if (!secret) throw new Error('JWT_SECRET must be set');
  return secret;
}

function sessionTtlMs(): number {
  const raw = process.env.PUBLIC_CREW_FORM_SESSION_TTL_MS;
  if (raw && Number.isFinite(Number(raw))) return Number(raw);
  return 20 * 60 * 1000;
}

function sign(payloadB64: string): string {
  return createHmac('sha256', sessionSecret()).update(payloadB64).digest('base64url');
}

export async function signPublicCrewFormSession(
  claims: Omit<PublicCrewFormSessionClaims, 'typ' | 'exp'>,
): Promise<string> {
  const body: PublicCrewFormSessionClaims = {
    ...claims,
    typ: 'public_crew_form',
    exp: Date.now() + sessionTtlMs(),
  };
  const payloadB64 = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

export async function verifyPublicCrewFormSession(
  token: string,
): Promise<PublicCrewFormSessionClaims> {
  const [payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) throw new Error('invalid session');
  const expected = sign(payloadB64);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('invalid session signature');
  }
  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8'),
  ) as PublicCrewFormSessionClaims;
  if (payload.typ !== 'public_crew_form') throw new Error('invalid session type');
  if (!payload.exp || Date.now() > payload.exp) throw new Error('session expired');
  if (
    !Number.isInteger(payload.lobbyId) ||
    !Number.isInteger(payload.userId) ||
    !Number.isInteger(payload.crewTypeId) ||
    !Number.isInteger(payload.divisionId) ||
    !payload.lobbyToken
  ) {
    throw new Error('invalid session claims');
  }
  return payload;
}
