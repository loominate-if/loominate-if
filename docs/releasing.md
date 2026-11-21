# Releasing

How the `@loominate-if` packages get to npm, for maintainers. [ADR 0029](decisions/0029-publishing-to-npm.md) has the reasons.

All seven published packages share one version: `core`, `presentation`, `compiler`, `inspector`, `cli`, `testing`, and `create`. A new game depends on `^<create's version>` of each, so they must move together. `node scripts/release.ts check`, which `pnpm lint` runs, fails if they don't, or if a manifest is missing what npm needs.

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

## The first release

npm's trusted publishing can only be set up for a package that already exists, so the first version is published by hand from a maintainer's machine. This is done once.

1. Turn on two-factor authentication for your npm account (npmjs.com → Account → Two-Factor Authentication, with an authenticator app). npm refuses to publish from an account without it. Then log in to npm as an owner of the `@loominate-if` organization:

   ```sh
   npm login
   ```

2. From a clean checkout of the tagged commit, build and pack every package, then publish each one. Pass a fresh one-time password from your authenticator with `--otp`; one code usually lasts for all seven. Keep the `./` in front of each tarball's path: without it, npm reads `release/x.tgz` as a GitHub repository.

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   node scripts/release.ts pack release
   for tarball in ./release/*.tgz; do npm publish "$tarball" --access public --otp=123456; done
   ```

3. On npmjs.com, for each of the seven packages, open **Settings → Trusted publishing**, choose GitHub Actions, and enter the organization `loominate-if`, the repository `loominate-if`, and the workflow `release.yml`. Then, under **Publishing access**, require two-factor authentication and disallow tokens, so only the workflow can publish.

4. Push the tag for the version that was published, `v0.1.0`. The workflow finds every package already published and skips them, which shows it's set up.

## Checking a release

`node scripts/release.ts pack <folder>` writes the tarballs that would be published, and checks that pnpm rewrote every `workspace:` range and that each package contains the files its `exports` and `bin` name. To try them as an author would before publishing, serve them from a local registry such as [Verdaccio](https://verdaccio.org/) and follow [Getting started](guide/getting-started.md) with `npm_config_registry` pointing at it.
