import { Button } from "@freshcoat/ui/button";
import { Dialog, Modal } from "@freshcoat/ui/dialog";

/** Asks before closing or replacing a workspace with unsaved changes. Dirty
 *  covers every template, the data and the presets, so saving here writes
 *  the whole .coatworkspace, as Mod+S does. */
export function ConfirmDiscard({
	isOpen,
	onCancel,
	onDiscard,
	onSave,
}: {
	isOpen: boolean;
	onCancel: () => void;
	onDiscard: () => void;
	onSave: () => void;
}) {
	return (
		<Modal
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
			width="max-w-sm"
		>
			<Dialog
				role="alertdialog"
				title="Unsaved changes"
				footer={
					<>
						<Button variant="ghost" onPress={onCancel}>
							Cancel
						</Button>
						<Button variant="danger" onPress={onDiscard}>
							Discard
						</Button>
						<Button variant="primary" onPress={onSave} autoFocus>
							Save workspace
						</Button>
					</>
				}
			>
				<p className="text-fc-muted">Your changes aren't saved to a file</p>
			</Dialog>
		</Modal>
	);
}
