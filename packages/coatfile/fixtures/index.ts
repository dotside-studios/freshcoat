import type { Template } from "../src/types";
import full from "./full-feature-card.json" with { type: "json" };
import minimal from "./minimal-card.json" with { type: "json" };

export const fixtures = {
	minimalCard: minimal as Template,
	fullFeatureCard: full as Template,
};
