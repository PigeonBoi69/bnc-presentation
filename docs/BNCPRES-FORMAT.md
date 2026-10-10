# `.bncpres` format (version 1)

A `.bncpres` file is a standard ZIP archive (media type `application/vnd.bnc.presentation+zip`). Any zip tool plus a JSON parser can read it.

| Entry | Description |
| --- | --- |
| `mimetype` | The text `application/vnd.bnc.presentation+zip`, stored uncompressed and first in the archive |
| `manifest.json` | `{ "format": "bncpres", "version": 1, "app": "BNC Presentation", "created": ISO date, "modified": ISO date, "slides": number }` |
| `presentation.json` | The whole slide model: size, theme, masters, layouts, slides and their elements |
| `media.json` | Index of embedded files: `{ "<id>": { "file": "media/<id>.<ext>", "mime": "...", "name": "..." } }` |
| `media/*` | Pictures, audio and video as plain binary files |

All lengths are in points (1/72 inch). A standard slide is 960 x 540.

## `presentation.json`

The shape of this file is the `Pres` type in [`src/core/model.ts`](../src/core/model.ts). In short:

- `size`: slide size in points; `masters[]` and `layouts[]` hold the shared backgrounds and placeholders every slide builds on.
- Each master carries its `theme`: the colour scheme (`dk1`, `lt1`, `accent1`-`accent6`, ...) and the heading/body fonts.
- `slides[]`: each slide has a `layoutId`, optional `bg`, `transition`, `anims`, `comments`, `notes`, and `elements[]`.
- Elements (`type`): `shape` (geometry, fill, line, text), `picture`, `table`, `chart` and `group`. Each has an `id`, a position and size (`x`, `y`, `w`, `h`) and optional rotation.
- Text is a list of paragraphs, each a list of runs with their own formatting; placeholders (`ph`) inherit position and formatting from the layout and master.
- Pictures and other media refer to entries in `media.json` by id (`"media": "<id>"`).

## Reading and writing rules

- Readers must ignore unknown entries, element types and attributes.
- A reader that sees a `version` greater than it supports should refuse to open the file.
- The reference implementation is [`src/core/bncpres.ts`](../src/core/bncpres.ts).
