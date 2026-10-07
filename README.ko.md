<div align="center">

<img src="assets/hero.svg" width="100%" alt="catbus — 탑승하세요, 어느 플랫폼으로든">

<br>

**명령어 하나로, 11개 플랫폼까지.**<br>
샤오훙수 · 더우인 · TikTok · 빌리빌리 · 콰이서우 · 웨이보 · 셴위 · 타오바오 · 징둥 · X · 12306
<br>
<sub>곧 탑승: Instagram · YouTube · Facebook · 즈후 · 위챗 공식 계정 · 진르터우탸오 · 더우 · 핀둬둬 · 메이퇀 · 다중뎬핑</sub>

<br>

[![npm](https://img.shields.io/npm/v/catbus-cli?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/catbus-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-A6E3A1?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![Platforms](https://img.shields.io/badge/platforms-11-F38BA8?style=for-the-badge)](docs/platforms/README.md)
[![Agent Ready](https://img.shields.io/badge/AI%20Agent-ready-CBA6F7?style=for-the-badge)](.claude/skills/catbus/SKILL.md)

[简体中文](README.md) · [English](README.en.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · **한국어**

[빠른 시작](docs/guide/quick-start.md) · [기능 매트릭스](docs/capabilities.md) · [플랫폼별 안내](docs/platforms/README.md) · [예제](docs/examples/README.md) · [에이전트용](.claude/skills/catbus/SKILL.md)

</div>

<br>

> 플랫폼마다 API도, 서명 방식도, 로그인 방법도, 데이터 형식도 제각각입니다. **catbus는 이 모두를 한 대의 버스에 태웁니다**. 같은 명령어, 같은 JSON, 같은 로그인 정보 디렉터리. 플랫폼을 바꿀 때는 단어 하나만 바꾸면 됩니다.

## ✨ catbus란?

catbus(猫巴士)는 중국과 해외의 주요 플랫폼 11곳의 web 엔드포인트 기능을 **통일된 문법**으로 호출하는 커맨드라인 도구입니다. 검색, 상세 정보, 댓글, 사용자, 추천 피드, 다운로드, 게시, DM, 라이브 방송 탄막, 열차 잔여석 및 운임 조회……

```bash
catbus xhs      item search 露营 --sort latest
catbus douyin   item search 露营 --sort latest
catbus bilibili item search 露营 --sort latest
catbus x        item search camping --sort latest
```

플랫폼 4곳, 거의 똑같은 명령어 4줄, 그리고 **같은 구조**의 JSON 출력. 노트, 작품, 동영상, 트윗 모두 `item`이고, 검색은 언제나 `search`, 좋아요는 언제나 `like`입니다. 한 번 배우면 11개 플랫폼 모두에서 쓸 수 있습니다.

<p align="center">
  <img src="assets/platforms.svg" width="100%" alt="지원하는 10개 플랫폼과 개발 중인 10개 플랫폼">
</p>

## 🚀 왜 catbus인가

<table>
<tr>
<td width="50%" valign="top">

### 🧭 같은 의미, 같은 이름
의미가 같은 기능은 모든 플랫폼에서 **같은 명령어, 같은 파라미터, 같은 출력**을 씁니다. 플랫폼 고유의 용어(`note`, `aweme`, `tweet`……)를 써도 괜찮습니다. 어떤 단어를 써야 하는지 catbus가 알려 줍니다.

</td>
<td width="50%" valign="top">

### 📦 Node만 있으면 됩니다
Python도, 컴파일러도, 어떤 시스템 의존성도 필요 없습니다. 네이티브 의존성은 모두 사전 빌드된 바이너리를 제공하며 Windows, macOS, Linux의 x64 / arm64(musl 포함)를 지원합니다. **8개 대상 시스템** 모두 CI에서 하나하나 스모크 테스트를 거칩니다.

</td>
</tr>
<tr>
<td valign="top">

### 🤖 AI 에이전트를 위한 설계
stdout에는 JSON만 나오고, 종료 코드는 안정적이며, 오류에는 다음에 실행할 명령어가 함께 담깁니다. `catbus platforms`는 전체 기능 목록을 출력합니다. [에이전트 스킬](.claude/skills/catbus/SKILL.md)과 [llms.txt](llms.txt)를 기본 제공합니다.

</td>
<td valign="top">

### 🔐 로그인 정보는 내 컴퓨터에만
QR 코드, SMS, cookie 가져오기를 모두 지원합니다. 인증 정보는 **플랫폼 × 엔드포인트 × 계정** 단위로 `~/.catbus/`(0700 / 0600)에 분리 저장되며, 여러 계정을 언제든 전환할 수 있습니다. 어떤 데이터도 수집하거나 업로드하지 않고, 텔레메트리도 없습니다.

</td>
</tr>
<tr>
<td valign="top">

### 🧪 업스트림과 바이트 단위로 일치
모든 요청의 URL, 헤더 순서, cookie, body, 서명을 난수와 시계를 고정한 상태에서 업스트림 구현과 **바이트 단위로 대조**합니다. 560+건의 골든 데이터와 940+개의 오프라인 테스트가 모든 변경을 지킵니다.

</td>
<td valign="top">

### 🛡️ 브라우저급 네트워크 스택
실제 Chrome과 동일한 TLS / HTTP2 핑거프린트. 업스트림의 서명 JS는 수정 없이 그대로 샌드박스에서 실행되고, 슬라이더·클릭 선택형 캡차는 로컬 ONNX와 OpenCV로 자동 인식합니다.

</td>
</tr>
</table>

## 📊 숫자로 보는 catbus

<div align="center">

| 🚌 플랫폼 | ⌨️ 구현된 명령어 | 🧪 골든 데이터 | ✅ 오프라인 테스트 | 💻 대상 시스템 |
|:---:|:---:|:---:|:---:|:---:|
| **11** | **300+** | **560+** | **960+** | **8** |

</div>

## 🏗️ 아키텍처

<p align="center">
  <img src="assets/architecture.svg" width="100%" alt="catbus 아키텍처">
</p>

- **하나의 레지스트리가 모든 것을 움직입니다**: 명령어 파싱, 4단계 `--help`, `catbus platforms`, [기능 매트릭스](docs/capabilities.md)가 모두 같은 레지스트리에서 생성되므로 서로 어긋날 일이 없습니다.
- **플랫폼 하나에 파일 한 세트**: `client`는 세션과 서명을 맡고, `api`는 업스트림 메서드와 일대일로 대응하며, `normalize`는 원본 데이터를 통일된 타입으로 바꾸고, `resolve`는 ID, 링크, 공유용 단축 링크, `me`를 모두 인자로 쓸 수 있게 합니다.
- **확장 가능**: 명세에 app / pc 엔드포인트 자리가 마련되어 있으며, JS가 아닌 업스트림은 provider 프로토콜로 연결될 예정입니다.

## 🤖 AI 에이전트를 위한 설계

catbus는 첫날부터 '프로그램이 호출하는 도구'로 설계되었습니다.

```bash
catbus platforms douyin | jq '.data.commands[] | select(.status=="implemented") | .resource + " " + .action'
```

- **자기 기술적**: 플랫폼별, 명령어별 로그인 요구 사항, 구현 상태, 업스트림 지원 수준을 명령어 하나로 확인할 수 있습니다.
- **예측 가능**: 성공과 실패 모두 같은 엔벨로프 `{ ok, data, page, error }`를 쓰며, `error.hint`가 다음에 실행할 명령어를 바로 알려 줍니다.
- **연결 가능**: 모든 출력 객체에 `id`와 `url`이 들어 있어, 앞 명령어의 결과를 그대로 다음 명령어에 넘길 수 있습니다.
- **절제**: 위험한 작업에는 반드시 명시적인 `-y`가 필요하고, 게시물은 나만 보기로 올릴 수 있으며, 리스크 컨트롤에 걸리면 `RISK_CONTROL`로 분명히 알리고 몰래 재시도하지 않습니다.

명령어 하나로 catbus 스킬을 Claude Code, Cursor, Codex 등 에이전트에 설치할 수 있습니다:

```bash
npx skills add cv-cat/catbus
```

스킬은 필요한 만큼만 불러옵니다. 개요는 한 페이지뿐이고, 다루는 플랫폼과 작업 종류(수집, 게시, 라이브·DM, 문제 해결)에 따라 [하위 파일](.claude/skills/catbus/SKILL.md)만 읽습니다. 안전 규칙도 내장되어 있습니다: 로그인은 사용자에게 맡기고, 쓰기 작업은 먼저 확인하며, 게시는 기본적으로 비공개, 리스크 컨트롤을 만나면 멈춥니다.

## ⚡ 30초 만에 탑승

```bash
npm i -g catbus-cli

catbus doctor                 # 환경 점검
catbus bilibili auth login    # QR 코드로 로그인
catbus bilibili item search 猫 --limit 20
```

[Docker](docs/guide/docker.md)나 소스에서 설치할 수도 있습니다. 전체 절차는 [빠른 시작](docs/guide/quick-start.md)을 참고하세요.

## 📚 문서

아래 문서는 중국어(간체)로 작성되어 있습니다.

| | |
|---|---|
| 🚀 [빠른 시작](docs/guide/quick-start.md) | 설치부터 첫 데이터 내보내기까지 |
| 🔑 [로그인](docs/guide/login.md) · ⚙️ [설정](docs/guide/configuration.md) · 🐳 [Docker](docs/guide/docker.md) | QR 코드 / cookie, 다중 계정, 프록시, 컨테이너 |
| 📤 [출력과 오류 처리](docs/guide/output.md) | 엔벨로프, 정규화 타입, 페이지네이션, 종료 코드 |
| 🧭 [플랫폼별 안내](docs/platforms/README.md) · 🗂️ [기능 매트릭스](docs/capabilities.md) | 플랫폼마다 무엇을 지원하는지, 인자는 어떻게 넘기는지 |
| 🧪 [예제 스크립트](docs/examples/README.md) | 크로스 플랫폼 검색, 댓글 내보내기, 게시물 백업, 라이브 탄막 기록 |
| 📐 [AGENTS.md](AGENTS.md) | catbus 명세 그 자체 |
| ❓ [자주 묻는 질문](docs/guide/faq.md) | 왜 로그인해야 하나요? 리스크 컨트롤에 걸리면 어떻게 하나요?…… |

## 🤝 기여하기

issue와 PR 모두 환영합니다. 새 플랫폼, 새 명령어, 플랫폼 API 변경 대응, 문서 개선 등 무엇이든 좋습니다. 시작하기 전에 [CONTRIBUTING.md](.github/CONTRIBUTING.md)와 [AGENTS.md](AGENTS.md)를 읽어 주세요(명세가 먼저이며, 요청에는 반드시 골든 테스트가 있어야 합니다). 보안 문제는 [SECURITY.md](.github/SECURITY.md)에 따라 비공개로 제보해 주세요.

## 📈 Star 추이

<a href="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
    <img alt="Star History Chart" src="https://cvcat.site/star-history/svg?repos=cv-cat/catbus&type=Date" />
  </picture>
</a>

## 🍔 커뮤니티

스크래핑과 AI 에이전트에 관심이 있다면 그룹 채팅(중국어)에 참여해 함께 이야기해요.

그룹이 가득 찼거나 QR 코드가 만료되었다면 issue를 남기거나 위챗 / QQ로 알려 주세요.

| group-1 | group-2 | group-3 | group-4 (2,000명 QQ 그룹) |
|:--:|:--:|:--:|:--:|
| <img width="280" alt="group1" src="https://cvcat.site/assets/group1.jpg" /> | <img width="280" alt="group2" src="https://cvcat.site/assets/group2.jpg" /> | <img width="280" alt="group3" src="https://cvcat.site/assets/group3.jpg" /> | <img width="280" alt="group4" src="https://cvcat.site/assets/group4.jpg" /> |

<details>
<summary><b>⚠️ 면책 조항</b></summary>

<br>

- 이 프로젝트는 학습 및 연구 목적으로만 제공됩니다. 상업적 목적이나 어떠한 불법적 목적으로도 사용하지 마십시오.
- 사용 시 각 플랫폼의 사용자 약관과 서비스 약관, 그리고 거주 지역의 법령을 준수하십시오. 타인의 개인 정보를 수집하거나 유포하지 말고, 플랫폼에 과도한 요청 부하를 주지 마십시오.
- 자동화된 작업은 플랫폼의 리스크 컨트롤을 작동시켜 캡차, 요청 제한, 나아가 계정 정지로 이어질 수 있습니다. 이 프로젝트의 사용으로 발생하는 모든 결과에 대한 책임은 전적으로 사용자 본인에게 있습니다.
- 이 프로젝트는 위에 언급된 어떤 플랫폼과도 관련이 없으며, 해당 플랫폼의 허가나 승인을 받지 않았습니다. 각 플랫폼의 명칭과 상표는 해당 소유자에게 귀속됩니다.

</details>

## 📄 License

[MIT](LICENSE) © 2026 [cv-cat](https://github.com/cv-cat)

<div align="center">
<br>
<img src="assets/logo.svg" width="64" alt="catbus">
<br>
<sub>탑승하세요, 어느 플랫폼으로든 · All aboard, every platform.</sub>
</div>
