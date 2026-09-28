import { COAT_FILE_ACCEPT } from "@freshcoat-js/coatfile/coat";
import { isMac } from "@freshcoat-js/ui/kbd";
import { ToastRegion } from "@freshcoat-js/ui/toast";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { isTyping } from "~/canvas/Viewport";
import { useConfirm } from "~/data/ConfirmDialog";
import { useEditor } from "~/state/hooks";
import { ConfirmDiscard } from "./ConfirmDiscard";
import { type CommandContext, findCommand } from "./commands";
import { ControllerProvider } from "./context";
import type { EditorController } from "./controller";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { TemplateSetupDialog, useTemplateSetup } from "./TemplateSetupDialog";
import { useUrlState } from "./use-url-state";
import { Welcome } from "./Welcome";
import { Workspace } from "./Workspace";

/** The editor. `urlSync` off leaves the URL alone, for the benchmark, which
 *  opens its own sample and is not addressed by what it shows. */
export function Editor({
	controller,
	urlSync = true,
	children,
}: {
	controller: EditorController;
	urlSync?: boolean;
	children?: ReactNode;
}) {
	return (
		<ControllerProvider controller={controller}>
			<EditorRoot controller={controller} urlSync={urlSync} />
			{children}
			<ToastRegion />
		</ControllerProvider>
	);
}

function EditorRoot({
	controller,
	urlSync,
}: {
	controller: EditorController;
	urlSync: boolean;
}) {
	const hasDoc = useEditor((s) => s.doc !== null);
	const fileInput = useRef<HTMLInputElement>(null);
	const imageInput = useRef<HTMLInputElement>(null);
	const templateInput = useRef<HTMLInputElement>(null);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const setup = useTemplateSetup(controller);
	const { confirm, element: confirmElement } = useConfirm();

	useEffect(
		() =>
			controller.setSvgPastePrompt(async () => {
				const r = await confirm({
					title: "Paste SVG",
					message: "Import the SVG as an image, or paste its code as text?",
					confirmLabel: "Import as image",
					alternative: "Paste as text",
				});
				return r === "confirm"
					? "image"
					: r === "alternative"
						? "text"
						: "cancel";
			}),
		[controller, confirm],
	);
	const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(
		null,
	);

	const ctx = useMemo<CommandContext>(
		() => ({
			controller,
			pickFile: () => fileInput.current?.click(),
			pickTemplate: () => templateInput.current?.click(),
			pickImage: () => imageInput.current?.click(),
			showShortcuts: () => setShortcutsOpen(true),
			showTemplateSetup: setup.show,
			confirmDiscard: (then) => {
				if (controller.dirty) setPendingDiscard(() => then);
				else then();
			},
		}),
		[controller, setup.show],
	);

	const { openHint } = useUrlState(controller, ctx, urlSync);

	useEffect(() => {
		(window as unknown as { __freshcoat?: object }).__freshcoat = {
			...(window as unknown as { __freshcoat?: object }).__freshcoat,
			controller,
		};
	}, [controller]);

	// One keyboard handler for every command, so the menus, the shortcut sheet
	// and the keys can never disagree.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented) return;
			const typing = isTyping(e.target);
			const inOverlay = !!(e.target as Element | null)?.closest?.(
				"[role=dialog],[role=menu],[role=listbox]",
			);
			const state = controller.state;
			if (
				!typing &&
				!inOverlay &&
				state.doc &&
				state.section === "edit" &&
				e.key.startsWith("Arrow")
			) {
				const step = e.shiftKey ? 10 : 1;
				const d = {
					ArrowLeft: [-step, 0],
					ArrowRight: [step, 0],
					ArrowUp: [0, -step],
					ArrowDown: [0, step],
				}[e.key] as [number, number] | undefined;
				if (d && state.selection.length) {
					e.preventDefault();
					controller.nudge(d[0], d[1]);
				}
				return;
			}
			if (inOverlay && (e.key === "Escape" || e.key === "Enter")) return;
			const command = findCommand(e, isMac, typing || inOverlay, state.section);
			if (!command) return;
			if (command.enabled && !command.enabled(state)) {
				if (command.global) e.preventDefault();
				return;
			}
			e.preventDefault();
			void command.run(ctx);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [controller, ctx]);

	useEffect(() => {
		const onBeforeUnload = (e: BeforeUnloadEvent) => {
			if (controller.dirty) e.preventDefault();
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [controller]);

	// Files are opened with Open file…, never by dropping them: an image
	// dropped on an open template is placed in it, and any other file dropped
	// anywhere the Data section does not take it is refused, rather than left
	// to the browser, which would navigate away from the work to show it.
	const onDrop = useCallback(
		async (e: React.DragEvent) => {
			if (!e.dataTransfer.types.includes("Files")) return;
			e.preventDefault();
			const file = e.dataTransfer.files[0];
			if (file?.type.startsWith("image/") && controller.template)
				await controller.placeImage(file);
		},
		[controller],
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: an image dropped on an open template is placed in it, as the Image tool (I) places a picked one
		<div
			className="flex h-dvh min-h-0 flex-col overflow-hidden bg-fc-app text-fc-text"
			onDragOver={(e) => {
				if (!e.dataTransfer.types.includes("Files")) return;
				e.preventDefault();
				if (!controller.template) e.dataTransfer.dropEffect = "none";
			}}
			onDrop={onDrop}
		>
			{hasDoc ? (
				<Workspace ctx={ctx} />
			) : (
				<Welcome ctx={ctx} openHint={openHint} />
			)}
			<input
				ref={fileInput}
				type="file"
				accept={`.coatworkspace,${COAT_FILE_ACCEPT}`}
				className="hidden"
				data-testid="open-file-input"
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (file) void controller.openFile(file);
				}}
			/>
			<input
				ref={templateInput}
				type="file"
				accept={COAT_FILE_ACCEPT}
				className="hidden"
				data-testid="import-template-input"
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (file) void controller.importTemplate(file);
				}}
			/>
			<input
				ref={imageInput}
				type="file"
				accept="image/*"
				className="hidden"
				data-testid="image-file-input"
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (file) void controller.placeImage(file);
				}}
			/>
			<ShortcutsDialog isOpen={shortcutsOpen} onOpenChange={setShortcutsOpen} />
			<TemplateSetupDialog request={setup.request} onClose={setup.close} />
			{confirmElement}
			<ConfirmDiscard
				isOpen={pendingDiscard !== null}
				onCancel={() => setPendingDiscard(null)}
				onDiscard={() => {
					const then = pendingDiscard;
					setPendingDiscard(null);
					then?.();
				}}
				onSave={async () => {
					const then = pendingDiscard;
					setPendingDiscard(null);
					if (await controller.saveWorkspace()) then?.();
				}}
			/>
		</div>
	);
}
