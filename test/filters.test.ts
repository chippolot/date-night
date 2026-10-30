import { describe, expect, test } from "bun:test";
import {
	applyFilters,
	EMPTY_FILTERS,
	entryPrice,
	type Filters,
	matchesCost,
	matchesTime,
	parseFilters,
	type TimeSlot,
	toQuery,
	viewDate,
} from "../src/lib/filters";
import type { Occurrence, Venue } from "../src/lib/types";

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

describe("hide", () => {
	test("round-trips through the query string and drops hidden categories", () => {
		const f = parseFilters(
			new URLSearchParams("hide=food-drink-special&hide=bogus"),
		);
		expect(f.hide).toEqual(["food-drink-special"]);
		expect(toQuery(f)).toBe("?hide=food-drink-special");
		const occ = (category: Occurrence["category"]): Occurrence => ({
			key: category,
			kind: "night",
			refId: category,
			date: "2026-10-29",
			start: "19:00",
			title: category,
			category,
			vibe: [],
			url: "https://example.com",
			confidence: "confirmed",
		});
		const list = [occ("food-drink-special"), occ("trivia")];
		expect(applyFilters(list, new Map(), f).map((o) => o.category)).toEqual([
			"trivia",
		]);
	});
});

describe("date", () => {
	test("parses a valid date, ignores junk, and never shows the past", () => {
		expect(parseFilters(new URLSearchParams("date=2026-11-14")).date).toBe(
			"2026-11-14",
		);
		expect(
			parseFilters(new URLSearchParams("date=tomorrow")).date,
		).toBeUndefined();
		expect(toQuery({ ...EMPTY_FILTERS, date: "2026-11-14" })).toBe(
			"?date=2026-11-14",
		);
		const today = "2026-10-29";
		expect(viewDate({ ...EMPTY_FILTERS, date: "2026-11-14" }, today)).toBe(
			"2026-11-14",
		);
		expect(viewDate({ ...EMPTY_FILTERS, date: "2026-10-01" }, today)).toBe(
			today,
		);
		expect(viewDate(EMPTY_FILTERS, today)).toBe(today);
	});
});

describe("search", () => {
	const occ = (
		title: string,
		category: Occurrence["category"],
		venueId?: string,
	): Occurrence => ({
		key: title,
		kind: "event",
		refId: title,
		date: "2026-10-29",
		start: "19:00",
		title,
		venueId,
		category,
		vibe: [],
		url: "https://example.com",
		confidence: "confirmed",
	});
	const venues = new Map<string, Venue>([
		[
			"skal",
			{
				id: "skal",
				name: "Skål Beer Hall",
				neighborhood: "ballard",
				address: "",
				lat: 47.66,
				lng: -122.38,
				url: "https://example.com",
				priceLevel: 2,
				tags: [],
			},
		],
	]);
	const list = [
		occ("Viking Trivia", "trivia", "skal"),
		occ("Late Jazz Set", "jazz"),
		occ("Comedy Battle Royale", "comedy"),
	];
	const titles = (q: string) =>
		applyFilters(list, venues, parseFilters(new URLSearchParams({ q }))).map(
			(o) => o.title,
		);

	test("round-trips through the URL, trimmed", () => {
		const f = parseFilters(new URLSearchParams("q=%20jazz%20"));
		expect(f.q).toBe("jazz");
		expect(toQuery(f)).toBe("?q=jazz");
		expect(parseFilters(new URLSearchParams("q=%20%20")).q).toBeUndefined();
	});

	test("matches every word across title, venue, neighborhood and category", () => {
		expect(titles("jazz")).toEqual(["Late Jazz Set"]);
		expect(titles("skal")).toEqual(["Viking Trivia"]); // accent-insensitive venue name
		expect(titles("ballard trivia")).toEqual(["Viking Trivia"]);
		expect(titles("stories")).toEqual(["Comedy Battle Royale"]); // category label
		expect(titles("ballard jazz")).toEqual([]);
		expect(titles("")).toHaveLength(3);
	});
});

describe("cost filter", () => {
	const o = (
		cost: string | undefined,
		category: Occurrence["category"] = "live-music",
	) => ({
		cost,
		category,
	});

	test("entryPrice reads the lowest stated price", () => {
		expect(entryPrice(o("Free"))).toBe(0);
		expect(entryPrice(o("No cover"))).toBe(0);
		expect(entryPrice(o("Free; $10 kit optional"))).toBe(0);
		expect(entryPrice(o("$10–20 cover"))).toBe(10);
		expect(entryPrice(o("$19.80–$25.87"))).toBe(19.8);
		expect(entryPrice(o("Ticketed"))).toBeNull();
		expect(entryPrice(o(undefined))).toBeUndefined();
		// Happy hour prices are deals, not a cover
		expect(entryPrice(o("$3 oysters", "food-drink-special"))).toBeUndefined();
	});

	test("free and up to $20", () => {
		const free: Pick<Filters, "cost"> = { cost: "free" };
		const under20: Pick<Filters, "cost"> = { cost: "under20" };
		expect(matchesCost(o("Free"), free)).toBe(true);
		expect(matchesCost(o(undefined), free)).toBe(false);
		expect(matchesCost(o(undefined), under20)).toBe(true);
		expect(matchesCost(o("$20 cover"), under20)).toBe(true);
		expect(matchesCost(o("$25"), under20)).toBe(false);
		expect(matchesCost(o("Sold out"), under20)).toBe(false);
	});

	test("round-trips through the URL", () => {
		const f = parseFilters(new URLSearchParams("cost=free&price=1"));
		expect(f.cost).toBe("free");
		expect(toQuery(f)).toBe("?price=1&cost=free");
		expect(
			parseFilters(new URLSearchParams("cost=cheap")).cost,
		).toBeUndefined();
	});
});
