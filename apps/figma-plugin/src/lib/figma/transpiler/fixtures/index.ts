import type { FigmaContainerNode } from "../../types";
import fidelityFigma from "./fidelity-card.figma.json" with { type: "json" };
import fullExpected from "./full-card.expected.json" with { type: "json" };
import fullFigma from "./full-card.figma.json" with { type: "json" };
import minimalExpected from "./minimal-card.expected.json" with {
	type: "json",
};
import minimalFigma from "./minimal-card.figma.json" with { type: "json" };
import pinnedExpected from "./pinned-logo.expected.json" with { type: "json" };
import pinnedFigma from "./pinned-logo.figma.json" with { type: "json" };

export const fixtures = {
	minimalCard: {
		figma: minimalFigma as unknown as {
			front: FigmaContainerNode;
			back: FigmaContainerNode;
		},
		expected: minimalExpected,
	},
	fullCard: {
		figma: fullFigma as unknown as {
			front: FigmaContainerNode;
			backSet: FigmaContainerNode;
		},
		expected: fullExpected,
	},
	/** A custom-size side whose layers carry Figma constraints: a banner that
	 *  stretches, a logo pinned to the bottom-right corner, a centred seal, a
	 *  group whose children are pinned to the bottom, and a layer left at the
	 *  default top-left. */
	pinnedLogo: {
		figma: pinnedFigma as unknown as { front: FigmaContainerNode },
		expected: pinnedExpected,
	},
	/** Both sides of a CR80 card using what format 1.3 carries: a linear
	 *  gradient with exact points, constraints, a bound EAN-13 barcode, a
	 *  flattened vector, and a QR on the back. Its whole export, rasters and
	 *  provenance included, is golden in `fidelity-card.export.json`, which
	 *  order-site's importer reads in its own tests. */
	fidelityCard: {
		figma: fidelityFigma as unknown as {
			front: FigmaContainerNode;
			back: FigmaContainerNode;
		},
	},
};
