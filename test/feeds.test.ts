import { describe, expect, test } from "bun:test";
import type { SiteData } from "../src/lib/data";
import {
	feed,
	feedName,
	feedPath,
	feedScopes,
	matchingFeeds,
} from "../src/lib/feeds";
import type { Venue } from "../src/lib/types";

const venue = (id: string, neighborhood: Venue["neighborhood"]): Venue => ({
	id,
	name: id,
	neighborhood,
	address: "1 Main St",
	lat: 47.67,
	lng: -122.38,
	url: "",
	priceLevel: 1,
	tags: ["bar"],
});

const data: SiteData = {
	venues: [venue("egans", "ballard"), venue("dock", "fremont")],
	nights: [
		{
			id: "egans-jazz",
			venueId: "egans",
			title: "Live jazz",
			category: "jazz",
			recurrence: { kind: "weekly", days: ["FR"] },
			start: "19:00",
			description: "",
			vibe: ["romantic"],
			sourceUrl: "https://example.com",
			lastVerified: "2026-10-30",
			confidence: "confirmed",
		},
		{
			id: "dock-trivia",
			venueId: "dock",
			title: "Trivia",
			category: "trivia",
			recurrence: { kind: "weekly", days: ["WE"] },
			start: "19:30",
			description: "",
			vibe: ["lively"],
			sourceUrl: "https://example.com",
			lastVerified: "2026-10-30",
			confidence: "confirmed",
		},
	],
	// Friday Nov 6's jazz night has a named band on the venue calendar
	events: [
		{
			id: "egans-band",
			venueId: "egans",
			title: "The Band",
			startsAt: "2026-11-06T19:00:00-08:00",
			url: "https://example.com/band",
			source: "egans",
			category: "jazz",
		},
	],
	eventsUpdatedAt: null,
};

describe("calendar feeds", () => {
	test("one feed for everything, each category, each neighborhood, and each pair", () => {
		const scopes = feedScopes();
		expect(scopes).toHaveLength(1 + 12 + 8 * (1 + 12));
		expect(new Set(scopes.map(feedPath)).size).toBe(scopes.length);
		expect(feedPath({ hood: "ballard", cat: "jazz" })).toBe(
			"/feeds/hood/ballard/jazz.ics",
		);
		expect(feedName({ hood: "ballard", cat: "jazz" })).toBe("Jazz in Ballard");
		expect(feedName({})).toBe("Everything");
	});

	test("keeps only what's in scope", () => {
		const ballard = feed(data, "2026-10-30", { hood: "ballard" });
		expect(ballard).toContain("SUMMARY:Live jazz @ egans");
		expect(ballard).toContain("SUMMARY:The Band @ egans");
		expect(ballard).not.toContain("Trivia");
		expect(feed(data, "2026-10-30", { cat: "trivia" })).not.toContain("jazz");
	});

	test("skips a night on the days a scraped event replaces it", () => {
		const cal = feed(data, "2026-10-30", {});
		expect(cal).toContain("EXDATE;TZID=America/Los_Angeles:20261106T190000");
		expect(cal.match(/EXDATE/g)).toHaveLength(1);
	});

	test("matching feeds pair up picks, up to a limit", () => {
		expect(matchingFeeds([], [])).toEqual([
			{ hood: undefined, cat: undefined },
		]);
		expect(matchingFeeds(["ballard", "fremont"], ["jazz"])).toHaveLength(2);
		expect(
			matchingFeeds(
				["ballard", "fremont", "wallingford"],
				["jazz", "trivia", "comedy"],
			),
		).toBeUndefined();
	});
});
