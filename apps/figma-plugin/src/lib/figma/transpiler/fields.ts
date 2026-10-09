export function titleCase(id: string): string {
	return id
		.split("_")
		.filter((w) => w.length > 0)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}
