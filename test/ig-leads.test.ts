import { describe, expect, test } from "bun:test";
import { extractLeads } from "../scripts/ig-leads";

describe("extractLeads", () => {
	test("weekday plurals with a time", () => {
		const lead = extractLeads("Trivia Wednesdays at 7pm! Teams up to 6.");
		expect(lead?.days).toEqual(["Wednesdays"]);
		expect(lead?.times).toEqual(["7pm"]);
		expect(lead?.keywords).toEqual(["trivia"]);
	});

	test("every <day> and time ranges", () => {
		const lead = extractLeads("Happy hour every Thu 4-6pm and live music 8:30");
		expect(lead?.days).toEqual(["every Thu"]);
		expect(lead?.times).toEqual(["4-6pm", "8:30"]);
		expect(lead?.keywords).toEqual(["happy hour", "live music"]);
	});

	test("nth weekday of the month", () => {
		const lead = extractLeads("Drag bingo on the 1st & 3rd Monday, 7:30 p.m.");
		expect(lead?.days).toEqual(["1st & 3rd Monday"]);
		expect(lead?.times).toEqual(["7:30 p.m."]);
		expect(lead?.keywords).toEqual(["drag", "bingo"]);

		expect(
			extractLeads("Karaoke the last Sunday of every month")?.days,
		).toEqual(["last Sunday"]);
	});

	test("one-off dates are not leads", () => {
		expect(extractLeads("Live music this Friday! Come hang.")).toBeNull();
		expect(extractLeads("Trivia on Friday, October 31")).toBeNull();
	});

	test("a recurring day with no activity is not a lead", () => {
		expect(extractLeads("Open Tuesdays through Sundays, 3pm")).toBeNull();
	});
});
