import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
//#region src/host/gh.ts
/**
* `gh` 子进程的唯一边界。
*
* 所有 GitHub 数据都经本机已登录的 `gh` CLI（见 README 的鉴权取舍）：插件自己不
* 存 token、不碰 `~/.config/gh`，token 因此永远不进模型上下文，也不会被写进
* profile / 设置里。代价是目标机器必须装 `gh` 并登录——缺它时这一层给出
* `gh-missing` / `gh-unauthenticated` 这两种**可操作**的错误，而不是空列表。
*/
/** 单条 gh 命令的时间上限：慢网络下 `gh search` 也可能几十秒，但不能无限挂住路由。 */
const GH_TIMEOUT_MS = 2e4;
/** 输出上限：一页 PR 列表远小于此；超过即视为异常而不是默默截断。 */
const GH_MAX_OUTPUT = 8388608;
/** 带 wire 错误码与 HTTP 状态的插件错误：路由层据此回信封。 */
var PrInboxError = class extends Error {
	code;
	status;
	constructor(message, code, status) {
		super(message);
		this.code = code;
		this.status = status;
		this.name = "PrInboxError";
	}
};
/** 把 gh 的 stderr 归成可操作的错误码（客户端按 code 出人话提示）。 */
function classifyGhFailure(detail) {
	const text = detail.replace(/\s+/g, " ").trim();
	if (/gh auth login|not logged in|authentication required|HTTP 401|Bad credentials/i.test(text)) return new PrInboxError(text === "" ? "gh 未登录" : text, "gh-unauthenticated", 401);
	if (/rate limit|HTTP 403|secondary rate/i.test(text)) return new PrInboxError(text === "" ? "gh 触达 API 速率上限" : text, "gh-rate-limit", 429);
	if (/Could not resolve to a (?:Repository|PullRequest|User)|HTTP 404/i.test(text)) return new PrInboxError(text, "not-found", 404);
	return new PrInboxError(text === "" ? "gh 命令失败" : text, "gh-error", 502);
}
/** 跑一条 gh 命令，返回 stdout。失败的分类在这一层统一做掉。 */
async function runGh(args, timeoutMs = GH_TIMEOUT_MS) {
	return await new Promise((resolve, reject) => {
		execFile("gh", [...args], {
			encoding: "utf8",
			timeout: timeoutMs,
			maxBuffer: GH_MAX_OUTPUT,
			windowsHide: true,
			env: {
				...process.env,
				GH_PAGER: "cat",
				GH_PROMPT_DISABLED: "1",
				GH_NO_UPDATE_NOTIFIER: "1",
				NO_COLOR: "1",
				GIT_TERMINAL_PROMPT: "0"
			}
		}, (error, stdout, stderr) => {
			if (error === null || error === void 0) {
				resolve(stdout);
				return;
			}
			const code = error.code;
			if (code === "ENOENT") {
				reject(new PrInboxError("未找到 gh CLI（请安装 GitHub CLI 并 `gh auth login`）", "gh-missing", 501));
				return;
			}
			if (code === "ETIMEDOUT" || error.killed === true) {
				reject(new PrInboxError(`gh 命令超时（${Math.round(timeoutMs / 1e3)}s）`, "gh-timeout", 504));
				return;
			}
			reject(classifyGhFailure(stderr.trim() || error.message));
		});
	});
}
/** 探测结果 5 分钟内复用：面板每次刷新都问一遍会导致「版本 + 账号」两跳白跑。 */
const PROBE_TTL_MS = 3e5;
let probeCache;
let probeInFlight;
/** 单飞探测：并发的多个刷新只触发一次 `gh --version` + `gh api user`。 */
function probeGh(now = Date.now()) {
	if (probeCache !== void 0 && probeCache.expires > now) return Promise.resolve(probeCache.value);
	if (probeInFlight !== void 0) return probeInFlight;
	const promise = probeGhUncached().then((value) => {
		probeCache = {
			expires: Date.now() + PROBE_TTL_MS,
			value
		};
		probeInFlight = void 0;
		return value;
	}, (error) => {
		probeInFlight = void 0;
		throw error;
	});
	probeInFlight = promise;
	return promise;
}
async function probeGhUncached() {
	let version;
	try {
		version = (await runGh(["--version"], 8e3)).split("\n")[0]?.trim() ?? "";
	} catch (error) {
		if (error instanceof PrInboxError) return {
			available: false,
			error: error.message,
			code: error.code
		};
		throw error;
	}
	try {
		const login = (await runGh([
			"api",
			"user",
			"-q",
			".login"
		], 12e3)).trim();
		return {
			available: true,
			version,
			login
		};
	} catch (error) {
		if (error instanceof PrInboxError) return {
			available: true,
			version,
			error: error.message,
			code: error.code
		};
		throw error;
	}
}
//#endregion
//#region src/host/repo.ts
/**
* 「当前工作区是哪个项目」——PR 面板的绑定步骤。
*
* 原料只有 git 自己：会话 cwd 里的 `rev-parse --show-toplevel` 给出仓库根，
* `remote.origin.url` 给出 forge 坐标。解析是纯函数（`parseRemoteUrl`），
* 因此 ssh / https / 带凭据 / 带 `.git` / 自定义 host（GHES）都能单测覆盖。
*/
const GIT_TIMEOUT_MS = 1e4;
const GIT_MAX_OUTPUT = 1048576;
/**
* 把 git remote URL 解析成 forge 坐标。纯函数。
*
* 覆盖：`https://github.com/o/r(.git)`、`git@github.com:o/r(.git)`、
* `ssh://git@github.com/o/r`、`https://user:token@host/o/r`、
* 以及 owner 带多段的自建 forge（GitLab 子组之类）。解析不出来返回 undefined，
* 由调用方决定是「没有 remote」还是「remote 不是 forge 形态」。
*/
function parseRemoteUrl(raw) {
	const url = raw.trim();
	if (url === "") return void 0;
	if (!url.includes("://")) {
		const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
		if (scp === null) return void 0;
		return splitRemote(scp[1], scp[2]);
	}
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	return splitRemote(parsed.hostname, parsed.pathname);
}
function splitRemote(host, path) {
	const parts = path.replace(/^\/+/, "").replace(/\.git$/, "").split("/").filter((segment) => segment !== "");
	if (host === "" || parts.length < 2) return void 0;
	const name = parts[parts.length - 1];
	return {
		host,
		owner: parts.slice(0, -1).join("/"),
		name
	};
}
function gitOut(cwd, args) {
	return new Promise((resolve, reject) => {
		execFile("git", [
			"-C",
			cwd,
			...args
		], {
			encoding: "utf8",
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: GIT_MAX_OUTPUT,
			windowsHide: true,
			env: {
				...process.env,
				GIT_TERMINAL_PROMPT: "0",
				GIT_OPTIONAL_LOCKS: "0"
			}
		}, (error, stdout) => {
			if (error === null || error === void 0) resolve(stdout);
			else reject(error);
		});
	});
}
/** cwd 必须是绝对路径：它来自客户端，词法校验挡掉相对路径与空串。 */
function requireAbsoluteCwd(value) {
	if (typeof value !== "string" || value === "" || !isAbsolute(value)) throw new PrInboxError("需要绝对的会话 cwd", "bad-request", 400);
	return value;
}
/**
* 识别 cwd 所属的项目。不是 git 仓库 / 没有可解析的 remote 时返回 undefined
* （面板据此显示「当前工作区不是 git 仓库」或「没有 forge remote」，
* 而不是一个空列表）。
*/
async function detectRepo(cwd) {
	let root;
	try {
		root = (await gitOut(cwd, ["rev-parse", "--show-toplevel"])).trim();
	} catch {
		return;
	}
	const remoteUrl = await originRemote(cwd);
	if (remoteUrl === void 0) return void 0;
	const identity = parseRemoteUrl(remoteUrl);
	if (identity === void 0) return void 0;
	return {
		...identity,
		remoteUrl,
		root,
		fullName: `${identity.owner}/${identity.name}`
	};
}
/** `remote.origin.url` 优先；没有 origin 就取第一个 remote（多 remote 仓库的常见形态）。 */
async function originRemote(cwd) {
	try {
		const url = (await gitOut(cwd, [
			"config",
			"--get",
			"remote.origin.url"
		])).trim();
		if (url !== "") return url;
	} catch {}
	try {
		const first = (await gitOut(cwd, ["remote"])).split("\n").map((line) => line.trim()).filter(Boolean)[0];
		if (first === void 0) return void 0;
		const url = (await gitOut(cwd, [
			"config",
			"--get",
			`remote.${first}.url`
		])).trim();
		return url === "" ? void 0 : url;
	} catch {
		return;
	}
}
//#endregion
//#region src/host/ops.ts
/** `status`：这个会话的工作区是哪个项目 + 本机 gh 能不能用、以谁的身份用。 */
async function statusOp(payload) {
	const cwd = requireAbsoluteCwd(payload.cwd);
	const [gh, repo] = await Promise.all([probeGh(), detectRepo(cwd)]);
	return {
		gh,
		repo: repo ?? null
	};
}
//#endregion
//#region src/host/routes.ts
const ROUTE_PATH = "/plugins/dsh-pr-inbox/api";
/** body 上限：本插件的请求只有 op + cwd + 少量筛选参数，256 KiB 已是两个数量级的余量。 */
const BODY_LIMIT = 262144;
/** op 表：每个 op 只做「校验入参 → 取数 → 返回可 JSON 化的值」。 */
const OPS = { status: statusOp };
function webServerOf(ctx) {
	const get = ctx.get;
	if (typeof get !== "function") return void 0;
	const service = get.call(ctx, "webServer");
	return typeof service?.register === "function" ? service : void 0;
}
function send(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(text);
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > BODY_LIMIT) {
				reject(new PrInboxError("请求体过大", "bad-request", 413));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("error", (error) => {
			reject(error);
		});
		req.on("end", () => {
			const text = Buffer.concat(chunks).toString("utf8");
			if (text === "") {
				resolve({});
				return;
			}
			try {
				const parsed = JSON.parse(text);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
					reject(new PrInboxError("请求体必须是 JSON 对象", "bad-request", 400));
					return;
				}
				resolve(parsed);
			} catch {
				reject(new PrInboxError("请求体不是合法 JSON", "bad-request", 400));
			}
		});
	});
}
async function handle(req, res) {
	try {
		if (req.method !== "POST") {
			send(res, 405, {
				ok: false,
				error: {
					code: "method-not-allowed",
					message: "只用 POST"
				}
			});
			return;
		}
		const payload = await readBody(req);
		const op = payload.op;
		if (typeof op !== "string" || op === "") {
			send(res, 400, {
				ok: false,
				error: {
					code: "bad-request",
					message: "缺少 op"
				}
			});
			return;
		}
		const handler = OPS[op];
		if (handler === void 0) {
			send(res, 400, {
				ok: false,
				error: {
					code: "unknown-op",
					message: `未知 op：${op}`
				}
			});
			return;
		}
		send(res, 200, {
			ok: true,
			value: await handler(payload)
		});
	} catch (error) {
		if (error instanceof PrInboxError) {
			send(res, error.status, {
				ok: false,
				error: {
					code: error.code,
					message: error.message
				}
			});
			return;
		}
		send(res, 500, {
			ok: false,
			error: {
				code: "internal",
				message: error instanceof Error ? error.message : String(error)
			}
		});
	}
}
/** 挂路由；返回 disposer（`ctx.effect` 的返回值）。webServer 缺席时安静降级。 */
function registerRoutes(ctx) {
	const server = webServerOf(ctx);
	if (server === void 0) return () => {};
	return server.register({
		kind: "exact",
		path: ROUTE_PATH,
		handler: (req, res) => {
			handle(req, res);
		}
	});
}
//#endregion
//#region src/index.ts
const name = "pr-inbox";
const inject = ["webServer"];
function apply(ctx) {
	ctx.effect(() => registerRoutes(ctx), "pr-inbox: /plugins/dsh-pr-inbox routes");
}
//#endregion
export { ROUTE_PATH, apply, inject, name };
