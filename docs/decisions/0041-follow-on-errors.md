# 0041. Showing the errors that matter

- **Status:** Accepted, 2026-11-22
- **Issue:** [#283](https://github.com/loominate-if/loominate-if/issues/283)
- **Design:** [Compilation and checking](../DESIGN.md#compilation-and-checking), design principle 6

## Context

A passage's inline code is TypeScript in a generated module. When one expression doesn't parse, TypeScript recovers by guessing, and each guess brings errors of its own. One line with a backslash where a backtick belonged produced 130 errors. The first was at 1:1 and unrelated to the cause, and the useful one, "`t` isn't defined", was buried among them.

## Decision

- The compiler marks a diagnostic `followOn` when it likely follows from another error:
  - any TypeScript error after a file's first syntax error, since TypeScript's view of what comes after it is unreliable;
  - in a file with a syntax error, errors about the generated code around it: "must return a value" for a passage body, and errors naming the compiler's own `$` names;
  - in a file with other errors, errors in generated code with no author position.
- Errors before the first syntax error stand, as do every parser, compiler, and extension diagnostic.
- `shownDiagnostics(diagnostics, { verbose, perFile })` gives what to show: no follow-ons, at most `perFile` (5) per file, and how many it held back. `verbose` returns every diagnostic.
- The CLI uses it wherever it reports: `loominate build`'s failure, the dev server's terminal report, and Vite's overlay. Each ends with "…and N more, most likely following from those; run with --verbose to see them all." when it held any back.
- `--verbose` on `dev`, `build`, and `test`, and `verbose` on the plugin and command options, show everything as before.
- In the dev server, a passage module whose code doesn't parse isn't handed to Vite. Vite's own parser would fail on it and replace the overlay with its error, such as "Invalid Unicode escape sequence", pointing into the generated module, at a line the author never wrote. The plugin fails the module with the passage's own errors instead, the same ones the overlay shows. A module with only type errors still loads, so the game plays while they're fixed.

## Consequences

- An author fixes the first real error and builds again, as with most compilers. Two independent syntax errors in one file are reported one at a time, unless `--verbose` is given.
- The diagnostics themselves are unchanged and all still returned, so an editor integration or a test can show what it likes.
- The rules are heuristics over TypeScript's recovery. A real error held back appears once the one before it is fixed, or with `--verbose`.
