# Fashion Store API

REST API backend for a fashion e-commerce store. Node.js 20 + Express 5 + PostgreSQL 16.

## Quick Start (Docker)

**Prerequisites:** Docker + Docker Compose

```bash
git clone <repo>
cd fashion-backend
cp .env.example .env.docker   # edit credentials
docker compose up --build
```

API available at http://localhost:3000

## Quick Start (Local)

**Prerequisites:** Node.js 20+, PostgreSQL 16

```bash
npm install
cp .env.example .env          # fill in real DB credentials
psql $DATABASE_URL -f schema.sql
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for access tokens (min 32 chars) |
| `JWT_REFRESH_SECRET` | ✅ | Secret for refresh tokens (min 32 chars) |
| `PORT` | — | Default: `3000` |
| `NODE_ENV` | — | `development` / `production` / `test` |
| `CORS_ORIGIN` | — | Allowed CORS origin, default `*` |

## Running Tests

```bash
npm test                                # all test files
npx vitest run tests/auth.test.js       # single file
npx vitest run --coverage               # with coverage report
```

## API Endpoints

### System
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (status, version, env) |
| GET | `/api/v1/ping` | Ping — returns `{ pong: true }` |

### Auth — rate limited (10 req / 15 min / IP)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | — | Register new customer |
| POST | `/api/v1/auth/login` | — | Login, returns access + refresh tokens |
| POST | `/api/v1/auth/refresh` | — | Exchange refresh token for new access token |
| POST | `/api/v1/auth/logout` | — | Invalidate refresh token |
| GET | `/api/v1/auth/me` | JWT | Get current user profile |
| PUT | `/api/v1/auth/me` | JWT | Update profile |

### Catalog
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/catalog/categories` | — | Category tree |
| GET | `/api/v1/catalog/products` | — | List products (filter / search / paginate) |
| GET | `/api/v1/catalog/products/:slug` | — | Product detail with variants |
| POST | `/api/v1/catalog/products` | Admin | Create product |
| PUT | `/api/v1/catalog/products/:id` | Admin | Update product |
| POST | `/api/v1/catalog/products/:id/variants` | Admin | Add variant |
| PATCH | `/api/v1/catalog/variants/:id/stock` | Admin | Adjust stock |

### Cart
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/cart` | Optional JWT | Get cart (guest or user) |
| POST | `/api/v1/cart/items` | Optional JWT | Add item to cart |
| PATCH | `/api/v1/cart/items/:id` | Optional JWT | Update item quantity |
| DELETE | `/api/v1/cart/items/:id` | Optional JWT | Remove item |
| DELETE | `/api/v1/cart` | Optional JWT | Clear cart |
| POST | `/api/v1/cart/merge` | JWT | Merge guest cart after login |

### Orders
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/orders` | JWT | Checkout — creates order from cart |
| GET | `/api/v1/orders` | JWT | List my orders (paginated) |
| GET | `/api/v1/orders/:id` | JWT | Order detail with items & payment |
| PATCH | `/api/v1/orders/:id/cancel` | JWT | Cancel a pending order |

### Admin
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/admin/orders` | Admin | All orders with user & payment info |
| PATCH | `/api/v1/admin/orders/:id/status` | Admin | Update order status |
| GET | `/api/v1/admin/stats` | Admin | Dashboard stats |

### Webhooks (no auth — signature verified in service)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/orders/webhooks/vnpay` | VNPay IPN callback |
| POST | `/api/v1/orders/webhooks/momo` | MoMo IPN callback |

## Response Format

**Success:**
```json
{ "data": <payload>, "meta": { "page": 1, "limit": 10, "total": 42 } }
```

**Error:**
```json
{ "error": "Human readable message", "code": "MACHINE_READABLE_CODE" }
```

**Common error codes:**

| Code | HTTP | Meaning |
|------|------|---------|
| `DUPLICATE_EMAIL` | 409 | Email already registered |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `INVALID_TOKEN` | 401 | JWT missing or expired |
| `NOT_FOUND` | 404 | Route not found |
| `ORDER_NOT_FOUND` | 404 | Order not found or not owned by user |
| `CANNOT_CANCEL` | 409 | Order is not in a cancellable state |
| `OUT_OF_STOCK` | 409 | One or more items exceed available stock |
| `INSUFFICIENT_STOCK` | 409 | Cart add exceeds current stock |
| `EMPTY_CART` | 400 | Cart is empty at checkout |
| `DUPLICATE_ENTRY` | 409 | Unique constraint violation |
| `INVALID_REFERENCE` | 400 | Foreign key violation |
| `INVALID_ID` | 400 | Malformed ID value |
| `RATE_LIMITED` | 429 | Too many requests |

## Rate Limiting

| Scope | Limit | Window |
|-------|-------|--------|
| All endpoints | 100 requests | 1 minute / IP |
| `/api/v1/auth/*` | 10 requests | 15 minutes / IP |

## Project Structure

```
src/
  config/         # DB pool, env validation
  middleware/     # auth, optional-auth, async-handler, error-handler, logger
  queries/        # SQL query functions (no ORM)
  routes/         # Express routers
  services/       # Business logic (order checkout, auth, payment stubs)
tests/            # Vitest + supertest integration tests
schema.sql        # PostgreSQL schema
Dockerfile
docker-compose.yml
```
