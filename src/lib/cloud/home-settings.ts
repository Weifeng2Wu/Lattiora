import { z } from "zod";
import { listLocalFiles, writeLocalFile } from "./files";

export const HOME_SETTINGS_PATH = ".agentero/home/settings.json";
export const HOME_WIDGETS = [
	"clock",
	"conferences",
	"papers",
	"read",
	"notes",
	"pending",
	"reading",
	"taskProgress",
	"tasks",
	"recent",
	"weather",
	"focus",
	"capture",
] as const;
export type HomeWidgetId = (typeof HOME_WIDGETS)[number];
const widgetSchema = z.object({
	id: z.enum(HOME_WIDGETS),
	width: z.union([z.literal(1), z.literal(2), z.literal(4)]),
});
export const homeSettingsSchema = z.object({
	version: z.literal(1),
	widgets: z
		.array(widgetSchema)
		.max(HOME_WIDGETS.length)
		.refine(
			(widgets) =>
				new Set(widgets.map((widget) => widget.id)).size === widgets.length,
		),
	background: z.object({
		path: z
			.string()
			.regex(/^\.agentero\/home\/backgrounds\/[\da-f-]+\.webp$/)
			.optional(),
		blur: z.number().min(0).max(30),
		shade: z.number().min(0).max(95),
	}),
	city: z
		.object({
			name: z.string().max(150),
			latitude: z.number().min(-90).max(90),
			longitude: z.number().min(-180).max(180),
		})
		.optional(),
});
export type HomeSettings = z.infer<typeof homeSettingsSchema>;
export const defaultHomeSettings: HomeSettings = {
	version: 1,
	widgets: [
		{ id: "conferences", width: 2 },
		{ id: "clock", width: 2 },
		...(["papers", "read", "notes", "pending"] as const).map((id) => ({
			id,
			width: 1 as const,
		})),
		{ id: "reading", width: 2 },
		{ id: "taskProgress", width: 2 },
		{ id: "tasks", width: 4 },
	],
	background: { blur: 8, shade: 45 },
};
export async function readHomeSettings(): Promise<{
	value: HomeSettings;
	localId: string | null;
}> {
	const file = (await listLocalFiles()).find(
		(file) => file.path === HOME_SETTINGS_PATH && !file.deleted,
	);
	if (!file) return { value: defaultHomeSettings, localId: null };
	if (!file.data) throw new Error("notCached");
	return {
		value: homeSettingsSchema.parse(JSON.parse(await file.data.text())),
		localId: file.localId,
	};
}
export async function saveHomeSettings(
	value: HomeSettings,
	localId: string | null,
) {
	await writeLocalFile(
		HOME_SETTINGS_PATH,
		new Blob([JSON.stringify(homeSettingsSchema.parse(value))], {
			type: "application/json",
		}),
		{ expectedLocalId: localId },
	);
}
export async function saveHomeBackground(file: File) {
	if (
		!/^image\/(png|jpeg|webp)$/.test(file.type) ||
		file.size > 12 * 1024 * 1024
	)
		throw new Error("invalidImage");
	const bitmap = await createImageBitmap(file);
	try {
		const ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
		canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
		const context = canvas.getContext("2d");
		if (!context) throw new Error("invalidImage");
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("invalidImage"))),
				"image/webp",
				0.86,
			),
		);
		const path = `.agentero/home/backgrounds/${crypto.randomUUID()}.webp`;
		await writeLocalFile(path, blob, { expectedLocalId: null });
		return path;
	} finally {
		bitmap.close();
	}
}
