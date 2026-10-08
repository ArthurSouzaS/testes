// Testes das regras de negócio (RNs) diretamente nos serviços.
const { test } = require('node:test');
const assert = require('node:assert');
const { db } = require('./ajuda');
const acesso = require('../src/services/acesso');
const tutorias = require('../src/services/tutorias');
const atividades = require('../src/services/atividades');
const avaliacoes = require('../src/services/avaliacoes');
const usuarios = require('../src/services/usuarios');
const { isoParaLocal } = require('../src/lib/formato');

const u = (prefixo) => db.get('SELECT id, nome, papel FROM usuarios WHERE email LIKE ?', `${prefixo}%`);
const regra = (rn) => (e) => e.regra === rn;
const sala1A = () => acesso.sala(db.get("SELECT id FROM salas WHERE nome LIKE '%1º A' ORDER BY ano_letivo DESC").id);
const tutoriaDe = (prefixo) => acesso.tutoria(db.get('SELECT id FROM tutorias WHERE tutor_id = ? ORDER BY id DESC', u(prefixo).id).id);

test('RN20/RN22 — só domínios institucionais, separados por perfil', () => {
  assert.ok(usuarios.dominioPermitido('x@sesisp.org.br', 'professor'));
  assert.ok(usuarios.dominioPermitido('x@portalsesisp.org.br', 'aluno'));
  assert.ok(!usuarios.dominioPermitido('x@gmail.com', 'aluno'));
  assert.ok(!usuarios.dominioPermitido('x@portalsesisp.org.br', 'professor'));
});

test('RN21/RN22 — cadastro de tutor fica inativo e gera pedido pendente até confirmar o e-mail', async () => {
  const ana = u('ana.souza');
  const novo = await usuarios.cadastrar({ nome: 'Teste Tutor', email: 'teste.tutor@portalsesisp.org.br', senha: 'abc12345',
    confirmacao: 'abc12345', papel: 'aluno', querSerTutor: true, professorId: ana.id });
  assert.strictEqual(novo.papel, 'aluno');
  assert.ok((await usuarios.autenticar('teste.tutor@portalsesisp.org.br', 'abc12345', 'aluno')).naoConfirmado);
  assert.ok(!tutorias.pedidosPendentes(ana.id).some((p) => p.aluno_id === novo.id), 'pedido só aparece após confirmar');
  const { token } = db.get('SELECT token FROM tokens_email WHERE usuario_id = ?', novo.id);
  assert.ok(usuarios.confirmarEmail(token).ok);
  assert.ok(!usuarios.confirmarEmail(token).ok, 'token não pode ser reutilizado');
  assert.ok((await usuarios.autenticar('teste.tutor@portalsesisp.org.br', 'abc12345', 'aluno')).usuario);
  assert.ok(tutorias.pedidosPendentes(ana.id).some((p) => p.aluno_id === novo.id));
});

test('RN02 — tutorado não pode ser tutor na mesma sala', () => {
  assert.throws(() => tutorias.designarTutor(sala1A(), u('gabriel').id), regra('RN02'));
  const t = tutoriaDe('lucas');
  assert.throws(() => tutorias.vincularAluno(sala1A(), t, u('mariana').id)); // Mariana é tutora no 1º A
});

test('RN05 — um tutor por aluno na sala (vincular de novo transfere)', () => {
  const sala = sala1A();
  const tLucas = tutoriaDe('lucas');
  const tMariana = acesso.tutoria(db.get('SELECT id FROM tutorias WHERE tutor_id = ? AND sala_id = ?', u('mariana').id, sala.id).id);
  const rafael = u('rafael').id;
  assert.deepStrictEqual(tutorias.vincularAluno(sala, tLucas, rafael), { transferido: true });
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM tutoria_alunos ta JOIN tutorias t ON t.id = ta.tutoria_id WHERE t.sala_id = ? AND ta.aluno_id = ?', sala.id, rafael).n, 1);
  tutorias.vincularAluno(sala, tMariana, rafael); // devolve
});

test('RN08/RN09 — tutor só cria atividade com permissão e modelo autorizado', () => {
  const sala = sala1A();
  const prazo = isoParaLocal(new Date(Date.now() + 5 * 86400000).toISOString());
  const base = { titulo: 'Teste', enunciado: 'x', etapa: 3, valor: 10, prazo, questoes_json: '[]' };
  const tMariana = acesso.tutoria(db.get('SELECT id FROM tutorias WHERE tutor_id = ? AND sala_id = ?', u('mariana').id, sala.id).id);
  assert.throws(() => atividades.criar(u('mariana'), { sala, tutoria: tMariana }, { ...base, modelo: 'envio_arquivo' }), regra('RN08'));
  assert.throws(() => atividades.criar(u('lucas'), { sala, tutoria: tutoriaDe('lucas') }, { ...base, modelo: 'dissertativa' }), regra('RN09'));
  const id = atividades.criar(u('lucas'), { sala, tutoria: tutoriaDe('lucas') }, { ...base, modelo: 'envio_arquivo' });
  assert.ok(id > 0);
  // RF30 — só os tutorados de Lucas recebem
  const at = atividades.carregar(id);
  assert.ok(atividades.destinadaAo(u('joao').id, at));
  assert.ok(!atividades.destinadaAo(u('rafael').id, at));
});

test('RN10 — atividade do professor vale para toda a sala', () => {
  const sala = sala1A();
  const at = db.get('SELECT * FROM atividades WHERE sala_id = ? AND tutoria_id IS NULL LIMIT 1', sala.id);
  const alunos = db.all('SELECT aluno_id FROM sala_alunos WHERE sala_id = ?', sala.id).length;
  assert.strictEqual(atividades.destinatarios(at).length, alunos);
});

test('RN11 — só o tutor responsável preenche a rubrica', () => {
  const t = tutoriaDe('lucas');
  assert.throws(() => avaliacoes.salvarRubrica(u('mariana'), t, { aluno_id: u('joao').id, etapa: 3 }), regra('RN11'));
  const crit = db.all('SELECT id, pontuacao_max FROM sala_criterios WHERE sala_id = ?', t.sala_id);
  const campos = Object.fromEntries(crit.map((c) => [`c${c.id}`, c.pontuacao_max]));
  avaliacoes.salvarRubrica(u('lucas'), t, { aluno_id: u('joao').id, etapa: 3, ...campos });
  assert.strictEqual(db.get('SELECT nota FROM rubricas WHERE tutoria_id = ? AND aluno_id = ? AND etapa = 3', t.id, u('joao').id).nota, 10);
});

test('RN15 — finalização bloqueada com pendências; RN13/RN14/RN16/RN17 no ciclo', () => {
  const t = tutoriaDe('lucas');
  assert.throws(() => tutorias.finalizar(t), regra('RN15'));
  // Tutoria sem pendências finaliza e fica somente leitura
  const tM = acesso.tutoria(db.get('SELECT id FROM tutorias WHERE tutor_id = ? AND sala_id = ?', u('mariana').id, t.sala_id).id);
  db.run("UPDATE entregas SET status = 'corrigida', nota = 5 WHERE status = 'enviada' AND aluno_id IN (SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?)", tM.id);
  tutorias.finalizar(tM);
  const fin = acesso.tutoria(tM.id);
  assert.strictEqual(fin.status, 'finalizada');
  assert.throws(() => acesso.exigirAtiva(fin), regra('RN14'));
  tutorias.reabrir(fin); // mesmo ano letivo: permitido
  assert.strictEqual(acesso.tutoria(tM.id).status, 'ativa');
  const antiga = acesso.tutoria(db.get("SELECT id FROM tutorias WHERE status = 'finalizada'").id);
  assert.throws(() => tutorias.reabrir(antiga), regra('RN17'));
});

test('RN04 — revogação preserva o histórico e passa ao novo tutor', () => {
  const sala = acesso.sala(db.get("SELECT id FROM salas WHERE nome LIKE '%2º B'").id);
  const t = acesso.tutoria(db.get('SELECT id FROM tutorias WHERE sala_id = ?', sala.id).id);
  const antes = db.get('SELECT COUNT(*) n FROM tutoria_alunos WHERE tutoria_id = ?', t.id).n;
  tutorias.revogarTutor(t, u('sofia').id, 'Teste');
  const depois = acesso.tutoria(t.id);
  assert.strictEqual(depois.tutor_id, u('sofia').id);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM tutoria_alunos WHERE tutoria_id = ?', t.id).n, antes);
  assert.strictEqual(tutorias.historicoTutores(t.id).length, 2);
});

test('RNF8 — notas do aluno visíveis só para ele, seu tutor e o professor', () => {
  const sala = sala1A();
  const joao = u('joao').id;
  assert.ok(acesso.podeVerAluno(u('joao'), joao, sala.id));
  assert.ok(acesso.podeVerAluno(u('lucas'), joao, sala.id));
  assert.ok(acesso.podeVerAluno(u('ana.souza'), joao, sala.id));
  assert.ok(!acesso.podeVerAluno(u('gabriel'), joao, sala.id));
  assert.ok(!acesso.podeVerAluno(u('mariana'), joao, sala.id));
  assert.ok(!acesso.podeVerAluno(u('carlos'), joao, sala.id));
});
