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

## Life counter

The **Life** tab is a life counter for the game itself, in the style of
LifeTap. It takes over the whole screen and lays the phone flat in the middle of
the table: each player gets a panel turned to face their edge, so with four
players the two on the left and the two on the right each read their own total
the right way up.

- Tap the right half of your panel to gain a life, the left half to lose one.
  Hold to change by ten at a time. A bubble next to the total shows the running
  change for a moment, so "−7" is easy to confirm.
- Each panel has drawers that open the same way up as the seat. Swipe in from
  the panel's inside edge, the one facing the other players rather than the
  edge of the phone, for **commander damage**, a tile per opponent (it comes
  off life as well); the panel then shows a badge per attacker in their
  colour, so everyone can see who has dealt what. Swipe down from its top edge for **counters**: poison,
  energy, experience and commander tax, plus the monarch and initiative
  markers. Counters you hold show as a column down the outer edge of your
  panel, and commander damage as a badge per attacker under the total. The
  monarch's whole panel is tiled with faint crowns, and the
  initiative holder's with daggers, so both can be spotted from across the
  table. Tap the name to pick who sits there from the pod's players (or type a
  guest's name), choose a colour, or turn the seat around for someone sitting
  on the other side. Damage tiles add on the top half and take
  away on the bottom; counter tiles take away on the left and add on the right.
  Hold either to run. The **K.O.** button at the foot of the counters
  drawer knocks the seat out whatever its life total, for a concession or a
  loss the counters do not track, and turns into **Back in the game** to undo
  it. The seat panel fills the seat, with the pod's players in a scrolling list
  beside the colours. Drawers close with a swipe down, a tap on the rest of
  the panel, or a drag back the way they came.
- The dice button in the middle opens the game menu: number of players (one to
  six), starting life (20, 25, 30, 40 or your own), a spinner to pick who goes
  first (the winning seat keeps a **1st** marker by their name for the rest of
  the game, and the seat card can set it by hand), d6, d20 and a coin, and
  reset, which spins for who goes first again. It is also the way back to the pool.
- When a player is out (no life, ten poison, 21 damage from one commander, or
  the K.O. button) their panel dims, a skull and crossbones takes the place of
  the life total, and some famous last words appear beneath it. Life can still
  be changed, and climbing back above zero brings the total back.

- **Turns.** The spinner starts turn one. The pill under the dice shows whose
  turn it is and the turn number, which goes up each time play comes back
  round to the first player; tap it to pass. Play goes clockwise around
  the table, skipping anyone who is out, and the active seat glows. The menu
  has an undo for a double tap.
- **Decks.** In the seat panel, pick the deck being played from that player's
  decks on the Decks tab. It shows under the name.
- **Results.** When one player is left (or from **End game…** in the menu) a
  sheet shows the winner, how long it took, and each seat's life gained and
  lost, commander damage dealt, and the turn they went out. **Save result**
  keeps it and sets up the next game. Saved games are shared with the pod:
  **Games & stats** in the menu rolls them up by deck and by player (games,
  wins, win rate, average length, average life lost) and lists recent games,
  and each deck tile on the Decks tab shows its win–loss record.

Seats take the pod's names to begin with, the screen stays awake while the
counter is open, and the game is kept on the phone, so leaving the tab and
coming back mid-game loses nothing.

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