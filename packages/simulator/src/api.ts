import type { AskResponse, GlanceResponse, TickResponse } from "../shared/types.js";

const BASE = (import.meta.env["VITE_BRIDGE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "/api";

export async function ask(text: string): Promise<AskResponse> {
  const res = await fetch(`${BASE}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  const body = (await res.json()) as AskResponse & { error?: string };
  if (!res.ok && !body.speech) throw new Error(body.error ?? `Bridge returned HTTP ${res.status}`);
  return body;
}

export async function tick(): Promise<TickResponse> {
  const res = await fetch(`${BASE}/tick`);
  if (!res.ok) throw new Error(`Bridge returned HTTP ${res.status}`);
  return (await res.json()) as TickResponse;
}

export async function glance(): Promise<GlanceResponse> {
  const res = await fetch(`${BASE}/glance`);
  if (!res.ok) throw new Error(`Bridge returned HTTP ${res.status}`);
  return (await res.json()) as GlanceResponse;
}
