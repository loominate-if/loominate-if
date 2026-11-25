/**
 * The inspector's NPC view (#108, ADR 0086): each NPC's place, level, turn
 * and why, agenda items, and timetable, gathered from the modules that
 * keep them. It reads the world and changes nothing.
 */
import { _allMinds, bodyOf, currentPlayerBody } from "./actors.js";
import { _agendaItems, _busyWithAgenda } from "./agendas.js";
import { getsTurn, isSimulated, pacingOf } from "./npcs.js";
import { canHear, canSee } from "./scope.js";
import { placeOf } from "./things.js";
import { _timetableOf } from "./timetables.js";

/** An agenda item, as the NPCs tab shows it. @internal */
export type _NpcAgendaItem = {
  readonly name: string;
  readonly priority: number;
  readonly active: boolean;
  readonly ready: boolean;
  /** Whether it's the item that acts in their next turn. */
  readonly next: boolean;
};

/** A timetable entry, as the NPCs tab shows it: its time, place, and days. @internal */
export type _NpcTimetableEntry = { readonly at: string; readonly in: string; readonly on?: string };

/** One NPC, as the inspector's NPCs tab shows them. @internal */
export type _NpcRow = {
  readonly mind: string;
  readonly body: string;
  readonly name: string;
  readonly place?: string;
  readonly level: "observed" | "scheduled" | "simulated";
  /** For a paced NPC, how often their turns come: "every 5 minutes". */
  readonly pace?: string;
  readonly turn: boolean;
  /** Why they get a turn now, or don't. */
  readonly why:
    | "simulated"
    | "busy with an agenda item"
    | "seen by the player"
    | "heard by the player"
    | "out of sight";
  readonly agenda: readonly _NpcAgendaItem[];
  /** The entry they're in now, and the next to begin, with when, if they have a timetable. */
  readonly timetable?: {
    readonly now?: _NpcTimetableEntry;
    readonly next?: _NpcTimetableEntry & { readonly minutes: number };
  };
};

/** Every NPC with a body, but the player, in ID order. @internal */
export function _npcRows(): readonly _NpcRow[] {
  const player = currentPlayerBody();
  return _allMinds().flatMap((mind): _NpcRow[] => {
    const body = bodyOf(mind);
    if (!body || body.id === player?.id) return [];
    const timetable = _timetableOf(mind);
    const why: _NpcRow["why"] = isSimulated(mind)
      ? "simulated"
      : _busyWithAgenda(mind)
        ? "busy with an agenda item"
        : player && canSee(player, body)
          ? "seen by the player"
          : player && canHear(player, body)
            ? "heard by the player"
            : "out of sight";
    const where = placeOf(body);
    const pacing = pacingOf(mind)?.every;
    const pace =
      pacing === undefined
        ? undefined
        : "minutes" in pacing
          ? `every ${String(pacing.minutes)} ${pacing.minutes === 1 ? "minute" : "minutes"}`
          : `every ${String(pacing.moves)} ${pacing.moves === 1 ? "move" : "moves"}`;
    return [
      {
        mind: mind.id,
        body: body.id,
        name:
          typeof (body as { name?: unknown }).name === "string"
            ? (body as { name: string }).name
            : body.id,
        ...(where && { place: where.id }),
        level: isSimulated(mind) ? "simulated" : timetable ? "scheduled" : "observed",
        ...(pace !== undefined && { pace }),
        turn: getsTurn(mind),
        why,
        agenda: _agendaItems(mind),
        ...(timetable && { timetable }),
      },
    ];
  });
}
