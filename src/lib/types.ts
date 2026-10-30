export const NEIGHBORHOODS = {
	ballard: "Ballard",
	fremont: "Fremont",
	"sunset-hill": "Sunset Hill",
	"phinney-ridge": "Phinney Ridge",
	greenwood: "Greenwood",
	"crown-hill": "Crown Hill",
	"green-lake": "Green Lake",
	wallingford: "Wallingford",
	"university-district": "U District",
	roosevelt: "Roosevelt",
	ravenna: "Ravenna",
	"maple-leaf": "Maple Leaf",
	wedgwood: "Wedgwood",
	"lake-city": "Lake City",
	laurelhurst: "Laurelhurst",
	"sand-point": "Sand Point",
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
	"green-lake": [
		"wallingford",
		"phinney-ridge",
		"greenwood",
		"roosevelt",
		"maple-leaf",
	],
	wallingford: ["fremont", "green-lake", "university-district"],
	"university-district": ["wallingford", "roosevelt", "ravenna", "laurelhurst"],
	roosevelt: ["green-lake", "university-district", "ravenna", "maple-leaf"],
	ravenna: ["roosevelt", "university-district", "wedgwood", "laurelhurst"],
	"maple-leaf": ["roosevelt", "green-lake", "wedgwood", "lake-city"],
	wedgwood: ["ravenna", "maple-leaf", "lake-city", "sand-point"],
	"lake-city": ["maple-leaf", "wedgwood"],
	laurelhurst: ["university-district", "ravenna", "sand-point"],
	"sand-point": ["laurelhurst", "wedgwood"],
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
	/** Scraped events no title pattern or source default could place */
	misc: "Something else",
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
	misc: "✨",
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
	misc: ["low-key"],
};

export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";
export const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export type PriceLevel = 1 | 2 | 3;
/** What food and drinks cost at a venue, in words; the levels are our estimates. */
export const PRICE_LEVELS: Record<PriceLevel, string> = {
	1: "Budget",
	2: "Mid-range",
	3: "Pricier",
};

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
	/** e.g. "restaurant", "bar", "music-venue", "brewery", "patio"; "outdoor" means the venue itself is outdoors */
	tags: string[];
};

/** -1 means the last occurrence in the month. */
export type Nth = 1 | 2 | 3 | 4 | 5 | -1;

/** Optional YYYY-MM-DD bounds (inclusive), e.g. a theater run. */
type Run = { from?: string; until?: string };

export type Recurrence =
	| ({ kind: "weekly"; days: Weekday[]; months?: number[] } & Run)
	| ({
			kind: "monthly-nth";
			nth: Nth[];
			day: Weekday;
			months?: number[];
	  } & Run);

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
	/** Runs the whole time the venue is open: shown as "All day", with start/end set to the open hours */
	allDay?: boolean;
	cost?: string;
	/** Held outdoors, so it's left out for rainy nights. Defaults to whether the venue is tagged "outdoor". */
	outdoor?: boolean;
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
	allDay?: boolean;
	title: string;
	venueId?: string;
	category: Category;
	vibe: Vibe[];
	cost?: string;
	outdoor?: boolean;
	url: string;
	confidence: Confidence;
	lastVerified?: string;
};
