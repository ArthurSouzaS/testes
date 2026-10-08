// Rotas compartilhadas: tempo real, notificações, perfil, arquivos, atividades, entregas e chat.
const path = require('node:path');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { exigirLogin } = require('../lib/auth');
const { ErroAcesso, NaoEncontrado, ErroRegra } = require('../lib/erros');
const tempoReal = require('../lib/tempo-real');
const upload = require('../lib/upload');
const notificacoes = require('../services/notificacoes');
const usuarios = require('../services/usuarios');
const acesso = require('../services/acesso');
const atividades = require('../services/atividades');
const avaliacoes = require('../services/avaliacoes');
const apoio = require('../services/apoio');
const { modoDesenvolvimento } = require('../lib/email');

const r = express.Router();

// ------------------------------------------------ Caixa de e-mails (dev)
if (!config.producao && modoDesenvolvimento) {
  r.get('/dev/emails', (req, res) => {
    res.render('comum/emails', { titulo: 'Caixa de saída (desenvolvimento)', emails: db.all('SELECT * FROM emails_enviados ORDER BY id DESC LIMIT 30') });
  });
}

r.use([
  '/eventos', '/notificacoes', '/perfil', '/arquivos', '/atividades', '/entregas', '/mensagens', '/conteudos',
], exigirLogin);

// RNF7 — canal de eventos em tempo real
r.get('/eventos', (req, res) => tempoReal.conectar(req.usuario.id, req, res));

// ---------------------------------------------------------- Notificações
r.get('/notificacoes', (req, res) => {
  res.render('comum/notificacoes', { titulo: 'Notificações', lista: notificacoes.listar(req.usuario.id, 100) });
});
r.get('/notificacoes/:id/abrir', (req, res) => {
  const n = db.get('SELECT * FROM notificacoes WHERE id = ? AND usuario_id = ?', Number(req.params.id), req.usuario.id);
  if (!n) throw new NaoEncontrado();
  notificacoes.marcarLida(req.usuario.id, n.id);
  res.redirect(n.link && n.link.startsWith('/') ? n.link : '/notificacoes');
});
r.post('/notificacoes/lidas', (req, res) => {
  notificacoes.marcarTodasLidas(req.usuario.id);
  res.voltar('/notificacoes');
});

// ------------------------------------------------------------------ Perfil
r.get('/perfil', (req, res) => {
  const pedidos = db.all(
    `SELECT p.*, u.nome AS professor_nome, s.nome AS sala_nome FROM pedidos_tutoria p JOIN usuarios u ON u.id = p.professor_id
       LEFT JOIN salas s ON s.id = p.sala_id WHERE p.aluno_id = ? ORDER BY p.id DESC`, req.usuario.id);
  res.render('comum/perfil', {
    titulo: 'Meu perfil', pedidos, professores: usuarios.professoresAtivos(),
    tutorias: req.usuario.papel === 'aluno' ? acesso.tutoriasComoTutor(req.usuario.id) : [],
  });
});
r.post('/perfil/senha', async (req, res) => {
  await usuarios.alterarSenha(req.usuario.id, req.body.atual, req.body.nova, req.body.confirmacao);
  req.flash('sucesso', 'Senha alterada com sucesso.');
  res.redirect('/perfil');
});
r.post('/perfil/tutoria', (req, res) => {
  usuarios.solicitarTutoria(req.usuario, req.body.professor_id, req.body.mensagem);
  req.flash('sucesso', 'Pedido enviado! O professor vai analisar e você será notificado.');
  res.redirect('/perfil');
});

// ---------------------------------------------------------------- Arquivos
function podeBaixar(usuario, a) {
  if (a.dono_id === usuario.id) return true;
  if (a.contexto === 'entrega') {
    const e = db.get('SELECT * FROM entregas WHERE id = ?', a.ref_id);
    if (!e) return false;
    const at = atividades.carregar(e.atividade_id);
    return e.aluno_id === usuario.id || !!atividades.papelCorretor(usuario, at, e.aluno_id) || acesso.podeVerAluno(usuario, e.aluno_id, at.sala_id);
  }
  if (a.contexto === 'material') {
    const m = db.get('SELECT * FROM materiais WHERE id = ?', a.ref_id);
    if (!m) return false;
    const rel = acesso.relacaoComTutoria(usuario, acesso.tutoria(m.tutoria_id));
    return rel && (rel !== 'tutorado' || !m.aluno_id || m.aluno_id === usuario.id);
  }
  if (a.contexto === 'registro') {
    const reg = db.get('SELECT tutoria_id FROM registros WHERE id = ?', a.ref_id);
    const rel = reg && acesso.relacaoComTutoria(usuario, acesso.tutoria(reg.tutoria_id));
    return !!rel && rel !== 'tutorado';
  }
  if (a.contexto === 'mensagem') {
    const m = db.get('SELECT * FROM mensagens WHERE id = ?', a.ref_id);
    if (!m) return false;
    const t = acesso.tutoria(m.tutoria_id);
    return usuario.id === m.aluno_id || usuario.id === t.tutor_id;
  }
  return false;
}

r.get('/arquivos/:id', (req, res) => {
  const a = db.get('SELECT * FROM arquivos WHERE id = ?', Number(req.params.id));
  if (!a) throw new NaoEncontrado('Arquivo não encontrado.');
  if (!podeBaixar(req.usuario, a)) throw new ErroAcesso();
  const inline = a.mime.startsWith('image/') || a.mime === 'application/pdf';
  res.set('Content-Type', a.mime);
  res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome_original)}`);
  res.sendFile(path.join(config.pastaUploads, path.basename(a.nome_salvo)));
});

// -------------------------------------------------------------- Atividades
r.get('/atividades/:id', (req, res) => {
  const at = atividades.carregar(req.params.id);
  const rel = atividades.relacao(req.usuario, at);
  if (!rel) throw new ErroAcesso('Esta atividade não está disponível para você.');
  if (rel === 'aluno') {
    const entrega = atividades.entregaDoAluno(at.id, req.usuario.id);
    const tutoria = atividades.tutoriaResponsavel(at, req.usuario.id);
    return res.render('aluno/atividade', {
      titulo: at.titulo, at, entrega,
      arquivos: entrega ? upload.listar('entrega', entrega.id) : [],
      comentarios: entrega ? atividades.comentarios(entrega.id) : [],
      contestacoes: entrega ? atividades.contestacoes(entrega.id) : [],
      bloqueada: tutoria && tutoria.status === 'finalizada',
    });
  }
  res.render('comum/atividade-entregas', { titulo: at.titulo, at, rel, entregas: atividades.entregasDa(at, req.usuario, rel) });
});

r.post('/atividades/:id/entregar', upload.receber('arquivos'), (req, res) => {
  const at = atividades.carregar(req.params.id);
  try {
    const id = atividades.enviar(req.usuario, at, req.body, (req.files || []).length > 0);
    upload.registrar(req, 'entrega', id);
  } catch (e) {
    upload.removerEnviados(req);
    throw e;
  }
  req.flash('sucesso', 'Resposta enviada! Data e hora do envio registradas.');
  res.redirect(`/atividades/${at.id}`);
});

r.post('/atividades/:id/excluir', (req, res) => {
  const at = atividades.carregar(req.params.id);
  atividades.excluir(req.usuario, at);
  req.flash('sucesso', 'Atividade excluída.');
  res.redirect(at.tutoria_id ? `/tutor/tutorias/${at.tutoria_id}/atividades` : `/professor/salas/${at.sala_id}/atividades`);
});

// ---------------------------------------------------------------- Entregas
function contextoEntrega(req) {
  const e = atividades.entrega(req.params.id);
  const at = atividades.carregar(e.atividade_id);
  const corretor = atividades.papelCorretor(req.usuario, at, e.aluno_id);
  const ehAluno = e.aluno_id === req.usuario.id;
  if (!ehAluno && !corretor && !acesso.podeVerAluno(req.usuario, e.aluno_id, at.sala_id)) throw new ErroAcesso();
  return { e, at, corretor, ehAluno };
}

r.get('/entregas/:id', (req, res) => {
  const { e, at, corretor, ehAluno } = contextoEntrega(req);
  if (ehAluno) return res.redirect(`/atividades/${at.id}`);
  const t = atividades.tutoriaResponsavel(at, e.aluno_id);
  res.render('comum/entrega', {
    titulo: `${at.titulo} — ${e.aluno_nome}`, e, at, corretor,
    somenteLeitura: !corretor || (t && t.status === 'finalizada'),
    arquivos: upload.listar('entrega', e.id), comentarios: atividades.comentarios(e.id), contestacoes: atividades.contestacoes(e.id),
  });
});

r.post('/entregas/:id/corrigir', (req, res) => {
  const { e, at } = contextoEntrega(req);
  atividades.corrigir(req.usuario, at, e, req.body);
  req.flash('sucesso', 'Correção salva e aluno notificado.');
  res.redirect(`/entregas/${e.id}`);
});
r.post('/entregas/:id/comentar', (req, res) => {
  const { e, at } = contextoEntrega(req);
  atividades.comentar(req.usuario, at, e, req.body);
  req.flash('sucesso', 'Comentário publicado.');
  res.redirect(`/entregas/${e.id}#q${req.body.questao_id || 'geral'}`);
});
r.post('/entregas/:id/contestar', (req, res) => {
  const { e, at } = contextoEntrega(req);
  atividades.contestar(req.usuario, at, e, req.body.justificativa);
  req.flash('sucesso', 'Contestação enviada. Você será avisado quando houver resposta.');
  res.redirect(`/atividades/${at.id}`);
});
r.post('/entregas/:id/contestacao', (req, res) => {
  const { e, at } = contextoEntrega(req);
  atividades.responderContestacao(req.usuario, at, e, req.body);
  req.flash('sucesso', 'Contestação respondida.');
  res.redirect(`/entregas/${e.id}`);
});

// RF27 — registro manual de conteúdo dominado / a treinar
r.post('/conteudos', (req, res) => {
  avaliacoes.registrarConteudo(req.usuario, Number(req.body.sala_id), Number(req.body.aluno_id), Number(req.body.conteudo_id), req.body.situacao);
  req.flash('sucesso', 'Situação do conteúdo atualizada.');
  res.voltar();
});

// ---------------------------------------------------------------- Chat 1:1
r.get('/mensagens', (req, res) => {
  res.render('comum/mensagens', { titulo: 'Mensagens', conversas: apoio.conversas(req.usuario), atual: null, msgs: [] });
});

function conv(req) {
  const [tutoriaId, alunoId] = String(req.params.conv).split('-').map(Number);
  return apoio.conversa(req.usuario, tutoriaId, alunoId);
}

r.get('/mensagens/:conv', (req, res) => {
  const c = conv(req);
  res.render('comum/mensagens', {
    titulo: `Conversa com ${c.outro.nome}`, conversas: apoio.conversas(req.usuario), atual: c, msgs: apoio.mensagens(c, req.usuario),
  });
});

r.post('/mensagens/:conv', upload.receber('arquivos'), (req, res) => {
  const c = conv(req);
  let arquivoId = null;
  try {
    if ((req.files || []).length) [arquivoId] = upload.registrar(req, 'mensagem', null);
    const msg = apoio.enviarMensagem(c, req.usuario, req.body.texto, arquivoId);
    if (req.xhr || (req.get('accept') || '').includes('application/json')) return res.json({ ok: true, mensagem: msg });
  } catch (e) {
    upload.removerEnviados(req);
    if (arquivoId) db.run('DELETE FROM arquivos WHERE id = ?', arquivoId);
    if (e instanceof ErroRegra && (req.get('accept') || '').includes('application/json')) return res.status(422).json({ erro: e.message });
    throw e;
  }
  res.redirect(`/mensagens/${req.params.conv}`);
});

module.exports = r;
