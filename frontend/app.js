const API = (window.IL2CPP_API_BASE || "").replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
let pollHandle;
for (const id of ["binary", "metadata"]) $(id).addEventListener("change", e => {
  const file = e.target.files[0]; $(id + "-name").textContent = file ? `${file.name} · ${(file.size / 1048576).toFixed(2)} MB` : "Chưa chọn file";
});
function headers() { const p = $("password").value; return p ? { "x-app-password": p } : {}; }
function showJob(job) {
  $("status-panel").hidden = false;
  $("status-title").textContent = job.status === "completed" ? "Hoàn tất" : job.status === "error" ? "Có lỗi xảy ra" : job.status === "running" ? "Đang xử lý" : "Đã gửi tác vụ";
  $("status-pill").textContent = (job.status || "queued").toUpperCase();
  $("status-message").textContent = job.message || "";
  $("job-id").textContent = `Job ID: ${job.id}`;
  const done = job.status === "completed";
  $("download").hidden = !done; if (done) { $("download").onclick = async (ev) => { ev.preventDefault(); const r = await fetch(`${API}/api/jobs/${job.id}/result`, { headers: headers() }); if (!r.ok) { alert("Không tải được kết quả."); return; } const blob = await r.blob(); const a = document.createElement("a"); const u = URL.createObjectURL(blob); a.href = u; a.download = `Il2CppDumper-${job.id}.zip`; a.click(); URL.revokeObjectURL(u); }; }
  if (job.status === "error" || done) { clearInterval(pollHandle); $("submit").disabled = false; }
}
async function poll(id) {
  try { const r = await fetch(`${API}/api/jobs/${id}`, { headers: headers() }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Status request failed"); showJob(d.job); }
  catch (e) { $("status-message").textContent = e.message; }
}
$("submit").addEventListener("click", async () => {
  const binary = $("binary").files[0], metadata = $("metadata").files[0];
  if (!binary || !metadata) { alert("Vui lòng chọn đủ executable và global-metadata.dat."); return; }
  const form = new FormData(); form.append("binary", binary); form.append("metadata", metadata); form.append("fast", $("fast").checked ? "1" : "0");
  $("submit").disabled = true; $("submit").textContent = "Đang tải file và gửi tác vụ...";
  try {
    const r = await fetch(`${API}/api/jobs`, { method: "POST", headers: headers(), body: form });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || "Upload failed");
    showJob(d.job); clearInterval(pollHandle); pollHandle = setInterval(() => poll(d.job.id), 5000); await poll(d.job.id);
  } catch (e) { alert(e.message); $("submit").disabled = false; }
  finally { $("submit").textContent = "Bắt đầu Dump →"; }
});
