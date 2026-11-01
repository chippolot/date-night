import { href } from "../config";
import type { SiteData } from "../lib/data";
import { applyFilters, type Filters, viewDate } from "../lib/filters";
import { todayInSeattle } from "../lib/recurrence";
import { surprise } from "../lib/surprise";
import { NEIGHBORHOODS, PRICE_LEVELS } from "../lib/types";
import { card, esc, formatDate, listingPath } from "../pages/components";
import { occurrences, tonightView, venueMap, weekView } from "../pages/views";
import { enableShare, wireShare } from "./share";
import { loadSiteData, wireFilters } from "./shared";
import { track } from "./track";

const page = document.body.dataset.page;
const view = document.querySelector<HTMLElement>("[data-view]");
const h1 = document.querySelector("h1");
const defaultHeading = h1?.textContent ?? "";

// Dates whose happy hour shelf is open, so a filter change doesn't snap it shut.
const openSpecials = new Set<string>();
// Times of day (Tonight) and dates (Coming up) someone folded away, which stay folded the same way.
const closedParts = new Set<string>();
const closedDays = new Set<string>();
// `toggle` doesn't bubble, so listen while capturing.
view?.addEventListener(
	"toggle",
	(e) => {
		const shelf = e.target;
		if (!(shelf instanceof HTMLDetailsElement)) return;
		const { specials: date, part, day } = shelf.dataset;
		if (date !== undefined) {
			if (shelf.open) openSpecials.add(date);
			else openSpecials.delete(date);
		}
		if (part !== undefined) {
			if (shelf.open) closedParts.delete(part);
			else closedParts.add(part);
		}
		if (day !== undefined) {
			if (shelf.open) closedDays.delete(day);
			else closedDays.add(day);
		}
	},
	true,
);

function render(data: SiteData, f: Filters) {
	if (!view) return;
	const today = todayInSeattle();
	const day = viewDate(f, today);
	view.innerHTML =
		page === "week"
			? weekView(data, day, f, today)
			: tonightView(data, day, f, today);
	for (const shelf of view.querySelectorAll<HTMLDetailsElement>(
		"details[data-specials]",
	)) {
		if (openSpecials.has(shelf.dataset.specials ?? "")) shelf.open = true;
	}
	for (const part of view.querySelectorAll<HTMLDetailsElement>(
		"details[data-part]",
	)) {
		if (closedParts.has(part.dataset.part ?? "")) part.open = false;
	}
	for (const day of view.querySelectorAll<HTMLDetailsElement>(
		"details[data-day]",
	)) {
		if (closedDays.has(day.dataset.day ?? "")) day.open = false;
	}
	webcalLinks();
	enableShare(view);
	if (h1) {
		h1.textContent =
			day === today
				? defaultHeading
				: page === "week"
					? `Week of ${formatDate(day, { month: "short", day: "numeric" })}`
					: formatDate(day, {
							weekday: "long",
							month: "short",
							day: "numeric",
						});
	}
}

/** Calendar feed links subscribe (webcal://) rather than download once JS is running. */
function webcalLinks() {
	for (const a of document.querySelectorAll<HTMLAnchorElement>(
		"a[data-webcal]",
	)) {
		const url = new URL(a.getAttribute("href") ?? "", location.href);
		a.href = `webcal://${url.host}${url.pathname}`;
	}
}

/**
 * Share links used to open Tonight with `?show=<key>`; listings have their own pages now, so send
 * those links on. Keys are "event:<id>" or "night:<id>:<date>".
 */
function forwardOldShareLink(): boolean {
	const key = new URLSearchParams(location.search).get("show");
	const m = key?.match(/^(event|night):(.+?)(?::\d{4}-\d{2}-\d{2})?$/);
	if (!m?.[1] || !m[2]) return false;
	location.replace(href(listingPath(m[1] as "event" | "night", m[2])));
	return true;
}

const CLOSE_BUTTON = `<button type="button" class="ticket-close" data-close aria-label="Close">×</button>`;

function closeSurprise(out: HTMLElement) {
	out.innerHTML = "";
	document.querySelector<HTMLElement>("[data-surprise]")?.focus();
}

function wireClose(out: HTMLElement) {
	out
		.querySelector("[data-close]")
		?.addEventListener("click", () => closeSurprise(out));
}

function renderSurprise(data: SiteData, f: Filters) {
	const out = document.querySelector<HTMLElement>("[data-surprise-result]");
	if (!out) return;
	const today = todayInSeattle();
	const day = viewDate(f, today);
	const venueById = venueMap(data);
	const tonight = applyFilters(occurrences(data, day, 1), venueById, f);
	const pick = surprise(
		tonight,
		data.venues.filter(
			(v) => !f.hood.length || f.hood.includes(v.neighborhood),
		),
	);
	track("surprise", { found: !!pick });
	if (!pick) {
		out.innerHTML = `<div class="ticket"><div class="ticket-part ticket-empty">${CLOSE_BUTTON}<p>Couldn't find a pairing for ${day === today ? "tonight" : "that day"} with these filters. Try loosening them.</p></div></div>`;
		wireClose(out);
		return;
	}
	const { food, activity } = pick;
	const foodHtml = food.occurrence
		? card(food.occurrence, food.venue, today)
		: `<article class="card cat-food-drink-special"><div class="card-time"><span class="card-start">Dinner</span></div><div class="card-body"><h3><a href="${href(`/venues/${food.venue.id}/`)}">${esc(food.venue.name)}</a></h3><p class="card-where">${NEIGHBORHOODS[food.venue.neighborhood]} · ${PRICE_LEVELS[food.venue.priceLevel]}</p></div></article>`;
	const activityHtml = activity
		? card(
				activity,
				activity.venueId ? venueById.get(activity.venueId) : undefined,
				today,
			)
		: `<p class="muted">No activity matches${day === today ? " tonight" : ""}; maybe just a long dinner.</p>`;
	out.innerHTML = `<div class="ticket">
  <div class="ticket-head">
    ${CLOSE_BUTTON}
    <span class="ticket-eyebrow">Admit two · ${formatDate(day, { weekday: "long", month: "short", day: "numeric" })}</span>
    <h2>${day === today ? "Tonight's plan" : "The plan"}</h2>
  </div>
  <div class="ticket-part"><p class="step"><span class="step-n">1</span> Dinner or drinks</p>${foodHtml}</div>
  <div class="ticket-tear" aria-hidden="true"></div>
  <div class="ticket-part"><p class="step"><span class="step-n">2</span> Then</p>${activityHtml}</div>
  <div class="ticket-foot"><button type="button" data-reroll>Re-roll</button></div>
</div>`;
	out
		.querySelector("[data-reroll]")
		?.addEventListener("click", () => renderSurprise(data, f));
	wireClose(out);
	enableShare(out);
}

/** Tonight covers a single day, so it has no day picker and ignores any `day` in the URL. */
function forPage(f: Filters): Filters {
	return page === "week" ? f : { ...f, day: [] };
}

async function main() {
	if (forwardOldShareLink()) return;
	const data = await loadSiteData();
	let filters = forPage(
		wireFilters((f) => {
			filters = forPage(f);
			render(data, filters);
		}),
	);
	// Always re-render: the static HTML was built for the build date, not today.
	render(data, filters);
	wireShare();
	document
		.querySelector("[data-surprise]")
		?.addEventListener("click", () => renderSurprise(data, filters));
	document.addEventListener("keydown", (e) => {
		const out = document.querySelector<HTMLElement>("[data-surprise-result]");
		if (e.key === "Escape" && out?.hasChildNodes()) closeSurprise(out);
	});
}

main();
