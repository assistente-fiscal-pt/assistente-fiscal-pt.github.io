/* Fernando — pesquisa documental em legislação oficial indexada e anexos locais. */
const DB_NAME = "assistente-fiscal-pt-v1"; // Mantido para preservar os dados da v0.1.
const DB_VERSION = 2;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_DOCUMENT_TEXT = 2_000_000;
const MAX_QUERY_FILES = 3;
const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const now = () => new Date().toISOString();
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

const primarySources = [
  { id:"at", initials:"AT", title:"Autoridade Tributária", description:"Códigos tributários, doutrina e instruções administrativas", type:"Oficial", url:"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/Pages/default-com-pdf.aspx", hosts:["info.portaldasfinancas.gov.pt"] },
  { id:"dr", initials:"DR", title:"Diário da República", description:"Publicações legislativas e versões consolidadas", type:"Oficial", url:"https://diariodarepublica.pt/", hosts:["diariodarepublica.pt"] },
  { id:"cnc", initials:"CNC", title:"Normalização Contabilística", description:"SNC e normas portuguesas de relato financeiro", type:"Oficial", url:"https://www.cnc.min-financas.pt/snc2016.html", hosts:["www.cnc.min-financas.pt","cnc.min-financas.pt"] },
  { id:"eurlex", initials:"EU", title:"EUR-Lex", description:"Diretivas e regulamentos da União Europeia", type:"Oficial", url:"https://eur-lex.europa.eu/", hosts:["eur-lex.europa.eu"] },
  { id:"occ", initials:"OCC", title:"Ordem dos Contabilistas Certificados", description:"Informação técnica complementar; não substitui a lei", type:"Complementar", url:"https://www.occ.pt/", hosts:["www.occ.pt","occ.pt"] }
];
const updateLinks = [
  {title:"Diário da República",subtitle:"Publicações legislativas oficiais",url:"https://diariodarepublica.pt/"},
  {title:"Autoridade Tributária",subtitle:"Atualidades e informação fiscal",url:"https://info.portaldasfinancas.gov.pt/pt/atualidades/Paginas/default.aspx"},
  {title:"Instruções da AT",subtitle:"Circulares, ofícios-circulados e orientações",url:"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/legislacao/Pages/default.aspx"},
  {title:"Comissão de Normalização Contabilística",subtitle:"Normas contabilísticas e legislação SNC",url:"https://www.cnc.min-financas.pt/snc2016.html"}
];
const stopwords = new Set("qual quais quando como para sobre este esta esse essa com uma das dos que por pode devem deve nos nas ser tem sao seus seja mais pela pelo onde quero existem existe artigo artigos quais quais quais umas uns uma quais sao deve posso posso fazer entre numa num das nos qual é sao são".split(" "));

let db;
let catalogSettings = {id:"catalog", disabled:[], custom:[]};
let queryAttachments = [];
let fileReading = false;
let legalIndexCache = null;

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function validHttpUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}
function link(url, label = "Consultar portal ↗") {
  const a = el("a", "source-link", label);
  a.href = url;
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  return a;
}
function pill(text, extra = "") { return el("span", "pill " + extra, text); }
function emptyState(title, description) {
  const box = el("div", "empty-state");
  box.append(el("span", "empty-mark", "▤"), el("strong", "", title), el("p", "", description));
  return box;
}
function toast(message, error = false) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
}
function formatDate(value) {
  if (!value || typeof value !== "string") return "Sem data";
  const parsed = new Date(value.includes("T") ? value : value + "T12:00:00");
  return isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("pt-PT", {dateStyle:"medium"}).format(parsed);
}
function normal(text) { return String(text).toLocaleLowerCase("pt-PT").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function keywords(text) { return [...new Set(normal(text).match(/[a-z0-9]{3,}/g) || [])].filter(w => !stopwords.has(w)); }
function dateSort(a,b) { return String(b.createdAt||"").localeCompare(String(a.createdAt||"")); }

function openDatabase() {
  return new Promise((resolve,reject) => {
    const req = indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      // Nunca limpar stores existentes numa atualização.
      if (!database.objectStoreNames.contains("sources")) database.createObjectStore("sources",{keyPath:"id"});
      if (!database.objectStoreNames.contains("history")) database.createObjectStore("history",{keyPath:"id"});
      if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings",{keyPath:"id"});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function all(storeName) {
  return new Promise((resolve,reject) => {
    const req = db.transaction(storeName,"readonly").objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function get(storeName,key) {
  return new Promise((resolve,reject) => {
    const req = db.transaction(storeName,"readonly").objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function mutate(storeName,action,value) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(storeName,"readwrite");
    if (action === "clear") tx.objectStore(storeName).clear();
    else tx.objectStore(storeName)[action](value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function catalog() { return [...primarySources,...catalogSettings.custom]; }
function enabled(id) { return !catalogSettings.disabled.includes(id); }
function enabledCatalog() { return catalog().filter(s => enabled(s.id)); }
function byCatalogId(id) { return catalog().find(s => s.id === id); }
function documentCatalogId(document) {
  if (document.catalogId) return byCatalogId(document.catalogId) ? document.catalogId : "local";
  if (!document.url) return "local";
  try {
    const host = new URL(document.url).hostname.toLowerCase();
    return catalog().find(s => s.hosts?.includes(host) || new URL(s.url).hostname.toLowerCase() === host)?.id || "local";
  } catch { return "local"; }
}
async function loadCatalog() {
  const stored = await get("settings","catalog");
  if (!stored) return;
  if (Array.isArray(stored.disabled) && Array.isArray(stored.custom)) {
    catalogSettings = {id:"catalog",disabled:stored.disabled.filter(x => typeof x === "string"),custom:stored.custom.filter(x => x && typeof x.id === "string" && validHttpUrl(x.url))};
  }
}
async function persistCatalog() {
  await mutate("settings","put",catalogSettings);
  await renderCatalog();
  renderMiniSources();
  renderDocumentSourceOptions();
  await updateCounts();
  refreshIndexStatus();
}
async function refreshIndexStatus() {
  const target = $("#indexStatus");
  if (!target) return;
  if (!enabled("at")) { target.textContent = "Pesquisa automática da AT desativada."; target.className = "index-status warning"; return; }
  try {
    const index = await loadLegalIndex();
    if (index.articleCount > 0) {
      target.textContent = `${index.articleCount} artigos da AT disponíveis · ${formatDate(index.generatedAt)}`;
      target.className = "index-status ready";
    } else {
      target.textContent = "A recolha dos artigos está pendente. Ativa a tarefa no GitHub Actions.";
      target.className = "index-status warning";
    }
  } catch {
    target.textContent = "Sem ligação ao índice oficial. Documentos locais disponíveis.";
    target.className = "index-status warning";
  }
}
async function setEnabled(id,active) {
  const list = new Set(catalogSettings.disabled);
  if (active) list.delete(id); else list.add(id);
  catalogSettings.disabled = [...list];
  try { await persistCatalog(); }
  catch { toast("Não foi possível guardar a seleção.",true); }
}

function showView(view) {
  const valid = ["consulta","fontes","historico","atualizacoes","definicoes"];
  if (!valid.includes(view)) return;
  $$(".view").forEach(node => {
    const on = node.id === `view-${view}`;
    node.hidden = !on;
    node.classList.toggle("active",on);
  });
  $$('[data-view]').forEach(button => {
    const on = button.dataset.view === view;
    button.classList.toggle("active",on);
    if (on) button.setAttribute("aria-current","page"); else button.removeAttribute("aria-current");
  });
  $("#sectionTitle").textContent = {consulta:"Perguntar",fontes:"As minhas fontes",historico:"Histórico",atualizacoes:"Legislação e novidades",definicoes:"Definições"}[view];
  history.replaceState(null,"",`#${view}`);
  window.scrollTo({top:0,behavior:"instant"});
  if (view === "fontes") { renderCatalog(); renderDocuments(); }
  if (view === "historico") renderHistory();
  if (view === "definicoes") renderStorage();
}
function makeToggle(source,active,compact=false) {
  const label = el("label",compact ? "toggle toggle-small" : "toggle");
  const input = el("input"); input.type = "checkbox"; input.checked = active;
  input.setAttribute("aria-label",(active ? "Desativar " : "Ativar ") + source.title);
  input.addEventListener("change",() => setEnabled(source.id,input.checked));
  label.append(input,el("span","toggle-track"));
  return label;
}
function renderMiniSources() {
  const root = $("#querySourceList");
  root.replaceChildren();
  for (const source of catalog()) {
    const active = enabled(source.id);
    const row = el("div","mini-source-row" + (active ? "" : " is-disabled"));
    const logo = el("span","source-monogram",source.initials || source.title.slice(0,2).toUpperCase());
    const text = el("div","mini-source-text");
    text.append(el("strong","",source.title),el("small","",source.type === "Personalizada" ? "Adicionada por ti" : source.type));
    row.append(logo,text,makeToggle(source,active,true));
    root.append(row);
  }
  const count = enabledCatalog().length;
  $("#activeSourcesCount").textContent = `${count} ${count === 1 ? "fonte ativa" : "fontes ativas"}`;
}
async function renderCatalog() {
  const root = $("#sourceCatalog"); root.replaceChildren();
  for (const source of catalog()) {
    const active = enabled(source.id);
    const row = el("article","catalog-row" + (active ? "" : " inactive"));
    const logo = el("span","catalog-monogram",source.initials || source.title.slice(0,2).toUpperCase());
    const body = el("div","catalog-info");
    const nameRow = el("div","catalog-name-row");
    nameRow.append(el("h3","",source.title),pill(source.type,source.type === "Oficial" ? "pill-official" : "pill-muted"));
    body.append(nameRow,el("p","",source.description || "Fonte personalizada adicionada à biblioteca."));
    body.append(link(source.url,"Abrir website ↗"));
    const actions = el("div","catalog-actions");
    actions.append(makeToggle(source,active));
    const button = el("button","button button-quiet button-small",source.type === "Personalizada" ? "Eliminar" : (active ? "Retirar" : "Reativar"));
    button.type = "button";
    button.addEventListener("click",async () => {
      if (source.type !== "Personalizada") return setEnabled(source.id,!active);
      if (!confirm(`Eliminar a fonte «${source.title}» da biblioteca? Os documentos já guardados não serão eliminados.`)) return;
      catalogSettings.custom = catalogSettings.custom.filter(s => s.id !== source.id);
      catalogSettings.disabled = catalogSettings.disabled.filter(id => id !== source.id);
      try { await persistCatalog(); toast("Fonte personalizada eliminada."); }
      catch { toast("Não foi possível eliminar a fonte.",true); }
    });
    actions.append(button);
    row.append(logo,body,actions);
    root.append(row);
  }
}
function renderDocumentSourceOptions() {
  const select = $("#documentSource");
  const selected = select.value;
  select.replaceChildren();
  const local = el("option","","Documento próprio / sem portal"); local.value = "local"; select.append(local);
  for (const source of catalog()) {
    const option = el("option","",source.title); option.value = source.id; select.append(option);
  }
  select.value = [...select.options].some(o => o.value === selected) ? selected : "local";
}
async function updateCounts() {
  try {
    const saved = await all("sources");
    $("#sidebarDocCount").textContent = `${saved.length} ${saved.length === 1 ? "documento" : "documentos"}`;
    $("#documentsStat").textContent = String(saved.length).padStart(2,"0");
    $("#enabledSourceStat").textContent = String(enabledCatalog().length).padStart(2,"0");
  } catch { /* O erro principal será mostrado na vista de documentos. */ }
}
async function renderDocuments() {
  const root = $("#documentsList"); root.replaceChildren();
  try {
    const documents = (await all("sources")).sort(dateSort);
    if (!documents.length) { root.append(emptyState("A tua biblioteca está vazia","Adiciona um texto oficial, PDF, DOCX ou ficheiro de texto para poderes pesquisar o seu conteúdo.")); return; }
    for (const document of documents) {
      const row = el("article","document-row");
      const icon = el("span","document-icon","▤");
      const info = el("div","document-info");
      const source = byCatalogId(documentCatalogId(document));
      info.append(el("strong","",document.title),el("p","",`${source?.title || "Documento local"} · Versão de ${formatDate(document.consultedAt)}${document.fileName ? ` · ${document.fileName}` : ""}`));
      const actions = el("div","document-actions");
      if (document.url && validHttpUrl(document.url)) actions.append(link(document.url,"Origem ↗"));
      const button = el("button","button button-danger button-small","Eliminar"); button.type = "button";
      button.addEventListener("click",async () => {
        if (!confirm(`Eliminar «${document.title}» dos documentos guardados neste dispositivo?`)) return;
        try { await mutate("sources","delete",document.id); await renderDocuments(); await updateCounts(); toast("Documento eliminado."); }
        catch { toast("Não foi possível eliminar o documento.",true); }
      });
      actions.append(button); row.append(icon,info,actions); root.append(row);
    }
  } catch { root.append(emptyState("Erro ao carregar biblioteca","Não foi possível consultar os documentos guardados neste navegador.")); }
}

async function extractFile(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`«${file.name}» excede 12 MB.`);
  const extension = file.name.split(".").pop().toLowerCase();
  let text;
  if (extension === "pdf") {
    const pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs",document.baseURI).href;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const task = pdfjs.getDocument({data:bytes,useSystemFonts:true});
    const pdf = await task.promise;
    const pages = Math.min(pdf.numPages,80);
    const parts = [];
    try {
      for (let i=1;i<=pages;i++) {
        const page = await pdf.getPage(i);
        const contents = await page.getTextContent();
        parts.push(contents.items.map(item => item.str || "").join(" "));
        if (parts.join("\n").length > MAX_DOCUMENT_TEXT) break;
      }
    } finally { await pdf.destroy(); }
    text = parts.join("\n\n");
    if (pages < pdf.numPages) toast("Apenas as primeiras 80 páginas do PDF foram analisadas.");
  } else if (extension === "docx") {
    if (!window.JSZip) throw new Error("Leitura de Word indisponível. Atualiza a aplicação.");
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const xmlEntry = zip.file("word/document.xml");
    if (!xmlEntry) throw new Error(`«${file.name}» não contém um documento Word válido.`);
    const xml = await xmlEntry.async("text");
    const doc = new DOMParser().parseFromString(xml,"application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Não foi possível ler o documento Word.");
    const paragraphs = [...doc.getElementsByTagNameNS("*","p")];
    text = paragraphs.map(p => [...p.getElementsByTagNameNS("*","t")].map(n => n.textContent).join("")).join("\n");
  } else if (["txt","md","csv","json","html","htm"].includes(extension)) {
    text = await file.text();
    if (["html","htm"].includes(extension)) {
      const documentHtml = new DOMParser().parseFromString(text,"text/html");
      documentHtml.querySelectorAll("script,style,template").forEach(n => n.remove());
      text = documentHtml.body.textContent || "";
    }
  } else throw new Error(`O formato «.${extension}» ainda não é suportado.`);
  text = String(text||"").slice(0,MAX_DOCUMENT_TEXT).trim();
  if (text.length < 25) throw new Error(`Não foi possível extrair texto pesquisável de «${file.name}». Se for um PDF digitalizado, é necessário OCR.`);
  return text;
}
async function addQueryFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  if (files.length + queryAttachments.length > MAX_QUERY_FILES) return toast("Podes anexar até três ficheiros por consulta.",true);
  fileReading = true;
  $("#querySubmit").disabled = true;
  const button = $("#querySubmit");
  const originalChildren = [...button.childNodes].map(node => node.cloneNode(true));
  button.replaceChildren(el("span","","A ler documentos…"));
  try {
    for (const file of files) {
      try {
        const text = await extractFile(file);
        queryAttachments.push({id:makeId(),name:file.name,text,size:file.size});
        toast(`Ficheiro «${file.name}» preparado para a consulta.`);
      } catch(error) { toast(error.message || "Erro ao ler o ficheiro.",true); }
    }
  } finally {
    fileReading = false;
    $("#querySubmit").disabled = false;
    button.replaceChildren(...originalChildren);
    renderAttachments();
  }
}
function renderAttachments() {
  const root = $("#attachedFiles"); root.replaceChildren();
  for (const file of queryAttachments) {
    const chip = el("div","attachment-chip");
    const name = el("span","",`▤ ${file.name}`);
    const remove = el("button","","×"); remove.type = "button"; remove.title = `Remover ${file.name}`; remove.setAttribute("aria-label",`Remover ${file.name}`);
    remove.addEventListener("click",() => { queryAttachments = queryAttachments.filter(a => a.id !== file.id); renderAttachments(); });
    chip.append(name,remove); root.append(chip);
  }
}

function findMatches(question,documents) {
  const terms = keywords(question);
  if (!terms.length) return [];
  const results = [];
  for (const document of documents) {
    const paragraphs = document.text.split(/(?:\r?\n){2,}/).flatMap(p => p.length > 1450 ? p.match(/[\s\S]{1,1200}/g) || [] : [p]);
    for (const paragraph of paragraphs) {
      const norm = normal(paragraph);
      const matched = terms.filter(t => norm.includes(t));
      if (!matched.length) continue;
      const score = matched.length*4 + (matched.length === terms.length ? 7 : 0);
      const start = Math.max(0,Math.min(...matched.map(t => norm.indexOf(t))) - 70);
      const text = (start ? "…" : "") + paragraph.slice(start,start+520).trim() + (start+520 < paragraph.length ? "…" : "");
      results.push({document,score,text});
    }
  }
  return results.sort((a,b)=>b.score-a.score).slice(0,8);
}
function searchTerms(question) {
  const terms = keywords(question);
  const query = normal(question);
  const expanded = [...terms];
  const add = (...words) => words.forEach(word => { if (!expanded.includes(word)) expanded.push(word); });
  if (/iva|valor acrescentado/.test(query)) add("iva", "imposto", "taxas");
  if (/percentagem|percentual|taxa|quanto/.test(query)) add("taxa", "taxas", "percentagem");
  if (/construc|empreitad|obra/.test(query)) add("construcao", "civil", "empreitada", "obras", "autoliquidacao");
  if (/donativ|mecenat/.test(query)) add("donativo", "donativos", "mecenato", "deducao");
  if (/deduz|dedut/.test(query)) add("deducao", "dedutivel", "dedutibilidade", "gastos");
  if (/fatura|faturac/.test(query)) add("fatura", "faturacao", "emissao");
  return expanded;
}
async function loadLegalIndex() {
  if (!enabled("at")) return {articles:[],reason:"A Autoridade Tributária está desativada na seleção de fontes."};
  if (legalIndexCache && Date.now() - legalIndexCache.fetchedAt < 15 * 60 * 1000) return legalIndexCache.value;
  const response = await fetch("./data/legal-index.json",{cache:"no-cache"});
  if (!response.ok) throw new Error("Não foi possível obter o índice da AT.");
  const data = await response.json();
  if (!Array.isArray(data.articles) || !data.articles.every(a => typeof a.text === "string" && typeof a.url === "string" && a.url.startsWith("https://info.portaldasfinancas.gov.pt/"))) throw new Error("O índice recebido é inválido.");
  legalIndexCache = {value:data,fetchedAt:Date.now()};
  return data;
}
function legalMatches(question,topic,legalIndex) {
  const terms = searchTerms(question);
  const original = keywords(question);
  if (!terms.length) return [];
  const search = normal(question);
  const matches = [];
  for (const article of legalIndex.articles) {
    if (topic === "IVA" && article.code !== "CIVA") continue;
    if (topic === "IRC" && !["CIRC","EBF","LGT"].includes(article.code)) continue;
    if (topic === "IRS" && !["CIRS","EBF","LGT"].includes(article.code)) continue;
    const content = article.text;
    if (!content?.trim()) continue;
    const normText = normal(content);
    const termHits = original.filter(t => normText.includes(t)).length;
    const expandedHits = terms.filter(t => normText.includes(t)).length;
    const articleNumber = (article.url.match(/(?:iva|irc|irs|bf|lgt)[-_]?(\d+)(?:[_.-]|\.aspx)/i) || [])[1];
    let priority = expandedHits * 2 + termHits * 5;
    if (search.includes("iva") && article.code === "CIVA") priority += 4;
    if (/construc|empreitad|obra/.test(search) && article.code === "CIVA" && articleNumber === "2") priority += 14;
    if (/taxa|percentagem|quanto/.test(search) && article.code === "CIVA" && articleNumber === "18") priority += 14;
    if (/donativ|mecenat/.test(search) && article.code === "EBF") priority += 7;
    if (priority < 6) continue;

    // Apresentar apenas o excerto legal mais próximo dos termos da pergunta.
    const lines = content.split(/\n/).filter(line => line.length > 15);
    let best = {score:-1,text:""};
    for (let i=0;i<lines.length;i++) {
      let window = lines.slice(i,i+5).join(" ");
      if (window.length > 900) window = window.slice(0,900);
      const norm = normal(window);
      const found = terms.filter(t => norm.includes(t));
      let score = found.length * 2 + original.filter(t => norm.includes(t)).length * 5;
      if (/construc|empreitad/.test(search) && /construc|empreitad/.test(norm)) score += 5;
      if (/taxa|percentagem/.test(search) && /taxa|23\s*%|13\s*%|6\s*%/.test(norm)) score += 3;
      if (score > best.score) best = {score,text:window};
    }
    if (!best.text || (best.score < 3 && priority < 15)) continue;
    matches.push({article,score:priority+best.score,text:best.text.slice(0,860)});
  }
  // Evitar apresentar vários fragmentos do mesmo artigo.
  return matches.sort((a,b) => b.score-a.score).slice(0,7);
}
async function runQuery(question,topic,save=true) {
  const root = $("#resultsArea"); root.hidden = false; root.replaceChildren();
  const loading = el("div","search-loading","A consultar os textos legislativos disponíveis…");
  root.append(loading);
  let legalIndex = {articles:[],generatedAt:null};
  let indexError = "";
  try { legalIndex = await loadLegalIndex(); }
  catch(error) { indexError = error.message || "Índice oficial indisponível."; }
  const enabledIds = new Set(enabledCatalog().map(s => s.id));
  const savedDocuments = (await all("sources")).filter(s => {
    const origin = documentCatalogId(s);
    return origin === "local" || enabledIds.has(origin);
  });
  const temporary = queryAttachments.map(a => ({id:a.id,title:a.name,text:a.text,url:null,consultedAt:today(),origin:"attachment",catalogId:"local"}));
  const documents = [...savedDocuments,...temporary];
  const matches = findMatches(question,documents);
  const articles = legalMatches(question,topic,legalIndex);
  if (save) await mutate("history","put",{id:makeId(),question,topic,createdAt:now(),matchCount:matches.length+articles.length,attachmentNames:queryAttachments.map(a=>a.name),activeSources:enabledCatalog().map(s=>s.id)});

  root.replaceChildren();
  const top = el("div","results-top");
  const label = el("span","overline","PESQUISA FUNDAMENTADA");
  const total = articles.length + matches.length;
  const heading = el("h2","",total ? `${total} referências para analisar` : "Não foi possível fundamentar uma resposta");
  top.append(label,heading); root.append(top);
  const information = legalIndex.generatedAt ? `Índice da AT recolhido em ${formatDate(legalIndex.generatedAt)} (${legalIndex.articleCount||legalIndex.articles.length} artigos).` : "O índice da AT ainda não contém artigos recolhidos.";
  root.append(el("p","results-disclaimer",`${information} A ferramenta localiza excertos; não gera pareceres, não valida a vigência em tempo real nem substitui a consulta do Diário da República.`));
  if (indexError) root.append(el("p","index-warning",`A pesquisa na AT não foi concluída: ${indexError}`));
  if (legalIndex.reason) root.append(el("p","index-warning",legalIndex.reason));

  if (articles.length) {
    const heading = el("div","result-group-heading");
    heading.append(el("h3","","Legislação da Autoridade Tributária"),pill("Origem oficial · cópia datada","pill-official")); root.append(heading);
    for (const match of articles) {
      const item = el("article","result-card official-result");
      const topRow = el("div","result-card-top");
      topRow.append(pill(match.article.code,"pill-result"),el("strong","",match.article.title || `Artigo ${match.article.code}`));
      item.append(topRow,el("p","",match.text));
      const bottom = el("div","result-card-bottom");
      bottom.append(el("small","",`Texto consultado em ${formatDate(legalIndex.generatedAt)} · verificar vigência`),link(match.article.url,"Ler artigo na AT ↗"));
      item.append(bottom); root.append(item);
    }
  }
  if (matches.length) {
    const heading = el("div","result-group-heading");
    heading.append(el("h3","","Documentos anexados ou guardados"),pill("Pesquisa local","pill-muted")); root.append(heading);
    for (const item of matches) {
      const card = el("article","result-card");
      const topRow = el("div","result-card-top");
      topRow.append(pill(item.document.origin === "attachment" ? "ANEXO DESTA PERGUNTA" : "BIBLIOTECA LOCAL","pill-result"),el("strong","",item.document.title));
      card.append(topRow,el("p","",item.text));
      const bottom = el("div","result-card-bottom");
      bottom.append(el("small","",`Versão consultada: ${formatDate(item.document.consultedAt)}`));
      if (item.document.url && validHttpUrl(item.document.url)) bottom.append(link(item.document.url,"Conferir origem ↗"));
      card.append(bottom); root.append(card);
    }
  }
  if (!total) root.append(emptyState("Ainda não encontrei uma base suficiente","Se a recolha automática da legislação ainda não foi efetuada, é necessário executá-la no GitHub. Podes também anexar um diploma em PDF ou carregar um documento para pesquisar o texto."));
  if (articles.length) root.append(el("p","legal-caveat","Atenção: os excertos apresentados podem não conter todas as condições, exceções e alterações aplicáveis ao caso concreto. Confirma o texto e a data de produção de efeitos nas fontes oficiais."));
  if (enabledCatalog().length) {
    const block = el("div","result-portals");
    block.append(el("strong","","Portais selecionados para conferência"));
    const links = el("div","portal-links");
    for (const source of enabledCatalog()) links.append(link(source.url,source.title+" ↗"));
    block.append(links); root.append(block);
  }
  root.scrollIntoView({behavior:"smooth",block:"start"});
}

async function renderHistory() {
  const root = $("#historyList"); root.replaceChildren();
  try {
    const entries = (await all("history")).sort(dateSort);
    if (!entries.length) return root.append(emptyState("Ainda não há pesquisas","As questões que pesquisares vão aparecer nesta área."));
    for (const entry of entries) {
      const row = el("article","history-row");
      const left = el("div","history-details");
      left.append(pill(entry.topic || "Geral","pill-topic"),el("strong","",entry.question),el("small","",`${formatDate(entry.createdAt)} · ${entry.matchCount || 0} excertos${entry.attachmentNames?.length ? ` · ${entry.attachmentNames.length} anexo(s) não guardado(s)` : ""}`));
      const button = el("button","button button-outline button-small","Retomar ↗"); button.type = "button";
      button.addEventListener("click",async () => { showView("consulta"); $("#question").value = entry.question; $("#topic").value = entry.topic || "Geral"; queryAttachments = []; renderAttachments(); try { await runQuery(entry.question,entry.topic||"Geral",false); } catch { toast("Erro ao repetir a pesquisa.",true); } });
      row.append(left,button); root.append(row);
    }
  } catch { root.append(emptyState("Não foi possível abrir o histórico","Tenta atualizar a aplicação.")); }
}
function renderUpdates() {
  const root = $("#updatesLinks"); root.replaceChildren();
  for (const item of updateLinks) {
    const row = el("article","update-row");
    const info = el("div"); info.append(el("strong","",item.title),el("p","",item.subtitle));
    row.append(info,link(item.url,"Abrir portal ↗")); root.append(row);
  }
}
async function renderStorage() {
  try {
    if (!navigator.storage?.estimate) throw new Error();
    const {usage=0,quota=0} = await navigator.storage.estimate();
    $("#storageInfo").textContent = `${(usage/1048576).toFixed(1)} MB utilizados${quota ? ` de ${(quota/1048576).toFixed(0)} MB disponibilizados pelo navegador` : ""}.`;
  } catch { $("#storageInfo").textContent = "Estimativa indisponível neste navegador."; }
}

async function exportBackup() {
  const backup = {app:"assistente-fiscal-pt",version:2,exportedAt:now(),sources:await all("sources"),history:await all("history"),settings:await all("settings")};
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}));
  const anchor = el("a"); anchor.href = url; anchor.download = `Assistente_Fiscal_PT_Backup_${today()}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast("Backup transferido. Guarda-o num local seguro.");
}
function backupValid(data) {
  if (!data || data.app !== "assistente-fiscal-pt" || ![1,2].includes(data.version) || !Array.isArray(data.sources) || !Array.isArray(data.history)) return false;
  if (data.sources.length > 2000 || data.history.length > 50000) return false;
  if (!data.sources.every(s => s && typeof s.id === "string" && typeof s.title === "string" && typeof s.text === "string" && s.text.length <= MAX_DOCUMENT_TEXT && typeof s.consultedAt === "string" && typeof s.createdAt === "string" && (!s.url || validHttpUrl(s.url)))) return false;
  if (!data.history.every(h => h && typeof h.id === "string" && typeof h.question === "string" && typeof h.topic === "string" && typeof h.createdAt === "string" && typeof h.matchCount === "number")) return false;
  if (data.version === 2 && (!Array.isArray(data.settings) || data.settings.length > 10 || !data.settings.every(s => s && typeof s.id === "string" && (!s.custom || (Array.isArray(s.custom) && s.custom.length <= 200 && s.custom.every(c => c && typeof c.title === "string" && validHttpUrl(c.url))))))) return false;
  return true;
}
async function restoreBackup(file) {
  if (!file) return;
  if (file.size > 35*1024*1024) throw new Error("O backup é demasiado grande para restaurar nesta versão.");
  const data = JSON.parse(await file.text());
  if (!backupValid(data)) throw new Error("O ficheiro não é um backup válido do Assistente Fiscal PT.");
  if (!confirm("Restaurar este backup? Os documentos, as fontes e o histórico atuais serão substituídos neste dispositivo.")) return;
  await new Promise((resolve,reject) => {
    const tx = db.transaction(["sources","history","settings"],"readwrite");
    const sources = tx.objectStore("sources"),historyStore = tx.objectStore("history"),settingsStore = tx.objectStore("settings");
    sources.clear(); historyStore.clear(); settingsStore.clear();
    data.sources.forEach(s => sources.put(s));
    data.history.forEach(h => historyStore.put(h));
    if (data.version === 2) data.settings.forEach(s => settingsStore.put(s));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  catalogSettings = {id:"catalog",disabled:[],custom:[]};
  await loadCatalog();
  await updateCounts(); renderMiniSources(); renderCatalog(); renderDocumentSourceOptions(); renderDocuments(); renderHistory();
  toast("Backup restaurado com sucesso.");
}

function setupNetwork() {
  const refresh = () => { const node = $("#networkStatus"); node.textContent = navigator.onLine ? "Online" : "Offline"; node.classList.toggle("offline",!navigator.onLine); };
  window.addEventListener("online",refresh); window.addEventListener("offline",refresh); refresh();
}
function setupInstall() {
  const button = $("#installButton");
  let prompt;
  window.addEventListener("beforeinstallprompt",e => { e.preventDefault(); prompt=e; });
  button.addEventListener("click",async () => {
    if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return toast("A aplicação já está instalada.");
    if (prompt) { prompt.prompt(); await prompt.userChoice; prompt=null; return; }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return toast("No iPhone, escolhe Partilhar → Adicionar ao ecrã principal.");
    toast("No Chrome ou Edge, abre o menu do navegador e escolhe Instalar aplicação.");
  });
  window.addEventListener("appinstalled",() => { button.textContent="Instalada"; toast("Assistente Fiscal PT instalado."); });
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) button.textContent="Instalada";
}

function openCatalogDialog() { $("#catalogForm").reset(); $("#catalogError").textContent=""; $("#catalogDialog").showModal(); }
function openDocumentDialog() { $("#documentForm").reset(); $("#documentDate").value = today(); $("#documentError").textContent=""; renderDocumentSourceOptions(); $("#documentDialog").showModal(); }

function bindHandlers() {
  $$('[data-view]').forEach(button => button.addEventListener("click",() => showView(button.dataset.view)));
  $$('[data-example]').forEach(button => button.addEventListener("click",() => { $("#question").value=button.dataset.example; $("#topic").value=button.dataset.topic; $("#question").focus(); }));
  $("#queryForm").addEventListener("submit",async e => {
    e.preventDefault();
    if (fileReading) return toast("Aguarda a leitura dos ficheiros.");
    const question = $("#question").value.trim(); if (!question) return;
    const button = $("#querySubmit"); button.disabled=true;
    try { await runQuery(question,$("#topic").value); }
    catch { toast("Não foi possível concluir a pesquisa.",true); }
    finally { button.disabled=false; }
  });
  $("#attachFilesButton").addEventListener("click",() => $("#queryFiles").click());
  $("#queryFiles").addEventListener("change",e => { addQueryFiles(e.target.files); e.target.value=""; });
  const drop = $("#dropZone");
  drop.addEventListener("click",e => { if (!e.target.closest("button")) $("#queryFiles").click(); });
  drop.addEventListener("keydown",e => { if (e.target===drop && (e.key==="Enter"||e.key===" ")) { e.preventDefault(); $("#queryFiles").click(); } });
  for (const eventName of ["dragenter","dragover"]) drop.addEventListener(eventName,e => { e.preventDefault(); drop.classList.add("dragging"); });
  for (const eventName of ["dragleave","drop"]) drop.addEventListener(eventName,e => { e.preventDefault(); drop.classList.remove("dragging"); });
  drop.addEventListener("drop",e => addQueryFiles(e.dataTransfer.files));

  $("#addCatalogButton").addEventListener("click",openCatalogDialog);
  $("#closeCatalogDialog").addEventListener("click",() => $("#catalogDialog").close());
  $("#cancelCatalogDialog").addEventListener("click",() => $("#catalogDialog").close());
  $("#catalogForm").addEventListener("submit",async e => {
    e.preventDefault();
    const title=$("#catalogName").value.trim(), url=$("#catalogUrl").value.trim(), description=$("#catalogDescription").value.trim();
    if (!validHttpUrl(url)) return $("#catalogError").textContent="A ligação deve utilizar HTTPS e não pode conter credenciais.";
    if (catalog().some(s => s.url.replace(/\/$/,"") === url.replace(/\/$/,""))) return $("#catalogError").textContent="Esta ligação já está na biblioteca.";
    catalogSettings.custom.push({id:`user-${makeId()}`,initials:title.slice(0,2).toUpperCase(),title,description:description||"Fonte personalizada — origem não verificada",type:"Personalizada",url});
    try { await persistCatalog(); $("#catalogDialog").close(); toast("Fonte adicionada à biblioteca."); }
    catch { catalogSettings.custom.pop(); $("#catalogError").textContent="Não foi possível guardar a fonte."; }
  });
  $("#restoreCatalogButton").addEventListener("click",async () => {
    const standard = new Set(primarySources.map(s=>s.id));
    catalogSettings.disabled = catalogSettings.disabled.filter(id=>!standard.has(id));
    await persistCatalog(); toast("Fontes iniciais reativadas; fontes personalizadas preservadas.");
  });

  $("#addDocumentButton").addEventListener("click",openDocumentDialog);
  $("#closeDocumentDialog").addEventListener("click",()=>$("#documentDialog").close());
  $("#cancelDocumentDialog").addEventListener("click",()=>$("#documentDialog").close());
  $("#documentFile").addEventListener("change",e => { $("#documentFileHint").textContent = e.target.files[0] ? `Selecionado: ${e.target.files[0].name}` : "PDF, DOCX ou texto · até 12 MB"; });
  $("#documentForm").addEventListener("submit",async e => {
    e.preventDefault();
    const title=$("#documentTitle").value.trim(), url=$("#documentUrl").value.trim(), consultedAt=$("#documentDate").value, catalogId=$("#documentSource").value;
    const file=$("#documentFile").files[0];
    const error = $("#documentError"); error.textContent="";
    if (url && !validHttpUrl(url)) return error.textContent="O URL da origem deve ser HTTPS e não conter credenciais.";
    const button=$("#saveDocumentButton"); button.disabled=true; button.textContent="A processar documento…";
    try {
      let content=$("#documentText").value.trim();
      if (file) content = `${content}\n\n${await extractFile(file)}`.trim();
      if (content.length < 30 || content.length > MAX_DOCUMENT_TEXT) throw new Error("O documento tem de conter entre 30 e 2.000.000 caracteres pesquisáveis.");
      await mutate("sources","put",{id:makeId(),title,url:url||null,consultedAt,catalogId,text:content,createdAt:now(),fileName:file?.name||null});
      $("#documentDialog").close(); await renderDocuments(); await updateCounts(); toast("Documento guardado localmente.");
    } catch(err) { error.textContent=err.message || "Não foi possível guardar o documento."; }
    finally { button.disabled=false; button.textContent="Guardar documento"; }
  });

  $("#exportButton").addEventListener("click",() => exportBackup().catch(()=>toast("Falha ao criar o backup.",true)));
  $("#importFile").addEventListener("change",async e => { try { await restoreBackup(e.target.files[0]); } catch(err) { toast(err.message||"Erro ao restaurar backup.",true); } finally { e.target.value=""; } });
  $("#clearHistoryButton").addEventListener("click",async () => {
    if (!confirm("Eliminar o histórico de consultas deste dispositivo? Os documentos serão mantidos.")) return;
    try { await mutate("history","clear"); await renderHistory(); toast("Histórico eliminado."); }
    catch { toast("Não foi possível eliminar o histórico.",true); }
  });
}

async function start() {
  renderUpdates(); setupNetwork(); setupInstall();
  try {
    db = await openDatabase();
    await loadCatalog();
    bindHandlers();
    renderMiniSources(); renderDocumentSourceOptions();
    await updateCounts();
    await refreshIndexStatus();
    showView(location.hash.replace("#","")||"consulta");
  } catch(error) {
    toast("O armazenamento local não está disponível. Verifica as permissões do navegador.",true);
    console.error("Falha ao abrir armazenamento local:",error);
  }
  if ("serviceWorker" in navigator) {
    const register = () => navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(()=>{});
    if (document.readyState === "complete") register();
    else window.addEventListener("load",register,{once:true});
  }
}
start();
