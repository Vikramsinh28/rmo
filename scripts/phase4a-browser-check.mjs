import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:3000';
const password = 'Phase4aPass123!';
const crewPassword = 'CrewWalk123!';
const seedPassword = readFileSync('prisma/seed.ts', 'utf8').match(/DEV_PASSWORD = '([^']+)'/)?.[1];
const adminCandidates = [
  [process.env.RMO_LOGIN, process.env.RMO_PASSWORD],
  ['systemadmin', seedPassword],
  ['sysadmin', seedPassword],
].filter(pair => pair[0] && pair[1]);

const requireFromProject = createRequire(resolve('package.json'));
const { Client } = requireFromProject('pg');

function cookieHeader(response) {
  const raw = response.headers.getSetCookie?.() || [];
  return raw.map(item => item.split(';')[0]).join('; ');
}

async function api(path, { method = 'GET', body, cookie, ok = true } = {}) {
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
    payload = { message: text };
  }
  if (ok && !response.ok) {
    throw new Error(`${method} ${path} ${response.status}: ${payload?.message || text}`);
  }
  return { status: response.status, payload, cookie: cookieHeader(response) || cookie };
}

async function login(identifier, userPassword) {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { identifier, password: userPassword },
    ok: false,
  });
  return result;
}

async function cleanup() {
  const client = new Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  await client.query(`
    DELETE FROM "CrewEnrollment"
    WHERE "loginId" LIKE 'phase4a-%' OR email LIKE 'phase4a-%';
    DELETE FROM "Submission"
    WHERE "submittedById" IN (SELECT id FROM "User" WHERE "loginId" LIKE 'phase4a-%');
    DELETE FROM "AuditLog"
    WHERE "actorId" IN (SELECT id FROM "User" WHERE "loginId" LIKE 'phase4a-%')
       OR metadata::text LIKE '%phase4a-%';
    DELETE FROM "User" WHERE "loginId" LIKE 'phase4a-%';
    DELETE FROM "Lobby" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('P4A', 'P4B')
    );
    DELETE FROM "Division" WHERE code IN ('P4A', 'P4B');
    DELETE FROM "Zone" WHERE code = 'P4Z';
  `);
  await client.end();
}

async function seed() {
  let adminCookie = '';
  let lastError = 'no admin login';
  for (const [identifier, userPassword] of adminCandidates) {
    const result = await login(identifier, userPassword);
    if (result.status === 200 && result.cookie) {
      adminCookie = result.cookie;
      break;
    }
    lastError = result.payload?.message || String(result.status);
  }
  if (!adminCookie) throw new Error(`System admin login failed: ${lastError}`);

  const zone = (await api('/api/admin/zones', {
    method: 'POST',
    cookie: adminCookie,
    body: { name: 'Phase4 West', code: 'P4Z' },
  })).payload.data;
  const ahmedabad = (await api('/api/admin/divisions', {
    method: 'POST',
    cookie: adminCookie,
    body: { zoneId: zone.id, name: 'Phase4 Ahmedabad', code: 'P4A' },
  })).payload.data;
  const surat = (await api('/api/admin/divisions', {
    method: 'POST',
    cookie: adminCookie,
    body: { zoneId: zone.id, name: 'Phase4 Surat', code: 'P4B' },
  })).payload.data;
  const vatva = (await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: ahmedabad.id, name: 'Phase4 Vatva', code: 'P4V' },
  })).payload.data;
  const botad = (await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: ahmedabad.id, name: 'Phase4 Botad', code: 'P4O' },
  })).payload.data;
  await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: surat.id, name: 'Phase4 Udhna', code: 'P4U' },
  });
  const makeAdmin = async (loginId, divisionId) => {
    await api('/api/admin/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        name: loginId,
        email: `${loginId}@localhost.test`,
        loginId,
        password,
        rmoRole: 'DIVISION_ADMIN',
        homeZoneId: zone.id,
        homeDivisionId: divisionId,
      },
    });
  };
  await makeAdmin('phase4a-adi-admin', ahmedabad.id);
  await makeAdmin('phase4a-sur-admin', surat.id);
  return { zone, ahmedabad, vatva, botad };
}

function record(checks, name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function browserWalk(checks, org) {
  const vendor = '/tmp/phase3-puppeteer';
  mkdirSync(vendor, { recursive: true });
  if (!existsSync(`${vendor}/node_modules/puppeteer-core`)) {
    execSync('npm init -y && npm install puppeteer-core@24.15.0', { cwd: vendor, stdio: 'inherit' });
  }
  const puppeteer = createRequire(`${vendor}/package.json`)('puppeteer-core');
  const executablePath = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(path => existsSync(path));
  if (!executablePath) throw new Error('Chrome was not found');
  const browserApp = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browserApp.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${base}/enroll`, { waitUntil: 'networkidle0' });
    const enrollText = await page.evaluate(() => document.body.innerText);
    record(checks, 'Public enroll page', enrollText.includes('Crew enrollment') && enrollText.includes('Personal'));

    await page.type('#full-name', 'Amit Patel');
    await page.type('#email', 'phase4a-crew@localhost.test');
    await page.type('#phone', '9876543210');
    await page.type('#employee-id', 'P4-EMP');
    await page.click('button[type="button"]');
    await page.waitForFunction(() => document.body.innerText.includes('Employee / staff number'));
    await page.type('#staff-number', 'P4-STAFF');
    const buttons = await page.$$('button[type="button"]');
    await buttons[buttons.length - 1].click();
    await page.waitForFunction(() => document.body.innerText.includes('Requested location'));
    await page.select('#zone', String(org.zone.id));
    await page.select('#division', String(org.ahmedabad.id));
    await page.select('#lobby', String(org.vatva.id));
    let continueButton = await page.$$('button[type="button"]');
    await continueButton[continueButton.length - 1].click();
    await page.waitForFunction(() => document.body.innerText.includes('Enrollment form'));
    continueButton = await page.$$('button[type="button"]');
    await continueButton[continueButton.length - 1].click();
    await page.waitForFunction(() => document.body.innerText.includes('Login credentials'));
    await page.type('#login-id', 'phase4a-crew');
    await page.type('#password', crewPassword);
    await page.type('#confirm-password', crewPassword);
    continueButton = await page.$$('button[type="button"]');
    await continueButton[continueButton.length - 1].click();
    await page.waitForFunction(() => document.body.innerText.includes('Review and submit'));
    const reviewText = await page.evaluate(() => document.body.innerText);
    record(checks, 'Review hides password', reviewText.includes('not shown') && !reviewText.includes(crewPassword));
    await Promise.all([
      page.waitForFunction(() => document.body.innerText.includes('Enrollment submitted')),
      page.click('button[type="submit"]'),
    ]);
    const successText = await page.evaluate(() => document.body.innerText);
    record(checks, 'Success screen', successText.includes('RMO-ENR-') && /pending approval/i.test(successText));

    const pending = await login('phase4a-crew', crewPassword);
    record(
      checks,
      'Pending login blocked',
      pending.status !== 200 && pending.payload?.message === 'Your crew enrollment is awaiting approval.',
      pending.payload?.message,
    );

    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
    await page.type('#identifier', 'phase4a-adi-admin');
    await page.type('#password', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"]'),
    ]);
    await page.goto(`${base}/enrollments`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Amit Patel'));
    const listText = await page.evaluate(() => document.body.innerText);
    record(checks, 'Admin sees pending applicant', listText.includes('Amit Patel') && !listText.includes(crewPassword));
    await Promise.all([
      page.waitForFunction(() => document.body.innerText.includes('Personal information')),
      page.evaluate(() => {
        const link = [...document.querySelectorAll('a')].find(node => node.textContent?.trim() === 'Review');
        link?.click();
      }),
    ]);
    const detailText = await page.evaluate(() => document.body.innerText);
    record(checks, 'Review hides password', !detailText.includes(crewPassword) && !/password hash/i.test(detailText));
    const approveButton = await page.evaluateHandle(() => (
      [...document.querySelectorAll('button')].find(node => (node.textContent || '').includes('Approve')) || null
    ));
    const box = await approveButton.asElement()?.boundingBox();
    if (!box) {
      const debug = await page.evaluate(() => ({
        count: document.querySelectorAll('button').length,
        texts: [...document.querySelectorAll('button')].map(node => node.textContent),
        has: document.body.innerHTML.includes('>Approve</button>'),
      }));
      throw new Error(`Approve button was not clickable ${JSON.stringify(debug)} text=${detailText.slice(0, 500)}`);
    }
    await approveButton.asElement()?.click();
    try {
      await page.waitForFunction(() => document.body.innerText.includes('Approve crew enrollment'), { timeout: 8000 });
    } catch (error) {
      throw new Error(`Dialog did not open after a real click at ${box.x},${box.y}\n${error}`);
    }
    await page.select('select[aria-label="Final lobby"]', String(org.botad.id));
    const dialogButtons = await page.$$('button');
    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(node => (node.textContent || '').includes('Approve enrollment'));
      button?.click();
      return Boolean(button);
    });
    if (!clicked) throw new Error('Approve enrollment button was not found');
    try {
      await page.waitForFunction(() => /\bApproved\b/.test(document.body.innerText), { timeout: 20000 });
      record(checks, 'Approved in the review screen', true);
    } catch (error) {
      const text = await page.evaluate(() => document.body.innerText);
      throw new Error(`Approval did not finish.\n${text.slice(0, 1200)}\n${error}`);
    }

    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
    const logout = page.url();
    void logout;
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
    await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
    await page.type('#identifier', 'phase4a-crew');
    await page.type('#password', crewPassword);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"]'),
    ]);
    const home = await page.evaluate(() => document.body.innerText);
    record(checks, 'Crew signs in with chosen password', !home.includes('Sign in') && home.length > 0, page.url());
  } finally {
    await browserApp.close();
  }
}

async function main() {
  const checks = [];
  await cleanup();
  try {
    const org = await seed();
    await browserWalk(checks, org);
    const surat = await login('phase4a-sur-admin', password);
    const hidden = await api('/api/admin/crew-enrollments', { cookie: surat.cookie });
    const names = hidden.payload.data.items.map(item => item.fullName);
    record(checks, 'Surat admin cannot see Ahmedabad enrollment', !names.includes('Amit Patel'));
    const second = await api('/api/enrollment/crew', {
      method: 'POST',
      ok: false,
      body: {
        fullName: 'Second Crew',
        email: 'phase4a-reject@localhost.test',
        phone: '9876543211',
        employeeId: 'P4-EMP-2',
        staffNumber: 'P4-STAFF-2',
        loginId: 'phase4a-reject',
        password: crewPassword,
        confirmPassword: crewPassword,
        zoneId: org.zone.id,
        divisionId: org.ahmedabad.id,
        lobbyId: org.vatva.id,
        answers: {},
      },
    });
    record(checks, 'Second enrollment accepted', second.status === 201, second.payload?.message);
    const admin = await login('phase4a-adi-admin', password);
    const list = await api('/api/admin/crew-enrollments?status=PENDING', { cookie: admin.cookie });
    const pending = list.payload.data.items.find(item => item.loginId === 'phase4a-reject');
    const rejected = await api(`/api/admin/crew-enrollments/${pending.id}/reject`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { reason: 'Walkthrough rejection' },
    });
    record(checks, 'Rejection stored', rejected.payload.data.status === 'REJECTED');
    const blocked = await login('phase4a-reject', crewPassword);
    record(
      checks,
      'Rejected login blocked',
      blocked.payload?.message === 'Your crew enrollment was not approved.',
      blocked.payload?.message,
    );
  } finally {
    await cleanup();
  }
  const failed = checks.filter(item => !item.pass);
  if (failed.length > 0) {
    console.log(`${failed.length} check(s) failed`);
    process.exit(1);
  }
  console.log(`${checks.length} checks passed`);
}

main().catch(async error => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
