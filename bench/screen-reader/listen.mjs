// Drives the real VoiceOver with Guidepup, in Safari, and prints what it
// says, so the page's screen-reader behaviour can be checked by ear without
// a person listening (#352).
//
//   node listen.mjs <url> <step>...
//
// Steps, in order:
//   control:<text>  move to the next control whose spoken name includes <text>
//   link:<text>     move to the next link whose spoken name includes <text>
//   act             activate it, as Control+Option+Space does
//   wait:<ms>       wait, so announcements after a change are heard
//   say             print what VoiceOver has said since the last `say`
//
// While it runs, it uses VoiceOver and the keyboard: leave the Mac alone.
import { execFileSync } from "node:child_process";
import { voiceOver } from "@guidepup/guidepup";

const [url, ...steps] = process.argv.slice(2);
if (!url) {
  console.error("Usage: node listen.mjs <url> <step>...");
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Moves with `command` until VoiceOver says something including `text`, up to 60 times. */
async function moveTo(command, text) {
  for (let i = 0; i < 60; i++) {
    await voiceOver.perform(command);
    const said = await voiceOver.lastSpokenPhrase();
    if (said.includes(text)) return said;
  }
  throw new Error(`VoiceOver never reached "${text}".`);
}

execFileSync("open", ["-a", "Safari", url]);
await sleep(3000);
await voiceOver.start();
try {
  await sleep(1500);
  await voiceOver.clearSpokenPhraseLog();
  for (const step of steps) {
    const [kind, ...rest] = step.split(":");
    const arg = rest.join(":");
    if (kind === "control") await moveTo(voiceOver.keyboardCommands.findNextControl, arg);
    else if (kind === "link") await moveTo(voiceOver.keyboardCommands.findNextLink, arg);
    else if (kind === "act") await voiceOver.act();
    else if (kind === "wait") await sleep(Number(arg));
    else if (kind === "say") {
      console.log(`--- ${step}`);
      for (const phrase of await voiceOver.spokenPhraseLog()) console.log(phrase);
      await voiceOver.clearSpokenPhraseLog();
    } else throw new Error(`Unknown step "${step}".`);
  }
} finally {
  await voiceOver.stop();
}
