# board

Scapple-style freeform notes on top of Excalidraw. Write anywhere, then drop one note onto another to connect them.

**Live:** https://board.knhdixh.com

![A board imported from Scapple: a yellow bubble note, a dotted connection and an arrow, inside a grey background shape](docs/screenshot.png)

Scapple is a lovely way to think on paper, but it's paid and desktop-only. Excalidraw is free and runs anywhere, but it's built for diagrams. This app is Excalidraw (the MIT-licensed [`@excalidraw/excalidraw`](https://www.npmjs.com/package/@excalidraw/excalidraw) package, so it keeps getting upstream fixes) with Scapple's way of working layered on top, plus sync between devices.

## What it adds to Excalidraw

| | |
|---|---|
| **Write anywhere** | Double-click empty space to start a note. Long notes wrap at a note's width once you stop typing. |
| **Drop to connect** | Drag a note onto another and let go: they're joined with a dotted line and the note slides back to where it was. The target is outlined while you hover. Drop again to disconnect. |
| **Arrows** | Hold ⌘ (Ctrl) while dropping to draw an arrow instead of a line. |
| **Note styles** | Select notes for the style bar: plain, bubble, or a yellow/blue/green/red/grey fill. Free text is wrapped in a bubble and its connections move with it. |
| **Stack, row** | Line selected notes up into a tidy left-aligned column (Scapple's *Stack*) or a row. Connections follow. |
| **Connect, disconnect** | Chain the selected notes together in reading order, or remove every connection between them. |
| **Scapple import** | Open `.scap` files: notes, bubbles, fills, colours, lines, arrows and background shapes. `.excalidraw` files work too. |
| **Outline export** | Download a board as a Markdown outline, with connected notes nested under the note they hang from. |
| **Boards and sync** | Any number of boards, autosaved and synced through your account. Two devices editing the same board can't silently overwrite each other: the second gets a *Changed elsewhere* prompt. |
| **No account needed** | *Use without account* keeps boards in the browser. Sign in later and they move into your account. |

Everything Excalidraw does still works: shapes, frames (use them as Scapple-style background areas), images, search, PNG/SVG export, undo, and keyboard shortcuts. Defaults are tuned for notes: clean lines instead of the hand-drawn look, a plain font, straight connectors.

## How it works

- **Frontend:** Vite + React, with Excalidraw's fonts self-hosted from `/fonts`. The Scapple behaviour lives in `src/scapple/` as pure functions over element arrays (`connect.js`, `layout.js`, `styles.js`, `scap.js`, `outline.js`), and `src/Editor.jsx` wires them to Excalidraw's pointer events.
- **Drop to connect:** on pointer-down the editor snapshots the scene. On pointer-up, if the pointer is over another note, it restores the snapshot and adds the connector before Excalidraw records the drag, so the whole gesture is one undo step.
- **Data:** Supabase Postgres, with one `boards` row per board holding the scene as JSON. Row-level security limits every row to its owner. A trigger bumps `version` on each write, and saves only apply `where version = <the one you loaded>`.
- **Sign-in:** Supabase email magic links.
- **Hosting:** Vercel serves the static build. Every push to `main` deploys.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and publishable key
npm run dev                  # http://localhost:5173
npm test                     # unit tests (vitest)
node scripts/e2e.mjs         # browser test in headless Chrome, while `npm run dev` runs
```

## Deploy your own

1. Create a Supabase project, then apply the schema: `supabase link --project-ref <ref> && supabase db push`.
2. In Supabase → Authentication → URL configuration, set the site URL to your domain (`supabase/config.toml` has the values, and `supabase config push` applies them).
3. Import the repo into Vercel and set two environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (the **publishable** key, which is safe in the browser; never the secret key).

## Limitations

- Sign-in emails use Supabase's built-in mailer, which only sends a few emails an hour and only to members of the Supabase organisation. For anyone else to sign in, add custom SMTP in Supabase.
- No real-time collaboration: one person at a time per board, with conflict detection rather than merging.
- Images are stored inside the board's JSON, so boards with many large images get slow to save.
- Scapple import covers notes, styles, connections and background shapes. Rich-text formatting inside notes (bold runs, links) comes in as plain text.

## Credits

Built on [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT). Inspired by [Scapple](https://www.literatureandlatte.com/scapple) by Literature & Latte.
