export const SITE = {
	title: "Date Night North Seattle",
	tagline:
		"Recurring nights and local events around Ballard, Fremont & friends",
	/** Where "report a change" links point. Leave empty to hide them until the site goes public. */
	reportEmail: "",
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
