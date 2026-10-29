import { href, SITE } from "../config";
import { esc } from "./components";

export type PageId = "tonight" | "week" | "map" | "venues" | "venue";

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
}): string {
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
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(SITE.tagline)}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231f3d8c'/><circle cx='70' cy='70' r='34' fill='%23d9412b'/></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400..700&family=Spectral:ital,wght@0,400;1,400&display=swap">
  ${styles}
  ${opts.scripts?.length ? `<link rel="preload" href="${href("/data.json")}" as="fetch" crossorigin>` : ""}
</head>
<body data-page="${opts.page}" data-base="${esc(href(""))}">
  <header class="site-header">
    <a class="brand" href="${href("/")}"><span class="brand-mark" aria-hidden="true"></span>${esc(SITE.title)}</a>
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
