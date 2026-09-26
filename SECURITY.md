# Security policy

## Reporting a vulnerability

Please report a vulnerability privately. Do not open a public issue, a pull
request or a discussion about it.

Email [security@dotsidestudios.com](mailto:security@dotsidestudios.com) with:

- what the problem is, and what someone could do with it;
- the steps, or a file, that show it;
- the version or commit you tested.

We will acknowledge your report, keep you informed while we fix it, and
credit you when the fix is released unless you would rather we did not.

Once Freshcoat has its own repository, you can also report through GitHub's
private vulnerability reporting, under the repository's Security tab.

## Supported versions

Freshcoat has no releases yet. Fixes land on the default branch, and only the
latest commit there is supported. This section will list the supported
releases once there are some.

## Scope

Freshcoat runs entirely in the browser and has no server of its own, beyond a
static file server (`editor/server.ts`). Reports we especially want:

- a crafted `.coatworkspace`, `.coat` (or `.tkit`), template JSON,
  spreadsheet, image or print profile that runs code, reads files it should
  not, or escapes the page when opened;
- a way for a link to make the editor do something the person did not ask
  for;
- a path traversal or a similar issue in `editor/server.ts`.

A vulnerability in a dependency belongs with its project. Tell us too if
Freshcoat uses it in a way that is exploitable.
