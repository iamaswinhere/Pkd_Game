/**
 * Palakkad Open World RP - Static File & Real-Time WebSocket Multiplayer Server
 * Zero external npm dependencies required (uses native Node.js http, fs, crypto)
 * Syncs player positions, animations, custom outfits, and vehicle states in real time.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Load local .env file if present (keeps API tokens out of Git)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json'
};

// HTTP Server for serving static game files & runtime config
const server = http.createServer((req, res) => {
  const safeUrl = req.url.split('?')[0];

  if (safeUrl === '/api/config') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(
      JSON.stringify({
        mapboxToken: process.env.MAPBOX_TOKEN || ''
      })
    );
    return;
  }

  let filePath = path.join(PUBLIC_DIR, safeUrl === '/' ? 'index.html' : safeUrl);

  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// --- Native RFC 6455 WebSocket Multiplayer Server ---
const clients = new Map(); // id -> { socket, state }
const vehiclesState = {};  // vehicleId -> { x, y, z, rotY, driverId, speed }

function encodeWsFrame(dataObj) {
  const json = JSON.stringify(dataObj);
  const payload = Buffer.from(json, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const opcode = firstByte & 0x0f;
    const secondByte = buffer[offset + 1];
    const isMasked = Boolean(secondByte & 0x80);
    let payloadLen = secondByte & 0x7f;
    let headerLen = 2;

    if (opcode === 0x8) {
      // Close frame
      return { messages, closed: true, remaining: Buffer.alloc(0) };
    }

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }

    const maskLen = isMasked ? 4 : 0;
    const totalFrameLen = headerLen + maskLen + payloadLen;
    if (offset + totalFrameLen > buffer.length) break;

    const payload = Buffer.alloc(payloadLen);
    if (isMasked) {
      const maskOffset = offset + headerLen;
      const dataOffset = maskOffset + 4;
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buffer[dataOffset + i] ^ buffer[maskOffset + (i % 4)];
      }
    } else {
      buffer.copy(payload, 0, offset + headerLen, offset + totalFrameLen);
    }

    if (opcode === 0x1) {
      try {
        messages.push(JSON.parse(payload.toString('utf8')));
      } catch (e) {
        // Ignore malformed JSON
      }
    }

    offset += totalFrameLen;
  }

  return {
    messages,
    closed: false,
    remaining: buffer.slice(offset)
  };
}

function broadcast(dataObj, excludeId = null) {
  const frame = encodeWsFrame(dataObj);
  for (const [id, client] of clients.entries()) {
    if (id !== excludeId && !client.socket.destroyed) {
      try {
        client.socket.write(frame);
      } catch (e) {
        // Socket write error
      }
    }
  }
}

server.on('upgrade', (req, socket) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  const acceptKey = req.headers['sec-websocket-key'];
  if (!acceptKey) {
    socket.destroy();
    return;
  }

  const hash = crypto
    .createHash('sha1')
    .update(acceptKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${hash}`,
    '\r\n'
  ].join('\r\n');

  socket.write(responseHeaders);

  const playerId = 'p_' + crypto.randomBytes(4).toString('hex');
  const initialState = {
    id: playerId,
    name: 'Palakkadan_' + playerId.slice(2, 5).toUpperCase(),
    x: 0,
    y: 0,
    z: 18,
    rotY: 0,
    anim: 'idle',
    inVehicle: null,
    cash: 5000,
    customization: {
      shirtColor: '#2563eb',
      bottomType: 'jeans',
      bottomColor: '#1e3a8a',
      skinColor: '#c68642',
      sunglasses: true,
      hatColor: '#1d3557'
    }
  };

  clients.set(playerId, { socket, state: initialState });

  // Send welcome packet with existing players & vehicles
  const existingPlayers = {};
  for (const [id, c] of clients.entries()) {
    if (id !== playerId) existingPlayers[id] = c.state;
  }

  socket.write(
    encodeWsFrame({
      type: 'init',
      id: playerId,
      players: existingPlayers,
      vehicles: vehiclesState,
      onlineCount: clients.size
    })
  );

  // Notify others
  broadcast(
    {
      type: 'player_joined',
      player: initialState,
      onlineCount: clients.size
    },
    playerId
  );

  let recvBuffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    const { messages, closed, remaining } = decodeWsFrames(recvBuffer);
    recvBuffer = remaining;

    if (closed) {
      socket.end();
      return;
    }

    for (const msg of messages) {
      const client = clients.get(playerId);
      if (!client) continue;

      if (msg.type === 'state_update') {
        Object.assign(client.state, {
          x: msg.x ?? client.state.x,
          y: msg.y ?? client.state.y,
          z: msg.z ?? client.state.z,
          rotY: msg.rotY ?? client.state.rotY,
          anim: msg.anim ?? client.state.anim,
          inVehicle: msg.inVehicle ?? null,
          cash: msg.cash ?? client.state.cash
        });
        broadcast(
          {
            type: 'player_moved',
            id: playerId,
            x: client.state.x,
            y: client.state.y,
            z: client.state.z,
            rotY: client.state.rotY,
            anim: client.state.anim,
            inVehicle: client.state.inVehicle,
            cash: client.state.cash
          },
          playerId
        );
      } else if (msg.type === 'customize') {
        if (msg.name) client.state.name = String(msg.name).slice(0, 20);
        if (msg.customization) {
          client.state.customization = {
            ...client.state.customization,
            ...msg.customization
          };
        }
        broadcast(
          {
            type: 'player_customized',
            id: playerId,
            name: client.state.name,
            customization: client.state.customization
          },
          playerId
        );
      } else if (msg.type === 'vehicle_update') {
        if (msg.vehicleId) {
          vehiclesState[msg.vehicleId] = {
            x: msg.x,
            y: msg.y,
            z: msg.z,
            rotY: msg.rotY,
            driverId: msg.driverId,
            speed: msg.speed || 0,
            headlights: msg.headlights || false
          };
          broadcast(
            {
              type: 'vehicle_synced',
              vehicleId: msg.vehicleId,
              state: vehiclesState[msg.vehicleId]
            },
            playerId
          );
        }
      } else if (msg.type === 'horn') {
        broadcast(
          {
            type: 'player_horn',
            id: playerId,
            vehicleType: msg.vehicleType,
            x: msg.x,
            z: msg.z
          },
          playerId
        );
      } else if (msg.type === 'chat') {
        broadcast({
          type: 'chat_message',
          id: playerId,
          name: client.state.name,
          text: String(msg.text || '').slice(0, 140)
        });
      }
    }
  });

  const handleDisconnect = () => {
    if (clients.has(playerId)) {
      clients.delete(playerId);
      // Free any vehicles driven by this player
      for (const vId of Object.keys(vehiclesState)) {
        if (vehiclesState[vId].driverId === playerId) {
          vehiclesState[vId].driverId = null;
        }
      }
      broadcast({
        type: 'player_left',
        id: playerId,
        onlineCount: clients.size
      });
    }
  };

  socket.on('close', handleDisconnect);
  socket.on('error', handleDisconnect);
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🌴 PALAKKAD OPEN WORLD RP SERVER RUNNING!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
