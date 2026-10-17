window.__ModuleLoader__.load({
	id: "dsh-pr-inbox",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/api.ts
		var RouteError = class extends Error {
			code;
			constructor(message, code) {
				super(message);
				this.code = code;
				this.name = "RouteError";
			}
		};
		function serviceOf(ctx) {
			return ctx.betterSidebar ?? {};
		}
		/**
		* 相对路径 → 绝对 URL（保留页面前缀）。
		*
		* 返回的可能是宿主给的 `URL` 实例（`fetch` 能用，字符串运算不行），所以要求字符串的
		* 调用方用 {@link absoluteHostUrl}。
		*/
		function hostRouteUrl(ctx, path) {
			const service = serviceOf(ctx);
			if (typeof service.hostRouteUrl === "function" && service.features?.includes("hostRouteUrl") === true) return service.hostRouteUrl(path);
			return new URL(path, document.baseURI).href;
		}
		/** 拿一个绝对 URL 基址：只认 http(s)——`<img>` 跨源加载不需要 CORS，所以桌面壳里用得上。 */
		function httpBase() {
			const candidates = [typeof document === "undefined" ? void 0 : document.baseURI, globalThis.__DSH_TRANSPORT__?.streamBaseUrl];
			for (const candidate of candidates) {
				if (candidate === void 0 || candidate === "") continue;
				try {
					const protocol = new URL(candidate).protocol;
					if (protocol === "http:" || protocol === "https:") return candidate;
				} catch {}
			}
		}
		/**
		* **必须绝对**的 URL（图片用）：官方 markdown 渲染器只接受 `new URL(x)` 能解析、且协议是
		* `http` / `https` / `blob` / `data` 的地址（`vocabularyImageUrl`）——相对路径会被判成
		* "没有可显示的图"，正文里的图片于是退化成 alt 文本。
		*
		* 页面基址是 `http(s)` 时就用它（web 形态与反代前缀都对）；桌面壳的页面基址是
		* `dsh-app://app/`，那个协议**不在官方白名单里**（白名单只额外放行
		* `dsh-app://app/api/file?`），所以改用注入的传输基址——它正是宿主真实 origin，
		* 而 `<img>` 跨源取图不受同源策略限制（这也是它不能拿来做 fetch 的原因）。
		*/
		function absoluteHostUrl(ctx, path) {
			const resolved = hostRouteUrl(ctx, path);
			const text = typeof resolved === "string" ? resolved : resolved.href;
			const base = httpBase();
			return base === void 0 ? text : new URL(text, base).href;
		}
		/** 调本插件自己的 host op。失败抛 `RouteError`（码原样带出，UI 可分辨 gh 缺失）。 */
		async function callOp(ctx, op, payload = {}) {
			const response = await fetch(hostRouteUrl(ctx, "plugins/dsh-pr-inbox/api"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					op,
					...payload
				})
			});
			let body;
			try {
				body = await response.json();
			} catch {
				throw new RouteError(`PR 路由返回了非 JSON（HTTP ${response.status}）`);
			}
			if (body.ok !== true) throw new RouteError(body.error?.message ?? `PR 路由失败（HTTP ${response.status}）`, body.error?.code);
			return body.value;
		}
		/** 会话权威 cwd：`scope.cwd` 优先，缺失时问 better-sidebar。 */
		async function resolveCwd(ctx, sessionId, cwd) {
			if (typeof cwd === "string" && cwd !== "") return cwd;
			try {
				const resolved = (await (await fetch(hostRouteUrl(ctx, "sidebar/api/session.cwd"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId })
				})).json()).value?.cwd;
				return typeof resolved === "string" && resolved !== "" ? resolved : void 0;
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/format.ts
		/** GitHub 给的是 ISO 8601 UTC；解析失败返回 undefined 而不是 NaN 时间。 */
		function timeOf(iso) {
			const parsed = Date.parse(iso);
			return Number.isFinite(parsed) ? parsed : void 0;
		}
		const MINUTE = 6e4;
		const HOUR = 60 * MINUTE;
		const DAY = 24 * HOUR;
		/** 把 ISO 时间归到字典键；解析失败返回 undefined（调用方回空串，不显示 NaN）。 */
		function ageParts(iso, now = Date.now()) {
			const time = timeOf(iso);
			if (time === void 0) return void 0;
			const delta = now - time;
			if (delta < MINUTE) return { key: "justNow" };
			if (delta < HOUR) return {
				key: "minutesAgo",
				value: Math.floor(delta / MINUTE)
			};
			if (delta < DAY) return {
				key: "hoursAgo",
				value: Math.floor(delta / HOUR)
			};
			const days = Math.floor(delta / DAY);
			if (days < 30) return {
				key: "daysAgo",
				value: days
			};
			const months = Math.floor(days / 30);
			if (months < 12) return {
				key: "monthsAgo",
				value: months
			};
			return {
				key: "yearsAgo",
				value: Math.floor(days / 365)
			};
		}
		/** 相对时间 → 当前语言的文案（中文「3 天前」/ 英文「3 days ago」）。 */
		function ageText(tf, iso, now = Date.now()) {
			const parts = ageParts(iso, now);
			if (parts === void 0) return "";
			return parts.value === void 0 ? tf(parts.key) : tf(parts.key, { n: parts.value });
		}
		/**
		* 头像 URL（host 的 list / detail 提供 `authorAvatar`）。
		*
		* 用结构化读取而不是直接读字段：头像字段由 host 车道并行加入，这里先按「有就渲染、
		* 没有就只显示名字」处理，两边不必抢同一个类型文件的编辑权。
		*/
		function avatarUrlOf(value) {
			const avatar = value?.authorAvatar;
			return typeof avatar === "string" && avatar !== "" ? avatar : void 0;
		}
		/** 是否在最近 `days` 天内动过——列表用它把「刚动过的行」提到第二层色阶。 */
		function isFresh(iso, days = 1, now = Date.now()) {
			const time = timeOf(iso);
			if (time === void 0) return false;
			return now - time <= days * DAY;
		}
		/** 绝对日期（合并时间这类「已经定下来的事实」用日期而不是相对时间）。 */
		function formatDate(iso) {
			const time = timeOf(iso);
			if (time === void 0) return "";
			const date = new Date(time);
			const month = `${date.getMonth() + 1}`.padStart(2, "0");
			const day = `${date.getDate()}`.padStart(2, "0");
			return `${date.getFullYear()}-${month}-${day}`;
		}
		/**
		* 合并桶按**合并时间**倒序展示（搜索接口只能按 updated 取一页；取回之后
		* 在本地按 mergedAt 排一次，避免「刚合并但没再更新」的 PR 被压到下面）。
		* 其它桶保持上游 updated 顺序；返回新数组，不改调用方的数据。
		*/
		function sortRowsForBucket(bucket, rows) {
			if (bucket !== "merged") return [...rows];
			const at = (row) => {
				const parsed = Date.parse(row.mergedAt ?? row.updatedAt);
				return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
			};
			return [...rows].sort((left, right) => at(right) - at(left));
		}
		/** 搜索框匹配：编号（可带 #）、标题、作者、标签，大小写不敏感。 */
		function matchesQuery(row, raw) {
			const query = raw.trim().toLowerCase();
			if (query === "") return true;
			const needle = query.startsWith("#") ? query.slice(1) : query;
			if (String(row.number).includes(needle)) return true;
			if (row.title.toLowerCase().includes(query)) return true;
			if (row.author.toLowerCase().includes(query)) return true;
			return row.labels.some((label) => label.toLowerCase().includes(query));
		}
		//#endregion
		//#region src/client/bits.tsx
		/**
		* 列表与详情共用的小件：头像 / 作者 / 相对时间。
		*
		* 抽出来是因为两边都要用，且**头像有回退语义**：`*.githubusercontent.com` 这条 CDN 在
		* 受限网络里整体不可达（实测 curl HTTP 000），直连必然得到破图。所以这里的策略是
		* 「URL 存在且加载成功 → 显示图片；失败/缺失 → 用首字母圆底占位」，任何情况下都不会
		* 把浏览器的破图图标露给用户。
		*/
		/** 16px 圆头像；加载失败或没有 URL 时回退成首字母（同一几何，视觉上不跳）。 */
		function Avatar({ login, url }) {
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setFailed(false);
			}, [url]);
			if (url === void 0 || failed) return (0, react.createElement)("span", {
				className: "pi-avatar pi-avatarInitials",
				"aria-hidden": true,
				title: login
			}, (login.slice(0, 1) || "?").toUpperCase());
			return (0, react.createElement)("img", {
				className: "pi-avatar",
				src: url,
				alt: "",
				decoding: "async",
				onError: () => {
					setFailed(true);
				}
			});
		}
		/**
		* 作者名（+ 可选头像）。列表里头像已经固定在行首的独立列（两种密度同一 x），
		* 所以那里只出名字；详情页的作者行仍然「头像 + 名字」并排。
		*/
		function Author({ login, avatar, href, withAvatar = true }) {
			const name = href === void 0 ? (0, react.createElement)("span", { key: "l" }, login) : (0, react.createElement)("a", {
				key: "l",
				className: "pi-author",
				href,
				target: "_blank",
				rel: "noopener noreferrer",
				onClick: (event) => {
					event.stopPropagation();
				}
			}, login);
			const children = [];
			if (withAvatar) children.push((0, react.createElement)(Avatar, {
				key: "a",
				login,
				...avatar === void 0 ? {} : { url: avatar }
			}));
			children.push(name);
			return (0, react.createElement)("span", { className: "pi-authorName" }, children);
		}
		/** 相对时间；24h 内动过的行取第二层色阶（`.pi-meta[data-fresh]`）。 */
		function Age({ iso, tf }) {
			return (0, react.createElement)("span", {
				className: "pi-meta",
				"data-fresh": isFresh(iso) ? "true" : void 0
			}, ageText(tf, iso));
		}
		//#endregion
		//#region src/client/errors.ts
		const ERROR_KEYS = {
			"gh-missing": "errGhMissing",
			"gh-unauthenticated": "errGhUnauthenticated",
			"gh-rate-limit": "errGhRateLimit",
			"gh-timeout": "errGhTimeout",
			"not-found": "errNotFound",
			"gh-bad-output": "errGhBadOutput",
			"gh-error": "errGhFailed",
			"bad-request": "errBadRequest",
			"unsupported-host": "errUnsupportedHost",
			"no-repo": "errNoRepo",
			"too-large": "errTooLarge",
			"unsupported-type": "errUnsupportedType",
			"method-not-allowed": "errMethodNotAllowed",
			"unknown-op": "errUnknownOp",
			internal: "errInternal",
			forbidden: "errForbidden"
		};
		const HINT_KEYS = {
			"gh-missing": "hintGhMissing",
			"gh-unauthenticated": "hintGhUnauthenticated",
			"gh-rate-limit": "hintGhRateLimit",
			"gh-timeout": "hintGhTimeout",
			"no-cwd": "hintCwd"
		};
		/** 已知错误码给人话；未知码回退到原始 message（通常已经是 gh 的英文原文）。 */
		function errorText(i18n, error) {
			if (error === void 0) return "";
			const code = error.code;
			if (code !== void 0 && Object.hasOwn(ERROR_KEYS, code)) return i18n.t(ERROR_KEYS[code]);
			const message = error.message?.trim() ?? "";
			return message === "" ? i18n.t("errUnknown") : message;
		}
		/** 可操作的下一步（装 gh / 登录 / 等配额 / 检查网络）；没有对应建议时返回 undefined。 */
		function hintFor(i18n, code) {
			if (code === void 0 || !Object.hasOwn(HINT_KEYS, code)) return void 0;
			return i18n.t(HINT_KEYS[code]);
		}
		//#endregion
		//#region src/client/markdown-images.ts
		/**
		* 把正文里的原始 `<img>` 标签改写成 markdown 图片语法。
		*
		* **为什么必须做这一步**（实测，见 docs/engineering-notes.md）：
		*
		* 1. 官方 `MarkdownText` 是「不可信 assistant markdown」渲染器，**原始 HTML 一律不渲染**
		*    （块级 `html` 节点没有对应渲染分支 → 被丢掉；行内 `html` 只以字面文本出现）。
		*    这是它的安全设计，不是 bug。
		* 2. 但 **GitHub 自己的编辑器插入的图片恰恰是 HTML**：拖一张图进 PR 描述会写成
		*    `<img width="1152" height="1162" alt="image" src="https://github.com/user-attachments/assets/…">`。
		*    于是 PR 正文里最常见的图片形态，在官方渲染器下**必然消失**——用户看到的就是
		*    "PR 内容里的图片渲染不出来"。
		* 3. 官方对图片地址的白名单只认绝对 `http(s)/blob/data`（`vocabularyImageUrl`），
		*    或 `pathImages.resolve` 返回的、能被 `new URL()` 解析成上述协议的地址。改写出来的
		*    目标地址原样交给官方渲染器：绝对 URL 直接渲染，仓库内相对路径走 `pathImages`
		*    → 插件自己的图片代理（受限网络下 raw.githubusercontent.com 不可达，私有仓库也要代理）。
		*
		* 改写是**有界**的，只动代码段之外的 `<img …>`：
		* 围栏代码块（``` / ~~~）、行内反引号串里的内容一律原样保留——文档里讲"怎么写 img 标签"
		* 不能被改写。`width`/`height` 属性丢弃：markdown 没有尺寸语法，官方 `.image` 样式
		* 本身就是 `max-width: 100%`（窄侧栏里按容器缩放才是想要的）。
		*/
		/** HTML 实体解码：只处理标记语言里会真正出现的那几个（正文里的 URL 常见 `&amp;`）。 */
		function decodeEntities(value) {
			return value.replace(/&(?:amp|#38);/gi, "&").replace(/&(?:lt|#60);/gi, "<").replace(/&(?:gt|#62);/gi, ">").replace(/&(?:quot|#34);/gi, "\"").replace(/&(?:apos|#39|#x27);/gi, "'").replace(/&(?:nbsp|#160);/gi, " ");
		}
		/** 取一个属性值：双引号 / 单引号 / 裸值三种写法；只认独立的属性名（`src` 不匹配 `data-src`）。 */
		function attribute(tag, name) {
			const boundary = `(?:^|[\\s"'])${name}\\s*=\\s*`;
			const patterns = [
				`${boundary}"([^"]*)"`,
				`${boundary}'([^']*)'`,
				`${boundary}([^\\s>]+)`
			];
			for (const pattern of patterns) {
				const match = new RegExp(pattern, "i").exec(tag);
				if (match?.[1] !== void 0) return decodeEntities(match[1]);
			}
		}
		/** 一个 `<img …>` 标签 → markdown 图片；取不到 src 就原样返回（交给官方当作原始 HTML 丢掉）。 */
		function toMarkdownImage(tag) {
			const src = attribute(tag, "src");
			if (src === void 0 || src === "") return tag;
			return `![${(attribute(tag, "alt") ?? "").replace(/[[\]]/g, "")}](${/[\s()]/.test(src) ? `<${src}>` : src})`;
		}
		/** 一行里**代码段之外**的 `<img …>` 改写成 markdown（反引号串里的原样保留）。 */
		function rewriteLine(line) {
			let out = "";
			let index = 0;
			let open;
			while (index < line.length) {
				if (open === void 0) {
					const image = /<img\b[^>]*>/i.exec(line.slice(index));
					const imageAt = image === null ? -1 : index + image.index;
					const tick = line.indexOf("`", index);
					if (imageAt !== -1 && (tick === -1 || imageAt < tick)) {
						const tag = image[0];
						out += toMarkdownImage(tag);
						index = imageAt + tag.length;
						continue;
					}
					if (tick === -1) {
						out += line.slice(index);
						break;
					}
					const run = /^`+/.exec(line.slice(tick))[0];
					out += line.slice(index, tick) + run;
					open = run;
					index = tick + run.length;
					continue;
				}
				const close = line.indexOf(open, index);
				if (close === -1) {
					out += line.slice(index);
					break;
				}
				out += line.slice(index, close + open.length);
				index = close + open.length;
				open = void 0;
			}
			return out;
		}
		/** 正文 / 评论的正文：把原始 `<img>` 改写成官方渲染器认识的 markdown 图片。 */
		function expandHtmlImages(markdown) {
			if (!/<img\b/i.test(markdown)) return markdown;
			let fence;
			return markdown.split("\n").map((line) => {
				const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
				if (fenceMatch !== null) {
					const marker = fenceMatch[1][0];
					if (fence === void 0) {
						fence = marker;
						return line;
					}
					if (marker === fence) {
						fence = void 0;
						return line;
					}
					return line;
				}
				return fence === void 0 ? rewriteLine(line) : line;
			}).join("\n");
		}
		//#endregion
		//#region src/client/pr-image.ts
		/** 代理路由的相对路径（`plugins/dsh-pr-inbox/image?...`），不是图片本体。 */
		function resolvePrImagePath(value, repo, ref, cwd) {
			if (repo.host !== "github.com" || ref === "" || cwd === void 0 || cwd === "") return void 0;
			const raw = value.trim();
			if (raw === "" || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return void 0;
			const path = raw.replace(/^\.\//, "").replace(/^\/+/, "");
			if (path === "" || path.split("/").includes("..") || path.split("/").includes(".")) return void 0;
			return `plugins/dsh-pr-inbox/image?${new URLSearchParams({
				cwd,
				ref,
				path
			}).toString()}`;
		}
		//#endregion
		//#region src/client/Detail.tsx
		/**
		* PR 详情视图：**插件自己渲染**（不嵌网页、不跳浏览器）。
		*
		* 正文与评论直接用**宿主的 markdown 渲染器** `MarkdownText`
		* （`@deepseek-ai/dsh-client-ui-primitives`）——它自带 GFM + TeX、围栏代码走官方
		* `CodeBlock`、丢弃原始 HTML、限制协议；`labels` 是必填契约（复制/脚注/代码卡工具栏
		* 文案），走本插件字典，漏传会回退硬编码中文。
		*
		* **图片**要走两步才渲染得出来（实测，见 markdown-images.ts 与 docs/engineering-notes.md）：
		* ① GitHub 编辑器插入的图片是原始 `<img>` 标签，而官方渲染器丢弃原始 HTML → 先经
		* `expandHtmlImages` 改写成 markdown 图片语法；② 官方只接受绝对 http(s)/blob/data 地址
		* → 仓库内相对路径经 `absoluteHostUrl` 走插件自己的图片代理。
		*
		* 其余官方件：`Tag`（身份/状态/标签/文件状态）、`Button`（返回/刷新/外链）、
		* `PathLabel`（文件路径：目录弱化、文件名主色、窄列保后缀）、官方图标。
		*
		* 有界与降级如实呈现：三处截断各一行提示，`warnings` 逐条列出——详情不因支线失败空白。
		*/
		/** 文件状态 → 官方 Tag 色调 + 文案键。 */
		const FILE_TONE = {
			added: "success",
			removed: "danger",
			modified: "warning",
			renamed: "info",
			copied: "info"
		};
		const FILE_KEY = {
			added: "added",
			removed: "removed",
			modified: "modified",
			renamed: "renamed",
			copied: "copied",
			changed: "changed",
			unchanged: "unchanged"
		};
		const REVIEW_TONE = {
			APPROVED: "success",
			CHANGES_REQUESTED: "danger",
			COMMENTED: "neutral",
			DISMISSED: "quiet",
			PENDING: "quiet"
		};
		const REVIEW_KEY = {
			APPROVED: "reviewApproved",
			CHANGES_REQUESTED: "reviewChangesRequested",
			COMMENTED: "reviewCommented",
			DISMISSED: "reviewDismissed",
			PENDING: "reviewPending"
		};
		const WARNING_KEY = {
			files: "warningFiles",
			comments: "warningComments",
			reviews: "warningReviews"
		};
		/** GitHub 用户主页；空 login 不产出链接。 */
		function profileUrl(login) {
			return login === "" ? void 0 : `https://github.com/${encodeURIComponent(login)}`;
		}
		function Comment({ entry, labels, pathImages, i18n }) {
			const { t, tf } = i18n;
			const avatar = avatarUrlOf(entry);
			const href = profileUrl(entry.author);
			const head = [(0, react.createElement)(Author, {
				key: "a",
				login: entry.author,
				...avatar === void 0 ? {} : { avatar },
				...href === void 0 ? {} : { href }
			})];
			if (entry.kind === "review") {
				const state = entry.reviewState ?? "COMMENTED";
				head.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "s",
					tone: REVIEW_TONE[state] ?? "neutral"
				}, t(REVIEW_KEY[state] ?? "reviewCommented")));
			}
			head.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: "t",
				tone: "quiet"
			}, ageText(tf, entry.createdAt)));
			const children = [(0, react.createElement)("div", {
				key: "h",
				className: "pi-commentHead"
			}, head)];
			if (entry.kind === "comment" || entry.body !== "") children.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
				key: "b",
				text: entry.body === "" ? t("emptyBody") : expandHtmlImages(entry.body),
				labels,
				pathImages,
				variant: "compact"
			}));
			return (0, react.createElement)("div", {
				className: "pi-card pi-comment",
				"data-pi-comment": entry.kind
			}, children);
		}
		function FileRow({ file, i18n }) {
			const { t } = i18n;
			return (0, react.createElement)("div", {
				className: "pi-file",
				"data-pi-file": file.path,
				title: file.path
			}, [
				(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "s",
					tone: FILE_TONE[file.status] ?? "neutral"
				}, t(FILE_KEY[file.status] ?? file.status)),
				file.previousPath === void 0 ? null : (0, react.createElement)("span", {
					key: "o",
					className: "pi-fileOld"
				}, file.previousPath),
				(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.PathLabel, {
					key: "p",
					className: "pi-filePath",
					path: file.path
				}),
				(0, react.createElement)("span", {
					key: "c",
					className: "pi-fileCounts"
				}, [
					(0, react.createElement)("span", {
						key: "a",
						className: "pi-add"
					}, `+${file.additions}`),
					" ",
					(0, react.createElement)("span", {
						key: "d",
						className: "pi-del"
					}, `−${file.deletions}`)
				])
			]);
		}
		function Detail({ detail, loading, error, i18n, ctx, cwd, onBack, onRefresh }) {
			const { t, tf } = i18n;
			const detailAvatar = detail === void 0 ? void 0 : avatarUrlOf(detail);
			const detailAuthorHref = detail === void 0 ? void 0 : profileUrl(detail.author);
			const labels = (0, react.useMemo)(() => ({
				code: {
					copyLabel: t("copy"),
					copiedLabel: t("copiedLabel"),
					toolbarLabels: {
						codeLabel: t("codeLabel"),
						wrapLabel: t("wrapLabel"),
						unwrapLabel: t("unwrapLabel")
					}
				},
				footnotes: t("footnotes")
			}), [t]);
			/**
			* 正文 / 评论里的仓库内相对图片 → 插件自己的图片代理（绝对 URL，官方只认这种）。
			* ref 用 `refs/pull/<n>/head`：base 仓里就有这个 ref，fork PR 也适用（headRef 会 404）。
			*/
			const pathImages = (0, react.useMemo)(() => ({ resolve: (value) => {
				if (detail === void 0) return void 0;
				const relative = resolvePrImagePath(value, detail.repo, `refs/pull/${detail.number}/head`, cwd);
				return relative === void 0 ? void 0 : absoluteHostUrl(ctx, relative);
			} }), [
				ctx,
				cwd,
				detail?.repo.host,
				detail?.repo.owner,
				detail?.repo.name,
				detail?.number
			]);
			const head = (0, react.createElement)("div", { className: "pi-head" }, [
				(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "b",
					variant: "ghost",
					size: "sm",
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, {}),
					"aria-label": t("back"),
					title: t("back"),
					onClick: onBack
				}),
				(0, react.createElement)("span", {
					key: "t",
					className: "pi-detailTitle",
					title: detail === void 0 ? "" : `#${detail.number} ${detail.title}`
				}, detail === void 0 ? t("reading") : `#${detail.number} ${detail.title}`),
				(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "r",
					variant: "toolbar",
					size: "sm",
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
					"aria-label": t("refresh"),
					title: t("refresh"),
					onClick: onRefresh,
					disabled: loading
				}),
				detail === void 0 ? null : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "x",
					variant: "ghost",
					size: "sm",
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, {}),
					"aria-label": t("openOnGitHub"),
					title: t("openOnGitHub"),
					onClick: () => {
						window.open(detail.url, "_blank", "noopener,noreferrer");
					}
				})
			]);
			const body = [];
			if (error !== void 0) body.push((0, react.createElement)("div", {
				key: "e",
				className: "pi-notice",
				"data-tone": "error",
				"aria-live": "polite",
				title: error.message
			}, errorText(i18n, error)));
			if (detail === void 0) {
				if (error === void 0) body.push((0, react.createElement)("div", {
					key: "l",
					className: "pi-empty",
					role: "status"
				}, t("reading")));
			} else {
				const meta = [(0, react.createElement)(Author, {
					key: "a",
					login: detail.author,
					...detailAvatar === void 0 ? {} : { avatar: detailAvatar },
					...detailAuthorHref === void 0 ? {} : { href: detailAuthorHref }
				}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "s",
					tone: detail.mergedAt !== void 0 ? "info" : detail.state === "open" ? "success" : "neutral"
				}, detail.mergedAt !== void 0 ? t("merged") : detail.state === "open" ? t("open") : t("closed"))];
				if (detail.isDraft) meta.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "d",
					tone: "warning"
				}, t("draft")));
				for (const label of detail.labels) meta.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: `l:${label}`,
					tone: "neutral"
				}, label));
				body.push((0, react.createElement)("div", {
					key: "meta",
					className: "pi-detailMeta",
					"data-pi-detail": ""
				}, meta));
				body.push((0, react.createElement)("div", {
					key: "stats",
					className: "pi-detailStats"
				}, [
					(0, react.createElement)("span", {
						key: "b",
						className: "pi-branch"
					}, [(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, {
						key: "i",
						size: 14
					}), `${detail.baseRef} ← ${detail.headRef}`]),
					(0, react.createElement)("span", {
						key: "a",
						className: "pi-add"
					}, `+${detail.additions}`),
					(0, react.createElement)("span", {
						key: "d",
						className: "pi-del"
					}, `−${detail.deletions}`),
					(0, react.createElement)("span", { key: "f" }, tf(detail.changedFiles === 1 ? "filesOne" : "files", { count: detail.changedFiles })),
					(0, react.createElement)("span", { key: "c" }, tf(detail.commits === 1 ? "commitsOne" : "commits", { count: detail.commits })),
					(0, react.createElement)("span", { key: "u" }, `${t("updated")} ${ageText(tf, detail.updatedAt)}`),
					detail.mergedAt === void 0 ? null : (0, react.createElement)("span", { key: "m" }, `${t("mergedAt")} ${formatDate(detail.mergedAt)}`)
				]));
				for (const warning of detail.warnings) body.push((0, react.createElement)("div", {
					key: `w:${warning.part}:${warning.message}`,
					className: "pi-notice",
					"data-tone": "warn",
					"aria-live": "polite",
					title: warning.message
				}, `${t(WARNING_KEY[warning.part])}: ${errorText(i18n, warning)}`));
				body.push((0, react.createElement)("div", {
					key: "prose",
					className: "pi-card",
					"data-pi-body": ""
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
					text: detail.body === "" ? t("emptyBody") : expandHtmlImages(detail.body),
					labels,
					pathImages,
					variant: "body"
				})));
				if (detail.bodyTruncated) body.push((0, react.createElement)("div", {
					key: "bt",
					className: "pi-notice",
					"data-tone": "warn"
				}, t("bodyTruncated")));
				body.push((0, react.createElement)("div", {
					key: "th",
					className: "pi-sectionTitle"
				}, [t("timeline"), (0, react.createElement)("span", {
					key: "n",
					className: "pi-sectionCount"
				}, String(detail.timeline.length))]));
				const comments = detail.timeline.map((entry, index) => (0, react.createElement)(Comment, {
					key: `${entry.kind}:${entry.createdAt}:${index}`,
					entry,
					labels,
					pathImages,
					i18n
				}));
				body.push((0, react.createElement)("div", {
					key: "tl",
					className: "pi-stack"
				}, comments.length === 0 ? [(0, react.createElement)("div", {
					key: "te",
					className: "pi-empty"
				}, t("noTimeline"))] : comments));
				if (detail.timelineTruncated) body.push((0, react.createElement)("div", {
					key: "tt",
					className: "pi-notice",
					"data-tone": "warn"
				}, t("timelineTruncated")));
				body.push((0, react.createElement)("div", {
					key: "fh",
					className: "pi-sectionTitle"
				}, [t("filesTitle"), (0, react.createElement)("span", {
					key: "n",
					className: "pi-sectionCount"
				}, String(detail.changedFiles))]));
				if (detail.files.length === 0) body.push((0, react.createElement)("div", {
					key: "fe",
					className: "pi-empty"
				}, t("noFiles")));
				else body.push((0, react.createElement)("div", {
					key: "fl",
					className: "pi-card",
					"data-flush": "true"
				}, detail.files.map((file) => (0, react.createElement)(FileRow, {
					key: file.path,
					file,
					i18n
				}))));
				if (detail.filesTruncated) body.push((0, react.createElement)("div", {
					key: "ft",
					className: "pi-notice",
					"data-tone": "warn"
				}, t("filesTruncated")));
			}
			return (0, react.createElement)("div", {
				className: "pi-detail",
				"data-dsh-pr-inbox-detail": String(detail?.number ?? ""),
				tabIndex: -1,
				role: "region",
				"aria-label": detail === void 0 ? t("tabTitle") : `#${detail.number} ${detail.title}`
			}, head, (0, react.createElement)("div", { className: "pi-detailBody" }, body));
		}
		//#endregion
		//#region src/client/prefs.ts
		const KEY = "dsh-pr-inbox:density";
		function defaultStore() {
			try {
				if (typeof localStorage === "undefined") return void 0;
				return localStorage;
			} catch {
				return;
			}
		}
		function loadDensity(store = defaultStore()) {
			try {
				return store?.getItem(KEY) === "detailed" ? "detailed" : "compact";
			} catch {
				return "compact";
			}
		}
		function saveDensity(value, store = defaultStore()) {
			try {
				store?.setItem(KEY, value);
			} catch {}
		}
		//#endregion
		//#region src/client/Panel.tsx
		/**
		* PR 列表：三桶分区 + 顶部搜索 + 简洁/详细两种密度。
		*
		* 控件**全部来自官方** `@deepseek-ai/dsh-client-ui-primitives`（`Input` / `Pill` /
		* `Button` / `Tag` / 官方图标）——官方铁律是「库里有控件就不要抄第二份」；自绘的只有
		* 官方没有的语义：分组列表的分区头与 PR 行（几何与颜色照官方规范，见 styles.ts）。
		* 文案全部经 `i18n`（宿主 locale 服务），不自己判语言；错误按 code 翻译
		* （见 errors.ts），host 的原始 message 只进 `title`（排障用）。
		*
		* 稳态开销：只在 `visible` 时取数、不持定时器、重新可见即补刷一次；host 侧还有
		* 60 s 有界缓存，反复切 tab 不会打爆搜索配额。刷新时保留旧内容（stale-while-revalidate），
		* 不再把列表/详情闪成「读取中…」。
		*
		* 可寻址面（也给挂载自检用）：`[data-dsh-pr-inbox-panel]` / `[data-pi-view]` /
		* `[data-bucket]` / `[data-pr-row="<number>"]` / `[data-pi-foot]`；顶栏的搜索框、
		* 密度开关、刷新是官方控件，按 role/aria 名寻址（官方件不接裸 `data-*`）。
		*/
		const BUCKETS = [
			"authored",
			"review",
			"merged"
		];
		const BUCKET_LABEL = {
			authored: "bucketAuthored",
			review: "bucketReview",
			merged: "bucketMerged"
		};
		const BUCKET_HINT = {
			authored: "hintAuthored",
			review: "hintReview",
			merged: "hintMerged"
		};
		/** 行本身是可点面（开详情），右侧 ↗ 是官方 Button——用 role/tabIndex 而不是嵌套 button。
		*  按键只处理**行自身**：外链按钮的 Enter/Space 冒泡上来时不能被行劫持。 */
		function rowHandlers(onActivate) {
			return {
				role: "button",
				tabIndex: 0,
				onClick: onActivate,
				onKeyDown: (event) => {
					if (event.target !== event.currentTarget) return;
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onActivate();
					}
				}
			};
		}
		function OpenExternal(props) {
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				className: "pi-external",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, {}),
				"aria-label": props.label,
				title: props.label,
				onClick: (event) => {
					event.stopPropagation();
					window.open(props.url, "_blank", "noopener,noreferrer");
				}
			});
		}
		function notice(key, text, tone, title) {
			return (0, react.createElement)("div", {
				key,
				className: "pi-notice",
				...tone === void 0 ? {} : { "data-tone": tone },
				...title === void 0 || title === "" ? {} : { title },
				"aria-live": "polite"
			}, text);
		}
		/**
		* 一行 PR 的固定几何（两种密度共用同一条身份行）：
		*
		*   ◯  #123  标题…                      [草稿]  2 天前  (↗ 悬停才出现)
		*      alice  [合并于…] [标签] [3 条评论]          ← 只有「详细」多出这条事实行
		*
		* 头像在**行首独立列**（两种密度同 x、同宽、同高，与首行中线对齐），身份行的元素
		* 顺序与右边界也完全相同：切换密度只是增删第二条事实行，已有信息一律不跳位。
		* 挂载门用元素坐标钉住这一点（见 scripts/gates/mount.mjs 的「行几何」断言）。
		*/
		function Row(props) {
			const { row, density, i18n } = props;
			const { t, tf } = i18n;
			const avatar = avatarUrlOf(row);
			const handlers = rowHandlers(() => {
				props.onSelect(row);
			});
			const identity = [(0, react.createElement)("span", {
				key: "n",
				className: "pi-num"
			}, `#${row.number}`), (0, react.createElement)("span", {
				key: "t",
				className: "pi-subject",
				title: row.title
			}, row.title)];
			if (row.isDraft) identity.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: "d",
				tone: "warning"
			}, t("draft")));
			identity.push((0, react.createElement)("span", {
				key: "g",
				className: "pi-age"
			}, (0, react.createElement)(Age, {
				iso: row.updatedAt,
				tf
			})));
			identity.push((0, react.createElement)(OpenExternal, {
				key: "x",
				url: row.url,
				label: t("openOnGitHub")
			}));
			const lines = [(0, react.createElement)("div", {
				key: "l1",
				className: "pi-line1"
			}, identity)];
			if (density === "detailed") {
				const facts = [(0, react.createElement)(Author, {
					key: "a",
					login: row.author,
					withAvatar: false
				})];
				if (row.mergedAt !== void 0) facts.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "m",
					tone: "info"
				}, `${t("mergedAt")} ${ageText(tf, row.mergedAt)}`));
				for (const label of row.labels.slice(0, 4)) facts.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: `l:${label}`,
					tone: "neutral"
				}, label));
				if (row.labels.length > 4) facts.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "l+",
					tone: "quiet"
				}, `+${row.labels.length - 4}`));
				if (row.comments > 0) facts.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "c",
					tone: "quiet"
				}, tf(row.comments === 1 ? "commentsCountOne" : "commentsCount", { count: row.comments })));
				lines.push((0, react.createElement)("div", {
					key: "l2",
					className: "pi-line2"
				}, facts));
			}
			return (0, react.createElement)("div", {
				...handlers,
				className: "pi-row",
				"data-density": density,
				"data-pr-row": String(row.number),
				"data-selected": props.selected ? "true" : void 0,
				"aria-current": props.selected ? "true" : void 0,
				...density === "compact" ? { title: `${row.author} · ${ageText(tf, row.updatedAt)}` } : {}
			}, [(0, react.createElement)("span", {
				key: "a",
				className: "pi-avatarCell"
			}, (0, react.createElement)(Avatar, {
				login: row.author,
				...avatar === void 0 ? {} : { url: avatar }
			})), (0, react.createElement)("div", {
				key: "m",
				className: "pi-main"
			}, lines)]);
		}
		function Section(props) {
			const { bucket, value, query, i18n } = props;
			const { t, tf } = i18n;
			const rows = (0, react.useMemo)(() => sortRowsForBucket(bucket, (value?.rows ?? []).filter((row) => matchesQuery(row, query))), [
				bucket,
				value,
				query
			]);
			const total = value?.total ?? 0;
			const filtered = query.trim() !== "";
			const count = filtered ? tf("hits", {
				hit: rows.length,
				total
			}) : rows.length < total ? tf("shownOfTotal", {
				shown: rows.length,
				total
			}) : String(total);
			const body = [];
			if (value?.error !== void 0) {
				body.push(notice("e", errorText(i18n, value.error), "error", value.error.message));
				const hint = hintFor(i18n, value.error.code);
				if (hint !== void 0) body.push(notice("h", hint));
			} else if (rows.length === 0) body.push((0, react.createElement)("div", {
				key: "z",
				className: "pi-empty"
			}, filtered ? t("noMatch") : t("bucketEmpty")));
			for (const row of rows) body.push((0, react.createElement)(Row, {
				key: row.number,
				row,
				density: props.density,
				selected: props.selected === row.number,
				onSelect: props.onSelect,
				i18n
			}));
			return (0, react.createElement)("section", {
				className: "pi-section",
				"data-bucket": bucket,
				"data-open": props.open ? "true" : "false"
			}, [(0, react.createElement)("button", {
				key: "h",
				type: "button",
				className: "pi-sectionHeader",
				onClick: props.onToggle,
				"aria-expanded": props.open,
				"aria-controls": `pi-rows-${bucket}`,
				title: t(BUCKET_HINT[bucket])
			}, [
				(0, react.createElement)("span", {
					key: "c",
					className: "pi-chevron"
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 })),
				(0, react.createElement)("span", {
					key: "l",
					className: "pi-sectionLabel"
				}, t(BUCKET_LABEL[bucket])),
				(0, react.createElement)("span", {
					key: "n",
					className: "pi-sectionCount",
					"data-attention": bucket === "review" && total > 0 ? "true" : void 0,
					...rows.length < total ? { title: tf("shownOfTotalTitle", {
						shown: rows.length,
						total
					}) } : {}
				}, count)
			]), (0, react.createElement)("div", {
				key: "b",
				className: "pi-rows",
				id: `pi-rows-${bucket}`
			}, body)]);
		}
		function Panel({ ctx, i18n, sessionId, cwd, visible }) {
			const { t, tf } = i18n;
			const [state, setState] = (0, react.useState)({ phase: "loading" });
			const [refreshing, setRefreshing] = (0, react.useState)(false);
			const [refreshError, setRefreshError] = (0, react.useState)(void 0);
			const [query, setQuery] = (0, react.useState)("");
			const [density, setDensityState] = (0, react.useState)(() => loadDensity());
			const [collapsed, setCollapsed] = (0, react.useState)({});
			const [selected, setSelected] = (0, react.useState)(void 0);
			const [open, setOpen] = (0, react.useState)(void 0);
			const [detail, setDetail] = (0, react.useState)({ loading: false });
			const generation = (0, react.useRef)(0);
			const detailGeneration = (0, react.useRef)(0);
			const cwdRef = (0, react.useRef)(void 0);
			const stateRef = (0, react.useRef)(state);
			stateRef.current = state;
			const rootRef = (0, react.useRef)(null);
			const bodyRef = (0, react.useRef)(null);
			const restoreScroll = (0, react.useRef)(void 0);
			const focusRow = (0, react.useRef)(void 0);
			const densityRef = (0, react.useRef)(density);
			densityRef.current = density;
			const ensureCwd = (0, react.useCallback)(async () => {
				if (cwdRef.current !== void 0) return cwdRef.current;
				const resolved = await resolveCwd(ctx, sessionId, cwd);
				cwdRef.current = resolved;
				return resolved;
			}, [
				ctx,
				sessionId,
				cwd
			]);
			const load = (0, react.useCallback)(async () => {
				const mine = generation.current + 1;
				generation.current = mine;
				const keep = stateRef.current.phase === "ready";
				if (keep) setRefreshing(true);
				else setState({ phase: "loading" });
				setRefreshError(void 0);
				try {
					const resolved = await ensureCwd();
					if (resolved === void 0) {
						if (mine !== generation.current) return;
						const failure = {
							message: t("unbound"),
							code: "no-cwd"
						};
						if (keep) setRefreshError(failure);
						else setState({
							phase: "failed",
							...failure
						});
						return;
					}
					const value = await callOp(ctx, "list", { cwd: resolved });
					if (mine === generation.current) setState({
						phase: "ready",
						value
					});
				} catch (error) {
					if (mine !== generation.current) return;
					const message = error instanceof Error ? error.message : String(error);
					const code = error instanceof RouteError ? error.code : void 0;
					const failure = {
						message,
						...code === void 0 ? {} : { code }
					};
					if (keep) setRefreshError(failure);
					else setState({
						phase: "failed",
						...failure
					});
				} finally {
					if (mine === generation.current) setRefreshing(false);
				}
			}, [
				ctx,
				ensureCwd,
				t
			]);
			const loadDetail = (0, react.useCallback)(async (number) => {
				const mine = detailGeneration.current + 1;
				detailGeneration.current = mine;
				setDetail((previous) => ({
					loading: true,
					...previous.value === void 0 ? {} : { value: previous.value }
				}));
				try {
					const resolved = await ensureCwd();
					if (resolved === void 0) {
						if (mine !== detailGeneration.current) return;
						const failure = {
							message: t("unbound"),
							code: "no-cwd"
						};
						setDetail((previous) => ({
							loading: false,
							...previous.value === void 0 ? {} : { value: previous.value },
							error: failure
						}));
						return;
					}
					const value = await callOp(ctx, "detail", {
						cwd: resolved,
						number
					});
					if (mine === detailGeneration.current) setDetail({
						loading: false,
						value
					});
				} catch (error) {
					if (mine !== detailGeneration.current) return;
					const message = error instanceof Error ? error.message : String(error);
					const code = error instanceof RouteError ? error.code : void 0;
					const failure = {
						message,
						...code === void 0 ? {} : { code }
					};
					setDetail((previous) => ({
						loading: false,
						...previous.value === void 0 ? {} : { value: previous.value },
						error: failure
					}));
				}
			}, [
				ctx,
				ensureCwd,
				t
			]);
			/**
			* 换 session / 换工作区时**必须作废 cwd 缓存**：`cwdRef` 一旦解析就永不复位的话，
			* 同一个组件实例会继续读上一个仓库。顺手把详情收起来（旧 PR 在新仓库里未必存在）。
			*/
			(0, react.useEffect)(() => {
				cwdRef.current = void 0;
				setSelected(void 0);
				setOpen(void 0);
				setDetail({ loading: false });
			}, [sessionId, cwd]);
			const openRow = (0, react.useCallback)((row) => {
				restoreScroll.current = bodyRef.current?.scrollTop ?? 0;
				focusRow.current = row.number;
				setSelected(row.number);
				setOpen(row.number);
			}, []);
			const back = (0, react.useCallback)(() => {
				detailGeneration.current += 1;
				setOpen(void 0);
				setDetail({ loading: false });
			}, []);
			(0, react.useEffect)(() => {
				if (!visible) return;
				load();
			}, [visible, load]);
			(0, react.useEffect)(() => {
				if (!visible || open === void 0) return;
				loadDetail(open);
			}, [
				visible,
				open,
				loadDetail
			]);
			/** 打开详情时把焦点送进详情根（键盘用户不会掉到 body 上）；返回时恢复滚动与行焦点。 */
			(0, react.useLayoutEffect)(() => {
				const root = rootRef.current;
				if (open !== void 0) {
					(root?.querySelector("[data-dsh-pr-inbox-detail]"))?.focus({ preventScroll: true });
					return;
				}
				if (restoreScroll.current !== void 0) {
					if (bodyRef.current !== null) bodyRef.current.scrollTop = restoreScroll.current;
					restoreScroll.current = void 0;
				}
				if (focusRow.current !== void 0) {
					(root?.querySelector(`[data-pr-row="${focusRow.current}"]`))?.focus({ preventScroll: true });
					focusRow.current = void 0;
				}
			}, [open]);
			/** Esc 返回列表；输入框里的 Esc 交给输入框自己处理。 */
			(0, react.useEffect)(() => {
				if (open === void 0) return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented) return;
					const target = event.target;
					if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
					back();
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, [open, back]);
			const chooseDensity = (0, react.useCallback)((next) => {
				if (densityRef.current === next) return;
				setDensityState(next);
				saveDensity(next);
			}, []);
			const ready = state.phase === "ready" ? state.value : void 0;
			const repoTitle = ready?.repo === null || ready?.repo === void 0 ? t("unboundShort") : `${ready.repo.fullName}${ready.repo.remoteName === void 0 ? "" : ` (${ready.repo.remoteName})`}`;
			const foot = (0, react.createElement)("div", {
				className: "pi-foot",
				"data-pi-foot": ""
			}, [(0, react.createElement)("span", {
				key: "r",
				className: "pi-footRepo",
				title: repoTitle
			}, ready?.repo?.fullName ?? t("unboundShort")), (0, react.createElement)("span", {
				key: "m",
				className: "pi-footMeta"
			}, [ready?.gh.login === void 0 ? "" : `@${ready.gh.login}`, ready === void 0 ? "" : `${t("updated")} ${ageText(tf, ready.fetchedAt)}`].filter((part) => part !== "").join(" · "))]);
			if (open !== void 0) return (0, react.createElement)("div", {
				ref: rootRef,
				className: "pi-root",
				"data-dsh-pr-inbox-panel": "",
				"data-pi-view": "detail",
				"aria-busy": detail.loading ? "true" : void 0
			}, [(0, react.createElement)(Detail, {
				detail: detail.value,
				loading: detail.loading,
				error: detail.error,
				i18n,
				ctx,
				cwd: cwdRef.current ?? cwd,
				onBack: back,
				onRefresh: () => {
					loadDetail(open);
				}
			}), foot]);
			const head = (0, react.createElement)("div", { className: "pi-head" }, [
				(0, react.createElement)("span", {
					key: "s",
					className: "pi-search"
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutlineRegular, {}),
					placeholder: t("searchPlaceholder"),
					"aria-label": t("searchPlaceholder"),
					value: query,
					spellCheck: false,
					onChange: (event) => {
						setQuery(event.target.value);
					}
				})),
				(0, react.createElement)("span", {
					key: "d",
					className: "pi-density",
					role: "group",
					"aria-label": t("density")
				}, [(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
					key: "c",
					active: density === "compact",
					"aria-pressed": density === "compact",
					onClick: () => {
						chooseDensity("compact");
					}
				}, t("compact")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
					key: "x",
					active: density === "detailed",
					"aria-pressed": density === "detailed",
					onClick: () => {
						chooseDensity("detailed");
					}
				}, t("detailed"))]),
				(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "r",
					variant: "toolbar",
					size: "sm",
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
					"aria-label": t("refresh"),
					title: t("refresh"),
					disabled: !visible || refreshing,
					onClick: () => {
						load();
					}
				})
			]);
			const body = [];
			if (state.phase === "failed") {
				body.push(notice("e", errorText(i18n, state), "error", state.message));
				const hint = hintFor(i18n, state.code);
				if (hint !== void 0) body.push(notice("h", hint));
			} else if (state.phase === "loading") body.push((0, react.createElement)("div", {
				key: "l",
				className: "pi-empty",
				role: "status",
				"aria-live": "polite"
			}, t("reading")));
			else {
				const value = state.value;
				if (refreshError !== void 0) {
					body.push(notice("re", errorText(i18n, refreshError), "warn", refreshError.message));
					const hint = hintFor(i18n, refreshError.code);
					if (hint !== void 0) body.push(notice("reh", hint));
				}
				if (value.gh.available !== true) {
					body.push(notice("g", errorText(i18n, {
						code: value.gh.code ?? "gh-missing",
						message: value.gh.error
					}), "error", value.gh.error));
					const hint = hintFor(i18n, value.gh.code ?? "gh-missing");
					if (hint !== void 0) body.push(notice("gh", hint));
				} else {
					if (value.gh.login === void 0) {
						body.push(notice("g", errorText(i18n, {
							code: value.gh.code ?? "gh-unauthenticated",
							message: value.gh.error
						}), "error", value.gh.error));
						const hint = hintFor(i18n, value.gh.code ?? "gh-unauthenticated");
						if (hint !== void 0) body.push(notice("h", hint));
					}
					if (value.repo === null) body.push(notice("r", t("unbound"), "warn"));
					else if (value.repo.host !== "github.com") body.push(notice("n", tf("unsupportedHost", { host: value.repo.host }), "warn"));
					if (value.repo !== null && value.repo.host === "github.com") for (const bucket of BUCKETS) body.push((0, react.createElement)(Section, {
						key: bucket,
						bucket,
						value: value.buckets[bucket],
						query,
						density,
						i18n,
						open: collapsed[bucket] !== true,
						onToggle: () => {
							setCollapsed((previous) => ({
								...previous,
								[bucket]: previous[bucket] !== true
							}));
						},
						selected,
						onSelect: openRow
					}));
				}
			}
			return (0, react.createElement)("div", {
				ref: rootRef,
				className: "pi-root",
				"data-dsh-pr-inbox-panel": "",
				"data-refreshing": refreshing ? "true" : void 0,
				"aria-busy": state.phase === "loading" || refreshing ? "true" : void 0
			}, head, (0, react.createElement)("div", {
				key: "b",
				className: "pi-body",
				ref: bodyRef
			}, body), foot);
		}
		//#endregion
		//#region src/client/i18n.ts
		const NS = "dsh-pr-inbox";
		const zh = {
			tabTitle: "PR",
			tabDescription: "本项目 Pull Request：我提的 / 待我审 / 最近合并",
			searchPlaceholder: "搜索标题 / 编号 / 作者 / 标签…",
			refresh: "刷新",
			reading: "读取中…",
			compact: "简洁",
			detailed: "详细",
			bucketAuthored: "我提的",
			bucketReview: "待我审",
			bucketMerged: "我合并的",
			hintAuthored: "你作者、仍在开启的 PR",
			hintReview: "等你 review 的 PR",
			hintMerged: "你合并的最近 20 条（按合并时间倒序）",
			bucketEmpty: "这个桶暂时是空的",
			noMatch: "没有匹配的 PR",
			hits: "命中 {hit} / {total}",
			shownOfTotal: "{shown} / {total}",
			shownOfTotalTitle: "已加载 {shown} 条，共 {total} 条",
			density: "列表密度",
			draft: "草稿",
			open: "开放",
			closed: "已关闭",
			merged: "已合并",
			mergedAt: "合并于",
			updated: "更新于",
			justNow: "刚刚",
			minutesAgo: "{n} 分钟前",
			hoursAgo: "{n} 小时前",
			daysAgo: "{n} 天前",
			monthsAgo: "{n} 个月前",
			yearsAgo: "{n} 年前",
			comments: "评论",
			commentsCount: "{count} 条评论",
			commentsCountOne: "{count} 条评论",
			unbound: "当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（upstream / origin → github.com/owner/repo）。",
			unboundShort: "未绑定项目",
			openOnGitHub: "在 GitHub 打开",
			back: "返回列表",
			emptyBody: "（没有正文）",
			bodyTruncated: "正文过长，已截断显示。",
			timeline: "评论与评审",
			noTimeline: "还没有评论",
			timelineTruncated: "时间线过长，只显示前一部分（最早的）。",
			filesTitle: "改动文件",
			filesTruncated: "文件过多，只显示前一部分。",
			noFiles: "没有文件信息",
			files: "{count} 个文件",
			filesOne: "{count} 个文件",
			commits: "{count} 次提交",
			commitsOne: "{count} 次提交",
			added: "新增",
			removed: "删除",
			modified: "修改",
			renamed: "改名",
			copied: "复制",
			changed: "改动",
			unchanged: "未变",
			reviewApproved: "已批准",
			reviewChangesRequested: "要求修改",
			reviewCommented: "评论",
			reviewDismissed: "已忽略",
			reviewPending: "待处理",
			copy: "复制",
			copiedLabel: "已复制",
			codeLabel: "代码",
			wrapLabel: "换行",
			unwrapLabel: "不换行",
			footnotes: "脚注",
			warningFiles: "文件清单",
			warningComments: "评论",
			warningReviews: "评审",
			unsupportedHost: "当前只支持 github.com（这个工作区绑定的是 {host}）。",
			errGhMissing: "找不到 GitHub CLI。",
			errGhUnauthenticated: "本机 gh 未登录。",
			errGhRateLimit: "触达 GitHub API 速率上限。",
			errGhTimeout: "本机 gh 响应超时。",
			errNotFound: "找不到这个 PR（已删除或没有权限）。",
			errGhBadOutput: "gh 返回了无法解析的输出。",
			errGhFailed: "gh 命令失败。",
			errBadRequest: "请求参数不合法。",
			errUnsupportedHost: "当前只支持 github.com。",
			errNoRepo: "当前工作区没有可识别的 forge 项目。",
			errTooLarge: "文件超过本插件允许的大小。",
			errUnsupportedType: "只支持图片。",
			errMethodNotAllowed: "请求方法不允许。",
			errUnknownOp: "未知操作。",
			errInternal: "插件内部错误。",
			errForbidden: "跨站请求被拒绝。",
			errUnknown: "读取失败。",
			hintGhMissing: "安装 GitHub CLI（https://cli.github.com）后执行 `gh auth login`。",
			hintGhUnauthenticated: "执行 `gh auth login` 登录后再刷新。",
			hintGhRateLimit: "已认证搜索配额是 30 次/分，等一分钟再试。",
			hintGhTimeout: "检查网络/代理后重试。",
			hintCwd: "先在该会话里打开一个文件或产生一次工具调用，让会话确定工作目录。"
		};
		const en = {
			tabTitle: "PR",
			tabDescription: "Pull requests of this project: authored by me / needs my review / recently merged",
			searchPlaceholder: "Search title / number / author / label…",
			refresh: "Refresh",
			reading: "Loading…",
			compact: "Compact",
			detailed: "Detailed",
			bucketAuthored: "Authored by me",
			bucketReview: "Needs my review",
			bucketMerged: "Merged by me",
			hintAuthored: "PRs you authored that are still open",
			hintReview: "PRs awaiting your review",
			hintMerged: "The 20 most recent PRs you merged (newest merge first)",
			bucketEmpty: "Nothing in this bucket yet",
			noMatch: "No matching PRs",
			hits: "{hit} / {total} shown",
			shownOfTotal: "{shown} / {total}",
			shownOfTotalTitle: "{shown} loaded of {total}",
			density: "List density",
			draft: "Draft",
			open: "Open",
			closed: "Closed",
			merged: "Merged",
			mergedAt: "merged",
			updated: "updated",
			justNow: "just now",
			minutesAgo: "{n} min ago",
			hoursAgo: "{n} hr ago",
			daysAgo: "{n} d ago",
			monthsAgo: "{n} mo ago",
			yearsAgo: "{n} y ago",
			comments: "comments",
			commentsCount: "{count} comments",
			commentsCountOne: "{count} comment",
			unbound: "This workspace is not a git repository, or its remote does not resolve to a forge project (upstream / origin → github.com/owner/repo).",
			unboundShort: "no project",
			openOnGitHub: "Open on GitHub",
			back: "Back to list",
			emptyBody: "(no description)",
			bodyTruncated: "Description was long; shown truncated.",
			timeline: "Comments and reviews",
			noTimeline: "No comments yet",
			timelineTruncated: "Timeline is long; only the earliest part is shown.",
			filesTitle: "Changed files",
			filesTruncated: "Too many files; only the first part is shown.",
			noFiles: "No file information",
			files: "{count} files",
			filesOne: "{count} file",
			commits: "{count} commits",
			commitsOne: "{count} commit",
			added: "added",
			removed: "removed",
			modified: "modified",
			renamed: "renamed",
			copied: "copied",
			changed: "changed",
			unchanged: "unchanged",
			reviewApproved: "approved",
			reviewChangesRequested: "changes requested",
			reviewCommented: "commented",
			reviewDismissed: "dismissed",
			reviewPending: "pending",
			copy: "Copy",
			copiedLabel: "Copied",
			codeLabel: "Code",
			wrapLabel: "Wrap",
			unwrapLabel: "No wrap",
			footnotes: "Footnotes",
			warningFiles: "Files",
			warningComments: "Comments",
			warningReviews: "Reviews",
			unsupportedHost: "Only github.com is supported (this workspace is bound to {host}).",
			errGhMissing: "GitHub CLI not found.",
			errGhUnauthenticated: "The local gh is not logged in.",
			errGhRateLimit: "GitHub API rate limit reached.",
			errGhTimeout: "The local gh timed out.",
			errNotFound: "PR not found (deleted or no access).",
			errGhBadOutput: "gh returned unparsable output.",
			errGhFailed: "gh command failed.",
			errBadRequest: "Invalid request.",
			errUnsupportedHost: "Only github.com is supported.",
			errNoRepo: "This workspace is not a recognised forge project.",
			errTooLarge: "File exceeds this plugin's size limit.",
			errUnsupportedType: "Only images are supported.",
			errMethodNotAllowed: "Method not allowed.",
			errUnknownOp: "Unknown operation.",
			errInternal: "Internal plugin error.",
			errForbidden: "Cross-site request rejected.",
			errUnknown: "Request failed.",
			hintGhMissing: "Install GitHub CLI (https://cli.github.com), then run `gh auth login`.",
			hintGhUnauthenticated: "Run `gh auth login`, then refresh.",
			hintGhRateLimit: "Authenticated search quota is 30/min; wait a minute and retry.",
			hintGhTimeout: "Check your network/proxy and retry.",
			hintCwd: "Open a file or run a tool call in this session so it has a working directory."
		};
		function browserIsChinese() {
			if (typeof navigator === "undefined") return false;
			return (navigator.language ?? "").toLowerCase().startsWith("zh");
		}
		/**
		* 注册本插件的字典并给出一对取词函数。
		* @param ctx - client cordis context（用结构化探测取 `locale`，不写进 inject 的强依赖）。
		*/
		function createI18n(ctx) {
			const get = ctx.get;
			const service = typeof get === "function" ? get.call(ctx, "locale") : void 0;
			const disposers = [];
			let bound;
			if (typeof service?.register === "function") try {
				disposers.push(service.register(NS, "zh", zh), service.register(NS, "en", en));
				bound = typeof service.bind === "function" ? service.bind(NS) : void 0;
			} catch {
				bound = void 0;
			}
			const fallback = browserIsChinese() ? zh : en;
			const local = (key, params) => {
				let text = fallback[key] ?? en[key] ?? key;
				if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
				return text;
			};
			/**
			* 取词**永不抛**。宿主会把我们的函数放进它自己的渲染路径（tab 标题、原生芯片、
			* 槽内容），在里面抛一次就会带崩整块 UI —— 实测一次 `lookup` 签名写错导致
			* `slot entry crashed in 'sidebar.right.pane.tab'`，整个原生右栏渲染不出来。
			*/
			const safe = (key, params) => {
				if (bound !== void 0) try {
					const text = bound(key, params);
					if (typeof text === "string" && text !== "") return text;
				} catch {}
				return local(key, params);
			};
			return {
				t: (key) => safe(key),
				tf: (key, params) => safe(key, params),
				dispose: () => {
					for (const off of disposers) off();
				}
			};
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* 只留**库内没有的布局粘合**样式：控件（Input / Button / Pill / Tag）、图标、
		* markdown 正文、文件路径都直接用 `@deepseek-ai/dsh-client-ui-primitives` 的官方
		* 件——官方铁律是「能复用就复用，不要抄第二份」，所以这里没有第二套按钮/输入框/
		* 胶囊/markdown 排版。
		*
		* 自绘的只有官方没有的语义：分组列表的分区头、PR 行、文件行、状态行的排版。
		* 几何与颜色照官方规范取：分隔线 **0.5px** 中性线、圆角按角色取 token
		* （紧凑行 H20–28 → `--dsw-radius-sm`；微元素 → `--dsw-radius-xs`），
		* 颜色只消费 `--dsw-alias-*`，不定义第二套主题、不写死色值。
		*/
		const STYLE_ID = "dsh-pr-inbox-styles";
		const CSS = `
.pi-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

/* ── 头带：官方 Input + Pill + Button ───────────────────────────────────── */
.pi-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.pi-search { flex: 1; min-width: 0; display: flex; }
.pi-search > * { flex: 1; min-width: 0; }
.pi-density { display: inline-flex; align-items: center; gap: 4px; flex: none; }

/* ── 列表 ───────────────────────────────────────────────────────────────── */
.pi-body { flex: 1; min-height: 0; overflow: auto; padding: 0 0 8px; }
/* 分区分界 = 「上一区块的行线 + 28px 头带 + 头带底线」两道线夹一条带；
   行与行之间只有一道线。同一档线（l2）靠**线的数量与带的间隔**区分层级，
   而不是靠线本身的深浅——官方 border-l1..l4 的浅端（l1 = 4% 黑）在浅色主题下
   几乎看不见，做行边界不合格（这也是上一轮详情分块踩过的同一个坑）。 */
.pi-section + .pi-section { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.pi-sectionHeader {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-strong-12);
  cursor: pointer;
  /* 分区头在长列表里跟随滚动：条带自身填底（官方 bg-base），否则行会从字下面穿过。
     z-index 必须给：PR 行是定位元素（选中竖条的定位上下文），不压上去就会被盖住。 */
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--dsw-alias-bg-base);
}
.pi-sectionLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-sectionCount {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
}
/* 「待我审」有货时计数取警告色：这是面板里唯一「需要你动作」的信号。 */
.pi-sectionCount[data-attention='true'] { color: var(--dsw-alias-state-warn-primary); }
.pi-chevron { flex: none; display: inline-flex; color: var(--dsw-alias-label-tertiary); transition: transform 120ms var(--ds-ease-in-out); }
.pi-section[data-open='false'] .pi-chevron { transform: rotate(-90deg); }
.pi-section[data-open='false'] .pi-rows { display: none; }

/* 一行 = 「行首头像列 + 内容列」的通栏条带。条带满宽铺开（与分区头同一套几何）：
   实测浅色主题下宿主各层填充全是 #fff，静止行没有填充差可依，**行与行的边界只能靠
   0.5px 中性发丝线**——这也正是官方「中性边框/分隔线一律 0.5px」的用法。 */
.pi-row {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 10px 4px 12px;
  cursor: pointer;
}
.pi-row + .pi-row { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.pi-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-row[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active); }
/* 当前项再加官方那根 2px 内嵌强调条（伪元素，行高不因此变化）。 */
.pi-row[data-selected='true']::before {
  content: '';
  position: absolute;
  left: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
}
.pi-row:focus-visible { outline: 2px solid var(--dsw-alias-interactive-bg-hover-accent); outline-offset: -1px; }

/* 头像列：**两种密度同宽同 x、与首行中线对齐**——「头像固定在行首」的几何保证。
   高度 20px = 首行高度，所以详细档两行时头像仍钉在标题那一行的中线上。 */
.pi-avatarCell {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
}
.pi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
/* 简洁档 = 只有首行（28px 通栏，官方控件高度）；详细档 = 首行 + 事实行。 */
.pi-row[data-density='compact'] { align-items: center; height: 28px; padding-top: 0; padding-bottom: 0; }
.pi-line1 { display: flex; align-items: center; gap: 8px; min-width: 0; height: 20px; }
.pi-line2 { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.pi-age { flex: none; display: inline-flex; align-items: center; }
/* 「在 GitHub 打开」静止时不占视线（官方/sidebar 惯例：hover 或键盘聚焦才现形）。
   opacity + pointer-events：静止时那 24px 点击**穿透到行**（开详情），不会误开外链。
   触屏没有 hover，那里常显。 */
.pi-row .pi-external { opacity: 0; pointer-events: none; transition: opacity 120ms var(--ds-ease-in-out); }
.pi-row:hover .pi-external, .pi-row:focus-within .pi-external { opacity: 1; pointer-events: auto; }
@media (hover: none) {
  .pi-row .pi-external { opacity: 1; pointer-events: auto; }
}
.pi-num {
  flex: none;
  padding: 1px 4px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
}
.pi-subject {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  /* 正文档跟随用户字号设置（官方：正文/描述读 --dsh-content-font-size，别写死 px）。 */
  font-size: var(--dsh-content-font-size);
  line-height: 1.35;
  font-weight: 500;
}
.pi-meta {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary);
  line-height: 1.3;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* 作者名 + 16px 圆头像的横排（头像只在 host 给出 URL 时渲染）。 */
.pi-authorName { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
/* 24h 内动过的行给第二层色阶（不是强调色：强调色只留给「当前项」）。 */
.pi-meta[data-fresh='true'] { color: var(--dsw-alias-label-secondary); }
.pi-grow { flex: 1; min-width: 0; }

.pi-empty { padding: 10px 12px; color: var(--dsw-alias-label-tertiary); font-size: var(--dsh-content-font-size-secondary); line-height: 1.4; }
.pi-notice { padding: 8px 12px; color: var(--dsw-alias-label-tertiary); font-size: var(--dsh-content-font-size-secondary); line-height: 1.45; white-space: pre-wrap; }
.pi-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.pi-notice[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }

/* ── 状态行（绑定信息）──────────────────────────────────────────────────── */
.pi-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
}
.pi-footRepo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-footMeta { margin-left: auto; flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── 详情（正文与评论排版交给官方 MarkdownText，这里只管骨架）──────────── */
/* 详情和列表共用「内容 + 状态行」的列布局：详情吃满剩余高度，footer 常驻。 */
.pi-detail { display: flex; flex-direction: column; flex: 1; min-height: 0; }
/* 打开详情时焦点会程序化落到这个区域（键盘用户不丢位置）；整块描边没有信息量。 */
.pi-detail:focus { outline: none; }
.pi-detailTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--dsh-content-font-size);
  font-weight: 500;
}
/* 作者名：官方链接外观（link 色 + 500；静止无下划线，hover/focus 点线下划线）。 */
.pi-author {
  color: var(--dsw-alias-link);
  font-weight: 500;
  text-decoration: none;
}
.pi-author:hover, .pi-author:focus-visible { text-decoration: underline dotted; text-underline-offset: 3px; }
/* 头像：圆必须显式退出超椭圆（否则被 superellipse 压成方角）。 */
.pi-avatar {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  corner-shape: round;
  object-fit: cover;
  background: var(--dsw-alias-interactive-bg-hover);
}
/* 首字母回退：同一几何，圆底 + 次级色小字（CDN 不可达时不出现破图）。 */
.pi-avatarInitials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-secondary);
  /* 这是一段 font shorthand 令牌，不能拿来做 font-size（会整体失效回退到 11px）。 */
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  overflow: hidden;
}
.pi-detailBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 区分「正文 / 评论 / 文件清单」三块：**0.5px 发丝边界 + 圆角**。
   为什么不靠填充差：实测 DSH 浅色主题下 bg-base / layer-1 / layer-2 / layer-3
   **全是 #fff**（grep 主题表与页面实测一致），填充差在浅色下恒为零——只靠它分块
   就是隐形分块（这一版第一稿正是如此，被挂载门的几何断言当场抓出来）。官方规则里
   「中性边框与分隔线一律 0.5px」才是流内分组的边界手段；填充留给暗色下的额外分层。 */
.pi-card {
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  padding: 10px 12px;
}
.pi-card[data-flush='true'] { padding: 4px; }
.pi-stack { display: flex; flex-direction: column; gap: 8px; }
.pi-detailMeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-detailStats {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: var(--dsh-content-font-size-secondary);
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  flex-wrap: wrap;
}
.pi-branch { display: inline-flex; align-items: center; gap: 4px; font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.pi-add { color: var(--dsw-alias-state-success-primary); }
.pi-del { color: var(--dsw-alias-state-error-primary); }
.pi-sectionTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin-top: 2px;
  padding: 0 2px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-strong-13);
}
.pi-comment { display: flex; flex-direction: column; gap: 6px; }
.pi-commentHead { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-file {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-sm);
}
.pi-fileOld { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); text-decoration: line-through; }
.pi-filePath { flex: 1; min-width: 0; }
.pi-fileCounts { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); font-variant-numeric: tabular-nums; }
`;
		/** 注入一次；已存在就直接返回（HMR 重复 apply 不会叠第二份）。 */
		function injectStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}
		//#endregion
		//#region src/client/tab-icon.tsx
		/**
		* 页签图标：官方 primitives 里没有 PR 专用图标，分支图标又会和内置 Git 页签撞车，
		* 所以画一个最小的「两个提交点 + 汇入弧」的 PR 形状。用 `currentColor`，
		* 跟随宿主的页签前色（React 内联 SVG 与 `<img>` 不同，能继承 currentColor）。
		*/
		function PrIcon({ size = 16 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				"aria-hidden": true,
				focusable: false
			}, [
				(0, react.createElement)("circle", {
					key: "a",
					cx: 4,
					cy: 3,
					r: 1.8
				}),
				(0, react.createElement)("circle", {
					key: "b",
					cx: 4,
					cy: 13,
					r: 1.8
				}),
				(0, react.createElement)("circle", {
					key: "c",
					cx: 12,
					cy: 6,
					r: 1.8
				}),
				(0, react.createElement)("path", {
					key: "d",
					d: "M4 4.8v6.4"
				}),
				(0, react.createElement)("path", {
					key: "e",
					d: "M12 7.8c0 2.2-1.6 3.2-3.4 3.2H8.2"
				})
			]);
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* dsh-pr-inbox 的浏览器半：向 better-sidebar 注册一个原生 tab 类型。
		*
		* 只做 type-only import（`import type {} from 'dsh-better-sidebar'`）触发
		* `ctx.betterSidebar` 的类型合并——运行时符号一律走 `ctx.betterSidebar` 方法调用，
		* 不 value-import 宿主插件。
		*
		* 文案经宿主 locale 服务（`createI18n`），图标用本插件自己的 `PrIcon`
		* （primitives 里没有 PR 专用图标；分支图标会和内置 Git 页签撞语义）。
		*/
		/** 服务依赖：只等 better-sidebar 就绪（tab 宿主）。
		*  locale 不写进 inject —— 它是可选增强，`createI18n` 用 `ctx.get('locale')` 结构化探测，
		*  缺席时退回浏览器语言兜底；写进 inject 一旦服务名对不上就是整行永久 pending
		*  （严格注入两个方向都会出事，见 make-dsh-plugin 的 Step 2 与 gotchas §7）。 */
		const inject = ["betterSidebar"];
		const TAB_ID = "dsh-pr-inbox:prs";
		function apply(ctx) {
			injectStyles();
			const i18n = createI18n(ctx);
			ctx.effect(() => () => {
				i18n.dispose();
			});
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: TAB_ID,
				title: () => i18n.t("tabTitle"),
				description: () => i18n.t("tabDescription"),
				icon: (size) => (0, react.createElement)(PrIcon, { size }),
				order: 25,
				dedupeKey: () => TAB_ID,
				component: ({ scope, visible }) => (0, react.createElement)(Panel, {
					ctx,
					i18n,
					sessionId: scope.sessionId,
					cwd: scope.cwd,
					visible
				})
			}), "pr-inbox: register PR tab");
		}
		//#endregion
		exports.TAB_ID = TAB_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
