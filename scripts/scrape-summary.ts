// Markdown summary of what a scrape added: events not listed before, and venues that had no
// events before. The daily workflow appends it to the run's summary page.
// `bun scripts/scrape-summary.ts [base]` compares data/events.generated.json with the version at
// git ref `base` (default HEAD), and appends to $GITHUB_STEP_SUMMARY or prints to stdout.
import { venues } from "../data/venues";
import { seattleParts } from "../src/lib/recurrence";
import type { DatedEvent, Venue } from "../src/lib/types";

const FILE = "data/events.generated.json";
/** Keep the summary readable (and well under GitHub's 1 MiB step summary limit) */
const MAX_EVENTS = 300;

const DAY_FMT = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	weekday: "short",
	month: "short",
	day: "numeric",
});

/** Escape characters that would turn a title into Markdown links or formatting. */
const mdEscape = (s: string) => s.replace(/[\\[\]*_`<>|]/g, "\\$&");

export function summarize(
	before: DatedEvent[],
	after: DatedEvent[],
	venueList: Venue[] = venues,
): string {
	const names = new Map(venueList.map((v) => [v.id, v.name]));
	const venueName = (id?: string) => (id ? (names.get(id) ?? id) : undefined);

	const oldIds = new Set(before.map((e) => e.id));
	const added = after.filter((e) => !oldIds.has(e.id));

	const oldVenues = new Set(before.map((e) => e.venueId));
	const newVenues = new Map<string, number>();
	for (const e of after) {
		if (e.venueId && !oldVenues.has(e.venueId)) {
			newVenues.set(e.venueId, (newVenues.get(e.venueId) ?? 0) + 1);
		}
	}

	const lines = ["## Scrape summary", ""];
	lines.push(
		`${added.length} new event${added.length === 1 ? "" : "s"}, ${after.length} listed in all.`,
		"",
	);

	if (newVenues.size) {
		lines.push(
			`### Venues with events for the first time (${newVenues.size})`,
			"",
		);
		for (const [id, count] of [...newVenues].sort(([a], [b]) =>
			(venueName(a) ?? a).localeCompare(venueName(b) ?? b),
		)) {
			lines.push(
				`- ${mdEscape(venueName(id) ?? id)}: ${count} event${count === 1 ? "" : "s"}`,
			);
		}
		lines.push("");
	}

	if (added.length) {
		lines.push(`### New events (${added.length})`, "");
		for (const e of added.slice(0, MAX_EVENTS)) {
			const { date, time } = seattleParts(e.startsAt);
			const day = DAY_FMT.format(new Date(`${date}T12:00:00Z`));
			const venue = venueName(e.venueId);
			lines.push(
				`- ${day} ${time}: [${mdEscape(e.title)}](${e.url})${venue ? ` at ${mdEscape(venue)}` : ""} _(${e.source})_`,
			);
		}
		if (added.length > MAX_EVENTS) {
			lines.push(`- …and ${added.length - MAX_EVENTS} more`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

async function main() {
	const base = process.argv[2] ?? "HEAD";
	const shown = Bun.spawnSync(["git", "show", `${base}:${FILE}`]);
	// No earlier version (e.g. a shallow clone without `base`) means everything is new.
	const before: DatedEvent[] = shown.success
		? JSON.parse(shown.stdout.toString()).events
		: [];
	const after: DatedEvent[] = (await Bun.file(FILE).json()).events;
	const summary = summarize(before, after);

	const out = process.env.GITHUB_STEP_SUMMARY;
	if (out) {
		const file = Bun.file(out);
		const existing = (await file.exists()) ? await file.text() : "";
		await Bun.write(out, `${existing}${summary}\n`);
	} else {
		console.log(summary);
	}
}

if (import.meta.main) await main();
