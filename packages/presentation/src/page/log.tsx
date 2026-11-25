/**
 * The story log and full transcript (#127, ADR 0103): two views of the
 * event record beside the page. The story log is the narrative, for
 * rereading: prose, scenes, what the player noticed, and what was said,
 * each line by its speaker. The transcript is everything, labeled, for
 * testers and bug reports. Both read the record, so undo trims them.
 */
import { message, type RecordedEvent, type TextStyle } from "@loominate-if/core";
import { render } from "preact";
import "../messages.js";
import { exportStoryLog, type ExportedFile, type ExportFormat } from "./export.js";
import { prose } from "./prose.js";

/** One entry of the story log. */
export type LogEntry = {
  /** What it says. */
  readonly text: string;
  /** Its formatting, if any. */
  readonly styles?: readonly TextStyle[];
  /** Who said it, by name, for dialogue. */
  readonly speaker?: string;
  /** Whether it's the player's own line, as "You ask the maid about the gold." */
  readonly player?: boolean;
  /** The move it came in, from 0, so the log can be read in turns. */
  readonly move: number;
  /** Whether it's a chapter's title, from `{chapter "…"}`, where exports divide. */
  readonly chapter?: boolean;
};

/** Names speakers by their IDs, for the story log. The world model gives names. */
let speakerName: (id: string) => string | undefined = () => undefined;

/**
 * Says how the story log names a speaker, given the ID in a `speaker:` tag
 * or a `dialogue` event. The world model names bodies by their names; a
 * game without it can name its own.
 *
 * @example
 * ```ts
 * nameSpeakers((id) => ({ mira: "Mira" })[id]);
 * ```
 */
export function nameSpeakers(names: (id: string) => string | undefined): void {
  speakerName = names;
}

/** Event kinds the story log takes: prose the player read. */
const NARRATIVE = new Set(["narrative", "scene", "dialogue", "room-description"]);
/** Event kinds it takes from a move: what was noticed and what came of it. */
const NOTICED = new Set(["perception", "action-result", "scheduled"]);

/**
 * The story log of `events`, as the record holds them: passage prose and
 * scenes, a room's description on the first visit only, what the player
 * noticed, and what was said, each line by its speaker. Left out:
 * navigation, actions, menus, system messages, and later visits' room
 * descriptions. An event tagged `log` or `log-only` is put in; one tagged `no-log` is
 * left out.
 */
export function storyLog(events: readonly RecordedEvent[]): LogEntry[] {
  const out: LogEntry[] = [];
  // Each move reads as the page shows it: what led there, the passage's prose, then what was noticed.
  let leads: LogEntry[] = [];
  let prose: LogEntry[] = [];
  let noticed: LogEntry[] = [];
  const flush = (): void => {
    out.push(...leads, ...prose, ...noticed);
    leads = [];
    prose = [];
    noticed = [];
  };
  const visits = new Map<string, number>();
  let here: string | undefined;
  let move = 0;
  let chapterNow: string | undefined;
  for (const e of events) {
    const tags = e.tags;
    if (e.kind === "navigation") {
      here = e.to;
      visits.set(here, (visits.get(here) ?? 0) + 1);
      if (e.redirected !== true) {
        flush();
        move++;
      } else {
        // What led to a redirect comes first, before the passage it went to, as on the page.
        leads.push(...noticed);
        noticed = [];
      }
      continue;
    }
    if (e.kind === "action") {
      flush();
      move++;
      continue;
    }
    if (tags.includes("no-log")) continue;
    // A chapter heading: a revisited marker with the current chapter's title doesn't start another.
    if (e.kind === "chapter") {
      if (e.title !== chapterNow) leads.push({ text: e.title, chapter: true, move });
      chapterNow = e.title;
      continue;
    }
    const text = (e as { readonly text?: unknown }).text;
    if (typeof text !== "string" || text === "") continue;
    // `log-only` is read by the story log alone, so it's in, whatever its kind.
    const forced = tags.includes("log") || tags.includes("log-only");
    const narrative = NARRATIVE.has(e.kind);
    if (!forced && !narrative && !NOTICED.has(e.kind)) continue;
    // A room's own prose, on later visits, is left out: the log reads it once.
    const room = tags.some((t) => t.startsWith("room:"));
    if (
      !forced &&
      e.kind === "narrative" &&
      room &&
      here !== undefined &&
      (visits.get(here) ?? 0) > 1
    ) {
      continue;
    }
    const styles = (e as { readonly styles?: readonly TextStyle[] }).styles;
    const player = tags.includes("player");
    const id =
      e.kind === "dialogue"
        ? (e as { readonly speaker?: string }).speaker
        : player
          ? undefined
          : tags.find((t) => t.startsWith("speaker:"))?.slice("speaker:".length);
    const speaker = id === undefined ? undefined : (speakerName(id) ?? id);
    const entry: LogEntry = {
      text,
      ...(styles !== undefined && styles.length > 0 && { styles }),
      ...(speaker !== undefined && { speaker }),
      ...(player && { player: true }),
      move,
    };
    if (tags.includes("lead")) leads.push(entry);
    else if (narrative) prose.push(entry);
    else noticed.push(entry);
  }
  flush();
  return out;
}

/** One line of the full transcript. */
export type TranscriptLine = {
  /** The event's position in the record. */
  readonly seq: number;
  /** Its kind: `action`, `navigation`, `perception`, `system`… */
  readonly kind: string;
  /** What it says, or its fields, as text. */
  readonly text: string;
  /** Its tags. */
  readonly tags: readonly string[];
};

/** The full transcript of `events`: every one, in order, with its kind and its text or fields. */
export function transcript(events: readonly RecordedEvent[]): TranscriptLine[] {
  return events.map((e) => {
    const { seq, kind, tags, ...fields } = e as RecordedEvent & Record<string, unknown>;
    const text =
      typeof fields["text"] === "string"
        ? fields["text"]
        : Object.entries(fields)
            .filter(([k]) => k !== "styles" && k !== "line")
            .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(", ");
    return { seq, kind, text, tags };
  });
}

/** A transcript as plain text, one event a line, for a bug report. */
export function transcriptText(lines: readonly TranscriptLine[]): string {
  return lines.map((l) => `${String(l.seq)} [${l.kind}] ${l.text}`).join("\n");
}

/** An open-able log dialog. */
export type LogDialog = {
  /** The dialog element. */
  readonly element: HTMLDialogElement;
  /** Opens the story log or the transcript, focused on its filter. */
  open(view: "log" | "transcript"): void;
  /** Closes it. */
  close(): void;
};

let dialogs = 0;

/** Builds the dialog that shows the story log or the transcript of `record`'s events, added to `parent`. */
export function createLogDialog(
  parent: HTMLElement,
  events: () => readonly RecordedEvent[],
  options: {
    /** The game's title, for exports. */
    readonly title?: string;
    /** Who wrote it, for exports. */
    readonly author?: string;
    /** Saves an exported file; defaults to downloading it. */
    readonly save?: (file: ExportedFile) => void;
  } = {},
): LogDialog {
  const doc = parent.ownerDocument;
  const id = `loominate-log-${String(++dialogs)}`;
  const dialog = doc.createElement("dialog");
  dialog.className = "loominate-log";
  dialog.setAttribute("aria-labelledby", `${id}-title`);
  parent.append(dialog);
  let view: "log" | "transcript" = "log";
  /** The story log's filter, or the transcript's kind. */
  let filter = "all";
  let status = "";
  let format: ExportFormat = "epub";
  const save =
    options.save ??
    ((file: ExportedFile): void => {
      const url = doc.defaultView?.URL;
      if (url === undefined || typeof url.createObjectURL !== "function") return;
      const href = url.createObjectURL(new Blob([file.data as BlobPart], { type: file.type }));
      const a = doc.createElement("a");
      a.href = href;
      a.download = file.name;
      a.click();
      url.revokeObjectURL(href);
    });

  const close = (): void => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.open = false;
    doc.documentElement.classList.remove("loominate-modal-open");
  };
  // However it closes, by Close or Escape, the page behind can scroll again.
  dialog.addEventListener("close", () => {
    doc.documentElement.classList.remove("loominate-modal-open");
  });
  // The mouse wheel anywhere on the dialog scrolls the log, not the page behind it.
  dialog.addEventListener(
    "wheel",
    (event) => {
      const scroller = dialog.querySelector<HTMLElement>(".loominate-log-body");
      if (!scroller || scroller.contains(event.target as Node)) return;
      const step = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      scroller.scrollTop += event.deltaY * step;
      event.preventDefault();
    },
    { passive: false },
  );

  /** The entries, each focusable, so a screen reader reads the one with focus. */
  const entries = (): HTMLElement[] => [
    ...dialog.querySelectorAll<HTMLElement>(".loominate-log-entry, .loominate-log-line"),
  ];
  /** Up and Down move between entries, Home and End to the first and last. */
  const stepThrough = (event: KeyboardEvent): void => {
    const all = entries();
    const at = all.indexOf(doc.activeElement as HTMLElement);
    const to =
      event.key === "ArrowUp"
        ? at - 1
        : event.key === "ArrowDown"
          ? at + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? all.length - 1
              : undefined;
    if (to === undefined || at < 0) return;
    event.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, to))]?.focus();
  };

  const draw = (): void => {
    const all = events();
    const title = message(view === "log" ? "log.title" : "log.transcriptTitle");
    const body =
      view === "log"
        ? storyLog(all)
            .filter(
              (e) =>
                filter === "all" ||
                e.speaker !== undefined ||
                e.player === true ||
                e.chapter === true,
            )
            .map((e, i, list) =>
              e.chapter === true ? (
                <h3 key={i} tabIndex={-1} className="loominate-log-entry loominate-log-chapter">
                  {e.text}
                </h3>
              ) : (
                <p
                  key={i}
                  tabIndex={-1}
                  className={`loominate-log-entry${e.player === true ? " loominate-log-player" : ""}${
                    i > 0 && list[i - 1]?.move !== e.move ? " loominate-log-turn" : ""
                  }`}
                >
                  {e.speaker !== undefined && (
                    <span className="loominate-log-speaker">{`${e.speaker}: `}</span>
                  )}
                  {prose(e.text, e.styles ?? [], [], () => null)}
                </p>
              ),
            )
        : transcript(all)
            .filter((l) => filter === "all" || l.kind === filter)
            .map((l) => (
              // Event kinds and fields are data, not prose: not to be translated.
              <p key={l.seq} className="loominate-log-line" tabIndex={-1} translate={false}>
                <span className="loominate-log-seq">{String(l.seq)}</span>{" "}
                <span className="loominate-log-kind">{`[${l.kind}]`}</span> {l.text}
              </p>
            ));
    const kinds = [...new Set(all.map((e) => e.kind))].sort();
    render(
      <>
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="loominate-log-controls">
          <label htmlFor={`${id}-filter`}>{`${message("log.show")} `}</label>
          <select
            id={`${id}-filter`}
            value={filter}
            onChange={(event) => {
              filter = (event.currentTarget as HTMLSelectElement).value;
              draw();
            }}
          >
            {view === "log" ? (
              <>
                <option value="all">{message("log.all")}</option>
                <option value="dialogue">{message("log.dialogue")}</option>
              </>
            ) : (
              <>
                <option value="all">{message("log.allKinds")}</option>
                {kinds.map((k) => (
                  <option key={k} value={k} translate={false}>
                    {k}
                  </option>
                ))}
              </>
            )}
          </select>
          {view === "log" && (
            <>
              {" "}
              <label htmlFor={`${id}-format`}>{`${message("log.exportAs")} `}</label>
              <select
                id={`${id}-format`}
                value={format}
                onChange={(event) => {
                  format = (event.currentTarget as HTMLSelectElement).value as ExportFormat;
                }}
              >
                {/* Format names are names, not to be translated. */}
                <option value="epub" translate={false}>
                  EPUB
                </option>
                <option value="html" translate={false}>
                  HTML
                </option>
                <option value="markdown" translate={false}>
                  Markdown
                </option>
              </select>{" "}
              <button
                type="button"
                onClick={() => {
                  const file = exportStoryLog(events(), format, {
                    title: options.title ?? doc.title,
                    ...(options.author !== undefined && { author: options.author }),
                    language: doc.documentElement.lang || "en",
                  });
                  save(file);
                  status = message("log.exported", { name: file.name });
                  draw();
                }}
              >
                {message("log.export")}
              </button>
            </>
          )}
          {view === "transcript" && (
            <button
              type="button"
              onClick={() => {
                const text = transcriptText(transcript(events()));
                const clip = doc.defaultView?.navigator.clipboard;
                (clip ? clip.writeText(text) : Promise.reject(new Error("no clipboard")))
                  .then(() => {
                    status = message("log.copied");
                    draw();
                  })
                  .catch(() => {
                    status = message("log.copyFailed");
                    draw();
                  });
              }}
            >
              {message("log.copy")}
            </button>
          )}
        </p>
        <p className="loominate-log-status" role="status">
          {status}
        </p>
        <div
          className="loominate-log-body"
          role="group"
          aria-label={`${title}: ${message("log.keys")}`}
          onKeyDown={(event) => {
            stepThrough(event);
          }}
        >
          {body.length > 0 ? body : <p className="loominate-log-empty">{message("log.empty")}</p>}
        </div>
        <button type="button" onClick={close}>
          {message("log.close")}
        </button>
      </>,
      dialog,
    );
  };

  return {
    element: dialog,
    open(which) {
      view = which;
      filter = "all";
      status = "";
      draw();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.open = true;
      // While it's open, the page behind doesn't scroll.
      doc.documentElement.classList.add("loominate-modal-open");
      // The newest entry takes focus, so a screen reader reads it; arrows read the rest.
      const newest = entries().at(-1);
      if (newest) newest.focus();
      else dialog.querySelector<HTMLSelectElement>(`#${id}-filter`)?.focus();
      // The newest at the bottom, in view.
      const scroller = dialog.querySelector<HTMLElement>(".loominate-log-body");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    },
    close,
  };
}
