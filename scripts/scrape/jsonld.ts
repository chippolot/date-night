/** Extract schema.org Event objects from an HTML page's JSON-LD blocks. */

export type LdEvent = {
	name: string;
	startDate: string;
	endDate?: string;
	url?: string;
	price?: string;
	/** `location.name`, when given */
	location?: string;
	/** `eventStatus` is EventCancelled */
	cancelled?: boolean;
};

const SCRIPT_RE =
	/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const EVENT_TYPES = /Event$/; // Event, MusicEvent, ComedyEvent, ...

export function decodeEntities(s: string): string {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) =>
			String.fromCodePoint(Number.parseInt(n, 16)),
		)
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
	if (Array.isArray(node)) {
		for (const n of node) yield* walk(n);
	} else if (node && typeof node === "object") {
		const obj = node as Record<string, unknown>;
		yield obj;
		if (obj["@graph"]) yield* walk(obj["@graph"]);
		// ItemList → ListItem → item (e.g. Humanitix host pages)
		if (obj.itemListElement) yield* walk(obj.itemListElement);
		if (obj.item) yield* walk(obj.item);
	}
}

function priceOf(offers: unknown): string | undefined {
	const offer = Array.isArray(offers) ? offers[0] : offers;
	if (!offer || typeof offer !== "object") return undefined;
	const o = offer as Record<string, unknown>;
	const low = o.lowPrice ?? o.price;
	if (low === undefined || low === "") return undefined;
	if (Number(low) === 0) return "Free";
	const high = o.highPrice;
	return high && high !== low ? `$${low}–$${high}` : `$${low}`;
}

function locationOf(location: unknown): string | undefined {
	const place = Array.isArray(location) ? location[0] : location;
	if (!place || typeof place !== "object") return undefined;
	const name = (place as Record<string, unknown>).name;
	return typeof name === "string" ? decodeEntities(name).trim() : undefined;
}

export function extractLdEvents(html: string): LdEvent[] {
	const out: LdEvent[] = [];
	for (const [, raw = ""] of html.matchAll(SCRIPT_RE)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw.trim());
		} catch {
			continue; // Some sites emit invalid JSON-LD; skip that block.
		}
		for (const obj of walk(parsed)) {
			const type = obj["@type"];
			const types = Array.isArray(type) ? type : [type];
			if (!types.some((t) => typeof t === "string" && EVENT_TYPES.test(t)))
				continue;
			if (typeof obj.name !== "string" || typeof obj.startDate !== "string")
				continue;
			out.push({
				// Some sites over-escape apostrophes as \' inside JSON strings.
				name: decodeEntities(obj.name).replace(/\\'/g, "'").trim(),
				startDate: obj.startDate,
				endDate: typeof obj.endDate === "string" ? obj.endDate : undefined,
				url: typeof obj.url === "string" ? obj.url : undefined,
				price: priceOf(obj.offers),
				location: locationOf(obj.location),
				cancelled:
					String(obj.eventStatus ?? "").endsWith("EventCancelled") || undefined,
			});
		}
	}
	return out;
}
