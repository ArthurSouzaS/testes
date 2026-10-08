// Percorre as telas de cada perfil e garante que todas renderizam (status 200).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { iniciar, Cliente, db } = require('./ajuda');

let ctx;
before(async () => { ctx = await iniciar(); });
after(() => ctx.servidor.close());

async function percorrer(cliente, rotas) {
  for (const rota of rotas) {
    const res = await cliente.req(rota);
    const corpo = await res.text();
    assert.strictEqual(res.status, 200, `${rota} respondeu ${res.status}: ${corpo.slice(0, 300)}`);
  }
}

test('login exige o perfil correto e protege áreas restritas', async () => {
  const c = new Cliente(ctx.base);
  assert.strictEqual((await c.req('/professor')).status, 302);
  const errado = await c.login('ana.souza@sesisp.org.br', 'aluno');
  assert.strictEqual(errado.status, 401);
  assert.match(await errado.text(), /conta é de professor/);
  const ok = await c.login('ana.souza@sesisp.org.br', 'professor');
  assert.strictEqual(ok.headers.get('location'), '/professor');
  await c.post('/logout', {}, '/professor');
  assert.strictEqual((await c.req('/professor')).status, 302);
});

test('telas do professor', async () => {
  const c = new Cliente(ctx.base);
  await c.login('ana.souza@sesisp.org.br', 'professor');
  const sala = db.get("SELECT id FROM salas WHERE nome LIKE '%1º A' ORDER BY ano_letivo DESC").id;
  const tutoria = db.get('SELECT id FROM tutorias WHERE sala_id = ? LIMIT 1', sala).id;
  const ativ = db.get('SELECT id FROM atividades WHERE sala_id = ? LIMIT 1', sala).id;
  const entrega = db.get('SELECT id FROM entregas WHERE atividade_id = ? LIMIT 1', ativ).id;
  const aluno = db.get('SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?', tutoria).aluno_id;
  const finalizada = db.get("SELECT id FROM tutorias WHERE status = 'finalizada'").id;
  await percorrer(c, [
    '/professor', '/professor?serie=1', '/professor/salas/nova', `/professor/salas/${sala}`, `/professor/salas/${sala}/editar`,
    `/professor/salas/${sala}/alunos`, `/professor/salas/${sala}/tutorias`, `/professor/salas/${sala}/atividades`,
    `/professor/salas/${sala}/atividades/nova`, `/professor/salas/${sala}/avisos`, `/professor/salas/${sala}/metas`,
    `/professor/salas/${sala}/desempenho`, `/professor/tutorias/${tutoria}`, `/professor/tutorias/${finalizada}`,
    `/professor/salas/${sala}/alunos/${aluno}`, `/atividades/${ativ}`, `/entregas/${entrega}`,
    '/professor/pedidos', '/professor/historico', '/notificacoes', '/perfil',
  ]);
  const xlsx = await c.req(`/professor/salas/${sala}/exportar.xlsx`);
  assert.strictEqual(xlsx.status, 200);
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
});

test('telas do tutor e do aluno', async () => {
  const tutor = new Cliente(ctx.base);
  await tutor.login('lucas.ferreira@portalsesisp.org.br', 'aluno');
  const t = db.get('SELECT t.id FROM tutorias t JOIN usuarios u ON u.id = t.tutor_id WHERE u.email LIKE ?', 'lucas%').id;
  const aluno = db.get('SELECT aluno_id FROM tutoria_alunos WHERE tutoria_id = ?', t).aluno_id;
  await percorrer(tutor, [
    '/tutor', '/tutor/desempenho', `/tutor/tutorias/${t}`, `/tutor/tutorias/${t}/atividades`, `/tutor/tutorias/${t}/atividades/nova`,
    `/tutor/tutorias/${t}/rubricas`, `/tutor/tutorias/${t}/registros`, `/tutor/tutorias/${t}/materiais`,
    `/tutor/tutorias/${t}/comunicados`, `/tutor/tutorias/${t}/duvidas`, `/tutor/tutorias/${t}/tutorados/${aluno}`,
    '/mensagens', `/mensagens/${t}-${aluno}`, '/aluno',
  ]);

  const a = new Cliente(ctx.base);
  await a.login('gabriel.oliveira@portalsesisp.org.br', 'aluno');
  const ativ = db.get('SELECT id FROM atividades WHERE tutoria_id IS NULL LIMIT 1').id;
  const gabriel = db.get("SELECT id FROM usuarios WHERE email LIKE 'gabriel%'").id;
  await percorrer(a, ['/aluno', '/aluno/atividades', '/aluno/atividades?filtro=pendentes', `/atividades/${ativ}`,
    '/aluno/apoio', '/aluno/avisos', '/aluno/avaliacoes', '/mensagens', `/mensagens/${t}-${gabriel}`, '/perfil', '/notificacoes']);
  // RU22 — a conversa de outro tutorado é privada
  assert.strictEqual((await a.req(`/mensagens/${t}-${aluno}`)).status, 403);
  // Área do tutor é bloqueada para quem não é tutor
  assert.strictEqual((await a.req(`/tutor/tutorias/${t}`)).status, 403);
  assert.strictEqual((await a.req('/professor')).status, 403);
});

test('telas públicas', async () => {
  const c = new Cliente(ctx.base);
  for (const r of ['/', '/?perfil=professor', '/cadastro', '/cadastro?perfil=professor', '/cadastro/enviado', '/confirmar/invalido', '/dev/emails']) {
    assert.strictEqual((await c.req(r)).status, 200, r);
  }
  assert.strictEqual((await c.req('/nao-existe')).status, 404);
});
