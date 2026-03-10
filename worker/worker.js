const ALLOWED_ORIGINS = ['https://bensonperry.com', 'http://localhost:3000', 'http://127.0.0.1:3000'];

function corsHeaders(request) {
  const origin = request?.headers?.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, request = null, cacheSeconds = 0) {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(request) };
  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}`;
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function todayUTC() {
  return new Date().toISOString().split('T')[0];
}

function generateId() {
  return crypto.randomUUID().slice(0, 8);
}

function isBot(request) {
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  if (!ua) return true;
  const bots = ['bot', 'crawler', 'spider', 'scraper', 'curl', 'wget', 'python', 'httpx', 'go-http', 'java/', 'ruby', 'perl', 'php/', 'aiohttp', 'node-fetch', 'undici'];
  return bots.some(b => ua.includes(b));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // block bots (except admin routes which use auth)
    if (isBot(request) && !request.headers.get('Authorization')) {
      return new Response('not found', { status: 404 });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // POST /submit
    if (request.method === 'POST' && path === '/submit') {
      return handleSubmit(request, env);
    }

    // GET /submissions/:date (cache 30s)
    if (request.method === 'GET' && path.startsWith('/submissions/')) {
      const date = path.split('/submissions/')[1];
      return handleGetSubmissions(date, url, env, request);
    }

    // POST /admin/feature
    if (request.method === 'POST' && path === '/admin/feature') {
      return handleFeature(request, env);
    }

    return new Response('not found', { status: 404 });
  },
};

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400, request);
  }

  const { date, name, fingerprint, cardIds, basics, colors } = body;

  if (!date || !fingerprint || !cardIds || !basics || !colors) {
    return json({ error: 'missing required fields' }, 400, request);
  }

  if (date !== todayUTC()) {
    return json({ error: 'submissions only accepted for today' }, 400, request);
  }

  const subsKey = `subs:${date}`;
  const metaKey = `meta:${date}`;
  let submissions = await env.SUBS.get(subsKey, 'json') || [];
  let meta = await env.SUBS.get(metaKey, 'json') || { count: 0, featured: [] };

  const existing = submissions.find(s => s.fingerprint === fingerprint);
  if (existing) {
    return json({ id: existing.id, submissions, meta }, 409, request);
  }

  const basicsTotal = Object.values(basics).reduce((a, b) => a + b, 0);
  if (cardIds.length + basicsTotal < 40) {
    return json({ error: 'deck must have at least 40 cards' }, 400, request);
  }

  const cleanName = (name || 'anonymous').slice(0, 20).trim() || 'anonymous';

  const submission = {
    id: generateId(),
    name: cleanName,
    fingerprint,
    submittedAt: new Date().toISOString(),
    cardIds,
    basics,
    colors,
  };

  submissions.push(submission);
  meta.count = submissions.length;

  await env.SUBS.put(subsKey, JSON.stringify(submissions));
  await env.SUBS.put(metaKey, JSON.stringify(meta));

  return json({ id: submission.id, submissions, meta }, 200, request);
}

async function handleGetSubmissions(date, url, env, request) {
  const fingerprint = url.searchParams.get('fingerprint');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'invalid date' }, 400, request);
  }

  const subsKey = `subs:${date}`;
  const metaKey = `meta:${date}`;
  const submissions = await env.SUBS.get(subsKey, 'json') || [];
  const meta = await env.SUBS.get(metaKey, 'json') || { count: 0, featured: [] };

  if (fingerprint && submissions.some(s => s.fingerprint === fingerprint)) {
    return json({ submissions, meta }, 200, request, 30);
  }

  return json({ count: meta.count || submissions.length }, 403, request, 30);
}

async function handleFeature(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: 'unauthorized' }, 401, request);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400, request);
  }

  const { date, submissionId, featured } = body;
  if (!date || !submissionId) {
    return json({ error: 'missing date or submissionId' }, 400, request);
  }

  const metaKey = `meta:${date}`;
  let meta = await env.SUBS.get(metaKey, 'json') || { count: 0, featured: [] };

  if (featured) {
    if (!meta.featured.includes(submissionId)) {
      meta.featured.push(submissionId);
    }
  } else {
    meta.featured = meta.featured.filter(id => id !== submissionId);
  }

  await env.SUBS.put(metaKey, JSON.stringify(meta));
  return json({ meta }, 200, request);
}
