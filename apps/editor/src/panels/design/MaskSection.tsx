import type { MaskElement } from "@freshcoat/coatfile";
import { Button } from "@freshcoat/ui/button";
import { Checkbox } from "@freshcoat/ui/checkbox";
import { PanelSection } from "@freshcoat/ui/panel";
import { ToggleGroup, ToggleGroupItem } from "@freshcoat/ui/toggle";
import { Row } from "./controls";
import { commonValue, type Inspect } from "./field-helpers";

export function MaskSection({ ins }: { ins: Inspect }) {
	const masks = (ins.layers as MaskElement[]).map((m) => m.properties);
	const channel = commonValue(masks.map((m) => m.channel ?? "alpha"));
	const invert = commonValue(masks.map((m) => m.invert === true));
	return (
		<PanelSection title="Mask">
			<Row label="Channel">
				<ToggleGroup
					aria-label="Mask channel"
					className="flex-1"
					selectedKeys={channel ? [channel] : []}
					onSelectionChange={(k) => {
						const v = [...k][0];
						ins.setProps("mask-channel", () => ({
							channel: v === "alpha" ? undefined : v,
						}));
					}}
				>
					<ToggleGroupItem id="alpha">Alpha</ToggleGroupItem>
					<ToggleGroupItem id="luminance">Luminance</ToggleGroupItem>
				</ToggleGroup>
			</Row>
			<Row label="">
				<Checkbox
					isSelected={invert === true}
					isIndeterminate={invert === null}
					onChange={(on) =>
						ins.setProps("mask-invert", () => ({
							invert: on ? true : undefined,
						}))
					}
				>
					Invert
				</Checkbox>
			</Row>
			{ins.keys.length === 1 && (
				<Row label="">
					<Button
						className="flex-1"
						onPress={() => ins.controller.select([`${ins.keys[0]}/-1`])}
					>
						Select mask source
					</Button>
				</Row>
			)}
		</PanelSection>
	);
}
