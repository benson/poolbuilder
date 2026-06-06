import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

class MemoryKV {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    const value = this.values.get(key);
    if (value == null) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

const env = {
  ADMIN_SECRET: 'secret',
  SUBS: new MemoryKV(),
};

function todayUTC() {
  return new Date().toISOString().split('T')[0];
}

function request(path, { method = 'GET', body, auth = false } = {}) {
  return new Request(`https://poolbuilder-api.test${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 poolbuilder-test',
      ...(auth ? { Authorization: `Bearer ${env.ADMIN_SECRET}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function jsonResponse(response) {
  return JSON.parse(await response.text());
}

const date = todayUTC();
const reference = {
  id: 'expert-ghost',
  name: 'Expert Ghost',
  sourceId: '17l-tst-001',
  cardIds: ['a', 'b', 'b'],
  basics: { W: 8, U: 9, B: 0, R: 0, G: 0 },
  colors: ['W', 'U'],
  mainColors: ['W', 'U'],
  splashColors: [],
};

let response = await worker.fetch(request('/submit', {
  method: 'POST',
  body: {
    date,
    name: 'tester',
    fingerprint: 'fp-before-seed',
    cardIds: Array(23).fill('x'),
    basics: { W: 9, U: 8, B: 0, R: 0, G: 0 },
    colors: ['W', 'U'],
  },
}), env);
assert.equal(response.status, 503, 'submit rejects when daily reference is missing');

response = await worker.fetch(request('/admin/daily', {
  method: 'POST',
  auth: true,
  body: { date, sourceId: '17l-tst-001', reference },
}), env);
assert.equal(response.status, 200, 'admin can seed daily reference');
let data = await jsonResponse(response);
assert.deepEqual(data.daily.reference.cardIds, ['a', 'b', 'b']);

response = await worker.fetch(request(`/submissions/${date}?fingerprint=not-submitted`), env);
assert.equal(response.status, 403, 'unsubmitted users cannot see submissions');
data = await jsonResponse(response);
assert.equal(Object.hasOwn(data, 'reference'), false, 'unsubmitted response does not include reference');

const submitBody = {
  date,
  name: 'tester',
  fingerprint: 'fp',
  cardIds: Array(23).fill('x'),
  basics: { W: 9, U: 8, B: 0, R: 0, G: 0 },
  colors: ['W', 'U'],
};

response = await worker.fetch(request('/submit', { method: 'POST', body: submitBody }), env);
assert.equal(response.status, 200, 'submit succeeds after daily reference is seeded');
data = await jsonResponse(response);
assert.equal(data.reference.name, 'Expert Ghost');
assert.equal(data.submissions.length, 1);

response = await worker.fetch(request('/submit', { method: 'POST', body: submitBody }), env);
assert.equal(response.status, 409, 'duplicate submit preserves existing submission');
data = await jsonResponse(response);
assert.equal(data.reference.sourceId, '17l-tst-001', 'duplicate submit still reveals reference');

response = await worker.fetch(request(`/submissions/${date}?fingerprint=fp`), env);
assert.equal(response.status, 200, 'submitted user can fetch submissions');
data = await jsonResponse(response);
assert.equal(data.reference.id, 'expert-ghost');

response = await worker.fetch(request('/submit', {
  method: 'POST',
  body: { ...submitBody, date: '2000-01-01', fingerprint: 'old-fp' },
}), env);
assert.equal(response.status, 400, 'non-today submissions still reject');

console.log('worker tests passed');
