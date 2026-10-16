import {
  CandidateTask,
  CandidateVideo,
  ChannelContext,
  HOOK_FULL_MATCH_BONUS,
  MATCH_THRESHOLD,
  acceptAiVerdict,
  aiShortlist,
  captionHook,
  isWithinFarWindow,
  nearDuplicateTitles,
  skuFamilyConflict,
  textAffinity,
  enforceChannelOwnerGuard,
  extractContentLines,
  extractKCode,
  extractSkuTags,
  isWithinWindow,
  pickWinner,
  scoreCandidate,
  skuMatches,
  statusFromReason,
  titleCoverage,
  tokenOverlapRatio,
} from "../../../../utils/task-auto/task-video-match.util";
import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import {
  TaskVideoMatchAiClient,
  TaskVideoMatchService,
  VideoMatchRunResult,
} from "../task-video-match.service";

/**
 * Một chức năng: khớp tự động video kênh nội bộ (FB/IG kéo về) với task rồi gắn link
 * bài đăng. Trọng số + guardrail rút từ 112 cặp người dùng đã tự gắn link:
 * tuyến #A<n> + team (huyk_channels) + đăng trong ±5 ngày là 3 mỏ neo; HOOK khớp TIÊU ĐỀ
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

describe("enforceChannelOwnerGuard", () => {
  const scored = [
    { task: task({ id: "owned", assigneeId: "user_1" }), score: 10, matchedBy: {} },
    { task: task({ id: "other", assigneeId: "user_2" }), score: 20, matchedBy: {} },
  ];

  it("biết chủ kênh thì loại task của người khác dù task đó điểm cao hơn", () => {
    const result = enforceChannelOwnerGuard(scored, OWNER_ONLY);
    expect(result.applied).toBe(true);
    expect(result.candidates.map((candidate) => candidate.task.id)).toEqual(["owned"]);
  });

  it("chưa biết chủ kênh thì giữ nguyên toàn bộ ứng viên", () => {
    const result = enforceChannelOwnerGuard(scored, NO_CHANNEL);
    expect(result.applied).toBe(false);
    expect(result.candidates).toEqual(scored);
  });

  it("biết chủ kênh nhưng không có task đúng chủ thì không tự chọn task người khác", () => {
    const result = enforceChannelOwnerGuard(
      [scored[1]],
      OWNER_ONLY,
    );
    expect(result.candidates).toEqual([]);
  });
});

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
  it("true khi mốc nộp trong ±5 ngày quanh lúc đăng", () => {
    expect(isWithinWindow(video(), task())).toBe(true);
  });
  it("true cả khi video đăng TRƯỚC mốc nộp <= 5 ngày", () => {
    expect(
      isWithinWindow(video(), task({ submittedAt: new Date("2026-08-24T00:00:00Z") })),
    ).toBe(true);
  });
  it("true khi lệch 4 ngày (trước đây ngoài cửa sổ ±2)", () => {
    expect(
      isWithinWindow(video(), task({ submittedAt: new Date("2026-08-16T03:00:00Z") })),
    ).toBe(true);
  });
  it("false khi lệch quá 5 ngày", () => {
    expect(
      isWithinWindow(video(), task({ submittedAt: new Date("2026-08-14T00:00:00Z") })),
    ).toBe(false);
    expect(
      isWithinWindow(video(), task({ submittedAt: new Date("2026-08-26T00:00:00Z") })),
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

  it("+4 khi hook caption khớp tiêu đề content, +4 nữa khi chứa trọn tiêu đề", () => {
    const hook = "Bí quyết chọn nhẫn cưới hợp mệnh không phải ai cũng biết rõ";
    const { score, matchedBy } = scoreCandidate(
      video({ caption: `${hook} #A4 #K401` }),
      task({ contentTitle: hook }),
      TEAM_1,
    );
    expect(score).toBe(3 + 4 + 3 + 4 + HOOK_FULL_MATCH_BONUS);
    expect(matchedBy.hook).toMatchObject({ full: true });
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
    expect(r.matchedBy.sku).toEqual(["n0018"]); // giữ tín hiệu ứng viên đầu để audit/review
    expect(r.candidateTaskId).toBe("task_1");
    expect(r.reason).toBe("WEAK_SIGNAL");
  });

  it("MATCHED khi hạng nhì điểm sát nhưng không có hook nên bản thân không đủ điều kiện thắng", () => {
    const eligible = withHook("task_1");
    const weakRunnerUp = {
      task: task({ id: "task_2" }),
      score: eligible.score - 1,
      matchedBy: {
        contentLine: "A4",
        team: true,
        timing: { days: 0 },
        channelOwner: true,
      },
    };

    const r = pickWinner([eligible, weakRunnerUp]);
    expect(r.reason).toBe("MATCHED");
    expect(r.taskId).toBe("task_1");
  });

  it("ứng viên đủ guardrail vẫn thắng khi một ứng viên yếu có tổng điểm cao hơn", () => {
    const eligible = withHook("task_1");
    const highButWeak = {
      task: task({ id: "task_2" }),
      score: eligible.score + 5,
      matchedBy: {
        contentLine: "A4",
        team: true,
        timing: { days: 0 },
        sku: ["n0018"],
        hashtags: ["trangsuc"],
      },
    };

    const r = pickWinner([highButWeak, eligible]);
    expect(r.reason).toBe("MATCHED");
    expect(r.taskId).toBe("task_1");
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

// Caption gắn nhầm #A1 cho task A4, tiêu đề task không giống caption, chỉ #SKU trùng.
describe("pickWinner — đường #SKU thay cho tuyến + hook", () => {
  const CAPTION = "Lắc tay áo giáp #L0026 #K401 #A1 #moissanite";
  const skuTask = (id: string, over: Partial<CandidateTask> = {}) => ({
    task: task({ id }),
    ...scoreCandidate(
      video({ caption: CAPTION }),
      task({
        id,
        contentLineName: "A4",
        contentTitle: "sản phẩm không định làm lần 2",
        productSkus: ["l0026-05-s-wh"],
        ...over,
      }),
      TEAM_1_OWNED,
    ),
  });

  it("MATCHED khi #SKU trỏ về đúng 1 task của chủ kênh, đăng cách ≤ 1 ngày — dù lệch tuyến, không hook", () => {
    const s = skuTask("task_1");
    expect(s.matchedBy.hook).toBeUndefined();
    expect(s.matchedBy.contentLine).toBeUndefined();

    const r = pickWinner([s]);
    expect(r.reason).toBe("MATCHED");
    expect(r.taskId).toBe("task_1");
    expect(r.matchedBy.skuPath).toBe(true);
  });

  it("WEAK_SIGNAL khi 2 task cùng mang #SKU đó (editor làm nhiều video cùng sản phẩm)", () => {
    expect(pickWinner([skuTask("task_1"), skuTask("task_2")]).reason).toBe("WEAK_SIGNAL");
  });

  it("WEAK_SIGNAL khi #SKU còn khớp task đã có link (skuTakenElsewhere)", () => {
    expect(pickWinner([skuTask("task_1")], { skuTakenElsewhere: true }).reason).toBe(
      "WEAK_SIGNAL",
    );
  });

  it("WEAK_SIGNAL khi đăng cách mốc task > 1 ngày", () => {
    const late = skuTask("task_1", { submittedAt: new Date("2026-08-18T12:00:00.000Z") });
    expect(pickWinner([late]).reason).toBe("WEAK_SIGNAL");
  });

  it("WEAK_SIGNAL khi không biết chủ kênh (chỉ có team)", () => {
    const s = {
      task: task(),
      ...scoreCandidate(
        video({ caption: CAPTION }),
        task({ contentLineName: "A4", productSkus: ["l0026-05-s-wh"] }),
        TEAM_1,
      ),
    };
    expect(pickWinner([s]).reason).toBe("WEAK_SIGNAL");
  });

  it("ứng viên khớp tiêu đề hơn ≥ 4 điểm vẫn thắng — đường #SKU không đè đường nội dung", () => {
    const byTitle = {
      task: task({ id: "task_2" }),
      ...scoreCandidate(
        video({ caption: CAPTION }),
        task({ id: "task_2", contentLineName: "A1", contentTitle: "Lắc tay áo giáp" }),
        TEAM_1_OWNED,
      ),
    };
    const r = pickWinner([skuTask("task_1"), byTitle]);
    expect(r.reason).toBe("MATCHED");
    expect(r.taskId).toBe("task_2");
    expect(r.matchedBy.skuPath).toBeUndefined();
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

describe("titleCoverage — khớp một phần tiêu đề ngắn", () => {
  it("tiêu đề 3 âm tiết trùng hệt hook → 1 (tokenOverlapRatio trả 0 vì < 4 từ)", () => {
    expect(tokenOverlapRatio("Lắc tay tennis.", "Lắc tay tennis")).toBe(0);
    expect(titleCoverage("Lắc tay tennis.", "Lắc tay tennis")).toBe(1);
  });

  it("hook dài chứa trọn tiêu đề ngắn → 1", () => {
    expect(
      titleCoverage(
        "Cổ tay xinh thì không thể thiếu chiếc lắc tay hoa tử đằng này rồi!",
        "hoa tử đằng",
      ),
    ).toBe(1);
  });

  it("tiêu đề gõ không dấu vẫn khớp hook có dấu ('qua' ~ 'quá')", () => {
    expect(
      titleCoverage(
        "Mẹo xử lý mặt dây chuyền lỗ xỏ quá nhỏ cực kỳ đơn giản mà ai cũng làm được.",
        "mẹo xỏ dây chuyền không qua",
      ),
    ).toBe(1);
  });

  it("giữ dấu: 'lá' (chủ đề) không bị coi là từ đệm 'là'", () => {
    expect(
      titleCoverage("Dây chuyền tâm quang.", "Dây chuyền lá phong"),
    ).toBeLessThan(0.6);
  });

  it("âm tiết ngắn phân biệt vẫn tính: 'cỏ 4 lá' ≠ 'răng cưa'", () => {
    expect(
      titleCoverage("Nhẫn xoay răng cưa", "nhẫn xoay cỏ 4 lá"),
    ).toBeLessThan(0.6);
  });

  it("trùng rời rạc không thành cụm liền nhau → 0", () => {
    expect(
      titleCoverage(
        "Đổ thạch Trung Quốc khác gì so với đổ thạch Việt Nam.",
        "quốc thạch",
      ),
    ).toBe(0);
  });

  it("chỉ trùng 1 âm tiết → 0", () => {
    expect(titleCoverage("Vàng 24K có đổi màu không?", "vàng tây")).toBe(0);
  });
});

describe("scoreCandidate — hook khớp một phần tiêu đề", () => {
  it("tiêu đề ngắn nằm trọn trong hook → +4 (matchedBy.hook.coverage)", () => {
    const { score, matchedBy } = scoreCandidate(
      video({ caption: "Lắc tay tennis. #K401 #A4 #C #L0008 #moissanite" }),
      task({ contentTitle: "Lắc tay tennis" }),
      TEAM_1,
    );
    expect(matchedBy.hook).toEqual({ overlap: 0, coverage: 1, full: true });
    // tuyến + team + cùng ngày + hook + chứa trọn tiêu đề
    expect(score).toBe(3 + 4 + 3 + 4 + HOOK_FULL_MATCH_BONUS);
  });

  it("MATCHED khi tiêu đề ngắn khớp một phần và tách được task còn lại", () => {
    const v = video({ caption: "Cổ tay xinh không thể thiếu lắc tay hoa tử đằng #A4 #K401" });
    const scored = [
      task({ id: "t_hoa", contentTitle: "hoa tử đằng" }),
      task({ id: "t_khac", contentTitle: "nhẫn kim sa" }),
    ].map((t) => ({ task: t, ...scoreCandidate(v, t, TEAM_1_OWNED) }));
    const w = pickWinner(scored);
    expect(w.reason).toBe("MATCHED");
    expect(w.taskId).toBe("t_hoa");
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

describe("hook chứa trọn tiêu đề — thắng task chỉ trùng phần khuôn", () => {
  // 2 task nộp cách nhau 3 phút, cùng khuôn "3 sự thật về".
  const v = video({
    caption: "3 sự thật về chiếc cúp giá trị nhất thế giới? #K304 #a2 #m #vienchibao",
  });
  const cup = task({ id: "t_cup", contentLineName: "A2", contentTitle: "3 sự thật về chiếc cup giá trị nhất thế giới" });
  const vang = task({ id: "t_vang", contentLineName: "A2", contentTitle: "3 sự thật về vàng" });

  it("khớp một phần (chỉ phần khuôn) vẫn +4 nhưng không có full", () => {
    const { matchedBy } = scoreCandidate(v, vang, TEAM_1_OWNED);
    expect(matchedBy.hook).toEqual({ overlap: 0, coverage: 0.8 });
  });

  it("MATCHED task khớp trọn tiêu đề thay vì AMBIGUOUS", () => {
    const scored = [vang, cup].map((t) => ({ task: t, ...scoreCandidate(v, t, TEAM_1_OWNED) }));
    const w = pickWinner(scored);
    expect(w.reason).toBe("MATCHED");
    expect(w.taskId).toBe("t_cup");
  });

  it("2 task cùng khớp trọn tiêu đề thì vẫn AMBIGUOUS", () => {
    const cup2 = { ...cup, id: "t_cup_2" };
    const scored = [cup, cup2].map((t) => ({ task: t, ...scoreCandidate(v, t, TEAM_1_OWNED) }));
    expect(pickWinner(scored).reason).toBe("AMBIGUOUS");
  });
});

describe("lớp AI — aiShortlist / acceptAiVerdict", () => {
  const scoredOf = (t: CandidateTask, matchedBy: Record<string, unknown>, score = 10) => ({
    task: t,
    score,
    matchedBy,
  });

  it("chỉ giữ ứng viên có mỏ neo kênh + tuyến + có chữ để so, sắp theo điểm", () => {
    const list = aiShortlist([
      scoredOf(task({ id: "no_anchor", contentTitle: "a" }), { contentLine: "A4" }, 20),
      scoredOf(task({ id: "no_line", contentTitle: "a" }), { team: true }, 20),
      scoredOf(task({ id: "no_text" }), { team: true, contentLine: "A4" }, 20),
      scoredOf(task({ id: "low", contentTitle: "a" }), { channelOwner: true, contentLine: "A4" }, 8),
      scoredOf(
        task({ id: "product_only", productNames: ["Lắc tay tennis"] }),
        { team: true, contentLine: "A4" },
        12,
      ),
    ]);
    expect(list.map((c) => c.task.id)).toEqual(["product_only", "low"]);
  });

  it("cắt còn tối đa `max` ứng viên", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      scoredOf(task({ id: `t${i}`, contentTitle: "x" }), { team: true, contentLine: "A4" }, i),
    );
    expect(aiShortlist(many, 8)).toHaveLength(8);
  });

  it("chỉ nhận task trong danh sách đã gửi và đủ tự tin", () => {
    const list = [
      { id: "a", contentTitle: "nhẫn kim vũ", productSkus: [] },
      { id: "b", contentTitle: "bông tai cỏ 4 lá", productSkus: [] },
    ];
    expect(acceptAiVerdict({ taskId: "a", confidence: 0.9 }, list, 0.85)).toEqual({ taskId: "a" });
    expect(acceptAiVerdict({ taskId: "a", confidence: 0.8 }, list, 0.85).rejected).toBe("LOW_CONFIDENCE");
    expect(acceptAiVerdict({ taskId: "z", confidence: 1 }, list, 0.85).rejected).toBe("NOT_IN_SHORTLIST");
    expect(acceptAiVerdict({ taskId: null, confidence: 1 }, list, 0.85)).toEqual({
      taskId: null,
      rejected: "NO_PICK",
    });
    expect(acceptAiVerdict(undefined, list, 0.85).taskId).toBeNull();
  });

  it("task nhân bản trùng hệt tiêu đề (khác dấu/hoa thường) ⇒ không nhận", () => {
    const list = [
      { id: "a", contentTitle: "mất 10s đo size nhẫn tại nhà", productSkus: [] },
      { id: "b", contentTitle: "Mất 10s đo size nhẫn tại nhà ", productSkus: [] },
    ];
    expect(acceptAiVerdict({ taskId: "a", confidence: 0.98 }, list, 0.85)).toEqual({
      taskId: null,
      rejected: "DUPLICATE_TITLE",
    });
  });

  it("#SKU caption cùng họ mã nhưng khác số với task được chọn ⇒ không nhận (2 sản phẩm khác nhau)", () => {
    const list = [
      { id: "st25", contentTitle: "Chiếc dây chuyền này ấy sau này HuyK sẽ không giới thiệu nữa", productSkus: ["st0025"] },
      { id: "vongco", contentTitle: "Chiếc vòng cổ này ấy sau này HuyK sẽ không giới thiệu nữa đâu", productSkus: [] },
    ];
    const caption = "HuyK sẽ không giới thiệu nữa đâu. #ST0026 #K302 #A4";
    expect(acceptAiVerdict({ taskId: "st25", confidence: 0.9 }, list, 0.85, caption)).toEqual({
      taskId: null,
      rejected: "SKU_CONFLICT",
    });
  });

  it("#SKU caption trùng đúng task KHÁC trong danh sách ⇒ không nhận task AI chọn", () => {
    const list = [
      { id: "khong_sku", contentTitle: "Món quà cho người thương", productSkus: [] },
      { id: "co_sku", contentTitle: "Dây chuyền cỏ 4 lá", productSkus: ["d0019-00-s-wh"] },
    ];
    const caption = "Món quà không đo bằng giá trị. #D0019 #K302 #A4";
    expect(acceptAiVerdict({ taskId: "khong_sku", confidence: 0.9 }, list, 0.85, caption).rejected).toBe(
      "SKU_POINTS_ELSEWHERE",
    );
    expect(acceptAiVerdict({ taskId: "co_sku", confidence: 0.9 }, list, 0.85, caption).taskId).toBe("co_sku");
  });

  it("SKU khác HỌ mã (2 hệ mã) ⇒ không kết luận, vẫn nhận", () => {
    const other = [{ id: "a", contentTitle: "Nhẫn tàng hình", productSkus: ["nm101-4"] }];
    expect(acceptAiVerdict({ taskId: "a", confidence: 0.9 }, other, 0.85, "Nhẫn đẹp #N0006").taskId).toBe("a");
    expect(skuFamilyConflict(["n0006"], ["nm101-4"])).toBe(false);
    expect(skuFamilyConflict(["st0026"], ["st0025"])).toBe(true);
    expect(skuFamilyConflict(["d0018"], ["d0018-00-s-yl"])).toBe(false);
  });

  it("gần trùng tiêu đề: nhân bản thì có, cùng khuôn câu thì không", () => {
    expect(nearDuplicateTitles("mất 10s đo size nhẫn tại nhà", "Mất 10s đo size nhẫn tại nhà ")).toBe(true);
    expect(nearDuplicateTitles("3 sự thật về vàng", "3 sự thật về chiếc cup giá trị nhất thế giới")).toBe(false);
    expect(nearDuplicateTitles("Nhẫn tàng hình", "Nhẫn tàng hình đính moissanite")).toBe(false);
  });

  it("task nhân bản đã có link cùng nền tảng không còn là đối thủ", () => {
    const list = [
      { id: "a", contentTitle: "mẹo bảo vệ vòng vàng", productSkus: [], occupied: true },
      { id: "b", contentTitle: "Mẹo bảo vệ vòng vàng", productSkus: [] },
    ];
    expect(acceptAiVerdict({ taskId: "b", confidence: 0.95 }, list, 0.85).taskId).toBe("b");
  });

  it("xếp danh sách gửi AI theo độ gần về chữ trước điểm heuristic", () => {
    const caption = "Đo size nhẫn tại nhà. #K302 #A1";
    const list = aiShortlist(
      [
        scoredOf(task({ id: "lam_sang", contentTitle: "Làm sáng vàng tại nhà" }), { team: true, contentLine: "A1" }, 14),
        scoredOf(task({ id: "do_size", contentTitle: "30 năm sống rồi mới biết đo size nhẫn đơn giản như này" }), { team: true, contentLine: "A1" }, 10),
      ],
      1,
      caption,
    );
    expect(list.map((c) => c.task.id)).toEqual(["do_size"]);
    // "đo size nhẫn" có, "tại nhà" không ⇒ 3/5.
    expect(textAffinity(caption, task({ contentTitle: "30 năm sống rồi mới biết đo size nhẫn đơn giản như này" }))).toBeCloseTo(0.6);
  });

  it("không gửi AI ứng viên ngoài cửa sổ ±5 ngày", () => {
    const list = aiShortlist([
      scoredOf(task({ id: "far", contentTitle: "a" }), { team: true, contentLine: "A4", farWindow: { days: 8, allowed: false } }, 20),
      scoredOf(task({ id: "near", contentTitle: "a" }), { team: true, contentLine: "A4" }, 10),
    ]);
    expect(list.map((c) => c.task.id)).toEqual(["near"]);
  });
});

describe("cửa sổ mở rộng ±10 ngày — chỉ khi khớp trọn tiêu đề dài", () => {
  // Video đăng 20/8 03:00Z; task nộp trước đó 8 ngày.
  const far = { submittedAt: new Date("2026-08-12T03:00:00Z") };

  it("isWithinFarWindow: trong ±10 ngày, ngoài thì không", () => {
    expect(isWithinFarWindow(video(), task(far))).toBe(true);
    expect(isWithinWindow(video(), task(far))).toBe(false);
    expect(isWithinFarWindow(video(), task({ submittedAt: new Date("2026-08-09T00:00:00Z") }))).toBe(false);
  });

  it("MATCHED khi hook chứa trọn tiêu đề dài (≥5 âm tiết có nghĩa)", () => {
    const v = video({ caption: "Có nên đổi môi trường làm việc? #A4 #K401" });
    const t = task({ ...far, contentTitle: "Có nên đổi môi trường làm việc" });
    const scored = [{ task: t, ...scoreCandidate(v, t, TEAM_1_OWNED) }];
    expect(scored[0].matchedBy.farWindow).toEqual({ days: 8, allowed: true });
    expect(pickWinner(scored).reason).toBe("MATCHED");
  });

  it("tiêu đề ngắn kiểu tên sản phẩm ⇒ không cho gắn ngoài ±5 ngày", () => {
    const v = video({ caption: "Nhẫn tàng hình đính full đá moissanite #A4 #K401" });
    const t = task({ ...far, contentTitle: "Nhẫn tàng hình" });
    const scored = [{ task: t, ...scoreCandidate(v, t, TEAM_1_OWNED) }];
    expect(scored[0].matchedBy.farWindow).toMatchObject({ allowed: false });
    expect(pickWinner(scored).reason).toBe("WEAK_SIGNAL");
  });

  it("khớp một phần (không trọn) ⇒ không cho gắn ngoài ±5 ngày", () => {
    const v = video({ caption: "Nhiều người hỏi mẫu này nhưng ngại giá vàng quá cao #A4 #K401" });
    const t = task({ ...far, contentTitle: "Nhiều anh em thích mẫu này nhưng ngại vì giá" });
    const { matchedBy } = scoreCandidate(v, t, TEAM_1_OWNED);
    expect((matchedBy.farWindow as any)?.allowed).toBe(false);
  });
});

const EMPTY_RESULT: VideoMatchRunResult = {
  considered: 0,
  matched: 0,
  alreadyLinked: 0,
  unmatched: 0,
  ambiguous: 0,
  mappedItems: [],
  existingMappedItems: [],
};

function buildService(params?: {
  ledTeamIds?: string[];
  memberTeamIds?: string[];
}) {
  const prisma = {
    team: {
      findMany: jest.fn().mockResolvedValue(
        (params?.ledTeamIds ?? []).map((id) => ({ id })),
      ),
    },
    teamMember: {
      findMany: jest.fn().mockResolvedValue(
        (params?.memberTeamIds ?? []).map((team_id) => ({ team_id })),
      ),
    },
  };
  const service = new TaskVideoMatchService(prisma as any, {} as any);
  const run = jest
    .spyOn(service, "runDailyMatch")
    .mockResolvedValue(EMPTY_RESULT);
  return { prisma, run, service };
}

describe("TaskVideoMatchService.runManualMatch — role scope", () => {
  it("ADMIN/MANAGER giữ nguyên bộ lọc được gửi lên", async () => {
    const { prisma, run, service } = buildService();
    const opts = { teamIds: ["team-a"], assigneeId: "editor-a" };

    await service.runManualMatch(opts, {
      id: "admin",
      roles: [UserRole.ADMIN],
    });

    // Lượt bấm tay luôn bị giới hạn số video để xong trong timeout của FE.
    expect(run).toHaveBeenCalledWith({ ...opts, maxVideos: 3000 });
    expect(prisma.team.findMany).not.toHaveBeenCalled();
    expect(prisma.teamMember.findMany).not.toHaveBeenCalled();
  });

  it("LEADER chỉ map giao của bộ lọc với các team mình quản lý", async () => {
    const { prisma, run, service } = buildService({
      ledTeamIds: ["team-a", "team-b"],
    });

    await service.runManualMatch(
      { teamIds: ["team-b", "team-outside"] },
      { id: "leader", roles: [UserRole.LEADER] },
    );

    expect(prisma.team.findMany).toHaveBeenCalledWith({
      where: { leader_id: "leader" },
      select: { id: true },
    });
    expect(run).toHaveBeenCalledWith({ teamIds: ["team-b"], maxVideos: 3000 });
  });

  it("LEADER không có team nhận scope rỗng, không rơi về map tất cả", async () => {
    const { run, service } = buildService({ ledTeamIds: [] });

    await service.runManualMatch({}, {
      id: "leader",
      roles: [UserRole.LEADER],
    });

    expect(run).toHaveBeenCalledWith({ teamIds: [], maxVideos: 3000 });
  });

  it("MEMBER luôn bị ép về chính mình và team mình tham gia", async () => {
    const { prisma, run, service } = buildService({
      memberTeamIds: ["team-a", "team-b"],
    });

    await service.runManualMatch(
      { teamIds: ["team-a", "team-outside"], assigneeId: "other-user" },
      { id: "member", roles: [UserRole.MEMBER] },
    );

    expect(prisma.teamMember.findMany).toHaveBeenCalledWith({
      where: { user_id: "member" },
      select: { team_id: true },
    });
    expect(run).toHaveBeenCalledWith({
      teamIds: ["team-a"],
      assigneeId: "member",
      maxVideos: 3000,
    });
  });

  it("từ chối lượt chạy không có danh tính người dùng", async () => {
    const { service } = buildService();
    await expect(service.runManualMatch({}, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("TaskVideoMatchService — lớp AI cho ca heuristic bỏ trống", () => {
  const publishedAt = new Date("2026-09-25T10:45:59.000Z");
  const video = {
    platform: "FACEBOOK" as const,
    postId: "p1",
    url: "https://www.facebook.com/reel/1066711909457133/",
    caption: "3 sự thật về chiếc cúp giá trị nhất thế giới? #K304 #a2",
    hashtags: [],
    publishedAt,
    channelKey: "page",
  };
  const candidate = (id: string, title: string) => ({
    id,
    teamId: "k3",
    assigneeId: "hanh",
    contentLineName: "A2",
    scriptHashtags: [],
    scriptContent: "",
    contentTitle: title,
    productSkus: [],
    submittedAt: new Date("2026-09-24T14:52:58.000Z"),
    reviewedAt: null,
    deadline: null,
  });
  const cup = candidate("t_cup", "3 sự thật về chiếc cup giá trị nhất thế giới");
  const vang = candidate("t_vang", "3 sự thật về vàng");
  const loaded = (c: ReturnType<typeof candidate>, publishedLinks: any[] = []) => ({
    id: c.id,
    assigneeName: "Hạnh",
    teamName: "K3",
    publishedLinks,
    candidate: c,
  });
  const pending = () => ({
    video,
    shortlist: [cup, vang].map((task) => ({
      task,
      score: 18,
      matchedBy: { team: true, contentLine: "A2", hook: {} },
    })),
    status: "SKIPPED_AMBIGUOUS",
    score: 18,
    audit: { reason: "AMBIGUOUS" },
  });

  function setup(params: {
    mode: "suggest" | "apply";
    verdict?: { taskId: string | null; confidence: number; error?: string };
    cupLinks?: any[];
    priorAi?: Map<string, any>;
  }) {
    const prisma = {
      ownedVideoScript: { findMany: jest.fn().mockResolvedValue([]) },
      taskVideoMatch: { upsert: jest.fn().mockResolvedValue({}) },
      task: {
        findUnique: jest.fn().mockResolvedValue({ published_links: [], updated_at: new Date(0) }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const results = new Map(params.verdict ? [["FACEBOOK:p1", params.verdict]] : []);
    const aiJudge = {
      minConfidence: 0.85,
      judge: jest.fn().mockResolvedValue({ model: "deepseek-v4-flash", results }),
    };
    const service = new TaskVideoMatchService(
      prisma as any,
      { fetchStatsForLink: jest.fn().mockResolvedValue(undefined) } as any,
      aiJudge as any,
    );
    const tasks = [loaded(cup, params.cupLinks ?? []), loaded(vang)];
    const run = (queue = [pending()]) =>
      (service as any).runAiPass(queue, {
        mode: params.mode,
        tasks,
        claimedTasks: new Set<string>(),
        priorAi: params.priorAi ?? new Map(),
        videoIndex: new Map(),
      });
    return { prisma, aiJudge, service, tasks, run };
  }

  const lastUpsert = (prisma: any) =>
    prisma.taskVideoMatch.upsert.mock.calls.at(-1)[0].update;

  it("apply: AI tự tin chọn task chưa có link ⇒ gắn link auto-match-ai + MATCHED", async () => {
    const { prisma, run } = setup({
      mode: "apply",
      verdict: { taskId: "t_cup", confidence: 0.95 },
    });
    const out = await run();

    expect(prisma.task.updateMany).toHaveBeenCalledTimes(1);
    const links = prisma.task.updateMany.mock.calls[0][0].data.published_links;
    expect(links[0]).toMatchObject({ url: video.url, source: "auto-match-ai" });
    expect(lastUpsert(prisma)).toMatchObject({ task_id: "t_cup", status: "MATCHED" });
    expect(lastUpsert(prisma).matched_by).toMatchObject({ source: "ai" });
    expect(out.transitions).toEqual([{ from: "SKIPPED_AMBIGUOUS", to: "MATCHED" }]);
    expect(out.stats).toMatchObject({ asked: 1, confident: 1, attached: 1 });
  });

  it("suggest: chỉ lưu gợi ý vào audit, không gắn link, giữ trạng thái heuristic", async () => {
    const { prisma, run } = setup({
      mode: "suggest",
      verdict: { taskId: "t_cup", confidence: 0.95 },
    });
    const out = await run();

    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(lastUpsert(prisma)).toMatchObject({ task_id: null, status: "SKIPPED_AMBIGUOUS" });
    expect(lastUpsert(prisma).matched_by.ai).toMatchObject({ taskId: "t_cup", accepted: true });
    expect(out.transitions).toEqual([]);
  });

  it("apply: task AI chọn đã có link cùng nền tảng ⇒ không gắn (có thể là bản đăng lại)", async () => {
    const { prisma, run } = setup({
      mode: "apply",
      verdict: { taskId: "t_cup", confidence: 0.99 },
      cupLinks: [{ platform: "Facebook", url: "https://www.facebook.com/reel/999999999/" }],
    });
    await run();

    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(lastUpsert(prisma).matched_by).toMatchObject({
      reason: "TASK_ALREADY_HAS_PLATFORM_VIDEO",
      candidateTaskId: "t_cup",
    });
  });

  it("apply: AI không đủ tự tin ⇒ không gắn, giữ trạng thái heuristic", async () => {
    const { prisma, run } = setup({
      mode: "apply",
      verdict: { taskId: "t_cup", confidence: 0.7 },
    });
    await run();

    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(lastUpsert(prisma)).toMatchObject({ status: "SKIPPED_AMBIGUOUS" });
    expect(lastUpsert(prisma).matched_by.ai).toMatchObject({ accepted: false });
  });

  it("AI service lỗi ⇒ không ghi đè bản ghi heuristic (lượt sau hỏi lại)", async () => {
    const { prisma, run } = setup({
      mode: "apply",
      verdict: { taskId: null, confidence: 0, error: "network" },
    });
    const out = await run();

    expect(prisma.taskVideoMatch.upsert).not.toHaveBeenCalled();
    expect(out.stats).toMatchObject({ asked: 1, failed: 1 });
  });

  it("đầu vào không đổi ⇒ dùng lại phán quyết cũ, không gọi AI", async () => {
    const first = setup({ mode: "suggest" });
    const { inputHash } = (first.service as any).buildAiCase(
      pending(),
      new Map(first.tasks.map((t) => [t.id, t])),
      new Map(),
      new Map(),
    );
    const prior = new Map([
      ["FACEBOOK:p1", { taskId: "t_cup", confidence: 0.95, inputHash, model: "m", promptVersion: 1, judgedAt: "x" }],
    ]);
    const { aiJudge, run } = setup({ mode: "suggest", priorAi: prior });
    const out = await run();

    expect(aiJudge.judge).not.toHaveBeenCalled();
    expect(out.stats).toMatchObject({ asked: 0, cached: 1, confident: 1 });
  });
});

describe("TaskVideoMatchAiClient.getMode — nút bật AI trên UI", () => {
  const clientWith = (findUnique: jest.Mock) =>
    new TaskVideoMatchAiClient({} as any, {} as any, { autoAssignSetting: { findUnique } } as any);

  it("cờ video_match_ai_enabled bật ⇒ apply", async () => {
    const client = clientWith(jest.fn().mockResolvedValue({ video_match_ai_enabled: true }));
    await expect(client.getMode()).resolves.toBe("apply");
  });

  it("cờ tắt, chưa có dòng cài đặt hoặc lỗi DB ⇒ off", async () => {
    await expect(clientWith(jest.fn().mockResolvedValue({ video_match_ai_enabled: false })).getMode()).resolves.toBe("off");
    await expect(clientWith(jest.fn().mockResolvedValue(null)).getMode()).resolves.toBe("off");
    await expect(clientWith(jest.fn().mockRejectedValue(new Error("db down"))).getMode()).resolves.toBe("off");
  });
});

describe("TaskVideoMatchService — lượt map chỉ xét task chưa có link Facebook", () => {
  const publishedAt = new Date("2026-09-25T10:45:59.000Z");
  const TITLE = "3 sự thật về chiếc cúp giá trị nhất thế giới";
  const fbVideo = (over: Record<string, unknown> = {}) => ({
    platform: "FACEBOOK" as const,
    postId: "p1",
    url: "https://www.facebook.com/reel/1066711909457133/",
    caption: `${TITLE}? #a2`,
    hashtags: [],
    publishedAt,
    channelKey: "page_hanh",
    ...over,
  });
  const loaded = (
    id: string,
    title: string,
    publishedLinks: any[] = [],
    over: Record<string, unknown> = {},
  ) => ({
    id,
    assigneeName: "Hạnh",
    teamName: "K3",
    publishedLinks,
    candidate: {
      id,
      teamId: "k3",
      assigneeId: "hanh",
      contentLineName: "A2",
      scriptHashtags: [],
      scriptContent: "",
      contentTitle: title,
      productSkus: [],
      submittedAt: new Date("2026-09-24T14:52:58.000Z"),
      reviewedAt: null,
      deadline: null,
      ...over,
    },
  });
  const FB_LINK = { platform: "Facebook", url: "https://www.facebook.com/reel/999999999/" };

  function setup(videos: any[], tasks: any[], dbPosts: any[] = []) {
    const prisma = {
      // Link FB cũ hơn cửa sổ video đã nạp — loadLinkedFacebookPosts tra theo permalink.
      video_management_ownedvideocontent: {
        findMany: jest.fn().mockResolvedValue(dbPosts),
      },
      taskVideoMatch: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      task: {
        findUnique: jest.fn().mockResolvedValue({ published_links: [], updated_at: new Date(0) }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new TaskVideoMatchService(prisma as any, {
      fetchStatsForLink: jest.fn().mockResolvedValue(undefined),
    } as any);
    const svc = service as any;
    jest.spyOn(svc, "loadFacebookVideos").mockResolvedValue(videos);
    jest.spyOn(svc, "loadCandidateTasks").mockResolvedValue(tasks);
    jest.spyOn(svc, "loadExistingMappedItems").mockResolvedValue([]);
    jest.spyOn(svc, "buildChannelResolver").mockResolvedValue({
      resolve: () => ({ teamIdFromChannel: "k3", channelOwnerId: "hanh" }),
    });
    const decide = jest.spyOn(svc, "decide");
    return { prisma, service, decide };
  }

  it("task đã có link Facebook không được đưa vào chấm điểm", async () => {
    const { prisma, service, decide } = setup(
      [fbVideo()],
      [loaded("t_cup", TITLE, [FB_LINK]), loaded("t_nhan", "Cách bảo quản nhẫn bạc")],
    );
    const out = await service.runDailyMatch();

    expect(out.considered).toBe(1);
    const scoredIds = (decide.mock.calls[0][1] as any[]).map((t) => t.id);
    expect(scoredIds).toEqual(["t_nhan"]);
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("chủ kênh không còn task nào chưa gắn link ⇒ bỏ qua video, không ghi audit", async () => {
    const { prisma, service, decide } = setup(
      [fbVideo()],
      [loaded("t_cup", TITLE, [FB_LINK])],
    );
    const out = await service.runDailyMatch();

    expect(out.considered).toBe(0);
    expect(decide).not.toHaveBeenCalled();
    expect(prisma.taskVideoMatch.upsert).not.toHaveBeenCalled();
  });

  it("video đã nằm sẵn trong task có link ⇒ vẫn nhận ra là đã gắn, không gắn sang task khác", async () => {
    const video = fbVideo();
    const { prisma, service, decide } = setup(
      [video],
      [
        loaded("t_cup", TITLE, [{ platform: "Facebook", url: video.url }]),
        loaded("t_cup2", TITLE),
      ],
    );
    const out = await service.runDailyMatch();

    expect(out.alreadyLinked).toBe(1);
    expect(decide).not.toHaveBeenCalled();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
    expect(prisma.taskVideoMatch.upsert.mock.calls[0][0].update).toMatchObject({
      task_id: "t_cup",
      status: "MATCHED",
    });
  });

  it("task chỉ có link nền tảng khác (IG) vẫn được gắn link Facebook", async () => {
    const { prisma, service } = setup(
      [fbVideo()],
      [loaded("t_cup", TITLE, [{ platform: "Instagram", url: "https://www.instagram.com/reel/AbC123/" }])],
    );
    const out = await service.runDailyMatch();

    expect(out.matched).toBe(1);
    expect(prisma.task.updateMany.mock.calls[0][0].where).toMatchObject({ id: "t_cup" });
  });

  describe("đường #SKU", () => {
    const skuVideo = () =>
      fbVideo({ postId: "p_sku", caption: "Lắc tay áo giáp #L0026 #k305 #A1 #moissanite" });
    const skuTask = (id: string, links: any[] = []) =>
      loaded(id, "sản phẩm không định làm lần 2", links, {
        contentLineName: "A4",
        productSkus: ["l0026-05-s-wh"],
      });

    it("#SKU trỏ về đúng 1 task chưa có link ⇒ gắn", async () => {
      const { prisma, service } = setup([skuVideo()], [skuTask("t_sku")]);
      const out = await service.runDailyMatch();

      expect(out.matched).toBe(1);
      expect(prisma.task.updateMany.mock.calls[0][0].where).toMatchObject({ id: "t_sku" });
      expect(prisma.taskVideoMatch.upsert.mock.calls[0][0].update.matched_by).toMatchObject({
        skuPath: true,
        matcherVersion: 7,
      });
    });

    it("#SKU còn khớp task khác ĐÃ có link Facebook ⇒ không gắn (có thể là bản đăng lại)", async () => {
      const { prisma, service } = setup(
        [skuVideo()],
        [skuTask("t_sku"), skuTask("t_da_co_link", [FB_LINK])],
      );
      const out = await service.runDailyMatch();

      expect(out.matched).toBe(0);
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("bài đăng lại ở page khác của cùng chủ kênh", () => {
    const REEL_A = "https://www.facebook.com/reel/1111111111/";
    const REEL_B = "https://www.facebook.com/reel/2222222222/";
    const onPageA = (over: Record<string, unknown> = {}) =>
      fbVideo({ postId: "pA", url: REEL_A, channelKey: "page_a", ...over });
    const onPageB = (over: Record<string, unknown> = {}) =>
      fbVideo({
        postId: "pB",
        url: REEL_B,
        channelKey: "page_b",
        publishedAt: new Date("2026-09-25T12:00:00.000Z"),
        ...over,
      });
    const linkA = { platform: "Facebook", url: REEL_A };
    const attachedUrls = (prisma: any) =>
      prisma.task.updateMany.mock.calls.map((c: any[]) => [
        c[0].where.id,
        c[0].data.published_links.at(-1).url,
        c[0].data.published_links.at(-1).source,
      ]);

    it("task đã có bản ở page A ⇒ bản cùng caption ở page B được gắn vào đúng task đó", async () => {
      const { prisma, service } = setup(
        [onPageA(), onPageB()],
        [loaded("t_cup", TITLE, [linkA])],
      );
      const out = await service.runDailyMatch();

      expect(out.matched).toBe(1);
      expect(attachedUrls(prisma)).toEqual([["t_cup", REEL_B, "auto-match-repost"]]);
      const audit = prisma.taskVideoMatch.upsert.mock.calls
        .map((c: any[]) => c[0])
        .find((a: any) => a.where.platform_post_id.post_id === "pB");
      expect(audit.update).toMatchObject({
        task_id: "t_cup",
        status: "MATCHED",
        matched_by: { source: "repost-other-page", fromPage: "page_a", matcherVersion: 7 },
      });
    });

    it("bản gốc và bản đăng lại cùng nằm trong một lượt ⇒ task nhận cả 2 link", async () => {
      const { prisma, service } = setup([onPageA(), onPageB()], [loaded("t_cup", TITLE)]);
      const out = await service.runDailyMatch();

      expect(out.matched).toBe(2);
      expect(attachedUrls(prisma)).toEqual([
        ["t_cup", REEL_A, "auto-match"],
        ["t_cup", REEL_B, "auto-match-repost"],
      ]);
    });

    it("link page A cũ hơn cửa sổ ⇒ tra page + caption trong DB theo permalink", async () => {
      const { prisma, service } = setup(
        [onPageB()],
        [loaded("t_cup", TITLE, [linkA])],
        [{ permalink_url: REEL_A, caption: `${TITLE}? #a2`, managed_page: { page_id: "page_a" } }],
      );
      const out = await service.runDailyMatch();

      expect(out.matched).toBe(1);
      expect(attachedUrls(prisma)).toEqual([["t_cup", REEL_B, "auto-match-repost"]]);
    });

    it("cùng page, khác caption, hoặc link FB không tra ra page ⇒ không coi là đăng lại", async () => {
      for (const [video, links] of [
        [onPageB({ channelKey: "page_a" }), [linkA]],
        [onPageB({ caption: "Cách bảo quản nhẫn bạc luôn sáng bóng #a2" }), [linkA]],
        [onPageB(), [FB_LINK]],
      ] as const) {
        const { prisma, service } = setup([onPageA(), video], [loaded("t_cup", TITLE, [...links])]);
        const out = await service.runDailyMatch();

        expect(out.matched).toBe(0);
        expect(prisma.task.updateMany).not.toHaveBeenCalled();
      }
    });

    it("2 task cùng có bản ở page A trùng caption ⇒ không đoán", async () => {
      const REEL_A2 = "https://www.facebook.com/reel/3333333333/";
      const { prisma, service } = setup(
        [onPageA(), onPageA({ postId: "pA2", url: REEL_A2 }), onPageB()],
        [
          loaded("t_cup", TITLE, [linkA]),
          loaded("t_cup2", TITLE, [{ platform: "Facebook", url: REEL_A2 }]),
        ],
      );
      const out = await service.runDailyMatch();

      expect(out.matched).toBe(0);
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
    });

    it("không biết chủ kênh ⇒ không áp dụng (không chắc 2 page cùng một người)", async () => {
      const { prisma, service } = setup(
        [onPageA(), onPageB()],
        [loaded("t_cup", TITLE, [linkA])],
      );
      jest.spyOn(service as any, "buildChannelResolver").mockResolvedValue({
        resolve: () => ({ teamIdFromChannel: "k3", channelOwnerId: null }),
      });
      const out = await service.runDailyMatch();

      expect(out.matched).toBe(0);
      expect(prisma.task.updateMany).not.toHaveBeenCalled();
    });
  });
});
