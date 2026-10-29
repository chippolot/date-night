// Serve the built dist/ folder the way a static host would.
import { join, normalize } from "node:path";

const port = Number(process.env.PORT ?? 4173);
const root = "dist";

Bun.serve({
	port,
	async fetch(req) {
		const pathname = normalize(decodeURIComponent(new URL(req.url).pathname));
		if (pathname.includes(".."))
			return new Response("Bad path", { status: 400 });
		for (const candidate of [pathname, join(pathname, "index.html")]) {
			const file = Bun.file(join(root, candidate));
			if ((await file.exists()) && !candidate.endsWith("/"))
				return new Response(file);
		}
		return new Response(Bun.file(join(root, "404.html")), { status: 404 });
	},
});

console.log(`Previewing dist/ on http://localhost:${port}`);
