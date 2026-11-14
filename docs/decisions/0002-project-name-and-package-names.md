# 0002. Project name and package names

- **Status:** Accepted, 2026-11-14. Amended the same day: the product name changed from Loominate to Loominate IF.
- **Issue:** [#3](https://github.com/loominate-if/loominate-if/issues/3)
- **Design:** [Open questions](../DESIGN.md#open-questions)

## Context

The working name is **Loominate**. Availability checks on 2026-11-14 found:

- The GitHub account `loominate` is an existing user account, created 2012.
- The npm scope `@loominate` is owned by an unrelated project that publishes `@loominate/host-node` ("Sign and check Loominate tokens from a Node server"), last modified 2026-11-04.
- `loominate.com` and `loominate.io` are registered.
- `loominate-if` was free on GitHub and npm.

## Decision

- The product name is **Loominate IF**, with IF for interactive fiction. It matches the `loominate-if` handles and sets the project apart from the unrelated Loominate project.
- **GitHub:** the org is `loominate-if` and the repository is `loominate-if/loominate-if`.
- **npm:** every package is published under the `@loominate-if` scope (`@loominate-if/core`, `@loominate-if/world`, `@loominate-if/kit-rpg`, …). We publish no unscoped placeholder packages.
- **Scaffold:** the package is `@loominate-if/create`, so authors run `npm create @loominate-if`.
- **CLI:** the package is `@loominate-if/cli`, and its command stays `loominate`, which is short to type. A `bin` name doesn't need a matching npm package name.

## Consequences

- An unrelated "Loominate" project, a token/auth library, exists in the same ecosystem. The IF in the product name and handles reduces confusion with it. Run a trademark search before any commercial use.
- The domain is deferred. `loominate-if.com` looked available on 2026-11-14; decide when docs need hosting.
- ADR 0001's `create-<name>` placeholder resolves to `@loominate-if/create` (`packages/create/`).
