# 2. Frontend files are PascalCase for components and camelCase for everything else

Accepted 2026-08-28.

## Decision

Within `frontend-new/app/src`:

| Location | Name | Example |
|---|---|---|
| `components/`, `features/` | `PascalCase.tsx`, matching the exported component | `UtxoFlowCanvas.tsx` |
| `lib/` | `camelCase.ts` | `statusRegistry.ts` |
| `app/` | whatever the router requires | `page.tsx`, `loading.tsx`, `route.ts` |

The router owns the third row. Those names are not a style choice and are not
subject to this rule.

## How it applies

**New files follow it immediately.** A file added after this record is named
this way, and a review that finds otherwise asks for the rename.

**Existing files convert when they are edited for another reason.** A rename
that rides along with a real change is free to review. A rename on its own is
not: it touches every import site, and a large one buries the changes a reader
of the history is trying to find.

Nothing renames purely to satisfy this record.

## Where the tree stands

Counted 2026-08-28, so drift is measurable rather than argued:

| Directory | Files | Convention |
|---|---:|---|
| `components/ui/` | 38 | all flat-lowercase, internally consistent |
| `components/shell/` | 6 | all PascalCase, already correct |
| `features/` | 12 | 8 PascalCase, 4 flat-lowercase |
| `lib/` | 29 | 18 flat-lowercase, 9 camelCase, 2 kebab-case |

`components/ui/` is the largest gap and the last that should move, because 38
renames in one commit is exactly the change this record declines to make.

Files whose names already read correctly under the rule need no action:
`format.ts`, `search.ts` and `api.ts` are single words, so flat-lowercase and
camelCase are the same string.

## Why not enforce it now

A lint rule that fails on the current tree fails 60 times on the first run, and
a rule nobody can satisfy gets disabled. The rule becomes enforceable once the
gap is small, and this record is what makes the gap shrink instead of grow.

## Why this convention

The component file and the component it exports carry the same name, so a
symbol in a stack trace or an import list points at a filename without
translation. Everything else is lower-camel because that is what the modules in
`lib/` already export.
