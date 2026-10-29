import eventsFile from "../../data/events.generated.json";
import { nights } from "../../data/nights";
import { venues } from "../../data/venues";
import type { DatedEvent, Night, Venue } from "./types";

export type SiteData = {
	venues: Venue[];
	nights: Night[];
	events: DatedEvent[];
	/** ISO datetime of the last scrape, or null if never scraped */
	eventsUpdatedAt: string | null;
};

export function loadData(): SiteData {
	return {
		venues,
		nights,
		events: eventsFile.events as DatedEvent[],
		eventsUpdatedAt: eventsFile.generatedAt,
	};
}
