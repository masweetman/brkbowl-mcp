# Agent guide

How an agent should use brkbowl-mcp together with anylist-mcp. The server also publishes this as an
MCP prompt called `fill_cart_from_list`, so Claude and VS Code show it as a ready-made command.

## Workflow

1. **Preferences.** If a skill, memory or earlier message does not already say, ask the user:
   - **Store:** call `list_stores`. Ask only if more than one store is available (today only
     West offers online shopping). The default is `west`.
   - **Produce:** organic or conventional. The default is conventional.
     Suggest saving the answers in a skill or memory so the user is not asked every time.
2. Get the unchecked items from the user's AnyList shopping list.
3. `auth_status`. If logged out: `login_start`, ask the user for the SMS code, `login_verify`.
4. `match_items` with the list items, the store and `producePreference`.
5. For each result:
   - `remembered`: the user confirmed this product before; add it.
   - `suggested`: one clear best match; add it.
   - `needsUserChoice`: show the candidates (name, price, unit) and ask which one. Also use this when
     `quantityNeedsUserChoice` is true, or a candidate has `preferenceMismatch`.
   - `noMatch`: tell the user; offer `search_products` with other words.
6. `remember_match` for every product the user picks (and for `suggested` ones they accept).
7. `add_to_cart` once with all chosen items, using each candidate's `suggestedCartQuantity`.
   Quantities are **added** to what is already in the cart.
8. `get_cart` and summarize: what was added, the estimated total, anything not matched.
9. **Never check out.** Tell the user to review the cart and place the order on the website.

## Things to know

- **Quantities.** Items sold by weight use pounds in steps (usually 0.5 lb). Some produce is bought
  by the piece but priced per pound (bananas, carrots); the server converts "2 lb" into pieces using the
  average weight. A list quantity like "3 onions" for an item sold by weight is a guess: the server flags it.
- **Organic words in the list** ("organic milk") override the produce preference for that item.
  The preference applies to produce only.
- **Prices of weighed items are estimates.** The final price is set at pickup.
- **Errors** are structured: `{ "error": { "code", "message", "hint" } }`.
  `AUTH_REQUIRED` means log in again (the hint says how). `STORE_UNAVAILABLE` lists valid stores.
- **Each store has its own cart.** Tools say which store they used.
- **`clear_cart`** needs `confirm: true`; only use it when the user asks.

## Example skill (for the user to adapt)

```markdown
---
name: berkeley-bowl-groceries
description: Fill my Berkeley Bowl cart from my AnyList shopping list.
---

- Store: west
- Produce: conventional (organic only when the list item says "organic")
- Run the fill_cart_from_list workflow. Ask me only about items that need a choice.
```
