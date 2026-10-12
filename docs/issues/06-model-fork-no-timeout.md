> 제출됨: https://github.com/anthropics/claude-code/issues/101446 (2026-10-12, 기능 요청 양식으로 재구성)

### Title

[mods] `$.model.fork` has no `timeoutMs` (or `maxTokens`), unlike `$.model.complete`

### Body

**Summary**

`$.model.complete` lets a hook bound the call (`timeoutMs`, `maxTokens` on `ModelCompleteRequest`). `$.model.fork` takes only `{ prompt }` (`ModelForkRequest`), so a plugin cannot put an upper bound on a fork's duration or size. Because a hook's budget does not count time spent awaiting `$` calls, a hook that awaits a fork is held for as long as the fork runs.

**Environment**

- Claude Code 2.1.296 (type declarations written by 2.1.295)

**Evidence (type declarations)**

```ts
export type ModelForkRequest = {
  /** The one user message, appended to the session's own transcript ... */
  prompt: string
}
```

`ModelCompleteRequest`, by contrast, documents `timeoutMs` as *"how a hook bounds the completion itself, by the clock"*, e.g. `await $.model.complete({ model: "haiku", prompt, timeoutMs: 8000 })`.

**Where it matters**

The natural place to use a fork is `turn.complete` — e.g. "suggest next steps" or "write a handoff note when context passes N%", both of which need the session's transcript and benefit from the prompt cache. Awaiting the fork inside `turn.complete` keeps that dispatch open for the fork's full duration, with no way to cap it:

```ts
on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
  const result = await next(e)
  const reply = await $.model.fork({ prompt: 'List up to 3 next steps as JSON' }) // unbounded
  // ...
  return result
})
```

The only abort today is the turn being interrupted (`aborted`), which a plugin does not control.

**Workaround we use**

Detach the fork with `$.clock.after(0, async () => { ... })` so `turn.complete` returns immediately, and allow one fork at a time with a module-level flag. This avoids holding the dispatch, but still cannot stop a fork that runs long or produces a long reply.

**Suggestions**

1. Add `timeoutMs` (and ideally `maxTokens`) to `ModelForkRequest`, with the same `aborted` result `$.model.complete` uses when the time elapses.
2. Alternatively accept an `AbortSignal` so a plugin can cancel a fork it started from a timer.
