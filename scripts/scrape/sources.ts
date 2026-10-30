import { todayInSeattle } from "../../src/lib/recurrence";
import type { Category } from "../../src/lib/types";
import { parseIcs, toIso } from "./ical";
import { decodeEntities, extractLdEvents } from "./jsonld";
import {
	get,
	guessCategory,
	jsonldSource,
	type ScrapedEvent,
	type Source,
	slug,
} from "./source";

const HORIZON_DAYS = 90;

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function horizon(): { from: string; to: string } {
	const from = todayInSeattle();
	return {
		from,
		to: isoDate(
			new Date(Date.parse(`${from}T12:00:00Z`) + HORIZON_DAYS * 86_400_000),
		),
	};
}

/**
 * Full date for a month/day listed without a year. Months well before the current one belong
 * to next year (Dec → Jan rollover). `month` is 1-based.
 */
export function withYear(month: number, day: number, today: string): string {
	const [year = 0, thisMonth = 0] = today.split("-").map(Number);
	const y = month < thisMonth - 2 ? year + 1 : year;
	return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Robots.txt crawl delay between requests to the same site. */
const pause = (seconds: number) => Bun.sleep(seconds * 1000);

/** "2026-10-29" + "20:00:00" (Seattle local) → ISO with offset. */
function localIso(date: string, time: string): string | undefined {
	return toIso(
		`${date.replaceAll("-", "")}T${time.replaceAll(":", "").padEnd(6, "0")}`,
	);
}

// ---------------------------------------------------------------------------
// Neighborhood calendars on WordPress "The Events Calendar" (Tribe REST API).
// They cover many venues; only events at venues we list are kept. The Nordic Museum
// is left out because its own calendar (below) also shows cancellations.

/** Venue name as the calendar spells it (lowercased, entities decoded) → our venue id */
const VISITBALLARD_VENUES: Record<string, string> = {
	"skål beer hall": "skal-beer-hall",
	"hattie's hat": "hatties-hat",
	"the ink drinker": "the-ink-drinker",
	"swoon city": "swoon-city",
	"reuben's brews": "reubens-brews",
	"cloudburst on shilshole": "cloudburst-shilshole",
	"ballard beer box": "ballard-beer-box",
	"2446 nw market st. seattle, wa, 98107": "ballard-beer-box",
};

// Conor Byrne and Ballard Homestead also appear here but have their own scrapers.
const MYBALLARD_VENUES: Record<string, string> = {
	...VISITBALLARD_VENUES,
	"old stove gardens": "old-stove-gardens",
	"obec brewing": "obec-brewing",
	"channel marker cider": "channel-marker-cider",
	"olympic rooftop pavilion": "olympic-rooftop-pavilion",
	"arc dance space": "arc-dance",
	"phinney center": "phinney-center",
	"phinney community center": "phinney-center",
};

const PHINNEYWOOD_VENUES: Record<string, string> = {
	"phinney center": "phinney-center",
	"phinney center campus": "phinney-center",
	"phinney center campus: blue (upper) building": "phinney-center",
	"phinney center campus: brick (lower) building": "phinney-center",
};

type TribeVenue = { venue?: string };
type TribeEvent = {
	id: number;
	title: string;
	utc_start_date: string;
	utc_end_date?: string;
	all_day: boolean;
	url: string;
	cost?: string;
	venue: TribeVenue | TribeVenue[];
};

function tribeSource(opts: {
	id: string;
	/** Site origin, e.g. "https://www.visitballard.com" */
	origin: string;
	venues: Record<string, string>;
	/** Keep only events whose title matches (for calendars full of kids' classes and meetings) */
	include?: RegExp;
	exclude?: RegExp;
	/** Seconds between page requests, from robots.txt */
	crawlDelay?: number;
}): Source {
	return {
		id: opts.id,
		async fetchEvents() {
			const { from, to } = horizon();
			// Build page URLs rather than following `next_rest_url`: some sites hang on its
			// timestamped start/end parameters.
			const base = `${opts.origin}/wp-json/tribe/events/v1/events?per_page=50&start_date=${from}&end_date=${to}`;
			const out: ScrapedEvent[] = [];
			for (let page = 1, pages = 1; page <= Math.min(pages, 40); page++) {
				if (page > 1 && opts.crawlDelay) await pause(opts.crawlDelay);
				const body: { events: TribeEvent[]; total_pages?: number } = JSON.parse(
					await get(`${base}&page=${page}`),
				);
				pages = body.total_pages ?? 1;
				for (const e of body.events) {
					if (e.all_day) continue;
					const venues = Array.isArray(e.venue) ? e.venue : [e.venue];
					const name = decodeEntities(venues[0]?.venue ?? "")
						.replace(/[‘’]/g, "'")
						.toLowerCase()
						.trim();
					const venueId = opts.venues[name];
					if (!venueId) continue;
					const title = decodeEntities(e.title).trim();
					if (opts.include && !opts.include.test(title)) continue;
					if (opts.exclude?.test(title)) continue;
					out.push({
						id: `${opts.id}-${e.id}-${e.utc_start_date.slice(0, 10)}`,
						venueId,
						title,
						startsAt: `${e.utc_start_date.replace(" ", "T")}Z`,
						endsAt: e.utc_end_date
							? `${e.utc_end_date.replace(" ", "T")}Z`
							: undefined,
						url: e.url,
						price: e.cost ? decodeEntities(e.cost) : undefined,
						category: guessCategory(title),
					});
				}
			}
			return out;
		},
	};
}

const visitBallard = tribeSource({
	id: "visitballard",
	origin: "https://www.visitballard.com",
	venues: VISITBALLARD_VENUES,
});

const myBallard = tribeSource({
	id: "myballard",
	origin: "https://www.myballard.com",
	venues: MYBALLARD_VENUES,
});

// PhinneyWood blog (Phinney Neighborhood Association). Mostly daytime senior-center and kids'
// events, so only the Phinney Center (whose own site is behind Cloudflare) is mapped.
const phinneyWood = tribeSource({
	id: "phinneywood",
	origin: "https://phinneywood.com",
	venues: PHINNEYWOOD_VENUES,
	exclude: /\b(meeting|potluck)\b/i,
	crawlDelay: 10,
});

// Sunset Hill Community Hall: dance nights and an open mic among kids' classes, scouts and rentals.
const sunsetHill = tribeSource({
	id: "sunset-hill-hall",
	origin: "https://sunsethillcommunity.org",
	venues: { "sunset hill community hall": "sunset-hill-community-hall" },
	include: /\b(waltz|swing|foxtrot|salsa|two-step|tango|open mic)\b/i,
	crawlDelay: 10,
});

// ---------------------------------------------------------------------------
// National Nordic Museum: server-rendered calendar cards. robots.txt asks for a 30s crawl delay.
// Only single-date events with a start time are kept; ranges ("Nov 20-22") and series
// ("Every Thursday") don't say which days or times apply.

const NORDIC_CALENDAR = "https://nordicmuseum.org/calendar";

/** "6:00 pm" or "6:00" (meridiem taken from `fallback`) → "18:00" */
function to24h(time: string, fallback?: string): string | undefined {
	const m = time.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
	const meridiem = (m?.[3] ?? fallback)?.toLowerCase();
	if (!m || !meridiem) return undefined;
	const hour = (Number(m[1]) % 12) + (meridiem === "pm" ? 12 : 0);
	return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

export function parseNordic(html: string): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const card of html
		.split(/class="card-event position-relative"/)
		.slice(1)) {
		const dateText = stripTags(
			card.match(/class="subheading[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? "",
		);
		const link = card.match(
			/class="card-title-link[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/,
		);
		const timeText =
			card.match(/<p class="content-text mb-0">([^<]*)<\/p>/)?.[1] ?? "";
		const admission = stripTags(
			card.match(/card-event__admission[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "",
		);
		const date = dateText.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})$/);
		const month = MONTHS.indexOf(date?.[1]?.toLowerCase() ?? "");
		if (!date || month < 0 || !link?.[1] || !link[2]) continue;
		const title = stripTags(link[2]);
		if (/^cancel/i.test(title)) continue;
		const [startText = "", endText = ""] = timeText.split("-");
		const endMeridiem = endText.match(/(am|pm)/i)?.[1];
		const start = to24h(startText, endMeridiem);
		if (!start) continue;
		const day = `${date[3]}-${String(month + 1).padStart(2, "0")}-${(date[2] ?? "").padStart(2, "0")}`;
		const startsAt = localIso(day, start);
		if (!startsAt) continue;
		const end = to24h(endText);
		out.push({
			id: `nordic-museum-${day}-${slug(title)}`,
			title,
			startsAt,
			endsAt: end && end > start ? localIso(day, end) : undefined,
			url: link[1],
			price: admission.match(/General Admission:\s*(\$[\d.]+|Free)/i)?.[1],
			category: guessCategory(title, "art"),
		});
	}
	return out;
}

const nordicMuseum: Source = {
	id: "nordic-museum",
	venueId: "nordic-museum",
	async fetchEvents() {
		const out: ScrapedEvent[] = [];
		for (let page = 1; page <= 4; page++) {
			if (page > 1) await pause(30);
			const html = await get(
				page === 1 ? NORDIC_CALENDAR : `${NORDIC_CALENDAR}?page=${page}`,
			);
			out.push(...parseNordic(html));
			const total = Number(html.match(/Page \d+ of (\d+)/)?.[1] ?? 1);
			if (page >= total) break;
		}
		return out;
	},
};

// ---------------------------------------------------------------------------
// VenuePilot: public GraphQL API behind the calendar widgets on Conor Byrne's and Aslan's sites.

const VENUEPILOT_QUERY = `query($accountIds:[Int!]!,$startDate:String!,$page:Int){paginatedEvents(arguments:{accountIds:$accountIds,startDate:$startDate,page:$page}){collection{id name date startTime endTime ticketsUrl venue{name}} metadata{currentPage totalPages}}}`;

type VenuePilotEvent = {
	id: number;
	name: string;
	date: string;
	startTime: string | null;
	endTime: string | null;
	ticketsUrl: string | null;
	venue: { name: string } | null;
};

async function venuePilotEvents(opts: {
	accountId: number;
	idPrefix: string;
	link: string;
	category?: Category;
	/** Keep only events at this VenuePilot venue (for accounts with several locations) */
	venue?: string;
}): Promise<ScrapedEvent[]> {
	const { from } = horizon();
	const out: ScrapedEvent[] = [];
	for (let page = 1; page <= 10; page++) {
		const res = await fetch("https://www.venuepilot.co/graphql", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				query: VENUEPILOT_QUERY,
				variables: { accountIds: [opts.accountId], startDate: from, page },
			}),
			signal: AbortSignal.timeout(20_000),
		});
		if (!res.ok) throw new Error(`VenuePilot → HTTP ${res.status}`);
		const json = (await res.json()) as {
			data: {
				paginatedEvents: {
					collection: VenuePilotEvent[];
					metadata: { currentPage: number; totalPages: number };
				};
			};
		};
		const { collection, metadata } = json.data.paginatedEvents;
		for (const e of collection) {
			if (opts.venue && e.venue?.name !== opts.venue) continue;
			const start = localIso(e.date, e.startTime ?? "20:00:00");
			if (!start) continue;
			let end: string | undefined;
			if (e.endTime) {
				// End times like 01:00 belong to the next day.
				const endDate =
					e.startTime && e.endTime < e.startTime
						? isoDate(new Date(Date.parse(`${e.date}T12:00:00Z`) + 86_400_000))
						: e.date;
				end = localIso(endDate, e.endTime);
			}
			out.push({
				id: `${opts.idPrefix}-${e.id}`,
				title: e.name.trim(),
				startsAt: start,
				endsAt: end,
				url: e.ticketsUrl ?? opts.link,
				category: guessCategory(e.name, opts.category),
			});
		}
		if (metadata.currentPage >= metadata.totalPages) break;
	}
	return out;
}

const conorByrne: Source = {
	id: "conor-byrne",
	venueId: "conor-byrne-pub",
	category: "live-music",
	fetchEvents: () =>
		venuePilotEvents({
			accountId: 194,
			idPrefix: "conor-byrne",
			link: "https://www.conorbyrnepub.com/calendar",
			category: "live-music",
		}),
};

// Aslan's account covers its Bellingham and Seattle locations; only Fremont is in our area.
const aslanFremont: Source = {
	id: "aslan-fremont",
	venueId: "aslan-fremont",
	fetchEvents: () =>
		venuePilotEvents({
			accountId: 776,
			idPrefix: "aslan",
			link: "https://www.aslanbrewing.com/seattle-events",
			venue: "Aslan Fremont",
		}),
};

// ---------------------------------------------------------------------------
// Squarespace events collections. robots.txt on Squarespace sites disallows `?format=json`, so this
// reads the upcoming events from the rendered list page. Times there are in the site's time zone.

/** One "localized" start or end time: `<time class="event-time-localized-start" datetime="2026-11-03">5:00 PM</time>` */
function squarespaceTime(article: string, which: "start" | "end") {
	const m = article.match(
		new RegExp(
			`class="event-time-localized-${which}" datetime="(\\d{4}-\\d{2}-\\d{2})">([^<]+)<`,
		),
	);
	const time = to24h(m?.[2] ?? "");
	return m?.[1] && time ? localIso(m[1], time) : undefined;
}

export function parseSquarespaceEvents(
	html: string,
	base: string,
	idPrefix: string,
): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const [article] of html.matchAll(
		/<article class="eventlist-event eventlist-event--upcoming[\s\S]*?<\/article>/g,
	)) {
		const link = article.match(
			/class="eventlist-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
		);
		const startsAt = squarespaceTime(article, "start");
		// All-day events have no time.
		if (!link?.[1] || !link[2] || !startsAt) continue;
		const title = stripTags(link[2]);
		// UTC in the id keeps ids from the old `?format=json` scraper stable.
		const utc = new Date(startsAt).toISOString();
		out.push({
			id: `${idPrefix}-${utc.slice(0, 16)}-${slug(title)}`,
			title,
			startsAt,
			endsAt: squarespaceTime(article, "end"),
			url: `${base}${decodeEntities(link[1])}`,
		});
	}
	return out;
}

async function squarespaceEvents(
	base: string,
	path: string,
	idPrefix: string,
): Promise<ScrapedEvent[]> {
	return parseSquarespaceEvents(await get(`${base}${path}`), base, idPrefix);
}

// Seattle Public Theater (Green Lake Bathhouse).
const seattlePublicTheater: Source = {
	id: "seattle-public-theater",
	venueId: "seattle-public-theater",
	category: "theater",
	fetchEvents: () =>
		squarespaceEvents(
			"https://www.seattlepublictheater.org",
			"/calendar-2",
			"spt",
		),
};

// Halfseas: wine tastings and specials. Tarot Tuesday is a curated night in nights.ts.
const halfseas: Source = {
	id: "halfseas",
	venueId: "halfseas",
	category: "food-drink-special",
	async fetchEvents() {
		const events = await squarespaceEvents(
			"https://www.halfseaswine.com",
			"/events",
			"halfseas",
		);
		return events.filter((e) => !/^tarot tuesday/i.test(e.title));
	},
};

// Halcyon Brewing (Greenwood): one-off events; the weekday happy hour is a curated night.
const halcyon: Source = {
	id: "halcyon",
	venueId: "halcyon-brewing",
	fetchEvents: async () =>
		(
			await squarespaceEvents(
				"https://www.halcyonbrewingco.com",
				"/events",
				"halcyon",
			)
		).map((e) => ({ ...e, category: guessCategory(e.title) })),
};

// Hidden Hall: its calendar page carries JSON-LD for sister venue Nectar Lounge too.
const hiddenHall = jsonldSource({
	id: "hidden-hall",
	venueId: "hidden-hall",
	category: "live-music",
	urls: ["https://hiddenhall.com/events/calendar/"],
	location: /^hidden hall$/i,
});

// Abbey Arts: Humanitix host page (JSON-LD) for Fremont Abbey and Ballard Homestead shows.

const ABBEY_ARTS_VENUES: Record<string, string> = {
	"fremont abbey arts center": "fremont-abbey",
	"ballard homestead": "ballard-homestead",
};

/** "11/5 The Moth StorySLAM @ FREMONT ABBEY Seattle" → "The Moth StorySLAM" */
export function cleanAbbeyTitle(name: string): string {
	return name
		.replace(/^(\d{1,2}\/\d{1,2},?\s*)+/, "")
		.replace(/\s+@\s+.*$/, "")
		.replace(/\s+-\s+[A-Z][a-z]{2} \d{1,2}$/, "")
		.trim();
}

const abbeyArts: Source = {
	id: "abbey-arts",
	async fetchEvents() {
		const html = await get(
			"https://events.humanitix.com/host/abbey-arts-presents",
		);
		const out: ScrapedEvent[] = [];
		for (const e of extractLdEvents(html)) {
			const venueId = ABBEY_ARTS_VENUES[(e.location ?? "").toLowerCase()];
			if (!venueId || /^cancel/i.test(e.name)) continue;
			const startsAt = new Date(e.startDate).toISOString();
			const title = cleanAbbeyTitle(e.name);
			out.push({
				id: `abbey-arts-${startsAt.slice(0, 16)}-${slug(title)}`,
				venueId,
				title,
				startsAt,
				endsAt: e.endDate ? new Date(e.endDate).toISOString() : undefined,
				url: e.url ?? "https://events.humanitix.com/host/abbey-arts-presents",
				price: e.price,
				category: guessCategory(title, "live-music"),
			});
		}
		return out;
	},
};

// ---------------------------------------------------------------------------
// Egan's Ballard Jam House: hand-written static HTML schedule with no year.

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/** Parse Egan's schedule.html. `today` (YYYY-MM-DD) anchors the year, since the page has none. */
export function parseEgans(html: string, today: string): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const [, dl = ""] of html.matchAll(/<dl>([\s\S]*?)<\/dl>/gi)) {
		const dt = stripTags(dl.match(/<dt>([\s\S]*?)<\/dt>/i)?.[1] ?? "");
		const dm = dt.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2})$/);
		if (!dm) continue; // e.g. "Our Reservation Policy"
		const mon = MONTHS.indexOf((dm[1] ?? "").toLowerCase()) + 1;
		if (!mon) continue;
		const date = withYear(mon, Number(dm[2]), today);
		if (date < today) continue;
		for (const [, dd = ""] of dl.matchAll(/<dd>([\s\S]*?)<\/dd>/gi)) {
			const text = stripTags(dd);
			const tm = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*-\s*(.+)$/i);
			if (!tm) continue;
			let hour = Number(tm[1]) % 12;
			if ((tm[3] ?? "").toLowerCase() === "pm") hour += 12;
			const time = `${String(hour).padStart(2, "0")}:${tm[2] ?? "00"}`;
			const rest = tm[4] ?? "";
			const title = (rest.split(/\s+-\s+|\s*\(\$/)[0] ?? rest)
				.trim()
				.slice(0, 90);
			const price = rest.match(/\(\$(\d+)\s*cover\)/i)?.[1];
			const startsAt = localIso(date, time);
			if (!startsAt) continue;
			out.push({
				id: `egans-${date}-${time.replace(":", "")}-${slug(title)}`,
				title,
				startsAt,
				url: "https://www.ballardjamhouse.com/schedule.html",
				price: price ? `$${price} cover` : undefined,
				category: guessCategory(title, "jazz"),
			});
		}
	}
	return out;
}

const egans: Source = {
	id: "egans",
	venueId: "egans-ballard-jam-house",
	category: "jazz",
	async fetchEvents() {
		const html = await get("https://www.ballardjamhouse.com/schedule.html");
		return parseEgans(html, horizon().from);
	},
};

// ---------------------------------------------------------------------------
// Nectar Lounge: same Tixr-backed JSON-LD calendar as its sister venue Hidden Hall.

const nectar = jsonldSource({
	id: "nectar",
	venueId: "nectar-lounge",
	category: "live-music",
	urls: ["https://nectarlounge.com/events/calendar/"],
	location: /^nectar lounge$/i,
});

// ---------------------------------------------------------------------------
// Wayward Music Series (Chapel Performance Space): WordPress posts, each preceded by an
// "October 29, 2026 | 8:00 PM" meta line. robots.txt asks for a 10s crawl delay; one page suffices.

export function parseWayward(html: string): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const chunk of html.split(/class="entry-meta"/).slice(1)) {
		// The chunk starts mid-tag, after `class="entry-meta"`.
		const when = stripTags(
			(chunk.split(/<\/div>/)[0] ?? "").replace(/^[^>]*>/, ""),
		);
		const m = when.match(
			/^([A-Za-z]+) (\d{1,2}), (\d{4}) \| (\d{1,2}:\d{2} [AP]M)$/i,
		);
		const link = chunk.match(
			/class="entry-title"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
		);
		const month = MONTHS.indexOf((m?.[1] ?? "").slice(0, 3).toLowerCase()) + 1;
		const time = to24h(m?.[4] ?? "");
		if (!m || !month || !time || !link?.[1] || !link[2]) continue;
		const date = `${m[3]}-${String(month).padStart(2, "0")}-${(m[2] ?? "").padStart(2, "0")}`;
		const startsAt = localIso(date, time);
		if (!startsAt) continue;
		const title = stripTags(link[2]);
		const price = chunk.match(/class="ticket--link">([\s\S]*?)<\/p>/)?.[1];
		out.push({
			id: `wayward-${date}-${slug(title)}`,
			title,
			startsAt,
			url: link[1],
			price: price ? stripTags(price) : undefined,
		});
	}
	return out;
}

const wayward: Source = {
	id: "wayward",
	venueId: "chapel-performance-space",
	category: "live-music",
	async fetchEvents() {
		return parseWayward(await get("https://www.waywardmusic.org/"));
	},
};

// ---------------------------------------------------------------------------
// West of Lenin: Joomla JEvents "latest events" module on the home page (day, month, time, title
// with ticket link). Hosts plays and Jet City Improv. The JEvents iCal export is broken.

export function parseWestOfLenin(html: string, today: string): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const chunk of html.split(/class="eventsdiv"/).slice(1)) {
		const d = chunk.match(
			/jevdateicon1">(\d{1,2})(?:&nbsp;|\s)*<\/span><span class="jevdateicon2">([A-Za-z]{3})/,
		);
		const time = to24h(
			chunk.match(
				/mod_events_latest_content">[\s\S]*?<strong>([^<]+)<\/strong>/,
			)?.[1] ?? "",
		);
		const link = chunk.match(
			/<a href="([^"]+)"[^>]*>\s*<strong>([\s\S]*?)<\/strong>/,
		);
		const month = MONTHS.indexOf((d?.[2] ?? "").toLowerCase()) + 1;
		if (!d || !month || !time || !link?.[1] || !link[2]) continue;
		const date = withYear(month, Number(d[1]), today);
		if (date < today) continue;
		const startsAt = localIso(date, time);
		if (!startsAt) continue;
		const title = stripTags(link[2]);
		out.push({
			id: `west-of-lenin-${date}-${time.replace(":", "")}-${slug(title)}`,
			title,
			startsAt,
			url: decodeEntities(link[1]),
		});
	}
	return out;
}

const westOfLenin: Source = {
	id: "west-of-lenin",
	venueId: "west-of-lenin",
	category: "theater",
	async fetchEvents() {
		return parseWestOfLenin(
			await get("https://www.westoflenin.com/"),
			horizon().from,
		);
	},
};

// ---------------------------------------------------------------------------
// The Octopus Bar: "Special Events" cards on /events (weekly nights are curated in nights.ts).
// robots.txt asks for a 30s crawl delay; this is a single request. Often there are none.

export function parseOctopus(html: string, today: string): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const card of html.split(/class="card-special-event /).slice(1)) {
		const link = card.match(
			/class="card-special-event__title[^"]*">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
		);
		const date = card.match(
			/<h4>Date<\/h4>\s*<p>[A-Za-z]{3}, ([A-Za-z]{3}) (\d{1,2})<\/p>/,
		);
		const time = to24h(
			card.match(/<h4>Time<\/h4>\s*<p>([^<]+)<\/p>/)?.[1] ?? "",
		);
		const month = MONTHS.indexOf((date?.[1] ?? "").toLowerCase()) + 1;
		if (!link?.[1] || !link[2] || !date || !month || !time) continue;
		const day = withYear(month, Number(date[2]), today);
		const startsAt = localIso(day, time);
		if (!startsAt) continue;
		// "October 30 + 31 · Pretty Ugly Vol. 13" → "Pretty Ugly Vol. 13"
		const title = stripTags(link[2]).replace(/^[^·]*·\s*/, "");
		out.push({
			id: `octopus-${day}-${slug(title)}`,
			title,
			startsAt,
			url: link[1],
			category: guessCategory(title),
		});
	}
	return out;
}

const octopus: Source = {
	id: "octopus",
	venueId: "octopus-bar",
	mayBeEmpty: true,
	async fetchEvents() {
		return parseOctopus(
			await get("https://theoctopusbar.com/events"),
			horizon().from,
		);
	},
};

// ---------------------------------------------------------------------------
// Taproot Theatre: full performance calendars live only in OvationTix (a JS app), so this only
// picks up the specific performances each show page names, e.g.
// "<strong>Pay What You Can</strong>: Thursday, November 19 at 7:30 PM".
// Full runs can be curated in nights.ts with `from`/`until`. robots.txt crawl delay is 10s.

const TAPROOT = "https://taproottheatre.org";
const TAPROOT_LABELS: Record<string, string> = {
	cc: "Closed Captioned",
};

export function parseTaprootShow(
	html: string,
	url: string,
	today: string,
): ScrapedEvent[] {
	const show = decodeEntities(
		html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "",
	).replace(/\s+-\s+Taproot Theatre$/, "");
	if (!show) return [];
	const out: ScrapedEvent[] = [];
	const re =
		/<strong>([^<]{2,40}?):?<\/strong>:?\s*(?:[A-Za-z]+day,\s*)?([A-Za-z]+) (\d{1,2}) at (\d{1,2}:\d{2}\s*[AP]M)/gi;
	for (const [
		,
		rawLabel = "",
		monthName = "",
		day = "",
		clock = "",
	] of html.matchAll(re)) {
		const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
		const time = to24h(clock);
		if (!month || !time) continue;
		const date = withYear(month, Number(day), today);
		if (date < today) continue;
		const startsAt = localIso(date, time);
		if (!startsAt) continue;
		const label =
			TAPROOT_LABELS[rawLabel.trim().toLowerCase()] ?? rawLabel.trim();
		out.push({
			id: `taproot-${date}-${time.replace(":", "")}-${slug(show)}`,
			title: `${show} (${label})`,
			startsAt,
			url,
		});
	}
	return out;
}

const taproot: Source = {
	id: "taproot",
	venueId: "taproot-theatre",
	category: "theater",
	mayBeEmpty: true,
	async fetchEvents() {
		const today = horizon().from;
		const home = await get(`${TAPROOT}/`);
		const shows = [
			...new Set(
				[
					...home.matchAll(
						/href="(https:\/\/taproottheatre\.org\/20\d\d\/[a-z0-9-]+\/)"/g,
					),
				].map((m) => m[1] ?? ""),
			),
		];
		const out: ScrapedEvent[] = [];
		for (const show of shows) {
			await pause(10);
			out.push(...parseTaprootShow(await get(show), show, today));
		}
		return out;
	},
};

// ---------------------------------------------------------------------------
// The Pantry (community kitchen): the JSON its own calendar page loads (found in its bundle.js;
// no key). One entry per class/dinner with its next date, in Seattle local time.

type PantryEntry = {
	id: number;
	title: string;
	url: string;
	soldOut: boolean;
	nextEventDate: string;
};

export function parsePantry(entries: PantryEntry[]): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const e of entries) {
		// Private bookings, kids' classes and take-home packs aren't date nights.
		if (/\b(private|kids|wine pack)\b/i.test(e.title)) continue;
		const [date = "", time = ""] = e.nextEventDate.split(" ");
		const startsAt = localIso(date, time);
		if (!startsAt) continue;
		out.push({
			id: `pantry-${e.id}-${date}`,
			title: decodeEntities(e.title),
			startsAt,
			url: e.url,
			price: e.soldOut ? "Sold out" : undefined,
			category: e.url.includes("/dinner/") ? "food-drink-special" : "class",
		});
	}
	return out;
}

const pantry: Source = {
	id: "pantry",
	venueId: "the-pantry",
	async fetchEvents() {
		const { from, to } = horizon();
		const body: { data: PantryEntry[] } = JSON.parse(
			await get(
				`https://www.thepantryseattle.com/api/events.json?limit=200&dateRange=${from},${to}&entriesOnly=1`,
			),
		);
		return parsePantry(body.data);
	},
};

// ---------------------------------------------------------------------------
// Shibuya HiFi (listening bar): album listening sessions as Wix Events. The events page renders
// client-side, but every event page carries JSON-LD and the event sitemap lists all of them
// (1,000+, past included) with a lastmod. Each month's schedule is posted a few weeks ahead, so
// only pages modified in the last 60 days are fetched.

const SHIBUYA = "https://www.shibuyahifi.com";

/** Event page URLs from the Wix event sitemap with a lastmod on or after `since` (YYYY-MM-DD). */
export function shibuyaEventUrls(xml: string, since: string): string[] {
	return [
		...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})/g),
	]
		.filter(([, , mod = ""]) => mod >= since)
		.map(([, loc = ""]) => loc);
}

export function parseShibuyaEvent(html: string, url: string): ScrapedEvent[] {
	if (html.includes("schema.org/EventCancelled")) return [];
	return extractLdEvents(html).map((e) => {
		const title = e.name;
		return {
			id: `shibuya-hifi-${e.startDate.slice(0, 16)}-${slug(title)}`,
			title,
			startsAt: e.startDate,
			endsAt: e.endDate,
			url: e.url ?? url,
			// Recorded music, not a band, but "live-music" is the closest category. Other
			// guessCategory matches (e.g. "dance" in an album title) would mislead.
			category: guessCategory(title) === "jazz" ? "jazz" : "live-music",
		};
	});
}

const shibuyaHifi: Source = {
	id: "shibuya-hifi",
	venueId: "shibuya-hifi",
	async fetchEvents() {
		const today = horizon().from;
		const since = isoDate(
			new Date(Date.parse(`${today}T12:00:00Z`) - 60 * 86_400_000),
		);
		const urls = shibuyaEventUrls(
			await get(`${SHIBUYA}/event-pages-sitemap.xml`),
			since,
		);
		const out: ScrapedEvent[] = [];
		for (const url of urls) {
			await pause(0.5);
			const events = parseShibuyaEvent(await get(url), url);
			out.push(...events.filter((e) => e.startsAt.slice(0, 10) >= today));
		}
		return out;
	},
};

// ---------------------------------------------------------------------------
// Pottery studios selling one-night wheel classes as store products, one product or option per date.

/** "6pm" or "6:30 pm" → "18:00", with the meridiem taken from `fallback` when missing ("6:30-8:30pm") */
function clock(text: string, fallback?: string): string | undefined {
	return to24h(text.replace(/^\s*(\d{1,2})(?!\d|:)/, "$1:00"), fallback);
}

// Saltstone Ceramics (Wallingford): Shopify. Each product in the one-night class collection is a
// single session, with its date and time only in the title, e.g.
// "Clay Curious: Friday November 6th, 6:30pm - 8:30pm". No year; robots.txt allows products.json.

type ShopifyProduct = {
	id: number;
	title: string;
	handle: string;
	variants: { price: string; available: boolean }[];
};

export function parseSaltstone(
	products: ShopifyProduct[],
	today: string,
): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const p of products) {
		const m = p.title.match(
			/^(.+?)[\s:,]+[A-Za-z]+day,?\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+([\d:]+\s*(?:am|pm)?)\s*-\s*([\d:]+\s*(?:am|pm))/i,
		);
		const month = MONTHS.indexOf((m?.[2] ?? "").slice(0, 3).toLowerCase()) + 1;
		if (!m?.[1] || !month) continue;
		const endMeridiem = m[5]?.match(/am|pm/i)?.[0];
		const start = clock(m[4] ?? "", endMeridiem);
		const end = clock(m[5] ?? "");
		const date = withYear(month, Number(m[3]), today);
		if (!start || date < today) continue;
		const startsAt = localIso(date, start);
		if (!startsAt) continue;
		const variant = p.variants[0];
		out.push({
			id: `saltstone-${p.id}`,
			title: m[1].trim(),
			startsAt,
			endsAt: end && end > start ? localIso(date, end) : undefined,
			url: `https://saltstoneceramics.com/products/${p.handle}`,
			price: !variant
				? undefined
				: variant.available
					? `$${Number(variant.price)}`
					: "Sold out",
		});
	}
	return out;
}

const saltstone: Source = {
	id: "saltstone",
	venueId: "saltstone-ceramics",
	category: "class",
	async fetchEvents() {
		const body: { products: ShopifyProduct[] } = JSON.parse(
			await get(
				"https://saltstoneceramics.com/collections/adult-one-night-classes/products.json?limit=250",
			),
		);
		return parseSaltstone(body.products, horizon().from);
	},
};

// Yu Tang Ceramics (Fremont): Squarespace store. The workshops page embeds its products as JSON in a
// `data-context` attribute; date-night wheel classes are one product with a "Day/Time" option per
// session, e.g. "November 7th 2026 6pm". Products without that option (members-only workshops) are
// skipped.

const YU_TANG = "https://www.yutangceramics.com";

type YuTangItem = {
	title: string;
	fullUrl: string;
	variants: {
		price: { value: string };
		soldOut: boolean;
		attributes: Record<string, string>;
	}[];
};

export function parseYuTang(html: string): ScrapedEvent[] {
	const attr = html.match(
		/data-controller="ProductList"\s+data-context="([^"]+)"/,
	)?.[1];
	if (!attr) return [];
	const { items }: { items: YuTangItem[] } = JSON.parse(decodeEntities(attr));
	const out: ScrapedEvent[] = [];
	for (const item of items) {
		const title = decodeEntities(item.title).trim();
		for (const v of item.variants) {
			const m = (v.attributes["Day/Time"] ?? "").match(
				/^([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}),? (.+)$/,
			);
			const month =
				MONTHS.indexOf((m?.[1] ?? "").slice(0, 3).toLowerCase()) + 1;
			const time = clock(m?.[4] ?? "");
			if (!m || !month || !time) continue;
			const date = `${m[3]}-${String(month).padStart(2, "0")}-${(m[2] ?? "").padStart(2, "0")}`;
			const startsAt = localIso(date, time);
			if (!startsAt) continue;
			out.push({
				id: `yu-tang-${date}-${time.replace(":", "")}-${slug(title)}`,
				title,
				startsAt,
				url: `${YU_TANG}${item.fullUrl}`,
				price: v.soldOut ? "Sold out" : `$${Number(v.price.value)}`,
			});
		}
	}
	return out;
}

const yuTang: Source = {
	id: "yu-tang",
	venueId: "yu-tang-ceramics",
	category: "class",
	mayBeEmpty: true,
	async fetchEvents() {
		const today = horizon().from;
		return parseYuTang(await get(`${YU_TANG}/workshops`)).filter(
			(e) => e.startsAt.slice(0, 10) >= today,
		);
	},
};

// ---------------------------------------------------------------------------
// Seattle Folklore Society: iCal feed (WordPress Events Manager) of the folk concerts it presents,
// mostly in the Phinney Center Concert Hall, whose own site is behind Cloudflare. Text fields
// arrive HTML-escaped, and some titles repeat the date after a semicolon.

const SEAFOLKLORE_VENUES: [RegExp, string][] = [
	[/^phinney center/i, "phinney-center"],
	[/^fremont abbey/i, "fremont-abbey"],
];

export function parseSeaFolklore(ics: string): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const e of parseIcs(ics)) {
		const venueId = SEAFOLKLORE_VENUES.find(([re]) =>
			re.test(e.location ?? ""),
		)?.[1];
		if (!venueId) continue;
		// "Hildaland (…) In Concert; Sat, Nov 21" → "Hildaland (…) In Concert"
		const title = decodeEntities(e.summary)
			.replace(/;\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*,.*$/i, "")
			.trim();
		out.push({
			id: `seafolklore-${e.start.slice(0, 16)}-${slug(title)}`,
			venueId,
			title,
			startsAt: e.start,
			endsAt: e.end,
			url: e.url ?? "https://www.seafolklore.org/events/",
		});
	}
	return out;
}

const seaFolklore: Source = {
	id: "seafolklore",
	category: "live-music",
	async fetchEvents() {
		return parseSeaFolklore(
			await get("https://www.seafolklore.org/events.ics"),
		);
	},
};

// ---------------------------------------------------------------------------
// Eventbrite organizers, through Eventbrite's public API (its site terms forbid scraping the pages,
// and the API has no location search, so organizers are listed by id). Only events at venues we map
// are kept. Needs a personal OAuth token from the repo owner's own Eventbrite account in
// EVENTBRITE_TOKEN (.env locally, a repo secret in CI). An organizer's id is the number at the end
// of its eventbrite.com/o/… page.

type EventbriteEvent = {
	id: string;
	name: { text: string };
	url: string;
	start: { local: string; timezone: string };
	end?: { local: string; timezone: string };
	is_free?: boolean;
	venue?: { name: string } | null;
	ticket_availability?: {
		is_sold_out?: boolean;
		minimum_ticket_price?: { major_value: string } | null;
		maximum_ticket_price?: { major_value: string } | null;
	};
};

/** "2026-11-04T21:00:00" in `timeZone` → ISO with offset */
function eventbriteIso(local: string, timeZone: string): string | undefined {
	return toIso(local.replace(/[-:]/g, ""), timeZone);
}

/** "19.80" → "$19.80", "25.00" → "$25" */
function dollars(value: string): string {
	const n = Number(value);
	return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

export function parseEventbrite(
	events: EventbriteEvent[],
	opts: {
		idPrefix: string;
		/** Eventbrite venue name (lowercased) → our venue id */
		venues: Record<string, string>;
		category?: Category;
	},
): ScrapedEvent[] {
	const out: ScrapedEvent[] = [];
	for (const e of events) {
		const venueId = opts.venues[(e.venue?.name ?? "").toLowerCase().trim()];
		const startsAt = eventbriteIso(e.start.local, e.start.timezone);
		if (!venueId || !startsAt) continue;
		const t = e.ticket_availability;
		const low = t?.minimum_ticket_price?.major_value;
		const high = t?.maximum_ticket_price?.major_value;
		const title = e.name.text.trim();
		out.push({
			id: `${opts.idPrefix}-${e.id}`,
			venueId,
			title,
			startsAt,
			endsAt: e.end ? eventbriteIso(e.end.local, e.end.timezone) : undefined,
			url: e.url,
			price: t?.is_sold_out
				? "Sold out"
				: e.is_free
					? "Free"
					: low
						? high && high !== low
							? `${dollars(low)}–${dollars(high)}`
							: dollars(low)
						: undefined,
			category: guessCategory(title, opts.category),
		});
	}
	return out;
}

function eventbriteSource(opts: {
	id: string;
	organizerId: string;
	venues: Record<string, string>;
	category?: Category;
	mayBeEmpty?: boolean;
	/** Pages of 50, soonest first; national organizers need more to reach our horizon */
	maxPages?: number;
	cleanTitle?: (title: string) => string;
}): Source {
	return {
		id: opts.id,
		mayBeEmpty: opts.mayBeEmpty,
		async fetchEvents() {
			const token = process.env.EVENTBRITE_TOKEN;
			if (!token) throw new Error("EVENTBRITE_TOKEN is not set");
			const out: ScrapedEvent[] = [];
			let continuation: string | undefined;
			for (let page = 0; page < (opts.maxPages ?? 10); page++) {
				const url = new URL(
					`https://www.eventbriteapi.com/v3/organizers/${opts.organizerId}/events/`,
				);
				url.searchParams.set("status", "live");
				url.searchParams.set("order_by", "start_asc");
				url.searchParams.set("expand", "venue,ticket_availability");
				if (continuation) url.searchParams.set("continuation", continuation);
				const res = await fetch(url, {
					headers: { authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(20_000),
				});
				if (!res.ok) throw new Error(`Eventbrite → HTTP ${res.status}`);
				const body = (await res.json()) as {
					events: EventbriteEvent[];
					pagination: { has_more_items: boolean; continuation?: string };
				};
				const events = parseEventbrite(body.events, {
					idPrefix: opts.id,
					venues: opts.venues,
					category: opts.category,
				});
				const { cleanTitle } = opts;
				out.push(
					...(cleanTitle
						? events.map((e) => ({ ...e, title: cleanTitle(e.title) }))
						: events),
				);
				continuation = body.pagination.continuation;
				if (!body.pagination.has_more_items || !continuation) break;
			}
			return out;
		},
	};
}

const substation = eventbriteSource({
	id: "substation",
	organizerId: "18831550522",
	venues: { substation: "substation" },
	category: "live-music",
});

// Mockingbird Comedy: weekly and one-off stand-up shows, mostly at breweries; only Old Stove's
// Ballard garden is in our area.
const mockingbird = eventbriteSource({
	id: "mockingbird-comedy",
	organizerId: "109263369901",
	venues: { "old stove brewing co - gardens": "old-stove-gardens" },
	category: "comedy",
});

// Tango is About the Connection: occasional milongas at the Ballard Odd Fellows Hall.
const tangoConnection = eventbriteSource({
	id: "tango-connection",
	organizerId: "18723181210",
	venues: { "ballard oddfellows hall": "ballard-odd-fellows" },
	category: "dance",
	mayBeEmpty: true,
});

// Classpop!: a national class marketplace (paint-and-sips, cooking classes) with thousands of events,
// a few at Channel Marker Cider. Its first 1,000 events reach about two months ahead.
const classpop = eventbriteSource({
	id: "classpop",
	organizerId: "25190855215",
	venues: { "channel marker cider": "channel-marker-cider" },
	category: "class",
	mayBeEmpty: true,
	maxPages: 20,
	// "Falling Leaves Lane - Paint and Sip in Seattle | Classpop!™" → "Falling Leaves Lane - Paint and Sip"
	cleanTitle: (t) =>
		t.replace(/\s*\|\s*Classpop!™?$/i, "").replace(/ in Seattle$/i, ""),
});

// DinoDadComedy: a weekly Friday comedy show and a monthly Sunday open mic at the Rickshaw.
const dinoDad = eventbriteSource({
	id: "dinodad-comedy",
	organizerId: "38594623373",
	venues: { "rickshaw restaurant & lounge": "rickshaw" },
	category: "comedy",
	cleanTitle: (t) => t.replace(/^The Rickshaw /, ""),
});

// Not scraped (see CLAUDE.md): Tractor Tavern (ModSecurity blocks non-browser clients), Phinney
// Center (Cloudflare; some events arrive via My Ballard, PhinneyWood and SFS), Sunset Tavern (DICE
// widget needs an API key and dice.fm is behind Cloudflare), Fremont Abbey (public calendar is
// mostly rental placeholders), Mox Boarding House (Occasion calendar behind Cloudflare), U Wine Bar
// (robots.txt disallows all but Google), Ballard Clay and Throw & Build (KilnFire booking pages
// disallowed by robots.txt), Wet Clay Cafe (Wix Bookings sessions load client-side only), Waystone
// Wargaming (scrapable, but daytime tournaments). TicketWeb (Tractor) and the Wizards event locator
// (Mox, U Wine Bar) are fetchable but their terms forbid scraping.
export const sources: Source[] = [
	visitBallard,
	myBallard,
	nordicMuseum,
	conorByrne,
	aslanFremont,
	seattlePublicTheater,
	halfseas,
	halcyon,
	hiddenHall,
	abbeyArts,
	egans,
	nectar,
	wayward,
	westOfLenin,
	octopus,
	taproot,
	phinneyWood,
	sunsetHill,
	pantry,
	shibuyaHifi,
	saltstone,
	yuTang,
	seaFolklore,
	substation,
	mockingbird,
	tangoConnection,
	classpop,
	dinoDad,
];
