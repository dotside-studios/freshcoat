import { cn } from "@freshcoat-js/ui/lib/cn";
import { type ReactNode, useId } from "react";
import { type Pattern, patternParams } from "./fills";

/**
 * A fill row's preview of a pattern at its design size. Hatching and dots are
 * drawn exactly; noise and paper use SVG turbulence, the same Perlin noise the
 * engine's shaders sample, so the swatch reads alike without a CanvasKit pass.
 */
export function PatternSwatch({
	p,
	className,
}: {
	p: Pattern;
	className?: string;
}) {
	const id = `pattern${useId().replace(/[^\w-]/g, "")}`;
	const { scale, angle, density, seed, colors } = patternParams(p);
	const [bg, ink] = colors;
	const s = Math.max(scale, 0.1);
	const ring = "shadow-[inset_0_0_0_1px_var(--color-fc-swatch-ring)]";

	let def: ReactNode;
	let overlay: ReactNode;
	if (p.pattern === "hatching" || p.pattern === "dots") {
		def = (
			<pattern
				id={id}
				patternUnits="userSpaceOnUse"
				width={s}
				height={s}
				patternTransform={`rotate(${angle})`}
			>
				{p.pattern === "hatching" ? (
					<rect
						y={s * (0.5 - density / 2)}
						width={s}
						height={s * density}
						fill={ink}
					/>
				) : (
					<circle
						cx={s / 2}
						cy={s / 2}
						r={s * Math.min(Math.sqrt(density / Math.PI), 0.7072)}
						fill={ink}
					/>
				)}
			</pattern>
		);
		overlay = <rect width="100%" height="100%" fill={`url(#${id})`} />;
	} else {
		const paper = p.pattern === "paper";
		const alpha = paper
			? `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${3.2 * density} 0 0 0 0`
			: `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 4 0 0 0 ${density * 2 - 2.5}`;
		def = (
			<filter id={id} x="0" y="0" width="100%" height="100%">
				<feTurbulence
					type={paper ? "turbulence" : "fractalNoise"}
					baseFrequency={paper ? `${1 / s} ${6 / s}` : `${1 / s}`}
					numOctaves={paper ? 4 : 3}
					seed={seed}
					stitchTiles="noStitch"
					result="noise"
				/>
				<feColorMatrix in="noise" type="matrix" values={alpha} result="mask" />
				<feComposite in="SourceGraphic" in2="mask" operator="in" />
			</filter>
		);
		overlay = (
			<g transform={`rotate(${angle})`}>
				<rect
					x="-50%"
					y="-50%"
					width="200%"
					height="200%"
					fill={ink}
					filter={`url(#${id})`}
				/>
			</g>
		);
	}

	return (
		<span
			aria-hidden
			data-testid="pattern-swatch"
			data-pattern={p.pattern}
			className={cn("fc-checkerboard relative overflow-hidden", className)}
		>
			<svg aria-hidden="true" className="absolute inset-0 size-full">
				<defs>{def}</defs>
				<rect width="100%" height="100%" fill={bg} />
				{overlay}
			</svg>
			<span className={cn("absolute inset-0 rounded-[inherit]", ring)} />
		</span>
	);
}
