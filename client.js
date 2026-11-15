// dsh-font-tuner — 浏览器端插件（client bundle）。
//
// 由 dsh-client-modules 在 /plugins/dsh-font-tuner/client.js 提供，经壳层的
// lazy 模块表 window.__ModuleLoader__.load 执行。factory id 必须等于包名，
// 供 Loader 把该条目和包对上。
//
// 做法（不碰 app.asar、不依赖任何内部服务）：
//   1) 尺寸：给 <html> 设 CSS zoom —— Chromium 会把整页（文字、间距、图标）
//      等比放大，布局按百分比重排，不会把内容挤出视口。
//      另提供「仅文字」模式：只放大应用自带的排版 token（--dsw-font-*）
//      和会话正文字号变量，布局间距保持不变。
//   2) 字重：读取 :root 上 --dsw-font-* 的当前值，按模式把字重抬到
//      600/700 后写回 html:root（特异性高于 :root，且带 !important），
//      再给 body 一个继承用的基础字重，覆盖应用写死的 400。
//   3) 交互：右下角可拖动的 “Aa” 按钮 + 面板，选择保存在 localStorage
//      （视觉偏好按 DSH 的边界就该留在本机）。
"use strict";
window.__ModuleLoader__.load({
	id: "dsh-font-tuner",
	factory: function (require) {
		var VERSION = "1.0.0";
		var STORAGE_KEY = "dsh-font-tuner/v1";
		var STYLE_ID = "dsh-font-tuner-css";
		var HOST_ID = "dsh-font-tuner-host";
		var LOG_PREFIX = "[font-tuner]";

		var MIN_SCALE = 85;
		var MAX_SCALE = 175;
		var STEP = 5;
		var DEFAULTS = { mode: "zoom", scale: 110, weight: "bold" };

		// 兜底 token 表：运行时还会再从已加载的样式表里自动发现一遍，
		// 所以应用升级换了排版 token 也不会失配。
		var FALLBACK_TOKENS = [
			"--dsw-font-xxxs-11",
			"--dsw-font-xxxs-strong-11",
			"--dsw-font-xxs-12",
			"--dsw-font-xxs-strong-12",
			"--dsw-font-xs-13",
			"--dsw-font-xs-strong-13",
			"--dsw-font-s-14",
			"--dsw-font-s-strong-14",
			"--dsw-font-base-16",
			"--dsw-font-base-strong-16",
			"--dsw-font-m-18",
			"--dsw-font-l-20",
			"--dsw-font-xl-24",
			"--dsw-font-markdown-base",
			"--dsw-font-markdown-base-italic",
			"--dsw-font-markdown-base-strong",
			"--dsw-font-markdown-base-strong-italic",
			"--dsw-font-markdown-small",
			"--dsw-font-markdown-small-italic",
			"--dsw-font-markdown-small-strong",
			"--dsw-font-markdown-small-strong-italic",
			"--dsw-font-markdown-h1",
			"--dsw-font-markdown-h2",
			"--dsw-font-markdown-h3",
			"--dsw-font-markdown-h4",
			"--dsw-font-markdown-code",
			"--dsw-font-markdown-code-block",
			"--dsw-font-markdown-code-block-small",
			"--dsw-font-markdown-table",
			"--dsw-font-markdown-table-head"
		];

		function clamp(value, lo, hi) {
			return Math.min(hi, Math.max(lo, value));
		}

		function round1(value) {
			return Math.round(value * 10) / 10;
		}

		function isFiniteNumber(value) {
			return typeof value === "number" && isFinite(value);
		}

		// ── 状态 ────────────────────────────────────────────────────────────
		var state = {
			mode: DEFAULTS.mode,
			scale: DEFAULTS.scale,
			weight: DEFAULTS.weight,
			pos: null
		};

		function readState() {
			var raw = null;
			try {
				raw = window.localStorage.getItem(STORAGE_KEY);
			} catch (error) {
				raw = null;
			}
			if (!raw) return;
			var parsed = null;
			try {
				parsed = JSON.parse(raw);
			} catch (error) {
				parsed = null;
			}
			if (!parsed || typeof parsed !== "object") return;
			if (parsed.mode === "zoom" || parsed.mode === "text") state.mode = parsed.mode;
			if (isFiniteNumber(parsed.scale)) state.scale = clamp(Math.round(parsed.scale / STEP) * STEP, MIN_SCALE, MAX_SCALE);
			if (parsed.weight === "normal" || parsed.weight === "bold" || parsed.weight === "heavy") state.weight = parsed.weight;
			if (parsed.pos && isFiniteNumber(parsed.pos.left) && isFiniteNumber(parsed.pos.top)) {
				state.pos = { left: parsed.pos.left, top: parsed.pos.top };
			}
		}

		function saveState() {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
					mode: state.mode,
					scale: state.scale,
					weight: state.weight,
					pos: state.pos
				}));
			} catch (error) {
				/* 配额或隐私模式：内存里的设置仍然生效，只是不持久。 */
			}
		}

		// ── 排版 token 发现与解析 ────────────────────────────────────────────
		function isCompanionToken(name) {
			return /-(font-family|font-size|font-weight|font-style|line-height)$/.test(name);
		}

		var discoveredTokens = null;

		function collectTokens(rules, sink) {
			for (var i = 0; i < rules.length; i += 1) {
				var rule = rules[i];
				try {
					if (rule.style) {
						for (var j = 0; j < rule.style.length; j += 1) {
							var prop = rule.style[j];
							if (prop && prop.indexOf("--dsw-font-") === 0 && !isCompanionToken(prop)) sink[prop] = true;
						}
					}
					if (rule.cssRules && rule.cssRules.length) collectTokens(rule.cssRules, sink);
				} catch (error) {
					/* 跨域或受限规则：跳过。 */
				}
			}
		}

		function listTokens() {
			if (discoveredTokens) return discoveredTokens;
			var sink = {};
			var i;
			for (i = 0; i < FALLBACK_TOKENS.length; i += 1) sink[FALLBACK_TOKENS[i]] = true;
			var sheets = document.styleSheets || [];
			for (i = 0; i < sheets.length; i += 1) {
				var rules = null;
				try {
					rules = sheets[i].cssRules;
				} catch (error) {
					rules = null;
				}
				if (rules && rules.length) collectTokens(rules, sink);
			}
			discoveredTokens = Object.keys(sink);
			return discoveredTokens;
		}

		// 形如 "500 13px/20px var(--dsw-font-family)" 或 "italic 12px/20px var(...)"。
		var SHORTHAND_RE = /^\s*((?:italic|oblique)\s+)?(?:(\d{1,3})\s+)?([0-9.]+)px(?:\s*\/\s*([0-9.]+)px)?\s+(\S[\s\S]*)$/;

		function parseShorthand(raw) {
			var match = SHORTHAND_RE.exec(String(raw || ""));
			if (!match) return null;
			var size = Number.parseFloat(match[3]);
			if (!isFiniteNumber(size) || size <= 0) return null;
			return {
				style: match[1] ? match[1].trim() : "",
				weight: match[2] ? Number.parseInt(match[2], 10) : 0,
				size: size,
				lineHeight: match[4] ? Number.parseFloat(match[4]) : null,
				family: match[5].trim()
			};
		}

		// shorthand 里常常省略字重（等于 400），所以缺省值必须按 400 参与计算，
		// 否则「加粗」对绝大多数 token 都是空操作。
		// 加粗不采用统一 +100：普通 400 变 600，已经是 500 的 strong token 变 700，
		// 这样粗体层级不会被抹平。
		function targetWeight(weight, kind) {
			if (kind === "normal") return weight;
			var base = weight || 400;
			if (kind === "heavy") return base < 500 ? 700 : Math.min(900, base + 300);
			return base < 500 ? 600 : Math.min(900, base + 200);
		}

		function bodyWeightFor(kind) {
			if (kind === "heavy") return 700;
			if (kind === "bold") return 600;
			return 0;
		}

		// ── 应用 ────────────────────────────────────────────────────────────
		function removeStyle() {
			var style = document.getElementById(STYLE_ID);
			if (style && style.parentNode) style.parentNode.removeChild(style);
		}

		function buildCss() {
			var textMode = state.mode === "text";
			var factor = textMode ? state.scale / 100 : 1;
			var kind = state.weight;
			var bodyWeight = bodyWeightFor(kind);
			var computed = window.getComputedStyle(document.documentElement);
			var tokens = listTokens();
			var decls = [];
			var i;
			for (i = 0; i < tokens.length; i += 1) {
				var name = tokens[i];
				var parsed = parseShorthand(computed.getPropertyValue(name));
				if (!parsed) continue;
				var originalWeight = parsed.weight || 400;
				var weight = targetWeight(originalWeight, kind);
				var size = round1(parsed.size * factor);
				var lineHeight = parsed.lineHeight === null ? null : round1(parsed.lineHeight * factor);
				var weightChanged = weight !== originalWeight;
				if (!weightChanged && size === parsed.size && lineHeight === parsed.lineHeight) continue;
				decls.push(
					name + ":" +
					(parsed.style ? parsed.style + " " : "") +
					(weightChanged || parsed.weight ? weight + " " : "") +
					size + "px" +
					(lineHeight === null ? "" : "/" + lineHeight + "px") +
					" " + parsed.family
				);
				decls.push(name + "-font-size:" + size + "px");
				decls.push(name + "-line-height:" + (lineHeight === null ? "normal" : lineHeight + "px"));
				decls.push(name + "-font-weight:" + weight);
			}
			var css = "";
			if (decls.length) css += "html:root{" + decls.join(";") + "}";
			if (bodyWeight) css += "body{font-weight:" + bodyWeight + " !important}";
			if (textMode) {
				var base = "14px";
				try {
					var inline = String(document.body.style.getPropertyValue("--dsh-content-font-size") || "").trim();
					if (/^[0-9.]+px$/.test(inline)) base = inline;
				} catch (error) {
					base = "14px";
				}
				css += "body{--dsh-content-font-size:calc(" + base + " * " + (state.scale / 100) + ") !important}";
			}
			return css;
		}

		function publishStatus() {
			try {
				window.__DSH_FONT_TUNER_STATUS__ = {
					version: VERSION,
					mode: state.mode,
					scale: state.scale,
					weight: state.weight,
					tokenCount: listTokens().length
				};
			} catch (error) {
				/* 诊断镜像失败不影响渲染。 */
			}
		}

		var applying = false;

		function apply() {
			if (applying) return;
			if (typeof document === "undefined" || !document.body || !document.head) return;
			applying = true;
			try {
				// 先摘掉自己的样式再读计算值，否则读到的是上一轮的覆盖值，
				// 反复调节会指数级累加。
				removeStyle();
				var css = buildCss();
				var root = document.documentElement;
				if (css) {
					var style = document.createElement("style");
					style.id = STYLE_ID;
					style.setAttribute("data-dsh-font-tuner", VERSION);
					style.textContent = css;
					document.head.appendChild(style);
				}
				if (state.mode === "zoom") {
					root.style.zoom = String(state.scale / 100);
				} else {
					root.style.removeProperty("zoom");
				}
				root.setAttribute("data-dsh-font-tuner", state.mode + ":" + state.scale + ":" + state.weight);
				publishStatus();
			} catch (error) {
				try {
					console.warn(LOG_PREFIX, "apply failed", error);
				} catch (ignored) { /* 控制台不可用也无所谓 */ }
			} finally {
				applying = false;
			}
		}

		// ── 界面 ────────────────────────────────────────────────────────────
		var WIDGET_CSS = [
			":host{position:fixed;right:20px;bottom:96px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif);}",
			"*{box-sizing:border-box;}",
			".launcher{width:38px;height:38px;border-radius:19px;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;touch-action:none;font-size:14px;font-weight:700;letter-spacing:-.02em;color:var(--dsw-alias-label-tertiary,#6b7280);background:var(--dsw-specific-menu,#f4f5f7f2);border:1px solid var(--dsw-alias-border-l4,rgba(0,0,0,.12));box-shadow:0 4px 14px rgba(0,0,0,.12);opacity:.72;transition:opacity .15s ease,transform .15s ease;}",
			".launcher:hover,.launcher:focus-visible{opacity:1;transform:translateY(-1px);outline:none;}",
			".panel{width:252px;padding:12px;border-radius:14px;background:var(--dsw-specific-menu,#f8f9faf2);border:1px solid var(--dsw-alias-border-l4,rgba(0,0,0,.1));box-shadow:0 18px 48px rgba(0,0,0,.18);backdrop-filter:blur(14px);color:var(--dsw-alias-label-primary,#111827);display:flex;flex-direction:column;gap:10px;}",
			".panel[hidden]{display:none;}",
			".head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:700;}",
			".close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:14px;line-height:1;padding:4px 6px;border-radius:6px;cursor:pointer;}",
			".close:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06));}",
			".row{display:flex;align-items:center;gap:8px;font-size:12px;}",
			".label{width:26px;flex:none;color:var(--dsw-alias-label-tertiary,#6b7280);}",
			".seg{display:flex;flex:1;gap:2px;padding:2px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06));}",
			".seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);flex:1;padding:5px 4px;border-radius:7px;font-size:12px;font-family:inherit;cursor:pointer;}",
			".seg button[aria-pressed='true']{background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;font-weight:600;}",
			".range{flex:1;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);min-width:0;}",
			".val{width:42px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#4b5563);}",
			".presets{display:flex;gap:6px;padding-left:34px;}",
			".presets button{appearance:none;flex:1;border:1px solid var(--dsw-alias-border-l4,rgba(0,0,0,.1));background:transparent;color:var(--dsw-alias-label-secondary,#4b5563);border-radius:8px;padding:4px 0;font-size:11px;font-family:inherit;cursor:pointer;}",
			".presets button:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe);}",
			".foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:2px;border-top:1px solid var(--dsw-alias-border-l4,rgba(0,0,0,.08));}",
			".reset{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11px;font-family:inherit;cursor:pointer;padding:4px 0;}",
			".reset:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);}",
			".hint{font-size:10.5px;color:var(--dsw-alias-label-caption,#9ca3af);}"
		].join("");

		var WIDGET_HTML = [
			"<div class='panel' hidden>",
			"<div class='head'><span>字体调节</span><button class='close' type='button' aria-label='关闭'>✕</button></div>",
			"<div class='row'><span class='label'>模式</span><div class='seg' data-key='mode'>",
			"<button type='button' data-value='zoom'>整体</button>",
			"<button type='button' data-value='text'>仅文字</button>",
			"</div></div>",
			"<div class='row'><span class='label'>大小</span><input class='range' type='range' min='85' max='175' step='5' aria-label='缩放比例'/><span class='val'>110%</span></div>",
			"<div class='presets'><button type='button' data-preset='100'>100%</button><button type='button' data-preset='110'>110%</button><button type='button' data-preset='125'>125%</button><button type='button' data-preset='140'>140%</button></div>",
			"<div class='row'><span class='label'>字重</span><div class='seg' data-key='weight'>",
			"<button type='button' data-value='normal'>正常</button>",
			"<button type='button' data-value='bold'>加粗</button>",
			"<button type='button' data-value='heavy'>超粗</button>",
			"</div></div>",
			"<div class='foot'><button class='reset' type='button'>恢复默认</button><span class='hint'>保存在本机</span></div>",
			"</div>",
			"<div class='launcher' role='button' tabindex='0' aria-label='字体调节' title='字体调节'>Aa</div>"
		].join("");

		function createWidget(cleanups) {
			var existing = document.getElementById(HOST_ID);
			if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

			var host = document.createElement("div");
			host.id = HOST_ID;
			// 宿主元素仍可能被应用的全局面板样式命中，显式收紧一次。
			host.style.position = "fixed";
			host.style.right = "20px";
			host.style.bottom = "96px";
			host.style.zIndex = "2147483000";
			host.style.pointerEvents = "auto";

			var root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : null;
			var mount = root || host;
			if (root) {
				var style = document.createElement("style");
				style.textContent = WIDGET_CSS;
				root.appendChild(style);
			}
			var wrap = document.createElement("div");
			wrap.innerHTML = WIDGET_HTML;
			mount.appendChild(wrap);

			var panel = wrap.querySelector(".panel");
			var launcher = wrap.querySelector(".launcher");
			var range = wrap.querySelector(".range");
			var valueLabel = wrap.querySelector(".val");

			function syncWidget() {
				if (panel) panel.hidden = !panelOpen;
				if (range) range.value = String(state.scale);
				if (valueLabel) valueLabel.textContent = state.scale + "%";
				var segs = wrap.querySelectorAll(".seg");
				for (var i = 0; i < segs.length; i += 1) {
					var key = segs[i].getAttribute("data-key");
					var buttons = segs[i].querySelectorAll("button");
					for (var j = 0; j < buttons.length; j += 1) {
						var active = buttons[j].getAttribute("data-value") === state[key];
						buttons[j].setAttribute("aria-pressed", active ? "true" : "false");
					}
				}
			}

			var panelOpen = false;

			function setState(patch) {
				if (patch.mode) state.mode = patch.mode;
				if (isFiniteNumber(patch.scale)) state.scale = clamp(patch.scale, MIN_SCALE, MAX_SCALE);
				if (patch.weight) state.weight = patch.weight;
				syncWidget();
				apply();
				saveState();
			}

			function placeHost() {
				if (state.pos) {
					host.style.left = state.pos.left + "px";
					host.style.top = state.pos.top + "px";
					host.style.right = "auto";
					host.style.bottom = "auto";
				}
			}

			placeHost();

			// 拖动：位移超过阈值才算拖动，否则当作点击开关面板。
			var drag = null;
			function onLauncherPointerDown(event) {
				if (event.button !== undefined && event.button !== 0) return;
				var rect = host.getBoundingClientRect();
				drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
				try {
					launcher.setPointerCapture(event.pointerId);
				} catch (error) { /* 老浏览器没有指针捕获 */ }
			}
			function onLauncherPointerMove(event) {
				if (!drag) return;
				var dx = event.clientX - drag.x;
				var dy = event.clientY - drag.y;
				if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
				drag.moved = true;
				event.preventDefault();
				var width = host.getBoundingClientRect().width || 38;
				var left = clamp(drag.left + dx, 4, window.innerWidth - width - 4);
				var top = clamp(drag.top + dy, 4, window.innerHeight - 48);
				host.style.left = left + "px";
				host.style.top = top + "px";
				host.style.right = "auto";
				host.style.bottom = "auto";
			}
			function onLauncherPointerUp() {
				if (!drag) return;
				var moved = drag.moved;
				drag = null;
				if (moved) {
					var rect = host.getBoundingClientRect();
					state.pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
					saveState();
					return;
				}
				panelOpen = !panelOpen;
				syncWidget();
			}

			function onRangeInput() {
				setState({ scale: Number.parseInt(range.value, 10) });
			}
			function onSegClick(event) {
				var button = event.target && event.target.closest ? event.target.closest("button") : null;
				if (!button) return;
				var seg = button.parentNode;
				var key = seg.getAttribute("data-key");
				var patch = {};
				patch[key] = button.getAttribute("data-value");
				setState(patch);
			}
			function onPresetClick(event) {
				var button = event.target && event.target.closest ? event.target.closest("button") : null;
				if (!button) return;
				setState({ scale: Number.parseInt(button.getAttribute("data-preset"), 10) });
			}
			function onCloseClick() {
				panelOpen = false;
				syncWidget();
			}
			function onResetClick() {
				setState({ mode: DEFAULTS.mode, scale: DEFAULTS.scale, weight: DEFAULTS.weight });
			}
			function onKeyDown(event) {
				if (event.key === "Escape" && panelOpen) {
					panelOpen = false;
					syncWidget();
				}
				if ((event.key === "Enter" || event.key === " ") && event.target === launcher) {
					event.preventDefault();
					panelOpen = !panelOpen;
					syncWidget();
				}
			}
			function onDocumentPointerDown(event) {
				if (!panelOpen) return;
				var path = typeof event.composedPath === "function" ? event.composedPath() : [];
				if (path.indexOf(host) !== -1) return;
				panelOpen = false;
				syncWidget();
			}

			launcher.addEventListener("pointerdown", onLauncherPointerDown);
			launcher.addEventListener("pointermove", onLauncherPointerMove);
			launcher.addEventListener("pointerup", onLauncherPointerUp);
			launcher.addEventListener("pointercancel", onLauncherPointerUp);
			var rangeInput = range;
			if (rangeInput) rangeInput.addEventListener("input", onRangeInput);
			var modeSeg = wrap.querySelector(".seg[data-key='mode']");
			var weightSeg = wrap.querySelector(".seg[data-key='weight']");
			if (modeSeg) modeSeg.addEventListener("click", onSegClick);
			if (weightSeg) weightSeg.addEventListener("click", onSegClick);
			var presetRow = wrap.querySelector(".presets");
			if (presetRow) presetRow.addEventListener("click", onPresetClick);
			var closeButton = wrap.querySelector(".close");
			if (closeButton) closeButton.addEventListener("click", onCloseClick);
			var resetButton = wrap.querySelector(".reset");
			if (resetButton) resetButton.addEventListener("click", onResetClick);
			document.addEventListener("keydown", onKeyDown, true);
			document.addEventListener("pointerdown", onDocumentPointerDown, true);

			document.body.appendChild(host);
			syncWidget();

			cleanups.push(function () {
				document.removeEventListener("keydown", onKeyDown, true);
				document.removeEventListener("pointerdown", onDocumentPointerDown, true);
				if (host.parentNode) host.parentNode.removeChild(host);
			});
			return host;
		}

		// ── 插件体 ──────────────────────────────────────────────────────────
		return {
			name: "font-tuner",
			apply: function (ctx) {
				var cleanups = [];
				var observers = [];

				var dispose = function () {
					for (var i = 0; i < cleanups.length; i += 1) {
						try {
							cleanups[i]();
						} catch (error) { /* 清理失败不阻塞 */ }
					}
					for (var j = 0; j < observers.length; j += 1) {
						try {
							observers[j].disconnect();
						} catch (error) { /* 同上 */ }
					}
					cleanups.length = 0;
					observers.length = 0;
					removeStyle();
					try {
						document.documentElement.style.removeProperty("zoom");
						document.documentElement.removeAttribute("data-dsh-font-tuner");
					} catch (error) { /* 卸载时 DOM 可能已销毁 */ }
					try {
						delete window.__DSH_FONT_TUNER_STATUS__;
					} catch (error) { /* 只读全局句柄 */ }
				};

				var started = false;

				function start() {
					if (started) return;
					// immediately 激活可能早于 shell 挂出 <body>，此时先不装配。
					if (!document || !document.documentElement || !document.body) return;
					started = true;
					try {
						readState();
						apply();
						createWidget(cleanups);

						// 应用写会话字号时会直接改 body 的 inline style；文字模式
						// 依赖它的值，所以跟着重算一次。
						if (typeof MutationObserver === "function") {
							var pending = null;
							var observer = new MutationObserver(function () {
								if (pending) return;
								pending = window.setTimeout(function () {
									pending = null;
									if (state.mode === "text") apply();
								}, 160);
							});
							observer.observe(document.body, { attributes: true, attributeFilter: ["style"] });
							observers.push(observer);
							cleanups.push(function () {
								if (pending) window.clearTimeout(pending);
							});
						}
					} catch (error) {
						try {
							console.warn(LOG_PREFIX, "boot failed", error);
						} catch (ignored) { /* 控制台不可用 */ }
					}
				}

				start();
				if (!started && document.addEventListener) {
					var onReady = function () {
						document.removeEventListener("DOMContentLoaded", onReady);
						start();
					};
					document.addEventListener("DOMContentLoaded", onReady);
					cleanups.push(function () { document.removeEventListener("DOMContentLoaded", onReady); });
				}


				if (ctx && typeof ctx.effect === "function") {
					ctx.effect(function () {
						return dispose;
					});
				} else {
					window.addEventListener("beforeunload", dispose);
				}
			}
		};
	}
});
