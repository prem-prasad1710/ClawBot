/**
 * tools/repoguardian.js
 * Repo Guardian mode:
 * - codebase health scan (tests/build/lint)
 * - dependency risk snapshot
 * - flaky-file detection
 * - watch profile management
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);
const STATE_FILE = new URL('../memory/repo-guardian.json', import.meta.url).pathname;
const MIN_WATCH_INTERVAL_MINUTES = 5;
const CHECK_TIMEOUT_MS = 120000;
const CHECK_MAX_BUFFER_BYTES = 1024 * 1024 * 4;
const GIT_LOG_COMMIT_LIMIT = 120;

function getIsoTimestamp() {
  return new Date().toISOString();
}

export class RepoGuardian {
  constructor() {
    this._ensureState();
  }

  async execute(params = {}) {
    const op = (params.operation || params.action || 'scan').toLowerCase();
    if (op === 'scan') return this.scan(params);
    if (op === 'watch' || op === 'start_watch' || op === 'start') return this.startWatch(params);
    if (op === 'stop' || op === 'stop_watch') return this.stopWatch(params);
    if (op === 'status' || op === 'watch_status') return this.watchStatus(params);
    if (op === 'plan' || op === 'fix_plan') return this.latestPlan(params);
    return this.scan(params);
  }

  async scan(params = {}) {
    const repoPath = path.resolve(params.path || params.repoPath || process.cwd());
    if (!fs.existsSync(repoPath)) return `❌ Repo path not found: ${repoPath}`;

    const checks = await this._runProjectChecks(repoPath);
    const deps = await this._dependencyRisk(repoPath);
    const flaky = await this._flakyFiles(repoPath);

    const riskScore = this._riskScore(checks, deps, flaky);
    const plan = this._buildFixPlan(checks, deps, flaky);

    const scan = {
      id: `scan_${Date.now()}`,
      timestamp: getIsoTimestamp(),
      repoPath,
      riskScore,
      checks,
      deps,
      flaky,
      plan,
    };

    const state = this._readState();
    state.scans = [scan, ...(state.scans || [])].slice(0, 50);
    this._writeState(state);

    return this._formatScan(scan);
  }

  startWatch(params = {}) {
    const repoPath = path.resolve(params.path || params.repoPath || process.cwd());
    const intervalMinutes = Math.max(MIN_WATCH_INTERVAL_MINUTES, parseInt(params.intervalMinutes || params.interval || 30, 10));
    const state = this._readState();
    const id = `watch_${Date.now()}`;
    state.watches = state.watches || [];
    state.watches.unshift({
      id,
      repoPath,
      intervalMinutes,
      status: 'active',
      createdAt: getIsoTimestamp(),
      lastScanAt: null,
    });
    state.watches = state.watches.slice(0, 30);
    this._writeState(state);
    return [
      `🛡️ *Repo Guardian watch started*`,
      `ID: \`${id}\``,
      `Repo: \`${repoPath}\``,
      `Interval: every *${intervalMinutes} min*`,
      ``,
      `Use \`/guardian status\` to view watchers and \`/guardian stop ${id}\` to stop one.`,
    ].join('\n');
  }

  stopWatch(params = {}) {
    const id = (params.id || params.watchId || '').trim();
    if (!id) return 'Usage: provide watch id (e.g. watch_123...)';
    const state = this._readState();
    const w = (state.watches || []).find((x) => x.id === id);
    if (!w) return `⚠️ Watch not found: ${id}`;
    w.status = 'stopped';
    w.stoppedAt = getIsoTimestamp();
    this._writeState(state);
    return `🛑 Stopped Repo Guardian watch: \`${id}\``;
  }

  watchStatus() {
    const state = this._readState();
    const active = (state.watches || []).filter((w) => w.status === 'active').slice(0, 10);
    if (!active.length) return 'ℹ️ No active Repo Guardian watches.';
    const lines = active.map((w, i) =>
      `${i + 1}. \`${w.id}\` • ${w.repoPath}\n   every ${w.intervalMinutes} min • created ${w.createdAt}`
    );
    return ['🛡️ *Repo Guardian watches*', '', ...lines].join('\n');
  }

  latestPlan() {
    const state = this._readState();
    const latest = (state.scans || [])[0];
    if (!latest) return 'ℹ️ No scans yet. Run a scan first.';
    return [
      `🧩 *Latest Repo Guardian fix plan*`,
      `Repo: \`${latest.repoPath}\``,
      `Risk score: *${latest.riskScore}/100*`,
      ``,
      ...latest.plan.map((s, i) => `${i + 1}. ${s}`),
    ].join('\n');
  }

  async _runProjectChecks(repoPath) {
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      return [{ name: 'project_checks', status: 'skipped', note: 'No package.json found' }];
    }

    let pkg = {};
    try {
      pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
      return [{ name: 'project_checks', status: 'error', note: 'Invalid package.json' }];
    }

    const scripts = pkg.scripts || {};
    const candidates = [
      { key: 'test', command: 'npm run -s test' },
      { key: 'lint', command: 'npm run -s lint' },
      { key: 'build', command: 'npm run -s build' },
    ];

    const results = [];
    for (const c of candidates) {
      if (!scripts[c.key]) {
        results.push({ name: c.key, status: 'skipped', note: `No "${c.key}" script` });
        continue;
      }
      try {
        const { stdout, stderr } = await execAsync(c.command, {
          cwd: repoPath,
          timeout: CHECK_TIMEOUT_MS,
          maxBuffer: CHECK_MAX_BUFFER_BYTES,
        });
        results.push({
          name: c.key,
          status: 'pass',
          note: (stdout || stderr || 'ok').trim().slice(0, 500),
        });
      } catch (err) {
        results.push({
          name: c.key,
          status: 'fail',
          note: ((err.stdout || '') + '\n' + (err.stderr || err.message || '')).trim().slice(0, 700),
        });
      }
    }
    return results;
  }

  async _dependencyRisk(repoPath) {
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return { supported: false, note: 'No package.json' };

    try {
      const { stdout } = await execAsync('npm audit --json', {
        cwd: repoPath,
        timeout: CHECK_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 8,
      });
      const j = JSON.parse(stdout || '{}');
      const vulns = j.metadata?.vulnerabilities || {};
      return {
        supported: true,
        low: vulns.low || 0,
        moderate: vulns.moderate || 0,
        high: vulns.high || 0,
        critical: vulns.critical || 0,
      };
    } catch (err) {
      const raw = (err.stdout || '').trim();
      if (raw.startsWith('{')) {
        try {
          const j = JSON.parse(raw);
          const vulns = j.metadata?.vulnerabilities || {};
          return {
            supported: true,
            low: vulns.low || 0,
            moderate: vulns.moderate || 0,
            high: vulns.high || 0,
            critical: vulns.critical || 0,
          };
        } catch {}
      }
      logger.warn(`[RepoGuardian] npm audit failed: ${err.message}`);
      return { supported: false, note: 'npm audit unavailable or failed' };
    }
  }

  async _flakyFiles(repoPath) {
    const gitPath = path.join(repoPath, '.git');
    if (!fs.existsSync(gitPath)) return { supported: false, top: [], note: 'Not a git repo' };
    try {
      const { stdout } = await execAsync(`git --no-pager log --name-only --pretty=format: -n ${GIT_LOG_COMMIT_LIMIT}`, {
        cwd: repoPath,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 4,
      });
      const counts = {};
      stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((f) => {
          counts[f] = (counts[f] || 0) + 1;
        });
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([file, changes]) => ({ file, changes }));
      return { supported: true, top };
    } catch (err) {
      return { supported: false, top: [], note: `git log failed: ${err.message}` };
    }
  }

  _riskScore(checks, deps, flaky) {
    let score = 10;
    for (const c of checks) {
      if (c.status === 'fail') score += 20;
    }
    if (deps?.supported) {
      score += (deps.low || 0) * 1;
      score += (deps.moderate || 0) * 3;
      score += (deps.high || 0) * 7;
      score += (deps.critical || 0) * 15;
    }
    if (flaky?.supported && Array.isArray(flaky.top)) {
      const noisy = flaky.top.filter((f) => f.changes >= 5).length;
      score += noisy * 5;
    }
    return Math.min(100, score);
  }

  _buildFixPlan(checks, deps, flaky) {
    const steps = [];
    const failed = checks.filter((c) => c.status === 'fail').map((c) => c.name);
    if (failed.length) {
      steps.push(`Stabilize failing scripts first: ${failed.join(', ')}.`);
      steps.push('Create a reproducible failure note with command, error snippet, and suspected root cause.');
    }
    if (deps?.supported && ((deps.high || 0) > 0 || (deps.critical || 0) > 0)) {
      steps.push('Patch high/critical dependency vulnerabilities and regenerate lockfile.');
      steps.push('Run regression checks after dependency updates before shipping.');
    } else if (deps?.supported && ((deps.low || 0) + (deps.moderate || 0) > 0)) {
      steps.push('Schedule low/moderate dependency updates in a maintenance PR.');
    }
    if (flaky?.supported && flaky.top?.length) {
      const hot = flaky.top.slice(0, 3).map((f) => f.file).join(', ');
      steps.push(`Review churn-heavy files for flaky behavior: ${hot}.`);
    }
    if (!steps.length) {
      steps.push('Health looks stable. Keep watch mode active and run periodic scans.');
      steps.push('Set guardrails in CI for test/build/lint and dependency alerts.');
    }
    return steps;
  }

  _formatScan(scan) {
    const checkLines = (scan.checks || []).map((c) => {
      const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '➖';
      return `${icon} ${c.name}: ${c.status}`;
    });

    const depText = scan.deps?.supported
      ? `critical ${scan.deps.critical || 0}, high ${scan.deps.high || 0}, moderate ${scan.deps.moderate || 0}, low ${scan.deps.low || 0}`
      : (scan.deps?.note || 'not available');

    const flakyLines = scan.flaky?.supported
      ? (scan.flaky.top || []).slice(0, 5).map((f, i) => `${i + 1}. \`${f.file}\` (${f.changes} changes)`)
      : [scan.flaky?.note || 'not available'];

    return [
      `🛡️ *Repo Guardian scan complete*`,
      `Repo: \`${scan.repoPath}\``,
      `Risk score: *${scan.riskScore}/100*`,
      ``,
      `*Checks:*`,
      ...(checkLines.length ? checkLines : ['➖ No checks detected']),
      ``,
      `*Dependency risk:* ${depText}`,
      ``,
      `*Flaky-file signals:*`,
      ...flakyLines,
      ``,
      `*Fix plan:*`,
      ...scan.plan.map((s, i) => `${i + 1}. ${s}`),
    ].join('\n');
  }

  _ensureState() {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ watches: [], scans: [] }, null, 2), 'utf8');
    }
  }

  _readState() {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return { watches: [], scans: [] };
    }
  }

  _writeState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  }
}
