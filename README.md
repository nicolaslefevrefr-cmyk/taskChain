# TaskChain

A 100% front-end web app (HTML / CSS / JS, no dependencies, no build step) for tracking tasks that are **linked to one another**, with status cascading from parent tasks down to their children.

## Features

- **Multiple projects**: a collapsible sidebar on the left lists every project you're working on, in a fixed order that doesn't reshuffle when you switch between them. Create new ones, switch between them, rename, duplicate, or delete them, and export any single one as its own JSON file — all from the sidebar. Each project has its own independent set of tasks; nothing is shared between them except the workspace they live in.
- **Lock a project** (🔒/🔓 button on its sidebar row) to prevent accidentally editing it while you think you're on a different one. A locked project can still be viewed and switched to, but every mutating action is blocked — creating/editing/deleting tasks, changing statuses, dragging cards or tree boxes, category edits, renaming or deleting the project itself. Unlock it the same way to resume editing.
- **Categories**: a dedicated "Category" tab lets you build a classic collapsible tree of categories (create, rename, delete, and drag one onto another to nest it — or onto the empty background to move it back to the top level). Assign a task to one or more categories from its edit window, and when picking a task's **parent tasks**, the list is grouped into that same collapsible category tree instead of one long flat list — much easier to navigate once a project has a hundred-plus tasks. This is purely an organizational aid: categories don't feed the scheduling engine or any cascade logic.
- **Tasks**: title, link, status, deadline, duration (business days), history (date + note), automatic ID (`T-1`, `T-2`, …).
- **Customizable statuses, shared across your whole workspace**: the "⚙ Statuses" button lets you add, rename, recolor, reorder, or delete statuses — they apply to every project. New workspaces start with six defaults: `Not Started`, `Working`, `Done`, `In Release Process`, `Released`, `Rework`, each with its own color. Deleting a status that's still in use moves those tasks to the next one, after asking you to confirm. (Existing workspaces keep whatever statuses they already have — this default set only applies to brand-new ones.)
- **Status changes always go through one simple dialog**: moving a task to any status (via drag-and-drop or the edit form) opens a small dialog to log a date-stamped reason and — if that task has children — asks whether to also apply the change to them. That checkbox starts **unchecked every time**; there's no special-casing of any particular status. If you do propagate, the same reason is copied into every affected child's history.
- **Clear a task's history** with one button in its edit window — removes every entry except the original creation one, after confirming.
- **4 tabs**:
  - **List** — filterable/searchable table with inline editing. Click any of the ID/Title/Status/Deadline/Duration column headers to sort by it (click again to flip ascending/descending — the arrow shows the current sort). The Category column shows the task's assigned categories.
  - **Tree** — a real node-link diagram: every task is a box, drawn exactly once, with an arrow from each of its parents to it (so a task with several parents just gets several incoming arrows — nothing is duplicated). Drag any box to reposition it — connected arrows follow in real time, arrowheads included, and the position is saved automatically (double-click a box to snap it back to the automatic layout, or use "Reset layout" to clear all of them at once). Zoom in/out buttons and a "Fit" button are provided; the automatic layout uses a simple layered arrangement (a task always sits below every parent that feeds into it) with a couple of passes to reduce crossing lines — no physics/force simulation.
  - **Planning** — Kanban board (drag a card to another status column) plus a schedule-aware timeline (Gantt) underneath. Each Kanban column can be individually collapsed to a narrow strip (handy once you have several statuses) — a collapsed column still accepts a dropped card. The board scrolls horizontally instead of overflowing if there isn't room for every column at once, and it and the timeline both get more breathing room when the sidebar is collapsed.
  - **Category** — the collapsible category tree described above.
- **Chain-aware scheduling ("retro-planning") built into the Planning tab**: a task doesn't need its own deadline to appear on the timeline. Dates propagate through the whole dependency graph in **both directions**, repeatedly, until nothing changes — a task with children but no deadline of its own gets one calculated backward from them, and a task with no deadline or children of its own can still get scheduled *forward* the moment one of its parents becomes known. Solving one task's date this way can be exactly what unlocks a sibling or a task further along the chain, so the app re-passes over the whole project until it reaches a fixed point instead of computing everything in one shot. Calculated dates show as dashed bars on the timeline and in gray in the List/edit-modal. If a task's own deadline is later than what its descendants require, it's flagged as a conflict (red outline / warning icon).
- **Weekends are excluded** from every date calculation (durations, calculated deadlines, bar lengths), and a bar that spans a weekend is visually **split in two** (with a thin connector) rather than drawn as one continuous rectangle, so the pause is obvious at a glance.
- **Timeline controls**: zoom in/out buttons to change the day granularity (bars hide their inner text when they get too small), light vertical lines separating each week, and weekend columns lightly shaded.
- **JSON save/load**: "Export JSON" in the header saves your **whole workspace** (every project) as one `.json` file; "Load JSON" accepts either that same whole-workspace format (replaces everything, with a confirmation) or a single project's file (added alongside your existing projects, nothing is overwritten). Each sidebar project also has its own "⬇" icon to export just that one project. A local autosave (`localStorage`) also protects your work between sessions in the same browser.
- **Firebase sync** (optional): the "☁ Firebase" button opens a modal to save/load your **whole workspace** (every project) to/from your own Firebase project (Firestore), as one document. Once you've connected once, the "💾 Save" button next to it saves instantly using that same connection — no need to reopen the modal each time. See [Setting up Firebase](#setting-up-firebase) below.
- A small version badge next to the app name (e.g. `v1.5`) is bumped on each round of changes, so you can tell builds apart at a glance.
- Clean, light, no-nonsense theme.

## Using it locally

Just open `index.html` in a browser — no install, no server needed.

## Deploying to GitHub Pages

1. Create a GitHub repository and push `index.html`, `style.css`, `app.js` (and this `README.md`) to the root (or a `docs/` folder).
2. In the repo: **Settings → Pages → Source**, pick the branch (e.g. `main`) and folder (`/root` or `/docs`).
3. Your app will be live at `https://<user>.github.io/<repo>/`.

## JSON file format

A **whole-workspace** export (from the header's "Export JSON") looks like:
```json
{
  "activeProjectId": "p1a2b3c4",
  "projects": [
    {
      "id": "p1a2b3c4",
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
  ]
}
```
A **single-project** export (from a project's "⬇" icon in the sidebar) is just one entry from that `projects` array on its own (with `id`, `meta`, `nextIdNum`, `tasks`) — this is also the older format used before multi-project support, so old exports still import fine (as a new project added to your workspace).

In the example above `T-2` has an explicit deadline; `T-1` has none, so the app automatically calculates one for it (business days only) from `T-2`'s deadline and duration.

## Setting up Firebase

The app can save/load its whole JSON project to a Firestore document in your own Firebase project. The Firebase SDK is only loaded (from Google's CDN) the first time you open the "☁ Firebase" modal — projects that never use it pay no extra cost.

**1. Create a Firebase project**
Go to [console.firebase.google.com](https://console.firebase.google.com), click **Add project**, and follow the steps (Google Analytics is not needed).

**2. Register a Web app**
In the project overview, click the **`</>`** (Web) icon to register a new web app. Firebase will show you a config object that looks like:
```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "my-project.firebaseapp.com",
  projectId: "my-project",
  storageBucket: "my-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```
Copy these six values into the matching fields of the "☁ Firebase" modal in the app.

**3. Enable Firestore**
In the console sidebar: **Build → Firestore Database → Create database**. Any region is fine; start in **production mode** (we'll set rules below).

**4. Enable Anonymous Authentication**
In the console sidebar: **Build → Authentication → Sign-in method → Add new provider → Anonymous → Enable**. The app signs each visitor in anonymously behind the scenes (no login screen) purely so your Firestore rules can require `request.auth != null`.

**5. Set Firestore security rules**
In **Firestore Database → Rules**, use something like:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /taskchain_projects/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```
Then click **Publish**.

**6. Pick a document name**
In the app's Firebase modal, the "Document name" field is the ID of the Firestore document your **whole workspace** (every project) is stored under (inside the `taskchain_projects` collection). Anyone with your Firebase config *and* this exact document name can read/write that document, so pick something unlikely to be guessed (e.g. `acme-widget-plan-8k2`) rather than something short like `project1`.

**A note on security**: a Firebase web config (the six values above) is not a secret the way an API key on a server would be — it's normal for it to be visible in a public site's source, and Google's own docs say so. Real access control comes from the security rules in step 5. The rule above lets *any* anonymously-authenticated visitor read/write *any* document in `taskchain_projects`, which combined with a hard-to-guess document name is reasonable for personal or small-team use, but is not equivalent to a real login system. If you need stronger guarantees (e.g. only specific people can access a given project), you would need to replace anonymous sign-in with real user accounts and rules keyed to `request.auth.uid` — that's outside the scope of this simple version.

## Possible next steps

- Firebase sync (replace `localStorage`/JSON import-export with Firestore).
- Dragging bars directly on the timeline to change dates.
- PDF export / print view of the planning.

## Design notes

- A **parent** task must finish before its **child** tasks can start (e.g. "Design" before "Calculations"). That's why any status change on a parent — moving forward, backward, to any status — offers to cascade to its children; the choice is always yours, and the checkbox always starts unchecked.
- The scheduling engine uses this same relationship in reverse for calculated dates: for a child task to meet its deadline, its parent must finish by `child deadline − child duration` (in business days). This is computed recursively up the whole dependency chain, and is what powers the calculated (dashed) bars in the Planning timeline.
