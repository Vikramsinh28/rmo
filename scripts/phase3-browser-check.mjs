import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:3000';
const password = process.env.PHASE3_PASSWORD || 'Phase3Pass123!';
const adminLogin = process.env.RMO_LOGIN || 'systemadmin';
const seedPassword = readFileSync('prisma/seed.ts', 'utf8').match(/DEV_PASSWORD = '([^']+)'/)?.[1];
const adminPassword = process.env.RMO_PASSWORD || seedPassword;
if (!adminPassword) throw new Error('RMO_PASSWORD is required');

const requireFromProject = createRequire(resolve('package.json'));
const { Client } = requireFromProject('pg');
const schema = {
  sections: ['General'],
  fields: [
    {
      id: 'crew_name',
      key: 'crew_name',
      label: 'Crew name',
      type: 'TEXT',
      required: true,
      placeholder: '',
      helpText: '',
      options: [],
      validation: {},
      displayOrder: 0,
      section: 'General',
    },
  ],
};

function cookieHeader(response) {
  const raw = response.headers.getSetCookie?.() || [];
  return raw.map(item => item.split(';')[0]).join('; ');
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.message || text || response.statusText;
    throw new Error(`${method} ${path} ${response.status}: ${message}`);
  }
  return { payload, cookie: cookieHeader(response) || cookie, text };
}

async function login(identifier, userPassword) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password: userPassword }),
  });
  const text = await response.text();
  const payload = JSON.parse(text);
  if (!response.ok) throw new Error(payload.message || 'Login failed');
  return cookieHeader(response);
}

async function cleanup() {
  const databaseUrl = process.env.POSTGRES_URL;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`
    DELETE FROM "Submission" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('P3A', 'P3B')
    );
    DELETE FROM "Register" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('P3A', 'P3B')
    );
    DELETE FROM "FormAssignment" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('P3A', 'P3B')
    );
    UPDATE "Form" SET "currentVersionId" = NULL WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('P3A', 'P3B')
    );
    DELETE FROM "FormVersion" WHERE "formId" IN (
      SELECT id FROM "Form" WHERE "divisionId" IN (
        SELECT id FROM "Division" WHERE code IN ('P3A', 'P3B')
      )
    );
    DELETE FROM "Form" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('P3A', 'P3B')
    );
    DELETE FROM "User" WHERE "loginId" LIKE 'phase3-%';
    DELETE FROM "Lobby" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('P3A', 'P3B')
    );
    DELETE FROM "Division" WHERE code IN ('P3A', 'P3B');
    DELETE FROM "Zone" WHERE code = 'P3Z';
  `);
  await client.end();
}

async function seed() {
  const adminCookie = await login(adminLogin, adminPassword);
  const zone = (await api('/api/admin/zones', {
    method: 'POST',
    cookie: adminCookie,
    body: { name: 'Phase3 West', code: 'P3Z' },
  })).payload.data;
  const divisionA = (await api('/api/admin/divisions', {
    method: 'POST',
    cookie: adminCookie,
    body: { zoneId: zone.id, name: 'Phase3 Ahmedabad', code: 'P3A' },
  })).payload.data;
  const divisionB = (await api('/api/admin/divisions', {
    method: 'POST',
    cookie: adminCookie,
    body: { zoneId: zone.id, name: 'Phase3 Surat', code: 'P3B' },
  })).payload.data;
  const lobbyA1 = (await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: divisionA.id, name: 'Lobby A1', code: 'A1' },
  })).payload.data;
  const lobbyA2 = (await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: divisionA.id, name: 'Lobby A2', code: 'A2' },
  })).payload.data;
  const lobbyB1 = (await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: divisionB.id, name: 'Lobby B1', code: 'B1' },
  })).payload.data;
  await api('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Phase3 Ahmedabad Admin',
      email: 'phase3-adi-admin@localhost.test',
      loginId: 'phase3-adi-admin',
      password,
      rmoRole: 'DIVISION_ADMIN',
      homeZoneId: zone.id,
      homeDivisionId: divisionA.id,
    },
  });
  const makeForm = async (name, divisionId, lobbyId) => {
    const created = (await api('/api/admin/forms', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        name,
        description: `${name} for the local walkthrough`,
        divisionId,
        schema,
        assignments: [{ divisionId, lobbyId }],
      },
    })).payload.data;
    await api(`/api/admin/forms/${created.id}/publish`, { method: 'POST', cookie: adminCookie });
    await api('/api/admin/registers', {
      method: 'POST',
      cookie: adminCookie,
      body: { name: `Register ${name}`, divisionId, formId: created.id },
    });
    return created;
  };
  const formA1 = await makeForm('Form A1', divisionA.id, lobbyA1.id);
  const formA2 = await makeForm('Form A2', divisionA.id, lobbyA2.id);
  const formB1 = await makeForm('Form B1', divisionB.id, lobbyB1.id);
  const crew = async (loginId, division, lobby) => {
    await api('/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        name: loginId,
        email: `${loginId}@localhost.test`,
        loginId,
        password,
        rmoRole: 'CREW_USER',
        homeZoneId: zone.id,
        homeDivisionId: division.id,
        homeLobbyId: lobby.id,
      },
    });
    const cookie = await login(loginId, password);
    return cookie;
  };
  const crewA = await crew('phase3-crew-a', divisionA, lobbyA1);
  const crewB = await crew('phase3-crew-b', divisionB, lobbyB1);
  await api('/api/submissions', {
    method: 'POST',
    cookie: crewA,
    body: { formId: formA1.id, answers: { crew_name: 'Crew A' } },
  });
  await api('/api/submissions', {
    method: 'POST',
    cookie: crewA,
    body: { formId: formA1.id, answers: { crew_name: 'Crew A again' } },
  });
  await api('/api/submissions', {
    method: 'POST',
    cookie: crewB,
    body: { formId: formB1.id, answers: { crew_name: 'Crew Surat' } },
  });
  return { divisionA, divisionB, formA1, formA2, formB1 };
}

function chromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  return candidates.find(path => existsSync(path));
}

async function browser() {
  const vendor = '/tmp/phase3-puppeteer';
  mkdirSync(vendor, { recursive: true });
  if (!existsSync(`${vendor}/node_modules/puppeteer-core`)) {
    execSync('npm init -y && npm install puppeteer-core@24.15.0', {
      cwd: vendor,
      stdio: 'inherit',
    });
  }
  const puppeteer = createRequire(`${vendor}/package.json`)('puppeteer-core');
  const executablePath = chromePath();
  if (!executablePath) throw new Error('Chrome was not found');
  const browserApp = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox'],
  });
  const checks = [];
  const record = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  try {
    const page = await browserApp.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', error => console.log(`PAGE ${error.message}`));
    const signIn = async (loginId, userPassword) => {
      await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
      await page.click('#identifier', { clickCount: 3 });
      await page.type('#identifier', loginId);
      await page.type('#password', userPassword);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
        page.click('button[type="submit"]'),
      ]);
    };
    await signIn('phase3-adi-admin', password);
    await page.goto(`${base}/forms`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Form A1'));
    const formsText = await page.evaluate(() => document.body.innerText);
    record('A forms visible', formsText.includes('Form A1') && formsText.includes('Form A2'));
    record('B forms hidden', !formsText.includes('Form B1'), formsText.includes('Form B1') ? 'Form B1 visible' : '');
    await page.goto(`${base}/registers`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Register Form A1'));
    const registersText = await page.evaluate(() => document.body.innerText);
    record('A registers visible', registersText.includes('Register Form A1') && registersText.includes('Register Form A2'));
    record('B registers hidden', !registersText.includes('Register Form B1'));
    await page.goto(`${base}/submissions`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('phase3-crew-a'));
    const submissionsText = await page.evaluate(() => document.body.innerText);
    record('A submissions visible', submissionsText.includes('phase3-crew-a') && submissionsText.includes('Form A1'));
    record('B submissions hidden', !submissionsText.includes('phase3-crew-b') && !submissionsText.includes('Crew Surat'));
    await page.goto(`${base}/analytics`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /total submissions/i.test(document.body.innerText));
    const analyticsText = await page.evaluate(() => document.body.innerText);
    record('Analytics shows A only', analyticsText.includes('Form A1') && !analyticsText.includes('Form B1') && !analyticsText.includes('Lobby B1'));
    const exportResponse = await page.evaluate(async () => {
      const response = await fetch('/api/submissions/export');
      return { status: response.status, text: await response.text() };
    });
    record('Export is A only', exportResponse.status === 200 && exportResponse.text.includes('phase3-crew-a') && !exportResponse.text.includes('phase3-crew-b'));
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
    const cookies = await page.cookies();
    if (cookies.length) await page.deleteCookie(...cookies);
    await signIn(adminLogin, adminPassword);
    await page.goto(`${base}/analytics`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /total submissions/i.test(document.body.innerText));
    const systemText = await page.evaluate(() => document.body.innerText);
    const divisionOptions = await page.$$eval('select[aria-label="Division"] option', options => options.map(option => option.textContent));
    record('All divisions available', divisionOptions.includes('All divisions') && divisionOptions.includes('Phase3 Ahmedabad') && divisionOptions.includes('Phase3 Surat'));
    record('System admin sees both forms', systemText.includes('Form A1') && systemText.includes('Form B1'));
    const metricText = () => page.evaluate(() => {
      const card = [...document.querySelectorAll('article')].find(item => /total submissions/i.test(item.innerText));
      return card ? card.innerText : '';
    });
    const before = await metricText();
    const suratValue = await page.$eval(
      'select[aria-label="Division"]',
      (select, name) => {
        const match = [...select.options].find(item => item.textContent === name);
        return match ? match.value : '';
      },
      'Phase3 Surat',
    );
    await page.select('select[aria-label="Division"]', suratValue);
    await page.waitForFunction(
      previous => {
        const card = [...document.querySelectorAll('article')].find(item => /total submissions/i.test(item.innerText));
        return card && card.innerText !== previous;
      },
      {},
      before,
    );
    const after = await metricText();
    const formChart = await page.evaluate(() => {
      const card = [...document.querySelectorAll('article')].find(item => /submissions by form/i.test(item.innerText));
      return card ? card.innerText : '';
    });
    record(
      'Division filter changes charts',
      before !== after && /form b1/i.test(formChart) && !/form a1/i.test(formChart),
      `${before.replace(/\s+/g, ' ')} -> ${after.replace(/\s+/g, ' ')}; ${formChart.replace(/\s+/g, ' ')}`,
    );
    await page.goto(`${base}/submissions`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('phase3-crew-a') && document.body.innerText.includes('phase3-crew-b'));
    record('System admin sees all submissions', true);
  } finally {
    await browserApp.close();
  }
  return checks;
}

const results = [];
try {
  await cleanup();
  await seed();
  results.push(...await browser());
} catch (error) {
  console.error(error);
  results.push({ name: 'walkthrough', pass: false, detail: error instanceof Error ? error.message : String(error) });
} finally {
  await cleanup().catch(error => console.error(error));
}
const failed = results.filter(item => !item.pass);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exit(1);
