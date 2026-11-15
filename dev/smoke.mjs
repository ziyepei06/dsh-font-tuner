// dev/smoke.mjs — 在 Node 里用最小 DOM 桩跑一遍 client.js 的装配，
// 校验：注入的 CSS 结构、模式切换、字重映射、缩放值、卸载清理。
// 真实视觉验证需要在应用窗口里做（这里只能证明逻辑与语法是对的）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../client.js", import.meta.url), "utf8");

const TOKEN_VALUES = {
	"--dsw-font-xs-13": "13px/20px var(--dsw-font-family)",
	"--dsw-font-xs-strong-13": "500 13px/20px var(--dsw-font-family)",
	"--dsw-font-xxs-12": "12px/18px var(--dsw-font-family)",
	"--dsw-font-markdown-small-italic": "italic 12px/20px var(--dsw-font-family)",
	"--dsw-font-markdown-code-block": "var(--dsw-font-mono)"
};

function makeStyle() {
	const props = new Map();
	const style = {
		setProperty(name, value) { props.set(name, String(value)); },
		removeProperty(name) { props.delete(name); },
		getPropertyValue(name) { return props.get(name) || ""; }
	};
	return new Proxy(style, {
		get(target, key) {
			if (key in target) return target[key];
			return props.get(key);
		},
		set(target, key, value) {
			if (key in target) { target[key] = value; return true; }
			props.set(key, String(value));
			return true;
		}
	});
}

class FakeNode {
	constructor(id = "") {
		this.id = id;
		this.style = makeStyle();
		this.attributes = new Map();
		this.children = [];
		this.parentNode = null;
		this.listeners = new Map();
		this.textContent = "";
		this.innerHTML = "";
		this.value = "";
		this.hidden = false;
		this.rect = { left: 0, top: 0, width: 38, height: 38 };
	}
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
	removeAttribute(name) { this.attributes.delete(name); }
	hasAttribute(name) { return this.attributes.has(name); }
	appendChild(child) {
		child.parentNode = this;
		this.children.push(child);
		if (child.id) registry.set(child.id, child);
		return child;
	}
	removeChild(child) { this.children = this.children.filter((item) => item !== child); if (child.id) registry.delete(child.id); return child; }
	addEventListener(type, handler) {
		const list = this.listeners.get(type) || [];
		list.push(handler);
		this.listeners.set(type, list);
	}
	removeEventListener() {}
	dispatch(type, event) {
		for (const handler of this.listeners.get(type) || []) handler(event);
	}
	getBoundingClientRect() { return { ...this.rect }; }
	setPointerCapture() {}
	attachShadow() { const root = new FakeNode(); this.shadowRoot = root; return root; }
	querySelector() { return null; }
	querySelectorAll() { return []; }
	get parentElement() { return this.parentNode; }
	closest() { return this; }
}

const registry = new Map();

function makeSeg(key, values) {
	const seg = new FakeNode();
	seg.setAttribute("data-key", key);
	const buttons = values.map((value) => {
		const button = new FakeNode();
		button.setAttribute("data-value", value);
		button.parentNode = seg;
		return button;
	});
	seg.querySelectorAll = (selector) => (selector === "button" ? buttons : []);
	seg.buttons = buttons;
	return seg;
}

const modeSeg = makeSeg("mode", ["zoom", "text"]);
const weightSeg = makeSeg("weight", ["normal", "bold", "heavy"]);

function buildDocument() {
	const documentElement = new FakeNode();
	const body = new FakeNode();
	const head = new FakeNode();
	const nodes = {
		".panel": Object.assign(new FakeNode(), { hidden: true }),
		".launcher": new FakeNode(),
		".range": Object.assign(new FakeNode(), { value: "110" }),
		".val": new FakeNode(),
		".presets": new FakeNode(),
		".close": new FakeNode(),
		".reset": new FakeNode()
	};
	nodes[".seg[data-key='mode']"] = modeSeg;
	nodes[".seg[data-key='weight']"] = weightSeg;
	const document = {
		documentElement,
		body,
		head,
		styleSheets: [],
		createElement(tag) {
			if (tag !== "div") return new FakeNode();
			const wrap = new FakeNode();
			wrap.querySelector = (selector) => nodes[selector] || null;
			wrap.querySelectorAll = (selector) => (selector === ".seg" ? [modeSeg, weightSeg] : []);
			return wrap;
		},
		getElementById(id) { return registry.get(id) || null; },
		listeners: new Map(),
		addEventListener(type, handler) {
			const list = this.listeners.get(type) || [];
			list.push(handler);
			this.listeners.set(type, list);
		},
		removeEventListener(type, handler) {
			const list = this.listeners.get(type) || [];
			this.listeners.set(type, list.filter((item) => item !== handler));
		},
		dispatch(type, event) {
			for (const handler of [...(this.listeners.get(type) || [])]) handler(event || {});
		}
	};
	body.appendChild = function (child) { child.parentNode = body; if (child.id) registry.set(child.id, child); };
	head.appendChild = function (child) { child.parentNode = head; head.children.push(child); if (child.id) registry.set(child.id, child); };
	document.appendChild = (node) => node;
	document.head.appendChild = head.appendChild;
	return { document, documentElement, body, head };
}

function createSandbox(stored, options = {}) {
	const { document, documentElement, body, head } = buildDocument();
	const store = new Map(Object.entries(stored || {}));
	let captured = null;
	const window = {
		__ModuleLoader__: { load(config) { captured = config; } },
		localStorage: {
			getItem: (key) => (store.has(key) ? store.get(key) : null),
			setItem: (key, value) => store.set(key, String(value)),
			removeItem: (key) => store.delete(key)
		},
		getComputedStyle: () => ({ getPropertyValue: (name) => TOKEN_VALUES[name] || "" }),
		setTimeout: (fn) => setTimeout(fn, 0),
		clearTimeout: (id) => clearTimeout(id),
		innerWidth: 1440,
		innerHeight: 900,
		addEventListener() {}
	};
	if (options.failWidget) document.createElement = () => new FakeNode();
	const sandbox = {
		window,
		document,
		console: { warn() {}, log() {}, error() {} },
		MutationObserver: class { observe() {} disconnect() {} },
		setTimeout,
		clearTimeout,
		Math,
		JSON,
		Number,
		Object,
		String,
		Array,
		isFinite
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(SOURCE, sandbox, { filename: "client.js" });
	assert.ok(captured, "client.js 应调用 window.__ModuleLoader__.load");
	assert.equal(captured.id, "dsh-font-tuner", "factory id 必须等于包名");
	return { factory: captured.factory, document, documentElement, body, head, store };
}

// ── 1) 默认配置：整体 110% + 加粗 ──────────────────────────────────────────
{
	const { factory, documentElement, head } = createSandbox({});
	const plugin = factory(() => { throw new Error("不应 require 任何模块"); });
	assert.equal(plugin.name, "font-tuner");
	plugin.apply({});
	const style = head.children.find((node) => node.id === "dsh-font-tuner-css");
	assert.ok(style, "应注入样式节点");
	const css = style.textContent;
	assert.match(css, /html:root\{/, "应写一份 token 覆盖");
	assert.match(css, /--dsw-font-xs-13:600 13px\/20px var\(--dsw-font-family\)/, "加粗应把 400 抬到 600 且字号不变");
	assert.match(css, /--dsw-font-xs-strong-13:700 13px\/20px var\(--dsw-font-family\)/, "500 应抬到 700");
	assert.match(css, /body\{font-weight:600 !important\}/, "应给 body 基础字重");
	assert.doesNotMatch(css, /--dsw-font-markdown-code-block:/, "无法解析的 var() token 应跳过");
	assert.equal(documentElement.style.zoom, "1.1", "整体模式应设 zoom");
	assert.equal(documentElement.getAttribute("data-dsh-font-tuner"), "zoom:110:bold");
	console.log("scenario 1 ok — 默认 110% 整体 + 加粗");
}

// ── 2) 仅文字 140% + 超粗：不设 zoom，token 与正文字号都放大 ────────────────
{
	const { factory, documentElement, body, head } = createSandbox({
		"dsh-font-tuner/v1": JSON.stringify({ mode: "text", scale: 140, weight: "heavy" }),
	});
	body.style.setProperty("--dsh-content-font-size", "14px");
	factory(() => {}).apply({});
	const style = head.children.find((node) => node.id === "dsh-font-tuner-css");
	assert.ok(style, "应注入样式节点");
	const css = style.textContent;
	assert.ok(!("zoom" in documentElement.style), "仅文字模式不应设 zoom");
	assert.match(css, /--dsw-font-xs-13:700 18\.2px\/28px var\(--dsw-font-family\)/, "字号与行高应乘 1.4");
	assert.match(css, /body\{font-weight:700 !important\}/, "超粗 → body 700");
	assert.match(css, /body\{--dsh-content-font-size:calc\(14px \* 1\.4\) !important\}/, "正文字号按 1.4 倍算");
	console.log("scenario 2 ok — 仅文字 140% + 超粗");
}

// ── 3) 正常字重：不写 body 字重，也不动 token ───────────────────────────────
{
	const { factory, head } = createSandbox({
		"dsh-font-tuner/v1": JSON.stringify({ mode: "zoom", scale: 100, weight: "normal" }),
	});
	factory(() => {}).apply({});
	const style = head.children.find((node) => node.id === "dsh-font-tuner-css");
	assert.equal(style, undefined, "100% + 正常时不应注入任何 CSS");
	console.log("scenario 3 ok — 100% 正常不注入样式");
}

// ── 4) 卸载：移除样式、zoom、属性、诊断全局 ─────────────────────────────────
{
	const { factory, documentElement, head } = createSandbox({});
	let dispose = null;
	factory(() => {}).apply({ effect(register) { dispose = register(); } });
	assert.equal(typeof dispose, "function", "应通过 ctx.effect 注册清理");
	dispose();
	assert.equal(head.children.length, 0, "卸载应移除样式节点");
	assert.equal(documentElement.style.zoom, undefined, "卸载应移除 zoom");
	assert.equal(documentElement.getAttribute("data-dsh-font-tuner"), null);
	console.log("scenario 4 ok — 卸载清理");

// ── 5) 面板接线：按钮开合、滑块改值、模式切换 ──────────────────────────────
{
	const { factory, documentElement } = createSandbox({});
	factory(() => {}).apply({});
	const host = registry.get("dsh-font-tuner-host");
	assert.ok(host, "应挂载宿主元素");
	const wrap = host.shadowRoot.children[host.shadowRoot.children.length - 1];
	const panel = wrap.querySelector(".panel");
	const launcher = wrap.querySelector(".launcher");
	const range = wrap.querySelector(".range");
	assert.equal(panel.hidden, true, "默认收起");
	launcher.dispatch("pointerdown", { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
	launcher.dispatch("pointerup", {});
	assert.equal(panel.hidden, false, "点一下应展开");
	launcher.dispatch("pointerdown", { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
	launcher.dispatch("pointerup", {});
	assert.equal(panel.hidden, true, "再点一下应收起");
	range.value = "140";
	range.dispatch("input", {});
	assert.equal(documentElement.style.zoom, "1.4", "拖滑块应立刻生效");
	assert.equal(documentElement.getAttribute("data-dsh-font-tuner"), "zoom:140:bold");
	// 模式按钮：切到「仅文字」后应撤掉 zoom
	modeSeg.dispatch("click", { target: modeSeg.buttons[1] });
	assert.equal(documentElement.style.zoom, undefined, "切到仅文字应撤掉 zoom");
	console.log("scenario 5 ok — 面板接线与实时生效");
}
}


// ── 6) shell 还没挂出 <body> 时：先挂起，DOMContentLoaded 后再装配 ───────────
{
	const { factory, document, documentElement, head, body } = createSandbox({});
	document.body = null;
	factory(() => {}).apply({});
	const style = head.children.find((node) => node.id === "dsh-font-tuner-css");
	assert.equal(style, undefined, "body 未就绪时不应注入样式");
	assert.equal(documentElement.getAttribute("data-dsh-font-tuner"), null, "body 未就绪时不应打标记");
	document.body = body;
	document.dispatch("DOMContentLoaded");
	const mounted = head.children.find((node) => node.id === "dsh-font-tuner-css");
	assert.ok(mounted, "DOMContentLoaded 后应完成装配");
	assert.ok(registry.get("dsh-font-tuner-host"), "DOMContentLoaded 后应挂上浮动控件");
	assert.equal(documentElement.style.zoom, "1.1");
	console.log("scenario 6 ok — body 未就绪时等待挂载");
}

console.log("\nall smoke checks passed");
