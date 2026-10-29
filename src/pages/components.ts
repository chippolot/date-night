import { href, SITE } from "../config";
import { type Filters, MAX_DAYS_AHEAD, TIME_SLOTS } from "../lib/filters";
import { addDays } from "../lib/recurrence";
import type { Night, Nth, Occurrence, Venue, Weekday } from "../lib/types";
import { CATEGORIES, NEIGHBORHOODS, VIBES } from "../lib/types";

export function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

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

export function reportLink(subject: string): string {
	if (!SITE.reportEmail) return "";
	const url = `mailto:${SITE.reportEmail}?subject=${encodeURIComponent(`Change: ${subject}`)}`;
	return `<a class="muted" href="${esc(url)}">Report a change</a>`;
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
    <span class="card-start">${formatTime(o.start)}</span>
    ${o.end ? `<span class="card-end">to ${formatTime(o.end)}</span>` : ""}
  </div>
  <div class="card-body">
    <h3>${esc(o.title)}</h3>
    ${where ? `<p class="card-where">${where}</p>` : ""}
    <p class="card-meta">
      <span class="chip">${CATEGORIES[o.category]}</span>
      ${o.cost ? `<span class="cost">${esc(o.cost)}</span>` : ""}
      ${freshnessBadge(o, today)}
    </p>
    <p class="card-actions">
      <a class="action" href="${icsHref(o)}" download>Add to calendar</a>
      <a class="action" href="${esc(o.url)}" rel="noopener" target="_blank">Source <span aria-hidden="true">↗</span></a>
      ${reportLink(`${o.title}${venue ? ` @ ${venue.name}` : ""}`)}
    </p>
  </div>
</article>`;
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

function checkboxGroup(
	name: string,
	label: string,
	options: [string, string][],
	selected: string[],
	className = "pills",
): string {
	const boxes = options
		.map(
			([value, text]) =>
				`<label class="pill"><input type="checkbox" name="${name}" value="${value}"${
					selected.includes(value) ? " checked" : ""
				}><span>${esc(text)}</span></label>`,
		)
		.join("");
	return `<fieldset><legend>${label}</legend><div class="${className}">${boxes}</div></fieldset>`;
}

const CALENDAR_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1.75" y="3" width="12.5" height="11.25" rx="1"/><path d="M1.75 6.5h12.5M5 1.5v3M11 1.5v3"/></svg>`;

const DAY_PILLS: [Weekday, string][] = [
	["MO", "Mon"],
	["TU", "Tue"],
	["WE", "Wed"],
	["TH", "Thu"],
	["FR", "Fri"],
	["SA", "Sat"],
	["SU", "Sun"],
];

/**
 * A plain GET form, so filtering works without JS; the client upgrades it to live updates.
 * Date, day and time sit above the collapsible panel. Pass `days: false` where the page covers a
 * single day, and `date: false` where a starting date doesn't apply (the map).
 */
export function filterBar(
	f: Filters,
	today: string,
	{ days = true, date = true } = {},
): string {
	const prices: [string, string][] = [
		["", "Any"],
		["1", "$"],
		["2", "$$ or less"],
	];
	const priceRadios = prices
		.map(
			([value, text]) =>
				`<label class="pill"><input type="radio" name="price" value="${value}"${
					String(f.price ?? "") === value ? " checked" : ""
				}><span>${text}</span></label>`,
		)
		.join("");
	const active =
		f.hood.length +
		f.cat.length +
		f.hide.length +
		f.vibe.length +
		(f.price ? 1 : 0);
	return `<form class="filters" method="get" data-filters>
  <div class="when">
    ${date ? `<fieldset class="date-pick"><legend>${days ? "Starting" : "Date"}</legend><label class="date-field">${CALENDAR_ICON}<input type="date" name="date" value="${f.date ?? ""}" min="${today}" max="${addDays(today, MAX_DAYS_AHEAD)}" aria-label="${days ? "Show the week starting on" : "Show events on"}"></label></fieldset>` : ""}
    ${days ? checkboxGroup("day", "Day", DAY_PILLS, f.day) : ""}
    ${checkboxGroup(
			"time",
			"Time",
			Object.entries(TIME_SLOTS).map(([k, t]) => [k, `${t.label} ${t.hours}`]),
			f.time,
		)}
    <button type="submit" class="js-hide">Apply</button>
  </div>
  <details${active ? " open" : ""}>
    <summary><span>Filter by neighborhood, vibe &amp; more</span>${active ? ` <span class="count">${active}</span>` : ""}</summary>
    ${checkboxGroup("hood", "Neighborhood", Object.entries(NEIGHBORHOODS), f.hood)}
    ${checkboxGroup("cat", "What", Object.entries(CATEGORIES), f.cat)}
    ${checkboxGroup(
			"hide",
			"Hide",
			Object.entries(CATEGORIES),
			f.hide,
			"pills pills-hide",
		)}
    ${checkboxGroup(
			"vibe",
			"Vibe",
			VIBES.map((v) => [v, v]),
			f.vibe,
		)}
    <fieldset><legend>Budget</legend><div class="pills">${priceRadios}</div></fieldset>
    <div class="filter-actions">
      <button type="submit" class="js-hide">Apply</button>
      <a href="?" data-clear>Clear all</a>
    </div>
  </details>
</form>`;
}
