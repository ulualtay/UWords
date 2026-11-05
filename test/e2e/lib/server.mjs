// Local test site: fixture pages, generated PDFs with various headers, and the built
// extension files (for the parser tests). Records requests so tests can inspect them.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// Sent with /csp.html: everything a page can forbid, it forbids.
const STRICT_CSP = "default-src 'none'; img-src 'none'; style-src 'none'; script-src 'none'; connect-src 'none'; font-src 'none'; frame-src 'none'; base-uri 'none'";

// A one-page PDF with real text, built by hand so no binary fixture is needed.
export function samplePdf(text = 'The quick brown fox jumps over the lazy dog') {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 840 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = body.length;
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const PDF_ROUTES = {
  '/pdf/inline.pdf': { 'Content-Type': 'application/pdf' },
  '/pdf/no-extension': { 'Content-Type': 'application/pdf; qs=0.001' },
  '/pdf/attachment.pdf': { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="attachment.pdf"' },
  '/pdf/generic.pdf': { 'Content-Type': 'application/octet-stream' },
  '/pdf/named': { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'inline; filename="named.pdf"' },
};

export async function startServer({ distDir }) {
  const requests = [];
  const pdf = samplePdf();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    requests.push({ path: url.pathname, search: url.search, method: req.method });
    const pdfHeaders = PDF_ROUTES[url.pathname];
    if (pdfHeaders) {
      res.writeHead(200, { ...pdfHeaders, 'Access-Control-Allow-Origin': '*' });
      res.end(pdf);
      return;
    }
    if (url.pathname === '/not-a-pdf') {
      // Mentions a .pdf file name but is an ordinary page: must not be redirected.
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Disposition': 'inline; filename="page.pdf"' });
      res.end('<!doctype html><title>Not a PDF</title><p id="marker">An ordinary page.</p>');
      return;
    }
    let file;
    if (url.pathname.startsWith('/built/')) {
      file = join(distDir, normalize(url.pathname.slice('/built/'.length)));
    } else {
      file = join(FIXTURES, normalize(url.pathname));
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' };
    if (url.pathname === '/csp.html') headers['Content-Security-Policy'] = STRICT_CSP;
    if (url.pathname === '/frame-csp.html') headers['Content-Security-Policy'] = "frame-src 'self'";
    res.writeHead(200, headers);
    res.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, requests, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
