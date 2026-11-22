import { afterEach, describe, expect, it } from "vitest";
import { message, messages } from "./messages.js";
import { t } from "./text.js";

declare module "./messages.js" {
  interface Messages {
    "test.greeting": Record<never, never>;
    "test.count": { readonly count: number };
  }
}

messages.register("test.greeting", "Hello.", { source: "test" });
messages.register("test.count", ({ count }) => `${String(count)} left.`, { source: "test" });

afterEach(() => {
  messages.replace("test.greeting", "Hello.", { source: "test" });
  messages.replace("test.count", ({ count }) => `${String(count)} left.`, { source: "test" });
});

describe("the message table", () => {
  it("renders a library's messages, and a game's rewording of them", () => {
    expect(message("test.greeting")).toBe("Hello.");
    expect(message("test.count", { count: 3 })).toBe("3 left.");
    messages.replace("test.greeting", t`Ahoy.`, { source: "game" });
    messages.replace("test.count", ({ count }) => `${String(count)} doubloons remain.`);
    expect(message("test.greeting")).toBe("Ahoy.");
    expect(message("test.count", { count: 3 })).toBe("3 doubloons remain.");
    expect(messages.entries().find((e) => e.key === "test.greeting")?.source).toBe("game");
  });

  it("registers a package's messages once, however often it's loaded", () => {
    messages.register("test.greeting", "Hi again.", { source: "test" });
    expect(message("test.greeting")).toBe("Hello.");
  });

  it("keeps a game's rewording made before the library registers the message", () => {
    messages.replace("test.late" as "test.greeting", "Reworded early.", { source: "game" });
    messages.register("test.late" as "test.greeting", "The library's words.", { source: "lib" });
    expect(message("test.late" as "test.greeting")).toBe("Reworded early.");
  });

  it("explains a key nobody registered", () => {
    expect(() => message("nope" as "test.greeting")).toThrow(
      "message(\"nope\"): there's no such message. The library that uses it registers it when it's imported.",
    );
  });
});
