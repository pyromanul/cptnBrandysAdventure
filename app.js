(() => {
  "use strict";

  const FOUND_RADIUS_M = 3;
  const GPS_COURSE_MIN_DISTANCE_M = 4;
  const GPS_COURSE_MAX_AGE_MS = 12000;

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
    guidance: document.getElementById("guidance"),
    foundDistance: document.getElementById("foundDistance"),
    errorMessage: document.getElementById("errorMessage"),
  };

  const state = {
    target: null,
    position: null,
    previousPosition: null,
    deviceHeading: null,
    gpsCourse: null,
    gpsCourseUpdatedAt: 0,
    nativeCourse: null,
    nativeCourseUpdatedAt: 0,
    watchId: null,
    started: false,
    orientationEventName: null,
    smoothedHeading: null,
  };

  function parseTarget() {
    const params = new URLSearchParams(location.search);
    let lat = null;
    let lon = null;

    if (params.has("lat") && params.has("lon")) {
      lat = Number(params.get("lat"));
      lon = Number(params.get("lon"));
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const fragment = decodeURIComponent(location.hash.replace(/^#/, "").trim());
      const match = fragment.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (match) {
        lat = Number(match[1]);
        lon = Number(match[2]);
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return null;
    }
    return { lat, lon };
  }

  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }
  function normalize360(deg) { return (deg % 360 + 360) % 360; }
  function normalize180(deg) { return ((deg + 540) % 360) - 180; }

  function haversineMeters(a, b) {
    const R = 6371008.8;
    const phi1 = toRad(a.lat);
    const phi2 = toRad(b.lat);
    const dPhi = toRad(b.lat - a.lat);
    const dLambda = toRad(b.lon - a.lon);
    const h = Math.sin(dPhi / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

  function getScreenCorrectedHeading(event) {
    // iOS Safari exposes a compass heading that is already referenced to north.
    // Do NOT apply the screen-orientation correction to this value.
    if (Number.isFinite(event.webkitCompassHeading)) {
      return normalize360(event.webkitCompassHeading);
    }

    // For the standard API only accept absolute orientation data. Relative
    // deviceorientation alpha is not a compass heading and can be offset by 90°.
    if (event.absolute !== true || !Number.isFinite(event.alpha)) return null;

    // alpha increases counter-clockwise relative to north, while CSS rotation is
    // clockwise. Correct for portrait/landscape orientation exactly once.
    const screenAngle = Number(screen.orientation?.angle ?? window.orientation ?? 0);
    return normalize360(360 - event.alpha + screenAngle);
  }

  function smoothHeading(nextHeading) {
    if (state.smoothedHeading === null) {
      state.smoothedHeading = nextHeading;
      return nextHeading;
    }

    // Circular exponential smoothing. Using the shortest angular difference
    // avoids jumps at 0/360° (e.g. 359° -> 1°).
    const delta = normalize180(nextHeading - state.smoothedHeading);
    const SMOOTHING = 0.22;
    state.smoothedHeading = normalize360(state.smoothedHeading + delta * SMOOTHING);
    return state.smoothedHeading;
  }

  function onOrientation(event) {
    const heading = getScreenCorrectedHeading(event);
    if (heading === null) return;
    state.deviceHeading = smoothHeading(heading);
    updateDisplay();
  }

  function removeOrientationListener() {
    if (!state.orientationEventName) return;
    window.removeEventListener(state.orientationEventName, onOrientation, true);
    state.orientationEventName = null;
  }

  async function enableCompass() {
    try {
      if (typeof DeviceOrientationEvent !== "undefined" &&
          typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") throw new Error("Motion permission was not granted.");
      }

      removeOrientationListener();
      state.smoothedHeading = null;
      state.deviceHeading = null;

      // Never listen to both events simultaneously: on some Android devices
      // they report headings in different reference frames, producing a ~90°
      // flicker. Prefer the explicitly absolute event when the browser has it;
      // iOS uses deviceorientation + webkitCompassHeading instead.
      const eventName = ("ondeviceorientationabsolute" in window)
        ? "deviceorientationabsolute"
        : "deviceorientation";
      state.orientationEventName = eventName;
      window.addEventListener(eventName, onOrientation, true);
    } catch (err) {
      ui.status.textContent = "Compass unavailable; direction will use walking direction when possible.";
    }
  }

  function updateGpsCourse(newPos) {
    const prev = state.previousPosition;
    if (!prev) return;
    const moved = haversineMeters(prev, newPos);
    if (moved >= GPS_COURSE_MIN_DISTANCE_M) {
      state.gpsCourse = initialBearingDeg(prev, newPos);
      state.gpsCourseUpdatedAt = Date.now();
      state.previousPosition = newPos;
    }
  }

  function onPosition(position) {
    const next = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };

    if (Number.isFinite(position.coords.heading) && (position.coords.speed === null || position.coords.speed > 0.5)) {
      state.nativeCourse = normalize360(position.coords.heading);
      state.nativeCourseUpdatedAt = Date.now();
    }

    if (!state.previousPosition) state.previousPosition = next;
    updateGpsCourse(next);
    state.position = next;
    updateDisplay();
  }

  function onPositionError(error) {
    if (error.code === 1) {
      fail("Location permission was denied.");
      return;
    }
    // A GPS timeout or temporary loss of position is common outdoors and should
    // not terminate an already-running adventure.
    ui.status.textContent = error.code === 3
      ? "Waiting for a fresh GPS fix…"
      : "GPS signal temporarily unavailable…";
  }

  function bestHeading() {
    if (state.deviceHeading !== null) return { heading: state.deviceHeading, source: "compass" };
    if (state.nativeCourse !== null && Date.now() - state.nativeCourseUpdatedAt < GPS_COURSE_MAX_AGE_MS) {
      return { heading: state.nativeCourse, source: "movement" };
    }
    if (state.gpsCourse !== null && Date.now() - state.gpsCourseUpdatedAt < GPS_COURSE_MAX_AGE_MS) {
      return { heading: state.gpsCourse, source: "movement" };
    }
    return null;
  }

  function updateGuidance(distance) {
    if (!ui.guidance) return;
    if (distance <= 20) ui.guidance.textContent = "Almost there!";
    else if (distance <= 75) ui.guidance.textContent = "Getting close, Captain!";
    else ui.guidance.textContent = "Keep going, Captain!";
  }

  function updateDisplay() {
    if (!state.position || !state.target) return;

    const distance = haversineMeters(state.position, state.target);
    ui.distance.textContent = formatDistance(distance);
    updateGuidance(distance);

    if (distance <= FOUND_RADIUS_M) {
      ui.foundDistance.textContent = formatDistance(distance);
      showOnly(ui.foundScreen);
      return;
    }

    showOnly(ui.navScreen);
    const bearing = initialBearingDeg(state.position, state.target);
    const headingInfo = bestHeading();

    if (headingInfo) {
      const relative = normalize180(bearing - headingInfo.heading);
      ui.arrow.style.transform = `translate(-50%, -50%) rotate(${relative}deg)`;
      ui.status.textContent = headingInfo.source === "compass"
        ? `GPS accuracy ±${Math.round(state.position.accuracy)} m`
        : `Using walking direction · GPS accuracy ±${Math.round(state.position.accuracy)} m`;
    } else {
      ui.arrow.style.transform = "translate(-50%, -50%) rotate(0deg)";
      ui.status.textContent = "Move a few metres or enable the compass.";
    }
  }

  async function start() {
    if (!state.target || state.started) return;
    state.started = true;
    ui.startButton.disabled = true;
    if (!navigator.geolocation) {
      fail("This browser does not support geolocation.");
      return;
    }

    showOnly(ui.navScreen);
    ui.status.textContent = "Requesting permissions…";
    await enableCompass();

    state.watchId = navigator.geolocation.watchPosition(
      onPosition,
      onPositionError,
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000,
      }
    );
  }

  state.target = parseTarget();
  if (!state.target) {
    fail("No valid target coordinates were supplied. Use ?lat=47.123&lon=15.456 or #47.123,15.456.");
    return;
  }

  if (ui.targetSummary) ui.targetSummary.textContent = "Target loaded";
  ui.startButton.addEventListener("click", start);
  ui.recalibrateButton.addEventListener("click", enableCompass);

  window.addEventListener("pagehide", () => {
    if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
    removeOrientationListener();
  });
})();
