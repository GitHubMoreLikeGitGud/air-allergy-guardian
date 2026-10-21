import "./style.css";
import { ask, glance, tick } from "./api.js";
import { renderCard, renderClock, renderGlance, renderHint, renderUser } from "./render.js";
import { canListen, isMuted, listenOnce, setMuted, speak } from "./voice.js";

const TICK_FIRST_MS = 5_000;
const TICK_EVERY_MS = 30_000;
const GLANCE_EVERY_MS = 10 * 60_000;

const SUGGESTIONS = [
  "Is it okay for Mei to go outside?",
  "When is the best time for Dev to run tomorrow?",
  "Warn Mei when PM2.5 goes above 35",
  "Log a mild cough for Mei",
  "Who lives at home?"
];

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const transcript = byId<HTMLElement>("transcript");
const form = byId<HTMLFormElement>("ask-form");
const input = byId<HTMLInputElement>("ask-input");
const sendButton = byId<HTMLButtonElement>("send");
const micButton = byId<HTMLButtonElement>("mic");
const muteButton = byId<HTMLButtonElement>("mute");
const status = byId<HTMLElement>("status");
const lightbar = byId<HTMLElement>("lightbar");
const glanceEl = byId<HTMLElement>("glance");
const timeEl = byId<HTMLElement>("time");
const dateEl = byId<HTMLElement>("date");

let busy = false;
let hint: HTMLElement | null = renderHint(SUGGESTIONS, (text) => void submit(text));
transcript.append(hint);

function setStatus(text: string, active = false): void {
  status.textContent = text;
  lightbar.dataset["active"] = String(active);
}

function append(node: HTMLElement): void {
  if (hint) {
    hint.remove();
    hint = null;
  }
  transcript.append(node);
  transcript.scrollTop = transcript.scrollHeight;
}

function say(text: string): void {
  setStatus("Speaking", true);
  speak(text, () => setStatus(""));
}

async function submit(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean || busy) return;
  busy = true;
  sendButton.disabled = true;
  input.value = "";
  append(renderUser(clean));
  setStatus("Thinking", true);
  try {
    const answer = await ask(clean);
    for (const card of answer.cards) append(renderCard(card));
    if (answer.toolCalls.some((c) => c.tool === "set_household" && c.ok)) void refreshGlance();
    const via = answer.source === "llm" ? `via ${answer.model ?? "model"}` : answer.source === "router" ? "via intent router" : "";
    say(answer.speech);
    if (via) status.textContent = via;
  } catch (err) {
    const speech = "The simulator bridge is not responding. Start it with npm run dev in packages/simulator.";
    append(renderCard({ id: `local-${Date.now()}`, kind: "reply", tool: null, title: "Guardian", text: speech, data: null, isError: true }));
    setStatus(err instanceof Error ? err.message : String(err));
  } finally {
    busy = false;
    sendButton.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submit(input.value);
});

if (canListen()) {
  micButton.addEventListener("click", async () => {
    if (busy) return;
    micButton.dataset["listening"] = "true";
    setStatus("Listening", true);
    const heard = await listenOnce();
    micButton.dataset["listening"] = "false";
    if (heard) {
      input.value = heard;
      await submit(heard);
    } else {
      setStatus("I didn't catch that.");
    }
  });
} else {
  micButton.disabled = true;
  micButton.title = "Voice input is not available in this browser; type instead.";
}

function reflectMute(): void {
  muteButton.textContent = isMuted() ? "Voice off" : "Voice on";
  muteButton.setAttribute("aria-pressed", String(isMuted()));
}
muteButton.addEventListener("click", () => {
  setMuted(!isMuted());
  reflectMute();
});
reflectMute();

async function pollTick(): Promise<void> {
  try {
    const result = await tick();
    if (result.alert && result.card) {
      append(renderCard(result.card));
      say(result.alert.speech);
    }
  } catch {
    // the bridge may be restarting; try again on the next tick
  }
}

async function refreshGlance(): Promise<void> {
  try {
    renderGlance(glanceEl, await glance());
  } catch {
    renderGlance(glanceEl, null);
  }
}

function tickClock(): void {
  renderClock(timeEl, dateEl, new Date());
}

tickClock();
setInterval(tickClock, 1000);
void refreshGlance();
setInterval(() => void refreshGlance(), GLANCE_EVERY_MS);
setTimeout(() => {
  void pollTick();
  setInterval(() => void pollTick(), TICK_EVERY_MS);
}, TICK_FIRST_MS);
input.focus();
