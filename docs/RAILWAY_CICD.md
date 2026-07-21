# CI/CD Deploy AutomationGenVideo_BE (Docker Hub → Railway)

Railway chạy image **`viejhaf/automationgenvideo-be:latest`** (không build từ GitHub).

```text
push main
  → GitHub Actions: docker build → push :latest
  → prisma migrate deploy  (apply bảng/cột mới trên DB production)
  → railway redeploy API
```

## GitHub Secrets (bắt buộc)

| Secret | Giá trị |
|--------|---------|
| `RAILWAY_TOKEN` | Project Token (Railway → Project → Settings → Tokens) |
| `RAILWAY_SERVICE_API` | Service ID của automationgenvideo-be |
| `DOCKERHUB_USERNAME` | Username Docker Hub (vd `viejhaf`) |
| `DOCKERHUB_TOKEN` | Access Token Docker Hub |
| `DATABASE_URL` | Connection string DB (có thể qua pooler) |
| `DIRECT_DATABASE_URL` | **Nên có** — URL **port 5432 trực tiếp**, không `pgbouncer=true`. Nếu thiếu mà `DATABASE_URL` là PgBouncer thì migrate sẽ treo/fail. |

### Migrate bị treo / cancel (~15 phút)?
Thường do:
1. Secret là URL **PgBouncer** → Prisma không lấy được advisory lock → treo. Fix: thêm `DIRECT_DATABASE_URL` port 5432.
2. DB chặn IP GitHub Actions → thêm allowlist `0.0.0.0/0` (hoặc chạy migrate từ máy/VPN có quyền).
3. Session khác đang giữ migration lock trên DB.


## Workflows

| File | Khi chạy |
|------|----------|
| `ci.yml` | PR / push — npm build |
| `deploy-railway.yml` | Push `main` hoặc **Actions → Deploy Railway → Run workflow** |

### Test thủ công
1. Actions → **Deploy Railway** → **Run workflow**
2. `skip_docker_push` / `skip_migrate` tùy nhu cầu

## Auto migrate
Job **Prisma migrate deploy** chạy **trước** redeploy:
- Chỉ apply folder chuẩn `prisma/migrations/<timestamp>_*/migration.sql`
- File `manual_*.sql` rời **không** tự chạy — phải tạo migration Prisma (`prisma migrate dev`) rồi commit

## Railway

- Source Image: `viejhaf/automationgenvideo-be:latest`
- Start Command: `node dist/main.js` (hoặc để mặc định Dockerfile)
- Env: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `AI_SERVICE_URL`, `JWT_SECRET`, …
