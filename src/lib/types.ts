export const NEIGHBORHOODS = {
	ballard: "Ballard",
	fremont: "Fremont",
	"sunset-hill": "Sunset Hill",
	"phinney-ridge": "Phinney Ridge",
	greenwood: "Greenwood",
	"crown-hill": "Crown Hill",
	"green-lake": "Green Lake",
	wallingford: "Wallingford",
} as const;
export type Neighborhood = keyof typeof NEIGHBORHOODS;

/** Neighborhoods close enough to walk or take a short ride between in one evening. */
export const ADJACENT: Record<Neighborhood, Neighborhood[]> = {
	ballard: ["sunset-hill", "fremont", "phinney-ridge", "crown-hill"],
	fremont: ["ballard", "wallingford", "phinney-ridge"],
	"sunset-hill": ["ballard", "crown-hill"],
	"phinney-ridge": ["greenwood", "fremont", "green-lake", "ballard"],
	greenwood: ["phinney-ridge", "crown-hill", "green-lake"],
	"crown-hill": ["ballard", "greenwood", "sunset-hill"],
	"green-lake": ["wallingford", "phinney-ridge", "greenwood"],
	wallingford: ["fremont", "green-lake"],
};

export const CATEGORIES = {
	"live-music": "Live music",
	jazz: "Jazz",
	trivia: "Trivia & games",
	"food-drink-special": "Food & drink special",
	dance: "Dancing",
	comedy: "Comedy, stories & books",
	karaoke: "Karaoke",
	art: "Art walk",
	market: "Market",
	"open-mic": "Open mic",
	class: "Classes & workshops",
	theater: "Theater & film",
} as const;
export type Category = keyof typeof CATEGORIES;

export const CATEGORY_ICONS: Record<Category, string> = {
	"live-music": "🎸",
	jazz: "🎷",
	trivia: "🧠",
	"food-drink-special": "🍷",
	dance: "💃",
	comedy: "🎙️",
	karaoke: "🎤",
	art: "🎨",
	market: "🧺",
	"open-mic": "🎶",
	class: "🧶",
	theater: "🎭",
};

export const VIBES = ["romantic", "lively", "low-key", "active"] as const;
export type Vibe = (typeof VIBES)[number];

/** Default vibes for scraped events, which carry no curated vibe. */
export const CATEGORY_VIBES: Record<Category, Vibe[]> = {
	"live-music": ["lively"],
	jazz: ["romantic", "low-key"],
	trivia: ["lively"],
	"food-drink-special": ["low-key"],
	dance: ["active", "lively"],
	comedy: ["lively"],
	karaoke: ["lively"],
	art: ["low-key"],
	market: ["low-key"],
	"open-mic": ["low-key"],
	class: ["romantic", "active"],
	theater: ["romantic", "low-key"],
};

export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";
export const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export type PriceLevel = 1 | 2 | 3;

export type Venue = {
	id: string;
	name: string;
	neighborhood: Neighborhood;
	address: string;
	lat: number;
	lng: number;
	url: string;
	instagram?: string;
	priceLevel: PriceLevel;
	/** e.g. "restaurant", "bar", "music-venue", "brewery", "outdoor" */
	tags: string[];
};

/** -1 means the last occurrence in the month. */
export type Nth = 1 | 2 | 3 | 4 | 5 | -1;

export type Recurrence =
	| { kind: "weekly"; days: Weekday[]; months?: number[] }
	| { kind: "monthly-nth"; nth: Nth[]; day: Weekday; months?: number[] };

export type Confidence = "confirmed" | "likely" | "stale";

export type Night = {
	id: string;
	venueId: string;
	title: string;
	category: Category;
	recurrence: Recurrence;
	/** 24h "HH:MM", Seattle local time */
	start: string;
	end?: string;
	cost?: string;
	description: string;
	vibe: Vibe[];
	sourceUrl: string;
	/** ISO date the details were last checked against a primary source */
	lastVerified: string;
	confidence: Confidence;
};

export type DatedEvent = {
	id: string;
	venueId?: string;
	title: string;
	/** ISO datetime with offset */
	startsAt: string;
	endsAt?: string;
	url: string;
	source: string;
	price?: string;
	category?: Category;
};

/** A concrete thing happening on a specific date, from either a Night or a DatedEvent. */
export type Occurrence = {
	key: string;
	kind: "night" | "event";
	refId: string;
	date: string; // YYYY-MM-DD local
	start: string; // HH:MM local
	end?: string;
	title: string;
	venueId?: string;
	category: Category;
	vibe: Vibe[];
	cost?: string;
	url: string;
	confidence: Confidence;
	lastVerified?: string;
};
