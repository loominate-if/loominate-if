import { object, spawn, template } from "./syntax.js";

export const player = object("player", { fear: 0 });

/** A mixin: spread it into a definition. */
const lockable = {
  isLocked: true,
  unlock(this: { isLocked: boolean }, key: { taken: boolean }): boolean {
    if (!key.taken) return false;
    this.isLocked = false;
    return true;
  },
};

export const lantern = object("lantern", {
  name: "brass lantern",
  taken: false,
  isLit: false,
  light() {
    this.isLit = true;
  },
});

export const key = object("key", { taken: false });

export const cellarDoor = object("cellar door", { ...lockable, name: "cellar door" });

export const match = template("match", {
  isLit: true,
  burnOut() {
    this.isLit = false;
  },
});

export const matchbox = object("matchbox", {
  count: 3,
  struck: 0,
  strike() {
    if (this.count === 0) return;
    this.count -= 1;
    this.struck += 1;
    const lit = spawn(match, this);
    if (lantern.taken) lantern.light();
    lit.burnOut();
  },
});
