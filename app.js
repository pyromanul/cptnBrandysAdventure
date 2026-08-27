(() => {
  "use strict";

  const FOUND_RADIUS_M = 6;
  const GPS_COURSE_MIN_DISTANCE_M = 5;
  const GPS_COURSE_MAX_AGE_MS = 15000;
  const HEADING_SMOOTHING = 0.22;

  const ui = {
    startScreen: document.getElementById("startScreen"),
    navScreen: document.getElementById("navScreen"),
    foundScreen: document.getElementById("foundScreen"),
    errorScreen: document.getElementById("errorScreen"),
    targetSummary: document.getElementById("targetSummary"),
    startButton: document.getElementById("startButton"),
    recalibrateButton: document.getElementById("recalibrateButton"),
    arrow: document.getElementById("arrow"),
    distance: document.getElementById("distance"),
    status: document.getElementById("status"),
    foundDistance: document.getElementById("foundDistance"),
    errorMessage: document.getElementById("errorMessage"),
  };

  const state = {
    target: null,
    position: null,
    courseAnchor: null,
    deviceHeading: null,
    gpsCourse: null,
    gpsCourseUpdatedAt: 0,
    watchId: null,
    orientationListening: false,
    started: false,
  };

  function parseCoordinate(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function parseTarget() {
    const params = new URLSearchParams(location.search);
    let lat = parseCoordinate(params.get("lat"));
    let lon = parseCoordinate(params.get("lon"));

    if (lat === null || lon === null) {
      const fragment = decodeURIComponent(location.hash.replace(/^#/, "").trim());
      const match = fragment.match(/^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/);
      if (match) {
        lat = parseCoordinate(match[1]);
        lon = parseCoordinate(match[2]);
      }
    }

    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null;
    }
    return { lat, lon };
  }

  const toRad = deg => deg * Math.PI / 180;
  const toDeg = rad => rad * 180 / Math.PI;
  const normalize360 = deg => (deg % 360 + 360) % 360;
  const normalize180 = deg => ((deg + 540) % 360) - 180;

  function haversineMeters(a, b) {
    const R = 6371008.8;
    const phi1 = toRad(a.lat);
    const phi2 = toRad(b.lat);
    const dPhi = toRad(b.lat - a.lat);
    const dLambda = toRad(b.lon - a.lon);
    const h = Math.sin(dPhi / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    const clampedH = Math.min(1, Math.max(0, h));
    return 2 * R * Math.atan2(Math.sqrt(clampedH), Math.sqrt(1 - clampedH));
  }

  function initialBearingDeg(a, b) {
    const phi1 = toRad(a.lat);
    const phi2 = toRad(b.lat);
    const dLambda = toRad(b.lon - a.lon);
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    return normalize360(toDeg(Math.atan2(y, x)));
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    if (meters < 1000) return `${Math.round(meters)} m`;
    if (meters < 10000) return `${(meters / 1000).toFixed(2)} km`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  function showOnly(screen) {
    [ui.startScreen, ui.navScreen, ui.foundScreen, ui.errorScreen].forEach(el => el.classList.add("hidden"));
    screen.classList.remove("hidden");
  }

  function fail(message) {
    ui.errorMessage.textContent = message;
    showOnly(ui.errorScreen);
  }

  function screenAngle() {
    if (screen.orientation && Number.isFinite(screen.orientation.angle)) return screen.orientation.angle;
    if (Number.isFinite(window.orientation)) return window.orientation;
    return 0;
  }

  function getScreenCorrectedHeading(event) {
    if (Number.isFinite(event.webkitCompassHeading)) {
      if (Number.isFinite(event.webkitCompassAccuracy) && event.webkitCompassAccuracy < 0) return null;
      return normalize360(event.webkitCompassHeading);
    }

    // For non-iOS browsers, only trust alpha as a compass heading when the
    // orientation is explicitly absolute (or from deviceorientationabsolute).
    if (Number.isFinite(event.alpha) && (event.absolute === true || event.type === "deviceorientationabsolute")) {
      return normalize360(360 - event.alpha + screenAngle());
    }
    return null;
  }

  function smoothHeading(previous, next) {
    if (previous === null) return next;
    return normalize360(previous + normalize180(next - previous) * HEADING_SMOOTHING);
  }

  function onOrientation(event) {
    const heading = getScreenCorrectedHeading(event);
    if (heading !== null) {
      state.deviceHeading = smoothHeading(state.deviceHeading, heading);
      updateDisplay();
    }
  }

  function attachOrientationListeners() {
    if (state.orientationListening) return;
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    state.orientationListening = true;
  }

  async function enableCompass() {
    if (typeof DeviceOrientationEvent === "undefined") {
      ui.status.textContent = "Compass unavailable; walk a few metres to establish direction.";
      return false;
    }

    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") {
          ui.status.textContent = "Compass permission denied; walk a few metres to establish direction.";
          return false;
        }
      }
      attachOrientationListeners();
      return true;
    } catch {
      ui.status.textContent = "Compass unavailable; walk a few metres to establish direction.";
      return false;
    }
  }

  function updateGpsCourse(newPos, nativeHeading) {
    if (Number.isFinite(nativeHeading) && nativeHeading >= 0 && nativeHeading <= 360) {
      state.gpsCourse = normalize360(nativeHeading);
      state.gpsCourseUpdatedAt = Date.now();
      state.courseAnchor = newPos;
      return;
    }

    if (!state.courseAnchor) {
      state.courseAnchor = newPos;
      return;
    }

    const moved = haversineMeters(state.courseAnchor, newPos);
    if (moved >= GPS_COURSE_MIN_DISTANCE_M) {
      state.gpsCourse = initialBearingDeg(state.courseAnchor, newPos);
      state.gpsCourseUpdatedAt = Date.now();
      state.courseAnchor = newPos;
    }
  }

  function onPosition(position) {
    const next = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    };

    updateGpsCourse(next, position.coords.heading);
    state.position = next;
    updateDisplay();
  }

  function onPositionError(error) {
    if (error.code === 1) {
      fail("Location permission was denied. Allow location access in your browser settings and reload the page.");
      stopWatching();
      return;
    }

    // POSITION_UNAVAILABLE and TIMEOUT are often transient outdoors/indoors.
    showOnly(ui.navScreen);
    ui.status.textContent = error.code === 3
      ? "Still waiting for a GPS fix…"
      : "Position temporarily unavailable…";
  }

  function bestHeading() {
    if (state.deviceHeading !== null) return { heading: state.deviceHeading, source: "compass" };
    if (state.gpsCourse !== null && Date.now() - state.gpsCourseUpdatedAt < GPS_COURSE_MAX_AGE_MS) {
      return { heading: state.gpsCourse, source: "movement" };
    }
    return null;
  }

  function updateDisplay() {
    if (!state.position || !state.target) return;

    const distance = haversineMeters(state.position, state.target);
    ui.distance.textContent = formatDistance(distance);

    if (distance <= FOUND_RADIUS_M) {
      ui.foundDistance.textContent = formatDistance(distance);
      showOnly(ui.foundScreen);
      return;
    }

    showOnly(ui.navScreen);
    const bearing = initialBearingDeg(state.position, state.target);
    const headingInfo = bestHeading();
    const accuracyText = state.position.accuracy === null ? "" : ` · GPS ±${Math.round(state.position.accuracy)} m`;

    if (headingInfo) {
      const relative = normalize180(bearing - headingInfo.heading);
      ui.arrow.style.transform = `rotate(${relative}deg)`;
      ui.arrow.classList.remove("inactive");
      ui.status.textContent = headingInfo.source === "compass"
        ? `Compass active${accuracyText}`
        : `Using walking direction${accuracyText}`;
    } else {
      ui.arrow.style.transform = "rotate(0deg)";
      ui.arrow.classList.add("inactive");
      ui.status.textContent = `Move a few metres or enable the compass${accuracyText}`;
    }
  }

  function stopWatching() {
    if (state.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  async function start() {
    if (!state.target || state.started) return;
    if (!navigator.geolocation) {
      fail("This browser does not support geolocation.");
      return;
    }

    state.started = true;
    ui.startButton.disabled = true;
    showOnly(ui.navScreen);
    ui.status.textContent = "Requesting permissions…";

    // iOS requires the motion permission request to originate from this tap.
    await enableCompass();

    state.watchId = navigator.geolocation.watchPosition(
      onPosition,
      onPositionError,
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 20000,
      }
    );
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.started) updateDisplay();
  });
  window.addEventListener("pagehide", stopWatching);

  state.target = parseTarget();
  if (!state.target) {
    fail("No valid target coordinates were supplied. Use ?lat=47.123&lon=15.456 or #47.123,15.456.");
    return;
  }

  ui.targetSummary.textContent = "Target loaded";
  ui.startButton.addEventListener("click", start);
  ui.recalibrateButton.addEventListener("click", enableCompass);
})();
