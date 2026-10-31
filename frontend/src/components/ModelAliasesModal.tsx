import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import {
  addAlias,
  deleteAlias,
  fetchAliases,
  type AliasOut,
} from "../api/aliases";
import { invalidate } from "../api/cache";

interface Props {
  open: boolean;
  modelId: number;
  modelTitle: string;
  onClose: () => void;
}

export function ModelAliasesModal({ open, modelId, modelTitle, onClose }: Props) {
  const toast = useToast();
  const [aliases, setAliases] = useState<AliasOut[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchAliases(modelId);
      setAliases(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить названия");
    } finally {
      setLoading(false);
    }
  }, [modelId, toast]);

  useEffect(() => {
    if (!open) return;
    setInput("");
    load();
  }, [open, load]);

  const handleAdd = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const created = await addAlias(modelId, trimmed);
      setAliases((prev) => [...prev, created]);
      setInput("");
      invalidate("catalog");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: number) => {
    try {
      await deleteAlias(modelId, id);
      setAliases((prev) => prev.filter((a) => a.id !== id));
      invalidate("catalog");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Названия: ${modelTitle}`}>
      <div className="aliases">
        <p className="aliases__hint">
          Синонимы помогают найти модель по неформальному названию.
        </p>

        {loading && <div className="aliases__loading">Загрузка…</div>}

        {!loading && aliases.length === 0 && (
          <div className="aliases__empty">Пока нет альтернативных названий</div>
        )}

        {aliases.length > 0 && (
          <ul className="aliases__list">
            {aliases.map((a) => (
              <li key={a.id} className="aliases__item">
                <span className="aliases__value">{a.value}</span>
                <button
                  type="button"
                  className="aliases__remove"
                  onClick={() => handleRemove(a.id)}
                  aria-label={`Удалить «${a.value}»`}
                  title="Удалить"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="aliases__add">
          <input
            type="text"
            className="aliases__input"
            placeholder="Например: гаш, тамрон, GH5"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            disabled={saving}
            maxLength={120}
          />
          <button
            type="button"
            className="aliases__btn"
            onClick={handleAdd}
            disabled={saving || !input.trim()}
          >
            {saving ? "…" : "Добавить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
