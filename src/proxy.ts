import { getAuthUser, getJwtCookieName, JWTPayload } from '@/lib/auth/jwt';
import {
  applyCorsHeaders,
  checkAnyAccess,
  findMatchingRoute,
  handleCorsPreflightRequest,
  isPublicRoute,
  isRouteConfigured,
  requiresRoleAccess,
} from '@/lib/routes';
import { NextRequest, NextResponse } from 'next/server';
import { unauthorizedResponse } from './lib/utils/response/response';

function sessionRoles(authUser: JWTPayload): string[] {
  const roles = authUser.rmoRole ? [authUser.rmoRole] : [];
  return roles;
}

function denied(request: NextRequest, status: 401 | 403) {
  if (status === 401) {
    const response = unauthorizedResponse('Authentication is required.');
    response.cookies.delete(getJwtCookieName());
    return applyCorsHeaders(request, response);
  }
  const response = NextResponse.json(
    { success: false, message: 'You do not have permission to perform this action.' },
    { status: 403 },
  );
  return applyCorsHeaders(request, response);
}

// Middleware is now called Proxy
// https://nextjs.org/docs/app/getting-started/proxy#proxy
const proxy = async (request: NextRequest) => {
  const preflightResponse = handleCorsPreflightRequest(request);
  if (preflightResponse) return preflightResponse;

  const { pathname: path } = new URL(request.url);
  const { method } = request;

  let authUser: JWTPayload | null = null;

  try {
    authUser = await getAuthUser(request);
  } catch (error) {
    console.error('Auth error:', error);
  }

  // Check if route is configured
  const isConfigured = isRouteConfigured(path);
  if (!isConfigured) {
    const response = NextResponse.json(
      { error: 'Route not found', message: 'This route is not configured' },
      { status: 404 }
    );
    return applyCorsHeaders(request, response);
  }

  const isPublic = isPublicRoute(request);
  const matchedRoute = findMatchingRoute(path);
  const needsRoleAccess = requiresRoleAccess(matchedRoute, method);

  // Only protect non-public routes, but check if method allows public access
  if (!isPublic && !authUser) {
    // Check if this method allows public access (empty array in accessTo)
    const methodAccess =
      matchedRoute?.accessTo?.[
        method as Exclude<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', null>
      ];
    const isPublicMethod = methodAccess && methodAccess.length === 0;

    // If method is not public, return appropriate response
    if (!isPublicMethod) {
      // For API routes, return JSON error instead of redirect
      if (path.startsWith('/api/')) {
        return denied(request, 401);
      }
      // For page routes, redirect to login
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete(getJwtCookieName());
      return response;
    }
  }

  // For non-public routes, check role access
  if (!isPublic && needsRoleAccess) {
    // Check if this method allows public access (empty array in accessTo)
    const methodAccess =
      matchedRoute?.accessTo?.[
        method as Exclude<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', null>
      ];
    const isPublicMethod = methodAccess && methodAccess.length === 0;

    // If method is not public, ensure the user is authenticated
    if (!isPublicMethod && !authUser) {
      // For API routes, return JSON error instead of redirect
      if (path.startsWith('/api/')) {
        return denied(request, 401);
      }
      // For page routes, redirect to login
      const response = NextResponse.redirect(new URL('/login', request.url));
      response.cookies.delete(getJwtCookieName());
      return response;
    }

    // If method requires authentication, check role access
    if (!isPublicMethod && authUser) {
      const hasAccess = checkAnyAccess(path, method, sessionRoles(authUser));

      if (!hasAccess) {
        if (path.startsWith('/api/')) {
          return denied(request, 403);
        }

        const response = NextResponse.redirect(new URL('/overview', request.url));
        return response;
      }
    }
  }

  // Create response with user ID in headers if user is authenticated
  const response = NextResponse.next();

  if (authUser?.userId) {
    response.headers.set('x-user-id', authUser.userId.toString());
  }

  return applyCorsHeaders(request, response);
};

export default proxy;

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!sentry-tunnel|_next/static|_next/image|favicon.ico|favicon/|sw.js|offline.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)',
  ],
};
