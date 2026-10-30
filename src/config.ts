const NAME = "Date Night";
const PLACE = "North Seattle";

export const SITE = {
	title: `${NAME} ${PLACE}`,
	/** The header wordmark: the name, then the place in a lighter weight */
	name: NAME,
	place: PLACE,
	tagline:
		"Recurring nights and local events around Ballard, Fremont & friends",
	/** GitHub repo ("owner/name") whose listing-change issue form "Something changed?" links open. Empty hides them. */
	reportRepo: "chippolot/date-night",
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
