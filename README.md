# Inkwell — Writing Studio

A locked-down writing tool for English classes. Students write in a full-screen word processor; leaving the window locks them out until the teacher clears them. Teachers watch the class live, comment right on the writing, and grade with rubrics.

- **Students:** `index.html` — sign in with a code, see assignments, write, look back at past work and feedback.
- **Teacher:** `teacher.html` — Live, Grade, Assignments, Classes & students (with per-student records), Settings.
- **Backend:** `backend/Code.gs` — Google Apps Script bound to a Google Sheet that stores everything.

## Features

**Student writing mode**
- Opens only when the assignment is open (class periods, any time between dates, or only when the teacher opens it). Closed on school days off and for students marked absent.
- Full screen. Switching tabs/apps, clicking outside, exiting full screen, closing or reloading → locked until cleared.
- Word processor: Title / Heading / Normal, bold, italic, underline, alignment, first-line indent (Tab), block quote, lists, undo/redo, double-spacing.
- Word and character counts, word-goal progress bar, class-time countdown.
- **Spell check** built in (Canadian English Hunspell dictionary, runs in the browser): red squiggles, click for suggestions, ignore / add to my dictionary. No grammar checking.
- **Dictionary & thesaurus** panel (right-click a word → Look up); click a synonym to swap it in.
- **Accommodations:** read aloud (prompt and own writing, word highlighting, speed control) and speech-to-text (with spoken punctuation: "period", "comma", "new paragraph"…). Per student, or for everyone on an assignment.
- **Teacher comments** appear live as highlights with a side list; students check them off when done.
- **Read-only copy** of their work any time, even when the assignment is closed — with rubric feedback once the teacher releases it.
- Paste from outside blocked; big inserted chunks blocked; autosave every few seconds.

**Teacher dashboard**
- **Live:** status cards (writing / idle / not here / locked / submitted / absent / not started), words, goal bar, time open vs. actively typing, flags; clear locks; attendance; open/close; simulate class (demo).
- **Student drawer:** live view with highlight-to-comment, playback, time breakdown (typing / open not typing / locked), read-only views, keystroke stats, dictated characters, lookups, timeline.
- **Grade:** student list with scores, the writing with highlight-to-comment, a clickable rubric, overall comment, "graded" toggle, save & next, release feedback to students.
- **Rubrics:** editor per assignment; start from pre-built rubrics (narrative, literary analysis, argumentative, expository, short story, paragraph, Alberta-style personal response) or copy one from another assignment; levels, points, weights.
- **Print all:** a PDF with each student's name on every page and a blank page added after anyone who ends on an odd page, so double-sided printing keeps each student on separate sheets. Optional feedback page.
- **Student record:** every assignment for one student with scores, rubrics, comments, time and flags, absences — printable.
- **School calendar:** pick days off on a year calendar (click or drag), with Alberta holidays one click away.
- Classes with schedules, rosters, printable sign-in cards, accommodations. Exports to Word and CSV (with rubric scores).
- Demo data + "Simulate class". Demo student code: `TEST-0001`.

## Setup (for a new teacher account)

1. Create a Google Sheet, then **Extensions → Apps Script**. Replace `Code.gs` with `backend/Code.gs`.
2. Run `setup` once (authorize when asked). The starter teacher password is `english2026` — change it in Settings.
3. **Deploy → New deployment → Web app**, Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
4. Put that URL in `js/config.js` (or open the site once with `?api=<url>` to save it in that browser).
5. Host the folder on GitHub Pages (or any static host).

To update the backend later: paste the new code, save, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (keeps the same URL). The sheet's layout upgrades itself on the next request — existing data is kept.

## Third-party pieces

- `vendor/typo.js` (Typo.js, BSD) and `vendor/dict/en_CA.*` (Hunspell en_CA dictionary — see `vendor/dict/LICENSE`) for spell check.
- `vendor/pdf-lib.min.js` (pdf-lib, MIT) for Print all.
- Definitions from the Free Dictionary API (dictionaryapi.dev); synonyms from Datamuse. Both are free and need no key; the student's browser calls them directly.
- Read aloud and speech-to-text use the browser's built-in speech features (best in Chrome / Chromebooks).

## Development

```
node dev/test-backend.js        # core backend flows against a mock of Apps Script
node dev/test-backend-v2.js     # v2 features, including upgrading a v1 sheet
dev/run-e2e.sh                  # fresh local server + headless browser walk-through of everything
node dev/server.js 8080         # local site + mocked backend at http://localhost:8080
```
