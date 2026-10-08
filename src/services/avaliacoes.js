// Rubricas, avaliação do tutor, observações, conteúdos e dashboards
// (RF13, RF19, RF22, RF23, RF26, RF27, RN11, RN12, RU9, RU11).
const db = require('../db');
const { ErroRegra, ErroAcesso } = require('../lib/erros');
const { CRITERIOS_AVALIACAO_TUTOR, TIPOS_OBSERVACAO, NOTA_DOMINIO } = require('../lib/dominio');
const acesso = require('./acesso');
const { notificar } = require('./notificacoes');

const media = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
const etapaValida = (e) => {
  const n = Number(e);
  if (![1, 2, 3].includes(n)) throw new ErroRegra('Selecione o trimestre.');
  return n;
};

// ------------------------------------------- Rubrica do tutor (RF22 / RN11)
function salvarRubrica(usuario, tutoria, { aluno_id, etapa, comentario, ...campos }) {
  if (tutoria.tutor_id !== usuario.id) {
    throw new ErroRegra('A rubrica só pode ser preenchida pelo tutor responsável pelo aluno.', 'RN11');
  }
  acesso.exigirAtiva(tutoria);
  const alunoId = Number(aluno_id);
  if (!acesso.ehTutorado(alunoId, tutoria.id)) throw new ErroRegra('Este aluno não é seu tutorado.', 'RN11');
  const e = etapaValida(etapa);
  const criterios = db.all('SELECT * FROM sala_criterios WHERE sala_id = ? ORDER BY ordem', tutoria.sala_id);
  if (!criterios.length) throw new ErroRegra('O professor ainda não definiu os critérios da rubrica.');
  const itens = criterios.map((c) => {
    const p = Number(String(campos[`c${c.id}`] ?? '').replace(',', '.'));
    if (Number.isNaN(p) || p < 0 || p > c.pontuacao_max) throw new ErroRegra(`Pontuação inválida em "${c.nome}" (0 a ${c.pontuacao_max}).`);
    return { c, p };
  });
  const total = itens.reduce((s, i) => s + i.p, 0);
  const max = itens.reduce((s, i) => s + i.c.pontuacao_max, 0);
  const nota = Math.round((total / max) * 100) / 10;
  db.transacao(() => {
    const atual = db.get('SELECT id FROM rubricas WHERE tutoria_id = ? AND aluno_id = ? AND etapa = ?', tutoria.id, alunoId, e);
    let id;
    if (atual) {
      id = atual.id;
      db.run(`UPDATE rubricas SET nota = ?, comentario = ?, tutor_id = ?, atualizado_em = ?, validacao_status = 'pendente',
              validacao_comentario = NULL, validado_por = NULL, validado_em = NULL WHERE id = ?`,
      nota, String(comentario || '').trim() || null, usuario.id, db.agora(), id);
      db.run('DELETE FROM rubrica_itens WHERE rubrica_id = ?', id);
    } else {
      id = db.run('INSERT INTO rubricas (tutoria_id, aluno_id, tutor_id, etapa, nota, comentario) VALUES (?, ?, ?, ?, ?, ?)',
        tutoria.id, alunoId, usuario.id, e, nota, String(comentario || '').trim() || null).id;
    }
    for (const i of itens) {
      db.run('INSERT INTO rubrica_itens (rubrica_id, criterio_nome, pontuacao_max, pontos) VALUES (?, ?, ?, ?)', id, i.c.nome, i.c.pontuacao_max, i.p);
    }
  });
  notificar(alunoId, { tipo: 'feedback', titulo: `Feedback do ${e}º trimestre`, texto: `${usuario.nome} preencheu sua rubrica.`, link: '/aluno/avaliacoes' });
  notificar(tutoria.professor_id, { tipo: 'feedback', titulo: 'Rubrica aguardando validação', texto: `${usuario.nome} — ${e}º trimestre`, link: `/professor/tutorias/${tutoria.id}` });
}

function rubricas(filtro) {
  const where = filtro.alunoId ? 'r.aluno_id = ?' : 'r.tutoria_id = ?';
  const lista = db.all(
    `SELECT r.*, a.nome AS aluno_nome, t.nome AS tutor_nome, v.nome AS validador_nome, s.nome AS sala_nome
       FROM rubricas r JOIN usuarios a ON a.id = r.aluno_id JOIN usuarios t ON t.id = r.tutor_id
       LEFT JOIN usuarios v ON v.id = r.validado_por JOIN tutorias tu ON tu.id = r.tutoria_id JOIN salas s ON s.id = tu.sala_id
      WHERE ${where} ORDER BY r.etapa, a.nome`,
    filtro.alunoId || filtro.tutoriaId,
  );
  for (const r of lista) r.itens = db.all('SELECT * FROM rubrica_itens WHERE rubrica_id = ?', r.id);
  return lista;
}

/** RU11 — o professor valida as considerações do tutor (rubricas e registros). */
function validar(usuario, tutoria, tabela, id, { status, comentario }) {
  acesso.exigirRelacao(usuario, tutoria, 'professor');
  if (!['rubricas', 'registros'].includes(tabela)) throw new ErroRegra('Registro inválido.');
  if (!['validado', 'ajuste'].includes(status)) throw new ErroRegra('Escolha validar ou pedir ajuste.');
  const r = db.run(`UPDATE ${tabela} SET validacao_status = ?, validacao_comentario = ?, validado_por = ?, validado_em = ? WHERE id = ? AND tutoria_id = ?`,
    status, String(comentario || '').trim() || null, usuario.id, db.agora(), Number(id), tutoria.id);
  if (!r.changes) throw new ErroRegra('Registro não encontrado.');
  notificar(tutoria.tutor_id, {
    tipo: 'validacao', titulo: status === 'validado' ? 'Professor validou seu registro' : 'Professor pediu ajuste',
    texto: comentario ? String(comentario).slice(0, 140) : tutoria.sala_nome, link: `/tutor/tutorias/${tutoria.id}`,
  });
}

// --------------------------------- Avaliação do tutor (RF19 / RN12 / escopo)
function avaliarTutor(usuario, tutoria, { etapa, nota, comentario, ...campos }) {
  acesso.exigirAtiva(tutoria);
  const e = etapaValida(etapa);
  let papel, criterios = {}, n;
  if (usuario.papel === 'professor') {
    acesso.exigirRelacao(usuario, tutoria, 'professor');
    papel = 'professor';
    n = Number(String(nota ?? '').replace(',', '.'));
    if (String(nota ?? '').trim() === '' || Number.isNaN(n) || n < 0 || n > 10) throw new ErroRegra('Informe uma nota de 0 a 10.');
  } else {
    if (!acesso.ehTutorado(usuario.id, tutoria.id)) throw new ErroAcesso('Você só pode avaliar o seu tutor.');
    papel = 'aluno';
    for (const c of CRITERIOS_AVALIACAO_TUTOR) {
      const v = Number(campos[c.chave]);
      if (![1, 2, 3, 4, 5].includes(v)) throw new ErroRegra(`Avalie o critério "${c.nome}" de 1 a 5.`);
      criterios[c.chave] = v;
    }
    n = media(Object.values(criterios)) * 2;
  }
  n = Math.round(n * 10) / 10;
  db.run(
    `INSERT INTO avaliacoes_tutor (tutoria_id, tutor_id, avaliador_id, avaliador_papel, etapa, criterios, nota, comentario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tutoria_id, tutor_id, avaliador_id, etapa) DO UPDATE SET criterios = excluded.criterios,
       nota = excluded.nota, comentario = excluded.comentario, criado_em = excluded.criado_em`,
    tutoria.id, tutoria.tutor_id, usuario.id, papel, e, JSON.stringify(criterios), n, String(comentario || '').trim() || null,
  );
  notificar(tutoria.tutor_id, {
    tipo: 'avaliacao', titulo: papel === 'professor' ? 'O professor avaliou sua atuação' : 'Você recebeu uma avaliação de tutorado',
    texto: `${e}º trimestre`, link: '/tutor/desempenho',
  });
}

const avaliacoesDoTutor = (tutoriaId, tutorId) =>
  db.all(
    `SELECT a.*, u.nome AS avaliador_nome FROM avaliacoes_tutor a JOIN usuarios u ON u.id = a.avaliador_id
      WHERE a.tutoria_id = ? AND a.tutor_id = ? ORDER BY a.etapa, a.avaliador_papel`,
    tutoriaId, tutorId,
  );

// -------------------------------------------------------- Observações (RU9)
function observar(usuario, tutoria, { aluno_id, tipo, texto }) {
  acesso.exigirRelacao(usuario, tutoria, 'professor');
  if (!TIPOS_OBSERVACAO[tipo]) throw new ErroRegra('Selecione o tipo da observação.');
  if (!acesso.ehTutorado(Number(aluno_id), tutoria.id)) throw new ErroRegra('Selecione um tutorado desta tutoria.');
  texto = String(texto || '').trim();
  if (texto.length < 3) throw new ErroRegra('Escreva a observação.');
  db.run('INSERT INTO observacoes (tutoria_id, aluno_id, autor_id, tipo, texto) VALUES (?, ?, ?, ?, ?)', tutoria.id, Number(aluno_id), usuario.id, tipo, texto);
}

const observacoes = (tutoriaId, alunoId) =>
  db.all(
    `SELECT o.*, u.nome AS autor_nome, a.nome AS aluno_nome FROM observacoes o JOIN usuarios u ON u.id = o.autor_id
       JOIN usuarios a ON a.id = o.aluno_id WHERE o.tutoria_id = ? AND (? IS NULL OR o.aluno_id = ?) ORDER BY o.id DESC`,
    tutoriaId, alunoId || null, alunoId || null,
  );

// ------------------------------------------------ Conteúdos dominados (RF27)
function registrarConteudo(usuario, salaId, alunoId, conteudoId, situacao) {
  const t = acesso.tutoriaDoAluno(alunoId, salaId);
  const s = acesso.sala(salaId);
  const ok = (usuario.papel === 'professor' && s.professor_id === usuario.id) || (t && t.tutor_id === usuario.id);
  if (!ok) throw new ErroAcesso();
  if (t) acesso.exigirAtiva(t);
  if (situacao === 'auto') {
    db.run('DELETE FROM conteudos_aluno WHERE aluno_id = ? AND sala_id = ? AND conteudo_id = ?', alunoId, salaId, conteudoId);
    return;
  }
  if (!['dominado', 'treinar'].includes(situacao)) throw new ErroRegra('Situação inválida.');
  db.run(
    `INSERT INTO conteudos_aluno (aluno_id, sala_id, conteudo_id, situacao, registrado_por) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (aluno_id, sala_id, conteudo_id) DO UPDATE SET situacao = excluded.situacao,
       registrado_por = excluded.registrado_por, atualizado_em = excluded.atualizado_em`,
    alunoId, salaId, Number(conteudoId), situacao, usuario.id,
  );
}

/** Situação por conteúdo: registro manual do tutor/professor ou, na falta dele, média das atividades. */
function conteudosDoAluno(alunoId, salaId) {
  const porNota = db.all(
    `SELECT c.id, c.nome, c.eixo, AVG(e.nota * 10.0 / a.valor) AS media, COUNT(*) AS qtd
       FROM entregas e JOIN atividades a ON a.id = e.atividade_id JOIN conteudos c ON c.id = a.conteudo_id
      WHERE e.aluno_id = ? AND a.sala_id = ? AND e.status = 'corrigida' GROUP BY c.id`,
    alunoId, salaId,
  );
  const manuais = db.all(
    `SELECT ca.*, c.nome, c.eixo, u.nome AS registrado_por_nome FROM conteudos_aluno ca
       JOIN conteudos c ON c.id = ca.conteudo_id JOIN usuarios u ON u.id = ca.registrado_por
      WHERE ca.aluno_id = ? AND ca.sala_id = ?`,
    alunoId, salaId,
  );
  const mapa = new Map();
  for (const c of porNota) {
    mapa.set(c.id, { id: c.id, nome: c.nome, eixo: c.eixo, media: Math.round(c.media * 10) / 10, qtd: c.qtd,
      situacao: c.media >= NOTA_DOMINIO ? 'dominado' : 'treinar', origem: 'atividades' });
  }
  for (const m of manuais) {
    const base = mapa.get(m.conteudo_id) || { id: m.conteudo_id, nome: m.nome, eixo: m.eixo, media: null, qtd: 0 };
    mapa.set(m.conteudo_id, { ...base, situacao: m.situacao, origem: 'registro', registrado_por_nome: m.registrado_por_nome });
  }
  return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

// ------------------------------------------------------------- Dashboards
/** RF26 — notas das atividades avaliadas e evolução por trimestre. */
function desempenhoAluno(alunoId, salaId) {
  const notas = db.all(
    `SELECT a.id AS atividade_id, a.titulo, a.etapa, a.valor, a.tipo, c.nome AS conteudo_nome, e.id AS entrega_id,
            e.nota, e.corrigido_em, ROUND(e.nota * 10.0 / a.valor, 1) AS nota10
       FROM entregas e JOIN atividades a ON a.id = e.atividade_id LEFT JOIN conteudos c ON c.id = a.conteudo_id
      WHERE e.aluno_id = ? AND a.sala_id = ? AND e.status = 'corrigida' ORDER BY e.corrigido_em DESC`,
    alunoId, salaId,
  );
  const rub = db.all(
    `SELECT r.etapa, r.nota FROM rubricas r JOIN tutorias t ON t.id = r.tutoria_id WHERE r.aluno_id = ? AND t.sala_id = ?`,
    alunoId, salaId,
  );
  const etapas = [1, 2, 3].map((et) => ({
    etapa: et,
    media: media(notas.filter((n) => n.etapa === et).map((n) => n.nota10)),
    rubrica: (rub.find((r) => r.etapa === et) || {}).nota ?? null,
    qtd: notas.filter((n) => n.etapa === et).length,
  }));
  return { notas, etapas, mediaGeral: media(notas.map((n) => n.nota10)), conteudos: conteudosDoAluno(alunoId, salaId) };
}

/**
 * RN12 — desempenho do tutor = avaliação dada pelos alunos (rubrica) + desempenho dos tutorados.
 * Retorna indicadores por trimestre.
 */
function desempenhoTutoria(tutoria) {
  const alunos = acesso.alunosDaTutoria(tutoria.id).map((a) => a.id);
  const ph = alunos.map(() => '?').join(',') || 'NULL';
  const notas = db.all(
    `SELECT a.etapa, e.nota * 10.0 / a.valor AS n FROM entregas e JOIN atividades a ON a.id = e.atividade_id
      WHERE e.status = 'corrigida' AND a.sala_id = ? AND e.aluno_id IN (${ph})
        AND (a.tutoria_id IS NULL OR a.tutoria_id = ?)`,
    tutoria.sala_id, ...alunos, tutoria.id,
  );
  const avs = db.all('SELECT etapa, avaliador_papel, nota FROM avaliacoes_tutor WHERE tutoria_id = ? AND tutor_id = ?', tutoria.id, tutoria.tutor_id);
  const etapas = [1, 2, 3].map((et) => {
    const tutorados = media(notas.filter((x) => x.etapa === et).map((x) => x.n));
    const alunosAv = media(avs.filter((a) => a.etapa === et && a.avaliador_papel === 'aluno').map((a) => a.nota));
    const professor = media(avs.filter((a) => a.etapa === et && a.avaliador_papel === 'professor').map((a) => a.nota));
    return { etapa: et, tutorados, alunos: alunosAv, professor, indice: media([tutorados, alunosAv]) };
  });
  const contagem = db.get(
    `SELECT (SELECT COUNT(*) FROM registros WHERE tutoria_id = ?) AS registros,
            (SELECT COUNT(*) FROM atividades WHERE tutoria_id = ?) AS atividades,
            (SELECT COUNT(*) FROM materiais WHERE tutoria_id = ?) AS materiais,
            (SELECT COUNT(*) FROM duvidas WHERE tutoria_id = ? AND resposta IS NOT NULL) AS duvidas_respondidas,
            (SELECT COUNT(*) FROM entregas e JOIN atividades a ON a.id = e.atividade_id
              WHERE e.corrigido_por = ? AND a.sala_id = ?) AS correcoes`,
    tutoria.id, tutoria.id, tutoria.id, tutoria.id, tutoria.tutor_id, tutoria.sala_id,
  );
  return { etapas, contagem, indiceGeral: media(etapas.map((e) => e.indice)) };
}

/** RF23 — o tutor compara seu desempenho por trimestre e por ano. */
function desempenhoDoTutor(tutorId) {
  return acesso.tutoriasComoTutor(tutorId).map((t) => ({ ...t, desempenho: desempenhoTutoria({ ...t }) }));
}

/** Tabela de alunos da sala com médias por trimestre (dashboard do professor e exportação). */
function notasDaSala(salaId) {
  const alunos = db.all(
    `SELECT u.id, u.nome, u.email, tu.nome AS tutor_nome FROM sala_alunos sa JOIN usuarios u ON u.id = sa.aluno_id
       LEFT JOIN tutoria_alunos ta ON ta.aluno_id = u.id AND ta.tutoria_id IN (SELECT id FROM tutorias WHERE sala_id = sa.sala_id)
       LEFT JOIN tutorias t ON t.id = ta.tutoria_id LEFT JOIN usuarios tu ON tu.id = t.tutor_id
      WHERE sa.sala_id = ? ORDER BY u.nome`,
    salaId,
  );
  const atividades = db.all('SELECT id, titulo, etapa, valor, tutoria_id FROM atividades WHERE sala_id = ? ORDER BY etapa, prazo', salaId);
  const entregas = db.all(
    `SELECT e.aluno_id, e.atividade_id, e.nota, e.status FROM entregas e JOIN atividades a ON a.id = e.atividade_id WHERE a.sala_id = ?`,
    salaId,
  );
  const idx = new Map(entregas.map((e) => [`${e.aluno_id}:${e.atividade_id}`, e]));
  for (const al of alunos) {
    al.notas = {};
    for (const at of atividades) al.notas[at.id] = idx.get(`${al.id}:${at.id}`) || null;
    al.medias = [1, 2, 3].map((et) =>
      media(atividades.filter((a) => a.etapa === et).map((a) => al.notas[a.id]).filter((e) => e && e.status === 'corrigida')
        .map((e) => (e.nota * 10) / atividades.find((a) => a.id === e.atividade_id).valor)));
    al.mediaGeral = media(al.medias);
  }
  return { alunos, atividades };
}

module.exports = {
  media, salvarRubrica, rubricas, validar, avaliarTutor, avaliacoesDoTutor, observar, observacoes,
  registrarConteudo, conteudosDoAluno, desempenhoAluno, desempenhoTutoria, desempenhoDoTutor, notasDaSala,
};
