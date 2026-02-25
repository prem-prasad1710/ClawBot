/**
 * tools/reminder.js - Complete rewrite with robust natural-language date/time parser.
 * Handles: "in X min", "6:35pm", "today at 6pm", "tomorrow at 9am",
 *          "next Friday at 3pm", "25 Feb at 6pm", weekday names.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
const execAsync = promisify(exec);

const DAY_NAMES = {
  sunday:0, sun:0, monday:1, mon:1, tuesday:2, tue:2,
  wednesday:3, wed:3, thursday:4, thu:4, friday:5, fri:5, saturday:6, sat:6
};
const MONTH_NAMES = {
  jan:0, january:0, feb:1, february:1, mar:2, march:2, apr:3, april:3,
  may:4, jun:5, june:5, jul:6, july:6, aug:7, august:7,
  sep:8, sept:8, september:8, oct:9, october:9, nov:10, november:10, dec:11, december:11
};

export class Reminder {
  // ─── Public: create a reminder ──────────────────────────────────────────────
  async create(params = {}) {
    const { text = 'Reminder', time = '', date = '', list = 'Reminders' } = params;
    logger.info(`[Reminder] create: text="${text}" time="${time}" date="${date}"`);

    // Combine date+time into one string for the parser
    const combined = [date, time].filter(Boolean).join(' ');
    const parsed = combined ? this.parseDateTime(combined) : null;
    logger.info(`[Reminder] parsed → ${parsed ? parsed.toLocaleString() : 'null'}`);

    const appResult = await this._addToRemindersApp(text, parsed, list);

    let notifyResult = '';
    if (parsed) {
      const delayMs = parsed.getTime() - Date.now();
      if (delayMs <= 0) {
        notifyResult = await this._notifyNow(text, '⏰ ClawBot Reminder');
      } else {
        notifyResult = await this._sleepNotify(text, delayMs, parsed);
      }
    }

    const timeDisplay = parsed ? this.formatDateTime(parsed) : 'no time set';
    return [appResult, notifyResult, `📅 *"${text}"* — ${timeDisplay}`].filter(Boolean).join('\n');
  }

  // ─── Public: immediate notification ─────────────────────────────────────────
  async notify(params = {}) {
    const { message = '', title = 'ClawBot', subtitle = '' } = params;
    return this._notifyNow(message, title, subtitle);
  }

  // ─── Public: list pending reminders ─────────────────────────────────────────
  async list(params = {}) {
    const listName = params.list || '';
    const script = listName
      ? `tell application "Reminders"\nset output to ""\nrepeat with r in reminders of list "${listName}"\nset dueStr to ""\ntry\nset dueStr to due date of r as string\nend try\nset output to output & (name of r) & " [" & dueStr & "]\\n"\nend repeat\nreturn output\nend tell`
      : `tell application "Reminders"\nset output to ""\nrepeat with r in (reminders whose completed is false)\nset dueStr to ""\ntry\nset dueStr to due date of r as string\nend try\nset output to output & (name of r) & " [" & dueStr & "]\\n"\nend repeat\nreturn output\nend tell`;
    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 });
      return stdout.trim() || '📭 No pending reminders.';
    } catch (err) {
      return `Could not read Reminders: ${err.message}`;
    }
  }

  // ─── Core: date/time parser ──────────────────────────────────────────────────
  /**
   * parseDateTime(input) — parse natural language date+time into a Date object.
   * Returns null if no time info found.
   */
  parseDateTime(input) {
    if (!input) return null;
    const now = new Date();
    const s = input.toLowerCase().trim();

    // "in X minutes/hours/seconds"
    const relMatch = s.match(/\bin\s+(\d+)\s+(second|sec|minute|min|hour|hr)s?\b/);
    if (relMatch) {
      const n = parseInt(relMatch[1]);
      const u = relMatch[2];
      const ms = u.startsWith('h') ? n * 3600000 : u.startsWith('s') ? n * 1000 : n * 60000;
      return new Date(now.getTime() + ms);
    }

    // Extract time component: "6:35pm", "6pm", "18:35", "6:00"
    let hours = null, mins = 0;

    // Try "H:MM am/pm" or "H:MM" (24h)
    let tMatch = s.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
    if (tMatch) {
      hours = parseInt(tMatch[1]);
      mins = parseInt(tMatch[2]);
      const ampm = (tMatch[3] || '').toLowerCase();
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      // No ampm and hour < 7 → assume PM (e.g. "at 6:30" = 6:30pm)
      if (!ampm && hours < 7) hours += 12;
    } else {
      // Try "H am/pm" (no colon)
      tMatch = s.match(/\b(\d{1,2})\s*(am|pm)\b/i);
      if (tMatch) {
        hours = parseInt(tMatch[1]);
        mins = 0;
        const ampm = tMatch[2].toLowerCase();
        if (ampm === 'pm' && hours < 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
      }
    }

    // Build base date from today
    let base = new Date(now);
    base.setSeconds(0, 0);

    // Resolve day offset
    if (/\btomorrow\b/.test(s)) {
      base.setDate(base.getDate() + 1);
    } else if (/\byesterday\b/.test(s)) {
      base.setDate(base.getDate() - 1);
    } else {
      const nextMatch = s.match(/\bnext\s+(\w+)\b/);
      if (nextMatch && DAY_NAMES[nextMatch[1]] !== undefined) {
        const targetDay = DAY_NAMES[nextMatch[1]];
        let diff = targetDay - base.getDay();
        if (diff <= 0) diff += 7;
        base.setDate(base.getDate() + diff);
      } else {
        // Look for a plain weekday name ("friday", "mon", etc.)
        for (const [name, dayNum] of Object.entries(DAY_NAMES)) {
          if (new RegExp(`\\b${name}\\b`).test(s)) {
            let diff = dayNum - base.getDay();
            if (diff < 0) diff += 7;
            // Same day but time already past → next week
            if (diff === 0 && hours !== null) {
              const check = new Date(base);
              check.setHours(hours, mins, 0, 0);
              if (check.getTime() <= now.getTime()) diff = 7;
            }
            base.setDate(base.getDate() + diff);
            break;
          }
        }
      }
    }

    // Explicit month+day: "25 Feb", "Feb 25", "25 February 2025"
    const mdRx = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/i;
    const mdMatch = s.match(mdRx);
    if (mdMatch) {
      const dayStr = mdMatch[1] || mdMatch[4];
      const monStr = (mdMatch[2] || mdMatch[3]).slice(0, 3).toLowerCase();
      const monIdx = MONTH_NAMES[monStr];
      if (monIdx !== undefined) {
        base.setMonth(monIdx);
        base.setDate(parseInt(dayStr));
      }
      const yearMatch = s.match(/\b(20\d\d)\b/);
      if (yearMatch) base.setFullYear(parseInt(yearMatch[1]));
      else if (base.getTime() < now.getTime()) base.setFullYear(base.getFullYear() + 1);
    }

    // Apply the extracted time
    if (hours !== null) {
      base.setHours(hours, mins, 0, 0);
      // If no explicit day given and time already past → push to tomorrow
      const hasExplicitDay = /\btomorrow\b|\byesterday\b|\bnext\b|(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i.test(s) || mdMatch;
      if (!hasExplicitDay && base.getTime() <= now.getTime()) {
        base.setDate(base.getDate() + 1);
      }
      return base;
    }

    return null;
  }

  formatDateTime(date) {
    if (!date) return 'no time set';
    return date.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────
  async _addToRemindersApp(text, parsedDate, list) {
    const safeText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    let duePart = '';
    if (parsedDate) {
      const pad = (n) => String(n).padStart(2, '0');
      const asDate = `${pad(parsedDate.getMonth() + 1)}/${pad(parsedDate.getDate())}/${parsedDate.getFullYear()} ${pad(parsedDate.getHours())}:${pad(parsedDate.getMinutes())}:00`;
      duePart = `, due date:date "${asDate}"`;
    }
    const safeList = list.replace(/"/g, '\\"');
    const script = `tell application "Reminders"\ntell list "${safeList}"\nmake new reminder with properties {name:"${safeText}"${duePart}}\nend tell\nend tell`;
    try {
      await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 });
      return `✅ Added to Reminders.app: "${text}"`;
    } catch (err) {
      logger.warn(`[Reminder] Reminders.app failed: ${err.stderr || err.message}`);
      return `⚠️ Reminders.app: ${(err.stderr || err.message).slice(0, 120)}`;
    }
  }

  async _sleepNotify(text, delayMs, targetDate) {
    const delaySec = Math.max(1, Math.floor(delayMs / 1000));
    const safe = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, '');
    const script = `display notification "${safe}" with title "⏰ ClawBot Reminder" sound name "Glass"`;
    const cmd = `(sleep ${delaySec} && osascript -e '${script}') > /dev/null 2>&1 &`;
    try {
      await execAsync(cmd, { timeout: 5000 });
      const mins = Math.round(delaySec / 60);
      const timeStr = targetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `⏰ Notification scheduled for ${timeStr} (~${mins > 0 ? mins + 'min' : delaySec + 's'} from now)`;
    } catch (err) {
      return `⚠️ Could not schedule notification: ${err.message}`;
    }
  }

  async _notifyNow(message, title = 'ClawBot Reminder', subtitle = '') {
    const msg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, '');
    const ttl = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, '');
    const sub = subtitle ? ` subtitle "${subtitle.replace(/"/g, '\\"').replace(/'/g, '')}"` : '';
    try {
      await execAsync(`osascript -e 'display notification "${msg}" with title "${ttl}"${sub} sound name "Glass"'`, { timeout: 10000 });
      return `🔔 Notification sent: "${message}"`;
    } catch (err) {
      return `⚠️ Notification failed: ${err.message}`;
    }
  }
}