import type { PrintProfile } from "@freshcoat-js/for-print";
import {
	type Point,
	profileFromPhoto,
} from "@freshcoat-js/for-print/calibration";
import { Button } from "@freshcoat-js/ui/button";
import { Dialog, Modal } from "@freshcoat-js/ui/dialog";
import { TextField } from "@freshcoat-js/ui/field";
import { type MouseEvent, type ReactNode, useEffect, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { downloadBytes } from "~/app/download";
import {
	CHART,
	CHART_FILE,
	CORNERS,
	calibrationError,
	decodePhoto,
	renderChartPng,
} from "./calibrate";

type Photo = {
	url: string;
	pixels: {
		data: Uint8Array | Uint8ClampedArray;
		width: number;
		height: number;
	};
};

type Failure = { title: string; details: string[] };

export function CalibrateDialog({
	isOpen,
	onOpenChange,
	onSave,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (profile: PrintProfile) => void;
}) {
	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange} width="max-w-2xl">
			<CalibrateBody
				onSave={(profile) => {
					onSave(profile);
					onOpenChange(false);
				}}
			/>
		</Modal>
	);
}

function CalibrateBody({
	onSave,
}: {
	onSave: (profile: PrintProfile) => void;
}) {
	const [photo, setPhoto] = useState<Photo | null>(null);
	const [corners, setCorners] = useState<Point[]>([]);
	const [name, setName] = useState("");
	const [printer, setPrinter] = useState("");
	const [ribbon, setRibbon] = useState("");
	const [stock, setStock] = useState("");
	const [failure, setFailure] = useState<Failure | null>(null);

	useEffect(
		() => () => void (photo && URL.revokeObjectURL(photo.url)),
		[photo],
	);

	const downloadChart = async () => {
		try {
			await downloadBytes(await renderChartPng(), CHART_FILE, "image/png");
		} catch {
			setFailure({ title: "Couldn't create the chart", details: [] });
		}
	};

	const choosePhoto = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;
		const pixels = await decodePhoto(new Uint8Array(await file.arrayBuffer()));
		if (!pixels) {
			setFailure({ title: `Couldn't open ${file.name}`, details: [] });
			return;
		}
		setFailure(null);
		setCorners([]);
		setPhoto({ url: URL.createObjectURL(file), pixels });
	};

	const mark = (e: MouseEvent<HTMLElement>) => {
		if (!photo || corners.length >= 4 || e.detail === 0) return;
		const box = e.currentTarget.getBoundingClientRect();
		setFailure(null);
		setCorners([
			...corners,
			{
				x: ((e.clientX - box.left) / box.width) * photo.pixels.width,
				y: ((e.clientY - box.top) / box.height) * photo.pixels.height,
			},
		]);
	};

	const ready = !!photo && corners.length === 4 && name.trim() !== "";

	const save = () => {
		if (!photo || corners.length !== 4) return;
		const conditions = {
			...(printer.trim() ? { printer: printer.trim() } : {}),
			...(ribbon.trim() ? { ribbon: ribbon.trim() } : {}),
			...(stock.trim() ? { stock: stock.trim() } : {}),
		};
		const result = profileFromPhoto(
			photo.pixels,
			corners as [Point, Point, Point, Point],
			{
				name,
				measuredAt: new Date().toISOString(),
				...(Object.keys(conditions).length ? { conditions } : {}),
			},
			CHART,
		);
		if (result.ok) onSave(result.profile);
		else setFailure(calibrationError(result));
	};

	const next = CORNERS[corners.length];

	return (
		<Dialog
			title="Measure printer"
			bodyClassName="flex flex-col gap-4"
			footer={({ close }) => (
				<>
					<Button variant="ghost" onPress={close}>
						Cancel
					</Button>
					<Button variant="primary" isDisabled={!ready} onPress={save}>
						Save profile
					</Button>
				</>
			)}
		>
			<Step n={1} title="Print the chart">
				<p className="m-0 flex-1 text-fc-muted text-fc-sm">
					Print it on the card printer at 100% with color correction off
				</p>
				<Button onPress={() => void downloadChart()}>Download chart</Button>
			</Step>
			<Step n={2} title="Photograph the card">
				<p className="m-0 flex-1 text-fc-muted text-fc-sm">
					Even light, no glare, the card filling most of the frame
				</p>
				<FileTrigger
					acceptedFileTypes={["image/png", "image/jpeg", "image/webp"]}
					onSelect={(files) => void choosePhoto(files)}
				>
					<Button>{photo ? "Replace photo…" : "Choose photo…"}</Button>
				</FileTrigger>
			</Step>
			{photo ? (
				<div className="flex flex-col gap-2" data-testid="calibrate-photo">
					<div className="flex items-center gap-2">
						<p className="m-0 flex-1 text-fc-sm" aria-live="polite">
							{next
								? `Click the ${next} corner mark`
								: "All four corners marked"}
						</p>
						<Button
							variant="ghost"
							isDisabled={corners.length === 0}
							onPress={() => setCorners([])}
						>
							Clear corners
						</Button>
					</div>
					<button
						type="button"
						className="relative cursor-crosshair self-center p-0"
						onClick={mark}
						data-testid="calibrate-target"
					>
						<img
							src={photo.url}
							alt="Printed chart"
							className="block max-h-[50vh] max-w-full select-none"
							draggable={false}
						/>
						{corners.map((c, i) => (
							<span
								key={CORNERS[i]}
								className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute grid size-5 place-items-center rounded-full border-2 border-fc-accent bg-fc-panel font-semibold text-[10px] text-fc-text"
								style={{
									left: `${(c.x / photo.pixels.width) * 100}%`,
									top: `${(c.y / photo.pixels.height) * 100}%`,
								}}
							>
								{i + 1}
							</span>
						))}
					</button>
				</div>
			) : null}
			<div className="grid grid-cols-2 gap-2">
				<TextField
					label="Name"
					value={name}
					onChange={setName}
					isRequired
					className="col-span-2"
				/>
				<TextField label="Printer" value={printer} onChange={setPrinter} />
				<TextField label="Ribbon" value={ribbon} onChange={setRibbon} />
				<TextField label="Stock" value={stock} onChange={setStock} />
			</div>
			{failure ? (
				<div role="alert" className="text-fc-danger-text text-fc-sm">
					<p className="m-0">{failure.title}</p>
					{failure.details.map((d) => (
						<p key={d} className="m-0">
							{d}
						</p>
					))}
				</div>
			) : null}
		</Dialog>
	);
}

function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<h3 className="m-0 font-semibold text-fc-base">
				{n}. {title}
			</h3>
			<div className="flex items-center gap-2">{children}</div>
		</section>
	);
}
