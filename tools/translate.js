/**
 * tools/translate.js
 * Translate text using the free MyMemory API (no key needed, 10k chars/day).
 * Also supports language detection.
 */

import axios from 'axios';

// Common language codes for the brain's reference
export const LANG_CODES = {
  english:    'en', spanish:    'es', french:     'fr',
  german:     'de', italian:    'it', portuguese: 'pt',
  russian:    'ru', japanese:   'ja', korean:     'ko',
  chinese:    'zh', arabic:     'ar', hindi:      'hi',
  dutch:      'nl', polish:     'pl', turkish:    'tr',
  swedish:    'sv', norwegian:  'no', danish:     'da',
  greek:      'el', hebrew:     'he', thai:       'th',
  vietnamese: 'vi', indonesian: 'id', malay:      'ms',
};

export class Translator {
  /**
   * Translate text to a target language.
   * @param {string} text        - Text to translate
   * @param {string} targetLang  - Target language code (e.g. 'es', 'fr', 'ja')
   * @param {string} sourceLang  - Source language code or 'auto' (default)
   */
  async translate(text, targetLang = 'en', sourceLang = 'auto') {
    if (!text || !text.trim()) return 'ERROR: No text provided.';

    // Normalize language names to codes
    const target = LANG_CODES[targetLang.toLowerCase()] || targetLang;
    const source = sourceLang === 'auto' ? 'auto' : (LANG_CODES[sourceLang.toLowerCase()] || sourceLang);

    const langPair = source === 'auto' ? `autodetect|${target}` : `${source}|${target}`;

    try {
      const resp = await axios.get('https://api.mymemory.translated.net/get', {
        params: {
          q:        text.slice(0, 2000), // API limit
          langpair: langPair,
          de:       'clawbot@example.com', // improves rate limit
        },
        timeout: 12000,
      });

      const data = resp.data;

      if (data.responseStatus === 200) {
        const translated = data.responseData?.translatedText || '';
        const detectedLang = data.responseData?.detectedLanguage || source;
        const flagTo = this._langFlag(target);
        const flagFrom = detectedLang !== 'auto' ? this._langFlag(detectedLang) : '🔤';
        return (
          `🌍 Translation ${flagFrom} → ${flagTo}\n` +
          `────────────────────────────────\n` +
          `${translated}\n` +
          `\n_Detected source: ${detectedLang} → ${target}_`
        );
      }

      // Quota exceeded
      if (data.responseStatus === 429 || String(data.responseMessage).includes('QUOTA')) {
        return 'Translation quota exceeded for today. Try again tomorrow or use the search tool for quick translations.';
      }

      return `Translation failed: ${data.responseMessage}`;
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT') {
        return `Translation service unreachable. Check internet connection.`;
      }
      return `Translation error: ${e.message}`;
    }
  }

  /**
   * List supported languages.
   */
  languages() {
    const entries = Object.entries(LANG_CODES)
      .map(([name, code]) => `  ${code.padEnd(4)} — ${name}`)
      .join('\n');
    return `🌐 Supported languages:\n${entries}`;
  }

  _langFlag(code) {
    const flags = {
      en:'🇬🇧', es:'🇪🇸', fr:'🇫🇷', de:'🇩🇪', it:'🇮🇹', pt:'🇧🇷',
      ru:'🇷🇺', ja:'🇯🇵', ko:'🇰🇷', zh:'🇨🇳', ar:'🇸🇦', hi:'🇮🇳',
      nl:'🇳🇱', pl:'🇵🇱', tr:'🇹🇷', sv:'🇸🇪', no:'🇳🇴', da:'🇩🇰',
      el:'🇬🇷', he:'🇮🇱', th:'🇹🇭', vi:'🇻🇳', id:'🇮🇩', ms:'🇲🇾',
    };
    return flags[code] || '🌐';
  }
}
