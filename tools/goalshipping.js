/**
 * tools/goalshipping.js
 * Goal → Shipping mode:
 * - Convert high-level goal into milestones, backlog, PR plan, release checklist
 * - Track progress over time
 */

import fs from 'fs';
import path from 'path';

const STATE_FILE = new URL('../memory/goal-shipping.json', import.meta.url).pathname;

function iso() {
  return new Date().toISOString();
}

function titleCase(s = '') {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export class GoalShipping {
  constructor() {
    this._ensureState();
  }

  async execute(params = {}) {
    const op = (params.operation || params.action || 'plan').toLowerCase();
    if (op === 'plan' || op === 'create') return this.createPlan(params);
    if (op === 'status' || op === 'view') return this.status(params);
    if (op === 'update' || op === 'progress' || op === 'done') return this.update(params);
    if (op === 'daily' || op === 'report') return this.dailyReport(params);
    return this.createPlan(params);
  }

  createPlan(params = {}) {
    const goal = (params.goal || params.text || params.prompt || '').trim();
    if (!goal) return 'Usage: provide a goal. Example: "Launch landing page + auth + analytics".';

    const id = `ship_${Date.now()}`;
    const features = this._extractFeatureHints(goal);
    const milestones = this._buildMilestones(goal, features);
    const backlog = this._buildBacklog(features);
    const prs = this._buildPrSequence(features);
    const release = this._buildReleaseChecklist(features);

    const plan = {
      id,
      goal,
      createdAt: iso(),
      updatedAt: iso(),
      milestones,
      backlog,
      prs,
      release,
    };

    const state = this._readState();
    state.plans = state.plans || {};
    state.plans[id] = plan;
    this._writeState(state);

    return this._formatPlan(plan);
  }

  status(params = {}) {
    const state = this._readState();
    const id = (params.id || '').trim();
    if (id) {
      const p = state.plans?.[id];
      if (!p) return `⚠️ Plan not found: ${id}`;
      return this._formatPlan(p);
    }

    const plans = Object.values(state.plans || {}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (!plans.length) return 'ℹ️ No Goal→Shipping plans yet.';

    const lines = plans.slice(0, 8).map((p, i) => {
      const done = p.backlog.filter((x) => x.done).length;
      const total = p.backlog.length || 1;
      return `${i + 1}. \`${p.id}\` • ${p.goal}\n   Progress: ${done}/${total} tasks • updated ${p.updatedAt}`;
    });
    return ['🚢 *Goal→Shipping plans*', '', ...lines].join('\n');
  }

  update(params = {}) {
    const id = (params.id || '').trim();
    if (!id) return 'Usage: provide plan id and task keyword to update.';

    const state = this._readState();
    const p = state.plans?.[id];
    if (!p) return `⚠️ Plan not found: ${id}`;

    const taskText = (params.task || params.item || params.text || '').trim().toLowerCase();
    if (!taskText) return 'Usage: include task text to mark done/undone.';
    const done = String(params.done ?? true).toLowerCase() !== 'false';

    let updated = false;
    p.backlog = p.backlog.map((b) => {
      if (b.title.toLowerCase().includes(taskText)) {
        updated = true;
        return { ...b, done };
      }
      return b;
    });

    if (!updated) return `⚠️ No backlog item matched "${taskText}".`;
    p.updatedAt = iso();
    state.plans[id] = p;
    this._writeState(state);
    return this._formatPlan(p);
  }

  dailyReport() {
    const state = this._readState();
    const plans = Object.values(state.plans || {});
    if (!plans.length) return '📭 No active Goal→Shipping plans.';

    const lines = plans.map((p, i) => {
      const done = p.backlog.filter((x) => x.done).length;
      const total = p.backlog.length || 1;
      const percent = Math.round((done / total) * 100);
      const next = p.backlog.find((x) => !x.done)?.title || 'Finalize release checklist';
      return `${i + 1}. *${p.goal}*\n   Progress: *${percent}%* (${done}/${total})\n   Next: ${next}`;
    });
    return [
      `📈 *Daily Goal→Shipping report*`,
      `Generated: ${new Date().toLocaleString()}`,
      ``,
      ...lines,
    ].join('\n');
  }

  _extractFeatureHints(goal) {
    const lower = goal.toLowerCase();
    const hints = [];
    if (/\bauth|login|oauth|signup|signin\b/.test(lower)) hints.push('Authentication');
    if (/\banalytics|tracking|events?\b/.test(lower)) hints.push('Analytics');
    if (/\blanding|homepage|marketing\b/.test(lower)) hints.push('Landing Page');
    if (/\bapi|backend|service\b/.test(lower)) hints.push('Backend API');
    if (/\bdashboard|admin\b/.test(lower)) hints.push('Dashboard');
    if (/\bbilling|payments?|stripe\b/.test(lower)) hints.push('Billing');

    const plusSplit = goal.split('+').map((x) => titleCase(x)).filter(Boolean);
    for (const p of plusSplit) {
      if (!hints.includes(p) && p.length <= 40) hints.push(p);
    }
    if (!hints.length) hints.push(titleCase(goal).slice(0, 60));
    return hints.slice(0, 8);
  }

  _buildMilestones(goal, features) {
    return [
      { title: `Scope and architecture for "${goal}"`, done: false },
      { title: `Implement core features: ${features.slice(0, 3).join(', ')}`, done: false },
      { title: 'Integrate observability, QA, and release readiness', done: false },
      { title: 'Ship to production and monitor post-release metrics', done: false },
    ];
  }

  _buildBacklog(features) {
    const base = [
      { title: 'Define success metrics and acceptance criteria', done: false },
      { title: 'Create technical design and dependencies map', done: false },
    ];
    const featureTasks = features.map((f) => ({ title: `Build and validate: ${f}`, done: false }));
    const tail = [
      { title: 'Write end-to-end tests and rollout checks', done: false },
      { title: 'Prepare docs and release notes', done: false },
    ];
    return [...base, ...featureTasks, ...tail];
  }

  _buildPrSequence(features) {
    const seq = [
      'PR-1: Project skeleton + config + telemetry baseline',
      'PR-2: Core domain logic and data model',
    ];
    features.slice(0, 4).forEach((f, i) => {
      seq.push(`PR-${i + 3}: Feature vertical — ${f}`);
    });
    seq.push(`PR-${features.length + 3}: QA hardening + docs + release checklist`);
    return seq;
  }

  _buildReleaseChecklist(features) {
    return [
      'All planned PRs merged and CI green',
      `Critical paths tested (${features.slice(0, 3).join(', ')})`,
      'Monitoring and alerting configured',
      'Rollback plan documented',
      'Launch communication and post-release owner assigned',
    ];
  }

  _formatPlan(plan) {
    const backlogLines = plan.backlog.map((b, i) => `${i + 1}. [${b.done ? 'x' : ' '}] ${b.title}`);
    const milestoneLines = plan.milestones.map((m, i) => `${i + 1}. [${m.done ? 'x' : ' '}] ${m.title}`);
    const prLines = plan.prs.map((p, i) => `${i + 1}. ${p}`);
    const releaseLines = plan.release.map((r, i) => `${i + 1}. ${r}`);
    const done = plan.backlog.filter((x) => x.done).length;
    const total = plan.backlog.length || 1;

    return [
      `🚢 *Goal→Shipping plan*`,
      `ID: \`${plan.id}\``,
      `Goal: *${plan.goal}*`,
      `Progress: *${done}/${total}* tasks`,
      ``,
      `*Milestones*`,
      ...milestoneLines,
      ``,
      `*Backlog*`,
      ...backlogLines,
      ``,
      `*PR sequence*`,
      ...prLines,
      ``,
      `*Release checklist*`,
      ...releaseLines,
    ].join('\n');
  }

  _ensureState() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ plans: {} }, null, 2), 'utf8');
    }
  }

  _readState() {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return { plans: {} };
    }
  }

  _writeState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  }
}
