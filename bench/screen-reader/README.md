# Screen reader check

Drives the real VoiceOver on macOS with [Guidepup](https://www.guidepup.dev/) and prints what it says, so the page's screen-reader behaviour can be checked without someone listening ([ADR 0080](../../docs/decisions/0080-screen-reader-focus-and-links.md), #352).

This folder isn't a workspace package. It has its own `package-lock.json`, so nothing here becomes a project dependency.

```sh
cd bench/screen-reader
npm ci
npm run setup                     # once per Mac: lets VoiceOver be controlled by AppleScript
npx guidepup install              # once: downloads Guidepup's VoiceOver preferences
node listen.mjs <url> <step>...   # see listen.mjs for the steps
```

For example, to activate a control and hear what follows:

```sh
node listen.mjs "http://localhost:5173/" "control:Continue" act wait:3000 say
```

**Permissions.** Guidepup swaps VoiceOver's preferences while it runs, in `~/Library/Group Containers/group.com.apple.VoiceOver`. On recent macOS, that needs Full Disk Access for the terminal that runs it (System Settings, Privacy & Security). Without it, starting fails with `EPERM`. It's a broad permission, so grant it only where you mean to run this, and remove it after.

While it runs, VoiceOver speaks and Safari takes the keyboard: leave the Mac alone.
