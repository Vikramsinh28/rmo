import { z } from 'zod';

/**
 * Authentication schemas for API validation
 */

const localhostEmailPattern = /^[^\s@]+@localhost$/i;

/** Accepts a normal address, and the local seed account `dev-admin@localhost`. */
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .refine(
    value => z.string().email().safeParse(value).success || localhostEmailPattern.test(value),
    'Invalid email format',
  );

// Signup schema (Step 1: Only email)
export const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export const loginSchema = z
  .object({
    email: z.string().trim().nullish(),
    identifier: z.string().trim().nullish(),
    password: z.string().min(1, 'Password is required'),
  })
  .superRefine((value, context) => {
    const email = (value.email || '').trim();
    const identifier = (value.identifier || '').trim();
    if (!email && !identifier) {
      context.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'User ID or email is required',
      });
      return;
    }
    if (email && !emailSchema.safeParse(email).success) {
      context.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'Invalid email format',
      });
    }
    if (identifier.includes('@') && !emailSchema.safeParse(identifier).success) {
      context.addIssue({
        code: 'custom',
        path: ['identifier'],
        message: 'Invalid email format',
      });
    }
  });

// Verify signup schema (Step 2: OTP verification and password setup)
export const verifySignupSchema = z.object({
  email: z.string().email('Invalid email format'),
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  otp: z.string().length(4, 'OTP must be 4 digits'),
});

// Forgot password schema
export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

// Reset password schema
export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  otp: z.string().length(4, 'OTP must be 4 digits'),
});

// Resend OTP schema
export const resendOTPSchema = z.object({
  email: z.string().email('Invalid email format'),
  purpose: z.enum(['SIGNUP', 'PASSWORD_RESET']),
});

// Google sign-in schema
export const googleSignInSchema = z.object({
  credential: z.string().min(1, 'Credential is required'),
});

// Type exports
export type SignupData = z.infer<typeof signupSchema>;
export type LoginData = z.infer<typeof loginSchema>;
export type VerifySignupData = z.infer<typeof verifySignupSchema>;
export type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordData = z.infer<typeof resetPasswordSchema>;
export type ResendOTPData = z.infer<typeof resendOTPSchema>;
export type GoogleSignInData = z.infer<typeof googleSignInSchema>;
