import test from "node:test";
import assert from "node:assert/strict";
import worker from "./fernando-worker.js";

const origin = "https://assistente-fiscal-pt.github.io";
const endpoint = "https://fernando-ia.example.workers.dev";
const secret = "uma-palavra-passe-segura-de-teste";
const sample = {
  question: "Qual é a regra de entrega da declaração periódica de IVA?",
  topic: "IVA",
  consultedAt: "2026-11-05",
  sources: [{type:"official",title:"CIVA — Artigo 41.º",code:"CIVA",url:"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/civa_rep/pages/iva41.aspx",text:"Artigo 41.º — Prazo de entrega da declaração periódica. O sujeito passivo apresenta a declaração nos termos definidos."}]
};
const approvedReview = JSON.stringify({
  approved:true,
  reason:"Norma aplicável identificada",
  evidence:[{source:"F1",quote:sample.sources[0].text}]
});
function request(path, method = "POST", body = sample, overrides = {}) {
  const headers = { origin, "content-type":"application/json", "x-fernando-key":secret, ...overrides };
  return new Request(`${endpoint}${path}`,{method,headers,...(method === "POST" ? {body:JSON.stringify(body)} : {})});
}
function environment(answer = "RESPOSTA DIRETA\nA declaração segue o prazo constante da lei. [F1]\nFUNDAMENTAÇÃO\nO artigo 41.º estabelece regras. [F1]\nCONFIRMAÇÕES NECESSÁRIAS\nVerificar a agenda fiscal atual.",review=approvedReview) {
  let calls = 0;
  return {
    config:{AI:{run:async(model,params)=>{
      calls++;
      assert.equal(model,"@cf/openai/gpt-oss-120b");
      assert.equal(params.messages.length,2);
      const value = calls === 1 ? answer : review;
      return typeof value === "string" ? {response:value} : value;
    }},FERNANDO_ACCESS_KEY:secret},
    get calls(){return calls;}
  };
}

test("rejeita origens externas antes de qualquer chamada à IA",async () => {
  const fake = environment();
  const response = await worker.fetch(request("/answer","POST",sample,{origin:"https://outra-app.github.io"}),fake.config);
  assert.equal(response.status,403);
  assert.equal(fake.calls,0);
});

test("responde ao preflight da aplicação correta",async () => {
  const response = await worker.fetch(request("/answer","OPTIONS"),environment().config);
  assert.equal(response.status,204);
  assert.equal(response.headers.get("access-control-allow-origin"),origin);
  assert.match(response.headers.get("access-control-allow-headers"),/x-fernando-key/);
});

test("health não afirma que o serviço está pronto sem IA e secret",async () => {
  const response = await worker.fetch(request("/health","GET"),{});
  assert.deepEqual(await response.json(),{service:"Fernando",ready:false});
});

test("health não afirma que a configuração está pronta com um secret curto",async () => {
  const response = await worker.fetch(request("/health","GET"),{AI:{run:async()=>({})},FERNANDO_ACCESS_KEY:"curto"});
  assert.deepEqual(await response.json(),{service:"Fernando",ready:false});
});

test("chave incorreta bloqueia inferência",async () => {
  const fake = environment();
  const response = await worker.fetch(request("/answer","POST",sample,{"x-fernando-key":"segredo-incorreto"}),fake.config);
  assert.equal(response.status,401);
  assert.equal(fake.calls,0);
});

test("faz uma resposta com referências validadas",async () => {
  const fake = environment();
  const response = await worker.fetch(request("/answer"),fake.config);
  const result = await response.json();
  assert.equal(response.status,200);
  assert.equal(result.grounded,true);
  assert.equal(result.verification,"double-ai-review");
  assert.match(result.answer,/\[F1\]/);
  assert.equal(result.sources[0].url,sample.sources[0].url);
  assert.equal(fake.calls,2);
});

test("lê a resposta de Chat Completions devolvida pelo GPT-OSS",async () => {
  const expected = "A regra encontra-se no artigo 41.º. [F1]";
  const fake = environment({choices:[{message:{role:"assistant",content:expected},finish_reason:"stop"}]});
  const response = await worker.fetch(request("/answer"),fake.config);
  assert.equal(response.status,200);
  assert.equal((await response.json()).answer,expected);
});

test("lê o texto final da API Responses e ignora o raciocínio",async () => {
  const expected = "A regra encontra-se no artigo 41.º. [F1]";
  const fake = environment({output:[
    {type:"reasoning",summary:[{type:"summary_text",text:"Raciocínio não visível"}]},
    {type:"message",role:"assistant",content:[{type:"output_text",text:expected}]}
  ]});
  const response = await worker.fetch(request("/answer"),fake.config);
  assert.equal(response.status,200);
  assert.equal((await response.json()).answer,expected);
});

test("aceita texto de conteúdo estruturado na resposta do modelo",async () => {
  const fake = environment({choices:[{message:{content:[{type:"text",text:"É necessário cumprir a obrigação. [F1]"}]}}]});
  const response = await worker.fetch(request("/answer"),fake.config);
  assert.equal(response.status,200);
  assert.match((await response.json()).answer,/\[F1\]/);
});

test("sinaliza prazo do mês corrente sem Agenda Fiscal atual",async () => {
  const body = {...sample,question:"Quando tenho de entregar a declaração periódica do IVA deste mês?"};
  const response = await worker.fetch(request("/answer","POST",body),environment().config);
  const result = await response.json();
  assert.equal(result.deadlineNeedsVerification,true);
});

test("bloqueia respostas com referências inventadas",async () => {
  const response = await worker.fetch(request("/answer"),environment("A regra é esta [F9].").config);
  const result = await response.json();
  assert.equal(response.status,422);
  assert.equal(result.answer,undefined);
  assert.match(result.error,/dupla verificação/);
});

test("bloqueia afirmações sem qualquer referência",async () => {
  const fake = environment("A regra é esta sem referências.");
  const response = await worker.fetch(request("/answer"),fake.config);
  assert.equal(response.status,422);
  assert.equal(fake.calls,1);
});

test("rejeita a conclusão errada do teste real de construção civil",async () => {
  const construction = {
    question:"Uma empresa presta serviços de construção civil a outra empresa que é sujeito passivo de IVA com direito à dedução. Quem liquida o IVA?",
    topic:"IVA",
    sources:[{type:"official",title:"CIVA · Artigo 2.º",code:"CIVA",url:"https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/civa_rep/Pages/iva2.aspx",text:"j) As pessoas singulares ou coletivas referidas na alínea a) que disponham de sede, estabelecimento estável ou domicílio em território nacional e que pratiquem operações que confiram o direito à dedução total ou parcial do imposto, quando sejam adquirentes de serviços de construção civil, incluindo a remodelação, reparação, manutenção, conservação e demolição de bens imóveis, em regime de empreitada ou subempreitada."}]
  };
  const wrong = "Cabe ao prestador liquidar IVA, pois a autoliquidação só se aplica a prestadores não residentes. [F1]";
  const fake = environment(wrong,JSON.stringify({approved:false,reason:"Ignora a alínea j) que atribui a liquidação ao adquirente.",evidence:[]}));
  const response = await worker.fetch(request("/answer","POST",construction),fake.config);
  const result = await response.json();
  assert.equal(response.status,422);
  assert.equal(result.answer,undefined);
  assert.equal(fake.calls,2);
});

test("não confia numa aprovação sem citação literal verificável",async () => {
  const fake = environment(undefined,JSON.stringify({approved:true,evidence:[{source:"F1",quote:"Texto de apoio suficientemente longo mas que não aparece em nenhuma passagem da fonte."}]}));
  const response = await worker.fetch(request("/answer"),fake.config);
  assert.equal(response.status,422);
  assert.equal((await response.json()).answer,undefined);
});

test("bloqueia respostas quando a auditoria devolve JSON inválido",async () => {
  const fake = environment(undefined,"Não consegui verificar a resposta.");
  const response = await worker.fetch(request("/answer"),fake.config);
  assert.equal(response.status,422);
});

test("não aceita uma origem oficial falsificada",async () => {
  const body = {...sample,sources:[{...sample.sources[0],url:"https://portal-fiscal-exemplo.pt/lei"}]};
  const fake = environment();
  const response = await worker.fetch(request("/answer","POST",body),fake.config);
  assert.equal(response.status,400);
  assert.equal(fake.calls,0);
});

test("não envia perguntas sem fontes para o modelo",async () => {
  const fake = environment();
  const response = await worker.fetch(request("/answer","POST",{...sample,sources:[]}),fake.config);
  assert.equal(response.status,400);
  assert.equal(fake.calls,0);
});

test("trata indisponibilidade ou limite do modelo",async () => {
  const config = {AI:{run:async()=>{throw new Error("quota exceeded");}},FERNANDO_ACCESS_KEY:secret};
  const response = await worker.fetch(request("/answer"),config);
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/limite gratuito/);
});
