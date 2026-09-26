import { Button } from "@freshcoat/ui/button";
import { Dialog, Modal } from "@freshcoat/ui/dialog";
import { type ReactNode, useCallback, useRef, useState } from "react";

export type ConfirmOptions = {
	title: string;
	message: ReactNode;
	confirmLabel: string;
	destructive?: boolean;
	/** A third choice between cancel and confirm, e.g. Merge beside Replace. */
	alternative?: string;
};

export type ConfirmResult = "confirm" | "alternative" | "cancel";

export type Confirm = (options: ConfirmOptions) => Promise<ConfirmResult>;

/** A small confirmation modal driven by a promise. Render `element` once. */
export function useConfirm(): { confirm: Confirm; element: ReactNode } {
	const [options, setOptions] = useState<ConfirmOptions | null>(null);
	const resolver = useRef<((r: ConfirmResult) => void) | null>(null);

	const confirm = useCallback<Confirm>((next) => {
		resolver.current?.("cancel");
		setOptions(next);
		return new Promise((resolve) => {
			resolver.current = resolve;
		});
	}, []);

	const answer = (result: ConfirmResult) => {
		resolver.current?.(result);
		resolver.current = null;
		setOptions(null);
	};

	const element = (
		<Modal
			isOpen={options !== null}
			onOpenChange={(open) => {
				if (!open) answer("cancel");
			}}
			width="max-w-sm"
		>
			{options ? (
				<Dialog
					role="alertdialog"
					title={options.title}
					footer={
						<>
							<Button variant="ghost" onPress={() => answer("cancel")}>
								Cancel
							</Button>
							{options.alternative ? (
								<Button onPress={() => answer("alternative")}>
									{options.alternative}
								</Button>
							) : null}
							<Button
								variant={options.destructive ? "danger" : "primary"}
								onPress={() => answer("confirm")}
								autoFocus
							>
								{options.confirmLabel}
							</Button>
						</>
					}
				>
					<div className="text-fc-muted">{options.message}</div>
				</Dialog>
			) : null}
		</Modal>
	);

	return { confirm, element };
}
