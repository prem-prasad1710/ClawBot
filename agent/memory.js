/**
 * agent/memory.js
 * Persistent long-term memory for tasks, history, project info,
 * user profiles, and per-user conversation context.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const MEMORY_DIR = new URL('../memory', import.meta.url).pathname;

const FILES = {
  tasks:        path.join(MEMORY_DIR, 'tasks.json'),
  history:      path.join(MEMORY_DIR, 'history.json'),
  projects:     path.join(MEMORY_DIR, 'projects.json'),
  userProfiles: path.join(MEMORY_DIR, 'user-profiles.json'),
  conversations:path.join(MEMORY_DIR, 'conversations.json'),
};

export class AgentMemory {
  constructor() {
    this._ensureFiles();
  }

  // ── Task memory ─────────────────────────────────

  async saveTask(taskRecord) {
    const tasks = this._read(FILES.tasks);
    tasks.unshift(taskRecord);
    this._write(FILES.tasks, tasks.slice(0, 100));

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
    return this._read(FILES.tasks).slice(0, n);
  }

  // ── Project memory ───────────────────────────────

  saveProject(name, info) {
    const projects = this._read(FILES.projects);
    projects[name] = { ...info, updatedAt: new Date().toISOString() };
    this._write(FILES.projects, projects);
  }

  getProject(name) {
    return this._read(FILES.projects)[name] || null;
  }

  // ── User profile ─────────────────────────────────

  /**
   * Get the profile for a Telegram user id.
   * Profile is created automatically on first access.
   */
  getUserProfile(userId) {
    const profiles = this._read(FILES.userProfiles);
    return profiles[String(userId)] || null;
  }

  /**
   * Update a user profile. Creates it if it doesn't exist.
   * Merges the provided fields with existing data.
   */
  updateUserProfile(userId, data) {
    const profiles = this._read(FILES.userProfiles);
    const uid = String(userId);
    const existing = profiles[uid] || {
      userId: uid,
      name: null,
      knownProjects: [],
      preferences: {},
      firstSeen: new Date().toISOString(),
      messageCount: 0,
    };
    const updated = {
      ...existing,
      ...data,
      // Merge arrays & objects instead of replacing
      knownProjects: [...new Set([...(existing.knownProjects || []), ...(data.knownProjects || [])])],
      preferences:   { ...(existing.preferences || {}), ...(data.preferences || {}) },
      lastSeen: new Date().toISOString(),
      messageCount: (existing.messageCount || 0) + 1,
    };
    profiles[uid] = updated;
    this._write(FILES.userProfiles, profiles);
    return updated;
  }

  /**
   * Auto-learn from a task: extract project names and remember them.
   */
  learnFromTask(userId, task, summary) {
    // Extract repo/project names mentioned (capitalised words > 3 chars)
    const projectMatches = task.match(/\b([A-Z][a-zA-Z0-9_-]{2,})\b/g) || [];
    const filteredProjects = projectMatches.filter(p =>
      !['The','This','That','Here','What','When','Where','Why','How','Can','Could','Would','Should'].includes(p)
    );
    const profiles = this._read(FILES.userProfiles);
    const uid = String(userId);
    const existing = profiles[uid] || {};
    const prev = existing.tasksCompleted || 0;
    const updates = { tasksCompleted: prev + 1 };
    if (filteredProjects.length > 0) updates.knownProjects = filteredProjects;
    this.updateUserProfile(userId, updates);
  }

  // ── Conversation memory ───────────────────────────

  /**
   * Append a message to the user's cross-session conversation history.
   */
  addConversationMessage(userId, role, content) {
    const convos = this._read(FILES.conversations);
    const uid = String(userId);
    if (!convos[uid]) convos[uid] = [];
    convos[uid].push({
      role,
      content: content.slice(0, 500), // cap per message
      ts: new Date().toISOString(),
    });
    // Keep last 30 messages per user
    convos[uid] = convos[uid].slice(-30);
    this._write(FILES.conversations, convos);
  }

  /**
   * Get the last N conversation messages for a user.
   */
  getConversationHistory(userId, n = 10) {
    const convos = this._read(FILES.conversations);
    return (convos[String(userId)] || []).slice(-n);
  }

  // ── Context builder ──────────────────────────────

  getRelevantContext(task) {
    const recent = this.getRecentTasks(3);
    if (!recent.length) return '';
    const lines = recent.map(t => `- [${t.success ? 'OK' : 'FAIL'}] ${t.task}: ${t.summary}`);
    return `Recent tasks:\n${lines.join('\n')}`;
  }

  // ── Stats ────────────────────────────────────────

  getStats() {
    const tasks = this._read(FILES.tasks);
    const total = tasks.length;
    const success = tasks.filter(t => t.success).length;
    return { total, success, failed: total - success };
  }

  /**
   * Gamified progress card for a user.
   * XP formula intentionally simple and transparent.
   */
  getUserLevel(userId) {
    const profile = this.getUserProfile(userId) || {};
    const tasksCompleted = profile.tasksCompleted || 0;
    const messages = profile.messageCount || 0;
    const habitsDone = profile.habitsChecked || 0;

    const xp = (tasksCompleted * 25) + (messages * 2) + (habitsDone * 8);
    const level = Math.max(1, Math.floor(xp / 120) + 1);
    const currentLevelFloor = (level - 1) * 120;
    const nextLevelAt = level * 120;
    const progressInLevel = xp - currentLevelFloor;
    const neededForNext = nextLevelAt - xp;

    const titles = [
      'New Recruit',
      'Prompt Pilot',
      'Workflow Tactician',
      'Automation Ninja',
      'Systems Architect',
      'Legendary Operator',
    ];
    const title = titles[Math.min(level - 1, titles.length - 1)];

    return {
      xp,
      level,
      title,
      progressInLevel,
      neededForNext,
      tasksCompleted,
      messages,
      habitsDone,
    };
  }

  // ── Private ──────────────────────────────────────

  _ensureFiles() {
    if (!fs.existsSync(MEMORY_DIR)) {
      fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
    for (const [key, file] of Object.entries(FILES)) {
      if (!fs.existsSync(file)) {
        const isObj = ['projects', 'userProfiles', 'conversations'].includes(key);
        fs.writeFileSync(file, JSON.stringify(isObj ? {} : [], null, 2));
      }
    }
  }

  _read(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return file.endsWith('profiles.json') || file.endsWith('projects.json') || file.endsWith('conversations.json') ? {} : [];
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
