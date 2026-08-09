---
name: Bug report
about: Something broke, or did the wrong thing
labels: bug
---

**What did you do?**
Steps, roughly. "Started a stream, said X, hit AIR" is plenty.

**What happened (vs. what you expected)?**

**Setup**
- Browser + OS:
- Self-hosted (`npm start`) or footnote-live?
- Room setup: OBS Browser Source overlay? Using `/op` on a second phone?

**Console errors**
Open devtools (F12 → Console) on the page that misbehaved and paste anything red. On `/control`, `?debug=1` opens the instrumentation panel — a screenshot of that helps a lot.
