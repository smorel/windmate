# Weather Consensus (Multi-Source Rain) — Design Spec

**Date:** 2026-09-11  
**Status:** Implemented (v1)  
**Parent:** [Windmate Design Spec](./2026-09-08-windwatch-design.md)  
**Related:** [Realtime Wind — Weather hazards](./2026-09-08-realtime-wind-design.md#session-hazards), [Planner Full-Day Forecast](./2026-09-11-planner-full-day-forecast-design.md)

## Goal

Align rideability weather gates and planner rain styling with **what users see across models** (e.g. iGetwind GFS precip vs Open-Meteo). For each hour, combine **Open-Meteo context** and **iGetwind model APCP** (from forecasts already fetched for wind) into a **majority vote** instead of trusting Open-Meteo alone.

## Problem

- Wind/gust/direction: mixed **iGetwind** models per spot.
- Rain/storm/temp: single **Open-Meteo** context series (`openMeteoContext.js`).
- Matrix red rain uses client `hasForecastRain` on that single series → misses model-only light precip and over-trusts Open-Meteo-only drizzle when models disagree.

iGetwind `winddata` already includes **`APCP`** (accumulated precip); hourly amount = positive delta between consecutive APCP samples at the same model.

## User decisions (locked)

| Question | Choice |
|----------|--------|
| Planner red rain (`hasForecastRain`) | **B — Majority** of reporting sources must classify the hour as rainy |
| Rideability `weatherOk` | **Majority** of reporting sources must **not** be weather-blocked |
| Thunderstorm | **Any** source reporting storm WMO codes → hour **not** `weatherOk` (hard block) |
| Windy precip supplement | **Out of scope v1** (optional follow-up) |

**Majority rule:** For `n` reporting sources at an hour, a condition holds when `votes >= floor(n / 2) + 1` (strict majority; ties → no rain / not blocked).

Examples: 3 sources → need 2; 4 → need 2; 1 → that source decides.

## Sources (v1)

Each hour, each source independently computes `rainy` and `blocked` using existing thresholds from `weatherHazards.js` (`PRECIP_BLOCK_MM`, rain/storm WMO sets).

| Source id | Data | Rainy | Blocked |
|-----------|------|-------|---------|
| `open-meteo` | Context hourly `precipitation`, `weather_code` | `hasForecastRain` rules | `isWeatherBlocked` rules |
| `lam`, `hrrr`, `gfs`, … | iGetwind `APCP` → hourly mm increment | increment `> 0` | increment `> PRECIP_BLOCK_MM` |
| (missing hour) | Model has no slot for timeline hour | Source **excluded** from vote (not counted as dry) |

Only models present in the spot’s **mixed forecast** response participate (same set as wind matrix rows). Failed models do not vote.

**Storm codes** apply only on Open-Meteo in v1 (iGetwind APCP has no WMO code). Storm hard-block still uses Open-Meteo `weather_code` only.

## Outputs per hour

Merged into each rideability hour object (all models share the same consensus weather for a given `time` — weather is location/context, not model-specific wind):

| Field | Meaning |
|-------|---------|
| `weatherOk` | Majority not blocked **and** no Open-Meteo storm code |
| `hasForecastRain` | Majority rainy (for matrix overlay / `.rain-hour`) |
| `precipitation` | **Median** hourly mm among reporting sources (display/tooltip; 0 if none) |
| `weatherCode` | Open-Meteo code unchanged (storm detection) |
| `weatherConsensus` | `{ reporting, rainy, blocked, storm }` counts for tooltips/debug |

Temp, waves, daylight, air/water gates remain **Open-Meteo context only** (unchanged).

## Architecture

```
fetchMixedForecast(spot)          fetchOpenMeteoContext(spot)
        │                                    │
        ├─ per model: wind + APCP hourly ────┤
        │                                    │
        ▼                                    ▼
              buildWeatherVotesByTime(models, context)
                        │
                        ▼
              applyWeatherConsensus(votes) → Map<time, consensusHour>
                        │
                        ▼
              analyzeHourlyRideability(..., consensusByTime)
                        │
                        ▼
              API rideability hours + matrix UI
```

New module: `src/services/weatherConsensus.js` (pure, unit-tested).

Changes:

| Area | File |
|------|------|
| APCP extraction | `src/services/igetwind.js` — extend normalize (or helper) to attach `hourly.precipitation_mm` from APCP deltas |
| Vote + merge | `src/services/weatherConsensus.js` |
| Rideability | `src/services/rideability.js` — build consensus once per spot analysis; merge into each hour |
| Hazards | `src/services/weatherHazards.js` — export per-source helpers if needed; keep public thresholds |
| Client | `public/js/weatherHazards.js` — prefer server `hour.hasForecastRain` when present; else legacy single-source |
| Tooltips | `public/js/app.js` — optional line: `Rain 2/4 sources` when `weatherConsensus.rainy >= ceil(n/2)` |
| Tests | `test/weatherConsensus.test.js` — majority edge cases, storm override, single-source, APCP deltas |
| Cache | Bump `FORECAST_CACHE_VERSION` only if APCP stored in cache blob (optional; APCP derived at read time from cached winddata if raw block kept — today cache stores normalized hourly only → **must add precip to normalized hourly** and bump cache version) |

## APCP normalization

- Sort APCP rows by time per model.
- For each timestamp, `hourlyMm = max(0, apcp[t] - apcp[t-1])` (first sample: treat as 0 or self-delta per implementation note in tests).
- Align times with existing `normalizeHourlyTimestamp` / wind series keys.
- If a model has wind but no APCP rows, that model abstains for weather vote (does not reduce `n` incorrectly — only counts models with at least one APCP-derived value for that hour or explicit zero APCP pair).

## UI behavior (unchanged mechanics, new inputs)

- **Red overlay / `.rain-hour`:** when consensus `hasForecastRain` (majority rainy).
- **Rideable + minor rain stripe:** unchanged legend; tooltip may say `Rain 2/3 sources` instead of only Open-Meteo.
- **Full-day planner mode:** no change to toggle; consensus applies to all hours with data.
- **Probability row:** still rideable-only (unchanged).

## Edge cases

| Case | Behavior |
|------|----------|
| All models fail, Open-Meteo OK | Vote `n=1` → Open-Meteo alone decides |
| Open-Meteo stale/missing | Vote among iGetwind models only |
| 50/50 split (even n, tie) | `ceil(n/2)` breaks tie toward **rainy/blocked** for the condition being tested (e.g. 2 sources, 1 rainy 1 dry → **not** majority rainy; 2 blocked 2 dry impossible; 2 rainy 2 dry → not majority rainy) |
| Trace APCP noise | Same `PRECIP_BLOCK_MM` as today (default 0.3 mm) |
| Session warnings | Still use post-window lookahead on consensus `weatherOk` hours |

## Out of scope (v1)

- Windy precip as extra voter
- Per-model weather rows in matrix
- Changing temp/wave/daylight sources
- Email/cron copy changes (still rideability-based; consensus indirectly affects counts)

## Acceptance criteria

- [ ] Each iGetwind normalized hourly includes `precipitation` (mm increment from APCP) when APCP present
- [ ] `weatherOk` and `hasForecastRain` on API hours use majority consensus across Open-Meteo + available models
- [ ] Open-Meteo storm code forces `weatherOk === false` regardless of majority
- [ ] Saint-Placide Sat evening: if only one source shows trace rain, matrix **does not** go red (majority dry)
- [ ] When ≥ majority sources show rain, matrix shows red overlay and `.rain-hour` consistent with server flag
- [ ] Unit tests cover vote math, storm override, APCP delta extraction
- [ ] Client matrix respects server `hasForecastRain` when field present
- [ ] `FORECAST_CACHE_VERSION` bumped if cached hourly shape changes

## Follow-ups (v2)

- Windy voter when API key set
- Tooltip breakdown by model name
- Env flag to tune majority vs any for experiments
