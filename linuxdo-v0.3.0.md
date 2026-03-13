# InkOS v0.3.0 更新：多题材 + 多模型 + 去 AI 味

之前发过 InkOS 的帖子，一个开源的自动化小说写作 CLI Agent，5 个 Agent 接力完成 写→审→改 全流程。当时只跑了玄幻题材。

这次是一个比较大的更新，解决了三个核心问题：

1. 之前所有创作规则硬编码为玄幻，换题材写出来就是垃圾
2. LLM 只能用 OpenAI 兼容接口，用 Anthropic 需要中转
3. AI 味太重，叙述者替读者下结论、"核心动机""信息边界"这种分析报告语言跑到正文里

---

## 1. 三层规则架构

之前 writer agent 的 prompt 里 148 行规则全是"杀伐果断""同质吞噬衰减公式"。用这套规则写都市或者恐怖，出来的东西没法看。

现在拆成三层：

```
通用规则（~25 条，代码内置，适用所有题材）
  ↓ 合并
题材规范（genres/*.md，按题材定制）
  ↓ 合并
单本书规则（books/{id}/story/book_rules.md，逐本定制）
  ↓ 注入 prompt
LLM
```

**通用层**保留了人物塑造、叙事技法、逻辑自洽、语言约束这些跟题材无关的规则，大概 25 条。

**题材层**内置了 5 个 profile：

| 题材 | 特点 |
|------|------|
| 玄幻 | 数值系统、战力体系、同质吞噬衰减公式、全 19 维度审计 |
| 仙侠 | 修炼/悟道节奏、法宝体系、天道规则、数值+战力审计 |
| 都市 | 无数值/战力、启用年代考据、商战/社交/信息差驱动 |
| 恐怖 | 无数值/战力、氛围递进、恐惧层级、克制叙事 |
| 通用 | 最小化兜底 |

每个 profile 用 YAML + markdown 定义，可以自己改：

```bash
inkos genre list                      # 查看所有题材
inkos genre show xuanhuan             # 查看玄幻 profile
inkos genre create wuxia --name 武侠   # 创建自定义题材
inkos genre copy xuanhuan             # 复制内置 profile 到项目定制
```

**书籍层**可以锁主角人设、覆盖疲劳词、追加审计维度等，建筑师 agent 自动生成，也可以手改。

## 2. 19 维度审计

之前审计员就是笼统地"检查一致性"。现在明确了 19 个维度，按题材条件启用：

- 始终启用（15 个）：OOC、时间线、设定冲突、伏笔、节奏、文风、信息越界、词汇疲劳、利益链断裂、配角降智、配角工具人化、爽点虚化、台词失真、流水账、知识库污染、视角一致性
- 条件启用：战力崩坏（powerScaling=true）、数值检查（numericalSystem=true）、年代考据（eraResearch=true）

玄幻全开 19 个，都市 17 个（加年代考据，去数值/战力），恐怖 15 个。不会出现恐怖小说被审计"战力崩坏"这种事了。

## 3. 去 AI 味

用 3 个题材各跑了几章测试，发现 AI 味的核心来源：

1. 叙述者替读者下结论（应该只写动作让读者自己判断）
2. 分析报告式语言（"核心动机""信息边界""信息落差"跑进正文）
3. AI 标记词密度高（仿佛/忽然/竟然/不禁/宛如/猛地）
4. 同一意象原地打转（"火在体内流动"连写三遍）

对策：通用层加了 5 条铁律，每个题材还有专属语言铁律带 ✗→✓ 示例。比如：

- 玄幻：✗ "他的火元从12缕增加到24缕" → ✓ "手臂比先前有力了，握拳时指骨发紧"
- 都市：✗ "他迅速分析了当前的债务状况" → ✓ "他把那叠皱巴巴的白条翻了三遍"
- 恐怖：✗ "他感到一阵恐惧" → ✓ "他后颈的汗毛一根根立起来"

AI 标记词密度限制每 3000 字不超过 1 次，审计会 warning。

## 4. 多 LLM 提供商

之前运行时只有 OpenAI SDK，但 `inkos init` 默认生成 Anthropic 配置 —— 用 OpenAI SDK 打 Anthropic 端点，直接 `Premature close`。（感谢 issue #1 报告）

现在加了 Anthropic SDK 原生支持。两种用法：

```bash
# OpenAI / 任何兼容接口
INKOS_LLM_PROVIDER=openai
INKOS_LLM_BASE_URL=https://api.openai.com/v1
INKOS_LLM_MODEL=gpt-4o

# Anthropic 直连
INKOS_LLM_PROVIDER=anthropic
INKOS_LLM_BASE_URL=https://api.anthropic.com
INKOS_LLM_MODEL=claude-sonnet-4-5-20250514
```

`provider.ts` 内部封装了统一的 `chatCompletion()` 和 `chatWithTools()`，所有 agent 和 agent loop（tool-use）都走同一个抽象层，streaming + tool calling 两种 SDK 都支持。

## 实测

3 个题材各 3 章：

| 题材 | 书名 | 验证点 |
|------|------|--------|
| 玄幻 | 烈焰吞天 | 数值追踪正常、战力验算、资源账本 |
| 都市 | 重生2003 | 无数值系统、年代考据、法律术语匹配 2003 年 |
| 恐怖 | 末班地铁 | 无战力审计、氛围递进、克制叙事 |

去 AI 味改进前后对比：词汇疲劳审计从"AI标记词密度偏高"变成"基本未超标"，文风检查从"叙述者越位"变成"场景落点具体"。

## 安装

```bash
npm i -g @actalk/inkos
```

GitHub：https://github.com/nicepkg/inkos

有问题提 issue，欢迎 PR。
