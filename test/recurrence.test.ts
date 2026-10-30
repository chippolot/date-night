import { describe, expect, test } from "bun:test";
import {
	addDays,
	dedupe,
	eventOccurrences,
	occursOn,
	seattleParts,
	todayInSeattle,
	weekdayOf,
} from "../src/lib/recurrence";
import type { Occurrence, Recurrence } from "../src/lib/types";

describe("date helpers", () => {
	test("addDays crosses month and DST boundaries without drifting", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		// US DST ends 2026-11-01; the calendar date must still advance by exactly one.
		expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
		expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
	});

	test("weekdayOf", () => {
		expect(weekdayOf("2026-10-29")).toBe("TH");
		expect(weekdayOf("2026-11-01")).toBe("SU");
	});

	test("todayInSeattle uses Pacific time, not UTC", () => {
		// 2026-10-30 05:00 UTC is still the evening of Oct 29 in Seattle.
		expect(todayInSeattle(new Date("2026-10-30T05:00:00Z"))).toBe("2026-10-29");
	});

	test("seattleParts converts an instant to local date and time", () => {
		expect(seattleParts("2026-10-30T03:30:00Z")).toEqual({
			date: "2026-10-29",
			time: "20:30",
		});
	});
});

describe("occursOn", () => {
	test("weekly", () => {
		const rec: Recurrence = { kind: "weekly", days: ["TU", "TH"] };
		expect(occursOn(rec, "2026-10-27")).toBe(true);
		expect(occursOn(rec, "2026-10-29")).toBe(true);
		expect(occursOn(rec, "2026-10-28")).toBe(false);
	});

	test("weekly restricted to months (seasonal)", () => {
		const rec: Recurrence = { kind: "weekly", days: ["WE"], months: [6, 7, 8] };
		expect(occursOn(rec, "2026-07-15")).toBe(true);
		expect(occursOn(rec, "2026-10-28")).toBe(false);
	});

	test("weekly within a run (e.g. a theater show)", () => {
		const rec: Recurrence = {
			kind: "weekly",
			days: ["WE", "TH", "FR", "SA"],
			from: "2026-11-18",
			until: "2026-12-26",
		};
		expect(occursOn(rec, "2026-11-14")).toBe(false); // Sat before opening
		expect(occursOn(rec, "2026-11-18")).toBe(true);
		expect(occursOn(rec, "2026-12-26")).toBe(true);
		expect(occursOn(rec, "2027-01-02")).toBe(false);
	});

	test("2nd and 4th Monday", () => {
		const rec: Recurrence = { kind: "monthly-nth", nth: [2, 4], day: "MO" };
		expect(occursOn(rec, "2026-11-02")).toBe(false); // 1st
		expect(occursOn(rec, "2026-11-09")).toBe(true); // 2nd
		expect(occursOn(rec, "2026-11-16")).toBe(false); // 3rd
		expect(occursOn(rec, "2026-11-23")).toBe(true); // 4th
		expect(occursOn(rec, "2026-11-30")).toBe(false); // 5th
	});

	test("5th weekday only exists in some months", () => {
		const rec: Recurrence = { kind: "monthly-nth", nth: [5], day: "TH" };
		expect(occursOn(rec, "2026-10-29")).toBe(true);
		expect(occursOn(rec, "2026-11-26")).toBe(false); // 4th Thursday
	});

	test("last weekday of month", () => {
		const rec: Recurrence = { kind: "monthly-nth", nth: [-1], day: "MO" };
		expect(occursOn(rec, "2026-11-30")).toBe(true);
		expect(occursOn(rec, "2026-11-23")).toBe(false);
		expect(occursOn(rec, "2026-02-23")).toBe(true);
	});

	test("2nd Saturday", () => {
		const rec: Recurrence = { kind: "monthly-nth", nth: [2], day: "SA" };
		expect(occursOn(rec, "2026-11-14")).toBe(true);
		expect(occursOn(rec, "2026-11-07")).toBe(false);
	});
});

describe("dedupe", () => {
	const occ = (
		key: string,
		kind: Occurrence["kind"],
		start: string,
		venueId: string,
	): Occurrence => ({
		key,
		kind,
		refId: key,
		date: "2026-10-30",
		start,
		title: key,
		venueId,
		category: "jazz",
		vibe: [],
		url: "",
		confidence: "confirmed",
	});

	test("a venue-calendar event hides the generic night at the same venue and time", () => {
		const list = [
			occ("n1", "night", "19:00", "egans"),
			occ("e1", "event", "19:30", "egans"),
			occ("n2", "night", "22:00", "egans"),
			occ("n3", "night", "19:00", "other"),
		];
		expect(dedupe(list).map((o) => o.key)).toEqual(["e1", "n2", "n3"]);
	});
});

describe("eventOccurrences", () => {
	test("files events no pattern could place under Something else", () => {
		const [o] = eventOccurrences(
			[
				{
					id: "x",
					title: "Halloween at the Brewery",
					startsAt: "2026-10-31T17:00:00-07:00",
					url: "https://example.com",
					source: "test",
				},
			],
			[],
			"2026-10-31",
			1,
		);
		expect(o?.category).toBe("misc");
		expect(o?.vibe).toEqual(["low-key"]);
	});
});
