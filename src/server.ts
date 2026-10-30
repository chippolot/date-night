// Local server. `bun run dev` (alias `bun run web`) runs it with --watch, which
// restarts the process when an imported file changes. (--hot re-evaluates in
// place instead, and after a reload that fails, e.g. on a syntax error, its file
// watcher stopped reaching open pages.) Files outside the import graph
// (styles.css, the client bundle) are watched below. Open pages reload after
// either: on a "reload" message, or on reconnecting to a restarted server.
import { watch } from "node:fs";
import { clientAssets } from "./assets";
import { loadData } from "./lib/data";
import { todayInSeattle } from "./lib/recurrence";
import { type Asset, renderSite } from "./site";

const port = Number(process.env.PORT ?? 3000);

// Rendering the whole site takes tens of ms, so do it once and share the result
// (including with concurrent requests that arrive while a build is in flight).
let cache: { today: string; files: Promise<Map<string, Asset>> } | undefined;

function site(): Promise<Map<string, Asset>> {
	const today = todayInSeattle();
	if (cache?.today !== today) {
		const files = (async () =>
			new Map([
				...renderSite(loadData(), today),
				...(await clientAssets(false)),
			]))();
		cache = { today, files };
		files.catch(() => {
			cache = undefined; // Don't cache a failed build; retry on the next request.
		});
	}
	return cache.files;
}

const clients = new Set<ReadableStreamDefaultController<string>>();

let pending: Timer | undefined;
function changed() {
	cache = undefined;
	// Editors often write a file in several steps, so wait for things to settle.
	clearTimeout(pending);
	pending = setTimeout(() => {
		for (const c of clients) {
			try {
				c.enqueue("data: reload\n\n");
			} catch {
				clients.delete(c); // A page that went away without closing its stream
			}
		}
	}, 150);
}
for (const dir of ["src", "data"]) watch(dir, { recursive: true }, changed);

/** Changes on every restart, so a page that reconnects to a new server reloads. */
const BOOT = String(Date.now());

const RELOAD_SCRIPT = `<script>{let boot;new EventSource("/__reload").onmessage=(e)=>{if(e.data==="reload"||(boot&&e.data!==boot))location.reload();boot??=e.data;};}</script>`;

function reloadStream(): Response {
	let controller: ReadableStreamDefaultController<string>;
	const stream = new ReadableStream<string>({
		start(c) {
			controller = c;
			clients.add(c);
			// Reconnect quickly after a restart, then compare boot ids.
			c.enqueue(`retry: 250\ndata: ${BOOT}\n\n`);
		},
		cancel() {
			clients.delete(controller);
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
}

Bun.serve({
	port,
	development: true,
	idleTimeout: 0, // Keep reload streams open.
	async fetch(req) {
		const { pathname } = new URL(req.url);
		if (pathname === "/__reload") return reloadStream();
		const files = await site();
		const asset =
			files.get(pathname) ??
			files.get(
				pathname.endsWith("/")
					? `${pathname}index.html`
					: `${pathname}/index.html`,
			);
		if (!asset) return new Response("Not found", { status: 404 });
		const body = asset.type.startsWith("text/html")
			? asset.body.replace("</body>", `${RELOAD_SCRIPT}</body>`)
			: asset.body;
		return new Response(body, {
			headers: { "content-type": asset.type, "cache-control": "no-store" },
		});
	},
});

await site(); // Warm the cache so the first page load is fast too.
console.log(`Server on http://localhost:${port}`);
