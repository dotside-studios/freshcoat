import { cn } from "@freshcoat-js/ui/lib/cn";
import { type ReactNode, useId } from "react";
import { linearPoints } from "~/canvas/gradient-geometry";
import { type Gradient, sortedStops } from "./fills";
import { gradientCss } from "./StopBar";

/**
 * A fill row's preview of a gradient as it is painted: its kind, points,
 * radii and rotation, laid out in a box of the layer's proportions and
 * stretched to the swatch. The geometry follows the coat engine's `shaderFor`.
 */
export function GradientSwatch({
	g,
	box,
	className,
}: {
	g: Gradient;
	/** The layer's size; only its proportions matter. */
	box?: { width: number; height: number };
	className?: string;
}) {
	const id = `swatch${useId().replace(/[^\w-]/g, "")}`;
	const w = box && box.width > 0 ? box.width : 1;
	const h = box && box.height > 0 ? box.height : 1;
	const ring = "shadow-[inset_0_0_0_1px_var(--color-fc-swatch-ring)]";

	if (g.kind === "angular") {
		const [cx, cy] = g.center ?? [0.5, 0.5];
		const head = `from ${g.rotation ?? 0}deg at ${cx * 100}% ${cy * 100}%`;
		return (
			<span
				aria-hidden
				data-testid="gradient-swatch"
				data-kind={g.kind}
				className={cn("fc-checkerboard relative overflow-hidden", className)}
			>
				<span
					className={cn("absolute inset-0 rounded-[inherit]", ring)}
					style={{
						background: `conic-gradient(${gradientCss(g.stops, head)})`,
					}}
				/>
			</span>
		);
	}

	const stops = sortedStops(g.stops).map((s, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: stops have no identity
		<stop key={i} offset={s.offset} stopColor={s.color} />
	));
	let paint: ReactNode;
	if (g.kind === "linear") {
		const { from, to } = linearPoints(g);
		paint = (
			<linearGradient
				id={id}
				gradientUnits="userSpaceOnUse"
				x1={from[0] * w}
				y1={from[1] * h}
				x2={to[0] * w}
				y2={to[1] * h}
			>
				{stops}
			</linearGradient>
		);
	} else {
		const [ux, uy] = g.center ?? [0.5, 0.5];
		const cx = ux * w;
		const cy = uy * h;
		const L = Math.max(w, h);
		const rx = (g.radius ?? 0.5) * L;
		const ry = (g.radiusY ?? g.radius ?? 0.5) * L;
		const squash = rx > 0 ? ry / rx : 1;
		paint = (
			<radialGradient
				id={id}
				gradientUnits="userSpaceOnUse"
				cx={cx}
				cy={cy}
				r={rx}
				gradientTransform={`rotate(${g.rotation ?? 0} ${cx} ${cy}) translate(${cx} ${cy}) scale(1 ${squash}) translate(${-cx} ${-cy})`}
			>
				{stops}
			</radialGradient>
		);
	}
	return (
		<span
			aria-hidden
			data-testid="gradient-swatch"
			data-kind={g.kind}
			className={cn("fc-checkerboard relative overflow-hidden", className)}
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0 size-full"
				viewBox={`0 0 ${w} ${h}`}
				preserveAspectRatio="none"
			>
				<defs>{paint}</defs>
				<rect width={w} height={h} fill={`url(#${id})`} />
			</svg>
			<span className={cn("absolute inset-0 rounded-[inherit]", ring)} />
		</span>
	);
}
