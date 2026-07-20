# CI/CD Deploy AutomationGenVideo_BE (Docker Hub → Railway)

Railway chạy image **`viejhaf/automationgenvideo-be:latest`** (không build từ GitHub).

```text
push truqhieu (hoặc main)
  → GitHub Actions: docker build (linux/amd64) → push Docker Hub :latest + :sha
  → railway redeploy API  (kéo lại :latest)
```

> **Quan trọng:** nhánh `main` từng chậm `truqhieu` hàng trăm commit. Deploy production ưu tiên push/`workflow_dispatch` từ **`truqhieu`** (code đang chạy thật). Workflow file phải có trên nhánh được push.

## GitHub Secrets (bắt buộc)

| Secret | Giá trị |
|--------|---------|
| `RAILWAY_TOKEN` | Project Token (Railway → Project → Settings → Tokens) |
| `RAILWAY_SERVICE_API` | Service ID của automationgenvideo-be |
| `DOCKERHUB_USERNAME` | Username Docker Hub (vd `viejhaf`) |
| `DOCKERHUB_TOKEN` | Access Token Docker Hub (Account Settings → Security) |

## Workflows

| File | Khi chạy |
|------|----------|
| `ci.yml` | PR / push `main`,`truqhieu` — npm build + check `dist/src/main.js` |
| `deploy-railway.yml` | Push `main` hoặc **Actions → Deploy Railway → Run workflow** |

### Test thủ công
1. Actions → **Deploy Railway** → **Run workflow**
2. `skip_docker_push` = `false` (build + push + redeploy) hoặc `true` (chỉ redeploy Railway)

## Railway (không cần connect nhánh GitHub)

- Source Image: `viejhaf/automationgenvideo-be:latest`
- Start Command mặc định: `node dist/src/main` (theo Dockerfile)
- Port: `3000` (Nest listen `process.env.PORT || 3000`)
- Healthcheck (khuyến nghị): `/api`
- Env bắt buộc: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `AI_SERVICE_URL`, `JWT_SECRET`, … (xem `.env`)

## Khác biệt so với CQA_BE
- BE này chỉ có **1 service API** (không có worker riêng), nên workflow đã lược bỏ phần redeploy worker.
- Prisma dùng `DATABASE_URL` + `DIRECT_DATABASE_URL` (CQA dùng `DIRECT_URL`).
- Health check `/api` (global prefix `api`), build output `dist/src/main.js`.
