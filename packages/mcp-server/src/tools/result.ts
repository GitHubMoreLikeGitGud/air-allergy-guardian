import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Household, Member } from "../types.js";

export function speak(text: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

export function fail(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function findMember(household: Household, name: string): Member | undefined {
  const wanted = name.trim().toLowerCase();
  return household.members.find((m) => m.name.toLowerCase() === wanted);
}

export function noHomeResult(): CallToolResult {
  return fail("I don't know where home is yet. Tell me where home is first, for example: we live in Munich.");
}

export function unknownMemberResult(name: string, household: Household): CallToolResult {
  const names = household.members.map((m) => m.name);
  const known = names.length ? `I know ${names.join(", ")}.` : "Nobody is in the household yet.";
  return fail(`I don't have anyone called ${name} in the household. ${known}`);
}
