// Read recent posts from venues' Instagram accounts through the official Graph API (Business Discovery)
// and write a review queue of captions that look like recurring nights to out/ig-leads.md.
// Leads are for hand verification only: this never writes to data/nights.ts (see CLAUDE.md).
// `bun run ig-leads` checks every venue with an `instagram` handle; `bun run ig-leads <venue-id>…` checks
// only those. Needs META_ACCESS_TOKEN and INSTAGRAM_USER_ID in .env (refresh with `bun run meta-token`).
// `--new` leaves out posts already reported and remembers the ones it reports in
// data/cache/ig-seen.json, which is how the weekly workflow (.github/workflows/ig-leads.yml) reports
// only what's new. Runs without `--new` leave that file alone.
// Exits 2 when the token is missing or rejected, so the workflow can say the token needs refreshing.
// The app shares a limit of about 200 calls per hour, so each account is asked for once (profile and
// posts in one call) and the run stops on "Application request limit reached".
import { nights } from "../data/nights";
import { venues } from "../data/venues";
import type { Night } from "../src/lib/types";

const GRAPH = "https://graph.facebook.com/v23.0";
const OUT = "out/ig-leads.md";
const SEEN = "data/cache/ig-seen.json";
/** Forget seen posts after this long; by then they've dropped out of the latest posts anyway. */
const SEEN_DAYS = 365;
const POSTS = 25;
/** Posts newer than this may back a `confirmed` night (CLAUDE.md) */
const RECENT_DAYS = 60;
/** Stop before the app's shared quota runs out */
const MAX_USAGE = 90;

const DAYS = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];
const DAY = `(?:${DAYS.map((d) => `${d.slice(0, 3)}(?:${d.slice(3)})?`).join("|")})`;
// "Wednesdays", "every Thu", "each Friday"
const WEEKLY = new RegExp(
	`\\b(?:(?:every|each)\\s+${DAY}\\b|(?:${DAYS.map((d) => d.slice(0, 3)).join("|")})\\w*days\\b)`,
	"gi",
);
// "1st & 3rd Monday", "last Sunday", "second Tuesday of the month"
const NTH = new RegExp(
	`\\b(?:(?:1st|2nd|3rd|4th|first|second|third|fourth|last)(?:\\s*(?:,|&|and)\\s*)?)+\\s+${DAY}s?\\b`,
	"gi",
);
// "7pm", "7:30", "6-9pm", "8 p.m."
const TIME =
	/\b(?:[01]?\d(?::[0-5]\d)?\s*[-–]\s*)?[01]?\d(?::[0-5]\d\s*(?:[ap]\.?m\.?)?|\s*[ap]\.?m\.?)(?![\w])/gi;
const KEYWORDS =
	/\b(trivia|karaoke|bingo|jazz|blues|bluegrass|open mic|happy hour|drag|comedy|dj|live music|vinyl|session|quiz|game night|tango|salsa|swing|line danc\w*|square danc\w*|burlesque|storytelling|poetry|pinball|music|industry night)\b/gi;

export type Lead = {
	/** Recurring patterns such as "Wednesdays" or "1st & 3rd Monday" */
	days: string[];
	times: string[];
	keywords: string[];
};

const uniq = (xs: string[]) => [
	...new Set(xs.map((x) => x.trim().replace(/\s+/g, " "))),
];

/**
 * A caption is a lead when it names a recurring day (not just "this Friday") and an activity.
 * Returns null when it doesn't.
 */
export function extractLeads(caption: string): Lead | null {
	const days = uniq([
		...(caption.match(WEEKLY) ?? []),
		...(caption.match(NTH) ?? []),
	]);
	const keywords = uniq(
		(caption.match(KEYWORDS) ?? []).map((k) => k.toLowerCase()),
	);
	if (!days.length || !keywords.length) return null;
	return { days, times: uniq(caption.match(TIME) ?? []), keywords };
}

type Media = {
	caption?: string;
	timestamp: string;
	permalink: string;
	media_type: string;
};
type Discovery = {
	username: string;
	biography?: string;
	website?: string;
	media?: { data: Media[] };
};
type GraphError = { message: string; code?: number; error_subcode?: number };

const daysAgo = (iso: string) =>
	Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

function describeNight(n: Night): string {
	const r = n.recurrence;
	const when =
		r.kind === "weekly" ? r.days.join("/") : `${r.nth.join("&")} ${r.day}`;
	return `${n.id} (${when} ${n.allDay ? "all day" : n.start}, ${n.confidence})`;
}

async function main() {
	const token = process.env.META_ACCESS_TOKEN;
	const igUserId = process.env.INSTAGRAM_USER_ID;
	if (!token || !igUserId) {
		console.error(
			"Needs META_ACCESS_TOKEN and INSTAGRAM_USER_ID in .env (refresh the token with `bun run meta-token`).",
		);
		process.exit(2);
	}

	const args = process.argv.slice(2);
	const onlyNew = args.includes("--new");
	const wanted = args.filter((a) => !a.startsWith("--"));
	const unknown = wanted.filter((id) => !venues.some((v) => v.id === id));
	if (unknown.length) {
		console.error(`Unknown venue ids: ${unknown.join(", ")}`);
		process.exit(1);
	}
	const targets = venues.filter(
		(v) => v.instagram && (!wanted.length || wanted.includes(v.id)),
	);
	if (!targets.length) {
		console.error("None of those venues has an instagram handle.");
		process.exit(1);
	}

	// Venues named in the "Known but left out" comment at the top of nights.ts
	const header =
		(await Bun.file("data/nights.ts").text()).split("export const")[0] ?? "";

	// Permalinks (and "bio:<handle>" for bios) → the date first reported
	const seen: Record<string, string> = (await Bun.file(SEEN).exists())
		? await Bun.file(SEEN).json()
		: {};
	const today = new Date().toISOString().slice(0, 10);
	const reported: string[] = [];

	const sections: string[] = [];
	const problems: string[] = [];
	let leadCount = 0;
	let reached = 0;
	let stopped: string | undefined;

	for (const venue of targets) {
		const handle = venue.instagram as string;
		const fields = `business_discovery.username(${handle}){username,biography,website,media.limit(${POSTS}){caption,timestamp,permalink,media_type}}`;
		const url = new URL(`${GRAPH}/${igUserId}`);
		url.search = new URLSearchParams({
			fields,
			access_token: token,
		}).toString();

		const res = await fetch(url);
		reached++;
		const body = (await res.json()) as {
			business_discovery?: Discovery;
			error?: GraphError;
		};

		if (body.error) {
			const { message, code } = body.error;
			if (code === 190) {
				console.error(
					`Token rejected (${message}). Run \`bun run meta-token\` with a fresh token.`,
				);
				process.exit(2);
			}
			if (
				[4, 17, 32].includes(code ?? 0) ||
				/request limit reached/i.test(message)
			) {
				stopped = message;
				reached--;
				break;
			}
			// Usually a personal account or a wrong handle: worth fixing in venues.ts, not fatal
			problems.push(`- ${venue.id} (@${handle}): ${message}`);
			continue;
		}

		const account = body.business_discovery;
		const posts = account?.media?.data ?? [];
		const leads = posts.flatMap((p) => {
			const lead = p.caption ? extractLeads(p.caption) : null;
			if (!lead || (onlyNew && seen[p.permalink])) return [];
			return [{ post: p, lead, isNew: !seen[p.permalink] }];
		});
		// A bio counts as new when its text changed since it was last reported
		const bioKey = `bio:${handle}:${Bun.hash(account?.biography ?? "")}`;
		const bioLead =
			account?.biography && !(onlyNew && seen[bioKey])
				? extractLeads(account.biography)
				: null;
		reported.push(...leads.map((l) => l.post.permalink));
		if (bioLead) reported.push(bioKey);

		if (leads.length || bioLead) {
			leadCount += leads.length;
			const existing = nights.filter((n) => n.venueId === venue.id);
			const lines = [
				`## ${venue.name} ([@${handle}](https://www.instagram.com/${handle}/))`,
				"",
				`- Existing nights: ${existing.length ? existing.map(describeNight).join("; ") : "none"}`,
			];
			if (header.includes(venue.name))
				lines.push(`- Named in the "left out" comment in nights.ts`);
			if (bioLead)
				lines.push(
					`- Bio: ${account?.biography?.replace(/\s+/g, " ")} (days: ${bioLead.days.join(", ")}; times: ${bioLead.times.join(", ") || "none"})`,
				);
			for (const { post, lead, isNew } of leads) {
				const age = daysAgo(post.timestamp);
				const excerpt = (post.caption ?? "").replace(/\s+/g, " ").slice(0, 280);
				lines.push(
					"",
					`### ${isNew ? "New: " : ""}${post.timestamp.slice(0, 10)} (${age} days ago${age < RECENT_DAYS ? ", recent enough for `confirmed`" : ""})`,
					"",
					`- ${post.permalink}`,
					`- Days: ${lead.days.join(", ")}; times: ${lead.times.join(", ") || "none"}; about: ${lead.keywords.join(", ")}`,
					`- > ${excerpt}`,
				);
			}
			sections.push(lines.join("\n"));
		}

		// {"call_count":…, "total_time":…, "total_cputime":…} as percentages of the app's quota
		const usage = res.headers.get("x-app-usage");
		if (usage) {
			const pct = Math.max(
				...Object.values(JSON.parse(usage) as Record<string, number>),
			);
			if (pct >= MAX_USAGE) {
				stopped = `app usage at ${pct}% of the hourly quota`;
				break;
			}
		}
	}

	const notReached = targets.slice(reached).map((v) => v.id);
	const report = [
		`# Instagram leads (${new Date().toISOString().slice(0, 10)})`,
		"",
		"Leads for hand verification only. Never copy them into nights.ts without checking.",
		"",
		...(stopped
			? [
					`**Stopped early: ${stopped}.** Not reached: ${notReached.join(", ")}`,
					"",
				]
			: []),
		...(problems.length
			? ["## Accounts that failed", "", ...problems, ""]
			: []),
		...sections.flatMap((s) => [s, ""]),
	].join("\n");
	await Bun.write(OUT, report);

	// Only `--new` runs (the weekly workflow, which commits the file) remember what they reported, so
	// a local look at some venues doesn't leave the checkout modified or hide leads from the issue.
	if (onlyNew) {
		for (const key of reported) seen[key] ??= today;
		const cutoff = new Date(Date.now() - SEEN_DAYS * 86_400_000)
			.toISOString()
			.slice(0, 10);
		const kept = Object.fromEntries(
			Object.entries(seen)
				.filter(([, date]) => date >= cutoff)
				.sort(([a], [b]) => a.localeCompare(b)),
		);
		await Bun.write(SEEN, `${JSON.stringify(kept, null, "\t")}\n`);
	}

	console.log(
		`${reached} of ${targets.length} accounts checked, ${leadCount} ${onlyNew ? "new " : ""}leads at ${sections.length} venues, ${problems.length} failed → ${OUT}`,
	);
	if (stopped) {
		console.error(
			`Stopped early: ${stopped}. Not reached: ${notReached.join(", ")}`,
		);
		process.exit(1);
	}
}

if (import.meta.main) await main();
