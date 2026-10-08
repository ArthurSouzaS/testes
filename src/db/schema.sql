-- Protutal — esquema do banco de dados (SQLite)
-- Datas são gravadas em ISO 8601 UTC (ex.: 2026-03-10T13:00:00.000Z).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- Usuários
CREATE TABLE IF NOT EXISTS usuarios (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nome              TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash        TEXT NOT NULL,
  papel             TEXT NOT NULL CHECK (papel IN ('professor', 'aluno')),
  email_confirmado  INTEGER NOT NULL DEFAULT 0,          -- RN20 / RN22 (2ª etapa)
  criado_em         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tokens_email (
  token       TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em   TEXT NOT NULL,
  usado_em    TEXT
);

-- Caixa de saída usada quando não há SMTP configurado (ambiente de desenvolvimento)
CREATE TABLE IF NOT EXISTS emails_enviados (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  para       TEXT NOT NULL,
  assunto    TEXT NOT NULL,
  html       TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  sid     TEXT PRIMARY KEY,
  dados   TEXT NOT NULL,
  expira  INTEGER NOT NULL
);

-- RF32 / RN21 — pedido de tutoria gerado no cadastro do aluno-tutor
CREATE TABLE IF NOT EXISTS pedidos_tutoria (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  aluno_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  professor_id  INTEGER NOT NULL REFERENCES usuarios(id),
  mensagem      TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aceito', 'recusado')),
  sala_id       INTEGER REFERENCES salas(id) ON DELETE SET NULL,
  resposta      TEXT,
  decidido_em   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- --------------------------------------------------- Conteúdos de Geografia
CREATE TABLE IF NOT EXISTS conteudos (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome  TEXT NOT NULL UNIQUE,
  eixo  TEXT NOT NULL
);

-- ------------------------------------------- Salas (Unidades Curriculares)
CREATE TABLE IF NOT EXISTS salas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  ano_letivo    INTEGER NOT NULL,                              -- RF4
  serie         INTEGER NOT NULL CHECK (serie IN (1, 2, 3)),   -- RF5
  descricao     TEXT,
  metas         TEXT,                                          -- RF16
  objetivos     TEXT,                                          -- RF16
  professor_id  INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sala_alunos (
  sala_id      INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  aluno_id     INTEGER NOT NULL REFERENCES usuarios(id),
  incluido_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (sala_id, aluno_id)
);

-- RF16 — critérios de acompanhamento (rubrica com pontuação definida pelo docente)
CREATE TABLE IF NOT EXISTS sala_criterios (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sala_id        INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  descricao      TEXT,
  pontuacao_max  INTEGER NOT NULL DEFAULT 10 CHECK (pontuacao_max BETWEEN 1 AND 100),
  ordem          INTEGER NOT NULL DEFAULT 0
);

-- RF10 — avisos da sala
CREATE TABLE IF NOT EXISTS avisos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sala_id    INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  autor_id   INTEGER NOT NULL REFERENCES usuarios(id),
  titulo     TEXT NOT NULL,
  texto      TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ------------------------------------------------------------- Tutorias
-- Uma tutoria é o grupo de um tutor dentro de uma sala (RF3, RF7, RN06).
CREATE TABLE IF NOT EXISTS tutorias (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  sala_id                INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  tutor_id               INTEGER NOT NULL REFERENCES usuarios(id),
  status                 TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'finalizada')),  -- RN16
  data_inicio            TEXT NOT NULL,
  data_fim               TEXT,
  metas_especificas      TEXT,
  pode_criar_atividades  INTEGER NOT NULL DEFAULT 0,      -- RF9 / RN08
  modelos_permitidos     TEXT NOT NULL DEFAULT '[]',      -- RF9 / RN09 (JSON)
  criado_em              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (sala_id, tutor_id)
);

-- RN04 — histórico de quem foi tutor de cada tutoria
CREATE TABLE IF NOT EXISTS tutoria_tutores_hist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id  INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  tutor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  inicio      TEXT NOT NULL,
  fim         TEXT,
  motivo      TEXT
);

-- RF8 / RN05 — tutorados de cada tutoria
CREATE TABLE IF NOT EXISTS tutoria_alunos (
  tutoria_id    INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  aluno_id      INTEGER NOT NULL REFERENCES usuarios(id),
  vinculado_em  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tutoria_id, aluno_id)
);

-- RF3 — conteúdos de Geografia vinculados à tutoria
CREATE TABLE IF NOT EXISTS tutoria_conteudos (
  tutoria_id   INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  conteudo_id  INTEGER NOT NULL REFERENCES conteudos(id),
  PRIMARY KEY (tutoria_id, conteudo_id)
);

-- ----------------------------------------------------------- Atividades
CREATE TABLE IF NOT EXISTS atividades (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sala_id      INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  tutoria_id   INTEGER REFERENCES tutorias(id) ON DELETE CASCADE,   -- NULL = atividade da sala (RN10)
  autor_id     INTEGER NOT NULL REFERENCES usuarios(id),
  titulo       TEXT NOT NULL,
  enunciado    TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  modelo       TEXT NOT NULL,
  conteudo_id  INTEGER REFERENCES conteudos(id),
  etapa        INTEGER NOT NULL CHECK (etapa IN (1, 2, 3)),
  valor        REAL NOT NULL DEFAULT 10,
  prazo        TEXT NOT NULL,
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS questoes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  atividade_id         INTEGER NOT NULL REFERENCES atividades(id) ON DELETE CASCADE,
  ordem                INTEGER NOT NULL,
  enunciado            TEXT NOT NULL,
  alternativas         TEXT,          -- JSON (NULL em questões dissertativas)
  correta              INTEGER,       -- índice da alternativa correta (opcional)
  exige_justificativa  INTEGER NOT NULL DEFAULT 0
);

-- RF31 — envio de resposta
CREATE TABLE IF NOT EXISTS entregas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  atividade_id   INTEGER NOT NULL REFERENCES atividades(id) ON DELETE CASCADE,
  aluno_id       INTEGER NOT NULL REFERENCES usuarios(id),
  texto          TEXT,
  enviado_em     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'enviada' CHECK (status IN ('enviada', 'corrigida')),
  nota           REAL,
  nota_sugerida  REAL,
  feedback       TEXT,
  corrigido_por  INTEGER REFERENCES usuarios(id),
  corrigido_em   TEXT,
  UNIQUE (atividade_id, aluno_id)
);

CREATE TABLE IF NOT EXISTS respostas (
  entrega_id   INTEGER NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
  questao_id   INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
  alternativa  INTEGER,
  texto        TEXT,      -- justificativa ou resposta dissertativa
  PRIMARY KEY (entrega_id, questao_id)
);

-- RF12 / RF21 — comentários na atividade (gerais ou por questão)
CREATE TABLE IF NOT EXISTS comentarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entrega_id  INTEGER NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
  questao_id  INTEGER REFERENCES questoes(id) ON DELETE CASCADE,
  autor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  texto       TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- RF29 — contestação de nota
CREATE TABLE IF NOT EXISTS contestacoes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entrega_id      INTEGER NOT NULL REFERENCES entregas(id) ON DELETE CASCADE,
  aluno_id        INTEGER NOT NULL REFERENCES usuarios(id),
  justificativa   TEXT NOT NULL,
  nota_anterior   REAL,
  status          TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'deferida', 'indeferida')),
  resposta        TEXT,
  nota_nova       REAL,
  respondido_por  INTEGER REFERENCES usuarios(id),
  respondido_em   TEXT,
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------- Avaliações
-- RF22 / RN11 — rubrica preenchida pelo tutor ao final de cada etapa
CREATE TABLE IF NOT EXISTS rubricas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id            INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  aluno_id              INTEGER NOT NULL REFERENCES usuarios(id),
  tutor_id              INTEGER NOT NULL REFERENCES usuarios(id),
  etapa                 INTEGER NOT NULL CHECK (etapa IN (1, 2, 3)),
  nota                  REAL NOT NULL,     -- 0 a 10, calculada a partir dos critérios
  comentario            TEXT,
  validacao_status      TEXT NOT NULL DEFAULT 'pendente' CHECK (validacao_status IN ('pendente', 'validado', 'ajuste')),  -- RU11
  validacao_comentario  TEXT,
  validado_por          INTEGER REFERENCES usuarios(id),
  validado_em           TEXT,
  criado_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  atualizado_em         TEXT,
  UNIQUE (tutoria_id, aluno_id, etapa)
);

CREATE TABLE IF NOT EXISTS rubrica_itens (
  rubrica_id     INTEGER NOT NULL REFERENCES rubricas(id) ON DELETE CASCADE,
  criterio_nome  TEXT NOT NULL,
  pontuacao_max  INTEGER NOT NULL,
  pontos         REAL NOT NULL
);

-- RF19 / RN12 — avaliação do tutor pelo professor e pelos alunos
CREATE TABLE IF NOT EXISTS avaliacoes_tutor (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id       INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  tutor_id         INTEGER NOT NULL REFERENCES usuarios(id),
  avaliador_id     INTEGER NOT NULL REFERENCES usuarios(id),
  avaliador_papel  TEXT NOT NULL CHECK (avaliador_papel IN ('aluno', 'professor')),
  etapa            INTEGER NOT NULL CHECK (etapa IN (1, 2, 3)),
  criterios        TEXT NOT NULL DEFAULT '{}',
  nota             REAL NOT NULL,
  comentario       TEXT,
  criado_em        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tutoria_id, tutor_id, avaliador_id, etapa)
);

-- RU9 — observações do professor sobre o desempenho do aluno
CREATE TABLE IF NOT EXISTS observacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id  INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  aluno_id    INTEGER NOT NULL REFERENCES usuarios(id),
  autor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('dificuldade', 'avanco', 'potencialidade')),
  texto       TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- RF27 — conteúdos dominados / que precisam de treino
CREATE TABLE IF NOT EXISTS conteudos_aluno (
  aluno_id        INTEGER NOT NULL REFERENCES usuarios(id),
  sala_id         INTEGER NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  conteudo_id     INTEGER NOT NULL REFERENCES conteudos(id),
  situacao        TEXT NOT NULL CHECK (situacao IN ('dominado', 'treinar')),
  registrado_por  INTEGER NOT NULL REFERENCES usuarios(id),
  atualizado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (aluno_id, sala_id, conteudo_id)
);

-- ------------------------------------------------ Registros do tutor
-- Assuntos trabalhados, estratégias e considerações (validadas pelo professor — RU11)
CREATE TABLE IF NOT EXISTS registros (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id            INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  tutor_id              INTEGER NOT NULL REFERENCES usuarios(id),
  data_encontro         TEXT NOT NULL,
  conteudo_id           INTEGER REFERENCES conteudos(id),
  assuntos              TEXT NOT NULL,
  estrategias           TEXT,
  consideracoes         TEXT,
  validacao_status      TEXT NOT NULL DEFAULT 'pendente' CHECK (validacao_status IN ('pendente', 'validado', 'ajuste')),
  validacao_comentario  TEXT,
  validado_por          INTEGER REFERENCES usuarios(id),
  validado_em           TEXT,
  criado_em             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- RF25 — materiais de apoio
CREATE TABLE IF NOT EXISTS materiais (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id   INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  aluno_id     INTEGER REFERENCES usuarios(id),    -- NULL = todos os tutorados da tutoria
  autor_id     INTEGER NOT NULL REFERENCES usuarios(id),
  titulo       TEXT NOT NULL,
  descricao    TEXT,
  link         TEXT,
  conteudo_id  INTEGER REFERENCES conteudos(id),
  criado_em    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- RF24 — comunicados do tutor
CREATE TABLE IF NOT EXISTS comunicados (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id  INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  autor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  titulo      TEXT NOT NULL,
  texto       TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS comunicado_destinatarios (
  comunicado_id  INTEGER NOT NULL REFERENCES comunicados(id) ON DELETE CASCADE,
  aluno_id       INTEGER NOT NULL REFERENCES usuarios(id),
  PRIMARY KEY (comunicado_id, aluno_id)
);

-- RF28 — espaço de dúvidas
CREATE TABLE IF NOT EXISTS duvidas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id      INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  aluno_id        INTEGER NOT NULL REFERENCES usuarios(id),
  conteudo_id     INTEGER REFERENCES conteudos(id),
  titulo          TEXT NOT NULL,
  texto           TEXT NOT NULL,
  resposta        TEXT,
  respondido_por  INTEGER REFERENCES usuarios(id),
  respondido_em   TEXT,
  criado_em       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- RF2 — chat 1:1 entre tutor e tutorado
CREATE TABLE IF NOT EXISTS mensagens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tutoria_id  INTEGER NOT NULL REFERENCES tutorias(id) ON DELETE CASCADE,
  aluno_id    INTEGER NOT NULL REFERENCES usuarios(id),   -- tutorado da conversa
  autor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  texto       TEXT,
  arquivo_id  INTEGER REFERENCES arquivos(id),
  lida_em     TEXT,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS arquivos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dono_id        INTEGER NOT NULL REFERENCES usuarios(id),
  nome_original  TEXT NOT NULL,
  nome_salvo     TEXT NOT NULL UNIQUE,
  mime           TEXT NOT NULL,
  tamanho        INTEGER NOT NULL,
  contexto       TEXT NOT NULL CHECK (contexto IN ('entrega', 'material', 'registro', 'mensagem')),
  ref_id         INTEGER,
  criado_em      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------- Notificações
CREATE TABLE IF NOT EXISTS notificacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  texto       TEXT,
  link        TEXT,
  lida        INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS alertas_prazo (
  atividade_id  INTEGER NOT NULL REFERENCES atividades(id) ON DELETE CASCADE,
  aluno_id      INTEGER NOT NULL REFERENCES usuarios(id),
  PRIMARY KEY (atividade_id, aluno_id)
);

-- ------------------------------------------------------------- Índices
CREATE INDEX IF NOT EXISTS ix_salas_prof_ano ON salas (professor_id, ano_letivo, serie);
CREATE INDEX IF NOT EXISTS ix_sala_alunos_aluno ON sala_alunos (aluno_id);
CREATE INDEX IF NOT EXISTS ix_tutorias_tutor ON tutorias (tutor_id);
CREATE INDEX IF NOT EXISTS ix_tutoria_alunos_aluno ON tutoria_alunos (aluno_id);
CREATE INDEX IF NOT EXISTS ix_atividades_sala ON atividades (sala_id, tutoria_id);
CREATE INDEX IF NOT EXISTS ix_entregas_aluno ON entregas (aluno_id);
CREATE INDEX IF NOT EXISTS ix_mensagens_conversa ON mensagens (tutoria_id, aluno_id, id);
CREATE INDEX IF NOT EXISTS ix_notificacoes_usuario ON notificacoes (usuario_id, lida, id);
CREATE INDEX IF NOT EXISTS ix_arquivos_ref ON arquivos (contexto, ref_id);
