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
	slotOf,
	TIME_SLOTS,
	type TimeSlot,
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
	missingLink,
	SPECIALS,
	specialsShelf,
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

/**
 * Split happy hours out for their own shelf, unless they're all that was asked for: then
 * they're the main event and stay as cards.
 */
function splitSpecials(
	list: Occurrence[],
	f: Filters,
): { main: Occurrence[]; specials: Occurrence[] } {
	if (f.cat.length && f.cat.every((c) => c === SPECIALS))
		return { main: list, specials: [] };
	return {
		main: list.filter((o) => o.category !== SPECIALS),
		specials: list.filter((o) => o.category === SPECIALS),
	};
}

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

/**
 * The "nothing matches" message: a way forward in time, filters worth loosening, and `missing`,
 * a link for telling us about something we don't list.
 */
function emptyState(
	data: SiteData,
	f: Filters,
	{
		message,
		list,
		after,
		missing,
	}: { message: string; list: Occurrence[]; after: string; missing: string },
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
		missing,
	].filter(Boolean);
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
	const { main, specials } = splitSpecials(applyFilters(all, venueById, f), f);
	const sections = (Object.keys(TIME_SLOTS) as TimeSlot[])
		.map((id) => {
			const items = main.filter((o) => slotOf(o.start) === id);
			if (!items.length) return "";
			return `<details class="part" data-part="${id}" open><summary class="fold-summary"><h2 class="part-heading fold-heading"><span class="part-mark part-${id}" aria-hidden="true"></span>${TIME_SLOTS[id].label} <span class="part-count">${items.length}</span></h2></summary>${cardList(items, venueById, today)}</details>`;
		})
		.join("");
	const empty = emptyState(data, f, {
		message:
			day === today
				? "Nothing on tonight with these filters."
				: "Nothing on this day with these filters.",
		list: all,
		after: addDays(day, 1),
		missing: missingLink(
			`Know something on ${day === today ? "tonight" : "this day"}? Tell us`,
			{
				when: formatDate(day, {
					weekday: "short",
					month: "short",
					day: "numeric",
				}),
			},
		),
	});
	return `<p class="date-heading"><span class="date-num">${formatDate(day, { day: "2-digit" })}</span><span class="date-words"><span class="date-weekday">${formatDate(day, { weekday: "long" })}</span><span class="date-month">${formatDate(day, { month: "long", year: "numeric" })}</span></span></p>
${sections || specials.length ? `${specialsShelf(specials, venueById)}${sections}` : empty}
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
			missing: missingLink("Know something on this week? Tell us", {
				when: `Week of ${formatDate(start, { month: "short", day: "numeric" })}`,
			}),
		})}${subscribeLinks(f)}`;
	const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
	return `<div class="week">${days
		.map((date) => {
			if (!matchesDay(weekdayOf(date), f)) return "";
			const items = list.filter((o) => o.date === date);
			const { main, specials } = splitSpecials(items, f);
			const label =
				date === today ? "Today" : formatDate(date, { weekday: "long" });
			const month = formatDate(date, { month: "short" });
			const day = formatDate(date, { day: "numeric" });
			return `<section class="day"><h2 class="day-heading"><span class="cal" aria-hidden="true"><span class="cal-m">${month}</span><span class="cal-d">${day}</span></span><span>${label}</span><span class="part-count">${items.length}</span></h2>${specialsShelf(specials, venueById)}${main.length || !specials.length ? cardList(main, venueById, today, "Nothing listed.") : ""}</section>`;
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
	const missing = missingLink("Missing a night here? Tell us", {
		venue: venue.name,
	});
	return `<p class="venue-meta">${NEIGHBORHOODS[venue.neighborhood]} · ${PRICE_LEVELS[venue.priceLevel]} food &amp; drinks · ${esc(venue.address)}</p>
<p>${links}</p>
<section><h2>Recurring nights</h2>${recurring.join("\n") || `<p class="empty">No recurring nights listed.</p>`}${missing ? `<p class="missing">${missing}</p>` : ""}</section>
<section><h2>Upcoming events</h2>${events.join("\n") || `<p class="empty">No dated events in the next 60 days.</p>`}</section>`;
}

/**
 * One listing on its own page, where share links land: its card, then its venue and (for a dated
 * event) everything else on that day. `label` is the date, or a night's schedule.
 */
export function listingView(
	o: Occurrence,
	venue: Venue | undefined,
	today: string,
	label: string,
): string {
	const links = [
		venue
			? `<a class="action" href="${href(`/venues/${venue.id}/`)}">More at ${esc(venue.name)}</a>`
			: "",
		o.kind === "event"
			? `<a class="action" href="${href(`/?date=${o.date}`)}">Everything else on ${formatDate(o.date, { weekday: "long", month: "short", day: "numeric" })}</a>`
			: `<a class="action" href="${href("/")}">Everything on tonight</a>`,
	]
		.filter(Boolean)
		.join("");
	return `${card(o, venue, today, label)}
<p class="listing-links">${links}</p>`;
}

/** The preview line under a shared link's title: "Sat, Oct 31 at 9pm · Roam, Ballard · Dancing" */
export function listingSummary(
	o: Occurrence,
	venue: Venue | undefined,
	when: string,
): string {
	return [
		when,
		venue ? `${venue.name}, ${NEIGHBORHOODS[venue.neighborhood]}` : "",
		CATEGORIES[o.category],
	]
		.filter(Boolean)
		.join(" · ");
}

export function venuesIndexView(data: SiteData): string {
	const categoriesOf = (id: string) =>
		new Set<Category>([
			...data.nights.filter((n) => n.venueId === id).map((n) => n.category),
			...data.events
				.filter((e) => e.venueId === id)
				.map((e) => e.category ?? "misc"),
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
	const category = e.category ?? "misc";
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

/**
 * Pass `subscribe: false` on pages that end with their own subscribe line (Tonight, Coming up),
 * so the feed isn't offered twice.
 */
export function footer({ subscribe = true } = {}): string {
	const link = subscribe
		? `<a href="${href("/feeds/all.ics")}" data-webcal>Subscribe to everything in your calendar app</a> · `
		: "";
	const missing = missingLink("Know something we're missing?");
	return `<footer>
  <p>Recurring nights are hand-curated and change often. Each card shows when it was last checked, so confirm with the venue before you go.</p>
  <p>${link}${missing ? `${missing} · ` : ""}${esc(SITE.title)}</p>
</footer>`;
}
