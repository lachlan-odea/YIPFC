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

Until you connect Supabase, the app runs in **this device only** mode: cards and
loans live in that browser's storage. Everything works, nothing is shared.

## Share it with your pod (Supabase)

1. Create a free project at <https://supabase.com>.
2. Open the SQL editor and run the whole of [`supabase/schema.sql`](supabase/schema.sql).
3. In Project Settings, API, copy the project URL and the `anon` public key.
4. Copy `.env.example` to `.env` and paste them in.
5. Rebuild and deploy. Each person opens the URL, types their name once, and
   installs it to their home screen.

The schema deliberately lets anyone with the app's anon key read and write.
That is fine for a group of friends who share one URL. If you ever want to lock
it down, enable Supabase Auth and replace the `pod can do anything` policies.

Realtime is on, so when one person adds a card or marks something lent, the
other phones update within a second.

## Deploy

Any static host works. The build output is `dist/`.

- **Netlify / Vercel / Cloudflare Pages**: point it at this repo, build command
  `npm run build`, publish directory `dist`, and add the two `VITE_SUPABASE_*`
  variables in the host's environment settings.
- **GitHub Pages**: set `base` in `vite.config.ts` to the repo path first.

HTTPS is required for the camera and for installing the app, and all of these
hosts give you that for free.

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
supabase/     schema.sql to paste into a new Supabase project
scripts/      make-icons.mjs renders the PNG icons from the SVG motif
```

Card data and images are from [Scryfall](https://scryfall.com). Pod Pool is
unofficial Fan Content permitted under the Fan Content Policy. Not approved or
endorsed by Wizards. Portions of the materials used are property of Wizards of
the Coast. © Wizards of the Coast LLC.
