import {
	checkVariants,
	type Template,
	type ValidationError,
	type VariantIssue,
} from "@freshcoat/coatfile";
import { Button } from "@freshcoat/ui/button";
import { Dialog } from "@freshcoat/ui/dialog";
import { cn } from "@freshcoat/ui/lib/cn";
import { DialogTrigger, Popover } from "@freshcoat/ui/popover";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Button as RACButton } from "react-aria-components";
import { type SafeAreaHint, safeAreaHints } from "~/canvas/print-guides";
import { removeUnusedChanges } from "~/doc/ops";
import { walkLayers } from "~/doc/path";
import { Badge, goToReference, referenceLabel } from "~/panels/content/shared";
import { useEditor } from "~/state/hooks";
import type { BarcodeIssue } from "~/state/store";
import CheckIcon from "~icons/mingcute/check-circle-line";
import WarnIcon from "~icons/mingcute/warning-line";
import { useController } from "./context";
import { plural, VARIANT_UI } from "./copy";
import { issueMessage, issuePathToKey } from "./issue-path";

const EMPTY: ValidationError[] = [];
const NONE: string[] = [];
const NO_CODES: BarcodeIssue[] = [];

/** Called after a link in the list is followed; the popover closes on it. */
const FollowContext = createContext<() => void>(() => {});

/**
 * What the list counts: validation, variant, file, render and loading issues.
 * Hints (print and preview) are advice, not problems, so a template with only
 * hints has no issues.
 */
export function useIssues(template: Template | null) {
	const issues = useEditor((s) => s.doc?.issues ?? EMPTY);
	const notices = useEditor((s) => s.doc?.notices ?? NONE);
	const paint = useEditor((s) => s.render.warnings);
	const variantIssues = useMemo(
		() => (template ? checkVariants(template) : []),
		[template],
	);
	const warnings = template?.warnings ?? [];
	return {
		issues,
		notices,
		paint,
		variantIssues,
		warnings,
		total:
			issues.length +
			warnings.length +
			paint.length +
			notices.length +
			variantIssues.length,
	};
}

/**
 * The status bar's issues button, and the list it opens in a popover. A save
 * that fails validation opens it too.
 */
export function IssuesPopover() {
	const controller = useController();
	const template = useEditor((s) => s.doc?.history.present ?? null);
	const { total } = useIssues(template);
	const [open, setOpen] = useState(false);
	useEffect(() => controller.onShowIssues(() => setOpen(true)), [controller]);
	const label = total ? plural(total, "issue") : "No issues";

	return (
		<DialogTrigger isOpen={open && !!template} onOpenChange={setOpen}>
			<RACButton
				data-testid="issues-badge"
				className="flex items-center gap-1 rounded-[3px] px-1 outline-none data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent data-hovered:bg-fc-hover"
				aria-label={label}
			>
				{total ? (
					<>
						<WarnIcon className="size-3.5 text-fc-danger" />
						<span className="text-fc-danger">{total}</span>
					</>
				) : (
					<CheckIcon className="size-3.5 text-fc-success" />
				)}
			</RACButton>
			<Popover
				placement="top start"
				className="flex w-80 max-w-[calc(100vw-1rem)] flex-col"
			>
				<Dialog
					data-testid="issues-popover"
					title={
						<span className="flex items-center gap-1.5">
							Issues
							{total > 0 ? <Badge tone="danger">{total}</Badge> : null}
						</span>
					}
				>
					{template ? (
						<FollowContext.Provider value={() => setOpen(false)}>
							<IssuesList template={template} />
						</FollowContext.Provider>
					) : null}
				</Dialog>
			</Popover>
		</DialogTrigger>
	);
}

/** Every issue and hint of the template, grouped, each linking to what it is
 *  about. */
export function IssuesList({ template }: { template: Template }) {
	const { issues, notices, paint, variantIssues, warnings, total } =
		useIssues(template);
	const codes = useEditor((s) => s.render.barcodes ?? NO_CODES);
	const hints = useMemo(() => safeAreaHints(template), [template]);

	return (
		<div className="flex flex-col gap-2" data-testid="issues-list">
			{total === 0 ? (
				<p
					className="m-0 flex items-center gap-1.5 text-fc-muted text-fc-sm"
					data-testid="no-issues"
				>
					<CheckIcon className="size-3.5 text-fc-success" />
					No issues
				</p>
			) : null}
			{issues.length > 0 ? (
				<IssueList label="Validation">
					{withKeys(issues, (x) => `${x.path}:${x.code}:${x.message}`).map(
						([key, issue]) => (
							<ValidationRow key={key} template={template} issue={issue} />
						),
					)}
				</IssueList>
			) : null}
			{variantIssues.length > 0 ? (
				<VariantIssues template={template} issues={variantIssues} />
			) : null}
			{hints.length > 0 ? (
				<IssueList label="Print hints">
					{hints.map((hint) => (
						<HintRow key={hint.key} template={template} hint={hint} />
					))}
				</IssueList>
			) : null}
			{codes.length > 0 ? (
				<IssueList label="Preview hints">
					{withKeys(codes, (x) => `${x.key}:${x.message}`).map(
						([key, code]) => (
							<BarcodeHintRow key={key} template={template} issue={code} />
						),
					)}
				</IssueList>
			) : null}
			{warnings.length > 0 ? (
				<IssueList label="File warnings">
					{withKeys(warnings, (x) => `${x.code}:${x.message}`).map(
						([key, w]) => (
							<Entry
								key={key}
								tone={
									w.severity === "error"
										? "danger"
										: w.severity === "warn"
											? "warning"
											: "muted"
								}
								code={w.code}
								detail={
									w.nodeId
										? `Layer ${w.nodeId}${w.slot ? ` · ${w.slot}` : ""}`
										: undefined
								}
							>
								{w.message}
							</Entry>
						),
					)}
				</IssueList>
			) : null}
			{paint.length > 0 ? (
				<IssueList label="Last render">
					{withKeys(paint, (x) => x).map(([key, w]) => (
						<Entry key={key} tone="warning" code="paint">
							{w}
						</Entry>
					))}
				</IssueList>
			) : null}
			{notices.length > 0 ? (
				<IssueList label="When loading">
					{withKeys(notices, (x) => x).map(([key, n]) => (
						<Entry key={key} tone="accent" code="notice">
							{n}
						</Entry>
					))}
				</IssueList>
			) : null}
		</div>
	);
}

function IssueList({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<section aria-label={label} className="flex flex-col gap-1">
			<h3 className="m-0 font-semibold text-[10px] text-fc-faint uppercase tracking-[0.06em]">
				{label}
			</h3>
			<ul className="m-0 flex list-none flex-col gap-1 p-0">{children}</ul>
		</section>
	);
}

const TONE = {
	muted: "bg-fc-faint",
	warning: "bg-fc-warning",
	danger: "bg-fc-danger",
	accent: "bg-fc-accent",
} as const;

/** One entry: what is wrong in words, then a link to what it is about. The
 *  code and any raw detail sit in the tooltip, for whoever reads the file. */
function Entry({
	tone,
	code,
	link,
	detail,
	children,
	as: Tag = "li",
}: {
	tone: keyof typeof TONE;
	/** The entry's code and anything else only a file's author needs. */
	code: string;
	link?: ReactNode;
	/** A quiet second line when there is nothing to link to. */
	detail?: ReactNode;
	children: ReactNode;
	as?: "li" | "div";
}) {
	return (
		<Tag
			title={code}
			className="flex gap-1.5 rounded-[3px] bg-fc-raised/60 px-1.5 py-1"
		>
			<span
				aria-hidden="true"
				className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", TONE[tone])}
			/>
			<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
				<p className="m-0 break-words text-fc-sm text-fc-text leading-snug">
					{children}
				</p>
				{link}
				{detail ? (
					<div className="min-w-0 break-words text-fc-faint text-fc-sm leading-snug">
						{detail}
					</div>
				) : null}
			</div>
		</Tag>
	);
}

/** A link to what an entry is about; following it closes the popover. */
function EntryLink({
	label,
	onPress,
	children,
	testId,
}: {
	label: string;
	onPress: () => void;
	children: ReactNode;
	testId?: string;
}) {
	const follow = useContext(FollowContext);
	return (
		<RACButton
			data-testid={testId}
			aria-label={label}
			onPress={() => {
				onPress();
				follow();
			}}
			className="max-w-full cursor-default break-words rounded-[2px] text-left text-fc-accent-hover text-fc-sm leading-snug underline decoration-fc-accent/50 underline-offset-2 outline-none data-hovered:text-fc-text data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
		>
			{children}
		</RACButton>
	);
}

function ValidationRow({
	template,
	issue,
}: {
	template: Template;
	issue: ValidationError;
}) {
	const controller = useController();
	const key = issuePathToKey(issue.path, template);
	const layer = key ? referenceLabel(template, key) : null;
	return (
		<Entry
			tone="danger"
			code={[issue.code, issue.path || "/", issue.message].join("\n")}
			link={
				key && layer ? (
					<EntryLink
						testId="issue-path"
						label={`Select ${layer}`}
						onPress={() => goToReference(controller, key)}
					>
						{layer}
					</EntryLink>
				) : undefined
			}
		>
			{issueMessage(issue, template)}
		</Entry>
	);
}

function HintRow({
	template,
	hint,
}: {
	template: Template;
	hint: SafeAreaHint;
}) {
	const controller = useController();
	const layer = referenceLabel(template, hint.key);
	return (
		<li data-testid="print-hint" data-level="info">
			<Entry
				as="div"
				tone="muted"
				code="safe_area"
				link={
					<EntryLink
						label={`Select ${layer}`}
						onPress={() => goToReference(controller, hint.key)}
					>
						{layer}
					</EntryLink>
				}
			>
				{hint.message}
			</Entry>
		</li>
	);
}

/** A barcode the preview record's value doesn't encode. The export fails that
 *  record, so it is listed here before it gets that far. */
function BarcodeHintRow({
	template,
	issue,
}: {
	template: Template;
	issue: BarcodeIssue;
}) {
	const controller = useController();
	const { key } = issue;
	return (
		<li data-testid="barcode-hint" data-level="info">
			<Entry
				as="div"
				tone="muted"
				code="barcode_invalid"
				link={
					key ? (
						<EntryLink
							label={`Select ${referenceLabel(template, key)}`}
							onPress={() => goToReference(controller, key)}
						>
							{referenceLabel(template, key)}
						</EntryLink>
					) : undefined
				}
			>
				{issue.message}
			</Entry>
		</li>
	);
}

/** `checkVariants`: changes to layers that are gone, and changes that change
 *  nothing. Selecting one shows that variant and selects the layer. */
function VariantIssues({
	template,
	issues,
}: {
	template: Template;
	issues: VariantIssue[];
}) {
	const controller = useController();
	const orphans = issues.some((i) => i.code === "variant_orphan_override");
	return (
		<IssueList label="Variants">
			{withKeys(issues, (x) => `${x.code}:${x.path.join("/")}`).map(
				([key, issue]) => (
					<VariantIssueRow key={key} template={template} issue={issue} />
				),
			)}
			{orphans ? (
				<li className="flex">
					<Button
						size="sm"
						onPress={() =>
							controller.edit(removeUnusedChanges, { scope: "base" })
						}
					>
						{VARIANT_UI.removeUnused}
					</Button>
				</li>
			) : null}
		</IssueList>
	);
}

function VariantIssueRow({
	template,
	issue,
}: {
	template: Template;
	issue: VariantIssue;
}) {
	const controller = useController();
	const label =
		template.variants?.find((v) => v.id === issue.variantId)?.label ??
		issue.variantId;
	const side = template.template_data.findIndex((f) => f.name === issue.side);
	let layerKey: string | undefined;
	if (side >= 0 && issue.elementId !== undefined)
		for (const e of walkLayers(template, side))
			if (!("background" in e.path) && e.element.id === issue.elementId) {
				layerKey = e.key;
				break;
			}
	const layer = issue.elementId ?? issue.side;
	// A layer that is gone has nothing to select, so the link shows the
	// variant on the side it names.
	const target = layerKey
		? referenceLabel(template, layerKey)
		: referenceLabel(template, `variant:${issue.variantId}`);
	return (
		<li data-testid="variant-issue" data-code={issue.code}>
			<Entry
				as="div"
				tone="warning"
				code={[issue.code, issue.message].join("\n")}
				link={
					<EntryLink
						label={`Show ${layer} in ${label}`}
						onPress={() => {
							controller.setVariant(issue.variantId);
							if (layerKey) goToReference(controller, layerKey);
							else if (side >= 0)
								controller.dispatch({ type: "setSide", side });
						}}
					>
						{target}
					</EntryLink>
				}
			>
				{issue.code === "variant_orphan_override"
					? VARIANT_UI.orphan(label, layer, issue.side)
					: VARIANT_UI.empty(label, layer)}
			</Entry>
		</li>
	);
}

/** Pairs each item with a key from its content, numbering repeats. */
function withKeys<T>(
	items: readonly T[],
	id: (item: T) => string,
): [string, T][] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const base = id(item);
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return [n > 1 ? `${base}#${n}` : base, item];
	});
}
