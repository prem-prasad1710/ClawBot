/**
 * tools/calculator.js
 * Safe math expression evaluator + unit converter.
 * No eval() — uses a recursive descent parser for security.
 */

import { logger } from '../utils/logger.js';

// ── Unit conversion table ────────────────────────────────────────────────────
const UNIT_CONVERSIONS = {
  // Length
  km_to_miles:  v => v * 0.621371,
  miles_to_km:  v => v * 1.60934,
  m_to_ft:      v => v * 3.28084,
  ft_to_m:      v => v / 3.28084,
  cm_to_in:     v => v / 2.54,
  in_to_cm:     v => v * 2.54,
  m_to_yards:   v => v * 1.09361,
  yards_to_m:   v => v / 1.09361,
  // Weight
  kg_to_lbs:    v => v * 2.20462,
  lbs_to_kg:    v => v / 2.20462,
  g_to_oz:      v => v / 28.3495,
  oz_to_g:      v => v * 28.3495,
  // Temperature
  c_to_f:       v => v * 9/5 + 32,
  f_to_c:       v => (v - 32) * 5/9,
  c_to_k:       v => v + 273.15,
  k_to_c:       v => v - 273.15,
  // Area
  sqm_to_sqft:  v => v * 10.7639,
  sqft_to_sqm:  v => v / 10.7639,
  // Volume
  l_to_gal:     v => v * 0.264172,
  gal_to_l:     v => v / 0.264172,
  ml_to_floz:   v => v * 0.033814,
  // Speed
  kmh_to_mph:   v => v * 0.621371,
  mph_to_kmh:   v => v / 0.621371,
  // Data
  gb_to_mb:     v => v * 1024,
  mb_to_gb:     v => v / 1024,
  tb_to_gb:     v => v * 1024,
  gb_to_tb:     v => v / 1024,
  // Time
  hours_to_min: v => v * 60,
  min_to_hours: v => v / 60,
  days_to_hours:v => v * 24,
  hours_to_days:v => v / 24,
};

export class Calculator {
  /**
   * Main entry: evaluate an expression and/or convert units.
   * @param {object} params - { expression, unit_from, unit_to }
   */
  calculate(params) {
    const { expression, unit_from, unit_to } = params;

    try {
      let result = '';

      // Math expression
      if (expression) {
        const value = this._evaluate(expression);
        const formatted = this._format(value);
        result = `${expression} = ${formatted}`;
        logger.info(`[Calculator] ${result}`);
      }

      // Unit conversion
      if (unit_from && unit_to) {
        const base = expression ? this._evaluate(expression) : 1;
        const key = `${unit_from.toLowerCase()}_to_${unit_to.toLowerCase()}`;
        const fn = UNIT_CONVERSIONS[key];
        if (fn) {
          const converted = fn(base);
          const convStr = `${this._format(base)} ${unit_from} = ${this._format(converted)} ${unit_to}`;
          result = result ? `${result}\nConversion: ${convStr}` : `Conversion: ${convStr}`;
          logger.info(`[Calculator] ${convStr}`);
        } else {
          result += `\nNote: No conversion found for ${unit_from} → ${unit_to}`;
        }
      }

      return result || 'No expression or conversion provided.';
    } catch (err) {
      return `Calculation error: ${err.message}`;
    }
  }

  // ── Parser ───────────────────────────────────────

  _evaluate(expr) {
    // Pre-process: normalise common math notation
    const normalised = expr
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/\^/g, '**')
      .replace(/√(\d+(\.\d+)?)/g, 'sqrt($1)')
      .replace(/√\(([^)]+)\)/g, 'sqrt($1)')
      .toLowerCase()
      .replace(/\bpi\b/g, String(Math.PI))
      .replace(/\be\b/g, String(Math.E))
      .replace(/,/g, ''); // remove thousands separators

    return this._parseExpr(normalised.trim());
  }

  _parseExpr(expr) {
    return this._parseAddSub(expr.trim());
  }

  _parseAddSub(expr) {
    // Find the last + or - NOT inside parentheses
    let depth = 0;
    for (let i = expr.length - 1; i >= 0; i--) {
      const c = expr[i];
      if (c === ')') depth++;
      if (c === '(') depth--;
      if (depth === 0 && (c === '+' || c === '-') && i > 0) {
        const left  = this._parseMulDiv(expr.slice(0, i));
        const right = this._parseAddSub(expr.slice(i + 1));
        return c === '+' ? left + right : left - right;
      }
    }
    return this._parseMulDiv(expr);
  }

  _parseMulDiv(expr) {
    let depth = 0;
    for (let i = expr.length - 1; i >= 0; i--) {
      const c = expr[i];
      if (c === ')') depth++;
      if (c === '(') depth--;
      if (depth === 0 && (c === '*' || c === '/' || c === '%')) {
        // Handle ** (power) — treat as right-associative, higher precedence
        if (c === '*' && expr[i - 1] === '*') continue;
        if (c === '*' && expr[i + 1] === '*') continue;
        const left  = this._parsePower(expr.slice(0, i));
        const right = this._parseMulDiv(expr.slice(i + 1));
        if (c === '*') return left * right;
        if (c === '/') return left / right;
        if (c === '%') return left % right;
      }
    }
    return this._parsePower(expr);
  }

  _parsePower(expr) {
    const idx = expr.lastIndexOf('**');
    if (idx > 0) {
      const base = this._parseUnary(expr.slice(0, idx));
      const exp  = this._parsePower(expr.slice(idx + 2));
      return Math.pow(base, exp);
    }
    return this._parseUnary(expr);
  }

  _parseUnary(expr) {
    expr = expr.trim();
    if (expr.startsWith('-')) return -this._parseAtom(expr.slice(1));
    if (expr.startsWith('+')) return  this._parseAtom(expr.slice(1));
    return this._parseAtom(expr);
  }

  _parseAtom(expr) {
    expr = expr.trim();

    // Parentheses
    if (expr.startsWith('(') && expr.endsWith(')')) {
      return this._parseExpr(expr.slice(1, -1));
    }

    // Math functions
    const fnMatch = expr.match(/^(sqrt|abs|ceil|floor|round|log|log2|log10|sin|cos|tan|asin|acos|atan|exp|cbrt|sign)\((.+)\)$/);
    if (fnMatch) {
      const fn  = fnMatch[1];
      const arg = this._parseExpr(fnMatch[2]);
      if (typeof Math[fn] === 'function') return Math[fn](arg);
    }

    // Number
    const num = parseFloat(expr);
    if (!isNaN(num)) return num;

    throw new Error(`Cannot parse: "${expr}"`);
  }

  _format(value) {
    if (!isFinite(value)) return String(value);
    // Use compact notation for very large/small numbers
    if (Math.abs(value) >= 1e15 || (Math.abs(value) < 1e-6 && value !== 0)) {
      return value.toExponential(6);
    }
    // Strip trailing zeros after decimal
    const s = parseFloat(value.toFixed(10)).toString();
    return s;
  }
}
