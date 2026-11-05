# Fernando — Assistente Fiscal

Aplicação PWA de apoio à organização de consultas e fontes fiscais portuguesas. Este repositório publica a aplicação num domínio GitHub Pages próprio, separado das aplicações da conta `universidadechat-ux`.

## Funcionalidades da versão 0.5

- Instalação no computador ou telemóvel a partir do navegador.
- Biblioteca editável: ativar/desativar fontes, adicionar fontes HTTPS personalizadas e removê-las.
- Diretório de fontes oficiais e complementares (AT, Diário da República, CNC, EUR-Lex e OCC).
- Anexação à pergunta de PDFs com texto, DOCX, TXT, CSV, Markdown, JSON ou HTML (até três ficheiros de 12 MB).
- Extração de texto local, no navegador, com bibliotecas PDF.js e JSZip guardadas neste repositório; PDFs digitalizados requerem OCR.
- Pesquisa em artigos dos códigos fiscais publicados pela AT (CIVA, CIRC, CIRS, EBF e LGT) através de um índice estático datado, além da pesquisa nos anexos e documentos locais.
- Tarefa GitHub Actions agendada diariamente para atualizar o índice de artigos no repositório; falhas ou atrasos podem impedir a atualização.
- Apenas a AT dispõe desta recolha automática inicial. A seleção de outros portais não importa os seus conteúdos automaticamente.
- Histórico, documentos, preferências de fontes e backups v2 guardados localmente no navegador (IndexedDB); compatibilidade com backups v1.
- Interface disponível offline após a primeira visita; ligações externas exigem Internet.
- Identidade visual «Fernando» e ícone próprio; domínio e identificador de armazenamento preservados.
- Respostas automáticas com explicação, referências `[F1]`, `[F2]` e ligações aos artigos, quando o serviço de IA opcional estiver configurado.
- Motor de IA num **Cloudflare Worker independente**. Usa a seleção dos artigos da AT e, apenas após autorização expressa em cada consulta, excertos de documentos pessoais.
- Campo de acesso ao Worker em Definições. O endereço fica na base de dados local; a palavra-passe fica apenas na sessão do navegador e **não** vai para o backup nem para o GitHub.
- O Fernando indica quando não dispõe de fontes adequadas, quando a IA falha ou quando não foi possível validar as referências apresentadas.

**Limitações:** a IA só funciona após configurar o Worker na Cloudflare; a versão publicada no GitHub, por si só, continua a ser uma PWA estática. A IA não efetua pesquisa jurídica em tempo real nem valida automaticamente a vigência. A recolha automática depende de páginas da AT e da execução do GitHub Actions; é uma cópia datada e pode estar incompleta. As fontes DR, CNC, EUR-Lex e OCC só são pesquisáveis quando os documentos correspondentes são guardados localmente (e enviados à IA mediante consentimento). Não há sincronização entre dispositivos. Os anexos da pergunta são temporários, salvo se forem guardados explicitamente na biblioteca. As respostas são geradas por modelo e podem conter erros; não substituem um parecer fiscal. Confirma a redação, eventuais alterações, os efeitos temporais e os prazos na fonte oficial atual.

Os componentes de leitura PDF e Word incluem as licenças originais em `vendor/` (PDF.js — Apache 2.0; JSZip — MIT).

## Publicação

Em **Settings → Pages**, selecionar **Deploy from a branch**, branch `main`, pasta `/(root)` e guardar. Depois de publicada, a aplicação fica disponível em `https://assistente-fiscal-pt.github.io/`.

Este repositório tem de ser público para utilizar GitHub Pages no plano gratuito. Não incluir dados pessoais, documentos de clientes ou segredos no repositório. Os dados guardados na aplicação ficam no navegador e devem ser exportados periodicamente para backup.

### Índice oficial de consulta

O ficheiro `data/legal-index.json` é atualizado pelo workflow `.github/workflows/atualizar-legislacao.yml` (execução programada e manual). O script `scripts/update_legal_index.py` obtém artigos diretamente do Portal das Finanças e preserva os textos anteriores quando falha pontualmente a leitura de uma página. Os textos recolhidos são servidos estaticamente pelo GitHub Pages e qualquer pessoa pode consultar o índice público. A data da última recolha surge em cada pesquisa, para evitar confundi-la com confirmação de vigência.

## Ativar respostas com IA (sem instalar Node.js)

O GitHub Pages mantém a app. Para gerar respostas é necessário um serviço servidor para chamar o modelo de linguagem. Este projeto usa um **Cloudflare Worker** separado que corre `@cf/openai/gpt-oss-120b` através de um binding Workers AI, com análise mais aprofundada e exigência explícita de fundamentação.

1. Entra em [Cloudflare](https://dash.cloudflare.com/) e escolhe a modalidade **Free**. Não é necessário comprar um domínio ou alterar o domínio GitHub da PWA.
2. Em **Workers & Pages**, cria um **Worker** simples com o nome `fernando-ia`, com endereço `*.workers.dev`.
3. No Worker, abre **Edit Code**. Substitui o código inicial pelo conteúdo integral de [`cloudflare/fernando-worker.js`](./cloudflare/fernando-worker.js) e clica em **Deploy**.
4. Abre **Settings → Bindings → Add binding** (a posição varia consoante a interface). Seleciona **Workers AI** e atribui-lhe o nome exato `AI`. Guarda a configuração.
5. Em **Settings → Variables and Secrets**, adiciona uma variável do tipo **Secret**, chamada `FERNANDO_ACCESS_KEY`. Define uma frase-passe exclusiva com **pelo menos 16 caracteres**. Nunca a guardes num ficheiro público nem a partilhes por chat. Se a alteração criar uma versão que não fique ativa, abre **Deployments → ⋯ → Promote version** para a colocar em produção.
6. Na aplicação Fernando, abre **Definições → Ligar o Fernando à IA**. Introduz o endereço `https://...workers.dev` e **a mesma frase-passe**. Escolhe **Guardar ligação** e **Testar serviço**.
7. Volta a **Perguntar ao Fernando**: o botão passa a **Obter resposta fundamentada**. Verifica se surgem a resposta, a fundamentação e referências clicáveis. Para permitir análise de ficheiros próprios, é necessário marcar a autorização na própria pergunta.

Não são necessárias ferramentas de programação no computador. O Worker é chamado apenas pela PWA publicada em `https://assistente-fiscal-pt.github.io` e exige a frase-passe para utilizar a IA. Se consultares diretamente o endereço do Worker, a resposta `403` é esperada: o serviço só aceita pedidos com a origem da aplicação. O endpoint `/health` confirma a presença do binding e de um Secret com comprimento mínimo; só uma pergunta real valida a frase-passe e o modelo.

### Plano gratuito e privacidade

Cloudflare Workers AI dispõe, segundo a documentação atual, de **10.000 Neurons por dia gratuitos**. No plano Free, o limite bloqueia chamadas adicionais em vez de oferecer uso ilimitado. O modelo pode variar em disponibilidade ou desempenho, e a política de preços deve ser confirmada na [documentação da Cloudflare](https://developers.cloudflare.com/workers-ai/platform/pricing/). A aplicação continua utilizável para consulta documental quando o serviço estiver indisponível.

Não coloques dados fiscais de clientes ou documentos confidenciais no repositório (é público). O Worker não guarda os pedidos numa base de dados, mas a Cloudflare recebe a pergunta e os excertos autorizados para processar a inferência. Por defeito, os documentos pessoais não são enviados. A Cloudflare declara que não utiliza o conteúdo dos clientes no Workers AI para treinar os modelos; confirma a [política de utilização de dados](https://developers.cloudflare.com/workers-ai/platform/data-usage/) antes de usar dados profissionais protegidos.

Testes locais das validações e da seleção legislativa: `node --test cloudflare/test-worker.mjs scripts/test-retrieval.mjs` (apenas para quem desenvolve, não necessário para utilização da app).
