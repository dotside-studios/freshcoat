import {
	Checkbox,
	IconWarning16,
	Text,
	Textbox,
} from "@create-figma-plugin/ui";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { checkFreshcoatAddress } from "~/lib/handoff";
import type { PluginSettings } from "~/shared/protocol";
import { Hint, IconSlot } from "~/ui/components";
import { BINDING_GUIDE_URL } from "~/ui/copy";
import { Field, Panel, Section, Stack } from "~/ui/layout";
import { postToMain } from "~/ui/post";
import { useAnnounce } from "~/ui/status";

export function SettingsTab(props: {
	freshcoatUrl: string;
	showDiagnostics: boolean;
	onPersist: (patch: Partial<PluginSettings>) => void;
	/** Bumped when another tab sends the author here for the address. */
	focusAddress: number;
}): JSX.Element {
	const announce = useAnnounce();
	const [draft, setDraft] = useState(props.freshcoatUrl);
	const [touched, setTouched] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Settings land one message after mount; follow them until the author types.
	useEffect(() => {
		if (!touched) setDraft(props.freshcoatUrl);
	}, [props.freshcoatUrl, touched]);

	useEffect(() => {
		if (props.focusAddress > 0) inputRef.current?.focus();
	}, [props.focusAddress]);

	const trimmed = draft.trim();
	const check = trimmed ? checkFreshcoatAddress(trimmed) : null;
	const error = check && !check.ok ? check.reason : null;

	const save = (): void => {
		if (error || trimmed === props.freshcoatUrl) return;
		props.onPersist({ freshcoatUrl: trimmed });
		announce(trimmed ? "Address saved" : "Address cleared", "success");
	};

	return (
		<Panel>
			<Section title="Freshcoat" divider={false}>
				<Field label="Address">
					<Textbox
						ref={inputRef}
						value={draft}
						placeholder="https://freshcoat.example"
						onValueInput={(v) => {
							setTouched(true);
							setDraft(v);
						}}
						onBlur={save}
						onKeyDown={(e: KeyboardEvent) => {
							if (e.key === "Enter") save();
						}}
						aria-invalid={error ? true : undefined}
						aria-describedby="address-hint"
					/>
				</Field>
				<div id="address-hint">
					{error && touched ? (
						<div
							style={{
								display: "flex",
								gap: "4px",
								alignItems: "center",
								color: "var(--figma-color-text-danger)",
							}}
						>
							<IconSlot>
								<span
									style={{
										display: "flex",
										color: "var(--figma-color-icon-danger)",
									}}
								>
									<IconWarning16 />
								</span>
							</IconSlot>
							<span style={{ lineHeight: "16px" }}>{error}</span>
						</div>
					) : (
						<Hint>Where Open in Freshcoat sends templates</Hint>
					)}
				</div>
			</Section>
			<Section title="Export">
				<Checkbox
					value={props.showDiagnostics}
					onValueChange={(v) => props.onPersist({ showDiagnostics: v })}
				>
					<Text>Open diagnostics after export</Text>
				</Checkbox>
			</Section>
			<Section title="Help">
				<Stack gap="extraSmall">
					<div>
						<button
							type="button"
							class="fc-link"
							style={{ lineHeight: "16px" }}
							onClick={() =>
								postToMain({ type: "open-external", url: BINDING_GUIDE_URL })
							}
						>
							Binding guide
						</button>
					</div>
					<Hint>How to mark layers as fields</Hint>
				</Stack>
			</Section>
		</Panel>
	);
}
