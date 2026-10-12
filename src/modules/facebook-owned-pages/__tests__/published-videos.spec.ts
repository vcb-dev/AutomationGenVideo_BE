import { ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { FacebookOwnedPagesReadService } from "../facebook-owned-pages-read.service";
import { FacebookOwnedPagesController } from "../facebook-owned-pages.controller";
import {
  buildPageChannelMap,
  handleFromLink,
  ResolverChannel,
} from "../page-channel-resolver";
import {
  PublishedVideosRefreshService,
  REFRESH_MAX_POSTS_PER_PAGE,
  refreshSyncRange,
} from "../published-videos-refresh.service";

const K1 = "team-k1";
const K4 = "team-k4";
const CAM = "user-cam";
const BINH = "user-binh";

function kenh(p: Partial<ResolverChannel>): ResolverChannel {
  return {
    platform: "facebook",
    name: "",
    channel_id: null,
    link_channel: null,
    team_id: null,
    owner_id: null,
    ...p,
  };
}

describe("buildPageChannelMap — page Facebook ↔ huyk_channels", () => {
  it("khớp theo page_id nằm trong link profile.php?id=", () => {
    const map = buildPageChannelMap(
      [
        {
          page_id: "61590512288814",
          name: "Tên page khác hẳn",
          username: null,
        },
      ],
      [
        kenh({
          name: "HuyK Đá Quý",
          link_channel:
            "https://www.facebook.com/profile.php?id=61590512288814",
          team_id: K4,
          owner_id: BINH,
        }),
      ],
    );
    expect(map.get("61590512288814")).toEqual({ teamId: K4, ownerId: BINH });
  });

  it("khớp theo username trong link, không phân biệt hoa thường", () => {
    const map = buildPageChannelMap(
      [{ page_id: "111", name: "x", username: "www.huyk.thokimhoan" }],
      [
        kenh({
          name: "Huyk - Thợ kim hoàn",
          link_channel: "https://www.facebook.com/WWW.Huyk.ThoKimHoan",
          team_id: K1,
          owner_id: CAM,
        }),
      ],
    );
    expect(map.get("111")).toEqual({ teamId: K1, ownerId: CAM });
  });

  it("khớp theo tên khi không có id/handle — kể cả khác dạng Unicode (NFD vs NFC)", () => {
    const map = buildPageChannelMap(
      [
        {
          page_id: "222",
          name: "HuyK.vn Thợ Kim Hoàn".normalize("NFD"),
          username: null,
        },
      ],
      [
        kenh({
          name: "huyk.vn thợ kim hoàn",
          link_channel: "https://www.facebook.com/share/1JPeRRRJB9/",
          team_id: K1,
          owner_id: CAM,
        }),
      ],
    );
    expect(map.get("222")).toEqual({ teamId: K1, ownerId: CAM });
  });

  it("cùng tên có nhiều nền tảng thì ưu tiên dòng facebook", () => {
    const map = buildPageChannelMap(
      [{ page_id: "333", name: "HuyK - Góc Kim Hoàn", username: null }],
      [
        kenh({
          platform: "tiktok",
          name: "HuyK - Góc Kim Hoàn",
          team_id: K4,
          owner_id: BINH,
        }),
        kenh({
          platform: "facebook",
          name: "HuyK - Góc Kim Hoàn",
          team_id: K1,
          owner_id: CAM,
        }),
      ],
    );
    expect(map.get("333")).toEqual({ teamId: K1, ownerId: CAM });
  });

  it("cùng tên và cùng độ ưu tiên nhưng khác team → không chọn ngẫu nhiên", () => {
    const map = buildPageChannelMap(
      [{ page_id: "334", name: "HuyK - Trùng tên", username: null }],
      [
        kenh({
          platform: "facebook",
          name: "HuyK - Trùng tên",
          team_id: K1,
          owner_id: CAM,
        }),
        kenh({
          platform: "facebook",
          name: "HuyK - Trùng tên",
          team_id: K4,
          owner_id: BINH,
        }),
      ],
    );
    expect(map.has("334")).toBe(false);
  });

  it("cùng tên, cùng team nhưng khác chủ → vẫn giữ team và bỏ owner mơ hồ", () => {
    const map = buildPageChannelMap(
      [{ page_id: "335", name: "HuyK - Chung team", username: null }],
      [
        kenh({
          platform: "facebook",
          name: "HuyK - Chung team",
          team_id: K1,
          owner_id: CAM,
        }),
        kenh({
          platform: "facebook",
          name: "HuyK - Chung team",
          team_id: K1,
          owner_id: BINH,
        }),
      ],
    );
    expect(map.get("335")).toEqual({ teamId: K1, ownerId: null });
  });

  it("bỏ qua kênh chưa có team lẫn người cầm, page không khớp thì không có trong map", () => {
    const map = buildPageChannelMap(
      [{ page_id: "444", name: "Kênh mồ côi", username: null }],
      [kenh({ name: "Kênh mồ côi" })],
    );
    expect(map.has("444")).toBe(false);
  });

  it("handleFromLink không coi share/reel/profile.php là handle", () => {
    expect(
      handleFromLink(
        "https://www.facebook.com/share/19MggusqLU/?mibextid=wwXIfr",
      ),
    ).toBeNull();
    expect(handleFromLink("https://www.facebook.com/profile.php?id=615")).toBe(
      "615",
    );
    expect(handleFromLink("https://www.facebook.com/huykgockimhoan/")).toBe(
      "huykgockimhoan",
    );
  });

  it("handleFromLink bóc handle sau @ của Threads/TikTok/YouTube, bỏ link kênh YouTube dạng /channel/", () => {
    expect(
      handleFromLink("https://www.threads.com/@huykartisanjeweler?xmt=AQG0"),
    ).toBe("huykartisanjeweler");
    expect(
      handleFromLink("https://www.tiktok.com/@huyk.trangsucchetac?lang=vi-VN"),
    ).toBe("huyk.trangsucchetac");
    expect(
      handleFromLink("https://www.youtube.com/@HuyKchetactrangsucvcb"),
    ).toBe("huykchetactrangsucvcb");
    expect(
      handleFromLink(
        "https://www.youtube.com/channel/UCP2tiUP-pIPc7wJGUCOoP6Q",
      ),
    ).toBeNull();
  });

  it("profile nền tảng khác: truyền preferPlatform để trùng tên thì ưu tiên kênh cùng nền tảng", () => {
    const channels = [
      kenh({
        platform: "facebook",
        name: "HuyK - Góc Kim Hoàn",
        team_id: K1,
        owner_id: CAM,
      }),
      kenh({
        platform: "instagram",
        name: "HuyK - Góc Kim Hoàn",
        team_id: K4,
        owner_id: BINH,
      }),
    ];
    const profiles = [
      {
        page_id: "huyk.gockimhoan",
        name: "HuyK - Góc Kim Hoàn",
        username: "huyk.gockimhoan",
      },
    ];
    expect(
      buildPageChannelMap(profiles, channels, "instagram").get(
        "huyk.gockimhoan",
      ),
    ).toEqual({ teamId: K4, ownerId: BINH });
    expect(
      buildPageChannelMap(profiles, channels).get("huyk.gockimhoan"),
    ).toEqual({ teamId: K1, ownerId: CAM });
  });

  it("channel_id nhập kèm @ hoặc khoảng trắng đầu vẫn khớp username", () => {
    const map = buildPageChannelMap(
      [
        {
          page_id: "huyk_craftsman84",
          name: "x",
          username: "huyk_craftsman84",
        },
      ],
      [
        kenh({
          platform: "instagram",
          name: "y",
          channel_id: " @huyk_craftsman84",
          team_id: K1,
          owner_id: CAM,
        }),
      ],
      "instagram",
    );
    expect(map.get("huyk_craftsman84")).toEqual({ teamId: K1, ownerId: CAM });
  });
});

describe('FacebookOwnedPagesReadService.getAllVideos — tab "Video đã đăng"', () => {
  let prisma: any;
  let service: FacebookOwnedPagesReadService;

  const pages = [
    {
      id: 1n,
      page_id: "p-cam",
      name: "Huyk - Thợ kim hoàn",
      username: null,
      avatar_url: null,
      avatar_drive_url: null,
    },
    {
      id: 2n,
      page_id: "p-binh",
      name: "HuyK Đá Quý",
      username: null,
      avatar_url: null,
      avatar_drive_url: null,
    },
    {
      id: 3n,
      page_id: "p-mo-coi",
      name: "Page chưa gán",
      username: null,
      avatar_url: null,
      avatar_drive_url: null,
    },
  ];
  const channels = [
    {
      ...kenh({ name: "Huyk - Thợ kim hoàn", team_id: K1, owner_id: CAM }),
      channel_team: { id: K1, name: "Team K1" },
      channel_owner: { id: CAM, full_name: "Huyền Cam" },
    },
    {
      ...kenh({ name: "HuyK Đá Quý", team_id: K4, owner_id: BINH }),
      channel_team: { id: K4, name: "Team K4" },
      channel_owner: { id: BINH, full_name: "Nguyễn Hữu Bình" },
    },
  ];

  beforeEach(() => {
    prisma = {
      video_management_managedfacebookpage: {
        findMany: jest.fn().mockResolvedValue(pages),
      },
      channel: { findMany: jest.fn().mockResolvedValue(channels) },
      $queryRaw: jest.fn(),
    };
    service = new FacebookOwnedPagesReadService(prisma);
  });

  function whereCuaCauDem(): Prisma.Sql | undefined {
    const [, ...values] = prisma.$queryRaw.mock.calls[0];
    return values.find(
      (v: any) =>
        Array.isArray(v?.strings) &&
        Array.isArray(v?.values) &&
        v.strings.join("").includes("WHERE"),
    );
  }

  it("lọc team + người cầm → chỉ lấy video của page khớp cả hai", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 0n }])
      .mockResolvedValueOnce([]);

    await service.getAllVideos({ team_id: `${K1},${K4}`, owner_id: CAM });

    const where = whereCuaCauDem()!;
    expect(where.strings.join("?")).toContain("managed_page_id IN");
    expect(where.values).toEqual([1n]);
  });

  it("không page nào khớp bộ lọc → trả rỗng, không chạy query video", async () => {
    const res = await service.getAllVideos({
      owner_id: "nguoi-khong-cam-kenh",
    });

    expect(res).toMatchObject({ count: 0, videos: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("không lọc team/người → không giới hạn page, video gắn kèm page + team + người cầm", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 2n }])
      .mockResolvedValueOnce([
        {
          managed_page_id: 1n,
          post_id: "v1",
          caption: "",
          published_at: new Date(),
          view_count: 10n,
          like_count: 1,
          comment_count: 0,
          share_count: 0,
          reach_count: 0,
          link_clicks: 0,
        },
        {
          managed_page_id: 3n,
          post_id: "v2",
          caption: "",
          published_at: new Date(),
          view_count: 5n,
          like_count: 0,
          comment_count: 0,
          share_count: 0,
          reach_count: 0,
          link_clicks: 0,
        },
      ]);

    const res: any = await service.getAllVideos({});

    expect(whereCuaCauDem()).toBeUndefined();
    expect(res.videos[0]).toMatchObject({
      post_id: "v1",
      view_count: 10,
      page: { page_id: "p-cam", name: "Huyk - Thợ kim hoàn" },
      channel: {
        team_id: K1,
        team_name: "Team K1",
        owner_id: CAM,
        owner_name: "Huyền Cam",
      },
    });
    expect(res.videos[1]).toMatchObject({
      page: { page_id: "p-mo-coi" },
      channel: null,
    });
  });

  it("đánh dấu task đã gắn link của video — khớp theo id reel dù link trong task khác dạng", async () => {
    const row = (post_id: string, permalink_url: string | null) => ({
      managed_page_id: 1n,
      post_id,
      caption: "",
      published_at: new Date(),
      permalink_url,
      view_count: 0n,
      like_count: 0,
      comment_count: 0,
      share_count: 0,
      reach_count: 0,
      link_clicks: 0,
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ total: 3n }])
      .mockResolvedValueOnce([
        row("v1", "https://www.facebook.com/reel/1108106365200234/"),
        row("v2", "https://www.facebook.com/reel/2272520003529473/"),
        row("v3", null),
      ])
      .mockResolvedValueOnce([
        {
          id: "task-a",
          links:
            '[{"url": "https://www.facebook.com/HuyK/videos/1108106365200234?mibextid=x"}]',
        },
      ]);

    const res: any = await service.getAllVideos({});

    const [, patterns] = prisma.$queryRaw.mock.calls[2];
    expect(patterns).toEqual(["%1108106365200234%", "%2272520003529473%"]);
    expect(res.videos.map((v: any) => v.linked_task_ids)).toEqual([
      ["task-a"],
      [],
      [],
    ]);
  });

  describe('getVideosByOwner — mục "Video đã đăng" của file Excel xuất task', () => {
    const vid = (
      managed_page_id: bigint,
      post_id: string,
      day: string,
      view_count = 0n,
    ) => ({
      managed_page_id,
      post_id,
      caption: post_id,
      published_at: new Date(`${day}T03:00:00Z`),
      permalink_url: `https://www.facebook.com/reel/${post_id}`,
      view_count,
    });

    it("gom video theo người cầm page (nhiều page/người), mới → cũ, cắt N video nhưng tổng vẫn đủ", async () => {
      prisma.video_management_managedfacebookpage.findMany.mockResolvedValue([
        ...pages,
        {
          id: 4n,
          page_id: "p-cam-2",
          name: "Huyk - Thợ kim hoàn 2",
          username: null,
          avatar_url: null,
          avatar_drive_url: null,
        },
      ]);
      prisma.channel.findMany.mockResolvedValue([
        ...channels,
        {
          ...kenh({
            name: "Huyk - Thợ kim hoàn 2",
            team_id: K1,
            owner_id: CAM,
          }),
          channel_team: null,
          channel_owner: null,
        },
      ]);
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { managed_page_id: 1n, total: 5n, views: 700n },
          { managed_page_id: 4n, total: 1n, views: 50n },
          { managed_page_id: 2n, total: 1n, views: 9n },
        ])
        .mockResolvedValueOnce([
          vid(1n, "11", "2026-09-02", 100n),
          vid(1n, "12", "2026-09-05", 600n),
          vid(4n, "41", "2026-09-03", 50n),
          vid(2n, "21", "2026-09-04", 9n),
        ]);

      const res = await service.getVideosByOwner(
        [CAM, BINH, "nguoi-khong-cam-kenh"],
        {
          date_from: "2026-09-01",
          date_to: "2026-09-30",
          limit_per_owner: 2,
        },
      );

      expect([...res.keys()].sort()).toEqual([BINH, CAM].sort());
      const cam = res.get(CAM)!;
      expect(cam).toMatchObject({ page_count: 2, total: 6, total_views: 750 });
      expect(
        cam.videos.map((v) => [v.post_id, v.page_name, v.view_count]),
      ).toEqual([
        ["12", "Huyk - Thợ kim hoàn", 600],
        ["41", "Huyk - Thợ kim hoàn 2", 50],
      ]);
      expect(res.get(BINH)!.videos.map((v) => v.post_id)).toEqual(["21"]);

      const [countSql, listSql] = prisma.$queryRaw.mock.calls.map(
        ([strings, ...vals]: any[]) => ({ sql: strings.join("?"), vals }),
      );
      expect(countSql.sql).toContain("GROUP BY managed_page_id");
      expect(listSql.sql).toContain(
        "PARTITION BY managed_page_id ORDER BY published_at DESC",
      );
      expect(listSql.vals).toContain(2);
      const where = whereCuaCauDem()!;
      expect(where.values).toEqual([
        1n,
        2n,
        4n,
        new Date("2026-08-31T17:00:00Z"),
        new Date("2026-09-30T17:00:00Z"),
      ]);
    });

    it("lọc team → chỉ page thuộc team đó; người có page nhưng 0 video vẫn có mặt (để phân biệt với chưa ghép page)", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const res = await service.getVideosByOwner([CAM, BINH], {
        team_ids: [K4],
        limit_per_owner: 10,
      });

      expect(res.has(CAM)).toBe(false);
      expect(res.get(BINH)).toEqual({
        page_count: 1,
        total: 0,
        total_views: 0,
        videos: [],
      });
      expect(whereCuaCauDem()!.values).toEqual([2n]);
    });

    it("lọc tuyến → thêm điều kiện hashtag #A1 trong caption (có ranh giới, #A10 không lọt)", async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getVideosByOwner([CAM], {
        content_line: "a1",
        limit_per_owner: 10,
      });
      await service.getVideosByOwner([CAM], {
        content_line: "B9",
        limit_per_owner: 10,
      });

      expect(whereCuaCauDem()!.values).toEqual([1n, "#A1([^[:alnum:]]|$)"]);
      const [, ...valsSaiTuyen] = prisma.$queryRaw.mock.calls[2];
      const whereSaiTuyen = valsSaiTuyen.find(
        (v: any) =>
          Array.isArray(v?.values) && v.strings.join("").includes("WHERE"),
      );
      expect(whereSaiTuyen.values).toEqual([1n]);
    });

    it("không ai cầm page nào → không chạy query video", async () => {
      const res = await service.getVideosByOwner(["nguoi-khong-cam-kenh"], {
        limit_per_owner: 10,
      });

      expect(res.size).toBe(0);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it("filter-options: liệt kê người cầm kênh kèm team, đếm page chưa ghép", async () => {
    const res = await service.getVideoFilterOptions();

    expect(res.unmatched_pages).toBe(1);
    expect(res.owners.map((o) => o.full_name)).toEqual([
      "Huyền Cam",
      "Nguyễn Hữu Bình",
    ]);
    expect(res.owners[0]).toMatchObject({
      id: CAM,
      team_ids: [K1],
      page_count: 1,
    });
  });

  it("filter-options có scope chỉ trả page/người trong phạm vi được phép", async () => {
    const res = await service.getVideoFilterOptions({ teamIds: [K1] });

    expect(res).toMatchObject({ total_pages: 1, unmatched_pages: 0 });
    expect(res.owners).toEqual([
      expect.objectContaining({ id: CAM, team_ids: [K1], page_count: 1 }),
    ]);
  });
});

describe("FacebookOwnedPagesController — ép scope cho API đọc video", () => {
  const user = { id: CAM, roles: [UserRole.MEMBER] };
  const readService = {
    getAllVideos: jest.fn().mockResolvedValue({ videos: [] }),
    getVideoFilterOptions: jest.fn().mockResolvedValue({ owners: [] }),
  };
  const refreshService = {
    resolveScope: jest.fn().mockResolvedValue({ teamIds: [], ownerId: CAM }),
  };
  const controller = new FacebookOwnedPagesController(
    {} as any,
    readService as any,
    {} as any,
    refreshService as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it("member không thể bỏ owner_id để đọc video toàn hệ thống", async () => {
    await controller.allVideos(
      { user },
      { team_id: K4, owner_id: BINH, search: "nhẫn" },
    );

    expect(refreshService.resolveScope).toHaveBeenCalledWith(user, {
      team_id: K4,
      owner_id: BINH,
      search: "nhẫn",
    });
    expect(readService.getAllVideos).toHaveBeenCalledWith({
      team_id: undefined,
      owner_id: CAM,
      search: "nhẫn",
    });
  });

  it("danh sách người cầm kênh cũng dùng cùng scope", async () => {
    await controller.videoFilterOptions({ user });

    expect(refreshService.resolveScope).toHaveBeenCalledWith(user, {});
    expect(readService.getVideoFilterOptions).toHaveBeenCalledWith({
      teamIds: [],
      ownerId: CAM,
    });
  });
});

describe('PublishedVideosRefreshService — nút "Cập nhật" theo bộ lọc', () => {
  const LEADER = "user-leader";
  let prisma: any;
  let readService: { resolveScopePages: jest.Mock };
  let pagesService: { syncPage: jest.Mock; refreshMetricsForPage: jest.Mock };
  let service: PublishedVideosRefreshService;

  const trang = (id: bigint, name: string, extra: Partial<any> = {}) => ({
    id,
    page_id: `p${id}`,
    name,
    username: null,
    avatar_url: null,
    avatar_drive_url: null,
    is_active: true,
    is_scraping: false,
    page_access_token: "tok",
    ...extra,
  });

  beforeEach(() => {
    prisma = {
      team: { findMany: jest.fn().mockResolvedValue([{ id: K1 }]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    readService = { resolveScopePages: jest.fn().mockResolvedValue([]) };
    pagesService = {
      syncPage: jest.fn().mockResolvedValue({ created: 0, updated: 0 }),
      refreshMetricsForPage: jest.fn(),
    };
    service = new PublishedVideosRefreshService(
      prisma,
      readService as any,
      pagesService as any,
    );
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  async function doiXong(jobId: string, user: any) {
    for (
      let i = 0;
      i < 50 && service.getJob(jobId, user).status === "running";
      i++
    )
      await new Promise((r) => setImmediate(r));
    return service.getJob(jobId, user);
  }

  describe("phạm vi ép theo quyền", () => {
    it("thành viên gửi team/người khác vẫn chỉ cập nhật page mình cầm", async () => {
      await expect(
        service.resolveScope(
          { id: CAM, roles: [UserRole.MEMBER] },
          { team_id: K4, owner_id: BINH },
        ),
      ).resolves.toEqual({ teamIds: [], ownerId: CAM });
    });

    it("leader: bỏ team không thuộc quyền, không chọn team thì lấy mọi team mình quản lý", async () => {
      const leader = { id: LEADER, roles: [UserRole.LEADER] };
      await expect(
        service.resolveScope(leader, { team_id: `${K1},${K4}` }),
      ).resolves.toEqual({ teamIds: [K1], ownerId: undefined });
      await expect(service.resolveScope(leader, {})).resolves.toEqual({
        teamIds: [K1],
        ownerId: undefined,
      });
    });

    it("leader chọn đúng team người khác → 403", async () => {
      await expect(
        service.resolveScope(
          { id: LEADER, roles: [UserRole.LEADER] },
          { team_id: K4 },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("admin giữ nguyên bộ lọc gửi lên", async () => {
      await expect(
        service.resolveScope(
          { id: "a", roles: [UserRole.ADMIN] },
          { team_id: K4, owner_id: BINH },
        ),
      ).resolves.toEqual({ teamIds: [K4], ownerId: BINH });
    });
  });

  describe("refreshSyncRange — khoảng cào theo bộ lọc ngày (giờ VN)", () => {
    // 28/09/2026 08:00 giờ VN
    const now = new Date("2026-09-28T01:00:00.000Z");

    it("lọc tháng cũ ⇒ cào đúng từ 00:00 ngày đầu tới hết ngày cuối (không còn bỏ qua)", () => {
      expect(
        refreshSyncRange(
          { date_from: "2026-08-28", date_to: "2026-09-08" },
          now,
        ),
      ).toEqual({
        since: new Date("2026-08-27T17:00:00.000Z"),
        until: new Date("2026-09-08T17:00:00.000Z"),
      });
    });

    it("date_to là hôm nay (chưa hết ngày) ⇒ không đặt until, cào tới hiện tại", () => {
      expect(
        refreshSyncRange(
          { date_from: "2026-09-01", date_to: "2026-09-28" },
          now,
        ),
      ).toEqual({
        since: new Date("2026-08-31T17:00:00.000Z"),
      });
    });

    it("không chọn ngày (hoặc ngày sai định dạng) ⇒ lùi 7 ngày tính từ 00:00 hôm nay giờ VN", () => {
      const expected = { since: new Date("2026-09-20T17:00:00.000Z") };
      expect(refreshSyncRange({}, now)).toEqual(expected);
      expect(refreshSyncRange({ date_from: "khong-phai-ngay" }, now)).toEqual(
        expected,
      );
    });
  });

  it("cào bài mới page trong phạm vi + kéo chỉ số theo bộ lọc; 1 page lỗi không làm hỏng cả lượt", async () => {
    const admin = { id: "a", roles: [UserRole.ADMIN] };
    readService.resolveScopePages.mockResolvedValue([
      trang(1n, "Page A"),
      trang(2n, "Page lỗi"),
      trang(3n, "Page không token", { page_access_token: "" }),
      trang(4n, "Page đang cào", { is_scraping: true }),
    ]);
    pagesService.syncPage.mockImplementation(async (pageId: string) => {
      if (pageId === "p2") throw new Error("status code 502");
      return { created: 2, updated: 8 };
    });
    prisma.$queryRaw.mockResolvedValue([
      { id: 10n, managed_page_id: 1n, post_id: "a1" },
      { id: 11n, managed_page_id: 4n, post_id: "d1" },
    ]);
    pagesService.refreshMetricsForPage.mockResolvedValue(1);

    const started = await service.start(admin, {
      team_id: K1,
      date_from: "2026-09-01",
      search: "nhẫn",
    });
    const job = await doiXong(started.id, admin);

    expect(pagesService.syncPage).toHaveBeenCalledTimes(2); // p1, p2 — bỏ page đang cào + page không token
    expect(pagesService.syncPage).toHaveBeenCalledWith(
      "p1",
      REFRESH_MAX_POSTS_PER_PAGE,
      {
        since: new Date("2026-08-31T17:00:00.000Z"),
      },
    );
    expect(readService.resolveScopePages).toHaveBeenCalledWith([K1], undefined);
    expect(job).toMatchObject({
      status: "done",
      pages_total: 3,
      pages_done: 3,
      pages_failed: 1,
      pages_skipped: 1,
      new_videos: 2,
      metrics_total: 2,
      metrics_updated: 2,
      capped: false,
    });
    expect(job.errors[0]).toContain("Page lỗi");

    // Câu chọn video kéo chỉ số mang đủ bộ lọc + chỉ trong page thuộc phạm vi
    const sql = prisma.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain("ORDER BY published_at DESC");
    const where = prisma.$queryRaw.mock.calls[0][1] as Prisma.Sql;
    expect(where.strings.join("?")).toContain("managed_page_id IN");
    expect(where.strings.join("?")).toContain("immutable_unaccent(caption)");
    expect(where.values).toEqual(expect.arrayContaining([1n, 2n, 4n, "nhẫn"]));
  });

  it("bấm lại khi lượt cũ đang chạy → trả lại đúng lượt đó, không mở lượt mới", async () => {
    const user = { id: CAM, roles: [UserRole.MEMBER] };
    readService.resolveScopePages.mockResolvedValue([trang(1n, "Page A")]);
    let xongSync!: () => void;
    pagesService.syncPage.mockReturnValue(
      new Promise((r) => {
        xongSync = () => r({ created: 0, updated: 0 });
      }),
    );

    const a = await service.start(user, {});
    const b = await service.start(user, {});

    expect(b.id).toBe(a.id);
    xongSync();
    await doiXong(a.id, user);
    expect(service.latestFor(CAM)?.status).toBe("done");
  });

  it("người khác không xem được tiến độ lượt của mình", async () => {
    const user = { id: CAM, roles: [UserRole.MEMBER] };
    const job = await service.start(user, {});
    expect(() =>
      service.getJob(job.id, { id: BINH, roles: [UserRole.MEMBER] }),
    ).toThrow(NotFoundException);
  });
});

/**
 * Bộ lọc màn "Xem video" của page Facebook nội bộ:
 * - Ô "Min views" trống thì không áp ngưỡng ẩn.
 * - Lọc ngày theo giờ VN, không ghép mốc UTC.
 */
describe('FacebookOwnedPagesReadService.getSyncedVideos — bộ lọc', () => {
  let prisma: any;
  let service: FacebookOwnedPagesReadService;

  beforeEach(() => {
    prisma = {
      video_management_managedfacebookpage: {
        findUnique: jest.fn().mockResolvedValue({
          id: 86n,
          page_id: '148888379055195',
          name: 'HuyK - Kim Hoàn & Đá Quý',
          followers_count: 0n,
          likes_count: 0n,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValueOnce([{ total: 0n }]).mockResolvedValueOnce([]),
    };
    service = new FacebookOwnedPagesReadService(prisma);
  });

  /** WHERE của câu đếm total — Prisma.Sql lồng nhau được làm phẳng vào strings/values. */
  function whereCuaCauDem(): Prisma.Sql {
    const [, ...values] = prisma.$queryRaw.mock.calls[0];
    return values.find((v: any) => Array.isArray(v?.strings) && Array.isArray(v?.values));
  }
  const chu = (s: Prisma.Sql) => s.strings.join('?');

  it('không gửi min_views thì KHÔNG lọc theo lượt xem (không còn ngưỡng ẩn 10.000)', async () => {
    await service.getSyncedVideos('148888379055195', {});

    const where = whereCuaCauDem();
    expect(chu(where)).not.toContain('view_count');
    expect(where.values).not.toContain(10000n);
  });

  it('gửi min_views thì lọc đúng ngưỡng đó', async () => {
    await service.getSyncedVideos('148888379055195', { min_views: '10000' });

    const where = whereCuaCauDem();
    expect(chu(where)).toContain('view_count >=');
    expect(where.values).toContain(10000n);
  });

  it('date_from/date_to tính theo ngày lịch VN, mốc cuối là cận mở', async () => {
    await service.getSyncedVideos('148888379055195', { date_from: '2026-09-01', date_to: '2026-09-26' });

    const where = whereCuaCauDem();
    const cacMoc = where.values.filter((v) => v instanceof Date).map((d) => (d as Date).toISOString());
    expect(cacMoc).toEqual(['2026-08-31T17:00:00.000Z', '2026-09-26T17:00:00.000Z']);
    expect(chu(where)).toContain('published_at >=');
    expect(chu(where)).toContain('published_at <');
    expect(chu(where)).not.toContain('published_at <=');
  });

  it('ngày sai định dạng thì bỏ qua bộ lọc thay vì ném lỗi', async () => {
    await expect(
      service.getSyncedVideos('148888379055195', { date_from: 'abc', date_to: '2026-13-01' }),
    ).resolves.toMatchObject({ status: 'ok' });

    expect(chu(whereCuaCauDem())).not.toContain('published_at');
  });
});
