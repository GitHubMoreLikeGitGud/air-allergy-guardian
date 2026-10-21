import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { describeHousehold } from "../speech.js";
import { HomeSchema, MemberSchema, type Home, type Household } from "../types.js";
import { fail, speak } from "./result.js";

const householdOutput = {
  home: HomeSchema.nullable(),
  members: z.array(MemberSchema),
  speech: z.string()
};

function householdResult(h: Household) {
  const speech = h.home
    ? describeHousehold(h.members, h.home.label ?? null)
    : "No home location is set yet. Tell me where home is and who lives there.";
  return speak(speech, { home: h.home, members: h.members, speech });
}

export function registerHouseholdTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "set_household",
    {
      title: "Set household",
      description:
        "Save who lives at home and where home is. Replaces the member list. Give home as coordinates or as a place name to look up.",
      inputSchema: {
        members: z.array(MemberSchema).describe("Everyone to watch over"),
        home: HomeSchema.optional(),
        place: z.string().min(2).max(80).optional().describe("Place name to geocode when coordinates are not known")
      },
      outputSchema: householdOutput
    },
    async ({ members, home, place }) => {
      let resolved: Home | null = home ?? null;
      if (!resolved && place) {
        resolved = await ctx.geocode(place);
        if (!resolved) return fail(`I couldn't find a place called ${place}. Try a city name or give me coordinates.`);
      }
      const names = new Set<string>();
      for (const m of members) {
        const key = m.name.toLowerCase();
        if (names.has(key)) return fail(`Two people are called ${m.name}; give each person a different name.`);
        names.add(key);
      }
      const next = await ctx.store.update((h) => {
        const newHome = resolved ?? h.home;
        const alertRules = h.alertRules.filter((r) => names.has(r.member.toLowerCase()));
        return { ...h, home: newHome, members, alertRules };
      });
      if (!next.home) return fail("I saved the household, but I still need a home location: give me coordinates or a place name.");
      return householdResult(next);
    }
  );

  server.registerTool(
    "get_household",
    {
      title: "Get household",
      description: "Who lives at home, their conditions, and where home is.",
      inputSchema: {},
      outputSchema: householdOutput
    },
    async () => householdResult(await ctx.store.load())
  );
}
