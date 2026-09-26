import { render } from "@create-figma-plugin/ui";
import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ProductRegistryEntry } from "~/lib/figma/transpiler";
import { listProductSpecs, loadProductRegistry } from "~/main/product";
import type { FieldOverviewItem, PluginSettings } from "~/shared/protocol";
import { DEFAULT_SETTINGS } from "~/shared/protocol";
import { ExportTab } from "~/ui/export-tab";
import { fieldsForTarget, useExportTarget } from "~/ui/export-target";
import { FieldsTab, useFieldDetector } from "~/ui/fields-tab";
import { LayerTab } from "~/ui/layer-tab";
import { useMainMessage } from "~/ui/messages";
import { postToMain } from "~/ui/post";
import { ResizeGrip } from "~/ui/resize-grip";
import { SettingsTab } from "~/ui/settings-tab";
import { StatusLine, StatusProvider, useStatusState } from "~/ui/status";
import { GLOBAL_CSS } from "~/ui/styles";
import { isTabId, type TabId, Tablist, TabPanel } from "~/ui/tabs";

function App(): JSX.Element {
	const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
	// Settings arrive one message after mount, so the first paint uses the
	// defaults. The panels are mounted at once, so they hear main's startup
	// messages, but stay out of sight until settings land: flashing Layer and
	// then jumping to the stored tab is worse than a beat of empty chrome.
	const [settingsLoaded, setSettingsLoaded] = useState(false);
	const [fields, setFields] = useState<FieldOverviewItem[]>([]);
	const [focusAddress, setFocusAddress] = useState(0);
	const { status, announce } = useStatusState();

	// What this panel has changed. Main sends its stored settings at startup
	// and again in answer to request-settings, so a copy can land after the
	// panel changed something (the Export tab seeds a product as soon as
	// settings land); the panel's own changes win over it.
	const patchedRef = useRef<Partial<PluginSettings>>({});
	useMainMessage((msg) => {
		if (msg.type === "settings") {
			setSettings({
				...DEFAULT_SETTINGS,
				...msg.settings,
				...patchedRef.current,
			});
			setSettingsLoaded(true);
		} else if (msg.type === "fields-overview") {
			setFields(msg.fields);
		}
	});

	useEffect(() => {
		// Ask rather than wait for the startup push, which is posted before this
		// listener exists.
		postToMain({ type: "request-settings" });
		postToMain({ type: "request-fields" });
	}, []);

	// Every persisted choice takes the same path: local state so the panel
	// answers now, and the same patch to main to write.
	const patchSettings = useCallback((patch: Partial<PluginSettings>): void => {
		patchedRef.current = { ...patchedRef.current, ...patch };
		setSettings((prev) => ({ ...prev, ...patch }));
		postToMain({ type: "save-settings", settings: patch });
	}, []);

	const tab: TabId = isTabId(settings.tab) ? settings.tab : "layer";
	const showTab = useCallback(
		(next: TabId) => patchSettings({ tab: next }),
		[patchSettings],
	);

	// Seeded from the shipped fallback. The live catalog is not fetched on
	// mount: it lives on Davi's CDN and only matters to a product export, so a
	// session that stays on a custom canvas makes no network request at all.
	const [products, setProducts] = useState<ProductRegistryEntry[]>(() =>
		listProductSpecs(),
	);
	const catalogRequestedRef = useRef(false);
	const requestProducts = useCallback((): void => {
		if (catalogRequestedRef.current) return;
		catalogRequestedRef.current = true;
		// Only the UI iframe can make network requests, so fetch here and
		// forward the entries to main, which keeps its own copy. A failed load
		// leaves the shipped fallback in place.
		void loadProductRegistry((url) => fetch(url)).then((entries) => {
			if (!entries) return;
			setProducts(listProductSpecs());
			postToMain({ type: "products-loaded", products: entries });
		});
	}, []);

	const target = useExportTarget({
		daviMode: settings.daviMode,
		products,
		productSku: settings.productSku,
	});

	return (
		<StatusProvider value={announce}>
			<style>{GLOBAL_CSS}</style>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					height: "100vh",
				}}
			>
				<Tablist value={tab} onChange={showTab} />
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						flex: 1,
						minHeight: 0,
						overflowY: "auto",
						visibility: settingsLoaded ? "visible" : "hidden",
					}}
				>
					<Panels
						tab={tab}
						settings={settings}
						fields={fields}
						target={target}
						products={products}
						requestProducts={requestProducts}
						patchSettings={patchSettings}
						showTab={showTab}
						focusAddress={focusAddress}
						settingsLoaded={settingsLoaded}
						onOpenSettings={() => {
							showTab("settings");
							setFocusAddress((n) => n + 1);
						}}
					/>
				</div>
				<StatusLine status={status} />
			</div>
			<ResizeGrip />
		</StatusProvider>
	);
}

// The panels, all kept mounted so none misses a message while hidden.
function Panels(props: {
	tab: TabId;
	settings: PluginSettings;
	fields: FieldOverviewItem[];
	target: ReturnType<typeof useExportTarget>;
	products: ProductRegistryEntry[];
	requestProducts: () => void;
	patchSettings: (patch: Partial<PluginSettings>) => void;
	showTab: (tab: TabId) => void;
	focusAddress: number;
	settingsLoaded: boolean;
	onOpenSettings: () => void;
}): JSX.Element {
	const { tab, settings, target } = props;
	const detector = useFieldDetector(target);
	return (
		<>
			<TabPanel id="layer" active={tab === "layer"}>
				<LayerTab />
			</TabPanel>
			<TabPanel id="fields" active={tab === "fields"}>
				<FieldsTab
					fields={props.fields}
					detector={detector}
					target={target}
					onPickFrame={() => props.showTab("export")}
				/>
			</TabPanel>
			<TabPanel id="export" active={tab === "export"}>
				<ExportTab
					target={target}
					products={props.products}
					onNeedProducts={props.requestProducts}
					productSku={settings.productSku}
					settingsLoaded={props.settingsLoaded}
					onPersist={props.patchSettings}
					fields={fieldsForTarget(props.fields, target)}
					detector={detector}
					freshcoatUrl={settings.freshcoatUrl ?? ""}
					showDiagnostics={settings.showDiagnostics ?? false}
					onOpenSettings={props.onOpenSettings}
				/>
			</TabPanel>
			<TabPanel id="settings" active={tab === "settings"}>
				<SettingsTab
					freshcoatUrl={settings.freshcoatUrl ?? ""}
					showDiagnostics={settings.showDiagnostics ?? false}
					onPersist={props.patchSettings}
					focusAddress={props.focusAddress}
				/>
			</TabPanel>
		</>
	);
}

export default render(App);
