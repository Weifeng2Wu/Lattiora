# Skills

Create Vault seeds these when missing. Pick with `$` in Composer.

| Skill | Role |
| --- | --- |
| `paper-reader` | 精读 → `{paper}/NOTES.md`，只创建可解析双链 |
| `agentero-workspace` | 内置 Agent 文档工具说明；不执行本机命令 |
| `vault-normalizer` | 整理现有研究目录并对比迁移前后的双链诊断 |
| `acdemic-drawing` | 生成学术场景 Excalidraw 图 |
| `idea-evaluator` | 研究 idea 评审 |
| `deep-research` | 综述级文献调研 |
| `research-paper-writing` | 论文写作与审稿前自查 |

## Versioning & upgrades

First-party (and vendored) bundled skills carry an integer frontmatter field:

```yaml
version: 1
```

The browser seeds missing files only. Existing files, including lower-version customizations, are never overwritten. App updates supply bundled defaults when no local override exists. To use a new bundled version after customizing a skill, export your copy first and explicitly replace/remove the local override. Automatic upgrades of untouched local template copies are not yet implemented.

## Third-party source & license

`idea-evaluator` / `deep-research` are vendored from
[HKUSTDial/Supervisor-Skills](https://github.com/HKUSTDial/Supervisor-Skills)
(Yuyu Luo et al.).

**License: [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**  
Full text lives in each vendored skill package's `LICENSE` file.

`paper-reader` / `agentero-workspace` / `vault-normalizer` are first-party (Lattiora license).
