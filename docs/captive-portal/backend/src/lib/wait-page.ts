function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export type WaitPageFields = {
  studentId: string;
  nama: string;
  kelas: string;
  mac: string;
  ip: string;
  target: string;
};

/** HTML page that polls /api/status and auto-submits login when student+device are ready. */
export function buildWaitingPage(fields: WaitPageFields): string {
  const { studentId, nama, kelas, mac, ip, target } = fields;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waiting for approval…</title>
<style>
body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#0f172a}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:480px;width:90%;text-align:center;box-shadow:0 10px 30px -10px rgba(0,0,0,.1)}
h1{font-size:20px;margin:0 0 12px}p{color:#475569;line-height:1.5;margin:0 0 12px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;margin:0 3px;animation:pulse 1.4s ease-in-out infinite}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
</style></head>
<body><div class="card">
<h1>Registration submitted</h1>
<p>Your registration is awaiting administrator approval.</p>
<p>This page will automatically connect you once approved.</p>
<p style="margin-top:16px"><span class="dot"></span><span class="dot"></span><span class="dot"></span></p>
<form id="f" method="POST" action="/api/login" style="display:none">
  <input name="studentId" value="${esc(studentId)}">
  <input name="nama" value="${esc(nama)}">
  <input name="kelas" value="${esc(kelas)}">
  <input name="mac" value="${esc(mac)}">
  <input name="ip" value="${esc(ip)}">
  <input name="target" value="${esc(target)}">
</form>
<script>
(function(){
  var mac=encodeURIComponent("${esc(mac)}");
  function check(){
    fetch("/api/status?mac="+mac,{cache:"no-store"})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d.ready){document.getElementById("f").submit();return;}
        if(d.studentStatus==="DENIED"){window.location.href="/api/denied";return;}
        setTimeout(check,4000);
      })
      .catch(function(){setTimeout(check,6000);});
  }
  setTimeout(check,4000);
})();
</script>
</div></body></html>`;
}
