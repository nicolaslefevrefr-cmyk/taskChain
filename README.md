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
  - **Tree** — a real node-link diagram: every task is a box, drawn exactly once, with an arrow from each of its parents to it (so a task with several parents just gets several incoming arrows — nothing is duplicated). Zoom in/out buttons and a "Fit" button are provided; the layout uses a simple layered arrangement (a task always sits below every parent that feeds into it) with a couple of passes to reduce crossing lines — no physics/force simulation.
  - **Planning** — Kanban board (drag a card to another status column) plus a schedule-aware timeline (Gantt) underneath.
- **Chain-aware scheduling ("retro-planning") built into the Planning tab**: a task doesn't need its own deadline to appear on the timeline. Dates propagate through the whole dependency graph in **both directions**, repeatedly, until nothing changes — a task with children but no deadline of its own gets one calculated backward from them, and a task with no deadline or children of its own can still get scheduled *forward* the moment one of its parents becomes known. Solving one task's date this way can be exactly what unlocks a sibling or a task further along the chain, so the app re-passes over the whole project until it reaches a fixed point instead of computing everything in one shot. Calculated dates show as dashed bars on the timeline and in gray in the List/edit-modal. If a task's own deadline is later than what its descendants require, it's flagged as a conflict (red outline / warning icon).
- **Weekends are excluded** from every date calculation (durations, calculated deadlines, bar lengths), and a bar that spans a weekend is visually **split in two** (with a thin connector) rather than drawn as one continuous rectangle, so the pause is obvious at a glance.
- **Timeline controls**: zoom in/out buttons to change the day granularity (bars hide their inner text when they get too small), light vertical lines separating each week, and weekend columns lightly shaded.
- **JSON save/load**: export/import a `.json` file with the whole project. A local autosave (`localStorage`) also protects your work between sessions in the same browser.
- **Firebase sync** (optional): the "☁ Firebase" button opens a modal to save/load the whole project as JSON to/from your own Firebase project (Firestore). See [Setting up Firebase](#setting-up-firebase) below.
- A small version badge next to the app name (e.g. `v1.2`) is bumped on each round of changes, so you can tell builds apart at a glance.
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
In the app's Firebase modal, the "Document name" field is the ID of the Firestore document your project is stored under (inside the `taskchain_projects` collection). Anyone with your Firebase config *and* this exact document name can read/write that document, so pick something unlikely to be guessed (e.g. `acme-widget-plan-8k2`) rather than something short like `project1`.

**A note on security**: a Firebase web config (the six values above) is not a secret the way an API key on a server would be — it's normal for it to be visible in a public site's source, and Google's own docs say so. Real access control comes from the security rules in step 5. The rule above lets *any* anonymously-authenticated visitor read/write *any* document in `taskchain_projects`, which combined with a hard-to-guess document name is reasonable for personal or small-team use, but is not equivalent to a real login system. If you need stronger guarantees (e.g. only specific people can access a given project), you would need to replace anonymous sign-in with real user accounts and rules keyed to `request.auth.uid` — that's outside the scope of this simple version.

## Possible next steps

- Firebase sync (replace `localStorage`/JSON import-export with Firestore).
- Dragging bars directly on the timeline to change dates.
- PDF export / print view of the planning.

## Design notes

- A **parent** task must finish before its **child** tasks can start (e.g. "Design" before "Calculations"). That's why a status change on a parent can ripple down to its children — except moving to Released, which only ever applies to the task itself.
- The scheduling engine uses this same relationship in reverse for calculated dates: for a child task to meet its deadline, its parent must finish by `child deadline − child duration` (in business days). This is computed recursively up the whole dependency chain, and is what powers the calculated (dashed) bars in the Planning timeline.
