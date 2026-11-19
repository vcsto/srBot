# Reading what NVDA says

NVDA announces an element as a short run of pieces: its **name**, its **role**, and its **state**. In the transcript the pieces are separated by commas:

```
"Subscribe to newsletter, check box, not checked"
 name                     role       state
```

A good announcement lets someone who cannot see the page answer three questions: what is this, what kind of thing is it, and what condition is it in. Most defects are one of those three missing or wrong.

## Normal, not a defect

| NVDA says | Why |
| --- | --- |
| The page title followed by "document" | Announced whenever a page loads or gets focus |
| "Focus mode" / "Browse mode" | NVDA switching between typing into a control and reading the page. Expected on text fields, combo boxes and custom widgets |
| "list with 6 items", "table with 3 rows and 4 columns" | Entering a list or table. Correct when the content really is one |
| "same page link" | A link to another part of the same page, such as a skip link |
| "visited link" | The test browser has been to that address before |
| "clickable" after a name | The element or a parent has a click handler. On its own this is noise, not a failure |
| "no next heading", "no next landmark" | End of that kind of element. Only a problem if the page visibly has more |
| A step with focus outside the page | Tab has reached the browser's own toolbar. That is the end of the page's tab order |

## Phrases that point to a problem

| NVDA says | Likely cause | WCAG |
| --- | --- | --- |
| "Unlabeled graphic", often with "To get missing image descriptions, open the context menu." | Chrome judges that the image has no useful description. Either there is no alt text at all, or the alt text is too short or generic to count (in testing, `alt="W3C logo"` was still announced as unlabeled). Run `find` on the words NVDA read to see which | 1.1.1 |
| "graphic" with a name that looks like a file or an id: "nav_home", "IMG_2041", "1234 56789" | No alt text, so the name came from another attribute, or the alt text is a placeholder nobody replaced. Compare with the screenshot: the image may show something entirely different | 1.1.1 |
| "graphic" with a description of something purely decorative (a divider, a bullet, a background flourish) | A decorative image that should be hidden from screen readers | 1.1.1 |
| "button" or "link" with no name before it | A control with no accessible name, often an icon-only button | 4.1.2, 2.4.4 |
| "edit", "combo box", "check box" with no name | A form field with no label attached | 1.3.1, 3.3.2, 4.1.2 |
| A name that is a symbol read literally: "times", "greater than", "bullet" | A glyph such as × or › used as the only content of a control | 1.1.1, 4.1.2 |
| "clickable" and nothing else, or text with no role that the screenshot shows is a button | A div or span with a click handler and no role. Check whether Tab reaches it at all | 4.1.2, 2.1.1 |
| "link" repeated with the same vague name: "click here", "read more", "more" | Link text that does not say where it goes | 2.4.4 |
| A toggle, menu button or accordion that never says "expanded" / "collapsed" / "pressed" | State is shown visually but not exposed | 4.1.2 |
| "no next heading" when the screenshot shows section titles | Titles are styled text, not real headings | 1.3.1, 2.4.6 |
| Heading levels that jump (1 then 4) or several level 1s for minor sections | Headings chosen for their size, not their meaning | 1.3.1 |
| "no next landmark" on a page with a header, menu, content and footer | No landmark regions, so there is no way to jump past the menu | 1.3.1, 2.4.1 |
| "table" announced around page layout, with "row 1 column 5" on ordinary content | Layout tables. Every cell boundary is read aloud | 1.3.1 |
| A data table where moving between cells announces no header | Header cells not marked up | 1.3.1 |
| Nothing at all after Tab, with no element focused | Focus was thrown away (for example by a script) or moved to something hidden | 2.1.1, 2.4.3 |
| Nothing at all after Tab, but an element does have focus | The focused element has no name and no role NVDA can announce | 4.1.2 |
| Tab order that jumps around the page compared with the screenshot | Positive `tabindex` values or content reordered visually | 2.4.3 |
| Tab cycles inside one area and never leaves, and it is not an open dialog | Keyboard trap | 2.1.2 |
| Nothing after activating something that visibly changed the page (results loaded, item added, error shown) | A dynamic update with no live region, or an error that is only visual | 4.1.3, 3.3.1 |
| A dialog opens on screen but NVDA does not say "dialog", and Tab keeps going through the page behind it | The dialog is not exposed as one and focus is not moved into it | 4.1.2, 2.4.3 |
| The page title is the same on every page, or is a file name | Pages not individually titled | 2.4.2 |
| A field announced without "required" when the screenshot shows an asterisk | Required state shown only visually | 3.3.2, 1.3.1 |

## Mistakes that are easy to make

- **Calling silence a defect without checking focus.** "(NVDA said nothing)" has different causes. Look at the focus line: no focused element means focus was lost; a focused element means it is unnamed; focus outside the page means the page's tab order ended.
- **Reporting NVDA's wording as the site's fault.** "Clickable", "Focus mode" and list or table announcements come from NVDA. Judge whether the underlying structure is right, not whether the wording is pretty.
- **Treating long alt text as a failure by itself.** A long description is a problem only if the image does not need it. Compare with the screenshot.
- **Trusting a sweep to find what is not marked up.** A headings sweep only finds real headings. Something that looks like a heading and is not one will be absent from the sweep; you find it by comparing with the screenshot or with `sweep read`.
- **Testing once.** If a result is surprising, repeat it. Pages still loading, animations and timing can produce one-off oddities. Report what repeats.
- **Generalising to all screen readers.** This is NVDA with one browser. JAWS, Narrator and VoiceOver differ in wording and sometimes in behaviour. Say "NVDA with Chrome", not "screen readers".
- **Forgetting the sighted comparison.** NVDA reading something fluently does not mean it is right. An image announced as "chart" is technically labelled and still useless if the chart shows quarterly sales.

## Finding out why NVDA said it

`node scripts/kit.js find "<words>"` searches the page's own markup for text NVDA spoke and prints the matching elements with their attributes and their parent:

```
node scripts/kit.js find nav_home
  <img name="nav_home" src="./img/nav_home.gif" width="88" height="27">
      inside <a href="javascript:location.href='home.html';" onfocus="blur();">
```

That one lookup explains two findings: the image has no alt attribute, and the link throws focus away the moment it receives it. Use `find` to turn "NVDA said something odd" into a fix a developer can act on. It is a lookup, not evidence: the finding is still what NVDA said.

If single letters stop doing anything, NVDA is in focus mode. `node scripts/kit.js status` says which mode it is in; `press nvda+space` switches. Sweeps switch back to browse mode by themselves.

## When you are not sure

Say so. Put it in the report as a finding of minor severity with "needs a second look by a person" in the fix, or list it under what was not covered. A hedged true statement is worth more than a confident wrong one.
