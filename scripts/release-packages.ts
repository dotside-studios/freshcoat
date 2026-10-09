import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

export const root = resolve(import.meta.dir, "..");
// Dependency order also determines publication order.
export const packages = [
	"engine",
	"for-print",
	"coatfile",
	"workspace",
] as const;
export const stagingRoot = join(root, "dist", "npm");
export const artifactRoot = join(root, "dist", "releases");

type Manifest = {
	name: string;
	version: string;
	private?: boolean;
	exports: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
	[key: string]: unknown;
};

export function manifest(directory: string): Manifest {
	return JSON.parse(
		readFileSync(join(root, directory, "package.json"), "utf8"),
	);
}

export function releaseVersion(tag?: string): string {
	const versions = packages.map((name) => manifest(`packages/${name}`).version);
	versions.push(manifest("apps/figma-plugin").version);
	const version = versions[0]!;
	if (
		!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
		version === "0.0.0"
	) {
		throw new Error(`Invalid release version: ${version}`);
	}
	if (versions.some((value) => value !== version))
		throw new Error("Release versions must match");
	if (tag && tag !== `v${version}`)
		throw new Error(`Tag ${tag} does not match v${version}`);
	return version;
}

export function run(command: string[], cwd = root): string {
	const result = Bun.spawnSync(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`${command.join(" ")} failed:\n${result.stdout.toString()}${result.stderr.toString()}`,
		);
	}
	return result.stdout.toString();
}

// Tests and their fixtures sit next to the sources they cover, so compile only
// what the published entry points reach.
export function entryPoints(exports: Record<string, string>): string[] {
	return Object.values(exports).filter((path) => path.endsWith(".ts"));
}

// TypeScript's bundler resolution accepts extensionless imports; Node ESM
// needs extensions in both emitted JS and declarations. Rewrite only module
// specifiers, never arbitrary strings or the checked-in source.
export function rewriteModuleSpecifiers(
	text: string,
	fileName: string,
): string {
	const file = ts.createSourceFile(
		fileName,
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const edits: { start: number; end: number; value: string }[] = [];
	function visit(node: ts.Node): void {
		const specifier =
			ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
				? node.moduleSpecifier
				: ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
					? node.argument.literal
					: ts.isCallExpression(node) &&
							node.expression.kind === ts.SyntaxKind.ImportKeyword
						? node.arguments[0]
						: undefined;
		if (
			specifier &&
			ts.isStringLiteral(specifier) &&
			/^\.{1,2}\//.test(specifier.text)
		) {
			const value = specifier.text;
			if (!/\.[a-z]+$/i.test(value)) {
				edits.push({
					start: specifier.getStart(file) + 1,
					end: specifier.getEnd() - 1,
					value: `${value}.js`,
				});
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
	}
	return text;
}

export function publishedManifest(
	source: Manifest,
	versions: Map<string, string>,
): Record<string, unknown> {
	const {
		private: _private,
		scripts: _scripts,
		devDependencies: _devDependencies,
		exports,
		...metadata
	} = source;
	const dependencies = Object.fromEntries(
		Object.entries(source.dependencies ?? {}).map(([name, version]) => {
			if (!version.startsWith("workspace:")) return [name, version];
			const released = versions.get(name);
			if (!released)
				throw new Error(`Unreleased workspace dependency: ${name}`);
			return [name, released];
		}),
	);
	return {
		...metadata,
		private: false,
		main: "./src/index.js",
		types: "./src/index.d.ts",
		files: ["src", "fixtures", "schema", "LICENSE", "NOTICE", "README.md"],
		publishConfig: { access: "public" },
		exports: Object.fromEntries(
			Object.entries(exports).map(([key, path]) => [
				key,
				path.endsWith(".ts")
					? {
							types: path.replace(/\.ts$/, ".d.ts"),
							import: path.replace(/\.ts$/, ".js"),
							default: path.replace(/\.ts$/, ".js"),
						}
					: path,
			]),
		),
		...(Object.keys(dependencies).length ? { dependencies } : {}),
	};
}

export async function buildPackages(tag?: string): Promise<void> {
	releaseVersion(tag);
	const versions = new Map(
		packages.map((directory) => {
			const data = manifest(`packages/${directory}`);
			return [data.name, data.version];
		}),
	);
	// This directory contains only generated release packages.
	rmSync(stagingRoot, { recursive: true, force: true });
	mkdirSync(stagingRoot, { recursive: true });
	const paths: Record<string, string[]> = {};
	for (const directory of packages) {
		const packageRoot = join(root, "packages", directory);
		const output = join(stagingRoot, directory);
		const data = manifest(`packages/${directory}`);
		const config = ts.readConfigFile(
			join(root, "tsconfig.base.json"),
			ts.sys.readFile,
		);
		if (config.error)
			throw new Error(
				ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
			);
		const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
		const files = entryPoints(data.exports).map((path) =>
			join(packageRoot, path),
		);
		const program = ts.createProgram(files, {
			...parsed.options,
			noEmit: false,
			allowImportingTsExtensions: false,
			declaration: true,
			resolveJsonModule: true,
			...(data.devDependencies?.["@types/node"]
				? {
						types: ["node"],
						typeRoots: [join(packageRoot, "node_modules", "@types")],
					}
				: { types: [] }),
			rootDir: packageRoot,
			outDir: output,
			baseUrl: root,
			paths: { ...paths },
		});
		const diagnostics = ts.getPreEmitDiagnostics(program);
		if (diagnostics.length)
			throw new Error(
				ts.formatDiagnosticsWithColorAndContext(diagnostics, {
					getCurrentDirectory: () => root,
					getCanonicalFileName: (name) => name,
					getNewLine: () => "\n",
				}),
			);
		const emitted = program.emit(undefined, (fileName, text) => {
			mkdirSync(dirname(fileName), { recursive: true });
			writeFileSync(
				fileName,
				/\.(js|ts)$/.test(fileName)
					? rewriteModuleSpecifiers(text, fileName)
					: text,
			);
		});
		if (emitted.emitSkipped || emitted.diagnostics.length)
			throw new Error(`Declaration emit failed: ${data.name}`);
		for (const asset of ["LICENSE", "NOTICE", "README.md", "schema"]) {
			if (existsSync(join(packageRoot, asset)))
				cpSync(join(packageRoot, asset), join(output, asset), {
					recursive: true,
				});
		}
		const published = publishedManifest(data, versions);
		writeFileSync(
			join(output, "package.json"),
			`${JSON.stringify(published, null, 2)}\n`,
		);
		paths[data.name] = [join(output, "src", "index.d.ts")];
		for (const [subpath, path] of Object.entries(data.exports)) {
			if (subpath !== "." && path.endsWith(".ts"))
				paths[`${data.name}/${subpath.slice(2)}`] = [
					join(output, path.replace(/\.ts$/, ".d.ts")),
				];
		}
		// Later packages read these declarations, whose imports resolve through
		// the package's own isolated dependencies.
		symlinkSync(join(packageRoot, "node_modules"), join(output, "node_modules"));
		console.log(`Built ${data.name}@${data.version}`);
	}
	for (const directory of packages)
		rmSync(join(stagingRoot, directory, "node_modules"));
}

export function packPackages(): string[] {
	rmSync(artifactRoot, { recursive: true, force: true });
	mkdirSync(artifactRoot, { recursive: true });
	const artifacts: {
		name: string;
		version: string;
		filename: string;
		integrity: string;
	}[] = [];
	const tarballs = packages.map((directory) => {
		const result = JSON.parse(
			run(
				[
					"npm",
					"pack",
					"--json",
					"--ignore-scripts",
					"--pack-destination",
					artifactRoot,
				],
				join(stagingRoot, directory),
			),
		);
		const filename = result[0].filename as string;
		const { name, version, integrity } = result[0];
		artifacts.push({ name, version, filename, integrity });
		console.log(`Packed ${filename}`);
		return join(artifactRoot, filename);
	});
	writeFileSync(
		join(artifactRoot, "packages.json"),
		`${JSON.stringify(artifacts, null, 2)}\n`,
	);
	return tarballs;
}

if (import.meta.main) {
	await buildPackages(process.env.RELEASE_TAG);
	packPackages();
}
