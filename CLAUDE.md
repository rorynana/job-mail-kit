# 공고 메일 키트

이 폴더는 공고 메일 키트다. 사람인·잡코리아의 마케팅 공고를 사용자의 점수표로 매겨, 매일 아침 9시에 사용자 Gmail 로 점수 높은 공고를 보낸다.

사용자는 개발자가 아니다. 한국어로 짧게 말하고, 명령은 네가 실행한다. 아래 1~6단계를 순서대로 한다. 단계를 건너뛰거나 사용자에게 명령을 치게 하지 않는다(4단계 로그인 예외).

## 고치지 않는 것
- collect.js, score.js, mail.js, .github/workflows/daily.yml 은 고치지 않는다. 사용자에 맞게 바꾸는 곳은 criteria.json 하나뿐이다.
- 채점에 AI를 부르는 코드를 넣지 않는다. 매일 같은 기준으로, 돈 들지 않게 돌아야 한다.

## 1단계 준비
- 키트를 받은 폴더에서 `npm install` 을 한다. Node 가 없으면 설치부터 한다(윈도우 `winget install OpenJS.NodeJS.LTS`, 맥 `brew install node`).

## 2단계 인터뷰로 점수표 만들기
- 사용자를 인터뷰한다. 한 번에 질문 하나씩, 열 개 안쪽.
- 꼭 물을 것: 희망 직무, 사는 곳과 통근 가능한 지역, 근무 형태(정규직·계약직·재택), 경력(몇 년, 공백), 꼭 피하고 싶은 것, 다섯 항목 중 가장 중요한 것.
- 답을 받으면 criteria.예시.json 과 같은 구조로 criteria.json 을 만든다.
  - 칸은 회사, 공고 제목, 지역, 경력, 근무 형태 다섯 개만 쓴다. 공고 목록에 연봉은 없으니 연봉은 넣지 않는다.
  - 항목 배점 합은 100. 사용자가 가장 중요하다고 한 항목에 배점을 가장 크게 준다.
  - 「미정」 칸을 두지 않는다. 판단이 안 서는 경우는 나머지 점수를 배점의 절반으로 둔다.
  - 경력 항목은 단계 대신 연차(이하 N년이면 몇 점)로 적는다.
  - 0점 조건은 사용자가 꼭 피하고 싶다고 한 것만 넣는다.
- 만든 뒤 항목별 배점을 표 하나로 보여 주고 「배점은 언제든 criteria.json 에서 고칠 수 있다」고 한 줄 말한다.

## 3단계 한 번 돌려 보기
- `node collect.js` 다음 `node score.js` 를 실행한다.
- 점수 높은 5개를 이유와 함께 보여 주고 「셋 이상 지원하고 싶은 공고인가요?」라고 묻는다.
- 아니라고 하면 프로그램이 아니라 criteria.json 을 고치고 `node score.js` 만 다시 돌린다.
- score.js 가 「criteria.json 을 고쳐야 합니다」로 멈추면 그 안내대로 criteria.json 을 고친다.

## 4단계 내 GitHub 에 올리기
- `gh --version` 으로 GitHub CLI 를 확인한다. 없으면 설치한다(윈도우 `winget install --id GitHub.cli -e`, 맥 `brew install gh`). 설치 뒤 새 터미널에서만 잡히면 전체 경로로 실행한다.
- `gh auth status` 로 로그인과 권한을 본다. 로그인이 안 됐거나 Token scopes 에 workflow 가 없으면, 사용자에게 아래 한 줄을 터미널에 직접 치게 한다. 브라우저에 코드 8자리를 넣는 과정이라 네가 대신 못 한다.
  - `gh auth login --web --git-protocol https --scopes workflow`
  - Claude Code 안이면 앞에 ! 를 붙여 `! gh auth login --web --git-protocol https --scopes workflow`
- 로그인이 끝나면 비공개 저장소로 올린다. 저장소 이름은 job-mail, 이미 있으면 job-mail-2.
  - `git remote remove origin` (키트 원본 주소를 뗀다)
  - criteria.json 을 포함해 커밋한다. jobs.csv, scored.csv 는 올리지 않는다(.gitignore).
  - `gh repo create job-mail --private --source . --remote origin --push`
- 절대 공개(public) 저장소로 만들지 않는다. 점수표에 사는 곳이 들어 있다.

## 5단계 Gmail 비밀번호 넣기
- 사용자에게 저장소의 Secrets 화면 주소를 준다: https://github.com/내아이디/job-mail/settings/secrets/actions (내아이디는 `gh api user -q .login` 으로 채운다)
- New repository secret 으로 두 개를 넣게 한다.
  - GMAIL_USER : 메일 받을 Gmail 주소
  - GMAIL_APP_PASSWORD : Gmail 앱 비밀번호 16자리
- 비밀번호는 대화창에 붙여 넣지 말라고 말한다. 사용자가 「넣었어」라고 하면 다음 단계로 간다.

## 6단계 지금 한 번 받기
- `gh workflow run daily.yml` 로 손으로 한 번 돌리고, `gh run watch` 로 끝날 때까지 본다(1분 안팎).
- 성공하면 「메일함을 열어 보세요. 내일부터는 아침 9시에 옵니다」라고 말한다.
- 실패하면 `gh run view --log-failed` 로 원인을 읽고 쉬운 말로 설명한다. 흔한 원인
  - 「GMAIL_USER, GMAIL_APP_PASSWORD 가 없습니다」: 5단계 Secrets 이름 오타
  - 「Invalid login」·「Username and Password not accepted」: 앱 비밀번호가 아니라 Gmail 비밀번호를 넣음, 또는 2단계 인증이 꺼져 있음
  - 한 사이트 실패: 나머지 사이트 공고로 보내므로 메일은 온다

## 나중에
- 기준을 바꾸고 싶다: criteria.json 을 고치고 커밋·푸시한다. 다음 날부터 바뀐다.
- 그만 받고 싶다: `gh workflow disable daily.yml`
