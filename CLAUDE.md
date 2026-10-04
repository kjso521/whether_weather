# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"whether weather" — a static web app that colors a map of South Korea's ~250 시·군·구 by hourly forecast, for picking photo-outing (출사) and date spots. `README.md` (Korean) holds the spec, design decisions (section 4) and phased roadmap (section 5); keep its phase status marks current. The user's working language is Korean and they know Python but not frontend tooling.

## Commands

No Node, no build step, no third-party Python packages — keep it that way unless the user agrees otherwise.

```bash
python3 -m http.server 8000 -d web                 # serve the site
python3 scripts/make_sample.py                     # fake weather data for UI work (sets "sample": true)
python3 scripts/collect.py                         # real forecast collection (key from .env or KMA_SERVICE_KEY)
python3 scripts/build_regions.py                   # rebuild web/data/regions.json from the TopoJSON
python3 -m unittest discover -s tests              # all tests
python3 -m unittest tests.test_collect.StoreTest   # one test class
tests/js/run.sh                                    # JS score tests (macOS built-in JavaScriptCore)
```

Scripts import each other as top-level modules, so run them as `python3 scripts/<name>.py` (tests add `scripts/` to `sys.path`).

Only `web/js/scores.js` has JS tests (it must stay free of DOM access so it runs under `jsc`). To check the UI, serve `web/` and screenshot with headless Chrome (`--headless=new --screenshot=... --virtual-time-budget=4000`). CSS transitions do not advance under virtual time, so disable them when screenshotting after simulated clicks.

## Architecture

There is no backend. The browser loads three JSON files from `web/data/`:

- `sigungu.topo.json` — district boundaries (KOSTAT 2018; `properties.code` is the KOSTAT code whose first two digits identify the 시도).
- `regions.json` — code → `{name, sido, lat, lon, nx, ny}`, produced by `build_regions.py` (representative point guaranteed inside the polygon → KMA grid cell).
- `weather_latest.json` — produced by `collect.py` or `make_sample.py` through `weather_store.py`.

Weather is keyed by KMA grid cell `"nx,ny"`, not by district, so districts and (later) arbitrary user-entered places share the same data. Each grid has one array per variable (`TMP, SKY, PTY, POP, PCP, REH, WSD`) aligned by index to the shared `hours` axis; missing values are `null`. The frontend joins district → `regions[code]` → `grids["nx,ny"]`.

`weather_store.py` owns the file format and retention: the window runs from yesterday 00:00 KST to the last forecast hour. Forecasts only cover the future, so `collect.py` merges the previous file in to keep past hours, and a grid whose fetch fails keeps its previous values.

`kma_grid.py` is the Lambert Conformal Conic lat/lon ↔ grid conversion. A JS port will be needed when user-entered places are added; it must give identical results.

All times are KST ISO strings with `+09:00`. `web/js/app.js` handles them by string slicing rather than `Date`, so the display does not depend on the viewer's time zone.

`web/js/app.js` is a single classic script (D3, topojson-client and suncalc are vendored UMD files in `web/vendor/`): one `state` object and one `render()` that repaints everything. A map layer is an entry in `SCORE_LAYERS` (built from `Scores.MODES`) or `WEATHER_LAYERS`.

`web/js/scores.js` holds the 출사 지수 (0–100) as pure functions with all weights in one place. A mode returns `null` outside its time window (e.g. 은하수 only in astronomical night), which the map paints as no-data; picking such a mode jumps the slider to the next applicable hour.

`web/data/weather_latest.json` is git-ignored. `.github/workflows/deploy.yml` downloads the previously deployed copy, runs `collect.py`, and publishes `web/` to GitHub Pages without committing data; a failed collection fails the job so the old site stays up.

Layout: the sidebar (`#side`) holds every control except the time slider. At ≤860px it becomes an off-canvas drawer and the page is just map + slider.

## Design

Claude-like look: warm cream background, clay accent (`--accent: #d97757`), serif headings, light and dark themes via CSS variables in `web/css/style.css`. Use the variables rather than hard-coded colors for UI chrome. Font sizes are limited to the four `--fs-*` tokens — do not add others.
