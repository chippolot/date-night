import type { Occurrence, Venue } from "./types";
import { ADJACENT } from "./types";

export type Pick = {
	/** Dinner or drinks: a tonight special, or just a restaurant nearby */
	food: { occurrence?: Occurrence; venue: Venue };
	activity?: Occurrence;
};

const FOOD_TAGS = ["restaurant", "wine-bar"];

function isFood(o: Occurrence, venue: Venue | undefined): boolean {
	return (
		o.category === "food-drink-special" ||
		(!!venue &&
			venue.tags.some((t) => FOOD_TAGS.includes(t)) &&
			o.category !== "trivia")
	);
}

/**
 * Pair one dinner/drinks spot with one activity tonight, keeping them in the
 * same or an adjacent neighborhood. `random` is injectable for tests.
 */
export function surprise(
	tonight: Occurrence[],
	venues: Venue[],
	random: () => number = Math.random,
): Pick | null {
	const venueById = new Map(venues.map((v) => [v.id, v]));
	const venueOf = (o: Occurrence) =>
		o.venueId ? venueById.get(o.venueId) : undefined;
	const choose = <T>(xs: T[]): T | undefined =>
		xs[Math.floor(random() * xs.length)];
	const shuffle = <T>(xs: T[]): T[] => {
		const out = [...xs];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[out[i], out[j]] = [out[j] as T, out[i] as T];
		}
		return out;
	};

	const activities = tonight.filter(
		(o) => o.category !== "food-drink-special" && venueOf(o),
	);
	// Try every activity in random order; with none at all, still suggest dinner.
	for (const activity of [...shuffle(activities), undefined]) {
		const activityVenue = activity && venueOf(activity);
		const near = (v: Venue) =>
			!activityVenue ||
			v.neighborhood === activityVenue.neighborhood ||
			ADJACENT[activityVenue.neighborhood].includes(v.neighborhood);

		// Prefer a food special that happens before the activity starts.
		const special = choose(
			tonight.filter((o) => {
				const v = venueOf(o);
				return (
					o !== activity &&
					v &&
					isFood(o, v) &&
					near(v) &&
					(!activity || o.start <= activity.start)
				);
			}),
		);
		if (special) {
			return {
				food: { occurrence: special, venue: venueOf(special) as Venue },
				activity,
			};
		}
		// Otherwise any nearby restaurant, including the activity's own venue (dinner + dancing).
		const restaurant = choose(
			venues.filter((v) => v.tags.includes("restaurant") && near(v)),
		);
		if (restaurant) return { food: { venue: restaurant }, activity };
	}
	return null;
}
