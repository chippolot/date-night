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

export function href(path: string): string {
	return `${BASE}${path}`;
}
