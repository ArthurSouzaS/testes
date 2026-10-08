// Protutal — comportamento da interface (sem dependências).
(function () {
  'use strict';
  var raiz = document.documentElement;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var csrf = ($('meta[name="csrf"]') || {}).content || ($('input[name="_csrf"]') || {}).value;
  function salvar(chave, valor) { try { localStorage.setItem('protutal.' + chave, valor); } catch (e) { /* modo privado */ } }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }

  // ---------------------------------------------- Acessibilidade (RNF13–15)
  function sincronizarBotoes() {
    $$('[data-alternar="tema"]').forEach(function (b) { b.setAttribute('aria-pressed', raiz.dataset.tema === 'escuro'); });
    $$('[data-alternar="daltonico"]').forEach(function (b) { b.setAttribute('aria-pressed', raiz.dataset.daltonico === '1'); });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.a11y-btn');
    if (!b) return;
    if (b.dataset.fonte) {
      var v = Math.max(-1, Math.min(2, Number(raiz.dataset.fonte || 0) + Number(b.dataset.fonte)));
      raiz.dataset.fonte = v; salvar('fonte', v);
    } else if (b.dataset.alternar === 'tema') {
      raiz.dataset.tema = raiz.dataset.tema === 'escuro' ? 'claro' : 'escuro'; salvar('tema', raiz.dataset.tema);
    } else if (b.dataset.alternar === 'daltonico') {
      if (raiz.dataset.daltonico === '1') { delete raiz.dataset.daltonico; salvar('daltonico', '0'); }
      else { raiz.dataset.daltonico = '1'; salvar('daltonico', '1'); }
    }
    sincronizarBotoes();
  });
  sincronizarBotoes();

  // ------------------------------------------------------- Menu mobile
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-abrir-menu]')) document.body.classList.toggle('menu-aberto');
    else if (e.target.closest('[data-fechar-menu]')) document.body.classList.remove('menu-aberto');
  });

  // --------------------------------------------- Pequenos comportamentos
  function ligar(escopo) {
    $$('[data-auto-enviar]', escopo).forEach(function (el) { el.addEventListener('change', function () { el.form.submit(); }); });
    $$('[data-mostrar]', escopo).forEach(function (el) {
      var alvo = $(el.dataset.mostrar);
      var atualizar = function () { if (alvo) alvo.hidden = !el.checked; };
      el.addEventListener('change', atualizar); atualizar();
    });
    $$('[data-mostrar-se]', escopo).forEach(function (el) {
      var alvo = $(el.dataset.alvo);
      var atualizar = function () { if (alvo) alvo.hidden = el.value !== el.dataset.mostrarSe; };
      el.addEventListener('change', atualizar); atualizar();
    });
  }
  document.addEventListener('submit', function (e) {
    var msg = e.target.dataset.confirmar;
    if (msg && !confirm(msg)) e.preventDefault();
  });
  ligar(document);

  // ------------------------------------------------------- Toasts
  function toast(titulo, texto, link) {
    var area = $('.toasts');
    if (!area) return;
    var el = document.createElement(link ? 'a' : 'div');
    el.className = 'toast';
    if (link) el.href = link;
    el.innerHTML = '<strong>' + esc(titulo) + '</strong>' + (texto ? '<span>' + esc(texto) + '</span>' : '');
    area.appendChild(el);
    setTimeout(function () { el.remove(); }, 7000);
  }

  // ------------------------------------- Tempo real via SSE (RNF7)
  var main = $('main[data-live]');
  var recarregando = false;
  function recarregarConteudo() {
    // Atualiza a página sem perder o que o usuário está digitando
    if (!main || recarregando) return;
    var ativo = document.activeElement;
    var editando = $$('main input:not([type=hidden]), main textarea, main select').some(function (c) {
      return (c.type === 'checkbox' || c.type === 'radio') ? c.checked !== c.defaultChecked : c.value !== c.defaultValue;
    });
    if (editando || (ativo && main.contains(ativo) && /INPUT|TEXTAREA|SELECT/.test(ativo.tagName)) || $('[data-chat]')) return;
    recarregando = true;
    fetch(location.href, { headers: { 'X-Requested-With': 'fetch' } }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var novo = doc.querySelector('main[data-live]');
      if (novo) { main.innerHTML = novo.innerHTML; ligar(main); construtor(); }
    }).finally(function () { recarregando = false; });
  }
  if (window.EventSource && $('.topo')) {
    var es = new EventSource('/eventos');
    es.addEventListener('notificacao', function (ev) {
      var n = JSON.parse(ev.data);
      $$('[data-contador]').forEach(function (c) { c.textContent = n.naoLidas; c.hidden = !n.naoLidas; });
      if (n.tipo !== 'mensagem' || !$('[data-chat]')) toast(n.titulo, n.texto, '/notificacoes/' + n.id + '/abrir');
      recarregarConteudo();
    });
    es.addEventListener('atualizacao', recarregarConteudo);
    es.addEventListener('mensagem', function (ev) { receberMensagem(JSON.parse(ev.data)); });
  }

  // --------------------------------------------------- Chat (RF2)
  var caixa = $('[data-chat]');
  function rolarChat() { if (caixa) caixa.scrollTop = caixa.scrollHeight; }
  function hora(iso) { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', ''); }
  function receberMensagem(d) {
    if (!caixa || caixa.dataset.chat !== d.conversa) {
      var link = $('[data-conversa-link="' + d.conversa + '"] .ultima');
      if (link) link.textContent = d.mensagem.texto || 'Arquivo';
      return;
    }
    if ($('[data-msg="' + d.mensagem.id + '"]', caixa)) return;
    var m = d.mensagem, minha = String(m.autor_id) === caixa.dataset.eu;
    var el = document.createElement('div');
    el.className = 'msg' + (minha ? ' minha' : '');
    el.dataset.msg = m.id;
    el.innerHTML = (m.texto ? '<p>' + esc(m.texto) + '</p>' : '') +
      (m.arquivo_id ? '<a href="/arquivos/' + m.arquivo_id + '" target="_blank" rel="noopener">📎 ' + esc(m.nome_original) + '</a>' : '') +
      '<time>' + hora(m.criado_em) + '</time>';
    caixa.appendChild(el);
    rolarChat();
  }
  rolarChat();
  var formChat = $('[data-chat-form]');
  if (formChat) {
    var anexo = $('[data-anexo]', formChat);
    if (anexo) anexo.addEventListener('change', function () { if (anexo.files.length) toast('Arquivo anexado', anexo.files[0].name + ' — clique em enviar.'); });
    formChat.addEventListener('submit', function (e) {
      e.preventDefault();
      var dados = new FormData(formChat);
      if (!String(dados.get('texto') || '').trim() && !(anexo && anexo.files.length)) return;
      var botao = $('button', formChat); botao.disabled = true;
      fetch(formChat.action, { method: 'POST', body: dados, headers: { Accept: 'application/json', 'X-CSRF-Token': csrf } })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.erro) return toast('Não foi possível enviar', r.erro);
          receberMensagem({ conversa: caixa.dataset.chat, mensagem: r.mensagem });
          formChat.reset();
        })
        .catch(function () { toast('Sem conexão', 'Tente novamente.'); })
        .finally(function () { botao.disabled = false; $('input[name="texto"]', formChat).focus(); });
    });
  }

  // ---------------------------------------- Login: troca de perfil sem recarregar
  $$('.login-cartao .segmento a').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      var perfil = a.dataset.perfil;
      $$('.login-cartao .segmento a').forEach(function (x) { x.classList.toggle('ativo', x === a); x.setAttribute('aria-selected', x === a); });
      $('[data-campo-perfil]').value = perfil;
      $('[data-link-cadastro]').href = '/cadastro?perfil=' + perfil;
      $('[data-dica-perfil]').textContent = perfil === 'aluno'
        ? 'Tutores também entram por aqui, com a conta de aluno.'
        : 'Acesso para docentes com e-mail institucional do SESI.';
      history.replaceState(null, '', '/?perfil=' + perfil);
    });
  });

  // ------------------------------- Construtor de atividades (RF11 / RF20)
  function construtor() {
    var form = $('[data-construtor]');
    if (!form || form.dataset.pronto) return;
    form.dataset.pronto = '1';
    var sel = $('[data-modelo]', form), lista = $('[data-questoes]', form), bloco = $('[data-questoes-bloco]', form);
    var json = $('[data-questoes-json]', form), tpl = $('#tpl-questao'), descricao = $('[data-modelo-descricao]', form);
    var descricoes = {
      questionario_justificado: 'Múltipla escolha com justificativa obrigatória em todos os itens.',
      multipla_escolha: 'Questões objetivas tradicionais.',
      dissertativa: 'Questões abertas respondidas por escrito.',
      envio_arquivo: 'O aluno envia um arquivo (foto do caderno, PDF…). Sem questões.'
    };
    function opcao() { return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].dataset : {}; }
    function renumerar() { $$('.questao-edit', lista).forEach(function (q, i) { $('[data-num]', q).textContent = 'Questão ' + (i + 1); }); }
    function addAlt(q, texto, correta) {
      var idx = $$('.alt-linha', q).length;
      var linha = document.createElement('div');
      linha.className = 'alt-linha';
      linha.innerHTML = '<input type="radio" title="Alternativa correta" aria-label="Marcar como correta"><input type="text" placeholder="Alternativa ' +
        String.fromCharCode(97 + idx) + '"><button type="button" class="botao link perigo pequeno" aria-label="Remover alternativa">✕</button>';
      var radio = linha.children[0];
      radio.name = 'correta-' + q.dataset.id;
      radio.checked = !!correta;
      linha.children[1].value = texto || '';
      linha.children[2].onclick = function () { linha.remove(); };
      $('[data-lista-alts]', q).appendChild(linha);
    }
    var seq = 0;
    function addQuestao(dados) {
      dados = dados || {};
      var q = tpl.content.firstElementChild.cloneNode(true);
      q.dataset.id = ++seq;
      $('[data-enunciado]', q).value = dados.enunciado || '';
      $('[data-remover]', q).onclick = function () { q.remove(); renumerar(); };
      $('[data-add-alt]', q).onclick = function () { addAlt(q); };
      var alts = dados.alternativas || ['', '', '', ''];
      alts.forEach(function (a, i) { addAlt(q, a, dados.correta === i); });
      lista.appendChild(q);
      $('[data-alts]', q).hidden = opcao().alternativas !== '1';
      renumerar();
    }
    function aplicarModelo() {
      var o = opcao();
      bloco.hidden = o.semQuestoes === '1';
      $$('[data-alts]', lista).forEach(function (a) { a.hidden = o.alternativas !== '1'; });
      if (descricao) descricao.textContent = descricoes[sel.value] || '';
      if (!bloco.hidden && !$('.questao-edit', lista)) addQuestao();
    }
    $('[data-add-questao]', form).onclick = function () { addQuestao(); };
    sel.addEventListener('change', aplicarModelo);
    try { JSON.parse(json.value || '[]').forEach(addQuestao); } catch (e) { /* ignora rascunho inválido */ }
    aplicarModelo();
    form.addEventListener('submit', function () {
      var comAlts = opcao().alternativas === '1';
      json.value = JSON.stringify($$('.questao-edit', lista).map(function (q) {
        var linhas = $$('.alt-linha', q).filter(function (l) { return l.children[1].value.trim(); });
        var correta = linhas.findIndex(function (l) { return l.children[0].checked; });
        return {
          enunciado: $('[data-enunciado]', q).value,
          alternativas: comAlts ? linhas.map(function (l) { return l.children[1].value; }) : null,
          correta: comAlts && correta >= 0 ? correta : null
        };
      }));
    });
  }
  construtor();
})();
