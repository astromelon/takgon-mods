> 제출됨: https://github.com/anthropics/claude-code/issues/101451 (2026-10-12, 문서 이슈 양식으로 재구성)

### Title

[mods] Document that `$` and state atoms cannot cross module imports

### Body

**Summary**

The static scan behind `claude plugin validate` (and the loader) only follows `$` into functions declared at the top level of the **same file**, and only accepts `read`/`update` sources that are `atom(...)` consts declared in the **same file**. Passing `$` to an imported helper, or using an atom exported from another file, makes the whole hooks module fail to load. `reference.md` explains that a state reference needs literal `plugin`/`key`, but neither it, the `plugin-authoring` skill, nor the `claude-code.d.ts` doc comments say that `$` cannot be passed across imports or that the atom must be declared in the file that reads/updates it — so a plugin that factors shared helpers into `src/shared/*.ts` breaks at load time.

**Environment**

- Claude Code 2.1.296 (type declarations written by 2.1.295)
- Windows 11, plugin installed at user scope

_The error lines below are quoted from our plugin's validate output, with identifiers renamed to match each snippet and long tails elided (`...`)._

**Repro 1 — `$` passed to an imported function**

```ts
// shared/notify.ts
import type { EngineInterface } from 'claude-code'
export const toastOnce = async ($: EngineInterface, text: string) => { $.ui.toast(text) }

// register.ts
import { toastOnce } from './shared/notify'
export const register: Register = on => {
  on('session.start', async ($, e, next) => { await toastOnce($, 'hi'); return next(e) })
}
```

```
✘ ... `await toastOnce($, "hi");`: $ is passed to "toastOnce", imported from "./shared/notify": $ is followed only into a function declared in this same file, never across an import; ...
```

**Repro 2 — `$` passed to a local function that is not top-level**

```ts
export const register: Register = on => {
  const start = async ($: EngineInterface) => { await $.session.root() }
  on('session.start', async ($, e, next) => { await start($); return next(e) })
}
```

```
✘ ... `await start($);`: $ is passed to "start", which is not a function declared at the top of this file (a function declaration, or a const bound to one); $ is followed nowhere else; ...
```

**Repro 3 — atom imported from another file**

```ts
// shared/state.ts
import { atom } from 'claude-code'
export const langAtom = atom({ plugin: 'my-mod', key: 'lang' } as const, 'ko')

// register.ts
import { update } from 'claude-code'
import { langAtom } from './shared/state'
// ... await update($, langAtom, () => 'en')
```

```
✘ ... the state library's update takes a source the scan can read: a reference whose plugin and key are string literals, or what atom, memberOf or derive (imported from "claude-code") made of one, written there or in a const of this file, ...
```

Passing `on` to an imported function works, which makes the asymmetry harder to guess.

**Why it matters**

Shared helpers that need `$` (toast-once, output-folder setup, store-backed settings) have to be duplicated in every feature file, and shared state has to be re-declared with identical literals in each file that reads it. Knowing this up front changes how a multi-module plugin is laid out.

**Suggestions**

1. Document both rules (and that `on` may cross imports) in `reference.md` / the skill, ideally with the recommended layout: pure helpers in shared files, `$` calls and atoms in each feature file.
2. If feasible, let the scan follow `$` into imported top-level functions of the same plugin, and accept atoms exported from another file of the plugin.
