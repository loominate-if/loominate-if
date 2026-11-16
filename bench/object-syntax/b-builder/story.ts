import { define, mixin, spawn, template } from "./syntax.js";

export const player = define("player").state({ fear: 0 }).done();

/** A mixin: a partial builder, added with `.with()`. */
const lockable = mixin()
  .state({ isLocked: true })
  .does({
    unlock(key: { taken: boolean }): boolean {
      if (!key.taken) return false;
      this.isLocked = false;
      return true;
    },
  });

export const lantern = define("lantern")
  .state({ name: "brass lantern", taken: false, isLit: false })
  .does({
    light() {
      this.isLit = true;
    },
  })
  .done();

export const key = define("key").state({ taken: false }).done();

export const cellarDoor = define("cellar door")
  .with(lockable)
  .state({ name: "cellar door" })
  .done();

export const match = template("match")
  .state({ isLit: true })
  .does({
    burnOut() {
      this.isLit = false;
    },
  })
  .done();

export const matchbox = define("matchbox")
  .state({ count: 3, struck: 0 })
  .does({
    strike() {
      if (this.count === 0) return;
      this.count -= 1;
      this.struck += 1;
      const lit = spawn(match, this);
      if (lantern.taken) lantern.light();
      lit.burnOut();
    },
  })
  .done();
