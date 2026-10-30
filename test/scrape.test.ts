import { describe, expect, test } from "bun:test";
import { parseIcs, toIso } from "../scripts/scrape/ical";
import { extractLdEvents } from "../scripts/scrape/jsonld";
import { guessCategory } from "../scripts/scrape/source";
import {
	cleanAbbeyTitle,
	matoEventSlugs,
	parseContra,
	parseEgans,
	parseEventbrite,
	parseEvey,
	parseJetCityShow,
	parseMatoEvents,
	parseMeany,
	parseNordic,
	parseOctopus,
	parsePantry,
	parseSaltstone,
	parseSeaFolklore,
	parseShibuyaEvent,
	parseSquarespaceEvents,
	parseTaprootShow,
	parseUwCampus,
	parseWatershed,
	parseWayward,
	parseWestOfLenin,
	parseWoodland,
	parseYuTang,
	seaMonsterEventUrls,
	shibuyaEventUrls,
	shibuyaToFetch,
	withYear,
} from "../scripts/scrape/sources";

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

	test("flags all-day and cancelled events", () => {
		const ics = [
			"BEGIN:VEVENT",
			"DTSTART;VALUE=DATE:20261128",
			"SUMMARY:Makers Market",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"DTSTART:20261103T030000Z",
			"STATUS:CANCELLED",
			"SUMMARY:Show & Tell",
			"END:VEVENT",
		].join("\r\n");
		expect(parseIcs(ics).map((e) => [e.allDay, e.cancelled])).toEqual([
			[true, undefined],
			[undefined, true],
		]);
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
		expect(guessCategory("Magic: The Gathering Draft Night")).toBe("trivia");
		expect(guessCategory("Magic Wand Circuit Craft", "class")).toBe("class");
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

describe("nordic museum", () => {
	const card = (date: string, title: string, time: string, admission = "") => `
<li><div class="card-event position-relative">
  <div class="card-event__contents no-bottom">
    <div class="subheading position-relative content-text content-text--gray-theme green">
			<p>${date}</p>
	</div>        <h3 class="text-display--sm text-display--dark mb-2">
      <a class="card-title-link block-link" href="https://nordicmuseum.org/events/${title.length}">${title}</a>
    </h3>
          <p class="content-text mb-0">${time}</p>      <div class="card-event__admission wysiwyg"><p>${admission}</p></div>      </div>
</div></li>`;

	test("keeps single-date events with a start time; skips cancelled, ranges, and series", () => {
		const html = [
			card(
				"Oct 29, 2026",
				"CANCELLED | Film Screening: The Lighthouse (2019)",
				"6:00 pm - 8:00 pm",
			),
			card(
				"Oct 29, 2026",
				"Culture Class: Andersen&#039;s Gothic Tales",
				"6:30 pm  - 8:00 pm",
				"Members:&nbsp;$35<br>General Admission:&nbsp;$40",
			),
			card("Every Thursday", "Docent-Led Museum Tours", "1:00 - 2:00pm"),
			card("November 20-22, 2026", "Julefest", "None"),
			card(
				"Dec 18, 2026",
				"Jul Stories",
				"7:00 pm - 9:00 pm",
				"General Admission: Free",
			),
			card("Jan 2, 2027", "Seattle Kraken Nordic Night", "7:00 pm"),
		].join("");
		expect(
			parseNordic(html).map((e) => [
				e.title,
				e.startsAt,
				e.endsAt,
				e.price,
				e.category,
			]),
		).toEqual([
			[
				"Culture Class: Andersen's Gothic Tales",
				"2026-10-29T18:30:00-07:00",
				"2026-10-29T20:00:00-07:00",
				"$40",
				"class",
			],
			[
				"Jul Stories",
				"2026-12-18T19:00:00-08:00",
				"2026-12-18T21:00:00-08:00",
				"Free",
				"art",
			],
			[
				"Seattle Kraken Nordic Night",
				"2027-01-02T19:00:00-08:00",
				undefined,
				undefined,
				"art",
			],
		]);
	});
});

describe("withYear", () => {
	test("rolls early months into next year late in the year", () => {
		expect(withYear(11, 5, "2026-10-29")).toBe("2026-11-05");
		expect(withYear(1, 2, "2026-11-20")).toBe("2027-01-02");
		expect(withYear(9, 30, "2026-10-29")).toBe("2026-09-30");
	});
});

describe("wayward", () => {
	test("pairs each meta line with the post that follows it", () => {
		const html = `
<div class="entry-meta">
	<span class="arrow">
		October 29, 2026
	</span>
	<span>|</span>
	<span>8:00 PM</span>
</div><!-- .entry-meta -->
<div id="post-9448" class="post hentry category-event">
	<p class="ticket--link"><a href="https://www.eventbrite.com/e/1">$5 - $20 suggested donation</a></p>
	<h2 class="entry-title"><a href="https://www.waywardmusic.org/event/nonseq/" title="x" rel="bookmark">NonSeq: Breakfast Calculus &#8211; Live</a></h2>
</div>`;
		expect(parseWayward(html)).toEqual([
			{
				id: "wayward-2026-10-29-nonseq-breakfast-calculus-live",
				title: "NonSeq: Breakfast Calculus – Live",
				startsAt: "2026-10-29T20:00:00-07:00",
				url: "https://www.waywardmusic.org/event/nonseq/",
				price: "$5 - $20 suggested donation",
			},
		]);
	});
});

describe("west of lenin", () => {
	test("reads JEvents day/month/time/title and skips past dates", () => {
		const item = (day: number, mon: string, time: string, title: string) => `
<div class="eventsdiv">
	<ul>
		<li><a class="jevdateicon jevdateiconmod" href="index.php"><span class="jevdateicon1">${day}&nbsp;</span><span class="jevdateicon2">${mon}</span> </a>
			<div class="jeviconnotdate"><span class="mod_events_latest_content">&nbsp;<strong>${time}</strong><br /><br /><a href="https://tix.example/${day}?a=1&amp;b=2" target="_blank"><strong>${title}</strong></a><br /></span>
			</div>
		</li>
	</ul>
</div>`;
		const html = [
			item(28, "Oct", "7:30 PM", "Yesterday"),
			item(31, "Oct", "9:00 PM", "Slasher"),
			item(2, "Jan", "3:00 PM", "New Year Show"),
		].join("");
		expect(
			parseWestOfLenin(html, "2026-10-29").map((e) => [
				e.title,
				e.startsAt,
				e.url,
			]),
		).toEqual([
			[
				"Slasher",
				"2026-10-31T21:00:00-07:00",
				"https://tix.example/31?a=1&b=2",
			],
			[
				"New Year Show",
				"2027-01-02T15:00:00-08:00",
				"https://tix.example/2?a=1&b=2",
			],
		]);
	});
});

describe("octopus", () => {
	test("reads special-event cards and drops the date prefix from the title", () => {
		const html = `
<div class="card-special-event h-100 ">
	<h3 class="card-special-event__title mb-0">
		<a href="https://theoctopusbar.com/events/pretty-ugly" aria-label="More Info">
			October 30 + 31 · Pretty Ugly Vol. 13
		</a>
	</h3>
	<li class="my-auto no-bottom">
		<h4>Date</h4>
		<p>Fri, Oct 30</p>
	</li>
	<li class="my-auto no-bottom">
		<h4>Time</h4>
		<p>8:00PM</p>
	</li>
</div>`;
		expect(parseOctopus(html, "2026-10-29")).toEqual([
			expect.objectContaining({
				title: "Pretty Ugly Vol. 13",
				startsAt: "2026-10-30T20:00:00-07:00",
				url: "https://theoctopusbar.com/events/pretty-ugly",
			}),
		]);
	});
});

describe("taproot", () => {
	test("picks up named performances from a show page", () => {
		const html = `
<meta property="og:title" content="A Charlie Brown Christmas - Taproot Theatre" />
<p><strong>Pay What You Can</strong>: Thursday, December 3 at 7:00 PM</p>
<p><strong>CC:</strong> Friday, December 18 at 4:00 PM</p>
<p><strong>Closed Captioned</strong>: December 16 at 7:30 PM.<br />
<p><strong>Pay What You Can</strong>: Wednesday, October 14 at 7:00 PM</p>
<p><strong>Tickets</strong></p>`;
		const url = "https://taproottheatre.org/2026/charlie-brown-christmas/";
		expect(
			parseTaprootShow(html, url, "2026-10-29").map((e) => [
				e.title,
				e.startsAt,
			]),
		).toEqual([
			[
				"A Charlie Brown Christmas (Pay What You Can)",
				"2026-12-03T19:00:00-08:00",
			],
			[
				"A Charlie Brown Christmas (Closed Captioned)",
				"2026-12-18T16:00:00-08:00",
			],
			[
				"A Charlie Brown Christmas (Closed Captioned)",
				"2026-12-16T19:30:00-08:00",
			],
		]);
	});
});

describe("pantry", () => {
	test("maps classes and dinners, flags sold out, skips private and kids' events", () => {
		const entry = (
			id: number,
			title: string,
			kind: string,
			at: string,
			soldOut = false,
		) => ({
			id,
			title,
			url: `https://thepantryseattle.com/${kind}/${id}`,
			soldOut,
			nextEventDate: at,
		});
		const events = parsePantry([
			entry(1, "Roman Pizza", "class", "2026-12-07 18:00:00"),
			entry(
				2,
				"Family Dinner: Seafood Feast",
				"dinner",
				"2026-11-20 19:00:00",
				true,
			),
			entry(3, "Private Class", "class", "2026-11-12 18:00:00", true),
			entry(
				4,
				"Cooking With Kids: Holiday Treats",
				"class",
				"2026-11-28 10:00:00",
			),
		]);
		expect(
			events.map((e) => [e.title, e.startsAt, e.price, e.category]),
		).toEqual([
			["Roman Pizza", "2026-12-07T18:00:00-08:00", undefined, "class"],
			[
				"Family Dinner: Seafood Feast",
				"2026-11-20T19:00:00-08:00",
				"Sold out",
				"food-drink-special",
			],
		]);
	});
});

describe("shibuya hifi", () => {
	test("keeps sitemap entries modified since the cutoff", () => {
		const xml = `<urlset>
<url><loc>https://www.shibuyahifi.com/event-details/old</loc><lastmod>2026-02-01</lastmod></url>
<url><loc>https://www.shibuyahifi.com/event-details/new</loc><lastmod>2026-10-21</lastmod><image:image></image:image></url>
</urlset>`;
		expect(shibuyaEventUrls(xml, "2026-08-30")).toEqual([
			{
				url: "https://www.shibuyahifi.com/event-details/new",
				lastmod: "2026-10-21",
			},
		]);
	});

	test("reads the event page JSON-LD and skips cancelled sessions", () => {
		const page = (name: string, status = "EventScheduled") =>
			`<script type="application/ld+json">${JSON.stringify({
				"@context": "https://schema.org",
				"@type": "Event",
				name,
				startDate: "2026-11-06T17:00:00-08:00",
				endDate: "2026-11-06T18:30:00-08:00",
				eventStatus: `https://schema.org/${status}`,
				location: {
					"@type": "Place",
					url: "https://www.shibuyahifi.com/event-details/x",
					name: "Shibuya HiFi",
				},
			})}</script>`;
		const url = "https://www.shibuyahifi.com/event-details/x";
		expect(
			parseShibuyaEvent(page("Ben Webster Quintet - Soulville"), url),
		).toEqual([
			{
				id: "shibuya-hifi-2026-11-06T17:00-ben-webster-quintet-soulville",
				title: "Ben Webster Quintet - Soulville",
				startsAt: "2026-11-06T17:00:00-08:00",
				endsAt: "2026-11-06T18:30:00-08:00",
				url,
				category: "jazz",
			},
		]);
		expect(parseShibuyaEvent(page("Dancing Queen"), url)[0]?.category).toBe(
			"live-music",
		);
		expect(parseShibuyaEvent(page("Thriller", "EventCancelled"), url)).toEqual(
			[],
		);
	});

	test("fetches new and changed pages, plus the stalest cached ones", () => {
		const page = (n: number, lastmod = "2026-10-21") => ({
			url: `https://www.shibuyahifi.com/event-details/${n}`,
			lastmod,
		});
		const cached = (lastmod: string, fetched: string) => ({
			lastmod,
			fetched,
			events: [],
		});
		const cache = {
			[page(1).url]: cached("2026-10-21", "2026-10-28"), // fresh: reuse
			[page(2).url]: cached("2026-10-01", "2026-10-28"), // lastmod changed
			[page(3).url]: cached("2026-10-21", "2026-10-15"), // fetched 2 weeks ago
		};
		expect(
			shibuyaToFetch([page(1), page(2), page(3), page(4)], cache, "2026-10-29"),
		).toEqual([page(2).url, page(4).url, page(3).url]);
	});
});

describe("squarespace", () => {
	test("reads upcoming events from the list page, skipping past and all-day ones", () => {
		const article = (
			state: string,
			href: string,
			title: string,
			meta: string,
		) =>
			`<article class="eventlist-event eventlist-event--${state} eventlist-event--hasimg">
<h1 class="eventlist-title"><a href="${href}" class="eventlist-title-link">${title}</a></h1>
<ul class="eventlist-meta event-meta">${meta}</ul></article>`;
		const times = (date: string, start: string, end: string) =>
			`<li class="eventlist-meta-item eventlist-meta-time event-meta-item">
<span class="event-time-localized">
<time class="event-time-localized-start" datetime="${date}">${start}</time>
<span class="event-datetime-divider"></span>
<time class="event-time-localized-end" datetime="${date}">${end}</time>
</span></li>`;
		const html = [
			article(
				"past",
				"/events/old",
				"Old",
				times("2026-10-01", "5:00 PM", "6:00 PM"),
			),
			article(
				"upcoming",
				"/events/tarot-nov-3",
				"Tarot &amp; Wine",
				times("2026-11-03", "5:00 PM", "8:00 PM"),
			),
			article(
				"upcoming",
				"/events/market",
				"All-Day Market",
				'<li class="eventlist-meta-item eventlist-meta-date"><time class="event-date" datetime="2026-11-04">Wednesday</time></li>',
			),
		].join("\n");
		expect(parseSquarespaceEvents(html, "https://example.com", "ex")).toEqual([
			{
				id: "ex-2026-11-04T01:00-tarot-wine",
				title: "Tarot & Wine",
				startsAt: "2026-11-03T17:00:00-08:00",
				endsAt: "2026-11-03T20:00:00-08:00",
				url: "https://example.com/events/tarot-nov-3",
			},
		]);
	});
});

describe("saltstone", () => {
	test("reads date and time from product titles, inferring the year", () => {
		const product = (
			id: number,
			title: string,
			price: string,
			available = true,
		) => ({
			id,
			title,
			handle: `p${id}`,
			variants: [{ price, available }],
		});
		const events = parseSaltstone(
			[
				product(
					1,
					"Clay Curious: Friday November 6th, 6:30pm - 8:30pm",
					"100.00",
				),
				product(
					2,
					"Queer Night! Throwing On The Wheel! Sunday, November 22nd, 6:30-8:30pm",
					"25.00",
					false,
				),
				product(
					3,
					"BIPOC Wheel Night Sunday, January 3rd, 6:30-8:30pm",
					"25.00",
				),
				product(
					4,
					"Clay Curious: Sunday October 4th, 6:30pm - 8:30pm",
					"100.00",
				),
				product(5, "Gift Card", "50.00"),
			],
			"2026-10-29",
		);
		expect(events.map((e) => [e.title, e.startsAt, e.endsAt, e.price])).toEqual(
			[
				[
					"Clay Curious",
					"2026-11-06T18:30:00-08:00",
					"2026-11-06T20:30:00-08:00",
					"$100",
				],
				[
					"Queer Night! Throwing On The Wheel!",
					"2026-11-22T18:30:00-08:00",
					"2026-11-22T20:30:00-08:00",
					"Sold out",
				],
				[
					"BIPOC Wheel Night",
					"2027-01-03T18:30:00-08:00",
					"2027-01-03T20:30:00-08:00",
					"$25",
				],
			],
		);
		expect(events[0]?.url).toBe("https://saltstoneceramics.com/products/p1");
	});
});

describe("yu tang", () => {
	test("reads each Day/Time option of the embedded workshop products", () => {
		const context = {
			items: [
				{
					title: "One-Time Wheel Throwing",
					fullUrl: "/workshops/p/onetimewheel",
					variants: [
						{
							price: { value: "80.00" },
							soldOut: false,
							attributes: { "Day/Time": "November 7th 2026 6pm" },
						},
						{
							price: { value: "80.00" },
							soldOut: true,
							attributes: { "Day/Time": "November 21st 2026 6:30pm" },
						},
					],
				},
				{
					title: "Raku workshop December 5th 2026",
					fullUrl: "/workshops/p/raku",
					variants: [
						{ price: { value: "75.00" }, soldOut: false, attributes: {} },
					],
				},
			],
		};
		const html = `<div class="product-list" data-controller="ProductList"
    data-context="${JSON.stringify(context).replaceAll('"', "&quot;")}"></div>`;
		expect(
			parseYuTang(html).map((e) => [e.title, e.startsAt, e.price, e.url]),
		).toEqual([
			[
				"One-Time Wheel Throwing",
				"2026-11-07T18:00:00-08:00",
				"$80",
				"https://www.yutangceramics.com/workshops/p/onetimewheel",
			],
			[
				"One-Time Wheel Throwing",
				"2026-11-21T18:30:00-08:00",
				"Sold out",
				"https://www.yutangceramics.com/workshops/p/onetimewheel",
			],
		]);
	});
});

describe("seattle folklore society", () => {
	test("keeps mapped venues and cleans escaped titles", () => {
		const ics = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"DTSTART;TZID=America/Los_Angeles:20261121T193000",
			"DTEND;TZID=America/Los_Angeles:20261121T220000",
			"URL:https://www.seafolklore.org/events/hildaland",
			"SUMMARY:Hildaland (Ethan Setiawan\\, Louise Bichan) In Concert\\; Sat\\, Nov 2",
			" 1",
			"LOCATION:Phinney Center Concert Hall\\, Brick Building\\, 6532 Phinney Ave N",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"DTSTART;TZID=America/Los_Angeles:20261219T193000",
			"SUMMARY:Pint &amp\\; Dale",
			"LOCATION:Fremont Abbey\\, 4272 Fremont Ave N",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"DTSTART;TZID=America/Los_Angeles:20261205T193000",
			"SUMMARY:Elsewhere",
			"LOCATION:Somewhere Else\\, Tacoma",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");
		expect(
			parseSeaFolklore(ics).map((e) => [
				e.venueId,
				e.title,
				e.startsAt,
				e.endsAt,
			]),
		).toEqual([
			[
				"phinney-center",
				"Hildaland (Ethan Setiawan, Louise Bichan) In Concert",
				"2026-11-21T19:30:00-08:00",
				"2026-11-21T22:00:00-08:00",
			],
			["fremont-abbey", "Pint & Dale", "2026-12-19T19:30:00-08:00", undefined],
		]);
	});
});

describe("eventbrite", () => {
	test("keeps events at mapped venues, with local times and prices", () => {
		const event = (id: string, name: string, local: string, extra = {}) => ({
			id,
			name: { text: name },
			url: `https://www.eventbrite.com/e/${id}`,
			start: { local, timezone: "America/Los_Angeles" },
			venue: { name: "Old Stove Brewing Co - Gardens" },
			...extra,
		});
		const events = parseEventbrite(
			[
				event("1", "Cut Copy (DJ Set)", "2026-11-04T21:00:00", {
					end: {
						local: "2026-11-05T02:00:00",
						timezone: "America/Los_Angeles",
					},
					ticket_availability: {
						minimum_ticket_price: { major_value: "25.00" },
						maximum_ticket_price: { major_value: "38.50" },
					},
				}),
				event("2", "Sold Out Show", "2026-11-06T20:00:00", {
					ticket_availability: { is_sold_out: true },
				}),
				event("3", "Free Trivia Night", "2026-11-07T19:00:00", {
					is_free: true,
				}),
				event("4", "Elsewhere", "2026-11-08T19:00:00", {
					venue: { name: "Old Stove Brewing Ship Canal" },
				}),
				event("5", "Online", "2026-11-09T19:00:00", { venue: null }),
			],
			{
				idPrefix: "eb",
				venues: { "old stove brewing co - gardens": "old-stove-gardens" },
				category: "comedy",
			},
		);
		expect(
			events.map((e) => [
				e.id,
				e.venueId,
				e.startsAt,
				e.endsAt,
				e.price,
				e.category,
			]),
		).toEqual([
			[
				"eb-1",
				"old-stove-gardens",
				"2026-11-04T21:00:00-08:00",
				"2026-11-05T02:00:00-08:00",
				"$25–$38.50",
				"comedy",
			],
			[
				"eb-2",
				"old-stove-gardens",
				"2026-11-06T20:00:00-08:00",
				undefined,
				"Sold out",
				"comedy",
			],
			[
				"eb-3",
				"old-stove-gardens",
				"2026-11-07T19:00:00-08:00",
				undefined,
				"Free",
				"trivia",
			],
		]);
	});
});

describe("mato", () => {
	test("finds dated event slugs in links and the page payload, within the horizon", () => {
		const html = `
<a href="/event/olive-klug-2026-10-27"></a>
<a href="/event/juana-molina-29-oct-2026"></a>
<a href="/event/2026-11-03-cicchetti-happy-hour-tuesday"></a>
<a href="/event/no-date-here"></a>
<script>self.__next_f.push([1,"{\\"slug\\":\\"craig-finn-2026-11-11\\"},{\\"slug\\":\\"seattle\\"},{\\"slug\\":\\"far-off-2027-06-01\\"}"])</script>`;
		expect(matoEventSlugs(html, "2026-10-29", "2027-01-27")).toEqual([
			"juana-molina-29-oct-2026",
			"2026-11-03-cicchetti-happy-hour-tuesday",
			"craig-finn-2026-11-11",
		]);
	});

	test("keeps events at the venue's location names and skips cancelled ones", () => {
		const ld = (name: string, place: string, status = "EventScheduled") =>
			`<script type="application/ld+json">${JSON.stringify({
				"@context": "https://schema.org",
				"@type": "Event",
				name,
				startDate: "2026-10-28T20:00:00.000-07:00",
				endDate: "2026-10-28T23:00:00.000-07:00",
				eventStatus: `https://schema.org/${status}`,
				location: { "@type": "Place", name: place },
			})}</script>`;
		const url = "https://ma.to/event/juana-molina-29-oct-2026";
		const html = `${ld("Juana Molina", "Tractor Tavern")}${ld("Road Trip", "Portland, OR")}${ld("Off", "Tractor Tavern", "EventCancelled")}`;
		expect(parseMatoEvents(html, url, /^Tractor Tavern$/)).toEqual([
			{
				id: "mato-2026-10-28T20:00-juana-molina",
				title: "Juana Molina",
				startsAt: "2026-10-28T20:00:00.000-07:00",
				endsAt: "2026-10-28T23:00:00.000-07:00",
				url,
				price: undefined,
			},
		]);
		expect(
			parseMatoEvents(
				ld("Off", "Tractor Tavern", "EventCancelled"),
				url,
				/^Tractor Tavern$/,
			),
		).toEqual([]);
	});
});

describe("woodland theater", () => {
	test("keeps upcoming shows at Woodland with a clock time, mapping categories and prices", () => {
		const csv = [
			"Host,Show Date,Time,Show Title / Lineup,Show Title,Sugg. $,Poster?,Category,Venue Name,Source,Event Link",
			"A,2026-11-14,7:00 PM,Not Clickbait Improv,,$10,FALSE,improv,Woodland Theater,,,",
			'B,2026-11-15,7:00 PM,"Small Sanctuary, Tamarack",,15,FALSE,,,,https://x.test/e',
			"C,2026-11-07,5:00 PM - 9:00 PM,Woodlandstock,,Free,FALSE,music,,,",
			"D,2026-11-20,7–9pm,No clock time,,,FALSE,music,,,",
			"E,2026-11-21,7:00 PM,Elsewhere,,,FALSE,music,The Josephine,,",
			"F,2026-10-01,7:00 PM,Already happened,,,FALSE,music,,,",
		].join("\r\n");
		expect(parseWoodland(csv, "2026-10-29")).toEqual([
			{
				id: "woodland-theater-2026-11-14-not-clickbait-improv",
				title: "Not Clickbait Improv",
				startsAt: "2026-11-14T19:00:00-08:00",
				endsAt: undefined,
				url: "https://www.woodlandtheater.org/events",
				price: "$10",
				category: "comedy",
			},
			{
				id: "woodland-theater-2026-11-15-small-sanctuary-tamarack",
				title: "Small Sanctuary, Tamarack",
				startsAt: "2026-11-15T19:00:00-08:00",
				endsAt: undefined,
				url: "https://x.test/e",
				price: "$15",
				category: "live-music",
			},
			{
				id: "woodland-theater-2026-11-07-woodlandstock",
				title: "Woodlandstock",
				startsAt: "2026-11-07T17:00:00-08:00",
				endsAt: "2026-11-07T21:00:00-08:00",
				url: "https://www.woodlandtheater.org/events",
				price: "Free",
				category: "live-music",
			},
		]);
	});
});

describe("sea monster lounge", () => {
	test("collects unique event-info links", () => {
		const html = `<a href="https://www.seamonsterlounge.com/event-info/funky-2-death-2026-10-30-22-00">RSVP</a>
<a href="https://www.seamonsterlounge.com/event-info/funky-2-death-2026-10-30-22-00">Share</a>
<a href="https://www.seamonsterlounge.com/event-info/extra-thick-6">RSVP</a>
<a href="https://www.seamonsterlounge.com/buy-tickets-in-advance">Tickets</a>`;
		expect(seaMonsterEventUrls(html)).toEqual([
			"https://www.seamonsterlounge.com/event-info/funky-2-death-2026-10-30-22-00",
			"https://www.seamonsterlounge.com/event-info/extra-thick-6",
		]);
	});
});

describe("book larder", () => {
	const event = {
		product_id: "1",
		title: "Author Talk: Becky Selengut, Lettuce Riot",
		location: "Book Larder",
		date_type: "one-time",
		start_at: "2026-11-24T02:30:00.000Z",
		end_at: "2026-11-24T04:00:00.000Z",
		min_price: 7.5,
	};

	test("keeps upcoming one-time events at the shop, linked to their product", () => {
		const events = parseEvey(
			[
				event,
				{ ...event, product_id: "2", start_at: "2022-03-16T01:30:00.000Z" },
				{
					...event,
					product_id: "3",
					title: "Knife Sharpening (appointment only)",
				},
				{ ...event, product_id: "4", location: "Elsewhere" },
				{
					...event,
					product_id: "5",
					title: "Cooking Class: Tapas",
					min_price: 130,
				},
				{ ...event, product_id: "6", title: "Soup Stand", min_price: 0 },
			],
			new Map([["1", "author-talk-becky-selengut-lettuce-riot"]]),
			"2026-10-30",
		);
		expect(events.map((e) => [e.id, e.price, e.category])).toEqual([
			["book-larder-1", "$7.50", "comedy"],
			["book-larder-5", "$130", "class"],
			["book-larder-6", "Free", "class"],
		]);
		expect(events[0]).toMatchObject({
			startsAt: "2026-11-24T02:30:00.000Z",
			url: "https://booklarder.com/products/author-talk-becky-selengut-lettuce-riot",
		});
		expect(events[1]?.url).toBe("https://booklarder.com/apps/events/calendar");
	});

	test("an evening event counts on its Seattle date, not its UTC date", () => {
		expect(
			parseEvey(
				[{ ...event, start_at: "2026-10-30T02:30:00.000Z" }],
				new Map(),
				"2026-10-29",
			),
		).toHaveLength(1);
	});
});

describe("uw campus", () => {
	test("keeps Meany Hall and Jones Playhouse; Drama's Meany shows go to the Studio Theatre", () => {
		const vevent = (
			summary: string,
			start: string,
			location: string,
			url: string,
		) =>
			`BEGIN:VEVENT\r\nSUMMARY:${summary}\r\nDTSTART;TZID=America/Los_Angeles:${start}\r\nLOCATION:${location}\r\nURL:${url}\r\nEND:VEVENT`;
		const ics = [
			"BEGIN:VCALENDAR",
			vevent(
				"UW Symphony",
				"20261030T193000",
				"Meany Hall (MNY)",
				"https://music.washington.edu/events/a",
			),
			vevent(
				"Phèdre",
				"20261105T193000",
				"Meany Hall (MNY)",
				"https://drama.washington.edu/events/b",
			),
			vevent(
				"Jazz Innovations\\, Part I",
				"20261118T193000",
				"Floyd and Delores Jones Playhouse (PHT)",
				"https://music.washington.edu/events/c",
			),
			vevent(
				"Guest Pianist Master Class",
				"20261104T163000",
				"Floyd and Delores Jones Playhouse (PHT)",
				"https://music.washington.edu/events/d",
			),
			vevent(
				"Space Diplomacy Symposium",
				"20261106T080000",
				"Kane Hall (KNE)",
				"https://x/e",
			),
			"END:VCALENDAR",
		].join("\r\n");
		expect(
			parseUwCampus(ics).map((e) => [
				e.title,
				e.venueId,
				e.category,
				e.startsAt,
			]),
		).toEqual([
			["UW Symphony", "meany-hall", "live-music", "2026-10-30T19:30:00-07:00"],
			[
				"Phèdre",
				"meany-studio-theatre",
				"theater",
				"2026-11-05T19:30:00-08:00",
			],
			[
				"Jazz Innovations, Part I",
				"jones-playhouse",
				"jazz",
				"2026-11-18T19:30:00-08:00",
			],
		]);
	});
});

describe("meany center", () => {
	test("reads each performance from the month calendar's captions", () => {
		const night = (
			iso: string,
			path: string,
			title: string,
		) => `<table class="views-table cols-0">
      <caption><span class="date-display-single " property="dc:date" datatype="xsd:dateTime" content="${iso}">Nov 19, 2026  8:00 pm</span></caption>
      <tbody>
      <tr>
              <td>
          <a href="${path}">${title}</a>        </td>
          </tr>
    </tbody>
</table>`;
		const html =
			night(
				"2026-11-19T20:00:00-08:00",
				"/tickets/2026-11/production/hung-dance",
				"Hung Dance",
			) +
			night(
				"2026-11-13T19:30:00-08:00",
				"/tickets/2026-11/production/orpheus",
				"Orpheus Chamber Orchestra &amp; Friends",
			);
		expect(parseMeany(html).map((e) => [e.title, e.startsAt, e.url])).toEqual([
			[
				"Hung Dance",
				"2026-11-19T20:00:00-08:00",
				"https://meanycenter.org/tickets/2026-11/production/hung-dance",
			],
			[
				"Orpheus Chamber Orchestra & Friends",
				"2026-11-13T19:30:00-08:00",
				"https://meanycenter.org/tickets/2026-11/production/orpheus",
			],
		]);
	});
});

describe("watershed pub", () => {
	test("keeps dated events with a time; skips weekly nights, closures and ranges", () => {
		const section = (title: string, when: string) =>
			`<div class="section-col"><h2>${title}</h2><div class="blurb-date">${when}</div><div class="blurb"><p>x</p></div></div>`;
		const html = [
			section("Stump Trivia - Every Tuesday @ 7pm &amp; 8pm", ""),
			section("Fresh Hop Frenzy", "Sep 1, 2026 - Oct 31, 2026"),
			section("Bricks &amp; Brews", "Nov 2, 2026 @ 5:00 PM - 8:00 PM"),
			section("Closed for Thanksgiving", "Nov 26, 2026"),
			section("Pint Night", "Dec 3, 2026 @ 6:00 PM"),
		].join("");
		expect(
			parseWatershed(html).map((e) => [e.title, e.startsAt, e.endsAt]),
		).toEqual([
			[
				"Bricks & Brews",
				"2026-11-02T17:00:00-08:00",
				"2026-11-02T20:00:00-08:00",
			],
			["Pint Night", "2026-12-03T18:00:00-08:00", undefined],
		]);
	});
});

describe("lake city contra", () => {
	test("one dance per schedule line, named for a quoted band; skips past and 'no dance' nights", () => {
		const html = `<p>Thursday nights; dancing 7:30 till 10:00 pm</p>
<p><strong>Schedule of UPCOMING musicians and callers</strong>:</p>
<p>Oct 29- &#8220;Raven &amp; Goose&#8221; (fiddle &amp; piano); Morna Leonard caller</p>
<p>Nov 5- Claude Ginsburg, Dave Bartley, &amp; Anita Anderson; Greg Frock caller</p>
<p>WED Nov 25 &#8211; THANKSGIVING EVE contra &#8211; Irish open band; Elisabeth Monica caller</p>
<p>Dec 31- NO dance tonight &#8211; Happy New Year!</p>
<p>Jan 7, 2027- &#8220;Raccoon Carnival&#8221; (big band); Shell Stowell caller</p>`;
		expect(
			parseContra(html, "2026-10-30").map((e) => [e.title, e.startsAt]),
		).toEqual([
			["Contra dance", "2026-11-05T19:30:00-08:00"],
			["Contra dance", "2026-11-25T19:30:00-08:00"],
			["Contra dance with Raccoon Carnival", "2027-01-07T19:30:00-08:00"],
		]);
	});
});

describe("mato street address", () => {
	test("a location pattern can match the venue's street address", () => {
		const html = `<script type="application/ld+json">[{"@type":"Event","name":"Tuesday Tacos 'n Trivia","startDate":"2026-11-03T19:00:00.000-08:00","location":{"@type":"Place","name":"Elliott Bay Brewhouse & Pub","address":{"@type":"PostalAddress","streetAddress":"12537 Lake City Way NE, Seattle, WA"}}},{"@type":"Event","name":"Burien Trivia","startDate":"2026-11-03T19:00:00.000-08:00","location":{"@type":"Place","name":"Elliott Bay Brewhouse & Pub","address":{"@type":"PostalAddress","streetAddress":"255 SW 152nd St, Burien, WA"}}}]</script>`;
		expect(
			parseMatoEvents(html, "https://ma.to/venue/x", /Lake City Way/).map(
				(e) => e.title,
			),
		).toEqual(["Tuesday Tacos 'n Trivia"]);
	});
});

describe("jet city improv", () => {
	const page = (block: string) =>
		`<div class="paragraph"><strong>Show Dates / Times:</strong> ${block}<br/><strong>Featuring:</strong> The Ensemble</div>`;

	test("reads dated performances at The Drama Room, with or without a year", () => {
		const html = page(
			"Select Saturdays at 7:30 PM<br/>November 2026<br/>Saturday, November 21<br/>January 2027<br/>Saturday, January 2<br/>Friday, October 2, 2026<br/>Tickets: $18<br/>The Drama Room<br/>University Heights Center",
		);
		expect(
			parseJetCityShow(
				html,
				"The Jet City Show",
				"https://x/show",
				"2026-10-30",
			).map((e) => e.startsAt),
		).toEqual(["2026-11-21T19:30:00-08:00", "2027-01-02T19:30:00-08:00"]);
	});

	test("skips shows at West of Lenin and pages without a schedule", () => {
		const lenin = page(
			"Saturdays 7:00 PM<br/>Saturday, November 7, 2026<br/>West of Lenin 203 N 36th St",
		);
		expect(
			parseJetCityShow(lenin, "Last Call", "https://x", "2026-10-30"),
		).toEqual([]);
		expect(
			parseJetCityShow("<p>Coming soon</p>", "X", "https://x", "2026-10-30"),
		).toEqual([]);
	});
});
