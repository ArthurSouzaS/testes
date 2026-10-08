// Login, cadastro e confirmação de e-mail (RF1, RF32, RN20–RN22, RU1, RU25).
const express = require('express');
const usuarios = require('../services/usuarios');
const seguranca = require('../lib/seguranca');
const { areaInicial } = require('../lib/auth');
const config = require('../config');

const r = express.Router();

r.get('/', (req, res) => {
  if (req.usuario) return res.redirect(areaInicial(req.usuario));
  res.render('auth/login', { titulo: 'Entrar', perfil: req.query.perfil === 'professor' ? 'professor' : 'aluno' });
});

r.post('/login', async (req, res) => {
  const perfil = req.body.perfil === 'professor' ? 'professor' : 'aluno';
  const chave = `${req.ip}:${String(req.body.email || '').toLowerCase()}`;
  const voltar = (erro, extra = {}) =>
    res.status(401).render('auth/login', { titulo: 'Entrar', perfil, erro, email: req.body.email, ...extra });

  const minutos = seguranca.bloqueado(chave);
  if (minutos) return voltar(`Muitas tentativas. Tente novamente em ${minutos} min.`);

  const { usuario, erro, naoConfirmado } = await usuarios.autenticar(req.body.email, req.body.senha, perfil);
  if (!usuario) {
    if (!naoConfirmado) seguranca.registrarFalha(chave);
    return voltar(erro, { naoConfirmado });
  }
  seguranca.limparFalhas(chave);
  const destino = req.session.voltarPara;
  req.session.regenerate((e) => {
    if (e) throw e;
    req.session.usuarioId = usuario.id;
    res.redirect(destino && destino.startsWith('/') && !destino.startsWith('//') ? destino : areaInicial(usuario));
  });
});

r.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('protutal.sid');
    res.redirect('/');
  });
});

r.get('/cadastro', (req, res) => {
  if (req.usuario) return res.redirect(areaInicial(req.usuario));
  res.render('auth/cadastro', {
    titulo: 'Criar conta',
    perfil: req.query.perfil === 'professor' ? 'professor' : 'aluno',
    professores: usuarios.professoresAtivos(),
    dados: {}, erros: {},
    dominios: { professor: config.dominiosProfessor, aluno: config.dominiosAluno },
  });
});

r.post('/cadastro', async (req, res) => {
  try {
    const u = await usuarios.cadastrar({ ...req.body, querSerTutor: req.body.querSerTutor === '1' });
    req.session.emailCadastro = u.email;
    res.redirect('/cadastro/enviado');
  } catch (erro) {
    if (!erro.campos && erro.status !== 422) throw erro;
    res.status(422).render('auth/cadastro', {
      titulo: 'Criar conta',
      perfil: req.body.papel === 'professor' ? 'professor' : 'aluno',
      professores: usuarios.professoresAtivos(),
      dados: req.body, erros: erro.campos || {}, erro: erro.message,
      dominios: { professor: config.dominiosProfessor, aluno: config.dominiosAluno },
    });
  }
});

r.get('/cadastro/enviado', (req, res) => {
  res.render('auth/enviado', { titulo: 'Confirme seu e-mail', email: req.session.emailCadastro, modoDev: require('../lib/email').modoDesenvolvimento });
});

r.post('/cadastro/reenviar', async (req, res) => {
  await usuarios.reenviarConfirmacao(req.body.email || req.session.emailCadastro);
  req.session.emailCadastro = req.body.email || req.session.emailCadastro;
  req.flash('sucesso', 'Se houver um cadastro pendente para este e-mail, enviamos um novo link de confirmação.');
  res.redirect('/cadastro/enviado');
});

r.get('/confirmar/:token', (req, res) => {
  const resultado = usuarios.confirmarEmail(req.params.token);
  res.render('auth/confirmado', { titulo: 'Confirmação de e-mail', ...resultado });
});

module.exports = r;
