export function installerCleanupBlockedDialogOptions(): {
  type: "error";
  buttons: [string];
  defaultId: 0;
  cancelId: 0;
  title: string;
  message: string;
  detail: string;
  noLink: true;
} {
  return {
    type: "error",
    buttons: ["留在应用"],
    defaultId: 0,
    cancelId: 0,
    title: "安装进程仍在回收",
    message: "尚未确认 CLI 安装进程已经安全退出。",
    detail: "Moebius 已阻止退出。请留在应用中稍后重试，避免遗留后台安装进程。",
    noLink: true,
  };
}
