import { describe, expect, test } from "bun:test";
import { nights } from "../data/nights";
import { venues } from "../data/venues";
import { firstOccurrence } from "../src/lib/ics";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("curated data", () => {
	test("ids are unique slugs", () => {
		for (const list of [venues, nights]) {
			const ids = list.map((x) => x.id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
		}
	});

	test("venues are in the north Seattle area", () => {
		for (const v of venues) {
			expect(v.lat, v.id).toBeGreaterThan(47.64);
			expect(v.lat, v.id).toBeLessThan(47.72);
			expect(v.lng, v.id).toBeGreaterThan(-122.42);
			expect(v.lng, v.id).toBeLessThan(-122.3);
		}
	});

	test("nights are well-formed", () => {
		const venueIds = new Set(venues.map((v) => v.id));
		for (const n of nights) {
			expect(venueIds.has(n.venueId), `${n.id} → ${n.venueId}`).toBe(true);
			expect(n.start, n.id).toMatch(TIME);
			if (n.end) expect(n.end, n.id).toMatch(TIME);
			// All-day nights need the open hours so time-of-day filters can match them
			if (n.allDay) expect(n.end, n.id).toBeDefined();
			expect(n.lastVerified, n.id).toMatch(DATE);
			expect(n.sourceUrl, n.id).toStartWith("https://");
			// Throws if the recurrence can never happen (e.g. 5th weekday restricted to one short month).
			expect(() => firstOccurrence(n.recurrence, "2026-01-01")).not.toThrow();
		}
	});
});
