export const dynamic = "force-dynamic";
export function GET() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Access denied</title>
<style>body{font-family:system-ui,sans-serif;background:#fef2f2;color:#7f1d1d;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #fecaca;border-radius:12px;padding:32px;max-width:420px;text-align:center}</style></head>
<body><div class="card"><h1>No internet access</h1>
<p>Your Student ID has been blocked from the network. Please contact the network administrator.</p>
</div></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}