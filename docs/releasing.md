# Releasing

How the `@loominate-if` packages get to npm, for maintainers. [ADR 0029](decisions/0029-publishing-to-npm.md) has the reasons.

Every package under `packages/` that isn't `private` is published, and they all share one version; the editor extensions and the Tree-sitter grammar are `private`. A new game depends on `^<create's version>` of several, and they depend on each other, so they must move together. `node scripts/release.ts check`, which `pnpm lint` runs, fails if they don't, or if a manifest is missing what npm needs.

## A release

1. On a branch, set the new version for every package, update core's API report (it records `ENGINE_VERSION`, which follows the version), and open a pull request:

   ```sh
   node scripts/release.ts version 0.2.0
   pnpm api:update
   ```

2. Once it's merged, tag the merge commit on `main` and push the tag:

   ```sh
   git checkout main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```

The [Release workflow](../.github/workflows/release.yml) checks that the tag matches the version, runs every check, packs each package, and publishes it with provenance. A package already published at that version is skipped, so a failed run can be re-run.

## A new package

The Release workflow can't publish a package npm hasn't seen: trusted publishing is set up per package, and only for one that exists. So a release that publishes a package for the first time, such as one that was `private`, has the maintainer publish that package by hand first, as in [the first release](#the-first-release):

1. Merge the version pull request, tag the merge commit, but don't push the tag yet.
2. From a clean checkout of the tag, build and pack as in step 2 of the first release, then publish only the new packages' tarballs, approving each in the browser:

   ```sh
   for p in archive language-server world; do npm publish ./release/loominate-if-$p-0.2.0.tgz --access public; done
   ```

3. Make the workflow their trusted publisher, as in step 3, for those packages.
4. Push the tag. The workflow skips the packages already published and publishes the rest.
5. Require two-factor authentication and disallow tokens for the new packages, as in step 5.

## The first release

npm's trusted publishing can only be set up for a package that already exists, so the first version is published by hand from a maintainer's machine. This is done once.

1. Turn on two-factor authentication for your npm account (npmjs.com → Account → Two-Factor Authentication). npm refuses to publish from an account without it. A passkey works, and needn't be a hardware key: one saved in a browser's or a phone's password manager will do. Then log in to npm as an owner of the `@loominate-if` organization:

   ```sh
   npm login
   ```

2. From a clean checkout of the tagged commit, build every package from scratch (`tsc -b` leaves output behind when a source file is removed, and `pack` refuses a package that has some), pack it, then publish each one. Run this in a real terminal: npm waits for your approval only when it has one, and fails at once with `EOTP` otherwise. For each package it prints a `https://www.npmjs.com/auth/cli/…` link; open it in the browser that holds your passkey, logged in to npmjs.com, and approve. A new package can take a few minutes to appear after "your package is being processed". Keep the `./` in front of each tarball's path: without it, npm reads `release/x.tgz` as a GitHub repository.

   ```sh
   pnpm install --frozen-lockfile
   rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo
   pnpm build
   node scripts/release.ts pack release
   for tarball in ./release/*.tgz; do npm publish "$tarball" --access public; done
   ```

3. Make the Release workflow a trusted publisher of each package. In a terminal (each command asks you to approve it in the browser where your npm passkey is):

   ```sh
   for p in archive cli compiler core create inspector language-server presentation testing world; do
     npm trust github @loominate-if/$p --repo loominate-if/loominate-if --file release.yml --allow-publish --yes
   done
   ```

   `npm trust list @loominate-if/<package>` should then show `repository: loominate-if/loominate-if` and `file: release.yml` for each. The workflow uses no GitHub environment, so none is set.

4. Push the tag for the version that was published, `v0.1.0`. The workflow finds every package already published and skips them. That checks the workflow runs, but not the trust: npm is first asked for a credential by the next version's release, which fails with a 403 naming the package if a trusted publisher is wrong.

5. Once a release has published from the workflow, on npmjs.com under each package's **Settings → Publishing access**, require two-factor authentication and disallow tokens, so only the workflow, and owners with their second factor, can publish.

## Checking a release

`node scripts/release.ts pack <folder>` writes the tarballs that would be published, and checks that pnpm rewrote every `workspace:` range and that each package contains the files its `exports` and `bin` name. To try them as an author would before publishing, serve them from a local registry such as [Verdaccio](https://verdaccio.org/) and follow [Getting started](guide/getting-started.md) with `npm_config_registry` pointing at it.
