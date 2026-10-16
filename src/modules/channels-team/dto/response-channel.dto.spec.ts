import { ChannelResponseDto } from "./response-channel.dto";

const baseChannel = {
  id: "channel-1",
  name: "Kênh mẫu",
  created_at: new Date("2026-09-26T00:00:00.000Z"),
  updated_at: new Date("2026-09-26T00:00:00.000Z"),
};

describe("ChannelResponseDto", () => {
  it("exposes legacy team and owner names when foreign keys are unresolved", () => {
    const dto = new ChannelResponseDto({
      ...baseChannel,
      team_traffic: "Global - Mỹ",
      owner: "Bùi Anh Tú",
      channel_team: null,
      channel_owner: null,
    });

    expect(dto.team_name).toBe("Global - Mỹ");
    expect(dto.owner_name).toBe("Bùi Anh Tú");
    expect(dto.team).toBeNull();
    expect(dto.owner).toBeNull();
  });

  it("prefers source-of-truth text fields over relation display names", () => {
    const dto = new ChannelResponseDto({
      ...baseChannel,
      team_traffic: "Team theo Excel",
      owner: "Tên theo Excel",
      channel_team: { id: "team-1", name: "Thạch Anh Vàng" },
      channel_owner: {
        id: "user-1",
        full_name: "Nguyễn Văn A",
        email: "a@example.com",
      },
    });

    expect(dto.team_name).toBe("Team theo Excel");
    expect(dto.owner_name).toBe("Tên theo Excel");
  });
});
