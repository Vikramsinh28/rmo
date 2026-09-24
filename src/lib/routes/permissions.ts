/**
 * Permission and authentication logic
 */

import { jwtVerify } from 'jose';
import { HttpMethod } from './types';
import { findMatchingRoute } from './utils';

/**
 * Verifies a JWT token and returns its payload
 */
export async function verifyJWT(token: string) {
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || '');
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

/**
 * Checks if a user has access to a specific path and method
 */
export function checkAccess(path: string, method: string, userRole: string): boolean {
  const route = findMatchingRoute(path);

  if (!route) return false;

  if (route.isPublic) {
    return true;
  }

  if (route.accessTo) {
    const allowed = route.accessTo[method as Exclude<HttpMethod, null>];
    if (allowed) return (allowed as readonly string[]).includes(userRole);
  }

  return false;
}

export function checkAnyAccess(path: string, method: string, roles: string[]): boolean {
  return roles.some(role => checkAccess(path, method, role));
}
