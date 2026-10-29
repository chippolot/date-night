import { todayInSeattle } from "../../src/lib/recurrence";
import type { Category } from "../../src/lib/types";
import { toIso } from "./ical";
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

/** "2026-10-29" + "20:00:00" (Seattle local) → ISO with offset. */
function localIso(date: string, time: string): string | undefined {
	return toIso(
		`${date.replaceAll("-", "")}T${time.replaceAll(":", "").padEnd(6, "0")}`,
	);
}

// ---------------------------------------------------------------------------
// visitballard.com: Ballard Alliance calendar (WordPress "The Events Calendar" REST API).
// Covers many Ballard venues; only events at venues we list are kept.

/** visitballard venue name (lowercased, entities decoded) → our venue id */
const VISITBALLARD_VENUES: Record<string, string> = {
	"skål beer hall": "skal-beer-hall",
	"national nordic museum": "nordic-museum",
	"hattie's hat": "hatties-hat",
	"the ink drinker": "the-ink-drinker",
	"swoon city": "swoon-city",
	"reuben's brews": "reubens-brews",
	"cloudburst on shilshole": "cloudburst-shilshole",
	"ballard beer box": "ballard-beer-box",
	"2446 nw market st. seattle, wa, 98107": "ballard-beer-box",
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

const visitBallard: Source = {
	id: "visitballard",
	async fetchEvents() {
		const { from, to } = horizon();
		let url: string | undefined =
			`https://www.visitballard.com/wp-json/tribe/events/v1/events?per_page=50&start_date=${from}&end_date=${to}`;
		const out: ScrapedEvent[] = [];
		for (let page = 0; url && page < 40; page++) {
			const body: { events: TribeEvent[]; next_rest_url?: string } = JSON.parse(
				await get(url),
			);
			for (const e of body.events) {
				if (e.all_day) continue;
				const venues = Array.isArray(e.venue) ? e.venue : [e.venue];
				const name = decodeEntities(venues[0]?.venue ?? "")
					.replace(/[‘’]/g, "'")
					.toLowerCase()
					.trim();
				const venueId = VISITBALLARD_VENUES[name];
				if (!venueId) continue;
				const title = decodeEntities(e.title).trim();
				out.push({
					id: `visitballard-${e.id}-${e.utc_start_date.slice(0, 10)}`,
					venueId,
					title,
					startsAt: `${e.utc_start_date.replace(" ", "T")}Z`,
					endsAt: e.utc_end_date
						? `${e.utc_end_date.replace(" ", "T")}Z`
						: undefined,
					url: e.url,
					price: e.cost ? decodeEntities(e.cost) : undefined,
					category: guessCategory(
						title,
						venueId === "nordic-museum" ? "art" : undefined,
					),
				});
			}
			url = body.next_rest_url;
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
// Squarespace events collections expose their upcoming events at `?format=json`.

type SquarespaceEvent = {
	title: string;
	startDate: number;
	endDate?: number;
	fullUrl: string;
};

async function squarespaceEvents(
	base: string,
	path: string,
	idPrefix: string,
): Promise<ScrapedEvent[]> {
	const body: { upcoming?: SquarespaceEvent[] } = JSON.parse(
		await get(`${base}${path}?format=json`),
	);
	return (body.upcoming ?? []).map((e) => {
		const title = decodeEntities(e.title).trim();
		const startsAt = new Date(e.startDate).toISOString();
		return {
			id: `${idPrefix}-${startsAt.slice(0, 16)}-${slug(title)}`,
			title,
			startsAt,
			endsAt: e.endDate ? new Date(e.endDate).toISOString() : undefined,
			url: `${base}${e.fullUrl}`,
		};
	});
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
				"https://halcyonbrewingco.com",
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
	const [year = 0, month = 0] = today.split("-").map(Number);
	const out: ScrapedEvent[] = [];
	for (const [, dl = ""] of html.matchAll(/<dl>([\s\S]*?)<\/dl>/gi)) {
		const dt = stripTags(dl.match(/<dt>([\s\S]*?)<\/dt>/i)?.[1] ?? "");
		const dm = dt.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2})$/);
		if (!dm) continue; // e.g. "Our Reservation Policy"
		const mon = MONTHS.indexOf((dm[1] ?? "").toLowerCase()) + 1;
		if (!mon) continue;
		// Months well before the current one belong to next year (Dec → Jan rollover).
		const y = mon < month - 2 ? year + 1 : year;
		const date = `${y}-${String(mon).padStart(2, "0")}-${String(dm[2]).padStart(2, "0")}`;
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

// Not scraped (see CLAUDE.md): Tractor Tavern (ModSecurity blocks non-browser clients),
// Phinney Center (Cloudflare), Sunset Tavern (DICE widget needs an API key),
// Fremont Abbey (public calendar is mostly rental placeholders).
export const sources: Source[] = [
	visitBallard,
	conorByrne,
	aslanFremont,
	seattlePublicTheater,
	halfseas,
	halcyon,
	hiddenHall,
	abbeyArts,
	egans,
];
