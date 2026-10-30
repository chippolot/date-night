// Run every source and write data/events.generated.json.
// `bun run scrape` for all sources, `bun run scrape tractor` for one.
// A source that throws or unexpectedly returns nothing keeps its previous events and is reported:
// listed on stderr, as GitHub Actions annotations, and in the Markdown file at $SCRAPE_REPORT
// (the daily workflow turns that into a GitHub issue). Exits 1 if any source failed.
// A full run skips sources scraped successfully in the last FRESH_HOURS (pushes to main redeploy
// without re-hitting every site); SCRAPE_FORCE=1 or naming a source scrapes regardless.
import type { DatedEvent } from "../../src/lib/types";
import { errorMessage } from "./source";
import { sources } from "./sources";

const OUT = "data/events.generated.json";
const HORIZON_DAYS = 90;

const FRESH_HOURS = 20;

type EventsFile = {
	generatedAt: string | null;
	/** Source id → ISO time of its last successful scrape */
	scrapedAt?: Record<string, string>;
	events: DatedEvent[];
};

const previous: EventsFile = await Bun.file(OUT).json();
const only = process.argv[2];
const now = Date.now();
const horizon = now + HORIZON_DAYS * 24 * 60 * 60 * 1000;

const force =
	Boolean(only) || ["1", "true"].includes(process.env.SCRAPE_FORCE ?? "");
const scrapedAt: Record<string, string> = { ...previous.scrapedAt };
const isFresh = (id: string) =>
	now - Date.parse(scrapedAt[id] ?? "") < FRESH_HOURS * 60 * 60 * 1000;

const named = sources.filter((s) => !only || s.id === only);
if (!named.length) {
	console.error(
		`No source "${only}". Known: ${sources.map((s) => s.id).join(", ")}`,
	);
	process.exit(1);
}
const selected = force ? named : named.filter((s) => !isFresh(s.id));
for (const s of named) {
	if (!selected.includes(s)) {
		console.log(`↷ ${s.id}: scraped ${scrapedAt[s.id]}, skipping`);
	}
}
// A source that hangs counts as failed (keeping its previous events) instead of stalling the run.
const SOURCE_TIMEOUT_MS = 5 * 60_000;
const seconds = (since: number) =>
	`${((Date.now() - since) / 1000).toFixed(1)}s`;

// Log each source as it finishes, and every 30s which ones are still running, so a slow run
// shows where the time goes.
const runStart = Date.now();
const pending = new Set(selected.map((s) => s.id));
const heartbeat = setInterval(() => {
	console.log(`… ${seconds(runStart)}: waiting on ${[...pending].join(", ")}`);
}, 30_000);

async function run(source: (typeof selected)[number]) {
	const start = Date.now();
	let timer: Timer | undefined;
	try {
		const events = await Promise.race([
			source.fetchEvents(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(new Error(`timed out after ${SOURCE_TIMEOUT_MS / 1000}s`)),
					SOURCE_TIMEOUT_MS,
				);
			}),
		]);
		console.log(`· ${source.id}: ${events.length} events in ${seconds(start)}`);
		return events;
	} catch (err) {
		console.log(`· ${source.id}: failed after ${seconds(start)}`);
		throw err;
	} finally {
		clearTimeout(timer);
		pending.delete(source.id);
	}
}

const results = await Promise.allSettled(selected.map(run));
clearInterval(heartbeat);
console.log(`All sources finished in ${seconds(runStart)}`);

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
	scrapedAt[source.id] = new Date().toISOString();
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
	`${JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			// Only current sources, sorted, so the diff stays small.
			scrapedAt: Object.fromEntries(
				sources
					.map((s) => [s.id, scrapedAt[s.id]] as const)
					.filter(([, t]) => t)
					.sort(([a], [b]) => a.localeCompare(b)),
			),
			events,
		},
		null,
		"\t",
	)}\n`,
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
// A timed-out source may still have requests in flight; don't wait for them.
process.exit(0);
