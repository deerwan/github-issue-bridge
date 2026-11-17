# GitHub Issue 自动分析：Cloudflare Worker 接收端

这套 Worker 接 GitHub 的 issue webhook，把新 issue 存进 KV，
Muse 每 2 分钟来取一次，分析后回帖（或先发你草稿确认）。

## 部署步骤

### 1. 创建 KV

```bash
npx wrangler kv namespace create ISSUE_QUEUE
```

把返回的 `id` 填进 `wrangler.toml`。

### 2. 设置 webhook 密钥

```bash
npx wrangler secret put WEBHOOK_SECRET
```

值随便生成一个，例如：`openssl rand -hex 32` 的输出。GitHub 配 webhook 时填同一个。

### 3. 部署

```bash
npx wrangler deploy
```

部署成功后得到地址，例如：
`https://github-issue-bridge.<你的子域>.workers.dev`

也可以不用命令行：在 Cloudflare Dashboard → Workers & Pages → Create，
把 `src/index.js` 的内容粘贴进去，再在 Settings → Variables 里绑 KV
（变量名 `ISSUE_QUEUE`）和加 Secret（`WEBHOOK_SECRET`）。

### 4. 仓库里配 webhook

仓库 Settings → Webhooks → Add webhook：

- Payload URL：`https://github-issue-bridge.<你的子域>.workers.dev/webhook`
- Content type：`application/json`
- Secret：上面第 2 步的值
- Which events：选 Let me select individual events，只勾 **Issues**

### 5. 测试

在仓库开一个测试 issue，然后访问：

```
https://github-issue-bridge.<你的子域>.workers.dev/queue
```

应能看到刚才那个 issue 的标题和链接。

## 接口说明

| 接口 | 用途 |
| --- | --- |
| `POST /webhook` | GitHub 推送 issue 事件（验签后存 KV） |
| `GET /queue` | 列出待处理的 issue，Muse 定时来取 |
| `POST /ack` | body `{"key": "pending:<仓库>:<编号>"}`，处理完后删除，避免重复 |
| `GET /` | 健康检查 |

## Muse 这边

部署完把 Worker 地址发给 Deer，我来设 2 分钟一次的巡查：
有新 issue 就自动分析，按你定的方式回帖或先发你草稿。

## 注意

- Worker 免费额度每天 10 万次请求，这点量完全够用。
- `/queue` 默认是公开的，公开仓库的 issue 本来就是公开的，无所谓；
  如果是私有仓库，告诉我，我再给你加个 token 校验版。
- KV 里的待处理记录 7 天后自动过期，防止堆积。
