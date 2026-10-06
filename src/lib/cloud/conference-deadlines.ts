import { z } from "zod";

const editionSchema = z.object({
	id: z.string().min(1),
	year: z.number().int(),
	link: z.string().default(""),
	timezone: z.string(),
	date: z.string().default(""),
	place: z.string().default(""),
	timeline: z.array(
		z.object({
			deadline: z.string(),
			abstract_deadline: z.string().optional(),
			comment: z.string().optional(),
		}),
	),
});
const conferenceSchema = z.object({
	title: z.string().min(1),
	description: z.string().default(""),
	sub: z.string().default(""),
	conference_key: z.string().optional(),
	rank: z.object({ ccf: z.string() }),
	confs: z.array(editionSchema),
});

export type Conference = z.infer<typeof editionSchema> & {
	series: string;
	title: string;
	description: string;
	category: string;
	rank: string;
};

/** CCF uses fixed UTC offsets, AoE (UTC−12), and PT with US daylight saving. */
export function conferenceTimestamp(
	raw: string,
	timezone: string,
): number | null {
	const match =
		/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
			raw.trim(),
		);
	if (!match) return null;
	const [, year, month, day, hour, minute, second = "00"] = match;
	const wall = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
	const expected = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
	if (new Date(wall).toISOString().slice(0, 19) !== expected) return null;
	const zone = timezone.trim();
	if (zone === "PT") {
		const formatter = new Intl.DateTimeFormat("en-CA", {
			timeZone: "America/Los_Angeles",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		// Match the actual local clock. Reject nonexistent/ambiguous DST wall times.
		const candidates = [7, 8]
			.map((offset) => wall + offset * 3600000)
			.filter((time) => {
				const parts = Object.fromEntries(
					formatter.formatToParts(time).map((part) => [part.type, part.value]),
				);
				return (
					`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` ===
					expected
				);
			});
		return candidates.length === 1 ? candidates[0] : null;
	}
	const offset = /^(?:UTC)(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/i.exec(
		zone === "AoE" ? "UTC-12" : zone,
	);
	if (!offset) return null;
	const hours = +(offset[2] ?? 0);
	const minutes = +(offset[3] ?? 0);
	if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0))
		return null;
	return wall - (offset[1] === "-" ? -1 : 1) * (hours * 60 + minutes) * 60000;
}

export function parseConferences(raw: unknown): Conference[] {
	if (!Array.isArray(raw)) throw new Error("invalidConferences");
	const conferences = new Map<string, Conference>();
	for (const item of raw) {
		const parsed = conferenceSchema.safeParse(item);
		if (!parsed.success) continue;
		const { title, description, sub, rank, confs, conference_key } =
			parsed.data;
		for (const edition of confs) {
			let link = "";
			try {
				const url = new URL(edition.link);
				if (/^https?:$/.test(url.protocol) && !url.username && !url.password)
					link = url.href;
			} catch {
				/* Keep the conference even when its website is unavailable. */
			}
			conferences.set(edition.id, {
				...edition,
				series: conference_key ?? `${sub}/${title}`,
				link,
				title,
				description,
				category: sub,
				rank: rank.ccf,
			});
		}
	}
	if (!conferences.size) throw new Error("invalidConferences");
	return [...conferences.values()];
}

export function conferenceRounds(conference: Conference) {
	return conference.timeline.map((round, index) => ({
		...round,
		index,
		at: conferenceTimestamp(round.deadline, conference.timezone),
		abstractAt: round.abstract_deadline
			? conferenceTimestamp(round.abstract_deadline, conference.timezone)
			: null,
	}));
}

/** Move to the next submission round, preserving TBD and expired states. */
export function nextConferenceRound(conference: Conference, now: number) {
	const rounds = conferenceRounds(conference);
	const dated = rounds
		.filter((round) => round.at !== null)
		.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
	return (
		dated.find((round) => (round.at ?? 0) > now) ??
		rounds.find((round) => round.at === null) ??
		dated.at(-1) ??
		null
	);
}

/** Offer latest editions plus any older edition still accepting submissions. */
export function selectableConferences(conferences: Conference[], now: number) {
	const years = new Map<string, number>();
	for (const conference of conferences)
		years.set(
			conference.series,
			Math.max(years.get(conference.series) ?? 0, conference.year),
		);
	return conferences.filter(
		(conference) =>
			conference.year === years.get(conference.series) ||
			conferenceRounds(conference).some(
				(round) => round.at !== null && round.at > now,
			),
	);
}

export function deadlineCountdown(deadline: number, now: number) {
	const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
	return {
		days: Math.floor(seconds / 86400),
		time: [
			Math.floor(seconds / 3600) % 24,
			Math.floor(seconds / 60) % 60,
			seconds % 60,
		]
			.map((value) => String(value).padStart(2, "0"))
			.join(":"),
	};
}
