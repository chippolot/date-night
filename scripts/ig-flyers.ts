// Read event details from an Instagram post's flyer images and caption with Claude. Venues such as
// Roam put the date and time on the flyer, not in the caption, so ig-leads' caption patterns miss
// them. What this returns is a lead for hand verification (see CLAUDE.md), not a scraped event.
// Needs ANTHROPIC_API_KEY in .env.
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const MODELS = {
	haiku: "claude-haiku-5-5",
	sonnet: "claude-sonnet-5-5",
} as const;
export type ModelName = keyof typeof MODELS;

/** US dollars per million input and output tokens */
export const PRICES: Record<ModelName, { input: number; output: number }> = {
	haiku: { input: 0.1, output: 0.5 },
	sonnet: { input: 2, output: 10 },
};

const DAY = z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

export const FlyerResult = z.object({
	events: z.array(
		z.object({
			title: z.string(),
			date: z.string().describe("YYYY-MM-DD"),
			start: z
				.string()
				.nullable()
				.describe(
					"24-hour HH:MM, Seattle time; null unless the post states it",
				),
			end: z.string().nullable().describe("24-hour HH:MM, or null"),
			price: z.string().nullable().describe('As stated, e.g. "$25" or "Free"'),
		}),
	),
	recurring: z.array(
		z.object({
			title: z.string(),
			days: z.array(DAY),
			start: z.string().nullable(),
			end: z.string().nullable(),
		}),
	),
});
export type FlyerResult = z.infer<typeof FlyerResult>;

export type Post = {
	permalink: string;
	/** Graph API timestamp, e.g. "2026-10-27T18:02:11+0000" */
	timestamp: string;
	caption: string;
	images: { data: Uint8Array; mediaType: "image/jpeg" | "image/png" }[];
};

export type FlyerRead = {
	result: FlyerResult;
	inputTokens: number;
	outputTokens: number;
	refused: boolean;
};

const SYSTEM = `You read event announcements that a bar posts on Instagram and pull out the events it hosts.

Rules:
- Only events at the venue named below. Leave out events elsewhere (a boat party, another bar), even when the venue promotes them.
- One entry per event per date. A weekly lineup ("this week at…") gives one event for each night listed.
- Dates: work out the full date from the flyer, the caption and the posting date. Use the calendar given to match weekdays to dates. When a flyer's printed date contradicts its weekday or the rest of the post, prefer what the post as a whole makes clear.
- start: the time doors open or the event begins, as stated on the flyer or in the caption, as 24-hour HH:MM. If the post states no time for that event, use null. Never guess a time. Set times for individual DJs are not the start unless they are the earliest time given. A time stated for a night elsewhere in the same post (for example "every Wednesday 4pm" beside a lineup) applies to that night.
- An event that starts after midnight belongs to the date printed for it ("8/2 2:30am" is 2026-08-02 02:30).
- recurring: nights the post describes as repeating ("every Wednesday", "Thursdays 8pm"), in addition to any dated entries.
- Recaps of past nights, memes, menus and notices are not events: return empty lists for them.`;

const WEEKDAY = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	weekday: "short",
});

/** Seattle local date ("YYYY-MM-DD") of a Graph API timestamp. */
export function postedDate(timestamp: string): string {
	const iso = timestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Los_Angeles",
	}).format(new Date(iso));
}

/** Weekdays from a week before `date` to five weeks after, e.g. "Tue 2026-10-27". */
export function calendar(date: string): string[] {
	const start = Date.parse(`${date}T12:00:00Z`);
	return Array.from({ length: 42 }, (_, i) => {
		const d = new Date(start + (i - 7) * 86_400_000);
		return `${WEEKDAY.format(d)} ${d.toISOString().slice(0, 10)}`;
	});
}

export async function readFlyer(
	client: Anthropic,
	model: ModelName,
	venue: { name: string; address: string },
	post: Post,
	effort: "low" | "medium" | "high" = "low",
): Promise<FlyerRead> {
	const posted = postedDate(post.timestamp);
	const text = [
		`Venue: ${venue.name}, ${venue.address}`,
		`Posted: ${calendar(posted)[7]}`,
		`Calendar: ${calendar(posted).join(", ")}`,
		`Caption:\n${post.caption || "(none)"}`,
	].join("\n\n");
	const response = await client.messages.parse({
		model: MODELS[model],
		max_tokens: 16000,
		system: SYSTEM,
		output_config: { effort, format: zodOutputFormat(FlyerResult) },
		messages: [
			{
				role: "user",
				content: [
					...post.images.map((img) => ({
						type: "image" as const,
						source: {
							type: "base64" as const,
							media_type: img.mediaType,
							data: Buffer.from(img.data).toString("base64"),
						},
					})),
					{ type: "text" as const, text },
				],
			},
		],
	});
	const refused = response.stop_reason === "refusal";
	return {
		result: response.parsed_output ?? { events: [], recurring: [] },
		inputTokens: response.usage.input_tokens,
		outputTokens: response.usage.output_tokens,
		refused,
	};
}

export function cost(
	model: ModelName,
	inputTokens: number,
	outputTokens: number,
): number {
	const p = PRICES[model];
	return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
