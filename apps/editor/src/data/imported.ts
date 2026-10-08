import { toast } from "@freshcoat-js/ui/toast";
import type { EditorController } from "~/app/controller";
import { readsDataset } from "~/binding/binding";
import { activeSlot } from "~/state/workspace";

/** Reports an import. A new dataset is bound to the active template when it
 *  has none, and otherwise offered to it from the toast. */
export function announceImport(
	controller: EditorController,
	datasetId: string,
	summary: string,
	isNew: boolean,
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
			: {}),
	});
}
