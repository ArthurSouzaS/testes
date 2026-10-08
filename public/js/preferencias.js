// Aplica as preferências de acessibilidade antes da pintura da página (RNF13, RNF14, RNF15).
(function () {
  var raiz = document.documentElement;
  function ler(chave) { try { return localStorage.getItem('protutal.' + chave); } catch (e) { return null; } }
  var tema = ler('tema') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
  raiz.setAttribute('data-tema', tema);
  raiz.setAttribute('data-fonte', ler('fonte') || '0');
  if (ler('daltonico') === '1') raiz.setAttribute('data-daltonico', '1');
})();
