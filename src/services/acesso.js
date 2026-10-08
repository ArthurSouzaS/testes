// Consultas de contexto e verificações de permissão compartilhadas pelas rotas.
const db = require('../db');
const { ErroAcesso, ErroRegra, NaoEncontrado } = require('../lib/erros');

const sala = (id) => {
  const s = db.get(
    `SELECT s.*, u.nome AS professor_nome FROM salas s JOIN usuarios u ON u.id = s.professor_id WHERE s.id = ?`,
    Number(id),
  );
  if (!s) throw new NaoEncontrado('Sala não encontrada.');
  return s;
};

const tutoria = (id) => {
  const t = db.get(
    `SELECT t.*, u.nome AS tutor_nome, u.email AS tutor_email,
            s.nome AS sala_nome, s.ano_letivo, s.serie, s.professor_id, s.metas, s.objetivos
       FROM tutorias t
       JOIN usuarios u ON u.id = t.tutor_id
       JOIN salas s ON s.id = t.sala_id
      WHERE t.id = ?`,
    Number(id),
  );
  if (!t) throw new NaoEncontrado('Tutoria não encontrada.');
  t.modelos = JSON.parse(t.modelos_permitidos || '[]');
  return t;
};

const ehTutorado = (alunoId, tutoriaId) =>
  !!db.get('SELECT 1 FROM tutoria_alunos WHERE tutoria_id = ? AND aluno_id = ?', tutoriaId, alunoId);

/** Tutoria em que o aluno é tutorado dentro de uma sala (RN05: no máximo uma). */
const tutoriaDoAluno = (alunoId, salaId) =>
  db.get(
    `SELECT t.* FROM tutorias t JOIN tutoria_alunos ta ON ta.tutoria_id = t.id
      WHERE ta.aluno_id = ? AND t.sala_id = ?`,
    alunoId, salaId,
  );

const alunosDaTutoria = (tutoriaId) =>
  db.all(
    `SELECT u.id, u.nome, u.email, ta.vinculado_em FROM tutoria_alunos ta
       JOIN usuarios u ON u.id = ta.aluno_id WHERE ta.tutoria_id = ? ORDER BY u.nome`,
    tutoriaId,
  );

const membroDaSala = (alunoId, salaId) =>
  !!db.get('SELECT 1 FROM sala_alunos WHERE sala_id = ? AND aluno_id = ?', salaId, alunoId);

/**
 * Relação do usuário com uma tutoria:
 *  'professor'         — professor responsável pela sala
 *  'professor_leitura' — outro professor, só em tutorias finalizadas (RN18)
 *  'tutor' | 'tutorado'
 */
function relacaoComTutoria(usuario, t) {
  if (usuario.papel === 'professor') {
    if (t.professor_id === usuario.id) return 'professor';
    if (t.status === 'finalizada') return 'professor_leitura';
    return null;
  }
  if (t.tutor_id === usuario.id) return 'tutor';
  if (ehTutorado(usuario.id, t.id)) return 'tutorado';
  return null;
}

function exigirRelacao(usuario, t, ...permitidas) {
  const rel = relacaoComTutoria(usuario, t);
  if (!rel || (permitidas.length && !permitidas.includes(rel))) throw new ErroAcesso();
  return rel;
}

function exigirProfessorDaSala(usuario, s) {
  if (usuario.papel !== 'professor' || s.professor_id !== usuario.id) {
    throw new ErroAcesso('Apenas o professor responsável por esta sala pode realizar esta ação.');
  }
}

/** RN14 — tutoria finalizada fica somente para consulta. */
function exigirAtiva(t) {
  if (t.status !== 'ativa') {
    throw new ErroRegra('Esta tutoria foi finalizada: é possível apenas consultar o desempenho e o histórico.', 'RN14');
  }
}

/**
 * RNF8 — notas e dashboard do aluno só podem ser vistos pelo próprio aluno,
 * pelo tutor que o acompanha e pelo professor.
 */
function podeVerAluno(usuario, alunoId, salaId) {
  if (usuario.id === Number(alunoId)) return true;
  const s = db.get('SELECT professor_id FROM salas WHERE id = ?', salaId);
  if (!s) return false;
  if (usuario.papel === 'professor') {
    if (s.professor_id === usuario.id) return true;
    const t = tutoriaDoAluno(alunoId, salaId);
    return !!(t && t.status === 'finalizada'); // RN18
  }
  const t = tutoriaDoAluno(alunoId, salaId);
  return !!(t && t.tutor_id === usuario.id);
}

/** Tutorias em que o usuário (aluno) é tutor. */
const tutoriasComoTutor = (usuarioId) =>
  db.all(
    `SELECT t.*, s.nome AS sala_nome, s.ano_letivo, s.serie,
            (SELECT COUNT(*) FROM tutoria_alunos ta WHERE ta.tutoria_id = t.id) AS total_tutorados
       FROM tutorias t JOIN salas s ON s.id = t.sala_id
      WHERE t.tutor_id = ? ORDER BY s.ano_letivo DESC, t.status, s.nome`,
    usuarioId,
  );

/** Salas em que o aluno está matriculado, com a tutoria (se houver). */
const salasDoAluno = (alunoId) =>
  db.all(
    `SELECT s.*, u.nome AS professor_nome, t.id AS tutoria_id, t.status AS tutoria_status,
            t.tutor_id, tu.nome AS tutor_nome
       FROM sala_alunos sa
       JOIN salas s ON s.id = sa.sala_id
       JOIN usuarios u ON u.id = s.professor_id
       LEFT JOIN tutoria_alunos ta ON ta.aluno_id = sa.aluno_id
            AND ta.tutoria_id IN (SELECT id FROM tutorias WHERE sala_id = s.id)
       LEFT JOIN tutorias t ON t.id = ta.tutoria_id
       LEFT JOIN usuarios tu ON tu.id = t.tutor_id
      WHERE sa.aluno_id = ?
      ORDER BY s.ano_letivo DESC, s.nome`,
    alunoId,
  );

module.exports = {
  sala,
  tutoria,
  ehTutorado,
  tutoriaDoAluno,
  alunosDaTutoria,
  membroDaSala,
  relacaoComTutoria,
  exigirRelacao,
  exigirProfessorDaSala,
  exigirAtiva,
  podeVerAluno,
  tutoriasComoTutor,
  salasDoAluno,
};
