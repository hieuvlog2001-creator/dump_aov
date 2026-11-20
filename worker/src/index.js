const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", "access-control-allow-headers": "Content-Type,Authorization,X-App-Password" }
});
const key = (id, name) => `jobs/${id}/${name}`;

async function readJob(env, id) {
  const obj = await env.JOBS_BUCKET.get(key(id, "status.json"));
  return obj ? await obj.json() : null;
}
async function writeJob(env, job) {
  await env.JOBS_BUCKET.put(key(job.id, "status.json"), JSON.stringify(job), {
    httpMetadata: { contentType: "application/json" }
  });
}
function authorized(request, env) {
  if (!env.APP_PASSWORD) return true;
  return request.headers.get("x-app-password") === env.APP_PASSWORD;
}
async function dispatch(env, id) {
  if (!env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN Worker secret");
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Il2CppDumper-Online"
    },
    body: JSON.stringify({ event_type: "il2cpp-dump", client_payload: { job_id: id } })
  });
  if (!response.ok) throw new Error(`GitHub dispatch failed (${response.status}): ${await response.text()}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS", "access-control-allow-headers": "Content-Type,Authorization,X-App-Password", "access-control-max-age": "86400" } });
    if (url.pathname === "/api/health") return json({ ok: true, service: "il2cpp-dumper-online" });
    if (!authorized(request, env) && !url.pathname.startsWith("/internal/")) return json({ error: "Unauthorized" }, 401);

    if (request.method === "POST" && url.pathname === "/api/jobs") {
      const form = await request.formData();
      const binary = form.get("binary");
      const metadata = form.get("metadata");
      if (!(binary instanceof File) || !(metadata instanceof File)) return json({ error: "Select both executable and global-metadata.dat." }, 400);
      const maxBytes = (Number(env.MAX_UPLOAD_MB || 150)) * 1024 * 1024;
      if (binary.size <= 0 || metadata.size <= 0 || binary.size + metadata.size > maxBytes) return json({ error: `Combined upload limit is ${env.MAX_UPLOAD_MB || 150} MB.` }, 413);
      const id = crypto.randomUUID();
      await env.JOBS_BUCKET.put(key(id, "binary"), binary.stream(), { httpMetadata: { contentType: "application/octet-stream" } });
      await env.JOBS_BUCKET.put(key(id, "metadata"), metadata.stream(), { httpMetadata: { contentType: "application/octet-stream" } });
      const job = { id, status: "queued", createdAt: new Date().toISOString(), binaryName: binary.name, metadataName: metadata.name, message: "Waiting for GitHub Actions runner." };
      await writeJob(env, job);
      try { await dispatch(env, id); }
      catch (e) { job.status = "error"; job.message = e.message; await writeJob(env, job); return json({ error: e.message, job }, 502); }
      return json({ job });
    }

    const publicStatus = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && publicStatus) {
      const job = await readJob(env, publicStatus[1]);
      return job ? json({ job }) : json({ error: "Job not found" }, 404);
    }
    const resultMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/result$/i);
    if (request.method === "GET" && resultMatch) {
      const obj = await env.JOBS_BUCKET.get(key(resultMatch[1], "result.zip"));
      if (!obj) return json({ error: "Result is not ready" }, 404);
      return new Response(obj.body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="Il2CppDumper-${resultMatch[1]}.zip"`, "cache-control": "no-store", "access-control-allow-origin": "*" } });
    }

    // Private runner endpoints. The secret is stored as a GitHub Actions secret, never in the browser.
    if (url.pathname.startsWith("/internal/")) {
      if (!env.RUNNER_SECRET || request.headers.get("authorization") !== `Bearer ${env.RUNNER_SECRET}`) return json({ error: "Unauthorized runner" }, 401);
      const inputMatch = url.pathname.match(/^\/internal\/jobs\/([0-9a-f-]+)\/input\/(binary|metadata)$/i);
      if (request.method === "GET" && inputMatch) {
        const obj = await env.JOBS_BUCKET.get(key(inputMatch[1], inputMatch[2]));
        return obj ? new Response(obj.body, { headers: { "content-type": "application/octet-stream" } }) : json({ error: "Input not found" }, 404);
      }
      const statusMatch = url.pathname.match(/^\/internal\/jobs\/([0-9a-f-]+)\/status$/i);
      if (request.method === "POST" && statusMatch) {
        const current = await readJob(env, statusMatch[1]);
        if (!current) return json({ error: "Job not found" }, 404);
        const update = await request.json();
        const allowed = new Set(["running", "completed", "error"]);
        if (!allowed.has(update.status)) return json({ error: "Invalid status" }, 400);
        Object.assign(current, { status: update.status, message: String(update.message || "").slice(0, 2000), updatedAt: new Date().toISOString() });
        await writeJob(env, current);
        return json({ job: current });
      }
      const resultUpload = url.pathname.match(/^\/internal\/jobs\/([0-9a-f-]+)\/result$/i);
      if (request.method === "PUT" && resultUpload) {
        const current = await readJob(env, resultUpload[1]);
        if (!current) return json({ error: "Job not found" }, 404);
        if (!request.body) return json({ error: "Missing result body" }, 400);
        await env.JOBS_BUCKET.put(key(resultUpload[1], "result.zip"), request.body, { httpMetadata: { contentType: "application/zip" } });
        current.status = "completed"; current.message = "Dump completed. Download the ZIP result."; current.updatedAt = new Date().toISOString();
        await writeJob(env, current);
        return json({ ok: true });
      }
    }
    return json({ error: "Not found" }, 404);
  }
};
