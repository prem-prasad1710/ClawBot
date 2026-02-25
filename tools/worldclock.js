/**
 * tools/worldclock.js – World Clock, Timezone Converter & Meeting Planner
 * No API key needed — uses Intl.DateTimeFormat built into Node.js
 */
import { logger } from '../utils/logger.js';

// Major city → IANA timezone mapping
const CITY_TZ = {
  'new york': 'America/New_York', 'nyc': 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'la': 'America/Los_Angeles', 'sf': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles',
  'chicago': 'America/Chicago',
  'toronto': 'America/Toronto',
  'sao paulo': 'America/Sao_Paulo',
  'london': 'Europe/London',
  'paris': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'madrid': 'Europe/Madrid',
  'rome': 'Europe/Rome',
  'amsterdam': 'Europe/Amsterdam',
  'zurich': 'Europe/Amsterdam',
  'stockholm': 'Europe/Stockholm',
  'moscow': 'Europe/Moscow',
  'dubai': 'Asia/Dubai',
  'mumbai': 'Asia/Kolkata', 'india': 'Asia/Kolkata', 'ist': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata', 'bangalore': 'Asia/Kolkata', 'chennai': 'Asia/Kolkata', 'hyderabad': 'Asia/Kolkata',
  'singapore': 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  'shanghai': 'Asia/Shanghai', 'beijing': 'Asia/Shanghai', 'china': 'Asia/Shanghai',
  'tokyo': 'Asia/Tokyo', 'japan': 'Asia/Tokyo',
  'seoul': 'Asia/Seoul',
  'sydney': 'Australia/Sydney',
  'melbourne': 'Australia/Melbourne',
  'auckland': 'Pacific/Auckland',
  'utc': 'UTC', 'gmt': 'UTC',
  'pst': 'America/Los_Angeles', 'pdt': 'America/Los_Angeles',
  'est': 'America/New_York',   'edt': 'America/New_York',
  'cst': 'America/Chicago',
  'mst': 'America/Denver',
  'bst': 'Europe/London',
  'cet': 'Europe/Paris',
  'jst': 'Asia/Tokyo',
  'sgt': 'Asia/Singapore',
  'aest': 'Australia/Sydney',
};

function resolveTimezone(input) {
  const key = input.trim().toLowerCase();
  return CITY_TZ[key] || input; // fallback to raw string (IANA tz name)
}

function formatInTz(date, tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return fmt.format(date);
  } catch {
    return '(Invalid timezone)';
  }
}

function getOffset(tz) {
  try {
    const now = new Date();
    const offsetMin = -new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value.replace('GMT', '').replace(':','') || 0;
    return offsetMin;
  } catch { return '?'; }
}

export class WorldClock {
  /**
   * Get current time in one or more cities/timezones
   * @param {object} params
   * @param {string} params.cities – comma-separated cities/timezones
   */
  async now(params = {}) {
    const raw = params.cities || params.city || params.timezone || 'UTC,New York,London,Dubai,Mumbai,Tokyo,Sydney';
    const cities = raw.split(',').map(s => s.trim());
    const now = new Date();

    const lines = cities.map(city => {
      const tz       = resolveTimezone(city);
      const timeStr  = formatInTz(now, tz);
      const cityName = city.replace(/\b\w/g, l => l.toUpperCase());
      return `🏙️ *${cityName}* — ${timeStr}`;
    });

    return [`🕐 *World Clock*`, ``, ...lines].join('\n');
  }

  /**
   * Convert a time from one timezone to another
   * @param {object} params
   * @param {string} params.time   – e.g. "3pm", "15:00"
   * @param {string} params.from   – source city/timezone
   * @param {string} params.to     – target city/timezone (comma-sep for multiple)
   */
  async convert(params = {}) {
    const { time, from = 'UTC', to = 'UTC' } = params;
    if (!time) return '⚠️ Please provide a time to convert.';

    const fromTz = resolveTimezone(from);
    const targets = to.split(',').map(s => s.trim());

    // Parse time string into today's date in source timezone
    const now = new Date();
    const tMatch = time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!tMatch) return `⚠️ Could not parse time: "${time}"`;

    let hours = parseInt(tMatch[1]);
    const mins  = parseInt(tMatch[2] || '0');
    const ampm  = (tMatch[3] || '').toLowerCase();
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    // Construct the source datetime string in that timezone
    // We'll use the current date in the source TZ and set hours/mins
    const dateInFrom = new Intl.DateTimeFormat('en-CA', {
      timeZone: fromTz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    const sourceISO = `${dateInFrom}T${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:00`;
    const sourceDate = new Date(sourceISO);

    const lines = targets.map(target => {
      const targetTz   = resolveTimezone(target);
      const converted  = formatInTz(sourceDate, targetTz);
      const cityName   = target.replace(/\b\w/g, l => l.toUpperCase());
      return `  🏙️ *${cityName}* → ${converted}`;
    });

    const fromName = from.replace(/\b\w/g, l => l.toUpperCase());
    return [
      `🕐 *Time Conversion*`,
      ``,
      `*${time}* in *${fromName}* is:`,
      ...lines,
    ].join('\n');
  }

  /**
   * Meeting planner – find a good time window for participants in multiple timezones
   * @param {object} params
   * @param {string} params.cities       – comma-sep cities
   * @param {string} params.work_hours   – "9-17" means 9am–5pm, optional per-city
   */
  async meetingPlanner(params = {}) {
    const raw    = params.cities || params.participants || 'New York,London,Mumbai,Tokyo';
    const cities = raw.split(',').map(s => s.trim());
    const [workStart, workEnd] = (params.work_hours || '9-18').split('-').map(Number);

    const now  = new Date();
    const slots = [];

    // Try every hour from 00:00 UTC
    for (let utcHour = 0; utcHour < 24; utcHour++) {
      const candidate = new Date(now);
      candidate.setUTCHours(utcHour, 0, 0, 0);

      const localHours = cities.map(city => {
        const tz = resolveTimezone(city);
        const h  = parseInt(new Intl.DateTimeFormat('en', { timeZone: tz, hour: 'numeric', hour12: false }).format(candidate));
        return { city, h };
      });

      const allInBusiness = localHours.every(({ h }) => h >= workStart && h < workEnd);
      if (allInBusiness) {
        slots.push({ utcHour, localHours });
      }
    }

    if (!slots.length) {
      return [
        `📅 *Meeting Planner*`,
        `Cities: ${cities.join(', ')}`,
        ``,
        `😔 No overlapping business hours found (${workStart}:00–${workEnd}:00 local each).`,
        `Consider async communication or a very early/late slot.`,
      ].join('\n');
    }

    const topSlots = slots.slice(0, 3);
    const slotLines = topSlots.map(slot => {
      const header = `🕐 *UTC ${String(slot.utcHour).padStart(2,'0')}:00*`;
      const cityLines = slot.localHours.map(({ city, h }) => {
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `  📍 ${city}: ${h12}:00 ${ampm}`;
      });
      return [header, ...cityLines].join('\n');
    });

    return [
      `📅 *Meeting Planner*`,
      `Participants: ${cities.join(' • ')}`,
      `Business hours: ${workStart}:00–${workEnd}:00 local`,
      ``,
      `✅ *Best time slots:*`,
      ``,
      slotLines.join('\n\n'),
    ].join('\n');
  }
}
