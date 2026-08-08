/*! Sun Cards — a Lovelace card set for Home Assistant
 *  https://github.com/tkamenick/lovelace-sun-cards
 *
 *  Four cards:
 *    · custom:sun-cards-bearing   — heading-up compass with wall arcs + sun-on-glass windows
 *    · custom:sun-cards-elevation — current elevation with 24h curve and min/max
 *    · custom:sun-cards-path      — elevation-vs-azimuth day arc, heading-up, wall bands
 *    · custom:sun-cards-wide      — all three in one wide card, trimmed to what only it can say
 *
 *  All astronomy is computed in-card from hass.config.latitude/longitude; the live
 *  sun position comes from sun.sun (or sensor overrides). No external dependencies.
 */
(() => {
  'use strict';

  const VERSION = '1.8.3';
  const REPO = 'https://github.com/tkamenick/lovelace-sun-cards';

  /* ── palette ────────────────────────────────────────────────────────────
   *  Surfaces and neutral text come from the active HA theme. The data
   *  accents are picked per theme brightness: the light-theme variants are
   *  deeper so they still clear WCAG AA text contrast on a pale card.      */
  const ACCENTS = {
    dark: { amber: '#f2a35c', blue: '#8fa8d9', green: '#a8d98f', pink: '#d98fa8' },
    light: { amber: '#a8620f', blue: '#4f74ad', green: '#4a7a30', pink: '#a33c62' },
  };
  const NEUTRALS = {
    text: 'var(--primary-text-color, #e8e6e1)',
    ink: 'var(--primary-text-color, #c9c7c2)',
    dim: 'var(--secondary-text-color, #8b8d96)',
    faint: 'var(--disabled-text-color, #565963)',
    ghost: 'var(--disabled-text-color, #3a3d46)',
    line: 'var(--primary-text-color, #ffffff)',
    divider: 'var(--divider-color, rgba(255,255,255,0.06))',
  };
  const palette = (darkMode) => {
    const a = darkMode ? ACCENTS.dark : ACCENTS.light;
    return {
      ...NEUTRALS,
      ...a,
      orange: a.amber,
      wall: [a.amber, a.blue, a.green, a.pink],
      // the light accents are darker but lower-chroma, so they need more
      // opacity than the dark ones to read with the same weight
      sunFill: darkMode ? 0.6 : 0.9,
      sunRing: darkMode ? 0.7 : 0.9,
    };
  };
  const MONO = "'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
  const SANS = "'Familjen Grotesk','Instrument Sans',system-ui,-apple-system,sans-serif";
  const MONO_SVG = 'Fragment Mono, ui-monospace, Menlo, monospace';
  const SANS_SVG = 'Familjen Grotesk, system-ui, sans-serif';

  const FONTS_URL =
    'https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400;500;600;700&family=Fragment+Mono&display=swap';
  function loadFonts() {
    if (document.getElementById('sun-cards-fonts')) return;
    const link = document.createElement('link');
    link.id = 'sun-cards-fonts';
    link.rel = 'stylesheet';
    link.href = FONTS_URL;
    document.head.appendChild(link);
  }

  /* ── the sun marker ─────────────────────────────────────────────────────
   *  One shape for all three cards: a filled dot, a knockout halo that lifts
   *  it off whatever it overlaps (wall arcs, the day curve), and a dashed
   *  ring. Geometry is identical everywhere; only the color changes, since
   *  each card needs a different hue to stay legible against its own
   *  background art. Sizes are CSS px — pass `k` (host viewBox units per CSS
   *  px) when the host SVG is scaled, so every card renders the same size. */
  const SUN = { dot: 5, halo: 7, ring: 10, dash: [2.5, 3] };
  const HALO_FILL = 'var(--ha-card-background, var(--card-background-color, #1c1c1c))';
  /* `k` is user units per CSS px in the host SVG. Pass it whenever the caller
     already knows the scale — the path charts do, since they derive every other
     px-authored size the same way — and the radii come out right in the markup,
     with no post-render DOM fixup and no dependence on when layout happens to
     settle. Without it the marker is tagged for normalizeSunMarkers to size at
     runtime, which is the only option for the compass: it is laid out by a
     percentage width, so its scale is not known until the browser resolves it. */
  function sunMarker(x, y, color, C, { dim = 1, k = 0 } = {}) {
    const r = (px) => (k ? (px * k).toFixed(3) : px);
    const dash = k ? SUN.dash.map((d) => (d * k).toFixed(3)).join(' ') : SUN.dash.join(' ');
    const tag = k ? '' : ' data-sun';
    const dataR = (px) => (k ? '' : ` data-r="${px}"`);
    return (
      `<g${tag}>` +
      `<circle cx="${x}" cy="${y}"${dataR(SUN.halo)} r="${r(SUN.halo)}" fill="${HALO_FILL}" opacity="0.85"></circle>` +
      `<circle cx="${x}" cy="${y}"${dataR(SUN.ring)} r="${r(SUN.ring)}" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke" opacity="${(C.sunRing * dim).toFixed(2)}"></circle>` +
      `<circle cx="${x}" cy="${y}"${dataR(SUN.dot)} r="${r(SUN.dot)}" fill="${color}" opacity="${(C.sunFill * dim).toFixed(2)}"></circle>` +
      `</g>`
    );
  }

  /* Each card's SVG is scaled differently (the compass is fixed-size, the path
     chart scales with the card width), so a fixed radius would render at a
     different size in each one. Convert the px sizes above into user units
     using the live transform, so every marker is the same size on screen.

     This is also why the sun is drawn *inside* the chart SVG rather than as an
     HTML overlay positioned over it. An overlay has to be placed in percentages
     of the container, and that only lands on the curve while the container's
     aspect ratio matches the viewBox's. The viewBox height is derived from the
     last measured box, so during a live window drag it lags by a frame,
     preserveAspectRatio="meet" letterboxes to make up the difference, and the
     two coordinate spaces drift apart — the sun visibly slid off the arc while
     resizing and snapped back on release. In the chart's own coordinates it
     cannot drift: a stale viewBox scales the curve and the marker together.
     (The elevation card still needs the overlay — that chart is drawn with
     preserveAspectRatio="none", which would squash the marker into an ellipse.) */
  function normalizeSunMarkers(root) {
    root.querySelectorAll('g[data-sun]').forEach((g) => {
      const svg = g.ownerSVGElement;
      const m = svg && svg.getScreenCTM();
      if (!m || !m.a) return;
      const scale = Math.abs(m.a);
      g.querySelectorAll('circle[data-r]').forEach((c) => {
        c.setAttribute('r', (Number(c.dataset.r) / scale).toFixed(2));
      });
      const ring = g.querySelector('circle[stroke-dasharray]');
      if (ring) ring.setAttribute('stroke-dasharray', SUN.dash.map((d) => (d / scale).toFixed(2)).join(' '));
    });
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ── angles ─────────────────────────────────────────────────────────── */
  const RAD = Math.PI / 180;
  const norm360 = (d) => ((d % 360) + 360) % 360;
  const angDiff = (a, b) => {
    const d = Math.abs(norm360(a) - norm360(b)) % 360;
    return d > 180 ? 360 - d : d;
  };
  const WINDS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const cardinal16 = (az) => WINDS[Math.round(norm360(az) / 22.5) % 16];

  /* ── solar position (NOAA low-accuracy almanac + Sæmundsson refraction;
   *    matches HA's astral values to ~0.1–0.3°) ─────────────────────────── */
  function solarPos(date, lat, lon) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
    const g = RAD * norm360(357.529 + 0.98560028 * d); // mean anomaly
    const q = norm360(280.459 + 0.98564736 * d); // mean longitude
    const L = RAD * norm360(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)); // ecliptic longitude
    const e = RAD * (23.439 - 0.00000036 * d); // obliquity
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD; // right ascension
    const dec = Math.asin(Math.sin(e) * Math.sin(L)); // declination
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const lst = norm360(gmst * 15 + lon); // local sidereal (deg)
    const ha = RAD * (((lst - ra + 540) % 360) - 180); // hour angle
    const la = RAD * lat;
    let el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / RAD;
    const az = norm360(Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / RAD + 180);
    if (el > -5) el += 1.02 / Math.tan(RAD * (el + 10.3 / (el + 5.11))) / 60; // refraction
    return { az, el };
  }

  const STEP_MIN = 4;
  const RISE_EL = -0.266; // refracted upper-limb horizon crossing

  function crossTime(a, b, th) {
    const f = (th - a.el) / (b.el - a.el);
    return new Date(a.t.getTime() + f * (b.t - a.t));
  }

  function buildDayTable(lat, lon, ref) {
    const start = new Date(ref);
    start.setHours(0, 0, 0, 0);
    const pts = [];
    for (let m = 0; m <= 1440; m += STEP_MIN) {
      const t = new Date(start.getTime() + m * 60000);
      const { az, el } = solarPos(t, lat, lon);
      pts.push({ t, m, az, el });
    }
    let rise = null;
    let set = null;
    let min = pts[0];
    let max = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (b.el < min.el) min = b;
      if (b.el > max.el) max = b;
      if (a.el < RISE_EL && b.el >= RISE_EL && !rise) rise = crossTime(a, b, RISE_EL);
      if (a.el >= RISE_EL && b.el < RISE_EL && !set) set = crossTime(a, b, RISE_EL);
    }
    return {
      pts,
      start,
      rise,
      set,
      min,
      max,
      daylightMs: rise && set && set > rise ? set - rise : null,
    };
  }

  /* windows where the sun hits a wall: |az − bearing| ≤ half AND el > minEl */
  function glassWindows(pts, bearing, half, minEl) {
    const out = [];
    let startT = null;
    for (const p of pts) {
      const on = p.el > minEl && angDiff(p.az, bearing) <= half;
      if (on && !startT) startT = p.t;
      if (!on && startT) {
        out.push({ start: startT, end: p.t });
        startT = null;
      }
    }
    if (startT) out.push({ start: startT, end: pts[pts.length - 1].t });
    return out;
  }

  /* ── formatting ─────────────────────────────────────────────────────── */
  function fmtTime(hass, d) {
    if (!d || isNaN(d)) return '—';
    const tf = hass?.locale?.time_format;
    const hour12 = tf === 'am_pm' ? true : tf === '24' ? false : undefined;
    const opts = { hour: 'numeric', minute: '2-digit', hour12 };
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        ...opts,
        timeZone: hass?.config?.time_zone,
      }).format(d);
    } catch (e) {
      return new Intl.DateTimeFormat(undefined, opts).format(d);
    }
  }

  function fmtDur(ms) {
    if (ms == null || isNaN(ms)) return '—';
    const m = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
  }

  const fmtSigned = (el, digits = 1) => `${el < 0 ? '−' : '+'}${Math.abs(el).toFixed(digits)}°`;

  /* "12:20 – 7:48 PM" — drop the first meridiem when it matches the second */
  function fmtRange(hass, a, b) {
    let ta = fmtTime(hass, a);
    const tb = fmtTime(hass, b);
    const m = tb.match(/\s?(AM|PM)$/i);
    if (m && ta.endsWith(m[0])) ta = ta.slice(0, -m[0].length);
    return `${ta} – ${tb}`;
  }

  /* bare hour for the wide card's time axis: "7AM" / "13" */
  function fmtHour(hass, d) {
    const tf = hass?.locale?.time_format;
    const hour12 = tf === 'am_pm' ? true : tf === '24' ? false : undefined;
    const opts = { hour: 'numeric', hour12 };
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language || undefined, {
        ...opts,
        timeZone: hass?.config?.time_zone,
      })
        .format(d)
        .replace(/\s+/g, '');
    } catch (e) {
      return new Intl.DateTimeFormat(undefined, opts).format(d).replace(/\s+/g, '');
    }
  }

  const CONDITION_LABELS = { partlycloudy: 'partly cloudy', 'clear-night': 'clear night' };
  const condLabel = (s) => CONDITION_LABELS[s] || String(s).replace(/-/g, ' ');

  /* ── the heading-up compass ─────────────────────────────────────────────
   *  Plan view shared by the bearing and wide cards. Each wall is drawn as the
   *  stretch of horizon the sun actually crosses while lighting that glass
   *  today — not the window's full acceptance cone. The cone is ±sun_window
   *  wide (±78° by default), but the sun only ever traverses part of it, and
   *  which part shifts through the seasons. Drawing the cone put the NW band
   *  where the sun never goes in summer, making it look as though the sun set
   *  before reaching those windows.
   *  `sub` is the caption under the azimuth reading; the wide card leaves it
   *  out and centers the reading instead, since its footer already names the
   *  walls and their compass points.                                        */
  function compassSvg({ heading, az, el, lit, C, size = 220, sub = '', style = '' }) {
    const pt = (azm, r) => {
      const a = (azm - heading) * RAD;
      return [(120 + r * Math.sin(a)).toFixed(1), (120 - r * Math.cos(a)).toFixed(1)];
    };
    // arc along the horizon ring between two azimuths, following the sun's
    // own direction of travel (increasing azimuth = clockwise on screen)
    const arcBetween = (az1, az2, r) => {
      const span = norm360(az2 - az1);
      if (span < 0.5) return '';
      const [x1, y1] = pt(az1, r);
      const [x2, y2] = pt(az2, r);
      return `M ${x1} ${y1} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${x2} ${y2}`;
    };
    const letter = (azm, label, color) => {
      const [x, y] = pt(azm, 105);
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-family="${MONO_SVG}" font-size="11">${label}</text>`;
    };

    const [t1x, t1y] = pt(0, 82);
    const [t2x, t2y] = pt(0, 93);
    const [sx, sy] = pt(az, 88);
    const sunDim = el > 0 ? 1 : 0.55;

    const arcs = lit
      .map(({ w, color, wins }) => {
        // Walls whose lit ranges overlap (they usually do — one wall's sun
        // window often contains another's) would hide each other at a shared
        // radius, so each wall gets its own ring.
        const arcR = 88 - w.slot * 7;
        // faint tick at the wall bearing so its orientation still reads on a
        // day the sun never reaches it (winter, or a north-facing wall)
        const [b1x, b1y] = pt(w.bearing, arcR - 5);
        const [b2x, b2y] = pt(w.bearing, arcR + 5);
        const tick = `<line x1="${b1x}" y1="${b1y}" x2="${b2x}" y2="${b2y}" stroke="${color}" stroke-width="1.5" opacity="0.4"></line>`;
        const bands = wins
          .map((win) => {
            const d = arcBetween(win.azStart, win.azEnd, arcR);
            return d
              ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" opacity="0.85"></path>`
              : '';
          })
          .join('');
        return tick + bands;
      })
      .join('');

    // with no caption the reading sits on the ring's own center line
    const bigY = sub ? 116 : 128;
    return `<svg width="${size}" height="${size}" viewBox="0 0 240 240"${style ? ` style="${style}"` : ''} role="img" aria-label="Sun bearing compass">
            <path d="M 114 12 L 120 3 L 126 12 Z" fill="${C.faint}"></path>
            <circle cx="120" cy="120" r="88" fill="none" stroke="${C.line}" stroke-opacity="0.10" stroke-width="1"></circle>
            <circle cx="120" cy="120" r="70" fill="none" stroke="${C.line}" stroke-opacity="0.045" stroke-width="1" stroke-dasharray="2 5"></circle>
            <line x1="${t1x}" y1="${t1y}" x2="${t2x}" y2="${t2y}" stroke="${C.line}" stroke-opacity="0.35" stroke-width="1.5"></line>
            ${letter(0, 'N', C.ink)}${letter(90, 'E', C.faint)}${letter(180, 'S', C.faint)}${letter(270, 'W', C.faint)}
            ${arcs}
            ${sunMarker(sx, sy, C.orange, C, { dim: sunDim })}
            <text x="120" y="${bigY}" text-anchor="middle" fill="${C.text}" font-family="${SANS_SVG}" font-weight="600" font-size="40">${Math.round(az)}°</text>
            ${sub ? `<text x="120" y="140" text-anchor="middle" fill="${C.dim}" font-family="${MONO_SVG}" font-size="13">${sub}</text>` : ''}
          </svg>`;
  }

  /* ── the sun-path chart ─────────────────────────────────────────────────
   *  Elevation vs azimuth, heading-up — shared by the path and wide cards.
   *  The viewBox is 300 wide by definition (one unit ≈ 1.2° of azimuth) and its
   *  *height* is derived from the box the card actually gives us, so the chart
   *  fills that box at any card width instead of letterboxing in one direction.
   *  Because the scale therefore varies with width, every size is authored in
   *  CSS px and converted through u() — otherwise the labels would balloon on a
   *  wide card. Strokes use non-scaling-stroke, which is already in px.
   *  `footerPx` is the room reserved below the horizon for axis furniture; the
   *  two cards put different things there, so each states its own.
   *  Returns the projection helpers next to the layers both cards draw, so
   *  neither has to re-derive the geometry to add its own furniture.        */
  function pathChart({ tb, lit, C, hass, heading, box, latlon, footerPx }) {
    const [lat, lon] = latlon;
    const rel = (azm) => ((azm - heading + 540) % 360) - 180;
    const bx = (azm) => ((rel(azm) + 180) * 300) / 360;
    const maxEl = Math.max(tb.max.el, 5);
    const minEl = Math.min(tb.min.el, -2);
    const U = 300 / box.w; // viewBox units per CSS px
    const u = (v) => v * U;
    const VB_H = Math.max(u(120), box.h * U);
    const yTop = u(16);
    const yHor = Math.max(yTop + u(40), VB_H - u(footerPx));
    const nightDepth = u(22);
    const F8 = u(8).toFixed(2);
    const F9 = u(9).toFixed(2);
    const F10 = u(10).toFixed(2);
    /* The night runs about half as deep again as the day runs high, but it
       must not take that share of the chart — so it is compressed. How it is
       compressed is what the eye notices at the horizon crossing.

       A separate linear scale (the original) meets the horizon at a corner:
       the day arc arrives steep and the night leaves nearly flat, at roughly a
       third of the incoming rate. That corner is what made the sun marker at
       night look like it had come loose from the curve — the arc the eye
       extrapolates is not the one it lands on.

       Matching the day's rate exactly overshoots the other way: the curve then
       has to shed all that depth inside a shallow band and saturates into a
       flat plateau across most of the night.

       tanh with the knee at half the uncompressed depth splits it: the curve
       leaves the horizon at ~2/3 of the day's rate and keeps bending the whole
       way down, bottoming out just shy of the band. It reads as the same arc,
       foreshortened — which is what it is. */
    const perDeg = (yHor - yTop) / maxEl; // viewBox units per degree of elevation
    const knee = Math.max(1e-6, (Math.abs(minEl) * perDeg) / 2);
    const Y = (e) => (e >= 0 ? yHor - e * perDeg : yHor + nightDepth * Math.tanh((-e * perDeg) / knee));

    // curve segments, broken where the heading-up x-axis wraps
    const segs = [];
    let seg = [];
    let prevX = null;
    for (const p of tb.pts) {
      const x = bx(p.az);
      if (prevX !== null && Math.abs(x - prevX) > 150) {
        if (seg.length > 1) segs.push(seg);
        seg = [];
      }
      seg.push({ x, y: Y(p.el), el: p.el });
      prevX = x;
    }
    if (seg.length > 1) segs.push(seg);

    const fullCurve = segs
      .map((s) => 'M ' + s.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' L '))
      .join(' ');
    let dayStroke = '';
    let dayFill = '';
    for (const s of segs) {
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const l = run.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' L ');
          dayStroke += `M ${l} `;
          dayFill += `M ${run[0].x.toFixed(1)} ${yHor} L ${l} L ${run[run.length - 1].x.toFixed(1)} ${yHor} Z `;
        }
        run = [];
      };
      s.forEach((q) => {
        if (q.el > 0) run.push(q);
        else flush();
      });
      flush();
    }

    /* A wall's band covers the azimuths the sun crosses while actually
       lighting that glass today (±sun_window AND above min_elevation) —
       the same rule the shade automation runs on. Drawing the window's full
       acceptance cone instead would place the band where the sun never
       travels this time of year. */
    const bands = lit
      .map(({ w, color: wc, wins }) => {
        const rects = [];
        const add = (l, r) => {
          const L = Math.max(0, l);
          const R = Math.min(300, r);
          if (R <= L) return;
          rects.push(
            `<rect x="${L.toFixed(1)}" y="${yTop.toFixed(1)}" width="${(R - L).toFixed(1)}" height="${(yHor - yTop).toFixed(1)}" fill="${wc}" opacity="0.16"></rect>`
          );
          // edges only where the band truly starts/ends, not where it was
          // clipped by the edge of the chart
          for (const [x, real] of [[L, l >= 0], [R, r <= 300]]) {
            if (real)
              rects.push(
                `<line x1="${x.toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yHor.toFixed(1)}" stroke="${wc}" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.5"></line>`
              );
          }
        };
        let labelX = bx(w.bearing);
        wins.forEach((win, i) => {
          const x1 = bx(win.azStart);
          const x2 = bx(win.azEnd);
          if (x2 >= x1) add(x1, x2);
          else {
            // the lit stretch runs off one edge of the heading-up axis
            add(x1, 300);
            add(0, x2);
          }
          if (i === 0) labelX = x1;
        });
        const short = esc(String(w.name || '').split(/\s+/)[0].toUpperCase());
        // anchored to each band's left edge and stacked upward per wall, so
        // labels stay apart when the bands overlap and clear the horizon
        // caption sitting at the bottom-left
        const ly = (yHor - u(18) - w.slot * u(12)).toFixed(1);
        return (
          rects.join('') +
          `<text x="${Math.min(250, Math.max(2, labelX + 4)).toFixed(1)}" y="${ly}" text-anchor="start" fill="${wc}" font-family="${MONO_SVG}" font-size="${F9}" opacity="0.95">${short} ${Math.round(w.bearing)}°</text>`
        );
      })
      .join('');

    const defs = `<defs>
            <linearGradient id="sc-path-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${C.orange}" stop-opacity="0.38"></stop>
              <stop offset="1" stop-color="${C.orange}" stop-opacity="0.03"></stop>
            </linearGradient>
          </defs>`;

    // the heading the card is drawn around, marked at the top of the axis
    const headingMark = `<path d="M ${(150 - u(4)).toFixed(1)} ${u(8).toFixed(1)} L 150 ${u(2).toFixed(1)} L ${(150 + u(4)).toFixed(1)} ${u(8).toFixed(1)} Z" fill="${C.faint}"></path>
          <line x1="150" y1="${u(12).toFixed(1)}" x2="150" y2="${yHor.toFixed(1)}" stroke="${C.line}" stroke-opacity="0.12" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="2 4"></line>`;

    const curve = `<path d="${dayFill}" fill="url(#sc-path-g)"></path>
          <path d="${fullCurve}" fill="none" stroke="${C.line}" stroke-opacity="0.22" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
          <path d="${dayStroke}" fill="none" stroke="${C.orange}" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity="0.9"></path>
          <line x1="0" y1="${yHor.toFixed(1)}" x2="300" y2="${yHor.toFixed(1)}" stroke="${C.line}" stroke-opacity="0.16" stroke-width="1" vector-effect="non-scaling-stroke"></line>`;

    let riseSet = '';
    if (tb.rise && tb.set) {
      const riseX = bx(solarPos(tb.rise, lat, lon).az).toFixed(1);
      const setX = bx(solarPos(tb.set, lat, lon).az).toFixed(1);
      const tickY = (yHor + u(7)).toFixed(1);
      const labY = (yHor + u(37)).toFixed(1);
      riseSet = `
          <line x1="${riseX}" y1="${yHor.toFixed(1)}" x2="${riseX}" y2="${tickY}" stroke="${C.line}" stroke-opacity="0.3" stroke-width="1" vector-effect="non-scaling-stroke"></line>
          <line x1="${setX}" y1="${yHor.toFixed(1)}" x2="${setX}" y2="${tickY}" stroke="${C.line}" stroke-opacity="0.3" stroke-width="1" vector-effect="non-scaling-stroke"></line>
          <text x="${riseX}" y="${labY}" text-anchor="middle" fill="${C.ink}" font-family="${MONO_SVG}" font-size="${F10}">rise ${fmtTime(hass, tb.rise)}</text>
          <text x="${setX}" y="${labY}" text-anchor="middle" fill="${C.ink}" font-family="${MONO_SVG}" font-size="${F10}">set ${fmtTime(hass, tb.set)}</text>`;
    }

    return { u, bx, Y, box, VB_H, yTop, yHor, F8, F9, F10, defs, bands, headingMark, curve, riseSet };
  }

  /* ── base card ──────────────────────────────────────────────────────── */
  class SunCardsBase extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._sig = null;
    }

    setConfig(config) {
      const cfg = { ...this.constructor.defaults, ...(config || {}) };
      if (cfg.walls !== undefined && cfg.walls !== null) {
        if (!Array.isArray(cfg.walls)) throw new Error('sun-cards: "walls" must be a list');
        cfg.walls = cfg.walls.map((w, i) => {
          if (typeof w !== 'object' || typeof w.bearing !== 'number') {
            throw new Error(`sun-cards: walls[${i}] needs a numeric "bearing"`);
          }
          return {
            name: w.name || `Wall ${i + 1}`,
            bearing: norm360(w.bearing),
            color: w.color || null, // null → follows the theme accent for this slot
            slot: i,
            entity: w.entity || null,
          };
        });
      }
      this._config = cfg;
      this._table = null;
      this._tableKey = null;
      this._sig = null;
      if (this._hass) this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      if (this._config.load_fonts !== false) loadFonts();
      const sig = this._signature();
      if (sig !== this._sig) {
        this._sig = sig;
        this._render();
      }
    }

    get hass() {
      return this._hass;
    }

    connectedCallback() {
      // minute tick keeps countdowns and "now" markers honest between state changes
      this._timer = setInterval(() => {
        if (this._hass && this._config) this._render();
      }, 60000);
      // the marker size depends on the card's rendered width, so recompute it
      // whenever the card is resized (column changes, sidebar toggle, rotation)
      const resync = () => {
        if (!this.shadowRoot || !this.isConnected) return;
        normalizeSunMarkers(this.shadowRoot);
        this._afterRender();
      };
      if (typeof ResizeObserver === 'function') {
        this._ro = new ResizeObserver(resync);
        this._ro.observe(this);
      }
      // backstop: catches window resizes even where ResizeObserver is
      // unavailable or throttled, and costs nothing when nothing changed
      this._onWinResize = resync;
      window.addEventListener('resize', this._onWinResize);
      if (this._hass && this._config) this._render();
    }

    disconnectedCallback() {
      clearInterval(this._timer);
      this._ro?.disconnect();
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._normRaf) cancelAnimationFrame(this._normRaf);
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize);
    }

    _signature() {
      const { az, el } = this._sun();
      const st = this._hass.states;
      const c = this._config;
      return [
        az.toFixed(1),
        el.toFixed(1),
        c.weather_entity ? st[c.weather_entity]?.state : '',
        c.bypass_entity ? st[c.bypass_entity]?.state : '',
        this._hass.themes?.darkMode, // re-render when the theme flips light/dark
        new Date().getDate(),
      ].join('|');
    }

    _latlon() {
      const c = this._config;
      const h = this._hass;
      return [c.latitude ?? h?.config?.latitude ?? 0, c.longitude ?? h?.config?.longitude ?? 0];
    }

    _dayTable() {
      const [lat, lon] = this._latlon();
      const today = new Date();
      const key = `${today.toDateString()}|${lat}|${lon}`;
      if (!this._table || this._tableKey !== key) {
        this._table = buildDayTable(lat, lon, today);
        this._tableKey = key;
      }
      return this._table;
    }

    _sun() {
      const c = this._config;
      const st = this._hass.states;
      let az = NaN;
      let el = NaN;
      if (c.azimuth_entity && st[c.azimuth_entity]) az = parseFloat(st[c.azimuth_entity].state);
      if (c.elevation_entity && st[c.elevation_entity]) el = parseFloat(st[c.elevation_entity].state);
      const sun = st[c.sun_entity || 'sun.sun'];
      if (Number.isNaN(az)) az = Number(sun?.attributes?.azimuth);
      if (Number.isNaN(el)) el = Number(sun?.attributes?.elevation);
      if (Number.isNaN(az) || Number.isNaN(el)) {
        const [lat, lon] = this._latlon();
        const p = solarPos(new Date(), lat, lon);
        if (Number.isNaN(az)) az = p.az;
        if (Number.isNaN(el)) el = p.el;
      }
      return { az: norm360(az), el };
    }

    /* Per wall: its color, and every stretch of today it actually has sun on
       the glass — with the azimuths at both ends, since the compass and the
       path chart both plot those windows by angle rather than by time. */
    _litWalls(tb) {
      const c = this._config;
      const ll = this._latlon();
      return (c.walls || []).map((w) => ({
        w,
        color: this._wallColor(w),
        wins: glassWindows(tb.pts, w.bearing, c.sun_window, c.min_elevation).map((win) => ({
          ...win,
          azStart: solarPos(win.start, ...ll).az,
          azEnd: solarPos(win.end, ...ll).az,
        })),
      }));
    }

    _nextEvent() {
      const sun = this._hass.states[this._config.sun_entity || 'sun.sun'];
      const nr = sun?.attributes?.next_rising ? new Date(sun.attributes.next_rising) : null;
      const ns = sun?.attributes?.next_setting ? new Date(sun.attributes.next_setting) : null;
      if (nr && !isNaN(nr) && ns && !isNaN(ns)) {
        return nr <= ns ? { label: 'sunrise', t: nr } : { label: 'sunset', t: ns };
      }
      const tb = this._dayTable();
      const now = new Date();
      if (tb.rise && tb.rise > now) return { label: 'sunrise', t: tb.rise };
      if (tb.set && tb.set > now) return { label: 'sunset', t: tb.set };
      return null;
    }

    _render() {
      let html;
      try {
        html = this._template();
      } catch (e) {
        html = `<ha-card style="display:block; padding:16px; font-family:${MONO}; font-size:12px;">sun-cards error: ${esc(
          e && e.message
        )}</ha-card>`;
      }
      this.shadowRoot.innerHTML = html;
      this.shadowRoot.querySelectorAll('[data-entity]').forEach((el) => {
        el.addEventListener('click', () => {
          this.dispatchEvent(
            new CustomEvent('hass-more-info', {
              bubbles: true,
              composed: true,
              detail: { entityId: el.dataset.entity },
            })
          );
        });
      });
      // post-paint work must never escape: HA renders cards during its own
      // view layout, and an exception here would blank the whole view
      try {
        normalizeSunMarkers(this.shadowRoot);
        this._afterRender();
      } catch (e) {
        console.warn('sun-cards: post-render step failed', e);
      }
      /* The pass above reads the live transform immediately after replacing the
         markup, and inside HA that is often too early: the card is being sized
         by the view around it, getScreenCTM still reports the pre-layout matrix,
         and the compass marker is left scaled for a box it no longer occupies.
         Re-run once the frame has settled. It recomputes from data-r rather than
         from the current r, so running it any number of times is harmless. */
      if (this._normRaf) cancelAnimationFrame(this._normRaf);
      this._normRaf = requestAnimationFrame(() => {
        this._normRaf = 0;
        if (!this.isConnected || !this.shadowRoot) return;
        try {
          normalizeSunMarkers(this.shadowRoot);
        } catch (e) {
          console.warn('sun-cards: marker normalize failed', e);
        }
      });
    }

    /* A `[data-chart]` element means the card draws something whose viewBox is
       derived from the box it actually got, so measure after painting and
       re-render if it moved. The re-render is deferred to the next frame rather
       than run inline: HA sizes cards while laying the view out, so a
       synchronous re-render here re-enters the layout it was called from. The
       second pass measures the same box and stops, so there is no loop; `_corr`
       caps the corrections in case a card size and its content ever chase each
       other. Cards without a chart never enter any of this. */
    _afterRender() {
      const el = this.shadowRoot && this.shadowRoot.querySelector('[data-chart]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) return; // not laid out yet
      const b = this._box;
      if (b && Math.abs(b.w - r.width) < 2 && Math.abs(b.h - r.height) < 2) {
        this._corr = 0;
        return;
      }
      if ((this._corr = (this._corr || 0) + 1) > 4) return;
      this._box = { w: r.width, h: r.height };
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this.isConnected && this._hass && this._config) this._render();
      });
    }

    _pal() {
      return palette(this._hass?.themes?.darkMode !== false);
    }

    /* wall color: explicit config wins, otherwise the theme accent for its slot */
    _wallColor(w) {
      const C = this._pal();
      return w.color || C.wall[w.slot % C.wall.length];
    }

    _card(inner) {
      const C = this._pal();
      return `<ha-card style="display:flex; flex-direction:column; box-sizing:border-box; height:100%; padding:24px 26px 22px; color:${C.text}; font-family:${SANS};">${inner}</ha-card>`;
    }

    /* Header row: an optional title on the left, always the meta on the right.
       With no `name` set there is no title, so the meta slides left and carries
       the row on its own rather than floating against an empty gutter. */
    _header(left, right, rightColor) {
      const C = this._pal();
      const meta = `<div style="font-family:${MONO}; font-size:11px; color:${rightColor || C.faint}; white-space:nowrap;">${right}</div>`;
      if (!left) return `<div style="display:flex; align-items:baseline;">${meta}</div>`;
      return `<div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
        <div style="font-family:${MONO}; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${C.dim}; white-space:nowrap;">${esc(left)}</div>
        ${meta}
      </div>`;
    }

    getCardSize() {
      return this.constructor.cardSize || 6;
    }

    getGridOptions() {
      // uniform default height so the card set lines up side by side; the
      // internals absorb slack (compass centers, charts float, footers pin)
      return { columns: 12, rows: 6, min_columns: 6, min_rows: 4 };
    }

    static getStubConfig() {
      return {};
    }
  }

  /* ══ Card 1 · sun-cards-bearing — heading-up compass ═════════════════ */
  class SunCardsBearing extends SunCardsBase {
    static defaults = {
      name: '', // no title unless one is configured
      heading: 325,
      walls: [
        { name: 'NW wall', bearing: 325 },
        { name: 'SW wall', bearing: 236 },
      ],
      sun_window: 78, // half-angle for sun-on-glass windows
      min_elevation: 3,
      sun_entity: 'sun.sun',
      sunny_conditions: ['sunny', 'partlycloudy', 'windy'],
      load_fonts: true,
    };
    static cardSize = 7;

    _template() {
      const C = this._pal();
      const c = this._config;
      const hass = this._hass;
      const { az, el } = this._sun();
      const heading = norm360(c.heading ?? 325);
      const tb = this._dayTable();
      const lit = this._litWalls(tb);

      const rows = lit
        .map(({ w, color: wc, wins }) => {
          const times = wins.length
            ? 'sun ' + wins.slice(0, 2).map((win) => fmtRange(hass, win.start, win.end)).join(' · ')
            : 'no direct sun';
          const active = el > c.min_elevation && angDiff(az, w.bearing) <= c.sun_window;
          const dotGlow = active ? ` box-shadow:0 0 7px 1px ${wc};` : '';
          const click = w.entity ? ` data-entity="${esc(w.entity)}" role="button"` : '';
          return `<div${click} style="display:flex; justify-content:space-between; align-items:center; gap:10px;${w.entity ? ' cursor:pointer;' : ''}">
            <span style="display:flex; align-items:center; gap:8px; font-family:${MONO}; font-size:11px; color:${C.ink}; white-space:nowrap;"><span style="width:8px; height:8px; border-radius:99px; background:${wc};${dotGlow}"></span>${esc(w.name)} · ${Math.round(w.bearing)}°</span>
            <span style="font-family:${MONO}; font-size:11px; color:${C.dim}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${times}</span>
          </div>`;
        })
        .join('');

      let wxRow = '';
      if (c.weather_entity) {
        const wx = hass.states[c.weather_entity];
        const cond = wx ? wx.state : 'unavailable';
        const bypass = c.bypass_entity && hass.states[c.bypass_entity]?.state === 'on';
        const sunnyOk = (c.sunny_conditions || []).includes(cond);
        const right = bypass
          ? `<span style="color:${C.blue};">gate bypassed</span>`
          : sunnyOk
            ? `<span style="color:${C.orange};">gate open</span>`
            : `<span style="color:${C.faint};">cloud hold</span>`;
        wxRow = `<div data-entity="${esc(c.weather_entity)}" role="button" style="display:flex; justify-content:space-between; align-items:center; gap:10px; cursor:pointer;">
          <span style="display:flex; align-items:center; gap:8px; font-family:${MONO}; font-size:11px; color:${C.faint}; white-space:nowrap;"><span style="width:8px; height:8px; border-radius:99px; border:1px solid ${C.faint}; box-sizing:border-box;"></span>wx · ${esc(condLabel(cond))}</span>
          <span style="font-family:${MONO}; font-size:11px; white-space:nowrap;">${right}</span>
        </div>`;
      }

      return this._card(`
        ${this._header(c.name, `heading-up · ${heading}°`)}
        <div style="display:flex; justify-content:center; align-items:center; padding:8px 0 0; flex:1 1 auto; min-height:0;">
          ${compassSvg({ heading, az, el, lit, C, size: 220, sub: `sun · ${cardinal16(az)}` })}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; padding-top:14px; border-top:1px solid ${C.divider}; margin-top:10px;">
          ${rows}${wxRow}
        </div>`);
    }
  }

  /* ══ Card 2 · sun-cards-elevation — 24h elevation curve ══════════════ */
  class SunCardsElevation extends SunCardsBase {
    static defaults = {
      name: '',
      sun_entity: 'sun.sun',
      load_fonts: true,
    };
    static cardSize = 6;

    _template() {
      const C = this._pal();
      const c = this._config;
      const hass = this._hass;
      const { el } = this._sun();
      const tb = this._dayTable();
      const now = new Date();

      const lo = Math.min(tb.min.el, 0) - 3;
      const hi = Math.max(tb.max.el, 0) + 3;
      const top = 8;
      const bot = 74;
      const Y = (e) => (top + ((hi - e) * (bot - top)) / (hi - lo)).toFixed(1);
      const X = (m) => ((m * 280) / 1440).toFixed(1);
      const y0 = Y(0);

      const fullCurve = 'M ' + tb.pts.map((p) => `${X(p.m)} ${Y(p.el)}`).join(' L ');
      let dayStroke = '';
      let dayFill = '';
      let run = [];
      const flush = () => {
        if (run.length > 1) {
          const l = run.map((p) => `${X(p.m)} ${Y(p.el)}`).join(' L ');
          dayStroke += `M ${l} `;
          dayFill += `M ${X(run[0].m)} ${y0} L ${l} L ${X(run[run.length - 1].m)} ${y0} Z `;
        }
        run = [];
      };
      tb.pts.forEach((p) => {
        if (p.el > 0) run.push(p);
        else flush();
      });
      flush();

      const nowM = Math.min(1440, Math.max(0, (now - tb.start) / 60000));
      const nx = X(nowM);
      const ny = Y(Math.min(hi, Math.max(lo, el)));

      const below = el < 0;
      const nxt = this._nextEvent();
      let status = below ? 'below horizon' : 'above horizon';
      if (nxt) {
        if (below && nxt.label === 'sunrise') status += ` · sunrise in ${fmtDur(nxt.t - now)}`;
        if (!below && nxt.label === 'sunset') status += ` · sunset in ${fmtDur(nxt.t - now)}`;
      }
      const statusColor = below ? C.blue : C.orange;

      return this._card(`
        ${this._header(c.name, 'today · 24h')}
        <div style="padding:16px 0 4px;">
          <div style="font-size:58px; font-weight:600; line-height:1; color:${C.text}; letter-spacing:-0.02em;">${fmtSigned(el)}</div>
        </div>
        <div style="font-family:${MONO}; font-size:11px; color:${statusColor}; padding-bottom:14px;">${status}</div>
        <div style="margin:auto 0; position:relative;">
        <svg width="100%" height="96" viewBox="0 0 280 98" preserveAspectRatio="none" style="display:block; overflow:visible;" role="img" aria-label="Sun elevation today">
          <defs>
            <linearGradient id="sc-el-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${C.orange}" stop-opacity="0.45"></stop>
              <stop offset="1" stop-color="${C.orange}" stop-opacity="0.02"></stop>
            </linearGradient>
          </defs>
          <line x1="0" y1="${y0}" x2="280" y2="${y0}" stroke="${C.line}" stroke-opacity="0.14" stroke-width="1" stroke-dasharray="3 4"></line>
          <text x="1" y="${(Number(y0) - 4).toFixed(1)}" fill="${C.ghost}" font-family="${MONO_SVG}" font-size="8" letter-spacing="1">HORIZON 0°</text>
          <path d="${dayFill}" fill="url(#sc-el-g)"></path>
          <path d="${fullCurve}" fill="none" stroke="${C.line}" stroke-opacity="0.28" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
          <path d="${dayStroke}" fill="none" stroke="${C.orange}" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
          <text x="2" y="92" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">12AM</text>
          <text x="70" y="92" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">6AM</text>
          <text x="140" y="92" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">12PM</text>
          <text x="210" y="92" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">6PM</text>
          <text x="278" y="92" text-anchor="end" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">12AM</text>
        </svg>
        <!-- the chart above is stretched to fill the card (preserveAspectRatio=none),
             which would squash the marker into an ellipse — so it is overlaid in an
             unscaled SVG instead, and stays a true circle at any card width -->
        <div style="position:absolute; left:${((nx / 280) * 100).toFixed(2)}%; top:${((ny * 96) / 98).toFixed(1)}px; transform:translate(-50%,-50%); pointer-events:none;">
          <svg width="${SUN.ring * 2 + 4}" height="${SUN.ring * 2 + 4}" viewBox="${-SUN.ring - 2} ${-SUN.ring - 2} ${SUN.ring * 2 + 4} ${SUN.ring * 2 + 4}" style="display:block; overflow:visible;" aria-hidden="true">
            ${sunMarker(0, 0, C.blue, C, { k: 1 })}
          </svg>
        </div>
        </div>
        <div style="display:flex; justify-content:space-between; padding-top:14px; border-top:1px solid ${C.divider}; margin-top:12px;">
          <div style="display:flex; flex-direction:column; gap:3px;">
            <div style="font-family:${MONO}; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${C.faint};">Min</div>
            <div style="font-size:18px; font-weight:600; color:${C.text};">${fmtSigned(tb.min.el)}</div>
            <div style="font-family:${MONO}; font-size:11px; color:${C.dim};">${fmtTime(hass, tb.min.t)}</div>
          </div>
          <div style="display:flex; flex-direction:column; gap:3px; text-align:right;">
            <div style="font-family:${MONO}; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:${C.faint};">Max</div>
            <div style="font-size:18px; font-weight:600; color:${C.text};">${fmtSigned(tb.max.el)}</div>
            <div style="font-family:${MONO}; font-size:11px; color:${C.dim};">${fmtTime(hass, tb.max.t)}</div>
          </div>
        </div>`);
    }
  }

  /* ══ Card 3 · sun-cards-path — elevation vs azimuth, heading-up ══════ */
  class SunCardsPath extends SunCardsBase {
    static defaults = {
      name: '',
      heading: 325,
      walls: [
        { name: 'NW wall', bearing: 325 },
        { name: 'SW wall', bearing: 236 },
      ],
      sun_window: 78, // must match the bearing card / the automation's fov
      min_elevation: 3,
      sun_entity: 'sun.sun',
      load_fonts: true,
    };
    static cardSize = 6;

    _template() {
      const C = this._pal();
      const c = this._config;
      const hass = this._hass;
      const { az, el } = this._sun();
      const heading = norm360(c.heading ?? 325);
      const tb = this._dayTable();

      const g = pathChart({
        tb,
        lit: this._litWalls(tb),
        C,
        hass,
        heading,
        box: this._box || { w: 269, h: 255 },
        latlon: this._latlon(),
        footerPx: 62, // rise/set ticks and labels, cardinal letters, axis caption
      });
      const { u, bx, Y, VB_H, yHor, F8, F9, F10 } = g;

      const noonX = bx(tb.max.az).toFixed(1);
      const noonY = Y(tb.max.el).toFixed(1);
      const sunX = bx(az).toFixed(1);
      const sunY = Y(el).toFixed(1);
      const daylight = tb.daylightMs != null ? `${fmtDur(tb.daylightMs)} daylight` : 'no daylight';
      const nowTxt = el < 0 ? 'now: below horizon' : `now: ${fmtSigned(el)} \u00b7 az ${Math.round(az)}\u00b0`;
      const nxt = this._nextEvent();
      const nextTxt = nxt ? `next ${nxt.label} ${fmtTime(hass, nxt.t)}` : '';

      const cardinal = (azm, label, color) =>
        `<text x="${bx(azm).toFixed(1)}" y="${(yHor + u(17)).toFixed(1)}" text-anchor="middle" fill="${color}" font-family="${MONO_SVG}" font-size="${F10}">${label}</text>`;

      return this._card(`
        ${this._header(c.name, daylight, C.orange)}
        <div style="flex:1 1 auto; min-height:0; padding-top:14px; display:flex;">
        <div data-chart style="position:relative; flex:1 1 auto; min-height:0; display:flex;">
        <svg width="100%" height="100%" viewBox="0 0 300 ${VB_H.toFixed(1)}" preserveAspectRatio="xMidYMid meet" style="display:block; overflow:visible;" role="img" aria-label="Sun path today">
          ${g.defs}
          ${g.bands}
          ${g.headingMark}
          <text x="${(150 + u(8)).toFixed(1)}" y="${u(10).toFixed(1)}" text-anchor="start" fill="${C.faint}" font-family="${MONO_SVG}" font-size="${F9}">${heading}\u00b0</text>
          ${g.curve}
          <text x="2" y="${(yHor - u(4)).toFixed(1)}" fill="${C.ghost}" font-family="${MONO_SVG}" font-size="${F8}" letter-spacing="${u(1).toFixed(2)}">HORIZON 0\u00b0</text>
          <line x1="${noonX}" y1="${noonY}" x2="${noonX}" y2="${u(14).toFixed(1)}" stroke="${C.line}" stroke-opacity="0.15" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="2 3"></line>
          <text x="${noonX}" y="${u(8).toFixed(1)}" text-anchor="middle" fill="${C.dim}" font-family="${MONO_SVG}" font-size="${F9}">noon ${fmtSigned(tb.max.el, 0)}</text>
          ${g.riseSet}
          ${cardinal(0, 'N', C.dim)}
          ${cardinal(90, 'E', C.faint)}
          ${cardinal(180, 'S', C.faint)}
          ${cardinal(270, 'W', C.faint)}
          <text x="298" y="${(VB_H - u(6)).toFixed(1)}" text-anchor="end" fill="${C.ghost}" font-family="${MONO_SVG}" font-size="${F9}" letter-spacing="${u(1).toFixed(2)}">AZIMUTH \u2192 \u00b7 HEADING-UP ${heading}\u00b0</text>
          ${sunMarker(sunX, sunY, C.blue, C, { k: u(1) })}
        </svg>
        </div>
        </div>
        <div style="display:flex; justify-content:space-between; gap:12px; padding-top:14px; border-top:1px solid ${C.divider}; margin-top:10px;">
          <span style="font-family:${MONO}; font-size:10px; color:${C.faint}; white-space:nowrap;">${nowTxt}</span>
          <span style="font-family:${MONO}; font-size:10px; color:${C.dim}; white-space:nowrap;">${nextTxt}</span>
        </div>`);
    }
  }

  /* ══ Card 4 · sun-cards-wide — the three cards folded into one ═══════
     Same drawings as the set above, laid out for a card that has width to
     spend, and trimmed to what only this layout can say. Everything the
     three-card row could only repeat is gone: no "below horizon" caption
     beside an already-negative number, no min/max column, no bearing
     restated in the footer next to a compass that is showing it. The row
     that frees up goes to a clock along the sun path — the one reading a
     narrow path card never had room for, and the reason to put the compass
     and the path on the same card at all: you can read where the sun is,
     how high, and what time it reaches each wall without moving your eye
     between three headers. */
  class SunCardsWide extends SunCardsBase {
    static defaults = {
      name: '',
      heading: 325,
      walls: [
        { name: 'NW wall', bearing: 325 },
        { name: 'SW wall', bearing: 236 },
      ],
      sun_window: 78, // must match the automation's fov, as on the other cards
      min_elevation: 3,
      sun_entity: 'sun.sun',
      sunny_conditions: ['sunny', 'partlycloudy', 'windy'],
      load_fonts: true,
    };
    static cardSize = 7;

    /* `rows: auto` rather than the fixed 6 the other cards ask for. This card
       changes shape with its width — side by side when there is room, stacked
       when there is not — and a stacked layout needs a height a fixed row count
       would not have given it. Letting the card size to its own content is what
       makes the narrow layout possible at all; set `grid_options: rows` in the
       UI if you would rather pin it. */
    getGridOptions() {
      return { columns: 'full', rows: 'auto', min_columns: 6 };
    }

    // below this the compass and chart stop sharing a row and stack instead
    static NARROW = 520;

    _template() {
      const C = this._pal();
      const c = this._config;
      const hass = this._hass;
      const { az, el } = this._sun();
      const heading = norm360(c.heading ?? 325);
      const tb = this._dayTable();
      const now = new Date();
      const lit = this._litWalls(tb);

      /* Which layout to draw is decided from the card's own width, not the
         window's: the same dashboard can hand this card a third of a desktop
         row or the full width of a phone, and only the card knows which it
         got. A first paint with no width yet draws wide, then _afterRender
         measures and settles it on the next frame. */
      const hostW = this.getBoundingClientRect().width;
      const narrow = hostW > 0 && hostW < this.constructor.NARROW;

      const g = pathChart({
        tb,
        lit,
        C,
        hass,
        heading,
        box: this._box || { w: narrow ? 340 : 420, h: 190 },
        latlon: this._latlon(),
        footerPx: 46, // hour labels and rise/set labels — no cardinals, no caption
      });
      const { u, bx, Y, VB_H, yHor, F10, box } = g;

      /* Whole-hour dots along the day arc, every third one labeled — every
         sixth once the chart is too narrow for the labels to clear each other.
         The cardinal letters the path card puts under this axis are dropped
         here, since the compass beside it is already answering "which way",
         and the row goes to the clock instead. Hours land exactly on day-table
         samples, since the table steps in 4-minute intervals from midnight. */
      const labelEvery = box.w < 380 ? 6 : 3;
      let hourMarks = '';
      let hourLabels = '';
      for (const p of tb.pts) {
        if (p.m % 60 || p.el <= 0) continue;
        const x = bx(p.az).toFixed(1);
        const major = Math.round(p.m / 60) % labelEvery === 1;
        hourMarks +=
          `<circle cx="${x}" cy="${Y(p.el).toFixed(1)}" r="${u(major ? 2.4 : 1.4).toFixed(2)}" fill="${C.orange}" opacity="0.55"></circle>` +
          `<line x1="${x}" y1="${yHor.toFixed(1)}" x2="${x}" y2="${(yHor + u(major ? 6 : 3)).toFixed(1)}" stroke="${C.line}" stroke-opacity="0.3" stroke-width="1" vector-effect="non-scaling-stroke"></line>`;
        if (major) {
          hourLabels += `<text x="${x}" y="${(yHor + u(17)).toFixed(1)}" text-anchor="middle" fill="${C.dim}" font-family="${MONO_SVG}" font-size="${F10}">${fmtHour(hass, p.t)}</text>`;
        }
      }

      const sunX = bx(az).toFixed(1);
      const sunY = Y(el).toFixed(1);

      // the countdown carries the horizon on its own — a negative elevation
      // next to "sunrise in 7h 47m" does not also need to be called "below"
      const nxt = this._nextEvent();
      const below = el < 0;
      const status = nxt ? `${nxt.label} in ${fmtDur(nxt.t - now)}` : below ? 'below horizon' : 'above horizon';

      const chips = lit
        .map(({ w, color: wc, wins }) => {
          const times = wins.length
            ? 'sun ' + wins.slice(0, 2).map((win) => fmtRange(hass, win.start, win.end)).join(' · ')
            : 'no direct sun';
          const active = el > c.min_elevation && angDiff(az, w.bearing) <= c.sun_window;
          const dotGlow = active ? ` box-shadow:0 0 7px 1px ${wc};` : '';
          const click = w.entity ? ` data-entity="${esc(w.entity)}" role="button"` : '';
          return `<span${click} style="display:flex; align-items:center; gap:8px; font-family:${MONO}; font-size:11px; color:${C.ink}; white-space:nowrap;${w.entity ? ' cursor:pointer;' : ''}"><span style="width:8px; height:8px; border-radius:99px; background:${wc};${dotGlow}"></span>${esc(w.name)} · ${times}</span>`;
        })
        .join('');

      let wxChip = '';
      if (c.weather_entity) {
        const wx = hass.states[c.weather_entity];
        const cond = wx ? wx.state : 'unavailable';
        const bypass = c.bypass_entity && hass.states[c.bypass_entity]?.state === 'on';
        const gate = bypass
          ? `<span style="color:${C.blue};">gate bypassed</span>`
          : (c.sunny_conditions || []).includes(cond)
            ? `<span style="color:${C.orange};">gate open</span>`
            : `<span style="color:${C.faint};">cloud hold</span>`;
        wxChip = `<span data-entity="${esc(c.weather_entity)}" role="button" style="display:flex; align-items:center; gap:8px; font-family:${MONO}; font-size:11px; color:${C.faint}; white-space:nowrap; cursor:pointer;"><span style="width:8px; height:8px; border-radius:99px; border:1px solid ${C.faint}; box-sizing:border-box;"></span>${esc(condLabel(cond))} · ${gate}</span>`;
      }

      const daylight = tb.daylightMs != null ? `${fmtDur(tb.daylightMs)} daylight` : 'no daylight';

      /* The chart carries its own height as an aspect ratio rather than waiting
         for one from above. With `rows: auto` there is no height to inherit, so
         this is what gives it a shape; when the card is pinned to a row count
         instead, flex-grow takes over and it fills the space it is given. */
      const chart = (aspect, maxH) => `
            <!-- Measured to derive its own viewBox height, so it must never be what
                 decides that height — the SVG would fall back to its viewBox aspect
                 and grow the very box it was measured from. Out of flow, it can't.
                 The ceiling keeps a very wide card from turning the chart into a
                 billboard; the floor keeps a very narrow one legible.
                 The sun rides *inside* the chart SVG rather than as an overlay on
                 top of it — see sunMarker/normalizeSunMarkers for why. -->
            <div data-chart style="position:relative; flex:1 1 auto; aspect-ratio:${aspect}; min-height:110px; max-height:${maxH}px; margin-top:6px;">
              <svg viewBox="0 0 300 ${VB_H.toFixed(1)}" preserveAspectRatio="xMidYMid meet" style="position:absolute; inset:0; width:100%; height:100%; display:block; overflow:visible;" role="img" aria-label="Sun path today">
                ${g.defs}
                ${g.bands}
                ${g.headingMark}
                ${g.curve}
                ${hourMarks}
                ${g.riseSet}
                ${hourLabels}
                ${sunMarker(sunX, sunY, C.blue, C, { k: u(1) })}
              </svg>
            </div>`;

      const reading = (size) => `
            <div style="display:flex; align-items:baseline; gap:14px; flex-wrap:wrap;">
              <div style="font-size:${size}px; font-weight:600; line-height:1; color:${C.text}; letter-spacing:-0.02em;">${fmtSigned(el)}</div>
              <div style="font-family:${MONO}; font-size:11px; color:${below ? C.blue : C.orange};">${status}</div>
            </div>`;

      /* Narrow: the two drawings each get the full width, stacked, in the same
         order they read left-to-right when the card is wide — compass, then the
         elevation, then the day path. Sharing a line only looks like a saving:
         it shrinks the compass to a token beside a chart running the full width,
         and the sun marker (a fixed on-screen size in every card) then looms over
         a ring too small to hold it. The cap keeps the compass from ballooning on
         a card that is narrow but not phone-narrow. */
      const body = narrow
        ? `<div style="display:flex; justify-content:center; padding-top:8px;">
            <div style="width:100%; max-width:240px;">
              ${compassSvg({ heading, az, el, lit, C, size: 240, style: 'display:block; width:100%; height:auto;' })}
            </div>
          </div>
          <div style="padding-top:10px;">${reading(38)}</div>
          ${chart('8 / 5', 240)}`
        : `<div style="display:flex; gap:clamp(16px, 3%, 32px); align-items:stretch; flex:1 1 auto; min-height:0; padding-top:6px;">
            <!-- the compass keeps its share of a card that can be any width, so a
                 wide dashboard grows the plan view instead of only the chart -->
            <div style="flex:0 0 auto; width:clamp(150px, 23%, 260px); display:flex; align-items:center; justify-content:center;">
              ${compassSvg({ heading, az, el, lit, C, size: 200, style: 'display:block; width:100%; height:auto;' })}
            </div>
            <div style="flex:1 1 auto; min-width:0; min-height:0; display:flex; flex-direction:column;">
              ${reading(44)}
              ${chart('5 / 2', 240)}
            </div>
          </div>`;

      return this._card(`
        ${this._header(c.name, `heading-up · ${heading}°`)}
        ${body}
        <div style="display:flex; gap:20px; align-items:center; flex-wrap:wrap; padding-top:14px; border-top:1px solid ${C.divider}; margin-top:auto;">
          ${chips}${wxChip}
          <span style="margin-left:auto; font-family:${MONO}; font-size:11px; color:${C.orange}; white-space:nowrap;">${daylight}</span>
        </div>`);
    }
  }

  /* ── registration ───────────────────────────────────────────────────── */
  customElements.define('sun-cards-bearing', SunCardsBearing);
  customElements.define('sun-cards-elevation', SunCardsElevation);
  customElements.define('sun-cards-path', SunCardsPath);
  customElements.define('sun-cards-wide', SunCardsWide);

  window.customCards = window.customCards || [];
  window.customCards.push(
    {
      type: 'sun-cards-bearing',
      name: 'Sun Cards · Bearing',
      preview: true,
      description: 'Heading-up compass with sun position, wall arcs and sun-on-glass windows.',
      documentationURL: REPO,
    },
    {
      type: 'sun-cards-elevation',
      name: 'Sun Cards · Elevation',
      preview: true,
      description: 'Current sun elevation with a 24h curve, min/max and sunrise countdown.',
      documentationURL: REPO,
    },
    {
      type: 'sun-cards-path',
      name: 'Sun Cards · Path',
      preview: true,
      description: "Today's sun path (elevation vs azimuth, heading-up) with wall bands and rise/set.",
      documentationURL: REPO,
    },
    {
      type: 'sun-cards-wide',
      name: 'Sun Cards · Wide',
      preview: true,
      description: 'Compass, elevation and the day path with an hour axis, in one full-width card.',
      documentationURL: REPO,
    }
  );

  // test hooks
  window.__SUN_CARDS__ = { VERSION, solarPos, buildDayTable, glassWindows };

  console.info(
    `%c SUN-CARDS %c v${VERSION} `,
    'background:#f2a35c;color:#131318;border-radius:4px 0 0 4px;padding:2px 6px;font-weight:600;',
    'background:#16171d;color:#f2a35c;border-radius:0 4px 4px 0;padding:2px 6px;'
  );
})();
