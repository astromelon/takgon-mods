> 제출됨: https://github.com/anthropics/claude-code/issues/101453 (2026-10-12, 버그 양식으로 재구성)

### Title

[mods] After a hook throws, `.catch`'s `next(e)` resumes at the next plugin and skips the failing plugin's remaining hooks

### Body

**Summary**

When a plugin registers several hooks on the same event and one of them throws **before** calling `next`, its `.catch(($, e, next) => next(e))` handler does continue the chain — but from the **next plugin**. The failing plugin's own later hooks for that event never run. Other plugins and the engine run normally.

The `.catch` documentation (reference.md, "Run with `claude --debug`…") explains `next.called` and that `next(e)` replays a settled call, but does not say which hooks `next(e)` reaches when the hook failed before `next`. Reading it, we expected the chain to continue with the failing plugin's next hook.

**Environment**

- Claude Code 2.1.296 (type declarations written by 2.1.295)
- Windows 11; reproduced in a real session (`claude -p --plugin-dir`) and in `claude plugin test`

**Repro (two throwaway plugins, slash command only — no model call)**

```ts
// plugin "catch-probe"
on('session.start', async ($, e, next) => {
  await $.command.register({ name: 'probe2', description: 'probe' })
  return next(e)
})
on('command.run', async ($, e, next) => {             // outer: throws before next when args === 'boom'
  $.ui.log(`OUTER ran args=${e.args}`)
  if (e.args === 'boom') throw new Error('outer boom')
  return next(e)
}).catch(($, e, next) => {
  $.ui.log(`CATCH ran called=${String(next.called)}`)
  return next(e)
})
on('command.run', { command: 'probe2' }, async ($, e) => { // inner: same plugin, answers the command
  $.ui.log(`INNER ran args=${e.args}`)
  return { text: `PROBE2 OK args=${e.args}` }
})

// plugin "catch-probe-b" (a different plugin)
on('command.run', async ($, e, next) => {
  $.ui.log(`B ran args=${e.args}`)
  const result = await next(e)
  $.ui.log(`B after next trace=${next.trace.map(t => `${t.plugin}:${t.outcome}`).join(',')}`)
  return result
}).catch(($, e, next) => next(e))
```

```bash
claude -p "/probe2 boom" --plugin-dir catch-probe --plugin-dir catch-probe-b --debug-file log
```

**Observed**

Control, `/probe2` → output `PROBE2 OK args=`; log `OUTER ran` → `INNER ran` → `catch-probe (user) answered command.run without next() ...; nothing beneath it ran`.

`/probe2 boom` → output:

```
catch-probe registered /probe2 but no command.run hook answered it: add on("command.run", { command: "probe2" }, ...) to the plugin.
```

Debug log:

```
[catch-probe] $.ui.log: OUTER ran args=boom
[catch-probe] $.ui.log: CATCH ran called=false
[catch-probe-b] $.ui.log: B ran args=boom beneath=0
[catch-probe-b] $.ui.log: B after next trace=<another installed plugin>:returned,engine:returned
[WARN] hook failed closed: catch-probe: errorKind=Error errorChars=10 (command.run; its .catch answered)
```

`INNER ran` never appears.

**Expected**

Either `next(e)` from the handler continues with the failing plugin's next hook for the event (catch-probe's `command.run {command:'probe2'}`), or the documentation states that the rest of the failing plugin's hooks are skipped.

**Impact**

`hooks.json` takes a single hooks module, so a plugin made of several features naturally registers several hooks per event (one per feature). With the current behavior, an optional feature's failure removes unrelated features of the same plugin:

- a failed model call in one `prompt.submit` hook dropped the `context` other features of the same plugin attach to the prompt;
- a refused `$.command.register` in one `session.start` hook prevented every later feature's commands from registering (users saw `Unknown command`) — see the related draft on command-name conflicts with skills.

The only workaround is to make sure a hook never throws (wrap every external call in try/catch inside the hook), which defeats the purpose of `.catch`.

**Suggestions**

1. Resume at the failing hook's next sibling in the same plugin when its handler calls `next(e)`, or
2. if the current behavior is intended, document it next to `.catch` (and in the `Hook`/`On` doc comments), and consider a validate note for plugins that register several hooks on one event.
3. Include the error message (or its start) in the `hook failed closed` debug line; today only `errorChars=` is logged, which made this hard to diagnose.
