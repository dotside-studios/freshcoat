# Security policy

## Reporting a vulnerability

Please report a vulnerability privately. Do not open a public issue, a pull
request or a discussion about it.

Email [security@dotsidestudios.com](mailto:security@dotsidestudios.com) with:

- the affected package or application and what someone could do with the problem;
- steps to reproduce it, a minimal example or a file that demonstrates it;
- the package version or repository commit, plus the runtime you tested.

We will acknowledge your report, keep you informed while we fix it, and
credit you when the fix is released unless you would rather we did not.

If private vulnerability reporting is enabled in the repository's Security
tab, you can use that instead of email.

## Supported versions

Freshcoat has no releases yet. Fixes land on the default branch, and only the
latest commit there is supported. This section will list supported releases
once there are some.

## Scope

This policy covers all packages, both applications and the repository's build
and release tooling, not just Studio. Reports we especially want include:

- crafted templates, scenes, archives, datasets, images, fonts or print profiles
  that cause unsafe behavior when parsed or rendered;
- archive traversal, unexpected file access or code execution in SDK use under
  Node or Bun, or in browser applications;
- unsafe handling of external assets or Figma-to-Studio handoff data;
- a link or imported file that makes Studio or the Figma plugin perform an
  action the user did not request;
- path traversal or similar issues in Studio's static server,
  `apps/editor/server.ts`;
- a release-tooling issue that exposes credentials or publishes unintended content.

Studio's editing and exports run in the browser, but the SDKs can also run in
server applications. A host controls its asset sources, network access and
file destinations; those boundaries matter when reproducing a report.

A vulnerability in a dependency belongs with its project. Tell us too if
Freshcoat uses it in a way that is exploitable.
