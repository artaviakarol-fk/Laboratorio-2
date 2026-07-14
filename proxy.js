/* ===================================================================
   proxy.js
   Proxy CORS mínimo para el laboratorio #2. Soluciona un problema
   real de la API pública worldcup26.ir: sus rutas /auth/register y
   /auth/authenticate no traen los encabezados CORS necesarios, así
   que ningún navegador puede llamarlas directamente (se confirmó en
   DevTools: "blocked by CORS policy... preflight request").

   Este script corre en tu máquina (con Node, no en el navegador) y
   hace de intermediario: recibe la petición del navegador, se la
   reenvía a la API real (los servidores sí pueden hablarse entre sí
   sin restricción de CORS — esa regla solo la aplican los
   navegadores), y le agrega a la respuesta los encabezados CORS que
   le faltaban, antes de devolverla.

   Solo usa módulos nativos de Node (http/https), sin dependencias
   que instalar.

   Uso:
     node proxy.js
   Deja esta ventana abierta mientras usas la app (además de Live
   Server). La app ya está configurada para hablarle a este proxy
   (http://127.0.0.1:5501) en vez de directo a worldcup26.ir.
=================================================================== */

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
  // El navegador manda una petición OPTIONS "de prueba" (preflight)
  // antes del POST real, para preguntar si tiene permiso. Como la
  // API real no responde bien a esto, el proxy la contesta él mismo.
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
        // Algunas rutas de la API (las de /get/*) SÍ traen sus propios
        // encabezados CORS. Si los dejamos y además ponemos los
        // nuestros, el navegador ve dos "Access-Control-Allow-Origin"
        // duplicados y rechaza la respuesta entera. Quitamos los que
        // ya vengan antes de poner los nuestros.
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
