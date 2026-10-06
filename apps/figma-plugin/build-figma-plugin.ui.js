import { dirname, resolve } from "node:path";
import main from "./build-figma-plugin.main.js";

// zod's classic entry exports every locale as `z.locales`, which keeps all of
// them in the bundle. Only English, zod's default, is used, so the UI gets a
// locales module with English alone. Error messages are unchanged.
const zodEnglishOnly = {
	name: "zod-english-only",
	setup(build) {
		build.onResolve({ filter: /\/locales\/index\.js$/ }, (args) =>
			/[\\/]zod[\\/]/.test(args.importer)
				? {
						path: resolve(args.resolveDir, args.path),
						namespace: "zod-locales",
					}
				: undefined,
		);
		build.onLoad({ filter: /.*/, namespace: "zod-locales" }, (args) => ({
			contents: 'export { default as en } from "./en.js";',
			resolveDir: dirname(args.path),
		}));
	},
};

export default function (buildOptions) {
	const options = main(buildOptions);
	return {
		...options,
		plugins: [...(options.plugins ?? []), zodEnglishOnly],
	};
}
