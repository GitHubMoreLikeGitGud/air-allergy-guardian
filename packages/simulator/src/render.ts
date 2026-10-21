import type { Card, GlanceResponse } from "../shared/types.js";

type Child = Node | string | null | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const BAND_LABEL: Record<string, string> = {
  good: "good",
  fair: "fair",
  moderate: "moderate",
  poor: "poor",
  very_poor: "very poor",
  extremely_poor: "extremely poor"
};

const METRIC_LABEL: Record<string, string> = {
  european_aqi: "European AQI",
  pm2_5: "PM2.5",
  pm10: "PM10",
  ozone: "Ozone",
  nitrogen_dioxide: "NO2",
  alder_pollen: "Alder pollen",
  birch_pollen: "Birch pollen",
  grass_pollen: "Grass pollen",
  mugwort_pollen: "Mugwort pollen",
  olive_pollen: "Olive pollen",
  ragweed_pollen: "Ragweed pollen"
};

const SYMPTOM_LABEL: Record<string, string> = {
  cough: "Cough",
  wheeze: "Wheeze",
  shortness_of_breath: "Shortness of breath",
  sneezing: "Sneezing",
  runny_nose: "Runny nose",
  itchy_eyes: "Itchy eyes",
  headache: "Headache",
  other: "Symptom"
};

function num(value: unknown, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "–";
}

function hourLabel(iso: unknown): string {
  if (typeof iso !== "string") return "–";
  const hour = Number(iso.slice(11, 13));
  if (Number.isNaN(hour)) return iso;
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} a.m.` : `${hour - 12} p.m.`;
}

function tile(label: string, value: string, unit?: string, extraClass = ""): HTMLElement {
  return el(
    "div",
    { class: `tile ${extraClass}`.trim() },
    el("div", { class: "label" }, label),
    el("div", { class: "value" }, value, unit ? el("span", { class: "unit" }, ` ${unit}`) : null)
  );
}

function readingsTiles(readings: Record<string, unknown>, band: unknown): HTMLElement {
  const pollen = (readings["pollen"] ?? {}) as Record<string, unknown>;
  const tiles = el(
    "div",
    { class: "tiles" },
    el(
      "div",
      { class: "tile aqi" },
      el("div", { class: "label" }, "European AQI"),
      el("div", { class: "value" }, num(readings["european_aqi"])),
      el("div", { class: "band" }, typeof band === "string" ? (BAND_LABEL[band] ?? band.replace(/_/g, " ")) : "no reading")
    ),
    tile("PM2.5", num(readings["pm2_5"]), "µg/m³"),
    tile("PM10", num(readings["pm10"]), "µg/m³"),
    tile("Ozone", num(readings["ozone"]), "µg/m³"),
    tile("NO2", num(readings["nitrogen_dioxide"]), "µg/m³")
  );
  for (const [type, grains] of Object.entries(pollen)) {
    if (typeof grains === "number") tiles.append(tile(`${type} pollen`, num(grains), "grains/m³"));
  }
  return tiles;
}

function verdictChips(members: unknown): HTMLElement | null {
  if (!Array.isArray(members) || members.length === 0) return null;
  const wrap = el("div", { class: "verdicts" });
  for (const m of members as Array<{ member?: string; verdict?: string; reason?: string }>) {
    wrap.append(
      el(
        "div",
        { class: "verdict", "data-verdict": m.verdict ?? "" },
        el("strong", {}, `${m.member ?? "?"}: ${(m.verdict ?? "").replace("_", " ")}`),
        el("span", {}, m.reason ?? "")
      )
    );
  }
  return wrap;
}

function rulesList(rules: unknown): HTMLElement | null {
  if (!Array.isArray(rules)) return null;
  if (rules.length === 0) return el("p", { class: "muted" }, "No alert rules.");
  const list = el("ul", { class: "list" });
  for (const r of rules as Array<{ member?: string; metric?: string; above?: number }>) {
    list.append(el("li", {}, `${r.member ?? "?"}: ${METRIC_LABEL[r.metric ?? ""] ?? r.metric ?? "?"} above ${num(r.above, 0)}`));
  }
  return list;
}

function symptomList(entries: unknown): HTMLElement | null {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const list = el("ul", { class: "list" });
  for (const e of entries as Array<{ member?: string; symptom?: string; severity?: number; loggedAt?: string; readings?: { european_aqi?: number | null } | null }>) {
    const when = e.loggedAt ? new Date(e.loggedAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const aqi = e.readings?.european_aqi;
    list.append(
      el(
        "li",
        {},
        `${e.member ?? "?"}: ${SYMPTOM_LABEL[e.symptom ?? ""] ?? e.symptom ?? "?"}, severity ${e.severity ?? "?"}`,
        el("small", {}, `${when}${typeof aqi === "number" ? ` · European AQI ${Math.round(aqi)}` : ""}`)
      )
    );
  }
  return list;
}

function kv(pairs: Array<[string, string]>): HTMLElement {
  const dl = el("dl", { class: "kv" });
  for (const [k, v] of pairs) dl.append(el("dt", {}, k), el("dd", {}, v));
  return dl;
}

function bodyFor(card: Card): HTMLElement | null {
  const d = card.data;
  if (!d) return null;
  switch (card.tool) {
    case "check_outside": {
      const body = el("div", { class: "body" }, readingsTiles((d["readings"] ?? {}) as Record<string, unknown>, d["aqiBand"]));
      const chips = verdictChips(d["members"]);
      if (chips) body.append(chips);
      return body;
    }
    case "plan_outdoor_time": {
      const w = d["window"] as { start?: string; end?: string; verdict?: string; reason?: string; europeanAqiMax?: number | null } | null;
      if (!w) return null;
      return el(
        "div",
        { class: "body" },
        el("div", { class: "tiles" }, tile("From", hourLabel(w.start)), tile("Until", hourLabel(w.end)), tile("Peak AQI", num(w.europeanAqiMax))),
        verdictChips([{ member: String(d["member"] ?? ""), verdict: w.verdict, reason: w.reason }])
      );
    }
    case "set_alert_rule":
    case "list_alert_rules":
    case "clear_alert_rule": {
      const list = rulesList(d["rules"]);
      return list ? el("div", { class: "body" }, list) : null;
    }
    case "watch_tick": {
      const a = d["alert"] as { member?: string; reason?: string } | null;
      return a ? el("div", { class: "body" }, kv([["For", a.member ?? "?"], ["Why", a.reason ?? ""]])) : null;
    }
    case "log_symptom": {
      const e = d["entry"];
      return e ? el("div", { class: "body" }, symptomList([e])) : null;
    }
    case "recent_symptoms": {
      const list = symptomList(d["entries"]);
      const avg = d["averageEuropeanAqi"];
      const body = el("div", { class: "body" });
      if (list) body.append(list);
      if (typeof avg === "number") body.append(el("p", { class: "muted" }, `Average European AQI at those times: ${avg}`));
      return body.childElementCount ? body : null;
    }
    case "get_household":
    case "set_household": {
      const members = d["members"];
      const home = d["home"] as { label?: string; latitude?: number; longitude?: number } | null;
      const pairs: Array<[string, string]> = [];
      if (home) pairs.push(["Home", home.label ?? `${num(home.latitude, 4)}, ${num(home.longitude, 4)}`]);
      if (Array.isArray(members)) {
        for (const m of members as Array<{ name?: string; conditions?: string[]; pollen?: string[] }>) {
          const conditions = (m.conditions ?? []).map((c) => c.replace("_", " ")).join(", ");
          pairs.push([m.name ?? "?", m.pollen?.length ? `${conditions} (${m.pollen.join(", ")})` : conditions]);
        }
      }
      return pairs.length ? el("div", { class: "body" }, kv(pairs)) : null;
    }
    default:
      return null;
  }
}

export function renderCard(card: Card): HTMLElement {
  const article = el(
    "article",
    { class: "card", "data-kind": card.kind, "data-tool": card.tool ?? "", "data-error": String(card.isError), "data-card-id": card.id },
    el("div", { class: "card-head" }, el("h3", {}, card.kind === "alert" ? "Proactive alert" : card.title), card.tool ? el("span", { class: "tool" }, card.tool) : null),
    el("p", { class: "speech" }, card.text)
  );
  const body = bodyFor(card);
  if (body) article.append(body);
  return article;
}

export function renderUser(text: string): HTMLElement {
  return el("div", { class: "user" }, el("small", {}, "You"), text);
}

export function renderHint(prompts: readonly string[], onPick: (text: string) => void): HTMLElement {
  const chips = el("div", { class: "chips" });
  for (const p of prompts) {
    const chip = el("button", { type: "button", class: "chip" }, p);
    chip.addEventListener("click", () => onPick(p));
    chips.append(chip);
  }
  return el("div", { class: "hint" }, el("h2", {}, "Ask about the air at home"), el("p", {}, "Type a request, or use the microphone where the browser supports it."), chips);
}

export function renderGlance(target: HTMLElement, glance: GlanceResponse | null): void {
  target.replaceChildren();
  if (!glance || glance.aqi === null) {
    target.append("Air now: no reading");
    return;
  }
  const band = glance.band ? (BAND_LABEL[glance.band] ?? glance.band.replace(/_/g, " ")) : "";
  target.append("Air now: ", el("strong", {}, `AQI ${Math.round(glance.aqi)}`), band ? ` · ${band}` : "", glance.pm2_5 === null ? "" : ` · PM2.5 ${Math.round(glance.pm2_5)} µg/m³`);
}

export function renderClock(timeEl: HTMLElement, dateEl: HTMLElement, now: Date): void {
  timeEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  dateEl.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
