import { describe, expect, test } from "bun:test";
import {
	EMPTY_FILTERS,
	type Filters,
	matchesTime,
	parseFilters,
	type TimeSlot,
	toQuery,
} from "../src/lib/filters";

const slots = (...time: TimeSlot[]): Filters => ({ ...EMPTY_FILTERS, time });

describe("day and time params", () => {
	test("round-trip through the URL and drop junk", () => {
		const f = parseFilters(
			new URLSearchParams("day=MO&day=FR&day=XX&time=evening&time=noon"),
		);
		expect(f.day).toEqual(["MO", "FR"]);
		expect(f.time).toEqual(["evening"]);
		expect(toQuery(f)).toBe("?day=MO&day=FR&time=evening");
	});
});

describe("matchesTime", () => {
	const evening = slots("evening"); // 5–8pm

	test("no slots match everything", () => {
		expect(matchesTime("03:00", undefined, EMPTY_FILTERS)).toBe(true);
	});

	test("without an end time, must start inside the slot", () => {
		expect(matchesTime("17:00", undefined, evening)).toBe(true);
		expect(matchesTime("19:59", undefined, evening)).toBe(true);
		expect(matchesTime("20:00", undefined, evening)).toBe(false);
		expect(matchesTime("16:30", undefined, evening)).toBe(false);
	});

	test("with an end time, matches anything on during the slot", () => {
		expect(matchesTime("15:00", "18:00", evening)).toBe(true); // happy hour overlap
		expect(matchesTime("15:00", "17:00", evening)).toBe(false); // ends as slot opens
		expect(matchesTime("19:30", "23:00", evening)).toBe(true);
		expect(matchesTime("09:00", "14:00", evening)).toBe(false);
	});

	test("late wraps past midnight, and end times can run into the next day", () => {
		const late = slots("late"); // 11pm–4am
		expect(matchesTime("23:30", undefined, late)).toBe(true);
		expect(matchesTime("00:30", undefined, late)).toBe(true);
		expect(matchesTime("21:00", "01:00", late)).toBe(true);
		expect(matchesTime("21:00", "01:00", evening)).toBe(false);
		expect(matchesTime("19:00", undefined, late)).toBe(false);
	});

	test("several slots match if any does", () => {
		const f = slots("evening", "night"); // 5–11pm
		expect(matchesTime("21:30", undefined, f)).toBe(true);
		expect(matchesTime("13:00", undefined, f)).toBe(false);
	});
});
