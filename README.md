# 字体调节（dsh-font-tuner）

给 DeepSeek Harness 的 Web 界面加一个可调的字体面板：**整体缩放**、**仅文字放大**、**字重加粗**，面板悬浮在右下角，设置存在本机。

## 它做什么

| 项 | 说明 |
| --- | --- |
| 模式 · 整体 | 给 `<html>` 加 CSS `zoom`，整页等比放大：文字、间距、图标一起变大，布局按百分比重排，不会把界面挤到视口外。 |
| 模式 · 仅文字 | 只放大应用自带的排版 token（`--dsw-font-*`）和会话正文字号变量，间距和控件尺寸基本不动。适合"字大但别挤"。 |
| 大小 | 85% – 175%，5% 一档；快捷键按钮 100 / 110 / 125 / 140。 |
| 字重 | 正常 / 加粗 / 超粗。做法是读 `--dsw-font-*` 这组排版 token 的计算值、重拼 font shorthand 后写回 `html:root`（特异性 0,1,1 高于应用的 `:root` 的 0,1,0），再给 `body` 一个基础字重。「加粗」把 400 抬到 600、把 strong token 的 500 抬到 700；「超粗」对应 700 / 800。保留粗体层级，不做统一 +100。 |

**默认值**：整体模式、110%、加粗。**恢复默认** 会同时把缩放归 100%。

## 安装

需要带 `dsh plugin` 子命令的 DeepSeek Harness。插件只改浏览器端的 CSS，不碰 `app.asar`。

```bash
git clone https://github.com/ziyepei06/dsh-font-tuner.git
dsh plugin --profile desktop add file:./dsh-font-tuner
```

然后重启应用，右下角出现 `Aa` 圆钮。

## 装在哪

装好之后它落在 profile 内部，和桌面上的文件无关：

```
~/.dsh/profiles/desktop/plugins/dsh-font-tuner   # 源码（唯一真实副本）
~/.dsh/profiles/desktop/node_modules/dsh-font-tuner  # pnpm 硬链接，供 Host 解析
```

profile 的 `package.json` 里已经登记好，装的时候用的是应用自带 CLI：

```bash
dsh plugin --profile desktop add file:./plugins/dsh-font-tuner
```

对应两条改动：`dependencies` 增加 `"dsh-font-tuner": "file:.../plugins/dsh-font-tuner"`，
`dsh.profile.bundles` 末尾增加 `"dsh-font-tuner"`。

**改动在下次启动生效**（应用内的提示原文就是「更改将在下次启动生效」）：退出并重新打开 DeepSeek Harness，右下角出现 `Aa` 圆钮。

要改代码就改 `plugins/` 下那份，然后重启应用；`dsh plugin --profile desktop remove dsh-font-tuner` 可移除依赖。

## 使用

右下角出现一个 **Aa** 小圆钮：

- **点一下** 打开面板，**再点一下** 收起；
- **按住拖动** 可以把它挪到不挡手的位置（位置也会记住）；
- 面板里改任何一项都会立刻生效，`Esc` 或点空白处关闭面板。

## 边界与代价

- **不碰 `app.asar`**，不改应用本身；删掉这个插件目录里的包（或从插件页卸载）就完全恢复。
- **设置只存本机**（`localStorage` 的 `dsh-font-tuner/v1`）。视觉偏好按 DSH 的边界就该留在本机，不同步到 Host 设置文档。
- **仅文字模式** 只能放大用 `--dsw-font-*` token 的文字；应用里少数直接写死 `px` 的文案（比如个别菜单项）不会变。想全都变大就用「整体」模式。
- **整体模式** 用的是 CSS `zoom`，极端比例下（>160%）个别第三方组件（内嵌终端、表格预览）可能出现像素级对齐偏差；调回 100% 即恢复。
- 应用自己的 **设置 → 外观 → 字号大小**（10–22px，仅会话正文）仍然有效，在「整体」模式下会和本插件的缩放叠乘；在「仅文字」模式下会被本插件的覆盖取代。

## 卸载

任一方式：

- 应用里 **设置 → 插件** 找到 `dsh-font-tuner` → 卸载；
- 或命令行 `dsh plugin --profile desktop remove dsh-font-tuner`，再删掉 `plugins/dsh-font-tuner` 目录。

然后重启应用。插件卸载时会一并移除注入的 `<style>`、浮动控件和 `zoom`，不需要手动清残留。

## 文件

```
dsh-font-tuner/
├── package.json        # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml    # 插入一条 Loader entry（id: font-tuner）
├── index.js            # Host 半边：空插件
├── client.js           # 浏览器半边：缩放、字重、面板
├── icon.svg
├── LICENSE
├── README.md
└── dev/smoke.mjs       # 自检：Node + 最小 DOM 桩，跑 6 个场景
```

## 自检

本仓库不依赖任何包，直接用 Node 跑：

```bash
node dev/smoke.mjs   # 或 npm test
```

覆盖六项：默认 110% 整体 + 加粗的 CSS 结构、仅文字 140% + 超粗、100% + 正常不注入样式、卸载清理、面板接线（点开/收起、拖滑块实时生效、切模式撤掉 zoom）、`<body>` 未就绪时挂起并等待 `DOMContentLoaded`。这是逻辑级的自检，**视觉上的最终效果要在应用窗口里看一眼**。

## License

MIT © 2026 Pei Ziye
