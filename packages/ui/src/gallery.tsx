import {
	type ReactNode,
	type SVGProps,
	useEffect,
	useMemo,
	useState,
} from "react";
import {
	Collection,
	type Key,
	type Selection,
	type SortDescriptor,
	useDragAndDrop,
	useTreeData,
} from "react-aria-components";
import { Button } from "./button";
import { Checkbox, Switch } from "./checkbox";
import { ColorInput } from "./color";
import { ComboBox, ComboBoxItem } from "./combo-box";
import {
	DataBody,
	DataCell,
	DataColumn,
	DataRow,
	DataTable,
	DataTableContainer,
	DataTableHeader,
	VirtualDataTable,
} from "./data-table";
import { Dialog, Modal } from "./dialog";
import { TextArea, TextField } from "./field";
import { IconButton } from "./icon-button";
import { Kbd } from "./kbd";
import {
	ContextMenu,
	Menu,
	MenuBar,
	MenuBarMenu,
	MenuItem,
	MenuSection,
	MenuSeparator,
	SubmenuTrigger,
} from "./menu";
import { NumberField } from "./number-field";
import { PanelSection } from "./panel";
import { DialogTrigger, Popover } from "./popover";
import { ProgressBar } from "./progress";
import { SegmentedControl, SegmentedItem } from "./segmented";
import { Select, SelectItem } from "./select";
import { Slider } from "./slider";
import { Tab, TabList, TabPanel, Tabs } from "./tabs";
import { ToastRegion, toast } from "./toast";
import { ToggleButton, ToggleGroup, ToggleGroupItem } from "./toggle";
import { Toolbar, ToolbarSeparator } from "./toolbar";
import { Tooltip, TooltipTrigger } from "./tooltip";
import { Tree, TreeItem } from "./tree";

// Gallery-only glyphs. The editor uses mingcute icons through unplugin-icons.
function G(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.4}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		/>
	);
}
const I = {
	move: () => (
		<G>
			<path d="M3.5 2.5 12 7.2l-3.8 1-1.5 3.8z" />
		</G>
	),
	rect: () => (
		<G>
			<rect x="2.5" y="3.5" width="11" height="9" rx="1" />
		</G>
	),
	ellipse: () => (
		<G>
			<circle cx="8" cy="8" r="5.5" />
		</G>
	),
	text: () => (
		<G>
			<path d="M3.5 4V3h9v1M8 3v10M6 13h4" />
		</G>
	),
	image: () => (
		<G>
			<rect x="2.5" y="3" width="11" height="10" rx="1" />
			<path d="m3 11.5 3.2-3.2 2.3 2.2 1.7-1.6 2.8 2.6" />
			<circle cx="10.5" cy="6" r="1" />
		</G>
	),
	frame: () => (
		<G>
			<path d="M5 2v12M11 2v12M2 5h12M2 11h12" />
		</G>
	),
	hand: () => (
		<G>
			<path d="M5.5 8V3.8a1 1 0 0 1 2 0V7m0-3.7a1 1 0 0 1 2 0V7m0-2.2a1 1 0 0 1 2 0v4.4A4.8 4.8 0 0 1 6.7 14h-.3a3.8 3.8 0 0 1-3-1.5L1.9 10.2a1 1 0 0 1 1.6-1.2L5.5 11" />
		</G>
	),
	eye: () => (
		<G>
			<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
			<circle cx="8" cy="8" r="2" />
		</G>
	),
	lock: () => (
		<G>
			<rect x="3.5" y="7" width="9" height="6.5" rx="1" />
			<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
		</G>
	),
	plus: () => (
		<G>
			<path d="M8 3v10M3 8h10" />
		</G>
	),
	minus: () => (
		<G>
			<path d="M3 8h10" />
		</G>
	),
	alignLeft: () => (
		<G>
			<path d="M2.5 2v12M5 5h8M5 11h5" />
		</G>
	),
	alignCenter: () => (
		<G>
			<path d="M8 2v12M4 5h8M5.5 11h5" />
		</G>
	),
	alignRight: () => (
		<G>
			<path d="M13.5 2v12M3 5h8M6 11h5" />
		</G>
	),
	more: () => (
		<G>
			<circle cx="4" cy="8" r=".6" fill="currentColor" />
			<circle cx="8" cy="8" r=".6" fill="currentColor" />
			<circle cx="12" cy="8" r=".6" fill="currentColor" />
		</G>
	),
	rotate: () => (
		<G>
			<path d="M12.5 5.5A5 5 0 1 0 13 9M12.8 2.5v3h-3" />
		</G>
	),
};

interface Layer {
	id: string;
	name: string;
	kind: keyof typeof I;
	children?: Layer[];
}

const LAYERS: Layer[] = [
	{ id: "title", name: "title", kind: "text" },
	{
		id: "header",
		name: "header",
		kind: "frame",
		children: [
			{ id: "logo", name: "logo", kind: "image" },
			{ id: "org_name", name: "org_name", kind: "text" },
		],
	},
	{ id: "avatar", name: "avatar with a very long layer name", kind: "ellipse" },
	{ id: "card_bg", name: "card_bg", kind: "rect" },
];

const FONTS = [
	"Inter",
	"Vend Sans",
	"Roboto",
	"Montserrat",
	"Playfair Display",
	"Space Grotesk",
].map((name) => ({ id: name, name }));

const BLEND = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
].map((id) => ({ id }));

const SWATCHES = [
	"#2f7cf6",
	"#e5484d",
	"#f5a524",
	"#30a46c",
	"#111111",
	"#ffffff",
	"#ffffff80",
];

function Section({
	title,
	children,
	className = "",
}: {
	title: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={`rounded-md border border-fc-border bg-fc-panel ${className}`}
		>
			<h2 className="border-fc-border border-b px-3 py-1.5 font-semibold text-[10px] text-fc-muted uppercase tracking-[0.06em]">
				{title}
			</h2>
			<div className="flex flex-col gap-3 p-3">{children}</div>
		</section>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="w-20 shrink-0 text-fc-faint text-fc-sm">{label}</span>
			{children}
		</div>
	);
}

function LayersTree() {
	const tree = useTreeData<Layer>({
		initialItems: LAYERS,
		getKey: (l) => l.id,
		getChildren: (l) => l.children ?? [],
	});
	const [selected, setSelected] = useState<Selection>(new Set(["header"]));
	const [hidden, setHidden] = useState<Set<Key>>(new Set(["card_bg"]));
	const [locked, setLocked] = useState<Set<Key>>(new Set());

	const { dragAndDropHooks } = useDragAndDrop<Layer>({
		getItems: (keys) =>
			[...keys].map((k) => ({
				"text/plain": tree.getItem(k)?.value.name ?? String(k),
			})),
		renderDragPreview: (items) => (
			<div className="rounded-[3px] border border-fc-accent bg-fc-raised px-2 py-0.5 text-fc-base text-fc-text shadow-lg">
				{items[0]?.["text/plain"]}
				{items.length > 1 && ` +${items.length - 1}`}
			</div>
		),
		onMove(e) {
			const t = e.target;
			if (t.dropPosition === "before") tree.moveBefore(t.key, e.keys);
			else if (t.dropPosition === "after") tree.moveAfter(t.key, e.keys);
			else {
				let i = 0;
				for (const k of e.keys) tree.move(k, t.key, i++);
			}
		},
		shouldAcceptItemDrop: (target) =>
			tree.getItem(target.key)?.value.kind === "frame",
	});

	const toggle = (set: Set<Key>, key: Key) => {
		const next = new Set(set);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	};

	return (
		<ContextMenu
			menu={
				<>
					<MenuItem shortcut="Enter">Rename</MenuItem>
					<MenuItem shortcut="Mod+D">Duplicate</MenuItem>
					<MenuItem shortcut="Delete" destructive>
						Delete
					</MenuItem>
					<MenuSeparator />
					<MenuItem shortcut="Mod+G">Group</MenuItem>
					<MenuItem shortcut="Mod+Shift+G" isDisabled>
						Ungroup
					</MenuItem>
				</>
			}
		>
			<Tree
				aria-label="Layers"
				items={tree.items}
				selectionMode="multiple"
				selectionBehavior="replace"
				selectedKeys={selected}
				onSelectionChange={setSelected}
				defaultExpandedKeys={["header"]}
				dragAndDropHooks={dragAndDropHooks}
				className="max-h-64"
			>
				{function renderItem(item): ReactNode {
					const Icon = I[item.value.kind];
					const isHidden = hidden.has(item.key);
					const isLocked = locked.has(item.key);
					return (
						<TreeItem
							id={item.key}
							textValue={item.value.name}
							label={
								<span className={isHidden ? "text-fc-faint" : undefined}>
									{item.value.name}
								</span>
							}
							icon={<Icon />}
							actions={({ isHovered, isSelected }) => (
								<>
									{(isHovered || isSelected || isLocked) && (
										<ToggleButton
											aria-label="Lock"
											isSelected={isLocked}
											onChange={() => setLocked((s) => toggle(s, item.key))}
											className="size-5 bg-transparent data-selected:bg-transparent pointer-coarse:size-7"
										>
											<I.lock />
										</ToggleButton>
									)}
									{(isHovered || isSelected || isHidden) && (
										<ToggleButton
											aria-label="Hide"
											isSelected={isHidden}
											onChange={() => setHidden((s) => toggle(s, item.key))}
											className="size-5 bg-transparent data-selected:bg-transparent pointer-coarse:size-7"
										>
											<I.eye />
										</ToggleButton>
									)}
								</>
							)}
						>
							{item.children && (
								<Collection items={item.children}>{renderItem}</Collection>
							)}
						</TreeItem>
					);
				}}
			</Tree>
		</ContextMenu>
	);
}

function DesignPanel() {
	const [x, setX] = useState<number | null>(120);
	const [y, setY] = useState<number | null>(null);
	const [w, setW] = useState<number | null>(320.5);
	const [h, setH] = useState<number | null>(48);
	const [r, setR] = useState<number | null>(0);
	const [opacity, setOpacity] = useState<number | null>(100);
	const [fill, setFill] = useState("#2f7cf6");
	const [token, setToken] = useState("{{brand_color}}");
	const [semi, setSemi] = useState("#e5484d80");
	const [blend, setBlend] = useState<Key | null>("normal");
	const [font, setFont] = useState<Key | null>("Inter");
	const [align, setAlign] = useState<Selection>(new Set(["left"]));
	const [radius, setRadius] = useState(8);

	return (
		<>
			<PanelSection
				title="Layer"
				actions={
					<IconButton
						aria-label="More"
						tooltip="Layer options"
						className="size-5"
					>
						<I.more />
					</IconButton>
				}
			>
				<div className="grid grid-cols-2 gap-1.5">
					<NumberField label="X" value={x} onChange={setX} />
					<NumberField label="Y" value={y} onChange={setY} />
					<NumberField label="W" value={w} onChange={setW} min={0} />
					<NumberField label="H" value={h} onChange={setH} min={0} />
					<NumberField
						label={<I.rotate />}
						aria-label="Rotation"
						unit="°"
						value={r}
						onChange={setR}
					/>
					<NumberField
						label="O"
						aria-label="Opacity"
						unit="%"
						min={0}
						max={100}
						value={opacity}
						onChange={setOpacity}
					/>
				</div>
				<Select
					aria-label="Blend mode"
					items={BLEND}
					value={blend}
					onChange={setBlend}
				>
					{(item) => <SelectItem id={item.id}>{item.id}</SelectItem>}
				</Select>
			</PanelSection>
			<PanelSection
				title="Fill"
				actions={
					<IconButton aria-label="Add fill" className="size-5">
						<I.plus />
					</IconButton>
				}
			>
				<div className="flex items-center gap-1">
					<ColorInput
						aria-label="Fill"
						value={fill}
						onChange={setFill}
						swatches={SWATCHES}
						className="flex-1"
					/>
					<IconButton aria-label="Remove fill" className="size-5">
						<I.minus />
					</IconButton>
				</div>
				<ColorInput aria-label="Token fill" value={token} onChange={setToken} />
				<ColorInput
					aria-label="Translucent fill"
					value={semi}
					onChange={setSemi}
				/>
			</PanelSection>
			<PanelSection title="Text">
				<ComboBox
					aria-label="Font family"
					items={FONTS}
					selectedKey={font}
					onSelectionChange={setFont}
					allowsCustomValue
				>
					{(item) => <ComboBoxItem id={item.id}>{item.name}</ComboBoxItem>}
				</ComboBox>
				<div className="flex items-center gap-1.5">
					<ToggleGroup
						aria-label="Text align"
						selectedKeys={align}
						onSelectionChange={setAlign}
					>
						<ToggleGroupItem id="left" aria-label="Left" tooltip="Align left">
							<I.alignLeft />
						</ToggleGroupItem>
						<ToggleGroupItem
							id="center"
							aria-label="Center"
							tooltip="Align center"
						>
							<I.alignCenter />
						</ToggleGroupItem>
						<ToggleGroupItem
							id="right"
							aria-label="Right"
							tooltip="Align right"
						>
							<I.alignRight />
						</ToggleGroupItem>
					</ToggleGroup>
					<NumberField
						label="Size"
						aria-label="Font size"
						value={24}
						onChange={() => {}}
						className="flex-1"
					/>
				</div>
				<TextArea
					aria-label="Content"
					defaultValue={"Hello {{first_name}},\nwelcome aboard."}
					rows={3}
				/>
			</PanelSection>
			<PanelSection title="Corners">
				<Slider
					label="Radius"
					minValue={0}
					maxValue={64}
					value={radius}
					onChange={setRadius}
				/>
				<Checkbox defaultSelected>Clip content</Checkbox>
			</PanelSection>
			<PanelSection title="Effects" defaultExpanded={false}>
				<p className="text-fc-muted">Collapsed by default.</p>
			</PanelSection>
		</>
	);
}

const FIRST = [
	"Ana",
	"Ben",
	"Cy",
	"Dana",
	"Eli",
	"Fay",
	"Gus",
	"Hana",
	"Ivo",
	"Jun",
];
const LAST = [
	"Reyes",
	"Santos",
	"Cruz",
	"Lim",
	"Tan",
	"Garcia",
	"Mendoza",
	"Aquino",
];
const TIERS = ["Free", "Silver", "Gold", "Patron"];
const CITIES = ["Manila", "Cebu", "Davao", "Iloilo", "Baguio", "Makati"];

interface Member {
	id: number;
	name: string;
	tier: string;
	city: string;
	points: number;
	joined: string;
}

function makeMembers(n: number): Member[] {
	let seed = 7;
	const rand = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)] as T;
	return Array.from({ length: n }, (_, i) => ({
		id: i + 1,
		name: `${pick(FIRST)} ${pick(LAST)}`,
		tier: pick(TIERS),
		city: pick(CITIES),
		points: Math.floor(rand() * 50_000),
		joined: new Date(2020, 0, 1 + Math.floor(rand() * 2000))
			.toISOString()
			.slice(0, 10),
	}));
}

const memberColumns: {
	id: keyof Member;
	name: string;
	numeric?: boolean;
	defaultWidth?: number;
}[] = [
	{ id: "id", name: "#", numeric: true, defaultWidth: 64 },
	{ id: "name", name: "Name", defaultWidth: 180 },
	{ id: "tier", name: "Tier", defaultWidth: 90 },
	{ id: "city", name: "City" },
	{ id: "points", name: "Points", numeric: true, defaultWidth: 90 },
	{ id: "joined", name: "Joined", defaultWidth: 100 },
];

function MembersTable() {
	const members = useMemo(() => makeMembers(10_000), []);
	const [sort, setSort] = useState<SortDescriptor>();
	const [selected, setSelected] = useState<Selection>(new Set());
	const rows = useMemo(() => {
		if (!sort) return members;
		const key = sort.column as keyof Member;
		const dir = sort.direction === "descending" ? -1 : 1;
		return [...members].sort((a, b) =>
			a[key] < b[key] ? -dir : a[key] > b[key] ? dir : 0,
		);
	}, [members, sort]);
	const count = selected === "all" ? rows.length : selected.size;
	return (
		<>
			<VirtualDataTable
				aria-label="Members"
				containerClassName="h-80 rounded-[3px] border border-fc-border"
				selectionMode="multiple"
				selectedKeys={selected}
				onSelectionChange={setSelected}
				sortDescriptor={sort}
				onSortChange={(next) =>
					setSort(
						sort?.column === next.column && sort.direction === "descending"
							? undefined
							: next,
					)
				}
			>
				<DataTableHeader columns={memberColumns}>
					{(c) => (
						<DataColumn
							id={c.id}
							isRowHeader={c.id === "name"}
							numeric={c.numeric}
							allowsSorting
							defaultWidth={c.defaultWidth ?? "1fr"}
							minWidth={48}
						>
							{c.name}
						</DataColumn>
					)}
				</DataTableHeader>
				<DataBody items={rows} dependencies={[rows]}>
					{(m) => (
						<DataRow id={m.id} columns={memberColumns}>
							{(c) => (
								<DataCell numeric={c.numeric}>
									{c.id === "points" ? m.points.toLocaleString() : m[c.id]}
								</DataCell>
							)}
						</DataRow>
					)}
				</DataBody>
			</VirtualDataTable>
			<p className="text-fc-faint text-fc-sm tabular-nums">
				{rows.length.toLocaleString()} rows · {count.toLocaleString()} selected
				{sort ? ` · sorted by ${String(sort.column)} ${sort.direction}` : ""}
			</p>
		</>
	);
}

function StaticTable() {
	const rows = useMemo(() => makeMembers(4), []);
	const cols = memberColumns.filter((c) => c.id !== "joined");
	return (
		<DataTableContainer className="rounded-[3px] border border-fc-border">
			<DataTable aria-label="Static members" selectionMode="single">
				<DataTableHeader columns={cols}>
					{(c) => (
						<DataColumn
							id={c.id}
							isRowHeader={c.id === "name"}
							numeric={c.numeric}
							defaultWidth={c.defaultWidth ?? "1fr"}
						>
							{c.name}
						</DataColumn>
					)}
				</DataTableHeader>
				<DataBody items={rows}>
					{(m) => (
						<DataRow id={m.id} columns={cols}>
							{(c) => <DataCell numeric={c.numeric}>{m[c.id]}</DataCell>}
						</DataRow>
					)}
				</DataBody>
			</DataTable>
		</DataTableContainer>
	);
}

function ProgressDemo() {
	const [done, setDone] = useState(64);
	useEffect(() => {
		const t = setInterval(() => setDone((d) => (d >= 120 ? 0 : d + 4)), 400);
		return () => clearInterval(t);
	}, []);
	return (
		<>
			<ProgressBar
				label="Exporting members.zip"
				value={done}
				maxValue={120}
				valueLabel={`${done} / 120`}
			/>
			<ProgressBar label="Preparing fonts…" isIndeterminate />
			<ProgressBar label="Imported" value={100} tone="success" />
			<ProgressBar
				label="Failed"
				value={2}
				maxValue={120}
				valueLabel="2 failed"
				tone="danger"
			/>
			<Row label="compact">
				<ProgressBar aria-label="Export progress" value={40} className="w-32" />
				<ProgressBar aria-label="Loading" isIndeterminate className="w-32" />
			</Row>
		</>
	);
}

export function KitGallery() {
	const [tool, setTool] = useState<Selection>(new Set(["move"]));
	const [dialogOpen, setDialogOpen] = useState(false);
	const [lastAction, setLastAction] = useState<string>("none");
	const [section, setSection] = useState<Key>("edit");
	const [theme, setTheme] = useState(() =>
		document.documentElement.dataset.theme === "dark" ? "dark" : "light",
	);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	return (
		<div className="flex h-dvh flex-col bg-fc-app text-fc-text">
			<header className="relative flex h-8 shrink-0 items-center gap-2 border-fc-border border-b bg-fc-app px-1.5 pointer-coarse:h-10">
				<span className="px-1.5 font-semibold text-fc-base tracking-tight">
					Freshcoat
				</span>
				<MenuBar>
					<MenuBarMenu
						label="File"
						menuProps={{ onAction: (k) => setLastAction(String(k)) }}
					>
						<MenuItem id="new" shortcut="Mod+N">
							New…
						</MenuItem>
						<MenuItem id="open" shortcut="Mod+O">
							Open…
						</MenuItem>
						<SubmenuTrigger>
							<MenuItem id="recent">Open recent</MenuItem>
							<Popover>
								<Menu onAction={(k) => setLastAction(String(k))}>
									<MenuItem id="r1">membership-card.coat</MenuItem>
									<MenuItem id="r2">event-badge.coat</MenuItem>
								</Menu>
							</Popover>
						</SubmenuTrigger>
						<MenuSeparator />
						<MenuItem id="save" shortcut="Mod+S">
							Save
						</MenuItem>
						<MenuItem id="save-as" shortcut="Mod+Shift+S">
							Save as…
						</MenuItem>
						<MenuSeparator />
						<MenuItem id="export" shortcut="Mod+E">
							Export PNG…
						</MenuItem>
					</MenuBarMenu>
					<MenuBarMenu label="Edit">
						<MenuItem id="undo" shortcut="Mod+Z">
							Undo
						</MenuItem>
						<MenuItem id="redo" shortcut="Mod+Shift+Z" isDisabled>
							Redo
						</MenuItem>
						<MenuSeparator />
						<MenuItem id="cut" shortcut="Mod+X">
							Cut
						</MenuItem>
						<MenuItem id="copy" shortcut="Mod+C">
							Copy
						</MenuItem>
						<MenuItem id="paste" shortcut="Mod+V">
							Paste
						</MenuItem>
						<MenuItem id="delete" shortcut="Delete" destructive>
							Delete
						</MenuItem>
					</MenuBarMenu>
					<MenuBarMenu label="Object">
						<MenuItem id="group" shortcut="Mod+G">
							Group
						</MenuItem>
						<MenuItem id="ungroup" shortcut="Mod+Shift+G">
							Ungroup
						</MenuItem>
					</MenuBarMenu>
					<MenuBarMenu label="View">
						<MenuSection
							title="Panels"
							selectionMode="multiple"
							defaultSelectedKeys={["layers", "inspector"]}
						>
							<MenuItem id="layers">Layers</MenuItem>
							<MenuItem id="inspector">Inspector</MenuItem>
						</MenuSection>
						<MenuSection
							title="Theme"
							selectionMode="single"
							disallowEmptySelection
							selectedKeys={[theme]}
							onSelectionChange={(keys) => {
								const next = [...keys][0];
								if (next === "light" || next === "dark") setTheme(next);
							}}
						>
							<MenuItem id="light">Light</MenuItem>
							<MenuItem id="dark">Dark</MenuItem>
						</MenuSection>
						<MenuSeparator />
						<MenuItem id="fit" shortcut="Shift+1">
							Zoom to fit
						</MenuItem>
						<MenuItem id="100" shortcut="Shift+0">
							Actual size
						</MenuItem>
					</MenuBarMenu>
					<MenuBarMenu label="Help">
						<MenuItem id="shortcuts" shortcut="Mod+/">
							Keyboard shortcuts
						</MenuItem>
					</MenuBarMenu>
				</MenuBar>
				<SegmentedControl
					aria-label="Section"
					selectedKey={section}
					onSelectionChange={setSection}
					className="absolute left-1/2 -translate-x-1/2"
				>
					<SegmentedItem id="edit" shortcut="Mod+1">
						Edit
					</SegmentedItem>
					<SegmentedItem id="data" shortcut="Mod+2">
						Data
					</SegmentedItem>
					<SegmentedItem id="export" shortcut="Mod+3">
						Export
					</SegmentedItem>
				</SegmentedControl>
				<span className="ml-auto truncate pr-2 text-fc-muted">
					membership-card.coat <span className="text-fc-warning">●</span>
				</span>
			</header>

			<div className="flex min-h-0 flex-1">
				<Toolbar
					aria-label="Tools"
					orientation="vertical"
					className="w-10 shrink-0 border-fc-border border-r bg-fc-panel py-1.5 pointer-coarse:w-12"
				>
					<ToggleGroup
						aria-label="Tool"
						orientation="vertical"
						selectedKeys={tool}
						onSelectionChange={setTool}
						className="gap-0.5 bg-transparent p-0"
					>
						{(
							[
								["move", "Move", "V"],
								["hand", "Hand", "H"],
								["frame", "Frame", "F"],
								["rect", "Rectangle", "R"],
								["ellipse", "Ellipse", "O"],
								["text", "Text", "T"],
								["image", "Image", "I"],
							] as const
						).map(([id, name, key]) => {
							const Icon = I[id];
							return (
								<ToggleGroupItem
									key={id}
									id={id}
									aria-label={name}
									tooltip={`${name} (${key})`}
									className="size-fc-icon flex-none px-0"
								>
									<Icon />
								</ToggleGroupItem>
							);
						})}
					</ToggleGroup>
					<ToolbarSeparator />
					<IconButton aria-label="Zoom to fit" tooltip="Zoom to fit">
						<I.frame />
					</IconButton>
				</Toolbar>

				<aside className="flex w-60 shrink-0 flex-col overflow-auto border-fc-border border-r bg-fc-panel">
					<PanelSection
						title="Sides"
						actions={
							<IconButton
								aria-label="Add side"
								tooltip="Add side"
								className="size-5"
							>
								<I.plus />
							</IconButton>
						}
						bodyClassName="px-0 pb-1.5 gap-0"
					>
						{["front", "back"].map((s, i) => (
							<div
								key={s}
								className={`flex h-fc-control items-center px-3 ${i === 0 ? "bg-fc-active" : ""}`}
							>
								{s}
								<span className="ml-auto text-fc-faint text-fc-sm tabular-nums">
									1012 × 638
								</span>
							</div>
						))}
					</PanelSection>
					<PanelSection title="Layers" bodyClassName="px-0 pb-1.5">
						<LayersTree />
					</PanelSection>
				</aside>

				<main className="min-w-0 flex-1 overflow-auto bg-fc-pasteboard p-4">
					<div className="mx-auto grid max-w-4xl grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
						<Section title="Buttons">
							<Row label="md">
								<Button>Default</Button>
								<Button variant="primary">Primary</Button>
								<Button variant="ghost">Ghost</Button>
								<Button variant="danger">Delete</Button>
							</Row>
							<Row label="sm">
								<Button size="sm">Default</Button>
								<Button size="sm" variant="primary">
									Primary
								</Button>
								<Button size="sm" isDisabled>
									Disabled
								</Button>
							</Row>
							<Row label="icon">
								<IconButton aria-label="Add" tooltip="Add layer">
									<I.plus />
								</IconButton>
								<IconButton aria-label="Add" variant="default">
									<I.plus />
								</IconButton>
								<IconButton aria-label="Add" variant="primary">
									<I.plus />
								</IconButton>
								<IconButton aria-label="Disabled" isDisabled>
									<I.plus />
								</IconButton>
								<ToggleButton aria-label="Visible" defaultSelected>
									<I.eye />
								</ToggleButton>
								<ToggleButton shape="text" defaultSelected>
									Snap
								</ToggleButton>
							</Row>
						</Section>

						<Section title="Fields">
							<TextField label="Name" defaultValue="membership-card" />
							<TextField
								label="Key"
								labelPosition="side"
								defaultValue="first name"
								isInvalid
								errorMessage="Use letters, digits and _ only."
							/>
							<TextField
								label="Id"
								labelPosition="side"
								defaultValue="tpl_01J9"
								isDisabled
							/>
							<TextField
								label="Search"
								labelPosition="side"
								placeholder="Find a layer…"
							/>
							<div className="grid grid-cols-3 gap-1.5">
								<NumberField label="X" value={12} onChange={() => {}} />
								<NumberField label="Y" value={null} onChange={() => {}} />
								<NumberField
									label="W"
									value={40}
									onChange={() => {}}
									isDisabled
								/>
							</div>
						</Section>

						<Section title="Selection controls">
							<Row label="checkbox">
								<Checkbox defaultSelected>Checked</Checkbox>
								<Checkbox>Off</Checkbox>
								<Checkbox isIndeterminate>Mixed</Checkbox>
							</Row>
							<Row label="switch">
								<Switch defaultSelected>On</Switch>
								<Switch>Off</Switch>
								<Switch isDisabled>Disabled</Switch>
							</Row>
							<Row label="segmented">
								<ToggleGroup defaultSelectedKeys={["fixed"]} aria-label="Width">
									<ToggleGroupItem id="fixed">Fixed</ToggleGroupItem>
									<ToggleGroupItem id="hug">Hug</ToggleGroupItem>
									<ToggleGroupItem id="fill">Fill</ToggleGroupItem>
								</ToggleGroup>
							</Row>
							<Slider
								label="Opacity"
								defaultValue={0.6}
								formatOptions={{ style: "percent" }}
								minValue={0}
								maxValue={1}
								step={0.01}
							/>
							<Select
								label="Weight"
								labelPosition="side"
								defaultValue="400"
								items={[100, 200, 300, 400, 500, 600, 700, 800, 900].map(
									(n) => ({
										id: String(n),
									}),
								)}
							>
								{(item) => <SelectItem id={item.id}>{item.id}</SelectItem>}
							</Select>
							<Select label="Fit" labelPosition="side" placeholder="Mixed">
								<SelectItem id="cover">Cover</SelectItem>
								<SelectItem id="contain">Contain</SelectItem>
								<SelectItem id="fill">Fill</SelectItem>
							</Select>
						</Section>

						<Section title="Overlays">
							<Row label="dialog">
								<DialogTrigger isOpen={dialogOpen} onOpenChange={setDialogOpen}>
									<Button>Open dialog…</Button>
									<Modal>
										<Dialog
											title="Rename side"
											footer={({ close }) => (
												<>
													<Button variant="ghost" onPress={close}>
														Cancel
													</Button>
													<Button
														variant="primary"
														onPress={() => {
															close();
															toast("Side renamed", { tone: "success" });
														}}
													>
														Rename
													</Button>
												</>
											)}
										>
											<TextField label="Name" defaultValue="front" autoFocus />
										</Dialog>
									</Modal>
								</DialogTrigger>
							</Row>
							<Row label="toast">
								<Button
									size="sm"
									onPress={() => toast("Saved to membership-card.coat")}
								>
									Info
								</Button>
								<Button
									size="sm"
									onPress={() =>
										toast("Exported PNG (1012×638)", { tone: "success" })
									}
								>
									Success
								</Button>
								<Button
									size="sm"
									onPress={() =>
										toast("Font “Vend Sans” was guessed", { tone: "warning" })
									}
								>
									Warning
								</Button>
								<Button
									size="sm"
									onPress={() =>
										toast("Cannot rename: id “title” is already used", {
											tone: "danger",
										})
									}
								>
									Danger
								</Button>
							</Row>
							<Row label="tooltip">
								<TooltipTrigger>
									<Button size="sm">Hover me</Button>
									<Tooltip>
										Distribute horizontally{" "}
										<Kbd shortcut="Alt+Shift+H" className="ml-1" />
									</Tooltip>
								</TooltipTrigger>
							</Row>
							<Row label="kbd">
								<Kbd shortcut="Mod+Z" />
								<Kbd shortcut="Mod+Shift+Z" />
								<Kbd shortcut="Shift+1" />
								<Kbd shortcut="Delete" />
							</Row>
							<ContextMenu
								menu={
									<>
										<MenuItem
											onAction={() => setLastAction("paste")}
											shortcut="Mod+V"
										>
											Paste here
										</MenuItem>
										<MenuItem
											onAction={() => setLastAction("select-all")}
											shortcut="Mod+A"
										>
											Select all
										</MenuItem>
									</>
								}
								className="grid h-16 place-items-center rounded-[3px] border border-fc-border-strong border-dashed text-fc-muted"
							>
								Right-click or long-press here
							</ContextMenu>
							<p className="text-fc-faint text-fc-sm">
								Last menu action: {lastAction}
							</p>
						</Section>

						<Section title="Progress">
							<ProgressDemo />
						</Section>

						<Section title="Segmented control">
							<Row label="section">
								<SegmentedControl
									aria-label="Section"
									selectedKey={section}
									onSelectionChange={setSection}
								>
									<SegmentedItem id="edit" shortcut="Mod+1">
										Edit
									</SegmentedItem>
									<SegmentedItem id="data" shortcut="Mod+2">
										Data
									</SegmentedItem>
									<SegmentedItem id="export" shortcut="Mod+3">
										Export
									</SegmentedItem>
								</SegmentedControl>
							</Row>
							<Row label="disabled">
								<SegmentedControl
									aria-label="Scale"
									defaultSelectedKey="1x"
									isDisabled
								>
									<SegmentedItem id="1x">1×</SegmentedItem>
									<SegmentedItem id="2x">2×</SegmentedItem>
								</SegmentedControl>
							</Row>
						</Section>

						<Section title="Data table" className="col-span-full">
							<MembersTable />
							<StaticTable />
						</Section>
					</div>
				</main>

				<aside className="flex w-70 shrink-0 flex-col border-fc-border border-l bg-fc-panel">
					<Tabs defaultSelectedKey="design" className="min-h-0 flex-1">
						<TabList aria-label="Inspector">
							<Tab id="design">Design</Tab>
							<Tab id="content">Content</Tab>
						</TabList>
						<TabPanel id="design">
							<DesignPanel />
						</TabPanel>
						<TabPanel id="content" className="p-3 text-fc-muted">
							Content
						</TabPanel>
					</Tabs>
				</aside>
			</div>

			<footer className="flex h-6 shrink-0 items-center gap-3 border-fc-border border-t bg-fc-app px-3 text-fc-muted text-fc-sm tabular-nums">
				<span>front · 1012 × 638</span>
				<span>1 layer selected</span>
				<span className="ml-auto">render 3.1 ms · p95 5.4 ms · 60 fps</span>
			</footer>
			<ToastRegion />
		</div>
	);
}
