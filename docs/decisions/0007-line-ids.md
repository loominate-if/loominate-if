# 0007. Stable line IDs

- **Status:** Accepted, 2026-11-17
- **Issue:** [#34](https://github.com/loominate-if/loominate-if/issues/34)
- **Design:** [Stable line IDs](../DESIGN.md#stable-line-ids), [Passage files](../DESIGN.md#passage-files)

## Context

The compiler gives every authored line of prose and dialogue an ID that survives edits to the text around it. Skip-read text (#175) and the persistent read-lines store key on these IDs, voice files map to them, and translations will too. Changing the scheme later would orphan all of these, so it has to be fixed before games depend on it.

Core already carries the ID: text and link nodes, and `narrative` events, have an optional `line` field. ADR 0004 made the paragraph the unit of prose. This ADR decides what the ID is derived from, and so which edits keep it.

Three schemes were considered:

- **A hash of the line's own text.** Edits elsewhere never change it, and authors write nothing extra. Editing the line itself gives it a new ID, which is right for skip-read (changed text hasn't been read), but means a typo fix orphans a recorded voice line or a translation.
- **Tags written back into the source,** as Yarn Spinner does with `#line:abc123`. IDs never change unless a tag is deleted, but a tool rewrites the author's files and every line carries a tag.
- **A hash, with optional pins.** The first scheme by default, with a way to fix an ID by hand for lines whose voice or translation should survive edits.

## Decision

Line IDs are a content hash, with optional pins.

### What a line is

- A **line** is a source paragraph: the content of a passage between blank lines, links on lines of their own, and `{continue}`. Since [ADR 0015](0015-compiler-extensions.md), any content directive or line form ends a paragraph as `{continue}` does; `{continue}` is the only one so far, so no IDs changed. The label of a link on its own line is a line of its own. A link inside a paragraph (#207) is part of that paragraph's line: its `[[label]]` counts in the paragraph's canonical text, and it gets no ID of its own, so translators see the whole sentence.
- Content with no prose (no text and no printed value) isn't a line and gets no ID.
- `{if}` blocks can join source paragraphs at runtime. Here a player who hasn't met the speaker sees one paragraph, "Hello friend.", made from two lines:

  ```
  Hello {if met}again.

  Welcome back, {/if}friend.
  ```

  A **rendered paragraph takes the ID of the first line that adds text to it**, here the `Hello` line. The ID still names one authored line, which is what skip-read and voice need.

### The ID

- The ID is `<passage>:<hash>`, as in `Cellar:k3f9a2`. The hash is 64-bit FNV-1a over the UTF-8 bytes of the line's canonical text, reduced modulo 36⁶ and written as six base-36 digits, zero-padded.
- The **canonical text** is what the author wrote, with whitespace runs collapsed to one space and trimmed:
  - text as shown, so rewrapping, indentation, and comments don't change the ID;
  - printed values as `{code}`, formatting as `*…*` and `**…**`, and `{if c}`, `{else if c}`, `{else}`, `{/if}` where they fall;
  - other argument-form directives as written, such as `{beat 1.5s}`;
  - not effect code (`{on enter: …}`), so editing an effect keeps the paragraph's ID.
- A link's canonical text is `[[label]]`, so changing its target or guard keeps its ID.
- When the same base ID appears again in a passage, the later ones get `-2`, `-3`, … in source order.

### Pins

- `{line name}` on the line above a paragraph or link pins its ID to `<passage>:name`, whatever its text. Names are letters, digits, `-`, and `_`.
- These are compile errors: a pin with nothing below it in its paragraph (or a link right after it), two pins on one line, the same name twice in a passage, or a malformed name.
- Hashed IDs step around pinned ones: a hash that equals a pin takes the next free suffix.

## Consequences

- Adding, removing, editing, or reordering other lines never changes a line's ID. Editing a line changes its ID unless it's pinned.
- Renaming a passage changes every ID in it. Passage names are already stable identifiers (save data keys on them), so this adds no new constraint.
- Inserting a copy of an existing line before it renumbers the copies. Lines that repeat word for word in one passage are rare, and a pin fixes it.
- The hash function, the canonical text, and the ID format are now part of the save and voice-file contract. Changing any of them is a breaking change that needs a migration.
- Text produced by code, such as `{continue}` labels and strings in TypeScript modules, isn't covered here. It belongs to the localization decision ([#60](https://github.com/loominate-if/loominate-if/issues/60)) and tagged templates ([#27](https://github.com/loominate-if/loominate-if/issues/27)).
- The hash is pure TypeScript, so the compiler doesn't need Node's `crypto` and can run in the browser-hosted language server.
- A future tool can list lines whose IDs changed between builds, so authors can pin a line before a typo fix orphans its voice file or translation.
