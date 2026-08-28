import { createServer, type Server } from 'node:http';

import type { WeComAgentService } from './wecom-service.js';

export function startHealthServer(port: number, service: WeComAgentService): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    response.writeHead(service.isConnected ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      JSON.stringify({
        status: service.isConnected ? 'ok' : 'disconnected',
        activeTasks: service.activeTasks,
      }),
    );
  });
  server.listen(port, '127.0.0.1');
  return server;
}
