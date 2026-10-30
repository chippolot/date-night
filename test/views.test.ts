import { describe, expect, test } from "bun:test";
import type { SiteData } from "../src/lib/data";
import { EMPTY_FILTERS } from "../src/lib/filters";
import type { Night, Venue } from "../src/lib/types";
import { tonightView, weekView } from "../src/pages/views";

const venue = (id: string, neighborhood: Venue["neighborhood"]): Venue => ({
	id,
	name: id,
	neighborhood,
	address: "",
	lat: 47.67,
	lng: -122.38,
	url: "",
	priceLevel: 1,
	tags: ["bar"],
});

const night = (
	id: string,
	venueId: string,
	days: Night["recurrence"],
): Night => ({
	id,
	venueId,
	title: id,
	category: "trivia",
	recurrence: days,
	start: "19:00",
	description: "",
	vibe: ["lively"],
	sourceUrl: "https://example.com",
	lastVerified: "2026-10-30",
	confidence: "confirmed",
});

// 2026-10-30 is a Friday
const data: SiteData = {
	venues: [venue("pub", "ballard"), venue("tavern", "fremont")],
	nights: [
		night("fri-trivia", "tavern", { kind: "weekly", days: ["FR"] }),
		night("mon-trivia", "pub", { kind: "weekly", days: ["MO"] }),
	],
	events: [],
	eventsUpdatedAt: null,
};

describe("empty state", () => {
	test("suggests the next matching day and filters to loosen", () => {
		const html = tonightView(data, "2026-10-30", {
			...EMPTY_FILTERS,
			hood: ["ballard"],
		});
		expect(html).toContain("Nothing on tonight with these filters.");
		expect(html).toContain('href="?date=2026-11-02&amp;hood=ballard"');
		expect(html).toContain("Next match: Mon, Nov 2");
		expect(html).toContain("Any neighborhood, not just Ballard");
	});

	test("leaves out loosening that wouldn't help", () => {
		const html = tonightView(data, "2026-10-30", {
			...EMPTY_FILTERS,
			hood: ["fremont"],
			cat: ["jazz"],
		});
		expect(html).not.toContain("Any neighborhood");
		expect(html).toContain("Anything, not just Jazz");
		expect(html).not.toContain("Next match");
	});

	test("an empty week gets the same treatment", () => {
		const html = weekView(data, "2026-10-30", {
			...EMPTY_FILTERS,
			q: "karaoke",
		});
		expect(html).toContain("Nothing this week with these filters.");
		expect(html).toContain("Clear the search “karaoke”");
		expect(html).not.toContain('class="week"');
	});
});
