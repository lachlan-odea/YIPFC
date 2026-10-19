# YIPFC

**Yes I pay for cardboard.**

YIPFC is a shared pool for a Commander pod. Everyone adds the spare cards they
are happy to lend, and anyone in the pod can search the pile and ask to borrow
one. Changes show up on everyone's phone straight away.

## Your pool

Each player has their own list of cards they offer. The **Pool** tab shows
everyone's cards together, sorted by name.

- Search by name, type or rules text.
- Filter the list to narrow it down.
- Tap a card to see its printing, the spare copies you have, and who owns it.
- Change the printing or quantity of your own cards, or take a card out of the
  pool.

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

- A card is added when the read is confident, or when two reads in a row agree
  and Scryfall recognises the name. The frame flashes green, a bubble shows the
  card, and the phone buzzes. A sound plays once you have tapped the page.
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

## Players and sign-in

The first time you open the app you type your name. If someone in the pod
already uses that name, you sign in as them rather than creating a second
player, so switching phones is just a matter of typing your name again.

The **You** tab shows your name, the cards you offer, what you have out on loan,
and how much storage the app is using. It also has the steps for installing
YIPFC to your home screen, which gives a full-screen app with the camera one tap
away.

## Offline use

The pool keeps a local copy on your phone. It opens with no signal, and anything
you change offline syncs when you are back online.

## Credits

Card data and images are from [Scryfall](https://scryfall.com). YIPFC is
unofficial Fan Content permitted under the Fan Content Policy. Not approved or
endorsed by Wizards. Portions of the materials used are property of Wizards of
the Coast. © Wizards of the Coast LLC.
