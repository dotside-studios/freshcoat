import {
	IconApprovedCheckmark16,
	IconWarning16,
	LoadingIndicator,
} from "@create-figma-plugin/ui";
import { createContext, type JSX } from "preact";
import {
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "preact/hooks";

export type StatusTone = "info" | "working" | "success" | "error";
export type Status = { text: string; tone: StatusTone; quiet?: boolean };

/** `quiet`: the panel already shows the outcome where it happened (the result
 *  card, the "Applied" beside Apply), so the line is read out but not drawn,
 *  and costs no height. */
type Announce = (
	text: string,
	tone?: StatusTone,
	opts?: { quiet?: boolean },
) => void;

const StatusContext = createContext<Announce>(() => {});

/** Put a line in the status bar. Working lines stay until something replaces
 *  them; the rest fade after a few seconds, so an old "Applied" is never read
 *  as the answer to the next action. */
export function useAnnounce(): Announce {
	return useContext(StatusContext);
}

const TRANSIENT_MS = 5000;

export function useStatusState(): {
	status: Status | null;
	announce: Announce;
} {
	const [status, setStatus] = useState<Status | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const announce = useCallback<Announce>((text, tone = "info", opts) => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		setStatus({ text, tone, ...(opts?.quiet ? { quiet: true } : {}) });
		if (tone === "success" || tone === "info") {
			timer.current = setTimeout(() => setStatus(null), TRANSIENT_MS);
		}
	}, []);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);
	return { status, announce };
}

export const StatusProvider = StatusContext.Provider;

/** The line at the bottom of the panel. It is a polite live region, so a
 *  screen reader hears "Exported" without the focus moving off the button.
 *  With nothing to say it folds away to nothing, so it costs the panel no
 *  height; the region itself stays mounted, as a live region must to be
 *  heard. */
export function StatusLine(props: { status: Status | null }): JSX.Element {
	const { status } = props;
	const shown = status !== null && !status.quiet;
	const icon =
		status?.tone === "working" ? (
			<LoadingIndicator />
		) : status?.tone === "success" ? (
			<IconApprovedCheckmark16 />
		) : status?.tone === "error" ? (
			<IconWarning16 />
		) : null;
	return (
		<output
			aria-live="polite"
			style={{
				display: "flex",
				alignItems: "center",
				gap: "4px",
				flexShrink: 0,
				height: shown ? "24px" : 0,
				// Clear of the resize grip in the corner.
				padding: "0 16px 0 var(--fc-gutter)",
				borderTop: shown ? "1px solid var(--figma-color-border)" : "none",
				background: "var(--figma-color-bg)",
				color:
					status?.tone === "error"
						? "var(--figma-color-text-danger)"
						: "var(--figma-color-text-secondary)",
				fontSize: "11px",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis",
			}}
		>
			{icon && shown ? (
				<span
					aria-hidden="true"
					style={{
						display: "flex",
						width: "16px",
						height: "16px",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
					}}
				>
					{icon}
				</span>
			) : null}
			<span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
				{status?.text ?? ""}
			</span>
		</output>
	);
}
