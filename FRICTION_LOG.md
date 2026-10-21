# Friction log

Things that got in the way while building Air & Allergy Guardian, in the order we hit them. Severity: **Blocker**
(could not do the thing at all), **High** (wrong behaviour a user would see), **Medium** (cost real time), **Low**
(annoyance).

## 1. Alexa+ add-on tooling is allowlist-only

- **Task:** build the guardian as a real Alexa+ add-on.
- **Steps:** read the track requirements; looked for the add-on CLI on the public npm registry (`npm view @alexa-ai/cli`).
- **Expected:** install the CLI, scaffold an add-on, point it at our MCP server, test it.
- **Actual:** the tooling is open to allowlisted developers only; `npm view @alexa-ai/cli` returns 404 (checked again
  on 2026-10-21).
- **Severity:** Blocker for the real add-on.
- **Workaround:** the rules allow a simulated Alexa+ experience, so we built a real MCP server (Streamable HTTP,
  protocol 2025-11-25) plus a web simulator that acts as its MCP client, and labelled the simulator as simulated.
- **Suggestion:** give registered hackathon entrants time-limited access to the add-on tooling, or publish a sandbox
  that can call a public MCP server.

## 2. npm crashes on the first workspace install

- **Task:** first `npm install` of the two-package workspace, before a lockfile existed.
- **Steps:** Node 22.13.1, npm 10.9.2, root `package.json` with `"workspaces": ["packages/*"]`, then `npm install`.
- **Expected:** dependencies installed.
- **Actual:** `npm error Cannot read properties of null (reading 'edgesOut')`. The debug log shows a `TypeError` in
  `#loadPeerSet` in `@npmcli/arborist/lib/arborist/build-ideal-tree.js`. Reproduced on 2026-10-21 in a copy of the
  three `package.json` files with no lockfile.
- **Severity:** Medium (stops a fresh project cold, and the message does not say what to do).
- **Workaround:** `npm install --legacy-peer-deps` installs all 174 packages. With the committed lockfile, a plain
  `npm install` works, so people cloning the repo never see it.
- **Suggestion:** npm: guard the null node in the peer-set step, or fail with a message that names the package and
  suggests `--legacy-peer-deps`.

## 3. MCP SDK: bad arguments come back as a normal tool result

- **Task:** let the bridge fall back to its deterministic router when the language model sends arguments the server
  rejects.
- **Steps:** the bridge calls `client.callTool(...)` inside a `try` with the model's arguments. For "Set home to
  Munich" the model called `set_household` without the required `members` array.
- **Expected:** an exception (or a JSON-RPC error) the bridge can catch.
- **Actual:** a result with `isError: true` and the text `MCP error -32602: Input validation error: Invalid arguments
  for tool set_household: Invalid input: expected array, received undefined at members`. On day one the bridge showed
  such text as a card until we noticed.
- **Severity:** High (users saw a raw protocol error).
- **Workaround:** the bridge treats an `isError` result whose text matches `MCP error -32602` or
  `input validation error` as rejected arguments and falls back.
- **Suggestion:** add a machine-readable marker to validation-error results, so clients can tell "your arguments were
  wrong" from "the tool ran and said no" without matching text.

## 4. Open-Meteo returns null pollen for Singapore

- **Task:** show a pollen verdict for the demo home in central Singapore.
- **Steps:** `GET https://air-quality-api.open-meteo.com/v1/air-quality?latitude=1.2838&longitude=103.8591&current=...,grass_pollen,birch_pollen`.
- **Expected:** pollen numbers, or a clear "not covered" signal.
- **Actual:** every pollen value is `null` (2026-10-17 and 2026-10-21). The docs say pollen is "only available in
  Europe during pollen season", but the response itself does not say so. Munich returns numbers, near zero in October.
- **Severity:** Medium (the demo home cannot show a pollen verdict, and a live high-pollen case cannot be shown this
  month anywhere).
- **Workaround:** all-null pollen is reported as "pollen is not forecast for this location" in each member's reason;
  the demo moves the household to Munich to show live pollen; the pollen bands are covered by recorded-fixture tests.
- **Suggestion:** include a coverage flag (or omit the pollen keys) when the location is outside the pollen domain.

## 5. qwen2.5:7b invents a household member

- **Task:** "Any symptoms logged recently?" should read the whole household's diary.
- **Steps:** bridge sends the MCP tools as function tools to Ollama; system prompt says to pass a member only when the
  request names a person.
- **Expected:** `recent_symptoms {}`.
- **Actual:** `recent_symptoms {"member": "Mei"}` (2026-10-17, and twice on 2026-10-21). The spoken answer was true for
  Mei and wrong for the question. For "Can everyone go outside?" it sent `"member": null`.
- **Severity:** High.
- **Workaround:** a deterministic guard in the bridge drops `member` when the request names nobody in the household,
  does not say that name, and has no pronoun. A tool that needs a member then falls back to the router, which asks who.
- **Suggestion:** for small models, tool schemas could carry a "only if the user said it" hint that the runtime
  enforces; in the meantime a larger model is the other fix.

## 6. qwen2.5:7b sends coordinates instead of the place name

- **Task:** "We live in Munich. Mei has asthma, ..." should store home as "Munich, Germany".
- **Steps:** `set_household` accepts either `home` coordinates or a `place` name that the server geocodes.
- **Expected:** `place: "Munich"`.
- **Actual:** the model filled `home` with coordinates from its own knowledge in 4 of 4 tries on 2026-10-21, even with
  a system-prompt line asking for the place name; twice it added no label, so the household was saved as "Home is
  set." with no place name.
- **Severity:** Medium.
- **Workaround:** when the request contains no coordinates, the bridge swaps the model's `home` for the place the
  request named (the model's label if the request said it, otherwise the words after "live in", "home is in" or
  "home to"). The server geocodes it and stores the label.
- **Suggestion:** none for the tools involved; this is a small-model limit.

## 7. qwen2.5:7b answers in words when it should call a tool, or contradicts the tool

- **Task:** keep every spoken answer true to the tool result.
- **Steps:** normal turns through the bridge.
- **Expected:** a tool call, then a sentence that keeps the tool's meaning.
- **Actual:** "Dev has been sneezing a lot today" and "Who lives here?" got a plain sentence with no tool call. After
  `clear_alert_rule` returned "Cleared one alert rule" the model said there were no rules to clear; after
  `check_outside` returned "I don't have anyone called Mira in the household" it said everyone could go for a run.
- **Severity:** High for the contradictions, Low for the missed tool calls (the router answers, after a wasted model
  round).
- **Workaround:** a first round with no tool call goes to the intent router. For tools that change something, and for
  any tool that answered with an error, the server's sentence is spoken as written.
- **Suggestion:** none for the tools involved; this is a small-model limit.
