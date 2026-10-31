# CLAUDE.md

Static date-night site for north Seattle: Ballard (98107) and its neighbors west of I-5, and the U District to Lake City east of it. Built with Bun and checked with Biome. See README.md for commands and layout.

## Running servers

- When you start a server for your own testing (`bun run dev`, `bun run web`, `bun run preview`), **always set a custom port** with `PORT=<port>` (e.g. `PORT=3417 bun run dev`). The user runs their own server on the defaults (3000 dev/web, 4173 preview) at the same time, and yours must not collide with it.

## Conventions

- Run `bun run check` (biome + tsc) and `bun test` before calling work done.
- Curated data lives in `data/venues.ts` and `data/nights.ts`:
  - Never invent times, prices, or days. If a start time is unknown, leave the night out and note it in the comment at the top of `nights.ts`.
  - Set `confidence` honestly and update `lastVerified` when re-checking.
  - Facebook/Instagram posts may be used as `sourceUrl` for hand-verified nights. Link the post permalink, not the profile. Use `confirmed` only if the post is under 60 days old and states the day and start time; otherwise `likely`.
- Scrapers live in `scripts/scrape/`. Don't bypass bot protection (Cloudflare, ModSecurity). Don't use API keys taken from third-party pages. Never scrape Facebook or Instagram pages.
- Instagram posts may be read only through the official Graph API (Business Discovery) with this project's own token (`META_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` in `.env`; refresh with `bun run meta-token`). Recurring nights it finds are leads for hand verification: never write them into `nights.ts` automatically. One-off events read from flyers (the `instagram` source, `scripts/ig-flyers-scan.ts`) go onto the site automatically, but only upcoming ones with a start time, each linked to its post. Read each post with Claude once: `data/cache/ig-flyers.json` records every post read, and posts in it must never be sent to the model again. The app shares a limit of about 200 calls per hour, so ask for each account once (profile and posts in one call) and stop on "Application request limit reached".
- Date math uses plain `YYYY-MM-DD` strings in `src/lib/recurrence.ts`. Times are Seattle local (`America/Los_Angeles`).
