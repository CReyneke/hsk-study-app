# Third-party assets and their licenses

This app bundles data and code from several sources. Each is listed below with the
license it is redistributed under and where the full text lives in this folder.

---

## Stroke-order data — `stroke-data/*.json`

Derived from **Make Me a Hanzi** (<https://github.com/skishore/makemeahanzi>), whose
`graphics.txt` is in turn derived from the fonts:

- Arphic PL KaitiM GB
- Arphic PL UKai

Redistributed under the **Arphic Public License**.
Full text: [`ArphicPublicLicense.txt`](ArphicPublicLicense.txt)
If that file is missing, see <http://ftp.gnu.org/non-gnu/chinese-fonts-truetype/LICENSE>.

Modification note: the upstream per-character data has been reduced to only the
`strokes` and `medians` fields, restricted to the 655 characters this app teaches, and
each character stored in its own file named by Unicode codepoint. No stroke geometry
was altered.

---

## Character decomposition / etymology data — `js/char-data.js`

Derived from **Make Me a Hanzi**'s `dictionary.txt`, which is in turn derived from:

- Unihan — <http://unicode.org/charts/unihan.html>
- CJKlib — <https://github.com/cburgmer/cjklib>

Redistributed under the **GNU Lesser General Public License, version 3 or later**.
Full text: [`LGPL.txt`](LGPL.txt)
If that file is missing, see <http://www.gnu.org/licenses/>.

Modification note: filtered to the characters this app teaches plus their components,
with field names shortened and unused fields dropped. No definitions, decompositions or
etymologies were edited.

The upstream licensing summary is reproduced verbatim in
[`makemeahanzi-COPYING.txt`](makemeahanzi-COPYING.txt).

---

## Stroke rendering/quiz library — `vendor/hanzi-writer.min.js`

**Hanzi Writer** v3.7.2 — <https://hanziwriter.org/> — by Chandler Chanin (chanind).
Redistributed under the **MIT License**.
Full text: [`hanzi-writer-LICENSE.txt`](hanzi-writer-LICENSE.txt)

---

## Mascot art and UI pixel font — `*.png`, `ui-assets/`

**Sprout Lands** asset pack by **Cup Nooble** — <https://cupnooble.carrd.co/>

Used under the pack's premium license, which permits use in non-commercial and
commercial projects and requires credit. Credit is given in the app footer. The pack
itself is not redistributed — only the derived sprites actually used are included, and
the pack may not be resold or redistributed as an asset pack.
