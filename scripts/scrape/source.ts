import type { Category, DatedEvent } from "../../src/lib/types";
import { parseIcs } from "./ical";
import { extractLdEvents } from "./jsonld";

export type ScrapedEvent = Omit<DatedEvent, "source">;

export type Source = {
	/** Stable id, also stored on each event as `source` */
	id: string;
	/** Default venue/category for events that don't set their own */
	venueId?: string;
	category?: Category;
	/** Zero events is normal (e.g. a page of occasional specials), not a sign the scraper broke */
	mayBeEmpty?: boolean;
	/** Longer than the default 5 for sources that pause between many pages */
	timeoutMinutes?: number;
	fetchEvents: () => Promise<ScrapedEvent[]>;
};

const CATEGORY_PATTERNS: [RegExp, Category][] = [
	// Magic: The Gathering nights, not magic wands or magic shows
	[
		/\b(trivia|quiz|bingo|game night|cribbage|puzzle|geeks who drink|commander|magic: the gathering|mtg)\b/i,
		"trivia",
	],
	[/\bkaraoke\b/i, "karaoke"],
	[
		/\b(class|workshop|lesson|painting|paint n'? sip|water-?colou?r|clay|embroidery|mending|foiling|craft)\b/i,
		"class",
	],
	[/\b(film|screening|movie|theater|theatre|play|cabaret)\b/i, "theater"],
	[
		/\b(comedy|stand-?up|storyslam|improv|book club|reading|poetry|author)\b/i,
		"comedy",
	],
	[/\bopen mic\b/i, "open-mic"],
	[/\b(jazz|trio|quartet|quintet)\b/i, "jazz"],
	[/\b(live music|concert|zootunes)\b/i, "live-music"],
	[/\b(dance|dancing|salsa|swing|tango|two-step|square)\b/i, "dance"],
	[/\b(market|fair|bazaar|bookfest)\b/i, "market"],
	[/\b(tasting|beer taste|happy hour)\b/i, "food-drink-special"],
	[/\b(art walk|artwalk|gallery|exhibit)\b/i, "art"],
];

/** Best-effort category from an event title, falling back to `fallback`. */
export function guessCategory(
	title: string,
	fallback?: Category,
): Category | undefined {
	return CATEGORY_PATTERNS.find(([re]) => re.test(title))?.[1] ?? fallback;
}

const UA =
	"Mozilla/5.0 (compatible; date-night-north-seattle/1.0; personal event aggregator)";

/** Fetch a page as text, retrying once after a timeout, network error, 429 or 5xx. */
export async function get(url: string, retries = 1): Promise<string> {
	let wait = 5_000;
	try {
		const res = await fetch(url, {
			headers: {
				"user-agent": UA,
				accept: "text/html,text/calendar,application/json,*/*",
				// Bun fails to decode some brotli responses (seen on Wix sites).
				"accept-encoding": "gzip, deflate",
			},
			signal: AbortSignal.timeout(20_000),
		});
		if (res.status === 429 && retries > 0) {
			// Rate limited (Shopify, seen from shared CI IPs): wait as asked, up to 30s.
			const after = Number(res.headers.get("retry-after"));
			wait =
				Number.isFinite(after) && after > 0
					? Math.min(after, 30) * 1000
					: 15_000;
			throw new Error("HTTP 429");
		}
		if (res.status >= 500 && retries > 0) throw new Error(`HTTP ${res.status}`);
		if (!res.ok) throw new HttpError(`${url} → HTTP ${res.status}`);
		return await res.text();
	} catch (err) {
		if (err instanceof HttpError || retries <= 0) {
			throw err instanceof HttpError
				? err
				: new Error(`${url} → ${errorMessage(err)}`);
		}
		await Bun.sleep(wait);
		return get(url, retries - 1);
	}
}

/** A 4xx response: retrying won't help. */
class HttpError extends Error {}

export function errorMessage(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).replace(/\.$/, "");
}

export function slug(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60);
}

/**
 * A small JSON cache committed next to the events (data/cache/<name>.json), for sources that would
 * otherwise re-fetch hundreds of unchanged pages every run. Keys are written sorted so diffs stay
 * small.
 */
export async function readCache<T>(name: string): Promise<Record<string, T>> {
	const file = Bun.file(`data/cache/${name}.json`);
	return (await file.exists()) ? file.json() : {};
}

export async function writeCache<T>(
	name: string,
	entries: Record<string, T>,
): Promise<void> {
	const sorted = Object.fromEntries(
		Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
	);
	await Bun.write(
		`data/cache/${name}.json`,
		`${JSON.stringify(sorted, null, "\t")}\n`,
	);
}

/** Source backed by schema.org JSON-LD Event markup on one or more pages. */
export function jsonldSource(
	opts: Omit<Source, "fetchEvents"> & {
		urls: string[];
		/** Keep only events whose `location.name` matches (for pages that list sister venues too) */
		location?: RegExp;
	},
): Source {
	return {
		...opts,
		async fetchEvents() {
			const pages = await Promise.all(opts.urls.map(get));
			return pages
				.flatMap(extractLdEvents)
				.filter((e) => !opts.location || opts.location.test(e.location ?? ""))
				.map((e) => ({
					id: `${opts.id}-${e.startDate.slice(0, 10)}-${slug(e.name)}`,
					title: e.name,
					startsAt: e.startDate,
					endsAt: e.endDate,
					url: e.url ?? opts.urls[0] ?? "",
					price: e.price,
				}));
		},
	};
}

/** Source backed by an iCalendar feed. */
export function icsSource(
	opts: Omit<Source, "fetchEvents"> & {
		url: string;
		link?: string;
		/** Keep only events whose LOCATION matches (for calendars shared with sister venues) */
		location?: RegExp;
		/** Drop events whose LOCATION is set and doesn't match (for feeds that list off-site events too) */
		atVenue?: RegExp;
		/** Titles to drop, e.g. members' meetings */
		skip?: RegExp;
		cleanTitle?: (title: string) => string;
	},
): Source {
	const { url, link, location, atVenue, skip, cleanTitle, ...source } = opts;
	return {
		...source,
		async fetchEvents() {
			return parseIcs(await get(url))
				.filter(
					(e) =>
						// All-day entries have no start time to show.
						!e.allDay &&
						!e.cancelled &&
						(!location || location.test(e.location ?? "")) &&
						(!atVenue || !e.location || atVenue.test(e.location)) &&
						!skip?.test(e.summary),
				)
				.map((e) => {
					const title = cleanTitle?.(e.summary) ?? e.summary;
					return {
						id: `${source.id}-${e.start.slice(0, 10)}-${slug(title)}`,
						title,
						startsAt: e.start,
						endsAt: e.end,
						url: e.url ?? link ?? url,
						category: guessCategory(title, source.category),
					};
				});
		},
	};
}
