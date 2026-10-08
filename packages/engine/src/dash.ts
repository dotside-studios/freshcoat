export function normalizeDash(
	dash: readonly number[] | undefined,
): number[] | undefined {
	if (!dash || dash.length === 0) return undefined;
	if (!dash.every((d) => Number.isFinite(d) && d >= 0)) return undefined;
	if (!dash.some((d) => d > 0)) return undefined;
	return dash.length % 2 ? [...dash, ...dash] : [...dash];
}
