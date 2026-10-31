import { describe, expect, test } from "bun:test";
import type { SiteData } from "../src/lib/data";
import { EMPTY_FILTERS } from "../src/lib/filters";
import type { Night, Occurrence, Venue } from "../src/lib/types";
import { listingPath, sharePath, shareText } from "../src/pages/components";
import {
	footer,
	listingSummary,
	tonightView,
	weekView,
} from "../src/pages/views";

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

describe("happy hour shelf", () => {
	const happyHour: Night = {
		...night("pub-hh", "pub", {
			kind: "weekly",
			days: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
		}),
		title: "Happy hour",
		category: "food-drink-special",
		start: "15:00",
		end: "18:00",
		cost: "$2 off drafts",
	};
	const withHH: SiteData = { ...data, nights: [...data.nights, happyHour] };
	const sections = (html: string) => html.split("</details>")[1] ?? "";

	test("gathers happy hours into one closed shelf above the day's sections", () => {
		const html = tonightView(withHH, "2026-10-30", EMPTY_FILTERS);
		expect(sections(html)).not.toContain("cat-food-drink-special");
		expect(html.indexOf("specials")).toBeLessThan(html.indexOf("fri-trivia"));
		expect(html).toContain(
			'<details class="specials" data-specials="2026-10-30">',
		);
		expect(html).not.toContain(
			'<details class="specials" data-specials="2026-10-30" open',
		);
		expect(html).toContain('Happy hours <span class="part-count">1</span>');
		expect(html).toContain("3pm–6pm");
		expect(html).toContain("$2 off drafts");
	});

	test("leaves it out when happy hours are hidden", () => {
		const html = tonightView(withHH, "2026-10-30", {
			...EMPTY_FILTERS,
			hide: ["food-drink-special"],
		});
		expect(html).not.toContain("specials");
		expect(html).toContain("fri-trivia");
	});

	test("shows full cards when happy hours are all that's asked for", () => {
		const html = tonightView(withHH, "2026-10-30", {
			...EMPTY_FILTERS,
			cat: ["food-drink-special"],
		});
		expect(html).not.toContain('<details class="specials"');
		expect(html).toContain('<article class="card cat-food-drink-special"');
	});

	test("shows the shelf instead of the empty state when only happy hours match", () => {
		const html = tonightView(withHH, "2026-10-30", {
			...EMPTY_FILTERS,
			hood: ["ballard"],
		});
		expect(html).not.toContain("Nothing on tonight");
		expect(html).toContain('data-specials="2026-10-30"');
	});

	test("gives each day of the week its own shelf", () => {
		const html = weekView(withHH, "2026-10-30", EMPTY_FILTERS);
		expect(html.match(/<details class="specials"/g)?.length).toBe(7);
		expect(html).toContain('data-specials="2026-11-05"');
	});
});

describe("sharing", () => {
	const occurrence = (o: Partial<Occurrence> = {}): Occurrence => ({
		key: "event:halloween",
		kind: "event",
		refId: "halloween",
		date: "2026-10-31",
		start: "21:00",
		title: "Halloween",
		venueId: "roam",
		category: "dance",
		vibe: ["lively"],
		url: "https://example.com/",
		confidence: "confirmed",
		...o,
	});

	test("describes the listing and links to its day with it pinned", () => {
		const roam = { ...venue("roam", "ballard"), name: "Roam" };
		expect(shareText(occurrence(), roam)).toBe(
			"Halloween at Roam, Sat, Oct 31 at 9pm",
		);
		expect(shareText(occurrence({ title: "Halloween at Roam" }), roam)).toBe(
			"Halloween at Roam, Sat, Oct 31 at 9pm",
		);
		expect(shareText(occurrence({ allDay: true }), undefined)).toBe(
			"Halloween, Sat, Oct 31, all day",
		);
		expect(sharePath(occurrence())).toBe("/e/halloween/");
		expect(
			listingPath("event", "instagram-2026-10-31T21:00-halloween-at-roam"),
		).toBe("/e/instagram-2026-10-31T21-00-halloween-at-roam/");
		expect(listingPath("night", "kochendorfers-trivia")).toBe(
			"/n/kochendorfers-trivia/",
		);
		expect(listingSummary(occurrence(), roam, "Sat, Oct 31 at 9pm")).toBe(
			"Sat, Oct 31 at 9pm · Roam, Ballard · Dancing",
		);
	});

	test("offers the everything feed once, in the page's own subscribe line", () => {
		expect(footer()).toContain("Subscribe to everything");
		expect(footer({ subscribe: false })).not.toContain("Subscribe");
	});
});
