# Keys you can press

Used with `node scripts/kit.js press <keys...>`. Several keys can be given in one command and are pressed in order, each recorded as its own step. `tab*5` presses a key five times.

## How to write a key

- Single keys: `tab` `enter` `space` `escape` `up` `down` `left` `right` `home` `end` `pageup` `pagedown` `backspace` `delete` `f1` to `f12`, letters `a` to `z`, digits `0` to `9`.
- Combinations use `+`: `shift+tab`, `ctrl+home`, `alt+down`, `ctrl+alt+right`.
- `nvda` is the NVDA modifier key (Insert): `nvda+t`, `nvda+space`.

Keys are only ever sent to the test browser. If another window is in front, the kit refuses and tells you.

## Browse mode: reading the page

NVDA starts in browse mode on a web page. Single letters jump to the next element of a kind; add `shift` to go to the previous one.

| Key | Jumps to the next |
| --- | --- |
| `h` | heading |
| `1` to `6` | heading at that level |
| `d` | landmark (main, navigation, banner and so on) |
| `k` | link |
| `b` | button |
| `f` | form field of any kind. It also stops on buttons |
| `e` | edit field |
| `c` | combo box |
| `x` | check box |
| `r` | radio button |
| `g` | graphic |
| `t` | table |
| `l` | list |
| `i` | list item |
| `q` | block quote |
| `m` | frame |
| `n` | text that is not a link (skips past a block of links) |

| Key | Does |
| --- | --- |
| `down` / `up` | read the next / previous line |
| `ctrl+home` / `ctrl+end` | top / bottom of the page |
| `enter` | activate the link or button under the reading position |
| `space` | activate a button, or tick a check box |
| `nvda+t` | read the window title |
| `nvda+tab` | describe what has keyboard focus |
| `nvda+up` | read the current line again |
| `nvda+space` | switch between browse mode and focus mode by hand |

## Keyboard focus

| Key | Does |
| --- | --- |
| `tab` / `shift+tab` | move to the next / previous control, exactly as for any keyboard user |
| `enter` / `space` | activate the focused control |
| `escape` | close a menu or dialog; also returns from focus mode to browse mode. When NVDA switched to focus mode by itself, the first `escape` only switches back, and a second one is needed to close the menu |

## Focus mode: operating a control

NVDA switches to focus mode automatically on text fields, combo boxes and custom widgets, and says "Focus mode". In focus mode letters are typed rather than treated as jumps, and arrow keys go to the control.

| Where | Keys |
| --- | --- |
| Combo box, list box | `down` / `up` to change the choice, `alt+down` to open the list |
| Radio group, tab list, menu, slider | arrow keys |
| Text field | type with `node scripts/kit.js type "<text>"` |

## Tables

Move to a table with `t`, then:

| Key | Moves to |
| --- | --- |
| `ctrl+alt+right` / `ctrl+alt+left` | next / previous column |
| `ctrl+alt+down` / `ctrl+alt+up` | next / previous row |

A well-built data table announces the column header when you change column and the row header when you change row.

## Avoid

- `nvda+f7` (elements list), `nvda+n` (NVDA menu), `nvda+q` (quit): these open NVDA's own windows, which take focus away from the browser. Use `sweep` instead of the elements list, and `stop` to quit.
- `alt+tab`, `ctrl+w`, `alt+f4`, `ctrl+t`, the Windows key: these leave or close the test browser.
- `nvda+down` (read everything from here): with silent speech there is nothing to pace it. Use `sweep read`.
