# 讲清楚开发入口

## 先读

- `.workbench/project.json`：社团工作台规范索引与需求状态。
- `docs/PROJECT_SPEC.md`：产品范围、隐私边界、接口与验收。
- `docs/RELEASE.md`：合并、Sites 发布、验证和回滚流程。
- `README.md`：功能概览、本地运行方式和已知限制。

规范包目前是待人类审阅的草稿。不得把 `pending` 或 `suggested` 写成已批准，也不得代替成员投票、任务认领、PR 合并或验收。

## 工程边界

- 保持本地优先：原始录音不得发送给 AI 服务商。
- BYOK 凭据只用于用户明确发起的同源请求，不写入训练历史、导出文件、日志或仓库。
- 外部服务地址必须继续经过公网 HTTPS、私网/IP、重定向和请求头限制。
- 本地评分必须可复现；缺少可靠证据的维度使用未知值，不伪造分数、语速或声音判断。
- 涉及隐私、评分规则、数据迁移、网络请求或 Service Worker 的变化必须补测试，并在 PR 中说明行为变化。
- 不提交 `.env*`、API Key、录音、用户训练数据、构建产物或本地 Wrangler 状态。

## 命令

- 安装：`npm ci`
- 开发：`npm run dev`
- 完整验证：`npm run verify`
- 生产运行：`npm run build && npm run start`

Node.js 必须为 `22.13.0` 或更高版本。只陈述实际运行过的测试结果；浏览器、录音、WebGPU、WASM 与真实服务商联调未运行时应明确标记。

## 发布

在功能分支完成修改并通过 `npm run verify`，经 Pull Request 审查后合并到 `main`。正式 Sites 版本必须来自同一已合并提交，并按 `docs/RELEASE.md` 记录提交、版本、部署结果、冒烟测试和回滚点。不要通过修改站点访问范围来完成普通发布。
