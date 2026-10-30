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
	fetchEvents: () => Promise<ScrapedEvent[]>;
};

const CATEGORY_PATTERNS: [RegExp, Category][] = [
	[/\b(trivia|quiz|bingo|game night|commander|magic)\b/i, "trivia"],
	[/\bkaraoke\b/i, "karaoke"],
	[
		/\b(class|workshop|lesson|painting|clay|embroidery|mending|foiling|craft)\b/i,
		"class",
	],
	[/\b(film|screening|movie|theater|theatre|play|cabaret)\b/i, "theater"],
	[
		/\b(comedy|stand-?up|storyslam|improv|book club|reading|poetry|author)\b/i,
		"comedy",
	],
	[/\bopen mic\b/i, "open-mic"],
	[/\b(jazz|trio|quartet|quintet)\b/i, "jazz"],
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

/** Fetch a page as text, retrying once after a timeout, network error or 5xx. */
export async function get(url: string, retries = 1): Promise<string> {
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
		if (res.status >= 500 && retries > 0) throw new Error(`HTTP ${res.status}`);
		if (!res.ok) throw new HttpError(`${url} → HTTP ${res.status}`);
		return await res.text();
	} catch (err) {
		if (err instanceof HttpError || retries <= 0) {
			throw err instanceof HttpError
				? err
				: new Error(`${url} → ${errorMessage(err)}`);
		}
		await Bun.sleep(5_000);
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
	opts: Omit<Source, "fetchEvents"> & { url: string; link?: string },
): Source {
	return {
		...opts,
		async fetchEvents() {
			return parseIcs(await get(opts.url)).map((e) => ({
				id: `${opts.id}-${e.start.slice(0, 10)}-${slug(e.summary)}`,
				title: e.summary,
				startsAt: e.start,
				endsAt: e.end,
				url: e.url ?? opts.link ?? opts.url,
			}));
		},
	};
}
