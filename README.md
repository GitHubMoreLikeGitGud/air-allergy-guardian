# Air & Allergy Guardian

A household air-quality and pollen guardian, built as a **simulated Alexa+ experience** on top of a **real MCP server**.

> Status: in development for the Amazon "Build, Ship, Shape" Developer Hackathon 2026 (Alexa+ track).

Ask "Is it okay for Mei to go outside?" and the guardian answers for Mei in particular: she has asthma, so a moderate
air-quality reading means "take care outside", while Alex, with no conditions, is fine. It knows who lives at home and
what affects each person, finds the best two-hour window for a run, warns someone unprompted when a reading crosses
their threshold, and keeps a small symptom diary that records the air at the time.

- `packages/mcp-server` (`@aag/mcp-server`): self-hosted MCP server (official TypeScript SDK, Streamable HTTP, protocol
  2025-11-25) with ten tools for the household, air quality and pollen, outdoor planning, alert rules and the symptom
  diary, backed by the free Open-Meteo Air Quality API (no key). Every result carries a ready-to-speak sentence, and
  successful results also carry `structuredContent` matching the tool's declared output schema.
- `packages/simulator` (`@aag/simulator`): an Echo-Show-style web page whose assistant is a local language model
  (`qwen2.5:7b` through Ollama) acting as a real MCP client of that server, with a deterministic intent router as the
  fallback. Replies are shown as cards and spoken with the browser's speech synthesis; a 30-second poll of the
  `watch_tick` tool produces unprompted alert cards.

## What is simulated, said plainly

The assistant UI and voice are a stand-in for Alexa+: the Alexa+ add-on tooling is open to allowlisted developers only,
so nothing here runs on an Echo device or inside Alexa. The page is labelled "Simulated Alexa+ experience" at all times
and uses no Amazon or Echo logos. The MCP server is real and is the piece an Alexa+ add-on would call. The air-quality
and pollen readings are live from Open-Meteo; the tests use recorded responses.

## Quick start

Needs Node 22 or later. For the language-model path, Ollama serving `qwen2.5:7b` at `http://localhost:11434`;
without it every request goes through the intent router.

```sh
npm install
npm run build
npm start -w @aag/mcp-server       # terminal 1: MCP server on http://127.0.0.1:3333/mcp
npm run dev -w @aag/simulator      # terminal 2: bridge (:3334) + web UI on http://localhost:5173
npm test                           # vitest in both packages, recorded fixtures, no network
npx playwright install chromium    # once, for the end-to-end check
npm run e2e -w @aag/simulator      # Playwright: server + bridge + preview, types one question, expects a reply card
```

The first run starts from a demo household in central Singapore (1.2838, 103.8591) with three members: Mei (asthma),
Dev (grass and birch pollen allergy) and Alex (no conditions). Changes are saved to `packages/mcp-server/data/household.json`
(gitignored); set `AAG_DATA_FILE` to keep them somewhere else. Each package README has the details, and
`docs/DEMO-SCRIPT.md` lists a sequence of requests that has been run end to end.

## How the bridge keeps answers true

A 7B model calling tools makes predictable mistakes, so the bridge (`packages/simulator/bridge/agent.ts`) checks its
work before anything is spoken:

- If the first round has no tool call, an unknown tool, unparsable arguments, or arguments the server rejects, the turn
  goes to the intent router, which maps the request to one tool call with regexes.
- A `member` argument is dropped when the request names nobody in the household, does not say that name and has no
  pronoun, so "Any symptoms logged recently?" covers everyone instead of a member the model picked.
- For `set_household`, coordinates the model filled in from memory are replaced by the place the request named, so the
  server geocodes it and stores a spoken label ("Home is set to Munich, Germany").
- For tools that change something, and for any tool that answered with an error, the server's own sentence is spoken
  as written, so a paraphrase cannot invert it. A model sentence that promises an unmade check or reads a tool name
  aloud is also replaced by the tool's words.

## Known limits

- Open-Meteo forecasts pollen for Europe only. For the Singapore demo home every pollen value is null, and the
  guardian says "pollen is not forecast for this location" instead of guessing; move home to a European city (for
  example "Set home to Munich") to see live pollen values.
- Speech input uses the browser's `SpeechRecognition` where it exists; it has not been tested with a microphone.
- One household per server, stored in a JSON file, with no sign-in.

## More

- `FEEDBACK.md`: product feedback on each tool, API and SDK used.
- `FRICTION_LOG.md`: what got in the way, with workarounds and suggestions.
- `SUBMISSION.md`: the hackathon submission text.

License: MIT.
