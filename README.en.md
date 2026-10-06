<div align="center">
  <img src="docs/assets/lattiora-icon.svg" alt="Lattiora Logo" width="80" height="80" />
  <h1>Lattiora · 研织</h1>
  <p>Weave papers, notes and research connections into your own knowledge network.</p>
  <p><a href="README.md">中文</a> · <strong>English</strong></p>
</div>

Lattiora is a self-hostable personal research workspace. Manage papers, read and annotate PDFs, write linked notes and work with AI in your browser. Desktop and mobile share the same data; cached files and notes remain available offline and sync when you reconnect.

## What you can do

- **Manage papers**: import PDFs, DOIs, arXiv references and Zotero bibliography exports, recognize metadata and organize your library into folders.
- **Read and translate**: search PDFs, highlight text, annotate regions and take notes alongside papers, with multiple translation services.
- **Connect knowledge**: use rich-text and source Markdown editing, wiki links, backlinks and full-text search, plus Excalidraw whiteboards, mind maps and Kanban boards.
- **Research with AI**: ask questions about papers, selections and notes using built-in document tools and Skills; connect Anthropic or OpenAI-compatible services.
- **Track your research**: see reading progress, board tasks and conference deadlines on the home page; discover papers through Plaza and RSS feeds.
- **Keep control of your data**: export files, back up your workspace and share read-only note snapshots; sync conflicts retain separate copies.

## Get started

### Deploy your workspace

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Weifeng2Wu/Lattiora)

The app runs on **Cloudflare Workers + D1 + R2**, with IndexedDB holding the browser's local working copy. Prepare a Cloudflare account with R2 enabled, then follow the [deployment guide](docs/deployment/cloudflare.md#使用-deploy-to-cloudflare-按钮) to configure resources, a login password and an encryption key. The two Plaza proxies require separate deployments, covered in the guide.

After signing in, choose your AI, translation and parsing services in Settings. AI and online scholarly services require a network connection; pricing and quotas depend on each provider. Wait for **Offline ready** and complete file sync before disconnecting.

### Develop locally

Use Node.js 22+, pnpm and a modern browser supporting IndexedDB, Web Locks and Service Workers. Prepare `.dev.vars` using the [local setup instructions](docs/deployment/cloudflare.md#本地运行), then run:

```bash
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm build
pnpm dev:web
```

Open <http://127.0.0.1:8790>. For development, run `pnpm dev` in another terminal; use a production build to verify offline behavior.

## Documentation

The detailed guides are currently in Chinese.

| Topic | Guide |
| --- | --- |
| Deployment, login, offline use, backups and costs | [Deployment and usage](docs/deployment/cloudflare.md) |
| Supported features and limitations | [Capability matrix](docs/deployment/capabilities.md) |
| Storage, synchronization and technical structure | [Architecture](docs/architecture.md) |
| Development plans and validation | [Roadmap / Todo](docs/development/web-migration.md) · [Validation record](docs/test/cloudflare.md) |
| Name and logo | [Brand guide](docs/frontend/branding.md) |

Lattiora is designed for one person, using password-based sign-in. Offline access depends on the current browser's cache. Signing out locks the interface but does not encrypt or erase the local copy. See the capability matrix for the full scope.

## License and thanks

Lattiora is based on [poco-ai/Agentero](https://github.com/poco-ai/Agentero) and distributed under the [MIT License](LICENSE). The original `Copyright (c) 2026 poco-ai` and complete permission notice are retained. Thank you to the upstream project and its contributors. Lattiora is an independent Cloudflare web derivative, not an official upstream release.
