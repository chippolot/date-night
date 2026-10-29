import L from "leaflet";
import { href } from "../config";
import type { Filters } from "../lib/filters";
import { seattleParts } from "../lib/recurrence";
import { CATEGORIES, type Category, NEIGHBORHOODS } from "../lib/types";
import {
	describeRecurrence,
	esc,
	formatDate,
	formatTime,
} from "../pages/components";
import { eventKind, mapVenues, matchesKind, nightKind } from "../pages/views";
import { loadSiteData, wireFilters } from "./shared";

const COLORS: Record<Category, string> = {
	"live-music": "#c2410c",
	jazz: "#7c3aed",
	trivia: "#0369a1",
	"food-drink-special": "#be123c",
	dance: "#db2777",
	comedy: "#ca8a04",
	karaoke: "#9333ea",
	art: "#0d9488",
	market: "#15803d",
	"open-mic": "#b45309",
	class: "#4d7c0f",
	theater: "#1d4ed8",
};

async function main() {
	const data = await loadSiteData();
	const map = L.map("map").setView([47.668, -122.36], 13);
	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19,
		attribution:
			'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
	}).addTo(map);
	const layer = L.layerGroup().addTo(map);

	const draw = (f: Filters) => {
		layer.clearLayers();
		const venues = mapVenues(data, f);
		for (const v of venues) {
			const ns = data.nights.filter(
				(n) => n.venueId === v.id && matchesKind(nightKind(n), f),
			);
			const upcoming = data.events
				.filter(
					(e) =>
						e.venueId === v.id &&
						Date.parse(e.startsAt) >= Date.now() &&
						matchesKind(eventKind(e), f),
				)
				.slice(0, 3);
			const color =
				COLORS[ns[0]?.category ?? upcoming[0]?.category ?? "live-music"];
			const nightItems = ns.map(
				(n) =>
					`<li><strong>${esc(n.title)}</strong><br><span>${describeRecurrence(n)} ${formatTime(n.start)} · ${CATEGORIES[n.category]}</span></li>`,
			);
			const eventItems = ns.length
				? []
				: upcoming.map((e) => {
						const { date, time } = seattleParts(e.startsAt);
						return `<li><strong>${esc(e.title)}</strong><br><span>${formatDate(date, { weekday: "short", month: "short", day: "numeric" })} ${formatTime(time)}</span></li>`;
					});
			const list = [...nightItems, ...eventItems].join("");
			L.circleMarker([v.lat, v.lng], {
				radius: 9,
				color: "#fff",
				weight: 2,
				fillColor: color,
				fillOpacity: 0.9,
			})
				.bindPopup(
					`<a href="${href(`/venues/${v.id}/`)}"><strong>${esc(v.name)}</strong></a><br><span>${NEIGHBORHOODS[v.neighborhood]}</span><ul class="popup-list">${list}</ul>`,
				)
				.addTo(layer);
		}
		if (venues.length) {
			map.fitBounds(L.latLngBounds(venues.map((v) => [v.lat, v.lng])), {
				padding: [30, 30],
				maxZoom: 15,
			});
		}
	};
	draw(wireFilters(draw));
}

main();
