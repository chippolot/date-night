import { href } from "../config";
import type { SiteData } from "./data";
import { calendar, eventVevent, nightVevent } from "./ics";
import { dedupe, eventOccurrences, nightOccurrences } from "./recurrence";
import {
	CATEGORIES,
	type Category,
	NEIGHBORHOODS,
	type Neighborhood,
} from "./types";

/** How far ahead feeds look for scraped events that replace a recurring night. */
const FEED_DAYS = 90;

export type FeedScope = { hood?: Neighborhood; cat?: Category };

/** "/feeds/all.ics", "/feeds/what/jazz.ics", "/feeds/hood/ballard.ics", "/feeds/hood/ballard/jazz.ics" */
export function feedPath({ hood, cat }: FeedScope): string {
	if (hood && cat) return `/feeds/hood/${hood}/${cat}.ics`;
	if (hood) return `/feeds/hood/${hood}.ics`;
	if (cat) return `/feeds/what/${cat}.ics`;
	return "/feeds/all.ics";
}

/** "Jazz in Ballard", "Everything in Fremont", "Trivia & games", "Everything" */
export function feedName({ hood, cat }: FeedScope): string {
	const what = cat ? CATEGORIES[cat] : "Everything";
	return hood ? `${what} in ${NEIGHBORHOODS[hood]}` : what;
}

/** Every feed the site publishes: all, each category, each neighborhood, and each pair. */
export function feedScopes(): FeedScope[] {
	const hoods = Object.keys(NEIGHBORHOODS) as Neighborhood[];
	const cats = Object.keys(CATEGORIES) as Category[];
	return [
		{},
		...cats.map((cat) => ({ cat })),
		...hoods.flatMap((hood) => [
			{ hood },
			...cats.map((cat) => ({ hood, cat })),
		]),
	];
}

/**
 * A subscribable calendar of the recurring nights (as repeating events) and scraped events in
 * `scope`. On days when a scraped event stands in for a night (see `dedupe`), the night is skipped.
 */
export function feed(data: SiteData, today: string, scope: FeedScope): string {
	const venueById = new Map(data.venues.map((v) => [v.id, v]));
	const inScope = (venueId: string | undefined, category: Category) =>
		(!scope.cat || scope.cat === category) &&
		(!scope.hood || venueById.get(venueId ?? "")?.neighborhood === scope.hood);

	const all = [
		...nightOccurrences(data.nights, today, FEED_DAYS),
		...eventOccurrences(data.events, data.venues, today, FEED_DAYS),
	];
	const kept = new Set(dedupe(all).map((o) => o.key));
	const skip = new Map<string, string[]>();
	for (const o of all) {
		if (o.kind === "night" && !kept.has(o.key))
			skip.set(o.refId, [...(skip.get(o.refId) ?? []), o.date]);
	}

	const nights = data.nights
		.filter((n) => !n.recurrence.until || n.recurrence.until >= today)
		.filter((n) => inScope(n.venueId, n.category))
		.map((n) =>
			nightVevent(
				n,
				venueById.get(n.venueId),
				today,
				undefined,
				skip.get(n.id),
			),
		);
	const events = data.events
		.filter((e) => inScope(e.venueId, e.category ?? "misc"))
		.map((e) =>
			eventVevent(e, e.venueId ? venueById.get(e.venueId) : undefined),
		);
	return calendar([...nights, ...events], `Date Night · ${feedName(scope)}`);
}

/**
 * The feeds matching the picked categories and neighborhoods, one per pair. `undefined` when
 * there are too many pairs to list (pick fewer to subscribe).
 */
export function matchingFeeds(
	hoods: Neighborhood[],
	cats: Category[],
	max = 6,
): FeedScope[] | undefined {
	const hs = hoods.length ? hoods : [undefined];
	const cs = cats.length ? cats : [undefined];
	if (hs.length * cs.length > max) return undefined;
	return hs.flatMap((hood) => cs.map((cat) => ({ hood, cat })));
}

/** The https URL of a feed on this site; the client swaps in webcal:// for one-tap subscribing. */
export function feedHref(scope: FeedScope): string {
	return href(feedPath(scope));
}
