# brkbowl-mcp

An unofficial, self-hosted [MCP](https://modelcontextprotocol.io) server that lets an AI agent
search the Berkeley Bowl online store and fill your cart. Pair it with
[anylist-mcp](https://github.com/bobby060/anylist-mcp): the agent reads your shopping list from
AnyList and adds the items to your Berkeley Bowl cart. **It never checks out.** You review the
cart and place the order yourself.

> Status: under construction. Not affiliated with Berkeley Bowl or Homesome. It uses the same
> JSON API as the public website, for personal use only. Be considerate: requests are rate limited.

## What it does

- Log in with your phone number and an SMS code (the agent asks you for the code); the session is
  stored encrypted on the server.
- Search the catalog; match shopping-list items to products and remember your choices.
- View, add to, change and clear the cart.
- Works with Claude (custom connector, OAuth) and VS Code Copilot.

## Setup

See `docs/DEPLOY.md` (coming with the first release). In short: run the container with a persistent
volume, expose it over HTTPS (for example a Cloudflare Tunnel), and add it as an MCP server.

## Development

```sh
npm install        # also enables the pre-commit secret checks (needs: brew install gitleaks)
npm run typecheck && npm run lint && npm test
```

Requires Node 24 or newer.

## Privacy and security

This is a public repository: no personal data or secrets may be committed. See
[SECURITY.md](SECURITY.md).

## License

MIT
