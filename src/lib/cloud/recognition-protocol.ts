import { z } from "zod";

const number = z.number().finite();
const word = z.tuple([
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	z.string().max(20000),
]);
const block = z.tuple([
	number,
	number,
	number,
	number,
	z.array(z.array(z.array(word).max(10000)).max(10000)).max(10000),
]);
export const recognitionPayload = z.object({
	metadata: z.object({}),
	totalPages: z.number().int().min(1).max(100000),
	fileName: z.string().max(1024),
	pages: z
		.array(
			z.tuple([
				number.positive(),
				number.positive(),
				z.array(z.array(z.array(block))),
			]),
		)
		.min(1)
		.max(5),
});
const text = z.string().max(20000).nullish();
export const recognitionHit = z
	.object({
		type: text,
		doi: z.string().max(600).nullish(),
		arxiv: z.string().max(128).nullish(),
		isbn: text,
		title: text,
		authors: z
			.array(z.object({ firstName: text, lastName: text, name: text }))
			.max(2000)
			.default([]),
		language: text,
		year: text,
		container: text,
		publisher: text,
		volume: text,
		issue: text,
		pages: text,
	})
	.refine((hit) =>
		Boolean(
			hit.title?.trim() ||
				hit.doi?.trim() ||
				hit.arxiv?.trim() ||
				hit.isbn?.trim(),
		),
	);
export type RecognitionPayload = z.infer<typeof recognitionPayload>;
export type RecognitionHit = z.infer<typeof recognitionHit>;

/** A public identifier makes the connection probe deterministic and inexpensive. */
export const recognitionProbePayload: RecognitionPayload = {
	metadata: {},
	totalPages: 1,
	fileName: "connection-test.pdf",
	pages: [
		[
			612,
			792,
			[
				[
					[
						[
							0,
							0,
							0,
							0,
							[
								[
									[
										[
											72,
											700,
											400,
											718,
											18,
											1,
											700,
											0,
											0,
											0,
											0,
											0,
											0,
											"arXiv:1706.03762",
										],
									],
								],
							],
						],
					],
				],
			],
		],
	],
};
