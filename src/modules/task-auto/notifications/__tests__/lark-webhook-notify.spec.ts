import { of, throwError } from "rxjs";
import { createHmac } from "crypto";
import { LarkWebhookNotifyService } from "../lark-webhook-notify.service";

function build(
  opts: {
    globalSetting?: { webhook_url: string | null; webhook_secret: string | null } | null;
    postImpl?: jest.Mock;
    frontendUrl?: string;
  } = {},
) {
  const post = opts.postImpl ?? jest.fn(() => of({ data: { code: 0 } }));
  const httpService: any = { post };
  const configService: any = {
    get: jest.fn((key: string) =>
      key === "FRONTEND_URL" ? (opts.frontendUrl ?? "https://app.example.com") : undefined,
    ),
  };
  let row: any = opts.globalSetting ?? null;
  const prisma: any = {
    larkWebhookSetting: {
      findUnique: jest.fn(async () => row),
      upsert: jest.fn(async (a: any) => {
        row = row ? { ...row, ...a.update } : { id: 1, ...a.create };
        return row;
      }),
    },
  };
  const service = new LarkWebhookNotifyService(httpService, configService, prisma);
  return { service, httpService, prisma, configService, post };
}

describe("LarkWebhookNotifyService.getGlobalSettingForDisplay", () => {
  it("chưa cấu hình gì → source none, không lộ gì", async () => {
    const { service } = build({ globalSetting: null });
    await expect(service.getGlobalSettingForDisplay()).resolves.toEqual({
      webhook_url: null,
      webhook_secret_set: false,
      source: "none",
    });
  });

  it("đã cấu hình url + secret → trả url thật, CHỈ báo đã set secret chứ không trả secret", async () => {
    const { service } = build({
      globalSetting: { webhook_url: "https://open.larksuite.com/hook/abc", webhook_secret: "shh" },
    });
    const result = await service.getGlobalSettingForDisplay();
    expect(result).toEqual({
      webhook_url: "https://open.larksuite.com/hook/abc",
      webhook_secret_set: true,
      source: "database",
    });
    expect(JSON.stringify(result)).not.toContain("shh");
  });

  it("có url nhưng chưa set secret → webhook_secret_set false", async () => {
    const { service } = build({
      globalSetting: { webhook_url: "https://open.larksuite.com/hook/abc", webhook_secret: null },
    });
    await expect(service.getGlobalSettingForDisplay()).resolves.toMatchObject({
      webhook_secret_set: false,
      source: "database",
    });
  });

  it("bảng lark_webhook_settings lỗi/chưa migrate → coi như chưa cấu hình, không throw", async () => {
    const prisma: any = {
      larkWebhookSetting: { findUnique: jest.fn(async () => { throw new Error("relation does not exist"); }) },
    };
    const service = new LarkWebhookNotifyService({} as any, { get: jest.fn() } as any, prisma);
    await expect(service.getGlobalSettingForDisplay()).resolves.toEqual({
      webhook_url: null,
      webhook_secret_set: false,
      source: "none",
    });
  });
});

describe("LarkWebhookNotifyService.updateGlobalSetting", () => {
  it("upsert đúng where id=1 với dữ liệu truyền vào", async () => {
    const { service, prisma } = build();
    await service.updateGlobalSetting({ webhook_url: "https://x/hook/1", webhook_secret: "s1" }, "user-1");
    expect(prisma.larkWebhookSetting.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, webhook_url: "https://x/hook/1", webhook_secret: "s1", updated_by: "user-1" },
      update: { webhook_url: "https://x/hook/1", webhook_secret: "s1", updated_by: "user-1" },
    });
  });

  it("field không truyền lên (bỏ trống) không nằm trong payload update → Prisma giữ nguyên giá trị cũ", async () => {
    const { service, prisma } = build();
    // Không có key webhook_secret ở object đầu vào — mô phỏng field bị bỏ trống trên form.
    await service.updateGlobalSetting({ webhook_url: "https://x/hook/2" }, "user-1");
    const updateArg = prisma.larkWebhookSetting.upsert.mock.calls[0][0].update;
    expect(updateArg).not.toHaveProperty("webhook_secret");
    expect(updateArg.webhook_url).toBe("https://x/hook/2");
  });

  it("gửi null để xoá field", async () => {
    const { service, prisma } = build();
    await service.updateGlobalSetting({ webhook_url: null, webhook_secret: null }, "user-1");
    const updateArg = prisma.larkWebhookSetting.upsert.mock.calls[0][0].update;
    expect(updateArg.webhook_url).toBeNull();
    expect(updateArg.webhook_secret).toBeNull();
  });

  it("trả về snapshot mới nhất sau khi cập nhật (không lộ secret)", async () => {
    const { service } = build();
    const result = await service.updateGlobalSetting(
      { webhook_url: "https://x/hook/3", webhook_secret: "s3" },
      "user-1",
    );
    expect(result).toEqual({ webhook_url: "https://x/hook/3", webhook_secret_set: true, source: "database" });
  });
});

describe("LarkWebhookNotifyService.sendApprovalNotice", () => {
  const baseParams = {
    taskId: "task-1",
    teamName: "Team K2",
    kind: "TASK" as const,
  };

  it("không có webhook global lẫn team → không gọi HTTP", async () => {
    const { service, post } = build({ globalSetting: null });
    await service.sendApprovalNotice({ ...baseParams, teamWebhookUrl: null });
    expect(post).not.toHaveBeenCalled();
  });

  it("chỉ có webhook global → gọi đúng 1 lần, body không kèm sign/timestamp khi không có secret", async () => {
    const { service, post } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: null },
    });
    await service.sendApprovalNotice({ ...baseParams, teamWebhookUrl: null });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("https://global/hook");
    expect(body).not.toHaveProperty("timestamp");
    expect(body).not.toHaveProperty("sign");
    expect(body.msg_type).toBe("text");
  });

  it("chỉ có webhook riêng của team (không cấu hình global) → gọi đúng 1 lần vào URL team", async () => {
    const { service, post } = build({ globalSetting: null });
    await service.sendApprovalNotice({
      ...baseParams,
      teamWebhookUrl: "https://team/hook",
      teamWebhookSecret: null,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe("https://team/hook");
  });

  it("có cả global lẫn team, KHÁC url → bắn tới cả hai", async () => {
    const { service, post } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: null },
    });
    await service.sendApprovalNotice({
      ...baseParams,
      teamWebhookUrl: "https://team/hook",
      teamWebhookSecret: null,
    });
    expect(post).toHaveBeenCalledTimes(2);
    const urls = post.mock.calls.map((c: any) => c[0]).sort();
    expect(urls).toEqual(["https://global/hook", "https://team/hook"]);
  });

  it("global và team trùng cùng một URL → chỉ bắn 1 lần, không gửi trùng vào cùng group", async () => {
    const { service, post } = build({
      globalSetting: { webhook_url: "https://same/hook", webhook_secret: null },
    });
    await service.sendApprovalNotice({
      ...baseParams,
      teamWebhookUrl: "https://same/hook",
      teamWebhookSecret: null,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("có secret → body kèm timestamp (string) + sign đúng thuật toán ký của Lark custom bot", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const { service, post } = build({
        globalSetting: { webhook_url: "https://global/hook", webhook_secret: "my-secret" },
      });
      await service.sendApprovalNotice({ ...baseParams, teamWebhookUrl: null });

      const [, body] = post.mock.calls[0];
      expect(body.timestamp).toBe("1700000000");
      // Thuật toán chính thức của Lark custom bot: HMAC-SHA256 với key = "timestamp\nsecret",
      // message RỖNG (không phải ký nội dung tin nhắn) — xem docs "Ký số bảo mật" của bot.
      const expectedSign = createHmac("sha256", "1700000000\nmy-secret").digest("base64");
      expect(body.sign).toBe(expectedSign);
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it("không có secret thì không ký, dù webhook có cấu hình", async () => {
    const { service, post } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: "" },
    });
    await service.sendApprovalNotice({ ...baseParams, teamWebhookUrl: null });
    expect(post.mock.calls[0][1]).not.toHaveProperty("sign");
  });

  it("kind=CONTENT dùng heading khác kind=TASK", async () => {
    const { service, post } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: null },
    });
    await service.sendApprovalNotice({ ...baseParams, kind: "CONTENT", teamWebhookUrl: null });
    expect(post.mock.calls[0][1].content.text).toContain("Yêu cầu duyệt content mới");

    post.mockClear();
    await service.sendApprovalNotice({ ...baseParams, kind: "TASK", teamWebhookUrl: null });
    expect(post.mock.calls[0][1].content.text).toContain("Task cần duyệt");
  });

  it("nội dung đủ dòng khi có contentTitle/personName, và link cắt trailing slash của FRONTEND_URL", async () => {
    const { service, post } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: null },
      frontendUrl: "https://app.example.com/",
    });
    await service.sendApprovalNotice({
      ...baseParams,
      kind: "CONTENT",
      teamWebhookUrl: null,
      contentTitle: "Bài A",
      personName: "Nguyễn Văn A",
    });
    const text = post.mock.calls[0][1].content.text as string;
    expect(text).toBe(
      [
        "📝 Yêu cầu duyệt content mới",
        "Team: Team K2",
        "Nội dung: Bài A",
        "Người gửi: Nguyễn Văn A",
        "Link: https://app.example.com/dashboard/task-auto/tasks?taskId=task-1",
      ].join("\n"),
    );
  });

  it("thiếu contentTitle/personName → bỏ hẳn dòng đó, không để trống rỗng", async () => {
    const { service, post } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: null },
    });
    await service.sendApprovalNotice({ ...baseParams, teamWebhookUrl: null });
    const text = post.mock.calls[0][1].content.text as string;
    expect(text).not.toContain("Nội dung:");
    expect(text).not.toContain("Người gửi:");
  });

  it("Lark trả code khác 0 (gửi hỏng) → chỉ log warn, không throw ra ngoài", async () => {
    const post = jest.fn(() => of({ data: { code: 19024, msg: "param invalid" } }));
    const { service } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: null },
      postImpl: post,
    });
    await expect(
      service.sendApprovalNotice({ ...baseParams, teamWebhookUrl: null }),
    ).resolves.toBeUndefined();
  });

  it("gọi HTTP lỗi mạng → nuốt lỗi, không throw, không chặn các target khác", async () => {
    const post = jest.fn((url: string) =>
      url === "https://team/hook" ? throwError(() => new Error("ECONNREFUSED")) : of({ data: { code: 0 } }),
    );
    const { service } = build({
      globalSetting: { webhook_url: "https://global/hook", webhook_secret: null },
      postImpl: post,
    });
    await expect(
      service.sendApprovalNotice({
        ...baseParams,
        teamWebhookUrl: "https://team/hook",
        teamWebhookSecret: null,
      }),
    ).resolves.toBeUndefined();
    // Cả 2 URL đều được thử gửi dù 1 cái lỗi — lỗi ở target này không huỷ target kia.
    expect(post).toHaveBeenCalledTimes(2);
  });
});
