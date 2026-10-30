const ext = typeof browser !== "undefined" ? browser : chrome;
const t = (k, s) => { try { const m = ext.i18n.getMessage(k, s); if (m) return m; } catch (e) {} return k; };
const $ = (i) => document.getElementById(i);
const send = (m) => new Promise((ok) => ext.runtime.sendMessage(m, (r) => ok(ext.runtime.lastError ? { ok: false, error: ext.runtime.lastError.message } : r)));
const texto = (el, txt, ok) => { if (!el) return; el.textContent = txt; el.className = ok ? "ok" : "err"; };

document.querySelectorAll("[data-i18n]").forEach((el) => {
  const k = el.getAttribute("data-i18n");
  const m = t(k);
  if (m && m !== k) el.textContent = m;
});

async function pintar() {
  $("ver").textContent = ext.runtime.getManifest().version;
  const s = await ext.storage.local.get({ sync: false, datos: [], transport: "direct", inbox_url: "", device_token: "" });
  $("sync").checked = !!s.sync;
  $("nlocal").textContent = String(s.datos.length) + (s.sync ? " ✓" : "");
  $("transport").value = s.transport || "direct";
  if (!$("inbox_url").value) $("inbox_url").value = s.inbox_url || "";
  if (s.device_token && s.inbox_url) texto($("msgInbox"), t("connectedTo", [s.inbox_url]), true);
}

function urlOk(raw) {
  try {
    const u = new URL(raw);
    if (u.port === "8904") { texto($("msgInbox"), t("errIsVault"), false); return null; }
    if (u.protocol === "https:" && /^(\d+\.\d+\.\d+\.\d+|localhost|\[.*\])$/.test(u.hostname)) {
      texto($("msgInbox"), t("errHttpsIp"), false);
      return null;
    }
    return u;
  } catch (e) {
    texto($("msgInbox"), t("errBadInboxUrl"), false);
    return null;
  }
}

async function pedirPermiso(url) {
  if (!(ext.permissions && ext.permissions.request)) return true;
  let origin = "";
  try { origin = new URL(url).origin + "/*"; } catch (e) { return true; }
  const ok = await new Promise((res) => { try { ext.permissions.request({ origins: [origin] }, res); } catch (e) { res(false); } });
  if (!ok) texto($("msgInbox"), t("permDenied"), false);
  return ok;
}

// One field, one button: probe, claim a token, save, test. No copy/paste.
async function conectar() {
  const raw = $("inbox_url").value.trim().replace(/\/$/, "");
  const u = urlOk(raw);
  if (!u) return;
  if (!(await pedirPermiso(raw))) return;
  texto($("msgInbox"), t("connecting"), true);
  let health = null;
  try {
    const r = await fetch(raw + "/api/health", { cache: "no-store" });
    health = r.ok ? await r.json() : null;
  } catch (e) {
    texto($("msgInbox"), t("errCantReach"), false);
    return;
  }
  if (!health || !health.ok) { texto($("msgInbox"), t("errCantReach"), false); return; }
  if (health.api && health.api < 2) { texto($("msgInbox"), t("errOldServer"), false); return; }

  const guardado = await ext.storage.local.get({ inbox_url: "", device_token: "" });
  let token = (guardado.inbox_url === raw && guardado.device_token) ? guardado.device_token : "";
  if (!token) {
    // the server mints it; it is stored here and never shown to the user
    try {
      const r = await fetch(raw + "/api/claim", { method: "POST" });
      const j = await r.json();
      if (j && j.device_token) token = j.device_token;
      else if (r.status === 403) { texto($("msgInbox"), t("errClaimClosed"), false); return; }
      else if (r.status === 409) { texto($("msgInbox"), t("errDeviceLimit"), false); return; }
      else if (r.status === 429) { texto($("msgInbox"), t("errTooManyClaims"), false); return; }
      else { texto($("msgInbox"), (j && j.error) || t("errClaim"), false); return; }
    } catch (e) { texto($("msgInbox"), t("errCantReach"), false); return; }
  }
  const r = await send({ tipo: "directConfig", inbox_url: raw, device_token: token });
  if (!r || !r.ok) { texto($("msgInbox"), (r && r.error) || t("stateError"), false); return; }
  await ext.storage.local.set({ inbox_url: raw, device_token: token, transport: "direct", sync: true });
  const test = await send({ tipo: "prueba" });
  if (test && test.ok) { texto($("msgInbox"), t("connectedTo", [raw]), true); await pintar(); return; }
  texto($("msgInbox"), (test && test.error) || t("stateError"), false);
}

$("conectar").onclick = conectar;
$("inbox_url").addEventListener("keydown", (e) => { if (e.key === "Enter") conectar(); });

if ($("guardarInbox")) $("guardarInbox").onclick = async () => {
  const raw = $("inbox_url").value.trim().replace(/\/$/, "");
  const u = urlOk(raw);
  if (!u) return;
  if (!(await pedirPermiso(raw))) return;
  const r = await send({ tipo: "directConfig", inbox_url: raw, device_token: $("device_token").value.trim() });
  if (!r || !r.ok) { texto($("msgInbox"), (r && r.error) || t("stateError"), false); return; }
  await ext.storage.local.set({ inbox_url: raw, device_token: $("device_token").value.trim() || undefined, transport: $("transport").value });
  $("device_token").value = "";
  texto($("msgInbox"), t("saved"), true);
};

if ($("probarInbox")) $("probarInbox").onclick = async () => {
  texto($("msgInbox"), t("sendingTest"), true);
  const r = await send({ tipo: "prueba" });
  let msg = (r && r.ok) ? t("connectionOk") : ((r && r.error) || t("stateError"));
  if (r && !r.ok && /Failed to fetch|NetworkError/.test(String(r.error || ""))) msg = t("errCantReach");
  if (r && !r.ok && String(r.error || "").includes("401")) msg = t("errBadToken");
  texto($("msgInbox"), msg, !!(r && r.ok));
};

$("sync").onchange = async () => { await send({ tipo: "sync", on: $("sync").checked }); pintar(); };
$("exportar").onclick = async () => {
  const r = await send({ tipo: "exportar" });
  if (!r || !r.ok) return texto($("msg"), t("stateError"), false);
  const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 1)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = "echolike-export-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  texto($("msg"), t("exported", [String(r.data.count)]), true);
};
$("importar").onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  let obj;
  try { obj = JSON.parse(await f.text()); } catch (x) { return texto($("msg"), t("errImportFormat"), false); }
  const r = await send({ tipo: "importar", data: obj });
  e.target.value = "";
  if (!r || !r.ok) return texto($("msg"), (r && r.error) || t("stateError"), false);
  texto($("msg"), t("imported", [String(r.added), String(r.total)]), true);
  pintar();
};
ext.storage.onChanged.addListener(() => pintar());
pintar();
