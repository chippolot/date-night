const NAME = "Date Night";
const PLACE = "North Seattle";

export const SITE = {
	title: `${NAME} ${PLACE}`,
	/** The header wordmark: the name, then the place in a lighter weight */
	name: NAME,
	place: PLACE,
	tagline: "Recurring nights and local events from Ballard to Lake City",
	/**
	 * The Google Form that "Something changed?" links open, and the ids of the questions it
	 * pre-fills (from the form's pre-filled link). Anyone can answer it, no account needed.
	 * An empty url hides the links.
	 */
	reportForm: {
		url: "https://docs.google.com/forms/d/e/1FAIpQLSfsXmnDG7StNUIcDZBJkK8v9FN_7puq_Ox53xyydFlcOs2nSw/viewform",
		listing: "entry.1892429106",
		source: "entry.2117411879",
	},
	/**
	 * The Google Form for telling us about something we don't list at all ("Know something we're
	 * missing?"), and the ids of its Where and When questions. Responses are leads for hand
	 * verification, never written into nights.ts automatically. An empty url hides the links.
	 */
	missingForm: {
		url: "https://docs.google.com/forms/d/e/1FAIpQLSdMoqoY8vDnQZr3U2TnVSM4sJ-MNij4JwC7eDOC75vlqijw1A/viewform",
		venue: "entry.1354463914",
		when: "entry.550920479",
	},
	/** Nights verified longer ago than this get a "may be outdated" badge. */
	freshDays: 90,
};

/** URL prefix the site is served under, e.g. "/date-night" for a GitHub Pages project site. */
export const BASE = (process.env.BASE_PATH ?? "").replace(/\/$/, "");

/**
 * CARTO basemaps key (CARTO_KEY in .env locally, a repo secret in CI). It ships in the map's
 * browser code, so it isn't secret: restrict it to the site's domain in the CARTO dashboard.
 */
export const CARTO_KEY = process.env.CARTO_KEY ?? "";

export function href(path: string): string {
	return `${BASE}${path}`;
}
