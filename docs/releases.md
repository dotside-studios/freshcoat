# Releases

Freshcoat releases use one version for the core SDK and the Figma plugin.
The first prepared version is `0.1.0`, tagged `v0.1.0`.

| Deliverable | Distribution |
|---|---|
| `freshcoat` | npm: the rendering engine |
| `@freshcoat/for-print` | npm: print analysis and correction planning |
| `@freshcoat/coatfile` | npm: template files, validation, compilation and rendering helpers |
| Freshcoat for Figma | GitHub release ZIP; Figma Community publication is manual |

Studio is deployed separately. The UI and workspace packages remain internal.

## Prepare and check a release

Update the version in these four manifests together:

- `packages/engine/package.json`
- `packages/for-print/package.json`
- `packages/coatfile/package.json`
- `apps/figma-plugin/package.json`

Then regenerate the lockfile and schema, and build the release artifacts:

```sh
bun install
bun run --cwd packages/coatfile schema
bun run test
bun run typecheck
bun run release:pack
bun run release:check
bun run --cwd apps/figma-plugin build
bun run release:figma
```

`release:pack` builds compiled ESM and declarations into `dist/npm/`, resolves
workspace dependencies to exact release versions, and produces npm tarballs
in `dist/releases/`. It also writes `packages.json` with publication order
and SHA-512 integrity values. It clears earlier release artifacts before
packing, so build the Figma ZIP afterward.

The checked-in workspace manifests stay private and export source for local
development. Only the generated package manifests are public and export
JavaScript and declarations. Publish the generated tarballs, never the source
package directories.

`release:check` installs the tarballs in an isolated npm project. It checks every
public import and declaration, renders a scene and text in Node, and exercises
print analysis, template archives, fixtures and schema access. It also checks
that the tarballs include license files and exclude TypeScript source.

The schema URL includes the npm package version, independently of the template
format version. Regenerate it whenever the package version changes.

## npm account setup

Before publishing, confirm ownership or availability of `freshcoat` and access
to the `@freshcoat` npm scope. Package names are not reserved by this repository.

For packages that do not exist on npm yet, make the first publication using an
authenticated maintainer account. Build and verify the tarballs first, then
publish them in dependency order:

```sh
npm login
npm publish dist/releases/freshcoat-0.1.0.tgz --access public
npm publish dist/releases/freshcoat-for-print-0.1.0.tgz --access public
npm publish dist/releases/freshcoat-coatfile-0.1.0.tgz --access public
```

Those commands publish publicly. The first manual publication does not receive
CI provenance; subsequent workflow publications do.

Configure a GitHub Actions trusted publisher in each package's npm settings:

| Setting | Value |
|---|---|
| Organization | `dotside-studios` |
| Repository | `freshcoat` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | Direct publishing with `npm publish` |

Create the `npm` environment in GitHub repository settings. If you enable
required reviewers, release publishing waits for their approval. Allow release
tags through any environment deployment restrictions.

The workflow uses Node 24, npm's OIDC authentication and `id-token: write`.
No `NPM_TOKEN` secret is needed. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for setup
and supported CLI versions.

## Run the release workflow

Commit the version and schema changes, push the commit and tag, and publish a
GitHub release for that tag. Publishing the GitHub release starts
[`release.yml`](../.github/workflows/release.yml).

The workflow runs the existing CI checks, including browser smoke tests, plus
package and plugin artifact checks. Once validation passes, two jobs run:

- npm publishes the tested tarballs in engine, for-print, coatfile order.
- GitHub attaches those tarballs and the plugin ZIP to the release.

The tag must match the package versions. Stable versions use npm's `latest`
dist-tag; prerelease versions such as `0.2.0-beta.1` use `next`. Set the GitHub
release's prerelease flag for prerelease versions too.

You can also run **Actions → Release → Run workflow** with an existing tag.
The default is a dry run: CI builds and validates artifacts, and npm checks its
publish payload without publishing. Set `dry_run` to false only when publishing
is intended and a GitHub release already exists for the tag.

For a local npm dry run, after packing:

```sh
RELEASE_TAG=v0.1.0 node scripts/publish-packages.mjs --dry-run
```

Reruns skip an existing npm version only when its registry integrity matches
the tested tarball. A different tarball for the same version fails; bump the
version instead. A partial publication can be retried with the original
artifacts using GitHub's **Re-run failed jobs** action. Rerunning all jobs
rebuilds artifacts and requires their bytes to match any published versions.

## Figma plugin releases

The ZIP contains `manifest.json`, `build/`, the plugin README, and license and
third-party notices. Download it from a GitHub release, extract it, and import
its manifest through Figma desktop's development plugin menu. No build is
needed to use that bundle.

Community publishing remains a separate manual step. Obtain the permanent
plugin ID from Figma, put it in `apps/figma-plugin/package.json` under
`figma-plugin.id`, and rebuild before Community publication. Keep that ID
stable across updates: changing it makes plugin data saved under the old
identity inaccessible. The current development ID is not a Community ID.

Check the plugin in Figma and submit it through Figma's publishing flow. CI
does not submit or update a Community listing. See
[Figma's plugin documentation](https://developers.figma.com/docs/plugins/).
