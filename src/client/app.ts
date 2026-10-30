import { href } from "../config";
import type { SiteData } from "../lib/data";
import { applyFilters, type Filters, viewDate } from "../lib/filters";
import { todayInSeattle } from "../lib/recurrence";
import { surprise } from "../lib/surprise";
import { NEIGHBORHOODS, PRICE_LEVELS } from "../lib/types";
import { card, esc, formatDate } from "../pages/components";
import { occurrences, tonightView, venueMap, weekView } from "../pages/views";
import { loadSiteData, wireFilters } from "./shared";

const page = document.body.dataset.page;
const view = document.querySelector<HTMLElement>("[data-view]");
const h1 = document.querySelector("h1");
const defaultHeading = h1?.textContent ?? "";

function render(data: SiteData, f: Filters) {
	if (!view) return;
	const today = todayInSeattle();
	const day = viewDate(f, today);
	view.innerHTML =
		page === "week"
			? weekView(data, day, f, today)
			: tonightView(data, day, f, today);
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
}

/** Tonight covers a single day, so it has no day picker and ignores any `day` in the URL. */
function forPage(f: Filters): Filters {
	return page === "week" ? f : { ...f, day: [] };
}

async function main() {
	const data = await loadSiteData();
	let filters = forPage(
		wireFilters((f) => {
			filters = forPage(f);
			render(data, filters);
		}),
	);
	// Always re-render: the static HTML was built for the build date, not today.
	render(data, filters);
	document
		.querySelector("[data-surprise]")
		?.addEventListener("click", () => renderSurprise(data, filters));
	document.addEventListener("keydown", (e) => {
		const out = document.querySelector<HTMLElement>("[data-surprise-result]");
		if (e.key === "Escape" && out?.hasChildNodes()) closeSurprise(out);
	});
}

main();
