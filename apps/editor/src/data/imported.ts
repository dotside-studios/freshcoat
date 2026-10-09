import { toast } from "@freshcoat-js/ui/toast";
import { readsDataset } from "@freshcoat-js/workspace";
import type { EditorController } from "~/app/controller";
import { activeSlot } from "~/state/workspace";

/** Reports an import. A new dataset is bound to the active template when it
 *  has none, and otherwise offered to it from the toast. Without that offer,
 *  an import that left issues offers to show them. */
export function announceImport(
	controller: EditorController,
	datasetId: string,
	summary: string,
	isNew: boolean,
	showIssues?: () => void,
): void {
	const slot = activeSlot(controller.state);
	const offer = isNew && slot !== undefined;
	const bound = readsDataset(slot?.binding);
	if (offer && !bound) controller.bindTemplate(slot.id, datasetId);
	toast(summary, {
		tone: "success",
		timeout: 6000,
		...(offer && bound
			? {
					action: {
						label: `Use with ${slot.fileName}`,
						onAction: () => controller.bindTemplate(slot.id, datasetId),
					},
				}
			: showIssues
				? { action: { label: "Show issues", onAction: showIssues } }
				: {}),
	});
}
