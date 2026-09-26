import {
	Button,
	Code,
	IconButton,
	IconRefresh16,
} from "@create-figma-plugin/ui";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { FieldOverviewItem } from "~/shared/protocol";
import { formatLabel } from "~/ui/binding-labels";
import { EmptyState, FormatIcon, Hint, ListButton } from "~/ui/components";
import { plural } from "~/ui/copy";
import { type ExportTarget, fieldsForTarget } from "~/ui/export-target";
import { FieldGroup, Fill, Panel, Row, Stack } from "~/ui/layout";
import { useMainMessage } from "~/ui/messages";
import { postToMain } from "~/ui/post";
import { useAnnounce } from "~/ui/status";

export type FieldDetector = {
	detect: () => void;
	detecting: boolean;
	/** A frame is picked, so there is somewhere to detect in. */
	ready: boolean;
};

// Main answers a detection with a fresh fields overview. If the frame has gone
// it answers with a canvas notification only, so stop waiting after a while.
const DETECT_TIMEOUT_MS = 10_000;

/** Detect fields: turn the markers in the picked frame's layer names into
 *  bindings. One instance for the panel, shared by the Fields tab and Export
 *  step 3, so the confirmation is announced once. */
export function useFieldDetector(target: ExportTarget): FieldDetector {
	const announce = useAnnounce();
	const [detecting, setDetecting] = useState(false);
	const detectingRef = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const finish = (): void => {
		detectingRef.current = false;
		setDetecting(false);
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	useMainMessage((msg) => {
		if (msg.type !== "fields-overview" || !detectingRef.current) return;
		finish();
		const count = fieldsForTarget(msg.fields, target).length;
		if (count === 0) announce("No markers found", "info");
		else announce(`Detected ${plural(count, "field")}`, "success");
	});

	const ready = !!target.product && target.targetId !== "";
	const detect = (): void => {
		if (!target.product || !target.targetId) return;
		detectingRef.current = true;
		setDetecting(true);
		announce("Detecting fields…", "working");
		timer.current = setTimeout(() => {
			if (!detectingRef.current) return;
			finish();
			announce("Couldn't detect fields", "error");
		}, DETECT_TIMEOUT_MS);
		postToMain({
			type: "harvest",
			product: target.product,
			cardId: target.targetId,
			sideAssignment: target.sideAssignment,
		});
	};
	return { detect, detecting, ready };
}

function layerOf(f: FieldOverviewItem): string {
	const named = f.layerNames?.filter((n) => n !== "");
	if (named && named.length > 0) {
		return named.length === 1
			? named[0]
			: `${named[0]} and ${plural(named.length - 1, "more")}`;
	}
	if (f.nodeIds.length === 0) return "No layer";
	return plural(f.nodeIds.length, "layer");
}

export function FieldsTab(props: {
	fields: FieldOverviewItem[];
	detector: FieldDetector;
	target: ExportTarget;
	onPickFrame: () => void;
}): JSX.Element {
	const { fields, detector, target } = props;
	const frameName = target.daviMode ? target.card?.name : target.node?.name;

	const detectButton = (fullWidth: boolean) => (
		<Button
			fullWidth={fullWidth}
			onClick={detector.detect}
			disabled={!detector.ready || detector.detecting}
			loading={detector.detecting}
		>
			Detect fields
		</Button>
	);

	if (fields.length === 0) {
		return detector.ready ? (
			<EmptyState title="No fields" action={detectButton(false)} />
		) : (
			<EmptyState
				title="No fields"
				line={
					<button type="button" class="fc-link" onClick={props.onPickFrame}>
						Pick a frame in Export
					</button>
				}
			/>
		);
	}

	const bySlot = new Map<string, FieldOverviewItem[]>();
	for (const f of fields) {
		bySlot.set(f.slot, [...(bySlot.get(f.slot) ?? []), f]);
	}

	return (
		<Panel>
			<Stack gap="extraSmall">
				<Row>
					<Fill>{detectButton(true)}</Fill>
					<IconButton
						aria-label="Refresh"
						title="Refresh"
						onClick={() => postToMain({ type: "request-fields" })}
					>
						<IconRefresh16 />
					</IconButton>
				</Row>
				{detector.ready ? (
					<Hint truncate title={`Reads kind:{{key}} names in ${frameName}`}>
						Reads <Code>{"kind:{{key}}"}</Code> names in {frameName}
					</Hint>
				) : (
					<Hint>
						<button type="button" class="fc-link" onClick={props.onPickFrame}>
							Pick a frame in Export to detect
						</button>
					</Hint>
				)}
			</Stack>
			{[...bySlot.entries()].map(([slot, items]) => (
				<FieldGroup
					key={slot}
					label={`${slot} · ${plural(items.length, "field")}`}
				>
					<ul style={{ listStyle: "none", margin: "0 -8px", padding: 0 }}>
						{items.map((f) => {
							const node = f.nodeIds[0];
							const optional = f.meta.required === false ? " · optional" : "";
							return (
								<li key={f.id}>
									<ListButton
										icon={
											<FormatIcon
												format={f.meta.format}
												color={f.meta.default}
											/>
										}
										title={f.id}
										meta={`${formatLabel(f.meta.format)} · ${layerOf(f)}${optional}`}
										tooltip={node ? "Select on canvas" : undefined}
										disabled={!node}
										onClick={() => {
											if (node)
												postToMain({ type: "focus-node", nodeId: node });
										}}
									/>
								</li>
							);
						})}
					</ul>
				</FieldGroup>
			))}
		</Panel>
	);
}
