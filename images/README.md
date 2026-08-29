# Put your character artwork here

This folder is a convenient place to keep your mouth drawings. The app does **not** read
it automatically, and that is deliberate: VoiceAnimator makes no network requests at all
once the page has loaded, so every image is one you pick yourself through the file
dialog. Nothing is uploaded either way.

If you have a single picture of the whole character, that goes on the **Character** tab
instead — upload it there, drag a mouth onto its face, and it will speak before you have
drawn any mouths at all. The files here are for replacing those built-in mouths.

Open the **Mouth set** tab and either:

- **Choose images…** and select the files in here, or
- **Load a sheet…** if every pose is on one image, then set the grid and cut it up.

## Naming files so they land in the right slot

A file named after its pose is assigned automatically. All of these are understood:

| Pose | Names that work |
|---|---|
| Closed | `MBP` · `BMP` · `A` · `closed` · `rest` |
| Wide open | `AEI` · `AI` · `D` · `open` |
| Teeth together | `CONS` · `etc` · `B` · `teeth` |
| Puckered | `QW` · `WQ` · `F` · `pucker` |
| Spread | `EE` |
| Small round | `U` · `oo` |
| Rounded open | `O` |
| Forward | `CHSHJ` · `CH` · `SH` |
| Tongue up | `L` · `H` · `tongue` |
| Teeth on lip | `FV` · `G` · `bite` |
| R | `R` |
| TH | `TH` |
| Expressions | `angry` · `smile` · `sad` · `laughing` |

Any extension works (`.png`, `.jpg`, `.webp`, `.svg`), case does not matter, and a prefix
is ignored — `lisa_mouth_MBP.png` and `char-01 - smile.PNG` both resolve. Anything the
app cannot recognise is listed rather than guessed at, and you can assign it by clicking
the pose on the chart.

Draw every pose on one canvas at one size, or the mouth will appear to change size
between poses — the app warns if the proportions do not match.

If you only have some of the poses, that is fine: the ones you have are used and the rest
are drawn by the app.
