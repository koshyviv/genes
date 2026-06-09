'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const PORT = parseInt(process.env.PORT || '8080', 10);
const EDIT_PASSWORD = process.env.EDIT_PASSWORD || '';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

// ---------- auth ----------

function authSecret() {
  return crypto.createHash('sha256').update('kunnumpurathu-ft|' + EDIT_PASSWORD).digest();
}

function authToken() {
  return crypto.createHmac('sha256', authSecret()).update('edit-granted').digest('hex');
}

function isAuthed(req) {
  if (!EDIT_PASSWORD) return true;
  const cookies = (req.headers.cookie || '').split(';').map(s => s.trim());
  for (const c of cookies) {
    if (c.startsWith('ftauth=')) {
      const val = c.slice('ftauth='.length);
      const expected = authToken();
      if (val.length === expected.length) {
        try {
          if (crypto.timingSafeEqual(Buffer.from(val), Buffer.from(expected))) return true;
        } catch (e) { /* fall through */ }
      }
    }
  }
  return false;
}

// ---------- helpers ----------

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limitBytes) {
  const buf = await readBody(req, limitBytes || 2 * 1024 * 1024);
  return JSON.parse(buf.toString('utf8') || '{}');
}

const PERSON_FIELDS = [
  'name', 'malayalamName', 'gender', 'birthDate', 'birthPlace',
  'deathDate', 'deathPlace', 'living', 'occupation', 'education',
  'branch', 'bio', 'notes', 'photo'
];

function cleanPersonInput(input, base) {
  const p = Object.assign({}, base);
  for (const f of PERSON_FIELDS) {
    if (f in input) {
      if (f === 'living') p[f] = !!input[f];
      else p[f] = String(input[f] == null ? '' : input[f]).slice(0, f === 'bio' || f === 'notes' ? 100000 : 500);
    }
  }
  if (!p.name || !p.name.trim()) throw new Error('A name is required');
  p.name = p.name.trim();
  return p;
}

// ---------- API routing ----------

async function handleApi(req, res, pathname) {
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]

  // --- auth ---
  if (pathname === '/api/auth' && method === 'GET') {
    return sendJson(res, 200, { required: !!EDIT_PASSWORD, authed: isAuthed(req) });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readJsonBody(req, 10240);
    if (EDIT_PASSWORD && body.password === EDIT_PASSWORD) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'ftauth=' + authToken() + '; Path=/; HttpOnly; Max-Age=31536000; SameSite=Lax'
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    return sendJson(res, 401, { error: 'That password is not correct.' });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'ftauth=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax'
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  // --- reads (open) ---
  if (pathname === '/api/data' && method === 'GET') {
    return sendJson(res, 200, store.get());
  }
  if (pathname === '/api/export' && method === 'GET') {
    const body = JSON.stringify(store.get(), null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="familytree-export.json"'
    });
    return res.end(body);
  }

  // --- everything below requires edit rights ---
  if (!isAuthed(req)) {
    return sendJson(res, 401, { error: 'Please sign in to make changes.' });
  }

  // meta / history
  if (pathname === '/api/meta' && method === 'PUT') {
    const body = await readJsonBody(req);
    const db = store.mutate(db => {
      for (const f of ['title', 'subtitle', 'rootId']) {
        if (f in body) db.meta[f] = body[f] == null ? null : String(body[f]).slice(0, 500);
      }
      return db;
    });
    return sendJson(res, 200, db.meta);
  }
  if (pathname === '/api/history' && method === 'PUT') {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    store.mutate(db => { db.history = String(body.text || '').slice(0, 2000000); });
    return sendJson(res, 200, { ok: true });
  }

  // persons
  if (pathname === '/api/persons' && method === 'POST') {
    const body = await readJsonBody(req);
    const person = cleanPersonInput(body, {
      id: store.newId('p'), gender: '', birthDate: '', birthPlace: '', deathDate: '',
      deathPlace: '', living: true, occupation: '', education: '', branch: '',
      bio: '', notes: '', photo: '', malayalamName: '',
      createdAt: new Date().toISOString()
    });
    store.mutate(db => { db.persons[person.id] = person; });
    return sendJson(res, 201, person);
  }
  if (parts[1] === 'persons' && parts.length === 3 && method === 'PUT') {
    const id = parts[2];
    const body = await readJsonBody(req);
    let updated = null;
    store.mutate(db => {
      const existing = db.persons[id];
      if (!existing) return;
      updated = cleanPersonInput(body, existing);
      updated.updatedAt = new Date().toISOString();
      db.persons[id] = updated;
    });
    if (!updated) return sendJson(res, 404, { error: 'Person not found' });
    return sendJson(res, 200, updated);
  }
  if (parts[1] === 'persons' && parts.length === 3 && method === 'DELETE') {
    const id = parts[2];
    let found = false;
    store.mutate(db => {
      if (!db.persons[id]) return;
      found = true;
      delete db.persons[id];
      for (const [uid, u] of Object.entries(db.unions)) {
        if (u.partner1 === id) u.partner1 = null;
        if (u.partner2 === id) u.partner2 = null;
        u.children = u.children.filter(c => c !== id);
        if (!u.partner1 && !u.partner2) delete db.unions[uid];
      }
      if (db.meta.rootId === id) db.meta.rootId = null;
    });
    if (!found) return sendJson(res, 404, { error: 'Person not found' });
    return sendJson(res, 200, { ok: true });
  }

  // photo upload (raw image body)
  if (parts[1] === 'persons' && parts[3] === 'photo' && parts.length === 4 && method === 'POST') {
    const id = parts[2];
    const db = store.get();
    if (!db.persons[id]) return sendJson(res, 404, { error: 'Person not found' });
    const ctype = (req.headers['content-type'] || '').split(';')[0].trim();
    const ext = IMAGE_EXT[ctype];
    if (!ext) return sendJson(res, 400, { error: 'Please choose a JPG, PNG, WEBP or GIF image.' });
    const buf = await readBody(req, 10 * 1024 * 1024);
    const fname = id + '-' + Date.now() + ext;
    fs.writeFileSync(path.join(store.PHOTOS_DIR, fname), buf);
    const url = '/photos/' + fname;
    store.mutate(db2 => { if (db2.persons[id]) db2.persons[id].photo = url; });
    return sendJson(res, 200, { photo: url });
  }

  // unions
  if (pathname === '/api/unions' && method === 'POST') {
    const body = await readJsonBody(req);
    const union = {
      id: store.newId('u'),
      partner1: body.partner1 || null,
      partner2: body.partner2 || null,
      marriageDate: String(body.marriageDate || '').slice(0, 200),
      marriagePlace: String(body.marriagePlace || '').slice(0, 500),
      children: Array.isArray(body.children) ? body.children : []
    };
    if (!union.partner1 && !union.partner2) return sendJson(res, 400, { error: 'A union needs at least one partner' });
    store.mutate(db => { db.unions[union.id] = union; });
    return sendJson(res, 201, union);
  }
  if (parts[1] === 'unions' && parts.length === 3 && method === 'PUT') {
    const id = parts[2];
    const body = await readJsonBody(req);
    let updated = null;
    store.mutate(db => {
      const u = db.unions[id];
      if (!u) return;
      if ('partner1' in body) u.partner1 = body.partner1 || null;
      if ('partner2' in body) u.partner2 = body.partner2 || null;
      if ('marriageDate' in body) u.marriageDate = String(body.marriageDate || '').slice(0, 200);
      if ('marriagePlace' in body) u.marriagePlace = String(body.marriagePlace || '').slice(0, 500);
      updated = u;
    });
    if (!updated) return sendJson(res, 404, { error: 'Union not found' });
    return sendJson(res, 200, updated);
  }
  if (parts[1] === 'unions' && parts.length === 3 && method === 'DELETE') {
    const id = parts[2];
    let found = false;
    store.mutate(db => {
      if (db.unions[id]) { found = true; delete db.unions[id]; }
    });
    if (!found) return sendJson(res, 404, { error: 'Union not found' });
    return sendJson(res, 200, { ok: true });
  }
  if (parts[1] === 'unions' && parts[3] === 'children' && parts.length === 4 && method === 'POST') {
    const id = parts[2];
    const body = await readJsonBody(req);
    let result = null;
    store.mutate(db => {
      const u = db.unions[id];
      if (!u || !db.persons[body.childId]) return;
      if (!u.children.includes(body.childId)) u.children.push(body.childId);
      result = u;
    });
    if (!result) return sendJson(res, 404, { error: 'Union or person not found' });
    return sendJson(res, 200, result);
  }
  if (parts[1] === 'unions' && parts[3] === 'children' && parts.length === 5 && method === 'DELETE') {
    const id = parts[2], childId = parts[4];
    let result = null;
    store.mutate(db => {
      const u = db.unions[id];
      if (!u) return;
      u.children = u.children.filter(c => c !== childId);
      result = u;
    });
    if (!result) return sendJson(res, 404, { error: 'Union not found' });
    return sendJson(res, 200, result);
  }

  // full import (restore from a backup / export file)
  if (pathname === '/api/import' && method === 'POST') {
    const body = await readJsonBody(req, 50 * 1024 * 1024);
    try {
      const db = store.replaceAll(body);
      return sendJson(res, 200, { ok: true, persons: Object.keys(db.persons).length });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ---------- static files ----------

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

function safeJoin(base, target) {
  const resolved = path.normalize(path.join(base, target));
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }
    if (pathname.startsWith('/photos/')) {
      const fp = safeJoin(store.PHOTOS_DIR, pathname.slice('/photos/'.length));
      if (!fp) { res.writeHead(400); return res.end('Bad path'); }
      return serveFile(res, fp);
    }
    let rel = pathname === '/' ? '/index.html' : pathname;
    const fp = safeJoin(PUBLIC_DIR, rel);
    if (!fp) { res.writeHead(400); return res.end('Bad path'); }
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return serveFile(res, fp);
    // single page app: everything else gets index.html
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  } catch (e) {
    console.error(req.method, pathname, e.message);
    return sendJson(res, 500, { error: 'Something went wrong: ' + e.message });
  }
});

store.load();
server.listen(PORT, () => {
  console.log('Family tree running at http://localhost:' + PORT);
  console.log('Data directory: ' + store.DATA_DIR);
  console.log(EDIT_PASSWORD ? 'Editing protected by password.' : 'Editing open (set EDIT_PASSWORD to protect).');
});
