
const http = require('http');
const https = require('https');

const TARGET_HOST = 'worldcup26.ir';
const TARGET_PORT = 443;
const LOCAL_PORT = 5501;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    forwardHeaders.host = TARGET_HOST;
    if (body.length) forwardHeaders['content-length'] = body.length;

    const upstreamReq = https.request(
      {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: req.url,
        method: req.method,
        headers: forwardHeaders,
      },
      (upstreamRes) => {
        const upstreamHeaders = { ...upstreamRes.headers };
        Object.keys(upstreamHeaders).forEach((key) => {
          if (key.toLowerCase().startsWith('access-control-')) {
            delete upstreamHeaders[key];
          }
        });

        res.writeHead(upstreamRes.statusCode, {
          ...upstreamHeaders,
          ...CORS_HEADERS,
        });
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on('error', (err) => {
      console.error('[proxy] Error contactando a la API real:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: 'proxy_upstream_error', message: err.message }));
    });

    if (body.length) upstreamReq.write(body);
    upstreamReq.end();
  });
});

server.listen(LOCAL_PORT, () => {
  console.log(`[proxy] Escuchando en http://127.0.0.1:${LOCAL_PORT}`);
  console.log(`[proxy] Reenviando todo hacia https://${TARGET_HOST}`);
  console.log('[proxy] Deja esta ventana abierta mientras uses la app.');
});
