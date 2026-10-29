// Run every source and write data/events.generated.json.
// `bun run scrape` for all sources, `bun run scrape tractor` for one.
// A source that throws or unexpectedly returns nothing keeps its previous events and is reported:
// listed on stderr, as GitHub Actions annotations, and in the Markdown file at $SCRAPE_REPORT
// (the daily workflow turns that into a GitHub issue). Exits 1 if any source failed.
import type { DatedEvent } from "../../src/lib/types";
import { errorMessage } from "./source";
import { sources } from "./sources";

const OUT = "data/events.generated.json";
const HORIZON_DAYS = 90;

type EventsFile = { generatedAt: string | null; events: DatedEvent[] };

const previous: EventsFile = await Bun.file(OUT).json();
const only = process.argv[2];
const now = Date.now();
const horizon = now + HORIZON_DAYS * 24 * 60 * 60 * 1000;

const selected = sources.filter((s) => !only || s.id === only);
if (!selected.length) {
	console.error(
		`No source "${only}". Known: ${sources.map((s) => s.id).join(", ")}`,
	);
	process.exit(1);
}
const results = await Promise.allSettled(selected.map((s) => s.fetchEvents()));

const bySource = new Map<string, DatedEvent[]>();
for (const e of previous.events) {
	bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
}

const failures: { id: string; reason: string; kept: number }[] = [];
for (const [i, r] of results.entries()) {
	const source = selected[i];
	if (!source) continue;
	const reason =
		r.status === "rejected"
			? errorMessage(r.reason)
			: !r.value.length && !source.mayBeEmpty
				? "returned no events (the page layout may have changed)"
				: undefined;
	if (r.status === "rejected" || reason) {
		const kept = bySource.get(source.id)?.length ?? 0;
		failures.push({ id: source.id, reason: reason ?? "", kept });
		console.error(
			`✗ ${source.id}: ${reason} (keeping ${kept} previous events)`,
		);
		if (process.env.GITHUB_ACTIONS) {
			console.log(`::error title=Scraper ${source.id} failed::${reason}`);
		}
		continue;
	}
	const events = r.value.map((e) => ({
		...e,
		source: source.id,
		venueId: e.venueId ?? source.venueId,
		category: e.category ?? source.category,
	}));
	bySource.set(source.id, events);
	console.log(`✓ ${source.id}: ${events.length} events`);
}

// Neighborhood calendars repeat some venues' events; the source listed first in `sources` wins.
const seen = new Set<string>();
const events = sources
	.flatMap((s) => bySource.get(s.id) ?? [])
	.filter((e) => {
		const t = Date.parse(e.startsAt);
		if (Number.isNaN(t) || t < now - 12 * 60 * 60 * 1000 || t > horizon)
			return false;
		const slot = e.venueId ? `${e.venueId}@${t}` : undefined;
		if (seen.has(e.id) || (slot && seen.has(slot))) return false;
		seen.add(e.id);
		if (slot) seen.add(slot);
		return true;
	})
	.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

await Bun.write(
	OUT,
	`${JSON.stringify({ generatedAt: new Date().toISOString(), events }, null, "\t")}\n`,
);
console.log(`Wrote ${events.length} events to ${OUT}`);

if (process.env.SCRAPE_REPORT) {
	const lines = failures.map(
		(f) =>
			`- **${f.id}**: ${f.reason}. Kept ${f.kept} previous events. Re-run with \`bun run scrape ${f.id}\`.`,
	);
	await Bun.write(process.env.SCRAPE_REPORT, lines.join("\n"));
}
if (failures.length) {
	console.error(`${failures.length} of ${results.length} sources failed`);
	process.exit(1);
}
