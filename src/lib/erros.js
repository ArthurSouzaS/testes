// Erros de domínio. O tratador de erros do app converte cada um no status HTTP certo.

/** Violação de uma regra de negócio (RNxx) — a mensagem é exibida ao usuário. */
class ErroRegra extends Error {
  constructor(mensagem, regra) {
    super(mensagem);
    this.status = 422;
    this.regra = regra;
  }
}

class ErroAcesso extends Error {
  constructor(mensagem = 'Você não tem permissão para acessar este recurso.') {
    super(mensagem);
    this.status = 403;
  }
}

class NaoEncontrado extends Error {
  constructor(mensagem = 'Página ou registro não encontrado.') {
    super(mensagem);
    this.status = 404;
  }
}

module.exports = { ErroRegra, ErroAcesso, NaoEncontrado };
