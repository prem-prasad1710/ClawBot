/**
 * tools/habits.js – Habit Tracker Tool
 * Track daily habits, streaks, check-ins, and progress.
 * Data stored in memory/habits.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { logger } from '../utils/logger.js';

const DATA_FILE = new URL('../memory/habits.json', import.meta.url).pathname;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function loadData() {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {}
  return { habits: [], checkins: {} };
}

function saveData(d) {
  try { writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); } catch {}
}

function calculateStreak(habit, checkins) {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayCheckins = checkins[key] || [];
    if (dayCheckins.includes(habit.id)) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

function completionRateLast30(habitId, checkins) {
  let done = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if ((checkins[key] || []).includes(habitId)) done++;
  }
  return Math.round((done / 30) * 100);
}

export class HabitTracker {
  /**
   * Add a new habit
   * @param {object} params
   * @param {string} params.name     – Habit name
   * @param {string} params.emoji    – Optional emoji
   * @param {string} params.goal     – Daily goal description
   * @param {string} params.category – "health" | "learning" | "productivity" | "mindfulness" | "custom"
   */
  async add(params = {}) {
    const { name, emoji = '✅', goal = 'Daily', category = 'custom' } = params;
    if (!name) return '⚠️ Please provide a habit name.';
    const d = loadData();
    const exists = d.habits.find(h => h.name.toLowerCase() === name.toLowerCase());
    if (exists) return `⚠️ Habit "*${name}*" already exists.`;

    const habit = {
      id: `habit_${Date.now()}`,
      name,
      emoji,
      goal,
      category,
      createdAt: Date.now(),
    };
    d.habits.push(habit);
    saveData(d);
    return `${emoji} *Habit added:* "${name}"\n📋 Goal: ${goal}\n🏷️ Category: ${category}\n\nCheck it off daily with \`/habit done ${name}\``;
  }

  /**
   * Mark a habit as done today
   */
  async done(params = {}) {
    const name = params.name || params.habit || '';
    if (!name) return '⚠️ Specify which habit: `/habit done <name>`';
    const d = loadData();
    const habit = d.habits.find(h => h.name.toLowerCase().includes(name.toLowerCase()));
    if (!habit) return `⚠️ Habit "${name}" not found. Use /habit list to see your habits.`;

    const today = todayKey();
    if (!d.checkins[today]) d.checkins[today] = [];
    if (d.checkins[today].includes(habit.id)) {
      return `${habit.emoji} *${habit.name}* is already checked off for today! 🎉`;
    }
    d.checkins[today].push(habit.id);
    saveData(d);

    const streak = calculateStreak(habit, d.checkins);
    const rate   = completionRateLast30(habit.id, d.checkins);

    let streakMsg = `🔥 Streak: *${streak} day${streak !== 1 ? 's' : ''}*`;
    if (streak === 7) streakMsg += ' — One week streak! 🌟';
    else if (streak === 30) streakMsg += ' — 30 day streak! 🏆';
    else if (streak === 100) streakMsg += ' — 100 days! Legendary! 👑';

    return [
      `${habit.emoji} *${habit.name}* — checked off for today! ✅`,
      streakMsg,
      `📈 30-day rate: *${rate}%*`,
    ].join('\n');
  }

  /**
   * List all habits with today's status
   */
  async list(params = {}) {
    const d = loadData();
    if (!d.habits.length) {
      return `📋 No habits tracked yet.\nAdd one: \`/habit add <name>\`\n\nSuggestions:\n• Morning workout\n• Read 30 minutes\n• Drink 8 glasses of water\n• Meditate 10 minutes\n• No social media before 10am`;
    }

    const today = todayKey();
    const todayDone = d.checkins[today] || [];

    const lines = d.habits.map(h => {
      const done    = todayDone.includes(h.id);
      const streak  = calculateStreak(h, d.checkins);
      const rate    = completionRateLast30(h.id, d.checkins);
      const check   = done ? '✅' : '⬜';
      const streakStr = streak > 0 ? ` | 🔥 ${streak}d` : '';
      return `${check} ${h.emoji} *${h.name}* — ${rate}%${streakStr}`;
    });

    const totalDone = todayDone.length;
    const total     = d.habits.length;
    const allDone   = totalDone === total;
    const summaryEmoji = allDone ? '🏆' : totalDone > 0 ? '🔥' : '💪';

    return [
      `${summaryEmoji} *Habits — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}*`,
      `${totalDone}/${total} completed today`,
      ``,
      ...lines,
      ``,
      `Use \`/habit done <name>\` to check off a habit.`,
    ].join('\n');
  }

  /**
   * Show detailed stats for one habit or overall
   */
  async stats(params = {}) {
    const d = loadData();
    const name = params.name || '';

    if (name) {
      const habit = d.habits.find(h => h.name.toLowerCase().includes(name.toLowerCase()));
      if (!habit) return `⚠️ Habit "${name}" not found.`;
      const streak  = calculateStreak(habit, d.checkins);
      const rate    = completionRateLast30(habit.id, d.checkins);
      const totalDays = Object.values(d.checkins).filter(arr => arr.includes(habit.id)).length;

      // Last 7 days visual
      const last7 = [];
      for (let i = 6; i >= 0; i--) {
        const d2 = new Date();
        d2.setDate(d2.getDate() - i);
        const key = d2.toISOString().slice(0, 10);
        const done = (d.checkins[key] || []).includes(habit.id);
        last7.push(done ? '🟩' : '⬜');
      }

      return [
        `${habit.emoji} *${habit.name}* — Stats`,
        ``,
        `🔥 Current streak: *${streak} days*`,
        `📅 Total check-ins: *${totalDays} days*`,
        `📈 30-day rate: *${rate}%*`,
        ``,
        `*Last 7 days:*`,
        last7.join(' '),
        `Mon  Tue  Wed  Thu  Fri  Sat  Sun`,
      ].join('\n');
    }

    // Overall stats
    const total = d.habits.length;
    if (!total) return '📊 No habits yet. Add one with `/habit add <name>`';
    const today = todayKey();
    const todayDone = (d.checkins[today] || []).length;
    const streaks = d.habits.map(h => ({ name: h.name, streak: calculateStreak(h, d.checkins), emoji: h.emoji }));
    const topStreak = streaks.sort((a, b) => b.streak - a.streak)[0];

    return [
      `📊 *Habit Overview*`,
      ``,
      `📋 Total habits: *${total}*`,
      `✅ Completed today: *${todayDone}/${total}*`,
      topStreak.streak > 0 ? `🏆 Best streak: ${topStreak.emoji} *${topStreak.name}* — ${topStreak.streak} days` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * Remove a habit
   */
  async remove(params = {}) {
    const name = params.name || '';
    if (!name) return '⚠️ Specify habit to remove.';
    const d = loadData();
    const idx = d.habits.findIndex(h => h.name.toLowerCase().includes(name.toLowerCase()));
    if (idx === -1) return `⚠️ Habit "${name}" not found.`;
    const [removed] = d.habits.splice(idx, 1);
    saveData(d);
    return `🗑️ Habit removed: "${removed.name}"`;
  }
}
