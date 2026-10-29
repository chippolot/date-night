import { href, SITE } from "../config";
import { esc } from "./components";

export type PageId = "tonight" | "week" | "map" | "venues" | "venue";

const NAV: [PageId, string, string][] = [
	["tonight", "Tonight", "/"],
	["week", "This week", "/week/"],
	["map", "Map", "/map/"],
	["venues", "Venues", "/venues/"],
];

export function layout(opts: {
	page: PageId;
	title: string;
	heading: string;
	body: string;
	intro?: string;
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
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(SITE.tagline)}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌙</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Inter:wght@400;500;600&display=swap">
  ${styles}
  ${opts.scripts?.length ? `<link rel="preload" href="${href("/data.json")}" as="fetch" crossorigin>` : ""}
</head>
<body data-page="${opts.page}" data-base="${esc(href(""))}">
  <header class="site-header">
    <a class="brand" href="${href("/")}">🌙 ${esc(SITE.title)}</a>
    <nav>${nav}</nav>
  </header>
  <main>
    <section class="hero">
      <span class="hero-moon" aria-hidden="true"></span>
      <h1>${esc(opts.heading)}</h1>
      ${opts.intro ? `<div class="intro">${opts.intro}</div>` : ""}
    </section>
    ${opts.body}
  </main>
  ${scripts}
</body>
</html>`;
}
