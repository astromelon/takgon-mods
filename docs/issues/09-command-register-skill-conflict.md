### Title

[mods] `$.command.register` is refused when a user/project skill has the same name — undocumented, and it can silently disable unrelated parts of a plugin

### Body

**Summary**

`$.command.register({ name })` is refused when the person already has a **skill** (or command) with that name — e.g. `~/.claude/skills/handoff/` or a project's `.claude/skills/browse/`. The `command.register` doc comment only says *"a built-in's name is refused"*, so a plugin author has no way to anticipate this, and `claude plugin validate` cannot catch it because it depends on each installer's personal skills.

Combined with how `.catch` resumes the chain (see "Why it cascades" below), one refused name made **every later `session.start` hook of the same plugin** be skipped, so commands from unrelated modules of the plugin were never registered. The person only saw `Unknown command: /browse`.

**Environment**

- Claude Code 2.1.296 (type declarations written by 2.1.295)
- Windows 11, plugin installed at user scope, interactive session

**Repro**

1. Have a user skill named `handoff` (`~/.claude/skills/handoff/SKILL.md`), or a project skill `.claude/skills/browse/SKILL.md`.
2. A plugin that registers several commands, one hook per feature module, all in one hooks module:

   ```ts
   on('session.start', { isInteractive: true }, async ($, e, next) => {
     await $.command.register({ name: 'handoff', description: '...' }) // refused
     return next(e)
   }).catch(($, e, next) => next(e))

   on('session.start', { isInteractive: true }, async ($, e, next) => {
     await $.command.register({ name: 'browse', description: '...' }) // never runs
     return next(e)
   })
   ```

3. Start an interactive session and type `/browse`.

**Observed**

- `/browse` → `Unknown command: /browse`.
- Debug log: commands registered before the failing hook are `listed`, then only

  ```
  [WARN] hook failed closed: <plugin>: errorKind=HooksError errorChars=78 (session.start; its .catch answered)
  ```

  The log gives the error's *length*, not its text, so the cause is invisible without instrumenting the `.catch` handler.
- Logging `next.error.message` from the `.catch` handler revealed:

  ```
  $.command.register: "/handoff" refused: it is the user's /handoff
  ```

- With a **project** skill named `browse`, the reason still reads `it is the user's /browse`.
- In one earlier interactive session with the same user skill present, `/handoff` *was* registered and answered by the plugin. We could not determine what makes the refusal conditional (load order?).

**Why it cascades**

When a hook throws before calling `next` and its `.catch` answers `next(e)`, the chain resumes at the **next plugin**, skipping the remaining hooks of the failing plugin for that event. Reproduced with two throwaway plugins via `claude -p --plugin-dir`: the failing plugin's inner `command.run` hook never ran, while another plugin's hook and the engine did. (Filed separately: "After a hook throws, `.catch`'s `next(e)` resumes at the next plugin…".) So one refused name in a "module A" hook removes modules B, C, D of the same plugin.

**Expected**

- The refusal rule documented on `command.register` / `CommandSpec`: names of the person's (and project's) commands and skills are refused, not only built-ins.
- A refusal that a plugin author can see without instrumentation.

**Suggestions**

1. Document that user/project commands **and skills** take precedence and cause `command.register` to reject, and quote the rejection message format.
2. Include at least the start of the error message in the `hook failed closed` debug line (today only `errorChars=` is logged).
3. Make the refusal reason say where the conflicting name comes from (user vs project skill/command).
4. Optionally surface refused plugin commands to the person (e.g. a one-line notice), since they lose a command they installed.

**Workaround we use**

Wrap every `$.command.register` so a refusal never throws out of the hook, and show one toast per refused name with the engine's reason; renamed the colliding command (`/handoff` → `/tk-handoff`).
