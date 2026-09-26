import type { Template } from "@freshcoat/coatfile";
import { Button } from "@freshcoat/ui/button";
import { Dialog, Modal } from "@freshcoat/ui/dialog";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { FontsSection } from "~/panels/setup/FontsSection";
import { GeneralSection } from "~/panels/setup/GeneralSection";
import { SizeSection } from "~/panels/setup/SizeSection";
import { useEditor } from "~/state/hooks";
import type { EditorController, NameAnswer } from "./controller";
import { TEMPLATE_SETUP } from "./copy";

/** What the dialog is open for: the settings, or naming a template that is
 *  about to be saved for the first time. */
export type SetupRequest =
	| { mode: "setup" }
	| {
			mode: "name";
			fileName: string;
			answer: (answer: NameAnswer) => void;
	  };

/**
 * The dialog's state, and the controller's naming prompt: saving an unnamed
 * template opens the dialog as the prompt and waits for its answer. A second
 * prompt while one is open cancels the first.
 */
export function useTemplateSetup(controller: EditorController) {
	const [request, setRequest] = useState<SetupRequest | null>(null);
	const pending = useRef<((answer: NameAnswer) => void) | null>(null);

	useEffect(
		() =>
			controller.setNamePrompt(
				(fileName) =>
					new Promise((resolve) => {
						pending.current?.("cancel");
						pending.current = resolve;
						setRequest({
							mode: "name",
							fileName,
							answer: (a) => {
								if (pending.current === resolve) pending.current = null;
								resolve(a);
							},
						});
					}),
			),
		[controller],
	);

	const show = useCallback(() => setRequest({ mode: "setup" }), []);
	const close = useCallback(() => {
		pending.current?.("cancel");
		pending.current = null;
		setRequest(null);
	}, []);
	return { request, show, close };
}

/**
 * The active template's name, id, size and fonts. Edits apply as they are
 * made, each an undo step, so the canvas behind shows them. As the naming
 * prompt it asks before a save goes ahead: Save continues it, Skip continues
 * it unchanged, and dismissing cancels it.
 */
export function TemplateSetupDialog({
	request,
	onClose,
}: {
	request: SetupRequest | null;
	onClose: () => void;
}) {
	const template = useEditor((s) => s.doc?.history.present ?? null);
	const slot = useEditor((s) => s.workspace?.activeTemplateId);
	const naming = request?.mode === "name" ? request : null;

	const answer = (a: NameAnswer) => {
		naming?.answer(a);
		onClose();
	};

	return (
		<Modal
			isOpen={request !== null && template !== null}
			onOpenChange={(open) => {
				if (!open) answer("cancel");
			}}
			width="max-w-md"
			className="max-h-[calc(100dvh-2rem)]"
		>
			{template && request ? (
				<Dialog
					data-testid="template-setup"
					title={naming ? TEMPLATE_SETUP.naming : TEMPLATE_SETUP.title}
					bodyClassName="flex flex-col gap-4"
					footer={
						naming ? (
							<>
								<Button variant="ghost" onPress={() => answer("skip")}>
									Skip
								</Button>
								<Button variant="primary" onPress={() => answer("save")}>
									Save
								</Button>
							</>
						) : (
							<Button variant="primary" onPress={onClose}>
								Done
							</Button>
						)
					}
				>
					<SetupSections
						key={`${slot}:${request.mode}`}
						template={template}
						naming={naming?.fileName}
					/>
				</Dialog>
			) : null}
		</Modal>
	);
}

function SetupSections({
	template,
	naming,
}: {
	template: Template;
	/** The file being named, when this is the naming prompt. */
	naming?: string;
}) {
	return (
		<>
			{naming ? (
				<p className="m-0 text-fc-muted" data-testid="naming-file">
					{TEMPLATE_SETUP.unnamed(naming)}
				</p>
			) : null}
			<SetupSection title="General">
				<GeneralSection template={template} autoFocusName={!!naming} />
			</SetupSection>
			<SetupSection title="Size">
				<SizeSection template={template} />
			</SetupSection>
			<SetupSection title="Fonts">
				<FontsSection template={template} />
			</SetupSection>
		</>
	);
}

function SetupSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="flex flex-col gap-2">
			<h3
				id={id}
				className="m-0 font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]"
			>
				{title}
			</h3>
			{children}
		</section>
	);
}
