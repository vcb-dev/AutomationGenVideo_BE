# Gom Facebook app secret về BE — Kế hoạch thi công pha 1

> ## ⛔ KHÔNG THI CÔNG — dừng ngày 10/08/2026
>
> Spec gốc dựng trên giả định sai: token hệ thống hoá ra là loại **vĩnh viễn** (`expires_at = 0`,
> đo bằng `debug_token`), không phải loại 60 ngày. Phần lớn kế hoạch này — cron gia hạn, ngưỡng
> 7 ngày, cảnh báo Lark, `last_alert_at` — giải quyết một vấn đề không tồn tại.
>
> Lý do đầy đủ và rủi ro thật sự đáng xử lý: xem phần đầu của
> [2026-08-10-gom-facebook-app-secret-ve-be.md](2026-08-10-gom-facebook-app-secret-ve-be.md).
>
> **Giữ file lại chứ không xoá** vì hai thứ trong đây vẫn dùng được nếu sau này cần:
> Task 1 có mẫu chạy thử migration trong transaction rồi rollback, và Bước 3 của Task 5 sửa
> `AI_SERVICE_URL` mặc định từ cổng 8000 sang 8001 — lỗi thật, độc lập với phần còn lại.

> **Cho agent thi công:** SKILL BẮT BUỘC — dùng `subagent-driven-development` (khuyến nghị) hoặc `executing-plans` để làm từng task một. Các bước dùng cú pháp checkbox (`- [ ]`) để theo dõi.

**Mục tiêu:** BE tự giữ và tự gia hạn User Access Token của Facebook, truyền sang AI theo từng request, báo Lark khi token chết — mà không sửa một dòng nào ở repo AI.

**Kiến trúc:** Thêm bảng một dòng `facebook_system_account` trỏ tới `social_accounts` để chỉ định "tài khoản hệ thống". `FacebookSystemAccountService` đọc/đặt tài khoản đó và trả token đã giải mã. `FacebookSystemTokenService` gia hạn bằng `fb_exchange_token` và bắn Lark khi hỏng. Cron 05:30 chuyển từ gọi AI sang gọi service mới.

**Tech:** NestJS 10 · Prisma 5.8 · Jest 29 + ts-jest · axios · Facebook Graph API v21

Spec gốc: [2026-08-10-gom-facebook-app-secret-ve-be.md](2026-08-10-gom-facebook-app-secret-ve-be.md)

## Global Constraints

- **TUYỆT ĐỐI KHÔNG chạy `prisma db push`** — sẽ xoá ~60 bảng đang chứa dữ liệu thật.
- **KHÔNG chạy `prisma migrate dev`** — phát hiện lệch schema là đề nghị reset cả DB. Chỉ dùng `prisma migrate deploy`.
- `node` không có trong PATH. Mọi lệnh mở đầu bằng: `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`
- Thư mục làm việc: `/Users/macos/Documents/WorkSpace/VCBI-Dev/AutomationGenVideo_BE`
- Jest: `rootDir: src`, `testRegex: .*\.spec\.ts$` → file test **phải** đuôi `.spec.ts` và nằm trong `src/`.
- Định danh đặt **tiếng Anh**, chú thích viết **tiếng Việt**, chú thích giải thích **VÌ SAO**.
- **Kiểu cột đã đo trên DB thật (10/08/2026):** `social_accounts.id` = **text** · `users.id` = **uuid**. Khai lệch kiểu thì FK nổ mã 42804 `incompatible types`, và mẫu `DO $$ EXCEPTION WHEN duplicate_object` **không bắt được** lỗi đó.
- Migration phải là `prisma/migrations/<timestamp>_<tên>/migration.sql` — đúng tên `migration.sql`, sai tên là lỗi P3015 chặn toàn bộ migration xếp sau.
- Không khởi động lại tiến trình BE của người dùng khi chưa hỏi.
- Mỗi task kết thúc bằng một commit.
- **KHÔNG sửa gì trong repo `AutomationGenVideo_AI`.** Pha 1 chỉ đụng BE.

## Bản đồ file

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `prisma/schema.prisma` | Sửa | `model FacebookSystemAccount` + quan hệ ngược trên `model SocialAccount` |
| `prisma/migrations/20260810120000_add_facebook_system_account/migration.sql` | Tạo | `CREATE TABLE` + index + FK |
| `src/modules/facebook-owned-pages/facebook-system-account.service.ts` | Tạo | Đọc/đặt tài khoản hệ thống, trả token đã giải mã |
| `src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts` | Tạo | Test chức năng chỉ định tài khoản |
| `src/modules/social-publishing/accounts/accounts.controller.ts` | Sửa | Endpoint `PUT :id/facebook-system` |
| `src/modules/facebook-owned-pages/facebook-system-token.service.ts` | Tạo | Gia hạn token + bắn cảnh báo |
| `src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts` | Tạo | Test chức năng gia hạn |
| `src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts` | Tạo | Test chức năng cảnh báo Lark |
| `src/modules/facebook-owned-pages/facebook-owned-pages-cron.service.ts` | Sửa | Cron 05:30 gọi service mới |
| `src/modules/facebook-owned-pages/__tests__/facebook-owned-pages-cron.service.spec.ts` | Sửa | Viết lại theo service mới |
| `src/modules/facebook-owned-pages/facebook-ai-client.service.ts` | Sửa | Luôn kèm `user_access_token`; sửa cổng mặc định 8000 → 8001 |
| `src/modules/facebook-owned-pages/facebook-owned-pages.module.ts` | Sửa | Khai provider mới |

---

### Task 1: Bảng `facebook_system_account`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260810120000_add_facebook_system_account/migration.sql`

**Interfaces:**
- Consumes: không có (task đầu tiên)
- Produces: `prisma.facebookSystemAccount` với các trường `id`, `account_id`, `set_by`, `set_at`, `last_alert_at`

- [ ] **Bước 1: Thêm `model FacebookSystemAccount` vào `prisma/schema.prisma`**

Đặt ngay sau `model SocialAccount { ... }` (kết thúc ở dòng `@@map("social_accounts")`):

```prisma
/// Trỏ tới tài khoản Facebook được dùng làm "tài khoản hệ thống" cho các endpoint đồng bộ
/// bên AI. Bảng một dòng thay vì thêm cột vào social_accounts: bảng đó dùng chung cho mọi
/// nền tảng, nhét khái niệm riêng của Facebook vào rồi sẽ lan ra dần.
model FacebookSystemAccount {
  id String @id @default(uuid()) @db.Uuid

  /// KHÔNG kèm @db.Uuid: social_accounts.id khai `String @id @default(uuid())` không có
  /// @db.Uuid nên cột đó là TEXT trong DB (đã đo bằng information_schema). Đặt lệch kiểu
  /// thì FK nổ mã 42804 incompatible types.
  account_id String @unique

  /// Ai đặt — để tra khi có người hỏi "sao token lại là của tài khoản này". Cố ý KHÔNG đặt
  /// khoá ngoại sang users: chỉ dùng để tra ngược, mà thêm FK thì xoá user lại vướng.
  set_by  String   @db.Uuid
  set_at  DateTime @default(now())

  /// Lần cuối bắn cảnh báo Lark. Cron chạy hằng ngày; token chết một tháng mà không có cột
  /// này là ba mươi tin giống hệt — đọc vài hôm người ta tắt thông báo, đúng lúc cần nhất
  /// thì không ai nhìn.
  last_alert_at DateTime?

  account SocialAccount @relation(fields: [account_id], references: [id], onDelete: Cascade)

  @@map("facebook_system_account")
}
```

- [ ] **Bước 2: Thêm quan hệ ngược vào `model SocialAccount`**

Prisma bắt khai cả hai chiều. Thêm dòng này vào cụm quan hệ của `model SocialAccount`, ngay dưới dòng `posts             SocialPost[]`:

```prisma
  facebook_system   FacebookSystemAccount?
```

Đây là trường quan hệ ở tầng schema, **không sinh cột nào** trên bảng `social_accounts`.

- [ ] **Bước 3: Viết migration bằng tay**

```bash
mkdir -p prisma/migrations/20260810120000_add_facebook_system_account
```

Tạo `prisma/migrations/20260810120000_add_facebook_system_account/migration.sql`:

```sql
-- CreateTable: facebook_system_account
-- Kiểu cột đã đo trên DB thật: social_accounts.id = text, users.id = uuid.
CREATE TABLE "facebook_system_account" (
    "id"            UUID         NOT NULL,
    "account_id"    TEXT         NOT NULL,
    "set_by"        UUID         NOT NULL,
    "set_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_alert_at" TIMESTAMP(3),

    CONSTRAINT "facebook_system_account_pkey" PRIMARY KEY ("id")
);

-- Đúng MỘT tài khoản hệ thống tại một thời điểm.
CREATE UNIQUE INDEX "facebook_system_account_account_id_key" ON "facebook_system_account"("account_id");

-- Ngắt kết nối tài khoản thì chỉ định cũng đi theo, không để lại dòng trỏ vào hư không.
ALTER TABLE "facebook_system_account"
  ADD CONSTRAINT "facebook_system_account_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Bước 4: Chạy thử migration trong transaction rồi rollback**

Đây là kiểm chứng bằng SQL thật mà **không đổi DB**. Tạo `scratch/try-mig.js`:

```js
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const local = fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL="?([^"\n]+)/m)[1];
const raw = fs.readFileSync(process.argv[2], 'utf8');
const stmts = [];
let cur = '', inDollar = false;
for (const line of raw.split('\n')) {
  if (/^\s*--/.test(line) && !cur.trim()) continue;
  cur += line + '\n';
  if (((line.match(/\$\$/g) || []).length) % 2 === 1) inDollar = !inDollar;
  if (!inDollar && /;\s*$/.test(line)) { if (cur.trim()) stmts.push(cur.trim()); cur = ''; }
}
const p = new PrismaClient({ datasources: { db: { url: local } } });
(async () => {
  let bad = null;
  try {
    await p.$transaction(async (tx) => {
      for (const [i, s] of stmts.entries()) {
        try { await tx.$executeRawUnsafe(s); console.log(`  [${i + 1}] OK`); }
        catch (e) {
          bad = { code: (e.message.match(/Code: `(\w+)`/) || [])[1], msg: (e.message.match(/ERROR: ([^\n]+)/) || [])[1] };
          throw new Error('__STOP__');
        }
      }
      throw new Error('__ROLLBACK__');
    }, { timeout: 120000 });
  } catch (e) { /* rollback luôn xảy ra */ }
  console.log(bad ? `=> LỖI ${bad.code}: ${bad.msg}` : '=> CHẠY SẠCH. Đã rollback.');
  await p.$disconnect();
})();
```

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node scratch/try-mig.js \
  prisma/migrations/20260810120000_add_facebook_system_account/migration.sql
```

Kỳ vọng: `3/3 OK` rồi `=> CHẠY SẠCH. Đã rollback.`

Nếu ra lỗi **42804** thì kiểu cột khai sai — đọc lại Global Constraints, KHÔNG sửa bằng cách đổi FK sang kiểu khác mà phải khớp đúng kiểu cột đích.

- [ ] **Bước 5: Áp migration thật**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx prisma migrate deploy
```

Nếu output báo **drift** hoặc gợi ý `prisma migrate reset` — **DỪNG LẠI, báo người dùng.**

- [ ] **Bước 6: Sinh lại Prisma Client**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx prisma generate
```

- [ ] **Bước 7: Đọc DB xác nhận bảng có thật**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.\$queryRawUnsafe(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='facebook_system_account' ORDER BY ordinal_position\")
 .then(r=>{console.table(r);return p.\$disconnect()});
"
```

Kỳ vọng 5 cột: `id` uuid · `account_id` text · `set_by` uuid · `set_at` timestamp · `last_alert_at` timestamp.

- [ ] **Bước 8: Dọn script tạm và commit**

```bash
rm -f scratch/try-mig.js
git add prisma/schema.prisma prisma/migrations/20260810120000_add_facebook_system_account/
git commit -m "feat(facebook): thêm bảng facebook_system_account kèm migration"
```

---

### Task 2: `FacebookSystemAccountService` + endpoint chỉ định

**Files:**
- Create: `src/modules/facebook-owned-pages/facebook-system-account.service.ts`
- Test: `src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts`
- Modify: `src/modules/social-publishing/accounts/accounts.controller.ts`

**Interfaces:**
- Consumes: `prisma.facebookSystemAccount` (Task 1); `CryptoService` từ `src/modules/social-publishing/crypto/crypto.service` với `decrypt(ciphertext: string): string`
- Produces:
  - `class FacebookSystemAccountService` với:
    - `getSystemToken(): Promise<string | null>` — token đã giải mã, `null` nếu chưa chỉ định hoặc tài khoản không còn dùng được
    - `getSystemAccount(): Promise<{ id: string; access_token_enc: string; token_expires_at: Date | null } | null>`
    - `setSystemAccount(accountId: string, setBy: string): Promise<{ success: boolean }>`

- [ ] **Bước 1: Viết test — chạy để thấy nó ĐỎ**

Tạo `src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { FacebookSystemAccountService } from '../facebook-system-account.service';

const ACCOUNT_ACTIVE = {
  id: 'acc-1',
  platform: 'FACEBOOK',
  is_active: true,
  access_token_enc: 'enc:EAA_token',
  token_expires_at: new Date('2026-10-01T00:00:00Z'),
};

function buildPrisma(overrides: { systemRow?: any; account?: any } = {}) {
  const state = {
    systemRow: 'systemRow' in overrides ? overrides.systemRow : null,
    account: 'account' in overrides ? overrides.account : ACCOUNT_ACTIVE,
  };
  const prisma: any = {
    state,
    facebookSystemAccount: {
      findFirst: jest.fn(async () => state.systemRow),
      deleteMany: jest.fn(async () => { state.systemRow = null; return { count: 1 }; }),
      create: jest.fn(async ({ data }: any) => {
        state.systemRow = { id: 'sys-1', last_alert_at: null, ...data, account: state.account };
        return state.systemRow;
      }),
    },
    socialAccount: {
      findUnique: jest.fn(async () => state.account),
    },
  };
  return prisma;
}

function buildService(prisma: any) {
  const crypto = { decrypt: jest.fn((s: string) => s.replace(/^enc:/, '')) };
  return { service: new FacebookSystemAccountService(prisma, crypto as any), crypto };
}

describe('FacebookSystemAccountService.setSystemAccount', () => {
  it('chỉ định được tài khoản Facebook đang hoạt động', async () => {
    const prisma = buildPrisma();
    const { service } = buildService(prisma);

    await expect(service.setSystemAccount('acc-1', 'user-1')).resolves.toEqual({ success: true });
    expect(prisma.facebookSystemAccount.create).toHaveBeenCalled();
  });

  // Bảng chỉ được có ĐÚNG một dòng. Không xoá dòng cũ thì unique index trên account_id vẫn
  // cho phép hai tài khoản khác nhau cùng tồn tại — lúc đó không ai biết cái nào đang dùng.
  it('đổi tài khoản thì xoá chỉ định cũ trước', async () => {
    const prisma = buildPrisma({ systemRow: { id: 'sys-0', account_id: 'acc-cu' } });
    const { service } = buildService(prisma);

    await service.setSystemAccount('acc-1', 'user-1');

    expect(prisma.facebookSystemAccount.deleteMany).toHaveBeenCalled();
  });

  it('từ chối tài khoản không phải Facebook', async () => {
    const prisma = buildPrisma({ account: { ...ACCOUNT_ACTIVE, platform: 'TIKTOK' } });
    const { service } = buildService(prisma);

    await expect(service.setSystemAccount('acc-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('từ chối tài khoản đã bị vô hiệu hoá', async () => {
    const prisma = buildPrisma({ account: { ...ACCOUNT_ACTIVE, is_active: false } });
    const { service } = buildService(prisma);

    await expect(service.setSystemAccount('acc-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('từ chối tài khoản không tồn tại', async () => {
    const prisma = buildPrisma({ account: null });
    const { service } = buildService(prisma);

    await expect(service.setSystemAccount('khong-co-that', 'user-1')).rejects.toThrow(BadRequestException);
  });
});

describe('FacebookSystemAccountService.getSystemToken', () => {
  it('trả token đã giải mã', async () => {
    const prisma = buildPrisma({ systemRow: { id: 'sys-1', account_id: 'acc-1', account: ACCOUNT_ACTIVE } });
    const { service, crypto } = buildService(prisma);

    await expect(service.getSystemToken()).resolves.toBe('EAA_token');
    expect(crypto.decrypt).toHaveBeenCalledWith('enc:EAA_token');
  });

  // Chưa chỉ định KHÔNG phải lỗi — cron phải bỏ qua lượt chạy chứ không được nổ.
  it('trả null khi chưa chỉ định tài khoản nào', async () => {
    const prisma = buildPrisma({ systemRow: null });
    const { service } = buildService(prisma);

    await expect(service.getSystemToken()).resolves.toBeNull();
  });

  // Tài khoản bị ngắt kết nối sau khi đã chỉ định: token còn trong DB nhưng không dùng được nữa.
  it('trả null khi tài khoản đã bị vô hiệu hoá', async () => {
    const prisma = buildPrisma({
      systemRow: { id: 'sys-1', account_id: 'acc-1', account: { ...ACCOUNT_ACTIVE, is_active: false } },
    });
    const { service } = buildService(prisma);

    await expect(service.getSystemToken()).resolves.toBeNull();
  });
});
```

- [ ] **Bước 2: Chạy test để xác nhận nó ĐỎ**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx jest src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts
```

Kỳ vọng: FAIL — `Cannot find module '../facebook-system-account.service'`.

- [ ] **Bước 3: Tạo `src/modules/facebook-owned-pages/facebook-system-account.service.ts`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';

export interface SystemAccount {
  id: string;
  access_token_enc: string;
  token_expires_at: Date | null;
}

/**
 * Quản lý "tài khoản Facebook hệ thống" — tài khoản mà 9 endpoint đồng bộ bên AI mượn token
 * để gọi Graph API.
 *
 * Vì sao là bảng riêng chứ không phải cột trên social_accounts: bảng đó dùng chung cho mọi
 * nền tảng (TikTok, Threads, Zalo…), nhét một cột chỉ có nghĩa với Facebook vào rồi sẽ lan ra.
 */
@Injectable()
export class FacebookSystemAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async setSystemAccount(accountId: string, setBy: string): Promise<{ success: boolean }> {
    const account = await this.prisma.socialAccount.findUnique({ where: { id: accountId } });

    if (!account) {
      throw new BadRequestException('Không tìm thấy tài khoản social này');
    }
    if (account.platform !== 'FACEBOOK') {
      throw new BadRequestException('Chỉ tài khoản Facebook mới làm tài khoản hệ thống được');
    }
    if (!account.is_active) {
      throw new BadRequestException('Tài khoản đã bị ngắt kết nối — hãy kết nối lại trước');
    }

    // Xoá trước rồi tạo: bảng phải luôn có ĐÚNG một dòng. Unique index chỉ chặn trùng
    // account_id, không chặn hai tài khoản KHÁC nhau cùng nằm đó — lúc đó không ai biết
    // cái nào đang được dùng.
    await this.prisma.facebookSystemAccount.deleteMany({});
    await this.prisma.facebookSystemAccount.create({
      data: { account_id: accountId, set_by: setBy },
    });

    return { success: true };
  }

  async getSystemAccount(): Promise<SystemAccount | null> {
    const row = await this.prisma.facebookSystemAccount.findFirst({
      include: { account: true },
    });

    // Chưa chỉ định, hoặc tài khoản bị ngắt kết nối SAU khi đã chỉ định. Cả hai đều trả null
    // để nơi gọi bỏ qua lượt chạy chứ không nổ giữa cron.
    if (!row?.account || !row.account.is_active) return null;

    return {
      id: row.account.id,
      access_token_enc: row.account.access_token_enc,
      token_expires_at: row.account.token_expires_at,
    };
  }

  async getSystemToken(): Promise<string | null> {
    const account = await this.getSystemAccount();
    return account ? this.crypto.decrypt(account.access_token_enc) : null;
  }
}
```

- [ ] **Bước 4: Chạy test để xác nhận nó XANH**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx jest src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts
```

Kỳ vọng: PASS, 8 test.

- [ ] **Bước 5: Thêm endpoint chỉ định vào `accounts.controller.ts`**

Thêm import ở đầu file:

```ts
import { Put } from '@nestjs/common';
import { FacebookSystemAccountService } from '../../facebook-owned-pages/facebook-system-account.service';
```

Thêm tham số vào constructor của `AccountsController`:

```ts
    private readonly facebookSystemAccountService: FacebookSystemAccountService,
```

Thêm method này ngay sau method `setShared`:

```ts
  // Chỉ ADMIN: token của tài khoản này sẽ được dùng cho toàn bộ đồng bộ Facebook của hệ
  // thống, nên đặt nhầm là ảnh hưởng mọi người chứ không riêng người bấm.
  @Put(':id/facebook-system')
  @ApiOperation({ summary: 'Đặt tài khoản này làm tài khoản Facebook hệ thống (chỉ ADMIN)' })
  setFacebookSystem(@Param('id') id: string, @Request() req) {
    if (!(req.user.roles ?? []).includes('ADMIN')) {
      throw new ForbiddenException('Chỉ ADMIN mới đặt được tài khoản hệ thống');
    }
    return this.facebookSystemAccountService.setSystemAccount(id, req.user.id);
  }
```

Thêm `ForbiddenException` vào cụm import từ `@nestjs/common` ở dòng 1.

> Dùng kiểm tra role nội tuyến chứ không phải `@Roles` + `RolesGuard`: file này đang theo lối đó sẵn (xem method `disconnect` cùng file), trộn hai kiểu trong một controller khiến người đọc sau phải kiểm cả hai nơi mới biết ai vào được.

- [ ] **Bước 6: Xác minh biên dịch**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit
```

Kỳ vọng: không lỗi. Nếu báo thiếu provider thì để nguyên — Task 5 mới nối module.

- [ ] **Bước 7: Commit**

```bash
git add src/modules/facebook-owned-pages/facebook-system-account.service.ts \
        src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts \
        src/modules/social-publishing/accounts/accounts.controller.ts
git commit -m "feat(facebook): chỉ định tài khoản Facebook hệ thống, đọc token đã giải mã"
```

---

### Task 3: Gia hạn token — `FacebookSystemTokenService.refresh()`

**Files:**
- Create: `src/modules/facebook-owned-pages/facebook-system-token.service.ts`
- Test: `src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts`

**Interfaces:**
- Consumes: `FacebookSystemAccountService.getSystemAccount()` và `.getSystemToken()` (Task 2); `CryptoService.encrypt(plaintext: string): string`
- Produces:
  - `type RefreshStatus = 'ok' | 'refreshed' | 'invalid' | 'missing' | 'error'`
  - `interface RefreshResult { status: RefreshStatus; message: string; daysLeft?: number }`
  - `class FacebookSystemTokenService` với `refresh(): Promise<RefreshResult>`
  - `const RENEW_THRESHOLD_DAYS = 7`

- [ ] **Bước 1: Viết test — chạy để thấy nó ĐỎ**

Tạo `src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts`:

```ts
import axios from 'axios';
import { FacebookSystemTokenService } from '../facebook-system-token.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const NGAY_MS = 86_400_000;

function buildDeps(opts: { expiresAt?: Date | null; token?: string | null } = {}) {
  const account =
    opts.token === null
      ? null
      : {
          id: 'acc-1',
          access_token_enc: 'enc:EAA_cu',
          token_expires_at: 'expiresAt' in opts ? opts.expiresAt : new Date(Date.now() + 3 * NGAY_MS),
        };

  const accountService = {
    getSystemAccount: jest.fn(async () => account),
    getSystemToken: jest.fn(async () => (account ? 'EAA_cu' : null)),
  };
  const crypto = { encrypt: jest.fn((s: string) => `enc:${s}`) };
  const prisma = {
    socialAccount: { update: jest.fn(async () => ({})) },
    facebookSystemAccount: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const alerter = { alertTokenDead: jest.fn(async () => {}), clearAlert: jest.fn(async () => {}) };

  const service = new FacebookSystemTokenService(
    prisma as any,
    accountService as any,
    crypto as any,
    alerter as any,
  );
  return { service, accountService, crypto, prisma, alerter };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FB_APP_ID = 'app-id';
  process.env.FB_APP_SECRET = 'app-secret';
});

describe('FacebookSystemTokenService.refresh — không cần gọi Facebook', () => {
  it('chưa chỉ định tài khoản -> missing, KHÔNG gọi Graph', async () => {
    const { service } = buildDeps({ token: null });

    const kq = await service.refresh();

    expect(kq.status).toBe('missing');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  // Gọi Graph mỗi ngày trong khi token còn 50 ngày là đốt hạn mức API mà chẳng được gì.
  it('token còn xa hạn -> ok, KHÔNG gọi Graph', async () => {
    const { service } = buildDeps({ expiresAt: new Date(Date.now() + 30 * NGAY_MS) });

    const kq = await service.refresh();

    expect(kq.status).toBe('ok');
    expect(kq.daysLeft).toBe(30);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  // Chưa biết hạn thì phải thử đổi: đoán là "còn xa" rồi bỏ qua sẽ để token chết âm thầm.
  it('không biết hạn -> vẫn gọi Graph để đổi', async () => {
    const { service } = buildDeps({ expiresAt: null });
    mockedAxios.get.mockResolvedValue({ data: { access_token: 'EAA_moi', expires_in: 5_184_000 } });

    const kq = await service.refresh();

    expect(kq.status).toBe('refreshed');
    expect(mockedAxios.get).toHaveBeenCalled();
  });
});

describe('FacebookSystemTokenService.refresh — đổi token', () => {
  it('đổi được thì ghi đè token đã mã hoá và hạn mới', async () => {
    const { service, crypto, prisma } = buildDeps();
    mockedAxios.get.mockResolvedValue({ data: { access_token: 'EAA_moi', expires_in: 5_184_000 } });

    const kq = await service.refresh();

    expect(kq.status).toBe('refreshed');
    expect(crypto.encrypt).toHaveBeenCalledWith('EAA_moi');
    expect(prisma.socialAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc-1' },
        data: expect.objectContaining({ access_token_enc: 'enc:EAA_moi' }),
      }),
    );
  });

  it('gửi đúng cặp app của BE và token cũ làm đầu vào', async () => {
    const { service } = buildDeps();
    mockedAxios.get.mockResolvedValue({ data: { access_token: 'EAA_moi', expires_in: 5_184_000 } });

    await service.refresh();

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('/oauth/access_token'),
      expect.objectContaining({
        params: expect.objectContaining({
          grant_type: 'fb_exchange_token',
          client_id: 'app-id',
          client_secret: 'app-secret',
          fb_exchange_token: 'EAA_cu',
        }),
      }),
    );
  });
});

describe('FacebookSystemTokenService.refresh — khi hỏng', () => {
  // Facebook KHÔNG có refresh_token: fb_exchange_token đòi một token còn sống. Ghi đè token
  // cũ bằng rỗng là mất luôn manh mối để debug_token ra nguyên nhân, mà cũng chẳng cứu được gì.
  it('phản hồi thiếu access_token -> invalid và KHÔNG ghi đè token cũ', async () => {
    const { service, prisma } = buildDeps();
    mockedAxios.get.mockResolvedValue({ data: { error: { message: 'the user logged out', code: 190 } } });

    const kq = await service.refresh();

    expect(kq.status).toBe('invalid');
    expect(prisma.socialAccount.update).not.toHaveBeenCalled();
  });

  // Rớt mạng chưa nói lên điều gì về token — lượt sau thử lại là xong.
  it('lỗi mạng -> error chứ KHÔNG phải invalid', async () => {
    const { service, prisma } = buildDeps();
    mockedAxios.get.mockRejectedValue(new Error('connect ETIMEDOUT'));

    const kq = await service.refresh();

    expect(kq.status).toBe('error');
    expect(prisma.socialAccount.update).not.toHaveBeenCalled();
  });

  it('thiếu FB_APP_SECRET -> error, KHÔNG gọi Graph', async () => {
    delete process.env.FB_APP_SECRET;
    const { service } = buildDeps();

    const kq = await service.refresh();

    expect(kq.status).toBe('error');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
```

- [ ] **Bước 2: Chạy test để xác nhận nó ĐỎ**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx jest src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts
```

Kỳ vọng: FAIL — `Cannot find module '../facebook-system-token.service'`.

- [ ] **Bước 3: Tạo `src/modules/facebook-owned-pages/facebook-system-token.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';
import { FacebookSystemAccountService } from './facebook-system-account.service';
import { FacebookTokenAlertService } from './facebook-token-alert.service';

const GRAPH_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const NGAY_MS = 86_400_000;

/** Gia hạn khi còn <= ngưỡng này. Token long-lived sống 60 ngày, cron chạy mỗi ngày, nên
 *  7 ngày là thừa chỗ để hỏng vài lượt liên tiếp mà vẫn kịp cứu. */
export const RENEW_THRESHOLD_DAYS = 7;

export type RefreshStatus = 'ok' | 'refreshed' | 'invalid' | 'missing' | 'error';

export interface RefreshResult {
  status: RefreshStatus;
  message: string;
  daysLeft?: number;
}

/**
 * Gia hạn User Access Token của tài khoản Facebook hệ thống.
 *
 * Vì sao ở BE chứ không phải AI: đây là chỗ duy nhất có FB_APP_SECRET, và cũng là chỗ duy
 * nhất có DB để lưu bền. Bên AI từng giữ token trong file /app/.fb_token.json trên container
 * không gắn volume — mất sau mỗi lần deploy.
 */
@Injectable()
export class FacebookSystemTokenService {
  private readonly logger = new Logger(FacebookSystemTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: FacebookSystemAccountService,
    private readonly crypto: CryptoService,
    private readonly alerter: FacebookTokenAlertService,
  ) {}

  async refresh(): Promise<RefreshResult> {
    const account = await this.accountService.getSystemAccount();
    if (!account) {
      return { status: 'missing', message: 'Chưa chỉ định tài khoản Facebook hệ thống' };
    }

    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    if (!appId || !appSecret) {
      return { status: 'error', message: 'Thiếu FB_APP_ID / FB_APP_SECRET' };
    }

    // Còn xa hạn thì thôi: gọi Graph mỗi ngày trong khi token còn 50 ngày là đốt hạn mức API
    // mà chẳng được gì. Nhưng KHÔNG biết hạn thì vẫn phải thử — đoán "chắc còn xa" rồi bỏ qua
    // là để token chết âm thầm.
    if (account.token_expires_at) {
      const daysLeft = Math.floor((account.token_expires_at.getTime() - Date.now()) / NGAY_MS);
      if (daysLeft > RENEW_THRESHOLD_DAYS) {
        return { status: 'ok', message: `Token còn ${daysLeft} ngày, chưa cần gia hạn`, daysLeft };
      }
    }

    const oldToken = await this.accountService.getSystemToken();

    let data: any;
    try {
      const res = await axios.get(GRAPH_URL, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: oldToken,
        },
        timeout: 15_000,
      });
      data = res.data;
    } catch (err: any) {
      // Rớt mạng / 5xx chưa nói lên điều gì về token. Lượt sau thử lại.
      return { status: 'error', message: `Không gọi được Graph API: ${err?.message}` };
    }

    const newToken = data?.access_token;
    if (!newToken) {
      // KHÔNG ghi đè token cũ: giữ lại để còn debug_token ra nguyên nhân. Ghi đè bằng rỗng là
      // mất luôn manh mối, mà cũng chẳng cứu được gì.
      const err = data?.error?.message ?? 'không rõ nguyên nhân';
      await this.alerter.alertTokenDead(err);
      return { status: 'invalid', message: `Token không gia hạn được — cần đăng nhập lại: ${err}` };
    }

    const expiresIn = Number(data.expires_in) || 5_184_000;
    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        access_token_enc: this.crypto.encrypt(newToken),
        token_expires_at: new Date(Date.now() + expiresIn * 1000),
        updated_at: new Date(),
      },
    });
    await this.alerter.clearAlert();

    const days = Math.floor(expiresIn / 86_400);
    return { status: 'refreshed', message: `Đã gia hạn token, còn ${days} ngày`, daysLeft: days };
  }
}
```

- [ ] **Bước 4: Tạo tạm `FacebookTokenAlertService` rỗng để biên dịch được**

Task 4 mới viết phần ruột. Tạo `src/modules/facebook-owned-pages/facebook-token-alert.service.ts`:

```ts
import { Injectable } from '@nestjs/common';

/** Ruột được viết ở Task 4. Tách file từ đầu để FacebookSystemTokenService không phải sửa lại. */
@Injectable()
export class FacebookTokenAlertService {
  async alertTokenDead(_lyDo: string): Promise<void> {}
  async clearAlert(): Promise<void> {}
}
```

- [ ] **Bước 5: Chạy test để xác nhận nó XANH**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx jest src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts
```

Kỳ vọng: PASS, 8 test.

- [ ] **Bước 6: Commit**

```bash
git add src/modules/facebook-owned-pages/facebook-system-token.service.ts \
        src/modules/facebook-owned-pages/facebook-token-alert.service.ts \
        src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts
git commit -m "feat(facebook): BE tự gia hạn User Access Token bằng FB_APP_SECRET"
```

---

### Task 4: Cảnh báo Lark khi token chết

**Files:**
- Modify: `src/modules/facebook-owned-pages/facebook-token-alert.service.ts`
- Test: `src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts`

**Interfaces:**
- Consumes: `prisma.facebookSystemAccount` (Task 1); `LarkNotifyService.sendMessage(openId: string, noiDung: string): Promise<{ messageId: string }>` từ `src/modules/lark-sync/lark-notify.service`
- Produces: `class FacebookTokenAlertService` với `alertTokenDead(lyDo: string): Promise<void>` và `clearAlert(): Promise<void>`; `const ALERT_REPEAT_DAYS = 7`

- [ ] **Bước 1: Viết test — chạy để thấy nó ĐỎ**

Tạo `src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts`:

```ts
import { FacebookTokenAlertService } from '../facebook-token-alert.service';

const NGAY_MS = 86_400_000;

function buildDeps(lastAlertAt: Date | null) {
  const row = { id: 'sys-1', last_alert_at: lastAlertAt };
  const prisma = {
    facebookSystemAccount: {
      findFirst: jest.fn(async () => row),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const lark = { sendMessage: jest.fn(async () => ({ messageId: 'om_1' })) };
  const config = { get: jest.fn(() => 'ou_admin_1') };
  const service = new FacebookTokenAlertService(prisma as any, lark as any, config as any);
  return { service, prisma, lark, config };
}

describe('FacebookTokenAlertService.alertTokenDead', () => {
  it('lần đầu phát hiện token chết thì bắn Lark', async () => {
    const { service, lark, prisma } = buildDeps(null);

    await service.alertTokenDead('the user logged out');

    expect(lark.sendMessage).toHaveBeenCalledTimes(1);
    expect(lark.sendMessage.mock.calls[0][0]).toBe('ou_admin_1');
    expect(lark.sendMessage.mock.calls[0][1]).toContain('the user logged out');
    expect(prisma.facebookSystemAccount.updateMany).toHaveBeenCalled();
  });

  // Cron chạy hằng ngày. Token chết một tháng mà bắn mỗi ngày là ba mươi tin giống hệt —
  // đọc vài hôm người ta tắt thông báo, đúng lúc cần nhất thì không ai nhìn.
  it('vẫn hỏng trong vòng 7 ngày thì im lặng', async () => {
    const { service, lark } = buildDeps(new Date(Date.now() - 2 * NGAY_MS));

    await service.alertTokenDead('the user logged out');

    expect(lark.sendMessage).not.toHaveBeenCalled();
  });

  it('quá 7 ngày mà vẫn hỏng thì nhắc lại', async () => {
    const { service, lark } = buildDeps(new Date(Date.now() - 8 * NGAY_MS));

    await service.alertTokenDead('the user logged out');

    expect(lark.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('chưa cấu hình người nhận thì bỏ qua, KHÔNG nổ', async () => {
    const { service, lark, config } = buildDeps(null);
    config.get.mockReturnValue(undefined);

    await expect(service.alertTokenDead('lý do')).resolves.toBeUndefined();
    expect(lark.sendMessage).not.toHaveBeenCalled();
  });

  // Lark hỏng không được làm chết cron gia hạn — việc chính là gia hạn, báo tin là phụ.
  it('Lark hỏng thì nuốt lỗi', async () => {
    const { service, lark } = buildDeps(null);
    lark.sendMessage.mockRejectedValue(new Error('Lark 500'));

    await expect(service.alertTokenDead('lý do')).resolves.toBeUndefined();
  });
});

describe('FacebookTokenAlertService.clearAlert', () => {
  // Gia hạn lại được thì lần chết SAU phải báo ngay, không phải đợi hết 7 ngày im lặng.
  it('đặt lại last_alert_at về null', async () => {
    const { service, prisma } = buildDeps(new Date());

    await service.clearAlert();

    expect(prisma.facebookSystemAccount.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { last_alert_at: null } }),
    );
  });
});
```

- [ ] **Bước 2: Chạy test để xác nhận nó ĐỎ**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx jest src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts
```

Kỳ vọng: FAIL — constructor hiện chưa nhận tham số nào.

- [ ] **Bước 3: Viết ruột `facebook-token-alert.service.ts`**

Thay toàn bộ nội dung file bằng:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LarkNotifyService } from '../lark-sync/lark-notify.service';

const NGAY_MS = 86_400_000;

/** Vẫn hỏng thì nhắc lại sau ngần này ngày. */
export const ALERT_REPEAT_DAYS = 7;

/**
 * Báo Lark khi token Facebook hệ thống chết.
 *
 * Vì sao cần: Facebook KHÔNG có refresh_token — `fb_exchange_token` đòi một token còn sống
 * làm đầu vào. Token bị thu hồi hoặc user đăng xuất thì bắt buộc người thật đăng nhập lại,
 * không có đường vòng. Chỉ ghi logger.error thì không ai biết cho tới khi có người phát hiện
 * dữ liệu đã ngừng chảy nhiều ngày.
 */
@Injectable()
export class FacebookTokenAlertService {
  private readonly logger = new Logger(FacebookTokenAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lark: LarkNotifyService,
    private readonly configService: ConfigService,
  ) {}

  async alertTokenDead(lyDo: string): Promise<void> {
    const row = await this.prisma.facebookSystemAccount.findFirst();
    if (!row) return;

    if (row.last_alert_at) {
      const daysSince = (Date.now() - row.last_alert_at.getTime()) / NGAY_MS;
      if (daysSince < ALERT_REPEAT_DAYS) return;
    }

    const openId = this.configService.get<string>('LARK_NOTIFY_OPEN_ID');
    if (!openId) {
      this.logger.warn('[TOKEN] Token Facebook chết nhưng thiếu LARK_NOTIFY_OPEN_ID — không biết báo cho ai');
      return;
    }

    const feUrl = this.configService.get<string>('FE_URL') ?? '';
    const noiDung =
      `⚠️ Token Facebook hệ thống đã chết — đồng bộ page và video sẽ dừng.\n\n` +
      `Lý do: ${lyDo}\n\n` +
      `Facebook không tự gia hạn được nữa, cần vào kết nối lại tài khoản:\n` +
      `${feUrl}/dashboard/social/channels`;

    try {
      await this.lark.sendMessage(openId, noiDung);
    } catch (err: any) {
      // Lark hỏng không được làm chết cron gia hạn — việc chính là gia hạn, báo tin là phụ.
      this.logger.error(`[TOKEN] Không gửi được cảnh báo Lark: ${err?.message}`);
      return;
    }

    await this.prisma.facebookSystemAccount.updateMany({ data: { last_alert_at: new Date() } });
  }

  async clearAlert(): Promise<void> {
    // Gia hạn lại được thì lần chết SAU phải báo ngay, không phải đợi hết cửa sổ im lặng.
    await this.prisma.facebookSystemAccount.updateMany({ data: { last_alert_at: null } });
  }
}
```

- [ ] **Bước 4: Chạy test để xác nhận nó XANH**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx jest src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts
```

Kỳ vọng: PASS, 6 test.

- [ ] **Bước 5: Chạy lại test Task 3 để chắc không gãy**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx jest src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts
```

Kỳ vọng: vẫn PASS, 8 test.

- [ ] **Bước 6: Commit**

```bash
git add src/modules/facebook-owned-pages/facebook-token-alert.service.ts \
        src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts
git commit -m "feat(facebook): báo Lark khi token hệ thống chết, nhắc lại mỗi 7 ngày"
```

---

### Task 5: Nối vào cron và AI client

**Files:**
- Modify: `src/modules/facebook-owned-pages/facebook-owned-pages-cron.service.ts:16-36`
- Modify: `src/modules/facebook-owned-pages/__tests__/facebook-owned-pages-cron.service.spec.ts`
- Modify: `src/modules/facebook-owned-pages/facebook-ai-client.service.ts:48,57-64`
- Modify: `src/modules/facebook-owned-pages/facebook-owned-pages.module.ts`
- Modify: `src/modules/facebook-owned-pages/facebook-owned-pages.service.ts:34`

**Interfaces:**
- Consumes: `FacebookSystemTokenService.refresh()` (Task 3); `FacebookSystemAccountService.getSystemToken()` (Task 2)
- Produces: không có task nào sau

- [ ] **Bước 1: Đổi cron sang service mới**

Trong `facebook-owned-pages-cron.service.ts`, thêm import:

```ts
import { FacebookSystemTokenService } from './facebook-system-token.service';
```

Thêm tham số vào constructor (dòng 16):

```ts
    private readonly systemTokenService: FacebookSystemTokenService,
```

Thay toàn bộ method `cronRefreshUserToken` (dòng 24-36) bằng:

```ts
  @Cron('0 30 5 * * *', VN_TZ)
  async cronRefreshUserToken(): Promise<void> {
    try {
      const { status, message } = await this.systemTokenService.refresh();
      if (status === 'refreshed' || status === 'ok') {
        this.logger.log(`[TOKEN] ${message}`);
      } else {
        this.logger.error(`❌ [TOKEN] ${message}`);
      }
    } catch (err: any) {
      this.logger.error(`❌ [TOKEN] Không kiểm tra được token: ${err.message}`);
    }
  }
```

- [ ] **Bước 2: Viết lại spec cron cho khớp**

Spec cũ mock `aiClient.refreshUserToken` — nay cron không gọi nó nữa nên test sẽ đỏ. Thay toàn bộ nội dung `__tests__/facebook-owned-pages-cron.service.spec.ts` bằng:

```ts
import { Logger } from '@nestjs/common';
import { FacebookOwnedPagesCronService } from '../facebook-owned-pages-cron.service';

// Token Facebook chết âm thầm: lần trước phải curl tay mới phát hiện, sau khi cả 95 page đã
// hỏng import nhiều ngày. Cron này chỉ có giá trị nếu kết quả HIỆN RA — nên đúng thứ cần khoá
// lại bằng test là dòng log, không phải giá trị trả về.
describe('FacebookOwnedPagesCronService — gia hạn token', () => {
  let service: FacebookOwnedPagesCronService;
  let systemTokenService: { refresh: jest.Mock };
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    systemTokenService = { refresh: jest.fn() };
    service = new FacebookOwnedPagesCronService(
      {} as any,
      {} as any,
      {} as any,
      systemTokenService as any,
    );
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('token gia hạn được thì log số ngày còn lại', async () => {
    systemTokenService.refresh.mockResolvedValue({ status: 'refreshed', message: 'Đã gia hạn token, còn 60 ngày' });

    await service.cronRefreshUserToken();

    expect(logSpy.mock.calls.flat().join(' ')).toContain('Đã gia hạn token, còn 60 ngày');
  });

  it('token còn xa hạn thì log bình thường, không báo lỗi', async () => {
    systemTokenService.refresh.mockResolvedValue({ status: 'ok', message: 'Token còn 30 ngày, chưa cần gia hạn', daysLeft: 30 });

    await service.cronRefreshUserToken();

    expect(logSpy.mock.calls.flat().join(' ')).toContain('chưa cần gia hạn');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('token chết thì log lỗi kèm hướng dẫn đăng nhập lại', async () => {
    systemTokenService.refresh.mockResolvedValue({
      status: 'invalid',
      message: 'Token không gia hạn được — cần đăng nhập lại: the user logged out',
    });

    await service.cronRefreshUserToken();

    expect(errorSpy.mock.calls.flat().join(' ')).toContain('cần đăng nhập lại');
  });

  it('chưa chỉ định tài khoản hệ thống thì log lỗi chứ không nổ', async () => {
    systemTokenService.refresh.mockResolvedValue({ status: 'missing', message: 'Chưa chỉ định tài khoản Facebook hệ thống' });

    await expect(service.cronRefreshUserToken()).resolves.toBeUndefined();
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('Chưa chỉ định');
  });

  it('service ném lỗi thì log chứ không làm sập cron', async () => {
    systemTokenService.refresh.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.cronRefreshUserToken()).resolves.toBeUndefined();
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('ECONNREFUSED');
  });
});
```

- [ ] **Bước 3: `fetchManagedPages` luôn kèm token, và sửa cổng mặc định**

Trong `facebook-ai-client.service.ts`, sửa dòng 48:

```ts
  // 8001 chứ không phải 8000: Django lắng nghe ở :8001 (start-all.sh dựng `runserver
  // 0.0.0.0:8001`). Mặc định sai cổng thì máy chưa khai biến chỉ nhận ECONNREFUSED — trông
  // như "AI chết" chứ không lộ ra là cấu hình sai. Cùng giá trị với ai-integration.service.ts.
  private readonly aiServiceUrl = (process.env.AI_SERVICE_URL || 'http://localhost:8001').replace(/\/$/, '');
```

Giữ nguyên chữ ký `fetchManagedPages(userAccessToken?: string)` — nơi gọi sẽ luôn truyền vào từ Bước 4.

Xoá method `refreshUserToken` (dòng 66-75) cùng chú thích của nó: endpoint bên AI không còn được gọi nữa. **Không xoá endpoint bên AI** — đó là việc của pha 2.

- [ ] **Bước 4: Nơi gọi truyền token hệ thống vào**

`FacebookOwnedPagesService.importManagedPages` (dòng 33-34) đã nhận sẵn `userAccessToken?: string` nhưng nơi gọi thường để trống, nên AI phải tự lấy token từ `.env` của nó. Thêm bước lấy token hệ thống khi tham số trống.

Trong `facebook-owned-pages.service.ts`, thêm import ở đầu file:

```ts
import { FacebookSystemAccountService } from './facebook-system-account.service';
```

Thêm tham số vào constructor (dòng 26-29), giữ nguyên hai tham số cũ:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: FacebookAiClientService,
    private readonly systemAccountService: FacebookSystemAccountService,
  ) {}
```

Thay dòng 34 bằng hai dòng:

```ts
    // Tham số trống thì lấy token của tài khoản hệ thống. KHÔNG còn để AI tự đọc token từ
    // .env của nó nữa — đó là cả lý do tồn tại của thay đổi này.
    const token = userAccessToken ?? (await this.systemAccountService.getSystemToken()) ?? undefined;
    const { pages } = await this.aiClient.fetchManagedPages(token);
```

- [ ] **Bước 5: Khai provider trong module**

Trong `facebook-owned-pages.module.ts`, thêm import:

```ts
import { ConfigModule } from '@nestjs/config';
import { FacebookSystemAccountService } from './facebook-system-account.service';
import { FacebookSystemTokenService } from './facebook-system-token.service';
import { FacebookTokenAlertService } from './facebook-token-alert.service';
import { CryptoService } from '../social-publishing/crypto/crypto.service';
import { LarkNotifyService } from '../lark-sync/lark-notify.service';
import { HttpModule } from '@nestjs/axios';
```

Thêm `HttpModule.register({ timeout: 30000, maxRedirects: 5 })` và `ConfigModule` vào `imports` (LarkNotifyService cần `HttpService` và `ConfigService`).

Đổi `providers` và `exports`:

```ts
  providers: [
    FacebookOwnedPagesService,
    FacebookOwnedPagesReadService,
    FacebookAiClientService,
    FacebookOwnedPagesCronService,
    FacebookSystemAccountService,
    FacebookSystemTokenService,
    FacebookTokenAlertService,
    CryptoService,
    LarkNotifyService,
  ],
  exports: [FacebookOwnedPagesService, FacebookAiClientService, FacebookSystemAccountService],
```

`FacebookSystemAccountService` phải export vì `AccountsController` dùng nó. Controller đó được khai trong `src/modules/social-publishing/social-publishing.module.ts` (dòng 65) — thêm `FacebookOwnedPagesModule` vào `imports` của module đó, dòng 59:

```ts
  imports: [PrismaModule, MulterModule.register(), InstagramScraperModule, FacebookOwnedPagesModule],
```

kèm import ở đầu file:

```ts
import { FacebookOwnedPagesModule } from '../facebook-owned-pages/facebook-owned-pages.module';
```

Nếu Nest báo circular dependency (hai module import lẫn nhau) thì **DỪNG LẠI, báo người dùng** — cách gỡ là chuyển `FacebookSystemAccountService` sang một module dùng chung, và đó là quyết định kiến trúc chứ không phải sửa vặt.

- [ ] **Bước 6: Xác minh biên dịch**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit
```

Kỳ vọng: không lỗi.

- [ ] **Bước 7: Chạy TOÀN BỘ test và đọc kết quả**

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm test
```

Kỳ vọng: toàn bộ suite PASS. Có test nào đỏ thì **sửa cho xanh rồi mới đi tiếp** — không báo xong khi còn đỏ.

- [ ] **Bước 8: Chạy thật để kiểm chứng bằng `curl`**

`npx tsc --noEmit` chỉ chứng minh biên dịch được, **không** chứng minh chạy đúng.

Hỏi người dùng trước khi khởi động lại BE của họ. Được đồng ý thì bật BE.

Lấy token ADMIN để gọi — ký thẳng bằng `JWT_SECRET` thay vì phải biết mật khẩu:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node -e "
const fs=require('fs'), jwt=require('jsonwebtoken');
const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient();
const secret=fs.readFileSync('.env','utf8').match(/^JWT_SECRET=\"?([^\"\n]+)/m)[1];
p.user.findFirst({where:{is_active:true, roles:{has:'ADMIN'}},select:{id:true,email:true,roles:true}})
 .then(u=>{console.log(jwt.sign({sub:u.id,email:u.email,roles:u.roles},secret,{expiresIn:'1h'}));return p.\$disconnect()});
" > /tmp/admin.jwt
```

Rồi dùng `\$(cat /tmp/admin.jwt)` thay cho `<token ADMIN>` bên dưới. Xoá file khi xong.

```bash
# 1. Chưa chỉ định tài khoản -> endpoint phải nói rõ, không nổ 500
curl -s -i -X PUT http://localhost:3000/api/social/accounts/khong-co-that/facebook-system \
  -H "Authorization: Bearer <token ADMIN>" | head -3
# Kỳ vọng: 400 "Không tìm thấy tài khoản social này"

# 2. Chỉ định tài khoản Facebook thật (lấy id từ GET /api/social/accounts)
curl -s -X PUT http://localhost:3000/api/social/accounts/<id>/facebook-system \
  -H "Authorization: Bearer <token ADMIN>"
# Kỳ vọng: {"success":true}

# 3. Đọc DB xác nhận đúng MỘT dòng
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" node -e "
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
p.facebookSystemAccount.findMany().then(r=>{console.log('số dòng:',r.length,r);return p.\$disconnect()});
"

# 4. Người không phải ADMIN -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X PUT http://localhost:3000/api/social/accounts/<id>/facebook-system \
  -H "Authorization: Bearer <token user thường>"
# Kỳ vọng: 403
```

**Ghi lại mã trạng thái thật của cả 4 bước vào phần báo cáo.** Lệch kỳ vọng thì gọi skill `systematic-debugging`.

- [ ] **Bước 9: Commit**

```bash
git add src/modules/facebook-owned-pages/ src/modules/social-publishing/
git commit -m "feat(facebook): cron gia hạn token dùng service của BE, AI client luôn kèm token"
```

---

## Tạo PR

Theo mục 7 của `CLAUDE.md`.

- [ ] Chạy `npm test` lần cuối, **đọc kết quả**
- [ ] Tạo PR với tiêu đề nêu rõ từng chức năng: `feat(facebook): BE giữ token hệ thống + tự gia hạn + cảnh báo Lark khi token chết`
- [ ] Điền `.github/pull_request_template.md`

| Chức năng | File test |
|---|---|
| Chỉ định tài khoản Facebook hệ thống | `src/modules/facebook-owned-pages/__tests__/facebook-system-account.spec.ts` |
| Gia hạn User Access Token ở BE | `src/modules/facebook-owned-pages/__tests__/refresh-system-token.spec.ts` |
| Cảnh báo Lark khi token chết | `src/modules/facebook-owned-pages/__tests__/token-dead-alert.spec.ts` |

- [ ] Input/output từng chức năng cập nhật **trên Jira**
- [ ] Ghi rõ trong PR: **migration phải chạy trước khi deploy code**
- [ ] Ghi rõ trong PR: **sau khi deploy, ADMIN phải vào bấm chỉ định tài khoản hệ thống** — chưa chỉ định thì cron ghi `missing` và import page không có token
- [ ] Ghi rõ trong PR: repo AI **không đổi gì**, endpoint `token-refresh/` bên đó chỉ thôi được gọi

## Giai đoạn sau

Pha 2 (gỡ khỏi AI) viết kế hoạch riêng sau khi pha 1 đã chạy ổn trên production. Gồm: xoá `facebook_token_store.py`, xoá endpoint `token-refresh/`, `__init__` thôi đọc app creds, `get_my_managed_pages` ném lỗi xác thực thay vì `return []`, `user_access_token` thành bắt buộc, và xoá `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`/`FACEBOOK_ACCESS_TOKEN` khỏi `settings.py` + `.env`.
