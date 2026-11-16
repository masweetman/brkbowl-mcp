const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function loginPage(opts: { requestId: string; clientName: string; error?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize brkbowl-mcp</title>
<style>
  body { font: 16px system-ui, sans-serif; background: #f5f5f5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { background: #fff; padding: 2rem; border-radius: 12px; width: min(92vw, 24rem); box-shadow: 0 2px 12px rgba(0,0,0,.1); }
  h1 { font-size: 1.2rem; margin-top: 0; }
  input, button { width: 100%; box-sizing: border-box; padding: .7rem; margin-top: .75rem; font-size: 1rem; }
  button { background: #06543e; color: #fff; border: 0; border-radius: 999px; cursor: pointer; }
  .error { color: #b00020; }
</style>
</head>
<body>
<main>
  <h1>Connect to Berkeley Bowl cart</h1>
  <p><strong>${escapeHtml(opts.clientName)}</strong> wants to use this server to read and change your Berkeley Bowl cart.</p>
  ${opts.error ? `<p class="error" role="alert">${escapeHtml(opts.error)}</p>` : ""}
  <form method="post" action="/oauth/login">
    <input type="hidden" name="request_id" value="${escapeHtml(opts.requestId)}">
    <label for="password">Admin password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Authorize</button>
  </form>
</main>
</body>
</html>`;
}
