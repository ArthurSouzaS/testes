// Tutorias: designação de tutores, vínculos, revogação e ciclo de vida
// (RF3, RF7, RF8, RF9, RF17, RF18, RN01–RN07, RN13–RN17).
const db = require('../db');
const { ErroRegra } = require('../lib/erros');
const { MODELOS } = require('../lib/dominio');
const { anoAtual, hoje } = require('../lib/formato');
const acesso = require('./acesso');
const { notificar, atualizar } = require('./notificacoes');

const alunoAtivo = (id) =>
  db.get("SELECT id, nome FROM usuarios WHERE id = ? AND papel = 'aluno' AND email_confirmado = 1", Number(id));

const ehTutorNaSala = (alunoId, salaId) =>
  !!db.get('SELECT 1 FROM tutorias WHERE sala_id = ? AND tutor_id = ?', salaId, alunoId);

/** Tutorias da sala com seus tutorados. */
function daSala(salaId) {
  const tutorias = db.all(
    `SELECT t.*, u.nome AS tutor_nome, u.email AS tutor_email FROM tutorias t
       JOIN usuarios u ON u.id = t.tutor_id WHERE t.sala_id = ? ORDER BY t.status, u.nome`,
    salaId,
  );
  for (const t of tutorias) {
    t.modelos = JSON.parse(t.modelos_permitidos || '[]');
    t.tutorados = acesso.alunosDaTutoria(t.id);
  }
  return tutorias;
}

/**
 * RF7 — o professor designa um tutor para a sala.
 * RN01: só o professor promove. RN02: não pode ser tutorado na mesma sala. RN03: pode ser tutorado em outra.
 */
function designarTutor(sala, alunoId) {
  const aluno = alunoAtivo(alunoId);
  if (!aluno) throw new ErroRegra('Selecione um aluno com cadastro ativo.');
  if (ehTutorNaSala(aluno.id, sala.id)) throw new ErroRegra(`${aluno.nome} já é tutor(a) nesta sala.`);
  if (acesso.tutoriaDoAluno(aluno.id, sala.id)) {
    throw new ErroRegra(`${aluno.nome} é tutorado(a) nesta sala e não pode ser tutor(a) dela.`, 'RN02');
  }
  const inicio = hoje();
  const id = db.transacao(() => {
    const { id } = db.run('INSERT INTO tutorias (sala_id, tutor_id, data_inicio) VALUES (?, ?, ?)', sala.id, aluno.id, inicio);
    db.run('INSERT INTO tutoria_tutores_hist (tutoria_id, tutor_id, inicio) VALUES (?, ?, ?)', id, aluno.id, inicio);
    return id;
  });
  notificar(aluno.id, {
    tipo: 'tutoria', titulo: 'Você agora é tutor(a)!',
    texto: `${sala.nome} — ${sala.ano_letivo}`, link: `/tutor/tutorias/${id}`,
  });
  return id;
}

/**
 * RF8 — o professor vincula um aluno da sala a um tutor.
 * RN05: um tutor por aluno na sala (se já houver, o aluno é transferido). RN06: vários tutorados por tutor.
 */
function vincularAluno(sala, tutoria, alunoId) {
  acesso.exigirAtiva(tutoria);
  const aluno = alunoAtivo(alunoId);
  if (!aluno || !acesso.membroDaSala(aluno.id, sala.id)) throw new ErroRegra('O aluno precisa estar matriculado nesta sala.');
  if (aluno.id === tutoria.tutor_id || ehTutorNaSala(aluno.id, sala.id)) {
    throw new ErroRegra(`${aluno.nome} é tutor(a) nesta sala e não pode ser tutorado(a) nela.`, 'RN02');
  }
  const atual = acesso.tutoriaDoAluno(aluno.id, sala.id);
  if (atual && atual.id === tutoria.id) return { transferido: false };
  if (atual && atual.status === 'finalizada') {
    throw new ErroRegra(`${aluno.nome} pertence a uma tutoria finalizada; reabra-a para alterar o vínculo.`, 'RN14');
  }
  db.transacao(() => {
    if (atual) db.run('DELETE FROM tutoria_alunos WHERE tutoria_id = ? AND aluno_id = ?', atual.id, aluno.id);
    db.run('INSERT INTO tutoria_alunos (tutoria_id, aluno_id) VALUES (?, ?)', tutoria.id, aluno.id);
  });
  notificar(aluno.id, {
    tipo: 'tutoria', titulo: 'Seu tutor foi definido',
    texto: `${tutoria.tutor_nome} será seu tutor(a) em ${sala.nome}.`, link: '/aluno',
  });
  notificar(tutoria.tutor_id, {
    tipo: 'tutoria', titulo: 'Novo tutorado', texto: `${aluno.nome} foi vinculado(a) a você.`,
    link: `/tutor/tutorias/${tutoria.id}`,
  });
  return { transferido: !!atual };
}

function desvincularAluno(tutoria, alunoId) {
  acesso.exigirAtiva(tutoria);
  db.run('DELETE FROM tutoria_alunos WHERE tutoria_id = ? AND aluno_id = ?', tutoria.id, Number(alunoId));
}

/**
 * RF18 / RN04 — revoga o tutor e direciona a tutoria a outra pessoa,
 * sem apagar o histórico (que passa ao novo tutor).
 */
function revogarTutor(tutoria, novoTutorId, motivo) {
  const novo = alunoAtivo(novoTutorId);
  if (!novo) throw new ErroRegra('Selecione o aluno que assumirá a tutoria.');
  if (novo.id === tutoria.tutor_id) throw new ErroRegra('Escolha uma pessoa diferente do tutor atual.');
  if (ehTutorNaSala(novo.id, tutoria.sala_id)) {
    throw new ErroRegra(`${novo.nome} já é tutor(a) nesta sala. Para redistribuir tutorados entre tutores existentes, use a tela de vínculos.`);
  }
  if (acesso.tutoriaDoAluno(novo.id, tutoria.sala_id)) {
    throw new ErroRegra(`${novo.nome} é tutorado(a) nesta sala e não pode assumir a tutoria.`, 'RN02');
  }
  const data = hoje();
  db.transacao(() => {
    db.run('UPDATE tutoria_tutores_hist SET fim = ?, motivo = ? WHERE tutoria_id = ? AND fim IS NULL',
      data, String(motivo || '').trim() || 'Status de tutor revogado pelo professor', tutoria.id);
    db.run('INSERT INTO tutoria_tutores_hist (tutoria_id, tutor_id, inicio) VALUES (?, ?, ?)', tutoria.id, novo.id, data);
    db.run('UPDATE tutorias SET tutor_id = ? WHERE id = ?', novo.id, tutoria.id);
  });
  notificar(tutoria.tutor_id, {
    tipo: 'tutoria', titulo: 'Seu status de tutor foi revogado',
    texto: `${tutoria.sala_nome}: a tutoria foi direcionada a outra pessoa.`, link: '/tutor',
  });
  notificar(novo.id, {
    tipo: 'tutoria', titulo: 'Você assumiu uma tutoria',
    texto: `${tutoria.sala_nome} — o histórico anterior está disponível para você.`, link: `/tutor/tutorias/${tutoria.id}`,
  });
  notificar(acesso.alunosDaTutoria(tutoria.id).map((a) => a.id), {
    tipo: 'tutoria', titulo: 'Seu tutor mudou', texto: `${novo.nome} é seu novo tutor(a) em ${tutoria.sala_nome}.`, link: '/aluno',
  });
}

const historicoTutores = (tutoriaId) =>
  db.all(
    `SELECT h.*, u.nome AS tutor_nome FROM tutoria_tutores_hist h JOIN usuarios u ON u.id = h.tutor_id
      WHERE h.tutoria_id = ? ORDER BY h.id`,
    tutoriaId,
  );

// -------------------------------------------------- Permissões (RF9)
function salvarPermissoes(tutoria, { pode_criar_atividades, modelos }) {
  const pode = pode_criar_atividades === '1' || pode_criar_atividades === true || pode_criar_atividades === 'on';
  const lista = [].concat(modelos || []).filter((m) => MODELOS[m]);
  if (pode && !lista.length) throw new ErroRegra('Selecione ao menos um modelo de atividade permitido.', 'RN09');
  db.run('UPDATE tutorias SET pode_criar_atividades = ?, modelos_permitidos = ? WHERE id = ?',
    pode ? 1 : 0, JSON.stringify(pode ? lista : []), tutoria.id);
  notificar(tutoria.tutor_id, {
    tipo: 'tutoria',
    titulo: pode ? 'Você pode criar atividades' : 'Permissão de criar atividades removida',
    texto: pode ? `Modelos liberados: ${lista.map((m) => MODELOS[m].nome).join(', ')}` : tutoria.sala_nome,
    link: `/tutor/tutorias/${tutoria.id}`,
  });
}

// --------------------------------------------- Ciclo da tutoria (RF3)
const conteudos = (tutoriaId) =>
  db.all(
    `SELECT c.* FROM tutoria_conteudos tc JOIN conteudos c ON c.id = tc.conteudo_id
      WHERE tc.tutoria_id = ? ORDER BY c.eixo, c.nome`,
    tutoriaId,
  );

function salvarCiclo(tutoria, { data_inicio, metas_especificas, conteudos: ids }) {
  acesso.exigirAtiva(tutoria);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data_inicio || ''))) throw new ErroRegra('Informe a data de início.');
  const lista = [].concat(ids || []).map(Number).filter(Boolean);
  db.transacao(() => {
    db.run('UPDATE tutorias SET data_inicio = ?, metas_especificas = ? WHERE id = ?',
      data_inicio, String(metas_especificas || '').trim() || null, tutoria.id);
    db.run('DELETE FROM tutoria_conteudos WHERE tutoria_id = ?', tutoria.id);
    for (const c of lista) db.run('INSERT OR IGNORE INTO tutoria_conteudos (tutoria_id, conteudo_id) VALUES (?, ?)', tutoria.id, c);
  });
}

/** RN15 — pendências que impedem a finalização. */
function pendencias(tutoria) {
  const entregas = db.all(
    `SELECT e.id, a.titulo, u.nome AS aluno_nome FROM entregas e
       JOIN atividades a ON a.id = e.atividade_id
       JOIN usuarios u ON u.id = e.aluno_id
      WHERE e.status = 'enviada' AND a.sala_id = ?
        AND (a.tutoria_id = ? OR (a.tutoria_id IS NULL AND e.aluno_id IN (SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?)))`,
    tutoria.sala_id, tutoria.id, tutoria.id,
  );
  const contestacoes = db.all(
    `SELECT c.id, e.id AS entrega_id, a.titulo, u.nome AS aluno_nome FROM contestacoes c
       JOIN entregas e ON e.id = c.entrega_id
       JOIN atividades a ON a.id = e.atividade_id
       JOIN usuarios u ON u.id = c.aluno_id
      WHERE c.status = 'aberta' AND a.sala_id = ?
        AND (a.tutoria_id = ? OR (a.tutoria_id IS NULL AND e.aluno_id IN (SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?)))`,
    tutoria.sala_id, tutoria.id, tutoria.id,
  );
  return { entregas, contestacoes, total: entregas.length + contestacoes.length };
}

/** RN13 / RN15 — só o professor responsável finaliza, e só sem pendências. */
function finalizar(tutoria) {
  if (tutoria.status === 'finalizada') throw new ErroRegra('Esta tutoria já está finalizada.');
  const p = pendencias(tutoria);
  if (p.total) {
    throw new ErroRegra(
      `Não é possível finalizar: há ${p.entregas.length} atividade(s) sem correção e ${p.contestacoes.length} contestação(ões) em aberto.`,
      'RN15',
    );
  }
  db.run("UPDATE tutorias SET status = 'finalizada', data_fim = ? WHERE id = ?", hoje(), tutoria.id);
  const envolvidos = [tutoria.tutor_id, ...acesso.alunosDaTutoria(tutoria.id).map((a) => a.id)];
  notificar(envolvidos, {
    tipo: 'tutoria', titulo: 'Tutoria finalizada',
    texto: `${tutoria.sala_nome}: agora é possível apenas consultar o desempenho e o histórico.`, link: '/aluno',
  });
}

/** RN17 — reabertura apenas dentro do mesmo ano letivo. */
function reabrir(tutoria) {
  if (tutoria.status !== 'finalizada') throw new ErroRegra('Esta tutoria já está ativa.');
  if (tutoria.ano_letivo !== anoAtual()) {
    throw new ErroRegra(`Tutorias de ${tutoria.ano_letivo} não podem mais ser reabertas: o ano letivo já virou.`, 'RN17');
  }
  if (!alunoAtivo(tutoria.tutor_id)) throw new ErroRegra('O tutor desta tutoria não está mais ativo.');
  db.run("UPDATE tutorias SET status = 'ativa', data_fim = NULL WHERE id = ?", tutoria.id);
  notificar([tutoria.tutor_id, ...acesso.alunosDaTutoria(tutoria.id).map((a) => a.id)], {
    tipo: 'tutoria', titulo: 'Tutoria reaberta', texto: tutoria.sala_nome, link: '/aluno',
  });
}

// --------------------------------------- Pedidos de tutoria (RF17 / RN21)
const pedidosPendentes = (professorId) =>
  db.all(
    `SELECT p.*, u.nome AS aluno_nome, u.email AS aluno_email,
            (SELECT GROUP_CONCAT(s.nome || ' (' || s.ano_letivo || ')', '; ') FROM sala_alunos sa
               JOIN salas s ON s.id = sa.sala_id WHERE sa.aluno_id = u.id) AS salas_aluno
       FROM pedidos_tutoria p JOIN usuarios u ON u.id = p.aluno_id
      WHERE p.professor_id = ? AND p.status = 'pendente' AND u.email_confirmado = 1
      ORDER BY p.id`,
    professorId,
  );

const pedidosDecididos = (professorId) =>
  db.all(
    `SELECT p.*, u.nome AS aluno_nome, s.nome AS sala_nome FROM pedidos_tutoria p
       JOIN usuarios u ON u.id = p.aluno_id LEFT JOIN salas s ON s.id = p.sala_id
      WHERE p.professor_id = ? AND p.status <> 'pendente' ORDER BY p.decidido_em DESC LIMIT 30`,
    professorId,
  );

function pedido(id, professorId) {
  const p = db.get("SELECT * FROM pedidos_tutoria WHERE id = ? AND professor_id = ? AND status = 'pendente'", Number(id), professorId);
  if (!p) throw new ErroRegra('Pedido não encontrado ou já decidido.');
  return p;
}

function aceitarPedido(professor, pedidoId, salaId) {
  const p = pedido(pedidoId, professor.id);
  const sala = acesso.sala(salaId);
  acesso.exigirProfessorDaSala(professor, sala);
  return db.transacao(() => {
    const tutoriaId = designarTutor(sala, p.aluno_id);
    db.run("UPDATE pedidos_tutoria SET status = 'aceito', sala_id = ?, decidido_em = ? WHERE id = ?", sala.id, db.agora(), p.id);
    return tutoriaId;
  });
}

function recusarPedido(professor, pedidoId, resposta) {
  const p = pedido(pedidoId, professor.id);
  db.run("UPDATE pedidos_tutoria SET status = 'recusado', resposta = ?, decidido_em = ? WHERE id = ?",
    String(resposta || '').trim() || null, db.agora(), p.id);
  notificar(p.aluno_id, {
    tipo: 'pedido', titulo: 'Pedido de tutoria recusado',
    texto: resposta ? String(resposta).slice(0, 140) : 'Você continua participando como aluno.', link: '/perfil',
  });
}

/** RN18 — tutorias finalizadas, consultáveis por qualquer professor. */
const finalizadas = (ano) =>
  db.all(
    `SELECT t.*, s.nome AS sala_nome, s.ano_letivo, s.serie, u.nome AS tutor_nome, p.nome AS professor_nome,
            (SELECT COUNT(*) FROM tutoria_alunos ta WHERE ta.tutoria_id = t.id) AS total_tutorados
       FROM tutorias t JOIN salas s ON s.id = t.sala_id
       JOIN usuarios u ON u.id = t.tutor_id JOIN usuarios p ON p.id = s.professor_id
      WHERE t.status = 'finalizada' AND (? IS NULL OR s.ano_letivo = ?)
      ORDER BY s.ano_letivo DESC, s.nome, u.nome`,
    ano || null, ano || null,
  );

function sinalizar(tutoria, motivo) {
  atualizar([tutoria.tutor_id, tutoria.professor_id, ...acesso.alunosDaTutoria(tutoria.id).map((a) => a.id)], motivo);
}

module.exports = {
  daSala, designarTutor, vincularAluno, desvincularAluno, revogarTutor, historicoTutores,
  salvarPermissoes, conteudos, salvarCiclo, pendencias, finalizar, reabrir,
  pedidosPendentes, pedidosDecididos, aceitarPedido, recusarPedido, finalizadas, sinalizar, ehTutorNaSala,
};
