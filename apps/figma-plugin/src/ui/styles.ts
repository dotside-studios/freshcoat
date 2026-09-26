// The few rules inline styles cannot express: hover, focus rings, and the
// indeterminate progress animation. Everything else stays inline beside the
// markup it styles. Colors are Figma's theme variables only, so light and dark
// follow the editor without a branch here.
export const GLOBAL_CSS = `
html, body { height: 100%; }
:root { --fc-gutter: clamp(12px, 4vw - 1px, 20px); }
.fc-tab {
	height: 24px;
	padding: 4px 8px;
	border: none;
	border-radius: 4px;
	background: none;
	font: inherit;
	color: var(--figma-color-text-secondary);
	cursor: pointer;
}
.fc-tab:hover { color: var(--figma-color-text); background: var(--figma-color-bg-secondary); }
.fc-tab[aria-selected="true"] {
	color: var(--figma-color-text);
	background: var(--figma-color-bg-secondary);
	font-weight: var(--font-weight-bold);
}
.fc-row {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-height: 32px;
	padding: 4px 8px;
	border: none;
	border-radius: 4px;
	background: none;
	font: inherit;
	text-align: left;
	color: var(--figma-color-text);
	cursor: pointer;
}
.fc-row:hover { background: var(--figma-color-bg-hover); }
.fc-row:disabled { cursor: default; color: var(--figma-color-text-disabled); background: none; }
.fc-link {
	padding: 0;
	border: none;
	background: none;
	font: inherit;
	color: var(--figma-color-text-brand);
	cursor: pointer;
	text-align: left;
}
.fc-link:hover { text-decoration: underline; }
.fc-step-header {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-height: 32px;
	padding: 4px 0;
	border: none;
	background: none;
	font: inherit;
	text-align: left;
	color: var(--figma-color-text);
	cursor: pointer;
}
.fc-tab:focus-visible, .fc-row:focus-visible, .fc-link:focus-visible,
.fc-step-header:focus-visible, .fc-plain:focus-visible {
	outline: 2px solid var(--figma-color-border-selected);
	outline-offset: -2px;
}
.fc-sr {
	position: absolute; width: 1px; height: 1px; overflow: hidden;
	clip: rect(0 0 0 0); white-space: nowrap;
}
.fc-plain { border: none; background: none; font: inherit; color: inherit; padding: 0; cursor: pointer; }
@keyframes fc-indeterminate {
	from { transform: translateX(-100%); }
	to { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
	.fc-indeterminate { animation: none !important; transform: none !important; width: 100% !important; opacity: 0.5; }
}
`;
