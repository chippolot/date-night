import { describe, expect, test } from "bun:test";
import {
	calendar,
	escapeText,
	firstOccurrence,
	fold,
	nightVevent,
	rrule,
} from "../src/lib/ics";
import type { Night, Venue } from "../src/lib/types";

const venue: Venue = {
	id: "conor-byrne",
	name: "Conor Byrne",
	neighborhood: "ballard",
	address: "5140 Ballard Ave NW, Seattle, WA 98107",
	lat: 47.6667,
	lng: -122.3833,
	url: "https://example.com",
	priceLevel: 1,
	tags: ["bar"],
};

const night: Night = {
	id: "test-night",
	venueId: venue.id,
	title: "Bluegrass jam",
	category: "live-music",
	recurrence: { kind: "monthly-nth", nth: [2, 4], day: "MO" },
	start: "21:00",
	end: "01:00",
	description: "Bring a fiddle; or don't",
	vibe: ["lively"],
	sourceUrl: "https://example.com",
	lastVerified: "2026-10-29",
	confidence: "likely",
};

describe("ics", () => {
	test("rrule for weekly and nth weekday", () => {
		expect(rrule({ kind: "weekly", days: ["WE"] })).toBe(
			"RRULE:FREQ=WEEKLY;BYDAY=WE",
		);
		expect(rrule({ kind: "monthly-nth", nth: [2, 4], day: "MO" })).toBe(
			"RRULE:FREQ=MONTHLY;BYDAY=2MO,4MO",
		);
		expect(rrule({ kind: "monthly-nth", nth: [-1], day: "FR" })).toBe(
			"RRULE:FREQ=MONTHLY;BYDAY=-1FR",
		);
		expect(rrule({ kind: "weekly", days: ["WE"], months: [6, 7, 8] })).toBe(
			"RRULE:FREQ=WEEKLY;BYDAY=WE;BYMONTH=6,7,8",
		);
	});

	test("firstOccurrence", () => {
		expect(firstOccurrence(night.recurrence, "2026-10-29")).toBe("2026-11-09");
	});

	test("escapes text", () => {
		expect(escapeText("a, b; c\nd")).toBe("a\\, b\\; c\\nd");
	});

	test("folds long lines at 75 octets", () => {
		const folded = fold(`DESCRIPTION:${"x".repeat(200)}`);
		for (const line of folded.split("\r\n")) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
	});

	test("night VEVENT starts on the first matching date and ends after midnight", () => {
		const lines = nightVevent(night, venue, "2026-10-29");
		expect(lines).toContain("DTSTART;TZID=America/Los_Angeles:20261109T210000");
		expect(lines).toContain("DTEND;TZID=America/Los_Angeles:20261110T010000");
		expect(lines).toContain("RRULE:FREQ=MONTHLY;BYDAY=2MO,4MO");
	});

	test("calendar wraps with CRLF", () => {
		const cal = calendar([nightVevent(night, venue, "2026-10-29")], "Test");
		expect(cal.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
		expect(cal.endsWith("END:VCALENDAR\r\n")).toBe(true);
		expect(cal).toContain("BEGIN:VTIMEZONE");
	});
});
