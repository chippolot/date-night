import { weekdayOf } from "./recurrence";
import type {
	Category,
	Neighborhood,
	Occurrence,
	PriceLevel,
	Venue,
	Vibe,
	Weekday,
} from "./types";
import { CATEGORIES, NEIGHBORHOODS, VIBES, WEEKDAYS } from "./types";

export type Filters = {
	hood: Neighborhood[];
	cat: Category[];
	/** Categories to leave out, e.g. happy hours (remembered per browser by the client) */
	hide: Category[];
	vibe: Vibe[];
	/** Max venue food & drink price level; undefined means any */
	price?: PriceLevel;
	/** What it costs to get in; undefined means any */
	cost?: CostFilter;
	/** Rainy night: leave out anything held outdoors */
	indoors?: boolean;
	day: Weekday[];
	/** Something matches if it's on during any of these slots */
	time: TimeSlot[];
	/** YYYY-MM-DD to show instead of today (Tonight: that day; Coming up: 7 days from it) */
	date?: string;
	/** Free-text search: every word must appear in the title, venue, neighborhood or category */
	q?: string;
};

/** Time-of-day slots as whole hours; `to` below `from` wraps past midnight. */
export const TIME_SLOTS = {
	afternoon: { label: "Afternoon", hours: "12–5pm", from: 12, to: 17 },
	evening: { label: "Evening", hours: "5–8pm", from: 17, to: 20 },
	night: { label: "Night", hours: "8–11pm", from: 20, to: 23 },
	late: { label: "Late", hours: "11pm+", from: 23, to: 4 },
} as const;
export type TimeSlot = keyof typeof TIME_SLOTS;

export const COST_FILTERS = {
	free: "Free",
	under20: "Up to $20",
} as const;
export type CostFilter = keyof typeof COST_FILTERS;

/**
 * The lowest stated cost to get in, in dollars: 0 for free, undefined when nothing is stated
 * (most trivia and jams), and null when it's ticketed but no price is given. Happy hours and
 * food & drink deals list what's on special, not a cover, so they count as nothing stated.
 */
export function entryPrice(
	o: Pick<Occurrence, "cost" | "category">,
): number | null | undefined {
	if (!o.cost || o.category === "food-drink-special") return undefined;
	if (/^(free|no cover)\b/i.test(o.cost.trim())) return 0;
	const amounts = [...o.cost.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) =>
		Number(m[1]),
	);
	if (amounts.length) return Math.min(...amounts);
	return /free/i.test(o.cost) ? 0 : null;
}

export function matchesCost(
	o: Pick<Occurrence, "cost" | "category">,
	f: Pick<Filters, "cost">,
): boolean {
	if (!f.cost) return true;
	const price = entryPrice(o);
	if (f.cost === "free") return price === 0;
	// "Up to $20" keeps nights with no cover listed, but not ticketed ones of unknown price.
	return price === undefined || (price !== null && price <= 20);
}

/** Whether something is held outdoors: its own flag, else whether its venue is outdoors. */
export function isOutdoor(
	o: Pick<Occurrence, "outdoor">,
	venue: Venue | undefined,
): boolean {
	return o.outdoor ?? !!venue?.tags.includes("outdoor");
}

export const EMPTY_FILTERS: Filters = {
	hood: [],
	cat: [],
	hide: [],
	vibe: [],
	day: [],
	time: [],
};

function pick<T extends string>(values: string[], allowed: readonly T[]): T[] {
	// Deduped: the specials switch and its "What" pill can both send hide=food-drink-special.
	return [...new Set(values)].filter((v): v is T =>
		(allowed as readonly string[]).includes(v),
	);
}

export function parseFilters(params: URLSearchParams): Filters {
	const price = Number(params.get("price"));
	const cost = params.get("cost");
	return {
		hood: pick(
			params.getAll("hood"),
			Object.keys(NEIGHBORHOODS) as Neighborhood[],
		),
		cat: pick(params.getAll("cat"), Object.keys(CATEGORIES) as Category[]),
		hide: pick(params.getAll("hide"), Object.keys(CATEGORIES) as Category[]),
		vibe: pick(params.getAll("vibe"), VIBES),
		price: price === 1 || price === 2 || price === 3 ? price : undefined,
		cost: cost && cost in COST_FILTERS ? (cost as CostFilter) : undefined,
		indoors: params.get("indoors") === "1" || undefined,
		day: pick(params.getAll("day"), WEEKDAYS),
		time: pick(params.getAll("time"), Object.keys(TIME_SLOTS) as TimeSlot[]),
		date: /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "")
			? (params.get("date") ?? undefined)
			: undefined,
		q: params.get("q")?.trim().slice(0, 100) || undefined,
	};
}

export function toQuery(f: Filters): string {
	const params = new URLSearchParams();
	if (f.q) params.set("q", f.q);
	if (f.date) params.set("date", f.date);
	for (const h of f.hood) params.append("hood", h);
	for (const c of f.cat) params.append("cat", c);
	for (const c of f.hide) params.append("hide", c);
	for (const v of f.vibe) params.append("vibe", v);
	if (f.price) params.set("price", String(f.price));
	if (f.cost) params.set("cost", f.cost);
	if (f.indoors) params.set("indoors", "1");
	for (const d of f.day) params.append("day", d);
	for (const t of f.time) params.append("time", t);
	const q = params.toString();
	return q ? `?${q}` : "";
}

/** Furthest ahead the date picker goes; scraped events only cover the next 90 days. */
export const MAX_DAYS_AHEAD = 89;

/** The day to show: the picked date if it's today or later, else today. */
export function viewDate(f: Filters, today: string): string {
	return f.date && f.date > today ? f.date : today;
}

export function isEmpty(f: Filters): boolean {
	return (
		!f.hood.length &&
		!f.cat.length &&
		!f.hide.length &&
		!f.vibe.length &&
		!f.price &&
		!f.cost &&
		!f.indoors &&
		!f.day.length &&
		!f.time.length &&
		!f.q
	);
}

/** Lowercase without accents, so "skal" finds "Skål". */
function fold(s: string): string {
	return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Whether every word of the search appears somewhere in `texts`. */
export function matchesText(
	texts: (string | undefined)[],
	f: Pick<Filters, "q">,
): boolean {
	if (!f.q) return true;
	const haystack = fold(texts.filter(Boolean).join(" "));
	return fold(f.q)
		.split(/\s+/)
		.every((word) => haystack.includes(word));
}

/** What a search looks through for a venue: its name and neighborhood. */
export function venueText(venue: Venue | undefined): string[] {
	return venue ? [venue.name, NEIGHBORHOODS[venue.neighborhood]] : [];
}

function minutes(hhmm: string): number {
	const [h = 0, m = 0] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

/**
 * Whether something starting at `start` (and running to `end`, if known) is on
 * between hours `from` and `to`. Without an end time it must start in the window.
 */
function inWindow(
	start: string,
	end: string | undefined,
	from: number,
	to: number,
): boolean {
	// A window like 11pm–4am wraps past midnight: check both halves.
	if (to <= from)
		return inWindow(start, end, from, 24) || inWindow(start, end, 0, to);
	const lo = from * 60;
	const hi = to * 60;
	const s = minutes(start);
	if (!end) return s >= lo && s < hi;
	let e = minutes(end);
	if (e <= s) e += 24 * 60; // ends after midnight
	return s < hi && e > lo;
}

export function matchesTime(
	start: string,
	end: string | undefined,
	f: Filters,
): boolean {
	return (
		!f.time.length ||
		f.time.some((t) =>
			inWindow(start, end, TIME_SLOTS[t].from, TIME_SLOTS[t].to),
		)
	);
}

export function matchesDay(day: Weekday, f: Filters): boolean {
	return !f.day.length || f.day.includes(day);
}

export function matchesVenue(venue: Venue | undefined, f: Filters): boolean {
	if (f.hood.length && (!venue || !f.hood.includes(venue.neighborhood)))
		return false;
	if (f.price && venue && venue.priceLevel > f.price) return false;
	return true;
}

export function applyFilters(
	list: Occurrence[],
	venueById: Map<string, Venue>,
	f: Filters,
): Occurrence[] {
	return list.filter((o) => {
		const venue = o.venueId ? venueById.get(o.venueId) : undefined;
		if (!matchesVenue(venue, f)) return false;
		if (f.cat.length && !f.cat.includes(o.category)) return false;
		if (f.hide.includes(o.category)) return false;
		if (!matchesCost(o, f)) return false;
		if (f.indoors && isOutdoor(o, venue)) return false;
		if (f.vibe.length && !o.vibe.some((v) => f.vibe.includes(v))) return false;
		if (!matchesDay(weekdayOf(o.date), f)) return false;
		if (!matchesTime(o.start, o.end, f)) return false;
		return matchesText(
			[o.title, CATEGORIES[o.category], ...venueText(venue)],
			f,
		);
	});
}
