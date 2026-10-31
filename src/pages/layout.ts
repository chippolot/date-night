import { href, SITE, TELEMETRY } from "../config";
import { esc } from "./components";

/**
 * The brand mark: two overlapping circles, fjord and lingonberry, for the two people on the date.
 * Fills are for the favicon (its overlap turns light on dark tab bars); in the header, the
 * `.brand-mark` classes recolor it per theme.
 */
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36">\
<style>@media (prefers-color-scheme: dark){.m-both{fill:#eceef4}}</style>\
<defs><clipPath id="m-left"><circle cx="16" cy="18" r="14"/></clipPath></defs>\
<circle class="m-one" cx="16" cy="18" r="14" fill="#1f3d8c"/>\
<circle class="m-two" cx="32" cy="18" r="14" fill="#d9412b"/>\
<circle class="m-both" cx="32" cy="18" r="14" fill="#121417" clip-path="url(#m-left)"/>\
</svg>`;

const FAVICON = `data:image/svg+xml,${encodeURIComponent(MARK)}`;

/** A value for an inline script: JSON that can't close the <script> tag early. */
function js(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Sentry's loader script (it fetches the SDK only once an error happens) and PostHog's snippet
 * (cookieless page views; src/client/track.ts names the other events). Each only where its key
 * is set (TELEMETRY in config.ts).
 */
function telemetry(): string {
	const out: string[] = [];
	const sentryKey = TELEMETRY.sentryDsn.match(/^https:\/\/(\w+)@/)?.[1];
	if (sentryKey) {
		const options = {
			environment: TELEMETRY.environment,
			...(TELEMETRY.release ? { release: TELEMETRY.release } : {}),
		};
		out.push(
			`<script>window.sentryOnLoad=function(){Sentry.init(${js(options)})}</script>`,
			`<script src="https://js.sentry-cdn.com/${sentryKey}.min.js" crossorigin="anonymous"></script>`,
		);
	}
	if (TELEMETRY.posthogKey) {
		// No cookies or storage, no person profiles, no replay or autocapture: page views (with
		// referrers, for the web analytics dashboard) and the events track() sends. Cookieless
		// tracking must be on in the project's settings too, or PostHog drops every event.
		const options = {
			api_host: TELEMETRY.posthogHost,
			defaults: "2025-05-24",
			cookieless_mode: "always",
			person_profiles: "never",
			// Only real page loads: filter changes rewrite the URL, and track() counts those.
			capture_pageview: true,
			autocapture: false,
			disable_session_recording: true,
			disable_surveys: true,
			capture_heatmaps: false,
			capture_dead_clicks: false,
		};
		out.push(
			`<script>${POSTHOG_SNIPPET}posthog.init(${js(TELEMETRY.posthogKey)},${js(options)})</script>`,
		);
	}
	return out.join("\n  ");
}

/** PostHog's loader stub (docs/integrate/snippet), which queues calls until array.js arrives. */
const POSTHOG_SNIPPET = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;

export type PageId =
	| "tonight"
	| "week"
	| "map"
	| "venues"
	| "venue"
	| "listing";

const NAV: [PageId, string, string][] = [
	["tonight", "Tonight", "/"],
	["week", "Coming up", "/week/"],
	["map", "Map", "/map/"],
	["venues", "Venues", "/venues/"],
];

export function layout(opts: {
	page: PageId;
	title: string;
	heading: string;
	body: string;
	intro?: string;
	/** A control shown beside the heading, e.g. the Surprise me button */
	action?: string;
	scripts?: string[];
	styles?: string[];
	/** The page's scripts don't read data.json, so don't preload it (venue pages) */
	noData?: boolean;
	/**
	 * What a shared link's preview shows (iMessage and others read these tags, not the page's
	 * JavaScript). Defaults to the page title and the site tagline.
	 */
	preview?: { title: string; description: string };
}): string {
	const preview = opts.preview ?? {
		title: opts.title,
		description: SITE.tagline,
	};
	const nav = NAV.map(
		([id, label, path]) =>
			`<a href="${href(path)}"${id === opts.page || (opts.page === "venue" && id === "venues") ? ' aria-current="page"' : ""}>${label}</a>`,
	).join("");
	const styles = ["/styles.css", ...(opts.styles ?? [])]
		.map((s) => `<link rel="stylesheet" href="${href(s)}">`)
		.join("\n  ");
	const scripts = (opts.scripts ?? [])
		.map((s) => `<script type="module" src="${href(s)}"></script>`)
		.join("\n  ");
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f6f5f1" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0e1120" media="(prefers-color-scheme: dark)">
  ${telemetry()}
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(preview.description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(SITE.title)}">
  <meta property="og:title" content="${esc(preview.title)}">
  <meta property="og:description" content="${esc(preview.description)}">
  <link rel="icon" href="${FAVICON}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400..700&family=Spectral:ital,wght@0,400;1,400&display=swap">
  ${styles}
  ${opts.scripts?.length && !opts.noData ? `<link rel="preload" href="${href("/data.json")}" as="fetch" crossorigin>` : ""}
</head>
<body data-page="${opts.page}" data-base="${esc(href(""))}">
  <header class="site-header">
    <a class="brand" href="${href("/")}"><span class="brand-mark" aria-hidden="true">${MARK}</span>${esc(SITE.name)} <span class="brand-place">${esc(SITE.place)}</span></a>
    <nav>${nav}</nav>
  </header>
  <main>
    <section class="hero">
      <div class="hero-top">
        <h1>${esc(opts.heading)}</h1>
        ${opts.action ?? ""}
      </div>
      ${opts.intro ? `<div class="intro">${opts.intro}</div>` : ""}
    </section>
    ${opts.body}
  </main>
  ${scripts}
</body>
</html>`;
}
