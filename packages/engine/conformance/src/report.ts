// Prints a conformance run:
//   bun run conformance/src/report.ts [--goldens] [--only <id>[,<id>]]
import { createFixture } from "./canvaskit-fixture";
import { runConformance } from "./run";

function onlyArg(): string[] | undefined {
	const i = process.argv.indexOf("--only");
	return i === -1 ? undefined : process.argv[i + 1]?.split(",");
}

const fixture = await createFixture();
try {
	const report = await runConformance({
		painter: fixture.painter,
		capabilities: { profiles: ["core", "raster"] },
		textEngine: fixture.textEngine,
		fontMetrics: fixture.fontMetrics,
		fonts: fixture.fonts,
		images: fixture.images,
		checkGoldens: process.argv.includes("--goldens"),
		only: onlyArg(),
	});
	for (const r of report.results)
		if (r.status !== "pass")
			console.log(
				`${r.status.toUpperCase()} ${r.id}\n  ${r.notes.join("\n  ")}`,
			);
	const claim = onlyArg()
		? "a narrowed run claims nothing"
		: `claimed: ${report.claimed.join(", ") || "none"}`;
	console.log(
		`\n${report.passed} pass, ${report.failed} fail, ${report.skipped} skip — ${claim}`,
	);
} finally {
	fixture.dispose();
}
