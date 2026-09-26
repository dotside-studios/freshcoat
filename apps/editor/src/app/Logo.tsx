import {
	FRESHCOAT_TEXT_PATH,
	STUDIO_OPACITY,
	STUDIO_TEXT_PATH,
} from "./logo-paths";

// The mono mark and the wordmark are drawn in the text colour so they follow
// the theme. The colour mark keeps its own colours.
const MARK_ASPECT = 138 / 120;
// The wordmark sits in the logo's 1000 x 120 box, from x = 169.
const TEXT_X = 169;
const TEXT_WIDTH = 1000 - TEXT_X;

export function FreshcoatMark({ height }: { height: number }) {
	return (
		<span
			role="img"
			aria-label="Freshcoat Studio"
			className="inline-block bg-current"
			style={{
				height,
				width: height * MARK_ASPECT,
				mask: "url(/freshcoat-mark-mono.svg) center / contain no-repeat",
			}}
		/>
	);
}

export function FreshcoatLogo({ height }: { height: number }) {
	const unit = height / 120;
	return (
		<span
			role="img"
			aria-label="Freshcoat Studio"
			className="inline-flex"
			style={{ height, gap: (TEXT_X - 138) * unit }}
		>
			<img
				src="/favicon.svg"
				alt=""
				style={{ height, width: height * MARK_ASPECT }}
			/>
			<svg
				viewBox={`${TEXT_X} 0 ${TEXT_WIDTH} 120`}
				height={height}
				width={TEXT_WIDTH * unit}
				aria-hidden="true"
			>
				<path fill="currentColor" d={FRESHCOAT_TEXT_PATH} />
				<path
					fill="currentColor"
					fillOpacity={STUDIO_OPACITY}
					d={STUDIO_TEXT_PATH}
				/>
			</svg>
		</span>
	);
}
