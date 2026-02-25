/**
 * tools/email.js
 * IMAP email reader + urgent-alert detector + email sender (nodemailer SMTP).
 *
 * Requires environment variables:
 *   EMAIL_IMAP_HOST   – e.g. imap.gmail.com
 *   EMAIL_IMAP_PORT   – default 993
 *   EMAIL_USER        – your email address
 *   EMAIL_PASS        – app-specific password (NOT your login password)
 *
 * For Gmail:  enable 2-Step Verification, then create an App Password at
 *   https://myaccount.google.com/apppasswords
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';

// Nodemailer is loaded lazily so the rest of the module works even without it
let _nodemailer = null;
async function getNodemailer() {
  if (!_nodemailer) {
    const mod = await import('nodemailer').catch(() => null);
    _nodemailer = mod?.default || mod;
  }
  return _nodemailer;
}

const URGENT_KEYWORDS = [
  'urgent', 'asap', 'critical', 'emergency', 'immediate', 'priority',
  'action required', 'action needed', 'important', 'deadline', 'overdue',
  'as soon as possible', 'time sensitive', 'time-sensitive', 'respond now',
];

export class EmailTool {
  constructor() {
    this.cfg = config.email?.imap || {};
  }

  get isConfigured() {
    return Boolean(this.cfg.auth?.user && this.cfg.auth?.pass);
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  /**
   * Read emails from the inbox.
   * @param {object} opts
   * @param {'unread'|'urgent'|'all'} opts.filter
   * @param {number} opts.limit      – max messages to return (default 15)
   * @param {number} opts.sinceDays  – only messages from the last N days (default 7)
   * @returns {Promise<string>} – formatted string summary of emails
   */
  async checkEmail({ filter = 'unread', limit = 15, sinceDays = 7 } = {}) {
    if (!this.isConfigured) {
      return '⚠️ Email not configured. Set EMAIL_IMAP_HOST, EMAIL_USER, and EMAIL_PASS in .env';
    }

    const client = this._buildClient();

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      let uids;
      try {
        const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

        if (filter === 'unread') {
          uids = await client.search({ unseen: true, since }, { uid: true });
        } else if (filter === 'urgent') {
          // Fetch recent + filter by keywords client-side
          uids = await client.search({ since }, { uid: true });
        } else {
          uids = await client.search({ since }, { uid: true });
        }

        if (!uids || uids.length === 0) {
          return filter === 'unread'
            ? '📭 No unread emails in the last ' + sinceDays + ' days.'
            : '📭 No emails found in the last ' + sinceDays + ' days.';
        }

        // Fetch most recent first (UIDs are ascending, so take last `limit`)
        const fetchUids = uids.slice(-limit).reverse();

        const emails = [];
        for await (const msg of client.fetch(fetchUids, {
          uid: true,
          flags: true,
          envelope: true,
          source: true,      // full RFC 2822 source for body preview
        }, { uid: true })) {
          try {
            const parsed = await simpleParser(msg.source);
            const from    = msg.envelope?.from?.[0];
            const subject = msg.envelope?.subject || '(no subject)';
            const date    = msg.envelope?.date || parsed.date;
            const body    = (parsed.text || parsed.html || '').slice(0, 300).replace(/\s+/g, ' ').trim();
            const unread  = !msg.flags?.has('\\Seen');

            const isUrgent = URGENT_KEYWORDS.some(
              (kw) =>
                subject.toLowerCase().includes(kw) ||
                body.toLowerCase().includes(kw)
            );

            if (filter === 'urgent' && !isUrgent) continue;

            emails.push({
              uid:     msg.uid,
              from:    from ? `${from.name || ''} <${from.address}>`.trim() : 'Unknown',
              subject,
              date:    date ? new Date(date).toLocaleString() : 'Unknown',
              unread,
              urgent:  isUrgent,
              preview: body,
            });
          } catch (parseErr) {
            logger.warn(`[Email] Failed to parse message: ${parseErr.message}`);
          }
        }

        return this._formatEmails(emails, filter);
      } finally {
        lock.release();
      }
    } catch (err) {
      logger.error(`[Email] checkEmail failed: ${err.message}`);
      throw new Error(`Email failed: ${err.message}`);
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }

  /**
   * Scan for urgent emails and return a short alert string.
   * Used by the background monitor.
   * @returns {Promise<{found: boolean, summary: string, emails: object[]}>}
   */
  async scanUrgent() {
    if (!this.isConfigured) return { found: false, summary: '', emails: [] };

    try {
      const raw = await this.checkEmail({ filter: 'urgent', limit: 20, sinceDays: 2 });
      const found = !raw.startsWith('📭');
      return { found, summary: raw, emails: [] };
    } catch (err) {
      logger.warn(`[Email] Urgent scan failed: ${err.message}`);
      return { found: false, summary: `Error: ${err.message}`, emails: [] };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Send Email (SMTP via nodemailer)
  // ─────────────────────────────────────────────────────────────

  /**
   * Send an email via SMTP (uses same credentials as IMAP by default).
   * @param {object} opts
   * @param {string} opts.to       – recipient address
   * @param {string} opts.subject  – email subject
   * @param {string} opts.body     – plain-text body
   * @param {string} [opts.cc]     – optional CC
   * @param {string} [opts.replyTo] – optional Reply-To
   * @returns {Promise<string>}
   */
  async sendEmail({ to, subject, body, cc, replyTo } = {}) {
    if (!this.isConfigured) {
      return '⚠️ Email not configured. Set EMAIL_USER and EMAIL_PASS in .env';
    }
    if (!to) return '⚠️ Please specify a recipient (to).';
    if (!subject) return '⚠️ Please provide a subject.';
    if (!body) return '⚠️ Please provide a message body.';

    const nodemailer = await getNodemailer();
    if (!nodemailer) {
      return '⚠️ nodemailer not installed. Run: npm install nodemailer';
    }

    const smtpCfg = config.email?.smtp || {};
    const transporter = nodemailer.createTransport({
      host:   smtpCfg.host   || this.cfg.host?.replace('imap.', 'smtp.') || 'smtp.gmail.com',
      port:   smtpCfg.port   || 587,
      secure: smtpCfg.secure || false,
      auth: {
        user: this.cfg.auth?.user || '',
        pass: this.cfg.auth?.pass || '',
      },
      tls: { rejectUnauthorized: false }, // Zscaler bypass
    });

    try {
      const info = await transporter.sendMail({
        from:    `"ClawBot" <${this.cfg.auth?.user}>`,
        to,
        cc:      cc || undefined,
        replyTo: replyTo || undefined,
        subject,
        text:    body,
      });
      logger.info(`[Email] Sent: ${info.messageId}`);
      return `✅ Email sent to *${to}*\nSubject: _${subject}_\nMessage ID: ${info.messageId}`;
    } catch (err) {
      logger.error(`[Email] sendEmail failed: ${err.message}`);
      return `⚠️ Failed to send email: ${err.message.slice(0, 150)}`;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Search Email
  // ─────────────────────────────────────────────────────────────

  /**
   * Search inbox by from address, subject keyword, or body text.
   * @param {object} opts
   * @param {string} [opts.from]    – filter by sender (partial match)
   * @param {string} [opts.subject] – filter by subject keyword
   * @param {string} [opts.query]   – generic search term (checks subject+body)
   * @param {number} [opts.limit]   – max results (default 10)
   * @param {number} [opts.sinceDays] – search window in days (default 14)
   * @returns {Promise<string>}
   */
  async searchEmail({ from, subject, query, limit = 10, sinceDays = 14 } = {}) {
    if (!this.isConfigured) {
      return '⚠️ Email not configured.';
    }
    if (!from && !subject && !query) {
      return '⚠️ Please provide at least one search term (from, subject, or query).';
    }

    const client = this._buildClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      let results = [];
      try {
        const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
        const uids = await client.search({ since }, { uid: true });
        if (!uids || !uids.length) return '📭 No emails found in that time range.';
        const fetchUids = uids.slice(-50).reverse(); // check last 50
        for await (const msg of client.fetch(fetchUids, {
          uid: true, envelope: true, source: true
        }, { uid: true })) {
          if (results.length >= limit) break;
          try {
            const parsed = await simpleParser(msg.source);
            const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
            const fromName = (msg.envelope?.from?.[0]?.name || '').toLowerCase();
            const subj = (msg.envelope?.subject || '').toLowerCase();
            const bodyText = (parsed.text || '').toLowerCase().slice(0, 500);

            const termFrom = from?.toLowerCase();
            const termSubj = subject?.toLowerCase();
            const termQ    = query?.toLowerCase();

            const matchFrom = !termFrom || fromAddr.includes(termFrom) || fromName.includes(termFrom);
            const matchSubj = !termSubj || subj.includes(termSubj);
            const matchQ    = !termQ    || subj.includes(termQ) || bodyText.includes(termQ);

            if (matchFrom && matchSubj && matchQ) {
              results.push({
                from:    `${msg.envelope?.from?.[0]?.name || ''} <${msg.envelope?.from?.[0]?.address || ''}>`.trim(),
                subject: msg.envelope?.subject || '(no subject)',
                date:    msg.envelope?.date ? new Date(msg.envelope.date).toLocaleString() : 'Unknown',
                preview: (parsed.text || '').slice(0, 200).replace(/\s+/g, ' ').trim(),
              });
            }
          } catch { /* skip parse errors */ }
        }
      } finally {
        lock.release();
      }

      if (!results.length) return `📭 No emails found matching your search.`;
      const header = `🔍 *Search Results* (${results.length})\n`;
      const lines = results.map(e =>
        `• *${e.subject}*\n  From: ${e.from}\n  Date: ${e.date}\n  > ${e.preview.slice(0, 150)}…`
      ).join('\n\n');
      return header + lines;
    } catch (err) {
      logger.error(`[Email] searchEmail failed: ${err.message}`);
      return `⚠️ Search failed: ${err.message.slice(0, 120)}`;
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Daily Email Summary (used by daily briefing)
  // ─────────────────────────────────────────────────────────────

  async getDailyEmailSummary() {
    if (!this.isConfigured) return '📬 *Email:* Not configured.';
    try {
      const unreadRaw = await this.checkEmail({ filter: 'unread', limit: 5, sinceDays: 1 });
      const urgentRaw = await this.checkEmail({ filter: 'urgent', limit: 3, sinceDays: 2 });
      const parts = [];
      if (!unreadRaw.startsWith('📭')) parts.push(`📬 *Recent Unread:*\n${unreadRaw}`);
      if (!urgentRaw.startsWith('✅') && !urgentRaw.startsWith('📭')) parts.push(`🚨 *Urgent:*\n${urgentRaw}`);
      if (!parts.length) return '📬 *Email:* Inbox is clear! No unread or urgent messages.';
      return parts.join('\n\n');
    } catch (err) {
      return `📬 *Email:* ${err.message.slice(0, 80)}`;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  _buildClient() {
    return new ImapFlow({
      host:   this.cfg.host   || 'imap.gmail.com',
      port:   this.cfg.port   || 993,
      secure: this.cfg.secure !== false,
      auth: {
        user: this.cfg.auth?.user || '',
        pass: this.cfg.auth?.pass || '',
      },
      logger: false,  // suppress noisy IMAP protocol logs
    });
  }

  _formatEmails(emails, filter) {
    if (!emails.length) {
      return filter === 'urgent'
        ? '✅ No urgent emails found. You\'re all clear!'
        : '📭 No matching emails found.';
    }

    const header = {
      unread: `📬 *Unread Emails* (${emails.length})`,
      urgent: `🚨 *Urgent Emails* (${emails.length})`,
      all:    `📧 *Recent Emails* (${emails.length})`,
    }[filter] || `📧 *Emails* (${emails.length})`;

    const lines = [header, ''];

    for (const e of emails) {
      const flags  = [e.unread ? '🔵' : '⚪', e.urgent ? '🚨' : ''].filter(Boolean).join(' ');
      lines.push(`${flags} *${e.subject}*`);
      lines.push(`  From: ${e.from}`);
      lines.push(`  Date: ${e.date}`);
      if (e.preview) lines.push(`  > ${e.preview.slice(0, 150)}…`);
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
