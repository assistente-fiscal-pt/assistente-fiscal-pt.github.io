import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve, dirname} from "node:path";
import vm from "node:vm";

const script = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../app.js"), "utf8");
const context = { URL, Intl, document:{querySelector:()=>null} };
vm.runInNewContext(script.replace(/\nstart\(\);\s*$/, "\n"), context);
const legalMatches = vm.runInNewContext("legalMatches", context);
const aiRequestSources = vm.runInNewContext("aiRequestSources", context);

const article = (code, number, text) => ({
  code,
  url:`https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/${code.toLowerCase()}/pages/${code.toLowerCase().replace(/^c/, "")}${number}.aspx`,
  text:`Artigo ${number}.º\n${text}`
});

test("prioriza o artigo exato do CIVA pedido na pergunta", () => {
  const index = {articles:[
    article("CIVA", "18", "Taxas do imposto sobre o valor acrescentado. Taxa normal e taxa reduzida."),
    article("CIVA", "20", "Dedução do imposto sobre o valor acrescentado e operações elegíveis."),
    article("LGT", "18", "Sujeitos da relação jurídica tributária e imposto sobre valor acrescentado.")
  ]};
  const matches = legalMatches("O que diz o artigo 18.º do CIVA?", "Geral", index);
  assert.equal(matches[0].article.code,"CIVA");
  assert.equal(matches[0].article.url.includes("iva18.aspx"),true);
});

test("inclui a LGT quando uma pergunta de IVA precisa de normas gerais", () => {
  const index = {articles:[
    article("CIVA","41","Entrega da declaração periódica do imposto sobre valor acrescentado."),
    article("LGT","48","Prescrição da dívida tributária e prazo de prescrição fiscal."),
    article("CIRC","48","Prescrição de uma dívida de imposto sobre valor acrescentado.")
  ]};
  const matches = legalMatches("Qual é o prazo de prescrição da dívida de IVA?", "IVA", index);
  assert.equal(matches.some(match => match.article.code === "LGT"),true);
  assert.equal(matches.some(match => match.article.code === "CIRC"),false);
});

test("envia a alínea de construção civil e não só o início truncado do artigo 2.º", () => {
  const text = `Artigo 2.º\nIncidência subjetiva\n${"Regras gerais relativas a sujeitos passivos de IVA e operações.\n".repeat(55)}\nj) Adquirentes de serviços de construção civil, que disponham de direito à dedução, são sujeitos passivos do imposto.`;
  const entry = article("CIVA","2",text);
  const sources = aiRequestSources([{article:entry,text:"j) Adquirentes de serviços de construção civil",score:99}],[],{});
  assert.equal(sources.length,1);
  assert.match(sources[0].text,/j\) Adquirentes de serviços de construção civil/);
  assert.ok(sources[0].text.length > 3200);
  assert.ok(sources[0].text.length <= 14000);
});

test("recupera orientações oficiais AT para explicar uma alteração sem apagar a regra anterior", () => {
  const index = {articles:[
    article("CIVA","2","j) Adquirentes de serviços de construção civil com direito à dedução devem autoliquidar o IVA."),
    {code:"AT-IVA",kind:"orientacao-administrativa",title:"Ofício-circulado 25117/2026 — IVA construção civil",
     url:"https://at.madeira.gov.pt/ficheiros/Oficio-Circulado-25117-2026.pdf",
     text:"Ofício-circulado da AT sobre a inversão em serviços de construção civil. O Decreto-Lei n.º 97/2026 estendeu o âmbito de aplicação da regra já existente. Para a primeira parte da alínea j), são necessários, cumulativamente, serviços de construção civil e adquirente sujeito passivo com direito à dedução total ou parcial. Para a segunda parte, agora aditada, há requisitos específicos da verba 2.42."},
    article("CIVA","27","Pagamento do imposto por sujeitos passivos e entrega da declaração periódica de IVA.")
  ]};
  const matches = legalMatches("Segundo o artigo 2.º alínea j) do CIVA, quem autoliquida o IVA da construção civil?","IVA",index);
  assert.equal(matches[0].article.code,"CIVA");
  assert.ok(matches.some(m => m.article.code === "AT-IVA"));
  const sources = aiRequestSources(matches,[],index);
  assert.ok(sources.some(s => s.title.includes("Orientação interpretativa AT")));
  assert.match(sources.find(s => s.code === "AT-IVA").text,/estendeu o âmbito de aplicação/);
});
