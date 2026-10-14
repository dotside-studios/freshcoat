import { Button } from "@freshcoat-js/ui/button";
import { cn } from "@freshcoat-js/ui/lib/cn";
import { Button as RACButton } from "react-aria-components";
import CheckIcon from "~icons/mingcute/check-circle-line";
import WarningIcon from "~icons/mingcute/warning-line";
import type { Check, CheckTarget } from "./checks";
import { PopoverPanel } from "./PopoverPanel";

const tone = (check: Check) =>
	check.severity === "error" ? "text-fc-danger-text" : "text-fc-warning";

export function ChecksList({
	checks,
	onTarget,
	className,
}: {
	checks: readonly Check[];
	onTarget: (target: CheckTarget) => void;
	className?: string;
}) {
	if (checks.length === 0)
		return (
			<p
				className="m-0 flex items-center gap-1 px-2 py-2 text-fc-muted text-fc-sm"
				data-testid="export-checks-clear"
			>
				<CheckIcon className="size-3.5 shrink-0" />
				All clear
			</p>
		);
	return (
		<ul
			className={cn("m-0 flex list-none flex-col gap-2 p-0", className)}
			data-testid="export-checks"
		>
			{checks.map((check) => (
				<li
					key={check.id}
					className="flex min-w-0 flex-col gap-1 text-fc-sm"
					data-testid={`export-check-${check.id}`}
					data-severity={check.severity}
				>
					<div className={cn("flex min-w-0 items-start gap-1", tone(check))}>
						<WarningIcon className="mt-0.5 size-3.5 shrink-0" />
						<span className="min-w-0 flex-1" title={check.detail}>
							{check.message}
						</span>
						{check.action ? (
							<Button
								variant="ghost"
								size="sm"
								className="shrink-0"
								onPress={() => {
									if (check.action) onTarget(check.action.target);
								}}
							>
								{check.action.label}
							</Button>
						) : null}
					</div>
					{check.items ? (
						<ul
							className="m-0 max-h-40 list-none overflow-auto pl-5"
							data-testid={`export-check-${check.id}-list`}
						>
							{check.items.map((item) => (
								<li
									key={item.key}
									className="flex min-w-0 items-baseline gap-2 py-0.5"
								>
									<RACButton
										onPress={() => onTarget(item.target)}
										className="max-w-40 shrink-0 cursor-default truncate text-left text-fc-text outline-none data-hovered:underline data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-focus-visible:outline-solid"
									>
										{item.label}
									</RACButton>
									<span className="min-w-0 truncate font-fc-mono text-[11px] text-fc-muted">
										{item.note}
									</span>
								</li>
							))}
						</ul>
					) : null}
				</li>
			))}
		</ul>
	);
}

/** A count next to the Export button that opens the checks. */
export function ChecksBadge({
	checks,
	onTarget,
}: {
	checks: readonly Check[];
	onTarget: (target: CheckTarget) => void;
}) {
	if (checks.length === 0) return null;
	const blocking = checks.some((c) => c.severity === "error");
	return (
		<PopoverPanel
			title="Checks"
			trigger={
				<Button
					size="sm"
					aria-label={`Checks, ${checks.length}`}
					className={blocking ? "text-fc-danger-text" : "text-fc-warning"}
					data-testid="export-checks-badge"
				>
					<WarningIcon />
					<span className="tabular-nums">{checks.length}</span>
				</Button>
			}
		>
			{(close) => (
				<ChecksList
					className="max-h-80 overflow-auto p-2"
					checks={checks}
					onTarget={(target) => {
						close();
						onTarget(target);
					}}
				/>
			)}
		</PopoverPanel>
	);
}
