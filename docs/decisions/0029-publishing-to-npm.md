# 0029. Publishing to npm

- **Status:** Accepted, 2026-11-21
- **Issue:** [#257](https://github.com/loominate-if/loominate-if/issues/257)
- **Design:** [Tooling](../DESIGN.md#tooling), [ADR 0002](0002-project-name-and-package-names.md), [ADR 0023](0023-game-config-and-cli-commands.md)

## Context

None of the packages were on npm, so `npm create @loominate-if` failed, and the getting-started guide and the tutorial couldn't be followed. Publishing needs a scope, a set of packages, a version scheme, and a way to cut releases.

## Decision

### What's published

- The packages are published under the `@loominate-if` scope on npm (ADR 0002).
- Seven packages go out: `core`, `presentation`, `cli`, `testing`, and `create`, which authors install, and `compiler` and `inspector`, which the CLI depends on. A package is published unless its package.json says `"private": true`; examples are never published.
- Each published package's `dependencies` on the others use `workspace:^`, which pnpm writes as `^<version>` in the tarball, so npm can share one copy of core between a game and the CLI's inspector.

### Versions

- The published packages share one version, starting at `0.1.0`. The scaffold writes `^<create's version>` for every Loominate dependency, so packages that drifted apart would give new games ranges that don't exist.
- `node scripts/release.ts version <version>` sets it everywhere, including core's `ENGINE_VERSION`, which saves and replays record (ADR 0010) and which must be core's version. A save or replay made with an older engine still loads; the inspector notes the difference. `node scripts/release.ts check`, run by `pnpm lint`, fails if the versions differ, or if a manifest lacks a license, the repository (which provenance is checked against), public access, or `dist` in its files.
- Before 1.0, a minor version may break public API; the API reports show what changed.

### Releases

- After the first release, a release is a version tag. Pushing `v<version>` runs the Release workflow, which checks the tag matches the version, runs every check, packs each package with pnpm, and publishes the tarballs with npm.
- The workflow uses npm's trusted publishing: npm trusts this repository's workflow, so there's no token to leak, and every package gets provenance tying it to the commit it was built from. Packages already at the version are skipped, so a failed run can be re-run.
- Trusted publishing can only be configured for a package that exists, so the first version, `0.1.0`, is published by hand. [Releasing](../releasing.md) has the steps for both.
- Changesets was considered and not used: with every package on one version, there's no per-package bump to record, and a script is enough. Changelogs can be added when there are users to read them.

### Checking before publishing

- `node scripts/release.ts pack <folder>` writes the tarballs and checks each packed manifest: no `workspace:` range left, and every file its `exports` and `bin` name present.
- Before the first release, the tarballs were published to a local Verdaccio registry and both guides were followed in a container with only Node 22.18: Getting started, and the tutorial from its own code blocks to *The Last Watch* playing, its walkthrough passing, and both builds working.

## Consequences

- `npm create @loominate-if` works once 0.1.0 is published, and the guides can be followed as written.
- Every release publishes all seven packages, even ones that didn't change.
- A package added later is published at the shared version unless it's marked private, and needs its trusted publisher set up after its first publish.
