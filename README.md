# srBot

Point Claude at a website and it tests the site with the NVDA screen reader on your computer, the way a blind person would use it, then gives you a report of what it found.

You do not need to know how to drive a screen reader, and you do not need to write code. The report is written for someone who knows accessibility: it shows what NVDA said, what it should have said, and why.

## What it does

1. You give Claude a web address.
2. Claude asks whether the site needs a sign-in, and whether the sign-in page itself should be tested.
3. A browser window opens on the site. If it needs a sign-in, you sign in yourself, and Claude waits.
4. Claude starts NVDA, looks at the site, and asks one to three more questions, such as which tasks matter most and whether it may submit forms.
5. Claude works through the site with the keyboard: headings, images, links, forms, menus, dialogs, and the tasks you chose. Everything NVDA says is recorded.
6. When the testing is finished, a page saying TESTING IS DONE opens in your own browser. The computer is yours again.
7. You get a report: one table of the places where NVDA should have said something else, with what it said, what it should have said, and why.

## What you need

- A Windows computer
- [NVDA](https://www.nvaccess.org/download/), installed (it is free)
- Google Chrome or Microsoft Edge
- [Node.js](https://nodejs.org), the LTS version
- [Claude Code](https://claude.com/claude-code)

## Set up (once)

1. Download or clone this repository.
2. Open the folder in Claude Code.
3. Type `/srbot-setup` and follow along. Claude installs what srBot needs and checks your computer is ready.

Claude Code will ask whether you trust this folder. The repository includes a small settings file that lets Claude run srBot's own command, `node scripts/kit.js`, without asking you each time. A test involves many key presses, and approving each one by hand would be unworkable. It grants nothing else.

## Run a test

Type:

```
/srbot https://example.com
```

or just ask: "Test example.com with NVDA."

### What to expect

- **Hands off the keyboard and mouse.** A browser window opens and NVDA starts. While the test runs srBot is pressing keys, so anything you type would land in the test. A test of one page takes a few minutes; a full task takes longer.
- **It is silent by default.** NVDA runs without sound and its speech is captured as text. Ask Claude to run it "with sound" if you want to listen.
- **You can take the computer back at any time.** Press any key, or click on another window: srBot notices and stops pressing keys by itself. Tell Claude whether to carry on or stop. Telling Claude "stop" closes NVDA and the browser straight away, even in the middle of a page.
- **A stopped test can be carried on later.** Claude reopens the browser and continues the same recording and report.
- **Claude works one page at a time** and tells you what it found before moving on.
- **Your own NVDA settings are not touched.** srBot starts NVDA with separate settings of its own. If NVDA is already running, Claude will ask you to close it first.

### Sites that need a sign-in

Claude asks about this before it opens anything. The test browser always opens with NVDA switched off. If the site shows a sign-in page, Claude asks you to sign in in that window and waits until you say you are in. Only then does it start NVDA, in the same window.

- Claude never sees or types your password. srBot refuses to type into password fields at all.
- Nothing you type while signing in is recorded, because NVDA is not running yet.
- The test browser remembers the sign-in, so later tests of the same site usually go straight in.
- If you want the sign-in page itself tested, Claude does that first with NVDA on and no real credentials (labels, keyboard order, error messages), then switches NVDA off for you to sign in.

## What you get

Each test has its own folder under `runs/`:

| File | What it is |
| --- | --- |
| `report.html` | The report. One file you can open, email, or attach to a ticket. It is a single table: where, what NVDA said, what it should have said, and why, worst first. Below it is a list of what was not covered |
| `report.csv` | The same rows as a spreadsheet, for a bug tracker |
| `transcript.txt` | Everything NVDA said, step by step |
| `shots/` | Screenshots taken during the test |

Every NVDA quote in the report is checked against the recording when the report is built, so the report cannot contain something NVDA did not say.

## What it does not do

This is a screen reader test with NVDA and one browser. It is strong evidence about what blind users experience on the pages tested. It is not a complete accessibility audit:

- It does not check colour contrast, zoom, captions, or anything else a screen reader cannot perceive.
- It does not cover JAWS, VoiceOver, Narrator, or mobile screen readers, which can behave differently.
- It tests the pages and tasks you chose, not the whole site.
- It does not replace testing by people who use a screen reader every day.

The report states what was and was not covered.

## Privacy

- Everything stays on your computer. The `runs/` folder, the saved sign-in, and the test browser profile are excluded from git.
- NVDA's own log records every key press and everything spoken anywhere on the desktop, including other applications. srBot keeps only its own transcript of the test and deletes NVDA's log when the test ends.
- Screenshots and transcripts contain content from the site you tested. Treat the `runs/` folder accordingly.

## If something goes wrong

| Problem | What to do |
| --- | --- |
| NVDA is still running after a test | Press NVDA+Q (Insert+Q), or ask Claude to run `node scripts/kit.js stop` |
| "NVDA is already running" | Quit your NVDA with NVDA+Q and try again |
| "The keyboard helper did not start" | PowerShell scripts may be blocked on your computer. Ask your IT team |
| "The test browser is not the window in front" | Something else took focus. Close pop-ups and notifications and ask Claude to continue |
| Not sure what is wrong | Ask Claude to run `node scripts/kit.js doctor` |

## Commands

Claude runs these for you, but they also work by hand from the repository folder. Run `node scripts/kit.js help` for the full list.

```
node scripts/kit.js doctor                 check the computer is ready
node scripts/kit.js start <address>        open the page; NVDA starts too unless it is a sign-in page
node scripts/kit.js nvda on                start NVDA once you have signed in
node scripts/kit.js nvda off               stop NVDA (for example before signing in again)
node scripts/kit.js pass "Home page"       all the standard checks for one page, including line-by-line reading
node scripts/kit.js sweep headings         walk every heading on the page
node scripts/kit.js outline                what the browser exposes to screen readers on this page
node scripts/kit.js pause                  stop pressing keys, keep everything open (resume to carry on)
node scripts/kit.js press tab tab enter    press keys as an NVDA user would
node scripts/kit.js stop                   close NVDA and the browser, then show the TESTING IS DONE page
node scripts/kit.js report                 build the report for the latest test
```

## How it works

NVDA can write everything it says to a log file. srBot starts NVDA with that turned on and with its own settings folder, opens your normal Chrome with a separate profile, and sends real key presses through Windows so that NVDA treats them exactly like a person typing. After each key it reads what NVDA said and notes which element on the page has focus. Claude decides what to press next and compares three things: what the page looks like, what NVDA says, and what the page's markup gives NVDA to work with. The differences are the findings. NVDA's words are the evidence; the markup explains them and points to the fix.
