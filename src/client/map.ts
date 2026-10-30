import L from "leaflet";
import { CARTO_KEY, href } from "../config";
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

// Same print colors as the category dots in styles.css
const COLORS: Record<Category, string> = {
	"live-music": "#d9412b",
	jazz: "#1f3d8c",
	trivia: "#e3a92b",
	"food-drink-special": "#9c2a4f",
	dance: "#e46f8c",
	comedy: "#f08a3c",
	karaoke: "#6b3f8f",
	art: "#2a8c88",
	market: "#1d4a3b",
	"open-mic": "#a8652e",
	class: "#7c9a3a",
	theater: "#4c6ea8",
};

async function main() {
	const data = await loadSiteData();
	const map = L.map("map").setView([47.668, -122.36], 13);
	// CARTO basemaps: Voyager, or Dark Matter in dark mode (Voyager has no dark variant).
	const tiles = L.tileLayer("", {
		maxZoom: 20,
		attribution:
			'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
	}).addTo(map);
	const dark = matchMedia("(prefers-color-scheme: dark)");
	const setTiles = () =>
		tiles.setUrl(
			`https://basemaps.cartocdn.com/rastertiles/${dark.matches ? "dark_all" : "voyager"}/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?key=${CARTO_KEY}` : ""}`,
		);
	setTiles();
	dark.addEventListener("change", setTiles);
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
					`<li><strong>${esc(n.title)}</strong><br><span>${describeRecurrence(n)} ${n.allDay ? "all day" : formatTime(n.start)} · ${CATEGORIES[n.category]}</span></li>`,
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
