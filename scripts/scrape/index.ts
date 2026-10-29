// Run every source and write data/events.generated.json.
// `bun run scrape` for all sources, `bun run scrape tractor` for one.
import type { DatedEvent } from "../../src/lib/types";
import { sources } from "./sources";

const OUT = "data/events.generated.json";
const HORIZON_DAYS = 90;

type EventsFile = { generatedAt: string | null; events: DatedEvent[] };

const previous: EventsFile = await Bun.file(OUT).json();
const only = process.argv[2];
const now = Date.now();
const horizon = now + HORIZON_DAYS * 24 * 60 * 60 * 1000;

const selected = sources.filter((s) => !only || s.id === only);
const results = await Promise.allSettled(selected.map((s) => s.fetchEvents()));

const bySource = new Map<string, DatedEvent[]>();
for (const e of previous.events) {
	bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
}

let failed = 0;
for (const [i, r] of results.entries()) {
	const source = selected[i];
	if (!source) continue;
	if (r.status === "rejected") {
		failed++;
		console.error(
			`✗ ${source.id}: ${r.reason instanceof Error ? r.reason.message : r.reason} (keeping previous events)`,
		);
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

const seen = new Set<string>();
const events = [...bySource.values()]
	.flat()
	.filter((e) => {
		const t = Date.parse(e.startsAt);
		if (Number.isNaN(t) || t < now - 12 * 60 * 60 * 1000 || t > horizon)
			return false;
		if (seen.has(e.id)) return false;
		seen.add(e.id);
		return true;
	})
	.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

await Bun.write(
	OUT,
	`${JSON.stringify({ generatedAt: new Date().toISOString(), events }, null, "\t")}\n`,
);
console.log(`Wrote ${events.length} events to ${OUT}`);
if (failed && failed === results.length) process.exit(1);
