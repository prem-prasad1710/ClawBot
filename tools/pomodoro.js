/**
 * tools/pomodoro.js – Pomodoro / Focus Timer Tool
 * Manages focus sessions: start, pause, stop, status, history.
 * Sends macOS notifications at interval boundaries.
 * Sessions are persisted to memory/pomodoro.json.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);
const DATA_FILE = new URL('../memory/pomodoro.json', import.meta.url).pathname;

const DEFAULT_WORK_MIN    = 25;
const DEFAULT_SHORT_BREAK = 5;
const DEFAULT_LONG_BREAK  = 15;

function loadData() {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return { active: null, sessions: [] };
}
function saveData(d) {
  try { writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); } catch {}
}

function notify(title, message) {
  const esc = s => s.replace(/'/g, "'\\''");
  execAsync(`osascript -e 'display notification "${esc(message)}" with title "${esc(title)}" sound name "Glass"'`)
    .catch(() => {});
}

export class Pomodoro {
  /**
   * Start a new focus session.
   * @param {object} params
   * @param {string} params.task      – What you're working on
   * @param {number} params.work      – Work minutes (default 25)
   * @param {number} params.short_break – Short break (default 5)
   * @param {number} params.long_break  – Long break after 4 rounds (default 15)
   */
  async start(params = {}) {
    const d = loadData();
    if (d.active && d.active.status === 'running') {
      const elapsed = Math.floor((Date.now() - d.active.startedAt) / 60000);
      return `⏱️ A session is already running: *"${d.active.task}"* (${elapsed} min elapsed)\nUse \`/pomo stop\` to end it first.`;
    }

    const workMin   = parseInt(params.work  || params.work_min || DEFAULT_WORK_MIN);
    const shortMin  = parseInt(params.short_break || DEFAULT_SHORT_BREAK);
    const longMin   = parseInt(params.long_break  || DEFAULT_LONG_BREAK);
    const taskName  = params.task || params.label || 'Focus session';
    const rounds    = parseInt(params.rounds || 4);

    const session = {
      id: `pomo_${Date.now()}`,
      task: taskName,
      workMin,
      shortMin,
      longMin,
      rounds,
      currentRound: 1,
      phase: 'work',   // 'work' | 'short_break' | 'long_break'
      startedAt: Date.now(),
      pausedAt: null,
      pausedMs: 0,
      status: 'running',
    };

    d.active = session;
    saveData(d);

    // Schedule end-of-work notification
    const workMs = workMin * 60 * 1000;
    setTimeout(() => {
      const current = loadData();
      if (!current.active || current.active.id !== session.id) return;
      notify('🍅 Pomodoro Complete!', `"${taskName}" — Round ${session.currentRound} done! Take a break.`);
      current.active.phase = session.currentRound >= rounds ? 'long_break' : 'short_break';
      current.active.status = 'break';
      current.active.breakStartedAt = Date.now();
      saveData(current);
    }, workMs);

    const endTime = new Date(Date.now() + workMs);
    const endStr  = endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    notify('🍅 Pomodoro Started', `Focus on: "${taskName}" for ${workMin} min`);

    return [
      `🍅 *Pomodoro started!*`,
      ``,
      `📌 Task: *${taskName}*`,
      `⏱️ Work: ${workMin} min  |  Short break: ${shortMin} min  |  Long break: ${longMin} min`,
      `🔁 Round: 1 / ${rounds}`,
      `⏰ Focus until: *${endStr}*`,
      ``,
      `Stay in the zone! I'll notify you when it's break time. 💪`,
    ].join('\n');
  }

  /** Pause the active session */
  async pause(params = {}) {
    const d = loadData();
    if (!d.active || d.active.status !== 'running') return '⚠️ No active running session to pause.';
    d.active.status  = 'paused';
    d.active.pausedAt = Date.now();
    saveData(d);
    const elapsed = Math.floor((Date.now() - d.active.startedAt - d.active.pausedMs) / 60000);
    return `⏸️ Paused *"${d.active.task}"* after ${elapsed} min.`;
  }

  /** Resume a paused session */
  async resume(params = {}) {
    const d = loadData();
    if (!d.active || d.active.status !== 'paused') return '⚠️ No paused session to resume.';
    d.active.pausedMs   += Date.now() - d.active.pausedAt;
    d.active.pausedAt   = null;
    d.active.status     = 'running';
    saveData(d);
    const remaining = Math.max(0, d.active.workMin * 60000 - (Date.now() - d.active.startedAt - d.active.pausedMs));
    const remMin = Math.ceil(remaining / 60000);
    return `▶️ Resumed *"${d.active.task}"* — ${remMin} min remaining in this round.`;
  }

  /** Stop the active session and log it */
  async stop(params = {}) {
    const d = loadData();
    if (!d.active) return '⚠️ No active session.';
    const session = { ...d.active };
    session.endedAt = Date.now();
    session.durationMin = Math.floor((session.endedAt - session.startedAt - session.pausedMs) / 60000);
    d.sessions.push(session);
    d.active = null;
    saveData(d);
    notify('⏹️ Session Ended', `"${session.task}" — ${session.durationMin} min logged`);
    return `⏹️ Session stopped: *"${session.task}"*\n⏱️ Duration: ${session.durationMin} min\n✅ Logged to history.`;
  }

  /** Show current session status */
  async status(params = {}) {
    const d = loadData();
    if (!d.active) return '⚪ No active Pomodoro session. Start one with `/pomo start <task>`';

    const s = d.active;
    const elapsed = Math.floor((Date.now() - s.startedAt - s.pausedMs) / 60000);
    const remaining = Math.max(0, s.workMin - elapsed);
    const progress = Math.min(25, Math.round((elapsed / s.workMin) * 25));
    const bar = '█'.repeat(progress) + '░'.repeat(25 - progress);

    const statusEmoji = s.status === 'running' ? '▶️' : s.status === 'paused' ? '⏸️' : '☕';
    const phaseLabel  = s.phase === 'work' ? '🍅 Work' : s.phase === 'short_break' ? '☕ Short Break' : '🛌 Long Break';

    return [
      `${statusEmoji} *Pomodoro Status*`,
      ``,
      `📌 Task: *${s.task}*`,
      `🔄 Phase: ${phaseLabel}`,
      `🔁 Round: ${s.currentRound} / ${s.rounds}`,
      ``,
      `\`${bar}\``,
      `⏱️ ${elapsed} min elapsed | ${remaining} min remaining`,
    ].join('\n');
  }

  /** Show today's focus statistics */
  async stats(params = {}) {
    const d = loadData();
    const today = new Date().toDateString();
    const todaySessions = d.sessions.filter(s => new Date(s.startedAt).toDateString() === today);
    const totalMin = todaySessions.reduce((a, s) => a + (s.durationMin || 0), 0);
    const focusHours = (totalMin / 60).toFixed(1);
    const completedRounds = todaySessions.length;

    if (!todaySessions.length && !d.active) {
      return `📊 No focus sessions today yet.\nStart one: \`/pomo start <what you're working on>\``;
    }

    const sessionList = todaySessions.slice(-5).map(
      (s, i) => `${i + 1}. *${s.task}* — ${s.durationMin} min`
    ).join('\n');

    return [
      `📊 *Today's Focus Stats*`,
      ``,
      `🍅 Sessions completed: *${completedRounds}*`,
      `⏱️ Total focus time:   *${totalMin} min* (${focusHours}h)`,
      d.active ? `\n🔥 Currently running: *${d.active.task}*` : '',
      todaySessions.length ? `\n*Recent sessions:*\n${sessionList}` : '',
    ].filter(Boolean).join('\n');
  }
}
