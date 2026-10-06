# 期刊 / venue 取不全（#399）

Library publication 列和 Edit Metadata 刷新经常拿到缩写、截断或空的期刊名。

## 原因

回填原先 **DOI → Crossref `container-title` 优先**，title 刷新则 **S2 search 的 `venue` 字段优先**。

对照同一批论文：

| 论文 | arXiv `journal_ref` | S2 `venue` | S2 `publicationVenue.name` | Crossref `container-title` |
|---|---|---|---|---|
| Attention Is All You Need | 空 | `Neural Information Processing Systems` | 同左（conference） | arXiv DOI 404 |
| BERT (NAACL 2019) | — | 常空 | `North American Chapter of the Association for Computational Linguistics` | `Proceedings of the 2019 Conference of the North`（截断） |
| AlphaFold (Nature) | — | `Nature` | `Nature`（journal） | `Nature` |

另外：S2 search 的 `venue` 经常为空，完整名在 `publicationVenue`；`type=repository` 的 `arXiv.org` 不能当发表venue。OpenAlex 对 CS arXiv 常无 source；DBLP 只有 `NIPS` / `NAACL-HLT` 缩写。

## 实测（`~/Downloads/paper` vault，60 篇）

Catalog 里只有 3 篇可用 publication（其余空或 `arXiv` / `arXiv.org`）。对 57 个 arXiv id 拉 Atom：BERT / ResNet / Adam / GPT-3 / EAGLE 的 `journal_ref` **全空**。S2 `paper/batch` 命中 38 篇，其中 10 篇有可用 venue（NAACL / CVPR / ICLR / NeurIPS / ICML / ACL）；预印本的 `publicationVenue` 是无 `type` 的 `arXiv.org`，被丢弃。

## 修复

- 解析 S2 时优先 `publicationVenue.name`（跳过 repository），其次 `journal.name`，再次 `venue`；丢弃 `arXiv` / `CoRR`。
- 回填顺序改为：arXiv `journal_ref` / S2 → S2 `DOI:` → Crossref → title search。
- `paper_resolve_identifier` 对标识符先解析再 S2 补全；Crossref 以 `Proceedings …` 开头的截断标题仍走 S2，取更长的那个。
