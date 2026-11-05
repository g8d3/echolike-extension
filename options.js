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

function usageText(u) {
  const c = (u && u.credits) || {}, q = (u && u.quota) || {}, b = (u && u.balance) || null;
  let s = (c.today ?? "?") + " credits today · " + (q.left_today ?? "?") + " left";
  if (b && typeof b.left_total === "number")
    s += " · balance " + b.left_total + " (granted " + (b.granted_total ?? "?") + ")";
  const g = (b && Array.isArray(b.recent_grants) && b.recent_grants[0]) || null;
  if (g && typeof g.credits === "number")
    s += " · last grant +" + g.credits + (g.reason ? " " + g.reason : "");
  return s;
}
function spentText(h) {
  if (!Array.isArray(h) || !h.length) return "";
  let s = 0, g = 0;
  for (const r of h) {
    if (r && Number.isFinite(r.spent)) s += r.spent;
    if (r && Number.isFinite(r.granted)) g += r.granted;
  }
  if (s <= 0 && g <= 0) return "";
  return "Last 7d: " + s + " spent · " + g + " granted";
}
function topupText(b, q) {
  const left = b && b.left_total;
  if (typeof left !== "number" || left > 0) return "";
  const spent = (b && b.spent_total) || 0;
  const refused = (q && q.would_block_today) || 0;
  if (!(spent > 0 || refused > 0)) return "";
  return "Top-up needed: balance " + left;
}
async function usage(s) {
  const el = $("msgUsage");
  if (!el) return;
  el.textContent = "";
  const sp = $("msgSpend");
  if (sp) sp.textContent = "";
  const tp = $("msgTopup");
  if (tp) tp.textContent = "";
  if (!s.inbox_url || !s.device_token) return;
  try {
    const r = await fetch(s.inbox_url.replace(/\/$/, "") + "/api/usage", { headers: { authorization: "Bearer " + s.device_token } });
    if (!r.ok) return;
    const u = await r.json();
    if (!u || !u.ok) return;
    el.textContent = usageText(u);
    if (sp) sp.textContent = spentText(u.history);
    if (tp) tp.textContent = topupText(u.balance, u.quota);
  } catch (e) { /* offline inbox: lines stay empty, nothing breaks */ }
}
function payText(c) {
  const sol = (c && c.sol) || "", evm = (c && c.evm) || "";
  if (sol && evm) return "Top up: SOL " + sol + " \u00b7 EVM " + evm;
  if (sol) return "Top up: SOL " + sol;
  if (evm) return "Top up: EVM " + evm;
  return "";
}
async function pay(s) {
  const el = $("msgPay");
  if (!el) return;
  el.textContent = "";
  if (!s.inbox_url) return;
  try {
    const r = await fetch(s.inbox_url.replace(/\/$/, "") + "/api/health", { cache: "no-store" });
    if (!r.ok) return;
    const h = await r.json();
    if (!h || !h.ok) return;
    el.textContent = payText(h.checkout);
  } catch (e) { /* offline inbox: line stays empty, nothing breaks */ }
}
function parkText(hasta, n, now) {
  if (!hasta || (now === undefined ? Date.now() : now) >= hasta) return "";
  return ((n > 0) ? n + " queued \u00b7 " : "") + "resumes midnight";
}
function park(s) {
  const el = $("msgPark");
  if (!el) return;
  el.textContent = "";
  if (!s) return;
  el.textContent = parkText(s.quota429hasta || 0, (s.cola || []).length);
}
async function redeem() {
  const codeEl = $("redeem_code"), refEl = $("redeem_ref"), msgEl = $("msgRedeem");
  const code = ((codeEl && codeEl.value) || "").trim();
  if (!code) { texto(msgEl, t("errRedeemBlank"), false); return; }
  const ref = ((refEl && refEl.value) || "").trim();
  const s = await ext.storage.local.get({ inbox_url: "", device_token: "" });
  if (!s.inbox_url || !s.device_token) { texto(msgEl, t("notConnected"), false); return; }
  texto(msgEl, t("redeeming"), true);
  const body = { code };
  if (ref) body.referred_by = ref;
  let r;
  try {
    r = await fetch(s.inbox_url.replace(/\/$/, "") + "/api/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + s.device_token },
      body: JSON.stringify(body)
    });
  } catch (e) { texto(msgEl, t("errCantReach"), false); return; }
  let j = null;
  try { j = await r.json(); } catch (e) {}
  if (r.ok && j && j.ok) {
    codeEl.value = "";
    if (refEl) refEl.value = "";
    texto(msgEl, t("redeemOk", [String(j.granted_total ?? "")]), true);
    await pintar();
    return;
  }
  const err = String((j && j.error) || "");
  if (r.status === 409 && /revoked/.test(err)) texto(msgEl, t("errRedeemRevoked"), false);
  else if (r.status === 403 || /not for you/.test(err)) texto(msgEl, t("errRedeemNotYours"), false);
  else if (r.status === 409 || /already redeemed/.test(err)) texto(msgEl, t("errRedeemUsed"), false);
  else if (r.status === 401) texto(msgEl, t("errBadToken"), false);
  else if (/not found/.test(err)) texto(msgEl, t("errRedeemOldServer"), false);
  else if (r.status === 404) texto(msgEl, t("errRedeemUnknown"), false);
  else if (r.status === 410 || /expired/.test(err)) texto(msgEl, t("errRedeemExpired"), false);
  else texto(msgEl, err || t("stateError"), false);
}
async function pintar() {
  $("ver").textContent = ext.runtime.getManifest().version;
  const s = await ext.storage.local.get({ sync: false, datos: [], transport: "direct", inbox_url: "", device_token: "", quota429hasta: 0, cola: [] });
  usage(s);
  pay(s);
  park(s);
  const box = $("boxRedeem");
  if (box) box.style.display = (s.inbox_url && s.device_token) ? "" : "none";
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

if ($("redeem")) $("redeem").onclick = redeem;
if ($("redeem_code")) $("redeem_code").addEventListener("keydown", (e) => { if (e.key === "Enter") redeem(); });
if ($("redeem_ref")) $("redeem_ref").addEventListener("keydown", (e) => { if (e.key === "Enter") redeem(); });
$("conectar").onclick = conectar;
if ($("auto")) $("auto").onclick = async () => {
  texto($("msgInbox"), t("connecting"), true);
  const r = await send({ tipo: "autoconectar" });
  if (r && r.ok) {
    const test = await send({ tipo: "prueba" });
    if (test && test.ok) { texto($("msgInbox"), t("connectedTo", [r.inbox_url]), true); await pintar(); return; }
    texto($("msgInbox"), (test && test.error) || t("stateError"), false); return;
  }
  texto($("msgInbox"), (r && r.error) || t("stateError"), false);
};
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
const hora = (s) => { try { return s ? new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; } catch (e) { return ""; } };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function diagResumen(it) {
  const z = it.traza || {};
  if (z.error) return "diag failed: " + String(z.error).slice(0, 60);
  const que = z.es_articulo ? ("article " + z.es_articulo) : z.es_tweet ? ("tweet " + z.es_tweet) : (it.url || "");
  return ("diag " + que).slice(0, 120);
}
async function probar() {
  const url = ($("url") && $("url").value || "").trim();
  const box = $("diag");
  if (!url) { if (box) box.textContent = "Paste a URL first."; return; }
  box.textContent = "Testing…";
  const r = await send({ tipo: "diagnostico", url });
  box.textContent = r && r.ok
    ? "Saved locally, sending to inbox…\n" + JSON.stringify(r.trace, null, 1).slice(0, 1200)
    : "Test failed: " + ((r && r.error) || "no answer from background");
  pintar();
  setTimeout(async () => { await send({ tipo: "acuses" }); pintar(); }, 8000);
}
