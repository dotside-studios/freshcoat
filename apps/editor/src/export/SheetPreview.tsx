import type { Template } from "@freshcoat/coatfile";
import { cn } from "@freshcoat/ui/lib/cn";
import type { DatasetAsset, Imposition } from "@freshcoat/workspace";
import { cropMarks } from "@freshcoat/workspace";
import {
	type CSSProperties,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { displayDensity } from "~/render/session";
import { useDocumentFonts } from "~/render/use-document-fonts";
import {
	peekSheetThumb,
	renderSheetThumb,
	type SheetThumbRequest,
	thumbKey,
} from "./sheet-thumbs";
import { type SheetItem, showsRecord } from "./sheets";

type Size = { width: number; height: number };

/** Room kept above the paper for its Front or Back label. */
const LABEL_ROOM = 22;

export const SHEET_SIDE_LABEL = { front: "Front", back: "Back" } as const;

/**
 * One page of an imposed PDF: the paper at its aspect, each slot's record
 * rendered small, and the crop marks a front carries.
 */
export function SheetPreview({
	template,
	imposition,
	page: pageIndex,
	assets,
	cropMarks: showMarks,
	currentRecordId,
	currentVariant,
	className,
}: {
	template: Template;
	imposition: Imposition<SheetItem>;
	/** into `imposition.pages` */
	page: number;
	assets?: readonly DatasetAsset[];
	cropMarks: boolean;
	/** the record the filmstrip points at, outlined when it is on this page */
	currentRecordId?: string;
	/** under All variants, which of the record's cards: its variant's id,
	 *  or `default` */
	currentVariant?: string;
	className?: string;
}) {
	const boxRef = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState<Size | null>(null);
	const fonts = useDocumentFonts(template);
	const page = imposition.pages[pageIndex];
	const { paper, card } = imposition;

	useLayoutEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		const measure = () => {
			const r = el.getBoundingClientRect();
			setBox((prev) =>
				prev && prev.width === r.width && prev.height === r.height
					? prev
					: { width: r.width, height: r.height },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const pxPerMm = box
		? Math.max(
				0,
				Math.min(
					box.width / paper.widthMm,
					(box.height - LABEL_ROOM) / paper.heightMm,
				),
			)
		: 0;
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	const density =
		pxPerMm > 0
			? displayDensity((card.widthMm * pxPerMm) / template.width, dpr, {
					width: template.width,
					height: template.height,
				})
			: 0;

	const requests = useMemo(() => {
		if (!page || !fonts.fonts || density <= 0) return [];
		const loaded = fonts.fonts;
		return page.slots.map((slot) => {
			const side = template.template_data.findIndex(
				(f) => f.name === slot.item.side,
			);
			const req: SheetThumbRequest = {
				template,
				side: Math.max(0, side),
				values: slot.item.values,
				fonts: loaded,
				density,
				...(slot.item.variantId ? { variantId: slot.item.variantId } : {}),
				...(assets ? { assets } : {}),
			};
			return { slot, req, key: thumbKey(req) };
		});
	}, [page, fonts.fonts, density, template, assets]);

	const [drawn, setDrawn] = useState<Map<string, HTMLCanvasElement>>(
		() => new Map(),
	);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const abort = new AbortController();
		const keys = new Set(requests.map((r) => r.key));
		setDrawn((m) => new Map([...m].filter(([k]) => keys.has(k))));
		setError(null);
		for (const { req, key } of requests) {
			if (peekSheetThumb(req)) continue;
			renderSheetThumb(req, abort.signal).then(
				(canvas) => {
					if (!abort.signal.aborted)
						setDrawn((m) => new Map(m).set(key, canvas));
				},
				(e) => {
					if (!abort.signal.aborted && e?.name !== "AbortError")
						setError(e instanceof Error ? e.message : String(e));
				},
			);
		}
		return () => abort.abort();
	}, [requests]);

	const sources = requests.map(
		({ req, key }) => drawn.get(key) ?? peekSheetThumb(req),
	);
	const ready =
		!!page && requests.length === page.slots.length && sources.every(Boolean);
	const marks = useMemo(
		() => (showMarks && page?.side !== "back" ? cropMarks(imposition) : []),
		[showMarks, page?.side, imposition],
	);

	const width = Math.floor(paper.widthMm * pxPerMm);
	const height = Math.floor(paper.heightMm * pxPerMm);
	const label = page && page.side !== "any" ? SHEET_SIDE_LABEL[page.side] : "";

	return (
		<div
			className={cn("relative min-h-0 min-w-0", className)}
			data-testid="sheet-preview"
			data-page={pageIndex}
			data-side={page?.side}
			data-state={error ? "error" : ready ? "ready" : "loading"}
		>
			<div
				ref={boxRef}
				className="absolute inset-4 flex flex-col items-center justify-center"
			>
				<div style={{ width }} className="flex h-[22px] shrink-0 items-start">
					{label ? (
						<span
							className="font-medium text-[10px] text-fc-muted uppercase tracking-[0.06em]"
							data-testid="sheet-side-label"
						>
							{label}
						</span>
					) : null}
				</div>
				{/* White in both themes: it is the paper. */}
				<div
					className="relative shrink-0 bg-white shadow-(--shadow-fc-artboard)"
					style={{ width, height }}
					data-testid="sheet-paper"
					aria-label={`${paper.widthMm} × ${paper.heightMm} mm, ${paper.orientation}`}
					role="img"
				>
					{(page?.slots ?? []).map((slot, i) => (
						<SlotCanvas
							key={slot.item.key}
							source={sources[i]}
							itemKey={slot.item.key}
							current={showsRecord(slot.item, currentRecordId, currentVariant)}
							renderKey={requests[i]?.key}
							style={{
								left: `${(slot.xMm / paper.widthMm) * 100}%`,
								top: `${(slot.yMm / paper.heightMm) * 100}%`,
								width: `${(card.widthMm / paper.widthMm) * 100}%`,
								height: `${(card.heightMm / paper.heightMm) * 100}%`,
							}}
						/>
					))}
					{marks.length > 0 ? (
						<svg
							className="pointer-events-none absolute inset-0 size-full"
							viewBox={`0 0 ${paper.widthMm} ${paper.heightMm}`}
							preserveAspectRatio="none"
							aria-hidden="true"
							data-testid="sheet-crop-marks"
						>
							{marks.map((m) => (
								<line
									key={`${m.x1},${m.y1},${m.x2},${m.y2}`}
									x1={m.x1}
									y1={m.y1}
									x2={m.x2}
									y2={m.y2}
									className="stroke-black"
									strokeWidth={1}
									vectorEffect="non-scaling-stroke"
								/>
							))}
						</svg>
					) : null}
				</div>
			</div>
			{error ? (
				<p className="absolute inset-x-4 bottom-1 text-center text-fc-danger text-fc-sm">
					{error}
				</p>
			) : !ready ? (
				<span className="absolute right-3 bottom-1 text-fc-faint text-fc-sm">
					Rendering…
				</span>
			) : null}
		</div>
	);
}

function SlotCanvas({
	source,
	itemKey,
	current,
	renderKey,
	style,
}: {
	source: HTMLCanvasElement | undefined;
	itemKey: string;
	current: boolean;
	renderKey: string | undefined;
	style: CSSProperties;
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas || !source) return;
		if (canvas.width !== source.width) canvas.width = source.width;
		if (canvas.height !== source.height) canvas.height = source.height;
		const ctx = canvas.getContext("2d");
		ctx?.clearRect(0, 0, canvas.width, canvas.height);
		ctx?.drawImage(source, 0, 0);
	}, [source]);
	return (
		<div
			className={cn(
				"absolute",
				!source && "bg-black/5",
				current && "z-10 outline-2 outline-fc-accent outline-solid",
			)}
			style={style}
			data-testid="sheet-slot"
			data-item={itemKey}
			data-state={source ? "ready" : "loading"}
			data-render-key={renderKey}
		>
			<canvas
				ref={ref}
				className={cn("block size-full", !source && "invisible")}
			/>
		</div>
	);
}
