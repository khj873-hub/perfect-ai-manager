import type { Db } from "../domain/types";

// 데이터 소스 인터페이스 — 도구가 매장 데이터를 읽는 유일한 통로.
// 구현: FixtureSource(시드·테스트), PostgresSource(agent_v_* 뷰, 작업 #4).
//
// now(): 조회 기준 시각(as_of·detect 의 nowStamp 계산에 사용). 실운영은 실제 시각,
//        Fixture 는 고정 시각을 돌려줘 테스트를 결정적으로 만든다.
// storeIds(): 이 소스가 아는 매장 id 목록(존재 검증·디버깅용). 접근 권한 판정은
//             소스가 아니라 ctx.storeIds 로 한다(§4).
// load(storeId): 해당 매장의 도메인 데이터(Db 형태). 도메인 계산 함수가 그대로 소비한다.
export interface AttendanceSource {
  now(): Date;
  storeIds(): string[] | Promise<string[]>;
  load(storeId: string): Db | Promise<Db>;
}
