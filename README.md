# Protutal

Plataforma web de **tutoria entre pares em Geografia** para a rede SESI. O tutorado acompanha sua evolução, o tutor registra e orienta, e o professor supervisiona tudo.

Projeto do curso Técnico em Desenvolvimento de Sistemas — SENAI "Almirante Tamandaré", 2026.

## Como rodar

Requisito: **Node.js 22.13 ou superior** (usa o SQLite nativo do Node, sem compilação).

```bash
npm install
npm start          # http://localhost:3000
```

Na primeira execução o banco é criado com **dados de demonstração**. Para recriar do zero: `npm run seed`.

| Perfil | E-mail | Aba do login |
|---|---|---|
| Professora | `ana.souza@sesisp.org.br` | Professor |
| Tutor (também é aluno no 2º B) | `lucas.ferreira@portalsesisp.org.br` | Aluno |
| Tutora e tutorada (RN03) | `mariana.alves@portalsesisp.org.br` | Aluno |
| Aluno tutorado | `gabriel.oliveira@portalsesisp.org.br` | Aluno |

Senha de todas as contas: `Protutal2026`

Outros comandos:

- `npm run dev`: reinicia o servidor ao salvar arquivos.
- `npm test`: roda os testes das regras de negócio e de todas as telas.

## Login e perfis

A página inicial é o login, com duas abas: **Aluno** e **Professor** (RF1). O tutor é um aluno: entra pela aba Aluno e vê no menu a seção **Tutor** quando o professor o designou para alguma sala. Assim, um aluno pode ser tutor em uma sala e tutorado em outra (RN03), e a separação de tutor pode ganhar um login próprio no futuro sem mudar o banco.

No cadastro, o aluno pode marcar **"Quero ser tutor"**. Ele entra como aluno e gera um pedido *pendente* para o professor escolhido (RF32/RN21). O cadastro tem duas etapas: (1) o domínio do e-mail precisa estar na lista de domínios institucionais e (2) o e-mail precisa ser confirmado por link (RN20/RN22). Sem SMTP configurado, os e-mails aparecem em **/dev/emails**.

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `URL_BASE` | `http://localhost:PORT` | Usada nos links dos e-mails |
| `SESSION_SECRET` | (valor de desenvolvimento) | **Troque em produção** |
| `NODE_ENV` | — | `production` ativa o cookie seguro e desliga /dev/emails |
| `DOMINIOS_PROFESSOR` | `sesisp.org.br,sesi.org.br` | Domínios aceitos para professores (RN20) |
| `DOMINIOS_ALUNO` | `portalsesisp.org.br,aluno.sesisp.org.br` | Domínios aceitos para alunos (RN22) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` | — | Envio real de e-mails |
| `DB_PATH` / `UPLOAD_DIR` | `data/protutal.db` / `uploads/` | Onde ficam o banco e os arquivos |
| `SEED_DEMO` | — | `false` impede a carga de demonstração num banco vazio |

> Os domínios padrão são suposições: confira os domínios reais do SESI e ajuste.

## Tecnologias

- **Node.js + Express 5**, com páginas renderizadas no servidor (**EJS**).
- **SQLite** nativo (`node:sqlite`); o esquema está em `src/db/schema.sql`.
- **Server-Sent Events** para tempo real: notificações, chat e atualização das telas (RNF7).
- **bcryptjs** (senhas), **multer** (uploads), **exceljs** (exportação), **nodemailer** (e-mail).
- CSS e JavaScript puros, sem framework no front, para o site carregar rápido (RNF5).

```
server.js               inicia o servidor e o alerta de prazos
src/app.js              middlewares, sessão, tratamento de erros
src/services/           regras de negócio (cada RN está comentada no código)
src/routes/             auth, professor, tutor, aluno e rotas comuns
src/views/              telas EJS (partials = layout e componentes)
public/                 CSS, JS e ícones
test/                   testes (node:test)
```

## Rastreabilidade dos requisitos

### Requisitos funcionais

| RF | Onde está |
|---|---|
| RF1 Cadastro e login | `/`, `/cadastro`, `/confirmar/:token` |
| RF2 Chat tutor ↔ aluno (1:1) | `/mensagens`, em tempo real |
| RF3 Ciclo da tutoria | Tutoria do professor → "Ciclo" (datas, status, conteúdos) |
| RF4 / RF5 Ano letivo e série | Painel do professor (filtros de ano e de 1º/2º/3º ano) |
| RF6 Gestão de salas | `/professor/salas/nova`, aba **Alunos** |
| RF7 / RF8 Tutores e vínculos | Sala → **Tutores e vínculos** |
| RF9 Permissões do tutor | Tutoria → **Permissões** (modelos autorizados) |
| RF10 Avisos | Sala → **Avisos** |
| RF11 Atividades da sala | Sala → **Atividades** (construtor de questões) |
| RF12 Revisão de justificativas | `/entregas/:id` (comentário por questão) |
| RF13 Dashboard dos tutores | Sala → **Desempenho**; tutoria → "Desempenho" |
| RF14 Exportar notas | Sala → Desempenho → **Exportar notas (Excel .xlsx)** |
| RF15 Notificação de notas | Sininho + notificação quando o tutor lança uma nota |
| RF16 Metas e critérios | Sala → **Metas e critérios** (rubrica com pontuação) |
| RF17 Pedidos de tutoria | `/professor/pedidos` |
| RF18 Revogação do tutor | Tutoria → **Revogar e transferir** |
| RF19 Avaliação do tutor | Tutoria → "Avaliar o tutor" |
| RF20 Atividades do tutor | Tutor → Atividades → Nova (só com permissão) |
| RF21 Comentários | Correção da entrega (geral e por questão) |
| RF22 Feedback por rubrica | Tutor → **Rubricas** (por trimestre) |
| RF23 Dashboard do tutor | `/tutor/desempenho` (por trimestre e por ano) |
| RF24 Comunicados | Tutor → **Comunicados** |
| RF25 Materiais | Tutor → **Materiais** (arquivo ou link, para todos ou para um aluno) |
| RF26 / RF27 Dashboard do aluno | `/aluno` (médias por trimestre e conteúdos dominados ou a treinar) |
| RF28 Dúvidas e materiais | `/aluno/apoio` |
| RF29 Contestar nota | Página da atividade (após correção) |
| RF30 / RF31 Atividades do aluno | `/aluno/atividades`, envio com data e hora registradas |
| RF32 Solicitação de tutoria | Cadastro ("Quero ser tutor") e `/perfil` |

Itens extras vindos do briefing: o **professor valida** os registros e as rubricas do tutor (RU11), registra **observações** de dificuldade, avanço ou potencialidade (RU9), e o **aluno avalia o tutor** com critérios de clareza, domínio, disponibilidade e respeito (RN12).

### Regras de negócio

Todas ficam em `src/services/` e lançam `ErroRegra` com o código da RN, que aparece na mensagem ao usuário. Os testes em `test/regras.test.js` cobrem RN02, RN04, RN05, RN08–RN11, RN13–RN17 e RN20–RN22.

### Requisitos não funcionais

| RNF | Como foi atendido |
|---|---|
| RNF1 Usabilidade | Menu por perfil, estados vazios com instrução e mensagens claras |
| RNF2 Responsividade | Layout mobile-first, menu lateral recolhível e chat em tela única no celular |
| RNF3 Segurança | bcrypt, sessão httpOnly/sameSite, token CSRF, limite de tentativas de login, CSP, controle de acesso em cada rota |
| RNF4 Confiabilidade das avaliações | Só quem é responsável avalia (RN11), contestações registradas, validação do professor |
| RNF5 Performance | Sem frameworks no front e sem fontes ou scripts externos |
| RNF6 Identidade visual | Vermelho, branco e cinza |
| RNF7 Tempo real | SSE: notificações, chat e atualização automática das telas |
| RNF8 Privacidade | Notas visíveis só para o aluno, o tutor dele e o professor (testado) |
| RNF10 Exportação | `.xlsx` nativo com cabeçalho formatado e filtros |
| RNF12 Navegadores | HTML, CSS e JS padrão (Chrome e Edge), sem plugins |
| RNF13–15 Acessibilidade | Botões no topo: **A− / A+**, **tema claro/escuro**, **modo daltônico** (paleta Okabe-Ito + padrões nas barras; status sempre com ícone e texto) |

## Fora do escopo / próximos passos

Conforme o documento de escopo, ficaram de fora: videoconferência, IA (correção automática inteligente, recomendação e transcrição automática de fotos), mapas interativos, fórum aberto e integração com sistemas acadêmicos. Pontos marcados como "não aplicado" no briefing, como assiduidade, cronograma pessoal e verificação de leituras, podem ser adicionados depois. O questionário objetivo gera apenas uma **nota sugerida** pelo gabarito; quem confirma a nota é sempre o tutor ou o professor.
