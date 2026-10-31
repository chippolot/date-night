import { href, SITE } from "../config";
import { feedHref, feedName, matchingFeeds } from "../lib/feeds";
import {
	COST_FILTERS,
	type Filters,
	isOutdoor,
	MAX_DAYS_AHEAD,
	TIME_SLOTS,
} from "../lib/filters";
import { addDays } from "../lib/recurrence";
import type { Night, Nth, Occurrence, Venue, Weekday } from "../lib/types";
import {
	CATEGORIES,
	CATEGORY_ICONS,
	type Category,
	NEIGHBORHOODS,
	VIBES,
} from "../lib/types";

export function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const icon = (paths: string) =>
	`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const SEARCH_ICON = icon(
	`<circle cx="7" cy="7" r="4.75"/><path d="M10.5 10.5l3.75 3.75"/>`,
);
export const CALENDAR_ICON = icon(
	`<rect x="1.75" y="3" width="12.5" height="11.25" rx="1"/><path d="M1.75 6.5h12.5M5 1.5v3M11 1.5v3"/>`,
);
const SLIDERS_ICON = icon(
	`<path d="M2 4h7M12 4h2M2 12h2M7 12h7"/><circle cx="10.5" cy="4" r="1.5"/><circle cx="5.5" cy="12" r="1.5"/>`,
);

const EXTERNAL_ICON = icon(
	`<path d="M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3.25a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75v-7.5a.75.75 0 0 1 .75-.75H6.5"/>`,
);
const FLAG_ICON = icon(`<path d="M3 14.5V2M3 2.5h8.5l-1.75 3 1.75 3H3"/>`);
const SHARE_ICON = icon(
	`<path d="M8 1.75v8M5 4.75l3-3 3 3"/><path d="M5.5 7H4a.75.75 0 0 0-.75.75v5.5c0 .41.34.75.75.75h8a.75.75 0 0 0 .75-.75v-5.5A.75.75 0 0 0 12 7h-1.5"/>`,
);

/** "19:00" → "7pm", "19:30" → "7:30pm" */
export function formatTime(hhmm: string): string {
	const [h = 0, m = 0] = hhmm.split(":").map(Number);
	const suffix = h >= 12 && h < 24 ? "pm" : "am";
	const hour = h % 12 === 0 ? 12 : h % 12;
	return m
		? `${hour}:${String(m).padStart(2, "0")}${suffix}`
		: `${hour}${suffix}`;
}

export function formatDate(
	date: string,
	opts: Intl.DateTimeFormatOptions,
): string {
	return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
		timeZone: "UTC",
		...opts,
	});
}

function daysBetween(from: string, to: string): number {
	const a = new Date(`${from}T00:00:00Z`);
	const b = new Date(`${to}T00:00:00Z`);
	return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

export function freshnessBadge(o: Occurrence, today: string): string {
	if (o.kind === "event")
		return `<span class="badge badge-ok">From venue calendar</span>`;
	const when = o.lastVerified
		? formatDate(o.lastVerified, { month: "short", year: "numeric" })
		: "unknown";
	const age = o.lastVerified ? daysBetween(o.lastVerified, today) : Infinity;
	if (o.confidence === "stale" || age > SITE.freshDays) {
		return `<span class="badge badge-stale" title="Last checked ${esc(when)}">May be outdated</span>`;
	}
	if (o.confidence === "likely") {
		return `<span class="badge badge-likely" title="Based on recent listings, not the venue itself">Likely · ${esc(when)}</span>`;
	}
	return `<span class="badge badge-ok">Verified ${esc(when)}</span>`;
}

export function icsHref(o: Occurrence): string {
	return href(`/ics/${o.kind}/${o.refId}.ics`);
}

/** What a shared listing says: "Jazz Night at Conor Byrne Pub, Fri, Oct 31 at 8pm" */
export function shareText(o: Occurrence, venue: Venue | undefined): string {
	const day = formatDate(o.date, {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
	const when = o.allDay
		? `${day}, all day`
		: `${day} at ${formatTime(o.start)}`;
	return `${o.title}${venue ? ` at ${venue.name}` : ""}, ${when}`;
}

/** Tonight's page for the listing's day, with the listing pinned at the top. */
export function sharePath(o: Occurrence): string {
	const params = new URLSearchParams({ date: o.date, show: o.key });
	return `${href("/")}?${params}`;
}

/** Shares through the phone's share sheet, or copies the link; the client unhides it. */
function shareButton(o: Occurrence, venue: Venue | undefined): string {
	return `<button type="button" class="icon-action" data-share="${esc(sharePath(o))}" data-share-text="${esc(shareText(o, venue))}" title="Share" aria-label="Share" hidden>${SHARE_ICON}</button>`;
}

/** A link to the "Something changed?" form, pre-filled with the listing and its source. */
export function reportLink(o: Occurrence, venue: Venue | undefined): string {
	const form = SITE.reportForm;
	if (!form.url) return "";
	const when =
		o.kind === "night"
			? "recurring night"
			: formatDate(o.date, { month: "short", day: "numeric" });
	const params = new URLSearchParams({
		usp: "pp_url",
		[form.listing]: `${o.title}${venue ? ` @ ${venue.name}` : ""} (${when}, ${o.kind}:${o.refId})`,
		[form.source]: o.url,
	});
	const url = `${form.url}?${params}`;
	return `<a class="icon-action" href="${esc(url)}" rel="noopener" target="_blank" title="Something changed? Tell us" aria-label="Report a change">${FLAG_ICON}</a>`;
}

const DAY_NAMES: Record<Weekday, string> = {
	SU: "Sun",
	MO: "Mon",
	TU: "Tue",
	WE: "Wed",
	TH: "Thu",
	FR: "Fri",
	SA: "Sat",
};
const NTH: Record<Nth, string> = {
	1: "1st",
	2: "2nd",
	3: "3rd",
	4: "4th",
	5: "5th",
	[-1]: "Last",
};
const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "Every Fri & Sat", "2nd & 4th Mon", "Every Wed (Jun–Aug)" */
export function describeRecurrence(n: Night): string {
	const r = n.recurrence;
	const list = (xs: string[]) =>
		xs.length > 1
			? `${xs.slice(0, -1).join(", ")} & ${xs.at(-1)}`
			: (xs[0] ?? "");
	const base =
		r.kind === "weekly"
			? r.days.length === 7
				? "Daily"
				: `Every ${list(r.days.map((d) => DAY_NAMES[d]))}`
			: `${list(r.nth.map((x) => NTH[x]))} ${DAY_NAMES[r.day]}`;
	const months = r.months?.length
		? ` (${MONTH_NAMES[(r.months[0] ?? 1) - 1]}–${MONTH_NAMES[(r.months.at(-1) ?? 12) - 1]})`
		: "";
	return `${base}${months}`;
}

export function card(
	o: Occurrence,
	venue: Venue | undefined,
	today: string,
	/** Replaces the time column, e.g. with a date or recurrence description */
	timeLabel?: string,
): string {
	const where = venue
		? `<a href="${href(`/venues/${venue.id}/`)}">${esc(venue.name)}</a> · ${NEIGHBORHOODS[venue.neighborhood]}`
		: "";
	return `<article class="card cat-${o.category}" data-key="${esc(o.key)}">
  <div class="card-time">
    ${timeLabel ? `<span class="card-when">${esc(timeLabel)}</span>` : ""}
    <span class="card-start">${o.allDay ? "All day" : formatTime(o.start)}</span>
    ${o.end && !o.allDay ? `<span class="card-end">to ${formatTime(o.end)}</span>` : ""}
  </div>
  <div class="card-body">
    <h3>${esc(o.title)}</h3>
    ${where ? `<p class="card-where">${where}</p>` : ""}
    <p class="card-meta">
      <span class="chip">${CATEGORIES[o.category]}</span>
      ${o.cost ? `<span class="cost">${esc(o.cost)}</span>` : ""}
      ${isOutdoor(o, venue) ? `<span class="outdoor">Outdoors</span>` : ""}
      ${freshnessBadge(o, today)}
    </p>
    <p class="card-actions">
      <a class="icon-action" href="${icsHref(o)}" download title="Add to calendar" aria-label="Add to calendar">${CALENDAR_ICON}</a>
      ${shareButton(o, venue)}
      <a class="icon-action" href="${esc(o.url)}" rel="noopener" target="_blank" title="Source" aria-label="Source (opens in a new tab)">${EXTERNAL_ICON}</a>
      ${reportLink(o, venue)}
    </p>
  </div>
</article>`;
}

/** A happy hour as one compact row: hours, where, and the deal. */
export function specialRow(o: Occurrence, venue: Venue | undefined): string {
	const when = o.allDay
		? "All day"
		: `${formatTime(o.start)}${o.end ? `–${formatTime(o.end)}` : ""}`;
	const where = venue
		? `<a href="${href(`/venues/${venue.id}/`)}">${esc(venue.name)}</a> · ${NEIGHBORHOODS[venue.neighborhood]}`
		: "";
	return `<li class="special-row cat-${o.category}" data-key="${esc(o.key)}">
  <span class="special-when">${when}</span>
  <span class="special-body">
    <span class="special-where">${where || esc(o.title)}</span>
    <span class="special-deal">${esc(o.cost || o.title)}</span>
  </span>
  <a class="icon-action" href="${esc(o.url)}" rel="noopener" target="_blank" title="Source" aria-label="Source (opens in a new tab)">${EXTERNAL_ICON}</a>
</li>`;
}

/**
 * Happy hours gathered into one closed shelf above the day's other listings, so they don't
 * bury them.
 * The client keeps it open across re-renders once someone opens it.
 */
export function specialsShelf(
	list: Occurrence[],
	venueById: Map<string, Venue>,
): string {
	if (!list.length) return "";
	const rows = list
		.map((o) => specialRow(o, o.venueId ? venueById.get(o.venueId) : undefined))
		.join("\n");
	return `<details class="specials" data-specials="${list[0]?.date ?? ""}"><summary class="specials-summary"><h2 class="part-heading specials-heading"><span class="part-mark part-specials" aria-hidden="true"></span>Happy hours <span class="part-count">${list.length}</span></h2></summary><ul class="special-list">${rows}</ul></details>`;
}

/**
 * Calendar feeds for the picked categories and neighborhoods. Links are https; the client turns
 * them into webcal:// (data-webcal) so a tap subscribes instead of downloading.
 */
export function subscribeLinks(f: Filters): string {
	const feeds = matchingFeeds(f.hood, f.cat);
	if (!feeds)
		return `<p class="subscribe muted">To subscribe in your calendar app, pick a few kinds of thing and neighborhoods.</p>`;
	const links = feeds
		.map(
			(s) =>
				`<a href="${esc(feedHref(s))}" data-webcal>${esc(feedName(s))}</a>`,
		)
		.join(", ");
	return `<p class="subscribe">${CALENDAR_ICON}<span>Subscribe in your calendar app: ${links}. Feeds update daily and cover every day, time and price.</span></p>`;
}

export function cardList(
	list: Occurrence[],
	venueById: Map<string, Venue>,
	today: string,
	empty = "Nothing matches these filters.",
): string {
	if (!list.length) return `<p class="empty">${empty}</p>`;
	return list
		.map((o) =>
			card(o, o.venueId ? venueById.get(o.venueId) : undefined, today),
		)
		.join("\n");
}

/** A labeled row of pills: the label sits in a left column on wide screens, above on narrow ones. */
function row(legend: string, pills: string, hint = ""): string {
	return `<fieldset class="filter-row"><legend>${legend}${hint ? `<span class="legend-hint">${hint}</span>` : ""}</legend><div class="pills">${pills}</div></fieldset>`;
}

function pill(
	type: "checkbox" | "radio",
	name: string,
	value: string,
	label: string,
	checked: boolean,
	attrs = "",
): string {
	return `<label class="pill"><input type="${type}" name="${name}" value="${value}"${attrs}${checked ? " checked" : ""}><span>${label}</span></label>`;
}

function checkboxes(
	name: string,
	options: [string, string][],
	selected: string[],
): string {
	return options
		.map(([value, label]) =>
			pill("checkbox", name, value, label, selected.includes(value)),
		)
		.join("");
}

function radios(name: string, options: [string, string][], value = ""): string {
	return options
		.map(([v, label]) => pill("radio", name, v, esc(label), value === v))
		.join("");
}

/**
 * "What" as tri-state pills: tapping cycles off → picked (show only these, `cat`) → hidden
 * (`hide`) → off. Each pill holds both checkboxes, so the URL format and filtering are unchanged;
 * without JS the label toggles only the first one (pick).
 */
function whatPills(f: Filters): string {
	return (Object.entries(CATEGORIES) as [Category, string][])
		.map(([value, text]) => {
			const checked = (on: boolean) => (on ? " checked" : "");
			return `<label class="pill tri"><input type="checkbox" name="cat" value="${value}"${checked(f.cat.includes(value))}><input type="checkbox" name="hide" value="${value}" tabindex="-1" aria-label="Hide ${esc(text)}"${checked(f.hide.includes(value))}><span><span class="pill-icon" aria-hidden="true">${CATEGORY_ICONS[value]}</span>${esc(text)}</span></label>`;
		})
		.join("");
}

/** Happy hours and food & drink deals, which get their own collapsed shelf on each day. */
export const SPECIALS: Category = "food-drink-special";

/** One-tap switches beside day and time. "Indoors only" is for rainy nights. */
function quickPills(f: Filters): string {
	return pill(
		"checkbox",
		"indoors",
		"1",
		`<span class="pill-icon" aria-hidden="true">☔</span>Indoors only`,
		!!f.indoors,
	);
}

const DAY_PILLS: [Weekday, string][] = [
	["MO", "Mon"],
	["TU", "Tue"],
	["WE", "Wed"],
	["TH", "Thu"],
	["FR", "Fri"],
	["SA", "Sat"],
	["SU", "Sun"],
];

/** How many filters are set inside the "More filters" panel, for its badge. */
export function panelCount(f: Filters): number {
	return (
		f.hood.length +
		f.cat.length +
		f.hide.length +
		f.vibe.length +
		(f.price ? 1 : 0) +
		(f.cost ? 1 : 0)
	);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A plain GET form, so filtering works without JS; the client upgrades it to live updates.
 * Search, date, day, time and the quick switches stay in view; where, what, vibe and cost sit in
 * the collapsible panel. Pass `days: false` where the page covers a single day, and `date: false`
 * where a starting date doesn't apply (the map).
 */
export function filterBar(
	f: Filters,
	today: string,
	{ days = true, date = true } = {},
): string {
	const active = panelCount(f);
	const times = Object.entries(TIME_SLOTS).map(([k, t]): [string, string] => [
		k,
		`${t.label}<span class="pill-hint">${t.hours}</span>`,
	]);
	return `<form class="filters" method="get" data-filters>
  <div class="filter-top">
    <label class="search-field">${SEARCH_ICON}<input type="search" name="q" value="${esc(f.q ?? "")}" placeholder="Search: jazz, trivia, Substation…" aria-label="Search events and venues" autocomplete="off" enterkeyhint="search"></label>
    ${date ? `<label class="date-field" title="${days ? "Show the week starting on" : "Show another day"}">${CALENDAR_ICON}<input type="date" name="date" value="${f.date ?? ""}" min="${today}" max="${addDays(today, MAX_DAYS_AHEAD)}" aria-label="${days ? "Show the week starting on" : "Show events on"}"></label>` : ""}
    <noscript><button type="submit">Apply</button></noscript>
  </div>
  ${days ? row("Day", checkboxes("day", DAY_PILLS, f.day)) : ""}
  ${row("Time", checkboxes("time", times, f.time))}
  ${row("Quick", quickPills(f))}
  <details${active ? " open" : ""}>
    <summary><span class="summary-icon">${SLIDERS_ICON}</span><span>More filters</span><span class="summary-hint">Neighborhood, what, vibe &amp; cost</span><span class="count" data-panel-count${active ? "" : " hidden"}>${active}</span></summary>
    <div class="filter-panel">
      ${row("Where", checkboxes("hood", Object.entries(NEIGHBORHOODS), f.hood))}
      ${row("What", whatPills(f), "Tap to pick, again to hide")}
      ${row(
				"Vibe",
				checkboxes(
					"vibe",
					VIBES.map((v) => [v, capitalize(v)]),
					f.vibe,
				),
			)}
      ${row("Cost", radios("cost", [["", "Any"], ...Object.entries(COST_FILTERS)], f.cost), "Includes no-cover nights")}
      ${row(
				"Food &amp; drink",
				radios(
					"price",
					[
						["", "Any"],
						["1", "Budget"],
						["2", "Mid-range or less"],
					],
					f.price ? String(f.price) : "",
				),
				"Our estimate",
			)}
      <div class="filter-actions">
        <noscript><button type="submit">Apply</button></noscript>
        <a href="?" data-clear>Clear all</a>
      </div>
    </div>
  </details>
</form>`;
}
