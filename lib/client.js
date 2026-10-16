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
		//#region src/client/Panel.tsx
		/**
		* PR 面板。阶段一：绑定当前工作区 + gh 环境自检（把 host 通路与「这个会话是哪个
		* 项目」跑通）；三桶列表 / 搜索 / 简洁·详细 / 详情渲染在阶段二接入本组件的
		* `dsh-pr-inbox__body`。
		*
		* 稳态开销（照 better-sidebar 的硬约束）：只在 `visible` 时取数、不持有定时器、
		* 每次可见即刷新；阶段二加轮询时同样按可见性门控。
		*/
		/** gh 相关的失败给一句「怎么办」，而不是把英文 stderr 原样抛给用户。 */
		const GH_HINT = {
			"gh-missing": "安装 GitHub CLI（https://cli.github.com）后执行 `gh auth login`。",
			"gh-unauthenticated": "执行 `gh auth login` 登录后再刷新。",
			"gh-rate-limit": "触达 GitHub API 速率上限，稍后重试（已认证为 30 次/分）。",
			"gh-timeout": "本机 gh 响应超时，检查网络后重试。",
			"no-cwd": "先在该会话里打开一个文件或产生一次工具调用，让会话确定工作目录。"
		};
		function Row({ label, value, mono = false }) {
			return (0, react.createElement)("div", { className: "dsh-pr-inbox__kv" }, [(0, react.createElement)("b", { key: "l" }, label), (0, react.createElement)("span", {
				key: "v",
				className: mono ? "dsh-pr-inbox__mono" : void 0
			}, value)]);
		}
		function Card({ title, children }) {
			return (0, react.createElement)("section", { className: "dsh-pr-inbox__card" }, [(0, react.createElement)("div", {
				key: "t",
				className: "dsh-pr-inbox__card-title"
			}, title), ...Array.isArray(children) ? children : [children]]);
		}
		function Panel({ ctx, sessionId, cwd, visible }) {
			const [state, setState] = (0, react.useState)({ phase: "loading" });
			const generation = (0, react.useRef)(0);
			const load = (0, react.useCallback)(async () => {
				const mine = generation.current + 1;
				generation.current = mine;
				setState({ phase: "loading" });
				try {
					const resolved = await resolveCwd(ctx, sessionId, cwd);
					if (resolved === void 0) {
						if (mine === generation.current) setState({
							phase: "failed",
							message: "会话还没有工作目录",
							code: "no-cwd"
						});
						return;
					}
					const value = await callOp(ctx, "status", { cwd: resolved });
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
				sessionId,
				cwd
			]);
			(0, react.useEffect)(() => {
				if (!visible) return;
				load();
			}, [visible, load]);
			const ready = state.phase === "ready" ? state.value : void 0;
			const repo = ready?.repo ?? void 0;
			const gh = ready?.gh;
			const bar = (0, react.createElement)("div", { className: "dsh-pr-inbox__bar" }, [
				(0, react.createElement)("span", {
					key: "r",
					className: "dsh-pr-inbox__repo dsh-pr-inbox__grow"
				}, repo === void 0 ? state.phase === "loading" ? "PR · 读取中…" : "PR · 未绑定项目" : repo.fullName),
				(0, react.createElement)("span", {
					key: "g",
					className: "dsh-pr-inbox__meta"
				}, gh?.login !== void 0 ? `@${gh.login}` : gh?.available === true ? "未登录" : ""),
				(0, react.createElement)("button", {
					key: "refresh",
					type: "button",
					className: "dsh-pr-inbox__button",
					disabled: state.phase === "loading" || !visible,
					onClick: () => {
						load();
					},
					title: "刷新"
				}, "刷新")
			]);
			const body = [];
			if (state.phase === "loading") body.push((0, react.createElement)("div", {
				key: "l",
				className: "dsh-pr-inbox__empty"
			}, "读取中…"));
			else if (state.phase === "failed") {
				body.push((0, react.createElement)("div", {
					key: "e",
					className: "dsh-pr-inbox__alert",
					"data-tone": "error"
				}, state.message));
				const hint = state.code === void 0 ? void 0 : GH_HINT[state.code];
				if (hint !== void 0) body.push((0, react.createElement)("div", {
					key: "h",
					className: "dsh-pr-inbox__muted"
				}, hint));
			} else {
				const value = state.value;
				if (value.repo === null) body.push((0, react.createElement)("div", {
					key: "n",
					className: "dsh-pr-inbox__alert"
				}, "当前工作区不是 git 仓库，或者它的 remote 解析不出 forge 项目（需要形如 origin → github.com/owner/repo）。"));
				else body.push((0, react.createElement)(Card, {
					key: "repo",
					title: "绑定的项目"
				}, [
					(0, react.createElement)(Row, {
						key: "a",
						label: "仓库",
						value: value.repo.fullName,
						mono: true
					}),
					(0, react.createElement)(Row, {
						key: "b",
						label: "Remote",
						value: value.repo.remoteUrl,
						mono: true
					}),
					(0, react.createElement)(Row, {
						key: "c",
						label: "仓库根",
						value: value.repo.root,
						mono: true
					})
				]));
				const ghCard = [];
				if (!value.gh.available) {
					ghCard.push((0, react.createElement)("div", {
						key: "x",
						className: "dsh-pr-inbox__alert",
						"data-tone": "error"
					}, value.gh.error ?? "本机没有可用的 gh CLI"));
					ghCard.push((0, react.createElement)("div", {
						key: "y",
						className: "dsh-pr-inbox__muted"
					}, GH_HINT["gh-missing"]));
				} else {
					ghCard.push((0, react.createElement)(Row, {
						key: "v",
						label: "版本",
						value: value.gh.version ?? "未知",
						mono: true
					}));
					ghCard.push((0, react.createElement)(Row, {
						key: "a",
						label: "账号",
						value: value.gh.login ?? "未登录"
					}));
					if (value.gh.error !== void 0) {
						const hint = value.gh.code === void 0 ? void 0 : GH_HINT[value.gh.code];
						ghCard.push((0, react.createElement)("div", {
							key: "e",
							className: "dsh-pr-inbox__alert"
						}, value.gh.error));
						if (hint !== void 0) ghCard.push((0, react.createElement)("div", {
							key: "h",
							className: "dsh-pr-inbox__muted"
						}, hint));
					}
				}
				body.push((0, react.createElement)(Card, {
					key: "gh",
					title: "本机 gh"
				}, ghCard));
				body.push((0, react.createElement)("div", {
					key: "next",
					className: "dsh-pr-inbox__muted"
				}, "阶段一：绑定与自检已通。下一步：三桶列表（我提的 / 待我审 / 最近合并）、顶部搜索、简洁·详细切换、PR 详情原生渲染。"));
			}
			return (0, react.createElement)("div", {
				className: "dsh-pr-inbox",
				"data-dsh-pr-inbox-panel": ""
			}, bar, (0, react.createElement)("div", { className: "dsh-pr-inbox__body" }, body));
		}
		//#endregion
		//#region src/client/icons.tsx
		/** 面板图标：自绘的 PR 形状（两点一竖 + 分支弧），颜色走 currentColor，
		*  具体色值由样式表用 `--dsw-alias-*` 令牌给出——插件不持有颜色字面量。 */
		function PrIcon({ size = 16 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				"aria-hidden": true,
				focusable: false,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round"
			}, [
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
		//#endregion
		//#region src/client/styles.ts
		/**
		* 面板样式：一条注入式 `<style>`（幂等），类名稳定（不是 CSS Modules 的哈希），
		* 颜色**只**消费 DSH 的 `--dsw-alias-*` 设计令牌 —— 因此自动跟随深浅主题与皮肤中心，
		* 插件没有任何硬编码颜色。
		*/
		const STYLE_ID = "dsh-pr-inbox-styles";
		const CSS = `
.dsh-pr-inbox {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: var(--dsw-font-xxs-12, 12px);
}
.dsh-pr-inbox__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex: none;
}
.dsh-pr-inbox__grow { flex: 1; min-width: 0; }
.dsh-pr-inbox__repo {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-pr-inbox__meta {
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-pr-inbox__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-pr-inbox__card {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  padding: 8px;
  background: var(--dsw-alias-bg-layer-2);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-pr-inbox__card-title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dsh-pr-inbox__kv { display: flex; gap: 6px; align-items: baseline; }
.dsh-pr-inbox__kv > b { font-weight: 500; color: var(--dsw-alias-label-secondary); min-width: 68px; }
.dsh-pr-inbox__mono { font-family: var(--ds-font-family-code, ui-monospace, monospace); }
.dsh-pr-inbox__muted { color: var(--dsw-alias-label-tertiary); }
.dsh-pr-inbox__alert {
  border: 1px solid var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-state-warn-primary);
  border-radius: 6px;
  padding: 7px 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent);
}
.dsh-pr-inbox__alert[data-tone='error'] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
.dsh-pr-inbox__button {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: 5px;
  padding: 2px 6px;
  cursor: pointer;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dsh-pr-inbox__button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-pr-inbox__button:disabled { opacity: .5; cursor: default; }
.dsh-pr-inbox__pill {
  border-radius: 999px;
  padding: 0 6px;
  font-size: var(--dsw-font-xxxs-11, 11px);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.dsh-pr-inbox__empty {
  color: var(--dsw-alias-label-tertiary);
  padding: 12px 4px;
  text-align: center;
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
