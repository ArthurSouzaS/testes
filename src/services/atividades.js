// Atividades, entregas, correções, comentários e contestações
// (RF11, RF12, RF20, RF21, RF29, RF30, RF31, RN08, RN09, RN10, RN14).
const db = require('../db');
const { ErroRegra, ErroAcesso, NaoEncontrado } = require('../lib/erros');
const { MODELOS, TIPOS_ATIVIDADE } = require('../lib/dominio');
const { localParaIso, nota: fmtNota } = require('../lib/formato');
const acesso = require('./acesso');
const { notificar, atualizar } = require('./notificacoes');

function carregar(id) {
  const a = db.get(
    `SELECT a.*, s.nome AS sala_nome, s.professor_id, s.ano_letivo, u.nome AS autor_nome, c.nome AS conteudo_nome,
            t.status AS tutoria_status, t.tutor_id
       FROM atividades a JOIN salas s ON s.id = a.sala_id JOIN usuarios u ON u.id = a.autor_id
       LEFT JOIN conteudos c ON c.id = a.conteudo_id LEFT JOIN tutorias t ON t.id = a.tutoria_id
      WHERE a.id = ?`,
    Number(id),
  );
  if (!a) throw new NaoEncontrado('Atividade não encontrada.');
  a.questoes = db.all('SELECT * FROM questoes WHERE atividade_id = ? ORDER BY ordem', a.id).map((q) => ({
    ...q, alternativas: q.alternativas ? JSON.parse(q.alternativas) : null,
  }));
  a.encerrada = a.prazo < db.agora();
  return a;
}

/** Valida as questões enviadas pelo construtor de atividades (JSON). */
function validarQuestoes(modelo, json) {
  const def = MODELOS[modelo];
  if (def.semQuestoes) return [];
  let lista;
  try {
    lista = JSON.parse(json || '[]');
  } catch {
    throw new ErroRegra('Não foi possível ler as questões da atividade.');
  }
  if (!Array.isArray(lista) || !lista.length) throw new ErroRegra('Adicione ao menos uma questão.');
  if (lista.length > 50) throw new ErroRegra('Uma atividade pode ter no máximo 50 questões.');
  return lista.map((q, i) => {
    const enunciado = String(q.enunciado || '').trim();
    if (!enunciado) throw new ErroRegra(`A questão ${i + 1} está sem enunciado.`);
    if (!def.alternativas) return { enunciado, alternativas: null, correta: null, exige: 0 };
    const alternativas = [].concat(q.alternativas || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (alternativas.length < 2) throw new ErroRegra(`A questão ${i + 1} precisa de pelo menos duas alternativas.`);
    let correta = q.correta === '' || q.correta === null || q.correta === undefined ? null : Number(q.correta);
    if (correta !== null && !(correta >= 0 && correta < alternativas.length)) correta = null;
    return { enunciado, alternativas, correta, exige: def.justificativa ? 1 : 0 };
  });
}

/**
 * Cria uma atividade.
 * - Professor: atividade da sala, vale para todos os alunos (RF11 / RN10).
 * - Tutor: atividade da tutoria, só com permissão (RN08) e modelos autorizados (RN09).
 */
function criar(usuario, { sala, tutoria }, dados) {
  const titulo = String(dados.titulo || '').trim();
  const enunciado = String(dados.enunciado || '').trim();
  const modelo = dados.modelo;
  const etapa = Number(dados.etapa);
  const valor = Number(String(dados.valor || '10').replace(',', '.'));
  const prazo = localParaIso(dados.prazo);
  const tipo = TIPOS_ATIVIDADE[dados.tipo] ? dados.tipo : 'exercicio';
  const conteudoId = Number(dados.conteudo_id) || null;

  if (!MODELOS[modelo]) throw new ErroRegra('Selecione um modelo de atividade.');
  if (tutoria) {
    acesso.exigirAtiva(tutoria);
    if (tutoria.tutor_id !== usuario.id) throw new ErroAcesso();
    if (!tutoria.pode_criar_atividades) {
      throw new ErroRegra('O professor ainda não liberou a criação de atividades para você.', 'RN08');
    }
    if (!tutoria.modelos.includes(modelo)) throw new ErroRegra('Este modelo de atividade não foi autorizado pelo professor.', 'RN09');
  } else {
    acesso.exigirProfessorDaSala(usuario, sala);
  }
  if (titulo.length < 3) throw new ErroRegra('Informe um título para a atividade.');
  if (!enunciado) throw new ErroRegra('Informe o enunciado / orientações da atividade.');
  if (![1, 2, 3].includes(etapa)) throw new ErroRegra('Selecione o trimestre (etapa).');
  if (!(valor > 0 && valor <= 100)) throw new ErroRegra('O valor da atividade deve estar entre 0 e 100.');
  if (!prazo) throw new ErroRegra('Informe o prazo de entrega.');
  if (prazo < db.agora()) throw new ErroRegra('O prazo deve ser uma data futura.');
  const questoes = validarQuestoes(modelo, dados.questoes_json);

  const id = db.transacao(() => {
    const { id } = db.run(
      `INSERT INTO atividades (sala_id, tutoria_id, autor_id, titulo, enunciado, tipo, modelo, conteudo_id, etapa, valor, prazo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sala.id, tutoria ? tutoria.id : null, usuario.id, titulo, enunciado, tutoria ? 'exercicio' : tipo, modelo,
      conteudoId, etapa, valor, prazo,
    );
    questoes.forEach((q, i) =>
      db.run('INSERT INTO questoes (atividade_id, ordem, enunciado, alternativas, correta, exige_justificativa) VALUES (?, ?, ?, ?, ?, ?)',
        id, i + 1, q.enunciado, q.alternativas ? JSON.stringify(q.alternativas) : null, q.correta, q.exige));
    return id;
  });

  notificar(destinatarios({ sala_id: sala.id, tutoria_id: tutoria ? tutoria.id : null }), {
    tipo: 'atividade', titulo: `Nova atividade: ${titulo}`, texto: sala.nome, link: `/atividades/${id}`,
  });
  if (!tutoria) {
    // Tutores também acompanham as atividades da sala
    atualizar(db.all("SELECT tutor_id FROM tutorias WHERE sala_id = ? AND status = 'ativa'", sala.id).map((r) => r.tutor_id), 'atividade');
  } else {
    atualizar(sala.professor_id, 'atividade');
  }
  return id;
}

function excluir(usuario, atividade) {
  const pode = atividade.tutoria_id ? atividade.autor_id === usuario.id : atividade.professor_id === usuario.id;
  if (!pode) throw new ErroAcesso();
  if (db.get('SELECT 1 FROM entregas WHERE atividade_id = ?', atividade.id)) {
    throw new ErroRegra('Esta atividade já tem entregas e não pode ser excluída (o histórico deve ser preservado).');
  }
  db.run('DELETE FROM atividades WHERE id = ?', atividade.id);
}

/** Alunos a quem a atividade se destina (RN10: atividade da sala vale para todos). */
function destinatarios(atividade) {
  if (atividade.tutoria_id) {
    return db.all('SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?', atividade.tutoria_id).map((r) => r.aluno_id);
  }
  return db.all('SELECT aluno_id FROM sala_alunos WHERE sala_id = ?', atividade.sala_id).map((r) => r.aluno_id);
}

/** RF30 — o aluno só acessa atividades destinadas a ele. */
function destinadaAo(alunoId, atividade) {
  if (atividade.tutoria_id) return acesso.ehTutorado(alunoId, atividade.tutoria_id);
  return acesso.membroDaSala(alunoId, atividade.sala_id);
}

/** Tutor responsável pelo aluno naquela atividade (quem corrige). */
function tutoriaResponsavel(atividade, alunoId) {
  if (atividade.tutoria_id) return db.get('SELECT * FROM tutorias WHERE id = ?', atividade.tutoria_id);
  return acesso.tutoriaDoAluno(alunoId, atividade.sala_id);
}

/** Relação do usuário com a atividade: 'aluno' | 'tutor' | 'professor' | 'professor_leitura'. */
function relacao(usuario, atividade) {
  if (usuario.papel === 'professor') {
    if (atividade.professor_id === usuario.id) return 'professor';
    return null;
  }
  if (destinadaAo(usuario.id, atividade)) return 'aluno';
  if (atividade.tutoria_id && atividade.tutor_id === usuario.id) return 'tutor';
  if (!atividade.tutoria_id && db.get('SELECT 1 FROM tutorias WHERE sala_id = ? AND tutor_id = ?', atividade.sala_id, usuario.id)) return 'tutor';
  return null;
}

/** Lista para o aluno (RF30), com o status da entrega. */
function doAluno(alunoId) {
  return db.all(
    `SELECT a.*, s.nome AS sala_nome, c.nome AS conteudo_nome, u.nome AS autor_nome,
            e.id AS entrega_id, e.status AS entrega_status, e.nota, e.enviado_em
       FROM atividades a
       JOIN salas s ON s.id = a.sala_id
       JOIN usuarios u ON u.id = a.autor_id
       LEFT JOIN conteudos c ON c.id = a.conteudo_id
       LEFT JOIN entregas e ON e.atividade_id = a.id AND e.aluno_id = ?
      WHERE (a.tutoria_id IS NULL AND a.sala_id IN (SELECT sala_id FROM sala_alunos WHERE aluno_id = ?))
         OR a.tutoria_id IN (SELECT tutoria_id FROM tutoria_alunos WHERE aluno_id = ?)
      ORDER BY a.prazo DESC`,
    alunoId, alunoId, alunoId,
  );
}

/** Atividades visíveis numa tutoria (as da sala + as próprias) com contagem de entregas dos tutorados. */
function daTutoria(tutoria) {
  return db.all(
    `SELECT a.*, c.nome AS conteudo_nome, u.nome AS autor_nome,
       (SELECT COUNT(*) FROM entregas e WHERE e.atividade_id = a.id
           AND e.aluno_id IN (SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?)) AS entregues,
       (SELECT COUNT(*) FROM entregas e WHERE e.atividade_id = a.id AND e.status = 'enviada'
           AND e.aluno_id IN (SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?)) AS a_corrigir
       FROM atividades a JOIN usuarios u ON u.id = a.autor_id LEFT JOIN conteudos c ON c.id = a.conteudo_id
      WHERE a.sala_id = ? AND (a.tutoria_id IS NULL OR a.tutoria_id = ?)
      ORDER BY a.prazo DESC`,
    tutoria.id, tutoria.id, tutoria.sala_id, tutoria.id,
  );
}

function daSala(salaId) {
  return db.all(
    `SELECT a.*, c.nome AS conteudo_nome, u.nome AS autor_nome, tu.nome AS tutor_nome,
       (SELECT COUNT(*) FROM entregas e WHERE e.atividade_id = a.id) AS entregues,
       (SELECT COUNT(*) FROM entregas e WHERE e.atividade_id = a.id AND e.status = 'enviada') AS a_corrigir,
       CASE WHEN a.tutoria_id IS NULL THEN (SELECT COUNT(*) FROM sala_alunos WHERE sala_id = a.sala_id)
            ELSE (SELECT COUNT(*) FROM tutoria_alunos WHERE tutoria_id = a.tutoria_id) END AS total_destino
       FROM atividades a JOIN usuarios u ON u.id = a.autor_id
       LEFT JOIN conteudos c ON c.id = a.conteudo_id
       LEFT JOIN tutorias t ON t.id = a.tutoria_id LEFT JOIN usuarios tu ON tu.id = t.tutor_id
      WHERE a.sala_id = ? ORDER BY a.prazo DESC`,
    salaId,
  );
}

/** Entregas de uma atividade visíveis ao usuário (tutor vê só seus tutorados — RU16 / RNF8). */
function entregasDa(atividade, usuario, rel) {
  let alunos = destinatarios(atividade);
  if (rel === 'tutor') {
    const t = atividade.tutoria_id
      ? { id: atividade.tutoria_id }
      : db.get('SELECT id FROM tutorias WHERE sala_id = ? AND tutor_id = ?', atividade.sala_id, usuario.id);
    const meus = new Set(acesso.alunosDaTutoria(t.id).map((a) => a.id));
    alunos = alunos.filter((id) => meus.has(id));
  }
  if (!alunos.length) return [];
  return db.all(
    `SELECT u.id AS aluno_id, u.nome AS aluno_nome, e.id, e.status, e.nota, e.enviado_em, e.corrigido_em,
            (SELECT COUNT(*) FROM contestacoes c WHERE c.entrega_id = e.id AND c.status = 'aberta') AS contestacao_aberta
       FROM usuarios u LEFT JOIN entregas e ON e.aluno_id = u.id AND e.atividade_id = ?
      WHERE u.id IN (${alunos.map(() => '?').join(',')}) ORDER BY u.nome`,
    atividade.id, ...alunos,
  );
}

// ------------------------------------------------------- Entregas (RF31)
function entrega(id) {
  const e = db.get(
    `SELECT e.*, u.nome AS aluno_nome, c.nome AS corretor_nome FROM entregas e
       JOIN usuarios u ON u.id = e.aluno_id LEFT JOIN usuarios c ON c.id = e.corrigido_por WHERE e.id = ?`,
    Number(id),
  );
  if (!e) throw new NaoEncontrado('Entrega não encontrada.');
  e.respostas = Object.fromEntries(db.all('SELECT * FROM respostas WHERE entrega_id = ?', e.id).map((r) => [r.questao_id, r]));
  return e;
}

const entregaDoAluno = (atividadeId, alunoId) => {
  const e = db.get('SELECT id FROM entregas WHERE atividade_id = ? AND aluno_id = ?', atividadeId, alunoId);
  return e ? entrega(e.id) : null;
};

function enviar(aluno, atividade, dados, temArquivosNovos) {
  if (!destinadaAo(aluno.id, atividade)) throw new ErroAcesso('Esta atividade não é destinada a você.');
  const tutoria = tutoriaResponsavel(atividade, aluno.id);
  if (tutoria && tutoria.status === 'finalizada') {
    throw new ErroRegra('Sua tutoria foi finalizada: não é possível enviar novas respostas.', 'RN14');
  }
  if (atividade.encerrada) throw new ErroRegra('O prazo desta atividade já terminou.');
  const anterior = entregaDoAluno(atividade.id, aluno.id);
  if (anterior && anterior.status === 'corrigida') throw new ErroRegra('Esta atividade já foi corrigida e não pode ser reenviada.');

  const def = MODELOS[atividade.modelo];
  const respostas = [];
  for (const q of atividade.questoes) {
    const alt = dados[`q${q.id}_alt`];
    const texto = String(dados[`q${q.id}_texto`] || '').trim();
    if (def.alternativas) {
      const idx = alt === undefined || alt === '' ? null : Number(alt);
      if (idx === null || !(idx >= 0 && idx < q.alternativas.length)) throw new ErroRegra(`Responda a questão ${q.ordem}.`);
      if (q.exige_justificativa && texto.length < 5) throw new ErroRegra(`Justifique a resposta da questão ${q.ordem}.`);
      respostas.push({ q, alternativa: idx, texto: texto || null });
    } else {
      if (!texto) throw new ErroRegra(`Responda a questão ${q.ordem}.`);
      respostas.push({ q, alternativa: null, texto });
    }
  }
  const textoLivre = String(dados.texto || '').trim() || null;
  if (def.semQuestoes && !temArquivosNovos && !(anterior && db.get("SELECT 1 FROM arquivos WHERE contexto = 'entrega' AND ref_id = ?", anterior.id))) {
    throw new ErroRegra('Anexe o arquivo da sua resposta.');
  }

  // Nota sugerida a partir do gabarito (o corretor confirma ou ajusta)
  let sugerida = null;
  const comGabarito = respostas.filter((r) => r.q.correta !== null && r.q.correta !== undefined);
  if (def.alternativas && comGabarito.length === respostas.length && respostas.length) {
    const acertos = comGabarito.filter((r) => r.alternativa === r.q.correta).length;
    sugerida = Math.round((acertos / respostas.length) * atividade.valor * 10) / 10;
  }

  const agora = db.agora();
  const entregaId = db.transacao(() => {
    let id;
    if (anterior) {
      id = anterior.id;
      db.run('UPDATE entregas SET texto = ?, enviado_em = ?, nota_sugerida = ? WHERE id = ?', textoLivre, agora, sugerida, id);
      db.run('DELETE FROM respostas WHERE entrega_id = ?', id);
    } else {
      id = db.run('INSERT INTO entregas (atividade_id, aluno_id, texto, enviado_em, nota_sugerida) VALUES (?, ?, ?, ?, ?)',
        atividade.id, aluno.id, textoLivre, agora, sugerida).id;
    }
    for (const r of respostas) {
      db.run('INSERT INTO respostas (entrega_id, questao_id, alternativa, texto) VALUES (?, ?, ?, ?)', id, r.q.id, r.alternativa, r.texto);
    }
    return id;
  });

  // RF31 — disponibiliza a atividade ao tutor responsável
  const avisar = tutoria ? tutoria.tutor_id : atividade.professor_id;
  notificar(avisar, {
    tipo: 'entrega', titulo: anterior ? 'Entrega atualizada' : 'Nova entrega para corrigir',
    texto: `${aluno.nome} — ${atividade.titulo}`, link: `/entregas/${entregaId}`,
  });
  atualizar(atividade.professor_id, 'entrega');
  return entregaId;
}

/** Quem pode corrigir/comentar: o tutor responsável pelo aluno ou o professor da sala. */
function papelCorretor(usuario, atividade, alunoId) {
  if (usuario.papel === 'professor') return atividade.professor_id === usuario.id ? 'professor' : null;
  const t = tutoriaResponsavel(atividade, alunoId);
  return t && t.tutor_id === usuario.id ? 'tutor' : null;
}

function exigirCorretor(usuario, atividade, e) {
  const papel = papelCorretor(usuario, atividade, e.aluno_id);
  if (!papel) throw new ErroAcesso('Apenas o tutor responsável ou o professor da sala podem avaliar esta entrega.');
  const t = tutoriaResponsavel(atividade, e.aluno_id);
  if (t) acesso.exigirAtiva({ status: t.status });
  return papel;
}

function lerNota(valor, max) {
  const n = Number(String(valor ?? '').replace(',', '.'));
  if (String(valor ?? '').trim() === '' || Number.isNaN(n) || n < 0 || n > max) {
    throw new ErroRegra(`Informe uma nota entre 0 e ${fmtNota(max)}.`);
  }
  return Math.round(n * 10) / 10;
}

function corrigir(usuario, atividade, e, { nota, feedback }) {
  const papel = exigirCorretor(usuario, atividade, e);
  const n = lerNota(nota, atividade.valor);
  if (db.get("SELECT 1 FROM contestacoes WHERE entrega_id = ? AND status = 'aberta'", e.id)) {
    throw new ErroRegra('Há uma contestação em aberto: responda-a para alterar a nota.');
  }
  db.run("UPDATE entregas SET status = 'corrigida', nota = ?, feedback = ?, corrigido_por = ?, corrigido_em = ? WHERE id = ?",
    n, String(feedback || '').trim() || null, usuario.id, db.agora(), e.id);

  notificar(e.aluno_id, {
    tipo: 'nota', titulo: `Nota lançada: ${atividade.titulo}`,
    texto: `Você recebeu ${fmtNota(n)} de ${fmtNota(atividade.valor)}.`, link: `/entregas/${e.id}`,
  });
  // RF15 — o professor é notificado quando novas notas são lançadas
  if (papel === 'tutor') {
    notificar(atividade.professor_id, {
      tipo: 'nota', titulo: 'Nova nota lançada',
      texto: `${usuario.nome} corrigiu "${atividade.titulo}" de ${e.aluno_nome}: ${fmtNota(n)}.`, link: `/entregas/${e.id}`,
    });
  }
}

/** RF12 / RF21 — comentário geral ou em uma questão específica. */
function comentar(usuario, atividade, e, { texto, questao_id }) {
  exigirCorretor(usuario, atividade, e);
  texto = String(texto || '').trim();
  if (!texto) throw new ErroRegra('Escreva o comentário.');
  const qid = Number(questao_id) || null;
  if (qid && !atividade.questoes.some((q) => q.id === qid)) throw new ErroRegra('Questão inválida.');
  db.run('INSERT INTO comentarios (entrega_id, questao_id, autor_id, texto) VALUES (?, ?, ?, ?)', e.id, qid, usuario.id, texto);
  notificar(e.aluno_id, {
    tipo: 'comentario', titulo: 'Novo comentário na sua atividade',
    texto: `${usuario.nome} comentou em "${atividade.titulo}".`, link: `/entregas/${e.id}`,
  });
}

const comentarios = (entregaId) =>
  db.all(
    `SELECT c.*, u.nome AS autor_nome, u.papel AS autor_papel FROM comentarios c JOIN usuarios u ON u.id = c.autor_id
      WHERE c.entrega_id = ? ORDER BY c.id`,
    entregaId,
  );

// -------------------------------------------------- Contestações (RF29)
const contestacoes = (entregaId) =>
  db.all(
    `SELECT c.*, u.nome AS respondido_por_nome FROM contestacoes c LEFT JOIN usuarios u ON u.id = c.respondido_por
      WHERE c.entrega_id = ? ORDER BY c.id`,
    entregaId,
  );

function contestar(aluno, atividade, e, justificativa) {
  if (e.aluno_id !== aluno.id) throw new ErroAcesso();
  const t = tutoriaResponsavel(atividade, aluno.id);
  if (t && t.status === 'finalizada') throw new ErroRegra('Sua tutoria foi finalizada: não é possível contestar notas.', 'RN14');
  if (e.status !== 'corrigida') throw new ErroRegra('Só é possível contestar depois que a atividade for corrigida.');
  if (db.get("SELECT 1 FROM contestacoes WHERE entrega_id = ? AND status = 'aberta'", e.id)) {
    throw new ErroRegra('Já existe uma contestação em aberto para esta atividade.');
  }
  justificativa = String(justificativa || '').trim();
  if (justificativa.length < 10) throw new ErroRegra('Explique, com pelo menos 10 caracteres, por que a nota deve ser revista.');
  db.run('INSERT INTO contestacoes (entrega_id, aluno_id, justificativa, nota_anterior) VALUES (?, ?, ?, ?)',
    e.id, aluno.id, justificativa, e.nota);
  // RU21 — o responsável pela avaliação visualiza a contestação
  notificar([e.corrigido_por, atividade.professor_id], {
    tipo: 'contestacao', titulo: 'Nota contestada', texto: `${aluno.nome} — ${atividade.titulo}`, link: `/entregas/${e.id}`,
  });
}

function responderContestacao(usuario, atividade, e, { decisao, resposta, nota_nova }) {
  exigirCorretor(usuario, atividade, e);
  const c = db.get("SELECT * FROM contestacoes WHERE entrega_id = ? AND status = 'aberta'", e.id);
  if (!c) throw new ErroRegra('Não há contestação em aberto.');
  resposta = String(resposta || '').trim();
  if (!resposta) throw new ErroRegra('Escreva uma resposta para o aluno.');
  const deferida = decisao === 'deferida';
  const nova = deferida ? lerNota(nota_nova, atividade.valor) : null;
  db.transacao(() => {
    db.run('UPDATE contestacoes SET status = ?, resposta = ?, nota_nova = ?, respondido_por = ?, respondido_em = ? WHERE id = ?',
      deferida ? 'deferida' : 'indeferida', resposta, nova, usuario.id, db.agora(), c.id);
    if (deferida) db.run('UPDATE entregas SET nota = ?, corrigido_por = ?, corrigido_em = ? WHERE id = ?', nova, usuario.id, db.agora(), e.id);
  });
  notificar(e.aluno_id, {
    tipo: 'contestacao', titulo: deferida ? 'Contestação aceita' : 'Contestação respondida',
    texto: deferida ? `Sua nota em "${atividade.titulo}" passou para ${fmtNota(nova)}.` : atividade.titulo,
    link: `/entregas/${e.id}`,
  });
}

module.exports = {
  carregar, criar, excluir, destinatarios, destinadaAo, tutoriaResponsavel, relacao,
  doAluno, daTutoria, daSala, entregasDa, entrega, entregaDoAluno, enviar, papelCorretor,
  corrigir, comentar, comentarios, contestacoes, contestar, responderContestacao,
};
