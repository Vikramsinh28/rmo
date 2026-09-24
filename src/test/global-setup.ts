import { execSync } from 'child_process';

export default async function globalSetup() {
  console.log('🔧 Setting up test database...');

  try {
    if (process.env.SKIP_DB_SETUP === '1') {
      console.log('⏭️  SKIP_DB_SETUP=1 set, skipping database setup for tests');
      return;
    }
    // Set test database URL
    const testDatabaseUrl =
      process.env.TEST_DATABASE_URL ||
      'postgresql://postgres:postgres@127.0.0.1:5434/rmo_kostra_test?schema=public';
    const parsed = new URL(testDatabaseUrl);
    const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (!localHost || parsed.pathname !== '/rmo_kostra_test') {
      throw new Error('Refusing to migrate a database that is not local rmo_kostra_test');
    }

    console.log('📂 Using test database rmo_kostra_test');

    console.log('🗄️ Applying migrations to the local test database...');
    execSync('./node_modules/.bin/prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, POSTGRES_URL: testDatabaseUrl },
    });

    console.log('✅ Test database setup complete');
  } catch (error) {
    console.error('❌ Failed to setup test database:', error);
    throw error;
  }
}
