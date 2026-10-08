// Salas / Unidades Curriculares (RF4, RF5, RF6, RF10, RF16, RN19).
const db = require('../db');
const { ErroRegra } = require('../lib/erros');
const { anoAtual } = require('../lib/formato');
const { notificar } = require('./notificacoes');

function anosLetivos(professorId) {
  const anos = db.all('SELECT DISTINCT ano_letivo FROM salas WHERE professor_id = ?', professorId).map((r) => r.ano_letivo);
  anos.push(anoAtual());
  return [...new Set(anos)].sort((a, b) => b - a);
}

function listar(professorId, ano, serie) {
  return db.all(
    `SELECT s.*,
       (SELECT COUNT(*) FROM sala_alunos sa WHERE sa.sala_id = s.id) AS total_alunos,
       (SELECT COUNT(*) FROM tutorias t WHERE t.sala_id = s.id) AS total_tutorias,
       (SELECT COUNT(*) FROM tutorias t WHERE t.sala_id = s.id AND t.status = 'ativa') AS tutorias_ativas,
       (SELECT COUNT(*) FROM sala_alunos sa WHERE sa.sala_id = s.id AND NOT EXISTS (
          SELECT 1 FROM tutoria_alunos ta JOIN tutorias t ON t.id = ta.tutoria_id
           WHERE t.sala_id = s.id AND ta.aluno_id = sa.aluno_id)) AS sem_tutor,
       (SELECT COUNT(*) FROM entregas e JOIN atividades a ON a.id = e.atividade_id
         WHERE a.sala_id = s.id AND e.status = 'enviada') AS entregas_pendentes
     FROM salas s
     WHERE s.professor_id = ? AND s.ano_letivo = ? AND (? IS NULL OR s.serie = ?)
     ORDER BY s.serie, s.nome`,
    professorId, ano, serie || null, serie || null,
  );
}

function validarDados({ nome, ano_letivo, serie }) {
  nome = String(nome || '').trim();
  const ano = Number(ano_letivo);
  const s = Number(serie);
  if (nome.length < 2) throw new ErroRegra('Informe o nome da sala.');
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) throw new ErroRegra('Ano letivo inválido.');
  if (![1, 2, 3].includes(s)) throw new ErroRegra('Selecione o ano do Ensino Médio (1º, 2º ou 3º).');
  return { nome, ano, serie: s };
}

function criar(dados, professorId) {
  const { nome, ano, serie } = validarDados(dados);
  const { id } = db.run(
    'INSERT INTO salas (nome, ano_letivo, serie, descricao, professor_id) VALUES (?, ?, ?, ?, ?)',
    nome, ano, serie, String(dados.descricao || '').trim() || null, professorId,
  );
  return id;
}

function editar(sala, dados) {
  const { nome, serie } = validarDados({ ...dados, ano_letivo: sala.ano_letivo });
  db.run('UPDATE salas SET nome = ?, serie = ?, descricao = ? WHERE id = ?',
    nome, serie, String(dados.descricao || '').trim() || null, sala.id);
}

// ------------------------------------------------------------ Alunos
function alunos(salaId) {
  return db.all(
    `SELECT u.id, u.nome, u.email, sa.incluido_em, t.id AS tutoria_id, t.status AS tutoria_status, tu.nome AS tutor_nome,
            (SELECT COUNT(*) FROM tutorias x WHERE x.sala_id = ? AND x.tutor_id = u.id) AS eh_tutor
       FROM sala_alunos sa
       JOIN usuarios u ON u.id = sa.aluno_id
       LEFT JOIN tutoria_alunos ta ON ta.aluno_id = u.id AND ta.tutoria_id IN (SELECT id FROM tutorias WHERE sala_id = sa.sala_id)
       LEFT JOIN tutorias t ON t.id = ta.tutoria_id
       LEFT JOIN usuarios tu ON tu.id = t.tutor_id
      WHERE sa.sala_id = ?
      ORDER BY u.nome`,
    salaId, salaId,
  );
}

/** Alunos com conta ativa que ainda não estão na sala (RN19: reaproveita o cadastro de anos anteriores). */
function alunosDisponiveis(salaId, busca = '') {
  const termo = `%${String(busca).trim()}%`;
  return db.all(
    `SELECT u.id, u.nome, u.email,
            (SELECT GROUP_CONCAT(s.nome || ' (' || s.ano_letivo || ')', '; ') FROM sala_alunos sa2
               JOIN salas s ON s.id = sa2.sala_id WHERE sa2.aluno_id = u.id) AS historico
       FROM usuarios u
      WHERE u.papel = 'aluno' AND u.email_confirmado = 1
        AND u.id NOT IN (SELECT aluno_id FROM sala_alunos WHERE sala_id = ?)
        AND (u.nome LIKE ? OR u.email LIKE ?)
      ORDER BY u.nome LIMIT 100`,
    salaId, termo, termo,
  );
}

function adicionarAlunos(sala, ids) {
  const lista = [].concat(ids || []).map(Number).filter(Boolean);
  if (!lista.length) throw new ErroRegra('Selecione ao menos um aluno.');
  let incluidos = 0;
  db.transacao(() => {
    for (const id of lista) {
      const aluno = db.get("SELECT id FROM usuarios WHERE id = ? AND papel = 'aluno' AND email_confirmado = 1", id);
      if (!aluno) continue;
      incluidos += db.run('INSERT OR IGNORE INTO sala_alunos (sala_id, aluno_id) VALUES (?, ?)', sala.id, id).changes;
    }
  });
  if (incluidos) {
    notificar(lista, {
      tipo: 'sala', titulo: 'Você foi incluído em uma sala',
      texto: `${sala.nome} — ${sala.ano_letivo}`, link: '/aluno',
    });
  }
  return incluidos;
}

function removerAluno(sala, alunoId) {
  const vinculo = db.get(
    `SELECT 1 FROM tutoria_alunos ta JOIN tutorias t ON t.id = ta.tutoria_id WHERE t.sala_id = ? AND ta.aluno_id = ?`,
    sala.id, alunoId,
  );
  if (vinculo) throw new ErroRegra('Desvincule o aluno do tutor antes de removê-lo da sala.');
  if (db.get('SELECT 1 FROM entregas e JOIN atividades a ON a.id = e.atividade_id WHERE a.sala_id = ? AND e.aluno_id = ?', sala.id, alunoId)) {
    throw new ErroRegra('Este aluno já possui atividades entregues nesta sala; o histórico precisa ser preservado.');
  }
  db.run('DELETE FROM sala_alunos WHERE sala_id = ? AND aluno_id = ?', sala.id, alunoId);
}

// ----------------------------------------------- Metas e critérios (RF16)
function salvarMetas(sala, { metas, objetivos }) {
  db.run('UPDATE salas SET metas = ?, objetivos = ? WHERE id = ?',
    String(metas || '').trim() || null, String(objetivos || '').trim() || null, sala.id);
}

const criterios = (salaId) => db.all('SELECT * FROM sala_criterios WHERE sala_id = ? ORDER BY ordem, id', salaId);

function adicionarCriterio(sala, { nome, descricao, pontuacao_max }) {
  nome = String(nome || '').trim();
  const max = Number(pontuacao_max);
  if (nome.length < 2) throw new ErroRegra('Informe o nome do critério.');
  if (!Number.isInteger(max) || max < 1 || max > 100) throw new ErroRegra('A pontuação máxima deve ser um número inteiro entre 1 e 100.');
  const ordem = db.get('SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM sala_criterios WHERE sala_id = ?', sala.id).o;
  db.run('INSERT INTO sala_criterios (sala_id, nome, descricao, pontuacao_max, ordem) VALUES (?, ?, ?, ?, ?)',
    sala.id, nome, String(descricao || '').trim() || null, max, ordem);
}

function removerCriterio(sala, criterioId) {
  db.run('DELETE FROM sala_criterios WHERE id = ? AND sala_id = ?', criterioId, sala.id);
}

/** Tutores e tutorados ativos da sala que devem ser avisados de mudanças. */
function participantes(salaId) {
  const ids = db.all('SELECT aluno_id AS id FROM sala_alunos WHERE sala_id = ?', salaId).map((r) => r.id);
  db.all("SELECT tutor_id AS id FROM tutorias WHERE sala_id = ? AND status = 'ativa'", salaId).forEach((r) => ids.push(r.id));
  return [...new Set(ids)];
}

// ---------------------------------------------------------- Avisos (RF10)
function publicarAviso(sala, autorId, { titulo, texto }) {
  titulo = String(titulo || '').trim();
  texto = String(texto || '').trim();
  if (titulo.length < 3 || !texto) throw new ErroRegra('Informe o título e o texto do aviso.');
  db.run('INSERT INTO avisos (sala_id, autor_id, titulo, texto) VALUES (?, ?, ?, ?)', sala.id, autorId, titulo, texto);
  notificar(participantes(sala.id), { tipo: 'aviso', titulo: `Aviso: ${titulo}`, texto: sala.nome, link: '/aluno/avisos' });
}

const avisos = (salaIds) => {
  const ids = [].concat(salaIds);
  if (!ids.length) return [];
  return db.all(
    `SELECT a.*, s.nome AS sala_nome, u.nome AS autor_nome FROM avisos a
       JOIN salas s ON s.id = a.sala_id JOIN usuarios u ON u.id = a.autor_id
      WHERE a.sala_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.id DESC`,
    ...ids,
  );
};

function removerAviso(sala, avisoId) {
  db.run('DELETE FROM avisos WHERE id = ? AND sala_id = ?', avisoId, sala.id);
}

module.exports = {
  anosLetivos, listar, criar, editar,
  alunos, alunosDisponiveis, adicionarAlunos, removerAluno,
  salvarMetas, criterios, adicionarCriterio, removerCriterio,
  participantes, publicarAviso, avisos, removerAviso,
};
