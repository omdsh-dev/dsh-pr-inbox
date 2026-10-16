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
		/** 相对路径 → 绝对 URL（保留页面前缀）。 */
		function hostRouteUrl(ctx, path) {
			const service = serviceOf(ctx);
			if (typeof service.hostRouteUrl === "function" && service.features?.includes("hostRouteUrl") === true) return service.hostRouteUrl(path);
			return new URL(path, document.baseURI).href;
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
		//#region src/client/Detail.tsx
		/**
		* PR 详情视图：**插件自己渲染**（不嵌网页、不跳浏览器）。
		*
		* 正文与评论直接用**宿主的 markdown 渲染器** `MarkdownText`
		* （`@deepseek-ai/dsh-client-ui-primitives`）——它自带 GFM + TeX、围栏代码走官方
		* `CodeBlock`、丢弃原始 HTML、限制协议；`labels` 是必填契约（复制/脚注/代码卡工具栏
		* 文案），走本插件字典，漏传会回退硬编码中文。
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
		function Comment({ entry, labels, i18n }) {
			const { t } = i18n;
			const head = [(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: "a",
				tone: "quiet"
			}, entry.author)];
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
				className: "pi-comment",
				"data-pi-comment": entry.kind
			}, [(0, react.createElement)("div", {
				key: "h",
				className: "pi-commentHead"
			}, head), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
				key: "b",
				text: entry.body === "" ? t("emptyBody") : entry.body,
				labels,
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
		function Detail({ detail, loading, error, i18n, onBack, onRefresh }) {
			const { t, tf } = i18n;
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
			const head = (0, react.createElement)("div", { className: "pi-head" }, [
				(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "b",
					variant: "ghost",
					size: "sm",
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, {}),
					"data-pi-back": "",
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
				const meta = [(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "a",
					tone: "quiet"
				}, detail.author), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "s",
					tone: detail.mergedAt !== void 0 ? "info" : detail.state === "open" ? "outline" : "neutral"
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
					"data-pi-body": ""
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
					text: detail.body === "" ? t("emptyBody") : detail.body,
					labels,
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
				if (detail.timeline.length === 0) body.push((0, react.createElement)("div", {
					key: "te",
					className: "pi-empty"
				}, t("noTimeline")));
				for (const [index, entry] of detail.timeline.entries()) body.push((0, react.createElement)(Comment, {
					key: `${entry.kind}:${entry.createdAt}:${index}`,
					entry,
					labels,
					i18n
				}));
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
				for (const file of detail.files) body.push((0, react.createElement)(FileRow, {
					key: file.path,
					file,
					i18n
				}));
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
		* 可寻址面（也给挂载自检用）：`[data-dsh-pr-inbox-panel]` / `[data-pi-search]` /
		* `[data-pi-density]` / `[data-bucket]` / `[data-pr-row="<number>"]` / `[data-pi-foot]`。
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
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconLinkOutlineRegular, {}),
				"aria-label": props.label,
				title: props.label,
				onClick: (event) => {
					event.stopPropagation();
					window.open(props.url, "_blank", "noopener,noreferrer");
				}
			});
		}
		/** 一行 PR。简洁=单行 28px（扫描用）；详细=两行（标题 + 作者/标签/评论/合并时间）。 */
		function Row(props) {
			const { row, density, i18n } = props;
			const { t, tf } = i18n;
			const num = (0, react.createElement)("span", {
				key: "n",
				className: "pi-num"
			}, `#${row.number}`);
			const subject = (0, react.createElement)("span", {
				key: "t",
				className: "pi-subject",
				title: row.title
			}, row.title);
			const external = (0, react.createElement)(OpenExternal, {
				key: "x",
				url: row.url,
				label: t("openOnGitHub")
			});
			const handlers = rowHandlers(() => {
				props.onSelect(row);
			});
			if (density === "compact") return (0, react.createElement)("div", {
				...handlers,
				className: "pi-row",
				"data-density": "compact",
				"data-pr-row": String(row.number),
				"data-selected": props.selected ? "true" : void 0,
				title: `${row.author} · ${formatAge(row.updatedAt)}`
			}, [
				num,
				subject,
				row.isDraft ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "d",
					tone: "warning"
				}, t("draft")) : null,
				external,
				(0, react.createElement)("span", {
					key: "m",
					className: "pi-meta"
				}, `${row.author} · ${formatAge(row.updatedAt)}`)
			]);
			const pills = [(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: "a",
				tone: "quiet"
			}, row.author)];
			if (row.mergedAt !== void 0) pills.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: "m",
				tone: "info"
			}, `${t("mergedAt")} ${formatAge(row.mergedAt)}`));
			for (const label of row.labels.slice(0, 4)) pills.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: `l:${label}`,
				tone: "neutral"
			}, label));
			if (row.labels.length > 4) pills.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: "l+",
				tone: "quiet"
			}, `+${row.labels.length - 4}`));
			if (row.comments > 0) pills.push((0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
				key: "c",
				tone: "quiet"
			}, tf("commentsCount", { count: row.comments })));
			return (0, react.createElement)("div", {
				...handlers,
				className: "pi-row",
				"data-density": "detailed",
				"data-pr-row": String(row.number),
				"data-selected": props.selected ? "true" : void 0
			}, [(0, react.createElement)("div", {
				key: "l1",
				className: "pi-line1"
			}, [
				num,
				subject,
				row.isDraft ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tag, {
					key: "d",
					tone: "warning"
				}, t("draft")) : null,
				external,
				(0, react.createElement)("span", {
					key: "m",
					className: "pi-meta"
				}, formatAge(row.updatedAt))
			]), (0, react.createElement)("div", {
				key: "l2",
				className: "pi-line2"
			}, pills)]);
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
					className: "pi-sectionCount"
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
					"data-pi-search": "",
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
					"data-pi-density": "compact",
					onClick: () => {
						setDensity("compact");
					}
				}, t("compact")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
					key: "x",
					active: density === "detailed",
					"data-pi-density": "detailed",
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
.pi-section + .pi-section { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.pi-sectionHeader {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-strong-12);
  cursor: pointer;
}
.pi-sectionLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-sectionCount {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
}
.pi-hint { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.pi-chevron { flex: none; display: inline-flex; color: var(--dsw-alias-label-tertiary); transition: transform 120ms var(--ds-ease-in-out); }
.pi-section[data-open='false'] .pi-chevron { transform: rotate(-90deg); }
.pi-section[data-open='false'] .pi-rows { display: none; }

.pi-row {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  margin: 2px 6px;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
}
.pi-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-row[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active); }
.pi-row[data-density='compact'] {
  height: 28px;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}
.pi-line1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pi-line2 { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
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
  font: var(--dsw-font-xxs-strong-12);
}
.pi-meta { flex: none; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); white-space: nowrap; font-variant-numeric: tabular-nums; }
.pi-grow { flex: 1; min-width: 0; }

.pi-empty { padding: 10px 12px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); }
.pi-notice { padding: 8px 12px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); white-space: pre-wrap; }
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
.pi-detailTitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--dsw-font-xxs-strong-12); }
.pi-detailBody { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.pi-detailMeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-detailStats { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-11); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.pi-branch { display: inline-flex; align-items: center; gap: 4px; font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.pi-add { color: var(--dsw-alias-state-success-primary); }
.pi-del { color: var(--dsw-alias-state-error-primary); }
.pi-sectionTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-strong-12);
}
.pi-comment { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 0.5px solid var(--dsw-alias-border-l1); }
.pi-commentHead { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pi-file {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 4px;
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
