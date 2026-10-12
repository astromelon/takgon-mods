> 제출됨: https://github.com/anthropics/claude-code/issues/101447 (2026-10-12, 문서 이슈 양식으로 재구성)

### Title

[mods] Document how test hooks must answer for the engine in `claude-code/testing` (op results, refusals, required answers)

### Body

**Summary**

In `claude plugin test`, the test's `on` hooks sit beneath the plugin and stand for the engine. Writing them correctly requires several conventions that are not documented in `claude-code/testing`'s typings or the skill's reference; we found each by trial and error. Two of them make failures look like something else entirely, which is costly to debug.

**Environment**

- Claude Code 2.1.296 (type declarations written by 2.1.295)

**Conventions we had to discover**

1. **Op hooks must return `{ value }`.** A hook standing in for a `$.x.y` call (e.g. `session.root`) that returns the bare value fails with `returned something that is not a result object`.

   ```ts
   on('session.root', () => 'C:/proj')              // fails: not a result object
   on('session.root', () => ({ value: 'C:/proj' })) // works
   ```

2. **Engine refusals must be answered with `{ deny }`, not `throw`.** If the test hook throws to simulate a refusal, the kit treats the hook as *skipped*, and the plugin's call rejects with `no implementation for <op>` instead of the intended reason:

   ```ts
   // plugin receives "no implementation for command.register"
   on('command.register', ($, e) => { throw new Error(`"/${e.name}" refused: ...`) })
   // plugin's $.command.register rejects with this reason, as in a real session
   on('command.register', ($, e) => ({ deny: `"/${e.name}" refused: it is the user's /${e.name}` }))
   ```

   This hid a real-session bug from our tests until we switched to `deny`.

3. **Some engine answers are required, and missing ones fail silently.** `session.start`, `session.root`, `command.register` (and `classic.*` events the plugin hooks) need a test hook. Without one, the plugin's initialization hook is skipped and the test only fails later, far from the cause.

4. **The test `$` has no `store` noun.** State must be seeded with `mock.store(on, entries)` and checked through behavior; `$.store.get` in a test is `undefined`.

5. **`$.command.run` takes the full input** (`origin`, `presentation`), not the `CommandRunArgs` shape a plugin's `$.command.run` takes.

6. **`$.ui.ask` is mocked through `tool.call { tool: 'AskUserQuestion' }`**, with the answer shape of that tool's result.

**Suggestions**

1. Add an "answering for the engine" section to `claude-code/testing`'s docs covering the points above, especially `{ value }` for ops and `{ deny }` vs `throw` for refusals.
2. When a test hook throws, consider reporting it as an error in the test rather than as a skipped hook that surfaces as `no implementation`.
3. Consider helpers for the common answers (`mock.session(on, { root })`, `mock.commands(on, { refuse })`), similar to `mock.store` / `mock.env` / `mock.clock`.
