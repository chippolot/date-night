# Date Night North Seattle

Date night ideas across north Seattle. West of I-5: Ballard (98107), Fremont, Sunset Hill, Phinney Ridge, Greenwood, Crown Hill, Green Lake and Wallingford. East of I-5: the U District, Roosevelt, Ravenna, Maple Leaf, Wedgwood, Lake City, Laurelhurst and Sand Point.

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

To find leads in venues' Instagram posts, run `bun run ig-leads` (or `bun run ig-leads <venue-id>…`). It reads each venue's `instagram` account once through the Graph API and writes captions that look like recurring nights to `out/ig-leads.md`. Verify each lead by hand before adding it. With `--new` it leaves out posts already reported and records the ones it reports in `data/cache/ig-seen.json` (the weekly workflow commits that file); runs without `--new` leave the file alone.

Some venues announce one-off events only in flyer images on Instagram. The `instagram` scrape source reads the latest posts of the venues in `FLYER_VENUES` (`scripts/ig-flyers-scan.ts`) with Claude Haiku and adds their upcoming events that have a start time, linked to the post. Sports watch parties and kids' events are left out, and recurring nights aren't added (they're leads for `nights.ts`). Each post is read once: `data/cache/ig-flyers.json` keeps what every post contained, and the daily workflow commits it. It costs about $0.0007 per new post. To check whether more venues are worth adding to `FLYER_VENUES`, run `bun run ig-flyers-scan` (venues no scraper covers) or `bun run ig-flyers-scan <venue-id>…`, then read `out/ig-flyers/scan.md`. `bun run ig-flyers-eval` scores the flyer reader against hand labels in `scripts/ig-flyers-labels/`. These need `ANTHROPIC_API_KEY` in `.env` (and the repo secret of the same name for the daily workflow).

`.github/workflows/ig-leads.yml` runs `ig-leads --new` every Monday and posts new leads to an open "Instagram leads" issue. It needs the `META_ACCESS_TOKEN` and `INSTAGRAM_USER_ID` repo secrets. The token expires about every 60 days: when it does, the workflow opens an "Instagram token needs refreshing" issue, and `bun run meta-token <short-lived token> --github` updates both `.env` and the secret.

Each card's flag links to a "Something changed?" Google Form, pre-filled with the listing and its source (`SITE.reportForm` in `src/config.ts`). Responses land in the form's Responses tab. People with a GitHub account can also use the "Something changed" issue form (`.github/ISSUE_TEMPLATE/listing-change.yml`).

A second form, "Know something we're missing?" (`SITE.missingForm`), is for things we don't list at all. It's linked from the footer, from venue pages (pre-filled with the venue) and from empty days (pre-filled with the date), and stays hidden until its `url` is set. Set `venue` and `when` to the `entry.*` ids of its Where and When questions, from the form's pre-filled link. Responses are leads to verify by hand, like `ig-leads`.

Nights checked more than 90 days ago show a "May be outdated" badge. You can change that in `src/config.ts`.

## Adding an event source

Add an entry to `scripts/scrape/sources.ts`:

- If the venue's page has schema.org JSON-LD, use `jsonldSource({ id, venueId, urls })`.
- If it has an iCal feed, use `icsSource({ id, venueId, url })`.
- If it's a WordPress "The Events Calendar" site (`/wp-json/tribe/events/v1/events`), use `tribeSource({ id, origin, venues })`.
- Otherwise write a custom `fetchEvents()`.

A source that fails keeps its previous events, so one broken site doesn't empty the calendar. A source that throws, or returns no events without setting `mayBeEmpty`, counts as failed: `bun run scrape` lists it and exits 1, and the daily workflow opens (or comments on) a "Scraper failures" GitHub issue, which it closes once every source succeeds again.

Sources are listed in `sources` at the bottom of `scripts/scrape/sources.ts`, with a comment above each on how it works. Neighborhood calendars (visitballard.com, myballard.com, PhinneyWood, Sunset Hill Community Hall, the Department of Neighborhoods) keep only events at venues mapped in their venue tables. Earlier sources win when two list the same venue and start time. Respect each site's robots.txt crawl delay (`crawlDelay` / `pause`).

`docs/source-backlog.md` lists venues that aren't scraped yet and why: those that need a workaround, those the site's rules put off limits, and those ruled out.

When a scraped event matches a curated night (same venue, same day, within an hour), the site shows the specific event, e.g. tonight's band, in place of the generic night.

## Calendar feeds

The build writes subscribable calendars to `/feeds/`: `all.ics`, one per category (`what/<category>.ics`), one per neighborhood (`hood/<neighborhood>.ics`), and one per pair (`hood/<neighborhood>/<category>.ics`). Recurring nights are repeating events, skipped on days a scraped event stands in for them. Tonight and Coming up link to the feeds that match the picked categories and neighborhoods.

## Deploying

`.github/workflows/daily.yml` checks, tests, scrapes, commits the refreshed events, builds, and deploys to GitHub Pages. It runs on every push to `main` and daily at 6am Pacific. To turn it on, go to the repo's Settings → Pages → Source and choose "GitHub Actions". The base path for a project site is set automatically. The map's CARTO key comes from the `CARTO_KEY` repo secret (restricted to chippolot.github.io in the CARTO dashboard).
The pages report errors to Sentry and count visits in PostHog: see "Errors and analytics" below.
The Substation scraper reads an Eventbrite private token from the `EVENTBRITE_TOKEN` repo secret.
The `instagram` source reads the `META_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` and `ANTHROPIC_API_KEY` repo secrets.

## Errors and analytics

Both are written into every page's head by `layout()` (`src/pages/layout.ts`), only when their key is set (`TELEMETRY` in `src/config.ts`). The daily workflow builds with the `SENTRY_DSN` and `POSTHOG_KEY` repo variables (`gh variable set …`). They aren't secrets, since they end up in the page. Locally neither is set, so nothing is sent, and `track()` logs to the console.

- **Sentry**: project `date-night` in the `ben-smith-ra` org. Pages load Sentry's loader script, which fetches the SDK only when an error happens. Reports carry the commit as their release.
- **PostHog**: project "Date Night North Seattle" (701176, US cloud), in cookieless mode: no cookies or storage, no person profiles, no session replay or autocapture. It counts page views (with referrers, for the Web analytics dashboard) and the events in `src/client/track.ts`: `filtered` (the filter query, without search text), `surprise`, `shared`, and `link opened` (`kind`: source, report, missing, feed). **Cookieless tracking** must stay on under the project's Settings → Web analytics, or PostHog drops every event.

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
