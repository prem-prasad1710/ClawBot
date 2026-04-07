/**
 * tools/autonomousqa.js
 * Autonomous QA mode:
 * - turn bug reports into reproducible plans
 * - run available quality checks
 * - keep a lightweight QA lab history
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const STATE_FILE = new URL('../memory/autonomous-qa.json', import.meta.url).pathname;

function iso() {
  return new Date().toISOString();
}

export class AutonomousQA {
  constructor() {
    this._ensureState();
  }

  async execute(params = {}) {
    const op = (params.operation || params.action || 'analyze').toLowerCase();
    if (op === 'analyze' || op === 'report' || op === 'reproduce') return this.analyze(params);
    if (op === 'checks' || op === 'run_checks') return this.runChecks(params);
    if (op === 'status' || op === 'list') return this.status(params);
    return this.analyze(params);
  }

  analyze(params = {}) {
    const report = (params.bug || params.report || params.text || '').trim();
    if (!report) return 'Usage: provide a bug report text for QA analysis.';

    const id = `qa_${Date.now()}`;
    const hypotheses = this._hypotheses(report);
    const repro = this._reproSteps(report);
    const evidence = [
      'Collect console logs and server logs around failure timestamp',
      'Capture screenshot/video for the failing flow',
      'Record exact input payload/session state used during reproduction',
    ];
    const patchPlan = [
      'Add a failing test that reproduces the bug deterministically',
      'Implement the minimal fix in the owning module',
      'Run regression checks and verify no side effects',
      'Create a patch PR with root-cause notes and validation proof',
    ];

    const session = {
      id,
      createdAt: iso(),
      report,
      hypotheses,
      repro,
      evidence,
      patchPlan,
      checks: [],
    };
    const state = this._readState();
    state.sessions = [session, ...(state.sessions || [])].slice(0, 60);
    this._writeState(state);

    return this._formatSession(session);
  }

  async runChecks(params = {}) {
    const repoPath = path.resolve(params.path || params.repoPath || process.cwd());
    if (!fs.existsSync(repoPath)) return `❌ Path not found: ${repoPath}`;

    const checks = [];
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      let pkg = {};
      try { pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')); } catch {}
      const scripts = pkg.scripts || {};
      for (const [name, cmd] of [
        ['test', 'npm run -s test'],
        ['lint', 'npm run -s lint'],
        ['build', 'npm run -s build'],
      ]) {
        if (!scripts[name]) {
          checks.push({ name, status: 'skipped', note: `No "${name}" script` });
          continue;
        }
        try {
          const { stdout, stderr } = await execAsync(cmd, {
            cwd: repoPath,
            timeout: 120000,
            maxBuffer: 1024 * 1024 * 4,
          });
          checks.push({ name, status: 'pass', note: (stdout || stderr || 'ok').trim().slice(0, 600) });
        } catch (err) {
          checks.push({
            name,
            status: 'fail',
            note: ((err.stdout || '') + '\n' + (err.stderr || err.message || '')).trim().slice(0, 800),
          });
        }
      }
    } else {
      checks.push({ name: 'project_checks', status: 'skipped', note: 'No package.json found' });
    }

    const summary = [
      `🧪 *Autonomous QA checks*`,
      `Repo: \`${repoPath}\``,
      ``,
      ...checks.map((c) => `${c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '➖'} ${c.name}: ${c.status}`),
    ].join('\n');

    const state = this._readState();
    const latest = (state.sessions || [])[0];
    if (latest) {
      latest.checks = checks;
      latest.checkedAt = iso();
      this._writeState(state);
    }
    return summary;
  }

  status(params = {}) {
    const id = (params.id || '').trim();
    const state = this._readState();
    const sessions = state.sessions || [];
    if (!sessions.length) return 'ℹ️ No QA sessions yet.';
    if (id) {
      const s = sessions.find((x) => x.id === id);
      if (!s) return `⚠️ QA session not found: ${id}`;
      return this._formatSession(s);
    }
    const lines = sessions.slice(0, 8).map((s, i) => `${i + 1}. \`${s.id}\` • ${s.report.slice(0, 80)} • ${s.createdAt}`);
    return ['🧪 *Autonomous QA sessions*', '', ...lines].join('\n');
  }

  _hypotheses(report) {
    const r = report.toLowerCase();
    const h = [];
    if (/\btimeout|slow|hang|stuck\b/.test(r)) h.push('Race condition, timeout policy, or blocking I/O path');
    if (/\bcrash|exception|500|trace\b/.test(r)) h.push('Unhandled exception path with missing guard condition');
    if (/\blogin|auth|token|session\b/.test(r)) h.push('Authentication/session lifecycle mismatch');
    if (/\bui|button|screen|page|layout\b/.test(r)) h.push('UI state sync issue between async events and render cycle');
    if (/\bdata|save|db|persist|lost\b/.test(r)) h.push('Write-path failure or stale read after update');
    if (!h.length) h.push('Regression introduced by recent code path or config change');
    return h.slice(0, 4);
  }

  _reproSteps(report) {
    const text = report.replace(/\s+/g, ' ').trim();
    return [
      'Set up environment matching production/staging config.',
      `Follow this failing scenario exactly: "${text.slice(0, 180)}${text.length > 180 ? '…' : ''}"`,
      'Capture expected vs actual behavior at the failure point.',
      'Repeat at least 3 times to validate deterministic reproduction.',
    ];
  }

  _formatSession(s) {
    return [
      `🧪 *Autonomous QA bug lab*`,
      `Session: \`${s.id}\``,
      `Created: ${s.createdAt}`,
      ``,
      `*Bug report*`,
      s.report,
      ``,
      `*Reproduction plan*`,
      ...s.repro.map((x, i) => `${i + 1}. ${x}`),
      ``,
      `*Likely root causes*`,
      ...s.hypotheses.map((x, i) => `${i + 1}. ${x}`),
      ``,
      `*Evidence capture*`,
      ...s.evidence.map((x, i) => `${i + 1}. ${x}`),
      ``,
      `*Patch PR strategy*`,
      ...s.patchPlan.map((x, i) => `${i + 1}. ${x}`),
    ].join('\n');
  }

  _ensureState() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ sessions: [] }, null, 2), 'utf8');
    }
  }

  _readState() {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return { sessions: [] };
    }
  }

  _writeState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  }
}
