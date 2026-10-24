export function getInitDataHeader(): string {
  if (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return "dev-mode";
}
