// Área do tutor — aluno com tutorias (RF20–RF25, RU13–RU18).
const express = require('express');
const db = require('../db');
const { exigirPapel } = require('../lib/auth');
const { MODELOS } = require('../lib/dominio');
const acesso = require('../services/acesso');
const atividades = require('../services/atividades');
const avaliacoes = require('../services/avaliacoes');
const apoio = require('../services/apoio');
const salas = require('../services/salas');
const upload = require('../lib/upload');

const r = express.Router();
r.use(exigirPapel('aluno'));

const catalogo = () => db.all('SELECT * FROM conteudos ORDER BY eixo, nome');

function minha(req) {
  const t = acesso.tutoria(req.params.id);
  acesso.exigirRelacao(req.usuario, t, 'tutor');
  t.tutorados = acesso.alunosDaTutoria(t.id);
  t.ativa = t.status === 'ativa';
  return t;
}
const render = (res, view, t, aba, dados) => res.render(`tutor/${view}`, { titulo: `Tutoria — ${t.sala_nome}`, t, aba, ...dados });

r.get('/', (req, res) => {
  const lista = acesso.tutoriasComoTutor(req.usuario.id);
  if (!lista.length) return res.redirect('/aluno');
  for (const t of lista) {
    t.pendencias = require('../services/tutorias').pendencias(t);
    t.duvidasAbertas = db.get('SELECT COUNT(*) AS n FROM duvidas WHERE tutoria_id = ? AND resposta IS NULL', t.id).n;
  }
  res.render('tutor/inicio', { titulo: 'Área do tutor', lista });
});

// RF23 — dashboard do próprio tutor
r.get('/desempenho', (req, res) => {
  res.render('tutor/desempenho', { titulo: 'Meu desempenho como tutor', lista: avaliacoes.desempenhoDoTutor(req.usuario.id) });
});

r.get('/tutorias/:id', (req, res) => {
  const t = minha(req);
  for (const a of t.tutorados) {
    const d = avaliacoes.desempenhoAluno(a.id, t.sala_id);
    a.mediaGeral = d.mediaGeral;
    a.pendentes = db.get(`SELECT COUNT(*) AS n FROM entregas e JOIN atividades x ON x.id = e.atividade_id
      WHERE e.aluno_id = ? AND x.sala_id = ? AND e.status = 'enviada'`, a.id, t.sala_id).n;
  }
  render(res, 'tutoria', t, 'geral', {
    criterios: salas.criterios(t.sala_id), conteudos: require('../services/tutorias').conteudos(t.id),
    pendencias: require('../services/tutorias').pendencias(t), desempenho: avaliacoes.desempenhoTutoria(t),
  });
});

// Histórico / evolução de um tutorado (RU16 — só os vinculados)
r.get('/tutorias/:id/tutorados/:alunoId', (req, res) => {
  const t = minha(req);
  const alunoId = Number(req.params.alunoId);
  if (!acesso.ehTutorado(alunoId, t.id)) throw new (require('../lib/erros').ErroAcesso)();
  const sala = acesso.sala(t.sala_id);
  res.render('comum/aluno-detalhe', {
    titulo: 'Tutorado', aluno: db.get('SELECT id, nome, email FROM usuarios WHERE id = ?', alunoId), sala, tutoria: t,
    voltar: `/tutor/tutorias/${t.id}`, desempenho: avaliacoes.desempenhoAluno(alunoId, sala.id),
    rubricas: avaliacoes.rubricas({ alunoId }).filter((x) => x.tutoria_id === t.id), observacoes: [],
    catalogo: catalogo(), podeEditar: t.ativa, papelVisao: 'tutor',
  });
});

// RF20 — atividades
r.get('/tutorias/:id/atividades', (req, res) => {
  const t = minha(req);
  render(res, 'atividades', t, 'atividades', { lista: atividades.daTutoria(t) });
});
r.get('/tutorias/:id/atividades/nova', (req, res) => {
  const t = minha(req);
  if (!t.pode_criar_atividades || !t.ativa) {
    req.flash('erro', 'O professor ainda não liberou a criação de atividades para você (RN08).');
    return res.redirect(`/tutor/tutorias/${t.id}/atividades`);
  }
  res.render('comum/atividade-form', {
    titulo: 'Nova atividade para tutorados', sala: acesso.sala(t.sala_id), tutoria: t, conteudos: catalogo(),
    modelos: t.modelos.filter((m) => MODELOS[m]), acao: `/tutor/tutorias/${t.id}/atividades`, voltar: `/tutor/tutorias/${t.id}/atividades`,
  });
});
r.post('/tutorias/:id/atividades', (req, res) => {
  const t = minha(req);
  const id = atividades.criar(req.usuario, { sala: acesso.sala(t.sala_id), tutoria: t }, req.body);
  req.flash('sucesso', 'Atividade enviada aos seus tutorados.');
  res.redirect(`/atividades/${id}`);
});

// RF22 — rubricas
r.get('/tutorias/:id/rubricas', (req, res) => {
  const t = minha(req);
  render(res, 'rubricas', t, 'rubricas', { criterios: salas.criterios(t.sala_id), rubricas: avaliacoes.rubricas({ tutoriaId: t.id }) });
});
r.post('/tutorias/:id/rubricas', (req, res) => {
  const t = minha(req);
  avaliacoes.salvarRubrica(req.usuario, t, req.body);
  req.flash('sucesso', 'Rubrica salva. O tutorado e o professor foram notificados.');
  res.redirect(`/tutor/tutorias/${t.id}/rubricas`);
});

// RU7 — registros de encontro (assuntos, estratégias, anexos)
r.get('/tutorias/:id/registros', (req, res) => {
  const t = minha(req);
  const lista = apoio.registros(t.id);
  for (const x of lista) x.arquivos = upload.listar('registro', x.id);
  render(res, 'registros', t, 'registros', { lista, catalogo: catalogo() });
});
r.post('/tutorias/:id/registros', upload.receber('arquivos'), (req, res) => {
  const t = minha(req);
  try {
    upload.registrar(req, 'registro', apoio.registrar(req.usuario, t, req.body));
  } catch (e) { upload.removerEnviados(req); throw e; }
  req.flash('sucesso', 'Registro do encontro salvo.');
  res.redirect(`/tutor/tutorias/${t.id}/registros`);
});

// RF25 — materiais
r.get('/tutorias/:id/materiais', (req, res) => {
  const t = minha(req);
  render(res, 'materiais', t, 'materiais', { lista: apoio.materiais(t.id), catalogo: catalogo() });
});
r.post('/tutorias/:id/materiais', upload.receber('arquivos'), (req, res) => {
  const t = minha(req);
  try {
    upload.registrar(req, 'material', apoio.publicarMaterial(req.usuario, t, req.body, (req.files || []).length > 0));
  } catch (e) { upload.removerEnviados(req); throw e; }
  req.flash('sucesso', 'Material disponibilizado.');
  res.redirect(`/tutor/tutorias/${t.id}/materiais`);
});
r.post('/tutorias/:id/materiais/:mid/excluir', (req, res) => {
  const t = minha(req);
  apoio.removerMaterial(req.usuario, t, req.params.mid);
  res.redirect(`/tutor/tutorias/${t.id}/materiais`);
});

// RF24 — comunicados
r.get('/tutorias/:id/comunicados', (req, res) => {
  const t = minha(req);
  render(res, 'comunicados', t, 'comunicados', { lista: apoio.comunicadosDaTutoria(t.id) });
});
r.post('/tutorias/:id/comunicados', (req, res) => {
  const t = minha(req);
  apoio.comunicar(req.usuario, t, req.body);
  req.flash('sucesso', 'Comunicado enviado e tutorados notificados.');
  res.redirect(`/tutor/tutorias/${t.id}/comunicados`);
});

// RF28 — dúvidas dos tutorados
r.get('/tutorias/:id/duvidas', (req, res) => {
  const t = minha(req);
  render(res, 'duvidas', t, 'duvidas', { lista: apoio.duvidas(t.id) });
});
r.post('/tutorias/:id/duvidas/:did', (req, res) => {
  const t = minha(req);
  apoio.responderDuvida(req.usuario, t, req.params.did, req.body.resposta);
  req.flash('sucesso', 'Resposta enviada.');
  res.redirect(`/tutor/tutorias/${t.id}/duvidas`);
});

module.exports = r;
