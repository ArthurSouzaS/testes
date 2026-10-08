// Área do aluno tutorado (RF26–RF31, RU19–RU24).
const express = require('express');
const db = require('../db');
const { exigirPapel } = require('../lib/auth');
const acesso = require('../services/acesso');
const atividades = require('../services/atividades');
const avaliacoes = require('../services/avaliacoes');
const apoio = require('../services/apoio');
const salas = require('../services/salas');

const r = express.Router();
r.use(exigirPapel('aluno'));

/** Sala em foco (o aluno pode estar em salas de anos diferentes — RN19). */
function contexto(req) {
  const minhas = acesso.salasDoAluno(req.usuario.id);
  const sala = minhas.find((s) => s.id === Number(req.query.sala)) || minhas[0] || null;
  return { minhas, sala };
}

// RF26 / RF27 — dashboard
r.get('/', (req, res) => {
  const { minhas, sala } = contexto(req);
  const pedido = db.get("SELECT 1 FROM pedidos_tutoria WHERE aluno_id = ? AND status = 'pendente'", req.usuario.id);
  if (!sala) return res.render('aluno/inicio', { titulo: 'Início', minhas, sala: null, pedido });
  const proximas = atividades.doAluno(req.usuario.id)
    .filter((a) => a.sala_id === sala.id && !a.entrega_id && a.prazo > db.agora())
    .sort((a, b) => a.prazo.localeCompare(b.prazo)).slice(0, 5);
  res.render('aluno/inicio', {
    titulo: 'Meu desempenho', minhas, sala, pedido, proximas,
    desempenho: avaliacoes.desempenhoAluno(req.usuario.id, sala.id),
    avisos: salas.avisos(sala.id).slice(0, 3),
  });
});

// RF30 — atividades
r.get('/atividades', (req, res) => {
  const filtro = ['pendentes', 'enviadas', 'corrigidas', 'encerradas'].includes(req.query.filtro) ? req.query.filtro : 'todas';
  const agora = db.agora();
  let lista = atividades.doAluno(req.usuario.id);
  const status = (a) => (a.entrega_status === 'corrigida' ? 'corrigidas' : a.entrega_status ? 'enviadas' : a.prazo < agora ? 'encerradas' : 'pendentes');
  lista.forEach((a) => { a.situacao = status(a); });
  if (filtro !== 'todas') lista = lista.filter((a) => a.situacao === filtro);
  res.render('aluno/atividades', { titulo: 'Atividades', lista, filtro });
});

// RF28 — espaço de dúvidas e materiais
r.get('/apoio', (req, res) => {
  const { minhas } = contexto(req);
  const tutorias = minhas.filter((s) => s.tutoria_id).map((s) => ({
    ...s, materiais: apoio.materiais(s.tutoria_id, req.usuario.id), duvidas: apoio.duvidas(s.tutoria_id, req.usuario.id),
  }));
  res.render('aluno/apoio', { titulo: 'Dúvidas e materiais', tutorias, catalogo: db.all('SELECT * FROM conteudos ORDER BY eixo, nome') });
});
r.post('/duvidas', (req, res) => {
  apoio.perguntar(req.usuario, acesso.tutoria(req.body.tutoria_id), req.body);
  req.flash('sucesso', 'Dúvida enviada ao seu tutor.');
  res.redirect('/aluno/apoio');
});

// RU27 / RF24 — avisos da sala e comunicados do tutor
r.get('/avisos', (req, res) => {
  const { minhas } = contexto(req);
  res.render('aluno/avisos', { titulo: 'Avisos e comunicados', avisos: salas.avisos(minhas.map((s) => s.id)), comunicados: apoio.comunicadosDoAluno(req.usuario.id) });
});

// RF22 (feedbacks recebidos) + avaliação do tutor pelo aluno
r.get('/avaliacoes', (req, res) => {
  const { minhas } = contexto(req);
  const tutorias = minhas.filter((s) => s.tutoria_id).map((s) => ({
    ...s,
    minhas: db.all('SELECT * FROM avaliacoes_tutor WHERE tutoria_id = ? AND avaliador_id = ? ORDER BY etapa', s.tutoria_id, req.usuario.id),
  }));
  res.render('aluno/avaliacoes', { titulo: 'Feedbacks e avaliação do tutor', rubricas: avaliacoes.rubricas({ alunoId: req.usuario.id }), tutorias });
});
r.post('/avaliacoes', (req, res) => {
  avaliacoes.avaliarTutor(req.usuario, acesso.tutoria(req.body.tutoria_id), req.body);
  req.flash('sucesso', 'Obrigado! Sua avaliação foi registrada.');
  res.redirect('/aluno/avaliacoes');
});

module.exports = r;
