# Writing findings.json

After a test, write `findings.json` in the run folder (next to `transcript.jsonl`). `node scripts/kit.js report` turns it into `report.html` and `report.csv`.

The report is one table. Each row is a place where you disagree with NVDA: what it said, what it should have said, and why. Nothing else goes in the table. Keys pressed, things that passed, screenshots and long explanations stay out; the recording and screenshots are in the run folder for anyone who wants them.

## Format

```json
{
  "title": "NVDA screen reader test: Example Shop",
  "checked": [
    "Home page: page title, headings, landmarks, images, form fields, Tab order, and the whole page read line by line",
    "Search: entering a term and reading the results"
  ],
  "findings": [
    {
      "severity": "serious",
      "page": "Home",
      "where": "Main menu, four image links",
      "nvdaSaid": ["nav_home, Unlabeled graphic, link", "nav_news, Unlabeled graphic, link"],
      "expected": "Home, link. News, link.",
      "why": "The menu images have no text alternative, so NVDA reads their file names.",
      "steps": [14, 15]
    },
    {
      "severity": "moderate",
      "page": "Home",
      "where": "Filter button, when pressed",
      "nvdaSaid": ["Filter, button"],
      "silent": true,
      "expected": "Filter, button, collapsed. After pressing: expanded.",
      "why": "Pressing it opens a panel but the button has no aria-expanded, so NVDA says nothing.",
      "steps": [31]
    }
  ],
  "notCovered": [
    "Checkout past the delivery step (would have placed a real order)"
  ],
  "notCounted": [
    {
      "nvdaSaid": "Company logo. To get missing image descriptions, open the context menu., Unlabeled graphic",
      "why": "The image has a text alternative. \"Unlabeled graphic\" is Chrome's opinion of a short generic description, not a missing one.",
      "steps": [9]
    }
  ]
}
```

## Top-level fields

| Field | Required | What to write |
| --- | --- | --- |
| `title` | yes | What was tested |
| `checked` | yes | The pages and the checks that were run. A reader needs this to know what an absence of rows means. One string per page or task |
| `findings` | yes | The rows of the table. May be empty |
| `notCovered` | yes | What you did not check and, where it matters, why. May be empty, but it rarely should be |
| `notCounted` | optional | Things NVDA said that sound wrong but are not the site's fault, so that nobody raises them again |

## Fields in a finding

| Field | Required | What to write |
| --- | --- | --- |
| `severity` | yes | `critical`, `serious`, `moderate` or `minor` (see below). The table is sorted by it |
| `page` | optional | A short page name, such as "Home". Use it when more than one page was tested; the report then shows a Page column |
| `where` | yes | Which part of the page, in words a tester would use |
| `nvdaSaid` | yes, unless `silent` | NVDA's exact words, copied from the transcript. One string or a list |
| `silent` | when it applies | `true` when the problem is that NVDA said nothing. It can be combined with `nvdaSaid` when NVDA said something and then went quiet |
| `expected` | yes | What it should have said, written as the announcement itself |
| `why` | yes | One or two sentences: why that is wrong for a listener, and the cause in the markup if you found it |
| `steps` | yes when quoting | The transcript step numbers the quotes come from. They are used to check the quotes and are not shown |

## Quotes are checked

Every string in `nvdaSaid` must appear word for word in what NVDA said at the cited steps. Case and spacing are ignored. To shorten a long announcement, replace the middle with `...`:

```
"Red dot with a white letter 'C' ... graphic, same page, link"
```

If a quote does not match, the report is not built and the message names the quote. Copy it again from `node scripts/kit.js transcript`.

## What belongs in the table

A row is a disagreement between you and NVDA. Before adding one, be able to say what it should have said instead.

- Do not add rows for things that were fine.
- When the same defect appears many times, write one row, say how many there were in `where` or `why`, and quote one or two.
- When two things NVDA said have one cause, say so in `why` on both rows.
- If you saw something once and could not repeat it, say "Seen once" in `why`.
- If something might be NVDA or browser behaviour and not a site defect, either leave it out or put it in `notCounted`.

## Severity

Grade by what happens to someone trying to finish a task, not by how many rules are involved.

| Severity | Meaning | Example |
| --- | --- | --- |
| `critical` | A screen reader user cannot complete the task | The submit button cannot be reached with the keyboard; a dialog traps focus with no way out |
| `serious` | Possible only with real difficulty, guesswork or help | Menu links announced as file names; form fields with no labels |
| `moderate` | Confusing or slow, but the task gets done | No headings to navigate by; a toggle that never says whether it is open |
| `minor` | An annoyance, or a departure from good practice | A decorative image that is announced; a heading level skipped |

## Writing for the reader

The reader knows accessibility. Write for someone who will act on the row without asking you anything.

- `expected` is something you could say out loud: "Search, button", not "an appropriate accessible name".
- `why` names the cause, not the principle: "The label and the placeholder are both the word Search", not "labels should be descriptive".
- Never call a site "accessible" or "compliant", and do not give scores or pass rates.
