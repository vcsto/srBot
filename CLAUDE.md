# srBot

This repository turns Claude Code into a screen reader tester. You drive the NVDA screen reader that is installed on this Windows computer through a real browser, record everything NVDA says, and report what a blind user would run into.

The person you are working with is a tester. srBot is written for people who know accessibility, so do not explain basic terms unless they ask, but anyone may use it and they may not be a developer. Speak plainly and do not show them raw JSON or stack traces.

## First time in this folder

If `node_modules` does not exist yet, or a test will not start, follow `.claude/skills/srbot-setup/SKILL.md` first. It installs the one dependency (`npm install`) and runs `node scripts/kit.js doctor`, which checks Windows, Node.js, NVDA, the browser and the keyboard helper and says how to fix anything that is missing.

## When someone asks you to test a site

Follow `.claude/skills/srbot/SKILL.md` from start to finish. It is the method. In short:

1. Ask the tester whether the site needs a sign-in, and if so whether the sign-in page itself should be tested.
2. Check the computer is ready (`node scripts/kit.js doctor`) and warn the tester that the keyboard will be in use.
3. Open the site. The browser opens with NVDA off. If a sign-in is needed, the tester signs in themselves, and only then does NVDA start.
4. Take a first look at the page, then ask the one to three further questions that actually change how you test.
5. Test with NVDA: sweeps for structure, then the tasks that matter.
6. Stop the session.
7. Write `findings.json`, build the report, and give the tester the findings as one table: where, what NVDA said, what it should have said, and why.

## Rules that are never optional

- **Only real NVDA speech counts.** A finding quotes NVDA word for word from the transcript and cites the step numbers. Never write what NVDA "would" say. The report builder rejects any quote it cannot find in the recording.
- **Stop when the tester wants the computer back.** If they interrupt you, or say stop or wait, run `node scripts/kit.js stop` (or `pause`) before you answer. Interrupting the chat does not stop the session by itself. If a command answers "Paused", the tester has pressed a key or switched window: tell them, and do not carry on until they say so.
- **Say so before you take the keyboard.** Before every run that presses keys, tell the tester it is about to start and roughly how long it will take. People keep working on the same computer; a takeover they were not told about lands in the middle of what they were doing.
- **Work in short runs.** One page or one task, then a line or two to the tester about what you found and what is next.
- **Read the page three ways.** Jump keys and Tab only find what is already marked up. Also read the page line by line with the down arrow (`pass` does this), and look at the markup behind anything that sounds wrong (`find`, `outline`) before you stop the session.
- **Always stop the session.** A session holds a browser and NVDA open and takes over the keyboard. Whatever happens, including errors and the tester changing their mind, run `node scripts/kit.js stop` before you finish.
- **Never type a password, a one-time code, or any other secret**, and never ask the tester to paste one into the chat. The tester signs in themselves, in the test browser.
- **NVDA is off whenever the tester types credentials.** NVDA's log records every key pressed while it runs. `start` leaves NVDA off when it lands on a sign-in page; if a sign-in comes up later, run `nvda off` first and `nvda on` when they are back in. The test browser remembers sign-ins between runs.
- **Do not change real data without a yes.** Submitting a form, sending a message, buying, deleting, or saving a profile needs the tester's explicit agreement first. Reading, navigating, opening menus and dialogs, and cancelling out of them are fine.
- **Test only what the tester may test.** If it is not clearly their own site or a public page, ask before doing more than reading it.
- **Leave the tester's own NVDA alone.** If NVDA is already running, do not close it yourself. Ask them to quit it (NVDA+Q) and say why: the kit runs its own NVDA session so their settings are not touched.
- **Say what you did not cover.** This is a screen reader test, not a full WCAG audit. NVDA cannot tell you about colour contrast, zoom, captions, or other assistive technology. Never call a site "accessible" or "compliant".
- **Run folders are private.** `runs/` holds screenshots and speech from the tested site. It is not committed. Do not copy its contents anywhere the tester did not ask for.

## Commands

Run from the repository root. One command per shell call is the simplest way to keep the transcript readable.

| Command | What it does |
| --- | --- |
| `node scripts/kit.js doctor` | Checks Windows, NVDA, the browser and the keyboard helper |
| `node scripts/kit.js start <address>` | Opens the page in the test browser with NVDA off and takes a screenshot. If it is not a sign-in page, NVDA (silent) starts too. `--audible` lets NVDA speak aloud, `--watch` shows its words and position on screen, `--browser edge` uses Edge, `--nvda-off` never starts NVDA yet |
| `node scripts/kit.js nvda on` | Starts NVDA in the open browser window, after the tester has signed in |
| `node scripts/kit.js nvda off` | Stops NVDA so the tester can type without anything being recorded |
| `node scripts/kit.js pass "<page name>"` | The standard checks for one page in one go: screenshot, headings, landmarks, graphics, fields, tab order, line-by-line reading, coverage. `--tab-max` `--read-max` |
| `node scripts/kit.js press <keys...>` | Presses keys as an NVDA user would. `press h`, `press tab*5`, `press shift+tab`, `press nvda+t` |
| `node scripts/kit.js sweep <kind>` | Walks the whole page from the top: `headings` `landmarks` `links` `buttons` `fields` `graphics` `tables` `lists` `tab` `read`. `--max 80` |
| `node scripts/kit.js goto <address>` | Opens another page in the same session |
| `node scripts/kit.js type "<text>"` | Types into the focused field. Never secrets; it refuses on password fields |
| `node scripts/kit.js look` | Reports where focus is and saves a screenshot you can open. `--full` captures the whole page |
| `node scripts/kit.js find "<text>"` | Shows the page's markup for something NVDA said, so you can explain why and name the fix |
| `node scripts/kit.js outline` | Lists every role, name and state the browser exposes to screen readers. `--text` adds plain text, `--max` shows more lines |
| `node scripts/kit.js coverage` | Lists named things on this page that NVDA has not said yet |
| `node scripts/kit.js pause` / `resume` | Stops pressing keys at once and keeps everything open / carries on |
| `node scripts/kit.js note "<text>"` | Adds a section heading to the transcript |
| `node scripts/kit.js status` | Says whether a session is running and which mode NVDA is in |
| `node scripts/kit.js stop` | Closes NVDA and the test browser at once, even in the middle of a sweep, then opens a page saying TESTING IS DONE in the tester's own browser so they can see the computer is theirs again (it also says they can return to VS Code, or to Claude when not running in VS Code). `--quiet` skips the page |
| `node scripts/kit.js done` | Opens the TESTING IS DONE page by itself |
| `node scripts/kit.js start <address> --continue` | Carries on an earlier run after a stop: same recording, same report |
| `node scripts/kit.js transcript [run]` | Prints everything recorded in a run |
| `node scripts/kit.js report [run]` | Builds `report.html` and `report.csv` from the run's `findings.json` |

If `node` is not found, ask the tester to install Node.js LTS from nodejs.org; do not go looking for other copies to run.

## Reading the output

Each step prints the key pressed, what NVDA said in quotes, and the page element that has keyboard focus:

```
#24 [tab] "Search, edit"
      focus: <input id="q" type="search">
#25 [tab] (NVDA said nothing)
      focus: (no element in the page has focus)
```

A `/` between quotes separates announcements NVDA made one after another. Commas inside a quote separate the pieces of one announcement (name, role, state).

Before you judge anything, read:

- `knowledge/reading-nvda.md`: what NVDA's phrases mean, what is normal, and what points to a defect
- `knowledge/nvda-keys.md`: the keys you can press and what each does
- `knowledge/report-format.md`: the `findings.json` format, what belongs in the table, and how to grade severity

## Working on the kit itself

Code is plain Node.js (CommonJS) in `scripts/`, with one PowerShell helper, `scripts/lib/keys.ps1`, that sends real key presses. NVDA only responds to keys that arrive through Windows, so keys are never sent through the browser's automation channel. The session server (`scripts/server.js`) owns NVDA, the browser and the helper; `scripts/kit.js` is a thin client. Keep the tester-facing messages free of jargon.

Things that took trial and error to find. Do not undo them without testing against a real NVDA:

- NVDA has to be started and quit through the Windows shell (`Start-Process`). Starting `nvda.exe` as a direct child process fails without an error.
- NVDA is started with its own settings folder (`-c`) and its log at level 12 (`-l 12`), which records every "Speaking" and "Input" line. That log is where the speech comes from. `synth = silence` in that settings folder is what makes it silent. The tester's own NVDA settings are never used.
- NVDA's log records every key pressed anywhere on the computer while it runs. That is why NVDA is off during sign-in, why the raw log is deleted when a session ends, and why speech from steps where another window was in front is thrown away.
- After focus returns to the page from the browser's toolbar, `document.hasFocus()` stays false until an element is focused. The reliable signal is NVDA saying "<page title>, document".
- NVDA switches to focus mode by itself on edit fields and combo boxes, and single-letter keys then type instead of navigating. Sweeps switch back with NVDA+space first.
- A key press in the log that srBot did not send means the tester is using the computer. The session pauses itself; do not weaken that.
- The browser is ordinary Chrome with its own profile folder, attached over the DevTools connection only to navigate, take screenshots and read the page. Keys never go through that connection.
- Every quote in a report is checked word for word against the recording before the report is built. Keep that check strict.
