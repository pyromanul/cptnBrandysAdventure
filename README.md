# QR Compass Game

Minimal browser-based waypoint navigator for an outdoor game.

A QR code opens the page with a target coordinate encoded in the URL. The page then shows only:

- an arrow pointing toward the target,
- the remaining distance,
- a simple "Found it" state near the destination.

## URL format

Preferred:

```text
https://YOUR-DOMAIN.example/index.html#47.0707,15.4395
```

The coordinates are stored in the URL fragment and are therefore not sent to the web server in a normal HTTP request.

The app also accepts:

```text
https://YOUR-DOMAIN.example/index.html?lat=47.0707&lon=15.4395
```

## Run locally

Compass and geolocation APIs normally require a secure context. `localhost` is treated as secure by browsers, so for desktop testing you can run:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/index.html#47.0707,15.4395
```

For testing on an actual phone, deploy it over HTTPS. GitHub Pages, Cloudflare Pages, Netlify, and similar static hosts work well.

## Game setup

1. Deploy this directory to an HTTPS static host.
2. Open `generator.html`. When hosted beside `index.html`, it automatically uses the correct compass-app URL.
3. Set the waypoint using **Use my current location**, paste decimal coordinates, paste DMS coordinates, paste a common full Google Maps URL, or edit latitude/longitude manually.
4. Generate/copy the target URL.
5. Encode that URL as a QR code using any QR-code generator.
6. Print the QR code and place it at the relevant game station.

Examples accepted by the generator:

```text
47.0707, 15.4395
47°04'14.5"N 15°26'22.2"E
https://www.google.com/maps/.../@47.0707,15.4395,17z
```

Google Maps short links such as `maps.app.goo.gl/...` do not contain the coordinates themselves and therefore cannot be decoded locally by this static app. Open the short link first and paste the resulting full Google Maps URL, or paste the coordinates shown by Maps.

Scanning the QR code with the phone camera opens the waypoint directly.

## Direction logic

The app computes the initial great-circle bearing from the current GPS coordinate to the target. It then subtracts the phone heading and rotates the arrow by the resulting relative angle.

On iOS Safari, `webkitCompassHeading` is used when available. On other browsers, the Device Orientation API is used. If compass data are unavailable, the app falls back to a GPS-derived course after the player walks several metres.

## Important limitations

Phone magnetometers are sensitive to nearby steel, magnets, vehicles, speakers, and electrical equipment. Players may occasionally need to move the phone in a figure-eight pattern to recalibrate it.

GPS accuracy outdoors is commonly several metres. Consequently, the default "Found it" radius is 6 m. Change `FOUND_RADIUS_M` near the top of `app.js` if required.

## Files

- `index.html` — game interface
- `styles.css` — minimal full-screen UI
- `app.js` — GPS, bearing, distance, compass and fallback logic
- `generator.html` — waypoint generator UI
- `generator.js` — generator controls and geolocation
- `generator-lib.js` — coordinate and Google Maps URL parsing
- `compass-mark.svg` — local compass artwork
