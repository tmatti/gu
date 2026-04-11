import { tool } from "ai";
import { z } from "zod";

const WEIGHT_CLASSES = [
  "heavyweight",
  "light heavyweight",
  "middleweight",
  "welterweight",
  "lightweight",
  "featherweight",
  "bantamweight",
  "flyweight",
  "women's featherweight",
  "women's bantamweight",
  "women's flyweight",
  "women's strawweight",
] as const;

const schema = z.object({
  weightClass: z
    .enum(WEIGHT_CLASSES)
    .describe("The weight class to look up rankings for"),
});

export const lookupRankings = tool({
  description: "Look up UFC rankings for a specific weight class.",
  inputSchema: schema,
  execute: async (input) => {
    // TODO: wire up to ESPN API
    // ESPN endpoint: https://site.api.espn.com/apis/site/v2/sports/mma/ufc/rankings
    return {
      weightClass: input.weightClass,
      champion: null,
      rankings: [],
      note: "Stub data — ESPN API not yet connected",
    };
  },
});
