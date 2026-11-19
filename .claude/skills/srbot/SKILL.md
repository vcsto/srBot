---
name: srbot
description: Test a website with the NVDA screen reader. Starts the NVDA installed on this Windows computer, works through the site with the keyboard the way a blind user does, records everything NVDA says, and writes a report. Use when the user gives a web address and asks to test, check, audit or review its accessibility, or asks what a screen reader user experiences on it.
argument-hint: "[web address]"
---

# Test a site with NVDA

The address to test: $ARGUMENTS

If no address was given, ask for one before doing anything else.

Read `CLAUDE.md` in the repository root first if you have not already. Its rules apply to every step here.

## 1. Ask about signing in

Before opening anything, ask the tester these two things together. Use the question tool if one is available.

1. **Does this site need you to sign in?** (Yes / No / Not sure)
2. **If it does, should the sign-in page itself be tested?** (Yes / No, just what is behind it)

These come first because they decide how the session starts. Do not ask anything else yet: the other questions are better once you have seen the site.

## 2. Get ready

Run `node scripts/kit.js doctor`. If anything is marked FIX, help the tester fix it and run it again. Do not continue until it says "Ready to test."

Then tell the tester, in your own words:

- A browser window is about to open, and NVDA will start. While the test runs srBot needs the keyboard, so they should not type or click except when you ask them to sign in.
- NVDA runs silently by default; everything it would have said is recorded. They can ask for sound (`--audible`), or to watch NVDA's words and position on screen (`--watch`).
- They can interrupt you at any time and you will close everything.

## 3. Open the site

```
node scripts/kit.js start <address>
```

The browser opens with **NVDA off**, loads the page, takes a screenshot, and checks whether it is a sign-in page. Open the screenshot and look at it. What happens next depends on what the tester said and what you see. Trust the page over the answer: if they said "no sign-in" and a sign-in page appeared, or said "yes" and the site let you straight in because an earlier sign-in is still remembered, tell them what you found.

**No sign-in page.** NVDA has been started for you and the output shows what it said when the page loaded. Go to step 4.

**Sign-in page, and the tester does not want it tested.** NVDA is off. Say to the tester: "Please sign in in the test browser window, and tell me when you are in." Wait for them. Do nothing in the session while they type. When they say they are done:

```
node scripts/kit.js nvda on
node scripts/kit.js look --full
```

**Sign-in page, and the tester wants it tested.** Test it first, without real credentials:

```
node scripts/kit.js nvda on
```

Check that the fields say their labels, that the Tab order is sensible, that the "forgot password" and "show password" controls are reachable and named, and, if the tester agrees, what NVDA says after submitting the form empty. Never type a real user name, password or code. Then:

```
node scripts/kit.js nvda off
```

Ask the tester to sign in and tell you when they are in, and then run `nvda on` again.

NVDA must be off whenever the tester types their own credentials, because NVDA's log records every key pressed while it runs. srBot refuses to type into password fields itself.

If you cannot tell whether they are signed in, `node scripts/kit.js look` works with NVDA on or off.

## 4. First look, then the questions that matter

```
node scripts/kit.js look --full
node scripts/kit.js sweep headings
```

Open the screenshot and actually look at it. You need two pictures in your head: what a sighted person sees, and what NVDA says. Most findings are the difference between them.

Now ask the tester one to three more questions. Ask only what you could not work out from the page, and only what would change how you test. Name real things you saw.

- **What do people come here to do?** Offer the tasks you can see ("search for a course", "book a ticket", "contact form") and let them choose or add. This decides where the time goes.
- **How far should I go?** This one page, a handful of key pages, or one task from start to finish.
- **May I submit forms?** Ask only if the important tasks involve one. Say exactly what would be sent, and ask whether this is a test environment or the live site.
- **Anything already known to be broken, or recently changed?** So you confirm it instead of rediscovering it.
- **Who will read the report?** Developers who will fix it, or people deciding what to fix. This changes the wording, not the testing.

Keep all the answers, including the two from step 1: they go in the report.

## 5. Plan, briefly

Tell the tester in three or four lines what you are about to test and roughly how long it will take. Then go. Do not wait for approval of the plan unless you are about to do something they have not agreed to.

## 6. Test

Work one page or one task at a time, and keep each run short. After each page, tell the tester in a line or two what you found and what is next. Do not disappear into one long takeover: a tester who cannot see progress will, reasonably, interrupt.

For each page, run the standard checks in one go:

```
node scripts/kit.js pass "<page name>"
```

It takes a full-page screenshot, sweeps the headings, landmarks, graphics, form fields and tab order, **reads the page line by line with the down arrow**, and finishes with the coverage check. On a long page raise the limits with `--tab-max` and `--read-max`. Then open the screenshot and read the output against it.

You are comparing three things, and most findings are a disagreement between them:

- **What a sighted person sees**: the screenshot.
- **What NVDA says**: the recording. This is the evidence.
- **What the page gives NVDA to work with**: `node scripts/kit.js outline` lists every role, name and state the browser exposes. `outline --text` includes the plain text too.

Line-by-line reading matters as much as the sweeps. The single-letter keys and Tab only find things that are already marked up as headings, links or controls. The down arrow is how an NVDA user actually reads, and it is the only way to hear plain text, reading order, and what is said about things that are visible but not interactive.

The coverage check at the end of `pass` lists named things the browser exposes that NVDA has not said. Go through that list: each one is either off-screen content, a sweep that stopped early, or something a screen reader user cannot reach.

When NVDA says "Unlabeled" or a bare "clickable", srBot looks up the markup behind the words automatically and prints it under the step as `markup:`. For anything else that sounds wrong, run `find` yourself.

Use `node scripts/kit.js note "<what you are testing>"` at the start of each task so the recording has headings.

### What the page checks are looking for

| What you are checking | Command | What good sounds like |
| --- | --- | --- |
| The page says what it is | first announcement after load, then `press nvda+t` | A title that names this page and the site |
| Headings give an outline | `sweep headings` | Every visible section heading is announced, with levels that nest sensibly, starting from one level 1 |
| Regions can be jumped to | `sweep landmarks` | At least "main landmark"; navigation, banner and content info where the page has them |
| Images are described or skipped | `sweep graphics` | Meaningful images have short, accurate descriptions; decorative ones are not announced at all |
| Everything works from the keyboard | `sweep tab` | Every control is reached, in an order that follows the page, and each one says its name, what it is, and its state |
| Form fields are labelled | `sweep fields` | Each field says its label, its type, and "required" when it is |
| Reading order makes sense | `sweep read --max 60` on the main content | The text comes out in the order a sighted person would read it |

Compare each sweep with the screenshot. NVDA cannot tell you what is missing. If the page plainly shows five section titles and the headings sweep finds one, that gap is the finding.

### On the tasks the tester chose

Do the task the way an NVDA user would: move to the control with Tab or a single-letter key, activate it with `enter` or `space`, and listen.

- **Buttons that open something** (menus, accordions, dropdowns): does NVDA say "collapsed" before and "expanded" after? Does focus go into what opened? Does `escape` close it and return focus to the button?
- **Dialogs**: after opening, does NVDA say "dialog" and its title? Does Tab stay inside it? Does `escape` close it? Where is focus afterwards? Use `look` to confirm what is on screen.
- **Forms**: with the tester's agreement, submit with a required field empty. Is the error announced without you going to look for it? Is focus moved to the problem? Does the field say "invalid entry" and the error text when you Tab back to it?
- **Things that update without a page load** (search results, "added to basket", filters): after the action, does NVDA announce the change by itself?
- **Tables**: `press t`, then `ctrl+alt+right` and `ctrl+alt+down`. Does NVDA say the column and row headers as you move?
- **Custom widgets** (tabs, sliders, date pickers, carousels): does NVDA name the role, and do the arrow keys work once you are in focus mode?

When something looks wrong, repeat it once to be sure it is repeatable, and run `look` so there is a screenshot of that moment. Then run `node scripts/kit.js find "<words NVDA said>"` to see the markup behind it. That is what lets you write a fix a developer can act on, and it must be done before you stop the session.

When a sweep produces a long run of similar results, do not keep going for the sake of it. Twenty unlabeled images are one finding with twenty instances.

If the site signs the tester out or asks for a password again partway through, run `nvda off`, ask them to sign in, and run `nvda on` when they are back.

### Pauses, stops and carrying on

srBot stops pressing keys by itself when the tester presses a key or brings another window to the front. A command then answers "Paused: ...". When that happens:

1. Do not retry and do not work around it. The tester has taken the computer back.
2. Tell them srBot has paused, and ask whether to carry on or stop.
3. To carry on: `node scripts/kit.js resume`, then `look`, because the page may have changed. If they typed anything private while paused, that is another reason NVDA should have been off: say so.

If the tester interrupts you, or says stop, wait, or hold on: run `node scripts/kit.js stop` (or `pause` if they only want a moment) before you reply. An interruption in the chat does not stop the session by itself.

To carry on a run after a stop, start with `node scripts/kit.js start <address> --continue`. The same recording and report continue, with the step numbers carrying on. The recording has a heading for each page you tested, so read `transcript` to see where you were.

### Judging what you hear

Read `knowledge/reading-nvda.md` before you decide anything is a defect. It lists what is normal NVDA and Chrome behaviour, which phrases point to which problems, and the mistakes that are easy to make.

## 7. Stop

```
node scripts/kit.js stop
```

Do this now, before writing anything up, so the tester gets their computer back. Tell them it is theirs again.

`stop` also opens a page in the tester's own browser that says TESTING IS DONE, served from this computer only. It is the signal that srBot has let go of the keyboard. Use `stop --quiet` when you are stopping only for a moment and will carry on with `--continue`.

## 8. Write the findings and build the report

Reread the recording with `node scripts/kit.js transcript`. Then write `findings.json` in the run folder, following `knowledge/report-format.md`.

The report is one table of the places where you disagree with NVDA: where, what NVDA said, what it should have said, and why. Nothing else goes in it. Do not list keys pressed or things that were fine.

- One row per problem, not per instance. Say how many instances there were and quote one or two.
- Quote NVDA exactly, with the step numbers. The report builder checks every quote against the recording and refuses to build if one does not match.
- Say what it should have said, as the announcement itself: "Home, link", not "a better label".
- Keep `why` to one or two sentences, and include the cause in the markup when you found it.
- Grade severity by what it does to someone trying to finish a task, using the scale in `knowledge/report-format.md`.
- Fill in `checked` and `notCovered` honestly. They are what tells the reader what an absence of rows means.
- Put things NVDA said that sound wrong but are not the site's fault in `notCounted`.

Then:

```
node scripts/kit.js report
```

If it lists problems with `findings.json`, fix them and run it again. Do not use `--allow-unverified` to get past a quote that does not match; correct the quote.

## 9. Tell the tester

Give them:

- The same table as the report, in the chat: where, what NVDA said, what it should have said, and why, worst first. If there are more than about a dozen rows, show the most serious ones and say how many more are in the report.
- What you did not cover.
- The path to `report.html` (it is one file they can open, email or attach to a ticket) and `report.csv` (the same rows for a bug tracker).

Do not add a summary of what worked, and do not describe the keys you pressed.
