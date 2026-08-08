# Sun Cards

Four custom Lovelace cards for Home Assistant that show where the sun is relative to your
house — a compass, an elevation chart, and a sun-path chart, drawn in one shared style, plus
a wide card that folds all three into a single full-width panel.

![Sun Cards on a dark Home Assistant theme](docs/sun-cards-dark.png)

The cards take their surface, borders, and text colors from your active theme, and shift the
amber/blue data accents to deeper variants on light themes so everything stays readable:

![Sun Cards on a light Home Assistant theme](docs/sun-cards-light.png)

| Card | Type | What it shows |
|---|---|---|
| **Bearing** | `custom:sun-cards-bearing` | Heading-up compass: sun position, wall arcs, sun-on-glass time windows, optional weather-gate status |
| **Elevation** | `custom:sun-cards-elevation` | Current elevation, 24 h curve with daylight highlight, min/max, sunrise/sunset countdown |
| **Path** | `custom:sun-cards-path` | Today's sun path (elevation vs azimuth, heading-up), wall bands, rise/set/noon markers |
| **Wide** | `custom:sun-cards-wide` | All three in one full-width card: compass, elevation, and the day path on an hour axis |

All four are bundled in a single file with no dependencies. The full-day curves, rise/set
markers, min/max, and sun-on-glass windows are computed **in-card** from your Home Assistant
latitude/longitude (NOAA solar algorithm, ±2 min / ±0.3°). The *live* sun position comes from
`sun.sun` (or sensor overrides), so the cards update as HA does.

## Install (HACS)

1. HACS → three-dot menu → **Custom repositories**
2. Repository: `https://github.com/tkamenick/lovelace-sun-cards` · Type: **Dashboard**
3. Install **Sun Cards**, then reload your browser when prompted.

HACS registers the resource automatically. For manual installs, copy `sun-cards.js` to
`/config/www/` and add it as a dashboard resource (`/local/sun-cards.js`, JavaScript module).

## Shared options

| Option | Default | Description |
|---|---|---|
| `name` | — | Optional title in the card header. Omitted by default, since the cards read clearly on their own and a title usually just repeats the section heading above them |
| `sun_entity` | `sun.sun` | Source for live azimuth/elevation attributes and `next_rising`/`next_setting` |
| `azimuth_entity` | — | Optional sensor overriding azimuth (e.g. `sensor.sun_azimuth`) |
| `elevation_entity` | — | Optional sensor overriding elevation (e.g. `sensor.sun_elevation`) |
| `latitude` / `longitude` | HA location | Override the coordinates used for the day curves |
| `load_fonts` | `true` | Load the card fonts (Familjen Grotesk / Fragment Mono) from Google Fonts. Set `false` for fully offline dashboards — falls back to system fonts |

In sections-layout dashboards the three narrow cards default to the **same height** (6 grid
rows) so they line up side by side; the internals absorb any slack (the compass centers itself,
charts float, footers pin to the bottom). The wide card asks for `rows: auto` instead, since it
changes shape with its width — see below. Resize any card via its layout options
(`grid_options: rows`) if you want a different height.

The sun marker — a dot inside a dashed ring, with a knockout halo so it stays legible over
wall arcs and the day curve — is drawn at the same on-screen size in every card, at any card
width. Its color differs by card (amber on the compass, blue on the two charts) so it always
contrasts with the artwork underneath it.

### `walls` (bearing, path + wide cards)

```yaml
walls:
  - name: NW wall        # row label; first word is used on the path-card band
    bearing: 325         # wall-normal compass bearing, degrees
    entity: cover.x      # optional — makes the wall row open this entity's more-info
    color: "#a8620f"     # optional — omit to follow the theme accent for this slot
```

Leave `color` out unless you want a specific hue: by default each wall takes the next theme
accent (amber, blue, green, pink), which keeps it readable on both light and dark themes.

| Option | Default | Description |
|---|---|---|
| `heading` | `325` | Compass bearing rendered "up" on the bearing compass and path chart |

### Sun-on-glass rule (bearing, path + wide cards)

| Option | Default | Description |
|---|---|---|
| `sun_window` | `78` | Half-angle: sun is "on the glass" when its azimuth is within ±this of the wall bearing… |
| `min_elevation` | `3` | …and elevation is above this |

These two options define when a wall counts as lit, and everything about a wall is derived
from them: the per-wall times, the glowing dot, the compass arc, and the path-chart band.
They intentionally mirror the `fov` / `min_elevation` inputs of a sun-glare shade automation,
so the card and the automation agree about when the sun is on a given window.

### How the night is drawn (path + wide cards)

The sun path shows a full 24 hours, but the night runs about half as deep as the day runs high
and must not take that share of the chart. It is compressed — smoothly, with a `tanh` knee set
at half the uncompressed depth, so the curve leaves the horizon at roughly two thirds of the rate
it arrived and keeps bending all the way to the bottom of the night.

That sounds like a detail, but it is the difference between one continuous arc and two unrelated
shapes. Compressing the night on its own linear scale meets the horizon at a visible corner: the
day arc plunges, the night leaves nearly flat, and the sun marker after sunset then looks like it
has come loose from the curve — the arc your eye extrapolates is not the one it lands on.
Matching the day's rate exactly overshoots instead, flattening the night into a plateau.

A wall is drawn as **the stretch of sky the sun actually crosses while lighting it today** —
not the window's full ±78° acceptance cone. That distinction matters: the sun only ever
traverses part of the cone, and which part shifts through the year. Drawing the cone would put
a band where the sun never travels in the current season, making it look as though the sun set
before it ever reached those windows. A faint tick on the compass still marks each wall's
bearing, so its orientation reads even on a day it gets no sun at all.

### Weather gate (bearing + wide cards)

| Option | Default | Description |
|---|---|---|
| `weather_entity` | — | Weather entity for the gate row (e.g. `weather.kues`) |
| `bypass_entity` | — | `input_boolean`; when `on` the row shows **gate bypassed** |
| `sunny_conditions` | `[sunny, partlycloudy, windy]` | Conditions that count as "gate open"; anything else shows **cloud hold** |

## The wide card

`custom:sun-cards-wide` is the same three drawings in one full-width card, for dashboards with
a row to spare. It takes the same options as the bearing and path cards combined — `heading`,
`walls`, `sun_window`, `min_elevation`, and the optional weather gate — and needs no extra
configuration.

It is deliberately **not** the three cards stacked. Everything the narrow set could only repeat
is cut: no "below horizon" caption beside an already-negative number, no min/max column, no
bearing restated in a footer next to a compass that is showing it. The row that frees up goes to
an **hour axis along the sun path** — whole-hour dots on the day arc, every third one labeled —
which is the reading a narrow path card never had room for, and the reason to put the compass
and the path on one card: you can see where the sun is, how high, and what time it reaches each
wall without moving between three headers.

### It is responsive — one card, phone to desktop

The card reads **its own rendered width** (not the window's, since the same dashboard can hand it
a third of a desktop row or the full width of a phone) and draws one of two layouts:

| Card width | Layout |
|---|---|
| **≥ 520 px** | Compass on the left, elevation reading and sun path to the right. The compass keeps a constant share of the width (23%, capped at 260 px), so a wider dashboard grows the plan view too — not just the chart. |
| **< 520 px** | Compass, elevation reading and sun path stack, each taking the **full card width** — sharing a line only looks like a saving, since it shrinks the compass to a token beside a full-width chart. Below ~380 px of chart the hour labels thin from every third hour to every sixth, so they never collide. |

This works because the card requests `rows: auto` rather than a fixed row count — it sizes to its
own content, so the taller stacked layout has somewhere to go. The chart carries its height as an
aspect ratio (floor 110 px, ceiling 240 px) so it stays in proportion from 320 px to 1240 px
instead of turning into a letterbox strip on a wide screen. Pin it with `grid_options: rows` if
you want a specific height; the chart will fill whatever it is given.

Verified from 320 px to 1240 px: nothing overflows the card at any width, and the layout settles
in a single measure pass with no reflow thrash.

### If you want different cards on phone vs. desktop anyway

You don't need to — but HA supports it, via a `visibility` block with a `screen` condition on any
card (evaluated with `matchMedia`, so any CSS media query works):

```yaml
# wide card on desktop and larger
- type: custom:sun-cards-wide
  heading: 325
  visibility:
    - condition: screen
      media_query: "(min-width: 1024px)"

# the three narrow cards on phone/tablet
- type: custom:sun-cards-bearing
  heading: 325
  visibility:
    - condition: screen
      media_query: "(max-width: 1023px)"
```

The presets behind HA's UI checkboxes are `mobile` 0–767 px, `tablet` 768–1023 px,
`desktop` 1024–1279 px, `wide` ≥ 1280 px. Note these match the **browser window**, not the card —
which is why the wide card does its own width-based switching rather than relying on them.

## Example: 3-column sections view

See [examples/sun-shades-view.yaml](examples/sun-shades-view.yaml) for a complete sections-layout
view (one card per column) wired to real entities, with the wide card as a full-width
alternative underneath.

## Development

`dev/harness.html` renders all four cards against a mock `hass` object, on both a light and a
dark theme — including the wide card twice, full width and at phone width, so both of its
layouts are visible at once. Serve the repo root (`python3 -m http.server`) and open
`/dev/harness.html`.
Add `?t=HHMM` to stage the clock (e.g. `?t=1730` for golden hour) and `&row=dark|light` to
isolate one theme.

## License

MIT
