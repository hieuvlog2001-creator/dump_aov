# Il2CppDumper Online (AoV source-based)

Web front-end + Cloudflare Worker/R2 job intake + GitHub Actions runner. The engine project compiles a CLI adapter around the original repository's IL2CPP core source files; WPF UI files are deliberately excluded.

## Architecture

1. Cloudflare Pages serves `frontend/`.
2. Cloudflare Worker (`worker/`) receives the two input files and stores them in R2.
3. Worker dispatches a `repository_dispatch` event to this GitHub repository.
4. GitHub Actions runs on a temporary Windows runner, downloads the inputs from the Worker, executes `engine/Il2CppDumper.Engine`, ZIPs the output and uploads it back to R2.
5. Browser polls job status and downloads the ZIP result.

## Important compatibility note

This is a web/runner port, not the original WPF desktop UI. The CLI adapter reuses the source folders `ExecutableFormats`, `Extensions`, `IO`, `Il2Cpp`, `Outputs`, `Utils`, `Attributes`, plus `Config.cs`. The GUI-only controls and dialogs are not part of the web engine. Test against legally obtained sample binaries before public use. The original source's advanced manual registration/offset workflows may require additional CLI parameters; this first adapter exposes registration values and dump address as environment variables on the engine process, and the hosted workflow currently uses automatic search only.

## 1. Create GitHub repository

Create a private repository named `Il2CppDumper-Online` (or adjust Worker vars), upload all files from this folder, and use branch `main`.

## 2. Create Cloudflare resources

- Create an R2 bucket named `il2cpp-dumper-jobs`.
- Create a Pages project named `il2cpp-dumper-online` (or set the Actions secret to your chosen project name).
- Create a Worker using `worker/wrangler.toml` and deploy it once.

Worker variables in `worker/wrangler.toml`:
- `GITHUB_OWNER`: your GitHub username/org.
- `GITHUB_REPO`: exact repository name.
- `MAX_UPLOAD_MB`: combined upload cap. Keep conservative; Workers and R2 have request/platform limits.

Set Worker secrets (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
- `GITHUB_TOKEN`: fine-grained GitHub token scoped to this repository with permission to dispatch repository events (Contents: Read and write).
- `RUNNER_SECRET`: long random secret shared with GitHub Actions.
- `APP_PASSWORD`: optional website password. Leave unset for no password.

## 3. GitHub Actions secrets

Repository → Settings → Secrets and variables → Actions → New repository secret:
- `WORKER_URL`: full Worker URL, e.g. `https://il2cpp-dumper-online-api.<subdomain>.workers.dev` (no trailing slash).
- `RUNNER_SECRET`: exactly the same value as the Worker secret.
- `CLOUDFLARE_API_TOKEN`: token with Workers Scripts:Edit and Cloudflare Pages:Edit, plus account access.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_PAGES_PROJECT`: Pages project name.

Enable GitHub Actions for the repository. Push to `main`; deploy workflow publishes Worker and Pages. If the Worker was not deployed before, first deploy it manually so the Pages UI has an API endpoint.

## 4. Connect the website to the Worker

Edit `frontend/config.js` and set `window.IL2CPP_API_BASE` to your Worker URL, for example:

```js
window.IL2CPP_API_BASE = "https://il2cpp-dumper-online-api.<your-subdomain>.workers.dev";
```

Commit and push. The Pages deploy workflow publishes the frontend.

## 5. Test

1. Open the Pages URL.
2. Select a matching executable (`libil2cpp.so` or supported iOS executable) and `global-metadata.dat`.
3. Submit. A job is created and GitHub Actions starts.
4. Follow the job state in the page. On success, download the result ZIP.

## Security and operations

- Use a private GitHub repository and set `APP_PASSWORD` for private access.
- Never put GitHub tokens or `RUNNER_SECRET` in frontend files.
- Set an R2 lifecycle rule to delete `jobs/` objects after a short retention period (e.g. 1 day).
- The sample stores job status and input/output files in R2. It does not yet implement user accounts, per-user quotas, malware scanning, or a queue/lock service.
- GitHub-hosted runners are ephemeral and usage is subject to GitHub Actions quotas and repository plan limits. This is task-based processing, not an always-on server.
- The Worker accepts two separate files in this version. APK/IPA auto-extraction is not wired into the web UI yet; extract the binary and metadata first.

## Local engine build

```bash
dotnet restore engine/Il2CppDumper.Engine/Il2CppDumper.Engine.csproj
dotnet build engine/Il2CppDumper.Engine/Il2CppDumper.Engine.csproj -c Release
```

CLI usage:

```bash
dotnet run --project engine/Il2CppDumper.Engine -- <binary> <global-metadata.dat> <output-dir> [config.json]
```

Optional environment variables for advanced manual cases:
- `IL2CPP_DUMP_ADDRESS` (hex)
- `IL2CPP_CODE_REGISTRATION` (hex)
- `IL2CPP_METADATA_REGISTRATION` (hex)
- `IL2CPP_MACHO_SLICE` (zero-based universal Mach-O slice index)
- `IL2CPP_FAST_MODE=1`

## Source attribution

The engine core is based on the uploaded `Il2CppDumper-GUI-AoV-main` source. Preserve its original LICENSE/NOTICE and upstream attribution when redistributing. Check the upstream repository's license before publishing a public fork.
