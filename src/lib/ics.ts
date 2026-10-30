import { addDays, occursOn, TZ } from "./recurrence";
import type { DatedEvent, Night, Recurrence, Venue } from "./types";

const PRODID = "-//Date Night North Seattle//EN";

// Standard US Pacific rules (since 2007), enough for any calendar client.
const VTIMEZONE = [
	"BEGIN:VTIMEZONE",
	`TZID:${TZ}`,
	"BEGIN:DAYLIGHT",
	"TZOFFSETFROM:-0800",
	"TZOFFSETTO:-0700",
	"TZNAME:PDT",
	"DTSTART:19700308T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
	"END:DAYLIGHT",
	"BEGIN:STANDARD",
	"TZOFFSETFROM:-0700",
	"TZOFFSETTO:-0800",
	"TZNAME:PST",
	"DTSTART:19701101T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
	"END:STANDARD",
	"END:VTIMEZONE",
];

export function escapeText(s: string): string {
	return s
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
		.replace(/([,;])/g, "\\$1");
}

/** Fold lines longer than 75 octets per RFC 5545. */
export function fold(line: string): string {
	const bytes = new TextEncoder().encode(line);
	if (bytes.length <= 75) return line;
	const parts: string[] = [];
	let current = "";
	let size = 0;
	for (const ch of line) {
		const len = new TextEncoder().encode(ch).length;
		const limit = parts.length === 0 ? 75 : 74;
		if (size + len > limit) {
			parts.push(current);
			current = "";
			size = 0;
		}
		current += ch;
		size += len;
	}
	parts.push(current);
	return parts.join("\r\n ");
}

export function rrule(rec: Recurrence): string {
	const byMonth = rec.months ? `;BYMONTH=${rec.months.join(",")}` : "";
	// UNTIL must be UTC when DTSTART has a TZID; 07:59Z the next day is the end of `until` in Seattle.
	const until = rec.until
		? `;UNTIL=${addDays(rec.until, 1).replaceAll("-", "")}T075959Z`
		: "";
	if (rec.kind === "weekly") {
		return `RRULE:FREQ=WEEKLY;BYDAY=${rec.days.join(",")}${byMonth}${until}`;
	}
	const byDay = rec.nth.map((n) => `${n}${rec.day}`).join(",");
	return `RRULE:FREQ=MONTHLY;BYDAY=${byDay}${byMonth}${until}`;
}

function local(date: string, time: string): string {
	return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function utcStamp(d: Date): string {
	return `${d.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/** First date on or after `from` that matches the recurrence (searches ~13 months). */
export function firstOccurrence(rec: Recurrence, from: string): string {
	const start = rec.from && rec.from > from ? rec.from : from;
	for (let i = 0; i < 400; i++) {
		const date = addDays(start, i);
		if (occursOn(rec, date)) return date;
	}
	throw new Error("Recurrence never occurs");
}

function endFor(date: string, start: string, end?: string): string {
	if (!end) {
		const [h = 0, m = 0] = start.split(":").map(Number);
		const total = h * 60 + m + 120;
		const endDate = total >= 24 * 60 ? addDays(date, 1) : date;
		const mins = total % (24 * 60);
		const hh = String(Math.floor(mins / 60)).padStart(2, "0");
		const mm = String(mins % 60).padStart(2, "0");
		return local(endDate, `${hh}:${mm}`);
	}
	// Ends after midnight, e.g. 21:00–01:00.
	return local(end <= start ? addDays(date, 1) : date, end);
}

function location(venue?: Venue): string[] {
	if (!venue) return [];
	return [
		`LOCATION:${escapeText(`${venue.name}, ${venue.address}`)}`,
		`GEO:${venue.lat};${venue.lng}`,
	];
}

export function nightVevent(
	night: Night,
	venue: Venue | undefined,
	from: string,
	now = new Date(),
	/** YYYY-MM-DD dates to leave out, e.g. when a scraped event replaces the night that day */
	skip: string[] = [],
): string[] {
	const first = firstOccurrence(night.recurrence, from);
	const desc = [
		night.description,
		night.cost ? `Cost: ${night.cost}` : "",
		`Last verified ${night.lastVerified}. Confirm with the venue before going.`,
		night.sourceUrl,
	]
		.filter(Boolean)
		.join("\n");
	return [
		"BEGIN:VEVENT",
		`UID:night-${night.id}@date-night`,
		`DTSTAMP:${utcStamp(now)}`,
		`DTSTART;TZID=${TZ}:${local(first, night.start)}`,
		`DTEND;TZID=${TZ}:${endFor(first, night.start, night.end)}`,
		rrule(night.recurrence),
		...(skip.length
			? [
					`EXDATE;TZID=${TZ}:${skip.map((d) => local(d, night.start)).join(",")}`,
				]
			: []),
		`SUMMARY:${escapeText(venue ? `${night.title} @ ${venue.name}` : night.title)}`,
		`DESCRIPTION:${escapeText(desc)}`,
		`URL:${night.sourceUrl}`,
		...location(venue),
		"END:VEVENT",
	];
}

export function eventVevent(
	event: DatedEvent,
	venue: Venue | undefined,
	now = new Date(),
): string[] {
	const start = new Date(event.startsAt);
	const end = event.endsAt
		? new Date(event.endsAt)
		: new Date(start.getTime() + 2 * 60 * 60 * 1000);
	return [
		"BEGIN:VEVENT",
		`UID:event-${event.id}@date-night`,
		`DTSTAMP:${utcStamp(now)}`,
		`DTSTART:${utcStamp(start)}`,
		`DTEND:${utcStamp(end)}`,
		`SUMMARY:${escapeText(venue ? `${event.title} @ ${venue.name}` : event.title)}`,
		`DESCRIPTION:${escapeText([event.price, event.url].filter(Boolean).join("\n"))}`,
		`URL:${event.url}`,
		...location(venue),
		"END:VEVENT",
	];
}

export function calendar(vevents: string[][], name: string): string {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`PRODID:${PRODID}`,
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		`X-WR-CALNAME:${escapeText(name)}`,
		`X-WR-TIMEZONE:${TZ}`,
		...VTIMEZONE,
		...vevents.flat(),
		"END:VCALENDAR",
	];
	return `${lines.map(fold).join("\r\n")}\r\n`;
}
