import {
	loadSettingsAsync,
	saveSettingsAsync,
} from "@create-figma-plugin/utilities";
import {
	DEFAULT_SETTINGS,
	migrateSettings,
	type PluginSettings,
	type SettingsMessage,
} from "~/shared/protocol";

const SETTINGS_KEY = "freshcoat_plugin_settings";

// Panel state persisted in clientStorage. Held in memory so a save can merge a
// partial patch without a read round-trip; the UI only ever sends the keys it
// changed.
let settings: PluginSettings = { ...DEFAULT_SETTINGS };

// clientStorage is not guaranteed — a read that throws must cost the author
// their remembered layout, not the whole panel.
export async function loadSettings(): Promise<PluginSettings> {
	try {
		settings = migrateSettings(
			await loadSettingsAsync(DEFAULT_SETTINGS, SETTINGS_KEY),
		);
	} catch {
		settings = { ...DEFAULT_SETTINGS };
	}
	return settings;
}

export function postSettings(): void {
	const msg: SettingsMessage = { type: "settings", settings };
	figma.ui.postMessage(msg);
}

export async function handleSaveSettings(
	patch: Partial<PluginSettings>,
): Promise<void> {
	settings = { ...settings, ...patch };
	try {
		await saveSettingsAsync(settings, SETTINGS_KEY);
	} catch {
		// Preference didn't stick; the in-memory copy still drives this session.
	}
}
