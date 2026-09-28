import { Button } from "@freshcoat-js/ui/button";
import { Dialog, Modal } from "@freshcoat-js/ui/dialog";
import { type ReactNode, useCallback, useRef, useState } from "react";
import type { SvgPasteAnswer, SvgPastePrompt } from "./controller";

/** Asks how pasted SVG is imported. Render `element` once. */
export function useSvgPastePrompt(): {
	prompt: SvgPastePrompt;
	element: ReactNode;
} {
	const [open, setOpen] = useState(false);
	const resolver = useRef<((a: SvgPasteAnswer) => void) | null>(null);

	const prompt = useCallback<SvgPastePrompt>(() => {
		resolver.current?.("cancel");
		setOpen(true);
		return new Promise((resolve) => {
			resolver.current = resolve;
		});
	}, []);

	const answer = (a: SvgPasteAnswer) => {
		resolver.current?.(a);
		resolver.current = null;
		setOpen(false);
	};

	const element = (
		<Modal
			isOpen={open}
			onOpenChange={(next) => {
				if (!next) answer("cancel");
			}}
			width="max-w-md"
		>
			<Dialog
				role="alertdialog"
				title="Paste SVG"
				footer={
					<>
						<Button variant="ghost" onPress={() => answer("cancel")}>
							Cancel
						</Button>
						<Button onPress={() => answer("text")}>Paste as text</Button>
						<Button onPress={() => answer("image")}>Import as image</Button>
						<Button
							variant="primary"
							onPress={() => answer("layers")}
							autoFocus
						>
							Import as layers
						</Button>
					</>
				}
			>
				<div className="text-fc-muted">
					Import the SVG as editable layers or as one image, or paste its code
					as text?
				</div>
			</Dialog>
		</Modal>
	);

	return { prompt, element };
}
