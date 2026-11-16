# brkbowl-mcp

An unofficial, self-hosted [MCP](https://modelcontextprotocol.io) server that lets an AI agent
search the Berkeley Bowl online store and fill your cart. Pair it with
[anylist-mcp](https://github.com/bobby060/anylist-mcp): the agent reads your shopping list from
AnyList and adds the items to your Berkeley Bowl cart. **It never checks out.** You review the
cart and place the order yourself.

> Not affiliated with Berkeley Bowl or Homesome. It uses the same JSON API as the public website,
> for personal use only, at a low request rate. It can break if the website changes.

## What it does

- Logs in with your phone number and an SMS code (the agent asks you for the code). Only the
  session token and email are saved, encrypted, on the server.
- Searches the whole catalog locally (fast, no per-search requests) and matches shopping-list items
  to products, including pounds-to-pieces conversion for produce.
- Remembers the products you confirm, so repeat lists need few questions.
- Organic or conventional produce preference; store selection (currently West is the only store
  offering online shopping).
- Works with Claude (custom connector, OAuth) and VS Code Copilot.

## Tools

| Area     | Tools                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| Login    | `list_stores`, `auth_status`, `login_start`, `login_verify`, `logout`            |
| Catalog  | `search_products`, `get_product`, `refresh_catalog`                              |
| Matching | `match_items`, `remember_match`, `forget_match`, `list_matches`                  |
| Cart     | `get_cart`, `add_to_cart`, `set_cart_quantity`, `remove_from_cart`, `clear_cart` |

It also publishes the prompt `fill_cart_from_list`. See [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md).

## Setup

See [docs/DEPLOY.md](docs/DEPLOY.md): a Docker image with a persistent volume, a Cloudflare Tunnel
for public HTTPS, and connection steps for Claude and VS Code.

## Development

```sh
npm install                 # also enables the pre-commit secret checks (brew install gitleaks)
cp .env.example .env        # fill in SESSION_ENCRYPTION_KEY at least; .env is git-ignored
npm run typecheck && npm run lint && npm test
npm run stdio               # run over stdio for a local MCP client
npm run smoke               # live check against the real site (needs a saved login)
```

Requires Node 24 or newer (uses the built-in `node:sqlite`). API notes: [docs/API.md](docs/API.md).

## Privacy and security

This is a public repository: no personal data or secrets may be committed. Hooks and CI enforce it;
see [SECURITY.md](SECURITY.md). The server never returns or logs your token, email, phone number
or the rest of the login response (address, saved cards).

## License

MIT
