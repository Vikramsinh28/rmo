// Mock environment variables for testing
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5434/rmo_kostra_test?schema=public';
const testDatabase = new URL(testDatabaseUrl);
const localTestHost = testDatabase.hostname === '127.0.0.1' || testDatabase.hostname === 'localhost';
if (!localTestHost || testDatabase.pathname !== '/rmo_kostra_test') {
  throw new Error('Jest refuses to use a database that is not local rmo_kostra_test');
}
process.env.POSTGRES_URL = testDatabaseUrl;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.JWT_KEY = 'auth-token';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
  usePathname: () => '/test',
}));

// Global test utilities
global.console = {
  ...console,
  // Suppress console.error during tests unless explicitly needed
  error: jest.fn(),
  warn: jest.fn(),
};
