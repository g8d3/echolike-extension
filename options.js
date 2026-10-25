const ext = typeof browser !== "undefined" ? browser : chrome;
const t = (k, s) => { try { const m = ext.i18n.getMessage(k, s); if (m) return m; } catch (e) {} return k; };
const $ = (i) => document.getElementById(i);
const send = (m) => new Promise((ok) => ext.runtime.sendMessage(m, (r) => ok(ext.runtime.lastError ? { ok: false, error: ext.runtime.lastError.message } : r)));
const aviso = (txt, ok) => { $("msg").textContent = txt; $("msg").className = ok ? "ok" : "err"; };
document.querySelectorAll("[data-i18n]").forEach((el) => { const m = t(el.getAttribute("data-i18n")); if (m && m !== el.getAttribute("data-i18n")) el.textContent = m; });
async function pintar() {
  $("ver").textContent = ext.runtime.getManifest().version;
  const s = await ext.storage.local.get({ sync: false, datos: [] });
  $("sync").checked = !!s.sync; $("nlocal").textContent = t("localCount", [String(s.datos.length)]);
}
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
