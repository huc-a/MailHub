# MailHub

鍩轰簬淇鐗堝疄鏂芥枃妗?v2.0 鐨?Cloudflare 閭鑱氬悎宸ヤ綔鍙帮紙鍗曟墍鏈夎€呫€佺鏈夐儴缃诧級銆?
## 鏈湴寮€鍙?
- `npm install`
- 閰嶇疆 `.dev.vars`锛氫粎鏈湴鍙 `APP_ENV=local` 鍜?`ALLOW_LOCAL_AUTH=true`锛涘啀璁剧疆 `MAIL_DOMAIN=...`銆?- `npm run dev`
- `npm test`
- `npm run build`
- 鏈湴 D1 杩佺Щ锛歚npx wrangler d1 migrations apply mailhub-dev --local`

绉佹湁 API 鍦ㄧ敓浜х幆澧冭姹?`Cf-Access-Jwt-Assertion`锛屽苟楠岃瘉 Access 绛惧悕銆乮ssuer銆乤udience 涓庤繃鏈熸椂闂淬€傞厤缃?`ACCESS_TEAM_DOMAIN` 鍜?`ACCESS_AUD`锛涙湰鍦拌韩浠芥ā鎷熷彧鍦?`APP_ENV=local` 涓?`ALLOW_LOCAL_AUTH=true` 鏃跺惎鐢ㄣ€備笉瑕佹妸瀵嗛挜鍐欏叆浠撳簱銆?
褰撳墠瀹炵幇鍖呭惈鍋ュ悍妫€鏌ャ€丄ccess 韬唤鏄犲皠銆佷复鏃堕偖绠卞垱寤?骞傜瓑閿?TTL 涓婇檺銆侀偖绠卞垪琛ㄥ拰 Email Routing 鍦板潃鏈夋晥鏈熸嫆鏀躲€侰loudflare D1/R2 浠嶆湭缁戝畾鐪熷疄璧勬簮锛歸rangler.toml 鐨?ID/鍚嶇О鏄崰浣嶅€硷紝涓斿綋鍓嶈处鎴峰皻鏈惎鐢?R2銆侴0 鐨勭湡瀹為偖浠舵姇閫掍笌 Gmail 鎺堟潈浠嶉渶娴嬭瘯鍩熷拰 Google OAuth 瀹㈡埛绔紝鏆備笉鍙敓浜ч儴缃层€
