/*! Sun Cards — "Observatory" Lovelace card set for Home Assistant
 *  https://github.com/tkamenick/lovelace-sun-cards
 *
 *  Three cards:
 *    · custom:sun-cards-bearing   — heading-up compass with wall arcs + sun-on-glass windows
 *    · custom:sun-cards-elevation — current elevation with 24h curve and min/max
 *    · custom:sun-cards-path      — elevation-vs-azimuth day arc, heading-up, wall bands
 *
 *  All astronomy is computed in-card from hass.config.latitude/longitude; the live
 *  sun position comes from sun.sun (or sensor overrides). No external dependencies.
 */
(() => {
  'use strict';

  const VERSION = '1.2.0';
  const REPO = 'https://github.com/tkamenick/lovelace-sun-cards';

  /* ── palettes ───────────────────────────────────────────────────────────
   *  theme (default): surfaces + neutral text from the active HA theme, with
   *  the original Observatory values as fallbacks. observatory: the design's
   *  self-contained dark look (use_theme_colors: false).                    */
  const ORANGE = '#f2a35c';
  const BLUE = '#8fa8d9';
  const PALETTES = {
    observatory: {
      text: '#e8e6e1',
      ink: '#c9c7c2',
      dim: '#8b8d96',
      faint: '#565963',
      ghost: '#3a3d46',
      line: '#ffffff',
      divider: 'rgba(255,255,255,0.06)',
      orange: ORANGE,
      blue: BLUE,
    },
    theme: {
      text: 'var(--primary-text-color, #e8e6e1)',
      ink: 'var(--primary-text-color, #c9c7c2)',
      dim: 'var(--secondary-text-color, #8b8d96)',
      faint: 'var(--disabled-text-color, #565963)',
      ghost: 'var(--disabled-text-color, #3a3d46)',
      line: 'var(--primary-text-color, #ffffff)',
      divider: 'var(--divider-color, rgba(255,255,255,0.06))',
      orange: ORANGE,
      blue: BLUE,
    },
  };
  const OBS_CARD =
    'border-radius:22px; background:linear-gradient(180deg,#16171d,#101116); border:1px solid rgba(255,255,255,0.07); box-shadow:none;';
  const MONO = "'Fragment Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
  const SANS = "'Familjen Grotesk','Instrument Sans',system-ui,-apple-system,sans-serif";
  const MONO_SVG = 'Fragment Mono, ui-monospace, Menlo, monospace';
  const SANS_SVG = 'Familjen Grotesk, system-ui, sans-serif';
  const WALL_COLORS = [ORANGE, BLUE, '#a8d98f', '#d98fa8'];

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

  const CONDITION_LABELS = { partlycloudy: 'partly cloudy', 'clear-night': 'clear night' };
  const condLabel = (s) => CONDITION_LABELS[s] || String(s).replace(/-/g, ' ');

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
            color: w.color || WALL_COLORS[i % WALL_COLORS.length],
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
      if (this._hass && this._config) this._render();
    }

    disconnectedCallback() {
      clearInterval(this._timer);
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
    }

    _pal() {
      return this._config?.use_theme_colors === false ? PALETTES.observatory : PALETTES.theme;
    }

    _card(inner) {
      const C = this._pal();
      const skin = this._config?.use_theme_colors === false ? ` ${OBS_CARD}` : '';
      return `<ha-card style="display:flex; flex-direction:column; box-sizing:border-box; height:100%; padding:24px 26px 22px;${skin} color:${C.text}; font-family:${SANS};">${inner}</ha-card>`;
    }

    _header(left, right, rightColor) {
      const C = this._pal();
      return `<div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
        <div style="font-family:${MONO}; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${C.dim}; white-space:nowrap;">${esc(left)}</div>
        <div style="font-family:${MONO}; font-size:11px; color:${rightColor || C.faint}; white-space:nowrap;">${right}</div>
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
      name: 'Sun bearing',
      heading: 325,
      walls: [
        { name: 'NW wall', bearing: 325, color: ORANGE },
        { name: 'SW wall', bearing: 236, color: BLUE },
      ],
      wall_arc: 60, // drawn arc width (visual)
      sun_window: 78, // half-angle for sun-on-glass windows
      min_elevation: 3,
      sun_entity: 'sun.sun',
      sunny_conditions: ['sunny', 'partlycloudy'],
      use_theme_colors: true,
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
      const walls = c.walls || [];

      const pt = (azm, r) => {
        const a = (azm - heading) * RAD;
        return [(120 + r * Math.sin(a)).toFixed(1), (120 - r * Math.cos(a)).toFixed(1)];
      };
      const arc = (b, w) => {
        const [x1, y1] = pt(b - w / 2, 88);
        const [x2, y2] = pt(b + w / 2, 88);
        return `M ${x1} ${y1} A 88 88 0 ${w > 180 ? 1 : 0} 1 ${x2} ${y2}`;
      };
      const letter = (azm, label, color) => {
        const [x, y] = pt(azm, 105);
        return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="${color}" font-family="${MONO_SVG}" font-size="11">${label}</text>`;
      };

      const [t1x, t1y] = pt(0, 82);
      const [t2x, t2y] = pt(0, 93);
      const [sx, sy] = pt(az, 88);
      const sunDim = el > 0 ? 1 : 0.55;

      const arcs = walls
        .map(
          (w) =>
            `<path d="${arc(w.bearing, c.wall_arc)}" fill="none" stroke="${w.color}" stroke-width="3.5" stroke-linecap="round" opacity="0.85"></path>`
        )
        .join('');

      const rows = walls
        .map((w) => {
          const wins = glassWindows(tb.pts, w.bearing, c.sun_window, c.min_elevation);
          const times = wins.length
            ? 'sun ' + wins.slice(0, 2).map((win) => fmtRange(hass, win.start, win.end)).join(' · ')
            : 'no direct sun';
          const active = el > c.min_elevation && angDiff(az, w.bearing) <= c.sun_window;
          const dotGlow = active ? ` box-shadow:0 0 7px 1px ${w.color};` : '';
          const click = w.entity ? ` data-entity="${esc(w.entity)}" role="button"` : '';
          return `<div${click} style="display:flex; justify-content:space-between; align-items:center; gap:10px;${w.entity ? ' cursor:pointer;' : ''}">
            <span style="display:flex; align-items:center; gap:8px; font-family:${MONO}; font-size:11px; color:${C.ink}; white-space:nowrap;"><span style="width:8px; height:8px; border-radius:99px; background:${w.color};${dotGlow}"></span>${esc(w.name)} · ${Math.round(w.bearing)}°</span>
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
          <svg width="220" height="220" viewBox="0 0 240 240" role="img" aria-label="Sun bearing compass">
            <path d="M 114 12 L 120 3 L 126 12 Z" fill="${C.faint}"></path>
            <circle cx="120" cy="120" r="88" fill="none" stroke="${C.line}" stroke-opacity="0.10" stroke-width="1"></circle>
            <circle cx="120" cy="120" r="70" fill="none" stroke="${C.line}" stroke-opacity="0.045" stroke-width="1" stroke-dasharray="2 5"></circle>
            <line x1="${t1x}" y1="${t1y}" x2="${t2x}" y2="${t2y}" stroke="${C.line}" stroke-opacity="0.35" stroke-width="1.5"></line>
            ${letter(0, 'N', C.ink)}${letter(90, 'E', C.faint)}${letter(180, 'S', C.faint)}${letter(270, 'W', C.faint)}
            ${arcs}
            <circle cx="${sx}" cy="${sy}" r="11" fill="none" stroke="${C.orange}" stroke-width="1" stroke-dasharray="2.5 3" opacity="${(0.7 * sunDim).toFixed(2)}"></circle>
            <circle cx="${sx}" cy="${sy}" r="5.5" fill="${C.orange}" opacity="${(0.6 * sunDim).toFixed(2)}"></circle>
            <text x="120" y="116" text-anchor="middle" fill="${C.text}" font-family="${SANS_SVG}" font-weight="600" font-size="40">${Math.round(az)}°</text>
            <text x="120" y="140" text-anchor="middle" fill="${C.dim}" font-family="${MONO_SVG}" font-size="13">sun · ${cardinal16(az)}</text>
          </svg>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; padding-top:14px; border-top:1px solid ${C.divider}; margin-top:10px;">
          ${rows}${wxRow}
        </div>`);
    }
  }

  /* ══ Card 2 · sun-cards-elevation — 24h elevation curve ══════════════ */
  class SunCardsElevation extends SunCardsBase {
    static defaults = {
      name: 'Sun elevation',
      sun_entity: 'sun.sun',
      use_theme_colors: true,
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
        <div style="margin:auto 0;">
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
          <circle cx="${nx}" cy="${ny}" r="4" fill="${C.blue}"></circle>
          <circle cx="${nx}" cy="${ny}" r="8" fill="none" stroke="${C.blue}" stroke-width="1" opacity="0.4"></circle>
          <text x="2" y="92" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">12AM</text>
          <text x="70" y="92" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">6AM</text>
          <text x="140" y="92" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">12PM</text>
          <text x="210" y="92" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">6PM</text>
          <text x="278" y="92" text-anchor="end" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">12AM</text>
        </svg>
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
      name: 'Sun path',
      heading: 325,
      walls: [
        { name: 'NW wall', bearing: 325, color: ORANGE },
        { name: 'SW wall', bearing: 236, color: BLUE },
      ],
      wall_arc: 60,
      sun_entity: 'sun.sun',
      use_theme_colors: true,
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
      const [lat, lon] = this._latlon();
      const now = new Date();
      const walls = c.walls || [];

      const rel = (azm) => ((azm - heading + 540) % 360) - 180;
      const bx = (azm) => ((rel(azm) + 180) * 300) / 360;
      const maxEl = Math.max(tb.max.el, 5);
      const minEl = Math.min(tb.min.el, -2);
      const yTop = 14;
      const yHor = 110;
      const nightDepth = 26;
      const Y = (e) => (e >= 0 ? yHor - (e / maxEl) * (yHor - yTop) : yHor + (-e / -minEl) * nightDepth);

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

      const bandW = (c.wall_arc * 300) / 360;
      const bands = walls
        .map((w) => {
          const cx = bx(w.bearing);
          const L = cx - bandW / 2;
          const R = cx + bandW / 2;
          const rects = [];
          const add = (l, r) => {
            l = Math.max(0, l);
            r = Math.min(300, r);
            if (r > l)
              rects.push(
                `<rect x="${l.toFixed(1)}" y="14" width="${(r - l).toFixed(1)}" height="96" fill="${w.color}" opacity="0.08"></rect>`
              );
          };
          add(L, R);
          if (L < 0) add(L + 300, R + 300);
          if (R > 300) add(L - 300, R - 300);
          const short = esc(String(w.name || '').split(/\s+/)[0].toUpperCase());
          return (
            rects.join('') +
            `<text x="${cx.toFixed(1)}" y="105" text-anchor="middle" fill="${w.color}" font-family="${MONO_SVG}" font-size="9" opacity="0.85">${short} ${Math.round(w.bearing)}°</text>`
          );
        })
        .join('');

      const noonX = bx(tb.max.az).toFixed(1);
      const noonY = Y(tb.max.el).toFixed(1);

      let riseSet = '';
      if (tb.rise && tb.set) {
        const riseX = bx(solarPos(tb.rise, lat, lon).az).toFixed(1);
        const setX = bx(solarPos(tb.set, lat, lon).az).toFixed(1);
        riseSet = `
          <line x1="${riseX}" y1="110" x2="${riseX}" y2="117" stroke="${C.line}" stroke-opacity="0.3" stroke-width="1"></line>
          <line x1="${setX}" y1="110" x2="${setX}" y2="117" stroke="${C.line}" stroke-opacity="0.3" stroke-width="1"></line>
          <text x="${riseX}" y="144" text-anchor="middle" fill="${C.ink}" font-family="${MONO_SVG}" font-size="10">rise ${fmtTime(hass, tb.rise)}</text>
          <text x="${setX}" y="144" text-anchor="middle" fill="${C.ink}" font-family="${MONO_SVG}" font-size="10">set ${fmtTime(hass, tb.set)}</text>`;
      }

      const sunX = bx(az).toFixed(1);
      const sunY = Y(el).toFixed(1);
      const daylight = tb.daylightMs != null ? `${fmtDur(tb.daylightMs)} daylight` : 'no daylight';
      const nowTxt = el < 0 ? 'now: below horizon' : `now: ${fmtSigned(el)} · az ${Math.round(az)}°`;
      const nxt = this._nextEvent();
      const nextTxt = nxt ? `next ${nxt.label} ${fmtTime(hass, nxt.t)}` : '';

      return this._card(`
        ${this._header(c.name, daylight, C.orange)}
        <div style="margin:auto 0; padding-top:14px;">
        <svg width="100%" height="172" viewBox="0 0 300 172" style="display:block; overflow:visible;" role="img" aria-label="Sun path today">
          <defs>
            <linearGradient id="sc-path-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${C.orange}" stop-opacity="0.38"></stop>
              <stop offset="1" stop-color="${C.orange}" stop-opacity="0.03"></stop>
            </linearGradient>
          </defs>
          ${bands}
          <path d="M 146 8 L 150 2 L 154 8 Z" fill="${C.faint}"></path>
          <line x1="150" y1="12" x2="150" y2="110" stroke="${C.line}" stroke-opacity="0.12" stroke-width="1" stroke-dasharray="2 4"></line>
          <text x="158" y="10" text-anchor="start" fill="${C.faint}" font-family="${MONO_SVG}" font-size="9">${heading}°</text>
          <path d="${dayFill}" fill="url(#sc-path-g)"></path>
          <path d="${fullCurve}" fill="none" stroke="${C.line}" stroke-opacity="0.22" stroke-width="1.5"></path>
          <path d="${dayStroke}" fill="none" stroke="${C.orange}" stroke-width="1.5" opacity="0.9"></path>
          <line x1="0" y1="110" x2="300" y2="110" stroke="${C.line}" stroke-opacity="0.16" stroke-width="1"></line>
          <text x="2" y="106" fill="${C.ghost}" font-family="${MONO_SVG}" font-size="8" letter-spacing="1">HORIZON 0°</text>
          <line x1="${noonX}" y1="${noonY}" x2="${noonX}" y2="10" stroke="${C.line}" stroke-opacity="0.15" stroke-width="1" stroke-dasharray="2 3"></line>
          <text x="${noonX}" y="8" text-anchor="middle" fill="${C.dim}" font-family="${MONO_SVG}" font-size="9">noon ${fmtSigned(tb.max.el, 0)}</text>
          ${riseSet}
          <text x="${bx(0).toFixed(1)}" y="124" text-anchor="middle" fill="${C.dim}" font-family="${MONO_SVG}" font-size="10">N</text>
          <text x="${bx(90).toFixed(1)}" y="124" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="10">E</text>
          <text x="${bx(180).toFixed(1)}" y="124" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="10">S</text>
          <text x="${bx(270).toFixed(1)}" y="124" text-anchor="middle" fill="${C.faint}" font-family="${MONO_SVG}" font-size="10">W</text>
          <circle cx="${sunX}" cy="${sunY}" r="4.5" fill="${C.blue}" opacity="0.85"></circle>
          <circle cx="${sunX}" cy="${sunY}" r="8" fill="none" stroke="${C.blue}" stroke-width="1" stroke-dasharray="2.5 3" opacity="0.45"></circle>
          <text x="298" y="166" text-anchor="end" fill="${C.ghost}" font-family="${MONO_SVG}" font-size="9" letter-spacing="1">AZIMUTH → · HEADING-UP ${heading}°</text>
        </svg>
        </div>
        <div style="display:flex; justify-content:space-between; gap:12px; padding-top:14px; border-top:1px solid ${C.divider}; margin-top:10px;">
          <span style="font-family:${MONO}; font-size:10px; color:${C.faint}; white-space:nowrap;">${nowTxt}</span>
          <span style="font-family:${MONO}; font-size:10px; color:${C.dim}; white-space:nowrap;">${nextTxt}</span>
        </div>`);
    }
  }

  /* ── registration ───────────────────────────────────────────────────── */
  customElements.define('sun-cards-bearing', SunCardsBearing);
  customElements.define('sun-cards-elevation', SunCardsElevation);
  customElements.define('sun-cards-path', SunCardsPath);

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
    }
  );

  // test hooks
  window.__SUN_CARDS__ = { VERSION, solarPos, buildDayTable, glassWindows };

  console.info(
    `%c SUN-CARDS %c v${VERSION} · Observatory `,
    'background:#f2a35c;color:#131318;border-radius:4px 0 0 4px;padding:2px 6px;font-weight:600;',
    'background:#16171d;color:#f2a35c;border-radius:0 4px 4px 0;padding:2px 6px;'
  );
})();
