import { href, SITE } from "../config";
import type { SiteData } from "../lib/data";
import {
	applyFilters,
	type Filters,
	isOutdoor,
	MAX_DAYS_AHEAD,
	matchesCost,
	matchesDay,
	matchesText,
	matchesTime,
	matchesVenue,
	toQuery,
	venueText,
} from "../lib/filters";
import {
	addDays,
	dedupe,
	eventOccurrences,
	nightOccurrences,
	seattleParts,
	sortOccurrences,
	weekdayOf,
} from "../lib/recurrence";
import type {
	Category,
	DatedEvent,
	Night,
	Occurrence,
	Venue,
	Vibe,
	Weekday,
} from "../lib/types";
import {
	CATEGORIES,
	CATEGORY_VIBES,
	NEIGHBORHOODS,
	PRICE_LEVELS,
} from "../lib/types";
import {
	card,
	cardList,
	describeRecurrence,
	esc,
	formatDate,
	subscribeLinks,
} from "./components";

export function venueMap(data: SiteData): Map<string, Venue> {
	return new Map(data.venues.map((v) => [v.id, v]));
}

export function occurrences(
	data: SiteData,
	from: string,
	days: number,
): Occurrence[] {
	return sortOccurrences(
		dedupe([
			...nightOccurrences(data.nights, from, days),
			...eventOccurrences(data.events, data.venues, from, days),
		]),
	);
}

const PARTS: {
	id: string;
	label: string;
	test: (start: string) => boolean;
}[] = [
	{
		id: "afternoon",
		label: "Afternoon & happy hour",
		test: (s) => s < "17:00",
	},
	{ id: "evening", label: "Evening", test: (s) => s >= "17:00" && s < "21:00" },
	{ id: "late", label: "Late", test: (s) => s >= "21:00" },
];

/** One filter to loosen when nothing matches, and how many listings that would bring back. */
type Relaxation = { label: string; f: Filters; count: number };

/**
 * When nothing matches: try dropping each active filter on its own, and keep the ones that
 * bring something back. Hidden kinds aren't offered, since hiding is a remembered preference.
 */
function relaxations(
	list: Occurrence[],
	venueById: Map<string, Venue>,
	f: Filters,
): Relaxation[] {
	const names = (xs: string[], all: Record<string, string>) =>
		xs.map((x) => all[x] ?? x).join(", ");
	const options: [boolean, string, Partial<Filters>][] = [
		[!!f.q, `Clear the search “${f.q}”`, { q: undefined }],
		[
			f.hood.length > 0,
			`Any neighborhood, not just ${names(f.hood, NEIGHBORHOODS)}`,
			{ hood: [] },
		],
		[
			f.cat.length > 0,
			`Anything, not just ${names(f.cat, CATEGORIES)}`,
			{ cat: [] },
		],
		[f.vibe.length > 0, "Any vibe", { vibe: [] }],
		[f.time.length > 0, "Any time of day", { time: [] }],
		[f.day.length > 0, "Any day", { day: [] }],
		[!!f.cost, "Any cost", { cost: undefined }],
		[!!f.price, "Any food & drink prices", { price: undefined }],
		[!!f.indoors, "Include outdoor plans", { indoors: undefined }],
	];
	return options
		.filter(([active]) => active)
		.map(([, label, change]) => {
			const loosened = { ...f, ...change };
			return {
				label,
				f: loosened,
				count: applyFilters(list, venueById, loosened).length,
			};
		})
		.filter((r) => r.count > 0)
		.sort((a, b) => b.count - a.count)
		.slice(0, 3);
}

/** The "nothing matches" message: a way forward in time, and filters worth loosening. */
function emptyState(
	data: SiteData,
	f: Filters,
	{
		message,
		list,
		after,
	}: { message: string; list: Occurrence[]; after: string },
): string {
	const venueById = venueMap(data);
	const next = applyFilters(
		occurrences(data, after, MAX_DAYS_AHEAD),
		venueById,
		{ ...f, day: [] },
	).find((o) => matchesDay(weekdayOf(o.date), f));
	const ideas = [
		...(next
			? [
					`<a href="${esc(toQuery({ ...f, date: next.date }) || "?")}">Next match: ${formatDate(next.date, { weekday: "short", month: "short", day: "numeric" })} →</a>`,
				]
			: []),
		...relaxations(list, venueById, f).map(
			(r) =>
				`<a href="${esc(toQuery(r.f) || "?")}">${esc(r.label)}</a> <span class="part-count">${r.count}</span>`,
		),
	];
	return `<div class="empty"><p class="empty-message">${message}</p>${ideas.length ? `<ul class="empty-ideas">${ideas.map((i) => `<li>${i}</li>`).join("")}</ul>` : ""}</div>`;
}

/** One day's listings: tonight, or `day` when a date is picked. */
export function tonightView(
	data: SiteData,
	day: string,
	f: Filters,
	today = day,
): string {
	const venueById = venueMap(data);
	const all = occurrences(data, day, 1);
	const list = applyFilters(all, venueById, f);
	const sections = PARTS.map(({ id, label, test }) => {
		const items = list.filter((o) => test(o.start));
		if (!items.length) return "";
		return `<section class="part"><h2 class="part-heading"><span class="part-mark part-${id}" aria-hidden="true"></span>${label} <span class="part-count">${items.length}</span></h2>${cardList(items, venueById, today)}</section>`;
	}).join("");
	const empty = emptyState(data, f, {
		message:
			day === today
				? "Nothing on tonight with these filters."
				: "Nothing on this day with these filters.",
		list: all,
		after: addDays(day, 1),
	});
	return `<p class="date-heading"><span class="date-num">${formatDate(day, { day: "2-digit" })}</span><span class="date-words"><span class="date-weekday">${formatDate(day, { weekday: "long" })}</span><span class="date-month">${formatDate(day, { month: "long", year: "numeric" })}</span></span></p>
${sections || empty}
${subscribeLinks(f)}`;
}

/** Seven days from `start` (today unless a date is picked). */
export function weekView(
	data: SiteData,
	start: string,
	f: Filters,
	today = start,
): string {
	const venueById = venueMap(data);
	const all = occurrences(data, start, 7);
	const list = applyFilters(all, venueById, f);
	if (!list.length)
		return `${emptyState(data, f, {
			message: "Nothing this week with these filters.",
			list: all,
			after: addDays(start, 7),
		})}${subscribeLinks(f)}`;
	const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
	return `<div class="week">${days
		.map((date) => {
			if (!matchesDay(weekdayOf(date), f)) return "";
			const items = list.filter((o) => o.date === date);
			const label =
				date === today ? "Today" : formatDate(date, { weekday: "long" });
			const month = formatDate(date, { month: "short" });
			const day = formatDate(date, { day: "numeric" });
			return `<section class="day"><h2 class="day-heading"><span class="cal" aria-hidden="true"><span class="cal-m">${month}</span><span class="cal-d">${day}</span></span><span>${label}</span><span class="part-count">${items.length}</span></h2>${cardList(items, venueById, today, "Nothing listed.")}</section>`;
		})
		.join("")}</div>
${subscribeLinks(f)}`;
}

/** `upcoming` is the next ~60 days of occurrences for all venues, computed once by the caller. */
export function venueView(
	data: SiteData,
	venue: Venue,
	today: string,
	upcoming: Occurrence[] = occurrences(data, today, 60),
): string {
	// Each recurring night once, labeled with its schedule (taken from the curated
	// data directly, so nights hidden by a same-day event still appear here).
	const recurring = data.nights
		.filter((n) => n.venueId === venue.id)
		.flatMap((n) => {
			const next = nightOccurrences([n], today, 400)[0];
			return next ? [card(next, venue, today, describeRecurrence(n))] : [];
		});
	const events = upcoming
		.filter((o) => o.venueId === venue.id && o.kind === "event")
		.map((o) =>
			card(
				o,
				venue,
				today,
				formatDate(o.date, {
					weekday: "short",
					month: "short",
					day: "numeric",
				}),
			),
		);
	const links = [
		`<a href="${esc(venue.url)}" rel="noopener" target="_blank">Website</a>`,
		venue.instagram
			? `<a href="https://instagram.com/${esc(venue.instagram)}" rel="noopener" target="_blank">Instagram</a>`
			: "",
		`<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name} ${venue.address}`)}" rel="noopener" target="_blank">Directions</a>`,
	]
		.filter(Boolean)
		.join(" · ");
	return `<p class="venue-meta">${NEIGHBORHOODS[venue.neighborhood]} · ${PRICE_LEVELS[venue.priceLevel]} food &amp; drinks · ${esc(venue.address)}</p>
<p>${links}</p>
<section><h2>Recurring nights</h2>${recurring.join("\n") || `<p class="empty">No recurring nights listed.</p>`}</section>
<section><h2>Upcoming events</h2>${events.join("\n") || `<p class="empty">No dated events in the next 60 days.</p>`}</section>`;
}

export function venuesIndexView(data: SiteData): string {
	const categoriesOf = (id: string) =>
		new Set<Category>([
			...data.nights.filter((n) => n.venueId === id).map((n) => n.category),
			...data.events
				.filter((e) => e.venueId === id)
				.map((e) => e.category ?? "live-music"),
		]);
	const hoods = Object.entries(NEIGHBORHOODS)
		.map(([id, name]) => ({
			id,
			name,
			venues: data.venues
				.filter((v) => v.neighborhood === id)
				.sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.filter((h) => h.venues.length);
	const jump = hoods
		.map((h) => `<a class="hood-link" href="#hood-${h.id}">${h.name}</a>`)
		.join("");
	const sections = hoods
		.map((h) => {
			const items = h.venues
				.map((v) => {
					const dots = [...categoriesOf(v.id)]
						.map(
							(c) =>
								`<span class="dot cat-${c}" title="${CATEGORIES[c]}"></span>`,
						)
						.join("");
					const nights = data.nights.filter((n) => n.venueId === v.id).length;
					return `<li><a class="venue-row" href="${href(`/venues/${v.id}/`)}">
  <span class="venue-name">${esc(v.name)}</span>
  <span class="venue-info"><span class="venue-dots">${dots}</span>${nights ? `<span>${nights} recurring</span>` : ""}<span class="venue-price" title="Food &amp; drink prices (our estimate)">${PRICE_LEVELS[v.priceLevel]}</span></span>
</a></li>`;
				})
				.join("");
			return `<section id="hood-${h.id}"><h2 class="part-heading">${h.name} <span class="part-count">${h.venues.length}</span></h2><ul class="venue-list">${items}</ul></section>`;
		})
		.join("");
	return `<p class="hood-jump">${jump}</p>${sections}`;
}

type Kind = {
	title: string;
	category: Category;
	vibe: Vibe[];
	cost?: string;
	outdoor?: boolean;
	days: Weekday[];
	start: string;
	end?: string;
};

/** Whether a recurring night or dated event passes the map's category, vibe, day and time filters. */
export function matchesKind(k: Kind, f: Filters): boolean {
	if (f.cat.length && !f.cat.includes(k.category)) return false;
	if (f.hide.includes(k.category)) return false;
	if (!matchesCost(k, f)) return false;
	if (f.vibe.length && !k.vibe.some((x) => f.vibe.includes(x))) return false;
	if (f.day.length && !k.days.some((d) => matchesDay(d, f))) return false;
	return matchesTime(k.start, k.end, f);
}

/** Whether a venue or one of its nights/events matches the search. */
function matchesSearch(v: Venue, kinds: Kind[], f: Filters): boolean {
	if (matchesText(venueText(v), f)) return true;
	return kinds.some((k) =>
		matchesText([k.title, CATEGORIES[k.category], ...venueText(v)], f),
	);
}

export function nightKind(n: Night): Kind {
	const r = n.recurrence;
	return {
		title: n.title,
		category: n.category,
		vibe: n.vibe,
		cost: n.cost,
		outdoor: n.outdoor,
		days: r.kind === "weekly" ? r.days : [r.day],
		start: n.start,
		end: n.end,
	};
}

export function eventKind(e: DatedEvent): Kind {
	const category = e.category ?? "live-music";
	const { date, time } = seattleParts(e.startsAt);
	return {
		title: e.title,
		category,
		vibe: CATEGORY_VIBES[category],
		cost: e.price,
		days: [weekdayOf(date)],
		start: time,
		end: e.endsAt ? seattleParts(e.endsAt).time : undefined,
	};
}

/** Venues to plot, given the map filters. A venue matches if any of its nights or upcoming events do. */
export function mapVenues(data: SiteData, f: Filters): Venue[] {
	const kinds = new Map<string, Kind[]>();
	const add = (venueId: string | undefined, kind: Kind) => {
		if (venueId) kinds.set(venueId, [...(kinds.get(venueId) ?? []), kind]);
	};
	for (const n of data.nights) add(n.venueId, nightKind(n));
	for (const e of data.events) add(e.venueId, eventKind(e));
	const whenOrWhat =
		f.cat.length ||
		f.hide.length ||
		f.vibe.length ||
		f.cost ||
		f.indoors ||
		f.day.length ||
		f.time.length;
	return data.venues.filter((v) => {
		if (!matchesVenue(v, f)) return false;
		const own = kinds.get(v.id) ?? [];
		if (!matchesSearch(v, own, f)) return false;
		if (!whenOrWhat) return true;
		return own.some(
			(k) => matchesKind(k, f) && !(f.indoors && isOutdoor(k, v)),
		);
	});
}

export const footer = `<footer>
  <p>Recurring nights are hand-curated and change often. Each card shows when it was last checked, so confirm with the venue before you go.</p>
  <p><a href="${href("/feeds/all.ics")}" data-webcal>Subscribe to everything in your calendar app</a> · ${esc(SITE.title)}</p>
</footer>`;
