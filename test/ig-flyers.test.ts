import { describe, expect, test } from "bun:test";
import { calendar, postedDate } from "../scripts/ig-flyers";
import { scorePost } from "../scripts/ig-flyers-eval";
import { flyerEvents, imageUrls, postsToRead } from "../scripts/ig-flyers-scan";

describe("ig flyers", () => {
	test("dates posts in Seattle time", () => {
		// 03:30 UTC on Sep 7 is the evening of Sep 6 in Seattle.
		expect(postedDate("2026-09-07T03:30:00+0000")).toBe("2026-09-06");
		expect(postedDate("2026-10-27T18:02:11+0000")).toBe("2026-10-27");
	});

	test("lists weekdays around the posting date", () => {
		const days = calendar("2026-10-27");
		expect(days[7]).toBe("Tue 2026-10-27");
		expect(days[0]).toBe("Tue 2026-10-20");
		expect(days).toHaveLength(42);
	});

	test("reads only unseen, recent posts, and a carousel's first images", () => {
		const post = (id: string, timestamp: string) => ({
			id,
			timestamp,
			permalink: `https://www.instagram.com/p/${id}/`,
			media_type: "IMAGE",
			media_url: `https://cdn/${id}.jpg`,
		});
		const cache = {
			seen: {
				venueId: "roam",
				permalink: "https://www.instagram.com/p/seen/",
				posted: "2026-10-20",
				read: "2026-10-21",
			},
		};
		expect(
			postsToRead(
				[
					post("seen", "2026-10-20T20:00:00+0000"),
					post("new", "2026-10-28T20:00:00+0000"),
					post("old", "2026-07-01T20:00:00+0000"),
				],
				cache,
				"2026-09-01",
			).map((p) => p.id),
		).toEqual(["new"]);
		expect(
			imageUrls({
				...post("c", "2026-10-28T20:00:00+0000"),
				media_type: "CAROUSEL_ALBUM",
				children: {
					data: [
						{ media_type: "IMAGE", media_url: "https://cdn/1.jpg" },
						{ media_type: "VIDEO", thumbnail_url: "https://cdn/2.jpg" },
						{ media_type: "IMAGE", media_url: "https://cdn/3.jpg" },
						{ media_type: "IMAGE", media_url: "https://cdn/4.jpg" },
					],
				},
			}),
		).toEqual(["https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg"]);
	});

	test("turns read posts into upcoming, timed, date-night events", () => {
		const event = (
			title: string,
			date: string,
			start: string | null,
			end: string | null = null,
		) => ({ title, date, start, end, price: null as string | null });
		const post = (
			id: string,
			posted: string,
			events: ReturnType<typeof event>[],
		) => ({
			venueId: "roam",
			permalink: `https://www.instagram.com/p/${id}/`,
			posted,
			read: posted,
			events,
		});
		const cache = {
			lineup: post("lineup", "2026-10-26", [
				event("Halloween", "2026-10-31", null),
				event("Open Roam", "2026-10-28", "16:00", "00:00"),
			]),
			flyer: post("flyer", "2026-10-20", [
				event("Halloween", "2026-10-31", "21:00", "02:00"),
			]),
			again: post("again", "2026-10-27", [
				event("Halloween at Roam", "2026-10-31", "21:00"),
			]),
			other: post("other", "2026-10-25", [
				event("Seahawks watch party", "2026-11-01", "13:00"),
				event("Momo Express (food truck)", "2026-11-01", "12:00"),
				event("Last week", "2026-10-21", "20:00"),
				event("Next year", "2027-06-01", "20:00"),
				{
					...event("Winter Wonderland", "2026-12-05", "11:00"),
					price: "$50 per family",
				},
			]),
		};
		const events = flyerEvents(cache, ["roam"], "2026-10-28", "2027-01-26");
		expect(events).toEqual([
			{
				id: "instagram-2026-10-31T21:00-halloween-at-roam",
				venueId: "roam",
				title: "Halloween at Roam",
				startsAt: "2026-10-31T21:00:00-07:00",
				url: "https://www.instagram.com/p/again/",
				category: "misc",
			},
			{
				id: "instagram-2026-10-28T16:00-open-roam",
				venueId: "roam",
				title: "Open Roam",
				startsAt: "2026-10-28T16:00:00-07:00",
				endsAt: "2026-10-29T00:00:00-07:00",
				url: "https://www.instagram.com/p/lineup/",
				category: "misc",
			},
		]);
		expect(
			flyerEvents(cache, ["other-bar"], "2026-10-28", "2027-01-26"),
		).toEqual([]);
	});

	test("scores events by date and title, and flags wrong times", () => {
		const event = (title: string, date: string, start: string | null) => ({
			title,
			date,
			start,
			end: null,
			price: null,
		});
		const s = scorePost(
			[
				{ title: "Open Roam", date: "2026-10-28", start: ["16:00", null] },
				{ title: "Noisy Radio", date: "2026-10-29", start: "21:00" },
				{ title: "Halloween", date: "2026-10-31", start: null },
				{ title: "LSD Union", date: "2026-11-01", start: null },
				{ title: "Bonus", date: "2026-11-02", start: null, optional: true },
			],
			[
				event("Open Roam (open decks)", "2026-10-28", "16:00"),
				event("Takeover Thursdays", "2026-10-29", "20:00"),
				event("Halloween at Roam", "2026-10-31", null),
				event(".WAV boat party", "2026-11-07", "16:30"),
			],
		);
		expect(s).toMatchObject({
			expected: 4,
			found: 3,
			extra: 1,
			extraTimed: 1,
			startRight: 2,
			startWrong: 1,
			startMissing: 0,
		});
		expect(s.problems).toContain("missed 2026-11-01 LSD Union");
	});
});
