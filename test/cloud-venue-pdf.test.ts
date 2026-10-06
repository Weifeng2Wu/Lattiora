import { expect, it } from "vitest";
import { venuePdfUrl } from "../src/lib/cloud/venue-pdf";

it("preserves the original nine publisher fallbacks, including the PMLR mirror boundary", () => {
	const cases = [
		[
			"https://aclanthology.org/2026.acl-long.1248/",
			"https://aclanthology.org/2026.acl-long.1248.pdf",
		],
		[
			"https://www.usenix.org/conference/atc24/presentation/liu-qingyuan",
			"https://www.usenix.org/system/files/atc24-liu-qingyuan.pdf",
		],
		[
			"https://proceedings.neurips.cc/paper_files/paper/2023/hash/0001-Abstract-Conference.html",
			"https://proceedings.neurips.cc/paper_files/paper/2023/file/0001-Paper-Conference.pdf",
		],
		[
			"https://papers.nips.cc/paper/2020/hash/abcd-Abstract.html",
			"https://papers.nips.cc/paper/2020/file/abcd-Paper.pdf",
		],
		[
			"https://openaccess.thecvf.com/content/ICCV2023/html/Chen_Title_ICCV_2023_paper.html",
			"https://openaccess.thecvf.com/content/ICCV2023/papers/Chen_Title_ICCV_2023_paper.pdf",
		],
		[
			"https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/4_ECCV_2024_paper.php",
			"https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/00004.pdf",
		],
		[
			"https://www.ijcai.org/proceedings/2025/1",
			"https://www.ijcai.org/proceedings/2025/0001.pdf",
		],
		[
			"https://proceedings.mlr.press/v227/example24a.html",
			"https://proceedings.mlr.press/v227/example24a/example24a.pdf",
		],
		[
			"https://proceedings.mlr.press/v228/sanborn24a.html",
			"https://raw.githubusercontent.com/mlresearch/v228/main/assets/sanborn24a/sanborn24a.pdf",
		],
		[
			"https://openreview.net/forum?id=KS8mIvetg2",
			"https://openreview.net/pdf?id=KS8mIvetg2",
		],
		[
			"https://link.springer.com/chapter/10.1007/978-3-031-83274-1_20",
			"https://link.springer.com/content/pdf/10.1007/978-3-031-83274-1_20.pdf",
		],
	];
	for (const [source, pdf] of cases) expect(venuePdfUrl(source)).toBe(pdf);
});
it("does not invent PDF links for index pages, unrelated hosts or lookalike URLs", () => {
	for (const source of [
		"https://aclanthology.org/venues/acl/",
		"https://openreview.net/group?id=ICLR.cc",
		"https://link.springer.com/book/10.1007/example",
		"https://example.org/?url=https://openreview.net/forum?id=x",
		"https://openreview.net.evil.org/forum?id=x",
		"https://openreview.net@evil.org/forum?id=x",
		"file:///paper.pdf",
	])
		expect(venuePdfUrl(source)).toBeUndefined();
});
