# Existing system integration gaps

Inspected only. Nothing in `railway-monitor`, the Flutter apps, or their databases was changed.

| Existing system | Requirement | Gap | Recommended future change |
| --- | --- | --- | --- |
| `railway-monitor` Sequelize schema | Kostra needs its own local PostgreSQL for the new shell | Kostra Prisma still holds the old SaaS tables. It does not contain zones, divisions, or lobbies. | Design Kostra's local schema later. Do not copy the production Sequelize schema into Prisma in this step. |
| `railway-monitor` `POST /api/auth/login` | The new app needs accounts | Kostra login is email and OTP against Prisma. RMO login is `user_id`, bcrypt, and a bearer token with no expiry. | Decide the auth cutover in a later review. Keep production auth unchanged. |
| `railway-monitor` roles `SUPER_ADMIN`, `DIVISION_ADMIN`, `MONITOR`, `USER` | Six target roles are documented | Kostra still stores `ADMIN` and `USER`. | Map roles when organization work starts. Do not alter the production enum. |
| `railway-monitor` users `division_id` | Home location and operational location are different | Production users have no `home_zone_id`, `home_division_id`, or `home_lobby_id`. | Add those only in a future non-production design. |
| `railway-monitor` divisions and lobbies | Zone, then division, then lobby | Production divisions have no `zone_id`. There is no zones table. | Add zones in a future Kostra design, not by migrating production. |
| `railway-monitor` `monitor_lobby_access` | Division monitors see every lobby in the division | Production monitors are limited to assigned lobbies. | Keep the production behavior until a product decision says otherwise. |
| Kostra `RMO_API_URL` proxy | Identity pages call `/api/identity/*` | Those routes are not part of the production API. | Remove or replace the proxy when the local schema exists. Do not add the routes to production. |
| Production PostgreSQL | Local development must be isolated | A developer `.env` could be pointed at a remote URL | Keep `POSTGRES_URL` on `127.0.0.1` and database `rmo_kostra_dev`. The seed and test setup refuse other database names. |
