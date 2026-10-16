window.__ModuleLoader__.load({
	id: "dsh-pr-inbox",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
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
		//#region src/client/icons.tsx
		/** 自绘的 16px 图标集：颜色一律 `currentColor`，具体色值由样式表用
		*  `--dsw-alias-*` 令牌给出——插件不持有颜色字面量（皮肤契约）。 */
		function svg(size, children) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				"aria-hidden": true,
				focusable: false,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round"
			}, children);
		}
		/** PR 形状（两点一竖 + 分支弧）。 */
		function PrIcon({ size = 16 }) {
			return svg(size, [
				(0, react.createElement)("circle", {
					key: "a",
					cx: 4,
					cy: 3.5,
					r: 1.7
				}),
				(0, react.createElement)("circle", {
					key: "b",
					cx: 4,
					cy: 12.5,
					r: 1.7
				}),
				(0, react.createElement)("circle", {
					key: "c",
					cx: 12,
					cy: 6.5,
					r: 1.7
				}),
				(0, react.createElement)("path", {
					key: "d",
					d: "M4 5.2v5.6"
				}),
				(0, react.createElement)("path", {
					key: "e",
					d: "M12 8.2v1.1a3 3 0 0 1-3 3H4"
				})
			]);
		}
		/** 刷新（转一圈的箭头 + 缺口）。 */
		function RefreshIcon({ size = 16 }) {
			return svg(size, [(0, react.createElement)("path", {
				key: "a",
				d: "M13 8a5 5 0 1 1-1.6-3.7"
			}), (0, react.createElement)("path", {
				key: "b",
				d: "M13 2.6V5h-2.4"
			})]);
		}
		/** 分区折叠箭头（展开时朝下）。 */
		function ChevronIcon({ size = 14 }) {
			return svg(size, [(0, react.createElement)("path", {
				key: "a",
				d: "M4 6.2 8 10.2l4-4"
			})]);
		}
		/** 在浏览器打开（外链）。 */
		function ExternalIcon({ size = 14 }) {
			return svg(size, [
				(0, react.createElement)("path", {
					key: "a",
					d: "M6.5 3.5H3.5v9h9v-3"
				}),
				(0, react.createElement)("path", {
					key: "b",
					d: "M9.5 3.5h3v3"
				}),
				(0, react.createElement)("path", {
					key: "c",
					d: "M12.5 3.5 7.5 8.5"
				})
			]);
		}
		const L = typeof navigator !== "undefined" && (navigator.language ?? "").toLowerCase().startsWith("zh") ? {
			refresh: "刷新",
			reading: "读取中…",
			search: "搜索标题 / 编号 / 作者 / 标签…",
			compact: "简洁",
			detailed: "详细",
			noMatch: "没有匹配的 PR",
			bucketEmpty: "这个桶暂时是空的",
			openOnGitHub: "在 GitHub 打开",
			draft: "草稿",
			comments: "评论",
			mergedAt: "合并于",
			updated: "更新于",
			unbound: "当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（需要形如 origin → github.com/owner/repo）。",
			unboundShort: "未绑定项目",
			hits: (hit, total) => `命中 ${hit} / ${total}`,
			bucket: {
				authored: "我提的",
				review: "待我审",
				merged: "最近合并"
			},
			bucketHint: {
				authored: "author:@me",
				review: "review-requested:@me",
				merged: "is:merged · 最近 20"
			},
			back: "返回列表",
			open: "开放",
			closed: "已关闭",
			merged: "已合并",
			emptyBody: "（没有正文）",
			bodyTruncated: "正文过长，已截断显示。",
			timeline: "评论与评审",
			noTimeline: "还没有评论",
			timelineTruncated: "时间线过长，只显示最近的一部分。",
			filesTitle: "改动文件",
			filesTruncated: "文件过多，只显示前一部分。",
			files: (count) => `${count} 个文件`,
			commits: (count) => `${count} 次提交`,
			fileStatus: {
				added: "新增",
				removed: "删除",
				modified: "修改",
				renamed: "改名",
				copied: "复制",
				changed: "改动",
				unchanged: "未变"
			},
			reviewState: {
				APPROVED: "已批准",
				CHANGES_REQUESTED: "要求修改",
				COMMENTED: "评论",
				DISMISSED: "已忽略",
				PENDING: "待处理"
			}
		} : {
			refresh: "Refresh",
			reading: "Loading…",
			search: "Search title / number / author / label…",
			compact: "Compact",
			detailed: "Detailed",
			noMatch: "No matching PRs",
			bucketEmpty: "Nothing in this bucket yet",
			openOnGitHub: "Open on GitHub",
			draft: "Draft",
			comments: "comments",
			mergedAt: "merged",
			updated: "updated",
			unbound: "This workspace is not a git repository, or its remote does not resolve to a forge project (origin → github.com/owner/repo).",
			unboundShort: "no project",
			hits: (hit, total) => `${hit} / ${total} shown`,
			bucket: {
				authored: "Authored by me",
				review: "Needs my review",
				merged: "Recently merged"
			},
			bucketHint: {
				authored: "author:@me",
				review: "review-requested:@me",
				merged: "is:merged · last 20"
			},
			back: "Back to list",
			open: "Open",
			closed: "Closed",
			merged: "Merged",
			emptyBody: "(no description)",
			bodyTruncated: "Description was long; shown truncated.",
			timeline: "Comments and reviews",
			noTimeline: "No comments yet",
			timelineTruncated: "Timeline is long; only the most recent part is shown.",
			filesTitle: "Changed files",
			filesTruncated: "Too many files; only the first part is shown.",
			files: (count) => `${count} file${count === 1 ? "" : "s"}`,
			commits: (count) => `${count} commit${count === 1 ? "" : "s"}`,
			fileStatus: {
				added: "added",
				removed: "removed",
				modified: "modified",
				renamed: "renamed",
				copied: "copied",
				changed: "changed",
				unchanged: "unchanged"
			},
			reviewState: {
				APPROVED: "approved",
				CHANGES_REQUESTED: "changes requested",
				COMMENTED: "commented",
				DISMISSED: "dismissed",
				PENDING: "pending"
			}
		};
		//#endregion
		//#region src/client/Detail.tsx
		/**
		* PR 详情视图：**插件自己渲染**（不嵌网页、不跳浏览器）。
		*
		* 数据全部来自 host 的 `detail` op（`PrDetailValue`）：正文、review/评论时间线、
		* 改动文件清单；三者都可能被**如实**截断（`bodyTruncated` / `timelineTruncated`
		* / `filesTruncated`），支线失败则进 `warnings` —— 详情因此永不因为一条支线失败
		* 变空白。
		*
		* 规格与列表同一套（见 styles.ts）：36px 头带放返回 + 标题 + 刷新 + 外链，
		* 关卡式分区标题 28px，正文与评论这一版是**纯文本 + 保留换行**。
		*/
		/** 文件状态 → 药丸色调（与 bsb 的 statusBadge 同一套语义色）。 */
		const FILE_TONE = {
			added: "merged",
			removed: "error",
			modified: "draft",
			renamed: "review",
			copied: "review"
		};
		function fileTone(status) {
			return FILE_TONE[status] ?? "quiet";
		}
		function fileLabel(status) {
			return L.fileStatus[status] ?? status;
		}
		function IconButton$1(props) {
			return (0, react.createElement)("button", {
				type: "button",
				className: "pi-iconButton",
				title: props.label,
				"aria-label": props.label,
				"data-spinning": props.spinning === true ? "true" : void 0,
				onClick: props.onClick
			}, props.icon);
		}
		function Comment({ entry }) {
			const pills = [(0, react.createElement)("span", {
				key: "a",
				className: "pi-pill",
				"data-tone": "author"
			}, entry.author)];
			if (entry.kind === "review") {
				const state = entry.reviewState ?? "COMMENTED";
				const tone = state === "APPROVED" ? "merged" : state === "CHANGES_REQUESTED" ? "error" : "quiet";
				pills.push((0, react.createElement)("span", {
					key: "s",
					className: "pi-pill",
					"data-tone": tone
				}, L.reviewState[state] ?? state));
			}
			pills.push((0, react.createElement)("span", {
				key: "t",
				className: "pi-pill",
				"data-tone": "quiet"
			}, formatAge(entry.createdAt)));
			return (0, react.createElement)("div", {
				className: "pi-comment",
				"data-pi-comment": entry.kind
			}, [(0, react.createElement)("div", {
				key: "h",
				className: "pi-commentHead"
			}, pills), (0, react.createElement)("div", {
				key: "b",
				className: "pi-prose"
			}, entry.body === "" ? L.emptyBody : entry.body)]);
		}
		function FileRow({ file }) {
			const name = file.previousPath === void 0 ? file.path : file.path;
			return (0, react.createElement)("div", {
				className: "pi-file",
				"data-pi-file": file.path,
				title: file.path
			}, [
				(0, react.createElement)("span", {
					key: "s",
					className: "pi-pill",
					"data-tone": fileTone(file.status)
				}, fileLabel(file.status)),
				file.previousPath === void 0 ? null : (0, react.createElement)("span", {
					key: "o",
					className: "pi-fileOld"
				}, file.previousPath),
				(0, react.createElement)("span", {
					key: "p",
					className: "pi-filePath"
				}, name),
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
		function Detail({ detail, loading, error, onBack, onRefresh }) {
			const title = detail === void 0 ? L.reading : `#${detail.number} ${detail.title}`;
			const head = (0, react.createElement)("div", { className: "pi-head" }, [
				(0, react.createElement)(IconButton$1, {
					key: "b",
					icon: (0, react.createElement)("span", { "aria-hidden": true }, "←"),
					label: L.back,
					onClick: onBack
				}),
				(0, react.createElement)("span", {
					key: "t",
					className: "pi-detailTitle",
					title
				}, title),
				(0, react.createElement)(IconButton$1, {
					key: "r",
					icon: (0, react.createElement)(RefreshIcon, {}),
					label: L.refresh,
					spinning: loading,
					onClick: onRefresh
				}),
				detail === void 0 ? null : (0, react.createElement)(IconButton$1, {
					key: "x",
					icon: (0, react.createElement)(ExternalIcon, {}),
					label: L.openOnGitHub,
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
			}, L.reading));
			else {
				const meta = [(0, react.createElement)("span", {
					key: "a",
					className: "pi-pill",
					"data-tone": "author"
				}, detail.author), (0, react.createElement)("span", {
					key: "s",
					className: "pi-pill",
					"data-tone": detail.mergedAt !== void 0 ? "merged" : detail.state === "open" ? "review" : "quiet"
				}, detail.mergedAt !== void 0 ? L.merged : detail.state === "open" ? L.open : L.closed)];
				if (detail.isDraft) meta.push((0, react.createElement)("span", {
					key: "d",
					className: "pi-pill",
					"data-tone": "draft"
				}, L.draft));
				for (const label of detail.labels) meta.push((0, react.createElement)("span", {
					key: `l:${label}`,
					className: "pi-pill",
					title: label
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
						className: "pi-filePath"
					}, `${detail.baseRef} ← ${detail.headRef}`),
					(0, react.createElement)("span", {
						key: "a",
						className: "pi-add"
					}, `+${detail.additions}`),
					(0, react.createElement)("span", {
						key: "d",
						className: "pi-del"
					}, `−${detail.deletions}`),
					(0, react.createElement)("span", { key: "f" }, L.files(detail.changedFiles)),
					(0, react.createElement)("span", { key: "c" }, L.commits(detail.commits)),
					(0, react.createElement)("span", { key: "u" }, `${L.updated} ${formatAge(detail.updatedAt)}`),
					detail.mergedAt === void 0 ? null : (0, react.createElement)("span", { key: "m" }, `${L.mergedAt} ${formatDate(detail.mergedAt)}`)
				]));
				for (const warning of detail.warnings) body.push((0, react.createElement)("div", {
					key: `w:${warning}`,
					className: "pi-notice",
					"data-tone": "warn"
				}, warning));
				body.push((0, react.createElement)("div", {
					key: "prose",
					className: "pi-prose",
					"data-pi-body": ""
				}, detail.body === "" ? L.emptyBody : detail.body));
				if (detail.bodyTruncated) body.push((0, react.createElement)("div", {
					key: "bt",
					className: "pi-notice",
					"data-tone": "warn"
				}, L.bodyTruncated));
				body.push((0, react.createElement)("div", {
					key: "th",
					className: "pi-sectionTitle"
				}, [L.timeline, (0, react.createElement)("span", {
					key: "n",
					className: "pi-sectionCount"
				}, String(detail.timeline.length))]));
				if (detail.timeline.length === 0) body.push((0, react.createElement)("div", {
					key: "te",
					className: "pi-empty"
				}, L.noTimeline));
				for (const [index, entry] of detail.timeline.entries()) body.push((0, react.createElement)(Comment, {
					key: `${entry.kind}:${entry.createdAt}:${index}`,
					entry
				}));
				if (detail.timelineTruncated) body.push((0, react.createElement)("div", {
					key: "tt",
					className: "pi-notice",
					"data-tone": "warn"
				}, L.timelineTruncated));
				body.push((0, react.createElement)("div", {
					key: "fh",
					className: "pi-sectionTitle"
				}, [L.filesTitle, (0, react.createElement)("span", {
					key: "n",
					className: "pi-sectionCount"
				}, String(detail.changedFiles))]));
				for (const file of detail.files) body.push((0, react.createElement)(FileRow, {
					key: file.path,
					file
				}));
				if (detail.filesTruncated) body.push((0, react.createElement)("div", {
					key: "ft",
					className: "pi-notice",
					"data-tone": "warn"
				}, L.filesTruncated));
			}
			return (0, react.createElement)("div", {
				className: "pi-detail",
				"data-dsh-pr-inbox-detail": String(detail?.number ?? "")
			}, head, (0, react.createElement)("div", { className: "pi-detailBody" }, body));
		}
		//#endregion
		//#region src/client/Panel.tsx
		/**
		* PR 列表面板（阶段二）：三桶分区 + 顶部搜索 + 简洁/详细两种密度。
		*
		* 视觉规格照 better-sidebar 的原生尺度（见 styles.ts 的头注释）：36px 头带、
		* 28px 分区头与控件、28px 简洁行、两行式详细行、悬停 hover / 选中 active+2px
		* 强调条；错误一律是纯文本 notice（不画盒子），与 bsb 的 kit 一致。
		*
		* 稳态开销（照 bsb 的硬约束）：只在 `visible` 时取数、不持有定时器、每次可见即
		* 刷一次；列表数据在 host 侧还有 60 s 有界缓存，反复切 tab 不会打爆搜索配额。
		*
		* 可寻址面（也给挂载自检用）：`[data-dsh-pr-inbox-panel]` / `[data-pi-search]` /
		* `[data-pi-density]` / `[data-bucket]` / `[data-pr-row="<number>"]` / `[data-pi-foot]`。
		*/
		/** 按桶的顺序渲染（orders 与「与我相关」的紧迫度一致：我先提的 → 等我审 → 已合并）。 */
		const BUCKETS = [
			"authored",
			"review",
			"merged"
		];
		/** gh 相关失败给一句「怎么办」，而不是把英文 stderr 原样端给用户。 */
		const GH_HINT = {
			"gh-missing": "安装 GitHub CLI（https://cli.github.com）后执行 `gh auth login`。",
			"gh-unauthenticated": "执行 `gh auth login` 登录后再刷新。",
			"gh-rate-limit": "触达 GitHub API 速率上限，稍后重试（已认证 30 次/分）。",
			"gh-timeout": "本机 gh 响应超时，检查网络后重试。",
			"no-cwd": "先在该会话里打开一个文件或产生一次工具调用，让会话确定工作目录。"
		};
		function IconButton(props) {
			return (0, react.createElement)("button", {
				type: "button",
				className: "pi-iconButton",
				title: props.label,
				"aria-label": props.label,
				disabled: props.disabled === true,
				"data-spinning": props.spinning === true ? "true" : void 0,
				onClick: props.onClick
			}, props.icon);
		}
		/** 一行 PR。简洁=单行 28px（扫描用）；详细=两行（标题 + 作者/标签/评论/时间）。 */
		function Row(props) {
			const { row, density } = props;
			const open = (event) => {
				event.stopPropagation();
				window.open(row.url, "_blank", "noopener,noreferrer");
			};
			const num = (0, react.createElement)("span", {
				key: "n",
				className: "pi-num"
			}, `#${row.number}`);
			const subject = (0, react.createElement)("span", {
				key: "t",
				className: "pi-subject",
				title: row.title
			}, row.title);
			const external = (0, react.createElement)(IconButton, {
				key: "x",
				icon: (0, react.createElement)(ExternalIcon, {}),
				label: L.openOnGitHub,
				onClick: () => {
					open({ stopPropagation: () => {} });
				}
			});
			if (density === "compact") return (0, react.createElement)("div", {
				className: "pi-row",
				"data-density": "compact",
				"data-pr-row": String(row.number),
				"data-selected": props.selected ? "true" : void 0,
				onClick: () => {
					props.onSelect(row);
				},
				title: `${row.author} · ${formatAge(row.updatedAt)}`
			}, [
				num,
				subject,
				row.isDraft ? (0, react.createElement)("span", {
					key: "d",
					className: "pi-pill",
					"data-tone": "draft"
				}, L.draft) : null,
				external,
				(0, react.createElement)("span", {
					key: "m",
					className: "pi-meta"
				}, `${row.author} · ${formatAge(row.updatedAt)}`)
			]);
			const pills = [(0, react.createElement)("span", {
				key: "a",
				className: "pi-pill",
				"data-tone": "author"
			}, row.author)];
			if (row.isDraft) pills.push((0, react.createElement)("span", {
				key: "d",
				className: "pi-pill",
				"data-tone": "draft"
			}, L.draft));
			if (row.mergedAt !== void 0) pills.push((0, react.createElement)("span", {
				key: "m",
				className: "pi-pill",
				"data-tone": "merged"
			}, `${L.mergedAt} ${formatAge(row.mergedAt)}`));
			for (const label of row.labels.slice(0, 4)) pills.push((0, react.createElement)("span", {
				key: `l:${label}`,
				className: "pi-pill",
				title: label
			}, label));
			if (row.labels.length > 4) pills.push((0, react.createElement)("span", {
				key: "l+",
				className: "pi-pill",
				"data-tone": "quiet"
			}, `+${row.labels.length - 4}`));
			if (row.comments > 0) pills.push((0, react.createElement)("span", {
				key: "c",
				className: "pi-pill",
				"data-tone": "quiet",
				title: L.comments
			}, `${row.comments} ${L.comments}`));
			return (0, react.createElement)("div", {
				className: "pi-row",
				"data-density": "detailed",
				"data-pr-row": String(row.number),
				"data-selected": props.selected ? "true" : void 0,
				onClick: () => {
					props.onSelect(row);
				}
			}, [(0, react.createElement)("div", {
				key: "l1",
				className: "pi-line1"
			}, [
				num,
				subject,
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
			const { bucket, value, query } = props;
			const rows = (0, react.useMemo)(() => (value?.rows ?? []).filter((row) => matchesQuery(row, query)), [value, query]);
			const total = value?.total ?? 0;
			const filtered = query.trim() !== "";
			const count = filtered ? L.hits(rows.length, total) : String(total);
			const body = [];
			if (value?.error !== void 0) body.push((0, react.createElement)("div", {
				key: "e",
				className: "pi-notice",
				"data-tone": "error"
			}, value.error.message));
			else if (rows.length === 0) body.push((0, react.createElement)("div", {
				key: "z",
				className: "pi-empty"
			}, filtered ? L.noMatch : L.bucketEmpty));
			for (const row of rows) body.push((0, react.createElement)(Row, {
				key: row.number,
				row,
				density: props.density,
				selected: props.selected === row.number,
				onSelect: props.onSelect
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
				}, (0, react.createElement)(ChevronIcon, {})),
				(0, react.createElement)("span", {
					key: "l",
					className: "pi-sectionLabel"
				}, L.bucket[bucket] ?? bucket),
				(0, react.createElement)("span", {
					key: "n",
					className: "pi-sectionCount"
				}, count),
				(0, react.createElement)("span", {
					key: "q",
					className: "pi-sectionCount"
				}, L.bucketHint[bucket] ?? "")
			]), (0, react.createElement)("div", {
				key: "b",
				className: "pi-rows"
			}, body)]);
		}
		function Panel({ ctx, sessionId, cwd, visible }) {
			const [state, setState] = (0, react.useState)({ phase: "loading" });
			const [query, setQuery] = (0, react.useState)("");
			const [density, setDensity] = (0, react.useState)("compact");
			const [collapsed, setCollapsed] = (0, react.useState)({});
			const [selected, setSelected] = (0, react.useState)(void 0);
			/** 打开的详情（undefined = 还在列表）。 */
			const [open, setOpen] = (0, react.useState)(void 0);
			const [detail, setDetail] = (0, react.useState)({ loading: false });
			const generation = (0, react.useRef)(0);
			const detailGeneration = (0, react.useRef)(0);
			/** 会话权威 cwd：拿到一次就复用（列表与详情共用）。 */
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
							message: "会话还没有工作目录",
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
			}, [ctx, ensureCwd]);
			/** 打开一个 PR 的详情（host 侧 30 s 有界缓存，重复点开不打 API）。 */
			const loadDetail = (0, react.useCallback)(async (number) => {
				const mine = detailGeneration.current + 1;
				detailGeneration.current = mine;
				setDetail({ loading: true });
				try {
					const resolved = await ensureCwd();
					if (resolved === void 0) {
						if (mine === detailGeneration.current) setDetail({
							loading: false,
							error: "会话还没有工作目录"
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
			}, [ctx, ensureCwd]);
			const openRow = (0, react.useCallback)((row) => {
				setSelected(row.number);
				setOpen(row.number);
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
			const back = (0, react.useCallback)(() => {
				detailGeneration.current += 1;
				setOpen(void 0);
				setDetail({ loading: false });
			}, []);
			const ready = state.phase === "ready" ? state.value : void 0;
			const gh = ready?.gh;
			const repo = ready?.repo ?? void 0;
			if (open !== void 0) return (0, react.createElement)("div", {
				className: "pi-root",
				"data-dsh-pr-inbox-panel": "",
				"data-pi-view": "detail"
			}, (0, react.createElement)(Detail, {
				detail: detail.value,
				loading: detail.loading,
				error: detail.error,
				onBack: back,
				onRefresh: () => {
					loadDetail(open);
				}
			}));
			const head = (0, react.createElement)("div", { className: "pi-head" }, [
				(0, react.createElement)("input", {
					key: "s",
					className: "pi-search",
					"data-pi-search": "",
					type: "search",
					placeholder: L.search,
					value: query,
					spellCheck: false,
					onChange: (event) => {
						setQuery(event.target.value);
					}
				}),
				(0, react.createElement)("div", {
					key: "d",
					className: "pi-switch"
				}, ["compact", "detailed"].map((mode) => (0, react.createElement)("button", {
					key: mode,
					type: "button",
					className: "pi-chip",
					"data-pi-density": mode,
					"data-active": density === mode ? "true" : void 0,
					onClick: () => {
						setDensity(mode);
					}
				}, mode === "compact" ? L.compact : L.detailed))),
				(0, react.createElement)(IconButton, {
					key: "r",
					icon: (0, react.createElement)(RefreshIcon, {}),
					label: L.refresh,
					disabled: !visible,
					spinning: state.phase === "loading",
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
			}, L.reading));
			else {
				const value = state.value;
				if (value.gh.available !== true) {
					body.push((0, react.createElement)("div", {
						key: "g",
						className: "pi-notice",
						"data-tone": "error"
					}, value.gh.error ?? "gh 不可用"));
					body.push((0, react.createElement)("div", {
						key: "gh",
						className: "pi-notice"
					}, GH_HINT["gh-missing"]));
				} else if (value.gh.login === void 0) {
					body.push((0, react.createElement)("div", {
						key: "g",
						className: "pi-notice",
						"data-tone": "error"
					}, value.gh.error ?? "gh 未登录"));
					body.push((0, react.createElement)("div", {
						key: "h",
						className: "pi-notice"
					}, GH_HINT["gh-unauthenticated"]));
				}
				if (value.repo === null) body.push((0, react.createElement)("div", {
					key: "r",
					className: "pi-notice",
					"data-tone": "warn"
				}, L.unbound));
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
			const foot = (0, react.createElement)("div", {
				className: "pi-foot",
				"data-pi-foot": ""
			}, [(0, react.createElement)("span", {
				key: "r",
				className: "pi-footRepo"
			}, repo?.fullName ?? L.unboundShort), (0, react.createElement)("span", {
				key: "m",
				className: "pi-footMeta"
			}, [gh?.login === void 0 ? "" : `@${gh.login}`, ready === void 0 ? "" : `${L.updated} ${formatAge(ready.fetchedAt)}`].filter((part) => part !== "").join(" · "))]);
			return (0, react.createElement)("div", {
				className: "pi-root",
				"data-dsh-pr-inbox-panel": ""
			}, head, (0, react.createElement)("div", { className: "pi-body" }, body), foot);
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* 面板样式：一条注入式 `<style>`（幂等），类名稳定（不是 CSS Modules 哈希）。
		*
		* **规格照 better-sidebar 的原生尺度**（其 UIUX 冻结契约 §1，与本插件同属一个
		* 右侧栏，必须看起来像同一套东西）：正文 12px / 元信息 11px / 行与控件 28px /
		* 圆角阶梯 2px 徽标 · 3px 控件 · 4px 行 · 8px 卡片；分隔线 `border-l1`、结构边
		* `border-l2`、悬停 `interactive-bg-hover`、选中 `interactive-bg-active` + 2px
		* 内嵌强调条（`::before`，上下内缩 4px）；唯一强调色 `state-business-primary`。
		*
		* 颜色**只**消费 `--dsw-alias-*` / `--dsw-font-*` / `--ds-*` 令牌 —— 没有硬编码
		* 颜色字面量，因此自动跟随深浅主题与皮肤中心。
		*/
		const STYLE_ID = "dsh-pr-inbox-styles";
		const CSS = `
.pi-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}

/* ── 头带 36px：搜索 · 密度切换 · 刷新 ─────────────────────────────────── */
.pi-head {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.pi-search {
  box-sizing: border-box;
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 3px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xxs-12);
}
.pi-search::placeholder { color: var(--dsw-alias-label-tertiary); }
.pi-search:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }

/* 密度切换：22px 胶囊 chip（与 kit 的 chip / chipActive 同规格） */
.pi-switch { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.pi-chip {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxxs-11);
  white-space: nowrap;
  cursor: pointer;
}
.pi-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-chip[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover-accent);
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary);
}

/* 28px 方形图标按钮（工具栏统一用它） */
.pi-iconButton {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.pi-iconButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.pi-iconButton:disabled { opacity: .45; cursor: default; }
.pi-iconButton[data-spinning='true'] svg { animation: pi-spin 900ms linear infinite; }
@keyframes pi-spin { to { transform: rotate(360deg); } }

/* ── 列表体 ───────────────────────────────────────────────────────────── */
.pi-body { flex: 1; min-height: 0; overflow: auto; padding: 0 0 8px; }
.pi-section + .pi-section { border-top: 1px solid var(--dsw-alias-border-l1); }
.pi-sectionHeader {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 12px;
  border: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: none;
  font: var(--dsw-font-xxs-strong-12);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.pi-sectionLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-sectionCount {
  flex: none;
  font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
.pi-chevron { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform 120ms var(--ds-ease-in-out); }
.pi-section[data-open='false'] .pi-chevron { transform: rotate(-90deg); }
.pi-section[data-open='false'] .pi-rows { display: none; }

.pi-row {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 10px;
  margin: 0 6px;
  border-radius: 4px;
  cursor: pointer;
}
.pi-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-row[data-selected='true'] { background: var(--dsw-alias-interactive-bg-active); }
.pi-row[data-selected='true']::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-state-business-primary);
}
/* 简洁密度：单行 28px（扫描式列表） */
.pi-row[data-density='compact'] {
  box-sizing: border-box;
  height: 28px;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}

.pi-line1 { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.pi-line2 { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.pi-num {
  flex: none;
  padding: 1px 4px;
  border-radius: 2px;
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
  font: var(--dsw-font-xxs-strong-12);
  color: var(--dsw-alias-label-primary);
}
.pi-meta {
  margin-left: auto;
  flex: none;
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pi-pill {
  flex: none;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  font: var(--dsw-font-xxxs-strong-11);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pi-pill[data-tone='draft'] { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.pi-pill[data-tone='merged'] { color: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }
.pi-pill[data-tone='review'] { color: var(--dsw-alias-state-business-primary); }
.pi-pill[data-tone='author'] { border-color: transparent; color: var(--dsw-alias-label-tertiary); padding: 0; }
.pi-pill[data-tone='quiet'] { border-color: transparent; color: var(--dsw-alias-label-tertiary); padding: 0; }

.pi-empty {
  padding: 10px 12px;
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
}
.pi-notice {
  box-sizing: border-box;
  padding: 8px 12px;
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}
.pi-notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.pi-notice[data-tone='warn'] { color: var(--dsw-alias-state-warn-primary); }

/* ── 脚注：绑定信息（像状态栏，而不是占一行工具栏）───────────────────── */
.pi-foot {
  box-sizing: border-box;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
}
.pi-footRepo { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-footMeta { margin-left: auto; flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── 详情视图（点开一行）：同一套尺度，标题仍在 36px 头带里 ─────────────── */
.pi-detail { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.pi-detailTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxs-strong-12);
  color: var(--dsw-alias-label-primary);
}
.pi-detailBody { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 12px; }
.pi-detailMeta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.pi-detailStats {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.pi-add { color: var(--dsw-alias-state-success-primary); }
.pi-del { color: var(--dsw-alias-state-error-primary); }
.pi-sectionTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  margin: 6px 0 2px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font: var(--dsw-font-xxs-strong-12);
  color: var(--dsw-alias-label-secondary);
}
/* 正文与评论：这一版是**纯文本 + 保留换行**（不猜 markdown），等界面定稿再决定要不要上渲染器 */
.pi-prose { white-space: pre-wrap; word-break: break-word; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-primary); }
.pi-comment { padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.pi-commentHead { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.pi-file { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 2px; border-radius: 3px; }
.pi-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
.pi-filePath {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xxxs-11);
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  color: var(--dsw-alias-label-primary);
}
.pi-fileOld { color: var(--dsw-alias-label-tertiary); text-decoration: line-through; }
.pi-fileCounts {
  flex: none;
  font: var(--dsw-font-xxxs-11);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}
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
		* 不 value-import 宿主插件（构建纯度门会挡）。
		*/
		/** 服务依赖：better-sidebar 就绪后才激活本插件。 */
		const inject = ["betterSidebar"];
		const TAB_ID = "dsh-pr-inbox:prs";
		function apply(ctx) {
			injectStyles();
			ctx.effect(() => ctx.betterSidebar.registerTab({
				id: TAB_ID,
				title: () => "PR",
				description: () => "本项目 Pull Request：我提的 / 待我审 / 最近合并",
				icon: (size) => (0, react.createElement)(PrIcon, { size }),
				order: 25,
				dedupeKey: () => TAB_ID,
				component: ({ scope, visible }) => (0, react.createElement)(Panel, {
					ctx,
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
