import { describe, expect, test } from "bun:test";
import { surprise } from "../src/lib/surprise";
import type { Occurrence, Venue } from "../src/lib/types";

const v = (
	id: string,
	neighborhood: Venue["neighborhood"],
	tags: string[],
): Venue => ({
	id,
	name: id,
	neighborhood,
	address: "",
	lat: 0,
	lng: 0,
	url: "",
	priceLevel: 2,
	tags,
});

const o = (
	refId: string,
	venueId: string,
	category: Occurrence["category"],
	start: string,
): Occurrence => ({
	key: refId,
	kind: "night",
	refId,
	date: "2026-10-29",
	start,
	title: refId,
	venueId,
	category,
	vibe: [],
	url: "",
	confidence: "confirmed",
});

const venues = [
	v("oyster-bar", "ballard", ["restaurant"]),
	v("jazz-club", "ballard", ["music-venue"]),
	v("far-restaurant", "green-lake", ["restaurant"]),
	v("fremont-bistro", "fremont", ["restaurant"]),
];

describe("surprise", () => {
	test("pairs a food special with an activity nearby", () => {
		const tonight = [
			o("oysters", "oyster-bar", "food-drink-special", "16:00"),
			o("jazz", "jazz-club", "jazz", "20:00"),
		];
		const pick = surprise(tonight, venues, () => 0);
		expect(pick?.activity?.refId).toBe("jazz");
		expect(pick?.food.occurrence?.refId).toBe("oysters");
	});

	test("falls back to a nearby restaurant, never a far one", () => {
		const tonight = [o("jazz", "jazz-club", "jazz", "20:00")];
		for (const r of [0, 0.34, 0.67, 0.99]) {
			const pick = surprise(tonight, venues, () => r);
			expect(["oyster-bar", "fremont-bistro"]).toContain(
				pick?.food.venue.id ?? "",
			);
		}
	});

	test("returns null when there are no restaurants at all", () => {
		expect(surprise([], [v("bar", "ballard", ["bar"])])).toBeNull();
	});
});

describe("surprise retries", () => {
	test("tries another activity when the first has no food nearby", () => {
		const vs = [
			v("lonely-bar", "green-lake", ["bar"]),
			v("jazz-club", "ballard", ["music-venue"]),
			v("oyster-bar", "ballard", ["restaurant"]),
		];
		const tonight = [
			o("karaoke", "lonely-bar", "karaoke", "21:00"),
			o("jazz", "jazz-club", "jazz", "20:00"),
		];
		for (const r of [0, 0.5, 0.99]) {
			const pick = surprise(tonight, vs, () => r);
			expect(pick?.activity?.refId).toBe("jazz");
			expect(pick?.food.venue.id).toBe("oyster-bar");
		}
	});
});
