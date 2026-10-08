// Registros de encontro, materiais, comunicados, dúvidas, chat e alertas de prazo
// (RF2, RF24, RF25, RF28, RU7, RU17, RU18, RU22, RU24).
const db = require('../db');
const config = require('../config');
const { ErroRegra, ErroAcesso } = require('../lib/erros');
const acesso = require('./acesso');
const tempoReal = require('../lib/tempo-real');
const { notificar } = require('./notificacoes');

const txt = (v) => String(v || '').trim();
const exigirTutor = (usuario, t) => {
  if (t.tutor_id !== usuario.id) throw new ErroAcesso('Apenas o tutor desta tutoria pode fazer isso.');
  acesso.exigirAtiva(t);
};

// ------------------------------------------- Registros do tutor (RU7)
function registrar(usuario, t, d) {
  exigirTutor(usuario, t);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txt(d.data_encontro))) throw new ErroRegra('Informe a data do encontro.');
  if (txt(d.assuntos).length < 3) throw new ErroRegra('Descreva os assuntos trabalhados.');
  const { id } = db.run(
    'INSERT INTO registros (tutoria_id, tutor_id, data_encontro, conteudo_id, assuntos, estrategias, consideracoes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    t.id, usuario.id, d.data_encontro, Number(d.conteudo_id) || null, txt(d.assuntos), txt(d.estrategias) || null, txt(d.consideracoes) || null,
  );
  notificar(t.professor_id, { tipo: 'registro', titulo: 'Novo registro de encontro', texto: `${usuario.nome} — ${t.sala_nome}`, link: `/professor/tutorias/${t.id}` });
  return id;
}

const registros = (tutoriaId) =>
  db.all(
    `SELECT r.*, u.nome AS tutor_nome, c.nome AS conteudo_nome, v.nome AS validador_nome FROM registros r
       JOIN usuarios u ON u.id = r.tutor_id LEFT JOIN conteudos c ON c.id = r.conteudo_id LEFT JOIN usuarios v ON v.id = r.validado_por
      WHERE r.tutoria_id = ? ORDER BY r.data_encontro DESC, r.id DESC`,
    tutoriaId,
  );

// ---------------------------------------------- Materiais (RF25 / RU24)
function publicarMaterial(usuario, t, d, temArquivo) {
  exigirTutor(usuario, t);
  const link = txt(d.link);
  if (txt(d.titulo).length < 3) throw new ErroRegra('Informe o título do material.');
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new ErroRegra('O link deve começar com http:// ou https://');
  if (!link && !temArquivo) throw new ErroRegra('Anexe um arquivo ou informe um link.');
  const alunoId = Number(d.aluno_id) || null;
  if (alunoId && !acesso.ehTutorado(alunoId, t.id)) throw new ErroRegra('Destinatário inválido.');
  const { id } = db.run(
    'INSERT INTO materiais (tutoria_id, aluno_id, autor_id, titulo, descricao, link, conteudo_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    t.id, alunoId, usuario.id, txt(d.titulo), txt(d.descricao) || null, link || null, Number(d.conteudo_id) || null,
  );
  notificar(alunoId ? [alunoId] : acesso.alunosDaTutoria(t.id).map((a) => a.id), {
    tipo: 'material', titulo: `Novo material: ${txt(d.titulo)}`, texto: usuario.nome, link: '/aluno/apoio',
  });
  return id;
}

/** RU24 — o tutorado vê apenas materiais da tutoria para todos ou destinados a ele. */
function materiais(tutoriaId, alunoId = null) {
  const lista = db.all(
    `SELECT m.*, u.nome AS autor_nome, c.nome AS conteudo_nome, d.nome AS destinatario_nome FROM materiais m
       JOIN usuarios u ON u.id = m.autor_id LEFT JOIN conteudos c ON c.id = m.conteudo_id LEFT JOIN usuarios d ON d.id = m.aluno_id
      WHERE m.tutoria_id = ? AND (? IS NULL OR m.aluno_id IS NULL OR m.aluno_id = ?) ORDER BY m.id DESC`,
    tutoriaId, alunoId, alunoId,
  );
  for (const m of lista) m.arquivos = db.all("SELECT * FROM arquivos WHERE contexto = 'material' AND ref_id = ?", m.id);
  return lista;
}

function removerMaterial(usuario, t, id) {
  exigirTutor(usuario, t);
  db.run('DELETE FROM materiais WHERE id = ? AND tutoria_id = ?', Number(id), t.id);
}

// ---------------------------------------------- Comunicados (RF24 / RU17)
function comunicar(usuario, t, d) {
  exigirTutor(usuario, t);
  if (txt(d.titulo).length < 3 || !txt(d.texto)) throw new ErroRegra('Informe o título e o texto do comunicado.');
  const meus = new Set(acesso.alunosDaTutoria(t.id).map((a) => a.id));
  const alvo = [].concat(d.alunos || []).map(Number).filter((id) => meus.has(id));
  if (!alvo.length) throw new ErroRegra('Selecione ao menos um tutorado.');
  db.transacao(() => {
    const { id } = db.run('INSERT INTO comunicados (tutoria_id, autor_id, titulo, texto) VALUES (?, ?, ?, ?)', t.id, usuario.id, txt(d.titulo), txt(d.texto));
    for (const a of alvo) db.run('INSERT INTO comunicado_destinatarios (comunicado_id, aluno_id) VALUES (?, ?)', id, a);
  });
  notificar(alvo, { tipo: 'comunicado', titulo: `Comunicado: ${txt(d.titulo)}`, texto: usuario.nome, link: '/aluno/avisos' });
}

const comunicadosDaTutoria = (tutoriaId) =>
  db.all(
    `SELECT c.*, (SELECT GROUP_CONCAT(u.nome, ', ') FROM comunicado_destinatarios cd JOIN usuarios u ON u.id = cd.aluno_id
       WHERE cd.comunicado_id = c.id) AS destinatarios FROM comunicados c WHERE c.tutoria_id = ? ORDER BY c.id DESC`,
    tutoriaId,
  );

const comunicadosDoAluno = (alunoId) =>
  db.all(
    `SELECT c.*, u.nome AS autor_nome, s.nome AS sala_nome FROM comunicados c
       JOIN comunicado_destinatarios cd ON cd.comunicado_id = c.id JOIN usuarios u ON u.id = c.autor_id
       JOIN tutorias t ON t.id = c.tutoria_id JOIN salas s ON s.id = t.sala_id
      WHERE cd.aluno_id = ? ORDER BY c.id DESC`,
    alunoId,
  );

// ---------------------------------------------------- Dúvidas (RF28)
function perguntar(aluno, t, d) {
  if (!acesso.ehTutorado(aluno.id, t.id)) throw new ErroAcesso();
  acesso.exigirAtiva(t);
  if (txt(d.titulo).length < 3 || txt(d.texto).length < 5) throw new ErroRegra('Descreva sua dúvida (título e detalhes).');
  db.run('INSERT INTO duvidas (tutoria_id, aluno_id, conteudo_id, titulo, texto) VALUES (?, ?, ?, ?, ?)',
    t.id, aluno.id, Number(d.conteudo_id) || null, txt(d.titulo), txt(d.texto));
  notificar(t.tutor_id, { tipo: 'duvida', titulo: 'Nova dúvida de tutorado', texto: `${aluno.nome}: ${txt(d.titulo)}`, link: `/tutor/tutorias/${t.id}/duvidas` });
}

function responderDuvida(usuario, t, id, resposta) {
  exigirTutor(usuario, t);
  if (!txt(resposta)) throw new ErroRegra('Escreva a resposta.');
  const d = db.get('SELECT * FROM duvidas WHERE id = ? AND tutoria_id = ?', Number(id), t.id);
  if (!d) throw new ErroRegra('Dúvida não encontrada.');
  db.run('UPDATE duvidas SET resposta = ?, respondido_por = ?, respondido_em = ? WHERE id = ?', txt(resposta), usuario.id, db.agora(), d.id);
  notificar(d.aluno_id, { tipo: 'duvida', titulo: 'Sua dúvida foi respondida', texto: d.titulo, link: '/aluno/apoio' });
}

const duvidas = (tutoriaId, alunoId = null) =>
  db.all(
    `SELECT d.*, a.nome AS aluno_nome, c.nome AS conteudo_nome FROM duvidas d JOIN usuarios a ON a.id = d.aluno_id
       LEFT JOIN conteudos c ON c.id = d.conteudo_id WHERE d.tutoria_id = ? AND (? IS NULL OR d.aluno_id = ?)
      ORDER BY (d.resposta IS NULL) DESC, d.id DESC`,
    tutoriaId, alunoId, alunoId,
  );

// ---------------------------------------------- Chat 1:1 (RF2 / RU22)
/** A conversa é restrita ao tutor e ao tutorado envolvidos. */
function conversa(usuario, tutoriaId, alunoId) {
  const t = acesso.tutoria(tutoriaId);
  alunoId = Number(alunoId);
  if (!acesso.ehTutorado(alunoId, t.id)) throw new ErroAcesso();
  if (usuario.id !== t.tutor_id && usuario.id !== alunoId) throw new ErroAcesso('Esta conversa é privada entre tutor e tutorado.');
  const outro = usuario.id === alunoId ? { id: t.tutor_id, nome: t.tutor_nome } : db.get('SELECT id, nome FROM usuarios WHERE id = ?', alunoId);
  return { t, alunoId, outro };
}

function mensagens(c, usuario) {
  db.run('UPDATE mensagens SET lida_em = ? WHERE tutoria_id = ? AND aluno_id = ? AND autor_id <> ? AND lida_em IS NULL',
    db.agora(), c.t.id, c.alunoId, usuario.id);
  return db.all(
    `SELECT m.*, u.nome AS autor_nome, a.nome_original, a.mime FROM mensagens m JOIN usuarios u ON u.id = m.autor_id
       LEFT JOIN arquivos a ON a.id = m.arquivo_id WHERE m.tutoria_id = ? AND m.aluno_id = ? ORDER BY m.id DESC LIMIT 200`,
    c.t.id, c.alunoId,
  ).reverse();
}

function enviarMensagem(c, usuario, texto, arquivoId = null) {
  acesso.exigirAtiva(c.t);
  texto = txt(texto).slice(0, 4000);
  if (!texto && !arquivoId) throw new ErroRegra('Escreva uma mensagem.');
  const { id } = db.run('INSERT INTO mensagens (tutoria_id, aluno_id, autor_id, texto, arquivo_id) VALUES (?, ?, ?, ?, ?)',
    c.t.id, c.alunoId, usuario.id, texto || null, arquivoId);
  if (arquivoId) db.run('UPDATE arquivos SET ref_id = ? WHERE id = ?', id, arquivoId);
  const msg = db.get('SELECT m.*, u.nome AS autor_nome, a.nome_original FROM mensagens m JOIN usuarios u ON u.id = m.autor_id LEFT JOIN arquivos a ON a.id = m.arquivo_id WHERE m.id = ?', id);
  const sala = `${c.t.id}-${c.alunoId}`;
  tempoReal.enviar(c.outro.id, 'mensagem', { conversa: sala, mensagem: msg });
  tempoReal.enviar(usuario.id, 'mensagem', { conversa: sala, mensagem: msg });
  // RU17 / RU22 — informa a chegada de nova mensagem (sem duplicar a notificação a cada envio)
  const recente = db.get("SELECT 1 FROM notificacoes WHERE usuario_id = ? AND tipo = 'mensagem' AND link = ? AND lida = 0", c.outro.id, `/mensagens/${sala}`);
  if (!recente) notificar(c.outro.id, { tipo: 'mensagem', titulo: `Nova mensagem de ${usuario.nome}`, texto: texto.slice(0, 100), link: `/mensagens/${sala}` });
  return msg;
}

/** Lista de conversas do usuário (como tutor e/ou como tutorado). */
function conversas(usuario) {
  return db.all(
    `SELECT t.id AS tutoria_id, ta.aluno_id, s.nome AS sala_nome, t.status,
            CASE WHEN t.tutor_id = ? THEN a.nome ELSE tu.nome END AS outro_nome,
            CASE WHEN t.tutor_id = ? THEN 'tutorado' ELSE 'tutor' END AS papel_outro,
            (SELECT texto FROM mensagens m WHERE m.tutoria_id = t.id AND m.aluno_id = ta.aluno_id ORDER BY m.id DESC LIMIT 1) AS ultima,
            (SELECT criado_em FROM mensagens m WHERE m.tutoria_id = t.id AND m.aluno_id = ta.aluno_id ORDER BY m.id DESC LIMIT 1) AS ultima_em,
            (SELECT COUNT(*) FROM mensagens m WHERE m.tutoria_id = t.id AND m.aluno_id = ta.aluno_id AND m.autor_id <> ? AND m.lida_em IS NULL) AS nao_lidas
       FROM tutoria_alunos ta JOIN tutorias t ON t.id = ta.tutoria_id JOIN salas s ON s.id = t.sala_id
       JOIN usuarios a ON a.id = ta.aluno_id JOIN usuarios tu ON tu.id = t.tutor_id
      WHERE t.tutor_id = ? OR ta.aluno_id = ?
      ORDER BY ultima_em IS NULL, ultima_em DESC`,
    usuario.id, usuario.id, usuario.id, usuario.id, usuario.id,
  );
}

// ---------------------------------------- Alertas de prazo (RF / RNF7)
function verificarPrazos() {
  const limite = new Date(Date.now() + config.horasAlertaPrazo * 3600 * 1000).toISOString();
  const proximas = db.all('SELECT * FROM atividades WHERE prazo > ? AND prazo <= ?', db.agora(), limite);
  for (const a of proximas) {
    const alunos = a.tutoria_id
      ? db.all('SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?', a.tutoria_id)
      : db.all('SELECT aluno_id FROM sala_alunos WHERE sala_id = ?', a.sala_id);
    for (const { aluno_id: alunoId } of alunos) {
      if (db.get('SELECT 1 FROM entregas WHERE atividade_id = ? AND aluno_id = ?', a.id, alunoId)) continue;
      if (!db.run('INSERT OR IGNORE INTO alertas_prazo (atividade_id, aluno_id) VALUES (?, ?)', a.id, alunoId).changes) continue;
      notificar(alunoId, { tipo: 'prazo', titulo: 'Prazo se aproximando', texto: `"${a.titulo}" vence em menos de ${config.horasAlertaPrazo}h.`, link: `/atividades/${a.id}` });
    }
  }
}

module.exports = {
  registrar, registros, publicarMaterial, materiais, removerMaterial, comunicar, comunicadosDaTutoria, comunicadosDoAluno,
  perguntar, responderDuvida, duvidas, conversa, mensagens, enviarMensagem, conversas, verificarPrazos,
};
