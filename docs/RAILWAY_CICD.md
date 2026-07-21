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
| `DATABASE_URL` | Connection string DB production (bắt buộc) |
| `DIRECT_DATABASE_URL` | Optional — nếu không có thì CI dùng luôn `DATABASE_URL` |

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
