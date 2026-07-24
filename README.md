# TaskChain

A 100% front-end web app (HTML / CSS / JS, no dependencies, no build step) for tracking tasks that are **linked to one another**, with status cascading from parent tasks down to their children.

## Features

- **Tasks**: title, link, status (`Working`, `In Release Process`, `Released`, `Rework`), deadline, duration (business days), history (date + note), automatic ID (`T-1`, `T-2`, …).
- **Parent → child links**: a task can depend on one or more parent tasks (which must finish before it can start).
- **Status changes go through a dedicated modal**: every status change (drag-and-drop or the edit form) opens a small dialog to log a date-stamped reason and, if relevant, cascade the change to child tasks.
  - Moving a task **backward** (e.g. Released → Working/Rework) can cascade to all descendants, since their work may now be invalid.
  - Moving a task **to Released never cascades** — a parent finishing doesn't mean its children are automatically done too.
- **Release-order warning**: any task that is not yet Released while one of its descendants already is gets a dashed orange outline (Tree and Planning views) or a warning icon (List view and its own edit modal).
- **3 tabs**:
  - **List** — filterable/searchable table with inline editing. The "Depends on" column shows both the ID and the title of each parent (e.g. `T-1: Design`).
  - **Tree** — parent/child hierarchy, collapsible, color-coded by status.
  - **Planning** — Kanban board (drag a card to another status column) plus a schedule-aware timeline (Gantt) underneath.
- **Chain-aware scheduling ("retro-planning") built into the Planning tab**: a task doesn't need its own deadline to appear on the timeline. As long as *some* task further down its dependency chain has a deadline and a duration, every task in between gets a **calculated deadline** (dashed bar, shown in gray in the List/edit-modal). If a task's own deadline is later than what its descendants require, it's flagged as a conflict (red outline / warning icon).
- **Weekends are excluded** from every date calculation (durations, calculated deadlines, bar lengths).
- **Timeline controls**: zoom in/out buttons to change the day granularity (bars hide their inner text when they get too small), light vertical lines separating each week, and weekend columns lightly shaded.
- **JSON save/load**: export/import a `.json` file with the whole project. A local autosave (`localStorage`) also protects your work between sessions in the same browser.
- Clean, light, no-nonsense theme.

## Using it locally

Just open `index.html` in a browser — no install, no server needed.

## Deploying to GitHub Pages

1. Create a GitHub repository and push `index.html`, `style.css`, `app.js` (and this `README.md`) to the root (or a `docs/` folder).
2. In the repo: **Settings → Pages → Source**, pick the branch (e.g. `main`) and folder (`/root` or `/docs`).
3. Your app will be live at `https://<user>.github.io/<repo>/`.

## JSON file format

```json
{
  "meta": { "projectName": "My project", "lastModified": "2026-07-23T10:00:00.000Z" },
  "nextIdNum": 3,
  "tasks": [
    {
      "id": "T-1",
      "title": "Component design",
      "link": "https://example.com",
      "status": "working",
      "deadline": null,
      "duration": 5,
      "parents": [],
      "history": [{ "date": "2026-07-01", "note": "Task created" }]
    },
    {
      "id": "T-2",
      "title": "Component calculations",
      "status": "released",
      "deadline": "2026-08-05",
      "duration": 4,
      "parents": ["T-1"],
      "history": []
    }
  ]
}
```
In this example `T-2` has an explicit deadline; `T-1` has none, so the app automatically calculates one for it (business days only) from `T-2`'s deadline and duration.

## Possible next steps

- Firebase sync (replace `localStorage`/JSON import-export with Firestore).
- Dragging bars directly on the timeline to change dates.
- PDF export / print view of the planning.

## Design notes

- A **parent** task must finish before its **child** tasks can start (e.g. "Design" before "Calculations"). That's why a status change on a parent can ripple down to its children — except moving to Released, which only ever applies to the task itself.
- The scheduling engine uses this same relationship in reverse for calculated dates: for a child task to meet its deadline, its parent must finish by `child deadline − child duration` (in business days). This is computed recursively up the whole dependency chain, and is what powers the calculated (dashed) bars in the Planning timeline.
