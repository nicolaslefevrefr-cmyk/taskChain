# TaskChain

Application web 100% front-end (HTML / CSS / JS, sans dépendance ni build) pour suivre des tâches **liées entre elles**, avec propagation de statut des tâches parentes vers leurs tâches enfant.

## Fonctionnalités

- **Tâches** : titre, lien, statut (`Working`, `In Release Process`, `Released`, `Rework`), deadline, durée (jours), historique (date + note), ID automatique (`T-1`, `T-2`, …).
- **Liens parent → enfant** : une tâche peut dépendre d'une ou plusieurs tâches parentes (qui doivent être terminées avant elle). Changer le statut d'une tâche parente propose de **propager** le nouveau statut à toute la descendance (avec traçabilité dans l'historique).
- **4 onglets** :
  - **Liste** : tableau filtrable / recherchable, édition rapide.
  - **Arbre** : hiérarchie parent/enfant, pliable/dépliable, code couleur par statut.
  - **Planning** : tableau Kanban (glisser-déposer entre statuts, avec propagation aux enfants) + chronologie type Gantt calculée à partir de `deadline − durée`.
  - **Rétroplanning** : calcule, pour chaque tâche, la date de fin **requise** pour que toute la chaîne de tâches en aval respecte ses propres deadlines, et signale les conflits (deadline trop tardive).
- **Sauvegarde JSON** : export / import d'un fichier `.json` contenant tout le projet. Une sauvegarde automatique locale (`localStorage`) évite aussi de perdre son travail entre deux sessions du même navigateur.
- Thème clair, sobre, sans effets inutiles.

## Utilisation en local

Ouvrez simplement `index.html` dans un navigateur — aucune installation, aucun serveur requis.

## Déploiement sur GitHub Pages

1. Créez un dépôt GitHub et poussez les fichiers `index.html`, `style.css`, `app.js` (et ce `README.md`) à la racine (ou dans un dossier `docs/`).
2. Dans le dépôt : **Settings → Pages → Source**, choisissez la branche (ex. `main`) et le dossier (`/root` ou `/docs`).
3. Votre application sera disponible à `https://<utilisateur>.github.io/<depot>/`.

## Format du fichier JSON

```json
{
  "meta": { "projectName": "Mon projet", "lastModified": "2026-07-23T10:00:00.000Z" },
  "nextIdNum": 3,
  "tasks": [
    {
      "id": "T-1",
      "title": "Design du composant",
      "link": "https://example.com",
      "status": "released",
      "deadline": "2026-08-01",
      "duration": 5,
      "parents": [],
      "history": [{ "date": "2026-07-01", "note": "Création de la tâche" }]
    },
    {
      "id": "T-2",
      "title": "Calcul du composant",
      "status": "released",
      "deadline": "2026-08-05",
      "duration": 4,
      "parents": ["T-1"],
      "history": []
    }
  ]
}
```

## Prochaines étapes possibles

- Synchronisation Firebase (remplacer `localStorage`/import-export par Firestore).
- Édition de la position temporelle par glisser-déposer directement dans la chronologie.
- Export PDF / impression du planning.

## Notes de conception

- Une tâche **parente** doit être terminée avant ses tâches **enfant** (ex. « Design » avant « Calcul »). C'est pourquoi un changement de statut sur la tâche parente peut se répercuter sur ses enfants.
- Le rétroplanning utilise cette même relation en sens inverse : pour qu'une tâche enfant tienne sa deadline, sa tâche parente doit finir au plus tard `deadline_enfant − durée_enfant`. Ce calcul remonte récursivement toute la chaîne de dépendances.
