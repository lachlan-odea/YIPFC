# Pod Pool

A small installable web app (PWA) for a Commander pod. Everyone adds the spare
cards they are happy to lend, and anyone in the pod can search the pile and ask
to borrow one. Add cards by pointing your phone camera at them, by searching
Scryfall, or by pasting a list exported from Moxfield, Archidekt and friends.

## Run it locally

```sh
npm install
npm run dev
```

Open the printed URL on your laptop. To try the camera from your phone on the
same Wi-Fi, use the `Network:` URL. Browsers only allow the camera on `https://`
or `localhost`, so for phone testing either deploy (below) or run
`npm run dev -- --https` with a local certificate.

Until you connect Firebase, the app runs in **this device only** mode: cards and
loans live in that browser's storage. Everything works, nothing is shared.

## Share it with your pod (Firebase)

1. Create a free project at <https://console.firebase.google.com>. Google
   Analytics is not needed; turn it off when asked.
2. In the left menu open **Build, Firestore Database** and click **Create
   database**. Pick a region near your pod and start in **production mode**.
3. Open the **Rules** tab, replace the contents with
   [`firestore.rules`](firestore.rules) from this repo, and publish. (Or, with
   Node installed, run `npx firebase login` then
   `npx firebase deploy --only firestore:rules --project <your-project-id>`.)
4. Back at **Project Overview**, click the `</>` web icon to register a web
   app. Skip Firebase Hosting. It shows a `firebaseConfig` block; you need
   `apiKey`, `projectId` and `appId`.
5. Copy `.env.example` to `.env` and paste those three values in.
6. Rebuild and deploy. Each person opens the URL, types their name once, and
   installs it to their home screen.

The web config values are public by design; Firestore access is controlled by
the rules file, not by keeping them secret. The rules deliberately let anyone
using the app read and write, which is fine for a group of friends who share
one URL. If you ever want to lock it down, enable Anonymous sign-in under
**Authentication** and change `isPod()` in `firestore.rules` to
`request.auth != null`.

Firestore pushes changes live, so when one person adds a card or marks
something lent, the other phones update within a second. The app also keeps a
local copy, so the pool still opens with no signal and any changes made offline
sync when the phone is back online.

The free Spark plan allows 50,000 reads and 20,000 writes a day, which is far
more than a pod will use.

### Data layout

Three collections, matching the types in [`src/lib/types.ts`](src/lib/types.ts):

| Collection | Document id | Notes |
| --- | --- | --- |
| `players` | the player's random id, saved on their phone | `name`, `created_at` |
| `cards` | `<owner_id>__<scryfall_id>` | one document per owner and printing; adding the same card again bumps `quantity` |
| `loans` | auto | `card_id`, `borrower_id`, `status`, timestamps |

Timestamps are ISO-8601 strings. Deleting a card also deletes its loans.

## Deploy

The app is published with GitHub Pages at
<https://lachlan-odea.github.io/pod-pool/>. Every push to `main` runs
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which runs the
tests, builds, and deploys `dist/`.

To turn on pod sharing in the deployed app, add three repository secrets in
GitHub (Settings, Secrets and variables, Actions): `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`. The next deploy picks
them up.

The site lives under the `/pod-pool/` path, which is set as `base` in
`vite.config.ts`. If you fork this under a different repo name, change that
one line. Any other static host works too: build command `npm run build`,
publish directory `dist`.

HTTPS is required for the camera and for installing the app; GitHub Pages
provides it.

## How scanning works

The scanner shows a card-shaped frame. Line the card up, tap the shutter, and the
app crops just the title band, boosts the contrast, and reads it with
Tesseract (on-device OCR, nothing is uploaded). The text goes to Scryfall's
fuzzy lookup, and the closest alternatives are shown as a row of pictures so a
misread letter is one tap to fix. The first scan downloads about 4 MB of OCR
language data; after that it is cached offline.

Tips that make a big difference:

- Fill the frame. The gold dashed box should sit over the card's name.
- Avoid glare on the title bar. Foils are harder; tilt the card slightly.
- Hold still for a beat before tapping.

If the camera is blocked, the **Photo** button opens the camera app instead and
reads the title from the photo.

## Importing lists

Paste or open a `.txt`/`.csv`. These all work:

```
Sol Ring
1 Arcane Signet
2x Command Tower
1 Sol Ring (C21) 263 *F*          Moxfield
4 Lightning Bolt (2X2) 117 #Burn  Archidekt
Count,Name,Edition,Collector Number   CSV header row
```

Lines are resolved in bulk against Scryfall. Set codes and collector numbers are
used when present so you get the exact printing; otherwise the most recent
printing is used, and you can change it per card afterwards.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Regenerates icons, type-checks, builds to `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm test` | Runs the list-parser tests |

## Project layout

```
src/
  lib/        Scryfall client, list parser, OCR, and the two data stores
  screens/    Pool, Add, Loans, You, and the first-run Welcome
  components/ Scanner, SearchAdd, ImportList, CardDetail, shared UI bits
scripts/      make-icons.mjs renders the PNG icons from the SVG motif
firestore.rules      Firestore security rules (paste into the console or deploy with the CLI)
firebase.json        Points the Firebase CLI at the rules file
```

Card data and images are from [Scryfall](https://scryfall.com). Pod Pool is
unofficial Fan Content permitted under the Fan Content Policy. Not approved or
endorsed by Wizards. Portions of the materials used are property of Wizards of
the Coast. © Wizards of the Coast LLC.
