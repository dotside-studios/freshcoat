import { toColor } from "@freshcoat-js/engine";
import type { CanvasKit, Surface } from "canvaskit-wasm";
import { EditableText, type TextProps } from "./text-layout";

const BLINK_MS = 530;

export type SurfaceInput = {
	props: TextProps;
	fonts: ReadonlyMap<string, readonly Uint8Array[]> | undefined;
	box: { width: number; height: number };
	zoom: number;
};

/**
 * Paints the edited layer's text, its fields, the selection and the caret
 * into `canvas` with CanvasKit, following the textarea that takes the typing.
 * Checks once a frame and paints only when something shown has changed.
 */
export class TextSurface {
	readonly text: EditableText;
	input: SurfaceInput | null = null;
	private surface: Surface | null = null;
	private raf = 0;
	private laid: {
		value: string;
		props: TextProps;
		fonts: SurfaceInput["fonts"];
		width: number;
		height: number;
	} | null = null;
	private version = 0;
	private shown = "";
	private drawn = "";
	private since = 0;

	constructor(
		private readonly ck: CanvasKit,
		private readonly canvas: HTMLCanvasElement,
		private readonly area: HTMLTextAreaElement,
		private readonly onPainted: () => void,
	) {
		this.text = new EditableText(ck);
		const tick = (now: number) => {
			this.raf = requestAnimationFrame(tick);
			this.update(now);
		};
		this.raf = requestAnimationFrame(tick);
	}

	/** Lays the text out again now, ahead of the next frame. */
	sync(): boolean {
		const input = this.input;
		if (!input?.fonts) return false;
		const { props, fonts, box } = input;
		const value = this.area.value;
		const l = this.laid;
		if (
			l?.value !== value ||
			l.props !== props ||
			l.fonts !== fonts ||
			l.width !== box.width ||
			l.height !== box.height
		) {
			this.text.layout(value, props, fonts, box);
			this.laid = { value, props, fonts, ...box };
			this.version++;
		}
		return true;
	}

	private update(now: number) {
		if (!this.sync()) return;
		const { zoom } = this.input as SurfaceInput;
		const area = this.area;
		const focused = document.activeElement === area;
		const dpr = window.devicePixelRatio || 1;
		const shown = [
			this.version,
			area.selectionStart,
			area.selectionEnd,
			focused,
			zoom,
			dpr,
		].join();
		if (shown !== this.shown) {
			this.shown = shown;
			this.since = now;
		}
		const caret =
			focused &&
			area.selectionStart === area.selectionEnd &&
			Math.floor((now - this.since) / BLINK_MS) % 2 === 0;
		const key = `${shown},${caret}`;
		if (key === this.drawn) return;
		this.drawn = key;
		this.paint(zoom, dpr, focused, caret);
	}

	private paint(zoom: number, dpr: number, focused: boolean, caret: boolean) {
		const ck = this.ck;
		const canvas = this.canvas;
		const text = this.text;
		const box = (this.input as SurfaceInput).box;
		const cssWidth = box.width * zoom;
		const cssHeight = text.height * zoom;
		const width = Math.max(1, Math.round(cssWidth * dpr));
		const height = Math.max(1, Math.round(cssHeight * dpr));
		canvas.style.width = `${cssWidth}px`;
		canvas.style.height = `${cssHeight}px`;
		if (!this.surface || canvas.width !== width || canvas.height !== height) {
			this.surface?.delete();
			canvas.width = width;
			canvas.height = height;
			this.surface = ck.MakeSWCanvasSurface(canvas);
			if (!this.surface) return;
		}
		const accent = getComputedStyle(canvas).outlineColor;
		const sk = this.surface.getCanvas();
		const paint = new ck.Paint();
		paint.setAntiAlias(true);
		sk.clear(ck.TRANSPARENT);
		sk.save();
		sk.scale(zoom * dpr, zoom * dpr);
		const fill = (alpha: number, rects: ReturnType<EditableText["rects"]>) => {
			const c = toColor(ck, accent);
			c[3] = alpha;
			paint.setColor(c);
			for (const r of rects)
				sk.drawRRect(
					ck.RRectXY(
						ck.XYWHRect(r.x, r.y, r.width, r.height),
						2 / zoom,
						2 / zoom,
					),
					paint,
				);
		};
		fill(0.14, text.tokens());
		const start = this.area.selectionStart;
		const end = this.area.selectionEnd;
		if (start !== end) fill(focused ? 0.3 : 0.15, text.rects(start, end));
		text.paint(sk);
		if (caret) {
			const c = text.caret(start);
			const w = 1.5 / zoom;
			paint.setColor(toColor(ck, accent));
			sk.drawRect(ck.XYWHRect(c.x - w / 2, c.y, w, c.height), paint);
		}
		sk.restore();
		paint.delete();
		this.surface.flush();
		this.onPainted();
	}

	dispose(): void {
		cancelAnimationFrame(this.raf);
		this.surface?.delete();
		this.surface = null;
		this.text.dispose();
	}
}
