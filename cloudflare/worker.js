/**
 * Cloudflare Worker edge API for ClawBot.
 * Provides lightweight operator endpoints for health, capabilities, and mode guidance.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const MODES = [
  {
    id: 'repo_guardian',
    label: 'Repo Guardian',
    purpose: 'Continuously detect failing checks, dependency risk, and flaky hotspots.',
  },
  {
    id: 'goal_shipping',
    label: 'Goal → Shipping',
    purpose: 'Turn business goals into milestones, tasks, PR sequence, and release checklist.',
  },
  {
    id: 'autonomous_qa',
    label: 'Autonomous QA',
    purpose: 'Reproduce bugs from plain language and propose root-cause + patch strategy.',
  },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function resolveMode(goal = '') {
  const g = String(goal).toLowerCase();
  if (/bug|error|fail|crash|issue|qa|repro/.test(g)) return 'autonomous_qa';
  if (/launch|ship|milestone|backlog|roadmap|release|mvp/.test(g)) return 'goal_shipping';
  if (/dependency|test|outage|flaky|repo|health|risk|guardian/.test(g)) return 'repo_guardian';
  return 'goal_shipping';
}

async function handleOperatorTriage(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const failingChecks = Number(body.failingChecks || 0);
  const criticalDeps = Number(body.criticalDeps || 0);
  const highDeps = Number(body.highDeps || 0);
  const flakyFiles = Number(body.flakyFiles || 0);

  let score = 0;
  score += failingChecks * 25;
  score += criticalDeps * 20;
  score += highDeps * 10;
  score += flakyFiles * 5;
  score = Math.min(100, score);

  const riskLevel = score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low';
  const recommendation = riskLevel === 'high'
    ? 'Enable Repo Guardian immediately, open a hotfix plan, and gate deploys on fixes.'
    : riskLevel === 'medium'
      ? 'Run Repo Guardian scan and Autonomous QA checks before next release.'
      : 'Continue normal shipping cadence with daily Goal→Shipping status tracking.';

  return json({
    riskScore: score,
    riskLevel,
    recommendation,
    input: { failingChecks, criticalDeps, highDeps, flakyFiles },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '') {
      return json({
        name: 'ClawBot Edge API',
        status: 'ok',
        endpoints: ['GET /health', 'GET /features', 'GET /operator/mode?goal=...', 'POST /operator/triage'],
      });
    }

    if (path === '/health') {
      return json({
        status: 'ok',
        service: 'clawbot-worker',
        timestamp: new Date().toISOString(),
      });
    }

    if (path === '/features') {
      return json({
        coreIdentity: 'Autonomous engineering operator',
        immediateCombo: ['repo_guardian', 'goal_shipping', 'autonomous_qa'],
        modes: MODES,
      });
    }

    if (path === '/operator/mode' && request.method === 'GET') {
      const goal = url.searchParams.get('goal') || '';
      const mode = resolveMode(goal);
      const selected = MODES.find((m) => m.id === mode);
      return json({
        goal,
        suggestedMode: mode,
        details: selected,
      });
    }

    if (path === '/operator/triage' && request.method === 'POST') {
      return handleOperatorTriage(request);
    }

    return json({ error: 'Not found' }, 404);
  },
};
