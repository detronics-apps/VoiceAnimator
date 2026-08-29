# Detronics VoiceAnimator

**Live: https://detronics-apps.github.io/VoiceAnimator/**

Turn script text into lip-sync mouth-shape timing, drive **your own character artwork**
with it, and export a track that drops straight into the tools built around
[Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync).

Upload a picture of your character, drag a mouth onto its face, and it speaks.

One static page. No backend, no build step, no dependencies, no network requests once the
page has loaded.

**Save project** and **Load project** sit in the header, next to the theme control. A
project file is plain JSON on your own machine holding the script, the settings, your
pronunciation corrections and all the artwork.

| Tool | What it does |
|---|---|
| **Animate** | The character, a transport and a timeline. Type a script, watch the mouth follow it, scrub anywhere. |
| **Breakdown** | Every word, the sounds it was read as, and the shapes those become — each row editable. |
| **Character** | Upload your character, drag the mouth, brows and eyes into place, and manage a library of them. |
| **Mouth set** | Mouth pictures mapped onto the poses, from separate files or by cutting up one contact sheet. |
| **Export** | Rhubarb TSV, JSON and XML; Moho switch data; CSV; a printable timing sheet. |

Every tool carries a **"How this works"** panel explaining the concept in plain language,
giving the rule it follows, and working that rule through with whatever values are
currently on screen.

## How this relates to Rhubarb Lip Sync

Rhubarb listens to a recording and recognises the sounds in it. That is why it needs the
recording before it can tell you anything, and it is why its timing is a *measurement*.

VoiceAnimator starts from the script instead:

```
Rhubarb      audio  -> recognised phonemes -> cues     (measured)
VoiceAnimator script -> predicted phonemes  -> cues     (modelled)
                      + audio -> silences   -> fitted cues
```

So you can block out a performance before a single line has been recorded. When the
recording does arrive, load it: the modelled track is stretched onto the real take, and
the gaps heard in the audio are matched to the pauses the punctuation produced.

**What is exact either way** is which shape follows which, and in what order — that comes
from the words, and the words are known.
**What is modelled here** is how long each shape is held.
**What fixes it** is loading the recording, or nudging the settings.

Where you need genuine phoneme recognition, Rhubarb remains the right tool, and this app
exports in its formats precisely so you can move between them.

## Mouth shapes

Two schemes ship, and artwork carries across between them where an equivalent exists.

**Character sheet (16 poses)** — the default. Twelve mouths labelled by the letters that
produce them (`B M P`, `A E I`, `C D G K N S T X Y Z`, `Q W`, `EE`, `U`, `O`, `CH SH J`,
`L`, `F V`, `R`, `TH`) plus four expressions (angry, smile, sad, laughing). This is the
layout hand-drawn character sheets normally come in.

**Rhubarb (A–X)** — the nine shapes Rhubarb itself uses. A–F are its basic set, G and H
its extended shapes, X the rest pose.

English has around forty distinguishable sounds and only a handful of distinguishable
mouth shapes, because most of the work is done by the tongue and the camera cannot see
it. `P`, `B` and `M` are three different sounds and one identical picture. That collapse
is the whole reason lip sync is tractable: you draw a dozen pictures, not forty.

## Your character

A character is a still picture with parts layered on top of it. The drawing underneath
never moves; only the parts do.

```
base image            drawn once, never changes
  + eyes    [expression, or closed for a blink]
  + brows   [expression]
  + mouth   [viseme]   <- swapped every cue
```

Brows and eyes take one picture per expression — `neutral`, `angry`, `sad`, `smile`,
`laughing`, plus `closed` for the eyes so the character can blink. An expression you have
not drawn falls back to `neutral`, so three brow pictures already cover a performance.

The important part is that this is useful **before you have drawn anything**. A part with
no artwork for the pose being shown falls back to the built-in drawing at that part's
position — so the workflow is:

1. Upload one picture of your character on the **Character** tab.
2. Drag the mouth onto its face and size it against the widest pose.
3. It speaks. Watch it on the **Animate** tab.
4. Replace the built-in mouths with your own, one at a time, whenever you draw them.

Each part has a position, a size, a rotation and an opacity, all editable two ways — on
the picture or with the sliders beside it, both writing the same numbers:

| Gesture | Effect |
|---|---|
| Drag the part | Move it |
| Drag a corner handle | Resize, about the part's own centre |
| Drag the handle above it | Rotate (hold shift to snap to 15°) |
| Arrow keys | Nudge one unit, or ten with shift |
| `+` and `−` | Resize |
| `[` and `]` | Rotate |

A part with no artwork yet — brows you have not drawn, eyes you may never need — appears
in the editor as a labelled ghost you can drag and size like anything else, so it is
already in the right place when the picture arrives. Ghosts never appear on the
animation stage.

### Poses that need their own position

One placement for a whole mouth is often not enough. A wide open vowel is bigger than a
closed mouth and usually sits lower on the face. So each pose can carry its own
adjustment: switch the part's controls from **Every pose** to **Just this pose**, and the
same dragging, resizing and rotating now changes only the pose being previewed. Tuned
poses are marked with a `✦`.

These adjustments are stored as *differences from the part's placement*, not as positions
of their own. That is what makes them safe to use early: reposition the mouth after tuning
half a dozen poses and every one of them moves with it, keeping its own offset and size.
Had they been absolute they would all have been left behind.

Brows and eyes work the same way, so an angry brow can sit lower than a neutral one.
`Reset position` puts a part back where it started and clears every pose adjustment with
it.

**Several characters.** The library holds as many as you need, each with its own picture,
artwork and placement. Switch between them in the editor, or hand the next lines of a
script to another one with `[as name]`, which is what makes a two-hander possible.

**Blinking.** Give the eyes slot a closed-eyes picture and the character blinks on an
irregular schedule. Irregular matters: a character blinking on a perfect metronome reads
as a machine. The schedule is deterministic for a given track, so the eyes do not flutter
every time the page redraws.

**Whole frames still work.** A character with no base picture takes one complete picture
per pose instead — which is exactly what a scanned sixteen-pose character sheet is, and it
needs no positioning at all.

### Mouth artwork

Poses without artwork are drawn by the app, so a half-finished set still animates.

- **Separate files** — one image per pose. Files named after the pose (`MBP.png`,
  `AI.png`, `smile.png`, `A.png`) land in the right slot on their own. Preston Blair and
  Moho names are understood, and so are the Rhubarb letters.
- **One contact sheet** — load a single image with every pose on it, set the grid so each
  box lands on one pose, trim the caption strip, and cut. Cells are cropped onto one
  canvas size, so a set cut from one sheet is consistent by construction.

Where these land depends on the character. One with a base picture takes them as its
**mouth layer**, composited at the position you set; one without takes them as **whole
frames** that replace the picture outright — which is what a scanned character sheet of
complete heads is. Same drop, same filenames, and the Mouth set tab says which.

## Cues in the script

Punctuation buys the pauses: a comma is a beat, a full stop is longer, a line break
longer still, a blank line longest. Beyond that:

| Cue | Effect |
|---|---|
| `[smile]` `[angry]` `[sad]` `[laughing]` | Sets the running expression — brows, eyes, and the pose held during rests |
| `[neutral]` / `[rest]` | Clears it |
| `[pause 0.8]` / `[pause 500ms]` / `[beat]` | A deliberate gap |
| `[as bob]` | Hands the following lines to the character named Bob |

Numbers, currency, percentages and a short list of acronyms are expanded to the words a
person would actually say — `1990` is *nineteen ninety*, `£3.50` is *three pounds fifty*,
`USB` is *you ess bee* — while the highlight still points at the characters you typed.

## Running it

It is plain files. Any static server will do:

```bash
python -m http.server 8080
```

## Tests

The domain core is pure — no DOM, no globals — so it runs under Node's built-in test
runner with nothing to install:

```bash
npm test
```

413 cases across eleven modules. Beyond example tests, the suite leans on invariants that
catch far more than individual cases: every scheme must map every phoneme it could ever
be handed; every laid-out track must be contiguous, ordered and free of zero-length cues;
`quantiseToFrame` must be idempotent and land exactly on the grid; a warp must be
monotonic however badly its anchors were chosen; a share link must survive a round trip
with the characters people actually type; no user-facing sentence may contain a
full-precision float; every character composes to something drawable for every pose in
every scheme, per-pose adjustments included; a resize or rotation done by dragging can
only produce a value the sliders would also accept; and moving a part carries every tuned
pose along with it.

## Deploying to GitHub Pages

Push to `main`, then **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
`.nojekyll` is already present. There is nothing to build.

Pages caches for about ten minutes, and your own browser caches on top of that. **Read
the version in the footer before investigating any bug** — if it shows the old version,
nothing you are looking at is current.

## Layout of the code

```
index.html              the shell; everything else is built by JS
css/tokens.css          the Detronics palette as light/dark custom properties
css/layout.css          header, viewport, sidebar, footer
css/components.css      components, plus this app's own face and cue tokens
css/patterns.css        layout rules that exist because something broke without them
css/print.css           the printable sheet

js/timecode.js          seconds, frames and SMPTE; forgiving time input
js/g2p.js               English spelling -> ARPAbet phonemes, with an exception lexicon
js/scriptparse.js       script -> words, pauses and cues; number and abbreviation expansion
js/visemes.js           the two viseme schemes, and the map between them
js/timing.js            phonemes -> timed cues; merging, minimum hold, frame snapping
js/lipsync.js           the pipeline, live warnings, and the teaching text
js/envelope.js          RMS envelope, silence detection, and fitting a track to a recording
js/exporters.js         Rhubarb TSV/JSON/XML, Moho, CSV, timing sheet
js/character.js         the character rig: layers, placement, blinking, the library
js/mouthset.js          filename matching and contact-sheet grids
js/state.js             one state object, localStorage, URL-hash sharing, project files
js/main.js              chrome, tool routing, rendering

js/ui/                  DOM helpers, renderers, player, audio decode, export plumbing
js/ui/tools/            one controller per tool
tests/                  node --test over the pure modules
```

The rule that keeps this workable: **everything under `js/` except `js/ui/` is pure.**
No DOM, no globals, no `window`. `js/state.js` is the one documented exception, and even
there the migration, sharing and project-file logic are pure functions that the tests
cover; only `load`, `save` and `shareLink` touch the browser, and each degrades to a
no-op rather than throwing.

## Privacy

Nothing you enter leaves your browser. No analytics, no cookies, no fonts or scripts from
other hosts, and no network requests at all after the page has loaded.

- **Scripts and settings** are kept in `localStorage` on your own device.
- **Recordings** are decoded in the browser by the Web Audio API and never uploaded. The
  analysis in `js/envelope.js` is arithmetic on the samples, not a call to a service.
- **Artwork** is read by the browser and held in memory. A library larger than about 3 MB
  is not written to `localStorage` — the pictures are dropped from the stored copy while
  the names, placements and blink settings are kept, and the app says to save a project
  file.
- **Share links** encode the script and settings into the URL **fragment**, which
  browsers never transmit to a server. Artwork is never put in a link.
- **Project files** are plain JSON saved to your own machine, artwork included. They are
  treated as untrusted on the way back in: only real visemes and slot states are kept,
  only images that are self-contained `data:` URLs, and every placement is clamped — so
  opening a project can never turn into a network request, and never puts a part
  somewhere you cannot drag it back from.

## Accuracy

Two things in this tool are estimates, and both are worth stating plainly.

**Pronunciation.** English spelling is not a function of its pronunciation — `read` and
`read` are the same six letters and two different words — so no rule set can be complete.
This one uses a few hundred spelling rules with an exception lexicon of the words that
break them. Expect roughly 90% of ordinary English correct, less for names, loanwords and
technical vocabulary. Stressed open syllables (`even` versus `ever`) are a genuine coin
flip and are handled by the lexicon rather than a rule, so words outside it will
sometimes be wrong. **The Breakdown tab is the answer:** correct a word once and the
correction is kept with the project.

**Timing.** The durations are modelled from articulatory class and a speaking rate, not
measured. They are a good first pass and a poor final answer. The relative proportions —
a stop being brief, a diphthong long, a vowel lengthening before a pause — are drawn from
the general phonetics literature and are indicative rather than authoritative for any
particular speaker. Load a recording and the model is fitted to it; that is the only way
this tool produces timing that is measured rather than guessed.

**What is not an estimate** is the ordering of the shapes, the merging of identical
neighbours, the minimum-hold and frame-snapping arithmetic, and the export formats. Those
are exact, and they are what the tests cover.

The Rhubarb formats are written to match Rhubarb Lip Sync's own output so that existing
tooling accepts them. Where a scheme has shapes Rhubarb does not, they are mapped down to
the nearest Rhubarb shape and the app tells you which detail was flattened.

## Licence

MIT.
