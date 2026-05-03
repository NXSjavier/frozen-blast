// worker.js - Cloudflare Worker para Frozen Blast Multijugador
// Maneja salas de hasta 4 jugadores con chat en tiempo real

// Almacenamiento en memoria de salas (se reinicia al redeployar el worker)
const rooms = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // Manejar WebSocket
    if (upgradeHeader === 'websocket') {
      const roomId = url.searchParams.get('room') || 'default';
      const userId = url.searchParams.get('user') || `user_${Date.now()}`;
      const userName = url.searchParams.get('name') || 'Jugador';

      // Crear sala si no existe
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          id: roomId,
          players: new Map(),
          chat: []
        });
      }

      const room = rooms.get(roomId);

      // Límite de 4 jugadores
      if (room.players.size >= 4) {
        return new Response('Sala llena (4/4)', { status: 403 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();

      // Guardar conexión del jugador
      room.players.set(userId, { ws: server, name: userName, id: userId });

      // Notificar a todos que se unió un jugador
      broadcast(room, {
        type: 'players',
        count: room.players.size,
        players: Array.from(room.players.values()).map(p => p.name)
      });

      // Enviar historial de chat al nuevo jugador
      room.chat.forEach(msg => server.send(JSON.stringify(msg)));

      // Manejar mensajes del cliente
      server.addEventListener('message', (e) => {
        try {
          const data = JSON.parse(e.data);
          data.user = userName;
          data.time = Date.now();

          if (data.type === 'chat') {
            room.chat.push(data);
            // Mantener solo los últimos 50 mensajes
            if (room.chat.length > 50) room.chat.shift();
            broadcast(room, data);
          }

          if (data.type === 'game_move') {
            // Reenviar movimientos del juego a los otros jugadores
            broadcast(room, data, userId);
          }

          if (data.type === 'start_game') {
            broadcast(room, { type: 'start', seed: Date.now().toString() });
          }
        } catch (err) {
          console.error('Error parsing message:', err);
        }
      });

      // Manejar desconexión
      server.addEventListener('close', () => {
        room.players.delete(userId);
        broadcast(room, {
          type: 'players',
          count: room.players.size,
          players: Array.from(room.players.values()).map(p => p.name)
        });
        // Limpiar sala vacía después de 5 minutos
        if (room.players.size === 0) {
          setTimeout(() => {
            if (rooms.get(roomId)?.players.size === 0) rooms.delete(roomId);
          }, 300000);
        }
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Respuesta HTTP para verificar que el worker está vivo
    if (url.pathname === '/') {
      return new Response('Frozen Blast Multiplayer Server Running 🎮', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};

// Enviar mensaje a todos los jugadores en la sala
function broadcast(room, data, excludeId = null) {
  const msg = JSON.stringify(data);
  room.players.forEach((player, id) => {
    if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
      try { player.ws.send(msg); } catch (e) {}
    }
  });
}
