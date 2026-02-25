/**
 * tools/dailybriefing.js — Daily briefing: calendar + email + reminders.
 * Call generate() to get a morning summary formatted for Telegram.
 */
import { Calendar } from './calendar.js';
import { Reminder } from './reminder.js';

export class DailyBriefing {
  constructor() {
    this.calendar = new Calendar();
    this.reminder = new Reminder();
  }

  async generate(params = {}) {
    const now = new Date();
    const greeting = this._greeting(now);
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    // Fetch all sections in parallel
    const [calSection, reminderSection, emailSection] = await Promise.allSettled([
      this._getCalendarSection(),
      this._getReminderSection(),
      this._getEmailSection()
    ]);

    const sections = [
      `${greeting} Here's your daily briefing for *${dateStr}*:\n`,
      this._unwrap(calSection),
      this._unwrap(reminderSection),
      this._unwrap(emailSection),
      `\n_ClawBot is ready. Have a great day! 🚀_`
    ].filter(Boolean);

    return sections.join('\n\n');
  }

  _greeting(date) {
    const h = date.getHours();
    if (h < 12) return '🌅 Good morning!';
    if (h < 17) return '☀️ Good afternoon!';
    return '🌙 Good evening!';
  }

  _unwrap(settled) {
    if (settled.status === 'fulfilled') return settled.value;
    return `⚠️ Section failed: ${settled.reason?.message || 'unknown'}`;
  }

  async _getCalendarSection() {
    try {
      const result = await this.calendar.getTodayEvents();
      return result;
    } catch (err) {
      return `📅 *Calendar:* Could not load events — ${err.message.slice(0, 80)}`;
    }
  }

  async _getReminderSection() {
    try {
      const result = await this.reminder.list({});
      if (!result || result.includes('No pending')) return '✅ *Reminders:* Nothing pending today.';
      return `⏰ *Pending Reminders:*\n${result}`;
    } catch (err) {
      return `⏰ *Reminders:* Could not load — ${err.message.slice(0, 80)}`;
    }
  }

  async _getEmailSection() {
    try {
      // Dynamic import so email module failures don't crash the briefing
      const { EmailTool } = await import('./email.js');
      const emailTool = new EmailTool();
      if (typeof emailTool.getDailyEmailSummary === 'function') {
        return await emailTool.getDailyEmailSummary();
      }
      // Fallback: use scanUrgent
      if (typeof emailTool.scanUrgent === 'function') {
        const result = await emailTool.scanUrgent({ limit: 3 });
        if (!result || result.trim() === '') return '📬 *Email:* No urgent messages.';
        return `📬 *Urgent Emails:*\n${result}`;
      }
      return '📬 *Email:* Not configured.';
    } catch (err) {
      return `📬 *Email:* ${err.message.slice(0, 80)}`;
    }
  }
}
