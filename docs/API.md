# Homesome API notes

Berkeley Bowl's online store (`shop.berkeleybowl.com`) is a WordPress front end on the Homesome
platform. These notes describe the JSON API the website itself uses. They were verified with
`scripts/probe.ts` against a real account. Nothing here is official or guaranteed to be stable.

Base URL: `https://user-api.gethomesome.com`

## Headers

| Header                 | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| `apikey`               | Public site key embedded in every page of the website (not a secret)           |
| `location`             | Store ID, from `GET /locations` (`uniqueName`)                                 |
| `pricelist`            | Price list ID, the `online` entry in that store's `priceLists`                 |
| `Content-Type`         | `application/json`                                                             |
| `emailid`, `authtoken` | Logged-in calls only; from the login response (`user.email`, `user.authToken`) |

Any `User-Agent` is accepted; no browser-only checks were observed. A logged-out call to a
protected endpoint returns `401 {"message":"Unauthorized: Authentication required"}`.

## Endpoints

| Method and path                                                                                                               | Auth | Notes                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /locations`                                                                                                              | no   | `[{locName, uniqueName, address, priceLists:[{pListName, uniqueName, shoppingDisabled}]}]`. Currently one store: West.                                                              |
| `POST /v2/user/verification/send` `{phoneNumber, shouldCall, forLogin}`                                                       | no   | `phoneNumber` formatted `(xxx) xxx-xxxx`. Returns `{verificationInitiated, requiresSignup}`.                                                                                        |
| `POST /v2/user/verification/verify` `{code, phoneNumber}`                                                                     | no   | Returns `{verifiedAt, verificationCode, requiresSignup, user:{…}}`. See below.                                                                                                      |
| `GET /product/list?listType=ui`                                                                                               | no   | Whole catalog: `{products, healthClaims, promotions, …}`. ~32,000 products, ~26 MB, ~30 s.                                                                                          |
| `GET /product/search/autocomplete?phrase=`                                                                                    | no   | `{results:[{resultType:"ai_type"\|"product", displayName, name?, type?, score}]}`. Phrase suggestions mixed with products; the server searches a local copy of the catalog instead. |
| `GET /user/basket?lite=true`                                                                                                  | yes  | `{basketItems, unavailableBasketItems, basketSubTotal, basketTotal, tax, …}`                                                                                                        |
| `POST /user/basket` `{items:[{name, displayName, quantity, type, subType, organic, canReplace, instructions, isCustomItem}]}` | yes  | **Sets** the quantity of each line (does not add). Several lines per request work. Returns `{message:"Success"}`.                                                                   |
| `DELETE /user/basket?itemName=<product name>`                                                                                 | yes  | Removes a line.                                                                                                                                                                     |

## Login response

The verify response contains far more than a token: address, name, card brand and last four
digits, permissions. **The server stores only `user.authToken` and `user.email`** and never logs
or returns the rest. No refresh token or `x-access-token` header is used; the session is a single
long-lived `authToken`. The token's lifetime has not been measured yet.

## Catalog fields (per product)

`name` (the product ID used by the basket), `displayName`, `type` (category), `subType`, `price`,
`unit` (`count` or `lb`), `unitQuantity` (sometimes a string), `unitIncrement` (often null),
`sellByQty`, `avgWeight`, `organic`, `isInStock`, `minQuantity`, `maxQuantity`, `upc`, `brand`.

### Quantity rules observed

| Product                        | Example                            | Cart `quantity` means                                                     |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------- |
| `unit: count`                  | Medium Hass Avocados               | number of items                                                           |
| `unit: lb`, `sellByQty: true`  | Bananas (`avgWeight` 0.4)          | number of pieces; the price is per lb and estimated from `avgWeight`      |
| `unit: lb`, `sellByQty: false` | Russian Banana Fingerling Potatoes | pounds; step is `unitIncrement`, or 0.5 when null (the website's default) |

### Organic

The `organic` flag matches names starting "Organic" for nearly all produce. The server treats an
item as organic when the flag is true or the name contains the word "organic".

## Cart rules

- The cart belongs to the `location` header, so each store has its own cart.
- Posting a quantity replaces the existing one, so "add" means: read the cart, add, post.
