// Local server. `bun run dev` (alias `bun run web`) runs it with --hot, which
// re-evaluates this module when an imported file changes and so clears the cache
// below. Files outside the import graph (styles.css, the client bundle) are
// watched separately, and open pages reload themselves after any change.
import { type FSWatcher, watch } from "node:fs";
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

// --hot re-runs this module but keeps globalThis, so the watcher and the open
// reload streams live there instead of being duplicated on every edit.
const dev = globalThis as {
	devWatchers?: FSWatcher[];
	devClients?: Set<ReadableStreamDefaultController<string>>;
};
dev.devClients ??= new Set();
const clients = dev.devClients;

let pending: Timer | undefined;
function changed() {
	cache = undefined;
	// Editors often write a file in several steps, and --hot needs a moment to
	// re-evaluate imported modules, so wait for things to settle before reloading.
	clearTimeout(pending);
	pending = setTimeout(() => {
		for (const c of clients) c.enqueue("data: reload\n\n");
	}, 150);
}
for (const w of dev.devWatchers ?? []) w.close();
dev.devWatchers = ["src", "data"].map((dir) =>
	watch(dir, { recursive: true }, changed),
);

const RELOAD_SCRIPT = `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>`;

function reloadStream(): Response {
	let controller: ReadableStreamDefaultController<string>;
	const stream = new ReadableStream<string>({
		start(c) {
			controller = c;
			clients.add(c);
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
