# Devpost submission text

Field by field, ready to paste.

## Project name

Air & Allergy Guardian

## Tagline

Personal air-quality and pollen advice for everyone at home, from a real MCP server behind a simulated Alexa+ display.

## Inspiration

"Is the air okay today?" has a different answer for each person in a home. A moderate reading is nothing for one
person and a reason for someone with asthma to take care; grass pollen matters only to whoever is allergic to grass.
Weather apps give one number for everybody. A voice assistant that already knows the household could answer the
question that is actually being asked: is it okay for her, now, and if not, when?

## What it does

- Knows the household: who lives at home, their conditions (asthma, pollen allergy and which pollen types) and where
  home is, set in one sentence ("We live in Munich. Mei has asthma, Dev is allergic to grass and birch pollen...").
- Gives a verdict per person from live readings: PM2.5, PM10, ozone, NO2, the European AQI and six pollen types from
  the Open-Meteo Air Quality API. "Is it okay for Mei to go outside?" gets an answer for Mei, with the reason.
- Plans ahead: "When is the best time for Dev to go for a run tomorrow?" picks the best two-hour daytime window from
  the hourly forecast.
- Warns without being asked: per-person alert rules ("Warn Alex when the air quality index goes above 1"); the display
  checks them every 30 seconds and speaks an alert card when one trips, at most once every six hours per rule.
- Keeps a symptom diary: "Dev has been sneezing a lot today" is logged with the readings at that moment, and "Any
  symptoms logged recently?" summarises the week with the average AQI at those times.
- Says what it does not know: Open-Meteo forecasts pollen for Europe only, so for our demo home in Singapore the
  verdict for a pollen-allergic person reads "pollen is not forecast for this location" instead of guessing.

What is simulated, said plainly: the Alexa+ add-on tooling is open to allowlisted developers only, so the assistant
runs in an Echo-Show-style web page labelled "Simulated Alexa+ experience". The MCP server it talks to is real and is
the piece an Alexa+ add-on would call.

## How we built it

- **MCP server** (`@aag/mcp-server`): TypeScript on Node 22 with the official `@modelcontextprotocol/sdk` 1.32.1,
  Streamable HTTP transport, protocol 2025-11-25. Ten tools: `set_household`, `get_household`, `check_outside`,
  `plan_outdoor_time`, `set_alert_rule`, `list_alert_rules`, `clear_alert_rule`, `watch_tick`, `log_symptom`,
  `recent_symptoms`. Every tool declares an output schema; every result is a ready-to-speak sentence, and successful
  results add matching `structuredContent`.
  Verdicts use the European AQI bands and a pollen scale per type; the worse of air and pollen wins. Storage is one
  JSON file.
- **Simulator** (`@aag/simulator`): a plain TypeScript and Vite page shaped like a smart display, with a clock, an
  "Air now" strip, cards for every answer, typed input, browser speech output and speech input where the browser
  supports it. Behind it, a small Node bridge is a real MCP client of the server: it lists the tools, hands them to a
  local language model (`qwen2.5:7b` served by Ollama, OpenAI-compatible tool calling), runs the calls the model
  chooses over MCP and speaks the result.
- **Keeping answers true**: a 7B model makes predictable tool-calling mistakes, so the bridge checks its work. It
  drops a person the request never named, sends a place name instead of coordinates the model filled in from memory,
  speaks the server's own sentence for anything that changed data or failed, and falls back to a deterministic intent
  router when the model answers without a tool call or with arguments the server rejects.
- **Tests**: 82 Vitest tests (38 server, 44 simulator) on recorded Open-Meteo responses with no network, including a
  full MCP round trip over Streamable HTTP, plus a Playwright end-to-end check that starts the server, the bridge and
  the web page and expects a reply card.

## Challenges we ran into

- No access to the real Alexa+ add-on tooling (allowlist only), so we built the simulated path the rules allow and
  kept the MCP server real.
- Pollen data stops at Europe's borders: Singapore returns null for every pollen type. We report that honestly and use
  Munich to show live pollen.
- A 7B model invents arguments ("Any symptoms logged recently?" called for one member nobody named), fills in
  coordinates instead of place names, and sometimes contradicts the tool it just called. Each case now has a
  deterministic guard and a test.
- The MCP SDK returns bad arguments as an ordinary error result rather than an exception, so the bridge has to
  recognise them to fall back.

## Accomplishments that we're proud of

- A spec-compliant MCP server whose answers are written to be spoken: short sentences, real numbers, the reason.
- Proactive alerts that arrive without a question, which is what a household guardian should do.
- Change confirmations and errors are spoken exactly as the server wrote them, so a paraphrase cannot turn
  "cleared one alert rule" into "there was nothing to clear".
- Every request in our demo script was run end to end through the real UI before recording.

## What we learned

- Small local models are good enough to pick tools for a voice assistant, but only with deterministic checks around
  them; the checks are cheap and testable.
- Writing each tool's result as a finished spoken sentence makes the assistant both simpler and more reliable.
- Data coverage is part of the answer: saying "not forecast here" is better than a confident guess.

## What's next for Air & Allergy Guardian

- Run the same MCP server as a real Alexa+ add-on when the tooling opens up.
- A second pollen source for places outside Europe.
- Push notifications instead of a 30-second poll, and more than one household per server with sign-in.
- Test with a larger model and drop guards it no longer needs.

## Built with

TypeScript, Node.js, @modelcontextprotocol/sdk, zod, Ollama, qwen2.5:7b, Open-Meteo Air Quality API, Open-Meteo
Geocoding API, Vite, Vitest, Playwright, Web Speech API

## Primary track

Alexa+

## Product feedback

Per-tool feedback (what we used each one for, what worked, what needs work, onboarding, and whether we would build
with it again) is in `FEEDBACK.md` in the repository, covering the MCP TypeScript SDK, Ollama, the Open-Meteo Air Quality
API, Vite, Playwright, Vitest and Alexa+ developer program access. In short: the MCP SDK and Open-Meteo were the
easiest parts and we would use both again; the main gaps were validation errors that arrive as ordinary results, no
"not covered" signal for pollen outside Europe, and no access to the Alexa+ add-on tooling.

Friction log: `FRICTION_LOG.md` in the repository (seven entries with steps, expected and actual results, severity,
workaround and suggestion).

## Feature requests

- **Alexa+ add-on tooling for registered hackathon entrants** (time-limited allowlist or a public sandbox that can
  call a public MCP server). Why: the Alexa+ track asks for an add-on that entrants cannot install. Priority: Critical.
- **A machine-readable marker on MCP input-validation error results.** Why: clients can then tell "your arguments were
  wrong" from "the tool ran and said no" without matching error text. Priority: Important.
- **A coverage flag from Open-Meteo when pollen is not forecast for a location.** Why: all-null values look the same
  as "no pollen today". Priority: Nice-to-have.

## Links

- Repository: https://github.com/GitHubMoreLikeGitGud/air-allergy-guardian
- Demo video: https://youtu.be/Naj3bvWCyTo
