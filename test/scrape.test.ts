import { describe, expect, test } from "bun:test";
import { parseIcs, toIso } from "../scripts/scrape/ical";
import { extractLdEvents } from "../scripts/scrape/jsonld";
import { guessCategory } from "../scripts/scrape/source";
import { cleanAbbeyTitle, parseEgans } from "../scripts/scrape/sources";

describe("jsonld", () => {
	test("finds events in arrays, @graph, and subtypes; skips bad JSON", () => {
		const html = `
<script type="application/ld+json">{ not json }</script>
<script type="application/ld+json">[{"@type":"MusicEvent","name":"Band &amp; Friends","startDate":"2026-11-01T20:00:00-08:00","url":"https://x/1","offers":{"price":"15"}}]</script>
<script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":"Event","name":"Free Show","startDate":"2026-11-02T19:00:00-08:00","offers":[{"price":0}]}]}</script>`;
		const events = extractLdEvents(html);
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			name: "Band & Friends",
			price: "$15",
			url: "https://x/1",
		});
		expect(events[1]).toMatchObject({ name: "Free Show", price: "Free" });
	});

	test("finds events inside ItemList, keeps location, unescapes apostrophes", () => {
		const html = `<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"Event","name":"DEANTE\\\\' HITCHCOCK","startDate":"2026-11-05T20:00:25-0800","location":{"@type":"Place","name":"Fremont Abbey Arts Center"}}}]}</script>`;
		expect(extractLdEvents(html)).toEqual([
			expect.objectContaining({
				name: "DEANTE' HITCHCOCK",
				location: "Fremont Abbey Arts Center",
			}),
		]);
	});
});

describe("ical", () => {
	test("toIso handles UTC, TZID, and floating times across DST", () => {
		expect(toIso("20261101T200000Z")).toBe("2026-11-01T20:00:00Z");
		expect(toIso("20260715T190000", "America/Los_Angeles")).toBe(
			"2026-07-15T19:00:00-07:00",
		);
		expect(toIso("20261215T190000")).toBe("2026-12-15T19:00:00-08:00");
	});

	test("parses folded VEVENTs", () => {
		const ics = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"UID:abc",
			"DTSTART;TZID=America/Los_Angeles:20261105T193000",
			"SUMMARY:Long title that is",
			"  folded\\, with comma",
			"URL:https://example.com/e",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		expect(parseIcs(ics)).toEqual([
			{
				uid: "abc",
				summary: "Long title that is folded, with comma",
				start: "2026-11-05T19:30:00-08:00",
				end: undefined,
				url: "https://example.com/e",
			},
		]);
	});
});

describe("egans", () => {
	const html = `
<dl><dt>Our Reservation Policy</dt><dd>Call ahead</dd></dl>
<h2>October</h2>
<dl><dt>Thu Oct 22</dt><dd>7pm - Past Show ($15 cover)</dd></dl>
<dl><dt>Sat Oct 31 </dt>
<dd>
7pm - Angela's "Dear Abby" Cabaret
- with Robin (piano)
($20 cover)
</dd>
<dd>9:30pm - Henry Spark Quintet ($20 cover)</dd>
</dl>
<h2>January</h2>
<dl><dt>Fri Jan 8</dt><dd>7pm - New Year Trio - Someone (bass)</dd></dl>`;

	test("parses shows, skips the past, and rolls the year over", () => {
		const events = parseEgans(html, "2026-10-29");
		expect(events.map((e) => [e.title, e.startsAt, e.price])).toEqual([
			[
				`Angela's "Dear Abby" Cabaret`,
				"2026-10-31T19:00:00-07:00",
				"$20 cover",
			],
			["Henry Spark Quintet", "2026-10-31T21:30:00-07:00", "$20 cover"],
			["New Year Trio", "2027-01-08T19:00:00-08:00", undefined],
		]);
	});
});

describe("guessCategory", () => {
	test("maps titles to categories", () => {
		expect(guessCategory("Book Trivia at The Ink Drinker!")).toBe("trivia");
		expect(guessCategory("Polymer Clay Class: Charcuterie Board")).toBe(
			"class",
		);
		expect(guessCategory("Film Screening: The Lighthouse")).toBe("theater");
		expect(guessCategory("Some Band", "live-music")).toBe("live-music");
	});
});

describe("abbey arts", () => {
	test("strips date prefixes, venue suffixes, and trailing dates from titles", () => {
		expect(
			cleanAbbeyTitle("11/5 The Moth StorySLAM @ FREMONT ABBEY Seattle"),
		).toBe("The Moth StorySLAM");
		expect(
			cleanAbbeyTitle("10/13, 11/10, 12/8 Realization Process Workshop"),
		).toBe("Realization Process Workshop");
		expect(
			cleanAbbeyTitle("Samuel J, Sarah Conner immersive concert - Oct 30"),
		).toBe("Samuel J, Sarah Conner immersive concert");
	});
});
