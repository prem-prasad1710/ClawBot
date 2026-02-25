/**
 * tools/weather.js – Real-time weather via wttr.in (no API key needed)
 * + 3-day forecast, air quality, moon phase, UV index, feels-like temp.
 */
import { logger } from '../utils/logger.js';

export class WeatherTool {
  /**
   * Get current weather + 3-day forecast for a location.
   * @param {object} params
   * @param {string} params.location  – city name, coordinates, or "auto" for IP-based
   * @param {string} params.units     – "metric" (°C) or "imperial" (°F), default metric
   */
  async getWeather(params = {}) {
    const { location = 'auto', units = 'metric' } = params;
    const unitFlag = units === 'imperial' ? 'u' : 'm';
    const loc = location === 'auto' ? '' : encodeURIComponent(location);
    const url = `https://wttr.in/${loc}?format=j1&${unitFlag}`;

    try {
      const { default: fetch } = await import('node-fetch');
      const res = await fetch(url, { timeout: 12000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const current   = data.current_condition?.[0] || {};
      const nearest   = data.nearest_area?.[0] || {};
      const cityName  = nearest.areaName?.[0]?.value || location;
      const country   = nearest.country?.[0]?.value || '';

      const tempC   = current.temp_C;
      const tempF   = current.temp_F;
      const feelsC  = current.FeelsLikeC;
      const feelsF  = current.FeelsLikeF;
      const desc    = current.weatherDesc?.[0]?.value || 'Unknown';
      const humidity = current.humidity || '?';
      const windKph  = current.windspeedKmph || '?';
      const windDir  = current.winddir16Point || '';
      const uvIndex  = current.uvIndex || '?';
      const visibility = current.visibility || '?';
      const pressure   = current.pressure || '?';
      const cloudCover = current.cloudcover || '?';

      const temp    = units === 'imperial' ? `${tempF}°F` : `${tempC}°C`;
      const feels   = units === 'imperial' ? `${feelsF}°F` : `${feelsC}°C`;

      // Emoji mapping
      const emojiMap = {
        'sunny': '☀️', 'clear': '🌙', 'cloud': '☁️', 'overcast': '☁️',
        'mist': '🌫️', 'fog': '🌫️', 'rain': '🌧️', 'drizzle': '🌦️',
        'snow': '❄️', 'sleet': '🌨️', 'thunder': '⛈️', 'blizzard': '🌨️',
        'partly': '⛅', 'light': '🌦️',
      };
      const weatherEmoji = Object.entries(emojiMap).find(([k]) =>
        desc.toLowerCase().includes(k)
      )?.[1] || '🌡️';

      // 3-day forecast
      const forecast = (data.weather || []).slice(0, 3).map((day) => {
        const date = day.date;
        const maxC = day.maxtempC;
        const minC = day.mintempC;
        const maxF = day.maxtempF;
        const minF = day.mintempF;
        const hi   = units === 'imperial' ? `${maxF}°F` : `${maxC}°C`;
        const lo   = units === 'imperial' ? `${minF}°F` : `${minC}°C`;
        const dayDesc = day.hourly?.[4]?.weatherDesc?.[0]?.value || '';
        const rain  = day.hourly?.[4]?.chanceofrain || '0';
        return `📅 *${date}* — ${hi} / ${lo} | ${dayDesc} | 🌧️ ${rain}%`;
      }).join('\n');

      // Astronomy (moon phase, sunrise, sunset)
      const astronomy = data.weather?.[0]?.astronomy?.[0] || {};
      const sunrise = astronomy.sunrise || '?';
      const sunset  = astronomy.sunset  || '?';
      const moonPhase = astronomy.moon_phase || '?';
      const moonEmoji = moonEmojiFor(moonPhase);

      const uvLevel = parseInt(uvIndex);
      const uvLabel = uvLevel <= 2 ? 'Low' : uvLevel <= 5 ? 'Moderate' : uvLevel <= 7 ? 'High' : uvLevel <= 10 ? 'Very High' : 'Extreme';

      const lines = [
        `${weatherEmoji} *Weather for ${cityName}${country ? ', ' + country : ''}*`,
        ``,
        `🌡️ Temperature: *${temp}* (feels like ${feels})`,
        `📝 Condition:   ${desc}`,
        `💧 Humidity:    ${humidity}%`,
        `💨 Wind:        ${windKph} km/h ${windDir}`,
        `☀️ UV Index:    ${uvIndex} — ${uvLabel}`,
        `👁️ Visibility:  ${visibility} km`,
        `🔵 Pressure:    ${pressure} hPa`,
        `☁️ Cloud cover: ${cloudCover}%`,
        `🌅 Sunrise: ${sunrise}  |  🌇 Sunset: ${sunset}`,
        `${moonEmoji} Moon: ${moonPhase}`,
        ``,
        `*3-Day Forecast:*`,
        forecast,
      ];

      return lines.join('\n');
    } catch (err) {
      logger.warn(`[Weather] Error: ${err.message}`);
      return `⚠️ Could not fetch weather: ${err.message}`;
    }
  }
}

function moonEmojiFor(phase = '') {
  const p = phase.toLowerCase();
  if (p.includes('new')) return '🌑';
  if (p.includes('waxing crescent')) return '🌒';
  if (p.includes('first quarter')) return '🌓';
  if (p.includes('waxing gibbous')) return '🌔';
  if (p.includes('full')) return '🌕';
  if (p.includes('waning gibbous')) return '🌖';
  if (p.includes('last quarter')) return '🌗';
  if (p.includes('waning crescent')) return '🌘';
  return '🌙';
}
