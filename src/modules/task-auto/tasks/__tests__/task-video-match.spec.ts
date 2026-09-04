import {
  CandidateTask,
  CandidateVideo,
  ChannelContext,
  MATCH_THRESHOLD,
  captionHook,
  extractContentLines,
  extractKCode,
  extractSkuTags,
  isWithinWindow,
  pickWinner,
  scoreCandidate,
  skuMatches,
  statusFromReason,
  tokenOverlapRatio,
} from "../task-video-match.util";

/**
 * Một chức năng: khớp tự động video kênh nội bộ (FB/IG kéo về) với task rồi gắn link
 * bài đăng. Trọng số + guardrail rút từ 112 cặp người dùng đã tự gắn link:
 * tuyến #A<n> + team (huyk_channels) + đăng trong ±2 ngày là 3 mỏ neo; HOOK khớp TIÊU ĐỀ
 * content là điều kiện BẮT BUỘC để gắn link; #SKU / hashtag đặc thù chỉ cộng điểm + tính
 * gap; không đủ căn cứ thì để trống.
 */

const PUBLISHED_AT = new Date("2026-08-20T03:00:00.000Z");

function video(over: Partial<CandidateVideo> = {}): CandidateVideo {
  return {
    platform: "FACEBOOK",
    postId: "post_1",
    url: "https://www.facebook.com/reel/111111111/",
    caption: "",
    hashtags: [],
    publishedAt: PUBLISHED_AT,
    channelKey: "page-abc",
    ...over,
  };
}

function task(over: Partial<CandidateTask> = {}): CandidateTask {
  return {
    id: "task_1",
    teamId: "team_1",
    assigneeId: "user_1",
    contentLineName: "A4",
    scriptHashtags: [],
    scriptContent: "",
    contentTitle: "",
    productSkus: [],
    submittedAt: new Date("2026-08-19T12:00:00.000Z"), // ~0.6 ngày trước video
    reviewedAt: null,
    deadline: null,
    ...over,
  };
}

const NO_CHANNEL: ChannelContext = { teamIdFromChannel: null, channelOwnerId: null };
const TEAM_1: ChannelContext = { teamIdFromChannel: "team_1", channelOwnerId: null };
// Kênh có chủ trùng người nhận task mặc định ("user_1") — nghiệp vụ: người cầm kênh == người nhận task.
const TEAM_1_OWNED: ChannelContext = { teamIdFromChannel: "team_1", channelOwnerId: "user_1" };
// Kênh chỉ mới gán chủ, chưa gán team.
const OWNER_ONLY: ChannelContext = { teamIdFromChannel: null, channelOwnerId: "user_1" };

describe("extractContentLines", () => {
  it("bắt #A1..#A5, viết hoa, không lặp", () => {
    expect(extractContentLines("hè #a1 rồi #A1 và #a3")).toEqual(["A1", "A3"]);
  });
  it("không nuốt #A54 vào A5", () => {
    expect(extractContentLines("ưu đãi #A54")).toEqual([]);
  });
  it("caption rỗng", () => {
    expect(extractContentLines("")).toEqual([]);
  });
});

describe("extractKCode", () => {
  it("#K401 / #k404 / #402 đều ra K<digits>", () => {
    expect(extractKCode("clip #K401 #A4")).toBe("K401");
    expect(extractKCode("clip #k404 #a4")).toBe("K404");
    expect(extractKCode("Nhẫn xoay #A4 #402 #m")).toBe("K402");
  });
  it("không có mã → null", () => {
    expect(extractKCode("chỉ có #A4 #C")).toBeNull();
    expect(extractKCode("")).toBeNull();
  });
});

describe("extractSkuTags", () => {
  it("bắt #N0018 #ML0008, loại #A4 #K401", () => {
    expect(extractSkuTags("ra mắt #ML0008 #K401 #A4 #N0018").sort()).toEqual([
      "ml0008",
      "n0018",
    ]);
  });
  it("giữ đuôi biến thể #D400544-V", () => {
    expect(extractSkuTags("mã #D400544-V")).toEqual(["d400544-v"]);
  });
});

describe("captionHook", () => {
  it("lấy phần trước hashtag đầu tiên", () => {
    expect(captionHook("Ai bảo lắc bạc thì không sang? #K402 #A4 #C")).toBe(
      "Ai bảo lắc bạc thì không sang?",
    );
  });
});

describe("skuMatches", () => {
  it("trùng hệt", () => {
    expect(skuMatches(["n0018"], ["n0018"])).toEqual(["n0018"]);
  });
  it("một bên là tiền tố (đuôi biến thể)", () => {
    expect(skuMatches(["d400544-v"], ["d400544"])).toEqual(["d400544-v"]);
  });
  it("không liên quan → rỗng", () => {
    expect(skuMatches(["n0018"], ["x999"])).toEqual([]);
  });
});

describe("tokenOverlapRatio", () => {
  const A = "tui xach nu cong so that cao cap sang xin ben dep gia tot";
  const B = "tui xach nu cong so that cao cap sang xin hang hieu ben bi gia tot";
  it(">= 0.5 khi trùng nhiều token", () => {
    expect(tokenOverlapRatio(A, B)).toBeGreaterThanOrEqual(0.5);
  });
  it("0 khi một bên rỗng / quá ngắn", () => {
    expect(tokenOverlapRatio(A, "")).toBe(0);
    expect(tokenOverlapRatio("#a4 sale", B)).toBe(0);
  });
});

describe("isWithinWindow", () => {
  it("true khi mốc nộp trong ±2 ngày quanh lúc đăng", () => {
    expect(isWithinWindow(video(), task())).toBe(true);
  });
  it("true cả khi video đăng TRƯỚC mốc nộp <= 2 ngày", () => {
    expect(
      isWithinWindow(video(), task({ submittedAt: new Date("2026-08-22T00:00:00Z") })),
    ).toBe(true);
  });
  it("false khi lệch quá 2 ngày", () => {
    expect(
      isWithinWindow(video(), task({ submittedAt: new Date("2026-08-15T00:00:00Z") })),
    ).toBe(false);
  });
  it("false khi task không có mốc thời gian", () => {
    expect(
      isWithinWindow(video(), task({ submittedAt: null, reviewedAt: null, deadline: null })),
    ).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("3 mỏ neo: tuyến (+3) + team (+4) + đăng cùng ngày (+3) = 10", () => {
    const { score, matchedBy } = scoreCandidate(
      video({ caption: "clip mới #A4 #K401" }),
      task(),
      TEAM_1,
    );
    expect(score).toBe(10);
    expect(matchedBy.contentLine).toBe("A4");
    expect(matchedBy.team).toBe(true);
    expect(matchedBy.timing).toBeDefined();
  });

  it("+5 khi #SKU trong caption khớp SKU sản phẩm của task", () => {
    const { score, matchedBy } = scoreCandidate(
      video({ caption: "ra mắt #A4 #K401 #N0018" }),
      task({ productSkus: ["n0018"] }),
      TEAM_1,
    );
    expect(score).toBe(15);
    expect(matchedBy.sku).toEqual(["n0018"]);
  });

  it("+4 khi hook caption khớp tiêu đề content", () => {
    const hook = "Bí quyết chọn nhẫn cưới hợp mệnh không phải ai cũng biết rõ";
    const { score, matchedBy } = scoreCandidate(
      video({ caption: `${hook} #A4 #K401` }),
      task({ contentTitle: hook }),
      TEAM_1,
    );
    expect(score).toBe(14);
    expect(matchedBy.hook).toBeDefined();
  });

  it("chỉ trùng tuyến, không team/không thời gian → +3", () => {
    const { score } = scoreCandidate(
      video({ caption: "clip #A4" }),
      task({ submittedAt: new Date("2026-08-10T00:00:00Z") }),
      NO_CHANNEL,
    );
    expect(score).toBe(3);
  });

  it("+4 khi chủ kênh trùng người nhận task", () => {
    const { score, matchedBy } = scoreCandidate(
      video({ caption: "clip #A4 #K401" }),
      task(), // assigneeId mặc định "user_1"
      TEAM_1_OWNED,
    );
    // tuyến(+3) + team(+4) + timing(+3) + chủ kênh(+4) = 14
    expect(score).toBe(14);
    expect(matchedBy.channelOwner).toBe(true);
  });

  it("không cộng khi chủ kênh khác người nhận task", () => {
    const { score, matchedBy } = scoreCandidate(
      video({ caption: "clip #A4 #K401" }),
      task({ assigneeId: "user_1" }),
      { teamIdFromChannel: "team_1", channelOwnerId: "user_9" },
    );
    expect(score).toBe(10);
    expect(matchedBy.channelOwner).toBeUndefined();
  });
});

describe("pickWinner", () => {
  const HOOK = "Bí quyết chọn nhẫn cưới hợp mệnh không phải ai cũng biết rõ";
  // Ứng viên mạnh: tuyến + team + thời gian + hook khớp tiêu đề (có tín hiệu tách).
  const withHook = (id = "task_1") => ({
    task: task({ id }),
    ...scoreCandidate(
      video({ caption: `${HOOK} #A4 #K401` }),
      task({ id, contentTitle: HOOK }),
      TEAM_1,
    ),
  });
  // Chỉ 3 mỏ neo, KHÔNG có tín hiệu nội dung tách bạch.
  const anchorsOnly = (id = "task_1") => ({
    task: task({ id }),
    ...scoreCandidate(video({ caption: "clip #A4 #K401" }), task({ id }), TEAM_1),
  });

  it("NO_CANDIDATE khi rỗng", () => {
    expect(pickWinner([]).reason).toBe("NO_CANDIDATE");
  });

  it("MATCHED khi 1 ứng viên: tuyến + team + hook khớp tiêu đề", () => {
    const r = pickWinner([withHook()]);
    expect(r.reason).toBe("MATCHED");
    expect(r.taskId).toBe("task_1");
  });

  it("WEAK_SIGNAL khi chỉ có 3 mỏ neo, KHÔNG có hook khớp tiêu đề (dù duy nhất)", () => {
    const s = anchorsOnly();
    expect(s.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(pickWinner([s]).reason).toBe("WEAK_SIGNAL");
  });

  it("WEAK_SIGNAL khi THIẾU team (không có mỏ neo kênh)", () => {
    const s = {
      task: task(),
      ...scoreCandidate(
        video({ caption: "clip #A4 #K401 #N0018" }),
        task({ productSkus: ["n0018"] }),
        NO_CHANNEL,
      ),
    };
    expect(pickWinner([s]).reason).toBe("WEAK_SIGNAL");
  });

  it("BELOW_THRESHOLD khi ứng viên tốt nhất < 9", () => {
    const weak = {
      task: task(),
      ...scoreCandidate(
        video({ caption: "clip #A4" }),
        task({ submittedAt: new Date("2026-08-10T00:00:00Z") }),
        NO_CHANNEL,
      ),
    };
    expect(pickWinner([weak]).reason).toBe("BELOW_THRESHOLD");
  });

  it("AMBIGUOUS khi >=2 ứng viên hoà điểm (cùng có hook), gap < 4", () => {
    const r = pickWinner([withHook("task_1"), withHook("task_2")]);
    expect(r.reason).toBe("AMBIGUOUS");
    expect(r.taskId).toBeNull();
  });

  it("WEAK_SIGNAL khi #SKU tách 1 task hơn hạng nhì >= 4 điểm nhưng THIẾU hook khớp tiêu đề", () => {
    const withSku = {
      task: task(),
      ...scoreCandidate(
        video({ caption: "clip #A4 #K401 #N0018" }),
        task({ productSkus: ["n0018"] }),
        TEAM_1,
      ),
    };
    const r = pickWinner([withSku, anchorsOnly("task_2")]);
    expect(r.matchedBy.sku).toBeUndefined(); // reset về empty khi WEAK_SIGNAL
    expect(r.reason).toBe("WEAK_SIGNAL");
  });

  it("MATCHED khi có hook khớp tiêu đề + #SKU tách hơn hạng nhì >= 4 điểm", () => {
    const withHookSku = {
      task: task({ id: "task_1" }),
      ...scoreCandidate(
        video({ caption: `${HOOK} #A4 #K401 #N0018` }),
        task({ id: "task_1", contentTitle: HOOK, productSkus: ["n0018"] }),
        TEAM_1,
      ),
    };
    const r = pickWinner([withHookSku, anchorsOnly("task_2")]);
    expect(r.reason).toBe("MATCHED");
    expect(r.matchedBy.hook).toBeDefined();
    expect(r.matchedBy.sku).toEqual(["n0018"]);
  });

  // Fix A: chủ kênh KHÔNG còn tự nó là tín hiệu tách bạch.
  it("WEAK_SIGNAL khi chỉ có chủ kênh (không #SKU/hook/hashtag) — chủ kênh không tự tách", () => {
    const owned = {
      task: task({ id: "task_1" }),
      ...scoreCandidate(
        video({ caption: "clip #A4 #K401" }),
        task({ id: "task_1" }), // assignee "user_1" == chủ kênh
        TEAM_1_OWNED,
      ),
    };
    expect(owned.matchedBy.channelOwner).toBe(true);
    expect(pickWinner([owned]).reason).toBe("WEAK_SIGNAL");
  });

  it("MATCHED khi chủ kênh + hook thật tách 1 task hơn hạng nhì ≥ 4đ", () => {
    const owned = {
      task: task({ id: "task_1" }),
      ...scoreCandidate(
        video({ caption: `${HOOK} #A4 #K401` }),
        task({ id: "task_1", contentTitle: HOOK }),
        TEAM_1_OWNED,
      ),
    };
    const r = pickWinner([owned, anchorsOnly("task_2")]);
    expect(r.reason).toBe("MATCHED");
    expect(r.taskId).toBe("task_1");
    expect(r.matchedBy.channelOwner).toBe(true);
  });

  it("MATCHED khi kênh CHỈ có chủ (chưa gán team) nhưng có hook thật, duy nhất", () => {
    const ownerOnly = {
      task: task(),
      ...scoreCandidate(
        video({ caption: `${HOOK} #A4` }),
        task({ contentTitle: HOOK }),
        OWNER_ONLY,
      ),
    };
    const r = pickWinner([ownerOnly]);
    expect(r.reason).toBe("MATCHED");
    expect(r.taskId).toBe("task_1");
  });

  it("WEAK_SIGNAL khi kênh chỉ có chủ và KHÔNG có tín hiệu nội dung", () => {
    const ownerOnly = {
      task: task(),
      ...scoreCandidate(video({ caption: "clip #A4" }), task(), OWNER_ONLY),
    };
    expect(pickWinner([ownerOnly]).reason).toBe("WEAK_SIGNAL");
  });
});

// Fix B: hook phải trùng TỪ MANG CHỦ ĐỀ (>= 0.75, từ đệm bị loại).
describe("scoreCandidate — hook không tính khi chỉ trùng từ đệm", () => {
  it("tiêu đề ngắn chỉ trùng 'cách/đơn giản' → KHÔNG có hook", () => {
    const { matchedBy } = scoreCandidate(
      video({
        caption:
          "Ba cách đơn giản để phân biệt kim cương và đá thường tại nhà #A1 #K208",
      }),
      task({ contentLineName: "A1", contentTitle: "Cách đo size nhẫn đơn giản" }),
      TEAM_1,
    );
    expect(matchedBy.hook).toBeUndefined();
  });

  it("'buộc chặt' vs 'tháo … chật' → overlap thấp, KHÔNG có hook", () => {
    const { matchedBy } = scoreCandidate(
      video({ caption: "Mẹo tháo vòng tay bị chật #A1 #K207" }),
      task({ contentLineName: "A1", contentTitle: "Mẹo buộc chặt lắc tay" }),
      TEAM_1,
    );
    expect(matchedBy.hook).toBeUndefined();
  });

  it("hook trùng gần hết tiêu đề (từ mang chủ đề) → vẫn +4", () => {
    const t = "Bảo quản túi da sai cách thường gặp nhất";
    const { matchedBy } = scoreCandidate(
      video({ caption: `${t} #A2 #DD06` }),
      task({ contentLineName: "A2", contentTitle: t }),
      TEAM_1,
    );
    expect(matchedBy.hook).toBeDefined();
  });
});

describe("statusFromReason", () => {
  it("map trạng thái", () => {
    expect(statusFromReason("MATCHED")).toBe("MATCHED");
    expect(statusFromReason("AMBIGUOUS")).toBe("SKIPPED_AMBIGUOUS");
    expect(statusFromReason("BELOW_THRESHOLD")).toBe("UNMATCHED");
    expect(statusFromReason("WEAK_SIGNAL")).toBe("UNMATCHED");
    expect(statusFromReason("NO_CANDIDATE")).toBe("UNMATCHED");
  });
});
