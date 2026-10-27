# Inkwell — Writing Studio

A locked-down writing tool for English classes. Students write in a full-screen word processor; leaving the window locks them out until the teacher clears them. Teachers watch the class live.

- **Students:** `index.html` — sign in with a code, see assignments, write.
- **Teacher:** `teacher.html` — live dashboard, assignments, classes & rosters, settings.
- **Backend:** `backend/Code.gs` — Google Apps Script bound to a Google Sheet that stores everything.

## Features

**Student writing mode**
- Opens only when the assignment is open (during class periods, any time between dates, or only when the teacher opens it). Per-student *extended access* for accommodations.
- Full screen. Switching tabs/apps, clicking outside, exiting full screen, closing or reloading the page → locked until cleared. Optional lock when re-opening after an unexpected exit; opening in a second tab/device always locks.
- Word processor: Title / Heading / Normal, bold, italic, underline, alignment, first-line indent (Tab), block quote, lists, undo/redo, double-spacing.
- Word count, character count (with and without spaces), word-goal progress bar, class-time countdown.
- Browser spell check on; grammar tools (Grammarly etc.) asked to stay off.
- Paste from outside blocked (students may move their own text around, optional). Large inserted chunks (AI "help me write", autofill) blocked; *dictation allowed* accommodation raises that limit.
- Autosave every few seconds with retry, saves on lock, on exit, and when class ends.

**Teacher dashboard**
- Live cards per student: status (writing / idle / not here / locked / submitted / not started), words, goal progress, last typed, lock count, blocked pastes.
- Clear one or all locked students; chime on new locks; pause a student; reopen a submission.
- Click a student → near-real-time view of their writing, playback of snapshots (~every 90 s), words-over-time chart, keystroke stats, and a timeline that flags bursts of text and text that appeared without typing.
- Open/close assignments on the fly; export everything as print, Word (.doc), or a CSV of word counts.
- Classes with schedules, rosters (paste a list), printable sign-in cards, accommodations.
- Demo data + "Simulate class" for trying it out. Demo student code: `TEST-0001`.

## Setup (for a new teacher account)

1. Create a Google Sheet, then **Extensions → Apps Script**. Replace `Code.gs` with `backend/Code.gs`.
2. Run `setup` once (authorize when asked). The starter teacher password is `english2026` — change it in Settings.
3. **Deploy → New deployment → Web app**, Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
4. Put that URL in `js/config.js` (or open the site once with `?api=<url>` to save it in that browser).
5. Host the folder on GitHub Pages (or any static host).

To update the backend later: paste the new code, then **Deploy → Manage deployments → Edit → New version** (keeps the same URL).

## Development

```
node dev/test-backend.js        # backend flow tests against a mock of Apps Script
node dev/server.js 8080         # local site + mocked backend at http://localhost:8080
node dev/e2e.js                 # headless browser walk-through (needs the dev server)
```
