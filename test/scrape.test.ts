import { describe, expect, test } from "bun:test";
import { parseIcs, toIso } from "../scripts/scrape/ical";
import { extractLdEvents } from "../scripts/scrape/jsonld";
import { guessCategory } from "../scripts/scrape/source";
import {
	cleanAbbeyTitle,
	parseEgans,
	parseNordic,
	parseOctopus,
	parsePantry,
	parseSaltstone,
	parseShibuyaEvent,
	parseSquarespaceEvents,
	parseTaprootShow,
	parseWayward,
	parseWestOfLenin,
	parseYuTang,
	shibuyaEventUrls,
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
			"https://www.shibuyahifi.com/event-details/new",
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
