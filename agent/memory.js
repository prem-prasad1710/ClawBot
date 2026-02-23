/**
 * agent/memory.js
 * Persistent long-term memory for tasks, history, and project info.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const MEMORY_DIR = new URL('../memory', import.meta.url).pathname;

const FILES = {
  tasks: path.join(MEMORY_DIR, 'tasks.json'),
  history: path.join(MEMORY_DIR, 'history.json'),
  projects: path.join(MEMORY_DIR, 'projects.json'),
};

export class AgentMemory {
  constructor() {
    this._ensureFiles();
  }

  // ── Task memory ─────────────────────────────────

  async saveTask(taskRecord) {
    const tasks = this._read(FILES.tasks);
    tasks.unshift(taskRecord);
    // Keep the latest 100 tasks
    this._write(FILES.tasks, tasks.slice(0, 100));

    // Also append summary to history
    const history = this._read(FILES.history);
    history.unshift({
      timestamp: taskRecord.timestamp,
      task: taskRecord.task,
      success: taskRecord.success,
      summary: taskRecord.summary,
    });
    this._write(FILES.history, history.slice(0, 500));

    logger.debug(`[Memory] Saved task: ${taskRecord.id}`);
  }

  getRecentTasks(n = 5) {
    const tasks = this._read(FILES.tasks);
    return tasks.slice(0, n);
  }

  // ── Project memory ───────────────────────────────

  saveProject(name, info) {
    const projects = this._read(FILES.projects);
    projects[name] = { ...info, updatedAt: new Date().toISOString() };
    this._write(FILES.projects, projects);
  }

  getProject(name) {
    const projects = this._read(FILES.projects);
    return projects[name] || null;
  }

  // ── Context builder ──────────────────────────────

  /**
   * Build a short memory context string to inject into the brain.
   */
  getRelevantContext(task) {
    const recent = this.getRecentTasks(3);
    if (!recent.length) return '';

    const lines = recent.map(
      (t) => `- [${t.success ? 'OK' : 'FAIL'}] ${t.task}: ${t.summary}`
    );
    return `Recent tasks:\n${lines.join('\n')}`;
  }

  // ── Stats ────────────────────────────────────────

  getStats() {
    const tasks = this._read(FILES.tasks);
    const total = tasks.length;
    const success = tasks.filter((t) => t.success).length;
    return { total, success, failed: total - success };
  }

  // ── Private ──────────────────────────────────────

  _ensureFiles() {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    // tasks and history are arrays; projects is an object
    for (const [key, file] of Object.entries(FILES)) {
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(key === 'projects' ? {} : [], null, 2));
      }
    }
  }

  _read(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return file === FILES.projects ? {} : [];
    }
  }

  _write(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      logger.error(`[Memory] Write failed for ${file}: ${err.message}`);
    }
  }
}
