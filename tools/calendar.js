/**
 * tools/calendar.js — macOS Calendar.app control via osascript.
 * Methods: getTodayEvents, getWeekEvents, createEvent, findEvent, deleteEvent
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger.js';
const execAsync = promisify(exec);

export class Calendar {
  /** Run an AppleScript by writing to a temp file (avoids -e quoting issues & -600 errors) */
  async _run(script) {
    const tmp = join(tmpdir(), `clawbot_cal_${Date.now()}.scpt`);
    await writeFile(tmp, script, 'utf8');
    try {
      const { stdout } = await execAsync(`osascript "${tmp}"`, { timeout: 20000 });
      return stdout.trim();
    } finally {
      unlink(tmp).catch(() => {});
    }
  }

  // ─── Today's Events ───────────────────────────────────────────────────────
  async getTodayEvents() {
    const script = `tell application "Calendar"
set output to ""
set todayStart to current date
set hours of todayStart to 0
set minutes of todayStart to 0
set seconds of todayStart to 0
set todayEnd to todayStart + 86399
repeat with cal in calendars
  set evts to (every event of cal whose start date >= todayStart and start date <= todayEnd)
  repeat with ev in evts
    set evTitle to summary of ev
    set evStart to start date of ev as string
    set evEnd to end date of ev as string
    set evLoc to ""
    try
      set evLoc to location of ev
    end try
    set output to output & evTitle & "|" & evStart & "|" & evEnd & "|" & evLoc & "
"
  end repeat
end repeat
return output
end tell`;
    try {
      const raw = await this._run(script);
      if (!raw) return '📭 No events today.';
      const lines = raw.split('\n').filter(l => l.includes('|'));
      if (!lines.length) return '📭 No events today.';
      const formatted = lines.map(line => {
        const [title, start, end, loc] = line.split('|');
        const s = start ? new Date(start) : null;
        const e = end ? new Date(end) : null;
        const timeStr = s ? s.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
        const endStr = e ? ' – ' + e.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
        const locStr = loc && loc.trim() ? ` 📍${loc.trim()}` : '';
        return `• *${(title || '').trim()}* ${timeStr}${endStr}${locStr}`;
      });
      return `📅 *Today's Events:*\n${formatted.join('\n')}`;
    } catch (err) {
      logger.warn(`[Calendar] getTodayEvents error: ${err.message}`);
      return `⚠️ Calendar error: ${err.message.slice(0, 120)}`;
    }
  }

  // ─── Week Events ──────────────────────────────────────────────────────────
  async getWeekEvents() {
    const script = `tell application "Calendar"
set output to ""
set todayStart to current date
set hours of todayStart to 0
set minutes of todayStart to 0
set seconds of todayStart to 0
set weekEnd to todayStart + (7 * 86400)
repeat with cal in calendars
  set evts to (every event of cal whose start date >= todayStart and start date <= weekEnd)
  repeat with ev in evts
    set evTitle to summary of ev
    set evStart to start date of ev as string
    set output to output & evTitle & "|" & evStart & "
"
  end repeat
end repeat
return output
end tell`;
    try {
      const raw = await this._run(script);
      if (!raw) return '📭 No events this week.';
      const lines = raw.split('\n').filter(l => l.includes('|'));
      if (!lines.length) return '📭 No events this week.';
      const grouped = {};
      for (const line of lines) {
        const [title, start] = line.split('|');
        const d = new Date(start);
        const dayKey = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        if (!grouped[dayKey]) grouped[dayKey] = [];
        const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        grouped[dayKey].push(`  • *${(title || '').trim()}* ${t}`);
      }
      const out = Object.entries(grouped)
        .map(([day, evts]) => `*${day}*\n${evts.join('\n')}`)
        .join('\n\n');
      return `📅 *Week Ahead:*\n\n${out}`;
    } catch (err) {
      return `⚠️ Calendar error: ${err.message.slice(0, 120)}`;
    }
  }

  // ─── Create Event ─────────────────────────────────────────────────────────
  async createEvent(params = {}) {
    const {
      title = 'New Event', date = '', time = '', duration = 60,
      location = '', notes = '', calendar = 'Calendar'
    } = params;

    // Reuse Reminder's date parser
    const { Reminder } = await import('./reminder.js');
    const R = new Reminder();
    const combined = [date, time].filter(Boolean).join(' ');
    const startDate = combined
      ? R.parseDateTime(combined)
      : (() => { const d = new Date(); d.setMinutes(d.getMinutes() + 30, 0, 0); return d; })();

    if (!startDate) return '⚠️ Could not parse date/time for event.';
    const endDate = new Date(startDate.getTime() + duration * 60000);

    /**
     * Build an AppleScript literal that sets each date component individually.
     * This avoids locale-specific date string parsing bugs in AppleScript.
     */
    const dateExpr = (d) => {
      const seconds = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
      return `(do shell script "echo " & (current date))\nset _d to current date\nset year of _d to ${d.getFullYear()}\nset month of _d to ${d.getMonth() + 1}\nset day of _d to ${d.getDate()}\nset time of _d to ${seconds}\n_d`;
    };

    const esc = s => (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Build native AppleScript date using property-setting approach
    const startY = startDate.getFullYear(), startMo = startDate.getMonth() + 1, startD = startDate.getDate();
    const startSec = startDate.getHours() * 3600 + startDate.getMinutes() * 60;
    const endY = endDate.getFullYear(), endMo = endDate.getMonth() + 1, endD = endDate.getDate();
    const endSec = endDate.getHours() * 3600 + endDate.getMinutes() * 60;

    const script = `tell application "Calendar"
activate
set startDate to current date
set year of startDate to ${startY}
set month of startDate to ${startMo}
set day of startDate to ${startD}
set time of startDate to ${startSec}
set endDate to current date
set year of endDate to ${endY}
set month of endDate to ${endMo}
set day of endDate to ${endD}
set time of endDate to ${endSec}
tell calendar "${esc(calendar)}"
make new event with properties {summary:"${esc(title)}", start date:startDate, end date:endDate, location:"${esc(location)}", description:"${esc(notes)}"}
end tell
end tell`;
    try {
      await this._run(script);
      const timeStr = startDate.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
      const endStr = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `✅ Event created: *"${title}"*\n📅 ${timeStr} – ${endStr}${location ? '\n📍 ' + location : ''}`;
    } catch (err) {
      return `⚠️ Could not create event: ${err.message.slice(0, 150)}`;
    }
  }

  // ─── Find Events ──────────────────────────────────────────────────────────
  async findEvent(params = {}) {
    const query = (params.query || params.title || '').toLowerCase();
    if (!query) return '⚠️ Please provide a search term.';
    const script = `tell application "Calendar"
set output to ""
set todayStart to current date
set searchEnd to todayStart + (30 * 86400)
repeat with cal in calendars
  set evts to (every event of cal whose start date >= todayStart and start date <= searchEnd)
  repeat with ev in evts
    set evTitle to summary of ev
    set evStart to start date of ev as string
    set output to output & evTitle & "|" & evStart & "
"
  end repeat
end repeat
return output
end tell`;
    try {
      const raw = await this._run(script);
      const lines = raw.split('\n').filter(l => l.includes('|') && l.toLowerCase().includes(query));
      if (!lines.length) return `📭 No events found matching "${query}" in the next 30 days.`;
      return lines.map(l => {
        const [t, s] = l.split('|');
        const d = new Date(s);
        return `• *${t.trim()}* — ${d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}`;
      }).join('\n');
    } catch (err) {
      return `⚠️ Find error: ${err.message.slice(0, 120)}`;
    }
  }

  // ─── Delete Event ─────────────────────────────────────────────────────────
  async deleteEvent(params = {}) {
    const query = (params.title || params.query || '').toLowerCase().replace(/'/g, '');
    if (!query) return '⚠️ Please tell me which event to delete.';
    const script = `tell application "Calendar"
set todayStart to current date
set searchEnd to todayStart + (7 * 86400)
repeat with cal in calendars
  set evts to (every event of cal whose start date >= todayStart and start date <= searchEnd)
  repeat with ev in evts
    if (summary of ev) as string contains "${query}" then
      delete ev
      return "deleted"
    end if
  end repeat
end repeat
return "not_found"
end tell`;
    try {
      const r = await this._run(script);
      return r.includes('deleted')
        ? `🗑️ Event deleted: "${query}"`
        : `📭 No upcoming event found matching "${query}"`;
    } catch (err) {
      return `⚠️ Delete failed: ${err.message.slice(0, 120)}`;
    }
  }
}
