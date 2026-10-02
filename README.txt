Wave Music - 로그인/관리자 통합 버전
===================================

파일:
- index.html             : Wave Music 화면 + 로그인/회원가입 + 관리자 센터
- style.css              : 전체 디자인
- app.js                 : YouTube 음악/추천/재생목록 기능
- auth.js                : Supabase 로그인/회원가입/프로필/권한/관리자 기능
- supabase-setup.sql     : Supabase DB 및 권한 설정 SQL
- SETUP_GUIDE.txt        : 설치 순서

먼저 SETUP_GUIDE.txt를 읽고 설정하세요.

필수 설정:
1. app.js -> YOUTUBE_API_KEY
2. auth.js -> SUPABASE_URL
3. auth.js -> SUPABASE_PUBLISHABLE_KEY
4. Supabase SQL Editor -> supabase-setup.sql 실행

보안:
- auth.js에는 Publishable Key만 사용하세요.
- Supabase Secret Key / service_role 키는 절대로 GitHub나 브라우저 코드에 넣지 마세요.
- 슈퍼관리자 권한은 Supabase SQL Editor에서만 지정하세요.
