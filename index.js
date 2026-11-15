/**
 * dsh-font-tuner — Host 半边。
 *
 * 插件真正的工作全在浏览器端（./client.js：缩放、字重、浮动面板）。
 * Host 侧只注册一个空插件，让 Loader 有一条 entry 对应本包，
 * 由 dsh-client-modules 通过 package.json 的 dsh.client 声明把
 * client 半边挂到 /plugins/dsh-font-tuner/client.js。
 */

export const name = "font-tuner";

export function apply() {
	/* 无 Host 侧行为：不注册工具、不读写设置、不发请求。 */
}
