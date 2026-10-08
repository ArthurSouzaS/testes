const path = require('node:path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const db = require('./db');
const SessaoSQLite = require('./lib/sessao-store');
const seguranca = require('./lib/seguranca');
const { carregarUsuario } = require('./lib/auth');
const formato = require('./lib/formato');
const dominio = require('./lib/dominio');
const { contarNaoLidas } = require('./services/notificacoes');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(seguranca.cabecalhos);
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.producao ? '7d' : 0 }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'protutal.sid',
  secret: config.segredoSessao,
  store: new SessaoSQLite(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.producao, maxAge: 8 * 60 * 60 * 1000 },
}));
app.use(seguranca.tokenCsrf);
app.use(seguranca.verificarCsrf);
app.use(carregarUsuario);

// Variáveis disponíveis em todas as views
app.use((req, res, next) => {
  res.locals.f = formato;
  res.locals.d = dominio;
  res.locals.caminho = req.path;
  res.locals.flash = req.session.flash || null;
  res.locals.campos = req.session.campos || {};
  res.locals.form = req.session.dadosForm || {};
  delete req.session.flash;
  delete req.session.campos;
  delete req.session.dadosForm;
  res.locals.naoLidas = req.usuario ? contarNaoLidas(req.usuario.id) : 0;
  res.locals.ehTutor = req.usuario && req.usuario.papel === 'aluno'
    && !!db.get("SELECT 1 FROM tutorias WHERE tutor_id = ?", req.usuario.id);
  res.locals.titulo = 'Protutal';

  req.flash = (tipo, texto) => { req.session.flash = { tipo, texto }; };
  res.voltar = (padrao = '/') => {
    let destino = padrao;
    try {
      const ref = new URL(req.get('referer'));
      if (ref.host === req.get('host')) destino = ref.pathname + ref.search;
    } catch { /* sem referer válido */ }
    res.redirect(destino);
  };
  next();
});

app.use(require('./routes/auth'));
app.use(require('./routes/comum'));
app.use('/professor', require('./routes/professor'));
app.use('/tutor', require('./routes/tutor'));
app.use('/aluno', require('./routes/aluno'));

app.use((req, res) => res.status(404).render('comum/erro', { titulo: 'Não encontrado', status: 404, mensagem: 'Página não encontrada.' }));

// Tratamento de erros: regras de negócio voltam para o formulário com a mensagem
app.use((erro, req, res, next) => {
  const status = erro.status || 500;
  if (status >= 500) console.error(erro);
  const mensagem = status >= 500 ? 'Ocorreu um erro inesperado. Tente novamente.' : erro.message;
  if (req.method === 'POST' && status === 422) {
    req.flash('erro', mensagem + (erro.regra ? ` (${erro.regra})` : ''));
    if (erro.campos) req.session.campos = erro.campos;
    req.session.dadosForm = req.body;
    return res.voltar();
  }
  if (req.xhr || (req.get('accept') || '').includes('application/json')) return res.status(status).json({ erro: mensagem });
  res.status(status).render('comum/erro', { titulo: 'Erro', status, mensagem });
});

module.exports = app;
