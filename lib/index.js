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
/** gh 子进程统一环境（分页/交互/颜色/提示都关掉，解析不依赖终端能力）。 */
function ghEnv() {
	return {
		...process.env,
		GH_PAGER: "cat",
		GH_PROMPT_DISABLED: "1",
		GH_NO_UPDATE_NOTIFIER: "1",
		NO_COLOR: "1",
		GIT_TERMINAL_PROMPT: "0"
	};
}
/** 把 execFile 的失败翻译成带错误码的插件错误（两个 runner 共用）。 */
function ghExecFailure(error, stderr, timeoutMs, tooLargeCode) {
	if (error.code === "ENOENT") return new PrInboxError("未找到 gh CLI（请安装 GitHub CLI 并 `gh auth login`）", "gh-missing", 501);
	if (error.code === tooLargeCode) return new PrInboxError("文件超过本插件允许的大小", "too-large", 413);
	if (error.code === "ETIMEDOUT" || error.killed === true) return new PrInboxError(`gh 命令超时（${Math.round(timeoutMs / 1e3)}s）`, "gh-timeout", 504);
	return classifyGhFailure(stderr.trim() || error.message);
}
/** 跑一条 gh 命令，返回 stdout。失败的分类在这一层统一做掉。 */
async function runGh(args, timeoutMs = GH_TIMEOUT_MS) {
	return await new Promise((resolve, reject) => {
		execFile("gh", [...args], {
			encoding: "utf8",
			timeout: timeoutMs,
			maxBuffer: GH_MAX_OUTPUT,
			windowsHide: true,
			env: ghEnv()
		}, (error, stdout, stderr) => {
			if (error === null || error === void 0) {
				resolve(stdout);
				return;
			}
			reject(ghExecFailure(error, stderr, timeoutMs, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"));
		});
	});
}
/**
* 二进制读（图片等字节流）：stdout 以 **Buffer** 回——用 utf8 解码会把字节弄坏。
*
* `maxBuffer` 就是硬上限：超了 Node 杀掉子进程并回
* `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`，调用方据此回 413，**大文件从不整体进内存**。
*/
async function runGhBuffer(args, maxBuffer = GH_MAX_OUTPUT, timeoutMs = GH_TIMEOUT_MS) {
	return await new Promise((resolve, reject) => {
		execFile("gh", [...args], {
			encoding: "buffer",
			timeout: timeoutMs,
			maxBuffer,
			windowsHide: true,
			env: ghEnv()
		}, (error, stdout, stderr) => {
			if (error === null || error === void 0) {
				resolve(stdout);
				return;
			}
			reject(ghExecFailure(error, String(stderr), timeoutMs, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"));
		});
	});
}
/** 跑一条 gh 命令并解析 JSON。解析失败算**上游输出异常**，不伪装成空结果。 */
async function ghJson(args) {
	const out = await runGh(args);
	try {
		return JSON.parse(out);
	} catch {
		throw new PrInboxError("gh 返回了非 JSON 输出", "gh-bad-output", 502);
	}
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
	const remote = await preferredRemote(cwd);
	if (remote === void 0) return void 0;
	const identity = parseRemoteUrl(remote.url);
	if (identity === void 0) return void 0;
	return {
		...identity,
		remoteName: remote.name,
		remoteUrl: remote.url,
		root,
		fullName: `${identity.owner}/${identity.name}`
	};
}
/**
* 绑定用哪个 remote：**`upstream` 优先**（fork 布局：origin = 自己的 fork，
* upstream = 主仓），其次 `origin`，最后按名字取第一个。
*
* 为什么不是 origin 优先：开源贡献者 checkout 的 origin 通常是自己 fork，
* 绑到 fork 会让 `author:@me` / `review-requested:@me` 看不到主仓的 PR——那恰好
* 是这个面板最常用的场景。
*/
async function preferredRemote(cwd) {
	let names;
	try {
		names = (await gitOut(cwd, ["remote"])).split("\n").map((line) => line.trim()).filter(Boolean);
	} catch {
		return;
	}
	if (names.length === 0) return void 0;
	const rank = (name) => name === "upstream" ? 0 : name === "origin" ? 1 : 2;
	const ordered = [...names].sort((left, right) => rank(left) - rank(right));
	for (const name of ordered) try {
		const url = (await gitOut(cwd, [
			"config",
			"--get",
			`remote.${name}.url`
		])).trim();
		if (url !== "") return {
			name,
			url
		};
	} catch {}
}
//#endregion
//#region src/host/trust.ts
function isSameOrigin(req) {
	const origin = req.headers.origin;
	if (typeof origin !== "string" || origin === "") return true;
	const host = req.headers.host;
	if (typeof host !== "string" || host === "") return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/host/image.ts
const IMAGE_PATH = "/plugins/dsh-pr-inbox/image";
/** 单张图片字节上限（8 MiB）。 */
const MAX_BYTES = 8388608;
/** raw 读的 maxBuffer 上限（多留 64 KiB 给可能存在的包装字节）。 */
const READ_MAX_BUFFER = 8454144;
/** 缓存 300 s（与响应头的 max-age 对齐：同一张图反复渲染不打 GitHub）。 */
const CACHE_TTL_MS$2 = 3e5;
/** 条数上限。 */
const CACHE_MAX_ENTRIES = 24;
/** **字节**上限：条数界在图片这种大载荷上不够，再加一条总字节预算。 */
const CACHE_MAX_BYTES = 33554432;
/** `path` / `ref` 的长度上限（词法闸门）。 */
const MAX_PATH_LENGTH = 512;
const MAX_REF_LENGTH = 256;
/** 扩展名 → MIME。只有这张表里的扩展名会被代理。 */
const MIME_BY_EXT = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif"
};
function imageMimeFor(path) {
	const dot = path.lastIndexOf(".");
	if (dot < 0) return void 0;
	return MIME_BY_EXT[path.slice(dot + 1).toLowerCase()];
}
/** 仓库内相对路径：空串 / 绝对 / 任何一段 `.`/`..` / NUL / 超长一律 400。
*  另外拒绝 `?`/`#`/反斜杠/控制字符与**百分号编码的** dot/slash（`%2e` 等）：
*  这条字符串会原样拼进 `gh api .../contents/<path>`，词法层必须比调用方更严。 */
function requireRepoPath(value) {
	if (typeof value !== "string" || value === "" || value.length > MAX_PATH_LENGTH) throw new PrInboxError("需要仓库内相对路径", "bad-request", 400);
	if (value.startsWith("/") || /[?#\\\u0000-\u001f]/.test(value)) throw new PrInboxError("路径必须是仓库内相对路径", "bad-request", 400);
	if (/%(?:2e|2f|5c)/i.test(value)) throw new PrInboxError("路径里不允许编码后的 `.` / `/` / `\\`", "bad-request", 400);
	if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new PrInboxError("路径里不允许空段 / `.` / `..`", "bad-request", 400);
	return value;
}
/** ref：分支名 / tag / SHA / `refs/pull/<n>/head` 都合法；只做词法校验。
*  前导 `-` 直接拒（它总是作为 `ref=<value>` 传，但少一个「看起来像选项」的形状）。 */
function requireRef(value) {
	if (typeof value !== "string" || value === "" || value.length > MAX_REF_LENGTH || value.startsWith("-") || !/^[A-Za-z0-9._/~+-]+$/.test(value)) throw new PrInboxError("需要合法的 ref（分支 / tag / SHA）", "bad-request", 400);
	return value;
}
/**
* 魔数确认：扩展名说是图，字节也得像图。这样这条路由不会把任意内容当
* `image/png` 发出去（同源页面可以拿它当「受信的字节源」）。
*/
function sniffImageMime(bytes, mime) {
	const head = (length) => bytes.subarray(0, length).toString("latin1");
	switch (mime) {
		case "image/png": return bytes.length > 8 && bytes[0] === 137 && head(4) === "PNG";
		case "image/jpeg": return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
		case "image/gif": return head(3) === "GIF";
		case "image/webp": return bytes.length > 12 && head(4) === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
		case "image/bmp": return head(2) === "BM";
		case "image/x-icon": return bytes.length > 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1;
		case "image/avif": return bytes.length > 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp";
		case "image/svg+xml": {
			const text = bytes.subarray(0, 512).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
			return text.startsWith("<svg") || text.startsWith("<?xml") || text.startsWith("<!--") || text.startsWith("<!doctype svg");
		}
		default: return false;
	}
}
/** 有界缓存：TTL + 条数 + 总字节三重约束，按插入序淘汰最旧。 */
const cache$2 = /* @__PURE__ */ new Map();
const inflight$2 = /* @__PURE__ */ new Map();
let cacheBytes = 0;
/** cwd → 仓库身份的短缓存：一篇正文里的 N 张图只跑一次 `git`（detectRepo 是 2–3 个子进程）。
*  **不缓存失败**：工作区可能刚刚才绑定好。 */
const REPO_TTL_MS = 6e4;
const REPO_CACHE_MAX = 32;
const repoCache = /* @__PURE__ */ new Map();
async function detectRepoCached(cwd, now) {
	const hit = repoCache.get(cwd);
	if (hit !== void 0 && hit.expires > now) return hit.repo;
	const repo = await detectRepo(cwd);
	if (repo === void 0) return void 0;
	repoCache.set(cwd, {
		expires: now + REPO_TTL_MS,
		repo
	});
	while (repoCache.size > REPO_CACHE_MAX) {
		const oldest = repoCache.keys().next().value;
		if (oldest === void 0) break;
		repoCache.delete(oldest);
	}
	return repo;
}
function cacheTake(key, now) {
	const hit = cache$2.get(key);
	if (hit === void 0) return void 0;
	if (hit.expires <= now) {
		cache$2.delete(key);
		cacheBytes -= hit.bytes.length;
		return;
	}
	cache$2.delete(key);
	cache$2.set(key, hit);
	return hit;
}
function cachePut(key, value) {
	cacheBytes += value.bytes.length;
	cache$2.set(key, {
		expires: Date.now() + CACHE_TTL_MS$2,
		...value
	});
	while (cache$2.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
		const oldest = cache$2.keys().next().value;
		if (oldest === void 0) break;
		const dropped = cache$2.get(oldest);
		cache$2.delete(oldest);
		if (dropped !== void 0) cacheBytes -= dropped.bytes.length;
	}
}
/** 先问大小（超上限不下载字节），再走 raw 读字节，最后魔数确认。 */
async function fetchImage(fullName, ref, path) {
	const mime = imageMimeFor(path);
	if (mime === void 0) throw new PrInboxError("只代理图片（png/jpg/jpeg/gif/webp/svg/bmp/ico/avif）", "unsupported-type", 415);
	const meta = await ghJson([
		"api",
		"-X",
		"GET",
		`repos/${fullName}/contents/${path}`,
		"-f",
		`ref=${ref}`,
		"-H",
		"Accept: application/vnd.github+json"
	]);
	const size = typeof meta.size === "number" ? meta.size : void 0;
	if (size !== void 0 && size > MAX_BYTES) throw new PrInboxError(`图片超过上限 8 MiB（${size} 字节）`, "too-large", 413);
	const bytes = await runGhBuffer([
		"api",
		"-X",
		"GET",
		`repos/${fullName}/contents/${path}`,
		"-f",
		`ref=${ref}`,
		"-H",
		"Accept: application/vnd.github.raw"
	], READ_MAX_BUFFER);
	if (bytes.length === 0) throw new PrInboxError("取回 0 字节", "gh-bad-output", 502);
	if (!sniffImageMime(bytes, mime)) throw new PrInboxError("内容与扩展名不符（不是图片）", "unsupported-type", 415);
	return {
		mime,
		bytes
	};
}
/**
* 解析并取字节。`cwd` 由本插件自己解析成仓库坐标；同一 (repo, ref, path) 并发只发一次。
*/
async function resolveImage(cwdRaw, refRaw, pathRaw) {
	const cwd = requireAbsoluteCwd(cwdRaw);
	const ref = requireRef(refRaw);
	const path = requireRepoPath(pathRaw);
	const repo = await detectRepoCached(cwd, Date.now());
	if (repo === void 0) throw new PrInboxError("当前工作区没有可识别的 forge 项目", "no-repo", 404);
	if (repo.host !== "github.com") throw new PrInboxError(`图片代理当前只支持 github.com（这个工作区绑定的是 ${repo.host}）`, "unsupported-host", 501);
	const key = `${repo.fullName}@${ref}:${path}`;
	const hit = cacheTake(key, Date.now());
	if (hit !== void 0) return {
		...hit,
		fullName: repo.fullName,
		cached: true
	};
	const pending = inflight$2.get(key);
	if (pending !== void 0) return {
		...await pending,
		fullName: repo.fullName,
		cached: false
	};
	const promise = fetchImage(repo.fullName, ref, path).then((value) => {
		cachePut(key, value);
		inflight$2.delete(key);
		return value;
	}, (error) => {
		inflight$2.delete(key);
		throw error;
	});
	inflight$2.set(key, promise);
	return {
		...await promise,
		fullName: repo.fullName,
		cached: false
	};
}
function sendJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
/** `GET` 字节路由：成功回真实字节，失败回与 `/api` 同形的 JSON 信封。 */
async function imageHandler(req, res) {
	try {
		if (req.method !== "GET" && req.method !== "HEAD") {
			sendJson(res, 405, {
				ok: false,
				error: {
					code: "method-not-allowed",
					message: "只用 GET"
				}
			});
			return;
		}
		if (!isSameOrigin(req)) {
			sendJson(res, 403, {
				ok: false,
				error: {
					code: "forbidden",
					message: "跨站请求被拒绝"
				}
			});
			return;
		}
		const url = new URL(req.url ?? "/", "http://dsh.internal");
		const value = await resolveImage(url.searchParams.get("cwd"), url.searchParams.get("ref"), url.searchParams.get("path"));
		const headers = {
			"content-type": value.mime,
			"content-length": String(value.bytes.length),
			"cache-control": "private, max-age=300",
			"x-content-type-options": "nosniff"
		};
		if (value.mime === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
		res.writeHead(200, headers);
		res.end(req.method === "HEAD" ? void 0 : value.bytes);
	} catch (error) {
		if (error instanceof PrInboxError) {
			sendJson(res, error.status, {
				ok: false,
				error: {
					code: error.code,
					message: error.message
				}
			});
			return;
		}
		sendJson(res, 500, {
			ok: false,
			error: {
				code: "internal",
				message: error instanceof Error ? error.message : String(error)
			}
		});
	}
}
//#endregion
//#region src/host/detail.ts
/**
* 单个 PR 的详情取数（面板自己渲染：正文 / 时间线 / 文件清单）。
*
* 一条主查询 + 三条支线：
*   pulls/{n}                    主：身份、正文、统计、分支、标签（失败即整体失败）
*   pulls/{n}/files              支线：改动文件（**有界**取一页）
*   issues/{n}/comments          支线：issue 评论
*   pulls/{n}/reviews            支线：review（含状态与正文）
*
* 支线失败**不**让详情变空白：已取到的部分照常返回，失败原因进 `warnings`。
* 所有文本都有上限（正文 64 KiB、单条评论 8 KiB），返回值因此有界。
*/
/** 文件与时间线各取一页（配合 PR 上的总数给出截断标记）。 */
const FILES_PAGE = 100;
const COMMENTS_PAGE = 50;
const REVIEWS_PAGE = 50;
/** 正文 / 单条评论正文的上限（面板渲染成本与响应体积都有界）。 */
const BODY_CAP = 65536;
const COMMENT_CAP = 8192;
/** 详情缓存 30 s：同一 PR 反复点开不重复打 API。 */
const CACHE_TTL_MS$1 = 3e4;
const CACHE_MAX$1 = 8;
/** PR 编号必须是正整数（客户端输入，词法校验挡掉 0 / 负数 / 小数 / 字符串）。 */
function requirePullNumber(value) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new PrInboxError("需要合法的 PR 编号", "bad-request", 400);
	return value;
}
/** 截断文本并如实报告（绝不静默截断）。**不切开代理对**（否则尾部会变成 U+FFFD）。 */
function capText(text, cap = BODY_CAP) {
	if (text.length <= cap) return {
		text,
		truncated: false
	};
	let end = cap;
	const last = text.charCodeAt(end - 1);
	if (last >= 55296 && last <= 56319) end -= 1;
	return {
		text: text.slice(0, end),
		truncated: true
	};
}
const str = (value, fallback = "") => typeof value === "string" ? value : fallback;
const num = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
/** 作者头像 URL：只接受非空字符串，缺失/空串就**不产出该键**
*  （与 mergedAt / previousPath 同一风格，渲染方自己回退占位）。 */
function avatarOf(user) {
	const url = user?.avatar_url;
	return typeof url === "string" && url !== "" ? { authorAvatar: url } : {};
}
function labelNames(raw) {
	if (!Array.isArray(raw)) return [];
	return raw.map((label) => typeof label === "object" && label !== null ? label.name : void 0).filter((name) => typeof name === "string" && name !== "");
}
/** `pulls/{n}` → 详情骨架。缺 number/title 视为上游形状异常（返回 undefined）。 */
function normalizePull(raw) {
	const number = raw.number;
	const title = raw.title;
	if (typeof number !== "number" || typeof title !== "string") return void 0;
	const body = capText(str(raw.body));
	const mergedAt = raw.merged_at;
	const mergeableState = str(raw.mergeable_state);
	return {
		number,
		title,
		body: body.text,
		bodyTruncated: body.truncated,
		url: str(raw.html_url),
		author: str(raw.user?.login),
		...avatarOf(raw.user),
		state: str(raw.state, "open"),
		isDraft: raw.draft === true,
		createdAt: str(raw.created_at),
		updatedAt: str(raw.updated_at),
		...typeof mergedAt === "string" && mergedAt !== "" ? { mergedAt } : {},
		baseRef: str(raw.base?.ref),
		headRef: str(raw.head?.ref),
		labels: labelNames(raw.labels),
		additions: num(raw.additions),
		deletions: num(raw.deletions),
		changedFiles: num(raw.changed_files),
		commits: num(raw.commits),
		comments: num(raw.comments),
		reviewComments: num(raw.review_comments),
		...mergeableState === "" ? {} : { mergeableState }
	};
}
/** `pulls/{n}/files` 的一行。 */
function normalizeFile(raw) {
	const path = raw.filename;
	if (typeof path !== "string" || path === "") return void 0;
	const previous = str(raw.previous_filename);
	return {
		path,
		status: str(raw.status, "modified"),
		additions: num(raw.additions),
		deletions: num(raw.deletions),
		...previous === "" ? {} : { previousPath: previous }
	};
}
/** `issues/{n}/comments` 的一条。 */
function normalizeIssueComment(raw) {
	const rawBody = raw.body;
	if (typeof rawBody !== "string") return void 0;
	const capped = capText(rawBody, COMMENT_CAP);
	return {
		kind: "comment",
		author: str(raw.user?.login),
		...avatarOf(raw.user),
		createdAt: str(raw.created_at),
		body: capped.truncated ? `${capped.text}\n\n…（本条评论过长，已截断）` : capped.text
	};
}
/** `pulls/{n}/reviews` 的一条。 */
function normalizeReview(raw) {
	const state = str(raw.state);
	if (state === "") return void 0;
	const capped = capText(str(raw.body), COMMENT_CAP);
	return {
		kind: "review",
		author: str(raw.user?.login),
		...avatarOf(raw.user),
		createdAt: str(raw.submitted_at ?? raw.created_at),
		body: capped.text,
		reviewState: state
	};
}
/** 评论 + review 合成一条按时间升序的时间线。无法解析的时间排到最后（而不是打乱顺序）。 */
function mergeTimeline(comments, reviews) {
	const timeOf = (iso) => {
		const parsed = Date.parse(iso);
		return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
	};
	return [...comments, ...reviews].sort((left, right) => timeOf(left.createdAt) - timeOf(right.createdAt));
}
const cache$1 = /* @__PURE__ */ new Map();
const inflight$1 = /* @__PURE__ */ new Map();
async function loadDetail(repo, number) {
	const base = `repos/${repo.owner}/${repo.name}`;
	const skeleton = normalizePull(await ghJson(["api", `${base}/pulls/${number}`]));
	if (skeleton === void 0) throw new PrInboxError("上游返回的 PR 形状不完整", "gh-bad-output", 502);
	const warnings = [];
	const [files, comments, reviews] = await Promise.all([
		ghJson([
			"api",
			"-X",
			"GET",
			`${base}/pulls/${number}/files`,
			"-f",
			`per_page=${FILES_PAGE}`
		]).then((raw) => Array.isArray(raw) ? raw : []).catch((error) => {
			warnings.push(warningOf("files", error));
			return [];
		}),
		ghJson([
			"api",
			"-X",
			"GET",
			`${base}/issues/${number}/comments`,
			"-f",
			`per_page=${COMMENTS_PAGE}`
		]).then((raw) => Array.isArray(raw) ? raw : []).catch((error) => {
			warnings.push(warningOf("comments", error));
			return [];
		}),
		ghJson([
			"api",
			"-X",
			"GET",
			`${base}/pulls/${number}/reviews`,
			"-f",
			`per_page=${REVIEWS_PAGE}`
		]).then((raw) => Array.isArray(raw) ? raw : []).catch((error) => {
			warnings.push(warningOf("reviews", error));
			return [];
		})
	]);
	const normalizedFiles = files.map(normalizeFile).filter((file) => file !== void 0);
	const timeline = mergeTimeline(comments.map(normalizeIssueComment).filter((row) => row !== void 0), reviews.map(normalizeReview).filter((row) => row !== void 0));
	return {
		...skeleton,
		repo,
		files: normalizedFiles,
		filesTruncated: normalizedFiles.length < skeleton.changedFiles,
		timeline,
		timelineTruncated: timeline.length < skeleton.comments || reviews.length >= REVIEWS_PAGE,
		warnings,
		fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/** 支线失败 → 可本地化的结构（分区名由客户端翻译，错误码让客户端挑人话）。 */
function warningOf(part, error) {
	const code = error instanceof PrInboxError && error.code !== "" ? error.code : void 0;
	return {
		part,
		...code === void 0 ? {} : { code },
		message: messageOf(error)
	};
}
/** `detail`：给定 cwd + PR 编号，取回面板渲染所需的全部内容（有界 + 缓存）。 */
async function detailOp(payload) {
	const cwd = requireAbsoluteCwd(payload.cwd);
	const number = requirePullNumber(payload.number);
	const repo = await detectRepo(cwd);
	if (repo === void 0) throw new PrInboxError("当前工作区没有可识别的 forge 项目", "no-repo", 404);
	if (repo.host !== "github.com") throw new PrInboxError(`当前只支持 github.com（这个工作区绑定的是 ${repo.host}）`, "unsupported-host", 501);
	const key = `${repo.fullName}#${number}`;
	const hit = cache$1.get(key);
	if (hit !== void 0 && hit.expires > Date.now()) {
		cache$1.delete(key);
		cache$1.set(key, hit);
		return hit.value;
	}
	const pending = inflight$1.get(key);
	if (pending !== void 0) return pending;
	const promise = loadDetail(repo, number).then((value) => {
		cache$1.set(key, {
			expires: Date.now() + CACHE_TTL_MS$1,
			value
		});
		while (cache$1.size > CACHE_MAX$1) {
			const oldest = cache$1.keys().next().value;
			if (oldest === void 0) break;
			cache$1.delete(oldest);
		}
		inflight$1.delete(key);
		return value;
	}, (error) => {
		inflight$1.delete(key);
		throw error;
	});
	inflight$1.set(key, promise);
	return promise;
}
//#endregion
//#region src/host/prs.ts
/**
* 三桶 PR 的取数层。
*
* 三桶都用**同一套 REST 搜索**（`gh api -X GET search/issues`）而不是
* `gh search prs`：搜索接口回 `total_count`（桶头的计数角标要它），
* 且 `is:merged` 这类限定词能直接写进 q（`gh search prs --state` 不认 merged）。
*
* 三条查询彼此独立：某一条失败（限流、超时）只让**那个桶**带 error，
* 另外两桶照常出数据——面板因此不会因为一次 403 变成空白页。
*/
/** 一页取多少行（桶头的 total 是命中总数，不受它限制）。 */
const PAGE_SIZE = 30;
/** 列表缓存 60 s：搜索配额 30 次/分，一次刷新 3 条查询——这个 TTL 下反复切 tab 也安全。 */
const CACHE_TTL_MS = 6e4;
/** 缓存条目上限（按仓库 × 桶），淘汰最旧的；模块级表必须有界。 */
const CACHE_MAX = 12;
/** 三个桶的查询（纯函数：给定 owner/repo 产出限定词，便于单测锁定语义）。
*
* 「最近合并」限定 `author:@me`：这一桶回答的是「我刚做的事落地没有」，
* 不是「仓库最近合并了什么」。仓库全局的合并流会把这一桶变成别人的时间线。
*/
function bucketQueries(repo) {
	return [
		{
			key: "authored",
			q: `repo:${repo} is:pr is:open author:@me`,
			limit: PAGE_SIZE
		},
		{
			key: "review",
			q: `repo:${repo} is:pr is:open review-requested:@me`,
			limit: PAGE_SIZE
		},
		{
			key: "merged",
			q: `repo:${repo} is:pr is:merged author:@me`,
			limit: 20
		}
	];
}
/** 一条搜索结果 → 一行 PR。缺关键字段就丢弃（上游形状变化时不产出半条脏行）。 */
function normalizeSearchItem(item) {
	const number = item.number;
	const title = item.title;
	const url = item.html_url;
	if (typeof number !== "number" || typeof title !== "string" || typeof url !== "string") return void 0;
	const labels = Array.isArray(item.labels) ? item.labels.map((label) => typeof label === "object" && label !== null ? label.name : void 0).filter((name) => typeof name === "string" && name !== "") : [];
	const mergedAt = item.pull_request?.merged_at;
	const avatar = item.user?.avatar_url;
	return {
		number,
		title,
		url,
		author: typeof item.user?.login === "string" ? item.user.login : "",
		...typeof avatar === "string" && avatar !== "" ? { authorAvatar: avatar } : {},
		isDraft: item.draft === true,
		state: typeof item.state === "string" ? item.state : "open",
		createdAt: typeof item.created_at === "string" ? item.created_at : "",
		updatedAt: typeof item.updated_at === "string" ? item.updated_at : "",
		...typeof mergedAt === "string" ? { mergedAt } : {},
		labels,
		comments: typeof item.comments === "number" ? item.comments : 0
	};
}
const cache = /* @__PURE__ */ new Map();
const inflight = /* @__PURE__ */ new Map();
function cached(key, now) {
	const hit = cache.get(key);
	if (hit === void 0) return void 0;
	if (hit.expires <= now) {
		cache.delete(key);
		return;
	}
	cache.delete(key);
	cache.set(key, hit);
	return hit.value;
}
function remember(key, value, now) {
	cache.set(key, {
		expires: now + CACHE_TTL_MS,
		value
	});
	while (cache.size > CACHE_MAX) {
		const oldest = cache.keys().next().value;
		if (oldest === void 0) break;
		cache.delete(oldest);
	}
}
/** 真取一桶。单飞：并发的同键请求共用一个 Promise。 */
async function fetchBucket(repo, query, now) {
	const key = `${repo}|${query.key}`;
	const hit = cached(key, now);
	if (hit !== void 0) return hit;
	const pending = inflight.get(key);
	if (pending !== void 0) return pending;
	const promise = ghJson([
		"api",
		"-X",
		"GET",
		"search/issues",
		"-f",
		`q=${query.q}`,
		"-f",
		`per_page=${query.limit}`,
		"-f",
		"sort=updated",
		"-f",
		"order=desc"
	]).then((response) => {
		const rows = (Array.isArray(response.items) ? response.items : []).map(normalizeSearchItem).filter((row) => row !== void 0);
		const data = {
			total: typeof response.total_count === "number" ? response.total_count : rows.length,
			rows
		};
		remember(key, data, Date.now());
		inflight.delete(key);
		return data;
	}, (error) => {
		inflight.delete(key);
		throw error;
	});
	inflight.set(key, promise);
	return promise;
}
function errorOf(error) {
	if (error instanceof PrInboxError) return error.code === "" ? { message: error.message } : {
		code: error.code,
		message: error.message
	};
	return { message: error instanceof Error ? error.message : String(error) };
}
/** 三桶并发取数；单桶失败只影响那一桶。 */
async function listOp(payload) {
	const cwd = requireAbsoluteCwd(payload.cwd);
	const [gh, repo] = await Promise.all([probeGh(), detectRepo(cwd)]);
	const fetchedAt = (/* @__PURE__ */ new Date()).toISOString();
	const empty = {
		total: 0,
		rows: []
	};
	const buckets = {
		authored: empty,
		review: empty,
		merged: empty
	};
	if (repo === void 0 || repo === null) return {
		repo: null,
		gh,
		fetchedAt,
		buckets
	};
	if (repo.host !== "github.com") return {
		repo,
		gh,
		fetchedAt,
		buckets,
		note: `当前只支持 github.com（这个工作区绑定的是 ${repo.host}）`
	};
	const now = Date.now();
	await Promise.all(bucketQueries(repo.fullName).map(async (query) => {
		try {
			const data = await fetchBucket(repo.fullName, query, now);
			buckets[query.key] = {
				total: data.total,
				rows: data.rows
			};
		} catch (error) {
			buckets[query.key] = {
				total: 0,
				rows: [],
				error: errorOf(error)
			};
		}
	}));
	return {
		repo,
		gh,
		fetchedAt,
		buckets
	};
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
const OPS = {
	status: statusOp,
	list: listOp,
	detail: detailOp
};
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
		if (!isSameOrigin(req)) {
			send(res, 403, {
				ok: false,
				error: {
					code: "forbidden",
					message: "跨站请求被拒绝"
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
		const handler = Object.hasOwn(OPS, op) ? OPS[op] : void 0;
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
/** 挂两条路由（JSON op 表 + 图片字节代理）；返回 disposer（`ctx.effect` 的返回值）。
*  webServer 缺席时安静降级。 */
function registerRoutes(ctx) {
	const server = webServerOf(ctx);
	if (server === void 0) return () => {};
	const disposers = [server.register({
		kind: "exact",
		path: ROUTE_PATH,
		handler: (req, res) => {
			handle(req, res);
		}
	}), server.register({
		kind: "exact",
		path: IMAGE_PATH,
		handler: (req, res) => {
			imageHandler(req, res);
		}
	})];
	return () => {
		for (const dispose of disposers) dispose();
	};
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
