### Title

[mods] Document that each event allows only one matcher-less `on()` registration per plugin

### Body

**Summary**

`claude plugin validate` (and the loader) refuses a hooks module that registers the same event twice without a matcher, for **any** event — not just `session.start`. This rule is not mentioned in the `plugin-authoring` skill, `reference.md`, or the `On`/`Register` doc comments in `claude-code.d.ts`, so it only surfaces after a plugin has already been split into modules.

**Environment**

- Claude Code 2.1.296 (type declarations written by 2.1.295)
- Windows 11, plugin installed at user scope

**Repro**

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('turn.complete', ($, e, next) => next(e))
  on('turn.complete', ($, e, next) => next(e))
}
```

`claude plugin validate <dir>`:

```
✘ modules../register.ts: on("turn.complete") is registered twice without a matcher; the first is at ...register.ts:2; ...
```

The same happens for `session.start`, `session.measure`, `prompt.submit`, `tool.call`, `classic.SessionStart`, etc.
Registrations **with** a matcher may repeat, even with an identical matcher:

```ts
on('turn.complete', { reason: 'answer' }, ($, e, next) => next(e))
on('turn.complete', { reason: 'answer' }, ($, e, next) => next(e)) // accepted
```

**Why it matters**

A plugin built from several feature modules (one `register(on)` per feature, all wired from one hooks module because `hooks.json` takes a single `modules` path) naturally wants several modules to observe the same lifecycle events. Discovering this rule late forces a redesign (an event-ownership table, or artificial matchers such as `{ isInteractive: true }`, `{ reason: 'answer' }`, `{ origin: { kind: 'composer' } }`).

Events whose input has no literal discriminant (e.g. `session.measure`) cannot be shared at all, because there is no matcher to add.

**Suggestions**

1. Document the rule in `reference.md` / the skill's "A mod in one paragraph", and in the `On` doc comment.
2. Consider allowing repeated matcher-less registrations (they could chain in registration order, as matcher registrations already do), or provide a way to share events without a discriminant.
