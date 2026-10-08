// RNF7 — atualização em tempo real via Server-Sent Events (sem dependências).
const conexoes = new Map(); // usuarioId -> Set<res>

function conectar(usuarioId, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');

  if (!conexoes.has(usuarioId)) conexoes.set(usuarioId, new Set());
  conexoes.get(usuarioId).add(res);

  const pulso = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(pulso);
    const set = conexoes.get(usuarioId);
    if (set) {
      set.delete(res);
      if (!set.size) conexoes.delete(usuarioId);
    }
  });
}

function enviar(usuarioId, evento, dados) {
  const set = conexoes.get(Number(usuarioId));
  if (!set) return;
  const msg = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const res of set) res.write(msg);
}

const online = (usuarioId) => conexoes.has(Number(usuarioId));

module.exports = { conectar, enviar, online };
