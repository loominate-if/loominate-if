# AGENTS.md

Guidance for coding agents (Claude Code and others) working on **Loominate IF**.

## What this project is

Loominate IF is a programmer-oriented authoring system for interactive fiction. Authors write twee-style passage files for prose and TypeScript modules for objects and behavior; the compiler type-checks them together and builds games that run in a browser, as a single HTML file, as a portable `.loom` archive, or as a desktop/mobile app. An optional world model, inspired by TADS 3 and Eric Eve's adv3Lite, provides objects, rooms, knowledge, time, NPCs, and conversations. Genre features (RPG, procedural generation, visual novel, life sim) are optional kits.

**The design document is the source of truth:** `docs/DESIGN.md`. Read the relevant section before starting any task. If a task conflicts with the design, stop and raise it on the issue instead of improvising.

## Design principles (non-negotiable)

1. **Use it or not.** Every layer above the core is optional. A plain branching story must never pay for the world model or kits in syntax, bundle size, or concepts.
2. **State is data, behavior is code.** All mutable state lives in the single serializable state store, keyed by stable IDs. Objects never hold private mutable state.
3. **Rendering is pure; effects are explicit.** Rendering text must never change state. State changes happen only in declared phases (`on first visit`, `on enter`, `on leave`, action stages, scheduled events).
4. **Determinism.** Seed + action list must reproduce a playthrough exactly.
   - Never use `Math.random()` in runtime code. Use named random streams.
   - Never read wall-clock time (`Date.now()`, `new Date()`) for game logic. Use the game clock. Wall-clock time is allowed only for presentation timing (beats, animations) and save metadata.
   - Iteration order that affects outcomes must be deterministic.
5. **Everything can be explained.** New rules, actions, topics, and scheduled events must be visible to the inspector, including why something is hidden or disabled.
6. **Catch it at compile time.** Prefer designs where author mistakes become compiler errors reported against the author's source lines.
7. **Open library.** Library behavior is built from the same rulebooks, hooks, and registries authors use. Don't hard-code behavior an author might want to change.
8. **Accessible by default.** Keyboard operable, screen-reader friendly (live regions for new text), and respectful of reduced-motion preferences.
9. **Stable public surface.** Anything exported from a package's public entry point is public API. Everything else is internal and marked `@internal`.

## Key data-model rules

These shape everything; don't work around them.

- **Stable IDs** for every authored object, passage, topic, fact, and **every authored line** of prose and dialogue (line IDs survive edits to surrounding text).
- **Templates and instances.** Runtime-created objects are stored as template + parameters + mutable state, with deterministic IDs derived from their origin (e.g. `gen:crypt-3:room-7`). Never use counters or random UUIDs for IDs.
- **Static vs dynamic references.** Compile-time objects are referenced statically and type-checked; generated objects are reached through dynamic queries.
- **Minds and bodies.** An actor is a mind (knowledge, personality traits, relationships, agendas, conversation) linked to a body (location, inventory, appearance, physical stats, senses, health). The player character is not special: the player controls one mind. Actions record both the acting mind and the body. `actor(...)` creates a permanently linked pair for the common case.
- **Event record.** All output goes into the structured, tagged event record. Never write to the DOM directly from runtime logic.
- **Undo** stores diffs. Anything that mutates state must go through the store so undo, save, and replay see it.

## Repository layout

Decided in [ADR 0001](docs/decisions/0001-repository-layout.md); read it for the full rules. Packages are published as `@loominate-if/<package>` and the CLI command is `loominate` ([ADR 0002](docs/decisions/0002-project-name-and-package-names.md)).

```
packages/
  core/              DOM-free runtime: state store, passages, effect phases, action pipeline, event record, save/undo, random streams
  presentation/      layouts, regions, widgets, themes, beats, effects, audio, accessibility
  world/             world model (optional), including clock and scheduling, stats, NPCs, conversations, compass widget
  compiler/          passage parser, virtual TS modules, line IDs, diagnostics, extension API
  inspector/         in-game debugging panel with a panel registry
  testing/           walkthrough test API authors import
  cli/               dev server, test runner, builds (static, single file, PWA), story map, coverage
  create/            scaffold: `@loominate-if/create`, run as `npm create @loominate-if`
  language-server/   editor-agnostic LSP on the compiler (Volar.js)
  vscode/            VS Code client: grammar + LSP client
  archive/           .loom format, manifest, service worker
  player/            generic sandboxed player
  target-tauri/      desktop wrapper
  target-capacitor/  mobile wrapper
  parser/            natural-language parser (later)
  kits/rpg/  kits/procgen/  kits/vn/  kits/life-sim/   one package per kit (later)
examples/            acceptance games, each a workspace package
docs/                DESIGN.md, decisions/ (ADRs), author docs
```

- Runtime dependencies flow downward only: `core` ← `presentation` ← `world` ← kits, never the reverse. Kits never depend on each other unless the design says so. Runtime packages never depend on tooling.
- `world`, kits, and other optional packages extend the compiler and inspector through their extension APIs and registries. The compiler and inspector never import them.
- `core` never touches the DOM. Nothing from `compiler` or `inspector` may reach a production game bundle.

## Tooling and commands

TypeScript in strict mode, pnpm workspaces, Vitest, ESLint, Prettier. Node ≥ 22.18; pnpm is pinned in `packageManager`.

- **pnpm:** Node 25+ no longer ships corepack. Install the pinned version (`npm i -g pnpm@<version from package.json>`) or prefix commands with `npx pnpm@<version>`.
- **TypeScript stays on 6.0.x for now.** TypeScript 7's JavaScript API is still marked unstable, and typescript-eslint supports only `<6.1`. The compiler and language server need the stable API. Revisit once both support 7.

```
pnpm install
pnpm typecheck     # tsc -b over all packages, plus scripts/
pnpm lint          # ESLint, Prettier check, and scripts/check-deps.ts (package layering)
pnpm test          # unit + walkthrough tests
pnpm build
pnpm format        # apply Prettier (Markdown is excluded; format prose by hand)
```

- **Package layering** (ADR 0001) is enforced by `scripts/check-deps.ts`. A new package must be classified there before `lint` passes.
- **Determinism lint rules** ban `Math.random()`, `Date.now()`, `new Date()`, and `crypto.randomUUID()` in runtime packages. Where wall-clock time is legitimately needed (presentation timing, save metadata), use an `eslint-disable-next-line` comment with a reason.
- **`core` is compiled without DOM types**, so DOM access there is a type error.
- **Tests import workspace packages from source** through the `source` export condition, so no build is needed first.

CI (`.github/workflows/ci.yml`) runs `typecheck`, `lint`, `test`, and `build` on every PR and on pushes to `main`, on the Node engines floor and the current LTS. Branch protection requires only the summary `CI` check, so the matrix can change freely. Actions are pinned to commit SHAs; update the SHA and its version comment together.

Before declaring any task done, run `typecheck`, `lint`, and `test` and make sure they pass. Never disable a failing test or loosen a type to make a check pass; fix the cause or report it on the issue.

## Testing expectations

- **Unit tests** for every new function, rule, or class with logic.
- **Walkthrough tests** (scripted playthroughs asserting on world state and output) for any user-visible behavior. These are the primary way to verify your own changes.
- **Determinism tests**: when touching randomness, scheduling, or generation, add a test that replays a seed and action list and asserts identical results.
- **Acceptance games** in `examples/` are phase gates. Keep them passing; never edit an acceptance game just to make it pass.
- Bug fixes start with a failing test that reproduces the bug.

## Documentation

- Public API changes update author-facing docs and examples in the same PR.
- Code examples in docs must compile; prefer pulling them from tested example files.
- Decisions that resolve an open question in the design doc get a short ADR in `docs/decisions/` (`NNNN-title.md`: context, decision, consequences) and a matching update to `docs/DESIGN.md`.

## Work tracking: GitHub issues

All planned work lives in GitHub issues. Use the `gh` CLI.

### Structure

- **Epic** = an issue labeled `epic`, one per major design area or roadmap item (e.g. "Phase 1: Core runtime", "Phase 2: Minds and bodies"). The epic body links the relevant `docs/DESIGN.md` section and lists acceptance criteria.
- **Tasks** = sub-issues of the epic, each small enough for one focused PR.
- **Phase gates** = a sub-issue on each phase epic labeled `gate`, describing the acceptance game that must pass before the next phase starts.
- **Labels:** `epic`, `gate`, `phase-1` … `phase-4`, `later`; area labels (`area:core`, `area:compiler`, `area:world`, `area:presentation`, `area:inspector`, `area:cli`, `kit:rpg`, `kit:procgen`, `kit:vn`, `kit:life-sim`); type labels (`type:feature`, `type:bug`, `type:test`, `type:docs`, `type:refactor`); and `needs-decision`.

### Linking sub-issues

Sub-issues are attached with the REST API, which takes the sub-issue's numeric **id** (not its issue number):

```sh
SUB_ID=$(gh api repos/{owner}/{repo}/issues/<SUB_NUMBER> --jq .id)
gh api --method POST repos/{owner}/{repo}/issues/<EPIC_NUMBER>/sub_issues -F sub_issue_id="$SUB_ID"
```

List an epic's tasks with `gh api repos/{owner}/{repo}/issues/<EPIC_NUMBER>/sub_issues`.

### Workflow for each task

1. Pick an open sub-issue (lowest phase first, unblocked, not assigned to someone else). Comment that you're starting.
2. Read the linked design section and the epic's acceptance criteria.
3. Branch: `issue-<number>-<short-slug>`.
4. Implement with tests. Keep the change scoped to the issue.
5. Commits reference the issue (`#<number>`). The PR body includes `Closes #<number>` and a short summary of what changed and how it was tested.
6. If you discover additional work, **do not expand scope**. Create a new sub-issue under the right epic, label it, and mention it in your PR.
7. If you hit a design ambiguity or conflict, label the issue `needs-decision`, explain the options in a comment, and stop work on that part.
8. Close an epic only when all its sub-issues are closed and, for phase epics, the gate passes.

### Creating issues from the design doc

When asked to seed or refresh issues, derive epics from `docs/DESIGN.md` sections and the roadmap, check for existing issues first to avoid duplicates (`gh issue list --search`), and create tasks as sub-issues with appropriate labels. Open questions in the design doc become issues labeled `needs-decision`.

## Ask before you…

- change or remove public API, or alter a design principle or data-model rule
- add a runtime dependency (dev dependencies are fine if justified in the PR)
- change the save format, archive format, or line-ID scheme (these break existing games and saves)
- push to `main` or rewrite shared history

## Style

- Prefer small, composable functions and declarative definitions over deep class hierarchies; use mixins for TADS-style multiple inheritance.
- Name things after the domain (passage, beat, topic, fact, mind, body), consistent with the design doc's vocabulary.
- Author-facing error messages explain what went wrong, where (author file and line), and how to fix it.
- Comments explain *why*, not *what*.
