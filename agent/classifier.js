/**
 * agent/classifier.js
 * Fast intent classifier – determines what the user actually wants
 * without running a full Ollama round-trip for every message.
 *
 * Intents (ordered by priority):
 *   conversational  – greetings, thanks, small talk
 *   email           – anything to do with inbox / mail
 *   report          – generate document, report, summary
 *   brainstorm      – ideas, suggestions, what-if
 *   question        – factual/explanatory queries
 *   task            – build, create, fix, run, deploy …
 */

import { logger } from '../utils/logger.js';

export const INTENT = {
  CONVERSATIONAL: 'conversational',
  EMAIL:          'email',
  REPORT:         'report',
  BRAINSTORM:     'brainstorm',
  QUESTION:       'question',
  TASK:           'task',
};

const RULES = [
  // ── Task override: catch action-intent phrases that syntactically look like
  //    questions ("Can you…", "Could you…", "Can you work on…") but are tasks.
  //    Must be placed BEFORE the QUESTION block to take priority.
  { intent: INTENT.TASK, patterns: [
    /\b(work\s+on|work\s+with|look\s+at|check\s+out|dive\s+into|jump\s+into|help\s+me\s+(with|build|fix|on))\b/i,
    /\b(can\s+you|could\s+you|please|go\s+and)\s+(work|build|fix|create|implement|add|update|refactor|deploy|clone|check|review|analyse|analyze)\b/i,
    /\b(my|the)\s+(project|repo|codebase|code|app|application|website|api|backend|frontend|service)\b/i,
    /\b(add\s+(a\s+)?(feature|functionality|endpoint|page|component|route|test)|implement|integrate|connect|wire\s+up)\b/i,
    /\b(go\s+(and|check|look)|take\s+a\s+look|have\s+a\s+look|look\s+at)\b/i,
    /\b(repo\s+guardian|guard\s+my\s+repo|shipping\s+plan|goal\s*(to|->)\s*shipping|autonomous\s+qa|reproduce\s+bug)\b/i,
    // Reminder / notification tasks — always actionable
    /\b(set|create|add|make|schedule|put)\s+(a\s+)?(reminder|alert|alarm|notification|notify|ping)\b/i,
    /\b(remind\s+me|alert\s+me|notify\s+me|ping\s+me)\b/i,
    /\b(remind(er)?|alarm|schedule)\b.*\b(at|for|in|by)\s+\d/i,
  ]},

  // ── Conversational ─────────────────────────────────────────────────────────
  { intent: INTENT.CONVERSATIONAL, patterns: [
    // Typo-tolerant: "hi", "hii", "hiii", "hey", "heyyy", "heyy", "hello" etc.
    /^h+[iey]+[!\s.]*$/i,
    /^(howdy|yo+|sup+|hiya|hola)\s*[!.]*$/i,
    /^(hi|hey|hello|howdy|yo|sup|hiya)(\s|!|\.|$)/i,
    /^(good\s)?(morning|afternoon|evening|night)(\s|!|\.|$)/i,
    /^(thanks?(\s+a\s+lot)?|thank you|cheers|thx|ty)(\s|!|\.|$)/i,
    /^(bye|goodbye|see ya|cya|later)(\s|!|\.|$)/i,
    /^how are you(\s|!|\?|$)/i,
    /^what('s| is) (your name|up|good)(\?|$)/i,
    /^(who are you|what are you|what can you do)(\?|$)/i,
  ]},

  // ── Email ─────────────────────────────────────────────────────────────────
  { intent: INTENT.EMAIL, patterns: [
    /\b(check|read|open|show|fetch|scan|monitor|look at)\s+(my\s+)?(emails?|inbox|mails?|messages?)\b/i,
    /\b(any\s+(new|unread|urgent)?\s*(emails?|mails?|messages?))\b/i,
    /\b(email|inbox|unread\s+mail|new\s+mail)\b/i,
    /\b(urgent|important)\s+(emails?|messages?|mails?)\b/i,
    /\bping\s+me\b.*\b(email|mail|inbox)\b/i,
    /\b(email|mail)\b.*\b(check|monitor|alert|notify)\b/i,
  ]},

  // ── Report / Document generation ──────────────────────────────────────────
  { intent: INTENT.REPORT, patterns: [
    /\b(generate|create|write|make|produce|draft|prepare)\s+(a\s+)?(report|document|doc|summary|brief|briefing|write[\s-]?up|analysis|overview|breakdown|memo|minutes)\b/i,
    /\b(report|brief|white\s*paper|case\s+study|documentation|write[\s-]?up|executive\s+summary)\b/i,
    /\b(summarize|summarise)\s+(this|the|my|our)\b/i,
  ]},

  // ── Brainstorm ────────────────────────────────────────────────────────────
  { intent: INTENT.BRAINSTORM, patterns: [
    /\b(brainstorm|brain\s*storm)\b/i,
    /\bideas?\s+(for|about|on|regarding)\b/i,
    /\b(suggest|give me|come up with|think of|what\s+are\s+some)\s+(ideas?|options?|ways?|approaches?|alternatives?)\b/i,
    /\bhow\s+(can|could|should|would)\s+i\s+(improve|make|do|handle|solve|approach)\b/i,
    /\bwhat\s+(are|would be)\s+(the\s+)?(best|good|possible)\s+(ways?|options?|approaches?)\b/i,
  ]},

  // ── Question / informational ──────────────────────────────────────────────
  { intent: INTENT.QUESTION, patterns: [
    /^(what|who|where|when|why|which|whose|whom)\s/i,
    /^(how\s+(?:does|do|did|is|are|was|were|can|could|would|should|to))\s/i,
    /^(is|are|was|were|does|do|can|could|will|would|should|has|have|had)\s/i,
    /^(explain|describe|tell me about|what is|what are|what does)\b/i,
    /\?\s*$/, // ends with ?
    /\b(definition|meaning|what does .+ mean|difference between)\b/i,
    /\b(weather|temperature|news|price|exchange rate|translate|convert)\b/i,
  ]},

  // ── Task (dev/system/action – catch-all for anything actionable) ──────────
  { intent: INTENT.TASK, patterns: [
    /\b(build|create|code|fix|debug|install|deploy|write|implement|refactor|generate|make|develop|clone|push|pull|run|execute|setup|configure|update|upgrade|delete|remove|move|rename|start|stop|restart|automate|script|test|lint|format|compile|migrate|seed|backup|scaffold|init|bootstrap|launch|publish)\b/i,
    /\b(open|show|display|print|calculate|convert|send|download|upload)\b/i,
    /\b(remind|reminder|schedule|alarm|notify|notification|alert)\b/i,
  ]},
];

export class IntentClassifier {
  /**
   * Classify the intent of a raw user message.
   * Returns one of the INTENT constants.
   */
  classify(text) {
    if (!text || typeof text !== 'string') return INTENT.TASK;
    const trimmed = text.trim();

    // Safety net: very short messages (≤ 20 chars, ≤ 4 words) with no action
    // keywords are almost always greetings/chit-chat – never coding tasks.
    if (this._isShortChitChat(trimmed)) {
      logger.debug(`[Classifier] "${trimmed}" → conversational (short-chitchat guard)`);
      return INTENT.CONVERSATIONAL;
    }

    for (const { intent, patterns } of RULES) {
      if (patterns.some((p) => p.test(trimmed))) {
        logger.debug(`[Classifier] "${trimmed.slice(0, 60)}" → ${intent}`);
        return intent;
      }
    }

    logger.debug(`[Classifier] "${trimmed.slice(0, 60)}" → task (default)`);
    return INTENT.TASK;
  }

  /**
   * True for short messages with no action/dev keywords.
   * Catches typos like "Hii", "Heyy", "Yo!", single-word expressions.
   */
  _isShortChitChat(text) {
    if (text.length > 35) return false;
    const words = text.trim().split(/\s+/);
    if (words.length > 5) return false;
    const ACTION_WORDS = [
      'build','create','fix','run','make','write','install','deploy','check',
      'generate','search','find','show','open','delete','update','start','stop',
      'email','report','code','debug','test','push','pull','clone','fetch',
      'translate','zip','unzip','compress','extract','ping','screenshot',
      'notes','clipboard','spotify','pdf','contacts','sysinfo','network',
      // natural-language triggers for new tools
      'ip','playing','music','song','track','volume','wifi','disk','cpu',
      'ram','memory','battery','processes','system','clipboard',
      'guardian','shipping','milestone','backlog','qa','bug','reproduce',
    ];
    const lower = text.toLowerCase();
    return !ACTION_WORDS.some((w) => lower.includes(w));
  }

  /** Human-readable label for logging */
  label(text) {
    return this.classify(text);
  }
}
