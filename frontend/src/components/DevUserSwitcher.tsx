import { useEffect, useState } from "react";
import {
  DEV_USER_STORAGE_KEY,
  readDevUser,
  writeDevUser,
  type DevUser,
} from "../api/auth-helper";

const LABELS: Record<DevUser, string> = {
  superadmin: "Суперадмин",
  miettv_head: "Глава МИЭТ-ТВ (видео)",
  infocus_head: "Глава InFocus (фото)",
  photographer: "Фотограф (InFocus)",
  videographer: "Видеограф (МИЭТ-ТВ)",
  both: "Обе роли",
  pending: "Pending",
  blocked: "Blocked",
};

export function DevUserSwitcher() {
  const [current, setCurrent] = useState<DevUser>(() => readDevUser());

  useEffect(() => {
    const onChange = (e: StorageEvent) => {
      if (e.key === DEV_USER_STORAGE_KEY) {
        setCurrent(readDevUser());
      }
    };
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);

  const onChange = (v: DevUser) => {
    writeDevUser(v);
    setCurrent(v);
    window.location.reload();
  };

  return (
    <div className="dev-switcher" title="Только для локальной разработки">
      <label className="dev-switcher__label" htmlFor="dev-user-select">
        Dev user
      </label>
      <select
        id="dev-user-select"
        className="dev-switcher__select"
        value={current}
        onChange={(e) => onChange(e.target.value as DevUser)}
      >
        {(Object.keys(LABELS) as DevUser[]).map((k) => (
          <option key={k} value={k}>
            {LABELS[k]}
          </option>
        ))}
      </select>
    </div>
  );
}
