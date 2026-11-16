# Deploying brkbowl-mcp

The server runs as one container with a persistent volume. Claude on the web needs a public
HTTPS address, so the usual setup is a Cloudflare Tunnel in front of it, the same way anylist-mcp
is exposed. Everything below uses placeholders; put your real values only in Portainer or `.env`.

## 1. Generate secrets

```sh
# SESSION_ENCRYPTION_KEY: encrypts the saved Berkeley Bowl login
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# ADMIN_PASSWORD: what you type on the page Claude/VS Code open when connecting
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# MCP_BEARER_TOKEN (optional): a fixed token for VS Code or scripts
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Keep these in a password manager. Losing `SESSION_ENCRYPTION_KEY` only means logging in again.

## 2. Create the stack in Portainer

1. **Stacks → Add stack → Repository**, repository URL `https://github.com/masweetman/brkbowl-mcp`,
   compose path `docker-compose.yml`. (Or paste the file into the web editor.)
2. Add environment variables:

   | Variable                  | Value                                                        |
   | ------------------------- | ------------------------------------------------------------ |
   | `BASE_URL`                | The public HTTPS address, e.g. `https://brkbowl.example.com` |
   | `ADMIN_PASSWORD`          | From step 1                                                  |
   | `SESSION_ENCRYPTION_KEY`  | From step 1                                                  |
   | `MCP_BEARER_TOKEN`        | Optional, from step 1                                        |
   | `BB_PHONE`                | Optional: your login phone, e.g. `(555) 010-0000`            |
   | `CLOUDFLARE_TUNNEL_TOKEN` | Only with the tunnel profile                                 |

   Defaults: `DEFAULT_STORE=west`, `DEFAULT_PRODUCE_PREFERENCE=conventional`.

3. Deploy. The first start downloads the product catalog (about 30 seconds); the container is
   healthy as soon as `/healthz` answers.

## 3. Public address (Cloudflare Tunnel)

1. In Cloudflare Zero Trust, create a tunnel and copy its token into `CLOUDFLARE_TUNNEL_TOKEN`.
2. Add a public hostname (e.g. `brkbowl.example.com`) pointing to `http://brkbowl-mcp:3000`.
3. Enable the `tunnel` compose profile (in Portainer: add `COMPOSE_PROFILES=tunnel` to the
   stack's environment variables).
4. Do **not** put Cloudflare Access in front of this hostname: Claude's servers must reach `/mcp`
   and the OAuth endpoints directly. The server protects them itself (OAuth with your admin password
   or the bearer token). Everything else returns 401.

Check it: `curl https://brkbowl.example.com/healthz` returns `{"ok":true}`, and
`curl -i -X POST https://brkbowl.example.com/mcp` returns `401`.

## 4. Connect your clients

**Claude (web or desktop):** Settings → Connectors → Add custom connector →
`https://brkbowl.example.com/mcp`. Claude opens a page on your server; enter `ADMIN_PASSWORD`.

**VS Code Copilot** (`.vscode/mcp.json` or your user `mcp.json`), either with OAuth:

```json
{ "servers": { "brkbowl": { "type": "http", "url": "https://brkbowl.example.com/mcp" } } }
```

or with the bearer token:

```json
{
  "inputs": [
    {
      "id": "brkbowl-token",
      "type": "promptString",
      "description": "brkbowl-mcp token",
      "password": true
    }
  ],
  "servers": {
    "brkbowl": {
      "type": "http",
      "url": "https://brkbowl.example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:brkbowl-token}" }
    }
  }
}
```

Add your anylist-mcp server to the same client. The agent uses both. See
[AGENT-GUIDE.md](AGENT-GUIDE.md).

## 5. First login to Berkeley Bowl

Ask the agent to check `auth_status`. If it says you are logged out, it calls `login_start`,
asks you for the text-message code, and calls `login_verify`. The session lasts until Berkeley Bowl
expires it; when it does, the agent asks for a new code.

No SMS option: log in on the website, copy the `user` entry from the browser's localStorage, and run
`pbpaste | npm run import-session` against the same `DATA_DIR` and key.

## Updating, backup, troubleshooting

- **Update:** pull the new image (`BRKBOWL_VERSION` or `latest`) and redeploy. Data is in the `brkbowl_data` volume.
- **Backup:** the volume holds the encrypted session, remembered matches and OAuth clients. Matches are the only data worth backing up.
- **Reset OAuth:** delete the `oauth_*` rows or the volume; clients then reconnect.
- **Logs:** JSON on stdout/stderr; tokens, phone numbers and emails are masked.
- **Catalog looks stale:** call `refresh_catalog`; it also refreshes itself every `CATALOG_TTL_HOURS`.
