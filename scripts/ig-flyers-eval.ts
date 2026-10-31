// Score readFlyer (scripts/ig-flyers.ts) against hand labels, to pick a model and see how often it
// gets dates and times wrong. `bun scripts/ig-flyers-eval.ts [haiku] [sonnet] [--effort low|medium|high]`
// Posts and images come from out/ig-flyers/<account>-posts.json and out/ig-flyers/images/ (fetched
// once with the Graph API; Instagram's image URLs expire). Labels: scripts/ig-flyers-labels/<account>.json.
// Writes a report to out/ig-flyers/eval.md.
import Anthropic from "@anthropic-ai/sdk";
import {
	cost,
	type FlyerResult,
	MODELS,
	type ModelName,
	readFlyer,
} from "./ig-flyers";

type OneOrMany<T> = T | T[];

export type LabeledEvent = {
	title: string;
	date: OneOrMany<string>;
	start: OneOrMany<string | null>;
	optional?: boolean;
};

export type LabeledPost = {
	post: string;
	events: LabeledEvent[];
	skip?: string;
};

type Labels = {
	account: string;
	venue: string;
	address: string;
	posts: LabeledPost[];
};

type SavedPost = {
	permalink: string;
	timestamp: string;
	caption: string;
	images: string[];
};

export type Score = {
	expected: number;
	found: number;
	extra: number;
	/** Found events whose start is one of the accepted answers */
	startRight: number;
	/** Found events given a time the labels don't accept: the costly mistake */
	startWrong: number;
	/** Found events left without a time the post gives */
	startMissing: number;
	/** Extra events that came with a time, which would show on the site */
	extraTimed: number;
	problems: string[];
};

const EMPTY: Score = {
	expected: 0,
	found: 0,
	extra: 0,
	startRight: 0,
	startWrong: 0,
	startMissing: 0,
	extraTimed: 0,
	problems: [],
};

const many = <T>(x: OneOrMany<T>): T[] => (Array.isArray(x) ? x : [x]);

const words = (s: string) =>
	new Set(
		s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.split(" ")
			.filter((w) => w.length > 1 && w !== "the"),
	);

function overlap(a: string, b: string): number {
	const x = words(a);
	const y = words(b);
	const shared = [...x].filter((w) => y.has(w)).length;
	return shared / Math.max(1, Math.min(x.size, y.size));
}

/** Match predicted events to labeled ones by date, then by title, and count what's right. */
export function scorePost(
	labeled: LabeledEvent[],
	predicted: FlyerResult["events"],
): Score {
	const s: Score = {
		...EMPTY,
		expected: labeled.filter((e) => !e.optional).length,
		problems: [],
	};
	const unused = new Set(predicted.map((_, i) => i));
	for (const want of labeled) {
		const dates = many(want.date);
		const candidates = [...unused].filter((i) =>
			dates.includes(predicted[i]?.date ?? ""),
		);
		const best = candidates
			.map((i) => ({ i, o: overlap(want.title, predicted[i]?.title ?? "") }))
			.sort((a, b) => b.o - a.o)[0];
		// Same date and some shared word, or the only event on that date
		const hit =
			best && (best.o > 0 || candidates.length === 1) ? best.i : undefined;
		if (hit === undefined) {
			if (!want.optional) {
				s.problems.push(`missed ${dates[0]} ${want.title}`);
			}
			continue;
		}
		unused.delete(hit);
		const got = predicted[hit];
		if (!got || want.optional) continue;
		s.found++;
		const starts = many(want.start);
		if (starts.includes(got.start)) s.startRight++;
		else if (got.start === null) {
			s.startMissing++;
			s.problems.push(
				`no time for ${got.date} ${got.title} (want ${starts[0]})`,
			);
		} else {
			s.startWrong++;
			s.problems.push(
				`wrong time ${got.date} ${got.title}: ${got.start} (want ${starts.join(" or ")})`,
			);
		}
	}
	for (const i of unused) {
		const e = predicted[i];
		if (!e) continue;
		s.extra++;
		if (e.start) s.extraTimed++;
		s.problems.push(`extra ${e.date} ${e.start ?? "--:--"} ${e.title}`);
	}
	return s;
}

function addScores(a: Score, b: Score): Score {
	return {
		expected: a.expected + b.expected,
		found: a.found + b.found,
		extra: a.extra + b.extra,
		startRight: a.startRight + b.startRight,
		startWrong: a.startWrong + b.startWrong,
		startMissing: a.startMissing + b.startMissing,
		extraTimed: a.extraTimed + b.extraTimed,
		problems: [],
	};
}

const shortcode = (permalink: string) =>
	permalink.match(/\/(?:p|reel)\/([^/]+)/)?.[1] ?? permalink;

/** Run `fn` over `items`, at most `limit` at a time. */
async function pool<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: limit }, async () => {
			while (next < items.length) {
				const i = next++;
				out[i] = await fn(items[i] as T);
			}
		}),
	);
	return out;
}

async function main() {
	const args = process.argv.slice(2);
	const effortAt = args.indexOf("--effort");
	const effort = (effortAt >= 0 ? args[effortAt + 1] : "low") as
		| "low"
		| "medium"
		| "high";
	const models = args.filter((a): a is ModelName => a in MODELS) as ModelName[];
	if (models.length === 0) models.push("haiku", "sonnet");
	const account = "roam";

	const labels: Labels = await Bun.file(
		`scripts/ig-flyers-labels/${account}.json`,
	).json();
	const saved: SavedPost[] = await Bun.file(
		`out/ig-flyers/${account}-posts.json`,
	).json();
	const byCode = new Map(saved.map((p) => [shortcode(p.permalink), p]));
	const client = new Anthropic();
	const report: string[] = [
		`# Flyer reading eval: @${labels.account} (effort ${effort})`,
		"",
	];

	for (const model of models) {
		let total = EMPTY;
		let inputTokens = 0;
		let outputTokens = 0;
		let refusals = 0;
		const details: string[] = [];
		const results = await pool(labels.posts, 4, async (label) => {
			const post = byCode.get(label.post);
			if (!post) throw new Error(`No saved post ${label.post}`);
			const images = await Promise.all(
				post.images.map(async (f) => ({
					data: new Uint8Array(
						await Bun.file(`out/ig-flyers/images/${f}`).arrayBuffer(),
					),
					mediaType: "image/jpeg" as const,
				})),
			);
			const read = await readFlyer(
				client,
				model,
				{ name: labels.venue, address: labels.address },
				{ ...post, images },
				effort,
			);
			process.stdout.write(".");
			return { label, post, read };
		});
		console.log();
		await Bun.write(
			`out/ig-flyers/eval-${model}.json`,
			JSON.stringify(
				results.map(({ label, read }) => ({ post: label.post, ...read })),
				null,
				"\t",
			),
		);
		for (const { label, post, read } of results) {
			inputTokens += read.inputTokens;
			outputTokens += read.outputTokens;
			if (read.refused) refusals++;
			if (label.skip) continue;
			const s = scorePost(label.events, read.result.events);
			total = addScores(total, s);
			if (s.problems.length) {
				details.push(`- [${label.post}](${post.permalink})`);
				for (const p of s.problems) details.push(`  - ${p}`);
			}
		}
		const dollars = cost(model, inputTokens, outputTokens);
		const posts = labels.posts.length;
		const summary = [
			`## ${model} (${MODELS[model]})`,
			"",
			`- Events found: ${total.found} of ${total.expected}; extra events: ${total.extra} (${total.extraTimed} with a time)`,
			`- Start times right: ${total.startRight}; wrong: ${total.startWrong}; left blank: ${total.startMissing}`,
			`- Tokens: ${inputTokens} in, ${outputTokens} out over ${posts} posts (${Math.round(inputTokens / posts)} / ${Math.round(outputTokens / posts)} per post)`,
			`- Cost: $${dollars.toFixed(4)} ($${(dollars / posts).toFixed(5)} per post)${refusals ? `; refusals: ${refusals}` : ""}`,
			"",
			...details,
			"",
		];
		console.log(summary.slice(0, 6).join("\n"));
		report.push(...summary);
	}
	await Bun.write("out/ig-flyers/eval.md", report.join("\n"));
	console.log("→ out/ig-flyers/eval.md");
}

if (import.meta.main) await main();
