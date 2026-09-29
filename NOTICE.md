# Notice: copyright, licenses and disclaimers

Read this before you reuse anything from this repository. The short version: **the code is MIT, the name and
branding are reserved, and the third-party assets each have their own license.**

## 1. Copyright

Luminal source code is Copyright © 2026 Craig Smith.

Parts of the code were written with AI assistance under the author's direction.

## 2. License for the code

The source code in this repository is licensed under the **MIT License**. The full text is in
[`LICENSE`](LICENSE).

In plain terms (this summary is not the license, the license is):

- You may use, copy, modify, publish, sublicense and sell the code, in open or closed projects.
- You must keep the copyright notice and the license text in copies or substantial portions of it.
- There is no warranty.

"Code" means the TypeScript/JavaScript, HTML, CSS, configuration, rules and scripts written for this project. It
does **not** include the items in sections 3, 4 and 5.

## 3. Name, logo and branding (not licensed)

The name **"Luminal"**, the Luminal logo, the vehicle names and the game's visual identity are **not** covered by
the MIT license and no license to them is granted. All rights reserved.

If you fork or host this project:

- give your version a different name and logo,
- do not present it as the official Luminal or as endorsed by its author,
- do not use the Luminal domains, Discord or accounts.

## 4. Third-party assets in this repository

These files are **not** under the MIT license. Each stays under the license its author chose. If you reuse them you must
follow that license yourself, including attribution.

### 3D models (Sketchfab, CC BY 4.0)

| Asset | Author |
|---|---|
| Light cycle | DreamLoft3D |
| DeLorean | JustGame |
| Drone | RactStudio |
| Arena Rev 02 | [Shriker1](https://sketchfab.com/Shriker1) |
| Synth City (models and textures) | Jeff Beene |

License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Models have been modified (optimised,
re-textured, re-rigged) for the game.

### Music

| Asset | Author | Terms |
|---|---|---|
| `public/music/synthwave/` ("Evening Drive 1980") | EnthusiastGuy | Free pack, attribution required: **Music by EnthusiastGuy**. [Source](https://enthusiastguy.itch.io/evening-drive-1980-50-free-synthwave-tracks) |

### Sound effects (Freesound, CC0 / CC BY 4.0)

| Sound | Author |
|---|---|
| Near miss | [lilmati](https://freesound.org/s/445244/) |
| Drift start | [rutgermuller](https://freesound.org/s/104026/) |
| Drift end | [audible-edge](https://freesound.org/s/76805/) |
| Car pre-match | [skyernaklea](https://freesound.org/s/623436/) |
| Bike pre-match | [overmedium](https://freesound.org/s/681593/) |
| Explosion | [julien_matthey](https://freesound.org/s/201571/) |

Check each Freesound page for the exact license of that sound.

### Assets with no recorded source

The source and license of the following were not written down during development. They are included as they were
in the project, **without any license grant from this project**. Do not assume they are free to reuse. If you are
the author of one of them and want it credited or removed, open an issue and it will be dealt with.

- `public/models/sci_fi_hoverboard.glb`, `moon.glb`, `space_skybox_nebula.glb`, `milky.jpg`
- `public/images/maps/sky_night.jpg`
- `public/sfx/vehicles/` (engine and pass-by sounds)
- `public/sfx/achievement.*`, `game-over.*`, `match-pause.*`, `win-screen.*`

### Libraries

Dependencies are installed from npm and are not vendored here, except the Draco decoder in `public/draco/`
(Apache-2.0, Google). Main runtime libraries: three.js (MIT), postprocessing (Zlib), Firebase JS SDK (Apache-2.0),
cobe (MIT), marked (MIT), Prism (MIT). Icons are from Lucide (ISC). Fonts (Orbitron, Rajdhani) are SIL OFL 1.1.
See each package for its full license.

## 5. Assets deliberately left out

The live game uses audio that the author is licensed to **use in the game** but not to **redistribute**. Those
files are **not in this repository** and are not licensed to you by this project:

| Asset | Owner | Why it is not here |
|---|---|---|
| Road Runner, Rainbow Dance, Angel Boy, How Do I Let Go, Shimmer Shuffle | Rommii | Permission was given for use in the game only, not for distribution. |
| Start The Engine | Joris Delacroix | Commercial release. Not redistributable. |
| Protocol, Run, Valor | not recorded | Source not recorded, so left out. |
| UI sound effects (`public/sfx/ui/`) | PremiumBeat | The license does not allow redistributing the files. |

The game handles their absence: missing tracks are skipped and missing sounds are silent. Hearing these in the
live game does not give you any right to copy them from it.

## 6. Disclaimers

**Unfinished software.** Luminal is an early alpha, published as-is. Features are incomplete, some are disabled,
and it is not actively maintained. Nothing here is promised to work, to keep working, or to be fixed.

**Experimental and outdated.** This project was an experiment. Much of the process recorded in it (workflows,
tooling, agent configuration, plans and docs) is out of date. Treat the repository as a reference, not as
current guidance or recommended practice.

**No warranty.** As stated in the MIT License, the software is provided "as is", without warranty of any kind,
and the author is not liable for any claim, damages or other liability arising from its use.

**Online play.** The netcode and backend rules are part of an unfinished project and have not been security
audited. If you host your own copy, you are responsible for it and for your players' data.

**Not affiliated.** Luminal is an independent fan-made game inspired by light-cycle games. It is not affiliated
with, sponsored by or endorsed by The Walt Disney Company. "TRON" is a trademark of Disney. Other names and
trademarks belong to their owners.

**Live service.** The hosted game at luminal-game.web.app is run by the author under its own
[terms](terms.html) and [privacy policy](privacy.html). The license for this code gives you no rights to that
service, its data or its accounts.

## 7. Takedown and contact

If you believe something in this repository infringes your rights, open an issue on the GitHub repository or use
the contact on the game's credits page. Valid requests will be acted on.
