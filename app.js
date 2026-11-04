/* Assistente Fiscal PT — versão local, sem IA e sem recolha automática de legislação. */
const DB_NAME = "assistente-fiscal-pt-v1";
const DB_VERSION = 1;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const today = () => new Date().toLocaleDateString("en-CA");
const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
const headers = ["diariodarepublica.pt", "info.portaldasfinancas.gov.pt", "cnc.min-financas.pt", "www.cnc.min-financas.pt", "eur-lex.europa.eu", "www.occ.pt", "occ.pt"];

const portals = [
  { name: "Diário da República", detail: "Legislação publicada e versões consolidadas", category: "Primária", url: "https://diariodarepublica.pt/" },
  { name: "Autoridade Tributária", detail: "Códigos tributários, instruções e doutrina", category: "Primária", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/Pages/default.aspx" },
  { name: "Comissão de Normalização Contabilística", detail: "SNC e normas de relato financeiro", category: "Primária", url: "https://www.cnc.min-financas.pt/snc2016.html" },
  { name: "EUR-Lex", detail: "Legislação e diretivas da União Europeia", category: "Primária", url: "https://eur-lex.europa.eu/" },
  { name: "Ordem dos Contabilistas Certificados", detail: "Pareceres técnicos complementares", category: "Complementar", url: "https://www.occ.pt/" }
];
const updates = [
  { name: "Índices RSS — Diário da República", detail: "Publicações oficiais do dia", url: "https://diariodarepublica.pt/dr/geral/notificacoes/rss" },
  { name: "Atualidades — Autoridade Tributária", detail: "Novidades fiscais e administrativas", url: "https://info.portaldasfinancas.gov.pt/pt/atualidades/Paginas/default.aspx" },
  { name: "Instruções administrativas — AT", detail: "Circulares e ofícios-circulados", url: "https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/Pages/default.aspx" },
  { name: "Normas e legislação — CNC", detail: "Referencial contabilístico português", url: "https://www.cnc.min-financas.pt/snc2016.html" }
];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sources")) db.createObjectStore("sources", { keyPath: "id" });
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let db;
function all(storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function mutation(storeName, method, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    if (method === "clear") store.clear();
    else store[method](value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function newElement(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function makeExternalLink(url, label = "Abrir fonte ↗") {
  const a = newElement("a", "source-link", label);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}
function emptyState(text, extra) {
  const box = newElement("div", "empty-state");
  box.append(newElement("span", "empty-symbol", "▤"), newElement("p", "", text));
  if (extra) box.append(newElement("small", "", extra));
  return box;
}
function isOfficialUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && headers.includes(u.hostname.toLowerCase());
  } catch { return false; }
}
function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", isError);
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 4400);
}
function showView(view) {
  if (!["consulta", "fontes", "historico", "atualizacoes", "definicoes"].includes(view)) return;
  $$(".view").forEach(section => {
    const active = section.id === "view-" + view;
    section.hidden = !active;
    section.classList.toggle("active", active);
  });
  $$("[data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#sectionTitle").textContent = { consulta: "Consulta fiscal", fontes: "Fontes fiscais", historico: "Histórico", atualizacoes: "Atualizações", definicoes: "Definições" }[view];
  history.replaceState(null, "", "#" + view);
  window.scrollTo({ top: 0, behavior: "instant" });
  if (view === "fontes") renderSavedSources();
  if (view === "historico") renderHistory();
  if (view === "definicoes") renderStorage();
}
function renderPortals() {
  const root = $("#officialSources");
  root.replaceChildren();
  portals.forEach(source => {
    const card = newElement("article", "official-card");
    card.append(newElement("span", "source-category", source.category), newElement("h3", "", source.name), newElement("p", "", source.detail), makeExternalLink(source.url));
    root.append(card);
  });
  const links = $("#updatesLinks");
  links.replaceChildren();
  updates.forEach(source => {
    const card = newElement("article", "list-card");
    const info = newElement("div");
    info.append(newElement("strong", "", source.name), newElement("p", "", source.detail));
    card.append(info, makeExternalLink(source.url));
    links.append(card);
  });
}
async function renderSavedSources() {
  const root = $("#savedSources");
  root.replaceChildren();
  try {
    const sources = (await all("sources")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!sources.length) { root.append(emptyState("Ainda não adicionaste documentos.", "Usa «Adicionar documento» para guardar texto de uma fonte oficial.")); return; }
    sources.forEach(source => {
      const card = newElement("article", "list-card");
      const info = newElement("div");
      info.append(newElement("strong", "", source.title), newElement("p", "", "Versão consultada em " + formatDate(source.consultedAt) + " · Texto guardado apenas neste dispositivo"));
      const buttons = newElement("div", "list-actions");
      const remove = newElement("button", "button button-danger button-small", "Eliminar");
      remove.type = "button";
      remove.addEventListener("click", async () => {
        if (!confirm("Eliminar o documento «" + source.title + "» deste dispositivo?")) return;
        await mutation("sources", "delete", source.id);
        await renderSavedSources();
        toast("Documento eliminado.");
      });
      buttons.append(makeExternalLink(source.url), remove);
      card.append(info, buttons);
      root.append(card);
    });
  } catch { root.append(emptyState("Não foi possível ler os documentos guardados.")); }
}
function formatDate(date) {
  const d = new Date(date.includes("T") ? date : date + "T12:00:00");
  return Number.isNaN(d.getTime()) ? date : new Intl.DateTimeFormat("pt-PT", { dateStyle: "medium" }).format(d);
}
const stopwords = new Set(["qual", "quais", "quando", "como", "para", "sobre", "este", "esta", "esse", "essa", "com", "uma", "das", "dos", "que", "por", "pode", "devem", "deve", "nos", "nas", "ser", "tem", "sao", "são", "seus", "seja", "mais", "pela", "pelo", "onde", "quero"]);
function normalize(text) { return text.toLocaleLowerCase("pt-PT").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function words(text) {
  return [...new Set(normalize(text).match(/[a-z0-9]{3,}/g) || [])].filter(word => !stopwords.has(word));
}
function findMatches(question, sources) {
  const terms = words(question);
  if (!terms.length) return [];
  const results = [];
  sources.forEach(source => {
    const passages = source.text.split(/(?:\r?\n){2,}/).flatMap(p => p.length > 1400 ? p.match(/[\s\S]{1,1200}/g) || [] : [p]);
    passages.forEach(pass => {
      const normalized = normalize(pass);
      const found = terms.filter(term => normalized.includes(term));
      if (!found.length) return;
      const score = found.length * 3 + (found.length === terms.length ? 4 : 0);
      let start = Math.min(...found.map(term => normalized.indexOf(term)));
      start = Math.max(0, start - 75);
      const excerpt = (start ? "…" : "") + pass.slice(start, start + 400).trim() + (start + 400 < pass.length ? "…" : "");
      results.push({ source, score, excerpt });
    });
  });
  return results.sort((a, b) => b.score - a.score).slice(0, 6);
}
async function runQuery(question, topic, keepHistory = true) {
  const root = $("#resultsArea");
  root.hidden = false;
  root.replaceChildren();
  const sources = await all("sources");
  const matches = findMatches(question, sources);
  if (keepHistory) await mutation("history", "put", { id: id(), question, topic, createdAt: nowIso(), matchCount: matches.length });
  root.append(newElement("h2", "results-heading", matches.length ? matches.length + " excerto(s) encontrados" : "Sem excertos encontrados"));
  const disclaimer = newElement("p", "results-disclaimer", "Os excertos são resultados de pesquisa textual. Não são uma resposta de IA, parecer fiscal ou confirmação da legislação em vigor.");
  root.append(disclaimer);
  if (!sources.length) {
    root.append(emptyState("Não existem ainda textos legais guardados.", "No separador Fontes fiscais, adiciona texto de documentos oficiais para começar a pesquisa."));
  } else if (!matches.length) {
    root.append(emptyState("A pesquisa não encontrou correspondências nos documentos guardados.", "Isto não significa que a legislação não exista. Consulta os portais oficiais."));
  } else {
    matches.forEach(match => {
      const card = newElement("article", "result-card");
      card.append(newElement("strong", "", match.source.title), newElement("p", "", match.excerpt), newElement("small", "", "Versão consultada em " + formatDate(match.source.consultedAt)));
      card.append(makeExternalLink(match.source.url, "Conferir no site oficial ↗"));
      root.append(card);
    });
  }
  root.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function renderHistory() {
  const root = $("#historyList");
  root.replaceChildren();
  try {
    const historyEntries = (await all("history")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!historyEntries.length) { root.append(emptyState("Ainda não existem consultas.", "As perguntas pesquisadas aparecerão aqui.")); return; }
    historyEntries.forEach(entry => {
      const card = newElement("article", "list-card");
      const info = newElement("div");
      info.append(newElement("strong", "", entry.question), newElement("p", "", entry.topic + " · " + formatDate(entry.createdAt) + " · " + entry.matchCount + " excertos na pesquisa original"));
      const button = newElement("button", "button button-outline button-small", "Pesquisar novamente");
      button.type = "button";
      button.addEventListener("click", async () => {
        showView("consulta");
        $("#question").value = entry.question;
        $("#topic").value = entry.topic;
        await runQuery(entry.question, entry.topic, false);
      });
      card.append(info, button);
      root.append(card);
    });
  } catch { root.append(emptyState("Não foi possível carregar o histórico.")); }
}
async function renderStorage() {
  if (!navigator.storage?.estimate) { $("#storageInfo").textContent = "Estimativa de armazenamento indisponível neste navegador."; return; }
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    $("#storageInfo").textContent = "Utilizado: " + (usage / 1024 / 1024).toFixed(1) + " MB" + (quota ? " · Disponível no navegador: " + (quota / 1024 / 1024).toFixed(0) + " MB" : "");
  } catch { $("#storageInfo").textContent = "Não foi possível consultar o armazenamento disponível."; }
}
async function exportData() {
  const backup = { app: "assistente-fiscal-pt", version: 1, exportedAt: nowIso(), sources: await all("sources"), history: await all("history") };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Assistente_Fiscal_PT_Backup_" + today() + ".json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup transferido. Guarda o ficheiro num local seguro.");
}
function validBackup(data) {
  if (data?.app !== "assistente-fiscal-pt" || data.version !== 1 || !Array.isArray(data.sources) || !Array.isArray(data.history)) return false;
  if (data.sources.length > 2000 || data.history.length > 50000) return false;
  return data.sources.every(s => typeof s.id === "string" && typeof s.title === "string" && typeof s.text === "string" && s.text.length <= 2000000 && typeof s.consultedAt === "string" && typeof s.createdAt === "string" && isOfficialUrl(s.url))
    && data.history.every(h => typeof h.id === "string" && typeof h.question === "string" && typeof h.topic === "string" && typeof h.createdAt === "string" && typeof h.matchCount === "number");
}
async function restoreData(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) throw new Error("O backup é demasiado grande para esta versão.");
  const data = JSON.parse(await file.text());
  if (!validBackup(data)) throw new Error("O ficheiro não é um backup válido do Assistente Fiscal PT.");
  if (!confirm("Restaurar este backup? Os documentos e o histórico existentes neste dispositivo serão substituídos.")) return;
  // Reposição atómica: se algum registo falhar, a transação não substitui parcialmente os dados.
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["sources", "history"], "readwrite");
    tx.objectStore("sources").clear();
    tx.objectStore("history").clear();
    data.sources.forEach(s => tx.objectStore("sources").put(s));
    data.history.forEach(h => tx.objectStore("history").put(h));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  toast("Backup restaurado com sucesso.");
  await renderSavedSources();
  await renderHistory();
}
function setupInstall() {
  let installPrompt;
  const button = $("#installButton");
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    button.textContent = "Instalar no PC";
  });
  button.addEventListener("click", async () => {
    if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return toast("A aplicação já está instalada.");
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    } else if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
      toast("No iPhone, usa Partilhar → Adicionar ao ecrã principal.");
    } else {
      toast("Quando a instalação estiver disponível, o navegador mostrará a opção Instalar aplicação.");
    }
  });
  window.addEventListener("appinstalled", () => { button.textContent = "Instalada"; toast("Assistente Fiscal PT instalado."); });
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) button.textContent = "Instalada";
}
function setupNetwork() {
  const refresh = () => {
    $("#networkStatus").textContent = navigator.onLine ? "Online" : "Offline";
    $("#networkStatus").classList.toggle("offline", !navigator.onLine);
  };
  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  refresh();
}
function setupHandlers() {
  $$("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  $$("[data-topic]").forEach(button => button.addEventListener("click", () => { $("#topic").value = button.dataset.topic; $("#question").focus(); }));
  $("#queryForm").addEventListener("submit", async event => {
    event.preventDefault();
    const question = $("#question").value.trim();
    if (!question) return;
    try { await runQuery(question, $("#topic").value); } catch { toast("Não foi possível guardar a consulta.", true); }
  });
  const dialog = $("#sourceDialog");
  $("#addSourceButton").addEventListener("click", () => { $("#sourceForm").reset(); $("#sourceDate").value = today(); $("#sourceFormError").textContent = ""; dialog.showModal(); });
  $("#closeSourceDialog").addEventListener("click", () => dialog.close());
  $("#cancelSourceDialog").addEventListener("click", () => dialog.close());
  $("#sourceForm").addEventListener("submit", async event => {
    event.preventDefault();
    const title = $("#sourceTitle").value.trim();
    const url = $("#sourceUrl").value.trim();
    const text = $("#sourceText").value.trim();
    const consultedAt = $("#sourceDate").value;
    if (!isOfficialUrl(url)) { $("#sourceFormError").textContent = "A ligação deve ser HTTPS e pertencer a um portal autorizado."; return; }
    if (text.length < 30 || text.length > 2000000) { $("#sourceFormError").textContent = "O texto deve ter entre 30 e 2.000.000 caracteres."; return; }
    if (!title || !consultedAt) return;
    try {
      await mutation("sources", "put", { id: id(), title, url, text, consultedAt, createdAt: nowIso() });
      dialog.close();
      await renderSavedSources();
      toast("Documento guardado localmente.");
    } catch { $("#sourceFormError").textContent = "Não foi possível guardar. Verifica o espaço disponível."; }
  });
  $("#exportButton").addEventListener("click", () => exportData().catch(() => toast("Falha ao exportar backup.", true)));
  $("#importFile").addEventListener("change", async event => {
    try { await restoreData(event.target.files[0]); }
    catch (error) { toast(error.message || "Falha ao restaurar backup.", true); }
    finally { event.target.value = ""; }
  });
  $("#clearHistoryButton").addEventListener("click", async () => {
    if (!confirm("Eliminar definitivamente todo o histórico de consultas neste dispositivo?")) return;
    await mutation("history", "clear");
    toast("Histórico eliminado.");
    renderHistory();
  });
}
async function start() {
  renderPortals();
  setupNetwork();
  setupInstall();
  try { db = await openDB(); setupHandlers(); showView(location.hash.replace("#", "") || "consulta"); }
  catch {
    toast("O armazenamento local está indisponível. Verifica as permissões do navegador.", true);
    $$(".button").forEach(button => { if (button.id !== "installButton") button.disabled = true; });
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    });
  }
}
start();
