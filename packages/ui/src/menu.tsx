import {
	createContext,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Button,
	Collection,
	Header,
	MenuTrigger,
	Menu as RACMenu,
	MenuItem as RACMenuItem,
	type MenuItemProps as RACMenuItemProps,
	type MenuProps as RACMenuProps,
	MenuSection as RACMenuSection,
	type MenuSectionProps as RACMenuSectionProps,
	Separator,
	type SeparatorProps,
	Toolbar,
} from "react-aria-components";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronRightIcon } from "./icons";
import { formatShortcut } from "./kbd";
import { cn } from "./lib/cn";
import { composeTw } from "./lib/compose";
import { listItem } from "./lib/styles";
import { Popover } from "./popover";

export { SubmenuTrigger } from "react-aria-components";

export interface MenuProps<T extends object> extends RACMenuProps<T> {
	ref?: Ref<HTMLDivElement>;
}

export function Menu<T extends object>({ className, ...props }: MenuProps<T>) {
	return (
		<RACMenu
			{...props}
			className={composeTw(
				className,
				"max-h-[inherit] min-w-44 overflow-auto p-1 outline-none",
			)}
		/>
	);
}

export interface MenuItemProps<T extends object>
	extends Omit<RACMenuItemProps<T>, "children"> {
	children: ReactNode;
	/** e.g. "Mod+Shift+Z"; rendered as ⌘⇧Z on a Mac and Ctrl+Shift+Z elsewhere. */
	shortcut?: string;
	icon?: ReactNode;
	/** Red text, for Delete and the like. */
	destructive?: boolean;
}

export function MenuItem<T extends object>({
	children,
	shortcut,
	icon,
	destructive,
	className,
	textValue,
	...props
}: MenuItemProps<T>) {
	return (
		<RACMenuItem
			{...props}
			textValue={
				textValue ?? (typeof children === "string" ? children : undefined)
			}
			className={composeTw(
				className,
				listItem,
				"data-open:not-data-focused:bg-fc-hover",
				destructive && "text-fc-danger data-focused:bg-fc-danger",
			)}
		>
			{({ hasSubmenu, isSelected, selectionMode }) => (
				<>
					<span className="flex w-3.5 shrink-0 justify-center [&_svg]:size-3.5">
						{selectionMode !== "none" && isSelected ? <CheckIcon /> : icon}
					</span>
					<span className="min-w-0 flex-1 truncate">{children}</span>
					{shortcut && (
						<kbd className="ml-4 shrink-0 font-fc text-fc-faint text-fc-sm tracking-wide group-data-focused/item:text-white/75">
							{formatShortcut(shortcut)}
						</kbd>
					)}
					{hasSubmenu && (
						<ChevronRightIcon className="-mr-1 ml-2 size-3.5 shrink-0 text-fc-muted group-data-focused/item:text-white" />
					)}
				</>
			)}
		</RACMenuItem>
	);
}

export interface MenuSectionProps<T extends object>
	extends RACMenuSectionProps<T> {
	title?: ReactNode;
}

export function MenuSection<T extends object>({
	title,
	children,
	items,
	className,
	...props
}: MenuSectionProps<T>) {
	return (
		<RACMenuSection {...props} className={cn("flex flex-col", className)}>
			{title != null && (
				<Header className="px-2 pt-1.5 pb-0.5 pl-7 font-semibold text-[10px] text-fc-faint uppercase tracking-wider">
					{title}
				</Header>
			)}
			{typeof children === "function" ? (
				<Collection items={items}>{children}</Collection>
			) : (
				children
			)}
		</RACMenuSection>
	);
}

export function MenuSeparator({ className, ...props }: SeparatorProps) {
	return (
		<Separator
			{...props}
			className={cn("mx-1.5 my-1 h-px border-none bg-fc-border", className)}
		/>
	);
}

// ---------------------------------------------------------------- MenuBar

interface MenuBarContextValue {
	openId: string | null;
	focusFirst: boolean;
	open: (id: string | null, focusFirst?: boolean) => void;
	register: (id: string, trigger: HTMLElement) => () => void;
	neighbour: (id: string, dir: 1 | -1) => string | null;
}

const MenuBarContext = createContext<MenuBarContextValue | null>(null);

export interface MenuBarProps {
	children: ReactNode;
	className?: string;
	"aria-label"?: string;
}

/**
 * A row of drop-down menus. While one is open, pointing at another title
 * switches to it, and Left/Right move between menus.
 */
export function MenuBar({
	children,
	className,
	"aria-label": ariaLabel = "Main menu",
}: MenuBarProps) {
	const [openId, setOpenId] = useState<string | null>(null);
	const [focusFirst, setFocusFirst] = useState(false);
	const triggers = useRef(new Map<string, HTMLElement>());

	const open = useCallback((id: string | null, first = false) => {
		setFocusFirst(first);
		setOpenId(id);
	}, []);
	const register = useCallback((id: string, trigger: HTMLElement) => {
		triggers.current.set(id, trigger);
		return () => {
			triggers.current.delete(id);
		};
	}, []);
	const neighbour = useCallback((id: string, dir: 1 | -1) => {
		const ids = [...triggers.current.entries()]
			.sort(([, a], [, b]) =>
				a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
					? -1
					: 1,
			)
			.map(([k]) => k);
		const i = ids.indexOf(id);
		if (i < 0) return null;
		return ids[(i + dir + ids.length) % ids.length] ?? null;
	}, []);

	// The open menu's underlay covers the titles, so hit-test them by position.
	useEffect(() => {
		if (openId === null) return;
		const onMove = (e: PointerEvent) => {
			if (e.pointerType !== "mouse") return;
			for (const [id, el] of triggers.current) {
				if (id === openId) continue;
				const r = el.getBoundingClientRect();
				if (
					e.clientX >= r.left &&
					e.clientX < r.right &&
					e.clientY >= r.top &&
					e.clientY < r.bottom
				) {
					open(id);
					return;
				}
			}
		};
		window.addEventListener("pointermove", onMove, true);
		return () => window.removeEventListener("pointermove", onMove, true);
	}, [openId, open]);

	const value = useMemo(
		() => ({ openId, focusFirst, open, register, neighbour }),
		[openId, focusFirst, open, register, neighbour],
	);

	return (
		<MenuBarContext.Provider value={value}>
			<Toolbar
				aria-label={ariaLabel}
				className={cn("flex h-full items-stretch", className)}
			>
				{children}
			</Toolbar>
		</MenuBarContext.Provider>
	);
}

export interface MenuBarMenuProps {
	label: ReactNode;
	children: ReactNode;
	className?: string;
	/** Forwarded to the Menu, e.g. for `onAction` with item ids. */
	menuProps?: Omit<MenuProps<object>, "children">;
}

export function MenuBarMenu({
	label,
	children,
	className,
	menuProps,
}: MenuBarMenuProps) {
	const bar = useContext(MenuBarContext);
	const id = useId();
	const menuRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const viaKeyboard = useRef(false);
	const register = bar?.register;
	useEffect(() => {
		if (register && triggerRef.current) return register(id, triggerRef.current);
	}, [register, id]);

	const isOpen = bar ? bar.openId === id : undefined;

	function onKeyDownCapture(e: KeyboardEvent<HTMLDivElement>) {
		if (!bar || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
		const target = e.target as HTMLElement;
		// Leave submenu navigation to RAC: only the root menu switches menus.
		if (!menuRef.current?.contains(target)) return;
		if (e.key === "ArrowRight" && target.getAttribute("aria-haspopup")) return;
		e.preventDefault();
		e.stopPropagation();
		bar.open(bar.neighbour(id, e.key === "ArrowRight" ? 1 : -1), true);
	}

	return (
		<MenuTrigger
			isOpen={isOpen}
			onOpenChange={
				bar
					? (open) => {
							if (open) bar.open(id, viaKeyboard.current);
							else if (bar.openId === id) bar.open(null);
						}
					: undefined
			}
		>
			{/* Capture phase, so the modality is known before the trigger opens the menu. */}
			<span
				className="contents"
				onKeyDownCapture={() => {
					viaKeyboard.current = true;
				}}
				onPointerDownCapture={() => {
					viaKeyboard.current = false;
				}}
			>
				<Button
					ref={triggerRef}
					className={cn(
						"flex cursor-default select-none items-center rounded-[3px] px-2 text-fc-base text-fc-text outline-none data-hovered:bg-fc-hover data-pressed:bg-fc-active data-focus-visible:-outline-offset-2 aria-expanded:bg-fc-active",
						"my-0.5 pointer-coarse:px-3",
						className,
					)}
				>
					{label}
				</Button>
			</span>
			<Popover placement="bottom start" offset={2}>
				<div onKeyDownCapture={onKeyDownCapture} className="contents">
					<Menu
						{...menuProps}
						ref={menuRef}
						autoFocus={bar?.focusFirst ? "first" : true}
					>
						{children}
					</Menu>
				</div>
			</Popover>
		</MenuTrigger>
	);
}

// ------------------------------------------------------------- ContextMenu

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 8;

export interface ContextMenuOpenEvent {
	clientX: number;
	clientY: number;
	target: EventTarget;
}

export interface ContextMenuProps {
	children: ReactNode;
	/** The menu's items (MenuItem, MenuSection, MenuSeparator, SubmenuTrigger). */
	menu: ReactNode;
	/** Called before the menu opens, e.g. to select the row under the pointer. */
	onOpen?: (event: ContextMenuOpenEvent) => void;
	onOpenChange?: (isOpen: boolean) => void;
	menuProps?: Omit<MenuProps<object>, "children">;
	isDisabled?: boolean;
	className?: string;
}

/**
 * Opens `menu` at the pointer on right-click, on the keyboard context-menu
 * key, or after a 500 ms touch or pen long-press.
 */
export function ContextMenu({
	children,
	menu,
	onOpen,
	onOpenChange,
	menuProps,
	isDisabled,
	className,
}: ContextMenuProps) {
	const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
	const anchorRef = useRef<HTMLDivElement>(null);
	const press = useRef<{
		id: number;
		x: number;
		y: number;
		timer: ReturnType<typeof setTimeout>;
	} | null>(null);

	const openAt = useCallback(
		(x: number, y: number, target: EventTarget) => {
			onOpen?.({ clientX: x, clientY: y, target });
			setPoint({ x, y });
			onOpenChange?.(true);
		},
		[onOpen, onOpenChange],
	);
	const close = useCallback(() => {
		setPoint(null);
		onOpenChange?.(false);
	}, [onOpenChange]);

	const cancelPress = useCallback(() => {
		if (press.current) clearTimeout(press.current.timer);
		press.current = null;
	}, []);
	useEffect(() => cancelPress, [cancelPress]);

	return (
		<>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer shortcut; the menu itself is keyboard accessible via the context-menu key */}
			<div
				className={className}
				onContextMenu={(e) => {
					if (isDisabled) return;
					e.preventDefault();
					cancelPress();
					let { clientX: x, clientY: y } = e;
					// Keyboard-invoked context menus report 0,0: anchor to the target.
					if (x === 0 && y === 0 && e.target instanceof Element) {
						const r = e.target.getBoundingClientRect();
						x = r.left + 8;
						y = r.bottom;
					}
					openAt(x, y, e.target);
				}}
				onPointerDown={(e) => {
					if (isDisabled || e.pointerType === "mouse") return;
					cancelPress();
					const target = e.target;
					const { clientX: x, clientY: y, pointerId: id } = e;
					press.current = {
						id,
						x,
						y,
						timer: setTimeout(() => {
							press.current = null;
							openAt(x, y, target);
						}, LONG_PRESS_MS),
					};
				}}
				onPointerMove={(e) => {
					const p = press.current;
					if (
						p &&
						p.id === e.pointerId &&
						Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP
					)
						cancelPress();
				}}
				onPointerUp={cancelPress}
				onPointerCancel={cancelPress}
			>
				{children}
			</div>
			{point &&
				createPortal(
					<div
						ref={anchorRef}
						aria-hidden="true"
						style={{
							position: "fixed",
							left: point.x,
							top: point.y,
							width: 0,
							height: 0,
						}}
					/>,
					document.body,
				)}
			{point && (
				<Popover
					triggerRef={anchorRef}
					isOpen
					onOpenChange={(open) => !open && close()}
					placement="bottom start"
					offset={2}
					shouldFlip
				>
					<Menu
						aria-label="Context menu"
						{...menuProps}
						autoFocus="first"
						onClose={close}
					>
						{menu}
					</Menu>
				</Popover>
			)}
		</>
	);
}
