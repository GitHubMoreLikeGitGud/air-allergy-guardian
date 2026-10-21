# @aag/simulator

A **simulated Alexa+ experience**: an Echo-Show-style web page whose assistant is a local LLM acting as a real MCP
client of `@aag/mcp-server`. The label "Simulated Alexa+ experience" is always on screen; there are no Amazon or Echo
logos.

```
browser (Vite, plain TypeScript)  --/api-->  bridge (Node, tsx)  --MCP Streamable HTTP-->  @aag/mcp-server
   typed or spoken request                      |                                              |
   SpeechSynthesis voice out                    +--OpenAI-compatible chat--> Ollama qwen2.5:7b  +--> Open-Meteo
```

## Run

```sh
npm install                               # repo root
npm run build                             # repo root
npm start -w @aag/mcp-server              # terminal 1: MCP server on http://127.0.0.1:3333/mcp
npm run dev -w @aag/simulator             # terminal 2: bridge on :3334 + Vite dev server on http://localhost:5173
```

Ollama must be serving `qwen2.5:7b` at `http://localhost:11434` for the LLM path; without it the bridge logs that the
endpoint is unreachable and every request goes through the deterministic intent router instead.

Other scripts: `npm run build` (type-checks the UI and the bridge, then `vite build`), `npm test` (vitest, no
network), `npm run e2e` (Playwright: starts server, bridge and `vite preview` on their own ports, types a question,
asserts a reply card; run `npx playwright install chromium` once first). `npm run bridge` runs the bridge alone.

Environment: `AAG_BRIDGE_PORT` (3334), `AAG_BRIDGE_HOST` (127.0.0.1), `AAG_MCP_URL` (`http://127.0.0.1:3333/mcp`),
`AAG_OLLAMA_URL` (`http://localhost:11434/v1`), `AAG_MODEL` (`qwen2.5:7b`), `AAG_LLM_TIMEOUT_MS` (90000),
`AAG_LLM=off` to force the router. The Vite proxy reads `AAG_BRIDGE_PORT` too.

## The bridge (`bridge/`)

- `mcp.ts`: MCP client over Streamable HTTP (`@modelcontextprotocol/sdk`). Connects at start, lists the tools, calls
  them, reconnects once if the server was restarted.
- `llm.ts`: Ollama's OpenAI-compatible `POST /v1/chat/completions` with native tool calling. The MCP tools are passed
  as function tools with their JSON schema; `watch_tick` is withheld from the model because it is for the timer.
- `agent.ts`: the conversation loop, capped at three model rounds. Tool calls are executed through MCP and the text
  plus `structuredContent` are fed back as `tool` messages. Before a call runs, two guards check the model's
  arguments against the request: a `member` is dropped when the request names nobody in the household, does not say
  that name and has no pronoun; and for `set_household`, coordinates the model filled in are swapped for the place the
  request named (when the request gave no coordinates), so the server geocodes it and stores the label. For questions
  (`check_outside`, `plan_outdoor_time`, `list_alert_rules`, `recent_symptoms`, `get_household`) the model's final
  sentence is what gets spoken; for tools that change something (`set_household`, `set_alert_rule`,
  `clear_alert_rule`, `log_symptom`), and for any tool that answered with an error, the server's own sentence is spoken
  as it is, so a paraphrase cannot invert it. A model sentence that promises an unmade check or reads a tool name aloud
  is replaced by the tool's words. If the first round returns no tool call, an unknown tool, unparsable arguments, or
  arguments the server rejects (an exception or an input-validation error result), the turn goes to the intent router.
  If the model is unreachable, every turn does.
- `router.ts`: deterministic regex and keyword mapping to one tool call with argument extraction (member names from
  the household, metric, threshold, symptom, severity, day). Returns a clarifying question when a required name is
  missing and the household has several members.
- `http.ts`: `POST /ask {text}` returns `{speech, cards, toolCalls, source, model}`; `GET /tick` calls `watch_tick`
  and returns `{alert, card}`; `GET /glance` returns the latest readings for the header; `GET /health`.

## The UI (`src/`)

Rounded dark panel with a clock and date, an "Air now" strip from `/glance`, a transcript of your requests and the
assistant's cards (readings tiles, per-person verdicts, planned windows, alert rules, diary entries), a text input,
and a microphone button that uses the browser's `SpeechRecognition` where it exists (disabled otherwise). Every reply's
`speech` is spoken with `SpeechSynthesis` (toggle with "Voice on/off"). The page polls `/tick` every 30 seconds and
shows an unprompted alert card, spoken aloud, when `watch_tick` fires.

## Tests

`test/router.test.ts` covers the intent router. `test/agent.test.ts` and `test/llm.test.ts` exercise the tool-call
plumbing with a fake model and a fake MCP runner: execution and feedback of tool results, the three-round cap, each
fallback path, the member and place guards, and the OpenAI-format conversions. `scripts/e2e.ts` is the browser check described above; it uses a
temporary household file so it never touches your data.
