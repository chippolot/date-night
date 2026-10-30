import { href } from "../config";
import type { SiteData } from "../lib/data";
import {
	type Filters,
	MAX_DAYS_AHEAD,
	parseFilters,
	toQuery,
} from "../lib/filters";
import { addDays, todayInSeattle } from "../lib/recurrence";
import { SPECIALS } from "../pages/components";

export async function loadSiteData(): Promise<SiteData> {
	const res = await fetch(href("/data.json"));
	return res.json();
}

// Hidden event types (e.g. happy hours) carry over between visits and pages in this browser.
const HIDE_KEY = "date-night:hide";

function storedHide(): string[] {
	try {
		return JSON.parse(localStorage.getItem(HIDE_KEY) ?? "[]");
	} catch {
		return [];
	}
}

function storeHide(hide: string[]) {
	try {
		localStorage.setItem(HIDE_KEY, JSON.stringify(hide));
	} catch {
		// Storage unavailable (private mode); hiding still works via the URL.
	}
}

/** Upgrade the GET filter form to update the URL and re-render on every change. */
export function wireFilters(onChange: (f: Filters) => void): Filters {
	const form = document.querySelector<HTMLFormElement>("[data-filters]");
	const params = new URLSearchParams(location.search);
	if (!params.has("hide")) {
		for (const c of storedHide()) params.append("hide", c);
	}
	const initial = parseFilters(params);
	if (!form) return initial;
	form.classList.add("js");
	if (initial.hide.length) {
		history.replaceState(null, "", `${location.pathname}${toQuery(initial)}`);
	}

	// The pre-rendered form has no selections; reflect the URL's filters.
	for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
		if (input.type === "search") {
			input.value = initial.q ?? "";
			continue;
		}
		if (input.type === "date") {
			// The static page was built on an earlier day; keep the range relative to today.
			const today = todayInSeattle();
			input.min = today;
			input.max = addDays(today, MAX_DAYS_AHEAD);
			input.value = initial.date ?? "";
			continue;
		}
		const values = params.getAll(input.name);
		input.checked =
			input.type === "radio" && input.value === ""
				? values.length === 0
				: values.includes(input.value);
	}
	// Day and time sit outside the panel, so only open it for the filters inside.
	if (
		initial.hood.length ||
		initial.cat.length ||
		initial.hide.some((c) => c !== SPECIALS) ||
		initial.vibe.length ||
		initial.price ||
		initial.cost
	)
		form.querySelector("details")?.setAttribute("open", "");

	const read = () =>
		parseFilters(new URLSearchParams(new FormData(form) as never));
	// "What" pills cycle off → picked (`cat`) → hidden (`hide`) → off.
	form.addEventListener("click", (e) => {
		const target = e.target as Element;
		const pill = target.closest(".tri");
		const [pick, hide] = pill?.querySelectorAll("input") ?? [];
		if (!pick || !hide) return;
		e.preventDefault();
		// Keyboard and screen readers click the checkbox itself, which flips before this runs and
		// flips back after the cancelled click; read its original state and act once that's done.
		const direct = target instanceof HTMLInputElement;
		const was = {
			pick: direct && target === pick ? !pick.checked : pick.checked,
			hide: direct && target === hide ? !hide.checked : hide.checked,
		};
		const cycle = () => {
			pick.checked = !was.pick && !was.hide;
			hide.checked = was.pick;
			form.dispatchEvent(new Event("change"));
		};
		if (direct) setTimeout(cycle);
		else cycle();
	});
	// The specials switch and the specials "What" pill set the same filter; keep them in step.
	const toggle = form.querySelector<HTMLInputElement>("[data-hide-specials]");
	const [specialsPick, specialsHide] =
		form
			.querySelector(`.tri input[value="${SPECIALS}"]`)
			?.closest(".tri")
			?.querySelectorAll("input") ?? [];
	form.addEventListener("change", (e) => {
		if (toggle && specialsHide) {
			if (e.target === toggle) {
				specialsHide.checked = toggle.checked;
				if (toggle.checked && specialsPick) specialsPick.checked = false;
			} else toggle.checked = specialsHide.checked;
		}
		const f = read();
		storeHide(f.hide);
		history.replaceState(null, "", `${location.pathname}${toQuery(f)}`);
		onChange(f);
	});
	// Search as you type, without re-rendering on every keystroke.
	let typing: ReturnType<typeof setTimeout> | undefined;
	form.addEventListener("input", (e) => {
		if ((e.target as HTMLInputElement).type !== "search") return;
		clearTimeout(typing);
		typing = setTimeout(() => form.dispatchEvent(new Event("change")), 150);
	});
	form.addEventListener("submit", (e) => e.preventDefault());
	form.querySelector("[data-clear]")?.addEventListener("click", (e) => {
		e.preventDefault();
		form.reset();
		for (const input of form.querySelectorAll<HTMLInputElement>("input")) {
			if (input.type === "date" || input.type === "search") input.value = "";
			else input.checked = input.type === "radio" && input.value === "";
		}
		form.dispatchEvent(new Event("change"));
	});
	return initial;
}
