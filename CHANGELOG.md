# Changelog

## 1.3.2

**Fixed: typing in the script box lost the caret after every letter.**

Editing the script rebuilt the whole control panel on a debounce, and rebuilding replaced
the textarea being typed into — so focus fell to the page body and the next keystroke went
nowhere. The same fault detached a slider mid-drag, which stopped following the pointer.

The controls are no longer rebuilt while one of them is being used. Only *continuously*
edited controls count — a text field, a slider — because buttons, chips and checkboxes are
finished with by the time their handler runs and must redraw to show their new state. A
skipped panel is caught up as soon as focus leaves it, and a change of tool always rebuilds
it whatever has focus, since leaving the previous tool's controls on screen would be worse
than losing a caret.

- Also: the speaking-rate hint said "1 words".

## 1.3.1

- **Save project and Load project in the header**, beside the theme control, so the two
  actions you reach for most are not buried in a tab. They shorten to **Save** and
  **Load** on a narrow screen, where the wordmark is already hidden and the logo gives
  way, so nothing collides down to 280px.
- Both entry points now call one implementation, so a project opened from the toolbar
  behaves exactly like one opened from the Export panel — including the messages when a
  file is not a project.

## 1.3.0

Each pose can have its own position and size.

One placement for a whole mouth is not enough: a wide open vowel is bigger than a closed
mouth and usually sits lower on the face. Every pose of every part — each viseme, each
expression — can now carry its own adjustment.

- **A mode switch** beside each part: *Every pose* moves the whole slot, *Just this pose*
  moves only the one being previewed. The gesture is identical; only its destination
  differs.
- **Adjustments are deltas, not absolute placements.** This is the design decision that
  matters: reposition the mouth after tuning half a dozen poses and every tuned pose
  moves with it, keeping its own offset and size. Absolute placements would have left
  them behind and you would have to redo them all.
- **Adjusted poses are marked** with a `✦` in the pose chips, and the part's controls
  list which ones have been tuned.
- **Reset one pose or all of them**, and *Reset position* now also clears every
  adjustment for that part.
- Adjustments follow the artwork when the viseme scheme changes, survive a project
  round trip, and are cleared when a new base picture is uploaded — a delta measured
  against a placement that no longer exists means nothing.
- Brows and eyes get the same treatment, so an angry brow can sit lower than a neutral
  one.

## 1.2.0

Sizing and placing parts directly, and positioning a part before it exists.

- **Resize on the picture.** Every part has corner handles — drag one and it scales about
  its own centre, so growing a mouth does not also move it.
- **Rotate on the picture.** A handle above the part. Hold shift while dragging and it
  snaps to fifteen degrees.
- **Empty slots can be placed.** A brow slot with no artwork used to draw nothing, which
  made it impossible to position until after uploading — the one moment you most want to
  see where it will go. Empty slots now appear in the editor as a labelled ghost that
  drags and resizes like anything else, and stay invisible on the animation stage.
- **A part picker** above the picture, so a slot with nothing drawn in it can still be
  selected.
- **The sidebar follows the selection.** Picking a part on the picture opens its section,
  and each section has a button that selects it on the picture.
- **Keyboard.** Arrow keys nudge the selected part (shift for ten at a time), `+` and `−`
  resize, `[` and `]` rotate.
- Placeholder ghosts are drawn at the part's own proportions rather than the whole
  canvas, so a brow ghost looks like a brow.

## 1.1.0

Your own character, actually speaking.

### Characters

- **A layered character rig.** Upload one still picture of a character and place a mouth,
  eyebrows and eyes on top of it. Only the parts move; the drawing underneath never does.
- **Drag to position.** The stage is the editor — drag any part onto the face, or use the
  sliders for the last two pixels. Both edit the same numbers, in either direction.
- **Useful before anything is drawn.** A part with no artwork for the pose being shown
  falls back to the built-in drawing *at that part's position*, so a character speaks the
  moment its picture is uploaded and you replace the built-in mouths one at a time.
- **A character library.** Several characters, each with its own rig, artwork and
  placement. Add, duplicate, rename and switch.
- **`[as name]` in the script** hands the following lines to another character, so one
  script can be a two-hander.
- **Blinking.** With a closed-eyes picture the character blinks on an irregular schedule.
  The schedule is deterministic for a given track, so the eyes do not flutter on every
  re-render.
- **Rotation, scale and opacity** per part, for a character whose head is not upright.

### Changed

- The old single mouth set is now a *character*. A project saved by 1.0 opens with its
  artwork intact, carried across as a whole-frame character.
- The Mouth set tab now fills the active character — its mouth layer when the character
  has a base picture, whole frames when it does not. Same drop, same filenames.
- Changing viseme scheme re-keys every character's mouth artwork rather than one set's.
- Storage now measures the whole library, and drops only the pictures when it will not
  fit, keeping names, placements and blink settings.

### Notes

- 381 tests. `js/character.js` was written and tested before the editor existed, as with
  every other pure module.
- Verified in the running page: a real image uploaded through the real file input, the
  mouth dragged with real pointer events (moved exactly as commanded, sliders agreeing),
  both characters appearing at the right times from an `[as name]` script, and the eyes
  layer appearing in 6 of 49 sampled frames rather than constantly.

## 1.0.0

First release.

### Tools

- **Animate** — character stage, transport with frame stepping, a scrubbable timeline of
  every cue, and the script highlighted word by word as it plays.
- **Breakdown** — a row per word showing the sounds it was read as and the shapes those
  become, with an editable pronunciation override kept with the project.
- **Mouth set** — artwork mapped onto poses, either from separate files matched by name
  or by cutting up a single contact sheet with an adjustable grid.
- **Export** — Rhubarb TSV, JSON and XML; Moho switch data; CSV; a printable timing
  sheet; SVG and PNG of the character, the chart and the timeline.

### Domain

- Rule-based English grapheme-to-phoneme with an exception lexicon, contraction handling,
  plural and past-tense voicing, and a per-project override map.
- Script parsing with number, currency, percentage, ordinal and acronym expansion that
  keeps the original character offsets, so a word spoken as several still highlights as
  one.
- Two viseme schemes — the sixteen-pose character sheet and Rhubarb's A–X — with an
  explicit equivalence map so artwork moves between them and the app reports what could
  not come along.
- A timing model that scales speech to a requested words-per-minute, merges identical
  neighbouring shapes, protects the closed mouth from being absorbed, enforces a minimum
  hold, and snaps every boundary to the frame grid.
- Audio fitting: RMS envelope, silence detection, and a monotonic piecewise-linear warp
  that matches the gaps heard in a recording to the pauses the punctuation produced.

### Notes

- 314 tests over ten pure modules, written before the interface existed.
- Verified in the running page rather than by screenshot: `getBBox()` inside the viewBox
  for all thirty pose and expression combinations, no `var(--` in any export, every token
  resolving in light, dark and system, and no horizontal overflow at 320px, 375px or in a
  480px-tall window.
- Two rendering scale traps from the skill's `pitfalls.md` were relevant here and are
  handled: the stage is capped at its natural size, and nothing in the viewport shrinks.
