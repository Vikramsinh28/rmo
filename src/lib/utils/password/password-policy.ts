export const PASSWORD_CHECKS = [
  {
    id: 'length',
    label: '8+ characters',
    message: 'Password must be at least 8 characters long',
    test: (password: string) => password.length >= 8,
  },
  {
    id: 'upper',
    label: 'Uppercase',
    message: 'Password must contain at least one uppercase letter',
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: 'lower',
    label: 'Lowercase',
    message: 'Password must contain at least one lowercase letter',
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: 'number',
    label: 'Number',
    message: 'Password must contain at least one number',
    test: (password: string) => /\d/.test(password),
  },
  {
    id: 'special',
    label: 'Special character',
    message: 'Password must contain at least one special character',
    test: (password: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  },
] as const;

export function validatePassword(password: string): { isValid: boolean; errors: string[] } {
  const errors = PASSWORD_CHECKS.filter(check => !check.test(password)).map(check => check.message);
  return { isValid: errors.length === 0, errors };
}
