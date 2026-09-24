import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
  name: string;
  profilePicture?: string;
  isOnboarded: boolean;
  credits: number;
  plan: string;
  isOverdue: boolean;
  planExpiringAt?: string;
  googleId: string;
  stripeCustomerId?: string;
  rmoRole?: string;
  accountStatus?: string;
  loginId?: string;
  homeZoneId?: number | null;
  homeDivisionId?: number | null;
  homeLobbyId?: number | null;
  scope?: string;
}

const JWT_ALGORITHM = 'HS256';

function readEnv(name: string): string | undefined {
  return process.env[name];
}

function jwtSecretKey(): Uint8Array {
  const secret = readEnv('JWT_SECRET');
  if (!secret) {
    throw new Error('JWT_SECRET must be set');
  }
  return new TextEncoder().encode(secret);
}

export function getJwtCookieName(): string {
  return readEnv('JWT_KEY') || 'auth-token';
}

export const JWT_KEY = readEnv('JWT_KEY');

export const generateJWT = async (payload: JWTPayload): Promise<string> => {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(jwtSecretKey());
};

export const verifyJWT = async (token: string): Promise<JWTPayload> => {
  try {
    const { payload } = await jwtVerify(token, jwtSecretKey(), {
      algorithms: [JWT_ALGORITHM],
    });

    return payload as unknown as JWTPayload;
  } catch (error) {
    console.error(error);
    throw new Error('Invalid JWT token');
  }
};

export const extractTokenFromRequest = (request: NextRequest): string | null => {
  const token = request.cookies.get(getJwtCookieName())?.value;
  return token || null;
};

export const getAuthUser = async (request: NextRequest): Promise<JWTPayload | null> => {
  try {
    const token = extractTokenFromRequest(request);
    if (!token) {
      return null;
    }

    return await verifyJWT(token);
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const getUserIdFromHeaders = (request: NextRequest): string | null => {
  const userId = request.headers.get('x-user-id');
  return userId;
};

/**
 * Sets the JWT token as an HTTP-only cookie
 * @param token - The JWT token to set
 */
export const setAuthCookie = async (token: string): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.set(getJwtCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60, // 24 hours
  });
};
