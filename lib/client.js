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
		/**
		* 展示层的纯函数：相对时间、日期、搜索匹配。抽出来是为了单测能钉住口径
		* （列表里那个「3 天前」不该随 locale 飘）。
		*/
		/** GitHub 给的是 ISO 8601 UTC；解析失败返回 undefined 而不是 NaN 时间。 */
		function timeOf(iso) {
			const parsed = Date.parse(iso);
			return Number.isFinite(parsed) ? parsed : void 0;
		}
		const MINUTE = 6e4;
		const HOUR = 60 * MINUTE;
		const DAY = 24 * HOUR;
		/** 相对时间：刚刚 / n 分钟前 / n 小时前 / n 天前 / n 个月前 / n 年前。 */
		function formatAge(iso, now = Date.now()) {
			const time = timeOf(iso);
			if (time === void 0) return "";
			const delta = now - time;
			if (delta < 0) return "刚刚";
			if (delta < MINUTE) return "刚刚";
			if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`;
			if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`;
			const days = Math.floor(delta / DAY);
			if (days < 30) return `${days} 天前`;
			const months = Math.floor(days / 30);
			if (months < 12) return `${months} 个月前`;
			return `${Math.floor(days / 365)} 年前`;
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
		function Age({ iso }) {
			return (0, react.createElement)("span", {
				className: "pi-meta",
				"data-fresh": isFresh(iso) ? "true" : void 0
			}, formatAge(iso));
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
		function Comment({ entry, labels, pathImages, i18n }) {
			const { t } = i18n;
			const avatar = avatarUrlOf(entry);
			const head = [(0, react.createElement)(Author, {
				key: "a",
				login: entry.author,
				...avatar === void 0 ? {} : { avatar }
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
			}, formatAge(entry.createdAt)));
			return (0, react.createElement)("div", {
				className: "pi-card pi-comment",
				"data-pi-comment": entry.kind
			}, [(0, react.createElement)("div", {
				key: "h",
				className: "pi-commentHead"
			}, head), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
				key: "b",
				text: entry.body === "" ? t("emptyBody") : expandHtmlImages(entry.body),
				labels,
				pathImages,
				variant: "compact"
			})]);
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
					onClick: onRefresh
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
				"data-tone": "error"
			}, error));
			if (detail === void 0) body.push((0, react.createElement)("div", {
				key: "l",
				className: "pi-empty"
			}, t("reading")));
			else {
				const meta = [(0, react.createElement)(Author, {
					key: "a",
					login: detail.author,
					...detailAvatar === void 0 ? {} : { avatar: detailAvatar }
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
					(0, react.createElement)("span", { key: "f" }, tf("files", { count: detail.changedFiles })),
					(0, react.createElement)("span", { key: "c" }, tf("commits", { count: detail.commits })),
					(0, react.createElement)("span", { key: "u" }, `${t("updated")} ${formatAge(detail.updatedAt)}`),
					detail.mergedAt === void 0 ? null : (0, react.createElement)("span", { key: "m" }, `${t("mergedAt")} ${formatDate(detail.mergedAt)}`)
				]));
				for (const warning of detail.warnings) body.push((0, react.createElement)("div", {
					key: `w:${warning}`,
					className: "pi-notice",
					"data-tone": "warn"
				}, warning));
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
				body.push((0, react.createElement)("div", {
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
				"data-dsh-pr-inbox-detail": String(detail?.number ?? "")
			}, head, (0, react.createElement)("div", { className: "pi-detailBody" }, body));
		}
		//#endregion
		//#region src/client/Panel.tsx
		/**
		* PR 列表：三桶分区 + 顶部搜索 + 简洁/详细两种密度。
		*
		* 控件**全部来自官方** `@deepseek-ai/dsh-client-ui-primitives`（`Input` / `Pill` /
		* `Button` / `Tag` / 官方图标）——官方铁律是「库里有控件就不要抄第二份」；自绘的只有
		* 官方没有的语义：分组列表的分区头与 PR 行（几何与颜色照官方规范，见 styles.ts）。
		* 文案全部经 `i18n`（宿主 locale 服务），不自己判语言。
		*
		* 稳态开销：只在 `visible` 时取数、不持定时器、重新可见即补刷一次；host 侧还有
		* 60 s 有界缓存，反复切 tab 不会打爆搜索配额。
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
		/** gh 相关失败给一句「怎么办」，而不是把英文 stderr 原样端给用户。 */
		const GH_HINT = {
			"gh-missing": "安装 GitHub CLI（https://cli.github.com）后执行 `gh auth login`。",
			"gh-unauthenticated": "执行 `gh auth login` 登录后再刷新。",
			"gh-rate-limit": "触达 GitHub API 速率上限，稍后重试（已认证 30 次/分）。",
			"gh-timeout": "本机 gh 响应超时，检查网络后重试。",
			"no-cwd": "先在该会话里打开一个文件或产生一次工具调用，让会话确定工作目录。"
		};
		/** 行本身是可点面（开详情），右侧 ↗ 是官方 Button——用 role/tabIndex 而不是嵌套 button。 */
		function rowHandlers(onActivate) {
			return {
				role: "button",
				tabIndex: 0,
				onClick: onActivate,
				onKeyDown: (event) => {
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
		/**
		* 一行 PR 的固定几何（两种密度共用同一条身份行）：
		*
		*   ◯  #123  标题…                      [草稿]  2 天前  (↗ 悬停才出现)
		*      alice  [合并于…] [标签] [3 条评论]          ← 只有「详细」多出这条事实行
		*
		* 头像在**行首独立列**（两种密度同 x、同宽、同高，与首行中线对齐），身份行的元素
		* 顺序与右边界也完全相同：切换密度只是增删第二条事实行，已有信息一律不跳位。
		* 挂载门用元素坐标钉住这一点（见 scripts/mount-check.mjs 的「行几何」断言）。
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
			}, (0, react.createElement)(Age, { iso: row.updatedAt })));
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
				}, `${t("mergedAt")} ${formatAge(row.mergedAt)}`));
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
				}, tf("commentsCount", { count: row.comments })));
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
				...density === "compact" ? { title: `${row.author} · ${formatAge(row.updatedAt)}` } : {}
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
			const rows = (0, react.useMemo)(() => (value?.rows ?? []).filter((row) => matchesQuery(row, query)), [value, query]);
			const total = value?.total ?? 0;
			const filtered = query.trim() !== "";
			const count = filtered ? tf("hits", {
				hit: rows.length,
				total
			}) : String(total);
			const body = [];
			if (value?.error !== void 0) body.push((0, react.createElement)("div", {
				key: "e",
				className: "pi-notice",
				"data-tone": "error"
			}, value.error.message));
			else if (rows.length === 0) body.push((0, react.createElement)("div", {
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
				"aria-expanded": props.open
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
					"data-attention": bucket === "review" && total > 0 ? "true" : void 0
				}, count),
				(0, react.createElement)("span", {
					key: "q",
					className: "pi-hint"
				}, t(BUCKET_HINT[bucket]))
			]), (0, react.createElement)("div", {
				key: "b",
				className: "pi-rows"
			}, body)]);
		}
		function Panel({ ctx, i18n, sessionId, cwd, visible }) {
			const { t } = i18n;
			const [state, setState] = (0, react.useState)({ phase: "loading" });
			const [query, setQuery] = (0, react.useState)("");
			const [density, setDensity] = (0, react.useState)("compact");
			const [collapsed, setCollapsed] = (0, react.useState)({});
			const [selected, setSelected] = (0, react.useState)(void 0);
			const [open, setOpen] = (0, react.useState)(void 0);
			const [detail, setDetail] = (0, react.useState)({ loading: false });
			const generation = (0, react.useRef)(0);
			const detailGeneration = (0, react.useRef)(0);
			const cwdRef = (0, react.useRef)(void 0);
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
				setState({ phase: "loading" });
				try {
					const resolved = await ensureCwd();
					if (resolved === void 0) {
						if (mine === generation.current) setState({
							phase: "failed",
							message: t("unbound"),
							code: "no-cwd"
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
					setState({
						phase: "failed",
						message,
						...code === void 0 ? {} : { code }
					});
				}
			}, [
				ctx,
				ensureCwd,
				t
			]);
			const loadDetail = (0, react.useCallback)(async (number) => {
				const mine = detailGeneration.current + 1;
				detailGeneration.current = mine;
				setDetail({ loading: true });
				try {
					const resolved = await ensureCwd();
					if (resolved === void 0) {
						if (mine === detailGeneration.current) setDetail({
							loading: false,
							error: t("unbound")
						});
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
					setDetail({
						loading: false,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			}, [
				ctx,
				ensureCwd,
				t
			]);
			const openRow = (0, react.useCallback)((row) => {
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
			if (open !== void 0) return (0, react.createElement)("div", {
				className: "pi-root",
				"data-dsh-pr-inbox-panel": "",
				"data-pi-view": "detail"
			}, (0, react.createElement)(Detail, {
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
			}));
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
					className: "pi-density"
				}, [(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
					key: "c",
					active: density === "compact",
					onClick: () => {
						setDensity("compact");
					}
				}, t("compact")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
					key: "x",
					active: density === "detailed",
					onClick: () => {
						setDensity("detailed");
					}
				}, t("detailed"))]),
				(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "r",
					variant: "toolbar",
					size: "sm",
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, {}),
					"aria-label": t("refresh"),
					title: t("refresh"),
					disabled: !visible,
					onClick: () => {
						load();
					}
				})
			]);
			const body = [];
			if (state.phase === "failed") {
				body.push((0, react.createElement)("div", {
					key: "e",
					className: "pi-notice",
					"data-tone": "error"
				}, state.message));
				const hint = state.code === void 0 ? void 0 : GH_HINT[state.code];
				if (hint !== void 0) body.push((0, react.createElement)("div", {
					key: "h",
					className: "pi-notice"
				}, hint));
			} else if (state.phase === "loading") body.push((0, react.createElement)("div", {
				key: "l",
				className: "pi-empty"
			}, t("reading")));
			else {
				const value = state.value;
				if (value.gh.available !== true) {
					body.push((0, react.createElement)("div", {
						key: "g",
						className: "pi-notice",
						"data-tone": "error"
					}, value.gh.error ?? "gh"));
					body.push((0, react.createElement)("div", {
						key: "gh",
						className: "pi-notice"
					}, GH_HINT["gh-missing"]));
				} else if (value.gh.login === void 0) {
					body.push((0, react.createElement)("div", {
						key: "g",
						className: "pi-notice",
						"data-tone": "error"
					}, value.gh.error ?? "gh"));
					body.push((0, react.createElement)("div", {
						key: "h",
						className: "pi-notice"
					}, GH_HINT["gh-unauthenticated"]));
				}
				if (value.repo === null) body.push((0, react.createElement)("div", {
					key: "r",
					className: "pi-notice",
					"data-tone": "warn"
				}, t("unbound")));
				else if (value.note !== void 0) body.push((0, react.createElement)("div", {
					key: "n",
					className: "pi-notice",
					"data-tone": "warn"
				}, value.note));
				for (const bucket of BUCKETS) body.push((0, react.createElement)(Section, {
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
			const ready = state.phase === "ready" ? state.value : void 0;
			const foot = (0, react.createElement)("div", {
				className: "pi-foot",
				"data-pi-foot": ""
			}, [(0, react.createElement)("span", {
				key: "r",
				className: "pi-footRepo"
			}, ready?.repo?.fullName ?? t("unboundShort")), (0, react.createElement)("span", {
				key: "m",
				className: "pi-footMeta"
			}, [ready?.gh.login === void 0 ? "" : `@${ready.gh.login}`, ready === void 0 ? "" : `${t("updated")} ${formatAge(ready.fetchedAt)}`].filter((part) => part !== "").join(" · "))]);
			return (0, react.createElement)("div", {
				className: "pi-root",
				"data-dsh-pr-inbox-panel": ""
			}, head, (0, react.createElement)("div", { className: "pi-body" }, body), foot);
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
			bucketMerged: "最近合并",
			hintAuthored: "author:@me",
			hintReview: "review-requested:@me",
			hintMerged: "is:merged · 最近 20",
			bucketEmpty: "这个桶暂时是空的",
			noMatch: "没有匹配的 PR",
			hits: "命中 {hit} / {total}",
			draft: "草稿",
			open: "开放",
			closed: "已关闭",
			merged: "已合并",
			mergedAt: "合并于",
			updated: "更新于",
			comments: "评论",
			commentsCount: "{count} 条评论",
			unbound: "当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（需要形如 origin → github.com/owner/repo）。",
			unboundShort: "未绑定项目",
			openOnGitHub: "在 GitHub 打开",
			back: "返回列表",
			emptyBody: "（没有正文）",
			bodyTruncated: "正文过长，已截断显示。",
			timeline: "评论与评审",
			noTimeline: "还没有评论",
			timelineTruncated: "时间线过长，只显示最近的一部分。",
			filesTitle: "改动文件",
			filesTruncated: "文件过多，只显示前一部分。",
			files: "{count} 个文件",
			commits: "{count} 次提交",
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
			footnotes: "脚注"
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
			bucketMerged: "Recently merged",
			hintAuthored: "author:@me",
			hintReview: "review-requested:@me",
			hintMerged: "is:merged · last 20",
			bucketEmpty: "Nothing in this bucket yet",
			noMatch: "No matching PRs",
			hits: "{hit} / {total} shown",
			draft: "Draft",
			open: "Open",
			closed: "Closed",
			merged: "Merged",
			mergedAt: "merged",
			updated: "updated",
			comments: "comments",
			commentsCount: "{count} comments",
			unbound: "This workspace is not a git repository, or its remote does not resolve to a forge project (origin → github.com/owner/repo).",
			unboundShort: "no project",
			openOnGitHub: "Open on GitHub",
			back: "Back to list",
			emptyBody: "(no description)",
			bodyTruncated: "Description was long; shown truncated.",
			timeline: "Comments and reviews",
			noTimeline: "No comments yet",
			timelineTruncated: "Timeline is long; only the most recent part is shown.",
			filesTitle: "Changed files",
			filesTruncated: "Too many files; only the first part is shown.",
			files: "{count} files",
			commits: "{count} commits",
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
			footnotes: "Footnotes"
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
.pi-hint { flex: none; margin-left: auto; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
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
  padding: 4px 10px 5px 12px;
  cursor: pointer;
  animation: pi-row-in 150ms var(--ds-ease-in-out);
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
@keyframes pi-row-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .pi-row { animation: none; }
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
.pi-detail { display: flex; flex-direction: column; height: 100%; min-height: 0; }
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
  font-size: var(--dsw-font-xxxs-strong-11, 11px);
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
.pi-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
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
		//#region src/client/index.tsx
		/**
		* dsh-pr-inbox 的浏览器半：向 better-sidebar 注册一个原生 tab 类型。
		*
		* 只做 type-only import（`import type {} from 'dsh-better-sidebar'`）触发
		* `ctx.betterSidebar` 的类型合并——运行时符号一律走 `ctx.betterSidebar` 方法调用，
		* 不 value-import 宿主插件。
		*
		* 文案经宿主 locale 服务（`createI18n`），图标用官方 `IconBranchOutlineRegular`
		* （primitives 里没有 PR 专用图标，分支是语义最近的一个）。
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
				icon: (size) => (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutlineRegular, { size }),
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
