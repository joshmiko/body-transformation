# Shift design comps

These are the approved designs for the Shift redesign. Each file is a static mock of one iPhone screen at 390 px wide. Open them in a browser at iPhone size. They load Big Shoulders Display from Google Fonts.

| File | Screen |
| --- | --- |
| `identity.html` | Brand board: crest, palette, type, stripe motif |
| `today.html` | Today tab |
| `workout.html` | Active workout |
| `review.html` | Review workout before saving |
| `saved.html` | Workout saved ("Shift over") |
| `progress.html` | Progress tab |
| `coach.html` | Coach tab, plan review card and the "not saved yet" state |
| `sign-in.html` | Sign in |
| `connect-coach.html` | OAuth consent page for connecting Coach (`oauth/consent.html`) |

## What to match exactly

- Layout and hierarchy: what is on each screen, in what order, and which element is the main card.
- Copy: headings, labels, button text and helper lines. Use the comp's wording unless it names data the app doesn't have.
- The stripe band: red 3 px, 3 px gap, cream 10 px, 3 px gap, red 3 px, full card width, clipped by the card's 20 px radius. At most one per screen, on the main card only. On the saved screen it runs edge to edge, larger (8 / 28 / 8 px with 8 px gaps).
- The crest mark (an SVG in `identity.html`, `today.html`, `sign-in.html`, `connect-coach.html`). Use it in the header, on sign-in and on the consent page, and as the home-screen icon.
- Type roles, spacing, radii and tap sizes. Colors come from the tokens already in `index.html`.

## What not to copy literally

- Numbers, dates, names and exercises are sample data from Nov 2026. Use the user's real data.
- Where a comp shows something the app can't compute, leave it out rather than invent it.
- Inline styles in the comps are for mocking only. Build with the app's existing CSS and tokens.

## Decisions made after the comps were drawn

- Inputs and secondary buttons use the `line-strong` border, not the fainter `line` shown in some comps.
- Workout: keep today's per-set logging (rows with weight, reps, check, feel, warm-ups, add set, undo, swipe). Adopt the comp's layout and hierarchy around it: top bar, exercise progress segments, exercise header, stripe band on the current set, "Last time" line, red "Log set, start rest" action, completed and upcoming set rows, Up next card. The comp's one-set-at-a-time flow is not approved yet.
- Coach: keep the Hockey calendar and "Add game" below the plan cards. The comp's "Undo approval" button is "Keep current plan", which already exists.
- Connect Coach: drop "You can disconnect any time in Coach settings" until a disconnect control exists.
- There is no Fuel tab. The app has four tabs: Today, Workout, Progress, Coach.
- The header has no subtitle in the comps. Keep the sync status line from PR #66 under the wordmark.
