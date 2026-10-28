const ext = typeof browser !== "undefined" ? browser : chrome;
const t = (k, s) => { try { const m = ext.i18n.getMessage(k, s); if (m) return m; } catch (e) {} return k; };
const $ = (i) => document.getElementById(i);
const send = (m) => new Promise((ok) => ext.runtime.sendMessage(m, (r) => ok(ext.runtime.lastError ? { ok: false, error: ext.runtime.lastError.message } : r)));
const aviso = (txt, ok) => { $("msg").textContent = txt; $("msg").className = ok ? "ok" : "err"; };
document.querySelectorAll("[data-i18n]").forEach((el) => { const m = t(el.getAttribute("data-i18n")); if (m && m !== el.getAttribute("data-i18n")) el.textContent = m; });
async function pintar() {
  $("ver").textContent = ext.runtime.getManifest().version;
  const s = await ext.storage.local.get({ sync: false, datos: [], transport: "direct", inbox_url: "", device_token: "" });
  $("sync").checked = !!s.sync; $("nlocal").textContent = t("localCount", [String(s.datos.length)]);
  if ($("transport")) $("transport").value = s.transport || "direct";
  if ($("inbox_url") && !$("inbox_url").value) $("inbox_url").value = s.inbox_url || "";
  if ($("device_token") && !$("device_token").value && s.device_token) $("device_token").placeholder = t("tokenSaved");
}
if ($("presetLocal")) $("presetLocal").onclick = () => { if ($("inbox_url")) $("inbox_url").value = "http://127.0.0.1:8911"; };
if ($("guardarInbox")) $("guardarInbox").onclick = async () => {
  const cur = await ext.storage.local.get({ inbox_url: "", device_token: "", transport: "direct" });
  const patch = {
    transport: $("transport").value,
    inbox_url: $("inbox_url").value.trim() || cur.inbox_url,
    device_token: $("device_token").value.trim() || cur.device_token,
  };
  if (patch.inbox_url && ext.permissions && ext.permissions.request) {
    let origin = "";
    try { origin = new URL(patch.inbox_url).origin + "/*"; } catch (e) {}
    if (origin) {
      const granted = await new Promise((ok) => { try { ext.permissions.request({ origins: [origin] }, ok); } catch (e) { ok(false); } });
      if (!granted) { $("msgInbox").textContent = t("permDenied"); $("msgInbox").className = "err"; return; }
    }
  }
  const r = await send({ tipo: "directConfig", inbox_url: patch.inbox_url, device_token: patch.device_token });
  if (!r || !r.ok) { $("msgInbox").textContent = (r && r.error) || t("stateError"); $("msgInbox").className = "err"; return; }
  await ext.storage.local.set(patch);
  $("msgInbox").textContent = t("saved"); $("msgInbox").className = "ok"; $("device_token").value = "";
};
if ($("probarInbox")) $("probarInbox").onclick = async () => {
  $("msgInbox").textContent = t("sendingTest");
  const r = await send({ tipo: "prueba" });
  $("msgInbox").textContent = (r && r.ok) ? t("connectionOk") : ((r && r.error) || t("stateError"));
  $("msgInbox").className = (r && r.ok) ? "ok" : "err";
};
$("sync").onchange = async () => { await send({ tipo: "sync", on: $("sync").checked }); pintar(); };
$("exportar").onclick = async () => {
  const r = await send({ tipo: "exportar" }); if (!r || !r.ok) return aviso(t("stateError"), false);
  const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 1)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "echolike-export-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  aviso(t("exported", [String(r.data.count)]), true);
};
$("importar").onchange = async (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  let obj; try { obj = JSON.parse(await f.text()); } catch (x) { return aviso(t("errImportFormat"), false); }
  const r = await send({ tipo: "importar", data: obj }); e.target.value = "";
  if (!r || !r.ok) return aviso((r && r.error) || t("stateError"), false);
  aviso(t("imported", [String(r.added), String(r.total)]), true); pintar();
};
ext.storage.onChanged.addListener(() => pintar());
pintar();
