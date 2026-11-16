import { define, GameObject, spawn, template } from "./syntax.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeScript requires this signature for mixins
type Constructor<T = object> = new (...args: any[]) => T;

/** A mixin: a function from a base class to a subclass. */
function Lockable<B extends Constructor<GameObject>>(Base: B) {
  return class extends Base {
    isLocked = true;
    unlock(key: { taken: boolean }): boolean {
      if (!key.taken) return false;
      this.isLocked = false;
      return true;
    }
  };
}

class Player extends GameObject {
  fear = 0;
}
export const player = define(Player, "player");

class Lantern extends GameObject {
  name = "brass lantern";
  taken = false;
  isLit = false;
  light(): void {
    this.isLit = true;
  }
}
export const lantern = define(Lantern, "lantern");

class Key extends GameObject {
  taken = false;
}
export const key = define(Key, "key");

class CellarDoor extends Lockable(GameObject) {
  name = "cellar door";
}
export const cellarDoor = define(CellarDoor, "cellar door");

class Match extends GameObject {
  isLit = true;
  burnOut(): void {
    this.isLit = false;
  }
}
export const match = template("match", Match);

class Matchbox extends GameObject {
  count = 3;
  struck = 0;
  strike(): void {
    if (this.count === 0) return;
    this.count -= 1;
    this.struck += 1;
    const lit = spawn(match, this);
    if (lantern.taken) lantern.light();
    lit.burnOut();
  }
}
export const matchbox = define(Matchbox, "matchbox");
