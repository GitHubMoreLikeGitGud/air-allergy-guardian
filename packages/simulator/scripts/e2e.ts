// End-to-end check: starts the MCP server, the bridge and a Vite preview, then drives the UI with Playwright.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const simRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = resolve(simRoot, "../mcp-server");
const viteBin = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");

const MCP_PORT = Number(process.env["AAG_E2E_MCP_PORT"] ?? 3391);
const BRIDGE_PORT = Number(process.env["AAG_E2E_BRIDGE_PORT"] ?? 3392);
const WEB_PORT = Number(process.env["AAG_E2E_WEB_PORT"] ?? 4193);
const QUESTION = "Is it okay for Mira to go for a run this evening?";
const CARD_TIMEOUT_MS = 150_000;

const children: ChildProcess[] = [];

function start(name: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const relay = (chunk: Buffer) => process.stdout.write(`[${name}] ${chunk.toString().trimEnd()}\n`);
  child.stdout?.on("data", relay);
  child.stderr?.on("data", relay);
  child.on("exit", (code) => process.stdout.write(`[${name}] exited with ${code}\n`));
  children.push(child);
  return child;
}

function runToEnd(name: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = start(name, args, cwd);
    child.on("exit", (code) => (code === 0 ? resolveRun() : reject(new Error(`${name} exited with ${code}`))));
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${url} did not come up within ${timeoutMs} ms (${lastError})`);
}

function stopAll(): void {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "aag-e2e-"));
  const serverEnv = { AAG_PORT: String(MCP_PORT), AAG_HOST: "127.0.0.1", AAG_DATA_FILE: join(dataDir, "household.json") };
  start("mcp", ["--import", "tsx", join(serverRoot, "src/index.ts")], serverRoot, serverEnv);
  await waitForHttp(`http://127.0.0.1:${MCP_PORT}/health`, 30_000);

  const bridgeEnv = { AAG_BRIDGE_PORT: String(BRIDGE_PORT), AAG_MCP_URL: `http://127.0.0.1:${MCP_PORT}/mcp` };
  start("bridge", ["--import", "tsx", join(simRoot, "bridge/index.ts")], simRoot, bridgeEnv);
  await waitForHttp(`http://127.0.0.1:${BRIDGE_PORT}/health`, 30_000);

  await runToEnd("vite-build", [viteBin, "build", "--logLevel", "warn"], simRoot);
  start("web", [viteBin, "preview", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], simRoot, { AAG_BRIDGE_PORT: String(BRIDGE_PORT) });
  await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`, 30_000);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (err) => process.stdout.write(`[page] error: ${err.message}\n`));
    await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
    await page.getByText("Simulated Alexa+ experience").waitFor({ timeout: 10_000 });

    const started = Date.now();
    await page.fill("#ask-input", QUESTION);
    await page.press("#ask-input", "Enter");
    const card = page.locator('article.card[data-kind="reply"]').first();
    await card.waitFor({ timeout: CARD_TIMEOUT_MS });
    const text = (await card.locator(".speech").textContent())?.trim() ?? "";
    const tool = await card.getAttribute("data-tool");
    if (!text) throw new Error("the reply card has no text");

    const outDir = join(simRoot, "e2e-output");
    await mkdir(outDir, { recursive: true });
    const shot = join(outDir, "last-run.png");
    await page.screenshot({ path: shot });
    process.stdout.write(`PASS: reply card appeared after ${Date.now() - started} ms (tool: ${tool || "none"})\n`);
    process.stdout.write(`      "${text}"\n`);
    process.stdout.write(`      screenshot: ${shot}\n`);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => {
    stopAll();
    process.exit(0);
  })
  .catch((err: unknown) => {
    process.stdout.write(`FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
    stopAll();
    process.exit(1);
  });
