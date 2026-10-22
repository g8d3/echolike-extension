const ext = typeof browser !== "undefined" ? browser : chrome;
const t = (k, s) => { try { const m = ext && ext.i18n && ext.i18n.getMessage(k, s); if (m) return m; } catch (e) {} return k; };
const $ = (i) => document.getElementById(i);
const send = (m) => new Promise((ok) => ext.runtime.sendMessage(m, (r) => ok(ext.runtime.lastError ? { ok: false, error: ext.runtime.lastError.message } : r)));
const hora = (s) => s ? new Date(s).toLocaleTimeString() : "";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function stateLabel(estado) {
  if (estado === "recibido") return t("stateReceived");
  if (estado === "enviado") return t("stateSent");
  if (estado === "en cola") return t("stateQueued");
  if (estado === "error") return t("stateError");
  return String(estado ?? "");
}
function applyI18n() {
  try {
    if (!document.querySelectorAll) return;
    const url = t("connectUrl");
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const k = el.getAttribute && el.getAttribute("data-i18n");
      if (!k || k === "footerTrouble") return;
      const m = t(k);
      if (m && m !== k) el.textContent = m;
    });
    if (document.querySelectorAll("[data-i18n-title]").forEach) {
      document.querySelectorAll("[data-i18n-title]").forEach((el) => {
        const k = el.getAttribute && el.getAttribute("data-i18n-title");
        if (!k) return;
        const m = t(k);
        if (m && m !== k) el.title = m;
      });
    }
    document.querySelectorAll("a.connectLink").forEach((a) => { if (url && url !== "connectUrl") a.href = url; });
    const foot = document.querySelector('[data-i18n="footerTrouble"]');
    if (foot) {
      const href = t("connectUrl");
      const linkText = t("privatePage");
      const tpl = t("footerTrouble", ["\u0001"]);
      if (tpl && tpl !== "footerTrouble" && tpl.includes("\u0001")) {
        const parts = tpl.split("\u0001");
        foot.innerHTML = esc(parts[0]) + '<a class="connectLink" href="' + esc(href) + '" target="_blank">' + esc(linkText) + "</a>" + esc(parts.slice(1).join("\u0001"));
        const a = foot.querySelector && foot.querySelector("a.connectLink");
        if (a && href && href !== "connectUrl") a.href = href;
      }
    }
  } catch (e) {}
}
applyI18n();
async function pintar() {
  const c = await ext.storage.local.get({ codigo: "", mic: true, eventos: [], ultimo: null, cola: [], ultimo_ack: null, hoy: null });
  $("ver").textContent = ext.runtime.getManifest().version;
  if ($("mic")) $("mic").checked = c.mic;
  const v = await send({ tipo: "validar", codigo: c.codigo });
  const evs = c.eventos || [];
  const nrec = evs.filter((e) => e.estado === "recibido").length;
  const url = t("connectUrl");
  let cabeza;
  if (v && v.error) cabeza = `<span class=warn>${esc(t("notConnected"))}</span> <a href="${esc(url)}" target="_blank">${esc(t("connectOneClick"))}</a>`;
  else if (nrec > 0) cabeza = `<span class=ok>${esc(t("statusConnected"))}</span>`;
  else cabeza = `<span class=warn>${esc(t("statusNoConfirm"))}</span> <a href="${esc(url)}" target="_blank">${esc(t("openPrivateConnect"))}</a>`;
  const u = c.ultimo;
  const box = document.getElementById("parbox");
  if (box && box.style) box.style.display = ((v && v.error) || nrec === 0) ? "" : "none";
  const cd = document.getElementById("codigo");
  if (cd) { cd.textContent = c.codigo || "—"; cd.onclick = async () => { try { await navigator.clipboard.writeText(c.codigo || ""); const ok2 = document.getElementById("copiado"); if (ok2) ok2.textContent = t("copied"); } catch (e) {} }; }
  const h = c.hoy && c.hoy.d === new Date().toLocaleDateString("en-CA") ? c.hoy : { likes: 0, bookmarks: 0 };
  $("estado").innerHTML = cabeza +
      (u ? `<br>${esc(t("lastLabel"))} ${esc(u.kind)} ${hora(u.at)} — <span class=${u.estado === "error" ? "err" : u.estado === "recibido" ? "rec" : "ok"}>${esc(stateLabel(u.estado))}</span>${u.error ? " · " + esc(u.error) : ""}` : `<br>${esc(t("nothingSentYet"))}`);
  $("estado").innerHTML += (c.cola.length ? `<br><span class=err>${esc(t("pendingRetry", [String(c.cola.length)]))}</span>` : "") +
    (c.ultimo_ack ? `<br><small>${esc(t("lastConfirm", [hora(c.ultimo_ack)]))}</small>` : "");
  $("hoy").textContent = t("todayCounter", [String(h.likes), String(h.bookmarks)]);
  $("ev").innerHTML = c.eventos.map((e) => `<tr><td>${hora(e.at)}</td><td>${esc(e.kind)}</td><td>${e.handle ? "@" + esc(e.handle) : ""}</td>` +
    `<td class=${e.estado === "error" ? "err" : e.estado === "recibido" ? "rec" : "ok"}>${esc(stateLabel(e.estado))}${e.error ? "<br>" + esc(e.error) : ""}</td></tr>`).join("");
}
if ($("mic")) $("mic").onchange = async () => { await ext.storage.local.set({ mic: $("mic").checked }); };
$("probar").onclick = async () => {
  $("estado").textContent = t("sendingTest"); const r = await send({ tipo: "prueba" }); await pintar();
  if (r && r.ok) setTimeout(async () => { await send({ tipo: "acuses" }); pintar(); }, 8000);
};
ext.storage.onChanged.addListener(() => pintar());
pintar(); send({ tipo: "acuses" }).then(pintar);
