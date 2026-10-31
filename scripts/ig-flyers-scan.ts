// Read event flyers in venues' recent Instagram posts with Claude Haiku (scripts/ig-flyers.ts). Each
// post is read once: what was found is kept in data/cache/ig-flyers.json, keyed by post id, and
// posts already there are never read again. Posts older than `maxAge` days aren't read (their
// events are over).
// The daily scrape's `instagram` source scans FLYER_VENUES and turns their one-off events into
// dated events. Recurring nights it finds stay leads for hand verification (CLAUDE.md).
// `bun run ig-flyers-scan` scans venues with an Instagram handle that no scraper covers (no source
// of their own and no scraped events), to find more venues worth adding to FLYER_VENUES;
// `bun run ig-flyers-scan <venue-id>…` scans only those. Options: --posts N (latest posts per
// account, default 12), --max-age D (default 60). Writes a report to out/ig-flyers/scan.md.
// Needs META_ACCESS_TOKEN, INSTAGRAM_USER_ID and ANTHROPIC_API_KEY. One Graph API call per account;
// stops on "Application request limit reached".
import Anthropic from "@anthropic-ai/sdk";
import { venues } from "../data/venues";
import type { Category, Venue } from "../src/lib/types";
import {
	cost,
	type FlyerResult,
	type Post,
	postedDate,
	readFlyer,
} from "./ig-flyers";
import { toIso } from "./scrape/ical";
import {
	guessCategory,
	readCache,
	type ScrapedEvent,
	slug,
	writeCache,
} from "./scrape/source";

/**
 * Venues whose Instagram posts announce one-off events with times (picked from a scan of the
 * uncovered venues on 2026-10-31). Add to this list after `bun run ig-flyers-scan <venue-id>`.
 */
export const FLYER_VENUES = [
	"roam",
	"growler-guys-ne",
	"fremont-social",
	"fiddlers-inn",
	"rough-and-tumble-ballard",
	"barking-dog-alehouse",
	"changes-in-wallingford",
	"human-people-beer",
	"hellbent-brewing",
	"gasworks-brewing",
	"kochendorfers",
	"single-hill-commons",
	"shanghai-room",
	"balandra",
	"russells",
	"slim-goody",
	"percys-and-co",
	"atlantic-crossing",
	"dreamland",
	"chucks-hop-shop-greenwood",
];

const GRAPH = "https://graph.facebook.com/v23.0";
const CACHE = "ig-flyers";
const MODEL = "haiku";
/** Images read per post: the flyer is almost always first */
const IMAGES = 3;
/** Forget posts after this long; `maxAge` keeps them from being read again before then */
const FORGET_DAYS = 365;
/** Stop before the app's shared quota runs out */
const MAX_USAGE = 90;

/** One read post. `events` and `recurring` are left out when empty, to keep the file small. */
export type CachedPost = {
	venueId: string;
	permalink: string;
	posted: string;
	read: string;
	events?: FlyerResult["events"];
	recurring?: FlyerResult["recurring"];
};

type Media = {
	media_type: string;
	media_url?: string;
	thumbnail_url?: string;
};

type GraphPost = Media & {
	id: string;
	caption?: string;
	timestamp: string;
	permalink: string;
	children?: { data: Media[] };
};

type GraphError = { message: string; code?: number };

export type ScanResult = {
	cache: Record<string, CachedPost>;
	scanned: string[];
	read: number;
	inputTokens: number;
	outputTokens: number;
	failed: string[];
	stopped?: string;
};

const daysBefore = (date: string, days: number) =>
	new Date(Date.parse(`${date}T12:00:00Z`) - days * 86_400_000)
		.toISOString()
		.slice(0, 10);

/** Image URLs worth reading: a carousel's first slides, a video's cover. */
export function imageUrls(post: GraphPost): string[] {
	const media =
		post.media_type === "CAROUSEL_ALBUM" ? (post.children?.data ?? []) : [post];
	return media
		.slice(0, IMAGES)
		.map((m) => (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url))
		.filter((u): u is string => Boolean(u));
}

/** Posts to read: not read before and recent enough to announce upcoming events. */
export function postsToRead(
	posts: GraphPost[],
	cache: Record<string, CachedPost>,
	since: string,
): GraphPost[] {
	return posts.filter((p) => !cache[p.id] && postedDate(p.timestamp) >= since);
}

/** Venues with a handle but no scraper of their own and no scraped events. */
async function uncoveredVenues(): Promise<Venue[]> {
	// Imported here: sources.ts imports this file for the instagram source.
	const { sources } = await import("./scrape/sources");
	const generated = await Bun.file("data/events.generated.json").json();
	const scraped = new Set(
		(generated.events as { venueId?: string }[]).map((e) => e.venueId),
	);
	const own = new Set(sources.map((s) => s.venueId));
	return venues.filter(
		(v) => v.instagram && !own.has(v.id) && !scraped.has(v.id),
	);
}

async function fetchImage(url: string): Promise<Post["images"][number]> {
	const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	if (!res.ok) throw new Error(`image → HTTP ${res.status}`);
	const type = res.headers.get("content-type") ?? "";
	return {
		data: new Uint8Array(await res.arrayBuffer()),
		mediaType: type.includes("png") ? "image/png" : "image/jpeg",
	};
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function pool<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: limit }, async () => {
			while (next < items.length) await fn(items[next++] as T);
		}),
	);
}

/**
 * Read the unseen recent posts of each venue's account and record them in the cache. Throws when
 * a credential is missing or the Meta token is rejected.
 */
export async function scan(
	targets: Venue[],
	opts: { posts: number; maxAge: number; today: string },
): Promise<ScanResult> {
	const token = process.env.META_ACCESS_TOKEN;
	const igUserId = process.env.INSTAGRAM_USER_ID;
	if (!token || !igUserId || !process.env.ANTHROPIC_API_KEY) {
		throw new Error(
			"Needs META_ACCESS_TOKEN, INSTAGRAM_USER_ID and ANTHROPIC_API_KEY.",
		);
	}
	const since = daysBefore(opts.today, opts.maxAge);
	const forgetBefore = daysBefore(opts.today, FORGET_DAYS);
	const cache = Object.fromEntries(
		Object.entries(await readCache<CachedPost>(CACHE)).filter(
			([, p]) => p.posted >= forgetBefore,
		),
	);
	const client = new Anthropic();
	const result: ScanResult = {
		cache,
		scanned: [],
		read: 0,
		inputTokens: 0,
		outputTokens: 0,
		failed: [],
	};

	for (const venue of targets) {
		const fields = `business_discovery.username(${venue.instagram}){media.limit(${opts.posts}){id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}}}`;
		const url = new URL(`${GRAPH}/${igUserId}`);
		url.search = new URLSearchParams({
			fields,
			access_token: token,
		}).toString();
		const res = await fetch(url);
		const body = (await res.json()) as {
			business_discovery?: { media?: { data: GraphPost[] } };
			error?: GraphError;
		};
		if (body.error) {
			const { message, code } = body.error;
			if (code === 190) {
				throw new Error(
					`Meta token rejected (${message}). Run \`bun run meta-token\`.`,
				);
			}
			if (
				[4, 17, 32].includes(code ?? 0) ||
				/request limit reached/i.test(message)
			) {
				result.stopped = message;
				break;
			}
			// Usually a personal account or a wrong handle
			result.failed.push(`${venue.id} (@${venue.instagram}): ${message}`);
			continue;
		}
		const posts = body.business_discovery?.media?.data ?? [];
		const toRead = postsToRead(posts, cache, since);
		await pool(toRead, 4, async (p) => {
			try {
				const images = await Promise.all(imageUrls(p).map(fetchImage));
				const read = await readFlyer(
					client,
					MODEL,
					{ name: venue.name, address: venue.address },
					{ ...p, caption: p.caption ?? "", images },
				);
				result.inputTokens += read.inputTokens;
				result.outputTokens += read.outputTokens;
				result.read++;
				const { events, recurring } = read.result;
				cache[p.id] = {
					venueId: venue.id,
					permalink: p.permalink,
					posted: postedDate(p.timestamp),
					read: opts.today,
					...(events.length ? { events } : {}),
					...(recurring.length ? { recurring } : {}),
				};
			} catch (err) {
				// Not cached, so the next run tries it again
				result.failed.push(`${venue.id} ${p.permalink}: ${err}`);
			}
		});
		// Saved after each account, so a failure later doesn't lose (and re-pay for) these reads
		await writeCache(CACHE, cache);
		result.scanned.push(venue.id);

		const usage = res.headers.get("x-app-usage");
		if (usage) {
			const pct = Math.max(
				...Object.values(JSON.parse(usage) as Record<string, number>),
			);
			if (pct >= MAX_USAGE) {
				result.stopped = `app usage at ${pct}% of the hourly quota`;
				break;
			}
		}
	}
	return result;
}

/** Watch parties, kids' events and the like: not date nights. */
const NOT_DATE_NIGHT =
	/\b(watch party|game watch|seahawks|mariners|sounders|kraken|huskies|nfl|nba|wnba|mlb|ufc|football|world cup|vs\.?|kids?|parents'? night out|family|toddlers?|storytime|food trucks?)\b/i;
const DJ_NIGHT = /\b(dj|djs|house|techno|disco|ukg|open decks|dance party)\b/i;
const FOOD_DRINK =
	/\b(deal|specials?|pop[- ]?up|\$\d+ (?:litres?|liters?|pints?|drafts?|beers?|cocktails?))\b/i;

/** "2026-10-31" + "21:00" (Seattle local) → ISO with offset */
const localIso = (date: string, time: string) =>
	toIso(`${date.replaceAll("-", "")}T${time.replace(":", "")}00`);

/**
 * Dated events from read posts: upcoming one-off events at `venueIds` with a start time, not
 * sports or kids' events. When several posts list the same event, the newest post wins.
 */
export function flyerEvents(
	cache: Record<string, CachedPost>,
	venueIds: string[],
	from: string,
	to: string,
): ScrapedEvent[] {
	const byKey = new Map<string, ScrapedEvent & { posted: string }>();
	const posts = Object.values(cache)
		.filter((p) => venueIds.includes(p.venueId))
		.sort((a, b) => a.posted.localeCompare(b.posted));
	for (const post of posts) {
		for (const e of post.events ?? []) {
			if (!e.start || e.date < from || e.date > to) continue;
			// The price can give it away too: "$50 per family"
			if (NOT_DATE_NIGHT.test(`${e.title} ${e.price ?? ""}`)) continue;
			const startsAt = localIso(e.date, e.start);
			if (!startsAt) continue;
			// An end before the start is after midnight.
			const endDate =
				e.end && e.end <= e.start
					? new Date(Date.parse(`${e.date}T12:00:00Z`) + 86_400_000)
							.toISOString()
							.slice(0, 10)
					: e.date;
			const endsAt = e.end ? localIso(endDate, e.end) : undefined;
			const category: Category =
				guessCategory(e.title) ??
				(DJ_NIGHT.test(e.title)
					? "dance"
					: FOOD_DRINK.test(e.title)
						? "food-drink-special"
						: "misc");
			byKey.set(`${post.venueId} ${startsAt}`, {
				id: `instagram-${startsAt.slice(0, 16)}-${slug(e.title)}`,
				venueId: post.venueId,
				title: e.title,
				startsAt,
				...(endsAt ? { endsAt } : {}),
				url: post.permalink,
				...(e.price ? { price: e.price } : {}),
				category,
				posted: post.posted,
			});
		}
	}
	return [...byKey.values()].map(({ posted: _, ...e }) => e);
}

/** Per venue: how many posts carried events, and which upcoming ones have a start time. */
export function report(
	venueIds: string[],
	cache: Record<string, CachedPost>,
	today: string,
): string {
	const rows = venueIds.map((id) => {
		const posts = Object.values(cache).filter((p) => p.venueId === id);
		const events = posts.flatMap((p) =>
			(p.events ?? []).map((e) => ({ ...e, permalink: p.permalink })),
		);
		const timed = events.filter((e) => e.start);
		const upcoming = timed.filter((e) => e.date >= today);
		const recurring = posts.flatMap((p) => p.recurring ?? []);
		return { id, posts, events, timed, upcoming, recurring };
	});
	rows.sort((a, b) => b.timed.length - a.timed.length);
	const lines = [
		`# Instagram flyer scan (${today})`,
		"",
		"| Venue | Posts read | Posts with events | Events | With a time | Upcoming with a time | Recurring |",
		"|---|---|---|---|---|---|---|",
		...rows.map(
			(r) =>
				`| ${r.id} | ${r.posts.length} | ${r.posts.filter((p) => p.events).length} | ${r.events.length} | ${r.timed.length} | ${r.upcoming.length} | ${r.recurring.length} |`,
		),
		"",
	];
	for (const r of rows.filter((r) => r.events.length || r.recurring.length)) {
		lines.push(`## ${r.id}`, "");
		for (const e of r.events.sort((a, b) => a.date.localeCompare(b.date)))
			lines.push(
				`- ${e.date} ${e.start ?? "--:--"} ${e.title}${e.price ? ` (${e.price})` : ""} — ${e.permalink}`,
			);
		for (const n of r.recurring)
			lines.push(
				`- Recurring: ${n.days.join("/")} ${n.start ?? "--:--"} ${n.title}`,
			);
		lines.push("");
	}
	return lines.join("\n");
}

async function main() {
	const args = process.argv.slice(2);
	const option = (name: string, fallback: number) => {
		const at = args.indexOf(name);
		return at >= 0 ? Number(args[at + 1]) : fallback;
	};
	const wanted = args.filter(
		(a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
	);
	const targets = wanted.length
		? venues.filter((v) => v.instagram && wanted.includes(v.id))
		: await uncoveredVenues();
	const today = new Date().toISOString().slice(0, 10);
	const result = await scan(targets, {
		posts: option("--posts", 12),
		maxAge: option("--max-age", 60),
		today,
	});
	await Bun.write(
		"out/ig-flyers/scan.md",
		report(result.scanned, result.cache, today),
	);
	const dollars = cost(MODEL, result.inputTokens, result.outputTokens);
	console.log(
		`${result.scanned.length} accounts, ${result.read} posts read, $${dollars.toFixed(4)} → out/ig-flyers/scan.md`,
	);
	if (result.failed.length) console.log(`Failed:\n${result.failed.join("\n")}`);
	if (result.stopped) console.log(`Stopped early: ${result.stopped}`);
}

if (import.meta.main) await main();
