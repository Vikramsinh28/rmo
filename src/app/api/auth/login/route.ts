import { setAuthCookie } from '@/lib/auth/jwt';
import {
    badRequestResponse,
    formatZodError,
    internalServerErrorResponse,
    successResponse,
    validationErrorResponse,
} from '@/lib/utils';
import { loginSchema } from '@/schemas/auth.schema';
import { AuthService } from '@/services/internal/auth/auth';
import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering for this API route
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validationResult = loginSchema.safeParse(body);

    if (!validationResult.success) {
      return validationErrorResponse('Invalid input data', formatZodError(validationResult.error));
    }

    const { email, password } = validationResult.data;

    const result = await AuthService.login({
      email: email || undefined,
      identifier: validationResult.data.identifier || undefined,
      password,
    });

    if (!result.success) {
      if (result.status) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: result.status },
        );
      }
      return badRequestResponse(result.message);
    }

    // Set the token in an HTTP-only cookie (same as Google login)
    if (result.data?.token) {
      await setAuthCookie(result.data.token);
    }

    return successResponse({
      message: result.message,
      user: result.data?.user,
    });
  } catch (error) {
    console.error('Login API error:', error);
    return internalServerErrorResponse();
  }
}
