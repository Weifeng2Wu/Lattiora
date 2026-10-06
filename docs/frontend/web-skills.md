# 网页 Skill 来源导入

沿用原 `skill-import-dialog.tsx` 多来源、多选、全选/全不选及已安装标记；魔棒识别 GitHub 仓库、tree 子目录、blob SKILL.md、skills.sh 和 `npx skills add` 文本。npx 仅作为来源语法解析，不会执行命令。原 Plaza 的 `importPlazaSkillRepo` 复用此入口；外站 iframe 的交互注入仍属独立欠项。

登录后的 Worker 从公开 GitHub 获取提交 SHA、文件树和 SKILL.md。发现阶段不下载附属资源，也不写入 Vault。浏览器暂存候选；关闭选择窗会丢弃候选，刷新页面后需重新发现。安装固定该 SHA，下载所选目录的全部普通文件，保留二进制 assets、references 和 scripts（脚本只作为文件保存，不执行）。来源及 SHA 记入 `agentero-skill.json`。

全部选中项下载完成后，经 Web Lock 和单个 IndexedDB 事务保存为 `.agents/skills/<name>/`，沿用 outbox/D1/R2/冲突副本和 ZIP 导出。事务提交前的取消或失败不会留下半套 Skill。已有同名 Skill 或同名目录默认跳过，导入不会覆盖本地编辑。安装在原后台任务面板显示进度并可取消；导入后内置 Agent 的 Skill 列表读取这些文件。一次确认含多个来源时，每个来源独立提交；后一个失败不会回滚先前成功的来源。

## 限制与额度

- 不附带模型服务或 Key。GitHub 是用户粘贴来源对应的公共代码托管地址；不运行模型、不收取模型 token。下载消耗 GitHub 匿名 API 额度、Worker 请求和后续 R2/D1 同步额度。
- 暂只支持公开 GitHub；不读取本机 gh token，不支持私有仓库；原公开 GitHub 镜像回退现已接入，见下文。
- GitHub 分支名含 `/` 时，使用仓库 URL 的 `#完整分支名`；tree/blob URL 的分支采用第一个路径段。普通分支和 commit SHA 均支持。
- 每次发现至多 40 个 SKILL.md，超过时明确拒绝并提示选择较小的 tree 子目录（避免超过 Workers 免费档子请求限制）；截断文件树也拒绝，不把部分列表当完整结果。
- 单个 Skill 至多 200 文件、16 MiB；单文件 2 MiB、SKILL.md 128 KiB；每次安装累计 32 MiB；请求超时 25 秒。候选暂存最多 32 个来源。超限明确失败。
- 同名候选歧义、符号链接和 submodule 明确拒绝。错误不会伪装成成功；可重新发现重试。页面关闭前尚未提交的下载不自动续传；已提交文件继续使用现有同步重试机制。
- 远程指令是用户选择的第三方内容，不能为浏览器新增 Shell/本机 Agent 能力。导入源不获得本站 Cookie 或模型 Key。

## 验证

`test/cloud-skill-source.test.ts` 覆盖来源和 frontmatter；`test/cloud-skills-http.test.ts` 覆盖固定 SHA、仅发现元数据、无凭据转发、异常树与重定向；`test/cloud-skills-storage.test.ts` 验证真实 IndexedDB 事务、二进制、已有目录保护、失败及取消原子性。`test/browser/skills.spec.ts` 使用原魔棒/多选窗，验证只下载选中资源以及离线重载；GitHub 响应使用 fixture，与真实 GitHub 出站验证分开记录。

## 用户上传（0.16.1）

原魔棒导入区与 Skills 广场右上角增加上传图标。支持单个 `SKILL.md` 或包含一个/多个 Skill 目录的 ZIP；ZIP 内每个 Skill 目录必须有 `SKILL.md`，可带 `references/`、`assets/`、`scripts/`。读取 name/description 后使用同一个原多选窗。上传文件解析和确认安装均在浏览器本地完成，不需要联网，也不调用模型；恢复联网后按普通工作区文件同步。

本地来源写为 `upload:<文件名>`，不伪造 GitHub 提交 SHA。取消选择不写文件；已安装同名项不覆盖。ZIP 压缩文件和解压总量最多 16 MiB、最多 1,000 条目录/文件记录；单文件、Skill 文件数与 metadata 限制同上。拒绝重复路径、路径穿越、重复 Skill 名和无有效 SKILL.md 的包。ZIP 内容按普通文件字节导入，不还原 Unix 符号链接权限或执行脚本。所有候选资源留在当前页面内存，关闭页面后重新上传即可。

首次离线使用前，等待工作区状态显示 **Offline ready / 离线已就绪**；首次登录后资源包仍在缓存时，不保证尚未打开的 Agent 等界面可离线加载。上传到本地与离线资源包缓存是两个独立状态。

## GitHub 镜像回退

原 General → GitHub mirror 选择和开关已接回浏览器下载器，并提供独立“测试连接”。仅用户启用后，公开 Skill 正文/附件的 GitHub 直连失败才使用选定镜像；probe 直接请求镜像中的小型公开 README，不能用直连成功代替镜像可用。GitHub commit/tree metadata API 仍直连，镜像无法绕过其 API 限流；私有仓库的本机 Git/gh 凭据不读取。镜像白名单沿用原四个预设，不转发 Cookie 或 Authorization，也不跟随重定向。每次文件请求在同一总体超时内重试一次镜像，原固定 SHA、字节上限、取消和本地事务不变。原 preset 服务的公网可用性需要用户测试，未承诺长期可用。
