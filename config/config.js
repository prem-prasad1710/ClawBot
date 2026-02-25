import dotenv from 'dotenv';
dotenv.config();

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUsers: (process.env.ALLOWED_USER_IDS || '')
      .split(',')
      .map((id) => parseInt(id.trim()))
      .filter(Boolean),
    // Optional: set to a Cloudflare Worker URL to bypass corporate firewalls
    apiBaseUrl: process.env.TELEGRAM_API_BASE_URL || '',
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'deepseek-coder',
    timeout: parseInt(process.env.OLLAMA_TIMEOUT || '120000'),
    options: {
      temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.3'),
      num_ctx: parseInt(process.env.OLLAMA_CTX || '16384'), // larger context for history + big prompts
      top_p: 0.9,
    },
  },
  agent: {
    workspaceDir: process.env.WORKSPACE_DIR || `${process.env.HOME}/clawbot-workspace`,
    maxSteps: parseInt(process.env.MAX_STEPS || '30'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    stepTimeoutMs: parseInt(process.env.STEP_TIMEOUT_MS || '60000'),
  },
  search: {
    // Uses DuckDuckGo HTML scraping – no API key required
    engine: 'duckduckgo',
    maxResults: parseInt(process.env.SEARCH_MAX_RESULTS || '5'),
  },
  github: {
    token: process.env.GITHUB_TOKEN || '',
    defaultBranch: process.env.GITHUB_DEFAULT_BRANCH || 'main',
  },
  email: {
    imap: {
      host:   process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
      port:   parseInt(process.env.EMAIL_IMAP_PORT || '993'),
      secure: process.env.EMAIL_IMAP_SECURE !== 'false',
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || '',
      },
    },
    monitoring: {
      enabled:         process.env.EMAIL_MONITOR_ENABLED === 'true',
      intervalMinutes: parseInt(process.env.EMAIL_MONITOR_INTERVAL_MINUTES || '15'),
    },
  },
  logging: {
    dir: process.env.LOG_DIR || './logs',
    level: process.env.LOG_LEVEL || 'info',
  },
  dangerousCommandPatterns: [
    /rm\s+-rf\s+\/(?!\w)/,
    /mkfs/,
    /format\s+[a-z]:/i,
    /shutdown/,
    /reboot/,
    /halt/,
    /dd\s+if=.*of=\/dev\/(sd|hd|nvme)/,
    /:w!?\s*!.*rm/,
    />\s*\/dev\/(sd|hd|nvme)/,
    /chmod\s+-R\s+777\s+\//,
    /chown\s+-R.*\//,
  ],
};
