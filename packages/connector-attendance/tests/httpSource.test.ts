import { describe, expect, it } from "vitest";
import { createHttpSource, type FetchLike } from "@/adapter/HttpSource";
import { createAttendanceConnector } from "@/index";
import { dayRecord } from "@/domain/records";
import type { ToolContext } from "@/tools/context";

const NOW = new Date("2026-09-23T01:00:00Z");
const STORE = "store_demo";
const okJson = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

let lastToken: string | undefined;
const fakeFetch: FetchLike = async (url, init) => {
  lastToken = init?.headers?.["x-agent-token"];
  if (url.includes("/api/agent/employees")) return okJson([{ id: "e1", name: "김민지", hourly_wage: 10320, active: 1 }]);
  if (url.includes("/api/agent/attendance"))
    return okJson([{ id: 1, employee_id: "e1", clock_in: "2026-09-22 09:17:00", clock_out: "2026-09-22 15:03:00" }]);
  if (url.includes("/api/agent/stores")) return okJson([{ id: STORE, name: "판교점" }]);
  return okJson([]);
};

const src = createHttpSource({
  baseUrl: "http://attendance.test",
  token: "secret-token",
  now: () => NOW,
  fetchFn: fakeFetch,
  storeSettings: () => ({ name: "판교점", graceMinutes: 5, fivePlus: true }),
});

describe("HttpSource", () => {
  it("세션행(clock_in+clock_out)을 in/out punch 로 펼쳐 Db 를 만든다", async () => {
    const db = await src.load(STORE);
    expect(db.employees[0].name).toBe("김민지");
    expect(db.store.name).toBe("판교점");
    expect(db.punches).toHaveLength(2); // in + out
    const rec = dayRecord(db, "e1", "2026-09-22");
    expect(rec.checkIn).toBe("09:17");
    expect(rec.checkOut).toBe("15:03");
    expect(lastToken).toBe("secret-token"); // 인증 헤더 전달
  });

  it("스케줄이 없으므로 shifts 는 비어 있다", async () => {
    const db = await src.load(STORE);
    expect(db.shifts).toHaveLength(0);
  });

  it("PII(phone/pin)는 비어 있다", async () => {
    const db = await src.load(STORE);
    expect(db.employees[0].phone).toBe("");
    expect(db.employees[0].pin).toBe("");
  });

  it("storeIds 를 조회한다", async () => {
    expect(await src.storeIds()).toEqual([STORE]);
  });

  it("커넥터 도구: get_day_records 는 동작, get_period_stats 는 schedule_unavailable", async () => {
    const conn = createAttendanceConnector(src);
    const ctx: ToolContext = { userId: "u", role: "owner", storeIds: [STORE], today: "2026-09-23" };

    const day = (await conn.tools.find((t) => t.name === "get_day_records")!.execute(ctx, { date: "2026-09-22" })) as {
      ok: boolean;
      records?: { name: string; check_in: string | null }[];
    };
    expect(day.ok).toBe(true);
    expect(day.records?.[0].check_in).toBe("09:17");

    const stats = (await conn.tools.find((t) => t.name === "get_period_stats")!.execute(ctx, {
      from: "2026-09-01",
      to: "2026-09-22",
    })) as { ok: boolean; error?: string };
    expect(stats.ok).toBe(false);
    expect(stats.error).toBe("schedule_unavailable");
  });
});
