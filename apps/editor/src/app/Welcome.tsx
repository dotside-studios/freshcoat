import { Button } from "@freshcoat/ui/button";
import { NumberField } from "@freshcoat/ui/number-field";
import { Fragment, useEffect, useState } from "react";
import { Button as RACButton } from "react-aria-components";
import { PRESETS } from "~/doc/new-document";
import { SAMPLES } from "~/samples";
import { STARTERS } from "~/samples/starters";
import FileIcon from "~icons/mingcute/file-new-line";
import OpenIcon from "~icons/mingcute/folder-open-line";
import RestoreIcon from "~icons/mingcute/history-line";
import {
	type Autosave,
	clearAutosave,
	readAutosave,
	restoreNotices,
} from "./autosave";
import type { CommandContext } from "./commands";
import { OPEN_HINT, plural } from "./copy";
import { FreshcoatLogo } from "./Logo";

/** The welcome screen. `openHint` rings "Open file…" and says what to open,
 *  for a template the Figma plugin downloaded because it was too large for a
 *  link. */
export function Welcome({
	ctx,
	openHint = false,
}: {
	ctx: CommandContext;
	openHint?: boolean;
}) {
	const { controller } = ctx;
	const [custom, setCustom] = useState({ width: 1080, height: 1080 });
	const [autosave, setAutosave] = useState<Autosave | null>(null);

	useEffect(() => {
		let live = true;
		void readAutosave().then((a) => {
			if (live) setAutosave(a);
		});
		return () => {
			live = false;
		};
	}, []);

	return (
		<main className="grid min-h-0 flex-1 place-items-center overflow-auto p-6">
			<div className="w-full max-w-4xl">
				<header className="mb-6 flex items-end justify-between gap-4">
					<div>
						<h1>
							<FreshcoatLogo height={30} />
						</h1>
						<p className="mt-2 text-fc-muted">Create designs that scale.</p>
					</div>
					<Button
						onPress={ctx.pickFile}
						variant="primary"
						data-testid="welcome-open-file"
						data-hinted={openHint || undefined}
						className={
							openHint
								? "ring-2 ring-fc-accent ring-offset-2 ring-offset-fc-app"
								: undefined
						}
					>
						<OpenIcon />
						Open file…
					</Button>
				</header>

				{openHint ? (
					<p
						className="-mt-3 mb-4 text-right text-fc-accent"
						data-testid="open-hint"
					>
						{OPEN_HINT}
					</p>
				) : null}

				{autosave ? (
					<div
						className="mb-4 flex items-center gap-3 rounded-md border border-fc-border bg-fc-panel px-3 py-2"
						data-testid="restore-banner"
					>
						<RestoreIcon className="size-4 text-fc-accent" />
						<p className="min-w-0 flex-1 truncate">
							Unsaved work from {new Date(autosave.savedAt).toLocaleString()}:{" "}
							<span className="text-fc-muted">
								{autosave.workspace.name} ({autosave.fileName})
							</span>
						</p>
						<Button
							variant="ghost"
							onPress={() => {
								void clearAutosave();
								setAutosave(null);
							}}
						>
							Dismiss
						</Button>
						<Button
							variant="primary"
							onPress={() =>
								controller.openWorkspace(
									autosave.workspace,
									autosave.fileName,
									restoreNotices(autosave),
								)
							}
						>
							Restore
						</Button>
					</div>
				) : null}

				<section
					className="mb-4 rounded-md border border-fc-border bg-fc-panel"
					aria-labelledby="start-from"
				>
					<SectionTitle id="start-from">Start from</SectionTitle>
					<ul className="grid gap-2 p-3 sm:grid-cols-3">
						{STARTERS.map((s) => (
							<li key={s.id}>
								<RACButton
									data-testid={`starter-${s.id}`}
									onPress={() => void controller.openStarter(s.id)}
									className="flex h-full w-full items-center gap-3 rounded-[3px] border border-fc-border bg-fc-raised p-2.5 text-left outline-none data-hovered:border-fc-border-strong data-hovered:bg-fc-hover data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
								>
									<span className="grid size-16 shrink-0 place-items-center">
										<Thumb
											width={s.width}
											height={s.height}
											swatch={s.swatch}
											large
										/>
									</span>
									<span className="min-w-0">
										<span className="block truncate font-medium">{s.name}</span>
										<span className="line-clamp-2 text-fc-muted text-fc-sm">
											{s.description}
										</span>
									</span>
								</RACButton>
							</li>
						))}
					</ul>
				</section>

				<div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
					<section className="rounded-md border border-fc-border bg-fc-panel">
						<SectionTitle>New template</SectionTitle>
						<ul className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
							{PRESETS.map((p) => (
								<li key={p.id}>
									<Tile
										label={p.name}
										detail={`${p.width} × ${p.height}${p.sides.length > 1 ? ` · ${plural(p.sides.length, "side")}` : ""}`}
										width={p.width}
										height={p.height}
										onPress={() => controller.newDocument(p)}
									/>
								</li>
							))}
						</ul>
						<div className="flex flex-wrap items-center gap-2 border-fc-border border-t px-3 py-2.5">
							<span className="text-fc-muted">Custom</span>
							<NumberField
								label="W"
								aria-label="Custom width"
								className="w-24"
								value={custom.width}
								min={1}
								max={16384}
								precision={0}
								onChange={(v) =>
									v !== null &&
									setCustom((c) => ({ ...c, width: Math.round(v) }))
								}
							/>
							<NumberField
								label="H"
								aria-label="Custom height"
								className="w-24"
								value={custom.height}
								min={1}
								max={16384}
								precision={0}
								onChange={(v) =>
									v !== null &&
									setCustom((c) => ({ ...c, height: Math.round(v) }))
								}
							/>
							<Button onPress={() => controller.newDocument(custom)}>
								<FileIcon />
								Create
							</Button>
						</div>
					</section>

					<section className="rounded-md border border-fc-border bg-fc-panel">
						<SectionTitle>Samples</SectionTitle>
						<ul className="space-y-2 p-3">
							{SAMPLES.map((s) => (
								<li key={s.id}>
									<RACButton
										data-testid={`sample-${s.id}`}
										onPress={() => void controller.openSample(s.id)}
										className="flex w-full items-center gap-3 rounded-[3px] border border-fc-border bg-fc-raised p-2.5 text-left outline-none data-hovered:border-fc-border-strong data-hovered:bg-fc-hover data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
									>
										<Thumb width={s.width} height={s.height} />
										<span className="min-w-0">
											<span className="block truncate font-medium">
												{s.name}
											</span>
											<span className="block truncate text-fc-muted text-fc-sm">
												{s.description}
											</span>
										</span>
									</RACButton>
								</li>
							))}
						</ul>
					</section>
				</div>
			</div>
		</main>
	);
}

function SectionTitle({ children, id }: { children: string; id?: string }) {
	return (
		<h2
			id={id}
			className="flex h-8 items-center border-fc-border border-b px-3 font-semibold text-fc-muted text-fc-xs uppercase tracking-wider"
		>
			{children}
		</h2>
	);
}

function Tile({
	label,
	detail,
	width,
	height,
	onPress,
}: {
	label: string;
	detail: string;
	width: number;
	height: number;
	onPress: () => void;
}) {
	return (
		<RACButton
			onPress={onPress}
			className="flex h-full w-full flex-col items-center gap-2 rounded-[3px] border border-fc-border bg-fc-raised p-3 outline-none data-hovered:border-fc-border-strong data-hovered:bg-fc-hover data-focus-visible:outline-solid data-focus-visible:outline-1 data-focus-visible:outline-fc-accent"
		>
			<div className="grid h-16 w-full place-items-center">
				<Thumb width={width} height={height} large />
			</div>
			<span className="text-center">
				<span className="block font-medium">{label}</span>
				<span className="block text-fc-muted text-fc-sm tabular-nums">
					{detail.split(" · ").map((part, i) => (
						<Fragment key={part}>
							{i > 0 ? " · " : null}
							<span className="whitespace-nowrap">{part}</span>
						</Fragment>
					))}
				</span>
			</span>
		</RACButton>
	);
}

function Thumb({
	width,
	height,
	large,
	swatch,
}: {
	width: number;
	height: number;
	large?: boolean;
	/** The starter's own color, from its data. */
	swatch?: string;
}) {
	const max = large ? 60 : 36;
	const s = max / Math.max(width, height);
	return (
		<span
			aria-hidden="true"
			className="inline-block shrink-0 rounded-[1px] border border-fc-border-strong bg-fc-hover"
			style={{
				width: Math.round(width * s),
				height: Math.round(height * s),
				...(swatch ? { background: swatch, borderColor: "transparent" } : {}),
			}}
		/>
	);
}
