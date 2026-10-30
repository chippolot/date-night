/** Minimal iCalendar VEVENT reader: enough for venue feeds, not a full RFC 5545 parser. */

export type IcsEvent = {
	uid?: string;
	summary: string;
	/** ISO datetime with offset */
	start: string;
	end?: string;
	url?: string;
	location?: string;
	/** DTSTART is a date with no time */
	allDay?: boolean;
	/** STATUS:CANCELLED */
	cancelled?: boolean;
};

function unfold(text: string): string[] {
	return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unescapeText(s: string): string {
	return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** Offset (e.g. "-07:00") of an IANA zone at a given instant. */
function offsetFor(timeZone: string, utcGuess: Date): string {
	const name = new Intl.DateTimeFormat("en-US", {
		timeZone,
		timeZoneName: "longOffset",
	})
		.formatToParts(utcGuess)
		.find((p) => p.type === "timeZoneName")?.value;
	const m = name?.match(/GMT([+-]\d{2}:\d{2})/);
	return m?.[1] ?? "+00:00";
}

/** Convert an ICS DATE-TIME value (with optional TZID param) to an ISO string with offset. */
export function toIso(value: string, tzid?: string): string | undefined {
	const m = value.match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/,
	);
	if (!m) return undefined;
	const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
	const local = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
	if (z) return `${local}Z`;
	const tz = tzid ?? "America/Los_Angeles";
	return `${local}${offsetFor(tz, new Date(`${local}Z`))}`;
}

export function parseIcs(text: string): IcsEvent[] {
	const events: IcsEvent[] = [];
	let cur: Record<string, { value: string; tzid?: string }> | null = null;
	for (const line of unfold(text)) {
		if (line === "BEGIN:VEVENT") {
			cur = {};
			continue;
		}
		if (line === "END:VEVENT" && cur) {
			const start = cur.DTSTART && toIso(cur.DTSTART.value, cur.DTSTART.tzid);
			if (cur.SUMMARY && start) {
				events.push({
					uid: cur.UID?.value,
					summary: unescapeText(cur.SUMMARY.value),
					start,
					end: cur.DTEND ? toIso(cur.DTEND.value, cur.DTEND.tzid) : undefined,
					url: cur.URL?.value,
					location: cur.LOCATION && unescapeText(cur.LOCATION.value),
					allDay: /^\d{8}$/.test(cur.DTSTART?.value ?? "") || undefined,
					cancelled: cur.STATUS?.value === "CANCELLED" || undefined,
				});
			}
			cur = null;
			continue;
		}
		if (!cur) continue;
		const idx = line.indexOf(":");
		if (idx < 0) continue;
		const [name = "", ...params] = line.slice(0, idx).split(";");
		const tzid = params.find((p) => p.startsWith("TZID="))?.slice(5);
		cur[name.toUpperCase()] = { value: line.slice(idx + 1), tzid };
	}
	return events;
}
