const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://bensonperry.com',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function todayUTC() {
  return new Date().toISOString().split('T')[0];
}

function generateId() {
  return crypto.randomUUID().slice(0, 8);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // POST /submit
    if (request.method === 'POST' && path === '/submit') {
      return handleSubmit(request, env);
    }

    // GET /submissions/:date
    if (request.method === 'GET' && path.startsWith('/submissions/')) {
      const date = path.split('/submissions/')[1];
      return handleGetSubmissions(date, url, env);
    }

    // POST /admin/feature
    if (request.method === 'POST' && path === '/admin/feature') {
      return handleFeature(request, env);
    }

    return json({ error: 'not found' }, 404);
  },
};

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const { date, name, fingerprint, cardIds, basics, colors } = body;

  // Validate required fields
  if (!date || !fingerprint || !cardIds || !basics || !colors) {
    return json({ error: 'missing required fields' }, 400);
  }

  // Validate date is today
  if (date !== todayUTC()) {
    return json({ error: 'submissions only accepted for today' }, 400);
  }

  // Load existing submissions
  const subsKey = `subs:${date}`;
  const metaKey = `meta:${date}`;
  let submissions = await env.SUBS.get(subsKey, 'json') || [];
  let meta = await env.SUBS.get(metaKey, 'json') || { count: 0, featured: [] };

  // Check fingerprint dedup (before validation so returning users always get data)
  const existing = submissions.find(s => s.fingerprint === fingerprint);
  if (existing) {
    return json({ id: existing.id, submissions, meta }, 409);
  }

  // Validate deck size
  const basicsTotal = Object.values(basics).reduce((a, b) => a + b, 0);
  if (cardIds.length + basicsTotal < 40) {
    return json({ error: 'deck must have at least 40 cards' }, 400);
  }

  // Validate name
  const cleanName = (name || 'anonymous').slice(0, 20).trim() || 'anonymous';

  // Create submission
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

  // Write back
  await env.SUBS.put(subsKey, JSON.stringify(submissions));
  await env.SUBS.put(metaKey, JSON.stringify(meta));

  return json({ id: submission.id, submissions, meta });
}

async function handleGetSubmissions(date, url, env) {
  const fingerprint = url.searchParams.get('fingerprint');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: 'invalid date' }, 400);
  }

  const subsKey = `subs:${date}`;
  const metaKey = `meta:${date}`;
  const submissions = await env.SUBS.get(subsKey, 'json') || [];
  const meta = await env.SUBS.get(metaKey, 'json') || { count: 0, featured: [] };

  // Check if this fingerprint has submitted
  if (fingerprint && submissions.some(s => s.fingerprint === fingerprint)) {
    return json({ submissions, meta });
  }

  // Not submitted — only return count
  return json({ count: meta.count || submissions.length }, 403);
}

async function handleFeature(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const { date, submissionId, featured } = body;
  if (!date || !submissionId) {
    return json({ error: 'missing date or submissionId' }, 400);
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
  return json({ meta });
}
