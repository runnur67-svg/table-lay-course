# TABLE LAY 코스 컨트롤 v5 — 2대 태블릿 Firebase 실시간 연동 설정

기존 GitHub Pages: https://runnur67-svg.github.io/table-lay-course/
저장소: https://github.com/runnur67-svg/table-lay-course

> 상태: Firebase 실시간 연동 기능이 **코드에 포함**되었습니다. 그러나 사용자 Firebase 계정/프로젝트가 아직 생성·입력되지 않아 **두 실기기 간 실제 연결 검증은 완료되지 않았습니다**. 연결 성공 메시지와 테스트 절차를 반드시 확인하세요.

## 0. 시작 전

- 기존 앱의 `설정 → 전체 데이터 백업 (.json)`으로 **기존 7회차 데이터**를 백업하세요.
- 백업에는 인원·알레르기·주문 내용이 포함될 수 있습니다. **공개 GitHub에 백업 JSON이나 Firebase 로그인 비밀번호를 올리지 마세요.**
- v4의 기존 기능(시간표/코스 편집, 10테이블, 착석-시작-서빙 단계, 인원별 오리/와규·굽기·음료, 연습 모드, PNG/PDF, JSON 백업)은 유지했습니다.

## 1. GitHub Pages v5 업데이트

1. `Table_Lay_Course_Control_v5_UPDATE_ONLY.zip` 압축을 풀어 다음 **파일**을 얻습니다:
   - `index.html`
   - `service-worker.js`
   - `static/app-v5.js`
   - `static/style-v5.css`
   - `static/sync-v5.js`
2. 저장소 **Code → Add file → Upload files**: https://github.com/runnur67-svg/table-lay-course/upload/main
3. 압축 해제한 파일과 `static` 폴더를 드래그하여 GitHub에 올립니다. ZIP 자체를 업로드하지 않습니다.
4. GitHub 화면에서 정확히 `index.html` (최상위), `static/app-v5.js`, `static/style-v5.css`, `static/sync-v5.js`, `service-worker.js` 경로로 표시되는지 확인합니다.
5. `Commit changes` → `Actions`에서 GitHub Pages 배포 성공을 확인합니다.
6. 기존 주소 https://runnur67-svg.github.io/table-lay-course/ 접속 → `업데이트 확인` → `업데이트 적용`. 캐시 때문에 이전 버전이 보이면 앱을 완전히 닫았다 다시 엽니다.

기존 static/app-v4.js, style-v4.css는 GitHub에 남아 있어도 무방합니다. v5는 새 파일을 사용합니다.

## 2. Firebase 프로젝트 처음 만들기 (한 번만)

1. https://console.firebase.google.com/ 열기 → **프로젝트 추가** → 예: `table-lay-course-2026`. Google Analytics는 필요하지 않습니다.
2. Firebase 프로젝트 → **빌드 → Authentication → 시작하기 → 로그인 방법** → **이메일/비밀번호** 사용 설정.
3. Authentication → **사용자** → **사용자 추가** → 태블릿 운영에만 쓸 **전용 이메일/비밀번호**를 생성합니다. 다른 서비스에 쓰는 비밀번호를 재사용하지 마세요.
4. 사용자 목록에서 해당 계정의 **UID**를 복사합니다. 보안 규칙에 그대로 붙여넣습니다.
5. **빌드 → Firestore Database → 데이터베이스 만들기**. 운영 모드/프로덕션 모드로 만들고 리전을 정합니다(예: Seoul). 초기 보안 규칙은 잠겨 있어도 괜찮습니다.
6. Firestore Database → **규칙**에 ZIP 파일의 `firestore.rules` 내용을 붙여넣은 후, `'FIREBASE_AUTH_USER_UID'`를 4번에서 복사한 UID로 교체하고 **게시**합니다.
7. 프로젝트 개요 옆 톱니바퀴 → **프로젝트 설정 → 내 앱 → 웹 앱(</>) 등록** → 앱 닉네임 지정. Firebase Hosting 추가 설정은 필요 없습니다.
8. SDK 설정의 `firebaseConfig` 객체 **중괄호 내부 JSON** 또는 `const firebaseConfig = { ... }`의 객체 내용에서 `apiKey`, `authDomain`, `projectId`, `appId` 등을 복사합니다.
   - 앱에서 요구하는 형태는 **JSON만**입니다. 예: `{"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}`
   - 객체에 `measurementId`, `storageBucket`, `messagingSenderId`가 포함되어도 무방합니다.
   - Firebase 콘솔 코드는 키에 따옴표가 없는 JavaScript 객체 형태일 수 있습니다. **JSON 형식은 키 이름에도 큰따옴표를 붙여야** 합니다.
9. Github Pages 도메인이 Firebase Authentication → **설정 → 승인된 도메인** 관련 설정에서 필요하다고 안내될 경우 `runnur67-svg.github.io`를 등록합니다.

### Firestore 보안 규칙 (필수)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tablelay_sync/live {
      allow read, write: if request.auth != null
        && request.auth.uid == '여기에_전용_계정_UID_입력';
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

위 조건은 **지정한 Firebase 계정만 공유 데이터를 읽고 수정**할 수 있게 합니다. Firestore에서 `allow read, write: if true` 같은 공개 규칙을 사용하지 마세요.

## 3. 첫 번째 태블릿 (원본 데이터 업로드)

1. 기존 데이터 백업을 확인한 뒤 v5 앱 열기 → 하단 **태블릿 연동**.
2. 2-8에서 받은 Firebase 웹앱 설정 JSON 붙여넣기.
3. 2-3에서 만든 전용 이메일/비밀번호 입력 → **① Firebase 로그인 · 데이터 확인**.
4. 처음이면 “클라우드 데이터 없음”이 표시됩니다. **② 이 기기 데이터 최초 업로드**를 누르세요.
5. 하단 상태가 **● 실시간 연동 중 · 2기기 공유**로 바뀌는지 확인합니다. 이 앱의 7회차 데이터가 공유 원본이 됩니다.
6. Firestore Database → 데이터에서 `tablelay_sync/live` 문서가 생성되었는지 확인할 수 있습니다.

**최초 업로드는 1번만** 합니다. 다른 태블릿 데이터는 이 동작으로 덮어쓰지 마세요.

## 4. 두 번째 태블릿 (클라우드 데이터 가져오기)

1. 아이패드 또는 안드로이드에서 기존 Pages 앱 주소를 열고 v5가 보이는지 확인합니다.
2. 하단 **태블릿 연동** → 첫 번째 기기와 **동일한 JSON, 전용 이메일, 비밀번호** 입력.
3. **① Firebase 로그인 · 데이터 확인** → “클라우드 데이터 발견”이 표시됩니다.
4. **② 클라우드 데이터 불러와 연결**을 누릅니다. 이 태블릿의 기존 로컬 운영 데이터는 공유 데이터로 교체됩니다(백업 후 진행).
5. 두 기기 모두 하단 **● 실시간 연동 중 · 2기기 공유**를 확인합니다.

## 5. 동작 확인 (실제 운영 전 필수)

1. 두 태블릿에서 **동일 회차**를 선택하고, 두 기기 모두 **실시간 연동 중**인지 확인합니다.
2. 첫 기기에서 테스트 테이블을 등록하면 다른 기기에 자동 표시되는지 확인합니다.
3. 첫 기기에서 **착석 완료** → 두 번째 기기에서 **코스 시작** → 첫 기기에서 **첫 코스 서빙 완료**를 누르고 양쪽 화면 진행 상태·동그라미·남은 시간 일치를 확인합니다.
4. 인원별 오리/와규·와규 굽기·알레르기·음료를 한쪽에서 변경하고 다른 쪽의 테이블 상세에 반영되는지 확인합니다.
5. 실제 테스트 테이블은 원상 복구합니다. **연습 모드**는 로컬 분리 모드로 공유되지 않으므로, 연결 테스트는 실제 모드의 **비운 테이블**로 검증 후 복구하세요.
6. 서로 다른 테이블을 동시에 수정하면 각각 반영되고, 같은 테이블의 오래된 정보를 두 기기에서 동시에 바꾸는 상황에서는 충돌 안내가 나와 잘못된 중복 진행을 막아야 합니다.
7. 인터넷을 잠시 끊고 상태가 “연동 끊김 · 조작 중지”로 표시되며 실제 운영 조작이 막히는지 확인합니다. 다시 연결되면 자동 재연결 여부를 확인하세요.

## 6. 매일 사용법

- 평소에는 양쪽 태블릿에서 같은 웹앱 주소를 켜면 됩니다. 최초 로그인 성공 후 계정 세션이 유지되는 경우 **재실행 시 자동 재연결**됩니다.
- 로그인이 만료되었다면 연동 상태가 끊긴 것으로 보이므로 **태블릿 연동 → 로그인 → 클라우드 불러오기**를 다시 진행합니다.
- 하단이 **실시간 연동 중**으로 나타나기 전에는 운영 버튼을 누르지 마세요.
- 저장 중 버튼은 중복 실행되지 않으며, 실시간 서버 상태와 비교하여 동시에 같은 코스를 잘못 건너뛰는 일을 방지합니다.
- 연습 모드는 데이터 공유 없이 독립적으로 작동합니다.
- 와이파이가 끊기면 실운영 변경을 임시 중지합니다. **오프라인에서 두 기기가 서로 다른 데이터를 생성하고 나중에 충돌하는 일은 허용하지 않습니다.**
- 사용자 데이터는 Firebase 프로젝트의 Firestore에 저장됩니다. Firebase 앱 구성 JSON(apiKey 등)은 공개 가능한 **프로젝트 식별 구성**이지만, 전용 이메일/비밀번호는 비밀로 유지하세요.

## 7. 문제 해결

| 현상 | 확인사항 |
| --- | --- |
| `Missing or insufficient permissions` | Authentication 전용 UID와 Firestore 보안 규칙에 입력한 UID가 같은지, 규칙을 게시했는지 |
| `auth/invalid-credential` | Authentication에서 이메일/비밀번호를 설정했고 동일한 계정으로 로그인했는지 |
| 설정 JSON 오류 | `apiKey`, `authDomain`, `projectId`, `appId`가 쌍따옴표를 갖는 유효한 JSON인지 |
| 두 기기 진행이 다름 | 둘 다 실시간 연동 중인지, 같은 회차인지, 연습 모드가 아닌지 |
| `동시 변경 충돌` | 다른 태블릿에서 같은 필드가 먼저 변경됨. 갱신된 화면 확인 후 필요한 동작을 다시 수행 |
| 인터넷 연결 끊김 | 앱을 닫지 말고 와이파이를 확인. 재연결 후 상태가 정상인지 확인 |
| 여전히 v4로 표시 | GitHub 배포 완료 확인 → 앱의 업데이트 확인 → 재실행 |

## 제한 및 검증 상태

- 서버는 직접 운영하지 않지만 **Firebase Firestore + Authentication이 관리형 클라우드 백엔드**로 사용됩니다. 따라서 인터넷이 필요합니다.
- 같은 매장 와이파이여도, 매장 인터넷이 끊기면 두 태블릿의 공유 동작은 멈춥니다.
- 로컬 소스·변경 병합 로직 검증: JS 문법 검사 통과, 서로 다른 테이블 동시 변경 병합 및 동일 테이블 오래된 상태의 중복 서빙 차단 모의 테스트 통과.
- **실제 Firebase 프로젝트에 접속하는 end-to-end 테스트는 사용자 프로젝트/인증 설정 없이는 완료할 수 없습니다.** 첫 연결 시 반드시 5장 검증을 수행하세요.
