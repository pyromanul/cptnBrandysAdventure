(function (root) {
  'use strict';

  function validCoordinate(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  }

  function makePoint(lat, lon) {
    lat = Number(lat);
    lon = Number(lon);
    return validCoordinate(lat, lon) ? { lat, lon } : null;
  }

  function parseDecimalPair(text) {
    const clean = String(text).trim().replace(/[()\[\]]/g, '');
    let match = clean.match(/^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*[,;]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!match) {
      match = clean.match(/^\s*([+-]?\d{1,2}(?:\.\d+)?)\s+([+-]?\d{1,3}(?:\.\d+)?)\s*$/);
    }
    return match ? makePoint(match[1], match[2]) : null;
  }

  function dmsToDecimal(degrees, minutes, seconds, hemisphere) {
    const d = Number(degrees);
    const m = Number(minutes || 0);
    const s = Number(seconds || 0);
    if (![d, m, s].every(Number.isFinite) || m >= 60 || s >= 60) return null;
    let value = Math.abs(d) + m / 60 + s / 3600;
    const hemi = String(hemisphere || '').toUpperCase();
    if (hemi === 'S' || hemi === 'W' || d < 0) value *= -1;
    return value;
  }

  function parseDms(text) {
    const normalized = String(text)
      .trim()
      .toUpperCase()
      .replace(/[º˚]/g, '°')
      .replace(/[′’]/g, "'")
      .replace(/[″”]/g, '"');

    const part = /([+-]?\d{1,3}(?:\.\d+)?)\s*(?:°|D)?\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:'|M)?\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|S)?\s*)?([NSEW])/g;
    const values = [];
    let match;
    while ((match = part.exec(normalized)) !== null) {
      const decimal = dmsToDecimal(match[1], match[2], match[3], match[4]);
      if (decimal == null) return null;
      values.push({ value: decimal, hemi: match[4] });
    }
    if (values.length < 2) return null;

    const latitude = values.find(v => v.hemi === 'N' || v.hemi === 'S');
    const longitude = values.find(v => v.hemi === 'E' || v.hemi === 'W');
    if (!latitude || !longitude) return null;
    return makePoint(latitude.value, longitude.value);
  }

  function parseGoogleMapsUrl(text) {
    const raw = String(text).trim();
    if (!/^https?:\/\//i.test(raw)) return null;

    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (_) {}

    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (!host.includes('google.') && host !== 'maps.google.com') return null;

      // Explicit destination/query parameters are more reliable than the map viewport.
      for (const key of ['query', 'q', 'll', 'destination']) {
        const value = url.searchParams.get(key);
        if (!value) continue;
        const point = parseDecimalPair(value) || parseDms(value);
        if (point) return point;
      }
    } catch (_) {
      return null;
    }

    // Place/data URLs usually encode the exact selected point as !3dLAT!4dLON.
    let match = decoded.match(/!3d([+-]?\d{1,2}(?:\.\d+)?)[^!]*!4d([+-]?\d{1,3}(?:\.\d+)?)/);
    if (match) {
      const point = makePoint(match[1], match[2]);
      if (point) return point;
    }

    // Some links put literal coordinates in /place/LAT,LON.
    match = decoded.match(/\/place\/([+-]?\d{1,2}(?:\.\d+)?)[,\s]+([+-]?\d{1,3}(?:\.\d+)?)(?:\/|$)/i);
    if (match) {
      const point = makePoint(match[1], match[2]);
      if (point) return point;
    }

    // DMS coordinates can also be part of a /place/... path.
    const dmsPoint = parseDms(decoded);
    if (dmsPoint) return dmsPoint;

    // Fallback: /@LAT,LON is the map centre. It is commonly the target for dropped pins,
    // but for named places the exact !3d/!4d location above is preferred.
    match = decoded.match(/@([+-]?\d{1,2}(?:\.\d+)?),([+-]?\d{1,3}(?:\.\d+)?)(?:,|\/|$)/);
    if (match) {
      const point = makePoint(match[1], match[2]);
      if (point) return point;
    }

    return null;
  }

  function parseAny(text) {
    const raw = String(text || '').trim();
    if (!raw) return { point: null, reason: 'empty' };

    if (/^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(raw)) {
      return { point: null, reason: 'short-google-link' };
    }

    const point = parseGoogleMapsUrl(raw) || parseDecimalPair(raw) || parseDms(raw);
    return { point, reason: point ? null : 'unrecognized' };
  }

  const api = { validCoordinate, parseDecimalPair, parseDms, parseGoogleMapsUrl, parseAny };
  root.WaypointParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
