// The site's few named PostHog events. The snippet in the page's head (layout.ts) loads PostHog
// and counts page views; this adds what visitors do once there. Without a key (locally) there's
// no `window.posthog`, and events go to the console instead.
import { SITE } from "../config";

declare global {
	interface Window {
		posthog?: {
			capture(event: string, props?: Record<string, unknown>): void;
		};
	}
}

export type TrackEvent =
	/** The filters changed (the URL's query, minus the search text) */
	| "filtered"
	/** Surprise me, or its Re-roll (`found`: a pairing turned up) */
	| "surprise"
	/** A card's share button */
	| "shared"
	/** A link off the site (`kind`: source, report, missing, feed; `host`) */
	| "link opened";

export function track(
	event: TrackEvent,
	props: Record<string, string | number | boolean> = {},
) {
	try {
		if (window.posthog) window.posthog.capture(event, props);
		else console.debug("track", event, props);
	} catch {
		// Counting must never break the page.
	}
}

function linkKind(a: HTMLAnchorElement): string | undefined {
	if (a.dataset.webcal !== undefined) return "feed";
	const url = a.href;
	if (SITE.reportForm.url && url.startsWith(SITE.reportForm.url))
		return "report";
	if (SITE.missingForm.url && url.startsWith(SITE.missingForm.url))
		return "missing";
	if (a.host && a.host !== location.host) return "source";
	return undefined;
}

// One listener for every link, including ones rendered later. Captures, so it sees clicks that
// other handlers stop.
document.addEventListener(
	"click",
	(e) => {
		const a = (e.target as Element).closest?.<HTMLAnchorElement>("a[href]");
		if (!a) return;
		const kind = linkKind(a);
		if (kind) track("link opened", { kind, host: a.host });
	},
	true,
);
