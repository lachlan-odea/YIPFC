# YIPFC

**Yes I pay for cardboard.**

YIPFC is a shared pool for a Commander pod. Everyone adds the spare cards they
are happy to lend, and anyone in the pod can search the pile and ask to borrow
one. Changes show up on everyone's phone straight away.

## Your pool

Each player has their own list of cards they offer. The **Pool** tab shows
everyone's cards together, sorted by name.

- Search by name, type or rules text.
- Filter by owner, set, card type and colour identity (including colourless).
  Cards that are out on loan are greyed out.
- Tap a card to see its printing, the spare copies you have, and who owns it.
  Double-faced cards show a ⇄ mark on the tile and flip over in the card view.
  The type filter counts every face, so an Instant // Land is under Land too,
  and has a Double-faced (MDFC) option.
- Change the printing, foil or non-foil finish, quantity and note of your own
  cards, or take a card out of the pool. Foil and non-foil copies of the same
  printing are listed separately and priced separately.
- Tick **Show value in AUD** to see each card's current price. Prices come from
  Scryfall in US dollars and are converted at the European Central Bank's daily
  rate; both are refreshed once a day. A ✦ marks a card where only the foil
  price was listed.

Adding the same card again increases its quantity rather than creating a second
entry.

## Adding cards

The **Add** tab has three ways in:

- **Scan.** Point the camera at cards one after another. Each card is read from
  its name and added as soon as it is recognised. See [Scanning](#scanning).
- **Search.** Look a card up on Scryfall and add it, choosing the printing you
  have.
- **Import a list.** Paste or open a `.txt` or `.csv` export from Moxfield,
  Archidekt or a similar site. Lines are matched against Scryfall in bulk. Set
  codes and collector numbers are used when they are present, so you get the
  exact printing. Otherwise the most recent printing is used, and you can change
  it per card afterwards.

```
Sol Ring
1 Arcane Signet
2x Command Tower
1 Sol Ring (C21) 263 *F*          Moxfield
4 Lightning Bolt (2X2) 117 #Burn  Archidekt
Count,Name,Edition,Collector Number   CSV header row
```

## Scanning

Scanning works like ManaBox: the camera stays on and you hold cards up one after
another. Each card is read on your device and nothing is uploaded.

- Two recognisers race on every frame. The picture matcher compares the art
  window against an index of every distinct Scryfall artwork, entirely on your
  phone, and usually wins within half a second. The name reader (OCR) runs
  alongside and catches cards the picture matcher is unsure about. Whichever
  recognises the card first adds it: the frame flashes green, a bubble shows
  the card, and the phone buzzes. A sound plays once you have tapped the page.
- The art index is about 3 MB and downloads on the first scan, then stays
  cached. Without it, scanning falls back to the name reader alone.
- The bottom-left footer is read for the collector number and set code, to pin
  down the exact printing. When that fails, the default printing is used and you
  can change it afterwards.
- Every scanned card appears in a list under the viewfinder. Tap a row to change
  its printing or quantity, or to remove it.
- Showing the same card again counts as another copy.
- The first scan downloads about 4 MB of text-recognition data. After that it
  works offline.

Tips:

- Fill the frame. The gold dashed box should sit over the card's name.
- Avoid glare on the title bar. Foils are harder, so tilt the card slightly.
- Hold still for a second. The hint at the top shows what is being read.

If the camera is blocked, the **Photo** button opens the camera app instead and
reads the card from a photo.

## Borrowing and loans

Ask to borrow any card in the pool. The owner sees the request and can lend the
card to you or leave it. The **Loans** tab tracks everything that is moving:

- **Requested:** you have asked for a card, or someone has asked for one of
  yours.
- **Lent:** the owner has handed it over. The card is shown as with whoever has
  it.
- **Returned** or **declined:** the loan is closed.

Each card can have a note for borrowers, such as "ask before using in a deck",
shown on the card.

## Decks

The **Decks** tab is a deck builder that knows what the pod has. Start a deck
and add cards three ways: pick from the pool, search Scryfall for anything, or
paste a list from Moxfield, Archidekt or a similar site. Every line shows where
the copies would come from:

- **In your pile:** spares you have listed yourself.
- **Borrowable:** free copies another player has listed. The **Ask** button
  sends them a loan request, and one button at the bottom asks for everything
  at once.
- **With you** or **asked:** copies you already hold or have requested.
- **Missing:** nobody in the pod has it spare.

The bar at the top shows the split and the chips filter the list. The star on a
row marks the commander. Decks are shared with the pod, so friends can open
yours read-only and see what they could lend. **Copy as a decklist** gives the
plain "1 Card Name" form every deck site accepts.

## Accounts and pods

You sign in with an email and password. Your account holds your collection:
the spare cards you offer, your decks and your loans. Sign in on another phone
and it is all there.

A **pod** is a group of friends whose collections are pooled. Create one from
the **You** tab (or on first run) and you get a six-letter code and a share
link. Friends join by entering the code or tapping the link, and their cards
appear in the pool at once. You can be in several pods; your collection is the
same in each, and the pod you are looking at is picked on the You tab. Leaving
a pod removes your cards from that pod's view and nothing else.

If you used the app before accounts existed, the You tab offers to move the
cards this phone added onto your new account.

## Offline use