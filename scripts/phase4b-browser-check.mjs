import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const base = 'http://127.0.0.1:3000';
const password = 'Phase4bPass123!';
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
  return api('/api/auth/login', {
    method: 'POST',
    body: { identifier, password: userPassword },
    ok: false,
  });
}

async function cleanup() {
  const client = new Client({ connectionString: process.env.POSTGRES_URL });
  await client.connect();
  await client.query(`
    DELETE FROM "RecordingSegment" WHERE "lobbyId" IN (
      SELECT id FROM "Lobby" WHERE "divisionId" IN (
        SELECT id FROM "Division" WHERE code IN ('B4A', 'B4S')
      )
    );
    DELETE FROM "RoomParticipant" WHERE "callId" IN (
      SELECT id FROM "LobbyCall" WHERE "divisionId" IN (
        SELECT id FROM "Division" WHERE code IN ('B4A', 'B4S')
      )
    );
    DELETE FROM "LobbyCall" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('B4A', 'B4S')
    );
    DELETE FROM "LobbyRoom" WHERE "lobbyId" IN (
      SELECT id FROM "Lobby" WHERE "divisionId" IN (
        SELECT id FROM "Division" WHERE code IN ('B4A', 'B4S')
      )
    );
    DELETE FROM "AuditLog"
    WHERE "actorId" IN (SELECT id FROM "User" WHERE "loginId" LIKE 'phase4b-%')
       OR COALESCE(metadata::text, '') LIKE '%phase4b%';
    DELETE FROM "User" WHERE "loginId" LIKE 'phase4b-%';
    DELETE FROM "Lobby" WHERE "divisionId" IN (
      SELECT id FROM "Division" WHERE code IN ('B4A', 'B4S')
    );
    DELETE FROM "Division" WHERE code IN ('B4A', 'B4S');
    DELETE FROM "Zone" WHERE code = 'B4Z';
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
    body: { name: 'Phase4b West', code: 'B4Z' },
  })).payload.data;
  const ahmedabad = (await api('/api/admin/divisions', {
    method: 'POST',
    cookie: adminCookie,
    body: { zoneId: zone.id, name: 'Bhavnagar', code: 'B4A' },
  })).payload.data;
  const surat = (await api('/api/admin/divisions', {
    method: 'POST',
    cookie: adminCookie,
    body: { zoneId: zone.id, name: 'Surat', code: 'B4S' },
  })).payload.data;
  const vatva = (await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: ahmedabad.id, name: 'Vatva', code: 'B4V' },
  })).payload.data;
  const udhna = (await api('/api/admin/lobbies', {
    method: 'POST',
    cookie: adminCookie,
    body: { divisionId: surat.id, name: 'Udhna', code: 'B4U' },
  })).payload.data;

  async function user(body) {
    await api('/api/admin/users', { method: 'POST', cookie: adminCookie, body });
  }

  await user({
    name: 'Raj Patel',
    email: 'phase4b-monitor@localhost.test',
    loginId: 'phase4b-monitor',
    password,
    rmoRole: 'DIVISION_MONITOR',
    homeZoneId: zone.id,
    homeDivisionId: ahmedabad.id,
  });
  await user({
    name: 'Surat Monitor',
    email: 'phase4b-surat@localhost.test',
    loginId: 'phase4b-surat',
    password,
    rmoRole: 'DIVISION_MONITOR',
    homeZoneId: zone.id,
    homeDivisionId: surat.id,
  });
  await user({
    name: 'Vatva Desk',
    email: 'phase4b-lobby@localhost.test',
    loginId: 'phase4b-lobby',
    password,
    rmoRole: 'LOBBY_USER',
    homeZoneId: zone.id,
    homeDivisionId: ahmedabad.id,
    homeLobbyId: vatva.id,
  });
  await user({
    name: 'Crew One',
    email: 'phase4b-crew-a@localhost.test',
    loginId: 'phase4b-crew-a',
    password,
    rmoRole: 'CREW_USER',
    homeZoneId: zone.id,
    homeDivisionId: ahmedabad.id,
    homeLobbyId: vatva.id,
  });
  await user({
    name: 'Crew Two',
    email: 'phase4b-crew-b@localhost.test',
    loginId: 'phase4b-crew-b',
    password,
    rmoRole: 'CREW_USER',
    homeZoneId: zone.id,
    homeDivisionId: ahmedabad.id,
    homeLobbyId: vatva.id,
  });

  return { adminCookie, vatva, udhna };
}

function record(checks, name, pass, detail = '') {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function signIn(page, identifier) {
  const result = await login(identifier, password);
  if (result.status !== 200 || !result.cookie) {
    throw new Error(`Browser session failed for ${identifier}: ${result.payload?.message || result.status}`);
  }
  const cookies = result.cookie.split('; ').filter(Boolean).map(pair => {
    const index = pair.indexOf('=');
    return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
  });
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.setCookie(...cookies);
}

async function clickButton(page, label, occurrence = 0) {
  const handle = await page.evaluateHandle((expected, index) => {
    const matches = [...document.querySelectorAll('button')].filter(node => (
      (node.textContent || '').trim().toLowerCase() === expected
    ));
    return matches[index] || null;
  }, label.toLowerCase(), occurrence);
  const element = handle.asElement();
  if (!element) throw new Error(`Button not found: ${label}`);
  await element.click();
}

async function browserWalk(checks) {
  const vendor = '/tmp/phase3-puppeteer';
  mkdirSync(vendor, { recursive: true });
  if (!existsSync(`${vendor}/node_modules/puppeteer-core`)) {
    execSync('npm init -y && npm install puppeteer-core@24.15.0', { cwd: vendor, stdio: 'inherit' });
  }
  const puppeteer = createRequire(`${vendor}/package.json`)('puppeteer-core');
  const executablePath = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find(item => existsSync(item));
  if (!executablePath) throw new Error('Chrome was not found');
  const browserApp = await puppeteer.launch({
    executablePath,
    headless: true,
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  let lobbyPage;
  let monitorPage;
  try {
    const lobbyContext = await browserApp.createBrowserContext();
    const monitorContext = await browserApp.createBrowserContext();
    lobbyPage = await lobbyContext.newPage();
    monitorPage = await monitorContext.newPage();
    lobbyPage.setDefaultTimeout(60000);
    monitorPage.setDefaultTimeout(60000);

    await signIn(lobbyPage, 'phase4b-lobby');
    await lobbyPage.goto(`${base}/monitoring/desk`, { waitUntil: 'domcontentloaded' });
    await lobbyPage.waitForFunction(() => /vatva/i.test(document.body.innerText) && /online/i.test(document.body.innerText));
    record(checks, 'B. Lobby is online', true);

    await signIn(monitorPage, 'phase4b-monitor');
    await monitorPage.goto(`${base}/monitoring`, { waitUntil: 'domcontentloaded' });
    await monitorPage.waitForFunction(() => /vatva/i.test(document.body.innerText));
    const monitorText = await monitorPage.evaluate(() => document.body.innerText);
    record(checks, 'D. Monitor sees the lobby', /vatva/i.test(monitorText) && !/udhna/i.test(monitorText));

    await clickButton(monitorPage, 'Call lobby');
    await lobbyPage.waitForFunction(() => /incoming monitoring call/i.test(document.body.innerText));
    const incoming = await lobbyPage.evaluate(() => document.body.innerText);
    record(checks, 'F. Lobby receives the call', /bhavnagar/i.test(incoming) && /raj patel/i.test(incoming));

    await clickButton(lobbyPage, 'Accept');
    await lobbyPage.waitForFunction(() => /\blive\b/i.test(document.body.innerText) && /connected/i.test(document.body.innerText));
    record(checks, 'H. Call is connected', true);

    await signIn(lobbyPage, 'phase4b-crew-a');
    await lobbyPage.goto(`${base}/monitoring/desk`, { waitUntil: 'domcontentloaded' });
    await lobbyPage.waitForFunction(() => /join conversation/i.test(document.body.innerText));
    await clickButton(lobbyPage, 'Join conversation');
    await monitorPage.waitForFunction(() => /participants:\s*3/i.test(document.body.innerText));
    record(checks, 'J. First crew member is counted', true);

    const crewContext = await browserApp.createBrowserContext();
    const crewPage = await crewContext.newPage();
    crewPage.setDefaultTimeout(60000);
    await signIn(crewPage, 'phase4b-crew-b');
    await crewPage.goto(`${base}/monitoring/desk`, { waitUntil: 'domcontentloaded' });
    await crewPage.waitForFunction(() => /join conversation/i.test(document.body.innerText));
    await clickButton(crewPage, 'Join conversation');
    await monitorPage.waitForFunction(() => /participants:\s*4/i.test(document.body.innerText));
    record(checks, 'L. Two crew members are in the call', true);

    await clickButton(monitorPage, 'Start recording');
    await monitorPage.waitForFunction(() => /recording:\s*on/i.test(document.body.innerText));
    record(checks, 'N. Recording indicator is on', true);
    await clickButton(monitorPage, 'Stop recording');
    await monitorPage.waitForFunction(() => /recording:\s*off/i.test(document.body.innerText) && /live/i.test(document.body.innerText));
    record(checks, 'P. Call stays connected after recording stops', true);
    await clickButton(monitorPage, 'Start recording');
    await monitorPage.waitForFunction(() => /recording:\s*on/i.test(document.body.innerText));
    await clickButton(monitorPage, 'Stop recording');
    await monitorPage.waitForFunction(() => /recording:\s*off/i.test(document.body.innerText));
    record(checks, 'R. Second recording stopped', true);

    await clickButton(crewPage, 'Leave conversation');
    await monitorPage.waitForFunction(() => /participants:\s*3/i.test(document.body.innerText) && /live/i.test(document.body.innerText));
    record(checks, 'T. Call stays connected after crew leaves', true);

    await clickButton(monitorPage, 'End call');
    await monitorPage.waitForFunction(() => /end the call with/i.test(document.body.innerText));
    await clickButton(monitorPage, 'End call', 1);
    await monitorPage.waitForFunction(() => /not connected/i.test(document.body.innerText));
    record(checks, 'U. Monitor ended the call', true);

    await monitorPage.goto(`${base}/monitoring/history`, { waitUntil: 'domcontentloaded' });
    await monitorPage.waitForFunction(() => /vatva/i.test(document.body.innerText) && /completed/i.test(document.body.innerText));
    record(checks, 'V. Call history shows the completed call', true);
    await monitorPage.goto(`${base}/monitoring/recordings`, { waitUntil: 'domcontentloaded' });
    await monitorPage.waitForFunction(() => /vatva/i.test(document.body.innerText) && /completed/i.test(document.body.innerText));
    const recordings = await monitorPage.evaluate(() => document.body.innerText);
    record(checks, 'W. Recording history shows the segments', (recordings.match(/completed/ig) || []).length >= 2);
  } catch (error) {
    const lobbyText = await lobbyPage.evaluate(() => document.body.innerText).catch(() => '');
    const monitorText = await monitorPage.evaluate(() => document.body.innerText).catch(() => '');
    throw new Error(`${error}\nLOBBY:\n${lobbyText.slice(0, 700)}\nMONITOR:\n${monitorText.slice(0, 700)}`);
  } finally {
    await browserApp.close();
  }
}

const checks = [];
try {
  await cleanup();
  await seed();
  const system = await login(adminCandidates[0][0], adminCandidates[0][1]);
  if (system.status !== 200) {
    for (const [identifier, userPassword] of adminCandidates) {
      const result = await login(identifier, userPassword);
      if (result.status === 200) {
        checks.admin = result;
        break;
      }
    }
  }
  const monitor = await login('phase4b-monitor', password);
  const surat = await login('phase4b-surat', password);
  const lobby = await login('phase4b-lobby', password);
  record(checks, 'A. Lobby user can sign in', lobby.status === 200);
  record(checks, 'C. Division monitor can sign in', monitor.status === 200);
  const board = await api('/api/monitoring/lobbies', { cookie: monitor.cookie });
  record(checks, 'D. API hides the other division', board.payload.data.items.every(item => item.name !== 'Udhna'));
  const vatva = board.payload.data.items.find(item => item.name === 'Vatva');
  const cross = await api(`/api/monitoring/lobbies/${vatva.id}/call`, { method: 'POST', cookie: surat.cookie, ok: false });
  record(checks, 'Surat monitor cannot call Vatva', cross.status === 403);
  await browserWalk(checks);
} catch (error) {
  console.error(error);
  record(checks, 'Browser walk', false, error instanceof Error ? error.message : String(error));
} finally {
  await cleanup().catch(error => console.error(error));
}

const failed = checks.filter(item => !item.pass);
console.log(`${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exit(1);
