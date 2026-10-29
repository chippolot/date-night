import { SITE } from "./config";
import type { SiteData } from "./lib/data";
import { EMPTY_FILTERS } from "./lib/filters";
import { calendar, eventVevent, nightVevent } from "./lib/ics";
import { filterBar } from "./pages/components";
import { layout } from "./pages/layout";
import {
	footer,
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
			intro: `<p>Happy hours, live music and little adventures around Ballard &amp; friends.</p><button type="button" class="surprise" data-surprise>✨ Surprise me</button>`,
			body: `<div data-surprise-result></div>${filterBar(EMPTY_FILTERS, { days: false })}<div data-view>${tonightView(data, today, EMPTY_FILTERS)}</div>${footer}`,
			scripts: ["/app.js"],
		}),
	);

	html(
		"/week/index.html",
		layout({
			page: "week",
			title: `This week · ${SITE.title}`,
			heading: "This week",
			intro: "The next seven nights, recurring and one-off.",
			body: `${filterBar(EMPTY_FILTERS)}<div data-view>${weekView(data, today, EMPTY_FILTERS)}</div>${footer}`,
			scripts: ["/app.js"],
		}),
	);

	html(
		"/map/index.html",
		layout({
			page: "map",
			title: `Map · ${SITE.title}`,
			heading: "Map",
			intro: "Everything we track, pinned. Tap a dot for what's on.",
			body: `${filterBar(EMPTY_FILTERS)}<div id="map" class="map" role="region" aria-label="Map of venues"></div>${footer}`,
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
			intro: "Every spot we track, by neighborhood.",
			body: `${venuesIndexView(data)}${footer}`,
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
				body: `${venueView(data, venue, today, upcoming)}${footer}`,
			}),
		);
	}

	const nightEvents = data.nights.map((n) =>
		nightVevent(n, venueById.get(n.venueId), today),
	);
	out.set("/calendar.ics", {
		body: calendar(nightEvents, `${SITE.title} — recurring nights`),
		type: ICS,
	});
	for (const n of data.nights) {
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

	out.set("/data.json", { body: JSON.stringify(data), type: JSON_TYPE });
	return out;
}
