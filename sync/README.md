# List Sync (Tasks Sync v2)

The main app's lists used to sync as whole arrays: every save sent the whole list, and every cloud
update replaced it. That lost a task added offline if the page was closed before it reconnected, wiped
changes made while signed out at the next sign-in, and let a stale tab erase new tasks or bring back
deleted ones. The Vault was fixed the same way in Vault Sync v2 (`capture/README.md`).

`tests/tasks-sync-browser.test.cjs` reproduces those losses against the old code and passes against this one.

## How a task is kept safe

| Step | Where |
|---|---|
| Any change: `saveTasks()` compares the `tasks` array with the store and records only what changed | `index.html` `saveTasks()`, `list-store.js` `commitList()` |
| Each change is written to its own key, `grind.tasks.pending.<task>~<n>`, before `saveTasks()` returns | `list-store.js` `commit()` |
| Any signed-in page sends all local records in one merging transaction | `planners/the-grind-scattabrain-2026/tasksSync/accounts/<uid>` |
| A pending key is removed only once the server holds every part of it at least as new | `list-store.js` `absorb()` |

Each task is one record, and **each part of a task** (name, status, due date, notes...) has its own
revision `[time, device]`. The later revision wins part by part, so a phone marking a task done offline
and a laptop renaming it both keep their change. A task's status and its Later return day are one
group and always travel together. A delete is a tombstone (`deleted` part) that keeps the task, so a
restore screen can be added later. Merging is order-free and idempotent.

**Automatic changes** (a Later task returning on its day, `normalizeLater()`) are stamped one step past
the revision they were computed from, so they never outrank a real edit made on another device.

## Compatibility with the old format

- The `tasks` array (cloud) and `grind.plan.v1` (local) are still written as a **mirror** of the live
  tasks, so the dashboard countdown, older tabs and JSON exports keep working.
- An incoming old array is merged as a **union**: it can add tasks, never delete one or bring a deleted
  one back. A stale tab that overwrote the mirror has it repaired.
- **Import JSON** merges: new tasks are added, a newer edit in the file wins part by part, and nothing
  the file lacks is deleted.
- **Upgrade rule:** a device's pre-upgrade list is shown until its first cloud snapshot, then the cloud
  copy wins once (as before). Anything touched after the upgrade is kept. With no cloud copy at all the
  local list is kept and sent. A device that never signs in keeps its own list.
- Edits and deletes made in a tab still running the old code do not stick. Reload every device after deploying.

## Files

| File | Role |
|---|---|
| `list-sync.js` | Records, per-part merge, diff, validation, old-format import (pure) |
| `list-store.js` | Local storage, pending changes, upgrade baseline, cloud sync |

Both are generic: notes, shopping and the other lists can follow with `ListStore.create({list:"notes", ...})`.

## Tests

```
node tests/list-sync.test.cjs
node tests/tasks-sync-browser.test.cjs
```

The browser tests need the `playwright` package (on `NODE_PATH` or installed locally) and a Chromium
browser (Edge by default, or `BROWSER_EXECUTABLE`), and use the fake Firebase in `tests/helpers/`.
