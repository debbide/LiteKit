const fileTable = document.getElementById("fileTable");
const breadcrumb = document.getElementById("breadcrumb");
const newFileBtn = document.getElementById("newFileBtn");
const newFolderBtn = document.getElementById("newFolderBtn");
const editor = document.getElementById("editor");
const editorPath = document.getElementById("editorPath");
const saveBtn = document.getElementById("saveBtn");
const editorModal = document.getElementById("editorModal");
const closeEditorBtn = document.getElementById("closeEditorBtn");
const logoutBtn = document.getElementById("logoutBtn");
const passwordForm = document.getElementById("passwordForm");
const passwordMsg = document.getElementById("passwordMsg");

let currentPath = "";
let currentFile = null;

function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(1)} ${units[idx]}`;
}

function formatTime(value) {
  const date = new Date(value);
  return date.toLocaleString();
}


function setBreadcrumb(pathStr) {
  const parts = pathStr ? pathStr.split("/") : [];
  const items = ["/"];
  let acc = "";
  parts.forEach((part) => {
    acc = acc ? `${acc}/${part}` : part;
    items.push(acc);
  });
  breadcrumb.innerHTML = items
    .map((part, idx) => {
      const label = idx === 0 ? "/" : part.split("/").pop();
      return `<button data-path="${part === "/" ? "" : part}">${label}</button>`;
    })
    .join(" / ");
  breadcrumb.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate(btn.dataset.path || "");
    });
  });
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Request failed");
  }
  return res.json();
}

async function loadList(pathStr = "") {
  const data = await request(`/api/list?path=${encodeURIComponent(pathStr)}`);
  currentPath = data.path || "";
  setBreadcrumb(currentPath);
  renderTable(data.entries || []);
}

function renderTable(entries) {
  fileTable.innerHTML = "";
  entries
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    .forEach((entry) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${entry.name}</td>
        <td>${entry.type === "dir" ? "文件夹" : "文件"}</td>
        <td>${entry.type === "dir" ? "-" : formatSize(entry.size)}</td>
        <td>${formatTime(entry.mtime)}</td>
        <td>
          <div class="file-actions">
            <button data-action="open">打开</button>
            ${entry.type === "file" ? '<button data-action="edit">编辑</button>' : ""}
            <button data-action="rename">重命名</button>
            <button data-action="delete">删除</button>
          </div>
        </td>
      `;
      row.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => handleAction(btn.dataset.action, entry));
      });
      fileTable.appendChild(row);
    });
}

async function handleAction(action, entry) {
  const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
  if (action === "open") {
    if (entry.type === "dir") {
      navigate(entryPath);
    }
  }
  if (action === "edit") {
    await openEditor(entryPath);
  }
  if (action === "rename") {
    const newName = prompt("新名称", entry.name);
    if (!newName) return;
    await request("/api/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: entryPath, newName })
    });
    await loadList(currentPath);
  }
  if (action === "delete") {
    const ok = confirm(`确认删除 ${entry.name} 吗？`);
    if (!ok) return;
    await request("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: entryPath })
    });
    await loadList(currentPath);
  }
}

async function openEditor(pathStr) {
  const data = await request(`/api/file?path=${encodeURIComponent(pathStr)}`);
  currentFile = pathStr;
  editor.value = data.content || "";
  editorPath.textContent = currentFile;
  if (editorModal) {
    editorModal.classList.remove("hidden");
    editorModal.setAttribute("aria-hidden", "false");
  }
}

function closeEditor() {
  if (!editorModal) return;
  editorModal.classList.add("hidden");
  editorModal.setAttribute("aria-hidden", "true");
}

async function navigate(pathStr) {
  await loadList(pathStr);
}

newFileBtn.addEventListener("click", async () => {
  const name = prompt("文件名");
  if (!name) return;
  await request("/api/create-file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: currentPath, name })
  });
  await loadList(currentPath);
});

newFolderBtn.addEventListener("click", async () => {
  const name = prompt("文件夹名称");
  if (!name) return;
  await request("/api/create-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: currentPath, name })
  });
  await loadList(currentPath);
});


saveBtn.addEventListener("click", async () => {
  if (!currentFile) {
    alert("请选择一个文本文件");
    return;
  }
  await request("/api/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: currentFile, content: editor.value })
  });
  alert("已保存");
  closeEditor();
});

if (closeEditorBtn) {
  closeEditorBtn.addEventListener("click", closeEditor);
}

if (editorModal) {
  editorModal.addEventListener("click", (event) => {
    if (event.target === editorModal) {
      closeEditor();
    }
  });
}


logoutBtn.addEventListener("click", async () => {
  await request("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordMsg.textContent = "";
  const formData = new FormData(passwordForm);
  const payload = Object.fromEntries(formData.entries());
  try {
    await request("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    passwordMsg.textContent = "密码修改成功";
    passwordForm.reset();
  } catch (err) {
    passwordMsg.textContent = err.message;
  }
});


const ADMIN_PATH = window.location.pathname || "/admin";

loadList().catch(() => {
  window.location.href = ADMIN_PATH;
});
