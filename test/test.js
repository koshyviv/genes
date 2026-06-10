'use strict';

/* End-to-end smoke test: boots the server against a temp data
   directory and exercises the whole API. Run: npm test */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const PORT = 18099;
const BASE = 'http://localhost:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: tmp, EDIT_PASSWORD: 'secret123' }),
  stdio: ['ignore', 'pipe', 'inherit']
});

let cookie = '';

async function api(method, p, body, headers) {
  const opts = { method, headers: Object.assign({ 'Content-Type': 'application/json', 'Cookie': cookie }, headers || {}) };
  if (body !== undefined) opts.body = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const res = await fetch(BASE + p, opts);
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + '/api/auth');
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}

async function main() {
  await waitForServer();

  // seed loaded
  let r = await api('GET', '/api/data');
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.persons.p_kochukoshy, 'seed person present');
  assert.ok(r.data.meta.title.includes('Kunnumpurathu'));

  // writes blocked without auth
  r = await api('POST', '/api/persons', { name: 'Blocked' });
  assert.strictEqual(r.status, 401, 'write requires auth');

  // bad login
  r = await api('POST', '/api/auth/login', { password: 'wrong' });
  assert.strictEqual(r.status, 401);

  // good login
  r = await api('POST', '/api/auth/login', { password: 'secret123' });
  assert.strictEqual(r.status, 200);
  assert.ok(cookie.includes('ftauth='), 'auth cookie set');

  // create person
  r = await api('POST', '/api/persons', { name: 'Test Amma', gender: 'F', birthDate: '1955' });
  assert.strictEqual(r.status, 201);
  const amma = r.data;

  // person without a name rejected
  r = await api('POST', '/api/persons', { name: '   ' });
  assert.strictEqual(r.status, 500); // cleanPersonInput throws

  // update person
  r = await api('PUT', '/api/persons/' + amma.id, { occupation: 'Teacher' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.occupation, 'Teacher');
  assert.strictEqual(r.data.name, 'Test Amma');

  // marry into existing union slot (p_keevarchan has a single-parent union)
  r = await api('PUT', '/api/unions/u_keevarchan', { partner2: amma.id });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.partner2, amma.id);

  // new child
  r = await api('POST', '/api/persons', { name: 'Test Child' });
  const child = r.data;
  r = await api('POST', '/api/unions/u_keevarchan/children', { childId: child.id });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.children.includes(child.id));

  // photo upload
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  r = await api('POST', '/api/persons/' + amma.id + '/photo', png, { 'Content-Type': 'image/png' });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.photo.startsWith('/photos/'));
  const photoRes = await fetch(BASE + r.data.photo);
  assert.strictEqual(photoRes.status, 200);

  // history
  r = await api('PUT', '/api/history', { text: '# Test history' });
  assert.strictEqual(r.status, 200);
  r = await api('GET', '/api/data');
  assert.strictEqual(r.data.history, '# Test history');

  // delete person cleans unions
  r = await api('DELETE', '/api/persons/' + child.id);
  assert.strictEqual(r.status, 200);
  r = await api('GET', '/api/data');
  assert.ok(!r.data.unions.u_keevarchan.children.includes(child.id));

  // export & import round-trip
  const exported = await api('GET', '/api/export');
  assert.strictEqual(exported.status, 200);
  r = await api('POST', '/api/import', exported.data);
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.persons >= 3);

  // import garbage rejected
  r = await api('POST', '/api/import', { persons: 'nope' });
  assert.strictEqual(r.status, 400);

  // path traversal blocked
  const trav = await fetch(BASE + '/photos/..%2F..%2Fetc%2Fpasswd');
  assert.notStrictEqual(trav.status, 200);

  // static index served
  const idx = await fetch(BASE + '/');
  assert.strictEqual(idx.status, 200);
  const html = await idx.text();
  assert.ok(html.includes('Kunnumpurathu'));

  console.log('All tests passed.');
}

main()
  .then(() => { server.kill(); process.exit(0); })
  .catch((e) => { console.error('TEST FAILED:', e); server.kill(); process.exit(1); });
