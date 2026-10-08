// Cadastro, confirmação de e-mail e autenticação (RF1, RF32, RN20, RN21, RN22, RU1, RU25).
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { ErroRegra } = require('../lib/erros');
const { enviarEmail } = require('../lib/email');
const { notificar } = require('./notificacoes');

const CUSTO_HASH = 10;
const VALIDADE_TOKEN_H = 24;
const HASH_FICTICIO = bcrypt.hashSync('protutal-hash-ficticio', CUSTO_HASH);

const normalizarEmail = (email) => String(email || '').trim().toLowerCase();
const dominioDe = (email) => email.split('@')[1] || '';

/** RN20 / RN22 — 1ª etapa: o domínio precisa estar no array de domínios institucionais do SESI. */
function dominioPermitido(email, papel) {
  const dominio = dominioDe(normalizarEmail(email));
  const lista = papel === 'professor' ? config.dominiosProfessor : config.dominiosAluno;
  return lista.includes(dominio);
}

function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return 'A senha deve conter letras e números.';
  return null;
}

const professoresAtivos = () =>
  db.all("SELECT id, nome FROM usuarios WHERE papel = 'professor' AND email_confirmado = 1 ORDER BY nome");

async function enviarConfirmacao(usuario) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + VALIDADE_TOKEN_H * 3600 * 1000).toISOString();
  db.run('INSERT INTO tokens_email (token, usuario_id, expira_em) VALUES (?, ?, ?)', token, usuario.id, expira);
  const link = `${config.urlBase}/confirmar/${token}`;
  await enviarEmail({
    para: usuario.email,
    assunto: 'Protutal — confirme seu e-mail',
    html: `<p>Olá, ${usuario.nome.replace(/[<>&]/g, '')}!</p>
      <p>Para ativar sua conta no <strong>Protutal</strong>, confirme seu e-mail clicando no link abaixo:</p>
      <p><a href="${link}">${link}</a></p>
      <p>O link é válido por ${VALIDADE_TOKEN_H} horas. Se você não fez este cadastro, ignore esta mensagem.</p>`,
  });
}

/**
 * RU1 — cria a conta (inativa até a confirmação do e-mail).
 * RN21 — quem se cadastra como tutor entra como aluno e gera um pedido "pendente".
 */
async function cadastrar({ nome, email, senha, confirmacao, papel, querSerTutor, professorId, mensagem }) {
  nome = String(nome || '').trim().replace(/\s+/g, ' ');
  email = normalizarEmail(email);
  papel = papel === 'professor' ? 'professor' : 'aluno';

  const erros = {};
  if (nome.length < 3) erros.nome = 'Informe seu nome completo.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erros.email = 'Informe um e-mail válido.';
  else if (!dominioPermitido(email, papel)) {
    const lista = (papel === 'professor' ? config.dominiosProfessor : config.dominiosAluno).map((d) => '@' + d).join(', ');
    erros.email = `Use seu e-mail institucional do SESI (${lista}).`;
  }
  const erroSenha = validarSenha(senha);
  if (erroSenha) erros.senha = erroSenha;
  else if (senha !== confirmacao) erros.confirmacao = 'As senhas não conferem.';

  let professor = null;
  if (papel === 'aluno' && querSerTutor) {
    professor = db.get(
      "SELECT id FROM usuarios WHERE id = ? AND papel = 'professor' AND email_confirmado = 1",
      Number(professorId),
    );
    if (!professor) erros.professorId = 'Escolha o professor responsável que vai analisar seu pedido.';
  }
  if (!erros.email && db.get('SELECT 1 FROM usuarios WHERE email = ?', email)) {
    erros.email = 'Já existe uma conta com este e-mail.';
  }
  if (Object.keys(erros).length) {
    const e = new ErroRegra('Verifique os campos destacados.');
    e.campos = erros;
    throw e;
  }

  const hash = await bcrypt.hash(senha, CUSTO_HASH);
  const usuario = db.transacao(() => {
    const { id } = db.run(
      'INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)',
      nome, email, hash, papel,
    );
    if (professor) {
      db.run(
        'INSERT INTO pedidos_tutoria (aluno_id, professor_id, mensagem) VALUES (?, ?, ?)',
        id, professor.id, String(mensagem || '').trim().slice(0, 500) || null,
      );
    }
    return { id, nome, email, papel };
  });
  await enviarConfirmacao(usuario);
  return usuario;
}

/** RN20 / RN22 — 2ª etapa: confirmação do acesso real ao e-mail. */
function confirmarEmail(token) {
  const registro = db.get('SELECT * FROM tokens_email WHERE token = ?', String(token || ''));
  if (!registro || registro.usado_em) return { ok: false, motivo: 'Link inválido ou já utilizado.' };
  if (registro.expira_em < new Date().toISOString()) return { ok: false, motivo: 'Este link expirou. Solicite um novo.' };

  const usuario = db.transacao(() => {
    db.run('UPDATE tokens_email SET usado_em = ? WHERE token = ?', db.agora(), registro.token);
    db.run('UPDATE usuarios SET email_confirmado = 1 WHERE id = ?', registro.usuario_id);
    return db.get('SELECT id, nome, papel FROM usuarios WHERE id = ?', registro.usuario_id);
  });

  // O pedido de tutoria só chega ao professor depois que a conta é ativada
  const pedido = db.get("SELECT * FROM pedidos_tutoria WHERE aluno_id = ? AND status = 'pendente'", usuario.id);
  if (pedido) {
    notificar(pedido.professor_id, {
      tipo: 'pedido',
      titulo: 'Novo pedido de tutoria',
      texto: `${usuario.nome} quer ser tutor(a).`,
      link: '/professor/pedidos',
    });
  }
  return { ok: true, usuario };
}

async function reenviarConfirmacao(email) {
  const usuario = db.get('SELECT * FROM usuarios WHERE email = ?', normalizarEmail(email));
  if (usuario && !usuario.email_confirmado) await enviarConfirmacao(usuario);
}

/** RU25 — valida credenciais; o login é diferenciado por perfil (RF1). */
async function autenticar(email, senha, papelEsperado) {
  const usuario = db.get('SELECT * FROM usuarios WHERE email = ?', normalizarEmail(email));
  // Compara mesmo quando o usuário não existe, para não revelar quais e-mails estão cadastrados
  const hash = usuario ? usuario.senha_hash : HASH_FICTICIO;
  const confere = await bcrypt.compare(String(senha || ''), hash);
  if (!usuario || !confere) return { erro: 'E-mail ou senha incorretos.' };
  if (usuario.papel !== papelEsperado) {
    return {
      erro: usuario.papel === 'professor'
        ? 'Esta conta é de professor. Use a aba "Professor" para entrar.'
        : 'Esta conta é de aluno. Use a aba "Aluno" para entrar.',
    };
  }
  if (!usuario.email_confirmado) {
    return { erro: 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.', naoConfirmado: true };
  }
  return { usuario };
}

async function alterarSenha(usuarioId, atual, nova, confirmacao) {
  const usuario = db.get('SELECT senha_hash FROM usuarios WHERE id = ?', usuarioId);
  if (!(await bcrypt.compare(String(atual || ''), usuario.senha_hash))) throw new ErroRegra('A senha atual está incorreta.');
  const erro = validarSenha(nova);
  if (erro) throw new ErroRegra(erro);
  if (nova !== confirmacao) throw new ErroRegra('As senhas não conferem.');
  db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', await bcrypt.hash(nova, CUSTO_HASH), usuarioId);
}

/** RF32 — aluno já cadastrado também pode pedir para ser tutor. */
function solicitarTutoria(aluno, professorId, mensagem) {
  if (aluno.papel !== 'aluno') throw new ErroRegra('Somente alunos podem solicitar tutoria.');
  const professor = db.get(
    "SELECT id FROM usuarios WHERE id = ? AND papel = 'professor' AND email_confirmado = 1",
    Number(professorId),
  );
  if (!professor) throw new ErroRegra('Escolha o professor responsável.');
  if (db.get("SELECT 1 FROM pedidos_tutoria WHERE aluno_id = ? AND status = 'pendente'", aluno.id)) {
    throw new ErroRegra('Você já tem um pedido de tutoria pendente.', 'RN21');
  }
  db.run(
    'INSERT INTO pedidos_tutoria (aluno_id, professor_id, mensagem) VALUES (?, ?, ?)',
    aluno.id, professor.id, String(mensagem || '').trim().slice(0, 500) || null,
  );
  notificar(professor.id, {
    tipo: 'pedido',
    titulo: 'Novo pedido de tutoria',
    texto: `${aluno.nome} quer ser tutor(a).`,
    link: '/professor/pedidos',
  });
}

module.exports = {
  dominioPermitido,
  validarSenha,
  professoresAtivos,
  cadastrar,
  confirmarEmail,
  reenviarConfirmacao,
  autenticar,
  alterarSenha,
  solicitarTutoria,
  CUSTO_HASH,
};
