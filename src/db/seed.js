// Dados de demonstração. Uso: `npm run seed` (recria o banco do zero).
const fs = require('node:fs');
const config = require('../config');

const SENHA = 'Protutal2026';

const CONTEUDOS = [
  ['Cartografia e escalas', 'Cartografia'], ['Projeções cartográficas', 'Cartografia'], ['Sensoriamento remoto e SIG', 'Cartografia'],
  ['Estrutura geológica e relevo', 'Geografia física'], ['Climatologia', 'Geografia física'], ['Hidrografia', 'Geografia física'],
  ['Biomas e domínios morfoclimáticos', 'Geografia física'], ['Questões ambientais', 'Geografia física'],
  ['População e demografia', 'Geografia humana'], ['Urbanização', 'Geografia humana'], ['Espaço agrário', 'Geografia humana'],
  ['Industrialização', 'Geografia humana'], ['Fontes de energia', 'Geografia econômica'], ['Globalização e redes', 'Geografia econômica'],
  ['Geopolítica e conflitos', 'Geopolítica'], ['Regionalização do Brasil', 'Geografia do Brasil'],
];

function popular() {
  const bcrypt = require('bcryptjs');
  const db = require('./index');
  const hash = bcrypt.hashSync(SENHA, 10);
  const dia = 86400000;
  const em = (dias, hora = 12) => {
    const d = new Date(Date.now() + dias * dia);
    d.setUTCHours(hora + 3, 0, 0, 0);
    return d.toISOString();
  };
  const data = (dias) => em(dias).slice(0, 10);
  const ano = new Date().getFullYear();

  db.transacao(() => {
    for (const [nome, eixo] of CONTEUDOS) db.run('INSERT OR IGNORE INTO conteudos (nome, eixo) VALUES (?, ?)', nome, eixo);
    const c = Object.fromEntries(db.all('SELECT id, nome FROM conteudos').map((x) => [x.nome, x.id]));

    const usuario = (nome, email, papel) =>
      db.run('INSERT INTO usuarios (nome, email, senha_hash, papel, email_confirmado) VALUES (?, ?, ?, ?, 1)', nome, email, hash, papel).id;

    const ana = usuario('Ana Paula Souza', 'ana.souza@sesisp.org.br', 'professor');
    const carlos = usuario('Carlos Henrique Lima', 'carlos.lima@sesisp.org.br', 'professor');
    const nomes = ['Lucas Ferreira', 'Mariana Alves', 'João Pedro Santos', 'Beatriz Costa', 'Gabriel Oliveira', 'Larissa Martins',
      'Rafael Gomes', 'Isabela Rocha', 'Pedro Henrique Dias', 'Sofia Ribeiro', 'Matheus Carvalho', 'Yasmin Nunes'];
    const al = {};
    for (const n of nomes) {
      const login = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(' ');
      al[n.split(' ')[0]] = usuario(n, `${login[0]}.${login[login.length - 1]}@portalsesisp.org.br`, 'aluno');
    }

    // ---------------------------------------------------- Salas
    const sala = (nome, anoL, serie, prof, metas, objetivos) =>
      db.run('INSERT INTO salas (nome, ano_letivo, serie, professor_id, metas, objetivos, descricao) VALUES (?, ?, ?, ?, ?, ?, ?)',
        nome, anoL, serie, prof, metas, objetivos, 'Unidade curricular de Geografia').id;
    const s1 = sala('Geografia — 1º A', ano, 1, ana,
      'Todos os tutorados com média igual ou superior a 7,0 em Cartografia até o fim do 2º trimestre.',
      'Interpretar mapas, escalas e projeções; relacionar clima, relevo e vegetação; explicar em linguagem simples.');
    const s2 = sala('Geografia — 2º B', ano, 2, ana, 'Ampliar a participação nas atividades de Geografia Humana.', 'Compreender urbanização e demografia brasileira.');
    const sAnt = sala('Geografia — 1º A', ano - 1, 1, ana, 'Consolidar Cartografia.', 'Leitura de mapas.');
    sala('Geografia — 3º C', ano, 3, carlos, null, null);

    const matricular = (s, ...ids) => ids.forEach((id) => db.run('INSERT INTO sala_alunos (sala_id, aluno_id) VALUES (?, ?)', s, id));
    matricular(s1, al.João, al.Gabriel, al.Larissa, al.Rafael, al.Isabela, al.Sofia, al.Matheus);
    matricular(s2, al.Mariana, al.Pedro, al.Yasmin, al.Lucas);
    matricular(sAnt, al.João, al.Gabriel, al.Larissa); // RN19: mesmos cadastros no ano anterior

    [['Domínio do conteúdo', 'Explica e aplica os conceitos estudados', 4], ['Participação', 'Comparece e participa dos encontros', 3],
      ['Entrega das atividades', 'Cumpre os prazos combinados', 3]].forEach(([nome, desc, max], i) => {
      for (const s of [s1, s2, sAnt]) db.run('INSERT INTO sala_criterios (sala_id, nome, descricao, pontuacao_max, ordem) VALUES (?, ?, ?, ?, ?)', s, nome, desc, max, i);
    });

    // ------------------------------------------------- Tutorias
    const tutoria = (s, tutor, inicio, alunos, extra = {}) => {
      const id = db.run(`INSERT INTO tutorias (sala_id, tutor_id, data_inicio, status, data_fim, pode_criar_atividades, modelos_permitidos)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, s, tutor, inicio, extra.status || 'ativa', extra.fim || null,
      extra.pode ? 1 : 0, JSON.stringify(extra.modelos || [])).id;
      db.run('INSERT INTO tutoria_tutores_hist (tutoria_id, tutor_id, inicio, fim) VALUES (?, ?, ?, ?)', id, tutor, inicio, extra.fim || null);
      alunos.forEach((a) => db.run('INSERT INTO tutoria_alunos (tutoria_id, aluno_id) VALUES (?, ?)', id, a));
      (extra.conteudos || []).forEach((cid) => db.run('INSERT INTO tutoria_conteudos (tutoria_id, conteudo_id) VALUES (?, ?)', id, cid));
      return id;
    };
    // Lucas (2º ano) é tutor no 1º A; Mariana é tutora no 1º A e tutorada no 2º B (RN03)
    const tLucas = tutoria(s1, al.Lucas, `${ano}-02-20`, [al.João, al.Gabriel, al.Larissa], {
      pode: true, modelos: ['questionario_justificado', 'envio_arquivo'], conteudos: [c['Cartografia e escalas'], c['Climatologia']] });
    const tMariana = tutoria(s1, al.Mariana, `${ano}-02-20`, [al.Rafael, al.Isabela], { conteudos: [c['Cartografia e escalas']] });
    const tBeatriz = tutoria(s2, al.Beatriz, `${ano}-03-01`, [al.Mariana, al.Pedro, al.Yasmin], { conteudos: [c['Urbanização'], c['População e demografia']] });
    const tAnt = tutoria(sAnt, al.Beatriz, `${ano - 1}-03-01`, [al.João, al.Gabriel, al.Larissa], { status: 'finalizada', fim: `${ano - 1}-12-05`, conteudos: [c['Cartografia e escalas']] });

    // -------------------------------------------------- Atividades
    const atividade = (s, t, autor, titulo, tipo, modelo, conteudo, etapa, prazo, enunciado, questoes = []) => {
      const id = db.run(`INSERT INTO atividades (sala_id, tutoria_id, autor_id, titulo, enunciado, tipo, modelo, conteudo_id, etapa, valor, prazo, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 10, ?, ?)`, s, t, autor, titulo, enunciado, tipo, modelo, conteudo, etapa, prazo,
      new Date(new Date(prazo).getTime() - 10 * dia).toISOString()).id;
      questoes.forEach(([enun, alts, correta], i) => db.run(
        'INSERT INTO questoes (atividade_id, ordem, enunciado, alternativas, correta, exige_justificativa) VALUES (?, ?, ?, ?, ?, ?)',
        id, i + 1, enun, alts ? JSON.stringify(alts) : null, correta ?? null, modelo === 'questionario_justificado' ? 1 : 0));
      return id;
    };
    const qEscala = [
      ['Em um mapa de escala 1:50.000, 2 cm representam quantos metros no terreno?', ['100 m', '1.000 m', '10.000 m', '500 m'], 1],
      ['Qual escala apresenta MAIOR riqueza de detalhes?', ['1:1.000.000', '1:250.000', '1:10.000', '1:500.000'], 2],
    ];
    const qClima = [
      ['O clima predominante no litoral nordestino é:', ['Equatorial', 'Tropical úmido (litorâneo)', 'Semiárido', 'Subtropical'], 1],
      ['A maritimidade tende a:', ['Aumentar a amplitude térmica', 'Diminuir a amplitude térmica', 'Eliminar as chuvas', 'Não interferir'], 1],
    ];
    const a1 = atividade(s1, null, ana, 'Escalas cartográficas', 'exercicio', 'questionario_justificado', c['Cartografia e escalas'], 1, em(-190), 'Resolva as questões e justifique cada alternativa escolhida.', qEscala);
    const a2 = atividade(s1, null, ana, 'Aula invertida: tipos de clima', 'aula_invertida', 'questionario_justificado', c['Climatologia'], 2, em(-80), 'Assista ao vídeo indicado e responda às questões, justificando.', qClima);
    const a3 = atividade(s1, tLucas, al.Lucas, 'Foto do caderno: perfil topográfico', 'exercicio', 'envio_arquivo', c['Estrutura geológica e relevo'], 2, em(-60), 'Desenhe o perfil topográfico do mapa da página 42 e envie a foto do caderno.');
    const a4 = atividade(s1, null, ana, 'Prova alternativa: biomas brasileiros', 'prova_alternativa', 'dissertativa', c['Biomas e domínios morfoclimáticos'], 3, em(-3),
      'Responda com suas palavras.', [['Explique a relação entre o clima e a vegetação da Caatinga.'], ['Por que o Cerrado é chamado de "berço das águas"?']]);
    atividade(s1, null, ana, 'Simulado: hidrografia', 'simulado', 'multipla_escolha', c['Hidrografia'], 3, em(1, 20), 'Simulado preparatório. Boa prova!', [
      ['O maior rio totalmente brasileiro é o:', ['Amazonas', 'São Francisco', 'Paraná', 'Tocantins'], 1],
      ['Bacia hidrográfica é:', ['Um lago artificial', 'A área drenada por um rio e seus afluentes', 'O leito de um rio', 'Um aquífero'], 1]]);
    atividade(s1, tLucas, al.Lucas, 'Revisão: projeções cartográficas', 'exercicio', 'questionario_justificado', c['Projeções cartográficas'], 3, em(6), 'Revisão para a prova do trimestre.', [
      ['A projeção de Mercator preserva:', ['As áreas', 'Os ângulos (formas)', 'As distâncias', 'Nada'], 1]]);
    const b1 = atividade(s2, null, ana, 'Urbanização brasileira', 'exercicio', 'dissertativa', c['Urbanização'], 2, em(-70), 'Leia o capítulo 5 e responda.', [['Explique o que é metropolização.']]);
    const ant1 = atividade(sAnt, null, ana, 'Leitura de mapas (ano anterior)', 'exercicio', 'multipla_escolha', c['Cartografia e escalas'], 2, em(-420), 'Questões de leitura de mapas.', [
      ['A rosa dos ventos indica:', ['Escala', 'Orientação', 'Legenda', 'Título'], 1]]);

    // ------------------------------------------------------ Entregas
    const entregar = (atv, aluno, enviadoDias, respostas, nota, corretor, feedback, status = 'corrigida') => {
      const id = db.run(`INSERT INTO entregas (atividade_id, aluno_id, enviado_em, status, nota, feedback, corrigido_por, corrigido_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, atv, aluno, em(enviadoDias), status, status === 'corrigida' ? nota : null, feedback || null,
      status === 'corrigida' ? corretor : null, status === 'corrigida' ? em(enviadoDias + 2) : null).id;
      const qs = db.all('SELECT id FROM questoes WHERE atividade_id = ? ORDER BY ordem', atv);
      respostas.forEach(([alt, texto], i) => qs[i] && db.run('INSERT INTO respostas (entrega_id, questao_id, alternativa, texto) VALUES (?, ?, ?, ?)', id, qs[i].id, alt, texto));
      return id;
    };
    const just = 'Porque a escala indica quantas vezes o terreno foi reduzido no mapa.';
    entregar(a1, al.João, -192, [[1, just], [2, 'Escalas maiores mostram áreas menores com mais detalhes.']], 10, al.Lucas, 'Excelente! Justificativas claras.');
    entregar(a1, al.Gabriel, -191, [[0, 'Fiz a conta e deu 100.'], [2, 'Porque o número é menor.']], 5, al.Lucas, 'Reveja a conversão de cm para m.');
    const eLar1 = entregar(a1, al.Larissa, -193, [[1, just], [0, 'Porque é a maior escala.']], 6, al.Lucas, 'Cuidado: 1:1.000.000 é escala pequena.');
    entregar(a1, al.Rafael, -192, [[1, just], [2, 'Mais detalhe com denominador menor.']], 9, al.Mariana, 'Muito bem.');
    entregar(a1, al.Isabela, -191, [[1, 'Conta: 2 x 50.000 = 100.000 cm = 1.000 m.'], [2, 'Escala grande, mais detalhes.']], 10, al.Mariana, 'Perfeito!');
    entregar(a2, al.João, -82, [[1, 'Influência da massa de ar atlântica.'], [1, 'O mar aquece e esfria devagar.']], 9, al.Lucas, 'Ótimo raciocínio.');
    const eGab2 = entregar(a2, al.Gabriel, -81, [[1, 'Por causa da umidade do oceano.'], [0, 'Acho que aumenta.']], 6.5, al.Lucas, 'Revise maritimidade x continentalidade.');
    entregar(a2, al.Larissa, -83, [[1, 'Litoral recebe umidade do Atlântico.'], [1, 'A água regula a temperatura.']], 8, al.Lucas, 'Evoluiu bastante!');
    entregar(a2, al.Rafael, -81, [[2, 'Porque é seco.'], [1, 'Diminui.']], 5, al.Mariana, 'Semiárido é no interior, não no litoral.');
    entregar(a2, al.Isabela, -82, [[1, 'Ventos alísios trazem umidade.'], [1, 'Menor variação térmica.']], 9.5, al.Mariana, 'Excelente.');
    entregar(a3, al.João, -61, [], 8.5, al.Lucas, 'Perfil bem traçado.');
    entregar(a3, al.Larissa, -62, [], 7, al.Lucas, 'Faltou indicar a escala vertical.');
    entregar(a4, al.João, -4, [[null, 'A Caatinga tem chuvas escassas e irregulares, por isso a vegetação perde folhas na seca.'], [null, 'Porque nascem lá rios de várias bacias importantes.']], null, null, null, 'enviada');
    entregar(a4, al.Rafael, -4, [[null, 'O clima semiárido faz as plantas se adaptarem com espinhos.'], [null, 'Por causa das nascentes.']], null, null, null, 'enviada');
    entregar(b1, al.Mariana, -72, [[null, 'É a formação de grandes áreas urbanas integradas a uma metrópole.']], 9, al.Beatriz, 'Ótima definição.');
    entregar(b1, al.Pedro, -71, [[null, 'É quando a cidade cresce.']], 6, al.Beatriz, 'Aprofunde: fale da integração entre municípios.');
    entregar(b1, al.Yasmin, -71, [[null, 'Processo de concentração de pessoas e serviços nas metrópoles e no seu entorno.']], 8, al.Beatriz, 'Muito bom.');
    for (const [aluno, n] of [[al.João, 8], [al.Gabriel, 6], [al.Larissa, 7]]) entregar(ant1, aluno, -421, [[1, null]], n, ana, 'Corrigido pelo professor.');

    // Contestação aberta (bloqueia a finalização — RN15) e uma já respondida
    db.run('INSERT INTO contestacoes (entrega_id, aluno_id, justificativa, nota_anterior) VALUES (?, ?, ?, ?)', eGab2, al.Gabriel,
      'Na questão 2 eu justifiquei que o oceano regula a temperatura, acho que mereço meio ponto a mais.', 6.5);
    db.run(`INSERT INTO contestacoes (entrega_id, aluno_id, justificativa, nota_anterior, status, resposta, nota_nova, respondido_por, respondido_em)
      VALUES (?, ?, ?, 5.5, 'deferida', ?, 6, ?, ?)`, eLar1, al.Larissa, 'A primeira questão estava certa e foi descontada.', 'Você tem razão, corrigi.', al.Lucas, em(-185));

    // Comentários (RF12 / RF21)
    const q1 = db.get('SELECT id FROM questoes WHERE atividade_id = ? ORDER BY ordem LIMIT 1 OFFSET 1', a2).id;
    db.run('INSERT INTO comentarios (entrega_id, questao_id, autor_id, texto) VALUES (?, ?, ?, ?)', eGab2, q1, al.Lucas, 'Lembra do exemplo da praia x interior que vimos no encontro?');
    db.run('INSERT INTO comentarios (entrega_id, questao_id, autor_id, texto) VALUES (?, ?, ?, ?)', eGab2, q1, ana, 'Boa intervenção do tutor. Gabriel, releia a página 61.');

    // ------------------------------------------- Rubricas e avaliações
    const rubrica = (t, aluno, tutor, etapa, pontos, comentario, validado) => {
      const total = pontos.reduce((a, b) => a + b, 0);
      const id = db.run(`INSERT INTO rubricas (tutoria_id, aluno_id, tutor_id, etapa, nota, comentario, validacao_status, validado_por, validado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, t, aluno, tutor, etapa, total, comentario, validado ? 'validado' : 'pendente',
      validado ? ana : null, validado ? em(-150) : null).id;
      [['Domínio do conteúdo', 4], ['Participação', 3], ['Entrega das atividades', 3]].forEach(([nome, max], i) =>
        db.run('INSERT INTO rubrica_itens (rubrica_id, criterio_nome, pontuacao_max, pontos) VALUES (?, ?, ?, ?)', id, nome, max, pontos[i]));
    };
    rubrica(tLucas, al.João, al.Lucas, 1, [4, 3, 3], 'Muito comprometido, ajuda os colegas.', true);
    rubrica(tLucas, al.Gabriel, al.Lucas, 1, [2, 2, 3], 'Precisa revisar escalas, mas está sempre presente.', true);
    rubrica(tLucas, al.Larissa, al.Lucas, 1, [3, 3, 2], 'Boa evolução; atenção aos prazos.', true);
    rubrica(tLucas, al.João, al.Lucas, 2, [4, 3, 2.5], 'Segue ótimo.', false);
    rubrica(tLucas, al.Gabriel, al.Lucas, 2, [2.5, 3, 3], 'Melhorou a participação.', false);
    rubrica(tMariana, al.Rafael, al.Mariana, 1, [3, 2, 3], 'Bom, mas pode participar mais.', true);
    rubrica(tMariana, al.Isabela, al.Mariana, 1, [4, 3, 3], 'Excelente.', true);

    const avaliar = (t, tutor, avaliador, papel, etapa, nota, crit, comentario) =>
      db.run('INSERT INTO avaliacoes_tutor (tutoria_id, tutor_id, avaliador_id, avaliador_papel, etapa, criterios, nota, comentario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        t, tutor, avaliador, papel, etapa, JSON.stringify(crit || {}), nota, comentario);
    avaliar(tLucas, al.Lucas, al.João, 'aluno', 1, 9, { clareza: 5, dominio: 4, disponibilidade: 4, respeito: 5 });
    avaliar(tLucas, al.Lucas, al.Gabriel, 'aluno', 1, 8, { clareza: 4, dominio: 4, disponibilidade: 4, respeito: 4 });
    avaliar(tLucas, al.Lucas, al.Larissa, 'aluno', 2, 9.5, { clareza: 5, dominio: 5, disponibilidade: 4, respeito: 5 });
    avaliar(tLucas, al.Lucas, ana, 'professor', 1, 8.5, null, 'Registros completos e correções criteriosas.');
    avaliar(tMariana, al.Mariana, al.Rafael, 'aluno', 1, 7, { clareza: 3, dominio: 4, disponibilidade: 3, respeito: 4 });
    avaliar(tMariana, al.Mariana, ana, 'professor', 1, 7.5, null, 'Pode registrar melhor os encontros.');

    // Conteúdos registrados manualmente (RF27) e observações (RU9)
    db.run('INSERT INTO conteudos_aluno (aluno_id, sala_id, conteudo_id, situacao, registrado_por) VALUES (?, ?, ?, ?, ?)', al.João, s1, c['Projeções cartográficas'], 'dominado', al.Lucas);
    db.run('INSERT INTO conteudos_aluno (aluno_id, sala_id, conteudo_id, situacao, registrado_por) VALUES (?, ?, ?, ?, ?)', al.Gabriel, s1, c['Hidrografia'], 'treinar', al.Lucas);
    db.run('INSERT INTO observacoes (tutoria_id, aluno_id, autor_id, tipo, texto) VALUES (?, ?, ?, ?, ?)', tLucas, al.Gabriel, ana, 'dificuldade', 'Dificuldade com conversão de unidades nas escalas.');
    db.run('INSERT INTO observacoes (tutoria_id, aluno_id, autor_id, tipo, texto) VALUES (?, ?, ?, ?, ?)', tLucas, al.Larissa, ana, 'avanco', 'Melhorou muito a justificativa das respostas no 2º trimestre.');
    db.run('INSERT INTO observacoes (tutoria_id, aluno_id, autor_id, tipo, texto) VALUES (?, ?, ?, ?, ?)', tLucas, al.João, ana, 'potencialidade', 'Tem perfil para ser tutor no próximo ano.');

    // Registros de encontro (RU7 / RU11)
    const registro = (t, tutor, dias, conteudo, assuntos, estrategias, consideracoes, validado) =>
      db.run(`INSERT INTO registros (tutoria_id, tutor_id, data_encontro, conteudo_id, assuntos, estrategias, consideracoes, validacao_status, validado_por, validado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, t, tutor, data(dias), conteudo, assuntos, estrategias, consideracoes,
      validado ? 'validado' : 'pendente', validado ? ana : null, validado ? em(dias + 1) : null);
    registro(tLucas, al.Lucas, -200, c['Cartografia e escalas'], 'Conversão de escalas numéricas e gráficas.', 'Exemplos com o mapa do bairro; exercícios em dupla.', 'Gabriel teve dificuldade com cm → km.', true);
    registro(tLucas, al.Lucas, -90, c['Climatologia'], 'Fatores climáticos: latitude, altitude, maritimidade.', 'Comparação praia × interior; mapa mental.', 'Grupo engajado.', true);
    registro(tLucas, al.Lucas, -10, c['Biomas e domínios morfoclimáticos'], 'Revisão de biomas para a prova alternativa.', 'Quiz oral e resumo colaborativo.', 'Larissa faltou; enviei o material.', false);
    registro(tMariana, al.Mariana, -95, c['Cartografia e escalas'], 'Leitura de mapas topográficos.', 'Atividade prática com curvas de nível.', null, false);

    // Materiais, comunicados, dúvidas e avisos
    db.run('INSERT INTO materiais (tutoria_id, autor_id, titulo, descricao, link, conteudo_id) VALUES (?, ?, ?, ?, ?, ?)', tLucas, al.Lucas,
      'Videoaula: escalas cartográficas', 'Vídeo curto com exemplos resolvidos.', 'https://www.youtube.com/results?search_query=escala+cartografica', c['Cartografia e escalas']);
    db.run('INSERT INTO materiais (tutoria_id, autor_id, aluno_id, titulo, descricao, conteudo_id) VALUES (?, ?, ?, ?, ?, ?)', tLucas, al.Lucas, al.Gabriel,
      'Lista extra de conversão de unidades', 'Exercícios só para você treinar, Gabriel.', c['Cartografia e escalas']);
    const com = db.run('INSERT INTO comunicados (tutoria_id, autor_id, titulo, texto) VALUES (?, ?, ?, ?)', tLucas, al.Lucas,
      'Simulado amanhã!', 'Pessoal, o simulado de hidrografia vence amanhã à noite. Qualquer dúvida me chamem no chat.').id;
    [al.João, al.Gabriel, al.Larissa].forEach((a) => db.run('INSERT INTO comunicado_destinatarios (comunicado_id, aluno_id) VALUES (?, ?)', com, a));
    db.run('INSERT INTO duvidas (tutoria_id, aluno_id, conteudo_id, titulo, texto, resposta, respondido_por, respondido_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      tLucas, al.João, c['Projeções cartográficas'], 'Mercator distorce o quê?', 'Por que a Groenlândia parece tão grande?',
      'Porque Mercator preserva as formas (ângulos) mas distorce as áreas perto dos polos.', al.Lucas, em(-5));
    db.run('INSERT INTO duvidas (tutoria_id, aluno_id, conteudo_id, titulo, texto) VALUES (?, ?, ?, ?, ?)', tLucas, al.Gabriel, c['Hidrografia'],
      'Bacia x sub-bacia', 'Não entendi a diferença entre bacia e sub-bacia hidrográfica.');
    db.run('INSERT INTO avisos (sala_id, autor_id, titulo, texto, criado_em) VALUES (?, ?, ?, ?, ?)', s1, ana, 'Prova alternativa do 3º trimestre',
      'A prova alternativa sobre biomas já está disponível na plataforma. Os tutores vão revisar o conteúdo nos encontros desta semana.', em(-8));
    db.run('INSERT INTO avisos (sala_id, autor_id, titulo, texto, criado_em) VALUES (?, ?, ?, ?, ?)', s1, ana, 'Bem-vindos à tutoria!',
      'Use o chat para falar com seu tutor e o espaço de dúvidas para perguntas sobre os conteúdos.', em(-220));

    // Chat 1:1
    const msg = (t, aluno, autor, texto, dias) => db.run('INSERT INTO mensagens (tutoria_id, aluno_id, autor_id, texto, criado_em, lida_em) VALUES (?, ?, ?, ?, ?, ?)',
      t, aluno, autor, texto, em(dias, 19), em(dias, 20));
    msg(tLucas, al.Gabriel, al.Gabriel, 'Oi Lucas! Pode me explicar de novo a conversão de escala?', -3);
    msg(tLucas, al.Gabriel, al.Lucas, 'Claro! Pensa assim: 1:50.000 quer dizer que 1 cm no mapa = 50.000 cm no real = 500 m.', -3);
    msg(tLucas, al.Gabriel, al.Gabriel, 'Ahh, agora entendi. Valeu!', -3);
    msg(tLucas, al.João, al.João, 'Lucas, já enviei a prova alternativa.', -4);

    // Pedido de tutoria pendente (RF17) e notificações iniciais
    db.run('INSERT INTO pedidos_tutoria (aluno_id, professor_id, mensagem) VALUES (?, ?, ?)', al.Sofia, ana, 'Gosto muito de Geografia e quero ajudar meus colegas.');
    db.run('INSERT INTO pedidos_tutoria (aluno_id, professor_id, mensagem, status, sala_id, decidido_em) VALUES (?, ?, ?, ?, ?, ?)', al.Lucas, ana, 'Quero ser tutor.', 'aceito', s1, em(-230));
    const notif = (u, tipo, titulo, texto, link) => db.run('INSERT INTO notificacoes (usuario_id, tipo, titulo, texto, link) VALUES (?, ?, ?, ?, ?)', u, tipo, titulo, texto, link);
    notif(ana, 'pedido', 'Novo pedido de tutoria', 'Sofia Ribeiro quer ser tutor(a).', '/professor/pedidos');
    notif(ana, 'contestacao', 'Nota contestada', 'Gabriel Oliveira — Aula invertida: tipos de clima', `/entregas/${eGab2}`);
    notif(al.Lucas, 'entrega', 'Nova entrega para corrigir', 'João Pedro Santos — Prova alternativa: biomas brasileiros', `/tutor/tutorias/${tLucas}`);
    notif(al.Gabriel, 'comentario', 'Novo comentário na sua atividade', 'Lucas Ferreira comentou em "Aula invertida: tipos de clima".', `/atividades/${a2}`);
  });

  console.log(`\nDados de demonstração criados. Senha de todas as contas: ${SENHA}`);
  console.log('  Professor: ana.souza@sesisp.org.br');
  console.log('  Tutor:     lucas.ferreira@portalsesisp.org.br  (também é aluno no 2º B)');
  console.log('  Aluno:     gabriel.oliveira@portalsesisp.org.br\n');
}

if (require.main === module) {
  for (const sufixo of ['', '-wal', '-shm']) fs.rmSync(config.caminhoBanco + sufixo, { force: true });
  popular();
}

module.exports = { popular, SENHA };
