import { describe, expect, test } from "bun:test";
import { summarize } from "../scripts/scrape-summary";
import type { DatedEvent, Venue } from "../src/lib/types";

const venue = (id: string, name: string) => ({ id, name }) as Venue;
const event = (id: string, venueId: string, title = id): DatedEvent => ({
	id,
	venueId,
	title,
	startsAt: "2026-11-07T19:30:00-08:00",
	url: `https://example.com/${id}`,
	source: "test",
});

describe("summarize", () => {
	const venues = [venue("tractor", "Tractor Tavern"), venue("egans", "Egan's")];

	test("lists events and venues that weren't there before", () => {
		const md = summarize(
			[event("a", "tractor")],
			[event("a", "tractor"), event("b", "egans", "Jazz [late] set")],
			venues,
		);
		expect(md).toContain("1 new event, 2 listed in all.");
		expect(md).toContain("### Venues with events for the first time (1)");
		expect(md).toContain("- Egan's: 1 event");
		expect(md).toContain(
			"- Sat, Nov 7 19:30: [Jazz \\[late\\] set](https://example.com/b) at Egan's _(test)_",
		);
		expect(md).not.toContain("Tractor Tavern");
	});

	test("nothing new", () => {
		const md = summarize(
			[event("a", "tractor")],
			[event("a", "tractor")],
			venues,
		);
		expect(md).toContain("0 new events, 1 listed in all.");
		expect(md).not.toContain("###");
	});
});
