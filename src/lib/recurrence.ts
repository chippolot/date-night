import type {
	DatedEvent,
	Night,
	Occurrence,
	Recurrence,
	Venue,
	Weekday,
} from "./types";
import { CATEGORY_VIBES, WEEKDAYS } from "./types";

export const TZ = "America/Los_Angeles";

// Calendar math is done on plain YYYY-MM-DD strings via UTC so DST never shifts a day.
function parse(date: string): Date {
	return new Date(`${date}T00:00:00Z`);
}

function format(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
	const d = parse(date);
	d.setUTCDate(d.getUTCDate() + n);
	return format(d);
}

export function weekdayOf(date: string): Weekday {
	return WEEKDAYS[parse(date).getUTCDay()] as Weekday;
}

// Intl formatters are expensive to construct, so build them once.
const DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
	timeZone: TZ,
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

/** Today's date in Seattle, regardless of the machine's timezone. */
export function todayInSeattle(now: Date = new Date()): string {
	return DATE_FMT.format(now);
}

/** Local date and HH:MM in Seattle for an absolute instant. */
export function seattleParts(iso: string): { date: string; time: string } {
	const d = new Date(iso);
	return { date: DATE_FMT.format(d), time: TIME_FMT.format(d) };
}

/** Which occurrence of its weekday this date is within the month (1-based), and whether it's the last. */
function nthInMonth(date: string): { nth: number; isLast: boolean } {
	const d = parse(date);
	const day = d.getUTCDate();
	const nth = Math.ceil(day / 7);
	const daysInMonth = new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
	).getUTCDate();
	return { nth, isLast: day + 7 > daysInMonth };
}

export function occursOn(rec: Recurrence, date: string): boolean {
	if ((rec.from && date < rec.from) || (rec.until && date > rec.until))
		return false;
	const month = parse(date).getUTCMonth() + 1;
	if (rec.months && !rec.months.includes(month)) return false;
	const wd = weekdayOf(date);
	if (rec.kind === "weekly") return rec.days.includes(wd);
	if (rec.day !== wd) return false;
	const { nth, isLast } = nthInMonth(date);
	return rec.nth.some((n) => (n === -1 ? isLast : n === nth));
}

export function nightOccurrences(
	nights: Night[],
	from: string,
	days: number,
): Occurrence[] {
	const out: Occurrence[] = [];
	for (let i = 0; i < days; i++) {
		const date = addDays(from, i);
		for (const n of nights) {
			if (!occursOn(n.recurrence, date)) continue;
			out.push({
				key: `night:${n.id}:${date}`,
				kind: "night",
				refId: n.id,
				date,
				start: n.start,
				end: n.end,
				allDay: n.allDay,
				title: n.title,
				venueId: n.venueId,
				category: n.category,
				vibe: n.vibe,
				cost: n.cost,
				outdoor: n.outdoor,
				url: n.sourceUrl,
				confidence: n.confidence,
				lastVerified: n.lastVerified,
			});
		}
	}
	return out;
}

export function eventOccurrences(
	events: DatedEvent[],
	venues: Venue[],
	from: string,
	days: number,
): Occurrence[] {
	const until = addDays(from, days);
	const known = new Set(venues.map((v) => v.id));
	return events.flatMap((e) => {
		const { date, time } = seattleParts(e.startsAt);
		if (date < from || date >= until) return [];
		const category = e.category ?? "live-music";
		return [
			{
				key: `event:${e.id}`,
				kind: "event" as const,
				refId: e.id,
				date,
				start: time,
				end: e.endsAt ? seattleParts(e.endsAt).time : undefined,
				title: e.title,
				venueId: e.venueId && known.has(e.venueId) ? e.venueId : undefined,
				category,
				vibe: CATEGORY_VIBES[category],
				cost: e.price,
				url: e.url,
				confidence: "confirmed" as const,
			},
		];
	});
}

/** Minutes between two "HH:MM" times. */
function minutesApart(a: string, b: string): number {
	const toMin = (t: string) => {
		const [h = 0, m = 0] = t.split(":").map(Number);
		return h * 60 + m;
	};
	return Math.abs(toMin(a) - toMin(b));
}

/**
 * When a venue's calendar has a specific event at roughly the same time as a
 * curated recurring night (e.g. tonight's band at Egan's "Live jazz"), show the
 * specific event and hide the generic night.
 */
export function dedupe(list: Occurrence[]): Occurrence[] {
	const eventStarts = new Map<string, string[]>();
	for (const o of list) {
		if (o.kind !== "event" || !o.venueId) continue;
		const k = `${o.venueId}|${o.date}`;
		eventStarts.set(k, [...(eventStarts.get(k) ?? []), o.start]);
	}
	return list.filter(
		(o) =>
			o.kind === "event" ||
			!eventStarts
				.get(`${o.venueId}|${o.date}`)
				?.some((start) => minutesApart(start, o.start) <= 60),
	);
}

export function sortOccurrences(list: Occurrence[]): Occurrence[] {
	return [...list].sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			a.start.localeCompare(b.start) ||
			a.title.localeCompare(b.title),
	);
}
