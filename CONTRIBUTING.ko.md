# Agent Quest에 기여하기

<p>
  <a href="CONTRIBUTING.md">English</a> · <strong>한국어</strong>
</p>

관심 가져 주셔서 감사합니다. 이슈와 풀 리퀘스트를 언제나 환영합니다.

## 도울 수 있는 방법

- **버그 리포트** — 재현 단계, 사용 중인 OS, Bun 버전(`bun --version`)을 적어 이슈를 열어 주세요.
- **기능 아이디어** — 이슈를 열고 사용 사례를 설명해 주세요. 큰 제안보다 작은 제안이 병합하기 쉽습니다.
- **풀 리퀘스트** — 버그 수정, 새 건물 스프라이트, 추가 영웅 클래스, 맵 에디터 개선, 플랫폼 다듬기.
- **아트 & 테마** — 호환되는 픽셀아트 타일셋 / 스프라이트 팩(CC0 또는 그와 비슷하게 관대한 라이선스)을 특히 환영합니다.

## 개발 환경 설정

```bash
git clone https://github.com/FulAppiOS/agent-quest.git
cd agent-quest
bun install
bun start
```

<http://localhost:4445> 를 여세요. 전체 아키텍처 개요와 환경 변수는 [README](README.ko.md)를 참고하세요.

## PR을 열기 전에

- TypeScript strict를 유지하세요. `any`는 쓰지 않습니다.
- 코드와 식별자는 영어로 작성합니다. UI 문자열은 `t()` / `useI18n()`(`client/src/i18n`)을 거치며, 새 키는 `locales/en/*.json`(기본)과 `locales/ko/*.json`에 함께 추가합니다.
- 커밋 메시지는 conventional 스타일을 따릅니다: `feat:`, `fix:`, `refactor:`, `docs:` 등.
- 서버 코드를 건드렸다면 `cd server && bun test`를 실행하세요.
- UI를 바꿨다면 PR 설명에 스크린샷이나 짧은 클립을 넣어 주세요.

## 라이선스

기여하시면 해당 기여가 프로젝트를 다루는 [MIT 라이선스](LICENSE) 아래 배포되는 데 동의하는 것으로 간주합니다.
