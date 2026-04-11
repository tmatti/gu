import { tool } from "ai";
import { z } from "zod";

const schema = z.object({
  name: z.string().describe("Fighter's full name or last name"),
});

export const lookupFighter = tool({
  description:
    "Look up a UFC/MMA fighter by name. Returns stats, record, weight class, and recent fight history.",
  inputSchema: schema,
  execute: async (input) => {
    // TODO: wire up to ESPN API
    // ESPN endpoint: https://site.api.espn.com/apis/site/v2/sports/mma/ufc/athletes?search={name}
    return {
      name: "Stub: " + input.name,
      record: "0-0-0",
      weightClass: "Unknown",
      ranking: null,
      lastFights: [],
      note: "Stub data — ESPN API not yet connected",
    };
  },
});
