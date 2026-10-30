# Date Night North Seattle

Date night ideas around Ballard (98107) and its neighbors: Fremont, Sunset Hill, Phinney Ridge, Greenwood, Crown Hill, Green Lake and Wallingford.

The site has two kinds of content:

- **Recurring nights** (`data/nights.ts`): hand-curated weekly or monthly things like jazz Wednesdays, trivia, and oyster happy hours. Every entry records where the info came from and when it was last checked, and the site shows that on each card.
- **Dated events** (`data/events.generated.json`): pulled daily from venue calendars by `scripts/scrape/`.

It's a static site built with Bun, with no runtime server. Pages are pre-rendered at build time. A small client script then re-renders "Tonight" and "Coming up" for the visitor's real date and filters.

## Commands

```sh
bun install
cp .env.example .env   # then add a localhost CARTO key (map tiles) and an Eventbrite token (Substation)
bun run dev       # http://localhost:3000, restarts and reloads open pages on every change
bun run web       # alias for dev (PORT=… to change the port)
bun test
bun run check     # biome + tsc
bun run scrape    # refresh events from every source (or: bun run scrape <source-id>)
bun run build     # → dist/
bun run preview   # serve dist/ like a static host, http://localhost:4173
```

## Adding or updating a recurring night

1. Add the venue to `data/venues.ts` if it's new. Take lat/lng from a map and give it a stable slug `id`.
2. Add the night to `data/nights.ts`:
   - `recurrence`: `{ kind: "weekly", days: ["WE"] }` or `{ kind: "monthly-nth", nth: [2, 4], day: "MO" }` (use `-1` for the last one in the month). Add `months: [6, 7, 8]` for seasonal nights.
   - `confidence`:
     - `confirmed`: the venue's own site or socials, or a current listing.
     - `likely`: a recent third-party listing.
     - `stale`: only old sources.
   - `lastVerified`: set to today whenever you re-check it.
3. Run `bun test`. The data tests catch unknown venue IDs, duplicate IDs, bad times, and coordinates outside the area.

Nights checked more than 90 days ago show a "May be outdated" badge. You can change that in `src/config.ts`.

## Adding an event source

Add an entry to `scripts/scrape/sources.ts`:

- If the venue's page has schema.org JSON-LD, use `jsonldSource({ id, venueId, urls })`.
- If it has an iCal feed, use `icsSource({ id, venueId, url })`.
- Otherwise write a custom `fetchEvents()`.

- If it's a WordPress "The Events Calendar" site (`/wp-json/tribe/events/v1/events`), use `tribeSource({ id, origin, venues })`.
- Otherwise write a custom `fetchEvents()`.

A source that fails keeps its previous events, so one broken site doesn't empty the calendar. A source that throws, or returns no events without setting `mayBeEmpty`, counts as failed: `bun run scrape` lists it and exits 1, and the daily workflow opens (or comments on) a "Scraper failures" GitHub issue, which it closes once every source succeeds again.

Sources are listed in `sources` at the bottom of `scripts/scrape/sources.ts`, with a comment above each on how it works. Neighborhood calendars (visitballard.com, myballard.com, PhinneyWood, Sunset Hill Community Hall) keep only events at venues mapped in their venue tables. Earlier sources win when two list the same venue and start time. Respect each site's robots.txt crawl delay (`crawlDelay` / `pause`).

The comment above `sources` lists sites that aren't scraped and why (see also CLAUDE.md).

When a scraped event matches a curated night (same venue, same day, within an hour), the site shows the specific event, e.g. tonight's band, in place of the generic night.

## Deploying

`.github/workflows/daily.yml` checks, tests, scrapes, commits the refreshed events, builds, and deploys to GitHub Pages. It runs on every push to `main` and daily at 6am Pacific. To turn it on, go to the repo's Settings → Pages → Source and choose "GitHub Actions". The base path for a project site is set automatically. The map's CARTO key comes from the `CARTO_KEY` repo secret (restricted to chippolot.github.io in the CARTO dashboard).
The Substation scraper reads an Eventbrite private token from the `EVENTBRITE_TOKEN` repo secret.

## Layout

```
data/            curated venues + nights, generated events
src/lib/         types, recurrence engine, filters, .ics, surprise picker
src/pages/       pure HTML render functions (shared by build and browser)
src/client/      browser scripts: live filters, surprise, map (Leaflet)
src/site.ts      every route → content; used by build.ts and server.ts
scripts/scrape/  JSON-LD + iCal parsers, per-venue sources
brand/           social profile images (not part of the site build)
```
