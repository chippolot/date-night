import { SITE } from "./config";
import type { SiteData } from "./lib/data";
import { feed, feedPath, feedScopes } from "./lib/feeds";
import { EMPTY_FILTERS } from "./lib/filters";
import { calendar, eventVevent, nightVevent } from "./lib/ics";
import {
	eventOccurrences,
	nightOccurrences,
	seattleParts,
} from "./lib/recurrence";
import type { Occurrence, Venue } from "./lib/types";
import {
	describeRecurrence,
	filterBar,
	formatDate,
	formatTime,
	listingPath,
	shareText,
	titleAt,
	whenText,
} from "./pages/components";
import { layout } from "./pages/layout";
import {
	footer,
	listingSummary,
	listingView,
	occurrences,
	tonightView,
	venueMap,
	venuesIndexView,
	venueView,
	weekView,
} from "./pages/views";

export type Asset = { body: string; type: string };

const HTML = "text/html; charset=utf-8";
const ICS = "text/calendar; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";

/**
 * Every route of the static site, rendered for `today`. Pages are pre-rendered
 * with no filters; the client re-renders date-dependent views in the browser.
 */
export function renderSite(data: SiteData, today: string): Map<string, Asset> {
	const out = new Map<string, Asset>();
	const venueById = venueMap(data);
	const html = (path: string, body: string) =>
		out.set(path, { body, type: HTML });

	html(
		"/index.html",
		layout({
			page: "tonight",
			title: `Tonight · ${SITE.title}`,
			heading: "Tonight",
			intro: `<p>Happy hours, live music and little adventures across north Seattle, from Ballard to Lake City.</p>`,
			action: `<button type="button" class="surprise" data-surprise><svg class="surprise-star" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C8.6 4.6 11.4 7.4 16 8 11.4 8.6 8.6 11.4 8 16 7.4 11.4 4.6 8.6 0 8 4.6 7.4 7.4 4.6 8 0Z"/></svg>Surprise me</button>`,
			body: `<div data-surprise-result></div>${filterBar(EMPTY_FILTERS, today, { days: false })}<div data-view>${tonightView(data, today, EMPTY_FILTERS)}</div>${footer({ subscribe: false })}`,
			scripts: ["/app.js"],
		}),
	);

	html(
		"/week/index.html",
		layout({
			page: "week",
			title: `Coming up · ${SITE.title}`,
			heading: "Coming up",
			intro:
				"See what's happening over the next week, or choose a date to plan something further out.",
			body: `${filterBar(EMPTY_FILTERS, today)}<div data-view>${weekView(data, today, EMPTY_FILTERS)}</div>${footer({ subscribe: false })}`,
			scripts: ["/app.js"],
		}),
	);

	html(
		"/map/index.html",
		layout({
			page: "map",
			title: `Map · ${SITE.title}`,
			heading: "Map",
			intro:
				"All the bars, venues and spots we follow around north Seattle, with what's coming up at each one.",
			body: `${filterBar(EMPTY_FILTERS, today, { date: false })}<div id="map" class="map" role="region" aria-label="Map of venues"></div>${footer()}`,
			scripts: ["/map.js"],
			styles: ["/leaflet.css"],
		}),
	);

	html(
		"/venues/index.html",
		layout({
			page: "venues",
			title: `Venues · ${SITE.title}`,
			heading: "Venues",
			intro:
				"Every bar, music venue and gathering spot we follow, grouped by neighborhood.",
			body: `${venuesIndexView(data)}${footer()}`,
		}),
	);

	const upcoming = occurrences(data, today, 60);
	for (const venue of data.venues) {
		html(
			`/venues/${venue.id}/index.html`,
			layout({
				page: "venue",
				title: `${venue.name} · ${SITE.title}`,
				heading: venue.name,
				body: `${venueView(data, venue, today, upcoming)}${footer()}`,
				scripts: ["/static.js"],
				noData: true,
			}),
		);
	}

	// One page per listing, for share links. A night's page shows its next date.
	const listing = (
		o: Occurrence,
		venue: Venue | undefined,
		label: string,
		when: string,
	) =>
		html(
			`${listingPath(o.kind, o.refId)}index.html`,
			layout({
				page: "listing",
				title: `${shareText(o, venue)} · ${SITE.title}`,
				heading: o.title,
				preview: {
					title: titleAt(o, venue),
					description: listingSummary(o, venue, when),
				},
				body: `${listingView(o, venue, today, label)}${footer()}`,
				scripts: ["/static.js"],
				noData: true,
			}),
		);
	for (const e of data.events) {
		const { date } = seattleParts(e.startsAt);
		const o = eventOccurrences([e], data.venues, date, 1)[0];
		if (!o) continue;
		const venue = o.venueId ? venueById.get(o.venueId) : undefined;
		const day = formatDate(o.date, {
			weekday: "short",
			month: "short",
			day: "numeric",
		});
		listing(o, venue, day, whenText(o));
	}
	for (const n of data.nights) {
		const o = nightOccurrences([n], today, 400)[0];
		if (!o) continue;
		const schedule = describeRecurrence(n);
		listing(
			o,
			venueById.get(n.venueId),
			schedule,
			o.allDay
				? `${schedule}, all day`
				: `${schedule} at ${formatTime(o.start)}`,
		);
	}

	// Runs that have ended (e.g. a closed show) have no next occurrence to export.
	const activeNights = data.nights.filter(
		(n) => !n.recurrence.until || n.recurrence.until >= today,
	);
	const nightEvents = activeNights.map((n) =>
		nightVevent(n, venueById.get(n.venueId), today),
	);
	out.set("/calendar.ics", {
		body: calendar(nightEvents, `${SITE.title} — recurring nights`),
		type: ICS,
	});
	for (const n of activeNights) {
		out.set(`/ics/night/${n.id}.ics`, {
			body: calendar(
				[nightVevent(n, venueById.get(n.venueId), today)],
				n.title,
			),
			type: ICS,
		});
	}
	for (const e of data.events) {
		out.set(`/ics/event/${e.id}.ics`, {
			body: calendar(
				[eventVevent(e, e.venueId ? venueById.get(e.venueId) : undefined)],
				e.title,
			),
			type: ICS,
		});
	}

	for (const scope of feedScopes()) {
		out.set(feedPath(scope), { body: feed(data, today, scope), type: ICS });
	}

	out.set("/data.json", { body: JSON.stringify(data), type: JSON_TYPE });
	return out;
}
