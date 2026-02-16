# Pterodactyl 本机文件面板

一个可部署在翼龙面板（Pterodactyl）里的 Node.js 全栈项目，用于管理容器/服务器上的本地目录文件。无需对接翼龙 API。

## 功能概览

- 登录/会话鉴权（Cookie Session）
- 账号密码加密存储（bcrypt）
- 文件/文件夹列表、创建、重命名、删除
- 文本文件在线编辑
- 审计日志（操作记录）

## 运行要求

- Node.js 18+

## 快速开始

```bash
npm install
npm start
```

服务默认监听 `0.0.0.0`，端口来自环境变量 `PORT`。

访问：`http://<IP>:<PORT>`

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 服务端口 | `3000` |
| `ROOT_PATH` | 文件根目录 | 项目根目录 |
| `DATA_DIR` | 数据目录 | `./data` |
| `SESSION_SECRET` | Session 密钥 | `change-me-in-env` |
| `ADMIN_USER` | 初始管理员用户名 | `admin` |
| `ADMIN_PASS` | 初始管理员密码 | `admin123` |

## 数据持久化

建议将 `data/` 和 `files/` 挂载为持久化目录，避免容器重启丢失数据。

示例：

```
/home/container/data  -> /data
/home/container/files -> /files
```

## 初始化管理员账号

首次启动时，如果 `data/users.json` 不存在，将自动创建管理员账号。

- 若设置 `ADMIN_PASS`，使用该密码
- 未设置则默认 `admin123`

## 目录结构

```
data/               # 用户与会话、审计日志
public/             # 前端静态页面
index.js            # 服务端入口
```

## 安全说明

- 所有文件操作都会校验路径，禁止目录穿越
- 密码使用 bcrypt 加密存储
- 登录接口有限流（默认 10 分钟 20 次）
- 审计日志保存在 `data/audit.log`

## 翼龙面板部署提示

- 启动命令：`npm start`
- 监听地址：`0.0.0.0`，端口由翼龙注入 `PORT`
- 挂载目录：将 `data/` 和 `files/` 配置为持久化挂载
