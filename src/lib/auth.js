// RU25 — sessão, perfis e proteção das áreas restritas.
const db = require('../db');
const { ErroAcesso } = require('./erros');

function carregarUsuario(req, res, next) {
  const id = req.session.usuarioId;
  req.usuario = id ? db.get('SELECT id, nome, email, papel FROM usuarios WHERE id = ? AND email_confirmado = 1', id) : null;
  if (id && !req.usuario) delete req.session.usuarioId;
  res.locals.usuario = req.usuario;
  next();
}

function exigirLogin(req, res, next) {
  if (req.usuario) return next();
  if (req.get('accept') && req.get('accept').includes('text/event-stream')) return res.status(401).end();
  req.session.voltarPara = req.method === 'GET' ? req.originalUrl : null;
  res.redirect('/');
}

const exigirPapel = (papel) => (req, res, next) => {
  if (!req.usuario) return exigirLogin(req, res, next);
  if (req.usuario.papel !== papel) return next(new ErroAcesso('Esta área é exclusiva para ' + (papel === 'professor' ? 'professores.' : 'alunos.')));
  next();
};

const areaInicial = (usuario) => (usuario.papel === 'professor' ? '/professor' : '/aluno');

module.exports = { carregarUsuario, exigirLogin, exigirPapel, areaInicial };
