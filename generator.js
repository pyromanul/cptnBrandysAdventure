'use strict';

const $ = (id) => document.getElementById(id);
const baseInput = $('base');
const sourceInput = $('source');
const latInput = $('lat');
const lonInput = $('lon');
const result = $('result');
const message = $('message');
const useLocationButton = $('useLocation');
const parseButton = $('parse');
const makeButton = $('make');
const copyButton = $('copy');
const openButton = $('openTarget');

function defaultBaseUrl() {
  const url = new URL('index.html', window.location.href);
  url.hash = '';
  url.search = '';
  return url.href;
}

baseInput.value = defaultBaseUrl();

function showMessage(text, kind = '') {
  message.textContent = text;
  message.dataset.kind = kind;
}

function setCoordinates(point, sourceLabel) {
  latInput.value = point.lat.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
  lonInput.value = point.lon.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
  showMessage(`Target set${sourceLabel ? ` from ${sourceLabel}` : ''}.`, 'ok');
  generateLink();
}

function readManualCoordinates() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  return WaypointParser.validCoordinate(lat, lon) ? { lat, lon } : null;
}

function normalizeBase(value) {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch (_) {
    return null;
  }
}

function generateLink() {
  const base = normalizeBase(baseInput.value);
  const point = readManualCoordinates();
  if (!base || !point) {
    result.textContent = '—';
    copyButton.disabled = true;
    openButton.hidden = true;
    return null;
  }

  const url = `${base}#${point.lat},${point.lon}`;
  result.textContent = url;
  copyButton.disabled = false;
  openButton.href = url;
  openButton.hidden = false;
  return url;
}

parseButton.addEventListener('click', () => {
  const parsed = WaypointParser.parseAny(sourceInput.value);
  if (parsed.point) {
    setCoordinates(parsed.point, 'pasted location');
    return;
  }
  if (parsed.reason === 'short-google-link') {
    showMessage('Google Maps short links (maps.app.goo.gl) hide the coordinates. Open the link first, then copy the full browser URL, or paste coordinates directly.', 'error');
    return;
  }
  showMessage('Could not find coordinates. Try decimal coordinates, DMS (e.g. 47°04\'14.5"N 15°26\'22.2"E), or a full Google Maps URL.', 'error');
});

useLocationButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showMessage('This browser does not provide geolocation.', 'error');
    return;
  }

  useLocationButton.disabled = true;
  showMessage('Getting current location…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      useLocationButton.disabled = false;
      const point = { lat: position.coords.latitude, lon: position.coords.longitude };
      setCoordinates(point, `current location (±${Math.round(position.coords.accuracy)} m)`);
    },
    (error) => {
      useLocationButton.disabled = false;
      const messages = {
        1: 'Location permission was denied.',
        2: 'Current location is unavailable.',
        3: 'Getting the current location timed out.'
      };
      showMessage(messages[error.code] || 'Could not get the current location.', 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
});

makeButton.addEventListener('click', () => {
  const url = generateLink();
  showMessage(url ? 'Waypoint link ready.' : 'Enter a valid base URL and coordinates.', url ? 'ok' : 'error');
});

[baseInput, latInput, lonInput].forEach(input => input.addEventListener('input', generateLink));

copyButton.addEventListener('click', async () => {
  const url = generateLink();
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showMessage('Link copied to clipboard.', 'ok');
  } catch (_) {
    showMessage('Automatic copy is unavailable. Select and copy the link manually.', 'error');
  }
});

generateLink();
