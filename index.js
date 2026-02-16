const express = require("express");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const FileStore = require("session-file-store")(session);

const app = express();

const PORT = process.env.PORT || 3097;
const ADMIN_PATH = `/${(process.env.ADMIN_PATH || "admin").replace(/^\/+/, "")}`;
const ROOT_PATH = path.resolve(process.env.ROOT_PATH || process.cwd());
const DEFAULT_DATA_DIR = process.platform === "linux" ? "/tmp/webtest" : path.join(process.cwd(), "data");
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const USERS_PATH = path.join(DATA_DIR, "users.json");
const AUDIT_LOG = path.join(DATA_DIR, "audit.log");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

const MAX_TEXT_BYTES = 1024 * 1024 * 2;

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

ensureDirSync(ROOT_PATH);
ensureDirSync(DATA_DIR);
ensureDirSync(SESSIONS_DIR);

function safeResolve(relPath) {
  const safeRel = relPath ? relPath.replace(/\0/g, "") : "";
  const target = path.resolve(ROOT_PATH, safeRel);
  const relative = path.relative(ROOT_PATH, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return { target, relative: relative.replace(/\\/g, "/") };
}

async function readUsers() {
  try {
    const raw = await fsp.readFile(USERS_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function writeUsers(users) {
  await fsp.writeFile(USERS_PATH, JSON.stringify(users, null, 2));
}

async function ensureInitialAdmin() {
  const existing = await readUsers();
  if (existing && Array.isArray(existing.users) && existing.users.length > 0) {
    return;
  }
  const adminUser = process.env.ADMIN_USER || "admin";
  let adminPass = process.env.ADMIN_PASS;
  if (!adminPass) {
    adminPass = "admin123";
  }
  const hash = await bcrypt.hash(adminPass, 10);
  await writeUsers({
    users: [
      {
        username: adminUser,
        passwordHash: hash,
        role: "admin",
        createdAt: new Date().toISOString()
      }
    ]
  });
  // silent
}

function audit(user, action, target) {
  const line = `${new Date().toISOString()}\t${user}\t${action}\t${target}\n`;
  fsp.appendFile(AUDIT_LOG, line).catch(() => undefined);
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  ensureDirSync(SESSIONS_DIR);
  next();
});

app.use(
  session({
    store: new FileStore({ path: SESSIONS_DIR, logFn: () => {} }),
    secret: process.env.SESSION_SECRET || "change-me-in-env",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: { error: "Too many attempts, try later" }
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.accepts(["html", "json"]) === "html") {
    return res.redirect(ADMIN_PATH);
  }
  return res.status(401).json({ error: "Unauthorized" });
}

app.use("/static", express.static(path.join(process.cwd(), "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.get(ADMIN_PATH, (req, res) => {
  if (req.session && req.session.user) {
    return res.sendFile(path.join(process.cwd(), "public", "app.html"));
  }
  return res.sendFile(path.join(process.cwd(), "public", "login.html"));
});

if (ADMIN_PATH !== "/admin") {
  app.get("/admin", (req, res) => {
    res.redirect(ADMIN_PATH);
  });
}

app.get("/login", (req, res) => {
  res.redirect(ADMIN_PATH);
});

app.get("/api/session", (req, res) => {
  res.json({
    user: req.session && req.session.user ? req.session.user : null
  });
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Missing credentials" });
  }
  const data = await readUsers();
  const users = data && Array.isArray(data.users) ? data.users : [];
  const user = users.find((u) => u.username === username);
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.user = { username: user.username, role: user.role };
  audit(user.username, "login", "-");
  return res.json({ ok: true });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const user = req.session.user.username;
  req.session.destroy(() => {
    audit(user, "logout", "-");
    res.json({ ok: true });
  });
});

app.post("/api/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const data = await readUsers();
  if (!data || !Array.isArray(data.users)) {
    return res.status(500).json({ error: "User store missing" });
  }
  const user = data.users.find((u) => u.username === req.session.user.username);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Current password incorrect" });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await writeUsers(data);
  audit(user.username, "change_password", "-");
  return res.json({ ok: true });
});

app.get("/api/list", requireAuth, async (req, res) => {
  const rel = req.query.path || "";
  const resolved = safeResolve(rel);
  if (!resolved) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    const entries = await fsp.readdir(resolved.target, { withFileTypes: true });
    const detailed = await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(resolved.target, entry.name);
        const stat = await fsp.stat(full);
        return {
          name: entry.name,
          size: stat.size,
          mtime: stat.mtime,
          type: entry.isDirectory() ? "dir" : "file"
        };
      })
    );
    return res.json({
      path: resolved.relative,
      entries: detailed
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list directory" });
  }
});


app.post("/api/create-folder", requireAuth, async (req, res) => {
  const rel = req.body.path || "";
  const name = req.body.name || "";
  const resolved = safeResolve(path.join(rel, name));
  if (!resolved) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    await fsp.mkdir(resolved.target, { recursive: false });
    audit(req.session.user.username, "create_folder", resolved.relative);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create folder" });
  }
});

app.post("/api/create-file", requireAuth, async (req, res) => {
  const rel = req.body.path || "";
  const name = req.body.name || "";
  const resolved = safeResolve(path.join(rel, name));
  if (!resolved) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    await fsp.writeFile(resolved.target, "", { flag: "wx" });
    audit(req.session.user.username, "create_file", resolved.relative);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create file" });
  }
});

app.post("/api/rename", requireAuth, async (req, res) => {
  const rel = req.body.path || "";
  const newName = req.body.newName || "";
  const current = safeResolve(rel);
  if (!current) {
    return res.status(400).json({ error: "Invalid path" });
  }
  const targetDir = path.dirname(current.target);
  const renamed = safeResolve(path.join(path.relative(ROOT_PATH, targetDir), newName));
  if (!renamed) {
    return res.status(400).json({ error: "Invalid new path" });
  }
  try {
    await fsp.rename(current.target, renamed.target);
    audit(req.session.user.username, "rename", `${current.relative} -> ${renamed.relative}`);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to rename" });
  }
});

app.post("/api/delete", requireAuth, async (req, res) => {
  const rel = req.body.path || "";
  const resolved = safeResolve(rel);
  if (!resolved) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    await fsp.rm(resolved.target, { recursive: true, force: true });
    audit(req.session.user.username, "delete", resolved.relative);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete" });
  }
});

app.get("/api/file", requireAuth, async (req, res) => {
  const rel = req.query.path || "";
  const resolved = safeResolve(rel);
  if (!resolved) {
    return res.status(400).json({ error: "Invalid path" });
  }
  try {
    const stat = await fsp.stat(resolved.target);
    if (stat.size > MAX_TEXT_BYTES) {
      return res.status(400).json({ error: "File too large to edit" });
    }
    const content = await fsp.readFile(resolved.target, "utf8");
    return res.json({ content });
  } catch (err) {
    return res.status(404).json({ error: "File not found" });
  }
});

app.post("/api/file", requireAuth, async (req, res) => {
  const rel = req.body.path || "";
  const content = req.body.content;
  const resolved = safeResolve(rel);
  if (!resolved) {
    return res.status(400).json({ error: "Invalid path" });
  }
  if (typeof content !== "string") {
    return res.status(400).json({ error: "Invalid content" });
  }
  try {
    await fsp.writeFile(resolved.target, content, "utf8");
    audit(req.session.user.username, "edit", resolved.relative);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to save" });
  }
});


ensureInitialAdmin().then(() => {
  app.listen(PORT, "0.0.0.0");
});
