import http from 'node:http';
import { buildWorkerSeedPayload } from './generate-daily.js';
import { readJson } from './lib/17lands.js';

const port = Number(process.env.PORT || 4190);
const host = process.env.HOST || '127.0.0.1';
const daily = await readJson('daily.json');
const queue = await readJson('data/17lands-sealed-candidates.json');
const candidate = queue.candidates.find(item => item.sourceId === daily.source?.sourceId);

if (!candidate) {
  throw new Error(`could not find candidate ${daily.source?.sourceId}`);
}

const { reference } = buildWorkerSeedPayload(queue, candidate, daily.date);
const submissions = [];
const meta = { count: 0, featured: [] };

function corsHeaders(request) {
  const origin = request.headers.origin || 'http://127.0.0.1:4189';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function sendJson(response, request, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders(request),
  });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname.startsWith('/submissions/')) {
      const date = url.pathname.split('/submissions/')[1];
      const fingerprint = url.searchParams.get('fingerprint');
      if (date !== daily.date) {
        sendJson(response, request, 400, { error: 'invalid local daily date' });
        return;
      }

      if (fingerprint && submissions.some(sub => sub.fingerprint === fingerprint)) {
        sendJson(response, request, 200, { submissions, meta, reference });
        return;
      }

      sendJson(response, request, 403, { count: submissions.length });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/submit') {
      const body = await readJsonBody(request);
      if (body.date !== daily.date) {
        sendJson(response, request, 400, { error: 'submissions only accepted for the local daily' });
        return;
      }

      const existing = submissions.find(sub => sub.fingerprint === body.fingerprint);
      if (existing) {
        sendJson(response, request, 409, { id: existing.id, submissions, meta, reference });
        return;
      }

      const basicsTotal = Object.values(body.basics || {}).reduce((total, count) => total + Number(count || 0), 0);
      if (!body.fingerprint || !Array.isArray(body.cardIds) || body.cardIds.length + basicsTotal < 40) {
        sendJson(response, request, 400, { error: 'deck must have at least 40 cards' });
        return;
      }

      const submission = {
        id: `local-${String(submissions.length + 1).padStart(3, '0')}`,
        name: (body.name || 'local tester').slice(0, 20).trim() || 'local tester',
        fingerprint: body.fingerprint,
        submittedAt: new Date().toISOString(),
        cardIds: body.cardIds,
        basics: body.basics,
        colors: body.colors,
      };

      submissions.push(submission);
      meta.count = submissions.length;
      sendJson(response, request, 200, { id: submission.id, submissions, meta, reference });
      return;
    }

    sendJson(response, request, 404, { error: 'not found' });
  } catch (error) {
    sendJson(response, request, 500, { error: error.message || 'local dev api failed' });
  }
});

server.listen(port, host, () => {
  console.log(`Pool Builder dev API listening on http://${host}:${port}`);
  console.log(`Reference: ${reference.sourceId}, ${reference.cardIds.length} nonbasics`);
});
