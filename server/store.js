'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'familytree.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const SEED_FILE = path.join(__dirname, '..', 'seed', 'seed.json');

let db = null;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(5).toString('hex');
}

function emptyDb() {
  return {
    meta: { title: 'Family Tree', subtitle: '', rootId: null },
    history: '',
    persons: {},
    unions: {}
  };
}

function normalize(data) {
  const out = emptyDb();
  if (data && typeof data === 'object') {
    if (data.meta && typeof data.meta === 'object') out.meta = Object.assign(out.meta, data.meta);
    if (typeof data.history === 'string') out.history = data.history;
    if (data.persons && typeof data.persons === 'object') out.persons = data.persons;
    if (data.unions && typeof data.unions === 'object') out.unions = data.unions;
  }
  for (const u of Object.values(out.unions)) {
    if (!Array.isArray(u.children)) u.children = [];
  }
  return out;
}

function load() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    let seed = emptyDb();
    if (fs.existsSync(SEED_FILE)) {
      try {
        seed = normalize(JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')));
      } catch (e) {
        console.error('Could not read seed file, starting empty:', e.message);
      }
    }
    db = seed;
    persist();
    console.log('Initialised new database at ' + DB_FILE);
  } else {
    db = normalize(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  }
  return db;
}

function dailyBackup() {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUPS_DIR, 'familytree-' + stamp + '.json');
    if (!fs.existsSync(file) && fs.existsSync(DB_FILE)) {
      fs.copyFileSync(DB_FILE, file);
      // keep the 30 most recent backups
      const all = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json')).sort();
      while (all.length > 30) fs.unlinkSync(path.join(BACKUPS_DIR, all.shift()));
    }
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}

function persist() {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function get() {
  if (!db) load();
  return db;
}

// Run a mutation against the database and persist it atomically.
function mutate(fn) {
  if (!db) load();
  dailyBackup();
  const result = fn(db);
  persist();
  return result;
}

function replaceAll(data) {
  if (!data || typeof data !== 'object' || !data.persons || typeof data.persons !== 'object' || Array.isArray(data.persons)) {
    throw new Error('This file does not look like a family tree backup.');
  }
  const next = normalize(data);
  dailyBackup();
  db = next;
  persist();
  return db;
}

module.exports = { load, get, mutate, replaceAll, newId, DATA_DIR, PHOTOS_DIR };
