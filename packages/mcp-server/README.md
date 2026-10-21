# @aag/mcp-server

A self-hosted MCP server for a household air-quality and pollen guardian. It speaks Streamable HTTP on
`http://127.0.0.1:3333/mcp` using the official `@modelcontextprotocol/sdk` (1.32.x, protocol `2025-11-25`), and reads
air quality and pollen from the free Open-Meteo Air Quality API (no key).

## Run

```sh
npm install            # at the repo root
npm run build -w @aag/mcp-server
npm start -w @aag/mcp-server      # or: npm run dev -w @aag/mcp-server (tsx watch)
npm run smoke -w @aag/mcp-server  # MCP client over HTTP, calls check_outside against the live API
npm test -w @aag/mcp-server       # vitest, recorded fixtures only, no network
```

Environment: `AAG_PORT` (default 3333), `AAG_HOST` (default 127.0.0.1), `AAG_DATA_FILE` (default `data/household.json`).
`GET /health` reports the name, version and protocol version.

## Tools

Every tool returns a ready-to-speak sentence as its text content and the same facts as `structuredContent`
(each tool declares an `outputSchema`).

| Tool | What it does |
| --- | --- |
| `set_household` / `get_household` | Members with conditions (`asthma`, `pollen_allergy`, `none`, optional pollen types) and the home location (coordinates, or a place name geocoded through Open-Meteo). |
| `check_outside` | Current PM2.5, PM10, ozone, NO2, European AQI and six pollen types, with a verdict per member: `good`, `caution` or `stay_in`, and the reason. |
| `plan_outdoor_time` | Best two-hour daytime window (07:00 to 21:00) today or tomorrow for one member, from the hourly forecast. |
| `set_alert_rule` / `list_alert_rules` / `clear_alert_rule` | Per-member thresholds on any reading. |
| `watch_tick` | For a timer: evaluates the rules and returns `{alert: null}` or `{alert: {speech, member, reason}}`. A rule does not fire again within six hours; the last firing time is persisted. |
| `log_symptom` / `recent_symptoms` | A small diary; each entry stores the readings at the time it was logged, and the summary gives the average European AQI at those times. |

## Verdict rules

European AQI bands follow the European Environment Agency index that Open-Meteo reports: good (0-20), fair (20-40),
moderate (40-60), poor (60-80), very poor (80-100), extremely poor (above 100). Good and fair are `good` for everyone;
moderate is `caution` for asthma; poor and very poor are `stay_in` for asthma and `caution` for others; extremely poor
is `stay_in` for everyone. For members with a pollen allergy, their pollen types are graded on the National Allergy
Bureau scale (trees, grass, weeds): moderate pollen adds `caution`, high or very high adds `stay_in`. The worse of the
two verdicts wins.

Open-Meteo's pollen forecast covers Europe only; elsewhere the pollen series are null and the verdict says so.

## Storage

One JSON file, `data/household.json` (gitignored). When it does not exist the server reads `data/household.example.json`
(the demo home at 1.2838, 103.8591) and creates the real file on the first write.

## Tests

`test/fixtures/` holds one recorded Open-Meteo air-quality response (Singapore, 2026-10-17) and one geocoding response.
Tests mock `fetch` with them and cover the verdict bands, the planner, alert de-duplication and a full MCP round trip
over Streamable HTTP (initialize, `tools/list`, `tools/call`).
