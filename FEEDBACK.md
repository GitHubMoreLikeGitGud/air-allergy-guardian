# Product feedback

One section per tool, API or SDK used in this project, with the versions that are in `package-lock.json` or that were
running on the build machine. Every point below comes from something that happened while building or testing this repo.

## @modelcontextprotocol/sdk (TypeScript, 1.32.1)

**What we used it for.** The whole server side (`McpServer`, `registerTool` with zod input and output schemas,
`StreamableHTTPServerTransport` with one session per client) and the client side in the simulator bridge (`Client` with
`StreamableHTTPClientTransport`). The server reports protocol `2025-11-25`, which is the SDK's `LATEST_PROTOCOL_VERSION`
in this release. The MCP round-trip test drives the real HTTP transport on a random port.

**What worked well.**
- `registerTool` with a zod shape gives input validation, the JSON schema for `tools/list` and `structuredContent`
  checking against `outputSchema` in one place. All ten tools declare an output schema with no extra code.
- The Streamable HTTP transport plugged into a plain `node:http` server without a framework. Sessions keyed by
  `Mcp-Session-Id` were a few lines (`onsessioninitialized`, `onsessionclosed`).
- Restarting the server under a running bridge needed no bridge restart: the bridge opens a new `Client` session on
  the next call and carries on.
- Testing was easy: a real client and a real server in one vitest file, no mocks of the protocol.

**What needs work.**
- Bad arguments do not throw on the client. They come back as a normal tool result with `isError: true` and the text
  `MCP error -32602: Input validation error: Invalid arguments for tool ...`. A tool's own error ("I don't have anyone
  called Mira in the household") arrives the same way, so a client that wants to retry or fall back on bad arguments
  has to match the error text. A machine-readable marker (an error code field, or throwing as before) would help.
- Optional fields declared with `.optional()` reject `null`, and language models often send `"member": null` for "no
  member". That is correct zod behaviour, but a note in the docs about clients that send `null` would save time.

**Onboarding.** The server package, with all ten tools and a passing round trip over Streamable HTTP, was committed
on the first build day (2026-10-17). Per-session handling for Streamable HTTP meant reading the transport options
(`sessionIdGenerator`, `onsessioninitialized`, `onsessionclosed`) rather than a single quick-start snippet.

**Would we build with it again?** Yes. It is the shortest path to a spec-compliant server and it let one codebase act as
both the server and a real client.

## Ollama (0.34.4) with qwen2.5:7b

**What we used it for.** The simulator's assistant: the bridge sends the MCP tool list as function tools to Ollama's
OpenAI-compatible `POST /v1/chat/completions` endpoint, runs the tool calls through MCP and feeds the results back.

**What worked well.**
- The OpenAI-compatible endpoint with native tool calling worked first time with a plain `fetch`; no SDK was needed.
- Latency on the build machine was fine for a voice-style turn: in the bridge log on 2026-10-21, turns took 0.3 to
  1.4 seconds end to end with the model warm.
- When the model name is wrong the endpoint answers with a clear HTTP 404, which made the fallback path easy to test.

**What needs work.** These are behaviours of a 7B model through the tool-calling API, seen in real runs:
- It sometimes invents an argument: "Any symptoms logged recently?" was called with `member: "Mei"` on 2026-10-17 and
  twice again on 2026-10-21, even with a prompt line telling it not to.
- It sometimes sends `member: null` for "everyone", which the server rejects.
- It fills in coordinates from its own knowledge for "We live in Munich" instead of passing the place name, so no place
  label was stored; a system-prompt line asking for the place name did not change that in four tries.
- It sometimes answers with a sentence instead of a tool call ("Mei, Dev, and Alex live here...").
- Its final sentence can contradict the tool result: after `clear_alert_rule` said "Cleared one alert rule" it said
  there were none to clear, and after "I don't have anyone called Mira" it said everyone could go for a run.

Each of these is now handled in the bridge (see the README), but they are the reason the bridge has a deterministic
fallback at all.

**Onboarding.** The model was already pulled on the build machine. Talking to it needed no Ollama-specific code: an
OpenAI-style request to `http://localhost:11434/v1/chat/completions` with a `tools` array.

**Would we build with it again?** Yes for local development and demos: no key, no cost, and the same code would talk to
any OpenAI-compatible endpoint. For production we would test a larger model first.

## Open-Meteo Air Quality API (and its Geocoding API)

**What we used it for.** Current and hourly PM2.5, PM10, ozone, NO2, European AQI and six pollen types for the home
location, and place-name lookup for `set_household`.

**What worked well.**
- No key, no sign-up, and one GET request returns current and hourly values with units.
- The European AQI is already computed, which made the verdict bands simple.
- Responses are small and stable enough to record as test fixtures; all tests run without network.

**What needs work.**
- Pollen is null outside Europe. For Singapore (our demo home) every pollen series was null on 2026-10-17 and again on
  2026-10-21, while Munich returned numbers. The docs do say pollen is "only available in Europe during pollen season",
  but the response has no field that says "not covered here", so a client cannot tell "no pollen" from "no data"
  without knowing the rule. We treat all-null as "pollen is not forecast for this location" and say so.
- In mid to late October Munich pollen is near zero, so a live high-pollen case could not be shown this week; the
  pollen bands are covered by fixture tests only.

**Onboarding.** The interactive docs page builds the URL for you. Hello world was a single `curl`.

**Would we build with it again?** Yes. For a pollen product outside Europe we would add a second pollen source.

## Vite (8.3.4)

**What we used it for.** Dev server and production build for the simulator UI (plain TypeScript, no framework), with
a `/api` proxy to the bridge.

**What worked well.** Production builds take well under a second, and `vite preview` reused the dev server's
proxy, so dev, preview and the end-to-end test all reach the bridge through the same `/api` path with one config.

**What needs work.** Nothing blocked us.

**Onboarding.** A config file of about 20 lines.

**Would we build with it again?** Yes.

## Playwright (1.64.1)

**What we used it for.** `npm run e2e -w @aag/simulator`: starts the MCP server, the bridge and `vite preview` on their
own ports, opens headless Chromium, types a question and checks that a reply card appears, then saves a screenshot.

**What worked well.** The library API (`chromium.launch()`, `page.fill`, locators with `waitFor`) was enough without
the test runner, so the script is one small file.

**What needs work.** Nothing blocked us. Browsers are a separate download (`npx playwright install chromium`), so the
README has to say so for a fresh clone.

**Onboarding.** Short: one `chromium.launch()` and a page.

**Would we build with it again?** Yes.

## Vitest (4.1.12)

**What we used it for.** Unit and integration tests in both packages: verdict bands, planner, alert de-duplication, the
MCP round trip over HTTP, the intent router, and the bridge's tool-call loop with a fake model.

**What worked well.** TypeScript and ESM with no extra setup, and each package's suite runs in under a second.

**What needs work.** Nothing blocked us. Run through npm workspaces, each package prints its own summary, so there is no
single total at the root.

**Onboarding.** One config file per package.

**Would we build with it again?** Yes.

## Alexa+ developer program access

**What we used it for.** We wanted to ship this as a real Alexa+ add-on. We could not, and built the simulated path the
hackathon rules allow instead.

**What worked well.** The track requirements are clear about MCP (spec 2025-11-25 over Streamable HTTP), so the server
we built is the piece an add-on would call.

**What needs work.** The add-on tooling is open to allowlisted developers only. `npm view @alexa-ai/cli` returns 404 on
the public npm registry (checked 2026-10-21), so we could not install it, run it, or test on a device. For a public
hackathon track, a public sandbox or a time-limited allowlist for registered entrants would let people build the real
thing.

**Onboarding.** We did not get past the allowlist.

**Would we build with it again?** Yes, once access is open: the MCP server here is meant to be that add-on's backend.
