// Área do professor (RF4–RF19, RU2–RU12, RU26, RU27).
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { exigirPapel } = require('../lib/auth');
const { anoAtual } = require('../lib/formato');
const { SERIES, ETAPAS } = require('../lib/dominio');
const acesso = require('../services/acesso');
const salas = require('../services/salas');
const tutorias = require('../services/tutorias');
const atividades = require('../services/atividades');
const avaliacoes = require('../services/avaliacoes');
const apoio = require('../services/apoio');
const upload = require('../lib/upload');

const r = express.Router();
r.use(exigirPapel('professor'));

const conteudosCatalogo = () => db.all('SELECT * FROM conteudos ORDER BY eixo, nome');

/** Carrega a sala da URL e garante que pertence ao professor. */
function minhaSala(req) {
  const s = acesso.sala(req.params.id);
  acesso.exigirProfessorDaSala(req.usuario, s);
  return s;
}

function sinalizarSala(sala) {
  require('../services/notificacoes').atualizar(salas.participantes(sala.id), 'sala');
}

// ------------------------------------------------- Painel (RF4, RF5, RF6)
r.get('/', (req, res) => {
  const anos = salas.anosLetivos(req.usuario.id);
  const ano = anos.includes(Number(req.query.ano)) ? Number(req.query.ano) : anoAtual();
  const serie = [1, 2, 3].includes(Number(req.query.serie)) ? Number(req.query.serie) : null;
  const pend = db.get(
    `SELECT (SELECT COUNT(*) FROM pedidos_tutoria p JOIN usuarios u ON u.id = p.aluno_id
              WHERE p.professor_id = ? AND p.status = 'pendente' AND u.email_confirmado = 1) AS pedidos,
            (SELECT COUNT(*) FROM contestacoes c JOIN entregas e ON e.id = c.entrega_id JOIN atividades a ON a.id = e.atividade_id
              JOIN salas s ON s.id = a.sala_id WHERE s.professor_id = ? AND c.status = 'aberta') AS contestacoes,
            (SELECT COUNT(*) FROM registros r JOIN tutorias t ON t.id = r.tutoria_id JOIN salas s ON s.id = t.sala_id
              WHERE s.professor_id = ? AND r.validacao_status = 'pendente') AS registros,
            (SELECT COUNT(*) FROM rubricas r JOIN tutorias t ON t.id = r.tutoria_id JOIN salas s ON s.id = t.sala_id
              WHERE s.professor_id = ? AND r.validacao_status = 'pendente') AS rubricas`,
    req.usuario.id, req.usuario.id, req.usuario.id, req.usuario.id,
  );
  res.render('professor/painel', { titulo: 'Painel do professor', anos, ano, serie, lista: salas.listar(req.usuario.id, ano, serie), pend });
});

r.get('/salas/nova', (req, res) => {
  res.render('professor/sala-form', { titulo: 'Nova sala', sala: null, ano: Number(req.query.ano) || anoAtual(), serie: Number(req.query.serie) || 1 });
});
r.post('/salas', (req, res) => {
  const id = salas.criar(req.body, req.usuario.id);
  req.flash('sucesso', 'Sala criada! Agora inclua os alunos e designe os tutores.');
  res.redirect(`/professor/salas/${id}/alunos`);
});
r.get('/salas/:id/editar', (req, res) => {
  const sala = minhaSala(req);
  res.render('professor/sala-form', { titulo: 'Editar sala', sala, ano: sala.ano_letivo, serie: sala.serie });
});
r.post('/salas/:id/editar', (req, res) => {
  salas.editar(minhaSala(req), req.body);
  req.flash('sucesso', 'Sala atualizada.');
  res.redirect(`/professor/salas/${req.params.id}`);
});

// ------------------------------------------------------- Visão da sala (RU5)
r.get('/salas/:id', (req, res) => {
  const sala = minhaSala(req);
  const lista = tutorias.daSala(sala.id);
  for (const t of lista) t.desempenho = avaliacoes.desempenhoTutoria({ ...t, sala_id: sala.id });
  res.render('professor/sala', {
    titulo: sala.nome, sala, aba: 'geral', tutorias: lista, alunos: salas.alunos(sala.id),
    criterios: salas.criterios(sala.id), atividades: atividades.daSala(sala.id).slice(0, 5),
  });
});

// RF6 / RN19 — alunos da sala
r.get('/salas/:id/alunos', (req, res) => {
  const sala = minhaSala(req);
  res.render('professor/sala-alunos', {
    titulo: `${sala.nome} — Alunos`, sala, aba: 'alunos', alunos: salas.alunos(sala.id),
    disponiveis: salas.alunosDisponiveis(sala.id, req.query.busca), busca: req.query.busca || '',
  });
});
r.post('/salas/:id/alunos', (req, res) => {
  const n = salas.adicionarAlunos(minhaSala(req), req.body.alunos);
  req.flash('sucesso', `${n} aluno(s) incluído(s) na sala.`);
  res.redirect(`/professor/salas/${req.params.id}/alunos`);
});
r.post('/salas/:id/alunos/:alunoId/remover', (req, res) => {
  salas.removerAluno(minhaSala(req), Number(req.params.alunoId));
  req.flash('sucesso', 'Aluno removido da sala.');
  res.redirect(`/professor/salas/${req.params.id}/alunos`);
});

// RF7 / RF8 — tutores e vínculos
r.get('/salas/:id/tutorias', (req, res) => {
  const sala = minhaSala(req);
  const alunos = salas.alunos(sala.id);
  const todosAlunos = db.all("SELECT id, nome, email FROM usuarios WHERE papel = 'aluno' AND email_confirmado = 1 ORDER BY nome");
  res.render('professor/sala-tutorias', {
    titulo: `${sala.nome} — Tutores e vínculos`, sala, aba: 'tutorias', tutorias: tutorias.daSala(sala.id), alunos,
    semTutor: alunos.filter((a) => !a.tutoria_id && !a.eh_tutor), candidatos: todosAlunos.filter((a) => !alunos.find((x) => x.id === a.id && x.tutoria_id)),
  });
});
r.post('/salas/:id/tutores', (req, res) => {
  const id = tutorias.designarTutor(minhaSala(req), req.body.aluno_id);
  req.flash('sucesso', 'Tutor designado. Agora vincule os tutorados.');
  res.redirect(`/professor/salas/${req.params.id}/tutorias#t${id}`);
});
r.post('/salas/:id/vincular', (req, res) => {
  const sala = minhaSala(req);
  const t = acesso.tutoria(req.body.tutoria_id);
  if (t.sala_id !== sala.id) throw new Error('Tutoria de outra sala');
  const ids = [].concat(req.body.alunos || []);
  let transferidos = 0;
  for (const a of ids) transferidos += tutorias.vincularAluno(sala, t, a).transferido ? 1 : 0;
  req.flash('sucesso', `${ids.length} aluno(s) vinculado(s) a ${t.tutor_nome}` + (transferidos ? ` (${transferidos} transferido(s) de outro tutor).` : '.'));
  res.redirect(`/professor/salas/${sala.id}/tutorias#t${t.id}`);
});
r.post('/salas/:id/desvincular', (req, res) => {
  const sala = minhaSala(req);
  const t = acesso.tutoria(req.body.tutoria_id);
  if (t.sala_id !== sala.id) throw new Error('Tutoria de outra sala');
  tutorias.desvincularAluno(t, req.body.aluno_id);
  req.flash('sucesso', 'Aluno desvinculado do tutor.');
  res.redirect(`/professor/salas/${sala.id}/tutorias#t${t.id}`);
});

// RF11 — atividades da sala
r.get('/salas/:id/atividades', (req, res) => {
  const sala = minhaSala(req);
  res.render('professor/sala-atividades', { titulo: `${sala.nome} — Atividades`, sala, aba: 'atividades', lista: atividades.daSala(sala.id) });
});
r.get('/salas/:id/atividades/nova', (req, res) => {
  const sala = minhaSala(req);
  res.render('comum/atividade-form', {
    titulo: 'Nova atividade da sala', sala, tutoria: null, conteudos: conteudosCatalogo(), modelos: Object.keys(require('../lib/dominio').MODELOS),
    acao: `/professor/salas/${sala.id}/atividades`, voltar: `/professor/salas/${sala.id}/atividades`,
  });
});
r.post('/salas/:id/atividades', (req, res) => {
  const sala = minhaSala(req);
  const id = atividades.criar(req.usuario, { sala, tutoria: null }, req.body);
  req.flash('sucesso', 'Atividade publicada para todos os alunos da sala.');
  res.redirect(`/atividades/${id}`);
});

// RF10 — avisos
r.get('/salas/:id/avisos', (req, res) => {
  const sala = minhaSala(req);
  res.render('professor/sala-avisos', { titulo: `${sala.nome} — Avisos`, sala, aba: 'avisos', lista: salas.avisos(sala.id) });
});
r.post('/salas/:id/avisos', (req, res) => {
  salas.publicarAviso(minhaSala(req), req.usuario.id, req.body);
  req.flash('sucesso', 'Aviso publicado e alunos notificados.');
  res.redirect(`/professor/salas/${req.params.id}/avisos`);
});
r.post('/salas/:id/avisos/:avisoId/excluir', (req, res) => {
  salas.removerAviso(minhaSala(req), Number(req.params.avisoId));
  res.redirect(`/professor/salas/${req.params.id}/avisos`);
});

// RF16 — metas, objetivos e critérios
r.get('/salas/:id/metas', (req, res) => {
  const sala = minhaSala(req);
  res.render('professor/sala-metas', { titulo: `${sala.nome} — Metas e critérios`, sala, aba: 'metas', criterios: salas.criterios(sala.id) });
});
r.post('/salas/:id/metas', (req, res) => {
  const sala = minhaSala(req);
  salas.salvarMetas(sala, req.body);
  sinalizarSala(sala);
  req.flash('sucesso', 'Metas e objetivos salvos — já estão visíveis para os tutores.');
  res.redirect(`/professor/salas/${sala.id}/metas`);
});
r.post('/salas/:id/criterios', (req, res) => {
  salas.adicionarCriterio(minhaSala(req), req.body);
  req.flash('sucesso', 'Critério adicionado à rubrica.');
  res.redirect(`/professor/salas/${req.params.id}/metas`);
});
r.post('/salas/:id/criterios/:cid/excluir', (req, res) => {
  salas.removerCriterio(minhaSala(req), Number(req.params.cid));
  res.redirect(`/professor/salas/${req.params.id}/metas`);
});

// RF13 / RU12 — dashboard de desempenho
r.get('/salas/:id/desempenho', (req, res) => {
  const sala = minhaSala(req);
  const lista = tutorias.daSala(sala.id);
  for (const t of lista) t.desempenho = avaliacoes.desempenhoTutoria({ ...t, sala_id: sala.id });
  res.render('professor/sala-desempenho', { titulo: `${sala.nome} — Desempenho`, sala, aba: 'desempenho', tutorias: lista, notas: avaliacoes.notasDaSala(sala.id) });
});

// RF14 / RNF10 — exportação para Excel
r.get('/salas/:id/exportar.xlsx', async (req, res) => {
  const sala = minhaSala(req);
  const { alunos, atividades: ats } = avaliacoes.notasDaSala(sala.id);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Protutal';
  const ws = wb.addWorksheet('Notas', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = [
    { header: 'Aluno', key: 'nome', width: 32 }, { header: 'E-mail', key: 'email', width: 32 }, { header: 'Tutor', key: 'tutor', width: 26 },
    ...ats.map((a) => ({ header: `T${a.etapa} — ${a.titulo} (/${a.valor})`, key: `a${a.id}`, width: 18 })),
    ...[1, 2, 3].map((e) => ({ header: `Média ${ETAPAS[e]} (0-10)`, key: `m${e}`, width: 16 })),
    { header: 'Média geral (0-10)', key: 'mg', width: 16 },
  ];
  for (const al of alunos) {
    const linha = { nome: al.nome, email: al.email, tutor: al.tutor_nome || '—', mg: al.mediaGeral };
    for (const a of ats) {
      const e = al.notas[a.id];
      linha[`a${a.id}`] = e ? (e.status === 'corrigida' ? e.nota : 'Aguardando correção') : 'Não entregue';
    }
    al.medias.forEach((m, i) => { linha[`m${i + 1}`] = m; });
    ws.addRow(linha);
  }
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } };
  cab.alignment = { vertical: 'middle', wrapText: true };
  cab.height = 36;
  ws.eachRow((row, n) => { if (n > 1) row.eachCell((c) => { if (typeof c.value === 'number') c.numFmt = '0.0'; }); });
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };

  const nome = `notas-${sala.nome}-${sala.ano_letivo}`.normalize('NFD').replace(/[^\w-]+/g, '-').toLowerCase();
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${nome}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ------------------------------------------------------- Tutoria (RU26)
function minhaTutoria(req, ...rels) {
  const t = acesso.tutoria(req.params.id);
  const rel = acesso.exigirRelacao(req.usuario, t, ...(rels.length ? rels : ['professor', 'professor_leitura']));
  return { t, rel };
}

r.get('/tutorias/:id', (req, res) => {
  const { t, rel } = minhaTutoria(req);
  const tutorados = acesso.alunosDaTutoria(t.id);
  const dentroSala = new Set(tutorados.map((a) => a.id));
  res.render('professor/tutoria', {
    titulo: `Tutoria de ${t.tutor_nome}`, t, rel, leitura: rel !== 'professor' || t.status !== 'ativa', tutorados,
    conteudos: tutorias.conteudos(t.id), catalogo: conteudosCatalogo(), pendencias: tutorias.pendencias(t),
    historico: tutorias.historicoTutores(t.id), registros: apoio.registros(t.id), rubricas: avaliacoes.rubricas({ tutoriaId: t.id }),
    observacoes: avaliacoes.observacoes(t.id), avaliacoes: avaliacoes.avaliacoesDoTutor(t.id, t.tutor_id),
    desempenho: avaliacoes.desempenhoTutoria(t), atividades: atividades.daTutoria(t).filter((a) => a.tutoria_id === t.id),
    materiais: apoio.materiais(t.id), anoAtual: anoAtual(),
    candidatos: db.all(`SELECT id, nome FROM usuarios WHERE papel = 'aluno' AND email_confirmado = 1 AND id <> ?
        AND id NOT IN (SELECT tutor_id FROM tutorias WHERE sala_id = ?) ORDER BY nome`, t.tutor_id, t.sala_id)
      .filter((a) => !dentroSala.has(a.id) && !acesso.tutoriaDoAluno(a.id, t.sala_id)),
    arquivosRegistro: Object.fromEntries(apoio.registros(t.id).map((x) => [x.id, upload.listar('registro', x.id)])),
  });
});

const acaoTutoria = (fn, msg) => (req, res) => {
  const { t } = minhaTutoria(req, 'professor');
  fn(req, t);
  tutorias.sinalizar(t, 'tutoria');
  req.flash('sucesso', msg);
  res.redirect(`/professor/tutorias/${t.id}${req.body.ancora ? '#' + req.body.ancora : ''}`);
};

r.post('/tutorias/:id/ciclo', acaoTutoria((req, t) => tutorias.salvarCiclo(t, req.body), 'Dados da tutoria atualizados.'));
r.post('/tutorias/:id/permissoes', acaoTutoria((req, t) => tutorias.salvarPermissoes(t, req.body), 'Permissões do tutor atualizadas.'));
r.post('/tutorias/:id/finalizar', acaoTutoria((req, t) => tutorias.finalizar(t), 'Tutoria finalizada.'));
r.post('/tutorias/:id/reabrir', acaoTutoria((req, t) => tutorias.reabrir(t), 'Tutoria reaberta.'));
r.post('/tutorias/:id/revogar', acaoTutoria((req, t) => tutorias.revogarTutor(t, req.body.novo_tutor_id, req.body.motivo), 'Tutor revogado; o histórico passou ao novo tutor.'));
r.post('/tutorias/:id/avaliar', acaoTutoria((req, t) => avaliacoes.avaliarTutor(req.usuario, t, req.body), 'Avaliação do tutor registrada.'));
r.post('/tutorias/:id/observacoes', acaoTutoria((req, t) => avaliacoes.observar(req.usuario, t, req.body), 'Observação registrada.'));
r.post('/tutorias/:id/validar', acaoTutoria((req, t) => avaliacoes.validar(req.usuario, t, req.body.tabela, req.body.registro_id, req.body), 'Validação registrada.'));

// Finaliza todas as tutorias da sala (fim do ano letivo — RN14 / RN15)
r.post('/salas/:id/finalizar', (req, res) => {
  const sala = minhaSala(req);
  const erros = [];
  let ok = 0;
  for (const t of tutorias.daSala(sala.id).filter((x) => x.status === 'ativa')) {
    try { tutorias.finalizar(acesso.tutoria(t.id)); ok++; } catch (e) { erros.push(`${t.tutor_nome}: ${e.message}`); }
  }
  req.flash(erros.length ? 'erro' : 'sucesso', `${ok} tutoria(s) finalizada(s).` + (erros.length ? ` Bloqueadas (RN15): ${erros.join(' | ')}` : ''));
  res.redirect(`/professor/salas/${sala.id}`);
});

// ------------------------------------------------- Aluno na sala (RU9 / RNF8)
r.get('/salas/:id/alunos/:alunoId', (req, res) => {
  const sala = acesso.sala(req.params.id);
  const alunoId = Number(req.params.alunoId);
  if (!acesso.podeVerAluno(req.usuario, alunoId, sala.id)) throw new (require('../lib/erros').ErroAcesso)();
  const aluno = db.get('SELECT id, nome, email FROM usuarios WHERE id = ?', alunoId);
  const t = acesso.tutoriaDoAluno(alunoId, sala.id);
  res.render('comum/aluno-detalhe', {
    titulo: aluno.nome, aluno, sala, tutoria: t ? acesso.tutoria(t.id) : null, voltar: `/professor/salas/${sala.id}`,
    desempenho: avaliacoes.desempenhoAluno(alunoId, sala.id), rubricas: avaliacoes.rubricas({ alunoId }).filter((x) => t && x.tutoria_id === t.id),
    observacoes: t ? avaliacoes.observacoes(t.id, alunoId) : [], catalogo: conteudosCatalogo(),
    podeEditar: sala.professor_id === req.usuario.id && (!t || t.status === 'ativa'), papelVisao: 'professor',
  });
});

// ---------------------------------------------------- Pedidos (RF17)
r.get('/pedidos', (req, res) => {
  res.render('professor/pedidos', {
    titulo: 'Pedidos de tutoria', pendentes: tutorias.pedidosPendentes(req.usuario.id), decididos: tutorias.pedidosDecididos(req.usuario.id),
    salas: db.all('SELECT id, nome, ano_letivo, serie FROM salas WHERE professor_id = ? AND ano_letivo >= ? ORDER BY ano_letivo DESC, serie, nome', req.usuario.id, anoAtual()),
  });
});
r.post('/pedidos/:id/aceitar', (req, res) => {
  const id = tutorias.aceitarPedido(req.usuario, req.params.id, req.body.sala_id);
  req.flash('sucesso', 'Pedido aceito: o aluno agora é tutor nesta sala.');
  res.redirect(`/professor/tutorias/${id}`);
});
r.post('/pedidos/:id/recusar', (req, res) => {
  tutorias.recusarPedido(req.usuario, req.params.id, req.body.resposta);
  req.flash('sucesso', 'Pedido recusado. O usuário continua como aluno.');
  res.redirect('/professor/pedidos');
});

// ------------------------------------------- Histórico geral (RN18)
r.get('/historico', (req, res) => {
  const ano = Number(req.query.ano) || null;
  const anos = db.all('SELECT DISTINCT s.ano_letivo FROM tutorias t JOIN salas s ON s.id = t.sala_id WHERE t.status = ? ORDER BY 1 DESC', 'finalizada').map((x) => x.ano_letivo);
  res.render('professor/historico', { titulo: 'Histórico de tutorias', lista: tutorias.finalizadas(ano), anos, ano, SERIES });
});

module.exports = r;
